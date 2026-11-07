import {afterEach, describe, expect, it, vi} from 'vitest'
import {TransactionReceiptNotFoundError, WaitForTransactionReceiptTimeoutError, type Hash, type PublicClient, type TransactionReceipt} from 'viem'
import {pollTransactionReceipt} from '../../src/chain/receipt.js'

const hash = ('0x' + 'ab'.repeat(32)) as Hash
const receipt = {transactionHash: hash, blockNumber: 20n, status: 'success'} as TransactionReceipt
afterEach(() => { vi.useRealTimers() })

function client(minedAfter: number, head = 20n) {
  const reads: number[] = []
  const c = {
    getTransactionReceipt: vi.fn(async () => {
      reads.push(Date.now())
      if (reads.length <= minedAfter) throw new TransactionReceiptNotFoundError({hash})
      return receipt
    }),
    getBlockNumber: vi.fn(async () => head),
  }
  return {client: c as unknown as PublicClient, mock: c, reads}
}

describe('pollTransactionReceipt', () => {
  it('asks for the receipt at once, then every 250 ms growing by half up to 1 s, with no head reads', async () => {
    vi.useFakeTimers({now: 0})
    const f = client(6)
    const wait = pollTransactionReceipt(f.client, hash, {confirmations: 1, timeoutMs: 60_000})
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await wait).toBe(receipt)
    expect(f.reads).toEqual([0, 250, 625, 1188, 2033, 3033, 4033])
    expect(f.mock.getBlockNumber).not.toHaveBeenCalled()
  })

  it('waits for the requested confirmations on top of the receipt block', async () => {
    vi.useFakeTimers({now: 0})
    const f = client(0, 20n)
    f.mock.getBlockNumber.mockResolvedValueOnce(20n).mockResolvedValueOnce(21n).mockResolvedValueOnce(22n)
    const wait = pollTransactionReceipt(f.client, hash, {confirmations: 3, timeoutMs: 60_000})
    await vi.advanceTimersByTimeAsync(5_000)
    await expect(wait).resolves.toBe(receipt)
    expect(f.mock.getBlockNumber).toHaveBeenCalledTimes(3)
  })

  it('ends at the deadline, on any other RPC error, and on abort', async () => {
    vi.useFakeTimers({now: 0})
    const slow = client(1_000)
    const late = pollTransactionReceipt(slow.client, hash, {confirmations: 1, timeoutMs: 2_000}).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(await late).toBeInstanceOf(WaitForTransactionReceiptTimeoutError)
    const broken = client(0)
    broken.mock.getTransactionReceipt.mockRejectedValueOnce(new Error('rpc down'))
    await expect(pollTransactionReceipt(broken.client, hash, {confirmations: 1, timeoutMs: 2_000})).rejects.toThrow('rpc down')
    const controller = new AbortController(), pending = client(1_000)
    const aborted = pollTransactionReceipt(pending.client, hash, {confirmations: 1, timeoutMs: 60_000, signal: controller.signal}).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(300)
    controller.abort(new Error('stop'))
    expect(await aborted).toMatchObject({message: 'stop'})
    const before = pending.reads.length
    await vi.advanceTimersByTimeAsync(5_000)
    expect(pending.reads).toHaveLength(before)
  })
})
