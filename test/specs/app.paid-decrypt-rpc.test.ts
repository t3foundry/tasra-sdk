// RPC cost and read concurrency of paid IBE and KEM decryption with n = 3 assigned keepers,
// through the REAL application client, resolvePaidKeeperTarget and keeper approver over a
// canonical-read mock RPC (test/support/paidDecryptRpc.ts).
//
// Measured with this mock (n = 3; IBE and KEM cost the same; "new blocks" = a new head per read):
//   before (1dba30e), SDK chain client:  43 HTTP / 43 JSON-RPC per decrypt; 100 at once 1429 / 1429
//   Multicall3 at the canonical address: 11 HTTP / 15 JSON-RPC first, 9 / 13 after; 100 at once 10 / 28
//   no Multicall3 (JSON-RPC batch only): 11 HTTP / 45 JSON-RPC first, 9 / 43 after; 100 at once 40 / 1023
import {afterEach, describe, expect, it, vi} from 'vitest'
import {count, n, paidDecryptFixture, reads, type RpcFixtureOptions} from '../support/paidDecryptRpc.js'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

const directory = ['getKeySlot', 'assignedNodes', 'nodeRegistry', 'nodeOf', 'operatorIdOf', 'hasTag']
const reservation = ['prepaidEnabled', 'prepaidCost', 'prepaidSettled', 'prepaidRefunded', 'prepaidAssignmentBlock']
const pinned = [...directory, ...reservation]

async function measured(options: RpcFixtureOptions, operations = 1) {
  const f = await paidDecryptFixture(options)
  try { return {...await f.run(operations), log: [...f.log], overlaps: new Set(f.overlaps), fetches: f.fetchImpl.mock.calls.length} } finally { f.signer.dispose() }
}

