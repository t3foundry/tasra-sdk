import {ed25519} from '@noble/curves/ed25519'
import {equalBytes} from '@noble/curves/utils.js'
import {keccak256, toHex, type Address, type Hex} from 'viem'
import {bytesToHex} from '@noble/hashes/utils'
import {BoundedCache} from '../internal/bounded.js'
import {recoverTypedDataSigner, typedDataHash as hashTypedData} from '../internal/typedData.js'
import {canonicalize} from '../auth/oid4vp.js'
import {protocolHex} from './receipts.js'
import {assertPaymentIntentWire, paymentIntentHash, paymentIntentTypedData, prepaidRequestId, type PaymentIntentWire} from './payment.js'

/** Separate creator-consent domain; original payment commitments remain unchanged. */
export const EXECUTION_CERTIFICATE_DOMAIN = 'Keykeeper Client Execution Certificate'
/** Client stage approvals bind complete request bodies and assigned operator keys. */
export const EXECUTION_APPROVAL_DOMAIN = 'Keykeeper Client Stage Approval'
/** Client consent to one exact session and independently approved registered agent. */
export const EXECUTION_INITIALIZATION_DOMAIN = 'Keykeeper Client Session Initialization'
/** Maximum complete unsigned request size shared with the Rust verifier. */
export const MAX_EXECUTION_BODY_BYTES = 2 * 1024 * 1024

/** Stable stage names and ordinals from the shared execution report protocol. */
export type ExecutionStage = 'coordinator' | 'contributor' | 'presentation_sign' | 'presentation_attest' | 'credential'
const STAGES = {coordinator: 0, contributor: 1, presentation_sign: 2, presentation_attest: 3, credential: 4} as const

/** Creator certificate for one payment and a client-owned Ed25519 public key. */
export interface ExecutionCertificate {
  /** Public key; never deliver its private seed to the verifier agent. */
  execution_key: Hex
  /** Unix expiry no later than the original creator payment. */
  expires: number
  /** Creator EIP-712 signature over the certificate. */
  creator_signature: Hex
}

/** Client signature authorizing one exact body, stage and assigned operator. */
export interface ExecutionAuthorization {
  /** Creator-certified public execution key and bounded consent. */
  certificate: ExecutionCertificate
  /** Paid stage being authorized. */
  stage: ExecutionStage
  /** Independently authenticated operator's Ed25519 public key. */
  operator_key: Hex
  /** Locally recomputed complete unsigned body hash. */
  body_hash: Hex
  /** Unix expiry no later than the certificate. */
  expires: number
  /** Client Ed25519 signature over the structured stage approval hash. */
  signature: Hex
}

/** Public proof of the original client-approved work, without its private request body. */
export interface ExecutionConsent {
  /** Creator certificate and original client signature for this stage. */
  authorization: ExecutionAuthorization
  /** Worker commitment to its exact accepted inputs; this is not a computation proof. */
  inputs_commitment: number[]
  /** Original admission time, checked against canonical historical backing by the reader. */
  verified_at: number
}

/** Client authorization to create a session; this is not a paid operator stage. */
export interface SessionInitialization {
  /** Public execution key certified by the slot creator. */
  certificate: ExecutionCertificate
  /** Hash of the independently approved registered agent profile. */
  profile_hash: Hex
  /** Hash of the complete unsigned create body, including the client owner bearer. */
  body_hash: Hex
  /** Unix expiry bounded by the certificate. */
  expires: number
  /** Client Ed25519 signature in a separate initialization domain. */
  signature: Hex
}

/** Independent client intent for a registered agent session. */
export interface ExpectedInitialization {
  /** Previously authenticated and approved agent profile; never copied from its response. */
  serviceProfile: Record<string, unknown>
  /** Client-built complete create body, excluding execution_initialization. */
  body: Record<string, unknown>
}

