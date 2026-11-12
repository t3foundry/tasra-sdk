// Two-step slot hand-offs: the creator offers the slot and the new creator accepts it; the rule
// admin offers its role and the new admin accepts it. The two roles move separately, so buying a
// slot never buys the power to rewrite its rule, and the guardian never moves.
//
// The typed refusal and the one on-chain read every hand-off write judges from. Every refusal is
// raised BEFORE anything is signed, in the contract's order. A KeyRegistry from before the
// hand-off is refused as `unsupported`, never as a bare revert.

import {hexToBytes, type Address, type Hex, type PublicClient} from 'viem'
import {addressFromEoaPubkey} from '../signing/ecdsa.js'
import {TasraError} from '../errors.js'
import {viemErrorChainHas} from '../internal/viemErrors.js'
import {keyRegistryAbi} from './abis/keyRegistry.js'
import type {TasraChainClient} from './client.js'
import {requireAddress} from './deployments.js'

/**
 * Stable refusal categories of the hand-off API; branch on `code`, never on the message.
 * None is retryable: each needs a change of key, offer or slot first.
 */
export type SlotHandoffErrorCode =
  | 'no-slot'
  | 'cancelled'
  | 'unsupported'
  | 'not-creator'
  | 'not-admin'
  | 'immutable'
  | 'same-holder'
  | 'already-offered'
  | 'guardian'
  | 'nothing-pending'
  | 'not-offered'
  | 'not-confirmed'
  /** The slot would become its own creator: every later paid operation needs a creator signature only the slot itself could make. */
  | 'self-custody'
  /** The recipient is a contract: keepers accept creator signatures from an externally owned account only. */
  | 'contract-holder'

/** A hand-off refused before signing, or one that did not reach the state the caller asked for. */
export class SlotHandoffError extends TasraError {
  /** Refusal category; never infer it from the message. */
  readonly code: SlotHandoffErrorCode
  /** Slot the refused call targeted. */
  readonly slotId: Hex

  constructor(code: SlotHandoffErrorCode, slotId: Hex, message: string, opts: {cause?: unknown} = {}) {
    super(message, {cause: opts.cause})
    this.code = code
    this.slotId = slotId
  }
}

/** A slot's roles and pending hand-offs as the chain records them; `null` means none. */
export interface SlotHandoffStatus {
  /** Slot creator. */
  creator: Address
  /** Wallet offered the creator role, not yet accepted. */
  pendingCreator: Address | null
  /** Rule admin; `null` means the rule is immutable. */
  ruleAdmin: Address | null
  /** Rule guardian. */
  guardian: Address | null
  /** Wallet offered the rule admin role, not yet accepted. */
  pendingRuleAdmin: Address | null
  /** The slot's own Ethereum account (a ready secp256k1 threshold slot), or `null`. */
  slotAccount: Address | null
}

const ZERO = '0x0000000000000000000000000000000000000000' as Address

