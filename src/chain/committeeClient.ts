// The committee path, driven by a slot id and nothing else. See the JSDoc on
// createCommitteeSlotClient below for what it guarantees.
//
//   const kk = createCommitteeSlotClient({chain, holder, credentials, holderProof})
//   const sig = await kk.sign(slotId, message) // committee-authorized FROST
//   const env = await kk.encrypt(slotId, plaintext) // local (key read from chain)
//   const text = await kk.decrypt(slotId, {ciphertext, identity, decryptingSet, blsPeers})

import type {TasraChainClient} from './client.js'
import {
  resolveSlotKeeperUrls,
  resolveVerifierDirectory,
  resolveSlotGroupKey,
} from './discovery.js'
import {
  requestCommitteeToken,
  committeeSign,
  committeeDecrypt,
  committeeChainReadsFromClient,
  type ClientSigner,
  type CommitteeChainReads,
  type CommitteeVerifier,
  type CommitteeTokenResult,
  type HolderProofPerVerifier,
} from '../committee/index.js'
import {encryptEnvelope, toBytes} from '../crypto/envelope.js'
import {hexToBytes} from '../crypto/hex.js'
import type {FrostSignResult} from '../signing/frost.js'
import type {Ciphertext} from '../crypto/kem.js'
import type {BlsPeer} from '../decryption/client.js'

/**
 * Chain discovery and holder-proof configuration for threshold signing and identity decryption.
 */
export interface CommitteeSlotClientConfig {
  /** Read client for the deployment (RPC + address book). */
  chain: TasraChainClient
  /**
   * Holder DID (the credentials' subject).
   *
   * Required for {@link CommitteeSlotClient.sign} and
   * {@link CommitteeSlotClient.decrypt}, which must present credentials to the
   * verifier committee. Not needed for {@link CommitteeSlotClient.encrypt},
   * which only reads the slot's public group key from chain.
   */
  holder?: string
  /** Compact-JWS verifiable credentials presented to the committee. Required for sign/decrypt. */
  credentials?: string[]
  /**
   * Ignored compatibility field. Verifiers fetch the committed rule from a keeper; supplying this field does not change authorization.
   */
  dcqlRule?: string
  /**
   * Holder proof-of-possession for the holder DID authentication key. Required for sign/decrypt.
   *
   * One string serves one verifier: the proof names its audience and burns a nonce that lives in
   * that verifier, so on any deployment whose policy draws a committee the others answer 401 ("aud
   * does not include this verifier"). Pass `holderProofPerVerifier({signer, audience, credentials,
   * slotId})` there - it mints a fresh proof per drawn verifier, on every request.
   */
  holderProof?: string | HolderProofPerVerifier
  /** sign the request bundle so keeper + audit can verify you authorized it. */
  clientSigner?: ClientSigner
  /** Compound-token TTL in seconds (default 300). */
  ttlSecs?: number
}

/** Per-call overrides for a committee-authorized FROST signature. */
export interface SlotCommitteeSignOptions {
  /** Optional FROST participant identifiers selected for signing. */
  signingSet?: number[]
  /** Optional Ed25519 slot-owner approval signature for the signing request. */
  userSignature?: Uint8Array
  /** Pin the keeper this request targets (anti-Sybil). Must be one of the slot's
   *  on-chain assigned operators; there is no way to point at an off-chain node. */
  targetKeykeeper?: string
}

/** Everything a committee-authorized threshold decrypt needs beyond the slot id. */
export interface SlotCommitteeDecryptOptions {
  /** Group ciphertext to decrypt through committee authorization. */
  ciphertext: Ciphertext
  /** Original associated data used when encrypting the group ciphertext. */
  identity: Uint8Array
  /** BLS identifiers (k..n, distinct) to run the ceremony with. */
  decryptingSet: number[]
  /** The libp2p peers for those identifiers. */
  blsPeers: BlsPeer[]
  /** Optional Ed25519 slot-owner signature required by the keeper policy. */
  userSignature?: Uint8Array
  /** Expected slot key epoch for detecting ciphertext-key rotation. */
  ciphertextEpoch?: number
  /** Pin the keeper this request targets (anti-Sybil); an on-chain assigned operator. */
  targetKeykeeper?: string
}

