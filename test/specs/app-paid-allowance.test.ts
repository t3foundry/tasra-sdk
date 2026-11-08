// ADR-0090 allowance lanes: reservation into a lane under the payer claim, lane selection, the
// lane journal written before a voucher is requested (crash/resume reuses seq, request and quote
// block), completion of another request's pending debit, refusal (lane retired) versus
// unavailability (pending kept), and concurrency across lanes. The network round itself
// (collectDebitVoucher) and the reservation transaction are replaced by spies here; their wire
// behaviour has its own suite (chain.allowance.test.ts).
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {recoverTypedDataAddress, type Hex, type PublicClient} from 'viem'

vi.mock('../../src/chain/allowance.js', async original => ({...await original<typeof import('../../src/chain/allowance.js')>(),
  collectDebitVoucher: vi.fn(), reservePrepaidAllowance: vi.fn(), reconcilePrepaidAllowance: vi.fn(), pushDebitVoucher: vi.fn()}))

import {collectDebitVoucher, DebitVoucherError, prepaidAllowanceId, pushDebitVoucher, reconcilePrepaidAllowance, reservePrepaidAllowance, type DebitPartialWire} from '../../src/chain/allowance.js'
import {PaidReservationUncertainError} from '../../src/chain/reservation.js'
import {AllowanceRefusedError, AllowanceUnavailableError, inspectAllowanceLanes, journaledAllowanceVoucher, obtainAllowanceVoucher, reserveForLane,
  selectAllowanceLane, settleAllowanceRefills, settleAllowanceVoucherPushes, inspectAllowanceVoucherPush, allowanceLaneCount, validateAllowanceOptions, type AllowanceEnv} from '../../src/app/paid-allowance.js'
import {createMemoryStore} from '../../src/app/memory-store.js'
import {paidRecordKey} from '../../src/app/paid-keys.js'
import {paymentIntentTypedData, prepaidAllowanceIntentTypedData, prepaidRequestId, type DebitVoucherWire, type PaymentIntentWire} from '../../src/committee/payment.js'
import type {PaidOperationContext} from '../../src/chain/prepaid.js'
import {attachHeadFollower, createHeadFollower, unfollowHeads} from '../../src/chain/headFollower.js'
import {assignment, creator, deployment, h, NOW, slot} from '../support/allowanceFixture.js'

let clock = NOW
beforeEach(() => { clock = NOW; vi.spyOn(Date, 'now').mockImplementation(() => clock * 1000); vi.mocked(collectDebitVoucher).mockReset(); vi.mocked(reservePrepaidAllowance).mockReset(); vi.mocked(pushDebitVoucher).mockReset() })
afterEach(async () => { await settleAllowanceVoucherPushes(); vi.restoreAllMocks() })

const context = (over: Partial<PaidOperationContext['intentFields']['keeper_assignment']> = {}): PaidOperationContext => ({blockNumber: 20n, blockHash: h(20), blockTimestamp: BigInt(NOW),
  creator: creator.address, mode: 1, groupPublicKey: h(40), coordinator: {operator: h(11, 20), publicKey: h(10), url: 'http://127.0.0.1:4001'}, contributors: [], available: 10_000n,
  intentFields: {chain_id: 43112, settlement: deployment.settlement, key_registry: deployment.keyRegistry, slot, verification_epoch: 8, verification_seed: h(0x34),
    verification_root: h(0x35), verification_registry_size: 5, verification_committee: 3, verification_quorum: 2,
    keeper_assignment: {...structuredClone(assignment), coordinator: Array<number>(32).fill(10), ...over}}})

function environment(options: Partial<AllowanceEnv['options']> = {}) {
  const store = createMemoryStore()
  let head = 0
  const client = {getBlock: vi.fn(async () => ({hash: h(0x70 + (head++ % 8)), number: 20n, timestamp: BigInt(clock)}))} as unknown as PublicClient
  const env: AllowanceEnv = {client, deployment, creator, store, accountantUrls: ['https://acct0.example', 'https://acct1.example', 'https://acct2.example'],
    gasPayer: {account: creator, chain: {id: 43112}} as unknown as AllowanceEnv['gasPayer'], limits: {maxCost: 100n, maxGas: 200_000n, maxGasPrice: 50n},
    options: {enabled: true, amount: 1000n, reserveAhead: false, ...options}}
  return {env, store, client}
}

