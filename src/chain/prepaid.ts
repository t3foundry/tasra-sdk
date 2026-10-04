import {decodeFunctionResult, encodeFunctionData, keccak256, recoverTypedDataAddress, toHex, type Abi, type Address, type Hex, type PublicClient, type ReadContractReturnType} from 'viem'
import {ed25519} from '@noble/curves/ed25519'
import {UnderfundedSlotError} from '../errors.js'
import {hexToBytes} from '../crypto/hex.js'
import {assertPaymentIntentWire, keeperAssignmentCommitment, paymentIntentTypedData, prepaidRequestId, type PaymentIntentWire} from '../committee/payment.js'
import {settlementAbi} from './abis/settlement.js'
import {keyRegistryAbi} from './abis/keyRegistry.js'
import {nodeRegistryAbi} from './abis/nodeRegistry.js'
import {thresholdRandomBeaconAbi} from './abis/thresholdRandomBeacon.js'
import {verifierSetRegistryAbi} from './abis/verifierSetRegistry.js'
import {accountantSetRegistryAbi} from './abis/accountantSetRegistry.js'

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

/** Currently eligible registered keeper selected in the creator's paid assignment. */
export interface PaidKeeperEndpoint {
  /** Registered payout/operator address. */
  operator: Address
  /** Registered Ed25519 key. */
  publicKey: Hex
  /** Exact registered HTTP(S) base URL, checked against the selected transport policy. */
  url: string
}

