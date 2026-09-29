// The RELYING PARTY half against the Verifier Agent: the app that wants an authorization
// signs the operation tuple with the slot creator's EVM key (EIP-712 `PresentationOperation`),
// opens a session, hands the `openid4vp://` payload to a wallet as a QR or deep link, and later
// collects the compound token. Nothing about the presentation ever comes back here.
//
// Adds EIP-712 operation signing and action-specific payload binding to the session client.

import {bytesToHex, hexToBytes} from '../crypto/hex.js'
import type {CompoundTokenWire} from '../committee/token.js'
import type {VerifierProof} from '../committee/client.js'
import {VerifierAgentSessionError, createOid4vpSession, waitForSession, type CreateSessionResult, type PresentationDelegation, type PresentationOperation, type WaitOpts, type SessionStatusResult} from '../verifier-agent/index.js'
import {payloadDigestFor, requestHash, type CommitteeAction} from './binding.js'
import {utf8} from './jose.js'

export {createOid4vpSession, pollOid4vpSession, waitForSession, payloadDigest, nextPollDelay, assertCompoundTokenWire, VerifierAgentSessionError} from '../verifier-agent/index.js'
export type {SessionPhase, VerifierAgentSessionErrorKind, WaitOpts} from '../verifier-agent/index.js'
export type {CreateSessionParams, CreateSessionResult, PresentationDelegation, PresentationOperation, SessionStatusResult} from '../verifier-agent/index.js'

/** EIP-712 domain name for creator-signed presentation operations. */
export const PRESENTATION_EIP712_NAME = 'Keykeeper Presentation'
/** EIP-712 domain version for creator-signed presentation operations. */
export const PRESENTATION_EIP712_VERSION = '1'

/** The EIP-712 types mirrored from the reference presentation-auth types - do not reorder. */
export const PRESENTATION_OPERATION_TYPES = {
  PresentationOperation: [
    {name: 'chainId', type: 'uint256'},
    {name: 'slotId', type: 'bytes32'},
    {name: 'action', type: 'string'},
    {name: 'payloadDigest', type: 'bytes32'},
    {name: 'description', type: 'string'},
    {name: 'exp', type: 'uint256'},
  ],
} as const

/** Anything that signs EIP-712 typed data for an address - a viem `LocalAccount` or `WalletClient`-bound account fits. */
export interface TypedDataSigner {
  /** EVM address of the creator or delegated signing wallet. */
  address: `0x${string}`
  /** Sign the operation EIP-712 payload using the wallet's key. */
  signTypedData(args: {
    domain: {name: string; version: string; chainId: number; verifyingContract: `0x${string}`}
    types: typeof PRESENTATION_OPERATION_TYPES
    primaryType: 'PresentationOperation'
    message: {chainId: bigint; slotId: `0x${string}`; action: string; payloadDigest: `0x${string}`; description: string; exp: bigint}
  }): Promise<`0x${string}`>
}

/** Slot operation, payload context and authorization lifetime used to construct EIP-712 typed data. */
export interface OperationInput {
  /** EVM chain identifier. */
  chainId: number
  /** The KeyRegistry address - the EIP-712 `verifyingContract`. */
  keyRegistry: `0x${string}`
  /** 32-byte slot identifier. */
  slotId: `0x${string}` | Uint8Array
  /** Operation whose payload and permission are being authorized. */
  action: CommitteeAction
  /** `sign`: the message; `ibe-extract`: use `identity`; `decrypt`/`dual-approve`: use `payloadDigest`. */
  message?: Uint8Array
  /** Exact identity string for an IBE extraction operation. */
  identity?: string
  /** Precomputed 32-byte digest for decrypt or dual-approve. */
  payloadDigest?: Uint8Array
  /** Shown by the wallet as the operation's purpose. */
  description: string
  /** Seconds the authorization stays valid (default 600, the verifier-agent caps at 3600). */
  ttlSecs?: number
  /** Current time override in Unix seconds. */
  nowSecs?: number
}

