// `readRuleAmendment` and the `amendSlotRule` driver, against a scripted chain.
//
// The chain is a small state machine (`World`): the stub writer's propose/activate and the stub
// guardian's endorse mutate it the way the contract would, and the keepers (a stubbed `fetch`)
// answer the pending delivery. Fake timers drive the 5 s polls, so a test can hold chain time or
// the adoption votes back and prove what the driver does NOT do: it never proposes twice, never
// activates on a timer alone, and never reports success the chain does not show.
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {Hex} from 'viem'
import {amendSlotRule, readRuleAmendment, RuleAmendmentError, type AmendmentPhase} from '../../src/chain/ruleAmendment.js'
import {ruleCommitment, type TasraWriteClient} from '../../src/chain/write.js'

vi.mock('../../src/chain/discovery.js', async original => ({
  ...await original<typeof import('../../src/chain/discovery.js')>(),
  resolveSlotKeeperUrls: async () => ['http://k1', 'http://k2', 'http://k3'],
}))

const hash = (v: string): Hex => `0x${v.repeat(32)}`
const addr = (v: string): Hex => `0x${v.repeat(20)}`
const ZERO = addr('00')
const REGISTRY = addr('33')
const CREATOR = addr('c1')
const ADMIN = addr('ad')
const GUARDIAN = addr('9a')
const SLOT = hash('11')
const SALT = hash('22')
const OLD = hash('aa')
const RULE = 'verify:new'
const COMMITMENT = ruleCommitment(SALT, RULE)
const PROPOSE_TX = hash('01')
const ACTIVATE_TX = hash('02')
const ENDORSE_TX = hash('03')
const T0 = 1_700_000_000

interface World {
  exists: boolean
  creator: Hex
  active: Hex
  ruleVersion: bigint
  auth: number
  admin: Hex
  guardian: Hex
  timelock: number
  pending: {commitment: Hex; version: bigint; notBefore: bigint} | null
  /** Adoption votes; a function so a test can make them arrive later. */
  votes: () => number
  threshold: number
  /** Chain time; a function so a test can hold it back. */
  now: () => number
  /** Overrides what `readers.keyRegistry.getKeySlot` reports as active (the final confirmation read). */
  confirmedCommitment?: Hex
  /** Keeper answer per URL. */
  keeper: (url: string) => Response
}
let w: World

const okPending = () => new Response(JSON.stringify({provisioned: false, pending: true, pending_version: 2, authorized_by: 'creator'}), {status: 200})

function slotStruct() {
  return {
    creator: w.creator, ruleCommitment: w.active, threshold: {k: 2, n: 3}, mode: 0, publicKey: '0x', epoch: 1n, committeeVersion: 1n,
    exists: w.exists, cancelled: false, expiry: 0n, ruleVersion: w.ruleVersion, auth: w.auth,
  }
}

