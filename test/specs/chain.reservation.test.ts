import {afterEach, expect, it, vi} from 'vitest'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createPublicClient, createWalletClient, custom, decodeFunctionData, defineChain, encodeAbiParameters, encodeFunctionResult, keccak256, parseTransaction, toHex, type Abi, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {PaidReservationUncertainError, reservePaidOperation, type PaidReservationCheckpoint, type PaidReservationQuote, type ReservePaidOperationOptions} from '../../src/chain/reservation.js'
import {paymentIntentTypedData, paymentSessionCommitment, prepaidRequestId, type PaymentIntentWire} from '../../src/committee/payment.js'
import {createFileStore} from '../../src/app/node.js'
import {createPaidReservationJournal} from '../../src/app/paid-journal.js'
import {settlementAbi} from '../../src/chain/abis/settlement.js'
import {keyRegistryAbi} from '../../src/chain/abis/keyRegistry.js'

const h = (n: number, length = 32): Hex => `0x${n.toString(16).padStart(2, '0').repeat(length)}`
const deployment = {chainId: 43112, settlement: h(1, 20), keyRegistry: h(2, 20)}
const expected = {slot: h(3), action: 'sign' as const, payloadDigest: h(4)}
const chain = defineChain({id: 43112, name: 'local', nativeCurrency: {name: 'AVAX', symbol: 'AVAX', decimals: 18}, rpcUrls: {default: {http: ['http://127.0.0.1:1']}}})
const encoded = (abi: Abi, functionName: string, result: unknown) => encodeFunctionResult({abi, functionName, result})
interface Changes {
  session?: {random: Hex; audience: string}
  quote?: (quote: PaidReservationQuote, method: string, index: number) => void
  gas?: bigint; price?: bigint; chain?: number; creator?: Hex; simulateFailure?: boolean
  orphan?: boolean; stale?: boolean; failSend?: boolean; rpcSendError?: boolean; failPersist?: string; response?: Response
  receiptCost?: bigint; receiptAssignment?: Hex; receiptReorg?: boolean; reverted?: boolean
  localSigner?: boolean; transactionChanged?: boolean; alreadyReserved?: boolean
}
async function fixture(change: Changes = {}) {
  vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
  const creator = privateKeyToAccount(h(11))
  const payment: PaymentIntentWire = {chain_id: 43112, settlement: h(1, 20), key_registry: h(2, 20), slot: h(3), action: 'sign',
    payload_digest: h(4), session_commitment: h(5), nonce: h(6), max_cost: '10', expires: 1060,
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
  const transport = custom({request: async ({method, params}: {method: string; params?: unknown}) => {
    trace.push(method)
    if (method === 'eth_chainId') return toHex(change.chain ?? 43112)
    if (method === 'eth_getBlockByHash') return {number: '0x13', hash: h(19), timestamp: toHex(change.stale ? 960 : 1000), transactions: []}
    if (method === 'eth_getBlockByNumber') {
      const at = (params as unknown[])[0]
      return {number: at === '0x13' ? '0x13' : '0x14', hash: at === '0x13' ? (change.orphan ? h(99) : h(19)) : (change.receiptReorg && at === '0x14' ? h(99) : h(20)), timestamp: toHex(1000), transactions: []}
    }
    if (method === 'eth_call') {
      const [call, block] = params as [{to: string; data: Hex}, {blockHash: Hex; requireCanonical: boolean}]
      expect(block.requireCanonical).toBe(true)
      expect([h(19), h(20)]).toContain(block.blockHash)
      const abi: Abi = call.to === deployment.keyRegistry ? keyRegistryAbi : settlementAbi
      const {functionName} = decodeFunctionData({abi, data: call.data})
      if (functionName === 'reservePrepaidBls') {
        if (change.simulateFailure) throw new Error('bad accountant signature')
        return '0x'
      }
      const values: Record<string, unknown> = {prepaidReserveDigest: quote.digest,
        getKeySlot: {creator: change.creator ?? creator.address, ruleCommitment: h(33), threshold: {k: 2, n: 3}, mode: 0, publicKey: h(44), epoch: 1n, committeeVersion: 2n, exists: true, cancelled: false, expiry: 2000n, ruleVersion: 1n, auth: 0},
        prepaidEnabled: true, prepaidCost: block.blockHash === h(19) ? (change.alreadyReserved ? 10n : 0n) : (change.receiptCost ?? 10n), prepaidSettled: false, prepaidRefunded: 0n, prepaidAssignmentBlock: change.receiptAssignment ?? h(19)}
      return encoded(abi, functionName, values[functionName])
    }
    if (method === 'eth_gasPrice') return toHex(change.price ?? 25n)
    if (method === 'eth_estimateGas') return toHex(change.gas ?? 100000n)
    if (method === 'eth_getTransactionCount') return '0x4'
    if (method === 'eth_sendTransaction') {
      expect(checkpoints[0]?.phase).toBe('prepared')
      transactions.push((params as Record<string, unknown>[])[0]!)
      if (change.rpcSendError) throw Object.assign(new Error('invalid input after uncertain submission'), {code: -32602})
      if (change.failSend) throw new Error('transport lost after send')
      return h(77)
    }
    if (method === 'eth_sendRawTransaction') {
      expect(checkpoints[0]?.phase).toBe('prepared')
      const raw = (params as Hex[])[0]!
      const tx = parseTransaction(raw)
      transactions.push({from: creator.address, to: tx.to, data: tx.data, value: toHex(tx.value ?? 0n), gas: toHex(tx.gas!), gasPrice: toHex(tx.gasPrice!), nonce: toHex(tx.nonce!), chainId: toHex(tx.chainId!), type: '0x0'})
      transactionHash = keccak256(raw)
      return transactionHash
    }
    if (method === 'eth_getTransactionByHash') return {...transactions[0], input: change.transactionChanged ? '0xdead' : transactions[0]!.data, hash: transactionHash, blockHash: h(20), blockNumber: '0x14', transactionIndex: '0x0', v: '0x1b', r: h(1), s: h(2)}
    if (method === 'eth_getTransactionReceipt') return {transactionHash, blockHash: h(20), blockNumber: '0x14', transactionIndex: '0x0', from: creator.address, to: deployment.settlement, cumulativeGasUsed: '0x186a0', gasUsed: '0x186a0', contractAddress: null, logs: [], logsBloom: '0x' + '00'.repeat(256), status: change.reverted ? '0x0' : '0x1', effectiveGasPrice: '0x19', type: '0x0'}
    throw new Error(`unexpected RPC ${method}`)
  }}, {retryCount: 0})
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
  return {run, payment, quote, client, wallet, trace, checkpoints, transactions, fetcher, options}
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('uses the durable application journal through real reservation serialization and refuses resubmission after restart', async () => {
  const session = {random: h(33), audience: 'did:web:agent.example'}
  const f = await fixture({session}), directory = await mkdtemp(join(tmpdir(), 'tasra-reservation-'))
  try {
    const journal = createPaidReservationJournal(createFileStore(directory), f.payment, session)
    const result = await f.run({persist: async checkpoint => {await journal.persist(checkpoint); await f.options.persist(checkpoint)}})
    const restarted = createPaidReservationJournal(createFileStore(directory), f.payment, session)
    expect(await restarted.load()).toMatchObject({phase: 'confirmed', transactionHash: result.transactionHash, blockHash: h(20), session,
      record: {payment: f.payment, transaction: {nonce: 4, to: deployment.settlement}}})
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
