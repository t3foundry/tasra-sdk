// ADR-0075: the per-commitment draw seed.
//
// What these pin is the CLIENT-SIDE half of the security argument. The chain enforces that the
// signature is a real k-of-n threshold signature; nothing here can or should re-check that. What
// this side owes is that a caller never spends gas on an answer that could not possibly work, that
// creation never waits for a beacon epoch, and that a missing seed is a typed, fast failure.
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {concat, createWalletClient, defineChain, http, keccak256, toHex, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {createTasraWriteClient} from '../../src/chain/write.js'
import {requestSlotSeed} from '../../src/chain/slotSeed.js'
import {SlotRevealNotYetError, SlotSeedUnavailableError} from '../../src/chain/commitmentRecovery.js'
import {resolveAccountantUrls, ACCOUNTANT_TAG} from '../../src/chain/discovery.js'
import type {TasraChainClient} from '../../src/chain/client.js'

const mocks = vi.hoisted(() => ({submit: vi.fn(), read: vi.fn(), receipt: vi.fn()}))
vi.mock('viem', async original => ({...await original<typeof import('viem')>(), createPublicClient: () => ({readContract: mocks.read, waitForTransactionReceipt: mocks.receipt})}))
vi.mock('../../src/chain/registeredRelay.js', async original => ({...await original<typeof import('../../src/chain/registeredRelay.js')>(), createRegisteredRelaySubmitter: () => ({submit: mocks.submit})}))

const address = `0x${'11'.repeat(20)}` as const
const hash = (v: string) => `0x${v.repeat(32)}` as Hex
const COMMITMENT = hash('07')
const DIGEST = hash('aa')
const SIG = `0x${'5c'.repeat(64)}` as Hex
const chain = defineChain({id: 31337, name: 'fixture', nativeCurrency: {name: 'ETH', symbol: 'ETH', decimals: 18}, rpcUrls: {default: {http: ['http://localhost:1']}}})

/** A chain client that only answers `commitSeedDigest` — all `requestSlotSeed` needs when the
 *  accountant URLs are supplied, so discovery never runs. */
function seedChain(digest: Hex = DIGEST): TasraChainClient {
  return {client: {readContract: async () => digest}} as unknown as TasraChainClient
}

/** Stand in for the accountant fleet: `replies` is consulted per base URL. */
function fleet(replies: Record<string, {status: number; body?: unknown; headers?: Record<string, string>} | 'throw'>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    const base = url.replace(/\/v1\/slot-seed$/, '')
    const r = replies[base]
    if (!r) throw new Error(`no stub for ${url}`)
    if (r === 'throw') throw new Error('connection refused')
    return {ok: r.status >= 200 && r.status < 300, status: r.status, headers: new Headers(r.headers ?? {}), json: async () => r.body, text: async () => JSON.stringify(r.body ?? '')} as Response
  })
}

afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()})

it('returns the seed an accountant served when it matches the registry digest', async () => {
  vi.stubGlobal('fetch', fleet({'http://a': {status: 200, body: {commitment: COMMITMENT, digest: DIGEST, signature: SIG}}}))
  await expect(requestSlotSeed(seedChain(), address, COMMITMENT, {urls: ['http://a']}))
    .resolves.toMatchObject({digest: DIGEST, signature: SIG})
})

// ⚠ A digest that is not this registry's means the accountant is bound to a DIFFERENT registry or
//   chain. Its signature can never satisfy the reveal, and accepting it would surface as a
//   `BadSeedSignature` revert — a message about validity, for what is actually a wiring fault.
it('refuses a seed whose digest is not the one the registry computes', async () => {
  vi.stubGlobal('fetch', fleet({'http://a': {status: 200, body: {commitment: COMMITMENT, digest: hash('bb'), signature: SIG}}}))
  await expect(requestSlotSeed(seedChain(DIGEST), address, COMMITMENT, {urls: ['http://a']})).resolves.toBeNull()
})

