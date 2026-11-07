// RPC cost and read concurrency of one paid IBE decryption with n assigned keepers, through the
// REAL resolvePaidKeeperTarget and keeper approver over a canonical-read mock RPC.
import {readFileSync} from 'node:fs'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import {sha256} from '@noble/hashes/sha256'
import {keccak_256} from '@noble/hashes/sha3'
import {createPublicClient, custom, decodeFunctionData, encodeFunctionResult, hexToBytes, toHex, type Abi, type Hex} from 'viem'
import {createTasra, type OperationAuthorizer, type TasraDeployment} from '../../src/app/index.js'
import type {TasraChainClient} from '../../src/chain/client.js'
import {settlementAbi} from '../../src/chain/abis/settlement.js'
import {keyRegistryAbi} from '../../src/chain/abis/keyRegistry.js'
import {nodeRegistryAbi} from '../../src/chain/abis/nodeRegistry.js'
import {requestHash} from '../../src/oid4vp/binding.js'
import {paymentIntentHash} from '../../src/committee/payment.js'
import {createDecryptionRecipient, decryptionBinding} from '../../src/crypto/recipient.js'
import {keeperExecutionFixture} from '../support/keeperExecution.js'
import {sealIbeFixture} from '../support/sealedIbe.js'
import {hex} from '../support/executionRecovery.js'

const vector = JSON.parse(readFileSync(new URL('../ibe-vectors.json', import.meta.url), 'utf8')) as {mpk: string; identity: string; shares: {identifier: number; d_i: string}[]; verifying_shares: {g2: string; g1: string}[]}
const unhex = (v: string) => new Uint8Array(Buffer.from(v.replace(/^0x/, ''), 'hex'))
const n = vector.shares.length
const slotId = hex(0x11), nodes = hex(0x44, 20), blockHash = hex(0x20)
const deployment: TasraDeployment = {schemaVersion: 1, name: 'test', chainId: 43112, rpcUrl: 'http://localhost:9650',
  addresses: {KeyRegistry: hex(0x33, 20), NodeRegistry: nodes, Settlement: hex(0x55, 20)}, coordinator: 'lowest-operator-id'}
