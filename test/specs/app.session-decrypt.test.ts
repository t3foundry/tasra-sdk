import {describe, expect, it, vi, beforeEach} from 'vitest'
import {bls12_381} from '@noble/curves/bls12-381'
import {concatBytes} from '@noble/hashes/utils'
import {PaidDrawMovedError} from '../../src/chain/prepaid.js'
import {decodeKemU, encrypt, type Ciphertext, type DecryptShare} from '../../src/crypto/kem.js'
import {SessionEndedError} from '../../src/app/session-grants.js'
import {PaidReservationStaleEpochError} from '../../src/chain/reservation.js'

// decryptInSession composes paidSessionDecrypt, decryptWithSessionGrant and the session's beacon
// follow: the two network halves are stand-ins here (their own suites cover their wires), the
// session is a fake whose grant moves one epoch per refresh, and the beacon rolls DURING a message.
const paidSessionDecrypt = vi.fn()
const decryptWithSessionGrant = vi.fn()
// The real error classes (NewerVerifierEpoch is classified by class AND code), the payment stubbed.
vi.mock('../../src/app/paid-operation.js', async original => ({...await original<typeof import('../../src/app/paid-operation.js')>(),
  paidSessionDecrypt: (...a: unknown[]) => paidSessionDecrypt(...a)}))
vi.mock('../../src/decryption/session.js', () => ({decryptWithSessionGrant: (...a: unknown[]) => decryptWithSessionGrant(...a)}))
// The default staleness confirmation (no `latestBeaconEpoch`): a stand-in that answers the RPC
// `latest` head only when asked for it fresh, and the followed (lagging) tip otherwise.
const readCurrentBeaconEpoch = vi.fn()
vi.mock('../../src/chain/prepaid.js', async original => ({...await original<typeof import('../../src/chain/prepaid.js')>(),
  readCurrentBeaconEpoch: (...a: unknown[]) => readCurrentBeaconEpoch(...a)}))
const {decryptInSession, SessionMessageError} = await import('../../src/app/session-decrypt.js')
const {NewerVerifierEpoch} = await import('../../src/app/paid-operation.js')

const slot = ('0x' + '01'.repeat(32)) as `0x${string}`
const seedOf = (e: number) => '0x' + e.toString(16).padStart(64, '0')

/** A session whose grant is at `epoch` and which refreshes one epoch at a time, as the agent continues it. */
function fakeSession(epoch: number, opts: {endsWhenTwoBehind?: boolean} = {}) {
  const state = {epoch, beacon: undefined as bigint | undefined, refreshes: 0}
  const session = {
    get beaconEpoch() { return state.beacon },
    get key() { return {jwk: {}} },
    current: () => ({epoch: state.epoch, seed: seedOf(state.epoch)}),
    verifiedFor: async () => ({epoch: state.epoch}),
    // As GrantedSession: an observation past the grant starts the follow in the background.
    observeBeacon: (e: bigint) => {
      if (state.beacon === undefined || e > state.beacon) state.beacon = e
      if (BigInt(state.epoch) < state.beacon) void session.followBeacon().catch(() => undefined)
    },
    followBeacon: async () => {
      let moved = false
      while (state.beacon !== undefined && BigInt(state.epoch) < state.beacon) {
        if (opts.endsWhenTwoBehind && BigInt(state.epoch) + 1n < state.beacon) throw new SessionEndedError('session_expired', 'expired')
        state.epoch++; state.refreshes++; moved = true
      }
      return moved
    },
  }
  return {state, session: session as never}
}

