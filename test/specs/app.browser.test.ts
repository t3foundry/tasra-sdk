// Browser store and transports, against small in-test shims of IndexedDB and the Web Locks API
// (no fake-indexeddb dependency). The shims model what the store relies on: a version upgrade,
// read/readwrite transactions whose writes land only at commit, and exclusive named locks
// shared by every "tab" holding the same LockManager.
import {describe, expect, it, vi} from 'vitest'
import {SERVICE_MANIFEST_PATH} from '../../src/chain/serviceIdentity.js'
import {createBrowserKeeperRecoveryTransport, createBrowserPaidAgentTransport, createBrowserRelayTransport, createIndexedDbStore, StoreLockedError} from '../../src/app/browser.js'

function fakeIndexedDb(options: {abortCommits?: () => boolean} = {}) {
  const data = new Map<string, Map<string, unknown>>(), stores = new Set<string>()
  const events: string[] = []
  const factory = {
    open(name: string) {
      const req: Record<string, unknown> = {}
      queueMicrotask(() => {
        const fresh = !data.has(name)
        if (fresh) data.set(name, new Map())
        const rows = data.get(name)!
        req.result = {
          objectStoreNames: {contains: (n: string) => stores.has(n)},
          createObjectStore: (n: string) => { stores.add(n); events.push('upgrade') },
          transaction(_store: string, mode: string, opts?: {durability?: string}) {
            events.push(`tx:${mode}:${opts?.durability ?? 'default'}`)
            const staged: [string, unknown][] = []
            const tx: Record<string, unknown> = {objectStore: () => ({
              get(key: string) {
                const r: Record<string, unknown> = {}
                queueMicrotask(() => { r.result = rows.has(key) ? structuredClone(rows.get(key)) : undefined; (r.onsuccess as () => void)() })
                return r
              },
              getAllKeys() {
                const r: Record<string, unknown> = {}
                queueMicrotask(() => { r.result = [...rows.keys(), 7]; (r.onsuccess as () => void)() })
                return r
              },
              put(value: unknown, key: string) {
                staged.push([key, structuredClone(value)])
                setTimeout(() => {
                  if (options.abortCommits?.()) { tx.error = new Error('quota exceeded'); (tx.onabort as () => void)(); return }
                  for (const [k, v] of staged) rows.set(k, v)
                  events.push('commit'); (tx.oncomplete as () => void)()
                }, 1)
                return {}
              },
            })}
            return tx
          },
        }
        if (fresh) (req.onupgradeneeded as () => void)()
        ;(req.onsuccess as () => void)()
      })
      return req
    },
  }
  return {factory: factory as unknown as IDBFactory, data, events}
}

function fakeLocks() {
  const held = new Map<string, Promise<void>>()
  return {request: async (name: string, opts: {ifAvailable?: boolean}, callback: (lock: unknown) => Promise<unknown>) => {
    if (opts.ifAvailable && held.has(name)) return callback(null)
    while (held.has(name)) await held.get(name)
    let release!: () => void
    held.set(name, new Promise<void>(resolve => { release = resolve }))
    try { return await callback({name}) } finally { held.delete(name); release() }
  }} as unknown as LockManager
}

