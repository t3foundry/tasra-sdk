import {decodeFunctionResult, encodeAbiParameters, encodeFunctionData, keccak256, parseTransaction, recoverTransactionAddress, recoverTypedDataAddress, toHex, type Account, type Address, type Chain, type Hex, type PublicClient, type Transport, type WalletClient} from 'viem'
import {assertPaymentIntentWire, paymentIntentTypedData, prepaidRequestId, type PaymentIntentWire} from '../committee/payment.js'
import {settlementAbi} from './abis/settlement.js'
import {keyRegistryAbi} from './abis/keyRegistry.js'
import {readPaidOperationReceipt, type ExpectedPaidOperation, type PaidOperationReceipt, type PrepaidDeployment} from './prepaid.js'
import {PaidBackoffError, PaidReservationQuotaError, UnderfundedSlotError, UnderfundedGasPayerError} from '../errors.js'
import {PaidBackoff, paidServerWaitMs, systemPacingClock, type PaidPacingClock} from './paidPacing.js'
import {chainIdOf} from './chainId.js'
import {pollTransactionReceipt} from './receipt.js'
import {headFollowerOf} from './headFollower.js'

/** Accountant authorization for a single operation. This is not a mined reservation. */
export interface PaidReservationQuote {
  /** Slot being funded. */
  slot: Hex
  /** Canonical block fixing the original operator assignment. */
  quote_block: Hex
  /** Locally derived operation ID; exactly one entry. */
  request_ids: Hex[]
  /** TASRA base-unit quote; exactly one entry. */
  costs: string[]
  /** Reconciled legacy settlement cursor. */
  legacy_nonce: number
  /** Authorization expiry in Unix seconds. */
  deadline: number
  /** Deployment-bound reservation digest. */
  digest: Hex
  /** Threshold BN254 signature, absent from an unsigned preparation. */
  signature: Hex | null
  /** Always false: accountant authorization does not establish mining. */
  mined: false
}

/** Immutable transaction identity retained before any broadcast; JSON serializable. */
export interface PaidReservationRecord {
  /** Record format. */
  schema: 1
  /** Locally derived key used by durable storage to refuse duplicate attempts. */
  requestId: Hex
  /** Creator's fixed intent, needed for recovery and the credential session. */
  payment: PaymentIntentWire
  /** Signed accountant quote. */
  quote: PaidReservationQuote
  /** Exact bounded transaction; decimal strings preserve integer precision in storage. */
  transaction: {chainId: number; from: Address; to: Address; data: Hex; value: '0'; nonce: number; gas: string; gasPrice: string}
}

/** Durable write checkpoints. A timeout after preparation requires observation, never a new attempt. */
export type PaidReservationCheckpoint =
  | {
    /** Persisted before any transaction submission. */
    phase: 'prepared'
    /** Exact operation and transaction identity; create exclusively by requestId. */
    record: PaidReservationRecord
    /**
     * Hash of the locally signed transaction, journaled BEFORE it is broadcast so a crash
     * between broadcast and the `submitted` checkpoint still leaves the hash to reconcile.
     * Absent for a JSON-RPC (remote) signer, whose hash is only known after submission.
     */
    transactionHash?: Hex
  }
  | {
    /** A transaction hash was returned; mining is still unproven. */
    phase: 'submitted'
    /** Key of the existing durable preparation. */
    requestId: Hex
    /** Returned transaction hash, retained for recovery. */
    transactionHash: Hex
  }
  | {
    /** The transaction and reservation were observed on the canonical chain. */
    phase: 'confirmed'
    /** Key of the existing durable preparation. */
    requestId: Hex
    /** Verified reservation transaction hash. */
    transactionHash: Hex
    /** Canonical block containing the transaction. */
    blockHash: Hex
  }

/** Explicit limits and durable storage for one direct reservation transaction. */
export interface ReservePaidOperationOptions {
  /** Independently selected accountant HTTPS endpoints; responsive members must agree on one quote. */
  accountantUrls: readonly string[]
  /** Permit HTTP only on local chain43112; never on Fuji. */
  allowLocalHttp?: boolean
  /** Maximum transaction gas units. */
  maxGas: bigint
  /** Maximum native gas price in wei; separate from the payment's TASRA cap. */
  maxGasPrice: bigint
  /** Per-accountant request timeout, 1..85000 ms (default 85000). */
  requestTimeoutMs?: number
  /** Receipt timeout, 1..120000 ms (default 60000). */
  receiptTimeoutMs?: number
  /** Required confirmations, 1..64 (default 1). */
  confirmations?: number
  /**
   * Optional cancellation. Before the durable `prepared` checkpoint (nothing sent) an abort
   * refuses with {@link PaidReservationAbortedError}. From that checkpoint the one broadcast
   * proceeds and every journal write completes; an abort then only ends the receipt wait, as
   * {@link PaidReservationUncertainError}: a broadcast transaction cannot be cancelled.
   */
  signal?: AbortSignal
  /**
   * Await durable storage before resolving. The prepared checkpoint MUST atomically create a
   * unique requestId record, refuse every existing record, and survive process loss. Retain
   * it on every later failure. Subsequent checkpoints update that record without deleting it.
   * A callback failure before preparation completes prevents broadcast. The SDK cannot prove
   * an application's persistence guarantees; an in-memory callback is not safe for production.
   */
  persist: (checkpoint: PaidReservationCheckpoint) => Promise<void>
  /**
   * Time source for bounded quote collection and the reservation-quota wait (a `prepare` answered 429 with a valid
   * `Retry-After` / `x-ratelimit-after` is repeated identically within min(150 s, half the payment's
   * remaining lifetime)); wall-clock ms. Default: the system clock. Inject one in tests.
   */
  clock?: PaidPacingClock
}

