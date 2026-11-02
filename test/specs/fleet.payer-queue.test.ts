import {expect, it, vi} from 'vitest'
import {withDedicatedPayer} from '../fleet/_payer-queue.ts'

it('serializes reservation sends from one payer while preserving every individual result', async () => {
  let release!: () => void
  const blocked = new Promise<void>(resolve => {release = resolve}), calls: string[] = []
  const first = withDedicatedPayer('same-payer', async () => {calls.push('first-start'); await blocked; calls.push('first-end'); return 1})
  const second = withDedicatedPayer('same-payer', async () => {calls.push('second'); return 2})
  await Promise.resolve(); expect(calls).toEqual(['first-start'])
  release(); expect(await Promise.all([first, second])).toEqual([1, 2])
  expect(calls).toEqual(['first-start', 'first-end', 'second'])
})
it('permits independent reservation gas payers to progress concurrently', async () => {
  let release!: () => void
  const blocked = new Promise<void>(resolve => {release = resolve})
  const first = withDedicatedPayer('payer-a', async () => {await blocked; return 1})
  expect(await withDedicatedPayer('payer-b', async () => 2)).toBe(2)
  release(); expect(await first).toBe(1)
})
it('propagates original uncertainty and lets the durable SDK payer check fence the next request', async () => {
  const checkDurablePending = vi.fn(async () => {throw new Error('original payer reservation is unresolved')})
  const original = withDedicatedPayer('uncertain-payer', async () => {throw new Error('lost original transaction reply')})
  const next = withDedicatedPayer('uncertain-payer', checkDurablePending)
  await expect(original).rejects.toThrow('lost original transaction reply')
  await expect(next).rejects.toThrow('original payer reservation is unresolved')
  expect(checkDurablePending).toHaveBeenCalledTimes(1)
})
it('releases the in-process queue after a settled reservation rather than serializing keeper work', async () => {
  expect(await withDedicatedPayer('settled-payer', async () => 'mined')).toBe('mined')
  expect(await withDedicatedPayer('settled-payer', async () => 'next-independent-operation')).toBe('next-independent-operation')
})
