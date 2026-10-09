// Status refresh for an already-issued committee grant (`keykeeper/committee-status-refresh/v1`).
//
// A drawn verifier re-attests the holder's credential status for the SAME token, from its own
// durable issuance record: a fresh `keykeeper/committee-status-attestation/v1` statement over the
// unchanged token hash. No new token, session, payment or keeper stage exists afterwards; keepers
// accept the refreshed attestation exactly like the original one.
//
//   refresh_hash = keccak256("keykeeper/committee-status-refresh/v1"
//                            || chain_id (u64 BE) || token_hash (32)
//                            || payment_hash (32; all-zero when unpaid)
//                            || principal_kind (u8: 1 holder_key, 2 client_execution)
//                            || seq (u64 BE) || issued_at (i64 BE))
//
// The principal is the one the verifier recorded at issuance: the creator-certified client
// EXECUTION key of a paid grant (`client_execution`, a 0x-hex Ed25519 signature over the hash),
// or the holder key (`holder_key`, a compact JWS `typ: keykeeper-status-refresh+jwt` with payload
// `{"refresh":"0x<hash>"}` and the public key in the header `jwk`).
//
// ⚠ NOTHING A REFRESH RETURNS IS TRUSTED UNSIGNED. Every attestation is verified here under the
// ORIGINAL roster key of a verifier whose signature over the ORIGINAL token verifies; anything
// else is dropped. Each attestation must sit inside every hard cap of the grant minus the keeper
// skew (`status_until + 5 <= cap`). The merge keeps, per verifier index, the later `status_until`;
// a refresh succeeds only when the MERGED set (new attestations plus, in direct mode, the
// still-eligible originals) meets the keeper rule: the quorum-th largest `status_until` is fresh.
//
// ⚠ EVERY OUTCOME IS CLASSIFIED BEFORE ANYTHING IS MERGED (the same rule as the verifier-agent
// relay and the CLI): ANY verifier's `status_refresh_refused` (an explicit, current revocation)
// refuses the whole refresh - still-fresh original attestations never outvote it; another typed
// negative outcome ({@link withdrawsOriginal}) makes THAT verifier's original attestation
// ineligible for the merged result.
//
// ⚠ A refresh is never sent automatically and never retried here. One proof (one `seq`) may fan out
// to the original signers only; a new attempt needs a new, larger `seq` (each verifier keeps its own
// counter and answers 409 `status_refresh_replayed` otherwise).

import {keccak_256} from '@noble/hashes/sha3'
import {concatBytes} from '@noble/hashes/utils'
import {sha256} from '@noble/hashes/sha256'
import {ed25519} from '@noble/curves/ed25519'
import {p256} from '@noble/curves/p256'

import {bytesToHex, hexToBytes} from '../crypto/hex.js'
import {isStatusRefreshError, StatusRefreshError, type StatusRefreshCode, type StatusRefreshFailure} from '../errors.js'
import {parseRetryAfter} from '../internal/retryAfter.js'
import {b64url, type HolderKey, type Jwk, type JwsAlg} from '../oid4vp/jose.js'
import type {ClientExecutionSigner} from './execution.js'
import {
  assertStatusAttestationsWire,
  compoundTokenHash,
  decodeCompoundToken,
  signersThatVerify,
  verifyStatusAttestation,
  verifyStatusAttestations,
  STATUS_SKEW_SECS,
  type CompoundTokenWire,
  type StatusAttestation,
  type StatusAttestationWire,
  type VerifierSet,
} from './token.js'

/** Domain separator of the status-refresh proof (new name, `/v1`). */
export const STATUS_REFRESH_DOMAIN = 'keykeeper/committee-status-refresh/v1'
/** JOSE `typ` of a `holder_key` refresh proof. */
export const STATUS_REFRESH_JWT_TYP = 'keykeeper-status-refresh+jwt'
/** Verifier route (direct mode). */
export const STATUS_REFRESH_PATH = '/v1/committee/status-refresh'
/** Largest request body a verifier accepts, in bytes. */
export const MAX_STATUS_REFRESH_BODY_BYTES = 4096
/** A verifier accepts `|issued_at - now| <= 30 s`. */
export const STATUS_REFRESH_FRESHNESS_SECS = 30
/** Default deadline of one refresh HTTP exchange, ms. */
const DEFAULT_TIMEOUT_MS = 15_000
/** Largest response body read, bytes. */
const MAX_RESPONSE_BYTES = 64 * 1024

const DOMAIN_BYTES = new TextEncoder().encode(STATUS_REFRESH_DOMAIN)
const U64_MAX = (1n << 64n) - 1n
const HASH_HEX = /^0x[0-9a-fA-F]{64}$/
const SIGNATURE_HEX = /^(?:0x)?[0-9a-fA-F]{128}$/

/** Who proves the refresh: the principal the verifier recorded at issuance. */
export type StatusRefreshPrincipal = 'holder_key' | 'client_execution'
const PRINCIPAL_KIND: Record<StatusRefreshPrincipal, number> = {holder_key: 1, client_execution: 2}

