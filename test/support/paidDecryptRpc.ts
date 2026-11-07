// A paid BLS slot (n = 3 keepers) behind a canonical-read mock RPC, for counting the chain cost of
// paid IBE and KEM decryption through the REAL application client, paid-target resolution and
// keeper approver. Every JSON-RPC call is labelled; in `http` mode the mock is reached through the
// SDK's own chain client (createTasraChainClient's transport) and HTTP requests are counted too.
import {readFileSync} from 'node:fs'
import {expect, vi} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import {sha256} from '@noble/hashes/sha256'
import {keccak_256} from '@noble/hashes/sha3'
import {createPublicClient, custom, decodeFunctionData, encodeAbiParameters, encodeFunctionResult, hexToBytes, multicall3Abi, toHex, type Abi, type Hex} from 'viem'
import {createTasra, type OperationAuthorizer, type TasraDeployment} from '../../src/app/index.js'
import type {TasraChainClient} from '../../src/chain/client.js'
import {settlementAbi} from '../../src/chain/abis/settlement.js'
import {keyRegistryAbi} from '../../src/chain/abis/keyRegistry.js'
import {nodeRegistryAbi} from '../../src/chain/abis/nodeRegistry.js'
import {requestHash} from '../../src/oid4vp/binding.js'
import {paymentIntentHash} from '../../src/committee/payment.js'
import {createDecryptionRecipient, decryptionBinding, kemContentDigest} from '../../src/crypto/recipient.js'
import {keeperExecutionFixture} from './keeperExecution.js'
import {sealIbeFixture} from './sealedIbe.js'
import {hex} from './executionRecovery.js'

const vector = JSON.parse(readFileSync(new URL('../ibe-vectors.json', import.meta.url), 'utf8')) as {mpk: string; identity: string; shares: {identifier: number; d_i: string}[]; verifying_shares: {g2: string; g1: string}[]}
const multicall3 = JSON.parse(readFileSync(new URL('../multicall3-runtime.json', import.meta.url), 'utf8')) as {address: Hex; code: Hex}
const unhex = (v: string) => new Uint8Array(Buffer.from(v.replace(/^0x/, ''), 'hex'))
export const n = vector.shares.length
const slotId = hex(0x11), nodes = hex(0x44, 20), blockHash = hex(0x20)
const deployment: TasraDeployment = {schemaVersion: 1, name: 'test', chainId: 43112, rpcUrl: 'http://localhost:9650',
  addresses: {KeyRegistry: hex(0x33, 20), NodeRegistry: nodes, Settlement: hex(0x55, 20)}, coordinator: 'lowest-operator-id'}
