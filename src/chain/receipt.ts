// Waiting for the receipt of ONE broadcast transaction on the paid path.
//
// viem's waitForTransactionReceipt watches the head on a fixed interval (1 s as configured here
// before, 4 s by default) and then reads the transaction and its receipt: a reservation landed on a
// one-second grid and cost a head read per tick plus a transaction read. This asks for the receipt
// itself, soon after the broadcast and then less and less often (250 ms growing by half, at most
// 1 s), so a transaction mined in a few hundred milliseconds is seen then, with fewer requests.
// Nothing is decided here: a missing receipt keeps waiting until the deadline, any other RPC error
// ends the wait, and the caller still verifies the transaction, its block and its effects.

import {TransactionReceiptNotFoundError, WaitForTransactionReceiptTimeoutError, type Hash, type PublicClient, type TransactionReceipt} from 'viem'
import {headFollowerOf} from './headFollower.js'

/** First pause before asking again, ms. */
const FIRST_POLL_MS = 250
/** Longest pause between two receipt (or head) reads, ms. */
const MAX_POLL_MS = 1_000

/**
 * Receipt polling interval of the SDK's own write clients, ms. viem polls every 4 s unless the
 * chain names a block time; Avalanche produces a block in about 2 s, so a write landed on a 4 s grid.
 */
export const WRITE_POLL_INTERVAL_MS = 1_000

/** Options for {@link pollTransactionReceipt}. */
export interface PollReceiptOptions {
  /** Blocks the receipt's block must have on top of it, counting itself (1..64). */
  confirmations: number
  /** Deadline for the whole wait, ms. */
  timeoutMs: number
  /** Stops the wait (and every further read). */
  signal?: AbortSignal
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    const abort = () => { clearTimeout(timer); reject(signal!.reason) }
    signal?.addEventListener('abort', abort, {once: true})
  })
}

/**
 * The receipt of `hash` once it has `confirmations` blocks, read directly with a short, growing
 * interval. Throws viem's WaitForTransactionReceiptTimeoutError at the deadline; any RPC error
 * other than "receipt not found" is thrown at once.
 * @param client Trusted public client.
 * @param hash Broadcast transaction hash.
 * @param options Confirmations, deadline and cancellation.
 */
export async function pollTransactionReceipt(client: PublicClient, hash: Hash, options: PollReceiptOptions): Promise<TransactionReceipt> {
  // The deadline is a timer (as in viem), not a clock reading: one abort ends the pause in progress.
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(new WaitForTransactionReceiptTimeoutError({hash})), options.timeoutMs)
  const active = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal
  let delay = FIRST_POLL_MS
  const next = async () => {
    await pause(delay, active)
    delay = Math.min(MAX_POLL_MS, Math.round(delay * 1.5))
  }
  try {
    let receipt: TransactionReceipt | undefined
    for (;;) {
      active.throwIfAborted()
      try {
        receipt = await client.getTransactionReceipt({hash})
        // Reads after this must not use a followed tip from before the transaction.
        headFollowerOf(client)?.noteMinedBlock(receipt.blockNumber)
        break
      }
      catch (error) { if (!(error instanceof TransactionReceiptNotFoundError)) throw error }
      await next()
    }
    if (options.confirmations <= 1) return receipt
    delay = FIRST_POLL_MS
    for (;;) {
      active.throwIfAborted()
      if (await client.getBlockNumber({cacheTime: 0}) - receipt.blockNumber + 1n >= BigInt(options.confirmations)) return receipt
      await next()
    }
  } finally { clearTimeout(timer) }
}
