// Durable retained approvals: signed once, retained before the first send, resent only as the
// byte-identical body under a generation-bound permit that an exclusive store claim consumes before
// every send. Deterministic clock; scripted agent answers; real memory, file and IndexedDB stores.
import {afterEach, describe, expect, it, vi} from 'vitest'
import {mkdtemp, rm, readdir, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type {Hex} from 'viem'
import {APPROVAL_LEDGER_SCHEMA, approvalClaimKey, approvalLedgerKey, beginApprovalSend, deliverRetainedApproval, readApprovalLedger,
  reconcileRetainedApproval, retainAndDeliverApproval, retainAndDeliverApprovals, supportsDurableApproval, type ApprovalJournalRecord, type DurableApprovalContext} from '../../src/app/paid-approval.js'
import {drivePaidSession, PaidSessionRecoveryError, type PaidWalletPresentation} from '../../src/app/paid-session.js'
import {createMemoryStore} from '../../src/app/memory-store.js'
import {createFileStore, fileStoreSyncCounters} from '../../src/app/node.js'
import {Rederivable} from '../../src/app/store-commit.js'
import {createIndexedDbStore} from '../../src/app/browser.js'
import {PaidAgentControlError, type PaidAgentProposal, type PaidApprovalDelivery, type RegisteredPaidAgentSession, type RetainedPaidApproval} from '../../src/chain/registeredPaidAgent.js'
import {PaidApprovalUnresolvedError, PaidBackoffError} from '../../src/errors.js'
import type {ApplicationStore} from '../../src/app/ready-slot.js'
import type {VerifiedRequestObject} from '../../src/oid4vp/request-object.js'

const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(dir => rm(dir, {recursive: true, force: true}))) })
async function directory() { const dir = await mkdtemp(join(tmpdir(), 'tasra-approval-')); roots.push(dir); return dir }

const SESSION = 'ab'.repeat(32), PROPOSAL = 'cd'.repeat(32), KEY = 'wallet-' + SESSION + '-presentation_sign-0'
const RETAINED: RetainedPaidApproval = {proposalId: PROPOSAL, body: '{"authorization":{"signature":"0x01","expires":1030}}', expires: 1030}
const ORIGINAL = {stage: 'presentation_sign', operator_key: '0x' + 'ee'.repeat(32), unsigned_body: {stage: 'presentation_sign'}}

type Reply = () => PaidApprovalDelivery
const busy = (hintMs?: number, httpStatus: 429 | 503 = 429): Reply => () => ({status: 'busy', httpStatus, ...(hintMs !== undefined ? {hintMs} : {})})
const accepted: Reply = () => ({status: 'accepted'})
const transport: Reply = () => { throw new Error('socket hang up') }
const refused = (status: number): Reply => () => { throw new PaidAgentControlError(SESSION, status) }

/** Virtual time from 1000 s; the approval's signed expiry (1030 s) is the deadline; 5 s per attempt. */
function harness(store: ApplicationStore = createMemoryStore()) {
  const time = {now: 1_000_000, overrun: 0, sleeps: [] as number[], during: undefined as undefined | (() => Promise<void>)}
  const clock = {now: () => time.now, jitter: () => 0, sleep: async (ms: number) => {
    time.sleeps.push(ms); time.now += ms + time.overrun
    const work = time.during; time.during = undefined
    await work?.()
  }}
  const replies: Reply[] = [], sent: string[] = []
  const agent = {state: 'pending'}
  const session = {
    sessionId: SESSION, pacing: {clock, attemptBudgetMs: 5_000},
    prepareRequestApproval: vi.fn(async () => structuredClone(RETAINED)),
    prepareCredentialApproval: vi.fn(async () => structuredClone(RETAINED)),
    sendRetainedApproval: vi.fn(async (approval: RetainedPaidApproval) => {
      sent.push(approval.body)
      const next = replies.shift()
      if (!next) throw new Error('unscripted send')
      return next()
    }),
    approvalState: vi.fn(async () => agent.state),
  } as unknown as RegisteredPaidAgentSession
  const ctx: DurableApprovalContext = {store, session, key: KEY, signal: new AbortController().signal}
  const record = () => store.load<ApprovalJournalRecord>(KEY)
  const ledger = () => readApprovalLedger(store, KEY, PROPOSAL)
  const sign = vi.fn(async () => structuredClone(RETAINED))
  const first = () => retainAndDeliverApproval(ctx, ORIGINAL, sign)
  const resume = async () => reconcileRetainedApproval(ctx, (await record())!)
  return {store, session, ctx, time, replies, sent, agent, record, ledger, sign, first, resume}
}

