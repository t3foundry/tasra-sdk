// Threshold BLS on BN254: the accountant authorization root (ADR-0090 debit vouchers).
//
// Keys in G2, signatures in G1, `sigma = s * H(digest)`, partials Lagrange-combined at zero: the
// scheme of `keykeeper-bls::bn254::sign`. Every field and group operation is @noble/curves'
// (`bn254`, `bn254_Fr`); nothing here does modular arithmetic by hand.
//
// Two encodings are cross-language contracts, not standards, and both are pinned by vectors:
// - hash-to-G1 is try-and-increment over `keccak256(digest || uint256(i))`, `x mod p`, with the
//   square root `(y^2)^((p+1)/4)` (a library sqrt may return the OTHER root, which still lies on
//   the curve and would only disagree with the Solidity verifier);
// - points are the bare EVM encodings: G1 `x || y`, G2 imaginary part first `x_c1 || x_c0 || y_c1 || y_c0`.
//
// ~100-bit security; never reuse for user data (KEM/IBE stay BLS12-381).

import {bn254, bn254_Fr} from '@noble/curves/bn254'
import {keccak_256} from '@noble/hashes/sha3'
import {bytesToNumberBE, numberToBytesBE} from '@noble/curves/utils.js'

const Fp = bn254.fields.Fp, Fp2 = bn254.fields.Fp2, Fp12 = bn254.fields.Fp12
const G1 = bn254.G1.ProjectivePoint, G2 = bn254.G2.ProjectivePoint
type G1Point = InstanceType<typeof G1>
type G2Point = InstanceType<typeof G2>
/** Matches the Solidity loop bound: both implementations fail on the same inputs. */
const MAX_HASH_ATTEMPTS = 256
const SQRT_EXPONENT = (Fp.ORDER + 1n) / 4n

/** A BN254 encoding or verification failure; `reason` names the operand. */
export class Bn254Error extends Error {
  constructor(message: string) { super(message); this.name = 'Bn254Error' }
}

function fq(bytes: Uint8Array): bigint {
  const value = bytesToNumberBE(bytes)
  // Canonical only: a value >= p would be a different encoding of a reduced point, which the
  // precompile refuses. Decoding must not reduce.
  if (value >= Fp.ORDER) throw new Error('non-canonical BN254 field element')
  return value
}

/**
 * Map a 32-byte digest to G1 exactly as the Solidity verifier and the Rust signer do.
 * @param digest - 32-byte message digest.
 */
export function hashToG1(digest: Uint8Array): G1Point {
  if (digest.length !== 32) throw new Bn254Error('hash-to-G1 takes a 32-byte digest')
  const preimage = new Uint8Array(64)
  preimage.set(digest)
  for (let i = 0; i < MAX_HASH_ATTEMPTS; i++) {
    preimage.set(numberToBytesBE(BigInt(i), 32), 32)
    const x = Fp.create(bytesToNumberBE(keccak_256(preimage)))
    const y2 = Fp.add(Fp.mul(Fp.sqr(x), x), 3n)
    const y = Fp.pow(y2, SQRT_EXPONENT)
    if (Fp.eql(Fp.sqr(y), y2)) return G1.fromAffine({x, y})
  }
  throw new Bn254Error(`hash-to-G1 did not converge in ${MAX_HASH_ATTEMPTS} attempts`)
}

/**
 * Decode a 64-byte `x || y` G1 point; all-zero is infinity (the EVM spelling), returned as ZERO.
 * @param bytes - 64-byte EVM encoding.
 */
export function decodeG1(bytes: Uint8Array): G1Point {
  if (bytes.length !== 64) throw new Bn254Error('G1 point must be 64 bytes')
  if (bytes.every(b => b === 0)) return G1.ZERO
  try {
    const point = G1.fromAffine({x: fq(bytes.subarray(0, 32)), y: fq(bytes.subarray(32))})
    point.assertValidity() // cofactor 1: on-curve is in the subgroup
    return point
  } catch { throw new Bn254Error('malformed G1 point') }
}

/**
 * Encode a G1 point as `x || y` (all-zero for infinity).
 * @param point - G1 point.
 */
export function encodeG1(point: G1Point): Uint8Array {
  if (point.equals(G1.ZERO)) return new Uint8Array(64)
  const {x, y} = point.toAffine()
  const out = new Uint8Array(64)
  out.set(numberToBytesBE(x, 32)); out.set(numberToBytesBE(y, 32), 32)
  return out
}

/**
 * Decode a 128-byte G2 point (imaginary part first), subgroup-checked: BN254's G2 has a large
 * cofactor, so on-curve alone is not enough. All-zero is infinity.
 * @param bytes - 128-byte EVM encoding.
 */
export function decodeG2(bytes: Uint8Array): G2Point {
  if (bytes.length !== 128) throw new Bn254Error('G2 point must be 128 bytes')
  if (bytes.every(b => b === 0)) return G2.ZERO
  try {
    const limb = (i: number) => fq(bytes.subarray(i * 32, (i + 1) * 32))
    const point = G2.fromAffine({x: Fp2.create({c0: limb(1), c1: limb(0)}), y: Fp2.create({c0: limb(3), c1: limb(2)})})
    point.assertValidity()
    return point
  } catch { throw new Bn254Error('malformed or out-of-subgroup G2 point') }
}

