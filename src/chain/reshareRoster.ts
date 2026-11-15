// The reshare roster rule for threshold-ECDSA slots (network ADR-0099 D2).
//
// A tECDSA key is re-dealt only by members that STAY in the new roster: each dealer sub-shares its
// own share of the key. So the new roster must keep at least the current `k` members, or no keeper
// can deal and every one of them refuses the ceremony while the chain moves to a roster its shares
// do not match. A full-committee swap therefore takes two reshares. Newer KeyRegistry deployments
// revert `TecdsaReshareKeepsTooFew(staying, k)` at the finalizing vote; older ones accept such a
// roster, so the SDK refuses it before any vote is signed, whichever registry it talks to. FROST
// and BLS committees may still be replaced whole.

import {getAddress, isAddress, type Address, type Hex, type PublicClient} from 'viem'
import {TasraError} from '../errors.js'
import {keyRegistryAbi} from './abis/keyRegistry.js'

/** Largest committee the network deals a key to (`KeyRegistry.MAX_N`). */
export const MAX_RESHARE_PARTIES = 50

/**
 * Stable refusal categories of the reshare roster check; branch on `code`, never on the message.
 * None is retryable: each needs a different roster or threshold.
 */
export type ReshareRosterErrorCode = 'keeps-too-few' | 'invalid-roster' | 'no-slot'

/** A reshare roster refused before any vote was signed. */
export class ReshareRosterError extends TasraError {
  /** Refusal category; never infer it from the message. */
  readonly code: ReshareRosterErrorCode
  /** Current members the roster keeps; set for `keeps-too-few`. */
  readonly staying?: number
  /** Current threshold the roster must keep; set for `keeps-too-few`. */
  readonly k?: number

  constructor(code: ReshareRosterErrorCode, message: string, opts: {staying?: number; k?: number} = {}) {
    super(message)
    this.code = code
    if (opts.staying !== undefined) this.staying = opts.staying
    if (opts.k !== undefined) this.k = opts.k
  }
}

/** A threshold-ECDSA reshare proposal: the slot's current committee and the roster to vote for. */
export interface TecdsaReshareRosterInput {
  /** The slot's current roster (`KeyRegistry.assignedNodes`). */
  current: readonly Address[]
  /** The slot's current threshold `k`. */
  currentK: number
  /** The proposed roster, in the order the vote will carry it. */
  next: readonly Address[]
  /** The proposed threshold. */
  k: number
  /** The proposed committee size; must equal the roster length. */
  n: number
}

/** How a valid proposal moves the committee. Addresses are checksummed. */
export interface TecdsaReshareRosterPlan {
  /** Current members that stay; these are the dealers, at least the current `k` of them. */
  staying: Address[]
  /** New members that receive a share without dealing. */
  joining: Address[]
  /** Current members that leave the committee. */
  leaving: Address[]
}

function checksummed(list: readonly Address[], what: string): Address[] {
  return list.map(a => {
    if (typeof a !== 'string' || !isAddress(a, {strict: false})) throw new ReshareRosterError('invalid-roster', `${what} holds ${JSON.stringify(a)}, which is not an address`)
    return getAddress(a)
  })
}

/**
 * Check a threshold-ECDSA reshare proposal against the network's overlap rule before anything is signed: a
 * well-formed roster (`n` distinct addresses, `2 <= k <= n <= 50`, since threshold ECDSA needs at
 * least two signers) that keeps at least the current `k` members. Refuses `invalid-roster` and
 * `keeps-too-few` as a `ReshareRosterError`.
 * @param input Current committee and threshold, and the proposed roster and threshold.
 */
export function checkTecdsaReshareRoster(input: TecdsaReshareRosterInput): TecdsaReshareRosterPlan {
  const {currentK, k, n} = input
  const current = checksummed(input.current, 'the current roster')
  const next = checksummed(input.next, 'the proposed roster')
  if (!Number.isSafeInteger(k) || !Number.isSafeInteger(n) || k < 2 || k > n || n > MAX_RESHARE_PARTIES || next.length !== n) {
    throw new ReshareRosterError('invalid-roster',
      `a threshold-ECDSA reshare needs 2 <= k <= n <= ${MAX_RESHARE_PARTIES} and n roster entries; got k=${k}, n=${n} with ${next.length} operators`)
  }
  if (new Set(next).size !== next.length) throw new ReshareRosterError('invalid-roster', 'the proposed roster lists an operator more than once')
  if (!Number.isSafeInteger(currentK) || currentK < 1) throw new ReshareRosterError('invalid-roster', `the current threshold ${currentK} is not a positive integer`)
  const now = new Set(current), after = new Set(next)
  const staying = next.filter(a => now.has(a))
  if (staying.length < currentK) {
    throw new ReshareRosterError('keeps-too-few',
      `the proposed roster keeps ${staying.length} of the current members, but a threshold-ECDSA key is re-dealt only by members that stay, so it must keep at least the current k=${currentK}; ` +
        'replace fewer members now and the rest in a second reshare', {staying: staying.length, k: currentK})
  }
  return {staying, joining: next.filter(a => !now.has(a)), leaving: current.filter(a => !after.has(a))}
}

/**
 * Read the slot and, for a threshold-ECDSA slot, apply {@link checkTecdsaReshareRoster} to the
 * proposal. Returns the plan for a tECDSA slot and `undefined` for any other mode, whose committee
 * the network may replace whole. Refuses `no-slot`, `invalid-roster` and `keeps-too-few`.
 * @param read A `readContract` function, from a viem public client.
 * @param keyRegistry KeyRegistry address of the deployment.
 * @param slotId Slot the reshare targets.
 * @param next The proposed roster.
 * @param k The proposed threshold.
 * @param n The proposed committee size.
 */
export async function checkReshareOnChain(read: PublicClient['readContract'], keyRegistry: Address, slotId: Hex,
  next: readonly Address[], k: number, n: number): Promise<TecdsaReshareRosterPlan | undefined> {
  const slot = await read({address: keyRegistry, abi: keyRegistryAbi, functionName: 'getKeySlot', args: [slotId]})
  if (!slot.exists) throw new ReshareRosterError('no-slot', `slot ${slotId} does not exist on this KeyRegistry; check the slot id and the network`)
  const mode = Number(slot.mode)
  if (mode !== 2 && mode !== 4) return undefined
  const current = await read({address: keyRegistry, abi: keyRegistryAbi, functionName: 'assignedNodes', args: [slotId]})
  return checkTecdsaReshareRoster({current, currentK: Number(slot.threshold.k), next, k, n})
}
