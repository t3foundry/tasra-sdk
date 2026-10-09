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