/** Inputs of {@link statusRefreshHash}: exactly the signed list, nothing else. */
export interface StatusRefreshHashInput {
  /** Chain ID (u64). */
  chainId: number | bigint
  /** 32-byte canonical token hash ({@link compoundTokenHash}), unchanged by the refresh. */
  tokenHash: Uint8Array
  /** 32-byte ORIGINAL payment hash of a paid grant; omit (all-zero) for an unpaid grant. */
  paymentHash?: Uint8Array
  /** Principal kind. */
  principal: StatusRefreshPrincipal
  /** Strictly increasing per token per verifier; positive u64. */
  seq: number | bigint
  /** Unix seconds (i64); a verifier accepts it within 30 s of its clock. */
  issuedAt: number
}

function u64(value: number | bigint, name: string, min: bigint): Uint8Array {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error(`status refresh ${name} must be an integer`)
  if (typeof value !== 'number' && typeof value !== 'bigint') throw new Error(`status refresh ${name} must be an integer`)
  const n = BigInt(value)
  if (n < min || n > U64_MAX) throw new Error(`status refresh ${name} is out of range`)
  const b = new Uint8Array(8)
  new DataView(b.buffer).setBigUint64(0, n, false)
  return b
}

function i64(value: number, name: string): Uint8Array {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`status refresh ${name} must be a safe integer`)
  const b = new Uint8Array(8)
  new DataView(b.buffer).setBigInt64(0, BigInt(value), false)
  return b
}

function bytes32(value: Uint8Array | undefined, name: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== 32) throw new Error(`status refresh ${name} must be 32 bytes`)
  return value
}

/**
 * The 32-byte digest a refresh proof signs:
 * `keccak256(DOMAIN || chainId(u64 BE) || tokenHash || paymentHash|zero32 || principalKind(u8)
 * || seq(u64 BE) || issuedAt(i64 BE))`.
 *
 * @param input - Chain, token hash, original payment hash (paid only), principal, seq and issue time.
 */
export function statusRefreshHash(input: StatusRefreshHashInput): Uint8Array {
  const kind = PRINCIPAL_KIND[input.principal]
  if (kind === undefined) throw new Error('status refresh principal must be holder_key or client_execution')
  return keccak_256(concatBytes(
    DOMAIN_BYTES,
    u64(input.chainId, 'chain_id', 0n),
    bytes32(input.tokenHash, 'token hash'),
    input.paymentHash === undefined ? new Uint8Array(32) : bytes32(input.paymentHash, 'payment hash'),
    Uint8Array.of(kind),
    u64(input.seq, 'seq', 1n),
    i64(input.issuedAt, 'issued_at'),
  ))
}

/** Holder-key signer for a `holder_key` refresh proof. The key must be the one recorded at issuance. */
export interface StatusRefreshHolderSigner {
  /** `ES256` for a P-256 key, `EdDSA` for an Ed25519 key (the recorded algorithm). */
  alg: JwsAlg
  /** Public JWK placed in the JWS header (its thumbprint must equal the recorded one). */
  publicJwk: Jwk
  /** Raw JWS signature over the signing input (ES256: 64-byte r||s; EdDSA: 64 bytes). */
  sign(signingInput: Uint8Array): Uint8Array | Promise<Uint8Array>
}

function bareJwk(jwk: Jwk): Jwk {
  return jwk.kty === 'EC' ? {kty: 'EC', crv: jwk.crv, x: jwk.x, y: jwk.y} : {kty: 'OKP', crv: jwk.crv, x: jwk.x}
}

/**
 * A {@link StatusRefreshHolderSigner} over a local holder key (P-256 → ES256, Ed25519 → EdDSA).
 * The returned signer keeps a reference to `holder.privateKey`; the caller owns its lifetime.
 *
 * @param holder - Holder key the credential was bound to at issuance.
 */
export function statusRefreshHolderSigner(holder: HolderKey): StatusRefreshHolderSigner {
  const okp = holder.publicJwk.kty === 'OKP', key = holder.privateKey
  return {
    alg: okp ? 'EdDSA' : 'ES256',
    publicJwk: bareJwk(holder.publicJwk),
    sign: input => okp ? ed25519.sign(input, key) : p256.sign(sha256(input), key).toCompactRawBytes(),
  }
}

/** The principal and signer of one refresh proof. */
export type StatusRefreshProver =
  | {
    /** Principal kind: a paid grant proves with its ORIGINAL creator-certified execution key. */
    kind: 'client_execution'
    /** Signer over the original execution key. */
    signer: ClientExecutionSigner
  }
  | {
    /** Principal kind: the holder key recorded at issuance. */
    kind: 'holder_key'
    /** Signer over the holder key recorded at issuance. */
    signer: StatusRefreshHolderSigner
  }

/** One refresh proof on the wire. */
export interface StatusRefreshProofWire {
  /** Principal kind. */
  kind: StatusRefreshPrincipal
  /** Positive integer, strictly increasing per token per verifier. */
  seq: number
  /** Unix seconds. */
  issued_at: number
  /** `client_execution`: `0x` + 128 hex; `holder_key`: compact JWS. */
  signature: string
}

/** Inputs of {@link createStatusRefreshProof}. */
export interface CreateStatusRefreshProofOptions {
  /** Chain ID. */
  chainId: number | bigint
  /** 32-byte canonical token hash. */
  tokenHash: Uint8Array
  /** ORIGINAL payment hash of a paid grant (omit when unpaid). */
  paymentHash?: Uint8Array
  /** Journaled sequence number (positive safe integer). Never reuse one. */
  seq: number
  /** Unix seconds (default now). */
  issuedAt?: number
  /** Principal and signer. */
  prover: StatusRefreshProver
}

