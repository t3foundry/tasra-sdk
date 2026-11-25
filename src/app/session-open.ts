// One call to open a decrypt session and one to decrypt in it.
//
// `openDecryptSession` runs the whole opening: a fresh session key, ONE credential presentation in
// session mode at the approved verifier-agent (a KEM decrypt of the first message), the grant's
// verification against each slot's draw as anchored on chain, and its journal. The returned
// session then decrypts any number of messages of the granted slots with no further presentation:
// each request is authorized by the grant and a session-key proof. Nothing is paid; the keepers
// meter the work and the slot's Settlement balance, funded by its owner, settles it later.
//
// The application supplies: the slots, the first message, a key to sign the operation request
// (ANY key: the slot's creator, a delegate, or an unrelated key; the slot's rule decides) and the
// wallet step (`present`). It needs no rule, no rule salt and nothing the slot owner holds.

import type {Hex} from 'viem'
import {TasraError} from '../errors.js'
import {createRegisteredAgentClient, type ApprovedAgentProfile} from '../chain/registeredAgent.js'
import {assertAnchoredWalletRequest, awaitRegisteredVerifierAgentResult, openRegisteredVerifierAgentSession, type RegisteredVerifierAgentSession} from '../chain/registeredOperation.js'
import {fetchRequestObject} from '../oid4vp/request-object.js'
import {b64url} from '../oid4vp/jose.js'
import {selectVerifierCommittee} from '../committee/token.js'
import {hexToBytes} from '../crypto/hex.js'
import type {SessionAgentTransport} from '../chain/sessionControlTransport.js'
import {createSlotDrawReader, readBeaconDrawState, readCurrentBeaconEpoch, type SessionDrawDeployment} from '../chain/sessionDraw.js'
import {readSlotSharing, type SlotSharing} from '../chain/slotSharing.js'
import {resolveAccountantUrls} from '../chain/discovery.js'
import {requireAddress} from '../chain/deployments.js'
import {MAX_BATCH_ITEMS} from '../committee/session-grant.js'
import {createDecryptionRecipient, decryptionBinding, kemContentDigest} from '../crypto/recipient.js'
import type {Ciphertext} from '../crypto/kem.js'
import type {SessionDecryptResult} from '../decryption/session.js'
import type {TypedDataSigner} from '../oid4vp/verifier-agent.js'
import type {PresentationDelegation, SessionPhase} from '../verifier-agent/index.js'
import type {TasraApplication} from './client.js'
import type {ApplicationStore} from './ready-slot.js'
import {decryptBatchInSession, decryptInSession, type SessionDecryptContext} from './session-decrypt.js'
import {acceptSessionGrant, createSessionKey, sessionGrantCreateFragment, SessionEndedError, type GrantedSession, type SessionGrantParams,
  type SessionTransport} from './session-grants.js'

/** What every session of an application shares. */
export interface DecryptSessionConfig {
  /** The application client (`createTasra`): its deployment addresses and chain reader. */
  app: Pick<TasraApplication, 'deployment' | 'chain'>
  /** The independently approved verifier-agent and its guarded transport (`createNodeAgentTransport` / `createBrowserAgentTransport`). */
  agent: {profile: ApprovedAgentProfile; transport: SessionAgentTransport}
  /** Durable private store for the session journal (`createFileStore`, `createIndexedDbStore`; `createMemoryStore` for tests). */
  store: ApplicationStore
  /**
   * The key that signs the operation request. ANY key may open a session: the slot's creator, a
   * creator-signed delegate (with `delegation`), or an unrelated key. The slot's rule decides
   * whether the presented credential is admitted; the verifiers meter this signer's own quota.
   */
  signer: TypedDataSigner
  /** A creator-signed delegation for `signer`, when it has one. */
  delegation?: PresentationDelegation
  /**
   * The wallet step: show the session's `qrPayload` (a QR or deep link) or run the application's
   * own credential wallet against it. Resolve once the wallet has been asked; the result is polled.
   */
  present(session: RegisteredVerifierAgentSession, signal?: AbortSignal): Promise<void>
  /**
   * Accountant origins that serve the verifier-set snapshot artifacts, in preference order.
   * Default: the registered accountants (`resolveAccountantUrls`), read once per opening. A host
   * supplies only leaves; each artifact is verified against the root anchored on chain.
   */
  snapshotHosts?: readonly string[]
  /** The deployment's default verifier policy, for slots that name none on chain. */
  defaultVerificationPolicy?: {committee: number; quorum: number}
  /**
   * keccak256 of a slot's raw rule, when the application holds the rule (e.g. from a slot policy
   * statement). A grant naming another rule for that slot is then refused before use. Optional:
   * without it the rule hash is taken as the drawn quorum signed it.
   */
  ruleHash?(slot: Hex): Uint8Array | undefined
  /** Caller-approved routing of a registered keeper URL (e.g. local Docker hostnames to published loopback ports). */
  keeperUrl?(registeredUrl: string): string
  /** HTTP implementation for keeper requests and snapshot reads; defaults to global fetch. */
  fetchImpl?: typeof fetch
  /**
   * HTTP implementation for reading the session's signed Request Object from the approved agent
   * (Node: `createNodeAgentWalletFetch(session, policy)`). Default: `fetchImpl`, else global fetch.
   */
  walletFetch?(session: RegisteredVerifierAgentSession): typeof fetch
  /** Allow loopback keeper HTTP on a disposable local chain 43112 only. Default false. */
  allowLocalHttp?: boolean
}

