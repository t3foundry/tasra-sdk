// Error taxonomy.
//
// Before this existed the SDK threw bare `Error` from ~90 sites, so the only way
// to tell "the JWT was denied" from "the node is unreachable" from "not enough
// nodes answered" was to regex `err.message`. The SDK was doing that to itself in
// node-client.ts. Message-matching breaks on any wording change, and it cannot
// carry structure - a caller that wants the HTTP status, or the per-node reasons
// behind a failed assembly, had nowhere to read them from.
//
// Every class here extends `Error`, so existing `catch (e) { e.message }` code is
// unaffected; the messages keep their previous shape too. What's new is that you
// can branch on the type and read fields off it:
//
// try {
// await session.decrypt(envelope)
// } catch (e) {
// if (e instanceof AuthDeniedError) return reclaimCredential() // never retry
// if (e instanceof ThresholdNotMetError) {
// console.warn(`only ${e.got}/${e.need} nodes answered:`, e.reasons)
// return retryLater() // transient
// }
// throw e
// }
//
// `retryable` is the coarse signal for callers that don't want to enumerate
// types: false means the request will fail identically on retry (a denied or
// expired credential, a malformed rule), true means it might not.

import {parseRetryAfter} from './internal/retryAfter.js'

/**
 * Base class for typed SDK failures with a retryability hint.
 * Some SDK errors extend plain Error, including relay and agent-session
 * reconciliation errors. A retryable failure does not make a write safe to repeat.
 */
export class TasraError extends Error {
  /** `false` when retrying the identical request cannot succeed. */
  readonly retryable: boolean

  constructor(message: string, opts?: {retryable?: boolean; cause?: unknown}) {
    super(message, opts?.cause !== undefined ? {cause: opts.cause} : undefined)
    this.name = new.target.name
    this.retryable = opts?.retryable ?? false
  }
}

/**
 * A new payment cannot be prepared with the slot's available TASRA. Reserved
 * credit belongs to earlier jobs and is not available for a new reservation.
 * Top up and read fresh funding before starting another payment; this error
 * never authorizes resubmission of an uncertain transaction.
 */
export class UnderfundedSlotError extends TasraError {
  /** Slot whose new payment was refused. */
  readonly slotId: string
  /** Unreserved TASRA base units, when observed during on-chain discovery. */
  readonly availableTasraUnits?: bigint
  /** Accountant HTTP status, absent for a local funding observation. */
  readonly status?: 402
  /** Accountant endpoint, when a reservation request returned HTTP 402. */
  readonly url?: string

  constructor(args: {slotId: string; availableTasraUnits?: bigint; status?: 402; url?: string; message?: string}) {
    super(args.message ?? `Slot ${args.slotId} has insufficient available TASRA`, {retryable: false})
    this.slotId = args.slotId
    this.availableTasraUnits = args.availableTasraUnits
    this.status = args.status
    this.url = args.url
  }
}

/**
 * The transaction payer lacks native currency for the quoted reservation gas.
 * Slot TASRA credit is a separate balance. Nothing was prepared or broadcast;
 * this error never authorizes resubmission of an uncertain transaction.
 */
export class UnderfundedGasPayerError extends TasraError {
  /** Stable code distinguishing native gas from slot TASRA credit. */
  readonly code = 'underfunded-gas-payer' as const
  /** Address that would pay the reservation transaction's gas. */
  readonly payer: string
  /** Pending native balance, in the chain's smallest native unit. */
  readonly availableNativeUnits: bigint
  /** Estimated gas multiplied by the actual transaction gas price. */
  readonly requiredNativeUnits: bigint

  constructor(args: {payer: string; availableNativeUnits: bigint; requiredNativeUnits: bigint}) {
    super(`Gas payer ${args.payer} has insufficient native currency for reservation gas`, {retryable: false})
    this.payer = args.payer
    this.availableNativeUnits = args.availableNativeUnits
    this.requiredNativeUnits = args.requiredNativeUnits
  }
}

/**
 * A node or verifier answered with a non-2xx status. `body` is the response body,
 * truncated to 200 characters - enough to carry the service's own error text
 * without dumping a page of HTML into a log line.
 *
 * 5xx, 429 and 425 are marked retryable; so is a 409, 410 or 422 that carries
 * `Retry-After`. Other 4xx are not. `retryAfterMs` is the service-requested wait.
 */
