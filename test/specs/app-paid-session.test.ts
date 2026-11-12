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

it('reads the status beside the proposal listing and beside the retained presentations, judging the status first', async () => {
  const f = fixture()
  const pairs = new Set<string>(), live = new Set<string>()
  const timed = <A extends unknown[], R>(name: string, inner: (...args: A) => Promise<R>) => async (...args: A): Promise<R> => {
    for (const other of live) pairs.add([name, other].sort().join('+'))
    live.add(name)
    try { await new Promise(r => setTimeout(r, 10)); return await inner(...args) } finally { live.delete(name) }
  }
  const s = vi.mocked(f.session)
  s.poll.mockImplementation(timed('poll', s.poll.getMockImplementation()!))
  s.proposals.mockImplementation(timed('proposals', s.proposals.getMockImplementation()!))
  s.presentations.mockImplementation(timed('presentations', s.presentations.getMockImplementation()!))
  const holder = {kind: 'local' as const, makePresentation: () => structuredClone(f.presentation), submit: async () => {f.wallet()}}
  expect((await drivePaidSession({...f.base, holder})).status).toBe('done')
  expect(pairs).toContain('poll+proposals')
  expect(pairs).toContain('poll+presentations')
  expect(f.calls).toEqual(['create', 'jar', 'resume', 'credential', 'resume'])
  // A failed session refuses with its status even when the listing read beside it fails too.
  const g = fixture()
  vi.mocked(g.session.poll).mockResolvedValue({status: 'failed', phase: 'failed'})
  vi.mocked(g.session.proposals).mockRejectedValue(new Error('listing unavailable'))
  await expect(drivePaidSession({...g.base, holder: {kind: 'local' as const, makePresentation: () => structuredClone(g.presentation), submit: async () => {g.wallet()}}}))
    .rejects.toBeInstanceOf(VerifierAgentSessionError)
  expect(g.session.approveRequest).not.toHaveBeenCalled()
})

it('asks an agent advertising held listings to hold an empty proposal listing instead of pacing locally', async () => {
  for (const proposalWait of [true, false]) {
    const f = fixture()
    ;(f.session as unknown as Record<string, unknown>).proposalWait = proposalWait
    const plain = vi.mocked(f.session.proposals).getMockImplementation()!
    // The first listing beside the 425 poll is empty; the next one (held or not) has the proposal.
    vi.mocked(f.session.proposals).mockResolvedValueOnce([]).mockImplementation(plain)
    const holder = {kind: 'local' as const, makePresentation: () => structuredClone(f.presentation), submit: async () => {f.wallet()}}
    expect((await drivePaidSession({...f.base, holder})).status).toBe('done')
    const held = vi.mocked(f.session.proposals).mock.calls.filter(c => c[1]?.waitMs !== undefined)
    expect(held.length > 0, String(proposalWait)).toBe(proposalWait)
    // Held: no local wait for the request stage; not held: the agent's Retry-After hint paces it.
    expect(f.waits, String(proposalWait)).toEqual(proposalWait ? [] : [5])
  }
})

// ---- What each journaled write leaves on disk at its send, and what a crash there resumes to ----
// A real file store; the state at each send is read through another store object (another process,
// or the directory a crash leaves behind).
import {mkdtemp, readdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach} from 'vitest'
import {createFileStore, fileStoreSyncCounters} from '../../src/app/node.js'
import type {RetainedPaidApproval} from '../../src/chain/registeredPaidAgent.js'

const durableRoots: string[] = []
afterEach(async () => { await Promise.all(durableRoots.splice(0).map(dir => rm(dir, {recursive: true, force: true}))) })

