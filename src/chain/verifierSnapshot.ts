// The drawn verifier witnesses a paid session needs, from a public snapshot artifact.
//
// Accountants serve the verifier-set snapshot for an epoch (`GET /v1/verifier-set/{epoch}`).
// The artifact host supplies only the leaves; their authority is the payment's own anchored
// root, size, seed and epoch, which the creator signed from a canonical chain read. A host
// that serves anything else is refused, and the next approved host is tried. Never replace a
// retained epoch with the live roster.

import {hexToBytes, toHex, type Address, type Hex} from 'viem'
import {merkleProof, merkleRoot, selectVerifierCommittee, verifierLeaf} from '../committee/token.js'
import type {PaymentIntentWire} from '../committee/payment.js'
import type {PaidVerifierWitness} from './prepaid.js'

/** The anchored verifier policy fields of an original payment intent. */
export type OriginalVerifierPolicy = Pick<PaymentIntentWire, 'chain_id' | 'slot' | 'verification_epoch'
  | 'verification_seed' | 'verification_root' | 'verification_registry_size' | 'verification_committee' | 'verification_quorum'>

const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024

function fail(message: string): never { throw new Error(`Verifier snapshot refused: ${message}`) }
function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('expected a JSON object')
  const record = value as Record<string, unknown>
  if (Object.getOwnPropertySymbols(record).length
    || !Object.values(Object.getOwnPropertyDescriptors(record)).every(d => d.enumerable && Object.hasOwn(d, 'value'))) fail('objects must contain only JSON properties')
  const keys = Object.keys(record).sort(), expected = [...fields].sort()
  if (keys.length !== expected.length || keys.some((k, i) => k !== expected[i])) fail('unexpected or missing fields')
  return record
}
function hex(value: unknown, size: number): Hex {
  if (typeof value !== 'string' || !new RegExp(`^0x[0-9a-fA-F]{${size * 2}}$`).test(value) || /^0x0+$/.test(value)) fail('identity must be nonzero canonical-length hex')
  return value.toLowerCase() as Hex
}

/**
 * Verify a snapshot artifact against the original payment and return the drawn members with
 * Merkle proofs. Every leaf is checked against the anchored root, operators are strictly
 * ordered and keys distinct; the draw is recomputed locally from the payment's seed.
 * @param value Parsed artifact JSON from an approved host; untrusted.
 * @param original The payment's anchored verifier policy.
 * @param registry Independently approved VerifierSetRegistry address.
 */
