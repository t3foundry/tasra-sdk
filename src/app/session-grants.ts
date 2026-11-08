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
  type SessionGrant, type SessionGrantWire, type SessionKeyJwk, type VerifiedSessionGrant} from '../committee/session-grant.js'
import type {ApplicationStore} from './ready-slot.js'

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
  session_grant: {session_key: SessionKeyJwk; slots: string[]; access_ttl_secs: number; idle_timeout_secs: number; absolute_ttl_secs: number}
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
}

/** Where a session's refresh and revoke go, and how its slots are trusted. */
export interface SessionTransport {
  /** Approved verifier-agent origin. */
  agentUrl: string
  /** Guarded fetch (defaults to global fetch; redirects and credentials are always refused). */
  fetchImpl?: typeof fetch
  /** Verification material per granted slot, read from the chain by the caller. */
  trust(slot: `0x${string}`, epoch: bigint): Promise<SlotTrust>
}

/** A session that can no longer be refreshed: the application must present again. */
export class SessionEndedError extends TasraError {
  /** `session_expired`, `session_idle`, `session_revoked`, `session_replayed`, `session_status`, `session_rule_changed`, `unsupported` or `local-*`. */
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
}

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
  /** Clock override, Unix seconds (tests). */
  clock?: () => number
}

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
  await opts.store.withLock(recordKey(sessionId), async () => {
    if (await opts.store.load(recordKey(sessionId)) !== undefined) throw new TasraError('Session grant already accepted for this session')
    await opts.store.save(recordKey(sessionId), record)
  })
  return new GrantedSession(opts, sessionId, record)
}

async function checkGrant(opts: GrantedSessionOptions, grant: SessionGrant, requested: SessionRecord['requested'], previous: SessionGrant | undefined, at: number): Promise<VerifiedSessionGrant[]> {
  const p = grant.payload
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
    if (p.iat < q.iat) throw new SessionGrantError('refresh-changed', 'Refreshed grant is older than the current one')
  } else if (p.absoluteExp - p.iat > Math.min(requested.absoluteTtlSecs, MAX_ABSOLUTE_TTL_SECS)) {
    throw new SessionGrantError('absolute-exp', 'Session grant absolute lifetime exceeds the request')
  }
  // Every granted slot verifies against ITS OWN draw and policy before the grant is used for anything.
  const verified: VerifiedSessionGrant[] = []
  for (const slot of p.slots) {
    const hex = bytesToHex(slot.slotId) as `0x${string}`
    const trust = await opts.transport.trust(hex, p.epoch)
    verified.push(verifySessionGrant({grant, set: trust.set, slotId: slot.slotId, committee: trust.committee, quorum: trust.quorum, slotRuleHash: trust.ruleHash, now: at}))
  }
  return verified
}

const REFUSAL_CODES = new Set(['session_expired', 'session_idle', 'session_revoked', 'session_replayed', 'session_status', 'session_rule_changed'])

/** An accepted, refreshable session grant. */
export class GrantedSession {
  readonly sessionId: string
  #opts: GrantedSessionOptions
  #record: SessionRecord
  #timer: ReturnType<typeof setTimeout> | undefined
  #inflight: Promise<SessionGrantWire> | undefined

  /** @internal Use {@link acceptSessionGrant} or {@link loadGrantedSession}. */
  constructor(opts: GrantedSessionOptions, sessionId: string, record: SessionRecord) {
    this.#opts = opts; this.sessionId = sessionId; this.#record = record
  }

  #clock(): number { return (this.#opts.clock ?? now)() }

  /** The current grant on the wire, for keeper requests. Throws once the session ended or the grant is past its deadline. */
  current(): SessionGrantWire {
    const ended = this.#localEnd()
    if (ended) throw ended
    if (this.#clock() > this.#record.grant.exp) throw new SessionGrantError('expired', 'Session grant expired; refresh it first')
    return structuredClone(this.#record.grant)
  }

  /** Verified grant for one slot (re-verified against the slot's anchored committee). */
  async verifiedFor(slot: `0x${string}`): Promise<VerifiedSessionGrant> {
    const grant = decodeSessionGrant(this.current())
    const target = grant.payload.slots.find(s => bytesToHex(s.slotId).toLowerCase() === slot.toLowerCase())
    if (!target) throw new SessionGrantError('slot-not-granted', `slot ${slot} is not named by the session grant`)
    const trust = await this.#opts.transport.trust(slot, grant.payload.epoch)
    return verifySessionGrant({grant, set: trust.set, slotId: target.slotId, committee: trust.committee, quorum: trust.quorum, slotRuleHash: trust.ruleHash, now: this.#clock()})
  }

  /** The session key bound by this grant. */
  get key(): SessionKeyHandle { return this.#opts.key }

  #localEnd(): SessionEndedError | undefined {
    if (this.#record.ended) return new SessionEndedError(this.#record.ended.code, `Session ended (${this.#record.ended.code}); present again`)
    const t = this.#clock(), g = this.#record.grant
    if (t >= g.absolute_exp) return new SessionEndedError('local-absolute', 'Session reached its absolute expiry; present again')
    if (t - this.#record.lastRefresh > g.idle_timeout_secs) return new SessionEndedError('local-idle', 'Session idle timeout passed; present again')
    return undefined
  }

  async #end(error: SessionEndedError): Promise<never> {
    this.stop()
    const key = recordKey(this.sessionId)
    await this.#opts.store.withLock(key, async () => {
      const stored = await this.#opts.store.load<SessionRecord>(key)
      if (stored && !stored.ended) await this.#opts.store.save(key, {...stored, ended: {code: error.code, at: this.#clock()}})
    })
    this.#record = {...this.#record, ended: {code: error.code, at: this.#clock()}}
    this.#opts.onEnded?.(error)
    throw error
  }

  /** Reserve the next seq durably (store lock + save before signing), so a crash never reuses one. */
  async #reserveSeq(): Promise<{seq: number; grant: SessionGrantWire}> {
    const key = recordKey(this.sessionId)
    return this.#opts.store.withLock(key, async () => {
      const stored = await this.#opts.store.load<SessionRecord>(key)
      if (!stored || stored.schema !== 1) throw new TasraError('Session grant journal missing')
      const seq = stored.lastSeq + 1
      await this.#opts.store.save(key, {...stored, lastSeq: seq})
      this.#record = {...stored, lastSeq: seq}
      return {seq, grant: stored.grant}
    })
  }