it.each([
  ['a short signature', `0x${'5c'.repeat(32)}`],
  ['an over-long signature', `0x${'5c'.repeat(96)}`],
  // The point at infinity: it satisfies the pairing trivially, so the contract rejects it. Doing
  // so here as well means a misbehaving accountant cannot make a caller pay to find out.
  ['the point at infinity', `0x${'00'.repeat(64)}`],
  ['a non-hex signature', `0x${'zz'.repeat(64)}`],
  ['a malformed digest', undefined],
])('refuses %s', async (_label, signature) => {
  const body = signature === undefined
    ? {commitment: COMMITMENT, digest: '0xnope', signature: SIG}
    : {commitment: COMMITMENT, digest: DIGEST, signature}
  vi.stubGlobal('fetch', fleet({'http://a': {status: 200, body}}))
  await expect(requestSlotSeed(seedChain(), address, COMMITMENT, {urls: ['http://a']})).resolves.toBeNull()
})

// Any one accountant can lead the round, so an unreachable or not-yet-ready one is not a failure
// of the set.
it('moves on to the next accountant past a refusal, an outage and a 503', async () => {
  // The first accountant asked is picked by the commitment (spreading concurrent creators); one
  // ending in 0000 starts at the first URL, so the order below is the order asked.
  const c = `0x${'07'.repeat(30)}0000` as Hex
  const f = fleet({
    'http://a': {status: 404},                     // has not seen the commit yet
    'http://b': 'throw',                           // unreachable
    'http://c': {status: 503},                     // threshold set not up
    'http://d': {status: 200, body: {commitment: COMMITMENT, digest: DIGEST, signature: SIG}},
  })
  vi.stubGlobal('fetch', f)
  await expect(requestSlotSeed(seedChain(), address, c, {urls: ['http://a', 'http://b', 'http://c', 'http://d']}))
    .resolves.toMatchObject({signature: SIG})
  expect(f).toHaveBeenCalledTimes(4)
})

it('returns null when no accountant is registered, without reading the registry', async () => {
  const read = vi.fn()
  const c = {client: {readContract: read}} as unknown as TasraChainClient
  await expect(requestSlotSeed(c, address, COMMITMENT, {urls: []})).resolves.toBeNull()
  expect(read).not.toHaveBeenCalled()
})

// --- the write path ---------------------------------------------------------------------------

function writer(relay: boolean) {
  const wallet = createWalletClient({account: privateKeyToAccount(hash('01')), chain, transport: http()})
  vi.spyOn(wallet, 'sendTransaction').mockRejectedValue(new Error('Unexpected direct gas payment'))
  const direct = vi.spyOn(wallet, 'writeContract').mockResolvedValue(hash('10'))
  const w = createTasraWriteClient({
    rpcUrl: 'http://localhost:1', wallet,
    addresses: {KeyRegistry: address, ThresholdRandomBeacon: address, ServiceRegistry: address},
    ...(relay ? {relay: {forwarder: address, approvals: [{chainId: 31337, registry: address, serviceId: hash('02'), owner: address, serviceType: 0, revision: 1n, manifestHash: hash('03')}], transport: {request: vi.fn(), relayRequest: vi.fn()}}} : {}),
  })
  return {w, direct, args: {slotId: hash('04'), salt: hash('05'), ruleSalt: hash('06'), rule: 'verify:demo', k: 2, n: 3, mode: 'bls' as const}}
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.read.mockImplementation(async ({functionName}: {functionName: string}) => {
    if (functionName === 'computeCommitment') return COMMITMENT
    // ⚠ targetEpoch 9 against a beacon at 2: the epoch path CANNOT complete in these tests, so a
    //   passing seeded case is proof the seed was used and not merely that creation succeeded.
    if (functionName === 'slotCommits') return [9n, 20n, address, false]
    if (functionName === 'epoch') return 2n
    if (functionName === 'randomBeacon') return address
    if (functionName === 'commitSeedDigest') return DIGEST
    throw new Error(`Unexpected read ${functionName}`)
  })
  mocks.receipt.mockResolvedValue({status: 'success'})
  mocks.submit.mockImplementation(async (_to: unknown, _data: unknown, label: string) => ({id: hash('08'), txHash: label === 'commitKeySlot' ? hash('09') : hash('10')}))
})

