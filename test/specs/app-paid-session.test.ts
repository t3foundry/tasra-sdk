import {expect, it, vi} from 'vitest'
import type {Hex} from 'viem'
import {drivePaidSession, PaidSessionRecoveryError, type PaidWalletPresentation} from '../../src/app/paid-session.js'
import {createMemoryStore} from '../../src/app/memory-store.js'
import {PaidAgentControlError, type RegisteredPaidAgentSession, type PaidAgentProposal} from '../../src/chain/registeredPaidAgent.js'
import type {VerifiedRequestObject} from '../../src/oid4vp/request-object.js'
import {VerifierAgentSessionError} from '../../src/verifier-agent/index.js'

function fixture() {
  const id = 'ab'.repeat(32), key = ('0x' + 'cd'.repeat(32)) as Hex, store = createMemoryStore(), calls: string[] = []
  const request = {claims: {nonce: 'original-nonce'}} as VerifiedRequestObject
  const presentation: PaidWalletPresentation = {approved: {holder: 'h', credentials: ['a.b.c'], holder_proof: null, oauth: null, iat: 1000}, form: {response: 'jwe'}}
  let jar = false, sent = false, selected = false, approved = false, done = false
  const proposal = (stage: PaidAgentProposal['stage']): PaidAgentProposal => ({id: 'ef'.repeat(32), stage, operator_key: key, unsigned_body: {stage}, expires: 1030})
  const session = {
    sessionId: id, paymentHash: key, initialization: {expires: 1030},
    create: vi.fn(async () => { calls.push('create') }), reconcile: vi.fn(async () => { calls.push('reconcile'); return {status: 'pending'} }),
    requestObject: vi.fn(async () => { if (!jar) throw new PaidAgentControlError(id, 425, 5); return {request, requestUri: 'https://agent.example/v1/request/' + id, qrPayload: 'openid4vp://?x'} }),
    proposals: vi.fn(async () => !jar ? [proposal('presentation_sign')] : selected && !approved ? [proposal('credential')] : []),
    approveRequest: vi.fn(async () => { jar = true; calls.push('jar') }),
    approveCredentials: vi.fn(async () => { approved = true; calls.push('credential') }),
    presentations: vi.fn(async () => sent ? [{id: '23'.repeat(32), presentation: structuredClone(presentation.approved), expires: 1030, selected}] : []),
    resumePresentation: vi.fn(async () => { calls.push('resume'); selected = true; if (!approved) throw new PaidAgentControlError(id, 425); done = true }),
    poll: vi.fn(async () => ({status: done ? 'done' as const : 'pending' as const, phase: done ? 'done' as const : 'awaiting_wallet' as const})),
  } as unknown as RegisteredPaidAgentSession
  const members = [{index: 0, operator: ('0x' + '11'.repeat(20)) as Hex, publicKey: key, proof: []}]
  const waits: (number | undefined)[] = []
  const base = {session, store, members, signal: new AbortController().signal, wait: vi.fn(async (hint?: number) => {
    // A drive that keeps sleeping without progress is a defect, never a slow agent: stop it.
    if (waits.push(hint) > 50) throw new Error('drive kept waiting without progress')
  })}
  return {id, store, session, base, calls, presentation, waits, wallet: () => { sent = true }}
}

it.each([400, 409])('confirms terminal refusal after callback HTTP %s without repeating paid work', async httpStatus => {
  const f = fixture()
  const holder = {kind: 'local' as const, makePresentation: vi.fn(() => structuredClone(f.presentation)), submit: vi.fn(async () => {f.wallet()})}
  vi.mocked(f.session.resumePresentation).mockImplementationOnce(async () => {
    vi.mocked(f.session.poll).mockResolvedValue({status: 'failed', phase: 'failed'})
    throw new PaidAgentControlError(f.id, httpStatus)
  })
  const error = await drivePaidSession({...f.base, holder}).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(VerifierAgentSessionError)
  expect(error).toMatchObject({kind: 'refused'})
  expect(f.session.resumePresentation).toHaveBeenCalledTimes(1)
  expect(f.session.poll).toHaveBeenCalledTimes(3)
  expect(f.session.approveCredentials).not.toHaveBeenCalled()
  expect(f.session.create).toHaveBeenCalledTimes(1)
  expect(holder.submit).toHaveBeenCalledTimes(1)
})

