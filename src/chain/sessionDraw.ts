// Chain reads a session grant is judged by: the beacon's epochs and, for one slot at one epoch,
// the verifier draw (beacon seed, anchored verifier-set snapshot, the slot's committee policy).
// Everything here is read from the chain by the client; nothing is taken from a service.
//
// Each observation reads one head (the followed tip when a live head follower is attached, else an
// RPC `latest`) and pins every `eth_call` of the read to that block hash (EIP-1898).

import {decodeFunctionResult, encodeFunctionData, type Abi, type Address, type Hex, type PublicClient} from 'viem'
import {hexToBytes} from '../crypto/hex.js'
import type {VerifierSet} from '../committee/token.js'
import {keyRegistryAbi} from './abis/keyRegistry.js'
import {thresholdRandomBeaconAbi} from './abis/thresholdRandomBeacon.js'
import {verifierSetRegistryAbi} from './abis/verifierSetRegistry.js'
import {chainIdOf} from './chainId.js'
import {headFollowerOf} from './headFollower.js'
import {pinnedRegistryCall, type PinnedBlock} from './pinnedReads.js'
import {fetchDrawnVerifierWitnesses, type AnchoredVerifierDraw, type VerifierWitness} from './verifierSnapshot.js'

const ZERO32 = `0x${'00'.repeat(32)}`
const ADDRESS = /^0x[0-9a-f]{40}$/i
const HEX32 = /^0x[0-9a-f]{64}$/i
/** A head older than this (seconds) is not a current observation. */
const MAX_AGE = 30n
const FUTURE_SKEW = 2n

/** The beacon and verifier-set registry of a deployment, independently approved by the application. */
export interface BeaconDeployment {
  /** Deployment chain ID; the RPC's chain must equal it. */
  chainId: number
  /** ThresholdRandomBeacon address. */
  beacon: Address
  /** VerifierSetRegistry address. */
  verifierSet: Address
}

/** {@link BeaconDeployment} plus the KeyRegistry that holds each slot's verifier policy. */
export interface SessionDrawDeployment extends BeaconDeployment {
  /** KeyRegistry address. */
  keyRegistry: Address
}

function validate(d: BeaconDeployment & {keyRegistry?: Address}): void {
  if (!Number.isSafeInteger(d.chainId) || d.chainId <= 0) throw new Error('invalid deployment chain ID')
  for (const address of [d.beacon, d.verifierSet, ...(d.keyRegistry === undefined ? [] : [d.keyRegistry])]) {
    if (typeof address !== 'string' || !ADDRESS.test(address) || /^0x0{40}$/i.test(address)) throw new Error('invalid deployment address')
  }
}

function requireFresh(at: PinnedBlock): void {
  const now = BigInt(Math.floor(Date.now() / 1000))
  if (now - at.blockTimestamp > MAX_AGE || at.blockTimestamp - now > FUTURE_SKEW) throw new Error('chain observation is stale or future-dated')
}

/** One current head: the followed tip when live (unless `fresh`), else an RPC `latest` read. */
async function observe(client: PublicClient, d: BeaconDeployment, fresh: boolean): Promise<PinnedBlock> {
  validate(d)
  const tip = fresh ? undefined : headFollowerOf(client)?.tip()
  const [chain, head] = await Promise.allSettled([chainIdOf(client), tip ? Promise.resolve(undefined) : client.getBlock({blockTag: 'latest'})])
  if (chain.status === 'rejected') throw chain.reason
  if (chain.value !== d.chainId) throw new Error('RPC chain does not match the deployment')
  if (head.status === 'rejected') throw head.reason
  let at: PinnedBlock
  if (tip) at = {blockNumber: tip.blockNumber, blockHash: tip.blockHash, blockTimestamp: tip.blockTimestamp}
  else {
    const block = head.value!
    if (block.number === null || block.hash === null || !HEX32.test(block.hash) || block.hash === ZERO32 || block.timestamp < 0n) throw new Error('canonical head unavailable')
    at = {blockNumber: block.number, blockHash: block.hash, blockTimestamp: block.timestamp}
  }
  requireFresh(at)
  return at
}

async function read(client: PublicClient, at: PinnedBlock, address: Address, abi: Abi, name: string, args: readonly unknown[] = []): Promise<unknown> {
  const data = encodeFunctionData({abi, functionName: name, args})
  const result = await pinnedRegistryCall(client, at, address, data, false)
  if (result === undefined) throw new Error(`empty registry ${name} response`)
  return decodeFunctionResult({abi, functionName: name, data: result})
}

