import {expect, it, vi} from 'vitest'
import type {Hex} from 'viem'
import {drivePaidWalletSession, type PaidWalletPresentation} from '../fleet/_paid-wallet-session.ts'
import {PaidAgentControlError, type RegisteredPaidAgentSession, type PaidAgentProposal} from '../../src/chain/registeredPaidAgent.ts'
import type {ApplicationStore} from '../../src/app/node.ts'
import type {VerifiedRequestObject} from '../../src/oid4vp/request-object.ts'

// These controls test durable orchestration boundaries. Complete-body signatures,
// JAR/credential verification and canonical backing have separate SDK crypto/RPC tests.
function fixture() {
  const id = 'ab'.repeat(32), key = ('0x' + 'cd'.repeat(32)) as Hex
  const records = new Map<string, unknown>(), calls: string[] = []
  const store: ApplicationStore = {
    async load<T>(name: string) { return structuredClone(records.get(name)) as T | undefined },
    save: vi.fn(async (name: string, value: unknown) => { records.set(name, structuredClone(value)) }),
    async withLock<T>(_name: string, work: () => Promise<T>) { return work() },
  }
  const request = {claims: {nonce: 'original-nonce'}} as VerifiedRequestObject
  const presentation: PaidWalletPresentation = {approved: {holder: 'original-holder', credentials: ['original.compact.credential'],
    holder_proof: null, oauth: null, iat: 1000}, form: {response: 'original-encrypted-presentation'}}
  let jar = false, sent = false, selected = false, approved = false, done = false
  const proposal = (stage: PaidAgentProposal['stage']): PaidAgentProposal => ({id: 'ef'.repeat(32), stage, operator_key: key,
    unsigned_body: {independentlyCheckedBySDK: stage}, expires: 1030})
  const session: RegisteredPaidAgentSession = {
    sessionId: id, paymentHash: key,
    profile: {endpoint: 'https://agent.example', clientId: 'decentralized_identifier:did:web:agent.example',
      approval: {chainId: 43112, registry: ('0x' + 'aa'.repeat(20)) as Hex, serviceId: key, owner: ('0x' + 'bb'.repeat(20)) as Hex,
        serviceType: 1, revision: 1n, manifestHash: key}},
    initialization: {certificate: {execution_key: key, expires: 1030, creator_signature: ('0x' + '11'.repeat(65)) as Hex},
      profile_hash: key, body_hash: key, expires: 1030, signature: ('0x' + '12'.repeat(64)) as Hex},
    oauthContext: {nonce: 'unused', dpopHtu: 'https://agent.example/unused', platformAudience: 'unused'},
    prepareOAuthPresentation: vi.fn(), submitOAuthPresentation: vi.fn(), reconcile: vi.fn(),
    create: vi.fn(async () => {expect(records.get('wallet-' + id + '-create')).toMatchObject({phase: 'prepared'}); calls.push('create')}),
    requestObject: vi.fn(async () => {if (!jar) throw new PaidAgentControlError(id, 425); return {request, requestUri: 'https://agent.example/v1/request/' + id, qrPayload: 'unused'}}),
    proposals: vi.fn(async () => !jar ? [proposal('presentation_sign')] : selected && !approved ? [proposal('credential')] : []),
    approveRequest: vi.fn(async () => {expect(records.get('wallet-' + id + '-presentation_sign-0')).toMatchObject({phase: 'prepared'}); jar = true; calls.push('jar-approval')}),
    approveCredentials: vi.fn(async (_proposal, _member, original) => {expect(original).toEqual(presentation.approved); expect(records.get('wallet-' + id + '-credential-0')).toMatchObject({phase: 'prepared'}); approved = true; calls.push('credential-approval')}),
    presentations: vi.fn(async () => sent ? [{id: '23'.repeat(32), presentation: structuredClone(presentation.approved), expires: 1030, selected}] : []),
    resumePresentation: vi.fn(async () => {calls.push('resume'); selected = true; if (!approved) throw new PaidAgentControlError(id, 425); done = true}),
    rejectProposal: vi.fn(),
    poll: vi.fn(async () => ({status: done ? 'done' as const : 'pending' as const, phase: done ? 'done' as const : 'awaiting_wallet' as const})),
  }
  const submit = vi.fn(async () => {expect(records.get('wallet-' + id + '-presentation')).toMatchObject({phase: 'prepared'}); sent = true; calls.push('presentation')})
  const options = {session, store, members: [{index: 0, operator: ('0x' + '11'.repeat(20)) as Hex, publicKey: key, proof: []}],
    signal: new AbortController().signal, makePresentation: vi.fn(() => structuredClone(presentation)), submit, wait: vi.fn(async () => {})}
  return {id, key, session, options, records, calls, presentation, proposal}
}

