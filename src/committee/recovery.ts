import {ed25519} from '@noble/curves/ed25519'
import {equalBytes} from '@noble/curves/utils.js'
import {sha256} from '@noble/hashes/sha256'
import {keccak256, toHex, type Hex} from 'viem'
import {assertPaymentIntentWire, paymentIntentHash, prepaidRequestId, type PaymentIntentWire} from './payment.js'
import {executionConsentBinding, MAX_EXECUTION_BODY_BYTES, verifyExecutionConsent,
  type ClientExecutionSigner, type ExecutionConsent, type ExecutionConsentPolicy, type ExecutionStage} from './execution.js'
import {protocolHex} from './receipts.js'
import {parseExecutionJson} from './recoveryJson.js'

const STAGES = {coordinator: 0, contributor: 1, presentation_sign: 2, presentation_attest: 3, credential: 4} as const
const ACTIONS = {sign: 0, decrypt: 1, 'eoa-sign': 2, 'ibe-extract': 3, 'dual-approve': 6} as const

/** Exact request identity in the keeper's public evidence; wire bytes are unsigned arrays. */
export interface PaidExecutionRequest {
  /** Original deployment chain ID. */
  chain_id: number
  /** Settlement address left-padded to 32 bytes. */
  settlement: number[]
  /** Original slot. */
  slot: number[]
  /** Stable paid action ordinal, not an arbitrary enum supplied by a server. */
  action: number
  /** Original operation payload commitment. */
  payload_digest: number[]
  /** Locally retained creator payment hash. */
  authorization_commitment: number[]
}

/** Completed durable work report. Recovery deliberately refuses non-success outcomes. */
export interface CompletedPaidExecutionReport {
  /** Exact original reserved request. */
  request: PaidExecutionRequest
  /** Worker identity, matched to independently authenticated assignment. */
  operator_key: number[]
  /** Original paid stage. */
  stage: ExecutionStage
  /** Original client consent, input and backing binding. */
  binding: number[]
  /** Original canonical admission block, not the latest block. */
  reservation_block: number[]
  /** Original reserved fee, unsigned big-endian TASRA base units. */
  cost: number[]
  /** Successful result commitment; absence or failure never triggers another execution. */
  outcome: {succeeded: {result_commitment: number[]}}
}

/** Untrusted public evidence from a keeper; authenticated before a recovery request is signed. */
export interface SignedPaidExecutionReport {
  /** Completed report; not a work permit or a computation proof. */
  report: CompletedPaidExecutionReport
  /** Registered worker's Ed25519 signature over the report signing hash. */
  signature: Hex
  /** Original client approval retained alongside the durable paid start. */
  consent: ExecutionConsent
}

/** Fresh client authorization to read one exact retained result; grants no work or fee authority. */
export interface ExecutionRecoveryAuthorization {
  /** Independently selected stage. */
  stage: ExecutionStage
  /** Independently authenticated serving worker. */
  operator_key: Hex
  /** Exact original execution binding from authenticated evidence. */
  execution_binding: Hex
  /** Fresh client clock, within the service's 60-second read window and two-second future skew. */
  issued_at: number
  /** Nonzero client-generated read correlation nonce; repeated reads remain permitted. */
  nonce: Hex
  /** Original creator-certified client's fresh Ed25519 signature. */
  signature: Hex
}

/** Independently selected worker and original client key; never copied from a received report. */
export interface ExecutionRecoveryTarget {
  /** Stage whose completed result the application intends to read. */
  stage: ExecutionStage
  /** Key authenticated from the signed keeper assignment and canonical historical roster. */
  operatorKey: Hex
  /** Public key retained from the client's original creator certificate. */
  executionKey: Hex
}

/** Keeper recovery response containing exact committed JSON bytes as a string. */
export interface RecoveredExecutionReply {
  /** Signed evidence for these exact bytes and their original paid admission. */
  execution: SignedPaidExecutionReport
  /** Explicit commitment scheme; matched to the independently retained action. */
  encoding: 'json' | 'ibe-extract'
  /** Exact retained JSON; parsing or reserializing before hashing changes its commitment. */
  result_json: string
}

