// ADR-0090 D7 session lifecycle: one presentation opens a refreshable grant; each KEM decrypt is
// then authorized by a session-key proof instead of a fresh presentation.
//
// The client side of docs/plans/session-grants.md (network repo): the create-body fragment, the
// grant acceptance checks, background refresh before `exp` with a durably reserved monotonic
// `seq`, idle and absolute expiry (the application re-presents), and revocation.

import {ed25519} from '@noble/curves/ed25519'
import {randomBytes} from '@noble/hashes/utils'
import {bytesToHex, hexToBytes} from '../crypto/hex.js'
import {TasraError} from '../errors.js'
import type {VerifierSet} from '../committee/token.js'
import {DEFAULT_ACCESS_TTL_SECS, MAX_ABSOLUTE_TTL_SECS, MAX_ACCESS_TTL_SECS, MAX_IDLE_TIMEOUT_SECS, MAX_SESSION_SLOTS, SessionGrantError,
  decodeSessionGrant, parseSessionKeyJwk, toBase64Url, sessionControlHash, sessionGrantHash, sessionKeyThumbprint, verifySessionGrant,
  type SessionGrant, type SessionGrantRequestWire, type SessionGrantWire, type SessionKeyJwk, type VerifiedSessionGrant} from '../committee/session-grant.js'
import type {ApplicationStore} from './ready-slot.js'
import {withCommit} from './store-commit.js'
import type {ApprovedAgentProfile} from '../chain/registeredAgent.js'
import type {PaidAgentTransport} from '../chain/paidAgentTransport.js'
import {validateServiceEndpoint} from '../chain/serviceIdentity.js'
import type {BeaconDrawState} from '../chain/prepaid.js'

const HEX32 = /^0x[0-9a-fA-F]{64}$/

/** A session key the client holds; only its public JWK ever leaves it. */
export interface SessionKeyHandle {
  /** Public JWK sent at session create (RFC 7638 members only). */
  readonly jwk: SessionKeyJwk
  /** 64-byte signature over a 32-byte proof or control hash (Ed25519, or ES256 `r ‖ s`). */
  sign(hash: Uint8Array): Promise<Uint8Array>
  /** Forget the private key (in-memory Ed25519 keys are zeroed; WebCrypto keys are dropped). */
  dispose(): void
}

/**
 * Create a fresh session key. Prefers a NON-EXTRACTABLE WebCrypto P-256 key (ES256), so the private
 * key never exists as bytes in the page; without WebCrypto ECDSA it uses an in-memory Ed25519 key.
 * A session key is per session: never reuse it across sessions.
 * @param opts - Force `Ed25519` (tests, runtimes without WebCrypto) or `ES256`.
 */
export async function createSessionKey(opts: {alg?: 'ES256' | 'Ed25519'} = {}): Promise<SessionKeyHandle> {
  const subtle = globalThis.crypto?.subtle
  if (opts.alg !== 'Ed25519' && subtle) {
    try {
      const pair = await subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, false, ['sign', 'verify']) as CryptoKeyPair
      const pub = await subtle.exportKey('jwk', pair.publicKey)
      const jwk = parseSessionKeyJwk({kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y})
      let key: CryptoKey | undefined = pair.privateKey
      return Object.freeze({jwk, dispose: () => { key = undefined },
        async sign(hash: Uint8Array) {
          if (!key) throw new TasraError('Session key disposed')
          if (hash.length !== 32) throw new TasraError('Session key signs 32-byte hashes only')
          // WebCrypto ECDSA = ECDSA over SHA-256(data), IEEE P1363 r ‖ s: exactly ES256.
          return new Uint8Array(await subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, key, hash.slice().buffer as ArrayBuffer))
        }})
    } catch (error) { if (opts.alg === 'ES256') throw error }
  }
  const secret = randomBytes(32)
  const x = ed25519.getPublicKey(secret)
  const jwk = parseSessionKeyJwk({kty: 'OKP', crv: 'Ed25519', x: toBase64Url(x)})
  let live = true
  return Object.freeze({jwk, dispose: () => { secret.fill(0); live = false },
    async sign(hash: Uint8Array) {
      if (!live) throw new TasraError('Session key disposed')
      if (hash.length !== 32) throw new TasraError('Session key signs 32-byte hashes only')
      return ed25519.sign(hash, secret)
    }})
}

/** Requested session parameters; the platform clamps them and the grant carries the granted values. */
export interface SessionGrantParams {
  /** KEM slots (1..16, distinct). */
  slots: `0x${string}`[]
  /** Grant lifetime before a refresh is needed (platform cap 45 s, default 30). */
  accessTtlSecs?: number
  /** Longest idle gap between refreshes (cap 1800 s). */
  idleTimeoutSecs?: number
  /** Longest session life from its presentation (cap 12 h). */
  absoluteTtlSecs?: number
}

/** The `session_grant` object added to `POST /v1/sessions` (session mode). */
export interface SessionGrantCreateFragment {
  session_grant: SessionGrantRequestWire
}

function positive(n: number | undefined, fallback: number, field: string): number {
  const v = n ?? fallback
  // A 0 or negative value is a 400 at the agent, never clamped up: refuse it before sending.
  if (!Number.isSafeInteger(v) || v < 1) throw new TasraError(`Session ${field} must be a positive whole number of seconds`)
  return v
}

/**
 * Build the session-mode object for `POST /v1/sessions` (merge it into the create body). Slots are
 * sorted ascending, as the agent canonicalizes them; requested lifetimes travel as requested and
 * the agent clamps them to the platform caps.
 * @param key - The session key whose public JWK the grant will bind.
 * @param params - Slots and requested lifetimes.
 */
export function sessionGrantCreateFragment(key: SessionKeyHandle, params: SessionGrantParams): SessionGrantCreateFragment {
  const slots = [...new Set(params.slots.map(s => s.toLowerCase()))]
  if (slots.length !== params.slots.length || slots.length === 0 || slots.length > MAX_SESSION_SLOTS || slots.some(s => !HEX32.test(s))) {
    throw new TasraError(`A session grant names 1..${MAX_SESSION_SLOTS} distinct 32-byte slots`)
  }
  slots.sort()
  return {session_grant: {session_key: parseSessionKeyJwk(key.jwk), slots,
    access_ttl_secs: positive(params.accessTtlSecs, DEFAULT_ACCESS_TTL_SECS, 'access_ttl'),
    idle_timeout_secs: positive(params.idleTimeoutSecs, 600, 'idle_timeout'),
    absolute_ttl_secs: positive(params.absoluteTtlSecs, 3600, 'absolute_ttl')}}
}