describe('retained paid approval resends', () => {
  it('approve 429 then 204: the identical retained body twice, signed once', async () => {
    const h = harness()
    h.replies.push(busy(1000), accepted)
    expect(await h.first()).toBe(true)
    expect(h.sent).toEqual([RETAINED.body, RETAINED.body])
    expect(h.sign).toHaveBeenCalledTimes(1)
    expect(h.time.sleeps).toEqual([1000])
    expect(await h.record()).toEqual({original: ORIGINAL, phase: 'confirmed'})
    expect(await h.ledger()).toEqual({state: 'in_flight', generation: 2})
    // The first send needs no claim: its `in_flight(1)` was committed with the record by the one
    // caller that created it, and no `permit(1)` ever existed. Every resend claims its generation.
    expect(await h.store.load(approvalClaimKey(KEY, 1))).toBeUndefined()
    expect(await h.store.load(approvalClaimKey(KEY, 2))).toBeDefined()
    expect(await h.store.load(approvalClaimKey(KEY, 3))).toBeUndefined()
  })

  it('retains the body and its in-flight mark BEFORE the first send', async () => {
    const h = harness()
    h.replies.push(() => { throw new Error('crash during first send') })
    const seen: unknown[] = []
    vi.mocked(h.session.sendRetainedApproval!).mockImplementationOnce(async () => { seen.push(await h.record(), await h.ledger()); throw new Error('crash') })
    await expect(h.first()).rejects.toBeInstanceOf(PaidApprovalUnresolvedError)
    expect(seen).toEqual([{original: ORIGINAL, phase: 'prepared', approval: {schema: APPROVAL_LEDGER_SCHEMA, ...RETAINED}}, {state: 'in_flight', generation: 1}])
  })

  it('busy, resume, transport error, resume: no second resend of an unknown outcome', async () => {
    const h = harness()
    h.replies.push(busy(100_000)) // 100 s + the 5 s attempt does not fit the 30 s left
    await expect(h.first()).rejects.toMatchObject({name: 'PaidBackoffError', code: 'deadline_exceeded'})
    expect(await h.ledger()).toEqual({state: 'permit', generation: 2})
    h.replies.push(transport)
    await expect(h.resume()).rejects.toMatchObject({name: 'PaidApprovalUnresolvedError', code: 'approval_outcome_unresolved', reason: 'outcome_unknown', generation: 2})
    await expect(h.resume()).rejects.toMatchObject({reason: 'outcome_unknown', generation: 2})
    expect(h.sent).toEqual([RETAINED.body, RETAINED.body])
    expect(h.time.sleeps).toEqual([])
  })

  it('busy, resume, busy, resume: identical resends until accepted', async () => {
    const h = harness()
    h.replies.push(busy(100_000), busy(100_000), accepted)
    await expect(h.first()).rejects.toBeInstanceOf(PaidBackoffError)
    await expect(h.resume()).rejects.toBeInstanceOf(PaidBackoffError)
    expect(await h.ledger()).toEqual({state: 'permit', generation: 3})
    expect(await h.resume()).toBe('resent')
    expect(h.sent).toEqual([RETAINED.body, RETAINED.body, RETAINED.body])
    expect(h.sign).toHaveBeenCalledTimes(1)
    expect((await h.record())?.phase).toBe('confirmed')
  })

  it('success then crash: a resume reads the delivery and sends nothing', async () => {
    const store = createMemoryStore(), save = store.save.bind(store)
    let crash = true
    store.save = async (key, value) => {
      if (crash && key === KEY && (value as {phase?: string}).phase === 'confirmed') { crash = false; throw new Error('process died') }
      return save(key, value)
    }
    const h = harness(store)
    h.replies.push(accepted)
    await expect(h.first()).rejects.toThrow('process died')
    h.agent.state = 'pending' // even if the agent still shows it pending, in_flight is never resent
    await expect(h.resume()).rejects.toMatchObject({reason: 'outcome_unknown', generation: 1})
    h.agent.state = 'approved'
    expect(await h.resume()).toBe('accepted')
    expect((await h.record())?.phase).toBe('confirmed')
    expect(h.sent).toHaveLength(1)
  })

  it('forced overlap: A busy and sleeping, B claims and sends the next generation, A wakes and sends nothing', async () => {
    const h = harness(), other = harness(h.store)
    h.replies.push(busy(1000)); other.replies.push(accepted)
    let b: unknown
    h.time.during = async () => { b = await other.resume() }
    await expect(h.first()).rejects.toMatchObject({name: 'PaidApprovalUnresolvedError', reason: 'claim_lost', generation: 2})
    expect(b).toBe('resent')
    expect(h.sent).toEqual([RETAINED.body])
    expect(other.sent).toEqual([RETAINED.body])
    expect((await h.record())?.phase).toBe('confirmed')
  })

  it('refuses a stale generation even when its claim is free, and sends nothing', async () => {
    const h = harness()
    await h.store.save(KEY, {original: ORIGINAL, phase: 'prepared', approval: {schema: 2, ...RETAINED}})
    await h.store.save(approvalLedgerKey(KEY), {schema: 2, proposalId: PROPOSAL, state: 'permit', generation: 3})
    await expect(beginApprovalSend(h.ctx, PROPOSAL, 2)).rejects.toMatchObject({reason: 'generation_moved', generation: 2})
    await expect(deliverRetainedApproval(h.ctx, RETAINED, 4)).rejects.toMatchObject({reason: 'generation_moved', generation: 4})
    await expect(beginApprovalSend(h.ctx, PROPOSAL, 0)).rejects.toMatchObject({reason: 'generation_moved'})
    await expect(deliverRetainedApproval(h.ctx, RETAINED, 2)).rejects.toMatchObject({reason: 'claim_lost', generation: 2})
    expect(await h.ledger()).toEqual({state: 'permit', generation: 3})
    expect(h.sent).toEqual([])
  })

  it('a busy answer restores no permit when the ledger changed during that send', async () => {
    const h = harness()
    h.replies.push(busy(1000))
    vi.mocked(h.session.sendRetainedApproval!).mockImplementationOnce(async (approval: RetainedPaidApproval) => {
      h.sent.push(approval.body)
      await h.store.save(approvalLedgerKey(KEY), {schema: 2, proposalId: PROPOSAL, state: 'in_flight', generation: 7})
      return {status: 'busy', httpStatus: 429, hintMs: 1000}
    })
    await expect(h.first()).rejects.toMatchObject({reason: 'generation_moved', generation: 1})
    expect(await h.ledger()).toEqual({state: 'in_flight', generation: 7})
    expect(h.sent).toHaveLength(1)
    expect(h.time.sleeps).toEqual([])
  })

  it('never resends a legacy, missing, foreign or non-pending state', async () => {
    const h = harness()
    await expect(reconcileRetainedApproval(h.ctx, {original: ORIGINAL, phase: 'prepared'})).rejects.toMatchObject({reason: 'legacy_state'})
    await h.store.save(KEY, {original: ORIGINAL, phase: 'prepared', approval: {schema: 2, ...RETAINED}})
    await expect(h.resume()).rejects.toMatchObject({reason: 'no_permit'}) // crash between record and ledger
    for (const ledger of [{schema: 1, proposalId: PROPOSAL, state: 'permit'}, {schema: 2, proposalId: 'ef'.repeat(32), state: 'permit', generation: 1},
      {schema: 2, proposalId: PROPOSAL, state: 'permit', generation: 1.5}, {schema: 2, proposalId: PROPOSAL, state: 'refused', generation: 1}]) {
      await h.store.save(approvalLedgerKey(KEY), ledger)
      await expect(h.resume()).rejects.toMatchObject({reason: 'legacy_state'})
    }
    await h.store.save(approvalLedgerKey(KEY), {schema: 2, proposalId: PROPOSAL, state: 'permit', generation: 1})
    h.agent.state = 'rejected'
    await expect(h.resume()).rejects.toMatchObject({reason: 'no_permit', generation: 1})
    expect(h.sent).toEqual([])
  })

  it('reads the delivery after a 409 that follows a busy refusal; a first-send 409 is a decided answer', async () => {
    const h = harness()
    h.replies.push(busy(1000), refused(409)); h.agent.state = 'dispatched'
    expect(await h.first()).toBe(true)
    expect((await h.record())?.phase).toBe('confirmed')
    const pending = harness()
    pending.replies.push(busy(1000), refused(409))
    await expect(pending.first()).rejects.toMatchObject({reason: 'conflict', generation: 2})
    const decided = harness()
    decided.replies.push(refused(409))
    await expect(decided.first()).rejects.toMatchObject({name: 'PaidAgentControlError', httpStatus: 409})
    await expect(decided.resume()).rejects.toMatchObject({reason: 'outcome_unknown'})
    expect(decided.sent).toHaveLength(1)
  })

  it('a 403 is final, and an overrunning sleep or a too-long hint sends nothing more but keeps the permit', async () => {
    const final = harness()
    final.replies.push(busy(undefined, 503), refused(403))
    await expect(final.first()).rejects.toMatchObject({name: 'PaidAgentControlError', httpStatus: 403})
    expect(final.time.sleeps).toEqual([500])
    expect(await final.ledger()).toEqual({state: 'in_flight', generation: 2})
    const late = harness()
    late.time.overrun = 25_000
    late.replies.push(busy(1000))
    await expect(late.first()).rejects.toMatchObject({name: 'PaidBackoffError', code: 'no_time_to_send'})
    expect(late.sent).toHaveLength(1)
    expect(await late.ledger()).toEqual({state: 'permit', generation: 2})
    const long = harness()
    long.replies.push(busy(121_000))
    await expect(long.first()).rejects.toMatchObject({code: 'server_wait_too_long', retryAfterMs: 121_000})
    expect(long.time.sleeps).toEqual([])
    expect(await long.ledger()).toEqual({state: 'permit', generation: 2})
  })

  it('an existing record is never overwritten or sent', async () => {
    const h = harness()
    await h.store.save(KEY, {original: ORIGINAL, phase: 'prepared'})
    expect(await h.first()).toBe(false)
    expect(h.sent).toEqual([])
  })

  it('needs a claiming store, the retained-approval session methods and keys that fit', () => {
    const h = harness()
    expect(supportsDurableApproval(h.store, h.session, KEY)).toBe(true)
    expect(supportsDurableApproval({...h.store, claim: undefined}, h.session, KEY)).toBe(false)
    expect(supportsDurableApproval(h.store, {...h.session, sendRetainedApproval: undefined} as RegisteredPaidAgentSession, KEY)).toBe(false)
    expect(supportsDurableApproval(h.store, {...h.session, pacing: undefined} as RegisteredPaidAgentSession, KEY)).toBe(false)
    expect(supportsDurableApproval(h.store, h.session, 'x'.repeat(115))).toBe(false)
  })
})

