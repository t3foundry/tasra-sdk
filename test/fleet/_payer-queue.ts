// Serialize only gas reservation submissions from this process. Durable SDK
// payer locks still fence other processes and every unresolved original nonce.
const tails = new Map<string, Promise<void>>()
export async function withDedicatedPayer<T>(identity: string, work: () => Promise<T>): Promise<T> {
  const previous = tails.get(identity) ?? Promise.resolve()
  const running = previous.then(work)
  const tail = running.then(() => {}, () => {})
  tails.set(identity, tail)
  try {return await running}
  finally {if (tails.get(identity) === tail) tails.delete(identity)}
}
