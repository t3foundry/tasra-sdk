// ADR-0099 on the write client and the chain readers: the rotation lock (creator-only, set-once,
// tECDSA locked by mode), the refusals rotateKey and reshareKey raise before signing, the decoders
// for the new error and event, and the selectors pinned to their Solidity signatures.
//
// The fixture poisons both direct paths for the lock (relayed, like the hand-offs); rotateKey and
// reshareKey are local-key calls, so a refusal is asserted as "nothing was sent at all".
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  createWalletClient,
  decodeFunctionData,
  defineChain,
  encodeAbiParameters,
  encodeErrorResult,
  http,
  toEventSelector,
  toFunctionSelector,
  type AbiFunction,
  type Address,
  type Hex,
  type Log,
} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {createTasraWriteClient} from '../../src/chain/write.js'
import {keyRegistryAbi} from '../../src/chain/abis/keyRegistry.js'
import {
  ROTATION_LOCK_SELECTORS,
  ROTATION_LOCK_SENTINEL,
  RotationLockError,
  assertRotationAllowed,
  decodeKeyRotationLockedLogs,
  decodeRotationLockRevert,
  isRotationLocked,
  readRotationLock,
} from '../../src/chain/rotationLock.js'
import {ReshareRosterError} from '../../src/chain/reshareRoster.js'
import {describeRevert} from '../../src/chain/revertReason.js'
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
const addr = (v: string): Address => `0x${v.repeat(20)}`
const REGISTRY = addr('11')
const ME = privateKeyToAccount(hash('01')).address
const OTHER = addr('44')
const SLOT = hash('04')
const TX = hash('09')
const chain = defineChain({id: 31337, name: 'fixture', nativeCurrency: {name: 'ETH', symbol: 'ETH', decimals: 18}, rpcUrls: {default: {http: ['http://localhost:1']}}})

interface ChainState {
  exists: boolean
  cancelled: boolean
  creator: Address
  mode: number
  k: number
  lastRotatedAt: bigint
  assigned: Address[]
  /** False models a KeyRegistry from before the lock. */
  lock: boolean
  /** False models a write that mines without the effect. */
  applies: boolean
}
let state: ChainState
let wallet: ReturnType<typeof createWalletClient>

function fixture() {
  wallet = createWalletClient({account: privateKeyToAccount(hash('01')), chain, transport: http()})
  vi.spyOn(wallet, 'writeContract').mockRejectedValue(new Error('Unexpected direct transaction'))
  vi.spyOn(wallet, 'sendTransaction').mockRejectedValue(new Error('Unexpected direct gas payment'))
  return createTasraWriteClient({
    rpcUrl: 'http://localhost:1',
    wallet: wallet as never,
    addresses: {KeyRegistry: REGISTRY, ServiceRegistry: REGISTRY},
    relay: {
      forwarder: REGISTRY,
      approvals: [{chainId: 31337, registry: REGISTRY, serviceId: hash('02'), owner: REGISTRY, serviceType: 0, revision: 1n, manifestHash: hash('03')}],
      transport: {request: vi.fn(), relayRequest: vi.fn()},
    },
  })
}
const reader = () => ({client: {readContract: mocks.read}, addresses: {KeyRegistry: REGISTRY}}) as unknown as TasraChainClient

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  state = {exists: true, cancelled: false, creator: ME, mode: 0, k: 2, lastRotatedAt: 0n, assigned: [addr('21'), addr('22'), addr('23')], lock: true, applies: true}
  mocks.read.mockImplementation(async ({functionName}: {functionName: string}) => {
    switch (functionName) {
      case 'getKeySlot':
        return {
          creator: state.creator, ruleCommitment: hash('aa'), threshold: {k: state.k, n: 3}, mode: state.mode, publicKey: '0x02',
          epoch: 1n, committeeVersion: 1n, exists: state.exists, cancelled: state.cancelled, expiry: 0n, ruleVersion: 1n, auth: 1,
        }
      case 'lastRotatedAt':
        if (!state.lock) throw new ContractFunctionZeroDataError({functionName})
        return state.lastRotatedAt
      case 'assignedNodes':
        return state.assigned
      default:
        throw new Error(`Unexpected read ${functionName}`)
    }
  })
  mocks.receipt.mockResolvedValue({status: 'success', logs: []})
  mocks.submit.mockImplementation(async (_to: Address, data: Hex) => {
    const call = decodeFunctionData({abi: keyRegistryAbi, data})
    if (call.functionName !== 'lockKeyRotation') throw new Error(`Unexpected relayed call ${call.functionName}`)
    if (state.applies) state.lastRotatedAt = ROTATION_LOCK_SENTINEL
    return {id: hash('08'), txHash: TX}
  })
})

