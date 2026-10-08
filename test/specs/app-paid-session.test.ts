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
