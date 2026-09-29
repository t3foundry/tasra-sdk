import type {Hex} from 'viem'
import {isOauthFormat, validate as validateRule} from '../auth/oid4vp.js'
import type {TasraApplication} from './client.js'
import {prepareSlot, createPreparedSlot, type SlotCreationJournal} from './creation.js'
import {createTasraWriteClient, ruleCommitment, type CreateSlotArgs, type WriteClientWalletConfig} from '../chain/write.js'
import {provisionRule} from '../chain/provisionRule.js'
import {requireRule} from '../chain/ruleInput.js'
import {resolveSlotKeeperUrls} from '../chain/discovery.js'
import {TasraError} from '../errors.js'
import type {TypedDataSigner} from '../oid4vp/verifier-agent.js'

/** Stable recovery categories for a durable named slot creation. */
export type ApplicationSlotRecoveryCode =
  'SAVED_INTENT_MISMATCH' | 'SLOT_STATE_MISMATCH' | 'VERIFIER_POLICY_OUTCOME_UNKNOWN' |
  'VERIFIER_POLICY_RECEIPT_PENDING' | 'VERIFIER_POLICY_REVERTED' | 'VERIFIER_POLICY_MISMATCH'

/** A creation state that requires inspection or reconciliation before resuming. */
export class ApplicationSlotRecoveryError extends TasraError {
  /** Recovery category; never infer it from the message. */
  readonly code: ApplicationSlotRecoveryCode
  /** Stable name of the private creation journal. */
  readonly recoveryName: string
  /** Public slot ID, if the creation journal already contains one. */
  readonly slotId?: Hex
  /** Known verifier-policy transaction hash, if available. */
  readonly transactionHash?: Hex

  constructor(code: ApplicationSlotRecoveryCode, recoveryName: string, message: string, details: {slotId?: Hex; transactionHash?: Hex; cause?: unknown} = {}) {
    super(message, {cause: details.cause})
    this.code = code
    this.recoveryName = recoveryName
    this.slotId = details.slotId
    this.transactionHash = details.transactionHash
  }
}

/** Implementations must save atomically and exclusively lock across processes/tabs. */
export interface ApplicationStore {
  /**
   * Load a saved value, or return undefined when the key does not exist.
   */
  load<T>(key: string): Promise<T | undefined>
  /**
   * Atomically persist private state before resolving.
   */
  save(key: string, value: unknown): Promise<void>
  /**
   * Exclusively serialize work for the key across all participating processes or tabs.
   */
  withLock<T>(key: string, operation: () => Promise<T>): Promise<T>
}
/**
 * Named slot intent with an authorization rule, key threshold and verifier quorum.
 */
export interface CreateApplicationSlot {
  /** Stable recovery name. Reusing it resumes the same intent, never creates another slot. */
  name: string
  /**
   * Key capability: Ethereum account, Ed25519 signing or identity encryption.
   */
  mode: 'ecdsa' | 'frost' | 'bls'
  /** Clear authorization rule. Its salted commitment is stored on-chain. */
  policy: string
  /** Authorization family; defaults to credential-wallet OID4VP. */
  authType?: 'oid4vp' | 'oauth'
  /**
   * Minimum signing or extraction shares k out of n assigned keepers.
   */
  threshold: {k: number; n: number}
  /**
   * Verifier committee size and required authorization quorum.
   */
  verifiers: {committee: number; quorum: number}
  /**
   * Keeper selection tags; defaults to keykeeper.
   */
  tags?: string[]
  /**
   * Optional amendment authority installed atomically during creation.
   */
  rulePolicy?: CreateSlotArgs['rulePolicy']
}
/**
 * Private creation journal tracking rule delivery and verifier-policy installation.
 */
