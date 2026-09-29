// Slot-driven managed JWT client. Same ergonomics as `createTasraClient`, but you
// bring a slot id + a chain client instead of hardcoding `{nodes, verifier}`:
//
//   - the keeper NODES come from the slot's on-chain committee (assignedNodes to nodeOf().url)
//   - the VERIFIER is CHOSEN from the on-chain verifier set (NodeRegistry operators tagged
//     keccak256("verifier")) at random - that verifier validates your VP and issues the JWT
//   - the JWT then authorizes the operation at a keeper node
//
// So the verifier is part of every session: `openSession` picks one from chain,
// and the returned session's JWT was minted by it. This composes the existing verifier-auth
// + session machinery (src/client) with chain discovery (src/chain/discovery) - no new
// crypto, just endpoint resolution moved from static config to the registry.

import type {TasraChainClient} from './client.js'
import {resolveSlotKeeperUrls, resolveVerifierDirectory} from './discovery.js'
import {
  createTasraClient,
  type SessionAuth,
  type OpenSessionOpts,
  type Session,
} from '../client/index.js'
import type {CommitteeVerifier} from '../committee/request.js'

/** How the session's endpoints were resolved from chain - surfaced so callers can see
 *  which verifier was chosen and which keeper committee the slot is bound to. */
export interface ResolvedEndpoints {
  /** Slot identifier used to resolve the assigned service endpoints. */
  slotId: string
  /** The slot's on-chain assigned keeper node URLs. */
  nodes: string[]
  /** The verifier chosen (at random) from the on-chain set - it issued the JWT. */
  verifier: string
  /** Size of the on-chain verifier set the choice was drawn from. */
  verifierCount: number
}

/**
 * Chain discovery and authorization options for a managed JWT slot session.
 */
export interface TasraSlotClientConfig {
  /** Read client for the deployment (RPC + address book). */
  chain: TasraChainClient
  /** This holder's DID (recipient_did / holder for the JWT). */
  identity?: string
  /**
   * Explicit routing from registered service URLs to reachable URLs. Omission uses registry URLs unchanged.
   */
  rewriteUrl?: (url: string) => string
  /** Observe the per-session resolution (chosen verifier + discovered nodes). */
  onResolve?: (r: ResolvedEndpoints) => void
  /** JWT refresh skew (ms), forwarded to the session. */
  skewMs?: number
}

/**
 * Managed slot-session factory that resolves keeper and verifier endpoints from the registry.
 */
export interface TasraSlotClient {
  /** Discover the slot's nodes + choose a verifier from chain, mint the JWT via that
   *  verifier, and return a managed session (encrypt / decrypt / sign). */
  openSession(slotId: string, auth: SessionAuth, opts?: OpenSessionOpts): Promise<Session>
  /** Resolve the endpoints for a slot WITHOUT opening a session (which verifier would be
   *  chosen + the slot's keeper committee). Handy for inspection. */
  resolveEndpoints(slotId: string): Promise<ResolvedEndpoints>
  /** The discovered active verifier directory (cached). */
  verifierDirectory(): Promise<CommitteeVerifier[]>
  /** Return currently open managed sessions. */
  sessions(): readonly Session[]
  /** Close all managed sessions and clear their reconstructed key material. */
  closeAll(): Promise<void>
}

/**
 * Create managed JWT sessions using keeper endpoints and a randomly selected verifier discovered from the chain. The verifier authenticates the holder and issues the session token. Session key operations may reconstruct private key material in the client; use threshold committee operations when that custody model is unsuitable.
 * @param cfg Chain reader, holder identity and optional endpoint routing or discovery callback.
 * @returns Client that opens and tracks managed slot sessions.
 */
export function createTasraSlotClient(cfg: TasraSlotClientConfig): TasraSlotClient {
  const rewrite = cfg.rewriteUrl ?? ((u: string) => u)
  const open = new Set<Session>()

  // The verifier set is network-wide (not per-slot), so discover it once and cache.
  let verifiersPromise: Promise<CommitteeVerifier[]> | undefined
  const verifierDirectory = () => (verifiersPromise ??= resolveVerifierDirectory(cfg.chain))

  async function resolveEndpoints(slotId: string): Promise<ResolvedEndpoints> {
    const [nodesRaw, dir] = await Promise.all([
      resolveSlotKeeperUrls(cfg.chain, slotId as `0x${string}`),
      verifierDirectory(),
    ])
    const nodes = nodesRaw.map(rewrite).filter(Boolean)
    if (nodes.length === 0) throw new Error(`slot ${slotId.slice(0, 10)}… has no on-chain assigned keeper node with a URL`)
    const verifiers = dir.map(v => rewrite(v.url)).filter(Boolean)
    if (verifiers.length === 0) throw new Error('no verifiers discovered on chain (NodeRegistry has no active keccak256("verifier")-tagged node with a URL)')
    // Choose the verifier at random - the SDK "queries the chain and picks the verifier".
    const verifier = verifiers[Math.floor(Math.random() * verifiers.length)]!
    return {slotId, nodes, verifier, verifierCount: verifiers.length}
  }

  return {
    resolveEndpoints,
    verifierDirectory,

    async openSession(slotId, auth, opts) {
      const resolved = await resolveEndpoints(slotId)
      cfg.onResolve?.(resolved)
      // Compose the existing managed JWT client with the chain-resolved endpoints. The
      // chosen verifier mints the JWT (openSession to resolveAuth to verify against it).
      const inner = createTasraClient({nodes: resolved.nodes, verifier: resolved.verifier, identity: cfg.identity})
      const session = await inner.openSession(slotId, auth, {skewMs: cfg.skewMs, ...opts})
      open.add(session)
      return session
    },

    sessions() {
      return [...open]
    },
    async closeAll() {
      await Promise.all([...open].map(s => s.close()))
      open.clear()
    },
  }
}