/** reservePrepaidAllowance spy: journals the three checkpoints like the real one, then returns the mined record. */
function reservationMinesAs(assignmentBlock: Hex = h(19)) {
  let nonce = 4
  vi.mocked(reservePrepaidAllowance).mockImplementation(async (_client, _wallet, _d, intent, options) => {
    const id = prepaidAllowanceId(intent)
    const record = {schema: 1 as const, allowanceId: id, intent, quote: {} as never, transaction: {chainId: 43112, from: creator.address, to: deployment.settlement, data: '0x' as Hex,
      value: '0' as const, nonce: nonce++, gas: '1', gasPrice: '1'}}
    await options.persist({phase: 'prepared', record})
    await options.persist({phase: 'submitted', allowanceId: id, transactionHash: h(77)})
    await options.persist({phase: 'confirmed', allowanceId: id, transactionHash: h(77), blockHash: h(20)})
    return {transactionHash: h(77), quote: {} as never, allowance: {allowanceId: id, slotId: slot, assignmentBlock, amount: BigInt(intent.amount), spent: 0n,
      maxOpCost: BigInt(intent.max_op_cost), expiresAt: BigInt(intent.expires_at), reservedAt: BigInt(NOW), actions: intent.actions, closed: false,
      blockNumber: 20n, blockHash: h(20), blockTimestamp: BigInt(NOW)}}
  })
}

async function payment(allowance: Hex, nonce: number, over: Partial<PaymentIntentWire> = {}): Promise<PaymentIntentWire> {
  const ticket = {chain_id: 43112, settlement: deployment.settlement, key_registry: deployment.keyRegistry, slot, action: 'decrypt' as const, payload_digest: h(0x26),
    session_commitment: h(0x27), nonce: h(nonce), max_cost: '100', expires: NOW + 600, verification_epoch: 8, verification_seed: h(0x34), verification_root: h(0x35),
    verification_registry_size: 5, verification_committee: 3, verification_quorum: 2, keeper_assignment: structuredClone(assignment), allowance_id: allowance, ...over}
  return {...ticket, signature: await creator.signTypedData(paymentIntentTypedData(ticket))}
}
const voucherFor = (p: PaymentIntentWire, seq: number, cumulative: number): DebitVoucherWire =>
  ({allowance_id: p.allowance_id!, seq, request_id: prepaidRequestId(p), cost: '40', cumulative: String(cumulative), quote_block: h(0x70), signature: h(5, 64)})
const partial = (p: PaymentIntentWire, identifier: number) => ({identifier, allowance_id: p.allowance_id!}) as unknown as DebitPartialWire
/** Mark the paid operation of `p` as still reserving, as paidOperation journals it. */
const reserving = (store: ReturnType<typeof createMemoryStore>, p: PaymentIntentWire) => store.save(paidRecordKey(prepaidRequestId(p)), {schema: 1, phase: 'reserving', payment: p})

async function seeded(options: Partial<AllowanceEnv['options']> = {}) {
  const world = environment(options)
  reservationMinesAs()
  expect(await reserveForLane(world.env, context(), 0)).toBe('reserved')
  const [lane] = await inspectAllowanceLanes(world.store, deployment, slot, 1)
  return {...world, allowance: lane!.allowanceId!}
}

describe('allowance options', () => {
  it('are explicit, bounded and default to min(streams, 8) lanes', () => {
    expect(() => validateAllowanceOptions({enabled: false, amount: 1n}, {maxCost: 1n})).toThrow(/explicit/)
    expect(() => validateAllowanceOptions({enabled: true, amount: 50n}, {maxCost: 100n})).toThrow(/cover/)
    expect(() => validateAllowanceOptions({enabled: true, amount: 500n, lifetimeSecs: 3601}, {maxCost: 100n})).toThrow(/lifetime/)
    expect(() => validateAllowanceOptions({enabled: true, amount: 500n, lanes: 9}, {maxCost: 100n})).toThrow(/lanes/)
    expect(allowanceLaneCount({enabled: true, amount: 1n})).toBe(1)
    expect(allowanceLaneCount({enabled: true, amount: 1n, streams: 32})).toBe(8)
    expect(allowanceLaneCount({enabled: true, amount: 1n, streams: 3})).toBe(3)
  })
})

