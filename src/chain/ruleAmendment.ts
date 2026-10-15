// Read a slot's rule-amendment state, and drive one amendment end to end.
//
// Amending a rule is five steps owned by three parties: the rule ADMIN proposes the new salted
// commitment on chain; the rule text and salt are DELIVERED to each keeper (by the creator, a
// creator delegate, or the admin); the keepers vote ADOPTION themselves once they hold it; the
// GUARDIAN may veto or endorse (endorsing waives the remaining delay); and anyone ACTIVATES once
// chain time has passed `notBefore` and the votes reach `ruleAdoptionThreshold` (n - k + 1).
//
// `amendSlotRule` is resumable: every step first reads the chain, so a run interrupted after the
// proposal (or after activation) picks up where the chain is instead of proposing twice. It never
// activates on a timer alone - activation needs OBSERVED votes and OBSERVED chain time.

import type {Address, Hex} from 'viem'
import type {TasraChainClient} from './client.js'
import {requireAddress} from './deployments.js'
import {provisionRule, type KeeperProvisionResult} from './provisionRule.js'
import {
  amendmentPreflight,
  resolveAmendmentRule,
  ruleCommitment,
  slotAuthTypeOf,
  type ProposeRuleArgs,
  type SlotAuthType,
  type TasraWriteClient,
} from './write.js'
import {
  AMENDMENT_ZERO_ADDRESS,
  RuleAmendmentError,
  abortableDelay,
  immutableError,
  pendingError,
  readAmendmentOnChain,
  sameAddress,
} from './ruleAmendmentCore.js'
import {TasraError} from '../errors.js'
import type {TypedDataSigner} from '../oid4vp/verifier-agent.js'

export {RuleAmendmentError} from './ruleAmendmentCore.js'
export type {RuleAmendmentErrorCode} from './ruleAmendmentCore.js'

/** A slot's rule and amendment state as the chain records it. */
export interface RuleAmendmentStatus {
  /** Salted commitment of the ACTIVE rule. */
  ruleCommitment: Hex
  /** Version of the active rule. */
  ruleVersion: number
  /** Authorization family recorded at creation. */
  authType: SlotAuthType
  /** Who may amend the rule and how slowly; `null` means the rule is immutable. */
  policy: {admin: Address; guardian?: Address; timelockSecs: number} | null
  /** The pending amendment with its keeper adoption votes, or `null` when none is pending. */
  pending: {version: number; ruleCommitment: Hex; notBefore: number; adoptions: number; needed: number} | null
}

/**
 * Read a slot's active rule commitment, amendment policy and pending amendment, including the
 * keeper adoption votes and the votes activation needs.
 * @param chain Reader for the deployment that owns the slot.
 * @param slotId Slot to read; a missing or cancelled slot throws `RuleAmendmentError` code `no-slot`.
 */
export async function readRuleAmendment(chain: TasraChainClient, slotId: Hex): Promise<RuleAmendmentStatus> {
  const s = await readAmendmentOnChain(chain.client.readContract, requireAddress(chain.addresses, 'KeyRegistry'), slotId, {withVotes: true})
  const amendable = !sameAddress(s.admin, AMENDMENT_ZERO_ADDRESS)
  const hasGuardian = !sameAddress(s.guardian, AMENDMENT_ZERO_ADDRESS)
  return {
    ruleCommitment: s.ruleCommitment,
    ruleVersion: s.ruleVersion,
    authType: slotAuthTypeOf(s.authOrdinal),
    policy: amendable ? {admin: s.admin, ...(hasGuardian ? {guardian: s.guardian} : {}), timelockSecs: s.timelockSecs} : null,
    pending: s.pending
      ? {
          version: s.pending.version,
          ruleCommitment: s.pending.ruleCommitment,
          notBefore: s.pending.notBefore,
          adoptions: s.pending.adoptions ?? 0,
          needed: s.pending.needed ?? 0,
        }
      : null,
  }
}

/** Progress points `amendSlotRule` reports, in order. */
export type AmendmentPhase = 'proposed' | 'delivered' | 'adopted' | 'endorsed' | 'activated'

