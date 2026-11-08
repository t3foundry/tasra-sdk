// ADR-0090 D7 session grants: one presentation, many KEM decrypts. The client half of the
// reference `keykeeper_committee::session_grant` (design: docs/plans/session-grants.md in the
// network repo). Canonical bytes, hashes and thumbprints must agree byte-for-byte with it;
// `test/specs/committee.session-grant.test.ts` pins them against the reference vectors.
//
// Pure: no HTTP, no chain. The caller supplies the anchored verifier set and each slot's policy.

import {keccak_256} from '@noble/hashes/sha3'
import {sha256} from '@noble/hashes/sha256'
import {concatBytes} from '@noble/hashes/utils'
import {ed25519} from '@noble/curves/ed25519'
import {p256} from '@noble/curves/p256'

import {bytesToHex, hexToBytes} from '../crypto/hex.js'
import {TasraError} from '../errors.js'
import {BINDING_HOLDER_KEY, BINDING_ISSUER_ASSERTED, BINDING_UNBOUND, MAX_STATUS_WINDOW_SECS, DEFAULT_STATUS_WINDOW_SECS, STATUS_SKEW_SECS,
  selectVerifierCommittee, type VerifierSet} from './token.js'

const utf8 = (s: string) => new TextEncoder().encode(s)

/** Domain of the quorum-signed grant bytes. */
export const SESSION_GRANT_DOMAIN = 'keykeeper-committee/session-grant/v1'
/** Domain of a single-operation session-key proof. */
export const SESSION_PROOF_DOMAIN = 'keykeeper-committee/session-proof/v1'
/** Domain of a batch session-key proof; a one-item batch proof never verifies as a single proof. */
export const SESSION_BATCH_PROOF_DOMAIN = 'keykeeper-committee/session-batch-proof/v1'
/** Domain of a refresh request signed by the session key (plan: phase 1's own domain). */
export const SESSION_REFRESH_DOMAIN = 'keykeeper-committee/session-refresh/v1'
/** Domain of a revoke request signed by the session key. */
export const SESSION_REVOKE_DOMAIN = 'keykeeper-committee/session-revoke/v1'

/** Most slots one grant may name. */
export const MAX_SESSION_SLOTS = 16
/** Most items one batch proof may cover. */
export const MAX_BATCH_ITEMS = 64
/** Longest `exp - iat`: the status attestation's longest window (the grant's `exp` is its status deadline). */
export const MAX_ACCESS_TTL_SECS = MAX_STATUS_WINDOW_SECS
/** Default `exp - iat` when the SDK requests none. */
export const DEFAULT_ACCESS_TTL_SECS = DEFAULT_STATUS_WINDOW_SECS
/** Longest idle period between two refreshes (30 min). */
export const MAX_IDLE_TIMEOUT_SECS = 30 * 60
/** Longest a session may live from its opening presentation (12 h). */
export const MAX_ABSOLUTE_TTL_SECS = 12 * 3600
/** `|proof.iat - now|` a keeper accepts. */
export const SESSION_PROOF_FRESHNESS_SECS = 30
/** Bounds of a proof's `jti` (URL-safe characters only). */
export const MIN_JTI_LEN = 16
export const MAX_JTI_LEN = 64
/** Most signatures a grant may carry (one per possible committee member). */
const MAX_GRANT_SIGNATURES = 4096

const HEX32 = /^0x[0-9a-fA-F]{64}$/
const HEX64B = /^0x[0-9a-fA-F]{128}$/
const JTI = /^[A-Za-z0-9_-]+$/

/** One slot a grant authorizes and the rule its committee evaluated (keccak256 of the RAW rule). */
export interface GrantSlot {
  /** 32-byte slot identifier. */
  slotId: Uint8Array
  /** keccak256 of the raw rule bytes, the same value a compound token carries. */
  ruleHash: Uint8Array
}

/** The bytes a verifier quorum signs. Build through {@link sessionGrantPayload}, which enforces every bound. */
export interface SessionGrantPayload {
  chainId: bigint
  sessionId: Uint8Array
  holderHash: Uint8Array
  sessionKeyThumbprint: Uint8Array
  /** Binding strength byte (`BINDING_*` in token.ts). */
  binding: number
  /** Always `decrypt` (KEM only). */
  action: 'decrypt'
  seed: Uint8Array
  epoch: bigint
  /** Strictly ascending by slot id. */
  slots: GrantSlot[]
  iat: number
  exp: number
  idleTimeoutSecs: number
  absoluteExp: number
}

