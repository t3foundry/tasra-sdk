import {afterAll, describe, expect, it} from 'vitest'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

const {createFileStore} = await import('../../src/app/node.js')
const {saveAll, saveRederivable, withCommit} = await import('../../src/app/store-commit.js')

// A reader in the same process as concurrent commits must never observe a commit's transient
// state. Real files, real renames: a load that opened a value just before a commit renamed its
// successor over it holds an unlinked inode (nlink 0) and must read the successor instead of
// refusing it as a non-private file.
const dirs: string[] = []
const fresh = async () => { const dir = await mkdtemp(join(tmpdir(), 'tasra-store-race-')); dirs.push(dir); return join(dir, 'state') }
afterAll(async () => { for (const dir of dirs) await rm(dir, {recursive: true, force: true}) })

describe('file store under concurrent commits in one process', () => {
  it('loads never fail while the same and other keys are replaced concurrently', async () => {
    const store = createFileStore(await fresh())
    const keys = ['a', 'b', 'c']
    for (const key of keys) await store.save(key, {n: 0})
    const failures: unknown[] = []
    let writing = true
    const writers = Array.from({length: 8}, async (_, w) => {
      for (let i = 1; i <= 60; i++) {
        const key = keys[(w + i) % keys.length]!
        if (i % 4 === 0) await withCommit(store, [key, keys[(w + i + 1) % keys.length]!], async commit => { commit.stage(key, {n: i, w}); commit.stage(keys[(w + i + 1) % keys.length]!, {n: i, w}) })
        else if (i % 4 === 1) await saveAll(store, keys.map(k => [k, {n: i, w}] as const))
        else if (i % 4 === 2) await saveRederivable(store, key, {n: i, w})
        else await store.save(key, {n: i, w})
      }
    })
    const readers = Array.from({length: 8}, async (_, r) => {
      while (writing) {
        try { expect(await store.load<{n: number}>(keys[r % keys.length]!)).toMatchObject({n: expect.any(Number)}) }
        catch (error) { failures.push(error); return }
      }
    })
    await Promise.all(writers)
    writing = false
    await Promise.all(readers)
    expect(failures.map(String)).toEqual([])
  }, 60_000)

  it('a reservation-style read-modify-commit under the lock never refuses a value it published itself', async () => {
    const store = createFileStore(await fresh())
    await store.save('counter', {n: 0})
    const failures: unknown[] = []
    // Readers outside the lock race the locked commits, as concurrent streams of one worker do.
    let writing = true
    const reader = (async () => { while (writing) { try { await store.load('counter') } catch (error) { failures.push(error); return } } })()
    await Promise.all(Array.from({length: 16}, async () => {
      for (let i = 0; i < 25; i++) await withCommit(store, 'counter', async commit => {
        const current = await store.load<{n: number}>('counter')
        commit.stage('counter', {n: current!.n + 1})
      })
    }))
    writing = false
    await reader
    expect(failures.map(String)).toEqual([])
    expect(await store.load('counter')).toEqual({n: 400})
  }, 60_000)
})
