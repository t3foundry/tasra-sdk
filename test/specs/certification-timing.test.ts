import {describe, it, expect} from 'vitest'
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, renameSync, realpathSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fixturePaymentTtlSeconds} from '../fleet/_certification-timing.ts'

function fixture(run: (raw: Record<string, string>, root: string) => void) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sdk-hourly-clock-')))
  mkdirSync(join(root, 'lab'))
  writeFileSync(join(root, 'lab/.fleet-instance'), 'hourly1\n')
  try { run({CERTIFY_TIMING_PROFILE: 'hourly-v1', KK_FLEET_INSTANCE: 'hourly1', KK_NETWORK_DIR: root}, root) }
  finally { rmSync(root, {recursive: true, force: true}) }
}
describe('certification-only payment lifetimes', () => {
  it('preserves reference and explicitly selected lifetimes', () => {
    expect(fixturePaymentTtlSeconds({chainId: 43112, raw: {KK_PREPAID_EXPIRES_IN_SECS: '60'}})).toBe(600)
    expect(fixturePaymentTtlSeconds({chainId: 43112, raw: {}}, 120)).toBe(120)
  })
  it('compresses only an owned local certification fixture and preserves explicit boundaries', () => fixture(raw => {
    expect(fixturePaymentTtlSeconds({chainId: 43112, raw})).toBe(60)
    expect(fixturePaymentTtlSeconds({chainId: 43112, raw}, 300)).toBe(300)
    expect(fixturePaymentTtlSeconds({chainId: 43112, raw: {...raw, KK_PREPAID_EXPIRES_IN_SECS: '120'}})).toBe(120)
  }))
  it('refuses official/nonlocal chains and missing or substituted instance admission', () => fixture(raw => {
    for (const chainId of [43113, 43114, 1, 1337]) expect(() => fixturePaymentTtlSeconds({chainId, raw})).toThrow()
    const changes: Array<Record<string, string>> = [{KK_FLEET_INSTANCE: ''}, {KK_FLEET_INSTANCE: 'other'}, {KK_NETWORK_DIR: ''}, {CERTIFY_TIMING_PROFILE: 'hourly'}]
    for (const change of changes)
      expect(() => fixturePaymentTtlSeconds({chainId: 43112, raw: {...raw, ...change}})).toThrow()
  }))
  it('refuses malformed or out-of-policy expiry inputs', () => fixture(raw => {
    for (const value of ['0', '59', '241', '600', '1.5', ' 60', '060', 'NaN'])
      expect(() => fixturePaymentTtlSeconds({chainId: 43112, raw: {...raw, KK_PREPAID_EXPIRES_IN_SECS: value}})).toThrow()
    for (const value of [0, -1, 3601, NaN, 1.1]) expect(() => fixturePaymentTtlSeconds({chainId: 43112, raw}, value)).toThrow()
  }))
  it('refuses symlinked and oversized claim files', () => fixture((raw, root) => {
    const claim = join(root, 'lab/.fleet-instance'), original = join(root, 'lab/original')
    renameSync(claim, original); symlinkSync(original, claim)
    expect(() => fixturePaymentTtlSeconds({chainId: 43112, raw})).toThrow()
    rmSync(claim); writeFileSync(claim, 'hourly1\n' + ' '.repeat(128))
    expect(() => fixturePaymentTtlSeconds({chainId: 43112, raw})).toThrow()
  }))
})
