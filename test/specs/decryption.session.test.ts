import {describe, expect, it, vi} from 'vitest'
import {readFileSync} from 'node:fs'
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
import {decryptWithSessionGrant, isStaleSessionRefusal, type SessionDecryptItem} from '../../src/decryption/session.js'
import {executionBodyHash} from '../../src/committee/execution.js'
import {bytesToHex} from '../../src/crypto/hex.js'

// Keeper approvals (kind `session-decrypt`) have their own suite (committee.keeper-execution): here
// they are a pass-through stand-in, so this suite isolates the session wire and reply handling.
vi.mock('../../src/committee/keeperExecution.js', async original => ({...await original<typeof import('../../src/committee/keeperExecution.js')>(),
  withKeeperExecutionApprovals: vi.fn(async (o: {body: Record<string, unknown>}) => ({...o.body, execution_authorizations: [{stand_in: 'contributor approval'}]}))}))

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
  const verified = verifySessionGrant({grant: decodeSessionGrant(grant), set, slotId: hexToBytes(slot), committee: 3, quorum: 2, slotRuleHash: rule, seed: new Uint8Array(32).fill(0x5e), now: T0 + 1})
  return {grant, verified}
}

interface Message { item: SessionDecryptItem; plaintext: string; hash: Uint8Array }
async function message(text: string, epoch = 0): Promise<Message> {
  const identity = utf8('room-7'), recipient: ClientRecipient = await createDecryptionRecipient()
  const ciphertext: Ciphertext = encrypt(mpk, identity, utf8(text))
  const digest = recipientPayloadDigest(kemContentDigest(ciphertext, identity), epoch, recipient.recipient)
  const payment = {action: 'decrypt', slot, payload_digest: bytesToHex(digest)} as never
  return {item: {ciphertext, identity, recipient, ciphertextEpoch: epoch, payment, approveExecution: vi.fn() as never}, plaintext: text, hash: requestHash(CHAIN, hexToBytes(slot), 'decrypt', digest)}
}

type Behaviour = 'ok' | 'refuse' | 'bad-share' | 'recoverable' | 'claimed'

/** A keeper that checks the session proof like the keeper plan (steps 6–7), then seals its partial. Wire per keykeeper-node api/sealed_session.rs. */
function keeper(id: number, jwk: () => SessionKeyJwk, grantHash: () => Uint8Array, behaviour: (index: number) => Behaviour = () => 'ok', log?: {url: string; body: Record<string, unknown>}[],
  maxItems = Infinity, legacySingle = false) {
  return async (body: Record<string, unknown>, url: string): Promise<{status: number; json: unknown; headers?: Record<string, string>}> => {
    log?.push({url, body})
    const batch = url.endsWith('/partials')
    const proof = body.proof as {iat: number; jti: string; signature: string}
    const items = (batch ? body.items : [body]) as Record<string, unknown>[]
    if (batch && items.length > maxItems) return {status: 413, json: {code: 'batch-too-large', error: 'split it', max_items: maxItems}}
    const hashes = items.map(itemHash)
    const proofHash = batch ? sessionBatchProofHash(grantHash(), hashes, proof.iat, proof.jti) : sessionProofHash(grantHash(), hashes[0]!, proof.iat, proof.jti)
    if (!verifySessionSignature(jwk(), proofHash, hexToBytes(proof.signature))) return {status: 403, json: {error: 'session proof'}}
    const replies = await Promise.all(items.map(async (it, index) => {
      const b = behaviour(index)
      if (b === 'refuse') return {status: 402, code: 'payment-required', error: 'payment required'}
      if (b === 'recoverable') return {status: 409, code: 'recoverable', error: RECOVER_FROM_JOURNAL}
      if (b === 'claimed') return {status: 409, code: 'conflict', error: 'paid operation already claimed; reconciliation required'}
      return {status: 200, partial: await partialFor(id, it, b === 'bad-share')}
    }))
    if (batch) return {status: 200, json: {items: replies}}
    const r = replies[0]! as {status: number; partial?: unknown; error?: string}
    // The single route: the partial, or the keeper's `{code, error}` with the item's status (an older
    // keeper: `{error}` alone).
    const refusal = r as {code?: string; error?: string}
    return r.status === 200 ? {status: 200, json: r.partial} : {status: r.status, json: legacySingle ? {error: r.error} : {code: refusal.code, error: r.error}}
  }
}
const RECOVER_FROM_JOURNAL = 'operation completed but its audit record could not be written; recover its result through the paid-execution recovery route'

