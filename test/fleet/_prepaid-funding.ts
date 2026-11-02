// Fresh local certification slots use finite real TASRA deposits. This helper
// never mints tokens, enables a legacy slot, or sends anything to Fuji.
import assert from 'node:assert/strict'
import {createWalletClient, http, parseAbi, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {createFileStore} from '../../src/app/node.ts'
import {readSlotFunding} from '../../src/chain/prepaid.ts'
import {keyRegistryAbi} from '../../src/chain/abis/keyRegistry.ts'
import {createTasraWriteClient, ruleCommitment, type TasraWriteClient} from '../../src/chain/write.ts'
import type {FleetConfig} from './_fleet.ts'

const genesisAbi = parseAbi(['function prepaidFromGenesis() view returns (bool)', 'function token() view returns (address)'])
const uint256Max = (1n << 256n) - 1n
export type LocalPrepaidFleet = Pick<FleetConfig, 'chainId' | 'rpcUrl' | 'raw' | 'book'>

export function localPrepaidSettings(cfg: Pick<FleetConfig, 'chainId' | 'rpcUrl' | 'raw'>) {
  assert.equal(cfg.chainId, 43112, 'Paid fleet fixtures require local chain 43112')
  const rpc = new URL(cfg.rpcUrl)
  assert(['http:', 'https:'].includes(rpc.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(rpc.hostname)
    && !rpc.username && !rpc.password && !rpc.search && !rpc.hash, 'Paid fleet RPC must be an explicit loopback endpoint')
  const directory = cfg.raw.KK_PREPAID_EVIDENCE_DIR
  assert(directory, 'KK_PREPAID_EVIDENCE_DIR must name private durable original-operation evidence')
  const units = cfg.raw.KK_PREPAID_SLOT_TASRA_UNITS ?? '1000000000000000000'
  assert(/^[1-9][0-9]{0,77}$/.test(units) && BigInt(units) <= uint256Max, 'Slot funding must be positive uint256 TASRA base units')
  // Certification has a spending ceiling independent of the configurable deposit.
  assert(BigInt(units) <= 10000000000000000000n, 'Local fixture deposit exceeds the 10 TASRA ceiling')
  return {directory, amount: BigInt(units)}
}

export async function assertLocalPrepaidFleet(cfg: LocalPrepaidFleet, writer: TasraWriteClient) {
  const settings = localPrepaidSettings(cfg)
  assert.equal(await writer.pub.getChainId(), 43112, 'RPC chain differs from the local certification deployment')
  assert(cfg.book.Settlement && cfg.book.TasraToken && cfg.book.KeyRegistry, 'Paid fleet needs Settlement, TASRA and KeyRegistry')
  assert.equal(await writer.pub.readContract({address: cfg.book.Settlement, abi: genesisAbi, functionName: 'prepaidFromGenesis'}), true,
    'Fresh fleet acceptance requires prepaid genesis; legacy governance cutover is separate')
  const token = await writer.pub.readContract({address: cfg.book.Settlement, abi: genesisAbi, functionName: 'token'})
  assert.equal(token.toLowerCase(), cfg.book.TasraToken.toLowerCase(), 'Settlement must hold the configured TASRA token')
  return settings
}

export async function fundFreshWalletSlot(cfg: FleetConfig, writer: TasraWriteClient, creatorKey: Hex,
  created: {slotId: Hex; ruleSalt: Hex; commitTx: Hex; revealTx: Hex}, rule: string, options: {payerKey?: Hex} = {}) {
  const {directory, amount} = await assertLocalPrepaidFleet(cfg, writer)
  const settlement = cfg.book.Settlement!, keyRegistry = cfg.book.KeyRegistry!
  const deployment = {chainId: 43112, settlement, keyRegistry}
  const store = createFileStore(directory), name = `funding-43112-${created.slotId.slice(2)}`
  return store.withLock(name, async () => {
    assert.equal(await store.load(name), undefined, 'Original slot funding already recorded; reconcile it before further spending')
    const creation = await writer.pub.getTransactionReceipt({hash: created.revealTx})
    assert.equal(creation.status, 'success', 'Original slot reveal must have succeeded')
    assert.equal(creation.to?.toLowerCase(), keyRegistry.toLowerCase(), 'Original reveal must target the approved registry')
    assert.equal(creation.from.toLowerCase(), writer.address.toLowerCase(), 'Original reveal must be from this sovereign creator')
    const block = await writer.pub.getBlock({blockNumber: creation.blockNumber})
    assert.equal(block.hash, creation.blockHash, 'Original slot creation must remain canonical')
    const slot = await writer.pub.readContract({address: keyRegistry, abi: keyRegistryAbi, functionName: 'getKeySlot', args: [created.slotId]})
    assert(slot.exists && !slot.cancelled, 'Original slot must exist and be live')
    assert.equal(slot.creator.toLowerCase(), writer.address.toLowerCase(), 'Funding evidence must retain the original creator')
    assert.equal(slot.ruleCommitment.toLowerCase(), ruleCommitment(created.ruleSalt, rule).toLowerCase(), 'Retained rule and salt must reproduce the original slot commitment')
    const before = await readSlotFunding(writer.pub, deployment, created.slotId)
    assert.equal(before.total, 0n, 'Fresh fixture funding refuses an already funded or reserved slot')
    // Use a supplied bounded wallet: the legacy raw-key write client installs
    // nonce retries, which are inappropriate after an uncertain prepaid spend.
    const payerWallet = createWalletClient({account: privateKeyToAccount(options.payerKey ?? cfg.deployPk as Hex),
      chain: writer.wallet.chain, transport: http(cfg.rpcUrl, {retryCount: 0, timeout: 15_000})})
    const funder = createTasraWriteClient({rpcUrl: cfg.rpcUrl, addresses: cfg.book, wallet: payerWallet, chainId: 43112})
    assert(await funder.tsraBalance() >= amount, 'Local funder lacks the finite requested TASRA deposit')
    const original = {schema: 1, deployment, ...created, rule, creatorKey, creator: writer.address,
      funder: funder.address, amount, creationBlock: creation.blockHash, before,
      payerNonce: await funder.pub.getTransactionCount({address: funder.address, blockTag: 'pending'})}
    // Durable original inputs precede the first approval/deposit. Unknown outcomes
    // leave this record in place; a second invocation cannot spend again.
    await store.save(name, {...original, phase: 'prepared'})
    const transaction = await funder.fundSlot(created.slotId, amount)
    await store.save(name, {...original, phase: 'submitted', transaction})
    const after = await readSlotFunding(writer.pub, deployment, created.slotId)
    assert(after.enabled && after.available === amount && after.reserved === 0n && after.total === amount,
      'Canonical funding must enable prepaid and credit exactly the real TASRA deposit')
    await store.save(name, {...original, phase: 'confirmed', transaction, after})
    return after
  })
}
