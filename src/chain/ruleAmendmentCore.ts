// Shared pieces of the rule-amendment path: the typed refusal every amendment call throws, and the
// one on-chain read the writes, the status read and the orchestrator all judge from.
//
// A separate module so `write.ts` (the four writes) and `ruleAmendment.ts` (status read +
// orchestrator) both import it without a value cycle between them.
//
// Every refusal here is raised BEFORE anything is signed. A proposal no keeper will store never
// activates, and `proposeRuleUpdate` refuses while one is pending - so on a slot without a guardian
// a bad proposal freezes the rule for good. Failing in the SDK costs nothing; failing on chain can
// cost the slot its amendability.

import type {Address, Hex, PublicClient} from 'viem'
import {TasraError} from '../errors.js'
import {keyRegistryAbi} from './abis/keyRegistry.js'
import type {KeeperProvisionResult} from './provisionRule.js'

/**
 * Stable refusal categories of the rule-amendment API; branch on `code`, never on the message.
 * `timelock`, `below-threshold` and `timeout` may succeed later; every other code needs a change first.
 */
export type RuleAmendmentErrorCode =
  | 'no-slot'
  | 'immutable'
  | 'not-admin'
  | 'pending'
  | 'same-rule'
  | 'wrong-auth-type'
  | 'not-admissible'
  | 'no-pending'
  | 'timelock'
  | 'below-threshold'
  | 'not-guardian'
  | 'not-deliverer'
  | 'not-pending'
  | 'pending-changed'
  | 'timeout'
  | 'not-activated'

/** Codes a later identical attempt may clear without any change by the caller. */
const RETRYABLE_CODES: ReadonlySet<RuleAmendmentErrorCode> = new Set(['timelock', 'below-threshold', 'timeout'])

/** Optional detail fields carried by a {@link RuleAmendmentError}. */
export interface RuleAmendmentErrorDetails {
  /** Version of the amendment already pending on chain. */
  pendingVersion?: number
  /** Salted commitment of the amendment already pending on chain. */
  pendingCommitment?: Hex
  /** Whether the slot has a guardian that could veto the pending amendment. */
  hasGuardian?: boolean
  /** Chain time (Unix seconds) from which the pending amendment may activate. */
  notBefore?: number
  /** Latest block timestamp (Unix seconds) the check was made against. */
  chainTime?: number
  /** Keeper adoption votes recorded for the pending amendment. */
  have?: number
  /** Keeper adoption votes activation needs. */
  need?: number
  /** Per-keeper delivery outcomes, when the refusal came from rule delivery. */
  results?: readonly KeeperProvisionResult[]
  /** Orchestrator phase that was running when the refusal was raised. */
  phase?: string
  /** Underlying failure, when there is one. */
  cause?: unknown
}

/**
 * A rule-amendment call refused before signing, or an amendment that did not reach the state the
 * caller asked for. Retryable only for `timelock`, `below-threshold` and `timeout`.
 */
export class RuleAmendmentError extends TasraError {
  /** Refusal category; never infer it from the message. */
  readonly code: RuleAmendmentErrorCode
  /** Slot the refused call targeted. */
  readonly slotId: Hex
  /** Version of the amendment already pending on chain. */
  readonly pendingVersion?: number
  /** Salted commitment of the amendment already pending on chain. */
  readonly pendingCommitment?: Hex
  /** Whether the slot has a guardian that could veto the pending amendment. */
  readonly hasGuardian?: boolean
  /** Chain time (Unix seconds) from which the pending amendment may activate. */
  readonly notBefore?: number
  /** Latest block timestamp (Unix seconds) the check was made against. */
  readonly chainTime?: number
  /** Keeper adoption votes recorded for the pending amendment. */
  readonly have?: number
  /** Keeper adoption votes activation needs. */
  readonly need?: number
  /** Per-keeper delivery outcomes, when the refusal came from rule delivery. */
  readonly results?: readonly KeeperProvisionResult[]
  /** Orchestrator phase that was running when the refusal was raised. */
  readonly phase?: string

  constructor(code: RuleAmendmentErrorCode, slotId: Hex, message: string, details: RuleAmendmentErrorDetails = {}) {
    super(message, {cause: details.cause, retryable: RETRYABLE_CODES.has(code)})
    this.code = code
    this.slotId = slotId
    this.pendingVersion = details.pendingVersion
    this.pendingCommitment = details.pendingCommitment
    this.hasGuardian = details.hasGuardian
    this.notBefore = details.notBefore
    this.chainTime = details.chainTime
    this.have = details.have
    this.need = details.need
    this.results = details.results
    this.phase = details.phase
  }
}

/** A pending amendment as the chain records it. */
export interface PendingAmendmentOnChain {
  /** Salted commitment of the proposed rule. */
  ruleCommitment: Hex
  /** Amendment version. */
  version: number
  /** Chain time (Unix seconds) from which it may activate. */
  notBefore: number
  /** Keeper adoption votes so far; read only when asked for. */
  adoptions?: number
  /** Keeper adoption votes activation needs; read only when asked for. */
  needed?: number
}