export class TasraHttpError extends TasraError {
  /** HTTP status code returned by the service. */
  readonly status: number
  /** Service URL that failed. */
  readonly url: string
  /** Response body retained as diagnostic information. */
  readonly body: string
  /** Service-requested wait from `Retry-After`, in ms, when one was sent. */
  readonly retryAfterMs?: number

  constructor(args: {status: number; url: string; body?: string; message?: string; retryable?: boolean; retryAfterMs?: number}) {
    const body = args.body ?? ''
    const after = args.retryAfterMs !== undefined && Number.isSafeInteger(args.retryAfterMs) && args.retryAfterMs >= 0 ? args.retryAfterMs : undefined
    super(args.message ?? `${args.url} → HTTP ${args.status}${body ? `: ${body}` : ''}`, {
      retryable: args.retryable ?? (args.status >= 500 || args.status === 429 || args.status === 425
        || (after !== undefined && [409, 410, 422].includes(args.status))),
    })
    this.status = args.status
    this.url = args.url
    this.body = body
    if (after !== undefined) this.retryAfterMs = after
  }
}

/**
 * The credential was rejected: 401 or 403. Never retryable - the same token will
 * be refused again. Re-claim (redeem a fresh credential or renewal) instead.
 */
export class AuthDeniedError extends TasraHttpError {
  constructor(args: {status: number; url: string; body?: string; message?: string}) {
    super({...args, retryable: false})
  }
}

/**
 * A keeper refused a committee grant because its verifiers' revocation-status attestations
 * (`keykeeper/committee-status-attestation/v1`) are missing (`revocation_status_missing`) or no
 * longer fresh for a quorum (`revocation_status_stale`). The credential was NOT judged revoked:
 * the grant outlived the 60 s revocation bound (or came from a path that does not carry the
 * attestations).
 *
 * NOT retryable, and NOT proof that no keeper worked: another keeper of the committee may already
 * have started the operation before this one re-checked the grant, and a gateway can blur the
 * outcome. Never resend this grant, and never treat this error alone as authority to retry, refund
 * or clear a paid operation (its journal keeps the execution as uncertain until original-stage
 * evidence settles it). For an UNPAID operation the remedy is a new presentation and a new grant.
 * Not an {@link AuthDeniedError}, and {@link isAuthDenied} returns false for it.
 */
export class RevocationStatusError extends TasraHttpError {
  /** The keeper's stable refusal code. */
  readonly code: 'revocation_status_stale' | 'revocation_status_missing'
  /** Always true: a fresh grant needs a new presentation, never this token. */
  readonly presentAgain = true as const

  constructor(args: {status: number; url: string; body?: string; message?: string; code: 'revocation_status_stale' | 'revocation_status_missing'; retryAfterMs?: number}) {
    super({...args, retryable: false})
    this.code = args.code
  }
}

/** Stable code of a local revocation-status preflight refusal. */
export type RevocationStatusPreflightCode = 'revocation_status_missing' | 'revocation_status_stale' | 'revocation_status_invalid'
  | 'revocation_status_refused'

/**
 * A committee grant was refused LOCALLY, before any keeper call, by the same rule a keeper in
 * production posture applies: its revocation-status attestations
 * (`keykeeper/committee-status-attestation/v1`) are missing (`revocation_status_missing`: absent,
 * `null` or empty), fewer than a quorum are valid and fresh (`revocation_status_stale`), or the
 * list is malformed, duplicated or carries a bad signature from a counted verifier
 * (`revocation_status_invalid`), or - for a journaled paid operation - an explicit status refresh
 * answered `status_refresh_refused` (`revocation_status_refused`: a verifier attests the holder's
 * credential status is refused NOW; the grant is refused however fresh its attestations still are,
 * until a later refresh succeeds).
 *
 * Unlike {@link RevocationStatusError} (a keeper's reply after a send), nothing was sent: a paid
 * operation refused here stays in its pre-execution journal phase. Not retryable with this grant
 * and never a reason to start a new session or payment automatically: present again for a fresh
 * grant. `allowMissingStatusAttestations` (migration window only) waives `revocation_status_missing`
 * and nothing else.
 */