/** A grant as received: payload plus `(verifierIndex, ed25519 signature)` pairs over its signing hash. */
export interface SessionGrant {
  payload: SessionGrantPayload
  signatures: {verifierIndex: number; signature: Uint8Array}[]
}

/** One granted slot on the wire. */
export interface GrantSlotWire { slot_id: string; rule_hash: string }
/** One verifier signature on the wire. */
export interface GrantSignatureWire { verifier_index: number; signature: string }
/** The session grant as the verifier-agent returns it and the client sends it to keepers. */
export interface SessionGrantWire {
  chain_id: number
  session_id: string
  holder_hash: string
  session_key_thumbprint: string
  binding: string
  action: string
  seed: string
  epoch: number
  slots: GrantSlotWire[]
  iat: number
  exp: number
  idle_timeout_secs: number
  absolute_exp: number
  signatures: GrantSignatureWire[]
}
/** A session-key proof on the wire. */
export interface SessionProofWire { iat: number; jti: string; signature: string }

/** A refused grant, key or proof. `code` names the failed check. */
export class SessionGrantError extends TasraError {
  /** Stable reason (`slot-not-granted`, `expired`, `quorum-not-met`, ...). */
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}
const refuse = (code: string, message: string): never => { throw new SessionGrantError(code, message) }

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}
function compare(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! < b[i]! ? -1 : 1
  return a.length - b.length
}
function u32be(n: number): Uint8Array { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, false); return b }
function u64be(n: bigint | number): Uint8Array { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), false); return b }
function i64be(n: bigint | number): Uint8Array { const b = new Uint8Array(8); new DataView(b.buffer).setBigInt64(0, BigInt(n), false); return b }
function safeInt(n: unknown, field: string, min = Number.MIN_SAFE_INTEGER): number {
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < min) refuse('malformed', `malformed session grant field ${field}`)
  return n as number
}
function hex32(s: unknown, field: string): Uint8Array {
  if (typeof s !== 'string' || !HEX32.test(s)) refuse('malformed', `malformed session grant field ${field}`)
  return hexToBytes(s as string)
}
/** Unpadded base64url (RFC 4648 §5), as JWK members and jtis use. */
export function toBase64Url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function unb64url(s: unknown): Uint8Array {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) refuse('bad-key', 'JWK coordinate is not base64url')
  const padded = (s as string).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - ((s as string).length % 4)) % 4)
  const raw = atob(padded)
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

const BINDING_WIRE: Record<string, number> = {unbound: BINDING_UNBOUND, holder_key: BINDING_HOLDER_KEY, issuer_asserted: BINDING_ISSUER_ASSERTED}
const BINDING_NAME: Record<number, string> = {[BINDING_UNBOUND]: 'unbound', [BINDING_HOLDER_KEY]: 'holder_key', [BINDING_ISSUER_ASSERTED]: 'issuer_asserted'}

/**
 * Validate and build a grant payload with the reference bounds: KEM decrypt only, 1..16 strictly
 * ascending slots, `0 < exp - iat <= 45`, `1 <= idle <= 1800`, `exp <= absoluteExp <= iat + 12 h`.
 * @param p - Every payload field.
 */
