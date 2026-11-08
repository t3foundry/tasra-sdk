import {afterEach, expect, it, vi} from 'vitest'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createPublicClient, createWalletClient, custom, decodeFunctionData, defineChain, encodeAbiParameters, encodeFunctionData, encodeFunctionResult, keccak256, parseTransaction, toHex, type Abi, type Hex, type TransactionSerialized} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {PaidReservationAbortedError, PaidReservationStaleEpochError, PaidReservationUncertainError, reservePaidOperation, reconcilePaidReservation, type PaidReservationRecord, type PaidReservationCheckpoint, type PaidReservationQuote, type ReservePaidOperationOptions} from '../../src/chain/reservation.js'
import {paymentIntentTypedData, paymentSessionCommitment, prepaidRequestId, type PaymentIntentWire} from '../../src/committee/payment.js'
import {createFileStore} from '../../src/app/node.js'
import {createPaidReservationJournal} from '../../src/app/paid-journal.js'
import {reserveApplicationPayment, reconcileApplicationPayment, reconcileApplicationReservation, ApplicationPayerRecoveryError} from '../../src/app/paid-reservation.js'
import {loadPaidReservationJournal} from '../../src/app/paid-journal.js'
import type {ApplicationStore} from '../../src/app/ready-slot.js'
import {settlementAbi} from '../../src/chain/abis/settlement.js'
import {PaidReservationQuotaError, UnderfundedSlotError, UnderfundedGasPayerError} from '../../src/errors.js'
import {keyRegistryAbi} from '../../src/chain/abis/keyRegistry.js'

const h = (n: number, length = 32): Hex => `0x${n.toString(16).padStart(2, '0').repeat(length)}`
const deployment = {chainId: 43112, settlement: h(1, 20), keyRegistry: h(2, 20)}
const expected = {slot: h(3), action: 'sign' as const, payloadDigest: h(4)}
const chain = defineChain({id: 43112, name: 'local', nativeCurrency: {name: 'AVAX', symbol: 'AVAX', decimals: 18}, rpcUrls: {default: {http: ['http://127.0.0.1:1']}}})
const encoded = (abi: Abi, functionName: string, result: unknown) => encodeFunctionResult({abi, functionName, result})
interface Changes {
  /** Answer every RPC a macrotask later and record how many were in flight at once. */
  overlap?: {active: number; most: number}
  paymentNonce?: Hex; payerNonce?: number; applicationJournal?: boolean
  session?: {random: Hex; audience: string}
  quote?: (quote: PaidReservationQuote, method: string, index: number) => void
  gas?: bigint; price?: bigint; balance?: bigint; chain?: number; creator?: Hex; simulateFailure?: boolean
  orphan?: boolean; stale?: boolean; failSend?: boolean; rpcSendError?: boolean; failPersist?: string; response?: Response
  receiptCost?: bigint; receiptAssignment?: Hex; receiptReorg?: boolean; reverted?: boolean
  localSigner?: boolean; transactionChanged?: boolean; alreadyReserved?: boolean
  wrongReturnedHash?: boolean
  headNumber?: number; headTimestamp?: number; receiptMissing?: boolean; recoveryUnsupported?: boolean
  settled?: boolean; refunded?: bigint; onChainId?: () => void
  candidate?: (transaction: Record<string, unknown>) => Record<string, unknown>
}
async function fixture(change: Changes = {}) {
  vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
  const creator = privateKeyToAccount(h(11))
  const payment: PaymentIntentWire = {chain_id: 43112, settlement: h(1, 20), key_registry: h(2, 20), slot: h(3), action: 'sign',
    payload_digest: h(4), session_commitment: h(5), nonce: change.paymentNonce ?? h(6), max_cost: '10', expires: 1060,
    verification_epoch: 7, verification_seed: h(8), verification_root: h(9), verification_registry_size: 5, verification_committee: 3, verification_quorum: 2,
    keeper_assignment: {key_epoch: 1, committee_version: 2, threshold: 2, coordinator: Array<number>(32).fill(9), contributors: [9, 10, 11].map(n => Array<number>(32).fill(n))}, signature: h(1, 65)}
  if (change.session) payment.session_commitment = paymentSessionCommitment(change.session.random, change.session.audience, payment.expires)
  payment.signature = await creator.signTypedData(paymentIntentTypedData(payment))
  const requestId = prepaidRequestId(payment)
  const quote: PaidReservationQuote = {slot: payment.slot, quote_block: h(19), request_ids: [requestId], costs: ['10'], legacy_nonce: 0, deadline: 1060, digest: h(0), signature: null, mined: false}
  quote.digest = keccak256(encodeAbiParameters([{type: 'bytes32'}, {type: 'address'}, {type: 'uint256'}, {type: 'bytes32'}, {type: 'uint64'}, {type: 'bytes32'}, {type: 'bytes32[]'}, {type: 'uint256[]'}, {type: 'uint64'}],
    [keccak256(toHex('keykeeper/prepaid-reserve-assigned/v1')), deployment.settlement, 43112n, payment.slot, 0n, h(19), [requestId], [10n], 1060n]))
  const trace: string[] = [], checkpoints: PaidReservationCheckpoint[] = []
  const transactions: Record<string, unknown>[] = []
  let transactionHash = h(77)
  let fetches = 0
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const method = String(input).endsWith('/authorize') ? 'authorize' : 'prepare'
    trace.push(method)
    expect(init?.redirect).toBe('error')
    const body = JSON.parse(init?.body as string) as {intents: PaymentIntentWire[]; quote_block: string | null}
    expect(body.intents).toEqual([payment])
    expect(body.quote_block).toBe(fetches % 3 === 0 ? null : h(19))
    const result = {...quote, signature: method === 'authorize' ? h(7, 64) : null}
    change.quote?.(result, method, fetches)
    fetches++
    return change.response?.clone() ?? Response.json(result)
  })
  vi.stubGlobal('fetch', fetcher)
  const answer = async ({method, params}: {method: string; params?: unknown}): Promise<unknown> => {
    if (!change.overlap) return respond({method, params})
    const o = change.overlap
    o.most = Math.max(o.most, ++o.active)
    try { await new Promise(resolve => setTimeout(resolve, 1)); return await respond({method, params}) } finally { o.active-- }
  }
  const respond = async ({method, params}: {method: string; params?: unknown}): Promise<unknown> => {
    trace.push(method)
    if (method === 'eth_chainId') {change.onChainId?.(); return toHex(change.chain ?? 43112)}
    if (method === 'eth_getBlockByHash') return {number: '0x13', hash: h(19), timestamp: toHex(change.stale ? 960 : 1000), transactions: []}
    if (method === 'eth_getBlockByNumber') {
      const at = (params as unknown[])[0]
      const n = at === 'latest' ? (change.headNumber ?? 20) : Number(BigInt(at as Hex))
      return {number: toHex(n), hash: n === 19 ? (change.orphan ? h(99) : h(19)) : (change.receiptReorg && n === 20 ? h(99) : h(n)), timestamp: toHex(n > 20 ? (change.headTimestamp ?? 1000) : 1000), transactions: []}
    }
    if (method === 'eth_call') {
      const [call, block] = params as [{to: string; data: Hex}, {blockHash: Hex; requireCanonical: boolean}]
      expect(block.requireCanonical).toBe(true)
      expect([h(19), h(change.headNumber ?? 20)]).toContain(block.blockHash)
      if (change.recoveryUnsupported && block.blockHash === h(19)) throw new Error('historical state unavailable')
      const abi: Abi = call.to === deployment.keyRegistry ? keyRegistryAbi : settlementAbi
      const {functionName} = decodeFunctionData({abi, data: call.data})
      if (functionName === 'reservePrepaidBls') {
        if (change.simulateFailure) throw new Error('bad accountant signature')
        return '0x'
      }
      const values: Record<string, unknown> = {prepaidReserveDigest: quote.digest,
        getKeySlot: {creator: change.creator ?? creator.address, ruleCommitment: h(33), threshold: {k: 2, n: 3}, mode: 0, publicKey: h(44), epoch: 1n, committeeVersion: 2n, exists: true, cancelled: false, expiry: 2000n, ruleVersion: 1n, auth: 0},
        prepaidEnabled: true, prepaidCost: block.blockHash === h(19) ? (change.alreadyReserved ? 10n : 0n) : (change.receiptCost ?? 10n), prepaidSettled: change.settled ?? false, prepaidRefunded: change.refunded ?? 0n, prepaidAssignmentBlock: change.receiptAssignment ?? h(19)}
      return encoded(abi, functionName, values[functionName])
    }
    if (method === 'eth_gasPrice') return toHex(change.price ?? 25n)
    if (method === 'eth_estimateGas') {
      const call = (params as Record<string, unknown>[])[0]!
      expect(call.gasPrice).toBe('0x0')
      expect(call.maxFeePerGas).toBeUndefined()
      expect(call.maxPriorityFeePerGas).toBeUndefined()
      return toHex(change.gas ?? 100000n)
    }
    if (method === 'eth_getBalance') {
      expect(String((params as unknown[])[0]).toLowerCase()).toBe(creator.address.toLowerCase())
      expect((params as unknown[])[1]).toBe('pending')
      return toHex(change.balance ?? 10n ** 18n)
    }
    if (method === 'eth_getTransactionCount') return toHex(change.payerNonce ?? 4)
    if (method === 'eth_sendTransaction') {
      if (!change.applicationJournal) expect(checkpoints[0]?.phase).toBe('prepared')
      transactions.push((params as Record<string, unknown>[])[0]!)
      if (change.rpcSendError) throw Object.assign(new Error('invalid input after uncertain submission'), {code: -32602})
      if (change.failSend) throw new Error('transport lost after send')
      return h(77)
    }
    if (method === 'eth_sendRawTransaction') {
      if (!change.applicationJournal) expect(checkpoints[0]?.phase).toBe('prepared')
      const raw = (params as Hex[])[0]!
      const tx = parseTransaction(raw)
      transactions.push({from: creator.address, to: tx.to, data: tx.data, value: toHex(tx.value ?? 0n), gas: toHex(tx.gas!), gasPrice: toHex(tx.gasPrice!), nonce: toHex(tx.nonce!), chainId: toHex(tx.chainId!), type: '0x0'})
      transactionHash = keccak256(raw)
      if (change.failSend) throw new Error('transport lost after raw send')
      return change.wrongReturnedHash ? h(88) : transactionHash
    }
    if (method === 'eth_getTransactionByHash') {
      const tx = {...transactions[0], input: change.transactionChanged ? '0xdead' : transactions[0]!.data, hash: transactionHash, blockHash: h(20), blockNumber: '0x14', transactionIndex: '0x0', v: '0x1b', r: h(1), s: h(2)}
      return change.candidate?.(tx) ?? tx
    }
    if (method === 'eth_getTransactionReceipt') return change.receiptMissing ? null : {transactionHash, blockHash: h(20), blockNumber: '0x14', transactionIndex: '0x0', from: creator.address, to: deployment.settlement, cumulativeGasUsed: '0x186a0', gasUsed: '0x186a0', contractAddress: null, logs: [], logsBloom: '0x' + '00'.repeat(256), status: change.reverted ? '0x0' : '0x1', effectiveGasPrice: '0x19', type: '0x0'}
    throw new Error(`unexpected RPC ${method}`)
  }
  const transport = custom({request: answer}, {retryCount: 0})
  const client = createPublicClient({chain, transport})
  const wallet = createWalletClient({chain, account: change.localSigner ? creator : creator.address, transport})
  const options: ReservePaidOperationOptions = {accountantUrls: ['https://acct0.example', 'https://acct1.example'], maxGas: 200000n, maxGasPrice: 50n,
    persist: async checkpoint => {
      trace.push(checkpoint.phase)
      if (change.failPersist === checkpoint.phase) throw new Error('journal failed')
      if (checkpoint.phase === 'prepared' && checkpoints.some(c => c.phase === 'prepared')) throw new Error('existing durable record')
      checkpoints.push(structuredClone(checkpoint))
    }}
  const run = (override: Partial<ReservePaidOperationOptions> = {}) => reservePaidOperation(client, wallet, deployment, payment, expected, {...options, ...override})
  const record = () => {
    const checkpoint = checkpoints.find(c => c.phase === 'prepared')
    if (!checkpoint || checkpoint.phase !== 'prepared') throw new Error('no test preparation')
    return structuredClone(checkpoint.record)
  }
  return {run, payment, quote, client, wallet, trace, checkpoints, transactions, fetcher, options, record,
    recover: (confirmations = 1) => reconcilePaidReservation(client, deployment, record(), expected, transactionHash, confirmations)}
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('sends the pre-broadcast observations together and the post-receipt reads together', async () => {
  const overlap = {active: 0, most: 0}
  const f = await fixture({localSigner: true, overlap})
  await f.run()
  // Digest, prior cost, slot, simulation and the four fee reads at once (8); before, one at a time.
  expect(overlap.most).toBeGreaterThanOrEqual(8)
  expect(f.transactions).toHaveLength(1)
})

