import {afterEach, expect, test, vi} from 'vitest'
import {keccak_256} from '@noble/hashes/sha3'
import {bytesToHex} from '@noble/hashes/utils'
import {evidenceBody, evidenceBindingMessage, verifyEvidenceBinding} from '../../src/committee/evidence.js'
import {ed25519} from '@noble/curves/ed25519'
import {hexToBytes} from '../../src/crypto/hex.js'
import {committeeSign, gatherCommitteeToken} from '../../src/committee/client.js'
import {committeeSignEoaDigest} from '../../src/committee/ecdsa.js'
import {parseVerifierAgentSessionStatus} from '../../src/verifier-agent/index.js'
import {compoundTokenHash, decodeCompoundToken, type CompoundTokenWire, type CompoundTokenPayload} from '../../src/committee/token.js'

const hash = '0x' + '12'.repeat(32)
const bytes = new TextEncoder().encode('retained encrypted presentation')
const ct = Buffer.from(bytes).toString('base64url')
const plain = (): CompoundTokenWire => ({token_type: 'JWT', seed: hash, slot_id: hash, vp_hash: hash,
  holder_hash: hash, rule_hash: hash, epoch: 1, iat: 100, exp: 200, binding: 'holder_key',
  verifier_indexes: [0], signatures: [{verifier_index: 0, signature: '0x' + '34'.repeat(64)}]})
const sealed = (): CompoundTokenWire => ({...plain(), evidence_hash: '0x' + bytesToHex(keccak_256(bytes)),
  evidence_key_id: hash, evidence_signatures: [{verifier_index: 0, signature: '0x' + '56'.repeat(64)}]})
afterEach(() => vi.unstubAllGlobals())