async function durableDrive(dir?: string) {
  dir ??= await mkdtemp(join(tmpdir(), 'tasra-session-durable-')); durableRoots.push(dir)
  const id = 'ab'.repeat(32), key = ('0x' + 'cd'.repeat(32)) as Hex, store = createFileStore(dir), seen: Record<string, unknown> = {}
  const disk = async () => {
    const other = createFileStore(dir)
    const names = (await readdir(dir)).sort()
    const records = Object.fromEntries(await Promise.all(names.filter(n => n.endsWith('.json')).map(async n => [n.slice(0, -5), ((await other.load<{phase?: string; state?: string}>(n.slice(0, -5))) ?? {})])))
    return {locks: names.filter(n => n.endsWith('.lock')), phases: Object.fromEntries(Object.entries(records).map(([k, v]) => [k.replace('wallet-' + id + '-', ''), (v as {phase?: string; state?: string}).phase ?? (v as {state?: string}).state]))}
  }
  const flags = {jar: false, sent: false, selected: false, approved: false, done: false}
  const proposal = (stage: PaidAgentProposal['stage'], n: number): PaidAgentProposal => ({id: n.toString(16).repeat(64).slice(0, 64), stage, operator_key: key, unsigned_body: {stage}, expires: 4_000_000_000})
  const retained = (p: PaidAgentProposal): RetainedPaidApproval => ({proposalId: p.id, body: JSON.stringify({p: p.id}), expires: p.expires})
  const presentation: PaidWalletPresentation = {approved: {holder: 'h', credentials: ['a.b.c'], holder_proof: null, oauth: null, iat: 1000}, form: {response: 'jwe'}}
  const session = {
    sessionId: id, paymentHash: key, initialization: {expires: 1030}, batchApprovals: true,
    pacing: {clock: {now: () => 1_000_000, jitter: () => 0, sleep: async () => {}}, attemptBudgetMs: 5_000},
    create: vi.fn(async () => { seen.create = await disk() }), reconcile: vi.fn(async () => ({status: 'pending'})),
    requestObject: vi.fn(async () => { if (!flags.jar) throw new PaidAgentControlError(id, 425); return {request: {claims: {nonce: 'n'}}, requestUri: 'u', qrPayload: 'q'} }),
    proposals: vi.fn(async () => !flags.jar ? [proposal('presentation_sign', 1), proposal('presentation_attest', 2)] : flags.selected && !flags.approved ? [proposal('credential', 3)] : []),
    prepareRequestApproval: vi.fn(async (p: PaidAgentProposal) => retained(p)), prepareCredentialApproval: vi.fn(async (p: PaidAgentProposal) => retained(p)),
    sendRetainedApprovals: vi.fn(async (approvals: RetainedPaidApproval[]) => { seen.requestApprovals = await disk(); flags.jar = true; return {kind: 'results', results: new Map(approvals.map(a => [a.proposalId, 204]))} }),
    sendRetainedApproval: vi.fn(async () => { seen.credentialApproval = await disk(); flags.approved = true; return {status: 'accepted'} }),
    approvalState: vi.fn(async () => 'approved'),
    presentations: vi.fn(async () => flags.sent ? [{id: '23'.repeat(32), presentation: structuredClone(presentation.approved), expires: 1030, selected: flags.selected}] : []),
    resumePresentation: vi.fn(async () => {
      seen[flags.selected ? 'resume' : 'resumeInitial'] = await disk()
      flags.selected = true; if (!flags.approved) throw new PaidAgentControlError(id, 425); flags.done = true
    }),
    poll: vi.fn(async () => ({status: flags.done ? 'done' as const : 'pending' as const, phase: flags.done ? 'done' as const : 'awaiting_wallet' as const})),
  } as unknown as RegisteredPaidAgentSession
  const holder = {kind: 'local' as const, makePresentation: vi.fn(() => structuredClone(presentation)), submit: vi.fn(async () => { seen.presentation = await disk(); flags.sent = true })}
  const members = [{index: 0, operator: ('0x' + '11'.repeat(20)) as Hex, publicKey: key, proof: []}]
  const drive = (resume = false, wait: () => Promise<void> = async () => {}) => drivePaidSession({session, store, members, signal: new AbortController().signal, wait, holder, resume})
  return {dir, store, session, holder, flags, seen, disk, drive}
}

