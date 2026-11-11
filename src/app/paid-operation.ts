import {verifyEvidenceBinding} from '../committee/evidence.js'
import {recipientPayloadDigest, type ClientRecipient, type DecryptionBindingWire, type SealedShareWire} from '../crypto/recipient.js'
import {sha256} from '@noble/hashes/sha256'
import {ibeVerifyShare} from '../crypto/ibe.js'
// One paid committee operation, end to end, from the client side.
//
//   billing guard → canonical discovery → creator-signed operation and payment intent →
//   drawn verifier witnesses → accountant quote + on-chain reservation (dedicated gas payer) →
//   creator execution certificate → registered paid session (stage approvals, presentation,
//   continuation) → verified committee grant → the keeper operation, once.
//
// Every step that spends or sends a billable write is journaled in the application store
// before it happens. An uncertain step is never repeated automatically: the call throws
// PaidOperationRecoveryError naming the request, and resumePaidOperation continues from the
// journal (reconciling the reservation on chain, re-reading the session) without a second
// reservation, a second session or a second keeper execution.

import {hexToBytes, keccak256, toHex, type Account, type Address, type Chain, type Hex, type LocalAccount, type Transport, type WalletClient} from 'viem'
import type {TasraChainClient} from '../chain/client.js'
import {keyRegistryAbi} from '../chain/abis/keyRegistry.js'
import type {BillingModeDetector} from '../chain/billing.js'
import {discoverPaidOperationContext, followPaidRequest, readClientExecutionPolicy, readCurrentBeaconEpoch, type ExpectedPaidOperation, type PaidContextDeployment,
  type PaidKeeperEndpoint, type PaidOperationContext, type PaidVerifierWitness, drawnIntentFields} from '../chain/prepaid.js'
import {fetchDrawnVerifierWitnesses} from '../chain/verifierSnapshot.js'
import {prepareRegisteredPaidSession, type PaidAgentSessionParams} from '../chain/registeredPaidAgent.js'
import type {PaidAgentTransport} from '../chain/paidAgentTransport.js'
import type {ApprovedAgentProfile} from '../chain/registeredAgent.js'
import {createKeeperExecutionApprover} from '../chain/keeperExecution.js'
import {recoverKeeperExecution, type KeeperRecoveryTransport, type RecoveredKeeperExecution} from '../chain/keeperRecovery.js'
import {ruleCommitment} from '../chain/write.js'
import {loadPaidReservationJournal} from './paid-journal.js'
import {reserveApplicationPayment, reconcileApplicationPayment, reconcileApplicationReservation, ApplicationPayerRecoveryError,
  type ApplicationReservationState} from './paid-reservation.js'
import type {SessionGrantCreateFragment} from './session-grants.js'
import type {SessionGrantRequestWire, SessionGrantWire} from '../committee/session-grant.js'
import {drivePaidSession, waitForPaidSnapshot, FIRST_COMMIT, PaidSessionRecoveryError, type FirstCommit, type PaidSessionDriverOptions, type PaidSessionHolder} from './paid-session.js'
import {PaidAgentControlError} from '../chain/registeredPaidAgent.js'
import {VerifierAgentSessionError} from '../verifier-agent/index.js'
import type {ApplicationStore} from './ready-slot.js'
import {withDedicatedPayer} from './payer-queue.js'
import {createExecutionCertificate, createLocalExecutionSigner, type ExecutionCertificate, type ExecutionStage} from '../committee/execution.js'
import type {KeeperExecutionApprover} from '../committee/keeperExecution.js'
import {allowanceActionBits, paymentIntentHash, paymentIntentTypedData, paymentSessionCommitment, prepaidRequestId, type AllowanceAction, type DebitVoucherWire, type PaymentIntentWire} from '../committee/payment.js'
import {compoundTokenHash, decodeCompoundToken, requireStatusAttestations, signersThatVerify, verifyStatusAttestation, verifyStatusAttestations, STATUS_SKEW_SECS,
  type CompoundTokenWire, type StatusAttestationWire} from '../committee/token.js'
import {acceptStatusRefreshRelay, createStatusRefreshProof, refreshStatusDirect, statusRefreshRelayBody, type StatusRefreshHolderSigner,
  type StatusRefreshPrincipal, type StatusRefreshResult} from '../committee/status-refresh.js'
import {canonicalize} from '../auth/oid4vp.js'
import {presentationOperationTypedData, verifierAgentResult, type PresentationOperation} from '../oid4vp/verifier-agent.js'
import {requestHash, type CommitteeAction} from '../oid4vp/binding.js'
import type {VerifiedRequestObject} from '../oid4vp/request-object.js'
import type {VerifierProof} from '../committee/client.js'
import {PaidApprovalUnresolvedError, RevocationStatusPreflightError, StatusRefreshError, TasraError, type StatusRefreshCode, type StatusRefreshFailure} from '../errors.js'
import {base64Decode} from '../crypto/envelope.js'
import type {IbeExtractionPartial} from '../committee/client.js'
import {HEX32, RECORD_KEY, RECORD_PREFIX, paidRecordKey as recordKey} from './paid-keys.js'
import {AllowanceRefusedError, allowanceLaneCount, journaledAllowanceVoucher, obtainAllowanceVoucher, prepareAllowanceLane, selectAllowanceLane, validateAllowanceOptions, validateLaneReadiness, validateReadinessHorizon,
  type AllowanceEnv, type LaneReadiness, type PaidAllowanceOptions} from './paid-allowance.js'
import {storeIdentity, withCommit, type LockedCommit} from './store-commit.js'

/** Approved deployment, signers, services and spending limits shared by paid operations. */
export interface PaidOperationConfig {
  /** Trusted chain client; its ServiceRegistry address must match the approved agent profile. */
  chain: TasraChainClient
  /** Independently approved contracts, with the deployment default verifier policy. */
  deployment: PaidContextDeployment & {defaultVerificationPolicy?: {committee: number; quorum: number}}
  /** Slot creator: signs the operation, the payment intent and the execution certificate. */
  creator: Pick<LocalAccount, 'address' | 'signTypedData'>
  /** Dedicated reservation gas payer (account- and chain-bound). Never shared with unrelated sends. */
  gasPayer: WalletClient<Transport, Chain, Account>
  /** Private durable store with exclusive locks shared by every process or tab using this payer. */
  store: ApplicationStore
  /** Independently approved verifier-agent and its guarded transport. */
  agent: {profile: ApprovedAgentProfile; transport: PaidAgentTransport}
  /** Approved accountant origins: reservation quotes and verifier snapshot artifacts. */
  accountantUrls: readonly string[]
  /** Finite spending limits: TASRA per operation, gas units and gas price for the reservation. */
  limits: {maxCost: bigint; maxGas: bigint; maxGasPrice: bigint}
  /** Permit HTTP on the local development chain (43112) only. */
  allowLocalHttp?: boolean
  /** Caller-approved keeper route map (registered URL to reachable URL). */
  keeperUrl?: (registeredUrl: string) => string
  /** Cached billing detector for this deployment; a fresh read is used when absent. */
  billing?: BillingModeDetector
  /** Fetch used for verifier snapshot artifacts (defaults to global fetch). */
  fetch?: typeof fetch
  /** Longest wait for the current epoch's snapshots to be anchored, ms (default 180000, max 300000). */
  snapshotWaitMs?: number
  /**
   * Poll interval while waiting on the agent with nothing else to go on, ms (default 1000): a wallet
   * callback, or proposals not yet listed. Agent Retry-After hints take precedence. Approved
   * proposals and sent continuations are read back at once, and while the committee works the
   * session status is long-polled (`?wait=1`) instead.
   */
  pollIntervalMs?: number
  /**
   * Accept a grant WITHOUT revocation-status attestations (with a warning), only for a deployment
   * still inside the keepers' documented status-freshness migration window. Default false: the
   * grant is refused with `revocation_status_missing` before execution. Stale or invalid
   * attestations are always refused.
   */
  allowMissingStatusAttestations?: boolean
  /**
   * ADR-0090 prepaid allowances, DEFAULT OFF. With `enabled: true` an operation whose slot has a
   * lane with room is paid by an accountant-quorum debit voucher against a reserved allowance
   * instead of its own on-chain reservation; otherwise (no usable lane, exhausted, expired or
   * refused) it falls back to the per-operation reservation. Enable only when every reader on the
   * deployment is at the ADR-0090 version: the network advertises no capability for it.
   */
  allowances?: PaidAllowanceOptions
}

/** The one operation to authorize and how its holder presents. */
export interface PaidOperationRequest {
  /** Slot to operate on. */
  slot: Hex
  /** Committee action and payload: `message` for sign, `identity` for ibe-extract, `payloadDigest` for decrypt/dual-approve. */
  operation: {action: CommitteeAction; message?: Uint8Array; identity?: string; payloadDigest?: Uint8Array; decryption?: DecryptionBindingWire; ttlSecs?: number; description?: string}
  /** Exact provisioned DCQL rule bytes and salt. The chain commitment uses canonical JSON; the verifier token hash binds these original bytes unchanged. */
  rule: {rule: string; salt: Hex}
  /** Holder strategy: the SDK wallet presents itself, or an external wallet scans the request. */
  holder: PaidSessionHolder
  /** Pin the coordinator keeper (operator address); otherwise the first eligible keeper. */
  coordinator?: Address
  /** Cancellation for the authorization (reservation, session, grant). */
  signal?: AbortSignal
  /** Inspect the verified request object before any credential is disclosed. */
  observeRequest?(request: VerifiedRequestObject): void | Promise<void>
  /**
   * ADR-0090 D7: also open a session grant with this presentation (KEM `decrypt` only), for the
   * fresh session key in the fragment ({@link sessionGrantCreateFragment}). The fragment is public
   * and journaled; the presentation nonce binds its key. The verified grant comes back as
   * {@link PaidOperation.sessionGrant}; accept it with `acceptSessionGrant` and the same key.
   */
  sessionGrant?: SessionGrantCreateFragment
  /**
   * Receive the reservation identity as soon as it is derived, before witnesses are fetched or
   * anything is reserved, to link this run to its payment. A throw stops the operation before any
   * spending. Until the journal is written (just before reservation) `paidOperationPhase` returns
   * undefined for it.
   */
  onRequestId?(requestId: Hex): void | Promise<void>
}

/** A verified, paid committee authorization for exactly one keeper execution. */
export interface PaidOperation {
  /** Exact sealed presentation ciphertext persisted with the original grant. */
  readonly evidenceCt?: string
  /**
   * ADR-0090 D7, when the request asked for a session grant: the verified opening grant
   * (`{session_grant, refresh_seq: 0}`, the input of `acceptSessionGrant`), or why none came. The
   * compound token authorizes this one operation either way.
   */
  readonly sessionGrant?: {grant?: {session_grant: SessionGrantWire; refresh_seq: 0}; error?: string}
  /** Reservation identity (`prepaid-request/v1`), the key for resume and recovery. */
  readonly requestId: Hex
  /** Original creator-signed payment intent. */
  readonly payment: PaymentIntentWire
  /** The assigned coordinator keeper's reachable URL (after the approved route map). */
  readonly coordinatorUrl: string
  /** Verified compound token carrying the payment. */
  readonly compound_token: CompoundTokenWire
  /** Anchored verifier witnesses, for keeper calls. */
  readonly verifierProofs: VerifierProof[]
  /** The same witnesses in wire form. */
  readonly verifier_proofs: {verifier_index: number; operator: string; pubkey: string; proof: string[]}[]
  /** Client approver for keeper stage signatures; pass as `approveExecution` to committee clients. */
  readonly approveExecution: KeeperExecutionApprover
  /** Run the keeper operation exactly once. A failure is journaled and never retried; use `recover`. */
  execute<R>(work: (operation: PaidOperation) => Promise<R>): Promise<R>
  /**
   * Explicitly refresh the grant's revocation-status attestations
   * (`keykeeper/committee-status-refresh/v1`) for the SAME token and payment, before `execute`.
   * Allowed only while the journal is `authorized` (nothing was sent). A new `seq` is journaled
   * BEFORE the proof is signed or sent and is never reused, even after a crash. On success the
   * grant's `status_attestations` are replaced in the journal (the original list is kept in its
   * refresh history) and later `execute` calls and `compound_token` reads use them. Never automatic,
   * never retried; no new session, payment or keeper work. Throws {@link StatusRefreshError}.
   */
  refreshStatus(options?: RefreshPaidStatusOptions): Promise<PaidStatusRefresh>
  /** Read the keeper's retained result after an uncertain execution. Performs no new work. */
  recover(options: {transport: KeeperRecoveryTransport; stage?: Extract<ExecutionStage, 'coordinator' | 'contributor'>;
    /** Original assigned contributor public key; reads sealed result bytes without opening them. */
    contributorKey?: Hex; signal?: AbortSignal}): Promise<RecoveredKeeperExecution>
  /**
   * After an uncertain `ibe-extract` fan-out, read each assigned contributor's retained,
   * commitment-verified partial (stage `contributor`) until the payment's keeper threshold is
   * met. Performs no new work and never re-sends an extraction. Combine the partials with the
   * pairing-verifying IBE combine helpers. Throws when fewer than the threshold are recoverable.
   */
  recoverIbePartials(options: RecoverIbePartialsOptions): Promise<RecoveredIbePartials>
  /** Erase the local execution signer. */
  dispose(): void
}

/** Options for {@link PaidOperation.recoverIbePartials}. */
export interface RecoverIbePartialsOptions {
  /** Original client-held recipient. Its private key is never written to the operation journal. */
  recipient?: ClientRecipient
  /** Original identity and authenticated 144-byte G2 || G1 public shares. */
  identity?: string
  /** Original authenticated 144-byte G2 || G1 public shares used to validate recovered contributions. */
  verifyingShares?: ReadonlyMap<number, Uint8Array>
  /** Caller-approved guarded keeper recovery transport. */
  transport: KeeperRecoveryTransport
  /** Cancellation for the whole recovery; each keeper read also has its own 60-second deadline. */
  signal?: AbortSignal
  /** Contributors read at once, 1..16 (default 4). No new read starts after the threshold is met. */
  concurrency?: number
}

/** Options for {@link PaidOperation.refreshStatus} and {@link PaidOperationRecovery.refreshStatus}. */
export interface RefreshPaidStatusOptions {
  /**
   * Route: `'agent'` (default) relays through the original session of the approved verifier-agent
   * (journals written before the SDK recorded the session id cannot use it); `{verifiers}` calls
   * the original signers' verifiers directly. Either way every answer is verified here under the
   * anchored roster keys of the signers that verified the original token.
   */
  via?: 'agent' | {verifiers: readonly {index: number; url: string}[]; fetch?: typeof fetch}
  /**
   * Prove with the holder key recorded at issuance (`holder_key`) instead of the creator-certified
   * client execution key (`client_execution`, the default).
   */
  holder?: StatusRefreshHolderSigner
  /** Cancellation. An abort after the `seq` was journaled still consumes it. */
  signal?: AbortSignal
}

/** A successful paid status refresh. */
export interface PaidStatusRefresh {
  /** Reservation identity. */
  requestId: Hex
  /** Journaled sequence number the proof used. */
  seq: number
  /** Effective status deadline (quorum-th largest), Unix seconds; keepers accept until `+ 5 s`. */
  statusUntil: number
  /** The journaled grant with its merged attestations (signatures and token hash unchanged). */
  compound_token: CompoundTokenWire
  /** Verifier indexes whose new attestation was accepted. */
  refreshed: number[]
  /** Original signers that contributed nothing, and why. */
  failures: StatusRefreshFailure[]
}

/** One contributor's recovered extraction partial. */
export interface RecoveredIbePartial {
  /** Assigned contributor, with its approved (routed) URL. */
  keeper: PaidKeeperEndpoint
  /** Decoded partial, in the shape the IBE combine helpers accept. */
  partial: IbeExtractionPartial
  /** Signed execution evidence and exact retained bytes. */
  recovered: RecoveredKeeperExecution
}

/** Result of {@link PaidOperation.recoverIbePartials}. */
export interface RecoveredIbePartials {
  /** Keeper threshold from the payment's assignment. */
  threshold: number
  /** At least `threshold` recovered partials, from distinct contributors. */
  partials: RecoveredIbePartial[]
  /** Contributors whose retained result could not be read (operator and a safe message). */
  failures: {operator: Address; message: string}[]
}

/** Where a paid operation stopped with an uncertain or unfinished outcome. */
export type PaidOperationPhase = 'reservation' | 'session' | 'execution'

