// ADR-0090 D1/D2, client side: reserve a prepaid ALLOWANCE once (one on-chain transaction, an
// accountant-quorum authorization over a creator-signed `SlotPrepaidAllowanceIntent`), then obtain
// one accountant-quorum DEBIT VOUCHER per operation instead of a per-operation reservation.
//
// The reservation mirrors `reservePaidOperation` (reservation.ts): one quote collected across the
// responsive members, the same `prepared` / `submitted` / `confirmed` durable checkpoints, exactly
// one broadcast, the short-interval receipt waiter, and every observation pinned to the quote
// block. An allowance is fixed-amount: a top-up is a NEW allowance (a new intent nonce).
//
// A voucher round sends the same debit request to every accountant in parallel at ONE quote block
// the caller fixes (journaled before the round, so a retry reuses it), verifies each member's BN254
// partial against its verifying share, Lagrange-combines `k` of them and verifies the aggregate
// against `beacon.mpk()` read at that quote block. Nothing here is sent to a keeper.
//
// Capability discovery: the network exposes none for allowances (an accountant that has the
// writer switched off answers 503 "allowance reservations are not enabled"); the SDK path is
// enabled only by an explicit application option (`PaidOperationConfig.allowances`).

import {decodeFunctionResult, encodeFunctionData, keccak256, parseTransaction, recoverTransactionAddress, recoverTypedDataAddress, toHex,
  type Account, type Address, type Chain, type Hex, type PublicClient, type Transport, type WalletClient} from 'viem'
import {settlementAbi} from './abis/settlement.js'
import {keyRegistryAbi} from './abis/keyRegistry.js'
import {thresholdRandomBeaconAbi} from './abis/thresholdRandomBeacon.js'
import {allowanceId, allowanceReserveDigest, assertDebitVoucherWire, assertPaymentIntentWire, debitVoucherDigest, prepaidAllowanceIntentHash,
  prepaidAllowanceIntentTypedData, prepaidRequestId, type DebitVoucherWire, type PaymentIntentWire, type PrepaidAllowanceIntentWire} from '../committee/payment.js'
import {accountantEndpoints, PaidReservationUncertainError, untilAborted} from './reservation.js'
import {pollTransactionReceipt} from './receipt.js'
import {pinnedCall} from './pinnedReads.js'
import {chainIdOf} from './chainId.js'
import {UnderfundedGasPayerError, UnderfundedSlotError} from '../errors.js'
import {combineBn254, verifyBn254, type Bn254Partial} from '../crypto/bn254.js'
import {bytesToHex, hexToBytes} from '../crypto/hex.js'
import type {PrepaidDeployment} from './prepaid.js'

/** An allowance's on-chain record (`Settlement.prepaidAllowance`) at one canonical block. */
export interface PrepaidAllowanceState {
  /** Allowance id. */
  allowanceId: Hex
  /** Slot it belongs to (zero when never reserved). */
  slotId: Hex
  /** Immutable roster/epoch pin; zero means "not reserved". */
  assignmentBlock: Hex
  /** Escrow. */
  amount: bigint
  /** Settled debits so far (settle path only; not the off-chain cumulative). */
  spent: bigint
  /** Per-operation cap. */
  maxOpCost: bigint
  /** Expiry, Unix seconds. */
  expiresAt: bigint
  /** Reservation time, Unix seconds. */
  reservedAt: bigint
  /** Funded actions bitmap. */
  actions: number
  /** Closed or escaped. */
  closed: boolean
  /** Canonical block of the read. */
  blockNumber: bigint
  /** Its hash. */
  blockHash: Hex
  /** Its timestamp. */
  blockTimestamp: bigint
}

/** Accountant authorization of one allowance (`AllowanceResponse`); a signature is not a mined allowance. */
export interface PrepaidAllowanceQuote {
  /** Slot. */
  slot: Hex
  /** Derived allowance id. */
  allowance_id: Hex
  /** The creator intent's EIP-712 hash (`intentHash` argument). */
  intent_hash: Hex
  /** Quote block; also the allowance's assignment block. */
  quote_block: Hex
  /** Reconciled legacy settlement cursor. */
  legacy_nonce: number
  /** Escrow, decimal. */
  amount: string
  /** Per-operation cap, decimal. */
  max_op_cost: string
  /** Funded actions bitmap. */
  actions: number
  /** Expiry, Unix seconds. */
  expires_at: number
  /** Authorization deadline, Unix seconds. */
  deadline: number
  /** Reserve digest. */
  digest: Hex
  /** Threshold BN254 signature after `authorize`, null after `prepare`. */
  signature: Hex | null
  /** Always false. */
  mined: false
}

/** Immutable identity of one allowance reservation transaction, retained before broadcast. */
export interface PrepaidAllowanceReservationRecord {
  /** Record format. */
  schema: 1
  /** Derived allowance id; the durable key. */
  allowanceId: Hex
  /** Creator-signed intent. */
  intent: PrepaidAllowanceIntentWire
  /** Signed accountant quote. */
  quote: PrepaidAllowanceQuote
  /** Exact bounded legacy transaction. */
  transaction: {chainId: number; from: Address; to: Address; data: Hex; value: '0'; nonce: number; gas: string; gasPrice: string}
}

/** Durable checkpoints, as for a per-operation reservation. A timeout after `prepared` needs observation, never a new attempt. */
export type PrepaidAllowanceCheckpoint =
  | {
    /** Persisted before submission. */
    phase: 'prepared'
    /** Exact identity. */
    record: PrepaidAllowanceReservationRecord
    /** Local signer's hash, journaled before broadcast. */
    transactionHash?: Hex
  }
  | {
    /** A hash was returned; mining unproven. */
    phase: 'submitted'
    /** Allowance id. */
    allowanceId: Hex
    /** Hash. */
    transactionHash: Hex
  }
  | {
    /** Mined and canonical. */
    phase: 'confirmed'
    /** Allowance id. */
    allowanceId: Hex
    /** Hash. */
    transactionHash: Hex
    /** Inclusion block. */
    blockHash: Hex
  }