let payments: {epoch: number; requestId: string}[]
/** The chain's beacon epoch the helper's fresh reads see; undefined makes the read fail. */
let chainEpoch: bigint | undefined
let chainReads: number
beforeEach(() => {
  payments = []; chainEpoch = undefined; chainReads = 0
  paidSessionDecrypt.mockReset(); decryptWithSessionGrant.mockReset()
  paidSessionDecrypt.mockImplementation(async (_config: unknown, req: {grant: {epoch: number}; onRequestId?(id: string): Promise<void>; onBeaconEpoch?(e: bigint): void}) => {
    const requestId = '0x' + String(payments.length + 1).padStart(64, '0')
    payments.push({epoch: req.grant.epoch, requestId})
    await req.onRequestId?.(requestId)
    return {requestId, payment: {verification_epoch: req.grant.epoch}, approveExecution: vi.fn(), recoverPartial: vi.fn(), dispose: vi.fn()}
  })
})
// A 2-of-3 Shamir sharing of the slot key over Fr (keeper identifiers 1..3): a re-open's decrypt
// shares are real, so the helper's own verification and AEAD open run.
const G1 = bls12_381.G1.ProjectivePoint, G2 = bls12_381.G2.ProjectivePoint, ORDER = bls12_381.fields.Fr.ORDER
const sk = (id: number) => (0x1234567n + 0x7654321n * BigInt(id)) % ORDER
const mpk = G2.BASE.multiply(sk(0)).toRawBytes(true)
const verifyingShares = new Map([1, 2, 3].map(id => [id, concatBytes(G2.BASE.multiply(sk(id)).toRawBytes(true), G1.BASE.multiply(sk(id)).toRawBytes(true))]))
const kemMessage = (text: string) => {
  const identity = new TextEncoder().encode('room-7')
  return {ciphertext: encrypt(mpk, identity, new TextEncoder().encode(text)), identity, recipient: {} as never, ciphertextEpoch: 0, decryption: {content_digest: '0x'} as never}
}
/** The decrypt shares a presentation over `ct` opens (D_i = sk_i·U). */
const sharesFor = (ct: Ciphertext, ids = [1, 2]): DecryptShare[] =>
  ids.map(id => ({id, decryptionShare: decodeKemU(ct.u)!.multiply(sk(id)).toRawBytes(true), verifyingShare: verifyingShares.get(id)!}))
const P = ('0x' + 'ab'.repeat(32)) as `0x${string}`
const text = (b: Uint8Array) => new TextDecoder().decode(b)
const message = kemMessage('in flight')
const request = (session: never, m = message) => ({config: {} as never, session, slot, keepers: {nodeUrls: ['a', 'b', 'c'], chainId: 43112, verifyingShares, threshold: 2},
  verifierProofs: async (_s: string, e: bigint) => [{verifier_index: Number(e), operator: '0x', pubkey: '0x', proof: []}], message: m,
  latestBeaconEpoch: async () => { chainReads++; if (chainEpoch === undefined) throw new Error('rpc down'); return chainEpoch }})
const stale = (latest: number) => ({ok: false, error: 'stale', codes: ['status 403'], stale: true,
  refusals: [{nodeUrl: 'a', status: 403, code: 'status 403', scope: 'request', message: `committee token epoch 1 is not current (beacon latest ${latest}); x`}]})

