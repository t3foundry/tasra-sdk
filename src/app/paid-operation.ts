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
  /** Erase the local execution signer. */
  dispose(): void
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
 */
export type PaidOperationErrorCode = 'reservation-refused' | 'reservation-uncertain' | 'reservation-failed'
  | 'session-interrupted' | 'session-refused' | 'session-write-uncertain' | 'payment-expired' | 'execution-uncertain'

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

/**
 * Journaled progress of one paid operation. `failed` is terminal: the original reservation
 * provably never happened and the operation must not be reserved again.
 */
export type PaidOperationJournalPhase = 'reserving' | 'reserved' | 'certified' | 'authorized' | 'executing' | 'executed' | 'failed'
type Phase = PaidOperationJournalPhase
interface OperationRecord {
  schema: 1
  phase: Phase
  failure?: {reason: string}
  payment: PaymentIntentWire
  expected: ExpectedPaidOperation
  params: {operation: PresentationOperation; operationSig: Hex; messageHex: string; random: Hex}
  members: PaidVerifierWitness[]
  rule: string
  ruleSalt: Hex
  coordinator: PaidKeeperEndpoint
  action: CommitteeAction
  payloadDigest: Hex
  seed?: Uint8Array
  certificate?: ExecutionCertificate
  pollSecret?: string
  grant?: {compound_token: CompoundTokenWire; verifierProofs: VerifierProof[]}
}

const HEX32 = /^0x[0-9a-f]{64}$/i
const recordKey = (requestId: Hex) => {
  if (!HEX32.test(requestId)) throw new TasraError('Invalid paid operation request ID')
  return 'paid-op-' + requestId.slice(2).toLowerCase()
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
  const {witnesses} = await fetchDrawnVerifierWitnesses(config.accountantUrls, payment, d.verifierSet,
    {signal: AbortSignal.any([signal, AbortSignal.timeout(Math.min(150_000, ttlSecs * 1000))]), fetch: config.fetch})
  const record: OperationRecord = {schema: 1, phase: 'reserving', payment, expected, members: witnesses, rule: canonicalRule, ruleSalt: request.rule.salt,
    params: {operation: built.operation, operationSig, messageHex: built.messageHex, random}, coordinator: context.coordinator,
    action: request.operation.action, payloadDigest: toHex(built.payloadDigest)}
  const key = recordKey(requestId)
  await config.store.withLock(key, async () => {
    if (await config.store.load(key) !== undefined) throw new TasraError('Paid operation already journaled; resume it')
    await config.store.save(key, record)
  })
  await reserve(config, record, signal)
  return continueOperation(config, requestId, request.holder, signal, request.observeRequest)
}

async function reserve(config: PaidOperationConfig, record: OperationRecord, signal: AbortSignal): Promise<void> {
  const d = {...config.deployment}, requestId = prepaidRequestId(record.payment)
  signal.throwIfAborted()
  try {
    await withDedicatedPayer(`${d.chainId}-${config.gasPayer.account.address.toLowerCase()}`, () => reserveApplicationPayment(config.chain.client, config.gasPayer, d,
      record.payment, record.expected, {store: config.store, session: {random: record.params.random, audience: config.agent.profile.clientId},
        accountantUrls: config.accountantUrls, allowLocalHttp: config.allowLocalHttp, maxGas: config.limits.maxGas, maxGasPrice: config.limits.maxGasPrice}))
  } catch (error) {
    const journal = await loadPaidReservationJournal(config.store, requestId).catch(() => 'unreadable' as const)
    // Another request holds the payer and this one journaled nothing: refuse without uncertainty.
    if (error instanceof ApplicationPayerRecoveryError && journal === undefined) throw error
    // No preparation was journaled, and none is ever broadcast without one: nothing was sent.
    if (journal === undefined) throw new PaidOperationRecoveryError(requestId, 'reservation', error,
      expired(record.payment) ? {code: 'reservation-refused', resumable: false} : {code: 'reservation-refused'})
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
      const session = await prepareRegisteredPaidSession(config.chain, {profile: config.agent.profile, deployment: {...d, defaultVerificationPolicy: d.defaultVerificationPolicy},
        transport: config.agent.transport, members: record.members, ruleHash: keccak256(toHex(record.rule)), dcqlQuery: JSON.parse(record.rule) as Record<string, unknown>},
      params, {certificate: record.certificate, signer, pollSecret: record.pollSecret, signal})
      const interval = config.pollIntervalMs ?? 1_000
      let result
      try {
        result = await drivePaidSession({session, members: record.members, store, signal, holder, observeRequest, resume: true,
          wait: hint => sleep(Math.min(Math.max(hint ?? interval, 10), 60_000), signal)})
      } catch (error) {
        if (signal.aborted) throw error
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
    recover(options) {
      return recoverKeeperExecution({client: config.chain.client, deployment: d, payment: record.payment, expected: record.expected,
        keeper: {...record.coordinator, url: route(record.coordinator.url)}, target: {stage: options.stage ?? 'coordinator', executionKey: certificate.execution_key},
        signer, transport: options.transport, transportPolicy: {allowLocalHttp: config.allowLocalHttp}, signal: options.signal})
    },
    dispose: () => signer.dispose(),
  }
  return Object.freeze(operation)
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

/** Read-only reconciliation result of {@link reconcilePaidOperation}. */
export interface PaidOperationStatus {
  /** Reservation identity. */
  requestId: Hex
  /** Journaled phase after reconciliation. */
  phase: PaidOperationJournalPhase
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
    {payer: config.gasPayer.account.address, confirmations: options.confirmations})
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

const NEXT: Record<Phase, PaidOperationNextStep> = {reserving: 'wait', reserved: 'resume', certified: 'resume', authorized: 'resume', executing: 'recover', executed: 'done', failed: 'abandon'}

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
  if (record.phase !== 'reserving') {
    return {requestId, phase: record.phase, reservation: record.phase === 'failed' ? 'not-reserved' : 'reserved', payerLocked: false, next: NEXT[record.phase],
      ...(record.failure ? {reason: record.failure.reason} : {})}
  }
  const {status, phase} = await reconcileReservation(config, requestId, record, options)
  return {requestId, phase, reservation: status.state, payerLocked: status.payerLocked,
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
  if (record.phase === 'reserving') {
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
