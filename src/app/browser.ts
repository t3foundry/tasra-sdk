/** Browser durable state and paid-flow transports. Import from tasra-sdk/app/browser. */
//
// The paid flow needs two things a page, an extension service worker or a PWA must supply:
// state that survives a crash and is exclusive across tabs (a reservation's gas payer, a
// session's journaled writes), and HTTP transports that never follow redirects, never send
// cookies and bound every reply. IndexedDB with a strict-durability commit gives the first,
// the Web Locks API (navigator.locks) the exclusivity, and fetch the transports.
//
// ⚠ A browser cannot check where a hostname resolves, so unlike the Node transports these
// cannot refuse a public name that points at a private address. They require HTTPS (as every
// registered service endpoint does) and refuse loopback names and private IP literals unless
// the application approves them; rely on the browser's private-network protections for the rest. Services must allow
// this origin through CORS (and expose `Retry-After` for retry hints).

import {TasraError} from '../errors.js'
import {parseRetryAfter} from '../internal/retryAfter.js'
import {acceptsServiceResponse, serviceRequestShape, type ServiceTransportMode} from '../chain/serviceRequestPolicy.js'
import type {ServiceDiscoveryTransport} from '../chain/serviceIdentity.js'
import type {PaidAgentHttpResponse, PaidAgentTransport} from '../chain/paidAgentTransport.js'
import type {KeeperRecoveryTransport} from '../chain/keeperRecovery.js'
import type {RelayHttpResponse, RelayTransport} from '../chain/registeredRelay.js'
import type {ApplicationStore} from './ready-slot.js'
import {StoreLockedError} from './store-errors.js'

export {StoreLockedError}
export type {ApplicationStore}

const KEY = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/

/** Options for {@link createIndexedDbStore}. */
export interface IndexedDbStoreOptions {
  /** Database name; one per application and deployment (default `tasra-sdk-state`). */
  name?: string
  /** IndexedDB factory (default `globalThis.indexedDB`). */
  indexedDB?: IDBFactory
  /** Web Locks manager (default `navigator.locks`). Required: tabs must share exclusive locks. */
  locks?: LockManager
  /** Fail with StoreLockedError instead of waiting when another tab holds the lock (default false: wait). */
  failIfLocked?: boolean
}

function assertPlain(value: unknown, seen = new Set<object>()): void {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'bigint') return
  if (typeof value === 'number') { if (Number.isFinite(value)) return; throw new TasraError('State must contain finite numbers') }
  if (value instanceof Uint8Array) return
  if (typeof value !== 'object' || seen.has(value)) throw new TasraError('State must contain finite plain data without cycles')
  seen.add(value)
  try {
    if (Array.isArray(value)) { for (const item of value) assertPlain(item, seen); return }
    const proto = Object.getPrototypeOf(value) as unknown
    if (proto !== Object.prototype && proto !== null) throw new TasraError('State must contain plain objects')
    for (const item of Object.values(value)) assertPlain(item, seen)
  } finally { seen.delete(value) }
}
function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error ?? new TasraError('IndexedDB request failed')) })
}

/**
 * Durable private state for browser applications: IndexedDB records committed with strict
 * durability before `save` resolves, and Web Locks (exclusive, shared by every tab, worker and
 * extension service worker of this origin) for `withLock`. Values must be plain data (strings,
 * finite numbers, booleans, bigints, Uint8Array, arrays and plain objects).
 * @param options Database name, factory/lock overrides and lock-wait behavior.
 */
