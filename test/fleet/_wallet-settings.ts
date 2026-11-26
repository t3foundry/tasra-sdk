// Local fleet wallet configuration and metered slot funding. The network bills metered only: the
// slot's owner funds its Settlement balance once, operations are authorized at the registered
// verifier-agent and served by the keepers, and the accountants settle later. This helper never
// mints tokens and never sends anything to an official network.
import assert from 'node:assert/strict'
import {constants, readSync, openSync, fstatSync, closeSync} from 'node:fs'
import {createWalletClient, http, parseAbi, type Address, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {createFileStore} from '../../src/app/node.ts'
import {createTasraChainClient} from '../../src/chain/client.ts'
import {keyRegistryAbi} from '../../src/chain/abis/keyRegistry.ts'
import {parseApplicationServiceProfiles} from '../../src/chain/serviceProfiles.ts'
import {readSlotSharing} from '../../src/chain/slotSharing.ts'
import {createTasraWriteClient, ruleCommitment, type TasraWriteClient} from '../../src/chain/write.ts'
import {hexToBytes} from '../../src/crypto/hex.ts'
import type {FleetConfig} from './_fleet.ts'

const settlementViews = parseAbi(['function token() view returns (address)', 'function version() view returns (string)'])
const uint256Max = (1n << 256n) - 1n
export type LocalFleet = Pick<FleetConfig, 'chainId' | 'rpcUrl' | 'raw' | 'book'>

/** Read one bounded regular configuration file without following a link. */
export function readConfigFile(file: string, cap: number): string {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = fstatSync(fd)
    assert(stat.isFile() && stat.size > 0 && stat.size <= cap, 'Explicit wallet configuration must be a bounded regular file')
    const bytes = Buffer.alloc(cap + 1)
    let length = 0
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null)
      if (!count) break
      length += count
    }
    assert(length <= cap, 'Wallet configuration exceeded its byte limit')
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(0, length))
  } finally { closeSync(fd) }
}

