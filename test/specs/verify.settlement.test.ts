import {expect, it} from 'vitest'
import {awaitMeteredSettlement, settlementComplete, type FundedSlot, type SettlementObservation} from '../verify/settlement.ts'
import {requiredSettledSlots, settlementObservationBudget, SETTLEMENT_STAGE_TIMEOUT_MS} from '../verify/settlement-budget.ts'

const slotA = `0x${'22'.repeat(32)}` as const, slotB = `0x${'23'.repeat(32)}` as const
const originals: FundedSlot[] = [{slot: slotA, amount: 100n}, {slot: slotB, amount: 100n}]
/** Slot A settled one window that charged 20; slot B served nothing and holds its whole deposit. */
const observed = (): SettlementObservation => ({blockHash: `0x${'33'.repeat(32)}`, revenueSplit: [5000, 4000, 1000], slots: [
  {slot: slotA, funded: 100n, fundings: 1, withdrawn: 0n, balance: 80n, lastNonce: 3n, windows: [{nonce: 3n, baseNonce: 0n}]},
  {slot: slotB, funded: 100n, fundings: 1, withdrawn: 0n, balance: 100n, lastNonce: 0n, windows: []},
]})
const unsettled = () => { const o = observed(); o.slots[0] = {...o.slots[0]!, balance: 100n, lastNonce: 0n, windows: []}; return o }

it('accepts a conserved workload once the required slots were charged by a settlement window', () => {
  expect(settlementComplete(originals, observed(), 1)).toBe(true)
  const more = observed(); more.slots[0]!.windows.push({nonce: 7n, baseNonce: 3n}); more.slots[0]!.lastNonce = 7n; more.slots[0]!.balance = 60n
  expect(settlementComplete(originals, more, 1)).toBe(true)
})
it('does not confuse served operations with settled metered work', () => {
  expect(settlementComplete(originals, unsettled(), 1)).toBe(false)
  // A window that charged nothing is not billed work.
  const empty = observed(); empty.slots[0]!.balance = 100n
  expect(settlementComplete(originals, empty, 1)).toBe(false)
  expect(settlementComplete(originals, observed(), 2)).toBe(false)
})
it.each(['unfunded', 'funded-twice', 'wrong-deposit', 'withdrawn', 'overbalance', 'charged-without-window', 'skipped-cursor', 'stale-window',
  'cursor-mismatch', 'substituted', 'missing-slot', 'split'] as const)('refuses invalid canonical evidence: %s', kind => {
  const o = observed(), a = o.slots[0]!, b = o.slots[1]!
  if (kind === 'unfunded') { b.fundings = 0; b.funded = 0n; b.balance = 0n }
  if (kind === 'funded-twice') { b.fundings = 2; b.funded = 200n }
  if (kind === 'wrong-deposit') b.funded = 99n
  if (kind === 'withdrawn') b.withdrawn = 1n
  if (kind === 'overbalance') a.balance = 101n
  if (kind === 'charged-without-window') b.balance = 99n
  if (kind === 'skipped-cursor') a.windows = [{nonce: 3n, baseNonce: 1n}]
  if (kind === 'stale-window') a.windows = [{nonce: 3n, baseNonce: 0n}, {nonce: 3n, baseNonce: 3n}]
  if (kind === 'cursor-mismatch') a.lastNonce = 4n
  if (kind === 'substituted') a.slot = `0x${'44'.repeat(32)}`
  if (kind === 'missing-slot') o.slots.pop()
  if (kind === 'split') o.revenueSplit = [5000, 4000, 999]
  expect(() => settlementComplete(originals, o, 1)).toThrow()
})
it('refuses empty and duplicated workloads and an impossible requirement', () => {
  expect(() => settlementComplete([], {...observed(), slots: []}, 1)).toThrow()
  expect(() => settlementComplete([originals[0]!, originals[0]!], observed(), 1)).toThrow()
  expect(() => settlementComplete(originals, observed(), 0)).toThrow()
  expect(() => settlementComplete(originals, observed(), 3)).toThrow()
})
it('observes eventual settlement without sending anything', async () => {
  let calls = 0, now = 0
  const result = await awaitMeteredSettlement(originals, async () => (++calls === 1 ? unsettled() : observed()), 1,
    {now: () => now, sleep: async ms => {now += ms}}, 4000)
  expect(calls).toBe(2); expect(result.slots[0]!.balance).toBe(80n)
})
it('ends a bounded observation with an explicit failure that keeps the fleet', async () => {
  let now = 0
  await expect(awaitMeteredSettlement(originals, async () => unsettled(), 1,
    {now: () => now, sleep: async ms => {now += ms}}, 4000)).rejects.toThrow('retain fleet and journals')
  expect(now).toBe(4000)
})
it('does not mask failed RPC observations as successful settlement', async () => {
  await expect(awaitMeteredSettlement(originals, async () => {throw new Error('RPC unavailable')}, 1)).rejects.toThrow('RPC unavailable')
})

it('bounds the observation budget and keeps it inside the process deadline', () => {
  expect(settlementObservationBudget(undefined)).toBe(900_000)
  expect(settlementObservationBudget('60')).toBe(60_000)
  expect(settlementObservationBudget('3600')).toBe(3_600_000)
  expect(SETTLEMENT_STAGE_TIMEOUT_MS - settlementObservationBudget('3600')).toBe(60_000)
})
it.each(['', '0', '59', '3601', '1.5', ' 60', '060', 'NaN', '-60'])('refuses an invalid or unbounded observation timeout: %s', value => {
  expect(() => settlementObservationBudget(value)).toThrow()
})
it('requires at least one settled slot and never more than were funded', () => {
  expect(requiredSettledSlots(undefined, 5)).toBe(1)
  expect(requiredSettledSlots('3', 5)).toBe(3)
  for (const value of ['0', '6', '1.5', '', 'x']) expect(() => requiredSettledSlots(value, 5)).toThrow()
  expect(() => requiredSettledSlots(undefined, 0)).toThrow()
})
