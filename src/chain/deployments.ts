// Deployment address discovery. An explorer needs to know where each contract
// lives on a given chain. Three interchangeable sources are supported:
//
//   1. A Foundry broadcast run JSON (contracts/broadcast/Deploy.s.sol/<id>/run-*.json):
//      we map contractName to contractAddress across both deploy shapes the
//      network's Deploy.s.sol emits - a plain CREATE, and (DETERMINISTIC=true /
//      PRODUCTION) a CREATE2 through the DeterministicDeployer factory,
//      which surfaces as `additionalContracts[]` on the factory CALL. UUPS
//      contracts resolve to their ERC1967Proxy, never the
//      implementation - see resolveProxies() below.
//   2. A `chain.env` style KEY=VALUE blob (mirrors the network's credentials file),
//      e.g. NODE_REGISTRY=0x...  KEY_REGISTRY=0x...
//   3. An explicit { ContractName: address } object.
//
// All loaders normalise to an AddressBook keyed by canonical contract names
// (matching the ABI / CONTRACT_ABIS keys).

import type {ContractName} from './abis/index.js'

/**
 * Hex-encoded EVM contract or account address.
 */
export type Address = `0x${string}`

/** Canonical contract name to deployed address (lowercased keys allowed too). */
export type AddressBook = Partial<Record<ContractName, Address>> & {
  [k: string]: Address | undefined
}

interface BroadcastCreate {
  transactionType?: string
  contractName?: string
  address?: string
  initCode?: string
}
interface BroadcastTx {
  transactionType?: string
  contractName?: string
  contractAddress?: string
  arguments?: unknown[] | null
  additionalContracts?: BroadcastCreate[] | null
}
interface BroadcastFile {
  transactions?: BroadcastTx[]
  chain?: number
}

/** One contract creation, however it was deployed. */
interface Deployment {
  name: string
  address: Address
  /** Constructor args, when the run JSON decoded them (plain CREATE only). */
  args?: unknown[]
  /** Creation bytecode || ABI-encoded ctor args (CREATE2 via the factory). */
  initCode?: string
}

/** The proxy the network deploys UUPS implementations behind. */
const PROXY_CONTRACT = 'ERC1967Proxy'

/**
 * Fallback chain ID retained for explicitly configured loopback connections. Set the chain ID from the downloaded tasra-releases network manifest for deployment access.
 */
export const DEFAULT_CHAIN_ID = 1337

/** The vesting tranches Deploy.s.sol creates, in the order it creates them. */
export const VAULT_TRANCHES = ['investor', 'team', 'community'] as const
/**
 * Named vesting allocation used to resolve its deployed vault.
 */
export type VaultTranche = (typeof VAULT_TRANCHES)[number]

/**
 * Address-book key for one vesting tranche, e.g. TasraVestingVault_team.
 * @param tranche Vesting allocation name.
 */
export function vaultKey(tranche: VaultTranche): string {
  return `TasraVestingVault_${tranche}`
}

function asAddress(s: string | undefined): Address | undefined {
  if (!s) return undefined
  const v = s.trim().toLowerCase()
  return /^0x[0-9a-f]{40}$/.test(v) ? (v as Address) : undefined
}

/**
 * Collect every contract creation in the run, in order. Two shapes:
 *   - plain CREATE      to a top-level transaction carrying contractName
 *   - CREATE2 (factory) to a CALL to DeterministicDeployer whose created
 *                         contracts are listed in `additionalContracts[]`
 */
function collectDeployments(file: BroadcastFile): Deployment[] {
  const out: Deployment[] = []
  for (const tx of file.transactions ?? []) {
    if (tx.transactionType === 'CREATE') {
      const addr = asAddress(tx.contractAddress)
      if (tx.contractName && addr)
        out.push({
          name: tx.contractName,
          address: addr,
          args: tx.arguments ?? undefined,
        })
    }
    for (const sub of tx.additionalContracts ?? []) {
      if (sub.transactionType !== 'CREATE' && sub.transactionType !== 'CREATE2')
        continue
      const addr = asAddress(sub.address)
      if (sub.contractName && addr)
        out.push({name: sub.contractName, address: addr, initCode: sub.initCode})
    }
  }
  return out
}

