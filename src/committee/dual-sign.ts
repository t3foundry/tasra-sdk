import {equalBytes} from '@noble/curves/utils.js'
import {ed25519} from '@noble/curves/ed25519'
import {sha256} from '@noble/hashes/sha256'
import {bytesToHex, concatBytes, utf8ToBytes} from '@noble/hashes/utils'
import {verify} from '../crypto/frost.js'
import {TasraError, httpError} from '../errors.js'
import type {FrostSignResult} from '../signing/frost.js'
import type {CompoundTokenWire} from './token.js'
import type {VerifierProof} from './client.js'
import {decodeOperationReceipt, protocolHex} from './receipts.js'
import {requestHash} from '../oid4vp/binding.js'
import {assertPaymentIntentWire, paymentIntentHash, prepaidRequestId, type PaymentIntentWire} from './payment.js'
import {withKeeperExecutionApprovals,type KeeperExecutionApprover} from './keeperExecution.js'

/** A signing request may have been accepted despite a transport or response failure. Reconcile before resubmitting. */
export class OperationOutcomeUnknownError extends TasraError {
  constructor(
    /** Request phase whose submission outcome must be reconciled. */
    readonly operation: 'dual-create' | 'dual-approve',
    /** Existing native signing request identifier, when known. */
    readonly requestId?: string, cause?: unknown) {
    super(`${operation}: outcome unknown; reconcile before submitting again`, {cause})
  }
}

function requestIdentifier(id: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new TasraError('Invalid dual-sign request ID')
}

/**
 * Exact existing Rust canonical_dual_sig_payload, including little-endian lengths.
 *
 * @param slotId - 32-byte slot identifier as hexadecimal text.
 * @param message - Original message bytes to authorize.
 * @param requestId - Existing native signing request identifier.
 */
export function dualSignApprovalPayload(slotId: string, message: Uint8Array, requestId: string): Uint8Array {
  requestIdentifier(requestId)
  const fields = [protocolHex(slotId, 32, 'slot id'), sha256(message), utf8ToBytes(requestId)]
  return concatBytes(utf8ToBytes('keykeeper:dual-sig:v1'), ...fields.flatMap(value => {
    const size = new Uint8Array(8)
    new DataView(size.buffer).setBigUint64(0, BigInt(value.length), true)
    return [size, value]
  }))
}

/**
 * Paid approval bytes, binding the final keeper reservation independently of each
 * credential approval's payment. Matches Rust canonical_paid_dual_sig_payload.
 * @param chainId - Expected deployment chain.
 * @param slotId - Expected slot identifier.
 * @param message - Exact message to sign.
 * @param requestId - Native dual-sign request identifier.
 * @param payment - Final keeper Sign intent, already reserved independently.
 */
export function paidDualSignApprovalPayload(chainId: number, slotId: string, message: Uint8Array,
  requestId: string, payment: PaymentIntentWire): Uint8Array {
  requestIdentifier(requestId)
  assertPaymentIntentWire(payment)
  const slot = protocolHex(slotId, 32, 'slot id'), digest = sha256(message), rid = utf8ToBytes(requestId)
  if (payment.chain_id !== chainId || payment.action !== 'sign' ||
    !equalBytes(protocolHex(payment.slot, 32, 'payment slot'), slot) ||
    !equalBytes(protocolHex(payment.payload_digest, 32, 'payment digest'), digest)) throw new TasraError('Dual-sign payment differs from chain, slot, message or action')
  const chain = new Uint8Array(8), slotSize = new Uint8Array(8), ridSize = new Uint8Array(8)
  new DataView(chain.buffer).setBigUint64(0, BigInt(chainId))
  new DataView(slotSize.buffer).setBigUint64(0, BigInt(slot.length), true)
  new DataView(ridSize.buffer).setBigUint64(0, BigInt(rid.length), true)
  return concatBytes(utf8ToBytes('keykeeper:paid-dual-sig:v1'), chain, slotSize, slot, digest, ridSize, rid,
    protocolHex(paymentIntentHash(payment), 32, 'payment hash'))
}

/** Trusted slot key, keeper endpoint and approver policy for a native signing request. */
export interface DualSignConfig {
  /** Required for paid creation: original client's complete final-work approvals. */
  approveExecution?:KeeperExecutionApprover
  /** Optional pinned final Sign payment for this coordinator; per-call replacements are refused. */
  payment?: PaymentIntentWire
  /** EVM chain identifier. */
  chainId: number
  /** Keeper HTTP base URL. */
  nodeUrl: string
  /** 32-byte slot identifier. */
  slotId: string
  /** Expected 32-byte FROST group public key. */
  groupPublicKey: Uint8Array
  /** Expected approver quorum, read from the slot policy. Not the keeper threshold. */
  quorum: number
  /** Whether every approval requires a request-bound credential authorization. */
  credentialGated: boolean
  /** HTTP transport override; defaults to the global fetch implementation. */
  fetchImpl?: typeof fetch
  /** Timeout for an individual HTTP request in milliseconds. */
  timeoutMs?: number
}

