// Payer-side client for the Settlement prepaid timeout escape.
//
// A prepaid reservation is normally completed by the accountant set's signed reconcile (or full
// payout). If nobody reconciles it within the governed escape delay, anyone may call
// `Settlement.escapePrepaid(slotId, requestIds)`: the full reserved cost of each named request
// returns to the SAME slot's balance, nothing is paid to any operator, and the request gets the
// permanent settled mark that reconcile also writes, so whichever is mined first is final.
//
// This module reads when each request becomes escapable, refuses locally unless every named
// request is open, chunks to the contract's 64-request bound, simulates each call, journals it
// before its single broadcast (never a blind resend), and confirms it from the emitted events.
// `reconcileEscape` settles an uncertain broadcast by reading chain state. The governance setter
// for the delay is deliberately not part of this client.

import {decodeErrorResult, decodeEventLog, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, keccak256, parseTransaction,
  recoverTransactionAddress, toHex, type Abi, type Account, type Address, type Chain, type Hex, type Log, type PublicClient, type Transport,
  type WalletClient} from 'viem'
import {settlementAbi} from './abis/settlement.js'
import {PrepaidEscapeError, PrepaidEscapeUncertainError, TasraError} from '../errors.js'
import {revertData, revertError} from './revertReason.js'
import {untilAborted} from './reservation.js'
import {chainIdOf} from './chainId.js'
import {pollTransactionReceipt} from './receipt.js'
import {isViemError} from '../internal/viemErrors.js'

/** Most requests one `escapePrepaid` transaction may name (the contract's `MAX_ESCAPE_PER_CALL`). */
export const MAX_ESCAPE_PER_CALL = 64
/** Most requests one client call accepts; they are sent as sequential transactions of at most 64. */
export const MAX_ESCAPE_REQUESTS = 1024

/** Chain and Settlement proxy, independently approved by the application. */
export interface PrepaidEscapeDeployment {
  /** Expected EVM chain ID. */
  chainId: number
  /** Expected Settlement proxy. */
  settlement: Address
}

/** Escape status of one request, read at one canonical block. */
export type PrepaidEscapeRequestState =
  | {
    /** Request identifier. */
    requestId: Hex
    /** No reservation exists (`prepaidCost == 0`). */
    status: 'notReserved'
  }
  | {
    /** Request identifier. */
    requestId: Hex
    /** Already complete: reconciled, paid out or escaped. Final. */
    status: 'settled'
    /** When the request was escaped; absent when it was reconciled or paid out instead. */
    escapedAt?: Date
  }
  | {
    /** Request identifier. */
    requestId: Hex
    /** Reserved and open, but the deployment's escape delay is zero (not enabled). */
    status: 'disabled'
  }
  | {
    /** Request identifier. */
    requestId: Hex
    /** Reserved and open; the escape opens later. */
    status: 'notOpen'
    /** Chain time at which the escape opens. */
    opensAt: Date
  }
  | {
    /** Request identifier. */
    requestId: Hex
    /** Escapable now (chain time at the observed block is at or past `opensAt`). */
    status: 'open'
    /** Chain time at which the escape opened. */
    opensAt: Date
  }

/** One status of `PrepaidEscapeRequestState`. */
export type PrepaidEscapeStatus = PrepaidEscapeRequestState['status']

/** Every requested status, read at one fresh canonical block. */
export interface PrepaidEscapeObservation {
  /** Canonical block number. */
  blockNumber: bigint
  /** Block hash every value was read at (EIP-1898, requireCanonical). */
  blockHash: Hex
  /** Block timestamp in Unix seconds; `open` is judged against it, like the contract. */
  blockTimestamp: bigint
  /** Governed escape delay in seconds; 0 means the escape is disabled. Read live, never snapshotted. */
  escapeDelaySeconds: bigint
  /** Slot identifier. */
  slotId: Hex
  /** Per request, in the caller's order. */
  requests: PrepaidEscapeRequestState[]
}

/** Immutable identity of one escape transaction, retained before any broadcast; JSON serializable. */
export interface PrepaidEscapeRecord {
  /** Record format. */
  schema: 1
  /** Local journal key derived from chain, Settlement, slot and the exact ordered request list. */
  escapeId: Hex
  /** Slot identifier. */
  slotId: Hex
  /** Exact ordered requests of this call (at most 64). */
  requestIds: Hex[]
  /** Exact bounded legacy transaction; decimal strings preserve integer precision in storage. */
  transaction: {chainId: number; from: Address; to: Address; data: Hex; value: '0'; nonce: number; gas: string; gasPrice: string}
}

