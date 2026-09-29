// Resolve did:web verification methods by their identifiers.

import {b64url, type Jwk} from './jose.js'
import {base58Decode} from './jose.js'

/** DID document fields used to resolve a public verification key. */
export interface DidDocument {
  /** DID identified by this document. */
  id: string
  /** Public keys and verification method identifiers. */
  verificationMethod?: Array<{id: string; type?: string; controller?: string; publicKeyJwk?: Jwk; publicKeyMultibase?: string}>
  /** Verification methods authorized for authentication. */
  authentication?: Array<string | {id: string}>
  /** Verification methods authorized for assertions. */
  assertionMethod?: Array<string | {id: string}>
}

/**
 * The HTTPS URL a `did:web` resolves from (W3C did:web method).
 *
 * @param did - did:web identifier, with an optional fragment.
 */
export function didWebUrl(did: string): string {
  const m = /^did:web:(.+)$/.exec(did.split('#')[0]!)
  if (!m) throw new Error(`not a did:web: ${did}`)
  const segments = m[1]!.split(':').map(s => decodeURIComponent(s))
  const host = segments[0]!
  const path = segments.slice(1)
  return path.length === 0 ? `https://${host}/.well-known/did.json` : `https://${host}/${path.join('/')}/did.json`
}

/** Fetch implementation and optional loopback HTTP permission for did:web resolution. */
export interface ResolveOpts {
  /** HTTP transport override; defaults to the global fetch implementation. */
  fetchImpl?: typeof fetch
  /** Allow `http://` for a loopback host (tests, loopback services); never for a public host. */
  allowInsecureLoopback?: boolean
}

/**
 * Fetch and minimally validate a `did:web` document.
 *
 * @param did - did:web identifier to resolve.
 * @param opts - Fetch override and optional loopback HTTP permission.
 */
export async function resolveDidWeb(did: string, opts: ResolveOpts = {}): Promise<DidDocument> {
  let url = didWebUrl(did)
  if (opts.allowInsecureLoopback && /^https:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) url = url.replace(/^https:/, 'http:')
  const f = opts.fetchImpl ?? fetch
  const res = await f(url, {headers: {Accept: 'application/json'}})
  if (!res.ok) throw new Error(`did:web resolution ${url} → HTTP ${res.status}`)
  const doc = (await res.json()) as DidDocument
  if (doc.id !== did.split('#')[0]) throw new Error(`did:web document id ${doc.id} != ${did}`)
  return doc
}

/**
 * The JWK behind `kid` (a full DID URL or a `#fragment`) in `doc`.
 *
 * @param doc - Resolved DID document containing public verification methods.
 * @param kid - Signing key identifier or fragment to locate.
 */
export function verificationKey(doc: DidDocument, kid: string): Jwk {
  const frag = kid.includes('#') ? kid.slice(kid.indexOf('#')) : kid
  const vm = (doc.verificationMethod ?? []).find(v => v.id === kid || v.id === frag || v.id.endsWith(frag))
  if (!vm) throw new Error(`did document ${doc.id} has no verification method ${kid}`)
  if (vm.publicKeyJwk) return vm.publicKeyJwk
  if (vm.publicKeyMultibase) {
    const raw = base58Decode(vm.publicKeyMultibase.replace(/^z/, ''))
    if (raw[0] === 0xed && raw[1] === 0x01) return {kty: 'OKP', crv: 'Ed25519', x: b64url(raw.slice(2))}
    throw new Error('unsupported publicKeyMultibase codec')
  }
  throw new Error(`verification method ${vm.id} carries no key material`)
}
