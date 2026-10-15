// per-request verifier-committee selection + canonical compound-authorization
// token, the recipient-side (coordinator) counterpart of the reference implementation.
//
// This module is the single source of truth the SDK shares with the verifier (producer) and
// the keykeeper node (reconstructor/validator): the committee draw, the canonical token hash,
// the keeper op-attestation hash, and the verifier-set Merkle leaf must agree BYTE-FOR-BYTE
// with the reference implementation, or authorization silently breaks. `test/committee.conformance.ts` pins
// every value against vectors computed from that crate.
//
// It is pure (no HTTP, no chain) - assembling/verifying a token from already-fetched verifier
// replies + on-chain reads is the caller's job.

import {keccak_256} from '@noble/hashes/sha3'
import {concatBytes} from '@noble/hashes/utils'
import {ed25519} from '@noble/curves/ed25519'
import type {EvidenceBindingWire} from './evidence.js'

import {bytesToHex, hexToBytes} from '../crypto/hex.js'
import {RevocationStatusPreflightError} from '../errors.js'
import {assertPaymentIntentWire, paymentIntentHash, type PaymentIntentWire} from './payment.js'

// Domain separators (must equal the reference constants verbatim)
const SELECT_DOMAIN = new TextEncoder().encode('keykeeper-committee/select/v1')
const PAID_TOKEN_DOMAIN = new TextEncoder().encode('keykeeper-committee/paid-token/v1')
const TOKEN_DOMAIN = new TextEncoder().encode('keykeeper-committee/token/v1')
const OP_ATTEST_DOMAIN = new TextEncoder().encode('keykeeper-committee/op-attest/v1')
const VERIFIER_LEAF_DOMAIN = new TextEncoder().encode('keykeeper-verifier-leaf:v1')

/** Compound authorization token category, used in the signed canonical encoding. */
export type TokenType = 'JWT' | 'refresh'

function discriminant(t: TokenType): number {
  return t === 'JWT' ? 1 : 2
}

// Big-endian integer encoders (mirror the reference big-endian encoders)
function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, n >>> 0, false)
  return b
}

function u64be(n: number | bigint): Uint8Array {
  const b = new Uint8Array(8)
  new DataView(b.buffer).setBigUint64(0, BigInt(n), false)
  return b
}

function i64be(n: number | bigint): Uint8Array {
  const b = new Uint8Array(8)
  new DataView(b.buffer).setBigInt64(0, BigInt(n), false)
  return b
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

// Lexicographic byte comparison (the OpenZeppelin sorted-pair convention).
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x !== y) return x < y ? -1 : 1
  }
  return a.length - b.length
}

// Committee selection (mirrors `select_committee`)

// SECURITY (kill-chain-A fix): the draw takes NO caller-chosen input. It used to hash the
// caller-picked `vpHash`, so a Byzantine verifier coalition ground it offline until the draw
// seated its own keys. It now hashes only pinned (slotId, epoch, seed) - mirrors the reference committee draw.
function drawIndex(slotId: Uint8Array, epoch: number | bigint, seed: Uint8Array, iter: bigint, registrySize: number): number {
  const h = keccak_256(concatBytes(SELECT_DOMAIN, slotId, u64be(epoch), seed, u64be(iter)))
  let lead = 0n
  for (let i = 0; i < 8; i++) lead = (lead << 8n) | BigInt(h[i]!)
  return Number(lead % BigInt(registrySize))
}

/**
 * Deterministically select `count` distinct verifier indexes in `[0, registrySize)` for one
 * request: `index = keccak256(SELECT_DOMAIN || slotId || epoch(u64 BE) || seed || iter(u64 BE)) mod registrySize`,
 * skipping a repeat and incrementing `iter`. Identical, identically-ordered to what the
 * verifier selects and the keeper reconstructs.
 *
 * @param slotId - 32-byte slot identifier.
 * @param epoch - Beacon epoch for the committee draw.
 * @param seed - 32-byte beacon seed for that epoch.
 * @param registrySize - Number of entries in the verifier registry.
 * @param count - Number of distinct verifier indices to select.
 */
export function selectVerifierCommittee(
  slotId: Uint8Array,
  epoch: number | bigint,
  seed: Uint8Array,
  registrySize: number,
  count: number,
): number[] {
  if (registrySize === 0) throw new Error('verifier registry is empty')
  if (count > registrySize) {
    throw new Error(`requested ${count} distinct members from a registry of only ${registrySize}`)
  }
  const selected: number[] = []
  if (count === 0) return selected
  const cap = BigInt(registrySize) * 64n + 1024n
  let iter = 0n
  while (selected.length < count) {
    if (iter >= cap) throw new Error(`selection exhausted: collected ${selected.length} of ${count}`)
    const candidate = drawIndex(slotId, epoch, seed, iter, registrySize)
    if (!selected.includes(candidate)) selected.push(candidate)
    iter += 1n
  }
  return selected
}

// Canonical token hash (mirrors `TokenPayload`)

