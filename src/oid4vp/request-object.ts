// The signed Request Object (JAR) the Verifier Agent serves at `request_uri`, verified the way a
// standards wallet verifies it: `iss` is the platform's `did:web`, the JWS `kid` names one of that
// document's verification methods, `client_id` is the DID under the `decentralized_identifier:`
// prefix, `typ` is `oauth-authz-req+jwt`. Nothing here is Tasra-specific; the committee
// binding rides in the `nonce`, which the wallet copies into its KB-JWT without interpreting it.

import {resolveDidWeb, verificationKey, type ResolveOpts} from './did-web.js'
import {decodeJson, jwkFromDid, verifyCompactJws, type EcJwk, type Jwk} from './jose.js'
import type {Query as DcqlQuery} from '../auth/oid4vp.js'
import {parseRetryAfter} from '../internal/retryAfter.js'
import {sleep} from '../internal/sleep.js'

/** JOSE type identifier for a signed authorization request object. */
export const REQUEST_OBJECT_TYP = 'oauth-authz-req+jwt'
/** OpenID4VP client identifier prefix for a DID-based verifier. */
export const CLIENT_ID_PREFIX_DID = 'decentralized_identifier:'

/** OpenID4VP request claims carrying the credential query and wallet response context. */
export interface RequestObjectClaims {
  /** DID of the request issuer. */
  iss: string
  /** Verifier client identifier, optionally prefixed with decentralized_identifier:. */
  client_id: string
  /** Requested OpenID4VP response type. */
  response_type?: string
  /** `direct_post.jwt` (the verifier-agent always) or `direct_post`. */
  response_mode?: string
  /** Endpoint receiving the wallet response. */
  response_uri: string
  /** Challenge nonce for this operation. */
  nonce: string
  /** Opaque state echoed in the wallet response. */
  state: string
  /** Issue time in Unix seconds. */
  iat?: number
  /** Expiration time in Unix seconds. */
  exp?: number
  /** Credential requirements presented to the wallet. */
  dcql_query: DcqlQuery
  /** Verifier metadata, including optional response encryption keys. */
  client_metadata?: {
    jwks?: {keys: Jwk[]}
    vp_formats_supported?: Record<string, unknown>
    encrypted_response_enc_values_supported?: string[]
    [k: string]: unknown
  }
  /** Encoded operation context displayed or bound by the wallet. */
  transaction_data?: string[]
  [k: string]: unknown
}

/** Request JWT, decoded claims and signing identity after request-object validation. */
export interface VerifiedRequestObject {
  /** Original compact request JWT. */
  jwt: string
  /** Verified request JOSE header. */
  header: {alg: string; typ?: string; kid?: string}
  /** Validated request claims. */
  claims: RequestObjectClaims
  /** The DID `iss` names, after the `client_id` prefix agreed with it. */
  signerDid: string
  /** Public key used to verify the request signature. */
  signerKey: Jwk
}

/**
 * `openid4vp://?client_id=...&request_uri=...` (a QR payload or deep link) to its two parameters.
 *
 * @param uri - Wallet deep link or QR payload containing request_uri.
 */
export function parseOpenid4vpUri(uri: string): {clientId?: string; requestUri: string} {
  const q = uri.includes('?') ? uri.slice(uri.indexOf('?') + 1) : ''
  const params = new URLSearchParams(q)
  const requestUri = params.get('request_uri')
  if (!requestUri) throw new Error('openid4vp URI carries no request_uri')
  return {clientId: params.get('client_id') ?? undefined, requestUri}
}

/** Resolve the signing key a JAR's `kid` names: `did:web` documents online, `did:key`/`did:jwk` offline. */
export type KeyResolver = (did: string, kid: string | undefined) => Promise<Jwk>

/**
 * Create a signing-key resolver that fetches did:web keys and decodes did:key or did:jwk keys.
 *
 * @param opts - Fetch override and optional loopback HTTP permission.
 */
export function defaultKeyResolver(opts: ResolveOpts = {}): KeyResolver {
  return async (did, kid) => {
    if (did.startsWith('did:web:')) {
      const doc = await resolveDidWeb(did, opts)
      return verificationKey(doc, kid ?? `${did}#`)
    }
    return jwkFromDid(did)
  }
}

