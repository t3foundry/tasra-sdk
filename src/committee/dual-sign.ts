import {equalBytes} from '@noble/curves/abstract/utils'
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

export class OperationOutcomeUnknownError extends TasraError {
  constructor(readonly operation: 'dual-create' | 'dual-approve', readonly requestId?: string, cause?: unknown) {
    super(`${operation}: outcome unknown; reconcile before submitting again`, {cause})
  }
}

function requestIdentifier(id: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new TasraError('Invalid dual-sign request ID')
}

/** Exact existing Rust canonical_dual_sig_payload, including little-endian lengths. */
export function dualSignApprovalPayload(slotId: string, message: Uint8Array, requestId: string): Uint8Array {
  requestIdentifier(requestId)
  const fields = [protocolHex(slotId, 32, 'slot id'), sha256(message), utf8ToBytes(requestId)]
  return concatBytes(utf8ToBytes('keykeeper:dual-sig:v1'), ...fields.flatMap(value => {
    const size = new Uint8Array(8)
    new DataView(size.buffer).setBigUint64(0, BigInt(value.length), true)
    return [size, value]
  }))
}

export interface DualSignConfig {
  chainId: number
  nodeUrl: string
  slotId: string
  groupPublicKey: Uint8Array
  /** Expected approver quorum, read from the slot policy. Not the keeper threshold. */
  quorum: number
  credentialGated: boolean
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export type DualSignStatus =
  | {status: 'pending' | 'signing'; have: number; need: number}
  | {status: 'signed'; result: FrostSignResult}
  | {status: 'failed'}

export interface DualSignApprover {
  publicKey: Uint8Array
  /** Sign the exact supplied canonical bytes; the SDK verifies the result locally. */
  sign: (payload: Uint8Array) => Promise<Uint8Array>
}

export interface DualSignRequest {
  readonly requestId: string
  readonly slotId: string
  readonly nodeUrl: string
  status(options?: {signal?: AbortSignal}): Promise<DualSignStatus>
  approve(options: {
    signer: DualSignApprover
    /** Each credentialed approval needs its own request-bound wallet presentation. */
    authorization?: {token: CompoundTokenWire; verifierProofs: VerifierProof[]}
    signal?: AbortSignal
  }): Promise<DualSignStatus>
  wait(options?: {signal?: AbortSignal; timeoutMs?: number; intervalMs?: number; onStatus?: (status: DualSignStatus) => void}): Promise<FrostSignResult>
}

/**
 * Native multi-approver FROST lifecycle. Never falls back to a JWT route or creates
 * a new request after an ambiguous POST. All approval and result checks use the
 * original expected message, slot, public key and quorum, not server-selected values.
 */
export function createDualSignClient(input: DualSignConfig): {
  create(message: Uint8Array, options?: {signal?: AbortSignal}): Promise<DualSignRequest>
  resume(requestId: string, expectedMessage: Uint8Array): DualSignRequest
} {
  const slot = protocolHex(input.slotId, 32, 'slot id'), key = input.groupPublicKey.slice()
  if (key.length !== 32 || !Number.isSafeInteger(input.quorum) || input.quorum < 1 || !Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new TasraError('Invalid dual-sign chain, key or quorum')
  const nodeUrl = input.nodeUrl.replace(/\/$/, ''), slotId = '0x' + bytesToHex(slot)
  const quorum = input.quorum, chainId = input.chainId, credentialed = input.credentialGated, fetchImpl = input.fetchImpl ?? fetch
  const timeoutMs = input.timeoutMs ?? 30_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new TasraError('Invalid request timeout')

  async function http(path: string, signal?: AbortSignal, body?: unknown, requestId?: string): Promise<Record<string, unknown>> {
    signal?.throwIfAborted()
    const deadline = AbortSignal.timeout(timeoutMs)
    let response: Response
    try {
      response = await fetchImpl(nodeUrl + path, {method: body === undefined ? 'GET' : 'POST',
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
  function handle(requestId: string, message: Uint8Array): DualSignRequest {
    requestIdentifier(requestId)
    const original = message.slice(), path = '/v1/dual-sign/' + requestId
    const status = async (options: {signal?: AbortSignal} = {}): Promise<DualSignStatus> => {
      const d = await http(path, options.signal)
      if (d.status === 'signed') return {status: 'signed', result: signed(d.reply, original)}
      if (d.status === 'failed') return {status: 'failed'}
      if (d.status !== 'pending' && d.status !== 'signing') throw new TasraError('Invalid dual-sign status')
      bound(d, original)
      return {status: d.status, ...counts(d)}
    }
    return Object.freeze({requestId, slotId, nodeUrl, status,
      async approve(options: Parameters<DualSignRequest['approve']>[0]): Promise<DualSignStatus> {
        const before = await status({signal: options.signal})
        if (before.status !== 'pending') return before
        if (credentialed !== Boolean(options.authorization)) throw new TasraError('Dual-sign approval authorization does not match the slot policy')
        const publicKey = options.signer.publicKey.slice()
        const payload = dualSignApprovalPayload(slotId, original, requestId)
        const grant = options.authorization && structuredClone(options.authorization)
        if (grant && (!equalBytes(protocolHex(grant.token.slot_id, 32, 'grant slot'), slot) || !grant.verifierProofs.length ||
          grant.token.binding !== 'holder_key' || !Number.isSafeInteger(grant.token.exp) || grant.token.exp * 1000 <= Date.now() ||
          !equalBytes(protocolHex(grant.token.request_hash, 32, 'approval request hash'), requestHash(chainId, slot, 'dual-approve', sha256(payload))))) {
          throw new TasraError('Approval grant must bind this request and holder and include verifier proofs')
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
      const d = await http('/v1/dual-sign', options.signal, {key_slot_id: slotId, message_hex: bytesToHex(original)})
      try {
        bound(d, original)
        counts(d)
        if (d.have !== 0 || d.credential_gated !== credentialed || typeof d.request_id !== 'string') throw new TasraError('Invalid dual-sign creation reply')
        return handle(d.request_id, original)
      } catch (cause) { throw new OperationOutcomeUnknownError('dual-create', typeof d.request_id === 'string' ? d.request_id : undefined, cause) }
    },
    resume: handle,
  }
}
