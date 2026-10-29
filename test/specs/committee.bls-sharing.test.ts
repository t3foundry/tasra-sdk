import {readFileSync} from 'node:fs'
import {afterEach, expect, test, vi} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import {encodePacked, keccak256, hexToBytes, toHex, type Hex} from 'viem'
import {discoverBlsSharing, type BlsSharingOptions} from '../../src/committee/blsSharing.js'

const ibe = JSON.parse(readFileSync(new URL('../ibe-vectors.json', import.meta.url), 'utf8')) as {verifying_shares: {identifier: number; g2: string; g1: string}[]}
const vector = {shares: ibe.verifying_shares.map(s => ({identifier: s.identifier, verifying_share: s.g2.replace(/^0x/, '') + s.g1.replace(/^0x/, '')}))}
const slot = ('0x' + '11'.repeat(32)) as Hex
const keys = vector.shares.map((_, i) => new Uint8Array(32).fill(i + 1))
const roster = keys.map((key, i) => ({operator: ('0x' + (i + 1).toString(16).padStart(40, '0')) as Hex,
  publicKey: ed25519.getPublicKey(key), nodeUrl: `https://keeper-${i}.example`}))
type Report = {slot_id: Hex; epoch: number; committee_version: number; identifier: number; operator: Hex; pubkey: Hex; verifying_share: Hex; signature?: Hex}
function signed(index: number, changes: Partial<Report> = {}, chain = 43112): Report {
  const r: Report = {slot_id: slot, epoch: 0, committee_version: 7, identifier: vector.shares[index]!.identifier,
    operator: roster[index]!.operator, pubkey: toHex(roster[index]!.publicKey), verifying_share: ('0x' + vector.shares[index]!.verifying_share.replace(/^0x/, '')) as Hex, ...changes}
  const hash = keccak256(encodePacked(['string', 'uint64', 'bytes32', 'uint64', 'uint64', 'uint32', 'address', 'bytes'],
    ['keykeeper-committee/keeper-share-report/v1', BigInt(chain), r.slot_id, BigInt(r.epoch), BigInt(r.committee_version), r.identifier, r.operator, r.verifying_share]))
  return {...r, signature: toHex(ed25519.sign(hexToBytes(hash), keys[index]!))}
}
function fixture(reply: (index: number) => Response = i => Response.json(signed(i))): BlsSharingOptions & {fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>} {
  return {chainId: 43112, slotId: slot, epoch: 0, committeeVersion: 7, threshold: 2,
    keepers: roster.map(k => ({...k, publicKey: k.publicKey.slice()})),
    fetchImpl: vi.fn<typeof fetch>(async url => reply(Number(/keeper-(\d+)/.exec(String(url))![1])))}
}
afterEach(() => vi.useRealTimers())

test('authenticates public reports against independently supplied operator keys without starting work', async () => {
  const opts = fixture(), result = await discoverBlsSharing(opts)
  expect(result.keepers.map(k => k.operator)).toEqual(roster.map(k => k.operator))
  expect([...result.verifyingShares]).toEqual(vector.shares.map(s => [s.identifier, hexToBytes(('0x' + s.verifying_share.replace(/^0x/, '')) as Hex)]))
  expect(result.failures).toEqual([])
  for (const [url, init] of opts.fetchImpl.mock.calls) {
    expect(String(url)).toContain(`/v1/keys/${slot}/bls-share-report`)
    expect(init).toMatchObject({credentials: 'omit', redirect: 'error'})
    expect(init?.method).toBeUndefined()
    expect(init?.body).toBeUndefined()
  }
})

