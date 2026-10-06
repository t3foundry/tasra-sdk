/** Node-only service discovery transport; never imported by the browser-safe chain barrel. */
import {didWebUrl} from '../oid4vp/did-web.js'
import type {RegisteredAgentSession} from './registeredAgent.js'
import type {AgentTransport} from './registeredAgent.js'
import type {PaidAgentHttpResponse, PaidAgentTransport} from './paidAgentTransport.js'
import type {KeeperRecoveryHttpResponse, KeeperRecoveryTransport} from './keeperRecovery.js'
import type {RelayTransport} from './registeredRelay.js'
import {lookup} from 'node:dns'
import {request} from 'node:https'
import {rootCertificates} from 'node:tls'
import {BlockList, isIP, type LookupFunction} from 'node:net'
import {SERVICE_MANIFEST_PATH, SERVICE_IDENTITY_PATH, validateServiceEndpoint, type ServiceDiscoveryTransport} from './serviceIdentity.js'

const denied = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) denied.addSubnet(address, prefix, 'ipv4')
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) denied.addSubnet(address, prefix, 'ipv6')
const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')

/**
 * Conservative globally routable destinations; special-purpose exceptions require explicit policy.
 * @param address IPv4 or IPv6 address resolved for the service destination.
 */
export function isPublicServiceAddress(address: string): boolean {
  const family = isIP(address)
  return family === 4 ? !denied.check(address, 'ipv4')
    : family === 6 && globalV6.check(address, 'ipv6') && !denied.check(address, 'ipv6')
}

/**
 * Caller-approved destination and certificate policy for Node.js service transports.
 */
export interface ServiceTransportPolicy {
  /** Exact, canonical hostnames/IPs only. Application configuration, never downloaded metadata. */
  allowedPrivateHosts?: readonly string[]
  /** Additional deployment CA roots. Certificate and hostname verification remain mandatory. */
  ca?: string | Buffer | (string | Buffer)[]
}

/**
 * Create a bounded HTTPS transport that validates destinations at socket connection time.
 * @param policy Explicit private-host exceptions and additional trusted certificate roots.
 */
export function createNodeServiceDiscoveryTransport(policy: ServiceTransportPolicy = {}): ServiceDiscoveryTransport {
  return guardedTransport(policy, 'discovery')
}

/**
 * Public readiness and relay-policy observations, with the same socket/TLS policy.
 * @param policy Explicit private-host exceptions and additional trusted certificate roots.
 */
export function createNodeServiceStatusTransport(policy: ServiceTransportPolicy = {}): ServiceDiscoveryTransport {
  return guardedTransport(policy, 'status')
}

/**
 * Discovery and relay traffic use the same socket-bound destination and TLS policy.
 * @param policy Explicit private-host exceptions and additional trusted certificate roots.
 */
export function createNodeRelayTransport(policy: ServiceTransportPolicy = {}): RelayTransport {
  const discovery = guardedTransport(policy, 'discovery')
  const relay = guardedTransport(policy, 'relay')
  return {...discovery, relayRequest: relay.request}
}

/**
 * Session secrets use this same guarded connection and can only travel to a session GET.
 * @param policy Explicit private-host exceptions and additional trusted certificate roots.
 */
export function createNodeAgentTransport(policy: ServiceTransportPolicy = {}): AgentTransport {
  const discovery = guardedTransport(policy, 'discovery')
  const agent = guardedTransport(policy, 'agent')
  return {...discovery, agentRequest: agent.request}
}

/**
 * Guarded paid-session creation and owner control, preserving HTTP consent/recovery statuses.
 * @param policy Client-approved private hosts and additional CA roots; TLS verification stays enabled.
 */
export function createNodePaidAgentTransport(policy: ServiceTransportPolicy = {}): PaidAgentTransport {
  const discovery = guardedTransport(policy, 'discovery')
  const paid = guardedTransport(policy, 'paid-agent')
  return {...discovery, paidAgentRequest: (url, options) => {
    if (options.body && options.body.length > 2 * 1024 * 1024) throw new Error('Invalid service HTTP bounds')
    return paid.request(url, {...options, body: options.body?.slice()})
  }}
}