/**
 * The beacon's current epoch at a fresh observed head (the followed tip when live, else `latest`),
 * through a block-pinned read. Performs no transaction.
 * @param client - Trusted bounded Viem RPC client for the selected deployment.
 * @param deployment - Independently approved chain and contract addresses, the beacon included.
 * @param options - `fresh`: read at an RPC `latest` head of its own, never a followed tip. For a
 *   decision a tip lagging the chain would get wrong (confirming that a grant left the window: a
 *   keeper judged it at a newer head).
 */
export async function readCurrentBeaconEpoch(client: PublicClient, deployment: BeaconDeployment, options: {fresh?: boolean} = {}): Promise<bigint> {
  deployment = {...deployment}
  const at = await observe(client, deployment, options.fresh === true)
  const epoch = await read(client, at, deployment.beacon, thresholdRandomBeaconAbi, 'epoch')
  if (typeof epoch !== 'bigint' || epoch < 0n) throw new Error('invalid beacon epoch')
  return epoch
}

/** The beacon's latest epoch and the newest epoch a session grant can be drawn on now. */
export interface BeaconDrawState {
  /** The beacon's latest epoch. */
  latest: bigint
  /**
   * `latest` once its verifier-set snapshot is anchored, else `latest - 1` when that one is, else
   * absent: the epoch the verifier-agent draws a new grant (or a session continuation) on, as the
   * agent picks it (`pick_draw_epoch`). A refresh before it moves past a grant's epoch can only
   * re-sign the grant on its own epoch.
   */
  draw?: bigint
}

/**
 * The beacon's latest epoch and its draw epoch ({@link BeaconDrawState}) at ONE fresh observed head
 * (the followed tip when live, else `latest`), through block-pinned reads. The previous epoch's
 * snapshot is read only while the latest one is not anchored. Performs no transaction.
 * @param client - Trusted bounded Viem RPC client for the selected deployment.
 * @param deployment - Independently approved chain and contract addresses, the beacon and verifier set included.
 */
export async function readBeaconDrawState(client: PublicClient, deployment: BeaconDeployment): Promise<BeaconDrawState> {
  deployment = {...deployment}
  const at = await observe(client, deployment, false)
  const latest = await read(client, at, deployment.beacon, thresholdRandomBeaconAbi, 'epoch')
  if (typeof latest !== 'bigint' || latest < 0n) throw new Error('invalid beacon epoch')
  const anchored = async (epoch: bigint) => {
    const [root, size] = await read(client, at, deployment.verifierSet, verifierSetRegistryAbi, 'snapshotAt', [epoch]) as readonly [Hex, number]
    return typeof root === 'string' && HEX32.test(root) && root.toLowerCase() !== ZERO32 && size > 0
  }
  if (await anchored(latest)) return {latest, draw: latest}
  if (latest > 0n && await anchored(latest - 1n)) return {latest, draw: latest - 1n}
  return {latest}
}

/** Options of {@link readSlotVerifierDraw}. */
export interface SlotVerifierDrawOptions {
  /**
   * The deployment's default verifier committee policy, used when the slot names none on chain
   * (`verifierPolicy(slot)` = 0/0). It must be the policy the deployment's verifier-agent and
   * keepers are configured with; without it such a slot is refused.
   */
  defaultVerificationPolicy?: {committee: number; quorum: number}
}

/**
 * One slot's verifier draw at `epoch`, read at ONE fresh observed head: the beacon seed and the
 * anchored verifier-set snapshot of that epoch, and the slot's committee policy. The epoch must be
 * the beacon's latest or previous one (no keeper or verifier admits another) with its seed and
 * snapshot anchored, and the registries must point at this beacon. Performs no transaction.
 * @param client - Trusted bounded Viem RPC client for the selected deployment.
 * @param deployment - Independently approved chain and contract addresses.
 * @param slot - 32-byte slot ID.
 * @param epoch - The grant's (or token's) draw epoch.
 * @param options - The deployment's default verifier policy.
 */
