import {afterEach, describe, expect, it, vi} from 'vitest'
import {constants} from 'node:fs'

// Record every durable step in order, passing the real calls through.
const events: string[] = []
const failSync = {next: false}
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
    rename: async (from: string, to: string) => { events.push(`rename:${name(to)}`); return real.rename(from, to) },
  }
})

const {createFileStore, fileStoreSyncCounters} = await import('../../src/app/node.js')
const {mkdtemp, rm, readFile} = await import('node:fs/promises')
const {tmpdir} = await import('node:os')
const {join} = await import('node:path')
const roots: string[] = []
async function directory() { const dir = await mkdtemp(join(tmpdir(), 'tasra-commit-')); roots.push(dir); return dir }
afterEach(async () => { events.length = 0; failSync.next = false; gate.hold = undefined; await Promise.all(roots.splice(0).map(dir => rm(dir, {recursive: true, force: true}))) })
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
    // Old store: 32 file flushes and 32 directory syncs. Grouped: one of each per wave.
    expect(barriers).toBeLessThanOrEqual(3)
    expect(directorySyncs).toBeLessThanOrEqual(3)
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
    const grouped = [store.save('a', {v: 'new'}), store.save('b', {v: 'new'})]
    await new Promise(done => setTimeout(done, 20))
    failSync.next = true
    release()
    await first
    const results = await Promise.allSettled(grouped)
    expect(results.map(r => r.status)).toEqual(['rejected', 'rejected'])
    expect(events.filter(e => e === 'rename:a.json' || e === 'rename:b.json')).toEqual([])
    expect(await readFile(join(dir, 'a.json'), 'utf8')).toBe(old)
    expect(await store.load('b')).toBeUndefined()
    // The next group is unaffected.
    await store.save('b', {v: 'later'})
    expect(await store.load('b')).toEqual({v: 'later'})
  })

  it('a lock file is flushed and its entry synced before the guarded action runs; a claim before it is reported won', async () => {
    const store = createFileStore(await directory())
    await store.withLock('lane', async () => { events.push('action') })
    expect(events.slice(0, 4)).toEqual(['open:lane.lock:dsync', 'sync:lane.lock', 'dirsync', 'action'])
    events.length = 0
    expect(await store.claim!('send-1')).toBe(true)
    expect(events).toEqual(['open:send-1.json:dsync', 'sync:send-1.json', 'dirsync'])
    expect(await store.claim!('send-1')).toBe(false)
  })
})
