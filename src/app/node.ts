/** Node-only durable private state. Import from @t3foundry/tasra-sdk/app/node. */
import {constants} from 'node:fs'
import {mkdir, lstat, open, readdir, rename, unlink} from 'node:fs/promises'
import {resolve, join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {AsyncLocalStorage} from 'node:async_hooks'
import {TasraError} from '../errors.js'
import {StoreLockedError} from './store-errors.js'
import {STORE_COMMIT, type StoreCommitSteps} from './store-commit.js'

/**
 * Durable private state storage with exclusive locking for each named operation.
 */
export interface ApplicationStore {
  /**
   * Load a saved value, or return undefined when the key does not exist.
   */
  load<T>(key: string): Promise<T | undefined>
  /**
   * Atomically persist private state before resolving.
   */
  save<T>(key: string, value: T): Promise<void>
  /**
   * Exclusively serialize work for the key across all participating processes or tabs.
   */
  withLock<T>(key: string, action: () => Promise<T>): Promise<T>
  /**
   * Optional: keys starting with `prefix`, in any order. Used only for one-time maintenance
   * such as backfilling the paid operation index; stores without it still work everywhere else.
   */
  list?(prefix: string): Promise<string[]>
  /**
   * Optional: atomically and durably create the record `key` only if it does not exist, across all
   * participating processes or tabs. Resolves true for exactly one caller, false when the key
   * already exists. Paid approvals use it as a one-use, generation-bound send claim; without it a
   * retained approval is sent once and never resent.
   */
  claim?(key: string): Promise<boolean>
}
export {StoreLockedError}

type Encoded = ['null'] | ['undefined'] | ['string', string] | ['number', number] | ['boolean', boolean] | ['bigint', string] | ['bytes', string] | ['array', Encoded[]] | ['object', [string, Encoded][]]
function encode(value: unknown, seen = new Set<object>()): Encoded {
  if (value === null) return ['null']
  if (value === undefined) return ['undefined']
  if (typeof value === 'string') return ['string', value]
  if (typeof value === 'boolean') return ['boolean', value]
  if (typeof value === 'number' && Number.isFinite(value)) return ['number', value]
  if (typeof value === 'bigint') return ['bigint', value.toString()]
  if (value instanceof Uint8Array) return ['bytes', Buffer.from(value).toString('base64')]
  if (typeof value !== 'object' || seen.has(value)) throw new TasraError('State must contain finite plain data without cycles')
  seen.add(value)
  try {
    if (Array.isArray(value)) return ['array', value.map(v => encode(v, seen))]
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TasraError('State must contain plain objects')
    return ['object', Object.entries(value).map(([k, v]) => [k, encode(v, seen)])]
  } finally { seen.delete(value) }
}
function decode(value: Encoded): unknown {
  switch (value[0]) {
    case 'null': return null
    case 'undefined': return undefined
    case 'string': case 'number': case 'boolean': return value[1]
    case 'bigint': return BigInt(value[1])
    case 'bytes': return new Uint8Array(Buffer.from(value[1], 'base64'))
    case 'array': return value[1].map(decode)
    case 'object': return Object.fromEntries(value[1].map(([k, v]) => [k, decode(v)]))
    default: throw new TasraError('Invalid state encoding')
  }
}
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
/** How often one load re-opens a value replaced (renamed over) between its open and its fstat. */
const LOAD_REPLACED_RETRIES = 64

// In-process lock queue. Every file store in this process (one directory may have several store
// objects) queues on the lock FILE's path, in call order, so callers in one process never refuse
// each other; only a lock file held by ANOTHER process (or left by a crashed one) is waited for,
// boundedly, and then refused. One entry per path with a waiter or holder; the last one leaving
// removes it.
const queues = new Map<string, Promise<void>>()
/** Locks held by the current async call chain: a nested `withLock` on one of them would wait on itself. */
const holding = new AsyncLocalStorage<readonly {path: string; released: boolean}[]>()
const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms))

