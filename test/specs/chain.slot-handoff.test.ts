// The six slot hand-off writes on the write client and the status read: every refusal the
// contract would revert with is raised BEFORE anything is signed, the calls that go out carry the
// pinned shape, and each write confirms the effect by reading the slot again.
//
// The fixture poisons both direct paths, so every write goes through the relay mock; the mock
// applies the decoded call to the fixture chain, so a confirmation reads what the call did.
import {createRequire} from 'node:module'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {
  ContractFunctionZeroDataError,
  createWalletClient,
  decodeFunctionData,
  defineChain,
  http,
  type Address,
  type Hex,
} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {createTasraWriteClient} from '../../src/chain/write.js'
import {keyRegistryAbi} from '../../src/chain/abis/keyRegistry.js'
import {SlotHandoffError, readSlotHandoff} from '../../src/chain/slotHandoff.js'
import type {TasraChainClient} from '../../src/chain/client.js'

const mocks = vi.hoisted(() => ({submit: vi.fn(), read: vi.fn(), receipt: vi.fn()}))
vi.mock('viem', async original => ({
  ...await original<typeof import('viem')>(),
  createPublicClient: () => ({readContract: mocks.read, getTransactionReceipt: mocks.receipt}),
}))
vi.mock('../../src/chain/registeredRelay.js', async original => ({
  ...await original<typeof import('../../src/chain/registeredRelay.js')>(),
  createRegisteredRelaySubmitter: () => ({submit: mocks.submit}),
}))

const hash = (v: string): Hex => `0x${v.repeat(32)}`
const REGISTRY = `0x${'11'.repeat(20)}` as const
const SETTLEMENT = `0x${'12'.repeat(20)}` as const
const ME = privateKeyToAccount(hash('01')).address
const OTHER = `0x${'44'.repeat(20)}` as Address
const BUYER = `0x${'55'.repeat(20)}` as Address
const GUARDIAN = `0x${'66'.repeat(20)}` as Address
const ZERO = '0x0000000000000000000000000000000000000000' as Address
const SLOT = hash('04')
const TX = hash('09')
const chain = defineChain({id: 31337, name: 'fixture', nativeCurrency: {name: 'ETH', symbol: 'ETH', decimals: 18}, rpcUrls: {default: {http: ['http://localhost:1']}}})

interface ChainState {
  exists: boolean
  cancelled: boolean
  creator: Address
  pendingCreator: Address
  admin: Address
  guardian: Address
  pendingAdmin: Address
  /** False models a KeyRegistry from before the hand-off. */
  handoff: boolean
  /** False models a write that mines without the effect. */
  applies: boolean
  reserved: boolean
}
let state: ChainState

function freshState(): ChainState {
  return {
    exists: true, cancelled: false, creator: ME, pendingCreator: ZERO, admin: OTHER, guardian: GUARDIAN,
    pendingAdmin: ZERO, handoff: true, applies: true, reserved: true,
  }
}

function fixture(addresses: Record<string, Address> = {}) {
  const wallet = createWalletClient({account: privateKeyToAccount(hash('01')), chain, transport: http()})
  vi.spyOn(wallet, 'writeContract').mockRejectedValue(new Error('Unexpected direct transaction'))
  vi.spyOn(wallet, 'sendTransaction').mockRejectedValue(new Error('Unexpected direct gas payment'))
  return createTasraWriteClient({
    rpcUrl: 'http://localhost:1',
    wallet,
    addresses: {KeyRegistry: REGISTRY, ServiceRegistry: REGISTRY, ...addresses},
    relay: {
      forwarder: REGISTRY,
      approvals: [{chainId: 31337, registry: REGISTRY, serviceId: hash('02'), owner: REGISTRY, serviceType: 0, revision: 1n, manifestHash: hash('03')}],
      transport: {request: vi.fn(), relayRequest: vi.fn()},
    },
  })
}

