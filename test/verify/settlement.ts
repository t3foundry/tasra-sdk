// Read-only gate before destructive scenarios: the METERED billing lifecycle of the workload.
//
// The harness funded every fixture slot once (test/fleet/_wallet-settings.ts journals each
// deposit). The keepers meter the operations served on those slots and the accountant set settles
// them later. This gate reads the chain only (it never sends anything) and requires:
//   - conservation on every funded slot: its deposit is on chain exactly once, nothing was
//     withdrawn, its balance never exceeds the deposit, and a slot without a settlement window
//     still holds its whole deposit (nothing is charged outside a window);
//   - cursor order: a slot's windows advance its nonce one after another up to `lastNonce`;
//   - recipients: every window names who was paid (test/verify/recipient-fees.ts);
//   - progress: at least the required number of slots show a charged settlement window, i.e.
//     metered work was billed end to end. It waits (bounded) for that; inconsistent canonical
//     evidence fails at once.
import assert from 'node:assert/strict'
import {mkdtempSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createPublicClient, http, parseAbiItem, type Hex} from 'viem'
import {createFileStore} from '../../src/app/node.ts'
import {settlementAbi} from '../../src/chain/abis/settlement.ts'
import {localFleetSettings, type SlotFundingRecord} from '../fleet/_wallet-settings.ts'
import {fleetConfig} from './_run.ts'
import {requiredSettledSlots, settlementObservationBudget} from './settlement-budget.ts'
import {requireRecipientCoverage, saveCertificationEvidence, type RecipientEvidence} from './recipient-fees.ts'

/** One fixture slot and the deposit its journal records. */
export interface FundedSlot {slot: Hex; amount: bigint}
export interface SlotObservation {
  slot: Hex
  /** Sum and count of `Funded` events of the slot. */
  funded: bigint
  fundings: number
  /** Sum of `Withdrawn` events of the slot. */
  withdrawn: bigint
  balance: bigint
  lastNonce: bigint
  /** `SettlementWindow` events of the slot, in log order. */
  windows: Array<{nonce: bigint; baseNonce: bigint}>
}
export interface SettlementObservation {
  blockHash: Hex
  /** Keykeeper, verifier and accountant shares in basis points (`revenueSplit()`). */
  revenueSplit: readonly [number, number, number]
  slots: SlotObservation[]
}

/** Incomplete work waits (false); inconsistent canonical evidence fails immediately (throws). */
export function settlementComplete(originals: FundedSlot[], observation: SettlementObservation, required: number): boolean {
  assert(originals.length > 0 && originals.length <= 256, 'Expected a bounded nonempty funded workload')
  const ids = originals.map(p => p.slot.toLowerCase())
  assert.equal(new Set(ids).size, ids.length, 'Duplicate funded slot')
  assert(Number.isSafeInteger(required) && required >= 1 && required <= originals.length, 'Invalid required settled slots')
  assert.equal(observation.slots.length, originals.length, 'Missing slot observation')
  const [keepers, verifiers, accountants] = observation.revenueSplit
  assert([keepers, verifiers, accountants].every(b => Number.isInteger(b) && b >= 0) && keepers + verifiers + accountants === 10_000, 'Revenue split does not sum to 100%')
  let settled = 0
  for (const [index, original] of originals.entries()) {
    const current = observation.slots[index]!
    assert.equal(current.slot.toLowerCase(), original.slot.toLowerCase(), 'Substituted slot observation')
    assert(original.amount > 0n, 'Invalid original deposit')
    assert(current.fundings === 1 && current.funded === original.amount, 'Slot deposit differs from its original funding record')
    assert.equal(current.withdrawn, 0n, 'Fixture slot was withdrawn from')
    assert(current.balance >= 0n && current.balance <= current.funded, 'Slot balance exceeds its deposit')
    let cursor = 0n
    for (const window of current.windows) {
      assert.equal(window.baseNonce, cursor, 'Settlement window skipped or repeated its cursor')
      assert(window.nonce > window.baseNonce, 'Settlement window does not advance its cursor')
      cursor = window.nonce
    }
    assert.equal(current.lastNonce, cursor, 'Slot cursor differs from its settlement windows')
    if (current.windows.length === 0) assert.equal(current.balance, current.funded, 'Slot was charged outside a settlement window')
    else if (current.balance < current.funded) settled++
  }
  return settled >= required
}

