import {expect, it} from 'vitest'
import {awaitOriginalSettlements, settlementComplete, type OriginalPayment, type SettlementObservation} from '../verify/settlement.ts'
const originals: OriginalPayment[] = [{requestId: `0x${'11'.repeat(32)}`, slot: `0x${'22'.repeat(32)}`, cost: 100n}]
const observed = (): SettlementObservation => ({blockHash: `0x${'33'.repeat(32)}`, requests: [{requestId: originals[0]!.requestId,
  settled: true, events: [{paid: 20n, refunded: 80n}]}], reserved: [0n]})
it('accepts exact work-only billing and full refunds when nobody worked', () => {
  expect(settlementComplete(originals, observed())).toBe(true)
  const noWork = observed(); noWork.requests[0]!.events = [{paid: 0n, refunded: 100n}]
  expect(settlementComplete(originals, noWork)).toBe(true)
})
it('does not confuse execution success or an empty reservation balance with settled original payments', () => {
  const unpaid = observed(); unpaid.requests[0]!.settled = false; unpaid.requests[0]!.events = []
  expect(settlementComplete(originals, unpaid)).toBe(false)
  const stranded = observed(); stranded.reserved = [100n]
  expect(settlementComplete(originals, stranded)).toBe(false)
})
it.each(['missing', 'duplicate', 'overcharged', 'lost', 'substituted', 'missing-slot'] as const)('refuses invalid canonical evidence: %s', kind => {
  const o = observed()
  if (kind === 'missing') o.requests[0]!.events = []
  if (kind === 'duplicate') o.requests[0]!.events.push({paid: 20n, refunded: 80n})
  if (kind === 'overcharged') o.requests[0]!.events[0]!.paid = 21n
  if (kind === 'lost') o.requests[0]!.events[0]!.refunded = 79n
  if (kind === 'substituted') o.requests[0]!.requestId = `0x${'44'.repeat(32)}`
  if (kind === 'missing-slot') o.reserved = []
  expect(() => settlementComplete(originals, o)).toThrow()
})
it('refuses empty and duplicated workloads', () => {
  expect(() => settlementComplete([], {blockHash: observed().blockHash, requests: [], reserved: []})).toThrow()
  expect(() => settlementComplete([...originals, ...originals], observed())).toThrow()
})
it('observes eventual settlement without sending or replacing an operation', async () => {
  let calls = 0, now = 0
  const result = await awaitOriginalSettlements(originals, async () => {
    calls++; const o = observed(); if (calls === 1) {o.requests[0]!.settled = false; o.requests[0]!.events = []; o.reserved = [100n]} return o
  }, {now: () => now, sleep: async ms => {now += ms}}, 4000)
  expect(calls).toBe(2); expect(result.reserved).toEqual([0n])
})
it('ends a bounded observation with an explicit recovery failure', async () => {
  let now = 0
  const o = observed(); o.requests[0]!.settled = false; o.requests[0]!.events = []
  await expect(awaitOriginalSettlements(originals, async () => o,
    {now: () => now, sleep: async ms => {now += ms}}, 4000)).rejects.toThrow('retain fleet and journals')
  expect(now).toBe(4000)
})
it('does not mask failed RPC observations as successful settlement', async () => {
  await expect(awaitOriginalSettlements(originals, async () => {throw new Error('RPC unavailable')})).rejects.toThrow('RPC unavailable')
})
