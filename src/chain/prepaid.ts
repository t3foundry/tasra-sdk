import {decodeFunctionResult, encodeFunctionData, keccak256, recoverTypedDataAddress, toHex, type Abi, type Address, type Hex, type PublicClient, type ReadContractReturnType} from 'viem'
import {ed25519} from '@noble/curves/ed25519'
import {hexToBytes} from '../crypto/hex.js'
import {assertPaymentIntentWire, paymentIntentTypedData, prepaidRequestId, type PaymentIntentWire} from '../committee/payment.js'
import {settlementAbi} from './abis/settlement.js'
import {keyRegistryAbi} from './abis/keyRegistry.js'
import {nodeRegistryAbi} from './abis/nodeRegistry.js'

/** Deployment independently selected by the application, not taken from a received intent. */
export interface PrepaidDeployment {
  /** Expected EVM chain ID. */
  chainId: number
  /** Expected Settlement proxy. */
  settlement: Address
  /** Expected KeyRegistry proxy. */
  keyRegistry: Address
}

/** Fresh canonical observation shared by every field in a funding or reservation result. */
export interface PrepaidObservation {
  /** Canonical block number. */
  blockNumber: bigint
  /** Exact canonical block used for EIP-1898 calls. */
  blockHash: Hex
  /** Block timestamp in Unix seconds. */
  blockTimestamp: bigint
}

/** Slot TASRA balances at a single canonical block; this does not grant paid admission. */
export interface SlotFunding extends PrepaidObservation {
  /** Slot identifier. */
  slot: Hex
  /** Whether the slot has prepaid mode enabled. */
  enabled: boolean
  /** Unreserved TASRA base units. */
  available: bigint
  /** TASRA base units held by unsettled reservations. */
  reserved: bigint
  /** Available plus reserved TASRA base units. */
  total: bigint
}

/** Chain backing for one operation; holder authorization and execution journals remain separate. */
export interface PaidOperationReceipt extends PrepaidObservation {
  /** Reservation identity derived locally from the payment intent. */
  requestId: Hex
  /** Original quoted assignment block committed by the reservation quorum. */
  assignmentBlock: Hex
  /** Original reserved TASRA base units, retained after settlement. */
  cost: bigint
  /** Whether final settlement has completed. This is not permission to execute again. */
  settled: boolean
  /** TASRA base units refunded to this slot during reconciliation. */
  refunded: bigint
}

/** Explicit expected operation, independent of the supplied payment. */
export interface ExpectedPaidOperation {
  /** Intended slot identifier. */
  slot: Hex
  /** Intended final key operation. */
  action: PaymentIntentWire['action']
  /** Independently derived exact operation payload digest. */
  payloadDigest: Hex
}

/** The single currently eligible coordinator selected by the creator's paid assignment. */
export interface PaidKeeperTarget {
  /** Chain-backed reservation observation; never substitutes for holder authorization. */
  receipt: PaidOperationReceipt
  /** Coordinator's registered payout/operator address. */
  operator: Address
  /** Coordinator's registered Ed25519 key. */
  publicKey: Hex
  /** Exact registered HTTP(S) base URL; there is no coordinator failover. */
  url: string
  /** Published slot group key for independently checking the operation result. */
  groupPublicKey: Hex
  /** Solidity KeyRegistry mode ordinal for selecting the matching key-operation client. */
  mode: number
}

/** Explicit transport allowance for a development chain. HTTPS is otherwise required. */
export interface PaidKeeperTransportOptions {
  /** Allow an HTTP coordinator only on local chain43112. Never enables HTTP on Fuji. */
  allowLocalHttp?: boolean
}

const ZERO32 = `0x${'00'.repeat(32)}`
const ADDRESS = /^0x[0-9a-f]{40}$/i
const HEX32 = /^0x[0-9a-f]{64}$/i
const MAX_AGE = 30n
const FUTURE_SKEW = 2n

