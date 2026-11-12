// Operation-specific dual-control approvals (keykeeper_committee::dual_operation): an offline
// statement bound to the final paid request, independent Ed25519 approvals over its exact bytes,
// and the assembled `dual_control` bundle the keeper's api/dual_operation.rs gate re-verifies.
// Ported from tasra-cli `dual-operation prepare|approve|assemble` with every check kept; the final
// payment may be either backing (a per-operation reservation or an ADR-0090 allowance voucher).
import {ed25519} from '@noble/curves/ed25519'
import {sha256} from '@noble/hashes/sha256'
import {equalBytes} from '@noble/curves/utils.js'
import {bytesToHex, hexToBytes} from '../crypto/hex.js'
import {TasraError} from '../errors.js'
import {requestHash} from '../oid4vp/binding.js'
import {assertPaymentIntentWire, paymentIntentHash, prepaidRequestId, type PaymentIntentWire} from './payment.js'
import type {CompoundTokenWire} from './token.js'
import type {VerifierProof} from './client.js'

/** `DOMAIN`: the statement's signed preimage is this prefix followed by its canonical JSON. */
export const DUAL_OPERATION_DOMAIN = new TextEncoder().encode('keykeeper:dual-operation:v1\0')
/** `MAX_LIFETIME`: an approval statement is current for at most 300 seconds. */
export const DUAL_OPERATION_MAX_LIFETIME_SECS = 300
const MAX_APPROVALS = 64
const MAX_PAYLOAD = 8192

/** The operation a statement approves (Rust `Operation`, kebab-case). */
export type DualOperationKind = 'frost-sign' | 'secp256k1-sign' | 'p256-sign' | 'kem-decrypt' | 'ibe-extract'
const KINDS: readonly DualOperationKind[] = ['frost-sign', 'secp256k1-sign', 'p256-sign', 'kem-decrypt', 'ibe-extract']
const ACTION: Record<DualOperationKind, PaymentIntentWire['action']> = {
  'frost-sign': 'sign', 'secp256k1-sign': 'eoa-sign', 'p256-sign': 'eoa-sign', 'kem-decrypt': 'decrypt', 'ibe-extract': 'ibe-extract',
}

/** The Rust `Statement`, field for field, in its serialization order. Byte arrays are JSON number arrays. */
export interface DualOperationStatement {
  /** Chain the final payment names. */
  chain_id: number
  /** 32-byte slot ID as a JSON number array. */
  slot: number[]
  /** The approved operation. */
  operation: DualOperationKind
  /** The slot's key epoch the final payment's keeper assignment names. */
  epoch: number
  /** 32-byte payload digest of the final operation (SHA-256 of an ECDSA digest), as numbers. */
  payload_digest: number[]
  /** The final payment's request ID, 64 lowercase hex characters. */
  request_id: string
  /** EIP-712 hash of the final payment intent, as numbers. */
  payment_hash: number[]
  /** Unix seconds the statement becomes current. */
  issued_at: number
  /** Unix seconds it stops being current (at most 300 s after issue). */
  expires_at: number
  /** IBE approvals cover a reusable identity capability, not a single ciphertext; null otherwise. */
  identity: string | null
}

/** One approver's signature over the statement (Rust `Approval`). */
export interface DualOperationApproval {
  /** Approver's Ed25519 public key, hex. */
  approver_pubkey: string
  /** Ed25519 signature over the statement's exact payload, hex. */
  signature: string
  /** Membership proofs of a credentialed approver's grant (empty for a static approver). */
  verifier_proofs: {verifier_index: number; operator: string; pubkey: string; proof: string[]}[]
  /** A credentialed approver's holder-bound dual-approve grant. */
  committee_token?: CompoundTokenWire
  /** Sealed evidence ciphertext of that grant. */
  evidence_ct?: string
}

/** The `dual_control` field of an operation request (Rust `Proof`). */
export interface DualOperationProof {
  /** The one statement every approval signs. */
  statement: DualOperationStatement
  /** Distinct approvals of it. */
  approvals: DualOperationApproval[]
}

/** A prepared statement and its exact signed bytes. */
export interface PreparedDualOperation {
  /** The statement approvers sign. */
  statement: DualOperationStatement
  /** Hex of the signed preimage (domain + canonical JSON). */
  message_hex: string
  /** Hex SHA-256 of the preimage: the digest a credentialed approver's dual-approve grant binds. */
  payload_digest: string
  /** The presentation action a credentialed approver's grant uses. */
  action: 'dual-approve'
}