/** The fixture chain as the contract would leave it after `data`, sent by this client's account. */
function apply(data: Hex) {
  if (!state.applies) return
  const call = decodeFunctionData({abi: keyRegistryAbi, data})
  const to = (call.args as readonly unknown[])[1] as Address
  switch (call.functionName) {
    case 'proposeCreator':
      state.pendingCreator = to
      break
    case 'acceptCreator':
      Object.assign(state, {creator: state.pendingCreator, pendingCreator: ZERO})
      break
    case 'proposeRuleAdmin':
      state.pendingAdmin = to
      break
    case 'acceptRuleAdmin':
      Object.assign(state, {admin: state.pendingAdmin, pendingAdmin: ZERO})
      break
    default:
      throw new Error(`Unexpected call ${call.functionName}`)
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
          creator: state.creator, ruleCommitment: hash('aa'), threshold: {k: 2, n: 3}, mode: 0, publicKey: '0x',
          epoch: 1n, committeeVersion: 1n, exists: state.exists, cancelled: state.cancelled, expiry: 0n, ruleVersion: 1n, auth: 1,
        }
      case 'rulePolicy':
        return [state.admin, state.guardian, 3600]
      case 'pendingCreator':
      case 'pendingRuleAdmin':
        if (!state.handoff) throw new ContractFunctionZeroDataError({functionName})
        return functionName === 'pendingCreator' ? state.pendingCreator : state.pendingAdmin
      case 'balanceOf':
        return 7_000n
      case 'reservedBalanceOf':
        if (!state.reserved) throw new ContractFunctionZeroDataError({functionName})
        return 2_000n
      default:
        throw new Error(`Unexpected read ${functionName}`)
    }
  })
  mocks.receipt.mockResolvedValue({status: 'success', logs: []})
  mocks.submit.mockImplementation(async (_to: Address, data: Hex) => {
    apply(data)
    return {id: hash('08'), txHash: TX}
  })
})

const sent = () => mocks.submit.mock.calls.map(([to, data]) => ({to, ...decodeFunctionData({abi: keyRegistryAbi, data: data as Hex})}))

/** Assert a refusal with `code`, raised before anything was submitted. */
async function refuses(run: () => Promise<unknown>, code: string): Promise<SlotHandoffError> {
  const e = await run().catch((err: unknown) => err)
  expect(e).toBeInstanceOf(SlotHandoffError)
  expect((e as SlotHandoffError).code).toBe(code)
  expect((e as SlotHandoffError).slotId).toBe(SLOT)
  expect((e as SlotHandoffError).retryable).toBe(false)
  expect(mocks.submit).not.toHaveBeenCalled()
  return e as SlotHandoffError
}