test('evidence metadata leaves the canonical token hash unchanged', () => {
  expect(compoundTokenHash(decodeCompoundToken(sealed()))).toEqual(compoundTokenHash(decodeCompoundToken(plain())))
  expect(evidenceBody(sealed(), ct)).toEqual({evidence_ct: ct})
  expect(evidenceBody(plain())).toEqual({})
})
test.each(['evidence_hash', 'evidence_key_id', 'evidence_signatures'] as const)('partial binding without %s refuses', key => {
  const t = sealed(); delete t[key]; expect(() => evidenceBody(t, ct)).toThrow()
})
test('bound evidence refuses absent, changed, padded or oversized ciphertext', () => {
  for (const value of [undefined, ct.slice(1), ct + '=', 'A'.repeat(21847)]) expect(() => evidenceBody(sealed(), value)).toThrow()
})
test('ciphertext without a signed evidence binding refuses', () => {
  expect(() => evidenceBody(plain(), ct)).toThrow()
})
test('duplicate or out-of-committee evidence signatures refuse', () => {
  const t = sealed(); t.verifier_indexes = [0, 1]; t.evidence_signatures!.push({...t.evidence_signatures![0]!})
  expect(() => evidenceBody(t, ct)).toThrow()
  t.evidence_signatures = [{verifier_index: 2, signature: '0x' + '56'.repeat(64)}]
  expect(() => evidenceBody(t, ct)).toThrow()
})
test('agent status retains the exact ciphertext and rejects its omission', () => {
  const status = parseVerifierAgentSessionStatus({status: 'done', phase: 'done', compound_token: sealed(), evidence_ct: ct}, 'session')
  expect(status.evidenceCt).toBe(ct)
  expect(() => parseVerifierAgentSessionStatus({status: 'done', phase: 'done', compound_token: sealed()}, 'session')).toThrow('sealed evidence')
})
test.each(['frost', 'ecdsa'])('%s submits the retained ciphertext beside its token', async mode => {
  let body: Record<string, unknown> | undefined
  const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>
    throw new Error('observed original submission')
  })
  const opts = {nodeUrl: 'https://keeper.example', committeeToken: sealed(), evidenceCt: ct, fetchImpl: fetcher}
  await expect(mode === 'frost' ? committeeSign({...opts, message: new Uint8Array([1])})
    : committeeSignEoaDigest({...opts, digest: new Uint8Array(32)})).rejects.toThrow('observed original submission')
  expect(body?.evidence_ct).toBe(ct); expect(body?.committee_token).toEqual(sealed()); expect(fetcher).toHaveBeenCalledTimes(1)
})
test('missing sealed ciphertext refuses before any keeper request', async () => {
  const fetcher = vi.fn()
  await expect(committeeSign({nodeUrl: 'https://keeper.example', committeeToken: sealed(), message: new Uint8Array([1]), fetchImpl: fetcher})).rejects.toThrow('ciphertext')
  expect(fetcher).not.toHaveBeenCalled()
})
function signedEvidence() {
  const t = sealed(), tokenHash = compoundTokenHash(decodeCompoundToken(t))
  const privateKey = new Uint8Array(32).fill(7), keys = new Map([[0, ed25519.getPublicKey(privateKey)]])
  const signature = ed25519.sign(evidenceBindingMessage(tokenHash, hexToBytes(t.evidence_hash!), hexToBytes(t.evidence_key_id!)), privateKey)
  t.evidence_signatures = [{verifier_index: 0, signature: bytesToHex(signature)}]
  return {t, tokenHash, keys}
}
test('real evidence signature verifies under the independently pinned committee key', () => {
  const {t, tokenHash, keys} = signedEvidence()
  expect(() => verifyEvidenceBinding(t, ct, tokenHash, keys, 1)).not.toThrow()
})
test('evidence signature cannot be moved to another token or certified evidence key', () => {
  const {t, tokenHash, keys} = signedEvidence()
  const changed = tokenHash.slice(); changed[0] = changed[0]! ^ 1
  expect(() => verifyEvidenceBinding(t, ct, changed, keys, 1)).toThrow('signature')
  t.evidence_key_id = '0x' + 'ab'.repeat(32)
  expect(() => verifyEvidenceBinding(t, ct, tokenHash, keys, 1)).toThrow('signature')
})
test('valid evidence from fewer signers than the required quorum refuses', () => {
  const {t, tokenHash, keys} = signedEvidence(); t.verifier_indexes = [0, 1]
  expect(() => verifyEvidenceBinding(t, ct, tokenHash, keys, 2)).toThrow('quorum')
})
test('a self-selected verifier key does not authenticate evidence', () => {
  const {t, tokenHash} = signedEvidence()
  expect(() => verifyEvidenceBinding(t, ct, tokenHash, new Map([[0, ed25519.getPublicKey(new Uint8Array(32).fill(8))]]), 1)).toThrow('signature')
})
function gatherFixture() {
  const keys = [new Uint8Array(32).fill(7), new Uint8Array(32).fill(8)]
  const payload: CompoundTokenPayload = {tokenType: 'JWT', seed: hexToBytes(hash), epoch: 1, slotId: hexToBytes(hash),
    vpHash: hexToBytes(hash), holderHash: hexToBytes(hash), ruleHash: hexToBytes(hash), binding: 1,
    verifierIndexes: [0, 1], iat: 100, exp: 200}
  const tokenHash = compoundTokenHash(payload), e = sealed()
  const replies = keys.map((key, index) => ({verifier_index: index, token_hash: bytesToHex(tokenHash),
    vp_hash: hash, holder_hash: hash, rule_hash: hash, binding: 'holder_key', committee_indexes: [0, 1],
    signature: bytesToHex(ed25519.sign(tokenHash, key)), evidence_hash: e.evidence_hash!, evidence_key_id: e.evidence_key_id!,
    evidence_sig: bytesToHex(ed25519.sign(evidenceBindingMessage(tokenHash, hexToBytes(e.evidence_hash!), hexToBytes(e.evidence_key_id!)), key)), evidence_ct: ct}))
  const opts = {verifiers: keys.map((key, index) => ({index, url: 'https://verifier-' + index + '.example', pubkey: ed25519.getPublicKey(key)})), quorum: 2,
    authorize: {holder: 'holder', credentials: ['original-credential'], holderProof: '', tokenType: 'JWT' as const,
      seed: payload.seed, epoch: 1, slotId: payload.slotId, registrySize: 2, committee: 2, iat: 100, exp: 200}}
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(replies[url.includes('verifier-0') ? 0 : 1])))
  return {opts, replies}
}
test('direct quorum collection preserves both evidence signatures and the exact ciphertext', async () => {
  const {opts} = gatherFixture(); let retained: string | undefined
  const token = await gatherCommitteeToken({...opts, onEvidence: value => { retained = value }})
  expect(retained).toBe(ct); expect(token.evidence_signatures).toHaveLength(2)
  verifyEvidenceBinding(token, retained, compoundTokenHash(decodeCompoundToken(token)), new Map(opts.verifiers.map(v => [v.index, v.pubkey])), 2)
})
test('a forged evidence signature cannot count toward a direct quorum', async () => {
  const {opts, replies} = gatherFixture(); replies[1]!.evidence_sig = '00'.repeat(64)
  await expect(gatherCommitteeToken({...opts, onEvidence: () => {}})).rejects.toThrow('quorum')
})
test('mixed sealed and unsealed verifier replies refuse without dropping the evidence', async () => {
  const {opts, replies} = gatherFixture()
  for (const key of ['evidence_hash', 'evidence_key_id', 'evidence_sig', 'evidence_ct'] as const) delete (replies[1] as Partial<typeof replies[number]>)[key]
  await expect(gatherCommitteeToken({...opts, onEvidence: () => {}})).rejects.toThrow('disagree')
})
test('a direct caller must explicitly retain sealed ciphertext alongside the token', async () => {
  const {opts} = gatherFixture()
  await expect(gatherCommitteeToken(opts)).rejects.toThrow('onEvidence')
})