export function sessionGrantPayload(p: SessionGrantPayload): SessionGrantPayload {
  if (p.action !== 'decrypt') refuse('unsupported-action', `session grant action ${String(p.action)} is not supported (KEM decrypt only)`)
  if (!Array.isArray(p.slots) || p.slots.length === 0 || p.slots.length > MAX_SESSION_SLOTS) refuse('slot-count', `session grant names ${p.slots?.length} slots (need 1..=${MAX_SESSION_SLOTS})`)
  for (const s of p.slots) if (s.slotId.length !== 32 || s.ruleHash.length !== 32) refuse('malformed', 'grant slot fields must be 32 bytes')
  for (let i = 1; i < p.slots.length; i++) if (compare(p.slots[i - 1]!.slotId, p.slots[i]!.slotId) >= 0) refuse('slot-order', `session grant slots are not strictly ascending at index ${i}`)
  for (const [name, v] of [['session_id', p.sessionId], ['holder_hash', p.holderHash], ['session_key_thumbprint', p.sessionKeyThumbprint], ['seed', p.seed]] as const) {
    if (!(v instanceof Uint8Array) || v.length !== 32) refuse('malformed', `malformed session grant field ${name}`)
  }
  if (!(p.binding in BINDING_NAME)) refuse('malformed', 'malformed session grant field binding')
  if (p.chainId < 0n || p.chainId > 0xffff_ffff_ffff_ffffn || p.epoch < 0n || p.epoch > 0xffff_ffff_ffff_ffffn) refuse('malformed', 'grant chain id or epoch out of range')
  const ttl = p.exp - p.iat
  if (!Number.isSafeInteger(p.iat) || !Number.isSafeInteger(p.exp) || !(ttl > 0 && ttl <= MAX_ACCESS_TTL_SECS)) refuse('lifetime', `session grant lifetime invalid: iat ${p.iat}, exp ${p.exp}`)
  if (!Number.isSafeInteger(p.idleTimeoutSecs) || p.idleTimeoutSecs < 1 || p.idleTimeoutSecs > MAX_IDLE_TIMEOUT_SECS) refuse('idle-timeout', `session grant idle timeout ${p.idleTimeoutSecs} s is invalid`)
  if (!Number.isSafeInteger(p.absoluteExp) || p.absoluteExp < p.exp || p.absoluteExp > p.iat + MAX_ABSOLUTE_TTL_SECS) refuse('absolute-exp', `session grant absolute expiry ${p.absoluteExp} is out of bounds`)
  return {...p, slots: p.slots.map(s => ({slotId: s.slotId.slice(), ruleHash: s.ruleHash.slice()}))}
}

/** The canonical grant bytes (reference module docs give the layout). */
export function sessionGrantCanonicalBytes(p: SessionGrantPayload): Uint8Array {
  const action = utf8(p.action)
  return concatBytes(utf8(SESSION_GRANT_DOMAIN), u64be(p.chainId), p.sessionId, p.holderHash, p.sessionKeyThumbprint, Uint8Array.of(p.binding),
    u32be(action.length), action, p.seed, u64be(p.epoch), u32be(p.slots.length), ...p.slots.flatMap(s => [s.slotId, s.ruleHash]),
    i64be(p.iat), i64be(p.exp), u32be(p.idleTimeoutSecs), i64be(p.absoluteExp))
}

/** keccak256 of the canonical bytes: what each verifier signs and every session proof binds to. */
export function sessionGrantHash(p: SessionGrantPayload): Uint8Array {
  return keccak_256(sessionGrantCanonicalBytes(p))
}

/** Decode a wire grant through the payload bounds. Refuses unknown fields and malformed hex. */
export function decodeSessionGrant(wire: SessionGrantWire): SessionGrant {
  const w = wire as unknown as Record<string, unknown>
  if (!w || typeof w !== 'object' || Array.isArray(w)) refuse('malformed', 'session grant is not an object')
  const allowed = new Set(['chain_id', 'session_id', 'holder_hash', 'session_key_thumbprint', 'binding', 'action', 'seed', 'epoch', 'slots', 'iat', 'exp', 'idle_timeout_secs', 'absolute_exp', 'signatures'])
  for (const k of Object.keys(w)) if (!allowed.has(k)) refuse('malformed', `unknown session grant field ${k}`)
  if (!Array.isArray(w.slots) || w.slots.length > MAX_SESSION_SLOTS) refuse('slot-count', 'session grant slots missing or too many')
  if (!Array.isArray(w.signatures) || w.signatures.length > MAX_GRANT_SIGNATURES) refuse('malformed', 'session grant signatures missing or too many')
  const binding = BINDING_WIRE[w.binding as string]
  if (binding === undefined) refuse('malformed', 'malformed session grant field binding')
  if (w.action !== 'decrypt') refuse('unsupported-action', 'session grants are KEM decrypt only')
  const slots = (w.slots as unknown[]).map(s => {
    const o = s as Record<string, unknown>
    if (!o || typeof o !== 'object' || Object.keys(o).some(k => k !== 'slot_id' && k !== 'rule_hash')) refuse('malformed', 'malformed grant slot')
    return {slotId: hex32(o.slot_id, 'slot_id'), ruleHash: hex32(o.rule_hash, 'rule_hash')}
  })
  const payload = sessionGrantPayload({
    chainId: BigInt(safeInt(w.chain_id, 'chain_id', 0)), sessionId: hex32(w.session_id, 'session_id'), holderHash: hex32(w.holder_hash, 'holder_hash'),
    sessionKeyThumbprint: hex32(w.session_key_thumbprint, 'session_key_thumbprint'), binding: binding!, action: 'decrypt',
    seed: hex32(w.seed, 'seed'), epoch: BigInt(safeInt(w.epoch, 'epoch', 0)), slots, iat: safeInt(w.iat, 'iat'), exp: safeInt(w.exp, 'exp'),
    idleTimeoutSecs: safeInt(w.idle_timeout_secs, 'idle_timeout_secs', 0), absoluteExp: safeInt(w.absolute_exp, 'absolute_exp'),
  })
  const signatures = (w.signatures as unknown[]).map(s => {
    const o = s as Record<string, unknown>
    if (!o || typeof o !== 'object' || Object.keys(o).some(k => k !== 'verifier_index' && k !== 'signature')) refuse('malformed', 'malformed grant signature')
    if (typeof o.signature !== 'string' || !HEX64B.test(o.signature)) refuse('malformed', 'malformed grant signature')
    return {verifierIndex: safeInt(o.verifier_index, 'verifier_index', 0), signature: hexToBytes(o.signature as string)}
  })
  return {payload, signatures}
}