/** Native signing request progress, verified completed signature or terminal failure. */
export type DualSignStatus =
  | {
      /** Lifecycle state: pending or signing until the request is signed or fails. */
      status: 'pending' | 'signing'
      /** Number of accepted approvals collected for the request. */
      have: number
      /** Approval quorum required before signing can finish. */
      need: number
    }
  | {
      /** Lifecycle state: pending or signing until the request is signed or fails. */
      status: 'signed'
      /** Verified signature and its slot-key context. */
      result: FrostSignResult
    }
  | {
      /** Lifecycle state: pending or signing until the request is signed or fails. */
      status: 'failed'
    }
  | {
      /** Work may have started, but its durable outcome is unavailable. Never retry the ceremony. */
      status: 'uncertain'
    }

/** Ed25519 approver public key and callback that signs canonical approval bytes. */
export interface DualSignApprover {
  /** 32-byte Ed25519 approver public key. */
  publicKey: Uint8Array
  /** Sign the exact supplied canonical bytes; the SDK verifies the result locally. */
  sign: (payload: Uint8Array) => Promise<Uint8Array>
}

/** Handle for checking, approving and waiting for one native multi-approver signing request. */
export interface DualSignRequest {
  /** Final keeper Sign intent; each access returns a copy. Credential approvals pay separately. */
  readonly payment?: PaymentIntentWire
  /** Request identifier used to correlate or resume the operation. */
  readonly requestId: string
  /** 32-byte slot identifier. */
  readonly slotId: string
  /** Keeper HTTP base URL. */
  readonly nodeUrl: string
  /** Fetch and validate the current request state. */
  status(options?: {signal?: AbortSignal}): Promise<DualSignStatus>
  /** Sign and submit one approval, with credential authorization when required. */
  approve(options: {
    signer: DualSignApprover
    /** Each credentialed approval needs its own request-bound wallet presentation. */
    authorization?: {token: CompoundTokenWire; verifierProofs: VerifierProof[]}
    signal?: AbortSignal
  }): Promise<DualSignStatus>
  /** Poll until a verified signature is available or the request fails or times out. */
  wait(options?: {signal?: AbortSignal; timeoutMs?: number; intervalMs?: number; onStatus?: (status: DualSignStatus) => void}): Promise<FrostSignResult>
}

/**
 * Native multi-approver FROST lifecycle. Never falls back to a JWT route or creates
 * a new request after an ambiguous POST. All approval and result checks use the
 * original expected message, slot, public key and quorum, not server-selected values.
 *
 * @param input - Trusted slot key, keeper endpoint and required approver policy.
 */
