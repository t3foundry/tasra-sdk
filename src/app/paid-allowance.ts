// ADR-0090 D1-D5, application side: a pool of allowance LANES per slot, so a paid operation is
// debited by an accountant-quorum voucher instead of waiting for its own on-chain reservation.
//
//   lane = one allowance at a time (+ one reserved ahead) and a strictly serial `seq`.
//
// - L lanes (default min(streams, 8)) let L voucher rounds run at once; each lane's rounds are
//   serialized by the store lock of that lane, so `seq` never forks.
// - The lane journal is written BEFORE a voucher is requested: (allowance, seq, request, payment,
//   quote block), then the verified partials, then the aggregate. A resume therefore asks for the
//   SAME seq and request at the SAME quote block; a member that already journaled them answers with
//   its stored, deterministic partial. The aggregate is also saved under the request
//   (`pav-<request>`) before the lane advances, so the operation finds it after any crash.
// - Allowances are fixed-amount. A replacement is reserved in the background once the current
//   one's remainder is below 25 % of its amount or less than 10 minutes of its life remain, and it
//   takes over when the current one can no longer fund an operation.
// - A definite refusal (every member that did not sign refused; none was unreachable) retires the
//   lane: its seq may be claimed at some members by a request that can now never complete. The
//   operation then falls back to a per-operation reservation (paid-operation.ts). Unreachable
//   members leave the debit pending for the same seq and request.
//
// Reservations use the dedicated gas payer under the same durable payer claim as per-operation
// reservations (paid-reservation.ts), and the same in-process payer queue.
//
// Capability discovery: none exists on the network for allowances, so the path is enabled only by
// the explicit `PaidOperationConfig.allowances` option (D5: readers first; the application asserts
// every reader on the deployment is at the ADR-0090 version).

import {keccak256, toHex, type Account, type Address, type Chain, type Hex, type LocalAccount, type PublicClient, type Transport, type WalletClient} from 'viem'
import {allowanceActionBits, allowanceFunds, ALLOWANCE_ACTIONS, prepaidAllowanceIntentTypedData, prepaidRequestId, type AllowanceAction, type DebitVoucherWire,
  type PaymentIntentWire, type PrepaidAllowanceIntentWire} from '../committee/payment.js'
import {collectDebitVoucher, DebitVoucherError, prepaidAllowanceId, reconcilePrepaidAllowance, reservePrepaidAllowance, ALLOWANCE_MAX_LIFETIME_SECS,
  type DebitPartialWire, type PrepaidAllowanceReservationRecord} from '../chain/allowance.js'
import {PaidReservationUncertainError} from '../chain/reservation.js'
import type {DiscoveredPaymentFields, PaidOperationContext, PrepaidDeployment} from '../chain/prepaid.js'
import {TasraError} from '../errors.js'
import type {ApplicationStore} from './ready-slot.js'
import {withDedicatedPayer} from './payer-queue.js'
import {releaseApplicationPayerClaim, withApplicationPayerClaim} from './paid-reservation.js'
import {HEX32, paidRecordKey} from './paid-keys.js'

/** Explicit, default-off allowance funding for paid operations (ADR-0090). */
export interface PaidAllowanceOptions {
  /**
   * Explicit opt-in. Set it only when every reader on the deployment (agent, verifiers, keepers,
   * accountants) is at the ADR-0090 version: the network advertises no capability for it.
   */
  enabled: boolean
  /** Escrow locked per allowance, TASRA base units. Allowances are fixed-amount; a top-up is a new one. */
  amount: bigint
  /** Per-operation cap of each allowance (default the operation limit `limits.maxCost`); at most `amount`. */
  maxOpCost?: bigint
  /** Funded actions (default every action an allowance can fund). */
  actions?: readonly AllowanceAction[]
  /** Allowance lifetime, 900..3600 s (default 3600, the protocol maximum). */
  lifetimeSecs?: number
  /** Expected concurrent operations; lanes default to min(streams, 8). Default 1. */
  streams?: number
  /** Lane count override, 1..8. */
  lanes?: number
  /** Reserve replacements in the background (default true). */
  reserveAhead?: boolean
  /** Per-accountant debit request timeout, ms (default 15000). */
  debitTimeoutMs?: number
}

