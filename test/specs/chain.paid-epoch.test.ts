import {afterEach, describe, expect, it, vi} from 'vitest'
import {createPublicClient, custom, decodeFunctionData, encodeFunctionData, encodeFunctionResult, type Abi, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {readClientExecutionPolicy} from '../../src/chain/prepaid.js'
import {
  MAX_ASSIGNMENT_AGE_SECS, OBSERVATION_MAX_FUTURE_SKEW_SECS, PAYMENT_INTENT_MAX_LIFETIME_SECS, PaidEpochError,
  RESERVATION_QUOTE_MAX_AGE_SECS, RESERVATION_SUBMISSION_WINDOW_SECS, requirePaidEpoch, type AssignmentEpoch,
} from '../../src/chain/paidEpoch.js'
import {isRetryable} from '../../src/errors.js'
import {pinnedDraw} from '../../src/committee/request.js'
import type {PaymentIntentWire} from '../../src/committee/payment.js'
import {keyRegistryAbi} from '../../src/chain/abis/keyRegistry.js'
import {settlementAbi} from '../../src/chain/abis/settlement.js'
import {thresholdRandomBeaconAbi} from '../../src/chain/abis/thresholdRandomBeacon.js'
import {verifierSetRegistryAbi} from '../../src/chain/abis/verifierSetRegistry.js'

// n4 (run-20261009T155317Z-n4, exhaustion op2): block 354 at 16:14:41Z is epoch 65 and the
// quote selected 64; the reservation mined at block 355, 16:14:43Z, epoch 66.
const QUOTE = `0x${'5c'.repeat(32)}` as Hex
const MINED = `0x${'55'.repeat(32)}` as Hex
const ORPHAN = `0x${'99'.repeat(32)}` as Hex
const SUBSTITUTE = `0x${'5d'.repeat(32)}` as Hex
const T354 = 1_791_562_481n
const T355 = 1_791_562_483n
const quote: AssignmentEpoch = {blockHash: QUOTE, blockNumber: 354n, blockTimestamp: T354, beaconEpoch: 65n}
const observed = (blockNumber: bigint, blockTimestamp: bigint) => ({assignmentBlock: QUOTE, blockNumber, blockTimestamp})

afterEach(() => vi.restoreAllMocks())

describe('paid epoch rule (D8), pure', () => {
  it('derives the use bound from the same named constants as Rust (3600 + 30 + 2 = 3632)', () => {
    expect([PAYMENT_INTENT_MAX_LIFETIME_SECS, RESERVATION_QUOTE_MAX_AGE_SECS, RESERVATION_SUBMISSION_WINDOW_SECS, OBSERVATION_MAX_FUTURE_SKEW_SECS])
      .toEqual([3600n, 30n, 120n, 2n])
    expect(MAX_ASSIGNMENT_AGE_SECS).toBe(3632n)
  })
  it('admits the n4 boundary payment and keeps admitting it across later boundaries', () => {
    expect(() => requirePaidEpoch(64n, observed(355n, T355), quote, 66n)).not.toThrow()
    expect(() => requirePaidEpoch(64n, observed(500n, T355 + 600n), quote, 120n)).not.toThrow()
    expect(() => requirePaidEpoch(65n, observed(355n, T355), quote, 66n)).not.toThrow()
  })
  it('refuses an epoch outside {E_a, E_a - 1}, definitely', () => {
    for (const epoch of [0n, 62n, 63n, 66n, 67n]) {
      expect(() => requirePaidEpoch(epoch, observed(355n, T355), quote, 66n)).toThrow(/not current or previous/)
    }
    let refusal: unknown
    try { requirePaidEpoch(63n, observed(355n, T355), quote, 66n) } catch (e) { refusal = e }
    expect(refusal).toBeInstanceOf(PaidEpochError)
    expect(refusal).toMatchObject({code: 'paid_epoch_refused', retryable: false})
  })
  it('an older quote block moves the window, never widens it', () => {
    const old = {...quote, blockNumber: 330n, blockTimestamp: T354 - 48n, beaconEpoch: 62n}
    expect(() => requirePaidEpoch(64n, observed(355n, T355), old, 66n)).toThrow()
    expect(() => requirePaidEpoch(61n, observed(355n, T355), old, 66n)).not.toThrow()
  })
  it('refuses a substituted, zero, later or contradicting anchor', () => {
    expect(() => requirePaidEpoch(64n, observed(355n, T355), {...quote, blockHash: SUBSTITUTE}, 66n)).toThrow(/assignment block/)
    expect(() => requirePaidEpoch(64n, {...observed(355n, T355), assignmentBlock: `0x${'0'.repeat(64)}`}, quote, 66n)).toThrow()
    expect(() => requirePaidEpoch(64n, observed(355n, T355), {...quote, blockNumber: 356n}, 66n)).toThrow()
    expect(() => requirePaidEpoch(64n, observed(355n, T355), {...quote, blockTimestamp: T355 + 1n}, 66n)).toThrow()
    expect(() => requirePaidEpoch(64n, observed(355n, T355), quote, 64n)).toThrow(/behind/)
  })
  it('bounds the assignment age by the payment lifetime, inclusively', () => {
    // Literal seconds, not the constant, so an off-by-one in the derivation fails here.
    expect(() => requirePaidEpoch(64n, observed(2000n, T354 + 3632n), quote, 400n)).not.toThrow()
    expect(() => requirePaidEpoch(64n, observed(2000n, T354 + 3633n), quote, 400n)).toThrow(/lifetime/)
  })
})

// A fake JSON-RPC node behind viem's custom transport, so the real readClientExecutionPolicy
// and its real viem formatting (EIP-1898 block parameter) are exercised end to end.
const h = (n: number, len = 32): Hex => `0x${n.toString(16).padStart(2, '0').repeat(len)}`
const word = (n: bigint): Hex => `0x${n.toString(16).padStart(64, '0')}`
const seedOf = (epoch: bigint) => word(0x1000n + epoch)
const rootOf = (epoch: bigint) => word(0x2000n + epoch)
const deployment = {chainId: 43112, settlement: h(1, 20), keyRegistry: h(2, 20), verifierSet: h(5, 20), beacon: h(6, 20)}
const creator = privateKeyToAccount(h(11))
const intended = {slot: h(3), action: 'sign' as const, payloadDigest: h(44)}
const block = (number: bigint, hash: Hex, timestamp: bigint) => ({number: `0x${number.toString(16)}`, hash, timestamp: `0x${timestamp.toString(16)}`, transactions: []})

function paidAt(epoch: number): PaymentIntentWire {
  return {chain_id: 43112, settlement: deployment.settlement, key_registry: deployment.keyRegistry, slot: intended.slot, action: 'sign',
    payload_digest: intended.payloadDigest, session_commitment: h(46), nonce: h(45), max_cost: '10', expires: Number(T355) + 600,
    verification_epoch: epoch, verification_seed: seedOf(BigInt(epoch)), verification_root: rootOf(BigInt(epoch)), verification_registry_size: 5,
    verification_committee: 3, verification_quorum: 2, keeper_assignment: {key_epoch: 1, committee_version: 2, threshold: 2,
      coordinator: Array<number>(32).fill(9), contributors: [9, 10, 11].map(n => Array<number>(32).fill(n))}, signature: h(1, 65)}
}

interface N4 {
  /** `eth_call` at the quote block fails as a pruned node does. */
  pruned?: boolean
  /** The node does not know the quote block hash at all. */
  unknown?: boolean
  /** The quote block's height now holds another (canonical) block. */
  reorg?: boolean
  /** The by-number recheck of the quote height is not served. */
  heightUnavailable?: boolean
  /** The node answers the quote hash with a different block. */
  substitute?: boolean
}

function n4(change: N4 = {}) {
  const calls: {method: string; params: unknown[]}[] = []
  const transport = custom({request: async ({method, params}: {method: string; params?: unknown}) => {
    const args = (params ?? []) as unknown[]
    calls.push({method, params: args})
    if (method === 'eth_chainId') return '0xa868'
    if (method === 'eth_getBlockByHash') {
      if (args[0] === QUOTE) return change.unknown ? null : block(354n, change.substitute ? SUBSTITUTE : QUOTE, T354)
      if (args[0] === MINED) return block(355n, MINED, T355)
      return null
    }
    if (method === 'eth_getBlockByNumber') {
      // The head is the mined block 355 (epoch 66); 354 (0x162) is the quote block.
      if (args[0] === 'latest' || args[0] === '0x163') return block(355n, MINED, T355)
      if (args[0] === '0x162') return change.heightUnavailable ? null : block(354n, change.reorg ? ORPHAN : QUOTE, T354)
      return null
    }
    if (method !== 'eth_call') throw new Error(`unexpected RPC ${method}`)
    const [call, at] = args as [{to: Hex; data: Hex}, {blockHash?: Hex; requireCanonical?: boolean}]
    const abi: Abi = call.to === deployment.keyRegistry ? keyRegistryAbi : call.to === deployment.beacon ? thresholdRandomBeaconAbi
      : call.to === deployment.verifierSet ? verifierSetRegistryAbi : settlementAbi
    const {functionName: name, args: inputs} = decodeFunctionData({abi, data: call.data})
    if (at.blockHash === QUOTE) {
      if (abi !== thresholdRandomBeaconAbi || name !== 'epoch') throw new Error(`only the beacon epoch is read at the quote block, not ${name}`)
      if (change.pruned) throw Object.assign(new Error('missing trie node'), {code: -32000})
      return encodeFunctionResult({abi, functionName: 'epoch', result: 65n})
    }
    if (at.blockHash !== MINED || at.requireCanonical !== true) throw new Error('a paid observation read must be canonical at the mined head')
    const epoch = typeof inputs?.[0] === 'bigint' ? inputs[0] : 0n
    const values: Record<string, unknown> = {
      prepaidEnabled: true, prepaidCost: 5n, prepaidSettled: false, prepaidRefunded: 0n, prepaidAssignmentBlock: QUOTE,
      randomBeacon: deployment.beacon, beacon: deployment.beacon, epoch: 66n, seedAt: seedOf(epoch), snapshotAt: [rootOf(epoch), 5],
      verifierPolicy: [3, 2], nodeRegistry: h(7, 20),
      getKeySlot: {creator: creator.address, ruleCommitment: h(33), threshold: {k: 2, n: 3}, mode: 0, publicKey: h(34), epoch: 1n,
        committeeVersion: 2n, exists: true, cancelled: false, expiry: 0n, ruleVersion: 1n, auth: 0},
    }
    return encodeFunctionResult({abi, functionName: name, result: values[name]})
  }}, {retryCount: 0})
  const client = createPublicClient({transport})
  vi.spyOn(Date, 'now').mockReturnValue(Number(T355) * 1000 + 400)
  const run = (epoch: number) => readClientExecutionPolicy(client, deployment, paidAt(epoch), intended)
  const epochCalls = () => calls.filter(c => c.method === 'eth_call' && (c.params[0] as {to: Hex}).to === deployment.beacon
    && (c.params[0] as {data: Hex}).data === encodeFunctionData({abi: thresholdRandomBeaconAbi, functionName: 'epoch'}))
  return {calls, run, epochCalls}
}

const failure = (promise: Promise<unknown>): Promise<unknown> => promise.then(() => { throw new Error('expected a refusal') }, (e: unknown) => e)

describe('paid epoch through readClientExecutionPolicy and a fake JSON-RPC node (D8)', () => {
  it('admits n4: quote block epoch 65 selecting 64, observed at 66, read canonically at the quote block', async () => {
    const f = n4()
    const observation = await f.run(64)
    expect(observation).toMatchObject({blockNumber: 355n, blockHash: MINED, blockTimestamp: T355})
    // The quote block is fetched by hash, its epoch read with the exact EIP-1898 canonical
    // parameter, and its height rechecked by number.
    expect(f.calls.filter(c => c.method === 'eth_getBlockByHash').map(c => c.params)).toEqual([[QUOTE, false]])
    const atQuote = f.calls.filter(c => c.method === 'eth_call' && (c.params[1] as {blockHash?: Hex}).blockHash === QUOTE)
    expect(atQuote).toHaveLength(1)
    expect(atQuote[0]!.params[1]).toEqual({blockHash: QUOTE, requireCanonical: true})
    expect((atQuote[0]!.params[0] as {to: Hex}).to.toLowerCase()).toBe(deployment.beacon)
    expect(f.calls.some(c => c.method === 'eth_getBlockByNumber' && c.params[0] === '0x162' && c.params[1] === false)).toBe(true)
    // Three distinct values: the head epoch at the observation, the anchor epoch at the quote
    // block, and never an epoch read at latest or by number.
    expect(f.epochCalls().map(c => c.params[1])).toEqual([{blockHash: MINED, requireCanonical: true}, {blockHash: QUOTE, requireCanonical: true}])
    expect(f.calls.every(c => c.method !== 'eth_call' || [MINED, QUOTE].includes((c.params[1] as {blockHash: Hex}).blockHash))).toBe(true)
    // The quote block's current epoch is equally admissible.
    await expect(n4().run(65)).resolves.toMatchObject({blockNumber: 355n})
  })

  it('refuses 62, 63 and 66 definitely: 66 is the live head but outside the quote window', async () => {
    for (const epoch of [62, 63, 66]) {
      const error = await failure(n4().run(epoch))
      expect(error, `epoch ${epoch}`).toBeInstanceOf(PaidEpochError)
      expect(error).toMatchObject({code: 'paid_epoch_refused', retryable: false})
      expect(isRetryable(error)).toBe(false)
    }
  })

  it('refuses a reorganised quote block definitely', async () => {
    const error = await failure(n4({reorg: true}).run(64))
    expect(error).toBeInstanceOf(PaidEpochError)
    expect(error).toMatchObject({code: 'paid_epoch_refused', retryable: false, message: expect.stringMatching(/not canonical/) as unknown})
  })

  it('refuses a node that substitutes another block for the stored quote hash', async () => {
    const f = n4({substitute: true})
    const error = await failure(f.run(64))
    expect(error).toMatchObject({name: 'PaidEpochError', code: 'paid_epoch_refused', retryable: false})
    // Nothing is read at the substituted block or at the quote block after the mismatch.
    expect(f.calls.filter(c => c.method === 'eth_call' && (c.params[1] as {blockHash: Hex}).blockHash !== MINED)).toHaveLength(0)
  })

  it('pruned state, an unknown quote block or an unserved height is retryable and never falls back to the head', async () => {
    for (const change of [{pruned: true}, {unknown: true}, {heightUnavailable: true}] as N4[]) {
      const f = n4(change)
      const error = await failure(f.run(64))
      expect(error, JSON.stringify(change)).toBeInstanceOf(PaidEpochError)
      expect(error).toMatchObject({code: 'paid_epoch_unavailable', retryable: true})
      expect(isRetryable(error)).toBe(true)
      // Where the quote block is known, the single read there is the exact canonical epoch call, so
      // an assertion thrown inside the fake transport cannot masquerade as unavailable.
      const atQuote = f.calls.filter(c => c.method === 'eth_call' && (c.params[1] as {blockHash?: Hex}).blockHash === QUOTE)
      expect(atQuote.map(c => c.params[1])).toEqual(change.unknown ? [] : [{blockHash: QUOTE, requireCanonical: true}])
      // The head epoch (66) is read once at the observation; no second epoch read anywhere else
      // stands in for the unreadable quote block.
      const epochReads = f.epochCalls().map(c => (c.params[1] as {blockHash: Hex}).blockHash)
      expect(epochReads.filter(hash => hash === MINED)).toHaveLength(1)
      expect(epochReads.every(hash => hash === MINED || hash === QUOTE)).toBe(true)
    }
  })

  it('an unpaid draw keeps the live window at the current head', async () => {
    const chain = {seed: () => Promise.resolve(seedOf(66n)), seedAt: (epoch: bigint) => Promise.resolve(seedOf(epoch))}
    expect((await pinnedDraw(chain, 66)).epoch).toBe(66)
    expect((await pinnedDraw(chain, 66, 1)).epoch).toBe(65)
    // The lag is clamped to one: an unpaid draw never reaches the quote-era epoch 64.
    expect((await pinnedDraw(chain, 66, 5)).epoch).toBe(65)
  })
})
