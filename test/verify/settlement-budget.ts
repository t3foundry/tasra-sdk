import assert from 'node:assert/strict'
import {RECIPIENT_FEE_TIMEOUT_MS} from './recipient-fees.ts'

// The local fixture permits at most one hour of work. Accountants schedule final
// settlement at signed payment expiry, so its observation allowance starts then.
const MAX_REMAINING_WORK_MS = 3_600_000
const SETTLEMENT_ALLOWANCE_MS = 600_000
export const SETTLEMENT_STAGE_TIMEOUT_MS = MAX_REMAINING_WORK_MS + SETTLEMENT_ALLOWANCE_MS + RECIPIENT_FEE_TIMEOUT_MS + 60_000

/** Compute once: subsequent polls must not move the deadline. */
export function settlementObservationBudget(expires: readonly number[], nowMs: number): number {
  assert(Number.isSafeInteger(nowMs) && nowMs >= 0, 'Invalid observation time')
  assert(expires.length > 0 && expires.length <= 256, 'Expected bounded original payment expiries')
  let latestMs = nowMs
  for (const seconds of expires) {
    const ms = seconds * 1000
    assert(Number.isSafeInteger(seconds) && seconds > 0 && Number.isSafeInteger(ms), 'Invalid original payment expiry')
    assert(ms - nowMs <= MAX_REMAINING_WORK_MS, 'Original payment exceeds local fixture lifetime')
    latestMs = Math.max(latestMs, ms)
  }
  return latestMs - nowMs + SETTLEMENT_ALLOWANCE_MS
}