it('reveals with the seed instead of waiting for the target epoch', async () => {
  vi.stubGlobal('fetch', fleet({'http://a': {status: 200, body: {commitment: COMMITMENT, digest: DIGEST, signature: SIG}}}))
  const h = writer(false)
  const seen: (string | null)[] = []
  const out = await h.w.createSlotCommitReveal({...h.args, accountantUrls: ['http://a'], onSeed: s => seen.push(s?.signature ?? null)})
  expect(out.seeded).toBe(true)
  expect(seen).toEqual([SIG])
  const reveal = h.direct.mock.calls.find(c => (c[0] as {functionName: string}).functionName.startsWith('revealKeySlot'))
  expect(reveal?.[0]).toMatchObject({functionName: 'revealKeySlotWithSeed'})
  expect((reveal?.[0] as {args: readonly unknown[]}).args.at(-1)).toBe(SIG)
})

it('pins the rule policy in the seeded reveal, in the same transaction', async () => {
  vi.stubGlobal('fetch', fleet({'http://a': {status: 200, body: {commitment: COMMITMENT, digest: DIGEST, signature: SIG}}}))
  const h = writer(false)
  await h.w.createSlotCommitReveal({...h.args, accountantUrls: ['http://a'], rulePolicy: {admin: address, guardian: `0x${'22'.repeat(20)}` as const, timelockSecs: 120}})
  const reveal = h.direct.mock.calls.find(c => (c[0] as {functionName: string}).functionName.startsWith('revealKeySlot'))
  expect(reveal?.[0]).toMatchObject({functionName: 'revealKeySlotWithSeedAndPolicy'})
})

// ⚠⚠ THERE IS NO EPOCH WAIT TO FALL BACK TO. With no accountant reachable the creation used to run
//    ADR-0030's epoch wait (one to two hours at the production cadence). Now the commitment stands
//    and the caller gets a typed error saying so, fast: an unreachable set is not retried.
it('fails fast with a typed error when no accountant serves a seed, without polling the beacon', async () => {
  vi.stubGlobal('fetch', fleet({'http://a': 'throw'}))
  const h = writer(false)
  const started = Date.now()
  const error = await h.w.createSlotCommitReveal({...h.args, accountantUrls: ['http://a']}).catch((e: unknown) => e)
  expect(Date.now() - started).toBeLessThan(2_000)
  expect(error).toBeInstanceOf(SlotSeedUnavailableError)
  expect(error).toMatchObject({detail: {committed: true, commitment: COMMITMENT, expiryEpoch: 20}})
  expect((error as Error).message).toContain('unreachable')
  expect(mocks.read.mock.calls.map(c => (c[0] as {functionName: string}).functionName)).not.toContain('epoch')
  expect(h.direct.mock.calls.map(c => (c[0] as {functionName: string}).functionName)).toEqual(['commitKeySlot'])
})

it('refuses the removed beacon-epoch path (slotSeed: false) before any request or transaction', async () => {
  const f = fleet({})
  vi.stubGlobal('fetch', f)
  const h = writer(false)
  await expect(h.w.createSlotCommitReveal({...h.args, ...{slotSeed: false}})).rejects.toThrow('beacon-epoch creation path was removed')
  expect(f).not.toHaveBeenCalled()
  expect(h.direct).not.toHaveBeenCalled()
})