const keys = vector.shares.map((_, i) => toHex(ed25519.getPublicKey(new Uint8Array(32).fill(30 + i))))
const operators = keys.map((_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}` as const)
const mpk = toHex(unhex(vector.mpk))

afterEach(() => vi.restoreAllMocks())

async function fixture() {
  const recipient = await createDecryptionRecipient()
  const binding = decryptionBinding(sha256(new TextEncoder().encode(vector.identity)), 1, recipient)
  const consent = await keeperExecutionFixture('ibe-extract', toHex(binding.payloadDigest), {chain_id: 43112,
    settlement: deployment.addresses.Settlement!, key_registry: deployment.addresses.KeyRegistry!, slot: slotId,
    keeper_assignment: {key_epoch: 1, committee_version: 1, threshold: 2, coordinator: [...hexToBytes(keys[0]!)],
      contributors: [...keys].sort().map(key => [...hexToBytes(key)])}})
  const {payment} = consent

  // Every read is labelled and held for a few ms; `overlaps` records which reads were in flight together.
  const log: string[] = [], inflight = new Set<string>(), overlaps = new Set<string>()
  let authorized = false
  const track = async <T>(label: string, value: () => T): Promise<T> => {
    const id = `${label}#${log.length}`
    log.push(label)
    for (const other of inflight) overlaps.add([label, other.split('#')[0]].sort().join(' | '))
    inflight.add(id)
    try { await new Promise(resolve => setTimeout(resolve, 3)); return value() } finally { inflight.delete(id) }
  }
  const client = createPublicClient({transport: custom({request: async ({method, params}: {method: string; params?: unknown}) => {
    if (method === 'eth_chainId') return track('eth_chainId', () => toHex(43112))
    if (method === 'eth_getBlockByNumber') {
      const tag = (params as [string])[0]
      return track(tag === 'latest' ? `block:latest${authorized ? ':after-grant' : ''}` : 'block:recheck',
        () => ({number: '0x14', hash: blockHash, timestamp: toHex(Math.floor(Date.now() / 1000)), transactions: []}))
    }
    if (method !== 'eth_call') throw new Error(`unexpected RPC ${method}`)
    const [call, at] = params as [{to: Hex; data: Hex}, unknown]
    expect(at).toEqual({blockHash, requireCanonical: true})
    const to = call.to.toLowerCase()
    const abi: Abi = to === nodes ? nodeRegistryAbi : to === payment.key_registry.toLowerCase() ? keyRegistryAbi : settlementAbi
    const {functionName: name, args} = decodeFunctionData({abi, data: call.data})
    const index = operators.findIndex(operator => operator.toLowerCase() === String(args?.[0]).toLowerCase())
    const values: Record<string, unknown> = {prepaidEnabled: true, prepaidCost: 9n, prepaidSettled: false, prepaidRefunded: 0n, prepaidAssignmentBlock: hex(19),
      getKeySlot: {creator: consent.creator.address, ruleCommitment: hex(33), threshold: {k: 2, n}, mode: 1, publicKey: mpk, epoch: 1n,
        committeeVersion: 1n, exists: true, cancelled: false, expiry: 0n, ruleVersion: 1n, auth: 0},
      assignedNodes: operators, nodeRegistry: nodes, operatorIdOf: BigInt(index + 1), hasTag: true,
      nodeOf: {operator: operators[index], dns: 'keeper', url: `https://keeper-${index}.example`, p2pAddr: '', pubkey: keys[index],
        stake: 100n, rewardBalance: 0n, unbondingAt: 0n, active: true}}
    return track(`call:${name}`, () => encodeFunctionResult({abi, functionName: name, result: values[name]}))
  }}, {retryCount: 0})})
  const metadata = {exists: true, cancelled: false, mode: 1, epoch: 1, threshold: {k: 2, n}, publicKey: mpk}
  const chain = {addresses: {...deployment.addresses}, client,
    readers: {keyRegistry: {getKeySlot: vi.fn(() => track('reader:getKeySlot', () => metadata)), assignedNodes: vi.fn()}, nodeRegistry: {}}}
  const authorize = vi.fn<OperationAuthorizer>(async request => {
    authorized = true
    return {token: {token_type: 'JWT', slot_id: slotId, seed: '22'.repeat(32), epoch: 1, vp_hash: '33'.repeat(32), holder_hash: '44'.repeat(32),
      rule_hash: '55'.repeat(32), verifier_indexes: [0], iat: 1, exp: payment.expires, binding: 'holder_key',
      identity_hash: toHex(keccak_256(new TextEncoder().encode(request.identity ?? ''))),
      request_hash: toHex(requestHash(43112, hexToBytes(slotId), request.action, request.payloadDigest!)), signatures: [],
      payment: structuredClone(payment), payment_hash: paymentIntentHash(payment)},
    verifierProofs: [{verifierIndex: 0, operator: operators[0]!, pubkey: keys[0]!, proof: []}]}
  })
  const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
    const i = Number(/keeper-(\d+)/.exec(String(url))![1]), share = vector.shares[i]!, verifying = vector.verifying_shares[i]!
    const body = JSON.parse(String(init?.body)) as {committee_token: {request_hash: Hex}}
    return Response.json(await sealIbeFixture({key_slot_id: slotId, identifier: share.identifier, extraction_share: Buffer.from(unhex(share.d_i)).toString('base64'),
      verifying_share: Buffer.concat([unhex(verifying.g2), unhex(verifying.g1)]).toString('base64'), epoch: 1}, recipient, hexToBytes(body.committee_token.request_hash)))
  })
  const app = createTasra({deployment, chain: chain as unknown as TasraChainClient, fetchImpl})
  const verifyingShares = new Map(vector.shares.map((s, i) => [s.identifier, new Uint8Array([...unhex(vector.verifying_shares[i]!.g2), ...unhex(vector.verifying_shares[i]!.g1)])]))
  const decrypt = async () => {
    const slot = await app.slots.bls(slotId)
    const plaintext = new TextEncoder().encode('paid note')
    const ciphertext = await slot.encryptForIdentity(vector.identity, plaintext)
    log.length = 0; overlaps.clear()
    const result = await slot.decryptForIdentity(vector.identity, ciphertext, {recipient, verifyingShares, authorize, payment, random: payment.session_commitment, execution: consent.execution})
    expect(result.plaintext).toEqual(plaintext)
  }
  /** Two operations at once on the same client (both see the same head block). */
  const decryptTwice = async () => {
    const slot = await app.slots.bls(slotId)
    const plaintext = new TextEncoder().encode('paid note')
    const ciphertext = await slot.encryptForIdentity(vector.identity, plaintext)
    log.length = 0; overlaps.clear()
    const results = await Promise.all([0, 1].map(() => slot.decryptForIdentity(vector.identity, ciphertext,
      {recipient, verifyingShares, authorize, payment, random: payment.session_commitment, execution: consent.execution})))
    for (const result of results) expect(result.plaintext).toEqual(plaintext)
  }
  return {decrypt, decryptTwice, log, overlaps, fetchImpl, signer: consent.signer}
}