/** Durable write checkpoints of one escape call. After `prepared`, only reading reconciles it. */
export type PrepaidEscapeCheckpoint =
  | {
    /** Persisted before any submission. Create exclusively by `record.escapeId`. */
    phase: 'prepared'
    /** Exact call and transaction identity. */
    record: PrepaidEscapeRecord
    /** Hash of a locally signed transaction, journaled before broadcast; absent for a JSON-RPC signer. */
    transactionHash?: Hex
  }
  | {
    /** A transaction hash was returned; mining is unproven. */
    phase: 'submitted'
    /** Key of the existing durable preparation. */
    escapeId: Hex
    /** Returned transaction hash. */
    transactionHash: Hex
  }
  | {
    /** The transaction mined successfully and its events matched the call. */
    phase: 'confirmed'
    /** Key of the existing durable preparation. */
    escapeId: Hex
    /** Verified transaction hash. */
    transactionHash: Hex
    /** Canonical block containing it. */
    blockHash: Hex
    /** TASRA base units returned to the slot, as a decimal string. */
    refunded: string
  }

/** Arguments of {@link PrepaidEscapeClient.escapePrepaid}. */
export interface EscapePrepaidArgs {
  /** Slot whose reservations are escaped; the refund always returns to this slot's balance. */
  slotId: Hex
  /** Requests to escape (1..1024, distinct); every one must be `open`. */
  requestIds: readonly Hex[]
  /** Account- and chain-bound gas payer (any account: the escape is permissionless). */
  signer: WalletClient<Transport, Chain, Account>
  /** Maximum gas units per transaction. */
  maxGas: bigint
  /** Maximum legacy gas price in wei. */
  maxGasPrice: bigint
  /**
   * Await durable storage before resolving. `prepared` MUST atomically create a unique record keyed
   * by `escapeId`, refuse an existing one, and survive process loss; later checkpoints update it.
   * A failure before `prepared` completes prevents that call's broadcast.
   */
  persist: (checkpoint: PrepaidEscapeCheckpoint) => Promise<void>
  /** Required confirmations, 1..64 (default 1). */
  confirmations?: number
  /** Receipt wait per transaction, 1..120000 ms (default 60000). */
  receiptTimeoutMs?: number
  /** Cancellation: before a call's `prepared` checkpoint nothing is sent; after it, only the wait ends (uncertain). */
  signal?: AbortSignal
}

/** One confirmed escape transaction. */
export interface PrepaidEscapeCallResult {
  /** Local journal key. */
  escapeId: Hex
  /** Requests escaped by this transaction, in order. */
  requestIds: Hex[]
  /** Transaction hash. */
  transactionHash: Hex
  /** Inclusion block number. */
  blockNumber: bigint
  /** Inclusion block hash. */
  blockHash: Hex
  /** Total TASRA base units returned to the slot (`PrepaidBatchEscaped.refunded`). */
  refunded: bigint
  /** Per request, from `PrepaidEscaped`. */
  refunds: {requestId: Hex; refunded: bigint}[]
}

/** Result of a fully confirmed escape. */
export interface PrepaidEscapeResult {
  /** Slot identifier. */
  slotId: Hex
  /** Total TASRA base units returned to the slot balance (not withdrawn to the payer). */
  refunded: bigint
  /** One entry per transaction, in order. */
  calls: PrepaidEscapeCallResult[]
}

/** Arguments of {@link PrepaidEscapeClient.reconcileEscape}. */
export interface ReconcileEscapeArgs {
  /** The prepared record, never a rebuilt one. */
  record: PrepaidEscapeRecord
  /** Journaled or returned hash, when one is known. */
  transactionHash?: Hex
  /** Required depth for a conclusion, 1..64 (default 1). */
  confirmations?: number
}

/**
 * Outcome of one escape call, read without sending anything.
 * - `escaped`: this transaction mined successfully at the required depth and escaped every request.
 * - `completed`: every request is now complete (escaped by anyone, or reconciled), but this
 *   transaction's success is not shown. Nothing is left to do for this call.
 * - `reverted`: this transaction mined and reverted; it refunded nothing.
 * - `not-escaped`: the payer's nonce is consumed by another or failed transaction and some request
 *   is still open; this call can no longer mine. A new attempt (after a fresh preflight) is safe.
 * - `uncertain`: the transaction may still mine. Do not resend; read again later.
 */
export interface PrepaidEscapeResolution {
  /** Outcome. */
  state: 'escaped' | 'completed' | 'reverted' | 'not-escaped' | 'uncertain'
  /** Local journal key. */
  escapeId: Hex
  /** Block every value was read at (head minus confirmations - 1). */
  blockNumber: bigint
  /** Hash of that block. */
  blockHash: Hex
  /** Per request, in record order. */
  requests: {requestId: Hex; settled: boolean; escapedAt?: Date}[]
  /** The checked transaction, when a hash was supplied. */
  transactionHash?: Hex
  /** TASRA returned by this transaction (`escaped` only). */
  refunded?: bigint
}

