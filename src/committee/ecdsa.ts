import {p256} from '@noble/curves/p256'
import {evidenceBody} from './evidence.js'
import {equalBytes} from '@noble/curves/utils.js'
import {hexToBytes, bytesToHex} from '../crypto/hex.js'
import {httpError} from '../errors.js'
import type {EoaSignature} from '../signing/ecdsa.js'
import type {CompoundTokenWire} from './token.js'
import type {VerifierProof} from './client.js'
import {withKeeperExecutionApprovals,type KeeperExecutionApprover} from './keeperExecution.js'
import {withNetworkDeadline} from '../internal/network.js'

/** Compound authorization, keeper endpoint and digest for threshold ECDSA signing. */
export interface CommitteeEoaSignOpts {
  /** Exact sealed presentation ciphertext returned with this authorization. */
  evidenceCt?: string
  /** Required for a paid token: locally verify and approve the complete keeper body. */
  approveExecution?:KeeperExecutionApprover
  /** HTTP transport override; defaults to the global fetch implementation. */
  fetchImpl?: typeof fetch
  /** Keeper HTTP base URL. */
  nodeUrl: string
  /** Authorization from awaitVerifierAgentResult; its slot selects the signing key. */
  committeeToken: CompoundTokenWire
  /** Exactly 32 bytes: the transaction signing hash, not a serialized transaction. */
  digest: Uint8Array
  /** Membership proofs returned with the authorization. */
  verifierProofs?: VerifierProof[]
  /** Request identifier used to correlate or resume the operation. */
  requestId?: string
  /** Required only by slots configured with an additional owner-signature gate. */
  userSignature?: Uint8Array
  /** Optional 20-byte operator address to pin the intended keeper. */
  targetKeykeeper?: string
  /** Optional signal that cancels the request. */
  signal?: AbortSignal
}

/**
 * Sign an Ethereum digest using credential-based committee authorization.
 * Open the verifier-agent session with action `sign` and message equal to `digest`.
 * The keeper checks the token's request binding against SHA-256(digest), then
 * threshold-signs the original digest. This never falls back to JWT authorization.
 * @returns Ethereum signature components and the secp256k1 group public key.
 * @throws On malformed input/response, network failure, or keeper rejection.
 * HTTP 401/403 is an authorization denial; do not retry it as a network failure.
 * Approvals, HTTP and response decoding have one 15-second deadline. A timeout
 * requires reconciliation of the original operation, not a new paid attempt.
 *
 * @param opts - Compound authorization, keeper endpoint and 32-byte ECDSA digest.
 */
export async function committeeSignEoaDigest(opts: CommitteeEoaSignOpts): Promise<EoaSignature> {
  return withNetworkDeadline(signal => signWithinDeadline({...opts, signal}), opts.signal)
}

/** Threshold P-256 digest signature (a `tecdsa-p256` slot, mode 4). */
export interface P256DigestSignature {
  /** The slot's P-256 group public key, as the keeper returned it (equal to the expected key). */
  groupPublicKey: Uint8Array
  /** 32-byte big-endian r. */
  r: Uint8Array
  /** 32-byte big-endian s. */
  s: Uint8Array
}

/** {@link committeeSignEoaDigest} options plus the slot key the signature must verify under. */
export interface CommitteeP256SignOpts extends CommitteeEoaSignOpts {
  /** The slot's anchored P-256 group public key (33-byte compressed or 65-byte uncompressed SEC1). */
  groupPublicKey: Uint8Array
}

/**
 * Sign a 32-byte digest with a threshold P-256 (`tecdsa-p256`) slot through the same keeper route
 * and authorization as {@link committeeSignEoaDigest}. The reply must name mode `tecdsa-p256`,
 * carry the expected group key and verify as a P-256 signature over the digest (no prehash);
 * anything else is refused.
 * @param opts - Compound authorization, keeper endpoint, 32-byte digest and the slot's group key.
 * @returns r, s and the group key.
 * @throws On malformed input/response, a signature that does not verify, network failure or keeper rejection.
 */