/** Remainder fraction (numerator / 4) below which a replacement is reserved ahead. */
const LOW_REMAINDER_QUARTERS = 1n
/** Remaining life below which a replacement is reserved ahead, seconds. */
const LOW_LIFE_SECS = 600
/** An operation must expire at least this long before its allowance (clock skew), seconds. */
const EXPIRY_MARGIN_SECS = 30
/** A pending debit's quote block is re-chosen (when no member signed yet) after this age, seconds. */
const QUOTE_REUSE_SECS = 20
const MAX_LANES = 8
const MAX_RETIRED = 16

/** What paid-operation.ts needs from the pool. */
export interface AllowanceEnv {
  client: PublicClient
  deployment: PrepaidDeployment & {beacon: Address}
  creator: Pick<LocalAccount, 'address' | 'signTypedData'>
  gasPayer: WalletClient<Transport, Chain, Account>
  store: ApplicationStore
  accountantUrls: readonly string[]
  allowLocalHttp?: boolean
  limits: {maxCost: bigint; maxGas: bigint; maxGasPrice: bigint}
  options: PaidAllowanceOptions
}

/** The lane an operation was assigned: its allowance and the payment fields it must sign. */
export interface AllowanceTicket {
  /** Lane index. */
  lane: number
  /** Allowance the payment names. */
  allowanceId: Hex
  /** Verification and keeper fields copied from the allowance (coordinator from current discovery). */
  fields: DiscoveredPaymentFields
}

/** The allowance path cannot fund this operation; nothing more will be requested for it. Fall back to a per-operation reservation. */
export class AllowanceRefusedError extends TasraError {
  /** Stable reason. */
  readonly code = 'allowance-refused' as const
  constructor(message: string, cause?: unknown) { super(message, {retryable: false, cause}) }
}

/** Accountants were unreachable: the debit stays pending for the same seq and request; resume retries it. */
export class AllowanceUnavailableError extends TasraError {
  /** Stable reason. */
  readonly code = 'allowance-unavailable' as const
  constructor(message: string, cause?: unknown) { super(message, {retryable: true, cause}) }
}

interface LaneAllowance {
  id: Hex
  intent: PrepaidAllowanceIntentWire
  /** `signing`: intent signed, nothing persisted for the transaction yet (nothing was broadcast). */
  phase: 'signing' | 'prepared' | 'submitted' | 'confirmed'
  record?: PrepaidAllowanceReservationRecord
  transactionHash?: Hex
  assignmentBlock?: Hex
}
interface LaneDebit {
  seq: number
  requestId: Hex
  payment: PaymentIntentWire
  quoteBlock: Hex
  quotedAt: number
  partials: DebitPartialWire[]
  voucher?: DebitVoucherWire
}
interface LaneCurrent extends LaneAllowance {
  seq: number
  cumulative: string
  previous?: DebitVoucherWire
  pending?: LaneDebit
}
interface LaneState {
  schema: 1
  lane: number
  slot: Hex
  current?: LaneCurrent
  next?: LaneAllowance
  retired?: Hex[]
}
interface StoredVoucher { schema: 1; voucher: DebitVoucherWire }

const now = () => Math.floor(Date.now() / 1000)
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/**
 * Validate the allowance options against the operation limits.
 * @param options - Allowance options.
 * @param limits - Operation limits.
 */