/**
 * Sign one refresh proof. `client_execution` signs the hash with the execution key
 * (`0x`-hex Ed25519); `holder_key` signs a compact JWS (`typ: keykeeper-status-refresh+jwt`,
 * header `jwk`, payload `{"refresh":"0x<hash>"}`).
 *
 * @param opts - Chain, token hash, original payment hash, seq, issue time and prover.
 */
export async function createStatusRefreshProof(opts: CreateStatusRefreshProofOptions): Promise<StatusRefreshProofWire> {
  if (!Number.isSafeInteger(opts.seq) || opts.seq < 1) throw new Error('status refresh seq must be a positive safe integer')
  const issuedAt = opts.issuedAt ?? Math.floor(Date.now() / 1000)
  const prover = opts.prover
  const hash = statusRefreshHash({chainId: opts.chainId, tokenHash: opts.tokenHash, paymentHash: opts.paymentHash,
    principal: prover.kind, seq: opts.seq, issuedAt})
  if (prover.kind === 'client_execution') {
    const signature = await prover.signer.sign(hash)
    if (!(signature instanceof Uint8Array) || signature.length !== 64
      || !ed25519.verify(signature, hash, prover.signer.publicKey, {zip215: false})) throw new Error('execution signer produced an invalid status refresh signature')
    return {kind: 'client_execution', seq: opts.seq, issued_at: issuedAt, signature: bytesToHex(signature)}
  }
  if (prover.kind !== 'holder_key') throw new Error('status refresh prover must be client_execution or holder_key')
  const signer = prover.signer
  if ((signer.alg === 'EdDSA') !== (signer.publicJwk.kty === 'OKP') || (signer.alg !== 'EdDSA' && signer.alg !== 'ES256')) {
    throw new Error('holder signer algorithm does not match its key type')
  }
  const header = {alg: signer.alg, typ: STATUS_REFRESH_JWT_TYP, jwk: bareJwk(signer.publicJwk)}
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify({refresh: bytesToHex(hash)}))}`
  const signature = await signer.sign(new TextEncoder().encode(input))
  if (!(signature instanceof Uint8Array) || signature.length !== 64) throw new Error('holder signer produced an invalid JWS signature')
  return {kind: 'holder_key', seq: opts.seq, issued_at: issuedAt, signature: `${input}.${b64url(signature)}`}
}

function assertProofWire(proof: StatusRefreshProofWire): StatusRefreshProofWire {
  if (!proof || typeof proof !== 'object' || (proof.kind !== 'holder_key' && proof.kind !== 'client_execution')
    || !Number.isSafeInteger(proof.seq) || proof.seq < 1 || !Number.isSafeInteger(proof.issued_at)
    || typeof proof.signature !== 'string' || !proof.signature) throw new Error('Invalid status refresh proof')
  if (proof.kind === 'client_execution' && !/^0x[0-9a-fA-F]{128}$/.test(proof.signature)) throw new Error('Invalid client_execution refresh signature')
  return {kind: proof.kind, seq: proof.seq, issued_at: proof.issued_at, signature: proof.signature}
}

function encodeBody(value: unknown): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(value))
  if (body.length > MAX_STATUS_REFRESH_BODY_BYTES) throw new Error(`status refresh body exceeds ${MAX_STATUS_REFRESH_BODY_BYTES} bytes`)
  return body
}

/**
 * The exact verifier request body `{chain_id, token_hash, proof}` (≤ 4096 bytes).
 *
 * @param chainId - Chain ID (a JavaScript safe integer).
 * @param tokenHash - 32-byte canonical token hash.
 * @param proof - Signed proof.
 */
export function statusRefreshRequestBody(chainId: number, tokenHash: Uint8Array, proof: StatusRefreshProofWire): Uint8Array {
  if (!Number.isSafeInteger(chainId) || chainId < 0) throw new Error('status refresh chain_id must be a safe non-negative integer')
  return encodeBody({chain_id: chainId, token_hash: bytesToHex(bytes32(tokenHash, 'token hash')), proof: assertProofWire(proof)})
}

/** One verifier's refresh reply - exactly these four keys. */
export interface StatusRefreshReplyWire {
  /** `0x` + 64 hex: the unchanged token hash. */
  token_hash: string
  /** The verifier's registry index (u32). */
  verifier_index: number
  /** Unix seconds the verifier now vouches until. */
  status_until: number
  /** 64-byte Ed25519 signature over the status-attestation hash, hex. */
  status_signature: string
}

const invalid = (message: string, verifierIndex?: number): StatusRefreshFailure =>
  ({...(verifierIndex !== undefined ? {verifierIndex} : {}), code: 'status_refresh_invalid_response', message})

/**
 * Strictly validate an untrusted verifier refresh reply. Throws {@link StatusRefreshError}
 * (`status_refresh_invalid_response`). Validates the SHAPE only; the signature is checked against
 * the original roster by the refresh functions.
 *
 * @param raw - Parsed JSON reply.
 */
export function parseStatusRefreshReply(raw: unknown): StatusRefreshReplyWire {
  const fail = (message: string) => new StatusRefreshError({code: 'status_refresh_invalid_response', message: `status refresh reply ${message}`})
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw fail('is not an object')
  const r = raw as Record<string, unknown>
  const keys = Object.keys(r)
  if (keys.length !== 4 || !['token_hash', 'verifier_index', 'status_until', 'status_signature'].every(k => Object.hasOwn(r, k))) {
    throw fail('is not exactly {token_hash, verifier_index, status_until, status_signature}')
  }
  const tokenHash = r.token_hash, index = r.verifier_index, until = r.status_until, signature = r.status_signature
  if (typeof tokenHash !== 'string' || !HASH_HEX.test(tokenHash)) throw fail('token_hash is not 0x + 32 bytes of hex')
  if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index > 0xffff_ffff) throw fail('verifier_index is not a u32')
  if (typeof until !== 'number' || !Number.isSafeInteger(until)) throw fail('status_until is not a safe integer')
  if (typeof signature !== 'string' || !SIGNATURE_HEX.test(signature)) throw fail('status_signature is not 64 bytes of hex')
  return {token_hash: tokenHash, verifier_index: index, status_until: until, status_signature: signature}
}

// HTTP status → the codes a server may send with it (the code must agree with the status).
const CODES_BY_STATUS: Partial<Record<number, readonly StatusRefreshCode[]>> = {
  401: ['status_refresh_unauthenticated'],
  403: ['status_refresh_unauthenticated', 'status_refresh_refused'],
  404: ['status_refresh_unknown'],
  409: ['status_refresh_unavailable', 'status_refresh_replayed', 'status_refresh_context_changed'],
  410: ['status_refresh_expired'],
  429: ['status_refresh_rate_limited'],
  503: ['status_refresh_unavailable_status', 'status_refresh_quorum_unmet'],
}
// A status whose meaning is unambiguous without a code.
const FALLBACK_BY_STATUS: Partial<Record<number, StatusRefreshCode>> = {
  401: 'status_refresh_unauthenticated', 404: 'status_refresh_unknown', 410: 'status_refresh_expired', 429: 'status_refresh_rate_limited',
}
const KNOWN_CODES = new Set<string>(Object.values(CODES_BY_STATUS).flatMap(codes => codes ?? []))

function findCode(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const code = (parsed as Record<string, unknown>).code
      if (typeof code === 'string' && KNOWN_CODES.has(code)) return code
    }
  } catch { /* not JSON: search the text */ }
  // Maximal `[a-z_]+` runs, so `status_refresh_unavailable_status` never reads as `..._unavailable`.
  for (const match of body.matchAll(/status_refresh_[a-z_]+/g)) if (KNOWN_CODES.has(match[0])) return match[0]
  return undefined
}

/**
 * Classify a non-200 refresh answer by its HTTP status and the stable code in its body. A code
 * that does not belong to the status is ignored; an unclassified answer is `status_refresh_http`.
 *
 * @param status - HTTP status.
 * @param body - Response body text.
 */
export function classifyStatusRefreshResponse(status: number, body: string): StatusRefreshCode {
  const found = findCode(body.slice(0, MAX_RESPONSE_BYTES))
  if (found !== undefined && CODES_BY_STATUS[status]?.includes(found as StatusRefreshCode)) return found as StatusRefreshCode
  return FALLBACK_BY_STATUS[status] ?? 'status_refresh_http'
}

/** The grant a refresh re-attests and the ORIGINAL trust it was verified under. */
export interface StatusRefreshGrant {
  /** The grant as journaled (its signatures and every hashed field are never changed). */
  token: CompoundTokenWire
  /** Keys of the token epoch's anchored roster: the keys the token signatures verified under. */
  set: VerifierSet
  /** The token's quorum. */
  quorum: number
  /** Further hard caps, Unix seconds (e.g. the payment expiry). The token `exp` is always one. */
  caps?: readonly number[]
}

/** A successful refresh. */
export interface StatusRefreshResult {
  /** The grant with `status_attestations` replaced by the merge; signatures and hashed fields unchanged. */
  token: CompoundTokenWire
  /** Merged attestations, one per counted verifier index (the later `status_until` wins), by index. */
  statusAttestations: StatusAttestationWire[]
  /** Indexes whose NEW attestation was accepted. */
  refreshed: number[]
  /** Effective status deadline over the merged list (the quorum-th largest), Unix seconds. */
  statusUntil: number
  /** Verifiers that contributed nothing, and why. */
  failures: StatusRefreshFailure[]
  /**
   * Original signers whose ORIGINAL attestation must not rejoin this result: withdrawn by their own
   * typed negative outcome (direct), or left out of the relay's answer (relay: the relay's set is
   * the whole answer). A caller merging with a journaled list drops these indexes from it.
   */
  ineligible: number[]
}

/**
 * Whether a verifier's typed refresh outcome withdraws its ORIGINAL attestation from the merged
 * result: the verifier, answering for this token, said its status statement does not stand now
 * (revoked, past a cap, the principal does not verify, its context moved, it cannot read status,
 * or the proof replays). Transport, unknown or malformed outcomes withdraw nothing.
 *
 * @param code - A failure's code.
 */
export function withdrawsOriginal(code: StatusRefreshCode): boolean {
  return code === 'status_refresh_refused' || code === 'status_refresh_expired' || code === 'status_refresh_unauthenticated'
    || code === 'status_refresh_context_changed' || code === 'status_refresh_unavailable_status' || code === 'status_refresh_replayed'
}

interface PreparedGrant {
  wire: CompoundTokenWire
  tokenHash: Uint8Array
  counted: number[]
  set: VerifierSet
  quorum: number
  cap: number
}

function prepareGrant(grant: StatusRefreshGrant): PreparedGrant {
  const token = decodeCompoundToken(grant.token)
  if (!Number.isSafeInteger(grant.quorum) || grant.quorum < 1) throw new Error('status refresh quorum must be a positive integer')
  const counted = signersThatVerify(token, grant.set)
  if (counted.length < grant.quorum) throw new Error(`original grant carries ${counted.length} verified signatures under the supplied roster, need ${grant.quorum}`)
  let cap = Number(token.exp)
  for (const c of grant.caps ?? []) {
    if (!Number.isSafeInteger(c)) throw new Error('status refresh caps must be Unix seconds')
    cap = Math.min(cap, c)
  }
  return {wire: grant.token, tokenHash: compoundTokenHash(token), counted, set: grant.set, quorum: grant.quorum, cap}
}

/** Local check before anything is sent: the grant still has a usable window under its caps. */
function assertRefreshable(p: PreparedGrant, now: number): void {
  if (p.cap - STATUS_SKEW_SECS <= now) {
    throw new StatusRefreshError({code: 'status_refresh_expired',
      message: `status refresh not sent: a hard cap of the grant (${p.cap}) minus the ${STATUS_SKEW_SECS} s keeper skew has passed`})
  }
}

function aggregateFailure(failures: StatusRefreshFailure[], got: number, need: number): StatusRefreshError {
  const retryAfter = failures.reduce<number | undefined>((max, f) => f.retryAfterMs === undefined ? max : Math.max(max ?? 0, f.retryAfterMs), undefined)
  const detail = failures.map(f => `${f.verifierIndex !== undefined ? `#${f.verifierIndex} ` : ''}${f.code}`).join('; ')
  const message = `status refresh: ${got} of ${need} required fresh attestations${detail ? ` (${detail})` : ''}`
  // `status_refresh_refused` never reaches here: acceptRefresh refuses on it before any merge.
  // Every original signer failed the same way: that code is the answer. Otherwise the quorum is unmet.
  const first = failures[0]
  if (got === 0 && first && failures.every(f => f.code === first.code)) {
    return new StatusRefreshError({code: first.code, httpStatus: first.httpStatus, message, reasons: failures, retryAfterMs: retryAfter})
  }
  const transient = failures.some(f => ['status_refresh_rate_limited', 'status_refresh_unavailable_status', 'status_refresh_unreachable', 'status_refresh_quorum_unmet'].includes(f.code)
    || (f.code === 'status_refresh_http' && f.httpStatus !== undefined && (f.httpStatus >= 500 || f.httpStatus === 429)))
  return new StatusRefreshError({code: 'status_refresh_quorum_unmet', message, reasons: failures, retryAfterMs: retryAfter, retryable: transient})
}

/**
 * The relay's and the CLI's order, exactly: (1) classify - any revocation refusal refuses the whole
 * refresh, another typed negative outcome withdraws that verifier's original; (2) accept new
 * attestations only from original verified signers, verified under their original keys, fresh and
 * capped; (3) merge per index with the still-eligible originals (`mergeExisting`, direct mode: each
 * original re-verified and capped the same way; a relay answer is already the whole set); (4) judge
 * the MERGED set by the keeper rule (quorum-th largest `status_until`, fresh at `now`). The number
 * of NEW attestations alone is never the judge: one fresh reply beside a still-fresh eligible
 * original can meet the quorum.
 */
function acceptRefresh(p: PreparedGrant, candidates: StatusAttestation[], failures: StatusRefreshFailure[], now: number,
  mergeExisting: boolean): StatusRefreshResult {
  const refused = failures.filter(f => f.code === 'status_refresh_refused')
  if (refused.length) {
    const detail = refused.map(f => `${f.verifierIndex !== undefined ? `#${f.verifierIndex} ` : ''}${f.code}`).join('; ')
    throw new StatusRefreshError({code: 'status_refresh_refused', httpStatus: 403, reasons: failures,
      message: `status refresh: the holder's credential status is refused now (${detail}); do not send this grant`})
  }
  const ineligible = new Set(failures.flatMap(f => f.verifierIndex !== undefined && withdrawsOriginal(f.code) ? [f.verifierIndex] : []))
  const accepted = new Map<number, StatusAttestation>()
  for (const a of candidates) {
    const index = a.verifierIndex
    if (!p.counted.includes(index)) { failures.push(invalid('attestation from a verifier that did not verifiably sign the original token', index)); continue }
    const pubkey = p.set.pubkeys.get(index)
    if (!pubkey || !verifyStatusAttestation(pubkey, p.tokenHash, a)) { failures.push(invalid('attestation does not verify under the original roster key', index)); continue }
    if (a.statusUntil + STATUS_SKEW_SECS > p.cap) { failures.push(invalid(`status_until ${a.statusUntil} + ${STATUS_SKEW_SECS} s passes the grant cap ${p.cap}`, index)); continue }
    if (now > a.statusUntil + STATUS_SKEW_SECS) { failures.push(invalid(`attestation is already stale (status_until ${a.statusUntil})`, index)); continue }
    const prior = accepted.get(index)
    if (!prior || a.statusUntil > prior.statusUntil) accepted.set(index, a)
  }
  // The journaled list, filtered to what a keeper would count (a bad counted entry would refuse
  // the whole grant) and to the grant caps (as the CLI's `authenticate_all`), then merged per
  // index: the later deadline wins. A stale original stays in the list; the judge below does not
  // count it.
  const merged = new Map<number, StatusAttestation>()
  let existing: StatusAttestationWire[] = []
  if (mergeExisting && p.wire.status_attestations != null) {
    try { existing = assertStatusAttestationsWire(p.wire.status_attestations, p.wire.verifier_indexes.length) }
    catch { existing = [] } // a malformed journaled list contributes nothing (the CLI's `.ok().flatten()`)
  }
  for (const w of existing) {
    if (ineligible.has(w.verifier_index)) continue // withdrawn by that verifier's own negative outcome
    const a: StatusAttestation = {verifierIndex: w.verifier_index, statusUntil: w.status_until, signature: hexToBytes(w.signature)}
    const pubkey = p.set.pubkeys.get(a.verifierIndex)
    if (!p.counted.includes(a.verifierIndex) || !pubkey || !verifyStatusAttestation(pubkey, p.tokenHash, a)) continue
    if (a.statusUntil + STATUS_SKEW_SECS > p.cap) continue
    merged.set(a.verifierIndex, a)
  }
  // A relay's set is its whole answer: every original signer it left out stays out.
  if (!mergeExisting) for (const i of p.counted) if (!accepted.has(i)) ineligible.add(i)
  for (const [index, a] of accepted) {
    const prior = merged.get(index)
    if (!prior || a.statusUntil > prior.statusUntil) merged.set(index, a)
  }
  const list = [...merged.values()].sort((x, y) => x.verifierIndex - y.verifierIndex)
  // The keeper rule on the MERGED set is the only judge; below it, this refresh's quorum is unmet.
  let statusUntil: number
  try { statusUntil = verifyStatusAttestations({tokenHash: p.tokenHash, attestations: list, counted: p.counted, set: p.set, quorum: p.quorum, now}) }
  catch { throw aggregateFailure(failures, list.filter(a => now <= a.statusUntil + STATUS_SKEW_SECS).length, p.quorum) }
  const statusAttestations = list.map(a => ({verifier_index: a.verifierIndex, status_until: a.statusUntil, signature: bytesToHex(a.signature)}))
  return {token: {...structuredClone(p.wire), status_attestations: structuredClone(statusAttestations)}, statusAttestations,
    refreshed: [...accepted.keys()].sort((x, y) => x - y), statusUntil, failures, ineligible: [...ineligible].sort((x, y) => x - y)}
}

