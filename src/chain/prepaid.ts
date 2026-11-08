import {decodeFunctionResult, encodeFunctionData, keccak256, recoverTypedDataAddress, toHex, type Abi, type Address, type Hex, type PublicClient, type ReadContractReturnType} from 'viem'
import {ed25519} from '@noble/curves/ed25519'
import {randomBytes} from '@noble/hashes/utils'
import {UnderfundedSlotError} from '../errors.js'
import {hexToBytes} from '../crypto/hex.js'
import {assertPaymentIntentWire, keeperAssignmentCommitment, paymentIntentHash, paymentIntentTypedData, prepaidRequestId, type PaymentIntentWire} from '../committee/payment.js'
import {settlementAbi} from './abis/settlement.js'
import {keyRegistryAbi} from './abis/keyRegistry.js'
import {nodeRegistryAbi} from './abis/nodeRegistry.js'
import {thresholdRandomBeaconAbi} from './abis/thresholdRandomBeacon.js'
import {verifierSetRegistryAbi} from './abis/verifierSetRegistry.js'
import {accountantSetRegistryAbi} from './abis/accountantSetRegistry.js'
import type {ExecutionConsentPolicy} from '../committee/execution.js'
import {paidExecutionReportSigningHash, verifyPaidExecutionEvidence,
  type ExecutionRecoveryTarget, type SignedPaidExecutionReport} from '../committee/recovery.js'
import {selectVerifierCommittee, verifierLeaf, verifyMerkleProof} from '../committee/token.js'
import {protocolHex} from '../committee/receipts.js'
import {BillingModeError, readBillingMode} from './billing.js'
import {readAssignmentEpoch, requirePaidEpoch} from './paidEpoch.js'
import {systemPacingClock, type PaidPacingClock} from './paidPacing.js'
import {SingleFlight} from '../internal/bounded.js'
import {pinnedCall, pinnedRegistryCall} from './pinnedReads.js'
import {chainIdOf} from './chainId.js'
import {verifyDebitVoucher} from './allowance.js'

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
  /** `'1'` when read from a legacy Settlement (no prepaid getters: `enabled` false, `reserved` 0). Absent on a prepaid deployment. */
  settlementVersion?: '1'
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

/** Approved contracts and default verifier policy for client-side execution consent. */
export interface ClientExecutionDeployment extends PrepaidDeployment {
  /** Independently approved anchored verifier registry. */
  verifierSet: Address
  /** Independently approved randomness beacon. */
  beacon: Address
  /** Explicit deployment default, used only when the slot's on-chain policy is zero. */
  defaultVerificationPolicy?: {committee: number; quorum: number}
}

/** An anchored drawn verifier identity, supplied with its inclusion proof. */
export interface PaidVerifierWitness {
  /** Snapshot index; the SDK independently recomputes the draw. */
  index: number
  /** Registered operator account. */
  operator: Address
  /** Ed25519 key anchored at the payment's verification epoch. */
  publicKey: Hex
  /** Sorted-pair Merkle inclusion path. */
  proof: Hex[]
}

/** Fresh canonical payment and verifier-policy observation before a client signature. */
export interface ClientExecutionObservation extends PrepaidObservation {
  /** Exact independently read creator, deployment, reserved cost and current time. */
  policy: ExecutionConsentPolicy
}

/**
 * Read canonical mined credit, creator, beacon and verifier policy before approving work.
 * All registry calls use the receipt's EIP-1898 block hash; no latest/number fallback.
 * The paid verification epoch alone is judged at the reservation's stored quote block
 * (`prepaidAssignmentBlock`, EIP-1898 `requireCanonical` plus a by-number recheck): it must be
 * that block's `{epoch, epoch - 1}`. An unreadable quote block or state rejects with a retryable
 * `PaidEpochError` (`paid_epoch_unavailable`), never an admission or a live-head fallback; a
 * reorganised quote block or out-of-window epoch is a definite `paid_epoch_refused`.
 * A target additionally proves drawn membership and current registered verifier standing.
 * @param client Trusted RPC client for the independently selected deployment.
 * @param deployment Approved contracts and explicit default verification policy.
 * @param payment Original locally retained creator intent, never copied from a proposal.
 * @param expected Application-selected slot, action and payload digest.
 * @param target Optional drawn verifier whose work is about to be approved.
 */
