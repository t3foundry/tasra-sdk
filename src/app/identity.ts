import {ed25519} from '@noble/curves/ed25519'
import {p256} from '@noble/curves/p256'
import {equalBytes} from '@noble/curves/utils.js'
import {validate, type CredentialQuery, type ScopeNamespace} from '../auth/oid4vp.js'
import {b64url, b64urlDecode, didJwk, ed25519HolderKey, holderSigner, jwkFromDid, p256HolderKey, randomHolderKey, verifyCompactJws, type HolderKey, type Jwk} from '../oid4vp/jose.js'
import {holderCnf, issueSdJwtVc, parseSdJwt, sdJwtClaims, type SdJwtIssuer} from '../oid4vp/sd-jwt.js'
import {parseOpenid4vpUri} from '../oid4vp/request-object.js'
import {presentToRequestUri, type PresentOpts} from '../oid4vp/wallet.js'
import {awaitVerifierAgentResult, openVerifierAgentSession, type TypedDataSigner} from '../oid4vp/verifier-agent.js'
import type {PresentationDelegation, SessionPhase} from '../verifier-agent/index.js'
import type {AuthorizationRequest, OperationAuthorizer} from './client.js'

/**
 * DID identity with holder and issuer adapters backed by one managed signing key.
 */
export interface TasraIdentity {
  /**
   * Self-certifying DID derived from the identity public key.
   */
  readonly did: string
  /**
   * Signing curve used by holder and issuer adapters.
   */
  readonly algorithm: 'Ed25519' | 'P-256'
  /** Advanced adapter access. Contains private key bytes; never log or serialize it. */
  readonly holder: HolderKey
  /** Advanced issuer adapter. Contains private key bytes; never log or serialize it. */
  readonly issuer: SdJwtIssuer
  /** Explicit backup. The caller must protect and eventually clear this independent copy. */
  exportPrivateKey(): Uint8Array
  /** Clears SDK-owned key bytes. Cannot erase previously exported copies. */
  destroy(): void
  /**
   * Return public identity metadata without serializing private key bytes.
   */
  toJSON(): {did: string; algorithm: 'Ed25519' | 'P-256'}
}

/**
 * Create a fresh DID and its credential signing key without a separate crypto library.
 * @param options Optional signing algorithm and 32-byte seed; defaults to a fresh Ed25519 key.
 * @returns Identity with public DID metadata and explicitly managed private-key custody.
 */
export function createIdentity(options: {algorithm?: 'Ed25519' | 'P-256'; seed?: Uint8Array} = {}): TasraIdentity {
  const algorithm = options.algorithm ?? 'Ed25519'
  if (algorithm !== 'Ed25519' && algorithm !== 'P-256') throw new Error('Unsupported identity algorithm')
  if (options.seed !== undefined && (!(options.seed instanceof Uint8Array) || options.seed.length !== 32)) throw new Error('Identity seed must contain 32 bytes')
  const secret = options.seed?.slice() ?? (algorithm === 'P-256' ? randomHolderKey().privateKey : crypto.getRandomValues(new Uint8Array(32)))
  let holder: HolderKey
  try { holder = algorithm === 'P-256' ? p256HolderKey(secret) : ed25519HolderKey(secret) }
  catch (error) { secret.fill(0); throw error }
  Object.freeze(holder.publicJwk)
  Object.freeze(holder)
  const issuer = Object.freeze({did: holder.did, kid: `${holder.did}#0`, signer: Object.freeze(holderSigner(holder))})
  let destroyed = false
  const assertLive = () => { if (destroyed) throw new Error('Identity has been destroyed') }
  return Object.freeze({
    did: holder.did, algorithm,
    get holder() { assertLive(); return holder },
    get issuer() { assertLive(); return issuer },
    exportPrivateKey() { assertLive(); return secret.slice() },
    destroy() { secret.fill(0); destroyed = true },
    toJSON() { return {did: holder.did, algorithm} },
  })
}