it.each(['pending', 'done', 'foreign-session', 'unavailable'] as const)('does not infer credential refusal from a callback HTTP 400: %s', async outcome => {
  const f = fixture()
  const holder = {kind: 'local' as const, makePresentation: () => structuredClone(f.presentation), submit: async () => {f.wallet()}}
  const callbackError = new PaidAgentControlError(outcome === 'foreign-session' ? 'ff'.repeat(32) : f.id, 400)
  const readError = new Error('original session unavailable')
  vi.mocked(f.session.resumePresentation).mockImplementationOnce(async () => {
    if (outcome === 'unavailable') vi.mocked(f.session.poll).mockRejectedValue(readError)
    else vi.mocked(f.session.poll).mockResolvedValue({status: outcome === 'foreign-session' ? 'failed' : outcome,
      phase: outcome === 'foreign-session' ? 'failed' : outcome === 'done' ? 'done' : 'awaiting_wallet'})
    throw callbackError
  })
  await expect(drivePaidSession({...f.base, holder})).rejects.toBe(outcome === 'unavailable' ? readError : callbackError)
  expect(f.session.resumePresentation).toHaveBeenCalledTimes(1)
  expect(f.session.poll).toHaveBeenCalledTimes(outcome === 'foreign-session' ? 2 : 3)
  expect(f.session.approveCredentials).not.toHaveBeenCalled()
})

it('drives an external wallet: shows the request, lets the client accept the retained body, then approves its work', async () => {
  const f = fixture()
  const present = vi.fn(() => { f.wallet() }), accept = vi.fn(async () => true)
  expect((await drivePaidSession({...f.base, holder: {kind: 'external', present, accept}})).status).toBe('done')
  expect(present).toHaveBeenCalledWith(expect.objectContaining({qrPayload: 'openid4vp://?x'}))
  expect(accept).toHaveBeenCalledTimes(1)
  expect(vi.mocked(f.session.approveCredentials).mock.calls[0]![2]).toEqual(f.presentation.approved)
  expect(f.calls).toEqual(['create', 'jar', 'resume', 'credential', 'resume'])
  // Approved proposals and sent continuations are read back at once, never after a sleep.
  expect(f.waits).toEqual([])
})

it('fetches the request object again at once after approving 425 proposals; uses the agent hint only when nothing was approved', async () => {
  const f = fixture()
  const holder = {kind: 'local' as const, makePresentation: () => structuredClone(f.presentation), submit: async () => {f.wallet()}}
  // First 425: the agent lists nothing to approve yet, so the consent wait uses its Retry-After hint.
  vi.mocked(f.session.proposals).mockResolvedValueOnce([])
  expect((await drivePaidSession({...f.base, holder})).status).toBe('done')
  expect(f.waits).toEqual([5])
  expect(f.session.requestObject).toHaveBeenCalledTimes(3)
  expect(f.calls).toEqual(['create', 'jar', 'resume', 'credential', 'resume'])
})

it('holds one status poll while committee work is in flight and continues on its answer', async () => {
  const f = fixture()
  const holder = {kind: 'local' as const, makePresentation: () => structuredClone(f.presentation), submit: async () => {f.wallet()}}
  const poll = vi.mocked(f.session.poll), original = poll.getMockImplementation()!
  // The verifiers are still working after the credential continuation: plain polls show
  // `verifying` until the held poll answers the completed session.
  let held = false
  poll.mockImplementation(async (signal, options) => {
    const status = await original(signal)
    if (status.status !== 'done') return status
    if (options?.wait) { held = true; return status }
    return held ? status : {status: 'pending', phase: 'verifying'}
  })
  expect((await drivePaidSession({...f.base, holder})).status).toBe('done')
  expect(poll.mock.calls.filter(([, options]) => options?.wait === true)).toHaveLength(1)
  expect(f.waits).toEqual([])
})