  async #post(path: string, body: unknown): Promise<{status: number; json: unknown}> {
    const res = await (this.#opts.transport.fetchImpl ?? fetch)(`${this.#opts.transport.agentUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), redirect: 'error', credentials: 'omit'})
    const text = await res.text()
    if (text.length > 65_536) throw new TasraError('Session reply exceeds its byte limit')
    let json: unknown
    try { json = text ? JSON.parse(text) : undefined } catch { json = undefined }
    return {status: res.status, json}
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
    if (reply.status === 404) return this.#end(new SessionEndedError('unsupported', 'Verifiers do not support session refresh; present again'))
    const r = reply.json as {session_grant?: SessionGrantWire; refresh_seq?: unknown; code?: unknown}
    if (reply.status >= 400) {
      if (typeof r?.code === 'string' && REFUSAL_CODES.has(r.code)) return this.#end(new SessionEndedError(r.code, `Session refresh refused: ${r.code}`))
      throw new TasraError(`Session refresh failed (${reply.status}); retry before the grant expires`)
    }
    if (!r?.session_grant || r.refresh_seq !== seq) throw new TasraError('Session refresh reply does not answer this seq')
    const next = decodeSessionGrant(r.session_grant)
    await checkGrant(this.#opts, next, this.#record.requested, previous, this.#clock())
    const key = recordKey(this.sessionId)
    await this.#opts.store.withLock(key, async () => {
      const stored = await this.#opts.store.load<SessionRecord>(key)
      if (!stored || stored.lastSeq < seq) throw new TasraError('Session grant journal moved backwards')
      const updated: SessionRecord = {...stored, grant: structuredClone(r.session_grant!), lastRefresh: issuedAt}
      await this.#opts.store.save(key, updated)
      this.#record = updated
    })
    return structuredClone(r.session_grant)
  }

  /** Refresh in the background before each grant's `exp`, until stopped or the session ends. */
  start(): void {
    this.stop()
    const g = this.#record.grant
    const lead = this.#opts.refreshLeadSecs ?? Math.max(5, Math.floor((g.exp - g.iat) / 3))
    const delay = Math.max(0, (g.exp - lead - this.#clock()) * 1000)
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      this.refresh().then(() => this.start(), error => {
        if (error instanceof SessionEndedError) return
        // Transient: retry soon while the current grant still has time left.
        if (this.#clock() < this.#record.grant.exp) this.#timer = setTimeout(() => this.start(), 1000)
        else void this.#end(new SessionEndedError('local-expired', 'Session grant expired before a refresh succeeded; present again')).catch(() => undefined)
      })
    }, delay)
    ;(this.#timer as {unref?(): void}).unref?.()
  }

  /** Stop background refresh. */
  stop(): void { if (this.#timer) clearTimeout(this.#timer); this.#timer = undefined }

  /** Revoke at the verifiers (effective at the next refresh; an issued grant runs to its `exp`, at most 45 s), then end locally. */
  async revoke(): Promise<void> {
    this.stop()
    const {seq, grant} = await this.#reserveSeq()
    const issuedAt = this.#clock()
    const signature = await this.#opts.key.sign(sessionControlHash('revoke', sessionGrantHash(decodeSessionGrant(grant).payload), seq, issuedAt))
    const reply = await this.#post('/v1/sessions/revoke', {grant, seq, issued_at: issuedAt, signature: bytesToHex(signature)})
    if (reply.status >= 400 && reply.status !== 404) throw new TasraError(`Session revoke failed (${reply.status})`)
    await this.#end(new SessionEndedError('session_revoked', 'Session revoked')).catch(() => undefined)
    this.#opts.key.dispose()
  }
}

/** Load a journaled session (same process, same key) after a restart of its owner, e.g. a tab reload with the key kept. */
export async function loadGrantedSession(opts: GrantedSessionOptions, sessionId: string): Promise<GrantedSession> {
  if (!HEX32.test(sessionId)) throw new TasraError('Invalid session id')
  const record = await opts.store.load<SessionRecord>(recordKey(sessionId))
  if (!record || record.schema !== 1) throw new TasraError('No session grant journal for this session')
  if (bytesToHex(sessionKeyThumbprint(opts.key.jwk)) !== bytesToHex(hexToBytes(record.grant.session_key_thumbprint))) throw new SessionGrantError('wrong-key', 'Session grant binds another session key')
  return new GrantedSession(opts, sessionId.toLowerCase(), record)
}
