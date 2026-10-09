// Revocation-status freshness attestations (`keykeeper/committee-status-attestation/v1`):
// the cross-language digest, strict wire validation, pass-through to keepers, quorum gating in
// the client-as-coordinator fan-out, the unchanged token hash, and the typed keeper refusal.
import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import {keccak_256} from '@noble/hashes/sha3'
import {sha256} from '@noble/hashes/sha256'
import {toHex} from 'viem'
import {
  assembleCompoundToken,
  assertStatusAttestationsWire,
  compoundTokenHash,
  decodeCompoundToken,
  selectVerifierCommittee,
  statusAttestationHash,
  verifyStatusAttestation,
  verifyStatusAttestations,
  MAX_STATUS_ATTESTATIONS,
  MAX_STATUS_WINDOW_SECS,
  REVOCATION_BOUND_SECS,
  STATUS_CACHE_BOUND_SECS,
  STATUS_SKEW_SECS,
  DEFAULT_STATUS_WINDOW_SECS,
  STATUS_ATTESTATION_DOMAIN,
  type CompoundTokenPayload,
  type CompoundTokenWire,
  type StatusAttestation,
} from '../../src/committee/token.js'
import {committeeSign, gatherCommitteeToken, requestIbeExtractionPartials} from '../../src/committee/client.js'
import {executionBodyHash, type ExecutionAuthorization} from '../../src/committee/execution.js'
import {paymentIntentHash} from '../../src/committee/payment.js'
import {assertCompoundTokenWire, VerifierAgentSessionError} from '../../src/verifier-agent/index.js'
import {AuthDeniedError, RevocationStatusError, ThresholdNotMetError, httpError, isAuthDenied, isRetryable, isRevocationStatusRefusal} from '../../src/errors.js'
import {keeperExecutionFixture} from '../support/keeperExecution.js'

const bytes = (n: number, v: number) => new Uint8Array(n).fill(v)
const hex = (b: Uint8Array) => '0x' + Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')
const secret = (i: number) => bytes(32, 0x40 + i)
const pub = (i: number) => ed25519.getPublicKey(secret(i))
const attest = (i: number, tokenHash: Uint8Array, until: number): StatusAttestation =>
  ({verifierIndex: i, statusUntil: until, signature: ed25519.sign(statusAttestationHash(tokenHash, i, until), secret(i))})

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('status attestation digest', () => {
  it('reproduces the cross-language vector byte for byte', () => {
    expect(hex(statusAttestationHash(bytes(32, 0x42), 7, 1_700_000_030)))
      .toBe('0xc0a7febf9ff7ee3201a9f676352bf3ae4fe83162861a5555701af207e0f91ab3')
    // Independent preimage: domain || token_hash || u32 BE || i64 BE.
    const pre = new Uint8Array([...new TextEncoder().encode(STATUS_ATTESTATION_DOMAIN), ...bytes(32, 0x42), 0, 0, 0, 7,
      0, 0, 0, 0, 0x65, 0x53, 0xf1, 0x1e])
    expect(hex(keccak_256(pre))).toBe('0xc0a7febf9ff7ee3201a9f676352bf3ae4fe83162861a5555701af207e0f91ab3')
    // Every input moves it.
    const base = hex(statusAttestationHash(bytes(32, 0x42), 7, 1_700_000_030))
    expect(hex(statusAttestationHash(bytes(32, 0x43), 7, 1_700_000_030))).not.toBe(base)
    expect(hex(statusAttestationHash(bytes(32, 0x42), 8, 1_700_000_030))).not.toBe(base)
    expect(hex(statusAttestationHash(bytes(32, 0x42), 7, 1_700_000_031))).not.toBe(base)
  })

  it('pins the reference constants and refuses out-of-range inputs', () => {
    expect([REVOCATION_BOUND_SECS, STATUS_SKEW_SECS, STATUS_CACHE_BOUND_SECS, MAX_STATUS_WINDOW_SECS, DEFAULT_STATUS_WINDOW_SECS, MAX_STATUS_ATTESTATIONS])
      .toEqual([60, 5, 55, 45, 30, 64])
    expect(STATUS_CACHE_BOUND_SECS + STATUS_SKEW_SECS).toBe(REVOCATION_BOUND_SECS)
    expect(() => statusAttestationHash(bytes(31, 1), 0, 0)).toThrow(/32 bytes/)
    expect(() => statusAttestationHash(bytes(32, 1), -1, 0)).toThrow(/u32/)
    expect(() => statusAttestationHash(bytes(32, 1), 2 ** 32, 0)).toThrow(/u32/)
    expect(() => statusAttestationHash(bytes(32, 1), 0, 2 ** 53)).toThrow(/safe integer/)
    // A negative i64 encodes as two's complement, as the reference does.
    expect(statusAttestationHash(bytes(32, 1), 0, -1)).toHaveLength(32)
  })

  it('verifies a single attestation only over its own token, index, window and key', () => {
    const token = bytes(32, 0x42), a = attest(3, token, 1_030)
    expect(verifyStatusAttestation(pub(3), token, a)).toBe(true)
    expect(verifyStatusAttestation(pub(4), token, a)).toBe(false)
    expect(verifyStatusAttestation(pub(3), bytes(32, 0x99), a)).toBe(false)
    expect(verifyStatusAttestation(pub(3), token, {...a, statusUntil: 1_031})).toBe(false)
    expect(verifyStatusAttestation(pub(3), token, {...a, verifierIndex: 4})).toBe(false)
    expect(verifyStatusAttestation(pub(3), token, {...a, signature: a.signature.slice(1)})).toBe(false)
    expect(verifyStatusAttestation(pub(3).slice(1), token, a)).toBe(false)
  })
})

