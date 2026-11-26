// A BLS slot's keepers and authenticated public sharing, from the slot id alone: the registry
// names the assigned operators and their identity keys, and each keeper's signed share report is
// verified against them (`discoverBlsSharing`). Nothing owner-held is needed.

import {hexToBytes, type Hex} from 'viem'
import {discoverBlsSharing, type BlsSharing} from '../committee/blsSharing.js'
import type {TasraChainClient} from './client.js'
import {chainIdOf} from './chainId.js'

/** Options of {@link readSlotSharing}. */
export interface SlotSharingOptions {
  /** Caller-approved routing of a registered keeper URL (e.g. local Docker hostnames to published loopback ports). */
  keeperUrl?(registeredUrl: string): string
  /** Guarded HTTP transport for the share reports; defaults to global fetch. */
  fetchImpl?: typeof fetch
  /** Allow loopback HTTP for a disposable local chain 43112 only. Default false. */
  allowLocalHttp?: boolean
  /** Cancel the reads. */
  signal?: AbortSignal
}

/** A BLS slot's canonical sharing and the keepers that proved their part of it. */
export interface SlotSharing extends BlsSharing {
  /** Chain the slot lives on, as the RPC reports it. */
  chainId: number
  /** The slot's current key epoch. */
  epoch: number
  /** The slot's sharing version (a reshare changes it without changing the epoch). */
  committeeVersion: number
  /** Contributions needed for one operation. */
  threshold: number
  /** The verified keepers' endpoints, in registry order. */
  nodeUrls: string[]
}

/**
 * Read a BLS slot's current sharing: the slot's epoch, sharing version and threshold, its assigned
 * keepers with their registered identity keys, and each keeper's authenticated 144-byte public
 * verifying share. This is everything a recipient-sealed decryption or a session decrypt needs
 * beside its authorization. Performs no transaction; fetches no secret.
 * @param chain - Reader for the deployment owning the slot.
 * @param slotId - 32-byte slot ID of a BLS slot with a published key.
 * @param options - Keeper route mapping, transport, local HTTP and cancellation.
 */
export async function readSlotSharing(chain: TasraChainClient, slotId: Hex, options: SlotSharingOptions = {}): Promise<SlotSharing> {
  options.signal?.throwIfAborted()
  const route = options.keeperUrl ?? ((url: string) => url)
  const [slot, chainId, operators] = await Promise.all([chain.readers.keyRegistry.getKeySlot(slotId), chainIdOf(chain.client), chain.readers.keyRegistry.assignedNodes(slotId)])
  if (!slot.exists || slot.cancelled) throw new Error('Slot does not exist or is cancelled')
  if (Number(slot.mode) !== 1 || slot.publicKey === '0x') throw new Error('Slot is not a BLS slot with a published key')
  options.signal?.throwIfAborted()
  // An unreadable operator fails the read: a quietly short roster looks like a smaller slot.
  const keepers = await Promise.all(operators.map(async operator => {
    const node = await chain.readers.nodeRegistry.nodeOf(operator)
    return {operator, nodeUrl: route(node.url), publicKey: hexToBytes(node.pubkey)}
  }))
  const epoch = Number(slot.epoch), committeeVersion = Number(slot.committeeVersion), threshold = Number(slot.threshold.k)
  const sharing = await discoverBlsSharing({chainId, slotId, epoch, committeeVersion, threshold, keepers,
    ...(options.fetchImpl ? {fetchImpl: options.fetchImpl} : {}), ...(options.allowLocalHttp ? {allowLocalHttp: true} : {}), ...(options.signal ? {signal: options.signal} : {})})
  return {...sharing, chainId, epoch, committeeVersion, threshold, nodeUrls: sharing.keepers.map(k => k.nodeUrl)}
}