/** One KEM ciphertext and the identity (associated data) it was encrypted under. */
export interface SessionCiphertext {
  /** The KEM ciphertext. */
  ciphertext: Ciphertext
  /** Exact identity (associated data) bytes used at encryption. */
  identity: Uint8Array
}

/** What one opening asks for. */
export interface OpenDecryptSessionRequest extends Omit<SessionGrantParams, 'slots'> {
  /** The KEM slots the session may decrypt for (1..16, distinct); `first.slot` must be one of them. */
  slots: Hex[]
  /**
   * The message the opening presentation names: a session opens from a KEM decrypt of one real
   * ciphertext. It is decrypted under the grant like any other message (`decrypt`).
   */
  first: SessionCiphertext & {slot: Hex}
  /** Shown by the wallet as the purpose of the presentation. */
  description?: string
  /** Cancel the opening (the wallet wait included). */
  signal?: AbortSignal
  /** Called on every poll with the phase the UI may show. */
  onPhase?(phase: SessionPhase): void
  /** How long to wait for the wallet and the committee, ms (default 300000). */
  timeoutMs?: number
  /**
   * Present again automatically when the session ends under a message (idle or absolute expiry,
   * a definite refusal, the beacon two epochs past the grant): `present` is called once more and
   * the message continues on the new session. Default false: the end is thrown
   * (`SessionEndedError`) and the application opens a new session when it chooses.
   */
  presentAgainOnEnd?: boolean
  /** Called once when a session ends and a new presentation is needed. */
  onEnded?(error: SessionEndedError): void
}

/** The presentation completed, but no session grant came with it. */
export class SessionGrantUnavailableError extends TasraError {
  constructor(
    /**
     * The agent's `session_*` code (`session_unavailable`: the verifiers keep no issuance records;
     * `session_context_changed`: the beacon ticked before the wallet answered; ...), or
     * `session_grant_missing` when it sent none.
     */
    readonly code: string,
  ) {
    super(`The presentation opened no session grant (${code}); open the session again`, {retryable: code === 'session_context_changed' || code === 'session_verifier_behind'})
    this.name = 'SessionGrantUnavailableError'
  }
}

/** An open decrypt session: decrypt any number of messages of its slots, then revoke it. */
export interface DecryptSession {
  /** The current underlying session (replaced after an automatic re-open). */
  readonly session: GrantedSession
  /**
   * Decrypt one message of a granted slot. Throws `SessionMessageError` when the keepers refuse it
   * and `SessionEndedError` when the session ended (unless `presentAgainOnEnd`).
   */
  decrypt(slot: Hex, message: SessionCiphertext, options?: {signal?: AbortSignal}): Promise<Uint8Array>
  /**
   * Decrypt many messages of ONE granted slot: 64 per keeper request, each request under one
   * session-key proof. One result per message, in order; a refused message never fails the others.
   */
  decryptMany(slot: Hex, messages: readonly SessionCiphertext[], options?: {signal?: AbortSignal}): Promise<SessionDecryptResult[]>
  /** Revoke the session at the verifiers and end it locally (`GrantedSession.revoke`). Afterwards nothing is decrypted and no new presentation is started, whatever `presentAgainOnEnd` says. */
  revoke(): Promise<void>
  /** Stop the background refresh without revoking (the grant runs out on its own). */
  stop(): void
}

/**
 * Open a decrypt session for `request.slots`: one credential presentation, then any number of
 * decrypts with no further wallet step ({@link DecryptSession}). Nothing is paid and nothing
 * owner-held is needed: the slot id, a signing key of the application's own and the holder's
 * credential are enough.
 *
 * Before the wallet step the session's signed Request Object is verified against the verifier
 * draw read from the chain (`assertAnchoredWalletRequest`), so `present` only ever sees a session
 * whose request was signed by the drawn verifier for exactly this operation and session key.
 *
 * Refusals: a slot that is not a ready BLS slot; an agent that is not the approved one; a request
 * that does not match the chain-anchored draw; a wallet or committee refusal (`VerifierAgentSessionError`); a completed presentation without a grant
 * ({@link SessionGrantUnavailableError}); a grant that does not verify against the request, this
 * session key or a slot's anchored draw (`SessionGrantError`).
 * @param config - Application client, approved agent, store, signer and the wallet step.
 * @param request - Slots, the first message and the requested lifetimes.
 */
