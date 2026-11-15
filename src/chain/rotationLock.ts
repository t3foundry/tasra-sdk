// The rotation lock (network ADR-0099). A slot's key can be locked against every rotation, for
// good: the creator locks it with `KeyRegistry.lockKeyRotation`, and a threshold-ECDSA slot
// (`tecdsa`, `tecdsa-p256`) is locked by its mode, whether or not anyone called it. A rotation
// would clear a tECDSA slot's key, and with it the EVM address of record, while no keeper can
// re-key a tECDSA epoch. Resharing is not affected: it moves the shares and keeps the key.
//
// The contract stores the lock as the `lastRotatedAt` sentinel 2^64 - 1, so every reader derives
// the effective lock the same way the keepers do:
//   lastRotatedAt(slot) == 2^64 - 1, or the slot's mode is tecdsa / tecdsa-p256.
// This module holds that read, the refusals a writer raises before signing, and the decoders for
// the lock's error and event, plus the reshare overlap revert.

import {decodeErrorResult, parseEventLogs, type Address, type Hex, type Log, type PublicClient} from 'viem'
import {TasraError} from '../errors.js'
import {viemErrorChainHas} from '../internal/viemErrors.js'
import {keyRegistryAbi} from './abis/keyRegistry.js'
import type {TasraChainClient} from './client.js'
import {requireAddress} from './deployments.js'
import {revertData} from './revertReason.js'

/** `lastRotatedAt` value the contract writes to lock a slot: 2^64 - 1, never a real timestamp. */
export const ROTATION_LOCK_SENTINEL = (1n << 64n) - 1n

/**
 * Selectors and the event topic of the rotation-lock additions to `KeyRegistry`, each the keccak256 of
 * the Solidity signature in its comment. A stale signature is a different selector, so a test pins
 * each value against its signature and against the vendored ABI.
 */
export const ROTATION_LOCK_SELECTORS = {
  /** `lockKeyRotation(bytes32)` */
  lockKeyRotation: '0x1fdf5ba1',
  /** `lastRotatedAt(bytes32)` */
  lastRotatedAt: '0x530a2a9e',
  /** Custom error `RotationLocked()` */
  RotationLocked: '0x47fa0746',
  /** Custom error `TecdsaReshareKeepsTooFew(uint16,uint16)` */
  TecdsaReshareKeepsTooFew: '0xb0b6baae',
  /** Event topic 0 of `KeyRotationLocked(bytes32)` */
  KeyRotationLocked: '0x1fb1f37197926bacece99747def77fb2d50c2841cc13663da1a7a70fee302771',
} as const

/** `KeyRegistry.Mode` ordinals locked by mode: `Tecdsa` (2) and `TecdsaP256` (4). */
const LOCKED_MODES: readonly number[] = [2, 4]

/**
 * Stable refusal categories of the rotation lock API; branch on `code`, never on the message.
 * None is retryable: each needs a different slot, key or registry first.
 */
export type RotationLockErrorCode = 'no-slot' | 'cancelled' | 'unsupported' | 'not-creator' | 'locked' | 'not-confirmed'

/** A lock or rotation refused before signing, or a lock the chain did not show after it mined. */
export class RotationLockError extends TasraError {
  /** Refusal category; never infer it from the message. */
  readonly code: RotationLockErrorCode
  /** Slot the refused call targeted. */
  readonly slotId: Hex

  constructor(code: RotationLockErrorCode, slotId: Hex, message: string, opts: {cause?: unknown} = {}) {
    super(message, {cause: opts.cause})
    this.code = code
    this.slotId = slotId
  }
}

/** A slot's rotation lock as the chain records it. */
export interface RotationLockStatus {
  /** Slot that was read. */
  slotId: Hex
  /** Slot creator, the only account that may call `lockKeyRotation`. */
  creator: Address
  /** `KeyRegistry.Mode` ordinal: 0 FROST, 1 BLS, 2 secp256k1 tECDSA, 3 BLS-BN254, 4 P-256 tECDSA. */
  mode: number
  /** Whether the slot is cancelled; a cancelled slot cannot be locked. */
  cancelled: boolean
  /** Raw `lastRotatedAt`: 0 never rotated, a block timestamp, or the lock sentinel. */
  lastRotatedAt: bigint
  /** The creator called `lockKeyRotation` (the sentinel is set). */
  lockedByCreator: boolean
  /** The slot's mode is threshold ECDSA, which no rotation ever changes. */
  lockedByMode: boolean
  /** Effective lock: no rotation path can change this slot's key. */
  locked: boolean
}