/** The data the quorum verifiers sign over. All byte fields are 32 bytes unless noted. */
export interface CompoundTokenPayload {
  /** Compound authorization token category. */
  tokenType: TokenType
  /** Beacon seed used for committee selection. */
  seed: Uint8Array
  /** Beacon epoch used for the verifier committee draw. */
  epoch: number | bigint
  /** 32-byte slot identifier. */
  slotId: Uint8Array
  /** Hash of the credential presentation bound into the token. */
  vpHash: Uint8Array
  /** Keccak-256 hash of the authenticated holder identifier. Stable across repeated presentations by the same holder and signed as part of the token. */
  holderHash: Uint8Array
  /** Keccak-256 hash of the raw rule bytes, without salt. This differs from the salted on-chain ruleCommitment. */
  ruleHash: Uint8Array
  /** Keccak-256 hash of the authorized IBE identity. Present only for identity-scoped operations and included in the signed encoding; identity-blind endpoints reject scoped tokens. */
  identityHash?: Uint8Array
  /** Keccak-256 operation-binding hash. Required when keepers enforce request binding; absent only on authorization paths that do not derive it. */
  requestHash?: Uint8Array
  /** Creator payment intent hash; uses a distinct signing domain when present. */
  paymentHash?: Uint8Array
  /** Optional transport preimage. Must match paymentHash; chain backing is checked separately. */
  payment?: PaymentIntentWire
  /**
   * How the holder's key possession was proved. `0x00` = Unbound (no proof),
   * `0x01` = HolderKey (KB-JWT nonce verified), `0x02` = IssuerAsserted (reserved).
   * Always present in the canonical bytes; defaults to `0x00` when omitted.
   */
  binding?: number
  /** Indices of the selected verifier committee. */
  verifierIndexes: number[]
  /** Issue time in Unix seconds. */
  iat: number | bigint
  /** Expiration time in Unix seconds. */
  exp: number | bigint
}

/**
 * Canonical, domain-separated, length-prefixed byte encoding hashed for signing.
 *
 * @param p - Compound token payload, excluding signatures.
 */
export function compoundTokenCanonicalBytes(p: CompoundTokenPayload): Uint8Array {
  if (p.paymentHash !== undefined && p.paymentHash.length !== 32) throw new Error('paymentHash must be 32 bytes')
  if (p.payment !== undefined) {
    assertPaymentIntentWire(p.payment)
    if (!p.paymentHash || paymentIntentHash(p.payment).toLowerCase() !== bytesToHex(p.paymentHash).toLowerCase()) throw new Error('payment preimage differs from paymentHash')
  }
  const parts: Uint8Array[] = [
    ...(p.paymentHash !== undefined ? [PAID_TOKEN_DOMAIN, p.paymentHash] : [TOKEN_DOMAIN]),
    Uint8Array.of(discriminant(p.tokenType)),
    p.seed,
    u64be(p.epoch),
    p.slotId,
    p.vpHash,
    p.holderHash,
    p.ruleHash,
  ]
  // identity binding: an explicit presence byte, then the hash (mirrors the
  // reference encoding - a zero sentinel would make "no identity" and an all-zero hash the
  // same bytes).
  if (p.identityHash === undefined) parts.push(Uint8Array.of(0x00))
  else parts.push(Uint8Array.of(0x01), p.identityHash)
  // request binding: same presence-byte pattern as identityHash.
  if (p.requestHash === undefined) parts.push(Uint8Array.of(0x00))
  else parts.push(Uint8Array.of(0x01), p.requestHash)
  // Binding strength - one byte, always present (0x00 = Unbound, 0x01 = HolderKey).
  parts.push(Uint8Array.of(p.binding ?? 0x00))
  parts.push(u32be(p.verifierIndexes.length))
  for (const idx of p.verifierIndexes) parts.push(u32be(idx))
  parts.push(i64be(p.iat), i64be(p.exp))
  return concatBytes(...parts)
}

/**
 * `keccak256` of the canonical bytes - the value each quorum verifier signs.
 *
 * @param p - Compound token payload, excluding signatures.
 */
export function compoundTokenHash(p: CompoundTokenPayload): Uint8Array {
  return keccak_256(compoundTokenCanonicalBytes(p))
}

// Keeper op-attestation hash (mirrors `op_attestation_hash`)

/**
 * The hash a keeper signs to attest it served `opId` on `slotId` under the token `tokenHash`.
 *
 * @param chainId - EVM chain identifier.
 * @param opId - 32-byte audit operation identifier.
 * @param slotId - 32-byte slot identifier.
 * @param tokenHash - 32-byte compound token hash.
 */
export function opAttestationHash(
  chainId: number | bigint,
  opId: Uint8Array,
  slotId: Uint8Array,
  tokenHash: Uint8Array,
): Uint8Array {
  return keccak_256(concatBytes(OP_ATTEST_DOMAIN, u64be(chainId), opId, slotId, tokenHash))
}

// Client request-binding hash (mirrors `client_binding_hash`)

const CLIENT_BINDING_DOMAIN = new TextEncoder().encode('keykeeper-committee/client-binding/v1')

/**
 * The 32-byte hash the client (== the credential holder) signs to attest it authorized this
 * operation on `slotId` under the compound token whose canonical hash is `tokenHash`:
 * `keccak256(DOMAIN || slotId || tokenHash)`. Byte-identical to the reference `client_binding_hash`, so
 * the keeper (hot path) and accountant (audit) verify the client signature over the same bytes.
 *
 * @param slotId - 32-byte slot identifier.
 * @param tokenHash - 32-byte compound token hash.
 */
export function clientBindingHash(slotId: Uint8Array, tokenHash: Uint8Array): Uint8Array {
  return keccak_256(concatBytes(CLIENT_BINDING_DOMAIN, slotId, tokenHash))
}

// Verifier-set Merkle leaf + proof (mirrors `verifier_leaf`)

/**
 * `keccak256(DOMAIN || index(u32 BE) || operator(20) || keccak256(pubkey))` - matches the on-chain leaf.
 *
 * @param index - Zero-based verifier registry index.
 * @param operator - 20-byte operator address.
 * @param pubkey - 32-byte Ed25519 verifier public key.
 */