export function validateAllowanceOptions(options: PaidAllowanceOptions, limits: {maxCost: bigint}): void {
  if (!options || typeof options !== 'object' || options.enabled !== true) throw new TasraError('Allowance funding needs an explicit enabled: true')
  const cap = options.maxOpCost ?? limits.maxCost
  if (typeof options.amount !== 'bigint' || options.amount <= 0n || options.amount >= 1n << 256n || typeof cap !== 'bigint' || cap <= 0n || cap > options.amount
    || limits.maxCost > options.amount) throw new TasraError('Allowance amount must be positive and cover the per-operation cap')
  const life = options.lifetimeSecs ?? ALLOWANCE_MAX_LIFETIME_SECS
  if (!Number.isSafeInteger(life) || life < 900 || life > ALLOWANCE_MAX_LIFETIME_SECS) throw new TasraError('Allowance lifetime must be 900..3600 seconds')
  if (options.actions) allowanceActionBits(options.actions)
  if (options.streams !== undefined && (!Number.isSafeInteger(options.streams) || options.streams < 1)) throw new TasraError('Allowance streams must be a positive integer')
  if (options.lanes !== undefined && (!Number.isSafeInteger(options.lanes) || options.lanes < 1 || options.lanes > MAX_LANES)) throw new TasraError('Allowance lanes must be 1..8')
  const timeout = options.debitTimeoutMs ?? 15_000
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000) throw new TasraError('Invalid allowance debit timeout')
}

/**
 * Lane count: `lanes`, else min(streams, 8).
 * @param options - Allowance options.
 */
export function allowanceLaneCount(options: PaidAllowanceOptions): number {
  return options.lanes ?? Math.min(options.streams ?? 1, MAX_LANES)
}

function laneKey(d: PrepaidDeployment, slot: Hex, lane: number): string {
  const scope = keccak256(toHex(`${d.chainId}:${d.settlement.toLowerCase()}:${slot.toLowerCase()}`)).slice(2, 34)
  return `pal-${scope}-${lane}`
}
function voucherKey(requestId: Hex): string {
  if (!HEX32.test(requestId)) throw new TasraError('Invalid request ID')
  return `pav-${requestId.slice(2).toLowerCase()}`
}

async function loadLane(store: ApplicationStore, key: string, lane: number, slot: Hex): Promise<LaneState> {
  const state = await store.load<LaneState>(key)
  if (state === undefined) return {schema: 1, lane, slot}
  if (!state || state.schema !== 1 || state.lane !== lane || !same(state.slot, slot)) throw new TasraError('Invalid allowance lane journal')
  return state
}

/**
 * The aggregated voucher journaled for a request, if any.
 * @param store - Application store.
 * @param requestId - Operation request ID.
 */
export async function journaledAllowanceVoucher(store: ApplicationStore, requestId: Hex): Promise<DebitVoucherWire | undefined> {
  const saved = await store.load<StoredVoucher>(voucherKey(requestId))
  if (saved === undefined) return undefined
  if (!saved || saved.schema !== 1 || !same(saved.voucher.request_id, requestId)) throw new TasraError('Invalid journaled debit voucher')
  return saved.voucher
}

const remaining = (c: LaneCurrent) => BigInt(c.intent.amount) - BigInt(c.cumulative)
function low(c: LaneCurrent | undefined): boolean {
  if (!c) return true
  const amount = BigInt(c.intent.amount)
  return remaining(c) * 4n < amount * LOW_REMAINDER_QUARTERS || c.intent.expires_at - now() < LOW_LIFE_SECS
}
function sameSharing(fields: DiscoveredPaymentFields, intent: PrepaidAllowanceIntentWire): boolean {
  const a = fields.keeper_assignment, b = intent.keeper_assignment
  const key = (k: number[]) => toHex(Uint8Array.from(k))
  return fields.chain_id === intent.chain_id && same(fields.settlement, intent.settlement) && same(fields.slot, intent.slot)
    && a.key_epoch === b.key_epoch && a.committee_version === b.committee_version && a.threshold === b.threshold
    && a.contributors.length === b.contributors.length && a.contributors.every((k, i) => key(k) === key(b.contributors[i]!))
}
/** Can this lane's current allowance fund one more operation (without asking anyone)? */
function usable(c: LaneCurrent | undefined, env: AllowanceEnv, context: PaidOperationContext, action: AllowanceAction, expires: number): boolean {
  return c !== undefined && c.phase === 'confirmed' && c.pending === undefined && remaining(c) >= env.limits.maxCost
    && allowanceFunds(c.intent.actions, action) && c.intent.expires_at >= expires + EXPIRY_MARGIN_SECS && sameSharing(context.intentFields, c.intent)
}

