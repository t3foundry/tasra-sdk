// Block-pinned pre-reads run at every new head the client's follower reports. Each registered
// interest (a slot, a service, an in-flight request) reads what an operation at that head would
// read, through the same pinned-read path, so the operation finds it cached. Pre-reads decide
// nothing and their errors are dropped: an operation's own read surfaces any failure.
import type {PublicClient} from 'viem'
import {headFollowerOf, type FollowedHead, type HeadFollower} from './headFollower.js'

/** Most interests per client; the oldest registration is dropped first. */
export const MAX_PREFETCH_INTERESTS = 256

interface Interest {read: (tip: FollowedHead) => Promise<unknown>; until: number}
interface Registry {follower: HeadFollower; interests: Map<string, Interest>; unsubscribe: () => void}
const registries = new WeakMap<PublicClient, Registry>()

function registry(client: PublicClient): Registry | undefined {
  const follower = headFollowerOf(client)
  if (!follower) return undefined
  let r = registries.get(client)
  if (r && r.follower !== follower) { r.unsubscribe(); r = undefined }
  if (!r) {
    const interests = new Map<string, Interest>()
    const unsubscribe = follower.onHead(tip => {
      const now = Date.now()
      for (const [key, interest] of interests) {
        if (interest.until <= now) { interests.delete(key); continue }
        void interest.read(tip).catch(() => {})
      }
    })
    registries.set(client, r = {follower, interests, unsubscribe})
  }
  return r
}

/**
 * Pre-read for `key` at every new followed head until `until` (ms; default: while registered).
 * Re-registering a key refreshes its read and expiry. Without a follower on `client` this does nothing.
 * @param client Client whose follower reports heads.
 * @param key Stable interest identity.
 * @param read Block-pinned reads at the new tip.
 * @param until Expiry in ms since the epoch.
 */
export function registerHeadPrefetch(client: PublicClient, key: string, read: (tip: FollowedHead) => Promise<unknown>, until = Number.POSITIVE_INFINITY): void {
  const r = registry(client)
  if (!r) return
  const known = r.interests.delete(key)
  if (r.interests.size >= MAX_PREFETCH_INTERESTS) r.interests.delete(r.interests.keys().next().value!)
  r.interests.set(key, {read, until})
  if (known) return
  // A new interest reads the current tip at once too: the next operation finds it warm.
  const tip = r.follower.tip()
  if (tip) void read(tip).catch(() => {})
}

/** Stop pre-reading for `key`. */
export function unregisterHeadPrefetch(client: PublicClient, key: string): void {
  registries.get(client)?.interests.delete(key)
}