/** Independently selected deployment, creator and exact reserved payment. */
export interface ExecutionConsentPolicy {
  /** Approved chain ID. */
  chainId: number
  /** Approved Settlement proxy. */
  settlement: Address
  /** Approved KeyRegistry proxy. */
  keyRegistry: Address
  /** Creator read independently from the intended slot. */
  creator: Address
  /** Exact locally retained payment commitment, never copied from a proposal. */
  paymentHash: Hex
  /** Nonzero fee from the canonical quote or mined reservation, in TASRA base units. */
  cost: bigint
  /** Fresh clock supplied at the approval boundary; no stale policy cache. */
  nowSecs: number
}

/** Client-built complete unsigned body and independently selected destination. */
export interface ExpectedExecution {
  /** Stage the application intends to authorize. */
  stage: ExecutionStage
  /** Key from authenticated slot assignment or verifier snapshot/draw. */
  operatorKey: Hex
  /** Complete body reconstructed by the application, including optional field shape. */
  body: Record<string, unknown>
}

/** Untrusted agent proposal. An opaque body hash is deliberately not accepted. */
export interface ExecutionProposal {
  /** Requested stage; compared with the application's own selection. */
  stage: ExecutionStage
  /** Requested key; compared with an independently authenticated key. */
  operator_key: Hex
  /** Complete unsigned JSON body, with no execution_authorization envelope. */
  unsigned_body: Record<string, unknown>
  /** Requested bounded Unix expiry. */
  expires: number
}

/** Local Ed25519 signing capability; implementations must keep their key on the client. */
export interface ClientExecutionSigner {
  /** Public key used by the creator certificate. */
  publicKey: Uint8Array
  /** Sign the SDK-reconstructed structured hash; never a hash supplied by an agent. */
  sign(message: Uint8Array): Promise<Uint8Array>
}

/** Disposable local signer whose private seed never leaves its closure. */
export interface LocalExecutionSigner extends ClientExecutionSigner {
  /** Erase the retained private seed and permanently disable further signatures. */
  dispose(): void
}

const COMMON_FIELDS = [
  {name: 'chainId', type: 'uint256'}, {name: 'settlement', type: 'address'},
  {name: 'keyRegistry', type: 'address'}, {name: 'slotId', type: 'bytes32'},
  {name: 'paymentHash', type: 'bytes32'}, {name: 'requestId', type: 'bytes32'},
  {name: 'sessionCommitment', type: 'bytes32'},
] as const
const CERTIFICATE_TYPES = {ClientExecutionCertificate: [...COMMON_FIELDS,
  {name: 'executionKey', type: 'bytes32'}, {name: 'expires', type: 'uint64'},
]} as const
const APPROVAL_TYPES = {ClientStageApproval: [...COMMON_FIELDS,
  {name: 'certificateHash', type: 'bytes32'}, {name: 'stage', type: 'uint8'},
  {name: 'operatorKey', type: 'bytes32'}, {name: 'action', type: 'uint8'},
  {name: 'payloadDigest', type: 'bytes32'}, {name: 'bodyHash', type: 'bytes32'},
  {name: 'expires', type: 'uint64'},
]} as const
const INITIALIZATION_TYPES = {ClientSessionInitialization: [...COMMON_FIELDS,
  {name: 'certificateHash', type: 'bytes32'}, {name: 'profileHash', type: 'bytes32'},
  {name: 'bodyHash', type: 'bytes32'}, {name: 'expires', type: 'uint64'},
]} as const
const ACTIONS = {sign: 0, decrypt: 1, 'eoa-sign': 2, 'ibe-extract': 3, 'dual-approve': 6} as const

