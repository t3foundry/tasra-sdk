// RFC 9180 recipient protection for Tasra threshold contributions. No custom HPKE.
import {CipherSuite, HkdfSha256} from '@hpke/core'
import {DhkemX25519HkdfSha256} from '@hpke/dhkem-x25519'
import {Chacha20Poly1305} from '@hpke/chacha20poly1305'
import {sha256} from '@noble/hashes/sha256'
import {bytesToHex, hexToBytes} from './hex.js'
import {base64Decode} from './envelope.js'
import type {Ciphertext} from './kem.js'
import {requestHash, type CommitteeAction} from '../oid4vp/binding.js'

/** RFC 9180 suite accepted for client-sealed decryption contributions. */
export const RECIPIENT_SUITE = 'hpke-x25519-sha256-chacha20poly1305'
const utf8 = (s: string) => new TextEncoder().encode(s)
const suite = new CipherSuite({kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Chacha20Poly1305()})
/** Public recipient metadata bound before holder and client execution authorization. */
export interface RecipientWire {
  /** Exact supported RFC 9180 suite name. */
  suite: string
  /** Hex-encoded 32-byte X25519 public key; never a private key or recovery seed. */
  public_key: string
}
/** Public decryption context included in the signed authorization session. */
export interface DecryptionBindingWire {
  /** Client recipient to which every keeper seals its contribution. */
  recipient: RecipientWire
  /** Nonnegative canonical key epoch of the ciphertext. */
  ciphertext_epoch: number
  /** Hex-encoded content digest: complete KEM ciphertext and identity, or SHA-256 of the IBE identity. */
  content_digest?: string
}
/** Standard padded-base64 HPKE envelope carrying one encrypted contribution. */
export interface SealedShareWire {
  /** RFC 9180 encapsulated X25519 key, encoded as padded base64. */
  enc: string
  /** Authenticated encrypted contribution, encoded as padded base64. */
  ciphertext: string
}
/** Client-held opening capability; only its public recipient belongs in requests or journals. */
export interface ClientRecipient {
  /** Public recipient metadata that authorization must bind before any keeper work. */
  readonly recipient: RecipientWire
  /** Open one contribution locally using the exact authorized request and keeper context.
   * The caller must pairing-verify the recovered contribution and clear it after use.
   * @param sealed - Keeper's encrypted contribution.
   * @param requestHash - Chain-, slot-, action- and recipient-bound request hash.
   * @param identifier - Distinct keeper's BLS participant identifier.
   * @param epoch - Authorized ciphertext key epoch.
   * @param verifyingShare - Authenticated 144-byte G2 || G1 public verifying share.
   */
  open(sealed: SealedShareWire, requestHash: Uint8Array, identifier: number, epoch: number, verifyingShare: Uint8Array): Promise<Uint8Array>
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {out.set(p, offset); offset += p.length}
  return out
}
function be64(n: number): Uint8Array {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('epoch/length must be a nonnegative safe integer')
  const out = new Uint8Array(8)
  new DataView(out.buffer).setBigUint64(0, BigInt(n))
  return out
}
function aad(hash: Uint8Array, identifier: number, epoch: number, vs: Uint8Array): Uint8Array {
  if (hash.length !== 32 || !Number.isInteger(identifier) || identifier < 1 || identifier > 65535 || vs.length !== 144) throw new Error('invalid sealed share context')
  return concat(hash, new Uint8Array([identifier >>> 8, identifier & 255]), be64(epoch), vs)
}

/** Create BEFORE requesting authorization. The private key stays in this closure and
 * is never included in session or keeper requests. Generate a fresh instance per operation.
 * @param seed - Optional client-held 32-byte random recovery seed for RFC 9180 DeriveKeyPair.
 * Store it only in the client's private storage; the caller owns and must clear its buffer.
 */
