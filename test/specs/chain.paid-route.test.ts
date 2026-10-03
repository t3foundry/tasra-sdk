import {expect, it} from 'vitest'
import {createPublicClient, custom, decodeFunctionData, encodeFunctionResult, getAddress, toHex, type Abi, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {ed25519} from '@noble/curves/ed25519'
import {resolvePaidKeeperTarget} from '../../src/chain/prepaid.js'
import {paymentIntentTypedData, type PaymentIntentWire} from '../../src/committee/payment.js'
import {settlementAbi} from '../../src/chain/abis/settlement.js'
import {keyRegistryAbi} from '../../src/chain/abis/keyRegistry.js'
import {nodeRegistryAbi} from '../../src/chain/abis/nodeRegistry.js'

const h = (n: number, len = 32): Hex => `0x${n.toString(16).padStart(2, '0').repeat(len)}`
const expected = {slot: h(3), action: 'sign' as const, payloadDigest: h(4)}
async function fixture(change: {epoch?: bigint; version?: bigint; threshold?: number; inactive?: boolean; untagged?: boolean; duplicateId?: boolean; duplicateKey?: boolean; foreignCreator?: boolean; url?: string; contributorUrl?: string; expired?: boolean; cancelled?: boolean; chainId?: number; settled?: boolean} = {}) {
  const now = Math.floor(Date.now() / 1000)
  const creator = privateKeyToAccount(h(11))
  const publicKeys = [1, 2, 3].map(n => ed25519.getPublicKey(new Uint8Array(32).fill(n))).sort((a, b) => toHex(a).localeCompare(toHex(b)))
  const deployment = {chainId: change.chainId ?? 43112, settlement: h(1, 20), keyRegistry: h(2, 20)}
  const payment: PaymentIntentWire = {
    chain_id: deployment.chainId, settlement: deployment.settlement, key_registry: deployment.keyRegistry,
    slot: h(3), action: 'sign', payload_digest: h(4), session_commitment: h(5), nonce: h(6), max_cost: '10',
    expires: now + (change.expired ? -1 : 60), verification_epoch: 7, verification_seed: h(8), verification_root: h(9),
    verification_registry_size: 5, verification_committee: 3, verification_quorum: 2,
    keeper_assignment: {key_epoch: 1, committee_version: 2, threshold: 2, coordinator: [...publicKeys[0]!], contributors: publicKeys.map(k => [...k])},
    signature: h(0, 65),
  }
  payment.signature = await creator.signTypedData(paymentIntentTypedData(payment))
  const operators = [11, 12, 13].map(n => h(n, 20))
  const nodes = h(7, 20)
  const calls: string[] = []
  const client = createPublicClient({transport: custom({request: async ({method, params}: {method: string; params?: unknown}) => {
    calls.push(method)
    if (method === 'eth_chainId') return toHex(deployment.chainId)
    if (method === 'eth_getBlockByNumber') return {number: '0x14', hash: h(20), timestamp: toHex(now), transactions: []}
    if (method !== 'eth_call') throw new Error(`unexpected RPC ${method}`)
    const [call, at] = params as [{to: Hex; data: Hex}, unknown]
    expect(at).toEqual({blockHash: h(20), requireCanonical: true})
    const abi: Abi = call.to === nodes ? nodeRegistryAbi : call.to === deployment.keyRegistry ? keyRegistryAbi : settlementAbi
    const decoded = decodeFunctionData({abi, data: call.data})
    const index = decoded.args?.[0] === undefined ? -1 : operators.findIndex(operator => operator.toLowerCase() === String(decoded.args![0]).toLowerCase())
    const table: Record<string, unknown> = {
      prepaidEnabled: true, prepaidCost: 10n, prepaidSettled: change.settled ?? false, prepaidRefunded: 0n, prepaidAssignmentBlock: h(19),
      getKeySlot: {creator: change.foreignCreator ? h(88, 20) : creator.address,
        ruleCommitment: h(33), threshold: {k: change.threshold ?? 2, n: 3}, mode: 0, publicKey: h(44),
        epoch: change.epoch ?? 1n, committeeVersion: change.version ?? 2n, exists: true,
        cancelled: change.cancelled ?? false, expiry: BigInt(now + 3600), ruleVersion: 1n, auth: 0},
      assignedNodes: operators, nodeRegistry: nodes, operatorIdOf: BigInt(change.duplicateId ? 1 : index + 1),
      hasTag: !change.untagged,
      nodeOf: {operator: operators[index], dns: 'keeper', url: (index === 2 ? change.contributorUrl : undefined) ?? change.url ?? `https://keeper${index}.example`, p2pAddr: '',
        pubkey: toHex(publicKeys[change.duplicateKey ? 0 : index] ?? publicKeys[0]!), stake: 100n, rewardBalance: 0n, unbondingAt: 0n, active: !change.inactive},
    }
    return encodeFunctionResult({abi, functionName: decoded.functionName, result: table[decoded.functionName]})
  }}, {retryCount: 0})})
  return {client, deployment, payment, operators, publicKeys, calls}
}

it('resolves only the creator-signed coordinator using the same canonical block and current sharing', async () => {
  const f = await fixture()
  const result = await resolvePaidKeeperTarget(f.client, f.deployment, f.payment, expected)
  expect(result).toMatchObject({operator: getAddress(f.operators[0]!), publicKey: toHex(f.publicKeys[0]!), url: 'https://keeper0.example', groupPublicKey: h(44), mode: 0})
  expect(result.receipt.cost).toBe(10n)
  expect(result.contributors).toEqual(f.operators.map((operator, i) => ({operator: getAddress(operator), publicKey: toHex(f.publicKeys[i]!), url: `https://keeper${i}.example`})))
  expect(f.calls.every(m => ['eth_chainId', 'eth_getBlockByNumber', 'eth_call'].includes(m))).toBe(true)
})
it('checks transport for every paid contributor even when the coordinator uses HTTPS', async () => {
  const f = await fixture({contributorUrl: 'http://keeper2.example'})
  await expect(resolvePaidKeeperTarget(f.client, f.deployment, f.payment, expected)).rejects.toThrow(/transport/)
})
it('rotation, reshare, inactive identities, ambiguous registries and foreign spending signatures refuse discovery', async () => {
  for (const change of [{epoch: 2n}, {version: 3n}, {threshold: 3}, {inactive: true}, {untagged: true}, {duplicateId: true}, {duplicateKey: true}, {foreignCreator: true}, {expired: true}, {cancelled: true}]) {
    const f = await fixture(change)
    await expect(resolvePaidKeeperTarget(f.client, f.deployment, f.payment, expected)).rejects.toThrow()
  }
})
it('HTTP requires both explicit local allowance and local chain; URL credentials and queries always refuse', async () => {
  const f = await fixture({url: 'http://127.0.0.1:18080'})
  await expect(resolvePaidKeeperTarget(f.client, f.deployment, f.payment, expected)).rejects.toThrow(/transport/)
  expect((await resolvePaidKeeperTarget(f.client, f.deployment, f.payment, expected, {allowLocalHttp: true})).url).toBe('http://127.0.0.1:18080')
  for (const change of [{chainId: 43113, url: 'http://keeper.example'}, {url: 'https://user:secret@keeper.example'}, {url: 'https://keeper.example?redirect=elsewhere'}, {url: 'https://keeper.example#fragment'}]) {
    const other = await fixture(change)
    await expect(resolvePaidKeeperTarget(other.client, other.deployment, other.payment, expected, {allowLocalHttp: true})).rejects.toThrow(/transport/)
  }
})
it('a settled fee remains inspectable but cannot be routed into a new keeper operation', async () => {
  const f = await fixture({settled: true})
  await expect(resolvePaidKeeperTarget(f.client, f.deployment, f.payment, expected)).rejects.toThrow(/already settled/)
})
