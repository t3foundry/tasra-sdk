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
import {decryptWithSessionGrant, isStaleSessionRefusal, sessionKeeperOrder, type SessionDecryptItem} from '../../src/decryption/session.js'

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
  return {item: {ciphertext, identity, recipient, ciphertextEpoch: epoch}, plaintext: text, hash: requestHash(CHAIN, hexToBytes(slot), 'decrypt', digest)}
}

type Behaviour = 'ok' | 'refuse' | 'bad-share' | 'conflict'

// The keeper wire is strict (serde deny_unknown_fields): a body carrying anything else is a 422.
const ITEM_FIELDS = ['key_slot_id', 'identity', 'recipient', 'ciphertext_epoch', 'ciphertext', 'dual_control', 'user_signature']
const SESSION_FIELDS = ['session_grant', 'session_key', 'proof', 'verifier_proofs', 'target_keykeeper']
const unknownField = (o: Record<string, unknown>, allowed: string[]) => Object.keys(o).find(k => !allowed.includes(k))

/** A keeper that checks the session proof like the keeper plan (steps 6–7), then seals its partial. Wire per keykeeper-node api/sealed_session.rs. */
function keeper(id: number, jwk: () => SessionKeyJwk, grantHash: () => Uint8Array, behaviour: (index: number) => Behaviour = () => 'ok', log?: {url: string; body: Record<string, unknown>}[],
  maxItems = Infinity, legacySingle = false) {
  return async (body: Record<string, unknown>, url: string): Promise<{status: number; json: unknown; headers?: Record<string, string>}> => {
    log?.push({url, body})
    const batch = url.endsWith('/partials')
    const proof = body.proof as {iat: number; jti: string; signature: string}
    const stray = batch ? unknownField(body, [...SESSION_FIELDS, 'items']) ?? (body.items as Record<string, unknown>[]).map(it => unknownField(it, ITEM_FIELDS)).find(Boolean)
      : unknownField(body, [...SESSION_FIELDS, ...ITEM_FIELDS])
    if (stray) return {status: 422, json: {code: 'invalid-request', error: `unknown field \`${stray}\``}}
    const items = (batch ? body.items : [body]) as Record<string, unknown>[]
    if (batch && items.length > maxItems) return {status: 413, json: {code: 'batch-too-large', error: 'split it', max_items: maxItems}}
    const hashes = items.map(itemHash)
    const proofHash = batch ? sessionBatchProofHash(grantHash(), hashes, proof.iat, proof.jti) : sessionProofHash(grantHash(), hashes[0]!, proof.iat, proof.jti)
    if (!verifySessionSignature(jwk(), proofHash, hexToBytes(proof.signature))) return {status: 403, json: {error: 'session proof'}}
    const replies = await Promise.all(items.map(async (it, index) => {
      const b = behaviour(index)
      if (b === 'refuse') return {status: 403, code: 'forbidden', error: 'slot is not named by the session grant'}
      if (b === 'conflict') return {status: 409, code: 'conflict', error: 'sharing changed'}
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

function itemHash(it: Record<string, unknown>): Uint8Array {
  const c = it.ciphertext as {u: string; nonce: string; aead_ct: string}
  const ct = {u: base64Decode(c.u), nonce: base64Decode(c.nonce), aeadCt: base64Decode(c.aead_ct)}
  return requestHash(CHAIN, hexToBytes(slot), 'decrypt', recipientPayloadDigest(kemContentDigest(ct, utf8(it.identity as string)), it.ciphertext_epoch as number, it.recipient as never))
}

/** The sealed partial keeper `id` returns for one item. */
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

describe('per-message decrypts under a session grant (ADR-0090 D7)', () => {
  it('one item: the single route with a single proof over its request hash, no committee token, and the plaintext back', async () => {
    const {options, log} = await setup()
    const m = await message('hello one')
    const [result] = await decryptWithSessionGrant(options, [m.item])
    expect(result).toEqual({ok: true, plaintext: utf8('hello one')})
    // Only `threshold` keepers are asked: the first two of the request's own order.
    const asked = sessionKeeperOrder(options.nodeUrls, m.hash).slice(0, 2).map(u => `${u}/v1/committee/decrypt/partial`)
    expect(log.map(l => l.url).sort()).toEqual([...asked].sort())
    for (const {body} of log) {
      expect(body).toHaveProperty('session_grant')
      expect(body).toHaveProperty('session_key')
      expect(body).not.toHaveProperty('committee_token')
      expect(JSON.stringify(body)).not.toMatch(/"d":/)
    }
    // Every keeper gets its own fresh jti.
    expect(new Set(log.map(l => (l.body.proof as {jti: string}).jti)).size).toBe(2)
  })

  it('a batch: one request per keeper over the ordered items, each item its own result; a refused item does not fail the batch', async () => {
    const refuseSecond = (i: number) => i === 1 ? 'refuse' as const : 'ok' as const
    const {options, log} = await setup([refuseSecond, refuseSecond, refuseSecond])
    const ms = await Promise.all(['first', 'second', 'third'].map(t => message(t)))
    const results = await decryptWithSessionGrant(options, ms.map(m => m.item))
    // Two keepers get the batch; the third is asked only for the item the two refused.
    expect(log.filter(l => l.url.endsWith('/v1/committee/decrypt/partials'))).toHaveLength(2)
    expect(log).toHaveLength(3)
    expect(log[2]!.url).toMatch(/\/v1\/committee\/decrypt\/partial$/)
    expect(itemHash(log[2]!.body)).toEqual(ms[1]!.hash)
    expect(results[0]).toEqual({ok: true, plaintext: utf8('first')})
    // (The fixture refuses by position, so the third keeper, sent that item alone, serves it: one of two.)
    expect(results[1]).toMatchObject({ok: false, codes: ['forbidden', 'forbidden']})
    expect((results[1] as {error: string}).error).toMatch(/threshold not met \(1\/2\)/)
    expect(results[2]).toEqual({ok: true, plaintext: utf8('third')})
  })

  it('asks only the threshold keepers, spread evenly over requests, and another keeper only when one fails', async () => {
    const {options, log} = await setup()
    const perKeeper = new Map<string, number>()
    for (let n = 0; n < 60; n++) {
      log.length = 0
      const m = await message(`even ${n}`)
      expect((await decryptWithSessionGrant(options, [m.item]))[0]).toEqual({ok: true, plaintext: utf8(`even ${n}`)})
      expect(log).toHaveLength(2)
      for (const l of log) perKeeper.set(new URL(l.url).hostname, (perKeeper.get(new URL(l.url).hostname) ?? 0) + 1)
    }
    // 120 requests over three keepers: 40 each on average; none is left out or always asked.
    expect([...perKeeper.keys()].sort()).toEqual(['keeper-1.test', 'keeper-2.test', 'keeper-3.test'])
    for (const count of perKeeper.values()) { expect(count).toBeGreaterThan(20); expect(count).toBeLessThan(60) }

    // A keeper that is down: the request goes to the next one and still succeeds.
    const down = await setup()
    const m = await message('one keeper down')
    const [first] = sessionKeeperOrder(down.options.nodeUrls, m.hash)
    const failing = (async (url: string, init: RequestInit) => {
      if (String(url).startsWith(first!)) throw new TypeError('fetch failed')
      return down.options.fetchImpl(url, init)
    }) as unknown as typeof fetch
    expect((await decryptWithSessionGrant({...down.options, fetchImpl: failing}, [m.item]))[0]).toEqual({ok: true, plaintext: utf8('one keeper down')})
    expect(down.log).toHaveLength(2)
    expect(down.log.some(l => l.url.startsWith(first!))).toBe(false)

    // A keeper that is slow: the next one is asked after the hedge delay, and the late answer is not awaited.
    const slow = await setup()
    const late = await message('one keeper slow')
    const [slowest] = sessionKeeperOrder(slow.options.nodeUrls, late.hash)
    const stalling = (async (url: string, init: RequestInit) => {
      if (String(url).startsWith(slowest!)) await new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal!.reason)))
      return slow.options.fetchImpl(url, init)
    }) as unknown as typeof fetch
    const started = Date.now()
    expect((await decryptWithSessionGrant({...slow.options, fetchImpl: stalling, hedgeAfterMs: 50}, [late.item]))[0]).toEqual({ok: true, plaintext: utf8('one keeper slow')})
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(slow.log).toHaveLength(2)

    // The caller's abort stops a request whose keepers never answer, and an aborted signal sends nothing.
    const hung = await setup()
    const never = (async (_url: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal!.reason)))) as unknown as typeof fetch
    const abort = new AbortController()
    const pending = decryptWithSessionGrant({...hung.options, fetchImpl: never, signal: abort.signal}, [(await message('abandoned')).item])
    setTimeout(() => abort.abort(new Error('caller left')), 20)
    await expect(pending).rejects.toThrow(/caller left/)
    await expect(decryptWithSessionGrant({...hung.options, signal: abort.signal}, [(await message('too late')).item])).rejects.toThrow(/caller left/)
    expect(hung.log).toHaveLength(0)
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

  it('refuses before sending: a malformed owner signature, a grant verified for another slot, and 65 items', async () => {
    const {options, log} = await setup()
    const m = await message('metered'), other = await message('other')
    await expect(decryptWithSessionGrant(options, [{...m.item, userSignature: new Uint8Array(63)}])).rejects.toThrow(/64 bytes/)
    await expect(decryptWithSessionGrant({...options, slotId: ('0x' + '02'.repeat(32)) as `0x${string}`}, [other.item])).rejects.toThrow(/another slot/)
    await expect(decryptWithSessionGrant(options, Array.from({length: 65}, () => m.item))).rejects.toThrow(/1\.\.64/)
    expect(log).toHaveLength(0)
  })
})

describe('session decrypts against the keeper wire (review 2026-11-09)', () => {
  it('the wire carries exactly the keeper fields: no payment, no approvals; verifier proofs go top-level on the batch route, even for one item', async () => {
    const {options, log} = await setup()
    const m = await message('witnessed')
    // The single route: the item fields beside the three session fields, nothing else.
    expect((await decryptWithSessionGrant(options, [m.item]))[0]).toEqual({ok: true, plaintext: utf8('witnessed')})
    expect(Object.keys(log[0]!.body).sort()).toEqual(['ciphertext', 'ciphertext_epoch', 'identity', 'key_slot_id', 'proof', 'recipient', 'session_grant', 'session_key'])
    log.length = 0
    const proofs = [{verifier_index: 0, operator: '13'.repeat(20), pubkey: '14'.repeat(32), proof: []}]
    const owner = new Uint8Array(64).fill(7)
    const [r] = await decryptWithSessionGrant({...options, verifierProofs: proofs}, [{...(await message('witnessed')).item, userSignature: owner}])
    expect(r).toEqual({ok: true, plaintext: utf8('witnessed')})
    for (const {url, body} of log) {
      expect(url).toMatch(/\/v1\/committee\/decrypt\/partials$/)
      expect(Object.keys(body).sort()).toEqual(['items', 'proof', 'session_grant', 'session_key', 'verifier_proofs'])
      expect(body.verifier_proofs).toEqual(proofs)
      const [item] = body.items as Record<string, unknown>[]
      expect(Object.keys(item!).sort()).toEqual(['ciphertext', 'ciphertext_epoch', 'identity', 'key_slot_id', 'recipient', 'user_signature'])
      expect(item!.user_signature).toBe('07'.repeat(64))
    }
  })

  it('the strict keeper refuses a body with a retired payment field (the reason none is ever sent)', async () => {
    const {options} = await setup()
    const inner = options.fetchImpl
    const withPayment = (async (url: string, init: RequestInit) => inner(url, {...init, body: JSON.stringify({...JSON.parse(String(init.body)) as object, payment: {max_cost: '1'}})})) as unknown as typeof fetch
    const [r] = await decryptWithSessionGrant({...options, fetchImpl: withPayment}, [(await message('strict')).item])
    expect(r).toMatchObject({ok: false, codes: ['invalid-request', 'invalid-request', 'invalid-request']})
  })

  it('a 413 batch-too-large splits the batch into the keeper limit, each request with its own proof and jti', async () => {
    const {options, log} = await setup([], 2)
    const ms = await Promise.all(['a', 'b', 'c'].map(t => message(t)))
    const results = await decryptWithSessionGrant(options, ms.map(m => m.item))
    expect(results).toEqual(['a', 'b', 'c'].map(t => ({ok: true, plaintext: utf8(t)})))
    const [first] = sessionKeeperOrder(options.nodeUrls, ms[0]!.hash)
    const toFirst = log.filter(l => l.url.startsWith(first!))
    expect(toFirst.map(l => (l.body.items as unknown[]).length)).toEqual([3, 2, 1])
    expect(new Set(toFirst.map(l => (l.body.proof as {jti: string}).jti)).size).toBe(3)
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

  it('a 429 is sent again several times (readers behind one address share a bucket), then given up on', async () => {
    // Three refusals in a row at every keeper: the fourth attempt is served.
    const {options} = await setup()
    const refusals = new Map<string, number>()
    const inner = options.fetchImpl
    const busy = (limit: number) => (async (url: string, init: RequestInit) => {
      const host = new URL(url).hostname, seen = refusals.get(host) ?? 0
      refusals.set(host, seen + 1)
      if (seen < limit) return new Response(JSON.stringify({error: 'retry after 0s'}), {status: 429, headers: {'retry-after': '0'}})
      return inner(url, init)
    }) as unknown as typeof fetch
    const [served] = await decryptWithSessionGrant({...options, fetchImpl: busy(3), threshold: 3, random: () => 0}, [(await message('crowded')).item])
    expect(served).toEqual({ok: true, plaintext: utf8('crowded')})
    expect([...refusals.values()]).toEqual([4, 4, 4])

    // A keeper that never has room is asked six times (one request and five retries), then reported.
    refusals.clear()
    const [refused] = await decryptWithSessionGrant({...options, fetchImpl: busy(Infinity), threshold: 3, random: () => 0}, [(await message('full')).item])
    expect(refused).toMatchObject({ok: false})
    expect((refused as {codes: string[]}).codes).toEqual(['status 429', 'status 429', 'status 429'])
    expect([...refusals.values()]).toEqual([6, 6, 6])

    // A Retry-After longer than the SDK will wait is not waited for.
    refusals.clear()
    const slow = (async (url: string) => {
      refusals.set(new URL(url).hostname, (refusals.get(new URL(url).hostname) ?? 0) + 1)
      return new Response(JSON.stringify({error: 'retry after 60s'}), {status: 429, headers: {'retry-after': '60'}})
    }) as unknown as typeof fetch
    const [later] = await decryptWithSessionGrant({...options, fetchImpl: slow, threshold: 3}, [(await message('later')).item])
    expect(later).toMatchObject({ok: false})
    expect([...refusals.values()]).toEqual([1, 1, 1])
  })

  it('a 409 from a keeper is that item\'s refusal: nothing is re-sent, recovered or retried', async () => {
    const {options, log} = await setup([() => 'conflict', () => 'conflict', () => 'ok'])
    const [failed] = await decryptWithSessionGrant(options, [(await message('conflicted')).item])
    expect(failed).toMatchObject({ok: false, codes: ['conflict', 'conflict'], stale: false})
    expect(log).toHaveLength(3)
  })
  it('an older keeper without codes on the single route is reported by its status', async () => {
    const {options} = await setup([() => 'conflict', () => 'conflict', () => 'ok'], Infinity, true)
    const [failed] = await decryptWithSessionGrant(options, [(await message('legacy')).item])
    expect(failed).toMatchObject({ok: false, codes: ['status 409', 'status 409']})
  })

  it('the keeper code decides on the single route: no string match on the message', async () => {
    const coded = (status: number, json: unknown) => (async () => new Response(JSON.stringify(json), {status})) as unknown as typeof fetch
    const {options} = await setup()
    const m = await message('coded')
    const [r] = await decryptWithSessionGrant({...options, threshold: 1, nodeUrls: ['https://keeper-1.test'],
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
  type Answer = 'stale' | 'stale-code' | 'ok' | 'down' | 'other' | 410 | 413 | 429 | 409 | 500
  async function run(answers: Answer[]) {
    const {options} = await setup()
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const id = Number(/keeper-(\d+)/.exec(new URL(url).hostname)![1])
      const a = answers[id - 1]!
      if (a === 'down') throw new TypeError('fetch failed')
      if (typeof a === 'number') return new Response(JSON.stringify({error: `refused ${a}`, code: `code-${a}`}), {status: a})
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

  it('410, 413 and 429 precede execution: beside a stale refusal they keep it stale; 409 and 5xx never do (review F6)', async () => {
    for (const status of [410, 413, 429] as const) {
      const r = await run(['stale', status, 'stale'])
      expect(r).toMatchObject({ok: false, stale: true})
      expect((r as Extract<typeof r, {ok: false}>).refusals.find(x => x.status === status)).toMatchObject({scope: 'request', code: `code-${status}`})
    }
    // None of them names a stale grant by itself.
    expect(await run([410, 413, 429])).toMatchObject({ok: false, stale: false})
    // 409 may mean "already ran"; a 5xx leaves it unknown.
    for (const status of [409, 500] as const) expect(await run(['stale', status, 'stale'])).toMatchObject({ok: false, stale: false})
  })

  it('classifies keeper refusals: the stable code, or the fixed freshness messages of older keepers', () => {
    expect(isStaleSessionRefusal({status: 403, code: 'session-stale'})).toBe(true)
    expect(isStaleSessionRefusal({status: 403, code: 'status 403', message: STALE})).toBe(true)
    expect(isStaleSessionRefusal({status: 403, code: 'forbidden', message: 'session grant expired at 100 (now 106)'})).toBe(true)
    expect(isStaleSessionRefusal({status: 409, code: 'conflict', message: STALE})).toBe(false)
    expect(isStaleSessionRefusal({status: 403, code: 'forbidden', message: 'session grant: quorum not met'})).toBe(false)
  })

  it('a C24 keeper whose beacon LAGS the grant answers forbidden with the same epoch text: not stale (no refresh, no second debit)', () => {
    // Grant epoch 481 ahead of the keeper's latest 480, and the previous epoch (still admissible).
    expect(isStaleSessionRefusal({status: 403, code: 'forbidden', message: 'committee token epoch 481 is not current (beacon latest 480); x'})).toBe(false)
    expect(isStaleSessionRefusal({status: 403, code: 'status 403', message: 'committee token epoch 479 is not current (beacon latest 480); x'})).toBe(false)
    // Behind the window, and the C24 code whatever the text says.
    expect(isStaleSessionRefusal({status: 403, code: 'forbidden', message: STALE})).toBe(true)
    expect(isStaleSessionRefusal({status: 403, code: 'session-stale', message: 'committee token epoch 481 is not current (beacon latest 480); x'})).toBe(true)
  })
})
