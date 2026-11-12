import {readFileSync} from 'node:fs'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {createPublicClient, custom, decodeFunctionData, encodeFunctionData, encodeFunctionResult, keccak256, multicall3Abi, type Hex} from 'viem'
import {ExpiringCache} from '../../src/internal/bounded.js'
import {CANONICAL_MULTICALL3, MAX_AGGREGATE_CALLS, MULTICALL3_CODE_HASH, configurePinnedReads, pinnedCall} from '../../src/chain/pinnedReads.js'
import {createTasraChainClient} from '../../src/chain/client.js'
import {settlementAbi} from '../../src/chain/abis/settlement.js'

const multicall3 = JSON.parse(readFileSync(new URL('../multicall3-runtime.json', import.meta.url), 'utf8')) as {address: Hex; code: Hex; codeHash: Hex}
const h = (byte: number, length = 32): Hex => `0x${byte.toString(16).padStart(2, '0').repeat(length)}`
const settlement = h(0x55, 20)
const read = (slot: number) => encodeFunctionData({abi: settlementAbi, functionName: 'balanceOf', args: [h(slot)]})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function mock(options: {code?: Hex} = {}) {
  const calls: {method: string; params: unknown}[] = []
  const client = createPublicClient({transport: custom({request: async ({method, params}: {method: string; params?: unknown}) => {
    calls.push({method, params})
    if (method === 'eth_getCode') return options.code ?? multicall3.code
    if (method !== 'eth_call') throw new Error(`unexpected ${method}`)
    const [call] = params as [{to: Hex; data: Hex}]
    const answer = (data: Hex) => encodeFunctionResult({abi: settlementAbi, functionName: 'balanceOf', result: BigInt(decodeFunctionData({abi: settlementAbi, data}).args[0] as Hex)})
    if (call.to.toLowerCase() !== CANONICAL_MULTICALL3.toLowerCase()) return answer(call.data)
    const items = decodeFunctionData({abi: multicall3Abi, data: call.data}).args[0] as readonly {callData: Hex}[]
    return encodeFunctionResult({abi: multicall3Abi, functionName: 'aggregate3', result: items.map(item => ({success: true, returnData: answer(item.callData)}))})
  }}, {retryCount: 0})})
  return {client, calls, aggregates: () => calls.filter(c => c.method === 'eth_call' && (c.params as [{to: Hex}])[0].to.toLowerCase() === CANONICAL_MULTICALL3.toLowerCase())}
}

describe('ExpiringCache', () => {
  it('evicts the least recently used entry at its bound, drops expired entries and never stores an expired value', () => {
    const cache = new ExpiringCache<number>(2)
    cache.set('a', 1, 100, 0); cache.set('b', 2, 100, 0)
    expect(cache.get('a', 1)).toBe(1) // refreshes a
    cache.set('c', 3, 100, 1) // evicts b
    expect(cache.size).toBe(2)
    expect(cache.get('b', 1)).toBeUndefined()
    expect(cache.get('c', 100)).toBeUndefined() // expired at 100
    cache.set('d', 4, 5, 5)
    expect(cache.get('d', 0)).toBeUndefined()
    expect(() => new ExpiringCache(0)).toThrow()
  })
})