it('reads the quote block header beside the pre-broadcast observations and still refuses a stale quote before preparing', async () => {
  const overlap = {active: 0, most: 0}
  const f = await fixture({localSigner: true, overlap})
  await f.run()
  // The header joins the eight observations in one round (9), instead of a round of its own before them.
  expect(overlap.most).toBeGreaterThanOrEqual(9)
  const stale = await fixture({localSigner: true, stale: true})
  await expect(stale.run()).rejects.toThrow(/stale or invalid/)
  expect(stale.checkpoints).toEqual([])
  expect(stale.transactions).toHaveLength(0)
})

it('reports insufficient native gas separately from TASRA before preparation or broadcast', async () => {
  const f = await fixture({localSigner: true, gas: 100000n, price: 25n, balance: 2499999n})
  const error: unknown = await f.run().catch((e: unknown) => e)
  expect(error).toBeInstanceOf(UnderfundedGasPayerError)
  expect(error).toMatchObject({code: 'underfunded-gas-payer', availableNativeUnits: 2499999n, requiredNativeUnits: 2500000n, retryable: false})
  expect(error).not.toBeInstanceOf(UnderfundedSlotError)
  expect(f.checkpoints).toHaveLength(0)
  expect(f.transactions).toHaveLength(0)
  expect(f.trace).not.toContain('eth_sendRawTransaction')
})

it('admits exactly sufficient native gas and persists the actual legacy price', async () => {
  const f = await fixture({localSigner: true, gas: 100000n, price: 25n, balance: 2500000n})
  await f.run()
  expect(f.record().transaction.gasPrice).toBe('25')
  expect(f.transactions).toHaveLength(1)
})

it('returns a typed underfunded slot error before journaling or broadcasting a reservation', async () => {
  const f = await fixture({response: new Response('insufficient available TASRA', {status: 402})})
  const error: unknown = await f.run().catch((error: unknown) => error)
  expect(error).toBeInstanceOf(UnderfundedSlotError)
  if (!(error instanceof UnderfundedSlotError)) throw new Error('Expected the typed funding refusal')
  expect(error).toMatchObject({slotId: f.payment.slot, status: 402, retryable: false,
    url: 'https://acct0.example/v1/prepaid/reservations/prepare'})
  expect(error.availableTasraUnits).toBeUndefined()
  expect(f.transactions).toHaveLength(0)
  expect(f.checkpoints).toHaveLength(0)
  expect(f.fetcher).toHaveBeenCalledTimes(1)
})

