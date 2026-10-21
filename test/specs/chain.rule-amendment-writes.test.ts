// The four rule-amendment writes on the write client: every refusal the contract would revert
// with is raised BEFORE anything is signed, and the calls that do go out carry the pinned shape.
//
// Why "before signing" matters here more than anywhere: a proposal no keeper will store never
// activates, and `proposeRuleUpdate` refuses while one is pending - on a slot without a guardian a
// bad proposal freezes the rule for good. So each refusal case below asserts `submit` was NOT
// called, not just that something threw.
//
// The fixture poisons both direct paths, so every write goes through the relay mock and its
// calldata is decoded back through the vendored ABI (as chain.create-call-shape does).
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {
  createWalletClient,
  decodeFunctionData,
  defineChain,
  encodeAbiParameters,
  encodeEventTopics,
  http,
  keccak256,
  toHex,
  type Hex,
} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {createTasraWriteClient, ruleCommitment} from '../../src/chain/write.js'
import {keyRegistryAbi} from '../../src/chain/abis/keyRegistry.js'
import {RuleAmendmentError} from '../../src/chain/ruleAmendment.js'

const mocks = vi.hoisted(() => ({submit: vi.fn(), read: vi.fn(), receipt: vi.fn(), getBlock: vi.fn()}))
vi.mock('viem', async original => ({
  ...await original<typeof import('viem')>(),
  createPublicClient: () => ({readContract: mocks.read, waitForTransactionReceipt: mocks.receipt, getBlock: mocks.getBlock}),
}))
vi.mock('../../src/chain/registeredRelay.js', async original => ({
  ...await original<typeof import('../../src/chain/registeredRelay.js')>(),
  createRegisteredRelaySubmitter: () => ({submit: mocks.submit}),
}))

const hash = (v: string): Hex => `0x${v.repeat(32)}`
const REGISTRY = `0x${'11'.repeat(20)}` as const
const ME = privateKeyToAccount(hash('01')).address
const OTHER = `0x${'44'.repeat(20)}` as const
const ZERO = '0x0000000000000000000000000000000000000000' as const
const SLOT = hash('04')
const SALT = hash('06')
const TX = hash('09')
const NEW_RULE = 'verify:new'
const chain = defineChain({id: 31337, name: 'fixture', nativeCurrency: {name: 'ETH', symbol: 'ETH', decimals: 18}, rpcUrls: {default: {http: ['http://localhost:1']}}})

const POLICY = 'package tasra.slot\n\ndefault allow := false\n\nallow if "treasury-signer" in input.tokens.kc.claims.realm_access.roles\n'
const TOKENS = {kc: {format: 'oauth+access-token+dpop', iss: ['https://idp.kk.local/realms/kk'], aud: ['https://localhost:19444/authz/43112'], max_age_secs: 300}}
// Structurally valid (default + allow), so ONLY the forbidden builtin can be the reason for the refusal.
const FORBIDDEN_BUILTIN = 'package tasra.slot\n\ndefault allow := false\n\nallow if http.send({})\n'
const OID4VP_RULE = JSON.stringify({credentials: [{id: 'corp', format: 'dc+sd-jwt', claims: [{path: ['iss'], values: ['https://issuer.example']}]}]})

/** The on-chain state every read is served from; each test edits what it needs. */
interface ChainState {
  exists: boolean
  cancelled: boolean
  creator: Hex
  ruleCommitment: Hex
  auth: number
  admin: Hex
  guardian: Hex
  timelock: number
  pending: {commitment: Hex; version: bigint; notBefore: bigint} | null
  votes: number
  threshold: number
}
let state: ChainState

function freshState(): ChainState {
  return {
    exists: true, cancelled: false, creator: OTHER, ruleCommitment: hash('aa'), auth: 2,
    admin: ME, guardian: OTHER, timelock: 3600, pending: null, votes: 0, threshold: 2,
  }
}

