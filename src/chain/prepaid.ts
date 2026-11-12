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
import {BillingModeError, isPrepaidSettlementVersion, readBillingMode} from './billing.js'
import {readAssignmentEpoch, requirePaidEpoch} from './paidEpoch.js'
import {systemPacingClock, type PaidPacingClock} from './paidPacing.js'
import {SingleFlight} from '../internal/bounded.js'
import {pinnedCall, pinnedRegistryCall} from './pinnedReads.js'
import {headFollowerOf} from './headFollower.js'
import {registerHeadPrefetch} from './headPrefetch.js'
import {chainIdOf} from './chainId.js'
import {readAccountantGroupKey, verifyDebitVoucher} from './allowance.js'

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
  return decideAtFreshHead(client, await observe(client, deployment), async at => {
    // Only a target that is locally a member of the draw is read early; any other is refused below.
    const hinted = member ? nodeRegistryHint(client, deployment.keyRegistry) : undefined
    // The quote block's epoch read (header, beacon epoch, and its canonical recheck by number: one
    // RPC round once the block is older than the head follower's window) needs the receipt's
    // assignment block. The block this payment's backing named when this client last judged it is a
    // HINT: its read starts now, beside the reads at `at`, and counts only when the receipt read at
    // THIS block names the same assignment block; otherwise it is read again for the one it names.
    const anchorHint = assignmentHint(client, deployment.settlement, payment)
    const earlyAnchor = anchorHint !== undefined ? readAssignmentEpoch(client, deployment.beacon, anchorHint) : undefined
    earlyAnchor?.catch(() => {})
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
    const anchorRead = earlyAnchor !== undefined && anchorHint!.toLowerCase() === receipt.assignmentBlock.toLowerCase()
      ? earlyAnchor : readAssignmentEpoch(client, deployment.beacon, receipt.assignmentBlock)
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
      || committee !== payment.verification_committee || quorum !== payment.verification_quorum) throw reversible(new Error('payment verification context differs from canonical chain policy'))
    // D8: the epoch window is judged at the reservation's stored quote block, where the
    // accountant quorum judged it, not at this later observation (which may be past a boundary).
    requirePaidEpoch(epoch, receipt, await anchorRead, latest)
    rememberAssignment(client, deployment.settlement, payment, receipt.assignmentBlock)
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
        || node.pubkey.toLowerCase() !== target.publicKey.toLowerCase()) throw reversible(new Error('drawn verifier no longer has its registered key and standing'))
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
  })
}

/** Whether `target` is in the payment's recomputed draw with a valid inclusion proof (local only). */
function drawnMember(payment: PaymentIntentWire, target: PaidVerifierWitness): boolean {
  const drawn = selectVerifierCommittee(protocolHex(payment.slot,32,'slot'), payment.verification_epoch,
    protocolHex(payment.verification_seed,32,'seed'), payment.verification_registry_size, payment.verification_committee)
  return Number.isSafeInteger(target.index) && drawn.includes(target.index) && target.proof.length <= 32
    && verifyMerkleProof(verifierLeaf(target.index,protocolHex(target.operator,20,'operator'),protocolHex(target.publicKey,32,'verifier key')),
      target.proof.map(p=>protocolHex(p,32,'proof')),protocolHex(payment.verification_root,32,'snapshot root'))
}

// The assignment block each payment's backing named when this client last judged it (an allowance's
// is the same for every request it funds; a reservation's is its own): a HINT that only starts the
// quote block's epoch read early, never a substitute for the receipt read at the observed block.
// Bounded per client.
const MAX_ASSIGNMENT_HINTS = 256
const assignmentHints = new WeakMap<PublicClient, Map<string, Hex>>()
function assignmentHintKey(settlement: Address, payment: PaymentIntentWire): string {
  return `${settlement.toLowerCase()}|${payment.slot.toLowerCase()}|${(payment.allowance_id ?? prepaidRequestId(payment)).toLowerCase()}`
}
function assignmentHint(client: PublicClient, settlement: Address, payment: PaymentIntentWire): Hex | undefined {
  return assignmentHints.get(client)?.get(assignmentHintKey(settlement, payment))
}
function rememberAssignment(client: PublicClient, settlement: Address, payment: PaymentIntentWire, block: Hex): void {
  let hints = assignmentHints.get(client)
  if (!hints) assignmentHints.set(client, hints = new Map<string, Hex>())
  const key = assignmentHintKey(settlement, payment)
  hints.delete(key)
  if (hints.size >= MAX_ASSIGNMENT_HINTS) hints.delete(hints.keys().next().value as string)
  hints.set(key, block)
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
   * Prepaid allowances: the operation may be funded by an already reserved allowance, so an activated slot
   * whose whole balance is escrowed (`balanceOf` 0) is not refused here. Activation is still required;
   * a per-operation reservation from such a slot is refused by the accountants (402).
   */
  fundedByAllowance?: boolean
  /**
   * Session grants: draw on THIS verifier epoch (a session grant's), never a newer one. Every message
   * of a session pays the grant's draw (the keeper refuses any other), and a grant is admitted only
   * while its epoch is the beacon's latest or the one before; past that a typed
   * {@link PaidDrawMovedError} is thrown before anything is signed (refresh the grant first).
   */
  verificationEpoch?: bigint
  /**
   * Prepaid allowances: while a new epoch's anchors land (no admissible complete verifier draw at the
   * observed head, see {@link PaidAnchorWait}), return at once a context marked
   * {@link PaidOperationContext.undrawn} instead of waiting. Only for a caller that will fund the
   * operation from an EXISTING allowance, whose payment names the allowance's own draw (judged at
   * the allowance's quote block, not at this head): its keeper sharing, creator, mode and rule
   * commitment are read as usual. Requires `fundedByAllowance`; ignored with `verificationEpoch`.
   */
  undrawnDuringAnchorGap?: boolean
}

