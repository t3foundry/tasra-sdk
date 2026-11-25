import assert from 'node:assert/strict'

// Metered settlement is the accountants' own schedule: they settle what the keepers metered at
// their settle cadence, not at an operation's expiry. The gate therefore waits a bounded,
// explicitly configured time for the first charged settlement window of the workload.
const DEFAULT_OBSERVATION_SECS = 900
const MAX_OBSERVATION_SECS = 3600
/** Process deadline of the settlement stage: the longest observation plus evidence retention. */
export const SETTLEMENT_STAGE_TIMEOUT_MS = MAX_OBSERVATION_SECS * 1000 + 60_000

/** The observation budget in ms: `KK_VERIFY_SETTLEMENT_TIMEOUT_SECS` (60..3600), default 900. Compute once. */
export function settlementObservationBudget(configured: string | undefined): number {
  if (configured === undefined) return DEFAULT_OBSERVATION_SECS * 1000
  assert(/^[1-9][0-9]{1,3}$/.test(configured), 'Settlement observation timeout must be whole seconds')
  const seconds = Number(configured)
  assert(seconds >= 60 && seconds <= MAX_OBSERVATION_SECS, `Settlement observation timeout must be 60..${MAX_OBSERVATION_SECS} seconds`)
  return seconds * 1000
}

/** How many funded slots must show a charged settlement window: `KK_VERIFY_MIN_SETTLED_SLOTS` (1..256), default 1. */
export function requiredSettledSlots(configured: string | undefined, funded: number): number {
  assert(Number.isSafeInteger(funded) && funded > 0, 'Expected a nonempty funded workload')
  if (configured === undefined) return 1
  assert(/^[1-9][0-9]{0,2}$/.test(configured), 'Required settled slots must be a positive integer')
  const required = Number(configured)
  assert(required <= funded && required <= 256, 'More settled slots required than the workload funded')
  return required
}