export function createIndexedDbStore(options: IndexedDbStoreOptions = {}): ApplicationStore {
  const name = options.name ?? 'tasra-sdk-state'
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) throw new TasraError('Invalid IndexedDB store name')
  const factory = options.indexedDB ?? globalThis.indexedDB
  const locks = options.locks ?? (globalThis.navigator as Navigator | undefined)?.locks
  if (!factory) throw new TasraError('IndexedDB is unavailable; paid state needs durable browser storage')
  if (!locks || typeof locks.request !== 'function') throw new TasraError('Web Locks are unavailable; paid state needs locks shared across tabs')
  let opened: Promise<IDBDatabase> | undefined
  const db = () => opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const open = factory.open(name, 1)
    open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains('state')) open.result.createObjectStore('state') }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => { opened = undefined; reject(open.error ?? new TasraError('IndexedDB open failed')) }
    open.onblocked = () => { opened = undefined; reject(new TasraError('IndexedDB open blocked by another version')) }
  })
  const check = (key: string) => { if (typeof key !== 'string' || !KEY.test(key)) throw new TasraError('Invalid state key') }
  return {
    async load<T>(key: string): Promise<T | undefined> {
      check(key)
      const tx = (await db()).transaction('state', 'readonly')
      return await request(tx.objectStore('state').get(key)) as T | undefined
    },
    async save(key: string, value: unknown): Promise<void> {
      check(key); assertPlain(value)
      const tx = (await db()).transaction('state', 'readwrite', {durability: 'strict'})
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new TasraError('IndexedDB write failed'))
        tx.onabort = () => reject(tx.error ?? new TasraError('IndexedDB write aborted'))
      })
      tx.objectStore('state').put(value, key)
      // Resolve only after the commit: an uncertain write must never look persisted.
      await done
    },
    async list(prefix: string): Promise<string[]> {
      const tx = (await db()).transaction('state', 'readonly')
      const keys = await request(tx.objectStore('state').getAllKeys())
      return keys.filter((key): key is string => typeof key === 'string' && key.startsWith(prefix))
    },
    async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
      check(key)
      return locks.request(`${name}:${key}`, {mode: 'exclusive', ifAvailable: options.failIfLocked === true}, async lock => {
        if (lock === null) throw new StoreLockedError(key)
        return operation()
      }) as Promise<T>
    },
    async claim(key: string): Promise<boolean> {
      check(key)
      // An exclusive Web Lock on the claim name (shared by every tab and worker of the origin), and
      // inside it ONE strict-durability transaction that inserts the record only when absent:
      // `add` fails with ConstraintError on an existing key, aborting the transaction. Either way
      // exactly one caller wins; the winner's record is committed before this resolves.
      return await locks.request(`${name}:claim:${key}`, {mode: 'exclusive'}, async (): Promise<boolean> => {
        const tx = (await db()).transaction('state', 'readwrite', {durability: 'strict'})
        let exists = false
        const done = new Promise<boolean>((resolve, reject) => {
          tx.oncomplete = () => resolve(true)
          tx.onerror = () => {}
          tx.onabort = () => exists ? resolve(false) : reject(tx.error ?? new TasraError('IndexedDB claim aborted'))
        })
        const insert = tx.objectStore('state').add({claimed: true}, key)
        insert.onerror = () => { exists = insert.error?.name === 'ConstraintError' }
        return await done
      })
    },
  }
}

/** Options shared by the browser transports. */
export interface BrowserTransportOptions {
  /** Fetch implementation (default global fetch). */
  fetch?: typeof fetch
  /** Exact loopback names or private IP literals the application approves (e.g. `localhost` during local development). */
  allowedPrivateHosts?: readonly string[]
  /** Absolute per-request deadline in ms (default 30000). */
  timeoutMs?: number
}

function privateLiteral(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32)
      || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
  }
  // Every IPv6 literal needs explicit approval; a browser cannot classify the rest.
  return host.startsWith('[')
}

type FetchOptions = {body?: Uint8Array; maxBytes: number; signal: AbortSignal; bearer?: string; method?: 'GET' | 'POST'; oauth?: {accessToken: string; proof: string}}