it('journals each paid write durably before its send, and publishes the previous one\'s outcome before the next', async () => {
  const d = await durableDrive()
  expect((await d.drive()).status).toBe('done')
  // Creation: \`prepared\` is on disk and its lock already released when the POST goes out.
  expect(d.seen.create).toEqual({locks: [], phases: {create: 'prepared'}})
  // The request-object approvals: both records with in_flight(1), and creation's re-derivable
  // confirmation, in one commit before their request.
  expect(d.seen.requestApprovals).toEqual({locks: [], phases: {create: 'confirmed',
    'presentation_attest-0': 'prepared', 'presentation_attest-0.attempt': 'in_flight', 'presentation_sign-0': 'prepared', 'presentation_sign-0.attempt': 'in_flight'}})
  // The presentation: its own \`prepared\` (and the approvals' confirmations) committed with its
  // unlock before the wallet POST, so no lock is held while it is in flight.
  expect(d.seen.presentation).toMatchObject({locks: [],
    phases: {presentation: 'prepared', 'presentation_sign-0': 'confirmed', 'presentation_attest-0': 'confirmed'}})
  // Each later write's \`prepared\` commit publishes the previous write's \`confirmed\` (owed) with it.
  expect(d.seen.resumeInitial).toMatchObject({locks: [], phases: {presentation: 'confirmed', 'resume-initial': 'prepared'}})
  expect(d.seen.credentialApproval).toMatchObject({locks: [], phases: {'resume-initial': 'confirmed', 'credential-0': 'prepared', 'credential-0.attempt': 'in_flight'}})
  expect(d.seen.resume).toMatchObject({phases: {'credential-0': 'confirmed', 'resume-1': 'prepared'}})
  // Everything confirmed at the end, no lock left.
  const end = await d.disk()
  expect(end.locks).toEqual([])
  expect(Object.entries(end.phases).filter(([k]) => !k.endsWith('.attempt')).every(([, phase]) => phase === 'confirmed')).toBe(true)
})

it('a second drive started while a write is in flight refuses on its durable prepared record and never sends it again', async () => {
  for (const resume of [false, true]) {
    const d = await durableDrive()
    let second: Promise<unknown> | undefined
    vi.mocked(d.holder.submit).mockImplementationOnce(async () => {
      // The presentation POST is in flight (no lock held): another driver on the same store.
      second = d.drive(resume).then(() => 'resolved', (error: unknown) => error)
      const outcome = await second
      // A first drive refuses the retained creation; a resumed one reaches the in-flight presentation.
      expect(outcome).toMatchObject({name: 'PaidSessionRecoveryError', key: 'wallet-' + d.session.sessionId + (resume ? '-presentation' : '-create')})
      d.flags.sent = true
    })
    expect((await d.drive()).status).toBe('done')
    expect(second).toBeDefined()
    expect(d.holder.submit).toHaveBeenCalledTimes(1)
    expect(d.holder.makePresentation).toHaveBeenCalledTimes(1)
  }
})

it('a continuation\'s confirmation that no later write carries is published durably before the drive polls again', async () => {
  const d = await durableDrive()
  const before = fileStoreSyncCounters.flushes
  const poll = vi.mocked(d.session.poll), original = poll.getMockImplementation()!
  const atPoll: Record<string, unknown>[] = []
  poll.mockImplementation(async (...args) => { atPoll.push((await d.disk()).phases); return original(...args) })
  expect((await d.drive()).status).toBe('done')
  expect(fileStoreSyncCounters.flushes).toBeGreaterThan(before)
  // The last continuation's confirmation rides on no later write: it is on disk at the poll that
  // ends the drive, not only after it.
  expect(atPoll.at(-1)!['resume-1']).toBe('confirmed')
  expect((await d.disk()).phases['resume-1']).toBe('confirmed')
  // A resume after the drive sees every write confirmed and sends nothing again.
  expect((await d.drive(true)).status).toBe('done')
  expect(d.session.resumePresentation).toHaveBeenCalledTimes(2)
  expect(d.holder.submit).toHaveBeenCalledTimes(1)
})

it('a crash right after the creation POST (its confirmation not yet written) resumes exactly like one after it: one recovery read, no second POST', async () => {
  for (const confirmed of [false, true]) {
    const d = await durableDrive()
    vi.mocked(d.session.requestObject).mockRejectedValueOnce(new Error('process died'))
    await expect(d.drive()).rejects.toThrow('process died')
    // The state a crash before the next commit leaves, and the one after it: both resume the same.
    await d.store.save('wallet-' + d.session.sessionId + '-create', {original: {sessionId: d.session.sessionId, paymentHash: d.session.paymentHash, initialization: d.session.initialization},
      phase: confirmed ? 'confirmed' : 'prepared'})
    expect((await d.drive(true)).status).toBe('done')
    expect(d.session.create).toHaveBeenCalledTimes(1)
    expect(d.session.reconcile).toHaveBeenCalledTimes(1)
    expect((await d.disk()).phases.create).toBe('confirmed')
  }
})

