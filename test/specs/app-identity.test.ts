import {beforeEach, describe, expect, it, vi} from 'vitest'
import {createIdentity, credentialAuthorization, credentialPolicy, issueCredential, presentCredentials, verifyCredential} from '../../src/app/identity.js'
import {evaluate, validate, evaluateIdentityScoped} from '../../src/auth/oid4vp.js'
import {decodeJson, didJwk, jwkFromDid, signCompactJws, verifyCompactJws} from '../../src/oid4vp/jose.js'
import {issueSdJwtVc, parseSdJwt, sdJwtCredentialView, verifyKbJwt} from '../../src/oid4vp/sd-jwt.js'
import type {AuthorizationRequest} from '../../src/app/client.js'

const sessionMocks = vi.hoisted(() => ({open: vi.fn(), result: vi.fn()}))
vi.mock('../../src/oid4vp/verifier-agent.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/oid4vp/verifier-agent.js')>(),
  openVerifierAgentSession: sessionMocks.open, awaitVerifierAgentResult: sessionMocks.result,
}))
beforeEach(() => vi.clearAllMocks())

function fixture() {
  const issuer = createIdentity(), alice = createIdentity(), bob = createIdentity()
  const credential = issueCredential({issuer, holder: alice, type: 'TeamMember', claims: {role: 'editor', scopes: [`${issuer.did}/documents/*`]}, subject: 'did:demo:alice'})
  const rule = credentialPolicy({issuer, type: 'TeamMember', subjects: ['did:demo:alice'], claims: {role: ['editor']}})
  const verifier = createIdentity()
  const jar = signCompactJws({typ: 'oauth-authz-req+jwt', kid: verifier.issuer.kid}, {
    iss: verifier.did, client_id: `decentralized_identifier:${verifier.did}`, response_uri: 'https://verifier.example/response',
    nonce: 'unique-operation-nonce', state: 'state', exp: Math.floor(Date.now() / 1000) + 300, dcql_query: JSON.parse(rule) as unknown,
  }, verifier.issuer.signer)
  const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => init?.method === 'POST' ? Response.json({}) : new Response(jar))
  const request = {chainId: 43112, keyRegistry: `0x${'11'.repeat(20)}`, slotId: `0x${'22'.repeat(32)}`,
    action: 'sign', message: new Uint8Array([1, 2, 3]), description: 'Sign this document'} as AuthorizationRequest
  const signer = {address: `0x${'33'.repeat(20)}` as const, signTypedData: vi.fn()}
  sessionMocks.open.mockResolvedValue({qrPayload: 'https://verifier.example/request', sessionId: 'session'})
  sessionMocks.result.mockResolvedValue({token: {request_hash: 'request'}, verifierProofs: [{verifierIndex: 0}]})
  return {issuer, alice, bob, credential, rule, verifier, jar, fetchImpl, request, signer}
}

