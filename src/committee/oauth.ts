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

/** Path segment identifying the platform's authorization API, under the agent origin. */
const AUDIENCE_PATH = 'authz'

/** Legacy session-independent response path. New sessions use dpopHtu(origin, sessionId). */
export const OAUTH_RESPONSE_PATH = '/v1/sessions/oauth-response'

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
 * The `htu` (RFC 9449) a DPoP proof for an OAuth response must carry:
 * `{origin}/v1/sessions/{sessionId}/oauth-response`, the exact POST target.
 * A session ID is one ASCII path segment; separators and encoded path characters are refused.
 *
 * @param origin - Platform origin used to derive the OAuth response target.
 * @param sessionId - Original session identifier, 1 to 128 ASCII letters, digits, underscores or hyphens.
 */
export function dpopHtu(origin: string, sessionId: string): string {
  if (typeof sessionId !== 'string' || sessionId.length < 1 || sessionId.length > 128
      || /[^A-Za-z0-9_-]/.test(sessionId)) {
    throw new Error('OAuth sessionId must be 1 to 128 characters of [A-Za-z0-9_-]')
  }
  return `${normalizeOrigin(origin)}/v1/sessions/${sessionId}/oauth-response`
}

/**
 * Pre-remediation proof target for an agent that supplies no session identity.
 * New paid sessions never accept this target as a fallback.
 * @param origin - Original platform origin.
 */
export function legacyDpopHtu(origin: string): string {
  return `${normalizeOrigin(origin)}${OAUTH_RESPONSE_PATH}`
}
