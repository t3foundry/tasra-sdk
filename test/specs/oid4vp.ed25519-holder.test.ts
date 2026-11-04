// A credential is bound to one holder key, and the KB-JWT has to be signed by that key.
//
// The wallet used to sign every KB-JWT with ES256, so it could only ever present credentials bound to
// a P-256 holder. `tasra-cli vc issue-sd-jwt` binds an Ed25519 holder key, which made the
// network's own issuer and this SDK's wallet unable to meet: a sandbox agent could hold a credential
// the slot's rule admits and still not present it.
import {expect, it} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import {ed25519HolderKey, p256HolderKey, holderSigner, randomHolderKey, b64url} from '../../src/oid4vp/jose.js'
import {didJwkIssuer, issueSdJwtVc, parseSdJwt, presentSdJwt, verifyKbJwt} from '../../src/oid4vp/sd-jwt.js'

const seed = new Uint8Array(32).fill(7)
const issuerKey = new Uint8Array(32).fill(3)

it('derives an Ed25519 holder whose did:jwk carries its public key', () => {
  const holder = ed25519HolderKey(seed)
  expect(holder.publicJwk).toEqual({kty: 'OKP', crv: 'Ed25519', x: b64url(ed25519.getPublicKey(seed))})
  expect(holder.did.startsWith('did:jwk:')).toBe(true)
  expect(holderSigner(holder).alg).toBe('EdDSA')
  expect(holderSigner(randomHolderKey()).alg).toBe('ES256')
})

it('presents a credential bound to an Ed25519 holder, and the KB-JWT verifies', () => {
  const holder = ed25519HolderKey(seed)
  const credential = issueSdJwtVc({
    issuer: didJwkIssuer(issuerKey),
    vct: 'EmployeeOf',
    claims: {dept: 'Engineering'},
    cnf: {jwk: holder.publicJwk},
    sub: holder.did,
  })
  const presentation = presentSdJwt({
    parsed: parseSdJwt(credential),
    disclose: 'all',
    holder,
    nonce: 'n-1',
    aud: 'decentralized_identifier:did:web:example',
  })
  const {holderJwk, claims} = verifyKbJwt(presentation, {nonce: 'n-1', aud: 'decentralized_identifier:did:web:example'})
  expect(holderJwk).toEqual(holder.publicJwk)
  expect(claims.nonce).toBe('n-1')
})

it('a P-256 holder still presents exactly as before', () => {
  const holder = randomHolderKey()
  const credential = issueSdJwtVc({
    issuer: didJwkIssuer(issuerKey),
    vct: 'EmployeeOf',
    claims: {dept: 'Engineering'},
    cnf: {jwk: holder.publicJwk},
    sub: holder.did,
  })
  const presentation = presentSdJwt({parsed: parseSdJwt(credential), disclose: 'all', holder, nonce: 'n-2', aud: 'x'})
  expect(verifyKbJwt(presentation, {nonce: 'n-2', aud: 'x'}).holderJwk).toEqual(holder.publicJwk)
})

// D5 class: a holder key used to keep the caller's bytes by reference, so a caller that built it
// from a Node Buffer (or any view) and then wiped its buffer zeroed the holder's key while the
// did:jwk still named the original. The constructors now take an owned, plain Uint8Array copy.
it.each([
  ['Ed25519', ed25519HolderKey, 'a Node Buffer'], ['P-256', p256HolderKey, 'a Node Buffer'],
  ['Ed25519', ed25519HolderKey, 'a subarray view of a larger Buffer'], ['P-256', p256HolderKey, 'a subarray view of a larger Buffer'],
] as const)('an %s holder keeps presenting after the caller wipes %s', (_alg, make, shape) => {
  const raw = new Uint8Array(32).map((_, i) => 0x40 + i)
  const backing = Buffer.alloc(72, 0x77); backing.set(raw, 20)
  const input = shape === 'a Node Buffer' ? Buffer.from(raw) : backing.subarray(20, 52)
  const holder = make(input), expected = make(raw)
  input.fill(0); backing.fill(0)
  expect(holder.did).toBe(expected.did)
  expect(holder.privateKey).toEqual(raw)
  expect(Object.getPrototypeOf(holder.privateKey)).toBe(Uint8Array.prototype)
  const credential = issueSdJwtVc({issuer: didJwkIssuer(issuerKey), vct: 'EmployeeOf', claims: {dept: 'Engineering'}, cnf: {jwk: holder.publicJwk}, sub: holder.did})
  const presentation = presentSdJwt({parsed: parseSdJwt(credential), disclose: 'all', holder, nonce: 'n-3', aud: 'x'})
  expect(verifyKbJwt(presentation, {nonce: 'n-3', aud: 'x'}).holderJwk).toEqual(holder.publicJwk)
})
