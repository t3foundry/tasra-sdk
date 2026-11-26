import {hexToBytes} from '../crypto/hex.js'
import {presentationOperationTypedData, verifierAgentResult, type OperationInput, type TypedDataSigner, type VerifierAgentResult} from '../oid4vp/verifier-agent.js'
import {b64url, decodeJson, verifyCompactJws} from '../oid4vp/jose.js'
import {selectVerifierCommittee} from '../committee/token.js'
import type {SlotDrawTrust} from './sessionDraw.js'
import type {VerifiedRequestObject} from '../oid4vp/request-object.js'
import type {SessionStatusResult} from '../verifier-agent/index.js'
import {requestHash, vpNonceBound} from '../oid4vp/binding.js'
import {VerifierAgentSessionError, nextPollDelay, type PresentationDelegation, type PresentationOperation, type WaitOpts} from '../verifier-agent/index.js'
import {type RegisteredAgentSession, type createRegisteredAgentClient} from './registeredAgent.js'
import {sessionKeyThumbprint, type SessionGrantRequestWire} from '../committee/session-grant.js'

/**
 * Authenticated provider session bound to one signed operation and request hash.
 */
export interface RegisteredVerifierAgentSession extends RegisteredAgentSession {
  /**
   * Signed operation associated with this session.
   */
  readonly operation: PresentationOperation
  /**
   * Defensive copy of the operation request hash.
   */
  readonly requestHash: Uint8Array
  /**
   * Authenticated provider endpoint retained for this session.
   */
  readonly verifierAgentUrl: string
}

/**
 * Sign once, authenticate an explicitly approved provider, and retain its pinned poll closure.
 * @param client Registered agent client with independently approved providers.
 * @param opts Exact operation, authorizing signer and optional delegation or cancellation.
 */
export async function openRegisteredVerifierAgentSession(
  client: Pick<ReturnType<typeof createRegisteredAgentClient>, 'createSession'>,
  opts: OperationInput & {
    /** The key that opens the session: the slot creator's, a delegate's (with `delegation`) or any other key (the slot's rule decides). */
    signer: TypedDataSigner
    /** Optional presentation delegation. */
    delegation?: PresentationDelegation
    /** First approved provider index to try. */
    profileIndex?: number
    /** Cancellation of pending authorization work. */
    signal?: AbortSignal
    /** Session mode (KEM decrypt only): also open a session grant for this fresh session key (`sessionGrantCreateFragment`). */
    sessionGrant?: SessionGrantRequestWire
  },
): Promise<RegisteredVerifierAgentSession> {
  opts.signal?.throwIfAborted()
  const {typedData, operation, messageHex, payloadDigest} = presentationOperationTypedData(opts)
  const expectedHash = requestHash(operation.chain_id, hexToBytes(operation.slot_id), opts.action, payloadDigest)
  const operationSig = await opts.signer.signTypedData(typedData)
  opts.signal?.throwIfAborted()
  const session = await client.createSession({operation, operationSig, messageHex, delegation: opts.delegation,
    ...(opts.decryption ? {decryption: structuredClone(opts.decryption)} : {}),
    ...(opts.sessionGrant ? {sessionGrant: structuredClone(opts.sessionGrant)} : {})}, {profileIndex: opts.profileIndex, signal: opts.signal})
  return Object.freeze({...session, operation: Object.freeze(operation), verifierAgentUrl: session.profile.endpoint,
    get recovery() { return session.recovery },
    get requestHash() { return expectedHash.slice() },
  })
}

/**
 * Poll the original authenticated session only; no URL reconstruction or provider failover.
 * @param session Previously opened authenticated session.
 * @param opts Polling cadence, deadline, cancellation and phase notifications.
 */
