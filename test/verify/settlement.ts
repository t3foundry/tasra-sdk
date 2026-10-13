// Read-only gate before destructive scenarios. Never recreate or submit a payment.
import assert from 'node:assert/strict'
import {mkdtempSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createPublicClient, http, parseAbiItem, type Hex} from 'viem'
import {createFileStore} from '../../src/app/node.ts'
import {loadPaidReservationJournal} from '../../src/app/paid-journal.ts'
import type {PaidReservationRecord} from '../../src/chain/reservation.ts'
import {settlementAbi} from '../../src/chain/abis/settlement.ts'
import {localPrepaidSettings} from '../fleet/_prepaid-funding.ts'
import {fleetConfig, networkDir, sdkRoot, chainEnvPath} from './_run.ts'
import {settlementObservationBudget} from './settlement-budget.ts'
import {retainRecipientFees, saveCertificationEvidence} from './recipient-fees.ts'

export interface OriginalPayment {requestId: Hex; slot: Hex; cost: bigint; expires: number}
export interface SettlementObservation {
  blockHash: Hex
  requests: Array<{requestId: Hex; settled: boolean; events: Array<{paid: bigint; refunded: bigint}>}>
  reserved: bigint[]
}

/** Incomplete work waits; inconsistent canonical evidence fails immediately. */
export function settlementComplete(originals: OriginalPayment[], observation: SettlementObservation): boolean {
  assert(originals.length > 0 && originals.length <= 256, 'Expected a bounded nonempty original workload')
  const ids = originals.map(p => p.requestId.toLowerCase())
  assert.equal(new Set(ids).size, ids.length, 'Duplicate original request')
  assert.equal(observation.requests.length, originals.length, 'Missing request observation')
  assert.equal(observation.reserved.length, new Set(originals.map(p => p.slot.toLowerCase())).size, 'Missing slot observation')
  assert(observation.reserved.every(n => n >= 0n), 'Invalid reserved balance')
  let complete = true
  for (const [index, original] of originals.entries()) {
    const current = observation.requests[index]!
    assert.equal(current.requestId.toLowerCase(), original.requestId.toLowerCase(), 'Substituted request observation')
    assert(original.cost > 0n, 'Invalid original fee')
    assert(current.events.length <= 1, 'Original request reconciled more than once')
    if (!current.settled) {
      assert.equal(current.events.length, 0, 'Unsettled request has a reconciliation event')
      complete = false
      continue
    }
    assert.equal(current.events.length, 1, 'Settled request lacks its reconciliation event')
    const event = current.events[0]!
    assert(event.paid >= 0n && event.refunded >= 0n, 'Negative settlement amount')
    assert.equal(event.paid + event.refunded, original.cost, 'Original fee was lost or overcharged')
  }
  return complete && observation.reserved.every(n => n === 0n)
}

export async function awaitOriginalSettlements(originals: OriginalPayment[], observe: () => Promise<SettlementObservation>,
  clock = {now: () => Date.now(), sleep: (ms: number) => new Promise<void>(r => setTimeout(r, ms))}, timeoutMs = 600_000) {
  const deadline = clock.now() + timeoutMs
  for (;;) {
    const observation = await observe()
    if (settlementComplete(originals, observation)) return observation
    const remaining = deadline - clock.now()
    assert(remaining > 0, 'Original payments remain unsettled; retain fleet and journals for recovery')
    await clock.sleep(Math.min(2000, remaining))
  }
}

async function main() {
  process.umask(0o077)
  const cfg = fleetConfig(), settings = localPrepaidSettings(cfg)
  const settlement = cfg.book.Settlement
  assert(settlement, 'Settlement deployment missing')
  const store = createFileStore(settings.directory)
  const keys = (await store.list!('prepaid-')).filter(k => /^prepaid-0x[0-9a-f]{64}$/.test(k)).sort()
  assert(keys.length > 0 && keys.length <= 256, 'No bounded original paid workload to verify')
  const originals: OriginalPayment[] = []
  const records: PaidReservationRecord[] = []
  for (const key of keys) {
    const journal = await loadPaidReservationJournal(store, key.slice(8) as Hex)
    assert(journal?.phase === 'confirmed', 'Unconfirmed original payment requires recovery before certification')
    const {record} = journal
    records.push(record)
    assert.equal(record.payment.chain_id, 43112)
    assert.equal(record.payment.settlement.toLowerCase(), settlement.toLowerCase(), 'Original belongs to another deployment')
    originals.push({requestId: record.requestId, slot: record.payment.slot, cost: BigInt(record.quote.costs[0]!), expires: record.payment.expires})
  }
  const client = createPublicClient({transport: http(cfg.rpcUrl, {retryCount: 0, timeout: 15_000, fetchOptions: {redirect: 'error'}})})
  assert.equal(await client.getChainId(), 43112)
  const slots = [...new Set(originals.map(p => p.slot))]
  const timeoutMs = settlementObservationBudget(originals.map(p => p.expires), Date.now())
  const observation = await awaitOriginalSettlements(originals, async () => {
    const block = await client.getBlock({blockTag: 'latest'})
    const events = await client.getLogs({address: settlement, event: parseAbiItem('event PrepaidReconciled(bytes32 indexed slotId, bytes32 indexed requestId, bytes32 indexed batchId, uint256 paid, uint256 refunded)'),
      args: {slotId: slots}, fromBlock: 0n, toBlock: block.number, strict: true})
    const requests: SettlementObservation['requests'] = []
    for (const original of originals) requests.push({requestId: original.requestId,
      settled: await client.readContract({address: settlement, abi: settlementAbi, functionName: 'prepaidSettled', args: [original.slot, original.requestId], blockNumber: block.number}),
      events: events.filter(e => e.args.slotId.toLowerCase() === original.slot.toLowerCase() && e.args.requestId.toLowerCase() === original.requestId.toLowerCase())
        .map(e => {assert(!e.removed); return {paid: e.args.paid, refunded: e.args.refunded}})})
    const reserved: bigint[] = []
    for (const slot of slots) reserved.push(await client.readContract({address: settlement, abi: settlementAbi, functionName: 'reservedBalanceOf', args: [slot], blockNumber: block.number}))
    assert.equal((await client.getBlock({blockNumber: block.number})).hash, block.hash, 'Settlement observation reorganized')
    return {blockHash: block.hash, requests, reserved}
  }, undefined, timeoutMs)
  assert.deepEqual((await store.list!('prepaid-')).filter(k => /^prepaid-0x[0-9a-f]{64}$/.test(k)).sort(), keys, 'Original workload changed during verification')
  const output = mkdtempSync(join(settings.directory, 'settlement-proof-'))
  const recipientManifest = await retainRecipientFees(cfg, records, output, networkDir, sdkRoot, chainEnvPath)
  assert.deepEqual((await store.list!('prepaid-')).filter(k => /^prepaid-0x[0-9a-f]{64}$/.test(k)).sort(), keys, 'Original workload changed during recipient verification')
  for (const record of records) assert.deepEqual((await loadPaidReservationJournal(store, record.requestId))?.record, record, 'Original payment changed during recipient verification')
  saveCertificationEvidence(join(output, 'PASS.json'), {originals, observation, recipientFeeVerification: true, recipientManifest})
  console.log(`Verified ${originals.length} original payments: one reconciliation each, exact recipient fees and paid/refunded totals, zero reserved TASRA; accountant evidence retained. Evidence: ${output}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => {console.error(error instanceof Error ? error.message : 'Settlement gate failed'); process.exitCode = 1})
