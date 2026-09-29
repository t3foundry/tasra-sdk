import {requireRule, type RuleInput} from './ruleInput.js'
import {networkNameForChain, resolveNetworkProfile, assertEurcFaucetAllowed} from './networks.js'
import {SlotCommitmentExpiredError} from './commitmentRecovery.js'
import {requestSlotSeed, type SlotSeed} from './slotSeed.js'
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
// Lives in the `tasra-sdk/chain` subpath (viem). Browser + Node (uses
// globalThis.crypto for slot/salt randomness; no Node-only APIs).

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  concat,
  encodeFunctionData,
  keccak256,
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
import {TasraError} from '../errors.js'
import {keyRegistryAbi} from './abis/keyRegistry.js'
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
export type SlotAuthType = 'unspecified' | 'oid4vp' | 'oauth'

/** `KeyRegistry.AuthType` enum order - APPEND-only on-chain, so never reorder. */
const SLOT_AUTH_TYPES: readonly SlotAuthType[] = ['unspecified', 'oid4vp', 'oauth']
function authTypeIndex(auth: SlotAuthType | undefined): number {
  if (auth === undefined) return 0
  const i = SLOT_AUTH_TYPES.indexOf(auth)
  if (i < 0) {
    throw new TasraError(
      `createSlot: unknown authType ${JSON.stringify(auth)} (expected ${SLOT_AUTH_TYPES.join(' | ')})`,
    )
  }
  return i
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
 * Recovery and timing controls for commit-reveal creation. Accountant seed discovery is attempted first; unavailable seeds fall back to a beacon epoch wait.
 */
export interface CommitRevealOptions {
  /** Durable creation flow. Awaited before submission and after receiving each hash.
   * Enabling recovery disables automatic transaction resubmission and chain-time nudges.
   * Only supply hashes from the same persisted intent; never reconstruct lost salts.
   */
  recovery?: {
    commitTx?: Hex
    revealTx?: Hex
    seeded?: boolean
    onTransaction: (event: {step: 'commit' | 'reveal'; phase: 'submitting' | 'submitted' | 'confirmed'; hash?: Hex; seeded?: boolean}) => Promise<void>
  }
  /** Cancel cooperative creation waits; already submitted transactions remain on chain. */
  signal?: AbortSignal
  /**
   * Maximum beacon-epoch wait in milliseconds when no accountant seed is available.
   */
  maxWaitMs?: number
  /** Progress during that wait. Not called on the seeded path - there is no wait to report. */
  onEpoch?: (cur: number, target: number) => void
  /**
   * Attempt accountant seed discovery by default. Set false to wait for the beacon epoch instead; both paths bind the draw to the committed creation intent.
   */
  slotSeed?: boolean
  /** Accountant base URLs for the seed request. Resolved from `NodeRegistry` when omitted. */
  accountantUrls?: string[]
  /** Per-accountant HTTP timeout for the seed request. */
  slotSeedTimeoutMs?: number
  /** The seed that was obtained, or `null` when the epoch wait is being used instead. */
  onSeed?: (seed: SlotSeed | null) => void
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
   * Defaults to `'unspecified'` (ordinal 0), which declares nothing and is what every
   * slot predating the field reads as. Set it when the rule is an OID4VP-DCQL query
   * (`'oid4vp'`) or an OAuth/OIDC token rule (`'oauth'`).
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

/**
 * Wait for a receipt and reject reverted transactions. Receipt availability alone does not prove execution succeeded.
 */
async function confirmed(
  pub: {waitForTransactionReceipt: (a: {hash: Hex}) => Promise<{status: 'success' | 'reverted'}>},
  hash: Hex,
  what: string,
): Promise<void> {
  const receipt = await pub.waitForTransactionReceipt({hash})
  if (receipt.status !== 'success') {
    throw new Error(`${what} REVERTED on chain (tx ${hash}) — the call did not take effect`)
  }
}

/**
 * Compute the salted rule commitment. OID4VP and OAuth rules use canonical JSON; other rule formats retain their exact bytes.
 * @param ruleSalt Private 32-byte salt saved with the slot creation intent.
 * @param rule Clear authorization rule; OID4VP and OAuth rules are canonicalized before hashing.
 */
export function ruleCommitment(ruleSalt: Hex, rule: string): Hex {
  const body = isOid4vpRule(rule) ? canonicalize(rule) : rule
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
  ;(globalThis.crypto as Crypto).getRandomValues(b)
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
  const pub = createPublicClient({chain, transport: http(cfg.rpcUrl)}) as PublicClient
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
        args: [tagHashes, 0n, 1, `0x${'00'.repeat(32)}` as Hex],
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
            'commit is already paid for and the shortfall surfaces only at the REVEAL, a beacon ' +
            'epoch later.\n' +
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
      (await pub.readContract({address: keyRegistry, abi: keyRegistryAbi, functionName: 'nodeRegistry'}) as Address)
    const active = (await pub.readContract({
      address: nodeRegistry, abi: nodeRegistryAbi, functionName: 'activeCount',
    })) as bigint
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
  async function createSlot(args: CreateSlotArgs): Promise<{slotId: Hex; txHash: Hex; ruleSalt: Hex; relay?: RelayReceipt}> {
    const rule = requireRule(args)
    const slotId = args.slotId ?? random32()
    const salt = args.salt ?? random32()
    const ruleSalt = args.ruleSalt ?? random32()
    // Named `…Hash` only because `ruleCommitment` is the function that derives it;
    // this is the SALTED value the contract stores as `KeySlot.ruleCommitment`.
    const ruleCommitmentHash = ruleCommitment(ruleSalt, rule)
    const tags = await resolveDrawTags(args.tags, args.n)
    const mode = modeIndex(args.mode)
    const auth = authTypeIndex(args.authType)
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
    return {slotId, txHash, ruleSalt, relay: lastRelay?.txHash === txHash ? lastRelay : undefined}
  }

  /**
   * Grinding-resistant slot creation - the production default:
   * commit the params, request an accountant seed, then reveal+create. Falls back
   * to the beacon-epoch wait when a usable seed is unavailable. Needs a beacon
   * (ThresholdRandomBeacon address in the book, or resolved from KeyRegistry.randomBeacon).
   * `onEpoch` reports fallback wait progress; `seeded` identifies the completed path.
   */
  async function createSlotCommitReveal(
    args: CreateSlotArgs & CommitRevealOptions,
  ): Promise<{slotId: Hex; commitTx: Hex; revealTx: Hex; targetEpoch: number; ruleSalt: Hex; seeded: boolean}> {
    const maxWaitMs = args.maxWaitMs ?? 180_000
    args.signal?.throwIfAborted()
    if (!Number.isSafeInteger(maxWaitMs) || maxWaitMs < 1 || maxWaitMs > 2_147_483_647) throw new Error('Invalid commit-reveal wait')
    if (args.exportable) throw new Error('Commit-reveal does not support raw-export slots')
    const rule = requireRule(args)
    const slotId = args.slotId ?? random32()
    const salt = args.salt ?? random32()
    const ruleSalt = args.ruleSalt ?? random32()
    const ruleCommitmentHash = ruleCommitment(ruleSalt, rule)
    const tags = await resolveDrawTags(args.tags, args.n)
    const mode = modeIndex(args.mode)
    // `auth` is not an input to `computeCommitment` - the commitment deliberately
    // does not cover it, so it is passed at the REVEAL only.
    const auth = authTypeIndex(args.authType)
    // Application descriptors already pin KeyRegistry. Its configured beacon is
    // authoritative when the caller has no separate beacon address in its book.
    const beacon = addr.ThresholdRandomBeacon ?? await pub.readContract({
      address: requireAddress(addr, 'KeyRegistry'), abi: keyRegistryAbi, functionName: 'randomBeacon',
    })
    if (!beacon || beacon === '0x0000000000000000000000000000000000000000') throw new Error('KeyRegistry has no random beacon')
    // Validated UP FRONT, before the commit is signed. A policy the chain would
    // reject must not be discovered at the reveal, minutes and one beacon epoch
    // later, when the commit has already been paid for.
    const policy = args.rulePolicy ? await policyTuple(args.rulePolicy) : null

    const commitment = (await pub.readContract({
      address: requireAddress(addr, 'KeyRegistry'),
      abi: keyRegistryAbi,
      functionName: 'computeCommitment',
      args: [slotId, ruleCommitmentHash, args.k, args.n, mode, salt, tags, account.address],
    })) as Hex
    const keyReg = requireAddress(addr, 'KeyRegistry')
    const beaconEpoch = () => pub.readContract({address: beacon, abi: thresholdRandomBeaconAbi, functionName: 'epoch'}) as Promise<bigint>
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

    const transact = async (step: 'commit' | 'reveal', name: string, values: readonly unknown[], seeded?: boolean): Promise<Hex> => {
      args.signal?.throwIfAborted()
      await args.recovery?.onTransaction({step, phase: 'submitting', seeded})
      args.signal?.throwIfAborted()
      const hash = await sendCall(keyReg, keyRegistryAbi, name, values, name)
      await args.recovery?.onTransaction({step, phase: 'submitted', hash, seeded})
      return hash
    }
    const commitTx = args.recovery?.commitTx ?? await transact('commit', 'commitKeySlot', [commitment])
    await confirmed(pub, commitTx, 'commitKeySlot')
    await args.recovery?.onTransaction({step: 'commit', phase: 'confirmed', hash: commitTx})

    // Read the ACTUAL target epoch the contract pinned (computing it client-side
    // races the ~20s beacon). slotCommits to (targetEpoch, expiryEpoch, creator, used).
    const commit = (await pub.readContract({address: keyReg, abi: keyRegistryAbi, functionName: 'slotCommits', args: [commitment]})) as readonly [bigint, bigint, string, boolean]
    const targetEpoch = Number(commit[0])
    if (args.recovery) {
      if (commit[2].toLowerCase() !== account.address.toLowerCase() || commit[0] === 0n) throw new TasraError('Saved creation does not match this creator and commitment')
      if (args.recovery.revealTx) {
        await confirmed(pub, args.recovery.revealTx, 'revealKeySlot')
        const completed = await pub.readContract({address: keyReg, abi: keyRegistryAbi, functionName: 'slotCommits', args: [commitment]})
        if (!completed[3]) throw new TasraError('Saved reveal did not consume this commitment')
        await args.recovery.onTransaction({step: 'reveal', phase: 'confirmed', hash: args.recovery.revealTx, seeded: args.recovery.seeded})
        return {slotId, commitTx, revealTx: args.recovery.revealTx, targetEpoch, ruleSalt, seeded: args.recovery.seeded ?? false}
      }
      if (commit[3]) throw new TasraError('Commitment already consumed; reconcile the reveal hash before continuing')
    }

    // accountant-seeded creation FAST PATH: ask the accountant set to threshold-sign this commitment, and reveal
    // immediately instead of waiting for `targetEpoch`.
    //
    // Strictly an optimisation, and written so it can only ever cost time. Every way it can go
    //   wrong - no accountant reachable, a KeyRegistry too old to have `commitSeedDigest`, a set
    //   whose group key is not the beacon's - lands in the epoch wait below, which is what this
    //   path did before it existed. The commitment is unchanged either way, so nothing is lost by
    //   trying.
    // The seeded reveal draws a DIFFERENT committee than the epoch path would, because the seed
    //   is different. That is the mechanism, not a side effect: both seeds post-date the
    //   commitment, so both are ungrindable, and the creator does not get to pick which it gets.
    let seed: SlotSeed | null = null
    if (args.slotSeed !== false) {
      try {
        seed = await requestSlotSeed(
          createTasraChainClient({rpcUrl: cfg.rpcUrl, addresses: cfg.addresses, chainId: chain.id}),
          keyReg,
          commitment,
          {urls: args.accountantUrls, timeoutMs: args.slotSeedTimeoutMs},
        )
      } catch {
        seed = null
      }
    }
    args.onSeed?.(seed)
    if (seed) {
      try {
        const seededTx = policy
          ? await transact('reveal', 'revealKeySlotWithSeedAndPolicy', [slotId, ruleCommitmentHash, args.k, args.n, mode, auth, salt, tags, seed.signature, policy], true)
          : await transact('reveal', 'revealKeySlotWithSeed', [slotId, ruleCommitmentHash, args.k, args.n, mode, auth, salt, tags, seed.signature], true)
        await confirmed(pub, seededTx, 'revealKeySlotWithSeed')
        await args.recovery?.onTransaction({step: 'reveal', phase: 'confirmed', hash: seededTx, seeded: true})
        return {slotId, commitTx, revealTx: seededTx, targetEpoch, ruleSalt, seeded: true}
      } catch (e) {
        // Under a relay this must rethrow. The relay submitter owns the retries of the one
        //   request it signed, and falling through would start a second signed request against the
        //   same forwarder nonce - the defect that wedges every later write by this signer.
        //   Without a relay, a reverted seeded reveal has spent gas and left the commitment
        //   untouched, so the epoch wait below still completes the creation.
        if (relay || args.recovery) throw e
      }
    }

    // Wait for the beacon to reach the target, then reveal - retrying across the
    // epoch boundary (EpochNotReached / BeaconSeedUnavailable can transiently fire
    // until the seed for the target epoch has landed).
    const deadline = Date.now() + maxWaitMs
    let revealTx: Hex | undefined
    let prevEpoch = -1
    while (!revealTx) {
      args.signal?.throwIfAborted()
      const cur = Number(await beaconEpoch())
      args.onEpoch?.(cur, targetEpoch)
      if (!commit[3] && BigInt(cur) > commit[1]) throw new SlotCommitmentExpiredError(chain.id, keyReg, slotId, commitment, account.address, salt)
      if (cur < targetEpoch) {
        if (Date.now() > deadline) throw new Error(`beacon did not reach target epoch ${targetEpoch} (at ${cur})`)
        // The beacon is anchored to CHAIN time (tick = block.timestamp / interval).
        // On a mint-on-demand chain (the local dev chain), block.timestamp only
        // advances when a transaction mints a block - so an idle chain freezes the
        // beacon and this wait would always hit its deadline. When the epoch has
        // not moved since the last poll AND the head is stale, nudge chain time
        // with a zero-value self-transfer. On live chains (Fuji, mainnet) blocks
        // flow continuously, the head is never stale, and no nudge is ever sent.
        if (!relay && cur === prevEpoch) {
          try {
            const head = await pub.getBlock()
            const nowSecs = BigInt(Math.floor(Date.now() / 1000))
            if (nowSecs - head.timestamp > 5n && wallet.account) {
              const nudge = await wallet.sendTransaction({to: wallet.account.address, value: 0n})
              await confirmed(pub, nudge, 'chain-time nudge')
            }
          } catch {
            // Best-effort: a failed nudge leaves us exactly where a passive wait would be.
          }
        }
        prevEpoch = cur
        await sleep(3000)
        continue
      }
      try {
        // With a policy, the reveal PINS IT in the same transaction. That is the
        // whole point: as a follow-up call it is unwinnable from a wallet that
        // prompts, because the DKG starts the instant this transaction lands.
        revealTx = policy
          ? await transact('reveal', 'revealKeySlotWithPolicy', [slotId, ruleCommitmentHash, args.k, args.n, mode, auth, salt, tags, policy], false)
          : await transact('reveal', 'revealKeySlot', [slotId, ruleCommitmentHash, args.k, args.n, mode, auth, salt, tags], false)
        await confirmed(pub, revealTx, 'revealKeySlot')
        await args.recovery?.onTransaction({step: 'reveal', phase: 'confirmed', hash: revealTx, seeded: false})
      } catch (e) {
        revealTx = undefined
        // The relay submitter owns bounded retries of one signed request. Never start a
        // replacement attempt or a direct write from this epoch-wait loop.
        if (relay || args.recovery) throw e
        if (Date.now() > deadline) throw e
        await sleep(3000)
      }
    }
    return {slotId, commitTx, revealTx, targetEpoch, ruleSalt, seeded: false}
  }

  /** Prepay a slot's metered usage: approve TSRA then Settlement.fund(slot, amount). */
  async function fundSlot(slotId: Hex, amount: bigint): Promise<{approveTx: Hex; fundTx: Hex; relay?: RelayReceipt}> {
    const token = requireAddress(addr, 'TasraToken')
    const settlement = requireAddress(addr, 'Settlement')
    const approveTx = await wallet.writeContract({address: token, abi: tasraTokenAbi, functionName: 'approve', args: [settlement, amount]})
    await confirmed(pub, approveTx, 'approve')
    const fundTx = await sendCall(settlement, settlementAbi, 'fund', [slotId, amount], 'fund')
    await confirmed(pub, fundTx, 'fund')
    return {approveTx, fundTx, relay: relay ? lastRelay : undefined}
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
    return (await pub.readContract({address: requireAddress(addr, 'MockEurc'), abi: mockEurcAbi, functionName: 'balanceOf', args: [a]})) as bigint
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
    pub.readContract({address: requireAddress(addr, 'BondingCurve'), abi: bondingCurveAbi, functionName: 'spotPrice'}) as Promise<bigint>
  const priceAt = (sold: bigint) =>
    pub.readContract({address: requireAddress(addr, 'BondingCurve'), abi: bondingCurveAbi, functionName: 'priceAt', args: [sold]}) as Promise<bigint>

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
    pub.readContract({address: requireAddress(addr, 'TasraToken'), abi: tasraTokenAbi, functionName: 'balanceOf', args: [of ?? account.address]}) as Promise<bigint>
  const ethBalance = (of?: Address) => pub.getBalance({address: of ?? account.address})
  const settlementBalance = (slotId: Hex) =>
    pub.readContract({address: requireAddress(addr, 'Settlement'), abi: settlementAbi, functionName: 'balanceOf', args: [slotId]}) as Promise<bigint>

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
   */
  createSlot(args: CreateSlotArgs): Promise<{slotId: Hex; txHash: Hex; ruleSalt: Hex; relay?: RelayReceipt}>
  /**
   * Create a slot using commit-reveal, trying an accountant seed before waiting for a beacon epoch. Persist the slot ID and rule salt; prepared creation preserves them before submission.
   */
  createSlotCommitReveal(
    args: CreateSlotArgs & CommitRevealOptions,
  ): Promise<{slotId: Hex; commitTx: Hex; revealTx: Hex; targetEpoch: number; ruleSalt: Hex; seeded: boolean}>
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
