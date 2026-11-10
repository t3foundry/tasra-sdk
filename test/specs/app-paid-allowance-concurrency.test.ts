// ADR-0090 allowance lanes under concurrency in ONE process, on the real file store (a private 0700
// temporary directory): operations that select at the same time spread over the slots' lanes and
// their voucher rounds overlap (wall time about one round, not one round per operation), while two
// debits of one lane stay strictly ordered (seq n then n + 1, each chained on the previous voucher).
// The accountant round is a spy with a fixed delay; the reservation transaction is a spy too.
import {afterEach, describe, expect, it, vi} from 'vitest'
import {mkdtemp, rm, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {toHex, type Hex, type PublicClient} from 'viem'

vi.mock('../../src/chain/allowance.js', async original => ({...await original<typeof import('../../src/chain/allowance.js')>(),
  collectDebitVoucher: vi.fn(), reservePrepaidAllowance: vi.fn(), reconcilePrepaidAllowance: vi.fn(), pushDebitVoucher: vi.fn(async () => [])}))

import {collectDebitVoucher, prepaidAllowanceId, reservePrepaidAllowance, type DebitRequest} from '../../src/chain/allowance.js'
import {inspectAllowanceLanes, obtainAllowanceVoucher, reserveForLane, selectAllowanceLane, settleAllowanceVoucherPushes, type AllowanceEnv} from '../../src/app/paid-allowance.js'
import {createFileStore} from '../../src/app/node.js'
import {paidRecordKey} from '../../src/app/paid-keys.js'
import {paymentIntentTypedData, prepaidRequestId, type DebitVoucherWire, type PaymentIntentWire} from '../../src/committee/payment.js'
import type {PaidOperationContext} from '../../src/chain/prepaid.js'
import {assignment, creator, deployment, h} from '../support/allowanceFixture.js'

const directories: string[] = []
afterEach(async () => {
  await settleAllowanceVoucherPushes()
  for (const directory of directories.splice(0)) await rm(directory, {recursive: true, force: true})
  vi.mocked(collectDebitVoucher).mockReset()
})

const seconds = () => Math.floor(Date.now() / 1000)
const random32 = () => toHex(globalThis.crypto.getRandomValues(new Uint8Array(32)))
const slots = (n: number) => Array.from({length: n}, (_, i) => h(0x30 + i))

function contextFor(slot: Hex): PaidOperationContext {
  return {blockNumber: 20n, blockHash: h(20), blockTimestamp: BigInt(seconds()), creator: creator.address, mode: 1, groupPublicKey: h(40),
    coordinator: {operator: h(11, 20), publicKey: h(10), url: 'http://127.0.0.1:4001'}, contributors: [], available: 10_000_000n,
    intentFields: {chain_id: 43112, settlement: deployment.settlement, key_registry: deployment.keyRegistry, slot, verification_epoch: 8, verification_seed: h(0x34),
      verification_root: h(0x35), verification_registry_size: 5, verification_committee: 3, verification_quorum: 2,
      keeper_assignment: {...structuredClone(assignment), coordinator: Array<number>(32).fill(10)}}}
}

/** A file-store allowance environment with `lanes` lanes reserved (confirmed) on each slot. */
async function world(slotIds: readonly Hex[], lanes: number) {
  const directory = await mkdtemp(join(tmpdir(), 'tasra-allowance-concurrency-')); directories.push(directory)
  expect((await stat(directory)).mode & 0o777).toBe(0o700)
  const store = createFileStore(directory)
  const client = {getBlock: vi.fn(async () => ({hash: h(0x70), number: 20n, timestamp: BigInt(seconds())}))} as unknown as PublicClient
  const env: AllowanceEnv = {client, deployment, creator, store, accountantUrls: ['https://acct0.example', 'https://acct1.example', 'https://acct2.example'],
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
  return {env, store}
}

async function payment(slot: Hex, allowance: Hex): Promise<PaymentIntentWire> {
  const ticket = {chain_id: 43112, settlement: deployment.settlement, key_registry: deployment.keyRegistry, slot, action: 'decrypt' as const, payload_digest: h(0x26),
    session_commitment: h(0x27), nonce: random32(), max_cost: '100', expires: seconds() + 600, verification_epoch: 8, verification_seed: h(0x34), verification_root: h(0x35),
    verification_registry_size: 5, verification_committee: 3, verification_quorum: 2, keeper_assignment: structuredClone(assignment), allowance_id: allowance}
  return {...ticket, signature: await creator.signTypedData(paymentIntentTypedData(ticket))}
}
const voucherOf = (request: DebitRequest): DebitVoucherWire => ({allowance_id: request.payment.allowance_id!, seq: request.seq, request_id: prepaidRequestId(request.payment),
  cost: '40', cumulative: String(BigInt(request.previous?.cumulative ?? '0') + 40n), quote_block: h(0x70), signature: h(5, 64)})

/**
 * One paid operation's allowance path as paidOperation drives it: select a lane, sign the payment on
 * it, journal the operation `reserving`, then the debit round under the lane and record locks with
 * `reserved` journaled with the voucher.
 */
async function operate(env: AllowanceEnv, slot: Hex) {
  const ticket = await selectAllowanceLane(env, contextFor(slot), {action: 'decrypt', expires: seconds() + 600})
  expect(ticket).toBeDefined()
  const p = await payment(slot, ticket!.allowanceId), key = paidRecordKey(prepaidRequestId(p))
  await env.store.save(key, {schema: 1, phase: 'reserving', payment: p})
  const voucher = await obtainAllowanceVoucher(env, {lane: ticket!.lane}, p, undefined,
    {lock: [key], check: async () => {}, journal: v => [[key, {schema: 1, phase: 'reserved', payment: {...p, debit_voucher: v}}]]})
  return {slot, lane: ticket!.lane, voucher}
}

describe('allowance lanes under concurrency in one process (file store)', () => {
  it('operations selecting at once spread over every lane of their slots, and their voucher rounds all overlap', async () => {
    const ids = slots(2), lanes = 8, n = ids.length * lanes
    const {env} = await world(ids, lanes)
    // Each round holds until every operation's round is in flight (bounded): overlapping rounds pass
    // at once; rounds serialized behind one lane lock would wait out the bound one after another.
    let inFlight = 0, most = 0
    let release!: () => void
    const all = new Promise<void>(resolve => { release = resolve })
    vi.mocked(collectDebitVoucher).mockImplementation(async (_client, _d, request) => {
      most = Math.max(most, ++inFlight)
      if (inFlight === n) release()
      await Promise.race([all, new Promise(resolve => setTimeout(resolve, 3_000))])
      inFlight--
      return {voucher: voucherOf(request), partials: [], outcomes: []}
    })
    const done = await Promise.all(Array.from({length: n}, (_, i) => operate(env, ids[i % ids.length]!)))
    expect(new Set(done.map(d => `${d.slot}:${d.lane}`)).size).toBe(n)
    expect(most).toBe(n)
    expect(done.every(d => d.voucher.seq === 1 && d.voucher.cumulative === '40')).toBe(true)
  }, 60_000)

  it('takes about one accountant round of wall time for N concurrent debits on N lanes, not N rounds', async () => {
    const ids = slots(2), lanes = 8, n = ids.length * lanes, delay = 200
    const {env} = await world(ids, lanes)
    let wait = 0
    vi.mocked(collectDebitVoucher).mockImplementation(async (_client, _d, request) => {
      await new Promise(resolve => setTimeout(resolve, wait))
      return {voucher: voucherOf(request), partials: [], outcomes: []}
    })
    const wave = async () => {
      const started = performance.now()
      const done = await Promise.all(Array.from({length: n}, (_, i) => operate(env, ids[i % ids.length]!)))
      expect(new Set(done.map(d => `${d.slot}:${d.lane}`)).size).toBe(n)
      return performance.now() - started
    }
    // The same wave with an instant round measures the store's own cost on this machine right now.
    const store = await wave()
    wait = delay
    const wall = await wave()
    // About one round on top of the store's journal writes. Before the fix every slot's 8 operations
    // took ONE lane and ran their 8 rounds back to back: at least 8 x delay more than the store.
    expect(wall - store).toBeLessThan(4 * delay)
  }, 60_000)

  it('two concurrent debits on the SAME lane are strictly ordered: seq n then n + 1, each round chained on the previous voucher', async () => {
    const [slot] = slots(1)
    const {env, store} = await world([slot!], 1)
    const [lane] = await inspectAllowanceLanes(store, deployment, slot!, 1)
    const allowance = lane!.allowanceId!
    const seen: DebitRequest[] = []
    let inFlight = 0, most = 0
    vi.mocked(collectDebitVoucher).mockImplementation(async (_client, _d, request) => {
      most = Math.max(most, ++inFlight)
      seen.push(structuredClone(request))
      await new Promise(resolve => setTimeout(resolve, 30))
      inFlight--
      return {voucher: voucherOf(request), partials: [], outcomes: []}
    })
    // Both selections share the only lane (a claimed lane is still taken when nothing else fits).
    const tickets = await Promise.all([0, 1].map(() => selectAllowanceLane(env, contextFor(slot!), {action: 'decrypt', expires: seconds() + 600})))
    expect(tickets.map(t => t?.lane)).toEqual([0, 0])
    const [a, b] = await Promise.all([payment(slot!, allowance), payment(slot!, allowance)])
    const [va, vb] = await Promise.all([obtainAllowanceVoucher(env, {lane: 0}, a), obtainAllowanceVoucher(env, {lane: 0}, b)])
    expect(most).toBe(1)
    expect(seen.map(r => r.seq)).toEqual([1, 2])
    expect(seen[0]!.previous).toBeUndefined()
    expect(seen[1]!.previous).toEqual(va)
    expect([va.seq, vb.seq]).toEqual([1, 2])
    expect(BigInt(vb.cumulative)).toBeGreaterThan(BigInt(va.cumulative))
    const [after] = await inspectAllowanceLanes(store, deployment, slot!, 1)
    expect(after).toMatchObject({seq: 2})
  }, 60_000)
})
