import type {Address, Hex} from 'viem'
import type {TasraChainClient} from './client.js'
import {keyRegistryAbi} from './abis/keyRegistry.js'
import {thresholdRandomBeaconAbi} from './abis/thresholdRandomBeacon.js'
import type {SlotSeedFailure} from './slotSeed.js'
import {TasraError} from '../errors.js'

/** A creation may keep its slot/rule inputs, but needs a durably saved new commit salt. */
export class SlotCommitmentExpiredError extends Error {
  constructor(/** Chain containing the expired creation commitment. */ readonly chainId: number, /** KeyRegistry contract that stores the commitment. */ readonly keyRegistry: Address, /** Slot identifier reserved by the original creation intent. */ readonly slotId: Hex,
    /** Expired commit-reveal commitment hash. */
    readonly commitment: Hex, /** Account that submitted the original commitment. */ readonly creator: Address, /** Original private commit salt; preserve it until outstanding requests are reconciled. */ readonly salt: Hex) {
    super('Slot commitment expired; reconcile outstanding relay requests before replacing its commit salt')
    this.name = 'SlotCommitmentExpiredError'
  }
}

/**
 * No accountant seed could be had for a creation within the bounded window. There is no beacon-epoch
 * fallback: the epoch seed comes from the same accountant set, so waiting for it adds no liveness,
 * only up to two hours. `committed` says whether a commitment is already on chain.
 */
export class SlotSeedUnavailableError extends TasraError {
  constructor(/** Which creation, whether its commitment is on chain, and every accountant's last answer. */ readonly detail: {
    /** Slot identifier reserved by the creation intent. */
    slotId: Hex
    /** `false`: nothing was sent; retrying the call is free. `true`: the commitment stands and the creation must be RESUMED, not restarted. */
    committed: boolean
    /** Creation commitment the seed was asked for. */
    commitment: Hex
    /** Commit transaction, when `committed`. */
    commitTx?: Hex
    /** Last beacon epoch in which the commitment can still be revealed, when `committed`. */
    expiryEpoch?: number
    /** Each accountant's last answer. */
    failure: SlotSeedFailure
  }) {
    super(detail.committed
      ? `No accountant seed for slot ${detail.slotId} (${detail.failure.reason}). The commitment ${detail.commitment} stands` +
        `${detail.commitTx ? ` (commit tx ${detail.commitTx})` : ''}${detail.expiryEpoch !== undefined ? ` and can be revealed until beacon epoch ${detail.expiryEpoch}` : ''}: ` +
        'resume with the same slotId, salt and ruleSalt and recovery.commitTx (createPreparedSlot resumes from its journal); nothing is committed again'
      : `No accountant seed is available for slot ${detail.slotId} (${detail.failure.reason}); no commitment was sent`,
    {retryable: true})
  }
}

/**
 * An existing beacon-epoch commitment (made by an older SDK) cannot be revealed yet. The check is made
 * once; the SDK never waits for the epoch. Resume the same creation once the beacon reaches `targetEpoch`.
 */
export class SlotRevealNotYetError extends TasraError {
  constructor(/** Slot identifier reserved by the creation intent. */ readonly slotId: Hex, /** The epoch-path commitment. */ readonly commitment: Hex,
    /** First beacon epoch in which it can be revealed. */ readonly targetEpoch: number, /** Beacon epoch observed by the check. */ readonly currentEpoch: number,
    /** Last beacon epoch in which it can be revealed. */ readonly expiryEpoch: number) {
    super(`Epoch-path commitment ${commitment} for slot ${slotId} is not revealable until beacon epoch ${targetEpoch} (now ${currentEpoch}); resume the creation then, before epoch ${expiryEpoch + 1}`, {retryable: true})
  }
}

/**
 * Read-only recovery gate. The caller must also reconcile every outstanding signed request.
 * @param chain Reader for the deployment owning the expired commitment.
 * @param error Saved commitment context to check before replacing its commit salt.
 */
export async function assertExpiredSlotCommitment(chain: TasraChainClient, error: SlotCommitmentExpiredError): Promise<void> {
  const registry = chain.addresses.KeyRegistry
  if (registry?.toLowerCase() !== error.keyRegistry.toLowerCase() || await chain.client.getChainId() !== error.chainId) {
    throw new Error('Commitment recovery belongs to a different deployment')
  }
  const blockNumber = await chain.client.getBlockNumber({cacheTime: 0})
  const [slot, commit, beacon] = await Promise.all([
    chain.client.readContract({address: registry, abi: keyRegistryAbi, functionName: 'getKeySlot', args: [error.slotId], blockNumber}),
    chain.client.readContract({address: registry, abi: keyRegistryAbi, functionName: 'slotCommits', args: [error.commitment], blockNumber}),
    chain.client.readContract({address: registry, abi: keyRegistryAbi, functionName: 'randomBeacon', blockNumber}),
  ])
  const epoch = await chain.client.readContract({address: beacon, abi: thresholdRandomBeaconAbi, functionName: 'epoch', blockNumber})
  if (slot.exists || commit[3] || commit[2].toLowerCase() !== error.creator.toLowerCase() || commit[0] === 0n || epoch <= commit[1]) {
    throw new Error('Commitment recovery requires an expired unused commitment and an absent slot')
  }
}
