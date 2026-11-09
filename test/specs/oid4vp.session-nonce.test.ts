// ADR-0090 D7 (amended 2026-11-09): the session-mode presentation nonce binds the fresh session
// key's RFC 7638 thumbprint. Pinned against the reference vectors
// (keykeeper-committee tests/vectors/vp-session-nonce-vectors.json).
import {describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'
import {hexToBytes} from 'viem'
import {derivedNonce, requestHash, vpNonceBound, vpSessionNonce, VP_SESSION_NONCE_DOMAIN} from '../../src/oid4vp/binding.js'
import {parseSessionKeyJwk, sessionKeyThumbprint} from '../../src/committee/session-grant.js'
import {bytesToHex} from '../../src/crypto/hex.js'

interface Case {
  action: 'decrypt'; chain_id: number; committee: number; epoch: string; nonce: string; operation_exp: string; payload_digest: `0x${string}`
  plain_nonce: string; quorum: number; random: `0x${string}`; registry_size: number; request_hash: `0x${string}`; session_key: unknown
  session_key_thumbprint: `0x${string}`; slot_id: `0x${string}`; snapshot_root: `0x${string}`
}
const vectors = JSON.parse(readFileSync(new URL('../vp-session-nonce-vectors.json', import.meta.url), 'utf8')) as {domain: string; cases: Case[]}

const ctx = (c: Case) => ({epoch: BigInt(c.epoch), snapshotRoot: hexToBytes(c.snapshot_root), registrySize: c.registry_size, committee: c.committee,
  quorum: c.quorum, operationExp: BigInt(c.operation_exp)})

describe('vpSessionNonce (reference vectors)', () => {
  it('uses the reference domain and covers both key types', () => {
    expect(vectors.domain).toBe(VP_SESSION_NONCE_DOMAIN)
    expect(new Set(vectors.cases.map(c => (c.session_key as {crv: string}).crv))).toEqual(new Set(['Ed25519', 'P-256']))
  })

  it.each(vectors.cases.map((c, i) => [i, (c.session_key as {crv: string}).crv, c] as const))('case %i (%s): thumbprint, session nonce and plain nonce', (_i, _crv, c) => {
    const rh = requestHash(c.chain_id, hexToBytes(c.slot_id), c.action, hexToBytes(c.payload_digest))
    expect(bytesToHex(rh)).toBe(c.request_hash)
    const thumbprint = sessionKeyThumbprint(parseSessionKeyJwk(c.session_key))
    expect(bytesToHex(thumbprint)).toBe(c.session_key_thumbprint)
    expect(vpSessionNonce(rh, hexToBytes(c.random), ctx(c), thumbprint)).toBe(c.nonce)
    expect(vpNonceBound(rh, hexToBytes(c.random), ctx(c), thumbprint)).toBe(c.nonce)
    // Without a session grant the nonce is unchanged: the released plain derivation.
    expect(vpNonceBound(rh, hexToBytes(c.random), ctx(c))).toBe(c.plain_nonce)
    expect(derivedNonce(rh, hexToBytes(c.random), ctx(c))).toBe(c.plain_nonce)
    expect(c.nonce).not.toBe(c.plain_nonce)
  })

  it('every bound input moves the session nonce, the thumbprint included', () => {
    const c = vectors.cases[0]!, rh = hexToBytes(c.request_hash), random = hexToBytes(c.random), thumb = hexToBytes(c.session_key_thumbprint)
    const base = vpSessionNonce(rh, random, ctx(c), thumb)
    const other = thumb.slice(); other[0]! ^= 1
    expect(vpSessionNonce(rh, random, ctx(c), other)).not.toBe(base)
    expect(vpSessionNonce(rh, random, {...ctx(c), epoch: 42n}, thumb)).not.toBe(base)
    expect(vpSessionNonce(rh, random, {...ctx(c), operationExp: 1800000601n}, thumb)).not.toBe(base)
    expect(() => vpSessionNonce(rh, random, ctx(c), thumb.slice(1))).toThrow(/32 bytes/)
  })
})
