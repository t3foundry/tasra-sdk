// The two strings an OAuth+DPoP authorization is bound to, DERIVED.
//
// Mirrors the reference OAuth derivations exactly, including its normalisation, because
// three independent parties have to agree on these byte for byte: the tenant (which
// registers the audience with its IdP), the client (which mints a DPoP proof over the `htu`)
// and every drawn verifier (which checks both). Only one of the three has a config file we
// control, so neither string is ever configured anywhere.
//
// The agent RETURNS both values from `createOauthSession`, so a client normally never
// calls these. They exist for the step that happens BEFORE any session: telling a tenant
// which `aud` to register with their IdP.

import {TasraError} from '../errors.js'

/** Path segment identifying the platform's authorization API, under the agent origin. */
const AUDIENCE_PATH = 'authz'

/** The OAuth response route is `{PREFIX}{sessionId}{SUFFIX}` under the agent origin. */
export const OAUTH_RESPONSE_PATH_PREFIX = '/v1/sessions/'
/** The trailing segment of the OAuth response route. */
export const OAUTH_RESPONSE_PATH_SUFFIX = '/oauth-response'

/** The longest session id an `htu` may carry — mirrors `MAX_SESSION_ID_LEN`. */
export const MAX_SESSION_ID_LEN = 128

const SESSION_ID = /^[A-Za-z0-9_-]+$/

/**
 * Whether `sessionId` is one plain path segment: `[A-Za-z0-9_-]{1,128}`. Mirrors
 * `keykeeper_committee::oauth::validate_session_id`, which every drawn verifier runs.
 *
 * @param sessionId - Session id returned by the verifier agent when the session was opened.
 */
export function isValidSessionId(sessionId: string): boolean {
  return typeof sessionId === 'string' && sessionId.length > 0 && sessionId.length <= MAX_SESSION_ID_LEN && SESSION_ID.test(sessionId)
}

/**
 * Normalise an origin the way the reference endpoint normaliser
 * does: trim, drop a trailing slash, lower-case the scheme and authority, keep the path as
 * written.
 *
 *  The PATH keeps its case deliberately - a path is case-sensitive, and lower-casing it
 * would silently rewrite an agent deployed under `/API`.
 *
 * @param url - Endpoint text to normalize; scheme and authority are lowercased while the path is preserved.
 */
export function normalizeOrigin(url: string): string {
  const input = url.trim()
  let end = input.length
  while (end > 0 && input[end - 1] === '/') end--
  const trimmed = input.slice(0, end)
  const i = trimmed.indexOf('://')
  if (i < 0) return trimmed
  const scheme = trimmed.slice(0, i)
  const rest = trimmed.slice(i + 3)
  const slash = rest.indexOf('/')
  const authority = slash < 0 ? rest : rest.slice(0, slash)
  const path = slash < 0 ? '' : rest.slice(slash)
  return `${scheme.toLowerCase()}://${authority.toLowerCase()}${path}`
}

/**
 * The OAuth audience the tenant registers with its IdP and every rule pins:
 * `{origin}/authz/{chainId}`.
 *
 * The chain id is in it so a token minted for a testnet deployment of the same platform
 * cannot authorize on mainnet.
 *
 * @param origin - Platform origin used to derive the token audience.
 * @param chainId - EVM chain identifier for the selected network.
 */
export function platformAudience(origin: string, chainId: number | bigint): string {
  return `${normalizeOrigin(origin)}/${AUDIENCE_PATH}/${chainId.toString()}`
}

/**
 * The `htu` (RFC 9449 §4.2) a DPoP proof for an OAuth response must carry:
 * `{origin}/v1/sessions/{sessionId}/oauth-response` — the URL the proof is presented at.
 *
 * Per session, because RFC 9449 §4.3 checks `htu` against the request URI and a conformant
 * client library derives it from the URL it calls. The ORIGIN is still the agent origin the
 * verifiers approved, so a client posting to a different base URL (an internal hostname, a
 * proxy) must still sign over the value the agent returned, not over the URL it called.
 *
 * Throws on a session id that is not one plain path segment, exactly as the verifiers refuse
 * one.
 *
 * @param origin - Verifier-agent public origin the verifiers approved.
 * @param sessionId - Id of the OAuth session the proof is presented to.
 */
export function dpopHtu(origin: string, sessionId: string): string {
  if (!isValidSessionId(sessionId)) {
    throw new TasraError(
      `dpopHtu: session id must be 1..=${MAX_SESSION_ID_LEN} characters of [A-Za-z0-9_-]`,
      {retryable: false},
    )
  }
  return `${normalizeOrigin(origin)}${OAUTH_RESPONSE_PATH_PREFIX}${sessionId}${OAUTH_RESPONSE_PATH_SUFFIX}`
}
