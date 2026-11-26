// The in-memory ApplicationStore and structured signing intents: kept pieces whose behaviour
// slot creation, session grants and native approvals rely on.
import {describe, expect, it, vi} from 'vitest'
import {hashMessage, hashTypedData, toHex} from 'viem'
import {sha256} from '@noble/hashes/sha256'
import {createMemoryStore} from '../../src/app/memory-store.js'
import {signingIntentCurve, signingIntentDigest} from '../../src/app/signing-intents.js'

describe('in-memory application store', () => {
  it('copies values on save and load, lists by prefix and refuses invalid keys', async () => {
    const store = createMemoryStore(), value = {phase: 'opened', seq: 1, bytes: new Uint8Array([1, 2])}
    await store.save('session-1', value)
    value.seq = 2
    const loaded = await store.load<typeof value>('session-1')
    expect(loaded).toEqual({phase: 'opened', seq: 1, bytes: new Uint8Array([1, 2])})
    loaded!.seq = 9
    expect((await store.load<typeof value>('session-1'))!.seq).toBe(1)
    expect(await store.load('absent')).toBeUndefined()
    await store.save('session-2', 1); await store.save('slot-x', 2)
    expect((await store.list!('session-')).sort()).toEqual(['session-1', 'session-2'])
    await expect(store.save('bad key', 1)).rejects.toThrow(/Invalid state key/)
    await expect(store.load('../escape')).rejects.toThrow(/Invalid state key/)
    await expect(store.withLock('', async () => 1)).rejects.toThrow(/Invalid state key/)
  })
  it('a claim is won exactly once, also against a saved record', async () => {
    const store = createMemoryStore()
    expect(await Promise.all([store.claim!('once'), store.claim!('once'), store.claim!('once')])).toEqual([true, false, false])
    await store.save('taken', {})
    expect(await store.claim!('taken')).toBe(false)
    await expect(store.claim!('bad key')).rejects.toThrow(/Invalid state key/)
  })
  it('withLock serializes work per key in call order and releases after a failure', async () => {
    const store = createMemoryStore(), order: string[] = []
    let open!: () => void
    const gate = new Promise<void>(resolve => { open = resolve })
    const a = store.withLock('k', async () => { order.push('a'); await gate; order.push('a-end') })
    const b = store.withLock('k', async () => { order.push('b'); throw new Error('b failed') })
    const c = store.withLock('k', async () => { order.push('c'); return 'c' })
    const other = await store.withLock('other', async () => 'free')
    expect(other).toBe('free'); expect(order).toEqual(['a'])
    open()
    await a; await expect(b).rejects.toThrow('b failed'); expect(await c).toBe('c')
    expect(order).toEqual(['a', 'a-end', 'b', 'c'])
  })
})

describe('structured signing intents', () => {
  const typedData = {domain: {name: 'Tasra', chainId: 43114}, types: {Note: [{name: 'text', type: 'string'}]}, primaryType: 'Note' as const, message: {text: 'signed'}}
  it('derives the digest each kind signs and names its curve', () => {
    expect(toHex(signingIntentDigest({kind: 'typed-data', typedData}))).toBe(hashTypedData(typedData))
    expect(toHex(signingIntentDigest({kind: 'message', message: 'hello'}))).toBe(hashMessage('hello'))
    expect(toHex(signingIntentDigest({kind: 'message', message: new Uint8Array([1, 2])}))).toBe(hashMessage({raw: new Uint8Array([1, 2])}))
    expect(signingIntentDigest({kind: 'sha256', data: new Uint8Array([3])})).toEqual(sha256(new Uint8Array([3])))
    expect(signingIntentCurve({kind: 'sha256', data: new Uint8Array()})).toBe('p256')
    expect(signingIntentCurve({kind: 'message', message: 'x'})).toBe('secp256k1')
  })
  it('refuses another chain than the expected one, a message that is neither text nor bytes, non-byte P-256 data and an unknown kind', () => {
    expect(() => signingIntentDigest({kind: 'typed-data', typedData}, {expectChainId: 43113})).toThrow(/names chain 43114, not 43113/)
    expect(signingIntentDigest({kind: 'typed-data', typedData: {...typedData, domain: {name: 'Tasra', chainId: 43114n as unknown as number}}}, {expectChainId: 43114})).toHaveLength(32)
    expect(() => signingIntentDigest({kind: 'message', message: 7 as unknown as string})).toThrow(/string or bytes/)
    expect(() => signingIntentDigest({kind: 'sha256', data: 'x' as unknown as Uint8Array})).toThrow(/must be bytes/)
    expect(() => signingIntentDigest({kind: 'other'} as never)).toThrow(/Unknown signing intent kind/)
    expect(() => signingIntentDigest({kind: 'sha256', data: new Uint8Array(65_537)})).toThrow(/exceeds/)
  })
})

describe('small kept helpers', () => {
  it('the retired custody and unsealed decryption entry points refuse before any request', async () => {
    const {decryptCustody, decryptWithShardDelivery} = await import('../../src/decryption/client.js')
    await expect(decryptCustody({} as never)).rejects.toThrow(/retired/)
    await expect(decryptWithShardDelivery({} as never)).rejects.toThrow(/retired/)
  })
  it('sleep waits, and rejects with the signal\'s reason before or during the wait', async () => {
    const {sleep} = await import('../../src/internal/sleep.js')
    await sleep(1)
    const controller = new AbortController(), waiting = sleep(10_000, controller.signal)
    controller.abort(new Error('stop'))
    await expect(waiting).rejects.toThrow('stop')
    await expect(sleep(1, controller.signal)).rejects.toThrow('stop')
  })
  it('a bounded cache refreshes on peek and evicts the oldest entry', async () => {
    const {BoundedCache} = await import('../../src/internal/bounded.js')
    const cache = new BoundedCache<string, number>(2)
    expect(cache.getOrCompute('a', () => 1)).toBe(1); cache.getOrCompute('b', () => 2)
    expect(cache.peek('a')).toBe(1); expect(cache.peek('absent')).toBeUndefined()
    cache.getOrCompute('c', () => 3)
    expect(cache.size).toBe(2); expect(cache.peek('b')).toBeUndefined(); expect(cache.peek('a')).toBe(1)
    expect(() => new BoundedCache(0)).toThrow(/positive integer/)
  })
  it('a 402 from a keeper names the slot balance on a session refusal', async () => {
    const {isSlotBalanceSessionRefusal} = await vi.importActual<typeof import('../../src/decryption/session.js')>('../../src/decryption/session.js')
    expect(isSlotBalanceSessionRefusal({status: 402})).toBe(true)
    expect(isSlotBalanceSessionRefusal({status: 403})).toBe(false)
  })
})
