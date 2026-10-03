import {decodeFunctionResult, encodeAbiParameters, encodeFunctionData, keccak256, recoverTypedDataAddress, toHex, type Account, type Address, type Chain, type Hex, type PublicClient, type Transport, type WalletClient} from 'viem'
import {assertPaymentIntentWire, paymentIntentTypedData, prepaidRequestId, type PaymentIntentWire} from '../committee/payment.js'
import {settlementAbi} from './abis/settlement.js'
import {keyRegistryAbi} from './abis/keyRegistry.js'
import {readPaidOperationReceipt, type ExpectedPaidOperation, type PaidOperationReceipt, type PrepaidDeployment} from './prepaid.js'

/** Accountant authorization for a single operation. This is not a mined reservation. */
export interface PaidReservationQuote {
  /** Slot being funded. */
  slot: Hex
  /** Canonical block fixing the original operator assignment. */
  quote_block: Hex
  /** Locally derived operation ID; exactly one entry. */
  request_ids: Hex[]
  /** TASRA base-unit quote; exactly one entry. */
  costs: string[]
  /** Reconciled legacy settlement cursor. */
  legacy_nonce: number
  /** Authorization expiry in Unix seconds. */
  deadline: number
  /** Deployment-bound reservation digest. */
  digest: Hex
  /** Threshold BN254 signature, absent from an unsigned preparation. */
  signature: Hex | null
  /** Always false: accountant authorization does not establish mining. */
  mined: false
}

/** Immutable transaction identity retained before any broadcast; JSON serializable. */
export interface PaidReservationRecord {
  /** Record format. */
  schema: 1
  /** Locally derived key used by durable storage to refuse duplicate attempts. */
  requestId: Hex
  /** Creator's fixed intent, needed for recovery and the credential session. */
  payment: PaymentIntentWire
  /** Signed accountant quote. */
  quote: PaidReservationQuote
  /** Exact bounded transaction; decimal strings preserve integer precision in storage. */
  transaction: {chainId: number; from: Address; to: Address; data: Hex; value: '0'; nonce: number; gas: string; gasPrice: string}
}

/** Durable write checkpoints. A timeout after preparation requires observation, never a new attempt. */
export type PaidReservationCheckpoint =
  | {phase: 'prepared'; record: PaidReservationRecord}
  | {phase: 'submitted'; requestId: Hex; transactionHash: Hex}
  | {phase: 'confirmed'; requestId: Hex; transactionHash: Hex; blockHash: Hex}

/** Explicit limits and durable storage for one direct reservation transaction. */
export interface ReservePaidOperationOptions {
  /** Independently selected accountant HTTPS endpoints; all must agree on the same quote. */
  accountantUrls: readonly string[]
  /** Permit HTTP only on local chain43112; never on Fuji. */
  allowLocalHttp?: boolean
  /** Maximum transaction gas units. */
  maxGas: bigint
  /** Maximum native gas price in wei; separate from the payment's TASRA cap. */
  maxGasPrice: bigint
  /** Per-accountant request timeout, 1..85000 ms (default 85000). */
  requestTimeoutMs?: number
  /** Receipt timeout, 1..120000 ms (default 60000). */
  receiptTimeoutMs?: number
  /** Required confirmations, 1..64 (default 1). */
  confirmations?: number
  /**
   * Await durable storage before resolving. The prepared checkpoint MUST atomically create a
   * unique requestId record, refuse every existing record, and survive process loss. Retain
   * it on every later failure. Subsequent checkpoints update that record without deleting it.
   * A callback failure before preparation completes prevents broadcast. The SDK cannot prove
   * an application's persistence guarantees; an in-memory callback is not safe for production.
   */
  persist: (checkpoint: PaidReservationCheckpoint) => Promise<void>
}

