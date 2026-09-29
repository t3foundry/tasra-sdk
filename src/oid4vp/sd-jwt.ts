// SD-JWT credentials with top-level selective disclosures and holder-key binding.
// Nested selective disclosures and array decoys are not supported.

import {sha256} from '@noble/hashes/sha256'
import {jsonCredential, FORMAT_DC_SD_JWT, type CredentialView} from '../auth/oid4vp.js'
import {b64url, b64urlDecode, decodeJson, didJwk, holderSigner, jwkFromDid, p256DidKey, p256PublicJwk, signCompactJws, utf8, verifyCompactJws, type HolderKey, type JwsSigner, type Jwk} from './jose.js'

/** JOSE type identifier for a selectively disclosable verifiable credential. */
export const SD_JWT_TYP = 'dc+sd-jwt'
/** JOSE type identifier for the holder key-binding JWT. */
export const KB_JWT_TYP = 'kb+jwt'

/** One top-level SD-JWT claim disclosure with its encoded value and digest. */
export interface Disclosure {
  /** base64url(JSON([salt, name, value])) - what travels on the wire. */
  encoded: string
  /** Random salt decoded from the disclosure. */
  salt: string
  /** Top-level claim name. */
  name: string
  /** Disclosed claim value. */
  value: unknown
  /** base64url(sha256(encoded)) - what the issuer JWT's `_sd` array holds. */
  digest: string
}

/** Decoded SD-JWT components with disclosure hashes checked; issuer signature verification is separate. */
export interface ParsedSdJwt {
  /** Original compact SD-JWT credential or presentation. */
  compact: string
  /** The issuer-signed JWT (first `~`-segment). */
  issuerJwt: string
  /** Decoded issuer JWT header; not authenticated by parsing alone. */
  header: Record<string, unknown>
  /** Decoded issuer JWT claims; not authenticated by parsing alone. */
  payload: Record<string, unknown>
  /** Decoded claim disclosures whose hashes match the issuer payload. */
  disclosures: Disclosure[]
  /** The Key Binding JWT, when the compact carries one (a presentation). */
  kbJwt?: string
}

/**
 * Compute the base64url SHA-256 digest of an encoded SD-JWT disclosure.
 *
 * @param encoded - Base64url-encoded SD-JWT disclosure string.
 */
export function disclosureDigest(encoded: string): string {
  return b64url(sha256(utf8(encoded)))
}
function decodeDisclosure(encoded: string): Disclosure {
  const arr = decodeJson<unknown[]>(encoded)
  if (!Array.isArray(arr) || arr.length !== 3 || typeof arr[0] !== 'string' || typeof arr[1] !== 'string') {
    throw new Error('SD-JWT disclosure is not [salt, name, value]')
  }
  return {encoded, salt: arr[0], name: arr[1], value: arr[2], digest: disclosureDigest(encoded)}
}

/**
 * Parse a compact SD-JWT and check each disclosed claim against the issuer payload's disclosure hashes. This does not verify the issuer signature.
 *
 * @param compact - Compact SD-JWT credential or presentation.
 */
export function parseSdJwt(compact: string): ParsedSdJwt {
  const parts = compact.split('~')
  const issuerJwt = parts[0]
  if (!issuerJwt || issuerJwt.split('.').length !== 3) throw new Error('SD-JWT: first segment is not a compact JWS')
  const [h, p] = issuerJwt.split('.')
  const header = decodeJson<Record<string, unknown>>(h!)
  const payload = decodeJson<Record<string, unknown>>(p!)
  const trailing = compact.endsWith('~')
  const middle = trailing ? parts.slice(1, -1) : parts.slice(1, -1)
  const kbJwt = trailing ? undefined : parts[parts.length - 1]
  if (kbJwt !== undefined && kbJwt.split('.').length !== 3) throw new Error('SD-JWT: trailing segment is neither empty nor a KB-JWT')
  const sd = new Set<string>(Array.isArray(payload._sd) ? (payload._sd as string[]) : [])
  const disclosures = middle.filter(d => d !== '').map(decodeDisclosure)
  for (const d of disclosures) {
    if (!sd.has(d.digest)) throw new Error(`SD-JWT: disclosure ${JSON.stringify(d.name)} is not in the issuer's _sd`)
  }
  return {compact, issuerJwt, header, payload, disclosures, kbJwt}
}

/**
 * The credential's claims as the verifier sees them: plain payload claims + disclosed ones.
 *
 * @param parsed - Parsed credential with disclosure hashes already checked.
 */
export function sdJwtClaims(parsed: ParsedSdJwt): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(parsed.payload)) {
    if (k === '_sd' || k === '_sd_alg') continue
    out[k] = v
  }
  for (const d of parsed.disclosures) out[d.name] = d.value
  return out
}

/**
 * A {@link CredentialView} for the DCQL evaluator: format `dc+sd-jwt`, `types` = [`vct`].
 *
 * @param parsed - Parsed credential to expose for advisory DCQL matching.
 */
