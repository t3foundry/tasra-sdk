import {expect, it, vi} from 'vitest'
import type {Hex, PublicClient} from 'viem'
import {createHeadFollower, type HeadFollowerOptions} from '../../src/chain/headFollower.js'

// Block n on branch b has hash H(b, n); its parent is H(b, n - 1) unless a fork point says otherwise.
const H = (branch: number, n: number): Hex => `0x${branch.toString(16).padStart(2, '0')}${n.toString(16).padStart(62, '0')}`
interface Header {number: bigint; hash: Hex; parentHash: Hex; timestamp: bigint}
const header = (branch: number, n: number, parentBranch = branch): Header =>
  ({number: BigInt(n), hash: H(branch, n), parentHash: H(parentBranch, n - 1), timestamp: BigInt(1000 + n)})

function fixture(options: HeadFollowerOptions = {}, known: Header[] = []) {
  let clock = 0
  const blocks = new Map(known.map(b => [b.hash, b]))
  const getBlock = vi.fn(async ({blockHash}: {blockHash?: Hex}) => {
    const b = blockHash && blocks.get(blockHash)
    if (!b) throw new Error('block not found')
    return b
  })
  const client = {getBlock, transport: {type: 'custom'}} as unknown as PublicClient
  const follower = createHeadFollower(client, {finality: 'instant', window: 8, liveAfterMs: 1000, now: () => clock, ...options})
  const at = (b: Header) => ({blockNumber: b.number, blockHash: b.hash, blockTimestamp: b.timestamp})
  return {follower, getBlock, blocks, at, tick: (ms: number) => { clock += ms }}
}

it('follows a linked chain and vouches only for blocks it holds at their hash', async () => {
  const f = fixture()
  for (let n = 1; n <= 3; n++) await f.follower.ingest(header(0, n))
  await f.follower.ingestFinalized(header(0, 3))
  expect(f.follower.tip()).toMatchObject({blockNumber: 3n, blockHash: H(0, 3)})
  expect(f.follower.isCanonical(f.at(header(0, 2)))).toBe(true)
  // Another hash at a held number is not canonical; a block outside the window is not vouched for.
  expect(f.follower.isCanonical(f.at(header(5, 2)))).toBe(false)
  expect(f.follower.isCanonical(f.at(header(0, 9)))).toBeUndefined()
  expect(f.getBlock).not.toHaveBeenCalled()
})

it('fills missed heads through their parents', async () => {
  const f = fixture({}, [header(0, 2), header(0, 3)])
  await f.follower.ingest(header(0, 1)); await f.follower.ingest(header(0, 4)); await f.follower.ingestFinalized(header(0, 4))
  expect(f.getBlock).toHaveBeenCalledTimes(2)
  expect(f.follower.isCanonical(f.at(header(0, 3)))).toBe(true)
  expect(f.follower.gaps()).toBe(0)
})

it('follows a reorg found by a parentHash mismatch: the old branch is no longer canonical', async () => {
  // Branch 1 forks from block 2 of branch 0.
  const fork = header(1, 3, 0)
  const f = fixture({}, [fork])
  for (let n = 1; n <= 4; n++) await f.follower.ingest(header(0, n))
  await f.follower.ingest(header(1, 4)); await f.follower.ingestFinalized(header(1, 4))
  expect(f.follower.tip()).toMatchObject({blockHash: H(1, 4)})
  expect(f.follower.isCanonical(f.at(header(0, 3)))).toBe(false)
  expect(f.follower.isCanonical(f.at(header(0, 4)))).toBe(false)
  expect(f.follower.isCanonical(f.at(fork))).toBe(true)
  expect(f.follower.isCanonical(f.at(header(0, 2)))).toBe(true)
})

it('restarts at a gap and vouches for nothing before it', async () => {
  const f = fixture()
  for (let n = 1; n <= 3; n++) await f.follower.ingest(header(0, n))
  // Block 7's ancestry cannot be fetched: an unlinkable header.
  await f.follower.ingest(header(0, 7)); await f.follower.ingestFinalized(header(0, 7))
  expect(f.follower.gaps()).toBe(1)
  expect(f.follower.tip()).toMatchObject({blockNumber: 7n})
  expect(f.follower.isCanonical(f.at(header(0, 3)))).toBeUndefined()
  expect(f.follower.isCanonical(f.at(header(0, 7)))).toBe(true)
})

