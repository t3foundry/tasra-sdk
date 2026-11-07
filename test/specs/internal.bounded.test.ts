import {describe, expect, it, vi} from 'vitest'
import {BoundedCache, SingleFlight} from '../../src/internal/bounded.js'

describe('BoundedCache', () => {
  it('evicts the least recently used entry at its bound and never stores a failed computation', () => {
    const cache = new BoundedCache<string, number>(2)
    const compute = vi.fn((n: number) => () => n)
    cache.getOrCompute('a', compute(1)); cache.getOrCompute('b', compute(2))
    expect(cache.getOrCompute('a', compute(9))).toBe(1) // hit refreshes a
    cache.getOrCompute('c', compute(3)) // evicts b
    expect(cache.size).toBe(2)
    expect(cache.getOrCompute('b', compute(4))).toBe(4)
    expect(() => cache.getOrCompute('x', () => { throw new Error('bad point') })).toThrow('bad point')
    expect(cache.getOrCompute('x', () => 5)).toBe(5)
    expect(() => new BoundedCache(0)).toThrow()
  })
})

describe('SingleFlight', () => {
  it('shares one pending request per key, reuses no settled result and stays within its bound', async () => {
    const flight = new SingleFlight<number>(2)
    let release!: (n: number) => void
    const run = vi.fn(() => new Promise<number>(resolve => { release = resolve }))
    const a = flight.run('k', run), b = flight.run('k', run)
    expect(run).toHaveBeenCalledTimes(1)
    release(7)
    expect(await a).toBe(7); expect(await b).toBe(7)
    expect(flight.size).toBe(0)
    void flight.run('k', run) // settled: a new request
    expect(run).toHaveBeenCalledTimes(2)
    void flight.run('k2', run)
    const extra = vi.fn(async () => 1)
    await flight.run('k3', extra) // bound reached: runs alone, not tracked
    expect(extra).toHaveBeenCalledTimes(1)
    expect(flight.size).toBe(2)
  })
  it('never reuses a failed request', async () => {
    const flight = new SingleFlight<number>(4)
    await expect(flight.run('k', () => Promise.reject(new Error('rpc down')))).rejects.toThrow('rpc down')
    expect(await flight.run('k', async () => 3)).toBe(3)
  })
})