/** Limits and mandatory durable storage for one allowance reservation. */
export interface ReservePrepaidAllowanceOptions {
  /** Independently selected accountant endpoints. */
  accountantUrls: readonly string[]
  /** HTTP only on local chain 43112. */
  allowLocalHttp?: boolean
  /** Maximum gas units. */
  maxGas: bigint
  /** Maximum legacy gas price, wei. */
  maxGasPrice: bigint
  /** Per-accountant timeout, 1..85000 ms (default 85000). */
  requestTimeoutMs?: number
  /** Receipt timeout, 1..120000 ms (default 60000). */
  receiptTimeoutMs?: number
  /** Confirmations, 1..64 (default 1). */
  confirmations?: number
  /** Cancellation: honoured until the `prepared` checkpoint; afterwards it only ends the receipt wait (uncertain). */
  signal?: AbortSignal
  /**
   * Canonical block the intent's verifier epoch was observed at. The first prepare is pinned to
   * it, so a member whose own head is a block older (before the epoch's anchors landed) judges
   * the same anchors; if no member accepts it (stale), the members choose as before.
   */
  quoteBlock?: Hex
  /** Await durable storage. `prepared` must create a unique record keyed by allowance id and survive process loss. */
  persist: (checkpoint: PrepaidAllowanceCheckpoint) => Promise<void>
}

const HEX32 = /^0x[0-9a-f]{64}$/i
const ZERO32 = `0x${'0'.repeat(64)}`
const MAX_BODY = 64 * 1024
/** Quote freshness the accountants enforce (`MAX_QUOTE_AGE`). */
export const ALLOWANCE_QUOTE_MAX_AGE_SECS = 30
/** `PAYMENT_INTENT_MAX_LIFETIME_SECS`: an allowance lives at most one hour. */
export const ALLOWANCE_MAX_LIFETIME_SECS = 3600
const now = () => Math.floor(Date.now() / 1000)
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** An accountant was unreachable or answered 5xx/408/429: another member may still answer. */
class Unavailable extends Error {}

/** A bounded JSON POST to one accountant; non-2xx answers carry their status and a bounded reason. */
async function post(url: string, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<{status: number; json?: unknown; text: string}> {
  const deadline = AbortSignal.timeout(timeoutMs)
  let response: Response
  try {
    response = await fetch(url, {method: 'POST', redirect: 'error', headers: {'content-type': 'application/json'}, body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline})
  } catch (cause) {
    signal?.throwIfAborted()
    throw new Unavailable('accountant transport unavailable', {cause})
  }
  if (!response.body) return {status: response.status, text: ''}
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const {done, value} = await reader.read().catch((cause: unknown) => {
        signal?.throwIfAborted()
        throw new Unavailable('accountant response interrupted', {cause})
      })
      if (done) break
      size += value.length
      if (size > MAX_BODY) throw new Error('accountant response exceeds 64 KiB')
      chunks.push(value)
    }
  } finally {
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  const text = new TextDecoder('utf-8', {fatal: false}).decode(bytes)
  if (!response.ok) return {status: response.status, text: text.slice(0, 256)}
  return {status: response.status, json: JSON.parse(text) as unknown, text: ''}
}
const transient = (status: number) => status >= 500 || status === 408 || status === 429

function checkIntent(intent: PrepaidAllowanceIntentWire, d: PrepaidDeployment): void {
  prepaidAllowanceIntentHash(intent)
  if (typeof intent.signature !== 'string' || !/^0x[0-9a-f]{130}$/i.test(intent.signature)) throw new Error('allowance intent signature must be 65 bytes')
  if (intent.chain_id !== d.chainId || !same(intent.settlement, d.settlement) || !same(intent.key_registry, d.keyRegistry)) throw new Error('allowance intent deployment mismatch')
}
function liveIntent(intent: PrepaidAllowanceIntentWire): void {
  const at = now()
  if (intent.expires_at <= at || intent.expires_at > at + ALLOWANCE_MAX_LIFETIME_SECS) throw new Error('allowance intent is expired or exceeds the one-hour lifetime')
}

/**
 * The allowance id every reader derives from a creator intent.
 * @param intent - Creator intent (signature not part of the preimage).
 */
export function prepaidAllowanceId(intent: Omit<PrepaidAllowanceIntentWire, 'signature'>): Hex {
  return allowanceId(intent.chain_id, intent.settlement, intent.slot, prepaidAllowanceIntentHash(intent))
}

function parseQuote(value: unknown, intent: PrepaidAllowanceIntentWire, d: PrepaidDeployment, signed: boolean): PrepaidAllowanceQuote {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid accountant allowance quote')
  const q = value as Record<string, unknown>
  const fields = ['slot', 'allowance_id', 'intent_hash', 'quote_block', 'legacy_nonce', 'amount', 'max_op_cost', 'actions', 'expires_at', 'deadline', 'digest', 'signature', 'mined']
  if (Object.keys(q).length !== fields.length || fields.some(k => !Object.hasOwn(q, k))) throw new Error('invalid accountant allowance quote fields')
  for (const k of ['slot', 'allowance_id', 'intent_hash', 'quote_block', 'digest']) if (typeof q[k] !== 'string' || !HEX32.test(q[k])) throw new Error('invalid accountant allowance quote hash')
  const intentHash = prepaidAllowanceIntentHash(intent), id = allowanceId(d.chainId, d.settlement, intent.slot, intentHash)
  if (!same(q.slot as string, intent.slot) || !same(q.intent_hash as string, intentHash) || !same(q.allowance_id as string, id)
    || same(q.quote_block as string, ZERO32) || q.mined !== false || q.amount !== intent.amount || q.max_op_cost !== intent.max_op_cost
    || q.actions !== intent.actions || q.expires_at !== intent.expires_at || !Number.isSafeInteger(q.legacy_nonce) || (q.legacy_nonce as number) < 0
    || !Number.isSafeInteger(q.deadline) || (q.deadline as number) <= 0 || (q.deadline as number) >= intent.expires_at) throw new Error('accountant allowance quote does not match the creator intent')
  if (signed ? typeof q.signature !== 'string' || !/^0x[0-9a-f]{128}$/i.test(q.signature) || /^0x0{128}$/i.test(q.signature) : q.signature !== null) throw new Error('invalid accountant allowance quote signature')
  const quote = q as unknown as PrepaidAllowanceQuote
  const digest = allowanceReserveDigest(d.settlement, d.chainId, {slot: intent.slot, legacyNonce: BigInt(quote.legacy_nonce), allowanceId: id,
    amount: BigInt(intent.amount), maxOpCost: BigInt(intent.max_op_cost), actions: intent.actions, expiresAt: BigInt(intent.expires_at),
    assignmentBlock: quote.quote_block, deadline: BigInt(quote.deadline)})
  if (!same(quote.digest, digest)) throw new Error('accountant allowance quote digest mismatch')
  return quote
}
const unsignedQuote = (q: PrepaidAllowanceQuote) => JSON.stringify([q.slot.toLowerCase(), q.allowance_id.toLowerCase(), q.quote_block.toLowerCase(), q.legacy_nonce, q.deadline, q.digest.toLowerCase()])

