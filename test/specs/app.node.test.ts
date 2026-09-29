import {afterEach, describe, expect, it} from 'vitest'
import {mkdtemp, rm, stat, readdir, symlink, readFile, chmod} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createFileStore, StoreLockedError} from '../../src/app/node.js'
const roots: string[] = []
async function directory() { const dir = await mkdtemp(join(tmpdir(), 'tasra-store-')); roots.push(dir); return dir }
afterEach(async () => { await Promise.all(roots.splice(0).map(dir => rm(dir, {recursive: true, force: true}))) })
describe('private application file store', () => {
  it('durably round trips nested bigint, byte arrays and reserved-looking keys without collisions', async () => {
    const dir = await directory(), store = createFileStore(dir)
    const original = {commit: {amount: 42n, hash: undefined}, bytes: new Uint8Array([0, 255]), list: [null, true, -2.3], value: {type: 'bigint', value: '123'}, __proto__: null}
    await store.save('creation', original)
    expect(await store.load('creation')).toEqual(original)
    expect((await stat(join(dir, 'creation.json'))).mode & 0o777).toBe(0o600)
    expect(await readdir(dir)).toEqual(['creation.json'])
    await store.save('creation', {reveal: 100n})
    expect(await store.load('creation')).toEqual({reveal: 100n})
    expect(await store.load('absent')).toBeUndefined()
  })
  it.each(['../secret', '/absolute', '.', '..', 'nested/key', 'a\\b', ''])('refuses traversal key %j', async key => {
    const store = createFileStore(await directory())
    await expect(store.save(key, {})).rejects.toThrow('Invalid state key')
    await expect(store.load(key)).rejects.toThrow('Invalid state key')
    await expect(store.withLock(key, async () => 1)).rejects.toThrow('Invalid state key')
  })
  it('refuses symlinked state and directories, and public state permissions', async () => {
    const dir = await directory(), other = await directory(), store = createFileStore(dir)
    await createFileStore(other).save('secret', {secret: 'not followed'})
    await symlink(join(other, 'secret.json'), join(dir, 'secret.json'))
    await expect(store.load('secret')).rejects.toThrow()
    await symlink(other, join(dir, 'alias'))
    await expect(createFileStore(join(dir, 'alias')).load('secret')).rejects.toThrow()
    await chmod(dir, 0o755)
    await expect(store.load('x')).rejects.toThrow('0700')
  })
  it('makes lock contention explicit, releases failed callbacks, and leaves no lock on success', async () => {
    const dir = await directory(), first = createFileStore(dir), second = createFileStore(dir)
    await expect(first.withLock('intent', async () => {
      await expect(second.withLock('intent', async () => 1)).rejects.toBeInstanceOf(StoreLockedError)
      expect((await stat(join(dir, 'intent.lock'))).mode & 0o777).toBe(0o600)
      throw new Error('submission failed')
    })).rejects.toThrow('submission failed')
    expect(await second.withLock('intent', async () => 7)).toBe(7)
    expect(await readdir(dir)).toEqual([])
  })
  it('never deletes an existing lock and leaves prior bytes intact on serialization failure', async () => {
    const dir = await directory(), store = createFileStore(dir)
    await store.save('intent', {ok: true})
    const before = await readFile(join(dir, 'intent.json'), 'utf8')
    await expect(store.save('intent', {bad: Infinity})).rejects.toThrow()
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic
    await expect(store.save('intent', cyclic)).rejects.toThrow('cycles')
    expect(await readFile(join(dir, 'intent.json'), 'utf8')).toBe(before)
    await store.withLock('stale', async () => {
      const beforeLock = await readFile(join(dir, 'stale.lock'), 'utf8')
      await expect(createFileStore(dir).withLock('stale', async () => {})).rejects.toThrow('reconcile')
      expect(await readFile(join(dir, 'stale.lock'), 'utf8')).toBe(beforeLock)
    })
  })
})
