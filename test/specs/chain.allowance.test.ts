// ADR-0090 chain side: the allowance reservation (quote, checkpoints, one broadcast, mined record),
// the debit-voucher round (parallel members, partial checks, combine, aggregate against the group
// key at the quote block, refusal classes) and the reader arm of the paid receipt.
import {afterEach, describe, expect, it, vi} from 'vitest'
import {decodeFunctionData, parseTransaction, type Hex} from 'viem'
import {allowanceWorld, assignment, deployment, h, NOW, signedAllowanceIntent, slot, creator, partialOf, groupKey} from '../support/allowanceFixture.js'
import {collectDebitVoucher, DebitVoucherError, prepaidAllowanceId, readPrepaidAllowance, reconcilePrepaidAllowance, reservePrepaidAllowance, verifyDebitVoucher,
  type PrepaidAllowanceCheckpoint} from '../../src/chain/allowance.js'
import {PaidReservationUncertainError} from '../../src/chain/reservation.js'
import {settlementAbi} from '../../src/chain/abis/settlement.js'
import {debitVoucherWireDigest, paymentIntentTypedData, prepaidRequestId, type PaymentIntentWire} from '../../src/committee/payment.js'
import {readPaidOperationReceipt} from '../../src/chain/prepaid.js'
import {combineBn254} from '../../src/crypto/bn254.js'
import {hexToBytes} from '../../src/crypto/hex.js'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function allowancePayment(allowance: Hex, over: Partial<PaymentIntentWire> = {}): Promise<PaymentIntentWire> {
  const unsigned = {chain_id: 43112, settlement: deployment.settlement, key_registry: deployment.keyRegistry, slot, action: 'decrypt' as const,
    payload_digest: h(0x26), session_commitment: h(0x27), nonce: h(0x28), max_cost: '100', expires: NOW + 600, verification_epoch: 7,
    verification_seed: h(0x24), verification_root: h(0x25), verification_registry_size: 5, verification_committee: 3, verification_quorum: 2,
    keeper_assignment: structuredClone(assignment), allowance_id: allowance, ...over}
  return {...unsigned, signature: await creator.signTypedData(paymentIntentTypedData(unsigned))}
}
const options = (world: ReturnType<typeof allowanceWorld>, checkpoints: PrepaidAllowanceCheckpoint[]) =>
  ({accountantUrls: world.accountantUrls, maxGas: 200_000n, maxGasPrice: 50n, persist: async (c: PrepaidAllowanceCheckpoint) => { checkpoints.push(structuredClone(c)) }})

describe('reservePrepaidAllowance', () => {
  it('prepares at every member at one block, authorizes once, journals before the single broadcast and confirms the mined record', async () => {
    const world = allowanceWorld(), intent = await signedAllowanceIntent(), checkpoints: PrepaidAllowanceCheckpoint[] = []
    const result = await reservePrepaidAllowance(world.client, world.wallet, deployment, intent, options(world, checkpoints))
    const calls = world.fetcher.mock.calls.map(([url, init]) => [String(url), (JSON.parse(init!.body as string) as {quote_block: Hex | null}).quote_block])
    expect(calls).toEqual([
      ['https://acct0.example/v1/prepaid/allowances/prepare', null],
      ['https://acct1.example/v1/prepaid/allowances/prepare', h(19)],
      ['https://acct2.example/v1/prepaid/allowances/prepare', h(19)],
      ['https://acct0.example/v1/prepaid/allowances/authorize', h(19)],
    ])
    expect(checkpoints.map(c => c.phase)).toEqual(['prepared', 'submitted', 'confirmed'])
    // The prepared checkpoint carries the exact hash of the transaction broadcast after it.
    expect(checkpoints[0]).toMatchObject({transactionHash: result.transactionHash})
    expect(world.transactions).toHaveLength(1)
    const sent = decodeFunctionData({abi: settlementAbi, data: parseTransaction(world.transactions[0]!).data!})
    expect(sent.functionName).toBe('reservePrepaidAllowanceBls')
    expect(sent.args[0]).toMatchObject({slotId: slot, intentHash: result.quote.intent_hash, amount: 1000n, maxOpCost: 100n, actions: 79, assignmentBlock: h(19)})
    expect(result.allowance).toMatchObject({allowanceId: prepaidAllowanceId(intent), assignmentBlock: h(19), amount: 1000n, closed: false})
    const reconciled = await reconcilePrepaidAllowance(world.client, deployment, (checkpoints[0] as Extract<PrepaidAllowanceCheckpoint, {phase: 'prepared'}>).record)
    expect(reconciled.state).toBe('reserved')
  })

  it('refuses an already reserved allowance, a foreign intent and an expired one before anything is journaled', async () => {
    const world = allowanceWorld({allowance: {assignmentBlock: h(18)}}), checkpoints: PrepaidAllowanceCheckpoint[] = []
    await expect(reservePrepaidAllowance(world.client, world.wallet, deployment, await signedAllowanceIntent(), options(world, checkpoints))).rejects.toThrow(/already reserved/)
    await expect(reservePrepaidAllowance(world.client, world.wallet, {...deployment, settlement: h(5, 20)}, await signedAllowanceIntent(), options(world, checkpoints))).rejects.toThrow(/deployment mismatch/)
    await expect(reservePrepaidAllowance(world.client, world.wallet, deployment, await signedAllowanceIntent({expires_at: NOW + 3601}), options(world, checkpoints))).rejects.toThrow(/one-hour/)
    expect(checkpoints).toEqual([])
    expect(world.transactions).toEqual([])
  })

  it('a lost receipt after the broadcast is uncertain, keyed by the allowance id', async () => {
    const world = allowanceWorld(), intent = await signedAllowanceIntent(), checkpoints: PrepaidAllowanceCheckpoint[] = []
    const failing = {...options(world, checkpoints), persist: async (c: PrepaidAllowanceCheckpoint) => { checkpoints.push(c); if (c.phase === 'submitted') throw new Error('disk full') }}
    const error = await reservePrepaidAllowance(world.client, world.wallet, deployment, intent, failing).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PaidReservationUncertainError)
    expect((error as PaidReservationUncertainError).requestId).toBe(prepaidAllowanceId(intent))
    expect(world.transactions).toHaveLength(1)
  })
})

