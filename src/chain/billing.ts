// Which billing a slot uses, read from the chain and never guessed.
//
// A legacy deployment (Settlement.version() == "1", e.g. tasra.fuji.v1) bills by usage
// metering; the keeper accepts unpaid committee operations. A prepaid deployment ("2", or "3"
// which adds only the payer's timeout escape) bills each operation from a reservation, and a slot is prepaid once `prepaidEnabled`
// is set: by its first `fund()` on a prepaid-from-genesis deployment, or by a cutover on
// an upgraded one. Nothing off-chain (keeper /v1/info, the network manifest) reports
// this, so the only source of truth is the Settlement contract.
//
// The detector answers `unknown` whenever it cannot read a consistent answer. Callers
// must treat `unknown` as "do not start": a paid flow against a legacy slot is refused by
// every service, and a legacy flow against a prepaid slot is refused by the keepers.

import {decodeFunctionResult, encodeFunctionData, parseAbi, type Abi, type Address, type Hex, type PublicClient} from 'viem'
import {TasraError} from '../errors.js'

/** Billing a slot uses; `unknown` means the chain could not be read consistently. */
export type BillingMode = 'legacy' | 'prepaid' | 'unknown'

/** One consistent observation of a slot's billing mode. */
export interface BillingModeObservation {
  /** Slot identifier. */
  slot: Hex
  /** Detected billing. `unknown` never authorizes either flow. */
  mode: BillingMode
  /** `Settlement.version()` when read. */
  settlementVersion?: string
  /** `prepaidEnabled(slot)` when read (prepaid versions "2" and "3" only). */
  prepaidEnabled?: boolean
  /** `prepaidFromGenesis()` when read (prepaid versions "2" and "3" only). */
  prepaidFromGenesis?: boolean
  /** Block every value was read at, when the read completed. */
  blockNumber?: bigint
  /** Hash of that block, rechecked after all reads. */
  blockHash?: Hex
  /** Why the mode is unknown; safe for logs (no response bodies). */
  reason?: string
}

/** Chain and Settlement proxy whose billing is detected; independently approved by the application. */
export interface BillingDeployment {
  /** Expected EVM chain ID. */
  chainId: number
  /** Expected Settlement proxy. */
  settlement: Address
}

/** A paid entry point was asked to act on a slot that is not (or not knowably) prepaid. */
export class BillingModeError extends TasraError {
  /** Slot the paid operation was refused for. */
  readonly slotId: Hex
  /** Detected mode: `legacy` (use the unpaid flow) or `unknown` (resolve the chain read first). */
  readonly mode: Exclude<BillingMode, 'prepaid'>
  /** Settlement implementation version, when read. */
  readonly settlementVersion?: string

  constructor(observation: BillingModeObservation & {mode: Exclude<BillingMode, 'prepaid'>}) {
    super(observation.mode === 'legacy'
      ? `Slot ${observation.slot} uses legacy (metered) billing on Settlement version ${observation.settlementVersion ?? '?'}; paid operations are unavailable, use the legacy flow`
      : `Billing mode of slot ${observation.slot} is unknown (${observation.reason ?? 'unreadable'}); no paid operation was started`,
    {retryable: observation.mode === 'unknown'})
    this.slotId = observation.slot
    this.mode = observation.mode
    if (observation.settlementVersion !== undefined) this.settlementVersion = observation.settlementVersion
  }
}

// Minimal fragments so the probe also reads a legacy (version 1) Settlement, whose ABI has no prepaid getters.
const probeAbi = parseAbi([
  'function version() view returns (string)',
  'function prepaidEnabled(bytes32 slot) view returns (bool)',
  'function prepaidFromGenesis() view returns (bool)',
])
/** Settlement versions with prepaid billing. "3" adds only the payer timeout escape. Any other version is unknown. */
const PREPAID_SETTLEMENT_VERSIONS: ReadonlySet<string> = new Set(['2', '3'])
const HEX32 = /^0x[0-9a-f]{64}$/i
const ADDRESS = /^0x[0-9a-f]{40}$/i