/**
 * Encode a G2 point (imaginary part first; all-zero for infinity).
 * @param point - G2 point.
 */
export function encodeG2(point: G2Point): Uint8Array {
  if (point.equals(G2.ZERO)) return new Uint8Array(128)
  const {x, y} = point.toAffine()
  const out = new Uint8Array(128)
  ;[x.c1, x.c0, y.c1, y.c0].forEach((limb, i) => out.set(numberToBytesBE(limb, 32), i * 32))
  return out
}

/** `e(a, b) * e(c, d) == 1`, the shape precompile 0x08 computes. */
function pairingProductIsOne(a: G1Point, b: G2Point, c: G1Point, d: G2Point): boolean {
  return Fp12.eql(bn254.pairingBatch([{g1: a, g2: b}, {g1: c, g2: d}]), Fp12.ONE)
}

/**
 * Verify a 64-byte signature over `digest` against a 128-byte G2 key: `e(-sigma, g2) * e(H(m), key) == 1`.
 * Infinity on either side is refused (it would satisfy the equation trivially).
 * @param key - Group public key or a member's verifying share.
 * @param digest - 32-byte digest.
 * @param signature - 64-byte G1 signature or partial.
 */
export function verifyBn254(key: Uint8Array, digest: Uint8Array, signature: Uint8Array): boolean {
  let sigma: G1Point, pk: G2Point
  try { sigma = decodeG1(signature); pk = decodeG2(key) } catch { return false }
  if (sigma.equals(G1.ZERO) || pk.equals(G2.ZERO)) return false
  return pairingProductIsOne(sigma.negate(), G2.BASE, hashToG1(digest), pk)
}

/** One member's partial over a digest, with the verifying share it is checked against. */
export interface Bn254Partial {
  /** Nonzero member identifier (the Lagrange abscissa). */
  identifier: number
  /** 64-byte G1 partial `s_i * H(digest)`. */
  partial: Uint8Array
  /** 128-byte G2 verifying share `s_i * g2`. */
  verifyingShare: Uint8Array
}

function lagrangeAtZero(id: bigint, ids: readonly bigint[]): bigint {
  let num = bn254_Fr.ONE, den = bn254_Fr.ONE
  for (const other of ids) {
    if (other === id) continue
    num = bn254_Fr.mul(num, other)
    den = bn254_Fr.mul(den, bn254_Fr.sub(other, id))
  }
  return bn254_Fr.div(num, den)
}

/**
 * Lagrange-interpolate exactly `threshold` partials at zero, WITHOUT any verification: the result
 * is a signature only if the caller then verifies it against the group key (one pairing check,
 * where {@link combineBn254} spends one per partial as well). Undefined when the identifiers are
 * invalid or repeated, too few partials are given, or a partial is not a valid G1 point.
 * @param partials - Distinct members' partials (the first `threshold` are used).
 * @param threshold - k.
 */
export function interpolateBn254(partials: readonly Pick<Bn254Partial, 'identifier' | 'partial'>[], threshold: number): Uint8Array | undefined {
  if (!Number.isSafeInteger(threshold) || threshold < 1 || partials.length < threshold) return undefined
  const used = partials.slice(0, threshold)
  if (used.some(p => !Number.isSafeInteger(p.identifier) || p.identifier < 1 || p.identifier > 65535) || new Set(used.map(p => p.identifier)).size !== used.length) return undefined
  const xs = used.map(p => BigInt(p.identifier))
  try {
    let acc = G1.ZERO
    for (const p of used) acc = acc.add(decodeG1(p.partial).multiply(lagrangeAtZero(BigInt(p.identifier), xs)))
    return encodeG1(acc)
  } catch { return undefined }
}

/**
 * Lagrange-combine exactly `threshold` partials (each pre-verified against its own verifying share,
 * so a byzantine member is named, not merely detected) and verify the aggregate against the group
 * key: a below-threshold or mismatched set interpolates to the wrong point and is caught there.
 * @param groupKey - 128-byte group public key.
 * @param digest - 32-byte digest.
 * @param partials - Distinct members' partials.
 * @param threshold - k; exactly k partials are combined.
 */
export function combineBn254(groupKey: Uint8Array, digest: Uint8Array, partials: readonly Bn254Partial[], threshold: number): Uint8Array {
  if (!Number.isSafeInteger(threshold) || threshold < 1 || partials.length < threshold) throw new Bn254Error(`need ${threshold} partials, have ${partials.length}`)
  const ids = new Set<number>()
  for (const p of partials) {
    if (!Number.isSafeInteger(p.identifier) || p.identifier < 1 || p.identifier > 65535) throw new Bn254Error(`invalid identifier ${p.identifier}`)
    if (ids.has(p.identifier)) throw new Bn254Error(`duplicate identifier ${p.identifier}`)
    ids.add(p.identifier)
    if (!verifyBn254(p.verifyingShare, digest, p.partial)) throw new Bn254Error(`partial of member ${p.identifier} does not verify against its share`)
  }
  const used = partials.slice(0, threshold), xs = used.map(p => BigInt(p.identifier))
  let acc = G1.ZERO
  for (const p of used) acc = acc.add(decodeG1(p.partial).multiply(lagrangeAtZero(BigInt(p.identifier), xs)))
  const signature = encodeG1(acc)
  if (!verifyBn254(groupKey, digest, signature)) throw new Bn254Error('combined signature does not verify against the group key')
  return signature
}