export interface ReadySlotJournal {
  /**
   * Ready-slot journal schema version.
   */
  schemaVersion: 1
  /**
   * Original named application creation request.
   */
  request: CreateApplicationSlot
  /**
   * Private slot creation intent and its transaction history.
   */
  creation: SlotCreationJournal
  /**
   * Whether this journal previously completed rule delivery.
   */
  provisioned?: boolean
  /**
   * Durable verifier-policy transaction phase and hash.
   */
  verifierPolicy?: {phase: 'submitting' | 'submitted' | 'confirmed'; hash?: Hex}
}
/** Public milestone emitted while a named slot is created or resumed. */
export interface SlotCreationProgress {
  /** Creation stage. */
  step: 'commit' | 'reveal' | 'key_generation' | 'rule_provisioning' | 'verifier_policy' | 'ready'
  /** Current stage state. Transaction stages use submitting, submitted and confirmed. */
  phase: 'waiting' | 'submitting' | 'submitted' | 'confirmed' | 'complete'
  /** Public slot ID shared by every milestone. */
  slotId: Hex
  /** Public transaction hash when known. */
  transactionHash?: Hex
}
/**
 * Creator wallet, durable storage and network controls for creating a ready slot.
 */
export interface CreateApplicationSlotOptions {
  /**
   * Creator wallet bound to the intended account and chain.
   */
  wallet: WriteClientWalletConfig['wallet']
  /**
   * Creator EIP-712 signer used to authorize rule delivery.
   */
  signer: TypedDataSigner
  /**
   * Private atomic store used to persist and lock the named creation intent.
   */
  store: ApplicationStore
  /**
   * Explicit routing callback for registered keeper endpoints.
   */
  keeperUrl?: (url: string) => string
  /**
   * HTTP implementation used to deliver rules to keepers.
   */
  fetchImpl?: typeof fetch
  /**
   * Cancel pending work without reversing submitted transactions.
   */
  signal?: AbortSignal
  /**
   * Cooperative cancellation deadline in milliseconds; defaults to 300000. Checked between stages; in-flight RPC requests and wallet prompts may outlast it. A resumed verifier-policy receipt wait uses this duration independently.
   */
  timeoutMs?: number
  /** Observational progress callback. Callback failures do not interrupt creation. */
  onProgress?: (progress: SlotCreationProgress) => void | Promise<void>
}

function validate(request: CreateApplicationSlot) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(request.name)) throw new Error('Invalid slot recovery name')
  if (!['ecdsa', 'frost', 'bls'].includes(request.mode)) throw new Error('Unsupported application slot mode')
  const {committee, quorum} = request.verifiers
  if (!Number.isSafeInteger(committee) || !Number.isSafeInteger(quorum) || quorum < 1 || committee < quorum || committee > 65535) throw new Error('Invalid verifier threshold')
  const authType = request.authType === undefined ? 'oid4vp' : request.authType
  if (authType !== 'oid4vp' && authType !== 'oauth') throw new Error('Unsupported slot authorization family')
  const query = validateRule(request.policy)
  if (query.credentials.some(credential => isOauthFormat(credential.format) !== (authType === 'oauth'))) {
    throw new Error('Every policy query must match the slot authorization family')
  }
}
function sameRequest(a: CreateApplicationSlot, b: CreateApplicationSlot) {
  return a.name === b.name && a.mode === b.mode && a.policy === b.policy &&
    (a.authType ?? 'oid4vp') === (b.authType ?? 'oid4vp') &&
    a.threshold.k === b.threshold.k && a.threshold.n === b.threshold.n &&
    a.verifiers.committee === b.verifiers.committee && a.verifiers.quorum === b.verifiers.quorum &&
    JSON.stringify(a.tags ?? ['keykeeper']) === JSON.stringify(b.tags ?? ['keykeeper']) &&
    JSON.stringify(a.rulePolicy) === JSON.stringify(b.rulePolicy)
}
function pause(ms: number, signal: AbortSignal) {
  signal.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    const aborted = () => {clearTimeout(timer); reject(signal.reason)}
    const timer = setTimeout(() => {signal.removeEventListener('abort', aborted); resolve()}, ms)
    signal.addEventListener('abort', aborted, {once: true})
  })
}

/**
 * Durable creation, key readiness, rule delivery and explicit verifier policy in one operation.
 * @param app Application client connected to the target deployment.
 * @param input Stable named creation intent with rule and threshold policies.
 * @param options Creator wallet, signer, durable store and cancellation controls.
 */
