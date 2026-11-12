// The OAuth+DPoP holder strategy of drivePaidSession (ADR-0073): the client presents a DPoP-bound
// access token itself. What these pin: the exact presentation is journaled BEFORE its one
// submission; a resume never asks for another token, never builds another proof and never sends
// a presentation whose outcome is unknown; only a provably unprocessed one (a paced 429 run out)
// goes out again, byte-identical; and the token never appears in an error.
import {expect, it, vi} from 'vitest'
import type {Hex} from 'viem'
import {drivePaidSession, PaidSessionRecoveryError, type PaidSessionHolder} from '../../src/app/paid-session.js'
import {createMemoryStore} from '../../src/app/memory-store.js'
import {PaidAgentControlError, type ClientApprovedPresentation, type PaidAgentProposal, type RegisteredPaidAgentSession} from '../../src/chain/registeredPaidAgent.js'
import {PaidBackoffError} from '../../src/errors.js'
import type {DpopSigner} from '../../src/auth/dpop.js'

const TOKEN = 'eyJhbGciOiJFUzI1NiJ9.eyJzZWNyZXQtYWNjZXNzLXRva2VuIjp0cnVlfQ.c2ln'
const PROOF = 'eyJ0eXAiOiJkcG9wK2p3dCJ9.eyJwcm9vZiI6MX0.c2ln'

function fixture() {
  const id = 'ab'.repeat(32), key = ('0x' + 'cd'.repeat(32)) as Hex, store = createMemoryStore(), calls: string[] = []
  const flags = {sent: false, selected: false, approved: false, done: false}
  let proofs = 0
  const approvedFor = (proof: string): ClientApprovedPresentation => ({holder: '', credentials: [], holder_proof: null,
    oauth: {access_token: TOKEN, dpop_proof: proof, session_id: id}, iat: 1000})
  let submitted: ClientApprovedPresentation | undefined
  const proposal: PaidAgentProposal = {id: 'ef'.repeat(32), stage: 'credential', operator_key: key, unsigned_body: {stage: 'credential'}, expires: 1030}
  const session = {
    sessionId: id, paymentHash: key, initialization: {expires: 1030},
    oauthContext: {nonce: 'derived-nonce', dpopHtu: 'https://agent.example/v1/sessions/' + id + '/oauth-response', platformAudience: 'https://agent.example/authz/43112'},
    create: vi.fn(async () => { calls.push('create') }),
    reconcile: vi.fn(async () => { calls.push('reconcile'); return {status: 'pending', phase: 'awaiting_wallet'} }),
    requestObject: vi.fn(async () => { throw new Error('OAuth sessions have no wallet request object') }),
    prepareOAuthPresentation: vi.fn(async (token: string, signer: DpopSigner) => {
      // Each call mints a NEW proof (a fresh jti): a second presentation would be different bytes.
      await signer.proof({htm: 'POST', htu: 'x', nonce: 'derived-nonce', accessToken: token})
      return approvedFor(PROOF.replace('MX0', 'M' + (++proofs) + '0'))
    }),
    submitOAuthPresentation: vi.fn(async (approved: ClientApprovedPresentation) => {
      calls.push('submit'); submitted = structuredClone(approved); flags.sent = true
    }),
    proposals: vi.fn(async () => flags.selected && !flags.approved ? [proposal] : []),
    approveCredentials: vi.fn(async () => { calls.push('credential'); flags.approved = true }),
    presentations: vi.fn(async () => flags.sent && submitted ? [{id: '23'.repeat(32), presentation: structuredClone(submitted), expires: 1030, selected: flags.selected}] : []),
    resumePresentation: vi.fn(async () => {
      calls.push('resume'); flags.selected = true
      if (!flags.approved) throw new PaidAgentControlError(id, 425)
      flags.done = true
    }),
    poll: vi.fn(async () => ({status: flags.done ? 'done' as const : 'pending' as const, phase: flags.done ? 'done' as const : 'awaiting_wallet' as const})),
  } as unknown as RegisteredPaidAgentSession
  const members = [{index: 0, operator: ('0x' + '11'.repeat(20)) as Hex, publicKey: key, proof: []}]
  const signer: DpopSigner = {proof: vi.fn(async () => 'unused')}
  const credential = vi.fn(async () => ({accessToken: TOKEN, signer}))
  const holder: PaidSessionHolder = {kind: 'oauth', credential}
  const base = {session, store, members, holder, signal: new AbortController().signal, wait: vi.fn(async () => {})}
  const presentationKey = 'wallet-' + id + '-presentation'
  return {id, store, session, base, calls, flags, credential, presentationKey, submitted: () => submitted, setSubmitted: (a: ClientApprovedPresentation) => { submitted = a }}
}

