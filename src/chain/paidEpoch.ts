import {decodeFunctionResult, encodeFunctionData, type Address, type Hex, type PublicClient} from 'viem'
import {TasraError} from '../errors.js'
import {headFollowerOf} from './headFollower.js'
import {thresholdRandomBeaconAbi} from './abis/thresholdRandomBeacon.js'

/**
 * D8 (2026-10-09): a paid verification epoch is admissible iff it was current or previous at
 * the reservation's stored quote block (`Settlement.prepaidAssignmentBlock`), the window the
 * accountant quorum enforced when it signed the reservation. Mirrors Rust
 * `keykeeper_eth::paid_epoch` in its constants and decisions; keep the two in step.
 * An unpaid draw is not judged here: it keeps the live `{latest, latest - 1}` window.
 */

/** Longest a creator's payment intent may live (`expires - now`). Rust `PAYMENT_INTENT_MAX_LIFETIME_SECS`. */
export const PAYMENT_INTENT_MAX_LIFETIME_SECS = 3600n
/** Oldest quote block a reservation signer approves over. Rust `RESERVATION_QUOTE_MAX_AGE_SECS`. */
export const RESERVATION_QUOTE_MAX_AGE_SECS = 30n
/**
 * Signed submission window (`deadline = min(quote_ts + this, expires)`), enforced by the signers
 * and `Settlement` only; not derivable from the assignment block and not re-proved here.
 * Rust `RESERVATION_SUBMISSION_WINDOW_SECS`.
 */
export const RESERVATION_SUBMISSION_WINDOW_SECS = 120n
/** How far a fresh observation's block time may lead the consumer clock. Rust `OBSERVATION_MAX_FUTURE_SKEW_SECS`. */
export const OBSERVATION_MAX_FUTURE_SKEW_SECS = 2n
/**
 * Upper bound on (observation time - quote block time) for using a purchased assignment (3632 s).
 * Derived, not chosen; it bounds use, not quote signing or mining freshness. Rust `MAX_ASSIGNMENT_AGE_SECS`.
 */
export const MAX_ASSIGNMENT_AGE_SECS = PAYMENT_INTENT_MAX_LIFETIME_SECS + RESERVATION_QUOTE_MAX_AGE_SECS + OBSERVATION_MAX_FUTURE_SKEW_SECS

const ZERO32 = `0x${'0'.repeat(64)}`
const HEX32 = /^0x[0-9a-f]{64}$/i
const ADDRESS = /^0x[0-9a-f]{40}$/i

/** Stable paid-epoch failure codes. */
export type PaidEpochCode = 'paid_epoch_unavailable' | 'paid_epoch_refused'

/**
 * A paid epoch could not be admitted. `paid_epoch_unavailable` (retryable): the quote block or
 * its historical state could not be read (unknown block, pruned state, RPC failure); it is never
 * an admission and never falls back to the live head. `paid_epoch_refused` (not retryable): a
 * definite answer about the payment (a reorganised or substituted quote block, or an epoch
 * outside the quote block's `{E_a, E_a - 1}`).
 */
export class PaidEpochError extends TasraError {
  /** Stable failure code. */
  readonly code: PaidEpochCode

  constructor(code: PaidEpochCode, message: string, cause?: unknown) {
    super(message, {retryable: code === 'paid_epoch_unavailable', cause})
    this.code = code
  }
}

const refuse = (message: string): PaidEpochError => new PaidEpochError('paid_epoch_refused', message)
const unavailable = (message: string, cause?: unknown): PaidEpochError => new PaidEpochError('paid_epoch_unavailable', message, cause)

/** One canonical beacon read at a reservation's assignment (quote) block. */
export interface AssignmentEpoch {
  blockHash: Hex
  blockNumber: bigint
  blockTimestamp: bigint
  beaconEpoch: bigint
}

/** The consumer's own fresh observation of the mined reservation. */
export interface PaidEpochObservation {
  assignmentBlock: Hex
  blockNumber: bigint
  blockTimestamp: bigint
}

/** Throws a definite {@link PaidEpochError} unless `verificationEpoch` was current or previous at the receipt's quote block. */
export function requirePaidEpoch(verificationEpoch: bigint, receipt: PaidEpochObservation, anchor: AssignmentEpoch, headEpoch: bigint): void {
  if (receipt.assignmentBlock.toLowerCase() === ZERO32) throw refuse('paid epoch has no on-chain assignment block')
  if (anchor.blockHash.toLowerCase() !== receipt.assignmentBlock.toLowerCase()) throw refuse("paid epoch anchor is not the reservation's assignment block")
  if (anchor.blockNumber > receipt.blockNumber || anchor.blockTimestamp > receipt.blockTimestamp) throw refuse('paid epoch assignment block is after the observation')
  if (receipt.blockTimestamp - anchor.blockTimestamp > MAX_ASSIGNMENT_AGE_SECS) throw refuse('paid epoch assignment block is older than the payment lifetime')
  // The beacon epoch never moves back; a head behind the anchor is not this chain's history.
  if (headEpoch < anchor.beaconEpoch) throw refuse('beacon head is behind the paid epoch assignment block')
  if (verificationEpoch !== anchor.beaconEpoch && !(anchor.beaconEpoch > 0n && verificationEpoch === anchor.beaconEpoch - 1n)) {
    throw refuse('paid verification epoch was not current or previous at its assignment block')
  }
}

