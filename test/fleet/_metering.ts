// Local certification reads meters as an actual registered accountant. This
// identity is private fixture configuration, never part of a wallet grant.
import assert from 'node:assert/strict'
import {constants, openSync, closeSync, fstatSync, readSync} from 'node:fs'
import {ed25519} from '@noble/curves/ed25519'
import {concatHex, createPublicClient, http, keccak256, toHex, type Hex} from 'viem'
import {nodeRegistryAbi} from '../../src/chain/abis/nodeRegistry.ts'
import type {FleetConfig} from './_fleet.ts'
import {localPrepaidSettings} from './_prepaid-funding.ts'

export interface MeteringIdentity {chainId: number; nodeRegistry: Hex; operator: Hex; seed: Hex}
export interface MeteringReply {total: number; by_subject: Array<{subject: string; count: number}>}

export function readMeteringIdentity(file: string): MeteringIdentity {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = fstatSync(fd)
    assert(stat.isFile() && stat.size > 0 && stat.size <= 1024 && (stat.mode & 0o077) === 0,
      'Metering identity must be a bounded owner-only regular file')
    if (process.getuid) assert.equal(stat.uid, process.getuid(), 'Metering identity has another owner')
    const bytes = Buffer.alloc(1025)
    let length = 0
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null)
      if (!count) break
      length += count
    }
    assert(length <= 1024, 'Metering identity exceeded its byte limit')
    let identity: MeteringIdentity
    try {identity = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(0, length))) as MeteringIdentity}
    catch {throw new Error('Invalid local metering identity JSON')} // Never include private input in a parser diagnostic.
    assert(identity && identity.chainId === 43112 && /^0x[0-9a-fA-F]{40}$/.test(identity.nodeRegistry)
      && /^0x[0-9a-fA-F]{40}$/.test(identity.operator) && /^0x[0-9a-fA-F]{64}$/.test(identity.seed), 'Invalid local metering identity')
    return identity
  } finally {closeSync(fd)}
}

export function meteringHeaders(seed: Hex, slot: Hex, issuedAt: number): Record<string, string> {
  assert(/^0x[0-9a-fA-F]{64}$/.test(seed) && /^0x[0-9a-fA-F]{64}$/.test(slot), 'Invalid metering key or slot')
  assert(Number.isSafeInteger(issuedAt) && issuedAt > 0, 'Invalid metering timestamp')
  const bytes = Buffer.from(seed.slice(2), 'hex'), pubkey = toHex(ed25519.getPublicKey(bytes))
  const digest = keccak256(concatHex([toHex('keykeeper-committee/metering-fetch/v1'), toHex(43112, {size: 8}),
    slot, pubkey, toHex(issuedAt, {size: 8})]))
  return {'x-kk-operator-pubkey': pubkey, 'x-kk-issued-at': String(issuedAt),
    'x-kk-signature': toHex(ed25519.sign(Buffer.from(digest.slice(2), 'hex'), bytes))}
}

export async function readAccountantMetering(cfg: FleetConfig, nodeUrl: string, slot: Hex): Promise<MeteringReply> {
  localPrepaidSettings(cfg)
  const url = new URL(nodeUrl)
  assert(['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    && !url.username && !url.password && !url.search && !url.hash, 'Metering fixture requires an explicit local keeper route')
  assert(cfg.raw.KK_METERING_IDENTITY_FILE, 'KK_METERING_IDENTITY_FILE must name the private accountant identity')
  const identity = readMeteringIdentity(cfg.raw.KK_METERING_IDENTITY_FILE)
  assert.equal(identity.nodeRegistry.toLowerCase(), cfg.book.NodeRegistry?.toLowerCase(), 'Metering identity belongs to another registry')
  const client = createPublicClient({transport: http(cfg.rpcUrl, {retryCount: 0, timeout: 15_000, fetchOptions: {redirect: 'error'}})})
  assert.equal(await client.getChainId(), 43112, 'Metering RPC must prove the local chain')
  const headers = meteringHeaders(identity.seed, slot, Math.floor(Date.now() / 1000))
  const operator = await client.readContract({address: identity.nodeRegistry, abi: nodeRegistryAbi,
    functionName: 'activeTaggedOperatorOf', args: [keccak256(headers['x-kk-operator-pubkey'] as Hex), keccak256(toHex('accountant'))]})
  assert(!/^0x0+$/.test(operator) && operator.toLowerCase() === identity.operator.toLowerCase(), 'Metering identity is not the active accountant')
  const response = await fetch(nodeUrl.replace(/\/$/, '') + `/v1/metering/${slot}/signed`,
    {headers, redirect: 'error', signal: AbortSignal.timeout(15_000)})
  assert.equal(response.status, 200, `Accountant-signed metering refused (HTTP ${response.status})`)
  const meter = await response.json() as MeteringReply
  assert(Number.isSafeInteger(meter.total) && meter.total >= 0 && Array.isArray(meter.by_subject)
    && meter.by_subject.every(r => typeof r.subject === 'string' && Number.isSafeInteger(r.count) && r.count >= 0), 'Invalid metering reply')
  return meter
}