export class RevocationStatusPreflightError extends TasraError {
  /** Stable refusal code. */
  readonly code: RevocationStatusPreflightCode
  /** Always false: no keeper received the grant. */
  readonly sent = false as const
  /** Always true: a fresh grant needs a new presentation. */
  readonly presentAgain = true as const
  /** Paid operation identity, when the refusal stopped a journaled paid operation. */
  readonly requestId?: string

  constructor(args: {code: RevocationStatusPreflightCode; message: string; requestId?: string; cause?: unknown}) {
    super(args.message, {retryable: false, cause: args.cause})
    this.code = args.code
    if (args.requestId !== undefined) this.requestId = args.requestId
  }
}

/**
 * True when a grant was refused locally for missing, stale or invalid revocation-status
 * attestations before anything was sent.
 *
 * @param e - Caught value to classify.
 */
export function isRevocationStatusPreflightRefusal(e: unknown): e is RevocationStatusPreflightError {
  return e instanceof RevocationStatusPreflightError
}

/**
 * The stable revocation-status refusal code in a keeper's 403 body, if any.
 *
 * @param status - HTTP status code.
 * @param body - Complete (untruncated) response body.
 */
export function revocationStatusCode(status: number, body: string): RevocationStatusError['code'] | undefined {
  if (status !== 403) return undefined
  if (body.includes('revocation_status_stale')) return 'revocation_status_stale'
  if (body.includes('revocation_status_missing')) return 'revocation_status_missing'
  return undefined
}

/**
 * True when a keeper refused a grant only for stale or missing revocation-status attestations:
 * present the credential again for a fresh grant and repeat the call.
 *
 * @param e - Caught value to classify.
 */
export function isRevocationStatusRefusal(e: unknown): e is RevocationStatusError {
  return e instanceof RevocationStatusError
}

/**
 * Stable code of a status-refresh failure (`keykeeper/committee-status-refresh/v1`).
 *
 * Server codes (verifier `POST /v1/committee/status-refresh`, or the verifier-agent relay
 * `POST /v1/sessions/:id/status-refresh`):
 * - `status_refresh_unknown` (404): the verifier holds no issuance record for this token.
 * - `status_refresh_unavailable` (409): a legacy record without refresh facts; never clean.
 * - `status_refresh_replayed` (409): the proof's `seq` is not above the verifier's last one.
 * - `status_refresh_context_changed` (409): the verifier's roster index or the slot rule moved.
 * - `status_refresh_expired` (410): a hard cap of the grant (minus the 5 s keeper skew) passed.
 * - `status_refresh_unauthenticated` (403, or 401 from the relay): the proof does not verify
 *   under the principal recorded at issuance, or is not fresh.
 * - `status_refresh_refused` (403): a status reference is revoked or no longer acceptable.
 * - `status_refresh_unavailable_status` (503): a status list could not be read.
 * - `status_refresh_quorum_unmet` (503 from the relay, or local): fewer than the token's quorum of
 *   original signers returned a valid, fresh, capped attestation.
 * - `status_refresh_rate_limited` (429): per-token interval/cap or principal quota; see `retryAfterMs`.
 *
 * Client codes:
 * - `status_refresh_invalid_response`: a success reply that is malformed, unsigned, forged, from a
 *   signer that did not verify the original token, or past a cap. Never trusted.
 * - `status_refresh_unreachable`: no HTTP answer (the verifier may still have consumed the `seq`).
 * - `status_refresh_http`: any other HTTP status, or a refusal without a recognised code.
 */
export type StatusRefreshCode =
  | 'status_refresh_unknown'
  | 'status_refresh_unavailable'
  | 'status_refresh_replayed'
  | 'status_refresh_context_changed'
  | 'status_refresh_expired'
  | 'status_refresh_unauthenticated'
  | 'status_refresh_refused'
  | 'status_refresh_unavailable_status'
  | 'status_refresh_quorum_unmet'
  | 'status_refresh_rate_limited'
  | 'status_refresh_invalid_response'
  | 'status_refresh_unreachable'
  | 'status_refresh_http'

