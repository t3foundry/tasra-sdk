// Slot-driven ON-CHAIN DISCOVERY - turn a bare slot id into everything the
// committee-authorization flow needs, read straight from the registry:
//
//   - resolveSlotKeeperUrls   - the slot's assigned keeper nodes to their HTTP URLs
//                               (KeyRegistry.assignedNodes to NodeRegistry.nodeOf().url)
//   - resolveVerifierDirectory - the active verifier set to {index,url,operator,pubkey}
//                               (NodeRegistry operators tagged keccak256("verifier"))
//   - resolveSlotGroupKey     - the slot's group public key + epoch, for local encrypt
//                               (KeyRegistry.getKeySlot - no node/verifier round-trip)
//
// A slot is "equipped with" its keeper committee at creation (drawn on-chain, URLs on
// chain), but not with a fixed verifier set: it carries only a verifierPolicy(committee,
// quorum), and the actual committee is drawn per-request from the *global* verifier set
// by the beacon. So node discovery is per-slot; verifier discovery is network-wide.
//
// Lives in the `tasra-sdk/chain` subpath (viem). The resolved directory feeds the
// pure committee primitives in ../committee (which take injected chain reads).

import {keccak256, toHex, type Address} from 'viem'
import type {TasraChainClient} from './client.js'
import type {CommitteeVerifier} from '../committee/request.js'

/**
 * The on-chain role tag verifier operators register under: `keccak256("verifier")`.
 * The same tag the accountants use to build the settlement split, and the CLI to
 * resolve a tagged operator set.
 */
export const VERIFIER_TAG: `0x${string}` = keccak256(toHex('verifier'))

/** The `NodeRegistry.nodeOf` struct shape (the fields we use). */
interface OnchainNode {
  operator: Address
  dns: string
  url: string
  p2pAddr: string
  pubkey: `0x${string}`
  active: boolean
}

/**
 * The slot's assigned keeper nodes, resolved to their HTTP base URLs. These are the
 * nodes any `/v1/committee/{sign,decrypt}` request for this slot must target. Order
 * follows `assignedNodes`; url-less operators are skipped.
 * @param chain Reader configured from the approved network manifest.
 * @param slotId Slot whose assigned keeper endpoints are required.
 */
export async function resolveSlotKeeperUrls(
  chain: TasraChainClient,
  slotId: `0x${string}`,
): Promise<string[]> {
  const ops = (await chain.readers.keyRegistry.assignedNodes(slotId)) as readonly Address[]
  // `allowFailure: false` - an unreadable operator must fail the call, not silently
  // shrink the committee. A quietly short node list looks like a smaller slot.
  const nodes = (await chain.readMany(
    'NodeRegistry',
    'nodeOf',
    ops.map(op => [op]),
    {allowFailure: false},
  )) as unknown as OnchainNode[]
  return nodes.map(n => n.url).filter((u): u is string => !!u)
}

/**
 * Read active verifier records in ascending operator-address order. Stable indices must match the anchored verifier snapshot; unreadable records reject discovery rather than silently renumbering the committee.
 * @param chain Reader for the deployment registry.
 * @returns Verifier endpoints, public keys and snapshot indices.
 */
export async function resolveVerifierDirectory(
  chain: TasraChainClient,
): Promise<CommitteeVerifier[]> {
  const ops = (await chain.readers.nodeRegistry.activeOperators()) as readonly Address[]
  // `allowFailure: false` on both reads below is load-bearing, not caution. `index` is
  // the position in this list, and the anchored snapshot's leaves are built from the same
  // order - so one dropped operator renumbers every operator after it and the committee
  // flow's inclusion proofs are built against the wrong leaves. A short list must be an
  // error, never a different-but-plausible directory.
  const flags = (await chain.readMany(
    'NodeRegistry',
    'hasTag',
    ops.map(op => [op, VERIFIER_TAG]),
    {allowFailure: false},
  )) as boolean[]
  // Ascending address = numeric order on fixed-width lowercase hex, which is what a
  // byte-wise sort over the 20-byte addresses gives. Plain `<` on lowercased hex, not
  // localeCompare (whose collation could disagree with byte order).
  const lower = (a: Address) => a.toLowerCase()
  const verifierOps = ops
    .filter((_, i) => flags[i])
    .slice()
    .sort((a, b) => (lower(a) < lower(b) ? -1 : lower(a) > lower(b) ? 1 : 0))

  const nodes = (await chain.readMany(
    'NodeRegistry',
    'nodeOf',
    verifierOps.map(op => [op]),
    {allowFailure: false},
  )) as unknown as OnchainNode[]

  return verifierOps.map((operator, index) => ({
    index,
    url: nodes[index]!.url,
    operator,
    pubkey: nodes[index]!.pubkey,
  }))
}

/** The slot's on-chain group public key + epoch (and mode), for local envelope encrypt. */
export interface SlotGroupKey {
  /** 0x-prefixed group public key (96-byte compressed G2 for a BLS slot). */
  publicKey: `0x${string}`
  /** Slot key epoch associated with the returned group public key. */
  epoch: number
  /** 0 = frost, 1 = bls (KeyRegistry.Mode). Encrypt applies to BLS slots. */
  mode: number
}

/**
 * Read the slot's group public key + epoch straight from `KeyRegistry.getKeySlot` - so
 * `encrypt` needs no verifier, no JWT, and no node round-trip (it's local + offline once
 * you hold the key).
 * @param chain Reader for the deployment owning the slot.
 * @param slotId Slot whose anchored public key and epoch are required.
 */
export async function resolveSlotGroupKey(
  chain: TasraChainClient,
  slotId: `0x${string}`,
): Promise<SlotGroupKey> {
  const s = (await chain.readers.keyRegistry.getKeySlot(slotId)) as unknown as {
    publicKey: `0x${string}`
    epoch: bigint | number
    mode: number
  }
  return {publicKey: s.publicKey, epoch: Number(s.epoch), mode: Number(s.mode)}
}

/**
 * The on-chain role tag accountant operators register under: `keccak256("accountant")`.
 * The same tag the accountants themselves resolve their set with.
 */
export const ACCOUNTANT_TAG: `0x${string}` = keccak256(toHex('accountant'))

/**
 * Read active accountant HTTP endpoints through the registry role index, preserving registry order.
 * @param chain Reader for the registry containing accountant role registrations.
 */
export async function resolveAccountantUrls(chain: TasraChainClient): Promise<string[]> {
  const PAGE = 256n
  const urls: string[] = []
  for (let offset = 0n; ; ) {
    const [page, total] = (await chain.read('NodeRegistry', 'taggedActiveOperatorsPage', [
      ACCOUNTANT_TAG,
      offset,
      PAGE,
    ])) as [readonly {url: string}[], bigint]
    if (!page.length) break
    offset += BigInt(page.length)
    for (const v of page) if (v.url) urls.push(v.url)
    if (offset >= total) break
  }
  return urls
}