/** Decoded escape events from one receipt or log window. */
export interface PrepaidEscapeEvents {
  /** `PrepaidEscaped`, one per request. */
  escaped: {slotId: Hex; requestId: Hex; refunded: bigint}[]
  /** `PrepaidBatchEscaped`, one per call. */
  batches: {slotId: Hex; caller: Address; refunded: bigint; requestCount: bigint}[]
}

/** Payer-side escape client bound to one deployment. */
export interface PrepaidEscapeClient {
  /**
   * Read each request's escape status at one fresh canonical block. Sends nothing.
   * @param args Slot and requests (1..1024, distinct).
   */
  escapableAt(args: {slotId: Hex; requestIds: readonly Hex[]}): Promise<PrepaidEscapeObservation>
  /**
   * Escape reserved requests whose timeout has opened. Refuses locally with
   * {@link PrepaidEscapeError} unless every request is `open`; then for each chunk of at most 64:
   * simulate, journal `prepared`, broadcast once, journal `submitted`, wait, verify the events,
   * journal `confirmed`. A failure after `prepared` is {@link PrepaidEscapeUncertainError}.
   * @param args Requests, signer, gas budget and mandatory durable journal.
   */
  escapePrepaid(args: EscapePrepaidArgs): Promise<PrepaidEscapeResult>
  /**
   * Resolve a journaled escape call by reading `prepaidEscapedAt`, `prepaidSettled`, the receipt and
   * the payer nonce. Never sends.
   * @param args The prepared record, a known hash and the confirmation depth.
   */
  reconcileEscape(args: ReconcileEscapeArgs): Promise<PrepaidEscapeResolution>
}

const HEX32 = /^0x[0-9a-f]{64}$/i
const ADDRESS = /^0x[0-9a-f]{40}$/i
const ZERO32 = /^0x0{64}$/i
const ZERO_ADDRESS = /^0x0{40}$/i
const MAX_AGE = 30n
const FUTURE_SKEW = 2n
const MAX_DATE_SECONDS = 8_640_000_000_000n
const READ_FANOUT = 8
const JOURNAL_LABEL = keccak256(toHex('tasra-sdk/prepaid-escape-journal'))
const PRE_ESCAPE_VERSIONS = new Set(['1', '2'])

const nowSecs = () => BigInt(Math.floor(Date.now() / 1000))
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
function date(seconds: bigint): Date {
  if (seconds <= 0n || seconds > MAX_DATE_SECONDS) throw new TasraError('prepaid escape time is outside the date range')
  return new Date(Number(seconds) * 1000)
}

interface At {blockNumber: bigint; blockHash: Hex; blockTimestamp: bigint}

function validateDeployment(d: PrepaidEscapeDeployment): void {
  if (!Number.isSafeInteger(d.chainId) || d.chainId <= 0 || typeof d.settlement !== 'string'
    || !ADDRESS.test(d.settlement) || ZERO_ADDRESS.test(d.settlement)) throw new TasraError('Invalid prepaid escape deployment')
}

function requestList(slotId: unknown, requestIds: unknown): {slot: Hex; ids: Hex[]} {
  if (typeof slotId !== 'string' || !HEX32.test(slotId) || ZERO32.test(slotId)) throw new TasraError('Invalid prepaid escape slot')
  if (!Array.isArray(requestIds) || requestIds.length > MAX_ESCAPE_REQUESTS) throw new TasraError(`Supply at most ${MAX_ESCAPE_REQUESTS} prepaid request IDs`)
  if (requestIds.length === 0) throw new PrepaidEscapeError({code: 'empty_request', local: true})
  const ids = requestIds.map(id => {
    if (typeof id !== 'string' || !HEX32.test(id) || ZERO32.test(id)) throw new TasraError('Invalid prepaid request ID')
    return id.toLowerCase() as Hex
  })
  if (new Set(ids).size !== ids.length) throw new TasraError('Duplicate prepaid request ID')
  return {slot: slotId.toLowerCase() as Hex, ids}
}

/**
 * Local journal key of one escape call: keccak256 of a fixed label, chain ID, Settlement, slot and
 * the exact ordered request list. Not a wire or on-chain format.
 * @param deployment Approved chain and Settlement.
 * @param slotId Slot identifier.
 * @param requestIds Exact ordered requests of the call.
 */
export function prepaidEscapeId(deployment: PrepaidEscapeDeployment, slotId: Hex, requestIds: readonly Hex[]): Hex {
  return keccak256(encodeAbiParameters([{type: 'bytes32'}, {type: 'uint256'}, {type: 'address'}, {type: 'bytes32'}, {type: 'bytes32[]'}],
    [JOURNAL_LABEL, BigInt(deployment.chainId), deployment.settlement, slotId, [...requestIds]]))
}

function fresh(at: At): void {
  const t = nowSecs()
  if (t - at.blockTimestamp > MAX_AGE || at.blockTimestamp - t > FUTURE_SKEW) throw new TasraError('prepaid escape observation is stale or future-dated')
}