export function verifierLeaf(index: number, operator: Uint8Array, pubkey: Uint8Array): Uint8Array {
  return keccak_256(concatBytes(VERIFIER_LEAF_DOMAIN, u32be(index), operator, keccak_256(pubkey)))
}

function hashPair(a: Uint8Array, b: Uint8Array): Uint8Array {
  return compareBytes(a, b) <= 0 ? keccak_256(concatBytes(a, b)) : keccak_256(concatBytes(b, a))
}

/**
 * Verify a sorted-pair keccak Merkle inclusion proof (leaf to root).
 *
 * @param leaf - Leaf hash to prove.
 * @param proof - Sibling hashes ordered from the leaf toward the root.
 * @param root - Expected Merkle root.
 */
export function verifyMerkleProof(leaf: Uint8Array, proof: Uint8Array[], root: Uint8Array): boolean {
  let computed = leaf
  for (const sib of proof) computed = hashPair(computed, sib)
  return bytesEqual(computed, root)
}

// One level up the sorted-pair tree; an odd trailing node is promoted unchanged
// (mirrors the reference `next_level`).
function nextLevel(level: Uint8Array[]): Uint8Array[] {
  const next: Uint8Array[] = []
  for (let i = 0; i < level.length; i += 2) {
    if (i + 1 < level.length) next.push(hashPair(level[i]!, level[i + 1]!))
    else next.push(level[i]!)
  }
  return next
}

/**
 * Build the Merkle root over `leaves` (sorted-pair; an odd node is promoted unchanged to the
 * next level). `null` for an empty set. Byte-identical to the reference `merkle_root`, so a root
 * built here matches the on-chain `VerifierSetRegistry`/`Settlement` anchored root.
 *
 * @param leaves - Ordered Merkle leaf hashes.
 */
export function merkleRoot(leaves: Uint8Array[]): Uint8Array | null {
  if (leaves.length === 0) return null
  let level = leaves.slice()
  while (level.length > 1) level = nextLevel(level)
  return level[0]!
}

/**
 * The inclusion proof (sibling hashes, leaf to root) for `index` in `leaves`. `null` if `index`
 * is out of range. Mirrors the reference `merkle_proof`; pairs with [`verifyMerkleProof`].
 *
 * @param leaves - Ordered Merkle leaf hashes.
 * @param index - Zero-based index of the leaf to prove.
 */
export function merkleProof(leaves: Uint8Array[], index: number): Uint8Array[] | null {
  if (index < 0 || index >= leaves.length) return null
  const proof: Uint8Array[] = []
  let level = leaves.slice()
  let idx = index
  while (level.length > 1) {
    if (idx % 2 === 1) proof.push(level[idx - 1]!)
    else if (idx + 1 < level.length) proof.push(level[idx + 1]!)
    level = nextLevel(level)
    idx = Math.floor(idx / 2)
  }
  return proof
}

// Quorum + compound-token verification (mirrors `verify_compound`)

/** One verifier's signature within a compound token. */
export interface CommitteeSignature {
  /** Zero-based verifier registry index. */
  verifierIndex: number
  /** Raw Ed25519 verifier signature. */
  signature: Uint8Array
}

/** The active verifier set: registry size + index to Ed25519 public key (32 bytes). */
export interface VerifierSet {
  /** Number of entries in the verifier registry. */
  registrySize: number
  /** Registry index to authenticated Ed25519 public key mapping. */
  pubkeys: Map<number, Uint8Array>
}

/** What a valid compound token attests. */
export interface VerifiedToken {
  /** Creator payment commitment authenticated by the verifier quorum, when present. */
  paymentHash?: Uint8Array
  /** 32-byte slot identifier. */
  slotId: Uint8Array
  /** Hash of the credential presentation bound into the token. */
  vpHash: Uint8Array
  /** The holder a quorum attested - the value a distinctness rule keys on. */
  holderHash: Uint8Array
  /** the quorum-attested identity binding - present iff the token is scoped. */
  identityHash?: Uint8Array
  /** Beacon epoch used for the verifier committee draw. */
  epoch: number | bigint
  /** Compound authorization token category. */
  tokenType: TokenType
  /** Indices of the distinct verifier signatures that passed verification. */
  verifiedSigners: number[]
}

function quorumSatisfied(signers: number[], expected: number[], quorum: number): boolean {
  const exp = new Set(expected)
  const distinct = new Set<number>()
  for (const s of signers) {
    if (!exp.has(s)) return false
    distinct.add(s)
  }
  return distinct.size >= quorum
}

/** Compound token, trusted verifier set, expected rule binding and freshness constraints. */
export interface VerifyCompoundTokenOptions {
  /** The decoded token, signatures included (see `decodeCompoundToken`). */
  token: CompoundTokenPayload & {signatures: CommitteeSignature[]}
  /** The active verifier set to verify signatures against. */
  set: VerifierSet
  /** Committee size - how many verifiers the on-chain draw selects. */
  committee: number
  /** Minimum co-signatures required *from the drawn committee*. */
  quorum: number
  /** Current time, UNIX **seconds**. */
  now: number
  /** Clock-skew tolerance, **seconds**, applied to both `iat` and `exp`. */
  leeway: number
  /** Expected Keccak-256 hash of the raw rule bytes, without salt. Do not supply the on-chain salted ruleCommitment. */
  slotRuleHash: Uint8Array
}