/**
 * Guarded completed-result reads using the same socket-bound destination and verified TLS policy.
 * Only the two POST evidence/recovery paths are permitted; this transport cannot submit key work.
 * @param policy Exact client-approved private hosts and additional CA roots.
 */
export function createNodeKeeperRecoveryTransport(policy: ServiceTransportPolicy = {}): KeeperRecoveryTransport {
  const recovery = guardedTransport(policy, 'keeper-recovery')
  return {keeperRecoveryRequest: (url, options) => recovery.request(url, {...options, method: 'POST', body: options.body.slice()})}
}

/**
 * Wallet protocol requests restricted to the selected session and approved DID, with socket checks.
 * @param session Authenticated session whose request, response and DID URLs are allowed.
 * @param policy Explicit private-host exceptions and additional trusted certificate roots.
 */
export function createNodeAgentWalletFetch(session: Pick<RegisteredAgentSession, 'profile' | 'requestUri' | 'sessionId'>, policy: ServiceTransportPolicy = {}): typeof fetch {
  const did = session.profile.clientId.replace(/^decentralized_identifier:/, '')
  if (!/^[0-9a-f]{64}$/.test(session.sessionId)) throw new Error('Invalid wallet session ID')
  const didUrl = didWebUrl(did), responseUrl = session.profile.endpoint + '/v1/response?session=' + session.sessionId
  const requestUri = session.requestUri
  const transport = guardedTransport(policy, 'wallet')
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = init?.method ?? 'GET'
    const post = method === 'POST' && url === responseUrl
    if (!(method === 'GET' && (url === requestUri || url === didUrl)) && !post) throw new Error('Wallet request is outside the approved session')
    if (post && typeof init?.body !== 'string' || !post && init?.body != null) throw new Error('Invalid wallet request body')
    const signal = init?.signal ?? AbortSignal.timeout(30_000)
    const response = await transport.request(url, {body: post ? new TextEncoder().encode(init!.body as string) : undefined, maxBytes: post ? 16_384 : 65_536, signal})
    return new Response(new TextDecoder('utf-8', {fatal: true}).decode(response.body), {status: response.status, headers: {'content-type': url === requestUri ? 'application/oauth-authz-req+jwt' : 'application/json'}})
  }
}