it.each(['unsupported', 'transport'] as const)('falls back when a held poll is %s: pacing for an unchanged instant answer, a plain poll for a transport failure', async mode => {
  const f = fixture()
  const holder = {kind: 'local' as const, makePresentation: () => structuredClone(f.presentation), submit: async () => {f.wallet()}}
  const poll = vi.mocked(f.session.poll), original = poll.getMockImplementation()!
  let plainAfterDone = 0, heldFailed = false
  poll.mockImplementation(async (signal, options) => {
    const status = await original(signal)
    if (status.status !== 'done') return status
    if (options?.wait) {
      if (mode === 'transport') { heldFailed = true; throw new Error('socket hang up') }
      return {status: 'pending', phase: 'verifying'}
    }
    return (mode === 'transport' ? heldFailed : ++plainAfterDone > 2) ? status : {status: 'pending', phase: 'verifying'}
  })
  expect((await drivePaidSession({...f.base, holder})).status).toBe('done')
  const heldCalls = poll.mock.calls.filter(([, options]) => options?.wait === true).length
  if (mode === 'unsupported') { expect(f.waits).toEqual([undefined, undefined]); expect(heldCalls).toBe(2) }
  else { expect(f.waits).toEqual([]); expect(heldCalls).toBe(1) }
})

it('refuses a retained wallet presentation the client does not accept, without resuming it', async () => {
  const f = fixture()
  await expect(drivePaidSession({...f.base, holder: {kind: 'external', present: () => { f.wallet() }, accept: async () => false}}))
    .rejects.toMatchObject({kind: 'refused'})
  expect(f.session.resumePresentation).not.toHaveBeenCalled()
})

it('resumes after an interrupted read by skipping confirmed writes and reconciling creation', async () => {
  const f = fixture()
  const holder = {kind: 'local' as const, makePresentation: vi.fn(() => structuredClone(f.presentation)), submit: vi.fn(async () => { f.wallet() })}
  vi.mocked(f.session.presentations).mockRejectedValueOnce(new Error('agent read failed'))
  await expect(drivePaidSession({...f.base, holder})).rejects.toThrow('agent read failed')
  await expect(drivePaidSession({...f.base, holder})).rejects.toThrow(/already attempted/)
  expect((await drivePaidSession({...f.base, holder, resume: true})).status).toBe('done')
  expect(f.session.create).toHaveBeenCalledTimes(1)
  expect(f.session.reconcile).toHaveBeenCalledTimes(1)
  expect(holder.makePresentation).toHaveBeenCalledTimes(1)
  expect(holder.submit).toHaveBeenCalledTimes(1)
})

it('never resumes past a write whose outcome is unknown', async () => {
  const f = fixture()
  const holder = {kind: 'local' as const, makePresentation: vi.fn(() => structuredClone(f.presentation)), submit: vi.fn(async () => { throw new Error('lost') })}
  await expect(drivePaidSession({...f.base, holder})).rejects.toThrow('lost')
  const error = await drivePaidSession({...f.base, holder, resume: true}).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(PaidSessionRecoveryError)
  expect(holder.submit).toHaveBeenCalledTimes(1)
})

it('recovers unknown creation only on explicit resume through the verified original read', async () => {
  const f = fixture(), key = 'wallet-' + f.id + '-create'
  const holder = {kind: 'local' as const, makePresentation: vi.fn(() => structuredClone(f.presentation)), submit: vi.fn(async () => { f.wallet() })}
  vi.mocked(f.session.create).mockRejectedValueOnce(new Error('lost creation reply'))
  await expect(drivePaidSession({...f.base, holder})).rejects.toThrow('lost creation reply')
  const retained = await f.store.load(key)
  expect(retained).toMatchObject({phase: 'prepared'})
  await expect(drivePaidSession({...f.base, holder})).rejects.toBeInstanceOf(PaidSessionRecoveryError)
  expect(f.session.reconcile).not.toHaveBeenCalled()
  expect((await drivePaidSession({...f.base, holder, resume: true})).status).toBe('done')
  expect(f.session.create).toHaveBeenCalledTimes(1)
  expect(f.session.reconcile).toHaveBeenCalledTimes(1)
  expect(await f.store.load(key)).toEqual({...(retained as Record<string, unknown>), phase: 'confirmed'})
  expect(holder.submit).toHaveBeenCalledTimes(1)
})

