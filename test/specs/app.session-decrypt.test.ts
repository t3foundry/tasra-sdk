import {describe, expect, it, vi, beforeEach} from 'vitest'
import {PaidDrawMovedError} from '../../src/chain/prepaid.js'
import {SessionEndedError} from '../../src/app/session-grants.js'

// decryptInSession composes paidSessionDecrypt, decryptWithSessionGrant and the session's beacon
// follow: the two network halves are stand-ins here (their own suites cover their wires), the
// session is a fake whose grant moves one epoch per refresh, and the beacon rolls DURING a message.
const paidSessionDecrypt = vi.fn()
const decryptWithSessionGrant = vi.fn()
vi.mock('../../src/app/paid-operation.js', () => ({paidSessionDecrypt: (...a: unknown[]) => paidSessionDecrypt(...a)}))
vi.mock('../../src/decryption/session.js', () => ({decryptWithSessionGrant: (...a: unknown[]) => decryptWithSessionGrant(...a)}))
const {decryptInSession, SessionMessageError} = await import('../../src/app/session-decrypt.js')

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
    observeBeacon: (e: bigint) => { if (state.beacon === undefined || e > state.beacon) state.beacon = e },
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
const message = {ciphertext: {} as never, identity: new Uint8Array(1), recipient: {} as never, ciphertextEpoch: 0, decryption: {content_digest: '0x'} as never}
const request = (session: never) => ({config: {} as never, session, slot, keepers: {nodeUrls: ['a', 'b', 'c'], chainId: 43112, verifyingShares: new Map(), threshold: 2},
  verifierProofs: async (_s: string, e: bigint) => [{verifier_index: Number(e), operator: '0x', pubkey: '0x', proof: []}], message,
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

  it('a draw that moved before anything was signed (PaidDrawMovedError) refreshes and pays once on the new draw', async () => {
    const {session} = fakeSession(30)
    paidSessionDecrypt.mockRejectedValueOnce(new PaidDrawMovedError(30n, 31n))
    decryptWithSessionGrant.mockResolvedValue([{ok: true, plaintext: new Uint8Array([2])}])
    const r = await decryptInSession(request(session))
    expect(r.grantEpoch).toBe(31n)
    expect(payments.map(p => p.epoch)).toEqual([31])
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
})
