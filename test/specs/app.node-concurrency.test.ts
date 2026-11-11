// One durable commit's independent file-system calls run concurrently (C20): the temporaries it
// stages and the locks it removes. Under concurrent device flushes (macOS F_FULLFSYNC) every
// metadata call and O_DSYNC write waits its turn, so issuing them one after another cost a
// 3-lock/7-file paid approval commit ~90 ms of staging on the 32-stream bench. The ordered steps
// stay ordered: renames (a failed one publishes nothing more), and lock acquisition (sorted).
import {afterEach, expect, it, vi} from 'vitest'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

const delayMs = 15
const track = {open: {now: 0, max: 0}, unlink: {now: 0, max: 0}, rename: {now: 0, max: 0}, lstat: 0, on: false}
const measured = async <T>(kind: 'open' | 'unlink' | 'rename', work: () => Promise<T>): Promise<T> => {
  const t = track[kind]; t.now++; t.max = Math.max(t.max, t.now)
  try { await new Promise(done => setTimeout(done, delayMs)); return await work() } finally { t.now-- }
}
vi.mock('node:fs/promises', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {...real,
    open: (async (path: string, ...rest: unknown[]) => track.on && String(path).endsWith('.tmp')
      ? measured('open', () => (real.open as (...a: unknown[]) => Promise<unknown>)(path, ...rest)) : (real.open as (...a: unknown[]) => Promise<unknown>)(path, ...rest)) as typeof real.open,
    unlink: (async (path: string) => track.on && String(path).endsWith('.lock') ? measured('unlink', () => real.unlink(path)) : real.unlink(path)) as typeof real.unlink,
    rename: (async (from: string, to: string) => track.on ? measured('rename', () => real.rename(from, to)) : real.rename(from, to)) as typeof real.rename,
    lstat: (async (...args: Parameters<typeof real.lstat>) => { if (track.on) track.lstat++; return real.lstat(...args) }) as typeof real.lstat}
})
const {mkdtemp, rm} = await import('node:fs/promises')
const {createFileStore} = await import('../../src/app/node.js')
const {saveAll, withCommit} = await import('../../src/app/store-commit.js')

const roots: string[] = []
afterEach(async () => { track.on = false; await Promise.all(roots.splice(0).map(dir => rm(dir, {recursive: true, force: true}))) })
const reset = () => { for (const k of ['open', 'unlink', 'rename'] as const) track[k] = {now: 0, max: 0}; track.lstat = 0; track.on = true }

it('stages every temporary of one commit concurrently, and still renames them in order', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tasra-concurrency-')); roots.push(dir)
  const store = createFileStore(dir)
  await store.save('warm', 0)
  reset()
  const entries = Array.from({length: 6}, (_, i) => [`k${i}`, {i}] as const)
  await saveAll(store, entries)
  expect(track.open.max).toBe(6)
  expect(track.rename.max).toBe(1)
  for (const [key, value] of entries) expect(await store.load(key)).toEqual(value)
})

it('removes every lock of a commit concurrently, takes them one by one, and checks the directory once per lock set', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tasra-concurrency-')); roots.push(dir)
  const store = createFileStore(dir)
  await store.save('warm', 0)
  reset()
  await withCommit(store, ['a', 'b', 'c'], async commit => { commit.stage('a', 1); commit.stage('b', 2); commit.stage('c', 3) })
  expect(track.unlink.max).toBe(3)
  // One check for the three locks and one for the staged files (each a single lstat).
  expect(track.lstat).toBe(2)
  expect([await store.load('a'), await store.load('b'), await store.load('c')]).toEqual([1, 2, 3])
})