function exact(value: object, fields: readonly string[]): void {
  if (!value || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Invalid execution evidence object')
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Object.getOwnPropertySymbols(value).length || Object.keys(descriptors).length !== fields.length
    || fields.some(field => !Object.hasOwn(descriptors, field))
    || Object.values(descriptors).some(d => !d.enumerable || !Object.hasOwn(d, 'value'))) throw new Error('Execution evidence has missing or unknown fields')
}
function bytes32(value: number[]): Uint8Array {
  if (!Array.isArray(value) || value.length !== 32 || Object.keys(value).length !== 32
    || Object.getOwnPropertySymbols(value).length
    || Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !Object.hasOwn(d, 'value'))
    || value.some(n => !Number.isInteger(n) || n < 0 || n > 255)) throw new Error('Execution evidence requires 32 unsigned bytes')
  for (let i = 0; i < 32; i++) if (!Object.hasOwn(value, i)) throw new Error('Execution evidence requires a dense byte array')
  return Uint8Array.from(value)
}
function nonzero(bytes: Uint8Array): Uint8Array {
  if (bytes.every(n => n === 0)) throw new Error('Missing execution evidence commitment')
  return bytes
}
function ordinal(stage: ExecutionStage): number {
  if (!Object.hasOwn(STAGES, stage)) throw new Error('Unknown execution stage')
  return STAGES[stage]
}
function uint64(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid execution recovery clock')
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value))
  return bytes
}
function primeKey(hex: Hex): Uint8Array {
  const key = protocolHex(hex, 32, 'execution recovery key'), point = ed25519.Point.fromHex(key, false)
  if (point.isSmallOrder() || !point.isTorsionFree()) throw new Error('Invalid execution recovery public key')
  return key
}
function packed(domain: string, ...parts: Uint8Array[]): Hex {
  return keccak256(toHex(new Uint8Array([...new TextEncoder().encode(domain), ...parts.flatMap(p => [...p])])))
}
function matchesRequest(payment: PaymentIntentWire, request: PaidExecutionRequest): void {
  assertPaymentIntentWire(payment)
  exact(request, ['chain_id', 'settlement', 'slot', 'action', 'payload_digest', 'authorization_commitment'])
  const settlement = new Uint8Array(32)
  settlement.set(protocolHex(payment.settlement, 20, 'payment Settlement'), 12)
  if (request.chain_id !== payment.chain_id || request.action !== ACTIONS[payment.action]
    || !equalBytes(bytes32(request.settlement), settlement)
    || toHex(bytes32(request.slot)).toLowerCase() !== payment.slot.toLowerCase()
    || toHex(bytes32(request.payload_digest)).toLowerCase() !== payment.payload_digest.toLowerCase()
    || toHex(bytes32(request.authorization_commitment)).toLowerCase() !== paymentIntentHash(payment).toLowerCase()) throw new Error('Execution evidence differs from the retained payment')
}

/**
 * Build a public evidence query identity from the locally retained payment, never a server proposal.
 * @param payment Original creator-signed payment. This does not disclose private operation inputs.
 */
export function paidExecutionRequest(payment: PaymentIntentWire): PaidExecutionRequest {
  assertPaymentIntentWire(payment)
  const settlement = new Uint8Array(32)
  settlement.set(protocolHex(payment.settlement, 20, 'payment Settlement'), 12)
  return {chain_id: payment.chain_id, settlement: [...settlement], slot: [...protocolHex(payment.slot, 32, 'payment slot')],
    action: ACTIONS[payment.action], payload_digest: [...protocolHex(payment.payload_digest, 32, 'payment payload digest')],
    authorization_commitment: [...protocolHex(paymentIntentHash(payment), 32, 'payment hash')]}
}

/**
 * Reconstruct the Rust worker signing hash for a completed result. This does not verify its signer.
 * @param payment Original retained creator payment, used to recompute the complete request identity.
 * @param report Untrusted completed report with strict wire shape.
 */
export function paidExecutionReportSigningHash(payment: PaymentIntentWire, report: CompletedPaidExecutionReport): Hex {
  exact(report, ['request', 'operator_key', 'stage', 'binding', 'reservation_block', 'cost', 'outcome'])
  matchesRequest(payment, report.request)
  exact(report.outcome, ['succeeded']); exact(report.outcome.succeeded, ['result_commitment'])
  return packed('keykeeper/prepaid-execution-report/v1', protocolHex(prepaidRequestId(payment), 32, 'request ID'),
    nonzero(bytes32(report.operator_key)), Uint8Array.of(ordinal(report.stage)), nonzero(bytes32(report.binding)),
    nonzero(bytes32(report.reservation_block)), nonzero(bytes32(report.cost)), Uint8Array.of(2),
    nonzero(bytes32(report.outcome.succeeded.result_commitment)))
}

