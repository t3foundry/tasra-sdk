// The request and response shape every guarded service transport enforces, shared by the
// Node (socket-checked) and browser (fetch) transports so the two cannot drift apart.
// This module decides only what may be sent and accepted; destination and TLS policy stay
// with each transport.

import {SERVICE_MANIFEST_PATH, SERVICE_IDENTITY_PATH, validateServiceEndpoint} from './serviceIdentity.js'

/** Which protocol surface a guarded transport instance may reach. */
export type ServiceTransportMode = 'discovery' | 'relay' | 'agent' | 'wallet' | 'status' | 'session-control'

/** One request as a transport receives it. */
export interface ServiceRequestOptions {
  /** Exact request body, when the route takes one. */
  body?: Uint8Array
  /** Response byte bound. */
  maxBytes: number
  /** Owner bearer / poll secret, only on owner routes. */
  bearer?: string
}

/** What the transport sends and which replies it accepts. */
export interface ServiceRequestShape {
  /** HTTP method to send. */
  method: 'GET' | 'POST'
  /** Request headers other than length/encoding, which each transport sets itself. */
  headers: Record<string, string>
  /** Accepted response media types. */
  responseTypes: string[]
}

/**
 * Validate a request for a transport mode and return its wire shape. Throws (without sending)
 * on a path, method, body, bearer or bound outside the mode's protocol.
 * @param mode Transport surface.
 * @param url Full request URL.
 * @param options Body, bounds and credentials.
 */
export function serviceRequestShape(mode: ServiceTransportMode, url: string, {body, maxBytes, bearer}: ServiceRequestOptions): ServiceRequestShape {
  const relay = mode === 'relay', agent = mode === 'agent', wallet = mode === 'wallet', status = mode === 'status'
  const control = mode === 'session-control'
  const voucherIntent = relay && /\/v1\/relay\/voucher-intent$/.test(url)
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > (agent || wallet ? 1_048_576 : control ? 65_536 : relay ? voucherIntent ? 65_536 : 4_096 : 16_384) || body && body.length > (wallet ? 1_048_576 : agent || relay || control ? 65_536 : 2_048)) throw new Error('Invalid service HTTP bounds')
  // ADR-0090 D7 session-grant controls: a public POST (no bearer; the session-key signature in the body authorizes it).
  const controlSuffix = url.match(/\/v1\/sessions\/(?:refresh|revoke)$/)?.[0]
  if (control && (!controlSuffix || !body || bearer !== undefined)) throw new Error('Invalid session control path, body or bearer')
  // The registry's 512-byte limit applies to the base, excluding appended protocol paths.
  const relaySuffix = url.match(/\/v1\/relay\/(forward|voucher-intent|0x[0-9a-f]{64})$/)?.[0]
  if (relay && (!relaySuffix || Boolean(body) !== (relaySuffix.endsWith('/forward') || voucherIntent))) throw new Error('Invalid relay path or method')
  const agentSuffix = url.match(/\/v1\/sessions(?:\/[0-9a-f]{64})?$/)?.[0]
  if (agent && (!agentSuffix || (body ? agentSuffix !== '/v1/sessions' || bearer !== undefined : agentSuffix === '/v1/sessions' || !/^[0-9a-f]{64}$/.test(bearer ?? '')))) throw new Error('Invalid agent path, method or poll secret')
  if (!agent && bearer !== undefined) throw new Error('Bearer is only allowed for agent polling')
  const walletSuffix = url.match(/(?:\/\.well-known\/did\.json|\/v1\/request\/[0-9a-f]{64}|\/v1\/response\?session=[0-9a-f]{64})$/)?.[0]
  if (wallet && (!walletSuffix || Boolean(body) !== walletSuffix.startsWith('/v1/response?session='))) throw new Error('Invalid wallet path or method')
  const statusSuffix = url.match(/(?:\/readyz|\/v1\/relay\/policy)$/)?.[0]
  if (status && (!statusSuffix || body !== undefined)) throw new Error('Invalid service status path or method')
  const contentType = status && statusSuffix === '/readyz' ? 'text/plain' : (wallet && !body && !url.endsWith('/did.json')) ? 'application/oauth-authz-req+jwt' : 'application/json'
  const responseTypes = wallet && walletSuffix === '/.well-known/did.json'
    ? ['application/json', 'application/did+json', 'application/did+ld+json'] : [contentType]
  const suffix = control ? controlSuffix : status ? statusSuffix : wallet ? walletSuffix : agent ? agentSuffix : relay ? relaySuffix : [SERVICE_MANIFEST_PATH, SERVICE_IDENTITY_PATH].find(path => url.endsWith(path))
  validateServiceEndpoint(suffix ? url.slice(0, -suffix.length) : url)
  const headers: Record<string, string> = {...(bearer ? {authorization: `Bearer ${bearer}`} : {}),
    accept: responseTypes.join(', '), ...(body ? {'content-type': wallet ? 'application/x-www-form-urlencoded' : 'application/json'} : {})}
  return {method: body ? 'POST' : 'GET', headers, responseTypes}
}

/**
 * Whether a reply's status and media type are acceptable for the request. Encoding and size
 * are checked by the transport while reading.
 * @param mode Transport surface.
 * @param shape Shape returned for the request.
 * @param hasBody Whether the request carried a body.
 * @param status HTTP status received.
 * @param contentType Received media type, without parameters, lowercased.
 */
export function acceptsServiceResponse(mode: ServiceTransportMode, shape: ServiceRequestShape, hasBody: boolean, status: number, contentType: string, exchange = false): boolean {
  const control = mode === 'session-control'
  // A session-control 204 has no body, and a 429/503 is a definite "not now" the agent's per-client
  // limiter may answer as text/plain before any handler runs. Their bodies are bounded and never
  // interpreted, so their media type does not matter; only the status and Retry-After are read.
  const anyType = control && (status === 204 || status === 429 || status === 503)
  const permittedStatus = control ? [200,204,400,401,403,404,409,410,413,422,429,500,502,503,504].includes(status)
    // An agent session-creation exchange also reads a 503, so a retryable not-yet-anchored refusal is visible.
    : mode === 'agent' ? status === (hasBody ? 201 : 200) || (exchange && hasBody && status === 503) : mode === 'relay' ? [200,202,422].includes(status)
      : mode === 'wallet' && hasBody ? [200,202].includes(status) : status === 200
  const permittedType = anyType || shape.responseTypes.includes(contentType)
  return permittedStatus && permittedType
}