// ⚠⚠ Under a relay a failed seeded reveal must NOT fall through. The relay submitter owns the
//    retries of the one request it signed; a second signed request against the same forwarder
//    nonce is the defect that wedges every later write by this signer.
it('rethrows a failed seeded reveal under a relay rather than falling back', async () => {
  vi.stubGlobal('fetch', fleet({'http://a': {status: 200, body: {commitment: COMMITMENT, digest: DIGEST, signature: SIG}}}))
  mocks.submit.mockImplementation(async (_to: unknown, _data: unknown, label: string) => {
    if (label === 'commitKeySlot') return {id: hash('08'), txHash: hash('09')}
    throw new Error('relay: reveal reverted')
  })
  const h = writer(true)
  await expect(h.w.createSlotCommitReveal({...h.args, accountantUrls: ['http://a']}))
    .rejects.toThrow('relay: reveal reverted')
})

it('commits exactly once', async () => {
  vi.stubGlobal('fetch', fleet({'http://a': {status: 200, body: {commitment: COMMITMENT, digest: DIGEST, signature: SIG}}}))
  const h = writer(false)
  await h.w.createSlotCommitReveal({...h.args, accountantUrls: ['http://a']})
  const commits = h.direct.mock.calls.filter(c => (c[0] as {functionName: string}).functionName === 'commitKeySlot')
  expect(commits).toHaveLength(1)
})

// --- accountant discovery ----------------------------------------------------------------------

// ⚠ The paged getter returns TWO outputs, so viem hands back a TUPLE, not an object. Getting that
//   wrong resolves an empty set, which reads as "no accountants are deployed" — a silent fallback
//   to the epoch wait that nothing would report.
it('walks taggedActiveOperatorsPage and keeps only operators with a url', async () => {
  const pages: Array<[Array<{url: string}>, bigint]> = [
    [[{url: 'http://a'}, {url: ''}, {url: 'http://c'}], 5n],
    [[{url: 'http://d'}, {url: 'http://e'}], 5n],
  ]
  const read = vi.fn(async () => pages.shift() ?? [[], 5n])
  const chain = {read} as unknown as TasraChainClient
  await expect(resolveAccountantUrls(chain)).resolves.toEqual(['http://a', 'http://c', 'http://d', 'http://e'])
  // Two pages covered the total; a third call would mean the offset never caught up.
  expect(read).toHaveBeenCalledTimes(2)
  expect(read.mock.calls[0]).toEqual(['NodeRegistry', 'taggedActiveOperatorsPage', [ACCOUNTANT_TAG, 0n, 256n]])
  expect(read.mock.calls[1]).toEqual(['NodeRegistry', 'taggedActiveOperatorsPage', [ACCOUNTANT_TAG, 3n, 256n]])
})

// A registry with no accountants must terminate, not spin: an empty page ends the walk whatever
// `total` claims.
it('stops on an empty page even when total disagrees', async () => {
  const read = vi.fn(async () => [[], 99n])
  await expect(resolveAccountantUrls({read} as unknown as TasraChainClient)).resolves.toEqual([])
  expect(read).toHaveBeenCalledTimes(1)
})

it('the accountant tag is the registered one', () => {
  expect(ACCOUNTANT_TAG).toBe(keccak256(toHex('accountant')))
})

// --- ADR-0080: the reveal path is fixed at commit ----------------------------------------------
//
// ⚠⚠ THE DEFECT THESE PIN: the SDK committed through `commitKeySlot` - which binds the
//    BEACON-EPOCH reveal - and then asked for a seed. Every accountant refused (it signs only for a
//    seeded-path commitment), the refusal was a 404 the SDK read as "not there yet, give up", and
//    every creation fell back to the epoch wait: measured on the benchmark fleet, 37 of 37
//    creations revealed through `revealKeySlot`, none through `revealKeySlotWithSeed`. The fixtures
//    above model a registry from before reveal paths (four-word `slotCommits`), which is why they
//    never caught it.

const FALLBACK = hash('0f')
const fallbackSalt = (salt: Hex) => keccak256(concat([toHex('tasra/slot-create/epoch-fallback/v1'), salt]))