const count = (log: string[], label: string) => log.filter(l => l === label).length

describe('paid IBE decryption RPC cost', () => {
  it(`resolves the paid keeper target once per wallet step, not once per keeper (n = ${n})`, async () => {
    const f = await fixture()
    try {
      await f.decrypt()
      expect(f.fetchImpl).toHaveBeenCalledTimes(n)
      // One canonical head per target resolution: once before the wallet step, once after it.
      // Before this change every one of the n keeper approvals resolved it again (2 + n).
      expect(count(f.log, 'block:latest')).toBe(1)
      expect(count(f.log, 'block:latest:after-grant')).toBe(1)
      // One canonicality recheck per resolution (was two: after the receipt and after the directory).
      expect(count(f.log, 'block:recheck')).toBe(2)
      // Total reads for n = 3, measured with this mock: 103 before this change (five resolutions), 43 now.
      expect(f.log).toHaveLength(43)
    } finally { f.signer.dispose() }
  })

  it('concurrent operations on one client share identical block-pinned directory reads, never head or reservation reads', async () => {
    const f = await fixture()
    try {
      await f.decrypt()
      const single = [...f.log]
      await f.decryptTwice()
      const directory = ['call:getKeySlot', 'call:assignedNodes', 'call:nodeRegistry', 'call:nodeOf', 'call:operatorIdOf', 'call:hasTag']
      for (const label of directory) expect(count(f.log, label)).toBe(count(single, label))
      for (const label of ['call:prepaidCost', 'call:prepaidSettled', 'reader:getKeySlot']) expect(count(f.log, label)).toBe(2 * count(single, label))
      // The 3 + 3n = 12 directory reads of each resolution are made once for both operations:
      // at most 2 x 43 - 2 x 12 reads (viem may also merge identical head reads of the two).
      const shared = directory.reduce((sum, label) => sum + count(single, label), 0)
      expect(shared).toBe(2 * (3 + 3 * n))
      expect(f.log.length).toBeLessThanOrEqual(2 * single.length - shared)
    } finally { f.signer.dispose() }
  })

  it('issues each group of independent reads concurrently', async () => {
    const f = await fixture()
    try {
      await f.decrypt()
      // slots.get / ready(): the chain check beside the slot read.
      expect(f.overlaps).toContain('eth_chainId | reader:getKeySlot')
      // resolvePaidKeeperTarget: the reservation reads beside the keeper directory, at one block.
      expect(f.overlaps).toContain('call:getKeySlot | call:prepaidCost')
      // After the wallet step: the slot recheck beside the paid target re-read.
      expect(f.overlaps).toContain('block:latest:after-grant | reader:getKeySlot')
    } finally { f.signer.dispose() }
  })
})