/** Why one verifier (or the relay) did not contribute a fresh attestation. */
export interface StatusRefreshFailure {
  /** Verifier registry index, when the failure belongs to one verifier. */
  verifierIndex?: number
  /** Stable code. */
  code: StatusRefreshCode
  /** HTTP status, when an answer arrived. */
  httpStatus?: number
  /** Service-requested wait (`Retry-After`), in ms. */
  retryAfterMs?: number
  /** Safe-to-log detail (no secrets, at most 200 characters of a service message). */
  message: string
}

/**
 * A status refresh for an already-issued committee grant produced no fresh quorum.
 *
 * It changes nothing at any keeper and is NEVER evidence about keeper work: for a paid operation
 * the journal phase is unchanged (an `authorized` grant was not sent; an `executing` one stays
 * uncertain). `retryable` is a coarse hint for 429/503/transport failures only; the SDK never
 * retries a refresh automatically, and a new attempt always uses a new, journaled `seq`.
 * `status_refresh_refused` means a credential status reference is revoked or no longer
 * acceptable: present again (a new grant), never refresh this one.
 */
export class StatusRefreshError extends TasraError {
  /** Stable code (for a fan-out, the decisive one; see `reasons` for every verifier). */
  readonly code: StatusRefreshCode
  /** HTTP status of the decisive answer, when there was one. */
  readonly httpStatus?: number
  /** Longest service-requested wait among the failures, in ms. */
  readonly retryAfterMs?: number
  /** Per-verifier (or relay) failures. */
  readonly reasons: readonly StatusRefreshFailure[]
  /** Paid operation identity, when the refresh belonged to a journaled paid operation. */
  readonly requestId?: string
  /** The journaled sequence number the failed proof used (never reused). */
  readonly seq?: number

  constructor(args: {code: StatusRefreshCode; message: string; httpStatus?: number; retryAfterMs?: number; reasons?: readonly StatusRefreshFailure[];
    requestId?: string; seq?: number; retryable?: boolean; cause?: unknown}) {
    super(args.message, {retryable: args.retryable ?? statusRefreshRetryable(args.code, args.httpStatus), cause: args.cause})
    this.code = args.code
    this.reasons = Object.freeze([...(args.reasons ?? [])])
    if (args.httpStatus !== undefined) this.httpStatus = args.httpStatus
    if (args.retryAfterMs !== undefined && Number.isSafeInteger(args.retryAfterMs) && args.retryAfterMs >= 0) this.retryAfterMs = args.retryAfterMs
    if (args.requestId !== undefined) this.requestId = args.requestId
    if (args.seq !== undefined) this.seq = args.seq
  }
}

/** Coarse retryability of a status-refresh code: capacity, unavailable status and transport only. */
function statusRefreshRetryable(code: StatusRefreshCode, httpStatus?: number): boolean {
  if (code === 'status_refresh_rate_limited' || code === 'status_refresh_unavailable_status' || code === 'status_refresh_unreachable'
    || code === 'status_refresh_quorum_unmet') return true
  return code === 'status_refresh_http' && httpStatus !== undefined && (httpStatus >= 500 || httpStatus === 429)
}

/**
 * True for a {@link StatusRefreshError}.
 *
 * @param e - Caught value to classify.
 */
export function isStatusRefreshError(e: unknown): e is StatusRefreshError {
  return e instanceof StatusRefreshError
}

/**
 * Stable code of a paid backoff refusal (see {@link PaidBackoffError}).
 * - `deadline_exceeded`: waiting the server's hint (or the client's own backoff) and then allowing
 *   one attempt would reach the operation deadline; nothing was slept or sent.
 * - `server_wait_too_long`: the server asked for longer than the client ever waits (120 s); the
 *   hint is never shortened, so nothing was slept or sent.
 * - `no_time_to_send`: re-read immediately before a send (for example after an overrunning sleep),
 *   too little time was left before the deadline; that send did not happen.
 * - `attempts_exhausted`: the attempt ceiling was reached inside the deadline.
 */
export type PaidBackoffCode = 'deadline_exceeded' | 'server_wait_too_long' | 'no_time_to_send' | 'attempts_exhausted'