it('recovers a hashless submission after restart without another quote, signature or broadcast', async () => {
  const f = await fixture({failSend: true})
  await expect(f.run()).rejects.toBeInstanceOf(PaidReservationUncertainError)
  const saved = f.record(), start = f.trace.length
  const result = await reconcilePaidReservation(f.client, deployment, saved, expected, h(77))
  expect(result).toMatchObject({status: 'success', requestId: saved.requestId, transactionHash: h(77), transactionBlockHash: h(20),
    gasUsed: 100000n, gasPrice: 25n, gasCost: 2500000n, receipt: {cost: 10n, settled: false}})
  expect(f.trace.slice(start).every(method => method.startsWith('eth_get') || method === 'eth_call' || method === 'eth_chainId')).toBe(true)
  expect(f.transactions).toHaveLength(1)
  expect(f.checkpoints.map(c => c.phase)).toEqual(['prepared'])
  expect(f.record()).toEqual(saved)
})

it('recovers expired consent and already settled/refunded reservations at a fresh later head', async () => {
  const change: Changes = {}, f = await fixture(change)
  await f.run()
  change.headNumber = 21; change.headTimestamp = 1100; change.settled = true; change.refunded = 4n
  vi.spyOn(Date, 'now').mockReturnValue(1_100_000)
  expect(await f.recover(2)).toMatchObject({status: 'success', blockNumber: 21n, transactionBlockNumber: 20n, receipt: {settled: true, refunded: 4n}})
  expect(f.transactions).toHaveLength(1)
})

it('reports a canonical revert and its native gas without asserting absent TASRA backing', async () => {
  const f = await fixture({reverted: true})
  await expect(f.run()).rejects.toBeInstanceOf(PaidReservationUncertainError)
  const result = await f.recover()
  expect(result).toMatchObject({status: 'reverted', gasCost: 2500000n, requestId: f.record().requestId})
  expect(result).not.toHaveProperty('receipt')
  expect(f.transactions).toHaveLength(1)
})

it('refuses wrong-hash, replaced, pending and changed transaction identities', async () => {
  const change: Changes = {}, f = await fixture(change)
  await f.run()
  await expect(reconcilePaidReservation(f.client, deployment, f.record(), expected, h(88))).rejects.toThrow(/candidate/)
  for (const edit of [{from: h(88, 20)}, {to: h(88, 20)}, {nonce: '0x5'}, {gas: '0x1'}, {gasPrice: '0x1'},
    {input: '0xdead'}, {value: '0x1'}, {chainId: '0x1'}, {type: '0x2'}, {blockHash: null, blockNumber: null}, {blockNumber: '0x13'}]) {
    change.candidate = tx => ({...tx, ...edit})
    await expect(f.recover()).rejects.toThrow(/candidate/)
  }
  expect(f.transactions).toHaveLength(1)
})

it('requires historical creator state, confirmation depth, exact fee backing and canonical observations', async () => {
  for (const update of [{chain: 43113}, {creator: h(88, 20)}, {receiptMissing: true}, {recoveryUnsupported: true},
    {orphan: true}, {receiptReorg: true}, {receiptCost: 9n}, {receiptAssignment: h(88)}, {headNumber: 21, headTimestamp: 969}]) {
    const change: Changes = {}, f = await fixture(change)
    await f.run(); Object.assign(change, update)
    await expect(f.recover()).rejects.toThrow()
    expect(f.transactions).toHaveLength(1)
  }
  const f = await fixture(); await f.run()
  await expect(f.recover(2)).rejects.toThrow(/confirmations/)
  for (const count of [0, 65, 1.5]) await expect(f.recover(count)).rejects.toThrow(/confirmations/)
})

it('refuses corrupt recovery records and independently mismatched operations before reading RPC', async () => {
  const f = await fixture(); await f.run()
  const cases: ((record: PaidReservationRecord) => void)[] = [r => {r.requestId = h(88)}, r => {r.transaction.nonce = -1},
    r => {r.transaction.data = '0xdead'}, r => {r.transaction.gasPrice = '0'}, r => {r.transaction.chainId = 43113},
    r => {r.quote.costs = ['11']}, r => {r.quote.deadline = 1061}, r => {r.quote.digest = h(88)}]
  const start = f.trace.length
  for (const edit of cases) {
    const record = f.record(); edit(record)
    await expect(reconcilePaidReservation(f.client, deployment, record, expected, h(77))).rejects.toThrow()
  }
  await expect(reconcilePaidReservation(f.client, deployment, f.record(), {...expected, payloadDigest: h(88)}, h(77))).rejects.toThrow(/identity/)
  expect(f.trace).toHaveLength(start)
})

it('captures the recovery deployment, record and expected operation before the first await', async () => {
  const change: Changes = {}, f = await fixture(change); await f.run()
  const d = {...deployment}, record = f.record(), operation = {...expected}
  change.onChainId = () => {d.settlement = h(88, 20); record.transaction.data = '0xdead'; operation.payloadDigest = h(88)}
  expect((await reconcilePaidReservation(f.client, d, record, operation, h(77))).status).toBe('success')
})

it('uses the durable application journal through real reservation serialization and refuses resubmission after restart', async () => {
  const session = {random: h(33), audience: 'did:web:agent.example'}
  const f = await fixture({session}), directory = await mkdtemp(join(tmpdir(), 'tasra-reservation-'))
  try {
    const journal = createPaidReservationJournal(createFileStore(directory), f.payment, session)
    const result = await f.run({persist: async checkpoint => {await journal.persist(checkpoint); await f.options.persist(checkpoint)}})
    const restarted = createPaidReservationJournal(createFileStore(directory), f.payment, session)
    expect(await restarted.load()).toMatchObject({phase: 'confirmed', transactionHash: result.transactionHash, blockHash: h(20), session,
      record: {payment: f.payment, transaction: {nonce: 4, to: deployment.settlement}}})
    const saved = (await restarted.load())!
    expect((await reconcilePaidReservation(f.client, deployment, saved.record, expected, saved.transactionHash!)).status).toBe('success')
    await expect(f.run({persist: restarted.persist})).rejects.toThrow(/already journaled/)
    expect(f.transactions).toHaveLength(1)
  } finally {await rm(directory, {recursive: true, force: true})}
})