export async function committeeSignP256Digest(opts: CommitteeP256SignOpts): Promise<P256DigestSignature> {
  if (opts.digest.length !== 32) throw new Error('committeeSignP256Digest: digest must be 32 bytes')
  let expected: Uint8Array
  try { expected = p256.ProjectivePoint.fromHex(opts.groupPublicKey).toRawBytes(true) } catch { throw new Error('committeeSignP256Digest: invalid expected P-256 group public key') }
  const digest = opts.digest.slice()
  const data = await withNetworkDeadline(signal => requestWithinDeadline({...opts, signal}), opts.signal)
  const scalar = (value: unknown): value is string => typeof value === 'string' && /^(?:0x)?[a-fA-F0-9]{64}$/.test(value)
  if (!data || data.mode !== 'tecdsa-p256' || !scalar(data.signature_r) || !scalar(data.signature_s)
    || typeof data.group_public_key !== 'string' || !/^(?:0x)?(?:0[23][a-fA-F0-9]{64}|04[a-fA-F0-9]{128})$/.test(data.group_public_key)) {
    throw new Error('committeeSignP256Digest: invalid P-256 signature response')
  }
  const groupPublicKey = hexToBytes(data.group_public_key), r = hexToBytes(data.signature_r), s = hexToBytes(data.signature_s)
  let returned: Uint8Array
  try { returned = p256.ProjectivePoint.fromHex(groupPublicKey).toRawBytes(true) } catch { throw new Error('committeeSignP256Digest: invalid P-256 group public key') }
  if (!equalBytes(returned, expected)) throw new Error('committeeSignP256Digest: group public key differs from the slot key')
  const signature = new Uint8Array(64); signature.set(r, 0); signature.set(s, 32)
  if (!p256.verify(signature, digest, expected, {prehash: false, lowS: false})) throw new Error('committeeSignP256Digest: signature does not verify under the slot key')
  return {groupPublicKey, r, s}
}

async function signWithinDeadline(opts: CommitteeEoaSignOpts): Promise<EoaSignature> {
  const data = await requestWithinDeadline(opts)
  const scalar = (value: unknown): value is string => typeof value === 'string' && /^(?:0x)?[a-fA-F0-9]{64}$/.test(value)
  if (!data || data.mode !== 'tecdsa' || (data.signature_v !== 0 && data.signature_v !== 1) ||
      !scalar(data.signature_r) || !scalar(data.signature_s) ||
      typeof data.group_public_key !== 'string' || !/^(?:0x)?0[23][a-fA-F0-9]{64}$/.test(data.group_public_key)) {
    throw new Error('committeeSignEoaDigest: invalid secp256k1 signature response')
  }
  return {groupPublicKey: hexToBytes(data.group_public_key), r: hexToBytes(data.signature_r),
    s: hexToBytes(data.signature_s), yParity: data.signature_v}
}

/** The shared keeper request of both digest clients: approvals, POST and the decoded JSON reply. */
async function requestWithinDeadline(opts: CommitteeEoaSignOpts): Promise<Record<string, unknown> | null> {
  opts={...opts,committeeToken:structuredClone(opts.committeeToken)}
  if (opts.digest.length !== 32) throw new Error('committeeSignEoaDigest: digest must be 32 bytes')
  if (opts.userSignature && opts.userSignature.length !== 64) throw new Error('userSignature must be 64 bytes')
  const bare = (hex: string) => hex.replace(/^0x/, '')
  const unsignedBody = {
    committee_token: opts.committeeToken,
    ...evidenceBody(opts.committeeToken, opts.evidenceCt),
    digest: bare(bytesToHex(opts.digest)),
    ...(opts.verifierProofs ? {verifier_proofs: opts.verifierProofs.map(p => ({
      verifier_index: p.verifierIndex, operator: bare(p.operator), pubkey: bare(p.pubkey), proof: p.proof.map(bare),
    }))} : {}),
    ...(opts.targetKeykeeper ? {target_keykeeper:bare(opts.targetKeykeeper)} : {}),
    ...(opts.userSignature ? {user_signature:bare(bytesToHex(opts.userSignature))} : {}),
  }
  const body=await withKeeperExecutionApprovals({body:unsignedBody,kind:'committee-eoa-digest',nodeUrl:opts.nodeUrl,
    payment:opts.committeeToken.payment,approveExecution:opts.approveExecution,signal:opts.signal})
  const url = `${opts.nodeUrl.replace(/\/$/, '')}/v1/committee/sign/eoa-digest`
  const response = await (opts.fetchImpl ?? fetch)(url, {
    method: 'POST', headers: {'Content-Type': 'application/json', ...(opts.requestId ? {'x-request-id': opts.requestId} : {})},
    body: JSON.stringify(body), signal: opts.signal,
    ...(opts.committeeToken.payment ? {redirect:'error' as const,credentials:'omit' as const} : {}),
  })
  if (!response.ok) throw await httpError(response, url, 'committee/sign/eoa-digest')
  return await response.json() as Record<string, unknown> | null
}
