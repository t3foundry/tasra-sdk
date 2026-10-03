import {afterEach, describe, expect, it, vi} from 'vitest'
import {createPublicClient, custom, decodeFunctionData, encodeFunctionResult, type Hex, type Abi} from 'viem'
import {readPaidOperationReceipt, readSlotFunding} from '../../src/chain/prepaid.js'
import {prepaidRequestId, type PaymentIntentWire} from '../../src/committee/payment.js'
import {settlementAbi} from '../../src/chain/abis/settlement.js'

const encodeResult = (abi: Abi, functionName: string, result: unknown) => encodeFunctionResult({abi, functionName, result})
const h = (byte: number, length = 32): Hex => `0x${byte.toString(16).padStart(2, '0').repeat(length)}`
const deployment = {chainId: 43112, settlement: h(1, 20), keyRegistry: h(2, 20)}
const intent = (): PaymentIntentWire => ({
  chain_id: 43112, settlement: h(1, 20), key_registry: h(2, 20), slot: h(3), action: 'sign',
  payload_digest: h(4), session_commitment: h(5), nonce: h(6), max_cost: '10', expires: 1060,
  verification_epoch: 7, verification_seed: h(8), verification_root: h(9),
  verification_registry_size: 5, verification_committee: 3, verification_quorum: 2,
  keeper_assignment: {key_epoch: 1, committee_version: 2, threshold: 2, coordinator: Array<number>(32).fill(9), contributors: [9, 10, 11].map(n => Array<number>(32).fill(n))},
  signature: h(1, 65),
})
const expected = {slot: h(3), action: 'sign' as const, payloadDigest: h(4)}