it('prepares one pinned quote, simulates, journals before one budgeted broadcast and verifies mined backing', async () => {
  const f = await fixture()
  const result = await f.run()
  expect(result.transactionHash).toBe(h(77))
  expect(result.receipt.cost).toBe(10n)
  expect(f.checkpoints.map(c => c.phase)).toEqual(['prepared', 'submitted', 'confirmed'])
  expect(f.trace.indexOf('prepared')).toBeLessThan(f.trace.indexOf('eth_sendTransaction'))
  expect(f.transactions).toHaveLength(1)
  expect(f.transactions[0]).toMatchObject({to: deployment.settlement, value: '0x0', nonce: '0x4', gas: '0x186a0', gasPrice: '0x19', type: '0x0'})
  const call = decodeFunctionData({abi: settlementAbi, data: f.transactions[0]!.data as Hex})
  expect(call.functionName).toBe('reservePrepaidBls')
  expect(call.args).toEqual([f.payment.slot, 0n, h(19), [prepaidRequestId(f.payment)], [10n], 1060n, h(7, 64)])
  await expect(f.run()).rejects.toThrow(/existing durable record/)
  expect(f.transactions).toHaveLength(1)
})
it('refuses changed consent, missing fields, over-cap fees and malformed authorization before any write', async () => {
  const variants: Changes['quote'][] = [
    q => { q.costs = ['11'] }, q => { q.request_ids = [h(99)] }, q => { q.digest = h(99) },
    q => { q.deadline = 999 }, q => { q.quote_block = h(0) }, q => { q.legacy_nonce = Number.MAX_SAFE_INTEGER + 1 },
    (q, method) => { if (method === 'prepare') q.signature = h(7, 64) },
    (q, method) => { if (method === 'authorize') q.signature = h(0, 64) },
    q => { Object.assign(q, {unknown: true}) },
  ]
  for (const quote of variants) {
    const f = await fixture({quote})
    await expect(f.run()).rejects.toThrow(/quote|consent|deadline/)
    expect(f.transactions).toHaveLength(0)
    expect(f.checkpoints).toHaveLength(0)
  }
})
it('RPC, creator, contract signature, canonicality and native gas checks refuse before journaling', async () => {
  for (const change of [{chain: 43113}, {creator: h(88, 20)}, {simulateFailure: true}, {orphan: true}, {stale: true}, {gas: 200001n}, {price: 51n}, {alreadyReserved: true}]) {
    const f = await fixture(change)
    await expect(f.run()).rejects.toThrow()
    expect(f.transactions).toHaveLength(0)
    expect(f.checkpoints).toHaveLength(0)
  }
})
it('a failed durable prepare prevents broadcast; a submission failure retains the prepared operation without retry', async () => {
  const before = await fixture({failPersist: 'prepared'})
  await expect(before.run()).rejects.toThrow('journal failed')
  expect(before.transactions).toHaveLength(0)
  const after = await fixture({failSend: true})
  await expect(after.run()).rejects.toMatchObject({name: 'PaidReservationUncertainError', requestId: prepaidRequestId(after.payment), transactionHash: undefined})
  expect(after.transactions).toHaveLength(1)
  expect(after.checkpoints.map(c => c.phase)).toEqual(['prepared'])
})
it('after a hash, journal, receipt, fee and reorg failures retain recovery identity and never resubmit', async () => {
  for (const change of [{failPersist: 'submitted'}, {failPersist: 'confirmed'}, {reverted: true}, {receiptCost: 9n}, {receiptAssignment: h(88)}, {receiptReorg: true}, {transactionChanged: true}]) {
    const f = await fixture(change)
    await expect(f.run()).rejects.toBeInstanceOf(PaidReservationUncertainError)
    expect(f.transactions).toHaveLength(1)
    expect(f.checkpoints[0]?.phase).toBe('prepared')
  }
})
it('a local signer broadcasts one signed transaction with its pre-recorded nonce and exact fee bounds', async () => {
  const f = await fixture({localSigner: true})
  const result = await f.run()
  expect(result.receipt.cost).toBe(10n)
  expect(f.trace.filter(s => /send.*Transaction/.test(s))).toEqual(['eth_sendRawTransaction'])
  expect(f.transactions[0]).toMatchObject({nonce: '0x4', gas: '0x186a0', gasPrice: '0x19', chainId: '0xa868'})
})
it('refuses altered locally signed bytes before any preparation or broadcast', async () => {
  for (const edit of [{to: h(88, 20)}, {data: '0xdead' as Hex}, {value: 1n}, {gas: 200001n}, {gasPrice: 51n}, {nonce: 5}, {chainId: 43113}, {}]) {
    const f = await fixture({localSigner: true})
    const data = encodeFunctionData({abi: settlementAbi, functionName: 'reservePrepaidBls', args: [f.payment.slot, 0n, h(19), [prepaidRequestId(f.payment)], [10n], 1060n, h(7, 64)]})
    const signer = privateKeyToAccount(h(Object.keys(edit).length ? 11 : 12))
    const raw = await signer.signTransaction({type: 'legacy', chainId: 43112, to: deployment.settlement, data, value: 0n, nonce: 4, gas: 100000n, gasPrice: 25n, ...edit})
    vi.spyOn(f.wallet, 'signTransaction').mockResolvedValue(raw as TransactionSerialized)
    await expect(f.run()).rejects.toThrow('signed transaction differs from the durable reservation')
    expect(f.transactions).toHaveLength(0)
    expect(f.checkpoints).toHaveLength(0)
  }
})
it('retains the locally computed hash after a lost or false RPC reply and recovers without rebroadcast', async () => {
  for (const change of [{failSend: true}, {wrongReturnedHash: true}]) {
    const f = await fixture({localSigner: true, ...change})
    const failure = await f.run().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(PaidReservationUncertainError)
    const hash = (failure as PaidReservationUncertainError).transactionHash!
    expect(hash).not.toBe(h(88))
    expect((await reconcilePaidReservation(f.client, deployment, f.record(), expected, hash)).status).toBe('success')
    expect(f.transactions).toHaveLength(1)
  }
})
it('pins the gas payer before callbacks and checks expiry again after local signing', async () => {
  const f = await fixture({localSigner: true}), persist = f.options.persist
  await f.run({persist: async checkpoint => {
    await persist(checkpoint)
    if (checkpoint.phase === 'prepared') Object.assign(f.wallet, {account: privateKeyToAccount(h(12)), chain: {...chain, id: 1}})
  }})
  expect(f.transactions[0]!.from).toBe(privateKeyToAccount(h(11)).address)
  const expired = await fixture({localSigner: true}), sign = expired.wallet.signTransaction.bind(expired.wallet)
  vi.spyOn(expired.wallet, 'signTransaction').mockImplementation(async args => {
    const raw = await sign(args)
    vi.spyOn(Date, 'now').mockReturnValue(1_061_000)
    return raw
  })
  // Signing precedes the durable preparation: an expiry found after signing leaves no journal and no send.
  await expect(expired.run()).rejects.toThrow(/stale|expired/)
  expect(expired.checkpoints).toHaveLength(0)
  expect(expired.transactions).toHaveLength(0)
})
it('does not fall back to another wallet submission method on ambiguous RPC errors', async () => {
  const f = await fixture({rpcSendError: true})
  await expect(f.run()).rejects.toBeInstanceOf(PaidReservationUncertainError)
  expect(f.transactions).toHaveLength(1)
  expect(f.trace.filter(s => /sendTransaction/.test(s))).toEqual(['eth_sendTransaction'])
})
it('unsafe transport, duplicate endpoints, invalid budgets and oversized bodies never submit', async () => {
  for (const options of [{accountantUrls: ['http://acct.example']}, {accountantUrls: ['https://acct.example', 'https://acct.example/']}, {maxGas: 0n}, {maxGasPrice: 0n}, {confirmations: 0}, {requestTimeoutMs: 85001}]) {
    const f = await fixture()
    await expect(f.run(options)).rejects.toThrow()
    expect(f.fetcher).not.toHaveBeenCalled()
    expect(f.transactions).toHaveLength(0)
  }
  const huge = await fixture({response: new Response('x'.repeat(65537))})
  await expect(huge.run()).rejects.toThrow(/64 KiB/)
  expect(huge.transactions).toHaveLength(0)
})
it('caller and journal mutation cannot change the signed operation or the outgoing transaction', async () => {
  const f = await fixture()
  const persist = f.options.persist
  const result = f.run({persist: async checkpoint => {
    await persist(checkpoint)
    if (checkpoint.phase === 'prepared') {
      checkpoint.record.transaction.to = h(99, 20)
      checkpoint.record.payment.payload_digest = h(99)
      f.payment.payload_digest = h(88)
    }
  }})
  expect((await result).receipt.cost).toBe(10n)
  expect(f.transactions[0]!.to).toBe(deployment.settlement)
})