describe('one message across a beacon-epoch boundary (C19)', () => {
  it('the beacon rolls twice while the message is in flight: keepers refuse it as stale; the grant is refreshed and the message re-paid ONCE on the new draw', async () => {
    const {state, session} = fakeSession(478)
    chainEpoch = 480n
    decryptWithSessionGrant.mockResolvedValueOnce([stale(480)]).mockResolvedValueOnce([{ok: true, plaintext: new Uint8Array([7])}])
    const retries: string[] = []
    const r = await decryptInSession({...request(session), hooks: {onRetry: reason => retries.push(reason)}})
    expect(r.plaintext).toEqual(new Uint8Array([7]))
    expect(retries).toEqual(['stale'])
    // The second payment names the REFRESHED grant's draw, and its keepers get that epoch's grant and proofs.
    expect(payments.map(p => p.epoch)).toEqual([478, 480])
    expect(r.requestIds).toHaveLength(2)
    expect(r.grantEpoch).toBe(480n)
    const second = decryptWithSessionGrant.mock.calls[1]![0] as {grant: {epoch: number}; verifierProofs: {verifier_index: number}[]}
    expect(second.grant.epoch).toBe(480)
    expect(second.verifierProofs[0]!.verifier_index).toBe(480)
    expect(state.refreshes).toBe(2)
  })

  it('retries at most once: a second stale refusal is the caller\'s error', async () => {
    const {session} = fakeSession(10)
    chainEpoch = 12n
    decryptWithSessionGrant.mockResolvedValue([stale(12)])
    await expect(decryptInSession(request(session))).rejects.toBeInstanceOf(SessionMessageError)
    expect(payments).toHaveLength(2)
  })

  it('never pays again for a refusal that is not stale (a keeper may have run it)', async () => {
    const {session} = fakeSession(10)
    decryptWithSessionGrant.mockResolvedValue([{ok: false, error: 'x', codes: ['recoverable'], refusals: [], stale: false}])
    await expect(decryptInSession(request(session))).rejects.toMatchObject({code: 'recoverable'})
    expect(payments).toHaveLength(1)
    expect(decryptWithSessionGrant).toHaveBeenCalledTimes(1)
  })

  it('a beacon move seen by the payment\'s discovery is reported to the session before anything is sent', async () => {
    const {state, session} = fakeSession(20)
    paidSessionDecrypt.mockImplementationOnce(async (_c: unknown, req: {grant: {epoch: number}; onBeaconEpoch?(e: bigint): void; onRequestId?(id: string): Promise<void>}) => {
      req.onBeaconEpoch?.(21n)
      payments.push({epoch: req.grant.epoch, requestId: '0x1'})
      await req.onRequestId?.('0x1')
      return {requestId: '0x1', payment: {}, approveExecution: vi.fn(), recoverPartial: vi.fn(), dispose: vi.fn()}
    })
    decryptWithSessionGrant.mockResolvedValue([{ok: true, plaintext: new Uint8Array([1])}])
    await decryptInSession(request(session))
    expect(state.beacon).toBe(21n)
    // The next message waits for nothing: the grant follows to 21 first and pays there.
    await decryptInSession(request(session))
    expect(payments.map(p => p.epoch)).toEqual([20, 21])
  })

  it('a grant one epoch behind serves the message at once: it never waits for a follow still in progress (C19 hang)', async () => {
    const {state, session} = fakeSession(20)
    // The refresh never completes (the new epoch's anchors have not landed at the agent).
    let follows = 0
    ;(session as {followBeacon(): Promise<boolean>}).followBeacon = () => { follows++; return new Promise<boolean>(() => undefined) }
    ;(session as {observeBeacon(e: bigint): void}).observeBeacon(21n)
    decryptWithSessionGrant.mockResolvedValue([{ok: true, plaintext: new Uint8Array([4])}])
    const r = await decryptInSession(request(session))
    expect(r.grantEpoch).toBe(20n)
    expect(payments.map(p => p.epoch)).toEqual([20])
    expect(state.epoch).toBe(20)
    // The follow was (re)started in the background, never awaited.
    expect(follows).toBeGreaterThan(0)
  }, 2_000)

  it('a draw that moved before anything was signed (PaidDrawMovedError) refreshes and pays once on the new draw', async () => {
    const {session} = fakeSession(30)
    // Discovery refuses a pinned epoch only once it is neither the beacon's latest nor previous.
    paidSessionDecrypt.mockRejectedValueOnce(new PaidDrawMovedError(30n, 32n))
    decryptWithSessionGrant.mockResolvedValue([{ok: true, plaintext: new Uint8Array([2])}])
    const r = await decryptInSession(request(session))
    expect(r.grantEpoch).toBe(32n)
    expect(payments.map(p => p.epoch)).toEqual([32])
  })

  it('a grant the beacon left behind for good ends the session (present again), with nothing paid twice', async () => {
    const {session} = fakeSession(40, {endsWhenTwoBehind: true})
    chainEpoch = 42n
    decryptWithSessionGrant.mockResolvedValueOnce([stale(42)])
    await expect(decryptInSession(request(session))).rejects.toBeInstanceOf(SessionEndedError)
    expect(payments).toHaveLength(1)
  })

  it('a keeper\'s forged "beacon latest" never reaches the session: only a fresh chain read does (review F1)', async () => {
    const {state, session} = fakeSession(478)
    chainEpoch = 480n
    decryptWithSessionGrant.mockResolvedValueOnce([stale(99_999)]).mockResolvedValueOnce([{ok: true, plaintext: new Uint8Array([7])}])
    const r = await decryptInSession(request(session))
    expect(r.grantEpoch).toBe(480n)
    expect(chainReads).toBe(1)
    // The session follows the chain's 480, not the keeper's 99999; the next message is not poisoned.
    expect(state.beacon).toBe(480n)
    decryptWithSessionGrant.mockResolvedValueOnce([{ok: true, plaintext: new Uint8Array([8])}])
    expect((await decryptInSession(request(session))).grantEpoch).toBe(480n)
  })

  it('an unreadable chain after a stale refusal pays nothing again', async () => {
    const {state, session} = fakeSession(10)
    decryptWithSessionGrant.mockResolvedValue([stale(12)])
    await expect(decryptInSession(request(session))).rejects.toBeInstanceOf(SessionMessageError)
    expect(payments).toHaveLength(1)
    expect(state.beacon).toBeUndefined()
  })

  it('keepers claiming "stale" while the chain says the grant is admissible: no retry, no second debit (review F2)', async () => {
    for (const chain of [10n, 11n]) {
      payments = []; decryptWithSessionGrant.mockReset()
      const {state, session} = fakeSession(10)
      chainEpoch = chain
      const retries: string[] = []
      // A keeper computed its partial and answered "not current" anyway; the others refused before execution.
      decryptWithSessionGrant.mockResolvedValue([stale(12)])
      await expect(decryptInSession({...request(session), hooks: {onRetry: reason => retries.push(reason)}})).rejects.toBeInstanceOf(SessionMessageError)
      expect(payments).toHaveLength(1)
      expect(decryptWithSessionGrant).toHaveBeenCalledTimes(1)
      expect(retries).toEqual([])
      // The chain's own epoch is a fair observation: one past the grant starts its background follow
      // (never a second payment); the chain at the grant's epoch moves nothing.
      expect(state.refreshes).toBe(chain > 10n ? 1 : 0)
    }
  })
})

