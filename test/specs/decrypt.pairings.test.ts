// Pairing cost of the client-side combine on the sealed KEM and strict IBE decrypt paths: each
// share is pairing-verified ONCE (where a bad share is named), not again inside the combine.
import {readFileSync} from 'node:fs'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {bls12_381} from '@noble/curves/bls12-381'
import {keccak_256} from '@noble/hashes/sha3'
import {sha256} from '@noble/hashes/sha256'
import {CipherSuite, HkdfSha256} from '@hpke/core'
import {DhkemX25519HkdfSha256} from '@hpke/dhkem-x25519'
import {Chacha20Poly1305} from '@hpke/chacha20poly1305'
import {createDecryptionRecipient, kemContentDigest, recipientPayloadDigest, type ClientRecipient} from '../../src/crypto/recipient.js'
import {decryptWithCommitteePartials} from '../../src/decryption/sealed.js'
import {extractIdentityStrict} from '../../src/committee/extraction.js'
import {ibeEncrypt, ibeDecryptWithKey} from '../../src/crypto/ibe.js'
import {requestHash} from '../../src/oid4vp/binding.js'
import {bytesToHex, hexToBytes} from '../../src/crypto/hex.js'
import {base64Encode} from '../../src/crypto/envelope.js'
import type {Ciphertext} from '../../src/crypto/kem.js'
import {ThresholdNotMetError} from '../../src/errors.js'
import type {CompoundTokenWire} from '../../src/committee/token.js'
import {sealIbeFixture} from '../support/sealedIbe.js'

const utf8 = (s: string) => new TextEncoder().encode(s)
const unhex = (s: string) => hexToBytes(s.startsWith('0x') ? s : `0x${s}`)
const suite = new CipherSuite({kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Chacha20Poly1305()})
const token = (slot: string, hash: Uint8Array, extra: Partial<CompoundTokenWire> = {}): CompoundTokenWire => ({token_type: 'JWT', slot_id: slot, request_hash: bytesToHex(hash),
  binding: 'holder_key', seed: '00'.repeat(32), epoch: 7, vp_hash: '01'.repeat(32), holder_hash: '02'.repeat(32), rule_hash: '03'.repeat(32),
  iat: 0, exp: 9999999999, verifier_indexes: [], signatures: [], ...extra})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

// ── KEM: Rust-produced recipient vectors (2 shares, threshold 2) ─────────────────────────────────
const kv = JSON.parse(readFileSync(new URL('../recipient-vectors.json', import.meta.url), 'utf8')) as {
  slot_id: string; chain_id: number; identity: string; plaintext: string; kem: {u: string; nonce: string; aead_ct: string}
  shares: {identifier: number; verifying_share: string; kem_partial: string}[]}
const kemCt: Ciphertext = {u: unhex(kv.kem.u), nonce: unhex(kv.kem.nonce), aeadCt: unhex(kv.kem.aead_ct)}

async function kemKeepers(client: ClientRecipient, corrupt?: number) {
  const hash = requestHash(kv.chain_id, unhex(kv.slot_id), 'decrypt', recipientPayloadDigest(kemContentDigest(kemCt, utf8(kv.identity)), 0, client.recipient))
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const index = url.includes('keeper-1') ? 0 : 1, s = kv.shares[index]!
    // A corrupted keeper returns a well-formed G2 point that is not its decryption share.
    const partial = index === corrupt ? bls12_381.G2.ProjectivePoint.BASE.toRawBytes(true) : unhex(s.kem_partial)
    const pk = await suite.kem.deserializePublicKey(unhex(client.recipient.public_key))
    const vs = unhex(s.verifying_share)
    const aad = new Uint8Array([...hash, s.identifier >>> 8, s.identifier & 255, ...new Uint8Array(8), ...vs])
    const sealed = await suite.seal({recipientPublicKey: pk, info: utf8('keykeeper:sealed-decryption-share:v1')}, partial, aad)
    return new Response(JSON.stringify({key_slot_id: kv.slot_id, identifier: s.identifier, epoch: 0, verifying_share: base64Encode(vs),
      sealed_share: {enc: base64Encode(new Uint8Array(sealed.enc)), ciphertext: base64Encode(new Uint8Array(sealed.ct))}}))
  }))
  return {nodeUrls: ['https://keeper-1', 'https://keeper-2'], chainId: kv.chain_id, recipient: client, ciphertextEpoch: 0, threshold: 2,
    verifyingShares: new Map(kv.shares.map(s => [s.identifier, unhex(s.verifying_share)])), committeeToken: token(kv.slot_id, hash),
    ciphertext: kemCt, identity: utf8(kv.identity)}
}

