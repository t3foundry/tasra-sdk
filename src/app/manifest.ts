import {sha256} from '@noble/hashes/sha256'
import {bytesToHex} from '@noble/hashes/utils'
import {addressBookFromManifest, parseNetworkManifest, type NetworkManifest} from '../chain/manifest.js'
import {NETWORKS} from '../chain/networks.js'
import {defineDeployment, type TasraDeployment} from './deployment.js'

/**
 * Public application deployment settings with optional explicitly approved endpoint routing.
 */
export interface ApplicationDeployment extends TasraDeployment {
  /**
   * Explicitly approved verifier-agent endpoint.
   */
  verifierAgentUrl?: string
  /** Exact registered URL to reachable URL mappings; never inferred from a hostname. */
  keeperUrls?: Record<string, string>
}
/**
 * A network manifest downloaded from tasra-releases or an explicitly approved application deployment.
 */
export type ApplicationManifest = NetworkManifest | ApplicationDeployment
/**
 * Explicit RPC and coordinator choices applied when resolving a network manifest.
 */
export interface ResolveApplicationManifestOptions {
  /**
   * Explicit JSON-RPC endpoint override for the chosen network.
   */
  rpcUrl?: string
  /** Required for release manifests, whose schema does not specify this convention. */
  coordinator?: TasraDeployment['coordinator']
}
/**
 * Validated deployment settings and optional endpoint routing for an application client.
 */
export interface ResolvedApplicationManifest {
  /**
   * Validated network configuration suitable for an application client.
   */
  deployment: Readonly<TasraDeployment>
  /**
   * Verifier-agent endpoint advertised by the approved configuration.
   */
  verifierAgentUrl?: string
  /**
   * Explicit routing function for registered keeper endpoints, when configured.
   */
  keeperUrl?: (registeredUrl: string) => string
}
/**
 * Manifest download controls and an optional independently trusted SHA-256 pin.
 */
