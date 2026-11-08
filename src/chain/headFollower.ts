// A follower of the chain head, so a paid operation reads immutable block-pinned facts instead of
// asking the RPC for `latest` and a canonicality recheck on its critical path.
//
// The follower keeps the last `window` headers it saw as ONE parentHash-linked chain. A header that
// does not extend the tip (a reorg, or heads it missed) is linked back through `getBlock(parentHash)`
// to a header it holds; one it cannot link within the window restarts the chain at that header (a
// gap): nothing before it is vouched for again. It never invents an answer:
//
// - `tip()` is the newest header only while the follower is LIVE (a head or an unchanged-tip poll
//   within `liveAfterMs`); otherwise undefined and callers read `latest` from the RPC as before.
// - `isCanonical(at)` is true only for a deployment declared with instant finality (Avalanche
//   C-Chain: an accepted block is final), while live, for a block inside the gap-free chain whose
//   hash is the one held at its number. Anything else is undefined (outside the chain, a gap, not
//   live, probabilistic finality) or false (another hash at that number), and callers keep the RPC
//   recheck. Only `true` may replace a recheck.
//
// Listeners run after each new tip (the block-pinned pre-reads); they never decide anything.
import type {Hex, PublicClient} from 'viem'
import type {PinnedBlock} from './pinnedReads.js'

/** A followed header. */
export interface FollowedHead extends PinnedBlock {parentHash: Hex}

/** Head follower options. */
export interface HeadFollowerOptions {
  /** `instant` (an accepted block never reorganizes: Avalanche C-Chain) lets `isCanonical` answer; default `probabilistic` (it never does). */
  finality?: 'instant' | 'probabilistic'
  /** Headers held, 2..1024 (default 64); also the deepest reorg or gap it links back. */
  window?: number
  /** A follower with no head or unchanged-tip poll for this long is not live (default 5000 ms). */
  liveAfterMs?: number
  /** Poll interval on HTTP transports (default 1000 ms). WebSocket transports subscribe instead. */
  pollMs?: number
  /** Clock in ms (tests). */
  now?: () => number
}

/** A started (or startable) head follower for one client. */
export interface HeadFollower {
  /** The finality the deployment was declared with. */
  readonly finality: 'instant' | 'probabilistic'
  /** The newest header while live, otherwise undefined. */
  tip(): FollowedHead | undefined
  /** True only when `at` is provably canonical (see module comment); false or undefined means: recheck by RPC. */
  isCanonical(at: PinnedBlock): boolean | undefined
  /** Whether the follower heard from the chain within `liveAfterMs`. */
  live(): boolean
  /** Feed one header (the poller, a newHeads subscription or tests). Serialized; never throws. */
  ingest(header: unknown): Promise<void>
  /** Run `listener` after every new tip; returns the unsubscribe function. */
  onHead(listener: (tip: FollowedHead) => void): () => void
  /** Number of gaps (unlinkable headers) seen; diagnostics only. */
  gaps(): number
  /** Start polling (HTTP) or subscribing (WebSocket). Idempotent. */
  start(): void
  /** Stop and forget every header. */
  stop(): void
}

const HEX32 = /^0x[0-9a-f]{64}$/i

function parseHead(value: unknown): FollowedHead | undefined {
  const b = value as {number?: unknown; hash?: unknown; parentHash?: unknown; timestamp?: unknown} | null | undefined
  if (!b || typeof b.number !== 'bigint' || typeof b.timestamp !== 'bigint' || typeof b.hash !== 'string' || typeof b.parentHash !== 'string'
    || !HEX32.test(b.hash) || !HEX32.test(b.parentHash) || b.number < 0n || b.timestamp < 0n) return undefined
  return {blockNumber: b.number, blockHash: b.hash.toLowerCase() as Hex, parentHash: b.parentHash.toLowerCase() as Hex, blockTimestamp: b.timestamp}
}

/**
 * Create a head follower for `client`. It does nothing until started or fed.
 * @param client Trusted client of the deployment (the same RPC the operation reads).
 * @param options Finality, window, liveness and polling.
 */
