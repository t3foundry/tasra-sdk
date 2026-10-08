// Bounded, jittered waits for requests that are safe to send again.
//
// Services answer load and capacity refusals with a status and, often, a `Retry-After`
// header: the verifier's nonce and renewal stores (429, SP-11), the relayer's busy lanes,
// full journal and unavailable shared budget (422 `rejected`), and generic 503s. This
// module turns that header into a wait the caller can bound.
//
// ⚠ It never decides that a request is safe to repeat. Callers wrap only a request that is
// idempotent, or one whose refusal proves it was not processed (an HTTP 429 capacity refusal,
// an identical signed relay request whose nonce the chain spends once). A paid flow, a
// reservation or any other write with an uncertain outcome must be reconciled, never retried.

import {TasraError, TasraHttpError, NodeUnreachableError} from './errors.js'
import {parseRetryAfter} from './internal/retryAfter.js'

export {parseRetryAfter}

/** Limits for one retried request. Every field is optional and bounded. */
export interface RetryPolicy {
  /** Total sends including the first, 1..10 (default 4). */
  maxAttempts?: number
  /** First backoff when the service gives no `Retry-After`, in ms (default 250). */
  baseDelayMs?: number
  /** Largest single wait in ms (default 10000). A longer `Retry-After` ends retrying. */
  maxDelayMs?: number
  /** Largest sum of all waits in ms (default 30000, at most 600000). */
  maxTotalWaitMs?: number
  /** Source of uniform randomness in [0, 1) for jitter; defaults to Math.random. */
  random?: () => number
}

/** Classification of one failed attempt. */
export interface RetryDecision {
  /** Whether sending the same request again may succeed. */
  retry: boolean
  /** Service-requested minimum wait in ms, when it sent one. */
  retryAfterMs?: number
}

/** Normalized, validated policy. */
interface Limits {maxAttempts: number; baseDelayMs: number; maxDelayMs: number; maxTotalWaitMs: number; random: () => number}

/** HTTP statuses that mean "not now" and are retried even without a header. */
export const RETRY_STATUSES: readonly number[] = Object.freeze([425, 429, 503])
/** HTTP statuses retried only when the service explicitly sends `Retry-After`. */
export const RETRY_AFTER_ONLY_STATUSES: readonly number[] = Object.freeze([409, 410, 422])

function limits(policy: RetryPolicy = {}): Limits {
  const value = (v: number | undefined, fallback: number, min: number, max: number, name: string) => {
    const n = v ?? fallback
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new TasraError(`Invalid retry policy ${name}`)
    return n
  }
  const maxDelayMs = value(policy.maxDelayMs, 10_000, 1, 600_000, 'maxDelayMs')
  const random = policy.random ?? Math.random
  if (typeof random !== 'function') throw new TasraError('Invalid retry policy random')
  return {maxAttempts: value(policy.maxAttempts, 4, 1, 10, 'maxAttempts'), baseDelayMs: value(policy.baseDelayMs, 250, 1, maxDelayMs, 'baseDelayMs'),
    maxDelayMs, maxTotalWaitMs: value(policy.maxTotalWaitMs, 30_000, 0, 600_000, 'maxTotalWaitMs'), random}
}

/**
 * The wait before the next attempt, or undefined when the policy says to stop.
 * A service `Retry-After` is a floor: the wait adds up to 20% (max 1 s) of jitter on top so
 * that refused clients do not return in lockstep, and it is never shortened. A requested wait
 * above `maxDelayMs` or beyond the remaining total budget stops retrying instead.
 * Without a header the wait is full-jitter exponential backoff from `baseDelayMs`.
 * @param attempt Zero-based index of the attempt that just failed.
 * @param retryAfterMs Service-requested wait, when any.
 * @param policy Retry limits.
 * @param waitedMs Sum of the waits already spent on this request.
 */