/** Encode a grant to its wire form (the inverse of {@link decodeSessionGrant}). */
export function encodeSessionGrant(grant: SessionGrant): SessionGrantWire {
  const p = grant.payload
  return {
    chain_id: Number(p.chainId), session_id: bytesToHex(p.sessionId), holder_hash: bytesToHex(p.holderHash), session_key_thumbprint: bytesToHex(p.sessionKeyThumbprint),
    binding: BINDING_NAME[p.binding]!, action: p.action, seed: bytesToHex(p.seed), epoch: Number(p.epoch),
    slots: p.slots.map(s => ({slot_id: bytesToHex(s.slotId), rule_hash: bytesToHex(s.ruleHash)})),
    iat: p.iat, exp: p.exp, idle_timeout_secs: p.idleTimeoutSecs, absolute_exp: p.absoluteExp,
    signatures: grant.signatures.map(s => ({verifier_index: s.verifierIndex, signature: bytesToHex(s.signature)})),
  }
}

/** What a grant verified for ONE slot attests. */
export interface VerifiedSessionGrant {
  /** The grant's signing hash; every session proof binds to it. */
  grantHash: Uint8Array
  slotId: Uint8Array
  chainId: bigint
  holderHash: Uint8Array
  sessionKeyThumbprint: Uint8Array
  binding: number
  iat: number
  exp: number
  /** Distinct drawn verifiers of this slot whose signatures verified. */
  verifiedSigners: number[]
}

/** The anchored set and the slot's own policy a grant is verified against. */
export interface VerifySessionGrantOptions {
  grant: SessionGrant
  /** Active verifier set (registry size + index → Ed25519 key), established independently. */
  set: VerifierSet
  /** Slot to be served. */
  slotId: Uint8Array
  /** The slot's committee size and quorum. */
  committee: number
  quorum: number
  /** keccak256 of the slot's raw rule, read independently. */
  slotRuleHash: Uint8Array
  /** Current time, Unix seconds. */
  now: number
}

/**
 * Verify a grant for serving one slot, with the reference steps in their order: the slot is
 * granted with the slot's own rule; the quorum is non-zero; `now <= exp + 5` and `now + 5 >= iat`
 * (the status deadline, never a token leeway); the slot's OWN draw `(slot, epoch, seed)`; every
 * signature verifies strictly (a forged one refuses the grant); a quorum of the slot's drawn
 * committee signed. Signatures from outside the draw are checked but do not count.
 * @param o - Grant, verifier set, slot policy and time.
 */
