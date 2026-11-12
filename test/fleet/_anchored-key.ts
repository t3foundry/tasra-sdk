// Readiness of a freshly created slot = its group key ANCHORED ON CHAIN, not a keeper's answer.
//
// A keeper serves `GET /v1/keys/:id/public` as soon as ITS DKG finished, which is before the
// k-th publish vote (or the attested submit) lands in a block. Every paid operation decides at a
// chain head, where `KeyRegistry.getKeySlot(slot).publicKey` is still empty until then, and is
// refused "paid slot is inactive or has no published key". 2026-11-12 cert run 13 (`test:prod`,
// "e2e: BLS client-only threshold decrypt"): the fixture saw the keeper key at 00:46:13.1, the
// discovery read the chain at once, and the publishing block landed at 00:46:14.3. No head
// follower was attached; the RPC's own `latest` predated the anchoring block.

import type {Address, Hex, PublicClient} from 'viem'
import {keyRegistryAbi} from '../../src/chain/abis/keyRegistry.ts'

/** The fields of `KeyRegistry.getKeySlot` this wait judges. */
export interface AnchoredSlotView {exists: boolean; cancelled: boolean; publicKey: Hex}

export interface AnchoredKeyWait {
  /** Absolute deadline (ms, same clock as `now`). */
  deadlineMs: number
  pollMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/**
 * Wait (bounded) until `readSlot` reports the slot's group key published, then require it to be
 * the key a keeper served (`keeperKey`, hex with or without `0x`). Refuses a missing or cancelled
 * slot, a different anchored key and a deadline without one.
 */
export async function waitForAnchoredKey(readSlot: () => Promise<AnchoredSlotView>, keeperKey: string, wait: AnchoredKeyWait): Promise<Hex> {
  const now = wait.now ?? Date.now, sleep = wait.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const pollMs = wait.pollMs ?? 500
  const served = keeperKey.toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]+$/.test(served) || served.length === 0) throw new Error('keeper served no group key to compare')
  for (;;) {
    const slot = await readSlot()
    if (!slot.exists || slot.cancelled) throw new Error('slot is missing or cancelled on chain')
    if (slot.publicKey !== '0x') {
      if (slot.publicKey.toLowerCase().replace(/^0x/, '') !== served) throw new Error('anchored group key differs from the key a keeper served')
      return slot.publicKey
    }
    if (now() + pollMs > wait.deadlineMs) throw new Error('slot key was not anchored on chain before the deadline')
    await sleep(pollMs)
  }
}

/** {@link waitForAnchoredKey} reading `getKeySlot` at the RPC's `latest`. */
export function waitForSlotKeyOnChain(client: PublicClient, keyRegistry: Address, slotId: Hex, keeperKey: string, deadlineMs: number): Promise<Hex> {
  return waitForAnchoredKey(() => client.readContract({address: keyRegistry, abi: keyRegistryAbi, functionName: 'getKeySlot', args: [slotId]}),
    keeperKey, {deadlineMs})
}

/** Where {@link waitForCommitteeKey} looks: the committee, a keeper's served key, the chain. */
export interface CommitteeKeySources {
  /** The keepers currently serving the slot (empty while none does). */
  committee: () => Promise<string[]>
  /** The group key `keeper` serves for the slot, or undefined while it has none. */
  keeperKey: (keeper: string) => Promise<string | undefined>
  /** `KeyRegistry.getKeySlot` at the chain head the paid operations will read. */
  readSlot: () => Promise<AnchoredSlotView>
}

/**
 * Wait (bounded) for a fresh BLS slot's committee to serve its 96-byte group key AND for the chain to have
 * anchored that same key. Returns the committee and the key (lowercase hex, no `0x`). 2026-11-12
 * cert run 17 (`verify/bootstrap.ts`): the loop returned on a keeper's key, the slot was funded,
 * and the paid discovery read the chain at 10:07:05 while the publishing block landed 10:07:08.
 */
export async function waitForCommitteeKey(sources: CommitteeKeySources, wait: AnchoredKeyWait): Promise<{committee: string[]; publicKey: string}> {
  const now = wait.now ?? Date.now, sleep = wait.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const pollMs = wait.pollMs ?? 2000
  for (;;) {
    const committee = await sources.committee()
    for (const keeper of committee) {
      const served = await sources.keeperKey(keeper).catch(() => undefined)
      if (!served || !/^(0x)?[0-9a-f]{192}$/i.test(served)) continue
      const anchored = await waitForAnchoredKey(sources.readSlot, served, {...wait, pollMs: Math.min(pollMs, 500)})
      return {committee, publicKey: anchored.toLowerCase().replace(/^0x/, '')}
    }
    if (now() + pollMs > wait.deadlineMs) throw new Error('no committee keeper served the slot key before the deadline')
    await sleep(pollMs)
  }
}
