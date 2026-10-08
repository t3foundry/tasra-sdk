import {describe, expect, it, vi} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import {hexToBytes, toHex, type Address, type Hex} from 'viem'
import {merkleRoot, verifierLeaf} from '../../src/committee/token.js'
import {fetchDrawnVerifierWitnesses, type OriginalVerifierPolicy} from '../../src/chain/verifierSnapshot.js'

const hash = (byte: number, length = 32) => `0x${byte.toString(16).padStart(2, '0').repeat(length)}` as Hex
function fixture() {
  const entries = [1, 2, 3].map((n, index) => ({index, operator: hash(n, 20), pubkey: toHex(ed25519.getPublicKey(new Uint8Array(32).fill(n)))}))
  const root = toHex(merkleRoot(entries.map(m => verifierLeaf(m.index, hexToBytes(m.operator), hexToBytes(m.pubkey))))!)
  const payment: OriginalVerifierPolicy = {chain_id: 43112, slot: hash(4), verification_epoch: 7, verification_seed: hash(5),
    verification_root: root, verification_registry_size: 3, verification_committee: 2, verification_quorum: 2}
  const registry = hash(6, 20) as Address
  return {payment, registry, artifact: {version: 1, chain_id: 43112, registry, epoch: 7, root, size: 3, block_number: 15, block_hash: hash(15), entries}}
}
const json = (value: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), {status: 200, headers: {'content-type': 'application/json', ...headers}})

describe('fetchDrawnVerifierWitnesses', () => {
  it('skips hosts that fail, serve the wrong type or an unverifiable artifact, and uses the first verifiable one', async () => {
    const f = fixture()
    const forged = {...f.artifact, entries: f.artifact.entries.map(e => ({...e, pubkey: hash(9)}))}
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.redirect).toBe('error')
      if (url.startsWith('https://a.')) throw new Error('down')
      if (url.startsWith('https://b.')) return new Response('{}', {status: 200, headers: {'content-type': 'text/plain'}})
      if (url.startsWith('https://c.')) return json(forged)
      return json(f.artifact)
    })
    const result = await fetchDrawnVerifierWitnesses(['https://a.example', 'https://b.example', 'https://c.example', 'https://d.example/'], f.payment, f.registry, {fetch: fetch as typeof globalThis.fetch})
    expect(result.host).toBe('https://d.example/')
    expect(result.witnesses).toHaveLength(2)
    expect(fetch.mock.calls.map(c => c[0])).toEqual(['https://a.example/v1/verifier-set/7', 'https://b.example/v1/verifier-set/7',
      'https://c.example/v1/verifier-set/7', 'https://d.example/v1/verifier-set/7'])
  })
  it('fails when no approved host verifies and refuses unsafe host lists', async () => {
    const f = fixture()
    const fetch = vi.fn(async () => json({}, {'content-encoding': 'gzip'}))
    await expect(fetchDrawnVerifierWitnesses(['https://a.example'], f.payment, f.registry, {fetch: fetch as typeof globalThis.fetch})).rejects.toThrow(/No approved accountant/)
    await expect(fetchDrawnVerifierWitnesses([], f.payment, f.registry)).rejects.toThrow(/hosts/)
    await expect(fetchDrawnVerifierWitnesses(['https://u:p@a.example'], f.payment, f.registry)).rejects.toThrow(/host/)
    await expect(fetchDrawnVerifierWitnesses(['ftp://a.example'], f.payment, f.registry)).rejects.toThrow(/host/)
  })
  it('stops on cancellation', async () => {
    const f = fixture(), controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(fetchDrawnVerifierWitnesses(['https://a.example'], f.payment, f.registry, {signal: controller.signal, fetch: vi.fn() as unknown as typeof fetch})).rejects.toThrow('cancelled')
  })
})