function harness() {
  const readContract = vi.fn(async ({functionName}: {functionName: string}) => {
    switch (functionName) {
      case 'getKeySlot': return slotStruct()
      case 'rulePolicy': return [w.admin, w.guardian, w.timelock]
      case 'pendingRule': return w.pending ? [w.pending.commitment, w.pending.version, w.pending.notBefore] : [hash('00'), 0n, 0n]
      case 'ruleAdoptionVotes': return w.votes()
      case 'ruleAdoptionThreshold': return w.threshold
      default: throw new Error(`Unexpected read ${functionName}`)
    }
  })
  const chain = {
    client: {chain: {id: 43112}, readContract, getBlock: vi.fn(async () => ({timestamp: BigInt(w.now())}))},
    addresses: {KeyRegistry: REGISTRY},
    readers: {keyRegistry: {getKeySlot: vi.fn(async () => ({...slotStruct(), ruleCommitment: w.confirmedCommitment ?? w.active}))}},
  }
  const writer = {
    address: ADMIN,
    proposeRuleUpdate: vi.fn(async (a: {ruleSalt: Hex; rule: string}) => {
      w.pending = {commitment: ruleCommitment(a.ruleSalt, a.rule), version: w.ruleVersion + 1n, notBefore: BigInt(w.now() + w.timelock)}
      return {txHash: PROPOSE_TX, version: Number(w.pending.version), notBefore: Number(w.pending.notBefore)}
    }),
    activateRuleUpdate: vi.fn(async () => {
      if (!w.pending) throw new Error('no pending')
      w.active = w.pending.commitment
      w.ruleVersion = w.pending.version
      w.pending = null
      return ACTIVATE_TX
    }),
  }
  const guardian = {
    address: GUARDIAN,
    endorseRuleUpdate: vi.fn(async () => {
      if (w.pending) w.pending.notBefore = BigInt(w.now())
      return ENDORSE_TX
    }),
  }
  const fetchImpl = vi.fn(async (url: string) => w.keeper(String(url)))
  vi.stubGlobal('fetch', fetchImpl)
  const deliverer = {address: CREATOR, signTypedData: vi.fn(async (): Promise<Hex> => `0x${'ab'.repeat(65)}`)}
  return {
    chain: chain as never,
    raw: chain,
    writer: writer as unknown as TasraWriteClient,
    w: writer,
    guardian: guardian as unknown as TasraWriteClient,
    g: guardian,
    fetchImpl,
    deliverer,
  }
}

/** Run `p` to completion under fake timers, advancing one poll interval at a time. */
async function settle<T>(p: Promise<T>, maxSteps = 2_000): Promise<T> {
  let out: {v: T} | {e: unknown} | undefined
  p.then(v => { out = {v} }, (e: unknown) => { out = {e} })
  for (let i = 0; i < maxSteps && out === undefined; i++) await vi.advanceTimersByTimeAsync(5_000)
  if (out === undefined) throw new Error('did not settle')
  if ('e' in out) throw out.e
  return out.v
}