/** A bounded HTTP answer. */
export interface StatusRefreshHttpResponse {
  /** HTTP status. */
  status: number
  /** Body bytes or text. */
  body: Uint8Array | string
  /** Parsed `Retry-After`, ms. */
  retryAfterMs?: number
}

const text = (body: Uint8Array | string) => typeof body === 'string' ? body : new TextDecoder().decode(body)

function failureOf(response: StatusRefreshHttpResponse, verifierIndex?: number): StatusRefreshFailure {
  const body = text(response.body)
  return {...(verifierIndex !== undefined ? {verifierIndex} : {}), code: classifyStatusRefreshResponse(response.status, body), httpStatus: response.status,
    ...(response.retryAfterMs !== undefined ? {retryAfterMs: response.retryAfterMs} : {}),
    message: `HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`}
}

const oversize = (status: number, detail: string) => new StatusRefreshError({code: 'status_refresh_invalid_response', httpStatus: status,
  message: `status refresh response ${detail} exceeds ${MAX_RESPONSE_BYTES} bytes`})

/**
 * Read at most {@link MAX_RESPONSE_BYTES} of a response body, whatever its status. An advertised
 * `Content-Length` over the cap is refused without reading (skipped under a `Content-Encoding`,
 * where it counts encoded bytes); otherwise the stream is read chunk by chunk and cancelled as soon
 * as the running total passes the cap, so a lying or absent length never buffers more than one
 * chunk past it. Throws {@link StatusRefreshError} `status_refresh_invalid_response`.
 */
