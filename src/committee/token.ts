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

import {bytesToHex, hexToBytes} from '../crypto/hex.js'

// Domain separators (must equal the reference constants verbatim)
const SELECT_DOMAIN = new TextEncoder().encode('keykeeper-committee/select/v1')
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
  const parts: Uint8Array[] = [
    TOKEN_DOMAIN,
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
export interface CompoundTokenWire {
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
 */
export function assembleCompoundToken(p: CompoundTokenPayload, signatures: CommitteeSignature[]): CompoundTokenWire {
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
    verifier_indexes: p.verifierIndexes,
    iat: Number(p.iat),
    exp: Number(p.exp),
    signatures: signatures.map(s => ({verifier_index: s.verifierIndex, signature: bytesToHex(s.signature)})),
  }
}

/**
 * Decode a wire compound token into the byte-level payload + signatures for verification.
 *
 * @param w - Keeper JSON token representation to decode into byte fields.
 */
export function decodeCompoundToken(w: CompoundTokenWire): CompoundTokenPayload & {signatures: CommitteeSignature[]} {
  return {
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
    verifierIndexes: w.verifier_indexes,
    iat: w.iat,
    exp: w.exp,
    signatures: w.signatures.map(s => ({verifierIndex: s.verifier_index, signature: hexToBytes(s.signature)})),
  }
}
