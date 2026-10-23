import {authenticateApprovedService, validateServiceEndpoint, type ServiceDiscoveryTransport} from './serviceIdentity.js'
import type {TasraChainClient} from './client.js'
import type {ServiceApproval, ServiceRecord} from './services.js'
import {parseVerifierAgentSessionStatus, type CreateSessionParams, type CreateSessionResult, type SessionStatusResult} from '../verifier-agent/index.js'
import {sessionPaymentFields} from '../verifier-agent/payment.js'
import {paymentIntentHash, type PaymentIntentWire} from '../committee/payment.js'

/**
 * Guarded HTTPS transport for service discovery and verifier-agent sessions.
 */
export interface AgentTransport extends ServiceDiscoveryTransport {
  /** Same socket/TLS policy as discovery; bearer is allowed only on a session GET. */
  agentRequest(url: string, options: {body?: Uint8Array; bearer?: string; maxBytes: number; signal: AbortSignal}): Promise<Uint8Array>
  /**
   * Optional session-creation exchange that also returns a 503 with its status and Retry-After, so
   * the agent's one retryable pre-creation refusal can be retried. Without it creation never retries.
   */
  agentExchange?(url: string, options: {body: Uint8Array; maxBytes: number; signal: AbortSignal}): Promise<AgentHttpResponse>
}

/** A session-creation reply read with its status; the body stays bounded by the caller. */
export interface AgentHttpResponse {
  /** HTTP status of the reply. */
  status: number
  /** Bounded reply bytes. */
  body: Uint8Array
  /** Parsed Retry-After, in milliseconds, when the agent sent one. */
  retryAfterMs?: number
}

/**
 * The verifier-agent's fixed reason for an unpaid creation refused because the current and
 * previous epoch have no anchored verifier snapshot yet. It is answered before anything is stored
 * or charged, with Retry-After; it is the only creation refusal that is retried.
 */
export const SNAPSHOT_PENDING_REASON = 'verifier snapshot not yet anchored for the current or previous epoch; nothing was created - retry this request'
const SNAPSHOT_RETRY_ATTEMPTS = 5, SNAPSHOT_RETRY_MAX_WAIT_MS = 10_000

/** Both the application and committee verifiers must independently approve this verifier-agent identity. */
export interface ApprovedAgentProfile {
  /**
   * Independently approved service registry identity and revision.
   */
  approval: ServiceApproval
  /**
   * Expected canonical verifier-agent endpoint.
   */
  endpoint: string
  /**
   * Approved OID4VP client identifier derived from the agent DID.
   */
  clientId: string
}

/**
 * Session pinned to its authenticated provider, with a closure for polling that provider.
 */
export interface RegisteredAgentSession extends Readonly<CreateSessionResult> {
  /** Expected paid-token commitment, fixed before the session POST. */
  readonly paymentHash?: string
  /** Defensive copy of the fixed spending intent, when this session is prepaid. */
  readonly payment?: PaymentIntentWire
  /** Presentation random bound by the spending intent to the approved audience. */
  readonly random?: string
  /**
   * Provider identity and endpoint pinned when the session was opened.
   */
  readonly profile: Readonly<ApprovedAgentProfile>
  /** Private JSON checkpoint for unpaid sessions. Save before wallet delivery; paid sessions use payment recovery. */
  readonly unpaidRecovery?: UnpaidAgentSessionRecovery
  /** Poll only the original endpoint/profile. A provider change requires a fresh wallet session. */
  poll(signal?: AbortSignal): Promise<SessionStatusResult>
}

/** Private application state for restoring the original unpaid session, never a provider approval. */
export interface UnpaidAgentSessionRecovery extends CreateSessionResult {
  /** Checkpoint format. */
  version: 1
  /** Creation identity, compared with independent approvals and the live registry. */
  serviceProfile: {
    chainId: number; registry: string; serviceId: string; serviceType: 1
    owner: string; revision: string; manifestHash: string; authKey: string
    endpoint: string; clientId: string
  }
  /** Pending owner at creation; a later transfer stops recovery before bearer delivery. */
  pendingOwner: string
}

/**
 * Session creation may have reached the provider, so automatic retry is unsafe.
 */