/**
 * Stable reason a paid operation stopped. `resumable` on the error says whether
 * {@link resumePaidOperation} can still make progress.
 * - `reservation-refused`: nothing was prepared or sent (e.g. accountant refusal, underfunded
 *   slot, RPC failure before preparation). Resumable unless the payment expired.
 * - `reservation-uncertain`: a reservation may have been sent; resume reconciles it, never resends.
 * - `reservation-failed`: the original reservation provably never happened. Final.
 * - `session-interrupted`: transport loss, timeout or an unavailable agent; resume continues.
 * - `session-refused`: the committee, a verifier, the wallet or the agent refused (a failed
 *   session, HTTP 4xx such as 403/410). Final.
 * - `session-write-uncertain`: a journaled session write has an unknown outcome; resume refuses
 *   it until reconciled out of band. Not resumable.
 * - `payment-expired`: the creator-signed payment expired; nothing more can run under it. Final.
 * - `execution-uncertain`: the keeper may have run; use the handle's `recover`, never execute again.
 * - `aborted`: the caller's signal stopped a journaled operation before anything uncertain was
 *   sent in this step; resumable unless the payment expired. When the abort left a step uncertain
 *   (a reservation or session write may have been sent, or an execution), that step's uncertain
 *   code is reported instead. An abort before the journal is written rethrows the signal's reason:
 *   nothing was journaled or sent.
 */
export type PaidOperationErrorCode = 'reservation-refused' | 'reservation-uncertain' | 'reservation-failed'
  | 'session-interrupted' | 'session-refused' | 'session-write-uncertain' | 'payment-expired' | 'execution-uncertain' | 'aborted'

/** The operation stopped where repeating a step could pay or execute twice; resume or recover it. */
export class PaidOperationRecoveryError extends TasraError {
  /** Stable machine-readable reason. */
  readonly code: PaidOperationErrorCode
  /** Whether {@link resumePaidOperation} can still make progress; false for a final refusal or a step only `recover` can read. */
  readonly resumable: boolean
  constructor(
    /** Reservation identity to resume with. */ readonly requestId: Hex,
    /** Step whose outcome is uncertain. */ readonly phase: PaidOperationPhase,
    cause: unknown,
    /** Classification; defaults to the uncertain outcome of the phase. */
    detail: {code?: PaidOperationErrorCode; resumable?: boolean} = {},
  ) {
    super(`Paid operation ${requestId.slice(0, 12)}… stopped during ${phase}; resume it from its journal, never start it again`, {retryable: false, cause})
    this.code = detail.code ?? (phase === 'reservation' ? 'reservation-uncertain' : phase === 'session' ? 'session-interrupted' : 'execution-uncertain')
    this.resumable = detail.resumable ?? !['reservation-failed', 'session-refused', 'session-write-uncertain', 'payment-expired', 'execution-uncertain'].includes(this.code)
  }
}

const expired = (payment: PaymentIntentWire) => payment.expires <= Math.floor(Date.now() / 1000)
/** Final 4xx refusals; 408/409/425/429 are transient or need a status read first. */
const refusal = (status: number) => status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status)
function sessionFailure(requestId: Hex, payment: PaymentIntentWire, error: unknown): PaidOperationRecoveryError {
  let code: PaidOperationErrorCode = 'session-interrupted'
  if (error instanceof PaidSessionRecoveryError || error instanceof PaidApprovalUnresolvedError) code = 'session-write-uncertain'
  else if (error instanceof VerifierAgentSessionError) {
    if (error.kind === 'refused' || (error.httpStatus !== undefined && refusal(error.httpStatus))) code = 'session-refused'
  } else if (error instanceof PaidAgentControlError && refusal(error.httpStatus)) code = 'session-refused'
  if (code !== 'session-refused' && code !== 'session-write-uncertain' && expired(payment)) code = 'payment-expired'
  return new PaidOperationRecoveryError(requestId, 'session', error, {code})
}
/** The preflight refusal, tagged with the paid operation it stopped before execution. */
function statusRefusal(requestId: Hex, error: RevocationStatusPreflightError): RevocationStatusPreflightError {
  return new RevocationStatusPreflightError({code: error.code, message: error.message, requestId, cause: error})
}
/** The keeper's revocation-status rule over a journaled grant, against its anchored witnesses. */
function statusPreflight(config: PaidOperationConfig, record: OperationRecord, wire: CompoundTokenWire): void {
  const token = decodeCompoundToken(wire)
  const set = {registrySize: record.payment.verification_registry_size,
    pubkeys: new Map<number, Uint8Array>(record.members.map(m => [m.index, hexToBytes(m.publicKey)]))}
  requireStatusAttestations({tokenHash: compoundTokenHash(token), attestations: token.statusAttestations, counted: signersThatVerify(token, set),
    set, quorum: record.payment.verification_quorum, now: Math.floor(Date.now() / 1000), allowMissing: config.allowMissingStatusAttestations === true})
}
/** A caller abort in a journaled step that sent nothing uncertain. */
function abortedError(requestId: Hex, phase: PaidOperationPhase, payment: PaymentIntentWire, signal: AbortSignal, error: unknown): PaidOperationRecoveryError {
  return new PaidOperationRecoveryError(requestId, phase, signal.reason ?? error, {code: 'aborted', resumable: !expired(payment)})
}

/**
 * Journaled progress of one paid operation. `failed` is terminal: the original reservation
 * provably never happened and the operation must not be reserved again. `abandoned` is terminal
 * too: the application closed it with {@link abandonPaidOperation} once nothing could still land.
 */
export type PaidOperationJournalPhase = 'reserving' | 'reserved' | 'certified' | 'authorized' | 'executing' | 'executed' | 'failed' | 'abandoned'
type Phase = PaidOperationJournalPhase
interface OperationRecord {
  schema: 1
  phase: Phase
  failure?: {reason: string}
  /** Set with phase `abandoned`: why, when (Unix seconds) and the phase it was abandoned from. */
  abandoned?: {reason: string; at: number; phase: Exclude<Phase, 'abandoned'>}
  /** Gas payer the reservation uses (absent from journals written before payers were recorded). */
  payer?: Address
  /** ADR-0090: the allowance lane this payment is debited on (absent for a per-operation reservation). */
  allowance?: {lane: number}
  /** A final dual-control Sign payment ({@link paidFinalSign}): no presentation, session or grant follows. */
  finalSign?: true
  /** An ADR-0090 D7 session-grant decrypt payment ({@link paidSessionDecrypt}): the grant, not a presentation, authorizes it. */
  sessionDecrypt?: true
  payment: PaymentIntentWire
  expected: ExpectedPaidOperation
  params: {operation: PresentationOperation; operationSig: Hex; messageHex: string; random: Hex; decryption?: DecryptionBindingWire
    /** ADR-0090 D7 session mode: the public create fragment, signed into the session initialization. */
    sessionGrant?: SessionGrantRequestWire}
  members: PaidVerifierWitness[]
  rule: string
  ruleSalt: Hex
  coordinator: PaidKeeperEndpoint
  /** Assigned contributors (absent from journals written before IBE recovery existed). */
  contributors?: PaidKeeperEndpoint[]
  action: CommitteeAction
  payloadDigest: Hex
  seed?: Uint8Array
  certificate?: ExecutionCertificate
  pollSecret?: string
  /** `sessionId` is absent from journals written before status refresh existed (relay unavailable for them). */
  grant?: {compound_token: CompoundTokenWire; verifierProofs: VerifierProof[]; sessionId?: string; evidenceCt?: string
    /** ADR-0090 D7: the verified opening grant or why none came (session mode only). */
    sessionGrant?: {grant?: {session_grant: SessionGrantWire; refresh_seq: 0}; error?: string}}
  /** Status refresh history (absent until the first refresh). */
  statusRefresh?: StatusRefreshJournal
}

/** Outcome of one journaled refresh attempt. */
type StatusRefreshOutcome = 'refreshed' | 'journal-changed' | 'aborted' | StatusRefreshCode
/** One journaled refresh attempt; written (without outcome) before its proof is signed or sent. */
interface StatusRefreshAttempt {
  seq: number
  issuedAt: number
  via: 'agent' | 'direct'
  principal: StatusRefreshPrincipal
  /** Journal phase the refresh was allowed in. */
  phase: 'authorized' | 'executing'
  outcome?: StatusRefreshOutcome
  statusUntil?: number
}
/**
 * A refresh answered `status_refresh_refused`: a verifier attests the holder's credential status is
 * refused NOW. While journaled, `execute` refuses the grant (whatever its attestations say); only a
 * later successful refresh clears it.
 */
interface StatusRefreshRefusal {
  seq: number
  /** Unix seconds the refusal was journaled. */
  at: number
  /** Per-verifier reasons as answered. */
  reasons: StatusRefreshFailure[]
}
/** Durable refresh state: the highest `seq` ever allocated is never reused. */
interface StatusRefreshJournal {
  seq: number
  /** The grant's attestations as issued, before the first refresh replaced them (null: none). */
  original: StatusAttestationWire[] | null
  attempts: StatusRefreshAttempt[]
  /** The last refresh's revocation refusal, until a later refresh succeeds. */
  refused?: StatusRefreshRefusal
}
/** Bound on journaled attempts per operation (verifiers cap successful refreshes at 16 per token). */
const MAX_STATUS_REFRESH_ATTEMPTS = 64
/** Deadline of one relayed refresh (the agent fans out to the committee). */
const RELAY_REFRESH_TIMEOUT_MS = 30_000

// The operation index, oldest first. `paid-op-index` is the original single list: still read, never
// dropped, and rewritten only by the one-time backfill (and by older SDKs, whose entries are read
// too). New operations append to bounded segments `paid-op-index-0`, `-1`, … instead, so indexing
// one operation rewrites at most SEGMENT_IDS entries rather than the whole history. Readers take
// the legacy list, then the segments in order until the first absent one; an id is listed once.
const INDEX_KEY = 'paid-op-index'
/** Most ids in one index segment; a full segment is never rewritten again. */
const SEGMENT_IDS = 256
const segmentKey = (n: number) => `${INDEX_KEY}-${n}`
/** `backfilled` marks a store whose pre-index journals were indexed once. */
interface OperationIndex { schema: 1; ids: Hex[]; backfilled?: true }
interface OperationIndexSegment { schema: 1; ids: Hex[] }
const validIds = (ids: unknown) => Array.isArray(ids) && !ids.some(id => typeof id !== 'string' || !HEX32.test(id))
async function loadIndexRecord(store: ApplicationStore): Promise<OperationIndex> {
  const index = await store.load<OperationIndex>(INDEX_KEY)
  if (index === undefined) return {schema: 1, ids: []}
  if (!index || index.schema !== 1 || !validIds(index.ids)
    || (index.backfilled !== undefined && index.backfilled !== true)) throw new TasraError('Invalid paid operation index')
  return index
}
async function loadSegment(store: ApplicationStore, n: number): Promise<OperationIndexSegment | undefined> {
  const segment = await store.load<OperationIndexSegment>(segmentKey(n))
  if (segment === undefined) return undefined
  if (!segment || segment.schema !== 1 || !validIds(segment.ids) || segment.ids.length > SEGMENT_IDS) throw new TasraError('Invalid paid operation index')
  return segment
}
/**
 * In-process state per store IDENTITY ({@link storeIdentity}): one entry per backing state, shared by
 * every store object on it (an application may open one file store object per call on one
 * directory), else per store object. Bounded by the directories a process uses.
 */
function perStore<V>() {
  const named = new Map<string, V>(), objects = new WeakMap<ApplicationStore, V>()
  return {
    get: (store: ApplicationStore): V | undefined => { const id = storeIdentity(store); return typeof id === 'string' ? named.get(id) : objects.get(id) },
    set: (store: ApplicationStore, value: V): void => { const id = storeIdentity(store); if (typeof id === 'string') named.set(id, value); else objects.set(id, value) },
  }
}
/** First segment that may still have room, per store identity: a hint only, always probed forward. */
const segmentHints = perStore<number>()
/** Every indexed id, oldest first, without duplicates: the legacy list, then each segment. */
async function loadIndex(store: ApplicationStore): Promise<Hex[]> {
  const ids = new Set((await loadIndexRecord(store)).ids.map(id => id.toLowerCase() as Hex))
  for (let n = 0; ; n++) {
    const segment = await loadSegment(store, n)
    if (!segment) break
    for (const id of segment.ids) ids.add(id.toLowerCase() as Hex)
  }
  return [...ids]
}
/**
 * Stage the index entries of `ids` (lowercase, in order) into the segments: the first segment with
 * room from this store's hint, then the next ones. Segments fill in order; a crash between
 * filling one and starting the next leaves nothing to repair, because the next writer probes
 * forward from the hint to the first one with room. Needs the index lock. Returns the last segment
 * staged: the caller moves the hint there only once the commit landed, so a failed commit never
 * leaves the hint past a segment that was never written (a gap would hide every later segment).
 */
async function stageIndexEntries(store: ApplicationStore, commit: LockedCommit, ids: readonly Hex[]): Promise<number | undefined> {
  const left = [...new Set(ids)]
  let last: number | undefined
  for (let n = segmentHints.get(store) ?? 0; left.length > 0; n++) {
    const segment = await loadSegment(store, n)
    for (const id of segment?.ids ?? []) { const at = left.indexOf(id); if (at !== -1) left.splice(at, 1) }
    if (left.length === 0) return last
    if (!segment || segment.ids.length < SEGMENT_IDS) {
      const added = left.splice(0, SEGMENT_IDS - (segment?.ids.length ?? 0))
      commit.stage(segmentKey(n), {schema: 1, ids: [...segment?.ids ?? [], ...added]} satisfies OperationIndexSegment)
      last = n
    }
  }
  return last
}
interface NewOperation { key: string; id: Hex; record: OperationRecord; resolve(): void; reject(error: unknown): void }
/**
 * Per store identity (not per store object: one store object per call on one directory would
 * otherwise commit every new operation on its own, one after another, on the global index lock):
 * the journal commit running now, and the new operations waiting for the next one.
 */
const newOperationQueues = perStore<{running: Promise<void>; waiting?: NewOperation[]}>()
/**
 * Journal a new operation's record and index it, refusing a request that is already journaled.
 * Concurrent new operations of one process share ONE commit instead of queueing on the global index
 * lock one by one: every record lock and the index lock are taken together, and the records and the
 * index segment are published with one data barrier and one directory sync. A caller joins the next
 * commit that has not started, so its record is never written before its call.
 *
 * A crash before this resolves may leave any subset. A record without its index entry was always
 * possible (a crash between the two former writes): it is found by its request ID, which
 * `onRequestId` already handed out. An index entry without its record is listed by no one
 * (listPaidOperations skips it). Nothing was sent for either: the reservation starts only after.
 */
function journalNewOperation(store: ApplicationStore, requestId: Hex, record: OperationRecord): Promise<void> {
  let queue = newOperationQueues.get(store)
  if (!queue) { queue = {running: Promise.resolve()}; newOperationQueues.set(store, queue) }
  let batch = queue.waiting
  if (!batch) {
    const own: NewOperation[] = [], q = queue
    batch = q.waiting = own
    q.running = q.running.then(() => { if (q.waiting === own) q.waiting = undefined; return commitNewOperations(store, own) })
  }
  const joined = batch
  return new Promise<void>((resolve, reject) => { joined.push({key: recordKey(requestId), id: requestId.toLowerCase() as Hex, record, resolve, reject}) })
}
/** One journal commit for a batch of new operations; settles every caller, never rejects. */
async function commitNewOperations(store: ApplicationStore, batch: readonly NewOperation[]): Promise<void> {
  const refused = new Map<NewOperation, unknown>()
  try {
    let staged: number | undefined
    await withCommit(store, [INDEX_KEY, ...batch.map(op => op.key)], async commit => {
      const created: Hex[] = [], seen = new Set<string>()
      for (const op of batch) {
        try {
          if (seen.has(op.key) || await store.load(op.key) !== undefined) throw new TasraError('Paid operation already journaled; resume it')
        } catch (error) { refused.set(op, error); continue }
        seen.add(op.key)
        commit.stage(op.key, op.record)
        created.push(op.id)
      }
      staged = await stageIndexEntries(store, commit, created)
    })
    if (staged !== undefined) segmentHints.set(store, staged)
  } catch (error) {
    for (const op of batch) op.reject(refused.get(op) ?? error)
    return
  }
  for (const op of batch) { const error = refused.get(op); if (error === undefined) op.resolve(); else op.reject(error) }
}
/** Index journals written before the index existed, once per store (by payment expiry). */
async function backfillIndex(store: ApplicationStore): Promise<void> {
  if ((await loadIndexRecord(store)).backfilled) return
  if (typeof store.list !== 'function') throw new TasraError('Backfilling the paid operation index needs a store that can list its keys')
  const list = store.list.bind(store)
  await store.withLock(INDEX_KEY, async () => {
    const index = await loadIndexRecord(store)
    if (index.backfilled) return
    const indexed = new Set(await loadIndex(store))
    const found: {id: Hex; expires: number}[] = []
    for (const key of await list(RECORD_PREFIX)) {
      if (!RECORD_KEY.test(key)) continue
      const id = `0x${key.slice(RECORD_PREFIX.length)}` as Hex
      if (indexed.has(id)) continue
      const record = await loadRecord(store, id)
      if (record) found.push({id, expires: record.payment.expires})
    }
    found.sort((a, b) => a.expires - b.expires)
    // Unindexed journals predate the index, so they come first.
    await store.save(INDEX_KEY, {schema: 1, ids: [...found.map(f => f.id), ...index.ids], backfilled: true} satisfies OperationIndex)
  })
}
function random32(): Uint8Array { return globalThis.crypto.getRandomValues(new Uint8Array(32)) }
function positive(value: bigint, name: string): void { if (typeof value !== 'bigint' || value <= 0n) throw new TasraError(`Paid operation requires a finite positive ${name}`) }
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const done = () => { signal.removeEventListener('abort', abort); resolve() }
    const timer = setTimeout(done, ms)
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    signal.addEventListener('abort', abort, {once: true})
  })
}