test.each(['signature', 'operator', 'pubkey', 'slot', 'epoch', 'version', 'identifier', 'share', 'dual-group', 'chain'] as const)('rejects a %s report while preserving an honest quorum', async kind => {
  const opts = fixture(i => {
    if (i !== 0) return Response.json(signed(i))
    if (kind === 'signature') return Response.json({...signed(i), signature: '0x' + '00'.repeat(64)})
    if (kind === 'operator') return Response.json(signed(i, {operator: roster[1]!.operator}))
    if (kind === 'pubkey') return Response.json(signed(i, {pubkey: toHex(roster[1]!.publicKey)}))
    if (kind === 'slot') return Response.json(signed(i, {slot_id: ('0x' + '22'.repeat(32)) as Hex}))
    if (kind === 'epoch') return Response.json(signed(i, {epoch: 1}))
    if (kind === 'version') return Response.json(signed(i, {committee_version: 8}))
    if (kind === 'identifier') return Response.json(signed(i, {identifier: 0}))
    if (kind === 'share') return Response.json({...signed(i), verifying_share: '0x' + '00'.repeat(144)})
    if (kind === 'dual-group') {
      const g2 = hexToBytes(signed(i).verifying_share).slice(0, 96), g1 = hexToBytes(signed(1).verifying_share).slice(96)
      return Response.json(signed(i, {verifying_share: toHex(new Uint8Array([...g2, ...g1]))}))
    }
    return Response.json(signed(i, {}, 43113))
  })
  const result = await discoverBlsSharing(opts)
  expect(result.keepers.map(k => k.operator)).toEqual(roster.slice(1).map(k => k.operator))
  expect(result.failures).toHaveLength(1)
})

test('refuses duplicate signed participant identifiers rather than overwriting trust', async () => {
  const opts = fixture(i => Response.json(signed(i, {identifier: 1})))
  await expect(discoverBlsSharing(opts)).rejects.toThrow('Duplicate identifier')
})

test('tolerates an unavailable member but refuses a missing authenticated threshold', async () => {
  const opts = fixture(i => i === 0 ? new Response('offline', {status: 503}) : Response.json(signed(i)))
  expect((await discoverBlsSharing(opts)).keepers).toHaveLength(2)
  opts.threshold = 3
  await expect(discoverBlsSharing(opts)).rejects.toThrow('threshold not met: 2/3')
})

test('refuses invalid roster and transport configuration before any HTTP request', async () => {
  for (const alter of [
    (o: BlsSharingOptions) => {o.threshold = 0},
    (o: BlsSharingOptions) => {o.committeeVersion = -1},
    (o: BlsSharingOptions) => {o.keepers = [roster[0]!, roster[0]!]},
    (o: BlsSharingOptions) => {o.keepers = [{...roster[0]!, nodeUrl: 'https://user:secret@keeper.example'}, roster[1]!]},
    (o: BlsSharingOptions) => {o.keepers = [{...roster[0]!, nodeUrl: 'http://127.0.0.1'}, roster[1]!]},
  ]) {
    const opts = fixture(); alter(opts)
    await expect(discoverBlsSharing(opts)).rejects.toThrow()
    expect(opts.fetchImpl).not.toHaveBeenCalled()
  }
})

test('bounds oversized metadata and refuses cancellation before discovery', async () => {
  const oversized = fixture(() => new Response('x'.repeat(16_385)))
  await expect(discoverBlsSharing(oversized)).rejects.toThrow('16 KiB')
  const opts = fixture(), controller = new AbortController(), reason = new Error('stop metadata')
  controller.abort(reason)
  await expect(discoverBlsSharing({...opts, signal: controller.signal})).rejects.toBe(reason)
  expect(opts.fetchImpl).not.toHaveBeenCalled()
})

test('one deadline includes a metadata transport which ignores abort', async () => {
  vi.useFakeTimers()
  const opts = fixture()
  opts.fetchImpl.mockImplementation(() => new Promise<Response>(() => {}))
  const running = expect(discoverBlsSharing(opts)).rejects.toThrow('15-second deadline')
  await vi.advanceTimersByTimeAsync(15_001)
  await running
  expect(opts.fetchImpl.mock.calls.every(([, init]) => init?.signal?.aborted)).toBe(true)
})