async function askAllowance(url: string, method: 'prepare' | 'authorize', intent: PrepaidAllowanceIntentWire, block: Hex | null, d: PrepaidDeployment,
  timeout: number, signal?: AbortSignal): Promise<PrepaidAllowanceQuote> {
  const answer = await post(`${url}/v1/prepaid/allowances/${method}`, {intent, quote_block: block}, timeout, signal)
  if (answer.status === 402) throw new UnderfundedSlotError({slotId: intent.slot, status: 402, url, message: 'accountant allowance request refused (402): insufficient available TASRA'})
  if (transient(answer.status)) throw new Unavailable(`accountant allowance request refused (${answer.status}): ${answer.text}`)
  if (answer.json === undefined) throw new Error(`accountant allowance request refused (${answer.status}): ${answer.text}`)
  return parseQuote(answer.json, intent, d, method === 'authorize')
}

/** Prepare at every responsive member at one quote block, then a quorum signature from a prepared one. */
async function collectAllowanceQuote(urls: string[], intent: PrepaidAllowanceIntentWire, d: PrepaidDeployment, timeout: number, signal?: AbortSignal, pin?: Hex) {
  let seed: {quote: PrepaidAllowanceQuote; index: number} | undefined, last: Error | undefined
  // Pinned first (the observed block), then unpinned: every member still verifies the block itself.
  for (const block of pin ? [pin, null] : [null]) {
    for (const [index, url] of urls.entries()) {
      try { seed = {quote: await askAllowance(url, 'prepare', intent, block, d, timeout, signal), index}; break }
      catch (error) { if (!(error instanceof Unavailable)) throw error; last = error }
    }
    if (seed) break
  }
  if (!seed) throw last ?? new Error('no reachable accountant prepared the allowance')
  const {quote, index} = seed, prepared = [urls[index]!], rest = urls.slice(index + 1)
  const results = await Promise.allSettled(rest.map(url => askAllowance(url, 'prepare', intent, quote.quote_block, d, timeout, signal)))
  for (const [i, result] of results.entries()) {
    if (result.status === 'rejected') { if (!(result.reason instanceof Unavailable)) throw result.reason; continue }
    if (unsignedQuote(result.value) !== unsignedQuote(quote)) throw new Error('accountants disagree on the allowance')
    prepared.push(rest[i]!)
  }
  for (const url of prepared) {
    liveIntent(intent)
    try {
      const authorized = await askAllowance(url, 'authorize', intent, quote.quote_block, d, timeout, signal)
      if (unsignedQuote(authorized) !== unsignedQuote(quote)) throw new Error('authorization changed the prepared allowance')
      return {quote, authorized}
    } catch (error) { if (!(error instanceof Unavailable)) throw error; last = error }
  }
  throw last ?? new Error('no prepared accountant returned a quorum allowance authorization')
}

function reservationArgs(quote: PrepaidAllowanceQuote, intent: PrepaidAllowanceIntentWire) {
  return {slotId: intent.slot, legacyNonce: BigInt(quote.legacy_nonce), intentHash: quote.intent_hash, amount: BigInt(intent.amount),
    maxOpCost: BigInt(intent.max_op_cost), actions: intent.actions, expiresAt: BigInt(intent.expires_at), assignmentBlock: quote.quote_block,
    deadline: BigInt(quote.deadline)} as const
}

/**
 * Read `Settlement.prepaidAllowance(id)` at a canonical block (`blockHash`), or at a fresh head.
 * @param client - Trusted RPC client.
 * @param deployment - Approved deployment.
 * @param id - Allowance id.
 * @param blockHash - Canonical block to read at; a fresh latest head (<= 30 s) when absent.
 */
export async function readPrepaidAllowance(client: PublicClient, deployment: PrepaidDeployment, id: Hex, blockHash?: Hex): Promise<PrepaidAllowanceState> {
  if (!HEX32.test(id) || same(id, ZERO32)) throw new Error('invalid allowance id')
  if (await chainIdOf(client) !== deployment.chainId) throw new Error('allowance RPC chain mismatch')
  const block = blockHash ? await client.getBlock({blockHash}) : await client.getBlock({blockTag: 'latest'})
  if (block.number === null || block.hash === null || (blockHash && !same(block.hash, blockHash))) throw new Error('allowance observation block unavailable')
  if (!blockHash && (BigInt(now()) - block.timestamp > 30n || block.timestamp - BigInt(now()) > 2n)) throw new Error('allowance observation head is stale')
  const data = await pinnedCall(client, block.hash, deployment.settlement, encodeFunctionData({abi: settlementAbi, functionName: 'prepaidAllowance', args: [id]}))
  if (data === undefined) throw new Error('empty prepaidAllowance response')
  const [slotId, assignmentBlock, amount, spent, maxOpCost, expiresAt, reservedAt, actions, closed] = decodeFunctionResult({abi: settlementAbi, functionName: 'prepaidAllowance', data})
  return {allowanceId: id, slotId, assignmentBlock, amount, spent, maxOpCost, expiresAt, reservedAt, actions, closed,
    blockNumber: block.number, blockHash: block.hash, blockTimestamp: block.timestamp}
}

/** Whether the read record is THIS intent's mined allowance. */
function minedAs(state: PrepaidAllowanceState, intent: PrepaidAllowanceIntentWire, quote: PrepaidAllowanceQuote): boolean {
  return same(state.slotId, intent.slot) && same(state.assignmentBlock, quote.quote_block) && state.amount === BigInt(intent.amount)
    && state.maxOpCost === BigInt(intent.max_op_cost) && state.actions === intent.actions && state.expiresAt === BigInt(intent.expires_at)
}