export function verifySessionGrant(o: VerifySessionGrantOptions): VerifiedSessionGrant {
  const p = o.grant.payload
  const slot = p.slots.find(s => equal(s.slotId, o.slotId)) ?? refuse('slot-not-granted', `slot ${bytesToHex(o.slotId)} is not named by the session grant`)
  if (!equal(slot.ruleHash, o.slotRuleHash)) refuse('rule-mismatch', 'grant rule_hash does not match the slot rule hash')
  if (!Number.isInteger(o.quorum) || o.quorum < 1) refuse('zero-quorum', 'invalid policy: quorum must be >= 1')
  if (o.now > p.exp + STATUS_SKEW_SECS) refuse('expired', `session grant expired at ${p.exp}`)
  if (o.now + STATUS_SKEW_SECS < p.iat) refuse('not-yet-valid', `session grant not yet valid (iat ${p.iat})`)
  const expected = selectVerifierCommittee(o.slotId, p.epoch, p.seed, o.set.registrySize, o.committee)
  const hash = sessionGrantHash(p)
  const verified: number[] = []
  for (const {verifierIndex, signature} of o.grant.signatures) {
    const pk = o.set.pubkeys.get(verifierIndex) ?? refuse('unknown-verifier', `signer index ${verifierIndex} is not in the active verifier set`)
    // RFC 8032 strict verification, the counterpart of the reference `verify_strict`.
    let ok: boolean
    try { ok = signature.length === 64 && ed25519.verify(signature, hash, pk, {zip215: false}) } catch { ok = false }
    if (!ok) refuse('bad-signature', `invalid grant signature from verifier index ${verifierIndex}`)
    if (expected.includes(verifierIndex) && !verified.includes(verifierIndex)) verified.push(verifierIndex)
  }
  if (verified.length < o.quorum) refuse('quorum-not-met', `quorum not met for the slot: ${verified.length} of its drawn committee signed, need ${o.quorum}`)
  return {grantHash: hash, slotId: o.slotId.slice(), chainId: p.chainId, holderHash: p.holderHash.slice(), sessionKeyThumbprint: p.sessionKeyThumbprint.slice(),
    binding: p.binding, iat: p.iat, exp: p.exp, verifiedSigners: verified}
}

/** A public session key JWK (RFC 7517) with exactly the RFC 7638 required members. */
export type SessionKeyJwk = {kty: 'OKP'; crv: 'Ed25519'; x: string} | {kty: 'EC'; crv: 'P-256'; x: string; y: string}

/** Parse a public session JWK; any private member or unsupported curve is refused. */
export function parseSessionKeyJwk(jwk: unknown): SessionKeyJwk {
  const o = jwk as Record<string, unknown>
  if (!o || typeof o !== 'object' || Array.isArray(o)) refuse('bad-key', 'JWK is not an object')
  if ('d' in o) refuse('bad-key', 'JWK carries a private member')
  if (o.kty === 'OKP' && o.crv === 'Ed25519') {
    const x = unb64url(o.x)
    if (x.length !== 32) refuse('bad-key', 'Ed25519 x is not 32 bytes')
    try { ed25519.ExtendedPoint.fromHex(x) } catch { refuse('bad-key', 'not an Ed25519 point') }
    return {kty: 'OKP', crv: 'Ed25519', x: toBase64Url(x)}
  }
  if (o.kty === 'EC' && o.crv === 'P-256') {
    const x = unb64url(o.x), y = unb64url(o.y)
    if (x.length !== 32 || y.length !== 32) refuse('bad-key', 'P-256 coordinates are not 32 bytes')
    try { p256.ProjectivePoint.fromHex(concatBytes(Uint8Array.of(4), x, y)).assertValidity() } catch { refuse('bad-key', 'not a P-256 point') }
    return {kty: 'EC', crv: 'P-256', x: toBase64Url(x), y: toBase64Url(y)}
  }
  return refuse('bad-key', 'unsupported kty/crv')
}

/** RFC 7638 thumbprint: SHA-256 of the required members in lexicographic order, no whitespace. */
export function sessionKeyThumbprint(jwk: SessionKeyJwk): Uint8Array {
  const k = parseSessionKeyJwk(jwk)
  const canonical = k.kty === 'OKP' ? `{"crv":"Ed25519","kty":"OKP","x":"${k.x}"}` : `{"crv":"P-256","kty":"EC","x":"${k.x}","y":"${k.y}"}`
  return sha256(utf8(canonical))
}

function lenPrefixedJti(jti: string): Uint8Array {
  checkJti(jti)
  const b = utf8(jti)
  return concatBytes(Uint8Array.of(b.length), b)
}

/** Refuse a jti outside 16..64 URL-safe characters. */
export function checkJti(jti: string): void {
  if (typeof jti !== 'string' || jti.length < MIN_JTI_LEN || jti.length > MAX_JTI_LEN || !JTI.test(jti)) refuse('bad-jti', `proof jti invalid (need ${MIN_JTI_LEN}..=${MAX_JTI_LEN} URL-safe characters)`)
}

