// Issuer-owned local status publication, compatible with issuer-status.sh's
// durable allocation ledger. Never reset a list or forget a revoked index.
import assert from 'node:assert/strict'
import {constants, existsSync, openSync, readSync, writeFileSync, closeSync, fstatSync, fsyncSync, fchmodSync,
  lstatSync, mkdirSync, renameSync, rmdirSync} from 'node:fs'
import {join} from 'node:path'
import {gzipSync} from 'node:zlib'
import {signCompactJws} from '../../src/oid4vp/jose.ts'
import type {FleetConfig} from './_fleet.ts'
import {localPrepaidSettings} from './_prepaid-funding.ts'

interface Ledger {url: string; next_index: number; members: Record<string, number>; revoked: number[]}
const capacity = 131_072
function readLedger(file: string): Ledger {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = fstatSync(fd)
    assert(stat.isFile() && stat.uid === process.getuid?.() && !(stat.mode & 0o077) && stat.size <= 2 * 1024 * 1024,
      'Issuer allocation ledger must be bounded, private and owned')
    const bytes = Buffer.alloc(2 * 1024 * 1024 + 1)
    let length = 0
    while (length < bytes.length) {const n = readSync(fd, bytes, length, bytes.length - length, null); if (!n) break; length += n}
    assert(length <= 2 * 1024 * 1024, 'Issuer ledger exceeded its bound')
    const value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(0, length))) as Ledger
    assert(value && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).sort().join(',') === 'members,next_index,revoked,url', 'Invalid issuer ledger shape')
    assert(Number.isSafeInteger(value.next_index) && value.next_index >= 0 && value.next_index <= capacity
      && value.members && typeof value.members === 'object' && !Array.isArray(value.members) && Array.isArray(value.revoked), 'Invalid issuer allocation state')
    const indices = Object.values(value.members)
    assert(new Set(indices).size === indices.length && indices.every(i => Number.isSafeInteger(i) && i >= 0 && i < value.next_index)
      && value.revoked.every(i => Number.isSafeInteger(i) && i >= 0 && i < capacity), 'Issuer indices are ambiguous or out of range')
    return value
  } finally {closeSync(fd)}
}
function atomic(file: string, temporary: string, bytes: string, mode: number) {
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode)
  try {fchmodSync(fd, mode); writeFileSync(fd, bytes); fsyncSync(fd)} finally {closeSync(fd)}
  renameSync(temporary, file)
  const parent = openSync(join(file, '..'), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try {fsyncSync(parent)} finally {closeSync(parent)}
}
export function issuerStatus(cfg: FleetConfig, member: string, revoke = false) {
  localPrepaidSettings(cfg)
  const directory = cfg.raw.KK_STATUS_LIST_DIR, rawUrl = cfg.raw.KK_STATUS_LIST_URL
  assert(directory && rawUrl, 'Local paid credentials require an explicit issuer publication directory and HTTPS status URL')
  const stat = lstatSync(directory)
  assert(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid?.(), 'Issuer publication directory must be owned and regular')
  const url = new URL(rawUrl)
  assert(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
    && url.pathname.endsWith('/employee.jwt') && url.href === rawUrl, 'Issuer must publish the exact approved HTTPS employee status list')
  assert(member.length > 0 && member.length <= 2048 && !Object.hasOwn(Object.prototype, member), 'Invalid issuer member identity')
  const key = Buffer.from(cfg.issuerKey, 'base64url')
  assert(key.length === 32 && key.toString('base64url') === cfg.issuerKey, 'Issuer status key must be a canonical Ed25519 seed')
  const ledgerFile = join(directory, '.indices.json'), listFile = join(directory, 'employee.jwt'), lock = join(directory, '.issuer-lock')
  // An interrupted write keeps its lock and temporary bytes. It must be inspected
  // before another issuer operation; elapsed time never resets revocation state.
  let complete = false
  try {
    mkdirSync(lock, {mode: 0o700})
    if (!existsSync(ledgerFile)) {
      assert(!existsSync(listFile) && !revoke, 'Refusing a status-list reset or revocation without the original ledger')
      atomic(ledgerFile, join(lock, 'initial.json'), JSON.stringify({url: rawUrl, next_index: 0, members: {}, revoked: []}) + '\n', 0o600)
    }
    const ledger = readLedger(ledgerFile)
    assert.equal(ledger.url, rawUrl, 'Status publication cannot change the original list URL')
    let index = Object.hasOwn(ledger.members, member) ? ledger.members[member] : undefined
    if (index === undefined) {
      assert(!revoke && ledger.next_index < capacity, 'Issuer cannot revoke an unknown member or reuse a full list')
      index = ledger.next_index++
      ledger.members[member] = index
    }
    if (revoke && !ledger.revoked.includes(index)) ledger.revoked.push(index)
    // Allocation/revocation is durable before any credential or replacement list.
    atomic(ledgerFile, join(lock, 'indices.json'), JSON.stringify(ledger) + '\n', 0o600)
    const bits = Buffer.alloc(capacity / 8)
    for (const revoked of ledger.revoked) bits[Math.floor(revoked / 8)]! |= 1 << (7 - revoked % 8)
    const now = Math.floor(Date.now() / 1000), ttl = Number(cfg.raw.KK_STATUS_LIST_TTL_SECS ?? '86400')
    assert(Number.isSafeInteger(ttl) && ttl > 0 && ttl <= 86400, 'Issuer status freshness must be bounded')
    const jwt = signCompactJws({alg: 'EdDSA', typ: 'JWT', kid: cfg.issuerDid + '#0'}, {
      iss: cfg.issuerDid, sub: rawUrl, jti: rawUrl, iat: now, nbf: now, exp: now + ttl,
      vc: {'@context': ['https://www.w3.org/2018/credentials/v1', 'https://w3id.org/vc/status-list/2021/v1'], id: rawUrl,
        type: ['VerifiableCredential', 'StatusList2021Credential'], issuer: cfg.issuerDid,
        credentialSubject: {id: rawUrl + '#list', type: 'StatusList2021', statusPurpose: 'revocation', encodedList: gzipSync(bits).toString('base64url')}},
    }, {alg: 'EdDSA', privateKey: key})
    atomic(listFile, join(lock, 'list.jwt'), jwt + '\n', 0o644)
    complete = true
    return {id: rawUrl + '#' + index, type: 'StatusList2021Entry', statusPurpose: 'revocation',
      statusListIndex: String(index), statusListCredential: rawUrl}
  } finally {key.fill(0); if (complete) rmdirSync(lock)}
}