/** Reservation submission may have happened; inspect the saved identity before further spending. */
export class PaidReservationUncertainError extends Error {
  /** Original request ID for readPaidOperationReceipt and durable journal lookup. */
  readonly requestId: Hex
  /** Transaction hash when received; absence does not establish that no transaction was sent. */
  readonly transactionHash: Hex | undefined
  constructor(requestId: Hex, transactionHash: Hex | undefined, cause: unknown) {
    super('reservation outcome needs reconciliation; retain the prepared record and do not resubmit', {cause})
    this.name = 'PaidReservationUncertainError'
    this.requestId = requestId
    this.transactionHash = transactionHash
  }
}

const HEX32 = /^0x[0-9a-f]{64}$/i
const MAX_BODY = 64 * 1024
const now = () => Math.floor(Date.now() / 1000)
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
function live(payment: PaymentIntentWire, quote?: PaidReservationQuote): void {
  const at = now()
  if (payment.expires <= at || payment.expires > at + 3600) throw new Error('payment expiry is outside the allowed lifetime')
  if (quote && (quote.deadline <= at || quote.deadline > payment.expires || quote.deadline > at + 120)) throw new Error('reservation quote deadline is expired or outside consent')
}
function parseQuote(value: unknown, payment: PaymentIntentWire, signed: boolean): PaidReservationQuote {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid accountant quote')
  const q = value as Record<string, unknown>
  const fields = ['slot', 'quote_block', 'request_ids', 'costs', 'legacy_nonce', 'deadline', 'digest', 'signature', 'mined']
  if (Object.keys(q).length !== fields.length || fields.some(k => !Object.hasOwn(q, k))) throw new Error('invalid accountant quote fields')
  for (const key of ['slot', 'quote_block', 'digest']) if (typeof q[key] !== 'string' || !HEX32.test(q[key])) throw new Error('invalid accountant quote hash')
  if (!same(q.slot as string, payment.slot) || /^0x0{64}$/i.test(q.quote_block as string) || q.mined !== false
    || !Array.isArray(q.request_ids) || q.request_ids.length !== 1 || typeof q.request_ids[0] !== 'string' || !same(q.request_ids[0], prepaidRequestId(payment))
    || !Array.isArray(q.costs) || q.costs.length !== 1 || typeof q.costs[0] !== 'string' || !/^[0-9]{1,78}$/.test(q.costs[0])
    || BigInt(q.costs[0]) <= 0n || BigInt(q.costs[0]) > BigInt(payment.max_cost)
    || !Number.isSafeInteger(q.legacy_nonce) || (q.legacy_nonce as number) < 0
    || !Number.isSafeInteger(q.deadline) || (q.deadline as number) <= 0) throw new Error('accountant quote does not match consent')
  if (signed ? typeof q.signature !== 'string' || !/^0x[0-9a-f]{128}$/i.test(q.signature) || /^0x0{128}$/i.test(q.signature) : q.signature !== null) throw new Error('invalid accountant quote signature')
  const quote = q as unknown as PaidReservationQuote
  live(payment, quote)
  const digest = keccak256(encodeAbiParameters([
    {type: 'bytes32'}, {type: 'address'}, {type: 'uint256'}, {type: 'bytes32'}, {type: 'uint64'},
    {type: 'bytes32'}, {type: 'bytes32[]'}, {type: 'uint256[]'}, {type: 'uint64'},
  ], [keccak256(toHex('keykeeper/prepaid-reserve-assigned/v1')), payment.settlement, BigInt(payment.chain_id), payment.slot,
    BigInt(quote.legacy_nonce), quote.quote_block, quote.request_ids, [BigInt(quote.costs[0]!)], BigInt(quote.deadline)]))
  if (!same(quote.digest, digest)) throw new Error('accountant quote digest mismatch')
  return quote
}
function unsigned(q: PaidReservationQuote): string {
  return JSON.stringify([q.slot.toLowerCase(), q.quote_block.toLowerCase(), q.request_ids.map(s => s.toLowerCase()), q.costs.map(s => BigInt(s).toString()), q.legacy_nonce, q.deadline, q.digest.toLowerCase()])
}
function endpoints(options: ReservePaidOperationOptions, chainId: number): string[] {
  if (options.accountantUrls.length < 1 || options.accountantUrls.length > 32) throw new Error('supply 1..32 accountant endpoints')
  const urls = options.accountantUrls.map(value => {
    const url = new URL(value)
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:'
      && !(options.allowLocalHttp && chainId === 43112 && url.protocol === 'http:'))) throw new Error('invalid accountant endpoint transport')
    return url.toString().replace(/\/+$/, '')
  })
  if (new Set(urls).size !== urls.length) throw new Error('duplicate accountant endpoints')
  return urls
}
async function ask(endpoint: string, method: 'prepare' | 'authorize', payment: PaymentIntentWire, block: Hex | null, timeout: number): Promise<PaidReservationQuote> {
  const response = await fetch(`${endpoint}/v1/prepaid/reservations/${method}`, {method: 'POST', redirect: 'error',
    headers: {'content-type': 'application/json'}, body: JSON.stringify({intents: [payment], quote_block: block}), signal: AbortSignal.timeout(timeout)})
  if (!response.ok || !response.body) throw new Error(`accountant reservation request refused (${response.status})`)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const {done, value} = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_BODY) throw new Error('accountant quote exceeds 64 KiB')
      chunks.push(value)
    }
  } finally {
    // Cancelling one branch of a tee can await its untouched sibling indefinitely.
    // Initiate cancellation without making cleanup an unbounded request tail.
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length }
  return parseQuote(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(body)), payment, method === 'authorize')
}