describe('the default staleness confirmation reads a fresh head (C21)', () => {
  it('a stale refusal is confirmed at the RPC `latest` head, never the followed tip one push behind', async () => {
    const {session} = fakeSession(10)
    // The followed tip still says 11 (the grant admissible); the RPC latest head says 12.
    readCurrentBeaconEpoch.mockReset().mockImplementation(async (_c: unknown, _d: unknown, opts?: {fresh?: boolean}) => opts?.fresh ? 12n : 11n)
    decryptWithSessionGrant.mockResolvedValueOnce([stale(12)]).mockResolvedValueOnce([{ok: true, plaintext: new Uint8Array([7])}])
    const {latestBeaconEpoch: _fresh, ...defaults} = request(session)
    const r = await decryptInSession({...defaults, config: {chain: {client: {}}, deployment: {}} as never})
    expect(readCurrentBeaconEpoch).toHaveBeenCalledTimes(1)
    expect(readCurrentBeaconEpoch.mock.calls[0]![2]).toEqual({fresh: true})
    expect(payments.map(p => p.epoch)).toEqual([10, 12])
    expect(r.plaintext).toEqual(new Uint8Array([7]))
  })
})

describe('a session that ends under a message is re-opened once; its presentation serves the message (C20, review F1/F2)', () => {
  /** A session that has already ended (a definite refusal, or the beacon two epochs past it). */
  function endedSession(code = 'session_context_changed') {
    const {session} = fakeSession(0)
    const s = session as {current(): unknown}
    s.current = () => { throw new SessionEndedError(code, 'ended') }
    return session
  }

  it('an end before payment: the presentation\'s shares decrypt THIS message; its payment is the message\'s one debit', async () => {
    const next = fakeSession(60)
    const reopens: string[] = []
    const reopen = vi.fn(async (_e: SessionEndedError, m: typeof message, budget: {debits: number}) => {
      expect(m).toBe(message)
      expect(budget).toEqual({debits: 2})
      return {shares: sharesFor(m.ciphertext), requestIds: [P], session: next.session}
    })
    const r = await decryptInSession({...request(endedSession()), reopen, hooks: {onReopen: code => reopens.push(code)}})
    expect(text(r.plaintext)).toBe('in flight')
    expect(r).toMatchObject({presented: true, grantEpoch: 60n, requestIds: [P]})
    expect(r.session).toBe(next.session)
    expect(reopens).toEqual(['session_context_changed'])
    expect(payments).toHaveLength(0)
    expect(decryptWithSessionGrant).not.toHaveBeenCalled()
  })

  it('without `reopen` the end is thrown, nothing paid', async () => {
    await expect(decryptInSession(request(endedSession()))).rejects.toMatchObject({code: 'session_context_changed'})
    expect(payments).toHaveLength(0)
  })

  it('shares of ANOTHER message never become this message\'s plaintext, and are zeroed (review F2)', async () => {
    const other = kemMessage('someone else')
    const shares = sharesFor(other.ciphertext)
    await expect(decryptInSession({...request(endedSession()), reopen: async () => ({shares, requestIds: [P], session: fakeSession(60).session})}))
      .rejects.toThrow(/do not decrypt this message/)
    expect(shares.every(s => s.decryptionShare.every(b => b === 0))).toBe(true)
    // Valid shares paired with forged verifying shares are re-bound to the keepers' authenticated ones.
    const forged = sharesFor(message.ciphertext).map(s => ({...s, verifyingShare: new Uint8Array(144)}))
    const r = await decryptInSession({...request(endedSession()), reopen: async () => ({shares: forged, requestIds: [P]})})
    expect(text(r.plaintext)).toBe('in flight')
    expect(r.session).toBeUndefined()
    expect(r.grantEpoch).toBe(0n)
    // A bad share beside enough good ones is dropped by the per-share check, never combined.
    const mixed = sharesFor(message.ciphertext, [1, 2, 3])
    mixed[0]!.decryptionShare = G2.BASE.multiply(5n).toRawBytes(true)
    const m2 = await decryptInSession({...request(endedSession()), reopen: async () => ({shares: mixed, requestIds: [P]})})
    expect(text(m2.plaintext)).toBe('in flight')
  })

  it('a re-open that names no payment, or more than the message may still pay, is refused', async () => {
    for (const requestIds of [[], [P, P, P]]) {
      await expect(decryptInSession({...request(endedSession()), reopen: async () => ({shares: sharesFor(message.ciphertext), requestIds})}))
        .rejects.toThrow(/must name its presentation's payment/)
    }
  })

  it('a confirmed-stale refusal whose follow ends the session: the re-open serves it; debits = the message\'s one + the presentation (review F1)', async () => {
    const {session} = fakeSession(40, {endsWhenTwoBehind: true})
    chainEpoch = 42n
    const budgets: number[] = []
    const reopen = vi.fn(async (_e: SessionEndedError, m: typeof message, budget: {debits: number}) => {
      budgets.push(budget.debits)
      return {shares: sharesFor(m.ciphertext), requestIds: [P], session: fakeSession(42).session}
    })
    decryptWithSessionGrant.mockResolvedValueOnce([stale(42)]).mockResolvedValue([{ok: true, plaintext: new Uint8Array([9])}])
    const r = await decryptInSession({...request(session), reopen})
    expect(text(r.plaintext)).toBe('in flight')
    expect(reopen).toHaveBeenCalledTimes(1)
    expect(budgets).toEqual([1])
    // One message payment (40), then the presentation: two debits, nothing paid on the new grant.
    expect(payments.map(p => p.epoch)).toEqual([40])
    expect(r.requestIds).toEqual([payments[0]!.requestId, P])
    expect(decryptWithSessionGrant).toHaveBeenCalledTimes(1)
  })

  it('the bound counts debits, not request ids: an allowance fallback\'s refused id leaves the presentation its budget', async () => {
    const {session} = fakeSession(40, {endsWhenTwoBehind: true})
    chainEpoch = 42n
    // The allowance debit was refused (an id, no debit), the per-operation fallback paid (a second id).
    paidSessionDecrypt.mockImplementationOnce(async (_c: unknown, req: {grant: {epoch: number}; onRequestId?(id: string): Promise<void>}) => {
      await req.onRequestId?.('0x' + 'f1'.repeat(32)); await req.onRequestId?.('0x' + 'f2'.repeat(32))
      payments.push({epoch: req.grant.epoch, requestId: '0x' + 'f2'.repeat(32)})
      return {requestId: '0x' + 'f2'.repeat(32), payment: {}, approveExecution: vi.fn(), recoverPartial: vi.fn(), dispose: vi.fn()}
    })
    decryptWithSessionGrant.mockResolvedValueOnce([stale(42)])
    const reopen = vi.fn(async (_e: SessionEndedError, m: typeof message, budget: {debits: number}) =>
      ({shares: sharesFor(m.ciphertext), requestIds: Array.from({length: budget.debits}, () => P)}))
    const r = await decryptInSession({...request(session), reopen})
    expect(reopen.mock.calls[0]![2]).toEqual({debits: 1})
    expect(r.requestIds).toEqual(['0x' + 'f1'.repeat(32), '0x' + 'f2'.repeat(32), P])
  })
})

describe('concurrent messages of one ended session share ONE re-open (review F3)', () => {
  function endedSession() {
    const {session} = fakeSession(0)
    ;(session as {current(): unknown}).current = () => { throw new SessionEndedError('local-stale', 'ended') }
    return session
  }

  it('one presentation serves the first message; the others continue on its new session, each paying its own decrypt', async () => {
    const ended = endedSession(), next = fakeSession(51)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const reopen = vi.fn(async (_e: SessionEndedError, m: typeof message) => { await gate; return {shares: sharesFor(m.ciphertext), requestIds: [P], session: next.session} })
    decryptWithSessionGrant.mockResolvedValue([{ok: true, plaintext: new Uint8Array([5])}])
    const messages = ['one', 'two', 'three'].map(kemMessage)
    const runs = messages.map(m => decryptInSession({...request(ended, m), reopen}))
    await new Promise(resolve => setTimeout(resolve, 10))
    release()
    const results = await Promise.all(runs)
    expect(reopen).toHaveBeenCalledTimes(1)
    expect(text(results[0]!.plaintext)).toBe('one')
    expect(results[0]).toMatchObject({presented: true, requestIds: [P]})
    for (const r of results.slice(1)) {
      expect(r.presented).toBeUndefined()
      expect(r.plaintext).toEqual(new Uint8Array([5]))
      expect(r.session).toBe(next.session)
      expect(r.requestIds).toHaveLength(1)
    }
    expect(payments.map(p => p.epoch)).toEqual([51, 51])
    // A later message on the ended session continues on its successor: no presentation.
    const late = await decryptInSession({...request(ended, kemMessage('late')), reopen})
    expect(late.session).toBe(next.session)
    expect(reopen).toHaveBeenCalledTimes(1)
  })

  it('a shared re-open that fails fails its waiters with their own end, without another presentation', async () => {
    const ended = endedSession()
    const reopen = vi.fn(async () => { await new Promise(resolve => setTimeout(resolve, 5)); throw new Error('presentation refused') })
    const runs = [kemMessage('a'), kemMessage('b')].map(m => decryptInSession({...request(ended, m), reopen}))
    const [first, second] = await Promise.allSettled(runs)
    expect(first).toMatchObject({status: 'rejected', reason: {message: 'presentation refused'}})
    expect(second).toMatchObject({status: 'rejected', reason: {code: 'local-stale'}})
    expect(reopen).toHaveBeenCalledTimes(1)
  })
})

describe('a reservation the accountant refused as a stale draw (C21, 110 ms)', () => {
  const refused = (epoch: number, code = 'reservation-refused') => Object.assign(new Error('Paid operation stopped during reservation'), {code, cause: new PaidReservationStaleEpochError(epoch)})

  it('retries once, on a re-opened session, only when a fresh chain read confirms the grant left the window', async () => {
    const {session} = fakeSession(70, {endsWhenTwoBehind: true})
    chainEpoch = 72n
    paidSessionDecrypt.mockRejectedValueOnce(refused(70))
    const retries: string[] = []
    const reopen = vi.fn(async (_e: SessionEndedError, m: typeof message) => ({shares: sharesFor(m.ciphertext), requestIds: [P], session: fakeSession(72).session}))
    const r = await decryptInSession({...request(session), reopen, hooks: {onRetry: reason => retries.push(reason)}})
    expect(text(r.plaintext)).toBe('in flight')
    expect(retries).toEqual(['reservation-stale'])
    expect(reopen).toHaveBeenCalledTimes(1)
  })

  it('throws, paying nothing more, while the chain says the grant is admissible', async () => {
    const {session} = fakeSession(70)
    chainEpoch = 71n
    paidSessionDecrypt.mockRejectedValueOnce(refused(70))
    await expect(decryptInSession(request(session))).rejects.toThrow(/stopped during reservation/)
    expect(paidSessionDecrypt).toHaveBeenCalledTimes(1)
  })

  it('only a `reservation-refused` (nothing sent) is retried: an uncertain reservation with the same cause is not (review F6)', async () => {
    const {session} = fakeSession(70)
    chainEpoch = 72n
    paidSessionDecrypt.mockRejectedValueOnce(refused(70, 'reservation-uncertain'))
    const retries: string[] = []
    await expect(decryptInSession({...request(session), hooks: {onRetry: reason => retries.push(reason)}})).rejects.toThrow(/stopped during reservation/)
    expect(paidSessionDecrypt).toHaveBeenCalledTimes(1)
    expect(retries).toEqual([])
  })
})

describe('a reservation refused before it was sent: the verifier epoch moved on while it waited for its payer (110 ms)', () => {
  /** paidSessionDecrypt as it fails then: the request id was named, the reservation refused unsent, the journal `failed`. */
  const supersede = (beacon: bigint) => async (_config: unknown, req: {grant: {epoch: number}; onRequestId?(id: string): Promise<void>}) => {
    const requestId = '0x' + String(payments.length + 1).padStart(64, '0')
    payments.push({epoch: req.grant.epoch, requestId})
    await req.onRequestId?.(requestId)
    throw new NewerVerifierEpoch(requestId as `0x${string}`, beacon)
  }

  it('pays once more on the refreshed grant; the refusal is no debit, its id is listed', async () => {
    const {state, session} = fakeSession(90)
    paidSessionDecrypt.mockImplementationOnce(supersede(92n))
    decryptWithSessionGrant.mockResolvedValueOnce([{ok: true, plaintext: new Uint8Array([9])}])
    const retries: string[] = []
    const r = await decryptInSession({...request(session), hooks: {onRetry: reason => retries.push(reason)}})
    expect(r.plaintext).toEqual(new Uint8Array([9]))
    expect(retries).toEqual(['newer-verifier-epoch'])
    // The retry names the refreshed grant's draw (the error's own chain read started the follow).
    expect(payments.map(p => p.epoch)).toEqual([90, 92])
    expect(state.epoch).toBe(92)
    expect(r.grantEpoch).toBe(92n)
    expect(r.requestIds).toEqual(payments.map(p => p.requestId))
    // Only the paid attempt reached the keepers; no keeper claim and no extra chain read was needed.
    expect(decryptWithSessionGrant).toHaveBeenCalledTimes(1)
    expect((decryptWithSessionGrant.mock.calls[0]![0] as {grant: {epoch: number}}).grant.epoch).toBe(92)
    expect(chainReads).toBe(0)
  })

  it('a second one on the retry is thrown, not looped (class and code pinned)', async () => {
    const {session} = fakeSession(90)
    paidSessionDecrypt.mockImplementationOnce(supersede(92n)).mockImplementationOnce(supersede(94n))
    const retries: string[] = []
    const error = await decryptInSession({...request(session), hooks: {onRetry: reason => retries.push(reason)}}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(NewerVerifierEpoch)
    expect(error).toMatchObject({code: 'newer-verifier-epoch', name: 'NewerVerifierEpoch', beaconEpoch: 94n})
    expect(paidSessionDecrypt).toHaveBeenCalledTimes(2)
    expect(decryptWithSessionGrant).not.toHaveBeenCalled()
    expect(retries).toEqual(['newer-verifier-epoch'])
  })

  it('does not stretch the two-debit bound: after a confirmed-stale retry it is paid once more, never a third debit', async () => {
    const {session} = fakeSession(10)
    chainEpoch = 12n
    // Debit 1 at epoch 10, refused stale (confirmed); the re-payment is refused unsent; debit 2 serves it.
    paidSessionDecrypt.mockImplementationOnce(async (_c: unknown, req: {grant: {epoch: number}; onRequestId?(id: string): Promise<void>}) => {
      const requestId = '0x' + String(payments.length + 1).padStart(64, '0')
      payments.push({epoch: req.grant.epoch, requestId})
      await req.onRequestId?.(requestId)
      return {requestId, payment: {verification_epoch: req.grant.epoch}, approveExecution: vi.fn(), recoverPartial: vi.fn(), dispose: vi.fn()}
    }).mockImplementationOnce(supersede(14n))
    decryptWithSessionGrant.mockResolvedValueOnce([stale(12)]).mockResolvedValueOnce([{ok: true, plaintext: new Uint8Array([3])}])
    const retries: string[] = []
    const r = await decryptInSession({...request(session), hooks: {onRetry: reason => retries.push(reason)}})
    expect(r.plaintext).toEqual(new Uint8Array([3]))
    expect(retries).toEqual(['stale', 'newer-verifier-epoch'])
    expect(payments.map(p => p.epoch)).toEqual([10, 12, 14])
    // Two keeper sends = the two debits; the unsent refusal between them is listed but debited nothing.
    expect(decryptWithSessionGrant).toHaveBeenCalledTimes(2)
    expect(r.requestIds).toHaveLength(3)
  })

  it('an Error that only resembles it (same message, no class) is thrown as before', async () => {
    const {session} = fakeSession(90)
    paidSessionDecrypt.mockRejectedValueOnce(Object.assign(new Error('the verifier epoch moved on while this reservation waited for its payer; nothing was sent'), {code: 'newer-verifier-epoch', beaconEpoch: 92n}))
    await expect(decryptInSession(request(session))).rejects.toThrow(/verifier epoch moved on/)
    expect(paidSessionDecrypt).toHaveBeenCalledTimes(1)
  })
})
