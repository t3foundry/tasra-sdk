import {afterAll, describe, expect, it, vi} from 'vitest'
import {constants} from 'node:fs'

// Deterministic replay of the race: right after `load` opens a value, the next save's rename lands
// on top of it (the opened inode is left with nlink 0). `replaceAfterOpen` runs that rename.
const inject: {replaceAfterOpen: number; replacement?: () => Promise<void>} = {replaceAfterOpen: 0}
vi.mock('node:fs/promises', async original => {
  const real = await original<typeof import('node:fs/promises')>()
  return {
    ...real,
    open: async (path: string, flags: number, mode?: number) => {
      const handle = await real.open(path, flags, mode)
      if (flags === (constants.O_RDONLY | constants.O_NOFOLLOW) && String(path).endsWith('.json') && inject.replaceAfterOpen > 0) {
        inject.replaceAfterOpen--
        await inject.replacement!()
      }
      return handle
    },
  }
})

const {mkdtemp, rm, link, chmod, writeFile, rename} = await import('node:fs/promises')
const {tmpdir} = await import('node:os')
const {join} = await import('node:path')
const {createFileStore} = await import('../../src/app/node.js')

const dirs: string[] = []
const fresh = async () => { const dir = await mkdtemp(join(tmpdir(), 'tasra-store-replaced-')); dirs.push(dir); return dir }
afterAll(async () => { for (const dir of dirs) await rm(dir, {recursive: true, force: true}) })

describe('file store load of a value replaced while it is being opened', () => {
  it('reads the value that replaced it instead of refusing the superseded inode', async () => {
    const dir = await fresh(), store = createFileStore(dir), helper = createFileStore(dir)
    await store.save('k', {n: 1})
    inject.replacement = () => helper.save('k', {n: 2})
    inject.replaceAfterOpen = 1
    expect(await store.load('k')).toEqual({n: 2})
    expect(inject.replaceAfterOpen).toBe(0)
  })

  it('after a bounded number of replacements in a row, reads the superseded value it opened instead of failing', async () => {
    // Writer contention must never turn into a load failure (release cert 44454169835: all 64
    // retries lost on EC2). The 65th open's inode is replaced too; the value it held ({n: 64}) was
    // the value at the path when it was opened, so returning it is a read ordered before that save.
    const dir = await fresh(), store = createFileStore(dir), helper = createFileStore(dir)
    await store.save('k', {n: 0})
    let n = 0
    inject.replacement = () => helper.save('k', {n: ++n})
    inject.replaceAfterOpen = 1000
    expect(await store.load('k')).toEqual({n: 64})
    inject.replaceAfterOpen = 0
    expect(n).toBe(65)
    expect(await store.load('k')).toEqual({n: 65})
  })

  it('a superseded value read after the bounded retries must still be a private file of ours', async () => {
    const dir = await fresh(), store = createFileStore(dir), helper = createFileStore(dir)
    await store.save('k', {n: 0})
    let n = 0
    // Each replacement first opens the CURRENT value to the group, then renames a private one
    // over it: every superseded inode the load holds is group-readable.
    inject.replacement = async () => { await chmod(join(dir, 'k.json'), 0o640); await helper.save('k', {n: ++n}) }
    inject.replaceAfterOpen = 1000
    await expect(store.load('k')).rejects.toThrow('State file must be a private regular file')
    inject.replaceAfterOpen = 0
    expect(n).toBe(65)
  })

  it('never accepts a replacement that is not a private, singly linked regular file', async () => {
    const dir = await fresh(), store = createFileStore(dir)
    await store.save('k', {n: 1})
    // Replaced by a group/world-readable file.
    inject.replacement = async () => { await writeFile(join(dir, 'staged'), JSON.stringify({schemaVersion: 1, value: ['null']}), {mode: 0o600}); await chmod(join(dir, 'staged'), 0o644); await rename(join(dir, 'staged'), join(dir, 'k.json')) }
    inject.replaceAfterOpen = 1
    await expect(store.load('k')).rejects.toThrow('State file must be a private regular file')
    // Replaced by a hard-linked file.
    await store.save('h', {n: 1})
    inject.replacement = async () => { await store.save('other', {n: 9}); await link(join(dir, 'other.json'), join(dir, 'alias')); await rename(join(dir, 'alias'), join(dir, 'h.json')) }
    inject.replaceAfterOpen = 1
    await expect(store.load('h')).rejects.toThrow('State file must be a private regular file')
    // A file that is wrong from the start is refused at once.
    await store.save('m', {n: 1})
    await chmod(join(dir, 'm.json'), 0o640)
    await expect(store.load('m')).rejects.toThrow('State file must be a private regular file')
  })
})
