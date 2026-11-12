// Block-pinned contract reads on the paid operation path, with fewer requests and the same answers.
//
// Every read here is an `eth_call` at one block HASH with `requireCanonical: true` (EIP-1898).
// viem's own call batching cannot carry that: `call()` skips its Multicall3 scheduler whenever a
// `blockHash` is given (viem 2.56), so `batch: false` alone never batched anything. Instead:
//
// - Reads issued together at the same block hash are queued for one macrotask and sent as ONE
//   Multicall3 `aggregate3` eth_call, at that block hash with `requireCanonical: true`. A read is
//   never moved to a block number or `latest`.
// - Multicall3 is used only where its runtime code hash at a pinned block equals the canonical
//   deployment's. Anything else at that address, an absent contract or a failed probe means plain
//   individual calls (which an HTTP JSON-RPC batch transport may still group).
// - Each batched call allows failure. A failed item, a failed or undecodable aggregate and every
//   item of it are read again individually, exactly as before, so a revert or RPC error surfaces
//   with the same type and message as an unbatched read.
// - Results of registry reads at a block the client has confirmed FINALIZED are kept in a short,
//   bounded per-client cache. Errors, empty responses, `latest` reads, reservation reads and
//   freshness rechecks are never cached; only finalized-pinned registry reads come here.

import {headFollowerOf} from './headFollower.js'
import {decodeFunctionResult, encodeFunctionData, keccak256, multicall3Abi, type Address, type Hex, type PublicClient} from 'viem'
import {ExpiringCache, SingleFlight} from '../internal/bounded.js'

/** Multicall3's canonical, deterministic-deployment address. */
export const CANONICAL_MULTICALL3: Address = '0xcA11bde05977b3631167028862bE2a173976CA11'
/**
 * keccak256 of the canonical Multicall3 runtime code (3808 bytes), as read with `eth_getCode` from
 * the canonical address on Avalanche Fuji and Avalanche C-Chain. Any other code is not trusted.
 */
export const MULTICALL3_CODE_HASH: Hex = '0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891'

/** Most calls in one aggregate; a queue that reaches it is sent at once. */
export const MAX_AGGREGATE_CALLS = 64
/** Most calldata bytes in one aggregate (the same cap as `readMany`). */
const MAX_AGGREGATE_BYTES = 32_768
/** Most distinct block hashes queued at once per client; beyond it a read runs alone. */
const MAX_QUEUES = 256
/** A failed or negative Multicall3 probe is retried no sooner than this. */
const PROBE_RETRY_MS = 60_000
/** The finalized head is read at most once per this interval per client (about one block). */
export const FINALIZED_REFRESH_MS = 1_000
/** Most finalized-pinned registry results cached per client. */
const MAX_CACHED_READS = 4_096
/** A cached block-pinned result is useless once no fresh observation can use its block (30 s + 2 s skew). */
const CACHE_TTL_AFTER_BLOCK_MS = 32_000
/** Most identical in-flight registry reads shared per client (unchanged from before). */
const MAX_SHARED_REGISTRY_READS = 1_024

/** A canonical block every read of one observation is pinned to. */
export interface PinnedBlock {
  /** Block number. */
  blockNumber: bigint
  /** Block hash. */
  blockHash: Hex
  /** Block timestamp, Unix seconds. */
  blockTimestamp: bigint
}

interface Pending {to: Address; data: Hex; resolve: (data: Hex | undefined) => void; reject: (error: unknown) => void}
interface Queue {calls: Pending[]; bytes: number; timer?: ReturnType<typeof setTimeout>; sent: boolean}
interface ClientState {
  multicall: Address | false
  verified?: boolean
  retryAt: number
  probe?: Promise<boolean>
  queues: Map<string, Queue>
  finalized?: {number: bigint; hash: Hex}
  finalizedAt: number
  finalizedRead?: Promise<void>
  cache: ExpiringCache<Hex>
  shared: SingleFlight<Hex | undefined>
}

const states = new WeakMap<PublicClient, ClientState>()

