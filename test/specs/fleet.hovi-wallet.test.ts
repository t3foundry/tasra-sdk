import {expect, it} from 'vitest'
import {mkdtempSync, readFileSync, writeFileSync, existsSync, statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {gunzipSync} from 'node:zlib'
import {p256} from '@noble/curves/p256'
import {parseSdJwt, p256DidKeyIssuer} from '../../src/oid4vp/sd-jwt.ts'
import {jwkFromDid, verifyCompactJws} from '../../src/oid4vp/jose.ts'
import type {FleetConfig} from '../fleet/_fleet.ts'
import {hoviIssuerStatus} from '../fleet/_issuer-status.ts'
import {assertHoviScopeQuery, issueHoviWallet} from '../fleet/_hovi-wallet.ts'
import {waitForPaidSnapshot} from '../fleet/_paid-wallet-session.ts'

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'sdk-hovi-status-control-')), key = new Uint8Array(32).fill(19)
  const cfg: FleetConfig = {chainId: 43112, rpcUrl: 'http://127.0.0.1:43112', book: {},
    raw: {KK_PREPAID_EVIDENCE_DIR: directory, KK_STATUS_LIST_DIR: directory,
      KK_HOVI_STATUS_LIST_URL: 'https://localhost:19444/cert-status/hovi-profile.jwt'},
    issuerKey: '', issuerDid: '', nodeUrls: [], verifierUrls: [], explorerApi: '', slotId: '0x',
    governanceSlotId: '0x', ruleSalt: '', governanceRule: '', governanceRuleSalt: '', adminSecret: '',
    deployPk: '', deployAddr: '', faucetUrl: '', jwtSigningKey: '', jwtIss: '', jwtAud: '',
    adminJwtSigningKey: '', adminJwtIss: '', adminJwtAud: ''}
  const list = () => {
    const jwt = readFileSync(join(directory, 'hovi-profile.jwt'), 'utf8').trim()
    const {header, payload} = verifyCompactJws<{iss: string; vc: {issuer: string; credentialSubject: {encodedList: string}}}>(jwt, jwkFromDid(p256DidKeyIssuer(key).did))
    expect(header.alg).toBe('ES256'); expect(payload.iss).toBe(p256DidKeyIssuer(key).did)
    expect(payload.vc.issuer).toBe(payload.iss)
    return gunzipSync(Buffer.from(payload.vc.credentialSubject.encodedList, 'base64url'))
  }
  return {directory, key, cfg, list}
}
it('uses the original P-256 issuer for both credential and genuine signed revocation list', () => {
  const f = fixture(), original = new Uint8Array(f.key), wallet = issueHoviWallet(f.cfg, f.key, 'tsrahealthtest', {organization: 'Tasra Health'})
  const parsed = parseSdJwt(wallet.sdJwt), issuer = p256DidKeyIssuer(f.key)
  expect(verifyCompactJws(parsed.issuerJwt, jwkFromDid(issuer.did)).header.alg).toBe('ES256')
  expect(parsed.payload.iss).toBe(issuer.did); expect(wallet.holder.publicJwk).toMatchObject({kty: 'EC', crv: 'P-256'})
  expect(parsed.payload.credentialStatus).toMatchObject({type: 'StatusList2021Entry', statusListIndex: '0',
    statusListCredential: f.cfg.raw.KK_HOVI_STATUS_LIST_URL})
  expect(parsed.disclosures.some(d => d.name === 'credentialStatus')).toBe(false)
  expect(f.list()).toEqual(Buffer.alloc(16384)); expect(f.key).toEqual(original)
  expect(statSync(join(f.directory, 'hovi-profile.jwt')).mode & 0o777).toBe(0o644)
  expect(statSync(join(f.directory, '.hovi-profile.indices.json')).mode & 0o777).toBe(0o600)
})
it('never modifies the original employee publication or allocation ledger', () => {
  const f = fixture(), employee = 'original employee signed bytes', ledger = 'original employee allocation bytes'
  writeFileSync(join(f.directory, 'employee.jwt'), employee)
  writeFileSync(join(f.directory, '.indices.json'), ledger, {mode: 0o600})
  hoviIssuerStatus(f.cfg, 'holder-a', f.key)
  expect(readFileSync(join(f.directory, 'employee.jwt'), 'utf8')).toBe(employee)
  expect(readFileSync(join(f.directory, '.indices.json'), 'utf8')).toBe(ledger)
})
it('retains revoked indices and original allocations when a Hovi holder is reissued', () => {
  const f = fixture(), a = hoviIssuerStatus(f.cfg, 'holder-a', f.key)
  hoviIssuerStatus(f.cfg, 'holder-a', f.key, true)
  expect(hoviIssuerStatus(f.cfg, 'holder-a', f.key)).toEqual(a)
  expect(hoviIssuerStatus(f.cfg, 'holder-b', f.key).statusListIndex).toBe('1')
  expect(f.list()[0]).toBe(0x80)
})
it('refuses replacing the P-256 issuer and leaves its original list and ledger intact', () => {
  const f = fixture(); hoviIssuerStatus(f.cfg, 'holder-a', f.key)
  const original = ['hovi-profile.jwt', '.hovi-profile.indices.json'].map(name => readFileSync(join(f.directory, name), 'utf8'))
  expect(() => hoviIssuerStatus(f.cfg, 'holder-b', p256.utils.randomPrivateKey())).toThrow(/original issuer/)
  expect(['hovi-profile.jwt', '.hovi-profile.indices.json'].map(name => readFileSync(join(f.directory, name), 'utf8'))).toEqual(original)
  expect(existsSync(join(f.directory, '.hovi-profile.issuer-lock'))).toBe(true)
})
it('refuses resetting a Hovi publication whose original ledger is missing', () => {
  const f = fixture(); writeFileSync(join(f.directory, 'hovi-profile.jwt'), 'original list')
  expect(() => hoviIssuerStatus(f.cfg, 'holder-a', f.key)).toThrow(/reset/)
  expect(readFileSync(join(f.directory, 'hovi-profile.jwt'), 'utf8')).toBe('original list')
  expect(existsSync(join(f.directory, '.hovi-profile.indices.json'))).toBe(false)
})
it('refuses injected or missing issuer status and official chains before allocating a credential', () => {
  const f = fixture()
  for (const field of ['status', 'credentialStatus']) expect(() => issueHoviWallet(f.cfg, f.key, 'vct', {[field]: {}})).toThrow(/original allocation ledger/)
  f.cfg.chainId = 43113
  expect(() => hoviIssuerStatus(f.cfg, 'holder-a', f.key)).toThrow(/local chain 43112/)
  f.cfg.chainId = 43112; delete f.cfg.raw.KK_HOVI_STATUS_LIST_URL
  expect(() => hoviIssuerStatus(f.cfg, 'holder-a', f.key)).toThrow(/explicit issuer/)
  expect(existsSync(join(f.directory, '.hovi-profile.indices.json'))).toBe(false)
})
const query = () => ({credentials: [{id: 'consent', claims: [{path: ['iss']}, {path: ['kk_identity_scope']}],
  kk_identity_scope_claim: ['kk_identity_scope'], kk_scope_namespace: 'issuer'}]})
