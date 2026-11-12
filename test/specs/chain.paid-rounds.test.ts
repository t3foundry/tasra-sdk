// Sequential RPC rounds on the paid path's block-pinned decisions (C21 attribution, 110 ms fleet):
// a read that cannot be answered (Settlement "4" has no settled-seq getter) or a recheck that waits
// for another read cost one round each, every time, on an otherwise cached decision.
import {afterEach, describe, expect, it, vi} from 'vitest'
import {createPublicClient, custom, decodeFunctionData, encodeFunctionResult, type Abi, type Hex, type PublicClient} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {allowanceWorld, assignment, deployment, h, NOW, signedAllowanceIntent, slot, creator, sequentialRounds} from '../support/allowanceFixture.js'
import {collectDebitVoucher, prepaidAllowanceId} from '../../src/chain/allowance.js'
import {paymentIntentTypedData, type PaymentIntentWire} from '../../src/committee/payment.js'
import {followPaidRequest, readClientExecutionPolicy, readPaidOperationReceipt} from '../../src/chain/prepaid.js'
import {attachHeadFollower, unfollowHeads, type FollowedHead, type HeadFollower} from '../../src/chain/headFollower.js'
import {keyRegistryAbi} from '../../src/chain/abis/keyRegistry.js'
import {settlementAbi} from '../../src/chain/abis/settlement.js'
import {thresholdRandomBeaconAbi} from '../../src/chain/abis/thresholdRandomBeacon.js'
import {verifierSetRegistryAbi} from '../../src/chain/abis/verifierSetRegistry.js'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

/** A live, instant-finality follower whose tip is `head` and that vouches for that block only. */
function follow(client: PublicClient, head: () => FollowedHead): HeadFollower {
  const follower = {
    finality: 'instant', tip: () => ({...head()}), isCanonical: (at: {blockHash: Hex}) => at.blockHash.toLowerCase() === head().blockHash.toLowerCase(),
    live: () => true, ingest: async () => {}, ingestFinalized: async () => {}, noteMinedBlock: () => {}, gaps: () => 0, start: () => {}, stop: () => {},
    onHead: () => () => {},
  } as unknown as HeadFollower
  attachHeadFollower(client, follower)
  return follower
}

// A custom transport is asked for its chain ID on every observation (an HTTP or WebSocket one once per client): not counted.
type World = ReturnType<typeof allowanceWorld>
const rounds = (world: World) => sequentialRounds(world.rpcSpans.filter((_, i) => world.rpcSpanMethods[i] !== 'eth_chainId'))
const reset = (world: World) => { world.rpcSpans.length = 0; world.rpcSpanMethods.length = 0 }