async function readBoundedBody(res: Response): Promise<string> {
  const advertised = res.headers?.get('content-length')
  if (advertised && !res.headers.get('content-encoding') && /^\d+$/.test(advertised) && Number(advertised) > MAX_RESPONSE_BYTES) {
    void res.body?.cancel().catch(() => {})
    throw oversize(res.status, `Content-Length ${advertised}`)
  }
  if (!res.body) return ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let size = 0, out = ''
  try {
    for (;;) {
      const {done, value} = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_RESPONSE_BYTES) throw oversize(res.status, 'body')
      out += decoder.decode(value, {stream: true})
    }
    return out + decoder.decode()
  } finally {
    // Also on the cap refusal. Initiate cancellation without waiting on a hostile body's cancel hook.
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

async function post(fetchImpl: typeof fetch, url: string, body: Uint8Array, signal: AbortSignal, bearer?: string): Promise<StatusRefreshHttpResponse> {
  const res = await fetchImpl(url, {method: 'POST', redirect: 'error', signal, body: new TextDecoder().decode(body),
    headers: {'Content-Type': 'application/json', ...(bearer !== undefined ? {Authorization: `Bearer ${bearer}`} : {})}})
  const raw = await readBoundedBody(res)
  const retryAfterMs = parseRetryAfter(res.headers?.get('retry-after'))
  return {status: res.status, body: raw, ...(retryAfterMs !== undefined ? {retryAfterMs} : {})}
}

function endpoint(url: string, allowHttp: boolean): string {
  let parsed: URL
  try { parsed = new URL(url) } catch { throw new Error('Invalid status refresh endpoint') }
  if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) throw new Error('Status refresh endpoints must use https')
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Invalid status refresh endpoint')
  return parsed.origin + parsed.pathname.replace(/\/+$/, '')
}

