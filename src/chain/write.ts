import {requireRule, type RuleInput} from './ruleInput.js'
import {networkNameForChain, resolveNetworkProfile, assertEurcFaucetAllowed} from './networks.js'
import {SlotCommitmentExpiredError, SlotRevealNotYetError, SlotSeedUnavailableError} from './commitmentRecovery.js'
import {DEFAULT_SLOT_SEED_HEDGE_MS, DEFAULT_SLOT_SEED_RETRY_MS, requestSlotSeed, type SlotSeed, type SlotSeedFailure} from './slotSeed.js'
import {resolveAccountantUrls} from './discovery.js'
// Client-side ON-CHAIN WRITE path: the client is a sovereign actor with its own
// EVM account that signs its own transactions - no relayer/provisioner.
//
// Slot creation is permissionless (KeyRegistry.createKeySlot* has no owner gate;
// the creator is just msg.sender) and fee-less (only gas), so a fresh
// funded account can create and own a slot. This client signs:
//   - createKeySlot(Filtered) - create + own a slot (committee drawn on-chain,
//     nodes auto-DKG),
//   - TSRA approve + Settlement.fund - prepay the slot's metered usage,
// and exposes plain ETH/TSRA transfers (so a funded key can also back a faucet).
//
// Lives in the `@t3foundry/tasra-sdk/chain` subpath (viem). Browser + Node (uses
// globalThis.crypto for slot/salt randomness; no Node-only APIs).

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  concat,
  encodeFunctionData,
  isAddress,
  keccak256,
  parseEventLogs,
  toHex,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from 'viem'
import {generatePrivateKey, privateKeyToAccount} from 'viem/accounts'
import {createTasraChainClient} from './client.js'
import {createRegisteredRelaySubmitter, type RegisteredRelayConfig, type RelayReceipt, type RelayAttempt} from './registeredRelay.js'
import {describeRevert} from './revertReason.js'
export type {RelayReceipt} from './registeredRelay.js'
import {canonicalize, isOid4vpRule} from '../auth/oid4vp.js'
import {isOauthEnvelope, loadRego, type OauthPolicyInput} from '../auth/rego.js'
import {TasraError} from '../errors.js'
import {keyRegistryAbi} from './abis/keyRegistry.js'
import {
  RuleAmendmentError,
  immutableError,
  pendingError,
  readAmendmentOnChain,
  sameAddress,
  type AmendmentOnChain,
} from './ruleAmendmentCore.js'
import {
  SlotHandoffError,
  adminAcceptVerdict,
  adminOfferVerdict,
  creatorAcceptVerdict,
  creatorOfferVerdict,
  readHandoffOnChain,
  type SlotHandoffStatus,
} from './slotHandoff.js'
import {nodeRegistryAbi} from './abis/nodeRegistry.js'

/**
 * Return whether active operators include both tagged keepers and other roles, making an unfiltered draw include non-keepers.
 * @param active Total active operator count.
 * @param tagged Active operator count carrying the keeper tag.
 */
export function untaggedDrawSeatsNonKeepers(active: bigint, tagged: bigint): boolean {
  return tagged > 0n && tagged < active
}

/**
 * Return whether a FILTERED draw cannot be seated: fewer tagged-ACTIVE candidates than the
 * committee size the slot asks for. This is the shortfall `KeyRegistry` reverts
 * `InsufficientFilteredPool(have, need)` on, judged on the tag filter alone.
 * @param candidates Active operators carrying EVERY required tag (KeyRegistry takes the smallest
 *   tagged count when a slot requires several).
 * @param n Committee size the slot asks for.
 */
export function filteredDrawCannotSeat(candidates: bigint, n: number): boolean {
  // A malformed threshold is not a pool shortfall. n = 0, a fraction or a non-number is the
  // contract's `InvalidThreshold` to report; claiming a pool problem would send the caller to
  // look at the operator set for a mistake that is in the arguments.
  if (!Number.isSafeInteger(n) || n <= 0) return false
  return candidates < BigInt(n)
}
import {settlementAbi} from './abis/settlement.js'
import {tasraTokenAbi} from './abis/tasraToken.js'
import {thresholdRandomBeaconAbi} from './abis/thresholdRandomBeacon.js'
import {bondingCurveAbi} from './abis/bondingCurve.js'
import {mockEurcAbi} from './abis/mockEurc.js'
import {treasuryAbi} from './abis/treasury.js'
import {tasraVestingVaultAbi} from './abis/tasraVestingVault.js'
import {
  DEFAULT_CHAIN_ID,
  requireAddress,
  requireVaultAddress,
  type AddressBook,
  type VaultTranche,
} from './deployments.js'
import {pollTransactionReceipt, WRITE_POLL_INTERVAL_MS} from './receipt.js'

/**
 * The slot's key type, mirroring `KeyRegistry.Mode` on-chain:
 * `frost` Ed25519 threshold signatures, `bls` BLS12-381 encryption/decryption,
 * `tecdsa` secp256k1 threshold ECDSA (an EVM account - what `signEoaDigest` needs),
 * `bls-bn254`, and `tecdsa-p256` (ES256). A deployment need not run keepers for
 * every mode; creating a slot the network cannot key leaves it without a group key.
 */
export type SlotMode = 'frost' | 'bls' | 'tecdsa' | 'bls-bn254' | 'tecdsa-p256'

/** `KeyRegistry.Mode` enum order. */
const SLOT_MODES: readonly SlotMode[] = ['frost', 'bls', 'tecdsa', 'bls-bn254', 'tecdsa-p256']
function modeIndex(mode: SlotMode): number {
  const i = SLOT_MODES.indexOf(mode)
  if (i < 0) throw new TasraError(`createSlot: unknown mode ${JSON.stringify(mode)} (expected ${SLOT_MODES.join(' | ')})`)
  return i
}

/**
 * Authorization family recorded at creation. The default unspecified value declares no family. This label is not included in the committee-selection commitment.
 */
export type SlotAuthType = 'unspecified' | 'oid4vp' | 'oauth' | 'governance'

/** `KeyRegistry.AuthType` enum order - APPEND-only on-chain, so never reorder. */
const SLOT_AUTH_TYPES: readonly SlotAuthType[] = ['unspecified', 'oid4vp', 'oauth', 'governance']
function authTypeIndex(auth: SlotAuthType | undefined, mode: SlotMode): number {
  const i = SLOT_AUTH_TYPES.indexOf(auth ?? 'unspecified')
  if (i < 0) {
    throw new TasraError(
      `createSlot: unknown authType ${JSON.stringify(auth)} (expected ${SLOT_AUTH_TYPES.join(' | ')})`,
    )
  }
  if ((auth === 'governance') !== (mode === 'bls-bn254')) {
    throw new TasraError('createSlot: governance authorization is required only for bls-bn254 authority slots')
  }
  return i
}

/**
 * Map a `KeyRegistry.AuthType` ordinal read from chain back to its label.
 * @param ordinal The `auth` field of `KeyRegistry.getKeySlot`.
 */
export function slotAuthTypeOf(ordinal: number): SlotAuthType {
  const auth = SLOT_AUTH_TYPES[ordinal]
  if (auth === undefined) {
    throw new TasraError(`unknown KeyRegistry.AuthType ordinal ${ordinal} (this SDK knows ${SLOT_AUTH_TYPES.join(' | ')}); upgrade @t3foundry/tasra-sdk`)
  }
  return auth
}

/**
 * Approved relay configuration for gas-sponsored sender-bound contract calls. The creator signs the forward request; the relayer pays gas. ERC-20 approvals still require direct transactions.
 */
export type RelayConfig = RegisteredRelayConfig

interface WriteClientConfigBase {
  /** JSON-RPC endpoint for the deployment selected from the network manifest. */
  rpcUrl: string
  /** Deployed contract address book from the selected network manifest. */
  addresses: AddressBook
  /** When set, sender-bound calls are gas-sponsored through the platform relayer. */
  relay?: RelayConfig
  /**
   * EVM chain ID from the network manifest. Defaults to the bound wallet chain, or DEFAULT_CHAIN_ID for a loopback RPC when no chain is supplied.
   */
  chainId?: number
}

/** Sovereign-key variant: the SDK owns the account and signs with `privateKey`. */
export interface WriteClientKeyConfig extends WriteClientConfigBase {
  /** The client's own 0x-prefixed 32-byte private key (it signs + pays gas). */
  privateKey: Hex
  /** Must be omitted when supplying a raw private key. */
  wallet?: undefined
}

/**
 * Account-bound and chain-bound viem wallet used for signing without exposing its private key. Reads and receipt polling use the separately configured RPC.
 */
export interface WriteClientWalletConfig extends WriteClientConfigBase {
  /** Account-bound and chain-bound wallet used for writes; mutually exclusive with a raw private key. */
  wallet: WalletClient<Transport, Chain, Account>
  /** Must be omitted when supplying a wallet signer. */
  privateKey?: undefined
}

/**
 * Either a private-key signer or an account-bound wallet with network write configuration.
 */
export type WriteClientConfig = WriteClientKeyConfig | WriteClientWalletConfig

/**
 * Recovery and timing controls for commit-reveal creation. Creation uses only the accountant-seeded path: the seed is asked for concurrently, retried within a bounded window, and its absence is a typed error ({@link SlotSeedUnavailableError}); there is no beacon-epoch wait.
 */
export interface CommitRevealOptions {
  /** Durable creation flow. Awaited before submission and after receiving each hash.
   * Enabling recovery disables automatic transaction resubmission.
   * Only supply hashes from the same persisted intent; never reconstruct lost salts.
   * Resuming a beacon-epoch commitment made by an older SDK checks its target epoch ONCE and throws
   * {@link SlotRevealNotYetError} until it is reached; it never waits.
   */
  recovery?: {
    commitTx?: Hex
    revealTx?: Hex
    seeded?: boolean
    onTransaction: (event: {step: 'commit' | 'reveal'; phase: 'submitting' | 'submitted' | 'confirmed'; hash?: Hex; seeded?: boolean}) => Promise<void>
  }
  /** Cancel cooperative creation waits; already submitted transactions remain on chain. */
  signal?: AbortSignal
  /** Accountant base URLs for the seed request. Resolved from `NodeRegistry` when omitted. */
  accountantUrls?: string[]
  /** Per-accountant HTTP timeout for the seed request (default 20 s, capped by the retry window). */
  slotSeedTimeoutMs?: number
  /**
   * Total time to keep re-asking the accountant set while it answers "not yet" (404 before its
   * view reaches the commit receipt, 503 while it leads another creation's round, 429, a timeout).
   * Backs off with jitter and honours `Retry-After`. Default {@link DEFAULT_SLOT_SEED_RETRY_MS} (90 s).
   */
  slotSeedRetryMs?: number
  /** Stagger between the concurrent asks of one round (default {@link DEFAULT_SLOT_SEED_HEDGE_MS}; 0 asks every accountant at once). */
  slotSeedHedgeMs?: number
  /** The seed that was obtained, before the reveal is sent. */
  onSeed?: (seed: SlotSeed) => void
  /** Why no seed was obtained (each accountant's last answer), just before {@link SlotSeedUnavailableError} is thrown. */
  onSeedError?: (failure: SlotSeedFailure) => void
}

/**
 * Slot key mode, keeper threshold, private authorization rule and creation policies.
 */
