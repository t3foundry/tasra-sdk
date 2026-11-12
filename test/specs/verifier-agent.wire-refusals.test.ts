// What the client refuses from a verifier-agent BEFORE anything is built on it: a compound token
// that is not the keepers' wire shape, a session reply that is not the session it asked for, a
// status reply that is not JSON or carries ciphertext without a token. Each refusal is checked for
// its kind and message, so a refusal that starts firing for a different reason fails the test.
import {afterEach, describe, expect, it, vi} from 'vitest'
import {sha256} from '@noble/hashes/sha256'
import {bytesToHex} from '../../src/crypto/hex.js'
import {
  VerifierAgentSessionError, assertCompoundTokenWire, createOauthSession, createOid4vpSession, parseVerifierAgentSessionStatus, payloadDigest,
  pollOid4vpSession, submitOauthResponse, type CreateSessionParams,
} from '../../src/verifier-agent/index.js'

const hash = '0x' + '12'.repeat(32)
const sig = (verifier_index: number) => ({verifier_index, signature: '0x' + '34'.repeat(64)})
const token = (): Record<string, unknown> => ({token_type: 'JWT', seed: hash, slot_id: hash, vp_hash: hash, holder_hash: hash, rule_hash: hash, epoch: 1, iat: 100, exp: 200,
  request_hash: hash, binding: 'holder_key', verifier_indexes: [0, 1], signatures: [sig(0)]})
const params = (): CreateSessionParams => ({
  operation: {chain_id: 43112, slot_id: hash, action: 'sign', payload_digest: hash, description: 'test', exp: 1060},
  operationSig: '0x' + '02'.repeat(65), messageHex: hash,
})
afterEach(() => vi.unstubAllGlobals())

function refusal(fn: () => unknown): {kind: string; message: string} | undefined {
  try { fn() } catch (e) {
    // The error appends the (truncated) session id; the refusal itself is the part before it.
    if (e instanceof VerifierAgentSessionError) return {kind: e.kind, message: e.message.replace(/ \(session [^)]*\)$/, '')}
    return {kind: 'other', message: String(e)}
  }
  return undefined
}

describe('assertCompoundTokenWire: the token is the keepers\' wire shape or it is refused as a protocol error', () => {
  const bad = (mutate: (t: Record<string, unknown>) => void) => { const t = token(); mutate(t); return refusal(() => assertCompoundTokenWire(t, 'session-1')) }

  it('accepts the baseline token (so each refusal below is caused by its one mutation)', () => {
    expect(assertCompoundTokenWire(token(), 'session-1')).toMatchObject({slot_id: hash, verifier_indexes: [0, 1]})
  })
  it('refuses a token that is not an object', () => {
    for (const raw of [null, 'token', [token()]]) expect(refusal(() => assertCompoundTokenWire(raw, 'session-1'))).toEqual({kind: 'protocol', message: 'compound_token: not an object'})
  })
  it('refuses each required hash, the token type and each time field by name', () => {
    expect(bad(t => { t.vp_hash = '0x12' })?.message).toBe('compound_token: vp_hash is not a 32-byte hex string')
    expect(bad(t => { delete t.rule_hash })?.message).toBe('compound_token: rule_hash is not a 32-byte hex string')
    expect(bad(t => { delete t.token_type })?.message).toBe('compound_token: token_type missing')
    expect(bad(t => { t.epoch = '1' })?.message).toBe('compound_token: epoch is not a number')
    expect(bad(t => { t.exp = Number.POSITIVE_INFINITY })?.message).toBe('compound_token: exp is not a number')
    expect(bad(t => { t.exp = 100 })?.message).toBe('compound_token: exp is not after iat')
  })
  it('refuses an unknown binding strength and a committee that is not an index list', () => {
    expect(bad(t => { t.binding = 'strong' })?.message).toBe('compound_token: binding is not a known strength')
    expect(bad(t => { t.verifier_indexes = [0, -1] })?.message).toBe('compound_token: verifier_indexes is not an index list')
    expect(bad(t => { t.verifier_indexes = 'all' })?.message).toBe('compound_token: verifier_indexes is not an index list')
  })
  it('refuses a token with no signatures, a malformed signature entry and a signer outside the committee', () => {
    expect(bad(t => { t.signatures = [] })?.message).toBe('compound_token: signatures missing')
    expect(bad(t => { t.signatures = [null] })?.message).toBe('compound_token: a signature entry is not {verifier_index, signature}')
    expect(bad(t => { t.signatures = [{verifier_index: 0, signature: 7}] })?.message).toBe('compound_token: a signature entry is not {verifier_index, signature}')
    expect(bad(t => { t.signatures = [sig(5)] })?.message).toBe('compound_token: a signature entry names an index outside the committee')
  })
  it('refuses a partial or malformed sealed-evidence binding (all three fields or none)', () => {
    expect(bad(t => { t.evidence_hash = hash })?.message).toBe('compound_token: evidence_hash, evidence_key_id and evidence_signatures come together or not at all')
    expect(bad(t => { Object.assign(t, {evidence_hash: '0x00', evidence_key_id: hash, evidence_signatures: [sig(0)]}) })?.message).toBe('compound_token: evidence_hash is not a 32-byte hex string')
    expect(bad(t => { Object.assign(t, {evidence_hash: hash, evidence_key_id: hash, evidence_signatures: []}) })?.message).toBe('compound_token: evidence_signatures missing')
    expect(bad(t => { Object.assign(t, {evidence_hash: hash, evidence_key_id: hash, evidence_signatures: [sig(9)]}) })?.message)
      .toBe('compound_token: a evidence signature entry names an index outside the committee')
    // More evidence signatures than committee members: the shape passes, the binding check refuses it.
    expect(bad(t => { Object.assign(t, {evidence_hash: hash, evidence_key_id: hash, evidence_signatures: [sig(0), sig(1), sig(0)]}) })?.message)
      .toBe('compound_token: invalid sealed evidence binding')
  })
})