/**
 * The pinned verifier epoch ({@link PaidContextOptions.verificationEpoch}) is no longer the beacon's
 * latest or previous epoch. Nothing was signed or reserved: refresh the session grant (or present
 * again) and discover anew.
 */
export class PaidDrawMovedError extends Error {
  /** Stable reason. */
  readonly code = 'draw-moved' as const
  constructor(
    /** The pinned verifier epoch. */
    readonly pinnedEpoch: bigint,
    /** The beacon's latest epoch as read. */
    readonly beaconEpoch: bigint,
  ) {
    super(`payment discovery: verifier epoch ${pinnedEpoch} is no longer current or previous (beacon at ${beaconEpoch})`)
    this.name = 'PaidDrawMovedError'
  }
}

/** Chain-derived fields safe to copy into the creator's independently bounded payment intent. */
export type DiscoveredPaymentFields = Pick<PaymentIntentWire, 'chain_id' | 'settlement' | 'key_registry' | 'slot' | 'verification_epoch' | 'verification_seed' | 'verification_root' | 'verification_registry_size' | 'verification_committee' | 'verification_quorum' | 'keeper_assignment'>

/** The verifier-draw fields of {@link DiscoveredPaymentFields}: present only on a drawn context. */
export type PaymentDrawFieldName = 'verification_epoch' | 'verification_seed' | 'verification_root' | 'verification_registry_size' | 'verification_committee' | 'verification_quorum'

/**
 * The chain and keeper-sharing fields of an UNDRAWN context: no verifier draw at all, so they can
 * never complete a payment intent (a per-operation intent or an allowance needs the draw fields).
 */
export type UndrawnPaymentFields = Omit<DiscoveredPaymentFields, PaymentDrawFieldName>

interface PaidOperationContextBase extends PrepaidObservation {
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
  /** The beacon's latest epoch at this block (the draw is it or, while its anchors land, the one before). */
  beaconEpoch?: bigint
}

/** A context on an admissible complete verifier draw: the only kind a payment intent is built from. */
export interface DrawnPaidOperationContext extends PaidOperationContextBase {
  /** Chain and assignment fields; add the exact action/digest, cap, nonce, expiry and session commitment before signing. */
  intentFields: DiscoveredPaymentFields
  /** Never set on a drawn context. */
  undrawn?: undefined
}

/**
 * Returned only with {@link PaidContextOptions.undrawnDuringAnchorGap}: this block has no admissible
 * complete verifier draw, so `intentFields` carries NO verification fields. Such a context may
 * select an existing allowance (which carries its own draw); it never signs a per-operation payment
 * and never reserves an allowance. Discover again (with the bounded anchor wait) for anything else.
 */
export interface UndrawnPaidOperationContext extends PaidOperationContextBase {
  /** Chain and keeper-sharing fields only; no verifier draw. */
  intentFields: UndrawnPaymentFields
  /** Always set: this context has no verifier draw. */
  undrawn: true
}

/** One canonical pre-signing observation; later reservation and execution must revalidate it. Narrow on `undrawn` before reading draw fields. */
export type PaidOperationContext = DrawnPaidOperationContext | UndrawnPaidOperationContext

/**
 * The context's intent fields, refused for an undrawn context: the one path from a context to a
 * payment intent. Throws rather than ever returning zero or missing draw fields.
 */