/** The caller aborted before anything was prepared or broadcast; nothing was sent or journaled. Reserving again is safe. */
export class PaidReservationAbortedError extends Error {
  /** Stable machine-readable reason. */
  readonly code = 'aborted' as const
  /** Request ID that was not reserved. */
  readonly requestId: Hex
  constructor(requestId: Hex, cause: unknown) {
    super('reservation aborted before preparation; nothing was sent', {cause})
    this.name = 'PaidReservationAbortedError'
    this.requestId = requestId
  }
}

/** Reservation submission may have happened; inspect the saved identity before further spending. */
export class PaidReservationUncertainError extends Error {
  /** Stable machine-readable reason. */
  readonly code = 'reservation-uncertain' as const
  /** Original request ID for readPaidOperationReceipt and durable journal lookup. */
  readonly requestId: Hex
  /** Transaction hash when received; absence does not establish that no transaction was sent. */
  readonly transactionHash: Hex | undefined
  constructor(requestId: Hex, transactionHash: Hex | undefined, cause: unknown) {
    super('reservation outcome needs reconciliation; retain the prepared record and do not resubmit', {cause})
    this.name = 'PaidReservationUncertainError'
    this.requestId = requestId
    this.transactionHash = transactionHash
  }
}

/**
 * The accountant's unpinned `prepare` refused the intent because its signed verifier epoch is no
 * longer the beacon's current or previous one at the accountant's own latest block (the reservation
 * waited past an epoch tick). This client sent no transaction, but the intent is NOT dead: an
 * accountant judges the epoch at a client-pinned quote block up to MAX_QUOTE_AGE (30 s) old, and
 * `reservePrepaid*` is permissionless, so whoever holds the intent may still get it reserved until
 * its payment expires. Keep its journal and reconcile it; never replace it with a re-signed intent
 * while it can still land.
 */
export class PaidReservationStaleEpochError extends Error {
  /** Stable machine-readable reason. */
  readonly code = 'stale-verification-epoch' as const
  constructor(readonly verificationEpoch: number) {
    super(`accountant refused verifier epoch ${verificationEpoch} as no longer current or previous; nothing was sent`)
    this.name = 'PaidReservationStaleEpochError'
  }
}

const HEX32 = /^0x[0-9a-f]{64}$/i
const MAX_BODY = 64 * 1024
/** The accountant's fixed 503 reason for an intent epoch outside {latest-1, latest} (assignments.rs). */
const STALE_EPOCH_REASON = 'reservation verifier epoch is not current or previous'
/** Longest 503 reason read; the accountant's reasons are one short line. */
const MAX_REASON = 512
const now = () => Math.floor(Date.now() / 1000)
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
function live(payment: PaymentIntentWire, quote?: PaidReservationQuote): void {
  const at = now()
  if (payment.expires <= at || payment.expires > at + 3600) throw new Error('payment expiry is outside the allowed lifetime')
  if (quote && (quote.deadline <= at || quote.deadline > payment.expires || quote.deadline > at + 120)) throw new Error('reservation quote deadline is expired or outside consent')
}
function parseQuote(value: unknown, payment: PaymentIntentWire, signed: boolean, historical = false): PaidReservationQuote {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid accountant quote')
  const q = value as Record<string, unknown>
  const fields = ['slot', 'quote_block', 'request_ids', 'costs', 'legacy_nonce', 'deadline', 'digest', 'signature', 'mined']
  if (Object.keys(q).length !== fields.length || fields.some(k => !Object.hasOwn(q, k))) throw new Error('invalid accountant quote fields')
  for (const key of ['slot', 'quote_block', 'digest']) if (typeof q[key] !== 'string' || !HEX32.test(q[key])) throw new Error('invalid accountant quote hash')
  if (!same(q.slot as string, payment.slot) || /^0x0{64}$/i.test(q.quote_block as string) || q.mined !== false
    || !Array.isArray(q.request_ids) || q.request_ids.length !== 1 || typeof q.request_ids[0] !== 'string' || !same(q.request_ids[0], prepaidRequestId(payment))
    || !Array.isArray(q.costs) || q.costs.length !== 1 || typeof q.costs[0] !== 'string' || !/^[0-9]{1,78}$/.test(q.costs[0])
    || BigInt(q.costs[0]) <= 0n || BigInt(q.costs[0]) > BigInt(payment.max_cost)
    || !Number.isSafeInteger(q.legacy_nonce) || (q.legacy_nonce as number) < 0
    || !Number.isSafeInteger(q.deadline) || (q.deadline as number) <= 0 || (q.deadline as number) > payment.expires) throw new Error('accountant quote does not match consent')
  if (signed ? typeof q.signature !== 'string' || !/^0x[0-9a-f]{128}$/i.test(q.signature) || /^0x0{128}$/i.test(q.signature) : q.signature !== null) throw new Error('invalid accountant quote signature')
  const quote = q as unknown as PaidReservationQuote
  if (!historical) live(payment, quote)
  const digest = keccak256(encodeAbiParameters([
    {type: 'bytes32'}, {type: 'address'}, {type: 'uint256'}, {type: 'bytes32'}, {type: 'uint64'},
    {type: 'bytes32'}, {type: 'bytes32[]'}, {type: 'uint256[]'}, {type: 'uint64'},
  ], [keccak256(toHex('keykeeper/prepaid-reserve-assigned/v1')), payment.settlement, BigInt(payment.chain_id), payment.slot,
    BigInt(quote.legacy_nonce), quote.quote_block, quote.request_ids, [BigInt(quote.costs[0]!)], BigInt(quote.deadline)]))
  if (!same(quote.digest, digest)) throw new Error('accountant quote digest mismatch')
  return quote
}

