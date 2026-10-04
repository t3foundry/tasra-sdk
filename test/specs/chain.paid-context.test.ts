import {afterEach, expect, it, vi} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import {createPublicClient, custom, decodeFunctionData, encodeFunctionResult, getAddress, recoverTypedDataAddress, toHex, type Abi, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {discoverPaidOperationContext, type PaidContextOptions} from '../../src/chain/prepaid.js'
import {paymentIntentTypedData, paymentSessionCommitment} from '../../src/committee/payment.js'
import {keyRegistryAbi} from '../../src/chain/abis/keyRegistry.js'
import {nodeRegistryAbi} from '../../src/chain/abis/nodeRegistry.js'
import {settlementAbi} from '../../src/chain/abis/settlement.js'
import {thresholdRandomBeaconAbi} from '../../src/chain/abis/thresholdRandomBeacon.js'
import {verifierSetRegistryAbi} from '../../src/chain/abis/verifierSetRegistry.js'
import {accountantSetRegistryAbi} from '../../src/chain/abis/accountantSetRegistry.js'

const h = (n: number, len = 32): Hex => `0x${n.toString(16).padStart(2, '0').repeat(len)}`
interface Changes {
  policy?: [number, number]; size?: number; unanchored?: boolean; noPrevious?: boolean; missingSeed?: boolean
  beaconMismatch?: 'key' | 'snapshot' | 'accountant'; epoch?: bigint; sharingEpoch?: bigint; sharingVersion?: bigint
  accountantUnanchored?: boolean; accountantNoPrevious?: boolean; accountantSize?: number
  inactive?: number[]; duplicateId?: boolean; duplicateKey?: boolean; insufficient?: boolean
  enabled?: boolean; available?: bigint; cancelled?: boolean; noKey?: boolean; age?: number; orphan?: boolean
  chain?: number; unsupported?: boolean; url?: string; chainId?: number; onChainId?: () => void
}
function fixture(change: Changes = {}) {
  const deployment = {chainId: change.chainId ?? 43112, settlement: h(1, 20), keyRegistry: h(2, 20), verifierSet: h(5, 20), accountantSet: h(8, 20), beacon: h(6, 20)}
  const nodes = h(7, 20), approved = {...deployment}, slotId = h(3), creator = privateKeyToAccount(h(11))
  const keys = [1, 2, 3].map(n => toHex(ed25519.getPublicKey(new Uint8Array(32).fill(n))))
  const operators = [11, 12, 13].map(n => h(n, 20)), ids = [30n, 10n, 20n]
  const calls: {method: string; name?: string; args?: readonly unknown[]}[] = []
  let heads = 0
  const client = createPublicClient({transport: custom({request: async ({method, params}: {method: string; params?: unknown}) => {
    calls.push({method})
    if (method === 'eth_chainId') {change.onChainId?.(); return toHex(change.chain ?? approved.chainId)}
    if (method === 'eth_getBlockByNumber') return {number: '0x14', hash: heads++ > 0 && change.orphan ? h(99) : h(20), timestamp: toHex(1000 - (change.age ?? 0)), transactions: []}
    if (method !== 'eth_call') throw new Error(`unexpected RPC ${method}`)
    if (change.unsupported) throw new Error('canonical reads unavailable')
    const [call, at] = params as [{to: Hex; data: Hex}, unknown]
    expect(at).toEqual({blockHash: h(20), requireCanonical: true})
    const abi: Abi = call.to === nodes ? nodeRegistryAbi : call.to === approved.keyRegistry ? keyRegistryAbi
      : call.to === approved.beacon ? thresholdRandomBeaconAbi : call.to === approved.verifierSet ? verifierSetRegistryAbi
        : call.to === approved.accountantSet ? accountantSetRegistryAbi : settlementAbi
    const {functionName: name, args} = decodeFunctionData({abi, data: call.data})
    calls[calls.length - 1] = {method, name, args}
    const index = operators.findIndex(op => op.toLowerCase() === String(args?.[0]).toLowerCase())
    const previous = args?.[0] !== (change.epoch ?? 7n)
    const accountant = call.to === approved.accountantSet
    const values: Record<string, unknown> = {
      prepaidEnabled: change.enabled ?? true, balanceOf: change.available ?? 100n,
      randomBeacon: change.beaconMismatch === 'key' ? h(99, 20) : approved.beacon,
      beacon: change.beaconMismatch === (accountant ? 'accountant' : 'snapshot') ? h(99, 20) : approved.beacon,
      epoch: change.epoch ?? 7n, seedAt: change.missingSeed ? h(0) : previous ? h(8) : h(9),
      snapshotAt: accountant
        ? change.accountantUnanchored && !previous || change.accountantNoPrevious && previous ? [h(0), 0] : [h(19), change.accountantSize ?? 3]
        : change.unanchored && !previous || change.noPrevious && previous ? [h(0), 0] : [previous ? h(17) : h(18), change.size ?? 5],
      verifierPolicy: change.policy ?? [3, 2], nodeRegistry: nodes, assignedNodes: operators,
      getKeySlot: {creator: creator.address, ruleCommitment: h(33), threshold: {k: change.insufficient ? 3 : 2, n: 3}, mode: 0,
        publicKey: change.noKey ? '0x' : keys[0], epoch: change.sharingEpoch ?? 1n, committeeVersion: change.sharingVersion ?? 2n,
        exists: true, cancelled: change.cancelled ?? false, expiry: 2000n, ruleVersion: 1n, auth: 0},
      operatorIdOf: change.duplicateId ? 1n : ids[index], hasTag: true,
      nodeOf: {operator: operators[index], dns: 'keeper', url: change.url ?? `https://keeper${index}.example`, p2pAddr: '', pubkey: keys[change.duplicateKey ? 0 : index],
        stake: 100n, rewardBalance: 0n, unbondingAt: 0n, active: !change.inactive?.includes(index)},
    }
    return encodeFunctionResult({abi, functionName: name, result: values[name]})
  }}, {retryCount: 0})})
  return {client, deployment, slotId, creator, keys, operators, calls, run: (options?: PaidContextOptions) => discoverPaidOperationContext(client, deployment, slotId, options)}
}
afterEach(() => vi.restoreAllMocks())
const now = () => vi.spyOn(Date, 'now').mockReturnValue(1_000_000)

it('discovers one canonical assignment/policy and produces creator-signable intent fields without mutations', async () => {
  now(); const f = fixture(), context = await f.run()
  expect(context).toMatchObject({blockHash: h(20), blockNumber: 20n, available: 100n, creator: f.creator.address,
    coordinator: {operator: getAddress(f.operators[1]!), publicKey: f.keys[1]}, intentFields: {verification_epoch: 7, verification_seed: h(9), verification_root: h(18),
      verification_committee: 3, verification_quorum: 2, keeper_assignment: {key_epoch: 1, committee_version: 2, threshold: 2}}})
  expect(context.contributors.map(c => c.publicKey)).toEqual([...f.keys].sort())
  const payment = {...context.intentFields, action: 'sign' as const, payload_digest: h(44), nonce: h(45), max_cost: '10', expires: 1060,
    session_commitment: paymentSessionCommitment(h(46), 'did:web:agent.example', 1060)}
  const typed = paymentIntentTypedData(payment), signature = await f.creator.signTypedData(typed)
  expect(await recoverTypedDataAddress({...typed, signature})).toBe(f.creator.address)
  expect(f.calls.every(call => ['eth_chainId', 'eth_call', 'eth_getBlockByNumber'].includes(call.method))).toBe(true)
})
it('uses only the immediately previous anchored snapshot and refuses missing current seed', async () => {
  now(); const f = fixture({unanchored: true})
  expect((await f.run()).intentFields).toMatchObject({verification_epoch: 6, verification_seed: h(8), verification_root: h(17)})
  expect(f.calls.filter(c => c.name === 'snapshotAt').map(c => c.args)).toEqual([[7n], [7n], [6n], [6n]])
  for (const change of [{unanchored: true, noPrevious: true}, {unanchored: true, epoch: 0n}, {missingSeed: true, unanchored: true}]) await expect(fixture(change).run()).rejects.toThrow(/seed|snapshot/)
})
it('waits for both role anchors and never selects an epoch missing its accountant snapshot', async () => {
  now()
  expect((await fixture({accountantUnanchored: true}).run()).intentFields.verification_epoch).toBe(6)
  for (const change of [
    {accountantUnanchored: true, accountantNoPrevious: true},
    {unanchored: true, accountantNoPrevious: true},
    {accountantUnanchored: true, epoch: 0n},
    {accountantSize: 0}, {accountantSize: 65536},
  ]) await expect(fixture(change).run()).rejects.toThrow(/snapshot/)
  await expect(fixture({beaconMismatch: 'accountant'}).run()).rejects.toThrow(/beacon/)
})
it('requires explicit defaults and enforces the native verifier policy bounds', async () => {
  now()
  await expect(fixture({policy: [0, 0]}).run()).rejects.toThrow(/policy/)
  expect((await fixture({policy: [0, 0]}).run({defaultVerificationPolicy: {committee: 3, quorum: 2}})).intentFields.verification_quorum).toBe(2)
  expect((await fixture().run({defaultVerificationPolicy: {committee: 1, quorum: 1}})).intentFields.verification_committee).toBe(3)
  expect((await fixture({policy: [4096, 3000], size: 5000}).run()).intentFields.verification_committee).toBe(4096)
  for (const policy of [[0, 1], [3, 0], [3, 4], [6, 2], [4097, 3000]] as [number, number][]) await expect(fixture({policy}).run()).rejects.toThrow(/policy/)
})
it('honors an explicitly selected eligible coordinator and excludes inactive contributors', async () => {
  now(); const f = fixture({inactive: [0]})
  const c = await f.run({coordinator: f.operators[2]})
  expect(c.coordinator.operator).toBe(getAddress(f.operators[2]!))
  expect(c.contributors.map(m => m.operator.toLowerCase()).sort()).toEqual(f.operators.slice(1).sort())
  await expect(f.run({coordinator: f.operators[0]})).rejects.toThrow(/coordinator/)
  await expect(f.run({coordinator: h(88, 20)})).rejects.toThrow(/coordinator/)
  await expect(fixture({inactive: [0], insufficient: true}).run()).rejects.toThrow(/threshold/)
})
it('refuses mismatched deployment pointers, inactive/unfunded slots and ambiguous keeper identities', async () => {
  now()
  for (const change of [{beaconMismatch: 'key' as const}, {beaconMismatch: 'snapshot' as const}, {enabled: false}, {available: 0n}, {cancelled: true}, {noKey: true}, {duplicateId: true}, {duplicateKey: true}]) await expect(fixture(change).run()).rejects.toThrow()
})
it('refuses stale heads, reorgs, unsupported canonical reads and lossy JSON integers', async () => {
  now()
  for (const change of [{age: 31}, {age: -3}, {orphan: true}, {chain: 43113}, {unsupported: true}, {epoch: 9007199254740992n}, {sharingEpoch: 9007199254740992n}, {sharingVersion: 9007199254740992n}]) await expect(fixture(change).run()).rejects.toThrow()
})
it('requires HTTPS on Fuji even when local HTTP is explicitly requested', async () => {
  now()
  await expect(fixture({chainId: 43113, url: 'http://keeper.example'}).run({allowLocalHttp: true})).rejects.toThrow(/transport/)
  expect((await fixture({url: 'http://127.0.0.1:8091'}).run({allowLocalHttp: true})).coordinator.url).toBe('http://127.0.0.1:8091')
})
it('pins deployment and approved defaults before asynchronous discovery starts', async () => {
  now(); const options = {defaultVerificationPolicy: {committee: 3, quorum: 2}}
  const f = fixture({policy: [0, 0], onChainId: () => {f.deployment.beacon = h(99, 20); options.defaultVerificationPolicy.committee = 1}})
  expect((await f.run(options)).intentFields.verification_committee).toBe(3)
})