function validate(deployment: BillingDeployment, slot: Hex): void {
  if (!Number.isSafeInteger(deployment.chainId) || deployment.chainId <= 0
    || typeof deployment.settlement !== 'string' || !ADDRESS.test(deployment.settlement) || /^0x0{40}$/i.test(deployment.settlement)) throw new TasraError('Invalid billing deployment')
  if (typeof slot !== 'string' || !HEX32.test(slot)) throw new TasraError('Invalid billing slot')
}
function unknown(slot: Hex, reason: string, extra: Partial<BillingModeObservation> = {}): BillingModeObservation {
  return {...extra, slot, mode: 'unknown', reason}
}
function reasonOf(error: unknown): string {
  const text = error instanceof Error ? error.message.split('\n')[0] ?? '' : 'read failed'
  return text.slice(0, 160) || 'read failed'
}

/**
 * Read a slot's billing mode at one block: version "1" is legacy; version "2" or "3" (the
 * same prepaid billing plus the payer timeout escape) is prepaid when
 * `prepaidEnabled(slot)` or `prepaidFromGenesis()` holds (an unfunded slot on a prepaid-from-genesis
 * deployment becomes prepaid at its first funding, and legacy settlement refuses it), otherwise
 * legacy until cutover. Any other version, a failed read, a chain mismatch or a reorganized block
 * is `unknown`. Never throws for a chain failure; throws only for invalid arguments.
 * @param client Trusted RPC client for the independently selected deployment.
 * @param deployment Approved chain ID and Settlement proxy.
 * @param slot Slot whose billing is required.
 */
export async function readBillingMode(client: PublicClient, deployment: BillingDeployment, slot: Hex): Promise<BillingModeObservation> {
  const d = {chainId: deployment.chainId, settlement: deployment.settlement}
  validate(d, slot)
  let blockNumber: bigint, blockHash: Hex
  try {
    if (await client.getChainId() !== d.chainId) return unknown(slot, 'RPC chain mismatch')
    const block = await client.getBlock({blockTag: 'latest'})
    if (block.number === null || block.hash === null || !HEX32.test(block.hash)) return unknown(slot, 'canonical head unavailable')
    blockNumber = block.number; blockHash = block.hash
  } catch (error) { return unknown(slot, reasonOf(error)) }
  // EIP-1898 reads pinned to the observed block hash, like every other prepaid read.
  const read = async (functionName: 'version' | 'prepaidEnabled' | 'prepaidFromGenesis', args: readonly unknown[] = []): Promise<unknown> => {
    const data = encodeFunctionData({abi: probeAbi as Abi, functionName, args})
    const result = await client.call({to: d.settlement, data, blockHash, requireCanonical: true, batch: false})
    if (result.data === undefined || result.data === '0x') throw new Error(`empty ${functionName} response`)
    return decodeFunctionResult({abi: probeAbi as Abi, functionName, data: result.data})
  }
  const observed: Partial<BillingModeObservation> = {}
  let mode: BillingMode
  try {
    const version = await read('version')
    if (typeof version !== 'string' || version.length > 32) return unknown(slot, 'invalid Settlement version')
    observed.settlementVersion = version
    if (version === '1') mode = 'legacy'
    else if (PREPAID_SETTLEMENT_VERSIONS.has(version)) {
      const enabled = await read('prepaidEnabled', [slot])
      if (typeof enabled !== 'boolean') return unknown(slot, 'invalid prepaidEnabled', observed)
      observed.prepaidEnabled = enabled
      if (enabled) mode = 'prepaid'
      else {
        const genesis = await read('prepaidFromGenesis')
        if (typeof genesis !== 'boolean') return unknown(slot, 'invalid prepaidFromGenesis', observed)
        observed.prepaidFromGenesis = genesis
        mode = genesis ? 'prepaid' : 'legacy'
      }
    } else return unknown(slot, `unsupported Settlement version ${JSON.stringify(version)}`, observed)
    // Every value above was read at one block; refuse a mixture across a reorganization.
    const canonical = await client.getBlock({blockNumber})
    if (canonical.hash?.toLowerCase() !== blockHash.toLowerCase()) return unknown(slot, 'block reorganized during reads', observed)
  } catch (error) { return unknown(slot, reasonOf(error), observed) }
  return {...observed, slot, mode, blockNumber, blockHash}
}