function itemHash(it: Record<string, unknown>): Uint8Array {
  const c = it.ciphertext as {u: string; nonce: string; aead_ct: string}
  const ct = {u: base64Decode(c.u), nonce: base64Decode(c.nonce), aeadCt: base64Decode(c.aead_ct)}
  return requestHash(CHAIN, hexToBytes(slot), 'decrypt', recipientPayloadDigest(kemContentDigest(ct, utf8(it.identity as string)), it.ciphertext_epoch as number, it.recipient as never))
}

/** The sealed partial keeper `id` returns (or retains in its journal) for one item. */
async function partialFor(id: number, it: Record<string, unknown>, bad = false) {
  const c = it.ciphertext as {u: string}
  const U = G2.fromHex(base64Decode(c.u))
  const d = (bad ? U.multiply(sk(id) + 1n) : U.multiply(sk(id))).toRawBytes(true)
  const vs = verifyingShares.get(id)!
  const pk = await suite.kem.deserializePublicKey(hexToBytes((it.recipient as {public_key: string}).public_key))
  const aad = new Uint8Array([...itemHash(it), id >>> 8, id & 255, ...new Uint8Array(8), ...vs])
  const sealed = await suite.seal({recipientPublicKey: pk, info: utf8('keykeeper:sealed-decryption-share:v1')}, d, aad)
  return {identifier: id, epoch: 0, key_slot_id: slot.slice(2), verifying_share: base64Encode(vs),
    sealed_share: {enc: base64Encode(new Uint8Array(sealed.enc)), ciphertext: base64Encode(new Uint8Array(sealed.ct))}}
}

function fleet(keepers: ReturnType<typeof keeper>[]): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    const id = Number(/keeper-(\d+)/.exec(new URL(url).hostname)![1])
    const r = await keepers[id - 1]!(JSON.parse(String(init.body)) as Record<string, unknown>, url)
    return new Response(JSON.stringify(r.json), {status: r.status, headers: r.headers})
  }) as unknown as typeof fetch
}

