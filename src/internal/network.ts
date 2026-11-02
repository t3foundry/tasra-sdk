/** One overall budget for keeper discovery or a single keeper operation. */
const DEADLINE_MS = 15_000

/** Bound the complete operation, including response bodies and transports ignoring abort. */
export async function withNetworkDeadline<T>(work: (signal: AbortSignal) => Promise<T>, caller?: AbortSignal): Promise<T> {
  caller?.throwIfAborted()
  const controller = new AbortController()
  const signal = caller ? AbortSignal.any([caller, controller.signal]) : controller.signal
  const timer = setTimeout(() => controller.abort(new DOMException('Keeper operation exceeded its 15-second deadline', 'TimeoutError')), DEADLINE_MS)
  let onAbort: (() => void) | undefined
  try {
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason)
      signal.addEventListener('abort', onAbort, {once: true})
      if (signal.aborted) onAbort()
    })
    signal.throwIfAborted()
    return await Promise.race([cancelled, work(signal)])
  } finally {
    clearTimeout(timer)
    if (onAbort) signal.removeEventListener('abort', onAbort)
    controller.abort()
  }
}

/** Resolve four operators at a time (two registry reads each), preserving input order. */
export async function resolveKeeperMembers<T, U>(members: readonly T[], resolve: (member: T) => Promise<U>, signal: AbortSignal): Promise<U[]> {
  const results = new Array<U>(members.length)
  let next = 0
  const worker = async () => {
    while (next < members.length) {
      signal.throwIfAborted()
      const index = next++
      results[index] = await resolve(members[index]!)
    }
  }
  await Promise.all(Array.from({length: Math.min(4, members.length)}, worker))
  return results
}