/**
 * The typed data a creator (or delegate) signs, plus the wire operation and the verifier-agent's `message_hex`.
 *
 * @param input - Network, slot, operation payload, description and authorization lifetime.
 */
export function presentationOperationTypedData(input: OperationInput): {
  typedData: Parameters<TypedDataSigner['signTypedData']>[0]
  operation: PresentationOperation
  messageHex: string
  payloadDigest: Uint8Array
} {
  const slot = typeof input.slotId === 'string' ? hexToBytes(input.slotId) : input.slotId
  if (slot.length !== 32) throw new Error('slotId must be 32 bytes')
  const messageBytes = input.action === 'ibe-extract' ? (input.identity !== undefined ? utf8(input.identity) : undefined) : input.message
  const digest = payloadDigestFor(input.action, {message: input.message, identity: input.identity, payloadDigest: input.payloadDigest})
  // The verifier-agent requires `message_hex` and, for sign / ibe-extract, derives the digest from it; for the
  // other actions the digest is taken as signed, so the digest itself is the message it stores.
  const messageHex = bytesToHex(messageBytes ?? digest)
  const exp = (input.nowSecs ?? Math.floor(Date.now() / 1000)) + (input.ttlSecs ?? 600)
  const operation: PresentationOperation = {
    chain_id: input.chainId,
    slot_id: bytesToHex(slot),
    action: input.action,
    payload_digest: bytesToHex(digest),
    description: input.description,
    exp,
  }
  return {
    typedData: {
      domain: {name: PRESENTATION_EIP712_NAME, version: PRESENTATION_EIP712_VERSION, chainId: input.chainId, verifyingContract: input.keyRegistry},
      types: PRESENTATION_OPERATION_TYPES,
      primaryType: 'PresentationOperation',
      message: {chainId: BigInt(input.chainId), slotId: bytesToHex(slot) as `0x${string}`, action: input.action, payloadDigest: bytesToHex(digest) as `0x${string}`, description: input.description, exp: BigInt(exp)},
    },
    operation,
    messageHex,
    payloadDigest: digest,
  }
}

/** Operation, signing wallet and verifier-agent endpoint for opening a presentation session. */
export interface OpenVerifierAgentSessionOpts extends OperationInput {
  /** Verifier-agent HTTP base URL for the selected network. */
  verifierAgentUrl: string
  /** The slot creator's key, or a delegate's (with `delegation`). */
  signer: TypedDataSigner
  /** Optional creator-signed delegation authorizing the signing wallet. */
  delegation?: PresentationDelegation
}

/** Opened wallet session with its signed operation and expected request-binding hash. */
export interface OpenedVerifierAgentSession extends CreateSessionResult {
  /** Signed operation details presented for authorization. */
  operation: PresentationOperation
  /** The binding hash the token will carry - compare with the token's `request_hash`. */
  requestHash: Uint8Array
  /** Verifier-agent HTTP base URL for the selected network. */
  verifierAgentUrl: string
}

/**
 * Sign the operation and open a session; hand `qrPayload` to the wallet.
 *
 * @param opts - Operation details, signing wallet and verifier-agent endpoint.
 */
export async function openVerifierAgentSession(opts: OpenVerifierAgentSessionOpts): Promise<OpenedVerifierAgentSession> {
  const {typedData, operation, messageHex, payloadDigest} = presentationOperationTypedData(opts)
  const operationSig = await opts.signer.signTypedData(typedData)
  const session = await createOid4vpSession(opts.verifierAgentUrl, {operation, operationSig, delegation: opts.delegation, messageHex})
  const slot = typeof opts.slotId === 'string' ? hexToBytes(opts.slotId) : opts.slotId
  return {...session, operation, requestHash: requestHash(opts.chainId, slot, opts.action, payloadDigest), verifierAgentUrl: opts.verifierAgentUrl}
}