/**
 * Reserve TASRA for a fixed creator-signed operation using an accountant threshold quote.
 * Does not create an intent, approve tokens, activate a slot, authorize credentials or do keeper
 * work. One broadcast attempt only; no replacement, coordinator failover or implicit gas funding.
 * @param client - Trusted bounded public RPC client; use retryCount: 0 for submissions.
 * @param wallet - Account-bound gas payer on the selected chain; no automatic wallet retries.
 * @param deployment - Independently approved deployment.
 * @param original - Creator intent from independently verified assignment/session discovery.
 * @param expected - Independently derived operation.
 * @param options - Fee limits, accountant endpoints and mandatory durable persistence.
 */
export async function reservePaidOperation(
  client: PublicClient, wallet: WalletClient<Transport, Chain, Account>, deployment: PrepaidDeployment,
  original: PaymentIntentWire, expected: ExpectedPaidOperation, options: ReservePaidOperationOptions,
): Promise<{transactionHash: Hex; receipt: PaidOperationReceipt}> {
  // Snapshot caller-owned inputs before the first await; storage receives its own copy too.
  const payment = structuredClone(original), d = {...deployment}, operation = {...expected}
  const opts = {...options, accountantUrls: [...options.accountantUrls]}
  assertPaymentIntentWire(payment)
  if (!Number.isSafeInteger(d.chainId) || d.chainId <= 0 || payment.chain_id !== d.chainId
    || !same(payment.settlement, d.settlement) || !same(payment.key_registry, d.keyRegistry)
    || !same(payment.slot, operation.slot) || payment.action !== operation.action || !same(payment.payload_digest, operation.payloadDigest)) throw new Error('payment deployment or operation mismatch')
  if (typeof opts.maxGas !== 'bigint' || typeof opts.maxGasPrice !== 'bigint' || opts.maxGas <= 0n || opts.maxGas >= 1n << 64n || opts.maxGasPrice <= 0n || opts.maxGasPrice >= 1n << 128n || typeof opts.persist !== 'function') throw new Error('invalid reservation gas budget or journal')
  const requestTimeout = opts.requestTimeoutMs ?? 85000, receiptTimeout = opts.receiptTimeoutMs ?? 60000, confirmations = opts.confirmations ?? 1
  if (!Number.isSafeInteger(requestTimeout) || requestTimeout < 1 || requestTimeout > 85000
    || !Number.isSafeInteger(receiptTimeout) || receiptTimeout < 1 || receiptTimeout > 120000
    || !Number.isSafeInteger(confirmations) || confirmations < 1 || confirmations > 64) throw new Error('invalid reservation timeout or confirmations')
  live(payment)
  const urls = endpoints(opts, d.chainId)
  if (wallet.account.type !== 'local' && wallet.account.type !== 'json-rpc') throw new Error('reservation requires an EOA gas payer')
  if (wallet.chain.id !== d.chainId || await wallet.getChainId() !== d.chainId || await client.getChainId() !== d.chainId) throw new Error('reservation RPC/wallet chain mismatch')
  const quote = await ask(urls[0]!, 'prepare', payment, null, requestTimeout)
  const preparations = await Promise.all(urls.slice(1).map(url => ask(url, 'prepare', payment, quote.quote_block, requestTimeout)))
  if (preparations.some(q => unsigned(q) !== unsigned(quote))) throw new Error('accountants disagree on reservation')
  const authorized = await ask(urls[0]!, 'authorize', payment, quote.quote_block, requestTimeout)
  if (unsigned(authorized) !== unsigned(quote)) throw new Error('authorization changed the prepared reservation')
  const requestId = prepaidRequestId(payment)
  const args = [payment.slot, BigInt(quote.legacy_nonce), quote.quote_block, [requestId], [BigInt(quote.costs[0]!)], BigInt(quote.deadline)] as const
  const data = encodeFunctionData({abi: settlementAbi, functionName: 'reservePrepaidBls', args: [...args, authorized.signature!]})
  const block = await client.getBlock({blockHash: quote.quote_block})
  const fresh = () => {
    if (block.number === null || block.hash === null || !same(block.hash, quote.quote_block)
      || BigInt(now()) - block.timestamp > 30n || block.timestamp - BigInt(now()) > 2n) throw new Error('reservation quote block is stale or invalid')
    live(payment, quote)
  }
  fresh()
  const call = async (to: Address, data: Hex) => {
    const result = await client.call({to, data, account: wallet.account, blockHash: quote.quote_block, requireCanonical: true, batch: false})
    if (result.data === undefined) throw new Error('empty reservation observation')
    return result.data
  }
  const digest = decodeFunctionResult({abi: settlementAbi, functionName: 'prepaidReserveDigest', data: await call(d.settlement,
    encodeFunctionData({abi: settlementAbi, functionName: 'prepaidReserveDigest', args}))})
  if (!same(digest, quote.digest)) throw new Error('deployment reservation digest mismatch')
  const previousCost = decodeFunctionResult({abi: settlementAbi, functionName: 'prepaidCost', data: await call(d.settlement,
    encodeFunctionData({abi: settlementAbi, functionName: 'prepaidCost', args: [payment.slot, requestId]}))})
  if (previousCost !== 0n) throw new Error('operation already reserved; inspect its receipt instead of spending again')
  const slot = decodeFunctionResult({abi: keyRegistryAbi, functionName: 'getKeySlot', data: await call(d.keyRegistry,
    encodeFunctionData({abi: keyRegistryAbi, functionName: 'getKeySlot', args: [payment.slot]}))})
  const creator = await recoverTypedDataAddress({...paymentIntentTypedData(payment), signature: payment.signature})
  if (!slot.exists || slot.cancelled || (slot.expiry !== 0n && slot.expiry <= BigInt(now())) || !same(creator, slot.creator)) throw new Error('reservation intent is not from an active slot creator')
  // Contract simulation verifies the accountant threshold signature and reservation state without gas.
  await client.call({to: d.settlement, data, account: wallet.account, blockHash: quote.quote_block, requireCanonical: true, batch: false})
  const [gasPrice, gas, nonce] = await Promise.all([
    client.getGasPrice(), client.estimateGas({account: wallet.account, to: d.settlement, data, value: 0n}),
    client.getTransactionCount({address: wallet.account.address, blockTag: 'pending'}),
  ])
  if (gas <= 0n || gas > opts.maxGas || gasPrice <= 0n || gasPrice > opts.maxGasPrice) throw new Error('reservation exceeds native gas budget')
  if (block.number === null) throw new Error('reservation quote has no block number')
  const canonical = await client.getBlock({blockNumber: block.number})
  if (canonical.hash === null || !same(canonical.hash, quote.quote_block)) throw new Error('reservation quote reorganized')
  fresh()
  const record: PaidReservationRecord = {schema: 1, requestId, payment, quote: authorized,
    transaction: {chainId: d.chainId, from: wallet.account.address, to: d.settlement, data, value: '0', nonce, gas: gas.toString(), gasPrice: gasPrice.toString()}}
  await opts.persist({phase: 'prepared', record: structuredClone(record)})
  let transactionHash: Hex | undefined
  try {
    fresh()
    // Viem's generic sendTransaction can retry through wallet_sendTransaction on certain
    // RPC errors. Use exactly one RPC submission, including when the outcome is uncertain.
    if (wallet.account.type === 'local') {
      const raw = await wallet.signTransaction({account: wallet.account, chain: wallet.chain,
        to: d.settlement, data, value: 0n, nonce, gas, gasPrice, type: 'legacy'})
      transactionHash = await wallet.request({method: 'eth_sendRawTransaction', params: [raw]}, {retryCount: 0})
      if (transactionHash === undefined || !same(transactionHash, keccak256(raw))) throw new Error('RPC returned another signed transaction hash')
    } else {
      transactionHash = await wallet.request({method: 'eth_sendTransaction', params: [{from: wallet.account.address,
        to: d.settlement, data, value: '0x0', nonce: toHex(nonce), gas: toHex(gas), gasPrice: toHex(gasPrice),
        type: '0x0', chainId: toHex(d.chainId)}]}, {retryCount: 0})
    }
    if (typeof transactionHash !== 'string' || !HEX32.test(transactionHash) || /^0x0{64}$/i.test(transactionHash)) throw new Error('invalid reservation transaction hash')
    await opts.persist({phase: 'submitted', requestId, transactionHash})
    const mined = await client.waitForTransactionReceipt({hash: transactionHash, confirmations, timeout: receiptTimeout, pollingInterval: 1000, retryCount: 0})
    if (!same(mined.transactionHash, transactionHash) || mined.status !== 'success') throw new Error('reservation transaction reverted or was replaced')
    const transaction = await client.getTransaction({hash: transactionHash})
    if (transaction.to === null || !same(transaction.to, d.settlement) || !same(transaction.from, record.transaction.from)
      || !same(transaction.input, data) || transaction.value !== 0n || transaction.nonce !== nonce
      || transaction.type !== 'legacy' || transaction.gas !== gas || transaction.gasPrice !== gasPrice || transaction.chainId !== d.chainId
      || transaction.blockHash === null || !same(transaction.blockHash, mined.blockHash)) throw new Error('mined transaction differs from the durable reservation')
    const receipt = await readPaidOperationReceipt(client, d, payment, operation)
    if (receipt.blockNumber < mined.blockNumber || receipt.cost !== BigInt(quote.costs[0]!) || !same(receipt.assignmentBlock, quote.quote_block)) throw new Error('mined reservation differs from the saved quote')
    const minedBlock = await client.getBlock({blockNumber: mined.blockNumber})
    if (minedBlock.hash === null || !same(minedBlock.hash, mined.blockHash)) throw new Error('reservation receipt reorganized')
    await opts.persist({phase: 'confirmed', requestId, transactionHash, blockHash: mined.blockHash})
    return {transactionHash, receipt}
  } catch (cause) { throw new PaidReservationUncertainError(requestId, transactionHash, cause) }
}