export interface CreateSlotArgs extends RuleInput {
  /**
   * Private 32-byte authorization-rule salt, generated when omitted. Distinct from the committee-selection salt.
   */
  ruleSalt?: Hex
  /**
   * Minimum participating keeper shares required for an operation.
   */
  k: number
  /**
   * Total keeper shares assigned to the slot.
   */
  n: number
  /**
   * Key algorithm and threshold operation family.
   */
  mode: SlotMode
  /**
   * `KeyRegistry.AuthType` for this slot - how a holder authorises against the rule.
   * Defaults to `'unspecified'` (ordinal 0), interpreted as OID4VP by current
   * keepers. Choose `'oid4vp'` for wallet credentials or `'oauth'` for OAuth/OIDC.
   * The separate administrative `'bls-bn254'` mode requires `'governance'`
   * (ordinal 3); this type cannot authorize customer key modes or wallet grants.
   * Update fleet readers to support ordinal 3 before creating authority slots.
   */
  authType?: SlotAuthType
  /** Committee-draw filter tags; default `["keykeeper"]`. */
  tags?: string[]
  /**
   * Explicit 32-byte slot identifier, generated when omitted.
   */
  slotId?: Hex
  /**
   * 32-byte committee-selection salt, generated when omitted.
   */
  salt?: Hex
  /**
   * Install amendment authority in the creation transaction. Omission makes the rule immutable. A later policy transaction can lose the race with key generation.
   */
  rulePolicy?: RulePolicyArgs
  /**
   * Allow raw share export, permitting a holder with enough shares to retain the reconstructed key permanently. Revocation cannot remove an exported key. Disabled by default and incompatible with rulePolicy.
   */
  exportable?: boolean
}

/**
 * Slot creation from an authored Rego policy instead of a rule string. The SDK packs
 * `oauthPolicy` into the canonical `kk_oauth` envelope with the network's own engine, refuses
 * it when a keeper would not store it, and commits the envelope. Requires `authType: 'oauth'`.
 * The packed envelope is returned as `rule`: provision exactly that string.
 */
export type CreateSlotFromPolicyArgs = Omit<CreateSlotArgs, 'rule'> & {
  /** Must be omitted: the rule is the packed envelope. */
  rule?: undefined
  /** Rego policy source, token specifications and optional entrypoint. */
  oauthPolicy: OauthPolicyInput
}

/**
 * Resolve the rule a creation commits to, and refuse - before any chain call - an envelope the
 * network would strand: one on a slot not declared `authType: 'oauth'`, or one no keeper would
 * store. An OID4VP rule on an `oauth` slot stays allowed (the restriction is one-directional).
 */
async function creationRule(args: CreateSlotArgs | CreateSlotFromPolicyArgs, what: string): Promise<string> {
  let rule: string
  const policy = (args as {oauthPolicy?: OauthPolicyInput}).oauthPolicy
  if (policy !== undefined) {
    if ((args as {rule?: unknown}).rule !== undefined) throw new TasraError(`${what}: pass either \`rule\` or \`oauthPolicy\`, not both`)
    if (args.authType !== 'oauth') throw new TasraError(`${what}: an \`oauthPolicy\` slot requires authType: 'oauth'`)
    rule = (await loadRego()).pack(policy)
  } else {
    rule = requireRule(args as CreateSlotArgs)
  }
  if (!isOauthEnvelope(rule)) return rule
  if (args.authType !== 'oauth') {
    throw new TasraError(
      `${what}: a kk_oauth policy envelope requires authType: 'oauth' — keepers refuse an envelope on any other slot`,
    )
  }
  const lint = (await loadRego()).lint(rule)
  if (!lint.admissible) throw new TasraError(`${what}: keepers would not store this envelope: ${lint.admissionError ?? 'not admissible'}`)
  return rule
}

/** Who may amend a slot's authorization rule, and how slowly. */
export interface RulePolicyArgs {
  /**
   * Account authorized to propose rule amendments.
   */
  admin: Address
  /** May veto or endorse. Omitted means none - which then requires a real timelock. */
  guardian?: Address
  /**
   * Required amendment delay in seconds. Without a guardian, the contract minimum delay applies.
   */
  timelockSecs: number
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address

/**
 * `slotCommits` as a path-recording registry returns it: the four historical words plus
 * `frozenAt` and the reveal path. Kept beside the generated ABI rather than in it, because the
 * generated four-output form is what every other reader decodes - and decodes on BOTH registry
 * generations - while this six-output form fails to decode on an older one, which is exactly the
 * signal [`readCommitPath`] needs.
 */
const slotCommitsWithPathAbi = [{
  type: 'function', name: 'slotCommits', stateMutability: 'view',
  inputs: [{name: 'commitment', type: 'bytes32'}],
  outputs: [
    {name: 'targetEpoch', type: 'uint64'}, {name: 'expiryEpoch', type: 'uint64'},
    {name: 'creator', type: 'address'}, {name: 'used', type: 'bool'},
    {name: 'frozenAt', type: 'uint48'}, {name: 'path', type: 'uint8'},
  ],
}] as const

/** Which reveal a commitment admits: `legacy` = a registry from before reveal paths (both). */
type CommitPath = 'legacy' | 'unbound' | 'epoch' | 'seeded'

/**
 * The reveal path `commitment` is bound to, or - for one not committed yet - `unbound` on a
 * path-recording registry and `legacy` on an older one.
 *
 * ⚠⚠ ONLY A SHORT DECODE reads as `legacy` (an older registry's four-word `slotCommits`). Any other
 *   failure - an RPC hiccup, a missing contract - PROPAGATES. It used to read as `legacy` too, which
 *   commits through `commitKeySlot`: on a path-recording registry that is a BEACON-EPOCH commitment,
 *   which no accountant will seed and which can only be revealed one to two epochs later.
 */
async function readCommitPath(pub: PublicClient, keyRegistry: Address, commitment: Hex): Promise<CommitPath> {
  let r: unknown
  try {
    r = await pub.readContract({address: keyRegistry, abi: slotCommitsWithPathAbi, functionName: 'slotCommits', args: [commitment]})
  } catch (e) {
    if (isShortDecode(e)) return 'legacy'
    throw e
  }
  if (!Array.isArray(r) || r.length < 6) return 'legacy'
  const path = Number(r[5])
  return path === 1 ? 'epoch' : path === 2 ? 'seeded' : 'unbound'
}

/** A return too short for the six-word ABI: what a pre-reveal-path registry's four words decode as. */
function isShortDecode(e: unknown): boolean {
  for (let c: unknown = e, depth = 0; c && depth < 8; c = (c as {cause?: unknown}).cause, depth++) {
    const name = (c as {name?: unknown}).name
    if (name === 'AbiDecodingDataSizeTooSmallError' || name === 'PositionOutOfBoundsError') return true
  }
  return false
}

/**
 * A rule amendment: the new rule (a clear rule string, or an authored Rego policy the SDK packs
 * into a `kk_oauth` envelope) for an existing slot, committed with the slot's saved rule salt.
 */
export type ProposeRuleArgs = ({rule: string} | {oauthPolicy: OauthPolicyInput}) & {
  /** 32-byte identifier of the slot whose rule changes. */
  slotId: Hex
  /** The slot's rule salt (from creation). Amendments reuse it; it is never minted here. */
  ruleSalt: Hex
}

/** Outcome of {@link TasraWriteClient.proposeSlotTransfer}. */
export interface SlotTransferProposal {
  /** Slot offered. */
  slotId: Hex
  /** Transaction that carried the offer. */
  txHash: Hex
  /** Wallet that may accept. */
  to: Address
  /** Rule admin, which does not move with the slot; `null` when the rule is immutable. */
  ruleAdmin: Address | null
  /** Guardian, which does not move with the slot. */
  guardian: Address | null
  /** True when this account is also the rule admin and so needs the second hand-off. */
  callerIsRuleAdmin: boolean
  /** Prepaid TSRA base units the slot holds, which go with it; set when a Settlement address is configured. */
  prepaidBalance?: bigint
  /** Of that, base units reserved by accepted requests, which still settle; set where the Settlement has reservations. */
  reservedBalance?: bigint
  /** Relay receipt, when the offer was gas-sponsored. */
  relay?: RelayReceipt
}

/** A confirmed `proposeRuleUpdate`, decoded from its `RuleUpdateProposed` event. */
export interface ProposeRuleResult {
  /** Slot whose rule amendment was proposed. */
  slotId: Hex
  /** Transaction that carried the proposal. */
  txHash: Hex
  /** Amendment version the contract assigned. */
  version: number
  /** Chain time (Unix seconds) from which the amendment may activate. */
  notBefore: number
  /** Salted commitment of the proposed rule. */
  ruleCommitment: Hex
  /** Rule salt the commitment was computed with. */
  ruleSalt: Hex
  /** Exact rule string committed; deliver exactly this to the keepers. */
  rule: string
  /** Relay receipt, when the proposal was gas-sponsored. */
  relay?: RelayReceipt
}

/** Refuse a value that is not 0x-prefixed 32-byte hex, before any chain call. */
function requireBytes32(value: unknown, field: string, what: string): void {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new TasraError(`${what}: ${field} must be 0x-prefixed 32-byte hex`)
  }
}

/**
 * Resolve the rule string an amendment commits to: an `oauthPolicy` is packed into the canonical
 * `kk_oauth` envelope, a `rule` is taken as given. No chain call; the auth-type check needs the
 * slot and runs in {@link amendmentPreflight}.
 * @param a Amendment arguments carrying exactly one of `rule` and `oauthPolicy`.
 * @param what Caller name used in error messages.
 */
export async function resolveAmendmentRule(a: ProposeRuleArgs, what: string): Promise<string> {
  const policy = (a as {oauthPolicy?: OauthPolicyInput}).oauthPolicy
  const hasRule = (a as {rule?: unknown}).rule !== undefined
  if (policy !== undefined) {
    if (hasRule) throw new TasraError(`${what}: pass either \`rule\` or \`oauthPolicy\`, not both`)
    try {
      return (await loadRego()).pack(policy)
    } catch (e) {
      throw new RuleAmendmentError(
        'not-admissible',
        a.slotId,
        `${what}: the oauthPolicy cannot be packed into a kk_oauth envelope: ${e instanceof Error ? e.message : String(e)}`,
        {cause: e},
      )
    }
  }
  if (!hasRule && !('dcqlRule' in a)) throw new TasraError(`${what}: pass either \`rule\` or \`oauthPolicy\``)
  return requireRule(a as RuleInput)
}

/**
 * Refuse, before signing, an amendment rule the slot's keepers would never store: a `kk_oauth`
 * envelope on a slot not created with `authType: 'oauth'` (`wrong-auth-type`), or an envelope
 * that fails the network's gate (`not-admissible`). An OID4VP rule on an `oauth` slot stays allowed.
 * @param rule Resolved amendment rule.
 * @param state The slot's amendment state read from chain.
 * @param slotId Slot being amended.
 * @param what Caller name used in error messages.
 */
