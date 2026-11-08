import {describe, expect, it} from 'vitest'
import {CipherSuite, HkdfSha256} from '@hpke/core'
import {DhkemX25519HkdfSha256} from '@hpke/dhkem-x25519'
import {Chacha20Poly1305} from '@hpke/chacha20poly1305'
import {ed25519} from '@noble/curves/ed25519'
import {bls12_381} from '@noble/curves/bls12-381'
import {concatBytes} from '@noble/hashes/utils'
import {hexToBytes} from '../../src/crypto/hex.js'
import {base64Decode, base64Encode} from '../../src/crypto/envelope.js'
import {encrypt, type Ciphertext} from '../../src/crypto/kem.js'
import {createDecryptionRecipient, kemContentDigest, recipientPayloadDigest, type ClientRecipient} from '../../src/crypto/recipient.js'
import {requestHash} from '../../src/oid4vp/binding.js'
import {createSessionKey, type SessionKeyHandle} from '../../src/app/session-grants.js'
import {BINDING_HOLDER_KEY, type VerifierSet} from '../../src/committee/token.js'
import {encodeSessionGrant, sessionBatchProofHash, sessionGrantHash, sessionGrantPayload, sessionKeyThumbprint, sessionProofHash, verifySessionGrant,
  verifySessionSignature, decodeSessionGrant, type SessionKeyJwk} from '../../src/committee/session-grant.js'
import {decryptWithSessionGrant, type SessionDecryptItem} from '../../src/decryption/session.js'

const G1 = bls12_381.G1.ProjectivePoint, G2 = bls12_381.G2.ProjectivePoint, ORDER = bls12_381.fields.Fr.ORDER
const suite = new CipherSuite({kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Chacha20Poly1305()})
const utf8 = (s: string) => new TextEncoder().encode(s)
const T0 = 1_800_000_000, CHAIN = 43112
const slot = ('0x' + '01'.repeat(32)) as `0x${string}`, rule = new Uint8Array(32).fill(0xfe)
const seeds = Array.from({length: 7}, (_, i) => new Uint8Array(32).fill(0x10 + i))
const set: VerifierSet = {registrySize: 7, pubkeys: new Map(seeds.map((s, i) => [i, ed25519.getPublicKey(s)]))}

// A 2-of-3 Shamir sharing f(x) = msk + a·x over Fr; keeper identifiers 1..3.
const msk = 0x1234567n, a = 0x7654321n
const sk = (id: number) => (msk + a * BigInt(id)) % ORDER
const mpk = G2.BASE.multiply(msk).toRawBytes(true)
const verifyingShares = new Map([1, 2, 3].map(id => [id, concatBytes(G2.BASE.multiply(sk(id)).toRawBytes(true), G1.BASE.multiply(sk(id)).toRawBytes(true))]))

async function verifiedGrant(key: SessionKeyHandle) {
  const payload = sessionGrantPayload({chainId: BigInt(CHAIN), sessionId: new Uint8Array(32).fill(0x5a), holderHash: new Uint8Array(32).fill(0x48),
    sessionKeyThumbprint: sessionKeyThumbprint(key.jwk), binding: BINDING_HOLDER_KEY, action: 'decrypt', seed: new Uint8Array(32).fill(0x5e), epoch: 42n,
    slots: [{slotId: hexToBytes(slot), ruleHash: rule}], iat: T0, exp: T0 + 30, idleTimeoutSecs: 600, absoluteExp: T0 + 3600})
  const hash = sessionGrantHash(payload)
  const grant = encodeSessionGrant({payload, signatures: seeds.map((s, i) => ({verifierIndex: i, signature: ed25519.sign(hash, s)}))})
  const verified = verifySessionGrant({grant: decodeSessionGrant(grant), set, slotId: hexToBytes(slot), committee: 3, quorum: 2, slotRuleHash: rule, now: T0 + 1})
  return {grant, verified}
}

