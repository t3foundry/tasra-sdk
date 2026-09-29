import {encodeAbiParameters, keccak256, type Address, type Hex, type PublicClient, type ReadContractReturnType} from 'viem'
import {serviceRegistryAbi} from './abis/serviceRegistry.js'
import {requireAddress, type AddressBook} from './deployments.js'

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
  const chainId = await chain.client.getChainId()
  if (chainId !== approval.chainId || (chain.client.chain && chain.client.chain.id !== chainId)) {
    throw new Error('Service chain approval mismatch')
  }
  const blockNumber = await chain.client.getBlockNumber({cacheTime: 0})
  const record = await chain.readers.serviceRegistry.getService(approval.serviceId, blockNumber)
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