function fixture(relayed = true) {
  const wallet = createWalletClient({account: privateKeyToAccount(hash('01')), chain, transport: http()})
  vi.spyOn(wallet, 'writeContract').mockRejectedValue(new Error('Unexpected direct transaction'))
  vi.spyOn(wallet, 'sendTransaction').mockRejectedValue(new Error('Unexpected direct gas payment'))
  return createTasraWriteClient({
    rpcUrl: 'http://localhost:1',
    wallet,
    addresses: {KeyRegistry: REGISTRY, ServiceRegistry: REGISTRY},
    ...(relayed
      ? {relay: {
          forwarder: REGISTRY,
          approvals: [{chainId: 31337, registry: REGISTRY, serviceId: hash('02'), owner: REGISTRY, serviceType: 0, revision: 1n, manifestHash: hash('03')}],
          transport: {request: vi.fn(), relayRequest: vi.fn()},
        }}
      : {}),
  })
}

/** A `RuleUpdateProposed` log as the KeyRegistry emits it. */
function proposedLog(opts: {slotId?: Hex; version?: bigint; commitment?: Hex; notBefore?: bigint; address?: Hex} = {}) {
  return {
    address: opts.address ?? REGISTRY,
    topics: encodeEventTopics({abi: keyRegistryAbi, eventName: 'RuleUpdateProposed', args: {slotId: opts.slotId ?? SLOT, version: opts.version ?? 2n}}),
    data: encodeAbiParameters([{type: 'bytes32'}, {type: 'uint64'}], [opts.commitment ?? hash('bb'), opts.notBefore ?? 1_700_003_600n]),
    blockHash: hash('0c'), blockNumber: 1n, logIndex: 0, transactionHash: TX, transactionIndex: 0, removed: false,
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  state = freshState()
  mocks.read.mockImplementation(async ({functionName}: {functionName: string}) => {
    switch (functionName) {
      case 'getKeySlot':
        return {
          creator: state.creator, ruleCommitment: state.ruleCommitment, threshold: {k: 2, n: 3}, mode: 0, publicKey: '0x',
          epoch: 1n, committeeVersion: 1n, exists: state.exists, cancelled: state.cancelled, expiry: 0n, ruleVersion: 1n, auth: state.auth,
        }
      case 'rulePolicy':
        return [state.admin, state.guardian, state.timelock]
      case 'pendingRule':
        return state.pending ? [state.pending.commitment, state.pending.version, state.pending.notBefore] : [hash('00'), 0n, 0n]
      case 'ruleAdoptionVotes':
        return state.votes
      case 'ruleAdoptionThreshold':
        return state.threshold
      default:
        throw new Error(`Unexpected read ${functionName}`)
    }
  })
  mocks.receipt.mockResolvedValue({status: 'success', logs: [proposedLog()]})
  mocks.submit.mockImplementation(async () => ({id: hash('08'), txHash: TX}))
  mocks.getBlock.mockResolvedValue({timestamp: 1_700_000_000n})
})

const relayedCalls = () => mocks.submit.mock.calls.map(([, data]) => decodeFunctionData({abi: keyRegistryAbi, data: data as Hex}))

/** Assert a refusal with `code`, raised before anything was submitted. */
async function refuses(run: () => Promise<unknown>, code: string): Promise<RuleAmendmentError> {
  const e = await run().catch((err: unknown) => err)
  expect(e).toBeInstanceOf(RuleAmendmentError)
  expect((e as RuleAmendmentError).code).toBe(code)
  expect(mocks.submit).not.toHaveBeenCalled()
  return e as RuleAmendmentError
}