/**
 * A paid request that the service definitely refused before acting on it (HTTP 429 or 503) could
 * not be repeated inside its existing deadline. Only requests that are safe to repeat are paced: the
 * paid verifier-agent reads, the byte-identical retained approval, the presentation continuation (429
 * only) and the accountant reservation `prepare`. The deadline is never extended and a valid
 * `Retry-After` / `x-ratelimit-after` hint is never shortened.
 *
 * Nothing was sent after the refusal this error reports. A retained approval keeps its durable
 * permit, so a later resume may resend the identical body; never start the paid operation again.
 */
export class PaidBackoffError extends TasraError {
  /** Stable reason. */
  readonly code: PaidBackoffCode
  /** Route that was refused, without identifiers (for example `GET /v1/sessions/{id}`). */
  readonly route: string
  /** Last refusal status, when one was answered (absent for `no_time_to_send`). */
  readonly httpStatus?: number
  /** Server-requested wait (strict integer seconds), in ms, when it sent a valid one. */
  readonly retryAfterMs?: number
  /** Time left before the deadline when the decision was made, in ms. */
  readonly remainingMs?: number
  /** Time one attempt needs (or wait + attempt), in ms. */
  readonly neededMs?: number
  /** Refusals waited out before this decision. */
  readonly attempts: number

  constructor(args: {code: PaidBackoffCode; route: string; httpStatus?: number; retryAfterMs?: number; remainingMs?: number; neededMs?: number; attempts: number}) {
    super(paidBackoffMessage(args), {retryable: true})
    this.code = args.code
    this.route = args.route
    this.attempts = args.attempts
    if (args.httpStatus !== undefined) this.httpStatus = args.httpStatus
    if (args.retryAfterMs !== undefined) this.retryAfterMs = args.retryAfterMs
    if (args.remainingMs !== undefined) this.remainingMs = args.remainingMs
    if (args.neededMs !== undefined) this.neededMs = args.neededMs
  }
}

function paidBackoffMessage(a: {code: PaidBackoffCode; route: string; httpStatus?: number; retryAfterMs?: number; remainingMs?: number; neededMs?: number; attempts: number}): string {
  const status = a.httpStatus !== undefined ? ` (HTTP ${a.httpStatus})` : ''
  switch (a.code) {
    case 'deadline_exceeded': return `${a.route} refused${status}; waiting and one more attempt (${a.neededMs} ms) would reach the operation deadline (${a.remainingMs} ms left); retain records and reconcile by reading`
    case 'server_wait_too_long': return `${a.route} refused${status} and asked for ${a.retryAfterMs} ms, longer than this client ever waits; retain records and reconcile by reading`
    case 'no_time_to_send': return `${a.route} not sent: ${a.remainingMs} ms left before the operation deadline, ${a.neededMs} ms needed for an attempt; retain records and reconcile by reading`
    default: return `${a.route} refused${status} after ${a.attempts} attempts; retain records and reconcile by reading`
  }
}

/**
 * True for a {@link PaidBackoffError}.
 *
 * @param e - Caught value to classify.
 */
export function isPaidBackoffError(e: unknown): e is PaidBackoffError {
  return e instanceof PaidBackoffError
}

/**
 * Why a retained paid approval was not (re)sent (see {@link PaidApprovalUnresolvedError}).
 * - `claim_lost`: another caller already claimed this send generation.
 * - `generation_moved`: the durable permit is no longer for this generation.
 * - `outcome_unknown`: a send had no definite answer (transport error, timeout, abort) or a
 *   generation is recorded in flight; it is never resent.
 * - `no_permit`: there is no durable permit (crash before it was written) or the agent no longer
 *   shows the delivery pending.
 * - `legacy_state`: the record or permit was written in an older or unknown format.
 * - `conflict`: the agent answered 409 after a busy refusal and its delivery state is not accepted.
 */
export type PaidApprovalUnresolvedReason = 'claim_lost' | 'generation_moved' | 'outcome_unknown' | 'no_permit' | 'legacy_state' | 'conflict'

