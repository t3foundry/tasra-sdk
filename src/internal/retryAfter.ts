// Shared by errors.ts and retry.ts without an import cycle.

const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000

/**
 * Parse an HTTP `Retry-After` value (delta-seconds or an HTTP-date) into milliseconds.
 * Returns undefined for a missing, malformed, negative or absurd (over one day) value; a date
 * in the past is zero.
 * @param value Raw header value, or null/undefined when absent.
 * @param nowMs Current time in ms, for the HTTP-date form.
 */
export function parseRetryAfter(value: string | null | undefined, nowMs: number = Date.now()): number | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text || text.length > 64) return undefined
  if (/^[0-9]+$/.test(text)) {
    const ms = Number(text) * 1000
    return Number.isSafeInteger(ms) && ms <= MAX_RETRY_AFTER_MS ? ms : undefined
  }
  // HTTP-date (IMF-fixdate and the obsolete forms Date.parse understands); never a bare number.
  if (!/[A-Za-z]/.test(text)) return undefined
  const at = Date.parse(text)
  if (!Number.isFinite(at)) return undefined
  const ms = Math.max(0, at - nowMs)
  return ms <= MAX_RETRY_AFTER_MS ? ms : undefined
}
