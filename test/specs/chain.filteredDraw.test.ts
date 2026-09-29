import {describe, expect, it} from 'vitest'
import {filteredDrawCannotSeat} from '../../src/chain/write.js'

// The TAGGED half of the pre-send draw guard. Its sibling `untaggedDrawSeatsNonKeepers` catches
// "no tags on a mixed fleet"; this catches "more of a tag than the fleet carries" — the same
// unrecoverable mistake (the slot is paid for; under commit-reveal the shortfall surfaces only at
// the reveal, a beacon epoch later), and it went unguarded for longer precisely because tagging is
// the DEFAULT and so the rarer path was the one that had a check.
describe('filtered committee draw', () => {
  it('refuses the shortfall observed on the local fleet', () => {
    // 2026-09-29: five keeper containers all answering /readyz, one of them unbonding, so
    // taggedActiveCount was 4. A caller that sized n from the reachable endpoints asked for 5
    // and `revealKeySlot` reverted InsufficientFilteredPool(4, 5) — after the commit was paid.
    expect(filteredDrawCannotSeat(4n, 5)).toBe(true)
  })

  it('allows a pool that exactly fits', () => {
    // n == candidates is seatable: the draw must take every candidate, which the contract permits.
    // Refusing here would break every fleet sized deliberately to its keeper count.
    expect(filteredDrawCannotSeat(5n, 5)).toBe(false)
  })

  it('allows a pool with room to spare', () => {
    expect(filteredDrawCannotSeat(9n, 3)).toBe(false)
  })

  it('refuses when nothing carries the tag', () => {
    // Zero candidates cannot seat even a 1-of-1, and the message naming the tag is the whole
    // value of catching it here: on-chain this is the same opaque revert as a near-miss.
    expect(filteredDrawCannotSeat(0n, 1)).toBe(true)
  })

  it('does not blame the operator set for a malformed threshold', () => {
    // n = 0 and a fractional n are `InvalidThreshold`, which the contract reports precisely.
    // Claiming a pool shortfall would send the caller to audit operators over an argument bug —
    // and BigInt(2.5) throws, so a bare comparison would surface as a RangeError with no subject.
    expect(filteredDrawCannotSeat(0n, 0)).toBe(false)
    expect(filteredDrawCannotSeat(4n, 2.5)).toBe(false)
    expect(filteredDrawCannotSeat(4n, Number.NaN)).toBe(false)
    expect(filteredDrawCannotSeat(4n, -1)).toBe(false)
  })
})
