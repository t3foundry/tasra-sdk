// Bounded, deadline-respecting backoff for paid requests a server refused with a definite
// "not now" (HTTP 429 / 503) before acting on them.
//
// Only callers that know the request is safely repeatable use this: the paid verifier-agent reads,
// the byte-identical retained approval, the presentation continuation (429 only) and the accountant
// reservation `prepare` (nothing is on chain yet). A transport error carries no status and is NEVER
// paced here: its outcome is unknown, so the caller keeps its read-to-reconcile rule.
//
// The wait is `max(server hint, current backoff)` plus non-negative jitter: a valid server hint is a
// FLOOR and is never shortened. A hint above MAX_WAIT_MS fails typed instead of being cut down. The
// caller's existing deadline is never extended: a wait that, plus one attempt's budget, would reach
// it fails WITHOUT sleeping, and the deadline is re-read immediately before every send, so an
// overrunning sleep never leads to a late send. Mirrors `tasra-cli`'s `payment/retry.rs`.

import {PaidBackoffError} from '../errors.js'
import type {PaidAgentHttpResponse} from './paidAgentTransport.js'

/** First backoff when the server gives no usable hint, ms. */
export const PAID_FIRST_BACKOFF_MS = 500
/** Backoff doubling stops here, ms. */
export const PAID_MAX_BACKOFF_MS = 8_000
/** Longest server hint honoured, ms (the accountant's reservation admission window is 120 s). */
export const PAID_MAX_WAIT_MS = 120_000
/** Attempt ceiling independent of the deadline. */
export const PAID_MAX_ATTEMPTS = 64
/** A delay-seconds hint with more digits than this is garbage (over 11 days). */
const MAX_HINT_DIGITS = 6

/**
 * Time source for paced paid requests. `now` is wall-clock milliseconds (the same epoch as
 * `Date.now()`), because deadlines derive from signed Unix-second expiries. Inject one in tests.
 */
export interface PaidPacingClock {
  /** Current wall-clock time in ms. */
  now(): number
  /** Resolve after `ms`; reject with the signal's reason when it aborts. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>
  /** Extra wait added ON TOP of `baseMs` (never shortens a hint), in `0..=baseMs/4`. */
  jitter(baseMs: number): number
}

/** Wall clock, timers and `Math.random` jitter. */
export const systemPacingClock: PaidPacingClock = Object.freeze({
  now: () => Date.now(),
  sleep: (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted()
    const done = () => { signal?.removeEventListener('abort', abort); resolve() }
    const timer = setTimeout(done, ms)
    const abort = () => { clearTimeout(timer); reject(signal!.reason) }
    signal?.addEventListener('abort', abort, {once: true})
  }),
  jitter: (baseMs: number) => Math.floor(Math.random() * (Math.floor(baseMs / 4) + 1)),
})

function seconds(value: string | null | undefined): number | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_HINT_DIGITS || !/^[0-9]+$/.test(value)) return undefined
  return Number(value) * 1000
}

/**
 * The server's requested wait from `Retry-After` and/or `x-ratelimit-after` (tower_governor), each
 * parsed STRICTLY as one integer-seconds value of at most six digits. When both are valid the longer
 * wins. Anything else (absent, repeated and therefore comma-joined, signed, fractional, padded, an
 * HTTP-date, oversized) is ignored and the caller's own backoff applies.
 * @param retryAfter Raw `Retry-After` value, if any.
 * @param rateLimitAfter Raw `x-ratelimit-after` value, if any.
 * @returns The wait in ms, or undefined.
 */
export function paidServerWaitMs(retryAfter?: string | null, rateLimitAfter?: string | null): number | undefined {
  const a = seconds(retryAfter), b = seconds(rateLimitAfter)
  return a !== undefined && b !== undefined ? Math.max(a, b) : a ?? b
}

/**
 * The strict hint of a paid-agent reply. Transports that report the raw headers are parsed strictly;
 * a transport that only reports `retryAfterMs` counts when it is a whole number of seconds within the
 * same bound (an HTTP-date or fractional value is ignored).
 * @param response Reply from a paid-agent transport.
 */