/**
 * Point each proxied contract name at its ERC1967Proxy rather than its
 * implementation. Reads against an implementation address hit uninitialized
 * storage and return zeros instead of reverting, so getting this wrong is
 * silent - hence resolving the link explicitly rather than by position.
 *
 * The implementation is `ERC1967Proxy(implementation, initData)`'s first
 * constructor argument. A plain-CREATE run gives it decoded in `arguments[0]`;
 * a CREATE2 run gives only the init code, so we match on how `(address, bytes)`
 * ABI-encodes: the padded implementation word followed by the `bytes` offset
 * word (0x40). Matching the bare address is not enough - `initData` is an
 * `initialize(...)` call that embeds further addresses (owner, treasury, …)
 * after the implementation.
 */
function resolveProxies(deployments: Deployment[], book: AddressBook): void {
  const implName = new Map<Address, string>()
  for (const d of deployments) {
    if (d.name !== PROXY_CONTRACT) implName.set(d.address, d.name)
  }
  for (const d of deployments) {
    if (d.name !== PROXY_CONTRACT) continue
    let impl = asAddress(d.args?.[0] as string | undefined)
    if (!impl || !implName.has(impl)) {
      const code = (d.initCode ?? '').toLowerCase()
      const offsetWord = '0'.repeat(62) + '40' // abi offset of the `bytes` arg
      const matches = [...implName.keys()].filter(a =>
        code.includes('0'.repeat(24) + a.slice(2) + offsetWord),
      )
      // Only accept an unambiguous hit; a guess here is worse than a miss,
      // because requireAddress() surfaces a miss and a wrong proxy reads zeros.
      impl = matches.length === 1 ? matches[0] : undefined
    }
    const name = impl ? implName.get(impl) : undefined
    if (name) book[name] = d.address
  }
}

/**
 * Build an AddressBook from a parsed Foundry broadcast run JSON. The last
 * deployment of a given contract name wins (re-deploys later in the run
 * override). Proxied contracts resolve to the proxy, which is the address
 * callers must actually talk to.
 * @param json Parsed Foundry broadcast artifact containing deployment transactions.
 */
export function addressBookFromBroadcast(json: unknown): AddressBook {
  const file = json as BroadcastFile
  const deployments = collectDeployments(file)
  const book: AddressBook = {}
  for (const d of deployments) book[d.name] = d.address
  resolveProxies(deployments, book)
  resolveVaultTranches(deployments, book)
  return book
}

/**
 * Split the vesting vaults into their tranches. Deploy.s.sol creates three
 * instances from one artifact - `TasraVestingVault_investor`, `_team`,
 * `_community` - but the run JSON labels all three `TasraVestingVault`, so a
 * name-keyed book keeps only the last and silently reports the wrong tranche.
 *
 * Deployment order is the only discriminator available: with default env the
 * investor and team constructor args are identical, so the addresses cannot be
 * told apart by content. That order is fixed by the deploy script; if it ever
 * grows a fourth vault or reorders, the extra entries stay unlabelled rather
 * than being mislabelled.
 */
function resolveVaultTranches(
  deployments: Deployment[],
  book: AddressBook,
): void {
  const vaults = deployments.filter(d => d.name === 'TasraVestingVault')
  if (vaults.length < 2) return // single vault - the plain name is unambiguous
  vaults.forEach((v, i) => {
    const tranche = VAULT_TRANCHES[i]
    if (tranche) book[vaultKey(tranche)] = v.address
  })
  // The bare name would otherwise be whichever vault was deployed last, which
  // reads like "the vault" but is only the community tranche.
  delete book.TasraVestingVault
}

// Map common env keys to canonical contract names, so a chain.env using
// snake/upper-case names still resolves.
const ENV_ALIASES: Record<string, ContractName> = {
  NODE_REGISTRY: 'NodeRegistry',
  KEY_REGISTRY: 'KeyRegistry',
  SERVICE_REGISTRY: 'ServiceRegistry',
  SETTLEMENT: 'Settlement',
  TSRA_TOKEN: 'TasraToken',
  TASRA_TOKEN: 'TasraToken',
  KEYK_TOKEN: 'TasraToken',
  TOKEN: 'TasraToken',
  BONDING_CURVE: 'BondingCurve',
  SWAP_ROUTER: 'TasraSwapRouter',
  TASRA_SWAP_ROUTER: 'TasraSwapRouter',
  TREASURY: 'Treasury',
  VAULT: 'TasraVestingVault',
  TASRA_VAULT: 'TasraVestingVault',
  TASRA_VESTING_VAULT: 'TasraVestingVault',
  THRESHOLD_RANDOM_BEACON: 'ThresholdRandomBeacon',
  THRESHOLD_BEACON: 'ThresholdRandomBeacon',
  RANDOM_BEACON: 'ThresholdRandomBeacon',
  BEACON: 'ThresholdRandomBeacon',
  PREVRANDAO_BEACON: 'PrevrandaoSaltBeacon',
  EQUIVOCATION_SLASHER: 'EquivocationSlasher',
  // The four legacy oracle env keys are aliases for the merged AccountantSlashing
  // hub, so resolve them straight to it.
  ACCOUNTANT_SLASHING: 'AccountantSlashing',
  SLASHING_ORACLE: 'AccountantSlashing',
  FAULT_ORACLE: 'AccountantSlashing',
  FALSE_SLASH_ORACLE: 'AccountantSlashing',
  SETTLEMENT_FAULT_ORACLE: 'AccountantSlashing',
  LIVENESS_REGISTRY: 'LivenessRegistry',
  VERIFIER_SET_REGISTRY: 'VerifierSetRegistry',
  ACCOUNTANT_SET_REGISTRY: 'AccountantSetRegistry',
  KEEPER_SHARE_REGISTRY: 'KeeperShareRegistry',
  PLATFORM_EXECUTOR: 'PlatformExecutor',
  PRICE_ORACLE: 'FixedTasraPriceOracle',
  EURC: 'MockEurc',
}