describe('allowance lanes', () => {
  it('reserves into a lane under the durable payer claim and signs the intent as the creator', async () => {
    const {store, allowance} = await seeded()
    const [lane] = await inspectAllowanceLanes(store, deployment, slot, 1)
    expect(lane).toMatchObject({phase: 'confirmed', seq: 0, cumulative: '0', amount: '1000'})
    const intent = vi.mocked(reservePrepaidAllowance).mock.calls[0]![3]
    expect(prepaidAllowanceId(intent)).toBe(allowance)
    expect(await recoverTypedDataAddress({...prepaidAllowanceIntentTypedData(intent), signature: intent.signature})).toBe(creator.address)
    expect(intent).toMatchObject({verification_epoch: 8, actions: 79, max_op_cost: '100', expires_at: NOW + 3600})
    // The claimed nonce was released by the confirmed reservation (the floor moved past it).
    expect(await store.load(`prepaid-payer-43112-${creator.address.toLowerCase()}`)).toEqual({schema: 1, chainId: 43112, payer: creator.address, nextNonce: 5})
  })

  it('selects a lane with room and hands out the allowance verification fields with the current coordinator', async () => {
    const {env, allowance} = await seeded()
    const ticket = await selectAllowanceLane(env, context(), {action: 'decrypt', expires: NOW + 600})
    expect(ticket).toMatchObject({lane: 0, allowanceId: allowance})
    expect(ticket!.fields.verification_epoch).toBe(8)
    expect(ticket!.fields.keeper_assignment.coordinator).toEqual(Array<number>(32).fill(10))
    // An unfunded action, an operation outliving the allowance and a changed sharing all fall back.
    const narrow = await seeded({actions: ['sign']})
    expect(await selectAllowanceLane(narrow.env, context(), {action: 'decrypt', expires: NOW + 600})).toBeUndefined()
    expect(await selectAllowanceLane(env, context(), {action: 'decrypt', expires: NOW + 3590})).toBeUndefined()
    expect(await selectAllowanceLane(env, context({committee_version: 3}), {action: 'decrypt', expires: NOW + 600})).toBeUndefined()
    // No lane reserved at all: fall back (and, with reserveAhead, start one in the background).
    expect(await selectAllowanceLane(environment().env, context(), {action: 'decrypt', expires: NOW + 600})).toBeUndefined()
  })

  it('journals the debit BEFORE requesting a voucher; a resume after a crash asks for the same seq, request and quote block', async () => {
    const {env, store, allowance} = await seeded()
    const p = await payment(allowance, 0x41)
    await reserving(store, p)
    let observed: {pending?: {seq: number; requestId: Hex; partials: number}} | undefined
    vi.mocked(collectDebitVoucher).mockImplementationOnce(async () => {
      // The round starts only after the lane journal names this seq and request.
      ;[observed] = await inspectAllowanceLanes(store, deployment, slot, 1)
      throw new DebitVoucherError([{url: 'https://acct0.example', kind: 'partial', partial: partial(p, 1)}, {url: 'https://acct1.example', kind: 'unavailable', reason: 'down'},
        {url: 'https://acct2.example', kind: 'unavailable', reason: 'down'}], 1, 2)
    })
    await expect(obtainAllowanceVoucher(env, {lane: 0}, p)).rejects.toBeInstanceOf(AllowanceUnavailableError)
    expect(observed?.pending).toEqual({seq: 1, requestId: prepaidRequestId(p), partials: 0})
    const [after] = await inspectAllowanceLanes(store, deployment, slot, 1)
    expect(after?.pending).toEqual({seq: 1, requestId: prepaidRequestId(p), partials: 1})
    // "Restart": a later call (fresh process state) resumes the same journaled debit.
    clock += 25
    vi.mocked(collectDebitVoucher).mockResolvedValueOnce({voucher: voucherFor(p, 1, 40), partials: [], outcomes: []})
    expect(await obtainAllowanceVoucher(env, {lane: 0}, p)).toEqual(voucherFor(p, 1, 40))
    const [first, second] = vi.mocked(collectDebitVoucher).mock.calls
    expect(second![2]).toEqual(first![2])
    expect(second![2]).toMatchObject({seq: 1, quoteBlock: first![2].quoteBlock, previous: undefined})
    expect(second![3].known).toEqual([partial(p, 1)])
    expect(await journaledAllowanceVoucher(store, prepaidRequestId(p))).toEqual(voucherFor(p, 1, 40))
    const [done] = await inspectAllowanceLanes(store, deployment, slot, 1)
    expect(done).toMatchObject({seq: 1, cumulative: '40'})
    expect(done?.pending).toBeUndefined()
    // Asking again returns the journaled voucher without a new round.
    expect(await obtainAllowanceVoucher(env, {lane: 0}, p)).toEqual(voucherFor(p, 1, 40))
    expect(collectDebitVoucher).toHaveBeenCalledTimes(2)
  })

  it('chains the next seq on the previous voucher and completes another request\'s pending debit first', async () => {
    const {env, store, allowance} = await seeded()
    const a = await payment(allowance, 0x41), b = await payment(allowance, 0x42)
    await reserving(store, a)
    vi.mocked(collectDebitVoucher).mockRejectedValueOnce(new DebitVoucherError([{url: 'https://acct0.example', kind: 'unavailable', reason: 'down'}], 0, undefined))
    await expect(obtainAllowanceVoucher(env, {lane: 0}, a)).rejects.toBeInstanceOf(AllowanceUnavailableError)
    vi.mocked(collectDebitVoucher).mockResolvedValueOnce({voucher: voucherFor(a, 1, 40), partials: [], outcomes: []})
      .mockResolvedValueOnce({voucher: voucherFor(b, 2, 80), partials: [], outcomes: []})
    expect(await obtainAllowanceVoucher(env, {lane: 0}, b)).toEqual(voucherFor(b, 2, 80))
    const calls = vi.mocked(collectDebitVoucher).mock.calls.map(c => c[2])
    expect(calls[1]).toMatchObject({seq: 1, payment: a})
    expect(calls[2]).toMatchObject({seq: 2, payment: b, previous: voucherFor(a, 1, 40)})
    expect(await journaledAllowanceVoucher(store, prepaidRequestId(a))).toEqual(voucherFor(a, 1, 40))
  })

  it('a definite refusal retires the lane; a pending debit of an abandoned operation retires it too', async () => {
    const {env, store, allowance} = await seeded()
    const a = await payment(allowance, 0x41)
    vi.mocked(collectDebitVoucher).mockRejectedValueOnce(new DebitVoucherError([{url: 'https://acct0.example', kind: 'refused', status: 402, reason: 'exceeds'},
      {url: 'https://acct1.example', kind: 'refused', status: 402, reason: 'exceeds'}], 0, 2))
    await expect(obtainAllowanceVoucher(env, {lane: 0}, a)).rejects.toBeInstanceOf(AllowanceRefusedError)
    expect(await inspectAllowanceLanes(store, deployment, slot, 1)).toEqual([{lane: 0, retired: 1}])
    await expect(obtainAllowanceVoucher(env, {lane: 0}, a)).rejects.toThrow(/no longer holds/)

    const again = await seeded()
    const x = await payment(again.allowance, 0x51), y = await payment(again.allowance, 0x52)
    vi.mocked(collectDebitVoucher).mockRejectedValueOnce(new DebitVoucherError([{url: 'https://acct0.example', kind: 'unavailable', reason: 'down'}], 0, undefined))
    await expect(obtainAllowanceVoucher(again.env, {lane: 0}, x)).rejects.toBeInstanceOf(AllowanceUnavailableError)
    // x's operation journal is not `reserving` (never written here): its claim on seq 1 can never complete.
    await expect(obtainAllowanceVoucher(again.env, {lane: 0}, y)).rejects.toThrow(/abandoned or expired/)
    expect((await inspectAllowanceLanes(again.store, deployment, slot, 1))[0]).toEqual({lane: 0, retired: 1})
  })

  it('runs voucher rounds of different lanes concurrently and serializes rounds on one lane', async () => {
    const world = environment({lanes: 2})
    reservationMinesAs()
    expect(await reserveForLane(world.env, context(), 0)).toBe('reserved')
    expect(await reserveForLane(world.env, context(), 1)).toBe('reserved')
    const lanes = await inspectAllowanceLanes(world.store, deployment, slot, 2)
    const [l0, l1] = [lanes[0]!.allowanceId!, lanes[1]!.allowanceId!]
    expect(l0).not.toBe(l1)
    let inFlight = 0, most = 0
    const release: (() => void)[] = []
    vi.mocked(collectDebitVoucher).mockImplementation(async (_c, _d, request) => {
      most = Math.max(most, ++inFlight)
      await new Promise<void>(resolve => release.push(resolve))
      inFlight--
      return {voucher: voucherFor(request.payment, request.seq, request.seq * 40), partials: [], outcomes: []}
    })
    const a = await payment(l0, 0x41), b = await payment(l1, 0x42), c = await payment(l0, 0x43)
    const runs = [obtainAllowanceVoucher(world.env, {lane: 0}, a), obtainAllowanceVoucher(world.env, {lane: 1}, b), obtainAllowanceVoucher(world.env, {lane: 0}, c)]
    await vi.waitFor(() => expect(release).toHaveLength(2))
    expect(most).toBe(2) // lanes 0 and 1 in flight; c waits behind a on lane 0
    release.splice(0).forEach(r => r())
    await vi.waitFor(() => expect(release).toHaveLength(1))
    release.splice(0).forEach(r => r())
    const [va, vb, vc] = await Promise.all(runs)
    expect([va!.seq, vb!.seq, vc!.seq]).toEqual([1, 1, 2])
    expect(vc!.cumulative).toBe('80')
  })
})

