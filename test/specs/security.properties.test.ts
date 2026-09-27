import {describe, expect, it} from 'vitest'
import fc from 'fast-check'
import {scopeCovers} from '../../src/auth/identityScope.js'
import {requestHash} from '../../src/oid4vp/binding.js'
import {p256HolderKey, p256PublicJwk, verifyCompactJws} from '../../src/oid4vp/jose.js'
import {holderCnf, issueSdJwtVc, parseSdJwt, presentSdJwt, didJwkIssuer, verifyKbJwt} from '../../src/oid4vp/sd-jwt.js'

// Keep the default corpus reproducible. fast-check prints seed/path and shrinks every
// failure; replay a single failing test with FC_SEED / FC_PATH and Vitest -t.
const seed = Number(process.env.FC_SEED ?? 20260927)
if (!Number.isSafeInteger(seed)) throw new Error('FC_SEED must be an integer')
const parameters = {seed, numRuns: 80, ...(process.env.FC_PATH ? {path: process.env.FC_PATH} : {})}
const segment = fc.array(fc.constantFrom('a', 'b', '1', 'é', '界', '🙂'), {minLength: 1, maxLength: 12}).map(s => s.join(''))
const path = fc.array(segment, {minLength: 1, maxLength: 6}).map(s => s.join('/'))
const bytes32 = fc.uint8Array({minLength: 32, maxLength: 32})
const changed = (input: Uint8Array) => {
  const result = input.slice()
  result[0] = result[0]! ^ 1
  return result
}
const hex = (input: Uint8Array) => Buffer.from(input).toString('hex')

describe('identity scope security properties', () => {
  it('grants exact descendants and rejects longer sibling names', () => {
    fc.assert(fc.property(path, segment, (parent, child) => {
      expect(scopeCovers(`${parent}/*`, parent)).toBe(true)
      expect(scopeCovers(`${parent}/*`, `${parent}/${child}`)).toBe(true)
      expect(scopeCovers(`${parent}/*`, `${parent}${child}`)).toBe(false)
      expect(scopeCovers(parent, `${parent}/${child}`)).toBe(false)
      expect(scopeCovers(parent, parent)).toBe(true)
      expect(scopeCovers(parent, `${parent}x`)).toBe(false)
      expect(scopeCovers(parent, `x${parent}`)).toBe(false)
    }), parameters)
  })

  it('agrees with an independent segment-list model on distinct branches', () => {
    fc.assert(fc.property(path, path, (grant, identity) => {
      const wanted = grant.split('/')
      const actual = identity.split('/')
      const covered = wanted.every((part, i) => actual[i] === part)
      expect(scopeCovers(`${grant}/*`, identity)).toBe(covered)
      expect(scopeCovers(grant, identity)).toBe(grant === identity)
    }), parameters)
  })

  it('fails closed on NUL and byte limits even for explicit-open grants', () => {
    fc.assert(fc.property(path, fc.integer({min: 0, max: 1024}), (identity, position) => {
      const nul = `${identity.slice(0, position)}\0${identity.slice(position)}`
      expect(scopeCovers('*', nul)).toBe(false)
      expect(scopeCovers(nul, nul)).toBe(false)
      expect(scopeCovers(nul, identity)).toBe(false)
      expect(scopeCovers(identity, nul)).toBe(false)
      expect(scopeCovers('*', identity)).toBe(true)
    }), parameters)
    // Literal wire limit, deliberately not imported from the implementation.
    for (const valid of ['a'.repeat(1024), 'é'.repeat(512), '🙂'.repeat(256)]) {
      expect(scopeCovers(valid, valid)).toBe(true)
      expect(scopeCovers('*', valid)).toBe(true)
      expect(scopeCovers('*', `${valid}a`)).toBe(false)
      expect(scopeCovers(`${valid}a`, '')).toBe(false)
      expect(scopeCovers(`${valid}a`, `${valid}a`)).toBe(false)
    }
    // The grant itself can exceed the cap while its requested parent is valid.
    // This kills deletion of only the grant-length guard (not the identity guard).
    expect(scopeCovers(`${'a'.repeat(1023)}/*`, 'a'.repeat(1023))).toBe(false)
    expect(scopeCovers(`${'a'.repeat(1022)}/*`, 'a'.repeat(1022))).toBe(true)
  })

  it('keeps wildcard syntax explicit, case-sensitive and segment-delimited', () => {
    expect(scopeCovers('', '')).toBe(true)
    expect(scopeCovers('', 'a')).toBe(false)
    expect(scopeCovers('ab', 'ac')).toBe(false)
    expect(scopeCovers('ab/*', 'ac/x')).toBe(false)
    expect(scopeCovers('a/*', 'a/')).toBe(true)
    expect(scopeCovers('a/*', 'a')).toBe(true)
    expect(scopeCovers('a/*', 'A/b')).toBe(false)
    expect(scopeCovers('a*b', 'axxb')).toBe(false)
    expect(scopeCovers('a/*/b', 'a/x/b')).toBe(false)
    expect(scopeCovers('*', '')).toBe(true)
    expect(scopeCovers('/*', '/a')).toBe(true)
    expect(scopeCovers('/*', 'a')).toBe(false)
  })
})

