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
  selectAllowanceLane, settleAllowanceRefills, settleAllowanceVoucherPushes, inspectAllowanceVoucherPush, allowanceLaneCount, validateAllowanceOptions, inspectAllowanceDrawLanes,
  resetAllowanceDrawAheads, type AllowanceEnv, type AllowanceTicket} from '../../src/app/paid-allowance.js'
import {createMemoryStore} from '../../src/app/memory-store.js'
import {paidRecordKey} from '../../src/app/paid-keys.js'
import {paymentIntentTypedData, prepaidAllowanceIntentTypedData, prepaidRequestId, type DebitVoucherWire, type PaymentIntentWire} from '../../src/committee/payment.js'
import type {DrawnPaidOperationContext, UndrawnPaidOperationContext} from '../../src/chain/prepaid.js'
import {attachHeadFollower, createHeadFollower, unfollowHeads} from '../../src/chain/headFollower.js'
import {assignment, creator, deployment, h, NOW, slot} from '../support/allowanceFixture.js'

let clock = NOW
beforeEach(() => { clock = NOW; vi.spyOn(Date, 'now').mockImplementation(() => clock * 1000); vi.mocked(collectDebitVoucher).mockReset(); vi.mocked(reservePrepaidAllowance).mockReset(); vi.mocked(pushDebitVoucher).mockReset() })
afterEach(async () => { await settleAllowanceVoucherPushes(); vi.restoreAllMocks() })