it.each(['original session missing', 'original provider or context changed'])('retains unknown creation when its verified read refuses: %s', async message => {
  const f = fixture(), key = 'wallet-' + f.id + '-create'
  const holder = {kind: 'local' as const, makePresentation: vi.fn(() => structuredClone(f.presentation)), submit: vi.fn(async () => { f.wallet() })}
  vi.mocked(f.session.create).mockRejectedValueOnce(new Error('lost creation reply'))
  await expect(drivePaidSession({...f.base, holder})).rejects.toThrow('lost creation reply')
  const retained = await f.store.load(key)
  const failure = message === 'original session missing' ? new PaidAgentControlError(f.id, 404) : new Error(message)
  vi.mocked(f.session.reconcile).mockRejectedValueOnce(failure)
  await expect(drivePaidSession({...f.base, holder, resume: true})).rejects.toMatchObject({
    message: 'Original session creation cannot be verified; resume only this session', cause: failure,
  })
  expect(await f.store.load(key)).toEqual(retained)
  expect(f.session.create).toHaveBeenCalledTimes(1)
  expect(f.session.requestObject).not.toHaveBeenCalled()
  expect(holder.submit).not.toHaveBeenCalled()
})

it('refuses a different retained creation intent before recovery reads or wallet work', async () => {
  const f = fixture(), key = 'wallet-' + f.id + '-create'
  const original = {sessionId: f.id, paymentHash: '0x' + 'ee'.repeat(32), initialization: f.session.initialization}
  await f.store.save(key, {phase: 'prepared', original})
  const holder = {kind: 'local' as const, makePresentation: vi.fn(() => structuredClone(f.presentation)), submit: vi.fn(async () => { f.wallet() })}
  await expect(drivePaidSession({...f.base, holder, resume: true})).rejects.toBeInstanceOf(PaidSessionRecoveryError)
  expect(f.session.create).not.toHaveBeenCalled()
  expect(f.session.reconcile).not.toHaveBeenCalled()
  expect(holder.submit).not.toHaveBeenCalled()
  expect(await f.store.load(key)).toEqual({phase: 'prepared', original})
})

it('retains unknown creation when cancellation arrives during its original recovery read', async () => {
  const f = fixture(), key = 'wallet-' + f.id + '-create', controller = new AbortController()
  const holder = {kind: 'local' as const, makePresentation: vi.fn(() => structuredClone(f.presentation)), submit: vi.fn(async () => { f.wallet() })}
  vi.mocked(f.session.create).mockRejectedValueOnce(new Error('lost creation reply'))
  await expect(drivePaidSession({...f.base, holder})).rejects.toThrow('lost creation reply')
  const retained = await f.store.load(key)
  vi.mocked(f.session.reconcile).mockImplementationOnce(async () => {controller.abort(new Error('cancelled recovery')); return {status: 'pending', phase: 'awaiting_wallet'}})
  await expect(drivePaidSession({...f.base, holder, resume: true, signal: controller.signal})).rejects.toThrow('cancelled recovery')
  expect(await f.store.load(key)).toEqual(retained)
  expect(f.session.create).toHaveBeenCalledTimes(1)
  expect(holder.submit).not.toHaveBeenCalled()
})

it('gives a local holder the request URI and QR payload instead of making it rebuild them', async () => {
  const f = fixture()
  const present = vi.fn()
  const holder = {kind: 'local' as const, present, makePresentation: vi.fn(() => structuredClone(f.presentation)), submit: vi.fn(async () => { f.wallet() })}
  expect((await drivePaidSession({...f.base, holder})).status).toBe('done')
  const link = {requestUri: 'https://agent.example/v1/request/' + f.id, qrPayload: 'openid4vp://?x'}
  expect(holder.makePresentation).toHaveBeenCalledWith(expect.objectContaining({claims: {nonce: 'original-nonce'}}), link)
  expect(present).toHaveBeenCalledWith(expect.objectContaining(link))
  expect(present.mock.invocationCallOrder[0]).toBeLessThan(holder.makePresentation.mock.invocationCallOrder[0]!)
})