/** Canonical transaction outcome retained for recovery; this never authorizes another operation. */
export type PaidReservationResolution = {
  /** Fresh canonical head used to check transaction confirmation depth. */
  blockNumber: bigint
  /** Hash of that head; historical consent and reservation state carry their own block identities. */
  blockHash: Hex
  /** Timestamp of the confirmation head in Unix seconds. */
  blockTimestamp: bigint
  /** Original locally derived reservation identity. */
  requestId: Hex
  /** Hash independently located for the saved transaction, including after a hashless timeout. */
  transactionHash: Hex
  /** Canonical block containing the original transaction. */
  transactionBlockHash: Hex
  /** Number of the transaction's inclusion block. */
  transactionBlockNumber: bigint
  /** Native gas units actually consumed, including by a reverted transaction. */
  gasUsed: bigint
  /** Verified legacy gas price in native base units. */
  gasPrice: bigint
  /** Native gas used times gas price; separate from TASRA slot charges. */
  gasCost: bigint
} & (
  | {
    /** Successful original reservation transaction and currently observable backing. */
    status: 'success'
    /** Reservation state, including settlement/refund information if already reconciled. */
    receipt: PaidOperationReceipt
  }
  | {
    /** Original transaction reverted. This does not prove no other transaction reserved the intent. */
    status: 'reverted'
  }
)

/**
 * Verify a saved reservation transaction after restart without submitting or replacing anything.
 * Expired intents remain recoverable. Missing transactions, unavailable historical state, reorgs
 * and insufficient confirmations fail closed; none prove that the operation was never submitted.
 * A reverted result proves only this transaction's failure, not absence of another reservation.
 * @param client - Trusted bounded public RPC client with canonical historical reads.
 * @param deployment - Independently approved original deployment.
 * @param original - Original durable preparation; never a newly created replacement intent.
 * @param expected - Independently selected original slot, action and payload digest.
 * @param transactionHash - Saved or independently found candidate hash; its entire identity is checked.
 * @param confirmations - Required inclusion depth, 1..64 (default 1).
 */
