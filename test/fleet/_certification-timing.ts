// Test-fixture policy only. No exported SDK/client default is changed here.
import assert from 'node:assert/strict'
import {constants, openSync, fstatSync, readFileSync, closeSync, realpathSync} from 'node:fs'
import {join} from 'node:path'

export function fixturePaymentTtlSeconds(cfg: {chainId: number; raw: Record<string, string>}, explicit?: number): number {
  const profile = cfg.raw.CERTIFY_TIMING_PROFILE ?? 'reference'
  assert(profile === 'reference' || profile === 'hourly-v1', 'Unknown certification timing profile')
  let fallback = 600
  if (profile === 'hourly-v1') {
    assert.equal(cfg.chainId, 43112, 'Compressed fixture time requires local chain 43112')
    const instance = cfg.raw.KK_FLEET_INSTANCE
    assert(instance && /^[a-z0-9]{1,12}$/.test(instance), 'Compressed fixture time requires an isolated instance')
    assert(cfg.raw.KK_NETWORK_DIR, 'Compressed fixture time requires the admitted network checkout')
    const root = realpathSync(cfg.raw.KK_NETWORK_DIR), claim = join(root, 'lab/.fleet-instance')
    assert.equal(realpathSync(claim), claim, 'Compressed fixture claim cannot traverse a symlink')
    const fd = openSync(claim, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const stat = fstatSync(fd)
      assert(stat.isFile() && stat.size > 0 && stat.size <= 64, 'Compressed fixture claim must be bounded')
      assert.equal(readFileSync(fd, 'utf8').trim(), instance, 'Compressed fixture checkout belongs to another instance')
    } finally { closeSync(fd) }
    const raw = cfg.raw.KK_PREPAID_EXPIRES_IN_SECS ?? '60'
    assert(/^[1-9][0-9]{1,2}$/.test(raw), 'Compressed fixture lifetime must be an integer')
    fallback = Number(raw)
    assert(fallback >= 60 && fallback <= 240, 'Compressed fixture lifetime must be 60..240 seconds')
  }
  // Explicit lifetimes belong to the original test's boundary conditions and
  // are never shortened after selection or after any request has been signed.
  const ttl = explicit ?? fallback
  assert(Number.isSafeInteger(ttl) && ttl > 0 && ttl <= 3600, 'Original payment expiry must be bounded')
  return ttl
}