/** `keccak256(SESSION_PROOF_DOMAIN ‖ grant_hash ‖ request_hash ‖ iat i64 BE ‖ len(jti) u8 ‖ jti)`. */
export function sessionProofHash(grantHash: Uint8Array, requestHash: Uint8Array, iat: number, jti: string): Uint8Array {
  if (grantHash.length !== 32 || requestHash.length !== 32) refuse('malformed', 'grant and request hashes must be 32 bytes')
  return keccak_256(concatBytes(utf8(SESSION_PROOF_DOMAIN), grantHash, requestHash, i64be(iat), lenPrefixedJti(jti)))
}

/** `keccak256(SESSION_BATCH_PROOF_DOMAIN ‖ grant_hash ‖ count u32 BE ‖ request_hash* ‖ iat ‖ len(jti) ‖ jti)`, items in order. */
export function sessionBatchProofHash(grantHash: Uint8Array, requestHashes: Uint8Array[], iat: number, jti: string): Uint8Array {
  if (requestHashes.length === 0 || requestHashes.length > MAX_BATCH_ITEMS) refuse('batch-size', `batch proof covers ${requestHashes.length} items (need 1..=${MAX_BATCH_ITEMS})`)
  if (grantHash.length !== 32 || requestHashes.some(h => h.length !== 32)) refuse('malformed', 'grant and request hashes must be 32 bytes')
  return keccak_256(concatBytes(utf8(SESSION_BATCH_PROOF_DOMAIN), grantHash, u32be(requestHashes.length), ...requestHashes, i64be(iat), lenPrefixedJti(jti)))
}

/**
 * The 32-byte hash a session key signs to refresh (or revoke) a grant:
 * `keccak256(domain ‖ grant_hash ‖ seq u64 BE ‖ issued_at i64 BE)`.
 * ⚠ The plan names the inputs but not their integer widths; u64/i64 BE follow the grant module.
 */
export function sessionControlHash(kind: 'refresh' | 'revoke', grantHash: Uint8Array, seq: number, issuedAt: number): Uint8Array {
  if (grantHash.length !== 32 || !Number.isSafeInteger(seq) || seq < 0 || !Number.isSafeInteger(issuedAt)) refuse('malformed', 'invalid session control inputs')
  return keccak_256(concatBytes(utf8(kind === 'refresh' ? SESSION_REFRESH_DOMAIN : SESSION_REVOKE_DOMAIN), grantHash, u64be(seq), i64be(issuedAt)))
}

/**
 * Verify a 64-byte session-key signature over a 32-byte hash exactly as a keeper does: Ed25519
 * strict, or ES256 (ECDSA over SHA-256 of the hash, `r ‖ s`; high-S accepted like WebCrypto).
 * @param jwk - Public session key.
 * @param hash - 32-byte proof or control hash.
 * @param signature - 64-byte signature.
 */
export function verifySessionSignature(jwk: SessionKeyJwk, hash: Uint8Array, signature: Uint8Array): boolean {
  const k = parseSessionKeyJwk(jwk)
  if (signature.length !== 64 || hash.length !== 32) return false
  try {
    if (k.kty === 'OKP') return ed25519.verify(signature, hash, unb64url(k.x), {zip215: false})
    return p256.verify(signature, sha256(hash), concatBytes(Uint8Array.of(4), unb64url(k.x), unb64url(k.y)), {lowS: false, prehash: false})
  } catch { return false }
}

/** A client-side check that a proof would pass a keeper's freshness and key checks. */
export function checkProofWindow(grant: VerifiedSessionGrant, jwk: SessionKeyJwk, proof: {iat: number; jti: string}, now: number): void {
  if (!equal(sessionKeyThumbprint(jwk), grant.sessionKeyThumbprint)) refuse('wrong-key', 'session key thumbprint does not match the grant')
  checkJti(proof.jti)
  const fresh = Math.abs(proof.iat - now) <= SESSION_PROOF_FRESHNESS_SECS && proof.iat + STATUS_SKEW_SECS >= grant.iat && proof.iat <= grant.exp + STATUS_SKEW_SECS
  if (!fresh) refuse('proof-stale', `proof iat ${proof.iat} is outside the accepted window`)
}

/** Encode a proof for the wire. */
export function encodeSessionProof(proof: {iat: number; jti: string; signature: Uint8Array}): SessionProofWire {
  checkJti(proof.jti)
  if (proof.signature.length !== 64) refuse('malformed', 'proof signature must be 64 bytes')
  return {iat: proof.iat, jti: proof.jti, signature: bytesToHex(proof.signature)}
}