async function observeHead(client: PublicClient, d: PrepaidEscapeDeployment, depth = 0n): Promise<At> {
  if (await chainIdOf(client) !== d.chainId) throw new TasraError('prepaid escape RPC chain mismatch')
  const head = await client.getBlock({blockTag: 'latest'})
  if (head.number === null || head.hash === null || !HEX32.test(head.hash) || head.timestamp < 0n) throw new TasraError('prepaid escape canonical head unavailable')
  fresh({blockNumber: head.number, blockHash: head.hash, blockTimestamp: head.timestamp})
  if (depth === 0n) return {blockNumber: head.number, blockHash: head.hash, blockTimestamp: head.timestamp}
  if (head.number < depth) throw new TasraError('prepaid escape chain is shorter than the confirmation depth')
  const block = await client.getBlock({blockNumber: head.number - depth})
  if (block.number === null || block.hash === null || !HEX32.test(block.hash)) throw new TasraError('prepaid escape observation block unavailable')
  return {blockNumber: block.number, blockHash: block.hash, blockTimestamp: block.timestamp}
}

async function readAt(client: PublicClient, settlement: Address, at: At, functionName: string, args: readonly unknown[] = []): Promise<unknown> {
  const abi = settlementAbi as Abi
  const data = encodeFunctionData({abi, functionName, args})
  const result = await client.call({to: settlement, data, blockHash: at.blockHash, requireCanonical: true, batch: false})
  if (result.data === undefined || result.data === '0x') throw new TasraError(`empty Settlement ${functionName} response`)
  return decodeFunctionResult({abi, functionName, data: result.data})
}

async function recheck(client: PublicClient, at: At): Promise<void> {
  const canonical = await client.getBlock({blockNumber: at.blockNumber})
  if (canonical.hash === null || !same(canonical.hash, at.blockHash)) throw new TasraError('prepaid escape observation reorganized during reads')
}

/** A Settlement that positively reads a version before the escape has no escape getters. */
async function escapeDelayAt(client: PublicClient, d: PrepaidEscapeDeployment, at: At): Promise<bigint> {
  let delay: unknown
  try { delay = await readAt(client, d.settlement, at, 'prepaidEscapeDelay') } catch (cause) {
    const version = await readAt(client, d.settlement, at, 'version').catch(() => undefined)
    if (typeof version === 'string' && PRE_ESCAPE_VERSIONS.has(version)) {
      throw new PrepaidEscapeError({code: 'escape_unsupported', local: true, cause,
        message: `Settlement version ${version} has no prepaid timeout escape; nothing was sent`})
    }
    throw cause
  }
  if (typeof delay !== 'bigint' || delay < 0n) throw new TasraError('invalid prepaidEscapeDelay response')
  return delay
}

async function observe(client: PublicClient, d: PrepaidEscapeDeployment, slot: Hex, ids: readonly Hex[]): Promise<PrepaidEscapeObservation> {
  const at = await observeHead(client, d)
  const delay = await escapeDelayAt(client, d, at)
  const requests: PrepaidEscapeRequestState[] = []
  // Bounded RPC fan-out; an unreadable request fails the whole observation.
  for (let offset = 0; offset < ids.length; offset += READ_FANOUT) {
    requests.push(...await Promise.all(ids.slice(offset, offset + READ_FANOUT).map(async requestId => {
      const [opens, cost, settled, escapedAt] = await Promise.all(['prepaidEscapableAt', 'prepaidCost', 'prepaidSettled', 'prepaidEscapedAt']
        .map(name => readAt(client, d.settlement, at, name, [slot, requestId])))
      if (typeof opens !== 'bigint' || typeof cost !== 'bigint' || typeof settled !== 'boolean' || typeof escapedAt !== 'bigint') throw new TasraError('invalid prepaid escape response')
      return classify(requestId, delay, opens, cost, settled, escapedAt, at.blockTimestamp)
    })))
  }
  await recheck(client, at)
  fresh(at)
  return {...at, escapeDelaySeconds: delay, slotId: slot, requests}
}

function classify(requestId: Hex, delay: bigint, opens: bigint, cost: bigint, settled: boolean, escapedAt: bigint, timestamp: bigint): PrepaidEscapeRequestState {
  const inconsistent = () => new TasraError(`inconsistent prepaid escape state for request ${requestId}`)
  if (cost === 0n) {
    if (settled || escapedAt !== 0n || opens !== 0n) throw inconsistent()
    return {requestId, status: 'notReserved'}
  }
  if (settled) {
    if (opens !== 0n) throw inconsistent()
    return escapedAt === 0n ? {requestId, status: 'settled'} : {requestId, status: 'settled', escapedAt: date(escapedAt)}
  }
  if (escapedAt !== 0n) throw inconsistent()
  if (delay === 0n) {
    if (opens !== 0n) throw inconsistent()
    return {requestId, status: 'disabled'}
  }
  if (opens === 0n) throw inconsistent()
  // The contract reverts while block.timestamp < opensAt.
  return {requestId, status: timestamp >= opens ? 'open' : 'notOpen', opensAt: date(opens)}
}