export async function amendmentPreflight(rule: string, state: AmendmentOnChain, slotId: Hex, what: string): Promise<void> {
  if (!isOauthEnvelope(rule)) return
  if (state.authOrdinal !== SLOT_AUTH_TYPES.indexOf('oauth')) {
    const label = SLOT_AUTH_TYPES[state.authOrdinal] ?? `ordinal ${state.authOrdinal}`
    throw new RuleAmendmentError(
      'wrong-auth-type',
      slotId,
      `${what}: a kk_oauth policy envelope requires authType: 'oauth' — keepers refuse an envelope on any other slot, ` +
        `and slot ${slotId} was created with authType '${label}'`,
    )
  }
  let lint: {admissible: boolean; admissionError?: string}
  try {
    lint = (await loadRego()).lint(rule)
  } catch (e) {
    throw new RuleAmendmentError('not-admissible', slotId, `${what}: keepers would not store this envelope: ${e instanceof Error ? e.message : String(e)}`, {cause: e})
  }
  if (!lint.admissible) {
    throw new RuleAmendmentError('not-admissible', slotId, `${what}: keepers would not store this envelope: ${lint.admissionError ?? 'not admissible'}`)
  }
}

/**
 * salted DCQL rule commitment: `keccak256(DOMAIN || salt || rule)`.
 *
 * Must byte-for-byte match the reference rule-commitment function - the keeper
 * re-derives this to verify-fill the rule and the verifier re-derives it to
 * authenticate a fetched one, so a mismatch here means every keeper refuses the
 * rule and the slot stays fail-closed. Cross-checked vector: salt 0x11*32 over
 * "EmployeeOf:dept=Engineering" =
 * 0x176e8b17e8e6b587e649754fe682f7ad6eb12f97461a295d2cfa9c92c287dfde.
 *
 * not the `salt` passed to createKeySlot - that is the committee-selection
 * salt and never touches the rule.
 */

// One approve-then-fund at a time per (chain, token, owner, spender) in this process. `approve` SETS
// the allowance, so two concurrent fundSlot calls from one owner (write clients made per slot share
// no state) could mine approve, approve, fund, fund: the second fund then finds the allowance the
// first consumed and reverts. The receipt wait's 1 s grid used to space them by chance.
const fundingQueues = new Map<string, Promise<unknown>>()
function oneFundingAtATime<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = fundingQueues.get(key) ?? Promise.resolve()
  const run = previous.then(work, work)
  const tail = run.then(() => undefined, () => undefined)
  fundingQueues.set(key, tail)
  void tail.then(() => { if (fundingQueues.get(key) === tail) fundingQueues.delete(key) })
  return run
}

/** How long a write step waits for its receipt: viem's waitForTransactionReceipt default, unchanged. */
export const WRITE_RECEIPT_TIMEOUT_MS = 180_000

/**
 * Wait for a receipt and reject reverted transactions. Receipt availability alone does not prove execution succeeded.
 * The receipt of exactly `hash` is asked for 250 ms after the call, then less and less often (at
 * most every 1 s; pollTransactionReceipt), instead of on viem's fixed 1 s grid: one confirmation,
 * the same 180 s deadline (viem's WaitForTransactionReceiptTimeoutError), a reverted one refused.
 */
async function confirmed(
  pub: PublicClient,
  hash: Hex,
  what: string,
) {
  const receipt = await pollTransactionReceipt(pub, hash, {confirmations: 1, timeoutMs: WRITE_RECEIPT_TIMEOUT_MS})
  if (receipt.status !== 'success') {
    throw new Error(`${what} REVERTED on chain (tx ${hash}) — the call did not take effect`)
  }
  return receipt
}

/**
 * Compute the salted rule commitment. OID4VP queries and `kk_oauth` policy envelopes use canonical JSON; other rule formats retain their exact bytes.
 * @param ruleSalt Private 32-byte salt saved with the slot creation intent.
 * @param rule Clear authorization rule; OID4VP queries and policy envelopes are canonicalized before hashing.
 */
export function ruleCommitment(ruleSalt: Hex, rule: string): Hex {
  // Envelope test first, like the network's grammar dispatch; both JSON grammars commit their
  // RFC 8785 form, anything else its exact bytes.
  const body = isOauthEnvelope(rule) || isOid4vpRule(rule) ? canonicalize(rule) : rule
  return keccak256(concat([toHex('keykeeper/rule-commitment/v1'), ruleSalt, toHex(body)]))
}

/**
 * Return whether the disclosed rule and salt reproduce the on-chain commitment. Invalid inputs and mismatches return false.
 * @param rule Clear rule received for the slot.
 * @param ruleSalt Private salt associated with that rule commitment.
 * @param onChainRuleCommitment Commitment read from the on-chain slot.
 */
export function verifyRuleCommitment(
  rule: string,
  ruleSalt: Hex,
  onChainRuleCommitment: Hex,
): boolean {
  try {
    return ruleCommitment(ruleSalt, rule) === onChainRuleCommitment
  } catch {
    return false
  }
}

/** Fresh 0x-prefixed 32-byte private key for a new sovereign client account. */
export function generateClientKey(): Hex {
  return generatePrivateKey()
}

/**
 * Check whether the RPC host permits the legacy loopback chain-ID fallback.
 */
function isLoopbackRpc(rpcUrl: string): boolean {
  try {
    const host = new URL(rpcUrl).hostname
    return (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '[::1]' ||
      host === '::1'
    )
  } catch {
    return false
  }
}

function random32(): Hex {
  const b = new Uint8Array(32)
  ;(globalThis.crypto).getRandomValues(b)
  return `0x${Array.from(b, x => x.toString(16).padStart(2, '0')).join('')}`
}

/**
 * Create an account-bound client for slot lifecycle, settlement and token transactions. Use deployed addresses and the chain ID from a tasra-releases network manifest.
 * @param cfg RPC, manifest contract addresses, chain ID and an explicit signing account.
 */