// Group commit. Every durable write keeps the crash model it always had: a file's data is on
// stable storage BEFORE the rename (or lock/claim entry) that publishes it can become durable,
// and a caller is acknowledged only after the directory entry itself is synced. What changes is
// who pays for the device flush:
//   1. each file's data is written with O_DSYNC, so write() returns only once the data reached
//      the device (synchronized data integrity, as fdatasync; on Linux this is already a FUA or
//      flush, so durable on its own);
//   2. ONE `FileHandle.sync()` per group of concurrent writers - on macOS libuv issues it as
//      `F_FULLFSYNC`, which flushes the drive's whole write cache, so every group member's
//      O_DSYNC data is now on stable storage;
//   3. only then the rename / entry, and ONE directory sync per group before anyone is told.
// Before this, each write paid its own F_FULLFSYNC and directory sync; macOS serializes those
// device-wide (about 5 ms each), which capped a process at a few hundred durable writes per
// second however many callers were waiting. Without O_DSYNC (Windows) every file is synced on
// its own exactly as before and the barrier is skipped.
const DSYNC: number = (constants as {O_DSYNC?: number}).O_DSYNC ?? 0
/**
 * Coalesce one asynchronous step among concurrent callers. A caller joins the next step that has
 * NOT started yet, so the step always begins after that caller's own preceding work completed;
 * while a step runs, new callers queue for the following one. A failed step rejects exactly the
 * callers that joined it.
 */
function coalescer<A>(step: (args: A[]) => Promise<void>) {
  let running: Promise<void> = Promise.resolve()
  let waiting: {args: A[]; done: Promise<void>} | undefined
  return (arg: A): Promise<void> => {
    if (waiting) { waiting.args.push(arg); return waiting.done }
    const batch: {args: A[]; done: Promise<void>} = {args: [arg], done: Promise.resolve()}
    batch.done = running.catch(() => {}).then(() => {
      if (waiting === batch) waiting = undefined
      return step(batch.args)
    })
    waiting = batch
    running = batch.done
    return batch.done
  }
}
interface DirectoryCommit {
  /** Resolves once the data of `file` (written through an O_DSYNC handle, still open) is on stable storage. */
  barrier(file: import('node:fs/promises').FileHandle): Promise<void>
  /** Resolves once every entry created, renamed or removed in the directory before the call is durable. */
  directory(): Promise<void>
}
// One committer per directory path, shared by every store object on it in this process.
const committers = new Map<string, DirectoryCommit>()
/** Durable-write steps the store counts (for tests and measurement); never part of the stored state. */
export const fileStoreSyncCounters = {barriers: 0, fileSyncs: 0, directorySyncs: 0}
function committer(root: string): DirectoryCommit {
  let found = committers.get(root)
  if (found) return found
  // Any member's handle carries the flush: F_FULLFSYNC empties the drive cache for all of them.
  const barrier = coalescer<import('node:fs/promises').FileHandle>(async files => {
    fileStoreSyncCounters.barriers++
    await files[0]!.sync()
  })
  const directory = coalescer<void>(async () => {
    fileStoreSyncCounters.directorySyncs++
    const dir = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    try { await dir.sync() } finally { await dir.close() }
  })
  found = {barrier, directory: () => directory(undefined)}
  committers.set(root, found)
  return found
}

/** Options for {@link createFileStore}. */
export interface FileStoreOptions {
  /**
   * Longest wait, in ms, for a lock held by ANOTHER process before `withLock` refuses with
   * StoreLockedError (default 10000; 0 refuses at once; at most 600000). A lock left by a crashed
   * process is never removed or taken over: after the wait it still needs reconciliation. Calls in
   * this process never refuse each other; they queue in call order.
   */
  lockWaitMs?: number
}

/**
 * The directory is private, trusted application state, not an untrusted shared folder.
 * @param directory Private application state directory owned by the current operating-system user.
 * @param options Bounded wait for a lock held by another process.
 */
