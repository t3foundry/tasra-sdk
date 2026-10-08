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
import {requirePrepaidSlot, type BillingModeDetector} from '../chain/billing.js'
import {discoverPaidOperationContext, readClientExecutionPolicy, type ExpectedPaidOperation, type PaidContextDeployment,
  type PaidKeeperEndpoint, type PaidVerifierWitness} from '../chain/prepaid.js'
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
import {drivePaidSession, waitForPaidSnapshot, PaidSessionRecoveryError, type PaidSessionHolder} from './paid-session.js'
import {PaidAgentControlError} from '../chain/registeredPaidAgent.js'
import {VerifierAgentSessionError} from '../verifier-agent/index.js'
import type {ApplicationStore} from './ready-slot.js'
import {withDedicatedPayer} from './payer-queue.js'
import {createExecutionCertificate, createLocalExecutionSigner, type ExecutionCertificate, type ExecutionStage} from '../committee/execution.js'
import type {KeeperExecutionApprover} from '../committee/keeperExecution.js'
import {paymentIntentHash, paymentIntentTypedData, paymentSessionCommitment, prepaidRequestId, type PaymentIntentWire} from '../committee/payment.js'
import type {CompoundTokenWire} from '../committee/token.js'
import {canonicalize} from '../auth/oid4vp.js'
import {presentationOperationTypedData, verifierAgentResult, type PresentationOperation} from '../oid4vp/verifier-agent.js'
import {requestHash, type CommitteeAction} from '../oid4vp/binding.js'
import type {VerifiedRequestObject} from '../oid4vp/request-object.js'
import type {VerifierProof} from '../committee/client.js'
import {TasraError} from '../errors.js'
import {base64Decode} from '../crypto/envelope.js'
import type {IbeExtractionPartial} from '../committee/client.js'
import {HEX32, RECORD_KEY, RECORD_PREFIX, paidRecordKey as recordKey} from './paid-keys.js'

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
  /** Caller-approved keeper route map (registered URL → reachable URL). */
  keeperUrl?: (registeredUrl: string) => string
  /** Cached billing detector for this deployment; a fresh read is used when absent. */
  billing?: BillingModeDetector
  /** Fetch used for verifier snapshot artifacts (defaults to global fetch). */
  fetch?: typeof fetch
  /** Longest wait for the current epoch's snapshots to be anchored, ms (default 180000, max 300000). */
  snapshotWaitMs?: number
  /** Poll interval while waiting on the agent, ms (default 1000). Agent Retry-After hints take precedence. */
  pollIntervalMs?: number
}

/** The one operation to authorize and how its holder presents. */
export interface PaidOperationRequest {
  /** Slot to operate on. */
  slot: Hex
  /** Committee action and payload: `message` for sign, `identity` for ibe-extract, `payloadDigest` for decrypt/dual-approve. */
  operation: {action: CommitteeAction; message?: Uint8Array; identity?: string; payloadDigest?: Uint8Array; ttlSecs?: number; description?: string}
  /** The slot's original DCQL rule and salt; checked against its on-chain commitment. */
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
   * Receive the reservation identity as soon as it is derived, before witnesses are fetched or
   * anything is reserved, to link this run to its payment. A throw stops the operation before any
   * spending. Until the journal is written (just before reservation) `paidOperationPhase` returns
   * undefined for it.
   */
  onRequestId?(requestId: Hex): void | Promise<void>
}

/** A verified, paid committee authorization for exactly one keeper execution. */
export interface PaidOperation {
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
  /** Read the keeper's retained result after an uncertain execution. Performs no new work. */
  recover(options: {transport: KeeperRecoveryTransport; stage?: Extract<ExecutionStage, 'coordinator' | 'contributor'>; signal?: AbortSignal}): Promise<RecoveredKeeperExecution>
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
  /** Caller-approved guarded keeper recovery transport. */
  transport: KeeperRecoveryTransport
  /** Cancellation for the whole recovery; each keeper read also has its own 60-second deadline. */
  signal?: AbortSignal
  /** Contributors read at once, 1..16 (default 4). No new read starts after the threshold is met. */
  concurrency?: number
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
  if (error instanceof PaidSessionRecoveryError) code = 'session-write-uncertain'
  else if (error instanceof VerifierAgentSessionError) {
    if (error.kind === 'refused' || (error.httpStatus !== undefined && refusal(error.httpStatus))) code = 'session-refused'
  } else if (error instanceof PaidAgentControlError && refusal(error.httpStatus)) code = 'session-refused'
  if (code !== 'session-refused' && code !== 'session-write-uncertain' && expired(payment)) code = 'payment-expired'
  return new PaidOperationRecoveryError(requestId, 'session', error, {code})
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
  payment: PaymentIntentWire
  expected: ExpectedPaidOperation
  params: {operation: PresentationOperation; operationSig: Hex; messageHex: string; random: Hex}
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
  grant?: {compound_token: CompoundTokenWire; verifierProofs: VerifierProof[]}
}