const reservedClaims = new Set(['iss', 'sub', 'vct', 'cnf', 'iat', 'exp', 'nbf', '_sd', '_sd_alg', '...','__proto__', 'constructor', 'prototype'])
function text(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a nonempty string`)
}
function nonemptyArray(value: unknown, label: string): void {
  if (!Array.isArray(value) || !value.length) throw new Error(`${label} must be a nonempty list`)
}
function jsonValue(value: unknown): void {
  JSON.stringify(value, (_key, item: unknown) => {
    if (item === undefined || typeof item === 'function' || typeof item === 'symbol' || typeof item === 'bigint' || typeof item === 'number' && !Number.isFinite(item)) throw new Error('Claims must contain JSON values')
    return item
  })
}
function clock(nowSecs?: number): number {
  const now = nowSecs ?? Math.floor(Date.now() / 1000)
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Credential time must be a nonnegative integer')
  return now
}
function issuerDid(issuer: string | Pick<TasraIdentity, 'did'>): string {
  const did = typeof issuer === 'string' ? issuer : issuer.did
  text(did, 'Issuer DID')
  if (!/^did:[a-z0-9]+:[^\s#]+$/.test(did)) throw new Error('Issuer must be a DID without a fragment')
  return did
}

function validatePublicKey(key: Jwk): void {
  function coordinate(encoded: string) {
    if (typeof encoded !== 'string') throw new Error('Invalid credential public key')
    const bytes = b64urlDecode(encoded)
    if (bytes.length !== 32 || b64url(bytes) !== encoded) throw new Error('Invalid credential public key coordinate')
    return bytes
  }
  if (key.kty === 'OKP' && key.crv === 'Ed25519') {
    const point = ed25519.ExtendedPoint.fromHex(coordinate(key.x))
    if (point.isSmallOrder() || !point.isTorsionFree()) throw new Error('Invalid Ed25519 credential public key')
  } else if (key.kty === 'EC' && key.crv === 'P-256') {
    p256.ProjectivePoint.fromHex(new Uint8Array([4, ...coordinate(key.x), ...coordinate(key.y)]))
  } else throw new Error('Unsupported credential public key curve')
}

/**
 * Issuer, holder and claims for a signed, expiring SD-JWT credential.
 */
export interface IssueCredentialOptions {
  /**
   * Identity whose private key signs the credential.
   */
  issuer: TasraIdentity
  /**
   * Identity whose DID receives the credential key binding.
   */
  holder: TasraIdentity
  /**
   * Credential type written to the vct claim.
   */
  type: string
  /**
   * Application claims; reserved protocol claims are rejected.
   */
  claims: Record<string, unknown>
  /** Defaults to the holder DID. Human/application subject DIDs are also supported. */
  subject?: string
  /** Defaults to one hour. */
  ttlSecs?: number
  /**
   * Issuance time in Unix seconds; defaults to the current clock.
   */
  nowSecs?: number
}

/**
 * Issue a holder-bound SD-JWT credential; protocol claims cannot be replaced by app claims.
 * @param options Issuer, holder, credential type, application claims and lifetime.
 * @returns Serialized holder-bound SD-JWT credential.
 */
export function issueCredential(options: IssueCredentialOptions): string {
  text(options.type, 'Credential type')
  if (!options.claims || typeof options.claims !== 'object' || Array.isArray(options.claims)) throw new Error('Claims must be an object')
  for (const name of Object.keys(options.claims)) {
    text(name, 'Claim name')
    if (reservedClaims.has(name)) throw new Error(`Reserved credential claim: ${name}`)
  }
  jsonValue(options.claims)
  const now = clock(options.nowSecs), ttl = options.ttlSecs ?? 3600
  if (!Number.isSafeInteger(ttl) || ttl <= 0 || !Number.isSafeInteger(now + ttl)) throw new Error('Credential ttlSecs must be a positive integer')
  const subject = options.subject ?? options.holder.did
  text(subject, 'Credential subject')
  // Reading the adapters checks that neither identity has already been destroyed.
  return issueSdJwtVc({issuer: options.issuer.issuer, cnf: holderCnf(options.holder.holder), vct: options.type,
    sub: subject, claims: options.claims, nowSecs: now, ttlSecs: ttl})
}

/**
 * Optional issuer, holder, type and subject pins applied during credential verification.
 */
export interface VerifyCredentialOptions {
  /**
   * Require this exact issuer DID when supplied.
   */
  issuer?: string | Pick<TasraIdentity, 'did'>
  /**
   * Require this holder DID to match the credential key binding.
   */
  holder?: Pick<TasraIdentity, 'did'>
  /**
   * Require this exact credential type.
   */
  type?: string
  /**
   * Require this exact subject claim.
   */
  subject?: string
  /**
   * Verification time in Unix seconds; defaults to the current clock.
   */
  nowSecs?: number
}

/**
 * Verify an SD-JWT issued by a self-certifying did:jwk/did:key, its lifetime and optional pins.
 * Signature verification proves key control; trust in that issuer must come from the app's policy.
 * This does not perform revocation/status checks or resolve did:web issuers.
 * @param credential Serialized SD-JWT credential.
 * @param expected Optional trust pins and verification time.
 * @returns Verified disclosed claims; issuer trust depends on the supplied application pins.
 */
export function verifyCredential(credential: string, expected: VerifyCredentialOptions = {}): Record<string, unknown> {
  text(credential, 'Credential')
  const parsed = parseSdJwt(credential), payload = parsed.payload, did = issuerDid(payload.iss as string)
  if (parsed.header.typ !== 'dc+sd-jwt') throw new Error('Unsupported credential format')
  if (typeof parsed.header.kid !== 'string' || !parsed.header.kid.startsWith(`${did}#`)) throw new Error('Credential signing key does not name its issuer')
  const issuerKey = jwkFromDid(did)
  validatePublicKey(issuerKey)
  verifyCompactJws(parsed.issuerJwt, issuerKey)
  if (expected.issuer !== undefined && did !== issuerDid(expected.issuer)) throw new Error('Credential issuer mismatch')
  const now = clock(expected.nowSecs)
  if (!Number.isSafeInteger(payload.exp) || (payload.exp as number) <= now) throw new Error('Credential is expired or lacks a valid expiry')
  if (!Number.isSafeInteger(payload.iat) || (payload.iat as number) > now || (payload.iat as number) < 0 || (payload.exp as number) <= (payload.iat as number)) throw new Error('Credential issuance time is invalid')
  if (payload.nbf !== undefined && (!Number.isSafeInteger(payload.nbf) || (payload.nbf as number) > now)) throw new Error('Credential is not yet valid')
  text(payload.vct, 'Credential type')
  const names = new Set(Object.keys(payload))
  for (const disclosure of parsed.disclosures) {
    if (reservedClaims.has(disclosure.name) || names.has(disclosure.name)) throw new Error('Credential contains a duplicate or reserved disclosure')
    names.add(disclosure.name)
  }
  const cnf = payload.cnf as {kid?: unknown; jwk?: unknown} | undefined
  if (!cnf || typeof cnf !== 'object' || typeof cnf.kid !== 'string' || !cnf.kid.endsWith('#0') || cnf.jwk !== undefined) throw new Error('Credential must bind a holder DID with cnf.kid')
  const holderDid = cnf.kid.slice(0, -2)
  // Validate the key shape even when the caller has not pinned a holder.
  const holderJwk = jwkFromDid(holderDid)
  validatePublicKey(holderJwk)
  if (didJwk(holderJwk) !== holderDid) throw new Error('Credential holder must be a canonical did:jwk')
  if (expected.holder !== undefined && expected.holder.did !== holderDid) throw new Error('Credential holder mismatch')
  if (expected.type !== undefined && payload.vct !== expected.type) throw new Error('Credential type mismatch')
  if (expected.subject !== undefined && payload.sub !== expected.subject) throw new Error('Credential subject mismatch')
  return sdJwtClaims(parsed)
}

