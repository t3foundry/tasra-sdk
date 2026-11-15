import {encodeFunctionData, type Hex} from 'viem'
import {keyRegistryAbi} from '../chain/abis/index.js'
import {RotationLockError, readRotationLockOnChain} from '../chain/rotationLock.js'
import {protocolHex} from '../committee/receipts.js'
import type {TasraApplication} from './client.js'
import type {ApplicationStore} from './ready-slot.js'
import type {TasraWallet, WalletTransactionJournal} from './wallet.js'

/** The slot was already locked against rotation: nothing was sent (the lock is set-once). */
export interface RotationAlreadyLocked {
  /** Nothing was sent: no rotation could change this slot's key already. */
  phase: 'already-locked'
  /** The slot found locked. */
  slotId: Hex
  /** The creator locked it earlier. */
  lockedByCreator: boolean
  /** It is a threshold-ECDSA slot, which the network locks by its mode. */
  lockedByMode: boolean
  /** No transaction: kept so code reading `.hash` of a journal still compiles. */
  hash?: undefined
}

/**
 * Lock a slot's key against every rotation, for good, with a durable named transaction from the
 * slot creator's wallet (`KeyRegistry.lockKeyRotation`). Afterwards no creator, operator vote or
 * revocation notice can rotate the key; resharing still works, because it keeps the key. Use it
 * when the key is an identity that must never change, such as a custody address.
 *
 * The lock is SET-ONCE: a slot already locked resolves `already-locked` without sending. Every
 * threshold-ECDSA slot is locked by its mode already, so it resolves that way too and never emits
 * `KeyRotationLocked`. Refused before sending, as a `RotationLockError`: `no-slot`, `cancelled`,
 * `unsupported` (a KeyRegistry without the lock) and `not-creator`; `not-confirmed` when the
 * transaction confirmed but the chain does not show the lock. A transaction whose outcome was
 * unknown is reconciled by calling this again with the same name (the wallet's journal).
 * @param app Application client for the slot deployment.
 * @param slotId Slot whose rotation is being locked.
 * @param options Creator wallet and durable store for the named lock transaction.
 */
export async function lockKeyRotation(app: Pick<TasraApplication, 'deployment' | 'chain'>, slotId: Hex,
  options: {wallet: TasraWallet; store: ApplicationStore; name?: string}): Promise<WalletTransactionJournal | RotationAlreadyLocked> {
  protocolHex(slotId, 32, 'slot id')
  const {wallet, store} = options, name = options.name ?? `rotation-lock-${slotId.slice(2)}`
  if (wallet.wallet.chain.id !== app.deployment.chainId) throw new Error('Rotation lock wallet uses a different chain')
  const registry = app.deployment.addresses.KeyRegistry!, read = app.chain.client.readContract
  // Set-once: judge what is on chain before anything is signed or sent.
  const before = await readRotationLockOnChain(read, registry, slotId)
  if (before.cancelled) throw new RotationLockError('cancelled', slotId, `slot ${slotId} is cancelled; a cancelled slot cannot be locked`)
  if (before.locked) return {phase: 'already-locked', slotId, lockedByCreator: before.lockedByCreator, lockedByMode: before.lockedByMode}
  if (before.creator.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new RotationLockError('not-creator', slotId, `slot ${slotId} has creator ${before.creator}, but the wallet is ${wallet.address}`)
  }
  const data = encodeFunctionData({abi: keyRegistryAbi, functionName: 'lockKeyRotation', args: [slotId]})
  const transaction = await wallet.transfer(name, {to: registry, data}, store)
  const after = await readRotationLockOnChain(read, registry, slotId)
  if (!after.lockedByCreator) throw new RotationLockError('not-confirmed', slotId, `slot ${slotId} shows lastRotatedAt ${after.lastRotatedAt}, not the lock`)
  return transaction
}
