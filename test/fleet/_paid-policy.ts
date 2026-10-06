// Public artifact hosts supply leaves; the original chain-derived payment supplies
// their authority. Never replace a retained epoch with today's live roster.
import assert from 'node:assert/strict'
import {hexToBytes, toHex, type Address, type Hex} from 'viem'
import {merkleProof, merkleRoot, selectVerifierCommittee, verifierLeaf} from '../../src/committee/token.ts'
import type {PaymentIntentWire} from '../../src/committee/payment.ts'
import type {PaidVerifierWitness} from '../../src/chain/prepaid.ts'

export type OriginalVerifierPolicy = Pick<PaymentIntentWire, 'chain_id' | 'slot' | 'verification_epoch'
  | 'verification_seed' | 'verification_root' | 'verification_registry_size' | 'verification_committee' | 'verification_quorum'>

function object(value: unknown, fields: string[]): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Snapshot must contain JSON objects')
  assert([Object.prototype, null].includes(Object.getPrototypeOf(value)), 'Snapshot object prototype is invalid')
  const record = value as Record<string, unknown>
  assert.equal(Object.getOwnPropertySymbols(record).length, 0)
  assert(Object.values(Object.getOwnPropertyDescriptors(record)).every(d => d.enumerable && Object.hasOwn(d, 'value')),
    'Snapshot objects must contain only JSON properties')
  assert.deepEqual(Object.keys(record).sort(), [...fields].sort(), 'Snapshot has unexpected or missing fields')
  return record
}
function hex(value: unknown, size: number): Hex {
  assert(typeof value === 'string' && new RegExp(`^0x[0-9a-fA-F]{${size * 2}}$`).test(value)
    && !/^0x0+$/.test(value), 'Snapshot identity must be nonzero canonical-length hex')
  return value.toLowerCase() as Hex
}

export function drawnVerifierWitnesses(value: unknown, original: OriginalVerifierPolicy, registry: Address): PaidVerifierWitness[] {
  const p = structuredClone(original)
  assert(Number.isSafeInteger(p.chain_id) && p.chain_id > 0
    && Number.isSafeInteger(p.verification_epoch) && p.verification_epoch >= 0, 'Invalid original verifier deployment or epoch')
  hex(p.slot, 32); hex(p.verification_seed, 32); hex(p.verification_root, 32); hex(registry, 20)
  assert(Number.isSafeInteger(p.verification_registry_size) && p.verification_registry_size > 0
    && p.verification_registry_size <= (1 << 20), 'Invalid original verifier pool size')
  assert(Number.isSafeInteger(p.verification_committee) && Number.isSafeInteger(p.verification_quorum)
    && p.verification_quorum > 0 && p.verification_quorum <= p.verification_committee
    && p.verification_committee <= Math.min(4096, p.verification_registry_size), 'Invalid original verifier quorum')
  const artifact = object(value, ['version', 'chain_id', 'registry', 'epoch', 'root', 'size', 'block_number', 'block_hash', 'entries'])
  assert(artifact.version === 1 && artifact.chain_id === p.chain_id && artifact.epoch === p.verification_epoch
    && hex(artifact.registry, 20) === registry.toLowerCase() && hex(artifact.root, 32) === p.verification_root.toLowerCase()
    && artifact.size === p.verification_registry_size, 'Snapshot differs from the original anchored payment')
  assert(Number.isSafeInteger(artifact.block_number) && Number(artifact.block_number) >= 0, 'Invalid snapshot provenance block')
  hex(artifact.block_hash, 32)
  assert(Array.isArray(artifact.entries) && artifact.entries.length === p.verification_registry_size, 'Snapshot leaf count differs')
  let previous = ''
  const keys = new Set<string>()
  const entries = artifact.entries.map((value: unknown, index: number) => {
    const entry = object(value, ['index', 'operator', 'pubkey'])
    const operator = hex(entry.operator, 20) as Address, publicKey = hex(entry.pubkey, 32)
    assert(entry.index === index && operator > previous && !keys.has(publicKey), 'Snapshot indexes, operator order or keys are ambiguous')
    previous = operator; keys.add(publicKey)
    return {index, operator, publicKey}
  })
  const leaves = entries.map(m => verifierLeaf(m.index, hexToBytes(m.operator), hexToBytes(m.publicKey)))
  const root = merkleRoot(leaves)
  assert(root && toHex(root) === p.verification_root.toLowerCase(), 'Snapshot leaves differ from the independently anchored root')
  const drawn = selectVerifierCommittee(hexToBytes(p.slot), p.verification_epoch, hexToBytes(p.verification_seed),
    p.verification_registry_size, p.verification_committee)
  return drawn.map(index => {
    const member = entries[index]!, proof = merkleProof(leaves, index)
    assert(proof, 'Missing drawn verifier proof')
    return {...member, proof: proof.map(p => toHex(p))}
  })
}
