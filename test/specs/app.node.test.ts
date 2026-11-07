import {afterEach, describe, expect, it} from 'vitest'
import {mkdtemp, rm, stat, readdir, symlink, readFile, chmod, writeFile, unlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createFileStore, StoreLockedError} from '../../src/app/node.js'
const roots: string[] = []
async function directory() { const dir = await mkdtemp(join(tmpdir(), 'tasra-store-')); roots.push(dir); return dir }
afterEach(async () => { await Promise.all(roots.splice(0).map(dir => rm(dir, {recursive: true, force: true}))) })
describe('private application file store', () => {
  it('lists saved keys by prefix, never temporaries or locks', async () => {
    const dir = await directory(), store = createFileStore(dir)
    await store.save('paid-op-1', 1); await store.save('paid-op-index', 2); await store.save('other', 3)
    expect(await store.withLock('paid-op-2', async () => (await store.list!('paid-op-')).sort())).toEqual(['paid-op-1', 'paid-op-index'])
  })
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
  it('queues concurrent locks on one key within the process in call order, never refusing', async () => {
    const dir = await directory(), stores = [createFileStore(dir), createFileStore(dir)]
    let inside = 0, most = 0
    const order: number[] = []
    const results = await Promise.all(Array.from({length: 32}, (_, i) => stores[i % 2]!.withLock('paid-op-index', async () => {
      inside++; most = Math.max(most, inside)
      await new Promise(done => setTimeout(done, 1))
      order.push(i); inside--
      return i
    })))
    expect(results).toEqual(Array.from({length: 32}, (_, i) => i))
    expect(order).toEqual(results)
    expect(most).toBe(1)
    expect(await readdir(dir)).toEqual([])
  })
  it('waits a bounded time for a lock another process holds, then refuses and leaves it untouched', async () => {
    const dir = await directory(), store = createFileStore(dir, {lockWaitMs: 150})
    await store.save('seed', 1)
    // A lock file this process did not create: another process holds it (or crashed holding it).
    await writeFile(join(dir, 'payer.lock'), '{"pid":1}', {mode: 0o600})
    const started = Date.now()
    await expect(store.withLock('payer', async () => 1)).rejects.toBeInstanceOf(StoreLockedError)
    expect(Date.now() - started).toBeGreaterThanOrEqual(140)
    expect(await readFile(join(dir, 'payer.lock'), 'utf8')).toBe('{"pid":1}')
    await expect(createFileStore(dir, {lockWaitMs: 0}).withLock('payer', async () => 1)).rejects.toBeInstanceOf(StoreLockedError)
    // Released by its holder while this one waits: acquired.
    setTimeout(() => { void unlink(join(dir, 'payer.lock')) }, 40)
    expect(await createFileStore(dir, {lockWaitMs: 5_000}).withLock('payer', async () => 7)).toBe(7)
    expect(() => createFileStore(dir, {lockWaitMs: -1})).toThrow('lock wait')
  })
  it('refuses a nested lock on a held key at once, but not a later lock from the same call chain', async () => {
    const dir = await directory(), store = createFileStore(dir)
    let later: Promise<number> | undefined
    await store.withLock('journal', async () => {
      await expect(store.withLock('journal', async () => 1)).rejects.toBeInstanceOf(StoreLockedError)
      // Started inside the lock, run after it is released: it queues and is granted.
      later = new Promise<void>(done => setTimeout(done, 20)).then(() => store.withLock('journal', async () => 2))
      expect(await store.withLock('other', async () => 3)).toBe(3)
    })
    expect(await later).toBe(2)
  })
})