function validateConfig(config: PaidOperationConfig): void {
  const d = config.deployment
  for (const address of [d.settlement, d.keyRegistry, d.verifierSet, d.accountantSet, d.beacon]) {
    if (typeof address !== 'string' || !/^0x[0-9a-f]{40}$/i.test(address) || /^0x0{40}$/i.test(address)) throw new TasraError('Paid operation requires independently approved Settlement, registries and beacon')
  }
  positive(config.limits.maxCost, 'TASRA limit'); positive(config.limits.maxGas, 'gas limit'); positive(config.limits.maxGasPrice, 'gas price limit')
  if (!config.accountantUrls.length || config.accountantUrls.length > 16 || new Set(config.accountantUrls).size !== config.accountantUrls.length) throw new TasraError('Paid operation requires distinct approved accountant URLs')
  if (config.gasPayer.chain.id !== d.chainId) throw new TasraError('Gas payer is bound to another chain')
  if (config.chain.addresses.ServiceRegistry?.toLowerCase() !== config.agent.profile.approval.registry.toLowerCase()) throw new TasraError('Agent profile is approved on another ServiceRegistry')
  const wait = config.snapshotWaitMs ?? 180_000, poll = config.pollIntervalMs ?? 1_000
  if (!Number.isSafeInteger(wait) || wait < 1 || wait > 300_000 || !Number.isSafeInteger(poll) || poll < 10 || poll > 60_000) throw new TasraError('Invalid paid operation timing')
  if (config.allowances?.enabled) validateAllowanceOptions(config.allowances, config.limits)
}

function allowanceEnv(config: PaidOperationConfig): AllowanceEnv | undefined {
  if (!config.allowances?.enabled) return undefined
  const d = {...config.deployment}
  return {client: config.chain.client, deployment: config.deployment, creator: config.creator, gasPayer: config.gasPayer, store: config.store,
    accountantUrls: config.accountantUrls, allowLocalHttp: config.allowLocalHttp, limits: config.limits, options: config.allowances,
    // ADR-0090 D7 reserve-ahead: the next draw, verified exactly as a session message's pinned discovery.
    discover: (slot, epoch) => discoverPaidOperationContext(config.chain.client, d, slot, {allowLocalHttp: config.allowLocalHttp,
      defaultVerificationPolicy: d.defaultVerificationPolicy, fundedByAllowance: true, verificationEpoch: epoch})}
}

/** Which lanes of a slot {@link prepareAllowances} opens, and how. */
export interface PrepareAllowancesRequest {
  /** Slot whose allowance lanes to open. */
  slot: Hex
  /** Regular lane indices to open, each 0..lanes-1 and distinct (default every lane, see `allowanceLaneCount`). */
  lanes?: readonly number[]
  /**
   * Lanes opened at once, 1..8 (default 4). Every reservation goes through the one dedicated gas
   * payer queue, and each pins its own fresh discovery as its quote block, which the accountants
   * accept for only 30 s: a lane that waits behind too many others in the queue is refused.
   */
  concurrency?: number
  /** Coordinator to discover with (as {@link PaidOperationRequest.coordinator}). */
  coordinator?: Address
  /**
   * Each lane must fund at least this many more operations at the per-operation cap
   * (`limits.maxCost`) from its current allowance and its reserved-ahead one together (only an
   * allowance outliving `minLifetimeSecs` counts); otherwise the next allowance is reserved ahead
   * now. 0..2 x floor(amount / maxCost); default 0 (today's rule: a confirmed, not-low current
   * allowance is enough). Set it, with `minLifetimeSecs`, when preparing for sustained work: a
   * lane that is confirmed but close to exhaustion or expiry otherwise reports `not-needed` and the
   * work reserves its replacement inside an operation.
   */
  minOperations?: number
  /**
   * The current allowance must outlive this many seconds, else the next one is reserved ahead (and
   * must outlive it). 0..lifetime - 120 s; default 0. A bound on how long the coming work runs.
   */
  minLifetimeSecs?: number
  /**
   * The paid actions the coming work runs (as `PaidOperationRequest.operation.action`: `sign` is
   * paid as `eoa-sign` on a threshold-ECDSA slot, exactly as {@link paidOperation} pays it). Given,
   * a lane is ready only when its current or confirmed reserved-ahead allowance passes the very
   * check lane selection applies to each of these operations, started at any moment of
   * `minLifetimeSecs`: the action funded, the keeper sharing (key epoch, committee version,
   * threshold, contributors) of a FRESH discovery made for this judgement, and an expiry beyond the
   * operation's own payment lifetime (`operationTtlSecs`) plus the clock margin. A lane that fails it
   * gets a fitting next allowance reserved ahead; a current one that cannot fund the next operation
   * at all gives way to it, and a reserved-ahead one that never can (a stale sharing) is replaced.
   * Without it readiness looks at balance and expiry alone, so a lane can report `not-needed` and
   * still be refused by every operation (one discovery more per call when given).
   */
  actions?: readonly AllowanceAction[]
  /** The coming operations' payment lifetime, 1..3600 s (default 600, {@link paidOperation}'s default); only with `actions`. */
  operationTtlSecs?: number
  /** Cancellation: lanes not yet started are reported `cancelled`; a started one is cancelled until its reservation is prepared. */
  signal?: AbortSignal
}

/**
 * What {@link prepareAllowances} did for one lane:
 * - `reserved`: an allowance was reserved (confirmed) on the lane now: the lane's current one, or its next reserved ahead for `minOperations` / `minLifetimeSecs`;
 * - `not-needed`: the lane already had a usable confirmed allowance (or one reserved ahead); nothing was discovered, signed or sent;
 * - `pending`: a reservation of the lane is uncertain (broadcast, outcome unknown); a later call or operation reconciles it, never re-signs beside it;
 * - `failed`: the reservation failed (`error`), or (`AllowanceCapacityError`) the lane holds its current and a reserved-ahead allowance and still cannot fund `minOperations` (never a third: at most 2 x lanes x amount locked); nothing of it is left on the lane unless it was broadcast (then `pending` next time);
 * - `cancelled`: the signal ended it before its reservation was prepared, or before it started.
 */
export type PreparedAllowanceOutcome = 'reserved' | 'pending' | 'not-needed' | 'failed' | 'cancelled'

/** One lane's result of {@link prepareAllowances}. */
export interface PreparedAllowanceLane {
  /** Lane index. */
  lane: number
  /** What happened on the lane. */
  outcome: PreparedAllowanceOutcome
  /** The failure, for `failed` (and the abort reason for a `cancelled` lane that had started). */
  error?: unknown
}

/** The result of {@link prepareAllowances}, one entry per requested lane, in request order. */
export interface PreparedAllowances {
  /** Slot. */
  slot: Hex
  /** Per-lane outcomes. */
  lanes: PreparedAllowanceLane[]
}

/**
 * ADR-0090: open (reserve) a slot's allowance lanes BEFORE its first paid operation, like loading
 * a card, so no user operation waits for an allowance reservation (approve + reserve transactions
 * and their receipts) inside it. Operations otherwise open a cold lane themselves: the first one on
 * each lane then falls back to a per-operation reservation or waits for the lane.
 *
 * Each lane is reserved through the same journaled reservation as an operation's background refill
 * (intent signed by the creator, `signing` → `prepared` → `submitted` → `confirmed` under the
 * durable payer claim and the dedicated payer queue), with its own FRESH discovery (never a context
 * cached across lanes); a lane that needs nothing is reported `not-needed` without any read or
 * send, so the call is idempotent. A lane failure is reported on that lane only; the other lanes
 * are unaffected. Never throws for a lane's outcome; throws only for invalid input or
 * configuration, and when the signal was aborted before anything started.
 *
 * Draw lanes (session grants, ADR-0090 D7) are not opened here: their draw is known only once a
 * grant exists.
 * @param config Approved deployment, creator, gas payer, store, accountants, limits and `allowances` (enabled).
 * @param request Slot, lanes, concurrency, readiness for the coming work and cancellation.
 */
export async function prepareAllowances(config: PaidOperationConfig, request: PrepareAllowancesRequest): Promise<PreparedAllowances> {
  validateConfig(config)
  const env = allowanceEnv(config)
  if (!env) throw new TasraError('Opening allowances needs the allowances option enabled')
  const slot = request.slot, signal = request.signal ?? new AbortController().signal
  if (!HEX32.test(slot)) throw new TasraError('Invalid paid operation slot')
  const count = allowanceLaneCount(config.allowances!)
  const lanes = request.lanes ? [...request.lanes] : Array.from({length: count}, (_, i) => i)
  if (lanes.length === 0 || lanes.some(l => !Number.isSafeInteger(l) || l < 0 || l >= count) || new Set(lanes).size !== lanes.length) throw new TasraError(`Allowance lanes must be distinct indices 0..${count - 1}`)
  const concurrency = request.concurrency ?? 4
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new TasraError('Allowance concurrency must be 1..8')
  const ready: LaneReadiness = {minOperations: request.minOperations, minLifetimeSecs: request.minLifetimeSecs}
  validateLaneReadiness(env, ready)
  if (request.operationTtlSecs !== undefined && request.actions === undefined) throw new TasraError('Allowance operationTtlSecs needs actions')
  const actions = request.actions, ttlSecs = request.operationTtlSecs ?? 600
  if (actions !== undefined) {
    if (actions.length === 0 || new Set(actions).size !== actions.length) throw new TasraError('Allowance readiness actions must be distinct and non-empty')
    allowanceActionBits(actions)
    // Before any read; what the configured allowances fund is judged once the slot's mode is known.
    validateReadinessHorizon(env, request.minLifetimeSecs ?? 0, ttlSecs)
  }
  signal.throwIfAborted()
  if (config.billing) await config.billing.requirePrepaid(slot)
  const d = {...config.deployment}, client = config.chain.client
  // One fresh, canonical discovery per reservation, exactly as an allowance-funded operation discovers.
  const discover = async () => {
    const readiness = AbortSignal.any([signal, AbortSignal.timeout(config.snapshotWaitMs ?? 180_000)])
    const context = await waitForPaidSnapshot(() => discoverPaidOperationContext(client, d, slot,
      {allowLocalHttp: config.allowLocalHttp, defaultVerificationPolicy: d.defaultVerificationPolicy, coordinator: request.coordinator, fundedByAllowance: true}),
    readiness, () => sleep(1_000, readiness))
    if (context.creator.toLowerCase() !== config.creator.address.toLowerCase()) throw new TasraError('Paid operations are signed by the slot creator; this signer is not it')
    return context
  }
  const results: PreparedAllowanceLane[] = lanes.map(lane => ({lane, outcome: 'cancelled'}))
  if (actions !== undefined) {
    // One fresh discovery judges every lane against what an operation would be paid under now.
    let context: PaidOperationContext
    try { context = await discover() } catch (error) {
      return {slot, lanes: lanes.map(lane => signal.aborted ? {lane, outcome: 'cancelled', error} : {lane, outcome: 'failed', error})}
    }
    // Threshold ECDSA slots (mode 2 secp256k1, mode 4 P-256) pay `sign` as `eoa-sign` (as paymentAttempt does).
    const paid = [...new Set(actions.map((a): AllowanceAction => a === 'sign' && (context.mode === 2 || context.mode === 4) ? 'eoa-sign' as const : a))]
    ready.work = {context, actions: paid, ttlSecs}
    validateLaneReadiness(env, ready)
  }
  let next = 0
  const worker = async () => {
    while (next < lanes.length && !signal.aborted) {
      const i = next++, lane = lanes[i]!
      try { results[i] = {lane, outcome: await prepareAllowanceLane(env, slot, lane, discover, signal, ready)} }
      catch (error) { results[i] = signal.aborted ? {lane, outcome: 'cancelled', error} : {lane, outcome: 'failed', error} }
    }
  }
  await Promise.all(Array.from({length: Math.min(concurrency, lanes.length)}, worker))
  return {slot, lanes: results}
}

/** The allowance path refused this operation for good; it was journaled `failed` and is retried once per operation. */
class AllowanceFallback extends Error {
  constructor(readonly requestId: Hex, cause: unknown) { super('allowance debit refused; falling back to a per-operation reservation', {cause}) }
}

/** Decode a commitment-verified retained IBE result into a combinable partial. */
async function ibePartial(resultJson: string, nodeUrl: string, record: OperationRecord, options: RecoverIbePartialsOptions, chainId: number): Promise<IbeExtractionPartial> {
  const d = JSON.parse(resultJson) as {identifier: number; sealed_share: SealedShareWire; verifying_share: string; epoch: number; key_slot_id: string}
  const binding = record.params.decryption, trusted = options.verifyingShares?.get(d.identifier)
  if (!binding || !options.recipient || options.identity === undefined || !trusted || trusted.length !== 144 || d.epoch !== binding.ciphertext_epoch || d.key_slot_id.replace(/^0x/, '').toLowerCase() !== record.payment.slot.replace(/^0x/, '').toLowerCase()) throw new Error('Original recipient, identity, epoch and authenticated sharing required for sealed IBE recovery')
  const verifying = base64Decode(d.verifying_share)
  if (verifying.length !== 144 || !trusted.every((b, i) => b === verifying[i])) throw new Error('Recovered verifying share differs from authenticated package')
  const content = sha256(new TextEncoder().encode(options.identity))
  const digest = recipientPayloadDigest(content, binding.ciphertext_epoch, options.recipient.recipient)
  if (toHex(digest).toLowerCase() !== record.payloadDigest.toLowerCase()) throw new Error('Recovery recipient or identity differs from original authorization')
  const hash = requestHash(chainId, hexToBytes(record.payment.slot), 'ibe-extract', digest)
  const value = await options.recipient.open(d.sealed_share, hash, d.identifier, d.epoch, trusted)
  try {
    ibeVerifyShare(new Map([[d.identifier, trusted.slice(0, 96)]]), new TextEncoder().encode(options.identity), {identifier: d.identifier, value})
    return {keySlotId: d.key_slot_id, identifier: d.identifier, value, verifyingShareG2: trusted.slice(0, 96), epoch: d.epoch, nodeUrl}
  } catch (error) { value.fill(0); throw error }
}

/**
 * Authorize one paid committee operation. Returns a handle whose `execute` runs the keeper
 * operation once. Throws PaidOperationRecoveryError when a reservation, session write or the
 * execution outcome is uncertain; continue with {@link resumePaidOperation}, never by calling
 * this again (that would be a second payment).
 * @param config Approved deployment, creator, gas payer, store, agent, accountants and limits.
 * @param request Slot, operation, original rule, holder strategy and cancellation.
 */
export async function paidOperation(config: PaidOperationConfig, request: PaidOperationRequest): Promise<PaidOperation> {
  validateConfig(config)
  if (!config.allowances?.enabled) return paymentAttempt(config, request, false)
  // ADR-0090: at most one allowance attempt; a definite refusal (journaled `failed`, no voucher)
  // falls back to a fresh per-operation payment with its own request ID.
  try { return await paymentAttempt(config, request, true) }
  catch (error) {
    if (!(error instanceof AllowanceFallback)) throw error
    return paymentAttempt(config, request, false)
  }
}

/**
 * One per-operation payment. A refused reservation is never replaced by a re-signed intent here:
 * an intent that reached an accountant can still be reserved by anyone holding it (the accountant
 * accepts a client-pinned quote block up to MAX_QUOTE_AGE old, and `reservePrepaid*` is
 * permissionless) until its payment expires, so a second intent could be charged as well. The
 * journal stays `reserving`, reconcilable (`reconcilePaidOperation`, `resumePaidOperation`) and
 * not abandonable until that window has passed; a reservation that lands meanwhile is found by
 * reconciliation, and one left unused is refunded by the accountants' unused-reservation close.
 */
/**
 * A per-operation reservation that waited for its payer past its verifier epoch, refused BEFORE the
 * first prepare (see {@link reserve}): the signed intent never left this process, so it is
 * journaled `failed` and the operation is signed once more at a current epoch. A
 * {@link paidOperation} does that itself (once); a {@link paidSessionDecrypt} pays the GRANT's
 * draw, so it throws this and its caller pays again on a refreshed grant (`decryptInSession`).
 * `beaconEpoch` is this process's own chain read that refused it.
 */
export class NewerVerifierEpoch extends Error {
  readonly code = 'newer-verifier-epoch' as const
  constructor(readonly requestId: Hex, readonly beaconEpoch: bigint) {
    super('the verifier epoch moved on while this reservation waited for its payer; nothing was sent')
    this.name = 'NewerVerifierEpoch'
  }
}