const keys = vector.shares.map((_, i) => toHex(ed25519.getPublicKey(new Uint8Array(32).fill(30 + i))))
const operators = keys.map((_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}` as const)
const mpk = toHex(unhex(vector.mpk))

/** A Solidity-style revert the mock raises for one registry read. */
export class MockRevert extends Error {
  readonly code = 3
  constructor(readonly data: Hex) { super('execution reverted: keeper record unavailable') }
}
const revertData = (): Hex => `0x08c379a0${encodeAbiParameters([{type: 'string'}], ['keeper record unavailable']).slice(2)}`

export interface RpcFixtureOptions {
  /** `custom`: injected viem client (JSON-RPC calls only). `http`: the SDK's chain client over a stubbed fetch. */
  transport?: 'custom' | 'http'
  /** Serve the canonical Multicall3 runtime code (and execute aggregate3) at its address. */
  multicall?: boolean
  /** Serve other code at the Multicall3 address (it answers aggregate3 like Multicall3 would). */
  impostor?: boolean
  /** `finalized` tag: the same block as latest, one behind or one past it, or an RPC error. */
  finalized?: 'head' | 'behind' | 'ahead' | 'unsupported'
  /** Revert this registry function (for every keeper, or only for the keeper at `revertIndex`). */
  revert?: string
  revertIndex?: number
  /** Return a non-batch reply (one object) to a JSON-RPC batch. */
  noBatches?: boolean
  /** KEM decryption instead of IBE. */
  kem?: boolean
  /** Keepers refuse every request (503): the operation ends in a threshold error after all chain reads. */
  refuseKeepers?: boolean
  /** The aggregate3 eth_call itself fails (an RPC error), whatever its items. */
  aggregateFails?: boolean
  /** Distinct latest block hash per head read (simulates a new block per observation). */
  newBlockPerHead?: boolean
}

/** Build the slot, the mock RPC and a decrypt driver; counts are reset at the start of each decrypt run. */
export async function paidDecryptFixture(options: RpcFixtureOptions = {}) {
  const recipient = await createDecryptionRecipient()
  const plaintext = new TextEncoder().encode('paid note')
  const aad = new TextEncoder().encode('room-7')
  const log: string[] = [], inflight = new Set<string>(), overlaps = new Set<string>()
  const counts = {http: 0, rpc: 0}
  let authorized = false, heads = 0
  const track = async <T>(label: string, value: () => T): Promise<T> => {
    const id = `${label}#${log.length}`
    log.push(label)
    for (const other of inflight) overlaps.add([label, other.split('#')[0]].sort().join(' | '))
    inflight.add(id)
    try { await new Promise(resolve => setTimeout(resolve, 3)); return value() } finally { inflight.delete(id) }
  }
  // The slot creator is the payment signer, known once the consent fixture exists.
  let creator: Hex = hex(0x77, 20)
  const evaluate = (to: Hex, data: Hex): Hex => {
    const target = to.toLowerCase()
    const abi: Abi = target === nodes ? nodeRegistryAbi : target === deployment.addresses.KeyRegistry!.toLowerCase() ? keyRegistryAbi : settlementAbi
    const {functionName: name, args} = decodeFunctionData({abi, data})
    const index = operators.findIndex(operator => operator.toLowerCase() === String(args?.[0]).toLowerCase())
    if (options.revert === name && (options.revertIndex === undefined || options.revertIndex === index)) throw new MockRevert(revertData())
    const values: Record<string, unknown> = {prepaidEnabled: true, prepaidCost: 9n, prepaidSettled: false, prepaidRefunded: 0n, prepaidAssignmentBlock: hex(19),
      getKeySlot: {creator, ruleCommitment: hex(33), threshold: {k: 2, n}, mode: 1, publicKey: mpk, epoch: 1n,
        committeeVersion: 1n, exists: true, cancelled: false, expiry: 0n, ruleVersion: 1n, auth: 0},
      assignedNodes: operators, nodeRegistry: nodes, operatorIdOf: BigInt(index + 1), hasTag: true,
      nodeOf: {operator: operators[index], dns: 'keeper', url: `https://keeper-${index}.example`, p2pAddr: '', pubkey: keys[index],
        stake: 100n, rewardBalance: 0n, unbondingAt: 0n, active: true}}
    return encodeFunctionResult({abi, functionName: name, result: values[name]})
  }
  const nameOf = (to: Hex, data: Hex) => {
    const target = to.toLowerCase()
    const abi: Abi = target === nodes ? nodeRegistryAbi : target === deployment.addresses.KeyRegistry!.toLowerCase() ? keyRegistryAbi : settlementAbi
    return decodeFunctionData({abi, data}).functionName
  }
  const currentHash = () => options.newBlockPerHead ? hex(0x20 + heads) : blockHash
  const answer = async (method: string, params: unknown): Promise<unknown> => {
    counts.rpc++
    if (method === 'eth_chainId') return track('eth_chainId', () => toHex(43112))
    if (method === 'eth_getBlockByNumber') {
      const tag = (params as [string])[0]
      const now = toHex(Math.floor(Date.now() / 1000))
      if (tag === 'finalized') {
        return track('block:finalized', () => {
          if (options.finalized === 'unsupported') throw new Error('finalized tag unsupported')
          if (options.finalized === 'behind') return {number: '0x13', hash: hex(0x19), timestamp: now, transactions: []}
          // Past the observed block: proves nothing about the observed block's hash.
          if (options.finalized === 'ahead') return {number: '0x15', hash: hex(0x21), timestamp: now, transactions: []}
          return {number: '0x14', hash: currentHash(), timestamp: now, transactions: []}
        })
      }
      if (tag === 'latest') heads++
      return track(tag === 'latest' ? `block:latest${authorized ? ':after-grant' : ''}` : 'block:recheck',
        () => ({number: '0x14', hash: currentHash(), timestamp: now, transactions: []}))
    }
    if (method === 'eth_getCode') {
      const [address, at] = params as [Hex, unknown]
      expect(at).toMatchObject({blockHash: expect.stringMatching(/^0x/), requireCanonical: true})
      return track('code', () => address.toLowerCase() === multicall3.address.toLowerCase() && (options.multicall || options.impostor)
        ? (options.impostor ? `${multicall3.code}00` : multicall3.code) : '0x')
    }
    if (method !== 'eth_call') throw new Error(`unexpected RPC ${method}`)
    const [call, at] = params as [{to: Hex; data: Hex}, unknown]
    if (at === 'latest') return track(`call:${nameOf(call.to, call.data)}:latest`, () => evaluate(call.to, call.data))
    expect(at).toMatchObject({blockHash: expect.stringMatching(/^0x/), requireCanonical: true})
    if (call.to.toLowerCase() === multicall3.address.toLowerCase()) {
      if (!options.multicall && !options.impostor) return track('call:no-code', () => '0x')
      if (options.aggregateFails) return track('call:aggregate3', () => { throw new Error('aggregate gas limit exceeded') })
      const {args} = decodeFunctionData({abi: multicall3Abi, data: call.data})
      const calls = args[0] as readonly {target: Hex; allowFailure: boolean; callData: Hex}[]
      return track('call:aggregate3', () => {
        const results = calls.map(sub => {
          log.push(`sub:${nameOf(sub.target, sub.callData)}`)
          try { return {success: true, returnData: evaluate(sub.target, sub.callData)} } catch (error) { return {success: false, returnData: (error as MockRevert).data} }
        })
        return encodeFunctionResult({abi: multicall3Abi, functionName: 'aggregate3', result: results})
      })
    }
    return track(`call:${nameOf(call.to, call.data)}`, () => evaluate(call.to, call.data))
  }
  const rpcError = (error: unknown) => error instanceof MockRevert
    ? {code: 3, message: error.message, data: error.data}
    : {code: -32000, message: error instanceof Error ? error.message : String(error)}

  let chain: TasraChainClient | undefined
  if (options.transport === 'http') {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      counts.http++
      const body = JSON.parse(String(init?.body)) as {id: number; method: string; params?: unknown} | {id: number; method: string; params?: unknown}[]
      const one = async (entry: {id: number; method: string; params?: unknown}) => {
        try { return {jsonrpc: '2.0', id: entry.id, result: await answer(entry.method, entry.params)} } catch (error) { return {jsonrpc: '2.0', id: entry.id, error: rpcError(error)} }
      }
      const reply = Array.isArray(body)
        ? options.noBatches ? {jsonrpc: '2.0', id: null, error: {code: -32600, message: 'batch requests are not supported'}} : await Promise.all(body.map(one))
        : await one(body)
      return new Response(JSON.stringify(reply), {status: 200, headers: {'Content-Type': 'application/json'}})
    }))
  } else {
    const client = createPublicClient({transport: custom({request: async ({method, params}: {method: string; params?: unknown}) => {
      try { return await answer(method, params) } catch (error) { throw error instanceof MockRevert ? Object.assign(new Error(error.message), rpcError(error)) : error }
    }}, {retryCount: 0})})
    const metadata = {exists: true, cancelled: false, mode: 1, epoch: 1, threshold: {k: 2, n}, publicKey: mpk}
    chain = {addresses: {...deployment.addresses}, client,
      readers: {keyRegistry: {getKeySlot: vi.fn(() => track('reader:getKeySlot', () => metadata)), assignedNodes: vi.fn()}, nodeRegistry: {}}} as unknown as TasraChainClient
  }
  const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
    if (options.kem || options.refuseKeepers) return new Response('keeper unavailable', {status: 503})
    const i = Number(/keeper-(\d+)/.exec(String(url))![1]), share = vector.shares[i]!, verifying = vector.verifying_shares[i]!
    const body = JSON.parse(String(init?.body)) as {committee_token: {request_hash: Hex}}
    return Response.json(await sealIbeFixture({key_slot_id: slotId, identifier: share.identifier, extraction_share: Buffer.from(unhex(share.d_i)).toString('base64'),
      verifying_share: Buffer.concat([unhex(verifying.g2), unhex(verifying.g1)]).toString('base64'), epoch: 1}, recipient, hexToBytes(body.committee_token.request_hash)))
  })
  const app = createTasra({deployment, ...(chain ? {chain} : {}), fetchImpl})
  const slot = await app.slots.bls(slotId)
  const ibeCiphertext = await slot.encryptForIdentity(vector.identity, plaintext)
  const kemCiphertext = await slot.encrypt(aad, plaintext)
  const binding = options.kem
    ? decryptionBinding(kemContentDigest(kemCiphertext, aad), 1, recipient)
    : decryptionBinding(sha256(new TextEncoder().encode(vector.identity)), 1, recipient)
  const consent = await keeperExecutionFixture(options.kem ? 'decrypt' : 'ibe-extract', toHex(binding.payloadDigest), {chain_id: 43112,
    settlement: deployment.addresses.Settlement!, key_registry: deployment.addresses.KeyRegistry!, slot: slotId,
    keeper_assignment: {key_epoch: 1, committee_version: 1, threshold: 2, coordinator: [...hexToBytes(keys[0]!)],
      contributors: [...keys].sort().map(key => [...hexToBytes(key)])}})
  const payment = consent.payment
  creator = consent.creator.address
  const authorize = vi.fn<OperationAuthorizer>(async request => {
    authorized = true
    return {token: {token_type: 'JWT', slot_id: slotId, seed: '22'.repeat(32), epoch: 1, vp_hash: '33'.repeat(32), holder_hash: '44'.repeat(32),
      rule_hash: '55'.repeat(32), verifier_indexes: [0], iat: 1, exp: payment.expires, binding: 'holder_key',
      identity_hash: toHex(keccak_256(new TextEncoder().encode(request.identity ?? ''))),
      request_hash: toHex(requestHash(43112, hexToBytes(slotId), request.action, request.payloadDigest!)), signatures: [],
      payment: structuredClone(payment), payment_hash: paymentIntentHash(payment)},
    verifierProofs: [{verifierIndex: 0, operator: operators[0]!, pubkey: keys[0]!, proof: []}]}
  })
  const verifyingShares = new Map(vector.shares.map((s, i) => [s.identifier, new Uint8Array([...unhex(vector.verifying_shares[i]!.g2), ...unhex(vector.verifying_shares[i]!.g1)])]))
  const options_ = () => ({recipient, verifyingShares, authorize, payment, random: payment.session_commitment, execution: consent.execution})
  /** One decryption; KEM keepers refuse, so a KEM run ends in a threshold error after every chain read. */
  const once = async () => {
    if (options.kem) {
      await expect(slot.decrypt(aad, kemCiphertext, options_())).rejects.toThrow(/threshold|keeper|503|unavailable/i)
    } else if (options.refuseKeepers) {
      await expect(slot.decryptForIdentity(vector.identity, ibeCiphertext, options_())).rejects.toThrow(/threshold|keeper|503|unavailable/i)
    } else {
      expect((await slot.decryptForIdentity(vector.identity, ibeCiphertext, options_())).plaintext).toEqual(plaintext)
    }
  }
  /** One decryption attempt, unchecked. */
  const attempt = () => options.kem ? slot.decrypt(aad, kemCiphertext, options_()) : slot.decryptForIdentity(vector.identity, ibeCiphertext, options_())
  const reset = () => { log.length = 0; overlaps.clear(); counts.http = 0; counts.rpc = 0; authorized = false }
  /** `count` operations at once on the one client; counts cover exactly these operations. */
  const run = async (count = 1) => {
    reset()
    await Promise.all(Array.from({length: count}, once))
    return {http: counts.http, rpc: counts.rpc}
  }
  return {run, once, attempt, reset, log, overlaps, counts, fetchImpl, signer: consent.signer}
}

export const count = (log: readonly string[], label: string) => log.filter(l => l === label).length
/** How often one registry value was read, alone or inside an aggregate. */
export const reads = (log: readonly string[], name: string) => count(log, `call:${name}`) + count(log, `sub:${name}`)