/** Options of {@link refreshStatusDirect}. */
export interface RefreshStatusDirectOptions extends StatusRefreshGrant {
  /** Chain ID (the one the proof signs). */
  chainId: number
  /** One signed proof; fanned out unchanged to the original signers. */
  proof: StatusRefreshProofWire
  /** Verifier base URLs by registry index. Only indexes that verifiably signed the token are called. */
  verifiers: readonly {index: number; url: string}[]
  /** Fetch implementation (default global fetch). */
  fetch?: typeof fetch
  /** Permit `http:` endpoints (local development only). */
  allowHttp?: boolean
  /** Cancellation. */
  signal?: AbortSignal
  /** Per-verifier deadline, ms (default 15000). */
  timeoutMs?: number
}

/**
 * Refresh a grant's status directly at its original signers' verifiers
 * (`POST /v1/committee/status-refresh`), verify every reply under the original roster, and merge.
 * Sends the one proof once per original signer; never retries.
 *
 * @param opts - Grant, roster, quorum, caps, chain, proof and verifier endpoints.
 * @returns The merged grant and its new effective deadline.
 * @throws StatusRefreshError when fewer than a quorum of fresh, valid, capped attestations arrive.
 */
export async function refreshStatusDirect(opts: RefreshStatusDirectOptions): Promise<StatusRefreshResult> {
  const p = prepareGrant(opts)
  assertRefreshable(p, Math.floor(Date.now() / 1000))
  const body = statusRefreshRequestBody(opts.chainId, p.tokenHash, opts.proof)
  const fetchImpl = opts.fetch ?? globalThis.fetch
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('Invalid status refresh timeout')
  const urls = new Map<number, string>()
  for (const v of opts.verifiers) {
    if (!p.counted.includes(v.index)) continue // never fan out beyond the original verified signers
    if (urls.has(v.index)) throw new Error(`Duplicate status refresh endpoint for verifier #${v.index}`)
    urls.set(v.index, endpoint(v.url, opts.allowHttp === true) + STATUS_REFRESH_PATH)
  }
  const failures: StatusRefreshFailure[] = p.counted.filter(i => !urls.has(i))
    .map(i => ({verifierIndex: i, code: 'status_refresh_unreachable' as const, message: 'no endpoint supplied for this original signer'}))
  const tokenHashHex = bytesToHex(p.tokenHash)
  const candidates: StatusAttestation[] = []
  await Promise.all([...urls].map(async ([index, url]) => {
    const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(opts.signal ? [opts.signal] : [])])
    let response: StatusRefreshHttpResponse
    try { response = await post(fetchImpl, url, body, signal) }
    catch (error) {
      if (isStatusRefreshError(error)) { // an oversized answer: typed, not a transport failure
        failures.push({verifierIndex: index, code: error.code, ...(error.httpStatus !== undefined ? {httpStatus: error.httpStatus} : {}), message: error.message.slice(0, 200)})
        return
      }
      failures.push({verifierIndex: index, code: 'status_refresh_unreachable', message: error instanceof Error ? error.message.slice(0, 200) : 'no answer'})
      return
    }
    if (response.status !== 200) { failures.push(failureOf(response, index)); return }
    let reply: StatusRefreshReplyWire
    try { reply = parseStatusRefreshReply(JSON.parse(text(response.body)) as unknown) }
    catch (error) { failures.push(invalid(error instanceof Error ? error.message : 'unparseable reply', index)); return }
    if (reply.verifier_index !== index) { failures.push(invalid(`reply names verifier #${reply.verifier_index}`, index)); return }
    if (reply.token_hash.toLowerCase() !== tokenHashHex) { failures.push(invalid('reply is for another token', index)); return }
    candidates.push({verifierIndex: index, statusUntil: reply.status_until, signature: hexToBytes(reply.status_signature)})
  }))
  opts.signal?.throwIfAborted()
  return acceptRefresh(p, candidates, failures, Math.floor(Date.now() / 1000), true)
}