function integer(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid execution timestamp or chain ID')
}
// Exact 32-byte encodings already proven to be strict prime-order points. One paid operation
// re-checks the same certificate and keeper keys a dozen times; the torsion check is a full
// scalar multiplication each time. Only keys that PASSED are stored, keyed by their exact bytes.
const primeOrderKeys = new BoundedCache<string, true>(1024)
function strongKey(key: Hex): Uint8Array {
  const bytes = protocolHex(key, 32, 'execution public key')
  primeOrderKeys.getOrCompute(bytesToHex(bytes), () => {
    const point = ed25519.Point.fromHex(bytes, false)
    if (point.isSmallOrder() || !point.isTorsionFree()) throw new Error('Execution public key must be a prime-order Ed25519 point')
    return true
  })
  return bytes
}
// Strict (non-ZIP-215) Ed25519 verifications that PASSED, keyed by the exact signature, message and
// key bytes (fixed 64/32/32 lengths): an approval the client just signed and checked is checked
// again by the keeper-request wrapper with the identical triple. A failure is never stored.
const verifiedSignatures = new BoundedCache<string, true>(1024)
function strictSignature(signature: Uint8Array, message: Uint8Array, key: Uint8Array): boolean {
  if (signature.length !== 64 || message.length !== 32 || key.length !== 32) return ed25519.verify(signature, message, key, {zip215: false})
  const id = bytesToHex(signature) + bytesToHex(message) + bytesToHex(key)
  if (verifiedSignatures.peek(id)) return true
  if (!ed25519.verify(signature, message, key, {zip215: false})) return false
  verifiedSignatures.getOrCompute(id, () => true)
  return true
}
function stage(stage: ExecutionStage): number {
  if (!Object.hasOwn(STAGES, stage)) throw new Error('Unknown execution stage')
  return STAGES[stage]
}
function exactObject(value: object, keys: readonly string[]): void {
  if (!value || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Execution envelope must be a plain object')
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Object.getOwnPropertySymbols(value).length || Object.keys(descriptors).length !== keys.length
    || keys.some(key => !Object.hasOwn(descriptors, key))
    || Object.values(descriptors).some(descriptor => !descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))) throw new Error('Execution envelope has missing, unknown or non-JSON fields')
}
function certificateShape(certificate: ExecutionCertificate): void {
  exactObject(certificate, ['execution_key', 'expires', 'creator_signature'])
}
// Validate the caller's object, then hash the SNAPSHOT once: the snapshot is what every later
// comparison reads, so its hash is returned with it rather than recomputed per comparison.
function expectedSnapshot(expected: ExpectedExecution): {expected: ExpectedExecution; bodyHash: Hex} {
  exactObject(expected, ['stage', 'operatorKey', 'body'])
  stage(expected.stage); strongKey(expected.operatorKey); bodyShape(expected.body)
  const snapshot = structuredClone(expected)
  return {expected: snapshot, bodyHash: executionBodyHash(snapshot.body)}
}
function common(payment: PaymentIntentWire) {
  assertPaymentIntentWire(payment)
  return {chainId: BigInt(payment.chain_id), settlement: payment.settlement, keyRegistry: payment.key_registry,
    slotId: payment.slot, paymentHash: paymentIntentHash(payment), requestId: prepaidRequestId(payment), sessionCommitment: payment.session_commitment}
}

/**
 * Reconstruct the creator certificate typed data from the original payment.
 * @param payment Locally retained payment; signing this data does not reserve or spend funds.
 * @param certificate Public execution key and expiry to certify.
 */
export function executionCertificateTypedData(payment: PaymentIntentWire, certificate: Pick<ExecutionCertificate, 'execution_key' | 'expires'>) {
  integer(certificate.expires); strongKey(certificate.execution_key)
  if (certificate.expires === 0 || certificate.expires > payment.expires) throw new Error('Execution certificate exceeds payment expiry')
  return {domain: {name: EXECUTION_CERTIFICATE_DOMAIN, version: '1', chainId: payment.chain_id, verifyingContract: payment.settlement},
    primaryType: 'ClientExecutionCertificate' as const, types: CERTIFICATE_TYPES,
    message: {...common(payment), executionKey: certificate.execution_key, expires: BigInt(certificate.expires)}}
}

/** Creator wallet capable of signing the separate execution certificate. */
export interface ExecutionCreatorSigner {
  /** Must equal the independently read slot creator. Delegation is not spending authority. */
  address: Address
  /** Sign the SDK-reconstructed creator certificate typed data. */
  signTypedData(args: ReturnType<typeof executionCertificateTypedData>): Promise<Hex>
}

/**
 * Reconstruct the complete stage typed data; callers never sign an agent's opaque hash.
 * @param payment Original independently retained payment.
 * @param approval Stage, target and locally recomputed body commitment.
 */