/** Independently established verification material for one granted slot. */
export interface SlotTrust {
  /** Active verifier set (registry size + index → Ed25519 key) at the grant's epoch. */
  set: VerifierSet
  /** The slot's committee size and quorum. */
  committee: number
  quorum: number
  /** keccak256 of the slot's raw rule. */
  ruleHash: Uint8Array
  /** The beacon seed of the grant's epoch, `beacon.seedAt(epoch)`, read from the chain: a grant on any other seed is refused. */
  seed: Uint8Array
}

/**
 * Where a session's refresh and revoke go, and how its slots are trusted. Refresh and revoke travel
 * through the SAME guarded registered-agent transport and request policy as every other paid agent
 * call (verified TLS, connection-time destination checks, no redirects, bounded replies); the routes
 * carry no bearer, because the session-key signature is their authorization.
 */
export interface SessionTransport {
  /** The configured deployment chain: a grant naming any other chain is refused on accept, refresh and resume. */
  chainId: number
  /** The approved verifier-agent and its guarded transport (`createNodePaidAgentTransport` / `createBrowserPaidAgentTransport`). */
  agent: {profile: ApprovedAgentProfile; transport: PaidAgentTransport}
  /** Verification material per granted slot, read from the chain by the caller. */
  trust(slot: `0x${string}`, epoch: bigint): Promise<SlotTrust>
}

/** A session that can no longer be refreshed: the application must present again. */
export class SessionEndedError extends TasraError {
  /**
   * A definite refusal ({@link SESSION_REFUSAL_CODES}), `unsupported` (a verifier-agent without
   * session refresh) or `local-*` (`local-idle`, `local-absolute`, `local-expired`,
   * `local-revoking`, `local-stale`: the beacon left the grant's window).
   */
  readonly code: string
  constructor(code: string, message: string) { super(message); this.code = code }
}

interface SessionRecord {
  schema: 1
  sessionId: string
  grant: SessionGrantWire
  /** Highest seq reserved (written BEFORE it is signed or sent; never reused). */
  lastSeq: number
  /** Unix seconds of the presentation or the last accepted refresh. */
  lastRefresh: number
  /** Requested values, the upper bound every granted value must respect. */
  requested: {accessTtlSecs: number; idleTimeoutSecs: number; absoluteTtlSecs: number; slots: string[]}
  ended?: {code: string; at: number}
  /** A revoke started (journaled first): the session serves nothing more, even before the revoke completes. */
  revoking?: true
}

/** A session control reply is a grant and a seq, or a typed refusal: a few KiB at most. */
const MAX_CONTROL_REPLY_BYTES = 65_536

const recordKey = (sessionId: string) => `tasra.session-grant.${sessionId.toLowerCase()}`
const now = () => Math.floor(Date.now() / 1000)

/** Lifecycle options. */
export interface GrantedSessionOptions {
  store: ApplicationStore
  transport: SessionTransport
  key: SessionKeyHandle
  /** Refresh this many seconds before `exp` (default: a third of the grant's lifetime, at least 5 s). */
  refreshLeadSecs?: number
  /** Called once when the session ends and a new presentation is needed. */
  onEnded?(error: SessionEndedError): void
  /** Called after every accepted refresh with the new grant (re-derive per-epoch trust or proofs here). */
  onRefreshed?(grant: SessionGrantWire): void
  /**
   * The beacon's latest epoch (e.g. `readCurrentBeaconEpoch`). With it, {@link GrantedSession.start}
   * also polls the beacon every `pollMs` (default 2000) and refreshes the grant in the background
   * the moment the beacon moves past the grant's epoch ({@link GrantedSession.observeBeacon}).
   */
  beacon?: {
    latestEpoch(): Promise<bigint>
    /**
     * The beacon's latest epoch AND its draw epoch (`readBeaconDrawState`). When set, the poll
     * reads this instead of `latestEpoch` and a follow refreshes only once the agent can draw the
     * next epoch (its verifier snapshot is anchored): ONE refresh per epoch, at the anchor, instead
     * of re-signing the grant on its old epoch every `followRetryMs` until the anchor lands (each
     * such refresh spends the holder's per-verifier session quota).
     */
    drawState?(): Promise<BeaconDrawState>
    pollMs?: number
  }
  /**
   * How long a run of `session_context_changed` refresh refusals the chain does not confirm is
   * retried before the session ends, ms (default 15000; needs `beacon`). See {@link SESSION_REFUSAL_CODES}.
   */
  contextRetryMs?: number
  /** Pause between follow attempts while a new epoch's anchors land, ms (default 1000; tests use 0). */
  followRetryMs?: number
  /** Clock override, Unix seconds (tests). */
  clock?: () => number
}

/**
 * Refresh attempts in ONE follow run while the refresh stays on the old epoch (the new epoch's
 * anchors are landing). A run that gives up is retried by a later observation, even at the same
 * epoch, after a bounded backoff ({@link MAX_FOLLOW_BACKOFF_MS}).
 */
const FOLLOW_ATTEMPTS = 20
/** Default {@link GrantedSessionOptions.contextRetryMs}: about one lab epoch plus its anchoring delay. */
const CONTEXT_RETRY_MS = 15_000
/** Longest pause before an observation retries a failed follow run, ms. */
const MAX_FOLLOW_BACKOFF_MS = 30_000

/**
 * Accept the grant the agent returned for a session-mode presentation, after checking it against
 * what was requested and against each slot's anchored committee, then persist it. The granted
 * values may be lower than requested, never higher; the key thumbprint must be this key's.
 * @param opts - Store, transport, session key and clock.
 * @param fragment - The fragment sent at create.
 * @param response - The agent's create/complete response carrying `session_grant` and `refresh_seq`.
 */
