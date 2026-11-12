import {describe, expect, it, vi} from 'vitest'
import {createPublicClient, custom, http} from 'viem'
import {chainIdOf} from '../../src/chain/chainId.js'

describe('chainIdOf', () => {
  it('asks an HTTP client once and keeps the answer with that client only', async () => {
    const fetchFn = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const {id} = JSON.parse(String(init?.body)) as {id: number}
      return new Response(JSON.stringify({jsonrpc: '2.0', id, result: '0xa868'}), {headers: {'content-type': 'application/json'}})
    })
    const make = () => createPublicClient({transport: http('http://127.0.0.1:9', {fetchFn})})
    const a = make(), b = make()
    expect(await Promise.all([chainIdOf(a), chainIdOf(a), chainIdOf(a)])).toEqual([43112, 43112, 43112])
    expect(await chainIdOf(a)).toBe(43112)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(await chainIdOf(b)).toBe(43112)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('never keeps a failed read', async () => {
    let fail = true
    const fetchFn = vi.fn(async (_input: unknown, init?: RequestInit) => {
      if (fail) throw new Error('rpc down')
      const {id} = JSON.parse(String(init?.body)) as {id: number}
      return new Response(JSON.stringify({jsonrpc: '2.0', id, result: '0xa868'}), {headers: {'content-type': 'application/json'}})
    })
    const client = createPublicClient({transport: http('http://127.0.0.1:9', {fetchFn, retryCount: 0})})
    await expect(chainIdOf(client)).rejects.toThrow()
    fail = false
    expect(await chainIdOf(client)).toBe(43112)
  })

  it('asks an injected wallet transport on every call: it can switch chains', async () => {
    let chain = '0xa868'
    const request = vi.fn(async ({method}: {method: string}) => { if (method !== 'eth_chainId') throw new Error(method); return chain })
    const client = createPublicClient({transport: custom({request})})
    expect(await chainIdOf(client)).toBe(43112)
    chain = '0xa869'
    expect(await chainIdOf(client)).toBe(43113)
    expect(request).toHaveBeenCalledTimes(2)
    // A bare object without a transport (a test double, a custom reader) is never cached either.
    const plain = {getChainId: vi.fn(async () => 1)}
    await chainIdOf(plain); await chainIdOf(plain)
    expect(plain.getChainId).toHaveBeenCalledTimes(2)
  })
})