export class AgentSessionCreationUnknownError extends Error {
  constructor(
    /** Approved verifier-agent profile whose session creation outcome is unknown. */ readonly profile: Readonly<ApprovedAgentProfile>,
    /** Retained payment commitment; reconcile it before another paid session attempt. */ readonly paymentHash?: string,
    /** The transport failure behind the uncertainty, kept so the reason can be diagnosed. */ cause?: unknown,
  ) {
    super((paymentHash
      ? 'Paid agent session creation has an uncertain result; retain the original payment and reconcile it before another session attempt.'
      : 'Agent session creation has an uncertain result; explicitly open a fresh wallet session to retry. No session secret or presentation is transferred.')
      + (cause instanceof Error ? ` Transport: ${cause.message}` : ''), {cause})
    this.name = 'AgentSessionCreationUnknownError'
  }
}

function decode(bytes: Uint8Array, limit: number): Record<string, unknown> {
  if (bytes.length > limit) throw new Error('Agent response too large')
  const value: unknown = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid agent reply')
  return value as Record<string, unknown>
}

async function bounded<T>(signal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  const timer = setTimeout(() => controller.abort(new Error('Agent request timed out')), 60_000)
  let abort = () => {}
  try {
    combined.throwIfAborted()
    return await Promise.race([work(combined), new Promise<never>((_, reject) => {
      abort = () => reject(combined.reason)
      combined.addEventListener('abort', abort, {once: true})
    })])
  } finally { clearTimeout(timer); combined.removeEventListener('abort', abort); controller.abort() }
}

function pin(profile: ApprovedAgentProfile, record: Pick<ServiceRecord, 'authKey'>) {
  const a = profile.approval
  return {chainId: a.chainId, registry: a.registry.toLowerCase(), serviceId: a.serviceId.toLowerCase(), serviceType: 1 as const,
    owner: a.owner.toLowerCase(), revision: a.revision.toString(), manifestHash: a.manifestHash.toLowerCase(),
    authKey: record.authKey.toLowerCase(), endpoint: profile.endpoint, clientId: profile.clientId}
}

function equalPin(actual: unknown, expected: ReturnType<typeof pin>): boolean {
  if (!actual || typeof actual !== 'object') return false
  return Object.entries(expected).every(([key, value]) => (actual as Record<string, unknown>)[key] === value)
}

function metadata(data: Record<string, unknown>, profile: ApprovedAgentProfile, expected: ReturnType<typeof pin>): CreateSessionResult {
  if (!equalPin(data.service_profile, expected) || typeof data.session_id !== 'string' || !/^[0-9a-f]{64}$/.test(data.session_id)
    || typeof data.poll_secret !== 'string' || !/^[0-9a-f]{64}$/.test(data.poll_secret)) throw new Error('Agent session profile or identifiers mismatch')
  const requestUri = `${profile.endpoint}/v1/request/${data.session_id}`
  if (data.request_uri !== requestUri || typeof data.qr_payload !== 'string' || !data.qr_payload.startsWith('openid4vp://?')) throw new Error('Agent wallet request destination mismatch')
  const qr = new URL(data.qr_payload)
  if (qr.searchParams.get('client_id') !== profile.clientId || qr.searchParams.get('request_uri') !== requestUri || [...qr.searchParams.keys()].length !== 2) throw new Error('Agent wallet audience or request URI mismatch')
  return {sessionId: data.session_id, pollSecret: data.poll_secret, requestUri, qrPayload: data.qr_payload}
}

