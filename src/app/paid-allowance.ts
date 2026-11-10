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
// - Every aggregated voucher is pushed to every accountant in the background
//   (`POST .../vouchers`, fire-and-forget, bounded). Members learn a seq's aggregate from the next
//   debit's `previous`, but the LAST seq of a lane is nobody's `previous`, and which seq is last is
//   unknowable when it is made (the lane may retire, the allowance expire, the process stop), so
//   each one is pushed; the push is one small idempotent request per member. The outcome is
//   journaled per allowance (`pap-<allowance>`): a retiring lane or an allowance close to expiry
//   re-pushes its last voucher once to the members that did not acknowledge it. A push never
//   blocks or fails an operation.
//
// - ADR-0090 D7 draw lanes: a session grant's messages pay its exact verifier draw (the keeper
//   refuses any other), which follows the beacon every epoch, while a regular lane keeps its
//   allowance's draw. Two sets of draw lanes per slot (lane `DRAW_LANE_BASE + (epoch % 2) x 8 + j`)
//   hold one allowance on one draw each: the set of the grant's epoch serves its messages, the
//   other is reserved for the next draw as soon as a message sees the beacon there (through a
//   pinned, verified discovery), replacing the draw two epochs back, which no keeper admits any
//   more. A message whose draw has no lane waits (bounded) for the reservation running for it.
//   Every draw-lane allowance is counted, before anything is broadcast, until its expiry plus the
//   accountants' close grace; at `maxDrawAllowances` per slot a message pays per operation.
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
import {collectDebitVoucher, DebitVoucherError, prepaidAllowanceId, pushDebitVoucher, reconcilePrepaidAllowance, reservePrepaidAllowance, ALLOWANCE_MAX_LIFETIME_SECS,
  type DebitPartialWire, type PrepaidAllowanceReservationRecord} from '../chain/allowance.js'
import {accountantEndpoints, PaidReservationUncertainError} from '../chain/reservation.js'
import type {DiscoveredPaymentFields, PaidOperationContext, PrepaidDeployment} from '../chain/prepaid.js'
import {TasraError} from '../errors.js'
import type {ApplicationStore} from './ready-slot.js'
import {withDedicatedPayer} from './payer-queue.js'
import {releaseApplicationPayerClaim, withApplicationPayerClaim} from './paid-reservation.js'
import {HEX32, paidRecordKey} from './paid-keys.js'
import {headFollowerOf} from '../chain/headFollower.js'
import {saveAll, withCommit} from './store-commit.js'

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
  /**
   * ADR-0090 D7: escrow locked per DRAW-lane allowance (default `amount`). A session grant's
   * messages must pay its exact verifier draw, which moves every beacon epoch; draw lanes hold
   * allowances reserved on one draw each (see {@link selectAllowanceLane}). At least the
   * per-operation cap.
   */
  drawAmount?: bigint
  /**
   * Most draw-lane allowances per slot whose escrow may still be locked (reserved, not yet past
   * `expiresAt` plus the accountants' close grace), 1..1024 (default 4 x lanes, i.e. at most
   * `4 x lanes x drawAmount` locked beside the regular lanes' `2 x lanes x amount`). At the
   * bound a session message pays per operation instead of reserving another allowance. On a
   * beacon faster than (lifetime + close grace) / 2 per epoch, size `drawAmount` down and this up.
   */
  maxDrawAllowances?: number
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
/**
 * Draw lanes (ADR-0090 D7): lane indices `DRAW_LANE_BASE + (epoch % 2) * MAX_LANES + j`, j < lanes.
 * Keepers admit a session grant only at the beacon's latest or previous epoch, so at most two draws
 * are ever wanted at once: one lane set per epoch parity, re-reserved (the stale draw retired)
 * every second epoch.
 */
const DRAW_LANE_BASE = MAX_LANES
/** The accountants' default close grace after `expiresAt` (`DEFAULT_CLOSE_GRACE_SECS`): an allowance's escrow is locked until about then. */
const CLOSE_GRACE_SECS = 600
/** A reserve-ahead for a draw is not attempted again within this time after one ran (ms). */
const AHEAD_RETRY_MS = 5_000

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
  /**
   * ADR-0090 D7 reserve-ahead: a fresh payment discovery pinned to `epoch`
   * (`discoverPaidOperationContext({verificationEpoch})`, which verifies the draw at a canonical
   * head and refuses one that is not the beacon's latest or previous). Without it a new draw's
   * lane is reserved only once a message needs it.
   */
  discover?: (slot: Hex, epoch: bigint) => Promise<PaidOperationContext>
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
  /**
   * Draw lanes only: every allowance this lane signed whose escrow may still be locked, until
   * `expiresAt + CLOSE_GRACE_SECS`. Journaled with the reservation's `signing` marker, before any
   * broadcast; removed only when nothing was broadcast or the reservation is known not mined.
   */
  held?: {id: Hex; until: number}[]
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
  if (options.drawAmount !== undefined && (typeof options.drawAmount !== 'bigint' || options.drawAmount >= 1n << 256n || options.drawAmount < cap
    || limits.maxCost > options.drawAmount)) throw new TasraError('Allowance draw amount must cover the per-operation cap')
  if (options.maxDrawAllowances !== undefined && (!Number.isSafeInteger(options.maxDrawAllowances) || options.maxDrawAllowances < 1
    || options.maxDrawAllowances > 1024)) throw new TasraError('Allowance maxDrawAllowances must be 1..1024')
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
type DrawFields = Pick<DiscoveredPaymentFields, 'verification_epoch' | 'verification_seed' | 'verification_root' | 'verification_registry_size' | 'verification_committee' | 'verification_quorum'>
/** The verifier draw an allowance's vouchers name (all six fields: the payment copies them from the allowance). */
function sameDraw(fields: DrawFields, intent: DrawFields): boolean {
  return fields.verification_epoch === intent.verification_epoch && same(fields.verification_seed, intent.verification_seed)
    && same(fields.verification_root, intent.verification_root) && fields.verification_registry_size === intent.verification_registry_size
    && fields.verification_committee === intent.verification_committee && fields.verification_quorum === intent.verification_quorum
}
/**
 * Does an allowance (its balance and pending debits aside) fund `action` for an operation expiring
 * at `expires`, under `context`'s keeper sharing (and exactly its verifier draw when `drawPinned`)?
 * The one predicate both lane selection ({@link usable}) and readiness ({@link LaneWork}) apply.
 */
function serves(intent: PrepaidAllowanceIntentWire, context: PaidOperationContext, action: AllowanceAction, expires: number, drawPinned = false): boolean {
  return allowanceFunds(intent.actions, action) && intent.expires_at >= expires + EXPIRY_MARGIN_SECS && sameSharing(context.intentFields, intent)
    && (!drawPinned || sameDraw(context.intentFields, intent))
}
/** Can this lane's current allowance fund one more operation (without asking anyone)? */
function usable(c: LaneCurrent | undefined, env: AllowanceEnv, context: PaidOperationContext, action: AllowanceAction, expires: number, drawPinned = false): boolean {
  return c !== undefined && c.phase === 'confirmed' && c.pending === undefined && remaining(c) >= env.limits.maxCost
    && serves(c.intent, context, action, expires, drawPinned)
}
/**
 * A confirmed allowance that will soon stop funding operations like `operation` (by the time its
 * payment would expire it is within {@link LOW_LIFE_SECS} of the allowance's own expiry), or one on
 * a keeper sharing the slot no longer has: reserve its replacement ahead, exactly as for a `low()`
 * one. Without it a current allowance whose life fell below the payment lifetime plus the margin
 * (but above `low()`'s bound) could fund no operation and started no replacement either: every
 * operation on it paid per operation.
 */
function endingFor(c: LaneCurrent, context: PaidOperationContext, operation: {expires: number}): boolean {
  return c.intent.expires_at - EXPIRY_MARGIN_SECS - operation.expires < LOW_LIFE_SECS || !sameSharing(context.intentFields, c.intent)
}

/**
 * The operation a lane must fund. `drawPinned`: only an allowance drawn on exactly the discovered
 * verifier draw, and no reserved-ahead promotion (ADR-0090 D7: a session grant's opening, which
 * verifiers judge at the LIVE beacon, and its messages, whose keeper refuses any draw but the grant's).
 */
export interface AllowanceOperation {action: AllowanceAction; expires: number; drawPinned?: boolean}

