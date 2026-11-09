// Internal durable-commit steps of the SDK's own stores. Not part of the public ApplicationStore
// contract: an application store without them gets the same calls as before, one save at a time.
//
// The paid paths journal several values per transition, and on the Node file store every durable
// save costs two device flushes (data barrier, directory sync) and every lock three. These steps let
// one transition pay once:
//
// - `withCommit`: a lock whose entry is not flushed on its own, and whose last writes are published
//   with the unlock in ONE commit (their data flushed once, renamed, the lock removed, the
//   directory synced once). The lock is still exclusive across processes at once (O_EXCL). It is
//   durable no later than the first durable write the action makes, because that write's directory
//   sync covers every entry created before it in the same directory. An action that sends anything
//   journals it durably first, so at every external step the lock is exactly as durable as before;
//   before that step it guards nothing a recovery reads. (The browser store's Web Locks are never
//   durable at all, so no recovery path can depend on finding a lock after a crash.)
// - `saveAll`: several keys in one commit. A crash before it resolves may leave ANY subset of them;
//   each caller states why every subset is safe.
// - `saveRederivable`: a complete value (flushed before it is renamed into place, never torn) whose
//   directory entry becomes durable with the next directory sync. A crash may leave the previous
//   value; only for values a recovery re-derives from what it reads anyway.

import type {ApplicationStore} from './ready-slot.js'

/** Writes staged by a {@link withCommit} action, published with the lock's release. */
export interface LockedCommit {
  /** Publish `value` under `key` when the action returns normally (never when it throws). A later stage of one key replaces an earlier one. */
  stage(key: string, value: unknown): void
}

/** The commit steps a store implements natively (the file store). */
export interface StoreCommitSteps {
  withCommit<T>(keys: string | readonly string[], action: (commit: LockedCommit) => Promise<T>): Promise<T>
  saveAll(entries: readonly (readonly [string, unknown])[]): Promise<void>
  saveRederivable(key: string, value: unknown): Promise<void>
}

/** Where a store carries its native commit steps. */
export const STORE_COMMIT: unique symbol = Symbol.for('@t3foundry/tasra-sdk/store-commit')

function steps(store: ApplicationStore): StoreCommitSteps | undefined {
  const found = (store as {[STORE_COMMIT]?: StoreCommitSteps})[STORE_COMMIT]
  return found && typeof found.withCommit === 'function' ? found : undefined
}

/**
 * Exclusively run `action` under the lock of `keys` (several: all of them, taken in sorted order),
 * then publish what it staged with the release. Without native steps: `withLock` on each key in
 * sorted order, and each staged value saved, in stage order, before the release.
 */
export function withCommit<T>(store: ApplicationStore, keys: string | readonly string[], action: (commit: LockedCommit) => Promise<T>): Promise<T> {
  const native = steps(store)
  if (native) return native.withCommit(keys, action)
  const sorted = [...new Set(typeof keys === 'string' ? [keys] : keys)].sort()
  const run = async () => {
    const staged = new Map<string, unknown>()
    const result = await action({stage: (k, v) => { staged.delete(k); staged.set(k, structuredClone(v)) }})
    for (const [k, v] of staged) await store.save(k, v)
    return result
  }
  return sorted.reduceRight<() => Promise<T>>((inner, key) => () => store.withLock(key, inner), run)()
}

/** Save every entry durably before resolving; without native steps, one at a time in order. */
export async function saveAll(store: ApplicationStore, entries: readonly (readonly [string, unknown])[]): Promise<void> {
  const native = steps(store)
  if (native) return native.saveAll(entries)
  for (const [key, value] of entries) await store.save(key, value)
}

/** Save a value its recovery re-derives; without native steps, an ordinary save. */
export function saveRederivable(store: ApplicationStore, key: string, value: unknown): Promise<void> {
  const native = steps(store)
  return native ? native.saveRederivable(key, value) : store.save(key, value)
}

/**
 * Re-derivable writes of one flow, published with its next durable commit instead of on their own
 * (or by {@link Rederivable.flush} at its end). Only for values the flow's own recovery re-derives
 * from what it reads anyway: a crash may leave each one unwritten.
 */
export class Rederivable {
  readonly #pending = new Map<string, unknown>()
  /** Write `value` under `key` with the next commit (a later put of one key replaces an earlier one). */
  put(key: string, value: unknown): void { this.#pending.delete(key); this.#pending.set(key, structuredClone(value)) }
  /** The entries for the commit about to run; give them back with {@link Rederivable.restore} if it failed. */
  take(): [string, unknown][] { const out = [...this.#pending]; this.#pending.clear(); return out }
  /** Return entries a failed commit did not publish (a newer put of a key wins). */
  restore(entries: readonly (readonly [string, unknown])[]): void { for (const [key, value] of entries) if (!this.#pending.has(key)) this.#pending.set(key, value) }
  /** Publish whatever is left, each as {@link saveRederivable}. */
  async flush(store: ApplicationStore): Promise<void> {
    const out = this.take()
    try { await Promise.all(out.map(([key, value]) => saveRederivable(store, key, value))) }
    catch (error) { this.restore(out); throw error }
  }
}