const INDEX_KEY = 'paid-op-index'
/** `backfilled` marks a store whose pre-index journals were indexed once. */
interface OperationIndex { schema: 1; ids: Hex[]; backfilled?: true }
async function loadIndexRecord(store: ApplicationStore): Promise<OperationIndex> {
  const index = await store.load<OperationIndex>(INDEX_KEY)
  if (index === undefined) return {schema: 1, ids: []}
  if (!index || index.schema !== 1 || !Array.isArray(index.ids) || index.ids.some(id => typeof id !== 'string' || !HEX32.test(id))
    || (index.backfilled !== undefined && index.backfilled !== true)) throw new TasraError('Invalid paid operation index')
  return index
}
const loadIndex = async (store: ApplicationStore) => (await loadIndexRecord(store)).ids
async function indexOperation(store: ApplicationStore, requestId: Hex): Promise<void> {
  await store.withLock(INDEX_KEY, async () => {
    const index = await loadIndexRecord(store), id = requestId.toLowerCase() as Hex
    if (!index.ids.includes(id)) await store.save(INDEX_KEY, {...index, ids: [...index.ids, id]} satisfies OperationIndex)
  })
}
/** Index journals written before the index existed, once per store (by payment expiry). */
async function backfillIndex(store: ApplicationStore): Promise<void> {
  if ((await loadIndexRecord(store)).backfilled) return
  if (typeof store.list !== 'function') throw new TasraError('Backfilling the paid operation index needs a store that can list its keys')
  const list = store.list.bind(store)
  await store.withLock(INDEX_KEY, async () => {
    const index = await loadIndexRecord(store)
    if (index.backfilled) return
    const found: {id: Hex; expires: number}[] = []
    for (const key of await list(RECORD_PREFIX)) {
      if (!RECORD_KEY.test(key)) continue
      const id = `0x${key.slice(RECORD_PREFIX.length)}` as Hex
      if (index.ids.includes(id)) continue
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
}

/** Decode a commitment-verified retained IBE result into a combinable partial. */
function ibePartial(resultJson: string, nodeUrl: string): IbeExtractionPartial {
  const d = JSON.parse(resultJson) as {identifier: number; extraction_share: string; verifying_share: string; epoch: number; key_slot_id: string}
  const value = base64Decode(d.extraction_share), verifying = base64Decode(d.verifying_share)
  if (value.length !== 48 || verifying.length < 96 || !Number.isSafeInteger(d.identifier) || d.identifier < 1 || d.identifier > 65535) throw new Error('Invalid recovered IBE partial encoding')
  return {keySlotId: d.key_slot_id, identifier: d.identifier, value, verifyingShareG2: verifying.slice(0, 96), epoch: d.epoch, nodeUrl}
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
  const d = {...config.deployment}, client = config.chain.client, signal = request.signal ?? new AbortController().signal
  const slot = request.slot
  if (!HEX32.test(slot)) throw new TasraError('Invalid paid operation slot')
  if (config.billing) await config.billing.requirePrepaid(slot); else await requirePrepaidSlot(client, d, slot)
  const readiness = AbortSignal.any([signal, AbortSignal.timeout(config.snapshotWaitMs ?? 180_000)])
  const context = await waitForPaidSnapshot(() => discoverPaidOperationContext(client, d, slot,
    {allowLocalHttp: config.allowLocalHttp, defaultVerificationPolicy: d.defaultVerificationPolicy, coordinator: request.coordinator}),
  readiness, () => sleep(1_000, readiness))
  if (context.creator.toLowerCase() !== config.creator.address.toLowerCase()) throw new TasraError('Paid operations are signed by the slot creator; this signer is not it')
  // The rule the holder will see must be the one the slot committed to on chain.
  const original = await client.readContract({address: d.keyRegistry, abi: keyRegistryAbi, functionName: 'getKeySlot', args: [slot], blockNumber: context.blockNumber})
  if (original.ruleCommitment.toLowerCase() !== ruleCommitment(request.rule.salt, request.rule.rule).toLowerCase()) throw new TasraError('Supplied rule or salt differs from the slot commitment')
  if ((await client.getBlock({blockNumber: context.blockNumber})).hash !== context.blockHash) throw new TasraError('Rule observation reorganized')
  const canonicalRule = canonicalize(request.rule.rule)
  const ttlSecs = request.operation.ttlSecs ?? 600
  if (!Number.isSafeInteger(ttlSecs) || ttlSecs <= 0 || ttlSecs > 3600) throw new TasraError('Paid operation lifetime must be 1..3600 seconds')
  const built = presentationOperationTypedData({action: request.operation.action, message: request.operation.message, identity: request.operation.identity,
    payloadDigest: request.operation.payloadDigest, chainId: d.chainId, keyRegistry: d.keyRegistry, slotId: slot,
    description: request.operation.description ?? 'Paid Tasra operation', nowSecs: Math.floor(Date.now() / 1000), ttlSecs})
  const randomBytes = random32(), random = toHex(randomBytes); randomBytes.fill(0)
  const operationSig = await config.creator.signTypedData(built.typedData)
  const unsigned = {...context.intentFields, action: request.operation.action === 'sign' && context.mode === 2 ? 'eoa-sign' as const : request.operation.action,
    payload_digest: toHex(built.payloadDigest), session_commitment: paymentSessionCommitment(random, config.agent.profile.clientId, built.operation.exp),
    nonce: toHex(random32()), max_cost: config.limits.maxCost.toString(), expires: built.operation.exp}
  const payment: PaymentIntentWire = {...unsigned, signature: await config.creator.signTypedData(paymentIntentTypedData(unsigned))}
  const expected: ExpectedPaidOperation = {slot, action: payment.action, payloadDigest: payment.payload_digest}
  const requestId = prepaidRequestId(payment)
  await request.onRequestId?.(requestId)
  signal.throwIfAborted()
  const {witnesses} = await fetchDrawnVerifierWitnesses(config.accountantUrls, payment, d.verifierSet,
    {signal: AbortSignal.any([signal, AbortSignal.timeout(Math.min(150_000, ttlSecs * 1000))]), fetch: config.fetch})
  const record: OperationRecord = {schema: 1, phase: 'reserving', payment, expected, members: witnesses, rule: canonicalRule, ruleSalt: request.rule.salt,
    params: {operation: built.operation, operationSig, messageHex: built.messageHex, random}, coordinator: context.coordinator, contributors: context.contributors,
    action: request.operation.action, payloadDigest: toHex(built.payloadDigest), payer: config.gasPayer.account.address}
  const key = recordKey(requestId)
  await config.store.withLock(key, async () => {
    if (await config.store.load(key) !== undefined) throw new TasraError('Paid operation already journaled; resume it')
    await config.store.save(key, record)
  })
  await indexOperation(config.store, requestId)
  await reserve(config, record, signal)
  return continueOperation(config, requestId, request.holder, signal, request.observeRequest)
}

class NoLongerReserving extends Error {}

async function reserve(config: PaidOperationConfig, record: OperationRecord, signal: AbortSignal): Promise<void> {
  const d = {...config.deployment}, requestId = prepaidRequestId(record.payment), key = recordKey(requestId)
  if (signal.aborted) throw abortedError(requestId, 'reservation', record.payment, signal, signal.reason)
  try {
    // Under the journal's lock, so abandonPaidOperation cannot close it while a reservation runs.
    await config.store.withLock(key, async () => {
      if ((await config.store.load<OperationRecord>(key))?.phase !== 'reserving') throw new NoLongerReserving()
      await withDedicatedPayer(`${d.chainId}-${config.gasPayer.account.address.toLowerCase()}`, () => reserveApplicationPayment(config.chain.client, config.gasPayer, d,
        record.payment, record.expected, {store: config.store, session: {random: record.params.random, audience: config.agent.profile.clientId},
          accountantUrls: config.accountantUrls, allowLocalHttp: config.allowLocalHttp, maxGas: config.limits.maxGas, maxGasPrice: config.limits.maxGasPrice, signal}))
    })
  } catch (error) {
    if (error instanceof NoLongerReserving) throw new TasraError('Paid operation was closed before its reservation; it is not reserved again')
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

async function advance(store: ApplicationStore, requestId: Hex, from: Phase | Phase[], patch: Partial<OperationRecord>): Promise<OperationRecord> {
  const key = recordKey(requestId)
  return store.withLock(key, async () => {
    const current = await store.load<OperationRecord>(key)
    if (!current || current.schema !== 1 || !(Array.isArray(from) ? from : [from]).includes(current.phase)) throw new TasraError('Paid operation journal changed concurrently')
    const next = {...current, ...patch}
    await store.save(key, next)
    return next
  })
}

async function continueOperation(config: PaidOperationConfig, requestId: Hex, holder: PaidSessionHolder | undefined, signal: AbortSignal,
  observeRequest?: (request: VerifiedRequestObject) => void | Promise<void>): Promise<PaidOperation> {
  const d = {...config.deployment}, client = config.chain.client, store = config.store
  let record = await store.load<OperationRecord>(recordKey(requestId))
  if (!record || record.schema !== 1 || prepaidRequestId(record.payment).toLowerCase() !== requestId.toLowerCase()) throw new TasraError('No paid operation journal for this request')
  if (signal.aborted && (record.phase === 'reserved' || record.phase === 'certified')) throw abortedError(requestId, 'session', record.payment, signal, signal.reason)
  if (record.phase === 'reserved') {
    const {policy} = await readClientExecutionPolicy(client, {...d, defaultVerificationPolicy: d.defaultVerificationPolicy}, record.payment, record.expected)
    const seed = random32(), signer = createLocalExecutionSigner(seed)
    try {
      const certificate = await createExecutionCertificate({payment: record.payment, policy, publicKey: signer.publicKey, expires: record.payment.expires,
        creator: config.creator})
      record = await advance(store, requestId, 'reserved', {phase: 'certified', seed: seed.slice(), certificate, pollSecret: toHex(random32()).slice(2)})
    } finally { signer.dispose(); seed.fill(0) }
  }
  if (!record.seed || !record.certificate || !record.pollSecret) throw new TasraError('Paid operation journal lacks its execution consent')
  const signer = createLocalExecutionSigner(record.seed)
  try {
    if (record.phase === 'certified') {
      if (!holder) throw new TasraError('Resuming a paid session requires its holder strategy')
      const params: PaidAgentSessionParams = {operation: record.params.operation, operationSig: record.params.operationSig,
        messageHex: record.params.messageHex, payment: record.payment, random: record.params.random}
      let session
      try {
        session = await prepareRegisteredPaidSession(config.chain, {profile: config.agent.profile, deployment: {...d, defaultVerificationPolicy: d.defaultVerificationPolicy},
          transport: config.agent.transport, members: record.members, ruleHash: keccak256(toHex(record.rule)), dcqlQuery: JSON.parse(record.rule) as Record<string, unknown>},
        params, {certificate: record.certificate, signer, pollSecret: record.pollSecret, signal})
      } catch (error) {
        if (signal.aborted) throw abortedError(requestId, 'session', record.payment, signal, error)
        throw error
      }
      const interval = config.pollIntervalMs ?? 1_000
      let result
      try {
        result = await drivePaidSession({session, members: record.members, store, signal, holder, observeRequest, resume: true,
          wait: hint => sleep(Math.min(Math.max(hint ?? interval, 10), 60_000), signal)})
      } catch (error) {
        // A journaled session write with an unknown outcome stays uncertain, abort or not.
        if (signal.aborted && !(error instanceof PaidSessionRecoveryError)) throw abortedError(requestId, 'session', record.payment, signal, error)
        throw sessionFailure(requestId, record.payment, error)
      }
      const grant = verifierAgentResult({sessionId: session.sessionId, paymentHash: paymentIntentHash(record.payment),
        requestHash: requestHash(d.chainId, hexToBytes(record.payment.slot), record.action, hexToBytes(record.payloadDigest))}, result)
      if (!grant.verifierProofs?.length) throw new TasraError('Paid grant lacks anchored verifier proofs')
      record = await advance(store, requestId, 'certified', {phase: 'authorized', grant: {compound_token: grant.token, verifierProofs: grant.verifierProofs}})
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
  const operation: PaidOperation = {
    requestId, payment: structuredClone(record.payment), coordinatorUrl: route(record.coordinator.url),
    compound_token: structuredClone(grant.compound_token), verifierProofs: structuredClone(grant.verifierProofs),
    verifier_proofs: grant.verifierProofs.map(p => ({verifier_index: p.verifierIndex, operator: p.operator, pubkey: p.pubkey, proof: [...p.proof]})),
    approveExecution,
    async execute<R>(work: (operation: PaidOperation) => Promise<R>): Promise<R> {
      // Journal before sending: a lost reply leaves `executing`, which only recovery may read.
      await advance(store, requestId, 'authorized', {phase: 'executing'}).catch((error: unknown) => {
        throw new PaidOperationRecoveryError(requestId, 'execution', error)
      })
      let result: R
      try { result = await work(operation) }
      catch (error) { throw new PaidOperationRecoveryError(requestId, 'execution', error) }
      await advance(store, requestId, 'executing', {phase: 'executed'})
      return result
    },
    ...recoveryReads(config, record, certificate, signer),
    dispose: () => signer.dispose(),
  }
  return Object.freeze(operation)
}

/** The read-only recovery half of a handle: retained keeper results, never new work. */
function recoveryReads(config: PaidOperationConfig, record: OperationRecord, certificate: ExecutionCertificate,
  signer: ReturnType<typeof createLocalExecutionSigner>): Pick<PaidOperation, 'recover' | 'recoverIbePartials'> {
  const d = {...config.deployment}, route = config.keeperUrl ?? ((url: string) => url)
  return {
    recover(options) {
      return recoverKeeperExecution({client: config.chain.client, deployment: d, payment: record.payment, expected: record.expected,
        keeper: {...record.coordinator, url: route(record.coordinator.url)}, target: {stage: options.stage ?? 'coordinator', executionKey: certificate.execution_key},
        signer, transport: options.transport, transportPolicy: {allowLocalHttp: config.allowLocalHttp}, signal: options.signal})
    },
    async recoverIbePartials(options) {
      if (record.payment.action !== 'ibe-extract') throw new TasraError('IBE partial recovery applies to an ibe-extract operation only')
      // Journals written before contributors were recorded (SDK before dfafff3) can only use `recover`.
      if (!record.contributors?.length) throw new TasraError('Paid operation journal lacks its assigned contributors')
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
            partials.push({keeper, partial: ibePartial(recovered.resultJson, keeper.url), recovered})
          } catch (error) {
            options.signal?.throwIfAborted()
            failures.push({operator: keeper.operator, message: error instanceof Error ? error.message : 'unreadable retained result'})
          }
        }
      }
      await Promise.all(Array.from({length: Math.min(concurrency, queue.length)}, read))
      if (partials.length < threshold) throw new TasraError(`Recovered ${partials.length} of ${threshold} required IBE partials; ${failures.length} contributor(s) failed`)
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
    ...recoveryReads(config, record, record.certificate, signer), dispose: () => signer.dispose()})
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
  if (record.phase === 'reserving') {
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
    const record = await loadRecord(store, requestId)
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

/**
 * Close a paid operation for good, only when nothing can still land under it: no reservation,
 * session write or keeper work can still be accepted. The journal is kept (phase `abandoned`),
 * left out of {@link listPaidOperations} by default and refused by {@link resumePaidOperation}.
 * Abandoning an already abandoned operation returns its original record.
 *
 * Allowed when the journal proves it:
 * - `reserving` with no reservation ever prepared (nothing was sent);
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
    } else if (from !== 'failed' && from !== 'executed') {
      const notBefore = record.payment.expires + ABANDON_EXPIRY_MARGIN_SECS
      if (now < notBefore) throw refuse('its payment has not expired, so its reservation, session or keeper work can still be accepted', notBefore)
    }
    const abandoned = {reason, at: now, phase: from}
    await store.save(key, {...record, phase: 'abandoned', abandoned} satisfies OperationRecord)
    return {requestId: id, from, reason, at: now}
  })
}
