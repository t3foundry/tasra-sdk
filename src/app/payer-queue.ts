// Serialize reservation submissions from one gas payer within this process. The durable
// payer lock in the application store still fences other processes and every unresolved
// original nonce; this only keeps two local callers from racing to that lock.
const tails = new Map<string, Promise<void>>()

/**
 * Run `work` after every earlier call for the same payer identity has settled.
 * @param identity Chain and payer, e.g. `43112-0xabc…`.
 * @param work Reservation submission.
 */
export async function withDedicatedPayer<T>(identity: string, work: () => Promise<T>): Promise<T> {
  const previous = tails.get(identity) ?? Promise.resolve()
  const running = previous.then(work)
  const tail = running.then(() => {}, () => {})
  tails.set(identity, tail)
  try { return await running }
  finally { if (tails.get(identity) === tail) tails.delete(identity) }
}
