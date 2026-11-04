import {readFileSync} from 'node:fs'
import {afterEach, expect, test, vi} from 'vitest'
import {CipherSuite, HkdfSha256} from '@hpke/core'
import {DhkemX25519HkdfSha256} from '@hpke/dhkem-x25519'
import {Chacha20Poly1305} from '@hpke/chacha20poly1305'
import {sha256} from '@noble/hashes/sha256'
import {createDecryptionRecipient, kemContentDigest, recipientPayloadDigest, type RecipientWire, type ClientRecipient} from '../../src/crypto/recipient.js'
import {collectSealedPartials, decryptWithCommitteePartials, type SealedRequestOpts} from '../../src/decryption/sealed.js'
import {requestHash} from '../../src/oid4vp/binding.js'
import {hexToBytes, bytesToHex} from '../../src/crypto/hex.js'
import {base64Decode, base64Encode} from '../../src/crypto/envelope.js'
import {combineDecryptShares, type Ciphertext} from '../../src/crypto/kem.js'
import {ibeCombineDecrypt} from '../../src/crypto/ibe.js'
import {committeeDecrypt} from '../../src/committee/client.js'

interface Vector {
  private_key: string; recipient: RecipientWire; slot_id: string; chain_id: number; epoch: number; threshold: number; identity: string; plaintext: string
  kem_content_digest: string; kem_digest: string; ibe_digest: string; kem_request_hash: string; ibe_request_hash: string
  kem: {u: string; nonce: string; aead_ct: string}; ibe: {u: string; nonce: string; aead_ct: string}
  shares: {identifier: number; verifying_share: string; kem_partial: string; ibe_partial: string; kem_sealed: {enc: string; ciphertext: string}; ibe_sealed: {enc: string; ciphertext: string}}[]
}
const v = JSON.parse(readFileSync(new URL('../recipient-vectors.json', import.meta.url), 'utf8')) as Vector
const ct = (c: Vector['kem']): Ciphertext => ({u: hexToBytes(c.u), nonce: hexToBytes(c.nonce), aeadCt: hexToBytes(c.aead_ct)})
const utf8 = (s: string) => new TextEncoder().encode(s)
const suite = new CipherSuite({kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Chacha20Poly1305()})
function aad(hash: Uint8Array, id: number, vs: Uint8Array): Uint8Array {
  return new Uint8Array([...hash, id >>> 8, id & 255, ...new Uint8Array(8), ...vs])
}
afterEach(() => vi.unstubAllGlobals())

test('Rust-produced binding digests and HPKE replies open and decrypt in TypeScript', async () => {
  const content = kemContentDigest(ct(v.kem), utf8(v.identity))
  expect(bytesToHex(content).replace(/^0x/, '')).toBe(v.kem_content_digest)
  expect(bytesToHex(recipientPayloadDigest(content, 0, v.recipient)).replace(/^0x/, '')).toBe(v.kem_digest)
  expect(bytesToHex(recipientPayloadDigest(sha256(utf8(v.identity)), 0, v.recipient)).replace(/^0x/, '')).toBe(v.ibe_digest)
  const sk = await suite.kem.deserializePrivateKey(hexToBytes(v.private_key))
  const kemShares = []
  const ibeShares = []
  const verifying = new Map<number, Uint8Array>()
  for (const s of v.shares) {
    const vs = hexToBytes(s.verifying_share)
    const open = async (sealed: typeof s.kem_sealed, hash: string) => new Uint8Array(await suite.open({recipientKey: sk, enc: base64Decode(sealed.enc), info: utf8('keykeeper:sealed-decryption-share:v1')}, base64Decode(sealed.ciphertext), aad(hexToBytes(hash), s.identifier, vs)))
    const k = await open(s.kem_sealed, v.kem_request_hash)
    const i = await open(s.ibe_sealed, v.ibe_request_hash)
    expect(k).toEqual(hexToBytes(s.kem_partial))
    expect(i).toEqual(hexToBytes(s.ibe_partial))
    kemShares.push({id: s.identifier, decryptionShare: k, verifyingShare: vs})
    ibeShares.push({identifier: s.identifier, value: i})
    verifying.set(s.identifier, vs.slice(0, 96))
  }
  expect(combineDecryptShares(kemShares, ct(v.kem), utf8(v.identity), {verify: true})).toEqual(hexToBytes(v.plaintext))
  expect(ibeCombineDecrypt(verifying, ibeShares, ct(v.ibe), utf8(v.identity))).toEqual(hexToBytes(v.plaintext))
})