function state(client: PublicClient): ClientState {
  let s = states.get(client)
  if (!s) states.set(client, s = {multicall: CANONICAL_MULTICALL3, retryAt: 0, queues: new Map(), finalizedAt: -Infinity,
    cache: new ExpiringCache(MAX_CACHED_READS), shared: new SingleFlight(MAX_SHARED_REGISTRY_READS)})
  return s
}

/**
 * Internal: choose the Multicall3 address pinned reads of `client` may batch through (`false`
 * disables batching). The code hash is checked either way.
 * @param client Client created for one deployment.
 * @param multicall3 Address to probe, or false.
 */
export function configurePinnedReads(client: PublicClient, multicall3: Address | false | undefined): void {
  state(client).multicall = multicall3 ?? CANONICAL_MULTICALL3
}

/** The unbatched read: what every pinned read was before batching, and the fallback for any failure. */
async function direct(client: PublicClient, blockHash: Hex, to: Address, data: Hex): Promise<Hex | undefined> {
  return (await client.call({to, data, blockHash, requireCanonical: true, batch: false})).data
}

/**
 * One `eth_call` of `data` on `to` at `blockHash` (canonical required), answering exactly what
 * `client.call({..., blockHash, requireCanonical: true}).data` answers, success or error.
 * Reads issued together at the same block share one Multicall3 aggregate where that is verified.
 * @param client Trusted client.
 * @param blockHash Canonical block every read is pinned to.
 * @param to Contract address.
 * @param data Encoded calldata.
 */
export function pinnedCall(client: PublicClient, blockHash: Hex, to: Address, data: Hex): Promise<Hex | undefined> {
  const s = state(client)
  if (s.multicall === false) return direct(client, blockHash, to, data)
  const key = blockHash.toLowerCase()
  let queue = s.queues.get(key)
  if (!queue) {
    if (s.queues.size >= MAX_QUEUES) return direct(client, blockHash, to, data)
    const created: Queue = {calls: [], bytes: 0, sent: false}
    created.timer = setTimeout(() => send(client, s, key, blockHash, created), 0)
    s.queues.set(key, queue = created)
  }
  const target = queue
  return new Promise((resolve, reject) => {
    target.calls.push({to, data, resolve, reject})
    target.bytes += (data.length - 2) / 2 + 20
    if (target.calls.length >= MAX_AGGREGATE_CALLS || target.bytes >= MAX_AGGREGATE_BYTES) send(client, s, key, blockHash, target)
  })
}

function send(client: PublicClient, s: ClientState, key: string, blockHash: Hex, queue: Queue): void {
  if (queue.sent) return
  queue.sent = true
  if (queue.timer !== undefined) clearTimeout(queue.timer)
  if (s.queues.get(key) === queue) s.queues.delete(key)
  // run() settles every call; an unexpected throw must still settle the rest, never leave one pending.
  run(client, s, blockHash, queue.calls).catch((error: unknown) => { for (const call of queue.calls) call.reject(error) })
}

function settle(call: Pending, read: Promise<Hex | undefined>): void {
  read.then(call.resolve, call.reject)
}

async function run(client: PublicClient, s: ClientState, blockHash: Hex, calls: Pending[]): Promise<void> {
  const alone = () => { for (const call of calls) settle(call, direct(client, blockHash, call.to, call.data)) }
  if (calls.length === 1) return alone()
  const address = await multicallAt(client, s, blockHash)
  if (!address) return alone()
  let results: readonly {success: boolean; returnData: Hex}[] | undefined
  try {
    const data = encodeFunctionData({abi: multicall3Abi, functionName: 'aggregate3',
      args: [calls.map(call => ({target: call.to, allowFailure: true, callData: call.data}))]})
    const answer = await direct(client, blockHash, address, data)
    results = answer === undefined ? undefined : decodeFunctionResult({abi: multicall3Abi, functionName: 'aggregate3', data: answer})
  } catch {
    // Any aggregate-level failure (RPC error, a non-canonical block, gas, garbage) is decided by
    // the individual reads below, which report it exactly as an unbatched read would.
    results = undefined
  }
  if (!results || results.length !== calls.length) return alone()
  calls.forEach((call, i) => {
    const result = results[i]!
    if (result.success) call.resolve(result.returnData === '0x' ? undefined : result.returnData)
    else settle(call, direct(client, blockHash, call.to, call.data))
  })
}