/** The contract's own first refusal for these states, in its order: disabled first, then per request. */
function refuseUnlessOpen(observed: PrepaidEscapeObservation): void {
  if (observed.escapeDelaySeconds === 0n) throw new PrepaidEscapeError({code: 'escape_disabled', local: true})
  for (const state of observed.requests) {
    if (state.status === 'open') continue
    if (state.status === 'notOpen') throw new PrepaidEscapeError({code: 'escape_not_open', local: true, requestId: state.requestId, opensAt: state.opensAt})
    throw new PrepaidEscapeError({code: 'reservation_unavailable', local: true, requestId: state.requestId,
      message: state.status === 'settled'
        ? `prepaid request ${state.requestId} is already complete${state.escapedAt ? ' (escaped)' : ''}; nothing was sent`
        : `prepaid request ${state.requestId} is not reserved; nothing was sent`})
  }
}

/**
 * Map a Settlement escape revert anywhere in an error's cause chain to a typed
 * {@link PrepaidEscapeError} (`local: false`); `undefined` for any other failure.
 * @param error RPC or viem error from a simulation, gas estimate or relayed call.
 */
export function decodePrepaidEscapeRevert(error: unknown): PrepaidEscapeError | undefined {
  const data = revertData(error)
  if (!data) return undefined
  let decoded: {errorName: string; args?: readonly unknown[]}
  try { decoded = decodeErrorResult({abi: settlementAbi, data}) } catch { return undefined }
  const args = decoded.args ?? []
  switch (decoded.errorName) {
    case 'EscapeDisabled': return new PrepaidEscapeError({code: 'escape_disabled', local: false, cause: error})
    case 'EscapeNotOpen': {
      // Never throw while naming a revert: an out-of-range time is reported without opensAt.
      const at = args[1] as bigint
      return new PrepaidEscapeError({code: 'escape_not_open', local: false, requestId: args[0] as Hex,
        ...(at > 0n && at <= MAX_DATE_SECONDS ? {opensAt: date(at)} : {}), cause: error})
    }
    case 'ReservationUnavailable': return new PrepaidEscapeError({code: 'reservation_unavailable', local: false, requestId: args[0] as Hex, cause: error})
    case 'InvalidEscapeDelay': return new PrepaidEscapeError({code: 'invalid_escape_delay', local: false, delaySeconds: args[0] as bigint, cause: error})
    case 'TooManyCovered': return new PrepaidEscapeError({code: 'too_many_requests', local: false, cause: error})
    case 'EmptyBundle': return new PrepaidEscapeError({code: 'empty_request', local: false, cause: error})
    default: return undefined
  }
}

/**
 * Decode `PrepaidEscaped` and `PrepaidBatchEscaped` from logs emitted by one Settlement. Logs from
 * any other address, and other events, are skipped; a removed (reorganized) log is refused.
 * @param logs Receipt logs or a bounded `eth_getLogs` window.
 * @param settlement Approved Settlement proxy.
 */
export function decodePrepaidEscapeLogs(logs: readonly Log[], settlement: Address): PrepaidEscapeEvents {
  const events: PrepaidEscapeEvents = {escaped: [], batches: []}
  for (const log of logs) {
    if (!same(log.address, settlement)) continue
    let decoded: {eventName: string; args: unknown}
    try { decoded = decodeEventLog({abi: settlementAbi, data: log.data, topics: log.topics, strict: true}) } catch { continue }
    if (decoded.eventName !== 'PrepaidEscaped' && decoded.eventName !== 'PrepaidBatchEscaped') continue
    if (log.removed) throw new TasraError('prepaid escape log was removed by a reorganization')
    const a = decoded.args as Record<string, unknown>
    if (decoded.eventName === 'PrepaidEscaped') events.escaped.push({slotId: a.slotId as Hex, requestId: a.requestId as Hex, refunded: a.refunded as bigint})
    else events.batches.push({slotId: a.slotId as Hex, caller: a.caller as Address, refunded: a.refunded as bigint, requestCount: a.requestCount as bigint})
  }
  return events
}

/** Exactly one batch for this slot and caller, and one `PrepaidEscaped` per request in order. */
function verifyEvents(logs: readonly Log[], d: PrepaidEscapeDeployment, slot: Hex, ids: readonly Hex[], caller: Address): {refunded: bigint; refunds: {requestId: Hex; refunded: bigint}[]} {
  const {escaped, batches} = decodePrepaidEscapeLogs(logs, d.settlement)
  const refunds = escaped.map(e => ({requestId: e.requestId.toLowerCase() as Hex, refunded: e.refunded, slot: e.slotId}))
  const total = refunds.reduce((sum, r) => sum + r.refunded, 0n)
  const [batch] = batches
  if (batches.length !== 1 || !batch || !same(batch.slotId, slot) || !same(batch.caller, caller) || batch.requestCount !== BigInt(ids.length)
    || batch.refunded !== total || refunds.length !== ids.length
    || refunds.some((r, i) => !same(r.slot, slot) || r.requestId !== ids[i] || r.refunded <= 0n)) throw new TasraError('escape events differ from the submitted call')
  return {refunded: total, refunds: refunds.map(({requestId, refunded}) => ({requestId, refunded}))}
}

