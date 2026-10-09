// Status refresh for an already-issued grant (`keykeeper/committee-status-refresh/v1`): the proof
// hash and both proof kinds, strict reply parsing, the typed error table, and the direct and relay
// paths' rule - every answer verified under the ORIGINAL roster, original signers only, a fresh
// capped quorum, per-index merge, never an unsigned result.
import {describe, expect, it, vi} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import {keccak_256} from '@noble/hashes/sha3'
import {
  assembleCompoundToken,
  compoundTokenHash,
  decodeCompoundToken,
  statusAttestationHash,
  type CompoundTokenPayload,
} from '../../src/committee/token.js'
import {
  acceptStatusRefreshRelay,
  classifyStatusRefreshResponse,
  createStatusRefreshProof,
  parseStatusRefreshReply,
  refreshStatusDirect,
  refreshStatusViaAgent,
  statusRefreshHash,
  statusRefreshHolderSigner,
  statusRefreshRequestBody,
  MAX_STATUS_REFRESH_BODY_BYTES,
  STATUS_REFRESH_DOMAIN,
  STATUS_REFRESH_JWT_TYP,
  withdrawsOriginal,
  type StatusRefreshProofWire,
} from '../../src/committee/status-refresh.js'
import {createLocalExecutionSigner} from '../../src/committee/execution.js'
import {ed25519HolderKey, p256HolderKey, verifyCompactJws, decodeJson, type Jwk} from '../../src/oid4vp/jose.js'
import {StatusRefreshError, isRetryable, isStatusRefreshError, type StatusRefreshCode} from '../../src/errors.js'

const bytes = (n: number, v: number) => new Uint8Array(n).fill(v)
const hex = (b: Uint8Array) => '0x' + Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')
const secret = (i: number) => bytes(32, 0x40 + i)
const pub = (i: number) => ed25519.getPublicKey(secret(i))
const now = () => Math.floor(Date.now() / 1000)

/** A 3-verifier grant (indexes 0..2) signed by `signers`, quorum 2, with optional attestations. */
function grant(opts: {signers?: number[]; drawn?: number[]; exp?: number; attest?: {index: number; until: number}[]} = {}) {
  const t = now()
  const payload: CompoundTokenPayload = {tokenType: 'JWT', seed: bytes(32, 1), epoch: 9, slotId: bytes(32, 2), vpHash: bytes(32, 3), holderHash: bytes(32, 4),
    ruleHash: bytes(32, 5), paymentHash: bytes(32, 7), binding: 1, verifierIndexes: opts.drawn ?? [0, 1, 2], iat: t, exp: opts.exp ?? t + 600}
  const hash = compoundTokenHash(payload)
  const signatures = (opts.signers ?? [0, 1, 2]).map(i => ({verifierIndex: i, signature: ed25519.sign(hash, secret(i))}))
  const attestations = (opts.attest ?? []).map(a => ({verifierIndex: a.index, statusUntil: a.until, signature: ed25519.sign(statusAttestationHash(hash, a.index, a.until), secret(a.index))}))
  const token = assembleCompoundToken(payload, signatures, attestations)
  // Roster of the token epoch: 0..3 (3 is a real verifier that did not sign).
  const set = {registrySize: 4, pubkeys: new Map([0, 1, 2, 3].map(i => [i, pub(i)] as const))}
  return {token, hash, set, quorum: 2}
}
const reply = (hash: Uint8Array, index: number, until: number, key = index) =>
  ({token_hash: hex(hash), verifier_index: index, status_until: until, status_signature: hex(ed25519.sign(statusAttestationHash(hash, index, until), secret(key)))})
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {status, headers: {'Content-Type': 'application/json', ...headers}})
const proof: StatusRefreshProofWire = {kind: 'client_execution', seq: 1, issued_at: 1_760_000_000, signature: '0x' + 'aa'.repeat(64)}
const verifiers = [0, 1, 2, 3].map(index => ({index, url: `https://v${index}.example`}))
const thrown = (f: () => unknown): unknown => { try { f() } catch (e) { return e } throw new Error('did not throw') }
const indexOf = (url: string) => Number(/https:\/\/v(\d)\.example/.exec(url)![1])

