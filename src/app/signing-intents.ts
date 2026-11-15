// Structured signing intents for threshold ECDSA slots: the SDK builds the 32-byte digest from a
// transaction, EIP-712 typed data, a personal message or (P-256) the exact bytes, so callers,
// approvers and the keeper request all derive the digest from the same reviewed input instead of
// passing an opaque one around.

import {sha256} from '@noble/hashes/sha256'
import {hashMessage, hashTypedData, hexToBytes, keccak256, serializeTransaction, toHex, type TransactionSerializable, type TypedDataDefinition} from 'viem'
import {approveDualOperation, type DualOperationApprovalRecord, type DualOperationApprover, type PreparedDualOperation} from '../committee/dual-operation.js'
import type {CompoundTokenWire} from '../committee/token.js'
import type {VerifierProof} from '../committee/client.js'
import {assertPaymentIntentWire, type PaymentIntentWire} from '../committee/payment.js'
import {TasraError} from '../errors.js'

/** Largest serialized transaction, typed-data document or message an intent may carry, in bytes. */
export const SIGNING_INTENT_MAX_BYTES = 65_536

/** An EIP-155 or typed transaction; the digest is keccak256 of its unsigned serialization. */
export interface TransactionSigningIntent {
  /** Intent kind. */
  kind: 'transaction'
  /** The transaction; it must name its `chainId`. */
  transaction: TransactionSerializable
}

/** EIP-712 typed data; the digest is its EIP-712 hash. */
export interface TypedDataSigningIntent {
  /** Intent kind. */
  kind: 'typed-data'
  /** The typed data; its domain must name a `chainId`. */
  typedData: TypedDataDefinition
}

/** An EIP-191 personal message; the digest is its `personal_sign` hash. */
export interface MessageSigningIntent {
  /** Intent kind. */
  kind: 'message'
  /** The message text or bytes, at most 64 KiB. */
  message: string | Uint8Array
}

/** What a secp256k1 slot signs, from which the SDK derives the Ethereum digest itself. */
export type EthereumSigningIntent = TransactionSigningIntent | TypedDataSigningIntent | MessageSigningIntent

/** What a P-256 slot signs: the SHA-256 of exactly these bytes. */
export interface P256SigningIntent {
  /** Intent kind. */
  kind: 'sha256'
  /** The bytes, at most 64 KiB. */
  data: Uint8Array
}

/** Either curve's structured intent. */
export type SigningIntent = EthereumSigningIntent | P256SigningIntent

const json = (value: unknown) => JSON.stringify(value, (_key, v: unknown) => typeof v === 'bigint' ? v.toString() : v)
function bounded(size: number, what: string): void {
  if (size > SIGNING_INTENT_MAX_BYTES) throw new TasraError(`${what} exceeds ${SIGNING_INTENT_MAX_BYTES} bytes`)
}

/**
 * The 32-byte digest a slot signs for a structured intent. A transaction and typed data must name
 * a chain, and that chain must be `expectChainId` when given; every input is size-bounded.
 * @param intent Structured intent.
 * @param options Chain the transaction or typed data must name.
 */
export function signingIntentDigest(intent: SigningIntent, options: {expectChainId?: number} = {}): Uint8Array {
  const chain = (id: unknown, what: string) => {
    const n = typeof id === 'bigint' ? Number(id) : id
    if (!Number.isSafeInteger(n) || (n as number) <= 0) throw new TasraError(`${what} must name its chain`)
    if (options.expectChainId !== undefined && n !== options.expectChainId) throw new TasraError(`${what} names chain ${String(n)}, not ${options.expectChainId}`)
  }
  switch (intent?.kind) {
    case 'transaction': {
      chain(intent.transaction?.chainId, 'Transaction')
      const unsigned = serializeTransaction(intent.transaction)
      bounded((unsigned.length - 2) / 2, 'Transaction')
      return hexToBytes(keccak256(unsigned))
    }
    case 'typed-data': {
      chain(intent.typedData?.domain?.chainId, 'Typed data')
      bounded(new TextEncoder().encode(json(intent.typedData)).length, 'Typed data')
      return hexToBytes(hashTypedData(intent.typedData))
    }
    case 'message': {
      const size = typeof intent.message === 'string' ? new TextEncoder().encode(intent.message).length : intent.message?.length
      if (typeof size !== 'number') throw new TasraError('Message must be a string or bytes')
      bounded(size, 'Message')
      return hexToBytes(hashMessage(typeof intent.message === 'string' ? intent.message : {raw: intent.message}))
    }
    case 'sha256': {
      if (!(intent.data instanceof Uint8Array)) throw new TasraError('P-256 intent data must be bytes')
      bounded(intent.data.length, 'P-256 intent data')
      return sha256(intent.data)
    }
    default:
      throw new TasraError('Unknown signing intent kind')
  }
}

/**
 * The curve an intent belongs to.
 * @param intent Structured intent.
 */
export function signingIntentCurve(intent: SigningIntent): 'secp256k1' | 'p256' {
  return intent.kind === 'sha256' ? 'p256' : 'secp256k1'
}

/**
 * Check that a final `eoa-sign` payment pays for exactly this intent (its payload digest is the
 * SHA-256 of the intent's digest). Returns the digest.
 * @param payment The final payment intent.
 * @param intent Structured intent.
 */
export function requireIntentPayment(payment: PaymentIntentWire, intent: SigningIntent): Uint8Array {
  assertPaymentIntentWire(payment)
  // The intent's own chain is where the account acts; the payment's is where the slot lives.
  const digest = signingIntentDigest(intent)
  if (payment.action !== 'eoa-sign' || payment.payload_digest.toLowerCase() !== toHex(sha256(digest)).toLowerCase()) {
    throw new TasraError('Payment does not pay for this signing intent')
  }
  return digest
}

/**
 * An approver's side of a native approval for a structured intent: recompute the digest from the
 * intent it reviewed, check the final payment pays for exactly it and the statement names it,
 * then sign the statement. Refuses before signing on any difference.
 * @param input Prepared statement, final payment, the reviewed intent, the approver and its optional holder-bound grant.
 */
export async function approveSigningIntent(input: {prepared: PreparedDualOperation; payment: PaymentIntentWire; intent: SigningIntent; approver: DualOperationApprover;
  authorization?: {compound_token: CompoundTokenWire; verifier_proofs: VerifierProof[]; evidence_ct?: string}; nowSecs?: number}): Promise<DualOperationApprovalRecord> {
  const digest = requireIntentPayment(input.payment, input.intent)
  const operation = signingIntentCurve(input.intent) === 'p256' ? 'p256-sign' : 'secp256k1-sign'
  if (input.prepared?.statement?.operation !== operation) throw new TasraError(`Approval statement names ${String(input.prepared?.statement?.operation)}, not ${operation}`)
  return approveDualOperation({prepared: input.prepared, payment: input.payment, expectSlot: input.payment.slot, expectPayloadDigest: toHex(sha256(digest)),
    approver: input.approver, ...(input.authorization ? {authorization: input.authorization} : {}), ...(input.nowSecs !== undefined ? {nowSecs: input.nowSecs} : {})})
}