describe('exclusive store claims', () => {
  it('file store: two store instances on one directory, exactly one winner per key', async () => {
    const dir = await directory(), a = createFileStore(dir), b = createFileStore(dir)
    for (let round = 0; round < 16; round++) {
      const key = `claim-${round}`
      const results = await Promise.all([a, b, a, b, a, b].map(store => store.claim!(key)))
      expect(results.filter(Boolean)).toHaveLength(1)
      expect((await stat(join(dir, key + '.json'))).mode & 0o777).toBe(0o600)
    }
    expect(await a.load('claim-0')).toEqual({claimed: true})
    expect((await readdir(dir)).filter(name => name.endsWith('.tmp'))).toEqual([])
    await expect(a.claim!('../escape')).rejects.toThrow('Invalid state key')
  })

  it('memory store: one winner, and a claimed key is a normal record', async () => {
    const store = createMemoryStore()
    expect(await Promise.all([store.claim!('k'), store.claim!('k')])).toEqual([true, false])
    expect(await store.load('k')).toEqual({claimed: true})
    await expect(store.claim!('bad key')).rejects.toThrow('Invalid state key')
  })

  it('IndexedDB store: two store instances (tabs) on one database, exactly one winner per key', async () => {
    const shared = fakeIndexedDb(), locks = fakeLocks()
    const a = createIndexedDbStore({indexedDB: shared.factory, locks}), b = createIndexedDbStore({indexedDB: shared.factory, locks})
    for (let round = 0; round < 16; round++) {
      const results = await Promise.all([a, b, a, b].map(store => store.claim!(`claim-${round}`)))
      expect(results.filter(Boolean)).toHaveLength(1)
    }
    expect(await b.load('claim-3')).toEqual({claimed: true})
    expect(shared.adds).toBe(64)
    // A failure other than an existing key is an error, not a lost claim.
    shared.failNext = true
    await expect(a.claim!('other')).rejects.toThrow('quota exceeded')
  })
})

