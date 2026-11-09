import {afterAll, afterEach, describe, expect, it, vi} from 'vitest'
import {constants} from 'node:fs'

// Record every durable step in order, passing the real calls through.
const events: string[] = []
const failSync = {next: false}
const failRename = {next: false}
const gate: {hold?: Promise<void>} = {}
vi.mock('node:fs/promises', async original => {
  const real = await original<typeof import('node:fs/promises')>()
  const name = (path: unknown) => String(path).split('/').pop()!.replace(/^\.[0-9a-f-]+\.tmp$/, 'tmp')
  return {
    ...real,
    open: async (path: string, flags: number, mode?: number) => {
      const handle = await real.open(path, flags, mode)
      const label = name(path)
      if (typeof flags === 'number' && (flags & constants.O_WRONLY)) events.push(`open:${label}:${(flags & ((constants as {O_DSYNC?: number}).O_DSYNC ?? 0)) ? 'dsync' : 'plain'}`)
      const sync = handle.sync.bind(handle)
      handle.sync = async () => {
        // Decided when the flush is issued, so a held flush never takes the failure meant for a later one.
        const fail = failSync.next && !(flags & constants.O_DIRECTORY)
        if (fail) failSync.next = false
        if (gate.hold && !(flags & constants.O_DIRECTORY)) { const hold = gate.hold; gate.hold = undefined; await hold }
        if (fail) throw Object.assign(new Error('injected flush failure'), {code: 'EIO'})
        events.push(flags & constants.O_DIRECTORY ? 'dirsync' : `sync:${label}`)
        return sync()
      }
      return handle
    },
    rename: async (from: string, to: string) => {
      if (failRename.next) { failRename.next = false; throw Object.assign(new Error('injected rename failure'), {code: 'EIO'}) }
      events.push(`rename:${name(to)}`); return real.rename(from, to)
    },
    // Lock removals are durable steps too (temporaries are not traced).
    unlink: async (path: string) => { if (String(path).endsWith(".lock")) events.push(`unlink:${name(path)}`); return real.unlink(path) },
  }
})

const {createFileStore, fileStoreSyncCounters} = await import('../../src/app/node.js')
const {Rederivable, saveAll, saveRederivable, withCommit} = await import('../../src/app/store-commit.js')
const {createMemoryStore} = await import('../../src/app/memory-store.js')
const {mkdtemp, rm, readFile, readdir} = await import('node:fs/promises')
const {tmpdir} = await import('node:os')
const {join} = await import('node:path')
const roots: string[] = []
async function directory() { const dir = await mkdtemp(join(tmpdir(), 'tasra-commit-')); roots.push(dir); return dir }
// A failed group flush must reject every waiter through the promise it awaits; nothing may float.
const unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
process.on('unhandledRejection', onUnhandled)
afterAll(() => { process.off('unhandledRejection', onUnhandled) })
afterEach(async () => {
  await new Promise(done => setTimeout(done, 50))
  const floated = unhandled.splice(0).map(reason => String((reason as Error)?.message ?? reason))
  events.length = 0; failSync.next = false; failRename.next = false; gate.hold = undefined
  await Promise.all(roots.splice(0).map(dir => rm(dir, {recursive: true, force: true})))
  expect(floated, 'unhandled rejections').toEqual([])
})
const DSYNC = (constants as {O_DSYNC?: number}).O_DSYNC ?? 0