/** Lanes with a voucher round running in this process (advisory: the store lock is what serializes). */
const busy = new Set<string>()
/** Background reservations running in this process, per lane. Bounded by lanes x slots in use. */
const refilling = new Map<string, Promise<void>>()
const MAX_REFILLING = 256
const cursors = new Map<string, number>()

/**
 * Pick a lane whose current allowance can fund this operation, or undefined (fall back to a
 * per-operation reservation). Starts background reservations for missing or low lanes.
 * @param env - Allowance environment.
 * @param context - Fresh discovery for this operation.
 * @param operation - The paid action and the payment expiry.
 */
export async function selectAllowanceLane(env: AllowanceEnv, context: PaidOperationContext, operation: {action: AllowanceAction; expires: number}): Promise<AllowanceTicket | undefined> {
  const slot = context.intentFields.slot, lanes = allowanceLaneCount(env.options), scope = laneKey(env.deployment, slot, 0)
  const start = cursors.get(scope) ?? 0
  let chosen: AllowanceTicket | undefined
  const candidates: number[] = []
  for (let i = 0; i < lanes; i++) candidates.push((start + i) % lanes)
  // Lanes idle in this process first; a busy one only serializes behind its round.
  candidates.sort((a, b) => Number(busy.has(laneKey(env.deployment, slot, a))) - Number(busy.has(laneKey(env.deployment, slot, b))))
  for (const lane of candidates) {
    const key = laneKey(env.deployment, slot, lane)
    const state = await loadLane(env.store, key, lane, slot)
    if (env.options.reserveAhead !== false && (low(state.current) || state.current?.phase !== 'confirmed') && !state.next) refillLane(env, context, lane)
    if (!chosen && (usable(state.current, env, context, operation.action, operation.expires) || (state.next?.phase === 'confirmed' && !state.current?.pending))) {
      const current = usable(state.current, env, context, operation.action, operation.expires) ? state.current! : await promote(env, key, lane, slot, context, operation)
      if (current) {
        chosen = {lane, allowanceId: current.id, fields: fieldsFor(current.intent, context)}
        cursors.set(scope, (lane + 1) % lanes)
      }
    }
  }
  return chosen
}

/** Swap in the reserved-ahead allowance when the current one cannot fund the operation. */
async function promote(env: AllowanceEnv, key: string, lane: number, slot: Hex, context: PaidOperationContext, operation: {action: AllowanceAction; expires: number}): Promise<LaneCurrent | undefined> {
  return env.store.withLock(key, async () => {
    const state = await loadLane(env.store, key, lane, slot)
    if (usable(state.current, env, context, operation.action, operation.expires)) return state.current!
    if (state.current?.pending || state.next?.phase !== 'confirmed') return undefined
    const next: LaneCurrent = {...state.next, seq: 0, cumulative: '0'}
    if (!usable(next, env, context, operation.action, operation.expires)) return undefined
    await env.store.save(key, {...state, current: next, next: undefined, retired: retire(state)} satisfies LaneState)
    return next
  })
}
function retire(state: LaneState): Hex[] {
  return [...state.retired ?? [], ...state.current ? [state.current.id] : []].slice(-MAX_RETIRED)
}
function fieldsFor(intent: PrepaidAllowanceIntentWire, context: PaidOperationContext): DiscoveredPaymentFields {
  return {chain_id: intent.chain_id, settlement: intent.settlement, key_registry: intent.key_registry, slot: intent.slot,
    verification_epoch: intent.verification_epoch, verification_seed: intent.verification_seed, verification_root: intent.verification_root,
    verification_registry_size: intent.verification_registry_size, verification_committee: intent.verification_committee,
    verification_quorum: intent.verification_quorum,
    keeper_assignment: {...structuredClone(intent.keeper_assignment), coordinator: [...context.intentFields.keeper_assignment.coordinator]}}
}