/** Signing-key resolver, evaluation time and expiration tolerance for request validation. */
export interface VerifyRequestObjectOpts {
  /** Resolver supplying a trusted public key for the request issuer and key identifier. */
  resolveKey?: KeyResolver
  /** Current time override in Unix seconds. */
  nowSecs?: number
  /** Seconds of clock skew tolerated on `exp`. */
  leewaySecs?: number
}

/**
 * Verify the request signature, JOSE type and agreement between client_id and the
 * issuer DID. Check expiration only when exp is a number; absence or a nonnumeric
 * value is not rejected by this helper. Require a nonce, response URI and DCQL query.
 *
 * @param jwt - Signed OpenID4VP request JWT.
 * @param opts - Trusted key resolver, current time and expiration tolerance.
 */
export async function verifyRequestObject(jwt: string, opts: VerifyRequestObjectOpts = {}): Promise<VerifiedRequestObject> {
  const [h, p, s] = jwt.split('.')
  if (!h || !p || !s) throw new Error('request object is not a compact JWS')
  const header = decodeJson<VerifiedRequestObject['header']>(h)
  if (header.typ !== REQUEST_OBJECT_TYP) throw new Error(`request object typ must be ${REQUEST_OBJECT_TYP}`)
  const claims = decodeJson<RequestObjectClaims>(p)
  if (typeof claims.iss !== 'string' || !claims.iss.startsWith('did:')) throw new Error('request object iss is not a DID')
  const bareClientId = claims.client_id.startsWith(CLIENT_ID_PREFIX_DID) ? claims.client_id.slice(CLIENT_ID_PREFIX_DID.length) : claims.client_id
  if (bareClientId !== claims.iss) throw new Error('request object client_id does not name its iss')
  if (header.kid && !header.kid.startsWith(claims.iss)) throw new Error('request object kid belongs to a different DID than iss')
  const signerKey = await (opts.resolveKey ?? defaultKeyResolver())(claims.iss, header.kid)
  verifyCompactJws(jwt, signerKey)
  const now = opts.nowSecs ?? Math.floor(Date.now() / 1000)
  if (typeof claims.exp === 'number' && claims.exp + (opts.leewaySecs ?? 60) < now) throw new Error('request object expired')
  if (typeof claims.nonce !== 'string' || !claims.nonce) throw new Error('request object has no nonce')
  if (typeof claims.response_uri !== 'string') throw new Error('request object has no response_uri')
  if (!claims.dcql_query) throw new Error('request object has no dcql_query')
  return {jwt, header, claims, signerDid: claims.iss, signerKey}
}

/**
 * The ephemeral P-256 key the wallet must encrypt its response to, when the verifier-agent served one.
 *
 * @param ro - Verified request claims containing optional recipient encryption keys.
 */
export function responseEncryptionKey(ro: Pick<VerifiedRequestObject, 'claims'>): EcJwk | undefined {
  const k = ro.claims.client_metadata?.jwks?.keys?.[0]
  return k && k.kty === 'EC' && k.crv === 'P-256' ? k : undefined
}

/**
 * The `error` message of the verifier-agent's HTTP 503 meaning "the paid exchange this request
 * started is still running; repeating this same request joins it and never sends or pays again".
 * It must equal the agent's text byte for byte. Any other 503 (for example an uncertain paid
 * outcome awaiting reconciliation) is final.
 */
export const REQUEST_OBJECT_IN_PROGRESS = 'paid verifier exchange in progress; it will not be sent again - retry this request'

/**
 * The `error` message of the verifier-agent's HTTP 503 meaning "this agent is at its paid-exchange
 * capacity": the request was refused before anything was dispatched, sent or billed, and the
 * approval stands, so repeating the same request is safe. It must equal the agent's text byte for byte.
 */
export const REQUEST_OBJECT_AT_CAPACITY = 'paid verifier exchange capacity saturated on this agent; nothing was sent or billed and the approval stands - retry this request'

/** The only 503 messages that make the identical `request_uri` GET worth repeating. */
const RETRYABLE_503_MESSAGES: ReadonlySet<string> = new Set([REQUEST_OBJECT_IN_PROGRESS, REQUEST_OBJECT_AT_CAPACITY])

