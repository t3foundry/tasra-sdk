import {expect, it} from 'vitest'
import type {Hex} from 'viem'
import {readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {waitForAnchoredKey, waitForCommitteeKey, type AnchoredSlotView} from '../fleet/_anchored-key.ts'

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

/** A committee that serves `served` from its first keeper at once; the chain as {@link timeline}. */
function committeeSources(chain: ReturnType<typeof timeline>, served: string | null = KEY) {
  const asked: string[] = []
  return {
    asked,
    sources: {
      committee: async () => ['http://keeper-a', 'http://keeper-b'],
      keeperKey: async (keeper: string) => { asked.push(keeper); return keeper === 'http://keeper-a' ? served ?? undefined : undefined },
      readSlot: chain.read,
    },
  }
}

// 2026-11-12 cert run 17 (verify/bootstrap.ts): its own loop returned on the keeper's key (5 ms
// after creation), funded the slot, and paid discovery read the chain before the publishing block.
it('a committee wait returns only once the chain anchored the key a keeper served', async () => {
  const chain = timeline(4), {sources} = committeeSources(chain)
  await expect(waitForCommitteeKey(sources, chain.wait(10_000))).resolves.toEqual({committee: ['http://keeper-a', 'http://keeper-b'], publicKey: KEY})
  expect(chain.reads()).toBe(4)
})

it('a committee wait keeps polling while no keeper serves a key and refuses at its deadline', async () => {
  const chain = timeline(1), {sources, asked} = committeeSources(chain, null)
  await expect(waitForCommitteeKey(sources, chain.wait(5_000))).rejects.toThrow('no committee keeper served the slot key')
  expect(chain.reads()).toBe(0)
  expect(asked.length).toBeGreaterThan(2)
  const late = timeline(Number.POSITIVE_INFINITY), unanchored = committeeSources(late)
  await expect(waitForCommitteeKey(unanchored.sources, late.wait(1_200))).rejects.toThrow('not anchored on chain before the deadline')
  const other = timeline(1, `0x${'cd'.repeat(96)}`)
  await expect(waitForCommitteeKey(committeeSources(other).sources, other.wait(0))).rejects.toThrow('differs from the key a keeper served')
})

// Every fixture script that takes a keeper's `/v1/keys/:id/public` answer and then operates the
// slot through the paid path must also wait for the anchored key (or get its slot from
// createWalletSlot, which does). Run 13 found two such fixtures, run 17 the third.
it('no fleet script operates a paid slot on a keeper-served key alone', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const offenders: string[] = []
  let scanned = 0
  for (const dir of ['verify', 'e2e', 'stress', 'live', 'reconcile']) {
    for (const name of readdirSync(join(root, dir))) {
      if (!name.endsWith('.ts')) continue
      const source = readFileSync(join(root, dir, name), 'utf8')
      if (!/\/v1\/keys\/\$\{[^}]+\}\/public/.test(source)) continue
      if (!/\b(paidWalletBlsSharing|authorizeWallet|authorizePaidWallet|discoverPaidOperationContext|fundFreshWalletSlot)\(/.test(source)) continue
      scanned++
      if (!/\b(createWalletSlot|waitForSlotKeyOnChain|waitForCommitteeKey)\(/.test(source)) offenders.push(`${dir}/${name}`)
    }
  }
  expect(scanned).toBeGreaterThan(0)
  expect(offenders).toEqual([])
})
