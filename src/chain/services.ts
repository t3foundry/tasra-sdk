import {decodeFunctionResult, encodeAbiParameters, encodeFunctionData, keccak256, type Address, type Hex, type PublicClient, type ReadContractReturnType} from 'viem'
import {serviceRegistryAbi} from './abis/serviceRegistry.js'
import {requireAddress, type AddressBook} from './deployments.js'
import {chainIdOf} from './chainId.js'
import {headFollowerOf} from './headFollower.js'
import {registerHeadPrefetch} from './headPrefetch.js'
import {pinnedRegistryCall, type PinnedBlock} from './pinnedReads.js'

function serviceAt(client: PublicClient, registry: Address, serviceId: Hex, at: PinnedBlock): Promise<ReadContractReturnType<typeof serviceRegistryAbi, 'getService'>> {
  return pinnedRegistryCall(client, at, registry, encodeFunctionData({abi: serviceRegistryAbi, functionName: 'getService', args: [serviceId]}), false).then(data => {
    if (data === undefined) throw new Error('empty ServiceRegistry.getService response')
    return decodeFunctionResult({abi: serviceRegistryAbi, functionName: 'getService', data})
  })
}

/**
 * A service's registration at the chain head: at a live head follower's tip (a block-pinned read,
 * pre-read at every new head once asked for), otherwise at `latest` by RPC as before.
 * @param chain Reader of the deployment.
 * @param serviceId Registered service.
 */
export function currentServiceRecord(chain: ServiceRegistryChainReader, serviceId: Hex): Promise<ReadContractReturnType<typeof serviceRegistryAbi, 'getService'>> {
  const tip = headFollowerOf(chain.client)?.tip()
  if (!tip) return chain.readers.serviceRegistry.getService(serviceId)
  const registry = requireAddress(chain.addresses, 'ServiceRegistry')
  registerHeadPrefetch(chain.client, `service:${registry}:${serviceId}`.toLowerCase(), head => serviceAt(chain.client, registry, serviceId, head))
  return serviceAt(chain.client, registry, serviceId, tip)
}

/** Permanent ServiceRegistry ABI ordinals. Registration grants no operator privileges. */
export const SERVICE_TYPES = {gasRelayer: 0, verifierAgent: 1, vaultService: 2} as const
/**
 * Registry lifecycle ordinals for active, draining and retired services.
 */
export const SERVICE_STATUSES = {active: 0, draining: 1, retired: 2} as const
/**
 * Registry ordinal identifying a gas relay, verifier agent or vault service.
 */
export type ServiceType = (typeof SERVICE_TYPES)[keyof typeof SERVICE_TYPES]
/**
 * Registry lifecycle status indicating whether a service accepts new work.
 */
export type ServiceStatus = (typeof SERVICE_STATUSES)[keyof typeof SERVICE_STATUSES]

/** Provider claims, not authenticated endpoints or platform endorsements. */
export interface ServiceRecord {
  /**
   * Current provider account controlling the registration.
   */
  owner: Address
  /**
   * Account nominated for ownership transfer; zero when none is pending.
   */
  pendingOwner: Address
  /**
   * Address whose key must sign endpoint identity challenges.
   */
  authKey: Address
  /**
   * Registered capability family.
   */
  serviceType: ServiceType
  /**
   * Provider lifecycle state.
   */
  status: ServiceStatus
  /**
   * Registry revision used to detect changed provider metadata.
   */
  revision: bigint
  /**
   * Keccak-256 digest of the exact published manifest bytes.
   */
  manifestHash: Hex
  /**
   * Registered canonical HTTPS service base URL.
   */
  endpoint: string
}

/** Pin the approved revision so an endpoint, key or provider change requires a new decision. */
export interface ServiceApproval {
  /**
   * Approved EVM chain ID.
   */
  chainId: number
  /**
   * Approved ServiceRegistry address.
   */
  registry: Address
  /**
   * Stable identifier of the approved service.
   */
  serviceId: Hex
  /**
   * Expected service capability family.
   */
  serviceType: ServiceType
  /**
   * Approved provider owner address.
   */
  owner: Address
  /**
   * Exact approved registry revision.
   */
  revision: bigint
  /**
   * Approved hash of the canonical service manifest.
   */
  manifestHash: Hex
}

/**
 * Matches serviceIdFor on the proxy. Provider transfer does not change this ID.
 * @param chainId EVM chain ID used in the registry identifier domain.
 * @param registry Deployed ServiceRegistry address.
 * @param creator Original provider address that registered the service.
 * @param salt Provider-chosen 32-byte registration salt.
 */
export function deriveServiceId(chainId: bigint, registry: Address, creator: Address, salt: Hex): Hex {
  return keccak256(encodeAbiParameters(
    [{type: 'uint256'}, {type: 'address'}, {type: 'address'}, {type: 'bytes32'}],
    [chainId, registry, creator, salt],
  ))
}

/**
 * Minimal chain reader required to validate service approvals without contacting the service.
 */
