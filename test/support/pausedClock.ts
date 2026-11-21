// A PAUSED clock for "it does not wait" claims (the network certification's rule 2: a logic defect
// cannot be load-sensitive, so no hermetic test may pass or fail by how fast the host runs it).
//
// `onPausedClock(work)` runs `work` with setTimeout/setInterval, Date and performance faked. Fake time
// moves ONLY when nothing else can run: every microtask and real immediate has drained and the work is
// still pending, then the clock jumps to the next due timer. So the elapsed time it returns is exactly
// the time the CODE chose to wait (its sleeps, backoffs, Retry-After pauses, deadline polls), and never
// how long a loaded host took to execute it: a fast and a throttled run read the same number.
//
// ⚠ Only for work whose I/O is STUBBED. A real socket, file or worker round trip can still be pending
// when the clock jumps, and a timer guarding it (a request timeout) would then fire early. Real-I/O
// tests assert counts or ordering instead, with a generous hang guard.
import {vi} from 'vitest'

export interface PausedOutcome<T> {
  /** The settled result of `work`. */
  result: PromiseSettledResult<T>
  /** Fake milliseconds the work waited: the sum of the clock jumps to its due timers. */
  elapsedMs: number
}

const realImmediate = (): Promise<void> => new Promise(resolve => { setImmediate(resolve) })

export async function onPausedClock<T>(work: () => Promise<T>, {now = Date.now(), maxJumps = 100_000}: {now?: number; maxJumps?: number} = {}): Promise<PausedOutcome<T>> {
  vi.useFakeTimers({now, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance']})
  try {
    const started = Date.now()
    let result: PromiseSettledResult<T> | undefined
    void work().then(value => { result = {status: 'fulfilled', value} }, (reason: unknown) => { result = {status: 'rejected', reason} })
    for (let jumps = 0; ; jumps++) {
      // Real immediates are not faked: one runs only after every pending microtask has.
      await realImmediate()
      if (result) return {result, elapsedMs: Date.now() - started}
      if (jumps >= maxJumps) throw new Error(`onPausedClock: still pending after ${maxJumps} timer jumps`)
      if (vi.getTimerCount() > 0) await vi.advanceTimersToNextTimerAsync()
    }
  } finally { vi.useRealTimers() }
}

/** The fulfilled value, or the rejection rethrown. */
export function settledValue<T>(result: PromiseSettledResult<T>): T {
  if (result.status === 'rejected') throw result.reason
  return result.value
}

/** The rejection reason (fails the test when the work fulfilled). */
export function settledError<T>(result: PromiseSettledResult<T>): unknown {
  if (result.status === 'fulfilled') throw new Error('expected the work to reject, it fulfilled')
  return result.reason
}