const context = (over: Partial<DrawnPaidOperationContext['intentFields']['keeper_assignment']> = {}): DrawnPaidOperationContext => ({blockNumber: 20n, blockHash: h(20), blockTimestamp: BigInt(NOW),
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
    expect(() => validateAllowanceOptions({enabled: true, amount: 500n, drawAmount: 50n}, {maxCost: 100n})).toThrow(/draw amount/)
    expect(() => validateAllowanceOptions({enabled: true, amount: 500n, maxDrawAllowances: 0}, {maxCost: 100n})).toThrow(/maxDrawAllowances/)
    expect(() => validateAllowanceOptions({enabled: true, amount: 500n, drawAmount: 100n, maxDrawAllowances: 64}, {maxCost: 100n})).not.toThrow()
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
    // No lane reserved and none being reserved (reserveAhead off): fall back at once.
    expect(await selectAllowanceLane(environment().env, context(), {action: 'decrypt', expires: NOW + 600})).toBeUndefined()
  })

  it('a pinned draw (ADR-0090 D7 session) takes only a lane drawn on exactly that draw, and never promotes one', async () => {
    const {env, allowance} = await seeded()
    const moved = (): DrawnPaidOperationContext => {
      const c = context()
      return {...c, intentFields: {...c.intentFields, verification_epoch: 9, verification_seed: h(0x44), verification_root: h(0x45)}}
    }
    // Unpinned, the lane keeps funding operations on its own (older) draw, as the paid-epoch rule allows.
    expect(await selectAllowanceLane(env, moved(), {action: 'decrypt', expires: NOW + 600})).toMatchObject({allowanceId: allowance})
    // A session grant drawn elsewhere: its keeper refuses this lane's draw, so it falls back.
    expect(await selectAllowanceLane(env, moved(), {action: 'decrypt', expires: NOW + 600, drawPinned: true})).toBeUndefined()
    for (const field of ['verification_registry_size', 'verification_committee', 'verification_quorum'] as const) {
      const c = context()
      expect(await selectAllowanceLane(env, {...c, intentFields: {...c.intentFields, [field]: c.intentFields[field] + 1}}, {action: 'decrypt', expires: NOW + 600, drawPinned: true})).toBeUndefined()
    }
    expect(await selectAllowanceLane(env, context(), {action: 'decrypt', expires: NOW + 600, drawPinned: true})).toMatchObject({allowanceId: allowance})
  })

  it('with no usable lane, waits for the lane reservation it started and pays from it instead of reserving per operation', async () => {
    const world = environment({reserveAhead: true})
    reservationMinesAs()
    const ticket = await selectAllowanceLane(world.env, context(), {action: 'decrypt', expires: NOW + 600})
    const [lane] = await inspectAllowanceLanes(world.store, deployment, slot, 1)
    expect(ticket).toMatchObject({lane: 0, allowanceId: lane!.allowanceId})
    expect(vi.mocked(reservePrepaidAllowance)).toHaveBeenCalledTimes(1)
  })

  it('an undrawn context (anchors landing) selects a serving lane at once, and never reserves or waits from it', async () => {
    // As discovery returns one: the keeper sharing only, no verification fields at all.
    const undrawn = (): UndrawnPaidOperationContext => {
      const {verification_epoch: _e, verification_seed: _s, verification_root: _r, verification_registry_size: _n, verification_committee: _c, verification_quorum: _q, ...sharing} = context().intentFields
      return {...context(), undrawn: true, intentFields: sharing}
    }
    const {env, allowance} = await seeded({reserveAhead: true})
    vi.mocked(reservePrepaidAllowance).mockClear()
    // The lane's own (allowance) draw is handed out; the zero draw of the context never is.
    const ticket = await selectAllowanceLane(env, undrawn(), {action: 'decrypt', expires: NOW + 600})
    expect(ticket).toMatchObject({lane: 0, allowanceId: allowance})
    expect(ticket!.fields).toMatchObject({verification_epoch: 8, verification_seed: h(0x34), verification_root: h(0x35), verification_registry_size: 5})
    // Ending soon for this operation (a drawn selection would reserve its replacement): nothing reserved from the zero draw.
    clock = NOW + 3600 - 600 - 30 - 600 - 30
    expect(await selectAllowanceLane(env, undrawn(), {action: 'decrypt', expires: clock + 600})).toMatchObject({allowanceId: allowance})
    await settleAllowanceRefills()
    expect(vi.mocked(reservePrepaidAllowance)).not.toHaveBeenCalled()
    // No lane at all: undefined at once (the caller discovers the draw), no reservation started, and a
    // pinned session draw is never served from it.
    const empty = environment({reserveAhead: true})
    expect(await selectAllowanceLane(empty.env, undrawn(), {action: 'decrypt', expires: NOW + 600})).toBeUndefined()
    expect(await selectAllowanceLane(env, undrawn(), {action: 'decrypt', expires: clock + 600, drawPinned: true})).toBeUndefined()
    await settleAllowanceRefills()
    expect(vi.mocked(reservePrepaidAllowance)).not.toHaveBeenCalled()
    await expect(reserveForLane(empty.env, undrawn(), 0)).rejects.toThrow('undrawn payment context cannot reserve')
  })

  it('falls back when the lane reservation it waited for fails, or does not finish within the bound', async () => {
    vi.mocked(reservePrepaidAllowance).mockRejectedValueOnce(new Error('refused'))
    expect(await selectAllowanceLane(environment({reserveAhead: true}).env, context(), {action: 'decrypt', expires: NOW + 600})).toBeUndefined()
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
    try {
      let release!: () => void
      vi.mocked(reservePrepaidAllowance).mockImplementationOnce(() => new Promise((_resolve, reject) => { release = () => reject(new Error('late')) }))
      const selection = selectAllowanceLane(environment({reserveAhead: true}).env, context(), {action: 'decrypt', expires: NOW + 600})
      await vi.advanceTimersByTimeAsync(20_000)
      expect(await selection).toBeUndefined()
      release()
      await settleAllowanceRefills()
    } finally { vi.useRealTimers() }
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

  it('a lane round journals the debit, then the voucher, then the lane advance with the push journal in one commit; the push itself follows in the background', async () => {
    const {env, store, allowance} = await seeded()
    const p = await payment(allowance, 0x41)
    await reserving(store, p)
    const saves: string[] = [], locks: string[] = []
    let releasePush!: () => void
    const pushBlocked = new Promise<void>(done => { releasePush = done })
    vi.mocked(pushDebitVoucher).mockImplementationOnce(async () => { await pushBlocked; return [] })
    const save = store.save.bind(store), withLock = store.withLock.bind(store)
    store.save = async (key, value) => { saves.push(key.slice(0, 4)); return save(key, value) }
    store.withLock = (key, action) => { locks.push(key.slice(0, 4)); return withLock(key, action) }
    vi.mocked(collectDebitVoucher).mockResolvedValueOnce({voucher: voucherFor(p, 1, 40), partials: [], outcomes: []})
    try {
      // Resolves while the push request is still blocked: the push is not on the operation path.
      expect(await obtainAllowanceVoucher(env, {lane: 0}, p)).toEqual(voucherFor(p, 1, 40))
      // A store without native commits saves them one by one, in this order, before the unlock. The
      // file store publishes the last two with the unlock in one flush pair (app-paid-flush-budget).
      expect(saves).toEqual(['pal-', 'pav-', 'pal-', 'pap-'])
      expect(locks).toEqual(['pal-', 'pap-'])
      expect((await inspectAllowanceVoucherPush(store, p.allowance_id!))).toEqual({seq: 1, acked: [], repushed: false})
      expect(vi.mocked(pushDebitVoucher)).toHaveBeenCalledTimes(1)
    } finally { releasePush() }
    await settleAllowanceVoucherPushes()
  })

  it('an advance interrupted after the voucher was journaled completes from that voucher, without another round', async () => {
    const {env, store, allowance} = await seeded()
    const a = await payment(allowance, 0x41), b = await payment(allowance, 0x42)
    await reserving(store, a)
    const save = store.save.bind(store)
    let journaled = false
    store.save = async (key, value) => {
      if (key.startsWith('pav-')) journaled = true
      else if (journaled && key.startsWith('pal-')) { store.save = save; throw new Error('crash before the lane advance') }
      return save(key, value)
    }
    vi.mocked(collectDebitVoucher).mockResolvedValueOnce({voucher: voucherFor(a, 1, 40), partials: [], outcomes: []})
    await expect(obtainAllowanceVoucher(env, {lane: 0}, a)).rejects.toThrow()
    expect(await journaledAllowanceVoucher(store, prepaidRequestId(a))).toEqual(voucherFor(a, 1, 40))
    expect((await inspectAllowanceLanes(store, deployment, slot, 1))[0]?.pending).toMatchObject({seq: 1, requestId: prepaidRequestId(a)})
    vi.mocked(collectDebitVoucher).mockResolvedValueOnce({voucher: voucherFor(b, 2, 80), partials: [], outcomes: []})
    expect(await obtainAllowanceVoucher(env, {lane: 0}, b)).toEqual(voucherFor(b, 2, 80))
    const calls = vi.mocked(collectDebitVoucher).mock.calls.map(c => c[2])
    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatchObject({seq: 2, payment: b, previous: voucherFor(a, 1, 40)})
    expect((await inspectAllowanceLanes(store, deployment, slot, 1))[0]).toMatchObject({seq: 2, cumulative: '80'})
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

// A round's voucher is journaled for its request (`pav-` with the operation journal's `reserved`,
// one commit), then the lane advance with the voucher's push journal (one commit with the unlock).
// A crash may keep any subset of either commit; each one resumes to the same lane and seq.
describe('lane commits: what a crash inside each one leaves', () => {
  const isAdvance = (key: string, value: unknown, seq: number) => key.startsWith('pal-')
    && (value as {current?: {seq: number; pending?: unknown}}).current?.seq === seq && (value as {current?: {pending?: unknown}}).current?.pending === undefined
  const journal = (p: PaymentIntentWire) => (voucher: DebitVoucherWire) => [[paidRecordKey(prepaidRequestId(p)), {schema: 1, phase: 'reserved', payment: {...p, debit_voucher: voucher}}]] as const

  it('journals the operation\'s `reserved` with `pav-` before the lane advances, in that one commit', async () => {
    const {env, store, allowance} = await seeded()
    const p = await payment(allowance, 0x41)
    await reserving(store, p)
    const saves: string[] = [], save = store.save.bind(store)
    store.save = async (key, value) => { saves.push(key.slice(0, 4) + (key.startsWith('paid-op') ? ':' + (value as {phase: string}).phase : '')); return save(key, value) }
    vi.mocked(collectDebitVoucher).mockResolvedValueOnce({voucher: voucherFor(p, 1, 40), partials: [], outcomes: []})
    expect(await obtainAllowanceVoucher(env, {lane: 0}, p, undefined, {journal: journal(p)})).toEqual(voucherFor(p, 1, 40))
    expect(saves).toEqual(['pal-', 'pav-', 'paid:reserved', 'pal-', 'pap-'])
  })

  it('a crash that kept the operation\'s `reserved` but not `pav-`: the next round completes the lane from that voucher, asks nobody again and keeps the lane', async () => {
    const {env, store, allowance} = await seeded()
    const a = await payment(allowance, 0x41), b = await payment(allowance, 0x42)
    await reserving(store, a); await reserving(store, b)
    const save = store.save.bind(store)
    store.save = async (key, value) => {
      if (key.startsWith('pav-')) return // never reached the disk
      if (isAdvance(key, value, 1)) { store.save = save; throw new Error('crash before the lane commit') }
      return save(key, value)
    }
    vi.mocked(collectDebitVoucher).mockResolvedValueOnce({voucher: voucherFor(a, 1, 40), partials: [], outcomes: []})
    await expect(obtainAllowanceVoucher(env, {lane: 0}, a, undefined, {journal: journal(a)})).rejects.toThrow('crash')
    expect(await journaledAllowanceVoucher(store, prepaidRequestId(a))).toBeUndefined()
    expect((await inspectAllowanceLanes(store, deployment, slot, 1))[0]?.pending).toMatchObject({seq: 1, requestId: prepaidRequestId(a)})
    vi.mocked(collectDebitVoucher).mockResolvedValueOnce({voucher: voucherFor(b, 2, 80), partials: [], outcomes: []})
    expect(await obtainAllowanceVoucher(env, {lane: 0}, b)).toEqual(voucherFor(b, 2, 80))
    const calls = vi.mocked(collectDebitVoucher).mock.calls.map(c => c[2])
    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatchObject({seq: 2, payment: b, previous: voucherFor(a, 1, 40)})
    const [lane] = await inspectAllowanceLanes(store, deployment, slot, 1)
    expect(lane).toMatchObject({allowanceId: allowance, seq: 2, cumulative: '80', retired: 0})
    // The interrupted request's voucher is journaled under it now too.
    expect(await journaledAllowanceVoucher(store, prepaidRequestId(a))).toEqual(voucherFor(a, 1, 40))
  })

  it('a voucher in the operation journal of ANOTHER seq or allowance never completes a pending debit', async () => {
    const {env, store, allowance} = await seeded()
    const a = await payment(allowance, 0x41), b = await payment(allowance, 0x42)
    await reserving(store, b)
    const save = store.save.bind(store)
    store.save = async (key, value) => {
      if (key.startsWith('pav-')) return
      if (isAdvance(key, value, 1)) { store.save = save; throw new Error('crash before the lane commit') }
      return save(key, value)
    }
    // The journal names a voucher of another seq for a's request.
    vi.mocked(collectDebitVoucher).mockResolvedValueOnce({voucher: voucherFor(a, 1, 40), partials: [], outcomes: []})
    await expect(obtainAllowanceVoucher(env, {lane: 0}, a, undefined, {journal: v => [[paidRecordKey(prepaidRequestId(a)), {schema: 1, phase: 'reserved', payment: {...a, debit_voucher: {...v, seq: 7}}}]]})).rejects.toThrow('crash')
    vi.mocked(collectDebitVoucher).mockResolvedValueOnce({voucher: voucherFor(b, 2, 80), partials: [], outcomes: []})
    // a's operation is no longer `reserving` and its debit is not completed: the lane is retired, as before.
    await expect(obtainAllowanceVoucher(env, {lane: 0}, b)).rejects.toBeInstanceOf(AllowanceRefusedError)
    expect(vi.mocked(collectDebitVoucher)).toHaveBeenCalledTimes(1)
  })

  it('a round refused after it completed another request\'s interrupted debit still publishes that lane advance and pushes its voucher', async () => {
    const {env, store, allowance} = await seeded()
    const a = await payment(allowance, 0x41)
    await reserving(store, a)
    const save = store.save.bind(store)
    let journaled = false
    store.save = async (key, value) => {
      if (key.startsWith('pav-')) journaled = true
      else if (journaled && key.startsWith('pal-')) { store.save = save; throw new Error('crash before the lane advance') }
      return save(key, value)
    }
    vi.mocked(collectDebitVoucher).mockResolvedValueOnce({voucher: voucherFor(a, 1, 40), partials: [], outcomes: []})
    await expect(obtainAllowanceVoucher(env, {lane: 0}, a)).rejects.toThrow('crash')
    await settleAllowanceVoucherPushes()
    vi.mocked(pushDebitVoucher).mockReset()
    // b outlives the allowance: refused, but only after its round completed a's advance.
    const b = await payment(allowance, 0x42, {expires: NOW + 100_000_000})
    await expect(obtainAllowanceVoucher(env, {lane: 0}, b)).rejects.toBeInstanceOf(AllowanceRefusedError)
    await settleAllowanceVoucherPushes()
    expect(vi.mocked(collectDebitVoucher)).toHaveBeenCalledTimes(1)
    const [lane] = await inspectAllowanceLanes(store, deployment, slot, 1)
    expect(lane).toMatchObject({allowanceId: allowance, seq: 1, cumulative: '40', retired: 0})
    expect(lane?.pending).toBeUndefined()
    expect((await inspectAllowanceVoucherPush(store, allowance))?.seq).toBe(1)
    expect(vi.mocked(pushDebitVoucher).mock.calls.map(c => c[1])).toEqual([voucherFor(a, 1, 40)])
  })

  it('a lane left pending by a stop between the voucher journal and the lane commit is completed by the next selection, asking nobody', async () => {
    const {env, store, allowance} = await seeded()
    const a = await payment(allowance, 0x41)
    await reserving(store, a)
    const save = store.save.bind(store)
    let journaled = false
    store.save = async (key, value) => {
      if (key.startsWith('pav-')) journaled = true
      else if (journaled && key.startsWith('pal-')) { store.save = save; throw new Error('crash before the lane advance') }
      return save(key, value)
    }
    vi.mocked(collectDebitVoucher).mockResolvedValueOnce({voucher: voucherFor(a, 1, 40), partials: [], outcomes: []})
    await expect(obtainAllowanceVoucher(env, {lane: 0}, a)).rejects.toThrow('crash')
    await settleAllowanceVoucherPushes()
    vi.mocked(pushDebitVoucher).mockReset()
    // a's own operation resumes from its journaled voucher and never touches the lane again.
    expect((await inspectAllowanceLanes(store, deployment, slot, 1))[0]?.pending).toMatchObject({seq: 1})
    const ticket = await selectAllowanceLane(env, context(), {action: 'decrypt', expires: NOW + 600})
    expect(ticket).toMatchObject({lane: 0, allowanceId: allowance})
    await settleAllowanceVoucherPushes()
    expect(vi.mocked(collectDebitVoucher)).toHaveBeenCalledTimes(1)
    const [lane] = await inspectAllowanceLanes(store, deployment, slot, 1)
    expect(lane).toMatchObject({seq: 1, cumulative: '40', retired: 0})
    expect(lane?.pending).toBeUndefined()
    expect((await inspectAllowanceVoucherPush(store, allowance))?.seq).toBe(1)
    expect(vi.mocked(pushDebitVoucher).mock.calls.map(c => c[1])).toEqual([voucherFor(a, 1, 40)])
    // The next debit chains on it.
    const b = await payment(allowance, 0x42)
    await reserving(store, b)
    vi.mocked(collectDebitVoucher).mockResolvedValueOnce({voucher: voucherFor(b, 2, 80), partials: [], outcomes: []})
    expect(await obtainAllowanceVoucher(env, {lane: 0}, b)).toEqual(voucherFor(b, 2, 80))
    expect(vi.mocked(collectDebitVoucher).mock.calls[1]![2]).toMatchObject({seq: 2, previous: voucherFor(a, 1, 40)})
  })

  it('selection leaves a pending debit without a journaled voucher alone', async () => {
    const {env, store, allowance} = await seeded()
    const a = await payment(allowance, 0x41)
    await reserving(store, a)
    vi.mocked(collectDebitVoucher).mockRejectedValueOnce(new Error('accountants unreachable'))
    await expect(obtainAllowanceVoucher(env, {lane: 0}, a)).rejects.toBeInstanceOf(AllowanceUnavailableError)
    expect(await selectAllowanceLane(env, context(), {action: 'decrypt', expires: NOW + 600})).toBeUndefined()
    expect((await inspectAllowanceLanes(store, deployment, slot, 1))[0]?.pending).toMatchObject({seq: 1, requestId: prepaidRequestId(a)})
  })

  it('a crash that kept the push journal but not the lane advance: the next round completes the advance and the journal never goes back', async () => {
    const {env, store, allowance} = await seeded()
    const a = await payment(allowance, 0x41), b = await payment(allowance, 0x42)
    await reserving(store, a); await reserving(store, b)
    const save = store.save.bind(store)
    store.save = async (key, value) => { if (isAdvance(key, value, 1)) { store.save = save; return } return save(key, value) }
    vi.mocked(collectDebitVoucher).mockResolvedValueOnce({voucher: voucherFor(a, 1, 40), partials: [], outcomes: []})
    expect(await obtainAllowanceVoucher(env, {lane: 0}, a)).toEqual(voucherFor(a, 1, 40))
    expect((await inspectAllowanceVoucherPush(store, allowance))?.seq).toBe(1)
    expect((await inspectAllowanceLanes(store, deployment, slot, 1))[0]?.pending).toMatchObject({seq: 1})
    vi.mocked(collectDebitVoucher).mockResolvedValueOnce({voucher: voucherFor(b, 2, 80), partials: [], outcomes: []})
    expect(await obtainAllowanceVoucher(env, {lane: 0}, b)).toEqual(voucherFor(b, 2, 80))
    expect(vi.mocked(collectDebitVoucher)).toHaveBeenCalledTimes(2)
    expect((await inspectAllowanceVoucherPush(store, allowance))?.seq).toBe(2)
    expect((await inspectAllowanceLanes(store, deployment, slot, 1))[0]).toMatchObject({seq: 2, cumulative: '80'})
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

  it('re-pushes the last voucher from the lane when its push journal was lost (a crash kept the lane advance but not the push journal of that commit)', async () => {
    const {env, store, allowance} = await seeded()
    const save = store.save.bind(store)
    let stopped = true
    // The lane commit publishes the advance and the push journal together; a crash may keep only the advance.
    store.save = async (key, value) => { if (stopped && key.startsWith('pap-')) return; return save(key, value) }
    // The process stops before its background push reaches anyone.
    vi.mocked(pushDebitVoucher).mockRejectedValueOnce(new Error('process stopped'))
    const a = await payment(allowance, 0x41), b = await payment(allowance, 0x42)
    vi.mocked(collectDebitVoucher).mockResolvedValueOnce({voucher: voucherFor(a, 1, 40), partials: [], outcomes: []})
      .mockRejectedValueOnce(new DebitVoucherError([{url: urls[0]!, kind: 'refused', status: 402, reason: 'exceeds'}, {url: urls[1]!, kind: 'refused', status: 402, reason: 'exceeds'}], 0, 2))
    expect(await obtainAllowanceVoucher(env, {lane: 0}, a)).toEqual(voucherFor(a, 1, 40))
    await settleAllowanceVoucherPushes()
    expect(pushDebitVoucher).toHaveBeenCalledTimes(1)
    expect(await inspectAllowanceVoucherPush(store, allowance)).toBeUndefined()
    expect((await inspectAllowanceLanes(store, deployment, slot, 1))[0]).toMatchObject({seq: 1, cumulative: '40'})
    // The process runs again; the lane retires: its durable last voucher is re-pushed to every member.
    stopped = false
    acceptedBy(urls)
    await expect(obtainAllowanceVoucher(env, {lane: 0}, b)).rejects.toBeInstanceOf(AllowanceRefusedError)
    await settleAllowanceVoucherPushes()
    expect(pushDebitVoucher).toHaveBeenCalledTimes(2)
    expect(vi.mocked(pushDebitVoucher).mock.calls[1]!.slice(0, 2)).toEqual([43112, voucherFor(a, 1, 40)])
    expect(vi.mocked(pushDebitVoucher).mock.calls[1]![2].accountantUrls).toEqual(urls)
    expect(await inspectAllowanceVoucherPush(store, allowance)).toEqual({seq: 1, acked: urls, repushed: true})
  })

  it('a crash before the lane commit (voucher journaled, no advance, no push journal): the next round completes the advance and its retiring lane re-pushes that voucher', async () => {
    const {env, store, allowance} = await seeded()
    const a = await payment(allowance, 0x41), b = await payment(allowance, 0x42)
    await reserving(store, a); await reserving(store, b)
    const save = store.save.bind(store)
    let journaled = false
    store.save = async (key, value) => {
      if (key.startsWith('pav-')) journaled = true
      else if (journaled && (key.startsWith('pal-') || key.startsWith('pap-'))) { store.save = save; throw new Error('crash before the lane commit') }
      return save(key, value)
    }
    vi.mocked(collectDebitVoucher).mockResolvedValueOnce({voucher: voucherFor(a, 1, 40), partials: [], outcomes: []})
      .mockRejectedValueOnce(new DebitVoucherError([{url: urls[0]!, kind: 'refused', status: 402, reason: 'exceeds'}, {url: urls[1]!, kind: 'refused', status: 402, reason: 'exceeds'}], 0, 2))
    await expect(obtainAllowanceVoucher(env, {lane: 0}, a)).rejects.toThrow('crash')
    await settleAllowanceVoucherPushes()
    expect(pushDebitVoucher).not.toHaveBeenCalled()
    expect(await inspectAllowanceVoucherPush(store, allowance)).toBeUndefined()
    expect((await inspectAllowanceLanes(store, deployment, slot, 1))[0]?.pending).toMatchObject({seq: 1, requestId: prepaidRequestId(a)})
    // The process runs again: b's round completes a's advance from its journaled voucher, is refused
    // and retires the lane; a's voucher, now the lane's last, reaches every member once.
    acceptedBy(urls)
    await expect(obtainAllowanceVoucher(env, {lane: 0}, b)).rejects.toBeInstanceOf(AllowanceRefusedError)
    await settleAllowanceVoucherPushes()
    expect(vi.mocked(collectDebitVoucher).mock.calls.map(c => c[2])[1]).toMatchObject({seq: 2, payment: b, previous: voucherFor(a, 1, 40)})
    const pushedVouchers = vi.mocked(pushDebitVoucher).mock.calls.map(c => c[1])
    expect(pushedVouchers.length).toBeGreaterThan(0)
    expect(pushedVouchers.every(v => v.seq === 1 && v.request_id === prepaidRequestId(a))).toBe(true)
    expect(new Set(vi.mocked(pushDebitVoucher).mock.calls.flatMap(c => c[2].accountantUrls))).toEqual(new Set(urls))
    expect(await inspectAllowanceVoucherPush(store, allowance)).toMatchObject({seq: 1, acked: urls})
  })
})

describe('debit quote block from a followed head', () => {
  it('quotes the live follower tip without a head read, and reads latest by RPC when it is not live', async () => {
    const {env, client, allowance} = await seeded()
    let ms = 0
    const follower = createHeadFollower(client, {finality: 'instant', liveAfterMs: 1000, now: () => ms})
    attachHeadFollower(client, follower)
    try {
      await follower.ingestFinalized({number: 21n, hash: h(0x91), parentHash: h(0x90), timestamp: BigInt(clock)}); await follower.ingest({number: 21n, hash: h(0x91), parentHash: h(0x90), timestamp: BigInt(clock)})
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

describe('session draws across beacon epochs (ADR-0090 D7 draw lanes)', () => {
  beforeEach(() => resetAllowanceDrawAheads())
  /** A session message's pinned discovery: the grant's draw at `epoch`, the beacon at `beacon`. */
  const at = (epoch: number, beacon = epoch): DrawnPaidOperationContext => {
    const c = context()
    return {...c, blockTimestamp: BigInt(clock), beaconEpoch: BigInt(beacon), intentFields: {...c.intentFields, verification_epoch: epoch, verification_seed: h(0x30 + epoch), verification_root: h(0x60 + epoch)}}
  }
  const message = () => ({action: 'decrypt' as const, expires: clock + 600, drawPinned: true})
  /** A world whose `discover` hands out the beacon's draw for an epoch (a fresh pinned discovery). */
  function drawWorld(options: Partial<AllowanceEnv['options']> = {}) {
    const world = environment({reserveAhead: true, ...options})
    const discover = vi.fn(async (_slot: Hex, epoch: bigint) => at(Number(epoch)))
    world.env.discover = discover
    return {...world, discover}
  }
  /** Gate every later reservation until `release()`. */
  function gatedReservations() {
    const real = vi.mocked(reservePrepaidAllowance).getMockImplementation()!
    let open!: () => void
    const gate = new Promise<void>(resolve => { open = resolve })
    vi.mocked(reservePrepaidAllowance).mockImplementation(async (...args) => { await gate; return real(...args) })
    return open
  }
  const reservations = () => vi.mocked(reservePrepaidAllowance).mock.calls.length
  const drawOf = (n: number) => vi.mocked(reservePrepaidAllowance).mock.calls[n]![3].verification_epoch

  it('after an epoch change the next message pays by voucher on the new draw: its lane was reserved ahead, off the message path', async () => {
    const world = drawWorld()
    reservationMinesAs()
    // The grant's first message at epoch 8: one lane reservation on that draw, waited for.
    expect((await selectAllowanceLane(world.env, at(8), message()))?.fields.verification_epoch).toBe(8)
    await settleAllowanceRefills()
    expect(reservations()).toBe(1)
    // The beacon moved to 9; the grant is still at 8 (its refresh follows): paid on 8, and the
    // draw of 9 is discovered (pinned, verified) and reserved in the background.
    const old = await selectAllowanceLane(world.env, at(8, 9), message())
    expect(old?.fields).toMatchObject({verification_epoch: 8, verification_seed: h(0x38)})
    await settleAllowanceRefills()
    expect(world.discover).toHaveBeenCalledWith(slot, 9n)
    expect(reservations()).toBe(2)
    expect(drawOf(1)).toBe(9)
    // The grant refreshed to 9: the message pays by voucher at once. No reservation runs on its
    // path (any new one would hang here), none is started for it.
    gatedReservations()
    const ticket = await selectAllowanceLane(world.env, at(9), message())
    expect(ticket?.fields).toMatchObject({verification_epoch: 9, verification_seed: h(0x39), verification_root: h(0x69)})
    expect(reservations()).toBe(2)
    const [drawn] = await inspectAllowanceDrawLanes(world.store, deployment, slot, 1, 9)
    expect(ticket).toMatchObject({lane: drawn!.lane, allowanceId: drawn!.allowanceId})
    // And it is debited on that lane like any other: seq 1 of the new allowance.
    vi.mocked(collectDebitVoucher).mockImplementation(async (_c, _d, r) => ({voucher: voucherFor(r.payment, r.seq, 40), partials: [], outcomes: []}))
    const voucher = await obtainAllowanceVoucher(world.env, ticket!, await payment(ticket!.allowanceId, 0x51, {...ticket!.fields}))
    expect(voucher).toMatchObject({allowance_id: ticket!.allowanceId, seq: 1})
  })

  it('a message that finds its draw\'s lane still being reserved (or its draw still being discovered) waits for it instead of paying per operation', async () => {
    // No reserve-ahead source: the first message on the new draw starts the draw-lane reservation and waits.
    const world = environment({reserveAhead: true})
    reservationMinesAs()
    expect(await selectAllowanceLane(world.env, at(8), message())).toBeDefined()
    await settleAllowanceRefills()
    const release = gatedReservations()
    let settled = false
    const waiting = selectAllowanceLane(world.env, at(9), message()).finally(() => { settled = true })
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(settled).toBe(false)
    expect(reservations()).toBe(2)
    release()
    expect((await waiting)?.fields.verification_epoch).toBe(9)
    expect(reservations()).toBe(2)
    // With a reserve-ahead source whose discovery is still running: the message waits for it too.
    const ahead = drawWorld()
    reservationMinesAs()
    expect(await selectAllowanceLane(ahead.env, at(10), message())).toBeDefined()
    await settleAllowanceRefills()
    let found!: () => void
    const discovered = new Promise<void>(resolve => { found = resolve })
    ahead.discover.mockImplementationOnce(async (_slot, epoch) => { await discovered; return at(Number(epoch)) })
    expect((await selectAllowanceLane(ahead.env, at(10, 11), message()))?.fields.verification_epoch).toBe(10)
    const next = selectAllowanceLane(ahead.env, at(11), message())
    await new Promise(resolve => setTimeout(resolve, 5))
    found()
    expect((await next)?.fields.verification_epoch).toBe(11)
    await settleAllowanceRefills()
    // One reservation per draw: 10 (waited for by the first message) and 11 (ahead), none for the waiter.
    expect(vi.mocked(reservePrepaidAllowance).mock.calls.slice(2).map(c => c[3].verification_epoch)).toEqual([10, 11])
  })

  it('holds a bounded number of draw allowances per slot over many epoch changes; the previous draw keeps paying until the grant moves', async () => {
    const world = drawWorld({maxDrawAllowances: 4})
    reservationMinesAs()
    expect(await selectAllowanceLane(world.env, at(8), message())).toBeDefined()
    await settleAllowanceRefills()
    const held = async () => {
      let total = 0
      for (const parity of [0, 1]) for (const lane of await inspectAllowanceDrawLanes(world.store, deployment, slot, 1, parity)) total += lane.held
      return total
    }
    const previous: string[] = [], outcomes: string[] = []
    const paid = (ticket: AllowanceTicket | undefined, epoch: number) => {
      if (ticket) expect(ticket.fields.verification_epoch).toBe(epoch)
      return ticket ? 'voucher' : 'per-operation'
    }
    for (let epoch = 8; epoch < 20; epoch++) {
      clock += 10
      // The message pinned to the previous epoch (grant not yet refreshed) pays on that draw's lane.
      previous.push(paid(await selectAllowanceLane(world.env, at(epoch, epoch + 1), message()), epoch))
      await settleAllowanceRefills()
      outcomes.push(paid(await selectAllowanceLane(world.env, at(epoch + 1), message()), epoch + 1))
      await settleAllowanceRefills()
      expect(await held()).toBeLessThanOrEqual(4)
    }
    // Draws 9..12 were reserved ahead (two per parity lane, the bound); from 13 on the bound holds
    // and the message pays per operation, never reserving another allowance. Every draw that has a
    // lane keeps paying by voucher while it is the previous epoch.
    expect(outcomes).toEqual([...Array<string>(4).fill('voucher'), ...Array<string>(8).fill('per-operation')])
    expect(previous).toEqual([...Array<string>(5).fill('voucher'), ...Array<string>(7).fill('per-operation')])
    expect(reservations()).toBe(1 + 4)
    expect(await held()).toBe(4)
    // Once the earlier escrows can be closed (expiry + the accountants' close grace), the lanes refill.
    // (Here the regular lane, its allowance expired, is replaced on the grant's draw 21 and serves
    // it; the draw lanes then reserve 22 ahead.)
    clock += 3600 + 600
    expect((await selectAllowanceLane(world.env, at(21), message()))?.fields.verification_epoch).toBe(21)
    await settleAllowanceRefills()
    expect(await held()).toBe(0)
    expect((await selectAllowanceLane(world.env, at(21, 22), message()))?.fields.verification_epoch).toBe(21)
    await settleAllowanceRefills()
    expect(vi.mocked(reservePrepaidAllowance).mock.calls.slice(5).map(c => c[3].verification_epoch)).toEqual([21, 22])
    expect(await held()).toBe(1)
    expect((await selectAllowanceLane(world.env, at(22), message()))?.fields.verification_epoch).toBe(22)
    const lanes = [...await inspectAllowanceDrawLanes(world.store, deployment, slot, 1, 0), ...await inspectAllowanceDrawLanes(world.store, deployment, slot, 1, 1)]
    // One allowance per draw lane in the journal; the stale draws retired, not kept usable.
    expect(lanes.filter(l => l.allowanceId).length).toBeLessThanOrEqual(2)
    await settleAllowanceRefills()
  })

  it('a failed reserve-ahead or draw-lane reservation, or a discovery of the wrong draw, falls back safely to a per-operation reservation', async () => {
    const world = drawWorld()
    reservationMinesAs()
    expect(await selectAllowanceLane(world.env, at(8), message())).toBeDefined()
    await settleAllowanceRefills()
    // The discovery hands back another epoch's draw: nothing is signed or reserved on it.
    world.discover.mockImplementationOnce(async () => at(10))
    expect(await selectAllowanceLane(world.env, at(8, 9), message())).toBeDefined()
    await settleAllowanceRefills()
    expect(reservations()).toBe(1)
    // A discovery refusal (the draw moved on) and a refused reservation: the message itself still
    // falls back to paying per operation, and nothing stays claimed or counted against the bound.
    resetAllowanceDrawAheads()
    world.discover.mockRejectedValueOnce(new Error('pinned verifier epoch has no complete anchors'))
    expect(await selectAllowanceLane(world.env, at(8, 9), message())).toBeDefined()
    await settleAllowanceRefills()
    vi.mocked(reservePrepaidAllowance).mockRejectedValue(new Error('accountants refused the allowance'))
    expect(await selectAllowanceLane(world.env, at(9), message())).toBeUndefined()
    await settleAllowanceRefills()
    const [lane] = await inspectAllowanceDrawLanes(world.store, deployment, slot, 1, 9)
    expect(lane).toMatchObject({held: 0, retired: 0})
    expect(lane!.allowanceId).toBeUndefined()
    expect(lane!.next).toBeUndefined()
    // Reserve-ahead off: never a background reservation for a draw.
    const off = environment({reserveAhead: false})
    off.env.discover = vi.fn(async (_slot: Hex, epoch: bigint) => at(Number(epoch)))
    const before = reservations()
    expect(await selectAllowanceLane(off.env, at(8, 9), message())).toBeUndefined()
    await settleAllowanceRefills()
    expect(off.env.discover).not.toHaveBeenCalled()
    expect(reservations()).toBe(before)
  })
})
