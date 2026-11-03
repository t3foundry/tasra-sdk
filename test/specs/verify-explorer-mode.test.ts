import {describe, expect, it} from 'vitest'
import {explorerMode} from '../verify/_run.ts'

// The platform certification runs the full-stack verifier with no Explorer (KK_VERIFY_EXPLORER=off);
// unset keeps today's attached Explorer, and a typo must refuse rather than silently pick one.
describe('KK_VERIFY_EXPLORER', () => {
  it('defaults to an attached explorer', () => {
    expect(explorerMode(undefined)).toBe('on')
    expect(explorerMode('on')).toBe('on')
  })
  it('detaches only on the exact value off', () => {
    expect(explorerMode('off')).toBe('off')
  })
  it('refuses anything else', () => {
    for (const value of ['', 'OFF', 'false', '0', 'no']) expect(() => explorerMode(value)).toThrow(/KK_VERIFY_EXPLORER/)
  })
})
