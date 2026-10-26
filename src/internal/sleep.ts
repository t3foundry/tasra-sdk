// Shared by retry.ts and oid4vp/request-object.ts.

/**
 * Wait `ms` milliseconds, rejecting with the signal's reason as soon as it aborts.
 * @param ms Wait in milliseconds.
 * @param signal Optional cancellation.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const done = () => { signal?.removeEventListener('abort', abort); resolve() }
    const timer = setTimeout(done, ms)
    const abort = () => { clearTimeout(timer); reject(signal!.reason) }
    signal?.addEventListener('abort', abort, {once: true})
  })
}