function validateDeployment(d: PrepaidDeployment): void {
  if (!Number.isSafeInteger(d.chainId) || d.chainId <= 0) throw new Error('invalid prepaid chain ID')
  for (const address of [d.settlement, d.keyRegistry]) {
    if (!ADDRESS.test(address) || /^0x0{40}$/i.test(address)) throw new Error('invalid prepaid deployment address')
  }
}

function time(): bigint { return BigInt(Math.floor(Date.now() / 1000)) }

function requireFresh(at: PrepaidObservation): void {
  const now = time()
  if (now - at.blockTimestamp > MAX_AGE || at.blockTimestamp - now > FUTURE_SKEW) {
    throw new Error('prepaid observation is stale or future-dated')
  }
}

async function observe(client: PublicClient, d: PrepaidDeployment): Promise<PrepaidObservation> {
  validateDeployment(d)
  if (await client.getChainId() !== d.chainId) throw new Error('prepaid RPC chain mismatch')
  const block = await client.getBlock({blockTag: 'latest'})
  if (block.number === null || block.hash === null || !HEX32.test(block.hash) || block.hash === ZERO32 || block.timestamp < 0n) {
    throw new Error('prepaid canonical head unavailable')
  }
  const at = {blockNumber: block.number, blockHash: block.hash, blockTimestamp: block.timestamp}
  requireFresh(at)
  return at
}

type ReadName = 'prepaidEnabled' | 'balanceOf' | 'reservedBalanceOf' | 'prepaidCost' | 'prepaidSettled' | 'prepaidRefunded' | 'prepaidAssignmentBlock'

async function readAt(client: PublicClient, settlement: Address, at: PrepaidObservation, name: ReadName, slot: Hex, requestId?: Hex): Promise<unknown> {
  const data = requestId === undefined
    ? encodeFunctionData({abi: settlementAbi, functionName: name, args: [slot]})
    : encodeFunctionData({abi: settlementAbi, functionName: name, args: [slot, requestId]})
  const result = await client.call({to: settlement, data, blockHash: at.blockHash, requireCanonical: true, batch: false})
  if (result.data === undefined) throw new Error(`empty prepaid ${name} response`)
  return decodeFunctionResult({abi: settlementAbi, functionName: name, data: result.data})
}

async function finishObservation(client: PublicClient, at: PrepaidObservation): Promise<void> {
  // Recheck canonicality after all calls as well as requiring it on each individual call.
  // Never fall back to latest or a block number when EIP-1898 is unsupported.
  const current = await client.getBlock({blockNumber: at.blockNumber})
  if (current.hash?.toLowerCase() !== at.blockHash.toLowerCase()) throw new Error('prepaid observation reorganized during reads')
  requireFresh(at)
}

async function registryRead(client: PublicClient, at: PrepaidObservation, address: Address, abi: Abi, name: string, args: readonly unknown[] = []): Promise<unknown> {
  const data = encodeFunctionData({abi, functionName: name, args})
  const result = await client.call({to: address, data, blockHash: at.blockHash, requireCanonical: true, batch: false})
  if (result.data === undefined) throw new Error(`empty registry ${name} response`)
  return decodeFunctionResult({abi, functionName: name, data: result.data})
}

/**
 * Read available, reserved and total slot TASRA at one fresh canonical block. Performs no transaction.
 * @param client - Trusted bounded Viem RPC client for the selected deployment.
 * @param deployment - Independently approved chain and contract addresses.
 * @param slot - Slot whose TASRA balances are required.
 */
export async function readSlotFunding(client: PublicClient, deployment: PrepaidDeployment, slot: Hex): Promise<SlotFunding> {
  if (!HEX32.test(slot)) throw new Error('invalid funding slot')
  const at = await observe(client, deployment)
  const [enabled, available, reserved] = await Promise.all([
    readAt(client, deployment.settlement, at, 'prepaidEnabled', slot),
    readAt(client, deployment.settlement, at, 'balanceOf', slot),
    readAt(client, deployment.settlement, at, 'reservedBalanceOf', slot),
  ])
  if (typeof enabled !== 'boolean' || typeof available !== 'bigint' || typeof reserved !== 'bigint') throw new Error('invalid slot funding response')
  await finishObservation(client, at)
  return {...at, slot, enabled, available, reserved, total: available + reserved}
}