/** The single coordinator and contributor set selected by the creator's paid assignment. */
export interface PaidKeeperTarget extends PaidKeeperEndpoint {
  /** Chain-backed reservation observation; never substitutes for holder authorization. */
  receipt: PaidOperationReceipt
  /** Exact signed contributor set, for operations that request individual shares. */
  contributors: PaidKeeperEndpoint[]
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

/** Independently approved deployment used to discover a payment before creator signing. */
export interface PaidContextDeployment extends PrepaidDeployment {
  /** Expected anchored verifier-set registry. */
  verifierSet: Address
  /** Expected accountant snapshot registry used by reservation approval. */
  accountantSet: Address
  /** Expected threshold beacon, also checked through registry pointers. */
  beacon: Address
}

/** Explicit application policy for selecting currently eligible paid workers. */
export interface PaidContextOptions extends PaidKeeperTransportOptions {
  /** Requested registered coordinator; otherwise the eligible keeper with the lowest operator ID. */
  coordinator?: Address
  /** Independently approved deployed verifier defaults; required only for a zero slot override. */
  defaultVerificationPolicy?: {committee: number; quorum: number}
}

/** Chain-derived fields safe to copy into the creator's independently bounded payment intent. */
export type DiscoveredPaymentFields = Pick<PaymentIntentWire, 'chain_id' | 'settlement' | 'key_registry' | 'slot' | 'verification_epoch' | 'verification_seed' | 'verification_root' | 'verification_registry_size' | 'verification_committee' | 'verification_quorum' | 'keeper_assignment'>

/** One canonical pre-signing observation; later reservation and execution must revalidate it. */
export interface PaidOperationContext extends PrepaidObservation {
  /** Chain and assignment fields; add the exact action/digest, cap, nonce, expiry and session commitment before signing. */
  intentFields: DiscoveredPaymentFields
  /** On-chain slot creator whose EIP-712 signature authorizes spending. */
  creator: Address
  /** Slot mode ordinal for selecting the operation client. */
  mode: number
  /** Published group key, independently verified again during execution. */
  groupPublicKey: Hex
  /** Selected eligible keeper coordinator. */
  coordinator: PaidKeeperEndpoint
  /** All currently eligible assigned contributors in canonical public-key order. */
  contributors: PaidKeeperEndpoint[]
  /** Unreserved slot TASRA at this block; it is not a reservation or an operation quote. */
  available: bigint
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
  deployment = {...deployment}
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
  deployment = {...deployment}; payment = structuredClone(payment); expected = {...expected}
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
  deployment = {...deployment}; payment = structuredClone(payment); expected = {...expected}; transport = {...transport}
  const receipt = await readPaidOperationReceipt(client, deployment, payment, expected)
  if (receipt.settled) throw new Error('payment already settled; it cannot start another keeper operation')
  if (BigInt(payment.expires) <= time()) throw new Error('payment expired; reconcile before starting another operation')
  const {slot, members} = await keeperDirectory(client, receipt, deployment.keyRegistry, payment.slot)
  const assignment = payment.keeper_assignment
  if (slot.epoch !== BigInt(assignment.key_epoch) || slot.committeeVersion !== BigInt(assignment.committee_version) || slot.threshold.k !== assignment.threshold) throw new Error('payment keeper sharing or threshold changed')
  const creator = await recoverTypedDataAddress({...paymentIntentTypedData(payment), signature: payment.signature})
  if (creator.toLowerCase() !== slot.creator.toLowerCase()) throw new Error('payment is not signed by the slot creator')
  const endpoint = (key: Hex) => keeperEndpoint(members, key, deployment.chainId, transport)
  const contributors = assignment.contributors.map(key => endpoint(toHex(Uint8Array.from(key))))
  const coordinator = endpoint(toHex(Uint8Array.from(assignment.coordinator)))
  await finishObservation(client, receipt)
  if (BigInt(payment.expires) <= time()) throw new Error('payment expired during coordinator discovery')
  return {...coordinator, receipt, contributors, groupPublicKey: slot.publicKey, mode: slot.mode}
}

interface KeeperDirectoryMember {key: Hex; id: bigint; operator: Address; url: string; eligible: boolean}
async function keeperDirectory(client: PublicClient, at: PrepaidObservation, registry: Address, slotId: Hex) {
  const [slot, assigned, nodes] = await Promise.all([
    registryRead(client, at, registry, keyRegistryAbi, 'getKeySlot', [slotId]) as Promise<ReadContractReturnType<typeof keyRegistryAbi, 'getKeySlot'>>,
    registryRead(client, at, registry, keyRegistryAbi, 'assignedNodes', [slotId]) as Promise<readonly Address[]>,
    registryRead(client, at, registry, keyRegistryAbi, 'nodeRegistry') as Promise<Address>,
  ])
  if (!slot.exists || slot.cancelled || (slot.expiry !== 0n && slot.expiry <= at.blockTimestamp) || slot.publicKey === '0x') throw new Error('paid slot is inactive or has no published key')
  if (!ADDRESS.test(nodes) || /^0x0{40}$/i.test(nodes) || assigned.length === 0 || assigned.length > 256
    || assigned.length !== slot.threshold.n || slot.threshold.k === 0 || slot.threshold.k > slot.threshold.n
    || new Set(assigned.map(a => a.toLowerCase())).size !== assigned.length || assigned.some(a => /^0x0{40}$/i.test(a))) throw new Error('invalid assigned keeper roster')
  const members = new Map<Hex, KeeperDirectoryMember>()
  const ids = new Set<bigint>()
  // Bound RPC fanout even on maximum-size slots. Do not silently drop unreadable members.
  for (let offset = 0; offset < assigned.length; offset += 8) {
    const batch = await Promise.all(assigned.slice(offset, offset + 8).map(async operator => {
      const [node, id, tagged] = await Promise.all([
        registryRead(client, at, nodes, nodeRegistryAbi, 'nodeOf', [operator]) as Promise<ReadContractReturnType<typeof nodeRegistryAbi, 'nodeOf'>>,
        registryRead(client, at, nodes, nodeRegistryAbi, 'operatorIdOf', [operator]) as Promise<bigint>,
        registryRead(client, at, nodes, nodeRegistryAbi, 'hasTag', [operator, keccak256(toHex('keykeeper'))]) as Promise<boolean>,
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
  return {slot, members}
}

function keeperEndpoint(members: Map<Hex, KeeperDirectoryMember>, key: Hex, chainId: number, transport: PaidKeeperTransportOptions): PaidKeeperEndpoint {
  const member = members.get(key)
  if (!member?.eligible) throw new Error('paid contributor is not an eligible assigned keeper')
  const url = new URL(member.url)
  if (url.username || url.password || url.search || url.hash
    || (url.protocol !== 'https:' && !(transport.allowLocalHttp === true && chainId === 43112 && url.protocol === 'http:'))) throw new Error('invalid paid keeper URL or transport')
  return {operator: member.operator, publicKey: key, url: url.toString().replace(/\/$/, '')}
}

function safeInteger(value: bigint, name: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${name} exceeds the JSON integer range`)
  return Number(value)
}

/**
 * Discover keeper sharing and verifier policy from one fresh canonical block before creating an intent.
 * Selects the current epoch with both verifier and accountant snapshots, otherwise its immediate predecessor.
 * Performs no signing, reservation, service contact or gas/TASRA mutation.
 * @param client - Trusted bounded Viem client supporting EIP-1898 canonical reads.
 * @param deployment - Independently approved contract and beacon addresses.
 * @param slotId - Independently selected slot to fund and operate.
 * @param options - Approved default verifier policy, optional coordinator and transport policy.
 */
export async function discoverPaidOperationContext(
  client: PublicClient, deployment: PaidContextDeployment, slotId: Hex, options: PaidContextOptions = {},
): Promise<PaidOperationContext> {
  deployment = {...deployment}; options = structuredClone(options)
  validateDeployment(deployment)
  if (!HEX32.test(slotId) || [deployment.verifierSet, deployment.accountantSet, deployment.beacon, ...(options.coordinator ? [options.coordinator] : [])]
    .some(address => !ADDRESS.test(address) || /^0x0{40}$/i.test(address))) throw new Error('invalid payment discovery identity')
  const at = await observe(client, deployment)
  const [keyBeacon, snapshotBeacon, accountantBeacon, latest, policy, enabled, available, directory] = await Promise.all([
    registryRead(client, at, deployment.keyRegistry, keyRegistryAbi, 'randomBeacon') as Promise<Address>,
    registryRead(client, at, deployment.verifierSet, verifierSetRegistryAbi, 'beacon') as Promise<Address>,
    registryRead(client, at, deployment.accountantSet, accountantSetRegistryAbi, 'beacon') as Promise<Address>,
    registryRead(client, at, deployment.beacon, thresholdRandomBeaconAbi, 'epoch') as Promise<bigint>,
    registryRead(client, at, deployment.keyRegistry, keyRegistryAbi, 'verifierPolicy', [slotId]) as Promise<readonly [number, number]>,
    readAt(client, deployment.settlement, at, 'prepaidEnabled', slotId),
    readAt(client, deployment.settlement, at, 'balanceOf', slotId),
    keeperDirectory(client, at, deployment.keyRegistry, slotId),
  ])
  if ([keyBeacon, snapshotBeacon, accountantBeacon].some(pointer => pointer.toLowerCase() !== deployment.beacon.toLowerCase())) throw new Error('payment discovery beacon pointers differ')
  if (enabled !== true || typeof available !== 'bigint' || available < 0n) throw new Error('payment discovery requires an activated TASRA-funded slot')
  if (available === 0n) throw new UnderfundedSlotError({slotId, availableTasraUnits: available,
    message: 'payment discovery requires an activated TASRA-funded slot'})
  const seedAt = (epoch: bigint) => registryRead(client, at, deployment.beacon, thresholdRandomBeaconAbi, 'seedAt', [epoch]) as Promise<Hex>
  const snapshotAt = (epoch: bigint) => registryRead(client, at, deployment.verifierSet, verifierSetRegistryAbi, 'snapshotAt', [epoch]) as Promise<readonly [Hex, number]>
  const accountantAt = (epoch: bigint) => registryRead(client, at, deployment.accountantSet, accountantSetRegistryAbi, 'snapshotAt', [epoch]) as Promise<readonly [Hex, number]>
  const complete = (seed: Hex, root: Hex, size: number, accountant: readonly [Hex, number]) =>
    seed !== ZERO32 && root !== ZERO32 && size > 0 && accountant[0] !== ZERO32 && accountant[1] > 0 && accountant[1] <= 65535
  let epoch = latest
  let [seed, [root, size], accountant] = await Promise.all([seedAt(epoch), snapshotAt(epoch), accountantAt(epoch)])
  if (seed === ZERO32) throw new Error('current beacon seed unavailable')
  if (!complete(seed, root, size, accountant)) {
    if (epoch === 0n) throw new Error('no anchored verifier and accountant snapshots')
    epoch--
    ;[seed, [root, size], accountant] = await Promise.all([seedAt(epoch), snapshotAt(epoch), accountantAt(epoch)])
    if (!complete(seed, root, size, accountant)) throw new Error('no current or previous anchored verifier and accountant snapshots')
  }
  const [onChainCommittee, onChainQuorum] = policy
  if (onChainCommittee === 0 && onChainQuorum !== 0) throw new Error('invalid on-chain verifier policy')
  const {committee, quorum} = onChainCommittee === 0
    ? options.defaultVerificationPolicy ?? {committee: 0, quorum: 0}
    : {committee: onChainCommittee, quorum: onChainQuorum}
  if (!Number.isInteger(committee) || !Number.isInteger(quorum) || quorum <= 0 || quorum > committee || committee > 4096 || committee > size) throw new Error('missing or invalid approved verifier policy')
  const members = [...directory.members.values()].filter(member => member.eligible).sort((a, b) => a.id < b.id ? -1 : 1)
  const selected = members.find(member => !options.coordinator || member.operator.toLowerCase() === options.coordinator.toLowerCase())
  if (!selected) throw new Error('requested coordinator is not an eligible assigned keeper')
  const contributors = members.map(member => member.key).sort()
  const assignment = {key_epoch: safeInteger(directory.slot.epoch, 'keeper epoch'), committee_version: safeInteger(directory.slot.committeeVersion, 'committee version'),
    threshold: directory.slot.threshold.k, coordinator: [...hexToBytes(selected.key)], contributors: contributors.map(key => [...hexToBytes(key)])}
  keeperAssignmentCommitment(assignment)
  const endpoints = contributors.map(key => keeperEndpoint(directory.members, key, deployment.chainId, options))
  const coordinator = keeperEndpoint(directory.members, selected.key, deployment.chainId, options)
  const intentFields: DiscoveredPaymentFields = {chain_id: deployment.chainId, settlement: deployment.settlement, key_registry: deployment.keyRegistry, slot: slotId,
    verification_epoch: safeInteger(epoch, 'verification epoch'), verification_seed: seed, verification_root: root, verification_registry_size: size,
    verification_committee: committee, verification_quorum: quorum, keeper_assignment: assignment}
  await finishObservation(client, at)
  return {...at, intentFields, creator: directory.slot.creator, mode: directory.slot.mode, groupPublicKey: directory.slot.publicKey, coordinator, contributors: endpoints, available}
}
