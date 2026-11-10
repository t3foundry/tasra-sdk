// ADR-0090 allowance debits in ONE process with the REAL voucher round: real BN254 partials from three
// fake accountants (the fixture's 2-of-3 sharing), the real `collectDebitVoucher` (shape checks,
// Lagrange combination, pairing check against `beacon.mpk()` read through the RPC), the real file
// store in a private 0700 directory and the operation journal's lock/check/journal exactly as
// `paidOperation`'s `debit` drives it. Only the allowance reservation transaction is a spy.
//
// `TASRA_THROUGHPUT_PROFILE=<dir>` also writes a CPU profile of the 64-op wave there.
import {afterEach, describe, expect, it, vi} from 'vitest'
import {mkdir, mkdtemp, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Session} from 'node:inspector/promises'
import {Worker} from 'node:worker_threads'
import {performance} from 'node:perf_hooks'
import {bn254} from '@noble/curves/bn254'
import {createPublicClient, custom, decodeFunctionData, defineChain, encodeFunctionResult, toHex, type Abi, type Hex, type PublicClient} from 'viem'

vi.mock('../../src/chain/allowance.js', async original => ({...await original<typeof import('../../src/chain/allowance.js')>(),
  reservePrepaidAllowance: vi.fn(), reconcilePrepaidAllowance: vi.fn()}))

import {paymentIntentTypedData, prepaidRequestId, type PaymentIntentWire} from '../../src/committee/payment.js'
import {prepaidAllowanceId, reservePrepaidAllowance} from '../../src/chain/allowance.js'
import {obtainAllowanceVoucher, reserveForLane, selectAllowanceLane, settleAllowanceVoucherPushes, type AllowanceEnv} from '../../src/app/paid-allowance.js'
import {createFileStore, fileStoreSyncCounters} from '../../src/app/node.js'
import {paidRecordKey} from '../../src/app/paid-keys.js'
import {configurePinnedReads} from '../../src/chain/pinnedReads.js'
import {settlementAbi} from '../../src/chain/abis/settlement.js'
import {thresholdRandomBeaconAbi} from '../../src/chain/abis/thresholdRandomBeacon.js'
import type {PaidOperationContext} from '../../src/chain/prepaid.js'
import {assignment, creator, deployment, groupKey, h} from '../support/allowanceFixture.js'

/** G2 subgroup checks in THIS thread (one per key decode): a key decoded once per check is a cost paid per op. */
const g2Decodes = vi.spyOn(Object.getPrototypeOf(bn254.G2.ProjectivePoint.BASE) as {assertValidity(): void}, 'assertValidity')
const directories: string[] = [], workers: Worker[] = []
afterEach(async () => {
  await settleAllowanceVoucherPushes()
  for (const worker of workers.splice(0)) await worker.terminate()
  for (const directory of directories.splice(0)) await rm(directory, {recursive: true, force: true})
})

const seconds = () => Math.floor(Date.now() / 1000)
const random32 = () => toHex(globalThis.crypto.getRandomValues(new Uint8Array(32)))
const slots = (n: number) => Array.from({length: n}, (_, i) => h(0x30 + i))
const localChain = defineChain({id: 43112, name: 'local', nativeCurrency: {name: 'AVAX', symbol: 'AVAX', decimals: 18}, rpcUrls: {default: {http: ['http://127.0.0.1:1']}}})
/** One fake network round trip (accountant HTTP, RPC). */
const LATENCY_MS = 5

function contextFor(slot: Hex): PaidOperationContext {
  return {blockNumber: 20n, blockHash: h(20), blockTimestamp: BigInt(seconds()), creator: creator.address, mode: 1, groupPublicKey: h(40),
    coordinator: {operator: h(11, 20), publicKey: h(10), url: 'http://127.0.0.1:4001'}, contributors: [], available: 10_000_000n,
    intentFields: {chain_id: 43112, settlement: deployment.settlement, key_registry: deployment.keyRegistry, slot, verification_epoch: 8, verification_seed: h(0x34),
      verification_root: h(0x35), verification_registry_size: 5, verification_committee: 3, verification_quorum: 2,
      keeper_assignment: {...structuredClone(assignment), coordinator: Array<number>(32).fill(10)}}}
}