describe('status refresh hash', () => {
  it('pins the byte layout to independently computed vectors', () => {
    // Expected values computed outside the SDK with Foundry `cast keccak` over the hex preimage
    // (domain || chain_id u64BE || token_hash || payment_hash|zero32 || kind u8 || seq u64BE || issued_at i64BE).
    // The same method reproduces the status-attestation vector c0a7febf...e0f91ab3.
    // ⚠ Not yet cross-checked against a Rust `refresh_hash` (none exists in keykeeper-committee at 7f82e52c).
    expect(hex(statusRefreshHash({chainId: 43112, tokenHash: bytes(32, 0x42), paymentHash: bytes(32, 0x07), principal: 'client_execution', seq: 1, issuedAt: 1_760_000_000})))
      .toBe('0x0032b0d45ad23fb4e4221e2f8f4b446900c8ab0684f09fcfffff4005145ef5a0')
    expect(hex(statusRefreshHash({chainId: 43112, tokenHash: bytes(32, 0x42), principal: 'holder_key', seq: 3, issuedAt: 1_760_000_000})))
      .toBe('0x36a88fe2b859185d9061d99577adf182f50e5119d928c582ef6a7e05eddc7cb6')
    // Independent preimage in the test, too.
    const pre = new Uint8Array([...new TextEncoder().encode(STATUS_REFRESH_DOMAIN), 0, 0, 0, 0, 0, 0, 0xa8, 0x68, ...bytes(32, 0x42), ...bytes(32, 0x07), 2,
      0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0x68, 0xe7, 0x78, 0x00])
    expect(hex(keccak_256(pre))).toBe('0x0032b0d45ad23fb4e4221e2f8f4b446900c8ab0684f09fcfffff4005145ef5a0')
    expect(STATUS_REFRESH_DOMAIN).toBe('keykeeper/committee-status-refresh/v1')
  })

  it('moves with every input and treats an absent payment hash as all-zero', () => {
    const base = {chainId: 43112, tokenHash: bytes(32, 0x42), paymentHash: bytes(32, 0x07), principal: 'client_execution' as const, seq: 1, issuedAt: 1_760_000_000}
    const h0 = hex(statusRefreshHash(base))
    for (const change of [{chainId: 43113}, {tokenHash: bytes(32, 0x43)}, {paymentHash: bytes(32, 0x08)}, {principal: 'holder_key' as const}, {seq: 2}, {issuedAt: 1_760_000_001}]) {
      expect(hex(statusRefreshHash({...base, ...change}))).not.toBe(h0)
    }
    expect(hex(statusRefreshHash({...base, paymentHash: undefined}))).toBe(hex(statusRefreshHash({...base, paymentHash: bytes(32, 0)})))
    expect(() => statusRefreshHash({...base, seq: 0})).toThrow(/seq/)
    expect(() => statusRefreshHash({...base, tokenHash: bytes(31, 1)})).toThrow(/32 bytes/)
    expect(() => statusRefreshHash({...base, issuedAt: 1.5})).toThrow(/issued_at/)
    expect(statusRefreshHash({...base, seq: (1n << 64n) - 1n})).toHaveLength(32)
    expect(() => statusRefreshHash({...base, seq: 1n << 64n})).toThrow(/range/)
  })
})

describe('refresh proofs', () => {
  const input = {chainId: 43112, tokenHash: bytes(32, 0x42), paymentHash: bytes(32, 0x07), seq: 5, issuedAt: 1_760_000_000}

  it('signs client_execution with the original execution key', async () => {
    const signer = createLocalExecutionSigner(bytes(32, 9))
    const p = await createStatusRefreshProof({...input, prover: {kind: 'client_execution', signer}})
    expect(p).toMatchObject({kind: 'client_execution', seq: 5, issued_at: 1_760_000_000})
    expect(p.signature).toMatch(/^0x[0-9a-f]{128}$/)
    const digest = statusRefreshHash({...input, principal: 'client_execution'})
    expect(ed25519.verify(p.signature.slice(2), digest, signer.publicKey)).toBe(true)
    // A signer that does not hold the key it claims is caught before anything is sent.
    await expect(createStatusRefreshProof({...input, prover: {kind: 'client_execution', signer: {publicKey: pub(1), sign: async m => ed25519.sign(m, secret(2))}}}))
      .rejects.toThrow(/invalid status refresh signature/)
    signer.dispose()
  })

  it.each([['ES256', p256HolderKey(bytes(32, 0x11))], ['EdDSA', ed25519HolderKey(bytes(32, 0x12))]] as const)('signs a %s holder_key JWS with typ, jwk and the hash', async (alg, holder) => {
    const p = await createStatusRefreshProof({...input, prover: {kind: 'holder_key', signer: statusRefreshHolderSigner(holder)}})
    expect(p.kind).toBe('holder_key')
    const [h] = p.signature.split('.')
    const header = decodeJson<{alg: string; typ: string; jwk: Jwk}>(h!)
    expect(header).toEqual({alg, typ: STATUS_REFRESH_JWT_TYP, jwk: holder.publicJwk})
    const {payload} = verifyCompactJws<{refresh: string}>(p.signature, header.jwk)
    expect(payload).toEqual({refresh: hex(statusRefreshHash({...input, principal: 'holder_key'}))})
  })

  it('builds the exact strict body and refuses one over 4096 bytes', () => {
    const body = JSON.parse(new TextDecoder().decode(statusRefreshRequestBody(43112, bytes(32, 0x42), proof))) as Record<string, unknown>
    expect(body).toEqual({chain_id: 43112, token_hash: hex(bytes(32, 0x42)), proof})
    expect(() => statusRefreshRequestBody(43112, bytes(32, 0x42), {...proof, kind: 'holder_key', signature: 'x'.repeat(MAX_STATUS_REFRESH_BODY_BYTES)})).toThrow(/4096/)
    expect(() => statusRefreshRequestBody(43112, bytes(32, 0x42), {...proof, seq: 0})).toThrow(/proof/)
  })
})