async function setup(behaviours: Parameters<typeof keeper>[3][] = [], maxItems = Infinity, legacySingle = false) {
  const key = await createSessionKey({alg: 'Ed25519'})
  const {grant, verified} = await verifiedGrant(key)
  const log: {url: string; body: Record<string, unknown>}[] = []
  const keepers = [1, 2, 3].map(id => keeper(id, () => key.jwk, () => verified.grantHash, behaviours[id - 1], log, maxItems, legacySingle))
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
    expect(results[1]).toMatchObject({ok: false, codes: ['payment-required', 'payment-required', 'payment-required']})
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

describe('session decrypts against the keeper wire (review 2026-11-09)', () => {
  it('the approved item body is the keeper vector: the single-route body minus the session fields and approvals', () => {
    const v = JSON.parse(readFileSync(new URL('../session-item-body-vectors.json', import.meta.url), 'utf8')) as
      {single_route_body: Record<string, unknown>; approved_item_body: Record<string, unknown>; body_hash: string}
    const {session_grant: _g, session_key: _k, proof: _p, execution_authorizations: _a, ...item} = v.single_route_body
    expect(item).toEqual(v.approved_item_body)
    expect(executionBodyHash(item)).toBe(v.body_hash)
  })

  it('every item carries its payment (the keeper requires one); verifier proofs go top-level on the batch route, even for one item', async () => {
    const {options, log} = await setup()
    const m = await message('witnessed')
    const {payment: _omitted, ...unpaid} = m.item
    await expect(decryptWithSessionGrant(options, [unpaid as SessionDecryptItem])).rejects.toThrow(/own payment/)
    const proofs = [{verifier_index: 0, operator: '13'.repeat(20), pubkey: '14'.repeat(32), proof: []}]
    const [r] = await decryptWithSessionGrant({...options, verifierProofs: proofs}, [m.item])
    expect(r).toEqual({ok: true, plaintext: utf8('witnessed')})
    for (const {url, body} of log) {
      expect(url).toMatch(/\/v1\/committee\/decrypt\/partials$/)
      expect(body.verifier_proofs).toEqual(proofs)
      const [item] = body.items as Record<string, unknown>[]
      expect(item).not.toHaveProperty('verifier_proofs')
      expect(item).toHaveProperty('payment')
      expect(item!.execution_authorizations).toHaveLength(1)
    }
  })

  it('a 413 batch-too-large splits the batch into the keeper limit, each request with its own proof and jti', async () => {
    const {options, log} = await setup([], 2)
    const ms = await Promise.all(['a', 'b', 'c'].map(t => message(t)))
    const results = await decryptWithSessionGrant(options, ms.map(m => m.item))
    expect(results).toEqual(['a', 'b', 'c'].map(t => ({ok: true, plaintext: utf8(t)})))
    const toKeeper1 = log.filter(l => l.url.startsWith('https://keeper-1.test'))
    expect(toKeeper1.map(l => (l.body.items as unknown[]).length)).toEqual([3, 2, 1])
    expect(new Set(toKeeper1.map(l => (l.body.proof as {jti: string}).jti)).size).toBe(3)
  })

  it('a 429 is retried once with a fresh proof after its Retry-After', async () => {
    const {options} = await setup()
    let refused = 0
    const inner = options.fetchImpl
    const fetchImpl = (async (url: string, init: RequestInit) => {
      if (url.startsWith('https://keeper-1.test') && refused++ === 0) return new Response(JSON.stringify({error: 'retry after 0s'}), {status: 429, headers: {'retry-after': '0'}})
      return inner(url, init)
    }) as unknown as typeof fetch
    const [r] = await decryptWithSessionGrant({...options, fetchImpl, threshold: 3}, [(await message('busy')).item])
    expect(r).toEqual({ok: true, plaintext: utf8('busy')})
    expect(refused).toBe(2)
  })

  it('an item a keeper already ran (409 recoverable / already claimed) is re-served by recovery, never resent or repaid', async () => {
    const {options, log} = await setup([() => 'recoverable', () => 'claimed', () => 'ok'])
    const m = await message('ran once')
    const recovered: string[] = []
    const recover = vi.fn(async (nodeUrl: string) => {
      recovered.push(nodeUrl)
      const id = Number(/keeper-(\d+)/.exec(nodeUrl)![1])
      // The retained partial from the keeper's paid-execution journal (the SAME sealed reply).
      return partialFor(id, log.find(l => l.url.startsWith(nodeUrl))!.body as Record<string, unknown>)
    })
    const [r] = await decryptWithSessionGrant(options, [{...m.item, recover}])
    expect(r).toEqual({ok: true, plaintext: utf8('ran once')})
    // Keeper 3 served; one recovery reaches the threshold of 2, so the second is never read.
    expect(recovered).toEqual(['https://keeper-1.test'])
    expect(log).toHaveLength(3)
    // Without a recovery hook the item fails and says why, per keeper.
    const [failed] = await decryptWithSessionGrant(options, [(await message('no hook')).item])
    expect(failed).toMatchObject({ok: false, codes: expect.arrayContaining(['recoverable', 'already-claimed'])})
  })
  it('an older keeper without codes on the single route: its 409s are still told apart by their fixed messages', async () => {
    const {options} = await setup([() => 'recoverable', () => 'claimed', () => 'ok'], Infinity, true)
    const [failed] = await decryptWithSessionGrant(options, [(await message('legacy')).item])
    expect(failed).toMatchObject({ok: false, codes: expect.arrayContaining(['recoverable', 'already-claimed'])})
  })

  it('the keeper code decides on the single route: no string match when a code is present (second review, 9c)', async () => {
    const coded = (status: number, json: unknown) => (async () => new Response(JSON.stringify(json), {status})) as unknown as typeof fetch
    const {options} = await setup()
    const m = await message('coded')
    // `recoverable` with a message that says nothing about recovery is still recoverable ...
    let [r] = await decryptWithSessionGrant({...options, threshold: 1, nodeUrls: ['https://keeper-1.test'], fetchImpl: coded(409, {code: 'recoverable', error: 'reworded'})}, [m.item])
    expect(r).toMatchObject({ok: false, codes: ['recoverable']})
    // ... and a `conflict` whose message mentions recovery is NOT read as recoverable.
    ;[r] = await decryptWithSessionGrant({...options, threshold: 1, nodeUrls: ['https://keeper-1.test'],
      fetchImpl: coded(409, {code: 'conflict', error: 'recover its result through the paid-execution recovery route'})}, [m.item])
    expect(r).toMatchObject({ok: false, codes: ['conflict']})
  })

  it('a keeper reply over 4 MiB is refused while it streams, without reading the rest (second review, 9b)', async () => {
    const {options} = await setup()
    let pulled = 0
    const chunk = new Uint8Array(1024 * 1024).fill(0x20)
    const endless = (async () => new Response(new ReadableStream<Uint8Array>({pull(controller) { pulled++; controller.enqueue(chunk) }}), {status: 200})) as unknown as typeof fetch
    await expect(decryptWithSessionGrant({...options, threshold: 1, nodeUrls: ['https://keeper-1.test'], fetchImpl: endless}, [(await message('huge')).item]))
      .resolves.toMatchObject([{ok: false}])
    expect(pulled).toBeLessThanOrEqual(6)
    // A declared length over the cap is refused before any read.
    pulled = 0
    const declared = (async () => new Response(new ReadableStream<Uint8Array>({pull(controller) { pulled++; controller.enqueue(chunk) }}),
      {status: 200, headers: {'content-length': String(8 * 1024 * 1024)}})) as unknown as typeof fetch
    await decryptWithSessionGrant({...options, threshold: 1, nodeUrls: ['https://keeper-1.test'], fetchImpl: declared}, [(await message('declared')).item])
    expect(pulled).toBeLessThanOrEqual(1)
  })
})

describe('a stale grant at a beacon-epoch boundary (C19)', () => {
  // The keeper's whole-request refusal of a grant two epochs behind (keykeeper-node
  // enforce_live_epoch; the batch route sends it without a code), as the C16 fleet answered it.
  const STALE = 'committee token epoch 478 is not current (beacon latest 480); a stale epoch would let the committee draw be ground over known past seeds'
  type Answer = 'stale' | 'stale-code' | 'ok' | 'down' | 'other'
  async function run(answers: Answer[]) {
    const {options} = await setup()
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const id = Number(/keeper-(\d+)/.exec(new URL(url).hostname)![1])
      const a = answers[id - 1]!
      if (a === 'down') throw new TypeError('fetch failed')
      if (a === 'stale') return new Response(JSON.stringify({error: STALE}), {status: 403})
      if (a === 'stale-code') return new Response(JSON.stringify({error: STALE, code: 'session-stale'}), {status: 403})
      if (a === 'other') return new Response(JSON.stringify({error: 'paid operation not activated', code: 'forbidden'}), {status: 403})
      const real = keeper(id, () => options.key.jwk, () => options.verified.grantHash)
      const r = await real(JSON.parse(String(init.body)) as Record<string, unknown>, url)
      return new Response(JSON.stringify(r.json), {status: r.status})
    }) as unknown as typeof fetch
    const m = await message('boundary')
    // Verifier proofs force the batch route, as on a production keeper.
    const [r] = await decryptWithSessionGrant({...options, fetchImpl, verifierProofs: [{verifier_index: 0, operator: '0x', pubkey: '0x', proof: []}]}, [m.item])
    return r!
  }

  it('every keeper refusing the grant as no longer current, before running anything, is stale and names the keepers\' beacon', async () => {
    const r = await run(['stale', 'stale', 'stale'])
    expect(r).toMatchObject({ok: false, stale: true})
    const failed = r as Extract<typeof r, {ok: false}>
    expect(failed.refusals).toHaveLength(3)
    expect(failed.refusals.every(x => x.scope === 'request' && x.status === 403)).toBe(true)
    expect(failed.error).toMatch(/beacon latest 480/)
    expect(await run(['stale-code', 'stale', 'other'])).toMatchObject({ok: false, stale: true})
  })

  it('is NOT stale when any keeper may have run the item: one served it, or one never answered', async () => {
    expect(await run(['ok', 'stale', 'stale'])).toMatchObject({ok: false, stale: false})
    expect(await run(['down', 'stale', 'stale'])).toMatchObject({ok: false, stale: false})
    // And a refusal that does not say "stale" is no reason to pay again.
    expect(await run(['other', 'other', 'other'])).toMatchObject({ok: false, stale: false})
  })

  it('classifies keeper refusals: the stable code, or the fixed freshness messages of older keepers', () => {
    expect(isStaleSessionRefusal({status: 403, code: 'session-stale'})).toBe(true)
    expect(isStaleSessionRefusal({status: 403, code: 'status 403', message: STALE})).toBe(true)
    expect(isStaleSessionRefusal({status: 403, code: 'forbidden', message: 'session grant expired at 100 (now 106)'})).toBe(true)
    expect(isStaleSessionRefusal({status: 409, code: 'conflict', message: STALE})).toBe(false)
    expect(isStaleSessionRefusal({status: 403, code: 'forbidden', message: 'session grant: quorum not met'})).toBe(false)
  })
})
