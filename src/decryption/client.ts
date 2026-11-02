// Retired transports refuse before sending credentials or accepting unsealed replies.
import type {Ciphertext} from '../crypto/kem.js'

/** Legacy input retained for explicit runtime refusal. */
export interface BlsPeer {
  /** BLS threshold participant identifier. */
  id: number
  /** Network peer identifier for that participant. */
  peerId: string
}

/** Legacy input retained for explicit runtime refusal. */
export interface DecryptCustodyOpts {
  /** Keeper HTTP base URL. */
  nodeUrl: string
  /** Compact bearer JWT authorizing the request. */
  jwt: string
  /** 32-byte slot identifier. */
  slotId: string
  /** Ciphertext to decrypt. */
  ciphertext: Ciphertext
  /** AEAD additional-authenticated-data (the identity the envelope was bound to). */
  identity: Uint8Array
  /** BLS identifiers (k..n, distinct) to run the ceremony with. */
  decryptingSet: number[]
  /** The libp2p peers for those identifiers. */
  blsPeers: BlsPeer[]
  /** 64-byte Ed25519 user signature, required iff the slot has an owner pubkey. */
  userSignature?: Uint8Array
  /** Pin the ciphertext epoch; a rotated slot returns 410. */
  ciphertextEpoch?: number
  /** Optional 20-byte operator address to pin the intended keeper. */
  targetKeykeeper?: string
  /** Request identifier used to correlate or resume the operation. */
  requestId?: string
}

/** Legacy input retained for explicit runtime refusal. */
export interface ShardDecryptOpts {
  /** Base URLs of at least k nodes to fetch partial decryptions from. */
  nodeUrls: string[]
  /** Compact bearer JWT authorizing the request. */
  jwt: string
  /** 32-byte slot identifier. */
  slotId: string
  /** Ciphertext to decrypt. */
  ciphertext: Ciphertext
  /** Original encryption associated data. */
  identity: Uint8Array
  /** Expected key epoch of the ciphertext; used to detect rotation. */
  ciphertextEpoch?: number
  /** Pairing-verify each share before combining (identifiable abort). Default false. */
  verifyShares?: boolean
}

/** Server-side custody decryption is retired.
 * @param opts - Historical request options, refused before any HTTP request.
 */
export async function decryptCustody(opts:DecryptCustodyOpts):Promise<Uint8Array>{
  void opts
  throw new Error('legacy decryption is retired; use recipient-bound decryptWithCommitteePartials')
}

/** Unsealed JWT share delivery is retired.
 * @param opts - Historical request options, refused before any HTTP request.
 */
export async function decryptWithShardDelivery(opts:ShardDecryptOpts):Promise<Uint8Array>{
  void opts
  throw new Error('legacy decryption is retired; use recipient-bound decryptWithCommitteePartials')
}