export function retryDelayMs(attempt: number, retryAfterMs: number | undefined, policy: RetryPolicy = {}, waitedMs = 0): number | undefined {
  const p = limits(policy)
  if (!Number.isSafeInteger(attempt) || attempt < 0 || !Number.isSafeInteger(waitedMs) || waitedMs < 0) throw new TasraError('Invalid retry state')
  if (attempt + 1 >= p.maxAttempts) return undefined
  const remaining = p.maxTotalWaitMs - waitedMs
  const r = Math.min(Math.max(p.random(), 0), 0.999_999)
  let delay: number
  if (retryAfterMs !== undefined) {
    if (!Number.isSafeInteger(retryAfterMs) || retryAfterMs < 0) throw new TasraError('Invalid Retry-After')
    if (retryAfterMs > p.maxDelayMs || retryAfterMs > remaining) return undefined
    const jitter = Math.floor(r * Math.min(1000, retryAfterMs * 0.2, p.maxDelayMs - retryAfterMs, remaining - retryAfterMs))
    delay = retryAfterMs + Math.max(0, jitter)
  } else {
    const ceiling = Math.min(p.maxDelayMs, p.baseDelayMs * 2 ** Math.min(attempt, 20))
    delay = Math.floor(r * ceiling)
    if (delay > remaining) return undefined
  }
  return delay
}

/**
 * Default classification for an idempotent request: retry 425/429/503, a 409/410/422 only
 * when the service sent `Retry-After`, other 5xx and unreachable endpoints with backoff.
 * Authorization refusals and other 4xx are final.
 * @param error Failure thrown by one attempt.
 */
export function classifyRetry(error: unknown): RetryDecision {
  if (error instanceof TasraHttpError) {
    const after = error.retryAfterMs
    if (RETRY_STATUSES.includes(error.status)) return {retry: true, retryAfterMs: after}
    if (RETRY_AFTER_ONLY_STATUSES.includes(error.status)) return after === undefined ? {retry: false} : {retry: true, retryAfterMs: after}
    return {retry: error.status >= 500 && error.status !== 501, retryAfterMs: after}
  }
  return {retry: error instanceof NodeUnreachableError}
}

/**
 * Retry only explicit "not now" refusals: 425/429/503, or 409/410/422 carrying
 * `Retry-After`. Generic 5xx and transport failures are final. Suits requests whose
 * repetition is harmless but whose callers expect a prompt failure otherwise.
 * @param error Failure thrown by one attempt.
 */
export function classifyRefusal(error: unknown): RetryDecision {
  const decision = classifyRetry(error)
  return error instanceof TasraHttpError && (RETRY_STATUSES.includes(error.status) || RETRY_AFTER_ONLY_STATUSES.includes(error.status))
    ? decision : {retry: false}
}

/**
 * Classification for a write whose refusal proves it was not processed: only HTTP 429, which
 * the verifier uses for SP-11 capacity refusals before it stores anything. A 5xx or lost reply
 * may follow processing, so it is final here.
 * @param error Failure thrown by one attempt.
 */
export function classifyRefusedWrite(error: unknown): RetryDecision {
  return error instanceof TasraHttpError && error.status === 429 ? {retry: true, retryAfterMs: error.retryAfterMs} : {retry: false}
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const done = () => { signal?.removeEventListener('abort', abort); resolve() }
    const timer = setTimeout(done, ms)
    const abort = () => { clearTimeout(timer); reject(signal!.reason) }
    signal?.addEventListener('abort', abort, {once: true})
  })
}

/**
 * Send one idempotent request, waiting between attempts as the service and policy allow.
 * The last failure is rethrown unchanged when the policy is exhausted, the classification says
 * stop, or the requested wait is longer than allowed. Only wrap a request that is safe to send
 * again; this function cannot tell.
 * @param work Sends the identical request; receives the zero-based attempt number.
 * @param options Policy, cancellation and an optional classifier (default {@link classifyRetry}).
 */
export async function retryIdempotent<T>(work: (attempt: number) => Promise<T>, options: {
  policy?: RetryPolicy; signal?: AbortSignal; classify?: (error: unknown) => RetryDecision
  /** Observe each scheduled wait (for logging or UI); never called for the final failure. */
  onRetry?: (event: {attempt: number; delayMs: number; error: unknown}) => void
} = {}): Promise<T> {
  const policy = {...options.policy}, classify = options.classify ?? classifyRetry
  limits(policy)
  let waited = 0
  for (let attempt = 0; ; attempt++) {
    options.signal?.throwIfAborted()
    try { return await work(attempt) }
    catch (error) {
      options.signal?.throwIfAborted()
      const decision = classify(error)
      if (!decision.retry) throw error
      const delay = retryDelayMs(attempt, decision.retryAfterMs, policy, waited)
      if (delay === undefined) throw error
      options.onRetry?.({attempt, delayMs: delay, error})
      await sleep(delay, options.signal)
      waited += delay
    }
  }
}