/** IndexedDB shim: readwrite transactions commit at the end of a task; `add` aborts with ConstraintError on an existing key. */
function fakeIndexedDb() {
  const rows = new Map<string, unknown>(), shared = {adds: 0, failNext: false}
  const factory = {open() {
    const req: Record<string, unknown> = {}
    queueMicrotask(() => {
      const objectStoreNames = {contains: () => true}
      req.result = {objectStoreNames, transaction() {
        const tx: Record<string, unknown> = {}
        tx.objectStore = () => ({
          get(key: string) { const r: Record<string, unknown> = {}; queueMicrotask(() => { r.result = structuredClone(rows.get(key)); (r.onsuccess as () => void)() }); return r },
          put(value: unknown, key: string) { setTimeout(() => { rows.set(key, structuredClone(value)); (tx.oncomplete as () => void)() }, 1); return {} },
          add(value: unknown, key: string) {
            const r: Record<string, unknown> = {}
            shared.adds++
            setTimeout(() => {
              if (shared.failNext) { shared.failNext = false; tx.error = new Error('quota exceeded'); (tx.onabort as () => void)(); return }
              if (rows.has(key)) {
                r.error = {name: 'ConstraintError'}; (r.onerror as () => void)()
                tx.error = r.error; (tx.onerror as () => void)(); (tx.onabort as () => void)(); return
              }
              rows.set(key, structuredClone(value)); (tx.oncomplete as () => void)()
            }, 1)
            return r
          },
        })
        return tx
      }}
      ;(req.onsuccess as () => void)()
    })
    return req
  }}
  return Object.assign(shared, {factory: factory as unknown as IDBFactory})
}
function fakeLocks() {
  const held = new Map<string, Promise<void>>()
  return {request: async (name: string, _opts: unknown, callback: (lock: unknown) => Promise<unknown>) => {
    while (held.has(name)) await held.get(name)
    let release!: () => void
    held.set(name, new Promise<void>(resolve => { release = resolve }))
    try { return await callback({name}) } finally { held.delete(name); release() }
  }} as unknown as LockManager
}

