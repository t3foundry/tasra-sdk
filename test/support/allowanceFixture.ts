// Shared hermetic fixture for the ADR-0090 allowance suites: a mocked RPC (Settlement, KeyRegistry,
// beacon) and mocked accountants that answer allowance quotes and debit partials with REAL BN254
// partials of a fixed 2-of-3 sharing (keykeeper-bls's fixture_2_of_3 polynomial).
import {vi} from 'vitest'
import {createPublicClient, createWalletClient, custom, decodeFunctionData, defineChain, encodeFunctionResult, keccak256, parseTransaction, toHex,
  type Abi, type Account, type Chain, type Hex, type PublicClient, type Transport, type WalletClient} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {keccak_256} from '@noble/hashes/sha3'
import {bn254, bn254_Fr} from '@noble/curves/bn254'
import {bytesToNumberBE} from '@noble/curves/utils.js'
import {settlementAbi} from '../../src/chain/abis/settlement.js'
import {keyRegistryAbi} from '../../src/chain/abis/keyRegistry.js'
import {thresholdRandomBeaconAbi} from '../../src/chain/abis/thresholdRandomBeacon.js'
import {configurePinnedReads} from '../../src/chain/pinnedReads.js'
import {allowanceId, allowanceReserveDigest, debitVoucherDigest, prepaidAllowanceIntentHash, prepaidAllowanceIntentTypedData, prepaidRequestId,
  type PaymentIntentWire, type PrepaidAllowanceIntentWire} from '../../src/committee/payment.js'
import {encodeG1, encodeG2, hashToG1} from '../../src/crypto/bn254.js'
import {hexToBytes} from '../../src/crypto/hex.js'

export const h = (n: number, len = 32): Hex => `0x${n.toString(16).padStart(2, '0').repeat(len)}`
export const NOW = 1000
export const deployment = {chainId: 43112, settlement: h(1, 20), keyRegistry: h(2, 20), beacon: h(9, 20)}
export const slot = h(3)
export const creator = privateKeyToAccount(h(11))
export const assignment = {key_epoch: 1, committee_version: 2, threshold: 2, coordinator: Array<number>(32).fill(9), contributors: [9, 10, 11].map(n => Array<number>(32).fill(n))}
const localChain = defineChain({id: 43112, name: 'local', nativeCurrency: {name: 'AVAX', symbol: 'AVAX', decimals: 18}, rpcUrls: {default: {http: ['http://127.0.0.1:1']}}})

const fr = (label: string) => bn254_Fr.create(bytesToNumberBE(keccak_256(new TextEncoder().encode(label))))
const a0 = fr('keykeeper/bn254/test/a0'), a1 = fr('keykeeper/bn254/test/a1')
export const shares = [1n, 2n, 3n].map(x => bn254_Fr.add(a0, bn254_Fr.mul(a1, x)))
export const groupKey = toHex(encodeG2(bn254.G2.ProjectivePoint.BASE.multiply(a0)))
export const verifyingShare = (i: number) => toHex(encodeG2(bn254.G2.ProjectivePoint.BASE.multiply(shares[i]!)))
export const partialOf = (i: number, digest: Hex) => toHex(encodeG1(hashToG1(hexToBytes(digest)).multiply(shares[i]!)))

export function allowanceIntentFields(over: Partial<PrepaidAllowanceIntentWire> = {}): Omit<PrepaidAllowanceIntentWire, 'signature'> {
  return {chain_id: 43112, settlement: deployment.settlement, key_registry: deployment.keyRegistry, slot, intent_nonce: h(0x23), amount: '1000', max_op_cost: '100',
    actions: 79, expires_at: NOW + 3600, verification_epoch: 7, verification_seed: h(0x24), verification_root: h(0x25), verification_registry_size: 5,
    verification_committee: 3, verification_quorum: 2, keeper_assignment: structuredClone(assignment), ...over}
}
export async function signedAllowanceIntent(over: Partial<PrepaidAllowanceIntentWire> = {}): Promise<PrepaidAllowanceIntentWire> {
  const unsigned = allowanceIntentFields(over)
  return {...unsigned, signature: await creator.signTypedData(prepaidAllowanceIntentTypedData(unsigned))}
}

/** One mined allowance record the mocked Settlement returns (zero = never reserved). */
export interface MinedAllowance {slotId: Hex; assignmentBlock: Hex; amount: bigint; spent: bigint; maxOpCost: bigint; expiresAt: bigint; reservedAt: bigint; actions: number; closed: boolean}
export interface MemberBehaviour {
  /** HTTP status instead of a partial. */
  status?: number
  /** Answer a partial over another digest (byzantine). */
  forge?: boolean
  /** Transport failure. */
  down?: boolean
}
export interface ChainChanges {
  allowance?: Partial<MinedAllowance>
  settled?: boolean
  prepaidCost?: bigint
  members?: MemberBehaviour[]
  cost?: bigint
  /** Group key the beacon reports (default the fixture key). */
  mpk?: Hex
}