// These two were named `CommitteeSignOptions` / `CommitteeDecryptOptions`, which
// collided with `CommitteeSignOpts` / `CommitteeDecryptOpts` in the main entry -
// four near-identical names for two different layers (these are slot-driven and
// resolve endpoints from chain; the `*Opts` pair is the raw HTTP call). The
// `Slot` prefix says which layer you are in. Aliases kept so the rename is not a
// hard break.

/** Signing options for a registry-discovered committee slot.
 * @deprecated Use SlotCommitteeSignOptions.
 */
export type CommitteeSignOptions = SlotCommitteeSignOptions
/** Decryption options for a registry-discovered committee slot.
 * @deprecated Use SlotCommitteeDecryptOptions.
 */
export type CommitteeDecryptOptions = SlotCommitteeDecryptOptions

/**
 * Slot-based committee operations that discover keepers and verifiers from the chain.
 */
export interface CommitteeSlotClient {
  /** Committee-authorized threshold FROST signature over `message`. */
  sign(slotId: string, message: Uint8Array, opts?: SlotCommitteeSignOptions): Promise<FrostSignResult>
  /**
   * Encrypt to the slot's group key. Local - reads the public key from chain, then
   * does the crypto in-process: no verifier, no JWT, no keeper node, and **no
   * credentials** (a client built with only `{chain}` can call this). BLS
   * (encryption) slots only.
   */
  encrypt(
    slotId: string,
    plaintext: Uint8Array,
    opts?: {identity?: Uint8Array; epoch?: bigint | null},
  ): Promise<Uint8Array>
  /** Committee-authorized threshold decrypt. */
  decrypt(slotId: string, opts: SlotCommitteeDecryptOptions): Promise<Uint8Array>
  /** The resolved active verifier directory (discovered once, then cached). */
  verifierDirectory(): Promise<CommitteeVerifier[]>
}

/**
 * Create registry-discovered threshold signing, encryption and decryption operations. Signing and decryption require holder credentials and proofs against an anchored verifier snapshot. Encryption needs only the public group key read from the chain. The master key is not reconstructed by these threshold operations.
 * @param cfg Chain reader and optional holder credentials and proof callbacks.
 * @returns Committee client whose operations each take a slot ID.
 */