/**
 * Trusted issuer and claim restrictions used to build a credential authorization rule.
 */
export interface CredentialPolicyOptions {
  /**
   * Issuer DID trusted by the generated rule.
   */
  issuer: string | Pick<TasraIdentity, 'did'>
  /**
   * Required credential type.
   */
  type: string
  /**
   * Allowed subject values; must be nonempty when supplied.
   */
  subjects?: readonly string[]
  /** Top-level claim names with an explicit, nonempty list of allowed values. */
  claims?: Record<string, readonly unknown[]>
  /** Restrict decrypt/extract operations to scopes named in this credential claim. */
  identityScope?: {claim: string; namespace?: ScopeNamespace}
}

/**
 * Build and validate the policy committed to a slot, with issuer trust pinned explicitly.
 * @param options Trusted issuer and required credential claims.
 * @returns Validated DCQL rule suitable for slot creation.
 */
export function credentialPolicy(options: CredentialPolicyOptions): string {
  text(options.type, 'Credential type')
  const claims: NonNullable<CredentialQuery['claims']> = [{path: ['iss'], values: [issuerDid(options.issuer)]}]
  if (options.subjects !== undefined) {
    nonemptyArray(options.subjects, 'Subjects')
    for (const subject of options.subjects) text(subject, 'Subject')
    claims.push({path: ['sub'], values: [...options.subjects]})
  }
  for (const [name, values] of Object.entries(options.claims ?? {})) {
    text(name, 'Claim name')
    if (reservedClaims.has(name)) throw new Error(`Reserved policy claim: ${name}`)
    nonemptyArray(values, `Policy claim ${name} allowed values`)
    jsonValue(values)
    claims.push({path: [name], values: [...values]})
  }
  const query: CredentialQuery = {id: 'access', format: 'dc+sd-jwt', meta: {vct_values: [options.type]}, claims}
  if (options.identityScope !== undefined) {
    const {claim, namespace = 'issuer'} = options.identityScope
    text(claim, 'Identity scope claim')
    if (reservedClaims.has(claim)) throw new Error('Identity scope must use an application claim')
    if (!claims.some(c => c.path[0] === claim)) claims.push({path: [claim]})
    query.kk_identity_scope_claim = [claim]
    query.kk_scope_namespace = namespace
  }
  const rule = JSON.stringify({credentials: [query]})
  validate(rule)
  return rule
}