/**
 * Reserve one allowance for a creator-signed intent: quorum quote, one bounded legacy transaction,
 * the durable checkpoints, the receipt and the mined record. Never resubmits or replaces; an
 * outcome unknown after `prepared` is {@link PaidReservationUncertainError} (its `requestId` is the
 * allowance id).
 * @param client - Trusted RPC client; submission retries disabled.
 * @param wallet - Dedicated account-bound gas payer.
 * @param deployment - Approved deployment.
 * @param original - Creator-signed allowance intent.
 * @param options - Endpoints, gas limits and mandatory durable persistence.
 */
export async function reservePrepaidAllowance(client: PublicClient, wallet: WalletClient<Transport, Chain, Account>, deployment: PrepaidDeployment,
  original: PrepaidAllowanceIntentWire, options: ReservePrepaidAllowanceOptions): Promise<{transactionHash: Hex; allowance: PrepaidAllowanceState; quote: PrepaidAllowanceQuote}> {
  const intent = structuredClone(original), d = {...deployment}, opts = {...options, accountantUrls: [...options.accountantUrls]}, signal = opts.signal
  const payer = {...wallet.account}, payerChain = {...wallet.chain}
  checkIntent(intent, d)
  liveIntent(intent)
  if (typeof opts.maxGas !== 'bigint' || typeof opts.maxGasPrice !== 'bigint' || opts.maxGas <= 0n || opts.maxGas >= 1n << 64n || opts.maxGasPrice <= 0n
    || opts.maxGasPrice >= 1n << 128n || typeof opts.persist !== 'function') throw new Error('invalid allowance gas budget or journal')
  const requestTimeout = opts.requestTimeoutMs ?? 85000, receiptTimeout = opts.receiptTimeoutMs ?? 60000, confirmations = opts.confirmations ?? 1
  if (!Number.isSafeInteger(requestTimeout) || requestTimeout < 1 || requestTimeout > 85000 || !Number.isSafeInteger(receiptTimeout) || receiptTimeout < 1
    || receiptTimeout > 120000 || !Number.isSafeInteger(confirmations) || confirmations < 1 || confirmations > 64) throw new Error('invalid allowance timeout or confirmations')
  if (opts.quoteBlock !== undefined && (typeof opts.quoteBlock !== 'string' || !HEX32.test(opts.quoteBlock) || same(opts.quoteBlock, ZERO32))) throw new Error('invalid allowance quote block')
  const id = prepaidAllowanceId(intent)
  signal?.throwIfAborted()
  const urls = accountantEndpoints(opts, d.chainId)
  if (payer.type !== 'local' && payer.type !== 'json-rpc') throw new Error('allowance reservation requires an EOA gas payer')
  if (payerChain.id !== d.chainId || await chainIdOf(wallet) !== d.chainId || await chainIdOf(client) !== d.chainId) throw new Error('allowance RPC/wallet chain mismatch')
  const {quote, authorized} = await collectAllowanceQuote(urls, intent, d, requestTimeout, signal, opts.quoteBlock)
  const args = reservationArgs(quote, intent)
  const data = encodeFunctionData({abi: settlementAbi, functionName: 'reservePrepaidAllowanceBls', args: [args, authorized.signature!]})
  const block = await client.getBlock({blockHash: quote.quote_block})
  const fresh = () => {
    if (block.number === null || block.hash === null || !same(block.hash, quote.quote_block)
      || BigInt(now()) - block.timestamp > BigInt(ALLOWANCE_QUOTE_MAX_AGE_SECS) || block.timestamp - BigInt(now()) > 2n) throw new Error('allowance quote block is stale or invalid')
    liveIntent(intent)
    if (quote.deadline <= now()) throw new Error('allowance authorization deadline passed')
  }
  fresh()
  const at = (to: Address, callData: Hex) => client.call({to, data: callData, account: payer, blockHash: quote.quote_block, requireCanonical: true, batch: false})
  // The simulation verifies the quorum signature and the contract's own checks without gas.
  const [existingRead, slotRead, , fees] = await Promise.all([
    at(d.settlement, encodeFunctionData({abi: settlementAbi, functionName: 'prepaidAllowance', args: [id]})),
    at(d.keyRegistry, encodeFunctionData({abi: keyRegistryAbi, functionName: 'getKeySlot', args: [intent.slot]})),
    at(d.settlement, data),
    Promise.all([client.getGasPrice(), client.estimateGas({account: payer.address, to: d.settlement, data, value: 0n, gasPrice: 0n, type: 'legacy'}),
      client.getTransactionCount({address: payer.address, blockTag: 'pending'}), client.getBalance({address: payer.address, blockTag: 'pending'})]),
  ])
  if (existingRead.data === undefined || slotRead.data === undefined) throw new Error('empty allowance reservation observation')
  const existing = decodeFunctionResult({abi: settlementAbi, functionName: 'prepaidAllowance', data: existingRead.data})
  if (!same(existing[1], ZERO32)) throw new Error('allowance already reserved; read it instead of spending again')
  const slot = decodeFunctionResult({abi: keyRegistryAbi, functionName: 'getKeySlot', data: slotRead.data})
  const creator = await recoverTypedDataAddress({...prepaidAllowanceIntentTypedData(intent), signature: intent.signature})
  if (!slot.exists || slot.cancelled || (slot.expiry !== 0n && slot.expiry <= BigInt(now())) || !same(creator, slot.creator)) throw new Error('allowance intent is not from an active slot creator')
  const [gasPrice, gas, nonce, balance] = fees
  if (gas <= 0n || gas > opts.maxGas || gasPrice <= 0n || gasPrice > opts.maxGasPrice) throw new Error('allowance reservation exceeds native gas budget')
  if (balance < gas * gasPrice) throw new UnderfundedGasPayerError({payer: payer.address, availableNativeUnits: balance, requiredNativeUnits: gas * gasPrice})
  signal?.throwIfAborted()
  if (block.number === null) throw new Error('allowance quote has no block number')
  const canonical = await client.getBlock({blockNumber: block.number})
  if (canonical.hash === null || !same(canonical.hash, quote.quote_block)) throw new Error('allowance quote reorganized')
  fresh()
  const record: PrepaidAllowanceReservationRecord = {schema: 1, allowanceId: id, intent, quote: authorized,
    transaction: {chainId: d.chainId, from: payer.address, to: d.settlement, data, value: '0', nonce, gas: gas.toString(), gasPrice: gasPrice.toString()}}
  let raw: Awaited<ReturnType<typeof wallet.signTransaction>> | undefined, transactionHash: Hex | undefined
  if (payer.type === 'local') {
    raw = await wallet.signTransaction({account: payer, chain: payerChain, to: d.settlement, data, value: 0n, nonce, gas, gasPrice, type: 'legacy'})
    const signed = parseTransaction(raw), sender = await recoverTransactionAddress({serializedTransaction: raw})
    if (signed.type !== 'legacy' || signed.chainId !== d.chainId || !same(sender, payer.address) || !signed.to || !same(signed.to, d.settlement)
      || !signed.data || !same(signed.data, data) || (signed.value ?? 0n) !== 0n || signed.nonce !== nonce || signed.gas !== gas || signed.gasPrice !== gasPrice) throw new Error('signed transaction differs from the durable allowance reservation')
    transactionHash = keccak256(raw)
    fresh()
  }
  signal?.throwIfAborted()
  await opts.persist({phase: 'prepared', record: structuredClone(record), ...(transactionHash ? {transactionHash} : {})})
  try {
    fresh()
    if (raw !== undefined) {
      const returned = await wallet.request({method: 'eth_sendRawTransaction', params: [raw]}, {retryCount: 0})
      if (returned === undefined || transactionHash === undefined || !same(returned, transactionHash)) throw new Error('RPC returned another signed transaction hash')
    } else {
      transactionHash = await wallet.request({method: 'eth_sendTransaction', params: [{from: payer.address, to: d.settlement, data, value: '0x0', nonce: toHex(nonce),
        gas: toHex(gas), gasPrice: toHex(gasPrice), type: '0x0', chainId: toHex(d.chainId)}]}, {retryCount: 0})
    }
    if (typeof transactionHash !== 'string' || !HEX32.test(transactionHash) || same(transactionHash, ZERO32)) throw new Error('invalid allowance transaction hash')
    await opts.persist({phase: 'submitted', allowanceId: id, transactionHash})
    const sent = transactionHash
    const mined = await untilAborted(pollTransactionReceipt(client, sent, {confirmations, timeoutMs: receiptTimeout, signal}), signal)
    if (!same(mined.transactionHash, sent) || mined.status !== 'success') throw new Error('allowance transaction reverted or was replaced')
    const [transaction, allowance, minedBlock] = await untilAborted(Promise.all([client.getTransaction({hash: sent}),
      readPrepaidAllowance(client, d, id, mined.blockHash), client.getBlock({blockNumber: mined.blockNumber})]), signal)
    if (transaction.to === null || !same(transaction.to, d.settlement) || !same(transaction.from, record.transaction.from) || !same(transaction.input, data)
      || transaction.value !== 0n || transaction.nonce !== nonce || transaction.type !== 'legacy' || transaction.gas !== gas || transaction.gasPrice !== gasPrice
      || transaction.chainId !== d.chainId || transaction.blockHash === null || !same(transaction.blockHash, mined.blockHash)) throw new Error('mined transaction differs from the durable allowance reservation')
    if (!minedAs(allowance, intent, quote) || allowance.closed) throw new Error('mined allowance differs from the signed intent and quote')
    if (minedBlock.hash === null || !same(minedBlock.hash, mined.blockHash)) throw new Error('allowance receipt reorganized')
    await opts.persist({phase: 'confirmed', allowanceId: id, transactionHash: sent, blockHash: mined.blockHash})
    return {transactionHash: sent, allowance, quote: authorized}
  } catch (cause) { throw new PaidReservationUncertainError(id, transactionHash, cause) }
}