/** One approval with the statement it signs, as an approver hands it back. */
export interface DualOperationApprovalRecord {
  /** The statement the approver signed. */
  statement: DualOperationStatement
  /** Its signature (and grant). */
  approval: DualOperationApproval
}

/** An Ed25519 approver: its public key and a callback that signs the exact supplied bytes. */
export interface DualOperationApprover {
  /** 32-byte Ed25519 public key. */
  publicKey: Uint8Array
  /** Sign the exact supplied bytes; the SDK verifies the result. */
  sign(payload: Uint8Array): Promise<Uint8Array>
}

const FIELDS = ['chain_id', 'slot', 'operation', 'epoch', 'payload_digest', 'request_id', 'payment_hash', 'issued_at', 'expires_at', 'identity'] as const
const now = () => Math.floor(Date.now() / 1000)
const u64 = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0
const bytes32 = (v: unknown): v is number[] => Array.isArray(v) && v.length === 32 && v.every(b => Number.isInteger(b) && b >= 0 && b <= 255)
/** Bare lowercase hex, as the CLI writes these fields. */
const bare = (b: Uint8Array) => bytesToHex(b).slice(2)
const hex32 = (h: string) => { const b = hexToBytes(h); if (b.length !== 32) throw new TasraError('expected 32 bytes'); return b }

/**
 * `Statement::validate` plus the strict shape serde enforces (`deny_unknown_fields`, exact types).
 * @param s - Candidate statement.
 */
export function validateDualOperationStatement(s: unknown): asserts s is DualOperationStatement {
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new TasraError('invalid dual-operation statement')
  const keys = Object.keys(s)
  if (keys.length !== FIELDS.length || FIELDS.some(k => !Object.hasOwn(s, k))) throw new TasraError('invalid dual-operation statement fields')
  const v = s as DualOperationStatement
  if (!u64(v.chain_id) || !bytes32(v.slot) || !KINDS.includes(v.operation) || !Number.isSafeInteger(v.epoch) || !bytes32(v.payload_digest)
    || typeof v.request_id !== 'string' || !bytes32(v.payment_hash) || !u64(v.issued_at) || !u64(v.expires_at)
    || (v.identity !== null && typeof v.identity !== 'string')) throw new TasraError('invalid dual-operation statement types')
  if (v.epoch < 0 || !/^[0-9a-f]{64}$/.test(v.request_id) || v.expires_at <= v.issued_at || v.expires_at - v.issued_at > DUAL_OPERATION_MAX_LIFETIME_SECS) {
    throw new TasraError('invalid dual-operation request, epoch or lifetime')
  }
  if (v.operation === 'ibe-extract') {
    if (v.identity === null || v.identity.length === 0 || new TextEncoder().encode(v.identity).length > 1024 || v.identity.includes('\0')) {
      throw new TasraError('IBE approval requires a bounded identity')
    }
  } else if (v.identity !== null) throw new TasraError('identity is only valid for IBE approval')
}

/**
 * `Statement::payload`: the domain followed by serde_json's compact serialization in field order.
 * @param s - A valid statement.
 */
export function dualOperationPayload(s: DualOperationStatement): Uint8Array {
  validateDualOperationStatement(s)
  const ordered = Object.fromEntries(FIELDS.map(k => [k, s[k]]))
  const json = new TextEncoder().encode(JSON.stringify(ordered))
  const out = new Uint8Array(DUAL_OPERATION_DOMAIN.length + json.length)
  out.set(DUAL_OPERATION_DOMAIN, 0); out.set(json, DUAL_OPERATION_DOMAIN.length)
  return out
}

/**
 * `Statement::from_payload`: parse signed bytes and refuse any non-canonical encoding.
 * @param bytes - Domain-prefixed statement bytes.
 */
export function dualOperationFromPayload(bytes: Uint8Array): DualOperationStatement {
  if (bytes.length > MAX_PAYLOAD) throw new TasraError('dual-operation statement exceeds limit')
  if (!equalBytes(bytes.subarray(0, DUAL_OPERATION_DOMAIN.length), DUAL_OPERATION_DOMAIN)) throw new TasraError('wrong dual-operation domain')
  let value: unknown
  try { value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(DUAL_OPERATION_DOMAIN.length))) }
  catch { throw new TasraError('invalid dual-operation statement encoding') }
  validateDualOperationStatement(value)
  if (!equalBytes(dualOperationPayload(value), bytes)) throw new TasraError('noncanonical dual-operation statement')
  return value
}

