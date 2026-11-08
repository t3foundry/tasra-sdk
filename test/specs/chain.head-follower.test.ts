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
  expect(f.follower.tip()).toMatchObject({blockNumber: 3n, blockHash: H(0, 3)})
  expect(f.follower.isCanonical(f.at(header(0, 2)))).toBe(true)
  // Another hash at a held number is not canonical; a block outside the window is not vouched for.
  expect(f.follower.isCanonical(f.at(header(5, 2)))).toBe(false)
  expect(f.follower.isCanonical(f.at(header(0, 9)))).toBeUndefined()
  expect(f.getBlock).not.toHaveBeenCalled()
})

it('fills missed heads through their parents', async () => {
  const f = fixture({}, [header(0, 2), header(0, 3)])
  await f.follower.ingest(header(0, 1)); await f.follower.ingest(header(0, 4))
  expect(f.getBlock).toHaveBeenCalledTimes(2)
  expect(f.follower.isCanonical(f.at(header(0, 3)))).toBe(true)
  expect(f.follower.gaps()).toBe(0)
})

it('follows a reorg found by a parentHash mismatch: the old branch is no longer canonical', async () => {
  // Branch 1 forks from block 2 of branch 0.
  const fork = header(1, 3, 0)
  const f = fixture({}, [fork])
  for (let n = 1; n <= 4; n++) await f.follower.ingest(header(0, n))
  await f.follower.ingest(header(1, 4))
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
  await f.follower.ingest(header(0, 7))
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
