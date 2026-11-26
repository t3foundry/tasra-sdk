import {describe, expect, it, vi, beforeEach} from 'vitest'
import {SessionEndedError} from '../../src/app/session-grants.js'

// decryptInSession composes decryptWithSessionGrant and the session's beacon follow: the keeper
// fan-out is a stand-in here (its own suite covers the wire), the session is a fake whose grant
// moves one epoch per refresh, and the beacon rolls DURING a message. Nothing is paid anywhere.
const decryptWithSessionGrant = vi.fn()
vi.mock('../../src/decryption/session.js', () => ({decryptWithSessionGrant: (...a: unknown[]) => decryptWithSessionGrant(...a)}))
const {decryptInSession, decryptBatchInSession, SessionMessageError} = await import('../../src/app/session-decrypt.js')

const slot = ('0x' + '01'.repeat(32)) as `0x${string}`

/** A session whose grant is at `epoch` and which refreshes one epoch at a time, as the agent continues it. */
function fakeSession(epoch: number, opts: {endsWhenTwoBehind?: boolean; ended?: SessionEndedError} = {}) {
  const state = {epoch, beacon: undefined as bigint | undefined, refreshes: 0, ended: opts.ended}
  const session = {
    get beaconEpoch() { return state.beacon },
    get key() { return {jwk: {}} },
    current: () => { if (state.ended) throw state.ended; return {epoch: state.epoch} },
    verifiedFor: async () => ({epoch: state.epoch}),
    // As GrantedSession: an observation past the grant starts the follow in the background.
    observeBeacon: (e: bigint) => {
      if (state.beacon === undefined || e > state.beacon) state.beacon = e
      if (BigInt(state.epoch) < state.beacon) setTimeout(() => void session.followBeacon().catch(() => undefined), 0)
    },
    followBeacon: async () => {
      let moved = false
      while (state.beacon !== undefined && BigInt(state.epoch) < state.beacon) {
        if (opts.endsWhenTwoBehind && BigInt(state.epoch) + 1n < state.beacon) { state.ended = new SessionEndedError('local-stale', 'two epochs behind'); throw state.ended }
        state.epoch++; state.refreshes++; moved = true
      }
      return moved
    },
  }
  return {state, session: session as never}
}

/** The chain's beacon epoch the helper's fresh reads see; undefined makes the read fail. */
let chainEpoch: bigint | undefined
let chainReads: number
beforeEach(() => { chainEpoch = undefined; chainReads = 0; decryptWithSessionGrant.mockReset() })

const item = (n = 0) => ({ciphertext: {u: new Uint8Array([n]), nonce: new Uint8Array(12), aeadCt: new Uint8Array(1)}, identity: new Uint8Array([1]), recipient: {} as never, ciphertextEpoch: 0})
const context = (session: never) => ({session, slot, keepers: {nodeUrls: ['a', 'b', 'c'], chainId: 43112, verifyingShares: new Map<number, Uint8Array>(), threshold: 2},
  verifierProofs: async (_s: string, e: bigint) => [{verifier_index: Number(e), operator: '0x', pubkey: '0x', proof: []}],
  latestBeaconEpoch: async () => { chainReads++; if (chainEpoch === undefined) throw new Error('rpc down'); return chainEpoch }})
const request = (session: never) => ({...context(session), message: item()})
const ok = (byte: number) => ({ok: true, plaintext: new Uint8Array([byte])})
const stale = (latest: number) => ({ok: false, error: 'stale', codes: ['session-stale'], stale: true,
  refusals: [{nodeUrl: 'a', status: 403, code: 'session-stale', scope: 'request', message: `session grant epoch 1 is not current (beacon latest ${latest}); x`}]})
const refused = (code: string) => ({ok: false, error: code, codes: [code], refusals: [], stale: false})