/**
 * Start (once per lane in this process) a background reservation for a lane that lacks a usable
 * or reserved-ahead allowance. Failures are kept on the lane journal state only; they never fail an operation.
 */
function refillLane(env: AllowanceEnv, context: PaidOperationContext, lane: number): void {
  const key = laneKey(env.deployment, context.intentFields.slot, lane)
  if (refilling.has(key) || refilling.size >= MAX_REFILLING) return
  const work = reserveForLane(env, context, lane).then(() => {}, () => {}).finally(() => refilling.delete(key))
  refilling.set(key, work)
}

/**
 * Reserve (or reconcile) one lane's next allowance now. Exposed for applications that want lanes
 * ready before the first operation; operations otherwise trigger it in the background.
 * @param env - Allowance environment.
 * @param context - Fresh discovery for the slot (verification epoch and keeper sharing of the allowance).
 * @param lane - Lane index.
 * @param signal - Cancellation (honoured until the reservation is prepared).
 */
export async function reserveForLane(env: AllowanceEnv, context: PaidOperationContext, lane: number, signal?: AbortSignal): Promise<'reserved' | 'pending' | 'not-needed'> {
  const slot = context.intentFields.slot, key = laneKey(env.deployment, slot, lane), d = env.deployment, store = env.store
  const payer = env.gasPayer.account.address
  // Reconcile an earlier uncertain reservation first; never sign a second one beside it.
  const before = await loadLane(store, key, lane, slot)
  if (before.next?.record && before.next.phase !== 'confirmed') {
    const {state, allowance} = await reconcilePrepaidAllowance(env.client, d, before.next.record)
    if (state === 'uncertain') return 'pending'
    await releaseApplicationPayerClaim(env.client, store, d.chainId, before.next.record.transaction.from, before.next.id, state === 'not-reserved')
    await store.withLock(key, async () => {
      const s = await loadLane(store, key, lane, slot)
      if (!s.next || !same(s.next.id, before.next!.id)) return
      await store.save(key, {...s, next: state === 'reserved' ? {...s.next, phase: 'confirmed', assignmentBlock: allowance.assignmentBlock} : undefined} satisfies LaneState)
    })
    return state === 'reserved' ? 'reserved' : 'pending'
  }
  if (before.next?.phase === 'confirmed' || (before.current && !low(before.current) && before.current.phase === 'confirmed')) return 'not-needed'
  const options = env.options, life = options.lifetimeSecs ?? ALLOWANCE_MAX_LIFETIME_SECS
  const unsigned: Omit<PrepaidAllowanceIntentWire, 'signature'> = {chain_id: d.chainId, settlement: d.settlement, key_registry: d.keyRegistry, slot,
    intent_nonce: toHex(globalThis.crypto.getRandomValues(new Uint8Array(32))), amount: options.amount.toString(),
    max_op_cost: (options.maxOpCost ?? env.limits.maxCost).toString(), actions: options.actions ? allowanceActionBits(options.actions) : ALLOWANCE_ACTIONS,
    expires_at: now() + life, verification_epoch: context.intentFields.verification_epoch, verification_seed: context.intentFields.verification_seed,
    verification_root: context.intentFields.verification_root, verification_registry_size: context.intentFields.verification_registry_size,
    verification_committee: context.intentFields.verification_committee, verification_quorum: context.intentFields.verification_quorum,
    keeper_assignment: structuredClone(context.intentFields.keeper_assignment)}
  const intent: PrepaidAllowanceIntentWire = {...unsigned, signature: await env.creator.signTypedData(prepaidAllowanceIntentTypedData(unsigned))}
  const id = prepaidAllowanceId(intent)
  const claimed = await store.withLock(key, async () => {
    const s = await loadLane(store, key, lane, slot)
    // A `signing` marker without a record was never broadcast (prepared is journaled first).
    if (s.next && s.next.phase !== 'signing') return false
    await store.save(key, {...s, next: {id, intent, phase: 'signing'}} satisfies LaneState)
    return true
  })
  if (!claimed) return 'pending'
  const update = (patch: Partial<LaneAllowance>, require: LaneAllowance['phase'][]) => store.withLock(key, async () => {
    const s = await loadLane(store, key, lane, slot)
    if (!s.next || !same(s.next.id, id) || !require.includes(s.next.phase)) throw new TasraError('Allowance lane changed during its reservation')
    await store.save(key, {...s, next: {...s.next, ...patch}} satisfies LaneState)
  })
  try {
    const result = await withDedicatedPayer(`${d.chainId}-${payer.toLowerCase()}`, () => withApplicationPayerClaim(store, d.chainId, payer, id, claim =>
      reservePrepaidAllowance(env.client, env.gasPayer, d, intent, {accountantUrls: env.accountantUrls, allowLocalHttp: env.allowLocalHttp,
        maxGas: env.limits.maxGas, maxGasPrice: env.limits.maxGasPrice, signal, persist: async checkpoint => {
          if (checkpoint.phase === 'prepared') {
            // Journal first: a crash before the payer claim cannot have broadcast.
            await update({phase: 'prepared', record: checkpoint.record, ...(checkpoint.transactionHash ? {transactionHash: checkpoint.transactionHash} : {})}, ['signing'])
            await claim(checkpoint.record.transaction.nonce)
          } else if (checkpoint.phase === 'submitted') await update({phase: 'submitted', transactionHash: checkpoint.transactionHash}, ['prepared'])
          else await update({phase: 'confirmed', transactionHash: checkpoint.transactionHash}, ['prepared', 'submitted'])
        }})))
    await update({assignmentBlock: result.allowance.assignmentBlock}, ['confirmed'])
    // Take over at once when the lane has nothing usable and no debit in flight.
    await store.withLock(key, async () => {
      const s = await loadLane(store, key, lane, slot)
      if (s.next?.phase !== 'confirmed' || !same(s.next.id, id) || s.current?.pending) return
      if (s.current && s.current.phase === 'confirmed' && remaining(s.current) >= env.limits.maxCost && s.current.intent.expires_at - now() > LOW_LIFE_SECS / 2) return
      await store.save(key, {...s, current: {...s.next, seq: 0, cumulative: '0'}, next: undefined, retired: retire(s)} satisfies LaneState)
    })
    return 'reserved'
  } catch (error) {
    if (error instanceof PaidReservationUncertainError) return 'pending'
    // Nothing prepared means nothing broadcast: drop the marker so a later attempt can sign anew.
    await store.withLock(key, async () => {
      const s = await loadLane(store, key, lane, slot)
      if (s.next && same(s.next.id, id) && s.next.phase === 'signing') await store.save(key, {...s, next: undefined} satisfies LaneState)
    })
    throw error
  }
}