export function createTasraWriteClient(cfg: WriteClientConfig): TasraWriteClient {
  const chainId = cfg.chainId ?? cfg.wallet?.chain?.id
  if (chainId === undefined && !isLoopbackRpc(cfg.rpcUrl)) {
    throw new TasraError(
      `createTasraWriteClient: chainId is required for ${cfg.rpcUrl}. ` +
        'Use the chain ID from the tasra-releases manifest or a chain-bound wallet.',
    )
  }
  const chain = defineChain({
    id: chainId ?? DEFAULT_CHAIN_ID,
    name: 'keykeeper',
    nativeCurrency: {name: 'Ether', symbol: 'ETH', decimals: 18},
    rpcUrls: {default: {http: [cfg.rpcUrl]}},
  })
  // Reads and receipt-waiting always go through OUR PublicClient, never the
  // supplied wallet's transport - an injected provider is rate-limited, may be on
  // a different node, and can be unavailable while the user's tab is backgrounded.
  // viem receipt waits (none in confirmed(), which polls 250 ms growing) poll every second; the
  // block-number cache keeps viem's 4 s default so nothing else reads the head more often.
  const pub = createPublicClient({chain, transport: http(cfg.rpcUrl), pollingInterval: WRITE_POLL_INTERVAL_MS, cacheTime: 4_000}) as PublicClient
  const addr = cfg.addresses
  const relay = cfg.relay
  let lastRelay: RelayReceipt | undefined
  let registeredRelay: ReturnType<typeof createRegisteredRelaySubmitter> | undefined
  async function relayForward(to: Address, data: Hex, label?: string): Promise<RelayReceipt> {
    if (!relay) throw new Error('relayForward: no relay configured')
    registeredRelay ??= createRegisteredRelaySubmitter(
      createTasraChainClient({rpcUrl: cfg.rpcUrl, addresses: cfg.addresses, chainId: chain.id}), relay, wallet,
    )
    lastRelay = await registeredRelay.submit(to, data, label)
    return lastRelay
  }
  /** One door for every sender-bound write: the relayer when configured, else the local key. */
  async function sendCall(address: Address, abi: readonly unknown[], functionName: string, args: readonly unknown[], label: string): Promise<Hex> {
    const call = {abi, functionName, args} as unknown as Parameters<typeof encodeFunctionData>[0]
    if (relay) return (await relayForward(address, encodeFunctionData(call), label)).txHash
    return wallet.writeContract({address, ...call} as unknown as Parameters<typeof wallet.writeContract>[0])
  }

  const supplied = cfg.wallet
  let wallet: WalletClient<Transport, Chain, Account>
  let account: Account
  if (supplied) {
    if (!supplied.account) {
      throw new Error(
        'createTasraWriteClient: the supplied `wallet` has no account bound — ' +
          'pass a client from wagmi getWalletClient() or createWalletClient({account, chain, transport})',
      )
    }
    wallet = supplied
    account = supplied.account
  } else {
    if (!cfg.privateKey) {
      throw new Error('createTasraWriteClient: pass either `privateKey` or `wallet`')
    }
    account = privateKeyToAccount(cfg.privateKey)
    wallet = createWalletClient({account, chain, transport: http(cfg.rpcUrl)})
  }

  // A dev/test RPC (besu/anvil) under load can transiently return a STALE nonce for
  // getTransactionCount - e.g. 0 for an account already at 64 - and viem then builds
  // a tx with that nonce, which the node rejects with "nonce too low". This is safe
  // to retry: the tx was rejected BEFORE entering the mempool (no double-submit
  // risk), and since no nonceManager is attached, each retry re-derives the nonce
  // fresh, so a re-run a moment later clears the glitch. Bounded + backoff; only
  // nonce-too-low retries - every other error throws immediately.
  //
  // local-KEY PATH only. Two reasons a supplied wallet must not get this:
  //   1. A browser wallet manages its own nonce, so a retry would re-enter the
  //      signing flow and surface as a SECOND signature prompt for one action -
  //      which reads to the user as a double-spend attempt.
  //   2. It monkey-patches the client, and that client belongs to the caller.
  if (!supplied) {
    const NONCE_TOO_LOW = /nonce too low|nonce provided for the transaction is lower/i
    const withNonceRetry = async <T>(op: () => Promise<T>): Promise<T> => {
      let lastErr: unknown
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          return await op()
        } catch (e) {
          lastErr = e
          if (!NONCE_TOO_LOW.test(String((e as {message?: string})?.message ?? e))) throw e
          await new Promise(r => setTimeout(r, 250 * (attempt + 1)))
        }
      }
      throw lastErr
    }
    const _writeContract = wallet.writeContract.bind(wallet)
    wallet.writeContract = ((args: Parameters<typeof wallet.writeContract>[0]) =>
      withNonceRetry(() => _writeContract(args))) as typeof wallet.writeContract
    const _sendTransaction = wallet.sendTransaction.bind(wallet)
    wallet.sendTransaction = ((args: Parameters<typeof wallet.sendTransaction>[0]) =>
      withNonceRetry(() => _sendTransaction(args))) as typeof wallet.sendTransaction
  }


  /**
   * The contract's own policy preconditions, checked BEFORE signing.
   *
   * Shared by every path that writes a policy so they reject identically. Failing
   * here costs nothing; discovering it as a revert costs the creation on the
   * atomic paths, and on the legacy path costs the slot its amendability forever.
   */
  async function validateRulePolicy(policy: RulePolicyArgs): Promise<Address> {
    const guardian = policy.guardian ?? ZERO_ADDRESS
    if (guardian.toLowerCase() === policy.admin.toLowerCase()) {
      throw new Error('rule policy: guardian must differ from admin')
    }
    if (guardian === ZERO_ADDRESS) {
      // READ the floor from the contract; never hardcode it. `MIN_RULE_TIMELOCK` is a
      // public constant, so duplicating it here would be a second source of truth that
      // drifts silently the day the contract changes - and it would drift in the
      // dangerous direction, accepting a policy the chain then rejects.
      const min = (await pub.readContract({
        address: requireAddress(addr, 'KeyRegistry'),
        abi: keyRegistryAbi,
        functionName: 'MIN_RULE_TIMELOCK',
      })) as number | bigint
      if (BigInt(policy.timelockSecs) < BigInt(min)) {
        throw new Error(
          `rule policy: a slot with no guardian needs a timelock of at least ${String(min)}s ` +
            `(MIN_RULE_TIMELOCK), got ${policy.timelockSecs}s`,
        )
      }
    }
    return guardian
  }

  /** The `RulePolicy` tuple the contract expects; all-zero means "immutable". */
  async function policyTuple(
    policy: RulePolicyArgs | undefined,
  ): Promise<{admin: Address; guardian: Address; timelock: number}> {
    if (!policy) return {admin: ZERO_ADDRESS, guardian: ZERO_ADDRESS, timelock: 0}
    const guardian = await validateRulePolicy(policy)
    return {admin: policy.admin, guardian, timelock: policy.timelockSecs}
  }

  /**
   * A one-shot creation reverts `CommitRevealRequired()` when the registry has `requireCommitReveal`
   * set, which every production genesis does. The remedy is a different call rather than a different
   * argument, so name it here: the raw revert says nothing about `createSlotCommitReveal`.
   */
  function rethrowCommitRevealRequired(e: unknown): never {
    const named = describeRevert(e) ?? ''
    if (`${named} ${String((e as Error | undefined)?.message ?? '')}`.includes('CommitRevealRequired')) {
      throw new Error(
        'createSlot: this deployment requires commit-reveal creation (KeyRegistry.requireCommitReveal is set) — ' +
          'use createSlotCommitReveal(), which commits the parameters and reveals once the beacon has advanced',
        {cause: e},
      )
    }
    throw e
  }

  /**
   * Resolve keeper-selection tags, rejecting BOTH ways a draw can be unseatable: an unfiltered
   * draw on a deployment whose active set holds non-keeper roles, and a FILTERED draw asking for
   * more of a tag than the active set carries.
   */
  async function resolveDrawTags(tags: string[] | undefined, n: number): Promise<Hex[]> {
    const chosen = tags ?? ['keykeeper']
    // The candidate count KeyRegistry judges a shortfall on: the candidate-array length for these
    // tags. ONE read, no per-operator loop - the same cost at 15 operators or 10,000 - and it does
    // not depend on the draw seed, so this never has to guess which committee the real draw picks.
    // ⚠ Returns null rather than trusting the decode: the caller compares it against n with a
    //   BigInt comparison, and `undefined < 5n` is a TypeError, not false — so a probe that comes
    //   back in any other shape would crash a create instead of quietly declining to judge it.
    const candidatesFor = async (tagHashes: Hex[]): Promise<bigint | null> => {
      const keyRegistry = requireAddress(addr, 'KeyRegistry')
      const nodeRegistry =
        addr.NodeRegistry ??
        await pub.readContract({address: keyRegistry, abi: keyRegistryAbi, functionName: 'nodeRegistry'})
      // Read back through `unknown`: the abi TYPES this as a 3-tuple, and that type is exactly what
      // must not be trusted here — the value arrives from an RPC (or, in the unit fixtures, a mock).
      const probe: unknown = await pub.readContract({
        address: nodeRegistry,
        abi: nodeRegistryAbi,
        functionName: 'drawActive',
        // minStake 0: this counts TAG MEMBERSHIP, not who could be drawn today. Folding stake
        // in would turn a funding problem into a message about tags.
        args: [tagHashes, 0n, 1, `0x${'00'.repeat(32)}`],
      })
      const candidates = Array.isArray(probe) ? (probe[1] as unknown) : undefined
      return typeof candidates === 'bigint' ? candidates : null
    }
    if (chosen.length > 0) {
      const hashes = chosen.map(t => keccak256(toHex(t)))
      // ⚠⚠ THE TAGGED PATH USED TO RETURN HERE WITHOUT LOOKING AT THE POOL AT ALL, and it is the
      //    DEFAULT path, so the commonest create had no pre-send check while the rare untagged one
      //    did. Measured 2026-09-29: a caller sized n from the keepers answering HTTP, one of the
      //    five was unbonding, and `revealKeySlot` reverted `InsufficientFilteredPool(4, 5)`.
      // ⚠ BEST EFFORT, DELIBERATELY: a guard that exists to improve a message must never become a
      //   new way to fail. If the pool cannot be read - no NodeRegistry in the book and a
      //   KeyRegistry that will not answer, an RPC hiccup - we send anyway and let the chain stay
      //   the authority. The untagged branch below keeps propagating, because there the read IS
      //   the safety judgement rather than a diagnostic.
      const candidates = await candidatesFor(hashes).catch(() => null)
      if (candidates !== null && filteredDrawCannotSeat(candidates, n)) {
        const named = chosen.map(t => `"${t}"`).join(' + ')
        throw new Error(
          `createSlot: this deployment has ${candidates} ACTIVE operator(s) carrying ${named}, ` +
            `but the slot asks for n=${n}, so the filtered draw cannot be seated and the chain ` +
            `would revert InsufficientFilteredPool(${candidates}, ${n}).\n` +
            'Refused before sending because the mistake is not recoverable: with commit-reveal the ' +
            'commit is already paid for and the shortfall surfaces only at the REVEAL.\n' +
            '⚠ A keeper answering HTTP is not necessarily ACTIVE here: unbonding, retired and ' +
            'slashed-to-deactivate operators keep serving while the registry excludes them from ' +
            'every draw. Size n from this count, not from how many endpoints respond.',
        )
      }
      return hashes
    }
    const keyRegistry = requireAddress(addr, 'KeyRegistry')
    const nodeRegistry =
      addr.NodeRegistry ??
      (await pub.readContract({address: keyRegistry, abi: keyRegistryAbi, functionName: 'nodeRegistry'}))
    const active = (await pub.readContract({
      address: nodeRegistry, abi: nodeRegistryAbi, functionName: 'activeCount',
    }))
    const tagged = await candidatesFor([keccak256(toHex('keykeeper'))])
    // Unreadable here is NOT best-effort: on this branch the count IS the safety judgement, so
    // declining to judge means declining to send. (Before the shared helper existed this path
    // reached `undefined > 0n` and died as a TypeError naming nothing.)
    if (tagged === null) throw new Error('createSlot: cannot read the keeper-tagged operator count, so an untagged draw cannot be cleared as safe')
    if (untaggedDrawSeatsNonKeepers(active, tagged)) {
      throw new Error(
        `createSlot: this deployment has ${active} active operators but only ${tagged} carry the ` +
          '`keykeeper` tag, so a draw with no tags can seat an accountant or a verifier — neither ' +
          'of which serves a key slot. Drop `tags: []` (the default is ["keykeeper"]).\n' +
          'Refused before sending because the mistake is not recoverable: the slot would be ' +
          'created and paid for, and its DKG would never run.',
      )
    }
    return []
  }

  /** Self-sign createKeySlotFiltered. Returns the slot id once the tx is mined. */
  async function createSlot(args: CreateSlotArgs | CreateSlotFromPolicyArgs): Promise<{slotId: Hex; txHash: Hex; ruleSalt: Hex; rule: string; relay?: RelayReceipt}> {
    const rule = await creationRule(args, 'createSlot')
    const slotId = args.slotId ?? random32()
    const salt = args.salt ?? random32()
    const ruleSalt = args.ruleSalt ?? random32()
    // Named `…Hash` only because `ruleCommitment` is the function that derives it;
    // this is the SALTED value the contract stores as `KeySlot.ruleCommitment`.
    const ruleCommitmentHash = ruleCommitment(ruleSalt, rule)
    const mode = modeIndex(args.mode)
    const auth = authTypeIndex(args.authType, args.mode)
    const tags = await resolveDrawTags(args.tags, args.n)
    // The `…WithPolicy` entry point is used only when there is a policy: a slot with
    // no amendment authority is created through the original function, so the common
    // path keeps its long-standing, widely-verified call shape.
    if (args.exportable && args.rulePolicy) {
      throw new Error(
        'createSlot: `exportable` and `rulePolicy` cannot be combined — there is no single ' +
          'entry point for both. Create an exportable slot without an amendment policy.',
      )
    }
    const keyRegistry = requireAddress(addr, 'KeyRegistry')
    const policy = args.rulePolicy ? await policyTuple(args.rulePolicy) : undefined
    const txHash = await (args.exportable
      ? sendCall(keyRegistry, keyRegistryAbi, 'createKeySlotFilteredExportable', [slotId, ruleCommitmentHash, args.k, args.n, mode, auth, salt, tags], 'createKeySlotFilteredExportable')
      : policy
      ? sendCall(keyRegistry, keyRegistryAbi, 'createKeySlotFilteredWithPolicy', [slotId, ruleCommitmentHash, args.k, args.n, mode, auth, salt, tags, policy], 'createKeySlotFilteredWithPolicy')
      : sendCall(keyRegistry, keyRegistryAbi, 'createKeySlotFiltered', [slotId, ruleCommitmentHash, args.k, args.n, mode, auth, salt, tags], 'createKeySlotFiltered')
    ).catch(rethrowCommitRevealRequired)
    await confirmed(pub, txHash, 'createKeySlotFiltered')
    // ruleSalt is returned because it exists NOWHERE else: without it the rule
    // can never be provisioned to a keeper.
    return {slotId, txHash, ruleSalt, rule, relay: lastRelay?.txHash === txHash ? lastRelay : undefined}
  }

  /**
   * Grinding-resistant slot creation - the production default:
   * commit the params, obtain an accountant seed for the commitment, then reveal+create in the
   * next transaction. There is NO beacon-epoch wait: without a seed it throws
   * {@link SlotSeedUnavailableError}, which says whether a commitment was sent and how to resume.
   * A beacon-epoch commitment made by an older SDK is reconciled by an explicit resume
   * (`recovery.commitTx`), which checks its target epoch once ({@link SlotRevealNotYetError}).
   */
  async function createSlotCommitReveal(
    args: (CreateSlotArgs | CreateSlotFromPolicyArgs) & CommitRevealOptions,
  ): Promise<{slotId: Hex; commitTx: Hex; revealTx: Hex; targetEpoch: number; ruleSalt: Hex; rule: string; seeded: boolean}> {
    args.signal?.throwIfAborted()
    // ⚠ The beacon-epoch path is gone. An untyped caller still passing `slotSeed: false` asked for
    //   the wait explicitly; refusing says so, where ignoring it would silently change the path.
    if ((args as {slotSeed?: unknown}).slotSeed === false) {
      throw new TasraError('createSlotCommitReveal: the beacon-epoch creation path was removed (it waited one to two beacon epochs); slots are created only with an accountant seed')
    }
    const seedRetryMs = args.slotSeedRetryMs ?? DEFAULT_SLOT_SEED_RETRY_MS
    const seedHedgeMs = args.slotSeedHedgeMs ?? DEFAULT_SLOT_SEED_HEDGE_MS
    if (args.exportable) throw new Error('Commit-reveal does not support raw-export slots')
    const rule = await creationRule(args, 'createSlotCommitReveal')
    const slotId = args.slotId ?? random32()
    const salt = args.salt ?? random32()
    const ruleSalt = args.ruleSalt ?? random32()
    const ruleCommitmentHash = ruleCommitment(ruleSalt, rule)
    const mode = modeIndex(args.mode)
    // `auth` is not an input to `computeCommitment` - the commitment deliberately
    // does not cover it, so it is passed at the REVEAL only.
    const auth = authTypeIndex(args.authType, args.mode)
    const tags = await resolveDrawTags(args.tags, args.n)
    // Application descriptors already pin KeyRegistry. Its configured beacon is
    // authoritative when the caller has no separate beacon address in its book.
    const beacon = addr.ThresholdRandomBeacon ?? await pub.readContract({
      address: requireAddress(addr, 'KeyRegistry'), abi: keyRegistryAbi, functionName: 'randomBeacon',
    })
    if (!beacon || beacon === '0x0000000000000000000000000000000000000000') throw new Error('KeyRegistry has no random beacon')
    // Validated UP FRONT, before the commit is signed. A policy the chain would
    // reject must not be discovered at the reveal, when the commit has already been paid for.
    const policy = args.rulePolicy ? await policyTuple(args.rulePolicy) : null

    const keyReg = requireAddress(addr, 'KeyRegistry')
    const commitmentFor = (s: Hex) => pub.readContract({
      address: keyReg,
      abi: keyRegistryAbi,
      functionName: 'computeCommitment',
      args: [slotId, ruleCommitmentHash, args.k, args.n, mode, s, tags, account.address],
    })
    const commitment = await commitmentFor(salt)
    const readCommit = async (c: Hex) => (await pub.readContract({address: keyReg, abi: keyRegistryAbi, functionName: 'slotCommits', args: [c]})) as readonly [bigint, bigint, string, boolean]
    const seedChain = () => createTasraChainClient({rpcUrl: cfg.rpcUrl, addresses: cfg.addresses, chainId: chain.id})

    const transact = async (step: 'commit' | 'reveal', name: string, values: readonly unknown[], seeded?: boolean): Promise<Hex> => {
      args.signal?.throwIfAborted()
      await args.recovery?.onTransaction({step, phase: 'submitting', seeded})
      args.signal?.throwIfAborted()
      const hash = await sendCall(keyReg, keyRegistryAbi, name, values, name)
      await args.recovery?.onTransaction({step, phase: 'submitted', hash, seeded})
      return hash
    }

    // ⚠⚠ WHICH REVEAL THE COMMIT ADMITS IS FIXED AT COMMIT (ADR-0080: one commitment, one draw).
    //   Only `commitKeySlotSeeded` admits the accountant-seeded reveal; `commitKeySlot` binds the
    //   BEACON-EPOCH one, which this SDK no longer sends: its reveal waits one to two beacon epochs
    //   (`COMMIT_GAP = 2`; one to two HOURS at the production cadence) and its seed comes from the
    //   same accountant set, so it adds a wait and no liveness.
    // A registry from before reveal paths (four-word `slotCommits`) admits both reveals from
    //   `commitKeySlot` and has no `commitKeySlotSeeded`; it keeps that call and is seeded too.
    let accountantUrls = args.accountantUrls
    let commitPath: CommitPath
    if (args.recovery?.commitTx) {
      // The saved commit decides; the creation it belongs to is checked against slotCommits below.
      commitPath = await readCommitPath(pub, keyReg, commitment)
    } else {
      let discovery: string | undefined
      const [urls, registry] = await Promise.all([
        accountantUrls ?? resolveAccountantUrls(seedChain()).catch((e: unknown) => {
          discovery = `accountant discovery failed: ${e instanceof Error ? e.message : String(e)}`
          return [] as string[]
        }),
        // Probed on this (not yet committed) commitment: a path-recording registry answers six
        // words for it, an older one four.
        readCommitPath(pub, keyReg, commitment),
      ])
      accountantUrls = urls
      // No accountant to ask means no seed, and no seed means no reveal: refuse BEFORE paying for
      // a commitment that could not be completed.
      if (!urls.length) {
        const failure: SlotSeedFailure = {rounds: 0, answers: [], reason: discovery ?? 'no accountant registered'}
        args.onSeedError?.(failure)
        throw new SlotSeedUnavailableError({slotId, committed: false, commitment, failure})
      }
      commitPath = registry === 'legacy' ? 'legacy' : 'seeded'
    }
    const seededCommit = commitPath === 'seeded'
    const commitName = seededCommit ? 'commitKeySlotSeeded' : 'commitKeySlot'
    const commitTx = args.recovery?.commitTx ?? await transact('commit', commitName, [commitment], seededCommit)
    await confirmed(pub, commitTx, commitName)
    await args.recovery?.onTransaction({step: 'commit', phase: 'confirmed', hash: commitTx, seeded: seededCommit})

    // slotCommits -> (targetEpoch, expiryEpoch, creator, used).
    const commit = await readCommit(commitment)
    const targetEpoch = Number(commit[0])

    // An older SDK completed a seeded-path commitment it could not seed through a SECOND commitment
    // on the epoch path, with a salt DERIVED from the first. A resumed creation must find it rather
    // than leave it dangling; this SDK never makes one.
    const fallbackSalt = keccak256(concat([toHex('tasra/slot-create/epoch-fallback/v1'), salt]))
    let fallback: {commitment: Hex; commit: readonly [bigint, bigint, string, boolean]} | null = null
    if (seededCommit && args.recovery) {
      const c = await commitmentFor(fallbackSalt)
      const fc = await readCommit(c)
      if (fc[2].toLowerCase() === account.address.toLowerCase()) fallback = {commitment: c, commit: fc}
    }
    if (args.recovery) {
      if (commit[2].toLowerCase() !== account.address.toLowerCase() || commit[0] === 0n) throw new TasraError('Saved creation does not match this creator and commitment')
      const consumed = commit[3] || Boolean(fallback?.commit[3])
      if (args.recovery.revealTx) {
        await confirmed(pub, args.recovery.revealTx, 'revealKeySlot')
        const done = (await readCommit(commitment))[3] || (fallback ? (await readCommit(fallback.commitment))[3] : false)
        if (!done) throw new TasraError('Saved reveal did not consume this commitment')
        await args.recovery.onTransaction({step: 'reveal', phase: 'confirmed', hash: args.recovery.revealTx, seeded: args.recovery.seeded})
        return {slotId, commitTx, revealTx: args.recovery.revealTx, targetEpoch: Number((fallback?.commit ?? commit)[0]), ruleSalt, rule, seeded: args.recovery.seeded ?? false}
      }
      if (consumed) throw new TasraError('Commitment already consumed; reconcile the reveal hash before continuing')
    }

    // RECOVERY OF AN EXISTING BEACON-EPOCH COMMITMENT (an older SDK's): one check, never a wait.
    //   Revealable now -> reveal once. Not yet -> SlotRevealNotYetError naming the epoch. Past its
    //   expiry -> SlotCommitmentExpiredError, as before.
    const epochCommit = fallback
      ? {commitment: fallback.commitment, commit: fallback.commit, salt: fallbackSalt}
      : commitPath === 'epoch' ? {commitment, commit, salt} : null
    if (epochCommit) {
      const target = Number(epochCommit.commit[0])
      const cur = Number(await pub.readContract({address: beacon, abi: thresholdRandomBeaconAbi, functionName: 'epoch'}))
      if (BigInt(cur) > epochCommit.commit[1]) throw new SlotCommitmentExpiredError(chain.id, keyReg, slotId, epochCommit.commitment, account.address, epochCommit.salt)
      if (cur < target) throw new SlotRevealNotYetError(slotId, epochCommit.commitment, target, cur, Number(epochCommit.commit[1]))
      // With a policy, the reveal PINS IT in the same transaction: as a follow-up call it is
      // unwinnable from a wallet that prompts, because the DKG starts the instant this lands.
      const revealTx = policy
        ? await transact('reveal', 'revealKeySlotWithPolicy', [slotId, ruleCommitmentHash, args.k, args.n, mode, auth, epochCommit.salt, tags, policy], false)
        : await transact('reveal', 'revealKeySlot', [slotId, ruleCommitmentHash, args.k, args.n, mode, auth, epochCommit.salt, tags], false)
      await confirmed(pub, revealTx, 'revealKeySlot')
      await args.recovery?.onTransaction({step: 'reveal', phase: 'confirmed', hash: revealTx, seeded: false})
      return {slotId, commitTx, revealTx, targetEpoch: target, ruleSalt, rule, seeded: false}
    }

    // A RESUMED commitment may have outlived its reveal window (a fresh one was committed a moment
    // ago and cannot have): say so before asking for a seed the reveal could not use.
    if (args.recovery) {
      const cur = await pub.readContract({address: beacon, abi: thresholdRandomBeaconAbi, functionName: 'epoch'})
      if (BigInt(cur) > commit[1]) throw new SlotCommitmentExpiredError(chain.id, keyReg, slotId, commitment, account.address, salt)
    }

    // THE CREATION PATH: ask the accountant set to threshold-sign this commitment, and reveal at once.
    // The seed is deterministic (one commitment, one BLS signature, one committee), so asking several
    // accountants concurrently or again later can never yield a different draw.
    let seed: SlotSeed | null = null
    let failure: SlotSeedFailure | undefined
    try {
      seed = await requestSlotSeed(seedChain(), keyReg, commitment, {
        urls: accountantUrls,
        timeoutMs: args.slotSeedTimeoutMs,
        // The commit receipt is in; an accountant whose view is a block behind answers 404, and
        // one already leading another creator's round answers 503. Both clear in well under a
        // second; the window bounds the rest.
        retryForMs: seedRetryMs,
        hedgeMs: seedHedgeMs,
        signal: args.signal,
        onFailure: f => { failure = f },
      })
    } catch (e) {
      if (args.signal?.aborted) throw e
      failure = {rounds: 0, answers: [], reason: `seed request failed: ${e instanceof Error ? e.message : String(e)}`}
    }
    if (!seed) {
      const f = failure ?? {rounds: 0, answers: [], reason: 'no seed'}
      args.onSeedError?.(f)
      throw new SlotSeedUnavailableError({slotId, committed: true, commitment, commitTx, expiryEpoch: Number(commit[1]), failure: f})
    }
    args.onSeed?.(seed)
    // A failed reveal is RETHROWN, never retried here: a relay submitter owns the retries of the one
    // request it signed, and a direct-wallet revert has left the commitment untouched, so resuming
    // the same creation (recovery.commitTx) asks for the same seed and reveals again.
    const seededTx = policy
      ? await transact('reveal', 'revealKeySlotWithSeedAndPolicy', [slotId, ruleCommitmentHash, args.k, args.n, mode, auth, salt, tags, seed.signature, policy], true)
      : await transact('reveal', 'revealKeySlotWithSeed', [slotId, ruleCommitmentHash, args.k, args.n, mode, auth, salt, tags, seed.signature], true)
    await confirmed(pub, seededTx, 'revealKeySlotWithSeed')
    await args.recovery?.onTransaction({step: 'reveal', phase: 'confirmed', hash: seededTx, seeded: true})
    return {slotId, commitTx, revealTx: seededTx, targetEpoch, ruleSalt, rule, seeded: true}
  }

  /** Prepay a slot's metered usage: approve TSRA then Settlement.fund(slot, amount). */
  async function fundSlot(slotId: Hex, amount: bigint): Promise<{approveTx: Hex; fundTx: Hex; relay?: RelayReceipt}> {
    const token = requireAddress(addr, 'TasraToken')
    const settlement = requireAddress(addr, 'Settlement')
    return oneFundingAtATime(`${chain.id}|${token}|${account.address}|${settlement}`.toLowerCase(), async () => {
      const approveTx = await wallet.writeContract({address: token, abi: tasraTokenAbi, functionName: 'approve', args: [settlement, amount]})
      await confirmed(pub, approveTx, 'approve')
      const fundTx = await sendCall(settlement, settlementAbi, 'fund', [slotId, amount], 'fund')
      await confirmed(pub, fundTx, 'fund')
      return {approveTx, fundTx, relay: relay ? lastRelay : undefined}
    })
  }

  /** Send native ETH (gas) - e.g. a funded key backing a faucet. */
  async function sendEth(to: Address, wei: bigint): Promise<Hex> {
    const h = await wallet.sendTransaction({to, value: wei})
    await confirmed(pub, h, 'sendEth')
    return h
  }

  /** Transfer TSRA - e.g. a faucet handing tokens to a fresh client. */
  async function transferTsra(to: Address, amount: bigint): Promise<Hex> {
    const h = await wallet.writeContract({address: requireAddress(addr, 'TasraToken'), abi: tasraTokenAbi, functionName: 'transfer', args: [to, amount]})
    await confirmed(pub, h, 'transfer')
    return h
  }

  /** EURC the curve prices in (the real Circle token, or the demo mock on a dev/test chain). */
  async function eurcBalance(a: Address): Promise<bigint> {
    return (await pub.readContract({address: requireAddress(addr, 'MockEurc'), abi: mockEurcAbi, functionName: 'balanceOf', args: [a]}))
  }
  /** Approve EURC to the bonding curve - an ERC-20 approve, always from the local key. */
  async function approveEurcForCurve(amount: bigint): Promise<Hex> {
    const h = await wallet.writeContract({address: requireAddress(addr, 'MockEurc'), abi: mockEurcAbi, functionName: 'approve', args: [requireAddress(addr, 'BondingCurve'), amount]})
    await confirmed(pub, h, 'approve')
    return h
  }
  /** DEV/TEST only: mint the demo MockEurc (permissionless faucet). Fails against real EURC. */
  async function mintMockEurc(to: Address, amount: bigint): Promise<Hex> {
    const actualChainId = await pub.getChainId()
    const token = requireAddress(addr, 'MockEurc')
    const profile = resolveNetworkProfile(networkNameForChain(actualChainId), {chainId: actualChainId, eurcAddress: token})
    assertEurcFaucetAllowed(profile, actualChainId, token)
    const h = await wallet.writeContract({address: requireAddress(addr, 'MockEurc'), abi: mockEurcAbi, functionName: 'mint', args: [to, amount]})
    await confirmed(pub, h, 'mint')
    return h
  }
  //  slot lifecycle (KeyRegistry; gated to the slot's creator/owner)
  /** Rotate a slot's key - re-DKG under a new epoch. */
  async function rotateKey(slotId: Hex, reason = ''): Promise<Hex> {
    const h = await wallet.writeContract({address: requireAddress(addr, 'KeyRegistry'), abi: keyRegistryAbi, functionName: 'rotateKey', args: [slotId, reason]})
    await confirmed(pub, h, 'rotateKey')
    return h
  }
  /** Reshare a slot to a new operator set / threshold. */
  async function reshareKey(slotId: Hex, newOperators: Address[], k: number, n: number, reason = ''): Promise<Hex> {
    const h = await wallet.writeContract({address: requireAddress(addr, 'KeyRegistry'), abi: keyRegistryAbi, functionName: 'reshareKey', args: [slotId, newOperators, k, n, reason]})
    await confirmed(pub, h, 'reshareKey')
    return h
  }
  /** Cancel a slot. */
  async function cancelSlot(slotId: Hex): Promise<Hex> {
    const h = await wallet.writeContract({address: requireAddress(addr, 'KeyRegistry'), abi: keyRegistryAbi, functionName: 'cancelSlot', args: [slotId]})
    await confirmed(pub, h, 'cancelSlot')
    return h
  }
  /** Renew a slot's lease. `renew` is creator-only, so this must be signed by the slot's creator -
   *  routed through `sendCall` so it relays (ERC-2771 forward) when a relay is configured, exactly
   *  like `createSlot`. A direct `writeContract` here would sign with the local key, which is not
   *  the creator when the slot was created under a forwarded (`_msgSender()`) identity. */
  async function renewSlot(slotId: Hex): Promise<Hex> {
    const h = await sendCall(requireAddress(addr, 'KeyRegistry'), keyRegistryAbi, 'renew', [slotId], 'renew')
    await confirmed(pub, h, 'renew')
    return h
  }
  /** Set the slot's per-request verifier-committee policy: committee
   *  draw size + signing quorum. */
  async function setVerifierPolicy(slotId: Hex, committee: number, quorum: number, onTransaction?: (event: {phase: 'submitting' | 'submitted' | 'confirmed'; hash?: Hex}) => Promise<void>): Promise<Hex> {
    await onTransaction?.({phase: 'submitting'})
    const h = await sendCall(requireAddress(addr, 'KeyRegistry'), keyRegistryAbi, 'setVerifierPolicy', [slotId, committee, quorum], 'setVerifierPolicy')
    await onTransaction?.({phase: 'submitted', hash: h})
    await confirmed(pub, h, 'setVerifierPolicy')
    await onTransaction?.({phase: 'confirmed', hash: h})
    return h
  }

  /**
   * Pin amendment authority while the slot is fresh. Prefer passing rulePolicy at creation so key generation cannot win the race. The guardian must differ from the administrator, and omitting a guardian requires the contract minimum timelock.
   */
  async function setRulePolicy(slotId: Hex, policy: RulePolicyArgs): Promise<Hex> {
    const keyReg = requireAddress(addr, 'KeyRegistry')
    const guardian = await validateRulePolicy(policy)
    const h = await wallet.writeContract({
      address: keyReg,
      abi: keyRegistryAbi,
      functionName: 'setRulePolicy',
      args: [slotId, policy.admin, guardian, policy.timelockSecs],
    })
    await confirmed(pub, h, 'setRulePolicy')
    return h
  }

  //  rule amendment (KeyRegistry.proposeRuleUpdate / endorse / veto / activate)
  // Every refusal below is raised BEFORE `sendCall`: a proposal no keeper will store never
  // activates, and on a slot without a guardian nobody can clear it.
  /** Propose a new rule as the slot's rule admin; checks every contract precondition first. */
  async function proposeRuleUpdate(a: ProposeRuleArgs): Promise<ProposeRuleResult> {
    const what = 'proposeRuleUpdate'
    requireBytes32(a.slotId, 'slotId', what)
    requireBytes32(a.ruleSalt, 'ruleSalt', what)
    const rule = await resolveAmendmentRule(a, what)
    const keyRegistry = requireAddress(addr, 'KeyRegistry')
    const state = await readAmendmentOnChain(pub.readContract, keyRegistry, a.slotId)
    if (sameAddress(state.admin, ZERO_ADDRESS)) throw immutableError(a.slotId)
    if (!sameAddress(account.address, state.admin)) {
      throw new RuleAmendmentError(
        'not-admin',
        a.slotId,
        `${what}: slot ${a.slotId} has rule admin ${state.admin}, but this client signs as ${account.address} ` +
          '(a relayed call is still signed by this account). Use a write client for the rule admin key',
      )
    }
    if (state.pending) throw pendingError(a.slotId, state)
    await amendmentPreflight(rule, state, a.slotId, what)
    const commitment = ruleCommitment(a.ruleSalt, rule)
    if (commitment.toLowerCase() === state.ruleCommitment.toLowerCase()) {
      throw new RuleAmendmentError(
        'same-rule',
        a.slotId,
        `${what}: slot ${a.slotId} already enforces this rule (same salted commitment ${commitment}); nothing to amend`,
      )
    }
    const txHash = await sendCall(keyRegistry, keyRegistryAbi, 'proposeRuleUpdate', [a.slotId, commitment], what)
    const receipt = await confirmed(pub, txHash, what)
    const proposed = parseEventLogs({abi: keyRegistryAbi, eventName: 'RuleUpdateProposed', logs: receipt.logs})
      .find(l => sameAddress(l.address, keyRegistry) && l.args.slotId.toLowerCase() === a.slotId.toLowerCase())
    if (!proposed) {
      throw new TasraError(`${what}: tx ${txHash} confirmed but carries no RuleUpdateProposed event for slot ${a.slotId}`)
    }
    return {
      slotId: a.slotId,
      txHash,
      version: Number(proposed.args.version),
      notBefore: Number(proposed.args.notBefore),
      ruleCommitment: commitment,
      ruleSalt: a.ruleSalt,
      rule,
      relay: lastRelay?.txHash === txHash ? lastRelay : undefined,
    }
  }

  /** Endorse or veto the pending amendment as the slot's guardian. */
  async function guardianCall(slotId: Hex, functionName: 'endorseRuleUpdate' | 'vetoRuleUpdate'): Promise<Hex> {
    requireBytes32(slotId, 'slotId', functionName)
    const keyRegistry = requireAddress(addr, 'KeyRegistry')
    const state = await readAmendmentOnChain(pub.readContract, keyRegistry, slotId)
    if (sameAddress(state.guardian, ZERO_ADDRESS)) {
      throw new RuleAmendmentError('not-guardian', slotId, `${functionName}: slot ${slotId} has no rule guardian, so nobody can call it`, {hasGuardian: false})
    }
    if (!sameAddress(account.address, state.guardian)) {
      throw new RuleAmendmentError(
        'not-guardian',
        slotId,
        `${functionName}: slot ${slotId} has rule guardian ${state.guardian}, but this client signs as ${account.address}. ` +
          'Use a write client for the guardian key',
        {hasGuardian: true},
      )
    }
    if (!state.pending) {
      throw new RuleAmendmentError('no-pending', slotId, `${functionName}: slot ${slotId} has no pending rule amendment`)
    }
    const h = await sendCall(keyRegistry, keyRegistryAbi, functionName, [slotId], functionName)
    await confirmed(pub, h, functionName)
    return h
  }
  const endorseRuleUpdate = (slotId: Hex) => guardianCall(slotId, 'endorseRuleUpdate')
  const vetoRuleUpdate = (slotId: Hex) => guardianCall(slotId, 'vetoRuleUpdate')

  /** Activate the pending amendment once chain time and keeper adoption allow it. */
  async function activateRuleUpdate(slotId: Hex): Promise<Hex> {
    const what = 'activateRuleUpdate'
    requireBytes32(slotId, 'slotId', what)
    const keyRegistry = requireAddress(addr, 'KeyRegistry')
    const state = await readAmendmentOnChain(pub.readContract, keyRegistry, slotId, {withVotes: true})
    const pending = state.pending
    if (!pending) throw new RuleAmendmentError('no-pending', slotId, `${what}: slot ${slotId} has no pending rule amendment`)
    // The contract compares `block.timestamp`, so the check must too: the local clock can be far
    // ahead of an idle chain.
    const block = await pub.getBlock({blockTag: 'latest'})
    const chainTime = Number(block.timestamp)
    if (chainTime < pending.notBefore) {
      throw new RuleAmendmentError(
        'timelock',
        slotId,
        `${what}: amendment version ${pending.version} of slot ${slotId} may activate from chain time ${pending.notBefore}; ` +
          `the latest block is at ${chainTime} (${pending.notBefore - chainTime}s to go)`,
        {notBefore: pending.notBefore, chainTime, pendingVersion: pending.version},
      )
    }
    const have = pending.adoptions ?? 0
    const need = pending.needed ?? 0
    if (have < need) {
      throw new RuleAmendmentError(
        'below-threshold',
        slotId,
        `${what}: amendment version ${pending.version} of slot ${slotId} has ${have} of ${need} keeper adoptions; ` +
          'keepers adopt it once they hold the rule - deliver it with provisionRule({expect: \'pending\'})',
        {have, need, pendingVersion: pending.version},
      )
    }
    const h = await sendCall(keyRegistry, keyRegistryAbi, what, [slotId], what)
    await confirmed(pub, h, what)
    return h
  }

  //  slot hand-offs (KeyRegistry.proposeCreator / acceptCreator / proposeRuleAdmin / acceptRuleAdmin)
  // Each step judges from one read, refuses before signing, and reads the slot again to confirm.
  /** Send one hand-off step, then return the slot's state read back. */
  async function handoffStep(
    slotId: Hex,
    what: string,
    functionName: 'proposeCreator' | 'acceptCreator' | 'proposeRuleAdmin' | 'acceptRuleAdmin',
    args: readonly unknown[],
    verdict: (s: SlotHandoffStatus) => void,
    alsoRequire?: () => Promise<void>,
  ): Promise<{txHash: Hex; before: SlotHandoffStatus; after: SlotHandoffStatus}> {
    requireBytes32(slotId, 'slotId', what)
    const keyRegistry = requireAddress(addr, 'KeyRegistry')
    const before = await readHandoffOnChain(pub.readContract, keyRegistry, slotId)
    verdict(before)
    await alsoRequire?.()
    const txHash = await sendCall(keyRegistry, keyRegistryAbi, functionName, args, what)
    await confirmed(pub, txHash, what)
    return {txHash, before, after: await readHandoffOnChain(pub.readContract, keyRegistry, slotId)}
  }
  const notConfirmed = (slotId: Hex, what: string, txHash: Hex, seen: string) =>
    new SlotHandoffError('not-confirmed', slotId, `${what}: tx ${txHash} confirmed but slot ${slotId} shows ${seen}`)
  const requireRecipient = (to: Address, what: string, withdraw: string) => {
    if (typeof to !== 'string' || !isAddress(to, {strict: false}) || sameAddress(to, ZERO_ADDRESS)) {
      throw new TasraError(`${what}: to must be a non-zero address; withdraw with ${withdraw}`)
    }
  }
  // Keepers recover every creator signature (operation, payment intent, execution certificate) with
  // ecrecover; there is no contract-signature path, so a contract creator could never sign a paid
  // operation of the slot. An EIP-7702 delegated account still signs with its own key.
  const requireAccountRecipient = async (slotId: Hex, to: Address, what: string) => {
    const code = await pub.getCode({address: to})
    if (code && code !== '0x' && !/^0xef0100[0-9a-f]{40}$/i.test(code)) {
      throw new SlotHandoffError('contract-holder', slotId, `${what}: ${to} is a contract; keepers accept creator signatures from an externally owned account only, ` +
        'so a contract creator could not sign any paid operation of this slot')
    }
  }

  /** Offer the slot to `to` as its creator; see {@link TasraWriteClient.proposeSlotTransfer}. */
  async function proposeSlotTransfer(slotId: Hex, to: Address): Promise<SlotTransferProposal> {
    const what = 'proposeSlotTransfer'
    requireRecipient(to, what, 'withdrawSlotTransfer')
    const {txHash, before, after} = await handoffStep(slotId, what, 'proposeCreator', [slotId, to], s =>
      creatorOfferVerdict(s, slotId, account.address, to), () => requireAccountRecipient(slotId, to, what),
    )
    if (!after.pendingCreator || !sameAddress(after.pendingCreator, to)) {
      throw notConfirmed(slotId, what, txHash, `pending creator ${after.pendingCreator ?? 'none'}`)
    }
    let prepaidBalance: bigint | undefined
    let reservedBalance: bigint | undefined
    if (addr.Settlement) {
      const settlement = addr.Settlement
      prepaidBalance = await pub.readContract({address: settlement, abi: settlementAbi, functionName: 'balanceOf', args: [slotId]})
      // Absent on a Settlement without prepaid reservations.
      reservedBalance = await pub
        .readContract({address: settlement, abi: settlementAbi, functionName: 'reservedBalanceOf', args: [slotId]})
        .catch(() => undefined)
    }
    return {
      slotId,
      txHash,
      to,
      ruleAdmin: before.ruleAdmin,
      guardian: before.guardian,
      callerIsRuleAdmin: !!before.ruleAdmin && sameAddress(before.ruleAdmin, account.address),
      ...(prepaidBalance !== undefined ? {prepaidBalance} : {}),
      ...(reservedBalance !== undefined ? {reservedBalance} : {}),
      relay: lastRelay?.txHash === txHash ? lastRelay : undefined,
    }
  }
  /** Withdraw the pending creator offer; creator only. */
  async function withdrawSlotTransfer(slotId: Hex): Promise<Hex> {
    const what = 'withdrawSlotTransfer'
    const {txHash, after} = await handoffStep(slotId, what, 'proposeCreator', [slotId, ZERO_ADDRESS], s =>
      creatorOfferVerdict(s, slotId, account.address, ZERO_ADDRESS),
    )
    if (after.pendingCreator) throw notConfirmed(slotId, what, txHash, `pending creator ${after.pendingCreator}`)
    return txHash
  }
  /** Become the slot's creator; the offered wallet only. */
  async function acceptSlotTransfer(slotId: Hex): Promise<Hex> {
    const what = 'acceptSlotTransfer'
    const {txHash, after} = await handoffStep(slotId, what, 'acceptCreator', [slotId], s => creatorAcceptVerdict(s, slotId, account.address))
    if (!sameAddress(after.creator, account.address) || after.pendingCreator) throw notConfirmed(slotId, what, txHash, `creator ${after.creator}`)
    return txHash
  }
  /** Offer the slot's rule admin role to `to`; rule admin only, never to the guardian. */
  async function proposeRuleAdminTransfer(slotId: Hex, to: Address): Promise<Hex> {
    const what = 'proposeRuleAdminTransfer'
    requireRecipient(to, what, 'withdrawRuleAdminTransfer')
    const {txHash, after} = await handoffStep(slotId, what, 'proposeRuleAdmin', [slotId, to], s =>
      adminOfferVerdict(s, slotId, account.address, to),
    )
    if (!after.pendingRuleAdmin || !sameAddress(after.pendingRuleAdmin, to)) {
      throw notConfirmed(slotId, what, txHash, `pending rule admin ${after.pendingRuleAdmin ?? 'none'}`)
    }
    return txHash
  }
  /** Withdraw the pending rule admin offer; rule admin only. */
  async function withdrawRuleAdminTransfer(slotId: Hex): Promise<Hex> {
    const what = 'withdrawRuleAdminTransfer'
    const {txHash, after} = await handoffStep(slotId, what, 'proposeRuleAdmin', [slotId, ZERO_ADDRESS], s =>
      adminOfferVerdict(s, slotId, account.address, ZERO_ADDRESS),
    )
    if (after.pendingRuleAdmin) throw notConfirmed(slotId, what, txHash, `pending rule admin ${after.pendingRuleAdmin}`)
    return txHash
  }
  /** Become the slot's rule admin; the offered wallet only. */
  async function acceptRuleAdminTransfer(slotId: Hex): Promise<Hex> {
    const what = 'acceptRuleAdminTransfer'
    const {txHash, after} = await handoffStep(slotId, what, 'acceptRuleAdmin', [slotId], s => adminAcceptVerdict(s, slotId, account.address))
    if (!after.ruleAdmin || !sameAddress(after.ruleAdmin, account.address) || after.pendingRuleAdmin) {
      throw notConfirmed(slotId, what, txHash, `rule admin ${after.ruleAdmin ?? 'none'}`)
    }
    return txHash
  }

  //  TASRA tokenomics (BondingCurve / TasraToken)
  /** Buy TSRA from the bonding curve. Approve `eurcAmount` of EURC to the
   *  BondingCurve first; read balances for the fill. */
  async function buyTsra(eurcAmount: bigint, minTsraOut: bigint): Promise<Hex> {
    const h = await sendCall(requireAddress(addr, 'BondingCurve'), bondingCurveAbi, 'buy', [eurcAmount, minTsraOut], 'buy')
    await confirmed(pub, h, 'buy')
    return h
  }
  /** Redeem TSRA back to the bonding curve (approves TSRA to the curve first).
   *  `minEurcOut` is the slippage floor the pre-audit hardening added to `redeem` (the
   *  VWAP can move between the read and the inclusion); `0n` accepts any fill. */
  async function redeemTsra(tsraAmount: bigint, minEurcOut: bigint = 0n): Promise<{approveTx: Hex; redeemTx: Hex}> {
    const curve = requireAddress(addr, 'BondingCurve')
    const approveTx = await wallet.writeContract({address: requireAddress(addr, 'TasraToken'), abi: tasraTokenAbi, functionName: 'approve', args: [curve, tsraAmount]})
    await confirmed(pub, approveTx, 'approve')
    const redeemTx = await wallet.writeContract({address: curve, abi: bondingCurveAbi, functionName: 'redeem', args: [tsraAmount, minEurcOut]})
    await confirmed(pub, redeemTx, 'redeem')
    return {approveTx, redeemTx}
  }
  /** Burn TSRA from the caller's balance (deflationary). */
  async function burnTsra(amount: bigint): Promise<Hex> {
    const h = await wallet.writeContract({address: requireAddress(addr, 'TasraToken'), abi: tasraTokenAbi, functionName: 'burn', args: [amount]})
    await confirmed(pub, h, 'burn')
    return h
  }
  const spotPrice = () =>
    pub.readContract({address: requireAddress(addr, 'BondingCurve'), abi: bondingCurveAbi, functionName: 'spotPrice'})
  const priceAt = (sold: bigint) =>
    pub.readContract({address: requireAddress(addr, 'BondingCurve'), abi: bondingCurveAbi, functionName: 'priceAt', args: [sold]})

  //  treasury / vault (owner / refunder gated)
  async function treasuryWithdraw(to: Address, amount: bigint): Promise<Hex> {
    const h = await wallet.writeContract({address: requireAddress(addr, 'Treasury'), abi: treasuryAbi, functionName: 'withdraw', args: [to, amount]})
    await confirmed(pub, h, 'withdraw')
    return h
  }
  async function treasuryRefund(to: Address, amount: bigint): Promise<Hex> {
    const h = await wallet.writeContract({address: requireAddress(addr, 'Treasury'), abi: treasuryAbi, functionName: 'refund', args: [to, amount]})
    await confirmed(pub, h, 'refund')
    return h
  }
  /** Release vested TSRA from one tranche's vault to its beneficiary. */
  async function vaultRelease(tranche: VaultTranche): Promise<Hex> {
    const h = await wallet.writeContract({address: requireVaultAddress(addr, tranche), abi: tasraVestingVaultAbi, functionName: 'release', args: []})
    await confirmed(pub, h, 'release')
    return h
  }

  const tsraBalance = (of?: Address) =>
    pub.readContract({address: requireAddress(addr, 'TasraToken'), abi: tasraTokenAbi, functionName: 'balanceOf', args: [of ?? account.address]})
  const ethBalance = (of?: Address) => pub.getBalance({address: of ?? account.address})
  const settlementBalance = (slotId: Hex) =>
    pub.readContract({address: requireAddress(addr, 'Settlement'), abi: settlementAbi, functionName: 'balanceOf', args: [slotId]})

  return {
    account,
    address: account.address,
    createSlot,
    createSlotCommitReveal,
    fundSlot,
    sendEth,
    transferTsra,
    // slot lifecycle
    rotateKey,
    reshareKey,
    cancelSlot,
    renewSlot,
    setVerifierPolicy,
    setRulePolicy,
    // rule amendment
    proposeRuleUpdate,
    endorseRuleUpdate,
    vetoRuleUpdate,
    activateRuleUpdate,
    // slot hand-offs
    proposeSlotTransfer,
    withdrawSlotTransfer,
    acceptSlotTransfer,
    proposeRuleAdminTransfer,
    withdrawRuleAdminTransfer,
    acceptRuleAdminTransfer,
    // tokenomics
    buyTsra,
    approveEurcForCurve,
    mintMockEurc,
    eurcBalance,
    /** True when sender-bound calls are relayed. */
    relayEnabled: !!relay,
    /** Receipt of the most recent relayed call (id, tx, gas the relayer paid). */
    lastRelay: () => lastRelay,
    pendingRelayAttempt: () => registeredRelay?.pendingAttempt(),
    reconcileRelay: async () => {
      const result = await registeredRelay?.reconcile()
      if (result?.receipt) lastRelay = result.receipt
      return result
    },
    redeemTsra,
    burnTsra,
    spotPrice,
    priceAt,
    // treasury / vault
    treasuryWithdraw,
    treasuryRefund,
    vaultRelease,
    // reads
    tsraBalance,
    ethBalance,
    settlementBalance,
    wallet,
    pub,
  }
}