/**
 * Authenticate public recovery evidence against independently established historical financial policy.
 * The policy time must equal the original accepted time, not the current recovery clock.
 * @param options Retained payment/client identity, historical creator and fee, expected worker and untrusted evidence.
 */
export async function verifyPaidExecutionEvidence(options: {payment: PaymentIntentWire; policy: ExecutionConsentPolicy;
  target: ExecutionRecoveryTarget; execution: SignedPaidExecutionReport}): Promise<void> {
  exact(options.execution, ['report', 'signature', 'consent'])
  const hash = paidExecutionReportSigningHash(options.payment, options.execution.report)
  executionConsentBinding(options.payment, options.execution.consent, toHex(bytes32(options.execution.report.reservation_block)))
  const payment = structuredClone(options.payment), policy = {...options.policy}, target = {...options.target}
  const execution = structuredClone(options.execution), report = execution.report
  const key = primeKey(target.operatorKey)
  if (report.stage !== target.stage || !equalBytes(bytes32(report.operator_key), key)
    || BigInt(toHex(bytes32(report.cost))) !== policy.cost
    || !equalBytes(primeKey(target.executionKey), primeKey(execution.consent.authorization.certificate.execution_key))) throw new Error('Recovery evidence identity or TASRA fee mismatch')
  if (!ed25519.verify(protocolHex(execution.signature, 64, 'worker execution signature'), protocolHex(hash, 32, 'execution report hash'), key,
    {zip215: false})) throw new Error('Invalid worker execution signature')
  await verifyExecutionConsent({payment, policy, consent: execution.consent, expected: {stage: target.stage, operatorKey: target.operatorKey,
    reservationBlock: toHex(bytes32(report.reservation_block)), executionBinding: toHex(bytes32(report.binding))}})
}

/**
 * Reconstruct the domain-separated fresh read hash. It cannot authorize another paid operation.
 * @param payment Original payment, including its signed assignment and complete request identity.
 * @param authorization Exact stage, worker, original binding, clock and client nonce.
 */
export function executionRecoverySigningHash(payment: PaymentIntentWire, authorization: Omit<ExecutionRecoveryAuthorization, 'signature'>): Hex {
  assertPaymentIntentWire(payment)
  return packed('keykeeper/client-execution-recovery/v1', protocolHex(prepaidRequestId(payment), 32, 'request ID'),
    Uint8Array.of(ordinal(authorization.stage)), primeKey(authorization.operator_key),
    nonzero(protocolHex(authorization.execution_binding, 32, 'recovery execution binding')), uint64(authorization.issued_at),
    nonzero(protocolHex(authorization.nonce, 32, 'recovery nonce')))
}

/**
 * Ask the original local client for a fresh read signature only after verifying work and financial evidence.
 * Applications must supply independently authenticated canonical history, not a server-provided policy.
 * @param options Retained payment, independently selected worker/client, historical policy and fresh clock.
 */
export async function createExecutionRecoveryAuthorization(options: {payment: PaymentIntentWire; policy: ExecutionConsentPolicy;
  target: ExecutionRecoveryTarget; execution: SignedPaidExecutionReport; signer: ClientExecutionSigner;
  nowSecs: number; nonce?: Hex}): Promise<ExecutionRecoveryAuthorization> {
  exact(options.execution, ['report', 'signature', 'consent'])
  paidExecutionReportSigningHash(options.payment, options.execution.report)
  executionConsentBinding(options.payment, options.execution.consent, toHex(bytes32(options.execution.report.reservation_block)))
  const payment = structuredClone(options.payment), policy = {...options.policy}, target = {...options.target}
  const execution = structuredClone(options.execution), signer = options.signer, publicKey = signer.publicKey.slice(), now = options.nowSecs
  uint64(now)
  if (execution.consent.verified_at > now + 2 || !equalBytes(publicKey, primeKey(target.executionKey))) throw new Error('Recovery requires the original client and a fresh clock')
  const nonce = options.nonce ?? toHex(globalThis.crypto.getRandomValues(new Uint8Array(32)))
  await verifyPaidExecutionEvidence({payment, policy, target, execution})
  const unsigned = {stage: target.stage, operator_key: target.operatorKey, execution_binding: toHex(bytes32(execution.report.binding)), issued_at: now, nonce}
  const hash = protocolHex(executionRecoverySigningHash(payment, unsigned), 32, 'execution recovery hash')
  const signature = await signer.sign(hash.slice())
  if (signature.length !== 64 || !ed25519.verify(signature, hash, primeKey(target.executionKey), {zip215: false})) throw new Error('Invalid local execution recovery signature')
  return {...unsigned, signature: toHex(signature)}
}