const later = <T>(value: () => T): Promise<T> => new Promise(resolve => setTimeout(() => resolve(value()), LATENCY_MS))

/** A chain whose head moves every second (a fresh quote block, so a fresh group-key read, per second) and serves Settlement.beacon / beacon.mpk. */
function chain(): PublicClient {
  const head = () => { const t = seconds(); return {number: toHex(t), hash: toHex(BigInt(t), {size: 32}), timestamp: toHex(t), transactions: []} }
  const respond = ({method, params}: {method: string; params?: unknown}): unknown => {
    if (method === 'eth_chainId') return toHex(43112)
    if (method === 'eth_getBlockByNumber' || method === 'eth_getBlockByHash') return head()
    if (method === 'eth_call') {
      const [call] = params as [{to: Hex; data: Hex}]
      const abi: Abi = call.to.toLowerCase() === deployment.beacon ? thresholdRandomBeaconAbi : settlementAbi
      const {functionName} = decodeFunctionData({abi, data: call.data})
      const values: Record<string, unknown> = {beacon: deployment.beacon, mpk: groupKey}
      if (!(functionName in values)) throw new Error(`unexpected call ${functionName}`)
      return encodeFunctionResult({abi, functionName, result: values[functionName]})
    }
    throw new Error(`unexpected RPC ${method}`)
  }
  const client = createPublicClient({chain: localChain, transport: custom({request: (r: {method: string; params?: unknown}) => later(() => respond(r))}, {retryCount: 0})}) as PublicClient
  configurePinnedReads(client, false)
  return client
}

/** The three fake accountants (real BN254 partials) in a worker thread, so their signing is not on the measured event loop. */
async function accountants(): Promise<string[]> {
  const worker = new Worker(new URL('../support/allowanceAccountantsWorker.ts', import.meta.url), {execArgv: ['--import', 'tsx'],
    workerData: {settlement: deployment.settlement, latencyMs: LATENCY_MS}})
  workers.push(worker)
  const {ports} = await new Promise<{ports: number[]}>((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject) })
  return ports.map(port => `http://127.0.0.1:${port}`)
}

async function world(slotIds: readonly Hex[], lanes: number) {
  const accountantUrls = await accountants()
  const directory = await mkdtemp(join(tmpdir(), 'tasra-allowance-throughput-')); directories.push(directory)
  expect((await stat(directory)).mode & 0o777).toBe(0o700)
  const store = createFileStore(directory)
  const env: AllowanceEnv = {client: chain(), deployment, creator, store, accountantUrls, allowLocalHttp: true,
    gasPayer: {account: creator, chain: {id: 43112}} as unknown as AllowanceEnv['gasPayer'], limits: {maxCost: 100n, maxGas: 200_000n, maxGasPrice: 50n},
    options: {enabled: true, amount: 100_000n, reserveAhead: false, lanes}}
  let nonce = 4
  vi.mocked(reservePrepaidAllowance).mockImplementation(async (_client, _wallet, _d, intent, options) => {
    const id = prepaidAllowanceId(intent), at = BigInt(seconds())
    const record = {schema: 1 as const, allowanceId: id, intent, quote: {} as never, transaction: {chainId: 43112, from: creator.address, to: deployment.settlement,
      data: '0x' as Hex, value: '0' as const, nonce: nonce++, gas: '1', gasPrice: '1'}}
    await options.persist({phase: 'prepared', record})
    await options.persist({phase: 'confirmed', allowanceId: id, transactionHash: h(77), blockHash: h(20)})
    return {transactionHash: h(77), quote: {} as never, allowance: {allowanceId: id, slotId: intent.slot, assignmentBlock: h(19), amount: BigInt(intent.amount), spent: 0n,
      maxOpCost: BigInt(intent.max_op_cost), expiresAt: BigInt(intent.expires_at), reservedAt: at, actions: intent.actions, closed: false,
      blockNumber: 20n, blockHash: h(20), blockTimestamp: at}}
  })
  for (const slot of slotIds) for (let lane = 0; lane < lanes; lane++) expect(await reserveForLane(env, contextFor(slot), lane)).toBe('reserved')
  return {env}
}