export async function reconcilePaidReservation(
  client: PublicClient, deployment: PrepaidDeployment, original: PaidReservationRecord,
  expected: ExpectedPaidOperation, transactionHash: Hex, confirmations = 1,
): Promise<PaidReservationResolution> {
  const d = {...deployment}, record = structuredClone(original), operation = {...expected}
  const payment = record.payment
  assertPaymentIntentWire(payment)
  const requestId = prepaidRequestId(payment), tx = record.transaction
  if (record.schema !== 1 || record.requestId !== requestId || !Number.isSafeInteger(d.chainId) || d.chainId <= 0
    || [d.settlement, d.keyRegistry].some(address => !/^0x[0-9a-f]{40}$/i.test(address) || /^0x0{40}$/i.test(address))
    || payment.chain_id !== d.chainId || !same(payment.settlement, d.settlement) || !same(payment.key_registry, d.keyRegistry)
    || !same(payment.slot, operation.slot) || payment.action !== operation.action || !same(payment.payload_digest, operation.payloadDigest)
    || !HEX32.test(transactionHash) || /^0x0{64}$/i.test(transactionHash) || !Number.isSafeInteger(confirmations) || confirmations < 1 || confirmations > 64) throw new Error('invalid reservation recovery identity or confirmations')
  const quote = parseQuote(record.quote, payment, true, true)
  const data = encodeFunctionData({abi: settlementAbi, functionName: 'reservePrepaidBls', args: [payment.slot, BigInt(quote.legacy_nonce), quote.quote_block,
    [requestId], [BigInt(quote.costs[0]!)], BigInt(quote.deadline), quote.signature!]})
  if (!tx || tx.chainId !== d.chainId || !/^0x[0-9a-f]{40}$/i.test(tx.from) || /^0x0{40}$/i.test(tx.from)
    || !same(tx.to, d.settlement) || !same(tx.data, data) || tx.value !== '0'
    || !Number.isSafeInteger(tx.nonce) || tx.nonce < 0 || typeof tx.gas !== 'string' || !/^[1-9][0-9]{0,77}$/.test(tx.gas) || BigInt(tx.gas) >= 1n << 64n
    || typeof tx.gasPrice !== 'string' || !/^[1-9][0-9]{0,77}$/.test(tx.gasPrice) || BigInt(tx.gasPrice) >= 1n << 128n) throw new Error('invalid saved reservation transaction')
  if (await chainIdOf(client) !== d.chainId) throw new Error('reservation recovery chain mismatch')
  const [transaction, mined, head, quoteBlock] = await Promise.all([
    client.getTransaction({hash: transactionHash}), client.getTransactionReceipt({hash: transactionHash}),
    client.getBlock({blockTag: 'latest'}), client.getBlock({blockHash: quote.quote_block}),
  ])
  const fresh = () => {
    if (head.number === null || head.hash === null || !HEX32.test(head.hash) || /^0x0{64}$/i.test(head.hash)
      || BigInt(now()) - head.timestamp > 30n || head.timestamp - BigInt(now()) > 2n) throw new Error('reservation recovery head is stale or unavailable')
  }
  fresh()
  if (transaction.to === null || !same(transaction.hash, transactionHash) || !same(mined.transactionHash, transactionHash)
    || !same(transaction.to, tx.to) || !same(transaction.from, tx.from) || !same(transaction.input, tx.data)
    || transaction.value !== 0n || transaction.nonce !== tx.nonce || transaction.type !== 'legacy' || transaction.chainId !== tx.chainId
    || transaction.gas !== BigInt(tx.gas) || transaction.gasPrice !== BigInt(tx.gasPrice)
    || transaction.blockHash === null || !same(transaction.blockHash, mined.blockHash) || transaction.blockNumber !== mined.blockNumber
    || mined.to === null || !same(mined.to, tx.to) || !same(mined.from, tx.from) || mined.type !== 'legacy'
    || mined.gasUsed <= 0n || mined.gasUsed > BigInt(tx.gas) || mined.effectiveGasPrice !== BigInt(tx.gasPrice)
    || !['success', 'reverted'].includes(mined.status)) throw new Error('candidate transaction differs from the saved reservation')
  if (head.number === null || head.hash === null || head.number < mined.blockNumber + BigInt(confirmations - 1)) throw new Error('reservation recovery needs more confirmations')
  if (quoteBlock.number === null || quoteBlock.hash === null || !same(quoteBlock.hash, quote.quote_block)
    || quoteBlock.number > mined.blockNumber) throw new Error('invalid original reservation quote block')
  const result = await client.call({to: d.keyRegistry, data: encodeFunctionData({abi: keyRegistryAbi, functionName: 'getKeySlot', args: [payment.slot]}),
    blockHash: quote.quote_block, requireCanonical: true, batch: false})
  if (result.data === undefined) throw new Error('original slot creator unavailable')
  const slot = decodeFunctionResult({abi: keyRegistryAbi, functionName: 'getKeySlot', data: result.data})
  const creator = await recoverTypedDataAddress({...paymentIntentTypedData(payment), signature: payment.signature})
  if (!slot.exists || slot.cancelled || (slot.expiry !== 0n && slot.expiry <= quoteBlock.timestamp) || !same(creator, slot.creator)) throw new Error('saved payment is not from the original active slot creator')
  const receipt = mined.status === 'success' ? await readPaidOperationReceipt(client, d, payment, operation, {atLeastBlock: mined.blockNumber}) : undefined
  if (receipt && (receipt.blockNumber < mined.blockNumber || receipt.cost !== BigInt(quote.costs[0]!) || !same(receipt.assignmentBlock, quote.quote_block))) throw new Error('recovered reservation differs from the saved quote')
  const [canonicalMined, canonicalQuote, canonicalHead] = await Promise.all([
    client.getBlock({blockNumber: mined.blockNumber}), client.getBlock({blockNumber: quoteBlock.number}), client.getBlock({blockNumber: head.number}),
  ])
  if (canonicalMined.hash === null || !same(canonicalMined.hash, mined.blockHash)
    || canonicalQuote.hash === null || !same(canonicalQuote.hash, quote.quote_block)
    || canonicalHead.hash === null || !same(canonicalHead.hash, head.hash)) throw new Error('reservation recovery observation reorganized')
  fresh()
  const observed = {blockNumber: head.number, blockHash: head.hash, blockTimestamp: head.timestamp, requestId, transactionHash,
    transactionBlockNumber: mined.blockNumber, transactionBlockHash: mined.blockHash,
    gasUsed: mined.gasUsed, gasPrice: mined.effectiveGasPrice, gasCost: mined.gasUsed * mined.effectiveGasPrice}
  return receipt ? {...observed, status: 'success', receipt} : {...observed, status: 'reverted'}
}
function unsigned(q: PaidReservationQuote): string {
  return JSON.stringify([q.slot.toLowerCase(), q.quote_block.toLowerCase(), q.request_ids.map(s => s.toLowerCase()), q.costs.map(s => BigInt(s).toString()), q.legacy_nonce, q.deadline, q.digest.toLowerCase()])
}
/**
 * Validated, de-duplicated accountant base URLs (HTTPS; HTTP only on local chain 43112 when allowed).
 * @param options Endpoints and the local HTTP exception.
 * @param chainId Deployment chain.
 */
export function accountantEndpoints(options: Pick<ReservePaidOperationOptions, 'accountantUrls' | 'allowLocalHttp'>, chainId: number): string[] {
  if (options.accountantUrls.length < 1 || options.accountantUrls.length > 32) throw new Error('supply 1..32 accountant endpoints')
  const urls = options.accountantUrls.map(value => {
    const url = new URL(value)
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:'
      && !(options.allowLocalHttp && chainId === 43112 && url.protocol === 'http:'))) throw new Error('invalid accountant endpoint transport')
    return url.toString().replace(/\/+$/, '')
  })
  if (new Set(urls).size !== urls.length) throw new Error('duplicate accountant endpoints')
  return urls
}
/**
 * Settle with `work`, or reject with the abort reason as soon as `signal` aborts (work keeps running).
 * @param work Pending work that is not cancelled by the abort.
 * @param signal Optional cancellation of the wait only.
 */
export function untilAborted<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    if (signal.aborted) { work.catch(() => {}); abort(); return }
    signal.addEventListener('abort', abort, {once: true})
    work.then(value => {signal.removeEventListener('abort', abort); resolve(value)}, (error: unknown) => {signal.removeEventListener('abort', abort); reject(error)})
  })
}
/** At most `limit` bytes of a refusal body as text, '' when unreadable; the rest is cancelled. */
async function boundedText(response: Response, limit: number): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (size < limit) {
      const {done, value} = await reader.read()
      if (done) break
      chunks.push(value.subarray(0, limit - size))
      size += Math.min(value.length, limit - size)
    }
  } catch { return '' } finally {
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return new TextDecoder().decode(bytes)
}