async function mockKeepers(client: ClientRecipient, action: 'decrypt' | 'ibe-extract', tweak?: (reply: Record<string, unknown>, index: number) => void): Promise<SealedRequestOpts> {
  const content = action === 'decrypt' ? kemContentDigest(ct(v.kem), utf8(v.identity)) : sha256(utf8(v.identity))
  const hash = requestHash(v.chain_id, hexToBytes(v.slot_id), action, recipientPayloadDigest(content, 0, client.recipient))
  const opts: SealedRequestOpts = {
    nodeUrls: ['https://keeper-1', 'https://keeper-2'], chainId: v.chain_id, recipient: client,
    ciphertextEpoch: 0, threshold: 2, verifyingShares: new Map(v.shares.map(s => [s.identifier, hexToBytes(s.verifying_share)])),
    committeeToken: {token_type: 'JWT', slot_id: v.slot_id, request_hash: bytesToHex(hash), binding: 'holder_key', seed: '00'.repeat(32), epoch: 7, vp_hash: '01'.repeat(32), holder_hash: '02'.repeat(32), rule_hash: '03'.repeat(32), iat: 0, exp: 9999999999, verifier_indexes: [], signatures: []},
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.recipient).toEqual(client.recipient)
    expect(JSON.stringify(body)).not.toContain('private_key')
    const index = url.includes('keeper-1') ? 0 : 1
    const s = v.shares[index]!
    const pk = await suite.kem.deserializePublicKey(hexToBytes(client.recipient.public_key))
    const sealed = await suite.seal({recipientPublicKey: pk, info: utf8('keykeeper:sealed-decryption-share:v1')}, hexToBytes(action === 'decrypt' ? s.kem_partial : s.ibe_partial), aad(hash, s.identifier, hexToBytes(s.verifying_share)))
    const reply = {key_slot_id: v.slot_id, identifier: s.identifier, epoch: 0, verifying_share: base64Encode(hexToBytes(s.verifying_share)), sealed_share: {enc: base64Encode(new Uint8Array(sealed.enc)), ciphertext: base64Encode(new Uint8Array(sealed.ct))}}
    tweak?.(reply, index)
    return new Response(JSON.stringify(reply))
  }))
  return opts
}

test('client opens and verifies sealed KEM and IBE replies; no custody fallback', async () => {
  const client = await createDecryptionRecipient()
  expect(Object.keys(client)).toEqual(['recipient', 'open'])
  const opts = await mockKeepers(client, 'decrypt')
  expect(await decryptWithCommitteePartials({...opts, ciphertext: ct(v.kem), identity: utf8(v.identity)})).toEqual(hexToBytes(v.plaintext))
  const ibe = await mockKeepers(client, 'ibe-extract')
  const partials = await collectSealedPartials(ibe, 'ibe-extract', utf8(v.identity))
  const verifying = new Map(v.shares.map(s => [s.identifier, hexToBytes(s.verifying_share).slice(0, 96)]))
  expect(ibeCombineDecrypt(verifying, partials, ct(v.ibe), utf8(v.identity))).toEqual(hexToBytes(v.plaintext))
})

test('captured replies cannot be opened by another client or rebound to another context', async () => {
  const client = await createDecryptionRecipient()
  const other = await createDecryptionRecipient()
  const s = v.shares[0]!
  const vs = hexToBytes(s.verifying_share)
  const hash = hexToBytes(v.kem_request_hash)
  const pk = await suite.kem.deserializePublicKey(hexToBytes(client.recipient.public_key))
  const result = await suite.seal({recipientPublicKey: pk, info: utf8('keykeeper:sealed-decryption-share:v1')}, hexToBytes(s.kem_partial), aad(hash, s.identifier, vs))
  const sealed = {enc: base64Encode(new Uint8Array(result.enc)), ciphertext: base64Encode(new Uint8Array(result.ct))}
  await expect(other.open(sealed, hash, s.identifier, 0, vs)).rejects.toThrow()
  await expect(client.open(sealed, sha256(hash), s.identifier, 0, vs)).rejects.toThrow()
  await expect(client.open(sealed, hash, s.identifier + 1, 0, vs)).rejects.toThrow()
  await expect(client.open(sealed, hash, s.identifier, 1, vs)).rejects.toThrow()
})