describe('proposeSlotTransfer', () => {
  it('offers the slot, names the roles that stay, and carries the prepaid credit', async () => {
    const r = await fixture({Settlement: SETTLEMENT}).proposeSlotTransfer(SLOT, BUYER)
    expect(sent()).toEqual([{to: REGISTRY, functionName: 'proposeCreator', args: [SLOT, BUYER]}])
    expect(r).toMatchObject({slotId: SLOT, txHash: TX, to: BUYER, ruleAdmin: OTHER, guardian: GUARDIAN, callerIsRuleAdmin: false})
    expect(r.prepaidBalance).toBe(7_000n)
    expect(r.reservedBalance).toBe(2_000n)
    expect(state.creator).toBe(ME)
  })

  it('says when the caller also holds the rule admin, which does not move', async () => {
    state.admin = ME
    const r = await fixture().proposeSlotTransfer(SLOT, BUYER)
    expect(r.callerIsRuleAdmin).toBe(true)
    expect(r.prepaidBalance).toBeUndefined()
    expect(state.admin).toBe(ME)
  })

  it('omits the reserved credit where the Settlement has none', async () => {
    state.reserved = false
    const r = await fixture({Settlement: SETTLEMENT}).proposeSlotTransfer(SLOT, BUYER)
    expect(r.prepaidBalance).toBe(7_000n)
    expect('reservedBalance' in r).toBe(false)
  })

  it.each([
    ['no-slot', {exists: false}],
    ['cancelled', {cancelled: true}],
    ['not-creator', {creator: OTHER}],
    ['already-offered', {pendingCreator: BUYER}],
  ])('refuses %s', async (code, patch) => {
    Object.assign(state, patch)
    await refuses(() => fixture().proposeSlotTransfer(SLOT, BUYER), code)
  })

  it('refuses the current creator as the recipient', async () => {
    await refuses(() => fixture().proposeSlotTransfer(SLOT, ME), 'same-holder')
  })

  it('refuses a zero recipient and points at withdraw', async () => {
    await expect(fixture().proposeSlotTransfer(SLOT, ZERO)).rejects.toThrow(/withdrawSlotTransfer/)
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it('refuses unsupported on a KeyRegistry without the hand-off', async () => {
    state.handoff = false
    const e = await refuses(() => fixture().proposeSlotTransfer(SLOT, BUYER), 'unsupported')
    expect(e.message).toMatch(/predates/)
  })

  it('refuses unsupported when the caller client comes from the viem CommonJS entry', async () => {
    // A `require('viem')` client throws the CommonJS ContractFunctionZeroDataError class.
    const cjs = createRequire(import.meta.url)('viem') as typeof import('viem')
    const esmRead = mocks.read.getMockImplementation()!
    mocks.read.mockImplementation(async (args: {functionName: string}) => {
      if (args.functionName === 'pendingCreator' || args.functionName === 'pendingRuleAdmin') {
        throw new cjs.ContractFunctionExecutionError(new cjs.ContractFunctionZeroDataError({functionName: args.functionName}), {abi: [], functionName: args.functionName})
      }
      return esmRead(args) as unknown
    })
    const e = await refuses(() => fixture().proposeSlotTransfer(SLOT, BUYER), 'unsupported')
    expect(e.message).toMatch(/predates/)
  })

  it('a transport failure on the read stays itself, never unsupported', async () => {
    mocks.read.mockImplementation(async ({functionName}: {functionName: string}) => {
      if (functionName === 'pendingCreator') throw new Error('fetch failed')
      if (functionName === 'getKeySlot') return {creator: ME, exists: true, cancelled: false}
      if (functionName === 'rulePolicy') return [OTHER, GUARDIAN, 3600]
      return ZERO
    })
    await expect(fixture().proposeSlotTransfer(SLOT, BUYER)).rejects.toThrow('fetch failed')
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it('refuses not-confirmed when the mined call left no offer', async () => {
    state.applies = false
    const e = await fixture().proposeSlotTransfer(SLOT, BUYER).catch((err: unknown) => err)
    expect(e).toBeInstanceOf(SlotHandoffError)
    expect((e as SlotHandoffError).code).toBe('not-confirmed')
  })
})

describe('withdrawSlotTransfer and acceptSlotTransfer', () => {
  it('withdraw sends proposeCreator(slot, 0)', async () => {
    state.pendingCreator = BUYER
    await fixture().withdrawSlotTransfer(SLOT)
    expect(sent()).toEqual([{to: REGISTRY, functionName: 'proposeCreator', args: [SLOT, ZERO]}])
    expect(state.pendingCreator).toBe(ZERO)
  })

  it('withdraw refuses nothing-pending and not-creator', async () => {
    await refuses(() => fixture().withdrawSlotTransfer(SLOT), 'nothing-pending')
    Object.assign(state, {creator: OTHER, pendingCreator: BUYER})
    await refuses(() => fixture().withdrawSlotTransfer(SLOT), 'not-creator')
  })

  it('accept moves the creator to the offered wallet and leaves the rule admin', async () => {
    Object.assign(state, {creator: OTHER, pendingCreator: ME})
    await fixture().acceptSlotTransfer(SLOT)
    expect(sent()).toEqual([{to: REGISTRY, functionName: 'acceptCreator', args: [SLOT]}])
    expect(state).toMatchObject({creator: ME, pendingCreator: ZERO, admin: OTHER, guardian: GUARDIAN})
  })

  it('accept refuses nothing-pending and not-offered', async () => {
    state.creator = OTHER
    await refuses(() => fixture().acceptSlotTransfer(SLOT), 'nothing-pending')
    state.pendingCreator = BUYER
    await refuses(() => fixture().acceptSlotTransfer(SLOT), 'not-offered')
  })
})

describe('rule admin hand-off', () => {
  it('propose, then accept by the offered wallet', async () => {
    state.admin = ME
    await fixture().proposeRuleAdminTransfer(SLOT, BUYER)
    expect(state.pendingAdmin).toBe(BUYER)
    Object.assign(state, {admin: OTHER, pendingAdmin: ME})
    await fixture().acceptRuleAdminTransfer(SLOT)
    expect(sent().map(c => c.functionName)).toEqual(['proposeRuleAdmin', 'acceptRuleAdmin'])
    expect(state).toMatchObject({admin: ME, pendingAdmin: ZERO, guardian: GUARDIAN})
  })

  it('the creator has no say over the rule admin', async () => {
    await refuses(() => fixture().proposeRuleAdminTransfer(SLOT, BUYER), 'not-admin')
  })

  it('never to the guardian, at propose or accept', async () => {
    state.admin = ME
    await refuses(() => fixture().proposeRuleAdminTransfer(SLOT, GUARDIAN), 'guardian')
    Object.assign(state, {admin: OTHER, guardian: ME, pendingAdmin: ME})
    await refuses(() => fixture().acceptRuleAdminTransfer(SLOT), 'guardian')
  })

  it('refuses immutable, same-holder and already-offered', async () => {
    Object.assign(state, {admin: ZERO, guardian: ZERO})
    await refuses(() => fixture().proposeRuleAdminTransfer(SLOT, BUYER), 'immutable')
    state.admin = ME
    await refuses(() => fixture().proposeRuleAdminTransfer(SLOT, ME), 'same-holder')
    state.pendingAdmin = BUYER
    await refuses(() => fixture().proposeRuleAdminTransfer(SLOT, BUYER), 'already-offered')
  })

  it('withdraw sends proposeRuleAdmin(slot, 0) and refuses with nothing pending', async () => {
    state.admin = ME
    await refuses(() => fixture().withdrawRuleAdminTransfer(SLOT), 'nothing-pending')
    state.pendingAdmin = BUYER
    await fixture().withdrawRuleAdminTransfer(SLOT)
    expect(sent()).toEqual([{to: REGISTRY, functionName: 'proposeRuleAdmin', args: [SLOT, ZERO]}])
  })

  it('accept refuses not-offered', async () => {
    state.pendingAdmin = BUYER
    await refuses(() => fixture().acceptRuleAdminTransfer(SLOT), 'not-offered')
  })
})

describe('readSlotHandoff', () => {
  const reader = {client: {readContract: mocks.read}, addresses: {KeyRegistry: REGISTRY}} as unknown as TasraChainClient

  it('reports zero addresses as null', async () => {
    Object.assign(state, {admin: ZERO, guardian: ZERO})
    expect(await readSlotHandoff(reader, SLOT)).toEqual({creator: ME, pendingCreator: null, ruleAdmin: null, guardian: null, pendingRuleAdmin: null})
  })

  it('reports both pending offers', async () => {
    Object.assign(state, {pendingCreator: BUYER, pendingAdmin: BUYER})
    expect(await readSlotHandoff(reader, SLOT)).toMatchObject({pendingCreator: BUYER, ruleAdmin: OTHER, guardian: GUARDIAN, pendingRuleAdmin: BUYER})
  })
})

describe('the write confirmation wait', () => {
  it('sees a receipt that lands 300 ms after the send within that poll, not on a 1 s grid', async () => {
    const {TransactionReceiptNotFoundError} = await import('viem')
    vi.useFakeTimers()
    try {
      const sentAt = Date.now()
      let asked = 0
      mocks.receipt.mockImplementation(async ({hash: h}: {hash: Hex}) => {
        asked++
        if (Date.now() - sentAt < 300) throw new TransactionReceiptNotFoundError({hash: h})
        return {status: 'success', logs: [], blockNumber: 1n}
      })
      let done: number | undefined
      const write = fixture().proposeSlotTransfer(SLOT, BUYER).then(r => { done = Date.now() - sentAt; return r })
      await vi.advanceTimersByTimeAsync(600)
      // Polls at 0, 250 and 625 ms (250 growing by half): seen at the 625 ms poll at the latest.
      await vi.advanceTimersByTimeAsync(100)
      expect(done).toBeDefined()
      expect(done!).toBeLessThan(1_000)
      expect(asked).toBeGreaterThanOrEqual(2)
      await expect(write).resolves.toMatchObject({txHash: TX})
      // A reverted receipt is still refused.
      state = freshState()
      mocks.receipt.mockResolvedValue({status: 'reverted', logs: [], blockNumber: 1n})
      const reverted = fixture().proposeSlotTransfer(SLOT, BUYER).catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(10)
      expect(String(await reverted)).toMatch(/REVERTED/)
    } finally { vi.useRealTimers() }
  })
})

describe('fundSlot from one owner', () => {
  it('runs one approve-then-fund at a time across write clients (approve SETS the allowance: interleaved, the second fund would revert)', async () => {
    const order: string[] = []
    mocks.receipt.mockImplementation(async () => { await new Promise(done => setTimeout(done, 5)); return {status: 'success', logs: [], blockNumber: 1n} })
    mocks.submit.mockImplementation(async () => { order.push('fund'); return {id: hash('08'), txHash: TX} })
    // Two write clients (as one per slot) for the same owner; the fixture's direct writes are let through for approve.
    const [a, b] = [fixture({TasraToken: SETTLEMENT, Settlement: SETTLEMENT}), fixture({TasraToken: SETTLEMENT, Settlement: SETTLEMENT})]
    for (const w of [a, b]) vi.spyOn(w.wallet, 'writeContract').mockImplementation(async () => { order.push('approve'); return TX })
    await Promise.all([a.fundSlot(SLOT, 5n), b.fundSlot(hash('05'), 7n)])
    expect(order).toEqual(['approve', 'fund', 'approve', 'fund'])
  })
})
