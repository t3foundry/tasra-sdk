// Bounded, evicting maps for hot-path reuse. Nothing here grows without limit.

/**
 * A least-recently-used map holding at most `max` entries; the oldest is evicted first.
 * Store only values that are a pure function of the key (decoded public points), never secrets.
 */
export class BoundedCache<K, V> {
  readonly #entries = new Map<K, V>()
  constructor(readonly max: number) {
    if (!Number.isSafeInteger(max) || max < 1) throw new Error('cache bound must be a positive integer')
  }
  /** Number of entries currently held. */
  get size(): number { return this.#entries.size }
  /**
   * Return the cached value, or compute, store and return it. A throwing `compute` stores nothing.
   * @param key Cache key.
   * @param compute Pure derivation of the value from the key.
   */
  getOrCompute(key: K, compute: () => V): V {
    if (this.#entries.has(key)) {
      const value = this.#entries.get(key) as V
      this.#entries.delete(key)
      this.#entries.set(key, value)
      return value
    }
    const value = compute()
    if (this.#entries.size >= this.max) this.#entries.delete(this.#entries.keys().next().value as K)
    this.#entries.set(key, value)
    return value
  }
}

/**
 * Share one in-flight promise per key among concurrent callers. An entry lives only while its
 * promise is pending (a settled result, success or failure, is never reused), and at most
 * `max` keys are shared at once; beyond that a caller simply runs its own request.
 */
export class SingleFlight<V> {
  readonly #pending = new Map<string, Promise<V>>()
  constructor(readonly max: number) {
    if (!Number.isSafeInteger(max) || max < 1) throw new Error('single-flight bound must be a positive integer')
  }
  /** Number of keys currently in flight. */
  get size(): number { return this.#pending.size }
  /**
   * Join the pending request for `key`, or start one with `run`.
   * @param key Identity of the request; equal keys must denote identical requests.
   * @param run Starts the request.
   */
  run(key: string, run: () => Promise<V>): Promise<V> {
    const existing = this.#pending.get(key)
    if (existing) return existing
    if (this.#pending.size >= this.max) return run()
    const started = run()
    this.#pending.set(key, started)
    const clear = () => { if (this.#pending.get(key) === started) this.#pending.delete(key) }
    started.then(clear, clear)
    return started
  }
}

/**
 * A least-recently-used map of at most `max` entries, each dropped once its own expiry passes.
 * Store only values that can never change for their key (a read pinned to a finalized block).
 */
export class ExpiringCache<V> {
  readonly #entries = new Map<string, {value: V; expiresAt: number}>()
  constructor(readonly max: number) {
    if (!Number.isSafeInteger(max) || max < 1) throw new Error('cache bound must be a positive integer')
  }
  /** Number of entries currently held, expired ones included until touched or evicted. */
  get size(): number { return this.#entries.size }
  /**
   * Return an unexpired value, or `undefined`. A hit becomes the most recently used entry.
   * @param key Cache key.
   * @param now Current time in milliseconds.
   */
  get(key: string, now = Date.now()): V | undefined {
    const entry = this.#entries.get(key)
    if (!entry) return undefined
    this.#entries.delete(key)
    if (entry.expiresAt <= now) return undefined
    this.#entries.set(key, entry)
    return entry.value
  }
  /**
   * Store `value` until `expiresAt`; an already expired value is not stored. At the bound the
   * least recently used entry is evicted.
   * @param key Cache key.
   * @param value Immutable value for the key.
   * @param expiresAt Expiry in milliseconds.
   * @param now Current time in milliseconds.
   */
  set(key: string, value: V, expiresAt: number, now = Date.now()): void {
    this.#entries.delete(key)
    if (!(expiresAt > now)) return
    if (this.#entries.size >= this.max) this.#entries.delete(this.#entries.keys().next().value as string)
    this.#entries.set(key, {value, expiresAt})
  }
}