/**
 * A retained paid approval's outcome is unresolved, so the SDK will not send it (again).
 *
 * Code `approval_outcome_unresolved`. An approval is resent only as the byte-identical retained body
 * and only under a durable, generation-bound, one-use permit that an exclusive claim consumes before
 * every send. Anything else (a lost claim, a moved generation, an unknown outcome, a legacy record)
 * lands here. Not retryable: reconcile the delivery by reading it, never by resending or re-signing.
 */
export class PaidApprovalUnresolvedError extends TasraError {
  /** Stable code. */
  readonly code = 'approval_outcome_unresolved' as const
  /** Why nothing was sent. */
  readonly reason: PaidApprovalUnresolvedReason
  /** Agent delivery (proposal) identity, when known. */
  readonly proposalId?: string
  /** Send generation concerned, when known. */
  readonly generation?: number
  /** Application-store journal entry of the approval, when known. */
  readonly key?: string

  constructor(args: {reason: PaidApprovalUnresolvedReason; proposalId?: string; generation?: number; key?: string; message?: string; cause?: unknown}) {
    super(args.message ?? `Paid approval outcome unresolved (${args.reason}${args.generation !== undefined ? `, generation ${args.generation}` : ''}); retain records and reconcile before further work`,
      {retryable: false, cause: args.cause})
    this.reason = args.reason
    if (args.proposalId !== undefined) this.proposalId = args.proposalId
    if (args.generation !== undefined) this.generation = args.generation
    if (args.key !== undefined) this.key = args.key
  }
}

/**
 * True for a {@link PaidApprovalUnresolvedError}.
 *
 * @param e - Caught value to classify.
 */
export function isPaidApprovalUnresolved(e: unknown): e is PaidApprovalUnresolvedError {
  return e instanceof PaidApprovalUnresolvedError
}

/**
 * The accountant refused a reservation `prepare` with its per-creator reservation quota (HTTP 429
 * with a valid `Retry-After` / `x-ratelimit-after`), and the identical prepare could not be repeated
 * inside its window (at most 150 s and half of the payment's remaining signed lifetime).
 *
 * Code `reservation_quota`. Nothing was prepared, signed or put on chain: no reservation transaction
 * exists for this attempt. `reason` says why waiting stopped; `retryAfterMs` is the last hint.
 */
export class PaidReservationQuotaError extends TasraError {
  /** Stable code. */
  readonly code = 'reservation_quota' as const
  /** Why the prepare was not repeated. */
  readonly reason: PaidBackoffCode
  /** Accountant endpoint that refused. */
  readonly url: string
  /** The accountant's last requested wait, in ms. */
  readonly retryAfterMs: number

  constructor(args: {reason: PaidBackoffCode; url: string; retryAfterMs: number; cause?: unknown}) {
    super(`accountant reservation quota refused prepare (429, wait ${args.retryAfterMs} ms): ${args.reason}; nothing was reserved`, {retryable: true, cause: args.cause})
    this.reason = args.reason
    this.url = args.url
    this.retryAfterMs = args.retryAfterMs
  }
}

/**
 * Stable code of a prepaid timeout-escape refusal (see {@link PrepaidEscapeError}).
 * - `escape_disabled`: the Settlement escape delay is zero (an upgraded deployment before governance
 *   enabled it); contract error `EscapeDisabled()`.
 * - `escape_not_open`: a request's escape opens later, at `opensAt`; contract error
 *   `EscapeNotOpen(requestId, opensAt)`.
 * - `reservation_unavailable`: a request was never reserved, or is already complete (reconciled,
 *   settled or escaped); contract error `ReservationUnavailable(requestId)`.
 * - `invalid_escape_delay`: contract error `InvalidEscapeDelay(delay)` (governance setter only).
 * - `too_many_requests`: more than 64 requests in one call; contract error `TooManyCovered`.
 * - `empty_request`: no request IDs; contract error `EmptyBundle()`.
 * - `escape_unsupported`: the Settlement has no escape getters (a version before "3").
 */
export type PrepaidEscapeCode = 'escape_disabled' | 'escape_not_open' | 'reservation_unavailable' | 'invalid_escape_delay'
  | 'too_many_requests' | 'empty_request' | 'escape_unsupported'

