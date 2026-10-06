import {hexToBytes, bytesToHex} from '../crypto/hex.js'
import {httpError} from '../errors.js'
import type {EoaSignature} from '../signing/ecdsa.js'
import type {CompoundTokenWire} from './token.js'
import type {VerifierProof} from './client.js'
import {withKeeperExecutionApprovals,type KeeperExecutionApprover} from './keeperExecution.js'

/** Compound authorization, keeper endpoint and digest for threshold ECDSA signing. */
export interface CommitteeEoaSignOpts {
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
 *
 * @param opts - Compound authorization, keeper endpoint and 32-byte ECDSA digest.
 */
export async function committeeSignEoaDigest(opts: CommitteeEoaSignOpts): Promise<EoaSignature> {
  opts={...opts,committeeToken:structuredClone(opts.committeeToken)}
  if (opts.digest.length !== 32) throw new Error('committeeSignEoaDigest: digest must be 32 bytes')
  if (opts.userSignature && opts.userSignature.length !== 64) throw new Error('userSignature must be 64 bytes')
  const bare = (hex: string) => hex.replace(/^0x/, '')
  const unsignedBody = {
    committee_token: opts.committeeToken,
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
  const data = await response.json() as Record<string, unknown> | null
  const scalar = (value: unknown): value is string => typeof value === 'string' && /^(?:0x)?[a-fA-F0-9]{64}$/.test(value)
  if (!data || data.mode !== 'tecdsa' || (data.signature_v !== 0 && data.signature_v !== 1) ||
      !scalar(data.signature_r) || !scalar(data.signature_s) ||
      typeof data.group_public_key !== 'string' || !/^(?:0x)?0[23][a-fA-F0-9]{64}$/.test(data.group_public_key)) {
    throw new Error('committeeSignEoaDigest: invalid secp256k1 signature response')
  }
  return {groupPublicKey: hexToBytes(data.group_public_key), r: hexToBytes(data.signature_r),
    s: hexToBytes(data.signature_s), yParity: data.signature_v}
}