/**
 * Limits for repeating the identical `request_uri` GET while the verifier-agent reports work in progress
 * or that it is at capacity.
 *
 * The default budget is 120 s because the agent's detached paid exchange may legitimately run up to
 * about 118 s (its deadline is the earlier of the session authority's expiry and dispatch + 120 s,
 * less 2 s). The budget ends at the earliest of `maxTotalMs`, `notAfterMs` and the caller's
 * `AbortSignal`; pass the session's (authority's) expiry as `notAfterMs` when you know it.
 */
export interface RequestObjectRetryPolicy {
  /** Total GETs including the first, 1..256 (default 64; 120 s at the agent's 2 s hint is 60). 1 disables the retry. */
  maxAttempts?: number
  /** Wall-clock budget from the first GET in ms, 0..300000 (default 120000). Every GET and body read is bounded; zero sends nothing. */
  maxTotalMs?: number
  /** Absolute end of the budget in Unix ms, such as the session's expiry; the earlier of this and `maxTotalMs` applies. */
  notAfterMs?: number
  /** Shortest wait in ms, 100..5000 (default 500). A smaller `Retry-After` is raised to it. */
  minDelayMs?: number
  /** Longest wait in ms, `minDelayMs`..10000 (default 5000). A larger `Retry-After` is lowered to it. */
  maxDelayMs?: number
}

/** Request verification, transport, cancellation and retry options for {@link fetchRequestObject}. */
export interface FetchRequestObjectOpts extends VerifyRequestObjectOpts {
  /** HTTP transport override; defaults to the global fetch implementation. */
  fetchImpl?: typeof fetch
  /** Cancels an in-flight GET and any wait between GETs; the promise rejects with the signal's reason. */
  signal?: AbortSignal
  /** Limits for the in-progress and at-capacity retry; see {@link RequestObjectRetryPolicy}. */
  inProgressRetry?: RequestObjectRetryPolicy
}

/** Wait used when a retryable 503 carries no usable `Retry-After` (the agent's own value). */
const IN_PROGRESS_DEFAULT_DELAY_MS = 2_000
/** A retryable 503 is a short JSON object; a larger body is not one. */
const IN_PROGRESS_MAX_BODY = 4_096

function requestObjectRetryLimits(policy: RequestObjectRetryPolicy = {}): Required<Omit<RequestObjectRetryPolicy, 'notAfterMs'>> & {notAfterMs?: number} {
  const value = (v: number | undefined, fallback: number, min: number, max: number, name: string) => {
    const n = v ?? fallback
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`invalid inProgressRetry.${name}`)
    return n
  }
  const minDelayMs = value(policy.minDelayMs, 500, 100, 5_000, 'minDelayMs')
  const limits = {maxAttempts: value(policy.maxAttempts, 64, 1, 256, 'maxAttempts'), maxTotalMs: value(policy.maxTotalMs, 120_000, 0, 300_000, 'maxTotalMs'),
    minDelayMs, maxDelayMs: value(policy.maxDelayMs, Math.max(5_000, minDelayMs), minDelayMs, 10_000, 'maxDelayMs')}
  if (policy.notAfterMs === undefined) return limits
  if (!Number.isFinite(policy.notAfterMs)) throw new Error('invalid inProgressRetry.notAfterMs')
  return {...limits, notAfterMs: policy.notAfterMs}
}

/**
 * True only for the verifier-agent's explicit in-progress or at-capacity answer: HTTP 503, served
 * by the requested URL itself (no redirect), with a JSON body whose `error` is exactly
 * {@link REQUEST_OBJECT_IN_PROGRESS} or {@link REQUEST_OBJECT_AT_CAPACITY}. Every other reply is final.
 */
function isRetryable503(res: Response, requestUri: string, body: string): boolean {
  if (res.status !== 503 || res.redirected === true) return false
  if (typeof res.url === 'string' && res.url !== '') {
    let requested: string
    try { requested = new URL(requestUri).href } catch { return false }
    if (res.url !== requested) return false
  }
  if (body.length > IN_PROGRESS_MAX_BODY) return false
  let parsed: unknown
  try { parsed = JSON.parse(body) } catch { return false }
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && RETRYABLE_503_MESSAGES.has((parsed as {error?: unknown}).error as string)
}