it('completes a paid OAuth session: one token, one journaled presentation, credential work on it, no request object', async () => {
  const f = fixture()
  let journaledBeforeSend: unknown
  vi.mocked(f.session.submitOAuthPresentation).mockImplementationOnce(async approved => {
    journaledBeforeSend = await f.store.load(f.presentationKey)
    f.calls.push('submit'); f.setSubmitted(structuredClone(approved)); f.flags.sent = true
  })
  expect((await drivePaidSession(f.base)).status).toBe('done')
  expect(f.calls).toEqual(['create', 'submit', 'resume', 'credential', 'resume'])
  expect(f.session.requestObject).not.toHaveBeenCalled()
  expect(f.credential).toHaveBeenCalledTimes(1)
  // The holder learns exactly the public values its token and proof must bind.
  expect(f.credential).toHaveBeenCalledWith({sessionId: f.id, nonce: 'derived-nonce', dpopHtu: f.session.oauthContext.dpopHtu, platformAudience: f.session.oauthContext.platformAudience})
  // The exact presentation was durable (prepared) before it was sent, and is what credential consent binds.
  expect(journaledBeforeSend).toEqual({phase: 'prepared', original: {oauth: f.submitted()}})
  expect(vi.mocked(f.session.approveCredentials).mock.calls[0]![2]).toEqual(f.submitted())
  expect(await f.store.load(f.presentationKey)).toEqual({phase: 'confirmed', original: {oauth: f.submitted()}})
})

it('a lost submission reply is confirmed on resume only by the agent holding exactly that presentation; nothing is sent again', async () => {
  const f = fixture()
  vi.mocked(f.session.submitOAuthPresentation).mockImplementationOnce(async approved => {
    // Processed, reply lost.
    f.setSubmitted(structuredClone(approved)); f.flags.sent = true
    throw new Error('socket hang up')
  })
  await expect(drivePaidSession(f.base)).rejects.toThrow('socket hang up')
  expect(await f.store.load(f.presentationKey)).toMatchObject({phase: 'prepared'})
  // Without resume the retained write refuses.
  await expect(drivePaidSession(f.base)).rejects.toBeInstanceOf(PaidSessionRecoveryError)
  expect((await drivePaidSession({...f.base, resume: true})).status).toBe('done')
  expect(f.session.submitOAuthPresentation).toHaveBeenCalledTimes(1)
  expect(f.credential).toHaveBeenCalledTimes(1)
  expect(f.session.prepareOAuthPresentation).toHaveBeenCalledTimes(1)
  expect(vi.mocked(f.session.approveCredentials).mock.calls[0]![2]).toEqual(f.submitted())
})

it('an unknown submission the agent does not show stays unresolved: resume refuses without a new token, proof or send', async () => {
  const f = fixture()
  vi.mocked(f.session.submitOAuthPresentation).mockRejectedValueOnce(new Error('timeout'))
  await expect(drivePaidSession(f.base)).rejects.toThrow('timeout')
  for (let i = 0; i < 2; i++) {
    const error = await drivePaidSession({...f.base, resume: true}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PaidSessionRecoveryError)
    expect((error as PaidSessionRecoveryError).key).toBe(f.presentationKey)
    // Neither the access token nor its proof is ever part of an error.
    expect(JSON.stringify({message: (error as Error).message, key: (error as PaidSessionRecoveryError).key})).not.toContain(TOKEN)
  }
  expect(f.session.submitOAuthPresentation).toHaveBeenCalledTimes(1)
  expect(f.credential).toHaveBeenCalledTimes(1)
  expect(f.session.prepareOAuthPresentation).toHaveBeenCalledTimes(1)
  expect(f.session.approveCredentials).not.toHaveBeenCalled()
})

it('a paced 429 that ran out is journaled unsent and resent on resume with the SAME bytes, never a new token or proof', async () => {
  const f = fixture()
  vi.mocked(f.session.submitOAuthPresentation).mockRejectedValueOnce(new PaidBackoffError({code: 'deadline_exceeded', route: 'POST /v1/sessions/{id}/oauth-response', httpStatus: 429, attempts: 1}))
  await expect(drivePaidSession(f.base)).rejects.toBeInstanceOf(PaidBackoffError)
  const kept = await f.store.load<{phase: string; original: {oauth: ClientApprovedPresentation}}>(f.presentationKey)
  expect(kept?.phase).toBe('unsent')
  expect((await drivePaidSession({...f.base, resume: true})).status).toBe('done')
  const sent = vi.mocked(f.session.submitOAuthPresentation).mock.calls.map(c => c[0])
  expect(sent).toHaveLength(2)
  expect(sent[1]).toEqual(sent[0])
  expect(sent[1]).toEqual(kept!.original.oauth)
  expect(f.credential).toHaveBeenCalledTimes(1)
  expect(f.session.prepareOAuthPresentation).toHaveBeenCalledTimes(1)
})