/**
 * Verify rule binding, committee selection, token lifetime, Ed25519 signatures and quorum against the supplied verifier set.
 *
 * @param opts - Decoded token and independently established verifier, rule and time constraints.
 * @returns Fields attested by the verified committee token.
 * @throws If any binding, freshness, signer or quorum check fails.
 */
export function verifyCompoundToken(opts: VerifyCompoundTokenOptions): VerifiedToken {
  const {token, set, committee, quorum, now, leeway, slotRuleHash} = opts
  if (!bytesEqual(token.ruleHash, slotRuleHash)) throw new Error('token rule_hash does not match the slot rule hash')

  const expected = selectVerifierCommittee(token.slotId, token.epoch, token.seed, set.registrySize, committee)
  if (token.verifierIndexes.length !== expected.length || token.verifierIndexes.some((v, i) => v !== expected[i])) {
    throw new Error('token committee is not the expected draw')
  }

  if (now > Number(token.exp) + leeway) throw new Error('token expired')
  if (now + leeway < Number(token.iat)) throw new Error('token not yet valid')

  const hash = compoundTokenHash(token)
  const verified: number[] = []
  for (const {verifierIndex, signature} of token.signatures) {
    const pk = set.pubkeys.get(verifierIndex)
    if (!pk) throw new Error(`signer index ${verifierIndex} is not in the active verifier set`)
    if (!ed25519.verify(signature, hash, pk)) throw new Error(`invalid signature from verifier index ${verifierIndex}`)
    if (!verified.includes(verifierIndex)) verified.push(verifierIndex)
  }

  if (!quorumSatisfied(verified, expected, quorum)) {
    throw new Error(`quorum not met: ${verified.length} of the drawn committee signed, need ${quorum}`)
  }

  return {
    slotId: token.slotId,
    vpHash: token.vpHash,
    holderHash: token.holderHash,
    // Attested, not merely transported: inside the signed bytes, so it survives only if
    // every signature verified over it.
    ...(token.identityHash !== undefined ? {identityHash: token.identityHash} : {}),
    epoch: token.epoch,
    tokenType: token.tokenType,
    ...(token.paymentHash !== undefined ? {paymentHash: token.paymentHash} : {}),
    verifiedSigners: verified,
  }
}

// Wire (de)serialization - the JSON shape the verifier/keeper exchange

/** One verifier's signature on the wire (hex). */
export interface CommitteeSignatureWire {
  /** Zero-based verifier registry index. */
  verifier_index: number
  /** Hexadecimal Ed25519 verifier signature. */
  signature: string
}

/** The compound token JSON a client submits with `/v1/committee/{sign,decrypt}`. */
export interface CompoundTokenWire extends EvidenceBindingWire {
  /** Compound authorization token category. */
  token_type: TokenType
  /** Hexadecimal beacon seed. */
  seed: string
  /** Beacon epoch used for the verifier committee draw. */
  epoch: number
  /** Hexadecimal 32-byte slot identifier. */
  slot_id: string
  /** Hexadecimal hash of the credential presentation. */
  vp_hash: string
  /** Hexadecimal hash of the authenticated holder identifier. */
  holder_hash: string
  /** `keccak256` of the RAW rule (UNSALTED) - the counterpart of `DualControlPolicy.ruleHash`,
   *  never the salted `KeySlot.ruleCommitment`. */
  rule_hash: string
  /** `0x..` identity binding - present iff the token is identity-scoped. */
  identity_hash?: string
  /** `0x..` request binding hash - present when minted via the verifier-agent flow. */
  request_hash?: string
  /** Creator payment-intent hash, attested by the verifier quorum. */
  payment_hash?: string
  /** Creator-signed intent carried to keepers for independent reservation checks. */
  payment?: PaymentIntentWire
  /** `"unbound"` | `"holder_key"` | `"issuer_asserted"`. */
  binding?: string
  /** Indices of the selected verifier committee. */
  verifier_indexes: number[]
  /** Issue time in Unix seconds. */
  iat: number
  /** Expiration time in Unix seconds. */
  exp: number
  /** Hexadecimal verifier signatures and their registry indices. */
  signatures: CommitteeSignatureWire[]
  /**
   * Revocation-status freshness attestations (`keykeeper/committee-status-attestation/v1`),
   * one per drawn verifier that vouched. OUTSIDE the signed token bytes: it never moves the
   * token hash. Keepers in production posture require a quorum of fresh ones.
   */
  status_attestations?: StatusAttestationWire[]
  // The sealed-evidence fields (`evidence_hash`, `evidence_key_id`, `evidence_signatures`) are
  // inherited from EvidenceBindingWire: present together or not at all, OUTSIDE the signed
  // canonical bytes; each signer's {@link evidenceBindingMessage} signature binds them.
}

// Sealed committee evidence binding

const EVIDENCE_BINDING_DOMAIN = new TextEncoder().encode('keykeeper-committee/evidence-binding/v1')

/** `keccak256(DOMAIN ‖ tokenHash ‖ evidenceHash ‖ evidenceKeyId)` — the message each drawn
 *  verifier signs beside its token signature. Byte-identical to the Rust
 *  `keykeeper_committee::evidence_binding_message`. The SDK's own sealed-evidence path
 *  (`./evidence.ts`) signs and verifies over this same function.
 *
 * @param tokenHash - 32-byte compound-token signing hash.
 * @param evidenceHash - 32-byte keccak256 of the sealed evidence ciphertext.
 * @param evidenceKeyId - 32-byte keccak256 of the accountant evidence key it is sealed to.
 */
