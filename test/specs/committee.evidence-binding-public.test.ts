import {expect, test} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import {evidenceBindingMessage, verifyEvidenceBinding} from '../../src/committee/token.js'

// The public mirror of Rust `verify_evidence_binding`. Rust's quorum and indexes are u32; here
// they are JS numbers, so a negative, fractional or NaN quorum must be refused rather than met
// by zero signatures.
const seeds = [1, 2, 3].map(i => new Uint8Array(32).fill(0x70 + i))
const set = {registrySize: 4, pubkeys: new Map(seeds.map((s, i) => [i, ed25519.getPublicKey(s)]))}
const [tokenHash, evidenceHash, evidenceKeyId] = [0x11, 0x22, 0x33].map(b => new Uint8Array(32).fill(b)) as [Uint8Array, Uint8Array, Uint8Array]
const message = evidenceBindingMessage(tokenHash, evidenceHash, evidenceKeyId)
const sig = (i: number) => ({verifierIndex: i, signature: ed25519.sign(message, seeds[i]!)})
const base = {tokenHash, evidenceHash, evidenceKeyId, set, drawn: [0, 1, 2], quorum: 2}

test('a drawn quorum of distinct valid signers verifies', () => {
  expect(verifyEvidenceBinding({...base, signatures: [sig(0), sig(1)]})).toEqual([0, 1])
})

test.each([0, -1, -0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 32])('quorum %s is refused, even with no signatures', quorum => {
  expect(() => verifyEvidenceBinding({...base, quorum, signatures: []})).toThrow(/quorum must be a positive 32-bit integer/)
  expect(() => verifyEvidenceBinding({...base, quorum, signatures: [sig(0), sig(1)]})).toThrow(/quorum/)
})

test('no signatures never meet a positive quorum', () => {
  expect(() => verifyEvidenceBinding({...base, quorum: 1, signatures: []})).toThrow(/quorum not met/)
})

test.each([-1, 1.5, Number.NaN, 2 ** 32])('a signer index %s is refused', verifierIndex => {
  expect(() => verifyEvidenceBinding({...base, signatures: [{...sig(0), verifierIndex}, sig(1)]})).toThrow(/32-bit/)
})

test('a drawn committee with a non-integer index is refused', () => {
  expect(() => verifyEvidenceBinding({...base, drawn: [0, 1, 1.5], signatures: [sig(0), sig(1)]})).toThrow(/drawn committee/)
})

test('a signature that is not 64 bytes is refused', () => {
  expect(() => verifyEvidenceBinding({...base, signatures: [{verifierIndex: 0, signature: sig(0).signature.slice(0, 63)}, sig(1)]})).toThrow(/64 bytes/)
})

test('a duplicate signer counts once', () => {
  expect(() => verifyEvidenceBinding({...base, signatures: [sig(0), sig(0)]})).toThrow(/quorum not met/)
})