export async function readSlotVerifierDraw(client: PublicClient, deployment: SessionDrawDeployment, slot: Hex, epoch: bigint,
  options: SlotVerifierDrawOptions = {}): Promise<AnchoredVerifierDraw> {
  deployment = {...deployment}
  const fallback = options.defaultVerificationPolicy && {...options.defaultVerificationPolicy}
  if (typeof slot !== 'string' || !HEX32.test(slot) || typeof epoch !== 'bigint' || epoch < 0n || epoch > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('invalid slot or draw epoch')
  validate(deployment)
  const at = await observe(client, deployment, false)
  const [keyBeacon, snapshotBeacon, latest, policy, seed, snapshot] = await Promise.all([
    read(client, at, deployment.keyRegistry, keyRegistryAbi, 'randomBeacon') as Promise<Address>,
    read(client, at, deployment.verifierSet, verifierSetRegistryAbi, 'beacon') as Promise<Address>,
    read(client, at, deployment.beacon, thresholdRandomBeaconAbi, 'epoch') as Promise<bigint>,
    read(client, at, deployment.keyRegistry, keyRegistryAbi, 'verifierPolicy', [slot]) as Promise<readonly [number, number]>,
    read(client, at, deployment.beacon, thresholdRandomBeaconAbi, 'seedAt', [epoch]) as Promise<Hex>,
    read(client, at, deployment.verifierSet, verifierSetRegistryAbi, 'snapshotAt', [epoch]) as Promise<readonly [Hex, number]>,
  ])
  if ([keyBeacon, snapshotBeacon].some(pointer => pointer.toLowerCase() !== deployment.beacon.toLowerCase())) throw new Error('registry beacon pointers differ from the deployment')
  if (typeof latest !== 'bigint' || (epoch !== latest && epoch + 1n !== latest)) throw new Error(`draw epoch ${epoch} is not the beacon's latest or previous epoch (${String(latest)})`)
  const [root, size] = snapshot
  if (typeof seed !== 'string' || !HEX32.test(seed) || seed.toLowerCase() === ZERO32 || typeof root !== 'string' || !HEX32.test(root) || root.toLowerCase() === ZERO32
    || !Number.isSafeInteger(size) || size <= 0) throw new Error(`draw epoch ${epoch} has no anchored seed and verifier snapshot`)
  const [onChainCommittee, onChainQuorum] = policy
  if (onChainCommittee === 0 && onChainQuorum !== 0) throw new Error('invalid on-chain verifier policy')
  const approved = onChainCommittee === 0 ? fallback : {committee: onChainCommittee, quorum: onChainQuorum}
  if (!approved || !Number.isInteger(approved.committee) || !Number.isInteger(approved.quorum) || approved.quorum <= 0 || approved.quorum > approved.committee
    || approved.committee > 4096 || approved.committee > size) throw new Error('missing or invalid verifier policy for the slot (supply defaultVerificationPolicy for a slot without its own)')
  return {chain_id: deployment.chainId, slot: slot.toLowerCase() as Hex, verification_epoch: Number(epoch), verification_seed: seed.toLowerCase() as Hex,
    verification_root: root.toLowerCase() as Hex, verification_registry_size: size, verification_committee: approved.committee, verification_quorum: approved.quorum}
}

/** A drawn verifier's membership proof on the wire, as keepers take it (`verifier_proofs`). */
export interface VerifierProofWire {
  /** Index in the epoch's snapshot. */
  verifier_index: number
  /** Operator address, bare hex. */
  operator: string
  /** Ed25519 committee key, bare hex. */
  pubkey: string
  /** Sibling hashes, bare hex. */
  proof: string[]
}

/** What a client needs to verify a slot's grant and to send it to keepers. */
export interface SlotDrawTrust {
  /** The anchored draw the material was built from. */
  draw: AnchoredVerifierDraw
  /** The epoch's whole verifier set (every key authenticated against the anchored root), by snapshot index, with its size. */
  set: VerifierSet
  /** The slot's committee size. */
  committee: number
  /** Signatures required. */
  quorum: number
  /** `beacon.seedAt(epoch)`. */
  seed: Uint8Array
  /** The drawn verifiers with their anchored membership proofs. */
  witnesses: VerifierWitness[]
  /** The same witnesses in the keeper wire form. */
  verifierProofs: VerifierProofWire[]
}

/** Configuration of {@link createSlotDrawReader}. */
export interface SlotDrawReaderConfig extends SlotVerifierDrawOptions {
  /** Trusted bounded Viem RPC client for the selected deployment. */
  client: PublicClient
  /** Independently approved chain and contract addresses. */
  deployment: SessionDrawDeployment
  /**
   * Independently approved accountant origins that serve the verifier-set snapshot artifacts
   * (`GET /v1/verifier-set/{epoch}`), in preference order (e.g. `resolveAccountantUrls`). A host
   * supplies only leaves: every artifact is verified against the root anchored on chain.
   */
  snapshotHosts: readonly string[]
  /** Fetch implementation for the artifact reads (default global fetch). */
  fetch?: typeof fetch
  /** How long a freshly anchored epoch's artifact may take to be published, ms (default 15000, at most 150000). */
  waitForPublicationMs?: number
}

/** Most (slot, epoch) draws kept by one reader; the oldest is dropped first. */
const MAX_KEPT_DRAWS = 64

/**
 * A reader of slot draws for session grants: for `(slot, epoch)` it reads the anchored draw from
 * the chain, fetches the epoch's verifier snapshot from an approved accountant, verifies every
 * leaf against the anchored root and returns the drawn verifiers' keys and membership proofs.
 * A verified result is kept per `(slot, epoch)` (an anchored epoch never changes); a failure is
 * never kept.
 * @param config - Chain client, deployment, snapshot hosts and the default verifier policy.
 */
export function createSlotDrawReader(config: SlotDrawReaderConfig): (slot: Hex, epoch: bigint, signal?: AbortSignal) => Promise<SlotDrawTrust> {
  const {client, fetch: doFetch} = config
  const deployment = {...config.deployment}, hosts = [...config.snapshotHosts]
  const fallback = config.defaultVerificationPolicy && {...config.defaultVerificationPolicy}
  const waitForPublicationMs = config.waitForPublicationMs ?? 15_000
  validate(deployment)
  if (!hosts.length || hosts.length > 16) throw new Error('1..16 verifier snapshot hosts are required')
  const kept = new Map<string, SlotDrawTrust>()
  const pending = new Map<string, Promise<SlotDrawTrust>>()
  const copy = (t: SlotDrawTrust): SlotDrawTrust => ({draw: {...t.draw}, set: {registrySize: t.set.registrySize, pubkeys: new Map([...t.set.pubkeys].map(([i, k]) => [i, k.slice()]))},
    committee: t.committee, quorum: t.quorum, seed: t.seed.slice(), witnesses: structuredClone(t.witnesses), verifierProofs: structuredClone(t.verifierProofs)})
  return async (slot, epoch, signal) => {
    if (typeof slot !== 'string' || !HEX32.test(slot) || typeof epoch !== 'bigint') throw new Error('invalid slot or draw epoch')
    const key = `${slot.toLowerCase()}|${epoch}`
    const found = kept.get(key)
    if (found) return copy(found)
    let running = pending.get(key)
    if (!running) {
      running = (async () => {
        const draw = await readSlotVerifierDraw(client, deployment, slot, epoch, fallback ? {defaultVerificationPolicy: fallback} : {})
        signal?.throwIfAborted()
        const {witnesses, artifact} = await fetchDrawnVerifierWitnesses(hosts, draw, deployment.verifierSet, {waitForPublicationMs, ...(doFetch ? {fetch: doFetch} : {}), ...(signal ? {signal} : {})})
        const bare = (h: string) => h.replace(/^0x/, '')
        // Every leaf of the artifact was verified against the anchored root: the whole epoch set is
        // authenticated, so a grant's signatures from other slots' draws verify strictly too.
        const entries = (artifact as {entries: {index: number; pubkey: string}[]}).entries
        const trust: SlotDrawTrust = {draw, set: {registrySize: draw.verification_registry_size, pubkeys: new Map(entries.map(e => [e.index, hexToBytes(e.pubkey)]))},
          committee: draw.verification_committee, quorum: draw.verification_quorum, seed: hexToBytes(draw.verification_seed), witnesses,
          verifierProofs: witnesses.map(w => ({verifier_index: w.index, operator: bare(w.operator), pubkey: bare(w.publicKey), proof: w.proof.map(bare)}))}
        if (kept.size >= MAX_KEPT_DRAWS) kept.delete(kept.keys().next().value!)
        kept.set(key, trust)
        return trust
      })()
      pending.set(key, running)
      const clear = () => { if (pending.get(key) === running) pending.delete(key) }
      running.then(clear, clear)
    }
    return copy(await running)
  }
}