export function sdJwtCredentialView(parsed: ParsedSdJwt): CredentialView {
  const claims = sdJwtClaims(parsed)
  const vct = typeof claims.vct === 'string' ? [claims.vct] : []
  return jsonCredential({format: FORMAT_DC_SD_JWT, types: vct, body: claims})
}

/**
 * `base64url(sha256(prefix))` where `prefix` is everything before the KB-JWT, trailing `~` included.
 *
 * @param prefix - Presentation prefix before the key-binding JWT, including the trailing tilde.
 */
export function sdHash(prefix: string): string {
  return b64url(sha256(utf8(prefix)))
}

// issuance

/** Issuer DID, optional signing key identifier and compact JWS signer. */
export interface SdJwtIssuer {
  /** The issuer DID the credential's `iss` names; `kid` = `${did}#${fragment}` unless given. */
  did: string
  /** Optional signing key identifier. */
  kid?: string
  /** Private-key signer for the issuer JWT. */
  signer: JwsSigner
}
/** Issuer, claims, holder binding and lifetime for a top-level selective-disclosure credential. */
export interface IssueSdJwtVcOpts {
  /** Issuer identity and signing key. */
  issuer: SdJwtIssuer
  /** Verifiable credential type identifier. */
  vct: string
  /** Every claim goes into a disclosure unless named in `plain` (which then travels in the clear). */
  claims: Record<string, unknown>
  /** Claim names to include directly in the issuer JWT instead of selective disclosures. */
  plain?: string[]
  /** The holder's key binding: `{kid: did:jwk...#0}` (Hovi's shape) or `{jwk}`. */
  cnf: {kid: string} | {jwk: Jwk}
  /** Subject DID, when the credential names one (`sub`); the verifier derives the holder from it first. */
  sub?: string
  /** Current time override in Unix seconds. */
  nowSecs?: number
  /** Credential lifetime in seconds; defaults to 365 days. */
  ttlSecs?: number
  /** Extra header members (e.g. a `typ` override); `alg` and `kid` are set here. */
  header?: Record<string, unknown>
  /** Secure random bytes used to salt each disclosure; defaults to 16 Web Crypto bytes. */
  random?: () => Uint8Array
}

/**
 * Mint a compact SD-JWT VC `issuer~d1~...~` with one disclosure per selectively disclosable claim.
 *
 * @param opts - Issuer key, claim values, holder binding and credential lifetime.
 */
export function issueSdJwtVc(opts: IssueSdJwtVcOpts): string {
  const now = opts.nowSecs ?? Math.floor(Date.now() / 1000)
  const random = opts.random ?? (() => crypto.getRandomValues(new Uint8Array(16)))
  const plain = new Set(opts.plain ?? [])
  const disclosures: Disclosure[] = []
  const clear: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(opts.claims)) {
    if (plain.has(name)) {
      clear[name] = value
      continue
    }
    const encoded = b64url(JSON.stringify([b64url(random()), name, value]))
    disclosures.push({encoded, salt: '', name, value, digest: disclosureDigest(encoded)})
  }
  const payload: Record<string, unknown> = {
    iss: opts.issuer.did,
    iat: now,
    exp: now + (opts.ttlSecs ?? 365 * 86400),
    vct: opts.vct,
    cnf: opts.cnf,
    ...(opts.sub !== undefined ? {sub: opts.sub} : {}),
    ...clear,
    _sd_alg: 'sha-256',
    _sd: disclosures.map(d => d.digest).sort(),
  }
  const kid = opts.issuer.kid ?? `${opts.issuer.did}#${opts.issuer.did.split(':').pop()}`
  const jwt = signCompactJws({typ: SD_JWT_TYP, kid, ...(opts.header ?? {})}, payload, opts.issuer.signer)
  return `${jwt}~${disclosures.map(d => d.encoded).join('~')}${disclosures.length ? '~' : ''}`
}

/**
 * The `cnf` a holder key binds to: `{kid: "<did:jwk>#0"}`, exactly as the Hovi wallet presents.
 *
 * @param holder - Holder did:jwk identifier to reference in the credential binding.
 */
export function holderCnf(holder: Pick<HolderKey, 'did'>): {kid: string} {
  return {kid: `${holder.did}#0`}
}

/**
 * A P-256 issuer as `did:key` (Hovi Studio's issuer shape) from a private scalar.
 *
 * @param privateKey - 32-byte P-256 private scalar.
 * @param opts - Whether kid should contain only the DID fragment.
 */
export function p256DidKeyIssuer(privateKey: Uint8Array, opts: {fragmentKid?: boolean} = {}): SdJwtIssuer {
  const pub = p256PublicJwk(privateKey)
  const raw = new Uint8Array([0x04, ...b64urlDecode(pub.x), ...b64urlDecode(pub.y)])
  const did = p256DidKey(raw)
  const fragment = did.slice('did:key:'.length)
  return {did, kid: opts.fragmentKid ? `#${fragment}` : `${did}#${fragment}`, signer: {alg: 'ES256', privateKey}}
}