/**
 * Credential selection, request validation and cancellation controls for OID4VP presentation.
 */
export interface PresentCredentialsOptions extends PresentOpts {
  /**
   * Cancel pending wallet presentation work.
   */
  signal?: AbortSignal
}

/**
 * Present selected, holder-bound credentials to a signed OID4VP request. Passing credentials is
 * explicit consent to the default selection; provide `choose` to display a wallet consent screen.
 * A local policy mismatch throws locally and is not evidence of a verifier rejection.
 * @param requestUri Signed request URI or OID4VP launch URI supplied by the verifier agent.
 * @param identity Live holder identity bound to the selected credentials.
 * @param credentials Serialized SD-JWT credentials explicitly selected for this presentation.
 * @param options Optional consent selection, request checks, transport and cancellation settings.
 */
export async function presentCredentials(requestUri: string, identity: TasraIdentity, credentials: readonly string[], options: PresentCredentialsOptions = {}) {
  options.signal?.throwIfAborted()
  nonemptyArray(credentials, 'Credentials')
  const holder = identity.holder
  for (const credential of credentials) verifyCredential(credential, {holder: identity, nowSecs: options.nowSecs})
  const transport = options.fetchImpl ?? fetch
  const fetchImpl: typeof fetch = (input, init) => {
    options.signal?.throwIfAborted()
    const signals = [options.signal, init?.signal].filter((signal): signal is AbortSignal => signal != null)
    return transport(input, {...init, ...(signals.length ? {signal: AbortSignal.any(signals)} : {})})
  }
  const choose: PresentOpts['choose'] = async plan => {
    options.signal?.throwIfAborted()
    const candidate = options.choose ? await options.choose(plan) : plan.chosen
    options.signal?.throwIfAborted()
    // A caller's consent picker may select only the offered matching candidates.
    if (candidate && (!plan.satisfies || !plan.candidates.includes(candidate))) throw new Error('Presentation choice does not satisfy the requested policy')
    // Check liveness again after an asynchronous consent screen.
    if (!equalBytes(identity.holder.privateKey, holder.privateKey)) throw new Error('Identity changed during presentation')
    return candidate
  }
  return presentToRequestUri(requestUri, credentials.map(sdJwt => ({sdJwt})), holder, {...options, fetchImpl, choose})
}