describe('keeper-equivalent quorum check', () => {
  const token = bytes(32, 0x42)
  const set = {registrySize: 4, pubkeys: new Map([0, 1, 2, 3].map(i => [i, pub(i)] as const))}
  const check = (attestations: StatusAttestation[], counted: number[], quorum: number, now: number) =>
    verifyStatusAttestations({tokenHash: token, attestations, counted, set, quorum, now})

  it('returns the quorum-th largest deadline and applies only the 5 s skew', () => {
    const atts = [attest(0, token, 1_030), attest(1, token, 1_020), attest(2, token, 1_010)]
    expect(check(atts, [0, 1, 2], 2, 1_000)).toBe(1_020)
    expect(check(atts, [0, 1, 2], 3, 1_000)).toBe(1_010)
    expect(check(atts, [0, 1, 2], 3, 1_010 + STATUS_SKEW_SECS)).toBe(1_010)
    expect(() => check(atts, [0, 1, 2], 3, 1_010 + STATUS_SKEW_SECS + 1)).toThrow(/revocation_status_stale/)
  })

  it('refuses below quorum, bad counted signatures, duplicates and oversize lists; ignores non-counted junk', () => {
    expect(() => check([attest(0, token, 1_030)], [0, 1], 2, 1_000)).toThrow(/revocation_status_stale/)
    expect(() => check([attest(0, bytes(32, 0x99), 1_030), attest(1, token, 1_030)], [0, 1], 2, 1_000)).toThrow(/signature from verifier index 0/)
    expect(() => check([attest(0, token, 1_030), attest(0, token, 1_030)], [0], 1, 1_000)).toThrow(/duplicate/)
    expect(() => check(Array.from({length: 65}, () => attest(0, token, 1_030)), [0], 1, 1_000)).toThrow(/more than 64/)
    const junk = {...attest(3, token, 1_030), signature: bytes(64, 0)}
    expect(check([attest(0, token, 1_030), junk], [0], 1, 1_000)).toBe(1_030)
    expect(() => check([attest(0, token, 1_030), attest(3, token, 1_030)], [0, 1], 2, 1_000)).toThrow(/stale/)
    // A counted index the set does not know is a bad signature, not a skip.
    expect(() => verifyStatusAttestations({tokenHash: token, attestations: [attest(0, token, 1_030)], counted: [0],
      set: {registrySize: 1, pubkeys: new Map()}, quorum: 1, now: 1_000})).toThrow(/signature/)
  })
})