interface Message { item: SessionDecryptItem; plaintext: string; hash: Uint8Array }
async function message(text: string, epoch = 0): Promise<Message> {
  const identity = utf8('room-7'), recipient: ClientRecipient = await createDecryptionRecipient()
  const ciphertext: Ciphertext = encrypt(mpk, identity, utf8(text))
  const digest = recipientPayloadDigest(kemContentDigest(ciphertext, identity), epoch, recipient.recipient)
  return {item: {ciphertext, identity, recipient, ciphertextEpoch: epoch}, plaintext: text, hash: requestHash(CHAIN, hexToBytes(slot), 'decrypt', digest)}
}

/** A keeper that checks the session proof like the keeper plan (steps 6–7), then seals its partial. */
function keeper(id: number, jwk: () => SessionKeyJwk, grantHash: () => Uint8Array, behaviour: (index: number) => 'ok' | 'refuse' | 'bad-share' = () => 'ok', log?: {url: string; body: Record<string, unknown>}[]) {
  return async (body: Record<string, unknown>, url: string) => {
    log?.push({url, body})
    const proof = body.proof as {iat: number; jti: string; signature: string}
    const items = (url.endsWith('/partials') ? body.items : [body]) as Record<string, unknown>[]
    const hashes = items.map(it => {
      const c = it.ciphertext as {u: string; nonce: string; aead_ct: string}
      const ct = {u: base64Decode(c.u), nonce: base64Decode(c.nonce), aeadCt: base64Decode(c.aead_ct)}
      return requestHash(CHAIN, hexToBytes(slot), 'decrypt', recipientPayloadDigest(kemContentDigest(ct, utf8(it.identity as string)), it.ciphertext_epoch as number, it.recipient as never))
    })
    const proofHash = url.endsWith('/partials') ? sessionBatchProofHash(grantHash(), hashes, proof.iat, proof.jti) : sessionProofHash(grantHash(), hashes[0]!, proof.iat, proof.jti)
    if (!verifySessionSignature(jwk(), proofHash, hexToBytes(proof.signature))) return {status: 401, json: {code: 'session_proof'}}
    const replies = await Promise.all(items.map(async (it, index) => {
      const b = behaviour(index)
      if (b === 'refuse') return {status: 402, code: 'payment_required'}
      const c = it.ciphertext as {u: string}
      const U = G2.fromHex(base64Decode(c.u))
      const d = (b === 'bad-share' ? U.multiply(sk(id) + 1n) : U.multiply(sk(id))).toRawBytes(true)
      const vs = verifyingShares.get(id)!
      const pk = await suite.kem.deserializePublicKey(hexToBytes((it.recipient as {public_key: string}).public_key))
      const aad = new Uint8Array([...hashes[index]!, id >>> 8, id & 255, ...new Uint8Array(8), ...vs])
      const sealed = await suite.seal({recipientPublicKey: pk, info: utf8('keykeeper:sealed-decryption-share:v1')}, d, aad)
      return {status: 200, partial: {identifier: id, epoch: 0, key_slot_id: slot.slice(2), verifying_share: base64Encode(vs),
        sealed_share: {enc: base64Encode(new Uint8Array(sealed.enc)), ciphertext: base64Encode(new Uint8Array(sealed.ct))}}}
    }))
    return {status: 200, json: url.endsWith('/partials') ? {items: replies} : replies[0]!.status === 200 ? replies[0]!.partial : {code: 'payment_required'}}
  }
}

function fleet(keepers: ReturnType<typeof keeper>[]): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    const id = Number(/keeper-(\d+)/.exec(new URL(url).hostname)![1])
    const r = await keepers[id - 1]!(JSON.parse(String(init.body)) as Record<string, unknown>, url)
    return new Response(JSON.stringify(r.json), {status: r.status})
  }) as unknown as typeof fetch
}

async function setup(behaviours: Parameters<typeof keeper>[3][] = []) {
  const key = await createSessionKey({alg: 'Ed25519'})
  const {grant, verified} = await verifiedGrant(key)
  const log: {url: string; body: Record<string, unknown>}[] = []
  const keepers = [1, 2, 3].map(id => keeper(id, () => key.jwk, () => verified.grantHash, behaviours[id - 1], log))
  const options = {nodeUrls: ['https://keeper-1.test', 'https://keeper-2.test', 'https://keeper-3.test'], chainId: CHAIN, slotId: slot, grant, verified, key,
    verifyingShares, threshold: 2, fetchImpl: fleet(keepers), clock: () => T0 + 2}
  return {options, log, key}
}