/**
 * Whether a prepared allowance reservation is mined as signed, read at a fresh head. `reserved`
 * proves it; `not-reserved` is final only once a canonical block is past the quote deadline
 * (the contract refuses the signed quote from then on); otherwise `uncertain`.
 * @param client - Trusted RPC client.
 * @param deployment - Approved deployment.
 * @param record - The durable `prepared` record.
 */
export async function reconcilePrepaidAllowance(client: PublicClient, deployment: PrepaidDeployment, record: PrepaidAllowanceReservationRecord):
  Promise<{state: 'reserved' | 'not-reserved' | 'uncertain'; allowance: PrepaidAllowanceState}> {
  checkIntent(record.intent, deployment)
  if (!same(record.allowanceId, prepaidAllowanceId(record.intent))) throw new Error('allowance record identity mismatch')
  parseQuote(record.quote, record.intent, deployment, true)
  const allowance = await readPrepaidAllowance(client, deployment, record.allowanceId)
  if (!same(allowance.assignmentBlock, ZERO32)) {
    if (!minedAs(allowance, record.intent, record.quote)) throw new Error('mined allowance differs from the saved record')
    return {state: 'reserved', allowance}
  }
  return {state: allowance.blockTimestamp > BigInt(record.quote.deadline) ? 'not-reserved' : 'uncertain', allowance}
}

// ---- Group key and voucher verification ---------------------------------------------------

/** Group keys by quote block hash (state at a block hash is immutable). Bounded, oldest first out. */
const MAX_GROUP_KEYS = 64
const groupKeys = new WeakMap<PublicClient, Map<string, Promise<Uint8Array>>>()

/**
 * `beacon.mpk()` at a canonical block, via `Settlement.beacon()` read at the same block.
 * @param client - Trusted RPC client.
 * @param deployment - Approved deployment (with the approved beacon, when known).
 * @param blockHash - Quote block.
 */