const sent = () => mocks.submit.mock.calls.map(([to, data]) => ({to, ...decodeFunctionData({abi: keyRegistryAbi, data: data as Hex})}))

async function refuses<T extends Error>(run: () => Promise<unknown>, type: new (...a: never[]) => T, code: string): Promise<T> {
  const e = await run().catch((err: unknown) => err)
  expect(e).toBeInstanceOf(type)
  expect((e as {code: string}).code).toBe(code)
  expect((e as {retryable: boolean}).retryable).toBe(false)
  expect(mocks.submit).not.toHaveBeenCalled()
  expect(wallet.writeContract).not.toHaveBeenCalled()
  return e as T
}

describe('selectors and topic are pinned to the Solidity signatures', () => {
  // Copied from contracts/src/registry/KeyRegistry.sol and SlotVotes.sol (ADR-0099). A stale
  // signature hashes to a different selector, which the chain would treat as another function.
  const SOURCE = {
    lockKeyRotation: 'lockKeyRotation(bytes32)',
    lastRotatedAt: 'lastRotatedAt(bytes32)',
    RotationLocked: 'RotationLocked()',
    TecdsaReshareKeepsTooFew: 'TecdsaReshareKeepsTooFew(uint16,uint16)',
  } as const

  it.each(Object.entries(SOURCE))('%s', (name, signature) => {
    const pinned = ROTATION_LOCK_SELECTORS[name as keyof typeof SOURCE]
    expect(toFunctionSelector(signature)).toBe(pinned)
    const item = (keyRegistryAbi as readonly {type: string; name?: string}[]).find(i => i.name === name && (i.type === 'function' || i.type === 'error'))
    expect(item, `${name} is in the vendored ABI`).toBeDefined()
    // From the ABI item exactly as encoding and decoding use it.
    const fromAbi = item!.type === 'function'
      ? toFunctionSelector(item as unknown as AbiFunction)
      : encodeErrorResult({abi: [item!], errorName: name, args: name === 'TecdsaReshareKeepsTooFew' ? [0, 0] : undefined} as never).slice(0, 10)
    expect(fromAbi).toBe(pinned)
  })

  it('KeyRotationLocked(bytes32 indexed slotId)', () => {
    expect(toEventSelector('KeyRotationLocked(bytes32)')).toBe(ROTATION_LOCK_SELECTORS.KeyRotationLocked)
    const event = keyRegistryAbi.find(i => i.type === 'event' && i.name === 'KeyRotationLocked')
    expect(event && toEventSelector(event as never)).toBe(ROTATION_LOCK_SELECTORS.KeyRotationLocked)
    expect((event as unknown as {inputs: {indexed?: boolean}[]}).inputs[0]!.indexed).toBe(true)
  })

  it('matches the literal values the relayer policy and the network ABI carry', () => {
    expect(ROTATION_LOCK_SELECTORS).toEqual({
      lockKeyRotation: '0x1fdf5ba1',
      lastRotatedAt: '0x530a2a9e',
      RotationLocked: '0x47fa0746',
      TecdsaReshareKeepsTooFew: '0xb0b6baae',
      KeyRotationLocked: '0x1fb1f37197926bacece99747def77fb2d50c2841cc13663da1a7a70fee302771',
    })
    expect(ROTATION_LOCK_SENTINEL).toBe(18446744073709551615n)
  })
})

describe('readRotationLock / isRotationLocked', () => {
  it('an unlocked FROST slot', async () => {
    expect(await readRotationLock(reader(), SLOT)).toMatchObject({locked: false, lockedByCreator: false, lockedByMode: false, mode: 0, lastRotatedAt: 0n, creator: ME})
    expect(await isRotationLocked(reader(), SLOT)).toBe(false)
  })

  it('a rotated, unlocked slot keeps its timestamp', async () => {
    state.lastRotatedAt = 1_800_000_000n
    expect(await isRotationLocked(reader(), SLOT)).toBe(false)
  })

  it('the creator lock is the sentinel', async () => {
    state.lastRotatedAt = ROTATION_LOCK_SENTINEL
    expect(await readRotationLock(reader(), SLOT)).toMatchObject({locked: true, lockedByCreator: true, lockedByMode: false})
  })

  it.each([[2, 'secp256k1'], [4, 'P-256']])('tECDSA mode %i (%s) is locked by its mode', async mode => {
    state.mode = mode
    expect(await readRotationLock(reader(), SLOT)).toMatchObject({locked: true, lockedByCreator: false, lockedByMode: true})
  })

  it.each([1, 3])('mode %i is not locked by mode', async mode => {
    state.mode = mode
    expect(await isRotationLocked(reader(), SLOT)).toBe(false)
  })

  it('refuses no-slot and unsupported', async () => {
    state.exists = false
    await expect(readRotationLock(reader(), SLOT)).rejects.toMatchObject({code: 'no-slot', slotId: SLOT})
    state.exists = true
    state.lock = false
    const e = await readRotationLock(reader(), SLOT).catch((err: unknown) => err)
    expect(e).toBeInstanceOf(RotationLockError)
    expect(e).toMatchObject({code: 'unsupported'})
  })

  it('passes any other read failure through', async () => {
    mocks.read.mockImplementation(async ({functionName}: {functionName: string}) => {
      if (functionName === 'lastRotatedAt') throw new Error('rpc down')
      return {exists: true, mode: 0, creator: ME, cancelled: false}
    })
    await expect(readRotationLock(reader(), SLOT)).rejects.toThrow('rpc down')
  })
})