export async function acceptSessionGrant(opts: GrantedSessionOptions, fragment: SessionGrantCreateFragment, response: unknown): Promise<GrantedSession> {
  const clock = opts.clock ?? now
  const r = response as {session_grant?: SessionGrantWire; refresh_seq?: unknown}
  if (!r || typeof r !== 'object' || !r.session_grant || r.refresh_seq !== 0) throw new TasraError('Session create response carries no fresh session grant')
  const requested = {accessTtlSecs: fragment.session_grant.access_ttl_secs, idleTimeoutSecs: fragment.session_grant.idle_timeout_secs,
    absoluteTtlSecs: fragment.session_grant.absolute_ttl_secs, slots: fragment.session_grant.slots}
  const grant = decodeSessionGrant(r.session_grant)
  await checkGrant(opts, grant, requested, undefined, clock())
  const sessionId = bytesToHex(grant.payload.sessionId)
  const record: SessionRecord = {schema: 1, sessionId, grant: structuredClone(r.session_grant), lastSeq: 0, lastRefresh: grant.payload.iat, requested}
  // One commit: the lock and the record are published together (store-commit.ts).
  await withCommit(opts.store, recordKey(sessionId), async commit => {
    if (await opts.store.load(recordKey(sessionId)) !== undefined) throw new TasraError('Session grant already accepted for this session')
    commit.stage(recordKey(sessionId), record)
  })
  return new GrantedSession(opts, sessionId, record)
}

/** The grant must name the configured deployment chain (and the approved agent must serve it). */
function requireChain(opts: GrantedSessionOptions, chainId: bigint | number): void {
  const t = opts.transport
  if (!Number.isSafeInteger(t.chainId) || t.chainId <= 0 || t.agent.profile.approval.chainId !== t.chainId) throw new TasraError('Session transport names no single deployment chain')
  if (BigInt(chainId) !== BigInt(t.chainId)) throw new SessionGrantError('wrong-chain', `Session grant names chain ${String(chainId)}, not the configured chain ${t.chainId}`)
}

async function checkGrant(opts: GrantedSessionOptions, grant: SessionGrant, requested: SessionRecord['requested'], previous: SessionGrant | undefined, at: number): Promise<VerifiedSessionGrant[]> {
  const p = grant.payload
  requireChain(opts, p.chainId)
  const mine = sessionKeyThumbprint(opts.key.jwk)
  if (bytesToHex(p.sessionKeyThumbprint) !== bytesToHex(mine)) throw new SessionGrantError('wrong-key', 'Session grant binds another session key')
  if (p.exp - p.iat > Math.min(requested.accessTtlSecs, MAX_ACCESS_TTL_SECS)) throw new SessionGrantError('lifetime', 'Session grant lifetime exceeds the requested access TTL')
  if (p.idleTimeoutSecs > Math.min(requested.idleTimeoutSecs, MAX_IDLE_TIMEOUT_SECS)) throw new SessionGrantError('idle-timeout', 'Session grant idle timeout exceeds the request')
  const slots = p.slots.map(s => bytesToHex(s.slotId).toLowerCase())
  if (slots.some(s => !requested.slots.includes(s))) throw new SessionGrantError('slot-not-granted', 'Session grant names a slot that was not requested')
  if (previous) {
    const q = previous.payload
    // A refresh keeps the session: same id, key, binding and absolute expiry; slots may only drop.
    if (bytesToHex(p.sessionId) !== bytesToHex(q.sessionId) || bytesToHex(p.holderHash) !== bytesToHex(q.holderHash) || p.binding !== q.binding
      || p.absoluteExp !== q.absoluteExp || p.idleTimeoutSecs !== q.idleTimeoutSecs || p.chainId !== q.chainId) throw new SessionGrantError('refresh-changed', 'Refreshed grant changed the session')
    const before = new Set(q.slots.map(s => bytesToHex(s.slotId).toLowerCase()))
    if (slots.some(s => !before.has(s))) throw new SessionGrantError('refresh-changed', 'Refreshed grant added a slot')
    if (p.iat < q.iat || p.epoch < q.epoch) throw new SessionGrantError('refresh-changed', 'Refreshed grant is older than the current one')
    // A refresh MOVES the grant (a later iat, or the next epoch): a reply equal to the held grant
    // is no refresh, so a caller can never report success without the grant moving (C8 review F5).
    if (p.iat === q.iat && p.epoch === q.epoch) throw new SessionGrantError('refresh-unchanged', 'Refreshed grant does not move the current one')
  } else if (p.absoluteExp - p.iat > Math.min(requested.absoluteTtlSecs, MAX_ABSOLUTE_TTL_SECS)) {
    throw new SessionGrantError('absolute-exp', 'Session grant absolute lifetime exceeds the request')
  }
  // Every granted slot verifies against ITS OWN draw and policy before the grant is used for anything.
  const verified: VerifiedSessionGrant[] = []
  for (const slot of p.slots) {
    const hex = bytesToHex(slot.slotId) as `0x${string}`
    const trust = await opts.transport.trust(hex, p.epoch)
    verified.push(verifySessionGrant({grant, set: trust.set, slotId: slot.slotId, committee: trust.committee, quorum: trust.quorum, slotRuleHash: trust.ruleHash, seed: trust.seed, now: at}))
  }
  return verified
}

/**
 * Refresh refusals no retry of the same session can pass (keykeeper-verifier `session_grant.rs`,
 * relayed by the verifier-agent): the session ends and the application presents again.
 * `session_context_changed`: the verifiers' live draw no longer admits the grant's epoch or seed
 * (the beacon left the grant's window, or the draw changed); `session_continuation`: the session
 * cannot cross an epoch; `session_unknown`: no agent session holds this grant; `session_wrong_key`,
 * `session_key_not_bound`, `session_mismatch`, `session_invalid_request`, `session_lifetime`: this
 * session's own refresh is malformed or bound elsewhere, every retry the same. Everything else
 * (`session_rate_limited`, `session_quorum_unmet`, `session_unavailable`, `session_status_window`,
 * untyped answers) is transient: the held grant still serves and the refresh is retried, backing off.
 *
 * One exception: `session_context_changed` is also what a verifier answers when ITS beacon read lags
 * the chain (the grant's epoch ahead of its live epoch) or the continuation epoch's seed is not
 * anchored at it yet (keykeeper-verifier `validate_beacon_draw`), and the agent relays one such
 * signer's code as final. With a `beacon` reader, the session ends on it only when the client's
 * own chain read confirms the grant two epochs behind, or the refusal persists past
 * `contextRetryMs`; until then it is retried as transient (the held grant still serves).
 */
