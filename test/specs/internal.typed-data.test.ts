// The memoized EIP-712 hash and signer recovery serve a cached result ONLY for the exact same
// input: any other domain, type, message, digest or signature computes (and matches viem) afresh.
import {describe, expect, it} from 'vitest'
import {hashTypedData, recoverTypedDataAddress, type Hex, type TypedDataDefinition} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {recoverTypedDataSigner, typedDataHash} from '../../src/internal/typedData.js'

const account = privateKeyToAccount(`0x${'42'.repeat(32)}`), other = privateKeyToAccount(`0x${'43'.repeat(32)}`)
const base = {domain: {name: 'Memo Test', version: '1', chainId: 43112, verifyingContract: `0x${'11'.repeat(20)}` as Hex},
  primaryType: 'Item' as const, types: {Item: [{name: 'id', type: 'bytes32'}, {name: 'amount', type: 'uint256'}, {name: 'label', type: 'string'}]},
  message: {id: `0x${'22'.repeat(32)}` as Hex, amount: 5n, label: 'a'}} satisfies TypedDataDefinition
type Td = typeof base
const variants = (): TypedDataDefinition[] => [
  base,
  {...base, message: {...base.message, amount: 6n}},
  {...base, message: {...base.message, label: 'b'}},
  {...base, message: {...base.message, id: `0x${'23'.repeat(32)}` as Hex}},
  {...base, domain: {...base.domain, chainId: 1}},
  {...base, domain: {...base.domain, verifyingContract: `0x${'12'.repeat(20)}` as Hex}},
  {...base, domain: {...base.domain, name: 'Memo Test 2'}},
  // Same values under a renamed type and field: a different type hash.
  {...base, primaryType: 'Other', types: {Other: base.types.Item}, message: base.message} as unknown as TypedDataDefinition,
  {...base, types: {Item: [{name: 'id', type: 'bytes32'}, {name: 'amount', type: 'uint128'}, {name: 'label', type: 'string'}]}} as unknown as TypedDataDefinition,
]

describe('typedDataHash', () => {
  it('equals hashTypedData for every input, cached or not, and never serves one input\'s hash for another', () => {
    for (let round = 0; round < 2; round++) {
      const seen = new Set<string>()
      for (const td of variants()) {
        const got = typedDataHash(td)
        expect(got).toBe(hashTypedData(td))
        seen.add(got)
      }
      expect(seen.size).toBe(variants().length)
    }
  })
  it('a string label that spells a bigint is not the bigint', () => {
    const asString = {...base, types: {Item: [...base.types.Item, {name: 'extra', type: 'string'}]}, message: {...base.message, extra: '5'}}
    expect(typedDataHash(asString as unknown as TypedDataDefinition)).toBe(hashTypedData(asString as unknown as TypedDataDefinition))
    const tagged = {...asString, message: {...asString.message, extra: JSON.stringify({'\u0000bigint': '5'})}}
    expect(typedDataHash(tagged as unknown as TypedDataDefinition)).toBe(hashTypedData(tagged as unknown as TypedDataDefinition))
    expect(typedDataHash(tagged as unknown as TypedDataDefinition)).not.toBe(typedDataHash(asString as unknown as TypedDataDefinition))
  })
  it('never keys a getter, a toJSON substitute or a hidden field: those inputs always hash afresh', () => {
    typedDataHash(base) // cache the plain input
    let amount = 5n
    const getter = {...base, message: Object.defineProperty({id: base.message.id, label: 'a'}, 'amount', {enumerable: true, get: () => amount})}
    amount = 6n
    expect(typedDataHash(getter as unknown as TypedDataDefinition)).toBe(hashTypedData(getter as unknown as TypedDataDefinition))
    expect(typedDataHash(getter as unknown as TypedDataDefinition)).not.toBe(typedDataHash(base))
    // A non-enumerable field is read by hashTypedData but missing from JSON.
    const hidden = {...base, message: Object.defineProperty({id: base.message.id, label: 'a'}, 'amount', {enumerable: false, value: 6n})}
    const hidden2 = {...base, message: Object.defineProperty({id: base.message.id, label: 'a'}, 'amount', {enumerable: false, value: 7n})}
    expect(typedDataHash(hidden as unknown as TypedDataDefinition)).toBe(hashTypedData(hidden as unknown as TypedDataDefinition))
    expect(typedDataHash(hidden2 as unknown as TypedDataDefinition)).toBe(hashTypedData(hidden2 as unknown as TypedDataDefinition))
    expect(typedDataHash(hidden2 as unknown as TypedDataDefinition)).not.toBe(typedDataHash(hidden as unknown as TypedDataDefinition))
    // A toJSON that serializes like the cached input but is another value.
    const disguised = {...base, message: {...base.message, label: {toJSON: () => 'a', toString: () => 'b'}}}
    const viem = (() => { try { return hashTypedData(disguised as unknown as TypedDataDefinition) } catch { return 'throws' } })()
    const ours = (() => { try { return typedDataHash(disguised as unknown as TypedDataDefinition) } catch { return 'throws' } })()
    expect(ours).toBe(viem)
    expect(ours).not.toBe(typedDataHash(base))
  })
  it('computes an unkeyable input without the cache, exactly as viem does', () => {
    const bad = {...base, message: {...base.message, amount: undefined}} as unknown as TypedDataDefinition
    expect(() => typedDataHash(bad)).toThrow()
    expect(() => hashTypedData(bad)).toThrow()
  })
})

describe('recoverTypedDataSigner', () => {
  it('recovers what viem recovers for the exact digest and signature, never a cached signer for other bytes', async () => {
    const signature = await account.signTypedData(base)
    expect(await recoverTypedDataSigner(base, signature)).toBe(account.address)
    expect(await recoverTypedDataSigner(base, signature)).toBe(account.address) // cached
    // Same signature over a different message: whatever viem recovers, never the cached signer.
    const changed: Td = {...base, message: {...base.message, amount: 6n}}
    const recovered = await recoverTypedDataSigner(changed, signature)
    expect(recovered).toBe(await recoverTypedDataAddress({...changed, signature}))
    expect(recovered).not.toBe(account.address)
    // Another signer over the same message.
    const theirs = await other.signTypedData(base)
    expect(await recoverTypedDataSigner(base, theirs)).toBe(other.address)
    // A flipped byte in r: another (or no) key, never the cached one.
    const flipped = `${signature.slice(0, 10)}${((parseInt(signature.slice(10, 12), 16) ^ 1).toString(16)).padStart(2, '0')}${signature.slice(12)}` as Hex
    const viem = await recoverTypedDataAddress({...base, signature: flipped}).catch(() => 'throws')
    const ours = await recoverTypedDataSigner(base, flipped).catch(() => 'throws')
    expect(ours).toBe(viem)
    expect(ours).not.toBe(account.address)
    // Upper-case hex is the same bytes and the same signer.
    expect(await recoverTypedDataSigner(base, `0x${signature.slice(2).toUpperCase()}`)).toBe(account.address)
  })
})