/**
 * A prepaid timeout escape was refused before anything was sent for the refused call: by the local
 * preflight (`local: true`, read at one canonical block) or by the contract's own simulation
 * (`local: false`). Nothing about the refused call is journaled. In a multi-call escape, calls that
 * already confirmed are in their journal (`confirmed` checkpoints) and stay final.
 *
 * Only `escape_not_open` is retryable: the same call succeeds once chain time reaches `opensAt`.
 */
export class PrepaidEscapeError extends TasraError {
  /** Stable code. */
  readonly code: PrepaidEscapeCode
  /** Always false: no transaction was sent for the refused call. */
  readonly sent = false as const
  /** True for a local preflight refusal, false for a decoded contract revert. */
  readonly local: boolean
  /** Request the refusal names, when it names one. */
  readonly requestId?: string
  /** When the named request's escape opens (`escape_not_open`). */
  readonly opensAt?: Date
  /** Refused delay in seconds (`invalid_escape_delay`). */
  readonly delaySeconds?: bigint

  constructor(args: {code: PrepaidEscapeCode; local: boolean; requestId?: string; opensAt?: Date; delaySeconds?: bigint; message?: string; cause?: unknown}) {
    super(args.message ?? prepaidEscapeMessage(args), {retryable: args.code === 'escape_not_open', cause: args.cause})
    this.code = args.code
    this.local = args.local
    if (args.requestId !== undefined) this.requestId = args.requestId
    if (args.opensAt !== undefined) this.opensAt = args.opensAt
    if (args.delaySeconds !== undefined) this.delaySeconds = args.delaySeconds
  }
}

function prepaidEscapeMessage(a: {code: PrepaidEscapeCode; requestId?: string; opensAt?: Date; delaySeconds?: bigint}): string {
  const request = a.requestId !== undefined ? ` for request ${a.requestId}` : ''
  switch (a.code) {
    case 'escape_disabled': return 'prepaid timeout escape is disabled on this Settlement; nothing was sent'
    case 'escape_not_open': return `prepaid timeout escape${request} opens at ${a.opensAt?.toISOString() ?? '?'}; nothing was sent`
    case 'reservation_unavailable': return `prepaid request${request} is not reserved or is already complete; nothing was sent`
    case 'invalid_escape_delay': return `invalid prepaid escape delay ${a.delaySeconds ?? '?'} s; nothing was sent`
    case 'too_many_requests': return 'too many requests in one prepaid escape call; nothing was sent'
    case 'empty_request': return 'a prepaid escape needs at least one request; nothing was sent'
    default: return 'this Settlement has no prepaid timeout escape; nothing was sent'
  }
}

/**
 * True for a {@link PrepaidEscapeError}.
 *
 * @param e - Caught value to classify.
 */
export function isPrepaidEscapeError(e: unknown): e is PrepaidEscapeError {
  return e instanceof PrepaidEscapeError
}

/**
 * A prepaid escape transaction may have been broadcast and its outcome is not proven. Code
 * `escape_uncertain`. Retain the prepared record and reconcile it by reading chain state
 * (`reconcileEscape`); never send it again blindly. An escape cannot refund twice (a second one
 * reverts `ReservationUnavailable`), but a blind resend still spends gas and can collide on the nonce.
 */
export class PrepaidEscapeUncertainError extends TasraError {
  /** Stable code. */
  readonly code = 'escape_uncertain' as const
  /** Local journal key of the escape call. */
  readonly escapeId: string
  /** Requests the call named. */
  readonly requestIds: readonly string[]
  /** Transaction hash when known; absence does not prove that nothing was sent. */
  readonly transactionHash?: string

  constructor(args: {escapeId: string; requestIds: readonly string[]; transactionHash?: string; cause?: unknown}) {
    super('prepaid escape outcome needs reconciliation; retain the prepared record and do not resend', {retryable: false, cause: args.cause})
    this.escapeId = args.escapeId
    this.requestIds = Object.freeze([...args.requestIds])
    if (args.transactionHash !== undefined) this.transactionHash = args.transactionHash
  }
}

/**
 * The request never got an HTTP answer - DNS failure, connection refused,
 * timeout, CORS. Retryable: the service may simply not be up yet.
 */
export class NodeUnreachableError extends TasraError {
  /** Endpoint that could not be reached. */
  readonly url: string