function validateRecord(d: PrepaidEscapeDeployment, original: PrepaidEscapeRecord): PrepaidEscapeRecord {
  const record = structuredClone(original), tx = record?.transaction
  if (!record || record.schema !== 1 || !tx) throw new TasraError('invalid prepaid escape record')
  const {slot, ids} = requestList(record.slotId, record.requestIds)
  if (ids.length > MAX_ESCAPE_PER_CALL || !same(record.escapeId, prepaidEscapeId(d, slot, ids))
    || tx.chainId !== d.chainId || typeof tx.from !== 'string' || !ADDRESS.test(tx.from) || ZERO_ADDRESS.test(tx.from) || !same(tx.to, d.settlement)
    || !same(tx.data, encodeFunctionData({abi: settlementAbi, functionName: 'escapePrepaid', args: [slot, ids]})) || tx.value !== '0'
    || !Number.isSafeInteger(tx.nonce) || tx.nonce < 0 || typeof tx.gas !== 'string' || !/^[1-9][0-9]{0,19}$/.test(tx.gas) || BigInt(tx.gas) >= 1n << 64n
    || typeof tx.gasPrice !== 'string' || !/^[1-9][0-9]{0,38}$/.test(tx.gasPrice) || BigInt(tx.gasPrice) >= 1n << 128n) throw new TasraError('invalid prepaid escape record')
  return {...record, slotId: slot, requestIds: ids}
}

function sameTransaction(tx: {to: Address | null; from: Address; input: Hex; value: bigint; nonce: number; type: string; gas: bigint; gasPrice?: bigint; chainId?: number},
  record: PrepaidEscapeRecord['transaction']): boolean {
  return tx.to !== null && same(tx.to, record.to) && same(tx.from, record.from) && same(tx.input, record.data) && tx.value === 0n
    && tx.nonce === record.nonce && tx.type === 'legacy' && tx.gas === BigInt(record.gas) && tx.gasPrice === BigInt(record.gasPrice)
    && (tx.chainId === undefined || tx.chainId === record.chainId)
}

const notFound = (error: unknown, name: string) => isViemError(error, name)