/** A path-recording registry: six-word `slotCommits`, and commits that bind their reveal path. */
function pathRegistry(h: ReturnType<typeof writer>, pre: Record<string, {path: number; used?: boolean; target?: bigint}> = {}) {
  const creator = privateKeyToAccount(hash('01')).address
  const commits = new Map<string, {path: number; used: boolean; target?: bigint}>(Object.entries(pre).map(([k, v]) => [k, {path: v.path, used: v.used ?? false, target: v.target}]))
  const writes: Array<{functionName: string; args: readonly unknown[]}> = []
  mocks.read.mockImplementation(async ({functionName, args}: {functionName: string; args?: readonly unknown[]}) => {
    if (functionName === 'computeCommitment') return args?.[5] === h.args.salt ? COMMITMENT : args?.[5] === fallbackSalt(h.args.salt) ? FALLBACK : hash('ee')
    if (functionName === 'slotCommits') {
      const c = commits.get(String(args?.[0]))
      // targetEpoch 2 against a beacon at 2: an epoch reveal CAN complete here, so what decides a
      // case is which commitment and which entry point were used.
      return c ? [c.target ?? 2n, 20n, creator, c.used, 100n, c.path] : [0n, 0n, ZERO, false, 0n, 0]
    }
    if (functionName === 'epoch') return 2n
    if (functionName === 'randomBeacon') return address
    if (functionName === 'commitSeedDigest') return DIGEST
    throw new Error(`Unexpected read ${functionName}`)
  })
  h.direct.mockImplementation((async (call: {functionName: string; args: readonly unknown[]}) => {
    writes.push({functionName: call.functionName, args: call.args})
    if (call.functionName === 'commitKeySlot') commits.set(String(call.args[0]), {path: 1, used: false})
    if (call.functionName === 'commitKeySlotSeeded') commits.set(String(call.args[0]), {path: 2, used: false})
    return hash('10')
  }) as never)
  return {writes, commits}
}
const ZERO = '0x0000000000000000000000000000000000000000'
const seedOk = {status: 200, body: {commitment: COMMITMENT, digest: DIGEST, signature: SIG}}

it('commits through commitKeySlotSeeded when it will ask for a seed, and reveals with it', async () => {
  vi.stubGlobal('fetch', fleet({'http://a': seedOk}))
  const h = writer(false)
  const reg = pathRegistry(h)
  const out = await h.w.createSlotCommitReveal({...h.args, accountantUrls: ['http://a']})
  expect(out.seeded).toBe(true)
  expect(reg.writes.map(w => w.functionName)).toEqual(['commitKeySlotSeeded', 'revealKeySlotWithSeed'])
  expect(reg.writes[0]?.args).toEqual([COMMITMENT])
})

it('re-asks while the set answers "not yet" (404 behind the receipt, 503 busy leading a round)', async () => {
  const replies = [{status: 404}, {status: 503}, seedOk]
  const f = vi.fn(async () => {
    const r = replies.shift() ?? seedOk
    return {ok: r.status === 200, status: r.status, json: async () => (r as {body?: unknown}).body, text: async () => ''} as Response
  })
  vi.stubGlobal('fetch', f)
  const h = writer(false)
  const reg = pathRegistry(h)
  const out = await h.w.createSlotCommitReveal({...h.args, accountantUrls: ['http://a'], slotSeedRetryMs: 5_000})
  expect(out.seeded).toBe(true)
  expect(f).toHaveBeenCalledTimes(3)
  expect(reg.writes.map(w => w.functionName)).toEqual(['commitKeySlotSeeded', 'revealKeySlotWithSeed'])
})