export function executionApprovalTypedData(payment: PaymentIntentWire, approval: Omit<ExecutionAuthorization, 'signature'>) {
  integer(approval.expires); strongKey(approval.operator_key)
  if (approval.expires === 0 || approval.expires > approval.certificate.expires || /^0x0{64}$/i.test(approval.body_hash)) throw new Error('Invalid execution approval expiry or body hash')
  protocolHex(approval.body_hash, 32, 'execution body hash')
  return {domain: {name: EXECUTION_APPROVAL_DOMAIN, version: '1', chainId: payment.chain_id, verifyingContract: payment.settlement},
    primaryType: 'ClientStageApproval' as const, types: APPROVAL_TYPES,
    message: {...common(payment), certificateHash: hashTypedData(executionCertificateTypedData(payment, approval.certificate)),
      stage: stage(approval.stage), operatorKey: approval.operator_key, action: ACTIONS[payment.action],
      payloadDigest: payment.payload_digest, bodyHash: approval.body_hash, expires: BigInt(approval.expires)}}
}

function jsonShape(value: unknown, depth: number, budget: {remaining: number}): void {
  if (depth > 32 || budget.remaining-- === 0) throw new Error('Execution body exceeds nesting or node bound')
  if (typeof value === 'string') {unicode(value); return}
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isSafeInteger(value)) return
  if (Array.isArray(value)) {
    const descriptors = Object.getOwnPropertyDescriptors(value)
    if (Object.getOwnPropertySymbols(value).length || Object.keys(descriptors).length !== value.length + 1) throw new Error('Execution arrays contain non-JSON properties')
    for (let i = 0; i < value.length; i++) {
      const descriptor = descriptors[String(i)]
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('Sparse or accessor execution arrays are ambiguous')
      jsonShape(descriptor.value, depth + 1, budget)
    }
    return
  }
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    if (Object.getOwnPropertySymbols(value).length) throw new Error('Execution body contains non-JSON keys')
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      unicode(key)
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('Execution body contains non-JSON properties')
      jsonShape(descriptor.value, depth + 1, budget)
    }
    return
  }
  throw new Error('Execution body must contain only safe JSON values')
}
function unicode(value: string): void {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i)
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('Execution JSON contains an unpaired Unicode surrogate')
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new Error('Execution JSON contains an unpaired Unicode surrogate')
  }
}

// The structural half of executionBodyHash (the byte bound needs the encoding and stays there).
function bodyShape(body: Record<string, unknown>): void {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.hasOwn(body, 'execution_authorization')) throw new Error('Execution body must be an unsigned JSON object')
  jsonShape(body, 0, {remaining: 65_536})
}
/**
 * Hash the complete unsigned body with the existing RFC8785 encoder and Rust bounds.
 * Explicit null and absent fields remain distinct; no operation field is dropped.
 * @param body Complete unsigned JSON object, excluding only its approval envelope.
 */
export function executionBodyHash(body: Record<string, unknown>): Hex {
  bodyShape(body)
  const encoded = JSON.stringify(body)
  if (new TextEncoder().encode(encoded).length > MAX_EXECUTION_BODY_BYTES) throw new Error('Execution body exceeds serialized byte bound')
  return keccak256(toHex(canonicalize(encoded)))
}