async function freshQuoteBlock(client: PublicClient): Promise<Hex> {
  const head = await client.getBlock({blockTag: 'latest'})
  if (head.hash === null || !HEX32.test(head.hash) || BigInt(now()) - head.timestamp > 20n || head.timestamp - BigInt(now()) > 2n) throw new Error('debit quote head is stale or unavailable')
  return head.hash
}

/** Whether a pending debit of another request may still be completed (its operation can resume). */
async function resumable(store: ApplicationStore, debit: LaneDebit): Promise<boolean> {
  if (debit.payment.expires <= now() + EXPIRY_MARGIN_SECS) return false
  const record = await store.load<{phase?: string}>(paidRecordKey(debit.requestId)).catch(() => undefined)
  return record?.phase === 'reserving'
}

/**
 * Obtain (or re-read) the debit voucher of one allowance-backed payment on its lane. Journals the
 * debit before any request; resumes the same seq, request and quote block. Throws
 * {@link AllowanceRefusedError} (lane retired, fall back) or {@link AllowanceUnavailableError} (retry later).
 * @param env - Allowance environment.
 * @param ticket - The lane the payment was signed for.
 * @param payment - Creator-signed allowance payment without a voucher.
 * @param signal - Cancellation of the network round (an aborted round stays pending).
 */