export async function readClientExecutionPolicy(client: PublicClient, deployment: ClientExecutionDeployment,
  payment: PaymentIntentWire, expected: ExpectedPaidOperation, target?: PaidVerifierWitness): Promise<ClientExecutionObservation> {
  deployment = structuredClone(deployment); payment = structuredClone(payment); expected = {...expected}; target = target && structuredClone(target)
  if ([deployment.verifierSet, deployment.beacon].some(a => !ADDRESS.test(a) || /^0x0{40}$/i.test(a))) throw new Error('invalid execution registry deployment')
  requirePaidOperation(deployment, payment, expected)
  // ONE fresh canonical observation for the whole decision. Every read below is pinned to its block
  // hash, and the reservation, the policy reads and (for a target) the verifier's standing are
  // independent of each other there, so they are issued together and judged in the order a
  // sequential read would judge them. The target is read at the NodeRegistry this client last saw
  // the KeyRegistry point to; the pointer read at THIS block decides, and a different one is read
  // again at it. One canonicality and freshness recheck follows all of them.
  const member = target !== undefined && drawnMember(payment, target)
  const at = await observe(client, deployment)
  // Only a target that is locally a member of the draw is read early; any other is refused below.
  const hinted = member ? nodeRegistryHint(client, deployment.keyRegistry) : undefined
  const verifierStanding = (nodes: Address) => Promise.all([
    registryRead(client,at,nodes,nodeRegistryAbi,'nodeOf',[target!.operator]) as Promise<ReadContractReturnType<typeof nodeRegistryAbi,'nodeOf'>>,
    registryRead(client,at,nodes,nodeRegistryAbi,'hasTag',[target!.operator,keccak256(toHex('verifier'))]) as Promise<boolean>,
  ])
  const [reads, policyReads, early] = await Promise.allSettled([
    receiptReads(client, deployment, at, payment),
    Promise.all([
      registryRead(client, at, deployment.keyRegistry, keyRegistryAbi, 'getKeySlot', [payment.slot]) as Promise<ReadContractReturnType<typeof keyRegistryAbi, 'getKeySlot'>>,
      registryRead(client, at, deployment.keyRegistry, keyRegistryAbi, 'randomBeacon') as Promise<Address>,
      registryRead(client, at, deployment.verifierSet, verifierSetRegistryAbi, 'beacon') as Promise<Address>,
      registryRead(client, at, deployment.beacon, thresholdRandomBeaconAbi, 'epoch') as Promise<bigint>,
      registryRead(client, at, deployment.beacon, thresholdRandomBeaconAbi, 'seedAt', [BigInt(payment.verification_epoch)]) as Promise<Hex>,
      registryRead(client, at, deployment.verifierSet, verifierSetRegistryAbi, 'snapshotAt', [BigInt(payment.verification_epoch)]) as Promise<readonly [Hex, number]>,
      registryRead(client, at, deployment.keyRegistry, keyRegistryAbi, 'verifierPolicy', [payment.slot]) as Promise<readonly [number, number]>,
      registryRead(client, at, deployment.keyRegistry, keyRegistryAbi, 'nodeRegistry') as Promise<Address>,
    ]),
    hinted ? verifierStanding(hinted) : Promise.resolve(undefined),
  ])
  if (reads.status === 'rejected') throw reads.reason
  const receipt = checkReceiptReads(at, payment, reads.value)
  if (receipt.settled || BigInt(payment.expires) <= time()) throw new Error('payment cannot approve new work after settlement or expiry')
  if (policyReads.status === 'rejected') throw policyReads.reason
  const [slot, keyBeacon, setBeacon, latest, seed, snapshot, verifierPolicy, nodes] = policyReads.value
  // A standing read at the hinted registry counts only when the pointer at THIS block names it;
  // otherwise the standing is read again at the registry the pointer names.
  const hintHolds = hinted !== undefined && hinted.toLowerCase() === nodes.toLowerCase()
  const standingRead = member && !hintHolds && ADDRESS.test(nodes) && !/^0x0{40}$/i.test(nodes) ? verifierStanding(nodes) : undefined
  // Still to read: the quote block's epoch (its header and value are kept per client; its canonical
  // recheck is not) and the recheck of `at`, which starts only once every read at `at` has settled.
  // Both run beside the checks below; their answers are judged in the original order.
  const anchorRead = readAssignmentEpoch(client, deployment.beacon, receipt.assignmentBlock)
  const finishRead = (async () => { await standingRead?.catch(() => {}); await finishObservation(client, at) })()
  anchorRead.catch(() => {}); finishRead.catch(() => {})
  const epoch = BigInt(payment.verification_epoch)
  const [committee, quorum] = verifierPolicy[0] === 0 && verifierPolicy[1] === 0
    ? [deployment.defaultVerificationPolicy?.committee, deployment.defaultVerificationPolicy?.quorum] : verifierPolicy
  if (!slot.exists || slot.cancelled || (slot.expiry !== 0n && slot.expiry <= at.blockTimestamp)
    || !ADDRESS.test(slot.creator) || /^0x0{40}$/i.test(slot.creator)
    || [keyBeacon,setBeacon].some(pointer => pointer.toLowerCase() !== deployment.beacon.toLowerCase())
    || seed.toLowerCase() !== payment.verification_seed.toLowerCase()
    || snapshot[0].toLowerCase() !== payment.verification_root.toLowerCase()
    || snapshot[1] !== payment.verification_registry_size
    || committee !== payment.verification_committee || quorum !== payment.verification_quorum) throw new Error('payment verification context differs from canonical chain policy')
  // D8: the epoch window is judged at the reservation's stored quote block, where the
  // accountant quorum judged it, not at this later observation (which may be past a boundary).
  requirePaidEpoch(epoch, receipt, await anchorRead, latest)
  if (target) {
    if (!member || !ADDRESS.test(nodes) || /^0x0{40}$/i.test(nodes)) throw new Error('verifier is not an authenticated member of the paid draw')
    rememberNodeRegistry(client, deployment.keyRegistry, nodes)
    let standing: Awaited<ReturnType<typeof verifierStanding>>
    if (hintHolds) {
      if (early.status === 'rejected') throw early.reason
      standing = early.value!
    } else standing = await standingRead!
    const [node, tagged] = standing
    if (!node.active || tagged !== true || node.operator.toLowerCase() !== target.operator.toLowerCase()
      || node.pubkey.toLowerCase() !== target.publicKey.toLowerCase()) throw new Error('drawn verifier no longer has its registered key and standing')
  }
  await finishRead
  // The recheck started beside the checks above; judge freshness again now, at the decision.
  requireFresh(at)
  const nowSecs = Number(time())
  if (nowSecs >= payment.expires) throw new Error('payment expired during client policy discovery')
  if (slot.expiry !== 0n && slot.expiry <= BigInt(nowSecs)) throw new Error('slot expired during client policy discovery')
  return {blockNumber:at.blockNumber,blockHash:at.blockHash,blockTimestamp:at.blockTimestamp,
    policy:{chainId:deployment.chainId,settlement:deployment.settlement,keyRegistry:deployment.keyRegistry,
      creator:slot.creator,paymentHash:paymentIntentHash(payment),cost:receipt.cost,nowSecs}}
}