function browserTransport(mode: ServiceTransportMode, options: BrowserTransportOptions, localHttp = false) {
  const doFetch = options.fetch ?? globalThis.fetch, timeout = options.timeoutMs ?? 30_000
  const privateHosts = new Set(options.allowedPrivateHosts ?? [])
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120_000) throw new TasraError('Invalid browser transport timeout')
  if (typeof doFetch !== 'function') throw new TasraError('fetch is unavailable')
  return async (url: string, request: FetchOptions): Promise<{status: number; body: Uint8Array; retryAfterMs?: number; retryAfter?: string; rateLimitAfter?: string}> => {
    request.signal.throwIfAborted()
    const parsed = new URL(url)
    // Local development HTTP: only to a loopback name or private IP literal, checked with the same
    // route policy as its HTTPS form. Every other destination still needs HTTPS.
    const plain = localHttp && parsed.protocol === 'http:' && privateLiteral(parsed.hostname)
    const shape = serviceRequestShape(mode, plain ? 'https:' + url.slice('http:'.length) : url, request)
    if (parsed.protocol !== 'https:' && !plain) throw new Error('Service destination policy requires HTTPS')
    if (privateLiteral(parsed.hostname) && !privateHosts.has(parsed.hostname) && !plain) throw new Error('Service destination policy refuses address')
    const response = await doFetch(url, {method: shape.method, headers: shape.headers, body: request.body?.slice(),
      redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', mode: 'cors',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(timeout)])})
    const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
    const noContent = mode === 'paid-agent' && response.status === 204
    if (!acceptsServiceResponse(mode, shape, Boolean(request.body), response.status, type)) {
      await response.body?.cancel().catch(() => {})
      throw new Error(`Service HTTP status, content type or encoding refused (HTTP ${response.status}, ${type || 'no content type'})`)
    }
    const advertised = response.headers.get('content-length')
    if (advertised && !response.headers.get('content-encoding') && (!/^\d+$/.test(advertised) || Number(advertised) > request.maxBytes)) {
      await response.body?.cancel().catch(() => {})
      throw new Error('Service response too large')
    }
    // Bound the decoded bytes; the browser may have decompressed the body.
    const chunks: Uint8Array[] = []
    let size = 0
    if (response.body) {
      const reader = response.body.getReader()
      try {
        for (;;) {
          const {done, value} = await reader.read()
          if (done) break
          size += value.length
          if (size > request.maxBytes) throw new Error('Service response too large')
          chunks.push(value)
        }
      } finally { await reader.cancel().catch(() => {}) }
    }
    if (noContent && size !== 0) throw new Error('Unexpected paid agent response body')
    const body = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length }
    const retryAfter = response.headers.get('retry-after'), retryAfterMs = parseRetryAfter(retryAfter)
    // Paid replies also carry the raw wait headers for the strict paid pacer (CORS must expose them).
    const rateLimitAfter = mode === 'paid-agent' ? response.headers.get('x-ratelimit-after') : null
    return {status: response.status, body, ...(retryAfterMs !== undefined ? {retryAfterMs} : {}),
      ...(mode === 'paid-agent' && retryAfter !== null ? {retryAfter} : {}), ...(rateLimitAfter !== null ? {rateLimitAfter} : {})}
  }
}

function discovery(options: BrowserTransportOptions): ServiceDiscoveryTransport {
  const send = browserTransport('discovery', options)
  return {request: async (url, opts) => (await send(url, opts)).body}
}

/**
 * Browser transport for registered paid sessions: authenticated discovery plus owner-only
 * session control, with the same route, method, bearer and bound checks as the Node transport.
 * @param options Fetch override, approved private hosts and request deadline.
 */
export function createBrowserPaidAgentTransport(options: BrowserTransportOptions = {}): PaidAgentTransport {
  const paid = browserTransport('paid-agent', options)
  return {...discovery(options), paidAgentRequest: (url, opts): Promise<PaidAgentHttpResponse> => paid(url, opts)}
}

/** Options for {@link createBrowserKeeperRecoveryTransport}. */
export interface BrowserKeeperRecoveryTransportOptions extends BrowserTransportOptions {
  /**
   * Local development fleet: also permit plain HTTP to loopback names and private IP literals
   * (and only those), like the keepers of a local chain. Default false: HTTPS only. The recovery
   * reads separately permit HTTP only on the local development chain (43112) with the paid
   * operation's `allowLocalHttp`.
   */
  allowLocalHttp?: boolean
}

/**
 * Browser transport for reading a keeper's retained paid result (the two POST recovery reads only).
 * @param options Fetch override, approved private hosts, local development HTTP and request deadline.
 */
export function createBrowserKeeperRecoveryTransport(options: BrowserKeeperRecoveryTransportOptions = {}): KeeperRecoveryTransport {
  const recovery = browserTransport('keeper-recovery', options, options.allowLocalHttp === true)
  return {keeperRecoveryRequest: (url, opts) => recovery(url, {...opts, method: 'POST'})}
}

/**
 * Browser transport for registered relayers: discovery, forward and status, with
 * `relayExchange` reporting busy refusals and their `Retry-After`.
 * @param options Fetch override, approved private hosts and request deadline.
 */
export function createBrowserRelayTransport(options: BrowserTransportOptions = {}): RelayTransport {
  const relay = browserTransport('relay', options)
  return {...discovery(options), relayRequest: async (url, opts) => (await relay(url, opts)).body,
    relayExchange: (url, opts): Promise<RelayHttpResponse> => relay(url, opts)}
}