async function paymentAttempt(config: PaidOperationConfig, request: PaidOperationRequest, useAllowance: boolean): Promise<PaidOperation> {
  try { return await paidOperationAttempt(config, request, useAllowance) }
  catch (error) {
    if (!(error instanceof NewerVerifierEpoch)) throw error
    // Once only: a second wait past two epochs is reported like any other refusal.
    try { return await paidOperationAttempt(config, request, useAllowance) }
    catch (again) {
      if (again instanceof NewerVerifierEpoch) throw new PaidOperationRecoveryError(again.requestId, 'reservation', again, {code: 'reservation-refused', resumable: false})
      throw again
    }
  }
}

async function paidOperationAttempt(config: PaidOperationConfig, request: PaidOperationRequest, useAllowance: boolean): Promise<PaidOperation> {
  const d = {...config.deployment}, client = config.chain.client, signal = request.signal ?? new AbortController().signal
  const slot = request.slot
  if (!HEX32.test(slot)) throw new TasraError('Invalid paid operation slot')
  // Without a cached detector, discovery itself refuses a non-prepaid slot (the Settlement version,
  // prepaidEnabled and prepaidFromGenesis, read in its own block-pinned round) with the same typed
  // BillingModeError, instead of a separate billing observation of ~4 sequential reads before it.
  if (config.billing) await config.billing.requirePrepaid(slot)
  const readiness = AbortSignal.any([signal, AbortSignal.timeout(config.snapshotWaitMs ?? 180_000)])
  // ADR-0090: an allowance-funded payment names its allowance's draw, so while a new epoch's anchors
  // land (no admissible complete draw at this head) an operation a current allowance serves need not
  // wait for them: discovery returns an UNDRAWN context, and only when no lane serves the operation
  // is the slot discovered again with the bounded anchor wait. Session openings (a pinned draw) wait.
  const undrawnOk = useAllowance && request.sessionGrant === undefined
  const discover = (undrawnDuringAnchorGap: boolean) => waitForPaidSnapshot(() => discoverPaidOperationContext(client, d, slot,
    {allowLocalHttp: config.allowLocalHttp, defaultVerificationPolicy: d.defaultVerificationPolicy, coordinator: request.coordinator, fundedByAllowance: useAllowance,
      ...undrawnDuringAnchorGap ? {undrawnDuringAnchorGap} : {}}),
  readiness, () => sleep(1_000, readiness))
  // The rule the holder will see must be the one the slot committed to on chain. Discovery read the
  // slot at its canonical, rechecked block hash; a context without that field is read again here.
  const expectedCommitment = ruleCommitment(request.rule.salt, request.rule.rule).toLowerCase()
  const checked = async (context: PaidOperationContext): Promise<PaidOperationContext> => {
    if (context.creator.toLowerCase() !== config.creator.address.toLowerCase()) throw new TasraError('Paid operations are signed by the slot creator; this signer is not it')
    if (context.ruleCommitment !== undefined) {
      if (context.ruleCommitment.toLowerCase() !== expectedCommitment) throw new TasraError('Supplied rule or salt differs from the slot commitment')
    } else {
      const original = await client.readContract({address: d.keyRegistry, abi: keyRegistryAbi, functionName: 'getKeySlot', args: [slot], blockNumber: context.blockNumber})
      if (original.ruleCommitment.toLowerCase() !== expectedCommitment) throw new TasraError('Supplied rule or salt differs from the slot commitment')
      if ((await client.getBlock({blockNumber: context.blockNumber})).hash !== context.blockHash) throw new TasraError('Rule observation reorganized')
    }
    return context
  }
  let context = await checked(await discover(undrawnOk))
  // Validate the DCQL JSON, but retain the provisioned bytes. The chain's salted
  // commitment canonicalizes JSON; verifier tokens bind keccak256(raw rule).
  // Rewriting whitespace/key order here changes the expected token hash.
  canonicalize(request.rule.rule)
  // A session grant opens only from a KEM decrypt presentation (checked again, with the slots, before signing).
  if (request.sessionGrant && request.operation.action !== 'decrypt') throw new TasraError('A session grant opens only from a KEM decrypt presentation')
  const ttlSecs = request.operation.ttlSecs ?? 600
  if (!Number.isSafeInteger(ttlSecs) || ttlSecs <= 0 || ttlSecs > 3600) throw new TasraError('Paid operation lifetime must be 1..3600 seconds')
  const built = presentationOperationTypedData({action: request.operation.action, message: request.operation.message, identity: request.operation.identity,
    payloadDigest: request.operation.payloadDigest, decryption: request.operation.decryption, chainId: d.chainId, keyRegistry: d.keyRegistry, slotId: slot,
    description: request.operation.description ?? 'Paid Tasra operation', nowSecs: Math.floor(Date.now() / 1000), ttlSecs})
  const randomBytes = random32(), random = toHex(randomBytes); randomBytes.fill(0)
  const operationSig = await config.creator.signTypedData(built.typedData)
  // Threshold ECDSA slots (mode 2 secp256k1, mode 4 P-256) sign through the keeper's eoa-digest route, paid as `eoa-sign`.
  const action = request.operation.action === 'sign' && (context.mode === 2 || context.mode === 4) ? 'eoa-sign' as const : request.operation.action
  // ADR-0090: a lane with room funds this operation by voucher; its verification and keeper
  // fields are the allowance's (the readers judge them at the allowance's assignment block).
  const env = useAllowance ? allowanceEnv(config) : undefined
  // ADR-0090 D7: a session grant is drawn on the OPENING payment's draw and judged at the LIVE
  // beacon by every verifier and keeper, while a voucher keeps its allowance's (older) draw, whose
  // epoch is judged at the allowance's quote block. So a session-mode opening is funded only by an
  // allowance drawn on this fresh discovery's draw, else by a per-operation reservation at it -
  // never by a voucher whose grant no verifier would sign (C7 fleet: `session_context_changed`).
  const lane = {action, expires: built.operation.exp, drawPinned: request.sessionGrant !== undefined}
  let ticket = env ? await selectAllowanceLane(env, context, lane) : undefined
  // Undrawn and no lane serves it now: discover the draw (waiting, bounded, for its anchors) and
  // select again, which may start or wait for a lane reservation or fall back per operation.
  if (!ticket && context.undrawn) {
    context = await checked(await discover(false))
    if (context.undrawn) throw new TasraError('Paid operation discovery returned no verifier draw')
    ticket = env ? await selectAllowanceLane(env, context, lane) : undefined
  }
  // A voucher payment names its allowance's draw; a per-operation one this context's, which an
  // undrawn context does not have (refused, never zero fields).
  const unsigned = {...ticket ? ticket.fields : drawnIntentFields(context), action,
    payload_digest: toHex(built.payloadDigest), session_commitment: paymentSessionCommitment(random, config.agent.profile.clientId, built.operation.exp),
    nonce: toHex(random32()), max_cost: config.limits.maxCost.toString(), expires: built.operation.exp, ...ticket ? {allowance_id: ticket.allowanceId} : {}}
  const payment: PaymentIntentWire = {...unsigned, signature: await config.creator.signTypedData(paymentIntentTypedData(unsigned))}
  const expected: ExpectedPaidOperation = {slot, action: payment.action, payloadDigest: payment.payload_digest}
  const requestId = prepaidRequestId(payment)
  // With a head follower, this request's own settlement state is pre-read at each new head.
  followPaidRequest(client, d, payment)
  await request.onRequestId?.(requestId)
  signal.throwIfAborted()
  const {witnesses} = await fetchDrawnVerifierWitnesses(config.accountantUrls, payment, d.verifierSet,
    {signal: AbortSignal.any([signal, AbortSignal.timeout(Math.min(150_000, ttlSecs * 1000))]), fetch: config.fetch,
      waitForPublicationMs: Math.min(config.snapshotWaitMs ?? 180_000, 150_000, ttlSecs * 1000)})
  const record: OperationRecord = {schema: 1, phase: 'reserving', payment, expected, members: witnesses, rule: request.rule.rule, ruleSalt: request.rule.salt,
    params: {operation: built.operation, operationSig, messageHex: built.messageHex, random, ...(request.operation.decryption ? {decryption: structuredClone(request.operation.decryption)} : {}),
      ...(request.sessionGrant ? {sessionGrant: structuredClone(request.sessionGrant.session_grant)} : {})}, coordinator: context.coordinator, contributors: context.contributors,
    action: request.operation.action, payloadDigest: toHex(built.payloadDigest), payer: config.gasPayer.account.address, ...ticket ? {allowance: {lane: ticket.lane}} : {}}
  await journalNewOperation(config.store, requestId, record)
  try { await reserve(config, record, signal) }
  catch (error) {
    if (ticket && error instanceof PaidOperationRecoveryError && error.code === 'reservation-failed' && error.cause instanceof AllowanceRefusedError) throw new AllowanceFallback(requestId, error)
    throw error
  }
  return continueOperation(config, requestId, request.holder, signal, request.observeRequest)
}

class NoLongerReserving extends Error {}

async function reserve(config: PaidOperationConfig, record: OperationRecord, signal: AbortSignal): Promise<void> {
  const d = {...config.deployment}, requestId = prepaidRequestId(record.payment), key = recordKey(requestId)
  if (signal.aborted) throw abortedError(requestId, 'reservation', record.payment, signal, signal.reason)
  if (record.payment.allowance_id !== undefined) return debit(config, record, signal)
  try {
    // Under the journal's lock, so abandonPaidOperation cannot close it while a reservation runs.
    await config.store.withLock(key, async () => {
      if ((await config.store.load<OperationRecord>(key))?.phase !== 'reserving') throw new NoLongerReserving()
      await withDedicatedPayer(`${d.chainId}-${config.gasPayer.account.address.toLowerCase()}`, async () => {
        // The intent was signed at discovery and may have queued behind this payer for longer than
        // the accountants' window ({latest-1, latest} at their own head). Until its first prepare it
        // exists only here - the witness fetch carries no payment - so an epoch already two behind
        // is certain to be refused and is safely signed again instead. Once a preparation is
        // journaled the intent may have been seen, and it is never replaced (it could still land).
        // A failed epoch read changes nothing: the accountants judge the epoch themselves.
        let current: bigint | undefined
        try { current = await readCurrentBeaconEpoch(config.chain.client, d) } catch { current = undefined }
        if (typeof current === 'bigint' && current >= BigInt(record.payment.verification_epoch) + 2n
          && await loadPaidReservationJournal(config.store, requestId) === undefined) throw new NewerVerifierEpoch(requestId, current)
        return reserveApplicationPayment(config.chain.client, config.gasPayer, d,
          record.payment, record.expected, {store: config.store, session: {random: record.params.random, audience: config.agent.profile.clientId},
            accountantUrls: config.accountantUrls, allowLocalHttp: config.allowLocalHttp, maxGas: config.limits.maxGas, maxGasPrice: config.limits.maxGasPrice, signal})
      })
    })
  } catch (error) {
    if (error instanceof NoLongerReserving) throw new TasraError('Paid operation was closed before its reservation; it is not reserved again')
    if (error instanceof NewerVerifierEpoch) {
      await advance(config.store, requestId, 'reserving', {phase: 'failed', failure: {reason: 'superseded before its first prepare: the verifier epoch moved on; never sent'}})
      throw error
    }
    const journal = await loadPaidReservationJournal(config.store, requestId).catch(() => 'unreadable' as const)
    // Another request holds the payer and this one journaled nothing: refuse without uncertainty.
    if (error instanceof ApplicationPayerRecoveryError && journal === undefined) throw error
    // No preparation was journaled, and none is ever broadcast without one: nothing was sent.
    if (journal === undefined) {
      if (signal.aborted) throw abortedError(requestId, 'reservation', record.payment, signal, error)
      throw new PaidOperationRecoveryError(requestId, 'reservation', error,
        expired(record.payment) ? {code: 'reservation-refused', resumable: false} : {code: 'reservation-refused'})
    }
    throw new PaidOperationRecoveryError(requestId, 'reservation', error, {code: 'reservation-uncertain'})
  }
  await advance(config.store, requestId, 'reserving', {phase: 'reserved'})
}

/**
 * ADR-0090: obtain this payment's debit voucher on its lane instead of a reservation, and journal
 * the payment WITH the voucher (`reserved`). A definite refusal journals `failed` (no voucher can
 * exist: fewer than k members signed and the lane is retired); unreachable accountants leave the
 * debit pending for the same seq and request (`reservation-refused`, resumable).
 */
async function debit(config: PaidOperationConfig, record: OperationRecord, signal: AbortSignal): Promise<void> {
  const requestId = prepaidRequestId(record.payment), key = recordKey(requestId), env = allowanceEnv(config)
  if (!env || !record.allowance) {
    const saved = await journaledAllowanceVoucher(config.store, requestId)
    if (!saved) throw new PaidOperationRecoveryError(requestId, 'reservation', new TasraError('Resuming an allowance-backed operation needs the allowances option'), {code: 'reservation-refused'})
  }
  try {
    // The voucher and the `reserved` phase that carries it are journaled under the ONE record
    // lock that admitted the debit (one durable lock instead of two; the same checks).
    // Checked under the journal's lock: only a `reserving` journal is debited.
    let current: OperationRecord | undefined
    const check = async () => {
      current = await config.store.load<OperationRecord>(key)
      if (current?.phase !== 'reserving') throw new NoLongerReserving()
      if (current.schema !== 1) throw new TasraError('Paid operation journal changed concurrently')
    }
    const reserved = (voucher: DebitVoucherWire): OperationRecord => ({...current!, phase: 'reserved', payment: {...record.payment, debit_voucher: voucher}})
    const saved = await journaledAllowanceVoucher(config.store, requestId)
    if (saved) await withCommit(config.store, key, async commit => { await check(); commit.stage(key, reserved(saved)) })
    else {
      // A fresh round runs under the journal's lock together with the lane's (one set of locks,
      // released in the lane's commit), and journals `reserved` WITH the voucher under its request
      // (one commit, before the lane advances past the seq): either one lets a resume continue
      // from the voucher, and the lane completes an interrupted advance from whichever a crash kept.
      let journaled = false
      const voucher = await obtainAllowanceVoucher(env!, record.allowance!, record.payment, signal,
        {lock: [key], check, journal: found => { journaled = true; return [[key, reserved(found)]] }})
      // A voucher another call journaled meanwhile: journal `reserved` with it now.
      if (!journaled) await withCommit(config.store, key, async commit => { await check(); commit.stage(key, reserved(voucher)) })
    }
  } catch (error) {
    if (error instanceof NoLongerReserving) throw new TasraError('Paid operation was closed before its debit; it is not debited again')
    if (error instanceof AllowanceRefusedError) {
      await advance(config.store, requestId, 'reserving', {phase: 'failed', failure: {reason: `allowance debit refused: ${error.message}`}})
      throw new PaidOperationRecoveryError(requestId, 'reservation', error, {code: 'reservation-failed'})
    }
    if (signal.aborted) throw abortedError(requestId, 'reservation', record.payment, signal, error)
    throw new PaidOperationRecoveryError(requestId, 'reservation', error, expired(record.payment) ? {code: 'reservation-refused', resumable: false} : {code: 'reservation-refused'})
  }
}

async function advance(store: ApplicationStore, requestId: Hex, from: Phase | Phase[], patch: Partial<OperationRecord>,
  guard?: (current: OperationRecord) => void): Promise<OperationRecord> {
  const key = recordKey(requestId)
  // A local transition: nothing is sent under this lock, so the new phase is published with the
  // unlock in one commit. A crash before it resolves leaves the previous phase (the transition did
  // not happen; its caller was not told and sent nothing after it) or the new one.
  return withCommit(store, key, async commit => {
    const current = await store.load<OperationRecord>(key)
    if (!current || current.schema !== 1 || !(Array.isArray(from) ? from : [from]).includes(current.phase)) throw new TasraError('Paid operation journal changed concurrently')
    guard?.(current)
    const next = {...current, ...patch}
    commit.stage(key, next)
    return next
  })
}