/** Compound committee token with optional request preimage and verifier membership proofs. */
export interface VerifierAgentResult {
  /** Compound committee authorization token. */
  token: CompoundTokenWire
  /** Operation context used to derive the request-binding hash. */
  bindingPreimage?: Record<string, unknown>
  /**
   * The drawn verifiers' snapshot membership proofs the verifier-agent built at session creation -
   * hand them to every keeper call (`verifierProofs`): a keeper in snapshot-required mode
   * (`api.require_verifier_proofs`) refuses a committee request without them.
   */
  verifierProofs?: VerifierProof[]
}

/**
 * The verifier-agent's `verifier_proofs` DTO (`{verifier_index, operator, pubkey, proof}`) to the SDK shape.
 *
 * @param raw - Verifier-agent verifier_proofs response value.
 */
export function verifierAgentVerifierProofs(raw: unknown): VerifierProof[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: VerifierProof[] = []
  for (const p of raw) {
    if (!p || typeof p !== 'object') throw new Error('verifier_proofs: entry is not an object')
    const e = p as Record<string, unknown>
    const index = e.verifier_index
    if (typeof index !== 'number' || typeof e.operator !== 'string' || typeof e.pubkey !== 'string' || !Array.isArray(e.proof) || !e.proof.every(h => typeof h === 'string')) {
      throw new Error('verifier_proofs: entry is not {verifier_index, operator, pubkey, proof[]}')
    }
    out.push({verifierIndex: index, operator: e.operator, pubkey: e.pubkey, proof: e.proof as string[]})
  }
  return out
}

/**
 * Poll until the wallet has presented and the committee answered. Rejects with an
 * `VerifierAgentSessionError` whose `kind` the UI explains - `refused` (the verifier-agent's `error` names the
 * refusing side), `timeout`, `unavailable`, `protocol`, `cancelled` - and whose
 * `correlation` is the session id. A token that binds another request than this session
 * opened, or one whose proofs are malformed, is a `protocol` refusal: nothing is built on it.
 *
 * @param session - Opened session credentials and expected request-binding hash.
 * @param opts - Polling intervals, timeout, cancellation and progress callback.
 */
export async function awaitVerifierAgentResult(session: Pick<OpenedVerifierAgentSession, 'verifierAgentUrl' | 'sessionId' | 'pollSecret' | 'requestHash'>, opts: {intervalMs?: number; timeoutMs?: number} & WaitOpts = {}): Promise<VerifierAgentResult> {
  const {intervalMs, timeoutMs, ...wait} = opts
  const r = await waitForSession(session.verifierAgentUrl, session.sessionId, session.pollSecret, intervalMs, timeoutMs, wait)
  return verifierAgentResult(session, r)
}

/**
 * Validate request binding and proof encoding after either URL or registered-session polling.
 *
 * @param session - Session identifier and expected request-binding hash.
 * @param r - Completed session status to validate and decode.
 */
export function verifierAgentResult(session: Pick<OpenedVerifierAgentSession, 'sessionId' | 'requestHash'>, r: SessionStatusResult): VerifierAgentResult {
  if (r.status !== 'done' || !r.compoundToken) throw new VerifierAgentSessionError('refused', session.sessionId, `presentation ${r.status}: ${r.error ?? 'no token'}`)
  const token = r.compoundToken as unknown as CompoundTokenWire
  const rh = (token as unknown as {request_hash?: string}).request_hash
  if (!rh || rh.replace(/^0x/, '').toLowerCase() !== bytesToHex(session.requestHash).replace(/^0x/, '').toLowerCase()) {
    throw new VerifierAgentSessionError('protocol', session.sessionId, 'the token does not bind the request this session opened')
  }
  let verifierProofs: VerifierProof[] | undefined
  try {
    verifierProofs = verifierAgentVerifierProofs(r.verifierProofs)
  } catch (e) {
    throw new VerifierAgentSessionError('protocol', session.sessionId, e instanceof Error ? e.message : String(e))
  }
  return {token, bindingPreimage: r.bindingPreimage, verifierProofs}
}