async function paymentConsent(payment: PaymentIntentWire, policy: ExecutionConsentPolicy): Promise<void> {
  assertPaymentIntentWire(payment); integer(policy.nowSecs); integer(policy.chainId)
  protocolHex(policy.settlement, 20, 'execution Settlement'); protocolHex(policy.keyRegistry, 20, 'execution KeyRegistry')
  protocolHex(policy.creator, 20, 'execution creator'); protocolHex(policy.paymentHash, 32, 'expected payment hash')
  if (policy.chainId === 0 || /^0x0{40}$/i.test(policy.creator) || /^0x0{40}$/i.test(policy.settlement) || /^0x0{40}$/i.test(policy.keyRegistry)
    || payment.chain_id !== policy.chainId || payment.settlement.toLowerCase() !== policy.settlement.toLowerCase()
    || payment.key_registry.toLowerCase() !== policy.keyRegistry.toLowerCase() || paymentIntentHash(payment).toLowerCase() !== policy.paymentHash.toLowerCase()
    || payment.expires <= policy.nowSecs || payment.expires - policy.nowSecs > 3600 || policy.cost <= 0n || policy.cost > BigInt(payment.max_cost)
    || [payment.session_commitment, payment.nonce, payment.verification_seed].some(value => /^0x0{64}$/i.test(value))) throw new Error('Execution payment differs from independent consent policy')
  const creator = await recoverTypedDataSigner(paymentIntentTypedData(payment), payment.signature)
  if (creator.toLowerCase() !== policy.creator.toLowerCase()) throw new Error('Execution payment is not signed by the slot creator')
}
async function certified(payment: PaymentIntentWire, certificate: ExecutionCertificate, policy: ExecutionConsentPolicy): Promise<void> {
  if (certificate.expires <= policy.nowSecs) throw new Error('Execution certificate expired')
  protocolHex(certificate.creator_signature, 65, 'execution creator signature')
  const creator = await recoverTypedDataSigner(executionCertificateTypedData(payment, certificate), certificate.creator_signature)
  if (creator.toLowerCase() !== policy.creator.toLowerCase()) throw new Error('Execution key is not certified by the slot creator')
}
function keeperTarget(payment: PaymentIntentWire, stage: ExecutionStage, operator: Hex): void {
  if (stage !== 'coordinator' && stage !== 'contributor') return
  const coordinator = toHex(Uint8Array.from(payment.keeper_assignment.coordinator))
  const contributors = payment.keeper_assignment.contributors.map(key => toHex(Uint8Array.from(key)))
  if (payment.action === 'dual-approve' || (stage === 'coordinator' ? coordinator !== operator.toLowerCase() : !contributors.includes(operator.toLowerCase() as Hex))) throw new Error('Execution approval targets an unassigned keeper stage')
}

/**
 * Sign and verify a creator certificate without handing a private execution key to the agent.
 * @param options Independent consent policy, original payment, public execution key and creator wallet.
 */
export async function createExecutionCertificate(options: {payment: PaymentIntentWire; policy: ExecutionConsentPolicy;
  publicKey: Uint8Array; expires: number; creator: ExecutionCreatorSigner}): Promise<ExecutionCertificate> {
  const payment = structuredClone(options.payment), policy = {...options.policy}, creator = options.creator
  const certificate: ExecutionCertificate = {execution_key: toHex(options.publicKey.slice()), expires: options.expires, creator_signature: '0x'}
  const typedData = executionCertificateTypedData(payment, certificate)
  await paymentConsent(payment, policy)
  if (creator.address.toLowerCase() !== policy.creator.toLowerCase() || certificate.expires <= policy.nowSecs) throw new Error('Execution certificate requires the current creator and live expiry')
  certificate.creator_signature = await creator.signTypedData(typedData)
  await certified(payment, certificate, policy)
  return certificate
}

/**
 * Verify creator consent, stage/operator/body binding and the strict local client signature.
 * The caller must independently authenticate the operator assignment and fresh payment backing.
 * @param options Original payment, independently selected policy/target and untrusted proof.
 */
export async function verifyExecutionAuthorization(options: {payment: PaymentIntentWire; policy: ExecutionConsentPolicy;
  expected: ExpectedExecution; authorization: ExecutionAuthorization}): Promise<void> {
  exactObject(options.authorization, ['certificate', 'stage', 'operator_key', 'body_hash', 'expires', 'signature'])
  certificateShape(options.authorization.certificate)
  const payment = structuredClone(options.payment), policy = {...options.policy}
  const {expected, bodyHash} = expectedSnapshot(options.expected), proof = structuredClone(options.authorization)
  await paymentConsent(payment, policy); await certified(payment, proof.certificate, policy)
  if (proof.stage !== expected.stage || proof.operator_key.toLowerCase() !== expected.operatorKey.toLowerCase()
    || proof.expires <= policy.nowSecs || proof.body_hash.toLowerCase() !== bodyHash.toLowerCase()) throw new Error('Execution approval differs from the intended live stage and body')
  keeperTarget(payment, proof.stage, proof.operator_key)
  const hash = protocolHex(hashTypedData(executionApprovalTypedData(payment, proof)), 32, 'execution approval hash')
  if (!strictSignature(protocolHex(proof.signature, 64, 'execution signature'), hash, strongKey(proof.certificate.execution_key))) throw new Error('Invalid client execution signature')
}