function resultCommitment(payment: PaymentIntentWire, reply: RecoveredExecutionReply): Hex {
  if (typeof reply.result_json !== 'string' || reply.result_json.length > MAX_EXECUTION_BODY_BYTES) throw new Error('Invalid recovered result size')
  const bytes = new TextEncoder().encode(reply.result_json)
  if (bytes.length === 0 || bytes.length > MAX_EXECUTION_BODY_BYTES
    || new TextDecoder('utf-8', {fatal: true}).decode(bytes) !== reply.result_json) throw new Error('Invalid recovered result encoding')
  const domain = new TextEncoder().encode(payment.action === 'ibe-extract' ? 'keykeeper/prepaid-ibe-result/v1' : 'keykeeper/prepaid-execution-result/v1')
  if (payment.action !== 'ibe-extract') {
    if (reply.encoding !== 'json') throw new Error('Recovered result commitment scheme mismatch')
    return toHex(sha256(new Uint8Array([...domain, ...bytes])))
  }
  if (reply.encoding !== 'ibe-extract') throw new Error('Recovered result commitment scheme mismatch')
  // Inspect only the fields in the existing IBE commitment; later audit metadata is not its preimage.
  const value = parseExecutionJson(bytes, MAX_EXECUTION_BODY_BYTES)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid recovered IBE result')
  const share = value as Record<string, unknown>
  if (typeof share.key_slot_id !== 'string' || typeof share.epoch !== 'number' || !Number.isSafeInteger(share.epoch)
    || typeof share.identifier !== 'number' || !Number.isInteger(share.identifier) || share.identifier < 0 || share.identifier > 65535
    || typeof share.extraction_share !== 'string' || typeof share.verifying_share !== 'string'
    || share.key_slot_id.replace(/^0x/, '').toLowerCase() !== payment.slot.slice(2).toLowerCase()) throw new Error('Invalid recovered IBE commitment fields')
  const epoch = new Uint8Array(8), identifier = new Uint8Array(2)
  new DataView(epoch.buffer).setBigInt64(0, BigInt(share.epoch)); new DataView(identifier.buffer).setUint16(0, share.identifier)
  return toHex(sha256(new Uint8Array([...domain, ...protocolHex(share.key_slot_id, 32, 'IBE slot'), ...epoch, ...identifier,
    ...new TextEncoder().encode(share.extraction_share), ...new TextEncoder().encode(share.verifying_share)])))
}

/**
 * Verify the returned worker evidence and exact result bytes against the previously authenticated report.
 * Returns the retained JSON string only after its commitment matches; callers decode the operation's
 * internal result format themselves. It may differ from the original HTTP envelope and audit metadata.
 * @param options Original identity and history, authenticated expected report, and untrusted response.
 */
export async function verifyRecoveredExecutionResult(options: {payment: PaymentIntentWire; policy: ExecutionConsentPolicy;
  target: ExecutionRecoveryTarget; expectedExecution: SignedPaidExecutionReport; reply: RecoveredExecutionReply}): Promise<string> {
  exact(options.reply, ['execution', 'encoding', 'result_json'])
  const payment = structuredClone(options.payment), policy = {...options.policy}, target = {...options.target}
  const expectedExecution = structuredClone(options.expectedExecution), reply = structuredClone(options.reply)
  await verifyPaidExecutionEvidence({payment, policy, target, execution: expectedExecution})
  await verifyPaidExecutionEvidence({payment, policy, target, execution: reply.execution})
  if (paidExecutionReportSigningHash(payment, expectedExecution.report) !== paidExecutionReportSigningHash(payment, reply.execution.report)
    || resultCommitment(payment, reply).toLowerCase() !== toHex(bytes32(expectedExecution.report.outcome.succeeded.result_commitment))) throw new Error('Recovered execution result commitment mismatch')
  // Require JSON after authenticating exact bytes; canonicalizing here would change the committed format.
  parseExecutionJson(new TextEncoder().encode(reply.result_json), MAX_EXECUTION_BODY_BYTES)
  return reply.result_json
}