/** Per-slot cached billing detection for one deployment. */
export interface BillingModeDetector {
  /** Current mode, from cache when fresh. `unknown` is never cached. */
  mode(slot: Hex): Promise<BillingModeObservation>
  /** Resolve the mode and return it only when prepaid; otherwise throw {@link BillingModeError}. */
  requirePrepaid(slot: Hex): Promise<BillingModeObservation>
  /** Forget one slot, or every slot, e.g. after an operator announces a Settlement upgrade. */
  invalidate(slot?: Hex): void
}

/**
 * Cache billing per slot for one deployment. Prepaid is one-way for a slot (`prepaidEnabled` is
 * never cleared), so it is cached until invalidated; legacy can become prepaid at a funding or
 * cutover, so it expires after `legacyTtlMs`. Concurrent lookups for a slot share one read.
 * @param client Trusted RPC client for the deployment.
 * @param deployment Approved chain ID and Settlement proxy.
 * @param options Legacy cache lifetime in ms (default 60000, 0 disables) and a clock for tests.
 */
export function createBillingModeDetector(client: PublicClient, deployment: BillingDeployment,
  options: {legacyTtlMs?: number; now?: () => number} = {}): BillingModeDetector {
  const d = {chainId: deployment.chainId, settlement: deployment.settlement}
  validate(d, `0x${'00'.repeat(32)}`)
  const ttl = options.legacyTtlMs ?? 60_000, now = options.now ?? Date.now
  if (!Number.isSafeInteger(ttl) || ttl < 0 || ttl > 86_400_000) throw new TasraError('Invalid billing cache lifetime')
  const cache = new Map<string, {value: BillingModeObservation; until: number}>()
  const inflight = new Map<string, Promise<BillingModeObservation>>()
  const mode = (slot: Hex): Promise<BillingModeObservation> => {
    validate(d, slot)
    const key = slot.toLowerCase(), hit = cache.get(key)
    if (hit && now() < hit.until) return Promise.resolve(structuredClone(hit.value))
    const running = inflight.get(key)
    if (running) return running.then(v => structuredClone(v))
    const read = readBillingMode(client, d, slot).then(value => {
      if (value.mode === 'prepaid') cache.set(key, {value, until: Number.POSITIVE_INFINITY})
      else if (value.mode === 'legacy' && ttl > 0) cache.set(key, {value, until: now() + ttl})
      else cache.delete(key)
      return value
    }).finally(() => inflight.delete(key))
    inflight.set(key, read)
    return read.then(v => structuredClone(v))
  }
  return Object.freeze({mode,
    async requirePrepaid(slot: Hex) {
      const observed = await mode(slot)
      if (observed.mode !== 'prepaid') throw new BillingModeError({...observed, mode: observed.mode})
      return observed
    },
    invalidate(slot?: Hex) { if (slot === undefined) cache.clear(); else cache.delete(String(slot).toLowerCase()) },
  })
}

/**
 * One-shot guard for a paid entry point: resolve the slot's mode and throw
 * {@link BillingModeError} unless it is prepaid.
 * @param client Trusted RPC client for the deployment.
 * @param deployment Approved chain ID and Settlement proxy.
 * @param slot Slot about to be charged.
 */
export async function requirePrepaidSlot(client: PublicClient, deployment: BillingDeployment, slot: Hex): Promise<BillingModeObservation> {
  const observed = await readBillingMode(client, deployment, slot)
  if (observed.mode !== 'prepaid') throw new BillingModeError({...observed, mode: observed.mode})
  return observed
}
