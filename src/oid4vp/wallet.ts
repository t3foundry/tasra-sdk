// OpenID4VP presentation using one selected SD-JWT credential, selective
// disclosure, holder-key binding and optional encrypted wallet responses.

import {select, credentialMatches, validate, type CredentialView, type Query} from '../auth/oid4vp.js'
import {encryptJwe, type JweEnc} from './jwe.js'
import type {HolderKey} from './jose.js'
import {fetchRequestObject, parseOpenid4vpUri, responseEncryptionKey, type VerifiedRequestObject, type VerifyRequestObjectOpts} from './request-object.js'
import {parseSdJwt, presentSdJwt, sdJwtCredentialView, type ParsedSdJwt} from './sd-jwt.js'

/** A credential the wallet holds. */
export interface HeldSdJwt {
  /** Compact SD-JWT credential stored by the wallet. */
  sdJwt: string
  /** For the consent screen. */
  label?: string
}

/** Held credential that matches a named DCQL query during local selection. */
export interface PresentationCandidate {
  /** Original held credential and its display label. */
  held: HeldSdJwt
  /** Parsed SD-JWT credential with disclosure hashes checked. */
  parsed: ParsedSdJwt
  /** Credential claims exposed for advisory DCQL matching. */
  view: CredentialView
  /** The credential query id this credential answers. */
  queryId: string
}

/** Advisory credential selection, available candidates and unmatched query identifiers. */
export interface PresentationPlan {
  /** Whether the local (advisory) selection found a credential that satisfies the request. */
  satisfies: boolean
  /** Every held credential that answers some query - the choice to offer the user. */
  candidates: PresentationCandidate[]
  /** The default choice (the evaluator's pick), when satisfied. */
  chosen?: PresentationCandidate
  /** Query ids nothing in the wallet answers. */
  unmatched: string[]
}

/**
 * Match held SD-JWT VCs against the request's `dcql_query`. Expired credentials are skipped.
 * Advisory: the drawn verifiers decide; a wrong local answer costs a wasted request, never access.
 *
 * @param ro - Verified request claims containing the DCQL query.
 * @param held - Held SD-JWT credentials to consider.
 * @param nowSecs - Current time in Unix seconds for excluding expired credentials.
 */
export function planPresentation(ro: Pick<VerifiedRequestObject, 'claims'>, held: readonly HeldSdJwt[], nowSecs = Math.floor(Date.now() / 1000)): PresentationPlan {
  // A wallet reads the rule as dispatched; the issuer-entry mandate is the platform's.
  const query = validate(JSON.stringify(ro.claims.dcql_query), {requireIssuer: false})
  const live = held.flatMap(h => {
    try {
      const parsed = parseSdJwt(h.sdJwt)
      const exp = parsed.payload.exp
      if (typeof exp === 'number' && exp <= nowSecs) return []
      return [{held: h, parsed, view: sdJwtCredentialView(parsed)}]
    } catch {
      return []
    }
  })
  const candidates: PresentationCandidate[] = []
  for (const q of query.credentials) {
    for (const c of live) {
      if (credentialMatches(q, c.view)) candidates.push({...c, queryId: q.id})
    }
  }
  const sel = select(JSON.stringify(ro.claims.dcql_query), live.map(c => c.view), {requireIssuer: false})
  const chosenView = sel.credentials[0]
  const chosen = chosenView ? candidates.find(c => c.view === chosenView) : undefined
  return {satisfies: sel.satisfied && sel.credentials.length === 1 && chosen !== undefined, candidates, chosen, unmatched: sel.unsatisfied}
}

/**
 * The top-level claim names a credential query asks to see.
 *
 * @param query - Parsed DCQL query.
 * @param queryId - Identifier of the credential query to inspect.
 */
export function requestedClaimNames(query: Query, queryId: string): string[] {
  const q = query.credentials.find(c => c.id === queryId)
  return [...new Set((q?.claims ?? []).map(c => c.path[0]).filter((n): n is string => typeof n === 'string'))]
}

/** Verified request, selected credential, holder key and disclosure options for a wallet response. */
export interface BuildResponseOpts {
  /** Verified request claims to bind the response to. */
  ro: Pick<VerifiedRequestObject, 'claims'>
  /** Credential selected for this presentation. */
  candidate: PresentationCandidate
  /** Holder key matching the selected credential binding. */
  holder: HolderKey
  /** Override which disclosures to reveal (default: exactly the claims the query names). */
  disclose?: 'all' | readonly string[]
  /** Current time override in Unix seconds. */
  nowSecs?: number
  /** Preferred content encryption when the verifier-agent lists several (default A256GCM). */
  enc?: JweEnc
}

