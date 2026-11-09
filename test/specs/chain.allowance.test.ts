// ADR-0090 chain side: the allowance reservation (quote, checkpoints, one broadcast, mined record),
// the debit-voucher round (parallel members, partial checks, combine, aggregate against the group
// key at the quote block, refusal classes) and the reader arm of the paid receipt.
import {afterEach, describe, expect, it, vi} from 'vitest'
import {decodeFunctionData, parseTransaction, type Hex} from 'viem'
import {allowanceWorld, assignment, deployment, h, NOW, signedAllowanceIntent, slot, creator, partialOf, groupKey, sequentialRounds, verifyingShare} from '../support/allowanceFixture.js'
import {collectDebitVoucher, DebitVoucherError, prepaidAllowanceId, pushDebitVoucher, readAccountantGroupKey, readPrepaidAllowance, reconcilePrepaidAllowance, reservePrepaidAllowance, verifyDebitVoucher,
  type PrepaidAllowanceCheckpoint} from '../../src/chain/allowance.js'
import {PaidReservationUncertainError} from '../../src/chain/reservation.js'
import {settlementAbi} from '../../src/chain/abis/settlement.js'
import {debitVoucherWireDigest, paymentIntentTypedData, prepaidRequestId, type PaymentIntentWire} from '../../src/committee/payment.js'
import {readClientExecutionPolicy, readPaidOperationReceipt, resolvePaidKeeperTarget} from '../../src/chain/prepaid.js'
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
    // The voucher is returned once k answers combine: the members that had answered by then.
    expect(outcomes.length).toBeGreaterThanOrEqual(2)
    expect(outcomes.every(o => o.kind === 'partial')).toBe(true)
    expect(partials.map(p => p.identifier)).toEqual([1, 2])
    expect(voucher).toMatchObject({seq: 1, request_id: prepaidRequestId(payment), cost: '40', cumulative: '40', quote_block: quoteBlock})
    // The aggregate is the unique threshold signature: any two members reproduce it.
    const digest = debitVoucherWireDigest(deployment.settlement, 43112, voucher)
    const direct = combineBn254(hexToBytes(groupKey), hexToBytes(digest), [1, 2].map(i => ({identifier: i + 1, partial: hexToBytes(partialOf(i, digest)),
      verifyingShare: hexToBytes(verifyingShare(i))})), 2)
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


  it('returns the voucher at k answers: a member that never answers delays nothing (its request runs on)', async () => {
    const world = allowanceWorld({members: [{}, {}, {hang: true}]}), {payment, quoteBlock} = await request(world)
    const started = performance.now()
    const {voucher, outcomes} = await collectDebitVoucher(world.client, deployment, {payment, seq: 1, quoteBlock, maxOpCost: 100n},
      {accountantUrls: world.accountantUrls, requestTimeoutMs: 20_000})
    expect(performance.now() - started).toBeLessThan(5_000)
    expect(world.debits).toHaveLength(3)
    expect(outcomes.map(o => o.url)).toEqual(['https://acct0.example', 'https://acct1.example'])
    await verifyDebitVoucher(world.client, deployment, voucher)
  }, 10_000)

  it('a forged partial outside the first k is not needed; one inside it is named and replaced by the next member', async () => {
    const late = allowanceWorld({members: [{}, {}, {forge: true}]}), {payment, quoteBlock} = await request(late)
    const ok = await collectDebitVoucher(late.client, deployment, {payment, seq: 1, quoteBlock, maxOpCost: 100n}, {accountantUrls: late.accountantUrls})
    expect(ok.partials.map(p => p.identifier)).toEqual([1, 2])
    await verifyDebitVoucher(late.client, deployment, ok.voucher)
    const early = allowanceWorld({members: [{}, {forge: true}, {}]})
    const named = await collectDebitVoucher(early.client, deployment, {payment, seq: 1, quoteBlock, maxOpCost: 100n}, {accountantUrls: early.accountantUrls})
    expect(named.partials.map(p => p.identifier)).toEqual([1, 3])
    expect(named.outcomes[1]).toMatchObject({kind: 'refused', reason: expect.stringMatching(/member 2 does not verify/) as unknown})
    await verifyDebitVoucher(early.client, deployment, named.voucher)
  }, 30_000)

  it('reads the group key in one RPC round with the approved beacon, and while the members answer', async () => {
    const world = allowanceWorld({rpcDelayMs: 40}), {payment, quoteBlock} = await request(world)
    await readAccountantGroupKey(world.client, deployment, h(0x66))
    expect(sequentialRounds(world.rpcSpans)).toBe(1)
    world.rpcSpans.length = 0
    await collectDebitVoucher(world.client, deployment, {payment, seq: 1, quoteBlock, maxOpCost: 100n}, {accountantUrls: world.accountantUrls})
    expect(sequentialRounds(world.rpcSpans)).toBe(1)
  }, 30_000)

  it('never answers a call with an approved beacon from a key read without one (review F5)', async () => {
    const world = allowanceWorld()
    // Without an approved beacon: whatever Settlement names at the block (the fixture beacon).
    expect(await readAccountantGroupKey(world.client, {...deployment, beacon: undefined}, h(0x66))).toHaveLength(128)
    // With an approved beacon Settlement does not name, the check runs: never the cached key.
    await expect(readAccountantGroupKey(world.client, {...deployment, beacon: h(8, 20)}, h(0x66))).rejects.toThrow(/another beacon/)
    expect(await readAccountantGroupKey(world.client, deployment, h(0x66))).toHaveLength(128)
  }, 30_000)

  it('refuses partials that do not match the request: a cost above the cap, a wrong group key', async () => {
    const world = allowanceWorld({cost: 101n}), {payment, quoteBlock} = await request(world)
    const over = await collectDebitVoucher(world.client, deployment, {payment, seq: 1, quoteBlock, maxOpCost: 100n}, {accountantUrls: world.accountantUrls}).catch((e: unknown) => e)
    expect((over as DebitVoucherError).outcomes.every(o => o.kind === 'refused' && /does not match/.test(o.reason))).toBe(true)
    const wrongKey = allowanceWorld({mpk: partialOf(0, h(1)).padEnd(258, '0') as Hex})
    await expect(collectDebitVoucher(wrongKey.client, deployment, {payment, seq: 1, quoteBlock, maxOpCost: 100n}, {accountantUrls: wrongKey.accountantUrls})).rejects.toThrow()
  }, 30_000)
})