export function createCommitteeSlotClient(cfg: CommitteeSlotClientConfig): CommitteeSlotClient {
  const reads: CommitteeChainReads = committeeChainReadsFromClient(cfg.chain.readers)

  // The credential fields are validated HERE rather than in the constructor: only
  // sign/decrypt present credentials to the committee, while encrypt is a local
  // operation over a public key read from chain. Checking them up front made it
  // impossible to get an encrypt-only handle without credentials - which the
  // crypto never needed.
  function requireCredentials(op: string): {
    holder: string
    credentials: string[]
    holderProof: string | HolderProofPerVerifier
  } {
    const missing: string[] = []
    if (!cfg.holder) missing.push('holder')
    if (!cfg.credentials?.length) missing.push('credentials')
    // `dcqlRule` is not required, and demanding it was wrong:
    // it refused to authorize unless the caller supplied a rule the verifier
    // then ignored. A required input that decides nothing is worse than an
    // unused one - it turns a working call into an error.
    if (!cfg.holderProof) missing.push('holderProof')
    if (missing.length) {
      throw new Error(
        `createCommitteeSlotClient: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} ` +
          `required to authorize ${op} (they prove control of the holder DID to the verifier ` +
          `committee). encrypt() does not need them — it reads the slot's public group key from chain.`,
      )
    }
    return {
      holder: cfg.holder!,
      credentials: cfg.credentials!,
      holderProof: cfg.holderProof!,
    }
  }

  // The verifier set is network-wide (not per-slot), so discover it once and cache.
  let verifiersPromise: Promise<CommitteeVerifier[]> | undefined
  function verifierDirectory(): Promise<CommitteeVerifier[]> {
    return (verifiersPromise ??= resolveVerifierDirectory(cfg.chain))
  }

  async function keeperUrl(slotId: `0x${string}`): Promise<string> {
    const urls = await resolveSlotKeeperUrls(cfg.chain, slotId)
    const url = urls[0]
    if (!url) throw new Error(`no assigned keeper node with a URL for slot ${slotId.slice(0, 10)}…`)
    return url
  }

  // Resolve keeper + verifiers from chain, gather the committee token, and REQUIRE the
  // trustless verifier-set proofs (+ an anchored snapshot) so the keeper never validates
  // against a statically-configured set. Shared by sign + decrypt.
  async function tokenFor(
    slotId: `0x${string}`,
    op: string,
  ): Promise<{res: CommitteeTokenResult; nodeUrl: string}> {
    const creds = requireCredentials(op)
    const [verifiers, nodeUrl] = await Promise.all([verifierDirectory(), keeperUrl(slotId)])
    const res = await requestCommitteeToken({
      chain: reads,
      verifiers,
      slotId,
      // The rule is no longer sent - the verifier fetches the slot's
      // confidential rule from a keeper and hash-verifies it on chain.
      holder: creds.holder,
      credentials: creds.credentials,
      holderProof: creds.holderProof,
      clientSigner: cfg.clientSigner,
      ttlSecs: cfg.ttlSecs,
    })

    // `reads.snapshot` throws when VerifierSetRegistry isn't in the address book, and
    // returns null when no snapshot is anchored (zero root / size 0) - both mean "no
    // trustless source of truth", so treat them the same.
    const snap = reads.snapshot
      ? await reads.snapshot(BigInt(res.epoch)).catch(() => null)
      : null
    if (!snap) {
      throw new Error(
        `no anchored VerifierSetRegistry snapshot at epoch ${res.epoch} — cannot run trustless ` +
          `(the deployment must deploy + anchor the verifier set, and VerifierSetRegistry must be in ` +
          `the address book); refusing to fall back to the keeper's configured set`,
      )
    }
    if (!res.verifierProofs || res.verifierProofs.length !== res.token.signatures.length) {
      throw new Error(
        `trustless verifier-set inclusion proofs are not derivable for every signer ` +
          `(built ${res.verifierProofs?.length ?? 0}/${res.token.signatures.length}); refusing to fall back ` +
          `to the keeper's configured verifier set`,
      )
    }
    return {res, nodeUrl}
  }

  return {
    verifierDirectory,

    async sign(slotId, message, opts) {
      const {res, nodeUrl} = await tokenFor(slotId as `0x${string}`, 'sign()')
      return committeeSign({
        nodeUrl,
        committeeToken: res.token,
        message,
        signingSet: opts?.signingSet,
        userSignature: opts?.userSignature,
        targetKeykeeper: opts?.targetKeykeeper,
        verifierProofs: res.verifierProofs,
        clientPubkey: res.clientPubkey,
        clientSignature: res.clientSignature,
      })
    },

    async encrypt(slotId, plaintext, opts) {
      const id = slotId as `0x${string}`
      const {publicKey, epoch} = await resolveSlotGroupKey(cfg.chain, id)
      const slotIdBytes = hexToBytes(id)
      const identity = opts?.identity ?? slotIdBytes
      const ep = opts?.epoch !== undefined ? opts.epoch : BigInt(epoch)
      return toBytes(
        encryptEnvelope(slotIdBytes, hexToBytes(publicKey), identity, plaintext, ep),
      )
    },

    async decrypt(slotId, opts) {
      const {res, nodeUrl} = await tokenFor(slotId as `0x${string}`, 'decrypt()')
      return committeeDecrypt({
        nodeUrl,
        committeeToken: res.token,
        ciphertext: opts.ciphertext,
        identity: opts.identity,
        decryptingSet: opts.decryptingSet,
        blsPeers: opts.blsPeers,
        userSignature: opts.userSignature,
        ciphertextEpoch: opts.ciphertextEpoch,
        targetKeykeeper: opts.targetKeykeeper,
        verifierProofs: res.verifierProofs,
        clientPubkey: res.clientPubkey,
        clientSignature: res.clientSignature,
      })
    },
  }
}