export async function obtainAllowanceVoucher(env: AllowanceEnv, ticket: {lane: number}, payment: PaymentIntentWire, signal?: AbortSignal): Promise<DebitVoucherWire> {
  const requestId = prepaidRequestId(payment), store = env.store
  const saved = await journaledAllowanceVoucher(store, requestId)
  if (saved) return saved
  if (payment.allowance_id === undefined) throw new TasraError('Payment names no allowance')
  const slot = payment.slot, key = laneKey(env.deployment, slot, ticket.lane)
  busy.add(key)
  try {
    return await store.withLock(key, async () => {
      let state = await loadLane(store, key, ticket.lane, slot)
      const save = async (next: LaneState) => { await store.save(key, next); state = next }
      const retireLane = async (why: string, cause?: unknown): Promise<never> => {
        const promoted = state.next?.phase === 'confirmed' ? {...state.next, seq: 0, cumulative: '0'} : undefined
        await save({...state, current: promoted, next: promoted ? undefined : state.next, retired: retire(state)})
        throw new AllowanceRefusedError(why, cause)
      }
      const current = state.current
      if (!current || !same(current.id, payment.allowance_id!)) throw new AllowanceRefusedError('the lane no longer holds this allowance')
      // A completed round of another request whose lane advance was interrupted.
      if (current.pending?.voucher && !same(current.pending.requestId, requestId)) await finalize(store, key, state, current, current.pending, save)
      const other = state.current?.pending
      if (other && !same(other.requestId, requestId)) {
        if (!await resumable(store, other)) return retireLane('a debit of an abandoned or expired operation holds this lane')
        // Complete the earlier request first (its operation resumes onto the journaled voucher).
        await runRound(env, state, state.current!, other, save, retireLane, signal)
      }
      const lane = state.current!
      if (lane.pending && lane.pending.voucher) return (await finalize(store, key, state, lane, lane.pending, save))
      let debit = lane.pending
      if (!debit) {
        // The accountants judge cost against the remainder; an empty allowance cannot fund anything.
        if (remaining(lane) <= 0n) return retireLane('allowance exhausted')
        if (lane.intent.expires_at < payment.expires + EXPIRY_MARGIN_SECS) throw new AllowanceRefusedError('allowance expires before the operation')
        let quoteBlock: Hex
        try { quoteBlock = await freshQuoteBlock(env.client) } catch (error) { throw new AllowanceUnavailableError('no fresh quote block for the debit', error) }
        debit = {seq: lane.seq + 1, requestId, payment: structuredClone(payment), quoteBlock, quotedAt: now(), partials: []}
        // The lane journal BEFORE any request: a resume asks for this exact seq and request.
        await save({...state, current: {...lane, pending: debit}})
      } else if (debit.partials.length === 0 && now() - debit.quotedAt > QUOTE_REUSE_SECS) {
        try { debit = {...debit, quoteBlock: await freshQuoteBlock(env.client), quotedAt: now()} } catch (error) { throw new AllowanceUnavailableError('no fresh quote block for the debit', error) }
        await save({...state, current: {...lane, pending: debit}})
      }
      const voucher = await runRound(env, state, state.current!, debit, save, retireLane, signal)
      return voucher
    })
  } finally { busy.delete(key) }
}