it('does not retry a 409, reports why, and never sends an epoch-path commitment', async () => {
  const f = fleet({'http://a': {status: 409, body: 'the commitment is bound to the beacon-epoch reveal'}})
  vi.stubGlobal('fetch', f)
  const h = writer(false)
  const reg = pathRegistry(h)
  const errors: string[] = []
  const error = await h.w.createSlotCommitReveal({...h.args, accountantUrls: ['http://a'], slotSeedRetryMs: 5_000, onSeedError: e => errors.push(e.reason)}).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(SlotSeedUnavailableError)
  expect(f).toHaveBeenCalledTimes(1)
  expect(errors).toHaveLength(1)
  expect(errors[0]).toContain('409')
  // ⚠⚠ The SDK used to complete this through a SECOND commitment via commitKeySlot and the epoch wait.
  expect(reg.writes.map(w => w.functionName)).toEqual(['commitKeySlotSeeded'])
})

// ⚠⚠ A transient failure of the reveal-path probe used to read as "legacy registry", which commits
//    through commitKeySlot: on a path-recording registry, an EPOCH-path commitment no accountant seeds.
it('sends nothing when the reveal-path probe fails for any reason but a short decode', async () => {
  vi.stubGlobal('fetch', fleet({'http://a': seedOk}))
  const h = writer(false)
  const reg = pathRegistry(h)
  const inner = mocks.read.getMockImplementation()!
  mocks.read.mockImplementation(async (arg: {functionName: string}) => arg.functionName === 'slotCommits' ? Promise.reject(new Error('HTTP request failed: 502')) : inner(arg))
  await expect(h.w.createSlotCommitReveal({...h.args, accountantUrls: ['http://a']})).rejects.toThrow('502')
  expect(reg.writes).toEqual([])
})

it('refuses before committing when no accountant is registered, and says nothing was sent', async () => {
  const h = writer(false)
  const reg = pathRegistry(h)
  const error = await h.w.createSlotCommitReveal({...h.args, accountantUrls: []}).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(SlotSeedUnavailableError)
  expect(error).toMatchObject({retryable: true, detail: {committed: false, failure: {reason: 'no accountant registered'}}})
  expect(reg.writes).toEqual([])
})

it('a seeded commitment resumed after a missing seed is not committed again', async () => {
  vi.stubGlobal('fetch', fleet({'http://a': seedOk}))
  const h = writer(false)
  const reg = pathRegistry(h, {[COMMITMENT]: {path: 2}})
  const out = await h.w.createSlotCommitReveal({...h.args, accountantUrls: ['http://a'], recovery: {commitTx: hash('09'), onTransaction: vi.fn(async () => {})}})
  expect(out.seeded).toBe(true)
  expect(reg.writes.map(w => w.functionName)).toEqual(['revealKeySlotWithSeed'])
})

// --- recovery of an older SDK's beacon-epoch commitment: one check, never a wait ----------------

it('an existing epoch-path commitment before its target says "not yet" at once instead of waiting', async () => {
  const f = fleet({'http://a': seedOk})
  vi.stubGlobal('fetch', f)
  const h = writer(false)
  const reg = pathRegistry(h, {[COMMITMENT]: {path: 1, target: 9n}})
  const started = Date.now()
  const error = await h.w.createSlotCommitReveal({...h.args, accountantUrls: ['http://a'], recovery: {commitTx: hash('09'), onTransaction: vi.fn(async () => {})}}).catch((e: unknown) => e)
  expect(Date.now() - started).toBeLessThan(1_000)
  expect(error).toBeInstanceOf(SlotRevealNotYetError)
  expect(error).toMatchObject({targetEpoch: 9, currentEpoch: 2, expiryEpoch: 20, retryable: true})
  expect((error as Error).message).toContain('not revealable until beacon epoch 9')
  expect(f).not.toHaveBeenCalled()
  expect(reg.writes).toEqual([])
})

it('an existing epoch-path commitment past its target is revealed once on the epoch path', async () => {
  const f = fleet({'http://a': seedOk})
  vi.stubGlobal('fetch', f)
  const h = writer(false)
  const reg = pathRegistry(h, {[COMMITMENT]: {path: 1}})
  const out = await h.w.createSlotCommitReveal({...h.args, accountantUrls: ['http://a'], recovery: {commitTx: hash('09'), onTransaction: vi.fn(async () => {})}})
  expect(out.seeded).toBe(false)
  expect(f).not.toHaveBeenCalled()
  expect(reg.writes.map(w => w.functionName)).toEqual(['revealKeySlot'])
  expect(reg.writes[0]?.args[6]).toBe(h.args.salt)
})