  constructor(args: {url: string; message?: string; cause?: unknown}) {
    super(args.message ?? `${args.url} is unreachable`, {retryable: true, cause: args.cause})
    this.url = args.url
  }
}

/**
 * Fewer than the required number of participants answered - too few shards to
 * assemble a key, too few verifier signatures for a quorum, too few nodes for a
 * signing set.
 *
 * `reasons` carries one entry per participant that failed, which is what makes
 * this actionable: previously those were collected and then discarded, so a DNS
 * failure and a cold DKG produced the same opaque message.
 */
export class ThresholdNotMetError extends TasraError {
  /** How many participants answered successfully. */
  readonly got: number
  /** How many were needed. */
  readonly need: number
  /** Why each failing participant failed, one string per participant. */
  readonly reasons: readonly string[]

  constructor(args: {got: number; need: number; reasons?: readonly string[]; message?: string; retryable?: boolean}) {
    const reasons = args.reasons ?? []
    super(
      args.message ??
        `threshold not met: ${args.got}/${args.need} participants answered` +
          (reasons.length ? ` — ${reasons.join('; ')}` : ''),
      // Transient by default: a cold DKG or a restarting node clears on its own.
      // Callers that know better (all-auth failures) pass retryable: false.
      {retryable: args.retryable ?? true},
    )
    this.got = args.got
    this.need = args.need
    this.reasons = reasons
  }
}

/**
 * The slot was re-keyed (rotated) since the key in hand was assembled, so that
 * key cannot read anything encrypted after the rotation. Retryable: re-assemble
 * at the new epoch and try again - the managed {@link Session} does this for you.
 */
export class SlotRotatedError extends TasraError {
  /** The epoch the caller's key/envelope belongs to. */
  readonly expected: number
  /** The slot's current on-chain/served epoch. */
  readonly actual: number

  constructor(args: {expected: number; actual: number; slotId?: string; message?: string}) {
    super(
      args.message ??
        `slot${args.slotId ? ` ${args.slotId.slice(0, 10)}…` : ''} rotated: ` +
          `key is epoch ${args.expected}, slot is now epoch ${args.actual}`,
      {retryable: true},
    )
    this.expected = args.expected
    this.actual = args.actual
  }
}

/**
 * Build the right error for a non-2xx `Response`: {@link AuthDeniedError} for
 * 401/403, otherwise {@link TasraHttpError}. Reads and truncates the body.
 *
 * `label` prefixes the message so it names the operation rather than just the
 * URL (`'committee/sign'` to `committee/sign to HTTP 403: ...`).
 */
export async function httpError(
  res: Response,
  url: string,
  label?: string,
): Promise<TasraHttpError> {
  const full = await res.text().catch(() => '')
  const body = full.slice(0, 200)
  const message = `${label ?? url} → HTTP ${res.status}${body ? `: ${body}` : ''}`
  const retryAfterMs = parseRetryAfter(res.headers?.get('retry-after'))
  const args = {status: res.status, url, body, message, ...(retryAfterMs !== undefined ? {retryAfterMs} : {})}
  // Classified on the complete body: the code must not be lost to the 200-character truncation.
  const code = revocationStatusCode(res.status, full.slice(0, 64 * 1024))
  if (code !== undefined) return new RevocationStatusError({...args, code})
  return res.status === 401 || res.status === 403
    ? new AuthDeniedError(args)
    : new TasraHttpError(args)
}

/**
 * True when `e` is an auth rejection - i.e. retrying is pointless, re-claim
 * instead. Keyed on the HTTP status rather than the class, so it also catches
 * subclasses that carry their own name (e.g. `CommitteeAuthorizeError`).
 *
 * @param e - Caught value to classify as an authorization rejection.
 */
export function isAuthDenied(e: unknown): e is TasraHttpError {
  return e instanceof TasraHttpError && (e.status === 401 || e.status === 403) && !(e instanceof RevocationStatusError)
}

/**
 * True when a typed failure may be transient. Errors outside the TasraError
 * hierarchy return false. This hint does not make a write safe to repeat.
 *
 * @param e - Caught value to inspect for a retryable Tasra error.
 */
export function isRetryable(e: unknown): boolean {
  return e instanceof TasraError && e.retryable
}