export function drawnVerifierWitnesses(value: unknown, original: OriginalVerifierPolicy, registry: Address): PaidVerifierWitness[] {
  const p = structuredClone(original)
  if (!Number.isSafeInteger(p.chain_id) || p.chain_id <= 0 || !Number.isSafeInteger(p.verification_epoch) || p.verification_epoch < 0) fail('invalid original deployment or epoch')
  hex(p.slot, 32); hex(p.verification_seed, 32); hex(p.verification_root, 32); hex(registry, 20)
  if (!Number.isSafeInteger(p.verification_registry_size) || p.verification_registry_size <= 0 || p.verification_registry_size > (1 << 20)) fail('invalid original pool size')
  if (!Number.isSafeInteger(p.verification_committee) || !Number.isSafeInteger(p.verification_quorum)
    || p.verification_quorum <= 0 || p.verification_quorum > p.verification_committee
    || p.verification_committee > Math.min(4096, p.verification_registry_size)) fail('invalid original quorum')
  const artifact = object(value, ['version', 'chain_id', 'registry', 'epoch', 'root', 'size', 'block_number', 'block_hash', 'entries'])
  if (artifact.version !== 1 || artifact.chain_id !== p.chain_id || artifact.epoch !== p.verification_epoch
    || hex(artifact.registry, 20) !== registry.toLowerCase() || hex(artifact.root, 32) !== p.verification_root.toLowerCase()
    || artifact.size !== p.verification_registry_size) fail('differs from the original anchored payment')
  if (!Number.isSafeInteger(artifact.block_number) || Number(artifact.block_number) < 0) fail('invalid provenance block')
  hex(artifact.block_hash, 32)
  if (!Array.isArray(artifact.entries) || artifact.entries.length !== p.verification_registry_size) fail('leaf count differs')
  let previous = ''
  const keys = new Set<string>()
  const entries = (artifact.entries as unknown[]).map((value, index) => {
    const entry = object(value, ['index', 'operator', 'pubkey'])
    const operator = hex(entry.operator, 20), publicKey = hex(entry.pubkey, 32)
    if (entry.index !== index || operator <= previous || keys.has(publicKey)) fail('indexes, operator order or keys are ambiguous')
    previous = operator; keys.add(publicKey)
    return {index, operator, publicKey}
  })
  const leaves = entries.map(m => verifierLeaf(m.index, hexToBytes(m.operator), hexToBytes(m.publicKey)))
  const root = merkleRoot(leaves)
  if (!root || toHex(root) !== p.verification_root.toLowerCase()) fail('leaves differ from the independently anchored root')
  const drawn = selectVerifierCommittee(hexToBytes(p.slot), p.verification_epoch, hexToBytes(p.verification_seed),
    p.verification_registry_size, p.verification_committee)
  return drawn.map(index => {
    const member = entries[index]!, proof = merkleProof(leaves, index)
    if (!proof) fail('missing drawn verifier proof')
    return {...member, proof: proof.map(step => toHex(step))}
  })
}

/**
 * Fetch an epoch's verifier snapshot from the first approved accountant that serves a bounded,
 * identity-encoded JSON body (no redirects), and return the drawn witnesses for the payment.
 * A host whose artifact does not verify is skipped; the call fails if none does.
 * @param hosts Independently approved accountant origins, in preference order.
 * @param original The payment's anchored verifier policy.
 * @param registry Independently approved VerifierSetRegistry address.
 * @param options Cancellation, per-host timeout (default 15000 ms) and a fetch implementation.
 */
export async function fetchDrawnVerifierWitnesses(hosts: readonly string[], original: OriginalVerifierPolicy, registry: Address,
  options: {signal?: AbortSignal; timeoutMs?: number; fetch?: typeof fetch} = {}): Promise<{witnesses: PaidVerifierWitness[]; artifact: unknown; host: string}> {
  const list = [...hosts], doFetch = options.fetch ?? globalThis.fetch, timeout = options.timeoutMs ?? 15_000
  if (!list.length || list.length > 16 || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000) throw new Error('Invalid verifier snapshot hosts or timeout')
  for (const host of list) {
    const url = new URL(host)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid verifier snapshot host')
  }
  for (const host of list) {
    options.signal?.throwIfAborted()
    try {
      const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)
      const response = await doFetch(host.replace(/\/$/, '') + '/v1/verifier-set/' + original.verification_epoch,
        {redirect: 'error', signal, headers: {accept: 'application/json', 'accept-encoding': 'identity'}})
      const encoding = response.headers.get('content-encoding')
      if (response.status !== 200 || response.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json'
        || (encoding && encoding !== 'identity') || !response.body) continue
      const reader = response.body.getReader(), chunks: Uint8Array[] = []
      let length = 0
      try {
        for (;;) {
          const {done, value} = await reader.read()
          if (done) break
          length += value.length
          if (length > MAX_SNAPSHOT_BYTES) throw new Error('Snapshot exceeds the read-only artifact bound')
          chunks.push(value)
        }
      } finally { await reader.cancel().catch(() => {}) }
      const bytes = new Uint8Array(length); let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
      const artifact = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)) as unknown
      return {witnesses: drawnVerifierWitnesses(artifact, original, registry), artifact, host}
    } catch { options.signal?.throwIfAborted() }
  }
  throw new Error('No approved accountant served a verifiable original verifier snapshot')
}