async function applicationFixture(change: Changes = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'tasra-payer-'))
  const session = {random: h(33), audience: 'did:web:agent.example'}
  Object.assign(change, {applicationJournal: true, session})
  const f = await fixture(change), store = createFileStore(directory)
  const {persist: _persist, ...limits} = f.options
  const run = (storage: ApplicationStore = store, payment = f.payment) => reserveApplicationPayment(f.client, f.wallet, deployment, payment, expected, {...limits, store: storage, session})
  const recover = (storage: ApplicationStore = store, hash = h(77)) => reconcileApplicationPayment(f.client, storage, deployment, prepaidRequestId(f.payment), expected, hash)
  return {...f, directory, session, store, run, recover, limits,
    cleanup: () => rm(directory, {recursive: true, force: true}),
    payerKey: `prepaid-payer-43112-${f.wallet.account.address.toLowerCase()}`}
}

it('serializes different operations for one payer and retains uncertain claims across store instances', async () => {
  const f = await applicationFixture({failSend: true})
  try {
    let entered!: () => void, resume!: () => void
    const waiting = new Promise<void>(resolve => {entered = resolve}), released = new Promise<void>(resolve => {resume = resolve})
    const slow: ApplicationStore = {...f.store, save: async (key, value) => {
      await f.store.save(key, value)
      if (key === f.payerKey) {entered(); await released}
    }}
    const attempt = f.run(slow).catch((error: unknown) => error)
    await waiting
    const different = {...f.payment, nonce: h(44)}, before = f.trace.length
    // Another store instance in this process queues behind the held payer lock: nothing runs yet.
    const queued = f.run(createFileStore(f.directory), different).catch((error: unknown) => error)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(f.trace).toHaveLength(before)
    resume()
    expect(await attempt).toBeInstanceOf(PaidReservationUncertainError)
    // Once granted, it sees the uncertain claim and refuses without sending.
    expect(await queued).toBeInstanceOf(ApplicationPayerRecoveryError)
    await expect(f.run(createFileStore(f.directory), different)).rejects.toBeInstanceOf(ApplicationPayerRecoveryError)
    expect(f.transactions).toHaveLength(1)
    expect(await f.store.load(f.payerKey)).toMatchObject({pending: {requestId: prepaidRequestId(f.payment), nonce: 4}})
    expect(await f.recover(createFileStore(f.directory))).toMatchObject({status: 'success'})
    expect(await f.store.load(f.payerKey)).toMatchObject({nextNonce: 5})
    expect(await f.store.load(f.payerKey)).not.toHaveProperty('pending')
    expect(await f.store.load(`prepaid-recovery-${prepaidRequestId(f.payment)}`)).toMatchObject({transactionHash: h(77), status: 'success'})
    expect(f.transactions).toHaveLength(1)
  } finally {await f.cleanup()}
})

it('refuses a stale pending RPC nonce after restart and admits the next nonce for a distinct operation', async () => {
  const f = await applicationFixture()
  try {
    await f.run()
    const next = await fixture({applicationJournal: true, session: f.session, paymentNonce: h(22), payerNonce: 4})
    const run = () => reserveApplicationPayment(next.client, next.wallet, deployment, next.payment, expected,
      {...f.limits, session: f.session, store: createFileStore(f.directory)})
    await expect(run()).rejects.toThrow(/durable payer floor/)
    expect(next.transactions).toHaveLength(0)
    const third = await fixture({applicationJournal: true, session: f.session, paymentNonce: h(23), payerNonce: 5})
    await reserveApplicationPayment(third.client, third.wallet, deployment, third.payment, expected,
      {...f.limits, session: f.session, store: createFileStore(f.directory)})
    expect(third.transactions).toHaveLength(1)
    expect(third.transactions[0]!.nonce).toBe('0x5')
    expect(await f.store.load(f.payerKey)).toMatchObject({nextNonce: 6})
  } finally {await f.cleanup()}
})

it('keeps the payer claimed on reorg, a wrong candidate and recovery storage failure; a canonical revert frees only its nonce', async () => {
  const change: Changes = {failSend: true, reverted: true}, f = await applicationFixture(change)
  try {
    await expect(f.run()).rejects.toBeInstanceOf(PaidReservationUncertainError)
    change.receiptReorg = true
    await expect(f.recover()).rejects.toThrow(/reorganized/)
    change.receiptReorg = false
    await expect(f.recover(f.store, h(88))).rejects.toThrow(/candidate/)
    await expect(f.recover({...f.store, save: async () => {throw new Error('disk full')}})).rejects.toThrow(/disk full/)
    expect(await f.store.load(f.payerKey)).toHaveProperty('pending')
    expect(await f.recover()).toMatchObject({status: 'reverted', gasCost: 2500000n})
    expect(await f.store.load(f.payerKey)).toEqual({schema: 1, chainId: 43112, payer: f.wallet.account.address, nextNonce: 5})
    expect(f.transactions).toHaveLength(1)
  } finally {await f.cleanup()}
})

it('never submits if payer persistence fails after its durable write and never clears the uncertain claim by age', async () => {
  const f = await applicationFixture()
  try {
    await expect(f.run({...f.store, save: async (key, value) => {
      await f.store.save(key, value)
      if (key === f.payerKey) throw new Error('lost payer write acknowledgement')
    }})).rejects.toThrow(/lost payer write/)
    expect(f.transactions).toHaveLength(0)
    vi.spyOn(Date, 'now').mockReturnValue(9_000_000)
    await expect(f.run(createFileStore(f.directory), {...f.payment, nonce: h(22)})).rejects.toBeInstanceOf(ApplicationPayerRecoveryError)
    expect(f.transactions).toHaveLength(0)
  } finally {await f.cleanup()}
})

it('an application abort before preparation leaves no journal or payer claim; after broadcast the payer stays claimed', async () => {
  const f = await applicationFixture({receiptMissing: true})
  try {
    const controller = new AbortController()
    controller.abort(new Error('stop'))
    const refused = await reserveApplicationPayment(f.client, f.wallet, deployment, f.payment, expected, {...f.limits, store: f.store, session: f.session, signal: controller.signal}).catch((e: unknown) => e)
    expect(refused).toMatchObject({name: 'PaidReservationAbortedError', code: 'aborted', requestId: prepaidRequestId(f.payment)})
    const during = new AbortController()
    const quoting = await fixture({applicationJournal: true, session: f.session, quote: (_q, method) => { if (method === 'authorize') during.abort(new Error('stop')) }})
    await expect(reserveApplicationPayment(quoting.client, quoting.wallet, deployment, quoting.payment, expected, {...f.limits, store: f.store, session: f.session, signal: during.signal}))
      .rejects.toMatchObject({code: 'aborted'})
    expect(quoting.transactions).toHaveLength(0)
    expect(await loadPaidReservationJournal(f.store, prepaidRequestId(f.payment))).toBeUndefined()
    expect(await f.store.load(f.payerKey)).toBeUndefined()
    // Aborted while acquiring the payer lock: checked again once it is held.
    const queued = new AbortController()
    const locking: ApplicationStore = {...f.store, withLock: (key, operation) => f.store.withLock(key, async () => { queued.abort(new Error('stop')); return operation() })}
    expect(await reserveApplicationPayment(f.client, f.wallet, deployment, f.payment, expected, {...f.limits, store: locking, session: f.session, signal: queued.signal}).catch((e: unknown) => e))
      .toMatchObject({code: 'aborted'})
    expect(f.transactions).toHaveLength(0)
    // After broadcast: the abort ends the wait as uncertain, with the journal complete and the payer claimed.
    const late = new AbortController(), journalKey = `prepaid-${prepaidRequestId(f.payment).toLowerCase()}`
    const store: ApplicationStore = {...f.store, save: async (key, value) => {
      await f.store.save(key, value)
      if (key === journalKey && (value as {phase?: string}).phase === 'submitted') late.abort(new Error('stop'))
    }}
    const error = await reserveApplicationPayment(f.client, f.wallet, deployment, f.payment, expected, {...f.limits, receiptTimeoutMs: 1000, store, session: f.session, signal: late.signal}).catch((e: unknown) => e)
    expect(error).toMatchObject({name: 'PaidReservationUncertainError', code: 'reservation-uncertain'})
    expect(f.transactions).toHaveLength(1)
    expect(await loadPaidReservationJournal(f.store, prepaidRequestId(f.payment))).toMatchObject({phase: 'submitted', transactionHash: h(77)})
    expect(await f.store.load(f.payerKey)).toMatchObject({pending: {requestId: prepaidRequestId(f.payment), nonce: 4}})
  } finally {await f.cleanup()}
})