// ---- drivePaidSession integration: the jar-signing stage through the durable path ----
function driver(store: ApplicationStore = createMemoryStore()) {
  const h = harness(store), key = ('0x' + 'ee'.repeat(32)) as Hex
  const request = {claims: {nonce: 'n'}} as VerifiedRequestObject
  const presentation: PaidWalletPresentation = {approved: {holder: 'h', credentials: ['a.b.c'], holder_proof: null, oauth: null, iat: 1000}, form: {response: 'jwe'}}
  const flags = {jar: false, sent: false, done: false}
  const proposal: PaidAgentProposal = {id: PROPOSAL, stage: 'presentation_sign', operator_key: key, unsigned_body: {stage: 'presentation_sign'}, expires: 1030}
  vi.mocked(h.session.sendRetainedApproval!).mockImplementation(async (approval: RetainedPaidApproval) => {
    h.sent.push(approval.body)
    const reply = h.replies.shift()!()
    if (reply.status === 'accepted') flags.jar = true
    return reply
  })
  Object.assign(h.session, {
    create: vi.fn(async () => {}), reconcile: vi.fn(async () => ({status: 'pending'})),
    requestObject: vi.fn(async () => { if (!flags.jar) throw new PaidAgentControlError(SESSION, 425); return {request, requestUri: 'https://agent.example/v1/request/' + SESSION, qrPayload: 'q'} }),
    proposals: vi.fn(async () => flags.jar ? [] : [proposal]),
    approveRequest: vi.fn(async () => { throw new Error('legacy single send used') }),
    presentations: vi.fn(async () => []),
    poll: vi.fn(async () => ({status: flags.sent ? 'done' as const : 'pending' as const, phase: 'awaiting_wallet' as const})),
  })
  const members = [{index: 0, operator: ('0x' + '11'.repeat(20)) as Hex, publicKey: key, proof: []}]
  const holder = {kind: 'local' as const, makePresentation: vi.fn(() => structuredClone(presentation)), submit: vi.fn(async () => { flags.sent = true })}
  const drive = (resume = false) => drivePaidSession({session: h.session, store, members, signal: new AbortController().signal, holder, wait: async () => {}, resume})
  return {...h, drive, holder, flags}
}

describe('drivePaidSession with durable approvals', () => {
  it('waits out a busy approval and resends the identical body; the legacy single send is not used', async () => {
    const d = driver()
    d.replies.push(busy(1000), accepted)
    expect((await d.drive()).status).toBe('done')
    expect(d.sent).toEqual([RETAINED.body, RETAINED.body])
    expect(d.session.prepareRequestApproval).toHaveBeenCalledTimes(1)
    expect(d.session.approveRequest).not.toHaveBeenCalled()
  })

  it('a resumed drive resends a busy-retained approval identically, without signing again', async () => {
    const d = driver()
    d.replies.push(busy(100_000))
    await expect(d.drive()).rejects.toBeInstanceOf(PaidBackoffError)
    d.replies.push(accepted)
    await expect(d.drive()).rejects.toBeInstanceOf(PaidSessionRecoveryError) // not a resume: refuses
    expect((await d.drive(true)).status).toBe('done')
    expect(d.sent).toEqual([RETAINED.body, RETAINED.body])
    expect(d.session.prepareRequestApproval).toHaveBeenCalledTimes(1)
  })

  it('a legacy prepared approval (no retained body) still refuses on resume, sending nothing', async () => {
    const store = createMemoryStore(), d = driver(store)
    await store.save('wallet-' + SESSION + '-create', {original: {sessionId: SESSION, paymentHash: undefined, initialization: undefined}, phase: 'confirmed'})
    await store.save(KEY, {original: ORIGINAL, phase: 'prepared'})
    await expect(d.drive(true)).rejects.toMatchObject({name: 'PaidSessionRecoveryError', key: KEY})
    expect(d.sent).toEqual([])
  })

  it('a store without claim keeps the single-send behaviour', async () => {
    const store = createMemoryStore()
    delete (store as {claim?: unknown}).claim
    const d = driver(store)
    vi.mocked(d.session.approveRequest).mockImplementation(async () => { d.flags.jar = true })
    expect((await d.drive()).status).toBe('done')
    expect(d.session.approveRequest).toHaveBeenCalledTimes(1)
    expect(d.session.prepareRequestApproval).not.toHaveBeenCalled()
    expect(d.sent).toEqual([])
  })
})

