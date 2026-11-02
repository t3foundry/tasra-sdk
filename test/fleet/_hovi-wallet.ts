// Hovi-profile credentials retain P-256 issuer and holder keys while using the
// same issuer-owned durable revocation publication as the other paid fixtures.
import assert from 'node:assert/strict'
import {holderCnf, issueSdJwtVc, p256DidKeyIssuer, randomHolderKey} from '../../src/oid4vp/index.ts'
import type {FleetConfig} from './_fleet.ts'
import {hoviIssuerStatus} from './_issuer-status.ts'

export function issueHoviWallet(cfg: FleetConfig, privateKey: Uint8Array, vct: string,
  claims: Record<string, unknown>) {
  assert(!Object.hasOwn(claims, 'credentialStatus') && !Object.hasOwn(claims, 'status'),
    'Hovi issuer status must come from its original allocation ledger')
  const issuer = p256DidKeyIssuer(privateKey), holder = randomHolderKey()
  const status = hoviIssuerStatus(cfg, holder.did, privateKey)
  const sdJwt = issueSdJwtVc({issuer, vct, claims: {...claims, credentialStatus: status},
    plain: ['credentialStatus'], cnf: holderCnf(holder), sub: holder.did, ttlSecs: 3600})
  return {issuerDid: issuer.did, holder, sdJwt}
}

export function assertHoviScopeQuery(query: unknown) {
  assert(query && typeof query === 'object' && !Array.isArray(query), 'JAR has no credential query')
  const credentials = (query as {credentials?: Array<Record<string, unknown>>}).credentials
  assert(Array.isArray(credentials), 'JAR has no credentials')
  const consent = credentials.filter(c => c.id === 'consent')
  assert.equal(consent.length, 1, 'JAR must carry the unique original consent query')
  assert.deepEqual(consent[0]!.kk_identity_scope_claim, ['kk_identity_scope'], 'JAR lost or changed the identity-scope path')
  assert.equal(consent[0]!.kk_scope_namespace, 'issuer', 'JAR changed the original scope namespace')
  // Ignoring extension members must still disclose the scope through an
  // ordinary DCQL claim. Check every scoped entry, not just the first one.
  for (const entry of credentials.filter(c => Object.hasOwn(c, 'kk_identity_scope_claim'))) {
    assert(Array.isArray(entry.claims) && entry.claims.some((claim: unknown) => {
      if (!claim || typeof claim !== 'object' || Array.isArray(claim)) return false
      return JSON.stringify((claim as {path?: unknown}).path) === JSON.stringify(entry.kk_identity_scope_claim)
    }), 'A wallet ignoring kk_* members would not disclose the original scope')
  }
}