/**
 * Account-bound operations for slot creation, lifecycle management, settlement funding and token transactions.
 */
export interface TasraWriteClient {
  /** The account every write is signed with. */
  account: Account
  /** Convenience alias for `account.address`. */
  address: Address
  /** The underlying wallet client. */
  wallet: WalletClient<Transport, Chain, Account>
  /** A read client on the same RPC, used for receipts and balance reads. */
  pub: PublicClient

  /**
   * Create a slot directly. Persist the generated slot ID and rule salt; provisioning requires the saved salt. Use prepared creation to persist the intent before submission.
   * A `kk_oauth` policy envelope (as `rule`, or authored as `oauthPolicy`) requires `authType: 'oauth'` and must pass the network's gate; both are checked before any chain call. `rule` in the result is the exact string committed.
   */
  createSlot(args: CreateSlotArgs | CreateSlotFromPolicyArgs): Promise<{slotId: Hex; txHash: Hex; ruleSalt: Hex; rule: string; relay?: RelayReceipt}>
  /**
   * Create a slot using commit-reveal with an accountant seed; never waits for a beacon epoch (throws `SlotSeedUnavailableError` without a seed). Persist the slot ID and rule salt; prepared creation preserves them before submission.
   * Policy envelopes are checked as for `createSlot`; `rule` in the result is the exact string committed.
   */
  createSlotCommitReveal(
    args: (CreateSlotArgs | CreateSlotFromPolicyArgs) & CommitRevealOptions,
  ): Promise<{slotId: Hex; commitTx: Hex; revealTx: Hex; targetEpoch: number; ruleSalt: Hex; rule: string; seeded: boolean}>
  /**
   * Approve TSRA and fund the slot settlement balance in token base units.
   */
  fundSlot(slotId: Hex, amount: bigint): Promise<{approveTx: Hex; fundTx: Hex; relay?: RelayReceipt}>
  /**
   * Send native currency in base units and wait for a successful receipt.
   */
  sendEth(to: Address, wei: bigint): Promise<Hex>
  /**
   * Transfer TSRA in token base units and wait for confirmation.
   */
  transferTsra(to: Address, amount: bigint): Promise<Hex>
  /**
   * Request a new distributed key generation epoch for the slot.
   */
  rotateKey(slotId: Hex, reason?: string): Promise<Hex>
  /**
   * Redistribute the slot key among the supplied operators using the new threshold.
   */
  reshareKey(slotId: Hex, newOperators: Address[], k: number, n: number, reason?: string): Promise<Hex>
  /**
   * Cancel the slot using the configured account authority.
   */
  cancelSlot(slotId: Hex): Promise<Hex>
  /**
   * Renew the slot lease; the configured account must be its creator.
   */
  renewSlot(slotId: Hex): Promise<Hex>
  /**
   * Set the verifier committee size and quorum, optionally persisting transaction progress.
   */
  setVerifierPolicy(slotId: Hex, committee: number, quorum: number, onTransaction?: (event: {phase: 'submitting' | 'submitted' | 'confirmed'; hash?: Hex}) => Promise<void>): Promise<Hex>
  /**
   * Pin amendment authority while the slot is fresh. Prefer passing rulePolicy at creation so key generation cannot win the race. The guardian must differ from the administrator, and omitting a guardian requires the contract minimum timelock.
   */
  setRulePolicy(slotId: Hex, policy: RulePolicyArgs): Promise<Hex>
  /**
   * Propose a new rule for the slot, signed by its rule admin (relayed calls are still signed by this account). The slot's saved `ruleSalt` is reused.
   * Refused before signing, as a `RuleAmendmentError`: a missing slot, an immutable slot, a signer that is not the rule admin, an amendment already pending, a policy envelope on a slot not created with `authType: 'oauth'`, an envelope keepers would not store, and the current rule.
   * An amendable rule means whoever holds the admin key can change who may sign with this key, without changing the key: keep the admin key as safe as the slot itself. The guardian can veto during the delay; without a guardian nobody can. A slot created without a rule admin can never become amendable.
   * Deliver the returned `rule` with `provisionRule({expect: 'pending'})`; the amendment activates only once enough keepers hold it.
   */
  proposeRuleUpdate(a: ProposeRuleArgs): Promise<ProposeRuleResult>
  /**
   * Waive the remaining delay of the pending amendment, signed by the slot's guardian. Refuses `not-guardian` and `no-pending` before signing.
   */
  endorseRuleUpdate(slotId: Hex): Promise<Hex>
  /**
   * Discard the pending amendment, signed by the slot's guardian. Refuses `not-guardian` and `no-pending` before signing.
   */
  vetoRuleUpdate(slotId: Hex): Promise<Hex>
  /**
   * Activate the pending amendment; anyone may send it. Refuses `no-pending`, `timelock` (judged on the latest block timestamp, not the local clock) and `below-threshold` before signing.
   */
  activateRuleUpdate(slotId: Hex): Promise<Hex>