describe('reply parsing and the typed error table', () => {
  const ok = reply(bytes(32, 0x42), 1, 1_000)

  it('accepts exactly the four reply fields', () => {
    expect(parseStatusRefreshReply(ok)).toEqual(ok)
    for (const bad of [{...ok, extra: 1}, {token_hash: ok.token_hash, verifier_index: 1, status_until: 1_000}, {...ok, status_signature: null},
      {...ok, verifier_index: -1}, {...ok, status_until: '1000'}, {...ok, token_hash: '0x12'}, [], null]) {
      expect(() => parseStatusRefreshReply(bad)).toThrow(StatusRefreshError)
    }
  })

  it.each<[number, string, StatusRefreshCode]>([
    [404, '{"error":"status_refresh_unknown"}', 'status_refresh_unknown'],
    [409, '{"error":"status_refresh_unavailable: legacy record"}', 'status_refresh_unavailable'],
    [409, '{"error":"status_refresh_replayed"}', 'status_refresh_replayed'],
    [409, '{"error":"status_refresh_context_changed"}', 'status_refresh_context_changed'],
    [410, '{"error":"status_refresh_expired"}', 'status_refresh_expired'],
    [403, '{"error":"status_refresh_unauthenticated"}', 'status_refresh_unauthenticated'],
    [403, '{"error":"status_refresh_refused: revoked"}', 'status_refresh_refused'],
    [503, '{"error":"status_refresh_unavailable_status"}', 'status_refresh_unavailable_status'],
    [503, '{"error":"status_refresh_quorum_unmet"}', 'status_refresh_quorum_unmet'],
    [503, '{"code":"status_refresh_unavailable_status"}', 'status_refresh_unavailable_status'],
    [429, 'slow down', 'status_refresh_rate_limited'],
    [404, '', 'status_refresh_unknown'],
    [401, '', 'status_refresh_unauthenticated'],
    // A code that does not belong to its status is ignored, never trusted.
    [403, '{"error":"status_refresh_replayed"}', 'status_refresh_http'],
    [409, '', 'status_refresh_http'],
    [500, '{"error":"status_refresh_refused"}', 'status_refresh_http'],
  ])('HTTP %i %s → %s', (status, body, code) => {
    expect(classifyStatusRefreshResponse(status, body)).toBe(code)
  })

  it('marks only capacity, unavailable status and transport as retryable', () => {
    const r = (code: StatusRefreshCode, httpStatus?: number) => isRetryable(new StatusRefreshError({code, message: code, httpStatus}))
    expect(['status_refresh_rate_limited', 'status_refresh_unavailable_status', 'status_refresh_unreachable'].every(c => r(c as StatusRefreshCode))).toBe(true)
    expect(['status_refresh_unknown', 'status_refresh_unavailable', 'status_refresh_replayed', 'status_refresh_context_changed', 'status_refresh_expired',
      'status_refresh_unauthenticated', 'status_refresh_refused', 'status_refresh_invalid_response'].some(c => r(c as StatusRefreshCode))).toBe(false)
    expect(r('status_refresh_http', 502)).toBe(true)
    expect(r('status_refresh_http', 418)).toBe(false)
  })
})

