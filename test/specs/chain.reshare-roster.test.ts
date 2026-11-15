// ADR-0099 D2: a threshold-ECDSA reshare roster must keep at least the current k members, because
// only staying members re-deal the key. The check runs before any vote is signed.
import {describe, expect, it, vi} from 'vitest'
import {getAddress, type Address, type Hex} from 'viem'
import {MAX_RESHARE_PARTIES, ReshareRosterError, checkReshareOnChain, checkTecdsaReshareRoster} from '../../src/chain/reshareRoster.js'

const a = (n: number): Address => getAddress(`0x${n.toString(16).padStart(40, '0')}`)
const current = [a(1), a(2), a(3), a(4), a(5)]

function refusal(run: () => unknown): ReshareRosterError {
  try {
    run()
  } catch (e) {
    expect(e).toBeInstanceOf(ReshareRosterError)
    expect((e as ReshareRosterError).retryable).toBe(false)
    return e as ReshareRosterError
  }
  throw new Error('did not refuse')
}

describe('checkTecdsaReshareRoster', () => {
  it('a keeper-loss replacement keeps k and names who deals, joins and leaves', () => {
    const plan = checkTecdsaReshareRoster({current, currentK: 3, next: [a(1), a(2), a(3), a(4), a(9)], k: 3, n: 5})
    expect(plan).toEqual({staying: [a(1), a(2), a(3), a(4)], joining: [a(9)], leaving: [a(5)]})
  })

  it('exactly k staying is enough, with a new size and threshold', () => {
    const plan = checkTecdsaReshareRoster({current, currentK: 3, next: [a(9), a(3), a(1), a(8), a(2), a(7), a(6)], k: 4, n: 7})
    expect(plan.staying).toEqual([a(3), a(1), a(2)])
    expect(plan.joining).toEqual([a(9), a(8), a(7), a(6)])
  })

  it('accepts lowercase input and returns checksummed addresses', () => {
    const plan = checkTecdsaReshareRoster({current: current.map(x => x.toLowerCase() as Address), currentK: 2, next: [a(1).toLowerCase() as Address, a(2)], k: 2, n: 2})
    expect(plan.staying).toEqual([a(1), a(2)])
  })

  it('refuses k - 1 staying members, naming the counts', () => {
    const e = refusal(() => checkTecdsaReshareRoster({current, currentK: 3, next: [a(1), a(2), a(7), a(8), a(9)], k: 3, n: 5}))
    expect(e).toMatchObject({code: 'keeps-too-few', staying: 2, k: 3})
    expect(e.message).toMatch(/second reshare/)
  })

  it('refuses a whole-committee swap', () => {
    expect(refusal(() => checkTecdsaReshareRoster({current, currentK: 2, next: [a(7), a(8), a(9)], k: 2, n: 3}))).toMatchObject({code: 'keeps-too-few', staying: 0, k: 2})
  })

  it('a duplicate cannot inflate the staying count', () => {
    expect(refusal(() => checkTecdsaReshareRoster({current, currentK: 2, next: [a(1), a(1), a(9)], k: 2, n: 3})).code).toBe('invalid-roster')
  })

  it.each([
    ['k below the tECDSA floor of 2', {k: 1, n: 3}],
    ['k above n', {k: 4, n: 3}],
    ['n different from the roster length', {k: 2, n: 4}],
    ['a fractional k', {k: 2.5, n: 3}],
  ])('refuses %s', (_name, t) => {
    expect(refusal(() => checkTecdsaReshareRoster({current, currentK: 2, next: [a(1), a(2), a(3)], ...t})).code).toBe('invalid-roster')
  })

  it(`refuses more than ${MAX_RESHARE_PARTIES} parties`, () => {
    const next = Array.from({length: MAX_RESHARE_PARTIES + 1}, (_, i) => a(i + 1))
    expect(refusal(() => checkTecdsaReshareRoster({current, currentK: 2, next, k: 2, n: next.length})).code).toBe('invalid-roster')
  })

  it('refuses a non-address and a bad current threshold', () => {
    expect(refusal(() => checkTecdsaReshareRoster({current, currentK: 2, next: [a(1), 'nope' as Address], k: 2, n: 2})).message).toMatch(/proposed roster/)
    expect(refusal(() => checkTecdsaReshareRoster({current: ['0x12'], currentK: 2, next: [a(1), a(2)], k: 2, n: 2})).message).toMatch(/current roster/)
    expect(refusal(() => checkTecdsaReshareRoster({current, currentK: 0, next: [a(1), a(2)], k: 2, n: 2})).code).toBe('invalid-roster')
  })
})

describe('checkReshareOnChain', () => {
  const slot = `0x${'04'.repeat(32)}` as Hex, registry = a(0x11)
  const reader = (mode: number, exists = true) => vi.fn(async ({functionName}: {functionName: string}) =>
    functionName === 'getKeySlot' ? {exists, mode, threshold: {k: 3, n: 5}} : current)

  it('checks a tECDSA slot against its on-chain roster and threshold', async () => {
    const read = reader(2)
    await expect(checkReshareOnChain(read as never, registry, slot, [a(1), a(2), a(9)], 2, 3)).rejects.toMatchObject({code: 'keeps-too-few', staying: 2, k: 3})
    expect(await checkReshareOnChain(reader(4) as never, registry, slot, [a(1), a(2), a(3)], 2, 3)).toMatchObject({staying: [a(1), a(2), a(3)]})
  })

  it('skips other modes after one read', async () => {
    const read = reader(0)
    expect(await checkReshareOnChain(read as never, registry, slot, [a(9)], 1, 1)).toBeUndefined()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('refuses a missing slot', async () => {
    await expect(checkReshareOnChain(reader(2, false) as never, registry, slot, [a(1)], 1, 1)).rejects.toMatchObject({code: 'no-slot'})
  })
})