it('retains each write before sending and completes the original paid stages after explicit HTTP425', async () => {
  const f = fixture()
  expect((await drivePaidWalletSession(f.options)).status).toBe('done')
  expect(f.calls).toEqual(['create', 'jar-approval', 'presentation', 'resume', 'credential-approval', 'resume'])
  expect(f.session.create).toHaveBeenCalledTimes(1)
  expect(f.options.submit).toHaveBeenCalledTimes(1)
  expect([...f.records.values()]).toHaveLength(6)
  expect([...f.records.values()].every(v => (v as {phase: string}).phase === 'confirmed')).toBe(true)
})

it.each(['create', 'approveRequest', 'approveCredentials', 'resumePresentation'] as const)('retains unknown %s outcomes and refuses all automatic redelivery', async method => {
  const f = fixture()
  vi.mocked(f.session[method]).mockRejectedValueOnce(new Error('lost original response'))
  await expect(drivePaidWalletSession(f.options)).rejects.toThrow('lost original response')
  expect(f.session[method]).toHaveBeenCalledTimes(1)
  await expect(drivePaidWalletSession(f.options)).rejects.toThrow(/already attempted/)
  expect(f.session[method]).toHaveBeenCalledTimes(1)
  expect([...f.records.values()].some(v => (v as {phase: string}).phase === 'prepared')).toBe(true)
})

it('retains a lost encrypted presentation response without posting it again', async () => {
  const f = fixture()
  f.options.submit.mockRejectedValueOnce(new Error('lost presentation response'))
  await expect(drivePaidWalletSession(f.options)).rejects.toThrow('lost presentation response')
  expect(f.options.submit).toHaveBeenCalledTimes(1)
  expect(f.records.get('wallet-' + f.id + '-presentation')).toMatchObject({phase: 'prepared', original: {presentation: f.presentation}})
  await expect(drivePaidWalletSession(f.options)).rejects.toThrow(/already attempted/)
  expect(f.options.submit).toHaveBeenCalledTimes(1)
})

it('refuses a callback with substituted credentials before resume or credential approval', async () => {
  const f = fixture()
  vi.mocked(f.session.presentations).mockResolvedValue([{id: '23'.repeat(32), expires: 1030, selected: false,
    presentation: {...f.presentation.approved, credentials: ['attacker.compact.credential']}}])
  await expect(drivePaidWalletSession(f.options)).rejects.toThrow(/changed the original/)
  expect(f.session.resumePresentation).not.toHaveBeenCalled()
  expect(f.session.approveCredentials).not.toHaveBeenCalled()
})

it('refuses an unassigned operator before signing a proposal', async () => {
  const f = fixture()
  vi.mocked(f.session.proposals).mockResolvedValue([{...f.proposal('presentation_sign'), operator_key: ('0x' + 'ff'.repeat(32)) as Hex}])
  await expect(drivePaidWalletSession(f.options)).rejects.toThrow(/outside the original/)
  expect(f.session.approveRequest).not.toHaveBeenCalled()
  expect(f.options.submit).not.toHaveBeenCalled()
})

it('refuses credential work before the local wallet has accepted a presentation', async () => {
  const f = fixture()
  vi.mocked(f.session.proposals).mockResolvedValue([f.proposal('credential')])
  await expect(drivePaidWalletSession(f.options)).rejects.toThrow(/original locally accepted/)
  expect(f.session.approveCredentials).not.toHaveBeenCalled()
  expect(f.options.submit).not.toHaveBeenCalled()
})

it('reports credential refusal only after confirming the original failed session following HTTP409', async () => {
  const f = fixture()
  vi.mocked(f.session.resumePresentation).mockImplementationOnce(async () => {
    vi.mocked(f.session.poll).mockResolvedValue({status: 'failed', phase: 'failed'})
    throw new PaidAgentControlError(f.id, 409)
  })
  await expect(drivePaidWalletSession(f.options)).rejects.toMatchObject({kind: 'refused', correlation: f.id})
  expect(f.session.resumePresentation).toHaveBeenCalledTimes(1)
})

it('does not turn an in-progress HTTP409 into credential refusal or another continuation', async () => {
  const f = fixture()
  vi.mocked(f.session.resumePresentation).mockRejectedValueOnce(new PaidAgentControlError(f.id, 409))
  await expect(drivePaidWalletSession(f.options)).rejects.toMatchObject({httpStatus: 409, sessionId: f.id})
  expect(f.session.resumePresentation).toHaveBeenCalledTimes(1)
})