export function readAccountantGroupKey(client: PublicClient, deployment: PrepaidDeployment & {beacon?: Address}, blockHash: Hex): Promise<Uint8Array> {
  if (!HEX32.test(blockHash) || same(blockHash, ZERO32)) return Promise.reject(new Error('group key read needs a block'))
  let cache = groupKeys.get(client)
  if (!cache) groupKeys.set(client, cache = new Map<string, Promise<Uint8Array>>())
  const key = `${deployment.settlement.toLowerCase()}:${blockHash.toLowerCase()}`
  const hit = cache.get(key)
  if (hit) return hit
  const read = (async () => {
    const beaconData = await pinnedCall(client, blockHash, deployment.settlement, encodeFunctionData({abi: settlementAbi, functionName: 'beacon'}))
    if (beaconData === undefined) throw new Error('empty Settlement.beacon response')
    const beacon = decodeFunctionResult({abi: settlementAbi, functionName: 'beacon', data: beaconData})
    if (deployment.beacon && !same(beacon, deployment.beacon)) throw new Error('Settlement names another beacon than the approved one')
    const mpkData = await pinnedCall(client, blockHash, beacon, encodeFunctionData({abi: thresholdRandomBeaconAbi, functionName: 'mpk'}))
    if (mpkData === undefined) throw new Error('empty beacon.mpk response')
    const mpk = hexToBytes(decodeFunctionResult({abi: thresholdRandomBeaconAbi, functionName: 'mpk', data: mpkData}))
    if (mpk.length !== 128 || mpk.every(b => b === 0)) throw new Error('accountant group key is not set at the quote block')
    return mpk
  })()
  if (cache.size >= MAX_GROUP_KEYS) cache.delete(cache.keys().next().value!)
  cache.set(key, read)
  read.catch(() => { if (cache.get(key) === read) cache.delete(key) })
  return read
}

/** Verified voucher signatures (digest + signature + key), bounded. */
const MAX_VERIFIED_VOUCHERS = 1024
const verifiedVouchers = new Set<string>()

/**
 * Verify a debit voucher's shape and its threshold signature against `beacon.mpk()` at its quote block.
 * @param client - Trusted RPC client.
 * @param deployment - Approved deployment.
 * @param voucher - Untrusted voucher.
 */
export async function verifyDebitVoucher(client: PublicClient, deployment: PrepaidDeployment & {beacon?: Address}, voucher: DebitVoucherWire): Promise<void> {
  assertDebitVoucherWire(voucher)
  const digest = debitVoucherDigest(deployment.settlement, deployment.chainId, {allowanceId: voucher.allowance_id, seq: BigInt(voucher.seq),
    requestId: voucher.request_id, cost: BigInt(voucher.cost), cumulative: BigInt(voucher.cumulative), quoteBlock: voucher.quote_block})
  const mpk = await readAccountantGroupKey(client, deployment, voucher.quote_block)
  const key = `${digest}:${voucher.signature.toLowerCase()}:${bytesToHex(mpk)}`
  if (verifiedVouchers.has(key)) return
  if (!verifyBn254(mpk, hexToBytes(digest), hexToBytes(voucher.signature))) throw new Error('debit voucher signature does not verify against the accountant group key')
  if (verifiedVouchers.size >= MAX_VERIFIED_VOUCHERS) verifiedVouchers.delete(verifiedVouchers.values().next().value!)
  verifiedVouchers.add(key)
}

// ---- Debit voucher round ------------------------------------------------------------------

/** One member's answer to `POST /v1/prepaid/allowances/{id}/debits` (`DebitPartialResponse`). */
export interface DebitPartialWire {
  /** Allowance. */
  allowance_id: Hex
  /** Sequence. */
  seq: number
  /** Request. */
  request_id: Hex
  /** Cost at the quote block, decimal. */
  cost: string
  /** Total through seq, decimal. */
  cumulative: string
  /** Quote block. */
  quote_block: Hex
  /** Digest the partial is over. */
  digest: Hex
  /** Member identifier. */
  identifier: number
  /** 64-byte partial. */
  partial: Hex
  /** 128-byte verifying share. */
  verifying_share: Hex
  /** The sharing the partial belongs to. */
  sharing: Hex
  /** k. */
  threshold: number
  /** n. */
  members: number
}

/** One debit request: the same body is sent to every member. */
export interface DebitRequest {
  /** Creator-signed allowance payment WITHOUT a voucher. */
  payment: PaymentIntentWire
  /** Sequence (1 without a previous voucher). */
  seq: number
  /** Quorum voucher of `seq - 1`. */
  previous?: DebitVoucherWire
  /** The quote block every member reads at (fixed by the caller and journaled before the round). */
  quoteBlock: Hex
  /** The allowance's per-operation cap, from its mined record. */
  maxOpCost: bigint
}

/** How one member answered a debit round. */
export type DebitMemberOutcome =
  | {
    /** Endpoint. */
    url: string
    /** A verified partial. */
    kind: 'partial'
    /** The partial. */
    partial: DebitPartialWire
  }
  | {
    /** Endpoint. */
    url: string
    /** Transport loss, 5xx, 408 or 429: the member may have journaled the debit. */
    kind: 'unavailable'
    /** Safe reason. */
    reason: string
  }
  | {
    /** Endpoint. */
    url: string
    /** A definite refusal (another 4xx) or an invalid answer. */
    kind: 'refused'
    /** HTTP status (0 = invalid answer). */
    status: number
    /** Safe reason. */
    reason: string
  }

/** A voucher round ended without `k` verified partials. */
export class DebitVoucherError extends Error {
  /** Stable reason. */
  readonly code = 'debit-voucher-unavailable' as const
  constructor(/** Every member's outcome. */ readonly outcomes: DebitMemberOutcome[], /** Partials obtained. */ readonly partials: number,
    /** Threshold, when any member named it. */ readonly threshold: number | undefined) {
    super(`debit voucher round got ${partials} verified partial(s)${threshold ? ` of ${threshold}` : ''}`)
    this.name = 'DebitVoucherError'
  }
  /** True when no member is unavailable: every member that did not sign definitely refused. */
  get definite(): boolean { return this.outcomes.every(o => o.kind !== 'unavailable') }
  /** True when any member signed this seq for this request (it is then bound to it at those members). */
  get claimed(): boolean { return this.partials > 0 }
}

function expectedCumulative(request: DebitRequest, cost: bigint): bigint {
  return request.previous ? BigInt(request.previous.cumulative) + cost : cost
}