export function createFileStore(directory: string, options: FileStoreOptions = {}): ApplicationStore {
  const root = resolve(directory)
  const lockWaitMs = options.lockWaitMs ?? 10_000
  if (!Number.isSafeInteger(lockWaitMs) || lockWaitMs < 0 || lockWaitMs > 600_000) throw new TasraError('Invalid file store lock wait')
  const path = (key: string, suffix = '.json') => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(key)) throw new TasraError('Invalid state key')
    return join(root, key + suffix)
  }
  /**
   * Check the directory before every operation (created first when absent). One `lstat` when it
   * exists: a recursive `mkdir` of an existing directory is two more metadata calls per operation,
   * and under concurrent device flushes (macOS F_FULLFSYNC) every metadata call waits its turn.
   */
  async function ready() {
    let stat
    try { stat = await lstat(root) }
    catch (error) {
      if (!missing(error)) throw error
      await mkdir(root, {recursive: true, mode: 0o700})
      stat = await lstat(root)
    }
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) throw new TasraError('State directory must be owned by this user with mode 0700')
  }
  const commit = committer(root)
  const syncDirectory = () => commit.directory()
  /** Make the data written through `file` (opened with {@link DSYNC}) durable before anything publishes it. */
  async function durable(file: import('node:fs/promises').FileHandle) {
    if (DSYNC === 0) { fileStoreSyncCounters.fileSyncs++; await file.sync(); return }
    await commit.barrier(file)
  }
  /**
   * Create the lock file exclusively. At the head of this process's queue an existing file belongs
   * to another process (or a crashed one): wait for it to go, at most `lockWaitMs`, then refuse.
   * The file is never removed or overwritten here.
   */
  async function acquire(key: string, target: string, durableLock: boolean) {
    const deadline = Date.now() + lockWaitMs
    for (let delay = 5; ; delay = Math.min(delay * 2, 100)) {
      try { return await open(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW | (durableLock ? DSYNC : 0), 0o600) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const left = deadline - Date.now()
        if (left <= 0) throw new StoreLockedError(key)
        await sleep(Math.min(delay, left))
      }
    }
  }
  /**
   * Write every value to its own temporary file (O_DSYNC), then make all of their data durable
   * together: one coalesced barrier (or each file's own sync without O_DSYNC). Nothing is renamed
   * here, so nothing is published before its data is on stable storage. The temporaries are
   * independent files, so they are created and written concurrently: under concurrent device
   * flushes each metadata call and O_DSYNC write waits its turn, and one commit stages up to
   * eight of them (C20: ~90 ms in a row on the 32-stream bench).
   */
  async function stageFiles(entries: readonly (readonly [string, Encoded])[]): Promise<{temporary: string; target: string}[]> {
    const encoded = entries.map(([key, value]) => ({target: path(key), contents: JSON.stringify({schemaVersion: 1, value}) + "\n"}))
    await ready()
    const written: {temporary: string; target: string}[] = []
    const files: import('node:fs/promises').FileHandle[] = []
    try {
      // `written` keeps entry order (publish renames by it); every opened handle is recorded before
      // any await can fail, so a failure closes and removes all of them.
      const slots = encoded.map(({target}) => ({temporary: join(root, `.${randomUUID()}.tmp`), target}))
      const outcomes = await Promise.allSettled(slots.map(async ({temporary}, i) => {
        const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW | DSYNC, 0o600)
        files.push(file); written.push(slots[i]!)
        await file.writeFile(encoded[i]!.contents, 'utf8')
      }))
      const failed = outcomes.find(o => o.status === 'rejected')
      if (failed) throw failed.reason
      written.sort((a, b) => slots.indexOf(a) - slots.indexOf(b))
      if (DSYNC === 0) for (const file of files) { fileStoreSyncCounters.fileSyncs++; await file.sync() }
      else if (files.length > 0) await commit.barrier(files[0]!)
      return written
    } catch (error) {
      await discard(written)
      throw error
    } finally { await Promise.all(files.map(file => file.close())) }
  }
  async function discard(written: readonly {temporary: string}[]) {
    for (const {temporary} of written) await unlink(temporary).catch(error => { if (!missing(error)) throw error })
  }
  /** Rename durable temporaries into place, in order; a temporary left by a failure is removed. */
  async function publish(written: readonly {temporary: string; target: string}[]) {
    try { for (const {temporary, target} of written) await rename(temporary, target) }
    catch (error) { await discard(written); throw error }
  }
  /**
   * Take the locks of `keys` (distinct, in sorted order, so two callers never wait on each other),
   * each in call order within this process (another process's lock is waited for, boundedly), run
   * `action`, and always remove every lock. `durableLock` syncs the lock entries before the
   * action runs; otherwise they become durable with the first directory sync after them.
   * `release` runs after a successful action with the locks still held, and returns whether their
   * removal still needs its own directory sync.
   */
  async function locked<T>(keys: readonly string[], durableLock: boolean, action: () => Promise<T>, release?: (unlock: () => Promise<void>) => Promise<boolean>): Promise<T> {
    const targets = [...new Set(keys)].sort().map(key => ({key, target: path(key, '.lock')}))
    // A nested lock on a key this call chain already holds can never be granted: refuse at once,
    // exactly as before, instead of queueing behind itself.
    const current = holding.getStore() ?? []
    for (const {key, target} of targets) if (current.some(held => held.path === target && !held.released)) throw new StoreLockedError(key)
    const turns: {target: string; tail: Promise<void>; done: () => void}[] = []
    const held: {path: string; released: boolean; lock: import('node:fs/promises').FileHandle; open: boolean}[] = []
    // Distinct lock files, all removed before the caller's one directory sync: concurrently.
    // Every lock is marked closed before any removal settles, so after a failure no caller runs
    // its sync (nothing is left open): the removals that DID succeed are synced here, once every
    // removal has settled, and the first failure is reported.
    const unlock = async () => {
      const outcomes = await Promise.allSettled(held.map(async h => {
        h.released = true
        if (!h.open) return false
        h.open = false; await h.lock.close(); await unlink(h.path)
        return true
      }))
      const failed = outcomes.find(o => o.status === 'rejected')
      if (!failed) return
      if (outcomes.some(o => o.status === 'fulfilled' && o.value)) await syncDirectory().catch(() => {})
      throw failed.reason
    }
    try {
      // The directory is checked once per lock set (before the first lock), not once per key.
      let checked = false
      for (const {key, target} of targets) {
        // Join the queue synchronously, so callers are served in call order.
        const previous = queues.get(target) ?? Promise.resolve()
        let done!: () => void
        const turn = new Promise<void>(resolve => { done = resolve })
        const tail = previous.then(() => turn)
        queues.set(target, tail)
        turns.push({target, tail, done})
        await previous
        if (!checked) { await ready(); checked = true }
        const lock = await acquire(key, target, durableLock)
        held.push({path: target, released: false, lock, open: true})
        await lock.writeFile(JSON.stringify({pid: process.pid, createdAt: new Date().toISOString()}))
      }
      if (durableLock) {
        // The lock's content is a diagnostic nothing reads; only its entry must be durable. With
        // O_DSYNC its data reached the device during the write (Linux: on stable storage; macOS:
        // the directory's F_FULLFSYNC empties the drive cache), so the directory sync suffices.
        if (DSYNC === 0) for (const h of held) { fileStoreSyncCounters.fileSyncs++; await h.lock.sync() }
        await syncDirectory()
      }
      const result = await holding.run([...current, ...held], action)
      if (release && !await release(unlock)) return result
      await unlock()
      await syncDirectory()
      return result
    } catch (error) {
      if (held.some(h => h.open)) { await unlock(); await syncDirectory() }
      throw error
    } finally {
      for (const h of held) h.released = true
      for (const {target, tail, done} of turns) { done(); if (queues.get(target) === tail) queues.delete(target) }
    }
  }
  const steps: StoreCommitSteps = {
    // Every store object on this directory with this lock wait reads and writes the same files
    // under the same in-process lock queues and committer: one state.
    identity: `file:${lockWaitMs}:${root}`,
    async withCommit(keys, action) {
      const staged = new Map<string, Encoded>()
      return locked(typeof keys === 'string' ? [keys] : keys, false, () => action({stage: (k, v) => { path(k); staged.delete(k); staged.set(k, encode(v)) }}), async unlock => {
        if (staged.size === 0) return true
        const written = await stageFiles([...staged])
        await publish(written)
        // One directory sync publishes every rename AND the removed lock.
        await unlock()
        await syncDirectory()
        return false
      })
    },
    async saveAll(entries) {
      if (entries.length === 0) return
      await publish(await stageFiles(entries.map(([key, value]) => [key, encode(value)] as const)))
      await syncDirectory()
    },
    async saveRederivable(key, value) {
      await publish(await stageFiles([[key, encode(value)]]))
    },
  }
  const store = {
    async load<T>(key: string): Promise<T | undefined> {
      const target = path(key)
      await ready()
      // Every save publishes by renaming a new file OVER the old one, so a load that opened the old
      // value an instant before holds an inode no name refers to any more: fstat reports nlink 0.
      // That inode is a superseded value, not the file at `target`; read the one that replaced it
      // (whose every property is checked again). Exactly nlink 0 is retried, never accepted, and
      // only a bounded number of times; any other link count, mode or owner is refused as before.
      for (let attempt = 0; ; attempt++) {
        let file
        try { file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW) }
        catch (error) { if (missing(error)) return undefined; throw error }
        try {
          const stat = await file.stat()
          if (stat.nlink === 0 && stat.isFile() && attempt < LOAD_REPLACED_RETRIES) continue
          if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) throw new TasraError('State file must be a private regular file')
          const envelope = JSON.parse(await file.readFile('utf8')) as {schemaVersion: number; value: Encoded}
          if (envelope.schemaVersion !== 1) throw new TasraError('Unsupported state schema')
          return decode(envelope.value) as T
        } finally { await file.close() }
      }
    },
    async save(key, value) {
      await publish(await stageFiles([[key, encode(value)]]))
      await syncDirectory()
    },
    async list(prefix) {
      await ready()
      // Saved values are `<key>.json`; temporaries start with a dot and locks end in `.lock`.
      return (await readdir(root)).filter(name => name.endsWith('.json') && /^[a-zA-Z0-9]/.test(name))
        .map(name => name.slice(0, -'.json'.length)).filter(key => key.startsWith(prefix))
    },
    async claim(key) {
      // `O_CREAT | O_EXCL` on the record itself is the exclusive claim, across threads and
      // processes: exactly one creator wins, every other gets EEXIST. The record is written and
      // fsynced, then the directory, before this resolves. A crash mid-write still leaves the key
      // claimed (its content is only a diagnostic), which is the safe direction.
      const target = path(key), contents = JSON.stringify({schemaVersion: 1, value: encode({claimed: true})}) + '\n'
      await ready()
      let file
      try { file = await open(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW | DSYNC, 0o600) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error }
      try { await file.writeFile(contents, 'utf8'); await durable(file) } finally { await file.close() }
      await syncDirectory()
      return true
    },
    withLock(key, action) { return locked([key], true, action) },
  } as ApplicationStore
  // Not enumerable: an application wrapper `{...store, load: wrapped}` must not copy the native
  // steps, or it would share this store's identity (and its journal commit batches, whose duplicate
  // check reads through the first caller's `load`) while behaving differently. A copy is an
  // ordinary application store: it gets the generic one-save-at-a-time path.
  Object.defineProperty(store, STORE_COMMIT, {value: steps, enumerable: false, writable: false, configurable: false})
  return store
}