it('a crash after a continuation was sent but before its confirmation still refuses to resume past it, as before', async () => {
  const d = await durableDrive()
  // The continuation succeeds at the agent, then the process dies before the commit that confirms it.
  const realResume = d.session.resumePresentation
  vi.mocked(d.session.resumePresentation).mockImplementationOnce(async (...args) => {
    await realResume(...args).catch(() => {})
    // A crash here: the directory holds `resume-initial` prepared (and its lock).
    const left = await d.disk()
    expect(left.phases['resume-initial']).toBe('prepared')
    throw new Error('process died')
  })
  await expect(d.drive()).rejects.toThrow('process died')
  await expect(d.drive(true)).rejects.toMatchObject({name: 'PaidSessionRecoveryError', key: 'wallet-' + d.session.sessionId + '-resume-initial'})
  expect(d.holder.submit).toHaveBeenCalledTimes(1)
})

it('a crash while the drive waits for the wallet callback after the presentation resumes past it, with nothing sent again', async () => {
  const d = await durableDrive()
  // The wallet POST succeeds, but the agent has not retained the callback yet: the drive waits.
  vi.mocked(d.holder.submit).mockImplementationOnce(async () => {})
  let waiting!: () => void
  const entered = new Promise<void>(resolve => { waiting = resolve })
  // A crash in that wait: the first drive never continues, so nothing it held only in memory is published.
  void d.drive(false, () => { waiting(); return new Promise<void>(() => {}) })
  await entered
  // The callback arrives; a resumed drive continues with the original presentation.
  d.flags.sent = true
  expect((await d.drive(true)).status).toBe('done')
  expect(d.holder.submit).toHaveBeenCalledTimes(1)
  expect(d.holder.makePresentation).toHaveBeenCalledTimes(1)
  expect(d.session.create).toHaveBeenCalledTimes(1)
})

it('a crash while the drive waits after the first continuation (no credential work proposed yet) resumes past it', async () => {
  const d = await durableDrive()
  // The agent accepts the first continuation, but has not yet listed its credential proposal.
  const proposals = vi.mocked(d.session.proposals), original = proposals.getMockImplementation()!
  let lagging = true
  proposals.mockImplementation(async (...args) => lagging && d.flags.selected ? [] : original(...args))
  let waiting!: () => void
  const entered = new Promise<void>(resolve => { waiting = resolve })
  void d.drive(false, () => { waiting(); return new Promise<void>(() => {}) })
  await entered
  lagging = false
  expect((await d.drive(true)).status).toBe('done')
  expect(d.session.resumePresentation).toHaveBeenCalledTimes(2)
  expect(d.holder.submit).toHaveBeenCalledTimes(1)
})

it('an approval listed again before its confirmation was committed is recognised as the drive\'s own, not refused', async () => {
  const d = await durableDrive()
  // The agent dispatches the approved request-signing work one fetch late: the next request-object
  // fetch still answers 425 and lists the same (already approved) proposals once more.
  const send = vi.mocked(d.session.sendRetainedApprovals!), realSend = send.getMockImplementation()!
  const proposals = vi.mocked(d.session.proposals), realProposals = proposals.getMockImplementation()!
  let lag = false
  send.mockImplementationOnce(async (...args) => { const out = await realSend(...args); d.flags.jar = false; lag = true; return out })
  proposals.mockImplementation(async (...args) => {
    const listed = await realProposals(...args)
    if (lag) { lag = false; d.flags.jar = true }
    return listed
  })
  expect((await d.drive()).status).toBe('done')
  expect(send).toHaveBeenCalledTimes(1)
  expect(d.session.prepareRequestApproval).toHaveBeenCalledTimes(2)
  expect(d.session.requestObject).toHaveBeenCalledTimes(3)
})
