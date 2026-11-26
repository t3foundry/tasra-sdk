// Operation-specific dual-control approvals (keykeeper_committee::dual_operation): an offline
// statement bound to the exact operation request, independent Ed25519 approvals over its exact
// bytes, and the assembled `dual_control` bundle the keeper's api/dual_operation.rs gate
// re-verifies. The statement binds the chain, slot, operation, key epoch, payload digest and the
// operation's request hash (`request_id`); it binds no payment.
import {ed25519} from '@noble/curves/ed25519'
import {sha256} from '@noble/hashes/sha256'
import {equalBytes} from '@noble/curves/utils.js'
import {bytesToHex, hexToBytes} from '../crypto/hex.js'
import {TasraError} from '../errors.js'
import {requestHash, type CommitteeAction} from '../oid4vp/binding.js'
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
/** Rust `Operation::action`: the committee action the approved operation's own request hash is made under. */
const ACTION: Record<DualOperationKind, CommitteeAction> = {
  'frost-sign': 'sign', 'secp256k1-sign': 'sign', 'p256-sign': 'sign', 'kem-decrypt': 'decrypt', 'ibe-extract': 'ibe-extract',
}

/**
 * Rust `dual_operation::request_id`: lowercase hex (no prefix) of
 * `request_hash(chain_id, slot, operation.action(), payload_digest)`, the hash the operation's own
 * authorization is bound to. A keeper refuses a statement carrying any other value.
 * @param chainId - Deployment chain.
 * @param slot - 32-byte slot ID.
 * @param operation - The approved operation.
 * @param payloadDigest - 32-byte payload digest of the operation.
 */
export function dualOperationRequestId(chainId: number | bigint, slot: Uint8Array, operation: DualOperationKind, payloadDigest: Uint8Array): string {
  if (!KINDS.includes(operation) || slot.length !== 32 || payloadDigest.length !== 32) throw new TasraError('invalid dual-operation request')
  return bytesToHex(requestHash(chainId, slot, ACTION[operation], payloadDigest)).slice(2)
}

/** The Rust `Statement`, field for field, in its serialization order. Byte arrays are JSON number arrays. */
export interface DualOperationStatement {
  /** Deployment chain of the operation. */
  chain_id: number
  /** 32-byte slot ID as a JSON number array. */
  slot: number[]
  /** The approved operation. */
  operation: DualOperationKind
  /** The slot's current key epoch. */
  epoch: number
  /** 32-byte payload digest of the final operation (SHA-256 of an ECDSA digest), as numbers. */
  payload_digest: number[]
  /** The operation's request hash ({@link dualOperationRequestId}), 64 lowercase hex characters. */
  request_id: string
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

const FIELDS = ['chain_id', 'slot', 'operation', 'epoch', 'payload_digest', 'request_id', 'issued_at', 'expires_at', 'identity'] as const
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
    || typeof v.request_id !== 'string' || !u64(v.issued_at) || !u64(v.expires_at)
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

/** The exact operation a statement must name. */
export interface DualOperationExpectation {
  /** Deployment chain. */
  chainId: number
  /** 32-byte slot ID. */
  slot: Uint8Array
  /** The approved operation. */
  operation: DualOperationKind
  /** 32-byte payload digest of the operation (SHA-256 of an ECDSA digest; the recipient-bound digest of a decryption). */
  payloadDigest: Uint8Array
  /** The slot's key epoch, when the caller has read it; checked when given. */
  epoch?: number
}

/**
 * The statement names exactly this operation: chain, slot, operation, payload digest, and the
 * request hash derived from them (the keeper's own check).
 * @param s - Statement.
 * @param expected - The operation the caller is about to run.
 */
export function requireDualOperationRequest(s: DualOperationStatement, expected: DualOperationExpectation): void {
  validateDualOperationStatement(s)
  if (s.chain_id !== expected.chainId || s.operation !== expected.operation || !equalBytes(Uint8Array.from(s.slot), expected.slot)
    || !equalBytes(Uint8Array.from(s.payload_digest), expected.payloadDigest)) throw new TasraError('dual-operation approvals name another operation, slot or digest')
  if (s.request_id !== dualOperationRequestId(s.chain_id, Uint8Array.from(s.slot), s.operation, Uint8Array.from(s.payload_digest))) throw new TasraError('statement request id differs from its operation')
  if (expected.epoch !== undefined && s.epoch !== expected.epoch) throw new TasraError('wrong key epoch')
}

/**
 * `dual-operation prepare`: an approval statement for one exact operation. Sends nothing.
 * @param input - Chain, slot, operation, its payload digest, the slot's key epoch, IBE identity and lifetime (at most 300 s).
 */
export function prepareDualOperation(input: {chainId: number; slot: string | Uint8Array; payloadDigest: string | Uint8Array; operation: DualOperationKind; epoch: number;
  identity?: string; ttlSecs?: number; nowSecs?: number}): PreparedDualOperation {
  const slot = typeof input.slot === 'string' ? hex32(input.slot) : input.slot, digest = typeof input.payloadDigest === 'string' ? hex32(input.payloadDigest) : input.payloadDigest
  const issued = input.nowSecs ?? now(), ttl = input.ttlSecs ?? DUAL_OPERATION_MAX_LIFETIME_SECS
  if (!u64(ttl) || ttl === 0 || ttl > DUAL_OPERATION_MAX_LIFETIME_SECS) throw new TasraError('invalid dual-operation lifetime')
  const statement: DualOperationStatement = {chain_id: input.chainId, slot: [...slot], operation: input.operation, epoch: input.epoch,
    payload_digest: [...digest], request_id: dualOperationRequestId(input.chainId, slot, input.operation, digest),
    issued_at: issued, expires_at: issued + ttl, identity: input.identity ?? null}
  requireDualOperationRequest(statement, {chainId: input.chainId, slot, operation: input.operation, payloadDigest: digest, epoch: input.epoch})
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
 * `dual-operation approve`: check the statement against the approver's own expectations (the
 * slot and operation digest it was asked to approve) and its request hash, then sign its exact
 * bytes. A credentialed approver adds its holder-bound dual-approve grant, which must bind this
 * statement.
 * @param input - Prepared statement, the expected slot and operation digest, the approver and its optional grant.
 */
export async function approveDualOperation(input: {prepared: PreparedDualOperation; expectSlot: string; expectPayloadDigest: string;
  approver: DualOperationApprover; authorization?: {compound_token: CompoundTokenWire; verifier_proofs: VerifierProof[]; evidence_ct?: string}; nowSecs?: number}): Promise<DualOperationApprovalRecord> {
  const s = preparedStatement(input.prepared, input.nowSecs)
  if (s.request_id !== dualOperationRequestId(s.chain_id, Uint8Array.from(s.slot), s.operation, Uint8Array.from(s.payload_digest))) throw new TasraError('statement request id differs from its operation')
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
 * the expected operation, and bound to this chain, slot, payload digest and request hash.
 * @param proof - Assembled bundle.
 * @param expected - The chain, operation, slot and payload digest (and key epoch, when known) of the operation about to run.
 */
export function requireDualOperationProof(proof: DualOperationProof, expected: DualOperationExpectation): void {
  requireCurrentDualOperation(proof.statement)
  requireDualOperationRequest(proof.statement, expected)
  if (!Array.isArray(proof.approvals) || proof.approvals.length === 0 || proof.approvals.length > MAX_APPROVALS) throw new TasraError('invalid dual-operation approvals')
}