it('refuses corrupt payer state and repeated operation journals before any network calls', async () => {
  const f = await applicationFixture()
  try {
    await f.store.save(f.payerKey, {schema: 99})
    await expect(f.run()).rejects.toThrow(/durable reservation payer state/)
    expect(f.trace).toHaveLength(0)
    await f.store.save(f.payerKey, {schema: 1, chainId: 43112, payer: f.wallet.account.address, nextNonce: 0})
    await f.run()
    const before = f.trace.length
    await expect(f.run()).rejects.toThrow(/already journaled/)
    expect(f.trace).toHaveLength(before)
    await expect(f.recover()).rejects.toThrow(/does not own/)
  } finally {await f.cleanup()}
})

it('an abort before the durable preparation refuses as aborted with nothing journaled or sent', async () => {
  const reason = new Error('stop')
  const early = await fixture(), controller = new AbortController()
  controller.abort(reason)
  const refused = await early.run({signal: controller.signal}).catch((e: unknown) => e)
  expect(refused).toBeInstanceOf(PaidReservationAbortedError)
  expect(refused).toMatchObject({code: 'aborted', requestId: prepaidRequestId(early.payment), cause: reason})
  expect(early.fetcher).not.toHaveBeenCalled()
  for (const at of ['prepare', 'authorize']) {
    const second = new AbortController()
    const f = await fixture({quote: (_q, method) => { if (method === at) second.abort(reason) }})
    await expect(f.run({signal: second.signal})).rejects.toMatchObject({name: 'PaidReservationAbortedError', code: 'aborted'})
    expect(f.checkpoints).toEqual([])
    expect(f.transactions).toHaveLength(0)
    expect(f.trace).not.toContain('eth_sendTransaction')
  }
  // A refusal that is not caused by the abort keeps its own error.
  const third = new AbortController()
  const g = await fixture({simulateFailure: true, quote: (_q, method) => { if (method === 'authorize') third.abort(reason) }})
  await expect(g.run({signal: third.signal})).rejects.toBeInstanceOf(PaidReservationAbortedError)
  // An untouched signal changes nothing.
  const h0 = await fixture()
  expect(await h0.run({signal: new AbortController().signal})).toMatchObject({transactionHash: h(77)})
})

it('an abort after the durable preparation cannot cancel the broadcast: the journal completes and the wait ends uncertain', async () => {
  for (const at of ['prepared', 'submitted'] as const) {
    const controller = new AbortController(), reason = new Error('stop')
    const f = await fixture({receiptMissing: true})
    const error = await f.run({receiptTimeoutMs: 20, signal: controller.signal, persist: async checkpoint => {
      await f.options.persist(checkpoint)
      if (checkpoint.phase === at) controller.abort(reason)
    }}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PaidReservationUncertainError)
    expect(error).toMatchObject({code: 'reservation-uncertain', requestId: prepaidRequestId(f.payment), transactionHash: h(77), cause: reason})
    expect(f.transactions).toHaveLength(1)
    expect(f.checkpoints.map(c => c.phase)).toEqual(['prepared', 'submitted'])
    // The abandoned wait still settles on its own, without an unhandled rejection.
    await new Promise(resolve => setTimeout(resolve, 60))
  }
  // Without an abort, the wait's own timeout is still reported as uncertain.
  const quiet = await fixture({receiptMissing: true})
  await expect(quiet.run({receiptTimeoutMs: 20, signal: new AbortController().signal})).rejects.toMatchObject({code: 'reservation-uncertain', transactionHash: h(77)})
  expect(quiet.transactions).toHaveLength(1)
})

it('journals the locally signed transaction hash before broadcasting it', async () => {
  const f = await fixture({localSigner: true})
  await f.run()
  const prepared = f.checkpoints[0]!
  expect(prepared.phase).toBe('prepared')
  expect(prepared.phase === 'prepared' && prepared.transactionHash).toMatch(/^0x[0-9a-f]{64}$/)
  expect(f.trace.indexOf('prepared')).toBeLessThan(f.trace.indexOf('eth_sendRawTransaction'))
  expect(f.checkpoints.map(c => c.phase === 'prepared' ? c.transactionHash : c.transactionHash)).toEqual(Array(3).fill(prepared.phase === 'prepared' ? prepared.transactionHash : undefined))
})

it('reconciles a crash between broadcast and its journal by request ID and nonce, never broadcasting again', async () => {
  for (const localSigner of [true, false]) {
    const change: Changes = {localSigner}, f = await applicationFixture(change)
    const journalKey = `prepaid-${prepaidRequestId(f.payment).toLowerCase()}`
    try {
      const crashing: ApplicationStore = {...f.store, save: async (key, value) => {
        if (key === journalKey && (value as {phase: string}).phase === 'submitted') throw new Error('process died after broadcast')
        await f.store.save(key, value)
      }}
      await expect(f.run(crashing)).rejects.toBeInstanceOf(PaidReservationUncertainError)
      expect(f.transactions).toHaveLength(1)
      const journal = await loadPaidReservationJournal(f.store, prepaidRequestId(f.payment))
      expect(journal?.phase).toBe('prepared')
      // A local signer's hash was journaled before broadcast; a remote signer's never reached the journal.
      expect(journal?.transactionHash !== undefined).toBe(localSigner)
      const reconcile = () => reconcileApplicationReservation(f.client, f.store, deployment, f.payment, expected)
      change.receiptCost = 0n // not mined yet, quote deadline still ahead
      expect(await reconcile()).toMatchObject({state: 'uncertain', payerLocked: true})
      expect(await f.store.load(f.payerKey)).toMatchObject({pending: {nonce: 4}})
      await expect(f.run()).rejects.toBeInstanceOf(ApplicationPayerRecoveryError)
      change.receiptCost = 10n; change.payerNonce = 5 // mined: reserved and the nonce consumed
      expect(await reconcile()).toMatchObject({state: 'reserved', payerLocked: false, requestId: prepaidRequestId(f.payment)})
      expect(await f.store.load(f.payerKey)).toEqual({schema: 1, chainId: 43112, payer: f.wallet.account.address, nextNonce: 5})
      expect(f.transactions).toHaveLength(1)
    } finally {await f.cleanup()}
  }
})

it('proves a dead attempt only after the quote deadline, and releases the payer only for a consumed or unknown nonce', async () => {
  const change: Changes = {failSend: true, receiptCost: 0n}, f = await applicationFixture(change)
  try {
    await expect(f.run()).rejects.toBeInstanceOf(PaidReservationUncertainError)
    const reconcile = () => reconcileApplicationReservation(f.client, f.store, deployment, f.payment, expected)
    expect(await reconcile()).toMatchObject({state: 'uncertain', payerLocked: true})
    vi.spyOn(Date, 'now').mockReturnValue(1_061_000); change.headNumber = 21; change.headTimestamp = 1061
    // The deadline passed without a reservation; no transaction is known at nonce 4, so the floor stays 4.
    expect(await reconcile()).toMatchObject({state: 'not-reserved', payerLocked: false})
    expect(await f.store.load(f.payerKey)).toEqual({schema: 1, chainId: 43112, payer: f.wallet.account.address, nextNonce: 4})
    expect(f.transactions).toHaveLength(1)
  } finally {await f.cleanup()}
})