export function evidenceBindingMessage(tokenHash: Uint8Array, evidenceHash: Uint8Array, evidenceKeyId: Uint8Array): Uint8Array {
  for (const [n, v] of [['tokenHash', tokenHash], ['evidenceHash', evidenceHash], ['evidenceKeyId', evidenceKeyId]] as const) {
    if (v.length !== 32) throw new Error(`${n} must be 32 bytes`)
  }
  return keccak_256(concatBytes(EVIDENCE_BINDING_DOMAIN, tokenHash, evidenceHash, evidenceKeyId))
}

/** Inputs to {@link verifyEvidenceBinding}. */
export interface VerifyEvidenceBindingOptions {
  /** 32-byte compound-token signing hash. */
  tokenHash: Uint8Array
  /** 32-byte keccak256 of the sealed evidence ciphertext. */
  evidenceHash: Uint8Array
  /** 32-byte keccak256 of the accountant evidence key it is sealed to. */
  evidenceKeyId: Uint8Array
  /** Each signer's evidence-binding signature, by verifier index. */
  signatures: CommitteeSignature[]
  /** The anchored verifier set the signer keys are read from. */
  set: VerifierSet
  /** The drawn committee (the token's `verifier_indexes`). */
  drawn: number[]
  /** How many distinct drawn signers must verify. */
  quorum: number
}

/**
 * Mirror of the Rust `verify_evidence_binding`: every signature must come from a DRAWN
 * verifier in `set` and verify (strict, non-ZIP-215) over {@link evidenceBindingMessage};
 * distinct signers are counted once and must satisfy `quorum` of the drawn committee.
 * Throws on any failure; returns the verified indexes.
 *
 * @param opts - Token and evidence hashes, the signatures, the verifier set, the drawn committee and the quorum.
 */
const isU32 = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= 0xffff_ffff

export function verifyEvidenceBinding(opts: VerifyEvidenceBindingOptions): number[] {
  const {tokenHash, evidenceHash, evidenceKeyId, signatures, set, drawn, quorum} = opts
  // Rust takes `quorum: u32` and `u32` indexes; a JS number does not, so the bounds are checked
  // here. A negative or NaN quorum would otherwise be met by zero signatures.
  if (!isU32(quorum) || quorum === 0) throw new Error('evidence binding: quorum must be a positive 32-bit integer')
  if (!Array.isArray(drawn) || !drawn.every(isU32)) throw new Error('evidence binding: drawn committee must be 32-bit indexes')
  if (!Array.isArray(signatures)) throw new Error('evidence binding: signatures must be a list')
  const msg = evidenceBindingMessage(tokenHash, evidenceHash, evidenceKeyId)
  const verified: number[] = []
  for (const {verifierIndex, signature} of signatures) {
    if (!isU32(verifierIndex)) throw new Error('evidence binding: verifier index must be a 32-bit integer')
    if (!(signature instanceof Uint8Array) || signature.length !== 64) throw new Error(`evidence binding: signature from verifier index ${verifierIndex} must be 64 bytes`)
    if (!drawn.includes(verifierIndex)) throw new Error(`evidence binding: index ${verifierIndex} is not in the drawn committee`)
    const pk = set.pubkeys.get(verifierIndex)
    if (!pk) throw new Error(`evidence binding: index ${verifierIndex} is not in the verifier set`)
    if (!ed25519.verify(signature, msg, pk, {zip215: false})) throw new Error(`evidence binding: invalid signature from verifier index ${verifierIndex}`)
    if (!verified.includes(verifierIndex)) verified.push(verifierIndex)
  }
  if (!quorumSatisfied(verified, drawn, quorum)) {
    throw new Error(`evidence binding: quorum not met: ${verified.length} of the drawn committee, need ${quorum}`)
  }
  return verified
}

/** Assemble the wire compound token from a payload + the gathered quorum signatures. */
/** binding strengths: `0x00` Unbound, `0x01` HolderKey (KB-JWT / holder proof verified), `0x02` IssuerAsserted. */
export const BINDING_UNBOUND = 0x00
export const BINDING_HOLDER_KEY = 0x01
export const BINDING_ISSUER_ASSERTED = 0x02
const BINDING_NAMES: Record<number, string> = {0x00: 'unbound', 0x01: 'holder_key', 0x02: 'issuer_asserted'}
export function bindingToWire(b: number | undefined): string | undefined {
  if (b === undefined || b === 0x00) return undefined
  return BINDING_NAMES[b] ?? `unknown_${b}`
}
export function bindingFromWire(s: string | undefined): number {
  if (s === undefined || s === 'unbound') return 0x00
  if (s === 'holder_key') return 0x01
  if (s === 'issuer_asserted') return 0x02
  return 0x00
}

/**
 * Encode a token payload and verifier signatures into the keeper JSON wire format. This does not verify signatures.
 *
 * @param p - Compound token payload, excluding signatures.
 * @param signatures - Verifier signatures to include in the wire object.
 * @param statusAttestations - Optional revocation-status attestations, carried beside the signatures and never hashed. Validated strictly; an empty list is omitted.
 */
