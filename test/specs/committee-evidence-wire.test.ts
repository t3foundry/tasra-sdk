// ADR-0076: the sealed-evidence fields on the verifier-agent poll reply and their pass-through
// to the keeper. The binding crypto itself is pinned against the Rust vectors in
// test/committee.conformance.ts.
//
// The SDK binds the ciphertext to the token before handing it on: `evidence_hash` must be the
// keccak256 of the decoded canonical base64url `evidence_ct`, and a sealed token is never sent
// to a keeper without its ciphertext. The fixtures therefore derive `evidence_hash` from the
// ciphertext they carry.
import {afterEach, expect, test, vi} from 'vitest'
import {keccak_256} from '@noble/hashes/sha3'
import {bytesToHex} from '@noble/hashes/utils'
import {assertCompoundTokenWire, pollOid4vpSession} from '../../src/verifier-agent/index.js'
import {verifierAgentResult} from '../../src/oid4vp/verifier-agent.js'
import {committeeSign} from '../../src/committee/client.js'
import {hexToBytes} from '../../src/crypto/hex.js'
import type {CompoundTokenWire} from '../../src/committee/token.js'

const hash = '0x' + '12'.repeat(32)
const sig = {verifier_index: 0, signature: '0x' + '34'.repeat(64)}
const ctHash = (bytes: number[]) => '0x' + bytesToHex(keccak_256(new Uint8Array(bytes)))
/** Bytes 00 01 02 ff ef fe: canonical, unpadded, and uses both URL-safe characters. */
const CT = 'AAEC_-_-'
const CT_HASH = ctHash([0x00, 0x01, 0x02, 0xff, 0xef, 0xfe])
/** Bytes 00 01 02. */
const CT_SIGN = 'AAEC'
const token = () => ({token_type: 'JWT', seed: hash, slot_id: hash, vp_hash: hash, holder_hash: hash, rule_hash: hash, epoch: 1, iat: 100, exp: 200, request_hash: hash, binding: 'holder_key', verifier_indexes: [0, 1], signatures: [sig]})
const evidenced = (evidenceHash = CT_HASH) => ({...token(), evidence_hash: evidenceHash, evidence_key_id: '0x' + 'cd'.repeat(32), evidence_signatures: [sig]})
afterEach(() => vi.unstubAllGlobals())

test('an evidenced token is accepted and its binding kept', () => {
  const t = assertCompoundTokenWire(evidenced(), 's')
  expect(t.evidence_hash).toBe(CT_HASH)
  expect(t.evidence_signatures).toEqual([sig])
})

test('evidence fields are all-or-none and shape-checked', () => {
  const {evidence_signatures: _, ...partial} = evidenced()
  expect(() => assertCompoundTokenWire(partial, 's')).toThrow('together or not at all')
  expect(() => assertCompoundTokenWire({...evidenced(), evidence_hash: 'nope'}, 's')).toThrow('32-byte hex')
  expect(() => assertCompoundTokenWire({...evidenced(), evidence_signatures: [{verifier_index: 7, signature: '0x00'}]}, 's')).toThrow('outside the committee')
  // Rust `Option::None` serializes as null: null is absence, not a malformed binding.
  const nulls = assertCompoundTokenWire({...token(), evidence_hash: null, evidence_key_id: null, evidence_signatures: null}, 's')
  expect(nulls).not.toHaveProperty('evidence_hash')
})

test('the poll reply carries evidence_ct beside the token and the result hands it on', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({status: 'done', phase: 'done', compound_token: evidenced(), evidence_ct: CT, error: null})))
  const r = await pollOid4vpSession('http://127.0.0.1:8390', 'session', 'secret')
  expect(r.evidenceCt).toBe(CT)
  const res = verifierAgentResult({sessionId: 'session', requestHash: hexToBytes(hash)}, r)
  expect(res.evidenceCt).toBe(CT)
})

test('a malformed evidence_ct is a protocol error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({status: 'done', phase: 'done', compound_token: evidenced(), evidence_ct: 'not base64url!'})))
  await expect(pollOid4vpSession('http://127.0.0.1:8390', 'session', 'secret')).rejects.toThrow('evidence_ct')
})

test('an evidence_ct that does not hash to the token binding is a protocol error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({status: 'done', phase: 'done', compound_token: evidenced(), evidence_ct: CT_SIGN})))
  await expect(pollOid4vpSession('http://127.0.0.1:8390', 'session', 'secret')).rejects.toThrow('invalid sealed evidence')
})

test('committeeSign posts evidence_ct beside the token, and only when given', async () => {
  const bodies: Record<string, unknown>[] = []
  const fetchMock = vi.fn(async (_url: string, init: {body: string}) => {
    bodies.push(JSON.parse(init.body))
    return Response.json({key_slot_id: hash, group_public_key: hash, signature_r: hash, signature_z: hash, message_sha256: hash})
  })
  vi.stubGlobal('fetch', fetchMock)
  const committeeToken = evidenced(ctHash([0x00, 0x01, 0x02])) as unknown as CompoundTokenWire
  await committeeSign({nodeUrl: 'http://k', committeeToken, message: new Uint8Array([1]), evidenceCt: CT_SIGN})
  // An un-evidenced token goes out without the field.
  await committeeSign({nodeUrl: 'http://k', committeeToken: token() as unknown as CompoundTokenWire, message: new Uint8Array([1])})
  expect(bodies[0]!.evidence_ct).toBe(CT_SIGN)
  expect(bodies[0]!.committee_token).not.toHaveProperty('evidence_ct')
  expect(bodies[1]).not.toHaveProperty('evidence_ct')
  // A sealed token without its ciphertext is refused before anything is sent.
  await expect(committeeSign({nodeUrl: 'http://k', committeeToken, message: new Uint8Array([1])})).rejects.toThrow('sealed evidence')
  expect(fetchMock).toHaveBeenCalledTimes(2)
})