describe('wire validation and pass-through', () => {
  const hash = '0x' + '12'.repeat(32)
  const base = () => ({token_type: 'JWT', seed: hash, slot_id: hash, vp_hash: hash, holder_hash: hash, rule_hash: hash, epoch: 1,
    iat: 100, exp: 200, request_hash: hash, binding: 'holder_key', verifier_indexes: [0, 1, 2],
    signatures: [{verifier_index: 0, signature: '0x' + '34'.repeat(64)}, {verifier_index: 1, signature: '0x' + '35'.repeat(64)}]})
  const good = [{verifier_index: 0, status_until: 1_700_000_030, signature: '0x' + 'ab'.repeat(64)},
    {verifier_index: 1, status_until: 1_700_000_020, signature: '0x' + 'CD'.repeat(64)}]

  it('carries a well-formed list unchanged and normalizes null to absent', () => {
    const out = assertCompoundTokenWire({...base(), status_attestations: structuredClone(good)}, 's')
    expect(out.status_attestations).toEqual(good)
    expect(assertCompoundTokenWire({...base(), status_attestations: null}, 's')).not.toHaveProperty('status_attestations')
    expect(assertCompoundTokenWire(base(), 's')).not.toHaveProperty('status_attestations')
    expect(assertCompoundTokenWire({...base(), status_attestations: []}, 's').status_attestations).toEqual([])
  })

  it.each([
    ['not an array', {}],
    ['extra key', [{...good[0], extra: 1}]],
    ['missing key', [{verifier_index: 0, status_until: 1}]],
    ['string index', [{...good[0], verifier_index: '0'}]],
    ['negative index', [{...good[0], verifier_index: -1}]],
    ['index above u32', [{...good[0], verifier_index: 2 ** 32}]],
    ['fractional window', [{...good[0], status_until: 1.5}]],
    ['unsafe window', [{...good[0], status_until: 2 ** 53}]],
    ['string window', [{...good[0], status_until: '1700000030'}]],
    ['signature without 0x', [{...good[0], signature: 'ab'.repeat(64)}]],
    ['short signature', [{...good[0], signature: '0x' + 'ab'.repeat(63)}]],
    ['non-hex signature', [{...good[0], signature: '0x' + 'zz'.repeat(64)}]],
    ['duplicate index', [good[0], good[0]]],
    ['more entries than the draw', [...good, {...good[0], verifier_index: 2}, {...good[0], verifier_index: 3}]],
    ['null entry', [null]],
    ['array entry', [[0, 1, '0x']]],
  ])('rejects a malformed list: %s', (_name, value) => {
    expect(() => assertCompoundTokenWire({...base(), status_attestations: value}, 's')).toThrow(VerifierAgentSessionError)
    expect(() => assertStatusAttestationsWire(value, 3)).toThrow()
  })

  it('round-trips through decode/assemble and never moves the token hash (pinned vectors)', () => {
    type V = {token: Record<string, unknown> & {signing_hash: string}; token_scoped: Record<string, unknown> & {signing_hash: string}}
    const v = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'committee-token-vectors.json'), 'utf8')) as V
    for (const vector of [v.token, v.token_scoped]) {
      const {signing_hash, ...fields} = vector
      const plain = {...fields, signatures: []} as unknown as CompoundTokenWire
      const withAtt = {...plain, status_attestations: structuredClone(good)} as CompoundTokenWire
      expect(hex(compoundTokenHash(decodeCompoundToken(plain)))).toBe(signing_hash)
      const decoded = decodeCompoundToken(withAtt)
      expect(hex(compoundTokenHash(decoded))).toBe(signing_hash)
      expect(decoded.statusAttestations?.map(a => a.statusUntil)).toEqual([1_700_000_030, 1_700_000_020])
      const reassembled = assembleCompoundToken(decoded, decoded.signatures, decoded.statusAttestations)
      expect(reassembled.status_attestations).toEqual(good.map(a => ({...a, signature: a.signature.toLowerCase()})))
      expect(hex(compoundTokenHash(decodeCompoundToken(reassembled)))).toBe(signing_hash)
      expect(() => decodeCompoundToken({...plain, status_attestations: [{...good[0], extra: 1}]} as unknown as CompoundTokenWire)).toThrow()
    }
  })

  it('sends the attestations to the keeper unchanged inside committee_token', async () => {
    const token = {...base(), status_attestations: structuredClone(good)} as unknown as CompoundTokenWire
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('down', {status: 503}))
    await expect(committeeSign({nodeUrl: 'https://keeper.example', committeeToken: token, message: Uint8Array.of(1), fetchImpl})).rejects.toThrow()
    const sent = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body)) as {committee_token: CompoundTokenWire}
    expect(sent.committee_token.status_attestations).toEqual(good)
    expect(sent.committee_token).toEqual(token)
  })

  it('binds paid client approvals to the complete body including the attestations', async () => {
    const message = Uint8Array.of(1, 2, 3)
    const f = await keeperExecutionFixture('sign', toHex(sha256(message)))
    const token = {slot_id: f.payment.slot, payment: f.payment, payment_hash: paymentIntentHash(f.payment),
      status_attestations: structuredClone(good)} as unknown as CompoundTokenWire
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('fixture', {status: 503}))
    try {
      await expect(committeeSign({nodeUrl: 'https://keeper.example', committeeToken: token, message, fetchImpl, approveExecution: f.approveExecution})).rejects.toThrow()
      const sent = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body)) as Record<string, unknown> & {execution_authorizations: ExecutionAuthorization[]; committee_token: CompoundTokenWire}
      const {execution_authorizations: proofs, ...body} = sent
      expect(sent.committee_token.status_attestations).toEqual(good)
      for (const p of proofs) expect(p.body_hash).toBe(executionBodyHash(body))
      // The approval would not cover a body with the attestations removed or altered.
      const stripped = structuredClone(body)
      delete (stripped.committee_token as Partial<CompoundTokenWire>).status_attestations
      expect(executionBodyHash(stripped)).not.toBe(executionBodyHash(body))
      const moved = structuredClone(body)
      moved.committee_token.status_attestations![0]!.status_until += 1
      expect(executionBodyHash(moved)).not.toBe(executionBodyHash(body))
    } finally { f.signer.dispose() }
  })
})

