// P13 (robustness audit 2026-11-13): the verifier directory is shared per client, but a FAILED
// lookup is never kept - one RPC error used to poison the client until it was rebuilt.
import {expect, it} from 'vitest'
import {createCommitteeSlotClient} from '../../src/chain/committeeClient.js'
import {createTasraSlotClient} from '../../src/chain/slotClient.js'
import type {TasraChainClient} from '../../src/chain/client.js'

function flakyChain() {
  let lookups = 0
  const chain = {
    readers: {nodeRegistry: {activeOperators: async () => { if (lookups++ === 0) throw new Error('rpc down'); return [] }}, beacon: {}, keyRegistry: {}},
    readMany: async () => [],
  } as unknown as TasraChainClient
  return {chain, lookups: () => lookups}
}

it('a failed verifier-directory lookup is not cached: the next call reads again', async () => {
  for (const make of [(chain: TasraChainClient) => createCommitteeSlotClient({chain}), (chain: TasraChainClient) => createTasraSlotClient({chain})]) {
    const {chain, lookups} = flakyChain()
    const client = make(chain)
    await expect(client.verifierDirectory()).rejects.toThrow(/rpc down/)
    await expect(client.verifierDirectory()).resolves.toEqual([])
    await client.verifierDirectory() // a success IS kept
    expect(lookups()).toBe(2)
  }
})