describe('one message across a beacon-epoch boundary', () => {
  it('the beacon rolls twice while the message is in flight: keepers refuse it as stale; the grant is refreshed and the message sent ONCE more', async () => {
    const {state, session} = fakeSession(478)
    chainEpoch = 480n
    decryptWithSessionGrant.mockResolvedValueOnce([stale(480)]).mockResolvedValueOnce([ok(7)])
    const retries: string[] = []
    const r = await decryptInSession({...request(session), hooks: {onRetry: reason => retries.push(reason)}})
    expect(r.plaintext).toEqual(new Uint8Array([7]))
    expect(retries).toEqual(['stale'])
    expect(r.grantEpoch).toBe(480n)
    expect(r.session).toBe(session)
    // The second request carries the REFRESHED grant and that epoch's proofs; no payment anywhere.
    const [first, second] = decryptWithSessionGrant.mock.calls.map(c => c[0] as {grant: {epoch: number}; verifierProofs: {verifier_index: number}[]})
    expect(first!.grant.epoch).toBe(478); expect(second!.grant.epoch).toBe(480)
    expect(second!.verifierProofs[0]!.verifier_index).toBe(480)
    for (const call of decryptWithSessionGrant.mock.calls) expect(JSON.stringify(call[1])).not.toMatch(/payment|approveExecution/)
    expect(state.refreshes).toBe(2)
  })

  it('retries at most once: a second stale refusal is the caller\'s error', async () => {
    const {session} = fakeSession(10)
    chainEpoch = 12n
    decryptWithSessionGrant.mockResolvedValue([stale(12)])
    await expect(decryptInSession(request(session))).rejects.toBeInstanceOf(SessionMessageError)
    expect(decryptWithSessionGrant).toHaveBeenCalledTimes(2)
  })

  it('never sends again for a refusal that is not stale (a keeper may have run it)', async () => {
    const {session} = fakeSession(10)
    decryptWithSessionGrant.mockResolvedValue([refused('conflict')])
    await expect(decryptInSession(request(session))).rejects.toMatchObject({code: 'conflict', name: 'SessionMessageError'})
    expect(decryptWithSessionGrant).toHaveBeenCalledTimes(1)
    expect(chainReads).toBe(0)
  })

  it.each([['the chain still admits the grant', 11n], ['the chain cannot be read', undefined]] as const)('a keeper\'s "stale" is not taken on its word: when %s, the refusal is thrown and nothing is sent again', async (_name, epoch) => {
    const {state, session} = fakeSession(10)
    chainEpoch = epoch
    decryptWithSessionGrant.mockResolvedValue([stale(99)])
    await expect(decryptInSession(request(session))).rejects.toBeInstanceOf(SessionMessageError)
    expect(decryptWithSessionGrant).toHaveBeenCalledTimes(1)
    expect(chainReads).toBe(1)
    // The keepers' claimed epoch (99) never reaches the session: only the chain's own read does.
    expect(state.beacon).toBe(epoch)
  })

  it('without a chain reader a stale refusal is never confirmed, so it is thrown', async () => {
    const {session} = fakeSession(10)
    decryptWithSessionGrant.mockResolvedValue([stale(12)])
    const {latestBeaconEpoch: _none, ...unread} = request(session)
    await expect(decryptInSession(unread)).rejects.toBeInstanceOf(SessionMessageError)
    expect(decryptWithSessionGrant).toHaveBeenCalledTimes(1)
  })

  it('a grant one epoch behind serves at once (the follow runs in the background); two behind waits for the refresh', async () => {
    const one = fakeSession(20)
    one.state.beacon = 21n
    decryptWithSessionGrant.mockResolvedValue([ok(1)])
    expect((await decryptInSession(request(one.session))).grantEpoch).toBe(20n)
    const two = fakeSession(20)
    two.state.beacon = 22n
    expect((await decryptInSession(request(two.session))).grantEpoch).toBe(22n)
    expect(two.state.refreshes).toBe(2)
  })
})