it('reports none only without a journal or payer claim, and a chain reservation as reserved', async () => {
  const change: Changes = {receiptCost: 0n}, f = await applicationFixture(change)
  try {
    const payer = f.wallet.account.address
    const reconcile = () => reconcileApplicationReservation(f.client, f.store, deployment, f.payment, expected, {payer})
    expect(await reconcile()).toMatchObject({state: 'none', payerLocked: false})
    await f.store.save(f.payerKey, {schema: 1, chainId: 43112, payer, nextNonce: 4, pending: {requestId: prepaidRequestId(f.payment), nonce: 4}})
    expect(await reconcile()).toMatchObject({state: 'uncertain', payerLocked: true})
    await f.store.save(f.payerKey, {schema: 1, chainId: 43112, payer, nextNonce: 4})
    change.receiptCost = 10n
    expect(await reconcile()).toMatchObject({state: 'reserved', payerLocked: false})
    await expect(reconcileApplicationReservation(f.client, f.store, deployment, f.payment, {...expected, payloadDigest: h(9)})).rejects.toThrow(/mismatch/)
    await expect(reconcileApplicationReservation(f.client, f.store, deployment, f.payment, expected, {confirmations: 0})).rejects.toThrow(/confirmations/)
    change.stale = true; change.headTimestamp = 900; change.headNumber = 21
    vi.spyOn(Date, 'now').mockReturnValue(2_000_000)
    await expect(reconcile()).rejects.toThrow(/stale/)
    expect(f.transactions).toHaveLength(0)
  } finally {await f.cleanup()}
})

// ---- The accountant's reservation quota: a prepare 429 WITH a valid hint is repeated identically ----
function quotaClock() {
  const state = {now: 1_000_000, overrun: 0, sleeps: [] as number[]}
  return {state, clock: {now: () => state.now, sleep: async (ms: number) => { state.sleeps.push(ms); state.now += ms + state.overrun }, jitter: () => 0}}
}
const quota = (headers: Record<string, string>, status = 429) => async () => new Response('reservation quota', {status, headers: {'content-type': 'text/plain', ...headers}})

it('repeats a prepare refused 429 with a hint and reserves exactly once', async () => {
  const f = await fixture(), c = quotaClock(), bodies: string[] = []
  const real = f.fetcher.getMockImplementation()!
  f.fetcher.mockImplementationOnce(async (_input, init) => { bodies.push(init?.body as string); return quota({'retry-after': '2'})() })
    .mockImplementationOnce(async (_input, init) => { bodies.push(init?.body as string); return quota({'x-ratelimit-after': '3'})() })
    .mockImplementationOnce(async (input, init) => { bodies.push(init?.body as string); return real(input, init) })
  await f.run({clock: c.clock})
  expect(c.state.sleeps).toEqual([2000, 3000])
  expect(new Set(bodies).size).toBe(1) // the identical prepare
  expect(f.checkpoints.filter(cp => cp.phase === 'prepared')).toHaveLength(1)
  expect(f.transactions).toHaveLength(1)
})

it('never repeats a prepare 429 without a valid hint, a 503, a 500/422, or an authorize 429', async () => {
  for (const [method, response] of [['prepare', quota({})], ['prepare', quota({'retry-after': '1.5'})], ['prepare', quota({'retry-after': '1'}, 503)],
    ['prepare', quota({'retry-after': '1'}, 500)], ['prepare', quota({'retry-after': '1'}, 422)], ['authorize', quota({'retry-after': '1'})]] as const) {
    const f = await fixture(), c = quotaClock(), real = f.fetcher.getMockImplementation()!
    f.fetcher.mockImplementation(async (input, init) => String(input).endsWith('/' + method) ? response() : real(input, init))
    const error: unknown = await f.run({clock: c.clock}).catch((e: unknown) => e)
    expect(error, method).toBeInstanceOf(Error)
    expect(error, method).not.toBeInstanceOf(PaidReservationQuotaError)
    expect(c.state.sleeps).toEqual([])
    expect(f.transactions).toHaveLength(0)
    expect(f.checkpoints).toHaveLength(0)
  }
})

it('refuses typed, exposing the hint, when the quota wait does not fit min(150 s, half the signed expiry)', async () => {
  // 60 s of signed lifetime left: the window is 30 s and a repeat needs 10 s of it.
  for (const [hint, reason] of [['25', 'deadline_exceeded'], ['121', 'server_wait_too_long']] as const) {
    const f = await fixture(), c = quotaClock()
    f.fetcher.mockImplementation(quota({'retry-after': hint}))
    const error: unknown = await f.run({clock: c.clock}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PaidReservationQuotaError)
    expect(error).toMatchObject({code: 'reservation_quota', reason, retryAfterMs: Number(hint) * 1000, retryable: true,
      url: 'https://acct0.example/v1/prepaid/reservations/prepare'})
    expect(c.state.sleeps).toEqual([])
    expect(f.fetcher).toHaveBeenCalledTimes(1)
    expect(f.checkpoints).toHaveLength(0)
  }
  // An overrunning sleep is re-read before the next prepare: nothing is sent late.
  const f = await fixture(), c = quotaClock()
  c.state.overrun = 20_000
  f.fetcher.mockImplementation(quota({'retry-after': '1'}))
  await expect(f.run({clock: c.clock})).rejects.toMatchObject({code: 'reservation_quota', reason: 'no_time_to_send', retryAfterMs: 1000})
  expect(f.fetcher).toHaveBeenCalledTimes(1)
})

// ---- Available-member collection keeps one intent, one quote and one broadcast ----
const quorumUrls = ['https://acct0.example', 'https://acct1.example', 'https://acct2.example']
function quorumHttp(f: Awaited<ReturnType<typeof fixture>>, change?: (url: string, method: string, init: RequestInit) => Response | Promise<Response> | undefined) {
  const seen: {url: string; method: string; body: {intents: PaymentIntentWire[]; quote_block: Hex | null}}[] = []
  f.fetcher.mockImplementation(async (input, init) => {
    const url = String(input), method = url.endsWith('/authorize') ? 'authorize' : 'prepare'
    const body = JSON.parse(init!.body as string) as {intents: PaymentIntentWire[]; quote_block: Hex | null}
    seen.push({url, method, body}); f.trace.push(method)
    expect(init!.redirect).toBe('error')
    expect(body.intents).toEqual([f.payment])
    const custom = await change?.(url, method, init!)
    return custom ?? Response.json({...f.quote, signature: method === 'authorize' ? h(7, 64) : null})
  })
  return seen
}

it.each([0, 1, 2])('reserves once when accountant %i of three is unavailable', async offline => {
  const f = await fixture()
  const seen = quorumHttp(f, url => url.startsWith(quorumUrls[offline]!) ? new Response('offline', {status: 502}) : undefined)
  await f.run({accountantUrls: quorumUrls})
  expect(f.transactions).toHaveLength(1)
  expect(f.checkpoints.map(c => c.phase)).toEqual(['prepared', 'submitted', 'confirmed'])
  expect(seen.filter(s => s.method === 'authorize')).toHaveLength(1)
  expect(seen.filter(s => s.url.startsWith(quorumUrls[offline]!))).toHaveLength(1)
  const seed = offline === 0 ? 1 : 0
  for (const entry of seen) {
    const member = quorumUrls.findIndex(url => entry.url.startsWith(url))
    expect(entry.body.quote_block).toBe(entry.method === 'authorize' || member > seed ? f.quote.quote_block : null)
  }
})