export async function awaitRegisteredVerifierAgentResult(
  session: RegisteredVerifierAgentSession,
  opts: {intervalMs?: number; timeoutMs?: number} & WaitOpts = {},
): Promise<VerifierAgentResult> {
  const interval = opts.intervalMs ?? 2000, timeout = opts.timeoutMs ?? 300_000
  const max = opts.maxIntervalMs ?? interval * 4
  if (![interval, timeout, max].every(n => Number.isSafeInteger(n) && n > 0 && n <= 2_147_483_647) || max < interval) throw new Error('Invalid polling interval or timeout')
  const controller = new AbortController()
  const cancelled = () => controller.abort(new VerifierAgentSessionError('cancelled', session.sessionId, 'polling cancelled'))
  opts.signal?.addEventListener('abort', cancelled, {once: true})
  if (opts.signal?.aborted) cancelled()
  const timer = setTimeout(() => controller.abort(new VerifierAgentSessionError('timeout', session.sessionId, `still pending after ${timeout} ms`)), timeout)
  let delay = 0
  let onAbort = () => {}
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(controller.signal.reason)
    controller.signal.addEventListener('abort', onAbort, {once: true})
  })
  try {
    controller.signal.throwIfAborted()
    return await Promise.race([(async () => {
      for (;;) {
        controller.signal.throwIfAborted()
        // Identity and policy failures propagate immediately; never disclose a bearer to another provider.
        const result = await session.poll(controller.signal)
        controller.signal.throwIfAborted()
        opts.onPhase?.(result.phase)
        if (result.status !== 'pending') return verifierAgentResult(session, result)
        delay = nextPollDelay(delay, interval, max, opts.random)
        await new Promise<void>(resolve => {
          const done = () => { clearTimeout(wait); controller.signal.removeEventListener('abort', done); resolve() }
          const wait = setTimeout(done, delay)
          controller.signal.addEventListener('abort', done, {once: true})
          if (controller.signal.aborted) done()
        })
      }
    })(), aborted])
  } finally {
    clearTimeout(timer)
    controller.signal.removeEventListener('abort', onAbort)
    opts.signal?.removeEventListener('abort', cancelled)
    controller.abort()
  }
}

/**
 * Bind the wallet's signed request to the operation and authenticated session before disclosure.
 * @param session Authenticated session bound to the signed operation.
 * @param ro Verified wallet request object whose claims will be presented.
 * @param status Session status carrying the operation binding preimage.
 */
export function assertRegisteredWalletRequest(session: RegisteredVerifierAgentSession, ro: VerifiedRequestObject, status: SessionStatusResult): void {
  const claims = ro.claims, op = session.operation, binding = status.bindingPreimage
  if (status.status === 'failed') throw new VerifierAgentSessionError('refused', session.sessionId, status.error ?? 'Session failed')
  if (!binding || claims.client_id !== session.profile.clientId || claims.response_uri !== session.profile.endpoint + '/v1/response?session=' + session.sessionId ||
      claims.response_mode !== 'direct_post.jwt' || ro.signerDid !== session.profile.clientId.replace(/^decentralized_identifier:/, '')) throw new Error('Wallet request is outside the approved session')
  const signedOperation = binding.operation as Record<string, unknown> | undefined
  if (!signedOperation || Object.entries(op).some(([k, v]) => signedOperation[k] !== v)) throw new Error('Wallet operation differs from the creator authorization')
  const integer = (key: string): number => {
    const value = binding[key]
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid wallet nonce context')
    return value
  }
  const hex = (key: string) => {
    const value = binding[key]
    if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value)) throw new Error('Invalid wallet nonce hash')
    return hexToBytes(value)
  }
  // Session mode: the nonce binds THIS client's fresh session key, so a holder never presents for a
  // nonce that authorizes another key. A plain session's nonce names no key.
  const thumbprint = session.sessionGrantRequest ? sessionKeyThumbprint(session.sessionGrantRequest.session_key) : undefined
  const named = binding.session_key_thumbprint
  if (thumbprint ? typeof named !== 'string' || named.toLowerCase() !== '0x' + [...thumbprint].map(b => b.toString(16).padStart(2, '0')).join('') : named != null) {
    throw new Error('Wallet request names another session key')
  }
  const expected = vpNonceBound(session.requestHash, hex('random'), {epoch: integer('epoch'), snapshotRoot: hex('snapshot_root'),
    registrySize: integer('registry_size'), committee: integer('committee_count'), quorum: integer('quorum'), operationExp: op.exp}, thumbprint)
  if (claims.nonce !== expected || binding.nonce !== expected) throw new Error('Wallet nonce does not bind the opened operation')
  if (!Number.isSafeInteger(claims.exp) || Number(claims.exp) > op.exp || Number(claims.exp) < Math.floor(Date.now() / 1000)) throw new Error('Wallet request expiry exceeds its authorization')
  // VERIFY WHEN PRESENT - DO not REQUIRE. Requiring it made this wallet the only one that
  //    could complete a presentation: a JAR carrying `transaction_data` is silently dropped by
  //    Hovi (it fetches the Request Object, shows it, and never POSTs a response), so a
  //    deployment had to choose one wallet. The verifier already takes this position -
  //    `[committee] require_transaction_data` defaults to false and is deliberately not forced
  //    by production posture - and the network configuration composes JARs without it.
  //
  //    What the operation is still bound by when the entry is absent: `request_hash` is
  //    keccak256(domain || chain_id || slot_id || action || payload_digest), and the nonce check
  //    above proves this JAR was composed for exactly that request hash and `op.exp`. So four
  //    of the five fields compared below are already bound, twice over - the equality check
  //    against `binding.operation` near the top of this function is the other.
  //
  //    What is not bound without it: `description`, the human-readable string the holder is
  //      shown. Nothing else. A deployment that needs the holder's displayed text to be
  //      cryptographically tied to the creator's authorization must set
  //      `[committee] transaction_data = true` AND accept that only wallets which understand
  //      the entry can be used.
  //
  //    When the entry IS present the checks below are unchanged and still strict: exactly one
  //    entry, the right type, and every field equal to the authorized operation.
  if (claims.transaction_data !== undefined) {
    if (!Array.isArray(claims.transaction_data) || claims.transaction_data.length !== 1) throw new Error('Wallet request has no unique transaction data')
    const td = decodeJson<Record<string, unknown>>(claims.transaction_data[0]!)
    if (td.type !== 'keykeeper-op/v1' || ['chain_id', 'slot_id', 'action', 'payload_digest', 'description'].some(k => td[k] !== op[k as keyof PresentationOperation])) throw new Error('Wallet transaction data differs from the creator authorization')
  }
}