describe.skipIf(DSYNC === 0)('file store group commit', () => {
  it('flushes a save to stable storage before the rename publishes it, and acknowledges only after the directory sync', async () => {
    const store = createFileStore(await directory())
    let acknowledged = -1
    await store.save('intent', {n: 1}).then(() => { acknowledged = events.length })
    expect(events).toEqual(['open:tmp:dsync', 'sync:tmp', 'rename:intent.json', 'dirsync'])
    expect(acknowledged).toBe(events.length)
  })

  it('shares one device flush and one directory sync among concurrent writers, each still ordered before its own rename', async () => {
    const store = createFileStore(await directory())
    const before = {...fileStoreSyncCounters}
    await Promise.all(Array.from({length: 32}, (_, i) => store.save(`key-${i}`, {i})))
    const barriers = fileStoreSyncCounters.barriers - before.barriers, directorySyncs = fileStoreSyncCounters.directorySyncs - before.directorySyncs
    // Old store: 32 file flushes and 32 directory syncs. Grouped: a few waves, however the arrivals spread under disk load.
    expect(barriers).toBeLessThanOrEqual(8)
    expect(directorySyncs).toBeLessThanOrEqual(8)
    expect(events.filter(e => e === 'sync:tmp').length).toBe(barriers)
    expect(events.filter(e => e === 'dirsync').length).toBe(directorySyncs)
    expect(barriers).toBeGreaterThan(0)
    // Every rename comes after the first flush, and the last directory sync after every rename.
    const firstFlush = events.indexOf('sync:tmp'), renames = events.flatMap((e, i) => e.startsWith('rename:') ? [i] : [])
    expect(renames).toHaveLength(32)
    expect(Math.min(...renames)).toBeGreaterThan(firstFlush)
    expect(events.lastIndexOf('dirsync')).toBeGreaterThan(Math.max(...renames))
    for (let i = 0; i < 32; i++) expect(await store.load(`key-${i}`)).toEqual({i})
  })

  it('a failed flush rejects every writer of that group, publishes none of them and keeps the prior bytes', async () => {
    const dir = await directory(), store = createFileStore(dir)
    await store.save('a', {v: 'old'})
    const old = await readFile(join(dir, 'a.json'), 'utf8')
    // Hold the first group's flush, so the next two writers are certain to share the following group.
    let release!: () => void
    gate.hold = new Promise<void>(done => { release = done })
    events.length = 0
    const first = store.save('c', {v: 'first'})
    while (!events.includes('open:tmp:dsync')) await new Promise(done => setTimeout(done, 1))
    // Observed at once: the group may fail while this test is still awaiting `first`.
    const grouped = Promise.allSettled([store.save('a', {v: 'new'}), store.save('b', {v: 'new'})])
    await new Promise(done => setTimeout(done, 20))
    failSync.next = true
    release()
    await first
    const results = await grouped
    expect(results.map(r => r.status)).toEqual(['rejected', 'rejected'])
    expect(events.filter(e => e === 'rename:a.json' || e === 'rename:b.json')).toEqual([])
    expect(await readFile(join(dir, 'a.json'), 'utf8')).toBe(old)
    expect(await store.load('b')).toBeUndefined()
    // The next group is unaffected.
    await store.save('b', {v: 'later'})
    expect(await store.load('b')).toEqual({v: 'later'})
  })

  it('a lock entry is synced before the guarded action runs, without a flush of its own diagnostic content; a claim before it is reported won', async () => {
    const store = createFileStore(await directory())
    await store.withLock('lane', async () => { events.push('action') })
    // Nothing reads the lock's content (pid, time). Written O_DSYNC, it is on the device once the
    // directory's own flush returns, so only the entry needs that flush.
    expect(events).toEqual(['open:lane.lock:dsync', 'dirsync', 'action', 'unlink:lane.lock', 'dirsync'])
    events.length = 0
    expect(await store.claim!('send-1')).toBe(true)
    expect(events).toEqual(['open:send-1.json:dsync', 'sync:send-1.json', 'dirsync'])
    expect(await store.claim!('send-1')).toBe(false)
  })
})