describe('sealed KEM decryption pairings', () => {
  it('pairing-verifies each of the k shares once: 2 pairings per share', async () => {
    const opts = await kemKeepers(await createDecryptionRecipient())
    const pairing = vi.spyOn(bls12_381, 'pairing')
    expect(await decryptWithCommitteePartials(opts)).toEqual(unhex(kv.plaintext))
    // k = 2: 4 pairings (was 8 - the combine repeated both checks).
    expect(pairing).toHaveBeenCalledTimes(2 * opts.threshold)
  })
})

// ── IBE: Rust-produced vectors (3 shares, threshold 2), strict extraction ─────────────────────────
const iv = JSON.parse(readFileSync(new URL('../ibe-vectors.json', import.meta.url), 'utf8')) as {mpk: string; identity: string
  shares: {identifier: number; d_i: string}[]; verifying_shares: {g2: string; g1: string}[]}
const slot = `0x${'11'.repeat(32)}`

async function ibeInput(corrupt?: number) {
  const recipient = await createDecryptionRecipient()
  const hash = requestHash(43112, unhex(slot), 'ibe-extract', recipientPayloadDigest(sha256(utf8(iv.identity)), 1, recipient.recipient))
  const fetchImpl = vi.fn<typeof fetch>(async url => {
    const i = Number(/keeper-(\d+)/.exec(String(url))![1]), share = iv.shares[i]!, verifying = iv.verifying_shares[i]!
    // A corrupted keeper returns ANOTHER keeper's (valid G1) share under its own identifier.
    const value = unhex(iv.shares[i === corrupt ? (i + 1) % iv.shares.length : i]!.d_i)
    return Response.json(await sealIbeFixture({key_slot_id: slot, identifier: share.identifier, extraction_share: base64Encode(value),
      verifying_share: base64Encode(new Uint8Array([...unhex(verifying.g2), ...unhex(verifying.g1)])), epoch: 1}, recipient, hash))
  })
  return {chainId: 43112, slotId: slot, threshold: 2, epoch: 1, groupPublicKey: unhex(iv.mpk), shareTrust: 'anchored-group' as const,
    keepers: [0, 1].map(i => ({operator: `0x${(i + 1).toString(16).padStart(40, '0')}`, nodeUrl: `https://keeper-${i}.example`})),
    committeeToken: token(slot, hash, {identity_hash: bytesToHex(keccak_256(utf8(iv.identity)))}), identity: iv.identity, recipient,
    verifyingShares: new Map(iv.shares.map((s, i) => [s.identifier, new Uint8Array([...unhex(iv.verifying_shares[i]!.g2), ...unhex(iv.verifying_shares[i]!.g1)])])),
    fetchImpl}
}

describe('strict IBE extraction pairings', () => {
  it('pairing-verifies each of the k shares once, then checks the combined key against the anchored group key', async () => {
    const input = await ibeInput()
    const pairing = vi.spyOn(bls12_381, 'pairing')
    const {key} = await extractIdentityStrict(input)
    // k = 2: 2 per share + 2 for the group-key check = 6 (was 10 - the combine repeated the per-share checks).
    expect(pairing).toHaveBeenCalledTimes(2 * input.threshold + 2)
    pairing.mockRestore()
    const ct = ibeEncrypt(unhex(iv.mpk), utf8(iv.identity), utf8('note'))
    expect(ibeDecryptWithKey(key, ct, utf8(iv.identity))).toEqual(utf8('note'))
  })
  it('hashes the identity once per operation and decodes static public points once per client', async () => {
    const hash = vi.spyOn(bls12_381.G1, 'hashToCurve')
    const decodeG2 = vi.spyOn(bls12_381.G2.ProjectivePoint, 'fromHex')
    await extractIdentityStrict(await ibeInput())
    // Was 2k + 1 = 5: twice per share (callback and combine) and once for the group-key check.
    expect(hash).toHaveBeenCalledTimes(1)
    decodeG2.mockClear()
    await extractIdentityStrict(await ibeInput())
    // A second operation on the same slot re-decodes none of its verifying shares or group key.
    expect(decodeG2).not.toHaveBeenCalled()
  })
})

// The refusals run last: a refused operation's other replies may still be verifying afterwards,
// which must not land inside a pairing count above.
describe('corrupted shares', () => {
  it('still refuses a corrupted share at its per-share check', async () => {
    const opts = await kemKeepers(await createDecryptionRecipient(), 1)
    await expect(decryptWithCommitteePartials(opts)).rejects.toThrow(/^sealed partial threshold not met \([01]\/2\): .*Error: invalid KEM partial/)
  })
  it('still refuses a corrupted share naming its keeper and identifier', async () => {
    const input = await ibeInput(1)
    const error = await extractIdentityStrict(input).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ThresholdNotMetError)
    expect((error as ThresholdNotMetError).reasons).toEqual(['https://keeper-1.example: ibeVerifyShare: invalid share from identifier 2'])
  })
})