/**
 * Approved verifier-agent endpoint, holder credentials and consent controls for operation authorization.
 */
export interface CredentialAuthorizationOptions {
  /**
   * Explicitly approved verifier-agent endpoint used for the session.
   */
  verifierAgentUrl: string
  /**
   * Creator or delegated EIP-712 signer authorizing the operation.
   */
  signer: TypedDataSigner
  /**
   * Live holder identity bound to the credentials.
   */
  identity: TasraIdentity
  /**
   * Serialized holder-bound credentials selected by the application.
   */
  credentials: readonly string[]
  /**
   * Optional authorization delegating presentation to another signer.
   */
  delegation?: PresentationDelegation
  /** Optional application consent screen, called before any session or credential disclosure. */
  approve?: (request: AuthorizationRequest) => boolean | Promise<boolean>
  /**
   * Wallet request validation and credential-selection options.
   */
  presentation?: Omit<PresentCredentialsOptions, 'signal'>
  /**
   * Observe verifier-agent session progress.
   */
  onPhase?: (phase: SessionPhase) => void
  /**
   * Maximum wait for the verifier-agent result in milliseconds.
   */
  timeoutMs?: number
}

/**
 * Authorize one exact SDK operation: sign its request, present a credential, collect bound proofs.
 * @param options Approved verifier-agent endpoint, signer, holder credentials and local consent controls.
 */
export function credentialAuthorization(options: CredentialAuthorizationOptions): OperationAuthorizer {
  const endpoint = new URL(options.verifierAgentUrl)
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))) throw new Error('Verifier agent requires HTTPS (HTTP is allowed only on loopback)')
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Verifier URL cannot contain credentials, a query or a fragment')
  nonemptyArray(options.credentials, 'Credentials')
  const credentials = [...options.credentials]
  const assertOrigin = (input: string) => {
    const url = new URL(input)
    if (url.origin !== endpoint.origin || url.username || url.password) throw new Error('Credential presentation must stay on the selected verifier origin')
  }
  const transport = options.presentation?.fetchImpl ?? fetch
  const fetchImpl: typeof fetch = (input, init) => {
    assertOrigin(input instanceof Request ? input.url : String(input))
    return transport(input, {...init, redirect: 'error'})
  }
  return async request => {
    request.signal?.throwIfAborted()
    for (const credential of credentials) verifyCredential(credential, {holder: options.identity})
    const operation = {...request, ...(request.message ? {message: request.message.slice()} : {}),
      ...(request.payloadDigest ? {payloadDigest: request.payloadDigest.slice()} : {}),
      slotId: typeof request.slotId === 'string' ? request.slotId : request.slotId.slice()}
    const consent = {...operation, ...(operation.message ? {message: operation.message.slice()} : {}),
      ...(operation.payloadDigest ? {payloadDigest: operation.payloadDigest.slice()} : {}),
      slotId: typeof operation.slotId === 'string' ? operation.slotId : operation.slotId.slice()}
    if (options.approve && !await options.approve(Object.freeze(consent))) throw new Error('Credential authorization declined locally')
    request.signal?.throwIfAborted()
    // Opening is not retried automatically: the existing session remains the source of truth.
    const session = await openVerifierAgentSession({...operation, verifierAgentUrl: endpoint.href.replace(/\/$/, ''), signer: options.signer, delegation: options.delegation})
    request.signal?.throwIfAborted()
    assertOrigin(session.qrPayload.startsWith('openid4vp://') ? parseOpenid4vpUri(session.qrPayload).requestUri : session.qrPayload)
    await presentCredentials(session.qrPayload, options.identity, credentials, {...options.presentation, fetchImpl, signal: request.signal})
    request.signal?.throwIfAborted()
    const result = await awaitVerifierAgentResult(session, {signal: request.signal, timeoutMs: options.timeoutMs, onPhase: options.onPhase})
    if (!result.verifierProofs?.length) throw new Error('Authorization did not include verifier membership proofs')
    return {token: result.token, verifierProofs: result.verifierProofs}
  }
}