/** One voucher round for `debit` on the lane's current allowance; advances the lane on success. */
async function runRound(env: AllowanceEnv, state: LaneState, lane: LaneCurrent, debit: LaneDebit, save: (s: LaneState) => Promise<void>,
  retireLane: (why: string, cause?: unknown) => Promise<never>, signal?: AbortSignal): Promise<DebitVoucherWire> {
  const key = laneKey(env.deployment, lane.intent.slot, state.lane)
  try {
    const {voucher, partials} = await collectDebitVoucher(env.client, env.deployment, {payment: debit.payment, seq: debit.seq, previous: lane.previous,
      quoteBlock: debit.quoteBlock, maxOpCost: BigInt(lane.intent.max_op_cost)}, {accountantUrls: env.accountantUrls, allowLocalHttp: env.allowLocalHttp,
      requestTimeoutMs: env.options.debitTimeoutMs, signal, known: debit.partials})
    const done: LaneDebit = {...debit, partials, voucher}
    await save({...state, current: {...lane, pending: done}})
    return await finalize(env.store, key, state, {...lane, pending: done}, done, save)
  } catch (error) {
    if (error instanceof DebitVoucherError) {
      const known = new Map(debit.partials.map(p => [p.identifier, p]))
      for (const o of error.outcomes) if (o.kind === 'partial') known.set(o.partial.identifier, o.partial)
      await save({...state, current: {...lane, pending: {...debit, partials: [...known.values()]}}})
      if (error.definite) return retireLane('the accountants refused the debit', error)
      throw new AllowanceUnavailableError('accountants unavailable for the debit; resume requests the same seq', error)
    }
    if (error instanceof AllowanceRefusedError || error instanceof AllowanceUnavailableError) throw error
    throw new AllowanceUnavailableError('debit voucher round failed', error)
  }
}

/** Journal the voucher under its request, then advance the lane past its seq. */
async function finalize(store: ApplicationStore, _key: string, state: LaneState, lane: LaneCurrent, debit: LaneDebit, save: (s: LaneState) => Promise<void>): Promise<DebitVoucherWire> {
  const voucher = debit.voucher!
  if (!await journaledAllowanceVoucher(store, debit.requestId)) await store.save(voucherKey(debit.requestId), {schema: 1, voucher} satisfies StoredVoucher)
  await save({...state, current: {...lane, seq: debit.seq, cumulative: voucher.cumulative, previous: voucher, pending: undefined}})
  return voucher
}

/**
 * Inspect the lanes of a slot: allowance, seq, cumulative and any pending debit (diagnostics).
 * @param store - Application store.
 * @param deployment - Approved deployment.
 * @param slot - Slot.
 * @param lanes - Lane count.
 */
export async function inspectAllowanceLanes(store: ApplicationStore, deployment: PrepaidDeployment, slot: Hex, lanes: number):
  Promise<{lane: number; allowanceId?: Hex; phase?: string; seq?: number; cumulative?: string; amount?: string; expiresAt?: number; pending?: {seq: number; requestId: Hex; partials: number}; next?: {allowanceId: Hex; phase: string}; retired: number}[]> {
  const out = []
  for (let lane = 0; lane < lanes; lane++) {
    const s = await loadLane(store, laneKey(deployment, slot, lane), lane, slot)
    out.push({lane, ...s.current ? {allowanceId: s.current.id, phase: s.current.phase, seq: s.current.seq, cumulative: s.current.cumulative,
      amount: s.current.intent.amount, expiresAt: s.current.intent.expires_at,
      ...s.current.pending ? {pending: {seq: s.current.pending.seq, requestId: s.current.pending.requestId, partials: s.current.pending.partials.length}} : {}} : {},
    ...s.next ? {next: {allowanceId: s.next.id, phase: s.next.phase}} : {}, retired: s.retired?.length ?? 0})
  }
  return out
}

/** Test hook: wait for every background reservation started in this process. */
export async function settleAllowanceRefills(): Promise<void> {
  await Promise.all([...refilling.values()])
}
