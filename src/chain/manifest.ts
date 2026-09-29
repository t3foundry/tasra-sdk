import {sha256} from '@noble/hashes/sha256'
import {bytesToHex} from '@noble/hashes/utils'
import {createPublicClient, getCreate2Address, http, keccak256, type Hex} from 'viem'
import type {AddressBook, Address} from './deployments.js'
import {NETWORKS, type NetworkName} from './networks.js'

/**
 * Manifest record of one deployed contract and its code, transaction and proxy evidence.
 */
export interface ContractRecord {
  /**
   * Canonical contract name used as the address-book key.
   */
  name: string
  /**
   * Deployed contract address.
   */
  address: Address
  /**
   * Relative ABI artifact path in the release repository.
   */
  abi: string
  /**
   * Expected runtime-bytecode hash, or null before deployment evidence exists.
   */
  runtimeCodeHash: Hex | null
  /**
   * Deployment transaction and decimal block number, or null when unavailable.
   */
  deployment: {transactionHash: Hex; blockNumber: string} | null
  /**
   * Deterministic deployment inputs, or null for other deployment methods.
   */
  create2: {factory: Address; salt: Hex; initCodeHash: Hex} | null
  /**
   * Expected implementation, code hash and upgrade authority for a proxy.
   */
  proxy: {implementation: Address; runtimeCodeHash: Hex; upgradeAuthority: Address | null} | null
}
/**
 * Versioned network deployment record published in tasra-releases.
 */