export interface ServiceRegistryChainReader {
  readonly addresses: AddressBook
  readonly client: PublicClient
  readonly readers: {
    readonly serviceRegistry: {
      getService(serviceId: Hex, blockNumber?: bigint):
        Promise<ReadContractReturnType<typeof serviceRegistryAbi, 'getService'>>
    }
  }
}

/**
 * Hash the exact downloaded/published bytes; never parse and re-serialize before checking.
 * @param bytes Exact canonical manifest bytes; do not parse and reserialize before hashing.
 */
export function hashServiceManifest(bytes: Uint8Array): Hex {
  return keccak256(bytes)
}

/**
 * Contract readers for service records and paginated service IDs. Supply one block number for a consistent snapshot.
 */
export interface ServiceRegistryReaders {
  getService(serviceId: Hex, blockNumber?: bigint):
    Promise<ReadContractReturnType<typeof serviceRegistryAbi, 'getService'>>
  serviceCount(blockNumber?: bigint):
    Promise<ReadContractReturnType<typeof serviceRegistryAbi, 'serviceCount'>>
  serviceIds(offset: bigint, limit: bigint, blockNumber?: bigint):
    Promise<ReadContractReturnType<typeof serviceRegistryAbi, 'serviceIds'>>
}

/**
 * Create paginated contract readers for service records and IDs.
 * @param client Viem public client for contract reads.
 * @param address Callback returning the deployed ServiceRegistry address.
 */
export function createServiceRegistryReaders(client: PublicClient, address: () => Address): ServiceRegistryReaders {
  return {
    getService: (serviceId: Hex, blockNumber?: bigint) => client.readContract({
      address: address(), abi: serviceRegistryAbi, functionName: 'getService', args: [serviceId], blockNumber,
    }),
    serviceCount: (blockNumber?: bigint) => client.readContract({
      address: address(), abi: serviceRegistryAbi, functionName: 'serviceCount', blockNumber,
    }),
    serviceIds: (offset: bigint, limit: bigint, blockNumber?: bigint) => {
      if (offset < 0n || limit < 1n || limit > 100n) throw new Error('Invalid ServiceRegistry page')
      return client.readContract({
        address: address(), abi: serviceRegistryAbi, functionName: 'serviceIds', args: [offset, limit], blockNumber,
      })
    },
  }
}

/**
 * Read metadata only after matching an explicit application approval. Never contacts the service.
 * This does not authenticate its endpoint, verify its manifest or authorize a verifier-agent
 * origin. Those checks must precede sending any credentials, session secrets or transactions.
 * @param chain Trusted chain reader with ServiceRegistry access.
 * @param approval Independently approved identity, owner, revision and manifest hash.
 */
export async function readApprovedServiceRecord(
  chain: ServiceRegistryChainReader,
  approval: ServiceApproval,
): Promise<{record: ServiceRecord; blockNumber: bigint}> {
  const registry = requireAddress(chain.addresses, 'ServiceRegistry')
  if (registry.toLowerCase() !== approval.registry.toLowerCase()) throw new Error('Service registry approval mismatch')
  const chainId = await chainIdOf(chain.client)
  if (chainId !== approval.chainId || (chain.client.chain && chain.client.chain.id !== chainId)) {
    throw new Error('Service chain approval mismatch')
  }
  // At a live head follower's tip (confirmed within 2 s) that the follower also proves FINAL
  // (instant finality, at or below a matching finalized header), the record is a read pinned to
  // that block's hash and pre-read at every new head; otherwise the head number and the record at
  // it are read by RPC, as before.
  const follower = headFollowerOf(chain.client)
  const live = follower?.tip()
  const tip = live && follower?.isCanonical(live) === true ? live : undefined
  let blockNumber: bigint, record: Awaited<ReturnType<typeof chain.readers.serviceRegistry.getService>>
  if (tip) {
    registerHeadPrefetch(chain.client, `service:${registry}:${approval.serviceId}`.toLowerCase(), head => serviceAt(chain.client, registry, approval.serviceId, head))
    blockNumber = tip.blockNumber
    record = await serviceAt(chain.client, registry, approval.serviceId, tip)
  } else {
    blockNumber = await chain.client.getBlockNumber({cacheTime: 0})
    record = await chain.readers.serviceRegistry.getService(approval.serviceId, blockNumber)
  }
  if (record.status !== SERVICE_STATUSES.active) throw new Error('Service is not accepting new work')
  if (record.serviceType !== approval.serviceType || !Object.values(SERVICE_TYPES).includes(record.serviceType)) {
    throw new Error('Service type approval mismatch')
  }
  if (record.owner.toLowerCase() !== approval.owner.toLowerCase()) throw new Error('Service owner approval mismatch')
  if (record.revision !== approval.revision || record.revision < 1n) throw new Error('Service revision approval mismatch')
  if (record.manifestHash.toLowerCase() !== approval.manifestHash.toLowerCase()) {
    throw new Error('Service manifest approval mismatch')
  }
  return {record: {...record, serviceType: approval.serviceType, status: SERVICE_STATUSES.active}, blockNumber}
}
