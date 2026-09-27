import type {AddressBook} from '../chain/deployments.js'
import {TasraError} from '../errors.js'

/** Public, versioned application configuration. Never contains credentials or private keys. */
export interface TasraDeployment {
  schemaVersion: 1
  name: string
  chainId: number
  rpcUrl: string
  addresses: AddressBook
  /** Explicit coordinator convention of the tested network build. */
  coordinator: 'lowest-operator-id' | 'assigned-first'
  /** Optional immutable deployment provenance; an active manifest alone is not readiness. */
  provenance?: {networkRevision: string; manifestSha256?: string}
}

/** Validate a caller-approved descriptor. This does not establish its authenticity. */
export function defineDeployment(value: TasraDeployment): Readonly<TasraDeployment> {
  if (value.schemaVersion !== 1 || !value.name || !Number.isSafeInteger(value.chainId) || value.chainId <= 0 ||
    !['lowest-operator-id', 'assigned-first'].includes(value.coordinator)) throw new TasraError('Invalid deployment schema, chain or coordinator policy')
  const rpc = new URL(value.rpcUrl)
  if (!['http:', 'https:'].includes(rpc.protocol) || rpc.username || rpc.password || rpc.hash) throw new TasraError('Invalid deployment RPC URL')
  for (const name of ['KeyRegistry', 'NodeRegistry'] as const) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(value.addresses[name] ?? '') || /^0x0{40}$/i.test(value.addresses[name]!)) throw new TasraError(`Deployment requires ${name}`)
  }
  return Object.freeze({...value, addresses: Object.freeze({...value.addresses}), ...(value.provenance ? {provenance: Object.freeze({...value.provenance})} : {})})
}