describe('paid decryption RPC cost', () => {
  it(`resolves the paid keeper target once per wallet step, not once per keeper (n = ${n})`, async () => {
    const f = await measured({newBlockPerHead: true})
    expect(f.fetches).toBe(n)
    // One canonical head per target resolution: once before the wallet step, once after it.
    expect(count(f.log, 'block:latest')).toBe(1)
    expect(count(f.log, 'block:latest:after-grant')).toBe(1)
    // One canonicality recheck per resolution.
    expect(count(f.log, 'block:recheck')).toBe(2)
    // Without Multicall3 every pinned read is still its own eth_call (41 before this change, plus
    // the one-off Multicall3 code probe and one finalized-head read).
    expect(f.rpc).toBe(43)
  })

  it.each([false, true])('batches every block-pinned read of a step into one Multicall3 aggregate (KEM %s)', async kem => {
    const f = await measured({multicall: true, kem, newBlockPerHead: true})
    if (!kem) expect(f.fetches).toBe(n)
    // Two dependent steps per resolution (reservation + slot/roster, then the n keeper records).
    expect(count(f.log, 'call:aggregate3')).toBe(4)
    for (const name of pinned) expect(count(f.log, `call:${name}`)).toBe(0)
    for (const name of reservation) expect(count(f.log, `sub:${name}`)).toBe(2)
    expect(count(f.log, 'sub:nodeOf')).toBe(2 * n)
    // The code probe is made once per client.
    expect(count(f.log, 'code')).toBe(1)
    expect(f.rpc).toBe(13)
  })

  it('reads the latest head once per resolution and shares it, in flight only, across concurrent operations', async () => {
    const f = await paidDecryptFixture({multicall: true, refuseKeepers: true})
    try {
      await f.run(10)
      // 10 operations, two resolutions each: one shared head before the wallet step, one after.
      expect(count(f.log, 'block:latest')).toBe(1)
      expect(count(f.log, 'block:latest:after-grant')).toBe(1)
      // A head is never reused once answered: the next operation reads again.
      await f.run(1)
      expect(count(f.log, 'block:latest') + count(f.log, 'block:latest:after-grant')).toBe(2)
    } finally { f.signer.dispose() }
  })

  it('serves 100 concurrent operations in one client with a bounded number of requests', async () => {
    const f = await measured({transport: 'http', multicall: true, refuseKeepers: true}, 100)
    // Before: 1429 HTTP requests and 1429 JSON-RPC calls.
    expect(f.http).toBeLessThanOrEqual(12)
    expect(f.rpc).toBeLessThanOrEqual(30)
    // Reservation reads are never shared: each of the 100 operations read its own, twice.
    expect(count(f.log, 'sub:prepaidCost')).toBe(200)
    // At most 64 calls per aggregate.
    expect(count(f.log, 'call:aggregate3')).toBeGreaterThanOrEqual(Math.ceil(200 * 5 / 64))
  }, 30_000)

  it('groups requests into bounded JSON-RPC batches when Multicall3 is unavailable', async () => {
    const f = await measured({transport: 'http', newBlockPerHead: true})
    expect(f.rpc).toBe(45)
    expect(f.http).toBe(11)
    expect(count(f.log, 'call:aggregate3')).toBe(0)
  })

  it('sends requests one by one, with the same results, to an RPC that refuses JSON-RPC batches', async () => {
    const f = await paidDecryptFixture({transport: 'http', noBatches: true, newBlockPerHead: true})
    try {
      // Opening the slot sent one batch, which was refused; its requests were answered one by one.
      expect(f.counts.http).toBe(f.counts.rpc + 1)
      await f.run(1)
      expect(f.fetchImpl).toHaveBeenCalledTimes(n)
      // After it, every request goes alone: one HTTP request per call.
      expect(f.counts.http).toBe(f.counts.rpc)
      expect(f.counts.rpc).toBeGreaterThan(0)
    } finally { f.signer.dispose() }
  })

  it('never batches through code that is not the canonical Multicall3', async () => {
    const f = await measured({impostor: true, newBlockPerHead: true})
    expect(count(f.log, 'code')).toBe(1)
    expect(count(f.log, 'call:aggregate3')).toBe(0)
    expect(count(f.log, 'call:prepaidCost')).toBe(2)
  })

  it('reads every item alone, with the same outcome, when the aggregate call itself fails', async () => {
    const f = await measured({multicall: true, aggregateFails: true, newBlockPerHead: true})
    expect(f.fetches).toBe(n)
    expect(count(f.log, 'call:aggregate3')).toBe(4)
    expect(count(f.log, 'call:prepaidCost')).toBe(2)
    expect(count(f.log, 'call:nodeOf')).toBe(2 * n)
  })

  it.each(['custom', 'http'] as const)('fails a %s operation whose batched read reverts with the same error as an unbatched read', async transport => {
    const outcome = async (multicall: boolean) => {
      const f = await paidDecryptFixture({transport, multicall, revert: 'hasTag', revertIndex: 1})
      try {
        const error = await f.attempt().then(() => undefined, (e: unknown) => e as Error)
        return {error, log: [...f.log]}
      } finally { f.signer.dispose() }
    }
    const alone = await outcome(false), batched = await outcome(true)
    expect(batched.error).toBeInstanceOf(Error)
    expect(batched.error!.constructor).toBe(alone.error!.constructor)
    expect(batched.error!.message).toBe(alone.error!.message)
    expect(batched.error!.message).toContain('keeper record unavailable')
    // The failed item came back from the aggregate and was then read alone, exactly as before.
    expect(batched.log).toContain('sub:hasTag')
    expect(batched.log).toContain('call:hasTag')
    expect(count(batched.log, 'call:nodeOf')).toBe(0)
  })

  it('caches registry reads at a block the client confirmed finalized, never reservation reads', async () => {
    const f = await measured({multicall: true})
    // Both resolutions observe the same finalized block: the second one's directory comes from the cache.
    expect(count(f.log, 'block:finalized')).toBe(1)
    for (const name of directory) expect(reads(f.log, name)).toBe(name === 'nodeOf' || name === 'operatorIdOf' || name === 'hasTag' ? n : 1)
    for (const name of reservation) expect(reads(f.log, name)).toBe(2)
    expect(count(f.log, 'block:recheck')).toBe(2)
    expect(count(f.log, 'block:latest') + count(f.log, 'block:latest:after-grant')).toBe(2)
  })

  it.each(['behind', 'ahead', 'unsupported'] as const)('does not cache when the finalized head is %s', async finalized => {
    const f = await measured({multicall: true, finalized})
    for (const name of directory) expect(reads(f.log, name)).toBe(name === 'nodeOf' || name === 'operatorIdOf' || name === 'hasTag' ? 2 * n : 2)
  })

  it('never caches a failed read', async () => {
    const f = await paidDecryptFixture({multicall: true, revert: 'hasTag', revertIndex: 1})
    try {
      for (let i = 0; i < 2; i++) {
        f.reset()
        await expect(f.attempt()).rejects.toThrow('keeper record unavailable')
        expect(count(f.log, 'call:hasTag')).toBe(1)
      }
    } finally { f.signer.dispose() }
  })

  it('issues each group of independent reads concurrently', async () => {
    const f = await measured({newBlockPerHead: true})
    // slots.get / ready(): the chain check beside the slot read.
    expect(f.overlaps).toContain('eth_chainId | reader:getKeySlot')
    // resolvePaidKeeperTarget: the chain check beside the head, the reservation beside the directory.
    expect(f.overlaps).toContain('block:latest | eth_chainId')
    expect(f.overlaps).toContain('call:getKeySlot | call:prepaidCost')
    // After the wallet step: the slot recheck beside the paid target re-read.
    expect(f.overlaps).toContain('block:latest:after-grant | reader:getKeySlot')
  })
})