describe('client-as-coordinator fan-out (gatherCommitteeToken)', () => {
  const registrySize = 5, committee = 3, quorum = 2
  const seed = bytes(32, 0xab), slotId = bytes(32, 0xcd), epoch = 7
  const drawn = selectVerifierCommittee(slotId, epoch, seed, registrySize, committee)
  const payload: CompoundTokenPayload = {tokenType: 'JWT', seed, epoch, slotId, vpHash: bytes(32, 0x11), holderHash: bytes(32, 0x1a),
    ruleHash: bytes(32, 0x22), verifierIndexes: drawn, iat: 1000, exp: 100_000}
  const tokenHash = compoundTokenHash(payload)
  type Mode = 'good' | 'none' | 'forged' | 'half' | 'bare-hex'
  function install(modes: Partial<Record<number, Mode>>) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const idx = Number(/verifier-(\d+)/.exec(String(url))?.[1] ?? -1)
      if (!drawn.includes(idx)) return new Response('not selected', {status: 403})
      const mode = modes[idx] ?? 'good', until = 2_000 + idx
      const sig = ed25519.sign(statusAttestationHash(mode === 'forged' ? bytes(32, 0x99) : tokenHash, idx, until), secret(idx))
      return Response.json({verifier_index: idx, token_hash: hex(tokenHash).slice(2), vp_hash: hex(payload.vpHash), holder_hash: hex(payload.holderHash),
        rule_hash: hex(payload.ruleHash), signature: hex(ed25519.sign(tokenHash, secret(idx))), committee_indexes: drawn,
        ...(mode === 'none' ? {} : mode === 'half' ? {status_until: until, status_signature: null}
          : {status_until: until, status_signature: mode === 'bare-hex' ? hex(sig).slice(2) : hex(sig)})})
    }))
  }
  const gather = (withKeys = true) => gatherCommitteeToken({
    verifiers: Array.from({length: registrySize}, (_, index) => ({index, url: `http://verifier-${index}`, ...(withKeys ? {pubkey: hex(pub(index))} : {})})),
    quorum, authorize: {holder: 'did:example:h', credentials: [], holderProof: '', tokenType: 'JWT', seed, epoch, slotId, registrySize, committee, iat: 1000, exp: 100_000},
  })

  it('emits authenticated attestations when every signer carries one', async () => {
    install({})
    const token = await gather()
    expect(token.status_attestations?.map(a => a.verifier_index).sort()).toEqual([...drawn].sort())
    const decoded = decodeCompoundToken(token)
    expect(hex(compoundTokenHash(decoded))).toBe(hex(tokenHash))
    const set = {registrySize, pubkeys: new Map(drawn.map(i => [i, pub(i)] as const))}
    expect(verifyStatusAttestations({tokenHash, attestations: decoded.statusAttestations!, counted: drawn, set, quorum, now: 2_000}))
      .toBe([...drawn].map(i => 2_000 + i).sort((a, b) => b - a)[quorum - 1])
  })

  it('accepts a bare-hex reply signature and re-emits it 0x-prefixed', async () => {
    install({[drawn[0]!]: 'bare-hex'})
    const token = await gather()
    expect(token.status_attestations?.every(a => /^0x[0-9a-f]{128}$/.test(a.signature))).toBe(true)
    expect(token.status_attestations).toHaveLength(committee)
  })

  it('omits the field below quorum (a partial list would make every keeper refuse)', async () => {
    install({[drawn[0]!]: 'none', [drawn[1]!]: 'none'})
    const token = await gather()
    expect(token.signatures).toHaveLength(committee)
    expect(token).not.toHaveProperty('status_attestations')
  })

  it('keeps exactly a quorum when one signer has none', async () => {
    install({[drawn[0]!]: 'none'})
    expect((await gather()).status_attestations).toHaveLength(quorum)
  })

  it('refuses a reply whose attestation is forged or half-present, as the verifier-agent does', async () => {
    install({[drawn[0]!]: 'forged'})
    let token = await gather()
    expect(token.signatures.map(s => s.verifier_index)).not.toContain(drawn[0])
    expect(token.status_attestations?.map(a => a.verifier_index)).not.toContain(drawn[0])
    install({[drawn[0]!]: 'half'})
    token = await gather()
    expect(token.signatures.map(s => s.verifier_index)).not.toContain(drawn[0])
    install({[drawn[0]!]: 'forged', [drawn[1]!]: 'half'})
    await expect(gather()).rejects.toBeInstanceOf(ThresholdNotMetError)
  })

  it('never relays an attestation it cannot authenticate (no committee key known)', async () => {
    install({})
    const token = await gather(false)
    expect(token.signatures).toHaveLength(committee)
    expect(token).not.toHaveProperty('status_attestations')
  })
})