test.each(['epoch', 'slot', 'duplicate', 'verifying', 'unsealed', 'tamper'] as const)('rejects %s responses without obtaining a threshold', async kind => {
  const client = await createDecryptionRecipient()
  const opts = await mockKeepers(client, 'decrypt', (r, i) => {
    if (i === 0) return
    if (kind === 'epoch') r.epoch = 1
    if (kind === 'slot') r.key_slot_id = '00'.repeat(32)
    if (kind === 'duplicate') r.identifier = 1
    if (kind === 'verifying') r.verifying_share = base64Encode(new Uint8Array(144))
    if (kind === 'unsealed') {delete (r as {sealed_share?: unknown}).sealed_share; r.decryption_share = base64Encode(hexToBytes(v.shares[1]!.kem_partial))}
    if (kind === 'tamper') (r.sealed_share as {ciphertext: string}).ciphertext = base64Encode(new Uint8Array(112))
  })
  await expect(decryptWithCommitteePartials({...opts, ciphertext: ct(v.kem), identity: utf8(v.identity)})).rejects.toThrow('threshold not met')
})

test('recipient substitution and unbound grants fail before making any keeper request', async () => {
  const client = await createDecryptionRecipient()
  const opts = await mockKeepers(client, 'decrypt')
  const other = await createDecryptionRecipient()
  await expect(decryptWithCommitteePartials({...opts, recipient: other, ciphertext: ct(v.kem), identity: utf8(v.identity)})).rejects.toThrow('not bound')
  expect(fetch).not.toHaveBeenCalled()
  await expect(committeeDecrypt({} as Parameters<typeof committeeDecrypt>[0])).rejects.toThrow('retired')
  expect(fetch).not.toHaveBeenCalled()
})

test('an impossible threshold fails before approvals or keeper requests', async () => {
  const client = await createDecryptionRecipient()
  const opts = await mockKeepers(client, 'decrypt')
  opts.nodeUrls = opts.nodeUrls.slice(0, 1)
  opts.approveExecution = vi.fn()
  await expect(decryptWithCommitteePartials({...opts, ciphertext: ct(v.kem), identity: utf8(v.identity)})).rejects.toThrow('valid threshold')
  expect(opts.approveExecution).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
})

test('only the client-held recovery seed restores the original recipient across processes', async () => {
  const seed = new Uint8Array(32).fill(19)
  const client = await createDecryptionRecipient(seed)
  const restored = await createDecryptionRecipient(seed)
  expect(restored.recipient).toEqual(client.recipient)
  expect(seed).toEqual(new Uint8Array(32).fill(19))
  seed.fill(0)
  const opts = await mockKeepers(client, 'decrypt')
  expect(await decryptWithCommitteePartials({...opts, recipient: restored, ciphertext: ct(v.kem), identity: utf8(v.identity)})).toEqual(hexToBytes(v.plaintext))
  for (const bad of [new Uint8Array(31), new Uint8Array(32)]) await expect(createDecryptionRecipient(bad)).rejects.toThrow('recovery seed')
})


test('a slow keeper cannot delay a valid threshold; outstanding fetches are aborted', async () => {
  const client = await createDecryptionRecipient()
  const opts = await mockKeepers(client, 'decrypt')
  const keeperFetch = fetch
  let aborted = false
  opts.nodeUrls.push('https://slow-keeper')
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    if (!url.includes('slow-keeper')) return keeperFetch(url, init)
    return new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => {aborted = true; reject(new Error('aborted'))}, {once: true})
    })
  })
  expect(await decryptWithCommitteePartials({...opts, ciphertext: ct(v.kem), identity: utf8(v.identity)})).toEqual(hexToBytes(v.plaintext))
  expect(aborted).toBe(true)
})