describe('proposeRuleUpdate refusals (before signing)', () => {
  it.each([
    ['exists false', {exists: false}],
    ['cancelled', {cancelled: true}],
  ])('no-slot: %s', async (_label, patch) => {
    Object.assign(state, patch)
    const e = await refuses(() => fixture().proposeRuleUpdate({slotId: SLOT, ruleSalt: SALT, rule: NEW_RULE}), 'no-slot')
    expect(e.slotId).toBe(SLOT)
    expect(e.retryable).toBe(false)
  })

  it('immutable: a slot created without a rulePolicy', async () => {
    Object.assign(state, {admin: ZERO, guardian: ZERO, timelock: 0})
    const e = await refuses(() => fixture().proposeRuleUpdate({slotId: SLOT, ruleSalt: SALT, rule: NEW_RULE}), 'immutable')
    expect(e.message).toMatch(/create a new slot/)
  })

  it('not-admin: names both addresses', async () => {
    state.admin = OTHER
    const e = await refuses(() => fixture().proposeRuleUpdate({slotId: SLOT, ruleSalt: SALT, rule: NEW_RULE}), 'not-admin')
    expect(e.message).toContain(OTHER)
    expect(e.message).toContain(ME)
  })

  it('not-admin comparison is case-insensitive', async () => {
    state.admin = ME.toLowerCase() as Hex
    await fixture().proposeRuleUpdate({slotId: SLOT, ruleSalt: SALT, rule: NEW_RULE})
    expect(mocks.submit).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['with a guardian', OTHER, true],
    ['without a guardian', ZERO, false],
  ])('pending: carries the version and whether a guardian exists (%s)', async (_label, guardian, hasGuardian) => {
    state.guardian = guardian
    state.pending = {commitment: hash('cc'), version: 5n, notBefore: 1n}
    const e = await refuses(() => fixture().proposeRuleUpdate({slotId: SLOT, ruleSalt: SALT, rule: NEW_RULE}), 'pending')
    expect(e.pendingVersion).toBe(5)
    expect(e.pendingCommitment).toBe(hash('cc'))
    expect(e.hasGuardian).toBe(hasGuardian)
    expect(e.message).toMatch(/version 5/)
  })

  it('same-rule: the proposal equals the active commitment', async () => {
    state.ruleCommitment = ruleCommitment(SALT, NEW_RULE)
    await refuses(() => fixture().proposeRuleUpdate({slotId: SLOT, ruleSalt: SALT, rule: NEW_RULE}), 'same-rule')
  })

  it('wrong-auth-type: a policy envelope on an oid4vp slot', async () => {
    state.auth = 1
    const e = await refuses(() => fixture().proposeRuleUpdate({slotId: SLOT, ruleSalt: SALT, oauthPolicy: {policy: POLICY, tokens: TOKENS}}), 'wrong-auth-type')
    expect(e.message).toMatch(/oid4vp/)
  })

  it('not-admissible: an oauthPolicy the gate refuses (pack fails)', async () => {
    const e = await refuses(
      () => fixture().proposeRuleUpdate({slotId: SLOT, ruleSalt: SALT, oauthPolicy: {policy: FORBIDDEN_BUILTIN, tokens: TOKENS}}),
      'not-admissible',
    )
    expect(e.message).toMatch(/http\.send/)
  })

  it('not-admissible: a well-formed envelope keepers would not store yet (lint fails)', async () => {
    // Phase 1 admits one token; two make a well-formed envelope that lint reports as not admissible.
    const two = {...TOKENS, kc2: {...TOKENS.kc}}
    const source = 'package tasra.slot\n\ndefault allow := false\n\nallow if {\n\t"a" in input.tokens.kc.claims.roles\n\t"b" in input.tokens.kc2.claims.roles\n}\n'
    const env = JSON.stringify({kk_oauth: {v: 1, tokens: two, policy: {lang: 'rego/v1', entrypoint: 'data.tasra.slot.allow', source}}})
    const e = await refuses(() => fixture().proposeRuleUpdate({slotId: SLOT, ruleSalt: SALT, rule: env}), 'not-admissible')
    expect(e.message).toMatch(/exactly one entry/)
  })

  it('an OID4VP rule on an oauth slot is NOT refused (one-directional)', async () => {
    state.auth = 2
    await fixture().proposeRuleUpdate({slotId: SLOT, ruleSalt: SALT, rule: OID4VP_RULE})
    expect(relayedCalls()[0]!.functionName).toBe('proposeRuleUpdate')
  })

  it.each([
    ['both rule and oauthPolicy', {rule: NEW_RULE, oauthPolicy: {policy: POLICY, tokens: TOKENS}}],
    ['neither', {}],
  ])('refuses %s before any RPC', async (_label, extra) => {
    const e = await fixture().proposeRuleUpdate({slotId: SLOT, ruleSalt: SALT, ...extra} as never).catch((err: unknown) => err)
    expect(e).toBeInstanceOf(Error)
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  const SHORT: Hex = '0x1234'
  it.each([
    ['slotId', {slotId: SHORT, ruleSalt: SALT}],
    ['ruleSalt', {slotId: SLOT, ruleSalt: 'nope' as Hex}],
  ])('refuses a malformed %s before any RPC', async (field, ids) => {
    const e = await fixture().proposeRuleUpdate({...ids, rule: NEW_RULE}).catch((err: unknown) => err)
    expect(String(e)).toContain(field)
    expect(mocks.read).not.toHaveBeenCalled()
  })
})

describe('proposeRuleUpdate call shape and receipt', () => {
  it('sends proposeRuleUpdate(slotId, ruleCommitment(ruleSalt, rule)) - the SALTED commitment', async () => {
    await fixture().proposeRuleUpdate({slotId: SLOT, ruleSalt: SALT, rule: NEW_RULE})
    const calls = relayedCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.functionName).toBe('proposeRuleUpdate')
    expect(calls[0]!.args).toEqual([SLOT, ruleCommitment(SALT, NEW_RULE)])
    expect(calls[0]!.args[1]).not.toBe(keccak256(toHex(NEW_RULE)))
    expect(calls[0]!.args[1]).not.toBe(SALT)
  })

  it('decodes version and notBefore from RuleUpdateProposed and returns the relay receipt', async () => {
    mocks.receipt.mockResolvedValue({
      status: 'success',
      // A foreign contract's log and another slot's log must both be ignored.
      logs: [proposedLog({address: OTHER, version: 9n}), proposedLog({slotId: hash('05'), version: 8n}), proposedLog({version: 3n, notBefore: 1_700_007_200n})],
    })
    const r = await fixture().proposeRuleUpdate({slotId: SLOT, ruleSalt: SALT, rule: NEW_RULE})
    expect(r).toMatchObject({slotId: SLOT, txHash: TX, version: 3, notBefore: 1_700_007_200, ruleCommitment: ruleCommitment(SALT, NEW_RULE), ruleSalt: SALT, rule: NEW_RULE})
    expect(r.relay?.txHash).toBe(TX)
  })

  it('returns the packed envelope as the rule for an oauthPolicy', async () => {
    const r = await fixture().proposeRuleUpdate({slotId: SLOT, ruleSalt: SALT, oauthPolicy: {policy: POLICY, tokens: TOKENS}})
    expect(r.rule).toMatch(/^\{"kk_oauth":/)
    expect(relayedCalls()[0]!.args[1]).toBe(ruleCommitment(SALT, r.rule))
  })

  it('throws when the confirmed receipt carries no matching RuleUpdateProposed', async () => {
    mocks.receipt.mockResolvedValue({status: 'success', logs: [proposedLog({slotId: hash('05')})]})
    await expect(fixture().proposeRuleUpdate({slotId: SLOT, ruleSalt: SALT, rule: NEW_RULE})).rejects.toThrow(/carries no RuleUpdateProposed/)
  })

  it('a reverted receipt throws the REVERTED message', async () => {
    mocks.receipt.mockResolvedValue({status: 'reverted', logs: []})
    await expect(fixture().proposeRuleUpdate({slotId: SLOT, ruleSalt: SALT, rule: NEW_RULE})).rejects.toThrow(/REVERTED on chain/)
  })
})

describe('endorseRuleUpdate / vetoRuleUpdate', () => {
  beforeEach(() => {
    state.guardian = ME
    state.admin = OTHER
    state.pending = {commitment: hash('cc'), version: 2n, notBefore: 1_700_003_600n}
  })

  it.each(['endorseRuleUpdate', 'vetoRuleUpdate'] as const)('%s sends (slotId) and returns the hash', async fn => {
    const h = await fixture()[fn](SLOT)
    expect(h).toBe(TX)
    const calls = relayedCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.functionName).toBe(fn)
    expect(calls[0]!.args).toEqual([SLOT])
  })

  it.each(['endorseRuleUpdate', 'vetoRuleUpdate'] as const)('%s refuses not-guardian when the slot has none', async fn => {
    state.guardian = ZERO
    const e = await refuses(() => fixture()[fn](SLOT), 'not-guardian')
    expect(e.hasGuardian).toBe(false)
  })

  it.each(['endorseRuleUpdate', 'vetoRuleUpdate'] as const)('%s refuses not-guardian for another signer', async fn => {
    state.guardian = OTHER
    await refuses(() => fixture()[fn](SLOT), 'not-guardian')
  })

  it.each(['endorseRuleUpdate', 'vetoRuleUpdate'] as const)('%s refuses no-pending', async fn => {
    state.pending = null
    await refuses(() => fixture()[fn](SLOT), 'no-pending')
  })
})

describe('activateRuleUpdate', () => {
  beforeEach(() => {
    state.pending = {commitment: hash('cc'), version: 2n, notBefore: 1_700_003_600n}
    state.votes = 2
    state.threshold = 2
    mocks.getBlock.mockResolvedValue({timestamp: 1_700_003_600n})
  })

  it('sends activateRuleUpdate(slotId) once chain time and votes allow it', async () => {
    const h = await fixture().activateRuleUpdate(SLOT)
    expect(h).toBe(TX)
    const calls = relayedCalls()
    expect(calls[0]!.functionName).toBe('activateRuleUpdate')
    expect(calls[0]!.args).toEqual([SLOT])
  })

  it('sends directly when no relay is configured', async () => {
    const writer = fixture(false)
    vi.mocked(writer.wallet.writeContract).mockResolvedValue(hash('0d'))
    expect(await writer.activateRuleUpdate(SLOT)).toBe(hash('0d'))
    expect(writer.wallet.writeContract).toHaveBeenCalledWith(expect.objectContaining({functionName: 'activateRuleUpdate', args: [SLOT]}))
  })

  it('refuses no-pending', async () => {
    state.pending = null
    await refuses(() => fixture().activateRuleUpdate(SLOT), 'no-pending')
  })

  it('refuses timelock on CHAIN time even when the local clock is far ahead', async () => {
    vi.useFakeTimers({now: new Date('2100-01-01T00:00:00Z')})
    try {
      mocks.getBlock.mockResolvedValue({timestamp: 1_700_003_599n})
      const e = await refuses(() => fixture().activateRuleUpdate(SLOT), 'timelock')
      expect(e.notBefore).toBe(1_700_003_600)
      expect(e.chainTime).toBe(1_700_003_599)
      expect(e.retryable).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses below-threshold with have and need', async () => {
    state.votes = 1
    state.threshold = 3
    const e = await refuses(() => fixture().activateRuleUpdate(SLOT), 'below-threshold')
    expect(e.have).toBe(1)
    expect(e.need).toBe(3)
    expect(e.retryable).toBe(true)
  })
})

// Without a relay the write goes straight through the wallet. A refusal must stop there too: the
// relayed fixture above only proves the relay submitter was never reached.
describe('refusals never reach the direct wallet path either (no relay configured)', () => {
  const PENDING = {commitment: hash('cc'), version: 2n, notBefore: 1_700_003_600n}
  const propose = (w: ReturnType<typeof fixture>) => w.proposeRuleUpdate({slotId: SLOT, ruleSalt: SALT, rule: NEW_RULE})
  const cases: Array<[string, () => void, (w: ReturnType<typeof fixture>) => Promise<unknown>, string]> = [
    ['propose no-slot', () => { state.exists = false }, propose, 'no-slot'],
    ['propose immutable', () => { Object.assign(state, {admin: ZERO, guardian: ZERO, timelock: 0}) }, propose, 'immutable'],
    ['propose not-admin', () => { state.admin = OTHER }, propose, 'not-admin'],
    ['propose pending', () => { state.pending = PENDING }, propose, 'pending'],
    ['propose same-rule', () => { state.ruleCommitment = ruleCommitment(SALT, NEW_RULE) }, propose, 'same-rule'],
    [
      'propose wrong-auth-type',
      () => { state.auth = 1 },
      w => w.proposeRuleUpdate({slotId: SLOT, ruleSalt: SALT, oauthPolicy: {policy: POLICY, tokens: TOKENS}}),
      'wrong-auth-type',
    ],
    [
      'propose not-admissible',
      () => undefined,
      w => w.proposeRuleUpdate({slotId: SLOT, ruleSalt: SALT, oauthPolicy: {policy: FORBIDDEN_BUILTIN, tokens: TOKENS}}),
      'not-admissible',
    ],
    ['endorse not-guardian', () => { state.pending = PENDING }, w => w.endorseRuleUpdate(SLOT), 'not-guardian'],
    ['veto no-pending', () => { state.guardian = ME }, w => w.vetoRuleUpdate(SLOT), 'no-pending'],
    ['activate no-pending', () => undefined, w => w.activateRuleUpdate(SLOT), 'no-pending'],
    [
      'activate timelock',
      () => { state.pending = PENDING; state.votes = 2; mocks.getBlock.mockResolvedValue({timestamp: 1_700_003_599n}) },
      w => w.activateRuleUpdate(SLOT),
      'timelock',
    ],
    [
      'activate below-threshold',
      () => { state.pending = PENDING; state.votes = 1; mocks.getBlock.mockResolvedValue({timestamp: 1_700_003_600n}) },
      w => w.activateRuleUpdate(SLOT),
      'below-threshold',
    ],
  ]

  it.each(cases)('%s: neither writeContract nor sendTransaction is called', async (_label, arrange, run, code) => {
    arrange()
    const writer = fixture(false)
    const e = await run(writer).catch((err: unknown) => err)
    expect(e).toBeInstanceOf(RuleAmendmentError)
    expect((e as RuleAmendmentError).code).toBe(code)
    expect(writer.wallet.writeContract).not.toHaveBeenCalled()
    expect(writer.wallet.sendTransaction).not.toHaveBeenCalled()
    expect(mocks.submit).not.toHaveBeenCalled()
  })
})

describe('activateRuleUpdate timelock is judged on the latest BLOCK timestamp', () => {
  beforeEach(() => {
    state.pending = {commitment: hash('cc'), version: 2n, notBefore: 1_700_003_600n}
    state.votes = 2
  })

  // The local clock is pinned a century ahead, so only the block timestamp can decide.
  it.each([
    [1_700_003_599n, 'timelock'],
    [1_700_000_000n, 'timelock'],
  ])('block timestamp %s is before notBefore: refused as %s', async (timestamp, code) => {
    vi.useFakeTimers({now: new Date('2100-01-01T00:00:00Z')})
    try {
      mocks.getBlock.mockResolvedValue({timestamp})
      const e = await refuses(() => fixture().activateRuleUpdate(SLOT), code)
      expect(e.chainTime).toBe(Number(timestamp))
      expect(e.notBefore).toBe(1_700_003_600)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([1_700_003_600n, 1_700_003_601n, 1_900_000_000n])('block timestamp %s has reached notBefore: the call goes out', async timestamp => {
    // The local clock is a century BEHIND the chain's would-be answer: it must not veto either.
    vi.useFakeTimers({now: new Date('1971-01-01T00:00:00Z')})
    try {
      mocks.getBlock.mockResolvedValue({timestamp})
      expect(await fixture().activateRuleUpdate(SLOT)).toBe(TX)
      expect(mocks.submit).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