/**
 * Reconstruct the durable binding shared with the worker and accountant journals.
 * This is a commitment helper, not permission to execute or evidence of correct computation.
 * @param payment Original locally retained payment.
 * @param consent Public original consent; never includes the private request preimage.
 * @param reservationBlock Canonical block hash at the worker's original admission.
 */
export function executionConsentBinding(payment: PaymentIntentWire, consent: ExecutionConsent, reservationBlock: Hex): Hex {
  exactObject(consent, ['authorization', 'inputs_commitment', 'verified_at'])
  exactObject(consent.authorization, ['certificate', 'stage', 'operator_key', 'body_hash', 'expires', 'signature'])
  certificateShape(consent.authorization.certificate)
  integer(consent.verified_at)
  const inputs = consent.inputs_commitment
  jsonShape(inputs, 0, {remaining: 64})
  // Array.from alone would silently truncate malformed or out-of-range wire bytes.
  if (!Array.isArray(inputs) || inputs.length !== 32 || inputs.some(n => !Number.isInteger(n) || n < 0 || n > 255)
    || Object.keys(inputs).length !== 32 || inputs.every(n => n === 0) || consent.verified_at === 0) throw new Error('Invalid durable execution consent')
  const block = protocolHex(reservationBlock, 32, 'execution reservation block')
  if (block.every(n => n === 0)) throw new Error('Missing execution reservation block')
  const clock = new Uint8Array(8)
  new DataView(clock.buffer).setBigUint64(0, BigInt(consent.verified_at))
  const approval = protocolHex(hashTypedData(executionApprovalTypedData(payment, consent.authorization)), 32, 'execution approval hash')
  return keccak256(toHex(new Uint8Array([...new TextEncoder().encode('keykeeper/client-approved-execution-binding/v1'),
    ...approval, ...inputs, ...clock, ...block])))
}

/**
 * Verify public financial consent at its original admission time. The caller must first
 * authenticate the historical creator, reserved cost, canonical block and operator assignment.
 * Work admission must continue to use verifyExecutionAuthorization with the complete body.
 * @param options Independently established history and worker binding, plus untrusted consent.
 */
export async function verifyExecutionConsent(options: {payment: PaymentIntentWire; policy: ExecutionConsentPolicy;
  consent: ExecutionConsent; expected: {stage: ExecutionStage; operatorKey: Hex; reservationBlock: Hex; executionBinding: Hex}}): Promise<void> {
  const binding = executionConsentBinding(options.payment, options.consent, options.expected.reservationBlock)
  const payment = structuredClone(options.payment), consent = structuredClone(options.consent)
  const policy = {...options.policy}, expected = {...options.expected}, proof = consent.authorization
  stage(expected.stage); strongKey(expected.operatorKey)
  protocolHex(expected.executionBinding, 32, 'expected execution binding')
  if (policy.nowSecs !== consent.verified_at || binding.toLowerCase() !== expected.executionBinding.toLowerCase()
    || proof.stage !== expected.stage || proof.operator_key.toLowerCase() !== expected.operatorKey.toLowerCase()
    || proof.expires <= policy.nowSecs) throw new Error('Original client consent differs from execution evidence')
  await paymentConsent(payment, policy); await certified(payment, proof.certificate, policy)
  keeperTarget(payment, proof.stage, proof.operator_key)
  const hash = protocolHex(hashTypedData(executionApprovalTypedData(payment, proof)), 32, 'execution approval hash')
  if (!strictSignature(protocolHex(proof.signature, 64, 'execution signature'), hash,
    strongKey(proof.certificate.execution_key))) throw new Error('Invalid original client execution signature')
}

/**
 * Approve a complete proposal ONLY after comparing it with a separately client-built body.
 * Applications must construct expected.body from their own intent and validated presentation,
 * never echo an agent's proposal into that field. This helper performs no automatic HTTP dispatch.
 * @param options Original consent, certified local signer, independent expected body and untrusted proposal.
 */