export const SESSION_REFUSAL_CODES: ReadonlySet<string> = new Set(['session_expired', 'session_idle', 'session_revoked', 'session_replayed', 'session_status',
  'session_rule_changed', 'session_context_changed', 'session_continuation', 'session_unknown', 'session_wrong_key', 'session_key_not_bound', 'session_mismatch',
  'session_invalid_request', 'session_lifetime'])

/**
 * Session-route refusals the SAME request may pass later (verifier `session_grant.rs`, C24): the
 * held grant still serves and the refresh is retried, never below the answer's `Retry-After`.
 * `session_verifier_behind` (503, NEW): a verifier's chain view trails the grant (its live beacon
 * is older than the grant's epoch, or that epoch's seed is not anchored at its head yet); it
 * passes once the verifier catches up, with no new presentation. Before C24 a verifier answered
 * that as `session_context_changed`, which an up-to-date server now sends only for a definite
 * change (it stays in {@link SESSION_REFUSAL_CODES}, with the chain-confirmed exception for older
 * servers). `session_rate_limited` (429), `session_unavailable`, `session_quorum_unmet` (503,
 * the agent's mixed or older answers) and `session_status_window` are transient as before; any
 * other non-refusal answer stays transient too.
 */
export const SESSION_RETRYABLE_CODES: ReadonlySet<string> = new Set(['session_verifier_behind', 'session_rate_limited', 'session_unavailable',
  'session_quorum_unmet', 'session_status_window'])

/**
 * The pause before retrying a `session_verifier_behind` refusal that carries no `Retry-After`
 * (the verifier sends 2 s; the verifier-agent relays the code without the header so far), ms.
 */
export const SESSION_VERIFIER_BEHIND_RETRY_MS = 2_000

/**
 * A transient refresh failure: the held grant is unchanged and still serves until its `exp`.
 * `retryAfterMs` is the agent's `Retry-After`, when it sends one: no verifier-agent or verifier
 * sets it today (2026-11), so the backoff alone paces the retries; the support is kept for when
 * one does.
 */
export class SessionRefreshError extends TasraError {
  /** Always true: a later refresh may pass. */
  readonly retryable = true
  constructor(readonly status: number, readonly code: string | undefined, readonly retryAfterMs: number | undefined) {
    super(`Session refresh failed (${status}${code ? ', ' + code : ''}); retry before the grant expires`)
    this.name = 'SessionRefreshError'
  }
}

/** The pause before the next transient refresh retry: exponential from `base` (at most 8×), never below a `Retry-After`, at most 30 s. */
function retryPause(base: number, attempt: number, error: unknown): number {
  const after = error instanceof SessionRefreshError ? error.retryAfterMs ?? 0 : 0
  return Math.min(MAX_FOLLOW_BACKOFF_MS, Math.max(after, base * 2 ** Math.min(attempt, 3)))
}

/** An accepted, refreshable session grant. */
export class GrantedSession {
  readonly sessionId: string
  #opts: GrantedSessionOptions
  #record: SessionRecord
  #timer: ReturnType<typeof setTimeout> | undefined
  #beaconTimer: ReturnType<typeof setInterval> | undefined
  #inflight: Promise<SessionGrantWire> | undefined
  #following: Promise<boolean> | undefined
  /** Callers waiting in {@link followBeacon}; while any wait, the follow's pause holds the process. */
  #waiters = 0
  /** The running follow's pause between attempts ({@link stop} wakes it). */
  #pause: {timer: ReturnType<typeof setTimeout>; wake(): void} | undefined
  /** Bumped by every {@link stop}: a follow started before it gives up at its next step. */
  #stops = 0
  /** The newest beacon epoch observed on the chain (a payment's discovery, the beacon poll, a fresh read). */
  #beacon: bigint | undefined
  /** The newest draw epoch observed on the chain ({@link observeDraw}); only with `beacon.drawState`. */
  #draw: bigint | undefined
  /** Consecutive failed follow runs, and when (Date.now ms) an observation may start the next one. */
  #followFailures = 0
  #followRetryAt = 0
  /** Consecutive failed expiry refreshes (their retry backs off). */
  #expiryFailures = 0
  /** When (Date.now ms) the current run of unconfirmed `session_context_changed` refusals began. */
  #contextSince: number | undefined
  /** The last `beacon.drawState` read failed: the poll and the follow behave as `latestEpoch`-only until one answers. */
  #drawFallback = false
  #drawWarned = false
  /**
   * Unix seconds of the last USE (a {@link current} read for a keeper request), at least the last
   * refresh this process loaded. Background refreshes (the expiry timer, a beacon follow) never move
   * it, so the D9 idle timeout still fires while {@link start} runs: idle is time without use.
   */
  #lastUsed: number

  /** @internal Use {@link acceptSessionGrant} or {@link loadGrantedSession}. */
  constructor(opts: GrantedSessionOptions, sessionId: string, record: SessionRecord) {
    this.#opts = opts; this.sessionId = sessionId; this.#record = record
    this.#lastUsed = record.lastRefresh
  }

  #clock(): number { return (this.#opts.clock ?? now)() }