export function assembleCompoundToken(
  p: CompoundTokenPayload,
  signatures: CommitteeSignature[],
  statusAttestations?: StatusAttestation[],
): CompoundTokenWire {
  compoundTokenCanonicalBytes(p)
  const attestations = statusAttestations?.length
    ? assertStatusAttestationsWire(statusAttestations.map(statusAttestationToWire), p.verifierIndexes.length)
    : undefined
  return {
    token_type: p.tokenType,
    seed: bytesToHex(p.seed),
    epoch: Number(p.epoch),
    slot_id: bytesToHex(p.slotId),
    vp_hash: bytesToHex(p.vpHash),
    holder_hash: bytesToHex(p.holderHash),
    rule_hash: bytesToHex(p.ruleHash),
    ...(p.identityHash !== undefined ? {identity_hash: bytesToHex(p.identityHash)} : {}),
    ...(p.requestHash !== undefined ? {request_hash: bytesToHex(p.requestHash)} : {}),
    ...(bindingToWire(p.binding) !== undefined ? {binding: bindingToWire(p.binding)} : {}),
    ...(p.paymentHash !== undefined ? {payment_hash: bytesToHex(p.paymentHash)} : {}),
    ...(p.payment !== undefined ? {payment: p.payment} : {}),
    verifier_indexes: p.verifierIndexes,
    iat: Number(p.iat),
    exp: Number(p.exp),
    signatures: signatures.map(s => ({verifier_index: s.verifierIndex, signature: bytesToHex(s.signature)})),
    ...(attestations !== undefined ? {status_attestations: attestations} : {}),
  }
}

/**
 * Decode a wire compound token into the byte-level payload + signatures for verification.
 *
 * @param w - Keeper JSON token representation to decode into byte fields.
 */
export function decodeCompoundToken(
  w: CompoundTokenWire,
): CompoundTokenPayload & {signatures: CommitteeSignature[]; statusAttestations?: StatusAttestation[]} {
  // Validated, never hashed: the attestations sit beside the signed bytes.
  const attestations = w.status_attestations == null
    ? undefined
    : assertStatusAttestationsWire(w.status_attestations, w.verifier_indexes.length).map(statusAttestationFromWire)
  const result = {
    tokenType: w.token_type,
    seed: hexToBytes(w.seed),
    epoch: w.epoch,
    slotId: hexToBytes(w.slot_id),
    vpHash: hexToBytes(w.vp_hash),
    holderHash: hexToBytes(w.holder_hash),
    ruleHash: hexToBytes(w.rule_hash),
    ...(w.identity_hash !== undefined ? {identityHash: hexToBytes(w.identity_hash)} : {}),
    ...(w.request_hash !== undefined ? {requestHash: hexToBytes(w.request_hash)} : {}),
    binding: bindingFromWire(w.binding),
    ...(w.payment_hash != null ? {paymentHash: hexToBytes(w.payment_hash)} : {}),
    ...(w.payment != null ? {payment: w.payment} : {}),
    verifierIndexes: w.verifier_indexes,
    iat: w.iat,
    exp: w.exp,
    signatures: w.signatures.map(s => ({verifierIndex: s.verifier_index, signature: hexToBytes(s.signature)})),
    ...(attestations !== undefined ? {statusAttestations: attestations} : {}),
  }
  compoundTokenCanonicalBytes(result)
  return result
}

// Revocation-status freshness (mirrors `keykeeper_committee::status_attestation`)
//
// A drawn verifier signs, beside its token signature, a SEPARATE statement that the holder's
// credential status it relied on was fresh until `status_until`:
//
//   keccak256("keykeeper/committee-status-attestation/v1" || token_hash(32)
//             || verifier_index(u32 BE) || status_until(i64 BE))
//
// with the same Ed25519 committee key. Keepers accept the grant while
// `now <= status_until + STATUS_SKEW_SECS` for a quorum of counted verifiers. The statement is
// NOT part of the token payload: the canonical bytes, the token hash and the pinned
// `committee-token-vectors.json` are unchanged.

const STATUS_ATTESTATION_DOMAIN_BYTES = new TextEncoder().encode('keykeeper/committee-status-attestation/v1')

/** Domain separator of the status-freshness statement (new name, `/v1`). */
export const STATUS_ATTESTATION_DOMAIN = 'keykeeper/committee-status-attestation/v1'
/** Decided revocation bound: no keeper accepts a grant later than `R + 60 s`. */
export const REVOCATION_BOUND_SECS = 60
/** The only skew a keeper allows past `status_until` (reserved inside the 60 s bound). */
export const STATUS_SKEW_SECS = 5
/** The verifier's attestation cache bound: `REVOCATION_BOUND_SECS - STATUS_SKEW_SECS`. */
export const STATUS_CACHE_BOUND_SECS = REVOCATION_BOUND_SECS - STATUS_SKEW_SECS
/** Longest usable window a verifier may attest (`55 - 10`). */
export const MAX_STATUS_WINDOW_SECS = 45
/** Default attested window (`[committee] status_window_secs`). */
export const DEFAULT_STATUS_WINDOW_SECS = 30
/** Most attestations one token may carry (mirrors the keeper cap). */
export const MAX_STATUS_ATTESTATIONS = 64
/** Stable keeper refusal code: attestations present but fewer than a quorum valid and fresh. */
export const STATUS_STALE_CODE = 'revocation_status_stale'
/** Stable keeper refusal code: the keeper requires attestations and the grant carries none. */
export const STATUS_MISSING_CODE = 'revocation_status_missing'
/**
 * Stable client preflight code: attestations are present but malformed, duplicated, over the cap
 * or carry a bad signature from a counted verifier (a keeper refuses these without a stable code).
 */
export const STATUS_INVALID_CODE = 'revocation_status_invalid'

const invalidStatus = (message: string) => new RevocationStatusPreflightError({code: STATUS_INVALID_CODE, message})