describe('payloadDigest', () => {
  it('hashes the message bytes for sign and ibe-extract, with or without the 0x prefix', () => {
    const expected = '0x' + bytesToHex(sha256(new Uint8Array([1, 2, 255]))).replace(/^0x/, '')
    expect(payloadDigest('sign', '0x0102ff')).toBe(expected)
    expect(payloadDigest('ibe-extract', '0102ff')).toBe(expected)
    expect(payloadDigest('sign', '0x')).toBe('0x' + bytesToHex(sha256(new Uint8Array())).replace(/^0x/, ''))
  })
  it('refuses to guess a digest for any other action', () => {
    expect(() => payloadDigest('decrypt', '0x01')).toThrow('payloadDigest not implemented for action "decrypt"')
  })
})

describe('session creation refuses a reply that is not the session it asked for', () => {
  const stub = (reply: Response) => { const fetch = vi.fn(async () => reply.clone()); vi.stubGlobal('fetch', fetch); return fetch }
  const wallet = {session_id: 'id', poll_secret: 'secret', qr_payload: 'openid4vp://test', request_uri: 'https://test/request'}
  const oauth = {session_id: 'id', poll_secret: 'secret', nonce: 'nonce', dpop_htu: 'https://test/v1/sessions/id/oauth-response', platform_audience: 'https://test/authz/43112'}

  it('wallet: carries the HTTP status and body of a refusal', async () => {
    stub(new Response('slot not found', {status: 404}))
    await expect(createOid4vpSession('https://test', params())).rejects.toThrow('createOid4vpSession failed (404): slot not found')
  })
  it('wallet: refuses a reply missing a credential or carrying a non-openid4vp QR', async () => {
    stub(Response.json({...wallet, poll_secret: ''}))
    await expect(createOid4vpSession('https://test', params())).rejects.toThrow('createOid4vpSession: reply lacks poll_secret')
    stub(Response.json({...wallet, qr_payload: 'https://phish.example/'}))
    await expect(createOid4vpSession('https://test', params())).rejects.toThrow('createOid4vpSession: qr_payload is not an openid4vp:// request')
    stub(Response.json(wallet))
    await expect(createOid4vpSession('https://test/', params())).resolves.toEqual({sessionId: 'id', pollSecret: 'secret', qrPayload: 'openid4vp://test', requestUri: 'https://test/request'})
  })
  it('oauth: carries a refusal, refuses a missing nonce and a wallet-session reply from an older agent', async () => {
    stub(new Response('bad kind', {status: 400}))
    await expect(createOauthSession('https://test', params())).rejects.toThrow('createOauthSession failed (400): bad kind')
    stub(Response.json({...oauth, nonce: undefined}))
    await expect(createOauthSession('https://test', params())).rejects.toThrow('createOauthSession: reply lacks nonce')
    stub(Response.json({...oauth, qr_payload: 'openid4vp://test'}))
    await expect(createOauthSession('https://test', params())).rejects.toThrow(/returned a wallet session/)
  })
  it('oauth: refuses a reply that moved the DPoP target or the platform audience', async () => {
    stub(Response.json({...oauth, dpop_htu: 'https://elsewhere/v1/sessions/id/oauth-response'}))
    await expect(createOauthSession('https://test', params())).rejects.toThrow('createOauthSession: reply changed the original session target or audience')
    stub(Response.json({...oauth, platform_audience: 'https://test/authz/1'}))
    await expect(createOauthSession('https://test', params())).rejects.toThrow('createOauthSession: reply changed the original session target or audience')
  })
})