describe('batched first approvals', () => {
  const OTHER = 'ce'.repeat(32), KEY2 = 'wallet-' + SESSION + '-presentation_attest-1'
  const RETAINED2: RetainedPaidApproval = {proposalId: OTHER, body: '{"authorization":{"signature":"0x02","expires":1030}}', expires: 1030}
  const ORIGINAL2 = {...ORIGINAL, stage: 'presentation_attest'}
  function batch(store: ApplicationStore = createMemoryStore()) {
    const h = harness(store)
    const batches: RetainedPaidApproval[][] = [], replies: (() => unknown)[] = []
    const states: Record<string, string> = {}
    const session = h.session as unknown as Record<string, unknown>
    session.sendRetainedApprovals = vi.fn(async (approvals: RetainedPaidApproval[]) => {
      batches.push(structuredClone(approvals))
      const next = replies.shift()
      if (!next) throw new Error('unscripted batch')
      return next()
    })
    session.approvalState = vi.fn(async (id: string) => states[id] ?? 'pending')
    const signs = [vi.fn(async () => structuredClone(RETAINED)), vi.fn(async () => structuredClone(RETAINED2))]
    const items = [{ctx: h.ctx, original: ORIGINAL, sign: signs[0]!}, {ctx: {...h.ctx, key: KEY2}, original: ORIGINAL2, sign: signs[1]!}]
    const results = (a: number, b: number) => () => ({kind: 'results', results: new Map([[PROPOSAL, a], [OTHER, b]])})
    return {...h, batches, replies, states, signs, items, results, run: () => retainAndDeliverApprovals(items),
      record2: () => store.load<ApprovalJournalRecord>(KEY2), ledger2: () => readApprovalLedger(store, KEY2, OTHER)}
  }

  it('reads every record of the batch under its held locks at once, then stages them in proposal order (C20)', async () => {
    const inner = createMemoryStore()
    // Only the checks for an existing record (none exists yet) are counted, not the reads back after the commit.
    let reading = 0, most = 0
    const store: ApplicationStore = {...inner, load: async <T>(key: string) => {
      if (await inner.load(key) !== undefined) return inner.load<T>(key)
      reading++; most = Math.max(most, reading)
      try { await new Promise(done => setTimeout(done, 10)); return await inner.load<T>(key) } finally { reading-- }
    }, save: inner.save.bind(inner), withLock: inner.withLock.bind(inner), ...inner.claim ? {claim: inner.claim.bind(inner)} : {}}
    const b = batch(store)
    b.replies.push(b.results(204, 204))
    expect(await b.run()).toEqual([true, true])
    expect(most).toBeGreaterThanOrEqual(2)
    expect(b.batches).toEqual([[RETAINED, RETAINED2]])
  })

  it('retains each approval under its own key and permit, then sends them in ONE request', async () => {
    const b = batch()
    b.replies.push(b.results(204, 204))
    expect(await b.run()).toEqual([true, true])
    expect(b.batches).toEqual([[RETAINED, RETAINED2]])
    expect(b.signs.map(s => s.mock.calls.length)).toEqual([1, 1])
    expect(await b.record()).toEqual({original: ORIGINAL, phase: 'confirmed'})
    expect(await b.record2()).toEqual({original: ORIGINAL2, phase: 'confirmed'})
    expect(await b.ledger()).toEqual({state: 'in_flight', generation: 1})
    expect(await b.ledger2()).toEqual({state: 'in_flight', generation: 1})
    expect(b.session.sendRetainedApproval).not.toHaveBeenCalled()
  })

  it('resolves a per-entry 409 by reading the delivery state, and keeps a decided refusal in flight', async () => {
    const b = batch()
    b.states[PROPOSAL] = 'approved'
    b.replies.push(b.results(409, 422))
    await expect(b.run()).rejects.toMatchObject({httpStatus: 422})
    expect(await b.record()).toEqual({original: ORIGINAL, phase: 'confirmed'})
    expect((await b.record2())?.phase).toBe('prepared')
    expect(await b.ledger2()).toEqual({state: 'in_flight', generation: 1})
    const c = batch()
    c.replies.push(c.results(204, 409))
    await expect(c.run()).rejects.toMatchObject({reason: 'conflict'})
    expect((await c.record2())?.phase).toBe('prepared')
  })

  it('leaves every entry in flight on an unknown outcome and never resends it', async () => {
    const b = batch()
    b.replies.push(() => { throw new Error('socket hang up') })
    await expect(b.run()).rejects.toMatchObject({reason: 'outcome_unknown'})
    expect(await b.ledger()).toEqual({state: 'in_flight', generation: 1})
    expect(await b.ledger2()).toEqual({state: 'in_flight', generation: 1})
    expect(b.batches).toHaveLength(1)
    expect(b.session.sendRetainedApproval).not.toHaveBeenCalled()
  })

  it('after a busy refusal of the whole request, waits once and continues each entry alone under its next permit', async () => {
    const b = batch()
    b.replies.push(() => ({kind: 'busy', httpStatus: 429, hintMs: 1000}))
    b.session.sendRetainedApproval = vi.fn(async () => ({status: 'accepted' as const}))
    expect(await b.run()).toEqual([true, true])
    expect(b.time.sleeps).toEqual([1000])
    expect(vi.mocked(b.session.sendRetainedApproval).mock.calls.map(([a]) => a.body).sort()).toEqual([RETAINED.body, RETAINED2.body].sort())
    expect(await b.ledger()).toEqual({state: 'in_flight', generation: 2})
    expect(await b.ledger2()).toEqual({state: 'in_flight', generation: 2})
    expect(await b.record2()).toEqual({original: ORIGINAL2, phase: 'confirmed'})
  })

  it('sends nothing for an entry whose record already exists and reports it', async () => {
    const b = batch()
    await b.store.save(KEY2, {original: ORIGINAL2, phase: 'prepared'})
    b.replies.push(() => ({kind: 'results', results: new Map([[PROPOSAL, 204]])}))
    expect(await b.run()).toEqual([true, false])
    expect(b.batches).toEqual([[RETAINED]])
  })
})