export async function createApplicationSlot(app: TasraApplication, input: CreateApplicationSlot, options: CreateApplicationSlotOptions) {
  options = {...options}
  const request = structuredClone(input)
  validate(request)
  const authType = request.authType ?? 'oid4vp'
  if (options.signer.address.toLowerCase() !== options.wallet.account.address.toLowerCase()) throw new Error('Provisioning signer differs from the creation wallet')
  const timeoutMs = options.timeoutMs ?? 300_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('Invalid slot creation timeout')
  const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(options.signal ? [options.signal] : [])])
  signal.throwIfAborted()
  const key = `slot-${request.name}`
  return options.store.withLock(key, async () => {
    signal.throwIfAborted()
    const {deployment, chain} = app
    const mode: CreateSlotArgs['mode'] = request.mode === 'ecdsa' ? 'tecdsa' : request.mode
    const intent = {rule: request.policy, mode, ...request.threshold, tags: request.tags, rulePolicy: request.rulePolicy, authType}
    // Validation also runs on resume, before a writer is allowed to act.
    prepareSlot(deployment, options.wallet.account.address, intent)
    let journal = await options.store.load<ReadySlotJournal>(key)
    if (journal) {
      if (journal.schemaVersion !== 1 || !sameRequest(journal.request, request)) throw new ApplicationSlotRecoveryError('SAVED_INTENT_MISMATCH', request.name, 'Saved slot intent differs; use its original request to resume', {slotId: journal.creation?.intent?.slotId})
      const saved = journal.creation
      if (saved.creator.toLowerCase() !== options.wallet.account.address.toLowerCase() ||
          saved.deployment.chainId !== deployment.chainId || saved.deployment.rpcUrl !== deployment.rpcUrl ||
          ['KeyRegistry', 'NodeRegistry'].some(name => saved.deployment.addresses[name]?.toLowerCase() !== deployment.addresses[name]?.toLowerCase()) ||
          requireRule(saved.intent) !== request.policy || saved.intent.authType !== authType || saved.intent.mode !== mode || saved.intent.k !== request.threshold.k || saved.intent.n !== request.threshold.n) {
        throw new ApplicationSlotRecoveryError('SAVED_INTENT_MISMATCH', request.name, 'Saved slot belongs to a different creator, deployment or policy', {slotId: saved.intent.slotId})
      }
    } else {
      journal = {schemaVersion: 1, request, creation: prepareSlot(deployment, options.wallet.account.address, intent)}
    }
    const state = journal
    const save = () => options.store.save(key, structuredClone(state))
    const slotId = state.creation.intent.slotId
    const progress = (event: SlotCreationProgress) => {
      try { void Promise.resolve(options.onProgress?.(event)).catch(() => {}) } catch { /* Progress is observational. */ }
    }
    await save()
    if (!(await app.check()).ready) throw new Error('Deployment registries are not ready')
    if (options.wallet.chain.id !== deployment.chainId) throw new Error('Wallet chain differs from deployment')
    if (!state.creation.result) {
      state.creation = await createPreparedSlot(state.creation, {wallet: options.wallet, persist: async creation => {
        const previous = state.creation
        state.creation = creation
        await save()
        for (const step of ['commit', 'reveal'] as const) {
          const transaction = creation[step]
          if (transaction && (transaction.phase !== previous[step]?.phase || transaction.hash !== previous[step]?.hash)) {
            progress({step, phase: transaction.phase, slotId, ...(transaction.hash ? {transactionHash: transaction.hash} : {})})
          }
        }
      }, options: {signal, maxWaitMs: timeoutMs}})
      await save()
    }
    let slot = await app.slots.get(slotId)
    if (!slot.ready) progress({step: 'key_generation', phase: 'waiting', slotId})
    while (!slot.ready) {await pause(1000, signal); slot = await app.slots.get(slotId)}
    if (slot.mode !== ({ecdsa: 2, frost: 0, bls: 1}[request.mode])) throw new ApplicationSlotRecoveryError('SLOT_STATE_MISMATCH', request.name, 'Created slot has an unexpected mode', {slotId})
    const assertIntent = async () => {
      const current = await chain.readers.keyRegistry.getKeySlot(slotId)
      if (!current.exists || current.cancelled || current.creator.toLowerCase() !== state.creation.creator.toLowerCase() ||
          current.ruleCommitment.toLowerCase() !== ruleCommitment(state.creation.intent.ruleSalt, request.policy).toLowerCase() ||
          Number(current.threshold.k) !== request.threshold.k || Number(current.threshold.n) !== request.threshold.n ||
          Number(current.auth) !== (authType === 'oauth' ? 2 : 1) || Number(current.mode) !== slot.mode || Number(current.epoch) !== slot.epoch || current.publicKey !== slot.publicKey) {
        throw new ApplicationSlotRecoveryError('SLOT_STATE_MISMATCH', request.name, 'On-chain slot changed or differs from the saved creation intent', {slotId})
      }
    }
    await assertIntent()
    progress({step: 'key_generation', phase: 'complete', slotId})
    // Rule delivery is idempotent and covers the current committee, including after resharing.
    {
      progress({step: 'rule_provisioning', phase: 'waiting', slotId})
      const keeperUrls = (await resolveSlotKeeperUrls(chain, slotId)).map(options.keeperUrl ?? (url => url))
      await provisionRule(chain, {slotId, rule: requireRule(state.creation.intent), ruleSalt: state.creation.intent.ruleSalt,
        signer: options.signer, keeperUrls, fetchImpl: options.fetchImpl, signal})
      state.provisioned = true
      await save()
      progress({step: 'rule_provisioning', phase: 'complete', slotId})
    }
    signal.throwIfAborted()
    if (state.verifierPolicy?.phase === 'submitting' && !state.verifierPolicy.hash) throw new ApplicationSlotRecoveryError('VERIFIER_POLICY_OUTCOME_UNKNOWN', request.name, `Verifier policy outcome unknown for ${slotId}; reconcile its transaction hash before resuming`, {slotId})
    if (state.verifierPolicy?.hash && state.verifierPolicy.phase !== 'confirmed') {
      progress({step: 'verifier_policy', phase: 'submitted', slotId, transactionHash: state.verifierPolicy.hash})
      const receipt = await chain.client.waitForTransactionReceipt({hash: state.verifierPolicy.hash, timeout: timeoutMs})
      if (receipt.status !== 'success') throw new ApplicationSlotRecoveryError('VERIFIER_POLICY_REVERTED', request.name, 'Verifier policy transaction reverted; reconcile before resuming', {slotId, transactionHash: state.verifierPolicy.hash})
      state.verifierPolicy.phase = 'confirmed'
      await save()
      progress({step: 'verifier_policy', phase: 'confirmed', slotId, transactionHash: state.verifierPolicy.hash})
    }
    if (!state.verifierPolicy) {
      const writer = createTasraWriteClient({...deployment, wallet: options.wallet})
      const currentPolicy = () => state.verifierPolicy
      try {
        await writer.setVerifierPolicy(slotId, request.verifiers.committee, request.verifiers.quorum, async event => {
          if (event.phase === 'submitting') signal.throwIfAborted()
          state.verifierPolicy = event
          await save()
          progress({step: 'verifier_policy', phase: event.phase, slotId, ...(event.hash ? {transactionHash: event.hash} : {})})
        })
      } catch (cause) {
        const policy = currentPolicy()
        if (policy?.phase === 'submitting' && !policy.hash) {
          throw new ApplicationSlotRecoveryError('VERIFIER_POLICY_OUTCOME_UNKNOWN', request.name, `Verifier policy outcome unknown for ${slotId}; reconcile its transaction hash before resuming`, {slotId, cause})
        }
        if (policy?.phase === 'submitted' && policy.hash) {
          throw new ApplicationSlotRecoveryError('VERIFIER_POLICY_RECEIPT_PENDING', request.name, `Verifier policy receipt pending for ${slotId}; resume the saved transaction hash`, {slotId, transactionHash: policy.hash, cause})
        }
        throw cause
      }
    }
    const [committee, quorum] = await chain.readers.keyRegistry.verifierPolicy(slotId)
    if (committee !== request.verifiers.committee || quorum !== request.verifiers.quorum) throw new ApplicationSlotRecoveryError('VERIFIER_POLICY_MISMATCH', request.name, 'On-chain verifier policy differs from the requested policy', {slotId, transactionHash: state.verifierPolicy?.hash})
    await assertIntent()
    progress({step: 'ready', phase: 'complete', slotId})
    return slotId
  })
}