export function createDualSignClient(input: DualSignConfig): {
  create(message: Uint8Array, options?: {signal?: AbortSignal; payment?: PaymentIntentWire}): Promise<DualSignRequest>
  resume(requestId: string, expectedMessage: Uint8Array, options?: {payment?: PaymentIntentWire}): DualSignRequest
} {
  const slot = protocolHex(input.slotId, 32, 'slot id'), key = input.groupPublicKey.slice()
  if (key.length !== 32 || !Number.isSafeInteger(input.quorum) || input.quorum < 1 || !Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new TasraError('Invalid dual-sign chain, key or quorum')
  const nodeUrl = input.nodeUrl.replace(/\/$/, ''), slotId = '0x' + bytesToHex(slot)
  const quorum = input.quorum, chainId = input.chainId, credentialed = input.credentialGated, fetchImpl = input.fetchImpl ?? fetch
  const approveExecution=input.approveExecution
  const timeoutMs = input.timeoutMs ?? 30_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new TasraError('Invalid request timeout')
  const pinnedPayment = input.payment && structuredClone(input.payment)
  if (pinnedPayment) assertPaymentIntentWire(pinnedPayment)
  function selectedPayment(supplied?: PaymentIntentWire) {
    const payment = supplied && structuredClone(supplied)
    if (payment && pinnedPayment && paymentIntentHash(payment) !== paymentIntentHash(pinnedPayment)) throw new TasraError('Cannot replace the pinned dual-sign payment')
    return payment ?? (pinnedPayment && structuredClone(pinnedPayment))
  }

  async function http(path: string, signal?: AbortSignal, body?: unknown, requestId?: string): Promise<Record<string, unknown>> {
    signal?.throwIfAborted()
    const deadline = AbortSignal.timeout(timeoutMs)
    let response: Response
    try {
      response = await fetchImpl(nodeUrl + path, {method: body === undefined ? 'GET' : 'POST',redirect:'error',credentials:'omit',
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
        headers: {'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body)})
    } catch (cause) {
      if (body !== undefined) throw new OperationOutcomeUnknownError(requestId ? 'dual-approve' : 'dual-create', requestId, cause)
      throw cause
    }
    if (!response.ok) {
      if (body !== undefined && response.status >= 500) throw new OperationOutcomeUnknownError(requestId ? 'dual-approve' : 'dual-create', requestId)
      throw await httpError(response, nodeUrl + path, 'dual-sign')
    }
    try {
      const data: unknown = await response.json()
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new TasraError('Malformed dual-sign response')
      return data as Record<string, unknown>
    } catch (cause) {
      if (body !== undefined) throw new OperationOutcomeUnknownError(requestId ? 'dual-approve' : 'dual-create', requestId, cause)
      throw cause
    }
  }

  function bound(data: Record<string, unknown>, message: Uint8Array) {
    if (!equalBytes(protocolHex(data.key_slot_id, 32, 'reply slot'), slot) ||
      !equalBytes(protocolHex(data.message_sha256, 32, 'reply message hash'), sha256(message))) throw new TasraError('Dual-sign response differs from the approved message or slot')
  }
  function counts(data: Record<string, unknown>) {
    if (data.need !== quorum || !Number.isSafeInteger(data.have) || Number(data.have) < 0 || Number(data.have) > quorum) throw new TasraError('Invalid dual-sign approval quorum')
    return {have: Number(data.have), need: quorum}
  }
  function signed(value: unknown, message: Uint8Array): FrostSignResult {
    if (!value || typeof value !== 'object') throw new TasraError('Missing dual-sign signature')
    const d = value as Record<string, unknown>
    bound(d, message)
    const publicKey = protocolHex(d.group_public_key, 32, 'group public key')
    const signature = {r: protocolHex(d.signature_r, 32, 'signature R'), z: protocolHex(d.signature_z, 32, 'signature z')}
    if (!equalBytes(publicKey, key) || !verify(key, message, signature) || !Number.isSafeInteger(d.epoch) || Number(d.epoch) < 0) throw new TasraError('Invalid dual-sign result')
    const receipt = decodeOperationReceipt(d)
    return {keySlotId: slotId, groupPublicKey: publicKey, signature, messageSha256: sha256(message), epoch: Number(d.epoch), ...(receipt ? {receipt} : {})}
  }
  function handle(requestId: string, message: Uint8Array, options: {payment?: PaymentIntentWire} = {}): DualSignRequest {
    requestIdentifier(requestId)
    const payment = selectedPayment(options.payment)
    if (payment) {
      paidDualSignApprovalPayload(chainId, slotId, message, requestId, payment)
      if (requestId !== prepaidRequestId(payment).slice(2)) throw new TasraError('Dual-sign request differs from final payment')
    }
    const original = message.slice(), path = '/v1/dual-sign/' + requestId
    const status = async (options: {signal?: AbortSignal} = {}): Promise<DualSignStatus> => {
      const d = await http(path, options.signal)
      if (d.status === 'signed') return {status: 'signed', result: signed(d.reply, original)}
      if (d.status === 'failed') return {status: 'failed'}
      if (d.status === 'uncertain') return {status: 'uncertain'}
      if (d.status !== 'pending' && d.status !== 'signing') throw new TasraError('Invalid dual-sign status')
      bound(d, original)
      return {status: d.status, ...counts(d)}
    }
    return Object.freeze({requestId, slotId, nodeUrl, status,
      get payment() { return payment && structuredClone(payment) },
      async approve(options: Parameters<DualSignRequest['approve']>[0]): Promise<DualSignStatus> {
        const before = await status({signal: options.signal})
        if (before.status !== 'pending') return before
        if (credentialed !== Boolean(options.authorization)) throw new TasraError('Dual-sign approval authorization does not match the slot policy')
        const publicKey = options.signer.publicKey.slice()
        if (payment && payment.expires <= Math.floor(Date.now() / 1000)) throw new TasraError('Dual-sign payment expired')
        const payload = payment ? paidDualSignApprovalPayload(chainId, slotId, original, requestId, payment)
          : dualSignApprovalPayload(slotId, original, requestId)
        const grant = options.authorization && structuredClone(options.authorization)
        if (grant && (!equalBytes(protocolHex(grant.token.slot_id, 32, 'grant slot'), slot) || !grant.verifierProofs.length ||
          grant.token.binding !== 'holder_key' || !Number.isSafeInteger(grant.token.exp) || grant.token.exp * 1000 <= Date.now() ||
          !equalBytes(protocolHex(grant.token.request_hash, 32, 'approval request hash'), requestHash(chainId, slot, 'dual-approve', sha256(payload))))) {
          throw new TasraError('Approval grant must bind this request and holder and include verifier proofs')
        }
        if (grant && payment) {
          assertPaymentIntentWire(grant.token.payment)
          const approval = grant.token.payment
          if (approval.action !== 'dual-approve' || approval.chain_id !== chainId || approval.expires <= Math.floor(Date.now() / 1000) ||
            !equalBytes(protocolHex(approval.slot, 32, 'approval slot'), slot) ||
            !equalBytes(protocolHex(approval.payload_digest, 32, 'approval digest'), sha256(payload)) ||
            !equalBytes(protocolHex(grant.token.payment_hash, 32, 'approval payment hash'), protocolHex(paymentIntentHash(approval), 32, 'payment hash'))) {
            throw new TasraError('Credential approval requires its own bound payment')
          }
        }
        const signature = await options.signer.sign(payload.slice())
        options.signal?.throwIfAborted()
        if (publicKey.length !== 32 || signature.length !== 64 || !ed25519.verify(signature, payload, publicKey, {zip215: false})) throw new TasraError('Invalid local approval signature')
        const d = await http(path + '/approve', options.signal, {approver_pubkey: bytesToHex(publicKey), signature: bytesToHex(signature),
          ...(grant ? {committee_token: grant.token, verifier_proofs: grant.verifierProofs.map(p => ({verifier_index: p.verifierIndex,
            operator: p.operator.replace(/^0x/, ''), pubkey: p.pubkey.replace(/^0x/, ''), proof: p.proof.map(x => x.replace(/^0x/, ''))}))} : {})}, requestId)
        try {
          const count = counts(d)
          if (d.signed === true && count.have === count.need) return {status: 'signed', result: signed(d.reply, original)}
          if (d.signed !== false || d.reply != null) throw new TasraError('Invalid dual-sign approval response')
          return {status: 'pending', ...count}
        } catch (cause) { throw new OperationOutcomeUnknownError('dual-approve', requestId, cause) }
      },
      async wait(options: Parameters<DualSignRequest['wait']>[0] = {}): Promise<FrostSignResult> {
        const interval = options.intervalMs ?? 1000, timeout = options.timeoutMs ?? 300_000
        if (!Number.isSafeInteger(interval) || interval <= 0 || !Number.isSafeInteger(timeout) || timeout <= 0) throw new TasraError('Invalid polling interval or timeout')
        const deadline = AbortSignal.timeout(timeout), signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline
        for (;;) {
          signal.throwIfAborted()
          const current = await status({signal})
          options.onStatus?.(current)
          if (current.status === 'signed') return current.result
          if (current.status === 'failed') throw new TasraError('Native dual-sign request failed')
          if (current.status === 'uncertain') throw new OperationOutcomeUnknownError('dual-approve', requestId)
          await new Promise<void>((resolve, reject) => {
            const done = () => { signal.removeEventListener('abort', abort); resolve() }
            const timer = setTimeout(done, interval)
            const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason) }
            signal.addEventListener('abort', abort, {once: true})
            if (signal.aborted) abort()
          })
        }
      },
    })
  }
  return {
    async create(message, options = {}) {
      const original = message.slice()
      const signal=options.signal
      const payment = selectedPayment(options.payment)
      const expectedId = payment && prepaidRequestId(payment).slice(2)
      const payload = payment && paidDualSignApprovalPayload(chainId, slotId, original, expectedId!, payment)
      if (payment && payment.expires <= Math.floor(Date.now() / 1000)) throw new TasraError('Dual-sign payment expired')
      const creationBody=await withKeeperExecutionApprovals({body:{key_slot_id:slotId,message_hex:bytesToHex(original),...(payment?{payment}:{})},
        kind:'dual-sign',nodeUrl,payment,approveExecution,signal})
      let d: Record<string, unknown>
      try {
        d = await http('/v1/dual-sign', signal, creationBody)
      } catch (cause) {
        if (cause instanceof OperationOutcomeUnknownError && expectedId) throw new OperationOutcomeUnknownError('dual-create', expectedId, cause)
        throw cause
      }
      try {
        bound(d, original)
        counts(d)
        if (d.have !== 0 || d.credential_gated !== credentialed || typeof d.request_id !== 'string') throw new TasraError('Invalid dual-sign creation reply')
        if (payment && (d.request_id !== expectedId || !equalBytes(protocolHex(d.approval_payload, payload!.length, 'approval payload'), payload!))) throw new TasraError('Keeper changed paid approval binding')
        return handle(d.request_id, original, {payment})
      } catch (cause) { throw new OperationOutcomeUnknownError('dual-create', expectedId ?? (typeof d.request_id === 'string' ? d.request_id : undefined), cause) }
    },
    resume: handle,
  }
}