/** True when a read reverted or returned no data, as a missing selector does. */
function missingFunction(e: unknown): boolean {
  // By name: the read comes from the caller's client, whose viem copy may not be this package's.
  return viemErrorChainHas(e, ['ContractFunctionRevertedError', 'ContractFunctionZeroDataError'])
}

/**
 * Read a slot's rotation lock. Refuses `no-slot`, and `unsupported` for a KeyRegistry from before
 * the lock (where neither the creator lock nor the tECDSA refusal exists).
 * @param read A `readContract` function, from a viem public client.
 * @param keyRegistry KeyRegistry address of the deployment.
 * @param slotId Slot to read.
 */
export async function readRotationLockOnChain(read: PublicClient['readContract'], keyRegistry: Address, slotId: Hex): Promise<RotationLockStatus> {
  const slot = await read({address: keyRegistry, abi: keyRegistryAbi, functionName: 'getKeySlot', args: [slotId]})
  if (!slot.exists) throw new RotationLockError('no-slot', slotId, `slot ${slotId} does not exist on this KeyRegistry; check the slot id and the network`)
  let last: bigint
  try {
    last = await read({address: keyRegistry, abi: keyRegistryAbi, functionName: 'lastRotatedAt', args: [slotId]})
  } catch (e) {
    // A public mapping getter cannot revert on a registry that has it.
    if (!missingFunction(e)) throw e
    throw new RotationLockError('unsupported', slotId, `the KeyRegistry ${keyRegistry} has no rotation lock; it predates the upgrade that adds it`, {cause: e})
  }
  const mode = Number(slot.mode)
  const lockedByCreator = last === ROTATION_LOCK_SENTINEL
  const lockedByMode = LOCKED_MODES.includes(mode)
  return {
    slotId, creator: slot.creator, mode, cancelled: slot.cancelled, lastRotatedAt: last,
    lockedByCreator, lockedByMode, locked: lockedByCreator || lockedByMode,
  }
}

/**
 * Read a slot's rotation lock: whether the creator locked it, whether its mode locks it, and the
 * effective lock. Refuses `no-slot` and `unsupported` as a `RotationLockError`.
 * @param chain Reader for the deployment that owns the slot.
 * @param slotId Slot to read.
 */
export function readRotationLock(chain: TasraChainClient, slotId: Hex): Promise<RotationLockStatus> {
  return readRotationLockOnChain(chain.client.readContract, requireAddress(chain.addresses, 'KeyRegistry'), slotId)
}

/**
 * Whether no rotation can change the slot's key: the creator locked it, or it is a threshold
 * ECDSA slot (locked by its mode). Refuses `no-slot` and `unsupported` as a `RotationLockError`.
 * @param chain Reader for the deployment that owns the slot.
 * @param slotId Slot to read.
 */
export async function isRotationLocked(chain: TasraChainClient, slotId: Hex): Promise<boolean> {
  return (await readRotationLock(chain, slotId)).locked
}

/**
 * Refuse a rotation of `slotId` before signing when no rotation can change its key. A KeyRegistry
 * from before the lock has no creator lock to read, but a threshold-ECDSA rotation there still
 * clears the key for good, so such a slot is refused by its mode on every registry.
 * @param read A `readContract` function, from a viem public client.
 * @param keyRegistry KeyRegistry address of the deployment.
 * @param slotId Slot the rotation targets.
 * @param what Name of the refused call, for the message.
 */