describe('direct refresh at the original signers', () => {
  it('fans one proof out to the original verified signers only and merges a fresh quorum', async () => {
    const t = now(), until = t + 30
    const g = grant({signers: [0, 1], attest: [{index: 0, until: t + 5}, {index: 1, until: t + 40}]})
    const fetchImpl = vi.fn<typeof fetch>(async url => json(200, reply(g.hash, indexOf(String(url)), until)))
    const out = await refreshStatusDirect({...g, chainId: 43112, proof, verifiers, fetch: fetchImpl})
    // Verifier 2 is drawn but its token signature is absent; 3 is outside the token: neither is called.
    expect(fetchImpl.mock.calls.map(c => String(c[0])).sort()).toEqual(['https://v0.example/v1/committee/status-refresh', 'https://v1.example/v1/committee/status-refresh'])
    const sent = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body)) as Record<string, unknown>
    expect(sent).toEqual({chain_id: 43112, token_hash: hex(g.hash), proof})
    expect(out.refreshed).toEqual([0, 1])
    // Per index the later deadline wins: index 1 keeps its original +40.
    expect(out.statusAttestations.map(a => [a.verifier_index, a.status_until])).toEqual([[0, until], [1, until + 10]])
    expect(out.statusUntil).toBe(until)
    // Signatures and every hashed field are unchanged; only the attestations moved.
    expect(compoundTokenHash(decodeCompoundToken(out.token))).toEqual(g.hash)
    expect(out.token.signatures).toEqual(g.token.signatures)
  })

  it('never trusts a forged, unsigned or foreign reply and gates on the quorum', async () => {
    const until = now() + 30
    const g = grant()
    const forged = vi.fn<typeof fetch>(async url => {
      const i = indexOf(String(url))
      if (i === 0) return json(200, reply(g.hash, 0, until)) // genuine
      if (i === 1) return json(200, reply(g.hash, 1, until, 3)) // signed by another verifier's key
      return json(200, {token_hash: hex(g.hash), verifier_index: 2, status_until: until}) // unsigned
    })
    const error = await refreshStatusDirect({...g, chainId: 43112, proof, verifiers, fetch: forged}).catch((e: unknown) => e)
    expect(isStatusRefreshError(error)).toBe(true)
    expect((error as StatusRefreshError).code).toBe('status_refresh_quorum_unmet')
    expect((error as StatusRefreshError).retryable).toBe(false)
    expect((error as StatusRefreshError).reasons.every(r => r.code === 'status_refresh_invalid_response')).toBe(true)
    expect((error as StatusRefreshError).reasons.map(r => r.verifierIndex).sort()).toEqual([1, 2])
    expect((error as StatusRefreshError).message).toMatch(/1 of 2/)

    // A reply naming another index or another token is dropped too.
    const foreign = vi.fn<typeof fetch>(async url => {
      const i = indexOf(String(url))
      return i === 0 ? json(200, reply(g.hash, 0, until)) : i === 1 ? json(200, reply(g.hash, 0, until)) : json(200, reply(bytes(32, 0x99), 2, until))
    })
    await expect(refreshStatusDirect({...g, chainId: 43112, proof, verifiers, fetch: foreign})).rejects.toMatchObject({code: 'status_refresh_quorum_unmet', retryable: false})
  })

  it('ignores a non-original signer entirely', async () => {
    const until = now() + 30
    // Index 2 is drawn but did not sign the original token: it is not asked, and the two
    // original signers must form the quorum on their own.
    const g = grant({signers: [0, 1]})
    const fetchImpl = vi.fn<typeof fetch>(async url => indexOf(String(url)) === 0 ? json(200, reply(g.hash, 0, until)) : json(503, '{"error":"status_refresh_unavailable_status"}'))
    await expect(refreshStatusDirect({...g, chainId: 43112, proof, verifiers, fetch: fetchImpl})).rejects.toMatchObject({code: 'status_refresh_quorum_unmet'})
    expect(fetchImpl.mock.calls.some(c => String(c[0]).startsWith('https://v2.'))).toBe(false)
    // The relay cannot smuggle one in either.
    const relay = {status: 200, body: JSON.stringify({token_hash: hex(g.hash), status_attestations: [reply(g.hash, 0, until), reply(g.hash, 2, until)]
      .map(r => ({verifier_index: r.verifier_index, status_until: r.status_until, signature: r.status_signature}))})}
    expect(() => acceptStatusRefreshRelay(g, relay)).toThrow(/1 of 2/)
  })

  it('drops attestations past the token cap minus the keeper skew and refuses an expired grant locally', async () => {
    const g = grant({exp: now() + 20})
    const fetchImpl = vi.fn<typeof fetch>(async url => json(200, reply(g.hash, indexOf(String(url)), now() + 16))) // 16 + 5 > 20
    await expect(refreshStatusDirect({...g, chainId: 43112, proof, verifiers, fetch: fetchImpl})).rejects.toMatchObject({code: 'status_refresh_invalid_response'})
    const capped = vi.fn<typeof fetch>(async url => json(200, reply(g.hash, indexOf(String(url)), now() + 14)))
    expect((await refreshStatusDirect({...g, chainId: 43112, proof, verifiers, fetch: capped})).refreshed).toEqual([0, 1, 2])
    // An extra cap (the payment expiry) binds too.
    await expect(refreshStatusDirect({...g, caps: [now() + 10], chainId: 43112, proof, verifiers, fetch: capped})).rejects.toMatchObject({code: 'status_refresh_invalid_response'})
    const dead = vi.fn<typeof fetch>()
    await expect(refreshStatusDirect({...grant({exp: now() + 5}), chainId: 43112, proof, verifiers, fetch: dead})).rejects.toMatchObject({code: 'status_refresh_expired'})
    expect(dead).not.toHaveBeenCalled()
  })

  it('surfaces revocation distinctly, uniform refusals by their code, and Retry-After', async () => {
    const until = now() + 30
    const g = grant()
    const revoked = vi.fn<typeof fetch>(async url => indexOf(String(url)) === 0 ? json(200, reply(g.hash, 0, until)) : json(403, '{"error":"status_refresh_refused"}'))
    const r = await refreshStatusDirect({...g, chainId: 43112, proof, verifiers, fetch: revoked}).catch((e: unknown) => e as StatusRefreshError)
    expect(r).toMatchObject({code: 'status_refresh_refused', httpStatus: 403, retryable: false})
    for (const [status, body, code] of [[404, 'status_refresh_unknown', 'status_refresh_unknown'], [409, 'status_refresh_replayed', 'status_refresh_replayed'],
      [409, 'status_refresh_unavailable', 'status_refresh_unavailable'], [409, 'status_refresh_context_changed', 'status_refresh_context_changed'],
      [410, 'status_refresh_expired', 'status_refresh_expired'], [403, 'status_refresh_unauthenticated', 'status_refresh_unauthenticated'],
      [503, 'status_refresh_unavailable_status', 'status_refresh_unavailable_status']] as const) {
      const f = vi.fn<typeof fetch>(async () => json(status, {error: body}))
      await expect(refreshStatusDirect({...g, chainId: 43112, proof, verifiers, fetch: f})).rejects.toMatchObject({code, httpStatus: status})
    }
    const limited = vi.fn<typeof fetch>(async () => json(429, {error: 'per-token interval'}, {'Retry-After': '7'}))
    await expect(refreshStatusDirect({...g, chainId: 43112, proof, verifiers, fetch: limited}))
      .rejects.toMatchObject({code: 'status_refresh_rate_limited', retryAfterMs: 7000, retryable: true})
    expect(limited).toHaveBeenCalledTimes(3) // once per original signer, never retried
    const down = vi.fn<typeof fetch>(async () => { throw new TypeError('fetch failed') })
    await expect(refreshStatusDirect({...g, chainId: 43112, proof, verifiers, fetch: down})).rejects.toMatchObject({code: 'status_refresh_unreachable', retryable: true})
  })
})