it('a resumed creation finds its fallback commitment instead of committing a third time', async () => {
  const f = fleet({'http://a': seedOk})
  vi.stubGlobal('fetch', f)
  const h = writer(false)
  const reg = pathRegistry(h, {[COMMITMENT]: {path: 2}, [FALLBACK]: {path: 1}})
  const onTransaction = vi.fn(async () => {})
  const out = await h.w.createSlotCommitReveal({...h.args, accountantUrls: ['http://a'], recovery: {commitTx: hash('09'), onTransaction}})
  expect(out.seeded).toBe(false)
  expect(f).not.toHaveBeenCalled()
  expect(reg.writes.map(w => w.functionName)).toEqual(['revealKeySlot'])
  expect(reg.writes[0]?.args[6]).toBe(fallbackSalt(h.args.salt))
})

it('an older SDK\'s fallback commitment not yet at its target says "not yet" instead of waiting', async () => {
  const f = fleet({'http://a': seedOk})
  vi.stubGlobal('fetch', f)
  const h = writer(false)
  const reg = pathRegistry(h, {[COMMITMENT]: {path: 2}, [FALLBACK]: {path: 1, target: 9n}})
  await expect(h.w.createSlotCommitReveal({...h.args, accountantUrls: ['http://a'], recovery: {commitTx: hash('09'), onTransaction: vi.fn(async () => {})}}))
    .rejects.toBeInstanceOf(SlotRevealNotYetError)
  expect(f).not.toHaveBeenCalled()
  expect(reg.writes).toEqual([])
})

// --- the ask itself: concurrent, bounded, Retry-After ------------------------------------------

const ordered = `0x${'07'.repeat(30)}0000` as Hex // asks http://a first

it('asks concurrently: a slow first accountant does not hold up a fast second, and is cancelled', async () => {
  let slowSignal: AbortSignal | undefined
  const f = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).startsWith('http://a')) {
      slowSignal = init?.signal ?? undefined
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    }
    return {ok: true, status: 200, headers: new Headers(), json: async () => ({commitment: ordered, digest: DIGEST, signature: SIG}), text: async () => ''} as unknown as Response
  })
  vi.stubGlobal('fetch', f)
  const started = Date.now()
  await expect(requestSlotSeed(seedChain(), address, ordered, {urls: ['http://a', 'http://b'], timeoutMs: 60_000, hedgeMs: 20}))
    .resolves.toMatchObject({signature: SIG})
  // Sequential asking would sit out the first accountant's 60 s timeout.
  expect(Date.now() - started).toBeLessThan(2_000)
  expect(f).toHaveBeenCalledTimes(2)
  expect(slowSignal?.aborted).toBe(true)
})

it('hedgeMs 0 launches every ask of a round at once', async () => {
  const launched: string[] = []
  const f = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    launched.push(String(input))
    return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
  })
  vi.stubGlobal('fetch', f)
  const pending = requestSlotSeed(seedChain(), address, ordered, {urls: ['http://a', 'http://b', 'http://c'], timeoutMs: 200, hedgeMs: 0})
  await new Promise(r => setTimeout(r, 30))
  expect(launched).toHaveLength(3)
  await expect(pending).resolves.toBeNull()
})