export async function approveExecutionRequest(options: {payment: PaymentIntentWire; certificate: ExecutionCertificate;
  signer: ClientExecutionSigner; policy: ExecutionConsentPolicy; expected: ExpectedExecution; proposal: ExecutionProposal}): Promise<ExecutionAuthorization> {
  certificateShape(options.certificate)
  exactObject(options.proposal, ['stage', 'operator_key', 'unsigned_body', 'expires'])
  bodyShape(options.proposal.unsigned_body)
  const payment = structuredClone(options.payment), certificate = structuredClone(options.certificate), policy = {...options.policy}
  const {expected, bodyHash} = expectedSnapshot(options.expected), proposal = structuredClone(options.proposal), signer = options.signer
  const publicKey = signer.publicKey.slice()
  if (proposal.stage !== expected.stage || proposal.operator_key.toLowerCase() !== expected.operatorKey.toLowerCase()
    || executionBodyHash(proposal.unsigned_body) !== bodyHash) throw new Error('Agent execution proposal differs from the client-built intent')
  if (!equalBytes(publicKey, strongKey(certificate.execution_key))) throw new Error('Local execution signer differs from creator certificate')
  keeperTarget(payment, expected.stage, expected.operatorKey)
  await paymentConsent(payment, policy); await certified(payment, certificate, policy)
  const approval: ExecutionAuthorization = {certificate, stage: expected.stage, operator_key: expected.operatorKey,
    body_hash: bodyHash, expires: proposal.expires, signature: '0x'}
  if (approval.expires <= policy.nowSecs) throw new Error('Execution approval expired')
  const hash = hashTypedData(executionApprovalTypedData(payment, approval))
  approval.signature = toHex(await signer.sign(protocolHex(hash, 32, 'execution approval hash')))
  await verifyExecutionAuthorization({payment, policy, expected, authorization: approval})
  return approval
}

/**
 * Reconstruct session initialization typed data from the original payment and client-built commitments.
 * @param payment Original locally retained creator payment.
 * @param initialization Certificate, approved profile hash, complete create-body hash and expiry.
 */
export function executionInitializationTypedData(payment: PaymentIntentWire, initialization: Omit<SessionInitialization, 'signature'>) {
  integer(initialization.expires)
  protocolHex(initialization.profile_hash, 32, 'approved agent profile hash')
  protocolHex(initialization.body_hash, 32, 'session creation body hash')
  if (initialization.expires === 0 || initialization.expires > initialization.certificate.expires
    || [initialization.profile_hash, initialization.body_hash].some(hash => /^0x0{64}$/i.test(hash))) throw new Error('Invalid session initialization expiry or commitment')
  return {domain: {name: EXECUTION_INITIALIZATION_DOMAIN, version: '1', chainId: payment.chain_id, verifyingContract: payment.settlement},
    primaryType: 'ClientSessionInitialization' as const, types: INITIALIZATION_TYPES,
    message: {...common(payment), certificateHash: hashTypedData(executionCertificateTypedData(payment, initialization.certificate)),
      profileHash: initialization.profile_hash, bodyHash: initialization.body_hash, expires: BigInt(initialization.expires)}}
}

function initializationSnapshot(expected: ExpectedInitialization): ExpectedInitialization {
  exactObject(expected, ['serviceProfile', 'body'])
  if (Object.hasOwn(expected.body, 'execution_initialization')) throw new Error('Session body must exclude its initialization envelope')
  executionBodyHash(expected.serviceProfile); executionBodyHash(expected.body)
  return structuredClone(expected)
}

/**
 * Verify fresh client consent before creating or retrying a registered agent session.
 * @param options Independently selected profile/body/policy, original payment and untrusted proof.
 */
