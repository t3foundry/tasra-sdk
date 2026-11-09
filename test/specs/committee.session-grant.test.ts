import {describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {ed25519} from '@noble/curves/ed25519'
import {p256} from '@noble/curves/p256'
import {sha256} from '@noble/hashes/sha256'
import {bytesToHex, hexToBytes} from '../../src/crypto/hex.js'
import {selectVerifierCommittee, type VerifierSet} from '../../src/committee/token.js'
import {
  SESSION_BATCH_PROOF_DOMAIN, SESSION_GRANT_DOMAIN, SESSION_PROOF_DOMAIN, SessionGrantError, checkJti, checkProofWindow, decodeSessionGrant, encodeSessionGrant,
  parseSessionKeyJwk, sessionBatchProofHash, sessionControlHash, sessionGrantCanonicalBytes, sessionGrantHash, sessionKeyThumbprint, sessionProofHash,
  verifySessionGrant, verifySessionSignature, type SessionGrantWire, type SessionKeyJwk,
} from '../../src/committee/session-grant.js'

interface VectorCase {
  name: string; grant: SessionGrantWire; grant_canonical_bytes: string; grant_hash: string; session_key_jwk: SessionKeyJwk; session_key_thumbprint: string
  proof_iat: number; proof_jti: string; request_hashes: string[]; single_proof_hash: string; single_proof_signature: string; batch_proof_hash: string; batch_proof_signature: string
}
const vectors = JSON.parse(readFileSync(fileURLToPath(new URL('../session-grant-vectors.json', import.meta.url)), 'utf8')) as {
  cases: VectorCase[]; committee: number; quorum: number; registry_size: number; verifier_pubkeys: string[]; domains: Record<string, string>
}
const set: VerifierSet = {registrySize: vectors.registry_size, pubkeys: new Map(vectors.verifier_pubkeys.map((k, i) => [i, hexToBytes(k)]))}
const RULES: Record<string, string> = {}
for (const c of vectors.cases) for (const s of c.grant.slots) RULES[s.slot_id] = s.rule_hash
const NOW = 1_800_000_010

function verifyAt(c: VectorCase, slot: string, now = NOW, grant = decodeSessionGrant(c.grant)) {
  return verifySessionGrant({grant, set, slotId: hexToBytes(slot), committee: vectors.committee, quorum: vectors.quorum, slotRuleHash: hexToBytes(RULES[slot] ?? '0x' + '00'.repeat(32)), seed: hexToBytes(c.grant.seed), now})
}
function code(fn: () => unknown): string | undefined {
  try { fn() } catch (e) { return e instanceof SessionGrantError ? e.code : `other: ${String(e)}` }
  return undefined
}

describe('session grant format: byte parity with the reference vectors', () => {
  it('pins the domains', () => {
    expect(vectors.domains).toEqual({session_grant: SESSION_GRANT_DOMAIN, session_proof: SESSION_PROOF_DOMAIN, session_batch_proof: SESSION_BATCH_PROOF_DOMAIN})
  })
  for (const c of vectors.cases) {
    describe(c.name, () => {
      it('reproduces the canonical bytes and the grant hash, and round-trips the wire form', () => {
        const grant = decodeSessionGrant(c.grant)
        expect(bytesToHex(sessionGrantCanonicalBytes(grant.payload))).toBe(c.grant_canonical_bytes)
        expect(bytesToHex(sessionGrantHash(grant.payload))).toBe(c.grant_hash)
        expect(encodeSessionGrant(grant)).toEqual(c.grant)
      })
      it('reproduces the RFC 7638 thumbprint the grant binds', () => {
        expect(bytesToHex(sessionKeyThumbprint(c.session_key_jwk))).toBe(c.session_key_thumbprint)
        expect(c.grant.session_key_thumbprint).toBe(c.session_key_thumbprint)
      })
      it('reproduces the single and batch proof hashes and verifies both signatures', () => {
        const gh = hexToBytes(c.grant_hash), rh = c.request_hashes.map(hexToBytes)
        const single = sessionProofHash(gh, rh[0]!, c.proof_iat, c.proof_jti), batch = sessionBatchProofHash(gh, rh, c.proof_iat, c.proof_jti)
        expect(bytesToHex(single)).toBe(c.single_proof_hash)
        expect(bytesToHex(batch)).toBe(c.batch_proof_hash)
        expect(verifySessionSignature(c.session_key_jwk, single, hexToBytes(c.single_proof_signature))).toBe(true)
        expect(verifySessionSignature(c.session_key_jwk, batch, hexToBytes(c.batch_proof_signature))).toBe(true)
        // Domain separation: neither signature passes for the other proof.
        expect(verifySessionSignature(c.session_key_jwk, batch, hexToBytes(c.single_proof_signature))).toBe(false)
        expect(verifySessionSignature(c.session_key_jwk, single, hexToBytes(c.batch_proof_signature))).toBe(false)
        // A one-item batch proof is never the single proof of that item.
        expect(bytesToHex(sessionBatchProofHash(gh, [rh[0]!], c.proof_iat, c.proof_jti))).not.toBe(c.single_proof_hash)
        // The batch proof binds the item order.
        expect(bytesToHex(sessionBatchProofHash(gh, [...rh].reverse(), c.proof_iat, c.proof_jti))).not.toBe(c.batch_proof_hash)
      })
      it('verifies the grant for each granted slot against that slot\'s OWN draw', () => {
        for (const s of c.grant.slots) {
          const v = verifyAt(c, s.slot_id)
          const draw = selectVerifierCommittee(hexToBytes(s.slot_id), BigInt(c.grant.epoch), hexToBytes(c.grant.seed), set.registrySize, vectors.committee)
          expect(v.verifiedSigners.every(i => draw.includes(i))).toBe(true)
          expect(v.verifiedSigners.length).toBeGreaterThanOrEqual(vectors.quorum)
          expect(bytesToHex(v.grantHash)).toBe(c.grant_hash)
        }
      })
    })
  }
})

describe('session grant refusals', () => {
  const c = vectors.cases[0]!
  const slot = c.grant.slots[0]!.slot_id
  it('refuses a slot the grant does not name, and a changed rule', () => {
    expect(code(() => verifyAt(c, '0x' + '03'.repeat(32)))).toBe('slot-not-granted')
    const grant = decodeSessionGrant(c.grant)
    expect(code(() => verifySessionGrant({grant, set, slotId: hexToBytes(slot), committee: 3, quorum: 2, slotRuleHash: new Uint8Array(32), seed: grant.payload.seed, now: NOW}))).toBe('rule-mismatch')
  })
  it('refuses a grant whose seed is not the beacon seed of its epoch, even when its own draw signed it (C8 review F4)', () => {
    const grant = decodeSessionGrant(c.grant)
    const verify = (seed: Uint8Array) => verifySessionGrant({grant, set, slotId: hexToBytes(slot), committee: vectors.committee, quorum: vectors.quorum,
      slotRuleHash: hexToBytes(RULES[slot]!), seed, now: NOW})
    // The grant's own seed draws its signers, so everything else verifies.
    expect(() => verify(hexToBytes(c.grant.seed))).not.toThrow()
    const beacon = hexToBytes(c.grant.seed); beacon[0] = beacon[0]! ^ 1
    expect(code(() => verify(beacon))).toBe('seed-mismatch')
    expect(code(() => verify(new Uint8Array(31)))).toBe('seed-mismatch')
    expect(code(() => verify(undefined as unknown as Uint8Array))).toBe('seed-mismatch')
  })
  it('accepts up to exp + 5 s and refuses after it (the status deadline, never a token leeway)', () => {
    expect(() => verifyAt(c, slot, c.grant.exp + 5)).not.toThrow()
    expect(code(() => verifyAt(c, slot, c.grant.exp + 6))).toBe('expired')
    expect(code(() => verifyAt(c, slot, c.grant.iat - 6))).toBe('not-yet-valid')
  })
  it('refuses a forged signature, an unknown signer and a quorum outside the slot draw', () => {
    const forged = structuredClone(c.grant)
    forged.signatures[0]!.signature = forged.signatures[0]!.signature.slice(0, -2) + (forged.signatures[0]!.signature.endsWith('00') ? '01' : '00')
    expect(code(() => verifyAt(c, slot, NOW, decodeSessionGrant(forged)))).toBe('bad-signature')
    const unknown = structuredClone(c.grant)
    unknown.signatures.push({verifier_index: 99, signature: '0x' + '11'.repeat(64)})
    expect(code(() => verifyAt(c, slot, NOW, decodeSessionGrant(unknown)))).toBe('unknown-verifier')
    const draw = selectVerifierCommittee(hexToBytes(slot), BigInt(c.grant.epoch), hexToBytes(c.grant.seed), set.registrySize, vectors.committee)
    const outsiders = structuredClone(c.grant)
    outsiders.signatures = outsiders.signatures.filter(s => !draw.includes(s.verifier_index))
    expect(code(() => verifyAt(c, slot, NOW, decodeSessionGrant(outsiders)))).toBe('quorum-not-met')
  })
  it('refuses a payload change under the original signatures (the hash covers every field)', () => {
    for (const mutate of [(g: SessionGrantWire) => { g.exp -= 1 }, (g: SessionGrantWire) => { g.idle_timeout_secs -= 1 }, (g: SessionGrantWire) => { g.binding = 'unbound' },
      (g: SessionGrantWire) => { g.session_key_thumbprint = '0x' + '00'.repeat(32) }, (g: SessionGrantWire) => { g.epoch += 1 }]) {
      const g = structuredClone(c.grant); mutate(g)
      expect(['bad-signature', 'quorum-not-met']).toContain(code(() => verifyAt(c, slot, NOW, decodeSessionGrant(g))))
    }
  })
  it('enforces the payload bounds and refuses unknown fields', () => {
    const bad = (mutate: (g: SessionGrantWire & Record<string, unknown>) => void) => { const g = structuredClone(c.grant) as SessionGrantWire & Record<string, unknown>; mutate(g); return code(() => decodeSessionGrant(g)) }
    expect(bad(g => { g.action = 'sign' })).toBe('unsupported-action')
    expect(bad(g => { g.exp = g.iat + 46 })).toBe('lifetime')
    expect(bad(g => { g.exp = g.iat })).toBe('lifetime')
    expect(bad(g => { g.idle_timeout_secs = 1801 })).toBe('idle-timeout')
    expect(bad(g => { g.idle_timeout_secs = 0 })).toBe('idle-timeout')
    expect(bad(g => { g.absolute_exp = g.iat + 12 * 3600 + 1 })).toBe('absolute-exp')
    expect(bad(g => { g.slots = [...g.slots].reverse() })).toBe('slot-order')
    expect(bad(g => { g.slots = Array.from({length: 17}, (_, i) => ({slot_id: '0x' + (i + 1).toString(16).padStart(64, '0'), rule_hash: '0x' + '00'.repeat(32)})) })).toBe('slot-count')
    expect(bad(g => { g.extra = 1 })).toBe('malformed')
    expect(bad(g => { g.seed = '0x12' })).toBe('malformed')
  })
  it('refuses a key that is not the granted one, a private JWK and a stale or malformed proof', () => {
    const v = verifyAt(c, slot)
    const other = vectors.cases[1]!.session_key_jwk
    expect(code(() => checkProofWindow(v, other, {iat: NOW, jti: c.proof_jti}, NOW))).toBe('wrong-key')
    expect(() => checkProofWindow(v, c.session_key_jwk, {iat: NOW, jti: c.proof_jti}, NOW)).not.toThrow()
    expect(code(() => checkProofWindow(v, c.session_key_jwk, {iat: NOW - 31, jti: c.proof_jti}, NOW))).toBe('proof-stale')
    expect(code(() => checkProofWindow(v, c.session_key_jwk, {iat: NOW, jti: 'short'}, NOW))).toBe('bad-jti')
    expect(code(() => checkJti('has spaces in it!!'))).toBe('bad-jti')
    expect(code(() => parseSessionKeyJwk({...c.session_key_jwk, d: 'secret'}))).toBe('bad-key')
    expect(code(() => parseSessionKeyJwk({kty: 'EC', crv: 'P-384', x: 'a', y: 'b'}))).toBe('bad-key')
    expect(code(() => sessionBatchProofHash(hexToBytes(c.grant_hash), [], NOW, c.proof_jti))).toBe('batch-size')
    expect(code(() => sessionBatchProofHash(hexToBytes(c.grant_hash), Array.from({length: 65}, () => new Uint8Array(32)), NOW, c.proof_jti))).toBe('batch-size')
  })
  it('signs and verifies session control hashes, separated by kind', () => {
    const secret = hexToBytes('0x' + '77'.repeat(32))
    const jwk = c.session_key_jwk
    const refresh = sessionControlHash('refresh', hexToBytes(c.grant_hash), 1, NOW), revoke = sessionControlHash('revoke', hexToBytes(c.grant_hash), 1, NOW)
    expect(bytesToHex(refresh)).not.toBe(bytesToHex(revoke))
    expect(bytesToHex(sessionControlHash('refresh', hexToBytes(c.grant_hash), 2, NOW))).not.toBe(bytesToHex(refresh))
    expect(verifySessionSignature(jwk, refresh, ed25519.sign(refresh, secret))).toBe(true)
    expect(verifySessionSignature(jwk, revoke, ed25519.sign(refresh, secret))).toBe(false)
  })
  it('verifies an ES256 (WebCrypto-shaped) proof, high-S included', () => {
    const p = vectors.cases[1]!
    const secret = hexToBytes('0x' + '21'.repeat(32))
    const hash = hexToBytes(p.single_proof_hash)
    const sig = p256.sign(sha256(hash), secret, {prehash: false})
    expect(verifySessionSignature(p.session_key_jwk, hash, sig.toCompactRawBytes())).toBe(true)
    const high = new p256.Signature(sig.r, p256.CURVE.n - sig.s)
    expect(verifySessionSignature(p.session_key_jwk, hash, high.toCompactRawBytes())).toBe(true)
    expect(verifySessionSignature(p.session_key_jwk, sha256(hash), sig.toCompactRawBytes())).toBe(false)
  })
})