/**
 * Verify a verifier-agent relay answer (`POST /v1/sessions/:id/status-refresh`). A 200 body must
 * be exactly `{token_hash, status_attestations}`; each attestation is re-verified here under the
 * original roster (the agent is not trusted). A non-200 answer becomes a typed
 * {@link StatusRefreshError}, with the relay's per-index `reasons` when it sent them.
 *
 * @param grant - Grant, original roster, quorum and caps.
 * @param response - The relay's bounded HTTP answer.
 */
export function acceptStatusRefreshRelay(grant: StatusRefreshGrant, response: StatusRefreshHttpResponse): StatusRefreshResult {
  const p = prepareGrant(grant)
  const bodyText = text(response.body)
  if (response.status !== 200) {
    const failure = failureOf(response)
    const reasons: StatusRefreshFailure[] = []
    try {
      const parsed = JSON.parse(bodyText) as {reasons?: unknown}
      if (Array.isArray(parsed.reasons)) {
        for (const entry of parsed.reasons.slice(0, 64) as unknown[]) {
          if (!entry || typeof entry !== 'object') continue
          const e = entry as Record<string, unknown>, index = e.verifier_index, rawCode = e.code ?? e.error
          const code = typeof rawCode === 'string' ? rawCode : ''
          if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) continue
          reasons.push({verifierIndex: index, code: KNOWN_CODES.has(code) ? code as StatusRefreshCode : 'status_refresh_http', message: code.slice(0, 200)})
        }
      }
    } catch { /* no structured reasons */ }
    throw new StatusRefreshError({code: failure.code, httpStatus: response.status, retryAfterMs: response.retryAfterMs,
      message: `status refresh relay: ${failure.message}`, reasons: [failure, ...reasons]})
  }
  const fail = (message: string) => new StatusRefreshError({code: 'status_refresh_invalid_response', httpStatus: 200, message: `status refresh relay reply ${message}`})
  let parsed: unknown
  try { parsed = JSON.parse(bodyText) } catch { throw fail('is not JSON') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw fail('is not an object')
  const r = parsed as Record<string, unknown>
  if (Object.keys(r).length !== 2 || !Object.hasOwn(r, 'token_hash') || !Object.hasOwn(r, 'status_attestations')) throw fail('is not exactly {token_hash, status_attestations}')
  if (typeof r.token_hash !== 'string' || r.token_hash.toLowerCase() !== bytesToHex(p.tokenHash)) throw fail('is for another token')
  let list: StatusAttestationWire[]
  try { list = assertStatusAttestationsWire(r.status_attestations, p.wire.verifier_indexes.length) }
  catch (error) { throw fail(error instanceof Error ? error.message : 'carries malformed attestations') }
  const candidates = list.map(w => ({verifierIndex: w.verifier_index, statusUntil: w.status_until, signature: hexToBytes(w.signature)}))
  return acceptRefresh(p, candidates, [], Math.floor(Date.now() / 1000), false)
}