describe('SDK identities and credentials', () => {
  it.each(['Ed25519', 'P-256'] as const)('creates restorable %s identities, signs and clears only owned bytes', algorithm => {
    const seed = new Uint8Array(32).fill(7), original = seed.slice()
    const identity = createIdentity({algorithm, seed}), backup = identity.exportPrivateKey(), holder = identity.holder
    const restored = createIdentity({algorithm, seed: backup})
    expect(restored.did).toBe(identity.did)
    expect(identity.issuer.kid).toBe(`${identity.did}#0`)
    expect(didJwk(jwkFromDid(identity.did))).toBe(identity.did)
    const jwt = signCompactJws({}, {test: 'signed'}, identity.issuer.signer)
    expect(verifyCompactJws(jwt, identity.holder.publicJwk).payload).toEqual({test: 'signed'})
    expect(JSON.parse(JSON.stringify(identity))).toEqual({did: identity.did, algorithm})
    identity.destroy()
    expect(holder.privateKey).toEqual(new Uint8Array(32))
    expect(seed).toEqual(original)
    expect(backup).toEqual(original)
    expect(() => identity.exportPrivateKey()).toThrow('destroyed')
    expect(() => identity.holder).toThrow('destroyed')
    expect(() => identity.issuer).toThrow('destroyed')
  })

  it('issues credentials with issuer signature, subject, holder binding and selectively disclosed app claims', () => {
    const {issuer, alice, credential} = fixture()
    const parsed = parseSdJwt(credential)
    expect(parsed.payload.role).toBeUndefined()
    expect(verifyCredential(credential, {issuer, holder: alice, type: 'TeamMember', subject: 'did:demo:alice'})).toMatchObject({iss: issuer.did, cnf: {kid: `${alice.did}#0`}, role: 'editor'})
    expect(() => verifyCredential(credential, {holder: issuer})).toThrow('holder mismatch')
    expect(() => verifyCredential(credential, {issuer: alice})).toThrow('issuer mismatch')
    expect(() => verifyCredential(credential, {type: 'Administrator'})).toThrow('type mismatch')
    expect(() => verifyCredential(credential, {subject: 'did:demo:bob'})).toThrow('subject mismatch')
    expect(() => verifyCredential(credential, {nowSecs: parsed.payload.exp as number})).toThrow('expired')
    const malicious = issueSdJwtVc({issuer: {...alice.issuer, did: issuer.did, kid: `${issuer.did}#0`}, cnf: {kid: `${alice.did}#0`}, vct: 'TeamMember', claims: {role: 'editor'}})
    expect(() => verifyCredential(malicious, {issuer})).toThrow('signature')
  })

  it('rejects invalid keys, reserved claims, missing and invalid lifetimes and ambiguous disclosures', () => {
    const {issuer, alice} = fixture()
    expect(() => createIdentity({seed: new Uint8Array(31)})).toThrow('32 bytes')
    expect(() => createIdentity({algorithm: 'P-256', seed: new Uint8Array(32)})).toThrow()
    for (const claims of [{iss: alice.did}, {cnf: {}}, {exp: 9999999999}, {role: undefined}, {value: NaN}]) {
      expect(() => issueCredential({issuer, holder: alice, type: 'TeamMember', claims})).toThrow()
    }
    expect(() => issueCredential({issuer, holder: alice, type: '', claims: {}})).toThrow('type')
    expect(() => issueCredential({issuer, holder: alice, type: 'Member', claims: {}, ttlSecs: -1})).toThrow('ttlSecs')
    const reserved = issueSdJwtVc({issuer: issuer.issuer, cnf: {kid: `${alice.did}#0`}, vct: 'Member', claims: {iss: alice.did}})
    expect(() => verifyCredential(reserved)).toThrow('reserved disclosure')
    const credential = issueCredential({issuer, holder: alice, type: 'Member', claims: {role: 'editor'}})
    const parts = credential.split('~')
    expect(() => verifyCredential(`${parts[0]}~${parts[1]}~${parts[1]}~`)).toThrow('duplicate')
    const future = issueCredential({issuer, holder: alice, type: 'Member', claims: {}, nowSecs: Math.floor(Date.now() / 1000) + 60})
    expect(() => verifyCredential(future)).toThrow('issuance time')
    issuer.destroy()
    expect(() => issueCredential({issuer, holder: alice, type: 'Member', claims: {}})).toThrow('destroyed')
  })

  it('rejects issuer-signed credentials containing malformed or unsupported holder keys', () => {
    const {issuer} = fixture()
    for (const publicJwk of [
      {kty: 'OKP', crv: 'Ed25519', x: 'AA'},
      {kty: 'OKP', crv: 'Ed25519', x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'},
      {kty: 'OKP', crv: 'X25519', x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'},
      {kty: 'EC', crv: 'P-256', x: 'AA', y: 'AA'},
      {kty: 'EC', crv: 'P-256', x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', y: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'},
    ]) {
      const did = `did:jwk:${Buffer.from(JSON.stringify(publicJwk)).toString('base64url')}`
      const credential = issueSdJwtVc({issuer: issuer.issuer, cnf: {kid: `${did}#0`}, vct: 'Member', claims: {}})
      expect(() => verifyCredential(credential)).toThrow()
    }
    for (const algorithm of ['Ed25519', 'P-256'] as const) {
      const holder = createIdentity({algorithm})
      expect(verifyCredential(issueCredential({issuer, holder, type: 'Member', claims: {}}), {holder})).toMatchObject({cnf: {kid: `${holder.did}#0`}})
    }
  })

  it('pins issuer, credential type, subject and role in the committed policy', () => {
    const {issuer, alice, bob, credential, rule} = fixture()
    const view = (value: string) => sdJwtCredentialView(parseSdJwt(value))
    expect(evaluate(rule, [view(credential)])).toBe(true)
    for (const options of [{issuer: bob}, {type: 'Administrator'}, {subject: 'did:demo:bob'}, {claims: {role: 'viewer'}}]) {
      const wrong = issueCredential({issuer, holder: alice, type: 'TeamMember', claims: {role: 'editor'}, subject: 'did:demo:alice', ...options})
      expect(evaluate(rule, [view(wrong)])).toBe(false)
    }
    expect(() => credentialPolicy({issuer, type: 'TeamMember', subjects: []})).toThrow('nonempty')
    expect(() => credentialPolicy({issuer, type: 'TeamMember', claims: {iss: [bob.did]}})).toThrow('Reserved')
    expect(() => credentialPolicy({issuer, type: 'TeamMember', claims: {role: []}})).toThrow('allowed values')
  })

  it('makes document scope enforcement explicit and defaults it to the granting issuer namespace', () => {
    const {issuer, credential} = fixture()
    const rule = credentialPolicy({issuer, type: 'TeamMember', identityScope: {claim: 'scopes'}})
    expect(validate(rule).credentials[0]).toMatchObject({kk_identity_scope_claim: ['scopes'], kk_scope_namespace: 'issuer'})
    const view = sdJwtCredentialView(parseSdJwt(credential))
    expect(evaluateIdentityScoped(rule, [view], `${issuer.did}/documents/contract`)).toBe(true)
    expect(evaluateIdentityScoped(rule, [view], `${issuer.did}/payroll/record`)).toBe(false)
    expect(evaluateIdentityScoped(rule, [view], 'did:example:attacker/documents/contract')).toBe(false)
  })
})

describe('SDK credential presentations and operation authorization', () => {
  it('creates a real holder-signed presentation from a verified request and submits only requested claims', async () => {
    const {alice, credential, verifier, fetchImpl} = fixture()
    const result = await presentCredentials('https://verifier.example/request', alice, [credential], {fetchImpl})
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(verifyKbJwt(result.built.presentation, {nonce: 'unique-operation-nonce', aud: `decentralized_identifier:${verifier.did}`}).holderJwk).toEqual(alice.holder.publicJwk)
    expect(parseSdJwt(result.built.presentation).disclosures.map(d => d.name)).toEqual(['role'])
  })

  it('refuses stolen credentials before I/O and local policy mismatches before submission', async () => {
    const {alice, bob, issuer, credential, fetchImpl} = fixture()
    await expect(presentCredentials('https://verifier.example/request', bob, [credential], {fetchImpl})).rejects.toThrow('holder mismatch')
    expect(fetchImpl).not.toHaveBeenCalled()
    const wrong = issueCredential({issuer, holder: alice, type: 'TeamMember', subject: 'did:demo:bob', claims: {role: 'editor'}})
    await expect(presentCredentials('https://verifier.example/request', alice, [wrong], {fetchImpl})).rejects.toThrow('no held credential')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]![1]?.method).not.toBe('POST')
  })

  it('runs exact operation opening, presentation, polling and returns membership proofs', async () => {
    const {alice, credential, fetchImpl, signer, request} = fixture()
    const approve = vi.fn(() => true), onPhase = vi.fn(), signal = new AbortController().signal
    const authorize = credentialAuthorization({verifierAgentUrl: 'https://verifier.example/', identity: alice, credentials: [credential], signer, approve, onPhase, timeoutMs: 4000, presentation: {fetchImpl}})
    expect(await authorize({...request, signal})).toEqual({token: {request_hash: 'request'}, verifierProofs: [{verifierIndex: 0}]})
    expect(approve).toHaveBeenCalledWith({...request, signal})
    expect(sessionMocks.open).toHaveBeenCalledWith({...request, signal, verifierAgentUrl: 'https://verifier.example', signer, delegation: undefined})
    expect(sessionMocks.result).toHaveBeenCalledWith({qrPayload: 'https://verifier.example/request', sessionId: 'session'}, {signal, onPhase, timeoutMs: 4000})
  })

  it('honors consent and cancellation and never polls when presentation fails', async () => {
    const {alice, credential, fetchImpl, signer, request} = fixture()
    const config = {verifierAgentUrl: 'https://verifier.example', identity: alice, credentials: [credential], signer, presentation: {fetchImpl}}
    await expect(credentialAuthorization({...config, approve: () => false})(request)).rejects.toThrow('declined locally')
    expect(sessionMocks.open).not.toHaveBeenCalled()
    const controller = new AbortController(); controller.abort()
    await expect(credentialAuthorization(config)({...request, signal: controller.signal})).rejects.toThrow()
    expect(sessionMocks.open).not.toHaveBeenCalled()
    await expect(credentialAuthorization({...config, presentation: {fetchImpl, choose: () => undefined}})(request)).rejects.toThrow('declined')
    expect(sessionMocks.result).not.toHaveBeenCalled()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('prevents a session redirect or signed response URI from disclosing credentials to another origin', async () => {
    const {alice, credential, fetchImpl, signer, request, jar, verifier} = fixture()
    const config = {verifierAgentUrl: 'https://verifier.example', identity: alice, credentials: [credential], signer, presentation: {fetchImpl}}
    sessionMocks.open.mockResolvedValueOnce({qrPayload: 'https://attacker.example/request'})
    await expect(credentialAuthorization(config)(request)).rejects.toThrow('selected verifier origin')
    expect(fetchImpl).not.toHaveBeenCalled()
    const claims = decodeJson<Record<string, unknown>>(jar.split('.')[1]!)
    const redirected = signCompactJws({typ: 'oauth-authz-req+jwt', kid: verifier.issuer.kid}, {...claims, response_uri: 'https://attacker.example/response'}, verifier.issuer.signer)
    fetchImpl.mockResolvedValueOnce(new Response(redirected))
    await expect(credentialAuthorization(config)(request)).rejects.toThrow('selected verifier origin')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sessionMocks.result).not.toHaveBeenCalled()
    expect(fetchImpl.mock.calls[0]![1]?.redirect).toBe('error')
  })

  it('does not let an asynchronous consent callback change the signed operation bytes', async () => {
    const {alice, credential, fetchImpl, signer, request} = fixture()
    const approve = async (consent: AuthorizationRequest) => {
      consent.message!.fill(8)
      await Promise.resolve()
      request.message!.fill(9)
      return true
    }
    await credentialAuthorization({verifierAgentUrl: 'https://verifier.example', identity: alice, credentials: [credential], signer, approve, presentation: {fetchImpl}})(request)
    expect(sessionMocks.open.mock.calls[0]![0]).toMatchObject({message: new Uint8Array([1, 2, 3])})
  })

  it('stops before disclosure when the user cancels or destroys the key during wallet consent', async () => {
    const {alice, credential, fetchImpl} = fixture()
    const controller = new AbortController()
    await expect(presentCredentials('https://verifier.example/request', alice, [credential], {
      fetchImpl, signal: controller.signal, choose: plan => {controller.abort(); return plan.chosen},
    })).rejects.toThrow()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    fetchImpl.mockClear()
    await expect(presentCredentials('https://verifier.example/request', alice, [credential], {
      fetchImpl, choose: plan => {alice.destroy(); return plan.chosen},
    })).rejects.toThrow('destroyed')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rejects missing membership proofs and preserves server errors without retry or fallback', async () => {
    const {alice, credential, fetchImpl, signer, request} = fixture()
    const authorize = credentialAuthorization({verifierAgentUrl: 'https://verifier.example', identity: alice, credentials: [credential], signer, presentation: {fetchImpl}})
    sessionMocks.result.mockResolvedValueOnce({token: {}})
    await expect(authorize(request)).rejects.toThrow('membership proofs')
    const refusal = new Error('server refusal')
    sessionMocks.result.mockRejectedValueOnce(refusal)
    await expect(authorize(request)).rejects.toBe(refusal)
    expect(sessionMocks.open).toHaveBeenCalledTimes(2)
    expect(() => credentialAuthorization({verifierAgentUrl: 'http://public.example', identity: alice, credentials: [credential], signer})).toThrow('HTTPS')
  })
})