describe('drivePaidSession: batch approvals when the agent advertises them', () => {
  function twoMembers(batchApprovals: boolean) {
    const d = driver(), other = ('0x' + 'ef'.repeat(32)) as Hex, OTHER = 'ce'.repeat(32)
    const second: PaidAgentProposal = {id: OTHER, stage: 'presentation_attest', operator_key: other, unsigned_body: {stage: 'presentation_attest'}, expires: 1030}
    const first: PaidAgentProposal = {id: PROPOSAL, stage: 'presentation_sign', operator_key: '0x' + 'ee'.repeat(32) as Hex, unsigned_body: {stage: 'presentation_sign'}, expires: 1030}
    const s = d.session as unknown as Record<string, unknown>
    s.proposals = vi.fn(async () => d.flags.jar ? [] : [first, second])
    s.prepareRequestApproval = vi.fn(async (p: PaidAgentProposal) => ({...structuredClone(RETAINED), proposalId: p.id}))
    s.batchApprovals = batchApprovals
    const batches: string[][] = []
    s.sendRetainedApprovals = vi.fn(async (approvals: RetainedPaidApproval[]) => {
      batches.push(approvals.map(a => a.proposalId)); d.flags.jar = true
      return {kind: 'results', results: new Map(approvals.map(a => [a.proposalId, 204]))}
    })
    vi.mocked(d.session.sendRetainedApproval!).mockImplementation(async () => { d.flags.jar = true; return {status: 'accepted'} })
    const members = [{index: 0, operator: ('0x' + '11'.repeat(20)) as Hex, publicKey: first.operator_key, proof: []}, {index: 1, operator: ('0x' + '22'.repeat(20)) as Hex, publicKey: other, proof: []}]
    const drive = () => drivePaidSession({session: d.session, store: d.store, members, signal: new AbortController().signal, holder: d.holder, wait: async () => {}})
    return {...d, drive, batches, OTHER}
  }

  it('approves both stages in one batch request, each with its own journal entry', async () => {
    const d = twoMembers(true)
    expect((await d.drive()).status).toBe('done')
    expect(d.batches).toEqual([[PROPOSAL, d.OTHER]])
    expect(d.session.sendRetainedApproval).not.toHaveBeenCalled()
    expect(d.session.prepareRequestApproval).toHaveBeenCalledTimes(2)
    expect(await d.store.load(KEY)).toEqual({original: expect.objectContaining({stage: 'presentation_sign'}), phase: 'confirmed'})
    expect(await d.store.load('wallet-' + SESSION + '-presentation_attest-1')).toEqual({original: expect.objectContaining({stage: 'presentation_attest'}), phase: 'confirmed'})
  })

  it('falls back to one request per approval, unchanged, when the agent does not advertise batches', async () => {
    const d = twoMembers(false)
    expect((await d.drive()).status).toBe('done')
    expect(d.batches).toEqual([])
    expect(d.session.sendRetainedApproval).toHaveBeenCalledTimes(2)
  })
})