describe('collectDebitVoucher', () => {
  async function request(_world: ReturnType<typeof allowanceWorld>) {
    const intent = await signedAllowanceIntent(), allowance = prepaidAllowanceId(intent)
    return {allowance, payment: await allowancePayment(allowance), quoteBlock: h(0x77)}
  }

  it('asks every member in parallel at the journaled quote block and combines k partials into a voucher the group key verifies', async () => {
    const world = allowanceWorld(), {payment, quoteBlock} = await request(world)
    const {voucher, partials, outcomes} = await collectDebitVoucher(world.client, deployment, {payment, seq: 1, quoteBlock, maxOpCost: 100n}, {accountantUrls: world.accountantUrls})
    expect(world.debits.map(d => d.body.quote_block)).toEqual([quoteBlock, quoteBlock, quoteBlock])
    expect(world.debits.every(d => d.body.seq === 1 && d.body.previous === null && d.body.intent.debit_voucher === undefined)).toBe(true)
    expect(outcomes.map(o => o.kind)).toEqual(['partial', 'partial', 'partial'])
    expect(partials).toHaveLength(3)
    expect(voucher).toMatchObject({seq: 1, request_id: prepaidRequestId(payment), cost: '40', cumulative: '40', quote_block: quoteBlock})
    // The aggregate is the unique threshold signature: any two members reproduce it.
    const digest = debitVoucherWireDigest(deployment.settlement, 43112, voucher)
    const direct = combineBn254(hexToBytes(groupKey), hexToBytes(digest), [1, 2].map(i => ({identifier: i + 1, partial: hexToBytes(partialOf(i, digest)),
      verifyingShare: hexToBytes(partials[i]!.verifying_share)})), 2)
    expect(voucher.signature).toBe(`0x${Buffer.from(direct).toString('hex')}`)
    await verifyDebitVoucher(world.client, deployment, voucher)
    await expect(verifyDebitVoucher(world.client, deployment, {...voucher, cumulative: '41'})).rejects.toThrow(/does not verify/)
  }, 30_000)

  it('the next seq chains the previous voucher and its cumulative total', async () => {
    const world = allowanceWorld(), {payment, quoteBlock} = await request(world)
    const first = await collectDebitVoucher(world.client, deployment, {payment, seq: 1, quoteBlock, maxOpCost: 100n}, {accountantUrls: world.accountantUrls})
    const second = await allowancePayment(payment.allowance_id!, {nonce: h(0x29)})
    const {voucher} = await collectDebitVoucher(world.client, deployment, {payment: second, seq: 2, previous: first.voucher, quoteBlock, maxOpCost: 100n}, {accountantUrls: world.accountantUrls})
    expect(voucher).toMatchObject({seq: 2, cost: '40', cumulative: '80'})
    expect(world.debits.slice(3).every(d => JSON.stringify(d.body.previous) === JSON.stringify(first.voucher))).toBe(true)
    await expect(collectDebitVoucher(world.client, deployment, {payment: second, seq: 2, quoteBlock, maxOpCost: 100n}, {accountantUrls: world.accountantUrls})).rejects.toThrow(/seq must be 1/)
  }, 30_000)

  it('names a byzantine member, survives it with the honest quorum, and refuses a below-k round with its outcome classes', async () => {
    const world = allowanceWorld({members: [{forge: true}, {}, {}]}), {payment, quoteBlock} = await request(world)
    const {outcomes, voucher} = await collectDebitVoucher(world.client, deployment, {payment, seq: 1, quoteBlock, maxOpCost: 100n}, {accountantUrls: world.accountantUrls})
    expect(outcomes[0]!.kind).toBe('refused')
    expect(outcomes[0]!.kind === 'refused' && outcomes[0]!.reason).toMatch(/member 1 does not verify/)
    await verifyDebitVoucher(world.client, deployment, voucher)

    const refused = allowanceWorld({members: [{status: 402}, {status: 409}, {}]})
    const error = await collectDebitVoucher(refused.client, deployment, {payment, seq: 1, quoteBlock, maxOpCost: 100n}, {accountantUrls: refused.accountantUrls}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DebitVoucherError)
    expect((error as DebitVoucherError).definite).toBe(true)
    expect((error as DebitVoucherError).claimed).toBe(true)

    const down = allowanceWorld({members: [{down: true}, {status: 503}, {}]})
    const unavailable = await collectDebitVoucher(down.client, deployment, {payment, seq: 1, quoteBlock, maxOpCost: 100n}, {accountantUrls: down.accountantUrls}).catch((e: unknown) => e)
    expect((unavailable as DebitVoucherError).definite).toBe(false)
    expect((unavailable as DebitVoucherError).outcomes.map(o => o.kind)).toEqual(['unavailable', 'unavailable', 'partial'])
  }, 30_000)

  it('refuses partials that do not match the request: a cost above the cap, a wrong group key', async () => {
    const world = allowanceWorld({cost: 101n}), {payment, quoteBlock} = await request(world)
    const over = await collectDebitVoucher(world.client, deployment, {payment, seq: 1, quoteBlock, maxOpCost: 100n}, {accountantUrls: world.accountantUrls}).catch((e: unknown) => e)
    expect((over as DebitVoucherError).outcomes.every(o => o.kind === 'refused' && /does not match/.test(o.reason))).toBe(true)
    const wrongKey = allowanceWorld({mpk: partialOf(0, h(1)).padEnd(258, '0') as Hex})
    await expect(collectDebitVoucher(wrongKey.client, deployment, {payment, seq: 1, quoteBlock, maxOpCost: 100n}, {accountantUrls: wrongKey.accountantUrls})).rejects.toThrow()
  }, 30_000)
})