export async function verifySessionInitialization(options: {payment: PaymentIntentWire; policy: ExecutionConsentPolicy;
  expected: ExpectedInitialization; initialization: SessionInitialization}): Promise<void> {
  exactObject(options.initialization, ['certificate', 'profile_hash', 'body_hash', 'expires', 'signature'])
  certificateShape(options.initialization.certificate)
  const payment = structuredClone(options.payment), policy = {...options.policy}
  const expected = initializationSnapshot(options.expected), proof = structuredClone(options.initialization)
  await paymentConsent(payment, policy); await certified(payment, proof.certificate, policy)
  if (proof.expires <= policy.nowSecs) throw new Error('Session initialization expired')
  if (proof.profile_hash.toLowerCase() !== executionBodyHash(expected.serviceProfile)
    || proof.body_hash.toLowerCase() !== executionBodyHash(expected.body)) throw new Error('Session initialization differs from the approved agent and client body')
  const hash = protocolHex(hashTypedData(executionInitializationTypedData(payment, proof)), 32, 'session initialization hash')
  if (!strictSignature(protocolHex(proof.signature, 64, 'session initialization signature'), hash, strongKey(proof.certificate.execution_key))) throw new Error('Invalid client session initialization signature')
}

/**
 * Authorize one client-built creation body, including a locally generated owner bearer.
 * Retain the body, proof and signer privately until expiry: retrying the identical POST uses
 * the hash of these typed data as its session ID and cannot replace the original ECDH key.
 * This function neither reserves funds nor starts or pays an operator.
 * @param options Original payment, certified client signer and independently approved create intent.
 */
export async function initializeExecutionSession(options: {payment: PaymentIntentWire; certificate: ExecutionCertificate;
  signer: ClientExecutionSigner; policy: ExecutionConsentPolicy; expected: ExpectedInitialization; expires: number}): Promise<SessionInitialization> {
  certificateShape(options.certificate)
  const payment = structuredClone(options.payment), policy = {...options.policy}, certificate = structuredClone(options.certificate)
  const expected = initializationSnapshot(options.expected), signer = options.signer, publicKey = signer.publicKey.slice(), expires = options.expires
  if (!equalBytes(publicKey, strongKey(certificate.execution_key))) throw new Error('Local execution signer differs from creator certificate')
  await paymentConsent(payment, policy); await certified(payment, certificate, policy)
  const proof: SessionInitialization = {certificate, profile_hash: executionBodyHash(expected.serviceProfile),
    body_hash: executionBodyHash(expected.body), expires, signature: '0x'}
  if (proof.expires <= policy.nowSecs) throw new Error('Session initialization expired')
  const hash = hashTypedData(executionInitializationTypedData(payment, proof))
  proof.signature = toHex(await signer.sign(protocolHex(hash, 32, 'session initialization hash')))
  await verifySessionInitialization({payment, policy, expected, initialization: proof})
  return proof
}

/**
 * Create a disposable client-only Ed25519 execution signer. The seed is copied or generated
 * with Web Crypto, retained only locally and erased by dispose; caller copies remain its responsibility.
 * The copy never shares memory with the caller's bytes (a Node `Buffer` or any view of a larger
 * buffer included), so the caller may wipe its seed at once and dispose never touches it.
 * @param seed Optional local 32-byte seed, for private persistence or deterministic tests.
 */
export function createLocalExecutionSigner(seed?: Uint8Array): LocalExecutionSigner {
  // Uint8Array.from, never seed.slice(): Buffer#slice is a VIEW, so the caller wiping its seed
  // would zero this signer's secret while its publicKey still names the original key.
  if (seed !== undefined && !(seed instanceof Uint8Array)) throw new Error('Execution seed must contain 32 bytes')
  const secret = seed === undefined ? globalThis.crypto.getRandomValues(new Uint8Array(32)) : Uint8Array.from(seed)
  if (secret.length !== 32) {secret.fill(0); throw new Error('Execution seed must contain 32 bytes')}
  const publicKey = ed25519.getPublicKey(secret)
  let disposed = false
  return {get publicKey() {return publicKey.slice()}, async sign(message) {
    if (disposed) throw new Error('Local execution signer was disposed')
    if (message.length !== 32) throw new Error('Execution signer accepts only reconstructed 32-byte hashes')
    return ed25519.sign(Uint8Array.from(message), secret)
  }, dispose() {secret.fill(0); disposed = true}}
}
