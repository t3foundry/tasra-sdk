/** Node-only durable private state. Import from tasra-sdk/app/node. */
import {constants} from 'node:fs'
import {mkdir, lstat, open, rename, unlink} from 'node:fs/promises'
import {resolve, join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {TasraError} from '../errors.js'

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
}
/**
 * A state lock is already held and requires reconciliation before manual removal.
 */
export class StoreLockedError extends TasraError {
  constructor(/** Store entry whose exclusive lock could not be acquired. */ readonly key: string) { super(`State ${key} is locked; reconcile any interrupted operation before removing its lock`) }
}

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

/**
 * The directory is private, trusted application state, not an untrusted shared folder.
 * @param directory Private application state directory owned by the current operating-system user.
 */
export function createFileStore(directory: string): ApplicationStore {
  const root = resolve(directory)
  const path = (key: string, suffix = '.json') => {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(key)) throw new TasraError('Invalid state key')
    return join(root, key + suffix)
  }
  async function ready() {
    await mkdir(root, {recursive: true, mode: 0o700})
    const stat = await lstat(root)
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) throw new TasraError('State directory must be owned by this user with mode 0700')
  }
  async function syncDirectory() {
    const dir = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    try { await dir.sync() } finally { await dir.close() }
  }
  return {
    async load<T>(key: string): Promise<T | undefined> {
      const target = path(key)
      await ready()
      let file
      try { file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW) }
      catch (error) { if (missing(error)) return undefined; throw error }
      try {
        const stat = await file.stat()
        if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) throw new TasraError('State file must be a private regular file')
        const envelope = JSON.parse(await file.readFile('utf8')) as {schemaVersion: number; value: Encoded}
        if (envelope.schemaVersion !== 1) throw new TasraError('Unsupported state schema')
        return decode(envelope.value) as T
      } finally { await file.close() }
    },
    async save(key, value) {
      const target = path(key), contents = JSON.stringify({schemaVersion: 1, value: encode(value)}) + '\n'
      await ready()
      const temporary = join(root, `.${randomUUID()}.tmp`)
      const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
      try {
        try { await file.writeFile(contents, 'utf8'); await file.sync() } finally { await file.close() }
        await rename(temporary, target)
        await syncDirectory()
      } finally { await unlink(temporary).catch(error => { if (!missing(error)) throw error }) }
    },
    async withLock(key, action) {
      const target = path(key, '.lock')
      await ready()
      let lock
      try { lock = await open(target, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new StoreLockedError(key); throw error }
      try {
        await lock.writeFile(JSON.stringify({pid: process.pid, createdAt: new Date().toISOString()}))
        await lock.sync()
        await syncDirectory()
        return await action()
      } finally { await lock.close(); await unlink(target); await syncDirectory() }
    },
  }
}