/** One paid operation's allowance path as `paidOperation` drives it (select, sign, journal `reserving`, debit under the journal's lock, journal `reserved`). */
async function operate(env: AllowanceEnv, slot: Hex) {
  const ticket = await selectAllowanceLane(env, contextFor(slot), {action: 'decrypt', expires: seconds() + 600})
  if (!ticket) throw new Error('no lane')
  const unsigned = {...ticket.fields, action: 'decrypt' as const, payload_digest: h(0x26), session_commitment: h(0x27), nonce: random32(), max_cost: '100',
    expires: seconds() + 600, allowance_id: ticket.allowanceId}
  const p: PaymentIntentWire = {...unsigned, signature: await creator.signTypedData(paymentIntentTypedData(unsigned))}
  const key = paidRecordKey(prepaidRequestId(p))
  await env.store.save(key, {schema: 1, phase: 'reserving', payment: p})
  return obtainAllowanceVoucher(env, {lane: ticket.lane}, p, undefined, {lock: [key], check: async () => { await env.store.load(key) },
    journal: v => [[key, {schema: 1, phase: 'reserved', payment: {...p, debit_voucher: v}}]]})
}

async function wave(env: AllowanceEnv, ids: readonly Hex[], n: number) {
  const syncs = {...fileStoreSyncCounters}, elu = performance.eventLoopUtilization(), decodes = g2Decodes.mock.calls.length, started = performance.now()
  const vouchers = await Promise.all(Array.from({length: n}, (_, i) => operate(env, ids[i % ids.length]!)))
  const wall = performance.now() - started, busy = performance.eventLoopUtilization(elu).active
  const per = (k: keyof typeof syncs) => (fileStoreSyncCounters[k] - syncs[k]) / n
  return {vouchers, wall, busyPerOp: busy / n, g2Decodes: g2Decodes.mock.calls.length - decodes, syncsPerOp: {barriers: per('barriers'), directorySyncs: per('directorySyncs'), fileSyncs: per('fileSyncs')}}
}

async function profiled<T>(name: string, run: () => Promise<T>): Promise<T> {
  const dir = process.env.TASRA_THROUGHPUT_PROFILE
  if (!dir) return run()
  const session = new Session()
  session.connect()
  await session.post('Profiler.enable')
  await session.post('Profiler.setSamplingInterval', {interval: 200})
  await session.post('Profiler.start')
  try { return await run() } finally {
    const {profile} = await session.post('Profiler.stop')
    await mkdir(dir, {recursive: true, mode: 0o700})
    await writeFile(join(dir, `${name}.cpuprofile`), JSON.stringify(profile), {mode: 0o600})
    session.disconnect()
  }
}

describe('allowance debits with the real voucher round in one process (file store, real BN254)', () => {
  it('64 concurrent debits on 8 slots x 8 lanes overlap, and the group key is decoded once, not once per voucher', async () => {
    const ids = slots(8), lanes = 8
    const {env} = await world(ids, lanes)
    const one = await wave(env, ids, 1)
    expect(one.vouchers[0]!.seq).toBe(1)
    const many = await profiled('debits-64', () => wave(env, ids, 64))
    expect(new Set(many.vouchers.map(v => v.allowance_id)).size).toBe(64)
    process.stderr.write(`[throughput] 1 op: ${one.wall.toFixed(0)} ms wall, ${one.busyPerOp.toFixed(1)} ms busy; 64 ops: ${many.wall.toFixed(0)} ms wall, `
      + `${many.busyPerOp.toFixed(1)} ms event-loop busy/op, ${many.g2Decodes} G2 subgroup checks; syncs/op ${JSON.stringify(many.syncsPerOp)}\n`)
    // Each voucher costs one pairing check against the group key. The key itself (subgroup-checked
    // decode + pairing line precomputation, about a third of that check) is paid once per key: the
    // only G2 subgroup checks left per voucher are the pairing's own two (memoized on the cached
    // points). Decoding the key per voucher made it three per voucher.
    expect(many.g2Decodes).toBeLessThanOrEqual(2 * 64)
    // Rounds overlap: 64 rounds serialized on one lane, or CPU-bound one after another at the old
    // per-voucher cost, take several seconds; overlapped they take about one second.
    expect(many.wall).toBeLessThan(5_000)
  }, 120_000)
})