describe('block-pinned reads', () => {
  it('pins the expected Multicall3 code hash to the canonical deployment read from Fuji and C-Chain', () => {
    expect(keccak256(multicall3.code)).toBe(MULTICALL3_CODE_HASH)
    expect(multicall3.codeHash).toBe(MULTICALL3_CODE_HASH)
    expect(multicall3.address).toBe(CANONICAL_MULTICALL3)
  })

  it('batches reads at one block hash, never across blocks, at most 64 calls per canonical aggregate', async () => {
    const m = mock()
    const results = await Promise.all([
      ...Array.from({length: MAX_AGGREGATE_CALLS + 2}, (_, i) => pinnedCall(m.client, h(0x20), settlement, read(i + 1))),
      pinnedCall(m.client, h(0x21), settlement, read(7)), pinnedCall(m.client, h(0x21), settlement, read(8)),
    ])
    expect(results.map(r => BigInt(r!))).toEqual([...Array.from({length: MAX_AGGREGATE_CALLS + 2}, (_, i) => BigInt(h(i + 1))), BigInt(h(7)), BigInt(h(8))])
    const aggregates = m.aggregates()
    expect(aggregates).toHaveLength(3)
    const sizes = aggregates.map(c => (decodeFunctionData({abi: multicall3Abi, data: (c.params as [{data: Hex}])[0].data}).args[0] as unknown[]).length)
    expect(sizes.sort((a, b) => a - b)).toEqual([2, 2, MAX_AGGREGATE_CALLS])
    for (const c of m.calls.filter(c => c.method !== 'eth_getCode')) expect((c.params as unknown[])[1]).toMatchObject({requireCanonical: true})
    // The probe is pinned too, and made once per client.
    expect(m.calls.filter(c => c.method === 'eth_getCode')).toHaveLength(1)
    expect(m.calls.find(c => c.method === 'eth_getCode')!.params).toEqual([CANONICAL_MULTICALL3, {blockHash: h(0x20), requireCanonical: true}])
  })

  it('reads alone where Multicall3 is absent, and probes again only after a minute', async () => {
    const m = mock({code: '0x'})
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const pair = () => Promise.all([pinnedCall(m.client, h(0x20), settlement, read(1)), pinnedCall(m.client, h(0x20), settlement, read(2))])
    expect((await pair()).map(r => BigInt(r!))).toEqual([1n, 2n].map(i => BigInt(h(Number(i)))))
    await pair()
    expect(m.calls.filter(c => c.method === 'eth_getCode')).toHaveLength(1)
    expect(m.aggregates()).toHaveLength(0)
    now.mockReturnValue(1_061_000)
    await pair()
    expect(m.calls.filter(c => c.method === 'eth_getCode')).toHaveLength(2)
  })

  it('neither probes nor batches when the client disables Multicall3', async () => {
    const m = mock()
    configurePinnedReads(m.client, false)
    await Promise.all([pinnedCall(m.client, h(0x20), settlement, read(1)), pinnedCall(m.client, h(0x20), settlement, read(2))])
    expect(m.calls.map(c => c.method)).toEqual(['eth_call', 'eth_call'])
  })
})

describe('chain client JSON-RPC batching', () => {
  const addresses = {KeyRegistry: h(0x33, 20)}
  const server = () => {
    const bodies: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {id: number; method: string} | {id: number; method: string}[]
      bodies.push(body)
      const one = (e: {id: number; method: string}) => ({jsonrpc: '2.0', id: e.id, result: e.method === 'eth_chainId' ? '0xa868' : '0x10'})
      return new Response(JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)), {headers: {'Content-Type': 'application/json'}})
    }))
    return bodies
  }
  it('groups concurrent small requests into one HTTP request, and sends each alone when disabled', async () => {
    let bodies = server()
    const batched = createTasraChainClient({rpcUrl: 'http://rpc.test/', addresses, chainId: 43112})
    expect(await Promise.all([batched.client.getChainId(), batched.client.getBlockNumber({cacheTime: 0})])).toEqual([43112, 16n])
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toHaveLength(2)
    vi.unstubAllGlobals(); bodies = server()
    const alone = createTasraChainClient({rpcUrl: 'http://rpc.test/', addresses, chainId: 43112, rpcBatch: false})
    await Promise.all([alone.client.getChainId(), alone.client.getBlockNumber({cacheTime: 0})])
    expect(bodies).toHaveLength(2)
    expect(bodies.every(body => !Array.isArray(body))).toBe(true)
  })
  it('refuses unbounded batch settings', () => {
    for (const rpcBatch of [{batchSize: 0}, {batchSize: 1001}, {batchSize: 1.5}, {wait: -1}, {wait: 101}]) {
      expect(() => createTasraChainClient({rpcUrl: 'http://rpc.test/', addresses, rpcBatch})).toThrow(/rpcBatch/)
    }
  })
})