describe('typed keeper refusal: present again', () => {
  const refusal = (code: string, pad = 0) => new Response(JSON.stringify({error: `${'x'.repeat(pad)}committee verifier set: revocation status freshness (${code}): present again for a fresh grant`}), {status: 403})

  it.each(['revocation_status_stale', 'revocation_status_missing'] as const)('classifies %s as a non-retryable RevocationStatusError', async code => {
    const e = await httpError(refusal(code, 300), 'https://keeper/v1/committee/sign', 'committee/sign')
    expect(e).toBeInstanceOf(RevocationStatusError)
    expect((e as RevocationStatusError).code).toBe(code)
    expect((e as RevocationStatusError).presentAgain).toBe(true)
    expect(e.status).toBe(403)
    expect(isRetryable(e)).toBe(false)
    expect(isRevocationStatusRefusal(e)).toBe(true)
    expect(isAuthDenied(e)).toBe(false)
    expect(e).not.toBeInstanceOf(AuthDeniedError)
    expect(e.body.length).toBeLessThanOrEqual(200)
  })

  it('leaves other 403s and non-403 bodies as before', async () => {
    const plain = await httpError(new Response('forbidden: rule mismatch', {status: 403}), 'u')
    expect(plain).toBeInstanceOf(AuthDeniedError)
    expect(isAuthDenied(plain)).toBe(true)
    expect(isRevocationStatusRefusal(plain)).toBe(false)
    const other = await httpError(new Response('revocation_status_stale', {status: 400}), 'u')
    expect(other).not.toBeInstanceOf(RevocationStatusError)
  })

  it('surfaces the typed error from committeeSign', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => refusal('revocation_status_stale'))
    const token = {slot_id: '0x' + '12'.repeat(32)} as CompoundTokenWire
    await expect(committeeSign({nodeUrl: 'https://keeper.example', committeeToken: token, message: Uint8Array.of(1), fetchImpl}))
      .rejects.toBeInstanceOf(RevocationStatusError)
  })

  it('surfaces it from IBE extraction when every keeper refused for revocation status', async () => {
    const token = {slot_id: '0x' + '12'.repeat(32)} as CompoundTokenWire
    const stale = vi.fn<typeof fetch>(async () => refusal('revocation_status_missing'))
    await expect(requestIbeExtractionPartials({nodeUrls: ['https://k1', 'https://k2'], committeeToken: token, identity: 'id', threshold: 2, fetchImpl: stale}))
      .rejects.toMatchObject({name: 'RevocationStatusError', code: 'revocation_status_missing'})
    const mixed = vi.fn<typeof fetch>(async url => String(url).includes('k1') ? refusal('revocation_status_stale') : new Response('down', {status: 503}))
    await expect(requestIbeExtractionPartials({nodeUrls: ['https://k1', 'https://k2'], committeeToken: token, identity: 'id', threshold: 2, fetchImpl: mixed}))
      .rejects.toBeInstanceOf(ThresholdNotMetError)
  })
})