describe('every outcome is classified before anything is merged', () => {
  const refused = () => json(403, {error: 'status_refresh_refused', reasons: []})
  const freshOriginals = (t: number) => [0, 1, 2].map(index => ({index, until: t + 60}))

  it('a unanimous revocation is final although the original attestations alone still meet the quorum', async () => {
    const g = grant({attest: freshOriginals(now())})
    const fetchImpl = vi.fn<typeof fetch>(async () => refused())
    const e = (await refreshStatusDirect({...g, chainId: 43112, proof, verifiers, fetch: fetchImpl}).catch((x: unknown) => x)) as StatusRefreshError
    expect(e).toBeInstanceOf(StatusRefreshError)
    expect(e).toMatchObject({code: 'status_refresh_refused', httpStatus: 403, retryable: false})
    expect(e.reasons.map(r => [r.verifierIndex, r.code]).sort()).toEqual([[0, 'status_refresh_refused'], [1, 'status_refresh_refused'], [2, 'status_refresh_refused']])
  })

  it('one revocation beside a fresh quorum of new attestations is still final', async () => {
    const until = now() + 30
    const g = grant({attest: freshOriginals(now())})
    const fetchImpl = vi.fn<typeof fetch>(async url => indexOf(String(url)) === 2 ? refused() : json(200, reply(g.hash, indexOf(String(url)), until)))
    await expect(refreshStatusDirect({...g, chainId: 43112, proof, verifiers, fetch: fetchImpl}))
      .rejects.toMatchObject({code: 'status_refresh_refused', httpStatus: 403})
    // The relay's typed 403 is the same refusal.
    expect(thrown(() => acceptStatusRefreshRelay(g, {status: 403,
      body: JSON.stringify({error: 'status_refresh_refused', reasons: [{verifier_index: 2, code: 'status_refresh_refused'}]})})))
      .toMatchObject({code: 'status_refresh_refused', httpStatus: 403})
  })

  it('a typed negative outcome withdraws that verifier\'s original; an untyped one does not', async () => {
    const t = now(), until = t + 30
    const g = grant({attest: freshOriginals(t)})
    const answer = (third: () => Response) => vi.fn<typeof fetch>(async url => indexOf(String(url)) === 2 ? third() : json(200, reply(g.hash, indexOf(String(url)), until)))
    const replayed = await refreshStatusDirect({...g, chainId: 43112, proof, verifiers, fetch: answer(() => json(409, {error: 'status_refresh_replayed'}))})
    expect(replayed.ineligible).toEqual([2])
    // 0 and 1 keep their later ORIGINAL (+60); 2's original is withdrawn, not merged back.
    expect(replayed.statusAttestations.map(a => [a.verifier_index, a.status_until])).toEqual([[0, t + 60], [1, t + 60]])
    const untyped = await refreshStatusDirect({...g, chainId: 43112, proof, verifiers, fetch: answer(() => json(500, 'upstream down'))})
    expect(untyped.ineligible).toEqual([])
    expect(untyped.statusAttestations.map(a => a.verifier_index)).toEqual([0, 1, 2])
    for (const code of ['status_refresh_refused', 'status_refresh_expired', 'status_refresh_unauthenticated', 'status_refresh_context_changed',
      'status_refresh_unavailable_status', 'status_refresh_replayed'] as const) expect(withdrawsOriginal(code)).toBe(true)
    for (const code of ['status_refresh_unknown', 'status_refresh_unavailable', 'status_refresh_quorum_unmet', 'status_refresh_rate_limited',
      'status_refresh_invalid_response', 'status_refresh_unreachable', 'status_refresh_http'] as const) expect(withdrawsOriginal(code)).toBe(false)
  })

  it('takes a relay answer as the whole set: originals it left out never rejoin', () => {
    const t = now(), until = t + 30
    const g = grant({attest: freshOriginals(t)})
    const wire = (r: ReturnType<typeof reply>) => ({verifier_index: r.verifier_index, status_until: r.status_until, signature: r.status_signature})
    const out = acceptStatusRefreshRelay(g, {status: 200, body: JSON.stringify({token_hash: hex(g.hash),
      status_attestations: [wire(reply(g.hash, 0, until)), wire(reply(g.hash, 1, until))]})})
    expect(out.statusAttestations.map(a => [a.verifier_index, a.status_until])).toEqual([[0, until], [1, until]])
    expect(out.ineligible).toEqual([2])
    // Every left-out original signer is withdrawn, reported in index order.
    const four = grant({drawn: [0, 1, 2, 3], signers: [0, 1, 2, 3], attest: [3, 2, 1, 0].map(index => ({index, until: t + 60}))})
    const whole = acceptStatusRefreshRelay(four, {status: 200, body: JSON.stringify({token_hash: hex(four.hash),
      status_attestations: [wire(reply(four.hash, 1, until)), wire(reply(four.hash, 0, until))]})})
    expect(whole.ineligible).toEqual([2, 3])
    expect(whole.statusAttestations.map(a => a.verifier_index)).toEqual([0, 1])
  })

  // Direct mode merges fresh + eligible originals BEFORE judging, as the relay (`merge_and_judge`)
  // and the CLI (`judge_direct` + `finish`) do: the count of new replies alone is never the judge.
  it('one fresh reply beside a still-fresh eligible original meets the quorum', async () => {
    const t = now(), until = t + 30
    const g = grant({attest: [{index: 1, until: t + 60}]})
    const fetchImpl = vi.fn<typeof fetch>(async url => indexOf(String(url)) === 0 ? json(200, reply(g.hash, 0, until)) : json(500, 'upstream down'))
    const out = await refreshStatusDirect({...g, chainId: 43112, proof, verifiers, fetch: fetchImpl})
    expect(out.refreshed).toEqual([0])
    expect(out.ineligible).toEqual([])
    expect(out.statusAttestations.map(a => [a.verifier_index, a.status_until])).toEqual([[0, until], [1, t + 60]])
    // Keeper rule: the quorum-th (2nd) largest deadline.
    expect(out.statusUntil).toBe(until)
  })

  it('one fresh reply beside a WITHDRAWN original is quorum_unmet', async () => {
    const t = now(), until = t + 30
    const g = grant({attest: [{index: 1, until: t + 60}]})
    const fetchImpl = vi.fn<typeof fetch>(async url => {
      const i = indexOf(String(url))
      return i === 0 ? json(200, reply(g.hash, 0, until)) : i === 1 ? json(409, {error: 'status_refresh_replayed'}) : json(500, 'upstream down')
    })
    const e = (await refreshStatusDirect({...g, chainId: 43112, proof, verifiers, fetch: fetchImpl}).catch((x: unknown) => x)) as StatusRefreshError
    expect(e).toBeInstanceOf(StatusRefreshError)
    expect(e.code).toBe('status_refresh_quorum_unmet')
    expect(e.message).toMatch(/1 of 2/)
  })

  it('an original past a grant cap does not count toward the merged quorum', async () => {
    const t = now(), until = t + 30
    const g = grant({attest: [{index: 1, until: t + 60}]})
    const fetchImpl = vi.fn<typeof fetch>(async url => indexOf(String(url)) === 0 ? json(200, reply(g.hash, 0, until)) : json(500, 'upstream down'))
    // Payment expiry t + 40: the reply (+30, +5 skew) fits, the original (+60) does not.
    await expect(refreshStatusDirect({...g, caps: [t + 40], chainId: 43112, proof, verifiers, fetch: fetchImpl}))
      .rejects.toMatchObject({code: 'status_refresh_quorum_unmet'})
  })

  it('a refusal stays final when fresh replies plus eligible originals would meet the quorum', async () => {
    const t = now(), until = t + 30
    const g = grant({attest: freshOriginals(t)})
    const fetchImpl = vi.fn<typeof fetch>(async url => {
      const i = indexOf(String(url))
      return i === 0 ? json(200, reply(g.hash, 0, until)) : i === 1 ? refused() : json(500, 'upstream down')
    })
    await expect(refreshStatusDirect({...g, chainId: 43112, proof, verifiers, fetch: fetchImpl}))
      .rejects.toMatchObject({code: 'status_refresh_refused', httpStatus: 403, retryable: false})
  })

  it('an original signer with no endpoint supplied is reported unreachable and withdraws nothing', async () => {
    const t = now(), until = t + 30
    const g = grant({attest: freshOriginals(t)})
    const fetchImpl = vi.fn<typeof fetch>(async url => json(200, reply(g.hash, indexOf(String(url)), until)))
    const out = await refreshStatusDirect({...g, chainId: 43112, proof, verifiers: verifiers.filter(v => v.index !== 2), fetch: fetchImpl})
    expect(fetchImpl.mock.calls.some(c => String(c[0]).startsWith('https://v2.'))).toBe(false)
    expect(out.failures).toContainEqual(expect.objectContaining({verifierIndex: 2, code: 'status_refresh_unreachable'}))
    expect(out.refreshed).toEqual([0, 1])
    // Untyped: 2's still-fresh original keeps counting.
    expect(out.ineligible).toEqual([])
    expect(out.statusAttestations.map(a => a.verifier_index)).toEqual([0, 1, 2])
  })
})