/** Ceiling on how long one `prepare` may wait out the accountant's reservation quota, ms. */
const PREPARE_RETRY_BUDGET_MS = 150_000
/** Least time a REPEATED prepare must have left in its window; its HTTP timeout is then the time left. */
const PREPARE_ATTEMPT_BUDGET_MS = 10_000

// Availability is distinct from policy/credit refusals or an invalid successful response.
// Only this private error permits trying a different endpoint before any transaction exists.
class AccountantUnavailableError extends Error {}

/**
 * The prepare retry window: never more than {@link PREPARE_RETRY_BUDGET_MS} and never more than HALF
 * of what is left of the signed payment expiry, so the authorize, the mined reservation and the
 * credential session keep at least the other half.
 */
function prepareRetryWindowMs(expires: number, nowMs: number): number {
  return Math.min(PREPARE_RETRY_BUDGET_MS, Math.max(0, Math.floor((expires - Math.floor(nowMs / 1000)) / 2)) * 1000)
}

/**
 * One accountant reservation exchange; every attempt sends the SAME request bytes.
 *
 * Only `prepare` is ever repeated, and only after a 429 carrying a valid `Retry-After` (or
 * `x-ratelimit-after`): the accountant answers its per-creator reservation quota that way BEFORE
 * recording or signing anything, and nothing is on chain until the single reservation transaction
 * after `authorize`. Every other status (503 included), every `authorize` answer and every transport
 * error keeps its existing meaning. A repeated prepare needs {@link PREPARE_ATTEMPT_BUDGET_MS} left in
 * its window and its HTTP timeout is cut to the time left.
 */
async function ask(endpoint: string, method: 'prepare' | 'authorize', payment: PaymentIntentWire, block: Hex | null, timeout: number, signal?: AbortSignal,
  clock: PaidPacingClock = systemPacingClock): Promise<PaidReservationQuote> {
  const url = `${endpoint}/v1/prepaid/reservations/${method}`, request = JSON.stringify({intents: [payment], quote_block: block})
  const backoff = new PaidBackoff(clock, 'POST /v1/prepaid/reservations/prepare', clock.now() + prepareRetryWindowMs(payment.expires, clock.now()), PREPARE_ATTEMPT_BUDGET_MS)
  let response: Response, hint: number | undefined
  const quota = (cause: unknown) => cause instanceof PaidBackoffError && hint !== undefined
    ? new PaidReservationQuotaError({reason: cause.code, url, retryAfterMs: hint, cause}) : cause
  for (;;) {
    let limit = timeout
    // Re-read after a sleep: an overrun never leads to a late send.
    if (backoff.retries > 0) try { limit = Math.min(timeout, backoff.readyToSend()) } catch (cause) { throw quota(cause) }
    const deadline = AbortSignal.timeout(limit)
    try {
      response = await fetch(url, {method: 'POST', redirect: 'error',
        headers: {'content-type': 'application/json'}, body: request, signal: signal ? AbortSignal.any([signal, deadline]) : deadline})
    } catch (cause) {
      signal?.throwIfAborted()
      throw new AccountantUnavailableError('accountant reservation transport unavailable', {cause})
    }
    hint = paidServerWaitMs(response.headers?.get('retry-after'), response.headers?.get('x-ratelimit-after'))
    if (method !== 'prepare' || response.status !== 429 || hint === undefined) break
    void response.body?.cancel().catch(() => {})
    try { await backoff.wait(429, hint, signal) } catch (cause) { throw quota(cause) }
  }
  if (!response.ok) {
    // Only an unpinned prepare picks its quote block, so only it can find the signed epoch stale.
    if (method === 'prepare' && block === null && response.status === 503 && (await boundedText(response, MAX_REASON)).includes(STALE_EPOCH_REASON)) {
      throw new PaidReservationStaleEpochError(payment.verification_epoch)
    }
    void response.body?.cancel().catch(() => {})
    if (response.status >= 500 && response.status < 600) throw new AccountantUnavailableError(`accountant reservation request refused (${response.status})`)
    if (response.status === 402) throw new UnderfundedSlotError({slotId: payment.slot, status: 402,
      url, message: 'accountant reservation request refused (402): insufficient available TASRA'})
    throw new Error(`accountant reservation request refused (${response.status})`)
  }
  if (!response.body) throw new Error(`accountant reservation request refused (${response.status})`)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const {done, value} = await reader.read().catch((cause: unknown) => {
        signal?.throwIfAborted()
        throw new AccountantUnavailableError('accountant reservation response interrupted', {cause})
      })
      if (done) break
      size += value.length
      if (size > MAX_BODY) throw new Error('accountant quote exceeds 64 KiB')
      chunks.push(value)
    }
  } finally {
    // Cancelling one branch of a tee can await its untouched sibling indefinitely.
    // Initiate cancellation without making cleanup an unbounded request tail.
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length }
  return parseQuote(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(body)), payment, method === 'authorize')
}