describe('submitOauthResponse answers ONE DPoP nonce challenge', () => {
  const args = (proof: ReturnType<typeof vi.fn>) => ({sessionId: 'id', pollSecret: 'secret', accessToken: 'at', nonce: 'n0', dpopHtu: 'https://test/v1/sessions/id/oauth-response',
    signer: {proof} as unknown as Parameters<typeof submitOauthResponse>[1]['signer']})

  it('re-mints the proof with the server nonce and resends once', async () => {
    const proof = vi.fn(async ({nonce}: {nonce: string}) => `proof-${nonce}`)
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', {status: 401, headers: {'DPoP-Nonce': 'n1', 'WWW-Authenticate': 'DPoP error="use_dpop_nonce"'}}))
      .mockResolvedValueOnce(new Response(null, {status: 204}))
    vi.stubGlobal('fetch', fetch)
    await submitOauthResponse('https://test/', args(proof))
    expect(proof.mock.calls.map(c => c[0].nonce)).toEqual(['n0', 'n1'])
    expect(fetch).toHaveBeenCalledTimes(2)
    expect((fetch.mock.calls[1]![1] as RequestInit).headers).toMatchObject({DPoP: 'proof-n1', Authorization: 'DPoP at', 'X-Poll-Secret': 'secret'})
  })
  it('does not retry a 401 that is not a nonce challenge, and reports it as a protocol error', async () => {
    const proof = vi.fn(async () => 'proof')
    const fetch = vi.fn().mockResolvedValue(new Response('bad token', {status: 401, headers: {'DPoP-Nonce': 'n1', 'WWW-Authenticate': 'DPoP error="invalid_token"'}}))
    vi.stubGlobal('fetch', fetch)
    await expect(submitOauthResponse('https://test', args(proof))).rejects.toMatchObject({kind: 'protocol', httpStatus: 401})
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('a second challenge is not answered again: one retry, then the failure', async () => {
    const proof = vi.fn(async () => 'proof')
    const challenge = () => new Response('', {status: 401, headers: {'DPoP-Nonce': 'n1', 'WWW-Authenticate': 'DPoP error="use_dpop_nonce"'}})
    const fetch = vi.fn().mockImplementation(async () => challenge())
    vi.stubGlobal('fetch', fetch)
    await expect(submitOauthResponse('https://test', args(proof))).rejects.toMatchObject({kind: 'protocol', httpStatus: 401})
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('session status refusals', () => {
  it('a reply that is not JSON is a protocol error, not a pending session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', {status: 200})))
    const poll = pollOid4vpSession('https://test', 'id', 'secret')
    await expect(poll).rejects.toThrow('poll: reply is not JSON (session id')
    await expect(poll).rejects.toMatchObject({kind: 'protocol'})
  })
  it('an already-aborted signal is cancelled before any request is sent', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const controller = new AbortController(); controller.abort()
    await expect(pollOid4vpSession('https://test', 'id', 'secret', {signal: controller.signal})).rejects.toMatchObject({kind: 'cancelled'})
    expect(fetch).not.toHaveBeenCalled()
  })
  it('a reply that does not arrive within the per-request timeout is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    })))
    const poll = pollOid4vpSession('https://test', 'id', 'secret', {timeoutMs: 5})
    await expect(poll).rejects.toThrow('poll: no reply within 5 ms')
    await expect(poll).rejects.toMatchObject({kind: 'unavailable'})
  })
  it('refuses a non-string error and ciphertext that arrives without a token', () => {
    expect(refusal(() => parseVerifierAgentSessionStatus({status: 'failed', error: {code: 1}}, 'id'))).toEqual({kind: 'protocol', message: 'poll: error is not a string'})
    expect(refusal(() => parseVerifierAgentSessionStatus({status: 'pending', evidence_ct: 'AAAA'}, 'id'))).toEqual({kind: 'protocol', message: 'poll: invalid sealed evidence'})
    expect(parseVerifierAgentSessionStatus({status: 'pending', error: null}, 'id')).toMatchObject({status: 'pending', phase: 'awaiting_wallet'})
  })
})