/** Voucher rounds running or queued in this process, per lane (advisory: the store lock is what serializes). */
const busyRounds = new Map<string, number>()
const busy = {
  has: (key: string) => (busyRounds.get(key) ?? 0) > 0,
  add: (key: string) => { busyRounds.set(key, (busyRounds.get(key) ?? 0) + 1) },
  delete: (key: string) => { const n = (busyRounds.get(key) ?? 0) - 1; if (n > 0) busyRounds.set(key, n); else busyRounds.delete(key) },
}
/**
 * Lanes handed out by a selection in this process whose voucher round has not started yet: lane key
 * to the expiry times (ms) of those claims. Advisory, exactly like `busy`: it only spreads concurrent
 * selections over a slot's lanes. Without it every selection running at once read the same cursor
 * and the same idle lanes (the debit's pending journal is written only once its round starts, after
 * the payment is signed and journaled), so they all took ONE lane and their voucher rounds, each a
 * full accountant round trip under that lane's lock, ran one after another. A claim is consumed when
 * a round on its lane starts and otherwise lapses after {@link CLAIM_MS}; nothing is refused on it
 * (the store lock and the lane journal decide what may be debited).
 */
const claims = new Map<string, number[]>()
const CLAIM_MS = 30_000
const MAX_CLAIMS_PER_LANE = 1024
function liveClaims(key: string): number[] {
  const at = Date.now(), live = (claims.get(key) ?? []).filter(until => until > at)
  if (live.length > 0) claims.set(key, live); else claims.delete(key)
  return live
}
/** In-process work on a lane: selections not yet debiting plus voucher rounds running or queued. */
function laneLoad(key: string): number {
  return liveClaims(key).length + (busyRounds.get(key) ?? 0)
}
function claimLane(key: string): void {
  const live = liveClaims(key)
  if (live.length < MAX_CLAIMS_PER_LANE) claims.set(key, [...live, Date.now() + CLAIM_MS])
}
function consumeClaim(key: string): void {
  const live = liveClaims(key)
  if (live.length > 0) { live.shift(); if (live.length > 0) claims.set(key, live); else claims.delete(key) }
}
/** Background reservations running in this process, per lane. Bounded by lanes x slots in use. */
const refilling = new Map<string, Promise<void>>()
/** The draw each running reservation reserves on (keyed like `refilling`). */
const refillingDraw = new Map<string, DrawFields>()
const MAX_REFILLING = 256
/** How long an operation with no usable lane waits for this slot's in-flight lane reservation. */
const LANE_WAIT_MS = 20_000
/** Most times {@link prepareAllowanceLane} waits for a lane reservation already running before it gives up. */
const PREPARE_ROUNDS = 8
const cursors = new Map<string, number>()

/**
 * Pick a lane whose current allowance can fund this operation, or undefined (fall back to a
 * per-operation reservation). Starts background reservations for missing or low lanes. When no
 * lane can fund it but one of this slot's lanes is being reserved in this process, waits for that
 * reservation (at most {@link LANE_WAIT_MS}) and selects once more: a per-operation reservation
 * would queue behind it on the same gas payer, so the fallback costs a second transaction and at
 * least twice the wait (long enough, under contention, to outlive the verifier epoch it signed).
 * @param env - Allowance environment.
 * @param context - Fresh discovery for this operation.
 * @param operation - The paid action and the payment expiry.
 */
export async function selectAllowanceLane(env: AllowanceEnv, context: PaidOperationContext, operation: AllowanceOperation): Promise<AllowanceTicket | undefined> {
  const select = async () => await selectLane(env, context, operation) ?? (operation.drawPinned ? selectDrawLane(env, context, operation) : undefined)
  const chosen = await select()
  // A session message on the previous epoch while the beacon is already at the next: reserve the
  // next draw's lanes now, so the messages after the grant's refresh find them ready.
  if (operation.drawPinned) reserveAheadForBeacon(env, context)
  if (chosen) return chosen
  const slot = context.intentFields.slot, lanes = allowanceLaneCount(env.options), draw = context.intentFields
  // What this operation can be funded from once it lands: any regular lane reservation, or for a
  // pinned draw only those on exactly its draw, its draw lanes and a reserve-ahead for it (whose
  // discovery runs before any of its lanes is refilling).
  const relevant = (): Promise<void>[] => {
    const inFlight: Promise<void>[] = []
    for (let lane = 0; lane < lanes; lane++) {
      const key = laneKey(env.deployment, slot, lane), work = refilling.get(key), on = refillingDraw.get(key)
      if (work && (!operation.drawPinned || (on && sameDraw(draw, on)))) inFlight.push(work)
    }
    if (operation.drawPinned) {
      for (let j = 0; j < lanes; j++) {
        const work = refilling.get(laneKey(env.deployment, slot, drawLaneIndex(draw.verification_epoch, j)))
        if (work) inFlight.push(work)
      }
      const ahead = aheads.get(aheadKey(env.deployment, slot, draw.verification_epoch))
      if (ahead) inFlight.push(ahead)
    }
    return inFlight
  }
  const inFlight = relevant()
  if (inFlight.length === 0) return undefined
  // Select once more as each of them ends; the first selection that finds a lane wins. Only the
  // reservations running NOW are waited for (one a re-selection starts is not), within the bound.
  let timer: ReturnType<typeof setTimeout> | undefined
  const found = new Promise<AllowanceTicket | undefined>(resolve => {
    let left = inFlight.length
    const done = (ticket: AllowanceTicket | undefined) => { if (ticket) resolve(ticket); else if (--left === 0) resolve(undefined) }
    for (const work of inFlight) work.then(select).then(done, () => done(undefined))
  })
  try {
    return await Promise.race([found, new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), LANE_WAIT_MS) })])
  } finally { clearTimeout(timer) }
}

/** The draw lane `j` of the lane set for `epoch`'s parity. */
function drawLaneIndex(epoch: number, j: number): number {
  return DRAW_LANE_BASE + (epoch % 2) * MAX_LANES + j
}
function aheadKey(d: PrepaidDeployment, slot: Hex, epoch: number): string {
  return `${laneKey(d, slot, 0)}:draw:${epoch}`
}
/** Draw-lane allowances one lane may hold (locked escrow), from `maxDrawAllowances` over every draw lane of the slot. */
function heldPerDrawLane(options: PaidAllowanceOptions): number {
  const lanes = allowanceLaneCount(options)
  return Math.max(1, Math.floor((options.maxDrawAllowances ?? 4 * lanes) / (2 * lanes)))
}
/** A draw lane's allowance on this draw that needs no replacement. */
function drawGood(c: LaneCurrent | undefined, draw: DrawFields): boolean {
  return c !== undefined && c.phase === 'confirmed' && sameDraw(draw, c.intent) && !low(c)
}
/** Does draw lane `s` need a reservation for `draw` (nothing good on it, nothing confirmed reserved ahead for it)? */
function drawNeeds(s: LaneState, draw: DrawFields): boolean {
  return !drawGood(s.current, draw) && !(s.next?.phase === 'confirmed' && sameDraw(draw, s.next.intent))
}

/**
 * ADR-0090 D7: a session operation's lane on its exact draw, among the draw lanes (the regular
 * lanes were tried first and are never retired for a session). A miss starts one draw-lane
 * reservation for this draw (the caller then waits for it, bounded); a lane whose current
 * allowance runs low reserves its replacement on the same draw in the background.
 */
