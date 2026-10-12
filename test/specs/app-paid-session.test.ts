import {expect, it, vi} from 'vitest'
import type {Hex} from 'viem'
import {drivePaidSession, PaidSessionRecoveryError, type PaidWalletPresentation} from '../../src/app/paid-session.js'
import {createMemoryStore} from '../../src/app/memory-store.js'
import {PaidAgentControlError, type RegisteredPaidAgentSession, type PaidAgentProposal} from '../../src/chain/registeredPaidAgent.js'
import type {VerifiedRequestObject} from '../../src/oid4vp/request-object.js'

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
  const base = {session, store, members, signal: new AbortController().signal, wait: vi.fn(async (hint?: number) => { waits.push(hint) })}
  return {id, store, session, base, calls, presentation, waits, wallet: () => { sent = true }}
}

it('drives an external wallet: shows the request, lets the client accept the retained body, then approves its work', async () => {
  const f = fixture()
  const present = vi.fn(() => { f.wallet() }), accept = vi.fn(async () => true)
  expect((await drivePaidSession({...f.base, holder: {kind: 'external', present, accept}})).status).toBe('done')
  expect(present).toHaveBeenCalledWith(expect.objectContaining({qrPayload: 'openid4vp://?x'}))
  expect(accept).toHaveBeenCalledTimes(1)
  expect(vi.mocked(f.session.approveCredentials).mock.calls[0]![2]).toEqual(f.presentation.approved)
  expect(f.calls).toEqual(['create', 'jar', 'resume', 'credential', 'resume'])
  expect(f.waits[0]).toBe(5) // the agent's Retry-After hint paces the consent wait
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