it.each(['connection', 'response body'])('skips an unavailable %s without repeating that member request', async fault => {
  const f = await fixture()
  const seen = quorumHttp(f, url => {
    if (!url.startsWith(quorumUrls[0]!)) return
    if (fault === 'connection') throw new TypeError('connection refused')
    return new Response(new ReadableStream({start(controller) { controller.error(new Error('socket closed')) }}))
  })
  await f.run()
  expect(seen.filter(s => s.url.startsWith(quorumUrls[0]!))).toHaveLength(1)
  expect(f.transactions).toHaveLength(1)
})

it('another prepared coordinator authorizes exactly the same quote before one broadcast', async () => {
  const f = await fixture()
  const seen = quorumHttp(f, (url, method) => url.startsWith(quorumUrls[0]!) && method === 'authorize'
    ? new Response('coordinator unavailable', {status: 503}) : undefined)
  await f.run()
  const authorizations = seen.filter(s => s.method === 'authorize')
  expect(authorizations).toHaveLength(2)
  expect(authorizations[0]!.body).toEqual(authorizations[1]!.body)
  expect(new Set(authorizations.map(s => s.url)).size).toBe(2)
  expect(f.transactions).toHaveLength(1)
  expect(f.checkpoints.filter(c => c.phase === 'prepared')).toHaveLength(1)
})

it.each([402, 403, 409, 422])('a responsive member refusal %i cannot be bypassed through another coordinator', async status => {
  const f = await fixture()
  const seen = quorumHttp(f, url => url.startsWith(quorumUrls[1]!) ? new Response('policy refusal', {status}) : undefined)
  const error: unknown = await f.run().catch((e: unknown) => e)
  expect(error).toBeInstanceOf(status === 402 ? UnderfundedSlotError : Error)
  expect(seen.every(s => s.method === 'prepare')).toBe(true)
  expect(f.transactions).toHaveLength(0); expect(f.checkpoints).toHaveLength(0)
})

it('malformed or inconsistent success never counts as an unavailable member', async () => {
  for (const response of [new Response('not json'), Response.json({wrong: 'quote'})]) {
    const f = await fixture()
    const seen = quorumHttp(f, url => url.startsWith(quorumUrls[1]!) ? response : undefined)
    await expect(f.run()).rejects.toBeInstanceOf(Error)
    expect(seen.every(s => s.method === 'prepare')).toBe(true)
    expect(f.transactions).toHaveLength(0); expect(f.checkpoints).toHaveLength(0)
  }
})

it('available HTTP replies do not substitute for valid quorum authorization', async () => {
  const f = await fixture({simulateFailure: true})
  quorumHttp(f, url => url.startsWith(quorumUrls[1]!) ? new Response('offline', {status: 502}) : undefined)
  await expect(f.run()).rejects.toThrow(/bad accountant signature/)
  expect(f.transactions).toHaveLength(0); expect(f.checkpoints).toHaveLength(0)
})

it('all unavailable members stop before any journal or broadcast', async () => {
  const f = await fixture(), seen = quorumHttp(f, () => new Response('offline', {status: 503}))
  await expect(f.run()).rejects.toThrow(/503/)
  expect(seen).toHaveLength(2)
  expect(new Set(seen.map(s => s.url)).size).toBe(2)
  expect(f.transactions).toHaveLength(0); expect(f.checkpoints).toHaveLength(0)
})

it('a stale-epoch prepare refusal is typed and final for this intent: no failover, journal or broadcast', async () => {
  const stale = 'reservation assignments unavailable: reservation verifier epoch is not current or previous'
  const f = await fixture(), seen = quorumHttp(f, () => new Response(stale, {status: 503}))
  const error: unknown = await f.run({accountantUrls: quorumUrls}).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(PaidReservationStaleEpochError)
  expect(error).toMatchObject({code: 'stale-verification-epoch', verificationEpoch: 7})
  expect(seen).toHaveLength(1) // every member judges the same epoch: asking another cannot help
  expect(f.transactions).toHaveLength(0); expect(f.checkpoints).toHaveLength(0)
  // Any other 503 keeps its meaning: an unavailable member, skipped for the next one.
  const g = await fixture(), other = quorumHttp(g, () => new Response('reservation assignments unavailable: rpc timeout', {status: 503}))
  const unavailable: unknown = await g.run({accountantUrls: quorumUrls}).catch((e: unknown) => e)
  expect(unavailable).not.toBeInstanceOf(PaidReservationStaleEpochError)
  expect(unavailable).toBeInstanceOf(Error)
  expect(other).toHaveLength(3)
})

it('a caller abort during an unavailable response stops collection without failover', async () => {
  const f = await fixture(), controller = new AbortController()
  const seen = quorumHttp(f, () => { controller.abort('cancelled by caller'); return new Response('offline', {status: 503}) })
  await expect(f.run({signal: controller.signal})).rejects.toBeInstanceOf(PaidReservationAbortedError)
  expect(seen).toHaveLength(1)
  expect(f.transactions).toHaveLength(0); expect(f.checkpoints).toHaveLength(0)
})

it('collection has one shared budget across unavailable members', async () => {
  const f = await fixture(), c = quotaClock()
  const seen = quorumHttp(f, () => { c.state.now += 30_001; return new Response('offline', {status: 503}) })
  await expect(f.run({clock: c.clock})).rejects.toThrow(/shared time budget/)
  expect(seen).toHaveLength(1)
  expect(f.transactions).toHaveLength(0); expect(f.checkpoints).toHaveLength(0)
})

it('an over-budget successful preparation cannot proceed to authorization', async () => {
  const f = await fixture(), c = quotaClock()
  const seen = quorumHttp(f, url => { if (url.startsWith(quorumUrls[1]!)) c.state.now += 30_001; return undefined })
  await expect(f.run({clock: c.clock})).rejects.toThrow(/shared time budget/)
  expect(seen.every(s => s.method === 'prepare')).toBe(true)
  expect(f.transactions).toHaveLength(0); expect(f.checkpoints).toHaveLength(0)
})

function differentQuote(f: Awaited<ReturnType<typeof fixture>>, signed = false) {
  const q = {...f.quote, costs: ['9'], signature: signed ? h(7, 64) : null}
  q.digest = keccak256(encodeAbiParameters([
    {type: 'bytes32'}, {type: 'address'}, {type: 'uint256'}, {type: 'bytes32'}, {type: 'uint64'},
    {type: 'bytes32'}, {type: 'bytes32[]'}, {type: 'uint256[]'}, {type: 'uint64'},
  ], [keccak256(toHex('keykeeper/prepaid-reserve-assigned/v1')), f.payment.settlement, BigInt(f.payment.chain_id),
    q.slot, BigInt(q.legacy_nonce), q.quote_block, q.request_ids, [9n], BigInt(q.deadline)]))
  return Response.json(q)
}

it('a valid but different prepared quote stops collection before authorization', async () => {
  const f = await fixture()
  const seen = quorumHttp(f, url => url.startsWith(quorumUrls[1]!) ? differentQuote(f) : undefined)
  await expect(f.run()).rejects.toThrow(/accountants disagree/)
  expect(seen.every(s => s.method === 'prepare')).toBe(true)
  expect(f.transactions).toHaveLength(0); expect(f.checkpoints).toHaveLength(0)
})

it.each(['changed quote', 'policy refusal'])('coordinator %s stops rather than falling back', async fault => {
  const f = await fixture()
  const seen = quorumHttp(f, (_url, method) => method !== 'authorize' ? undefined : fault === 'policy refusal'
    ? new Response('refused', {status: 403}) : differentQuote(f, true))
  await expect(f.run()).rejects.toThrow(fault === 'policy refusal' ? /403/ : /authorization changed/)
  expect(seen.filter(s => s.method === 'authorize')).toHaveLength(1)
  expect(f.transactions).toHaveLength(0); expect(f.checkpoints).toHaveLength(0)
})
