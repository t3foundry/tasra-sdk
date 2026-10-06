import {describe, expect, it} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import {hexToBytes, toHex, type Address, type Hex} from 'viem'
import {merkleRoot, verifierLeaf, verifyMerkleProof} from '../../src/committee/token.ts'
import {drawnVerifierWitnesses, type OriginalVerifierPolicy} from '../fleet/_paid-policy.ts'

const hash = (byte: number, length = 32) => `0x${byte.toString(16).padStart(2, '0').repeat(length)}` as Hex
function fixture() {
  const entries = [1, 2, 3].map((n, index) => ({index, operator: hash(n, 20), pubkey: toHex(ed25519.getPublicKey(new Uint8Array(32).fill(n)))}))
  const leaves = entries.map(m => verifierLeaf(m.index, hexToBytes(m.operator), hexToBytes(m.pubkey)))
  const root = toHex(merkleRoot(leaves)!)
  const payment: OriginalVerifierPolicy = {chain_id: 43112, slot: hash(4), verification_epoch: 7, verification_seed: hash(5),
    verification_root: root, verification_registry_size: 3, verification_committee: 2, verification_quorum: 2}
  const registry = hash(6, 20) as Address
  const artifact = {version: 1, chain_id: 43112, registry, epoch: 7, root, size: 3, block_number: 15, block_hash: hash(15), entries}
  return {payment, registry, artifact, leaves}
}
describe('original paid verifier artifact', () => {
  it('derives two original drawn witnesses with real inclusion proofs from the three-member anchored roster', () => {
    const f = fixture(), original = structuredClone(f.artifact), witnesses = drawnVerifierWitnesses(f.artifact, f.payment, f.registry)
    expect(witnesses).toHaveLength(2)
    expect(new Set(witnesses.map(m => m.index)).size).toBe(2)
    for (const m of witnesses) expect(verifyMerkleProof(f.leaves[m.index]!, m.proof.map(p => hexToBytes(p)), hexToBytes(f.payment.verification_root))).toBe(true)
    expect(f.artifact).toEqual(original)
  })
  for (const field of ['version', 'chain_id', 'registry', 'epoch', 'root', 'size'] as const) {
    it(`refuses a changed ${field} without switching to a live roster`, () => {
      const f = fixture(), value = f.artifact as Record<string, unknown>
      value[field] = typeof value[field] === 'string' ? hash(99, field === 'registry' ? 20 : 32) : Number(value[field]) + 1
      expect(() => drawnVerifierWitnesses(value, f.payment, f.registry)).toThrow(/original anchored payment/)
    })
  }
  it('refuses an altered key even when the artifact still claims the original root', () => {
    const f = fixture(); f.artifact.entries[0]!.pubkey = hash(99)
    expect(() => drawnVerifierWitnesses(f.artifact, f.payment, f.registry)).toThrow(/independently anchored root/)
  })
  it('refuses missing, reordered, duplicated and relabeled snapshot leaves', () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => {f.artifact.entries.pop()},
      (f: ReturnType<typeof fixture>) => {f.artifact.entries.reverse()},
      (f: ReturnType<typeof fixture>) => {f.artifact.entries[1]!.operator = f.artifact.entries[0]!.operator},
      (f: ReturnType<typeof fixture>) => {f.artifact.entries[1]!.pubkey = f.artifact.entries[0]!.pubkey},
      (f: ReturnType<typeof fixture>) => {f.artifact.entries[0]!.index = 2},
    ]) {const f = fixture(); mutate(f); expect(() => drawnVerifierWitnesses(f.artifact, f.payment, f.registry)).toThrow()}
  })
  it('refuses malformed provenance, unknown fields, accessor properties and an unsafe original policy', () => {
    const f = fixture()
    for (const artifact of [{...f.artifact, block_number: -1}, {...f.artifact, block_hash: '0x1'}, {...f.artifact, attacker: true},
      {...f.artifact, get entries() {throw new Error('must not execute a getter')}}]) {
      expect(() => drawnVerifierWitnesses(artifact, f.payment, f.registry)).toThrow()
    }
    for (const change of [{verification_registry_size: NaN}, {verification_epoch: -1}, {verification_quorum: 0},
      {verification_committee: 4}, {verification_seed: '0x1' as Hex}]) {
      expect(() => drawnVerifierWitnesses(f.artifact, {...f.payment, ...change}, f.registry)).toThrow()
    }
  })
})