/** One decoded status-freshness attestation. */
export interface StatusAttestation {
  /** Zero-based verifier registry index (u32). */
  verifierIndex: number
  /** Unix seconds until which this verifier vouches for the holder's credential status. */
  statusUntil: number
  /** 64-byte Ed25519 signature over {@link statusAttestationHash}. */
  signature: Uint8Array
}

/** One status attestation on the wire - exactly these three keys. */
export interface StatusAttestationWire {
  /** Zero-based verifier registry index (u32). */
  verifier_index: number
  /** Unix seconds (i64, a JavaScript safe integer). */
  status_until: number
  /** `0x` + 128 hex characters: the 64-byte Ed25519 signature. */
  signature: string
}

const SIGNATURE_HEX = /^0x[0-9a-fA-F]{128}$/
const U32_MAX = 0xffff_ffff

function statusAttestationToWire(a: StatusAttestation): StatusAttestationWire {
  return {verifier_index: a.verifierIndex, status_until: a.statusUntil, signature: bytesToHex(a.signature)}
}

function statusAttestationFromWire(w: StatusAttestationWire): StatusAttestation {
  return {verifierIndex: w.verifier_index, statusUntil: w.status_until, signature: hexToBytes(w.signature)}
}

function assertAttestationInputs(tokenHash: Uint8Array, verifierIndex: number, statusUntil: number): void {
  if (!(tokenHash instanceof Uint8Array) || tokenHash.length !== 32) throw new Error('status attestation token hash must be 32 bytes')
  if (!Number.isSafeInteger(verifierIndex) || verifierIndex < 0 || verifierIndex > U32_MAX) throw new Error('status attestation verifier_index must be a u32')
  if (!Number.isSafeInteger(statusUntil)) throw new Error('status attestation status_until must be a safe integer')
}

/**
 * The 32-byte digest a drawn verifier signs to attest credential-status freshness for one token:
 * `keccak256(DOMAIN || tokenHash || verifierIndex(u32 BE) || statusUntil(i64 BE))`.
 * Byte-identical to the reference `status_attestation_hash`.
 *
 * @param tokenHash - 32-byte compound token hash ({@link compoundTokenHash}).
 * @param verifierIndex - Zero-based verifier registry index.
 * @param statusUntil - Unix seconds the verifier vouches until.
 */
export function statusAttestationHash(tokenHash: Uint8Array, verifierIndex: number, statusUntil: number): Uint8Array {
  assertAttestationInputs(tokenHash, verifierIndex, statusUntil)
  return keccak_256(concatBytes(STATUS_ATTESTATION_DOMAIN_BYTES, tokenHash, u32be(verifierIndex), i64be(statusUntil)))
}

/**
 * Verify ONE attestation's Ed25519 signature under the verifier's committee key over `tokenHash`
 * (no freshness, no quorum) - what a relay checks before forwarding it.
 *
 * @param pubkey - 32-byte Ed25519 committee public key of `attestation.verifierIndex`.
 * @param tokenHash - 32-byte compound token hash.
 * @param attestation - Decoded attestation.
 * @returns Whether the signature verifies (strict: non-canonical encodings refused).
 */
export function verifyStatusAttestation(pubkey: Uint8Array, tokenHash: Uint8Array, attestation: StatusAttestation): boolean {
  try {
    if (pubkey.length !== 32 || attestation.signature.length !== 64) return false
    const digest = statusAttestationHash(tokenHash, attestation.verifierIndex, attestation.statusUntil)
    return ed25519.verify(attestation.signature, digest, pubkey, {zip215: false})
  } catch {
    return false
  }
}

/** Inputs of {@link verifyStatusAttestations}, as a keeper checks them. */
export interface VerifyStatusAttestationsOptions {
  /** The token's canonical hash (already verified by the caller). */
  tokenHash: Uint8Array
  /** The token's attestations. */
  attestations: StatusAttestation[]
  /** Verifier indexes whose TOKEN signature verified (and that still stand). Others are ignored. */
  counted: number[]
  /** Active verifier set the token signatures were verified against. */
  set: VerifierSet
  /** The token's quorum. */
  quorum: number
  /** Current time, Unix seconds. */
  now: number
}

/**
 * Verify a token's status attestations exactly as a keeper does and return the effective status
 * deadline (the quorum-th largest attested `status_until`). Throws on a duplicate index, an
 * oversize list, a bad signature from a counted verifier, or fewer than `quorum` attestations
 * fresh at `now` (`now <= status_until + STATUS_SKEW_SECS`; the token leeway is NOT applied).
 *
 * @param opts - Token hash, attestations, counted signers, verifier set, quorum and time.
 */
export function verifyStatusAttestations(opts: VerifyStatusAttestationsOptions): number {
  const {tokenHash, attestations, counted, set, quorum, now} = opts
  if (attestations.length > MAX_STATUS_ATTESTATIONS) throw invalidStatus(`more than ${MAX_STATUS_ATTESTATIONS} status attestations`)
  const seen = new Set<number>(), valid: number[] = []
  for (const a of attestations) {
    if (seen.has(a.verifierIndex)) throw invalidStatus(`duplicate status attestation from verifier index ${a.verifierIndex}`)
    seen.add(a.verifierIndex)
    if (!counted.includes(a.verifierIndex)) continue
    const pk = set.pubkeys.get(a.verifierIndex)
    if (!pk || !verifyStatusAttestation(pk, tokenHash, a)) throw invalidStatus(`invalid status attestation signature from verifier index ${a.verifierIndex}`)
    valid.push(a.statusUntil)
  }
  valid.sort((a, b) => b - a)
  const needed = Math.max(1, quorum)
  const deadline = valid[needed - 1]
  if (deadline !== undefined && now <= deadline + STATUS_SKEW_SECS) return deadline
  const fresh = valid.filter(until => now <= until + STATUS_SKEW_SECS).length
  throw new RevocationStatusPreflightError({code: STATUS_STALE_CODE,
    message: `revocation status freshness (${STATUS_STALE_CODE}): ${fresh} of the token's verifiers attest the holder's credential status fresh at ${now}, need ${quorum}; present again for a fresh grant`})
}

