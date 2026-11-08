import {describe, expect, it} from 'vitest'
import {createPublicClient, custom, decodeFunctionData, encodeFunctionResult, parseAbi, type Abi, type Hex} from 'viem'
import {BillingModeError, createBillingModeDetector, readBillingMode, requirePrepaidSlot} from '../../src/chain/billing.js'
import {readSlotFunding} from '../../src/chain/prepaid.js'
import {settlementAbi} from '../../src/chain/abis/settlement.js'

const h = (n: number, len = 32): Hex => `0x${n.toString(16).padStart(2, '0').repeat(len)}`
const deployment = {chainId: 43112, settlement: h(1, 20), keyRegistry: h(2, 20)}
const slot = h(3)
const v1 = parseAbi(['function version() view returns (string)', 'function balanceOf(bytes32) view returns (uint256)'])

interface Chain {version?: string; enabled?: boolean; genesis?: boolean; chain?: number; orphan?: boolean; fail?: string; noGenesisGetter?: boolean; empty?: boolean; head?: 'fail'}
function rpc(state: Chain) {
  const reads: string[] = []
  let heads = 0
  const client = createPublicClient({transport: custom({request: async ({method, params}: {method: string; params?: unknown}) => {
    if (method === 'eth_chainId') return `0x${(state.chain ?? 43112).toString(16)}`
    if (method === 'eth_getBlockByNumber') {
      if (state.head === 'fail') throw new Error('head unavailable')
      return {number: '0x14', hash: heads++ > 0 && state.orphan ? h(99) : h(20), timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`, transactions: []}
    }
    if (method !== 'eth_call') throw new Error(`unexpected ${method}`)
    const [call, at] = params as [{to: Hex; data: Hex}, unknown]
    if (JSON.stringify(at) !== JSON.stringify({blockHash: h(20), requireCanonical: true})) throw new Error('read not pinned to the observed canonical block')
    const version = state.version ?? '2'
    const {functionName: name} = decodeFunctionData({abi: version === '1' ? v1 : settlementAbi, data: call.data})
    reads.push(name)
    if (state.fail === name) throw new Error(`execution reverted: ${name}`)
    if (state.empty) return '0x'
    if (version === '1') return name === 'version' ? encodeFunctionResult({abi: v1, functionName: 'version', result: '1'}) : encodeFunctionResult({abi: v1, functionName: 'balanceOf', result: 42n})
    if (name === 'prepaidFromGenesis' && state.noGenesisGetter) throw new Error('execution reverted')
    const values: Record<string, unknown> = {version, prepaidEnabled: state.enabled ?? false, prepaidFromGenesis: state.genesis ?? false, balanceOf: 5n, reservedBalanceOf: 1n}
    return encodeFunctionResult({abi: settlementAbi as Abi, functionName: name, result: values[name]})
  }}, {retryCount: 0})})
  return {client, reads}
}

describe('billing mode detection', () => {
  it('reads legacy from version 1 without touching prepaid getters', async () => {
    const {client, reads} = rpc({version: '1'})
    expect(await readBillingMode(client, deployment, slot)).toMatchObject({mode: 'legacy', settlementVersion: '1', blockHash: h(20)})
    expect(reads).toEqual(['version'])
  })
  it('reads prepaid from version 2 when the slot is enabled or the deployment is prepaid from genesis', async () => {
    expect(await readBillingMode(rpc({enabled: true}).client, deployment, slot)).toMatchObject({mode: 'prepaid', prepaidEnabled: true})
    expect(await readBillingMode(rpc({genesis: true}).client, deployment, slot)).toMatchObject({mode: 'prepaid', prepaidEnabled: false, prepaidFromGenesis: true})
    expect(await readBillingMode(rpc({}).client, deployment, slot)).toMatchObject({mode: 'legacy', settlementVersion: '2', prepaidEnabled: false, prepaidFromGenesis: false})
    // An enabled slot does not need the genesis getter (older version 2 builds lack it).
    expect((await readBillingMode(rpc({enabled: true, noGenesisGetter: true}).client, deployment, slot)).mode).toBe('prepaid')
  })
  it('accepts versions 3 (the timeout escape) and 4 (ADR-0090 allowances) exactly like version 2, and still refuses an unknown version', async () => {
    for (const version of ['2', '3', '4']) {
      expect(await readBillingMode(rpc({version, enabled: true}).client, deployment, slot)).toMatchObject({mode: 'prepaid', settlementVersion: version, prepaidEnabled: true})
      expect(await readBillingMode(rpc({version, genesis: true}).client, deployment, slot)).toMatchObject({mode: 'prepaid', settlementVersion: version, prepaidFromGenesis: true})
      expect(await readBillingMode(rpc({version}).client, deployment, slot)).toMatchObject({mode: 'legacy', settlementVersion: version, prepaidFromGenesis: false})
      await expect(requirePrepaidSlot(rpc({version, enabled: true}).client, deployment, slot)).resolves.toMatchObject({mode: 'prepaid', settlementVersion: version})
    }
    for (const version of ['5', '2.1', '04']) {
      const observed = await readBillingMode(rpc({version, enabled: true}).client, deployment, slot)
      expect(observed, version).toMatchObject({mode: 'unknown', settlementVersion: version, reason: `unsupported Settlement version ${JSON.stringify(version)}`})
      await expect(requirePrepaidSlot(rpc({version, enabled: true}).client, deployment, slot)).rejects.toMatchObject({mode: 'unknown', settlementVersion: version})
    }
  })
  it('answers unknown, never a guess, for every unreadable or inconsistent chain', async () => {
    for (const state of [{version: '5'}, {version: ''}, {fail: 'version'}, {fail: 'prepaidEnabled'}, {noGenesisGetter: true},
      {chain: 43113}, {orphan: true, enabled: true}, {empty: true}, {head: 'fail' as const}]) {
      const observed = await readBillingMode(rpc(state).client, deployment, slot)
      expect(observed.mode, JSON.stringify(state)).toBe('unknown')
      expect(observed.reason).toBeTruthy()
    }
  })
  it('refuses invalid arguments before any RPC', async () => {
    const {client, reads} = rpc({})
    await expect(readBillingMode(client, deployment, '0x01')).rejects.toThrow(/slot/)
    await expect(readBillingMode(client, {...deployment, settlement: h(0, 20)}, slot)).rejects.toThrow(/deployment/)
    expect(reads).toHaveLength(0)
  })
  it('requirePrepaidSlot refuses legacy and unknown with a typed error', async () => {
    await expect(requirePrepaidSlot(rpc({enabled: true}).client, deployment, slot)).resolves.toMatchObject({mode: 'prepaid'})
    const legacy = await requirePrepaidSlot(rpc({version: '1'}).client, deployment, slot).catch((e: unknown) => e)
    expect(legacy).toBeInstanceOf(BillingModeError)
    expect(legacy).toMatchObject({mode: 'legacy', slotId: slot, retryable: false})
    expect(String(legacy)).toMatch(/legacy/)
    await expect(requirePrepaidSlot(rpc({version: '9'}).client, deployment, slot)).rejects.toMatchObject({mode: 'unknown', retryable: true})
  })
})

describe('cached billing detector', () => {
  it('caches prepaid permanently, legacy for its lifetime and never unknown', async () => {
    let clock = 0
    const prepaid = rpc({enabled: true})
    const detector = createBillingModeDetector(prepaid.client, deployment, {legacyTtlMs: 1000, now: () => clock})
    await detector.mode(slot); clock = 10_000_000; await detector.mode(slot)
    expect(prepaid.reads.filter(r => r === 'version')).toHaveLength(1)
    detector.invalidate(slot); await detector.mode(slot)
    expect(prepaid.reads.filter(r => r === 'version')).toHaveLength(2)

    const legacy = rpc({version: '1'}); clock = 0
    const legacyDetector = createBillingModeDetector(legacy.client, deployment, {legacyTtlMs: 1000, now: () => clock})
    await legacyDetector.mode(slot); clock = 999; await legacyDetector.mode(slot)
    expect(legacy.reads).toHaveLength(1)
    clock = 1000; await legacyDetector.mode(slot)
    expect(legacy.reads).toHaveLength(2)

    const broken = rpc({fail: 'version'})
    const brokenDetector = createBillingModeDetector(broken.client, deployment)
    await brokenDetector.mode(slot); await brokenDetector.mode(slot)
    expect(broken.reads).toHaveLength(2)
    await expect(brokenDetector.requirePrepaid(slot)).rejects.toBeInstanceOf(BillingModeError)
  })
  it('shares one read between concurrent lookups and returns detached copies', async () => {
    const {client, reads} = rpc({enabled: true})
    const detector = createBillingModeDetector(client, deployment)
    const [a, b] = await Promise.all([detector.mode(slot), detector.mode(slot.toUpperCase().replace('0X', '0x') as Hex)])
    expect(reads.filter(r => r === 'version')).toHaveLength(1)
    a.mode = 'unknown'
    expect(b.mode).toBe('prepaid'); expect((await detector.mode(slot)).mode).toBe('prepaid')
  })
  it('refuses an invalid configuration', () => {
    const {client} = rpc({})
    expect(() => createBillingModeDetector(client, {...deployment, chainId: 0})).toThrow(/deployment/)
    expect(() => createBillingModeDetector(client, deployment, {legacyTtlMs: -1})).toThrow(/lifetime/)
  })
})

describe('funding reads on a legacy Settlement', () => {
  it('reports the balance with no prepaid state instead of failing', async () => {
    const funding = await readSlotFunding(rpc({version: '1'}).client, deployment, slot)
    expect(funding).toMatchObject({enabled: false, available: 42n, reserved: 0n, total: 42n, settlementVersion: '1'})
  })
  it('keeps a version 2 read failure a failure', async () => {
    await expect(readSlotFunding(rpc({fail: 'reservedBalanceOf'}).client, deployment, slot)).rejects.toThrow(/reservedBalanceOf/)
    expect((await readSlotFunding(rpc({enabled: true}).client, deployment, slot)).settlementVersion).toBeUndefined()
  })
})