/** Arguments of {@link amendSlotRule}: the amendment, who delivers it, and optional guardian endorsement. */
export type AmendSlotRuleArgs = ProposeRuleArgs & {
  /** Signs the rule delivery to the keepers: the slot creator or the rule admin. */
  deliverer: TypedDataSigner
  /** The guardian's write client; when given, it endorses the amendment to waive the remaining delay. */
  guardian?: TasraWriteClient
  /** Called at each completed phase with that phase's result. */
  onPhase?: (p: AmendmentPhase, d?: unknown) => void
  /** Milliseconds allowed from delivery to activation (default: the slot's timelock plus 10 minutes). */
  maxWaitMs?: number
  /** Cancels waiting and keeper requests. */
  signal?: AbortSignal
}

/** Outcome of {@link amendSlotRule}. */
export interface AmendSlotRuleResult {
  /** Rule version now active. */
  version: number
  /** Salted commitment of the rule now active. */
  ruleCommitment: Hex
  /** Proposal transaction; absent when the proposal already existed (a resumed run). */
  proposeTx?: Hex
  /** Activation transaction; absent when the rule was already active or another party activated it. */
  activateTx?: Hex
}

/** Poll spacing for keeper adoption and chain time. */
const AMENDMENT_POLL_MS = 5_000

/**
 * Amend a slot's rule end to end: propose (as the rule admin), deliver the rule to the keepers,
 * wait for their adoption votes, endorse when a guardian client is given, wait for chain time to
 * pass `notBefore`, activate, and confirm the active commitment on chain.
 *
 * Resumable: a proposal already pending with this rule is not proposed again, and a rule already
 * active returns at once. Every refusal it can know in advance is raised before anything is signed.
 * It never activates on a timer alone: activation needs the observed votes AND chain time.
 *
 * An amendable rule means whoever holds the admin key can change who may sign with this key,
 * without changing the key. Keep the admin key as safe as the slot itself. The guardian can veto
 * during the delay; without a guardian nobody can. Slots created without a rule admin can never
 * become amendable.
 * @param writer Write client of the slot's rule admin; it proposes and activates.
 * @param chain Reader for the deployment that owns the slot.
 * @param a The amendment, its deliverer, an optional guardian client and wait controls.
 */
