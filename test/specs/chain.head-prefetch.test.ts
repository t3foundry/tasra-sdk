import {afterEach, expect, it, vi} from 'vitest'
import type {Hex, PublicClient} from 'viem'
import {attachHeadFollower, type FollowedHead, type HeadFollower} from '../../src/chain/headFollower.js'
import {HEAD_PREFETCH_IDLE_MS, registerHeadPrefetch} from '../../src/chain/headPrefetch.js'

// A follower that vouches for every head it is handed; `advance` reports a new tip to the listeners.
function fixture() {
  const listeners = new Set<(tip: FollowedHead) => void>()
  let tip: FollowedHead | undefined
  const follower = {
    finality: 'instant', tip: () => tip, isCanonical: () => true, live: () => true,
    ingest: async () => {}, ingestFinalized: async () => {}, noteMinedBlock: () => {}, gaps: () => 0, start: () => {}, stop: () => {},
    onHead: (listener: (tip: FollowedHead) => void) => { listeners.add(listener); return () => listeners.delete(listener) },
  } as unknown as HeadFollower
  const client = {transport: {type: 'custom'}} as unknown as PublicClient
  attachHeadFollower(client, follower)
  let n = 0n
  const advance = () => {
    n += 1n
    tip = {blockNumber: n, blockHash: `0x${n.toString(16).padStart(64, '0')}` as Hex, blockTimestamp: 1000n + n} as FollowedHead
    for (const listener of listeners) listener(tip)
  }
  return {client, advance}
}

afterEach(() => { vi.useRealTimers() })

it('stops pre-reading an interest registered without an expiry once it is idle, and a use keeps it warm', () => {
  vi.useFakeTimers()
  const {client, advance} = fixture()
  const read = vi.fn(async () => undefined)
  registerHeadPrefetch(client, 'paid-slot:a', read)
  advance()
  expect(read).toHaveBeenCalledTimes(1)

  // Used again before the idle bound: still pre-read past the first registration's bound.
  vi.advanceTimersByTime(HEAD_PREFETCH_IDLE_MS - 1000)
  registerHeadPrefetch(client, 'paid-slot:a', read)
  vi.advanceTimersByTime(2000)
  advance()
  expect(read).toHaveBeenCalledTimes(2)

  // Not used for the idle bound: no more reads at any later head.
  vi.advanceTimersByTime(HEAD_PREFETCH_IDLE_MS)
  advance()
  advance()
  expect(read).toHaveBeenCalledTimes(2)
})

it('keeps an explicit expiry', () => {
  vi.useFakeTimers()
  const {client, advance} = fixture()
  const read = vi.fn(async () => undefined)
  registerHeadPrefetch(client, 'paid-request:a', read, Date.now() + 5 * HEAD_PREFETCH_IDLE_MS)
  vi.advanceTimersByTime(2 * HEAD_PREFETCH_IDLE_MS)
  advance()
  expect(read).toHaveBeenCalledTimes(1)
})