/**
 * Require mined backing for an independently selected operation, without spending or performing it.
 * A completed reservation remains inspectable. This result never authorizes another execution;
 * the keeper must independently verify the holder, current assignment and durable operation journal.
 * @param client - Trusted bounded Viem RPC client for the selected deployment.
 * @param deployment - Independently approved chain and contract addresses.
 * @param payment - Fixed creator-signed intent for the existing reservation.
 * @param expected - Slot, action and digest derived from the operation the application intends.
 */
export async function readPaidOperationReceipt(
  client: PublicClient, deployment: PrepaidDeployment, payment: PaymentIntentWire, expected: ExpectedPaidOperation,
): Promise<PaidOperationReceipt> {
  validateDeployment(deployment)
  assertPaymentIntentWire(payment)
  if (payment.chain_id !== deployment.chainId || payment.settlement.toLowerCase() !== deployment.settlement.toLowerCase()
    || payment.key_registry.toLowerCase() !== deployment.keyRegistry.toLowerCase()) throw new Error('payment deployment mismatch')
  if (payment.slot.toLowerCase() !== expected.slot.toLowerCase() || payment.action !== expected.action
    || payment.payload_digest.toLowerCase() !== expected.payloadDigest.toLowerCase()) throw new Error('payment operation mismatch')
  const requestId = prepaidRequestId(payment)
  const at = await observe(client, deployment)
  const names = ['prepaidEnabled', 'prepaidCost', 'prepaidSettled', 'prepaidRefunded', 'prepaidAssignmentBlock'] as const
  const [enabled, cost, settled, refunded, assignmentBlock] = await Promise.all(names.map(name =>
    readAt(client, deployment.settlement, at, name, payment.slot, name === 'prepaidEnabled' ? undefined : requestId)))
  if (enabled !== true || typeof cost !== 'bigint' || cost <= 0n || cost > BigInt(payment.max_cost)
    || typeof settled !== 'boolean' || typeof refunded !== 'bigint' || refunded < 0n || refunded > cost
    || (!settled && refunded !== 0n) || typeof assignmentBlock !== 'string' || !HEX32.test(assignmentBlock) || assignmentBlock === ZERO32) {
    throw new Error('operation has no valid reserved TASRA fee')
  }
  await finishObservation(client, at)
  return {...at, requestId, cost, settled, refunded, assignmentBlock: assignmentBlock as Hex}
}

/**
 * Resolve only the signed coordinator after checking mined backing, creator consent and current sharing.
 * Does not contact any keeper, submit a transaction, mint a credential grant or execute work.
 * @param client - Trusted bounded Viem RPC client for the selected deployment.
 * @param deployment - Independently approved chain and contract addresses.
 * @param payment - Creator-signed intent for the existing reservation.
 * @param expected - Independently derived slot, action and exact payload digest.
 * @param transport - Explicit local HTTP allowance; defaults to HTTPS only.
 */