it('keeps re-asking a busy set only within the window, then gives up with the last answers', async () => {
  vi.useFakeTimers()
  const f = fleet({'http://a': {status: 503, body: 'leading another round'}})
  vi.stubGlobal('fetch', f)
  const failures: Array<{rounds: number; reason: string}> = []
  const pending = requestSlotSeed(seedChain(), address, ordered, {urls: ['http://a'], retryForMs: 10_000, onFailure: x => failures.push(x)})
  await vi.advanceTimersByTimeAsync(12_000)
  await expect(pending).resolves.toBeNull()
  expect(failures).toHaveLength(1)
  expect(failures[0]?.reason).toContain('503')
  // 250 ms doubling to a 4 s cap, jittered: a bounded handful of asks, never a tight loop.
  expect(f.mock.calls.length).toBeGreaterThanOrEqual(3)
  expect(f.mock.calls.length).toBeLessThanOrEqual(8)
})

it('honours Retry-After before asking again', async () => {
  vi.useFakeTimers()
  const answers = [{status: 503, headers: {'retry-after': '3'}}, seedOk]
  const f = vi.fn(async () => {
    const r = answers.shift() ?? seedOk
    return {ok: r.status === 200, status: r.status, headers: new Headers((r as {headers?: Record<string, string>}).headers ?? {}), json: async () => (r as {body?: unknown}).body, text: async () => ''} as unknown as Response
  })
  vi.stubGlobal('fetch', f)
  const pending = requestSlotSeed(seedChain(), address, ordered, {urls: ['http://a'], retryForMs: 30_000})
  await vi.advanceTimersByTimeAsync(2_500)
  // The jittered backoff alone would have asked again after at most 250 ms.
  expect(f).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1_000)
  await expect(pending).resolves.toMatchObject({signature: SIG})
  expect(f).toHaveBeenCalledTimes(2)
})

it('a Retry-After past the window ends the ask at once instead of waiting it out', async () => {
  const f = fleet({'http://a': {status: 429, headers: {'retry-after': '600'}}})
  vi.stubGlobal('fetch', f)
  const started = Date.now()
  await expect(requestSlotSeed(seedChain(), address, ordered, {urls: ['http://a'], retryForMs: 30_000})).resolves.toBeNull()
  expect(Date.now() - started).toBeLessThan(1_000)
  expect(f).toHaveBeenCalledTimes(1)
})

it('an unreachable set fails at once rather than paying the retry window', async () => {
  const f = fleet({'http://a': 'throw', 'http://b': 'throw'})
  vi.stubGlobal('fetch', f)
  const started = Date.now()
  await expect(requestSlotSeed(seedChain(), address, ordered, {urls: ['http://a', 'http://b'], retryForMs: 60_000})).resolves.toBeNull()
  expect(Date.now() - started).toBeLessThan(1_000)
  expect(f).toHaveBeenCalledTimes(2)
})

it('stops waiting between rounds when the caller aborts', async () => {
  const f = fleet({'http://a': {status: 503}})
  vi.stubGlobal('fetch', f)
  const controller = new AbortController()
  const pending = requestSlotSeed(seedChain(), address, ordered, {urls: ['http://a'], retryForMs: 60_000, signal: controller.signal})
  setTimeout(() => controller.abort(new Error('cancelled by caller')), 50)
  await expect(pending).rejects.toThrow('cancelled by caller')
})

// Real sockets, no fetch stub: accountant URLs that refuse the connection (a closed local port).
it('with every accountant URL refusing connections, creation fails fast and typed after its one commit', async () => {
  const h = writer(false)
  const reg = pathRegistry(h)
  const started = Date.now()
  const error = await h.w.createSlotCommitReveal({...h.args, accountantUrls: ['http://127.0.0.1:9', 'http://127.0.0.1:1/']}).catch((e: unknown) => e)
  expect(Date.now() - started).toBeLessThan(3_000)
  expect(error).toBeInstanceOf(SlotSeedUnavailableError)
  expect(error).toMatchObject({detail: {committed: true, failure: {rounds: 1}}})
  expect((error as SlotSeedUnavailableError).detail.failure.answers.map(a => a.reason)).toEqual([expect.stringContaining('unreachable'), expect.stringContaining('unreachable')])
  expect(reg.writes.map(w => w.functionName)).toEqual(['commitKeySlotSeeded'])
})