export async function openDecryptSession(config: DecryptSessionConfig, request: OpenDecryptSessionRequest): Promise<DecryptSession> {
  const {app, agent, store} = config
  const chain = app.chain, chainId = app.deployment.chainId
  const deployment: SessionDrawDeployment = {chainId, keyRegistry: requireAddress(app.deployment.addresses, 'KeyRegistry'),
    beacon: requireAddress(app.deployment.addresses, 'ThresholdRandomBeacon'), verifierSet: requireAddress(app.deployment.addresses, 'VerifierSetRegistry')}
  if (agent.profile.approval.chainId !== chainId) throw new TasraError('The approved verifier-agent serves another chain')
  const slots = request.slots.map(s => s.toLowerCase() as Hex)
  if (!slots.includes(request.first.slot.toLowerCase() as Hex)) throw new TasraError('The first message\'s slot must be one of the session\'s slots')
  const client = createRegisteredAgentClient(chain, {profiles: [agent.profile], transport: agent.transport})
  let draws: ReturnType<typeof createSlotDrawReader> | undefined
  const drawReader = async () => draws ??= createSlotDrawReader({client: chain.client, deployment,
    snapshotHosts: config.snapshotHosts ?? await resolveAccountantUrls(chain),
    ...(config.defaultVerificationPolicy ? {defaultVerificationPolicy: config.defaultVerificationPolicy} : {}), ...(config.fetchImpl ? {fetch: config.fetchImpl} : {})})
  const transport: SessionTransport = {chainId, agent,
    trust: async (slot, epoch) => {
      const t = await (await drawReader())(slot, epoch)
      const ruleHash = config.ruleHash?.(slot)
      return {set: t.set, committee: t.committee, quorum: t.quorum, seed: t.seed, ...(ruleHash ? {ruleHash} : {})}
    }}
  // Per slot: the sharing of its current epoch and version, read again when either moves.
  const sharings = new Map<string, SlotSharing>()
  const sharingOf = async (slot: Hex, signal?: AbortSignal): Promise<SlotSharing> => {
    const key = slot.toLowerCase(), kept = sharings.get(key)
    const canonical = await chain.readers.keyRegistry.getKeySlot(slot)
    if (kept && kept.epoch === Number(canonical.epoch) && kept.committeeVersion === Number(canonical.committeeVersion)) return kept
    const fresh = await readSlotSharing(chain, slot, {...(config.keeperUrl ? {keeperUrl: config.keeperUrl} : {}), ...(config.fetchImpl ? {fetchImpl: config.fetchImpl} : {}),
      ...(config.allowLocalHttp ? {allowLocalHttp: true} : {}), ...(signal ? {signal} : {})})
    if (fresh.chainId !== chainId) throw new TasraError('RPC chain does not match the application deployment')
    sharings.set(key, fresh)
    return fresh
  }

  /** One presentation in session mode for `first`; the accepted, started session. */
  const open = async (first: SessionCiphertext & {slot: Hex}, signal?: AbortSignal): Promise<GrantedSession> => {
    signal?.throwIfAborted()
    const sharing = await sharingOf(first.slot, signal)
    const key = await createSessionKey()
    try {
      const fragment = sessionGrantCreateFragment(key, {slots, ...(request.accessTtlSecs !== undefined ? {accessTtlSecs: request.accessTtlSecs} : {}),
        ...(request.idleTimeoutSecs !== undefined ? {idleTimeoutSecs: request.idleTimeoutSecs} : {}),
        ...(request.absoluteTtlSecs !== undefined ? {absoluteTtlSecs: request.absoluteTtlSecs} : {})})
      // The opening presentation names a real decryption: this ciphertext, sealed to a recipient of its own.
      const recipient = await createDecryptionRecipient()
      const binding = decryptionBinding(kemContentDigest(first.ciphertext, first.identity), sharing.epoch, recipient)
      const session = await openRegisteredVerifierAgentSession(client, {chainId, keyRegistry: deployment.keyRegistry, slotId: first.slot, action: 'decrypt', ...binding,
        description: request.description ?? 'Open a Tasra decrypt session', signer: config.signer,
        ...(config.delegation ? {delegation: config.delegation} : {}), sessionGrant: fragment.session_grant, ...(signal ? {signal} : {})})
      signal?.throwIfAborted()
      // Before anything is presented or shown: the signed Request Object is checked against the
      // session's draw AS THE CHAIN GIVES IT (epoch, seed, snapshot, policy, recomputed committee,
      // authenticated member keys), under the key of the member drawn to sign it, with the nonce
      // derived locally for this session key.
      const status = await session.poll(signal)
      const epoch = status.bindingPreimage?.epoch
      if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 0) throw new TasraError('The session reports no verifier draw to check its request against')
      const trust = await (await drawReader())(first.slot, BigInt(epoch), signal)
      const seed = hexToBytes(trust.draw.verification_seed)
      const drawn = selectVerifierCommittee(hexToBytes(trust.draw.slot), trust.draw.verification_epoch, seed, trust.draw.verification_registry_size, trust.draw.verification_committee)
      const signerKey = trust.set.pubkeys.get(drawn[seed[0]! % drawn.length]!)
      if (!signerKey) throw new TasraError('The verifier drawn to sign the request is not authenticated')
      const walletRequest = await fetchRequestObject(session.requestUri, {fetchImpl: config.walletFetch?.(session) ?? config.fetchImpl ?? fetch,
        resolveKey: () => Promise.resolve({kty: 'OKP' as const, crv: 'Ed25519' as const, x: b64url(signerKey)}), ...(signal ? {signal} : {})})
      assertAnchoredWalletRequest(session, walletRequest, status, trust)
      signal?.throwIfAborted()
      await config.present(session, signal)
      signal?.throwIfAborted()
      const result = await awaitRegisteredVerifierAgentResult(session, {...(signal ? {signal} : {}), ...(request.onPhase ? {onPhase: request.onPhase} : {}),
        ...(request.timeoutMs !== undefined ? {timeoutMs: request.timeoutMs} : {})})
      if (!result.sessionGrant?.grant) throw new SessionGrantUnavailableError(result.sessionGrant?.error ?? 'session_grant_missing')
      const granted = await acceptSessionGrant({store, transport, key,
        beacon: {latestEpoch: () => readCurrentBeaconEpoch(chain.client, deployment), drawState: () => readBeaconDrawState(chain.client, deployment)},
        ...(request.onEnded ? {onEnded: request.onEnded} : {})}, fragment, result.sessionGrant.grant)
      granted.start()
      return granted
    } catch (error) {
      key.dispose()
      throw error
    }
  }

  let current = await open(request.first, request.signal)
  // An application's own revoke closes this object for good: it never presents again by itself.
  let revoked = false
  const context = async (slot: Hex, first: SessionCiphertext, signal?: AbortSignal): Promise<{context: SessionDecryptContext; epoch: number}> => {
    if (revoked) throw new SessionEndedError('session_revoked', 'Session revoked; open a new session')
    if (!slots.includes(slot.toLowerCase() as Hex)) throw new TasraError('Slot is not named by this session')
    const sharing = await sharingOf(slot, signal)
    return {epoch: sharing.epoch, context: {session: current, slot,
      keepers: {nodeUrls: sharing.nodeUrls, chainId, verifyingShares: sharing.verifyingShares, threshold: sharing.threshold, ...(config.fetchImpl ? {fetchImpl: config.fetchImpl} : {})},
      verifierProofs: async (s, epoch) => (await (await drawReader())(s, epoch)).verifierProofs,
      latestBeaconEpoch: () => readCurrentBeaconEpoch(chain.client, deployment, {fresh: true}),
      ...(request.presentAgainOnEnd ? {reopen: () => open({...first, slot}, signal)} : {}),
      ...(signal ? {signal} : {})}}
  }
  return {
    get session() { return current },
    async decrypt(slot, message, options = {}) {
      const {context: shared, epoch} = await context(slot, message, options.signal)
      const result = await decryptInSession({...shared, message: {ciphertext: message.ciphertext, identity: message.identity, recipient: await createDecryptionRecipient(), ciphertextEpoch: epoch}})
      current = result.session
      return result.plaintext
    },
    async decryptMany(slot, messages, options = {}) {
      const out: SessionDecryptResult[] = []
      for (let offset = 0; offset < messages.length; offset += MAX_BATCH_ITEMS) {
        const batch = messages.slice(offset, offset + MAX_BATCH_ITEMS)
        const {context: shared, epoch} = await context(slot, batch[0]!, options.signal)
        const result = await decryptBatchInSession({...shared, messages: await Promise.all(batch.map(async m =>
          ({ciphertext: m.ciphertext, identity: m.identity, recipient: await createDecryptionRecipient(), ciphertextEpoch: epoch})))})
        current = result.session
        out.push(...result.results)
      }
      return out
    },
    revoke: () => { revoked = true; return current.revoke() },
    stop: () => current.stop(),
  }
}
