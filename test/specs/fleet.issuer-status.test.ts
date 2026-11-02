import {expect, it} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import {gunzipSync} from 'node:zlib'
import {mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {issuerStatus} from '../fleet/_issuer-status.ts'
import type {FleetConfig} from '../fleet/_fleet.ts'
import {issueWallet} from '../fleet/_wallet.ts'
import {parseSdJwt} from '../../src/oid4vp/sd-jwt.ts'

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'sdk-issuer-status-control-')), key = Buffer.alloc(32, 13)
  const cfg: FleetConfig = {chainId: 43112, rpcUrl: 'http://127.0.0.1:43112', book: {},
    raw: {KK_PREPAID_EVIDENCE_DIR: directory, KK_STATUS_LIST_DIR: directory, KK_STATUS_LIST_URL: 'https://localhost:19444/status/hr/employee.jwt'},
    issuerKey: key.toString('base64url'), issuerDid: 'did:web:hr.acmecorp.example', nodeUrls: [], verifierUrls: [], explorerApi: '',
    slotId: '0x', governanceSlotId: '0x', ruleSalt: '', governanceRule: '', governanceRuleSalt: '', adminSecret: '', deployPk: '',
    deployAddr: '', faucetUrl: '', jwtSigningKey: '', jwtIss: '', jwtAud: '', adminJwtSigningKey: '', adminJwtIss: '', adminJwtAud: ''}
  const list = () => {
    const jwt = readFileSync(join(directory, 'employee.jwt'), 'utf8').trim(), parts = jwt.split('.')
    expect(ed25519.verify(Buffer.from(parts[2]!, 'base64url'), new TextEncoder().encode(parts[0] + '.' + parts[1]), ed25519.getPublicKey(key))).toBe(true)
    const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()) as {iss: string; sub: string; exp: number; iat: number;
      vc: {credentialSubject: {encodedList: string}}}
    expect(claims.iss).toBe(cfg.issuerDid); expect(claims.sub).toBe(cfg.raw.KK_STATUS_LIST_URL)
    expect(claims.exp - claims.iat).toBe(86400)
    return gunzipSync(Buffer.from(claims.vc.credentialSubject.encodedList, 'base64url'))
  }
  return {cfg, directory, list}
}
it('publishes a readable signed list under a restrictive host mask while keeping its ledger private', () => {
  const f = fixture(), previous = process.umask(0o077)
  try {
    issuerStatus(f.cfg, 'holder-a')
    expect(statSync(join(f.directory, 'employee.jwt')).mode & 0o777).toBe(0o644)
    expect(statSync(join(f.directory, '.indices.json')).mode & 0o777).toBe(0o600)
    expect(f.list()).toEqual(Buffer.alloc(16384))
  } finally {process.umask(previous)}
})
it('publishes a genuine issuer-signed full-capacity status list and retains unique holder indices', () => {
  const f = fixture(), a = issuerStatus(f.cfg, 'holder-a'), b = issuerStatus(f.cfg, 'holder-b')
  expect(a.statusListIndex).toBe('0'); expect(b.statusListIndex).toBe('1')
  expect(issuerStatus(f.cfg, 'holder-a')).toEqual(a)
  expect(f.list()).toEqual(Buffer.alloc(16384))
  expect(JSON.parse(readFileSync(join(f.directory, '.indices.json'), 'utf8'))).toEqual({url: f.cfg.raw.KK_STATUS_LIST_URL,
    next_index: 2, members: {'holder-a': 0, 'holder-b': 1}, revoked: []})
  expect(existsSync(join(f.directory, '.issuer-lock'))).toBe(false)
})
it('keeps all revocations when another holder is issued or the same holder is retried', () => {
  const f = fixture()
  issuerStatus(f.cfg, 'holder-a'); issuerStatus(f.cfg, 'holder-b')
  issuerStatus(f.cfg, 'holder-a', true); issuerStatus(f.cfg, 'holder-b', true)
  issuerStatus(f.cfg, 'holder-a'); issuerStatus(f.cfg, 'holder-c')
  const bits = f.list()
  expect(bits[0]).toBe(0xc0); expect(bits.subarray(1)).toEqual(Buffer.alloc(16383))
})
it('preserves an existing shell-compatible ledger and all its revoked indices', () => {
  const f = fixture()
  writeFileSync(join(f.directory, '.indices.json'), JSON.stringify({url: f.cfg.raw.KK_STATUS_LIST_URL,
    next_index: 51, members: {'previous-cli-holder': 50}, revoked: [17, 50]}), {mode: 0o600})
  expect(issuerStatus(f.cfg, 'sdk-holder').statusListIndex).toBe('51')
  const bits = f.list()
  expect(bits[2]).toBe(0x40); expect(bits[6]).toBe(0x20)
})
it('refuses resetting a published list when its original allocation ledger is absent', () => {
  const f = fixture(), original = 'original published status bytes'
  writeFileSync(join(f.directory, 'employee.jwt'), original)
  expect(() => issuerStatus(f.cfg, 'holder-a')).toThrow(/reset/)
  expect(readFileSync(join(f.directory, 'employee.jwt'), 'utf8')).toBe(original)
  expect(existsSync(join(f.directory, '.indices.json'))).toBe(false)
})
it('refuses concurrent or interrupted issuer state without deleting its lock', () => {
  const f = fixture()
  mkdirSync(join(f.directory, '.issuer-lock'))
  expect(() => issuerStatus(f.cfg, 'holder-a')).toThrow()
  expect(existsSync(join(f.directory, '.issuer-lock'))).toBe(true)
  expect(existsSync(join(f.directory, '.indices.json'))).toBe(false)
})
it('refuses URL changes without forgetting the original revoked set', () => {
  const f = fixture()
  issuerStatus(f.cfg, 'holder-a'); issuerStatus(f.cfg, 'holder-a', true)
  const originalLedger = readFileSync(join(f.directory, '.indices.json'), 'utf8'), originalList = readFileSync(join(f.directory, 'employee.jwt'), 'utf8')
  f.cfg.raw.KK_STATUS_LIST_URL = 'https://localhost:19445/status/hr/employee.jwt'
  expect(() => issuerStatus(f.cfg, 'holder-b')).toThrow(/original list URL/)
  expect(readFileSync(join(f.directory, '.indices.json'), 'utf8')).toBe(originalLedger)
  expect(readFileSync(join(f.directory, 'employee.jwt'), 'utf8')).toBe(originalList)
})
it('refuses duplicate allocation indices and never republished an invalid ledger', () => {
  const f = fixture()
  writeFileSync(join(f.directory, '.indices.json'), JSON.stringify({url: f.cfg.raw.KK_STATUS_LIST_URL,
    next_index: 1, members: {'holder-a': 0, 'holder-b': 0}, revoked: [0]}), {mode: 0o600})
  expect(() => issuerStatus(f.cfg, 'holder-c')).toThrow(/ambiguous/)
  expect(existsSync(join(f.directory, 'employee.jwt'))).toBe(false)
})
it('refuses official chains and malformed list URLs before allocation or publication', () => {
  const f = fixture()
  f.cfg.chainId = 43113
  expect(() => issuerStatus(f.cfg, 'holder-a')).toThrow(/local chain 43112/)
  f.cfg.chainId = 43112
  for (const url of ['http://localhost/status/employee.jwt', 'https://user:secret@localhost/status/employee.jwt',
    'https://localhost/status/employee.jwt?secret=1', 'https://localhost/status/employee.jwt#1']) {
    f.cfg.raw.KK_STATUS_LIST_URL = url
    expect(() => issuerStatus(f.cfg, 'holder-a')).toThrow(/exact approved HTTPS/)
  }
  expect(existsSync(join(f.directory, '.indices.json'))).toBe(false)
})
it('includes a genuine allocated status entry in the actual wallet credential issuer payload', () => {
  const f = fixture(), wallet = issueWallet(f.cfg), parsed = parseSdJwt(wallet.sdJwt)
  expect(parsed.payload.credentialStatus).toMatchObject({type: 'StatusList2021Entry', statusListIndex: '0', statusListCredential: f.cfg.raw.KK_STATUS_LIST_URL})
  expect(parsed.disclosures.some(d => d.name === 'credentialStatus')).toBe(false)
  const parts = parsed.issuerJwt.split('.')
  expect(ed25519.verify(Buffer.from(parts[2]!, 'base64url'), new TextEncoder().encode(parts[0] + '.' + parts[1]),
    ed25519.getPublicKey(Buffer.from(f.cfg.issuerKey, 'base64url')))).toBe(true)
  expect(f.list()).toEqual(Buffer.alloc(16384))
})
it('refuses caller-supplied status claims before allocating another credential', () => {
  const f = fixture()
  expect(() => issueWallet(f.cfg, {claims: {credentialStatus: {attacker: true}}})).toThrow(/original allocation ledger/)
  expect(() => issueWallet(f.cfg, {claims: {status: {attacker: true}}})).toThrow(/original allocation ledger/)
  expect(existsSync(join(f.directory, '.indices.json'))).toBe(false)
})