export async function createDecryptionRecipient(seed?: Uint8Array): Promise<ClientRecipient> {
  const derive = async (original: Uint8Array) => {
    if (original.length !== 32 || original.every(b => b === 0)) throw new Error('Recipient recovery seed must contain 32 random bytes')
    const copy = new Uint8Array(original)
    try {return await suite.kem.deriveKeyPair(copy)} finally {copy.fill(0)}
  }
  const keys = seed === undefined ? await suite.kem.generateKeyPair() : await derive(seed)
  const publicKey = new Uint8Array(await suite.kem.serializePublicKey(keys.publicKey))
  const recipient = Object.freeze({suite: RECIPIENT_SUITE, public_key: bytesToHex(publicKey)})
  return Object.freeze({
    recipient,
    async open(sealed: SealedShareWire, hash: Uint8Array, identifier: number, epoch: number, vs: Uint8Array): Promise<Uint8Array> {
      if (!sealed || typeof sealed.enc !== 'string' || typeof sealed.ciphertext !== 'string') throw new Error('unsealed or malformed keeper reply refused')
      const enc = base64Decode(sealed.enc)
      if (enc.length !== 32) throw new Error('invalid HPKE encapsulated key')
      const ctx = await suite.createRecipientContext({recipientKey: keys.privateKey, enc: enc.buffer as ArrayBuffer, info: utf8('keykeeper:sealed-decryption-share:v1').buffer as ArrayBuffer})
      return new Uint8Array(await ctx.open(base64Decode(sealed.ciphertext).buffer as ArrayBuffer, aad(hash, identifier, epoch, vs).buffer as ArrayBuffer))
    },
  })
}

/** Hash the complete KEM content with unambiguous field lengths.
 * @param ct - Ciphertext including its group element, nonce and authenticated ciphertext.
 * @param identity - Exact associated-data identity bytes used during encryption.
 */
export function kemContentDigest(ct: Ciphertext, identity: Uint8Array): Uint8Array {
  const parts = [ct.u, ct.nonce, ct.aeadCt, identity]
  return sha256(concat(utf8('keykeeper:kem-content:v1'), ...parts.flatMap(p => [be64(p.length), p])))
}
/** Bind a content digest to the ciphertext epoch and client recipient.
 * @param content - Complete 32-byte KEM content digest or SHA-256 IBE identity digest.
 * @param epoch - Nonnegative canonical ciphertext key epoch.
 * @param recipient - Supported suite and client X25519 public key.
 */
export function recipientPayloadDigest(content: Uint8Array, epoch: number, recipient: RecipientWire): Uint8Array {
  const key = hexToBytes(recipient.public_key)
  if (recipient.suite !== RECIPIENT_SUITE || content.length !== 32 || key.length !== 32 || key.every(b => b === 0)) throw new Error('invalid recipient binding')
  return sha256(concat(utf8('keykeeper:recipient-bound-decryption:v1'), content, be64(epoch), new Uint8Array([0, 32, 0, 1, 0, 3]), key))
}
/** Prepare the digest and public session metadata before requesting authorization.
 * @param content - Complete KEM content digest or SHA-256 IBE identity digest.
 * @param epoch - Canonical ciphertext key epoch.
 * @param client - Original client-held recipient, retained for opening and recovery.
 */
export function decryptionBinding(content: Uint8Array, epoch: number, client: ClientRecipient): {payloadDigest: Uint8Array; decryption: DecryptionBindingWire} {
  return {payloadDigest: recipientPayloadDigest(content, epoch, client.recipient), decryption: {recipient: client.recipient, ciphertext_epoch: epoch, content_digest: bytesToHex(content)}}
}
/** Check the token binding before transmitting; refuse old or substituted grants.
 * @param chainId - Deployment chain identifier.
 * @param slotId - Hex-encoded 32-byte slot identifier.
 * @param action - Keeper operation named by the authorization.
 * @param digest - Recipient-bound 32-byte operation payload digest.
 * @param claimed - Request hash carried by the signed token; omission is refused.
 */
export function checkedDecryptionRequestHash(chainId: number | bigint, slotId: string, action: CommitteeAction, digest: Uint8Array, claimed: string | undefined): Uint8Array {
  const expected = requestHash(chainId, hexToBytes(slotId), action, digest)
  const actual = claimed ? hexToBytes(claimed) : new Uint8Array()
  if (actual.length !== 32 || !expected.every((b, i) => b === actual[i])) throw new Error('token is not bound to this recipient and decryption request')
  return expected
}