  /**
   * The current grant on the wire, for keeper requests. Throws once the session ended or the grant
   * is past its deadline. A read is a USE: it keeps the session from going idle.
   */
  current(): SessionGrantWire {
    const ended = this.#localEnd()
    if (ended) throw ended
    const t = this.#clock()
    if (t > this.#record.grant.exp) throw new SessionGrantError('expired', 'Session grant expired; refresh it first')
    if (t > this.#lastUsed) this.#lastUsed = t
    return structuredClone(this.#record.grant)
  }

  /** Verified grant for one slot (re-verified against the slot's anchored committee). */
  async verifiedFor(slot: `0x${string}`): Promise<VerifiedSessionGrant> {
    const grant = decodeSessionGrant(this.current())
    requireChain(this.#opts, grant.payload.chainId)
    const target = grant.payload.slots.find(s => bytesToHex(s.slotId).toLowerCase() === slot.toLowerCase())
    if (!target) throw new SessionGrantError('slot-not-granted', `slot ${slot} is not named by the session grant`)
    const trust = await this.#opts.transport.trust(slot, grant.payload.epoch)
    return verifySessionGrant({grant, set: trust.set, slotId: target.slotId, committee: trust.committee, quorum: trust.quorum, slotRuleHash: trust.ruleHash, seed: trust.seed, now: this.#clock()})
  }

  /** The session key bound by this grant. */
  get key(): SessionKeyHandle { return this.#opts.key }

  #localEnd(): SessionEndedError | undefined {
    if (this.#record.ended) return new SessionEndedError(this.#record.ended.code, `Session ended (${this.#record.ended.code}); present again`)
    if (this.#record.revoking) return new SessionEndedError('local-revoking', 'Session is being revoked; present again')
    const t = this.#clock(), g = this.#record.grant
    if (t >= g.absolute_exp) return new SessionEndedError('local-absolute', 'Session reached its absolute expiry; present again')
    // Idle is judged from the last refresh (as the verifiers judge it) AND from the last use: a
    // background refresh alone never keeps an unused session alive.
    if (t - this.#record.lastRefresh > g.idle_timeout_secs || t - this.#lastUsed > g.idle_timeout_secs) {
      return new SessionEndedError('local-idle', 'Session idle timeout passed; present again')
    }
    return undefined
  }

  async #end(error: SessionEndedError): Promise<never> {
    this.stop()
    const key = recordKey(this.sessionId)
    await withCommit(this.#opts.store, key, async commit => {
      const stored = await this.#opts.store.load<SessionRecord>(key)
      if (stored && !stored.ended) commit.stage(key, {...stored, ended: {code: error.code, at: this.#clock()}})
    })
    this.#record = {...this.#record, ended: {code: error.code, at: this.#clock()}}
    this.#opts.onEnded?.(error)
    throw error
  }

  /**
   * Reserve the next seq durably before signing, so a crash never reuses one: the staged value is
   * published with the lock's release (one commit), and this resolves only after it is durable.
   */
  async #reserveSeq(): Promise<{seq: number; grant: SessionGrantWire}> {
    const key = recordKey(this.sessionId)
    const reserved = await withCommit(this.#opts.store, key, async commit => {
      const stored = await this.#opts.store.load<SessionRecord>(key)
      if (!stored || stored.schema !== 1) throw new TasraError('Session grant journal missing')
      const seq = stored.lastSeq + 1
      const updated: SessionRecord = {...stored, lastSeq: seq}
      commit.stage(key, updated)
      return {seq, grant: stored.grant, updated}
    })
    this.#record = reserved.updated
    return {seq: reserved.seq, grant: reserved.grant}
  }

  /** One POST through the approved agent's guarded transport and the shared request policy; never repeated here. */
  async #post(path: '/v1/sessions/refresh' | '/v1/sessions/revoke', body: unknown): Promise<{status: number; json: unknown; retryAfterMs?: number}> {
    const {profile, transport} = this.#opts.transport.agent
    validateServiceEndpoint(profile.endpoint)
    const res = await transport.paidAgentRequest(profile.endpoint + path, {method: 'POST', body: new TextEncoder().encode(JSON.stringify(body)),
      maxBytes: MAX_CONTROL_REPLY_BYTES, signal: AbortSignal.timeout(30_000)})
    if (res.body.length > MAX_CONTROL_REPLY_BYTES) throw new TasraError('Session reply exceeds its byte limit')
    let json: unknown
    try { json = res.body.length ? JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(res.body)) : undefined } catch { json = undefined }
    return {status: res.status, json, ...res.retryAfterMs !== undefined ? {retryAfterMs: res.retryAfterMs} : {}}
  }

  /**
   * Refresh now: a session-key signature over `(grant_hash, seq, issued_at)` with a fresh seq;
   * the verifiers re-check status, rules, idle and absolute limits and sign a new grant. A typed
   * refusal, a 404 (verifiers without session support) or a local limit ends the session.
   */
  refresh(): Promise<SessionGrantWire> {
    this.#inflight ??= this.#refresh().finally(() => { this.#inflight = undefined })
    return this.#inflight
  }

  async #refresh(): Promise<SessionGrantWire> {
    const local = this.#localEnd()
    if (local) return this.#end(local)
    const {seq, grant} = await this.#reserveSeq()
    const previous = decodeSessionGrant(grant)
    const issuedAt = this.#clock()
    const signature = await this.#opts.key.sign(sessionControlHash('refresh', sessionGrantHash(previous.payload), seq, issuedAt))
    const reply = await this.#post('/v1/sessions/refresh', {grant, seq, issued_at: issuedAt, signature: bytesToHex(signature)})
    const r = reply.json as {session_grant?: SessionGrantWire; refresh_seq?: unknown; code?: unknown}
    const code = typeof r?.code === 'string' ? r.code : undefined
    if (reply.status >= 400 && code === 'session_context_changed' && await this.#contextUnconfirmed(BigInt(previous.payload.epoch))) {
      throw new SessionRefreshError(reply.status, code, reply.retryAfterMs)
    }
    if (reply.status >= 400 && code !== undefined && SESSION_REFUSAL_CODES.has(code)) return this.#end(new SessionEndedError(code, `Session refresh refused: ${code}; present again`))
    if (reply.status === 404) return this.#end(new SessionEndedError('unsupported', 'Verifiers do not support session refresh; present again'))
    if (reply.status >= 400) throw new SessionRefreshError(reply.status, code,
      reply.retryAfterMs ?? (code === 'session_verifier_behind' ? SESSION_VERIFIER_BEHIND_RETRY_MS : undefined))
    if (!r?.session_grant || r.refresh_seq !== seq) throw new TasraError('Session refresh reply does not answer this seq')
    this.#contextSince = undefined
    const next = decodeSessionGrant(r.session_grant)
    await checkGrant(this.#opts, next, this.#record.requested, previous, this.#clock())
    const key = recordKey(this.sessionId)
    this.#record = await withCommit(this.#opts.store, key, async commit => {
      const stored = await this.#opts.store.load<SessionRecord>(key)
      if (!stored || stored.lastSeq < seq) throw new TasraError('Session grant journal moved backwards')
      const updated: SessionRecord = {...stored, grant: structuredClone(r.session_grant!), lastRefresh: issuedAt}
      commit.stage(key, updated)
      return updated
    })
    // A refresh outside the expiry timer (a beacon follow) moves `exp`: re-arm the armed timer on it.
    if (this.#timer) this.#armExpiry()
    try { this.#opts.onRefreshed?.(structuredClone(r.session_grant)) } catch { /* a listener never fails the refresh */ }
    return structuredClone(r.session_grant)
  }

  /**
   * Whether a `session_context_changed` refresh refusal is NOT confirmed by the chain (so it is
   * retried, not ended on): within `contextRetryMs` of the first such refusal in a row, the client's
   * own fresh read (`beacon.latestEpoch`) shows the grant still admissible (its epoch the latest or
   * previous: the refusing verifier's beacon or anchor is behind), or cannot be read. Without a
   * `beacon` reader nothing can show the server is behind: the refusal ends the session.
   */
  async #contextUnconfirmed(grantEpoch: bigint): Promise<boolean> {
    const read = this.#opts.beacon?.latestEpoch
    if (!read) return false
    const t = Date.now()
    this.#contextSince ??= t
    if (t - this.#contextSince > (this.#opts.contextRetryMs ?? CONTEXT_RETRY_MS)) return false
    let latest: unknown
    try { latest = await read() } catch { return true }
    if (typeof latest !== 'bigint' || latest < 0n) return true
    // A fair chain observation; the follow (if any) judges it after this refresh settles.
    if (this.#beacon === undefined || latest > this.#beacon) this.#beacon = latest
    return grantEpoch + 1n >= latest
  }

  /** The newest beacon epoch this session has observed, if any. */
  get beaconEpoch(): bigint | undefined { return this.#beacon }

  /**
   * Report the beacon's latest epoch AS READ FROM THE CHAIN (a payment discovery's `beaconEpoch`,
   * the beacon poll, a fresh `readCurrentBeaconEpoch`). Never pass an epoch a keeper or any other
   * service claims: observations never move backwards, so one inflated value would stall the
   * session until it is presented again. Once it is past the grant's epoch the grant is refreshed in the BACKGROUND
   * ({@link followBeacon}): keepers still admit the current grant for the whole next epoch, so the
   * refresh lands well before the boundary that would end it, and no message waits for it. An
   * observation never moves backwards.
   */
  observeBeacon(epoch: bigint): void {
    if (typeof epoch !== 'bigint' || epoch < 0n) return
    if (this.#beacon === undefined || epoch > this.#beacon) this.#beacon = epoch
    // What was OBSERVED (#beacon) and what the grant has FOLLOWED to (its epoch) are separate: an
    // observation at an epoch already seen still retries a follow that failed (after the backoff).
    if (this.#record.ended || this.#record.revoking || this.#beacon <= BigInt(this.#record.grant.epoch)) return
    // A grant the beacon has left (two epochs behind) can never be continued: the follow ends the
    // session at once, whatever the backoff, so the next use presents again instead of failing.
    if (this.#stale() && !this.#following) { void this.#startFollow().catch(() => undefined); return }
    if (this.#following || Date.now() < this.#followRetryAt) return
    // Errors are the session's own outcome (an end calls onEnded); a later observation retries.
    void this.#startFollow().catch(() => undefined)
  }

  /**
   * Report the beacon's latest epoch and its DRAW epoch AS READ FROM THE CHAIN at one head
   * (`readBeaconDrawState`; the `beacon.drawState` poll does this). As {@link observeBeacon}, and a
   * follow refreshes only once the draw epoch is past the grant's (the agent can continue the
   * session onto it); until then nothing is sent. Observations never move backwards.
   */
  observeDraw(state: BeaconDrawState): void {
    const {latest, draw} = state ?? {} as BeaconDrawState
    if (typeof latest !== 'bigint' || latest < 0n) return
    if (typeof draw === 'bigint' && draw >= 0n && draw <= latest && (this.#draw === undefined || draw > this.#draw)) this.#draw = draw
    this.observeBeacon(latest)
  }

  /** The newest draw epoch observed, if a `beacon.drawState` is configured and has answered. */
  get drawEpoch(): bigint | undefined { return this.#draw }

  /** The held grant is two or more epochs behind the observed beacon: no keeper or verifier admits it again. */
  #stale(): boolean {
    return this.#beacon !== undefined && BigInt(this.#record.grant.epoch) + 1n < this.#beacon
  }

  /**
   * Bring the grant up to the newest observed beacon epoch, one continuation per epoch (the agent
   * continues a session exactly ONE epoch). A refresh that stays on the old epoch (the new epoch's
   * anchors have not landed at the agent) is retried, bounded, while the held grant is still
   * admissible (its epoch the beacon's latest or previous); never past that. Single-flight; resolves
   * `true` when the grant moved, `false` when it was already current. Throws
   * {@link SessionEndedError} when the session cannot continue (present again), and a
   * {@link TasraError} when {@link stop} interrupts it.
   *
   * A caller of this method WAITS for the follow, so while it waits the follow's pauses keep the
   * process alive (a background follow, started by {@link observeBeacon}, never does): a waiter
   * whose only pending work is an unreferenced timer would be dropped when the event loop drains.
   */
  followBeacon(): Promise<boolean> {
    const run = this.#startFollow()
    this.#waiters++
    // A pause already running when this caller joined holds the process from now on.
    ;(this.#pause?.timer as {ref?(): void} | undefined)?.ref?.()
    return run.finally(() => { this.#waiters-- })
  }

  #startFollow(): Promise<boolean> {
    this.#following ??= this.#follow().then(moved => {
      this.#followFailures = 0; this.#followRetryAt = 0
      return moved
    }, (error: unknown) => {
      // Back off exponentially from `followRetryMs` (bounded) before an observation tries again.
      this.#followFailures++
      const base = this.#opts.followRetryMs ?? 1000
      this.#followRetryAt = Date.now() + Math.min(MAX_FOLLOW_BACKOFF_MS, base * 2 ** Math.min(this.#followFailures - 1, 16))
      throw error
    }).finally(() => { this.#following = undefined })
    return this.#following
  }

  async #follow(): Promise<boolean> {
    let moved = false
    const run = this.#stops
    for (let attempt = 0; ; attempt++) {
      // stop() (also every session end) interrupts the follow; its waiters are told why.
      if (this.#stops !== run) {
        const ended = this.#localEnd()
        if (ended) throw ended
        throw new TasraError('Session beacon follow stopped (GrantedSession.stop); the held grant is unchanged')
      }
      // A refresh already in flight (the expiry timer's) may move the grant: judge after it.
      if (this.#inflight) {
        await this.#inflight.catch(() => undefined)
        continue
      }
      const target = this.#beacon, at = BigInt(this.#record.grant.epoch)
      if (target === undefined || at >= target) return moved
      // Two epochs behind: the agent continues a session one epoch at a time and the verifiers judge
      // the continuation at their live beacon, so no refresh can save it (C20: every such attempt
      // was refused `session_context_changed` or `session_expired`). End now; present again.
      if (this.#stale()) {
        const local = this.#localEnd()
        return this.#end(local ?? new SessionEndedError('local-stale', `Session grant epoch ${at} is two epochs behind the beacon (${target}); present again`))
      }
      // With a draw observation: until the agent can draw the next epoch, a refresh would only
      // re-sign the grant on its own epoch. Wait for the poll to observe the anchor.
      if (this.#opts.beacon?.drawState && !this.#drawFallback && (this.#draw === undefined || this.#draw <= at)) return moved
      let failure: unknown
      try {
        if (await this.refreshForEpoch(target)) moved = true
        continue
      } catch (error) {
        if (error instanceof SessionEndedError) throw error
        // Only while the held grant is still admissible is waiting worth it: past that, nothing
        // this grant authorizes is served, and the caller presents again.
        if (this.#stale() || attempt + 1 >= FOLLOW_ATTEMPTS) throw error
        failure = error
      }
      // Back off between attempts (each attempt that reaches the verifiers spends the holder's
      // session quota there), never below the agent's Retry-After.
      const pause = retryPause(this.#opts.followRetryMs ?? 1000, attempt, failure)
      if (pause > 0) await this.#followPause(pause)
    }
  }

  /**
   * One pause between follow attempts. Unreferenced while nobody waits for the follow (a background
   * follow never holds the process open); referenced while a {@link followBeacon} caller waits.
   * {@link stop} wakes it at once.
   */
  #followPause(ms: number): Promise<void> {
    return new Promise<void>(resolve => {
      const done = () => { if (this.#pause?.timer === timer) this.#pause = undefined; resolve() }
      const timer = setTimeout(done, ms)
      if (this.#waiters === 0) (timer as {unref?(): void}).unref?.()
      this.#pause = {timer, wake: () => { clearTimeout(timer); done() }}
    })
  }

  /**
   * Refresh now if the beacon has moved past the grant's epoch (`beaconEpoch`, e.g.
   * `PaidSessionDecrypt.beaconEpoch`). Keepers admit a grant only while its epoch is the beacon's
   * latest or previous, and the agent continues a session ONE epoch at a time, so a grant must
   * follow the beacon every epoch, not only before its `exp`: wait for a second move and the
   * session needs a new presentation. Resolves `true` when it refreshed, `false` when the grant is
   * already on (or ahead of) that epoch.
   */
  async refreshForEpoch(beaconEpoch: bigint): Promise<boolean> {
    const previous = BigInt(this.#record.grant.epoch)
    if (previous >= beaconEpoch) return false
    const next = await this.refresh()
    // `true` means the grant MOVED to a later epoch; a refresh that stayed on the old draw (the
    // latest snapshot not anchored yet) is not success: retry, the old grant is still valid.
    if (BigInt(next.epoch) <= previous) throw new TasraError(`Session refresh stayed on epoch ${previous}; retry once the beacon epoch is anchored`)
    return true
  }

  /**
   * Refresh in the background before each grant's `exp`, until stopped or the session ends. With
   * `beacon` configured, also poll the beacon and follow it ({@link observeBeacon}). Background
   * refreshes keep a session alive only while it is USED ({@link current}) within its idle timeout:
   * an unused session reaches the idle timeout and ends (`local-idle`, `onEnded`), so the next use
   * presents again.
   */
  start(): void {
    this.#armExpiry()
    const beacon = this.#opts.beacon
    if (beacon && !this.#beaconTimer) {
      const poll = () => {
        const latest = () => beacon.latestEpoch().then(epoch => this.observeBeacon(epoch), () => undefined)
        if (!beacon.drawState) { void latest(); return }
        beacon.drawState().then(state => { this.#drawFallback = false; this.observeDraw(state) }, (error: unknown) => {
          // A failing draw read never stops the follow: until it answers again, follow the latest
          // epoch alone (a refresh may then re-sign the old epoch until the anchor lands).
          this.#drawFallback = true
          if (!this.#drawWarned) {
            this.#drawWarned = true
            console.warn(`tasra session ${this.sessionId}: beacon.drawState failed (${error instanceof Error ? error.message : String(error)}); following the latest epoch only until it answers`)
          }
          void latest()
        })
      }
      this.#beaconTimer = setInterval(poll, Math.max(100, beacon.pollMs ?? 2000))
      ;(this.#beaconTimer as {unref?(): void}).unref?.()
      poll()
    }
  }

  #armExpiry(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = undefined
    const g = this.#record.grant
    const lead = this.#opts.refreshLeadSecs ?? Math.max(5, Math.floor((g.exp - g.iat) / 3))
    const delay = Math.max(0, (g.exp - lead - this.#clock()) * 1000)
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      this.refresh().then(() => { this.#expiryFailures = 0; this.#armExpiry() }, error => {
        if (error instanceof SessionEndedError) return
        // Transient: retry while the current grant still has time left, backing off (never below
        // the agent's Retry-After), so a busy or rate-limited agent is not asked every second.
        if (this.#clock() < this.#record.grant.exp) {
          this.#timer = setTimeout(() => this.#armExpiry(), retryPause(1000, this.#expiryFailures++, error))
          ;(this.#timer as {unref?(): void}).unref?.()
        } else void this.#end(new SessionEndedError('local-expired', 'Session grant expired before a refresh succeeded; present again')).catch(() => undefined)
      })
    }, delay)
    ;(this.#timer as {unref?(): void}).unref?.()
  }

  /**
   * Stop background refresh and the beacon poll, and interrupt a running beacon follow: its
   * {@link followBeacon} waiters reject at once (`SessionEndedError` when the session ended,
   * otherwise a `TasraError`), never left waiting on a cleared timer.
   */
  stop(): void {
    if (this.#timer) clearTimeout(this.#timer)
    if (this.#beaconTimer) clearInterval(this.#beaconTimer)
    this.#timer = undefined; this.#beaconTimer = undefined
    this.#stops++
    this.#pause?.wake()
  }

  /**
   * Revoke at the verifiers (effective at the next refresh; an issued grant runs to its `exp`, at
   * most 45 s), then end locally. The agent answers 204 only once `n - k + 1` members of every draw
   * that could hold the session acknowledged (so the rest can never form a quorum); `503
   * session_revoke_partial` (and a 429/503 busy answer) is retried, each attempt under a fresh
   * durably reserved seq, until `deadlineMs`. The session stops serving the moment revoke starts
   * (journaled), even when the revoke has not completed; call `revoke()` again after a
   * {@link SessionRevokeIncompleteError}. A 404 (the agent holds no session for this grant, so no
   * verifier was asked) ends and disposes the session locally and throws
   * {@link SessionRevokeUnconfirmedError}.
   * @param options - `deadlineMs`: total retry budget (default 30 s, at most 120 s); `sleep` for tests.
   */
  async revoke(options: {deadlineMs?: number; sleep?: (ms: number) => Promise<void>} = {}): Promise<void> {
    this.stop()
    const budget = options.deadlineMs ?? 30_000
    if (!Number.isSafeInteger(budget) || budget < 0 || budget > 120_000) throw new TasraError('Session revoke deadline must be 0..120000 ms')
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
    await this.#markRevoking()
    const started = Date.now()
    for (let attempt = 0; ; attempt++) {
      const {seq, grant} = await this.#reserveSeq()
      const issuedAt = this.#clock()
      const signature = await this.#opts.key.sign(sessionControlHash('revoke', sessionGrantHash(decodeSessionGrant(grant).payload), seq, issuedAt))
      const reply = await this.#post('/v1/sessions/revoke', {grant, seq, issued_at: issuedAt, signature: bytesToHex(signature)})
      // 204: n - k + 1 of every draw acknowledged.
      if (reply.status === 204) break
      // 404: the agent holds no session for this grant, so it relayed the revoke to NO verifier.
      // The grant still lives at its signers until its `exp`; nothing confirmed the revoke. End
      // and dispose locally (only this key could refresh it), then say so by type.
      if (reply.status === 404) {
        await this.#end(new SessionEndedError('session_revoked', 'Session revoked locally; the agent did not confirm it')).catch(() => undefined)
        this.#opts.key.dispose()
        throw new SessionRevokeUnconfirmedError()
      }
      const code = (reply.json as {code?: unknown} | undefined)?.code
      const retryable = reply.status === 503 || reply.status === 429
      if (!retryable) throw new TasraError(`Session revoke refused (${reply.status}${typeof code === 'string' ? ', ' + code : ''})`)
      const wait = Math.min(Math.max(reply.retryAfterMs ?? 0, 500 * 2 ** Math.min(attempt, 4)), 10_000)
      if (Date.now() - started + wait > budget) {
        throw new SessionRevokeIncompleteError(typeof code === 'string' ? code : `status ${reply.status}`)
      }
      await sleep(wait)
    }
    await this.#end(new SessionEndedError('session_revoked', 'Session revoked')).catch(() => undefined)
    this.#opts.key.dispose()
  }

  /** Journal that a revoke started: from now on the session serves nothing, across reloads too. */
  async #markRevoking(): Promise<void> {
    const key = recordKey(this.sessionId)
    this.#record = await withCommit(this.#opts.store, key, async commit => {
      const stored = await this.#opts.store.load<SessionRecord>(key)
      if (!stored || stored.schema !== 1) throw new TasraError('Session grant journal missing')
      const updated: SessionRecord = {...stored, revoking: true}
      commit.stage(key, updated)
      return updated
    })
  }
}

/**
 * A revoke that has not reached a quorum of every draw yet (`session_revoke_partial`, or the agent
 * stayed busy) within its deadline. The session no longer serves locally; retry `revoke()`.
 */
export class SessionRevokeIncompleteError extends TasraError {
  /** Always true: the same call may be repeated (each attempt signs a fresh seq). */
  readonly retryable = true
  /** The agent's last answer (`session_revoke_partial`, `session_rate_limited`, `status 503`, ...). */
  readonly code: string
  constructor(code: string) { super(`Session revoke incomplete (${code}); retry revoke()`); this.code = code }
}

/**
 * The agent answered 404 to a revoke: it holds no session for this grant, so no verifier was asked
 * and nothing confirmed the revocation. The session was still ended and its key disposed locally,
 * so it can never be refreshed (only this key could); the last issued grant runs to its `exp`.
 */
export class SessionRevokeUnconfirmedError extends TasraError {
  /** Retrying cannot help: the agent has no session to relay it for. */
  readonly retryable = false
  readonly code = 'session_unknown'
  constructor() { super('Session revoke not confirmed: the agent holds no session for this grant (ended locally; the grant expires at its exp)') }
}

/** Load a journaled session (same process, same key) after a restart of its owner, e.g. a tab reload with the key kept. */
export async function loadGrantedSession(opts: GrantedSessionOptions, sessionId: string): Promise<GrantedSession> {
  if (!HEX32.test(sessionId)) throw new TasraError('Invalid session id')
  const record = await opts.store.load<SessionRecord>(recordKey(sessionId))
  if (!record || record.schema !== 1) throw new TasraError('No session grant journal for this session')
  // Resume pins the chain too: a journal written for another deployment never serves this one.
  requireChain(opts, record.grant.chain_id)
  if (bytesToHex(sessionKeyThumbprint(opts.key.jwk)) !== bytesToHex(hexToBytes(record.grant.session_key_thumbprint))) throw new SessionGrantError('wrong-key', 'Session grant binds another session key')
  return new GrantedSession(opts, sessionId.toLowerCase(), record)
}