describe('the allowance backing on a Settlement without range settlement ("4")', () => {
  async function backed(change: Parameters<typeof allowanceWorld>[0]) {
    const world = allowanceWorld(change), intent = await signedAllowanceIntent(), allowance = prepaidAllowanceId(intent)
    const unsigned = {chain_id: 43112, settlement: deployment.settlement, key_registry: deployment.keyRegistry, slot, action: 'decrypt' as const,
      payload_digest: h(0x26), session_commitment: h(0x27), nonce: h(0x28), max_cost: '100', expires: NOW + 600, verification_epoch: 7,
      verification_seed: h(0x24), verification_root: h(0x25), verification_registry_size: 5, verification_committee: 3, verification_quorum: 2,
      keeper_assignment: structuredClone(assignment), allowance_id: allowance}
    const signed: PaymentIntentWire = {...unsigned, signature: await creator.signTypedData(paymentIntentTypedData(unsigned))}
    const {voucher} = await collectDebitVoucher(world.client, deployment, {payment: signed, seq: 1, quoteBlock: h(0x77), maxOpCost: 100n}, {accountantUrls: world.accountantUrls})
    const payment = {...signed, debit_voucher: voucher}
    return {world, payment, expected: {slot, action: payment.action, payloadDigest: payment.payload_digest}}
  }
  const mined = {slotId: slot, assignmentBlock: h(19), amount: 1000n, maxOpCost: 100n, expiresAt: BigInt(NOW + 3600), actions: 79}
  const head = {blockNumber: 20n, blockHash: h(20), blockTimestamp: BigInt(NOW), parentHash: h(19)}

  it('never asks a "4" Settlement for its settled seq again: a cached decision at a followed head makes no RPC', async () => {
    const {world, payment, expected} = await backed({allowance: mined, rpcDelayMs: 5})
    follow(world.client, () => head)
    try {
      await readPaidOperationReceipt(world.client, deployment, payment, expected)
      world.calls.length = 0; reset(world)
      // Before: the settled-seq read reverted, was never cached, and was the one round of every later decision.
      expect(await readPaidOperationReceipt(world.client, deployment, payment, expected)).toMatchObject({settled: false, cost: 40n})
      expect(world.calls).toEqual([])
      expect(rounds(world)).toBe(0)
    } finally { unfollowHeads(world.client) }
  }, 30_000)

  it('a "5" Settlement keeps its settled seq read beside the other reads, and a version upgrade the client has not seen is still judged at its block', async () => {
    const change: Parameters<typeof allowanceWorld>[0] = {allowance: mined, rpcDelayMs: 5}
    const {world, payment, expected} = await backed(change)
    let tip = head
    follow(world.client, () => tip)
    try {
      expect(await readPaidOperationReceipt(world.client, deployment, payment, expected)).toMatchObject({settled: false})
      // The Settlement is upgraded to "5" and range-settles seq 1; the client last saw "4".
      change.version = '5'; change.settledSeq = 1n
      tip = {blockNumber: 21n, blockHash: h(21), blockTimestamp: BigInt(NOW), parentHash: h(20)}
      world.calls.length = 0; reset(world)
      expect(await readPaidOperationReceipt(world.client, deployment, payment, expected)).toMatchObject({settled: true})
      expect(world.calls).toContain('prepaidAllowanceSettledSeq')
      // The hint missed the upgrade: one more round, once (version first, then the settled seq).
      expect(rounds(world)).toBe(2)
      // From now on the settled seq is read beside the version again.
      tip = {blockNumber: 22n, blockHash: h(22), blockTimestamp: BigInt(NOW), parentHash: h(21)}
      reset(world)
      expect(await readPaidOperationReceipt(world.client, deployment, payment, expected)).toMatchObject({settled: true})
      expect(rounds(world)).toBe(1)
    } finally { unfollowHeads(world.client) }
  }, 30_000)

  it('the in-flight request pre-read skips the settled seq on a "4" Settlement once its version is known', async () => {
    const {world, payment} = await backed({allowance: mined})
    follow(world.client, () => head)
    try {
      await readPaidOperationReceipt(world.client, deployment, payment, {slot, action: payment.action, payloadDigest: payment.payload_digest})
      const tip = {blockNumber: 23n, blockHash: h(23), blockTimestamp: BigInt(NOW), parentHash: h(22)}
      follow(world.client, () => tip)
      world.calls.length = 0
      followPaidRequest(world.client, deployment, payment)
      await vi.waitFor(() => expect(world.calls).toContain('version'))
      await new Promise(done => setTimeout(done, 20))
      expect(world.calls).not.toContain('prepaidAllowanceSettledSeq')
    } finally { unfollowHeads(world.client) }
  }, 30_000)
})

// readClientExecutionPolicy over a fake node with two heads (355, 356) and a quote block (354)
// older than the follower's window: its by-number canonical recheck is an RPC round every time.
const QUOTE: Hex = `0x${'5c'.repeat(32)}`
const HEAD1: Hex = `0x${'55'.repeat(32)}`
const HEAD2: Hex = `0x${'56'.repeat(32)}`
const T = 1_791_562_483n
const word = (n: bigint): Hex => `0x${n.toString(16).padStart(64, '0')}`
const seedOf = (epoch: bigint) => word(0x1000n + epoch)
const rootOf = (epoch: bigint) => word(0x2000n + epoch)
const d = {chainId: 43112, settlement: h(1, 20), keyRegistry: h(2, 20), verifierSet: h(5, 20), beacon: h(6, 20)}
const signer = privateKeyToAccount(h(11))
const intended = {slot: h(3), action: 'sign' as const, payloadDigest: h(44)}
const block = (number: bigint, hash: Hex) => ({number: `0x${number.toString(16)}`, hash, timestamp: `0x${T.toString(16)}`, transactions: []})
const paid: PaymentIntentWire = {chain_id: 43112, settlement: d.settlement, key_registry: d.keyRegistry, slot: intended.slot, action: 'sign',
  payload_digest: intended.payloadDigest, session_commitment: h(46), nonce: h(45), max_cost: '10', expires: Number(T) + 600,
  verification_epoch: 64, verification_seed: seedOf(64n), verification_root: rootOf(64n), verification_registry_size: 5,
  verification_committee: 3, verification_quorum: 2, keeper_assignment: {key_epoch: 1, committee_version: 2, threshold: 2,
    coordinator: Array<number>(32).fill(9), contributors: [9, 10, 11].map(n => Array<number>(32).fill(n))}, signature: h(1, 65)}