/**
 * `Statement::require_current`: valid and `issued_at <= now < expires_at`.
 * @param s - Statement.
 * @param nowSecs - Clock, Unix seconds.
 */
export function requireCurrentDualOperation(s: DualOperationStatement, nowSecs: number = now()): void {
  validateDualOperationStatement(s)
  if (nowSecs < s.issued_at || nowSecs >= s.expires_at) throw new TasraError('dual-operation approval is not current')
}

/**
 * The CLI's `check_ticket`: the statement names exactly this final payment (either backing).
 * @param s - Statement.
 * @param payment - The final paid operation's payment (a debit voucher, if any, is not hashed).
 */
export function requireDualOperationPayment(s: DualOperationStatement, payment: PaymentIntentWire): void {
  assertPaymentIntentWire(payment)
  const {debit_voucher: _voucher, ...signed} = payment
  if (s.chain_id !== payment.chain_id || !equalBytes(Uint8Array.from(s.slot), hex32(payment.slot))
    || !equalBytes(Uint8Array.from(s.payload_digest), hex32(payment.payload_digest))
    || s.request_id !== prepaidRequestId(signed).slice(2).toLowerCase()
    || !equalBytes(Uint8Array.from(s.payment_hash), hex32(paymentIntentHash(signed)))) throw new TasraError('statement differs from final payment')
  if (payment.action !== ACTION[s.operation] || s.epoch !== payment.keeper_assignment.key_epoch) throw new TasraError('wrong action or key epoch')
}

/**
 * `dual-operation prepare`: an approval statement for the final paid operation. Sends nothing.
 * @param input - Final payment, operation, the slot's key epoch, IBE identity, lifetime (≤ 300 s, capped at the payment's expiry).
 */
export function prepareDualOperation(input: {payment: PaymentIntentWire; operation: DualOperationKind; epoch: number; identity?: string; ttlSecs?: number; nowSecs?: number}): PreparedDualOperation {
  const {payment} = input
  assertPaymentIntentWire(payment)
  const {debit_voucher: _voucher, ...signed} = payment
  const issued = input.nowSecs ?? now(), ttl = input.ttlSecs ?? DUAL_OPERATION_MAX_LIFETIME_SECS
  if (!u64(ttl) || ttl === 0) throw new TasraError('invalid dual-operation lifetime')
  const statement: DualOperationStatement = {chain_id: payment.chain_id, slot: [...hex32(payment.slot)], operation: input.operation, epoch: input.epoch,
    payload_digest: [...hex32(payment.payload_digest)], request_id: prepaidRequestId(signed).slice(2).toLowerCase(),
    payment_hash: [...hex32(paymentIntentHash(signed))], issued_at: issued, expires_at: Math.min(issued + ttl, payment.expires), identity: input.identity ?? null}
  requireDualOperationPayment(statement, payment)
  const preimage = dualOperationPayload(statement)
  return {statement, message_hex: bare(preimage), payload_digest: bare(sha256(preimage)), action: 'dual-approve'}
}

/** The CLI's `statement()` read: current, and its carried bytes are exactly the statement's. */
function preparedStatement(prepared: PreparedDualOperation, nowSecs?: number): DualOperationStatement {
  requireCurrentDualOperation(prepared.statement, nowSecs)
  if (prepared.message_hex.replace(/^0x/, '').toLowerCase() !== bare(dualOperationPayload(prepared.statement))) {
    throw new TasraError('prepared payload differs from statement')
  }
  return structuredClone(prepared.statement)
}

/**
 * `dual-operation approve`: check the statement against the final payment and the approver's own
 * expectations, then sign its exact bytes. A credentialed approver adds its holder-bound
 * dual-approve grant, which must bind this statement.
 * @param input - Prepared statement, final payment, the expected slot and operation digest, the approver and its optional grant.
 */