describe('pushDebitVoucher', () => {
  it('posts exactly the seven DebitVoucher wire fields to every member\'s vouchers route and reports each answer', async () => {
    const world = allowanceWorld(), intent = await signedAllowanceIntent(), allowance = prepaidAllowanceId(intent)
    const {voucher} = await collectDebitVoucher(world.client, deployment, {payment: await allowancePayment(allowance), seq: 1, quoteBlock: h(0x77), maxOpCost: 100n},
      {accountantUrls: world.accountantUrls})
    // The member's body is deny_unknown_fields: a voucher with an extra field is refused before any request.
    await expect(pushDebitVoucher(43112, {...voucher, note: 'local'} as typeof voucher, {accountantUrls: world.accountantUrls})).rejects.toThrow(/fields/)
    expect(world.pushes).toHaveLength(0)
    const outcomes = await pushDebitVoucher(43112, voucher, {accountantUrls: world.accountantUrls})
    expect(outcomes).toEqual(world.accountantUrls.map(url => ({url, kind: 'accepted', recorded: 'attached'})))
    expect(world.pushes.map(p => p.url)).toEqual(world.accountantUrls.map(u => `${u}/v1/prepaid/allowances/${allowance}/vouchers`))
    for (const p of world.pushes) {
      expect(Object.keys(JSON.parse(p.raw) as object)).toEqual(['allowance_id', 'seq', 'request_id', 'cost', 'cumulative', 'quote_block', 'signature'])
      expect(JSON.parse(p.raw)).toEqual(voucher)
    }
  }, 30_000)

  it('never rejects for a member: transport loss, a refusal and a wrong answer are outcomes', async () => {
    const world = allowanceWorld({members: [{down: true}, {status: 409}]})
    const voucher = {allowance_id: h(0x44), seq: 3, request_id: h(0x45), cost: '40', cumulative: '120', quote_block: h(0x77), signature: h(5, 64)}
    const outcomes = await pushDebitVoucher(43112, voucher, {accountantUrls: world.accountantUrls, concurrency: 1})
    expect(outcomes.map(o => o.kind === 'failed' ? o.status : o.recorded)).toEqual([0, 409, 'attached'])
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({seq: 2, recorded: 'attached'})))
    expect((await pushDebitVoucher(43112, voucher, {accountantUrls: world.accountantUrls}))[0]).toMatchObject({kind: 'failed', reason: 'invalid voucher push answer'})
  })
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

  it('treats a range-settled voucher (ADR-0092, Settlement "5") as settled at every call site, although its per-request records were never written', async () => {
    // The voucher is seq 1; the allowance's settled seq reached 1 by range settlement; prepaidSettled is still false.
    const {world, payment, expected} = await backed({allowance: mined, version: '5', settledSeq: 1n})
    // Reconcile / recovery surface: the receipt reports it settled.
    expect(await readPaidOperationReceipt(world.client, deployment, payment, expected)).toMatchObject({settled: true, cost: 40n})
    // Keeper target: no keeper operation starts on it.
    await expect(resolvePaidKeeperTarget(world.client, deployment, payment, expected, {allowLocalHttp: true})).rejects.toThrow(/already settled/)
    // Client execution policy: no new work is approved for it.
    await expect(readClientExecutionPolicy(world.client, {...deployment, verifierSet: h(5, 20)}, payment, expected)).rejects.toThrow(/after settlement/)
    // Below the settled seq only: a later voucher of the same allowance is not settled.
    const open = await backed({allowance: mined, version: '5', settledSeq: 0n})
    expect(await readPaidOperationReceipt(open.world.client, deployment, open.payment, open.expected)).toMatchObject({settled: false})
  }, 30_000)

  it('judges the backing by version: a "4" Settlement never consults the settled seq; an unknown version is refused', async () => {
    // "4" has no getter (the mock reverts it): the receipt still reads, unaffected.
    const v4 = await backed({allowance: mined, version: '4', settledSeq: 9n})
    expect(await readPaidOperationReceipt(v4.world.client, deployment, v4.payment, v4.expected)).toMatchObject({settled: false})
    const v6 = await backed({allowance: mined, version: '6'})
    await expect(readPaidOperationReceipt(v6.world.client, deployment, v6.payment, v6.expected)).rejects.toThrow(/unknown Settlement version/)
  }, 30_000)

  it('reads the allowance getter at a block', async () => {
    const world = allowanceWorld({allowance: mined})
    const state = await readPrepaidAllowance(world.client, deployment, h(0x44), h(19))
    expect(state).toMatchObject({slotId: slot, assignmentBlock: h(19), amount: 1000n, actions: 79, blockHash: h(19)})
    await expect(readPrepaidAllowance(world.client, deployment, h(0))).rejects.toThrow(/invalid allowance id/)
  })
})