// Vesting tranches are not distinct contracts, so they key off vaultKey()
// rather than a ContractName.
const VAULT_ENV_ALIASES: Record<string, string | undefined> = Object.fromEntries(
  VAULT_TRANCHES.flatMap(t => [
    [`TASRA_VAULT_${t.toUpperCase()}`, vaultKey(t)],
    [`VAULT_${t.toUpperCase()}`, vaultKey(t)],
  ]),
)

/**
 * Record one KEY=VALUE pair into `book`, resolving env aliases to their
 * canonical contract name. Non-address values are skipped.
 */
function putEnvEntry(book: AddressBook, rawKey: string, rawVal: string): void {
  const key = rawKey.trim().toUpperCase().replace(/^EXPORT\s+/, '')
  const val = rawVal.trim().replace(/^['"]|['"]$/g, '')
  const addr = asAddress(val)
  if (!addr) return
  const canonical = ENV_ALIASES[key]
  if (canonical) book[canonical] = addr
  else if (VAULT_ENV_ALIASES[key]) book[VAULT_ENV_ALIASES[key]!] = addr
  book[key] = addr // keep the raw key too
}

/**
 * Parse supported deployment environment keys or a KEY=VALUE text blob into contract addresses. Empty values and entries that are not valid addresses are ignored. Prefer deployment addresses from a tasra-releases network manifest.
 * @param src Environment key-value object or serialized environment text.
 * @returns Address book keyed by canonical contract names.
 */
export function addressBookFromEnv(
  src: string | Record<string, string | undefined>,
): AddressBook {
  const book: AddressBook = {}
  if (typeof src !== 'string') {
    for (const [k, v] of Object.entries(src)) {
      if (typeof v === 'string') putEnvEntry(book, k, v)
    }
    return book
  }
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    putEnvEntry(book, line.slice(0, eq), line.slice(eq + 1))
  }
  return book
}

/**
 * Normalise an explicit object into an AddressBook (validates addresses).
 * @param obj Object containing canonical contract names or supported environment aliases.
 */
export function addressBookFromObject(
  obj: Record<string, string>,
): AddressBook {
  const book: AddressBook = {}
  for (const [k, v] of Object.entries(obj)) {
    const addr = asAddress(v)
    if (addr) book[k] = addr
  }
  return book
}

/**
 * Resolve the named vesting allocation. The unqualified vault address is accepted as a fallback; callers aggregating allocations must deduplicate resolved addresses.
 * @param book Deployment contract addresses.
 * @param tranche Vesting allocation to resolve.
 * @returns Address of the allocation vault; throws when missing.
 */
export function requireVaultAddress(
  book: AddressBook,
  tranche: VaultTranche,
): Address {
  const addr = book[vaultKey(tranche)] ?? book.TasraVestingVault
  if (!addr) {
    throw new Error(
      `AddressBook is missing ${vaultKey(tranche)}. Known: ${
        Object.keys(book).join(', ') || '(none)'
      }`,
    )
  }
  return addr
}

/**
 * Resolve a contract address, throwing a clear error if missing.
 * @param book Resolved deployment addresses.
 * @param name Canonical contract name or supported address-book key.
 */
export function requireAddress(book: AddressBook, name: ContractName): Address {
  const addr = book[name]
  if (!addr) {
    throw new Error(
      `AddressBook is missing ${name}. Known: ${Object.keys(book).join(', ') || '(none)'}`,
    )
  }
  return addr
}