describe('reserve ahead and replacement', () => {
  it('reserves a replacement in the background when the remainder falls below 25 % and swaps it in when the current cannot fund an operation', async () => {
    const world = environment({reserveAhead: true})
    reservationMinesAs()
    expect(await reserveForLane(world.env, context(), 0)).toBe('reserved')
    const first = (await inspectAllowanceLanes(world.store, deployment, slot, 1))[0]!.allowanceId!
    // Debit 800 of 1000: 200 left is below a quarter but still funds one 100-unit operation.
    vi.mocked(collectDebitVoucher).mockImplementation(async (_c, _d, r) => ({voucher: {...voucherFor(r.payment, r.seq, r.seq * 400), cost: '400'}, partials: [], outcomes: []}))
    for (const n of [1, 2]) await obtainAllowanceVoucher(world.env, {lane: 0}, await payment(first, 0x40 + n))
    expect(await selectAllowanceLane(world.env, context(), {action: 'decrypt', expires: NOW + 600})).toMatchObject({allowanceId: first})
    await settleAllowanceRefills()
    const [lane] = await inspectAllowanceLanes(world.store, deployment, slot, 1)
    expect(lane).toMatchObject({allowanceId: first, cumulative: '800'})
    expect(lane!.next?.phase).toBe('confirmed')
    // 150 more: 50 left cannot fund a 100-unit operation, so the reserved-ahead allowance takes over.
    vi.mocked(collectDebitVoucher).mockImplementationOnce(async (_c, _d, r) => ({voucher: {...voucherFor(r.payment, r.seq, 950), cost: '150'}, partials: [], outcomes: []}))
    await obtainAllowanceVoucher(world.env, {lane: 0}, await payment(first, 0x43))
    const ticket = await selectAllowanceLane(world.env, context(), {action: 'decrypt', expires: NOW + 600})
    expect(ticket?.allowanceId).toBe(lane!.next!.allowanceId)
    expect((await inspectAllowanceLanes(world.store, deployment, slot, 1))[0]).toMatchObject({allowanceId: lane!.next!.allowanceId, seq: 0, retired: 1})
    await settleAllowanceRefills()
  })

  it('an uncertain reservation keeps the payer claimed; the next attempt reconciles it instead of signing another', async () => {
    const world = environment()
    vi.mocked(reservePrepaidAllowance).mockImplementationOnce(async (_client, _wallet, _d, intent, options) => {
      const id = prepaidAllowanceId(intent)
      await options.persist({phase: 'prepared', record: {schema: 1, allowanceId: id, intent, quote: {} as never, transaction: {chainId: 43112, from: creator.address,
        to: deployment.settlement, data: '0x', value: '0', nonce: 4, gas: '1', gasPrice: '1'}}})
      throw new PaidReservationUncertainError(id, undefined, new Error('receipt timeout'))
    })
    expect(await reserveForLane(world.env, context(), 0)).toBe('pending')
    const payerKey = `prepaid-payer-43112-${creator.address.toLowerCase()}`
    expect(await world.store.load(payerKey)).toMatchObject({pending: {nonce: 4}})
    const [pending] = await inspectAllowanceLanes(world.store, deployment, slot, 1)
    expect(pending?.next?.phase).toBe('prepared')
    vi.mocked(reconcilePrepaidAllowance).mockResolvedValueOnce({state: 'reserved', allowance: {assignmentBlock: h(19)} as never})
    ;(world.client as unknown as {getTransactionCount: () => Promise<number>}).getTransactionCount = vi.fn(async () => 5)
    expect(await reserveForLane(world.env, context(), 0)).toBe('reserved')
    expect(reservePrepaidAllowance).toHaveBeenCalledTimes(1)
    expect(await world.store.load(payerKey)).toEqual({schema: 1, chainId: 43112, payer: creator.address, nextNonce: 5})
    expect((await inspectAllowanceLanes(world.store, deployment, slot, 1))[0]!.next?.phase).toBe('confirmed')
  })
})