function rpc(overrides: Record<string, unknown> = {}, options: {chain?: number; age?: number; hash?: Hex; orphan?: boolean; unsupported?: boolean; pause?: number; empty?: boolean; failure?: boolean} = {}) {
  const calls: {method: string; params?: unknown}[] = []
  const now = Math.floor(Date.now() / 1000)
  let blocks = 0
  const client = createPublicClient({transport: custom({request: async ({method, params}: {method: string; params?: unknown}) => {
    calls.push({method, params})
    if (method === 'eth_chainId') return `0x${(options.chain ?? 43112).toString(16)}`
    if (method === 'eth_getBlockByNumber') {
      blocks++
      return {number: '0x14', hash: blocks > 1 && options.orphan ? h(99) : (options.hash ?? h(20)), timestamp: `0x${(now - (options.age ?? 0)).toString(16)}`, transactions: []}
    }
    if (method === 'eth_call') {
      if (options.unsupported) throw new Error('EIP-1898 unsupported')
      if (options.failure) throw new Error('RPC unavailable')
      const [call, block] = params as [{to: string; data: Hex}, unknown]
      expect(call.to).toBe(deployment.settlement)
      expect(block).toEqual({blockHash: options.hash ?? h(20), requireCanonical: true})
      const decoded = decodeFunctionData({abi: settlementAbi, data: call.data})
      expect(decoded.args?.[0]).toBe(h(3))
      if (decoded.args?.length === 2) expect(decoded.args[1]).toBe(prepaidRequestId(intent()))
      const values: Record<string, unknown> = {balanceOf: 17n, reservedBalanceOf: 10n, prepaidEnabled: true, prepaidCost: 10n, prepaidSettled: false, prepaidRefunded: 0n, prepaidAssignmentBlock: h(19), ...overrides}
      if (options.pause) vi.setSystemTime(new Date((now + options.pause) * 1000))
      if (options.empty) return '0x'
      // Results pass through the actual Solidity ABI encoder/decoder, not a mocked SDK reader.
      return encodeResult(settlementAbi, decoded.functionName, values[decoded.functionName])
    }
    throw new Error(`unexpected RPC method ${method}`)
  }}, {retryCount: 0})})
  return {client, calls}
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('canonical prepaid reads', () => {
  it('matches the Rust request-ID domain with a 32-byte padded Settlement address', () => {
    // Independently packed from PrepaidRequest::id and hashed using cast keccak.
    expect(prepaidRequestId(intent())).toBe('0xd5dc32f6c86a81eccc18c0e2f88086a3115dc6e6ef0401e2478aff0fa7d86d7a')
    expect(prepaidRequestId({...intent(), action: 'eoa-sign'})).not.toBe(prepaidRequestId(intent()))
    expect(prepaidRequestId({...intent(), chain_id: 43113})).not.toBe(prepaidRequestId(intent()))
  })
  it('reports available, reserved and total TASRA from the same canonical block', async () => {
    const {client, calls} = rpc()
    const result = await readSlotFunding(client, deployment, h(3))
    expect(result).toMatchObject({slot: h(3), enabled: true, available: 17n, reserved: 10n, total: 27n, blockNumber: 20n, blockHash: h(20)})
    expect(calls.filter(c => c.method === 'eth_call')).toHaveLength(3)
    expect(calls.filter(c => c.method === 'eth_getBlockByNumber').map(c => c.params)).toEqual([['latest', false], ['0x14', false]])
    expect(calls.some(c => /send|estimateGas|getBalance/.test(c.method))).toBe(false)
  })
  it('binds mined backing to the locally derived request ID and original assignment block', async () => {
    const {client, calls} = rpc()
    const result = await readPaidOperationReceipt(client, deployment, intent(), expected)
    expect(result).toMatchObject({requestId: prepaidRequestId(intent()), cost: 10n, refunded: 0n, settled: false, assignmentBlock: h(19)})
    expect(calls.filter(c => c.method === 'eth_call')).toHaveLength(5)
  })
  it('keeps settled and expired reservations inspectable without authorizing repeat work', async () => {
    const {client} = rpc({prepaidSettled: true, prepaidRefunded: 3n})
    const result = await readPaidOperationReceipt(client, deployment, intent(), expected)
    expect(result.settled).toBe(true)
    expect(result.refunded).toBe(3n)
    expect(result.cost).toBe(10n)
  })
  it('refuses a disabled, missing, unassigned, over-cap or inconsistent reservation', async () => {
    for (const values of [{prepaidEnabled: false}, {prepaidCost: 0n}, {prepaidCost: 11n}, {prepaidAssignmentBlock: h(0)}, {prepaidRefunded: 1n}, {prepaidSettled: true, prepaidRefunded: 11n}]) {
      await expect(readPaidOperationReceipt(rpc(values).client, deployment, intent(), expected)).rejects.toThrow(/reserved TASRA/)
    }
  })
  it('refuses another deployment or operation before making an RPC call', async () => {
    const {client, calls} = rpc()
    for (const changed of [{...intent(), chain_id: 43113}, {...intent(), settlement: h(3, 20)}, {...intent(), key_registry: h(3, 20)}, {...intent(), slot: h(4)}, {...intent(), action: 'decrypt' as const}, {...intent(), payload_digest: h(5)}]) {
      await expect(readPaidOperationReceipt(client, deployment, changed, expected)).rejects.toThrow(/mismatch/)
    }
    expect(calls).toHaveLength(0)
  })
  it('refuses invalid inputs and the wrong RPC chain without reading balances', async () => {
    const {client, calls} = rpc({}, {chain: 43113})
    await expect(readSlotFunding(client, deployment, '0x00')).rejects.toThrow(/slot/)
    await expect(readSlotFunding(client, {...deployment, settlement: h(0, 20)}, h(3))).rejects.toThrow(/address/)
    await expect(readSlotFunding(client, {...deployment, chainId: 1.5}, h(3))).rejects.toThrow(/chain ID/)
    expect(calls).toHaveLength(0)
    await expect(readSlotFunding(client, deployment, h(3))).rejects.toThrow(/chain mismatch/)
    expect(calls.map(c => c.method)).toEqual(['eth_chainId'])
  })
  it('refuses stale/future/invalid heads and a reorg during reads', async () => {
    for (const options of [{age: 31}, {age: -3}, {hash: h(0)}, {orphan: true}]) {
      const {client} = rpc({}, options)
      await expect(readPaidOperationReceipt(client, deployment, intent(), expected)).rejects.toThrow(/stale|future|head|reorganized/)
    }
  })
  it('refuses observations that age out while reads are in flight', async () => {
    vi.useFakeTimers({toFake: ['Date']})
    vi.setSystemTime(new Date('2026-10-03T22:00:00Z'))
    await expect(readSlotFunding(rpc({}, {pause: 31}).client, deployment, h(3))).rejects.toThrow(/stale/)
  })
  it('never downgrades unsupported canonical reads or retries a transaction', async () => {
    for (const options of [{unsupported: true}, {empty: true}, {failure: true}]) {
      const {client, calls} = rpc({}, options)
      await expect(readPaidOperationReceipt(client, deployment, intent(), expected)).rejects.toThrow()
      expect(calls.every(c => ['eth_chainId', 'eth_getBlockByNumber', 'eth_call'].includes(c.method))).toBe(true)
      expect(calls.filter(c => c.method === 'eth_call').length).toBeLessThanOrEqual(5)
    }
  })
})