/** A slot's amendment-relevant on-chain state, as plain numbers and addresses. */
export interface AmendmentOnChain {
  /** Slot creator. */
  creator: Address
  /** Salted commitment of the ACTIVE rule. */
  ruleCommitment: Hex
  /** Version of the active rule. */
  ruleVersion: number
  /** `KeyRegistry.AuthType` ordinal recorded at creation. */
  authOrdinal: number
  /** Rule admin; the zero address means the rule is immutable. */
  admin: Address
  /** Rule guardian; the zero address means none. */
  guardian: Address
  /** Amendment delay in seconds. */
  timelockSecs: number
  /** The pending amendment, or null when none is pending. */
  pending: PendingAmendmentOnChain | null
}

/** The zero address the contract uses for "no admin" / "no guardian". */
export const AMENDMENT_ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address

/**
 * Case-insensitive address equality.
 * @param a First address.
 * @param b Second address.
 */
export function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/**
 * Read a slot's amendment state: the slot, its rule policy and its pending amendment, in parallel.
 * Refuses `no-slot` for a missing or cancelled slot before reading anything else, because a missing
 * slot reads an all-zero policy that would otherwise report a misleading `immutable`.
 * @param read A `readContract` function, from a viem public client.
 * @param keyRegistry KeyRegistry address of the deployment.
 * @param slotId Slot to read.
 * @param opts `withVotes` also reads the adoption votes and threshold when an amendment is pending.
 */
export async function readAmendmentOnChain(
  read: PublicClient['readContract'],
  keyRegistry: Address,
  slotId: Hex,
  opts: {withVotes?: boolean} = {},
): Promise<AmendmentOnChain> {
  const [slot, policy, pending] = await Promise.all([
    read({address: keyRegistry, abi: keyRegistryAbi, functionName: 'getKeySlot', args: [slotId]}),
    read({address: keyRegistry, abi: keyRegistryAbi, functionName: 'rulePolicy', args: [slotId]}),
    read({address: keyRegistry, abi: keyRegistryAbi, functionName: 'pendingRule', args: [slotId]}),
  ])
  if (!slot.exists || slot.cancelled) {
    throw new RuleAmendmentError(
      'no-slot',
      slotId,
      `slot ${slotId} does not exist or is cancelled on this KeyRegistry; check the slot id and the network`,
    )
  }
  const [pendingCommitment, pendingVersion, notBefore] = pending
  let pend: PendingAmendmentOnChain | null = null
  if (BigInt(pendingVersion) !== 0n) {
    pend = {ruleCommitment: pendingCommitment, version: Number(pendingVersion), notBefore: Number(notBefore)}
    if (opts.withVotes) {
      const [adoptions, needed] = await Promise.all([
        read({address: keyRegistry, abi: keyRegistryAbi, functionName: 'ruleAdoptionVotes', args: [slotId]}),
        read({address: keyRegistry, abi: keyRegistryAbi, functionName: 'ruleAdoptionThreshold', args: [slotId]}),
      ])
      pend.adoptions = Number(adoptions)
      pend.needed = Number(needed)
    }
  }
  const [admin, guardian, timelock] = policy
  return {
    creator: slot.creator,
    ruleCommitment: slot.ruleCommitment,
    ruleVersion: Number(slot.ruleVersion),
    authOrdinal: Number(slot.auth),
    admin,
    guardian,
    timelockSecs: Number(timelock),
    pending: pend,
  }
}

/**
 * The `immutable` refusal: a slot created without a rule policy.
 * @param slotId Slot whose rule cannot change.
 */
export function immutableError(slotId: Hex): RuleAmendmentError {
  return new RuleAmendmentError(
    'immutable',
    slotId,
    `slot ${slotId} was created without a rulePolicy; its rule can never change; create a new slot with a rulePolicy instead`,
  )
}

/**
 * The `pending` refusal: another amendment is already pending, naming its version and whether a guardian can clear it.
 * @param slotId Slot with a pending amendment.
 * @param state The slot's amendment state; `pending` must be set.
 */
export function pendingError(slotId: Hex, state: AmendmentOnChain): RuleAmendmentError {
  const p = state.pending as PendingAmendmentOnChain
  const hasGuardian = !sameAddress(state.guardian, AMENDMENT_ZERO_ADDRESS)
  const remedy = hasGuardian
    ? `the guardian ${state.guardian} can veto it with vetoRuleUpdate, or it can be delivered and activated`
    : 'the slot has no guardian, so nobody can veto it: it must be delivered to the keepers and activated'
  return new RuleAmendmentError(
    'pending',
    slotId,
    `slot ${slotId} already has amendment version ${p.version} pending (commitment ${p.ruleCommitment}); ` +
      `a new proposal is refused until it is activated or vetoed - ${remedy}`,
    {pendingVersion: p.version, pendingCommitment: p.ruleCommitment, hasGuardian},
  )
}

/**
 * Wait `ms` milliseconds, rejecting with the signal's reason as soon as it aborts.
 * @param ms Milliseconds to wait.
 * @param signal Optional cancellation signal.
 */
export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason as Error)
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason as Error)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, {once: true})
  })
}