export async function amendSlotRule(
  writer: TasraWriteClient,
  chain: TasraChainClient,
  a: AmendSlotRuleArgs,
): Promise<AmendSlotRuleResult> {
  const what = 'amendSlotRule'
  const {slotId, signal} = a
  signal?.throwIfAborted()
  for (const [field, value] of [['slotId', a.slotId], ['ruleSalt', a.ruleSalt]] as const) {
    if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new TasraError(`${what}: ${field} must be 0x-prefixed 32-byte hex`)
  }
  if (a.maxWaitMs !== undefined && (!Number.isSafeInteger(a.maxWaitMs) || a.maxWaitMs < 1)) {
    throw new TasraError(`${what}: maxWaitMs must be a positive integer, got ${String(a.maxWaitMs)}`)
  }
  const rule = await resolveAmendmentRule(a, what)
  const commitment = ruleCommitment(a.ruleSalt, rule)
  const keyRegistry = requireAddress(chain.addresses, 'KeyRegistry')
  const state = await readAmendmentOnChain(chain.client.readContract, keyRegistry, slotId, {withVotes: true})

  // ── pre-flight: everything knowable before the first signature ──
  if (sameAddress(state.ruleCommitment, commitment) && !state.pending) {
    return {version: state.ruleVersion, ruleCommitment: commitment}
  }
  if (sameAddress(state.admin, AMENDMENT_ZERO_ADDRESS)) throw immutableError(slotId)
  if (!sameAddress(a.deliverer.address, state.creator) && !sameAddress(a.deliverer.address, state.admin)) {
    throw new RuleAmendmentError(
      'not-deliverer',
      slotId,
      `${what}: the deliverer ${a.deliverer.address} is neither the creator ${state.creator} nor the rule admin ` +
        `${state.admin} of slot ${slotId}, so no keeper would store the rule it signs`,
    )
  }
  if (a.guardian && (sameAddress(state.guardian, AMENDMENT_ZERO_ADDRESS) || !sameAddress(a.guardian.address, state.guardian))) {
    throw new RuleAmendmentError(
      'not-guardian',
      slotId,
      `${what}: the guardian client signs as ${a.guardian.address}, but slot ${slotId} has rule guardian ` +
        `${sameAddress(state.guardian, AMENDMENT_ZERO_ADDRESS) ? 'none' : state.guardian}`,
      {hasGuardian: !sameAddress(state.guardian, AMENDMENT_ZERO_ADDRESS)},
    )
  }
  if (state.pending && !sameAddress(state.pending.ruleCommitment, commitment)) throw pendingError(slotId, state)
  await amendmentPreflight(rule, state, slotId, what)

  // ── 1. propose, unless this exact proposal is already pending (a resumed run) ──
  let proposeTx: Hex | undefined
  if (!state.pending) {
    const proposed = await writer.proposeRuleUpdate(a)
    proposeTx = proposed.txHash
    a.onPhase?.('proposed', proposed)
  }

  const deadline = Date.now() + (a.maxWaitMs ?? state.timelockSecs * 1000 + 600_000)
  const checkDeadline = (phase: AmendmentPhase) => {
    signal?.throwIfAborted()
    if (Date.now() >= deadline) {
      throw new RuleAmendmentError(
        'timeout',
        slotId,
        `${what}: slot ${slotId} did not reach '${phase}' within maxWaitMs; the amendment stays pending - ` +
          'call amendSlotRule again with the same rule to resume',
        {phase},
      )
    }
  }
  /** Re-read the amendment; `null` means it is no longer pending because THIS rule is active. */
  const ownPending = async () => {
    const st = await readRuleAmendment(chain, slotId)
    if (st.pending && sameAddress(st.pending.ruleCommitment, commitment)) return st.pending
    if (!st.pending && sameAddress(st.ruleCommitment, commitment)) return null
    throw new RuleAmendmentError(
      'pending-changed',
      slotId,
      `${what}: the pending amendment of slot ${slotId} is no longer this rule (vetoed, superseded or activated ` +
        'differently); re-read readRuleAmendment before proposing again',
      st.pending ? {pendingVersion: st.pending.version, pendingCommitment: st.pending.ruleCommitment} : {},
    )
  }

  // ── 2. deliver ──
  checkDeadline('delivered')
  let results: readonly KeeperProvisionResult[]
  try {
    results = (await provisionRule(chain, {slotId, rule, ruleSalt: a.ruleSalt, signer: a.deliverer, expect: 'pending', signal})).results
  } catch (e) {
    if (e instanceof RuleAmendmentError) throw e
    const partial = (e as {results?: KeeperProvisionResult[]}).results
    if (!partial) throw e
    // Activation needs only n - k + 1 keepers holding the rule; enough is enough.
    const holding = partial.filter(r => r.ok && r.pending === true).length
    const pend = await ownPending()
    if (pend && holding < pend.needed) throw e
    results = partial
  }
  a.onPhase?.('delivered', results)

  // ── 3. wait for keeper adoption ──
  let activated = false
  for (;;) {
    checkDeadline('adopted')
    const pend = await ownPending()
    if (!pend) {
      activated = true
      break
    }
    if (pend.adoptions >= pend.needed) {
      a.onPhase?.('adopted', {adoptions: pend.adoptions, needed: pend.needed})
      break
    }
    await abortableDelay(AMENDMENT_POLL_MS, signal)
  }

  // ── 4. endorse (waives the remaining delay) ──
  if (!activated && a.guardian) {
    const tx = await a.guardian.endorseRuleUpdate(slotId)
    a.onPhase?.('endorsed', tx)
  }

  // ── 5. activate once chain time AND votes allow it ──
  let activateTx: Hex | undefined
  while (!activated) {
    checkDeadline('activated')
    // Re-read every round: an endorsement moves `notBefore`.
    const pend = await ownPending()
    if (!pend) break
    const block = await chain.client.getBlock({blockTag: 'latest'})
    if (Number(block.timestamp) >= pend.notBefore && pend.adoptions >= pend.needed) {
      try {
        activateTx = await writer.activateRuleUpdate(slotId)
      } catch (e) {
        // Activation is permissionless: another party may have won the race since the read.
        if (e instanceof RuleAmendmentError && e.code === 'no-pending' && (await ownPending()) === null) break
        throw e
      }
      a.onPhase?.('activated', activateTx)
      break
    }
    await abortableDelay(AMENDMENT_POLL_MS, signal)
  }

  // ── 6. confirm the active commitment ──
  const slot = await chain.readers.keyRegistry.getKeySlot(slotId)
  if (!sameAddress(slot.ruleCommitment, commitment)) {
    throw new RuleAmendmentError(
      'not-activated',
      slotId,
      `${what}: slot ${slotId} enforces commitment ${slot.ruleCommitment} after activation, not ${commitment}`,
    )
  }
  return {
    version: Number(slot.ruleVersion),
    ruleCommitment: commitment,
    ...(proposeTx ? {proposeTx} : {}),
    ...(activateTx ? {activateTx} : {}),
  }
}