async function selectDrawLane(env: AllowanceEnv, context: PaidOperationContext, operation: AllowanceOperation): Promise<AllowanceTicket | undefined> {
  const slot = context.intentFields.slot, lanes = allowanceLaneCount(env.options), draw = context.intentFields, epoch = draw.verification_epoch
  const scope = `${laneKey(env.deployment, slot, 0)}:draw`, start = cursors.get(scope) ?? 0
  const candidates: number[] = []
  for (let i = 0; i < lanes; i++) candidates.push((start + i) % lanes)
  candidates.sort((a, b) => laneLoad(laneKey(env.deployment, slot, drawLaneIndex(epoch, a))) - laneLoad(laneKey(env.deployment, slot, drawLaneIndex(epoch, b))))
  let chosen: AllowanceTicket | undefined
  let needy: number | undefined
  // As in {@link selectLane}: a fitting lane with in-process work is taken only when no idle one fits.
  let loaded: {j: number; lane: number; key: string; current: LaneCurrent} | undefined
  const take = async (j: number, lane: number, key: string, current: LaneCurrent) => {
    chosen = {lane, allowanceId: current.id, fields: fieldsFor(current.intent, context)}
    cursors.set(scope, (j + 1) % lanes)
    claimLane(key)
    // Low on the draw it serves: its replacement on the same draw, in the background.
    if (env.options.reserveAhead !== false && drawNeeds(await loadLane(env.store, key, lane, slot), draw)) void refillDrawLane(env, context, j)
  }
  for (const j of candidates) {
    const lane = drawLaneIndex(epoch, j), key = laneKey(env.deployment, slot, lane)
    let state = await loadLane(env.store, key, lane, slot)
    if (state.current?.pending && !busy.has(key)) state = await completeInterruptedAdvance(env, key, lane, slot, state)
    if (state.current?.phase === 'confirmed' && state.current.seq > 0 && state.current.intent.expires_at - now() < LOW_LIFE_SECS) repushLast(env, state.current)
    const fits = usable(state.current, env, context, operation.action, operation.expires, true)
    if (!chosen && fits && laneLoad(key) > 0) {
      if (!loaded || laneLoad(key) < laneLoad(loaded.key)) loaded = {j, lane, key, current: state.current!}
    } else if (!chosen && (fits || (state.next?.phase === 'confirmed' && sameDraw(draw, state.next.intent) && !state.current?.pending))) {
      const current = fits ? state.current! : await promoteDraw(env, key, lane, slot, context, operation)
      if (current && !chosen) await take(j, lane, key, current)
    } else if (needy === undefined && drawNeeds(state, draw) && !refilling.has(key)) needy = j
  }
  if (!chosen && loaded) await take(loaded.j, loaded.lane, loaded.key, loaded.current)
  // One reservation per miss, and none when a regular lane is already being reserved on this very
  // draw (the selection before this one started it): the caller waits for that one instead.
  let regular = false
  for (let lane = 0; lane < lanes; lane++) {
    const d = refillingDraw.get(laneKey(env.deployment, slot, lane))
    if (d && sameDraw(draw, d)) regular = true
  }
  if (!chosen && needy !== undefined && !regular && env.options.reserveAhead !== false) void refillDrawLane(env, context, needy)
  return chosen
}

/** Swap in a draw lane's allowance reserved on this draw when the current one cannot fund the operation. */
async function promoteDraw(env: AllowanceEnv, key: string, lane: number, slot: Hex, context: PaidOperationContext, operation: {action: AllowanceAction; expires: number}): Promise<LaneCurrent | undefined> {
  return env.store.withLock(key, async () => {
    const state = await loadLane(env.store, key, lane, slot)
    if (usable(state.current, env, context, operation.action, operation.expires, true)) return state.current!
    if (state.current?.pending || state.next?.phase !== 'confirmed' || !sameDraw(context.intentFields, state.next.intent)) return undefined
    const next: LaneCurrent = {...state.next, seq: 0, cumulative: '0'}
    if (!usable(next, env, context, operation.action, operation.expires, true)) return undefined
    await env.store.save(key, {...state, current: next, next: undefined, retired: retire(state)} satisfies LaneState)
    repushLast(env, state.current)
    return next
  })
}

/** Start (once per lane in this process) a background draw-lane reservation on `context`'s (verified) draw. */
function refillDrawLane(env: AllowanceEnv, context: PaidOperationContext, j: number): Promise<void> {
  const lane = drawLaneIndex(context.intentFields.verification_epoch, j), key = laneKey(env.deployment, context.intentFields.slot, lane)
  const running = refilling.get(key)
  if (running) return running
  if (refilling.size >= MAX_REFILLING) return Promise.resolve()
  const work = reserveOnLane(env, context, lane, drawPlan(env, context)).then(() => {}, () => {}).finally(() => { refilling.delete(key); refillingDraw.delete(key) })
  refilling.set(key, work)
  refillingDraw.set(key, context.intentFields)
  return work
}

/** Reserve-ahead attempts per (slot, draw epoch) in this process: the running job, or when the last one ended. */
const aheads = new Map<string, Promise<void>>()
const aheadDone = new Map<string, number>()
const MAX_AHEADS = 256

/**
 * (a) A session operation pinned to epoch `e` while the beacon is at `e + 1`: the grant moves to
 * `e + 1` next, and its messages then need lanes on that draw. Discover it (a fresh, verified,
 * pinned discovery: never a draw from anywhere else) and reserve as many of its draw lanes as
 * `e`'s draw lanes have in use (at least one), in the background. Never blocks or fails the operation.
 */
function reserveAheadForBeacon(env: AllowanceEnv, context: PaidOperationContext): void {
  const epoch = context.intentFields.verification_epoch, beacon = context.beaconEpoch, slot = context.intentFields.slot
  if (env.options.reserveAhead === false || !env.discover || beacon === undefined || beacon !== BigInt(epoch) + 1n) return
  const next = epoch + 1, key = aheadKey(env.deployment, slot, next), at = Date.now()
  if (aheads.has(key) || at - (aheadDone.get(key) ?? -Infinity) < AHEAD_RETRY_MS || aheads.size >= MAX_AHEADS) return
  const discover = env.discover, lanes = allowanceLaneCount(env.options)
  const work = (async () => {
    let inUse = 0
    for (let j = 0; j < lanes; j++) {
      const s = await loadLane(env.store, laneKey(env.deployment, slot, drawLaneIndex(epoch, j)), drawLaneIndex(epoch, j), slot)
      if (s.current?.phase === 'confirmed' && sameDraw(context.intentFields, s.current.intent)) inUse = j + 1
    }
    const wanted: number[] = []
    for (let j = 0; j < Math.max(1, inUse); j++) {
      const lane = drawLaneIndex(next, j), s = await loadLane(env.store, laneKey(env.deployment, slot, lane), lane, slot)
      // Its draw is unknown until discovered; a lane already good on SOME draw of epoch `next` is that draw's.
      if (!(s.current?.phase === 'confirmed' && s.current.intent.verification_epoch === next && !low(s.current))
        && !(s.next?.phase === 'confirmed' && s.next.intent.verification_epoch === next)) wanted.push(j)
    }
    if (wanted.length === 0) return
    const drawn = await discover(slot, BigInt(next))
    if (drawn.intentFields.verification_epoch !== next || !same(drawn.intentFields.slot, slot) || drawn.intentFields.chain_id !== env.deployment.chainId
      || !same(drawn.intentFields.settlement, env.deployment.settlement)) return
    await Promise.all(wanted.map(j => refillDrawLane(env, drawn, j)))
  })().catch(() => {}).finally(() => { aheads.delete(key); aheadDone.set(key, Date.now()); if (aheadDone.size > MAX_AHEADS) aheadDone.delete(aheadDone.keys().next().value!) })
  aheads.set(key, work)
}

async function selectLane(env: AllowanceEnv, context: PaidOperationContext, operation: AllowanceOperation): Promise<AllowanceTicket | undefined> {
  const slot = context.intentFields.slot, lanes = allowanceLaneCount(env.options), scope = laneKey(env.deployment, slot, 0)
  const start = cursors.get(scope) ?? 0
  let chosen: AllowanceTicket | undefined
  const candidates: number[] = []
  for (let i = 0; i < lanes; i++) candidates.push((start + i) % lanes)
  // Lanes idle in this process first; a busy one only serializes behind its round.
  candidates.sort((a, b) => laneLoad(laneKey(env.deployment, slot, a)) - laneLoad(laneKey(env.deployment, slot, b)))
  // A lane that fits but already carries in-process work (judged at the moment of choosing, after
  // this selection's own reads, so selections running at once see each other's claims): taken only
  // when no idle lane fits, the least loaded first.
  let loaded: {lane: number; key: string; current: LaneCurrent} | undefined
  const take = (lane: number, key: string, current: LaneCurrent) => {
    chosen = {lane, allowanceId: current.id, fields: fieldsFor(current.intent, context)}
    cursors.set(scope, (lane + 1) % lanes)
    claimLane(key)
  }
  for (const lane of candidates) {
    const key = laneKey(env.deployment, slot, lane)
    let state = await loadLane(env.store, key, lane, slot)
    // A lane held by a debit whose voucher is already journaled (a stop between that journal and
    // the lane commit) is completed here, asking nobody: no selection would ever run a round on it.
    if (state.current?.pending && !busy.has(key)) state = await completeInterruptedAdvance(env, key, lane, slot, state)
    if (env.options.reserveAhead !== false && !state.next
      && (low(state.current) || state.current?.phase !== 'confirmed' || endingFor(state.current, context, operation))) refillLane(env, context, lane, operation)
    // Close to expiry the current allowance may see no further debit: make sure its last voucher reached the members.
    if (state.current?.phase === 'confirmed' && state.current.seq > 0 && state.current.intent.expires_at - now() < LOW_LIFE_SECS) repushLast(env, state.current)
    // A pinned draw never promotes: retiring a current allowance only because its draw is not this
    // session's would strand its balance for every other operation.
    const fits = usable(state.current, env, context, operation.action, operation.expires, operation.drawPinned)
    if (!chosen && fits && laneLoad(key) > 0) {
      if (!loaded || laneLoad(key) < laneLoad(loaded.key)) loaded = {lane, key, current: state.current!}
    } else if (!chosen && (fits || (!operation.drawPinned && state.next?.phase === 'confirmed' && !state.current?.pending))) {
      const current = fits ? state.current! : await promote(env, key, lane, slot, context, operation)
      if (current && !chosen) take(lane, key, current)
    }
  }
  if (!chosen && loaded) take(loaded.lane, loaded.key, loaded.current)
  return chosen
}