function retainedSession(chain: TasraChainClient, transport: AgentTransport, profile: ApprovedAgentProfile,
  expected: ReturnType<typeof pin>, pendingOwner: string, input: CreateSessionResult, paid: ReturnType<typeof sessionPaymentFields>): RegisteredAgentSession {
  const {sessionId, pollSecret, requestUri, qrPayload} = input
  expected = Object.freeze({...expected})
  pendingOwner = pendingOwner.toLowerCase()
  const paymentHash = paid.payment && paymentIntentHash(paid.payment)
  const checkpoint: UnpaidAgentSessionRecovery = {version: 1, sessionId, pollSecret, requestUri, qrPayload, serviceProfile: expected, pendingOwner}
  // Routing, identity and bearer live in this closure; callers receive defensive checkpoints.
  return Object.freeze({sessionId, pollSecret, requestUri, qrPayload, profile,
    ...(paid.payment ? {paymentHash, random: paid.random} : {}),
    get payment() { return paid.payment && structuredClone(paid.payment) },
    get unpaidRecovery() { return paid.payment ? undefined : structuredClone(checkpoint) },
    poll: (pollSignal?: AbortSignal) => bounded(pollSignal, async activeSignal => {
      const a = profile.approval
      if (chain.addresses.ServiceRegistry?.toLowerCase() !== a.registry.toLowerCase() || await chain.client.getChainId() !== a.chainId) throw new Error('Agent session chain/registry changed')
      activeSignal.throwIfAborted()
      const block = await chain.client.getBlockNumber({cacheTime: 0})
      activeSignal.throwIfAborted()
      const current = await chain.readers.serviceRegistry.getService(a.serviceId, block)
      activeSignal.throwIfAborted()
      if (current.status > 1 || current.revision < a.revision || current.serviceType !== 1
        || current.owner.toLowerCase() !== expected.owner || current.authKey.toLowerCase() !== expected.authKey
        || current.pendingOwner.toLowerCase() !== pendingOwner || current.manifestHash.toLowerCase() !== a.manifestHash.toLowerCase()
        || current.endpoint !== profile.endpoint) throw new Error('Agent session profile changed; retain the original session for recovery')
      const reply = decode(await transport.agentRequest(`${profile.endpoint}/v1/sessions/${sessionId}`, {bearer: pollSecret, maxBytes: 1_048_576, signal: activeSignal}), 1_048_576)
      const binding = reply.binding_preimage as Record<string, unknown> | null | undefined
      const token = reply.compound_token as Record<string, unknown> | null | undefined
      if (!paid.payment && [reply.payment, reply.payment_hash, binding?.payment, binding?.payment_hash, token?.payment, token?.payment_hash].some(value => value != null)) throw new Error('Paid agent state cannot use unpaid session recovery')
      if (!(reply.status === 'failed' && reply.binding_preimage == null && reply.compound_token == null) && !equalPin((reply.binding_preimage as Record<string, unknown> | null)?.service_profile, expected)) throw new Error('Agent result belongs to another session profile')
      return parseVerifierAgentSessionStatus(reply, sessionId)
    }),
  })
}

/**
 * Selection authenticates public metadata first. Once POSTed, never silently switch providers.
 * @param chain Reader for the approved service registry.
 * @param config Independently approved provider profiles and guarded HTTP transport.
 */