describe('the allowance-backed paid receipt (reader arm)', () => {
  async function backed(change: Parameters<typeof allowanceWorld>[0] = {}) {
    const world = allowanceWorld(change), intent = await signedAllowanceIntent(), allowance = prepaidAllowanceId(intent)
    const unsigned = await allowancePayment(allowance)
    const {voucher} = await collectDebitVoucher(world.client, deployment, {payment: unsigned, seq: 1, quoteBlock: h(0x77), maxOpCost: 100n}, {accountantUrls: world.accountantUrls})
    const payment = {...unsigned, debit_voucher: voucher}
    const expected = {slot, action: payment.action, payloadDigest: payment.payload_digest}
    return {world, payment, expected, voucher}
  }
  const mined = {slotId: slot, assignmentBlock: h(19), amount: 1000n, maxOpCost: 100n, expiresAt: BigInt(NOW + 3600), actions: 79}

  it('admits a mined, open allowance with a verified voucher: the voucher cost and the assignment block stand in for a reservation', async () => {
    const {world, payment, expected} = await backed({allowance: mined})
    const receipt = await readPaidOperationReceipt(world.client, deployment, payment, expected)
    expect(receipt).toMatchObject({requestId: prepaidRequestId(payment), cost: 40n, settled: false, refunded: 0n, assignmentBlock: h(19)})
  }, 30_000)

  it.each([
    ['not mined', {...mined, assignmentBlock: h(0)}],
    ['another slot', {...mined, slotId: h(4)}],
    ['closed', {...mined, closed: true}],
    ['expired', {...mined, expiresAt: BigInt(NOW)}],
    ['not funding the action', {...mined, actions: 1}],
    ['a cap below the voucher cost', {...mined, maxOpCost: 39n}],
    ['an escrow below the cumulative total', {...mined, amount: 39n}],
  ])('refuses an allowance that is %s', async (_name, allowance) => {
    const {world, payment, expected} = await backed({allowance})
    await expect(readPaidOperationReceipt(world.client, deployment, payment, expected)).rejects.toThrow(/allowance-backed/)
  }, 30_000)

  it('refuses a missing or forged voucher and a request reserved per operation', async () => {
    const {world, payment, expected, voucher} = await backed({allowance: mined})
    const {debit_voucher: _drop, ...bare} = payment
    await expect(readPaidOperationReceipt(world.client, deployment, bare, expected)).rejects.toThrow(/no debit voucher/)
    await expect(readPaidOperationReceipt(world.client, deployment, {...payment, debit_voucher: {...voucher, signature: partialOf(0, h(5))}}, expected)).rejects.toThrow(/does not verify/)
    const reserved = allowanceWorld({allowance: mined, prepaidCost: 40n})
    await expect(readPaidOperationReceipt(reserved.client, deployment, payment, expected)).rejects.toThrow(/allowance-backed/)
  }, 30_000)

  it('reads the allowance getter at a block', async () => {
    const world = allowanceWorld({allowance: mined})
    const state = await readPrepaidAllowance(world.client, deployment, h(0x44), h(19))
    expect(state).toMatchObject({slotId: slot, assignmentBlock: h(19), amount: 1000n, actions: 79, blockHash: h(19)})
    await expect(readPrepaidAllowance(world.client, deployment, h(0))).rejects.toThrow(/invalid allowance id/)
  })
})