describe('lockKeyRotation (write client)', () => {
  it('relays lockKeyRotation(slot) and confirms the sentinel', async () => {
    const r = await fixture().lockKeyRotation(SLOT)
    expect(sent()).toEqual([{to: REGISTRY, functionName: 'lockKeyRotation', args: [SLOT]}])
    expect(r).toMatchObject({phase: 'locked', slotId: SLOT, txHash: TX})
    expect(state.lastRotatedAt).toBe(ROTATION_LOCK_SENTINEL)
  })

  it('an already-locked slot resolves without sending', async () => {
    state.lastRotatedAt = ROTATION_LOCK_SENTINEL
    expect(await fixture().lockKeyRotation(SLOT)).toEqual({phase: 'already-locked', slotId: SLOT, lockedByCreator: true, lockedByMode: false})
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it.each([2, 4])('a tECDSA slot (mode %i) is locked by mode and sends nothing', async mode => {
    state.mode = mode
    expect(await fixture().lockKeyRotation(SLOT)).toEqual({phase: 'already-locked', slotId: SLOT, lockedByCreator: false, lockedByMode: true})
    expect(mocks.submit).not.toHaveBeenCalled()
  })

  it.each([
    ['no-slot', {exists: false}],
    ['cancelled', {cancelled: true}],
    ['not-creator', {creator: OTHER}],
    ['unsupported', {lock: false}],
  ])('refuses %s before signing', async (code, patch) => {
    Object.assign(state, patch)
    const client = fixture()
    await refuses(() => client.lockKeyRotation(SLOT), RotationLockError, code)
  })

  it('refuses a malformed slot id', async () => {
    await expect(fixture().lockKeyRotation('0x1234')).rejects.toThrow(/slotId/)
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('refuses not-confirmed when the transaction mined without the lock', async () => {
    state.applies = false
    const e = await fixture().lockKeyRotation(SLOT).catch((err: unknown) => err)
    expect(e).toBeInstanceOf(RotationLockError)
    expect(e).toMatchObject({code: 'not-confirmed'})
    expect(mocks.submit).toHaveBeenCalledTimes(1)
  })
})

describe('rotateKey refuses a locked slot before signing', () => {
  it('the creator lock', async () => {
    state.lastRotatedAt = ROTATION_LOCK_SENTINEL
    const client = fixture()
    const e = await refuses(() => client.rotateKey(SLOT), RotationLockError, 'locked')
    expect(e.message).toMatch(/creator locked rotation/)
  })

  it.each([2, 4])('tECDSA mode %i, also on a KeyRegistry without the lock', async mode => {
    state.mode = mode
    const client = fixture()
    const e = await refuses(() => client.rotateKey(SLOT), RotationLockError, 'locked')
    expect(e.message).toMatch(/threshold-ECDSA/)
    state.lock = false
    await refuses(() => client.rotateKey(SLOT), RotationLockError, 'locked')
  })

  it('an unlocked FROST slot on a registry without the lock still rotates', async () => {
    state.lock = false
    const client = fixture()
    vi.mocked(wallet.writeContract).mockResolvedValue(TX)
    expect(await client.rotateKey(SLOT, 'why')).toBe(TX)
    expect(vi.mocked(wallet.writeContract).mock.calls[0]![0]).toMatchObject({functionName: 'rotateKey', args: [SLOT, 'why']})
  })

  it('assertRotationAllowed passes other refusals through', async () => {
    state.exists = false
    await expect(assertRotationAllowed(mocks.read, REGISTRY, SLOT, 'x')).rejects.toMatchObject({code: 'no-slot'})
  })
})

describe('reshareKey applies the tECDSA roster rule before signing', () => {
  const [a, b, c] = [addr('21'), addr('22'), addr('23')]
  const [x, y] = [addr('31'), addr('32')]

  it('refuses a tECDSA roster that keeps fewer than the current k', async () => {
    state.mode = 2
    const client = fixture()
    const e = await refuses(() => client.reshareKey(SLOT, [a, x, y], 2, 3), ReshareRosterError, 'keeps-too-few')
    expect(e).toMatchObject({staying: 1, k: 2})
  })

  it('sends a tECDSA roster that keeps k', async () => {
    state.mode = 4
    const client = fixture()
    vi.mocked(wallet.writeContract).mockResolvedValue(TX)
    expect(await client.reshareKey(SLOT, [a, b, x], 2, 3, 'replace c')).toBe(TX)
    expect(vi.mocked(wallet.writeContract).mock.calls[0]![0]).toMatchObject({functionName: 'reshareKey', args: [SLOT, [a, b, x], 2, 3, 'replace c']})
  })

  it('lets a FROST committee be replaced whole', async () => {
    const client = fixture()
    vi.mocked(wallet.writeContract).mockResolvedValue(TX)
    expect(await client.reshareKey(SLOT, [x, y], 2, 2)).toBe(TX)
    expect(mocks.read.mock.calls.map(([q]) => (q as {functionName: string}).functionName)).toEqual(['getKeySlot'])
  })

  it('refuses a missing slot', async () => {
    state.exists = false
    const client = fixture()
    await refuses(() => client.reshareKey(SLOT, [a, b, c], 2, 3), ReshareRosterError, 'no-slot')
  })
  void c
})

describe('decoders', () => {
  const lockedData = encodeErrorResult({abi: keyRegistryAbi, errorName: 'RotationLocked'})
  const tooFewData = encodeErrorResult({abi: keyRegistryAbi, errorName: 'TecdsaReshareKeepsTooFew', args: [1, 3]})

  it('decodes RotationLocked() and TecdsaReshareKeepsTooFew(staying, k) from raw data', () => {
    expect(lockedData).toBe(ROTATION_LOCK_SELECTORS.RotationLocked)
    expect(tooFewData.slice(0, 10)).toBe(ROTATION_LOCK_SELECTORS.TecdsaReshareKeepsTooFew)
    expect(decodeRotationLockRevert(lockedData)).toEqual({name: 'RotationLocked'})
    expect(decodeRotationLockRevert(tooFewData)).toEqual({name: 'TecdsaReshareKeepsTooFew', staying: 1, k: 3})
  })

  it('decodes from an error chain, as an RPC reports a revert', () => {
    const err = new BaseError('execution reverted', {cause: Object.assign(new Error('rpc'), {data: tooFewData})})
    expect(decodeRotationLockRevert(err)).toEqual({name: 'TecdsaReshareKeepsTooFew', staying: 1, k: 3})
    expect(describeRevert(err)).toBe('TecdsaReshareKeepsTooFew(1, 3)')
    expect(describeRevert({data: lockedData})).toBe('RotationLocked()')
    expect(new ContractFunctionRevertedError({abi: keyRegistryAbi, data: lockedData, functionName: 'rotateKey'}).data?.errorName).toBe('RotationLocked')
  })

  it('returns undefined for anything else', () => {
    expect(decodeRotationLockRevert(encodeErrorResult({abi: keyRegistryAbi, errorName: 'NotCreator'}))).toBeUndefined()
    expect(decodeRotationLockRevert('0x12')).toBeUndefined()
    expect(decodeRotationLockRevert('not hex')).toBeUndefined()
    expect(decodeRotationLockRevert(new Error('no data'))).toBeUndefined()
  })

  it('decodes KeyRotationLocked logs and skips other contracts and events', () => {
    const log = (address: Address, topics: Hex[], data: Hex = '0x'): Log => ({
      address, topics: topics as [Hex, ...Hex[]], data, blockNumber: 7n, transactionHash: TX, logIndex: 0, blockHash: hash('bb'), transactionIndex: 0, removed: false,
    })
    const ours = log(REGISTRY, [ROTATION_LOCK_SELECTORS.KeyRotationLocked, SLOT])
    const elsewhere = log(addr('99'), [ROTATION_LOCK_SELECTORS.KeyRotationLocked, hash('05')])
    const other = log(REGISTRY, [toEventSelector('SlotCancelled(bytes32)'), SLOT], encodeAbiParameters([], []))
    expect(decodeKeyRotationLockedLogs([ours, elsewhere, other], REGISTRY)).toEqual([{slotId: SLOT, address: REGISTRY, blockNumber: 7n, transactionHash: TX}])
    expect(decodeKeyRotationLockedLogs([ours, elsewhere]).map(e => e.slotId)).toEqual([SLOT, hash('05')])
    expect(decodeKeyRotationLockedLogs([{...ours, blockNumber: null, transactionHash: null}])[0]).toMatchObject({blockNumber: null, transactionHash: null})
  })
})