describe('bounded response read', () => {
  const CAP = 64 * 1024, CHUNK = 16 * 1024
  /** An endless body (pull-driven, nothing buffered ahead) that records how much was pulled and whether it was cancelled. */
  function endless() {
    const state = {pulled: 0, cancelled: false}
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { state.pulled += CHUNK; controller.enqueue(new Uint8Array(CHUNK).fill(0x61)) },
      cancel() { state.cancelled = true },
    }, {highWaterMark: 0})
    return {stream, state}
  }

  it.each([['absent', undefined], ['lying', '10']] as const)('cancels an oversized body mid-stream with a %s Content-Length', async (_label, length) => {
    const g = grant()
    const bodies = [0, 1, 2].map(() => endless())
    const fetchImpl = vi.fn<typeof fetch>(async url => new Response(bodies[indexOf(String(url))]!.stream,
      {status: 200, headers: {'Content-Type': 'application/json', ...(length !== undefined ? {'Content-Length': length} : {})}}))
    const e = (await refreshStatusDirect({...g, chainId: 43112, proof, verifiers, fetch: fetchImpl}).catch((x: unknown) => x)) as StatusRefreshError
    expect(e).toBeInstanceOf(StatusRefreshError)
    expect(e.code).toBe('status_refresh_invalid_response')
    expect(e.reasons.map(r => [r.verifierIndex, r.code]).sort()).toEqual([[0, 'status_refresh_invalid_response'], [1, 'status_refresh_invalid_response'], [2, 'status_refresh_invalid_response']])
    // The endless body was cancelled (an unbounded read would never return) close to the cap.
    for (const {state} of bodies) {
      expect(state.cancelled).toBe(true)
      expect(state.pulled).toBeGreaterThan(CAP)
      expect(state.pulled).toBeLessThanOrEqual(CAP + 4 * CHUNK)
    }
  })

  it('refuses an advertised Content-Length over the cap without reading the body', async () => {
    const body = endless()
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(body.stream, {status: 200, headers: {'Content-Type': 'application/json', 'Content-Length': String(CAP + 1)}}))
    const g = grant()
    await expect(refreshStatusViaAgent({...g, agentUrl: 'https://agent.example', sessionId: 'ab'.repeat(32), pollSecret: 'cd'.repeat(32), proof, fetch: fetchImpl}))
      .rejects.toMatchObject({code: 'status_refresh_invalid_response', httpStatus: 200})
    expect(body.state.cancelled).toBe(true)
    expect(body.state.pulled).toBeLessThanOrEqual(CHUNK)
  })

  it('a relay body that streams past the cap is a typed invalid response, not unreachable', async () => {
    const body = endless()
    const g = grant()
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(body.stream, {status: 200, headers: {'Content-Type': 'application/json'}}))
    await expect(refreshStatusViaAgent({...g, agentUrl: 'https://agent.example', sessionId: 'ab'.repeat(32), pollSecret: 'cd'.repeat(32), proof, fetch: fetchImpl}))
      .rejects.toMatchObject({code: 'status_refresh_invalid_response'})
    expect(body.state.cancelled).toBe(true)
  })

  // A hostile body whose cancel hook rejects: the read still ends with the typed refusal, and the
  // rejected cancellation is swallowed (no unhandled rejection), on both the advertised-length and
  // the streamed path.
  it.each([['advertised', String(CAP + 1)], ['streamed', undefined]] as const)('a %s oversize whose cancel hook rejects is still a typed refusal', async (_label, length) => {
    const hooks = {cancelled: 0}
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(CHUNK).fill(0x61)) },
      cancel() { hooks.cancelled++; return Promise.reject(new Error('hostile cancel hook')) },
    }, {highWaterMark: 0})
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const fetchImpl = vi.fn<typeof fetch>(async () => new Response(stream,
        {status: 200, headers: {'Content-Type': 'application/json', ...(length !== undefined ? {'Content-Length': length} : {})}}))
      const g = grant()
      await expect(refreshStatusViaAgent({...g, agentUrl: 'https://agent.example', sessionId: 'ab'.repeat(32), pollSecret: 'cd'.repeat(32), proof, fetch: fetchImpl}))
        .rejects.toMatchObject({code: 'status_refresh_invalid_response', httpStatus: 200})
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(hooks.cancelled).toBe(1)
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('reads a body at exactly the cap', async () => {
    const until = now() + 30
    const g = grant()
    const fetchImpl = vi.fn<typeof fetch>(async url => {
      const text = JSON.stringify(reply(g.hash, indexOf(String(url)), until))
      return json(200, text + ' '.repeat(CAP - new TextEncoder().encode(text).length))
    })
    expect((await refreshStatusDirect({...g, chainId: 43112, proof, verifiers, fetch: fetchImpl})).refreshed).toEqual([0, 1, 2])
  })
})