describe('voucher push to every accountant (background)', () => {
  const urls = ['https://acct0.example', 'https://acct1.example', 'https://acct2.example']
  const acceptedBy = (only: string[]) => vi.mocked(pushDebitVoucher).mockImplementation(async (_chain, _voucher, o) =>
    o.accountantUrls.map(url => only.includes(url) ? {url, kind: 'accepted' as const, recorded: 'attached'} : {url, kind: 'failed' as const, status: 0, reason: 'down'}))

  it('pushes every aggregated voucher, exactly as aggregated, to every member and journals who acknowledged it', async () => {
    const {env, store, allowance} = await seeded()
    acceptedBy(urls)
    const a = await payment(allowance, 0x41)
    vi.mocked(collectDebitVoucher).mockResolvedValueOnce({voucher: voucherFor(a, 1, 40), partials: [], outcomes: []})
    await obtainAllowanceVoucher(env, {lane: 0}, a)
    await settleAllowanceVoucherPushes()
    expect(pushDebitVoucher).toHaveBeenCalledTimes(1)
    expect(vi.mocked(pushDebitVoucher).mock.calls[0]).toEqual([43112, voucherFor(a, 1, 40), {accountantUrls: urls, allowLocalHttp: undefined, requestTimeoutMs: 10_000, concurrency: 4}])
    expect(await inspectAllowanceVoucherPush(store, allowance)).toEqual({seq: 1, acked: urls, repushed: false})
  })

  it('a hanging or failing push neither blocks nor fails the operation', async () => {
    const {env, store, allowance} = await seeded()
    let release!: () => void
    vi.mocked(pushDebitVoucher).mockImplementationOnce(() => new Promise(resolve => { release = () => resolve([]) }))
      .mockRejectedValueOnce(new Error('push exploded'))
    const a = await payment(allowance, 0x41), b = await payment(allowance, 0x42)
    vi.mocked(collectDebitVoucher).mockResolvedValueOnce({voucher: voucherFor(a, 1, 40), partials: [], outcomes: []})
      .mockResolvedValueOnce({voucher: voucherFor(b, 2, 80), partials: [], outcomes: []})
    // The first push never answers: the operation still returns, and the next one runs.
    expect(await obtainAllowanceVoucher(env, {lane: 0}, a)).toEqual(voucherFor(a, 1, 40))
    expect(await obtainAllowanceVoucher(env, {lane: 0}, b)).toEqual(voucherFor(b, 2, 80))
    release()
    await settleAllowanceVoucherPushes()
    expect(pushDebitVoucher).toHaveBeenCalledTimes(2)
    expect(await inspectAllowanceVoucherPush(store, allowance)).toEqual({seq: 2, acked: [], repushed: false})
  })

  it('a retiring lane re-pushes its last voucher once, only to the members that did not acknowledge it', async () => {
    const {env, store, allowance} = await seeded()
    acceptedBy(['https://acct0.example'])
    const a = await payment(allowance, 0x41), b = await payment(allowance, 0x42)
    vi.mocked(collectDebitVoucher).mockResolvedValueOnce({voucher: voucherFor(a, 1, 40), partials: [], outcomes: []})
      .mockRejectedValueOnce(new DebitVoucherError([{url: urls[0]!, kind: 'refused', status: 402, reason: 'exceeds'}, {url: urls[1]!, kind: 'refused', status: 402, reason: 'exceeds'}], 0, 2))
    await obtainAllowanceVoucher(env, {lane: 0}, a)
    await settleAllowanceVoucherPushes()
    acceptedBy(urls)
    await expect(obtainAllowanceVoucher(env, {lane: 0}, b)).rejects.toBeInstanceOf(AllowanceRefusedError)
    await settleAllowanceVoucherPushes()
    expect(pushDebitVoucher).toHaveBeenCalledTimes(2)
    expect(vi.mocked(pushDebitVoucher).mock.calls[1]!.slice(0, 2)).toEqual([43112, voucherFor(a, 1, 40)])
    expect(vi.mocked(pushDebitVoucher).mock.calls[1]![2].accountantUrls).toEqual(urls.slice(1))
    expect(await inspectAllowanceVoucherPush(store, allowance)).toEqual({seq: 1, acked: urls, repushed: true})
  })

  it('an allowance near expiry re-pushes its last voucher once, however often lanes are selected', async () => {
    const {env, store, allowance} = await seeded()
    acceptedBy([])
    const a = await payment(allowance, 0x41)
    vi.mocked(collectDebitVoucher).mockResolvedValueOnce({voucher: voucherFor(a, 1, 40), partials: [], outcomes: []})
    await obtainAllowanceVoucher(env, {lane: 0}, a)
    await settleAllowanceVoucherPushes()
    await selectAllowanceLane(env, context(), {action: 'decrypt', expires: NOW + 600})
    await settleAllowanceVoucherPushes()
    expect(pushDebitVoucher).toHaveBeenCalledTimes(1) // an hour of life left: no re-push
    clock = NOW + 3600 - 300
    for (let i = 0; i < 3; i++) await selectAllowanceLane(env, context(), {action: 'decrypt', expires: clock + 60})
    await settleAllowanceVoucherPushes()
    expect(pushDebitVoucher).toHaveBeenCalledTimes(2)
    expect(vi.mocked(pushDebitVoucher).mock.calls[1]![2].accountantUrls).toEqual(urls)
    expect(await inspectAllowanceVoucherPush(store, allowance)).toMatchObject({seq: 1, acked: [], repushed: true})
  })
})