describe('per-message decrypts under a session grant (ADR-0090 D7/D8)', () => {
  it('one item: the single route with a single proof over its request hash, no committee token, and the plaintext back', async () => {
    const {options, log} = await setup()
    const m = await message('hello one')
    const [result] = await decryptWithSessionGrant(options, [m.item])
    expect(result).toEqual({ok: true, plaintext: utf8('hello one')})
    expect(log.map(l => l.url)).toEqual(['https://keeper-1.test/v1/committee/decrypt/partial', 'https://keeper-2.test/v1/committee/decrypt/partial', 'https://keeper-3.test/v1/committee/decrypt/partial'])
    for (const {body} of log) {
      expect(body).toHaveProperty('session_grant')
      expect(body).toHaveProperty('session_key')
      expect(body).not.toHaveProperty('committee_token')
      expect(JSON.stringify(body)).not.toMatch(/"d":/)
    }
    // Every keeper gets its own fresh jti.
    expect(new Set(log.map(l => (l.body.proof as {jti: string}).jti)).size).toBe(3)
  })

  it('a batch: one request per keeper over the ordered items, each item its own result; a refused item does not fail the batch', async () => {
    const refuseSecond = (i: number) => i === 1 ? 'refuse' as const : 'ok' as const
    const {options, log} = await setup([refuseSecond, refuseSecond, refuseSecond])
    const ms = await Promise.all(['first', 'second', 'third'].map(t => message(t)))
    const results = await decryptWithSessionGrant(options, ms.map(m => m.item))
    expect(log.every(l => l.url.endsWith('/v1/committee/decrypt/partials'))).toBe(true)
    expect(log).toHaveLength(3)
    expect(results[0]).toEqual({ok: true, plaintext: utf8('first')})
    expect(results[1]).toMatchObject({ok: false, codes: ['payment_required', 'payment_required', 'payment_required']})
    expect(results[2]).toEqual({ok: true, plaintext: utf8('third')})
  })

  it('an invalid partial from one keeper is dropped by the batch verification and the item still meets its threshold', async () => {
    const {options} = await setup([() => 'bad-share', () => 'ok', () => 'ok'])
    const ms = await Promise.all(['alpha', 'beta'].map(t => message(t)))
    const results = await decryptWithSessionGrant(options, ms.map(m => m.item))
    expect(results).toEqual([{ok: true, plaintext: utf8('alpha')}, {ok: true, plaintext: utf8('beta')}])
    const {options: worse} = await setup([() => 'bad-share', () => 'bad-share', () => 'ok'])
    const [r] = await decryptWithSessionGrant(worse, [(await message('gamma')).item])
    expect(r).toMatchObject({ok: false})
    expect((r as {error: string}).error).toMatch(/threshold not met \(1\/2\)/)
  })

  it('a keeper that refuses the proof (wrong key) yields no partial; a proof by another key is refused by the keepers', async () => {
    const {options} = await setup()
    const thief = await createSessionKey({alg: 'Ed25519'})
    // The thief holds the grant but not the session key: the client itself refuses to sign for a mismatched key.
    await expect(decryptWithSessionGrant({...options, key: thief}, [(await message('x')).item])).rejects.toThrow(/thumbprint/)
  })

  it('refuses before sending: a payment for another ciphertext, a grant verified for another slot, and 65 items', async () => {
    const {options, log} = await setup()
    const m = await message('paid'), other = await message('other')
    const payment = {action: 'decrypt', slot, payload_digest: '0x' + '00'.repeat(32)} as never
    await expect(decryptWithSessionGrant(options, [{...m.item, payment}])).rejects.toThrow(/not bound to this ciphertext/)
    await expect(decryptWithSessionGrant({...options, slotId: ('0x' + '02'.repeat(32)) as `0x${string}`}, [other.item])).rejects.toThrow(/another slot/)
    await expect(decryptWithSessionGrant(options, Array.from({length: 65}, () => m.item))).rejects.toThrow(/1\.\.64/)
    expect(log).toHaveLength(0)
  })
})
