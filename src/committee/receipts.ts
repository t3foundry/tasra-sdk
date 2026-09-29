import {equalBytes} from '@noble/curves/utils.js'
import {ed25519} from '@noble/curves/ed25519'
import {keccak_256} from '@noble/hashes/sha3'
import {concatBytes, utf8ToBytes} from '@noble/hashes/utils'
import {hexToBytes} from '../crypto/hex.js'
import {TasraError} from '../errors.js'
import {opAttestationHash} from './token.js'

/** A keeper's operation attestation. Presence alone does not mean verified. */
export interface OperationReceipt {
  /** 32-byte audit operation identifier. */
  opId: Uint8Array
  /** 32-byte compound token hash. */
  tokenHash: Uint8Array
  /** Ed25519 signature over the chain-bound operation attestation hash. */
  attestation: Uint8Array
}

/** Decode a fixed-size protocol hex value without silently accepting malformed bytes. */
export function protocolHex(value: unknown, size: number, field: string): Uint8Array {
  if (typeof value !== 'string' || !new RegExp(`^(?:0x)?[a-fA-F0-9]{${size * 2}}$`).test(value)) {
    throw new TasraError(`Invalid ${field}: expected ${size} bytes`)
  }
  return hexToBytes(value)
}

/**
 * Decode the optional receipt tuple. Incomplete tuples are protocol errors.
 *
 * @param reply - Keeper response fields for operation identifier, token hash and signature.
 */
export function decodeOperationReceipt(reply: {op_id?: unknown; token_hash?: unknown; op_attestation?: unknown}): OperationReceipt | undefined {
  if (reply.op_id == null && reply.token_hash == null && reply.op_attestation == null) return undefined
  return {
    opId: protocolHex(reply.op_id, 32, 'operation id'),
    tokenHash: protocolHex(reply.token_hash, 32, 'token hash'),
    attestation: protocolHex(reply.op_attestation, 64, 'operation attestation'),
  }
}

/**
 * Deterministic operation ID, matching keykeeper_committee::audit_op_id.
 *
 * @param slotId - 32-byte slot identifier.
 * @param operation - Operation name bound into the audit identifier.
 * @param tokenHash - 32-byte compound token hash.
 * @param payloadDigest - 32-byte operation payload digest.
 */
export function auditOperationId(slotId: Uint8Array, operation: 'sign' | 'decrypt' | 'ibe-extract', tokenHash: Uint8Array, payloadDigest: Uint8Array): Uint8Array {
  if ([slotId, tokenHash, payloadDigest].some(bytes => bytes.length !== 32)) throw new TasraError('Operation binding must contain 32-byte hashes')
  return keccak_256(concatBytes(utf8ToBytes('keykeeper-node/audit-op-id/v1'), slotId, utf8ToBytes(operation), tokenHash, payloadDigest))
}

/** Expected operation hashes and independently authenticated keeper key for receipt verification. */
export interface ReceiptExpectation {
  /** EVM chain identifier. */
  chainId: number | bigint
  /** 32-byte slot identifier. */
  slotId: Uint8Array
  /** 32-byte audit operation identifier. */
  opId: Uint8Array
  /** 32-byte compound token hash. */
  tokenHash: Uint8Array
  /** Ed25519 identity key authenticated independently, e.g. from NodeRegistry. */
  keeperPublicKey: Uint8Array
}

/**
 * Verify the receipt against independently established operation and keeper identities.
 * Returns false for absent, malformed or mismatched evidence. Does not prove log completeness.
 *
 * @param receipt - Decoded receipt, or undefined if the keeper supplied none.
 * @param expected - Trusted operation hashes, chain identifier and keeper public key.
 */
export function verifyOperationReceipt(receipt: OperationReceipt | undefined, expected: ReceiptExpectation): boolean {
  try {
    if (!receipt || [expected.slotId, expected.opId, expected.tokenHash, expected.keeperPublicKey].some(bytes => bytes.length !== 32) ||
      receipt.attestation.length !== 64 || !equalBytes(receipt.opId, expected.opId) || !equalBytes(receipt.tokenHash, expected.tokenHash)) return false
    return ed25519.verify(receipt.attestation, opAttestationHash(expected.chainId, expected.opId, expected.slotId, expected.tokenHash), expected.keeperPublicKey, {zip215: false})
  } catch { return false }
}
