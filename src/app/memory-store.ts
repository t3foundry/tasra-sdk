// In-memory ApplicationStore: for tests, examples and short-lived processes only.
//
// ⚠ Nothing here survives the process. A paid reservation journaled only in memory cannot be
// reconciled after a crash, so production applications use createFileStore
// (tasra-sdk/app/node) or createIndexedDbStore (tasra-sdk/app/browser).

import {TasraError} from '../errors.js'
import type {ApplicationStore} from './ready-slot.js'

const KEY = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/

/**
 * Create a process-local store. Values are deep-copied on save and load (like a durable store,
 * a caller mutating its object never changes saved state), and `withLock` serializes work per
 * key by waiting, in call order.
 */
export function createMemoryStore(): ApplicationStore {
  const values = new Map<string, unknown>()
  const tails = new Map<string, Promise<void>>()
  const check = (key: string) => { if (typeof key !== 'string' || !KEY.test(key)) throw new TasraError('Invalid state key') }
  return {
    async load<T>(key: string): Promise<T | undefined> {
      check(key)
      return values.has(key) ? structuredClone(values.get(key)) as T : undefined
    },
    async save(key: string, value: unknown): Promise<void> {
      check(key)
      values.set(key, structuredClone(value))
    },
    async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
      check(key)
      const previous = tails.get(key) ?? Promise.resolve()
      let release!: () => void
      const tail = new Promise<void>(resolve => { release = resolve })
      const chained = previous.then(() => tail)
      tails.set(key, chained)
      await previous
      try { return await operation() }
      finally { release(); if (tails.get(key) === chained) tails.delete(key) }
    },
  }
}