it.each([400, 409])('preserves the original terminal revocation reason after callback HTTP %s without another paid write', async httpStatus => {
  const f = fixture(), detail = 'paid credential verification refused: credentials[0]: revocation check failed (deny): credential is revoked'
  const holder = {kind: 'local' as const, makePresentation: () => structuredClone(f.presentation), submit: async () => {f.wallet()}}
  vi.mocked(f.session.resumePresentation).mockImplementationOnce(async () => {
    vi.mocked(f.session.poll).mockResolvedValue({status: 'failed', phase: 'failed', error: detail})
    throw new PaidAgentControlError(f.id, httpStatus)
  })
  const error = await drivePaidSession({...f.base, holder}).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(VerifierAgentSessionError)
  if (!(error instanceof VerifierAgentSessionError)) throw error
  expect(error).toMatchObject({kind: 'refused', retryable: false, correlation: f.id})
  expect(error.message).toContain(detail)
  expect(f.session.resumePresentation).toHaveBeenCalledTimes(1)
  expect(f.session.poll).toHaveBeenCalledTimes(3)
  expect(f.session.create).toHaveBeenCalledTimes(1)
  expect(f.session.approveCredentials).not.toHaveBeenCalled()
})

it.each([undefined, '', 'x'.repeat(2048)])('bounds terminal refusal detail and preserves the fallback for missing detail', async detail => {
  const f = fixture()
  vi.mocked(f.session.poll).mockResolvedValue({status: 'failed', phase: 'failed', error: detail})
  const holder = {kind: 'external' as const, present: vi.fn(), accept: vi.fn(async () => true)}
  const error = await drivePaidSession({...f.base, holder}).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(VerifierAgentSessionError)
  if (!(error instanceof VerifierAgentSessionError)) throw error
  expect(error.message).toContain('Original paid credential verification refused')
  if (detail) {expect(error.message).toContain('x'.repeat(500)); expect(error.message).not.toContain('x'.repeat(501))}
  expect(error.message.length).toBeLessThan(650)
  expect(holder.present).not.toHaveBeenCalled()
  expect(f.session.approveCredentials).not.toHaveBeenCalled()
  expect(f.session.resumePresentation).not.toHaveBeenCalled()
})

it('sends independent operator approvals of one batch together, and refuses the whole batch before any send', async () => {
  const f = fixture()
  const other = ('0x' + 'ee'.repeat(32)) as Hex
  const members = [...f.base.members, {index: 1, operator: ('0x' + '22'.repeat(20)) as Hex, publicKey: other, proof: []}]
  const jar = vi.mocked(f.session.approveRequest).getMockImplementation()!
  let inFlight = 0, overlap = 0
  vi.mocked(f.session.approveRequest).mockImplementation(async (...args) => {
    inFlight++; overlap = Math.max(overlap, inFlight)
    await new Promise(r => setTimeout(r, 20))
    inFlight--
    return jar(...args)
  })
  const sign = (operator_key: Hex, stage: PaidAgentProposal['stage']): PaidAgentProposal => ({id: 'ef'.repeat(32), stage, operator_key, unsigned_body: {stage}, expires: 1030})
  vi.mocked(f.session.proposals).mockResolvedValueOnce([sign(f.base.members[0]!.publicKey, 'presentation_sign'), sign(other, 'presentation_attest')])
  const holder = {kind: 'local' as const, makePresentation: () => structuredClone(f.presentation), submit: async () => {f.wallet()}}
  expect((await drivePaidSession({...f.base, members, holder})).status).toBe('done')
  expect(f.session.approveRequest).toHaveBeenCalledTimes(2)
  // Both approvals were in flight at once: one round trip for the batch, not one per operator.
  expect(overlap).toBe(2)
  // An operator outside the draw in the same batch refuses every approval of it, sending none.
  const g = fixture()
  vi.mocked(g.session.proposals).mockResolvedValueOnce([sign(g.base.members[0]!.publicKey, 'presentation_sign'), sign(('0x' + '99'.repeat(32)) as Hex, 'presentation_attest')])
  await expect(drivePaidSession({...g.base, holder: {kind: 'local' as const, makePresentation: () => structuredClone(g.presentation), submit: async () => {g.wallet()}}}))
    .rejects.toThrow(/outside the original anchored draw/)
  expect(g.session.approveRequest).not.toHaveBeenCalled()
})