it('any other refusal after a send leaves the presentation unresolved (prepared), not resendable', async () => {
  const f = fixture()
  vi.mocked(f.session.submitOAuthPresentation).mockRejectedValueOnce(new PaidAgentControlError(f.id, 503))
  await expect(drivePaidSession(f.base)).rejects.toBeInstanceOf(PaidAgentControlError)
  expect(await f.store.load(f.presentationKey)).toMatchObject({phase: 'prepared'})
  await expect(drivePaidSession({...f.base, resume: true})).rejects.toBeInstanceOf(PaidSessionRecoveryError)
  expect(f.session.submitOAuthPresentation).toHaveBeenCalledTimes(1)
})

it('a definite refusal of the session is reported as the session refusal, once', async () => {
  const f = fixture()
  vi.mocked(f.session.submitOAuthPresentation).mockImplementationOnce(async () => {
    vi.mocked(f.session.poll).mockResolvedValue({status: 'failed', phase: 'failed', error: 'DPoP proof jwk is not the key the access token is bound to'})
    throw new PaidAgentControlError(f.id, 400)
  })
  await expect(drivePaidSession(f.base)).rejects.toMatchObject({name: 'VerifierAgentSessionError', kind: 'refused'})
  expect(f.session.submitOAuthPresentation).toHaveBeenCalledTimes(1)
  expect(f.session.approveCredentials).not.toHaveBeenCalled()
})

it('concurrent resumes of one session send its presentation once', async () => {
  const f = fixture()
  // Crash after creation: nothing presented yet; two processes resume together.
  vi.mocked(f.session.submitOAuthPresentation).mockImplementation(async approved => {
    await new Promise(resolve => setTimeout(resolve, 20))
    f.calls.push('submit'); f.setSubmitted(structuredClone(approved)); f.flags.sent = true
  })
  vi.mocked(f.session.submitOAuthPresentation).mockImplementationOnce(async () => { throw new PaidBackoffError({code: 'no_time_to_send', route: 'r', attempts: 0}) })
  await expect(drivePaidSession(f.base)).rejects.toBeInstanceOf(PaidBackoffError)
  const results = await Promise.allSettled([drivePaidSession({...f.base, resume: true}), drivePaidSession({...f.base, resume: true})])
  // One resume resent the unsent original; the other found it in flight (prepared) and refused, or
  // continued once the first confirmed it. Either way the presentation went out once more, not twice.
  expect(vi.mocked(f.session.submitOAuthPresentation).mock.calls.length).toBe(2)
  expect(results.some(r => r.status === 'fulfilled')).toBe(true)
  for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(PaidSessionRecoveryError)
  expect(f.credential).toHaveBeenCalledTimes(1)
})

it('a retained presentation of another session is refused before any read or send', async () => {
  const f = fixture()
  await f.store.save(f.presentationKey, {phase: 'confirmed', original: {oauth: {holder: '', credentials: [], holder_proof: null,
    oauth: {access_token: TOKEN, dpop_proof: PROOF, session_id: 'ff'.repeat(32)}, iat: 1000}}})
  await f.store.save('wallet-' + f.id + '-create', {phase: 'confirmed', original: {sessionId: f.id, paymentHash: f.session.paymentHash, initialization: f.session.initialization}})
  await expect(drivePaidSession({...f.base, resume: true})).rejects.toBeInstanceOf(PaidSessionRecoveryError)
  expect(f.session.submitOAuthPresentation).not.toHaveBeenCalled()
  expect(f.credential).not.toHaveBeenCalled()
})

it('an expired retained presentation is never refreshed: credential work refuses and no new token is requested', async () => {
  const f = fixture()
  vi.mocked(f.session.approveCredentials).mockRejectedValue(new Error('Original credential presentation expired'))
  await expect(drivePaidSession(f.base)).rejects.toThrow('Original credential presentation expired')
  await expect(drivePaidSession({...f.base, resume: true})).rejects.toThrow()
  expect(f.credential).toHaveBeenCalledTimes(1)
  expect(f.session.submitOAuthPresentation).toHaveBeenCalledTimes(1)
})

it('the wallet holders are unchanged: an OAuth session context is never asked of them', async () => {
  const f = fixture()
  const accept = vi.fn(async () => true)
  // An external wallet on this OAuth-shaped double still goes through the request object (and fails there).
  await expect(drivePaidSession({...f.base, holder: {kind: 'external', present: vi.fn(), accept}})).rejects.toThrow('OAuth sessions have no wallet request object')
  expect(f.session.prepareOAuthPresentation).not.toHaveBeenCalled()
})