/** One intent and quote across available members; no transaction or journal mutation here. */
async function collectQuote(urls: string[], payment: PaymentIntentWire, requestTimeout: number,
  signal: AbortSignal | undefined, clock: PaidPacingClock): Promise<{quote: PaidReservationQuote; authorized: PaidReservationQuote}> {
  const budget = prepareRetryWindowMs(payment.expires, clock.now()), end = clock.now() + budget
  if (budget <= 0) throw new Error('payment expired before reservation collection')
  const limit = AbortSignal.timeout(budget), bounded = signal ? AbortSignal.any([signal, limit]) : limit
  const remaining = () => {
    bounded.throwIfAborted()
    const left = end - clock.now()
    if (left <= 0) throw new Error('reservation collection exhausted its shared time budget')
    return Math.min(requestTimeout, left)
  }
  const request = async (url: string, method: 'prepare' | 'authorize', block: Hex | null) => {
    try {
      const result = await ask(url, method, payment, block, remaining(), bounded, clock)
      remaining()
      return result
    } catch (error) {
      bounded.throwIfAborted()
      throw error
    }
  }
  let seed: {quote: PaidReservationQuote; index: number} | undefined, lastUnavailable: AccountantUnavailableError | undefined
  for (const [index, url] of urls.entries()) {
    try { seed = {quote: await request(url, 'prepare', null), index}; break }
    catch (error) { if (!(error instanceof AccountantUnavailableError)) throw error; lastUnavailable = error }
  }
  if (!seed) throw lastUnavailable ?? new Error('no reachable accountant prepared the reservation')
  const {quote, index} = seed, prepared = [urls[index]!]
  // Earlier endpoints already failed. Never ask them to prepare again under a new block.
  const candidates = urls.slice(index + 1)
  const preparations = await Promise.allSettled(candidates.map(url => request(url, 'prepare', quote.quote_block)))
  for (const [i, result] of preparations.entries()) {
    if (result.status === 'rejected') {
      if (!(result.reason instanceof AccountantUnavailableError)) throw result.reason
      continue
    }
    if (unsigned(result.value) !== unsigned(quote)) throw new Error('accountants disagree on reservation')
    prepared.push(candidates[i]!)
  }
  for (const url of prepared) {
    live(payment, quote)
    try {
      const authorized = await request(url, 'authorize', quote.quote_block)
      if (unsigned(authorized) !== unsigned(quote)) throw new Error('authorization changed the prepared reservation')
      return {quote, authorized}
    } catch (error) { if (!(error instanceof AccountantUnavailableError)) throw error; lastUnavailable = error }
  }
  throw lastUnavailable ?? new Error('no prepared accountant returned a quorum authorization')
}

/**
 * Reserve TASRA for a fixed creator-signed operation using an accountant threshold quote.
 * Does not create an intent, approve tokens, activate a slot, authorize credentials or do keeper
 * work. Before broadcast, unavailable accountants can be skipped while collecting the same quote
 * and quorum authorization. One broadcast attempt only; no replacement or implicit gas funding.
 * @param client - Trusted bounded public RPC client; use retryCount: 0 for submissions.
 * @param wallet - Account-bound gas payer on the selected chain; no automatic wallet retries.
 * @param deployment - Independently approved deployment.
 * @param original - Creator intent from independently verified assignment/session discovery.
 * @param expected - Independently derived operation.
 * @param options - Fee limits, accountant endpoints and mandatory durable persistence.
 */
export async function reservePaidOperation(
  client: PublicClient, wallet: WalletClient<Transport, Chain, Account>, deployment: PrepaidDeployment,
  original: PaymentIntentWire, expected: ExpectedPaidOperation, options: ReservePaidOperationOptions,
): Promise<{transactionHash: Hex; receipt: PaidOperationReceipt}> {
  const signal = options.signal, progress: {requestId?: Hex; preparing: boolean} = {preparing: false}
  try { return await reserveOnce(client, wallet, deployment, original, expected, options, progress) }
  catch (error) {
    // Before the durable preparation nothing was journaled or sent: the abort is a clean refusal.
    if (!progress.preparing && progress.requestId && signal?.aborted && !(error instanceof PaidReservationUncertainError)) throw new PaidReservationAbortedError(progress.requestId, signal.reason ?? error)
    throw error
  }
}