/** Holder-bound presentation and form fields ready for submission to the verifier agent. */
export interface BuiltResponse {
  /** The presentation `issuer~disclosures~kb-jwt` that went into `vp_token`. */
  presentation: string
  /** The JARM payload `{vp_token: {<queryId>: [presentation]}, state}` as JSON. */
  payload: string
  /** The form body to POST: `response=<JWE>` when the verifier-agent served an encryption key, else the plain fields. */
  form: Record<string, string>
  /** Whether the form contains an encrypted JWE response. */
  encrypted: boolean
}

/**
 * Bind the chosen credential to the request (KB-JWT) and wrap it as the verifier-agent expects it.
 *
 * @param opts - Verified request, chosen credential, holder key and disclosure settings.
 */
export function buildResponse(opts: BuildResponseOpts): BuiltResponse {
  const claims = opts.ro.claims
  const disclose = opts.disclose ?? requestedClaimNames(validate(JSON.stringify(claims.dcql_query), {requireIssuer: false}), opts.candidate.queryId)
  const presentation = presentSdJwt({parsed: opts.candidate.parsed, disclose, holder: opts.holder, nonce: claims.nonce, aud: claims.client_id, nowSecs: opts.nowSecs})
  const payloadObj = {vp_token: {[opts.candidate.queryId]: [presentation]}, state: claims.state}
  const payload = JSON.stringify(payloadObj)
  const key = responseEncryptionKey(opts.ro)
  if (key) {
    const offered = claims.client_metadata?.encrypted_response_enc_values_supported
    const enc: JweEnc = opts.enc ?? (offered && !offered.includes('A256GCM') && offered.includes('A128GCM') ? 'A128GCM' : 'A256GCM')
    return {presentation, payload, form: {response: encryptJwe(payload, key, enc)}, encrypted: true}
  }
  return {presentation, payload, form: {vp_token: JSON.stringify(payloadObj.vp_token), state: claims.state}, encrypted: false}
}

/**
 * POST the built response to `response_uri`; returns the verifier-agent's `redirect_uri` when it gives one.
 *
 * @param ro - Verified request containing the response endpoint.
 * @param built - Built form fields to submit.
 * @param fetchImpl - HTTP transport; defaults to the global fetch implementation.
 */
export async function submitResponse(ro: Pick<VerifiedRequestObject, 'claims'>, built: Pick<BuiltResponse, 'form'>, fetchImpl: typeof fetch = fetch): Promise<{redirectUri?: string}> {
  const res = await fetchImpl(ro.claims.response_uri, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams(built.form).toString(),
  })
  if (!res.ok) throw new Error(`response_uri → HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  const body = (await res.json().catch(() => ({}))) as {redirect_uri?: string}
  return {redirectUri: body.redirect_uri}
}

/** Request verification, credential selection and disclosure options for a wallet presentation. */
export interface PresentOpts extends VerifyRequestObjectOpts {
  /** HTTP transport override; defaults to the global fetch implementation. */
  fetchImpl?: typeof fetch
  /** Pick among the candidates (default: the evaluator's choice). Return `undefined` to abort. */
  choose?: (plan: PresentationPlan) => PresentationCandidate | undefined | Promise<PresentationCandidate | undefined>
  /** Claim names to disclose, or all; defaults to the selected query's requested claims. */
  disclose?: 'all' | readonly string[]
}

/**
 * The whole wallet flow for one QR / deep link: fetch + verify the JAR, plan, let the caller
 * choose (consent screen), bind, encrypt, POST.
 *
 * @param requestUriOrOpenid4vp - Request-object URL or OpenID4VP deep link.
 * @param held - Held SD-JWT credentials available for selection.
 * @param holder - Holder key that matches the selected credential binding.
 * @param opts - Verification, consent selection and disclosure settings.
 */
export async function presentToRequestUri(requestUriOrOpenid4vp: string, held: readonly HeldSdJwt[], holder: HolderKey, opts: PresentOpts = {}): Promise<{ro: VerifiedRequestObject; plan: PresentationPlan; built: BuiltResponse; redirectUri?: string}> {
  const requestUri = requestUriOrOpenid4vp.startsWith('openid4vp://') ? parseOpenid4vpUri(requestUriOrOpenid4vp).requestUri : requestUriOrOpenid4vp
  const ro = await fetchRequestObject(requestUri, opts)
  const plan = planPresentation(ro, held, opts.nowSecs)
  const candidate = opts.choose ? await opts.choose(plan) : plan.chosen
  if (!candidate) throw new Error(plan.unmatched.length ? `no held credential answers: ${plan.unmatched.join(', ')}` : 'presentation declined')
  const built = buildResponse({ro, candidate, holder, disclose: opts.disclose, nowSecs: opts.nowSecs})
  const {redirectUri} = await submitResponse(ro, built, opts.fetchImpl)
  return {ro, plan, built, redirectUri}
}