export function createRegisteredAgentClient(chain: TasraChainClient, config: {profiles: readonly ApprovedAgentProfile[]; transport: AgentTransport}) {
  if (!Array.isArray(config.profiles) || !config.profiles.length || config.profiles.length > 16 || typeof config.transport?.agentRequest !== 'function' || typeof config.transport.request !== 'function') throw new Error('Approved agent profiles and a guarded transport are required')
  const profiles = config.profiles.map((p: ApprovedAgentProfile) => {
    validateServiceEndpoint(p.endpoint)
    if (p.approval.serviceType !== 1 || !/^decentralized_identifier:did:web:[a-z0-9.-]+(?:(?:%3A)[0-9]+)?$/.test(p.clientId)) throw new Error('Invalid verifier-agent profile')
    return Object.freeze({...p, approval: Object.freeze({...p.approval})})
  })
  const transport = config.transport
  return {
    /**
     * Restore private unpaid-session state without creating another session. Independent
     * approvals and live registry identity are checked before sending its bearer. Save the
     * original operation separately and verify its wallet binding before presenting.
     */
    async restoreUnpaidSession(input: UnpaidAgentSessionRecovery, options: {signal?: AbortSignal} = {}): Promise<RegisteredAgentSession> {
      options.signal?.throwIfAborted()
      const saved = decode(new TextEncoder().encode(JSON.stringify(input)), 32_768)
      const keys = ['version', 'sessionId', 'pollSecret', 'requestUri', 'qrPayload', 'serviceProfile', 'pendingOwner']
      if (saved.version !== 1 || Object.keys(saved).length !== keys.length || keys.some(key => !(key in saved))
        || typeof saved.pendingOwner !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(saved.pendingOwner)
        || !saved.serviceProfile || typeof saved.serviceProfile !== 'object' || Array.isArray(saved.serviceProfile)) throw new Error('Invalid unpaid agent recovery checkpoint')
      const service = saved.serviceProfile as Record<string, unknown>
      if (typeof service.authKey !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(service.authKey)) throw new Error('Invalid unpaid agent recovery identity')
      const profile = profiles.find(p => {
        const expected = pin(p, {authKey: service.authKey as ServiceRecord['authKey']})
        return Object.keys(service).length === Object.keys(expected).length && equalPin(service, expected)
      })
      if (!profile) throw new Error('Original agent recovery profile is not independently approved')
      const expected = pin(profile, {authKey: service.authKey as ServiceRecord['authKey']})
      const info = metadata({session_id: saved.sessionId, poll_secret: saved.pollSecret, request_uri: saved.requestUri, qr_payload: saved.qrPayload, service_profile: service}, profile, expected)
      const session = retainedSession(chain, transport, profile, expected, saved.pendingOwner, info, {})
      // Poll applies the same live checks as a surviving session closure, including draining.
      await session.poll(options.signal)
      return session
    },
    /** At most three unpaid discovery candidates. A paid session uses only its selected profile. */
    async createSession(params: CreateSessionParams, options: {profileIndex?: number; signal?: AbortSignal} = {}): Promise<RegisteredAgentSession> {
      params = structuredClone(params)
      const paid = sessionPaymentFields(params)
      const paymentHash = paid.payment && paymentIntentHash(paid.payment)
      const start = options.profileIndex ?? 0
      if (!Number.isInteger(start) || start < 0 || start >= profiles.length) throw new Error('Invalid agent profile index')
      return bounded(options.signal, async signal => {
        for (const profile of profiles.slice(start, start + (paid.payment ? 1 : 3))) {
          // Do this before discovery or POST: a paid session cannot be redrawn at another
          // audience, and the caller cannot change the committed random or expiry.
          sessionPaymentFields(params, profile.clientId)
          let record: ServiceRecord
          try {
            const result = await authenticateApprovedService(chain, profile.approval, {
              request: (url, opts) => transport.request(url, {...opts, signal: AbortSignal.any([signal, opts.signal])}),
            })
            signal.throwIfAborted()
            if (result.record.endpoint !== profile.endpoint || !result.manifest.capabilities.includes('oid4vp')) throw new Error('Agent endpoint/capability approval mismatch')
            record = result.record
          } catch { signal.throwIfAborted(); continue }
          if (params.operation.chain_id !== profile.approval.chainId) throw new Error('Agent operation chain mismatch')
          const body = new TextEncoder().encode(JSON.stringify({operation: params.operation, operation_sig: params.operationSig, delegation: params.delegation, message_hex: params.messageHex, ...paid}))
          if (body.length > 65_536) throw new Error('Agent session request too large')
          signal.throwIfAborted()
          let data: Record<string, unknown>
          try { data = decode(await createPost(transport, profile.endpoint + '/v1/sessions', body, Boolean(paymentHash), signal), 32_768) }
          catch (error) { throw new AgentSessionCreationUnknownError(profile, paymentHash, error) }
          const expected = pin(profile, record)
          return retainedSession(chain, transport, profile, expected, record.pendingOwner, metadata(data, profile, expected), paid)
        }
        throw new Error('No approved verifier-agent authenticated')
      })
    },
  }
}

/** True when a creation reply is exactly the agent's retryable not-yet-anchored refusal. */
function snapshotPending(reply: AgentHttpResponse): boolean {
  if (reply.status !== 503 || reply.retryAfterMs === undefined) return false
  try { return decode(reply.body, 4_096).error === SNAPSHOT_PENDING_REASON } catch { return false }
}

/**
 * POST one session creation. Only an UNPAID creation answered with the snapshot-pending refusal is
 * re-sent (identical bytes, after the agent's hint, at most five times): that refusal is by contract
 * given before anything is stored or charged. Any other reply or failure is left to the caller.
 */
async function createPost(transport: AgentTransport, url: string, body: Uint8Array, paid: boolean, signal: AbortSignal): Promise<Uint8Array> {
  if (!transport.agentExchange) return transport.agentRequest(url, {body, maxBytes: 32_768, signal})
  for (let attempt = 1; ; attempt++) {
    const reply = await transport.agentExchange(url, {body, maxBytes: 32_768, signal})
    if (reply.status === 201) return reply.body
    if (paid || attempt >= SNAPSHOT_RETRY_ATTEMPTS || !snapshotPending(reply))
      throw new Error(`Agent session creation refused (HTTP ${reply.status})`)
    const wait = Math.min(reply.retryAfterMs!, SNAPSHOT_RETRY_MAX_WAIT_MS)
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason) }
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, wait)
      signal.addEventListener('abort', abort, {once: true})
    })
  }
}