export interface AllowanceWorld {
  client: PublicClient; wallet: WalletClient<Transport, Chain, Account>; fetcher: ReturnType<typeof vi.fn>; trace: string[]
  debits: {url: string; body: {intent: PaymentIntentWire; seq: number; previous: unknown; quote_block: Hex}}[]
  /** Bodies of `POST .../vouchers`, raw. */
  pushes: {url: string; raw: string}[]
  mined: {record?: MinedAllowance}; transactions: Hex[]; accountantUrls: string[]
}
export function allowanceWorld(change: ChainChanges = {}): AllowanceWorld {
  vi.spyOn(Date, 'now').mockReturnValue(NOW * 1000)
  const trace: string[] = []
  const debits: {url: string; body: {intent: PaymentIntentWire; seq: number; previous: unknown; quote_block: Hex}}[] = []
  const mined: {record?: MinedAllowance} = {}
  const pushes: {url: string; raw: string}[] = []
  let txHash = h(77)
  const transactions: Hex[] = []
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input), body = JSON.parse(init?.body as string) as Record<string, unknown>
    trace.push(url)
    if (url.endsWith('/vouchers')) {
      const member = Number(/acct(\d)/.exec(url)![1]), behaviour = change.members?.[member] ?? {}
      pushes.push({url, raw: init?.body as string})
      if (behaviour.down) throw new TypeError('fetch failed')
      if (behaviour.status) return new Response('refused by test', {status: behaviour.status})
      return Response.json({seq: (body as {seq: number}).seq, recorded: 'attached'})
    }
    if (url.includes('/v1/prepaid/allowances/') && url.endsWith('/debits')) {
      const member = Number(/acct(\d)/.exec(url)![1])
      const behaviour = change.members?.[member] ?? {}
      debits.push({url, body: body as (typeof debits)[number]['body']})
      if (behaviour.down) throw new TypeError('fetch failed')
      if (behaviour.status) return new Response('refused by test', {status: behaviour.status})
      const request = body as {intent: PaymentIntentWire; seq: number; previous: {cumulative: string} | null; quote_block: Hex}
      const cost = change.cost ?? 40n, cumulative = (request.previous ? BigInt(request.previous.cumulative) : 0n) + cost
      const requestId = prepaidRequestId(request.intent)
      const digest = debitVoucherDigest(deployment.settlement, 43112, {allowanceId: request.intent.allowance_id!, seq: BigInt(request.seq), requestId,
        cost, cumulative, quoteBlock: request.quote_block})
      return Response.json({allowance_id: request.intent.allowance_id, seq: request.seq, request_id: requestId, cost: cost.toString(), cumulative: cumulative.toString(),
        quote_block: request.quote_block, digest, identifier: member + 1, partial: partialOf(member, behaviour.forge ? keccak256('0x01') : digest),
        verifying_share: verifyingShare(member), sharing: h(0x5e), threshold: 2, members: 3})
    }
    const method = url.endsWith('/authorize') ? 'authorize' : 'prepare'
    const {intent, quote_block} = body as {intent: PrepaidAllowanceIntentWire; quote_block: Hex | null}
    const intentHash = prepaidAllowanceIntentHash(intent), id = allowanceId(43112, deployment.settlement, intent.slot, intentHash)
    const quoteBlock = quote_block ?? h(19), deadline = NOW + 60
    const digest = allowanceReserveDigest(deployment.settlement, 43112, {slot: intent.slot, legacyNonce: 0n, allowanceId: id, amount: BigInt(intent.amount),
      maxOpCost: BigInt(intent.max_op_cost), actions: intent.actions, expiresAt: BigInt(intent.expires_at), assignmentBlock: quoteBlock, deadline: BigInt(deadline)})
    return Response.json({slot: intent.slot, allowance_id: id, intent_hash: intentHash, quote_block: quoteBlock, legacy_nonce: 0, amount: intent.amount,
      max_op_cost: intent.max_op_cost, actions: intent.actions, expires_at: intent.expires_at, deadline, digest,
      signature: method === 'authorize' ? h(7, 64) : null, mined: false})
  })
  vi.stubGlobal('fetch', fetcher)
  const zeroAllowance = (): MinedAllowance => ({slotId: h(0), assignmentBlock: h(0), amount: 0n, spent: 0n, maxOpCost: 0n, expiresAt: 0n, reservedAt: 0n, actions: 0, closed: false})
  const respond = async ({method, params}: {method: string; params?: unknown}): Promise<unknown> => {
    trace.push(method)
    if (method === 'eth_chainId') return toHex(43112)
    if (method === 'eth_getBlockByHash') return {number: '0x13', hash: (params as Hex[])[0], timestamp: toHex(NOW), transactions: []}
    if (method === 'eth_getBlockByNumber') {
      const at = (params as unknown[])[0]
      const n = at === 'latest' ? 20 : Number(BigInt(at as Hex))
      return {number: toHex(n), hash: h(n), timestamp: toHex(NOW), transactions: []}
    }
    if (method === 'eth_call') {
      const [call] = params as [{to: Hex; data: Hex}]
      const abi: Abi = call.to.toLowerCase() === deployment.keyRegistry ? keyRegistryAbi : call.to.toLowerCase() === deployment.beacon ? thresholdRandomBeaconAbi : settlementAbi
      const {functionName} = decodeFunctionData({abi, data: call.data})
      if (functionName === 'reservePrepaidAllowanceBls') return '0x'
      const record = {...(mined.record ?? zeroAllowance()), ...change.allowance}
      const values: Record<string, unknown> = {
        prepaidAllowance: [record.slotId, record.assignmentBlock, record.amount, record.spent, record.maxOpCost, record.expiresAt, record.reservedAt, record.actions, record.closed],
        getKeySlot: {creator: creator.address, ruleCommitment: h(33), threshold: {k: 2, n: 3}, mode: 0, publicKey: h(44), epoch: 1n, committeeVersion: 2n, exists: true,
          cancelled: false, expiry: 0n, ruleVersion: 1n, auth: 0},
        beacon: deployment.beacon, mpk: change.mpk ?? groupKey,
        prepaidEnabled: true, prepaidCost: change.prepaidCost ?? 0n, prepaidSettled: change.settled ?? false, prepaidRefunded: 0n,
      }
      return encodeFunctionResult({abi, functionName, result: values[functionName]})
    }
    if (method === 'eth_gasPrice') return toHex(25n)
    if (method === 'eth_estimateGas') return toHex(100000n)
    if (method === 'eth_getBalance') return toHex(10n ** 18n)
    if (method === 'eth_getTransactionCount') return toHex(4)
    if (method === 'eth_sendRawTransaction') {
      const raw = (params as Hex[])[0]!
      transactions.push(raw)
      txHash = keccak256(raw)
      const tx = parseTransaction(raw)
      const {args} = decodeFunctionData({abi: settlementAbi, data: tx.data!}) as unknown as {args: [{slotId: Hex; amount: bigint; maxOpCost: bigint; expiresAt: bigint; actions: number; assignmentBlock: Hex}]}
      const r = args[0]
      mined.record = {slotId: r.slotId, assignmentBlock: r.assignmentBlock, amount: r.amount, spent: 0n, maxOpCost: r.maxOpCost, expiresAt: r.expiresAt, reservedAt: BigInt(NOW), actions: r.actions, closed: false}
      return txHash
    }
    if (method === 'eth_getTransactionByHash') {
      const tx = parseTransaction(transactions[0]!)
      return {from: creator.address, to: tx.to, input: tx.data, value: '0x0', gas: toHex(tx.gas!), gasPrice: toHex(tx.gasPrice!), nonce: toHex(tx.nonce!),
        chainId: toHex(43112), type: '0x0', hash: txHash, blockHash: h(20), blockNumber: '0x14', transactionIndex: '0x0', v: '0x1b', r: h(1), s: h(2)}
    }
    if (method === 'eth_getTransactionReceipt') return {transactionHash: txHash, blockHash: h(20), blockNumber: '0x14', transactionIndex: '0x0', from: creator.address,
      to: deployment.settlement, cumulativeGasUsed: '0x186a0', gasUsed: '0x186a0', contractAddress: null, logs: [], logsBloom: '0x' + '00'.repeat(256), status: '0x1', effectiveGasPrice: '0x19', type: '0x0'}
    throw new Error(`unexpected RPC ${method}`)
  }
  const transport = custom({request: respond}, {retryCount: 0})
  const client = createPublicClient({chain: localChain, transport}) as PublicClient
  configurePinnedReads(client, false)
  const wallet = createWalletClient({chain: localChain, account: creator, transport})
  return {client, wallet, fetcher, trace, debits, pushes, mined, transactions, accountantUrls: ['https://acct0.example', 'https://acct1.example', 'https://acct2.example']}
}
