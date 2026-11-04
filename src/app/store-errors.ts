import {TasraError} from '../errors.js'

/**
 * A state lock is already held and requires reconciliation before manual removal.
 */
export class StoreLockedError extends TasraError {
  constructor(/** Store entry whose exclusive lock could not be acquired. */ readonly key: string) { super(`State ${key} is locked; reconcile any interrupted operation before removing its lock`) }
}