function checkPartial(value: unknown, request: DebitRequest, d: PrepaidDeployment, requestId: Hex): DebitPartialWire {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid debit partial')
  const p = value as Record<string, unknown>
  const fields = ['allowance_id', 'seq', 'request_id', 'cost', 'cumulative', 'quote_block', 'digest', 'identifier', 'partial', 'verifying_share', 'sharing', 'threshold', 'members']
  if (Object.keys(p).length !== fields.length || fields.some(k => !Object.hasOwn(p, k))) throw new Error('invalid debit partial fields')
  const w = p as unknown as DebitPartialWire
  for (const k of ['allowance_id', 'request_id', 'quote_block', 'digest', 'sharing'] as const) if (typeof w[k] !== 'string' || !HEX32.test(w[k])) throw new Error('invalid debit partial hash')
  if (typeof w.partial !== 'string' || !/^0x[0-9a-f]{128}$/i.test(w.partial) || typeof w.verifying_share !== 'string' || !/^0x[0-9a-f]{256}$/i.test(w.verifying_share)) throw new Error('invalid debit partial encoding')
  if (typeof w.cost !== 'string' || !/^[0-9]{1,78}$/.test(w.cost) || typeof w.cumulative !== 'string' || !/^[0-9]{1,78}$/.test(w.cumulative)) throw new Error('invalid debit partial amounts')
  if (!Number.isSafeInteger(w.identifier) || w.identifier < 1 || w.identifier > 65535 || !Number.isSafeInteger(w.threshold) || !Number.isSafeInteger(w.members)
    || w.threshold < 1 || w.members < w.threshold || w.members > 65535 || 2 * w.threshold <= w.members) throw new Error('invalid debit partial sharing (voucher signing requires 2k > n)')
  const cost = BigInt(w.cost)
  if (!same(w.allowance_id, request.payment.allowance_id!) || w.seq !== request.seq || !same(w.request_id, requestId) || !same(w.quote_block, request.quoteBlock)
    || cost <= 0n || cost > BigInt(request.payment.max_cost) || cost > request.maxOpCost || BigInt(w.cumulative) !== expectedCumulative(request, cost)) throw new Error('debit partial does not match the request')
  const digest = debitVoucherDigest(d.settlement, d.chainId, {allowanceId: w.allowance_id, seq: BigInt(w.seq), requestId, cost, cumulative: BigInt(w.cumulative), quoteBlock: w.quote_block})
  if (!same(w.digest, digest)) throw new Error('debit partial digest mismatch')
  if (!verifyBn254(hexToBytes(w.verifying_share), hexToBytes(digest), hexToBytes(w.partial))) throw new Error(`partial of member ${w.identifier} does not verify against its share`)
  return w
}

/** Options for {@link collectDebitVoucher}. */
export interface CollectDebitVoucherOptions {
  /** Approved accountant endpoints (all are asked). */
  accountantUrls: readonly string[]
  /** HTTP only on local chain 43112. */
  allowLocalHttp?: boolean
  /** Per-member timeout, 1..60000 ms (default 15000). */
  requestTimeoutMs?: number
  /** Cancellation. An abort after the round started may leave partials journaled at members. */
  signal?: AbortSignal
  /** Partials already verified for this exact request (a resumed round only asks the others). */
  known?: readonly DebitPartialWire[]
}

/**
 * Obtain one debit voucher: the same request to every accountant in parallel, each partial checked
 * against its verifying share and the request, `k` of one sharing combined, the aggregate verified
 * against `beacon.mpk()` at the quote block. Throws {@link DebitVoucherError} without `k`.
 * @param client - Trusted RPC client (group key read).
 * @param deployment - Approved deployment (with the approved beacon, when known).
 * @param request - Payment, sequence, previous voucher, journaled quote block and the allowance cap.
 * @param options - Endpoints, timeout, cancellation and already-known partials.
 */
export async function collectDebitVoucher(client: PublicClient, deployment: PrepaidDeployment & {beacon?: Address}, request: DebitRequest,
  options: CollectDebitVoucherOptions): Promise<{voucher: DebitVoucherWire; partials: DebitPartialWire[]; outcomes: DebitMemberOutcome[]}> {
  const d = {...deployment}, payment = structuredClone(request.payment)
  assertPaymentIntentWire(payment)
  if (payment.allowance_id === undefined || payment.debit_voucher !== undefined) throw new Error('a debit request carries an allowance payment without a voucher')
  if (payment.chain_id !== d.chainId || !same(payment.settlement, d.settlement) || !same(payment.key_registry, d.keyRegistry)) throw new Error('debit payment deployment mismatch')
  if (!Number.isSafeInteger(request.seq) || request.seq < 1 || (request.seq === 1) !== (request.previous === undefined)) throw new Error('seq must be 1 without a previous voucher, previous.seq + 1 with one')
  if (request.previous) {
    assertDebitVoucherWire(request.previous)
    if (request.previous.seq + 1 !== request.seq || !same(request.previous.allowance_id, payment.allowance_id)) throw new Error('previous voucher does not precede this debit')
  }
  if (!HEX32.test(request.quoteBlock) || same(request.quoteBlock, ZERO32)) throw new Error('debit round needs its journaled quote block')
  const timeout = options.requestTimeoutMs ?? 15_000
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000) throw new Error('invalid debit request timeout')
  const urls = accountantEndpoints(options, d.chainId), requestId = prepaidRequestId(payment)
  const body = {intent: payment, seq: request.seq, previous: request.previous ?? null, quote_block: request.quoteBlock}
  const known = new Map<number, DebitPartialWire>()
  for (const p of options.known ?? []) { const checked = checkPartial(p, request, d, requestId); known.set(checked.identifier, checked) }
  const outcomes: DebitMemberOutcome[] = await Promise.all(urls.map(async (url): Promise<DebitMemberOutcome> => {
    try {
      const answer = await post(`${url}/v1/prepaid/allowances/${payment.allowance_id}/debits`, body, timeout, options.signal)
      if (answer.json === undefined) return transient(answer.status) ? {url, kind: 'unavailable', reason: `(${answer.status}) ${answer.text}`}
        : {url, kind: 'refused', status: answer.status, reason: answer.text}
      return {url, kind: 'partial', partial: checkPartial(answer.json, request, d, requestId)}
    } catch (error) {
      options.signal?.throwIfAborted()
      if (error instanceof Unavailable) return {url, kind: 'unavailable', reason: error.message}
      return {url, kind: 'refused', status: 0, reason: error instanceof Error ? error.message.slice(0, 256) : 'invalid answer'}
    }
  }))
  for (const o of outcomes) if (o.kind === 'partial' && !known.has(o.partial.identifier)) known.set(o.partial.identifier, o.partial)
  // Partials of one sharing only: a reshare between members' answers must never mix.
  const bySharing = new Map<string, DebitPartialWire[]>()
  for (const p of known.values()) bySharing.set(`${p.sharing.toLowerCase()}:${p.threshold}:${p.members}:${p.cost}`, [...bySharing.get(`${p.sharing.toLowerCase()}:${p.threshold}:${p.members}:${p.cost}`) ?? [], p])
  const group = [...bySharing.values()].sort((a, b) => b.length - a.length)[0] ?? []
  const threshold = group[0]?.threshold
  if (!threshold || group.length < threshold) throw new DebitVoucherError(outcomes, known.size, threshold)
  const first = group[0]!, digest = hexToBytes(first.digest)
  const mpk = await readAccountantGroupKey(client, d, request.quoteBlock)
  const sorted = [...group].sort((a, b) => a.identifier - b.identifier)
  const toPartial = (p: DebitPartialWire): Bn254Partial => ({identifier: p.identifier, partial: hexToBytes(p.partial), verifyingShare: hexToBytes(p.verifying_share)})
  // A member's verifying share is self-reported: a lying member can only make ITS subset fail the
  // aggregate check, so try a bounded number of k-subsets before giving up.
  let signature: Uint8Array | undefined
  for (const subset of subsets(sorted.length, threshold, 16)) {
    try { signature = combineBn254(mpk, digest, subset.map(i => toPartial(sorted[i]!)), threshold); break } catch { /* next subset */ }
  }
  if (!signature) throw new DebitVoucherError(outcomes, known.size, threshold)
  const voucher: DebitVoucherWire = {allowance_id: first.allowance_id, seq: first.seq, request_id: first.request_id, cost: first.cost,
    cumulative: first.cumulative, quote_block: first.quote_block, signature: bytesToHex(signature) as Hex}
  assertDebitVoucherWire(voucher)
  return {voucher, partials: sorted, outcomes}
}