type TransportOptions = {body?: Uint8Array; maxBytes: number; signal: AbortSignal; bearer?: string; method?: 'GET' | 'POST'; oauth?: {accessToken: string; proof: string}}
function guardedTransport(policy: ServiceTransportPolicy, mode: 'paid-agent' | 'wallet'): {request(url: string, options: TransportOptions): Promise<PaidAgentHttpResponse>}
function guardedTransport(policy: ServiceTransportPolicy, mode: 'keeper-recovery'): {request(url: string, options: TransportOptions): Promise<KeeperRecoveryHttpResponse>}
function guardedTransport(policy: ServiceTransportPolicy, mode: 'discovery' | 'relay' | 'agent' | 'status'): {request(url: string, options: TransportOptions): Promise<Uint8Array>}
function guardedTransport(policy: ServiceTransportPolicy, mode: 'discovery' | 'relay' | 'agent' | 'wallet' | 'status' | 'paid-agent' | 'keeper-recovery') {
  const relay = mode === 'relay', agent = mode === 'agent', wallet = mode === 'wallet', status = mode === 'status'
  const paid = mode === 'paid-agent'
  const recovery = mode === 'keeper-recovery'

  const allowed = new Set(policy.allowedPrivateHosts ?? [])
  // Snapshot mutable caller configuration before the first asynchronous request.
  const ca = Array.isArray(policy.ca) ? policy.ca.map(c => typeof c === 'string' ? c : Buffer.from(c))
    : typeof policy.ca === 'string' || policy.ca === undefined ? policy.ca : Buffer.from(policy.ca)
  return {
    request(url: string, {body, maxBytes, signal, bearer, method, oauth}: TransportOptions) {
      signal.throwIfAborted()
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > (recovery ? 16 * 1024 * 1024 : paid ? 10 * 1024 * 1024 : agent || wallet ? 1_048_576 : relay ? 4_096 : 16_384) || body && body.length > (recovery ? 65_536 : paid ? 2 * 1024 * 1024 : wallet ? 1_048_576 : agent || relay ? 65_536 : 2_048)) throw new Error('Invalid service HTTP bounds')
      const recoverySuffix = url.match(/\/v1\/prepaid\/execution(?:\/recover)?$/)?.[0]
      if (recovery && (!recoverySuffix || method !== 'POST' || !body || bearer !== undefined || oauth !== undefined)) throw new Error('Invalid keeper recovery path, method or body')
      const paidSuffix = url.match(/(?:\/v1\/request\/[0-9a-f]{64}|\/v1\/sessions(?:\/[0-9a-f]{64}(?:\/(?:oauth-response|execution(?:\/[0-9a-f]{64}(?:\/(?:approve|reject))?)?|presentations(?:\/[0-9a-f]{64}\/resume)?))?)?)$/)?.[0]
      const paidCreate = paid && paidSuffix === '/v1/sessions'
      const paidJar = paid && paidSuffix?.startsWith('/v1/request/') === true
      const paidOauth = paid && paidSuffix?.endsWith('/oauth-response') === true
      const paidWrite = paidCreate || paidOauth || /\/(?:approve|reject|resume)$/.test(paidSuffix ?? '')
      if (oauth !== undefined && (!paidOauth || typeof oauth.accessToken !== 'string' || typeof oauth.proof !== 'string'
        || oauth.accessToken.length > 16 * 1024 || oauth.proof.length > 4 * 1024
        || !/^[\x21-\x7e]+$/.test(oauth.accessToken) || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(oauth.proof))) throw new Error('Invalid paid agent OAuth artifacts')
      if (paid && (!paidSuffix || method !== (paidWrite ? 'POST' : 'GET')
        || paidOauth && oauth === undefined
        || (paidCreate || paidJar ? bearer !== undefined : !/^[0-9a-f]{64}$/.test(bearer ?? ''))
        || (paidCreate || paidSuffix.endsWith('/approve') ? body === undefined : body !== undefined))) throw new Error('Invalid paid agent path, method, body or owner bearer')
      // The registry's 512-byte limit applies to the base, excluding appended protocol paths.
      const relaySuffix = url.match(/\/v1\/relay\/(forward|0x[0-9a-f]{64})$/)?.[0]
      if (relay && (!relaySuffix || Boolean(body) !== relaySuffix.endsWith('/forward'))) throw new Error('Invalid relay path or method')
      const agentSuffix = url.match(/\/v1\/sessions(?:\/[0-9a-f]{64})?$/)?.[0]
      if (agent && (!agentSuffix || (body ? agentSuffix !== '/v1/sessions' || bearer !== undefined : agentSuffix === '/v1/sessions' || !/^[0-9a-f]{64}$/.test(bearer ?? '')))) throw new Error('Invalid agent path, method or poll secret')
      if (!agent && !paid && bearer !== undefined) throw new Error('Bearer is only allowed for agent polling')
      const walletSuffix = url.match(/(?:\/\.well-known\/did\.json|\/v1\/request\/[0-9a-f]{64}|\/v1\/response\?session=[0-9a-f]{64})$/)?.[0]
      if (wallet && (!walletSuffix || Boolean(body) !== walletSuffix.startsWith('/v1/response?session='))) throw new Error('Invalid wallet path or method')
      const statusSuffix = url.match(/(?:\/readyz|\/v1\/relay\/policy)$/)?.[0]
      if (status && (!statusSuffix || body !== undefined)) throw new Error('Invalid service status path or method')
      const contentType = status && statusSuffix === '/readyz' ? 'text/plain' : (paidJar || wallet && !body && !url.endsWith('/did.json')) ? 'application/oauth-authz-req+jwt' : 'application/json'
      const responseTypes = wallet && walletSuffix === '/.well-known/did.json'
        ? ['application/json', 'application/did+json', 'application/did+ld+json'] : paidJar ? [contentType, 'application/json'] : [contentType]
      const suffix = recovery ? recoverySuffix : paid ? paidSuffix : status ? statusSuffix : wallet ? walletSuffix : agent ? agentSuffix : relay ? relaySuffix : [SERVICE_MANIFEST_PATH, SERVICE_IDENTITY_PATH].find(path => url.endsWith(path))
      validateServiceEndpoint(suffix ? url.slice(0, -suffix.length) : url)
      const parsed = new URL(url)
      const host = parsed.hostname.replace(/^\[|\]$/g, '')
      const permits = (address: string) => allowed.has(host) || isPublicServiceAddress(address)
      if (isIP(host) && !permits(host)) throw new Error('Service destination policy refuses address')
      const checkedLookup: LookupFunction = (hostname, options, callback) => {
        lookup(hostname, {all: true, verbatim: true}, (error, addresses) => {
          if (error) { callback(error, '', 4); return }
          if (!addresses.length || addresses.some(a => !permits(a.address))) {
            callback(new Error('Service destination policy refuses DNS answer'), '', 4); return
          }
          // These exact checked addresses are handed to the socket. No second DNS lookup.
          if (options.all) callback(null, addresses)
          else callback(null, addresses[0]!.address, addresses[0]!.family)
        })
      }
      return new Promise<Uint8Array | PaidAgentHttpResponse>((resolve, reject) => {
        const req = request(parsed, {
          method: paid || recovery ? method : body ? 'POST' : 'GET', agent: false, lookup: checkedLookup,
          ca: ca === undefined ? undefined : [...rootCertificates, ...(Array.isArray(ca) ? ca : [ca])], rejectUnauthorized: true, signal, maxHeaderSize: 8_192,
          headers: {...(bearer ? oauth ? {authorization: `DPoP ${oauth.accessToken}`,dpop: oauth.proof,'x-poll-secret':bearer} : {authorization: `Bearer ${bearer}`} : {}), accept: responseTypes.join(', '), 'accept-encoding': 'identity', ...(body ? {'content-type': wallet ? 'application/x-www-form-urlencoded' : 'application/json', 'content-length': body.length} : {})},
        }, res => {
          const fail = (error: Error) => { reject(error); req.destroy(error) }
          const noContent = paid && res.statusCode === 204
          const permittedStatus = paid || recovery ? [200,201,202,204,400,401,403,404,409,410,413,422,425,429,500,502,503,504].includes(res.statusCode ?? 0)
            : agent ? res.statusCode === (body ? 201 : 200) : relay ? [200,202,422].includes(res.statusCode ?? 0)
              : wallet && body ? [200,202].includes(res.statusCode ?? 0) : res.statusCode === 200
          const receivedType = res.headers['content-type']?.split(';')[0]?.trim().toLowerCase() ?? ''
          const permittedType = noContent || (paid ? receivedType === (paidJar && res.statusCode === 200 ? 'application/oauth-authz-req+jwt' : 'application/json') : responseTypes.includes(receivedType))
          if (!permittedStatus || !permittedType || res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') {
            fail(new Error('Service HTTP status, content type or encoding refused')); return
          }
          const advertised = res.headers['content-length']
          if (advertised && (!/^\d+$/.test(advertised) || Number(advertised) > maxBytes || noContent && Number(advertised) !== 0)) {
            fail(new Error('Service response too large')); return
          }
          const chunks: Buffer[] = []
          let size = 0
          res.on('data', (chunk: Buffer) => {
            if (size + chunk.length > maxBytes) { fail(new Error('Service response too large')); return }
            size += chunk.length
            chunks.push(chunk)
          })
          res.on('error', reject)
          res.on('end', () => {
            if (noContent && size !== 0) {fail(new Error('Unexpected paid agent response body')); return}
            const bytes = Buffer.concat(chunks,size)
            resolve(paid || recovery || wallet ? {status: res.statusCode!, body: bytes} : bytes)
          })
        })
        // Absolute request deadline also bounds DNS/TLS and slow trickle responses.
        const timer = setTimeout(() => req.destroy(new Error('Service HTTP timed out')), paid || recovery || agent || wallet ? 30_000 : 5_000)
        req.on('close', () => clearTimeout(timer))
        req.on('error', reject)
        req.end(body)
      })
    },
  }
}