describe('debit quote block from a followed head', () => {
  it('quotes the live follower tip without a head read, and reads latest by RPC when it is not live', async () => {
    const {env, client, allowance} = await seeded()
    let ms = 0
    const follower = createHeadFollower(client, {finality: 'instant', liveAfterMs: 1000, now: () => ms})
    attachHeadFollower(client, follower)
    try {
      await follower.ingest({number: 21n, hash: h(0x91), parentHash: h(0x90), timestamp: BigInt(clock)})
      vi.mocked(client.getBlock).mockClear()
      const p = await payment(allowance, 0x51)
      await reserving(env.store, p)
      vi.mocked(collectDebitVoucher).mockResolvedValueOnce({voucher: voucherFor(p, 1, 40), partials: [], outcomes: []})
      await obtainAllowanceVoucher(env, {lane: 0}, p)
      expect(vi.mocked(collectDebitVoucher).mock.calls[0]![2]).toMatchObject({quoteBlock: h(0x91)})
      expect(client.getBlock).not.toHaveBeenCalled()
      // Not live: the quote head is read at latest, as before.
      ms = 5000
      const q = await payment(allowance, 0x52)
      await reserving(env.store, q)
      vi.mocked(collectDebitVoucher).mockResolvedValueOnce({voucher: voucherFor(q, 2, 80), partials: [], outcomes: []})
      await obtainAllowanceVoucher(env, {lane: 0}, q)
      expect(client.getBlock).toHaveBeenCalledWith({blockTag: 'latest'})
    } finally { unfollowHeads(client) }
  })
})