async function escapeCall(client: PublicClient, d: PrepaidEscapeDeployment, slot: Hex, ids: Hex[], signer: WalletClient<Transport, Chain, Account>,
  payer: Account, payerChain: Chain, opts: {maxGas: bigint; maxGasPrice: bigint; persist: EscapePrepaidArgs['persist']; confirmations: number; receiptTimeout: number; signal?: AbortSignal}): Promise<PrepaidEscapeCallResult> {
  const escapeId = prepaidEscapeId(d, slot, ids), signal = opts.signal
  const data = encodeFunctionData({abi: settlementAbi, functionName: 'escapePrepaid', args: [slot, ids]})
  signal?.throwIfAborted()
  // The contract's own checks at the current head; a refusal is named and nothing is sent.
  try { await client.call({account: payer, to: d.settlement, data, batch: false}) } catch (error) {
    throw decodePrepaidEscapeRevert(error) ?? revertError(error, 'prepaid escape simulation refused')
  }
  const [gasPrice, gas, nonce] = await Promise.all([
    client.getGasPrice(), client.estimateGas({account: payer, to: d.settlement, data, value: 0n}),
    client.getTransactionCount({address: payer.address, blockTag: 'pending'}),
  ])
  if (gas <= 0n || gas > opts.maxGas || gasPrice <= 0n || gasPrice > opts.maxGasPrice) throw new TasraError('prepaid escape exceeds the native gas budget')
  const record: PrepaidEscapeRecord = {schema: 1, escapeId, slotId: slot, requestIds: [...ids],
    transaction: {chainId: d.chainId, from: payer.address, to: d.settlement, data, value: '0', nonce, gas: gas.toString(), gasPrice: gasPrice.toString()}}
  // A local signer signs before the journal, so the exact hash is durable before any broadcast.
  let raw: Hex | undefined, transactionHash: Hex | undefined
  if (payer.type === 'local') {
    raw = await signer.signTransaction({account: payer, chain: payerChain, to: d.settlement, data, value: 0n, nonce, gas, gasPrice, type: 'legacy'})
    const signed = parseTransaction(raw), sender = await recoverTransactionAddress({serializedTransaction: raw as Parameters<typeof recoverTransactionAddress>[0]['serializedTransaction']})
    if (signed.type !== 'legacy' || signed.chainId !== d.chainId || !same(sender, payer.address) || !signed.to || !same(signed.to, d.settlement)
      || !signed.data || !same(signed.data, data) || (signed.value ?? 0n) !== 0n || signed.nonce !== nonce || signed.gas !== gas
      || signed.gasPrice !== gasPrice) throw new TasraError('signed transaction differs from the prepared escape')
    transactionHash = keccak256(raw)
  }
  signal?.throwIfAborted()
  await opts.persist({phase: 'prepared', record: structuredClone(record), ...(transactionHash ? {transactionHash} : {})})
  try {
    // Exactly one RPC submission; viem's generic send may otherwise retry or switch method.
    if (raw !== undefined) {
      const returned = await signer.request({method: 'eth_sendRawTransaction', params: [raw]}, {retryCount: 0})
      if (transactionHash === undefined || typeof returned !== 'string' || !same(returned, transactionHash)) throw new TasraError('RPC returned another signed transaction hash')
    } else {
      transactionHash = await signer.request({method: 'eth_sendTransaction', params: [{from: payer.address, to: d.settlement, data, value: '0x0',
        nonce: toHex(nonce), gas: toHex(gas), gasPrice: toHex(gasPrice), type: '0x0', chainId: toHex(d.chainId)}]}, {retryCount: 0})
    }
    if (typeof transactionHash !== 'string' || !HEX32.test(transactionHash) || ZERO32.test(transactionHash)) throw new TasraError('invalid prepaid escape transaction hash')
    const sent = transactionHash
    await opts.persist({phase: 'submitted', escapeId, transactionHash: sent})
    const mined = await untilAborted(pollTransactionReceipt(client, sent, {confirmations: opts.confirmations, timeoutMs: opts.receiptTimeout, signal}), signal)
    if (!same(mined.transactionHash, sent) || mined.status !== 'success') throw new TasraError('prepaid escape transaction reverted or was replaced')
    const transaction = await untilAborted(client.getTransaction({hash: sent}), signal)
    if (!sameTransaction(transaction, record.transaction) || transaction.blockHash === null || !same(transaction.blockHash, mined.blockHash)) throw new TasraError('mined transaction differs from the prepared escape')
    const {refunded, refunds} = verifyEvents(mined.logs, d, slot, ids, payer.address)
    const minedBlock = await untilAborted(client.getBlock({blockNumber: mined.blockNumber}), signal)
    if (minedBlock.hash === null || !same(minedBlock.hash, mined.blockHash)) throw new TasraError('prepaid escape receipt reorganized')
    await opts.persist({phase: 'confirmed', escapeId, transactionHash: sent, blockHash: mined.blockHash, refunded: refunded.toString()})
    return {escapeId, requestIds: [...ids], transactionHash: sent, blockNumber: mined.blockNumber, blockHash: mined.blockHash, refunded, refunds}
  } catch (cause) {
    throw new PrepaidEscapeUncertainError({escapeId, requestIds: ids, ...(transactionHash ? {transactionHash} : {}), cause})
  }
}

async function escape(client: PublicClient, d: PrepaidEscapeDeployment, original: EscapePrepaidArgs): Promise<PrepaidEscapeResult> {
  // Snapshot caller-owned inputs before the first await.
  const args = {...original}, {slot, ids} = requestList(args.slotId, args.requestIds)
  const signer = args.signer, payer: Account = {...signer?.account}, payerChain = {...signer?.chain} as Chain
  const confirmations = args.confirmations ?? 1, receiptTimeout = args.receiptTimeoutMs ?? 60_000
  if (typeof args.maxGas !== 'bigint' || typeof args.maxGasPrice !== 'bigint' || args.maxGas <= 0n || args.maxGas >= 1n << 64n
    || args.maxGasPrice <= 0n || args.maxGasPrice >= 1n << 128n || typeof args.persist !== 'function') throw new TasraError('Invalid prepaid escape gas budget or journal')
  if (!Number.isSafeInteger(confirmations) || confirmations < 1 || confirmations > 64
    || !Number.isSafeInteger(receiptTimeout) || receiptTimeout < 1 || receiptTimeout > 120_000) throw new TasraError('Invalid prepaid escape confirmations or timeout')
  if (payer.type !== 'local' && payer.type !== 'json-rpc') throw new TasraError('prepaid escape requires an EOA gas payer')
  if (payerChain.id !== d.chainId || await chainIdOf(signer) !== d.chainId) throw new TasraError('prepaid escape signer chain mismatch')
  args.signal?.throwIfAborted()
  refuseUnlessOpen(await observe(client, d, slot, ids))
  const calls: PrepaidEscapeCallResult[] = []
  for (let offset = 0; offset < ids.length; offset += MAX_ESCAPE_PER_CALL) {
    calls.push(await escapeCall(client, d, slot, ids.slice(offset, offset + MAX_ESCAPE_PER_CALL), signer, payer, payerChain,
      {maxGas: args.maxGas, maxGasPrice: args.maxGasPrice, persist: args.persist, confirmations, receiptTimeout, signal: args.signal}))
  }
  return {slotId: slot, refunded: calls.reduce((sum, c) => sum + c.refunded, 0n), calls}
}