export async function awaitMeteredSettlement(originals: FundedSlot[], observe: () => Promise<SettlementObservation>, required: number,
  clock = {now: () => Date.now(), sleep: (ms: number) => new Promise<void>(r => setTimeout(r, ms))}, timeoutMs = 900_000) {
  const deadline = clock.now() + timeoutMs
  for (;;) {
    const observation = await observe()
    if (settlementComplete(originals, observation, required)) return observation
    const remaining = deadline - clock.now()
    assert(remaining > 0, 'Metered work remains unsettled; retain fleet and journals for inspection')
    await clock.sleep(Math.min(2000, remaining))
  }
}

async function main() {
  process.umask(0o077)
  const cfg = fleetConfig(), settings = localFleetSettings(cfg)
  const settlement = cfg.book.Settlement
  assert(settlement, 'Settlement deployment missing')
  const store = createFileStore(settings.directory)
  const fundingKeys = async () => (await store.list!('funding-43112-')).filter(k => /^funding-43112-[0-9a-f]{64}$/.test(k)).sort()
  const keys = await fundingKeys()
  assert(keys.length > 0 && keys.length <= 256, 'No bounded funded workload to verify')
  const originals: FundedSlot[] = []
  for (const key of keys) {
    const record = await store.load<SlotFundingRecord>(key)
    assert(record?.schema === 2 && record.phase === 'confirmed', 'Unconfirmed slot funding requires inspection before certification')
    assert.equal(key, `funding-43112-${record.slotId.slice(2).toLowerCase()}`, 'Funding record names another slot')
    originals.push({slot: record.slotId, amount: BigInt(record.amount)})
  }
  const client = createPublicClient({transport: http(cfg.rpcUrl, {retryCount: 0, timeout: 15_000, fetchOptions: {redirect: 'error'}})})
  assert.equal(await client.getChainId(), 43112)
  const slots = originals.map(p => p.slot)
  const required = requiredSettledSlots(process.env.KK_VERIFY_MIN_SETTLED_SLOTS, originals.length)
  const timeoutMs = settlementObservationBudget(process.env.KK_VERIFY_SETTLEMENT_TIMEOUT_SECS)
  type EventLog = {args: Record<string, unknown>; transactionHash: Hex; removed: boolean; blockNumber: bigint; logIndex: number}
  // One reader for every Settlement event: strict decoding, from genesis to the observed block.
  const logs = (signature: string, toBlock: bigint, args?: {slotId: Hex[]}): Promise<EventLog[]> =>
    client.getLogs({address: settlement, event: parseAbiItem(signature), ...(args ? {args} : {}), fromBlock: 0n, toBlock, strict: true} as never) as unknown as Promise<EventLog[]>
  let recipients: RecipientEvidence = {windows: [], bundles: [], roots: [], consolidated: []}
  const observation = await awaitMeteredSettlement(originals, async () => {
    const block = await client.getBlock({blockTag: 'latest'})
    const [funded, withdrawn, windows, bundles, settledLogs, roots, consolidated, split] = await Promise.all([
      logs('event Funded(bytes32 indexed slotId, address indexed funder, uint256 amount, uint256 newBalance)', block.number, {slotId: slots}),
      logs('event Withdrawn(bytes32 indexed slotId, address indexed to, uint256 amount, uint256 remainingBalance)', block.number, {slotId: slots}),
      logs('event SettlementWindow(bytes32 indexed slotId, uint64 indexed nonce, uint64 baseNonce)', block.number, {slotId: slots}),
      logs('event BundleSettled(bytes32 indexed slotId, uint64 indexed nonce, address[] recipients, uint256[] amounts, uint64 deadline, bytes32 digest)', block.number, {slotId: slots}),
      logs('event Settled(bytes32 indexed slotId, uint64 nonce, uint256 totalPaid, uint256 recipientCount, uint256 remainingBalance)', block.number, {slotId: slots}),
      logs('event BundleRootSettled(bytes32 indexed slotId, uint64 indexed nonce, bytes32 root, uint256 total, uint64 deadline, bytes32 digest)', block.number, {slotId: slots}),
      logs('event ConsolidatedSettled(bytes32 indexed batchId, bytes32 root, uint256 total, uint256 coveredCount, uint64 deadline, bytes32 digest)', block.number),
      client.readContract({address: settlement, abi: settlementAbi, functionName: 'revenueSplit', blockNumber: block.number}),
    ])
    for (const log of [...funded, ...withdrawn, ...windows, ...bundles, ...settledLogs, ...roots, ...consolidated]) assert(!log.removed, 'Settlement evidence was reorganized')
    const of = (list: typeof funded, slot: Hex) => list.filter(l => (l.args.slotId as Hex).toLowerCase() === slot.toLowerCase())
      .sort((a, b) => a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1)
    const observed: SlotObservation[] = []
    for (const slot of slots) {
      const [balance, lastNonce] = await Promise.all([
        client.readContract({address: settlement, abi: settlementAbi, functionName: 'balanceOf', args: [slot], blockNumber: block.number}),
        client.readContract({address: settlement, abi: settlementAbi, functionName: 'lastNonce', args: [slot], blockNumber: block.number})])
      observed.push({slot, balance, lastNonce: BigInt(lastNonce), fundings: of(funded, slot).length,
        funded: of(funded, slot).reduce((sum, l) => sum + (l.args.amount as bigint), 0n),
        withdrawn: of(withdrawn, slot).reduce((sum, l) => sum + (l.args.amount as bigint), 0n),
        windows: of(windows, slot).map(l => ({nonce: BigInt(l.args.nonce as bigint), baseNonce: BigInt(l.args.baseNonce as bigint)}))})
    }
    const totalPaid = (tx: Hex, slot: Hex, nonce: bigint) => {
      const match = settledLogs.filter(l => l.transactionHash === tx && (l.args.slotId as Hex).toLowerCase() === slot.toLowerCase() && BigInt(l.args.nonce as bigint) === nonce)
      assert.equal(match.length, 1, 'A pushed bundle needs its one Settled event')
      return match[0]!.args.totalPaid as bigint
    }
    recipients = {
      windows: windows.map(l => ({slot: l.args.slotId as Hex, nonce: BigInt(l.args.nonce as bigint), baseNonce: BigInt(l.args.baseNonce as bigint), transactionHash: l.transactionHash})),
      bundles: bundles.map(l => ({slot: l.args.slotId as Hex, nonce: BigInt(l.args.nonce as bigint), recipients: l.args.recipients as Hex[], amounts: l.args.amounts as bigint[],
        totalPaid: totalPaid(l.transactionHash, l.args.slotId as Hex, BigInt(l.args.nonce as bigint)), transactionHash: l.transactionHash})),
      roots: roots.map(l => ({slot: l.args.slotId as Hex, nonce: BigInt(l.args.nonce as bigint), root: l.args.root as Hex, total: l.args.total as bigint, transactionHash: l.transactionHash})),
      consolidated: consolidated.map(l => ({batchId: l.args.batchId as Hex, root: l.args.root as Hex, total: l.args.total as bigint, coveredCount: l.args.coveredCount as bigint, transactionHash: l.transactionHash})),
    }
    assert.equal((await client.getBlock({blockNumber: block.number})).hash, block.hash, 'Settlement observation reorganized')
    return {blockHash: block.hash, revenueSplit: [Number(split[0]), Number(split[1]), Number(split[2])] as const, slots: observed}
  }, required, undefined, timeoutMs)
  assert.deepEqual(await fundingKeys(), keys, 'Funded workload changed during verification')
  const coverage = requireRecipientCoverage(recipients)
  // Where the chain states what each window charged, the slot's balance drop is exactly their sum.
  for (const slot of observation.slots) {
    const mine = coverage.filter(c => c.slot.toLowerCase() === slot.slot.toLowerCase())
    if (mine.every(c => c.charged !== undefined)) {
      assert.equal(slot.funded - slot.balance, mine.reduce((sum, c) => sum + c.charged!, 0n), 'Slot balance drop differs from what its settlement windows charged')
    }
  }
  const output = mkdtempSync(join(settings.directory, 'settlement-proof-'))
  saveCertificationEvidence(join(output, 'PASS.json'), {originals, observation, required, recipients, coverage})
  const settled = observation.slots.filter(s => s.windows.length > 0 && s.balance < s.funded).length
  console.log(`Verified ${originals.length} funded slots: deposits conserved, cursors in order, ${coverage.length} settlement windows with recipient evidence, `
    + `${settled} slot(s) charged by metered settlement (required ${required}). Evidence: ${output}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => {console.error(error instanceof Error ? error.message : 'Settlement gate failed'); process.exitCode = 1})