describe.skipIf(DSYNC === 0)('file store commit steps (internal)', () => {
  it('withCommit: an unflushed lock, then the staged values published with the unlock in ONE barrier and ONE directory sync', async () => {
    const dir = await directory(), store = createFileStore(dir)
    let acknowledged = -1
    await withCommit(store, 'record', async commit => {
      events.push('action')
      commit.stage('record', {phase: 'old'})
      commit.stage('index', {ids: [1]})
      commit.stage('record', {phase: 'new'})
    }).then(() => { acknowledged = events.length })
    // The lock entry is exclusive at once but costs no flush; the two values share one data
    // barrier, both renames and the lock removal share one directory sync, and the caller is
    // acknowledged only after it.
    expect(events).toEqual(['open:record.lock:plain', 'action', 'open:tmp:dsync', 'open:tmp:dsync', 'sync:tmp',
      'rename:index.json', 'rename:record.json', 'unlink:record.lock', 'dirsync'])
    expect(acknowledged).toBe(events.length)
    expect(await store.load('record')).toEqual({phase: 'new'})
    expect(await store.load('index')).toEqual({ids: [1]})
    expect((await readdir(dir)).sort()).toEqual(['index.json', 'record.json'])
  })

  it('withCommit: the first durable save inside the action syncs the directory after the lock entry, so the lock is durable before anything it guards is sent', async () => {
    const store = createFileStore(await directory())
    await withCommit(store, 'attempt', async commit => {
      await store.save('attempt', {phase: 'prepared'})
      events.push('send')
      commit.stage('attempt', {phase: 'confirmed'})
    })
    expect(events).toEqual(['open:attempt.lock:plain', 'open:tmp:dsync', 'sync:tmp', 'rename:attempt.json', 'dirsync', 'send',
      'open:tmp:dsync', 'sync:tmp', 'rename:attempt.json', 'unlink:attempt.lock', 'dirsync'])
  })

  it('withCommit: a failed action publishes nothing it staged and still removes its lock durably; with nothing staged the unlock is synced alone', async () => {
    const dir = await directory(), store = createFileStore(dir)
    await store.save('record', {phase: 'old'})
    events.length = 0
    await expect(withCommit(store, 'record', async commit => { commit.stage('record', {phase: 'new'}); throw new Error('refused') })).rejects.toThrow('refused')
    expect(events).toEqual(['open:record.lock:plain', 'unlink:record.lock', 'dirsync'])
    expect(await store.load('record')).toEqual({phase: 'old'})
    events.length = 0
    expect(await withCommit(store, 'record', async () => 7)).toBe(7)
    expect(events).toEqual(['open:record.lock:plain', 'unlink:record.lock', 'dirsync'])
    // An invalid staged value or key refuses at the stage, before anything is written.
    await expect(withCommit(store, 'record', async commit => { commit.stage('record', {bad: Infinity}) })).rejects.toThrow()
    await expect(withCommit(store, 'record', async commit => { commit.stage('../escape', {}) })).rejects.toThrow('Invalid state key')
    expect(await store.load('record')).toEqual({phase: 'old'})
    expect(await readdir(dir)).toEqual(['record.json'])
  })

  it('withCommit: a failed data flush publishes no staged value and keeps the prior bytes; the lock is still removed', async () => {
    const dir = await directory(), store = createFileStore(dir)
    await store.save('record', {phase: 'old'})
    failSync.next = true
    await expect(withCommit(store, 'record', async commit => { commit.stage('record', {phase: 'new'}); commit.stage('index', {ids: [1]}) })).rejects.toThrow('injected')
    expect(await store.load('record')).toEqual({phase: 'old'})
    expect(await store.load('index')).toBeUndefined()
    expect(await readdir(dir)).toEqual(['record.json'])
  })

  it('withCommit: exclusive across store objects and processes like withLock, and refuses a nested lock on a held key', async () => {
    const dir = await directory(), a = createFileStore(dir), b = createFileStore(dir, {lockWaitMs: 0})
    await withCommit(a, 'lane', async () => {
      // Another process sees the same lock file and refuses after its bounded wait.
      await expect(b.withLock('lane', async () => 1)).rejects.toThrow('reconcile')
      await expect(withCommit(a, 'lane', async () => 1)).rejects.toThrow('reconcile')
    })
    // Callers in one process queue in call order, never inside together.
    let inside = 0, most = 0
    await Promise.all(Array.from({length: 16}, (_, i) => withCommit(i % 2 ? a : b, 'counter', async commit => {
      inside++; most = Math.max(most, inside)
      const n = (await a.load<number>('counter')) ?? 0
      await new Promise(done => setTimeout(done, 1))
      commit.stage('counter', n + 1); inside--
    })))
    expect(most).toBe(1)
    expect(await a.load('counter')).toBe(16)
  })

  it('saveAll: every value flushed by one barrier before any rename, one directory sync after the last', async () => {
    const store = createFileStore(await directory())
    await saveAll(store, [['record', {n: 1}], ['ledger', {n: 2}]])
    expect(events).toEqual(['open:tmp:dsync', 'open:tmp:dsync', 'sync:tmp', 'rename:record.json', 'rename:ledger.json', 'dirsync'])
    expect([await store.load('record'), await store.load('ledger')]).toEqual([{n: 1}, {n: 2}])
  })

  it('saveRederivable: flushed before it is renamed into place (never torn), with no directory sync of its own', async () => {
    const store = createFileStore(await directory())
    await saveRederivable(store, 'confirm', {phase: 'confirmed'})
    expect(events).toEqual(['open:tmp:dsync', 'sync:tmp', 'rename:confirm.json'])
    expect(await store.load('confirm')).toEqual({phase: 'confirmed'})
  })

  it('withCommit on several keys: every lock taken (sorted, so opposite orders never deadlock), one commit, every lock removed with it', async () => {
    const dir = await directory(), store = createFileStore(dir), other = createFileStore(dir, {lockWaitMs: 0})
    await withCommit(store, ['lane', 'journal'], async commit => {
      await expect(other.withLock('lane', async () => 1)).rejects.toThrow('reconcile')
      await expect(other.withLock('journal', async () => 1)).rejects.toThrow('reconcile')
      // A key this chain holds cannot be locked again inside it.
      await expect(withCommit(store, ['journal', 'other'], async () => 1)).rejects.toThrow('reconcile')
      commit.stage('lane', {seq: 1}); commit.stage('journal', {phase: 'reserved'})
    })
    expect(events).toEqual(['open:journal.lock:plain', 'open:lane.lock:plain', 'open:tmp:dsync', 'open:tmp:dsync', 'sync:tmp',
      'rename:lane.json', 'rename:journal.json', 'unlink:journal.lock', 'unlink:lane.lock', 'dirsync'])
    expect((await readdir(dir)).sort()).toEqual(['journal.json', 'lane.json'])
    // Opposite orders from concurrent callers: both complete, one after the other.
    let inside = 0, most = 0
    const run = (keys: string[]) => withCommit(store, keys, async commit => {
      inside++; most = Math.max(most, inside); await new Promise(done => setTimeout(done, 2)); inside--
      commit.stage(keys[0]!, {by: keys.join()})
    })
    await Promise.all([run(['a', 'b']), run(['b', 'a']), run(['a', 'b']), run(['b', 'a'])])
    expect(most).toBe(1)
    expect((await readdir(dir)).filter(n => n.endsWith('.lock'))).toEqual([])
  })

  it('withCommit on several keys: a lock another process holds refuses after the wait and releases the ones already taken', async () => {
    const dir = await directory(), store = createFileStore(dir, {lockWaitMs: 0})
    await store.withLock('b', async () => {
      await expect(withCommit(createFileStore(dir, {lockWaitMs: 0}), ['a', 'b'], async () => 1)).rejects.toThrow('reconcile')
      expect((await readdir(dir)).sort()).toEqual(['b.lock'])
    })
    expect(await withCommit(store, ['a', 'b'], async () => 2)).toBe(2)
  })

  it('Rederivable: put replaces per key, take empties, restore never overwrites a newer put, flush writes each one without a directory sync', async () => {
    const store = createFileStore(await directory()), later = new Rederivable()
    later.put('a', {n: 1}); later.put('b', {n: 2}); later.put('a', {n: 3})
    const taken = later.take()
    expect(taken).toEqual([['b', {n: 2}], ['a', {n: 3}]])
    expect(later.take()).toEqual([])
    later.put('a', {n: 4})
    later.restore(taken)
    expect(later.take().sort()).toEqual([['a', {n: 4}], ['b', {n: 2}]].sort())
    later.put('c', {n: 5})
    events.length = 0
    await later.flush(store)
    expect(events).toEqual(['open:tmp:dsync', 'sync:tmp', 'rename:c.json'])
    expect(await store.load('c')).toEqual({n: 5})
  })

  it('a failed rename publishes nothing more, leaves no temporary behind and keeps the prior bytes', async () => {
    const dir = await directory(), store = createFileStore(dir)
    await store.save('a', {v: 'old'})
    failRename.next = true
    await expect(saveAll(store, [['a', {v: 'new'}], ['b', {v: 'new'}]])).rejects.toThrow('injected rename')
    expect(await store.load('a')).toEqual({v: 'old'})
    expect(await store.load('b')).toBeUndefined()
    expect((await readdir(dir)).sort()).toEqual(['a.json'])
  })

  it('Rederivable: a failed flush gives every entry back for a later commit', async () => {
    const inner = createMemoryStore(), later = new Rederivable()
    let fail = true
    const store = {...inner, load: inner.load.bind(inner), withLock: inner.withLock.bind(inner),
      save: async (key: string, value: unknown) => { if (fail) throw new Error('disk full'); return inner.save(key, value) }}
    later.put('a', 1)
    await expect(later.flush(store)).rejects.toThrow('disk full')
    fail = false
    await later.flush(store)
    expect(await inner.load('a')).toBe(1)
  })

  it('stores without native steps get the same calls as before: withLock, then each staged save in order', async () => {
    const inner = createMemoryStore(), calls: string[] = []
    const store = {load: inner.load.bind(inner), withLock: async <T>(key: string, action: () => Promise<T>) => { calls.push(`lock:${key}`); try { return await action() } finally { calls.push(`unlock:${key}`) } },
      save: async (key: string, value: unknown) => { calls.push(`save:${key}`); return inner.save(key, value) }}
    await withCommit(store, 'k', async commit => { commit.stage('b', 2); commit.stage('a', 1) })
    await saveAll(store, [['c', 3], ['d', 4]])
    await saveRederivable(store, 'e', 5)
    expect(calls).toEqual(['lock:k', 'save:b', 'save:a', 'unlock:k', 'save:c', 'save:d', 'save:e'])
    await expect(withCommit(store, 'k', async commit => { commit.stage('a', 9); throw new Error('refused') })).rejects.toThrow('refused')
    expect(await store.load('a')).toBe(1)
  })
})