export async function resolvePaidKeeperTarget(
  client: PublicClient, deployment: PrepaidDeployment, payment: PaymentIntentWire, expected: ExpectedPaidOperation,
  transport: PaidKeeperTransportOptions = {},
): Promise<PaidKeeperTarget> {
  const receipt = await readPaidOperationReceipt(client, deployment, payment, expected)
  if (BigInt(payment.expires) <= time()) throw new Error('payment expired; reconcile before starting another operation')
  const [slot, assigned, nodes] = await Promise.all([
    registryRead(client, receipt, deployment.keyRegistry, keyRegistryAbi, 'getKeySlot', [payment.slot]) as Promise<ReadContractReturnType<typeof keyRegistryAbi, 'getKeySlot'>>,
    registryRead(client, receipt, deployment.keyRegistry, keyRegistryAbi, 'assignedNodes', [payment.slot]) as Promise<readonly Address[]>,
    registryRead(client, receipt, deployment.keyRegistry, keyRegistryAbi, 'nodeRegistry') as Promise<Address>,
  ])
  const assignment = payment.keeper_assignment
  if (!slot.exists || slot.cancelled || (slot.expiry !== 0n && slot.expiry <= receipt.blockTimestamp) || slot.publicKey === '0x') throw new Error('paid slot is inactive or has no published key')
  if (!ADDRESS.test(nodes) || /^0x0{40}$/i.test(nodes) || assigned.length === 0 || assigned.length > 256
    || assigned.length !== slot.threshold.n || slot.threshold.k === 0 || slot.threshold.k > slot.threshold.n
    || new Set(assigned.map(a => a.toLowerCase())).size !== assigned.length || assigned.some(a => /^0x0{40}$/i.test(a))) throw new Error('invalid assigned keeper roster')
  if (slot.epoch !== BigInt(assignment.key_epoch) || slot.committeeVersion !== BigInt(assignment.committee_version) || slot.threshold.k !== assignment.threshold) throw new Error('payment keeper sharing or threshold changed')
  const creator = await recoverTypedDataAddress({...paymentIntentTypedData(payment), signature: payment.signature})
  if (creator.toLowerCase() !== slot.creator.toLowerCase()) throw new Error('payment is not signed by the slot creator')

  const members = new Map<Hex, {operator: Address; url: string; eligible: boolean}>()
  const ids = new Set<bigint>()
  // Bound RPC fanout even on maximum-size slots. Do not silently drop unreadable members.
  for (let offset = 0; offset < assigned.length; offset += 8) {
    const batch = await Promise.all(assigned.slice(offset, offset + 8).map(async operator => {
      const [node, id, tagged] = await Promise.all([
        registryRead(client, receipt, nodes, nodeRegistryAbi, 'nodeOf', [operator]) as Promise<ReadContractReturnType<typeof nodeRegistryAbi, 'nodeOf'>>,
        registryRead(client, receipt, nodes, nodeRegistryAbi, 'operatorIdOf', [operator]) as Promise<bigint>,
        registryRead(client, receipt, nodes, nodeRegistryAbi, 'hasTag', [operator, keccak256(toHex('keykeeper'))]) as Promise<boolean>,
      ])
      if (node.operator.toLowerCase() !== operator.toLowerCase() || !HEX32.test(node.pubkey) || node.pubkey === ZERO32 || id <= 0n || id >= 1n << 64n) throw new Error('invalid registered keeper identity')
      ed25519.ExtendedPoint.fromHex(hexToBytes(node.pubkey))
      return {key: node.pubkey.toLowerCase() as Hex, id, operator, url: node.url, eligible: node.active && tagged}
    }))
    for (const member of batch) {
      if (ids.has(member.id) || members.has(member.key)) throw new Error('ambiguous registered keeper identity')
      ids.add(member.id)
      members.set(member.key, member)
    }
  }
  for (const key of assignment.contributors) {
    if (!members.get(toHex(Uint8Array.from(key)))?.eligible) throw new Error('paid contributor is not an eligible assigned keeper')
  }
  const publicKey = toHex(Uint8Array.from(assignment.coordinator))
  const coordinator = members.get(publicKey)
  if (!coordinator?.eligible) throw new Error('paid coordinator is not eligible')
  const url = new URL(coordinator.url)
  if (url.username || url.password || url.search || url.hash
    || (url.protocol !== 'https:' && !(transport.allowLocalHttp === true && deployment.chainId === 43112 && url.protocol === 'http:'))) throw new Error('invalid paid coordinator URL or transport')
  await finishObservation(client, receipt)
  if (BigInt(payment.expires) <= time()) throw new Error('payment expired during coordinator discovery')
  return {receipt, operator: coordinator.operator, publicKey, url: url.toString().replace(/\/$/, ''), groupPublicKey: slot.publicKey, mode: slot.mode}
}