/** Refusal for a slot that would become its own creator. */
function selfCustody(slotId: Hex): SlotHandoffError {
  return new SlotHandoffError('self-custody', slotId, `slot  cannot become its own creator: its paid operations need a creator signature, ` +
    'which only a paid operation of the same slot could produce, so no operation, renewal or further hand-off could ever be signed again')
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
const orNull = (a: Address): Address | null => (same(a, ZERO) ? null : a)

/** True when a read reverted or returned no data, as a missing selector does. */
function missingFunction(e: unknown): boolean {
  // By name: the read comes from the caller's client, whose viem copy may not be this package's.
  return viemErrorChainHas(e, ['ContractFunctionRevertedError', 'ContractFunctionZeroDataError'])
}

/**
 * Read a slot's roles and pending hand-offs. Refuses `no-slot`, `cancelled` and `unsupported`
 * (a KeyRegistry without the hand-off).
 * @param read A `readContract` function, from a viem public client.
 * @param keyRegistry KeyRegistry address of the deployment.
 * @param slotId Slot to read.
 */
export async function readHandoffOnChain(read: PublicClient['readContract'], keyRegistry: Address, slotId: Hex): Promise<SlotHandoffStatus> {
  const [slot, policy] = await Promise.all([
    read({address: keyRegistry, abi: keyRegistryAbi, functionName: 'getKeySlot', args: [slotId]}),
    read({address: keyRegistry, abi: keyRegistryAbi, functionName: 'rulePolicy', args: [slotId]}),
  ])
  if (!slot.exists) throw new SlotHandoffError('no-slot', slotId, `slot ${slotId} does not exist on this KeyRegistry; check the slot id and the network`)
  if (slot.cancelled) throw new SlotHandoffError('cancelled', slotId, `slot ${slotId} is cancelled; a cancelled slot hands nothing over`)
  let pending: readonly [Address, Address]
  try {
    pending = await Promise.all([
      read({address: keyRegistry, abi: keyRegistryAbi, functionName: 'pendingCreator', args: [slotId]}),
      read({address: keyRegistry, abi: keyRegistryAbi, functionName: 'pendingRuleAdmin', args: [slotId]}),
    ])
  } catch (e) {
    // The getters cannot revert on a registry that has them.
    if (!missingFunction(e)) throw e
    throw new SlotHandoffError('unsupported', slotId, `the KeyRegistry ${keyRegistry} has no slot hand-off; it predates the upgrade that adds it`, {cause: e})
  }
  const [admin, guardian] = policy
  let slotAccount: Address | null = null
  if (slot.mode === 2 && /^0x0[23][0-9a-fA-F]{64}$/.test(slot.publicKey)) slotAccount = addressFromEoaPubkey(hexToBytes(slot.publicKey))
  return {
    creator: slot.creator,
    pendingCreator: orNull(pending[0]),
    ruleAdmin: orNull(admin),
    guardian: orNull(guardian),
    pendingRuleAdmin: orNull(pending[1]),
    slotAccount,
  }
}

/**
 * Read a slot's creator, rule admin, guardian and any pending hand-off of either role.
 * @param chain Reader for the deployment that owns the slot.
 * @param slotId Slot to read; refuses `no-slot`, `cancelled` and `unsupported` as a `SlotHandoffError`.
 */
export function readSlotHandoff(chain: TasraChainClient, slotId: Hex): Promise<SlotHandoffStatus> {
  return readHandoffOnChain(chain.client.readContract, requireAddress(chain.addresses, 'KeyRegistry'), slotId)
}

/**
 * The contract's refusals for a creator offer (`to` zero withdraws), then the no-op offers it would accept.
 * @param s The slot's state.
 * @param slotId Slot the offer targets.
 * @param sender Account that would sign.
 * @param to Offered wallet, or zero to withdraw.
 */
export function creatorOfferVerdict(s: SlotHandoffStatus, slotId: Hex, sender: Address, to: Address): void {
  if (!same(sender, s.creator)) throw new SlotHandoffError('not-creator', slotId, `slot ${slotId} has creator ${s.creator}, but this client signs as ${sender}`)
  if (same(to, s.creator)) throw new SlotHandoffError('same-holder', slotId, `${to} already is the creator of slot ${slotId}`)
  if (s.slotAccount && same(to, s.slotAccount)) throw selfCustody(slotId)
  if (same(to, ZERO)) {
    if (!s.pendingCreator) throw new SlotHandoffError('nothing-pending', slotId, `slot ${slotId} has no creator transfer pending`)
  } else if (s.pendingCreator && same(to, s.pendingCreator)) {
    throw new SlotHandoffError('already-offered', slotId, `slot ${slotId} is already offered to ${to}`)
  }
}

/**
 * The contract's refusals for a creator acceptance.
 * @param s The slot's state.
 * @param slotId Slot the acceptance targets.
 * @param sender Account that would sign.
 */
export function creatorAcceptVerdict(s: SlotHandoffStatus, slotId: Hex, sender: Address): void {
  if (!s.pendingCreator) throw new SlotHandoffError('nothing-pending', slotId, `slot ${slotId} has no creator transfer pending`)
  if (!same(sender, s.pendingCreator)) {
    throw new SlotHandoffError('not-offered', slotId, `slot ${slotId} is offered to ${s.pendingCreator}, but this client signs as ${sender}`)
  }
  if (s.slotAccount && same(sender, s.slotAccount)) throw selfCustody(slotId)
}

/**
 * The contract's refusals for a rule admin offer (`to` zero withdraws), then the no-op offers it would accept.
 * @param s The slot's state.
 * @param slotId Slot the offer targets.
 * @param sender Account that would sign.
 * @param to Offered wallet, or zero to withdraw.
 */
export function adminOfferVerdict(s: SlotHandoffStatus, slotId: Hex, sender: Address, to: Address): void {
  if (!s.ruleAdmin) throw new SlotHandoffError('immutable', slotId, `slot ${slotId} has no rule admin; its rule is immutable`)
  if (!same(sender, s.ruleAdmin)) throw new SlotHandoffError('not-admin', slotId, `slot ${slotId} has rule admin ${s.ruleAdmin}, but this client signs as ${sender}`)
  if (same(to, s.ruleAdmin)) throw new SlotHandoffError('same-holder', slotId, `${to} already is the rule admin of slot ${slotId}`)
  if (s.guardian && same(to, s.guardian)) {
    throw new SlotHandoffError('guardian', slotId, `${to} is the guardian of slot ${slotId}; one wallet may not be both`)
  }
  if (same(to, ZERO)) {
    if (!s.pendingRuleAdmin) throw new SlotHandoffError('nothing-pending', slotId, `slot ${slotId} has no rule admin transfer pending`)
  } else if (s.pendingRuleAdmin && same(to, s.pendingRuleAdmin)) {
    throw new SlotHandoffError('already-offered', slotId, `the rule admin of slot ${slotId} is already offered to ${to}`)
  }
}

/**
 * The contract's refusals for a rule admin acceptance.
 * @param s The slot's state.
 * @param slotId Slot the acceptance targets.
 * @param sender Account that would sign.
 */
export function adminAcceptVerdict(s: SlotHandoffStatus, slotId: Hex, sender: Address): void {
  if (!s.pendingRuleAdmin) throw new SlotHandoffError('nothing-pending', slotId, `slot ${slotId} has no rule admin transfer pending`)
  if (!same(sender, s.pendingRuleAdmin)) {
    throw new SlotHandoffError('not-offered', slotId, `the rule admin of slot ${slotId} is offered to ${s.pendingRuleAdmin}, but this client signs as ${sender}`)
  }
  if (s.guardian && same(sender, s.guardian)) {
    throw new SlotHandoffError('guardian', slotId, `${sender} is the guardian of slot ${slotId}; one wallet may not be both`)
  }
}