it('requires original scope extensions and ordinary disclosure even when kk_* members are ignored', () => {
  expect(() => assertHoviScopeQuery(query())).not.toThrow()
  const bad = query(); bad.credentials[0]!.claims.pop()
  expect(() => assertHoviScopeQuery(bad)).toThrow(/would not disclose/)
})
it('refuses stripped, changed and duplicate original consent query entries', () => {
  const stripped = query(); delete (stripped.credentials[0] as Record<string, unknown>).kk_identity_scope_claim
  expect(() => assertHoviScopeQuery(stripped)).toThrow(/identity-scope path/)
  const changed = query(); changed.credentials[0]!.kk_scope_namespace = 'holder'
  expect(() => assertHoviScopeQuery(changed)).toThrow(/scope namespace/)
  const duplicate = query(); duplicate.credentials.push(structuredClone(duplicate.credentials[0]!))
  expect(() => assertHoviScopeQuery(duplicate)).toThrow(/unique original/)
})
it('checks every identity-scoped query entry for ordinary claim disclosure', () => {
  const bad = query(); bad.credentials.push({...structuredClone(bad.credentials[0]!), id: 'second', claims: [{path: ['iss']}]})
  expect(() => assertHoviScopeQuery(bad)).toThrow(/would not disclose/)
})
it('waits for explicit absent anchors through read-only discovery without repeating paid delivery', async () => {
  let reads = 0, waits = 0
  expect(await waitForPaidSnapshot(async () => {
    reads++
    if (reads <= 2) throw Error(reads === 1 ? 'no anchored verifier and accountant snapshots' : 'no current or previous anchored verifier and accountant snapshots')
    return 'original context'
  }, new AbortController().signal, async () => {waits++})).toBe('original context')
  expect(reads).toBe(3); expect(waits).toBe(2)
})
it('does not retry malformed policies, insufficient funds, unknown transports or refusals', async () => {
  for (const message of ['slot underfunded', 'payment discovery beacon pointers differ', '503 transport failure', 'Original paid credential verification refused']) {
    let reads = 0, waits = 0
    await expect(waitForPaidSnapshot(async () => {reads++; throw Error(message)}, new AbortController().signal,
      async () => {waits++})).rejects.toThrow(message)
    expect(reads).toBe(1); expect(waits).toBe(0)
  }
})
it('stops an expired snapshot readiness wait before another discovery or paid write', async () => {
  const controller = new AbortController(); let reads = 0
  await expect(waitForPaidSnapshot(async () => {reads++; throw Error('no anchored verifier and accountant snapshots')}, controller.signal,
    async () => {controller.abort(Error('bounded snapshot wait expired'))})).rejects.toThrow(/bounded snapshot/)
  expect(reads).toBe(1)
})