/** Whether `target` is in the payment's recomputed draw with a valid inclusion proof (local only). */
function drawnMember(payment: PaymentIntentWire, target: PaidVerifierWitness): boolean {
  const drawn = selectVerifierCommittee(protocolHex(payment.slot,32,'slot'), payment.verification_epoch,
    protocolHex(payment.verification_seed,32,'seed'), payment.verification_registry_size, payment.verification_committee)
  return Number.isSafeInteger(target.index) && drawn.includes(target.index) && target.proof.length <= 32
    && verifyMerkleProof(verifierLeaf(target.index,protocolHex(target.operator,20,'operator'),protocolHex(target.publicKey,32,'verifier key')),
      target.proof.map(p=>protocolHex(p,32,'proof')),protocolHex(payment.verification_root,32,'snapshot root'))
}

// The NodeRegistry each KeyRegistry pointed to when this client last read it: a HINT that lets a
// verifier's standing be read beside the pointer, never a substitute for the pointer read at the
// observed block. Bounded per client.
const MAX_NODE_REGISTRY_HINTS = 64
const nodeRegistryHints = new WeakMap<PublicClient, Map<string, Address>>()
function nodeRegistryHint(client: PublicClient, keyRegistry: Address): Address | undefined {
  return nodeRegistryHints.get(client)?.get(keyRegistry.toLowerCase())
}
function rememberNodeRegistry(client: PublicClient, keyRegistry: Address, nodes: Address): void {
  let hints = nodeRegistryHints.get(client)
  if (!hints) nodeRegistryHints.set(client, hints = new Map<string, Address>())
  const key = keyRegistry.toLowerCase()
  hints.delete(key)
  if (hints.size >= MAX_NODE_REGISTRY_HINTS) hints.delete(hints.keys().next().value as string)
  hints.set(key, nodes)
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

/** Original canonical keeper admission authenticated for a completed-result read. */
export interface KeeperExecutionRecoveryObservation extends PrepaidObservation {
  /** Financial policy evaluated at the original accepted time, never used to admit fresh work. */
  policy: ExecutionConsentPolicy
  /** Eligible assigned keeper and endpoint read at the original canonical block. */
  keeper: PaidKeeperEndpoint
  /** Original slot group key, for checking the recovered cryptographic result independently. */
  groupPublicKey: Hex
  /** Original slot mode. */
  mode: number
}

/**
 * Authenticate completed keeper evidence using canonical original creator, fee and roster reads.
 * Every contract call uses the report's original EIP-1898 hash with requireCanonical; missing
 * history fails closed. Current expiry, ownership or payout never replaces the original state.
 * This performs no transaction, keeper request or fresh work admission.
 * @param client Trusted bounded RPC client for the independently approved deployment.
 * @param deployment Approved chain and contracts, never taken from a received report.
 * @param payment Original creator payment retained before the operation.
 * @param expected Independently intended slot, action and digest.
 * @param target Original client key and independently selected assigned keeper stage/key.
 * @param execution Untrusted public completed evidence, authenticated against the same history.
 * @param transport Explicit local HTTP allowance for the historical registered endpoint.
 */
export async function readKeeperExecutionRecoveryPolicy(client: PublicClient, deployment: PrepaidDeployment,
  payment: PaymentIntentWire, expected: ExpectedPaidOperation, target: ExecutionRecoveryTarget,
  execution: SignedPaidExecutionReport, transport: PaidKeeperTransportOptions = {}): Promise<KeeperExecutionRecoveryObservation> {
  // Validate the full report before using its block hash as an RPC selector.
  const hash = paidExecutionReportSigningHash(payment, execution.report)
  deployment = {...deployment}; payment = structuredClone(payment); expected = {...expected}; target = {...target}
  execution = structuredClone(execution); transport = {...transport}
  validateDeployment(deployment)
  if (payment.chain_id !== deployment.chainId || payment.settlement.toLowerCase() !== deployment.settlement.toLowerCase()
    || payment.key_registry.toLowerCase() !== deployment.keyRegistry.toLowerCase()) throw new Error('recovery payment deployment mismatch')
  // ADR-0090: an allowance-backed operation has no per-request reservation at its admission block
  // (its backing is the voucher); historical recovery of one is not built and fails closed here.
  if (payment.allowance_id !== undefined) throw new Error('recovery of allowance-backed keeper work is not supported yet')
  if (payment.slot.toLowerCase() !== expected.slot.toLowerCase() || payment.action !== expected.action
    || payment.payload_digest.toLowerCase() !== expected.payloadDigest.toLowerCase()) throw new Error('recovery payment operation mismatch')
  if ((target.stage !== 'coordinator' && target.stage !== 'contributor') || execution.report.stage !== target.stage
    || toHex(Uint8Array.from(execution.report.operator_key)).toLowerCase() !== target.operatorKey.toLowerCase()) throw new Error('recovery requires the intended keeper stage')
  const key = protocolHex(target.operatorKey, 32, 'original keeper key'), point = ed25519.Point.fromHex(key, false)
  if (point.isSmallOrder() || !point.isTorsionFree()
    || !ed25519.verify(protocolHex(execution.signature, 64, 'original keeper report signature'), protocolHex(hash, 32, 'report hash'), key,
      {zip215: false})) throw new Error('invalid original keeper report signature')
  if (await chainIdOf(client) !== deployment.chainId) throw new Error('recovery RPC chain mismatch')
  const blockHash = toHex(Uint8Array.from(execution.report.reservation_block))
  const block = await client.getBlock({blockHash})
  const accepted = execution.consent.verified_at
  if (block.number === null || block.hash?.toLowerCase() !== blockHash.toLowerCase() || block.timestamp < 0n
    || !Number.isSafeInteger(accepted) || accepted <= 0 || BigInt(accepted) - block.timestamp > MAX_AGE
    || block.timestamp - BigInt(accepted) > FUTURE_SKEW || BigInt(accepted) > time() + FUTURE_SKEW) throw new Error('original keeper admission block or clock mismatch')
  const at = {blockNumber: block.number, blockHash, blockTimestamp: block.timestamp}
  const requestId = prepaidRequestId(payment)
  const [enabled, cost, settled, refunded, assignmentBlock, directory] = await Promise.all([
    readAt(client, deployment.settlement, at, 'prepaidEnabled', payment.slot),
    readAt(client, deployment.settlement, at, 'prepaidCost', payment.slot, requestId),
    readAt(client, deployment.settlement, at, 'prepaidSettled', payment.slot, requestId),
    readAt(client, deployment.settlement, at, 'prepaidRefunded', payment.slot, requestId),
    readAt(client, deployment.settlement, at, 'prepaidAssignmentBlock', payment.slot, requestId),
    keeperDirectory(client, at, deployment.keyRegistry, payment.slot, BigInt(accepted)),
  ])
  if (enabled !== true || settled !== false || refunded !== 0n || typeof cost !== 'bigint' || cost <= 0n || cost > BigInt(payment.max_cost)
    || cost !== BigInt(toHex(Uint8Array.from(execution.report.cost))) || typeof assignmentBlock !== 'string'
    || !HEX32.test(assignmentBlock) || assignmentBlock.toLowerCase() === ZERO32) throw new Error('original keeper admission has no valid reserved TASRA backing')
  const {slot, members} = directory, assignment = payment.keeper_assignment
  if (slot.epoch !== BigInt(assignment.key_epoch) || slot.committeeVersion !== BigInt(assignment.committee_version)
    || slot.threshold.k !== assignment.threshold || (slot.expiry !== 0n && slot.expiry <= BigInt(accepted))) throw new Error('original keeper sharing or slot lifetime mismatch')
  for (const assigned of [assignment.coordinator, ...assignment.contributors]) {
    if (!members.get(toHex(Uint8Array.from(assigned)))?.eligible) throw new Error('original payment names an ineligible assigned keeper')
  }
  const keeper = keeperEndpoint(members, target.operatorKey.toLowerCase() as Hex, deployment.chainId, transport)
  const policy = {chainId: deployment.chainId, settlement: deployment.settlement, keyRegistry: deployment.keyRegistry,
    creator: slot.creator, paymentHash: paymentIntentHash(payment), cost, nowSecs: accepted}
  await verifyPaidExecutionEvidence({payment, policy, target, execution})
  // Historical freshness is measured at accepted, never against today's latest head.
  const canonical = await client.getBlock({blockNumber: at.blockNumber})
  if (canonical.hash?.toLowerCase() !== blockHash.toLowerCase() || canonical.timestamp !== at.blockTimestamp) throw new Error('original keeper history reorganized during recovery')
  if (BigInt(accepted) > time() + FUTURE_SKEW) throw new Error('original keeper work clock is in the future')
  return {...at, policy, keeper, groupPublicKey: slot.publicKey, mode: slot.mode}
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
/**
 * How long discovery waits for an admissible complete epoch. The accountants anchor a new epoch's
 * verifier and accountant snapshots seconds after they push its seed (6-8 s in the local fleet,
 * where epochs are 8-10 s apart), and keepers accept only the latest or the previous epoch: until
 * both anchors land, no epoch is both admissible and complete. That is the protocol's timing, not a
 * refusal, so discovery observes again instead of failing (2026-10-31: a one-shot discovery lost a
 * certification row to that two-second window).
 */
export interface PaidAnchorWait {
  /** Longest total wait in ms; 0 keeps the single observation. Default 20 000, at most 120 000. */
  timeoutMs?: number
  /** Pause between observations in ms. Default 1 000, within 100..10 000. */
  pollMs?: number
  /** Time source; the system clock by default. Inject one in tests. */
  clock?: PaidPacingClock
}
const ANCHOR_WAIT_MS = 20_000, ANCHOR_POLL_MS = 1_000
function anchorWaitPolicy(wait: PaidAnchorWait = {}): {timeoutMs: number; pollMs: number; clock: PaidPacingClock} {
  const timeoutMs = wait.timeoutMs ?? ANCHOR_WAIT_MS, pollMs = wait.pollMs ?? ANCHOR_POLL_MS, clock = wait.clock ?? systemPacingClock
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 120_000 || !Number.isSafeInteger(pollMs) || pollMs < 100 || pollMs > 10_000) throw new Error('invalid anchor wait')
  return {timeoutMs, pollMs, clock}
}

/** Options for opening a paid operation context: the keeper transport, an optional requested coordinator and the bounded anchor wait. */
export interface PaidContextOptions extends PaidKeeperTransportOptions {
  /** Requested registered coordinator; otherwise a uniform draw among eligible keepers. Retain the returned context for reservation and recovery. */
  coordinator?: Address
  /** Bounded wait for an admissible complete epoch; see {@link PaidAnchorWait}. */
  anchorWait?: PaidAnchorWait
  /** Independently approved deployed verifier defaults; required only for a zero slot override. */
  defaultVerificationPolicy?: {committee: number; quorum: number}
  /**
   * ADR-0090: the operation may be funded by an already reserved allowance, so an activated slot
   * whose whole balance is escrowed (`balanceOf` 0) is not refused here. Activation is still required;
   * a per-operation reservation from such a slot is refused by the accountants (402).
   */
  fundedByAllowance?: boolean
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
  /** The slot's salted rule commitment at this block, from the same canonical slot read. */
  ruleCommitment?: Hex
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

// Concurrent operations on one client share one in-flight `latest` head read. Only the pending
// request is shared: a head is never reused once answered, so each later observation reads again.
const sharedHeads = new WeakMap<PublicClient, SingleFlight<Awaited<ReturnType<PublicClient['getBlock']>>>>()

function latestHead(client: PublicClient) {
  let shared = sharedHeads.get(client)
  if (!shared) sharedHeads.set(client, shared = new SingleFlight(1))
  return shared.run('latest', () => client.getBlock({blockTag: 'latest'}))
}

async function observe(client: PublicClient, d: PrepaidDeployment): Promise<PrepaidObservation> {
  validateDeployment(d)
  // The chain check and the head read are independent; a mismatch is still refused first.
  const [chain, head] = await Promise.allSettled([chainIdOf(client), latestHead(client)])
  if (chain.status === 'rejected') throw chain.reason
  if (chain.value !== d.chainId) throw new Error('prepaid RPC chain mismatch')
  if (head.status === 'rejected') throw head.reason
  const block = head.value
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
  // Same canonical block-hash read, batched with the other reads at this block where possible.
  const result = {data: await pinnedCall(client, at.blockHash, settlement, data)}
  if (result.data === undefined) throw new Error(`empty prepaid ${name} response`)
  return decodeFunctionResult({abi: settlementAbi, functionName: name, data: result.data})
}

async function legacyVersionAt(client: PublicClient, settlement: Address, at: PrepaidObservation): Promise<boolean> {
  try {
    const data = encodeFunctionData({abi: settlementAbi, functionName: 'version'})
    const result = await client.call({to: settlement, data, blockHash: at.blockHash, requireCanonical: true, batch: false})
    return result.data !== undefined && decodeFunctionResult({abi: settlementAbi, functionName: 'version', data: result.data}) === '1'
  } catch { return false }
}

/** Refuse a paid operation on a slot that is not prepaid, naming the detected billing. */
async function refuseUnlessPrepaid(client: PublicClient, deployment: PrepaidDeployment, slot: Hex): Promise<void> {
  const observed = await readBillingMode(client, deployment, slot)
  if (observed.mode !== 'prepaid') throw new BillingModeError({...observed, mode: observed.mode})
}

async function finishObservation(client: PublicClient, at: PrepaidObservation): Promise<void> {
  // Recheck canonicality after all calls as well as requiring it on each individual call.
  // Never fall back to latest or a block number when EIP-1898 is unsupported.
  const current = await client.getBlock({blockNumber: at.blockNumber})
  if (current.hash?.toLowerCase() !== at.blockHash.toLowerCase()) throw new Error('prepaid observation reorganized during reads')
  requireFresh(at)
}

// Concurrent operations on one client often read the same registry value at the same block
// (the keeper directory above all). A read pinned to a block hash has one answer: identical
// in-flight reads share one request, and a result at a block the client has confirmed finalized
// is kept briefly (bounded) for later operations at that block. Errors are never reused, and
// `latest` reads, reservation reads and rechecks never come here (see pinnedReads.ts).
// Observations of a fresh `latest` head made for a paid keeper operation. Only their registry
// reads use the finalized-block cache; historical and discovery reads never do.
const operationHeads = new WeakSet<PrepaidObservation>()

async function registryRead(client: PublicClient, at: PrepaidObservation, address: Address, abi: Abi, name: string, args: readonly unknown[] = []): Promise<unknown> {
  const data = encodeFunctionData({abi, functionName: name, args})
  const result = {data: await pinnedRegistryCall(client, at, address, data, operationHeads.has(at))}
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
  let enabled: unknown, available: unknown, reserved: unknown
  try {
    ;[enabled, available, reserved] = await Promise.all([
      readAt(client, deployment.settlement, at, 'prepaidEnabled', slot),
      readAt(client, deployment.settlement, at, 'balanceOf', slot),
      readAt(client, deployment.settlement, at, 'reservedBalanceOf', slot),
    ])
  } catch (error) {
    // A legacy (version 1) Settlement has no prepaid getters. Report its balance only when the
    // same block positively reads version "1"; any other failure stays a failure.
    if (await legacyVersionAt(client, deployment.settlement, at) !== true) throw error
    const balance = await readAt(client, deployment.settlement, at, 'balanceOf', slot)
    if (typeof balance !== 'bigint') throw new Error('invalid slot funding response', {cause: error})
    await finishObservation(client, at)
    return {...at, slot, enabled: false, available: balance, reserved: 0n, total: balance, settlementVersion: '1'}
  }
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
  requirePaidOperation(deployment, payment, expected)
  const at = await observe(client, deployment)
  const receipt = checkReceiptReads(at, payment, await receiptReads(client, deployment, at, payment))
  await finishObservation(client, at)
  return receipt
}

/** Refuse an intent for another deployment or operation before any read. */
function requirePaidOperation(deployment: PrepaidDeployment, payment: PaymentIntentWire, expected: ExpectedPaidOperation): void {
  validateDeployment(deployment)
  assertPaymentIntentWire(payment)
  if (payment.chain_id !== deployment.chainId || payment.settlement.toLowerCase() !== deployment.settlement.toLowerCase()
    || payment.key_registry.toLowerCase() !== deployment.keyRegistry.toLowerCase()) throw new Error('payment deployment mismatch')
  if (payment.slot.toLowerCase() !== expected.slot.toLowerCase() || payment.action !== expected.action
    || payment.payload_digest.toLowerCase() !== expected.payloadDigest.toLowerCase()) throw new Error('payment operation mismatch')
}

/** Backing reads at `at`: a reservation's five Settlement reads, or (ADR-0090) an allowance's record, the request's settlement state and the voucher check. */
type ReceiptReads = {kind: 'reservation'; reads: unknown[]} | {kind: 'allowance'; reads: unknown[]}
function receiptReads(client: PublicClient, deployment: PrepaidDeployment, at: PrepaidObservation, payment: PaymentIntentWire): Promise<ReceiptReads> {
  const requestId = prepaidRequestId(payment)
  if (payment.allowance_id !== undefined) {
    const voucher = payment.debit_voucher
    if (!voucher) return Promise.reject(new Error('allowance-backed payment carries no debit voucher'))
    const allowance = pinnedCall(client, at.blockHash, deployment.settlement, encodeFunctionData({abi: settlementAbi, functionName: 'prepaidAllowance', args: [payment.allowance_id]}))
      .then(data => { if (data === undefined) throw new Error('empty prepaidAllowance response'); return decodeFunctionResult({abi: settlementAbi, functionName: 'prepaidAllowance', data}) })
    return Promise.all([readAt(client, deployment.settlement, at, 'prepaidEnabled', payment.slot), allowance,
      readAt(client, deployment.settlement, at, 'prepaidCost', payment.slot, requestId), readAt(client, deployment.settlement, at, 'prepaidSettled', payment.slot, requestId),
      readAt(client, deployment.settlement, at, 'prepaidRefunded', payment.slot, requestId), verifyDebitVoucher(client, deployment, voucher)]).then(reads => ({kind: 'allowance', reads}))
  }
  const names = ['prepaidEnabled', 'prepaidCost', 'prepaidSettled', 'prepaidRefunded', 'prepaidAssignmentBlock'] as const
  return Promise.all(names.map(name =>
    readAt(client, deployment.settlement, at, name, payment.slot, name === 'prepaidEnabled' ? undefined : requestId))).then(reads => ({kind: 'reservation', reads}))
}

function checkReceiptReads(at: PrepaidObservation, payment: PaymentIntentWire, observed: ReceiptReads): PaidOperationReceipt {
  if (observed.kind === 'allowance') return checkAllowanceBacking(at, payment, observed.reads)
  const [enabled, cost, settled, refunded, assignmentBlock] = observed.reads
  if (enabled !== true || typeof cost !== 'bigint' || cost <= 0n || cost > BigInt(payment.max_cost)
    || typeof settled !== 'boolean' || typeof refunded !== 'bigint' || refunded < 0n || refunded > cost
    || (!settled && refunded !== 0n) || typeof assignmentBlock !== 'string' || !HEX32.test(assignmentBlock) || assignmentBlock === ZERO32) {
    throw new Error('operation has no valid reserved TASRA fee')
  }
  return {...at, requestId: prepaidRequestId(payment), cost, settled, refunded, assignmentBlock: assignmentBlock as Hex}
}

/**
 * ADR-0090 D3 from the client side: the allowance is mined and canonical at `at`, for this slot,
 * open, unexpired and funding the action; the (already signature-verified) voucher debits THIS
 * request within the per-operation cap and the escrow; the request is not per-operation reserved
 * (`prepaidCost` is 0 until the allowance settle writes the voucher's cost). The voucher's cost and
 * the allowance's immutable assignment block stand in for a reservation's.
 */
function checkAllowanceBacking(at: PrepaidObservation, payment: PaymentIntentWire, reads: unknown[]): PaidOperationReceipt {
  const [enabled, record, reservedCost, settled, refunded] = reads as [unknown, readonly [Hex, Hex, bigint, bigint, bigint, bigint, bigint, number, boolean], unknown, unknown, unknown]
  const voucher = payment.debit_voucher!
  const [slotId, assignmentBlock, amount, , maxOpCost, expiresAt, , actions, closed] = record
  const cost = BigInt(voucher.cost)
  const bit = ({'sign': 0, 'decrypt': 1, 'eoa-sign': 2, 'ibe-extract': 3, 'dual-approve': 6} as const)[payment.action]
  if (enabled !== true || !HEX32.test(assignmentBlock) || assignmentBlock.toLowerCase() === ZERO32 || amount === 0n || slotId.toLowerCase() !== payment.slot.toLowerCase()
    || closed || at.blockTimestamp >= expiresAt || (actions & (1 << bit)) === 0 || cost > maxOpCost || cost > BigInt(payment.max_cost) || BigInt(voucher.cumulative) > amount
    || typeof reservedCost !== 'bigint' || (reservedCost !== 0n && reservedCost !== cost) || typeof settled !== 'boolean' || typeof refunded !== 'bigint'
    || refunded < 0n || refunded > cost || (!settled && (refunded !== 0n || reservedCost !== 0n))) {
    throw new Error('operation has no valid allowance-backed TASRA debit')
  }
  return {...at, requestId: prepaidRequestId(payment), cost, settled, refunded, assignmentBlock}
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
  requirePaidOperation(deployment, payment, expected)
  const at = await observe(client, deployment)
  operationHeads.add(at)
  // The reservation and the keeper directory are independent reads at the same block: issue them
  // together, then judge them in the order a sequential read would have (same refusals, same order).
  const [reads, directory] = await Promise.allSettled([receiptReads(client, deployment, at, payment),
    keeperDirectory(client, at, deployment.keyRegistry, payment.slot)])
  if (reads.status === 'rejected') throw reads.reason
  const receipt = checkReceiptReads(at, payment, reads.value)
  // One canonicality and freshness recheck after ALL reads at `at` (both groups have settled).
  await finishObservation(client, at)
  if (receipt.settled) throw new Error('payment already settled; it cannot start another keeper operation')
  if (BigInt(payment.expires) <= time()) throw new Error('payment expired; reconcile before starting another operation')
  if (directory.status === 'rejected') throw directory.reason
  const {slot, members} = directory.value
  const assignment = payment.keeper_assignment
  if (slot.epoch !== BigInt(assignment.key_epoch) || slot.committeeVersion !== BigInt(assignment.committee_version) || slot.threshold.k !== assignment.threshold) throw new Error('payment keeper sharing or threshold changed')
  const creator = await recoverTypedDataAddress({...paymentIntentTypedData(payment), signature: payment.signature})
  if (creator.toLowerCase() !== slot.creator.toLowerCase()) throw new Error('payment is not signed by the slot creator')
  const endpoint = (key: Hex) => keeperEndpoint(members, key, deployment.chainId, transport)
  const contributors = assignment.contributors.map(key => endpoint(toHex(Uint8Array.from(key))))
  const coordinator = endpoint(toHex(Uint8Array.from(assignment.coordinator)))
  if (BigInt(payment.expires) <= time()) throw new Error('payment expired during coordinator discovery')
  return {...coordinator, receipt, contributors, groupPublicKey: slot.publicKey, mode: slot.mode}
}

interface KeeperDirectoryMember {key: Hex; id: bigint; operator: Address; url: string; eligible: boolean}
async function keeperDirectory(client: PublicClient, at: PrepaidObservation, registry: Address, slotId: Hex, acceptedTime = at.blockTimestamp) {
  const [slot, assigned, nodes] = await Promise.all([
    registryRead(client, at, registry, keyRegistryAbi, 'getKeySlot', [slotId]) as Promise<ReadContractReturnType<typeof keyRegistryAbi, 'getKeySlot'>>,
    registryRead(client, at, registry, keyRegistryAbi, 'assignedNodes', [slotId]) as Promise<readonly Address[]>,
    registryRead(client, at, registry, keyRegistryAbi, 'nodeRegistry') as Promise<Address>,
  ])
  if (!slot.exists || slot.cancelled || (slot.expiry !== 0n && slot.expiry <= acceptedTime) || slot.publicKey === '0x') throw new Error('paid slot is inactive or has no published key')
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
  // The injected clock is a live object; everything else is pinned by value before any read.
  const {anchorWait, ...pinned} = options
  deployment = {...deployment}; options = {...structuredClone(pinned), ...(anchorWait ? {anchorWait} : {})}
  const wait = anchorWaitPolicy(anchorWait)
  validateDeployment(deployment)
  if (!HEX32.test(slotId) || [deployment.verifierSet, deployment.accountantSet, deployment.beacon, ...(options.coordinator ? [options.coordinator] : [])]
    .some(address => !ADDRESS.test(address) || /^0x0{40}$/i.test(address))) throw new Error('invalid payment discovery identity')
  const complete = (seed: Hex, root: Hex, size: number, accountant: readonly [Hex, number]) =>
    seed !== ZERO32 && root !== ZERO32 && size > 0 && accountant[0] !== ZERO32 && accountant[1] > 0 && accountant[1] <= 65535
  const deadline = wait.clock.now() + wait.timeoutMs
  // One fresh canonical observation per attempt; an attempt that finds no admissible complete
  // epoch waits (bounded) and observes again at a newer head, never re-reads an old one.
  const observed = await (async () => {
    for (;;) {
      const at = await observe(client, deployment)
      const seedAt = (epoch: bigint) => registryRead(client, at, deployment.beacon, thresholdRandomBeaconAbi, 'seedAt', [epoch]) as Promise<Hex>
      const snapshotAt = (epoch: bigint) => registryRead(client, at, deployment.verifierSet, verifierSetRegistryAbi, 'snapshotAt', [epoch]) as Promise<readonly [Hex, number]>
      const accountantAt = (epoch: bigint) => registryRead(client, at, deployment.accountantSet, accountantSetRegistryAbi, 'snapshotAt', [epoch]) as Promise<readonly [Hex, number]>
      const latestEpoch = registryRead(client, at, deployment.beacon, thresholdRandomBeaconAbi, 'epoch') as Promise<bigint>
      // The latest epoch's anchors depend only on that epoch, not on the keeper directory: read them
      // beside its second step instead of after it. Judged below, in the original order.
      const latestAnchors = latestEpoch.then(epoch => Promise.all([seedAt(epoch), snapshotAt(epoch), accountantAt(epoch)]))
      latestAnchors.catch(() => {})
      const reads = Promise.all([
        registryRead(client, at, deployment.keyRegistry, keyRegistryAbi, 'randomBeacon') as Promise<Address>,
        registryRead(client, at, deployment.verifierSet, verifierSetRegistryAbi, 'beacon') as Promise<Address>,
        registryRead(client, at, deployment.accountantSet, accountantSetRegistryAbi, 'beacon') as Promise<Address>,
        latestEpoch,
        registryRead(client, at, deployment.keyRegistry, keyRegistryAbi, 'verifierPolicy', [slotId]) as Promise<readonly [number, number]>,
        readAt(client, deployment.settlement, at, 'prepaidEnabled', slotId),
        readAt(client, deployment.settlement, at, 'balanceOf', slotId),
        keeperDirectory(client, at, deployment.keyRegistry, slotId),
      ])
      // On a failed read, a legacy or unreadable billing mode is the clearer refusal.
      const [keyBeacon, snapshotBeacon, accountantBeacon, latest, policy, enabled, available, directory] = await reads.catch(async (error: unknown) => {
        await refuseUnlessPrepaid(client, deployment, slotId)
        throw error
      })
      if (enabled !== true) {
        await refuseUnlessPrepaid(client, deployment, slotId)
        // Prepaid from genesis but never funded: the first funding activates it.
        if (available === 0n) throw new UnderfundedSlotError({slotId, availableTasraUnits: 0n,
          message: 'payment discovery requires an activated TASRA-funded slot'})
      }
      if ([keyBeacon, snapshotBeacon, accountantBeacon].some(pointer => pointer.toLowerCase() !== deployment.beacon.toLowerCase())) throw new Error('payment discovery beacon pointers differ')
      if (enabled !== true || typeof available !== 'bigint' || available < 0n) throw new Error('payment discovery requires an activated TASRA-funded slot')
      if (available === 0n && options.fundedByAllowance !== true) throw new UnderfundedSlotError({slotId, availableTasraUnits: available,
        message: 'payment discovery requires an activated TASRA-funded slot'})
      let epoch = latest
      let [seed, [root, size], accountant] = await latestAnchors
      if (seed === ZERO32) throw new Error('current beacon seed unavailable')
      if (!complete(seed, root, size, accountant)) {
        if (epoch === 0n) throw new Error('no anchored verifier and accountant snapshots')
        epoch--
        ;[seed, [root, size], accountant] = await Promise.all([seedAt(epoch), snapshotAt(epoch), accountantAt(epoch)])
        if (!complete(seed, root, size, accountant)) {
          // A new epoch's anchors have not landed yet (see PaidAnchorWait): wait and observe again.
          if (wait.clock.now() + wait.pollMs > deadline) throw new Error('no current or previous anchored verifier and accountant snapshots')
          await wait.clock.sleep(wait.pollMs)
          continue
        }
      }
      return {at, policy, available, directory, epoch, seed, root, size}
    }
  })()
  const {at, policy, available, directory, epoch, seed, root, size} = observed
  const [onChainCommittee, onChainQuorum] = policy
  if (onChainCommittee === 0 && onChainQuorum !== 0) throw new Error('invalid on-chain verifier policy')
  const {committee, quorum} = onChainCommittee === 0
    ? options.defaultVerificationPolicy ?? {committee: 0, quorum: 0}
    : {committee: onChainCommittee, quorum: onChainQuorum}
  if (!Number.isInteger(committee) || !Number.isInteger(quorum) || quorum <= 0 || quorum > committee || committee > 4096 || committee > size) throw new Error('missing or invalid approved verifier policy')
  const members = [...directory.members.values()].filter(member => member.eligible).sort((a, b) => a.id < b.id ? -1 : 1)
  const selected = options.coordinator
    ? members.find(member => member.operator.toLowerCase() === options.coordinator!.toLowerCase())
    : drawKeeper(members)
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
  return {...at, intentFields, creator: directory.slot.creator, mode: directory.slot.mode, groupPublicKey: directory.slot.publicKey, coordinator, contributors: endpoints, available,
    ruleCommitment: directory.slot.ruleCommitment}
}

// readKeeperDirectory bounds a slot to 256 members. Reject the excess range so
// every eligible keeper has the same chance, including with non-power-of-two rosters.
// This is a fresh-context default, never a redraw of an existing signed assignment.
function drawKeeper<T>(members: readonly T[]): T | undefined {
  if (!members.length) return undefined
  const limit = 256 - 256 % members.length
  let sample: number
  do { sample = randomBytes(1)[0]! } while (sample >= limit)
  return members[sample % members.length]
}