export function createHeadFollower(client: PublicClient, options: HeadFollowerOptions = {}): HeadFollower {
  const finality = options.finality ?? 'probabilistic', window = options.window ?? 64
  const liveAfterMs = options.liveAfterMs ?? 5_000, pollMs = options.pollMs ?? 1_000, now = options.now ?? Date.now
  if (finality !== 'instant' && finality !== 'probabilistic') throw new Error('Invalid head follower finality')
  if (!Number.isSafeInteger(window) || window < 2 || window > 1024) throw new Error('Invalid head follower window')
  if (!Number.isSafeInteger(liveAfterMs) || liveAfterMs < 1 || liveAfterMs > 60_000) throw new Error('Invalid head follower liveness')
  if (!Number.isSafeInteger(pollMs) || pollMs < 50 || pollMs > 60_000) throw new Error('Invalid head follower poll interval')
  let chain: FollowedHead[] = []
  let heardAt = -Infinity, gapCount = 0
  let queue: Promise<void> = Promise.resolve()
  let timer: ReturnType<typeof setTimeout> | undefined, unwatch: (() => void) | undefined, running = false
  const listeners = new Set<(tip: FollowedHead) => void>()
  const live = () => chain.length > 0 && now() - heardAt <= liveAfterMs
  const indexOf = (hash: Hex) => {
    for (let i = chain.length - 1; i >= 0; i--) if (chain[i]!.blockHash === hash) return i
    return -1
  }
  const emit = () => {
    const tip = chain[chain.length - 1]!
    for (const listener of listeners) { try { listener(tip) } catch { /* a pre-read never affects the follower */ } }
  }
  const settle = (next: FollowedHead[]) => {
    chain = next.length > window ? next.slice(next.length - window) : next
    heardAt = now()
    emit()
  }
  const parent = async (hash: Hex): Promise<FollowedHead | undefined> => {
    try { return parseHead(await client.getBlock({blockHash: hash})) } catch { return undefined }
  }
  async function link(head: FollowedHead): Promise<void> {
    if (chain.length === 0) return settle([head])
    const tip = chain[chain.length - 1]!
    if (head.blockHash === tip.blockHash) { heardAt = now(); return }
    // An older header the chain already holds (a lagging RPC backend): nothing new, not a heartbeat.
    if (indexOf(head.blockHash) !== -1) return
    if (head.blockNumber === tip.blockNumber + 1n && head.parentHash === tip.blockHash) return settle([...chain, head])
    // Missed heads or a reorg: walk back through parents to a header the chain holds.
    const path = [head]
    let current = head
    for (let steps = 0; steps < window; steps++) {
      const at = indexOf(current.parentHash)
      if (at !== -1) return settle([...chain.slice(0, at + 1), ...path.reverse()])
      if (current.blockNumber === 0n || current.blockNumber - 1n < chain[0]!.blockNumber) break
      const previous = await parent(current.parentHash)
      if (!previous || previous.blockHash !== current.parentHash || previous.blockNumber !== current.blockNumber - 1n) break
      path.push(previous)
      current = previous
    }
    // A gap: vouch only for what follows this header.
    gapCount++
    settle([head])
  }
  const follower: HeadFollower = {
    finality,
    tip: () => live() ? {...chain[chain.length - 1]!} : undefined,
    isCanonical(at) {
      if (finality !== 'instant' || !live() || chain.length === 0) return undefined
      const first = chain[0]!.blockNumber, last = chain[chain.length - 1]!.blockNumber
      if (at.blockNumber < first || at.blockNumber > last) return undefined
      return chain[Number(at.blockNumber - first)]!.blockHash === at.blockHash.toLowerCase()
    },
    live,
    ingest(header) {
      const head = parseHead(header)
      if (!head) return queue
      queue = queue.then(() => link(head)).catch(() => {})
      return queue
    },
    onHead(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    gaps: () => gapCount,
    start() {
      if (running) return
      running = true
      if (client.transport.type === 'webSocket') {
        unwatch = client.watchBlocks({emitOnBegin: true, includeTransactions: false, onBlock: block => { void follower.ingest(block) }, onError: () => {}})
        return
      }
      const poll = async () => {
        try { await follower.ingest(await client.getBlock({blockTag: 'latest'})) } catch { /* liveness lapses */ }
        if (running) { timer = setTimeout(() => { void poll() }, pollMs); (timer as {unref?: () => void}).unref?.() }
      }
      void poll()
    },
    stop() {
      running = false
      if (timer) clearTimeout(timer)
      unwatch?.()
      timer = undefined; unwatch = undefined
      chain = []; heardAt = -Infinity
    },
  }
  return follower
}

const followers = new WeakMap<PublicClient, HeadFollower>()

/** The follower attached to `client`, if any. */
export function headFollowerOf(client: PublicClient): HeadFollower | undefined {
  return followers.get(client)
}

/**
 * Follow `client`'s chain head: paid operations on this client then read block-pinned facts from
 * the followed tip and its pre-reads, falling back to RPC whenever the follower cannot vouch.
 * Replaces (and stops) a follower attached before. Returns the started follower.
 * @param client Trusted client of the deployment.
 * @param options Finality (declare `instant` only for a chain whose accepted blocks are final), window, liveness, polling.
 */
export function followHeads(client: PublicClient, options: HeadFollowerOptions = {}): HeadFollower {
  followers.get(client)?.stop()
  const follower = createHeadFollower(client, options)
  followers.set(client, follower)
  follower.start()
  return follower
}

/** Detach and stop the follower of `client`. */
export function unfollowHeads(client: PublicClient): void {
  followers.get(client)?.stop()
  followers.delete(client)
}

/** Internal (tests and fixtures): attach an unstarted follower. */
export function attachHeadFollower(client: PublicClient, follower: HeadFollower): void {
  followers.get(client)?.stop()
  followers.set(client, follower)
}