/**
 * The registry indexes whose Ed25519 signature over the token's own canonical hash verifies under
 * `set` (strict), distinct and drawn. Mirrors the reference `signers_that_verify`: no rule, draw,
 * lifetime or quorum check - only "which signatures are real", for counting status attestations.
 *
 * @param token - Decoded token (payload + signatures).
 * @param set - Anchored verifier keys.
 */
export function signersThatVerify(token: CompoundTokenPayload & {signatures: CommitteeSignature[]}, set: VerifierSet): number[] {
  const hash = compoundTokenHash(token), out: number[] = []
  for (const {verifierIndex, signature} of token.signatures) {
    const pk = set.pubkeys.get(verifierIndex)
    if (!pk || out.includes(verifierIndex) || !token.verifierIndexes.includes(verifierIndex)) continue
    try { if (ed25519.verify(signature, hash, pk, {zip215: false})) out.push(verifierIndex) } catch { /* not counted */ }
  }
  return out
}

/** Inputs of {@link requireStatusAttestations}. */
export interface RequireStatusAttestationsOptions extends Omit<VerifyStatusAttestationsOptions, 'attestations'> {
  /** The token's attestations; `undefined` or empty means missing (as a keeper reads it). */
  attestations: StatusAttestation[] | undefined
  /**
   * Accept a grant WITHOUT attestations (warning), for a deployment still inside the keepers'
   * documented status-freshness migration window. Default false. Present-but-invalid or stale
   * attestations are refused whatever this says.
   */
  allowMissing?: boolean
}

/** Accepted preflight outcome. */
export type StatusFreshness =
  | {
    /** A quorum attests freshness. */
    kind: 'fresh'
    /** Effective status deadline (Unix seconds). */
    statusUntil: number
  }
  | {
    /** No attestations, accepted only under the migration opt-out. */
    kind: 'missing-accepted'
  }

/**
 * The keeper's status-freshness rule as a REQUIRED client preflight, run before any keeper call:
 * a missing list throws `revocation_status_missing` (unless `allowMissing`), fewer than `quorum`
 * fresh counted attestations `revocation_status_stale`, a malformed or forged list
 * `revocation_status_invalid` - each a {@link RevocationStatusPreflightError}.
 *
 * @param opts - Token hash, attestations, counted signers, verifier set, quorum, time and opt-out.
 */
export function requireStatusAttestations(opts: RequireStatusAttestationsOptions): StatusFreshness {
  const {attestations, allowMissing, ...rest} = opts
  if (attestations === undefined || attestations.length === 0) {
    if (allowMissing === true) {
      console.warn(`${STATUS_MISSING_CODE} accepted by allowMissingStatusAttestations; a keeper outside its migration window will refuse this grant`)
      return {kind: 'missing-accepted'}
    }
    throw new RevocationStatusPreflightError({code: STATUS_MISSING_CODE,
      message: `revocation status freshness (${STATUS_MISSING_CODE}): the grant carries no revocation-status attestations; nothing was sent - present again for a fresh grant`})
  }
  return {kind: 'fresh', statusUntil: verifyStatusAttestations({...rest, attestations})}
}

/**
 * Strictly validate an untrusted `status_attestations` value: an array of at most
 * `maxEntries` (and {@link MAX_STATUS_ATTESTATIONS}) objects with EXACTLY
 * `{verifier_index: u32, status_until: safe integer, signature: "0x" + 128 hex}` and distinct
 * indexes. Returns a fresh copy (the value a keeper receives unchanged).
 *
 * @param raw - Untrusted wire value.
 * @param maxEntries - Upper bound, normally the token's committee draw length.
 */
export function assertStatusAttestationsWire(raw: unknown, maxEntries: number = MAX_STATUS_ATTESTATIONS): StatusAttestationWire[] {
  if (!Array.isArray(raw)) throw invalidStatus('status_attestations is not an array')
  if (raw.length > Math.min(maxEntries, MAX_STATUS_ATTESTATIONS)) throw invalidStatus('status_attestations exceeds the committee draw')
  const seen = new Set<number>()
  return raw.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw invalidStatus('a status attestation is not an object')
    const e = entry as Record<string, unknown>
    const keys = Object.keys(e)
    if (keys.length !== 3 || !['verifier_index', 'status_until', 'signature'].every(k => Object.hasOwn(e, k))) {
      throw invalidStatus('a status attestation is not exactly {verifier_index, status_until, signature}')
    }
    const index = e.verifier_index, until = e.status_until, signature = e.signature
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index > U32_MAX) throw invalidStatus('status attestation verifier_index is not a u32')
    if (typeof until !== 'number' || !Number.isSafeInteger(until)) throw invalidStatus('status attestation status_until is not a safe integer')
    if (typeof signature !== 'string' || !SIGNATURE_HEX.test(signature)) throw invalidStatus('status attestation signature is not 0x + 64 bytes of hex')
    if (seen.has(index)) throw invalidStatus(`duplicate status attestation from verifier index ${index}`)
    seen.add(index)
    return {verifier_index: index, status_until: until, signature}
  })
}