/** The verified Multicall3 address for reads at `blockHash`, or null to read individually. */
async function multicallAt(client: PublicClient, s: ClientState, blockHash: Hex): Promise<Address | null> {
  const address = s.multicall
  if (address === false) return null
  if (s.verified === true) return address
  if (s.verified === false && Date.now() < s.retryAt) return null
  s.probe ??= (async () => {
    try {
      const code = await client.getCode({address, blockHash, requireCanonical: true})
      // An absent contract or any code other than the canonical Multicall3 is never batched through.
      s.verified = code !== undefined && code !== '0x' && keccak256(code) === MULTICALL3_CODE_HASH
    } catch {
      s.verified = false
    }
    if (!s.verified) s.retryAt = Date.now() + PROBE_RETRY_MS
    return s.verified
  })().finally(() => { s.probe = undefined })
  return (await s.probe) ? address : null
}

/**
 * A registry read at `at`: from the finalized-block cache, else shared with an identical read in
 * flight, else batched. With `cache`, a successful non-empty result is kept once `at` is confirmed
 * finalized; everything else (errors, empty answers) is never kept.
 * @param client Trusted client.
 * @param at Canonical observation the read is pinned to.
 * @param to Contract address.
 * @param data Encoded calldata.
 * @param cache Use and fill the finalized-block cache (a fresh head observation only).
 */
export async function pinnedRegistryCall(client: PublicClient, at: PinnedBlock, to: Address, data: Hex, cache: boolean): Promise<Hex | undefined> {
  const s = state(client)
  const key = `${at.blockHash.toLowerCase()}|${to.toLowerCase()}|${data.toLowerCase()}`
  // A block the head follower proves canonical under instant finality is as fixed as a finalized
  // one: its pinned results (and the follower's pre-reads of them) are served from the cache.
  const followed = headFollowerOf(client)?.isCanonical(at) === true
  const cached = cache || followed ? s.cache.get(key) : undefined
  if (cached !== undefined) return cached
  const result = await s.shared.run(key, () => pinnedCall(client, at.blockHash, to, data))
  if (result !== undefined) {
    const expiresAt = Number(at.blockTimestamp) * 1000 + CACHE_TTL_AFTER_BLOCK_MS
    if (followed) s.cache.set(key, result, expiresAt)
    else if (cache) void finalizedBlock(client, s, at).then(final => { if (final) s.cache.set(key, result, expiresAt) })
  }
  return result
}

/**
 * Whether `at` is the finalized block: the client's finalized head, read at most once per
 * {@link FINALIZED_REFRESH_MS} and shared, names exactly this number and hash. A head past it
 * proves nothing about this hash, so it is conservatively not finalized. Never throws.
 */
async function finalizedBlock(client: PublicClient, s: ClientState, at: PinnedBlock): Promise<boolean> {
  const known = (): boolean | undefined => s.finalized && s.finalized.number >= at.blockNumber
    ? s.finalized.number === at.blockNumber && s.finalized.hash.toLowerCase() === at.blockHash.toLowerCase()
    : undefined
  const first = known()
  if (first !== undefined) return first
  if (!s.finalizedRead) {
    if (Date.now() - s.finalizedAt < FINALIZED_REFRESH_MS) return false
    s.finalizedAt = Date.now()
    s.finalizedRead = client.getBlock({blockTag: 'finalized'}).then(block => {
      if (block.number !== null && block.hash !== null && (!s.finalized || block.number > s.finalized.number)) s.finalized = {number: block.number, hash: block.hash}
    }, () => undefined).finally(() => { s.finalizedRead = undefined })
  }
  await s.finalizedRead
  return known() ?? false
}