export async function approveDualOperation(input: {prepared: PreparedDualOperation; payment: PaymentIntentWire; expectSlot: string; expectPayloadDigest: string;
  approver: DualOperationApprover; authorization?: {compound_token: CompoundTokenWire; verifier_proofs: VerifierProof[]; evidence_ct?: string}; nowSecs?: number}): Promise<DualOperationApprovalRecord> {
  const s = preparedStatement(input.prepared, input.nowSecs)
  requireDualOperationPayment(s, input.payment)
  if (!equalBytes(hex32(input.expectSlot), Uint8Array.from(s.slot))) throw new TasraError('unexpected slot')
  if (!equalBytes(hex32(input.expectPayloadDigest), Uint8Array.from(s.payload_digest))) throw new TasraError('unexpected operation digest')
  const payload = dualOperationPayload(s), publicKey = input.approver.publicKey.slice()
  const signature = await input.approver.sign(payload.slice())
  if (publicKey.length !== 32 || signature.length !== 64 || !ed25519.verify(signature, payload, publicKey, {zip215: false})) throw new TasraError('Invalid local approval signature')
  const approval: DualOperationApproval = {approver_pubkey: bare(publicKey), signature: bare(signature), verifier_proofs: []}
  if (input.authorization) {
    const token = input.authorization.compound_token
    const expected = requestHash(s.chain_id, Uint8Array.from(s.slot), 'dual-approve', sha256(payload))
    if (typeof token?.request_hash !== 'string' || !equalBytes(hexToBytes(token.request_hash), expected)) throw new TasraError('grant authorizes another approval')
    if (token.binding !== 'holder_key') throw new TasraError('approval requires holder-bound grant')
    approval.committee_token = structuredClone(token)
    approval.verifier_proofs = input.authorization.verifier_proofs.map(p => ({verifier_index: p.verifierIndex, operator: p.operator.replace(/^0x/, ''),
      pubkey: p.pubkey.replace(/^0x/, ''), proof: p.proof.map(x => x.replace(/^0x/, ''))}))
    if (input.authorization.evidence_ct !== undefined) approval.evidence_ct = input.authorization.evidence_ct
  }
  return {statement: s, approval}
}

/**
 * `dual-operation assemble`: combine independent approvals of ONE statement into the `dual_control`
 * bundle. Every approval names exactly that statement and verifies strictly over its bytes; the
 * approver keys are distinct and at least `quorum` of them are present (the keeper re-checks them
 * against the on-chain policy).
 * @param input - Prepared statement, approval records and the slot policy's quorum.
 */
export function assembleDualOperation(input: {prepared: PreparedDualOperation; approvals: DualOperationApprovalRecord[]; quorum: number; nowSecs?: number}): DualOperationProof {
  const s = preparedStatement(input.prepared, input.nowSecs)
  if (!Number.isSafeInteger(input.quorum) || input.quorum < 1 || input.quorum > MAX_APPROVALS) throw new TasraError('invalid approval quorum')
  if (input.approvals.length > MAX_APPROVALS) throw new TasraError('at most 64 approvals')
  const payload = dualOperationPayload(s), seen = new Set<string>(), approvals: DualOperationApproval[] = []
  for (const record of input.approvals) {
    validateDualOperationStatement(record.statement)
    if (!equalBytes(dualOperationPayload(record.statement), payload)) throw new TasraError('approvals name different operations')
    const a = record.approval
    if (typeof a?.approver_pubkey !== 'string' || typeof a.signature !== 'string') throw new TasraError('missing approver or signature')
    const key = hexToBytes(a.approver_pubkey), signature = hexToBytes(a.signature)
    if (key.length !== 32) throw new TasraError('invalid key length')
    if (signature.length !== 64) throw new TasraError('invalid signature length')
    if (!ed25519.verify(signature, payload, key, {zip215: false})) throw new TasraError('approval signature does not verify over the statement')
    const id = bare(key)
    if (seen.has(id)) throw new TasraError('duplicate approver')
    seen.add(id)
    approvals.push(structuredClone(a))
  }
  if (approvals.length < input.quorum) throw new TasraError(`dual-operation needs ${input.quorum} distinct approvals, has ${approvals.length}`)
  return {statement: s, approvals}
}

/**
 * The client-side half of the keeper gate, before a bundle travels in an operation body: current,
 * the expected operation, and bound to this slot, payload digest and final payment.
 * @param proof - Assembled bundle.
 * @param expected - The operation, slot, SHA-256 of the operation's payload and the final payment.
 */
export function requireDualOperationProof(proof: DualOperationProof, expected: {operation: DualOperationKind; slot: Uint8Array; payloadDigest: Uint8Array; payment: PaymentIntentWire}): void {
  requireCurrentDualOperation(proof.statement)
  const s = proof.statement
  if (s.operation !== expected.operation || !equalBytes(Uint8Array.from(s.slot), expected.slot) || !equalBytes(Uint8Array.from(s.payload_digest), expected.payloadDigest)) {
    throw new TasraError('dual-operation approvals name another operation, slot or digest')
  }
  requireDualOperationPayment(s, expected.payment)
  if (!Array.isArray(proof.approvals) || proof.approvals.length === 0 || proof.approvals.length > MAX_APPROVALS) throw new TasraError('invalid dual-operation approvals')
}