async function continueOperation(config: PaidOperationConfig, requestId: Hex, holder: PaidSessionHolder | undefined, signal: AbortSignal,
  observeRequest?: (request: VerifiedRequestObject) => void | Promise<void>): Promise<PaidOperation> {
  const d = {...config.deployment}, client = config.chain.client, store = config.store
  let record = await store.load<OperationRecord>(recordKey(requestId))
  if (!record || record.schema !== 1 || prepaidRequestId(record.payment).toLowerCase() !== requestId.toLowerCase()) throw new TasraError('No paid operation journal for this request')
  if (record.finalSign) throw new TasraError('A final Sign payment has no session; resume it with resumePaidFinalSign')
  if (record.sessionDecrypt) throw new TasraError('A session-grant decrypt payment has no presentation; resume it with resumePaidSessionDecrypt')
  if (signal.aborted && (record.phase === 'reserved' || record.phase === 'certified')) throw abortedError(requestId, 'session', record.payment, signal, signal.reason)
  // A fresh execution consent is journaled with the session's first write (its creation), not on
  // its own: the session's identity derives from it, and nothing bound to it is sent before that
  // commit. A crash before it leaves `reserved`, which a resume certifies anew (nothing was sent);
  // one that kept only the creation record leaves it under a session identity nobody derives again.
  let consent: FirstCommit | undefined
  if (record.phase === 'reserved') {
    const {policy} = await readClientExecutionPolicy(client, {...d, defaultVerificationPolicy: d.defaultVerificationPolicy}, record.payment, record.expected)
    const seed = random32(), signer = createLocalExecutionSigner(seed)
    try {
      const certificate = await createExecutionCertificate({payment: record.payment, policy, publicKey: signer.publicKey, expires: record.payment.expires,
        creator: config.creator})
      const certified: OperationRecord = {...record, phase: 'certified', seed: Uint8Array.from(seed), certificate, pollSecret: toHex(random32()).slice(2)}
      const key = recordKey(requestId)
      consent = {lock: [key], entries: [[key, certified]], check: async () => {
        const current = await store.load<OperationRecord>(key)
        if (!current || current.schema !== 1 || current.phase !== 'reserved') throw new TasraError('Paid operation journal changed concurrently')
      }}
      record = certified
    } finally { signer.dispose(); seed.fill(0) }
  }
  /**
   * The consent on its own, as before, when the drive did not journal it: a session that failed
   * before its first write (nothing bound to the consent was sent) or a driver that does not
   * journal it (a test double). Keeps such a failure resumable with the same consent. A journal
   * already holding exactly this consent (a store without native commits that failed mid-commit) is
   * left as it is.
   */
  const journalConsent = async () => {
    if (!consent || consent.published) return
    const key = recordKey(requestId), certified = consent.entries[0]![1] as OperationRecord
    await withCommit(store, key, async commit => {
      const current = await store.load<OperationRecord>(key)
      if (current?.schema === 1 && current.phase === 'certified' && current.certificate?.execution_key === certified.certificate?.execution_key) return
      if (!current || current.schema !== 1 || current.phase !== 'reserved') throw new TasraError('Paid operation journal changed concurrently')
      commit.stage(key, certified)
    })
    consent.published = true
  }
  if (!record.seed || !record.certificate || !record.pollSecret) throw new TasraError('Paid operation journal lacks its execution consent')
  const signer = createLocalExecutionSigner(record.seed)
  try {
    if (record.phase === 'certified') {
      if (!holder) throw new TasraError('Resuming a paid session requires its holder strategy')
      const params: PaidAgentSessionParams = {operation: record.params.operation, operationSig: record.params.operationSig,
        messageHex: record.params.messageHex, payment: record.payment, random: record.params.random, ...(record.params.decryption ? {decryption: record.params.decryption} : {}),
        ...(record.params.sessionGrant ? {sessionGrant: record.params.sessionGrant} : {})}
      let session
      try {
        session = await prepareRegisteredPaidSession(config.chain, {profile: config.agent.profile, deployment: {...d, defaultVerificationPolicy: d.defaultVerificationPolicy},
          transport: config.agent.transport, members: record.members, ruleHash: keccak256(toHex(record.rule)), dcqlQuery: JSON.parse(record.rule) as Record<string, unknown>,
          allowMissingStatusAttestations: config.allowMissingStatusAttestations === true},
        params, {certificate: record.certificate, signer, pollSecret: record.pollSecret, signal})
      } catch (error) {
        // Best effort: unjournaled, a resume certifies anew, which is safe as nothing was sent.
        await journalConsent().catch(() => {})
        if (signal.aborted) throw abortedError(requestId, 'session', record.payment, signal, error)
        throw error
      }
      const interval = config.pollIntervalMs ?? 1_000
      let result
      try {
        result = await drivePaidSession({session, members: record.members, store, signal, holder, observeRequest, resume: true,
          wait: hint => sleep(Math.min(Math.max(hint ?? interval, 10), 60_000), signal), ...consent ? {[FIRST_COMMIT]: consent} : {}} as PaidSessionDriverOptions)
      } catch (error) {
        // Best effort, as above: the drive's own failure is what the caller must see.
        await journalConsent().catch(() => {})
        // The completed grant failed the revocation-status preflight: nothing reached a keeper and
        // the journal stays `certified`. Never a new session or payment automatically.
        if (error instanceof RevocationStatusPreflightError) throw statusRefusal(requestId, error)
        // A journaled session write with an unknown outcome stays uncertain, abort or not.
        if (signal.aborted && !(error instanceof PaidSessionRecoveryError) && !(error instanceof PaidApprovalUnresolvedError)) throw abortedError(requestId, 'session', record.payment, signal, error)
        throw sessionFailure(requestId, record.payment, error)
      }
      const grant = verifierAgentResult({sessionId: session.sessionId, paymentHash: paymentIntentHash(record.payment),
        requestHash: requestHash(d.chainId, hexToBytes(record.payment.slot), record.action, hexToBytes(record.payloadDigest))}, result)
      if (!grant.verifierProofs?.length) throw new TasraError('Paid grant lacks anchored verifier proofs')
      await journalConsent()
      record = await advance(store, requestId, 'certified', {phase: 'authorized', grant: {compound_token: grant.token, verifierProofs: grant.verifierProofs, sessionId: session.sessionId, ...(grant.evidenceCt !== undefined ? {evidenceCt: grant.evidenceCt} : {}),
        ...(record.params.sessionGrant ? {sessionGrant: result.sessionGrant ?? {error: 'session_grant_missing'}} : {})}})
    }
    return handle(config, record, signer)
  } catch (error) { signer.dispose(); throw error }
}

function handle(config: PaidOperationConfig, record: OperationRecord, signer: ReturnType<typeof createLocalExecutionSigner>): PaidOperation {
  const d = {...config.deployment}, requestId = prepaidRequestId(record.payment), store = config.store
  if (!record.grant || !record.certificate) throw new TasraError('Paid operation is not authorized')
  const route = config.keeperUrl ?? ((url: string) => url)
  const approveExecution = createKeeperExecutionApprover({client: config.chain.client, deployment: d, payment: record.payment, expected: record.expected,
    certificate: record.certificate, signer, keeperUrl: config.keeperUrl, transportPolicy: {allowLocalHttp: config.allowLocalHttp}})
  const grant = record.grant, certificate = record.certificate
  // The latest journaled grant this handle knows: a status refresh replaces its attestations.
  let current: CompoundTokenWire = structuredClone(grant.compound_token)
  // A revocation refusal this handle saw, honoured even if journaling it failed.
  let refusedHere: StatusRefreshRefusal | undefined
  const operation: PaidOperation = {
    requestId, payment: structuredClone(record.payment), coordinatorUrl: route(record.coordinator.url),
    get compound_token() { return structuredClone(current) },
    get evidenceCt() { return grant.evidenceCt },
    get sessionGrant() { return grant.sessionGrant && structuredClone(grant.sessionGrant) },
    verifierProofs: structuredClone(grant.verifierProofs),
    verifier_proofs: grant.verifierProofs.map(p => ({verifier_index: p.verifierIndex, operator: p.operator, pubkey: p.pubkey, proof: [...p.proof]})),
    approveExecution,
    async execute<R>(work: (operation: PaidOperation) => Promise<R>): Promise<R> {
      // Pick up a refresh journaled through any handle or process (same token, same payment).
      // An unreadable journal is left to the checkpoint below, which refuses it as before.
      const latest = await loadRecord(store, requestId).catch(() => undefined)
      if (latest?.grant && sameToken(latest.grant.compound_token, current)) current = structuredClone(latest.grant.compound_token)
      // A refresh that answered a revocation refusal stops the grant, however fresh its
      // attestations still are: a verifier saying "revoked now" is never outvoted by older ones.
      const refused = latest ? latest.statusRefresh?.refused : refusedHere
      if (refused) throw refreshRefusal(requestId, refused)
      // Revocation-status preflight on the journaled grant, BEFORE the `executing` checkpoint:
      // a refusal sends nothing and leaves the journal `authorized`. After the send, a keeper's
      // refusal stays an uncertain execution like any other. Refreshing is explicit
      // (`refreshStatus`), never automatic.
      try {
        verifyEvidenceBinding(current, grant.evidenceCt, compoundTokenHash(decodeCompoundToken(current)), new Map(record.members.map(m => [m.index, hexToBytes(m.publicKey)])), record.payment.verification_quorum)
        statusPreflight(config, record, current)
      }
      catch (error) {
        if (error instanceof RevocationStatusPreflightError) throw statusRefusal(requestId, error)
        throw error
      }
      // Journal before sending: a lost reply leaves `executing`, which only recovery may read.
      // The checkpoint re-checks the refusal mark under the journal lock (a refresh may land between).
      await advance(store, requestId, 'authorized', {phase: 'executing'}, journal => {
        if (journal.statusRefresh?.refused) throw refreshRefusal(requestId, journal.statusRefresh.refused)
      }).catch((error: unknown) => {
        if (error instanceof RevocationStatusPreflightError) throw error
        throw new PaidOperationRecoveryError(requestId, 'execution', error)
      })
      let result: R
      try { result = await work(operation) }
      catch (error) { throw new PaidOperationRecoveryError(requestId, 'execution', error) }
      await advance(store, requestId, 'executing', {phase: 'executed'})
      return result
    },
    async refreshStatus(options?: RefreshPaidStatusOptions): Promise<PaidStatusRefresh> {
      let out: PaidStatusRefresh
      try { out = await refreshJournaledStatus(config, requestId, signer, 'authorized', options ?? {}) }
      catch (error) {
        if (error instanceof StatusRefreshError && error.code === 'status_refresh_refused') {
          refusedHere = {seq: error.seq ?? 0, at: Math.floor(Date.now() / 1000), reasons: [...error.reasons]}
        }
        throw error
      }
      refusedHere = undefined
      current = structuredClone(out.compound_token)
      return out
    },
    ...recoveryReads(config, record, certificate, signer),
    dispose: () => signer.dispose(),
  }
  return Object.freeze(operation)
}