/**
 * As {@link assertRegisteredWalletRequest}, and re-anchored on the session's own verifier draw as
 * the CHAIN gives it, before anything is presented or a QR is shown. Nothing the agent reports
 * about its draw is taken on trust:
 * - the draw (`readSlotVerifierDraw` / `createSlotDrawReader`, for the slot and the epoch the
 *   session names) is the chain's: the epoch is the beacon's current or previous one, the seed is
 *   `seedAt(epoch)`, the root and size are the verifier set's `snapshotAt(epoch)`, the committee
 *   and quorum the slot's policy; the session's reported context must equal it field for field;
 * - the committee is recomputed locally from those values and must be the one the session names,
 *   with every drawn member's key proven against the anchored root (`trust.witnesses`);
 * - the Request Object must verify under the authenticated key of the member drawn to sign it,
 *   whatever key its DID document served;
 * - the nonce is derived locally from that anchored context (and, in session mode, this client's
 *   session key).
 * @param session Authenticated session bound to the signed operation.
 * @param ro Wallet request object as fetched from the session's `requestUri`.
 * @param status Session status carrying the operation binding preimage.
 * @param trust The slot's draw at the session's epoch, read from the chain with authenticated members.
 */
export function assertAnchoredWalletRequest(session: RegisteredVerifierAgentSession, ro: VerifiedRequestObject, status: SessionStatusResult, trust: SlotDrawTrust): void {
  assertRegisteredWalletRequest(session, ro, status)
  const binding = status.bindingPreimage!, draw = trust.draw, lower = (v: unknown) => typeof v === 'string' ? v.toLowerCase() : undefined
  if (draw.chain_id !== session.operation.chain_id || draw.slot.toLowerCase() !== session.operation.slot_id.toLowerCase()) throw new Error('Anchored draw is for another chain or slot')
  if (binding.epoch !== draw.verification_epoch || lower(binding.seed) !== draw.verification_seed.toLowerCase()
    || lower(binding.snapshot_root) !== draw.verification_root.toLowerCase() || binding.registry_size !== draw.verification_registry_size
    || binding.committee_count !== draw.verification_committee || binding.quorum !== draw.verification_quorum) throw new Error('Session draw differs from the draw anchored on chain')
  const seed = hexToBytes(draw.verification_seed)
  const drawn = selectVerifierCommittee(hexToBytes(draw.slot), draw.verification_epoch, seed, draw.verification_registry_size, draw.verification_committee)
  const named = binding.drawn
  if (!Array.isArray(named) || named.length !== drawn.length || named.some((index, i) => index !== drawn[i])) throw new Error('Session committee is not the draw recomputed from the chain')
  if (trust.witnesses.length !== drawn.length || drawn.some(index => !trust.set.pubkeys.has(index))) throw new Error('Drawn verifiers are not all authenticated against the anchored root')
  const signer = drawn[seed[0]! % drawn.length]!
  if (binding.jar_signer_index !== signer) throw new Error('Session names another verifier to sign the request')
  const key = trust.set.pubkeys.get(signer)!
  try { verifyCompactJws(ro.jwt, {kty: 'OKP', crv: 'Ed25519', x: b64url(key)}) }
  catch { throw new Error('Wallet request is not signed by the verifier drawn to sign it') }
}