export interface LoadApplicationManifestOptions extends ResolveApplicationManifestOptions {
  /** Lowercase SHA-256 of the downloaded bytes, obtained from a trusted source. */
  sha256?: string
  /**
   * HTTP implementation used to download manifest bytes.
   */
  fetchImpl?: typeof fetch
  /**
   * Cancel the manifest HTTP download.
   */
  signal?: AbortSignal
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function endpoint(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${label} URL`)
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error(`Invalid ${label} URL`)
  return url.href
}
function routes(input: unknown): ResolvedApplicationManifest['keeperUrl'] {
  if (input === undefined) return undefined
  if (!object(input)) throw new Error('Invalid keeper URL mappings')
  const mappings = new Map<string, string>()
  for (const [registered, reachable] of Object.entries(input)) {
    const key = endpoint(registered, 'registered keeper')
    endpoint(reachable, 'reachable keeper')
    if (mappings.has(key)) throw new Error('Ambiguous keeper URL mappings')
    mappings.set(key, reachable as string)
  }
  return registered => mappings.get(endpoint(registered, 'registered keeper')) ?? registered
}

/**
 * Validate caller-approved configuration without network I/O or readiness claims.
 * @param input Downloaded network manifest or explicitly approved deployment settings.
 * @returns Validated deployment and optional routing without a network request.
 * @param options Explicit RPC and coordinator choices for the manifest.
 */
export function resolveApplicationManifest(input: ApplicationManifest, options: ResolveApplicationManifestOptions = {}): ResolvedApplicationManifest {
  if (!object(input)) throw new Error('Invalid application manifest')
  if (Object.hasOwn(input, 'contracts')) {
    // Refuse a hybrid document rather than choosing between conflicting addresses.
    if (Object.hasOwn(input, 'addresses') || Object.hasOwn(input, 'keeperUrls') || Object.hasOwn(input, 'verifierAgentUrl')) throw new Error('Ambiguous application manifest schema')
    const manifest = parseNetworkManifest(input)
    const addresses = addressBookFromManifest(manifest)
    if (!options.coordinator) throw new Error('Release manifest requires an explicit coordinator option')
    function service(kind: string): string | undefined {
      const entries = manifest.services.filter(item => item.kind === kind)
      if (entries.length > 1) throw new Error(`Ambiguous ${kind} services in application manifest`)
      return entries[0]?.url
    }
    const manifestRpc = service('rpc'), verifierAgentUrl = service('verifier-agent')
    const rpcUrl = options.rpcUrl ?? manifestRpc ?? NETWORKS[manifest.network].rpcUrl
    if (manifest.network !== 'local' && new URL(endpoint(rpcUrl, 'RPC')).protocol !== 'https:') throw new Error('Public network RPC URL requires HTTPS')
    const deployment = defineDeployment({schemaVersion: 1, name: manifest.deploymentId, chainId: manifest.chainId,
      rpcUrl, addresses, coordinator: options.coordinator, provenance: {networkRevision: `${manifest.deploymentId}@${manifest.revision}`}})
    return {deployment, ...(verifierAgentUrl ? {verifierAgentUrl} : {})}
  }
  if (Object.hasOwn(input, 'network') || Object.hasOwn(input, 'status') || !object(input.addresses)) throw new Error('Invalid application deployment schema')
  const descriptor = input as unknown as ApplicationDeployment
  if (typeof descriptor.name !== 'string' || !descriptor.name.trim()) throw new Error('Invalid application deployment name')
  if (descriptor.provenance !== undefined && (!object(descriptor.provenance) ||
    typeof descriptor.provenance.networkRevision !== 'string' || !descriptor.provenance.networkRevision ||
    descriptor.provenance.manifestSha256 !== undefined && !/^[a-f0-9]{64}$/.test(descriptor.provenance.manifestSha256))) throw new Error('Invalid deployment provenance')
  if (descriptor.verifierAgentUrl !== undefined) endpoint(descriptor.verifierAgentUrl, 'verifier agent')
  const keeperUrl = routes(descriptor.keeperUrls)
  const deployment = defineDeployment({schemaVersion: descriptor.schemaVersion, name: descriptor.name, chainId: descriptor.chainId,
    rpcUrl: options.rpcUrl ?? descriptor.rpcUrl, coordinator: options.coordinator ?? descriptor.coordinator,
    addresses: descriptor.addresses, ...(descriptor.provenance ? {provenance: descriptor.provenance} : {})})
  return {deployment, ...(descriptor.verifierAgentUrl !== undefined ? {verifierAgentUrl: descriptor.verifierAgentUrl} : {}), ...(keeperUrl ? {keeperUrl} : {})}
}

/**
 * Fetch a public manifest; an optional trusted pin is checked before parsing any JSON.
 * @param source HTTPS manifest URL. HTTP is allowed only for loopback or with an independently trusted digest pin.
 * @returns Parsed deployment after any supplied digest pin has been verified.
 * @param options Trusted digest pin, manifest resolution choices and HTTP controls.
 */
export async function loadApplicationManifest(source: string | URL, options: LoadApplicationManifestOptions = {}): Promise<ResolvedApplicationManifest> {
  // Snapshot caller choices before a fetch can yield to application code.
  options = {...options}
  const url = endpoint(source instanceof URL ? source.href : source, 'manifest')
  if (options.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(options.sha256)) throw new Error('Invalid manifest SHA-256 pin')
  const sourceUrl = new URL(url)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(sourceUrl.hostname)
  if (sourceUrl.protocol !== 'https:' && !loopback && options.sha256 === undefined) throw new Error('Remote manifest downloads require HTTPS or an independently trusted SHA-256 pin')
  options.signal?.throwIfAborted()
  const response = await (options.fetchImpl ?? globalThis.fetch)(url, {signal: options.signal})
  if (!response.ok) throw new Error(`Application manifest request failed (HTTP ${response.status})`)
  if (response.url) {
    const final = endpoint(response.url, 'manifest response')
    if (sourceUrl.protocol === 'https:' && !final.startsWith('https:')) throw new Error('Manifest redirect requires HTTPS')
    if (sourceUrl.protocol === 'http:' && loopback && options.sha256 === undefined &&
        !['localhost', '127.0.0.1', '[::1]'].includes(new URL(final).hostname)) throw new Error('Unpinned loopback manifest redirect must stay on loopback')
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  options.signal?.throwIfAborted()
  if (options.sha256 !== undefined && bytesToHex(sha256(bytes)) !== options.sha256) throw new Error('Application manifest SHA-256 mismatch')
  const resolved = resolveApplicationManifest(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)), options)
  if (options.sha256 !== undefined) {
    resolved.deployment = defineDeployment({...resolved.deployment, provenance: {
      networkRevision: resolved.deployment.provenance?.networkRevision ?? resolved.deployment.name,
      manifestSha256: options.sha256,
    }})
  }
  return resolved
}