describe('relay refresh through the verifier-agent', () => {
  const wire = (r: ReturnType<typeof reply>) => ({verifier_index: r.verifier_index, status_until: r.status_until, signature: r.status_signature})

  it('posts {proof} with the session bearer and re-verifies the answer', async () => {
    const until = now() + 30
    const g = grant()
    const fetchImpl = vi.fn<typeof fetch>(async () => json(200, {token_hash: hex(g.hash), status_attestations: [wire(reply(g.hash, 0, until)), wire(reply(g.hash, 2, until))]}))
    const out = await refreshStatusViaAgent({...g, agentUrl: 'https://agent.example', sessionId: 'ab'.repeat(32), pollSecret: 'cd'.repeat(32), proof, fetch: fetchImpl})
    expect(String(fetchImpl.mock.calls[0]![0])).toBe(`https://agent.example/v1/sessions/${'ab'.repeat(32)}/status-refresh`)
    const init = fetchImpl.mock.calls[0]![1]!
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${'cd'.repeat(32)}`)
    expect(JSON.parse(String(init.body))).toEqual({proof})
    expect(out.refreshed).toEqual([0, 2])
  })

  it('refuses an unsigned, forged or reshaped relay answer', () => {
    const until = now() + 30
    const g = grant()
    const accept = (body: unknown) => () => acceptStatusRefreshRelay(g, {status: 200, body: JSON.stringify(body)})
    // Unsigned JSON claiming freshness carries no authority.
    expect(accept({token_hash: hex(g.hash), status_until: until, fresh: true})).toThrow(/exactly/)
    expect(accept({token_hash: hex(g.hash), status_attestations: [{verifier_index: 0, status_until: until}]})).toThrow(StatusRefreshError)
    // Forged: signed by the wrong key.
    expect(accept({token_hash: hex(g.hash), status_attestations: [wire(reply(g.hash, 0, until, 3)), wire(reply(g.hash, 1, until, 3))]})).toThrow(/0 of 2/)
    expect(accept({token_hash: hex(bytes(32, 0x99)), status_attestations: []})).toThrow(/another token/)
    expect(accept({token_hash: hex(g.hash), status_attestations: [wire(reply(g.hash, 0, until))], quorum: 'met'})).toThrow(/exactly/)
  })

  it('maps relay refusals to typed errors with per-index reasons', () => {
    const g = grant()
    const unmet = () => acceptStatusRefreshRelay(g, {status: 503, retryAfterMs: 2000,
      body: JSON.stringify({error: 'status_refresh_quorum_unmet', reasons: [{verifier_index: 0, code: 'status_refresh_refused'}, {verifier_index: 1, error: 'status_refresh_unavailable_status'}]})})
    const e = thrown(unmet) as StatusRefreshError
    expect(e).toBeInstanceOf(StatusRefreshError)
    expect(e).toMatchObject({code: 'status_refresh_quorum_unmet', httpStatus: 503, retryAfterMs: 2000})
    expect(e.reasons.slice(1)).toEqual([
      {verifierIndex: 0, code: 'status_refresh_refused', message: 'status_refresh_refused'},
      {verifierIndex: 1, code: 'status_refresh_unavailable_status', message: 'status_refresh_unavailable_status'}])
    expect(thrown(() => acceptStatusRefreshRelay(g, {status: 401, body: ''}))).toMatchObject({code: 'status_refresh_unauthenticated', httpStatus: 401})
    expect(thrown(() => acceptStatusRefreshRelay(g, {status: 404, body: '{"error":"status_refresh_unknown"}'}))).toMatchObject({code: 'status_refresh_unknown', httpStatus: 404})
  })

  it('refuses a grant without a verified original quorum before sending', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const g = grant({signers: [0]})
    await expect(refreshStatusViaAgent({...g, agentUrl: 'https://agent.example', sessionId: 'ab', pollSecret: 'cd'.repeat(32), proof, fetch: fetchImpl}))
      .rejects.toThrow(/verified signatures/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