/** Run one RPC read; any failure (unknown block, pruned state, transport) is retryable, never an admission. */
async function readOrUnavailable<T>(what: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    throw unavailable(`${what} unavailable`, error)
  }
}

/** The values at one block HASH: its number, its time and `beacon.epoch()` there. They never change. */
interface AnchorAtHash {blockNumber: bigint; blockTimestamp: bigint; beaconEpoch: bigint}
/** Most anchors kept per client (one per paid operation in flight is plenty). */
const MAX_CACHED_ANCHORS = 256
const anchors = new WeakMap<PublicClient, Map<string, AnchorAtHash>>()

function cachedAnchor(client: PublicClient, key: string): AnchorAtHash | undefined {
  const known = anchors.get(client), value = known?.get(key)
  if (value && known) { known.delete(key); known.set(key, value) }
  return value
}
function keepAnchor(client: PublicClient, key: string, value: AnchorAtHash): void {
  let known = anchors.get(client)
  if (!known) anchors.set(client, known = new Map<string, AnchorAtHash>())
  known.delete(key)
  if (known.size >= MAX_CACHED_ANCHORS) known.delete(known.keys().next().value as string)
  known.set(key, value)
}

/**
 * `beacon.epoch()` at `assignmentBlock` (EIP-1898 `requireCanonical`), plus a by-number canonical
 * recheck. A missing block or unservable state is retryable `paid_epoch_unavailable`; a known
 * block that is not canonical (or answers for another hash) is a definite `paid_epoch_refused`.
 * There is no fallback to the head or to logs.
 *
 * The block's number and time and the epoch at that HASH are immutable, so once read they are
 * kept per client (bounded) and the paid operation's later approvals read only the canonical
 * recheck, which is never kept. A failed or refused read keeps nothing.
 */
export async function readAssignmentEpoch(client: PublicClient, beacon: Address, assignmentBlock: Hex): Promise<AssignmentEpoch> {
  if (!HEX32.test(assignmentBlock) || assignmentBlock.toLowerCase() === ZERO32
    || !ADDRESS.test(beacon) || /^0x0{40}$/i.test(beacon)) throw refuse('paid epoch anchor needs a nonzero assignment block and beacon')
  const anchor = assignmentBlock.toLowerCase(), key = `${beacon.toLowerCase()}|${anchor}`
  let atHash = cachedAnchor(client, key), fresh: AnchorAtHash | undefined
  if (!atHash) {
    // The header first: nothing is read at a hash the node does not serve as this block.
    const block = await readOrUnavailable('paid epoch assignment block', () => client.getBlock({blockHash: assignmentBlock}))
    if (block.hash?.toLowerCase() !== anchor || block.number === null) throw refuse('assignment block hash mismatch')
    const beaconEpoch = await readOrUnavailable('beacon epoch at the paid epoch assignment block', async () => {
      const data = encodeFunctionData({abi: thresholdRandomBeaconAbi, functionName: 'epoch'})
      const result = await client.call({to: beacon, data, blockHash: assignmentBlock, requireCanonical: true, batch: false})
      if (result.data === undefined) throw new Error('empty beacon epoch response')
      return decodeFunctionResult({abi: thresholdRandomBeaconAbi, functionName: 'epoch', data: result.data})
    })
    fresh = {blockNumber: block.number, blockTimestamp: block.timestamp, beaconEpoch}
    atHash = fresh
  }
  const number = atHash.blockNumber
  // The paid-epoch anchor is re-proven at every use: the canonical recheck by number is skipped
  // only when the head follower vouches for this exact block (finalized, in its gap-free chain).
  const proven = headFollowerOf(client)?.isCanonical({blockNumber: number, blockHash: assignmentBlock, blockTimestamp: atHash.blockTimestamp}) === true
  if (!proven) {
    const canonical = await readOrUnavailable('paid epoch assignment block number', () => client.getBlock({blockNumber: number}))
    if (canonical.hash?.toLowerCase() !== anchor) throw refuse('assignment block is not canonical')
  }
  // Kept only once the whole read succeeded.
  if (fresh) keepAnchor(client, key, fresh)
  return {blockHash: assignmentBlock, blockNumber: number, blockTimestamp: atHash.blockTimestamp, beaconEpoch: atHash.beaconEpoch}
}