it('is not live without a head or an unchanged-tip poll, and vouches for nothing then', async () => {
  const f = fixture()
  await f.follower.ingest(header(0, 1))
  f.tick(900); await f.follower.ingest(header(0, 1))
  f.tick(900)
  expect(f.follower.tip()).toBeDefined()
  f.tick(200)
  expect(f.follower.live()).toBe(false)
  expect(f.follower.tip()).toBeUndefined()
  expect(f.follower.isCanonical(f.at(header(0, 1)))).toBeUndefined()
  // An older header the chain already holds (a lagging backend) is not a heartbeat.
  await f.follower.ingest(header(0, 2)); f.tick(1001); await f.follower.ingest(header(0, 1))
  expect(f.follower.live()).toBe(false)
})

it('never vouches under probabilistic finality, and ignores malformed headers', async () => {
  const f = fixture({finality: 'probabilistic'})
  await f.follower.ingest(header(0, 1))
  await f.follower.ingest({number: 2n, hash: '0x12'})
  expect(f.follower.tip()).toMatchObject({blockNumber: 1n})
  expect(f.follower.isCanonical(f.at(header(0, 1)))).toBeUndefined()
})

it('runs listeners on each new tip only and refuses invalid options', async () => {
  const f = fixture()
  const seen: bigint[] = []
  f.follower.onHead(tip => { seen.push(tip.blockNumber); throw new Error('a listener error is contained') })
  await f.follower.ingest(header(0, 1)); await f.follower.ingest(header(0, 1)); await f.follower.ingest(header(0, 2))
  expect(seen).toEqual([1n, 2n])
  for (const bad of [{window: 1}, {liveAfterMs: 0}, {pollMs: 10}, {finality: 'maybe' as 'instant'}]) expect(() => fixture(bad)).toThrow(/head follower/)
})

it('never hands out a tip that no head or poll confirmed within 2 s, and refuses looser bounds', async () => {
  let ms = 1_001_000
  const client = {getBlock: vi.fn(), transport: {type: 'custom'}} as unknown as PublicClient
  const follower = createHeadFollower(client, {finality: 'instant', now: () => ms})
  await follower.ingest({number: 1n, hash: H(0, 1), parentHash: H(0, 0), timestamp: 1001n})
  const at = {blockNumber: 1n, blockHash: H(0, 1), blockTimestamp: 1001n}
  ms += 2000
  expect(follower.tip()).toBeDefined()
  ms += 1
  expect(follower.tip()).toBeUndefined()
  expect(follower.isCanonical(at)).toBeUndefined()
  // The bound cannot be loosened past one block interval, and the poll must re-confirm inside it.
  expect(() => createHeadFollower(client, {liveAfterMs: 2001})).toThrow(/liveness/)
  expect(() => createHeadFollower(client, {liveAfterMs: 1000, pollMs: 1000})).toThrow(/poll interval/)
  expect(() => createHeadFollower(client, {maxTipAgeMs: 5000})).toThrow(/tip age/)
})