describe('createIndexedDbStore', () => {
  it('persists plain state through strict-durability commits and returns detached copies', async () => {
    const idb = fakeIndexedDb(), store = createIndexedDbStore({indexedDB: idb.factory, locks: fakeLocks()})
    const value = {phase: 'prepared', nonce: 7n, seed: new Uint8Array([1, 2]), nested: [{a: null, b: undefined}]}
    await store.save('paid-op-1', value)
    expect(idb.events).toEqual(['upgrade', 'tx:readwrite:strict', 'commit'])
    value.seed[0] = 9
    expect(await store.load('paid-op-1')).toEqual({phase: 'prepared', nonce: 7n, seed: new Uint8Array([1, 2]), nested: [{a: null, b: undefined}]})
    expect(await store.load('missing')).toBeUndefined()
  })

  it('lists keys by prefix for one-time maintenance', async () => {
    const idb = fakeIndexedDb(), store = createIndexedDbStore({indexedDB: idb.factory, locks: fakeLocks()})
    await store.save('paid-op-1', 1); await store.save('paid-op-index', 2); await store.save('prepaid-x', 3)
    expect((await store.list!('paid-op-')).sort()).toEqual(['paid-op-1', 'paid-op-index'])
  })

  it('refuses invalid keys and non-plain values before writing', async () => {
    const idb = fakeIndexedDb(), store = createIndexedDbStore({indexedDB: idb.factory, locks: fakeLocks()})
    await expect(store.save('../x', 1)).rejects.toThrow(/key/)
    for (const bad of [new Date(), new Map(), NaN, {f: () => 1}, Object.create({inherited: true}) as object]) await expect(store.save('k', bad)).rejects.toThrow(/State must/)
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic
    await expect(store.save('k', cyclic)).rejects.toThrow(/cycles/)
    expect(idb.events.filter(e => e.startsWith('tx:readwrite'))).toHaveLength(0)
  })

  it('rejects a save whose commit aborts, leaving nothing persisted', async () => {
    const idb = fakeIndexedDb({abortCommits: () => true}), store = createIndexedDbStore({indexedDB: idb.factory, locks: fakeLocks()})
    await expect(store.save('k', {phase: 'prepared'})).rejects.toThrow('quota exceeded')
    expect(await store.load('k')).toBeUndefined()
  })

  it('serializes work across tabs sharing Web Locks, or fails fast when asked', async () => {
    const idb = fakeIndexedDb(), locks = fakeLocks()
    const tabA = createIndexedDbStore({indexedDB: idb.factory, locks}), tabB = createIndexedDbStore({indexedDB: idb.factory, locks})
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const a = tabA.withLock('prepaid-payer', async () => { order.push('a'); await gate; order.push('a-end') })
    await Promise.resolve()
    const b = tabB.withLock('prepaid-payer', async () => { order.push('b') })
    const impatient = createIndexedDbStore({indexedDB: idb.factory, locks, failIfLocked: true})
    await expect(impatient.withLock('prepaid-payer', async () => 1)).rejects.toBeInstanceOf(StoreLockedError)
    release(); await Promise.all([a, b])
    expect(order).toEqual(['a', 'a-end', 'b'])
    // Different databases do not share lock names.
    const other = createIndexedDbStore({name: 'other-app', indexedDB: idb.factory, locks, failIfLocked: true})
    let held!: () => void
    const holding = tabA.withLock('k', () => new Promise<void>(resolve => { held = resolve }))
    await Promise.resolve()
    await expect(other.withLock('k', async () => 'free')).resolves.toBe('free')
    held(); await holding
  })

  it('refuses to run without durable storage or cross-tab locks', () => {
    expect(() => createIndexedDbStore({indexedDB: undefined, locks: fakeLocks()})).toThrow(/IndexedDB/)
    expect(() => createIndexedDbStore({indexedDB: fakeIndexedDb().factory, locks: {} as LockManager})).toThrow(/Web Locks/)
    expect(() => createIndexedDbStore({name: 'bad name', indexedDB: fakeIndexedDb().factory, locks: fakeLocks()})).toThrow(/name/)
  })
})

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
const session = 'ab'.repeat(32), secret = 'cd'.repeat(32)
describe('browser transports', () => {
  it('sends owner session control over HTTPS without cookies or redirects and reports Retry-After', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response('{"status":"pending"}', {status: 425, headers: {'content-type': 'application/json', 'retry-after': '2'}}))
    const transport = createBrowserPaidAgentTransport({fetch: fetch as typeof globalThis.fetch})
    const reply = await transport.paidAgentRequest(`https://agent.example/v1/sessions/${session}`, {method: 'GET', bearer: secret, maxBytes: 1024, signal: new AbortController().signal})
    expect(reply).toMatchObject({status: 425, retryAfterMs: 2000})
    const init = fetch.mock.calls[0]![1]
    expect(init).toMatchObject({method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer'})
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${secret}`)
  })

  it('applies the shared route policy before any request', async () => {
    const fetch = vi.fn()
    const transport = createBrowserPaidAgentTransport({fetch: fetch as typeof globalThis.fetch})
    const signal = new AbortController().signal
    await expect(transport.paidAgentRequest('https://agent.example/v1/sign', {method: 'POST', maxBytes: 10, signal})).rejects.toThrow(/path/)
    await expect(transport.paidAgentRequest(`https://agent.example/v1/sessions/${session}`, {method: 'GET', maxBytes: 10, signal})).rejects.toThrow(/bearer/)
    await expect(transport.paidAgentRequest(`http://agent.example/v1/sessions/${session}`, {method: 'GET', bearer: secret, maxBytes: 10, signal})).rejects.toThrow(/HTTPS/)
    await expect(transport.paidAgentRequest(`https://10.0.0.5/v1/sessions/${session}`, {method: 'GET', bearer: secret, maxBytes: 10, signal})).rejects.toThrow(/refuses address/)
    await expect(transport.paidAgentRequest(`https://localhost:8443/v1/sessions/${session}`, {method: 'GET', bearer: secret, maxBytes: 10, signal})).rejects.toThrow(/refuses address/)
    expect(fetch).not.toHaveBeenCalled()
    const allowed = createBrowserPaidAgentTransport({fetch: (async () => new Response(null, {status: 204})) as typeof globalThis.fetch, allowedPrivateHosts: ['localhost']})
    await expect(allowed.paidAgentRequest(`https://localhost:8443/v1/sessions/${session}/execution/${session}/reject`, {method: 'POST', bearer: secret, maxBytes: 10, signal})).resolves.toMatchObject({status: 204})
  })

  it('refuses unexpected media types, oversized and non-empty no-content replies', async () => {
    const signal = new AbortController().signal, url = `https://agent.example/v1/sessions/${session}`
    const with_ = (response: Response) => createBrowserPaidAgentTransport({fetch: (async () => response) as typeof globalThis.fetch})
    await expect(with_(new Response('<html>', {status: 200, headers: {'content-type': 'text/html'}})).paidAgentRequest(url, {method: 'GET', bearer: secret, maxBytes: 100, signal})).rejects.toThrow(/content type/)
    await expect(with_(new Response('x'.repeat(200), {status: 200, headers: {'content-type': 'application/json'}})).paidAgentRequest(url, {method: 'GET', bearer: secret, maxBytes: 100, signal})).rejects.toThrow(/too large/)
    await expect(with_(new Response('{}', {status: 200, headers: {'content-type': 'application/json', 'content-length': '500'}})).paidAgentRequest(url, {method: 'GET', bearer: secret, maxBytes: 100, signal})).rejects.toThrow(/too large/)
    await expect(with_(new Response('{}', {status: 302, headers: {'content-type': 'application/json'}})).paidAgentRequest(url, {method: 'GET', bearer: secret, maxBytes: 100, signal})).rejects.toThrow(/status/)
  })

  it('authenticates discovery through the same transport and reads keeper results with POST only', async () => {
    const fetch = vi.fn(async () => new Response('{}', {status: 200, headers: {'content-type': 'application/json'}}))
    const paid = createBrowserPaidAgentTransport({fetch: fetch as unknown as typeof globalThis.fetch})
    expect(new TextDecoder().decode(await paid.request('https://agent.example' + SERVICE_MANIFEST_PATH, {maxBytes: 100, signal: new AbortController().signal}))).toBe('{}')
    await expect(paid.request('https://agent.example/v1/x?redirect=1', {maxBytes: 100, signal: new AbortController().signal})).rejects.toThrow(/canonical/)
    const recovery = createBrowserKeeperRecoveryTransport({fetch: fetch as unknown as typeof globalThis.fetch})
    const result = await recovery.keeperRecoveryRequest('https://keeper.example/v1/prepaid/execution', {body: bytes({}), maxBytes: 100, signal: new AbortController().signal})
    expect(result.status).toBe(200)
    await expect(recovery.keeperRecoveryRequest('https://keeper.example/v1/sign', {body: bytes({}), maxBytes: 100, signal: new AbortController().signal})).rejects.toThrow(/path/)
  })

  it('reads local development keepers over HTTP only when allowed, and only on loopback or private hosts', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response('{}', {status: 200, headers: {'content-type': 'application/json'}}))
    const args = () => ({body: bytes({}), maxBytes: 100, signal: new AbortController().signal})
    const strict = createBrowserKeeperRecoveryTransport({fetch: fetch as unknown as typeof globalThis.fetch})
    await expect(strict.keeperRecoveryRequest('http://localhost:4001/v1/prepaid/execution', args())).rejects.toThrow(/HTTPS/)
    const local = createBrowserKeeperRecoveryTransport({fetch: fetch as unknown as typeof globalThis.fetch, allowLocalHttp: true})
    for (const url of ['http://localhost:4001/v1/prepaid/execution', 'http://127.0.0.1:4001/v1/prepaid/execution/recover', 'http://192.168.1.9:4001/v1/prepaid/execution', 'http://[::1]:4001/v1/prepaid/execution']) {
      expect((await local.keeperRecoveryRequest(url, args())).status).toBe(200)
    }
    expect(fetch.mock.calls[0]![0]).toBe('http://localhost:4001/v1/prepaid/execution')
    expect(fetch.mock.calls[0]![1]).toMatchObject({method: 'POST', redirect: 'error', credentials: 'omit'})
    await expect(local.keeperRecoveryRequest('http://keeper.example/v1/prepaid/execution', args())).rejects.toThrow(/HTTPS/)
    await expect(local.keeperRecoveryRequest('http://localhost:4001/v1/sign', args())).rejects.toThrow(/path/)
    // HTTPS to a private host still needs explicit approval.
    await expect(local.keeperRecoveryRequest('https://localhost:4001/v1/prepaid/execution', args())).rejects.toThrow(/refuses address/)
    expect(fetch).toHaveBeenCalledTimes(4)
  })

  it('exposes relayer busy refusals with their Retry-After', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({id: '', state: 'rejected', reason: 'relayer busy: the request journal is full; retry shortly or submit directly'}),
      {status: 422, headers: {'content-type': 'application/json', 'retry-after': '1'}}))
    const relay = createBrowserRelayTransport({fetch: fetch as unknown as typeof globalThis.fetch})
    const reply = await relay.relayExchange!('https://relay.example/v1/relay/forward', {body: bytes({}), maxBytes: 4096, signal: new AbortController().signal})
    expect(reply).toMatchObject({status: 422, retryAfterMs: 1000})
    expect(await relay.relayRequest('https://relay.example/v1/relay/forward', {body: bytes({}), maxBytes: 4096, signal: new AbortController().signal})).toBeInstanceOf(Uint8Array)
  })
})
