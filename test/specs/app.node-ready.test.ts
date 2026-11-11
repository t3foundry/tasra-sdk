// The file store checks its directory before every operation with ONE metadata call when the
// directory exists: a recursive mkdir of an existing directory is two more, and under concurrent
// device flushes (macOS F_FULLFSYNC) each metadata call waits behind them (C20: p90 10 ms).
import {afterEach, expect, it, vi} from 'vitest'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

const counts = {mkdir: 0, lstat: 0}
vi.mock('node:fs/promises', async importOriginal => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return {...real,
    mkdir: (async (...args: Parameters<typeof real.mkdir>) => { counts.mkdir++; return real.mkdir(...args) }) as typeof real.mkdir,
    lstat: (async (...args: Parameters<typeof real.lstat>) => { counts.lstat++; return real.lstat(...args) }) as typeof real.lstat}
})
const {mkdtemp, rm, chmod} = await import('node:fs/promises')
const {createFileStore} = await import('../../src/app/node.js')

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(dir => rm(dir, {recursive: true, force: true}))) })

it('an existing state directory is checked with one lstat per operation and never re-created', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'tasra-ready-')); roots.push(parent)
  const dir = join(parent, 'state'), store = createFileStore(dir)
  await store.save('k', {n: 0})
  expect(counts.mkdir).toBe(1)
  const before = {...counts}
  for (let n = 1; n <= 10; n++) { await store.save('k', {n}); expect(await store.load('k')).toEqual({n}) }
  await store.withLock('k', async () => {})
  expect(counts.mkdir - before.mkdir).toBe(0)
  // save + load + the lock: one check each (a save checks once), each a single lstat.
  expect(counts.lstat - before.lstat).toBeLessThanOrEqual(10 * 2 + 1)
  // The check itself still runs every time: a directory that stopped being private is refused.
  await chmod(dir, 0o755)
  await expect(store.load('k')).rejects.toThrow('0700')
  await chmod(dir, 0o700)
  // A missing directory is still created (private) before use.
  await rm(dir, {recursive: true})
  await store.save('k', {n: 11})
  expect(counts.mkdir - before.mkdir).toBe(1)
  expect(await store.load('k')).toEqual({n: 11})
})