/** Options of {@link refreshStatusViaAgent}. */
export interface RefreshStatusViaAgentOptions extends StatusRefreshGrant {
  /** Verifier-agent base URL (the one that ran the session). */
  agentUrl: string
  /** Session identity. */
  sessionId: string
  /** The session's owner bearer (`poll_secret`). Never logged. */
  pollSecret: string
  /** One signed proof. */
  proof: StatusRefreshProofWire
  /** Fetch implementation (default global fetch). */
  fetch?: typeof fetch
  /** Permit an `http:` agent URL (local development only). */
  allowHttp?: boolean
  /** Cancellation. */
  signal?: AbortSignal
  /** Deadline, ms (default 15000). */
  timeoutMs?: number
}

/**
 * Refresh a grant's status through the verifier-agent relay. The agent fans the proof out to the
 * original signers; its answer is re-verified here exactly as in {@link refreshStatusDirect}.
 *
 * @param opts - Grant, roster, quorum, caps, agent session and proof.
 * @throws StatusRefreshError on a typed refusal, an unsigned or forged reply, or no fresh quorum.
 */
export async function refreshStatusViaAgent(opts: RefreshStatusViaAgentOptions): Promise<StatusRefreshResult> {
  const p = prepareGrant(opts)
  assertRefreshable(p, Math.floor(Date.now() / 1000))
  if (typeof opts.sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(opts.sessionId)) throw new Error('Invalid verifier-agent session id')
  if (typeof opts.pollSecret !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/.test(opts.pollSecret)) throw new Error('Invalid verifier-agent session secret')
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('Invalid status refresh timeout')
  const url = `${endpoint(opts.agentUrl, opts.allowHttp === true)}/v1/sessions/${opts.sessionId}/status-refresh`
  const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(opts.signal ? [opts.signal] : [])])
  let response: StatusRefreshHttpResponse
  try { response = await post(opts.fetch ?? globalThis.fetch, url, encodeBody({proof: assertProofWire(opts.proof)}), signal, opts.pollSecret) }
  catch (error) {
    opts.signal?.throwIfAborted()
    if (isStatusRefreshError(error)) throw error // an oversized answer stays `status_refresh_invalid_response`
    throw new StatusRefreshError({code: 'status_refresh_unreachable', message: 'status refresh relay did not answer', cause: error})
  }
  return acceptStatusRefreshRelay(opts, response)
}

/**
 * The relay request body `{proof}` (for a caller-owned transport).
 *
 * @param proof - Refresh proof, validated before it is encoded.
 */
export function statusRefreshRelayBody(proof: StatusRefreshProofWire): Uint8Array {
  return encodeBody({proof: assertProofWire(proof)})
}