export function paidResponseWaitMs(response: PaidAgentHttpResponse): number | undefined {
  if (response.retryAfter !== undefined || response.rateLimitAfter !== undefined) return paidServerWaitMs(response.retryAfter, response.rateLimitAfter)
  const ms = response.retryAfterMs
  return ms !== undefined && Number.isSafeInteger(ms) && ms >= 0 && ms % 1000 === 0 && ms < 10 ** MAX_HINT_DIGITS * 1000 ? ms : undefined
}

/**
 * One operation's retry state: create it once per logical request (one route, one deadline). Call
 * {@link PaidBackoff.readyToSend} immediately before EVERY send and {@link PaidBackoff.wait} after
 * each refusal the caller has decided is repeatable.
 *
 * `attemptBudgetMs` is the longest one attempt can take (provider check + HTTP timeout). A repeated
 * attempt starts only with at least that much time left, so a resend can never run past the
 * deadline. A first attempt needs only a deadline not yet reached (the single-attempt behaviour).
 */
export class PaidBackoff {
  #next = PAID_FIRST_BACKOFF_MS
  #attempts = 0

  /**
   * @param clock Time source.
   * @param route Route label for errors, without identifiers.
   * @param deadlineMs Existing wall-clock deadline in ms; never extended.
   * @param attemptBudgetMs Longest single attempt, ms.
   */
  constructor(readonly clock: PaidPacingClock, readonly route: string, readonly deadlineMs: number, readonly attemptBudgetMs: number) {}

  /** Refusals waited out so far. */
  get retries(): number { return this.#attempts }

  /**
   * Re-reads the clock right before a send and returns the time left in ms. Refuses typed
   * (`no_time_to_send`) when the deadline passed, or when less than one attempt's budget is left
   * for a repeated attempt: an overrunning sleep is caught here, never sent through.
   */
  readyToSend(): number {
    const remaining = Math.max(0, this.deadlineMs - this.clock.now())
    const needed = this.#attempts === 0 ? 0 : this.attemptBudgetMs
    if (remaining <= 0 || remaining < needed) {
      throw new PaidBackoffError({code: 'no_time_to_send', route: this.route, remainingMs: remaining, neededMs: needed, attempts: this.#attempts})
    }
    return remaining
  }

  /**
   * Sleeps before the next attempt after `status`, or fails typed WITHOUT sleeping when the attempt
   * ceiling is spent, the server asks for more than {@link PAID_MAX_WAIT_MS}, or the wait plus one
   * attempt's budget would reach the deadline. The wait is never shorter than a valid hint; jitter
   * only lengthens it, within the slack that still leaves one attempt's budget.
   * @param status Refusal status.
   * @param hintMs Strict server hint, if any.
   * @param signal Cancellation of the sleep.
   */
  async wait(status: number, hintMs: number | undefined, signal?: AbortSignal): Promise<void> {
    this.#attempts++
    const base = {route: this.route, httpStatus: status, attempts: this.#attempts, ...(hintMs !== undefined ? {retryAfterMs: hintMs} : {})}
    if (this.#attempts >= PAID_MAX_ATTEMPTS) throw new PaidBackoffError({...base, code: 'attempts_exhausted'})
    if (hintMs !== undefined && hintMs > PAID_MAX_WAIT_MS) throw new PaidBackoffError({...base, code: 'server_wait_too_long'})
    const wait = hintMs === undefined ? this.#next : Math.max(hintMs, this.#next)
    const remaining = Math.max(0, this.deadlineMs - this.clock.now())
    const needed = wait + this.attemptBudgetMs
    if (needed >= remaining) throw new PaidBackoffError({...base, code: 'deadline_exceeded', remainingMs: remaining, neededMs: needed})
    const extra = this.clock.jitter(wait)
    const jitter = Number.isSafeInteger(extra) && extra > 0 ? Math.min(extra, remaining - needed) : 0
    await this.clock.sleep(wait + jitter, signal)
    this.#next = Math.min(this.#next * 2, PAID_MAX_BACKOFF_MS)
  }
}