// One durable commit per first approval (record, body and in_flight(1) together, before the send),
// and a confirmation re-derived by recovery: what a crash at each step leaves, and what follows.
describe('first approvals: one commit before the send, a re-derivable confirmation', () => {
  it('commits record, body and in_flight(1) with ONE data flush and ONE directory flush before the send, and takes no claim for it', async () => {
    const dir = await directory(), h = harness(createFileStore(dir))
    const before = {...fileStoreSyncCounters}
    let atSend: {flushes: number; record?: unknown; ledger?: unknown} | undefined
    vi.mocked(h.session.sendRetainedApproval!).mockImplementationOnce(async () => {
      // What a crash during the send leaves, read through another store object (another process).
      const other = createFileStore(dir)
      atSend = {flushes: fileStoreSyncCounters.flushes - before.flushes,
        record: await other.load(KEY), ledger: await readApprovalLedger(other, KEY, PROPOSAL)}
      return {status: 'accepted'}
    })
    expect(await h.first()).toBe(true)
    expect(atSend).toEqual({flushes: 2, record: {original: ORIGINAL, phase: 'prepared', approval: {schema: APPROVAL_LEDGER_SCHEMA, ...RETAINED}},
      ledger: {state: 'in_flight', generation: 1}})
    expect(await h.store.load(approvalClaimKey(KEY, 1))).toBeUndefined()
    expect(await h.record()).toEqual({original: ORIGINAL, phase: 'confirmed'})
  })

  it('while the first send is in flight another process can never send generation 1: it finds in_flight(1) and sends nothing', async () => {
    const dir = await directory(), a = harness(createFileStore(dir)), b = harness(createFileStore(dir))
    let other: unknown
    vi.mocked(a.session.sendRetainedApproval!).mockImplementationOnce(async (approval: RetainedPaidApproval) => {
      a.sent.push(approval.body)
      other = await b.resume().catch((e: unknown) => e)
      return {status: 'accepted'}
    })
    expect(await a.first()).toBe(true)
    expect(other).toMatchObject({name: 'PaidApprovalUnresolvedError', reason: 'outcome_unknown', generation: 1})
    expect(b.sent).toEqual([])
    expect(a.sent).toEqual([RETAINED.body])
  })

  it('a crash that kept the ledger but not the record: nothing was sent, so a fresh first approval sends exactly once', async () => {
    const h = harness()
    await h.store.save(approvalLedgerKey(KEY), {schema: 2, proposalId: PROPOSAL, state: 'in_flight', generation: 1})
    h.replies.push(accepted)
    expect(await h.first()).toBe(true)
    expect(h.sent).toEqual([RETAINED.body])
    expect(await h.ledger()).toEqual({state: 'in_flight', generation: 1})
    expect((await h.record())?.phase).toBe('confirmed')
  })

  it('a crash that kept the record but not the ledger: never sent, unresolved', async () => {
    const h = harness()
    await h.store.save(KEY, {original: ORIGINAL, phase: 'prepared', approval: {schema: 2, ...RETAINED}})
    await expect(h.resume()).rejects.toMatchObject({reason: 'no_permit'})
    expect(h.sent).toEqual([])
  })

  it('a crash before the re-derivable confirmation is written: the resume reads the delivery, confirms it and sends nothing', async () => {
    const h = harness(), later = new Rederivable()
    h.replies.push(accepted)
    expect(await retainAndDeliverApproval({...h.ctx, rederivable: later}, ORIGINAL, h.sign)).toBe(true)
    // The confirmation waits for the flow's next commit; the process dies before it.
    expect((await h.record())?.phase).toBe('prepared')
    h.agent.state = 'approved'
    expect(await h.resume()).toBe('accepted')
    expect((await h.record())?.phase).toBe('confirmed')
    expect(h.sent).toHaveLength(1)
  })

  it('a first-approval commit that fails sends nothing and gives the flow\'s pending writes back', async () => {
    const inner = createMemoryStore(), later = new Rederivable()
    const store: ApplicationStore = {load: inner.load.bind(inner), withLock: inner.withLock.bind(inner), claim: inner.claim!.bind(inner),
      save: async (key, value) => { if (key.endsWith('.attempt')) throw new Error('disk full'); return inner.save(key, value) }}
    const h = harness(store)
    later.put('wallet-' + SESSION + '-create', {phase: 'confirmed'})
    await expect(retainAndDeliverApproval({...h.ctx, rederivable: later}, ORIGINAL, h.sign)).rejects.toThrow('disk full')
    expect(h.sent).toEqual([])
    expect(later.take()).toEqual([['wallet-' + SESSION + '-create', {phase: 'confirmed'}]])
  })

  it('a batch of first approvals is ONE commit (with what the flow had pending) before its one request', async () => {
    const dir = await directory(), store = createFileStore(dir), h = harness(store), later = new Rederivable()
    later.put('wallet-' + SESSION + '-create', {original: {}, phase: 'confirmed'})
    const keys = [KEY, 'wallet-' + SESSION + '-presentation_attest-1', 'wallet-' + SESSION + '-presentation_attest-2']
    const session = h.session as unknown as Record<string, unknown>
    const before = {...fileStoreSyncCounters}
    let atSend: unknown
    session.sendRetainedApprovals = vi.fn(async (approvals: RetainedPaidApproval[]) => {
      atSend = {flushes: fileStoreSyncCounters.flushes - before.flushes,
        ledgers: await Promise.all(keys.map((k, i) => readApprovalLedger(createFileStore(dir), k, 'p' + i))), create: await createFileStore(dir).load('wallet-' + SESSION + '-create')}
      return {kind: 'results', results: new Map(approvals.map(a => [a.proposalId, 204]))}
    })
    const items = keys.map((key, i) => ({ctx: {...h.ctx, key, rederivable: later}, original: {...ORIGINAL, n: i}, sign: async () => ({...RETAINED, proposalId: 'p' + i})}))
    expect(await retainAndDeliverApprovals(items)).toEqual([true, true, true])
    expect(atSend).toEqual({flushes: 2, ledgers: keys.map(() => ({state: 'in_flight', generation: 1})), create: {original: {}, phase: 'confirmed'}})
    // Their confirmations wait for the flow's next commit.
    expect(later.take().map(([k]) => k).sort()).toEqual([...keys].sort())
  })
})