/** The local-only fixture policy: chain 43112 over loopback, a private evidence directory, a finite deposit. */
export function localFleetSettings(cfg: Pick<FleetConfig, 'chainId' | 'rpcUrl' | 'raw'>) {
  assert.equal(cfg.chainId, 43112, 'Wallet fleet fixtures require local chain 43112')
  const rpc = new URL(cfg.rpcUrl)
  assert(['http:', 'https:'].includes(rpc.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(rpc.hostname)
    && !rpc.username && !rpc.password && !rpc.search && !rpc.hash, 'Wallet fleet RPC must be an explicit loopback endpoint')
  const directory = cfg.raw.KK_WALLET_EVIDENCE_DIR
  assert(directory, 'KK_WALLET_EVIDENCE_DIR must name private durable slot funding and session evidence')
  const units = cfg.raw.KK_SLOT_TASRA_UNITS ?? '1000000000000000000'
  assert(/^[1-9][0-9]{0,77}$/.test(units) && BigInt(units) <= uint256Max, 'Slot funding must be positive uint256 TASRA base units')
  // Certification has a spending ceiling independent of the configurable deposit.
  assert(BigInt(units) <= 10000000000000000000n, 'Local fixture deposit exceeds the 10 TASRA ceiling')
  return {directory, amount: BigInt(units)}
}

/** The deployment is the local metered one: Settlement holds the configured TASRA and bills metered only. */
export async function assertLocalMeteredFleet(cfg: LocalFleet, writer: TasraWriteClient) {
  const settings = localFleetSettings(cfg)
  assert.equal(await writer.pub.getChainId(), 43112, 'RPC chain differs from the local certification deployment')
  assert(cfg.book.Settlement && cfg.book.TasraToken && cfg.book.KeyRegistry, 'Wallet fleet needs Settlement, TASRA and KeyRegistry')
  const token = await writer.pub.readContract({address: cfg.book.Settlement, abi: settlementViews, functionName: 'token'})
  assert.equal(token.toLowerCase(), cfg.book.TasraToken.toLowerCase(), 'Settlement must hold the configured TASRA token')
  // Settlement version 6 is the metered-only contract; an older one still carries prepaid state.
  assert.equal(await writer.pub.readContract({address: cfg.book.Settlement, abi: settlementViews, functionName: 'version'}), '6',
    'Fresh fleet acceptance requires the metered-only Settlement (version 6)')
  return settings
}

/** The journal record of one funded fixture slot (`funding-43112-<slot>`), read by the settlement gate. */
export interface SlotFundingRecord {
  schema: 2
  phase: 'prepared' | 'submitted' | 'confirmed'
  slotId: Hex
  creator: Address
  funder: Address
  amount: bigint
  creationBlock: Hex
}
export const fundingKey = (slot: Hex) => `funding-43112-${slot.slice(2).toLowerCase()}`

/**
 * Fund a freshly created fixture slot's metered Settlement balance with the finite configured
 * deposit and journal it. The owner (or the local deployer) pays; a reader of the slot never does.
 */
export async function fundWalletSlot(cfg: FleetConfig, writer: TasraWriteClient,
  created: {slotId: Hex; ruleSalt: Hex; revealTx: Hex}, rule: string, options: {payerKey?: Hex} = {}) {
  const {directory, amount} = await assertLocalMeteredFleet(cfg, writer)
  const settlement = cfg.book.Settlement!, keyRegistry = cfg.book.KeyRegistry!
  const store = createFileStore(directory), name = fundingKey(created.slotId)
  return store.withLock(name, async () => {
    assert.equal(await store.load(name), undefined, 'Original slot funding already recorded; inspect it before further spending')
    const creation = await writer.pub.getTransactionReceipt({hash: created.revealTx})
    assert.equal(creation.status, 'success', 'Original slot reveal must have succeeded')
    assert.equal(creation.to?.toLowerCase(), keyRegistry.toLowerCase(), 'Original reveal must target the approved registry')
    assert.equal(creation.from.toLowerCase(), writer.address.toLowerCase(), 'Original reveal must be from this sovereign creator')
    const block = await writer.pub.getBlock({blockNumber: creation.blockNumber})
    assert.equal(block.hash, creation.blockHash, 'Original slot creation must remain canonical')
    const slot = await writer.pub.readContract({address: keyRegistry, abi: keyRegistryAbi, functionName: 'getKeySlot', args: [created.slotId]})
    assert(slot.exists && !slot.cancelled, 'Original slot must exist and be live')
    assert.equal(slot.creator.toLowerCase(), writer.address.toLowerCase(), 'Funding evidence must retain the original creator')
    assert.equal(slot.ruleCommitment.toLowerCase(), ruleCommitment(created.ruleSalt, rule).toLowerCase(), 'Rule and salt must reproduce the original slot commitment')
    assert.equal(await writer.settlementBalance(created.slotId), 0n, 'Fresh fixture funding refuses an already funded slot')
    // A bounded wallet without nonce retries: an uncertain deposit is inspected, never replaced.
    const payerWallet = createWalletClient({account: privateKeyToAccount(options.payerKey ?? cfg.deployPk as Hex),
      chain: writer.wallet.chain, transport: http(cfg.rpcUrl, {retryCount: 0, timeout: 15_000})})
    const funder = createTasraWriteClient({rpcUrl: cfg.rpcUrl, addresses: cfg.book, wallet: payerWallet, chainId: 43112})
    assert(await funder.tsraBalance() >= amount, 'Local funder lacks the finite requested TASRA deposit')
    const original: Omit<SlotFundingRecord, 'phase'> = {schema: 2, slotId: created.slotId, creator: writer.address, funder: funder.address, amount, creationBlock: creation.blockHash}
    // The record precedes the first approval/deposit. An unknown outcome leaves it in place; a
    // second invocation cannot spend again.
    await store.save(name, {...original, phase: 'prepared'})
    const transaction = await funder.fundSlot(created.slotId, amount)
    await store.save(name, {...original, phase: 'submitted', transaction})
    const balance = await writer.settlementBalance(created.slotId)
    assert.equal(balance, amount, 'Settlement must credit exactly the real TASRA deposit')
    await store.save(name, {...original, phase: 'confirmed', transaction})
    return {balance}
  })
}

function positive(value: string | undefined, name: string, cap: bigint): bigint {
  assert(value && /^[1-9][0-9]{0,77}$/.test(value) && BigInt(value) <= cap, `${name} must be a finite positive integer`)
  return BigInt(value)
}

/** The independently approved wallet configuration test/verify/bringup.ts retains (KK_WALLET_*). */
export function walletSettings(cfg: FleetConfig) {
  const local = localFleetSettings(cfg), raw = cfg.raw
  assert(raw.KK_WALLET_AGENT_PROFILE, 'KK_WALLET_AGENT_PROFILE must retain the independently approved registered provider')
  const profiles = parseApplicationServiceProfiles(readConfigFile(raw.KK_WALLET_AGENT_PROFILE, 65_536))
  assert(profiles.chainId === 43112 && profiles.registry.toLowerCase() === cfg.book.ServiceRegistry?.toLowerCase()
    && profiles.verifierAgents.length === 1 && !profiles.relayers.length && !profiles.vaultServices.length, 'Wallet requires exactly one provider on the approved local registry')
  const profile = profiles.verifierAgents[0]!
  const specifiedAgent = raw.KK_VERIFIER_AGENT_URL ?? raw.KK_VERIFIER_AGENT_EXTERNAL_URL
  assert(!specifiedAgent || specifiedAgent === profile.endpoint, 'Wallet endpoint differs from the independently approved provider')
  const endpoint = new URL(profile.endpoint), privateHosts = (raw.KK_WALLET_AGENT_PRIVATE_HOSTS ?? '').split(',').filter(Boolean)
  assert(privateHosts.every(host => host === endpoint.hostname), 'Private agent exception must name only the independently approved host')
  const ca = raw.KK_WALLET_CA_FILE ? readConfigFile(raw.KK_WALLET_CA_FILE, 262_144) : undefined
  // Accountants serve the verifier-set snapshot artifacts a session grant is verified against.
  const accountantUrls = (raw.KK_WALLET_ACCOUNTANT_URLS ?? '').split(',').filter(Boolean)
  assert(accountantUrls.length && accountantUrls.length <= 16 && new Set(accountantUrls).size === accountantUrls.length,
    'KK_WALLET_ACCOUNTANT_URLS must explicitly approve distinct snapshot artifact hosts')
  for (const endpoint of accountantUrls) {
    const url = new URL(endpoint)
    assert(['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'Local accountant endpoints must be explicit loopback origins')
  }
  const committee = Number(positive(raw.KK_WALLET_VERIFIER_COUNT, 'KK_WALLET_VERIFIER_COUNT', 4096n))
  const quorum = Number(positive(raw.KK_WALLET_VERIFIER_QUORUM, 'KK_WALLET_VERIFIER_QUORUM', BigInt(committee)))
  const routes = raw.KK_WALLET_KEEPER_ROUTE_MAP
    ? JSON.parse(readConfigFile(raw.KK_WALLET_KEEPER_ROUTE_MAP, 65_536)) as unknown : {}
  assert(routes && typeof routes === 'object' && !Array.isArray(routes), 'Keeper routes must be an independently approved URL map')
  const map = new Map(Object.entries(routes).map(([registered, mapped]) => {
    assert(typeof mapped === 'string', 'Mapped keeper route must be a URL')
    for (const value of [registered, mapped]) {
      const url = new URL(value)
      assert(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash,
        'Keeper route violates the wallet transport policy')
    }
    return [registered.replace(/\/$/, ''), mapped.replace(/\/$/, '')] as const
  }))
  assert(new Set(map.values()).size === map.size, 'Keeper route map aliases independent operator identities')
  return {...local, profile, transportPolicy: {ca, allowedPrivateHosts: privateHosts}, accountantUrls,
    defaultVerificationPolicy: {committee, quorum},
    keeperUrls: [...map.values()],
    keeperUrl: (registered: string) => map.get(registered.replace(/\/$/, '')) ?? registered}
}

const chainFor = (cfg: FleetConfig) => createTasraChainClient({rpcUrl: cfg.rpcUrl, addresses: cfg.book, chainId: 43112, multicall3: false})

/** The slot's assigned keepers as registered (operator, registered URL mapped to its local route), in assignment order. */
export async function walletKeepers(cfg: FleetConfig, slot: Hex): Promise<Array<{operator: Address; url: string}>> {
  const settings = walletSettings(cfg), chain = chainFor(cfg)
  const operators = await chain.readers.keyRegistry.assignedNodes(slot)
  assert(operators.length > 0, 'Slot has no assigned keepers')
  return Promise.all(operators.map(async operator => {
    const node = await chain.readers.nodeRegistry.nodeOf(operator)
    assert(node.active && node.url, 'Assigned keeper is inactive or has no registered endpoint')
    return {operator, url: settings.keeperUrl(node.url).replace(/\/$/, '')}
  }))
}

/** One assigned keeper to coordinate through, chosen by `entry` (spread-entry load picks different ones). */
export async function walletCoordinator(cfg: FleetConfig, slot: Hex, entry: number): Promise<Address> {
  assert(Number.isSafeInteger(entry) && entry >= 0, 'Invalid coordinator selection')
  const keepers = await walletKeepers(cfg, slot)
  return keepers[entry % keepers.length]!.operator
}

/** Read the canonical sharing and authenticate the keepers' public reports before any wallet grant. */
export async function walletBlsSharing(cfg: FleetConfig, slot: Hex) {
  const settings = walletSettings(cfg), chain = chainFor(cfg)
  const [sharing, canonical] = await Promise.all([
    readSlotSharing(chain, slot, {keeperUrl: settings.keeperUrl, allowLocalHttp: true}),
    chain.readers.keyRegistry.getKeySlot(slot)])
  assert.equal(sharing.chainId, 43112, 'Sharing was read from another chain')
  assert.equal(Number(canonical.mode), 1, 'Client decryption requires the canonical BLS mode')
  return {...sharing, groupPublicKey: hexToBytes(canonical.publicKey).slice(0, 96)}
}
