// Recognising a viem error by its name, not by its class.
//
// A caller hands the SDK its own viem client. When that client was built from viem's CommonJS
// entry (`require('viem')`) while this package imports viem's ES module build, or when the caller
// has a second copy of viem in its tree, the errors that client throws are instances of DIFFERENT
// classes with the same names: `error instanceof TransactionReceiptNotFoundError` is then false for
// a receipt that is simply not there yet. Every viem error extends viem's BaseError, which sets a
// `name` (the class name) and a `shortMessage`, so those two identify the error whichever copy of
// viem threw it.

/** A viem error as any copy of viem builds it: an object with its class name and a short message. */
export interface ViemErrorLike {
  name: string
  message: string
  shortMessage: string
  cause?: unknown
}

/**
 * True when `error` looks like a viem error (any class), thrown by any copy of viem.
 * @param error Anything caught.
 */
export function isAnyViemError(error: unknown): error is ViemErrorLike {
  if (typeof error !== 'object' || error === null) return false
  const e = error as {name?: unknown; message?: unknown; shortMessage?: unknown}
  return typeof e.name === 'string' && typeof e.message === 'string' && typeof e.shortMessage === 'string'
}

/**
 * True when `error` is a viem error named `name`, thrown by any copy of viem (its ES module or
 * CommonJS build, or another installed version).
 * @param error Anything caught.
 * @param name viem error class name, such as `TransactionReceiptNotFoundError`.
 */
export function isViemError(error: unknown, name: string): error is ViemErrorLike {
  return isAnyViemError(error) && error.name === name
}

/** Longest `cause` chain walked; viem nests a handful of levels. */
const MAX_CAUSE_DEPTH = 32

/**
 * True when `error` is a viem error and it, or an error in its `cause` chain, is a viem error named
 * one of `names` - what viem's `BaseError.walk` finds, for an error from any copy of viem.
 * @param error Anything caught.
 * @param names viem error class names to look for.
 */
export function viemErrorChainHas(error: unknown, names: readonly string[]): boolean {
  if (!isAnyViemError(error)) return false
  const seen = new Set<unknown>()
  let e: unknown = error
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && typeof e === 'object' && e !== null && !seen.has(e); depth++) {
    seen.add(e)
    if (names.some(name => isViemError(e, name))) return true
    e = (e as {cause?: unknown}).cause
  }
  return false
}