async function reserveOnce(
  client: PublicClient, wallet: WalletClient<Transport, Chain, Account>, deployment: PrepaidDeployment,
  original: PaymentIntentWire, expected: ExpectedPaidOperation, options: ReservePaidOperationOptions, progress: {requestId?: Hex; preparing: boolean},
): Promise<{transactionHash: Hex; receipt: PaidOperationReceipt}> {
  // Snapshot caller-owned inputs before the first await; storage receives its own copy too.
  const payment = structuredClone(original), d = {...deployment}, operation = {...expected}
  const opts = {...options, accountantUrls: [...options.accountantUrls]}, signal = opts.signal
  const payer = {...wallet.account}, payerChain = {...wallet.chain}
  assertPaymentIntentWire(payment)
  if (!Number.isSafeInteger(d.chainId) || d.chainId <= 0 || payment.chain_id !== d.chainId
    || !same(payment.settlement, d.settlement) || !same(payment.key_registry, d.keyRegistry)
    || !same(payment.slot, operation.slot) || payment.action !== operation.action || !same(payment.payload_digest, operation.payloadDigest)) throw new Error('payment deployment or operation mismatch')
  if (typeof opts.maxGas !== 'bigint' || typeof opts.maxGasPrice !== 'bigint' || opts.maxGas <= 0n || opts.maxGas >= 1n << 64n || opts.maxGasPrice <= 0n || opts.maxGasPrice >= 1n << 128n || typeof opts.persist !== 'function') throw new Error('invalid reservation gas budget or journal')
  const requestTimeout = opts.requestTimeoutMs ?? 85000, receiptTimeout = opts.receiptTimeoutMs ?? 60000, confirmations = opts.confirmations ?? 1
  if (!Number.isSafeInteger(requestTimeout) || requestTimeout < 1 || requestTimeout > 85000
    || !Number.isSafeInteger(receiptTimeout) || receiptTimeout < 1 || receiptTimeout > 120000
    || !Number.isSafeInteger(confirmations) || confirmations < 1 || confirmations > 64) throw new Error('invalid reservation timeout or confirmations')
  live(payment)
  progress.requestId = prepaidRequestId(payment)
  signal?.throwIfAborted()
  const urls = accountantEndpoints(opts, d.chainId)
  if (payer.type !== 'local' && payer.type !== 'json-rpc') throw new Error('reservation requires an EOA gas payer')
  if (payerChain.id !== d.chainId || await chainIdOf(wallet) !== d.chainId || await chainIdOf(client) !== d.chainId) throw new Error('reservation RPC/wallet chain mismatch')
  const clock = opts.clock ?? systemPacingClock
  const {quote, authorized} = await collectQuote(urls, payment, requestTimeout, signal, clock)
  const requestId = prepaidRequestId(payment)
  const args = [payment.slot, BigInt(quote.legacy_nonce), quote.quote_block, [requestId], [BigInt(quote.costs[0]!)], BigInt(quote.deadline)] as const
  const data = encodeFunctionData({abi: settlementAbi, functionName: 'reservePrepaidBls', args: [...args, authorized.signature!]})
  // The quote block's header is read beside the observations below (all pinned to that same hash)
  // and judged before them, as when it was read first on its own.
  const blockRead = client.getBlock({blockHash: quote.quote_block})
  blockRead.catch(() => {})
  const call = async (to: Address, data: Hex) => {
    const result = await client.call({to, data, account: payer, blockHash: quote.quote_block, requireCanonical: true, batch: false})
    if (result.data === undefined) throw new Error('empty reservation observation')
    return result.data
  }
  // Every observation below is independent of the others: they are sent together and judged in the
  // order they were once read one by one, so the same answer refuses with the same error.
  const settled = <T>(work: Promise<T>) => work.then(value => ({value}), (error: unknown) => ({error}))
  const outcome = <T>(result: {value: T} | {error: unknown}): T => { if ('error' in result) throw result.error; return result.value }
  const [digestRead, costRead, slotRead, simulation, feeReads] = await Promise.all([
    settled(call(d.settlement, encodeFunctionData({abi: settlementAbi, functionName: 'prepaidReserveDigest', args}))),
    settled(call(d.settlement, encodeFunctionData({abi: settlementAbi, functionName: 'prepaidCost', args: [payment.slot, requestId]}))),
    settled(call(d.keyRegistry, encodeFunctionData({abi: keyRegistryAbi, functionName: 'getKeySlot', args: [payment.slot]}))),
    // Contract simulation verifies the accountant threshold signature and reservation state without gas.
    settled(client.call({to: d.settlement, data, account: payer, blockHash: quote.quote_block, requireCanonical: true, batch: false})),
    settled(Promise.all([
      // A local Account makes viem prepare EIP-1559 fees during estimation, but
      // this flow signs a bounded legacy transaction below. Estimate execution
      // with zero simulation fees, then check the actual legacy gas cost. Without
      // this separation a balance-capped BN254 precompile can report BadSignature.
      client.getGasPrice(), client.estimateGas({account: payer.address, to: d.settlement, data, value: 0n, gasPrice: 0n, type: 'legacy'}),
      client.getTransactionCount({address: payer.address, blockTag: 'pending'}),
      client.getBalance({address: payer.address, blockTag: 'pending'}),
    ])),
  ])
  const block = await blockRead
  const fresh = () => {
    if (block.number === null || block.hash === null || !same(block.hash, quote.quote_block)
      || BigInt(now()) - block.timestamp > 30n || block.timestamp - BigInt(now()) > 2n) throw new Error('reservation quote block is stale or invalid')
    live(payment, quote)
  }
  fresh()
  const digest = decodeFunctionResult({abi: settlementAbi, functionName: 'prepaidReserveDigest', data: outcome(digestRead)})
  if (!same(digest, quote.digest)) throw new Error('deployment reservation digest mismatch')
  const previousCost = decodeFunctionResult({abi: settlementAbi, functionName: 'prepaidCost', data: outcome(costRead)})
  if (previousCost !== 0n) throw new Error('operation already reserved; inspect its receipt instead of spending again')
  const slot = decodeFunctionResult({abi: keyRegistryAbi, functionName: 'getKeySlot', data: outcome(slotRead)})
  const creator = await recoverTypedDataAddress({...paymentIntentTypedData(payment), signature: payment.signature})
  if (!slot.exists || slot.cancelled || (slot.expiry !== 0n && slot.expiry <= BigInt(now())) || !same(creator, slot.creator)) throw new Error('reservation intent is not from an active slot creator')
  outcome(simulation)
  const [gasPrice, gas, nonce, balance] = outcome(feeReads)
  if (gas <= 0n || gas > opts.maxGas || gasPrice <= 0n || gasPrice > opts.maxGasPrice) throw new Error('reservation exceeds native gas budget')
  const requiredNativeUnits = gas * gasPrice
  if (balance < requiredNativeUnits) throw new UnderfundedGasPayerError({payer: payer.address, availableNativeUnits: balance, requiredNativeUnits})
  signal?.throwIfAborted()
  if (block.number === null) throw new Error('reservation quote has no block number')
  // The canonical recheck of the quote block after its reads: answered by the head follower only
  // when it proves this exact block canonical (instant finality, live, gap-free, at or below the
  // finalized head), as for every other paid observation; anything else reads it by number.
  if (headFollowerOf(client)?.isCanonical({blockNumber: block.number, blockHash: quote.quote_block, blockTimestamp: block.timestamp}) !== true) {
    const canonical = await client.getBlock({blockNumber: block.number})
    if (canonical.hash === null || !same(canonical.hash, quote.quote_block)) throw new Error('reservation quote reorganized')
  }
  fresh()
  const record: PaidReservationRecord = {schema: 1, requestId, payment, quote: authorized,
    transaction: {chainId: d.chainId, from: payer.address, to: d.settlement, data, value: '0', nonce, gas: gas.toString(), gasPrice: gasPrice.toString()}}
  // A local signer signs BEFORE the durable preparation, so the exact transaction hash is
  // journaled before anything can be broadcast. Signing alone sends nothing; a failure here
  // leaves no preparation and therefore provably no transaction.
  let raw: Awaited<ReturnType<typeof wallet.signTransaction>> | undefined, transactionHash: Hex | undefined
  if (payer.type === 'local') {
    raw = await wallet.signTransaction({account: payer, chain: payerChain,
      to: d.settlement, data, value: 0n, nonce, gas, gasPrice, type: 'legacy'})
    const signed = parseTransaction(raw), sender = await recoverTransactionAddress({serializedTransaction: raw})
    if (signed.type !== 'legacy' || signed.chainId !== d.chainId || !same(sender, payer.address)
      || !signed.to || !same(signed.to, d.settlement) || !signed.data || !same(signed.data, data)
      || (signed.value ?? 0n) !== 0n || signed.nonce !== nonce || signed.gas !== gas || signed.gasPrice !== gasPrice) throw new Error('signed transaction differs from the durable reservation')
    transactionHash = keccak256(raw)
    fresh()
  }
  // The last point an abort is honoured: from the durable preparation on, the single broadcast
  // proceeds and every checkpoint is written in full, so the journal is never left half-written.
  signal?.throwIfAborted()
  progress.preparing = true
  await opts.persist({phase: 'prepared', record: structuredClone(record), ...(transactionHash ? {transactionHash} : {})})
  try {
    fresh()
    // Viem's generic sendTransaction can retry through wallet_sendTransaction on certain
    // RPC errors. Use exactly one RPC submission, including when the outcome is uncertain.
    if (raw !== undefined) {
      const returned = await wallet.request({method: 'eth_sendRawTransaction', params: [raw]}, {retryCount: 0})
      if (returned === undefined || transactionHash === undefined || !same(returned, transactionHash)) throw new Error('RPC returned another signed transaction hash')
    } else {
      transactionHash = await wallet.request({method: 'eth_sendTransaction', params: [{from: payer.address,
        to: d.settlement, data, value: '0x0', nonce: toHex(nonce), gas: toHex(gas), gasPrice: toHex(gasPrice),
        type: '0x0', chainId: toHex(d.chainId)}]}, {retryCount: 0})
    }
    if (typeof transactionHash !== 'string' || !HEX32.test(transactionHash) || /^0x0{64}$/i.test(transactionHash)) throw new Error('invalid reservation transaction hash')
    await opts.persist({phase: 'submitted', requestId, transactionHash})
    // A broadcast transaction cannot be cancelled: an abort only ends this wait, as uncertain.
    const sent = transactionHash
    const mined = await untilAborted(pollTransactionReceipt(client, sent, {confirmations, timeoutMs: receiptTimeout, signal}), signal)
    if (!same(mined.transactionHash, transactionHash) || mined.status !== 'success') throw new Error('reservation transaction reverted or was replaced')
    // The mined transaction, the reservation it made and its block are read together, and judged
    // in the order they were once read one by one.
    const [transactionRead, receiptRead, minedBlockRead] = await untilAborted(Promise.all([
      settled(client.getTransaction({hash: sent})), settled(readPaidOperationReceipt(client, d, payment, operation, {atLeastBlock: mined.blockNumber})),
      settled(client.getBlock({blockNumber: mined.blockNumber}))]), signal)
    const transaction = outcome(transactionRead)
    if (transaction.to === null || !same(transaction.to, d.settlement) || !same(transaction.from, record.transaction.from)
      || !same(transaction.input, data) || transaction.value !== 0n || transaction.nonce !== nonce
      || transaction.type !== 'legacy' || transaction.gas !== gas || transaction.gasPrice !== gasPrice || transaction.chainId !== d.chainId
      || transaction.blockHash === null || !same(transaction.blockHash, mined.blockHash)) throw new Error('mined transaction differs from the durable reservation')
    const receipt = outcome(receiptRead)
    if (receipt.blockNumber < mined.blockNumber || receipt.cost !== BigInt(quote.costs[0]!) || !same(receipt.assignmentBlock, quote.quote_block)) throw new Error('mined reservation differs from the saved quote')
    const minedBlock = outcome(minedBlockRead)
    if (minedBlock.hash === null || !same(minedBlock.hash, mined.blockHash)) throw new Error('reservation receipt reorganized')
    await opts.persist({phase: 'confirmed', requestId, transactionHash, blockHash: mined.blockHash})
    return {transactionHash, receipt}
  } catch (cause) { throw new PaidReservationUncertainError(requestId, transactionHash, cause) }
}
