import {describe, expect, it} from 'vitest'
import {explorerMode} from '../verify/_run.ts'

// The platform certification runs the full-stack verifier with no Explorer (KK_VERIFY_EXPLORER=off);
// unset keeps today's attached Explorer, and a typo must refuse rather than silently pick one.
// Explicit env objects: the suite itself may run under KK_VERIFY_EXPLORER=off (the platform cert).
describe('KK_VERIFY_EXPLORER', () => {
  it('defaults to an attached explorer', () => {
    expect(explorerMode({})).toBe('on')
    expect(explorerMode({KK_VERIFY_EXPLORER: 'on'})).toBe('on')
  })
  it('detaches only on the exact value off', () => {
    expect(explorerMode({KK_VERIFY_EXPLORER: 'off'})).toBe('off')
  })
  it('refuses anything else', () => {
    for (const value of ['', 'OFF', 'false', '0', 'no']) expect(() => explorerMode({KK_VERIFY_EXPLORER: value})).toThrow(/KK_VERIFY_EXPLORER/)
  })
})