async function reconcile(client: PublicClient, d: PrepaidEscapeDeployment, original: ReconcileEscapeArgs): Promise<PrepaidEscapeResolution> {
  const record = validateRecord(d, original.record), hash = original.transactionHash, confirmations = original.confirmations ?? 1
  if (hash !== undefined && (typeof hash !== 'string' || !HEX32.test(hash) || ZERO32.test(hash))) throw new TasraError('Invalid prepaid escape transaction hash')
  if (!Number.isSafeInteger(confirmations) || confirmations < 1 || confirmations > 64) throw new TasraError('Invalid prepaid escape confirmations')
  const at = await observeHead(client, d, BigInt(confirmations - 1))
  const [receipt, transaction] = hash === undefined ? [null, null] : await Promise.all([
    client.getTransactionReceipt({hash}).catch((e: unknown) => { if (notFound(e, 'TransactionReceiptNotFoundError')) return null; throw e }),
    client.getTransaction({hash}).catch((e: unknown) => { if (notFound(e, 'TransactionNotFoundError')) return null; throw e }),
  ])
  const [requests, nonce] = await Promise.all([
    Promise.all(record.requestIds.map(async requestId => {
      const [settled, escapedAt] = await Promise.all([readAt(client, d.settlement, at, 'prepaidSettled', [record.slotId, requestId]),
        readAt(client, d.settlement, at, 'prepaidEscapedAt', [record.slotId, requestId])])
      if (typeof settled !== 'boolean' || typeof escapedAt !== 'bigint' || (escapedAt !== 0n && !settled)) throw new TasraError('invalid prepaid escape state')
      return escapedAt === 0n ? {requestId, settled} : {requestId, settled, escapedAt: date(escapedAt)}
    })),
    client.getTransactionCount({address: record.transaction.from, blockNumber: at.blockNumber}),
  ])
  const base = {escapeId: record.escapeId, blockNumber: at.blockNumber, blockHash: at.blockHash, requests, ...(hash ? {transactionHash: hash} : {})}
  let result: PrepaidEscapeResolution
  if (receipt && receipt.blockNumber <= at.blockNumber) {
    if (!transaction || !same(receipt.transactionHash, hash!) || !sameTransaction(transaction, record.transaction)
      || transaction.blockHash === null || !same(transaction.blockHash, receipt.blockHash)) throw new TasraError('candidate transaction differs from the prepared escape')
    const minedBlock = await client.getBlock({blockNumber: receipt.blockNumber})
    if (minedBlock.hash === null || !same(minedBlock.hash, receipt.blockHash)) throw new TasraError('prepaid escape receipt reorganized')
    if (receipt.status === 'success') {
      const {refunded} = verifyEvents(receipt.logs, d, record.slotId, record.requestIds, record.transaction.from)
      if (requests.some(r => r.escapedAt === undefined)) throw new TasraError('mined escape is not reflected in prepaidEscapedAt')
      result = {...base, state: 'escaped', refunded}
    } else result = {...base, state: 'reverted'}
  } else if (requests.every(r => r.settled)) result = {...base, state: 'completed'}
  // The nonce is spent at the observed depth, yet some request is still open: whatever spent it
  // did not escape this call (a successful escape completes every request atomically).
  else if (nonce > record.transaction.nonce) result = {...base, state: 'not-escaped'}
  else result = {...base, state: 'uncertain'}
  await recheck(client, at)
  return result
}

/**
 * Bind the payer-side prepaid timeout-escape client to one approved deployment.
 * Exposes no governance action: the escape delay is set only by the Settlement owner (timelock).
 * @param client Trusted bounded public RPC client with canonical EIP-1898 reads; use retryCount: 0.
 * @param deployment Independently approved chain ID and Settlement proxy.
 */
export function createPrepaidEscapeClient(client: PublicClient, deployment: PrepaidEscapeDeployment): PrepaidEscapeClient {
  const d: PrepaidEscapeDeployment = {chainId: deployment.chainId, settlement: deployment.settlement}
  validateDeployment(d)
  return Object.freeze({
    escapableAt: async (args: {slotId: Hex; requestIds: readonly Hex[]}) => {
      const {slot, ids} = requestList(args?.slotId, args?.requestIds)
      return observe(client, d, slot, ids)
    },
    escapePrepaid: (args: EscapePrepaidArgs) => escape(client, d, args),
    reconcileEscape: (args: ReconcileEscapeArgs) => reconcile(client, d, args),
  })
}