it('stays live on an idle chain whose old tip is re-confirmed every second by the poller', async () => {
  let ms = 5_000_000
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
  try {
    // The only block is 4000 s old; every poll answers it again as latest.
    const idle = {number: 7n, hash: H(0, 7), parentHash: H(0, 6), timestamp: 1000n}
    const getBlock = vi.fn(async () => idle)
    const client = {getBlock, transport: {type: 'http'}} as unknown as PublicClient
    const follower = createHeadFollower(client, {finality: 'instant', now: () => ms})
    follower.start()
    await vi.advanceTimersByTimeAsync(0)
    for (let second = 0; second < 10; second++) {
      ms += 1000; await vi.advanceTimersByTimeAsync(1000)
      expect(follower.tip(), String(second)).toMatchObject({blockHash: H(0, 7)})
    }
    expect(getBlock.mock.calls.length).toBeGreaterThanOrEqual(10)
    // Polls stop answering: within 2 s the follower is no longer live.
    getBlock.mockRejectedValue(new Error('rpc down'))
    ms += 2001; await vi.advanceTimersByTimeAsync(2001)
    expect(follower.tip()).toBeUndefined()
    follower.stop()
    // Opted-in block-age bound: the same idle tip is refused.
    const strict = createHeadFollower(client, {finality: 'instant', maxTipAgeMs: 2000, now: () => ms})
    getBlock.mockResolvedValue(idle)
    await strict.ingest(idle)
    expect(strict.tip()).toBeUndefined()
  } finally { vi.useRealTimers() }
})

it('vouches only at or below the finalized head it links to: a processing latest block is never vouched for', async () => {
  const f = fixture()
  for (let n = 1; n <= 3; n++) await f.follower.ingest(header(0, n))
  // latest is 3, finalized only 1: blocks 2 and 3 may still be rejected.
  await f.follower.ingestFinalized(header(0, 1))
  expect(f.follower.tip()).toMatchObject({blockNumber: 3n})
  expect(f.follower.isCanonical(f.at(header(0, 1)))).toBe(true)
  expect(f.follower.isCanonical(f.at(header(0, 3)))).toBeUndefined()
  // A finalized head on another branch than the followed chain vouches for nothing.
  await f.follower.ingestFinalized(header(9, 3))
  expect(f.follower.isCanonical(f.at(header(0, 1)))).toBeUndefined()
  await f.follower.ingestFinalized(header(0, 3))
  expect(f.follower.isCanonical(f.at(header(0, 3)))).toBe(true)
})

it('polls latest and finalized together', async () => {
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
  try {
    const tags: string[] = []
    const getBlock = vi.fn(async ({blockTag}: {blockTag?: string}) => { tags.push(blockTag ?? 'hash'); return blockTag === 'latest' ? header(0, 2) : header(0, 1) })
    let ms = 0
    const follower = createHeadFollower({getBlock, transport: {type: 'http'}} as unknown as PublicClient, {finality: 'instant', now: () => ms})
    follower.start(); await vi.advanceTimersByTimeAsync(0)
    expect(tags.slice(0, 2).sort()).toEqual(['finalized', 'latest'])
    expect(follower.tip()).toMatchObject({blockNumber: 2n})
    expect(follower.isCanonical({blockNumber: 2n, blockHash: H(0, 2), blockTimestamp: 1002n})).toBeUndefined()
    follower.stop(); ms = 1
  } finally { vi.useRealTimers() }
})

it('never links to a parent hash held at another height', async () => {
  const f = fixture()
  for (let n = 1; n <= 3; n++) await f.follower.ingest(header(0, n))
  // Block 9 names block 2's hash as its parent: no valid chain has that shape.
  await f.follower.ingest({number: 9n, hash: H(0, 9), parentHash: H(0, 2), timestamp: 1009n})
  expect(f.follower.gaps()).toBe(1)
  await f.follower.ingestFinalized(header(0, 9))
  expect(f.follower.isCanonical(f.at(header(0, 2)))).toBeUndefined()
})

it('hands out no tip older than a block this process saw its own transaction mined in', async () => {
  // The poller confirms about once a second: right after a reservation mines, the tip can still be
  // the block before, where the reservation does not exist yet. Callers then read the RPC head.
  const f = fixture()
  for (let n = 1; n <= 3; n++) await f.follower.ingest(header(0, n))
  expect(f.follower.tip()).toMatchObject({blockNumber: 3n})
  f.follower.noteMinedBlock(4n)
  expect(f.follower.tip()).toBeUndefined()
  f.follower.noteMinedBlock(2n) // never lowers the floor
  expect(f.follower.tip()).toBeUndefined()
  await f.follower.ingest(header(0, 4))
  expect(f.follower.tip()).toMatchObject({blockNumber: 4n, blockHash: H(0, 4)})
})