beforeEach(() => {
  vi.useFakeTimers({now: T0 * 1000})
  w = {
    exists: true, creator: CREATOR, active: OLD, ruleVersion: 1n, auth: 1, admin: ADMIN, guardian: GUARDIAN, timelock: 3600,
    pending: null, votes: () => 2, threshold: 2, now: () => Math.floor(Date.now() / 1000), keeper: () => okPending(),
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('readRuleAmendment', () => {
  it('maps an amendable slot with a pending amendment, its votes and threshold', async () => {
    w.pending = {commitment: COMMITMENT, version: 2n, notBefore: BigInt(T0 + 60)}
    w.votes = () => 1
    w.auth = 2
    expect(await readRuleAmendment(harness().chain, SLOT)).toEqual({
      ruleCommitment: OLD, ruleVersion: 1, authType: 'oauth',
      policy: {admin: ADMIN, guardian: GUARDIAN, timelockSecs: 3600},
      pending: {version: 2, ruleCommitment: COMMITMENT, notBefore: T0 + 60, adoptions: 1, needed: 2},
    })
  })

  it('an immutable slot has policy null; no pending is null; votes are not read', async () => {
    Object.assign(w, {admin: ZERO, guardian: ZERO, timelock: 0, auth: 0})
    const h = harness()
    const s = await readRuleAmendment(h.chain, SLOT)
    expect(s.policy).toBeNull()
    expect(s.pending).toBeNull()
    expect(s.authType).toBe('unspecified')
    expect(h.raw.client.readContract.mock.calls.map(c => c[0].functionName)).not.toContain('ruleAdoptionVotes')
  })

  it('omits a zero guardian', async () => {
    w.guardian = ZERO
    expect((await readRuleAmendment(harness().chain, SLOT)).policy).toEqual({admin: ADMIN, timelockSecs: 3600})
  })

  it('refuses a missing slot as no-slot', async () => {
    w.exists = false
    await expect(readRuleAmendment(harness().chain, SLOT)).rejects.toMatchObject({code: 'no-slot'})
  })
})

describe('amendSlotRule', () => {
  it('happy path: proposed, delivered, adopted, endorsed, activated - in that order', async () => {
    const h = harness()
    const phases: AmendmentPhase[] = []
    const r = await settle(amendSlotRule(h.writer, h.chain, {
      slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer, guardian: h.guardian, onPhase: p => phases.push(p),
    }))
    expect(phases).toEqual(['proposed', 'delivered', 'adopted', 'endorsed', 'activated'])
    expect(r).toEqual({version: 2, ruleCommitment: COMMITMENT, proposeTx: PROPOSE_TX, activateTx: ACTIVATE_TX})
    expect(h.fetchImpl).toHaveBeenCalledTimes(3)
    expect(h.deliverer.signTypedData).toHaveBeenCalledTimes(1)
  })

  it('resumes: a pending proposal with this commitment is not proposed again', async () => {
    w.pending = {commitment: COMMITMENT, version: 2n, notBefore: BigInt(T0)}
    const h = harness()
    const r = await settle(amendSlotRule(h.writer, h.chain, {slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer}))
    expect(h.w.proposeRuleUpdate).not.toHaveBeenCalled()
    expect(r).toEqual({version: 2, ruleCommitment: COMMITMENT, activateTx: ACTIVATE_TX})
    expect(r).not.toHaveProperty('proposeTx')
  })

  it('returns at once, without any write, when the rule is already active', async () => {
    Object.assign(w, {active: COMMITMENT, ruleVersion: 4n})
    const h = harness()
    const r = await amendSlotRule(h.writer, h.chain, {slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer})
    expect(r).toEqual({version: 4, ruleCommitment: COMMITMENT})
    expect(h.w.proposeRuleUpdate).not.toHaveBeenCalled()
    expect(h.fetchImpl).not.toHaveBeenCalled()
    expect(h.deliverer.signTypedData).not.toHaveBeenCalled()
  })

  it('activated by another party mid-poll: no activateTx', async () => {
    w.guardian = ZERO
    const h = harness()
    // Somebody else activates once the timelock elapses, before our poll gets there.
    let polls = 0
    h.raw.client.getBlock.mockImplementation(async () => {
      if (++polls === 2 && w.pending) {
        w.active = w.pending.commitment
        w.ruleVersion = w.pending.version
        w.pending = null
      }
      return {timestamp: BigInt(T0)}
    })
    const r = await settle(amendSlotRule(h.writer, h.chain, {slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer}))
    expect(h.w.activateRuleUpdate).not.toHaveBeenCalled()
    expect(r).toEqual({version: 2, ruleCommitment: COMMITMENT, proposeTx: PROPOSE_TX})
  })

  it('a pending proposal with a DIFFERENT commitment is refused before any signature', async () => {
    w.pending = {commitment: hash('cc'), version: 2n, notBefore: BigInt(T0)}
    const h = harness()
    const e = await amendSlotRule(h.writer, h.chain, {slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer}).catch((x: unknown) => x)
    expect((e as RuleAmendmentError).code).toBe('pending')
    expect((e as RuleAmendmentError).pendingVersion).toBe(2)
    expect(h.w.proposeRuleUpdate).not.toHaveBeenCalled()
    expect(h.deliverer.signTypedData).not.toHaveBeenCalled()
  })

  it('refuses immutable before any signature', async () => {
    Object.assign(w, {admin: ZERO, guardian: ZERO, timelock: 0})
    const h = harness()
    await expect(amendSlotRule(h.writer, h.chain, {slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer})).rejects.toMatchObject({code: 'immutable'})
    expect(h.w.proposeRuleUpdate).not.toHaveBeenCalled()
  })

  it('refuses a deliverer that is neither creator nor admin, before proposing', async () => {
    const h = harness()
    const stranger = {...h.deliverer, address: addr('51')}
    await expect(amendSlotRule(h.writer, h.chain, {slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: stranger})).rejects.toMatchObject({code: 'not-deliverer'})
    expect(h.w.proposeRuleUpdate).not.toHaveBeenCalled()
  })

  it('accepts the rule admin as deliverer (case-insensitive)', async () => {
    const h = harness()
    const admin = {...h.deliverer, address: ADMIN.toUpperCase().replace('0X', '0x') as Hex}
    const r = await settle(amendSlotRule(h.writer, h.chain, {slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: admin, guardian: h.guardian}))
    expect(r.activateTx).toBe(ACTIVATE_TX)
  })

  it.each([
    ['a guardian client for another address', GUARDIAN, addr('52')],
    ['a guardian client on a slot without a guardian', ZERO, GUARDIAN],
  ])('refuses %s as not-guardian, before proposing', async (_label, onChain, client) => {
    w.guardian = onChain
    const h = harness()
    const guardian = {...h.g, address: client} as unknown as TasraWriteClient
    await expect(amendSlotRule(h.writer, h.chain, {slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer, guardian})).rejects.toMatchObject({code: 'not-guardian'})
    expect(h.w.proposeRuleUpdate).not.toHaveBeenCalled()
  })

  it('never activates on time alone: chain time past notBefore, but no activation until the votes arrive', async () => {
    let votesArrived = false
    w.votes = () => (votesArrived ? 2 : 1)
    // No delay at all: chain time is past notBefore from the moment of the proposal.
    w.timelock = 0
    const h = harness()
    h.w.activateRuleUpdate.mockImplementation(async () => {
      expect(votesArrived).toBe(true)
      w.active = COMMITMENT
      w.ruleVersion = 2n
      w.pending = null
      return ACTIVATE_TX
    })
    const run = amendSlotRule(h.writer, h.chain, {slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer})
    let out: unknown
    void run.then(v => { out = v })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(h.w.activateRuleUpdate).not.toHaveBeenCalled()
    votesArrived = true
    await settle(run)
    expect(out).toMatchObject({activateTx: ACTIVATE_TX})
    expect(h.w.activateRuleUpdate).toHaveBeenCalledTimes(1)
  })

  it('waits for chain time to reach notBefore before activating', async () => {
    w.guardian = ZERO
    let chainTime = T0
    w.now = () => chainTime
    const h = harness()
    const run = amendSlotRule(h.writer, h.chain, {slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer})
    await vi.advanceTimersByTimeAsync(60_000)
    expect(h.w.activateRuleUpdate).not.toHaveBeenCalled()
    chainTime = T0 + 3600
    const r = await settle(run)
    expect(r.activateTx).toBe(ACTIVATE_TX)
  })

  it('maxWaitMs exhaustion throws timeout with the phase', async () => {
    w.votes = () => 0
    const h = harness()
    const e = await settle(amendSlotRule(h.writer, h.chain, {slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer, maxWaitMs: 30_000})).catch((x: unknown) => x)
    expect((e as RuleAmendmentError).code).toBe('timeout')
    expect((e as RuleAmendmentError).phase).toBe('adopted')
    expect((e as RuleAmendmentError).retryable).toBe(true)
  })

  it('the default wait is the timelock plus ten minutes', async () => {
    w.votes = () => 0
    const h = harness()
    const run = amendSlotRule(h.writer, h.chain, {slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer})
    let out: unknown
    run.catch((x: unknown) => { out = x })
    await vi.advanceTimersByTimeAsync(3600 * 1000 + 600_000 - 10_000)
    expect(out).toBeUndefined()
    await vi.advanceTimersByTimeAsync(20_000)
    expect((out as RuleAmendmentError).code).toBe('timeout')
  })

  it('a pending amendment that vanishes with a different active rule is pending-changed', async () => {
    const h = harness()
    w.votes = () => {
      // A newer proposal activated instead of ours.
      if (w.pending) {
        w.pending = null
        w.active = hash('dd')
      }
      return 0
    }
    await expect(settle(amendSlotRule(h.writer, h.chain, {slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer}))).rejects.toMatchObject({code: 'pending-changed'})
  })

  it('a post-activation read that disagrees is not-activated', async () => {
    w.confirmedCommitment = hash('ee')
    const h = harness()
    await expect(settle(amendSlotRule(h.writer, h.chain, {slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer, guardian: h.guardian}))).rejects.toMatchObject({code: 'not-activated'})
  })

  it('a partial delivery holding at least the needed votes continues', async () => {
    w.keeper = url => (url.startsWith('http://k3') ? new Response('down', {status: 503}) : okPending())
    const h = harness()
    const phases: AmendmentPhase[] = []
    const r = await settle(amendSlotRule(h.writer, h.chain, {slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer, guardian: h.guardian, onPhase: p => phases.push(p)}))
    expect(phases).toContain('delivered')
    expect(r.activateTx).toBe(ACTIVATE_TX)
  })

  it('a partial delivery below the needed votes rethrows the delivery failure', async () => {
    w.keeper = url => (url.startsWith('http://k1') ? okPending() : new Response('down', {status: 503}))
    const h = harness()
    const e = await settle(amendSlotRule(h.writer, h.chain, {slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer})).catch((x: unknown) => x)
    expect(e).not.toBeInstanceOf(RuleAmendmentError)
    expect(String(e)).toMatch(/1 of 3 keepers stored the pending amendment/)
    expect(h.w.activateRuleUpdate).not.toHaveBeenCalled()
  })

  it('refuses malformed ids before any RPC', async () => {
    const h = harness()
    await expect(amendSlotRule(h.writer, h.chain, {slotId: '0x12', ruleSalt: SALT, rule: RULE, deliverer: h.deliverer})).rejects.toThrow(/slotId/)
    expect(h.raw.client.readContract).not.toHaveBeenCalled()
  })
})

describe('amendSlotRule - onPhase order', () => {
  it('without a guardian there is no endorsed phase: proposed, delivered, adopted, activated', async () => {
    w.guardian = ZERO
    const h = harness()
    const phases: AmendmentPhase[] = []
    await settle(amendSlotRule(h.writer, h.chain, {slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer, onPhase: p => phases.push(p)}))
    expect(phases).toEqual(['proposed', 'delivered', 'adopted', 'activated'])
  })

  it('a resumed run never reports proposed', async () => {
    w.guardian = ZERO
    w.pending = {commitment: COMMITMENT, version: 2n, notBefore: BigInt(T0)}
    const h = harness()
    const phases: AmendmentPhase[] = []
    await settle(amendSlotRule(h.writer, h.chain, {slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer, onPhase: p => phases.push(p)}))
    expect(phases).toEqual(['delivered', 'adopted', 'activated'])
  })

  it('a guardian endorses only AFTER the keepers adopted, never while votes are short', async () => {
    let votesArrived = false
    w.votes = () => (votesArrived ? 2 : 0)
    const h = harness()
    const phases: AmendmentPhase[] = []
    const run = amendSlotRule(h.writer, h.chain, {
      slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer, guardian: h.guardian, onPhase: p => phases.push(p),
    })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(phases).toEqual(['proposed', 'delivered'])
    expect(h.g.endorseRuleUpdate).not.toHaveBeenCalled()
    votesArrived = true
    await settle(run)
    expect(phases).toEqual(['proposed', 'delivered', 'adopted', 'endorsed', 'activated'])
    expect(h.g.endorseRuleUpdate).toHaveBeenCalledTimes(1)
  })
})

describe('amendSlotRule - activation waits on CHAIN time, judged against notBefore', () => {
  it('does not activate while only the LOCAL clock has passed notBefore', async () => {
    w.guardian = ZERO
    let chainTime = T0
    w.now = () => chainTime
    const h = harness()
    const run = amendSlotRule(h.writer, h.chain, {slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer, maxWaitMs: 4 * 3600 * 1000})
    // Two hours of local time: well past the 3600 s timelock, with the chain still at T0.
    await vi.advanceTimersByTimeAsync(2 * 3600 * 1000)
    expect(Date.now() / 1000).toBeGreaterThan(T0 + 3600)
    expect(h.w.activateRuleUpdate).not.toHaveBeenCalled()
    chainTime = T0 + 3600
    expect((await settle(run)).activateTx).toBe(ACTIVATE_TX)
  })

  it('activates once CHAIN time reaches notBefore even though the local clock is far behind', async () => {
    w.guardian = ZERO
    let chainTime = T0
    w.now = () => chainTime
    const h = harness()
    const run = amendSlotRule(h.writer, h.chain, {slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer})
    await vi.advanceTimersByTimeAsync(10_000)
    chainTime = T0 + 3600
    const r = await settle(run)
    expect(r.activateTx).toBe(ACTIVATE_TX)
    expect(Date.now() / 1000).toBeLessThan(T0 + 3600)
  })

  it('the boundary is inclusive: notBefore - 1 holds, notBefore activates', async () => {
    w.guardian = ZERO
    let chainTime = T0 + 3599
    w.now = () => chainTime
    // The proposal stamps notBefore = chain time + timelock, so build the world at T0 first.
    const h = harness()
    h.w.proposeRuleUpdate.mockImplementation(async (a: {ruleSalt: Hex; rule: string}) => {
      w.pending = {commitment: ruleCommitment(a.ruleSalt, a.rule), version: 2n, notBefore: BigInt(T0 + 3600)}
      return {txHash: PROPOSE_TX, version: 2, notBefore: T0 + 3600}
    })
    const run = amendSlotRule(h.writer, h.chain, {slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer})
    await vi.advanceTimersByTimeAsync(60_000)
    expect(h.w.activateRuleUpdate).not.toHaveBeenCalled()
    chainTime = T0 + 3600
    expect((await settle(run)).activateTx).toBe(ACTIVATE_TX)
  })
})

describe('amendSlotRule - timeout names the phase it was stuck in', () => {
  it("chain time never reaches notBefore: timeout in 'activated', and nothing is activated", async () => {
    w.guardian = ZERO
    w.now = () => T0
    const h = harness()
    const e = await settle(amendSlotRule(h.writer, h.chain, {slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer, maxWaitMs: 30_000})).catch((x: unknown) => x)
    expect((e as RuleAmendmentError).code).toBe('timeout')
    expect((e as RuleAmendmentError).phase).toBe('activated')
    expect(h.w.activateRuleUpdate).not.toHaveBeenCalled()
  })

  it("votes never arrive with a guardian: timeout in 'adopted' and the guardian is never asked to endorse", async () => {
    w.votes = () => 0
    const h = harness()
    const e = await settle(amendSlotRule(h.writer, h.chain, {
      slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer, guardian: h.guardian, maxWaitMs: 30_000,
    })).catch((x: unknown) => x)
    expect((e as RuleAmendmentError).code).toBe('timeout')
    expect((e as RuleAmendmentError).phase).toBe('adopted')
    expect(h.g.endorseRuleUpdate).not.toHaveBeenCalled()
    expect(h.w.activateRuleUpdate).not.toHaveBeenCalled()
  })
})

describe('amendSlotRule - AbortSignal', () => {
  it('an already-aborted signal stops before any RPC, proposal or signature', async () => {
    const h = harness()
    await expect(amendSlotRule(h.writer, h.chain, {
      slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer, signal: AbortSignal.abort(new Error('stop now')),
    })).rejects.toThrow('stop now')
    expect(h.raw.client.readContract).not.toHaveBeenCalled()
    expect(h.w.proposeRuleUpdate).not.toHaveBeenCalled()
    expect(h.deliverer.signTypedData).not.toHaveBeenCalled()
  })

  it('an abort while waiting for adoption rejects with the reason and polling stops', async () => {
    w.votes = () => 0
    const h = harness()
    const controller = new AbortController()
    const run = amendSlotRule(h.writer, h.chain, {slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer, guardian: h.guardian, signal: controller.signal})
      .catch((x: unknown) => x)
    await vi.advanceTimersByTimeAsync(12_000)
    controller.abort(new Error('stop now'))
    const e = await run
    expect((e as Error).message).toBe('stop now')
    const reads = h.raw.client.readContract.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(h.raw.client.readContract.mock.calls.length).toBe(reads)
    expect(h.g.endorseRuleUpdate).not.toHaveBeenCalled()
    expect(h.w.activateRuleUpdate).not.toHaveBeenCalled()
  })

  it('an abort while waiting for chain time rejects with the reason and never activates', async () => {
    w.guardian = ZERO
    w.now = () => T0
    const h = harness()
    const controller = new AbortController()
    const run = amendSlotRule(h.writer, h.chain, {slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer, signal: controller.signal})
      .catch((x: unknown) => x)
    await vi.advanceTimersByTimeAsync(12_000)
    controller.abort(new Error('stop now'))
    const e = await run
    expect((e as Error).message).toBe('stop now')
    // Even if the chain moves on afterwards, the aborted run does nothing more.
    w.now = () => T0 + 7200
    await vi.advanceTimersByTimeAsync(60_000)
    expect(h.w.activateRuleUpdate).not.toHaveBeenCalled()
  })
})

describe('amendSlotRule - losing the activation race', () => {
  const noPending = () => new RuleAmendmentError('no-pending', SLOT, 'no pending amendment')

  it('activate refuses no-pending because THIS rule just became active: success without activateTx', async () => {
    w.guardian = ZERO
    const h = harness()
    const phases: AmendmentPhase[] = []
    h.w.activateRuleUpdate.mockImplementation(async () => {
      // Somebody else activated between our read and our write.
      w.active = COMMITMENT
      w.ruleVersion = 2n
      w.pending = null
      throw noPending()
    })
    const r = await settle(amendSlotRule(h.writer, h.chain, {slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer, onPhase: p => phases.push(p)}))
    expect(h.w.activateRuleUpdate).toHaveBeenCalledTimes(1)
    expect(r).toEqual({version: 2, ruleCommitment: COMMITMENT, proposeTx: PROPOSE_TX})
    expect(phases).not.toContain('activated')
  })

  it('activate refuses no-pending because a DIFFERENT rule took over: pending-changed, not success', async () => {
    w.guardian = ZERO
    const h = harness()
    h.w.activateRuleUpdate.mockImplementation(async () => {
      w.active = hash('dd')
      w.pending = null
      throw noPending()
    })
    await expect(settle(amendSlotRule(h.writer, h.chain, {slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer}))).rejects.toMatchObject({code: 'pending-changed'})
  })

  it('any other activation failure propagates untouched', async () => {
    w.guardian = ZERO
    const h = harness()
    h.w.activateRuleUpdate.mockRejectedValue(new Error('rpc exploded'))
    await expect(settle(amendSlotRule(h.writer, h.chain, {slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer}))).rejects.toThrow('rpc exploded')
    expect(h.w.activateRuleUpdate).toHaveBeenCalledTimes(1)
  })
})

describe('amendSlotRule - input and race edges', () => {
  it.each([0, -1, 1.5, Number.NaN])('refuses maxWaitMs %s before any RPC', async bad => {
    const h = harness()
    await expect(amendSlotRule(h.writer, h.chain, {slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer, maxWaitMs: bad})).rejects.toThrow(/maxWaitMs/)
    expect(h.raw.client.readContract).not.toHaveBeenCalled()
    expect(h.w.proposeRuleUpdate).not.toHaveBeenCalled()
  })

  it('another party activating THIS rule while we wait for adoption ends the run without activateTx or an adopted phase', async () => {
    w.guardian = ZERO
    let polls = 0
    w.votes = () => {
      if (++polls === 2 && w.pending) {
        w.active = w.pending.commitment
        w.ruleVersion = w.pending.version
        w.pending = null
      }
      return 0
    }
    const h = harness()
    const phases: AmendmentPhase[] = []
    const r = await settle(amendSlotRule(h.writer, h.chain, {slotId: SLOT, ruleSalt: SALT, rule: RULE, deliverer: h.deliverer, onPhase: p => phases.push(p)}))
    expect(r).toEqual({version: 2, ruleCommitment: COMMITMENT, proposeTx: PROPOSE_TX})
    expect(h.w.activateRuleUpdate).not.toHaveBeenCalled()
    expect(phases).toEqual(['proposed', 'delivered'])
  })
})