export interface NetworkManifest {
  /**
   * Network manifest schema version.
   */
  schemaVersion: 1
  /**
   * Network profile associated with this deployment.
   */
  network: NetworkName
  /**
   * EVM chain ID matching the selected network profile.
   */
  chainId: number
  /**
   * Stable deployment identifier.
   */
  deploymentId: string
  /**
   * Positive revision number of this deployment record.
   */
  revision: number
  /**
   * Lifecycle state; only active records can configure live clients.
   */
  status: 'planned' | 'active' | 'retired'
  /**
   * Network protocol compatibility version.
   */
  protocolVersion: string
  /**
   * Canonical block and timestamp recorded when deployment evidence was collected.
   */
  verifiedAt: {blockNumber: string; blockHash: Hex; timestamp: string} | null
  /**
   * Contract addresses and deployment evidence.
   */
  contracts: ContractRecord[]
  /**
   * Public service endpoints advertised by this network.
   */
  services: {kind: string; url: string}[]
}
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const HASH = /^0x[0-9a-fA-F]{64}$/
const DECIMAL = /^(0|[1-9][0-9]*)$/
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid network manifest: ${message}`)
}
function address(value: unknown): value is Address {
  return typeof value === 'string' && ADDRESS.test(value) && !/^0x0{40}$/.test(value)
}
function hash(value: unknown): value is Hex {return typeof value === 'string' && HASH.test(value)}
function decimal(value: unknown): value is string {return typeof value === 'string' && DECIMAL.test(value)}

/**
 * Validate data only. Authenticity requires a trusted digest or signature separately.
 * @param value Untrusted parsed JSON to validate against the supported manifest schema.
 */
export function parseNetworkManifest(value: unknown): NetworkManifest {
  requireValue(object(value) && value.schemaVersion === 1, 'unsupported schema')
  requireValue(typeof value.network === 'string' && Object.hasOwn(NETWORKS, value.network), 'unknown network')
  requireValue(value.chainId === NETWORKS[value.network as NetworkName].chainId, 'chain/network mismatch')
  requireValue(typeof value.deploymentId === 'string' && /^[a-z0-9][a-z0-9.-]{0,95}$/.test(value.deploymentId), 'deployment ID')
  requireValue(Number.isSafeInteger(value.revision) && Number(value.revision) > 0, 'revision')
  requireValue(['planned', 'active', 'retired'].includes(String(value.status)), 'status')
  requireValue(typeof value.protocolVersion === 'string' && /^\d+\.\d+\.\d+$/.test(value.protocolVersion), 'protocol version')
  requireValue(value.verifiedAt === null || (object(value.verifiedAt) && decimal(value.verifiedAt.blockNumber) &&
    hash(value.verifiedAt.blockHash) && typeof value.verifiedAt.timestamp === 'string' &&
    Number.isFinite(Date.parse(value.verifiedAt.timestamp))), 'verification block')
  requireValue(Array.isArray(value.contracts) && value.contracts.length <= 256, 'contracts')
  const names = new Set<string>()
  for (const c of value.contracts) {
    requireValue(object(c) && typeof c.name === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(c.name), 'contract name')
    requireValue(!names.has(c.name), 'duplicate contract name'); names.add(c.name)
    requireValue(address(c.address), `address for ${c.name}`)
    requireValue(typeof c.abi === 'string' && /^contracts\/abi\/[a-zA-Z0-9/_.-]+\.json$/.test(c.abi) && !c.abi.includes('..'), 'ABI path')
    requireValue(c.runtimeCodeHash === null || hash(c.runtimeCodeHash), 'runtime hash')
    requireValue(c.deployment === null || (object(c.deployment) && hash(c.deployment.transactionHash) && decimal(c.deployment.blockNumber)), 'deployment receipt')
    requireValue(c.create2 === null || (object(c.create2) && address(c.create2.factory) && hash(c.create2.salt) && hash(c.create2.initCodeHash)), 'CREATE2 inputs')
    if (object(c.create2)) {
      const predicted = getCreate2Address({from: c.create2.factory as Address, salt: c.create2.salt as Hex, bytecodeHash: c.create2.initCodeHash as Hex})
      requireValue(predicted.toLowerCase() === c.address.toLowerCase(), `CREATE2 address for ${c.name}`)
    }
    requireValue(c.proxy === null || (object(c.proxy) && address(c.proxy.implementation) && hash(c.proxy.runtimeCodeHash) &&
      (c.proxy.upgradeAuthority === null || address(c.proxy.upgradeAuthority))), 'proxy')
    if (value.status === 'active') requireValue(c.runtimeCodeHash && c.deployment, 'active contract needs code and receipt evidence')
  }
  if (value.status === 'active') requireValue(value.verifiedAt && names.has('NodeRegistry') && names.has('KeyRegistry'), 'active network needs verified registries')
  requireValue(Array.isArray(value.services) && value.services.length <= 256, 'services')
  for (const service of value.services) {
    requireValue(object(service) && typeof service.kind === 'string' && typeof service.url === 'string', 'service')
    const url = new URL(service.url)
    requireValue(!url.username && !url.password && !url.hash && (url.protocol === 'https:' || (value.network === 'local' && url.protocol === 'http:')), 'public service URL')
  }
  return value as unknown as NetworkManifest
}

/**
 * The digest must come from a verified release checksum file or application pin.
 * @param text Exact UTF-8 manifest text downloaded from tasra-releases.
 * @param expectedSha256 Independently trusted lowercase SHA-256 digest of that text.
 */
export function parsePinnedNetworkManifest(text: string, expectedSha256: string): NetworkManifest {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256) || bytesToHex(sha256(new TextEncoder().encode(text))) !== expectedSha256) {
    throw new Error('Network manifest SHA-256 mismatch')
  }
  return parseNetworkManifest(JSON.parse(text))
}

/**
 * Planned and retired records can be displayed, but cannot configure a live client.
 * @param manifest Network manifest whose lifecycle status must be active.
 */
export function addressBookFromManifest(manifest: NetworkManifest): AddressBook {
  const checked = parseNetworkManifest(manifest)
  if (checked.status !== 'active') throw new Error(`Deployment ${checked.deploymentId} is ${checked.status}`)
  return Object.fromEntries(checked.contracts.map(c => [c.name, c.address]))
}

/**
 * EIP-1967 storage slot containing a proxy implementation address.
 */
export const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as const
/**
 * Observed contract code and proxy implementation compared with a manifest record.
 */
export interface ContractObservation {
  /**
   * Contract name from the manifest.
   */
  name: string
  /**
   * Address read at the finalized block.
   */
  address: Address
  /**
   * Runtime hash pinned by the manifest.
   */
  expectedCodeHash: Hex | null
  /**
   * Observed runtime hash, or null when no code exists.
   */
  observedCodeHash: Hex | null
  /**
   * Observed proxy implementation address, if present.
   */
  implementation: Address | null
  /**
   * Observed implementation runtime hash, if present.
   */
  implementationCodeHash: Hex | null
  /**
   * Whether deployed code and any proxy implementation match the manifest.
   */
  matches: boolean
}

/**
 * Observe a single finalized block. This verifies code identity, not business wiring or audit quality.
 * @param manifest Manifest containing expected deployment addresses and code hashes.
 * @param rpcUrl RPC endpoint for the same chain as the manifest.
 */
export async function observeNetworkManifest(manifest: NetworkManifest, rpcUrl: string) {
  const checked = parseNetworkManifest(manifest)
  const client = createPublicClient({transport: http(rpcUrl, {timeout: 15_000, retryCount: 1})})
  if (await client.getChainId() !== checked.chainId) throw new Error('RPC chain does not match manifest')
  const block = await client.getBlock({blockTag: 'finalized'})
  if (block.number === null || block.hash === null) throw new Error('RPC returned an unfinalized block')
  if (checked.verifiedAt) {
    if (BigInt(checked.verifiedAt.blockNumber) > block.number) throw new Error('Manifest verification is ahead of finalized chain')
    const original = await client.getBlock({blockNumber: BigInt(checked.verifiedAt.blockNumber)})
    if (original.hash !== checked.verifiedAt.blockHash) throw new Error('Manifest verification block is not canonical')
  }
  const contracts: ContractObservation[] = []
  for (const c of checked.contracts) {
    const code = await client.getBytecode({address: c.address, blockNumber: block.number})
    const observedCodeHash = code && code !== '0x' ? keccak256(code) : null
    let implementation: Address | null = null
    let implementationCodeHash: Hex | null = null
    if (c.proxy) {
      const word = await client.getStorageAt({address: c.address, slot: IMPLEMENTATION_SLOT, blockNumber: block.number})
      if (word && !/^0x0+$/.test(word)) {
        implementation = `0x${word.slice(-40)}`
        const implCode = await client.getBytecode({address: implementation, blockNumber: block.number})
        implementationCodeHash = implCode && implCode !== '0x' ? keccak256(implCode) : null
      }
    }
    contracts.push({name: c.name, address: c.address, expectedCodeHash: c.runtimeCodeHash, observedCodeHash,
      implementation, implementationCodeHash,
      matches: observedCodeHash !== null && observedCodeHash === c.runtimeCodeHash && (!c.proxy ||
        (implementation?.toLowerCase() === c.proxy.implementation.toLowerCase() && implementationCodeHash === c.proxy.runtimeCodeHash))})
  }
  return {chainId: checked.chainId, blockNumber: block.number.toString(), blockHash: block.hash,
    observedAt: new Date().toISOString(), contracts,
    matches: checked.status === 'active' && contracts.length > 0 && contracts.every(c => c.matches)}
}
