// Event registry + decoding. The explorer's indexer fetches logs per contract
// address and decodes them against that contract's ABI into a normalized
// `DecodedEvent`, tagged with a coarse category for the global feed and the
// per-domain views.

import {parseEventLogs, type Log} from 'viem'
import {CONTRACT_ABIS, type ContractName} from './abis/index.js'
import type {Address} from './deployments.js'

/**
 * Display category assigned to decoded contract events.
 */
export type EventCategory =
  | 'node'
  | 'slot'
  | 'slashing'
  | 'tasra'
  | 'settlement'
  | 'beacon'
  | 'governance'

/** Default category per contract (the global event feed groups by this). */
export const CONTRACT_CATEGORY: Record<ContractName, EventCategory> = {
  NodeRegistry: 'node',
  KeyRegistry: 'slot',
  ServiceRegistry: 'governance',
  Settlement: 'settlement',
  TasraToken: 'tasra',
  BondingCurve: 'tasra',
  Treasury: 'tasra',
  TasraVestingVault: 'tasra',
  ThresholdRandomBeacon: 'beacon',
  PrevrandaoSaltBeacon: 'beacon',
  EquivocationSlasher: 'slashing',
  // The merged slashing hub, which also anchors liveness.
  AccountantSlashing: 'slashing',
  LivenessRegistry: 'node',
  PlatformExecutor: 'governance',
  FixedTasraPriceOracle: 'tasra',
  MockEurc: 'tasra',
  TasraSwapRouter: 'tasra',
  // Per-request verifier-committee set anchoring.
  VerifierSetRegistry: 'governance',
  // Per-(slot,epoch) keeper verifying-share root anchor - feeds
  // participant-weighted settlement (pay proven signers).
  KeeperShareRegistry: 'settlement',
  // Per-epoch snapshot of the accountant set. Structurally a twin of
  // VerifierSetRegistry, but categorised with settlement rather than
  // governance: what it anchors is who held a settle shard at epoch E, which
  // is what the wrong-bundle witness reads before slashing a settlement.
  AccountantSetRegistry: 'settlement',
}

// A few events live on a "node" contract but are conceptually slashing - the
// Slashing Center surfaces them alongside the dedicated oracle verdicts.
const EVENT_CATEGORY_OVERRIDES: Record<string, EventCategory> = {
  'NodeRegistry.Slashed': 'slashing',
  'NodeRegistry.BountyPaid': 'slashing',
  'NodeRegistry.StakeRestored': 'slashing',
  // Paid only when a slash is proven wrong, so it belongs to the accountability
  // story next to the reversal, not to routine operator lifecycle.
  'NodeRegistry.Compensated': 'slashing',
}

/**
 * Choose the event category, including event-specific overrides for a contract.
 * @param contract Contract that emitted the event.
 * @param eventName Decoded event name used for category overrides.
 */
export function categoryFor(
  contract: ContractName,
  eventName: string,
): EventCategory {
  return (
    EVENT_CATEGORY_OVERRIDES[`${contract}.${eventName}`] ??
    CONTRACT_CATEGORY[contract]
  )
}

/**
 * The set of event names declared by a contract's ABI.
 * @param contract Contract whose vendored ABI supplies the event definitions.
 */
export function eventNamesOf(contract: ContractName): string[] {
  return (CONTRACT_ABIS[contract] as readonly {type: string; name?: string}[])
    .filter(i => i.type === 'event' && i.name)
    .map(i => i.name as string)
}

/** A normalized, storage-ready decoded log. */
export interface DecodedEvent {
  /** Display category derived from the contract and event name. */
  category: EventCategory
  /** Contract ABI used to decode this event. */
  contract: ContractName
  /** Contract address that emitted the log. */
  address: Address
  /** Decoded event name from the contract ABI. */
  eventName: string
  /** Decoded args (bigints preserved; use `jsonSafe` before persisting). */
  args: Record<string, unknown>
  /** Block containing the log. */
  blockNumber: bigint
  /** Block hash reported by the RPC, or null when unavailable. */
  blockHash: string | null
  /** Hash of the transaction that emitted the log. */
  txHash: string
  /** Transaction position within the block, or null when unavailable. */
  txIndex: number | null
  /** Log position within the block. */
  logIndex: number
}

function argsToRecord(args: unknown): Record<string, unknown> {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    return args as Record<string, unknown>
  }
  if (Array.isArray(args)) {
    return Object.fromEntries(args.map((v, i) => [String(i), v]))
  }
  return {}
}

/**
 * Decode raw logs (already filtered to `address`) against `contract`'s ABI.
 * Non-matching / anonymous logs are skipped. `strict:false` tolerates logs
 * whose indexed topics can't be fully decoded.
 * @param contract Contract ABI used to decode each log.
 * @param address Deployed emitting contract address.
 * @param logs Raw logs carrying topics, data and optional block metadata.
 */
export function decodeContractLogs(
  contract: ContractName,
  address: Address,
  logs: Log[],
): DecodedEvent[] {
  const parsed = parseEventLogs({
    abi: CONTRACT_ABIS[contract] as readonly unknown[],
    logs,
    strict: false,
  })
  const out: DecodedEvent[] = []
  for (const p of parsed as Array<
    Log & {eventName?: string; args?: unknown}
  >) {
    if (!p.eventName) continue
    out.push({
      category: categoryFor(contract, p.eventName),
      contract,
      address,
      eventName: p.eventName,
      args: argsToRecord(p.args),
      blockNumber: p.blockNumber ?? 0n,
      blockHash: p.blockHash ?? null,
      txHash: p.transactionHash ?? '0x',
      txIndex: p.transactionIndex ?? null,
      logIndex: p.logIndex ?? 0,
    })
  }
  return out
}

/**
 * Recursively convert bigints to strings so a decoded event can be JSON
 * serialized / stored. Leaves everything else intact.
 * @param value Value to convert recursively, including bigint and byte arrays.
 */
export function jsonSafe<T>(value: T): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(jsonSafe)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        jsonSafe(v),
      ]),
    )
  }
  return value
}