  /**
   * Offer the slot to `to` as its next creator, signed by the current creator. It moves only when `to` accepts with acceptSlotTransfer; a new offer replaces an earlier one.
   * Only the creator moves: the rule admin and the guardian stay, and the result names them. When this account is also the rule admin, hand that role over separately with proposeRuleAdminTransfer.
   * At acceptance every delegation and unused prepaid payment intent this account signed for the slot stops working; reservations already accepted still settle. The prepaid credit goes with the slot and nothing is refunded; the result carries the balance when a Settlement address is configured.
   * Refused before signing, as a `SlotHandoffError`: `no-slot`, `cancelled`, `unsupported` (a KeyRegistry without the hand-off), `not-creator`, `same-holder`, `already-offered`, `self-custody` (the slot's own threshold account, which could never sign a paid operation of itself again) and `contract-holder` (keepers accept creator signatures from an externally owned account only).
   */
  proposeSlotTransfer(slotId: Hex, to: Address): Promise<SlotTransferProposal>
  /**
   * Withdraw the pending creator offer, signed by the creator. Refuses `not-creator` and `nothing-pending` before signing.
   */
  withdrawSlotTransfer(slotId: Hex): Promise<Hex>
  /**
   * Become the slot's creator, signed by the offered wallet. Refuses `nothing-pending`, `not-offered` and `self-custody` before signing.
   * Afterwards sign fresh delegations for the apps that use the slot and update their configuration: the previous creator's delegations no longer verify.
   */
  acceptSlotTransfer(slotId: Hex): Promise<Hex>
  /**
   * Offer the slot's rule admin role to `to`, signed by the rule admin. It moves only when `to` accepts. It can never go to the guardian, and the guardian is not asked.
   * Refuses `immutable`, `not-admin`, `same-holder`, `guardian` and `already-offered` before signing.
   */
  proposeRuleAdminTransfer(slotId: Hex, to: Address): Promise<Hex>
  /**
   * Withdraw the pending rule admin offer, signed by the rule admin. Refuses `not-admin` and `nothing-pending` before signing.
   */
  withdrawRuleAdminTransfer(slotId: Hex): Promise<Hex>
  /**
   * Become the slot's rule admin, signed by the offered wallet. Refuses `nothing-pending`, `not-offered` and `guardian` before signing.
   */
  acceptRuleAdminTransfer(slotId: Hex): Promise<Hex>