/**
 * Complete a lane advance interrupted after its voucher was journaled (`pav-` or the operation's
 * `reserved`, see {@link completedVoucher}): the advance, the voucher under its request and the
 * push journal in one commit under the lane and push locks, exactly what the round's own lane
 * commit would have published; then the push, in the background. A pending debit without a
 * journaled voucher, a lane that moved meanwhile or a failure leaves the lane as it was (its own
 * operation's resume still completes it).
 */
async function completeInterruptedAdvance(env: AllowanceEnv, key: string, lane: number, slot: Hex, seen: LaneState): Promise<LaneState> {
  const store = env.store, allowance = seen.current!.id
  try {
    if (!(seen.current!.pending!.voucher ?? await completedVoucher(store, seen.current!.pending!))) return seen
    const push = HEX32.test(allowance) ? pushKey(allowance) : undefined
    const done = await withCommit(store, [key, ...push ? [push] : []], async commit => {
      const state = await loadLane(store, key, lane, slot), current = state.current, pending = current?.pending
      if (!current || !pending || !same(current.id, allowance)) return {state}
      const voucher = pending.voucher ?? await completedVoucher(store, pending)
      if (!voucher || voucher.seq !== pending.seq || !same(voucher.allowance_id, allowance)) return {state}
      const next: LaneState = {...state, current: {...current, seq: pending.seq, cumulative: voucher.cumulative, previous: voucher, pending: undefined}}
      if (!await journaledAllowanceVoucher(store, pending.requestId)) commit.stage(voucherKey(pending.requestId), {schema: 1, voucher} satisfies StoredVoucher)
      commit.stage(key, next)
      if (push) {
        const journaled = await loadPush(store, allowance).catch(() => undefined)
        if (!journaled || journaled.voucher.seq < voucher.seq) commit.stage(push, {schema: 1, voucher, acked: [], repushed: false} satisfies PushRecord)
      }
      return {state: next, voucher}
    })
    if (done.voucher && push) { const voucher = done.voucher; background(() => sendAndJournal(env, voucher, accountantEndpoints(env, env.deployment.chainId))) }
    return done.state
  } catch { return seen }
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
    repushLast(env, state.current)
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
function refillLane(env: AllowanceEnv, context: PaidOperationContext, lane: number, operation: {expires: number}): void {
  const key = laneKey(env.deployment, context.intentFields.slot, lane)
  if (refilling.has(key) || refilling.size >= MAX_REFILLING) return
  const work = reserveOnLane(env, context, lane, operationPlan(env, context, operation)).then(() => {}, () => {}).finally(() => { refilling.delete(key); refillingDraw.delete(key) })
  refilling.set(key, work)
  refillingDraw.set(key, context.intentFields)
}

/**
 * Reserve (or reconcile) one lane's next allowance now. Exposed for applications that want lanes
 * ready before the first operation; operations otherwise trigger it in the background.
 * @param env - Allowance environment.
 * @param context - Fresh discovery for the slot (verification epoch and keeper sharing of the allowance).
 * @param lane - Lane index.
 * @param signal - Cancellation (honoured until the reservation is prepared).
 * @param ready - What the lane must be ready for (see {@link LaneReadiness}); unset, the plain `low()` rule.
 */
export async function reserveForLane(env: AllowanceEnv, context: PaidOperationContext, lane: number, signal?: AbortSignal, ready?: LaneReadiness):
  Promise<'reserved' | 'pending' | 'not-needed'> {
  if (ready) validateLaneReadiness(env, ready)
  const outcome = await reserveOnLane(env, context, lane, ready ? readinessPlan(env, ready) : regularPlan(env), signal)
  return outcome === 'capped' ? 'not-needed' : outcome
}

/**
 * Open one regular lane ahead of its first operation (see `prepareAllowances` in paid-operation.ts).
 * The reservation is {@link reserveForLane}'s, journaled phase by phase exactly as a background
 * refill: no other path. Before anything is discovered or signed:
 * - a reservation of this lane already running in this process (an operation's refill) is awaited,
 *   never doubled, and the lane judged again after it;
 * - a lane that needs nothing (a usable confirmed allowance, or a confirmed one reserved ahead)
 *   reports `not-needed` without a discovery, a signature or a send.
 * With `ready` ({@link LaneReadiness}) "needs nothing" means ready for the coming work: when the
 * current allowance is not confirmed, low, expires within `minLifetimeSecs`, or the lane cannot
 * fund `minOperations`, the NEXT allowance is reserved ahead (and the lane judged again). A lane
 * whose current allowance is spent takes its confirmed next over first, exactly as an operation
 * would; one still short while holding both throws {@link AllowanceCapacityError}, never a third.
 * Otherwise `discover` is called for a FRESH context (never one cached across lanes) and the lane is
 * reserved; the reservation is registered as this lane's refill, so an operation selecting meanwhile
 * waits for it (bounded) instead of starting its own.
 * @param env - Allowance environment.
 * @param slot - Slot.
 * @param lane - Regular lane index, 0..lanes-1.
 * @param discover - Fresh discovery for the slot (`fundedByAllowance`), called at most once per reservation.
 * @param signal - Cancellation (honoured until the reservation is prepared; afterwards it is reconciled).
 * @param ready - What the lane must be ready for (default: the plain `low()` rule).
 */
export async function prepareAllowanceLane(env: AllowanceEnv, slot: Hex, lane: number, discover: () => Promise<PaidOperationContext>, signal?: AbortSignal,
  ready: LaneReadiness = {}): Promise<'reserved' | 'pending' | 'not-needed'> {
  if (!HEX32.test(slot)) throw new TasraError('Invalid allowance slot')
  if (!Number.isSafeInteger(lane) || lane < 0 || lane >= allowanceLaneCount(env.options)) throw new TasraError('Allowance lane out of range')
  validateLaneReadiness(env, ready)
  if (ready.work && !same(ready.work.context.intentFields.slot, slot)) throw new TasraError('Readiness discovery is for another slot')
  const demanding = (ready.minOperations ?? 0) > 0 || (ready.minLifetimeSecs ?? 0) > 0 || ready.work !== undefined
  const key = laneKey(env.deployment, slot, lane), base = regularPlan(env), plan = demanding ? readinessPlan(env, ready) : base
  let reserved = false
  // Bounded: operations that keep restarting a failing refill of this lane leave it to them.
  for (let round = 0; ; round++) {
    signal?.throwIfAborted()
    if (round >= PREPARE_ROUNDS) throw new AllowanceUnavailableError('the lane is being reserved by operations; inspect it once they settle')
    const running = refilling.get(key)
    if (running) { await running; continue }
    const state = await loadLane(env.store, key, lane, slot)
    // An uncertain earlier reservation is reconciled by reserveForLane before anything new is signed.
    const uncertain = state.next?.record !== undefined && state.next.phase !== 'confirmed'
    if (!uncertain) {
      const verdict = laneVerdict(env, base, state, ready, demanding)
      if (verdict === 'ready') return reserved ? 'reserved' : 'not-needed'
      if (verdict === 'short') {
        // The current allowance is spent for operations (exactly when a fresh reservation would
        // replace it at once): take the confirmed reserved-ahead one over, as an operation's
        // promotion would, and judge again (the next round reserves the following one). Otherwise
        // the lane already holds its two allowances (2 x lanes x amount): never a third.
        if (state.current?.pending === undefined && plan.takeOver(state as LaneState & {next: LaneAllowance}) && await takeOverNext(env, key, lane, slot, plan)) continue
        throw new AllowanceCapacityError(lane, laneOperations(env, state, ready), ready)
      }
    }
    const context = await discover()
    signal?.throwIfAborted()
    const f = context.intentFields
    if (!same(f.slot, slot) || f.chain_id !== env.deployment.chainId || !same(f.settlement, env.deployment.settlement)) throw new TasraError('Discovery is for another slot or deployment')
    // An operation's refill started while discovering: judge the lane again once it ends.
    if (refilling.has(key)) continue
    const work = reserveForLane(env, context, lane, signal, demanding ? ready : undefined)
    const tracked = work.then(() => {}, () => {}).finally(() => { if (refilling.get(key) === tracked) { refilling.delete(key); refillingDraw.delete(key) } })
    refilling.set(key, tracked)
    refillingDraw.set(key, f)
    const outcome = await work
    // Pending (uncertain) is reported as is; a reservation is judged again against the coming work.
    if (outcome === 'pending' || (!demanding && outcome === 'reserved')) return outcome
    if (outcome === 'reserved') reserved = true
  }
}

/**
 * What a lane must be ready for, beyond today's `low()` rule ({@link prepareAllowanceLane}).
 * Unset (or 0) keeps the plain rule: a confirmed, not-low current allowance, or a confirmed one
 * reserved ahead, is enough.
 */
export interface LaneReadiness {
  /**
   * The lane must fund at least this many more operations at the per-operation cap
   * (`limits.maxCost`) from its current allowance and its reserved-ahead one together; only an
   * allowance that outlives `minLifetimeSecs` counts. At most 2 x floor(amount / maxCost).
   */
  minOperations?: number
  /**
   * The current allowance must outlive this many seconds, else the next one is reserved ahead (and
   * must outlive it). At most the allowance lifetime minus 120 s (minus `work.ttlSecs` with `work`).
   */
  minLifetimeSecs?: number
  /**
   * The operations the coming work runs ({@link LaneWork}). With it an allowance counts only when
   * lane selection would accept it for EVERY one of them, for an operation started at any moment
   * of `minLifetimeSecs`: the same predicate, never a looser one.
   */
  work?: LaneWork
}

/**
 * What the coming work's operations need of an allowance, judged by the predicate lane selection
 * applies ({@link selectAllowanceLane}): each action funded, the keeper sharing (key epoch,
 * committee version, threshold, contributors) of the fresh discovery `context`, and an expiry at
 * least `ttlSecs` (the operations' payment lifetime) plus the clock margin beyond the moment the
 * operation starts. A regular lane is never judged on its verifier draw (selection pins a draw only
 * for session grants, whose draw lanes are not prepared).
 */
export interface LaneWork {
  /** Fresh discovery of the slot (`fundedByAllowance`): the keeper sharing an operation would be paid under now. */
  context: PaidOperationContext
  /** The paid actions as payments carry them (`eoa-sign` on a threshold-ECDSA slot), 1..5 distinct. */
  actions: readonly AllowanceAction[]
  /** The operations' payment lifetime, 1..3600 s (`PaidOperationRequest.operation.ttlSecs`, default 600). */
  ttlSecs: number
}

/** The lane cannot hold what the coming work needs: it already holds a current and a reserved-ahead allowance. */
export class AllowanceCapacityError extends TasraError {
  /** Stable reason. */
  readonly code = 'allowance-capacity' as const
  constructor(readonly lane: number, readonly operations: number, ready: LaneReadiness) {
    super(`Allowance lane ${lane} can fund ${operations} operation(s) outliving ${ready.minLifetimeSecs ?? 0} s, below the ${ready.minOperations ?? 0} required; `
      + 'it already holds its current and one reserved-ahead allowance (at most 2 x lanes x amount locked): raise amount or lanes, or prepare again once the current one is spent', {retryable: false})
  }
}

/**
 * Validate a lane readiness request against the allowance options.
 * @param env - Allowance environment.
 * @param ready - Readiness request.
 */
export function validateLaneReadiness(env: AllowanceEnv, ready: LaneReadiness): void {
  const ops = ready.minOperations ?? 0, life = ready.minLifetimeSecs ?? 0, lifetime = env.options.lifetimeSecs ?? ALLOWANCE_MAX_LIFETIME_SECS
  const most = 2n * (env.options.amount / env.limits.maxCost)
  if (!Number.isSafeInteger(ops) || ops < 0 || BigInt(ops) > most) throw new TasraError(`Allowance minOperations must be 0..${most} (two allowances of amount / maxCost operations)`)
  if (!Number.isSafeInteger(life) || life < 0 || life > lifetime - 120) throw new TasraError(`Allowance minLifetimeSecs must be 0..${lifetime - 120} (the allowance lifetime minus 120 s)`)
  const work = ready.work
  if (work === undefined) return
  validateReadinessHorizon(env, life, work.ttlSecs)
  if (work.actions.length === 0 || new Set(work.actions).size !== work.actions.length) throw new TasraError('Allowance readiness actions must be distinct and non-empty')
  // An action the configured allowances never fund cannot be readied by any reservation.
  const funded = env.options.actions ? allowanceActionBits(env.options.actions) : ALLOWANCE_ACTIONS
  for (const action of work.actions) if (!allowanceFunds(funded, action)) throw new TasraError(`Allowances of this configuration do not fund ${String(action).slice(0, 32)}`)
}

/**
 * Validate that an operation of lifetime `ttlSecs` started at the end of a `minLifetimeSecs` horizon
 * can be funded by a fresh allowance at all ({@link LaneWork}).
 * @param env - Allowance environment.
 * @param minLifetimeSecs - Readiness horizon, seconds.
 * @param ttlSecs - The operations' payment lifetime, seconds.
 */
export function validateReadinessHorizon(env: AllowanceEnv, minLifetimeSecs: number, ttlSecs: number): void {
  const lifetime = env.options.lifetimeSecs ?? ALLOWANCE_MAX_LIFETIME_SECS
  if (!Number.isSafeInteger(ttlSecs) || ttlSecs < 1 || ttlSecs > 3600) throw new TasraError('Allowance readiness operation lifetime must be 1..3600 seconds')
  if (minLifetimeSecs + ttlSecs > lifetime - 120) {
    throw new TasraError(`Allowance minLifetimeSecs plus the operation lifetime (${ttlSecs} s) must be at most ${lifetime - 120} s: no allowance could fund an operation started at the end of the horizon`)
  }
}

/** Can a confirmed allowance fund every operation of `work` started at `at` (balance aside)? */
function servesWork(intent: PrepaidAllowanceIntentWire, work: LaneWork, at: number): boolean {
  return work.actions.every(action => serves(intent, work.context, action, at + work.ttlSecs))
}
/** Would a confirmed allowance ever fund `work` (its actions and keeper sharing; expiry aside)? A stale one never will. */
function compatible(intent: PrepaidAllowanceIntentWire, work: LaneWork): boolean {
  return work.actions.every(action => allowanceFunds(intent.actions, action)) && sameSharing(work.context.intentFields, intent)
}

/**
 * Operations the lane's confirmed allowances fund at the per-operation cap, counting only those
 * outliving `minLifetimeSecs` (with `work`: only those lane selection would accept for each of its
 * operations started at the end of that horizon).
 */
function laneOperations(env: AllowanceEnv, s: LaneState, ready: LaneReadiness): number {
  const horizon = ready.minLifetimeSecs ?? 0, at = now() + horizon, cap = env.limits.maxCost, work = ready.work
  const counts = (a: LaneAllowance) => a.phase === 'confirmed' && (work ? servesWork(a.intent, work, at) : a.intent.expires_at >= at + EXPIRY_MARGIN_SECS)
  let ops = 0n
  if (s.current && counts(s.current)) {
    const own = remaining(s.current) / cap - (s.current.pending ? 1n : 0n)
    if (own > 0n) ops += own
  }
  if (s.next && counts(s.next)) ops += BigInt(s.next.intent.amount) / cap
  return Number(ops)
}

/** Ready for the coming work, a reservation needed, or short with the lane full (current + a confirmed next). */
function laneVerdict(env: AllowanceEnv, plan: ReservePlan, s: LaneState, ready: LaneReadiness, demanding: boolean): 'ready' | 'reserve' | 'short' {
  if (!demanding) return plan.needed(s) ? 'reserve' : 'ready'
  const meets = laneOperations(env, s, ready) >= Math.max(ready.minOperations ?? 0, 1)
  // A reserved-ahead allowance that can never fund the work (another keeper sharing, an action it
  // does not fund) is replaced (`replaceNext`), never counted as the lane being full.
  if (s.next?.phase === 'confirmed') return meets ? 'ready' : ready.work && !compatible(s.next.intent, ready.work) ? 'reserve' : 'short'
  // No reserved-ahead allowance: the current one alone must be confirmed, not low, outlive the horizon and fund the work.
  return !plan.needed(s) && meets ? 'ready' : 'reserve'
}

/** Replace the current allowance with the confirmed reserved-ahead one when `plan.takeOver` allows it and no debit is pending. */
async function takeOverNext(env: AllowanceEnv, key: string, lane: number, slot: Hex, plan: ReservePlan, id?: Hex): Promise<boolean> {
  return env.store.withLock(key, async () => {
    const s = await loadLane(env.store, key, lane, slot)
    if (s.next?.phase !== 'confirmed' || (id !== undefined && !same(s.next.id, id)) || s.current?.pending) return false
    if (!plan.takeOver(s as LaneState & {next: LaneAllowance})) return false
    await env.store.save(key, {...s, current: {...s.next, seq: 0, cumulative: '0'}, next: undefined, retired: retire(s)} satisfies LaneState)
    repushLast(env, s.current)
    return true
  })
}

/** What one lane reservation reserves and when it takes over (regular lanes and draw lanes differ). */
interface ReservePlan {
  /** Does the lane (as loaded) need a new allowance at all? */
  needed(s: LaneState): boolean
  amount: bigint
  /** With the confirmed `s.next` (no debit pending on the current one): replace the current allowance now? */
  takeOver(s: LaneState & {next: LaneAllowance}): boolean
  /** Draw lanes: at most this many allowances held (escrow possibly locked) by the lane; journaled before any broadcast. */
  hold?: number
  /** A confirmed reserved-ahead allowance this reservation may replace (retire) instead of waiting behind it. */
  replaceNext?(next: LaneAllowance): boolean
}
function regularPlan(env: AllowanceEnv): ReservePlan {
  return {amount: env.options.amount,
    needed: s => !(s.next?.phase === 'confirmed' || (s.current && !low(s.current) && s.current.phase === 'confirmed')),
    takeOver: s => !(s.current && s.current.phase === 'confirmed' && remaining(s.current) >= env.limits.maxCost && s.current.intent.expires_at - now() > LOW_LIFE_SECS / 2)}
}
/** The regular plan, needing a reservation whenever the lane is not ready for `ready` (and holds no confirmed reserved-ahead allowance). */
function readinessPlan(env: AllowanceEnv, ready: LaneReadiness): ReservePlan {
  const plan = regularPlan(env), work = ready.work
  const needed = (s: LaneState) => laneVerdict(env, plan, s, ready, true) === 'reserve'
  if (!work) return {...plan, needed}
  return {...plan, needed,
    // As an operation's promotion would: a current allowance that cannot fund the work's next
    // operation (its balance, its expiry, a stale keeper sharing) gives way to the confirmed next.
    takeOver: s => plan.takeOver(s) || !s.current || !(s.current.phase === 'confirmed' && s.current.pending === undefined
      && remaining(s.current) >= env.limits.maxCost && servesWork(s.current.intent, work, now())),
    replaceNext: next => next.phase === 'confirmed' && !compatible(next.intent, work)}
}
/**
 * The regular plan for a background refill started by `operation`'s selection: a confirmed current
 * allowance {@link endingFor} it needs its replacement too, not only a `low()` one.
 */
function operationPlan(env: AllowanceEnv, context: PaidOperationContext, operation: {expires: number}): ReservePlan {
  const plan = regularPlan(env)
  return {...plan, needed: s => plan.needed(s) || (s.next === undefined && s.current?.phase === 'confirmed' && endingFor(s.current, context, operation))}
}
/** A draw lane on `context`'s draw: replaces an allowance of any other draw (only a stale one can be on its lane set) or a low one. */
function drawPlan(env: AllowanceEnv, context: PaidOperationContext): ReservePlan {
  const draw = context.intentFields
  return {amount: env.options.drawAmount ?? env.options.amount, hold: heldPerDrawLane(env.options), needed: s => drawNeeds(s, draw),
    // Left reserved ahead on an older draw (its take-over waited behind a debit): no session needs it any more.
    replaceNext: next => next.phase === 'confirmed' && !sameDraw(draw, next.intent),
    takeOver: s => !s.current || !sameDraw(s.next.intent, s.current.intent)
      || !(s.current.phase === 'confirmed' && remaining(s.current) >= env.limits.maxCost && s.current.intent.expires_at - now() > LOW_LIFE_SECS / 2)}
}
const unexpired = (held: LaneState['held']) => (held ?? []).filter(h => h.until > now())

async function reserveOnLane(env: AllowanceEnv, context: PaidOperationContext, lane: number, plan: ReservePlan, signal?: AbortSignal): Promise<'reserved' | 'pending' | 'not-needed' | 'capped'> {
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
      // Known not mined: it locks nothing, so it no longer counts against the lane's bound.
      const held = state === 'not-reserved' && s.held ? {held: s.held.filter(h => !same(h.id, before.next!.id))} : {}
      await store.save(key, {...s, ...held, next: state === 'reserved' ? {...s.next, phase: 'confirmed', assignmentBlock: allowance.assignmentBlock} : undefined} satisfies LaneState)
    })
    return state === 'reserved' ? 'reserved' : 'pending'
  }
  if (!plan.needed(before)) return 'not-needed'
  if (plan.hold !== undefined && unexpired(before.held).filter(h => !(before.next?.phase === 'signing' && same(h.id, before.next.id))).length >= plan.hold) return 'capped'
  const options = env.options, life = options.lifetimeSecs ?? ALLOWANCE_MAX_LIFETIME_SECS
  const unsigned: Omit<PrepaidAllowanceIntentWire, 'signature'> = {chain_id: d.chainId, settlement: d.settlement, key_registry: d.keyRegistry, slot,
    intent_nonce: toHex(globalThis.crypto.getRandomValues(new Uint8Array(32))), amount: plan.amount.toString(),
    max_op_cost: (options.maxOpCost ?? env.limits.maxCost).toString(), actions: options.actions ? allowanceActionBits(options.actions) : ALLOWANCE_ACTIONS,
    // Members measure the one-hour bound from the quote block (pinned to this observation below),
    // whose timestamp trails the clock: never exceed it, or every member refuses the archive.
    expires_at: Math.min(now() + life, Number(context.blockTimestamp) + ALLOWANCE_MAX_LIFETIME_SECS), verification_epoch: context.intentFields.verification_epoch, verification_seed: context.intentFields.verification_seed,
    verification_root: context.intentFields.verification_root, verification_registry_size: context.intentFields.verification_registry_size,
    verification_committee: context.intentFields.verification_committee, verification_quorum: context.intentFields.verification_quorum,
    keeper_assignment: structuredClone(context.intentFields.keeper_assignment)}
  const intent: PrepaidAllowanceIntentWire = {...unsigned, signature: await env.creator.signTypedData(prepaidAllowanceIntentTypedData(unsigned))}
  const id = prepaidAllowanceId(intent)
  const claimed = await store.withLock(key, async () => {
    const s = await loadLane(store, key, lane, slot)
    // A `signing` marker without a record was never broadcast (prepared is journaled first).
    const replaced = s.next?.phase === 'confirmed' && plan.replaceNext?.(s.next) ? s.next : undefined
    if (s.next && s.next.phase !== 'signing' && !replaced) return 'pending' as const
    // The bound is judged and the new allowance counted in the same durable save, before anything
    // is sent; a replaced `signing` marker was never broadcast and stops counting.
    let held: Pick<LaneState, 'held'> = {}
    if (plan.hold !== undefined) {
      const live = unexpired(s.held).filter(h => !(s.next?.phase === 'signing' && same(h.id, s.next.id)))
      if (live.length >= plan.hold) return 'capped' as const
      held = {held: [...live, {id, until: intent.expires_at + CLOSE_GRACE_SECS}]}
    }
    await store.save(key, {...s, ...held, ...replaced ? {retired: [...s.retired ?? [], replaced.id].slice(-MAX_RETIRED)} : {}, next: {id, intent, phase: 'signing'}} satisfies LaneState)
    return true
  })
  if (claimed !== true) return claimed
  const update = (patch: Partial<LaneAllowance>, require: LaneAllowance['phase'][]) => store.withLock(key, async () => {
    const s = await loadLane(store, key, lane, slot)
    if (!s.next || !same(s.next.id, id) || !require.includes(s.next.phase)) throw new TasraError('Allowance lane changed during its reservation')
    await store.save(key, {...s, next: {...s.next, ...patch}} satisfies LaneState)
  })
  try {
    const result = await withDedicatedPayer(`${d.chainId}-${payer.toLowerCase()}`, () => withApplicationPayerClaim(store, d.chainId, payer, id, claim =>
      reservePrepaidAllowance(env.client, env.gasPayer, d, intent, {accountantUrls: env.accountantUrls, allowLocalHttp: env.allowLocalHttp, quoteBlock: context.blockHash,
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
    await takeOverNext(env, key, lane, slot, plan, id)
    return 'reserved'
  } catch (error) {
    if (error instanceof PaidReservationUncertainError) return 'pending'
    // Nothing prepared means nothing broadcast: drop the marker so a later attempt can sign anew.
    await store.withLock(key, async () => {
      const s = await loadLane(store, key, lane, slot)
      if (s.next && same(s.next.id, id) && s.next.phase === 'signing') {
        await store.save(key, {...s, ...s.held ? {held: s.held.filter(h => !same(h.id, id))} : {}, next: undefined} satisfies LaneState)
      }
    })
    throw error
  }
}

async function freshQuoteBlock(client: PublicClient): Promise<Hex> {
  // A live head follower's tip is the same head; the freshness rule below applies to it unchanged.
  const tip = headFollowerOf(client)?.tip()
  const head = tip ? {hash: tip.blockHash, timestamp: tip.blockTimestamp} : await client.getBlock({blockTag: 'latest'})
  if (head.hash === null || !HEX32.test(head.hash) || BigInt(now()) - head.timestamp > 20n || head.timestamp - BigInt(now()) > 2n) throw new Error('debit quote head is stale or unavailable')
  return head.hash
}

/**
 * The voucher journaled for a pending debit's request, when it is exactly that debit's: under the
 * request (`pav-`), or in the operation journal's `reserved` phase, which a fresh round commits
 * together with it (a crash may keep either one).
 */
async function completedVoucher(store: ApplicationStore, debit: LaneDebit): Promise<DebitVoucherWire | undefined> {
  const exact = (voucher: DebitVoucherWire | undefined) => voucher && same(voucher.request_id, debit.requestId) && voucher.seq === debit.seq
    && same(voucher.allowance_id, debit.payment.allowance_id ?? '') ? voucher : undefined
  const saved = exact(await journaledAllowanceVoucher(store, debit.requestId))
  if (saved) return saved
  const record = await store.load<{payment?: {debit_voucher?: DebitVoucherWire}}>(paidRecordKey(debit.requestId)).catch(() => undefined)
  return exact(record?.payment?.debit_voucher)
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
export async function obtainAllowanceVoucher(env: AllowanceEnv, ticket: {lane: number}, payment: PaymentIntentWire, signal?: AbortSignal,
  options: ObtainVoucherOptions = {}): Promise<DebitVoucherWire> {
  const requestId = prepaidRequestId(payment), store = env.store
  const saved = await journaledAllowanceVoucher(store, requestId)
  if (saved) return saved
  if (payment.allowance_id === undefined) throw new TasraError('Payment names no allowance')
  const slot = payment.slot, key = laneKey(env.deployment, slot, ticket.lane), allowance = payment.allowance_id
  const push = HEX32.test(allowance) ? pushKey(allowance) : undefined
  // Background work that takes locks this round holds starts once they are released; vouchers are
  // pushed only once the commit that journals them resolved.
  const after: (() => void)[] = [], toPush: DebitVoucherWire[] = []
  consumeClaim(key)
  busy.add(key)
  try {
    // The lane lock serializes the lane's rounds; the push journal's lock is held with it, so the
    // voucher a round completes is journaled for its push in the same commit as the lane advance.
    const settled = await withCommit(store, [key, ...push ? [push] : [], ...options.lock ?? []], async commit => {
      await options.check?.()
      let state = await loadLane(store, key, ticket.lane, slot)
      // `save` is durable before it returns; `advance` only records the lane's next state, which is
      // published with the unlock (or by the next durable `save`, which carries it).
      let unsaved = false
      const save = async (next: LaneState) => { await store.save(key, next); state = next; unsaved = false }
      const pushed: DebitVoucherWire[] = []
      const round: Round = {save, advance: next => { state = next; unsaved = true }, pushed: voucher => { pushed.push(voucher) }}
      const retireLane = async (why: string, cause?: unknown): Promise<never> => {
        const promoted = state.next?.phase === 'confirmed' ? {...state.next, seq: 0, cumulative: '0'} : undefined, retiring = state.current
        await save({...state, current: promoted, next: promoted ? undefined : state.next, retired: retire(state)})
        after.push(() => repushLast(env, retiring))
        throw new AllowanceRefusedError(why, cause)
      }
      // A round that fails after it completed another request's interrupted debit (`finalize`, whose
      // voucher is already journaled) still publishes that lane advance and its push journal: the
      // failure is reported after the commit, never by discarding the advance, which would leave
      // the lane pending on a debit no selection ever runs a round for again.
      const outcome = await (async (): Promise<DebitVoucherWire> => {
        const current = state.current
        if (!current || !same(current.id, allowance)) throw new AllowanceRefusedError('the lane no longer holds this allowance')
        // A completed round of another request whose lane advance was interrupted: its voucher is
        // on the lane (older journals) or journaled for its request (`finalize` writes that first).
        if (current.pending && !same(current.pending.requestId, requestId)) {
          const done = current.pending.voucher ?? await completedVoucher(store, current.pending)
          if (done) await finalize(env, state, current, {...current.pending, voucher: done}, round)
        }
        const other = state.current?.pending
        if (other && !same(other.requestId, requestId)) {
          if (!await resumable(store, other)) return retireLane('a debit of an abandoned or expired operation holds this lane')
          // Complete the earlier request first (its operation resumes onto the journaled voucher).
          await runRound(env, state, state.current!, other, round, retireLane, signal)
        }
        const lane = state.current!
        if (lane.pending && lane.pending.voucher) return finalize(env, state, lane, lane.pending, round, options.journal)
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
        return runRound(env, state, state.current!, debit, round, retireLane, signal, options.journal)
      })().then(voucher => ({voucher}), (error: unknown) => ({error}))
      if (unsaved) commit.stage(key, state)
      // The allowance's last voucher, journaled (unacknowledged) before it is pushed. Committed with
      // the lane advance: a crash may keep either one. A journal without the advance names a seq whose
      // voucher is journaled for its request (the next round completes the advance and journals it
      // again, a no-op); an advance without the journal loses nothing: `repushLast` takes the
      // lane's `previous` (published by that advance) when the journal is missing or older.
      const last = pushed.reduce<DebitVoucherWire | undefined>((a, v) => !a || v.seq > a.seq ? v : a, undefined)
      if (last && push) {
        const journaled = await loadPush(store, allowance).catch(() => undefined)
        if (!journaled || journaled.voucher.seq < last.seq) commit.stage(push, {schema: 1, voucher: last, acked: [], repushed: false} satisfies PushRecord)
        toPush.push(...pushed)
      }
      return outcome
    })
    // Never awaited by the operation; beyond the background bound the journal keeps it for the re-push.
    for (const done of toPush) background(() => sendAndJournal(env, done, accountantEndpoints(env, env.deployment.chainId)))
    if ('error' in settled) throw settled.error
    return settled.voucher
  } finally {
    busy.delete(key)
    for (const job of after) job()
  }
}

/** How a round journals the lane: durably now (`save`), with the unlock (`advance`), and which vouchers it completed (`pushed`). */
interface Round {
  save(next: LaneState): Promise<void>
  advance(next: LaneState): void
  pushed(voucher: DebitVoucherWire): void
}

/** Options of {@link obtainAllowanceVoucher}. */
export interface ObtainVoucherOptions {
  /**
   * Further entries to journal with THIS request's voucher, in the same commit as `pav-<request>`
   * and before the lane advances past its seq (the operation journal's `reserved` phase). A crash
   * may keep any subset of that commit; the lane completes an interrupted advance from either.
   */
  journal?: (voucher: DebitVoucherWire) => readonly (readonly [string, unknown])[]
  /** Further locks held for the whole round, taken with the lane's (all in sorted order), e.g. the operation journal's. */
  lock?: readonly string[]
  /** Runs first under every lock, before anything is read or sent; a throw sends nothing. */
  check?: () => Promise<void>
}

/** One voucher round for `debit` on the lane's current allowance; advances the lane on success. */
async function runRound(env: AllowanceEnv, state: LaneState, lane: LaneCurrent, debit: LaneDebit, round: Round,
  retireLane: (why: string, cause?: unknown) => Promise<never>, signal?: AbortSignal, journal?: ObtainVoucherOptions['journal']): Promise<DebitVoucherWire> {
  try {
    const {voucher, partials} = await collectDebitVoucher(env.client, env.deployment, {payment: debit.payment, seq: debit.seq, previous: lane.previous,
      quoteBlock: debit.quoteBlock, maxOpCost: BigInt(lane.intent.max_op_cost)}, {accountantUrls: env.accountantUrls, allowLocalHttp: env.allowLocalHttp,
      requestTimeoutMs: env.options.debitTimeoutMs, signal, known: debit.partials})
    // No separate lane save of the completed round: `finalize` journals the voucher under its
    // request FIRST, which is what an interrupted advance is resumed from (`completedVoucher`).
    const done: LaneDebit = {...debit, partials, voucher}
    return await finalize(env, state, {...lane, pending: done}, done, round, journal)
  } catch (error) {
    if (error instanceof DebitVoucherError) {
      const known = new Map(debit.partials.map(p => [p.identifier, p]))
      for (const o of error.outcomes) if (o.kind === 'partial') known.set(o.partial.identifier, o.partial)
      await round.save({...state, current: {...lane, pending: {...debit, partials: [...known.values()]}}})
      if (error.definite) return retireLane('the accountants refused the debit', error)
      throw new AllowanceUnavailableError('accountants unavailable for the debit; resume requests the same seq', error)
    }
    if (error instanceof AllowanceRefusedError || error instanceof AllowanceUnavailableError) throw error
    throw new AllowanceUnavailableError('debit voucher round failed', error)
  }
}

/**
 * Journal the voucher under its request (with `journal`'s entries, in one durable commit), then
 * advance the lane past its seq, then push it (journaled with the lane's unlock, sent after it in
 * the background). The lane advance is ordered after that commit and needs no flush of its own: it
 * is published with the lane's unlock, or carried by the next durable lane save, and a crash before
 * either leaves the debit pending with its voucher journaled, which the next round on the lane
 * completes (`completedVoucher`) without asking anyone.
 */
async function finalize(env: AllowanceEnv, state: LaneState, lane: LaneCurrent, debit: LaneDebit, round: Round,
  journal?: ObtainVoucherOptions['journal']): Promise<DebitVoucherWire> {
  const voucher = debit.voucher!, store = env.store
  const entries: (readonly [string, unknown])[] = await journaledAllowanceVoucher(store, debit.requestId) ? [] : [[voucherKey(debit.requestId), {schema: 1, voucher} satisfies StoredVoucher]]
  entries.push(...journal?.(voucher) ?? [])
  await saveAll(store, entries)
  round.advance({...state, current: {...lane, seq: debit.seq, cumulative: voucher.cumulative, previous: voucher, pending: undefined}})
  round.pushed(voucher)
  return voucher
}

// ---- Voucher push (background) --------------------------------------------------------------

/** The last voucher of one allowance and which members acknowledged it. */
interface PushRecord { schema: 1; voucher: DebitVoucherWire; acked: string[]; repushed: boolean }
const PUSH_TIMEOUT_MS = 10_000
const PUSH_CONCURRENCY = 4
/** Background push jobs in this process; beyond it a push is skipped (the journal keeps it unacknowledged for the re-push). */
const MAX_PUSHES = 64
const pushes = new Set<Promise<void>>()

function pushKey(allowance: Hex): string {
  if (!HEX32.test(allowance)) throw new TasraError('Invalid allowance ID')
  return `pap-${allowance.slice(2).toLowerCase()}`
}
async function loadPush(store: ApplicationStore, allowance: Hex): Promise<PushRecord | undefined> {
  const r = await store.load<PushRecord>(pushKey(allowance))
  if (r === undefined) return undefined
  if (!r || r.schema !== 1 || !same(r.voucher.allowance_id, allowance) || !Array.isArray(r.acked)) throw new TasraError('Invalid voucher push journal')
  return r
}
function background(work: () => Promise<void>): void {
  if (pushes.size >= MAX_PUSHES) return
  const job: Promise<void> = Promise.resolve().then(work).catch(() => {}).finally(() => pushes.delete(job))
  pushes.add(job)
}
/** Send `voucher` to `urls` and merge the acknowledgements into its journal (when it is still the allowance's last). */
async function sendAndJournal(env: AllowanceEnv, voucher: DebitVoucherWire, urls: string[]): Promise<void> {
  if (urls.length === 0) return
  const outcomes = await pushDebitVoucher(env.deployment.chainId, voucher, {accountantUrls: urls, allowLocalHttp: env.allowLocalHttp,
    requestTimeoutMs: PUSH_TIMEOUT_MS, concurrency: PUSH_CONCURRENCY})
  const accepted = outcomes.filter(o => o.kind === 'accepted').map(o => o.url)
  if (accepted.length === 0) return
  const key = pushKey(voucher.allowance_id)
  await env.store.withLock(key, async () => {
    const r = await loadPush(env.store, voucher.allowance_id)
    if (!r || r.voucher.seq !== voucher.seq) return
    await env.store.save(key, {...r, acked: [...new Set([...r.acked, ...accepted])]} satisfies PushRecord)
  })
}
/**
 * Re-push an allowance's last voucher ONCE to the members that did not acknowledge it (lane
 * retiring, allowance near expiry). Never throws.
 *
 * The push journal is committed with the lane advance, but a crash may keep either one of that
 * commit: a lane advanced past its last voucher whose push journal is missing or names an older
 * seq. The voucher it would name is durable anyway: the lane's `previous`, published by that same
 * advance. When the journal is missing or older, that voucher stands in, acknowledged by no
 * member, so an allowance's last voucher is re-pushed after a crash too, with no flush added to the
 * debit path. Only the lost journal's acknowledgements are lost: a member that had acknowledged is
 * asked again (an idempotent accept).
 */
function repushLast(env: AllowanceEnv, lane: LaneCurrent | undefined): void {
  if (!lane) return
  const allowance = lane.id
  const last = lane.seq > 0 && lane.previous && same(lane.previous.allowance_id, allowance) ? lane.previous : undefined
  background(async () => {
    const urls = accountantEndpoints(env, env.deployment.chainId), key = pushKey(allowance)
    const todo = await env.store.withLock(key, async () => {
      const journaled = await loadPush(env.store, allowance)
      const r: PushRecord | undefined = last && (!journaled || journaled.voucher.seq < last.seq)
        ? {schema: 1, voucher: last, acked: [], repushed: false} : journaled
      if (!r || r.repushed) return undefined
      const missing = urls.filter(u => !r.acked.includes(u))
      if (missing.length === 0) return undefined
      // Marked before sending: once, even if this process stops mid-push.
      await env.store.save(key, {...r, repushed: true} satisfies PushRecord)
      return {voucher: r.voucher, missing}
    })
    if (todo) await sendAndJournal(env, todo.voucher, todo.missing)
  })
}

/**
 * The voucher push journal of an allowance: its last voucher, the members that acknowledged it and
 * whether the one re-push was spent (diagnostics).
 * @param store - Application store.
 * @param allowance - Allowance ID.
 */
export async function inspectAllowanceVoucherPush(store: ApplicationStore, allowance: Hex): Promise<{seq: number; acked: string[]; repushed: boolean} | undefined> {
  const r = await loadPush(store, allowance)
  return r && {seq: r.voucher.seq, acked: [...r.acked], repushed: r.repushed}
}

/** Test hook: wait for every background voucher push started in this process. */
export async function settleAllowanceVoucherPushes(): Promise<void> {
  while (pushes.size > 0) await Promise.all([...pushes])
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

/**
 * Inspect the draw lanes (ADR-0090 D7) of a slot for one epoch's parity: as {@link inspectAllowanceLanes},
 * with each allowance's verifier epoch and how many allowances the lane holds (escrow possibly still locked).
 * @param store - Application store.
 * @param deployment - Approved deployment.
 * @param slot - Slot.
 * @param lanes - Lane count.
 * @param epoch - A verifier epoch of the parity to inspect.
 */
export async function inspectAllowanceDrawLanes(store: ApplicationStore, deployment: PrepaidDeployment, slot: Hex, lanes: number, epoch: number):
  Promise<{lane: number; allowanceId?: Hex; epoch?: number; phase?: string; seq?: number; amount?: string; next?: {allowanceId: Hex; phase: string; epoch: number}; retired: number; held: number}[]> {
  const out = []
  for (let j = 0; j < lanes; j++) {
    const lane = drawLaneIndex(epoch, j), s = await loadLane(store, laneKey(deployment, slot, lane), lane, slot)
    out.push({lane, ...s.current ? {allowanceId: s.current.id, epoch: s.current.intent.verification_epoch, phase: s.current.phase, seq: s.current.seq, amount: s.current.intent.amount} : {},
      ...s.next ? {next: {allowanceId: s.next.id, phase: s.next.phase, epoch: s.next.intent.verification_epoch}} : {}, retired: s.retired?.length ?? 0, held: unexpired(s.held).length})
  }
  return out
}

/** Test hook: wait for every background reservation (and draw reserve-ahead) started in this process. */
export async function settleAllowanceRefills(): Promise<void> {
  while (refilling.size > 0 || aheads.size > 0) await Promise.all([...refilling.values(), ...aheads.values()])
}

/** Test hook: forget this process's reserve-ahead retry times (a new process starts without them). */
export function resetAllowanceDrawAheads(): void {
  aheadDone.clear()
}
