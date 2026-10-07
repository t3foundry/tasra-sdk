// LIVE: Hovi-profile P-256 SD-JWT + holder KB-JWT, authenticated did:web JAR,
// encrypted direct_post.jwt and real paid FROST signing on local chain 43112.
// Requires the independently approved KK_PREPAID_* configuration and separate
// KK_HOVI_STATUS_LIST_URL publication. No unpaid or keeper-skipping fallback.
// KK_HOVI_SCOPED=1 also checks the original identity-scope JAR contract. That
// inspection needs verifier work only; unused keeper funds are reconciled.
import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {p256} from '@noble/curves/p256'
import {bytesToHex, hexToBytes} from '../../src/crypto/hex.js'
import {committeeSign} from '../../src/committee/client.js'
import {verify as verifyFrostSignature} from '../../src/crypto/frost.js'
import {defaultKeyResolver, parseSdJwt, p256DidKeyIssuer, utf8, verifyRequestObject} from '../../src/oid4vp/index.js'
import {loadFleetConfig} from '../fleet/_fleet.ts'
import {createWalletSlot} from '../fleet/_wallet.ts'
import {authorizePaidWallet, paidWalletSettings} from '../fleet/_paid-wallet.ts'
import {assertHoviScopeQuery, issueHoviWallet} from '../fleet/_hovi-wallet.ts'

const cfg = loadFleetConfig()
// Fail before issuance or any on-chain write when the paid provider, gas/TASRA
// ceiling, role draw, original evidence or local-only deployment is absent.
const settings = paidWalletSettings(cfg)
assert(settings.keeperUrls.length >= 3, 'Hovi conformance requires the approved original keeper route map')
cfg.nodeUrls = settings.keeperUrls
assert(process.env.KK_ISSUER_KEY, 'KK_ISSUER_KEY must retain the original Hovi-profile issuer')
const issuerKey = hexToBytes(process.env.KK_ISSUER_KEY)
assert(issuerKey.length === 32 && p256.utils.isValidPrivateKey(issuerKey), 'Invalid original Hovi-profile P-256 issuer key')
const scoped = process.env.KK_HOVI_SCOPED === '1', vct = process.env.KK_VCT ?? 'tsrahealthtest'
const claims = JSON.parse(process.env.KK_CLAIMS ?? '{"organization":"Tasra Health","group":"clinicians"}') as Record<string, unknown>
assert(claims && typeof claims === 'object' && !Array.isArray(claims), 'Hovi claims must be an object')
const t0 = Date.now(), step = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`)

try {
  const issuerDid = p256DidKeyIssuer(issuerKey).did
  const identity = issuerDid + '/labs/patient-42'
  if (scoped) {
    assert(!Object.hasOwn(claims, 'kk_identity_scope'), 'Scope claims must derive from the original issuer')
    claims.kk_identity_scope = [issuerDid + '/labs/*']
  }
  const wallet = issueHoviWallet(cfg, issuerKey, vct, claims)
  step(`issued ${vct} from ${wallet.issuerDid.slice(0, 24)}… to ${wallet.holder.did.slice(0, 24)}… (${parseSdJwt(wallet.sdJwt).disclosures.length} disclosures)`)
  const rule = JSON.stringify({credentials: [{id: scoped ? 'consent' : 'hovi', format: 'dc+sd-jwt', meta: {vct_values: [vct]},
    claims: [{path: ['iss'], values: [issuerDid]}, ...(scoped ? [{path: ['kk_identity_scope']}] : [{path: ['organization'], values: ['Tasra Health']}])],
    ...(scoped ? {kk_identity_scope_claim: ['kk_identity_scope'], kk_scope_namespace: 'issuer'} : {})}]})
  // The SDK retains the actual creation receipts, confidential rule/salt and
  // confirmed finite TASRA deposit. A shell-created slot cannot stand in for it.
  const slot = await createWalletSlot(cfg, scoped ? 'bls' : 'frost', 2, 3, rule)
  step(`created and funded ${scoped ? 'identity-scoped BLS' : 'FROST'} slot ${slot.slotId}`)
  const message = utf8('hello from the SDK wallet')
  let inspected = false
  const grant = await authorizePaidWallet(cfg, slot.slotId, slot.creatorKey,
    scoped ? {action: 'ibe-extract', identity, ttlSecs: 600} : {action: 'sign', message, ttlSecs: 600}, wallet, false, undefined,
    async (request, fetcher) => {
      assert(request.signerDid.startsWith('did:web:'), 'Live JAR must verify through the platform did:web')
      const resolved = await verifyRequestObject(request.jwt, {resolveKey: defaultKeyResolver({fetchImpl: fetcher}), leewaySecs: 0})
      assert(resolved.signerKey.kty === 'OKP' && request.signerKey.kty === 'OKP'
        && resolved.signerKey.crv === request.signerKey.crv && resolved.signerKey.x === request.signerKey.x,
      'Resolved did:web signing key differs from the original anchored member')
      assert.equal(request.claims.response_mode, 'direct_post.jwt', 'Live wallet must use the encrypted presentation profile')
      if (scoped) {
        assertHoviScopeQuery(request.claims.dcql_query)
        const file = process.env.KK_HOVI_QUERY_OUT
        assert(file, 'Scoped conformance must retain the authenticated wallet-facing query')
        writeFileSync(file, JSON.stringify(request.claims.dcql_query) + '\n', {flag: 'wx', mode: 0o600})
      }
      inspected = true
      step(`JAR verified via ${request.signerDid}; response profile=${request.claims.response_mode}`)
    })
  try {
    assert(inspected, 'Original authenticated JAR was never inspected')
    assert.equal(grant.compound_token.binding, 'holder_key', 'Expected holder-key binding')
    assert(grant.compound_token.payment && grant.verifierProofs.length, 'Original paid grant must retain payment and anchored verifier proofs')
    if (!scoped) {
      const sig = await committeeSign({nodeUrl: grant.coordinatorUrl, committeeToken: grant.compound_token, message,
        verifierProofs: grant.verifierProofs, approveExecution: grant.approveExecution})
      assert(verifyFrostSignature(sig.groupPublicKey, message, sig.signature), 'FROST signature does not verify under the original group key')
      assert.equal(bytesToHex(sig.groupPublicKey).replace(/^0x/, '').toLowerCase(), slot.publicKey.replace(/^0x/, '').toLowerCase(),
        'Keeper signed under a different slot key')
      step(`paid FROST signature verifies under original group key ${slot.publicKey.slice(0, 18)}…`)
    } else step('identity-scope extensions and standard claim disclosure verified in the original authenticated JAR')
  } finally {grant.dispose()}
  console.log('verifierAgentWallet live gate: OK')
} finally {issuerKey.fill(0)}
