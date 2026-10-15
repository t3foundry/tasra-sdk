import {keccak_256} from '@noble/hashes/sha3'
import {ed25519} from '@noble/curves/ed25519'
import {bytesToHex} from '@noble/hashes/utils'
import {base64Decode, base64Encode} from '../crypto/envelope.js'
import {hexToBytes} from '../crypto/hex.js'
import {evidenceBindingMessage} from './token.js'

/** Sealed presentation bindings signed beside the unchanged compound-token hash. */
export interface EvidenceBindingWire {
  /** Keccak-256 of the encoded ciphertext bytes. */
  evidence_hash?: string
  /** Certified accountant evidence-key identifier. */
  evidence_key_id?: string
  /** Verifier signatures binding the token, ciphertext hash and evidence key. */
  evidence_signatures?: {verifier_index: number; signature: string}[]
}

const hash32 = /^(?:0x)?[a-f0-9]{64}$/i
const sig64 = /^(?:0x)?[a-f0-9]{128}$/i

/** Validate all-or-none metadata without changing any signed token bytes. */
export function assertEvidenceBinding(token: EvidenceBindingWire & {verifier_indexes: number[]}): boolean {
  const present = token.evidence_hash != null || token.evidence_key_id != null || (token.evidence_signatures?.length ?? 0) > 0
  if (!present) {
    if (token.evidence_signatures != null && !Array.isArray(token.evidence_signatures)) throw new Error('Invalid sealed evidence signatures')
    return false
  }
  if (typeof token.evidence_hash !== 'string' || !hash32.test(token.evidence_hash)
    || typeof token.evidence_key_id !== 'string' || !hash32.test(token.evidence_key_id)
    || !Array.isArray(token.evidence_signatures) || token.evidence_signatures.length === 0
    || token.evidence_signatures.length > token.verifier_indexes.length) throw new Error('Incomplete sealed evidence binding')
  const seen = new Set<number>()
  for (const entry of token.evidence_signatures) {
    if (!entry || !Number.isSafeInteger(entry.verifier_index) || !token.verifier_indexes.includes(entry.verifier_index)
      || seen.has(entry.verifier_index) || typeof entry.signature !== 'string' || !sig64.test(entry.signature)) throw new Error('Invalid sealed evidence signature')
    seen.add(entry.verifier_index)
  }
  return true
}

/** Bind the exact canonical base64url ciphertext before keeper approval or submission. */
export function evidenceBody(token: EvidenceBindingWire & {verifier_indexes: number[]}, evidenceCt?: string): {evidence_ct?: string} {
  const bound = assertEvidenceBinding(token)
  if (!bound && evidenceCt === undefined) return {}
  if (!bound || typeof evidenceCt !== 'string' || evidenceCt.length === 0 || evidenceCt.length > 21846
    || !/^[A-Za-z0-9_-]+$/.test(evidenceCt)) throw new Error('Missing or invalid sealed evidence ciphertext')
  const bytes = base64Decode(evidenceCt.replace(/-/g, '+').replace(/_/g, '/'))
  if (bytes.length > 16384 || base64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== evidenceCt
    || bytesToHex(keccak_256(bytes)) !== token.evidence_hash!.replace(/^0x/, '').toLowerCase()) throw new Error('Sealed evidence ciphertext does not match its binding')
  return {evidence_ct: evidenceCt}
}

/** Domain-separated message signed beside the original compound token. ONE implementation:
 *  the public `evidenceBindingMessage` in `./token.ts` (byte-identical to the Rust one). */
export {evidenceBindingMessage}

/** Authenticate sealed evidence under the independently anchored verifier committee keys. */
export function verifyEvidenceBinding(token: EvidenceBindingWire & {verifier_indexes: number[]}, evidenceCt: string | undefined,
  tokenHash: Uint8Array, keys: Map<number, Uint8Array>, quorum: number): void {
  evidenceBody(token, evidenceCt)
  if (!assertEvidenceBinding(token)) return
  if (!Number.isSafeInteger(quorum) || quorum < 1 || quorum > token.verifier_indexes.length) throw new Error('Invalid evidence quorum')
  const message = evidenceBindingMessage(tokenHash, hexToBytes(token.evidence_hash!), hexToBytes(token.evidence_key_id!))
  let count = 0
  for (const entry of token.evidence_signatures!) {
    const key = keys.get(entry.verifier_index)
    if (!key || !ed25519.verify(hexToBytes(entry.signature), message, key, {zip215: false})) throw new Error('Sealed evidence signature does not verify')
    count++
  }
  if (count < quorum) throw new Error('Sealed evidence quorum not met')
}