describe('a session that ended under a message', () => {
  const ended = new SessionEndedError('session_context_changed', 'present again')

  it('throws the end when the caller supplies no re-open', async () => {
    const {session} = fakeSession(5, {ended})
    await expect(decryptInSession(request(session))).rejects.toBe(ended)
    expect(decryptWithSessionGrant).not.toHaveBeenCalled()
  })

  it('re-opens once and sends the message under the new session\'s grant', async () => {
    const old = fakeSession(5, {ended}), next = fakeSession(9)
    decryptWithSessionGrant.mockResolvedValue([ok(3)])
    const reopen = vi.fn(async () => next.session), codes: string[] = []
    const r = await decryptInSession({...request(old.session), reopen, hooks: {onReopen: code => codes.push(code)}})
    expect(r.plaintext).toEqual(new Uint8Array([3]))
    expect(r.session).toBe(next.session)
    expect(r.grantEpoch).toBe(9n)
    expect(reopen).toHaveBeenCalledExactlyOnceWith(ended)
    expect(codes).toEqual(['session_context_changed'])
    expect((decryptWithSessionGrant.mock.calls[0]![0] as {grant: {epoch: number}}).grant.epoch).toBe(9)
  })

  it('concurrent messages of one ended session share ONE re-open and continue on its session', async () => {
    const old = fakeSession(5, {ended}), next = fakeSession(9)
    decryptWithSessionGrant.mockResolvedValue([ok(4)])
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const reopen = vi.fn(async () => { await gate; return next.session })
    const all = Promise.all([1, 2, 3].map(() => decryptInSession({...request(old.session), reopen})))
    await Promise.resolve(); release()
    const results = await all
    expect(reopen).toHaveBeenCalledTimes(1)
    expect(results.every(r => r.session === next.session)).toBe(true)
    // A later message of the ended session goes straight to its successor, without a presentation.
    await decryptInSession({...request(old.session), reopen})
    expect(reopen).toHaveBeenCalledTimes(1)
  })

  it('re-opens at most once per message: a new session that ends too is thrown', async () => {
    const again = new SessionEndedError('local-idle', 'idle')
    const old = fakeSession(5, {ended}), next = fakeSession(9, {ended: again})
    const reopen = vi.fn(async () => next.session)
    await expect(decryptInSession({...request(old.session), reopen})).rejects.toBe(again)
    expect(reopen).toHaveBeenCalledTimes(1)
    expect(decryptWithSessionGrant).not.toHaveBeenCalled()
  })

  it('a failed or empty re-open fails the message; waiters of a failed re-open get the original end', async () => {
    const old = fakeSession(5, {ended})
    await expect(decryptInSession({...request(old.session), reopen: async () => undefined as never})).rejects.toThrow(/returned no session/)
    const other = fakeSession(5, {ended})
    let fail!: (e: Error) => void
    const reopen = vi.fn(() => new Promise<never>((_, reject) => { fail = reject }))
    const first = decryptInSession({...request(other.session), reopen}), second = decryptInSession({...request(other.session), reopen})
    const outcomes = Promise.allSettled([first, second])
    await Promise.resolve(); fail(new Error('wallet declined'))
    const [a, b] = await outcomes
    expect(a).toMatchObject({status: 'rejected', reason: {message: 'wallet declined'}})
    expect(b).toMatchObject({status: 'rejected', reason: ended})
    expect(reopen).toHaveBeenCalledTimes(1)
  })

  it('a grant the beacon left ends the session; with a re-open the message continues on the new one', async () => {
    const old = fakeSession(10, {endsWhenTwoBehind: true}), next = fakeSession(13)
    old.state.beacon = 13n
    decryptWithSessionGrant.mockResolvedValue([ok(5)])
    const r = await decryptInSession({...request(old.session), reopen: async () => next.session})
    expect(r.grantEpoch).toBe(13n)
  })
})

describe('a batch of messages in one request per keeper', () => {
  it('returns one result per message, in order; a refused message never fails the others', async () => {
    const {session} = fakeSession(7)
    decryptWithSessionGrant.mockResolvedValue([ok(1), refused('forbidden'), ok(3)])
    const r = await decryptBatchInSession({...context(session), messages: [item(1), item(2), item(3)]})
    expect(r.results.map(x => x.ok)).toEqual([true, false, true])
    expect(r.grantEpoch).toBe(7n)
    expect(decryptWithSessionGrant).toHaveBeenCalledTimes(1)
    expect((decryptWithSessionGrant.mock.calls[0]![1] as unknown[]).length).toBe(3)
  })

  it('a batch refused entirely as stale is sent again once when the chain confirms it', async () => {
    const {session} = fakeSession(30)
    chainEpoch = 32n
    decryptWithSessionGrant.mockResolvedValueOnce([stale(32), stale(32)]).mockResolvedValueOnce([ok(1), ok(2)])
    const r = await decryptBatchInSession({...context(session), messages: [item(1), item(2)]})
    expect(r.results.every(x => x.ok)).toBe(true)
    expect(r.grantEpoch).toBe(32n)
    expect(decryptWithSessionGrant).toHaveBeenCalledTimes(2)
  })

  it('a batch with a served message is never re-sent whole: the results are returned as they are', async () => {
    const {session} = fakeSession(30)
    chainEpoch = 32n
    decryptWithSessionGrant.mockResolvedValue([ok(1), stale(32)])
    const r = await decryptBatchInSession({...context(session), messages: [item(1), item(2)]})
    expect(r.results.map(x => x.ok)).toEqual([true, false])
    expect(decryptWithSessionGrant).toHaveBeenCalledTimes(1)
  })

  it('refuses an empty batch, more than 64 messages and a keeper answer of another length', async () => {
    const {session} = fakeSession(7)
    await expect(decryptBatchInSession({...context(session), messages: []})).rejects.toThrow(/1\.\.64/)
    await expect(decryptBatchInSession({...context(session), messages: Array.from({length: 65}, (_, i) => item(i))})).rejects.toThrow(/1\.\.64/)
    expect(decryptWithSessionGrant).not.toHaveBeenCalled()
    decryptWithSessionGrant.mockResolvedValue([ok(1)])
    await expect(decryptBatchInSession({...context(session), messages: [item(1), item(2)]})).rejects.toThrow(/every message/)
  })
})