export function drawnIntentFields(context: PaidOperationContext): DiscoveredPaymentFields {
  if (context.undrawn === true || !('verification_epoch' in context.intentFields)) throw new Error('an undrawn payment context has no verifier draw; discover again')
  return context.intentFields
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

async function observe(client: PublicClient, d: PrepaidDeployment, atLeastBlock?: bigint): Promise<PrepaidObservation> {
  validateDeployment(d)
  // A live head follower's tip replaces the `latest` read (the same head, delivered by subscription
  // or poll instead of asked for); a follower that is not live falls back to the RPC read. So does a
  // tip older than a block the caller already saw mined: it cannot show that transaction's effects.
  const tip = headFollowerOf(client)?.tip()
  if (tip && (atLeastBlock === undefined || tip.blockNumber >= atLeastBlock)) {
    if (await chainIdOf(client) !== d.chainId) throw new Error('prepaid RPC chain mismatch')
    const at = {blockNumber: tip.blockNumber, blockHash: tip.blockHash, blockTimestamp: tip.blockTimestamp}
    requireFresh(at)
    followedObservations.add(at)
    return at
  }
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

// A followed tip may be one block behind a state the caller already saw elsewhere: another client,
// or a transaction another code path mined (a key publish, a reshare, a reservation or allowance).
// A positive answer at that tip stands (the follower's tip is as fresh as a `latest` read within
// its liveness bound). A REFUSAL that a newer block could reverse is checked once more at a fresh
// `latest` read by RPC - never the follower's tip, never a shared or remembered head - before it is
// reported. When `latest` is the same block (or behind the tip), the refusal stands unchanged.
const followedObservations = new WeakSet<PrepaidObservation>()
const staleRefusals = new WeakSet<object>()

/** Mark a refusal that a block newer than the observation could reverse. */
function reversible<E extends Error>(error: E): E {
  staleRefusals.add(error)
  return error
}

/** As {@link observeLatest}, after the deployment and chain checks {@link observe} makes. */
async function observeFresh(client: PublicClient, d: PrepaidDeployment): Promise<PrepaidObservation> {
  validateDeployment(d)
  const [chain, head] = await Promise.allSettled([chainIdOf(client), observeLatest(client)])
  if (chain.status === 'rejected') throw chain.reason
  if (chain.value !== d.chainId) throw new Error('prepaid RPC chain mismatch')
  if (head.status === 'rejected') throw head.reason
  return head.value
}

/** A `latest` head read by RPC for this decision alone: not the followed tip, not shared with another read. */
async function observeLatest(client: PublicClient): Promise<PrepaidObservation> {
  const block = await client.getBlock({blockTag: 'latest'})
  if (block.number === null || block.hash === null || !HEX32.test(block.hash) || block.hash === ZERO32 || block.timestamp < 0n) {
    throw new Error('prepaid canonical head unavailable')
  }
  const at = {blockNumber: block.number, blockHash: block.hash, blockTimestamp: block.timestamp}
  requireFresh(at)
  return at
}

/**
 * Decide at `at`; when `at` is a followed tip and the decision is a reversible refusal, decide once
 * more at a fresh `latest` that is newer than the tip. Any other outcome is returned or thrown as is.
 */
async function decideAtFreshHead<T>(client: PublicClient, at: PrepaidObservation, decide: (at: PrepaidObservation) => Promise<T>): Promise<T> {
  try {
    return await decide(at)
  } catch (error) {
    if (!followedObservations.has(at) || typeof error !== 'object' || error === null || !staleRefusals.has(error)) throw error
    const latest = await observeLatest(client)
    if (latest.blockNumber <= at.blockNumber) throw error
    // Later observations read the RPC head until the follower reaches this block (never this head itself).
    headFollowerOf(client)?.noteMinedBlock(latest.blockNumber)
    return decide(latest)
  }
}

type ReadName = 'prepaidEnabled' | 'balanceOf' | 'reservedBalanceOf' | 'prepaidCost' | 'prepaidSettled' | 'prepaidRefunded' | 'prepaidAssignmentBlock'

async function readAt(client: PublicClient, settlement: Address, at: PrepaidObservation, name: ReadName, slot: Hex, requestId?: Hex): Promise<unknown> {
  const data = requestId === undefined
    ? encodeFunctionData({abi: settlementAbi, functionName: name, args: [slot]})
    : encodeFunctionData({abi: settlementAbi, functionName: name, args: [slot, requestId]})
  // Same canonical block-hash read, batched with the other reads at this block where possible. Never
  // shared with another operation's read, except at a block the head follower vouches for, whose
  // pinned answers (and pre-reads) are fixed facts served from the block-hash cache.
  const result = {data: headFollowerOf(client)?.isCanonical(at) === true
    ? await pinnedRegistryCall(client, at, settlement, data, false) : await pinnedCall(client, at.blockHash, settlement, data)}
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
  // Never fall back to latest or a block number when EIP-1898 is unsupported. A head follower that
  // proves `at` canonical (instant finality, live, gap-free, same hash) answers the recheck; any
  // other answer (a gap, not live, another hash, probabilistic finality) keeps the RPC recheck.
  if (headFollowerOf(client)?.isCanonical(at) === true) { requireFresh(at); return }
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
 * The beacon's current epoch at a fresh observed head (the followed tip when live, else `latest`),
 * through the same block-pinned read discovery uses. Performs no transaction.
 * @param client - Trusted bounded Viem RPC client for the selected deployment.
 * @param deployment - Independently approved chain and contract addresses, the beacon included.
 * @param options - `fresh`: read at an RPC `latest` head of its own, never a followed tip. For a
 *   decision a tip lagging the chain would get wrong (confirming that a grant left the window: a
 *   keeper judged it at a newer head; C21, two beacon pushes in a second).
 */
export async function readCurrentBeaconEpoch(client: PublicClient, deployment: PaidContextDeployment, options: {fresh?: boolean} = {}): Promise<bigint> {
  const at = options.fresh ? await observeFresh(client, deployment) : await observe(client, deployment)
  const epoch = await registryRead(client, at, deployment.beacon, thresholdRandomBeaconAbi, 'epoch')
  if (typeof epoch !== 'bigint') throw new Error('invalid beacon epoch')
  return epoch
}

/** The beacon's latest epoch and the newest epoch a session grant can be drawn on now. */
export interface BeaconDrawState {
  /** The beacon's latest epoch. */
  latest: bigint
  /**
   * `latest` once its verifier-set snapshot is anchored, else `latest - 1` when that one is, else
   * absent: the epoch the verifier-agent draws a new grant (or a session continuation) on, as the
   * agent picks it (`pick_draw_epoch`). A refresh before it moves past a grant's epoch can only
   * re-sign the grant on its own epoch.
   */
  draw?: bigint
}

/**
 * The beacon's latest epoch and its draw epoch ({@link BeaconDrawState}) at ONE fresh observed head
 * (the followed tip when live, else `latest`), through the block-pinned reads discovery uses. The
 * previous epoch's snapshot is read only while the latest one is not anchored. Performs no transaction.
 * @param client - Trusted bounded Viem RPC client for the selected deployment.
 * @param deployment - Independently approved chain and contract addresses, the beacon and verifier set included.
 */
export async function readBeaconDrawState(client: PublicClient, deployment: PaidContextDeployment): Promise<BeaconDrawState> {
  deployment = {...deployment}
  const at = await observe(client, deployment)
  const latest = await registryRead(client, at, deployment.beacon, thresholdRandomBeaconAbi, 'epoch')
  if (typeof latest !== 'bigint' || latest < 0n) throw new Error('invalid beacon epoch')
  const anchored = async (epoch: bigint) => {
    const [root, size] = await registryRead(client, at, deployment.verifierSet, verifierSetRegistryAbi, 'snapshotAt', [epoch]) as readonly [Hex, number]
    return typeof root === 'string' && HEX32.test(root) && root.toLowerCase() !== ZERO32 && size > 0
  }
  if (await anchored(latest)) return {latest, draw: latest}
  if (latest > 0n && await anchored(latest - 1n)) return {latest, draw: latest - 1n}
  return {latest}
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
 * @param options - `atLeastBlock`: a block the caller saw its own transaction mined in; an older
 *   followed tip is not used (it cannot show that transaction), the RPC head is read instead.
 */
export async function readPaidOperationReceipt(
  client: PublicClient, deployment: PrepaidDeployment, payment: PaymentIntentWire, expected: ExpectedPaidOperation,
  options: {atLeastBlock?: bigint} = {},
): Promise<PaidOperationReceipt> {
  deployment = {...deployment}; payment = structuredClone(payment); expected = {...expected}
  requirePaidOperation(deployment, payment, expected)
  return decideAtFreshHead(client, await observe(client, deployment, options.atLeastBlock), async at => {
    const receipt = checkReceiptReads(at, payment, await receiptReads(client, deployment, at, payment))
    await finishObservation(client, at)
    return receipt
  })
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

/** Backing reads at `at`: a reservation's five Settlement reads, or an allowance's record, the request's settlement state and the voucher check. */
type ReceiptReads = {kind: 'reservation'; reads: unknown[]} | {kind: 'allowance'; reads: unknown[]}
function receiptReads(client: PublicClient, deployment: PrepaidDeployment, at: PrepaidObservation, payment: PaymentIntentWire): Promise<ReceiptReads> {
  const requestId = prepaidRequestId(payment)
  if (payment.allowance_id !== undefined) {
    const voucher = payment.debit_voucher
    if (!voucher) return Promise.reject(new Error('allowance-backed payment carries no debit voucher'))
    const allowance = allowanceRead(client, deployment.settlement, at, 'prepaidAllowance', payment.allowance_id)
    const version = settlementVersionAt(client, at, deployment.settlement)
    // ADR-0092 (Settlement "5"): a range-settled allowance advances its settled seq and writes no
    // per-request records, so the request's own `prepaidSettled` stays false. The settled seq is
    // read at the same block, and consulted only when the version read there is "5" (an older
    // version has no getter: the read reverts, is never cached, and cost one more round each time).
    const settledSeq = settledSeqAt(client, deployment.settlement, at, payment.allowance_id, version)
    return Promise.all([readAt(client, deployment.settlement, at, 'prepaidEnabled', payment.slot), allowance,
      readAt(client, deployment.settlement, at, 'prepaidCost', payment.slot, requestId), readAt(client, deployment.settlement, at, 'prepaidSettled', payment.slot, requestId),
      readAt(client, deployment.settlement, at, 'prepaidRefunded', payment.slot, requestId), verifyDebitVoucher(client, deployment, voucher),
      version, settledSeq]).then(reads => ({kind: 'allowance', reads}))
  }
  const names = ['prepaidEnabled', 'prepaidCost', 'prepaidSettled', 'prepaidRefunded', 'prepaidAssignmentBlock'] as const
  return Promise.all(names.map(name =>
    readAt(client, deployment.settlement, at, name, payment.slot, name === 'prepaidEnabled' ? undefined : requestId))).then(reads => ({kind: 'reservation', reads}))
}

/** A settled-seq read that was not made: the version at the same block is not "5", so it is never consulted. */
const SETTLED_SEQ_NOT_READ = Object.freeze({error: new Error('settled seq not read: Settlement version is not "5"')})

/**
 * The allowance's settled seq at `at`, as `{value}` or `{error}`, for a decision that consults it
 * only when `version` (read at the same block) is "5". Scheduling only, never an answer: while the
 * last version this client read from `settlement` was "5" (or none was read yet) the getter is read
 * beside `version`, in the same round; otherwise it is read after `version`, and only when that
 * version is "5" (an upgrade the hint missed costs one more round, once).
 */
function settledSeqAt(client: PublicClient, settlement: Address, at: PrepaidObservation, allowanceId: Hex, version: Promise<unknown>): Promise<{value: unknown} | {error: unknown}> {
  const read = () => allowanceRead(client, settlement, at, 'prepaidAllowanceSettledSeq', allowanceId).then(value => ({value}), (error: unknown) => ({error}))
  const hint = settlementVersionHint(client, settlement)
  if (hint === undefined || hint === '5') return read()
  return version.then(v => v === '5' ? read() : SETTLED_SEQ_NOT_READ, () => SETTLED_SEQ_NOT_READ)
}

/** One allowance-keyed Settlement read at `at` (block-hash cached only where the head follower vouches). */
function allowanceRead(client: PublicClient, settlement: Address, at: PrepaidObservation, name: 'prepaidAllowance' | 'prepaidAllowanceSettledSeq', allowanceId: Hex): Promise<unknown> {
  const data = encodeFunctionData({abi: settlementAbi, functionName: name, args: [allowanceId]})
  return (headFollowerOf(client)?.isCanonical(at) === true
    ? pinnedRegistryCall(client, at, settlement, data, false) : pinnedCall(client, at.blockHash, settlement, data))
    .then(result => { if (result === undefined) throw new Error(`empty ${name} response`); return decodeFunctionResult({abi: settlementAbi, functionName: name, data: result}) })
}

/**
 * Pre-read one in-flight paid operation's own settlement state (its request's cost, settlement,
 * refund and assignment block; for an allowance-backed one also the allowance record) at every
 * new followed head until the payment expires, so the receipt, client policy and keeper target
 * checks at that head find it cached. Without a head follower this does nothing.
 * @param client Trusted client with a head follower attached.
 * @param deployment Approved deployment.
 * @param payment The operation's creator-signed intent.
 */
export function followPaidRequest(client: PublicClient, deployment: PrepaidDeployment & Partial<Pick<ClientExecutionDeployment, 'beacon' | 'verifierSet'>>, payment: PaymentIntentWire): void {
  if (!headFollowerOf(client)) return
  const d = {...deployment}, slot = payment.slot, requestId = prepaidRequestId(payment), allowanceId = payment.allowance_id
  const epoch = BigInt(payment.verification_epoch)
  registerHeadPrefetch(client, `paid-request:${d.settlement}:${requestId}`.toLowerCase(), tip => {
    const at: PrepaidObservation = {blockNumber: tip.blockNumber, blockHash: tip.blockHash, blockTimestamp: tip.blockTimestamp}
    const names = ['prepaidCost', 'prepaidSettled', 'prepaidRefunded', 'prepaidAssignmentBlock'] as const
    const version = allowanceId ? settlementVersionAt(client, at, d.settlement) : undefined
    version?.catch(() => {})
    return Promise.allSettled([readAt(client, d.settlement, at, 'prepaidEnabled', slot), ...names.map(name => readAt(client, d.settlement, at, name, slot, requestId)),
      ...(allowanceId && version ? [allowanceRead(client, d.settlement, at, 'prepaidAllowance', allowanceId), version,
        settledSeqAt(client, d.settlement, at, allowanceId, version)] : []),
      // The client execution policy's reads at the payment's own draw epoch (an allowance's draw is
      // older than the slot pre-read's latest/previous epochs): its seed and verifier snapshot.
      ...(d.beacon && d.verifierSet ? [registryRead(client, at, d.beacon, thresholdRandomBeaconAbi, 'seedAt', [epoch]),
        registryRead(client, at, d.verifierSet, verifierSetRegistryAbi, 'snapshotAt', [epoch])] : [])])
  }, payment.expires * 1000)
}

function checkReceiptReads(at: PrepaidObservation, payment: PaymentIntentWire, observed: ReceiptReads): PaidOperationReceipt {
  if (observed.kind === 'allowance') return checkAllowanceBacking(at, payment, observed.reads)
  const [enabled, cost, settled, refunded, assignmentBlock] = observed.reads
  if (enabled !== true || typeof cost !== 'bigint' || cost <= 0n || cost > BigInt(payment.max_cost)
    || typeof settled !== 'boolean' || typeof refunded !== 'bigint' || refunded < 0n || refunded > cost
    || (!settled && refunded !== 0n) || typeof assignmentBlock !== 'string' || !HEX32.test(assignmentBlock) || assignmentBlock === ZERO32) {
    throw reversible(new Error('operation has no valid reserved TASRA fee'))
  }
  return {...at, requestId: prepaidRequestId(payment), cost, settled, refunded, assignmentBlock: assignmentBlock as Hex}
}

/**
 * Allowance backing, from the client side: the allowance is mined and canonical at `at`, for this slot,
 * open, unexpired and funding the action; the (already signature-verified) voucher debits THIS
 * request within the per-operation cap and the escrow; the request is not per-operation reserved
 * (`prepaidCost` is 0 until the allowance settle writes the voucher's cost). The voucher's cost and
 * the allowance's immutable assignment block stand in for a reservation's.
 */
function checkAllowanceBacking(at: PrepaidObservation, payment: PaymentIntentWire, reads: unknown[]): PaidOperationReceipt {
  const [enabled, record, reservedCost, perRequestSettled, refunded, , version, settledSeqRead] = reads as [unknown, readonly [Hex, Hex, bigint, bigint, bigint, bigint, bigint, number, boolean], unknown, unknown, unknown,
    unknown, unknown, {value: unknown} | {error: unknown}]
  // The backing is judged per Settlement version at this block: "5" adds range settlement (ADR-0092),
  // under which a voucher at or below the allowance's settled seq is settled even though its
  // per-request records were never written. Any other version is refused here.
  if (!isPrepaidSettlementVersion(version)) throw new Error('operation backing read at an unknown Settlement version')
  let settled = perRequestSettled
  if (version === '5') {
    if ('error' in settledSeqRead) throw settledSeqRead.error
    const settledSeq = settledSeqRead.value
    if (typeof settledSeq !== 'bigint' || typeof perRequestSettled !== 'boolean') throw new Error('operation has no valid allowance-backed TASRA debit')
    settled = perRequestSettled || BigInt(payment.debit_voucher!.seq) <= settledSeq
  }
  const voucher = payment.debit_voucher!
  const [slotId, assignmentBlock, amount, , maxOpCost, expiresAt, , actions, closed] = record
  const cost = BigInt(voucher.cost)
  const bit = ({'sign': 0, 'decrypt': 1, 'eoa-sign': 2, 'ibe-extract': 3, 'dual-approve': 6} as const)[payment.action]
  if (enabled !== true || !HEX32.test(assignmentBlock) || assignmentBlock.toLowerCase() === ZERO32 || amount === 0n || slotId.toLowerCase() !== payment.slot.toLowerCase()
    || closed || at.blockTimestamp >= expiresAt || (actions & (1 << bit)) === 0 || cost > maxOpCost || cost > BigInt(payment.max_cost) || BigInt(voucher.cumulative) > amount
    || typeof reservedCost !== 'bigint' || (reservedCost !== 0n && reservedCost !== cost) || typeof settled !== 'boolean' || typeof refunded !== 'bigint'
    || refunded < 0n || refunded > cost || (!settled && (refunded !== 0n || reservedCost !== 0n))) {
    throw reversible(new Error('operation has no valid allowance-backed TASRA debit'))
  }
  return {...at, requestId: prepaidRequestId(payment), cost, settled: settled as boolean, refunded, assignmentBlock}
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
  return decideAtFreshHead(client, await observe(client, deployment), async at => {
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
    if (slot.epoch !== BigInt(assignment.key_epoch) || slot.committeeVersion !== BigInt(assignment.committee_version) || slot.threshold.k !== assignment.threshold) throw reversible(new Error('payment keeper sharing or threshold changed'))
    const creator = await recoverTypedDataAddress({...paymentIntentTypedData(payment), signature: payment.signature})
    if (creator.toLowerCase() !== slot.creator.toLowerCase()) throw reversible(new Error('payment is not signed by the slot creator'))
    const endpoint = (key: Hex) => keeperEndpoint(members, key, deployment.chainId, transport)
    const contributors = assignment.contributors.map(key => endpoint(toHex(Uint8Array.from(key))))
    const coordinator = endpoint(toHex(Uint8Array.from(assignment.coordinator)))
    if (BigInt(payment.expires) <= time()) throw new Error('payment expired during coordinator discovery')
    return {...coordinator, receipt, contributors, groupPublicKey: slot.publicKey, mode: slot.mode}
  })
}

interface KeeperDirectoryMember {key: Hex; id: bigint; operator: Address; url: string; eligible: boolean}
async function keeperDirectory(client: PublicClient, at: PrepaidObservation, registry: Address, slotId: Hex, acceptedTime = at.blockTimestamp) {
  const [slot, assigned, nodes] = await Promise.all([
    registryRead(client, at, registry, keyRegistryAbi, 'getKeySlot', [slotId]) as Promise<ReadContractReturnType<typeof keyRegistryAbi, 'getKeySlot'>>,
    registryRead(client, at, registry, keyRegistryAbi, 'assignedNodes', [slotId]) as Promise<readonly Address[]>,
    registryRead(client, at, registry, keyRegistryAbi, 'nodeRegistry') as Promise<Address>,
  ])
  if (!slot.exists || slot.cancelled || (slot.expiry !== 0n && slot.expiry <= acceptedTime) || slot.publicKey === '0x') throw reversible(new Error('paid slot is inactive or has no published key'))
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
  if (!member?.eligible) throw reversible(new Error('paid contributor is not an eligible assigned keeper'))
  const url = new URL(member.url)
  if (url.username || url.password || url.search || url.hash
    || (url.protocol !== 'https:' && !(transport.allowLocalHttp === true && chainId === 43112 && url.protocol === 'http:'))) throw new Error('invalid paid keeper URL or transport')
  return {operator: member.operator, publicKey: key, url: url.toString().replace(/\/$/, '')}
}

function safeInteger(value: bigint, name: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${name} exceeds the JSON integer range`)
  return Number(value)
}

function settlementVersionAt(client: PublicClient, at: PrepaidObservation, settlement: Address): Promise<unknown> {
  return pinnedRegistryCall(client, at, settlement, encodeFunctionData({abi: settlementAbi, functionName: 'version'}), false)
    .then(data => {
      if (data === undefined) throw new Error('empty Settlement version response')
      const version = decodeFunctionResult({abi: settlementAbi, functionName: 'version', data})
      if (typeof version === 'string') rememberSettlementVersion(client, settlement, version)
      return version
    })
}

// The Settlement version each settlement answered this client last: a HINT that only decides
// whether a version-dependent read is issued beside the version read or after it, never an answer
// (every decision judges the version read at its own block). Bounded per client.
const MAX_SETTLEMENT_VERSION_HINTS = 64
const settlementVersionHints = new WeakMap<PublicClient, Map<string, string>>()
function settlementVersionHint(client: PublicClient, settlement: Address): string | undefined {
  return settlementVersionHints.get(client)?.get(settlement.toLowerCase())
}
function rememberSettlementVersion(client: PublicClient, settlement: Address, version: string): void {
  let hints = settlementVersionHints.get(client)
  if (!hints) settlementVersionHints.set(client, hints = new Map<string, string>())
  const key = settlement.toLowerCase()
  if (hints.get(key) === version) return
  hints.delete(key)
  if (hints.size >= MAX_SETTLEMENT_VERSION_HINTS) hints.delete(hints.keys().next().value as string)
  hints.set(key, version)
}

/**
 * Every block-pinned read discovery makes for `slotId` at `at` (also the head follower's pre-read).
 * The latest epoch's anchors depend only on that epoch, not on the keeper directory: they are read
 * beside its second step. Callers judge the answers in the original order.
 */
function slotReads(client: PublicClient, deployment: PaidContextDeployment, slotId: Hex, at: PrepaidObservation) {
  const seedAt = (epoch: bigint) => registryRead(client, at, deployment.beacon, thresholdRandomBeaconAbi, 'seedAt', [epoch]) as Promise<Hex>
  const snapshotAt = (epoch: bigint) => registryRead(client, at, deployment.verifierSet, verifierSetRegistryAbi, 'snapshotAt', [epoch]) as Promise<readonly [Hex, number]>
  const accountantAt = (epoch: bigint) => registryRead(client, at, deployment.accountantSet, accountantSetRegistryAbi, 'snapshotAt', [epoch]) as Promise<readonly [Hex, number]>
  const latestEpoch = registryRead(client, at, deployment.beacon, thresholdRandomBeaconAbi, 'epoch') as Promise<bigint>
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
    // The billing check (what requirePrepaidSlot read in its own rounds before discovery): the
    // Settlement version at this same block. Only "2" | "3" | "4" bill prepaid.
    settlementVersionAt(client, at, deployment.settlement),
  ])
  return {seedAt, snapshotAt, accountantAt, latestEpoch, latestAnchors, reads}
}

/**
 * Pre-read `slotId`'s discovery state at every new followed head (the current and previous
 * epoch's anchors and the accountant group key included), so an operation at that head reads it from the cache. Errors are
 * dropped: the operation's own read surfaces them.
 */
function followPaidSlot(client: PublicClient, deployment: PaidContextDeployment, slotId: Hex): void {
  const d = {...deployment}
  registerHeadPrefetch(client, `paid-slot:${d.settlement}:${slotId}`.toLowerCase(), async tip => {
    const at: PrepaidObservation = {blockNumber: tip.blockNumber, blockHash: tip.blockHash, blockTimestamp: tip.blockTimestamp}
    const {seedAt, snapshotAt, accountantAt, latestEpoch, latestAnchors, reads} = slotReads(client, d, slotId, at)
    // The accountant group key at this head: an allowance debit quoted here verifies its voucher against it.
    const current = Promise.allSettled([reads, latestAnchors, readAccountantGroupKey(client, d, at.blockHash)])
    const epoch = await latestEpoch.catch(() => undefined)
    await Promise.allSettled([current, ...(epoch ? [seedAt(epoch - 1n), snapshotAt(epoch - 1n), accountantAt(epoch - 1n)] : [])])
  })
}

/**
 * Discover keeper sharing and verifier policy from one fresh canonical block before creating an intent.
 * Selects the current epoch with both verifier and accountant snapshots, otherwise its immediate predecessor.
 * Performs no signing, reservation, service contact or gas/TASRA mutation.
 * @param client - Trusted bounded Viem client supporting EIP-1898 canonical reads.
 * @param deployment - Independently approved contract and beacon addresses.
 * @param slotId - Independently selected slot to fund and operate.
 * @param options - Approved default verifier policy, optional coordinator and transport policy.
 * @returns A {@link DrawnPaidOperationContext}, unless `undrawnDuringAnchorGap` is set: then possibly an {@link UndrawnPaidOperationContext}.
 */
export function discoverPaidOperationContext(
  client: PublicClient, deployment: PaidContextDeployment, slotId: Hex, options?: PaidContextOptions & {undrawnDuringAnchorGap?: false},
): Promise<DrawnPaidOperationContext>
/**
 * As above, with {@link PaidContextOptions.undrawnDuringAnchorGap} possibly set: the result may be an
 * {@link UndrawnPaidOperationContext} (narrow on `undrawn` before building any payment intent).
 * @param client - Trusted bounded Viem client supporting EIP-1898 canonical reads.
 * @param deployment - Independently approved contract and beacon addresses.
 * @param slotId - Independently selected slot to fund and operate.
 * @param options - Approved default verifier policy, optional coordinator, transport policy and the anchor-gap opt-in.
 */
export function discoverPaidOperationContext(
  client: PublicClient, deployment: PaidContextDeployment, slotId: Hex, options?: PaidContextOptions,
): Promise<PaidOperationContext>
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
  // One attempt at one observation: the discovered state, or the reason to wait for a newer head.
  type Attempt = {wait: string} | {at: PrepaidObservation; policy: readonly [number, number]; available: bigint; directory: Awaited<ReturnType<typeof keeperDirectory>>
    epoch: bigint; seed: Hex; root: Hex; size: number; latest: bigint; undrawn?: true}
  const undrawnOk = options.undrawnDuringAnchorGap === true && options.fundedByAllowance === true && options.verificationEpoch === undefined
  // The billing check reads its own head. At a followed tip whose refusal is decided again at a
  // newer `latest`, it is left to that decision (or, when none follows, run once before refusing).
  let billing: 'none' | 'deferred' | 'judged' = 'none'
  const judgeBilling = async (at: PrepaidObservation, error?: unknown) => {
    if (followedObservations.has(at) && (error === undefined || (typeof error === 'object' && error !== null && staleRefusals.has(error)))) {
      if (billing === 'none') billing = 'deferred'
      return
    }
    billing = 'judged'
    await refuseUnlessPrepaid(client, deployment, slotId)
  }
  const attempt = async (at: PrepaidObservation): Promise<Attempt> => {
    const {seedAt, snapshotAt, accountantAt, latestAnchors, reads} = slotReads(client, deployment, slotId, at)
    // On a failed read, a legacy or unreadable billing mode is the clearer refusal.
    const [keyBeacon, snapshotBeacon, accountantBeacon, latest, policy, enabled, available, directory, version] = await reads.catch(async (error: unknown) => {
      await judgeBilling(at, error)
      throw error
    })
    // An unknown version is never guessed prepaid, even with prepaidEnabled set: the typed refusal names it.
    if (!isPrepaidSettlementVersion(version)) {
      await refuseUnlessPrepaid(client, deployment, slotId)
      throw new Error('payment discovery Settlement version is not prepaid')
    }
    if (enabled !== true) {
      // Every outcome below is a refusal (reversible unless a beacon pointer differs).
      await judgeBilling(at)
      // Prepaid from genesis but never funded: the first funding activates it.
      if (available === 0n) throw reversible(new UnderfundedSlotError({slotId, availableTasraUnits: 0n,
        message: 'payment discovery requires an activated TASRA-funded slot'}))
    }
    if ([keyBeacon, snapshotBeacon, accountantBeacon].some(pointer => pointer.toLowerCase() !== deployment.beacon.toLowerCase())) throw new Error('payment discovery beacon pointers differ')
    if (enabled !== true || typeof available !== 'bigint' || available < 0n) throw reversible(new Error('payment discovery requires an activated TASRA-funded slot'))
    if (available === 0n && options.fundedByAllowance !== true) throw reversible(new UnderfundedSlotError({slotId, availableTasraUnits: available,
      message: 'payment discovery requires an activated TASRA-funded slot'}))
    let epoch = latest
    let [seed, [root, size], accountant] = await latestAnchors
    if (seed === ZERO32) throw new Error('current beacon seed unavailable')
    const pinned = options.verificationEpoch
    if (pinned !== undefined) {
      // A session grant's draw: the latest epoch (its anchors may still be landing: wait), or the
      // previous one, never anything older (no keeper admits that grant) or newer. A grant one epoch
      // AHEAD of this head was drawn at a newer block than this one: a newer head may admit it.
      if (pinned !== latest && pinned !== latest - 1n) {
        const moved = new PaidDrawMovedError(pinned, latest)
        throw pinned === latest + 1n ? reversible(moved) : moved
      }
      if (pinned !== latest) {
        epoch = pinned
        ;[seed, [root, size], accountant] = await Promise.all([seedAt(epoch), snapshotAt(epoch), accountantAt(epoch)])
        if (!complete(seed, root, size, accountant)) throw new Error('pinned verifier epoch has no complete anchors')
      } else if (!complete(seed, root, size, accountant)) return {wait: 'pinned verifier epoch anchors are not complete yet'}
      return {at, policy, available, directory, epoch, seed, root, size, latest}
    }
    if (!complete(seed, root, size, accountant)) {
      if (epoch === 0n) throw new Error('no anchored verifier and accountant snapshots')
      epoch--
      ;[seed, [root, size], accountant] = await Promise.all([seedAt(epoch), snapshotAt(epoch), accountantAt(epoch)])
      // A new epoch's anchors have not landed yet (see PaidAnchorWait): wait and observe again.
      if (!complete(seed, root, size, accountant)) {
        // An allowance-funded caller pays the allowance's draw: the keeper sharing read here is all it needs.
        if (undrawnOk) return {at, policy, available, directory, epoch: 0n, seed: ZERO32 as Hex, root: ZERO32 as Hex, size: 0, latest, undrawn: true}
        return {wait: 'no current or previous anchored verifier and accountant snapshots'}
      }
    }
    return {at, policy, available, directory, epoch, seed, root, size, latest}
  }
  // One fresh canonical observation per attempt; an attempt that finds no admissible complete
  // epoch waits (bounded) and observes again at a newer head, never re-reads an old one. A
  // reversible refusal at a followed tip is decided once more at a newer RPC `latest`.
  const observed = await (async () => {
    for (;;) {
      const head = await observe(client, deployment)
      if (headFollowerOf(client)) followPaidSlot(client, deployment, slotId)
      billing = 'none'
      const result = await decideAtFreshHead(client, head, attempt).catch(async (error: unknown) => {
        if (billing === 'deferred') { billing = 'judged'; await refuseUnlessPrepaid(client, deployment, slotId) }
        throw error
      })
      if (!('wait' in result)) return result
      if (wait.clock.now() + wait.pollMs > deadline) throw new Error(result.wait)
      await wait.clock.sleep(wait.pollMs)
    }
  })()
  const {at, policy, available, directory, epoch, seed, root, size, latest, undrawn} = observed
  const [onChainCommittee, onChainQuorum] = policy
  if (onChainCommittee === 0 && onChainQuorum !== 0) throw new Error('invalid on-chain verifier policy')
  const approved = onChainCommittee === 0
    ? options.defaultVerificationPolicy ?? {committee: 0, quorum: 0}
    : {committee: onChainCommittee, quorum: onChainQuorum}
  // Undrawn: no draw to size the policy against; the verification fields stay zero (refused by every reader).
  if (!Number.isInteger(approved.committee) || !Number.isInteger(approved.quorum) || approved.quorum <= 0 || approved.quorum > approved.committee || approved.committee > 4096
    || (!undrawn && approved.committee > size)) throw new Error('missing or invalid approved verifier policy')
  const {committee, quorum} = undrawn ? {committee: 0, quorum: 0} : approved
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
  const sharing: UndrawnPaymentFields = {chain_id: deployment.chainId, settlement: deployment.settlement, key_registry: deployment.keyRegistry, slot: slotId, keeper_assignment: assignment}
  await finishObservation(client, at)
  const base: PaidOperationContextBase = {...at, creator: directory.slot.creator, mode: directory.slot.mode, groupPublicKey: directory.slot.publicKey, coordinator, contributors: endpoints, available,
    ruleCommitment: directory.slot.ruleCommitment, beaconEpoch: latest}
  // Undrawn: no verification fields at all (not zeroed ones), so no intent can be built from it.
  if (undrawn) return {...base, intentFields: sharing, undrawn}
  const intentFields: DiscoveredPaymentFields = {...sharing,
    verification_epoch: safeInteger(epoch, 'verification epoch'), verification_seed: seed, verification_root: root, verification_registry_size: size,
    verification_committee: committee, verification_quorum: quorum}
  return {...base, intentFields}
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