export async function assertRotationAllowed(read: PublicClient['readContract'], keyRegistry: Address, slotId: Hex, what: string): Promise<void> {
  let s: RotationLockStatus
  try {
    s = await readRotationLockOnChain(read, keyRegistry, slotId)
  } catch (e) {
    if (!(e instanceof RotationLockError) || e.code !== 'unsupported') throw e
    const slot = await read({address: keyRegistry, abi: keyRegistryAbi, functionName: 'getKeySlot', args: [slotId]})
    const mode = Number(slot.mode)
    s = {slotId, creator: slot.creator, mode, cancelled: slot.cancelled, lastRotatedAt: 0n, lockedByCreator: false,
      lockedByMode: LOCKED_MODES.includes(mode), locked: LOCKED_MODES.includes(mode)}
  }
  if (s.locked) throw lockedRotationError(s, what)
}

/**
 * The refusal a rotation of a locked slot meets on chain, raised before signing instead.
 * @param s The slot's lock status.
 * @param what Name of the refused call, for the message.
 */
export function lockedRotationError(s: RotationLockStatus, what: string): RotationLockError {
  const why = s.lockedByCreator ? 'its creator locked rotation' : 'it is a threshold-ECDSA slot, locked by its mode'
  return new RotationLockError('locked', s.slotId,
    `${what}: slot ${s.slotId} never rotates (${why}); the chain reverts RotationLocked(). Change its keepers with a reshare, or cancel it and create a new slot for a new key`)
}

/** A decoded rotation-lock revert: the rotation lock, or a tECDSA reshare roster that keeps too few members. */
export type RotationLockRevert =
  | {
    /** `RotationLocked()`: no rotation can change this slot's key. */
    name: 'RotationLocked'
  }
  | {
    /** `TecdsaReshareKeepsTooFew(staying, k)`: the threshold-ECDSA reshare roster keeps too few current members. */
    name: 'TecdsaReshareKeepsTooFew'
    /** Current members the roster keeps. */
    staying: number
    /** Current threshold the roster must keep. */
    k: number
  }

const REVERT_ITEMS = keyRegistryAbi.filter(i => i.type === 'error' && (i.name === 'RotationLocked' || i.name === 'TecdsaReshareKeepsTooFew'))

/**
 * Decode `RotationLocked()` or `TecdsaReshareKeepsTooFew(staying, k)` from an error or raw revert
 * data; `undefined` for anything else. Both are final: the identical call reverts again.
 * @param error A viem or RPC error carrying revert data, or the revert data itself.
 */
export function decodeRotationLockRevert(error: unknown): RotationLockRevert | undefined {
  const data = typeof error === 'string' ? (/^0x[0-9a-fA-F]{8,}$/.test(error) ? error as Hex : undefined) : revertData(error)
  if (!data) return undefined
  try {
    const decoded = decodeErrorResult({abi: REVERT_ITEMS, data})
    if (decoded.errorName === 'RotationLocked') return {name: 'RotationLocked'}
    const [staying, k] = decoded.args
    return {name: 'TecdsaReshareKeepsTooFew', staying: Number(staying), k: Number(k)}
  } catch {
    return undefined
  }
}

/** One `KeyRotationLocked` event. */
export interface KeyRotationLockedEvent {
  /** Slot whose rotation was locked. */
  slotId: Hex
  /** Contract that emitted the event; compare it with the deployment's KeyRegistry. */
  address: Address
  /** Block of the event, when the log carries it. */
  blockNumber: bigint | null
  /** Transaction of the event, when the log carries it. */
  transactionHash: Hex | null
}

/**
 * Decode every `KeyRotationLocked(bytes32 indexed slotId)` among `logs`. Other events are skipped.
 * A tECDSA slot is locked by its mode and may never emit one; use `isRotationLocked` for the state.
 * @param logs Raw logs, from a receipt or `getLogs`.
 * @param keyRegistry When given, logs from any other contract are skipped.
 */
export function decodeKeyRotationLockedLogs(logs: readonly Log[], keyRegistry?: Address): KeyRotationLockedEvent[] {
  return parseEventLogs({abi: keyRegistryAbi, eventName: 'KeyRotationLocked', logs: [...logs]})
    .filter(l => !keyRegistry || l.address.toLowerCase() === keyRegistry.toLowerCase())
    .map(l => ({slotId: l.args.slotId, address: l.address, blockNumber: l.blockNumber ?? null, transactionHash: l.transactionHash ?? null}))
}