/**
 * Fetch a JAR from `request_uri` (`Accept: application/oauth-authz-req+jwt`) and verify it.
 *
 * While a paid verifier exchange that this request started is still running, the verifier-agent
 * answers HTTP 503 with the exact {@link REQUEST_OBJECT_IN_PROGRESS} message and `Retry-After`.
 * When it is at its paid-exchange capacity it refuses before sending or billing anything with the
 * exact {@link REQUEST_OBJECT_AT_CAPACITY} message. Only these two answers are retried, in any mix
 * and under one shared budget, by repeating the identical GET (same URL and headers; nothing is
 * posted, presented or paid). The wait follows `Retry-After` (delta-seconds or HTTP-date; 2 s when
 * absent or malformed) clamped to `minDelayMs`..`maxDelayMs` (default 0.5..5 s), within
 * `maxAttempts` (default 64) and a wall-clock budget (default 120 s, which covers the agent's
 * longest detached exchange) that ends early at `notAfterMs`. A repeated GET still running at the
 * end of the budget is aborted. `signal` cancels the in-flight GET or the wait at once. When the
 * budget or attempts run out, the last 503 is thrown; the paid work may still complete on the agent.
 * Authorization refusals, any other 503 (including an uncertain paid outcome), other statuses, a
 * reply from a redirected URL and network errors are final. Every GET, including the first and
 * its response body, shares that deadline and cancellation signal. An expired budget sends
 * nothing. A 200 is verified exactly as before.
 *
 * @param requestUri - URL from the OpenID4VP request_uri parameter.
 * @param opts - Request signature verification settings, fetch implementation, cancellation and retry limits.
 */
export async function fetchRequestObject(requestUri: string, opts: FetchRequestObjectOpts = {}): Promise<VerifiedRequestObject> {
  const f = opts.fetchImpl ?? fetch
  const limits = requestObjectRetryLimits(opts.inProgressRetry)
  const signal = opts.signal
  const headers = {Accept: `application/${REQUEST_OBJECT_TYP}`}
  const deadline = Math.min(Date.now() + limits.maxTotalMs, limits.notAfterMs ?? Number.POSITIVE_INFINITY)
  for (let attempt = 1; ; attempt++) {
    signal?.throwIfAborted()
    const {res, body} = await boundedGet()
    if (res.ok) return verifyRequestObject(body.trim(), opts)
    const failure = new Error(`request_uri ${requestUri} → HTTP ${res.status}: ${body.slice(0, 200)}`)
    if (!isRetryable503(res, requestUri, body) || attempt >= limits.maxAttempts) throw failure
    const hinted = parseRetryAfter(res.headers?.get('retry-after')) ?? IN_PROGRESS_DEFAULT_DELAY_MS
    const delay = Math.min(Math.max(hinted, limits.minDelayMs), limits.maxDelayMs)
    if (Date.now() + delay >= deadline) throw failure
    await sleep(delay, signal)
  }

  // Deadline admission precedes every dispatch, including the first. The race also
  // bounds custom transports that do not honour AbortSignal themselves.
  async function boundedGet(): Promise<{res: Response; body: string}> {
    const ended = () => new Error(`request_uri ${requestUri} → still unavailable when the retry budget ended`)
    if (Date.now() >= deadline) throw ended()
    const budget = new AbortController()
    const combined = signal ? AbortSignal.any([signal, budget.signal]) : budget.signal
    const timer = setTimeout(() => budget.abort(ended()), deadline - Date.now())
    let onAbort: (() => void) | undefined
    try {
      const cancelled = new Promise<never>((_, reject) => {
        onAbort = () => reject(combined.reason)
        combined.addEventListener('abort', onAbort, {once: true})
        if (combined.aborted) onAbort()
      })
      const response = (async () => {
        combined.throwIfAborted()
        const res = await f(requestUri, {headers, signal: combined})
        const body = res.ok ? await res.text() : await res.text().catch(() => '')
        combined.throwIfAborted()
        return {res, body}
      })()
      return await Promise.race([response, cancelled])
    } catch (error) {
      signal?.throwIfAborted()
      if (budget.signal.aborted) throw new Error(`request_uri ${requestUri} → still unavailable when the retry budget ended`, {cause: error})
      throw error
    } finally {
      clearTimeout(timer)
      if (onAbort) combined.removeEventListener('abort', onAbort)
    }
  }
}