/** `execute` after a refresh answered a revocation refusal: refused locally, nothing sent. */
function refreshRefusal(requestId: Hex, mark: StatusRefreshRefusal): RevocationStatusPreflightError {
  const detail = mark.reasons.map(r => `${r.verifierIndex !== undefined ? `#${r.verifierIndex} ` : ''}${r.code}`).join('; ')
  return new RevocationStatusPreflightError({code: 'revocation_status_refused', requestId,
    message: `Status refresh seq ${mark.seq} was refused: a verifier attests the holder's credential status is refused now${detail ? ` (${detail})` : ''}; nothing was sent - do not send this grant`})
}

/** Same token hash (every signed field equal); the attestations beside it may differ. */
function sameToken(a: CompoundTokenWire, b: CompoundTokenWire): boolean {
  try {
    const x = compoundTokenHash(decodeCompoundToken(a)), y = compoundTokenHash(decodeCompoundToken(b))
    return x.length === y.length && x.every((v, i) => v === y[i])
  } catch { return false }
}

/** The original trust a refresh is verified under: the anchored witnesses, quorum and hard caps. */
function refreshGrant(record: OperationRecord, wire: CompoundTokenWire) {
  return {token: wire, quorum: record.payment.verification_quorum, caps: [record.payment.expires],
    set: {registrySize: record.payment.verification_registry_size, pubkeys: new Map<number, Uint8Array>(record.members.map(m => [m.index, hexToBytes(m.publicKey)]))}}
}

/** Merge two verified attestation lists per verifier index; the later deadline wins. */
function mergeAttestations(a: readonly StatusAttestationWire[] | undefined, b: readonly StatusAttestationWire[]): StatusAttestationWire[] {
  const byIndex = new Map<number, StatusAttestationWire>()
  for (const w of [...(a ?? []), ...b]) {
    const prior = byIndex.get(w.verifier_index)
    if (!prior || w.status_until > prior.status_until) byIndex.set(w.verifier_index, {...w})
  }
  return [...byIndex.values()].sort((x, y) => x.verifier_index - y.verifier_index)
}

/**
 * One explicit status refresh of a journaled paid grant. The `seq` is allocated and journaled
 * under the journal lock BEFORE anything is signed or sent, so a crash never reuses it; the
 * outcome is journaled afterwards. The journal phase never changes here.
 */
async function refreshJournaledStatus(config: PaidOperationConfig, requestId: Hex, signer: ReturnType<typeof createLocalExecutionSigner>,
  mode: 'authorized' | 'executing', options: RefreshPaidStatusOptions): Promise<PaidStatusRefresh> {
  const store = config.store, key = recordKey(requestId), signal = options.signal
  const via = options.via ?? 'agent'
  if (via !== 'agent' && (typeof via !== 'object' || !Array.isArray(via.verifiers))) throw new TasraError('Invalid status refresh route')
  signal?.throwIfAborted()
  const allocated = await store.withLock(key, async () => {
    const record = await loadRecord(store, requestId)
    if (!record) throw new TasraError('No paid operation journal for this request')
    if (record.phase !== mode) {
      throw new TasraError(mode === 'authorized'
        ? `Status refresh is allowed only before execution (journal is ${record.phase}); after a send use recoverPaidOperation(...).refreshStatus({explicitRecovery: true}), which never makes the execution certain`
        : `Status refresh in explicit recovery applies only to an uncertain execution (journal is ${record.phase})`)
    }
    if (!record.grant) throw new TasraError('Paid operation journal lacks its grant')
    const wire = record.grant.compound_token, token = decodeCompoundToken(wire), now = Math.floor(Date.now() / 1000)
    const trust = refreshGrant(record, wire)
    if (signersThatVerify(token, trust.set).length < trust.quorum) throw new TasraError('Journaled grant lacks a verified quorum under its anchored witnesses')
    if (!token.paymentHash || toHex(token.paymentHash).toLowerCase() !== paymentIntentHash(record.payment).toLowerCase()) throw new TasraError('Journaled grant does not carry this payment')
    // Nothing usable can come back past a hard cap: refuse locally, nothing sent, no seq consumed.
    if (Math.min(Number(token.exp), record.payment.expires) - STATUS_SKEW_SECS <= now) {
      throw new StatusRefreshError({code: 'status_refresh_expired', requestId,
        message: `Status refresh not sent: the grant or payment expires within the ${STATUS_SKEW_SECS} s keeper skew`})
    }
    if (via === 'agent' && (!record.grant.sessionId || !record.pollSecret)) {
      throw new TasraError('This journal predates recorded agent sessions; refresh it directly with via: {verifiers}')
    }
    const prior = record.statusRefresh
    if ((prior?.attempts.length ?? 0) >= MAX_STATUS_REFRESH_ATTEMPTS) throw new TasraError('Paid operation reached its status refresh attempt bound')
    const seq = (prior?.seq ?? 0) + 1
    if (!Number.isSafeInteger(seq)) throw new TasraError('Status refresh sequence exhausted')
    const attempt: StatusRefreshAttempt = {seq, issuedAt: now, via: via === 'agent' ? 'agent' : 'direct',
      principal: options.holder ? 'holder_key' : 'client_execution', phase: mode}
    const next: OperationRecord = {...record, statusRefresh: {seq,
      original: prior ? prior.original : structuredClone(wire.status_attestations ?? null),
      attempts: [...(prior?.attempts ?? []), attempt],
      // A recorded revocation refusal survives every new attempt; only a success lifts it.
      ...(prior?.refused ? {refused: prior.refused} : {})}}
    await store.save(key, next)
    return {record: next, seq, issuedAt: now, trust, tokenHash: compoundTokenHash(token), paymentHash: token.paymentHash,
      relay: via === 'agent' ? {sessionId: record.grant.sessionId ?? '', bearer: record.pollSecret ?? ''} : undefined}
  })
  const {record, seq, issuedAt, trust, relay} = allocated
  const settle = (outcome: StatusRefreshOutcome, statusUntil?: number, refused?: StatusRefreshRefusal) => store.withLock(key, async () => {
    const latest = await loadRecord(store, requestId)
    if (!latest?.statusRefresh) return
    const attempts = latest.statusRefresh.attempts.map(a => a.seq === seq ? {...a, outcome, ...(statusUntil !== undefined ? {statusUntil} : {})} : a)
    await store.save(key, {...latest, statusRefresh: {...latest.statusRefresh, attempts, ...(refused ? {refused} : {})}} satisfies OperationRecord)
  })
  const fail = async (error: unknown): Promise<never> => {
    if (signal?.aborted) {
      await settle('aborted').catch(() => undefined)
      throw signal.reason ?? error
    }
    if (error instanceof StatusRefreshError) {
      // A revocation refusal is journaled as a mark `execute` honours; the grant stays unchanged.
      const refused = error.code === 'status_refresh_refused' ? {seq, at: Math.floor(Date.now() / 1000), reasons: [...error.reasons]} : undefined
      await settle(error.code, undefined, refused).catch(() => undefined)
      throw new StatusRefreshError({code: error.code, message: error.message, httpStatus: error.httpStatus, retryAfterMs: error.retryAfterMs,
        reasons: error.reasons, requestId, seq, retryable: error.retryable, cause: error})
    }
    await settle('status_refresh_unreachable').catch(() => undefined)
    throw new StatusRefreshError({code: 'status_refresh_unreachable', message: 'Status refresh got no verified answer', requestId, seq, cause: error})
  }
  let result: StatusRefreshResult
  try {
    const proof = await createStatusRefreshProof({chainId: record.payment.chain_id, tokenHash: allocated.tokenHash, paymentHash: allocated.paymentHash, seq, issuedAt,
      prover: options.holder ? {kind: 'holder_key', signer: options.holder} : {kind: 'client_execution', signer}})
    if (via === 'agent' && relay) {
      const active = AbortSignal.any([AbortSignal.timeout(RELAY_REFRESH_TIMEOUT_MS), ...(signal ? [signal] : [])])
      let response
      try {
        response = await config.agent.transport.paidAgentRequest(`${config.agent.profile.endpoint}/v1/sessions/${relay.sessionId}/status-refresh`,
          {method: 'POST', body: statusRefreshRelayBody(proof), bearer: relay.bearer, maxBytes: 64 * 1024, signal: active})
      } catch (error) {
        throw new StatusRefreshError({code: 'status_refresh_unreachable', message: 'Status refresh relay did not answer', cause: error})
      }
      result = acceptStatusRefreshRelay(trust, {status: response.status, body: response.body,
        ...(response.retryAfterMs !== undefined ? {retryAfterMs: response.retryAfterMs} : {})})
    } else if (via !== 'agent') {
      result = await refreshStatusDirect({...trust, chainId: record.payment.chain_id, proof, verifiers: via.verifiers,
        ...(via.fetch ? {fetch: via.fetch} : {}), allowHttp: config.allowLocalHttp === true && record.payment.chain_id === 43112, ...(signal ? {signal} : {})})
    } else throw new TasraError('Invalid status refresh route')
  } catch (error) { return fail(error) }
  const done: StatusRefreshResult = result
  // Apply under the lock, merged with the CURRENT journaled list (a concurrent refresh may have landed).
  return store.withLock(key, async () => {
    const latest = await loadRecord(store, requestId)
    if (!latest?.grant || !latest.statusRefresh) throw new TasraError('Paid operation journal changed concurrently')
    const applies = latest.phase === mode && sameToken(latest.grant.compound_token, done.token)
    const attempts = latest.statusRefresh.attempts.map(a => a.seq === seq ? {...a, outcome: applies ? 'refreshed' as const : 'journal-changed' as const, statusUntil: done.statusUntil} : a)
    if (!applies) {
      await store.save(key, {...latest, statusRefresh: {...latest.statusRefresh, attempts}} satisfies OperationRecord)
      throw new TasraError(`Paid operation journal moved to ${latest.phase} while the status refresh was in flight; the refreshed attestations were not applied`)
    }
    // Only entries a keeper would count survive from the journal; the refreshed ones were verified above.
    const counted = signersThatVerify(decodeCompoundToken(latest.grant.compound_token), trust.set)
    const journaled = (latest.grant.compound_token.status_attestations ?? []).filter(w => {
      // An original withdrawn by its verifier's negative outcome (or left out of a relay's answer) stays out.
      if (done.ineligible.includes(w.verifier_index)) return false
      const pubkey = trust.set.pubkeys.get(w.verifier_index)
      return pubkey !== undefined && counted.includes(w.verifier_index) && verifyStatusAttestation(pubkey, allocated.tokenHash, {verifierIndex: w.verifier_index, statusUntil: w.status_until, signature: hexToBytes(w.signature as Hex)})
    })
    const merged = mergeAttestations(journaled, done.statusAttestations)
    const compound = {...latest.grant.compound_token, status_attestations: merged}
    const decoded = decodeCompoundToken(compound)
    const statusUntil = verifyStatusAttestations({tokenHash: compoundTokenHash(decoded), attestations: decoded.statusAttestations ?? [],
      counted: signersThatVerify(decoded, trust.set), set: trust.set, quorum: trust.quorum, now: Math.floor(Date.now() / 1000)})
    // Success: no verifier refuses now, so an earlier refusal mark is lifted.
    const {refused: _lifted, ...history} = latest.statusRefresh
    await store.save(key, {...latest, grant: {...latest.grant, compound_token: compound}, statusRefresh: {...history, attempts}} satisfies OperationRecord)
    return {requestId: prepaidRequestId(record.payment), seq, statusUntil, compound_token: structuredClone(compound), refreshed: done.refreshed, failures: done.failures}
  })
}

/** The read-only recovery half of a handle: retained keeper results, never new work. */
function recoveryReads(config: PaidOperationConfig, record: OperationRecord, certificate: ExecutionCertificate,
  signer: ReturnType<typeof createLocalExecutionSigner>): Pick<PaidOperation, 'recover' | 'recoverIbePartials'> {
  const d = {...config.deployment}, route = config.keeperUrl ?? ((url: string) => url)
  return {
    async recover(options) {
      let keeper = record.coordinator
      let stage = options.stage ?? 'coordinator'
      if (options.contributorKey !== undefined) {
        const key = options.contributorKey
        if (!HEX32.test(key) || options.stage !== undefined && options.stage !== 'contributor') throw new TasraError('Assigned contributor key and contributor stage required')
        const member = record.contributors?.find(candidate => candidate.publicKey.toLowerCase() === key.toLowerCase())
        if (!member || !record.payment.keeper_assignment.contributors.some(publicKey => toHex(Uint8Array.from(publicKey)).toLowerCase() === key.toLowerCase())) throw new TasraError('Recovery contributor is not in the original signed assignment')
        keeper = member
        stage = 'contributor'
      }
      return recoverKeeperExecution({client: config.chain.client, deployment: d, payment: record.payment, expected: record.expected,
        keeper: {...keeper, url: route(keeper.url)}, target: {stage, executionKey: certificate.execution_key},
        signer, transport: options.transport, transportPolicy: {allowLocalHttp: config.allowLocalHttp}, signal: options.signal})
    },
    async recoverIbePartials(options) {
      if (record.payment.action !== 'ibe-extract') throw new TasraError('IBE partial recovery applies to an ibe-extract operation only')
      // Journals written before contributors were recorded (SDK before dfafff3) can only use `recover`.
      if (!record.contributors?.length) throw new TasraError('Paid operation journal lacks its assigned contributors')
      const binding = record.params.decryption
      if (!binding || !options.recipient || options.identity === undefined || !options.verifyingShares) throw new TasraError('Original client recipient, identity and authenticated sharing required for sealed IBE recovery')
      const digest = recipientPayloadDigest(sha256(new TextEncoder().encode(options.identity)), binding.ciphertext_epoch, options.recipient.recipient)
      if (toHex(digest).toLowerCase() !== record.payloadDigest.toLowerCase()) throw new TasraError('Recovery recipient or identity differs from original authorization')
      const concurrency = options.concurrency ?? 4, threshold = record.payment.keeper_assignment.threshold
      if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new TasraError('IBE partial recovery concurrency must be 1..16')
      const queue = record.contributors.map(member => ({...member, url: route(member.url)}))
      const partials: RecoveredIbePartial[] = [], failures: RecoveredIbePartials['failures'] = []
      const read = async (): Promise<void> => {
        for (let keeper = queue.shift(); keeper; keeper = queue.shift()) {
          if (partials.length >= threshold) return
          options.signal?.throwIfAborted()
          try {
            const recovered = await recoverKeeperExecution({client: config.chain.client, deployment: d, payment: record.payment, expected: record.expected,
              keeper, target: {stage: 'contributor', executionKey: certificate.execution_key}, signer, transport: options.transport,
              transportPolicy: {allowLocalHttp: config.allowLocalHttp}, signal: options.signal})
            const partial = await ibePartial(recovered.resultJson, keeper.url, record, options, d.chainId)
            if (partials.length >= threshold || partials.some(p => p.partial.identifier === partial.identifier)) partial.value.fill(0)
            else partials.push({keeper, partial, recovered})
          } catch (error) {
            options.signal?.throwIfAborted()
            failures.push({operator: keeper.operator, message: error instanceof Error ? error.message : 'unreadable retained result'})
          }
        }
      }
      const reads = await Promise.allSettled(Array.from({length: Math.min(concurrency, queue.length)}, read))
      const failed = reads.find(r => r.status === 'rejected')
      if (failed || partials.length < threshold) {
        for (const p of partials) p.partial.value.fill(0)
        if (failed?.status === 'rejected') throw failed.reason
        throw new TasraError(`Recovered ${partials.length} of ${threshold} required IBE partials; ${failures.length} contributor(s) failed`)
      }
      return {threshold, partials: partials.slice(0, threshold), failures}
    },
  }
}

/** Read-only recovery for a paid operation whose keeper work was sent; see {@link recoverPaidOperation}. */
export interface PaidOperationRecovery {
  /** Reservation identity. */
  readonly requestId: Hex
  /** Original creator-signed payment intent. */
  readonly payment: PaymentIntentWire
  /** Journaled phase (`executing` or `executed`, or `abandoned` from one of them). */
  readonly phase: PaidOperationJournalPhase
  /** Read the keeper's retained result (coordinator stage by default). Performs no new work. */
  recover: PaidOperation['recover']
  /** For `ibe-extract`: read contributors' retained partials up to the threshold. Performs no new work. */
  recoverIbePartials: PaidOperation['recoverIbePartials']
  /**
   * EXPLICIT RECOVERY ONLY: refresh the grant's revocation-status attestations while the execution
   * is uncertain (`executing`), for an application that has independently decided to continue the
   * SAME request (for example after `recover` found no coordinator record). It changes no keeper
   * state and NOT the journal phase: the execution stays uncertain, `execute` stays refused, and
   * neither a keeper 403 nor a recovery 404 becomes evidence that no work ran. Same journaled,
   * never-reused `seq` as {@link PaidOperation.refreshStatus}; requires `explicitRecovery: true`.
   */
  refreshStatus(options: RefreshPaidStatusOptions & {explicitRecovery: true}): Promise<PaidStatusRefresh>
  /** Erase the local execution signer. */
  dispose(): void
}

/**
 * Open the read-only recovery reads of a paid operation whose keeper work was sent, straight
 * from its journal: after {@link reconcilePaidOperation} reports `next: 'recover'` (phase
 * `executing`), or to re-read an `executed` result. No reservation, session or execution
 * happens, and no holder is needed. Refused for any other phase. Journals written before the
 * SDK recorded assigned contributors (before dfafff3) support `recover` but not
 * `recoverIbePartials`.
 * @param config The configuration the operation started with.
 * @param requestId Reservation identity.
 */
export async function recoverPaidOperation(config: PaidOperationConfig, requestId: Hex): Promise<PaidOperationRecovery> {
  validateConfig(config)
  const record = await loadRecord(config.store, requestId)
  if (!record) throw new TasraError('No paid operation journal for this request')
  const sent = record.phase === 'abandoned' ? record.abandoned?.phase : record.phase
  if (sent !== 'executing' && sent !== 'executed') throw new TasraError('Paid operation recovery applies only after its keeper work was sent (phase executing or executed)')
  if (!record.seed || !record.certificate) throw new TasraError('Paid operation journal lacks its execution consent')
  const signer = createLocalExecutionSigner(record.seed)
  return Object.freeze({requestId: prepaidRequestId(record.payment), payment: structuredClone(record.payment), phase: record.phase,
    ...recoveryReads(config, record, record.certificate, signer),
    refreshStatus: (options: RefreshPaidStatusOptions & {explicitRecovery: true}) => {
      if (options?.explicitRecovery !== true) return Promise.reject(new TasraError('Status refresh after a send requires explicitRecovery: true'))
      const {explicitRecovery: _explicit, ...rest} = options
      return refreshJournaledStatus(config, requestId, signer, 'executing', rest)
    },
    dispose: () => signer.dispose()})
}

/** What the application should do next with a reconciled paid operation. */
export type PaidOperationNextStep =
  /** Nothing was ever reserved; `resumePaidOperation` makes the first reservation. */
  | 'reserve'
  /** Reserved or further; `resumePaidOperation` continues (session needs its holder). */
  | 'resume'
  /** The reservation outcome is not provable yet; reconcile again later. Never reserve again. */
  | 'wait'
  /** Keeper execution outcome is uncertain; read it with the handle's `recover`. */
  | 'recover'
  /** The keeper operation completed. */
  | 'done'
  /** The original reservation provably never happened; this operation is finished unpaid. */
  | 'abandon'
  /** The application closed this operation with {@link abandonPaidOperation}; nothing more to do. */
  | 'closed'

/** Read-only reconciliation result of {@link reconcilePaidOperation}. */
export interface PaidOperationStatus {
  /** Reservation identity. */
  requestId: Hex
  /** Journaled phase after reconciliation. */
  phase: PaidOperationJournalPhase
  /** Gas payer the journal recorded (absent from journals written before payers were recorded). */
  payer?: Address
  /** Reservation state: proven from the chain while `reserving`, implied by the phase afterwards. */
  reservation: ApplicationReservationState
  /** Whether this operation still holds its gas payer's durable claim. */
  payerLocked: boolean
  /** Next safe step. */
  next: PaidOperationNextStep
  /** Why the reservation is `uncertain` or `not-reserved`; safe to log. */
  reason?: string
  /** Journaled or reported reservation transaction hash, when known. */
  transactionHash?: Hex
}

/** Options shared by {@link resumePaidOperation} and {@link reconcilePaidOperation}. */
export interface ResumePaidOperationOptions {
  /** Holder strategy, needed while the session is unfinished. */
  holder?: PaidSessionHolder
  /** A located original reservation transaction hash, when none was journaled; speeds a proof before the quote deadline. */
  transactionHash?: Hex
  /** Cancellation. */
  signal?: AbortSignal
  /** Inspect the verified request object before any credential is disclosed. */
  observeRequest?(request: VerifiedRequestObject): void | Promise<void>
  /** Chain observation depth for reservation reconciliation, 1..64 (default 1). */
  confirmations?: number
  /**
   * Only reconcile: never reserve, never drive the session, never execute. Returns the
   * {@link PaidOperationStatus} instead of a handle. Same as {@link reconcilePaidOperation}.
   */
  reconcileOnly?: boolean
}

function loadRecord(store: ApplicationStore, requestId: Hex): Promise<OperationRecord | undefined> {
  return store.load<OperationRecord>(recordKey(requestId)).then(record => {
    if (record === undefined) return undefined
    if (!record || record.schema !== 1 || prepaidRequestId(record.payment).toLowerCase() !== requestId.toLowerCase()) throw new TasraError('Paid operation journal does not match its request')
    return record
  })
}

/** Proven reservation state of a `reserving` record, advancing the journal only on proof. */
async function reconcileReservation(config: PaidOperationConfig, requestId: Hex, record: OperationRecord, options: Pick<ResumePaidOperationOptions, 'transactionHash' | 'confirmations'>) {
  const d = {...config.deployment}, store = config.store
  let status = await reconcileApplicationReservation(config.chain.client, store, d, record.payment, record.expected,
    {payer: record.payer ?? config.gasPayer.account.address, confirmations: options.confirmations})
  if (status.state === 'uncertain' && status.payerLocked) {
    // A known hash can prove a mined original (success or revert) before the quote deadline.
    const journal = await loadPaidReservationJournal(store, requestId)
    const hash = journal?.transactionHash ?? options.transactionHash
    if (journal && hash) {
      const resolution = await reconcileApplicationPayment(config.chain.client, store, d, requestId, record.expected, hash, options.confirmations).catch(() => undefined)
      if (resolution) status = {...status, state: resolution.status === 'success' ? 'reserved' : 'not-reserved', payerLocked: false, transactionHash: hash,
        reason: resolution.status === 'success' ? undefined : 'the original reservation transaction reverted'}
    }
  }
  let phase: Phase = 'reserving'
  if (status.state === 'reserved') phase = (await advance(store, requestId, 'reserving', {phase: 'reserved'})).phase
  else if (status.state === 'not-reserved') phase = (await advance(store, requestId, 'reserving', {phase: 'failed', failure: {reason: status.reason ?? 'reservation never happened'}})).phase
  return {status, phase}
}

const NEXT: Record<Phase, PaidOperationNextStep> = {reserving: 'wait', reserved: 'resume', certified: 'resume', authorized: 'resume', executing: 'recover', executed: 'done', failed: 'abandon', abandoned: 'closed'}
/** Reservation state implied by a phase past `reserving` (an abandoned unsent operation was never reserved). */
function impliedReservation(record: OperationRecord): ApplicationReservationState {
  const phase = record.phase === 'abandoned' ? record.abandoned?.phase : record.phase
  return phase === 'failed' ? 'not-reserved' : phase === 'reserving' ? 'none' : 'reserved'
}

/**
 * Reconcile a paid operation without any billable or keeper work: no reservation, no session
 * write, no execution. A `reserving` operation is checked on chain by its request ID and payer
 * nonce (no transaction hash needed) and advanced only on proof: `reserved` when the chain holds
 * it, `failed` when its quote deadline passed without one. Anything else stays `reserving`
 * with `next: 'wait'` and the payer locked.
 * @param config The configuration the operation started with.
 * @param requestId Reservation identity.
 * @param options Located transaction hash and observation depth.
 */
export async function reconcilePaidOperation(config: PaidOperationConfig, requestId: Hex,
  options: Pick<ResumePaidOperationOptions, 'transactionHash' | 'confirmations'> = {}): Promise<PaidOperationStatus> {
  validateConfig(config)
  const record = await loadRecord(config.store, requestId)
  if (!record) throw new TasraError('No paid operation journal for this request')
  const payer = record.payer ? {payer: record.payer} : {}
  if (record.phase === 'reserving' && record.payment.allowance_id !== undefined) {
    // ADR-0090: a journaled voucher completes the debit; otherwise resume requests the same seq and request.
    const voucher = await journaledAllowanceVoucher(config.store, requestId)
    if (voucher) {
      const phase = (await advance(config.store, requestId, 'reserving', {phase: 'reserved', payment: {...record.payment, debit_voucher: voucher}})).phase
      return {requestId, phase, ...payer, reservation: 'reserved', payerLocked: false, next: NEXT[phase]}
    }
    return {requestId, phase: record.phase, ...payer, reservation: 'none', payerLocked: false, next: 'reserve', reason: 'allowance debit not completed; resume requests the same voucher'}
  }
  if (record.phase !== 'reserving') {
    return {requestId, phase: record.phase, ...payer, reservation: impliedReservation(record), payerLocked: false, next: NEXT[record.phase],
      ...(record.abandoned ? {reason: record.abandoned.reason} : record.failure ? {reason: record.failure.reason} : {})}
  }
  const {status, phase} = await reconcileReservation(config, requestId, record, options)
  return {requestId, phase, ...payer, reservation: status.state, payerLocked: status.payerLocked,
    next: status.state === 'none' ? 'reserve' : NEXT[phase],
    ...(status.reason ? {reason: status.reason} : {}), ...(status.transactionHash ? {transactionHash: status.transactionHash} : {})}
}

/**
 * Continue a paid operation from its journal after a PaidOperationRecoveryError or a restart.
 * A `reserving` operation is first reconciled on chain (see {@link reconcilePaidOperation}); it
 * is reserved only when nothing was ever prepared for it (no journal, no payer claim, nothing on
 * chain), and never again after any preparation. An unprovable reservation throws
 * PaidOperationRecoveryError and keeps the gas payer locked. A session is re-read, skipping
 * confirmed writes; an authorized or executing operation returns its handle (use `recover` for
 * an uncertain execution). With `reconcileOnly` it returns the status instead and does no work.
 * @param config The same configuration the operation started with.
 * @param requestId Reservation identity from the error or the journal.
 * @param options Holder strategy, located transaction hash, cancellation, request observation, reconcile-only.
 */
export async function resumePaidOperation(config: PaidOperationConfig, requestId: Hex, options: ResumePaidOperationOptions & {reconcileOnly: true}): Promise<PaidOperationStatus>
/**
 * Continue a paid operation from its journal after a PaidOperationRecoveryError or a restart.
 * A `reserving` operation is first reconciled on chain (see {@link reconcilePaidOperation}); it
 * is reserved only when nothing was ever prepared for it (no journal, no payer claim, nothing on
 * chain), and never again after any preparation. An unprovable reservation throws
 * PaidOperationRecoveryError and keeps the gas payer locked. A session is re-read, skipping
 * confirmed writes; an authorized or executing operation returns its handle (use `recover` for
 * an uncertain execution). With `reconcileOnly` it returns the status instead and does no work.
 * @param config The same configuration the operation started with.
 * @param requestId Reservation identity from the error or the journal.
 * @param options Holder strategy, located transaction hash, cancellation, request observation, reconcile-only.
 */
export async function resumePaidOperation(config: PaidOperationConfig, requestId: Hex, options?: ResumePaidOperationOptions & {reconcileOnly?: false}): Promise<PaidOperation>
/**
 * Continue a paid operation from its journal after a PaidOperationRecoveryError or a restart.
 * A `reserving` operation is first reconciled on chain (see {@link reconcilePaidOperation}); it
 * is reserved only when nothing was ever prepared for it (no journal, no payer claim, nothing on
 * chain), and never again after any preparation. An unprovable reservation throws
 * PaidOperationRecoveryError and keeps the gas payer locked. A session is re-read, skipping
 * confirmed writes; an authorized or executing operation returns its handle (use `recover` for
 * an uncertain execution). With `reconcileOnly` it returns the status instead and does no work.
 * @param config The same configuration the operation started with.
 * @param requestId Reservation identity from the error or the journal.
 * @param options Holder strategy, located transaction hash, cancellation, request observation, reconcile-only.
 */
export async function resumePaidOperation(config: PaidOperationConfig, requestId: Hex, options: ResumePaidOperationOptions = {}): Promise<PaidOperation | PaidOperationStatus> {
  if (options.reconcileOnly) return reconcilePaidOperation(config, requestId, options)
  validateConfig(config)
  const signal = options.signal ?? new AbortController().signal, store = config.store
  const record = await loadRecord(store, requestId)
  if (!record) throw new TasraError('No paid operation journal for this request')
  if (record.phase === 'failed') throw new PaidOperationRecoveryError(requestId, 'reservation', new Error(record.failure?.reason ?? 'reservation never happened'), {code: 'reservation-failed'})
  if (record.phase === 'abandoned') throw new TasraError('Paid operation was abandoned; it is never resumed')
  if (record.phase === 'reserving' && record.payment.allowance_id !== undefined) {
    // ADR-0090: no per-operation reservation to reconcile; resume the same journaled debit.
    await reserve(config, record, signal)
  } else if (record.phase === 'reserving') {
    // The reservation must use the payer the journal recorded (its claim and nonce live there).
    if (record.payer && record.payer.toLowerCase() !== config.gasPayer.account.address.toLowerCase()) {
      throw new TasraError(`Paid operation was journaled with gas payer ${record.payer}; resume it with that payer`)
    }
    let reconciled
    try { reconciled = await reconcileReservation(config, requestId, record, options) }
    catch (error) { throw new PaidOperationRecoveryError(requestId, 'reservation', error) }
    const {status} = reconciled
    if (status.state === 'none') await reserve(config, record, signal)
    else if (status.state === 'uncertain') throw new PaidOperationRecoveryError(requestId, 'reservation', new Error(status.reason ?? 'reservation outcome is not provable yet'))
    else if (status.state === 'not-reserved') throw new PaidOperationRecoveryError(requestId, 'reservation', new Error(status.reason ?? 'reservation never happened'), {code: 'reservation-failed'})
  }
  return continueOperation(config, requestId, options.holder, signal, options.observeRequest)
}

/**
 * Read the journaled phase of a paid operation, for deciding between resume and recovery.
 * @param store Store the operation was journaled in.
 * @param requestId Reservation identity.
 */
/** A final dual-control Sign: the message whose SHA-256 the payment binds, and its lifetime. */
export interface PaidFinalSignRequest {
  /** FROST slot under a dual-control policy. */
  slot: Hex
  /** Exact message the dual-control request will sign. */
  message: Uint8Array
  /** Payment lifetime, 1..3600 seconds (default 600). */
  ttlSecs?: number
  /** Pin the coordinator keeper (operator address); otherwise the drawn one. */
  coordinator?: Address
  /** Cancellation (discovery, debit or reservation). */
  signal?: AbortSignal
  /** Receive the request identity before anything is debited or reserved; a throw stops it. */
  onRequestId?(requestId: Hex): void | Promise<void>
}

/** A paid final Sign ready for `createDualSignClient`: its payment, keeper and execution approvals. */
export interface PaidFinalSign {
  /** Request identity (the dual-sign request id without `0x`). */
  requestId: Hex
  /** The backed final Sign payment (with its debit voucher when allowance-backed). */
  payment: PaymentIntentWire
  /** The payment's coordinator keeper URL (after `keeperUrl` routing). */
  coordinatorUrl: string
  /** Approves the keeper's final work for exactly this payment (the dual-sign `approveExecution`). */
  approveExecution: KeeperExecutionApprover
  /** Erase the execution key from memory. */
  dispose(): void
}

/**
 * Pay a final dual-control Sign without any presentation: no verifier-agent session and no
 * credential grant follows, because a static-key dual-control quorum authorizes the work at the
 * keeper. With `config.allowances` it is debited from an allowance lane (ADR-0090) and falls back
 * to a per-operation reservation exactly as {@link paidOperation} does; the journal, the execution
 * certificate and the keeper approvals are the ones paidOperation uses. Resume an interrupted one
 * with {@link resumePaidFinalSign}.
 * @param config - Paid operation configuration (its agent settings are not used).
 * @param request - Slot, message, lifetime and cancellation.
 */
export async function paidFinalSign(config: PaidOperationConfig, request: PaidFinalSignRequest): Promise<PaidFinalSign> {
  validateConfig(config)
  if (!config.allowances?.enabled) return finalSignAttempt(config, request, false)
  try { return await finalSignAttempt(config, request, true) }
  catch (error) {
    if (!(error instanceof AllowanceFallback)) throw error
    return finalSignAttempt(config, request, false)
  }
}

async function finalSignAttempt(config: PaidOperationConfig, request: PaidFinalSignRequest, useAllowance: boolean): Promise<PaidFinalSign> {
  if (!(request.message instanceof Uint8Array) || request.message.length === 0) throw new TasraError('Final Sign requires the exact message')
  const requestId = await presentationlessAttempt(config, request, useAllowance, {marker: 'finalSign', action: 'sign', mode: 0,
    modeError: 'A final dual-control Sign requires a FROST slot', description: 'Paid final dual-control Sign',
    build: (d, nowSecs, ttlSecs) => {
      const built = presentationOperationTypedData({action: 'sign', message: request.message, chainId: d.chainId, keyRegistry: d.keyRegistry, slotId: request.slot,
        description: 'Paid final dual-control Sign', nowSecs, ttlSecs})
      if (toHex(built.payloadDigest).toLowerCase() !== toHex(sha256(request.message)).toLowerCase()) throw new TasraError('Final Sign payload differs from its message digest')
      return built
    }})
  return continueFinalSign(config, requestId)
}

/** What a presentationless paid operation pays for: its journal marker, action, slot mode and operation. */
interface PresentationlessSpec {
  marker: 'finalSign' | 'sessionDecrypt'
  action: 'sign' | 'decrypt'
  mode: number
  modeError: string
  description: string
  build(d: PaidContextDeployment & {chainId: number; keyRegistry: Address}, nowSecs: number, ttlSecs: number): ReturnType<typeof presentationOperationTypedData>
  decryption?: DecryptionBindingWire
  /** ADR-0090 D7: the session grant's draw the payment must name (the keeper refuses any other). */
  draw?: {epoch: bigint; seed: Hex}
  /** Sees the discovery the payment is built from (the beacon epoch it observed). */
  onContext?(context: PaidOperationContext): void
}

/** Pay one operation without any presentation (final dual Sign, ADR-0090 D7 session decrypt): journaled, reserved, never presented. */
async function presentationlessAttempt(config: PaidOperationConfig, request: {slot: Hex; ttlSecs?: number; coordinator?: Address; signal?: AbortSignal;
  onRequestId?(requestId: Hex): void | Promise<void>}, useAllowance: boolean, spec: PresentationlessSpec): Promise<Hex> {
  const d = {...config.deployment}, client = config.chain.client, signal = request.signal ?? new AbortController().signal
  const slot = request.slot
  if (!HEX32.test(slot)) throw new TasraError('Invalid paid operation slot')
  if (config.billing) await config.billing.requirePrepaid(slot)
  const readiness = AbortSignal.any([signal, AbortSignal.timeout(config.snapshotWaitMs ?? 180_000)])
  const context = await waitForPaidSnapshot(() => discoverPaidOperationContext(client, d, slot,
    {allowLocalHttp: config.allowLocalHttp, defaultVerificationPolicy: d.defaultVerificationPolicy, coordinator: request.coordinator, fundedByAllowance: useAllowance,
      ...spec.draw ? {verificationEpoch: spec.draw.epoch} : {}}),
  // A moved draw (PaidDrawMovedError) is not an absent anchor: it is thrown, never waited on.
  readiness, () => sleep(1_000, readiness))
  if (context.creator.toLowerCase() !== config.creator.address.toLowerCase()) throw new TasraError('Paid operations are signed by the slot creator; this signer is not it')
  if (context.mode !== spec.mode) throw new TasraError(spec.modeError)
  // Discovered without `undrawnDuringAnchorGap`: always drawn (refused, never zero fields, otherwise).
  if (context.undrawn) throw new TasraError('Paid operation discovery returned no verifier draw')
  if (spec.draw && (BigInt(context.intentFields.verification_epoch) !== spec.draw.epoch
    || context.intentFields.verification_seed.toLowerCase() !== spec.draw.seed.toLowerCase())) {
    throw new TasraError('The session grant names a seed the beacon does not hold for its epoch')
  }
  spec.onContext?.(context)
  const ttlSecs = request.ttlSecs ?? 600
  if (!Number.isSafeInteger(ttlSecs) || ttlSecs <= 0 || ttlSecs > 3600) throw new TasraError('Paid operation lifetime must be 1..3600 seconds')
  // The operation record keeps the presentation shape; nothing is signed or presented for it.
  const built = spec.build(d, Math.floor(Date.now() / 1000), ttlSecs)
  const payloadDigest = built.payloadDigest
  const randomBytes = random32(), random = toHex(randomBytes); randomBytes.fill(0)
  const env = useAllowance ? allowanceEnv(config) : undefined
  // A session message pays the GRANT's draw (all six fields: the keeper's
  // `require_payment_names_draw`), so only a lane drawn on it funds one, else a per-operation
  // reservation at it.
  const ticket = env ? await selectAllowanceLane(env, context, {action: spec.action, expires: built.operation.exp, drawPinned: spec.draw !== undefined}) : undefined
  const unsigned = {...ticket ? ticket.fields : context.intentFields, action: spec.action,
    payload_digest: toHex(payloadDigest), session_commitment: paymentSessionCommitment(random, config.agent.profile.clientId, built.operation.exp),
    nonce: toHex(random32()), max_cost: config.limits.maxCost.toString(), expires: built.operation.exp, ...ticket ? {allowance_id: ticket.allowanceId} : {}}
  const payment: PaymentIntentWire = {...unsigned, signature: await config.creator.signTypedData(paymentIntentTypedData(unsigned))}
  const expected: ExpectedPaidOperation = {slot, action: spec.action, payloadDigest: payment.payload_digest}
  const requestId = prepaidRequestId(payment)
  followPaidRequest(client, d, payment)
  await request.onRequestId?.(requestId)
  signal.throwIfAborted()
  const record: OperationRecord = {schema: 1, phase: 'reserving', ...spec.marker === 'finalSign' ? {finalSign: true as const} : {sessionDecrypt: true as const}, payment, expected, members: [], rule: '', ruleSalt: `0x${'00'.repeat(32)}`,
    params: {operation: built.operation, operationSig: '0x', messageHex: built.messageHex, random, ...spec.decryption ? {decryption: spec.decryption} : {}},
    coordinator: context.coordinator, contributors: context.contributors, action: spec.action, payloadDigest: toHex(payloadDigest), payer: config.gasPayer.account.address, ...ticket ? {allowance: {lane: ticket.lane}} : {}}
  await journalNewOperation(config.store, requestId, record)
  try { await reserve(config, record, signal) }
  catch (error) {
    if (ticket && error instanceof PaidOperationRecoveryError && error.code === 'reservation-failed' && error.cause instanceof AllowanceRefusedError) throw new AllowanceFallback(requestId, error)
    throw error
  }
  return requestId
}

/**
 * Resume a journaled final Sign ({@link paidFinalSign}) after an interruption: a `reserving` one is
 * reconciled through the same debit or reservation path (never a second payment), then certified.
 * @param config - The original configuration.
 * @param requestId - The final Sign's request identity.
 * @param signal - Cancellation.
 */
export async function resumePaidFinalSign(config: PaidOperationConfig, requestId: Hex, signal?: AbortSignal): Promise<PaidFinalSign> {
  validateConfig(config)
  const record = await config.store.load<OperationRecord>(recordKey(requestId))
  if (!record || record.schema !== 1 || !record.finalSign) throw new TasraError('No final Sign journal for this request')
  if (record.phase === 'reserving') await reserve(config, record, signal ?? new AbortController().signal)
  return continueFinalSign(config, requestId)
}

async function continueFinalSign(config: PaidOperationConfig, requestId: Hex): Promise<PaidFinalSign> {
  const d = {...config.deployment}, store = config.store
  let record = await store.load<OperationRecord>(recordKey(requestId))
  if (!record || record.schema !== 1 || !record.finalSign || prepaidRequestId(record.payment).toLowerCase() !== requestId.toLowerCase()) throw new TasraError('No final Sign journal for this request')
  if (record.phase === 'reserved') {
    const {policy} = await readClientExecutionPolicy(config.chain.client, {...d, defaultVerificationPolicy: d.defaultVerificationPolicy}, record.payment, record.expected)
    const seed = random32(), signer = createLocalExecutionSigner(seed)
    try {
      const certificate = await createExecutionCertificate({payment: record.payment, policy, publicKey: signer.publicKey, expires: record.payment.expires, creator: config.creator})
      record = await advance(store, requestId, 'reserved', {phase: 'certified', seed: Uint8Array.from(seed), certificate, pollSecret: toHex(random32()).slice(2)})
    } finally { signer.dispose(); seed.fill(0) }
  }
  if (record.phase !== 'certified' || !record.seed || !record.certificate) throw new TasraError(`Final Sign journal is ${record.phase}, not payable`)
  const signer = createLocalExecutionSigner(record.seed)
  const approveExecution = createKeeperExecutionApprover({client: config.chain.client, deployment: d, payment: record.payment, expected: record.expected,
    certificate: record.certificate, signer, keeperUrl: config.keeperUrl, transportPolicy: {allowLocalHttp: config.allowLocalHttp}})
  const route = config.keeperUrl ?? ((url: string) => url)
  return {requestId, payment: structuredClone(record.payment), coordinatorUrl: route(record.coordinator.url), approveExecution, dispose: () => signer.dispose()}
}

/** One ADR-0090 D7 session-grant KEM decrypt to pay: the slot and the exact recipient binding. */
export interface PaidSessionDecryptRequest {
  /** KEM (BLS) slot named by the session grant. */
  slot: Hex
  /** Recipient binding of this ciphertext ({@link decryptionBinding}); fixes the payload digest. */
  decryption: DecryptionBindingWire
  /** Payment lifetime, 1..3600 seconds (default 600). */
  ttlSecs?: number
  /** Cancellation (discovery, debit or reservation). */
  signal?: AbortSignal
  /** Receive the request identity before anything is debited or reserved; a throw stops it. */
  onRequestId?(requestId: Hex): void | Promise<void>
  /**
   * The session grant this decrypt is served under (`GrantedSession.current()`). The payment then
   * names THE GRANT'S verifier draw, as the keeper requires of every session item (any other draw
   * is refused: "payment names another verifier draw than the session grant"). While the grant's
   * epoch is the beacon's latest or previous it is paid there; past that a `PaidDrawMovedError`
   * (`code: 'draw-moved'`) is thrown before anything is signed: refresh the grant first. Without
   * it the payment takes the freshly discovered draw, which is the grant's only by chance.
   */
  grant?: {epoch: number; seed: string}
  /**
   * Sees the beacon's latest epoch the moment discovery reads it, before anything is signed
   * (`GrantedSession.observeBeacon`: the grant's background refresh then starts while this
   * payment is still being reserved). A throw is ignored.
   */
  onBeaconEpoch?(epoch: bigint): void
}

/** A paid session-grant decrypt ready for the session partials client. */
export interface PaidSessionDecrypt {
  /** Request identity. */
  requestId: Hex
  /** The backed decrypt payment (with its debit voucher when allowance-backed). */
  payment: PaymentIntentWire
  /** Approves each keeper's contribution for exactly this payment (kind `session-decrypt`). */
  approveExecution: KeeperExecutionApprover
  /**
   * Read ONE assigned contributor's retained partial for this decrypt after it answered that the item
   * already ran (`409 recoverable` / `already claimed`): the paid-execution recovery route, which
   * performs no new work and spends nothing. `nodeUrl` is the keeper URL the request went to (after
   * `keeperUrl` routing). Returns the retained partial JSON for `decryptWithSessionGrant`'s `recover`.
   */
  recoverPartial(options: {nodeUrl: string; transport: KeeperRecoveryTransport; signal?: AbortSignal}): Promise<unknown>
  /** Erase the execution key from memory. */
  dispose(): void
  /**
   * The beacon's latest epoch the payment's discovery observed (absent on a resume). Once it is past
   * the grant's epoch, refresh the grant before the beacon moves again: a refresh continues ONE
   * epoch; a skipped epoch needs a new presentation.
   */
  beaconEpoch?: bigint
}

/**
 * Pay one KEM decrypt that a session grant (ADR-0090 D7) authorizes: no presentation and no
 * verifier round, because the grant and the session-key proof authorize the keeper work. With
 * `config.allowances` it is debited from an allowance lane and falls back to a per-operation
 * reservation exactly as {@link paidOperation}; journal, certificate and keeper approvals are the
 * ones every paid operation uses. Resume an interrupted one with {@link resumePaidSessionDecrypt}.
 * @param config - Paid operation configuration (its agent settings are not used).
 * @param request - Slot, recipient binding, lifetime and cancellation.
 */
export async function paidSessionDecrypt(config: PaidOperationConfig, request: PaidSessionDecryptRequest): Promise<PaidSessionDecrypt> {
  validateConfig(config)
  const grant = request.grant
  if (grant !== undefined && (!Number.isSafeInteger(grant.epoch) || grant.epoch < 0 || typeof grant.seed !== 'string' || !HEX32.test(grant.seed))) {
    throw new TasraError('Invalid session grant draw')
  }
  const draw = grant ? {epoch: BigInt(grant.epoch), seed: grant.seed as Hex} : undefined
  let beaconEpoch: bigint | undefined
  const attempt = (useAllowance: boolean) => presentationlessAttempt(config, request, useAllowance, {marker: 'sessionDecrypt', action: 'decrypt', mode: 1,
    modeError: 'A session-grant decrypt requires a BLS slot', description: 'Paid session-grant decrypt', decryption: structuredClone(request.decryption),
    build: (d, nowSecs, ttlSecs) => presentationOperationTypedData({action: 'decrypt', decryption: request.decryption, chainId: d.chainId, keyRegistry: d.keyRegistry,
      slotId: request.slot, description: 'Paid session-grant decrypt', nowSecs, ttlSecs}),
    ...draw ? {draw} : {}, onContext: context => {
      beaconEpoch = context.beaconEpoch
      if (beaconEpoch !== undefined) try { request.onBeaconEpoch?.(beaconEpoch) } catch { /* an observer never fails the payment */ }
    }})
  if (!request.decryption || typeof request.decryption.content_digest !== 'string') throw new TasraError('A session-grant decrypt requires the complete recipient binding')
  let requestId: Hex
  if (!config.allowances?.enabled) requestId = await attempt(false)
  else {
    try { requestId = await attempt(true) }
    catch (error) {
      if (!(error instanceof AllowanceFallback)) throw error
      requestId = await attempt(false)
    }
  }
  const paid = await continueSessionDecrypt(config, requestId)
  return beaconEpoch === undefined ? paid : {...paid, beaconEpoch}
}

/**
 * Resume a journaled session-grant decrypt payment ({@link paidSessionDecrypt}): a `reserving`
 * one is reconciled through the same debit or reservation path (never a second payment).
 * @param config - The original configuration.
 * @param requestId - The decrypt's request identity.
 * @param signal - Cancellation.
 */
export async function resumePaidSessionDecrypt(config: PaidOperationConfig, requestId: Hex, signal?: AbortSignal): Promise<PaidSessionDecrypt> {
  validateConfig(config)
  const record = await config.store.load<OperationRecord>(recordKey(requestId))
  if (!record || record.schema !== 1 || !record.sessionDecrypt) throw new TasraError('No session-grant decrypt journal for this request')
  if (record.phase === 'reserving') await reserve(config, record, signal ?? new AbortController().signal)
  return continueSessionDecrypt(config, requestId)
}

async function continueSessionDecrypt(config: PaidOperationConfig, requestId: Hex): Promise<PaidSessionDecrypt> {
  const d = {...config.deployment}, store = config.store
  let record = await store.load<OperationRecord>(recordKey(requestId))
  if (!record || record.schema !== 1 || !record.sessionDecrypt || prepaidRequestId(record.payment).toLowerCase() !== requestId.toLowerCase()) throw new TasraError('No session-grant decrypt journal for this request')
  if (record.phase === 'reserved') {
    const {policy} = await readClientExecutionPolicy(config.chain.client, {...d, defaultVerificationPolicy: d.defaultVerificationPolicy}, record.payment, record.expected)
    const seed = random32(), signer = createLocalExecutionSigner(seed)
    try {
      const certificate = await createExecutionCertificate({payment: record.payment, policy, publicKey: signer.publicKey, expires: record.payment.expires, creator: config.creator})
      record = await advance(store, requestId, 'reserved', {phase: 'certified', seed: Uint8Array.from(seed), certificate, pollSecret: toHex(random32()).slice(2)})
    } finally { signer.dispose(); seed.fill(0) }
  }
  if (record.phase !== 'certified' || !record.seed || !record.certificate) throw new TasraError(`Session-grant decrypt journal is ${record.phase}, not payable`)
  const signer = createLocalExecutionSigner(record.seed)
  const approveExecution = createKeeperExecutionApprover({client: config.chain.client, deployment: d, payment: record.payment, expected: record.expected,
    certificate: record.certificate, signer, keeperUrl: config.keeperUrl, transportPolicy: {allowLocalHttp: config.allowLocalHttp}})
  const reads = recoveryReads(config, record, record.certificate, signer), route = config.keeperUrl ?? ((url: string) => url)
  const norm = (url: string) => url.replace(/\/$/, '')
  const recoverPartial: PaidSessionDecrypt['recoverPartial'] = async ({nodeUrl, transport, signal}) => {
    const member = record!.contributors?.find(m => norm(route(m.url)) === norm(nodeUrl))
    if (!member) throw new TasraError('Recovery keeper is not an assigned contributor of this decrypt')
    const recovered = await reads.recover({transport, contributorKey: member.publicKey, signal})
    return JSON.parse(recovered.resultJson) as unknown
  }
  return {requestId, payment: structuredClone(record.payment), approveExecution, recoverPartial, dispose: () => signer.dispose()}
}

export async function paidOperationPhase(store: ApplicationStore, requestId: Hex): Promise<PaidOperationJournalPhase | undefined> {
  const record = await store.load<OperationRecord>(recordKey(requestId))
  return record?.phase
}

/** One journaled paid operation, as listed by {@link listPaidOperations}. */
export interface PaidOperationSummary {
  /** Reservation identity (lowercase). */
  requestId: Hex
  /** Journaled phase. */
  phase: PaidOperationJournalPhase
  /** Slot the operation runs on. */
  slot: Hex
  /** Paid action (`eoa-sign` for a FROST sign on an EOA slot). */
  action: PaymentIntentWire['action']
  /** Payment expiry, Unix seconds. */
  expires: number
  /** Gas payer the journal recorded (absent from journals written before payers were recorded). */
  payer?: Address
  /** Set for an abandoned operation: why and the phase it was abandoned from. */
  abandoned?: {reason: string; at: number; phase: Exclude<PaidOperationJournalPhase, 'abandoned'>}
}

/** Options for {@link listPaidOperations}. */
export interface ListPaidOperationsOptions {
  /** Phase or phases to keep, e.g. `['reserving', 'executing']` for work needing attention. Naming `abandoned` includes abandoned operations. */
  phase?: PaidOperationJournalPhase | readonly PaidOperationJournalPhase[]
  /** Include abandoned operations (default false: they are closed and never need attention). */
  includeAbandoned?: boolean
  /**
   * Once per store, index journals written before the index existed. Needs a store that can
   * list its keys (`list`); the built-in memory, file and IndexedDB stores can.
   */
  backfill?: boolean
}

/**
 * List the paid operations journaled in a store, oldest first, without relying on its key scheme.
 * Abandoned operations are left out unless asked for. Operations journaled before this index
 * existed are listed only after a one-time `backfill`; otherwise read them with `paidOperationPhase`.
 * @param store Store the operations were journaled in.
 * @param filter Phases to keep, whether to include abandoned operations, and the one-time backfill.
 */
export async function listPaidOperations(store: ApplicationStore, filter: ListPaidOperationsOptions = {}): Promise<PaidOperationSummary[]> {
  const phases = filter.phase === undefined ? undefined : typeof filter.phase === 'string' ? [filter.phase] : [...filter.phase]
  const abandoned = filter.includeAbandoned === true || phases?.includes('abandoned') === true
  if (filter.backfill) await backfillIndex(store)
  const out: PaidOperationSummary[] = []
  for (const requestId of await loadIndex(store)) {
    const record = await loadRecord(store, requestId as Hex)
    if (!record || (phases && !phases.includes(record.phase)) || (record.phase === 'abandoned' && !abandoned)) continue
    out.push({requestId, phase: record.phase, slot: record.payment.slot, action: record.payment.action, expires: record.payment.expires,
      ...(record.payer ? {payer: record.payer} : {}), ...(record.abandoned ? {abandoned: {...record.abandoned}} : {})})
  }
  return out
}

/** Seconds past payment expiry before an unfinished operation may be abandoned (clock skew between this host, keepers and the chain). */
const ABANDON_EXPIRY_MARGIN_SECS = 120

/** {@link abandonPaidOperation} refused: something could still land under this operation. */
export class PaidOperationAbandonRefusedError extends TasraError {
  constructor(
    /** Reservation identity. */ readonly requestId: Hex,
    /** Journaled phase that blocks abandoning. */ readonly phase: PaidOperationJournalPhase,
    /** Why it cannot be abandoned yet; safe to log. */ reason: string,
    /** Unix seconds from which abandoning succeeds (payment expiry plus a skew margin), when time alone unblocks it. */ readonly notBefore?: number,
  ) {
    super(`Paid operation ${requestId.slice(0, 12)}… cannot be abandoned: ${reason}`, {retryable: notBefore !== undefined})
  }
}

/** Options for {@link abandonPaidOperation}. */
export interface AbandonPaidOperationOptions {
  /** Why the application closes the operation (1..512 characters); journaled and listed. */
  reason: string
}

/** Result of {@link abandonPaidOperation}. */
export interface AbandonedPaidOperation {
  /** Reservation identity (lowercase). */
  requestId: Hex
  /** Phase the operation was abandoned from. */
  from: Exclude<PaidOperationJournalPhase, 'abandoned'>
  /** Journaled reason. */
  reason: string
  /** When it was abandoned, Unix seconds. */
  at: number
}

/** The accountants accept a client-pinned reservation quote block at most this old (accountant `MAX_QUOTE_AGE`). */
const RESERVATION_QUOTE_MAX_AGE_SECS = 30

/**
 * Close a paid operation for good, only when nothing can still land under it: no reservation,
 * session write or keeper work can still be accepted. The journal is kept (phase `abandoned`),
 * left out of {@link listPaidOperations} by default and refused by {@link resumePaidOperation}.
 * Abandoning an already abandoned operation returns its original record.
 *
 * Allowed when the journal proves it:
 * - `reserving` with no reservation ever prepared, once the payment has expired plus the quote
 *   window (MAX_QUOTE_AGE, 30 s) and the skew margin: until then the signed intent the accountants
 *   saw could still be reserved by whoever holds it;
 * - `failed` (the reservation provably never happened);
 * - `executed` (completed and recorded);
 * - `reserved`, `certified`, `authorized` or `executing` once the creator-signed payment has
 *   expired (plus a skew margin): keepers, verifiers and the agent refuse it from then on.
 *   Retained results of an `executing` operation stay readable with {@link recoverPaidOperation}.
 *
 * Refused (PaidOperationAbandonRefusedError) otherwise. A `reserving` operation whose
 * reservation was prepared must first be settled by {@link reconcilePaidOperation} (it becomes
 * `failed` or `reserved`), which also releases the gas payer.
 * @param store Store the operation was journaled in.
 * @param requestId Reservation identity.
 * @param options Reason to journal.
 */
export async function abandonPaidOperation(store: ApplicationStore, requestId: Hex, options: AbandonPaidOperationOptions): Promise<AbandonedPaidOperation> {
  const reason = options?.reason
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 512) throw new TasraError('Abandoning a paid operation needs a reason of 1..512 characters')
  const key = recordKey(requestId)
  return store.withLock(key, async () => {
    const record = await loadRecord(store, requestId)
    if (!record) throw new TasraError('No paid operation journal for this request')
    const id = requestId.toLowerCase() as Hex
    if (record.phase === 'abandoned' && record.abandoned) return {requestId: id, from: record.abandoned.phase, reason: record.abandoned.reason, at: record.abandoned.at}
    const from = record.phase as Exclude<Phase, 'abandoned'>, now = Math.floor(Date.now() / 1000)
    const refuse = (why: string, notBefore?: number) => new PaidOperationAbandonRefusedError(id, from, why, notBefore)
    if (from === 'reserving') {
      // Under this lock no reservation can start (reserve() holds it); a prepared one may have been broadcast.
      if (await loadPaidReservationJournal(store, requestId).catch(() => 'unreadable' as const) !== undefined) {
        throw refuse('its reservation was prepared and may have been sent; reconcile it first')
      }
      // Even with nothing of ours prepared, the signed intent reached the accountants: anyone holding
      // it can still have it reserved at a quote block up to MAX_QUOTE_AGE old, and never once the
      // payment has expired (its quote block cannot postdate the expiry). Wait out both.
      const notBefore = record.payment.expires + RESERVATION_QUOTE_MAX_AGE_SECS + ABANDON_EXPIRY_MARGIN_SECS
      if (now < notBefore) throw refuse('its signed intent can still be reserved by its holder; reconcile it, or abandon it after the payment and quote windows', notBefore)
    } else if (from !== 'failed' && from !== 'executed') {
      const notBefore = record.payment.expires + ABANDON_EXPIRY_MARGIN_SECS
      if (now < notBefore) throw refuse('its payment has not expired, so its reservation, session or keeper work can still be accepted', notBefore)
    }
    const abandoned = {reason, at: now, phase: from}
    await store.save(key, {...record, phase: 'abandoned', abandoned} satisfies OperationRecord)
    return {requestId: id, from, reason, at: now}
  })
}
