import {afterEach, expect, it, vi} from 'vitest'
import {mkdtempSync, writeFileSync, chmodSync, symlinkSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {ed25519} from '@noble/curves/ed25519'
import {concatHex, hexToBytes, keccak256, toHex} from 'viem'
import {readAccountantMetering, readMeteringIdentity, type MeteringIdentity} from '../fleet/_metering.ts'
import {generatedMeteringSeed} from '../verify/_paid-wallet-config.ts'
import type {FleetConfig} from '../fleet/_fleet.ts'

const rpc = vi.hoisted(() => ({getChainId: vi.fn(), readContract: vi.fn()}))
vi.mock('viem', async original => ({...await original<typeof import('viem')>(), createPublicClient: () => rpc}))
const directories: string[] = []
const slot = `0x${'22'.repeat(32)}` as const
const identity: MeteringIdentity = {chainId: 43112, nodeRegistry: `0x${'11'.repeat(20)}`,
  operator: `0x${'33'.repeat(20)}`, seed: `0x${'44'.repeat(32)}`}
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'sdk-signed-metering-')); directories.push(directory)
  const file = join(directory, 'identity.json')
  writeFileSync(file, JSON.stringify(identity), {mode: 0o600})
  const cfg = {chainId: 43112, rpcUrl: 'http://127.0.0.1:1234', book: {NodeRegistry: identity.nodeRegistry},
    raw: {KK_PREPAID_EVIDENCE_DIR: directory, KK_METERING_IDENTITY_FILE: file}} as unknown as FleetConfig
  rpc.getChainId.mockResolvedValue(43112); rpc.readContract.mockResolvedValue(identity.operator)
  return {cfg, file, directory}
}
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals(); rpc.getChainId.mockReset(); rpc.readContract.mockReset();
  for (const directory of directories.splice(0)) rmSync(directory, {recursive: true, force: true})})

it('reads the signed route with a verifiable accountant challenge and no wallet bearer', async () => {
  const {cfg} = fixture(), issuedAt = 1_791_900_000
  vi.spyOn(Date, 'now').mockReturnValue(issuedAt * 1000)
  const pubkey = toHex(ed25519.getPublicKey(hexToBytes(identity.seed)))
  const expected = keccak256(concatHex([toHex('keykeeper-committee/metering-fetch/v1'), toHex(43112, {size: 8}), slot, pubkey, toHex(issuedAt, {size: 8})]))
  const fetcher = vi.fn(async (url: string, options: RequestInit) => {
    expect(url).toBe(`http://127.0.0.1:9876/v1/metering/${slot}/signed`)
    const headers = new Headers(options.headers)
    expect(headers.has('Authorization')).toBe(false)
    expect(headers.get('x-kk-operator-pubkey')).toBe(pubkey)
    expect(headers.get('x-kk-issued-at')).toBe(String(issuedAt))
    expect(ed25519.verify(hexToBytes(headers.get('x-kk-signature') as `0x${string}`), hexToBytes(expected), hexToBytes(pubkey))).toBe(true)
    expect(options.redirect).toBe('error')
    return Response.json({total: 4, by_subject: [{subject: 'original', count: 4}]})
  })
  vi.stubGlobal('fetch', fetcher)
  expect(await readAccountantMetering(cfg, 'http://127.0.0.1:9876/', slot)).toEqual({total: 4, by_subject: [{subject: 'original', count: 4}]})
  expect(rpc.readContract).toHaveBeenCalledWith(expect.objectContaining({address: identity.nodeRegistry,
    functionName: 'activeTaggedOperatorOf', args: [keccak256(pubkey), keccak256(toHex('accountant'))]}))
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it.each([403, 404, 503])('reports HTTP %s without trying the retired bearer route', async status => {
  const {cfg} = fixture(), fetcher = vi.fn(async () => new Response('', {status})); vi.stubGlobal('fetch', fetcher)
  await expect(readAccountantMetering(cfg, 'http://localhost:9876', slot)).rejects.toThrow(`HTTP ${status}`)
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it.each(['remote', 'wrong-chain', 'wrong-registry', 'inactive', 'different-operator'] as const)('refuses %s before disclosing a signed request', async kind => {
  const {cfg} = fixture(), fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  if (kind === 'wrong-chain') rpc.getChainId.mockResolvedValue(43113)
  if (kind === 'wrong-registry') cfg.book.NodeRegistry = `0x${'99'.repeat(20)}`
  if (kind === 'inactive') rpc.readContract.mockResolvedValue(`0x${'00'.repeat(20)}`)
  if (kind === 'different-operator') rpc.readContract.mockResolvedValue(`0x${'99'.repeat(20)}`)
  await expect(readAccountantMetering(cfg, kind === 'remote' ? 'https://remote.example' : 'http://localhost:9876', slot)).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
})
it('refuses malformed metering data rather than accepting an empty or fractional count', async () => {
  const {cfg} = fixture(); vi.stubGlobal('fetch', vi.fn(async () => Response.json({total: 4, by_subject: [{subject: 'original', count: 0.5}]})))
  await expect(readAccountantMetering(cfg, 'http://localhost:9876', slot)).rejects.toThrow('Invalid metering reply')
})
it('reads only a bounded private regular identity file', () => {
  const {file, directory} = fixture()
  expect(readMeteringIdentity(file)).toEqual(identity)
  chmodSync(file, 0o644); expect(() => readMeteringIdentity(file)).toThrow('owner-only')
  chmodSync(file, 0o600)
  const alias = join(directory, 'alias'); symlinkSync(file, alias); expect(() => readMeteringIdentity(alias)).toThrow()
  expect(() => readMeteringIdentity(directory)).toThrow()
  writeFileSync(file, ' '.repeat(1025)); expect(() => readMeteringIdentity(file)).toThrow('bounded')
})
it('does not include private input in malformed identity diagnostics', () => {
  const {file} = fixture()
  writeFileSync(file, `{"seed":"${identity.seed}"`)
  let message = ''
  try {readMeteringIdentity(file)} catch (error) {message = String(error)}
  expect(message).toContain('Invalid local metering identity JSON')
  expect(message).not.toContain(identity.seed)
})
it('extracts the exact generated accountant identity instead of a similarly named section', () => {
  expect(generatedMeteringSeed(`[other]\nlibp2p_key = "ignored"\n[threshold_beacon]\nlibp2p_key = "${identity.seed}" # own key`)).toBe(identity.seed)
  for (const text of ['[other]\nlibp2p_key = "ignored"', '[threshold_beacon]\nlibp2p_key = "invalid"',
    `[threshold_beacon]\nlibp2p_key = "${identity.seed}"\nlibp2p_key = "${identity.seed}"`]) expect(() => generatedMeteringSeed(text)).toThrow()
})
