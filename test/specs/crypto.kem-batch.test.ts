import {describe, expect, it} from 'vitest'
import fc from 'fast-check'
import {bls12_381} from '@noble/curves/bls12-381'
import {concatBytes} from '@noble/hashes/utils'
import {combineDecryptShares, decodeKemU, encrypt, verifyDecryptShareAt, verifyDecryptSharesBatch, type DecryptShare} from '../../src/crypto/kem.js'

const G1 = bls12_381.G1.ProjectivePoint, G2 = bls12_381.G2.ProjectivePoint, ORDER = bls12_381.fields.Fr.ORDER

function scalar(seed: number): bigint { return (BigInt(seed) * 0x9e3779b97f4a7c15n + 12345n) % ORDER || 1n }

/** k honest shares of a 3-of-n key for one ciphertext's U. */
function honest(n: number, r: bigint, seedBase: number): {shares: DecryptShare[]; U: ReturnType<typeof G2.fromHex>} {
  const U = G2.BASE.multiply(r)
  const shares = Array.from({length: n}, (_, i) => {
    const sk = scalar(seedBase + i)
    return {id: i + 1, decryptionShare: U.multiply(sk).toRawBytes(true), verifyingShare: concatBytes(G2.BASE.multiply(sk).toRawBytes(true), G1.BASE.multiply(sk).toRawBytes(true))}
  })
  return {shares, U}
}

type Corruption = 'none' | 'wrong-d' | 'swap-d' | 'wrong-vs' | 'garbage-d' | 'short-vs' | 'missing-vs'
function corrupt(shares: DecryptShare[], plan: Corruption[]): DecryptShare[] {
  return shares.map((s, i) => {
    switch (plan[i]) {
      case 'wrong-d': return {...s, decryptionShare: G2.BASE.multiply(scalar(999 + i)).toRawBytes(true)}
      case 'swap-d': return {...s, decryptionShare: shares[(i + 1) % shares.length]!.decryptionShare}
      case 'wrong-vs': return {...s, verifyingShare: concatBytes(s.verifyingShare!.subarray(0, 96), G1.BASE.multiply(scalar(777 + i)).toRawBytes(true))}
      case 'garbage-d': return {...s, decryptionShare: new Uint8Array(96).fill(0xff)}
      case 'short-vs': return {...s, verifyingShare: s.verifyingShare!.subarray(0, 100)}
      case 'missing-vs': { const {verifyingShare: _v, ...rest} = s; return rest }
      default: return s
    }
  })
}

describe('KEM batch share verification (ADR-0090 D9)', () => {
  it('returns exactly the per-share verdicts for any mixture of honest and corrupted shares', () => {
    const corruption = fc.constantFrom<Corruption>('none', 'none', 'none', 'wrong-d', 'swap-d', 'wrong-vs', 'garbage-d', 'short-vs', 'missing-vs')
    fc.assert(fc.property(fc.integer({min: 1, max: 4}), fc.integer({min: 1, max: 1_000_000}), fc.array(corruption, {minLength: 4, maxLength: 4}), (n, seed, plan) => {
      const {shares, U} = honest(n, scalar(seed), seed * 7)
      const mixed = corrupt(shares, plan)
      const batch = verifyDecryptSharesBatch(mixed, U)
      const single = mixed.map(s => verifyDecryptShareAt(s, U))
      expect(batch).toEqual(single)
    }), {numRuns: 25})
  })

  it('accepts an all-honest batch with one multi-pairing and rejects everything for a malformed U', () => {
    const {shares, U} = honest(4, scalar(5), 50)
    expect(verifyDecryptSharesBatch(shares, U)).toEqual([true, true, true, true])
    expect(verifyDecryptSharesBatch(shares, undefined)).toEqual([false, false, false, false])
    expect(verifyDecryptSharesBatch([], U)).toEqual([])
  })

  it('a share that holds only for ANOTHER ciphertext is refused (the combination binds U)', () => {
    const a = honest(3, scalar(1), 10), b = honest(3, scalar(2), 10)
    const mixed = [a.shares[0]!, b.shares[1]!, a.shares[2]!]
    expect(verifyDecryptSharesBatch(mixed, a.U)).toEqual([true, false, true])
  })

  it('combines with cached Lagrange coefficients to the same plaintext as before, for any signer subset order', () => {
    const msk = scalar(42)
    // A 2-of-3 Shamir sharing of msk: f(x) = msk + a·x.
    const a = scalar(43), sk = (x: bigint) => (msk + a * x) % ORDER
    const identity = new TextEncoder().encode('chat-room')
    const ct = encrypt(G2.BASE.multiply(msk).toRawBytes(true), identity, new TextEncoder().encode('hello'))
    const U = decodeKemU(ct.u)!
    const share = (id: number): DecryptShare => ({id, decryptionShare: U.multiply(sk(BigInt(id))).toRawBytes(true)})
    for (const ids of [[1, 2], [2, 1], [3, 1], [2, 3]]) {
      expect(new TextDecoder().decode(combineDecryptShares(ids.map(share), ct, identity))).toBe('hello')
    }
  })
})