describe('credential and operation binding security properties', () => {
  // Public deterministic TEST keys, never used for deployment or production data.
  const key = (n: number) => new Uint8Array(32).fill(n)
  const issuer = didJwkIssuer(key(1))
  const issuerPublicKey = p256PublicJwk(key(1))
  const holder = p256HolderKey(key(2))
  const attacker = p256HolderKey(key(3))

  it('rejects changed audience, nonce, holder, issuer signature and disclosed payload', () => {
    fc.assert(fc.property(segment, segment, fc.integer(), (nonce, audience, amount) => {
      const compact = issueSdJwtVc({issuer, vct: 'urn:tasra:test:approval', claims: {amount},
        cnf: holderCnf(holder), nowSecs: 1_700_000_000, random: () => new Uint8Array(16).fill(4)})
      const parsed = parseSdJwt(compact)
      // Issuer trust is pinned independently. verifyKbJwt checks ONLY holder binding;
      // decoding a credential or trusting its own embedded key is not issuer verification.
      expect(verifyCompactJws(parsed.issuerJwt, issuerPublicKey).payload).toMatchObject({iss: issuer.did})
      const expected = {nonce, aud: audience}
      const presentation = presentSdJwt({parsed, disclose: 'all', holder, ...expected, nowSecs: 1_700_000_001})
      expect(verifyKbJwt(presentation, expected).claims.nonce).toBe(nonce)
      expect(() => verifyKbJwt(presentation, {...expected, nonce: `${nonce}!`})).toThrow(/nonce/)
      expect(() => verifyKbJwt(presentation, {...expected, aud: `${audience}!`})).toThrow(/aud/)
      const stolen = presentSdJwt({parsed, disclose: 'all', holder: attacker, ...expected})
      expect(() => verifyKbJwt(stolen, expected)).toThrow()
      const forged = issueSdJwtVc({issuer: {...issuer, signer: {alg: 'ES256', privateKey: key(3)}},
        vct: 'urn:tasra:test:approval', claims: {amount}, cnf: holderCnf(holder), nowSecs: 1_700_000_000})
      expect(() => verifyCompactJws(parseSdJwt(forged).issuerJwt, issuerPublicKey)).toThrow()
      const parts = presentation.split('~')
      const disclosure = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()) as unknown[]
      disclosure[2] = amount + 1
      parts[1] = Buffer.from(JSON.stringify(disclosure)).toString('base64url')
      expect(() => verifyKbJwt(parts.join('~'), expected)).toThrow(/disclosure/)
      // Removing a legitimately signed disclosure also changes the exact KB-JWT binding.
      const removed = presentation.split('~')
      removed.splice(1, 1)
      expect(() => verifyKbJwt(removed.join('~'), expected)).toThrow(/sd_hash/)
    }), {...parameters, numRuns: 24})
  })

  it('binds operation hashes to chain, slot, action and payload independently', () => {
    fc.assert(fc.property(fc.integer({min: 1, max: 1_000_000}), bytes32, bytes32, (chainId, slot, payload) => {
      const original = hex(requestHash(chainId, slot, 'sign', payload))
      expect(hex(requestHash(chainId + 1, slot, 'sign', payload))).not.toBe(original)
      expect(hex(requestHash(chainId, changed(slot), 'sign', payload))).not.toBe(original)
      expect(hex(requestHash(chainId, slot, 'decrypt', payload))).not.toBe(original)
      expect(hex(requestHash(chainId, slot, 'sign', changed(payload)))).not.toBe(original)
      expect(hex(requestHash(chainId, slot, 'sign', payload))).toBe(original)
    }), parameters)
  })

  it('does not confuse a signed key-binding proof with server-side replay protection', () => {
    const parsed = parseSdJwt(issueSdJwtVc({issuer, vct: 'urn:tasra:test:approval', claims: {}, cnf: holderCnf(holder)}))
    const expected = {nonce: 'single-use-on-the-server', aud: 'verifier'}
    const proof = presentSdJwt({parsed, holder, disclose: 'all', ...expected})
    // Both calls succeed: consuming a nonce is a stateful verifier responsibility.
    expect(verifyKbJwt(proof, expected).claims).toEqual(verifyKbJwt(proof, expected).claims)
  })
})