  /**
   * Buy TSRA with approved EURC while enforcing the minimum output amount.
   */
  buyTsra(eurcAmount: bigint, minTsraOut: bigint): Promise<Hex>
  /**
   * Approve the bonding curve to spend the specified EURC base units.
   */
  approveEurcForCurve(amount: bigint): Promise<Hex>
  /**
   * Mint test EURC only after verifying the network and mock-token faucet policy.
   */
  mintMockEurc(to: Address, amount: bigint): Promise<Hex>
  /**
   * Read an account EURC balance in base units.
   */
  eurcBalance(a: Address): Promise<bigint>
  /**
   * Approve and redeem TSRA for EURC, enforcing any minimum output.
   */
  redeemTsra(tsraAmount: bigint, minEurcOut?: bigint): Promise<{approveTx: Hex; redeemTx: Hex}>
  /**
   * Permanently burn TSRA from the configured account.
   */
  burnTsra(amount: bigint): Promise<Hex>
  /**
   * Read the current bonding-curve spot price.
   */
  spotPrice(): Promise<bigint>
  /**
   * Read the bonding-curve price at the supplied sold-token amount.
   */
  priceAt(sold: bigint): Promise<bigint>

  /**
   * Request an authorized treasury withdrawal to the recipient.
   */
  treasuryWithdraw(to: Address, amount: bigint): Promise<Hex>
  /**
   * Request an authorized treasury refund to the recipient.
   */
  treasuryRefund(to: Address, amount: bigint): Promise<Hex>
  /**
   * Release currently vested tokens for the named allocation.
   */
  vaultRelease(tranche: VaultTranche): Promise<Hex>

  /**
   * Read TSRA base units for the supplied account or the configured signer.
   */
  tsraBalance(of?: Address): Promise<bigint>
  /**
   * Read native-token base units for the supplied account or configured signer.
   */
  ethBalance(of?: Address): Promise<bigint>
  /**
   * Read the prepaid TSRA settlement balance of a slot.
   */
  settlementBalance(slotId: Hex): Promise<bigint>

  /** Whether writes are submitted through a registered relay rather than directly. */
  relayEnabled: boolean
  /**
   * Return the last verified relay receipt, if any.
   */
  lastRelay(): RelayReceipt | undefined
  /**
   * Return the signed relay attempt awaiting reconciliation, if any.
   */
  pendingRelayAttempt(): RelayAttempt | undefined
  /**
   * Inspect the pending attempt against the chain without signing a replacement.
   */
  reconcileRelay(): Promise<{receipt?: RelayReceipt; expired: boolean} | undefined>
}
