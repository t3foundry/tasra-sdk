import {expect, it} from 'vitest'
import type {Hex} from 'viem'
import {waitForAnchoredKey, type AnchoredSlotView} from '../fleet/_anchored-key.ts'

const KEY = 'ab'.repeat(96)

/** A chain that publishes the key at its `publishAt`-th read; a fake clock advanced by sleeps. */
function timeline(publishAt: number, published: Hex = `0x${KEY}`, slot: Partial<AnchoredSlotView> = {}) {
  let reads = 0, clock = 0
  return {
    reads: () => reads,
    read: async (): Promise<AnchoredSlotView> => {
      reads++
      return {exists: true, cancelled: false, publicKey: reads >= publishAt ? published : '0x', ...slot}
    },
    wait: (deadlineMs: number) => ({deadlineMs, pollMs: 500, now: () => clock, sleep: async (ms: number) => { clock += ms }}),
  }
}

// 2026-11-12 cert run 13: the keeper served the BLS key (its own DKG done) about a second before
// the publishing block; the fixture returned on the keeper's answer and the paid discovery that
// followed was refused "paid slot is inactive or has no published key".
it('waits past a keeper-served key until the chain has anchored it', async () => {
  const chain = timeline(3)
  await expect(waitForAnchoredKey(chain.read, KEY, chain.wait(10_000))).resolves.toBe(`0x${KEY}`)
  expect(chain.reads()).toBe(3)
})

it('returns at once when the key is already anchored, comparing case- and prefix-insensitively', async () => {
  const chain = timeline(1)
  await expect(waitForAnchoredKey(chain.read, `0x${KEY.toUpperCase()}`, chain.wait(0))).resolves.toBe(`0x${KEY}`)
  expect(chain.reads()).toBe(1)
})

it('refuses a deadline without an anchored key, a different key and a missing or cancelled slot', async () => {
  const never = timeline(Number.POSITIVE_INFINITY)
  await expect(waitForAnchoredKey(never.read, KEY, never.wait(1_200))).rejects.toThrow('not anchored on chain before the deadline')
  expect(never.reads()).toBe(3)
  const other = timeline(1, `0x${'cd'.repeat(96)}`)
  await expect(waitForAnchoredKey(other.read, KEY, other.wait(0))).rejects.toThrow('differs from the key a keeper served')
  for (const slot of [{exists: false}, {cancelled: true}]) {
    const gone = timeline(1, `0x${KEY}`, slot)
    await expect(waitForAnchoredKey(gone.read, KEY, gone.wait(10_000))).rejects.toThrow('missing or cancelled')
  }
  await expect(waitForAnchoredKey(timeline(1).read, '', {deadlineMs: 0})).rejects.toThrow('no group key')
})
