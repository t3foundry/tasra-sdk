/** Node-only service discovery transport; never imported by the browser-safe chain barrel. */
import {didWebUrl} from '../oid4vp/did-web.js'
import type {RegisteredAgentSession} from './registeredAgent.js'
import type {AgentTransport} from './registeredAgent.js'
import type {PaidAgentHttpResponse, PaidAgentTransport} from './paidAgentTransport.js'
import type {KeeperRecoveryHttpResponse, KeeperRecoveryTransport} from './keeperRecovery.js'
import type {RelayHttpResponse, RelayTransport} from './registeredRelay.js'
import {parseRetryAfter} from '../internal/retryAfter.js'
import {lookup} from 'node:dns'
import {request} from 'node:https'
import {request as plainRequest, type IncomingMessage} from 'node:http'
import {rootCertificates} from 'node:tls'
import {BlockList, isIP, type LookupFunction} from 'node:net'
import type {ServiceDiscoveryTransport} from './serviceIdentity.js'
import {acceptsServiceResponse, serviceRequestShape} from './serviceRequestPolicy.js'

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

/** A loopback name or a non-public IP literal (plain local-development HTTP only). */
function localName(host: string): boolean {
  return host === 'localhost' || host.endsWith('.localhost') || (isIP(host) !== 0 && !isPublicServiceAddress(host))
}

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
  return {...discovery, relayRequest: relay.request,
    relayExchange: (url, options) => relay.request(url, {...options, full: true}) as unknown as Promise<RelayHttpResponse>}
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

/** Options for {@link createNodeKeeperRecoveryTransport}. */
export interface NodeKeeperRecoveryTransportPolicy extends ServiceTransportPolicy {
  /**
   * Local development fleet: also permit plain HTTP to loopback names, private IP literals and
   * `allowedPrivateHosts` (and only those), resolving only to non-public addresses, with the same
   * route checks as HTTPS. Default false: HTTPS only. The recovery reads separately permit HTTP
   * only on the local development chain (43112) with the paid operation's `allowLocalHttp`.
   */
  allowLocalHttp?: boolean
}

/**
 * Guarded completed-result reads using the same socket-bound destination and verified TLS policy.
 * Only the two POST evidence/recovery paths are permitted; this transport cannot submit key work.
 * @param policy Exact client-approved private hosts, additional CA roots and local development HTTP.
 */
export function createNodeKeeperRecoveryTransport(policy: NodeKeeperRecoveryTransportPolicy = {}): KeeperRecoveryTransport {
  const recovery = guardedTransport(policy, 'keeper-recovery', policy.allowLocalHttp === true)
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

type TransportOptions = {body?: Uint8Array; maxBytes: number; signal: AbortSignal; bearer?: string; method?: 'GET' | 'POST'; oauth?: {accessToken: string; proof: string}
  /** Internal: return status and Retry-After with the bytes (relay busy handling). */
  full?: boolean}
function guardedTransport(policy: ServiceTransportPolicy, mode: 'paid-agent' | 'wallet'): {request(url: string, options: TransportOptions): Promise<PaidAgentHttpResponse>}
function guardedTransport(policy: ServiceTransportPolicy, mode: 'keeper-recovery', localHttp: boolean): {request(url: string, options: TransportOptions): Promise<KeeperRecoveryHttpResponse>}
function guardedTransport(policy: ServiceTransportPolicy, mode: 'discovery' | 'relay' | 'agent' | 'status'): {request(url: string, options: TransportOptions): Promise<Uint8Array>}
function guardedTransport(policy: ServiceTransportPolicy, mode: 'discovery' | 'relay' | 'agent' | 'wallet' | 'status' | 'paid-agent' | 'keeper-recovery', localHttp = false) {
  const relay = mode === 'relay', agent = mode === 'agent', wallet = mode === 'wallet'
  const paid = mode === 'paid-agent'
  const recovery = mode === 'keeper-recovery'

  const allowed = new Set(policy.allowedPrivateHosts ?? [])
  // Snapshot mutable caller configuration before the first asynchronous request.
  const ca = Array.isArray(policy.ca) ? policy.ca.map(c => typeof c === 'string' ? c : Buffer.from(c))
    : typeof policy.ca === 'string' || policy.ca === undefined ? policy.ca : Buffer.from(policy.ca)
  return {
    request(url: string, {body, maxBytes, signal, bearer, method, oauth, full}: TransportOptions) {
      signal.throwIfAborted()
      const parsed = new URL(url)
      const host = parsed.hostname.replace(/^\[|\]$/g, '')
      // Local development HTTP: only to a loopback name, a private IP literal or an approved private
      // host, checked with the same route policy as its HTTPS form; every answer must be non-public.
      const plain = localHttp && parsed.protocol === 'http:' && (localName(host) || allowed.has(host))
      const shape = serviceRequestShape(mode, plain ? 'https:' + url.slice('http:'.length) : url, {body, maxBytes, bearer, method, oauth})
      if (parsed.protocol !== 'https:' && !plain) throw new Error('Service destination policy requires HTTPS')
      const permits = (address: string) => plain ? !isPublicServiceAddress(address) : allowed.has(host) || isPublicServiceAddress(address)
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
        const common = {method: shape.method, agent: false as const, lookup: checkedLookup, signal, maxHeaderSize: 8_192,
          headers: {...shape.headers, 'accept-encoding': 'identity', ...(body ? {'content-length': body.length} : {})}}
        const req = plain ? plainRequest(parsed, common, res => respond(res)) : request(parsed, {...common,
          ca: ca === undefined ? undefined : [...rootCertificates, ...(Array.isArray(ca) ? ca : [ca])], rejectUnauthorized: true,
        }, res => respond(res))
        function respond(res: IncomingMessage) {
          const fail = (error: Error) => { reject(error); req.destroy(error) }
          const noContent = paid && res.statusCode === 204
          const receivedType = res.headers['content-type']?.split(';')[0]?.trim().toLowerCase() ?? ''
          if (!acceptsServiceResponse(mode, shape, Boolean(body), res.statusCode ?? 0, receivedType) || res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') {
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
            const header = res.headers['retry-after'], retryAfterMs = parseRetryAfter(Array.isArray(header) ? undefined : header)
            resolve(paid || recovery || wallet || (relay && full) ? {status: res.statusCode!, body: bytes, ...(retryAfterMs !== undefined ? {retryAfterMs} : {})} : bytes)
          })
        }
        // Absolute request deadline also bounds DNS/TLS and slow trickle responses.
        const timer = setTimeout(() => req.destroy(new Error('Service HTTP timed out')), paid || recovery || agent || wallet ? 30_000 : 5_000)
        req.on('close', () => clearTimeout(timer))
        req.on('error', reject)
        req.end(body)
      })
    },
  }
}
