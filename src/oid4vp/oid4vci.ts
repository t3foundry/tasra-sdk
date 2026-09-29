// OpenID4VCI pre-authorized credential issuance with holder-key proofs.

import {holderSigner, signCompactJws, type HolderKey} from './jose.js'

/** URI scheme for a wallet credential offer. */
export const CREDENTIAL_OFFER_SCHEME = 'openid-credential-offer://'
/** OAuth grant identifier for credential issuance using a pre-authorized code. */
export const PRE_AUTHORIZED_GRANT = 'urn:ietf:params:oauth:grant-type:pre-authorized_code'
/** JOSE type identifier for an OpenID4VCI proof of key possession. */
export const PROOF_TYP = 'openid4vci-proof+jwt'

/** Credential issuer, offered configurations and optional pre-authorized grant details. */
export interface CredentialOffer {
  /** Issuer identifier and metadata base URL. */
  credential_issuer: string
  /** Credential configurations available in the offer. */
  credential_configuration_ids: string[]
  /** Grant details, including any pre-authorized code and transaction code requirements. */
  grants?: Record<string, {'pre-authorized_code'?: string; tx_code?: {input_mode?: string; length?: number; description?: string}; authorization_server?: string}>
}

/**
 * Parse an `openid-credential-offer://?credential_offer=...` or `...?credential_offer_uri=...` URI.
 *
 * @param uri - OpenID4VCI credential-offer URI containing an offer or offer URL.
 */
export function parseCredentialOfferUri(uri: string): {offer?: CredentialOffer; offerUri?: string} {
  const q = uri.includes('?') ? uri.slice(uri.indexOf('?') + 1) : ''
  const params = new URLSearchParams(q)
  const byValue = params.get('credential_offer')
  const byRef = params.get('credential_offer_uri')
  if (byValue) return {offer: JSON.parse(byValue) as CredentialOffer}
  if (byRef) return {offerUri: byRef}
  throw new Error('credential offer URI carries neither credential_offer nor credential_offer_uri')
}

/** Issuer endpoints and credential configurations used during credential issuance. */
export interface IssuerMetadata {
  /** Issuer identifier used as the proof audience. */
  credential_issuer: string
  /** Endpoint accepting credential issuance requests. */
  credential_endpoint: string
  /** Optional endpoint for obtaining a proof nonce. */
  nonce_endpoint?: string
  /** Authorization servers associated with this issuer. */
  authorization_servers?: string[]
  /** Configuration identifiers mapped to credential formats and metadata. */
  credential_configurations_supported: Record<string, {format: string; vct?: string; [k: string]: unknown}>
}

/** Credential offer, holder key and optional transaction code for pre-authorized issuance. */
export interface ReceiveCredentialOpts {
  /** The scanned URI, or an already-parsed offer. */
  offerUri?: string
  /** Already parsed credential offer; takes precedence over offerUri. */
  offer?: CredentialOffer
  /** Holder key used to prove possession during issuance. */
  holder: HolderKey
  /** The transaction code the issuer displayed, when the grant asks for one. */
  txCode?: string
  /** Which configuration to request (default: the offer's first). */
  credentialConfigurationId?: string
  /** HTTP transport override; defaults to the global fetch implementation. */
  fetchImpl?: typeof fetch
  /** Current time override in Unix seconds. */
  nowSecs?: number
}

/** Issued compact credential with its selected configuration, format and issuer identifier. */
export interface ReceivedCredential {
  /** The compact `dc+sd-jwt` (or whatever the configuration's format is). */
  credential: string
  /** Credential configuration selected for issuance. */
  configurationId: string
  /** Credential format identifier. */
  format: string
  /** Credential issuer identifier returned by metadata. */
  issuer: string
}

async function getJson<T>(f: typeof fetch, url: string): Promise<T> {
  const res = await f(url, {headers: {Accept: 'application/json'}})
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return (await res.json()) as T
}

/**
 * Run the pre-authorized code flow end to end and return the issued credential.
 *
 * @param opts - Credential offer, holder key, optional transaction code and transport settings.
 */
export async function receiveCredential(opts: ReceiveCredentialOpts): Promise<ReceivedCredential> {
  const f = opts.fetchImpl ?? fetch
  let offer = opts.offer
  if (!offer) {
    if (!opts.offerUri) throw new Error('receiveCredential needs an offer or an offerUri')
    const parsed = parseCredentialOfferUri(opts.offerUri)
    offer = parsed.offer ?? (await getJson<CredentialOffer>(f, parsed.offerUri!))
  }
  const grant = offer.grants?.[PRE_AUTHORIZED_GRANT]
  const code = grant?.['pre-authorized_code']
  if (!code) throw new Error('credential offer carries no pre-authorized code grant')
  if (grant.tx_code && !opts.txCode) throw new Error('this offer requires a transaction code (tx_code)')
  const issuerUrl = offer.credential_issuer.replace(/\/$/, '')
  const meta = await getJson<IssuerMetadata>(f, `${issuerUrl}/.well-known/openid-credential-issuer`)
  const configId = opts.credentialConfigurationId ?? offer.credential_configuration_ids[0]
  if (!configId) throw new Error('credential offer names no credential configuration')
  const config = meta.credential_configurations_supported[configId]
  if (!config) throw new Error(`issuer does not advertise configuration ${configId}`)

  const asUrl = (grant.authorization_server ?? meta.authorization_servers?.[0] ?? issuerUrl).replace(/\/$/, '')
  const asMeta = await getJson<{token_endpoint: string}>(f, `${asUrl}/.well-known/oauth-authorization-server`).catch(() => getJson<{token_endpoint: string}>(f, `${asUrl}/.well-known/openid-configuration`))
  const tokenForm = new URLSearchParams({grant_type: PRE_AUTHORIZED_GRANT, 'pre-authorized_code': code, ...(opts.txCode ? {tx_code: opts.txCode} : {})})
  const tokenRes = await f(asMeta.token_endpoint, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json'}, body: tokenForm.toString()})
  if (!tokenRes.ok) throw new Error(`token endpoint → HTTP ${tokenRes.status}: ${(await tokenRes.text().catch(() => '')).slice(0, 200)}`)
  const token = (await tokenRes.json()) as {access_token: string; c_nonce?: string}

  let nonce = token.c_nonce
  if (!nonce && meta.nonce_endpoint) {
    const nres = await f(meta.nonce_endpoint, {method: 'POST'})
    if (nres.ok) nonce = ((await nres.json()) as {c_nonce?: string}).c_nonce
  }
  const proof = signCompactJws(
    {typ: PROOF_TYP, kid: `${opts.holder.did}#0`},
    {aud: meta.credential_issuer, iat: opts.nowSecs ?? Math.floor(Date.now() / 1000), ...(nonce ? {nonce} : {})},
    holderSigner(opts.holder),
  )
  const credRes = await f(meta.credential_endpoint, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token.access_token}`},
    body: JSON.stringify({credential_configuration_id: configId, proofs: {jwt: [proof]}}),
  })
  if (!credRes.ok) throw new Error(`credential endpoint → HTTP ${credRes.status}: ${(await credRes.text().catch(() => '')).slice(0, 200)}`)
  const body = (await credRes.json()) as {credential?: string; credentials?: Array<{credential: string}>}
  const credential = body.credentials?.[0]?.credential ?? body.credential
  if (!credential) throw new Error('credential response carries no credential')
  return {credential, configurationId: configId, format: config.format, issuer: meta.credential_issuer}
}