function node(delayMs: number) {
  const spans: [number, number][] = []
  const recheck: [number, number][] = []
  const names: string[] = []
  const transport = custom({request: async ({method, params}: {method: string; params?: unknown}) => {
    const start = performance.now()
    await new Promise(done => setTimeout(done, delayMs))
    try {
      const args = (params ?? []) as unknown[]
      if (method === 'eth_chainId') return '0xa868'
      if (method === 'eth_getBlockByHash') return args[0] === QUOTE ? block(354n, QUOTE) : null
      if (method === 'eth_getBlockByNumber') {
        if (args[0] === '0x162') { recheck.push([start, performance.now()]); return block(354n, QUOTE) }
        return null
      }
      if (method !== 'eth_call') throw new Error(`unexpected RPC ${method}`)
      const [call, at] = args as [{to: Hex; data: Hex}, {blockHash?: Hex}]
      const abi: Abi = call.to === d.keyRegistry ? keyRegistryAbi : call.to === d.beacon ? thresholdRandomBeaconAbi : call.to === d.verifierSet ? verifierSetRegistryAbi : settlementAbi
      const {functionName: name, args: inputs} = decodeFunctionData({abi, data: call.data})
      if (at.blockHash === QUOTE) return encodeFunctionResult({abi, functionName: 'epoch', result: 65n})
      if (at.blockHash !== HEAD1 && at.blockHash !== HEAD2) throw new Error('read at an unknown block')
      const epoch = typeof inputs?.[0] === 'bigint' ? inputs[0] : 0n
      names.push(typeof inputs?.[0] === 'bigint' ? `${name}(${epoch})` : name)
      const values: Record<string, unknown> = {
        prepaidEnabled: true, prepaidCost: 5n, prepaidSettled: false, prepaidRefunded: 0n, prepaidAssignmentBlock: QUOTE,
        randomBeacon: d.beacon, beacon: d.beacon, epoch: 66n, seedAt: seedOf(epoch), snapshotAt: [rootOf(epoch), 5],
        verifierPolicy: [3, 2], nodeRegistry: h(7, 20),
        getKeySlot: {creator: signer.address, ruleCommitment: h(33), threshold: {k: 2, n: 3}, mode: 0, publicKey: h(34), epoch: 1n,
          committeeVersion: 2n, exists: true, cancelled: false, expiry: 0n, ruleVersion: 1n, auth: 0},
      }
      return encodeFunctionResult({abi, functionName: name, result: values[name]})
    } finally { if (method !== 'eth_chainId') spans.push([start, performance.now()]) }
  }}, {retryCount: 0})
  const client = createPublicClient({transport}) as PublicClient
  vi.spyOn(Date, 'now').mockReturnValue(Number(T) * 1000 + 400)
  return {client, spans, recheck, names}
}

describe('the quote block epoch read of the client execution policy', () => {
  it('starts the assignment block recheck beside the reads at the head once the payment\'s assignment block is known', async () => {
    const f = node(10)
    let tip: FollowedHead = {blockNumber: 355n, blockHash: HEAD1, blockTimestamp: T, parentHash: h(1)}
    follow(f.client, () => tip)
    try {
      await readClientExecutionPolicy(f.client, d, paid, intended)
      // A new head: none of its reads is cached. Before, the recheck waited for them: 2 rounds.
      tip = {blockNumber: 356n, blockHash: HEAD2, blockTimestamp: T, parentHash: HEAD1}
      f.spans.length = 0; f.recheck.length = 0
      await readClientExecutionPolicy(f.client, d, paid, intended)
      expect(f.recheck).toHaveLength(1)
      expect(sequentialRounds(f.spans)).toBe(1)
    } finally { unfollowHeads(f.client) }
  })
})

describe('the in-flight request pre-read', () => {
  it('pre-reads the policy anchors of the payment\'s own draw epoch, so the decision at that head does not read them', async () => {
    const f = node(1)
    const tip: FollowedHead = {blockNumber: 355n, blockHash: HEAD1, blockTimestamp: T, parentHash: h(1)}
    follow(f.client, () => tip)
    try {
      followPaidRequest(f.client, d, paid)
      await vi.waitFor(() => expect(f.names).toContain('snapshotAt(64)'))
      await new Promise(done => setTimeout(done, 20))
      expect(f.names).toContain('seedAt(64)')
      f.names.length = 0
      await readClientExecutionPolicy(f.client, d, paid, intended)
      // Before: both were read in the decision, a round of their own when every other read was cached.
      expect(f.names.filter(n => n.endsWith('(64)'))).toEqual([])
      for (const name of ['prepaidCost', 'prepaidSettled', 'prepaidRefunded', 'prepaidAssignmentBlock']) expect(f.names).not.toContain(name)
    } finally { unfollowHeads(f.client) }
  })
})