/** Up to `limit` k-subsets of 0..n-1 in lexicographic order. */
function* subsets(n: number, k: number, limit: number): Generator<number[]> {
  const index = Array.from({length: k}, (_, i) => i)
  for (let produced = 0; produced < limit; produced++) {
    yield [...index]
    let i = k - 1
    while (i >= 0 && index[i] === n - k + i) i--
    if (i < 0) return
    index[i]!++
    for (let j = i + 1; j < k; j++) index[j] = index[j - 1]! + 1
  }
}

// ---- Voucher push --------------------------------------------------------------------------

/** One member's answer to `POST /v1/prepaid/allowances/{id}/vouchers`. */
export type VoucherPushOutcome =
  | {
    /** Endpoint. */
    url: string
    /** The member verified the voucher against the group key and journaled it (`recorded`: unchanged, attached or observed). */
    kind: 'accepted'
    /** The member's decision. */
    recorded: string
  }
  | {
    /** Endpoint. */
    url: string
    /** Transport loss, timeout, a non-2xx answer or an invalid answer. */
    kind: 'failed'
    /** HTTP status (0 = transport or invalid answer). */
    status: number
    /** Safe reason. */
    reason: string
  }

/** Options for {@link pushDebitVoucher}. */
export interface PushDebitVoucherOptions {
  /** Accountant endpoints to push to. */
  accountantUrls: readonly string[]
  /** HTTP only on local chain 43112. */
  allowLocalHttp?: boolean
  /** Per-member timeout, 1..60000 ms (default 10000). */
  requestTimeoutMs?: number
  /** Members pushed at once, 1..32 (default 4). */
  concurrency?: number
}

/**
 * Push an aggregated debit voucher to accountant members (`POST /v1/prepaid/allowances/{id}/vouchers`).
 * A member learns a seq's aggregate from the next debit's `previous`; the last seq of a lane is
 * never anyone's `previous`, so this is how members that will never see it as `previous` learn it.
 * Each member verifies it against the group key at its quote block; the push is idempotent.
 * Never rejects for a member failure: every member's answer is returned as an outcome.
 * @param chainId - Deployment chain (endpoint transport policy).
 * @param voucher - A verified aggregated voucher.
 * @param options - Endpoints, timeout and concurrency.
 */
export async function pushDebitVoucher(chainId: number, voucher: DebitVoucherWire, options: PushDebitVoucherOptions): Promise<VoucherPushOutcome[]> {
  assertDebitVoucherWire(voucher)
  const timeout = options.requestTimeoutMs ?? 10_000, concurrency = options.concurrency ?? 4
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000) throw new Error('invalid voucher push timeout')
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new Error('invalid voucher push concurrency')
  const urls = accountantEndpoints(options, chainId)
  // Exactly the DebitVoucher wire fields: the member's body is deny_unknown_fields.
  const body = {allowance_id: voucher.allowance_id, seq: voucher.seq, request_id: voucher.request_id, cost: voucher.cost,
    cumulative: voucher.cumulative, quote_block: voucher.quote_block, signature: voucher.signature}
  const outcomes = new Array<VoucherPushOutcome>(urls.length)
  let next = 0
  const worker = async () => {
    for (let i = next++; i < urls.length; i = next++) {
      const url = urls[i]!
      try {
        const answer = await post(`${url}/v1/prepaid/allowances/${voucher.allowance_id}/vouchers`, body, timeout)
        const json = answer.json as {seq?: unknown; recorded?: unknown} | undefined
        if (json === undefined) outcomes[i] = {url, kind: 'failed', status: answer.status, reason: answer.text}
        else if (!json || typeof json !== 'object' || json.seq !== voucher.seq || typeof json.recorded !== 'string' || !['unchanged', 'attached', 'observed'].includes(json.recorded)) {
          outcomes[i] = {url, kind: 'failed', status: 0, reason: 'invalid voucher push answer'}
        } else outcomes[i] = {url, kind: 'accepted', recorded: json.recorded}
      } catch (error) {
        outcomes[i] = {url, kind: 'failed', status: 0, reason: error instanceof Error ? error.message.slice(0, 256) : 'voucher push failed'}
      }
    }
  }
  await Promise.all(Array.from({length: Math.min(concurrency, urls.length)}, worker))
  return outcomes
}