/**
 * A P-256/ES256 `did:jwk` issuer from a private scalar. Other issuer algorithms are not supported by this helper.
 *
 * @param privateKey - 32-byte P-256 private scalar.
 * @param alg - Signing algorithm; this helper accepts only ES256.
 */
export function didJwkIssuer(privateKey: Uint8Array, alg: 'ES256' = 'ES256'): SdJwtIssuer {
  if (alg !== 'ES256') throw new Error('didJwkIssuer: only P-256 / ES256 is supported')
  const did = didJwk(p256PublicJwk(privateKey))
  return {did, kid: `${did}#0`, signer: {alg, privateKey}}
}

// presentation (holder side)

/** Selected disclosures and holder key for a nonce-bound, audience-bound SD-JWT presentation. */
export interface PresentSdJwtOpts {
  /** Parsed SD-JWT credential with disclosure hashes checked. */
  parsed: ParsedSdJwt
  /** Which disclosures to reveal: claim names, or `'all'`. Undisclosed claims stay hidden. */
  disclose: 'all' | readonly string[]
  /** Holder key matching the credential confirmation claim. */
  holder: HolderKey
  /** The JAR's `nonce`. */
  nonce: string
  /** The JAR's `client_id`, VERBATIM (prefix included). */
  aud: string
  /** Current time override in Unix seconds. */
  nowSecs?: number
  /** Extra KB-JWT claims (e.g. `transaction_data_hashes`). */
  extraKbClaims?: Record<string, unknown>
}

/**
 * Build the presentation `issuer~selected...~kb-jwt`, the KB-JWT signed by the holder's own key.
 *
 * @param opts - Parsed credential, disclosure selection, holder key, nonce and audience.
 */
export function presentSdJwt(opts: PresentSdJwtOpts): string {
  const want = opts.disclose === 'all' ? null : new Set(opts.disclose)
  const selected = opts.parsed.disclosures.filter(d => want === null || want.has(d.name))
  const prefix = `${opts.parsed.issuerJwt}~${selected.map(d => d.encoded).join('~')}${selected.length ? '~' : ''}`
  const kb = signCompactJws(
    {typ: KB_JWT_TYP},
    {
      nonce: opts.nonce,
      aud: opts.aud,
      iat: opts.nowSecs ?? Math.floor(Date.now() / 1000),
      sd_hash: sdHash(prefix),
      ...(opts.extraKbClaims ?? {}),
    },
    holderSigner(opts.holder),
  )
  return `${prefix}${kb}`
}

/**
 * Verify the holder signature, presentation hash, nonce and audience of a key-binding JWT. This does not verify the issuer signature, credential lifetime or issuer trust.
 *
 * @param presentation - Compact SD-JWT presentation including its key-binding JWT.
 * @param expected - Expected wallet challenge nonce and verifier audience.
 */
export function verifyKbJwt(presentation: string, expected: {nonce: string; aud: string}): {holderJwk: Jwk; claims: Record<string, unknown>} {
  const parsed = parseSdJwt(presentation)
  if (!parsed.kbJwt) throw new Error('presentation carries no KB-JWT')
  const cnf = parsed.payload.cnf as {kid?: string; jwk?: Jwk} | undefined
  if (!cnf) throw new Error('issuer JWT has no cnf claim')
  if (!cnf.jwk && !cnf.kid) throw new Error('cnf has neither jwk nor kid')
  const holderJwk: Jwk = cnf.jwk ?? jwkFromDid(cnf.kid!)
  const {header, payload} = verifyCompactJws<Record<string, unknown>>(parsed.kbJwt, holderJwk)
  if (header.typ !== KB_JWT_TYP) throw new Error(`KB-JWT typ must be ${KB_JWT_TYP}`)
  if (payload.nonce !== expected.nonce) throw new Error('KB-JWT nonce mismatch')
  const aud = payload.aud
  const audOk = typeof aud === 'string' ? aud === expected.aud : Array.isArray(aud) && aud.includes(expected.aud)
  if (!audOk) throw new Error('KB-JWT aud mismatch')
  const prefix = presentation.slice(0, presentation.length - parsed.kbJwt.length)
  if (payload.sd_hash !== sdHash(prefix)) throw new Error('KB-JWT sd_hash mismatch')
  return {holderJwk, claims: payload}
}

/**
 * Decode (no verification) the issuer JWT's payload of a compact SD-JWT - for display.
 *
 * @param compact - Compact SD-JWT credential or presentation to inspect without signature verification.
 */
export function peekSdJwt(compact: string): {iss?: string; vct?: string; exp?: number; sub?: string} {
  const p = parseSdJwt(compact).payload
  return {iss: p.iss as string | undefined, vct: p.vct as string | undefined, exp: p.exp as number | undefined, sub: p.sub as string | undefined}
}

