import {verifyEvidenceBinding} from '../committee/evidence.js'
import {sha256} from '@noble/hashes/sha256'
import {concatBytes} from '@noble/hashes/utils'
import {p256} from '@noble/curves/p256'
import {ed25519} from '@noble/curves/ed25519'
import {accessTokenHash, jwkThumbprint, type DpopSigner} from '../auth/dpop.js'
import {hashTypedData, keccak256, toHex, type Hex} from 'viem'
import {approveExecutionRequest, executionBodyHash, executionInitializationTypedData, initializeExecutionSession,
  type ClientExecutionSigner, type ExecutionCertificate,
  type ExecutionProposal, type SessionInitialization} from '../committee/execution.js'
import {paymentIntentHash, type PaymentIntentWire} from '../committee/payment.js'
import {protocolHex} from '../committee/receipts.js'
import {recipientPayloadDigest} from '../crypto/recipient.js'
import {dpopHtu, platformAudience, isValidSessionId} from '../committee/oauth.js'
import {BINDING_HOLDER_KEY, assertStatusAttestationsWire, decodeCompoundToken, selectVerifierCommittee, verifierLeaf, verifyCompoundToken, verifyMerkleProof,
  requireStatusAttestations, compoundTokenHash, type CompoundTokenWire} from '../committee/token.js'
import {derivedNonce, requestHash, type CommitteeAction} from '../oid4vp/binding.js'
import {b64urlDecode, decodeJson} from '../oid4vp/jose.js'
import {verifyRequestObject, type VerifiedRequestObject} from '../oid4vp/request-object.js'
import {parseVerifierAgentSessionStatus, type CreateSessionParams, type SessionStatusResult} from '../verifier-agent/index.js'
import {sessionPaymentFields} from '../verifier-agent/payment.js'
import type {TasraChainClient} from './client.js'
import type {ApprovedAgentProfile} from './registeredAgent.js'
import {readClientExecutionPolicy, type ClientExecutionDeployment, type PaidVerifierWitness} from './prepaid.js'
import {authenticateApprovedService, validateServiceEndpoint} from './serviceIdentity.js'
import {chainIdOf} from './chainId.js'
import {currentServiceRecord} from './services.js'
import type {PaidAgentHttpResponse, PaidAgentTransport} from './paidAgentTransport.js'
import {PaidBackoff, paidResponseWaitMs, systemPacingClock, type PaidPacingClock} from './paidPacing.js'

/**
 * Pacing of a paid session's definite 429/503 refusals. Repeatable reads (proposals, Request
 * Object, presentations, session poll, approval state) and the continuation POST (429 only) are
 * repeated inside the session's signed expiry; the creation POST (429/503, the agent refuses
 * both before any session exists) inside the payment's own remaining window, with the identical
 * body; nothing else is.
 */
export interface PaidPacingOptions {
  /** Time source; wall-clock ms. Default: the system clock. */
  clock?: PaidPacingClock
  /**
   * Longest one attempt may take (provider check plus HTTP), 1000..60000 ms (default 60000). Each
   * attempt is cut off at this bound, and a repeated attempt starts only with this much time left.
   */
  attemptBudgetMs?: number
}

/** A signed approval retained BEFORE its first send; every send uses exactly `body`. */
export interface RetainedPaidApproval {
  /** Agent delivery (proposal) identity. */
  proposalId: string
  /** Exact JSON request body `{"authorization":…}`; never re-serialized or re-signed. */
  body: string
  /** Unix seconds after which the approval may not be sent (proposal and session expiry). */
  expires: number
}

/** Outcome of one send of a retained approval. Any other answer throws {@link PaidAgentControlError}. */
export interface PaidApprovalDelivery {
  /** `accepted`: HTTP 204, the agent accepted the approval. `busy`: HTTP 429/503, definitely refused before processing. */
  status: 'accepted' | 'busy'
  /** Observed status of a `busy` answer. */
  httpStatus?: 429 | 503
  /** Strict server hint of a `busy` answer, in ms. */
  hintMs?: number
}

/** Client-built original operation and reserved intent. No provider fallback is permitted. */
export interface PaidAgentSessionParams extends CreateSessionParams {
  /** Original creator-signed reserved TASRA intent. */
  payment: PaymentIntentWire
  /** Original presentation random committed before reservation. */
  random: string
  /** Credential adapter; omitted means wallet. */
  kind?: 'wallet' | 'oauth'
}

/** Complete presentation explicitly accepted by the client before verifier work. */
export interface ClientApprovedPresentation {
  /** Holder hint; the committee still authenticates it. */
  holder: string
  /** Every compact wallet credential, or an empty array for OAuth. */
  credentials: string[]
  /** Original holder proof, if applicable. */
  holder_proof: string | null
  /** Original OAuth artifacts, if this session uses OAuth. */
  oauth: {access_token: string; dpop_proof: string; session_id: string} | null
  /** Original holder-selected integer issuance time; never change it on a retry. */
  iat: number
}

/** Retained callback is untrusted until the application accepts its complete presentation. */
export interface PaidRetainedPresentation {
  /** Locally checked callback identity; safe for correlation. */
  id: string
  /** Complete owner-only proposal. Do not log credential contents. */
  presentation: ClientApprovedPresentation
  /** Immutable parent expiry. */
  expires: number
  /** Whether this callback has already been selected. */
  selected: boolean
}

/** Owner proposal, including its transport correlation identity. */
export interface PaidAgentProposal extends ExecutionProposal {
  /** Transport identity; it never replaces the complete-body comparison. */
  id: string
}

/** HTTP refusal or consent/recovery wait, with no credential-bearing response text. */
export class PaidAgentControlError extends Error {
  constructor(
    /** Original locally derived session identity. */ readonly sessionId: string,
    /** Observed status; this never authorizes an automatic resend. */ readonly httpStatus: number,
    /** Agent-requested wait in ms (`Retry-After`), when sent; a polling hint for reads and consent waits. */ readonly retryAfterMs?: number,
  ) {
    super(`Paid session control returned HTTP ${httpStatus} (session ${sessionId.slice(0,12)}…)`)
    this.name = 'PaidAgentControlError'
  }
}

/** Prepared client-owned session; creation sends once, reconciliation only reads. */
export interface RegisteredPaidAgentSession {
  /** Locally derived deterministic initialization identity. */
  readonly sessionId: string
  /** Original approved provider, immutable and independently authenticated. */
  readonly profile: Readonly<ApprovedAgentProfile>
  /** Original spending commitment. */
  readonly paymentHash: Hex
  /** Public initialization proof; the execution private key remains with the caller. */
  readonly initialization: SessionInitialization
  /** Locally derived OAuth audience and nonce; available after public-context recovery. */
  readonly oauthContext: Readonly<{nonce: string; dpopHtu: string; platformAudience: string}>
  /** Build and verify the original OAuth presentation locally. Retain it before submission. */
  prepareOAuthPresentation(accessToken: string, signer: DpopSigner, signal?: AbortSignal): Promise<ClientApprovedPresentation>
  /** Submit the retained original OAuth artifacts once; HTTP202 means client consent is still needed. */
  submitOAuthPresentation(approved: ClientApprovedPresentation, signal?: AbortSignal): Promise<void>
  /** Send the exact initialized creation POST once. Retain this object if its result is unknown. */
  create(signal?: AbortSignal): Promise<void>
  /** Recover the original public context via authenticated GET after a lost creation reply. */
  reconcile(signal?: AbortSignal): Promise<SessionStatusResult>
  /** Read owner-only complete-body proposals, without approving or sending operator work. */
  proposals(signal?: AbortSignal): Promise<PaidAgentProposal[]>
  /** Approve one JAR signer or distinct attester after canonical member/policy checks and local body reconstruction. */
  approveRequest(proposal: PaidAgentProposal, stage: 'presentation_sign' | 'presentation_attest', member: PaidVerifierWitness, signal?: AbortSignal): Promise<void>
  /** Read retained callback candidates; application acceptance must precede selection or signing. */
  presentations(signal?: AbortSignal): Promise<PaidRetainedPresentation[]>
  /** Select/resume the exact client-accepted callback. HTTP425 requires separate operator approvals. */
  resumePresentation(id: string, approved: ClientApprovedPresentation, signal?: AbortSignal): Promise<void>
  /** Approve one drawn verifier's complete credential body, built from the separately accepted presentation. */
  approveCredentials(proposal: PaidAgentProposal, member: PaidVerifierWitness, approved: ClientApprovedPresentation, signal?: AbortSignal): Promise<void>
  /** Record a refusal; never reopens a dispatched operator stage. */
  rejectProposal(id: string, signal?: AbortSignal): Promise<void>
  /** Fetch and independently verify the drawn signer's JAR and every bound session claim before exposing a QR. */
  requestObject(signal?: AbortSignal): Promise<{request: VerifiedRequestObject; requestUri: string; qrPayload: string}>
  /**
   * Poll the original provider and verify a completed token against the anchored draw and application's rule hash.
   * With `wait`, ask the agent to hold the reply until the session's status or phase changes
   * (`?wait=1`, at most 20 s); an agent without long-poll support answers at once. A session whose
   * attempt budget is under 25 s never asks for a hold.
   */
  poll(signal?: AbortSignal, options?: {wait?: boolean}): Promise<SessionStatusResult>
  /** Pacing this session applies to definite 429/503 refusals (present on sessions from {@link prepareRegisteredPaidSession}). */
  readonly pacing?: Readonly<{clock: PaidPacingClock; attemptBudgetMs: number}>
  /** Sign (once) the approval {@link RegisteredPaidAgentSession.approveRequest} would send, without sending it. Retain it durably before the first send. */
  prepareRequestApproval?(proposal: PaidAgentProposal, stage: 'presentation_sign' | 'presentation_attest', member: PaidVerifierWitness, signal?: AbortSignal): Promise<RetainedPaidApproval>
  /** Sign (once) the approval {@link RegisteredPaidAgentSession.approveCredentials} would send, without sending it. Retain it durably before the first send. */
  prepareCredentialApproval?(proposal: PaidAgentProposal, member: PaidVerifierWitness, approved: ClientApprovedPresentation, signal?: AbortSignal): Promise<RetainedPaidApproval>
  /**
   * Send a retained approval's exact bytes ONCE. 204 is `accepted`, 429/503 `busy` (not processed);
   * any other status throws {@link PaidAgentControlError}. Never re-signs; never repeats by itself:
   * the caller decides a resend under its durable permit.
   */
  sendRetainedApproval?(approval: RetainedPaidApproval, signal?: AbortSignal): Promise<PaidApprovalDelivery>
  /** Read one delivery's state (`pending`, `approved`, `dispatched`, `finished`, …); repeated on 429/503 inside the session expiry. */
  approvalState?(proposalId: string, signal?: AbortSignal): Promise<string>
}

/** Smallest attempt budget that fits the agent's 20 s long-poll hold plus network headroom. */
const HELD_POLL_MIN_BUDGET_MS = 25_000

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) throw new Error('Invalid paid agent object')
  const o = value as Record<string,unknown>
  if (Object.getOwnPropertySymbols(o).length || Object.values(Object.getOwnPropertyDescriptors(o)).some(d=>!d.enumerable||!Object.hasOwn(d,'value'))) throw new Error('Paid agent objects must contain only JSON properties')
  return o
}
function exact(value: Record<string,unknown>, fields: string[]): void {
  if (Object.keys(value).length !== fields.length || fields.some(k=>!Object.hasOwn(value,k))) throw new Error('Unexpected paid agent fields')
}
function decode(bytes: Uint8Array): Record<string,unknown> {
  try {return object(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown)}
  catch {throw new Error('Invalid paid agent reply JSON')}
}
async function bounded<T>(signal:AbortSignal|undefined,work:(active:AbortSignal)=>Promise<T>,timeoutMs=60_000):Promise<T> {
  const controller=new AbortController(), active=signal?AbortSignal.any([signal,controller.signal]):controller.signal
  const timer=setTimeout(()=>controller.abort(new Error('Paid agent operation timed out')),timeoutMs)
  let abort=()=>{}
  try {
    active.throwIfAborted()
    return await Promise.race([work(active),new Promise<never>((_,reject)=>{
      abort=()=>reject(active.reason);active.addEventListener('abort',abort,{once:true})
      if(active.aborted)abort()
    })])
  }finally{clearTimeout(timer);active.removeEventListener('abort',abort);controller.abort()}
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new Error('Invalid paid session correlation identity')
  return value
}
function epochBytes(value: number): Uint8Array {
  const out = new Uint8Array(8)
  new DataView(out.buffer).setBigUint64(0,BigInt(value))
  return out
}
function b64(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')
}
function encryptedKey(value: unknown): Record<string,unknown> {
  const key = object(value)
  exact(key,['kty','crv','x','y','alg','use','kid'])
  if (key.kty !== 'EC' || key.crv !== 'P-256' || key.alg !== 'ECDH-ES' || key.use !== 'enc'
    || typeof key.kid !== 'string' || !/^[0-9a-f]{32}$/.test(key.kid)) throw new Error('Invalid public session encryption key')
  const coordinate = (value: unknown): Uint8Array => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error('Invalid encryption coordinate')
    const bytes = Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0))
    if (bytes.length !== 32 || b64(bytes) !== value) throw new Error('Noncanonical encryption coordinate')
    return bytes
  }
  p256.ProjectivePoint.fromHex(concatBytes(new Uint8Array([4]),coordinate(key.x),coordinate(key.y)))
  return structuredClone(key)
}
function presented(value: ClientApprovedPresentation): ClientApprovedPresentation {
  const o = object(value)
  exact(o,['holder','credentials','holder_proof','oauth','iat'])
  executionBodyHash(o)
  if (typeof value.holder !== 'string' || !Number.isSafeInteger(value.iat) || value.iat < 0
    || !Array.isArray(value.credentials) || value.credentials.length > 32
    || value.credentials.some(v=>typeof v !== 'string' || !v.length || /\s/.test(v))
    || (value.holder_proof !== null && typeof value.holder_proof !== 'string')) throw new Error('Invalid client-approved presentation')
  if (value.oauth !== null) {
    exact(object(value.oauth),['access_token','dpop_proof','session_id'])
    if (value.credentials.length || typeof value.oauth.access_token!=='string'||typeof value.oauth.dpop_proof!=='string'
      ||!value.oauth.access_token||!value.oauth.dpop_proof||!isValidSessionId(value.oauth.session_id)) throw new Error('Invalid OAuth presentation')
  } else if (!value.credentials.length) throw new Error('Empty wallet presentation')
  return structuredClone(value)
}

// Mirrors the agent's signed_jws_expiry reader: only the issuer payload sets
// this bound, never an SD-JWT disclosure or holder KB-JWT. This is advisory
// decoding; the drawn verifiers still authenticate the complete evidence.
function issuerExpiry(credential: string): number | undefined {
  const parts=credential.split('~',1)[0]!.split('.')
  if(parts.length!==3)return undefined
  const payload=parts[1]!.replace(/=+$/,'')
  if(!/^[A-Za-z0-9_-]*$/.test(payload))return undefined
  try{
    const exp=object(decodeJson(payload)).exp
    if(typeof exp==='number'&&Number.isFinite(exp)&&exp>=-(2**63)&&exp<2**63)return Math.floor(exp)
  }catch{/* Unreadable evidence contributes no bound; verifiers refuse it. */}
  return undefined
}

/**
 * Authenticate one approved provider and prepare complete client-signed initialization before HTTP.
 * This function reserves nothing, sends no session POST and keeps the execution signer local.
 * The caller must retain the returned object through uncertain creation/delivery outcomes.
 * @param chain Independently configured trusted RPC/registry client.
 * @param config Approved provider, deployment, drawn Merkle witnesses and client-verified rule/query.
 * @param params Original operation and fixed mined payment, built before contacting the agent.
 * @param consent Creator-certified client key, optional locally retained bearer and consent deadline.
 */
export async function prepareRegisteredPaidSession(chain: TasraChainClient, config: {
  profile: ApprovedAgentProfile; deployment: ClientExecutionDeployment; transport: PaidAgentTransport;
  members: readonly PaidVerifierWitness[]; ruleHash: Hex; dcqlQuery: Record<string,unknown>;
  /**
   * Accept a completed grant WITHOUT revocation-status attestations (with a warning), only for a
   * deployment still inside the keepers' documented migration window. Default false: a missing
   * list is `revocation_status_missing`. Stale or invalid attestations are always refused.
   */
  allowMissingStatusAttestations?: boolean;
  /** Pacing of definite 429/503 refusals on repeatable requests; defaults to the system clock and a 60 s attempt. */
  pacing?: PaidPacingOptions;
}, params: PaidAgentSessionParams, consent: {
  certificate: ExecutionCertificate; signer: ClientExecutionSigner; pollSecret?: string; expires?: number; signal?: AbortSignal;
}): Promise<RegisteredPaidAgentSession> {
  params = structuredClone(params)
  const profile = Object.freeze({...config.profile,approval:Object.freeze({...config.profile.approval})})
  const deployment = structuredClone(config.deployment), transport = config.transport
  const paidRequest=transport.paidAgentRequest.bind(transport)
  const members = structuredClone([...config.members]), ruleHash = protocolHex(config.ruleHash,32,'client rule hash')
  executionBodyHash(object(config.dcqlQuery))
  const dcql = structuredClone(config.dcqlQuery), certificate = structuredClone(consent.certificate), signer = consent.signer
  const allowMissingStatus = config.allowMissingStatusAttestations === true
  const clock = config.pacing?.clock ?? systemPacingClock, attemptBudgetMs = config.pacing?.attemptBudgetMs ?? 60_000
  if (typeof clock?.now !== 'function' || typeof clock.sleep !== 'function' || typeof clock.jitter !== 'function'
    || !Number.isSafeInteger(attemptBudgetMs) || attemptBudgetMs < 1_000 || attemptBudgetMs > 60_000) throw new Error('Invalid paid agent pacing')
  const pacing = Object.freeze({clock, attemptBudgetMs})
  const localPublicKey=signer.publicKey.slice(),localSign=signer.sign.bind(signer)
  const activeSigner=(active:AbortSignal):ClientExecutionSigner=>({publicKey:localPublicKey.slice(),sign:async message=>{
    active.throwIfAborted();const signature=await localSign(message);active.throwIfAborted();return signature
  }})
  const pollSecret = id(consent.pollSecret ?? toHex(crypto.getRandomValues(new Uint8Array(32))).slice(2))
  if (/^0+$/.test(pollSecret)) throw new Error('Owner bearer must be nonzero')
  const expires = consent.expires ?? certificate.expires, payment = params.payment, paymentHash = paymentIntentHash(payment)
  // The agent's typed PaymentIntentDto serializes Alloy addresses/bytes32 as
  // lowercase hex. Reconstruct that representation only for returned context
  // and operator bodies. Initialization still signs/sends the original JSON:
  // changing it would change an existing session's identity on recovery.
  const typedPayment = {...payment}
  for (const field of ['settlement','key_registry','slot','payload_digest','session_commitment','nonce','verification_seed','verification_root'] as const) {
    typedPayment[field] = payment[field].toLowerCase() as Hex
  }
  const expected = {slot:payment.slot,action:payment.action,payloadDigest:payment.payload_digest}
  validateServiceEndpoint(profile.endpoint)
  if (profile.approval.serviceType !== 1 || profile.approval.chainId !== deployment.chainId
    || !/^decentralized_identifier:did:web:[a-z0-9.-]+(?:(?:%3A)[0-9]+)?$/.test(profile.clientId)
    || typeof transport.paidAgentRequest !== 'function') throw new Error('Invalid registered paid agent configuration')
  return bounded(consent.signal,async preparationSignal=>{
  sessionPaymentFields(params,profile.clientId)
  preparationSignal.throwIfAborted()
  // The provider authentication (registry record, manifest, identity challenge, record recheck) and
  // the client execution policy are independent: both only read, and the policy read contacts no
  // agent. Run them together and judge them in the original order: authentication refuses first.
  const [authenticatedRead,policyRead] = await Promise.allSettled([
    authenticateApprovedService(chain,profile.approval,{request:(url,opts)=>transport.request(url,{...opts,signal:AbortSignal.any([opts.signal,preparationSignal])})}),
    readClientExecutionPolicy(chain.client,deployment,payment,expected)])
  if (authenticatedRead.status === 'rejected') throw authenticatedRead.reason
  const authenticated = authenticatedRead.value
  if (authenticated.record.endpoint !== profile.endpoint || !authenticated.manifest.capabilities.includes('oid4vp')) throw new Error('Paid agent endpoint/capability mismatch')
  preparationSignal.throwIfAborted()
  if (policyRead.status === 'rejected') throw policyRead.reason
  const {policy:originalPolicy} = policyRead.value
  preparationSignal.throwIfAborted()
  const a = profile.approval, record = authenticated.record
  const pin = {chainId:a.chainId,registry:a.registry.toLowerCase(),serviceId:a.serviceId.toLowerCase(),serviceType:1,
    owner:a.owner.toLowerCase(),revision:a.revision.toString(),manifestHash:a.manifestHash.toLowerCase(),
    authKey:record.authKey.toLowerCase(),endpoint:profile.endpoint,clientId:profile.clientId}
  const unsigned = {operation:params.operation,operation_sig:params.operationSig,message_hex:params.messageHex,
    ...(params.decryption ? {decryption:params.decryption} : {}),
    ...(params.delegation ? {delegation:params.delegation} : {}),payment,random:params.random,poll_secret:pollSecret,
    ...(params.kind ? {kind:params.kind} : {})}
  const initialization = await initializeExecutionSession({payment,certificate,signer:activeSigner(preparationSignal),policy:originalPolicy,
    expected:{serviceProfile:pin,body:unsigned},expires})
  preparationSignal.throwIfAborted()
  const sessionId = hashTypedData(executionInitializationTypedData(payment,initialization)).slice(2)
  const requestUri = profile.endpoint+'/v1/request/'+sessionId
  const rawMessage = params.messageHex.replace(/^0x/,'')
  if (!/^(?:[0-9a-f]{2})+$/i.test(rawMessage)) throw new Error('Invalid original operation message bytes')
  const message = protocolHex('0x'+rawMessage,rawMessage.length/2,'original message')
  // `sign` digests the message itself; `ibe-extract` digests the identity bound to the client
  // recipient (as presentationOperationTypedData builds it and the verifier-agent recomputes it).
  if (params.operation.action === 'sign' && toHex(sha256(message)).toLowerCase() !== params.operation.payload_digest.toLowerCase()) throw new Error('Original operation does not bind its message')
  if (params.operation.action === 'ibe-extract') {
    const d = params.decryption
    if (!d) throw new Error('Paid IBE extraction requires its client recipient binding')
    const content = sha256(message), bare = (hex: string) => hex.replace(/^0x/i, '').toLowerCase()
    if (d.content_digest !== undefined && bare(d.content_digest) !== bare(toHex(content))) throw new Error('Original operation does not bind its message')
    if (toHex(recipientPayloadDigest(content, d.ciphertext_epoch, d.recipient)).toLowerCase() !== params.operation.payload_digest.toLowerCase())
      throw new Error('Original operation does not bind its message')
  }
  const identity = params.operation.action === 'ibe-extract' ? new TextDecoder('utf-8',{fatal:true}).decode(message) : null
  if(!['sign','decrypt','ibe-extract','dual-approve'].includes(params.operation.action))throw new Error('Unsupported presentation operation')
  const rh = requestHash(payment.chain_id,protocolHex(payment.slot,32,'slot'),params.operation.action as CommitteeAction,protocolHex(payment.payload_digest,32,'digest'))
  const drawn = selectVerifierCommittee(protocolHex(payment.slot,32,'slot'),payment.verification_epoch,
    protocolHex(payment.verification_seed,32,'seed'),payment.verification_registry_size,payment.verification_committee)
  if (members.length !== drawn.length || new Set(members.map(m=>m.index)).size !== members.length
    || new Set(members.map(m=>m.publicKey.toLowerCase())).size !== members.length) throw new Error('Incomplete or ambiguous paid verifier witnesses')
  for (const member of members) {
    const point=ed25519.Point.fromHex(protocolHex(member.publicKey,32,'member key'),false)
    if(point.isSmallOrder()||!point.isTorsionFree())throw new Error('Drawn verifier key must be a prime-order Ed25519 point')
    if (!drawn.includes(member.index) || member.proof.length > 32 || !verifyMerkleProof(
      verifierLeaf(member.index,protocolHex(member.operator,20,'operator'),protocolHex(member.publicKey,32,'key')),
      member.proof.map(p=>protocolHex(p,32,'proof')),protocolHex(payment.verification_root,32,'root'))) throw new Error('Paid verifier witness differs from the anchored draw')
  }
  const jarIndex = drawn[protocolHex(payment.verification_seed,32,'seed')[0]! % drawn.length]!
  const nonce = derivedNonce(rh,protocolHex(params.random,32,'random'),{epoch:payment.verification_epoch,snapshotRoot:protocolHex(payment.verification_root,32,'root'),
    registrySize:payment.verification_registry_size,committee:payment.verification_committee,quorum:payment.verification_quorum,operationExp:params.operation.exp})
  const expectedBinding = {chain_id:payment.chain_id,slot_id:params.operation.slot_id,action:params.operation.action,
    message_sha256:toHex(sha256(message)),identity,payload_digest:payment.payload_digest.toLowerCase(),description:params.operation.description,
    operation:params.operation,operation_sig:params.operationSig,payment:typedPayment,delegation:params.delegation??null,random:params.random.toLowerCase(),
    request_hash:toHex(rh),nonce,epoch:payment.verification_epoch,seed:payment.verification_seed.toLowerCase(),snapshot_root:payment.verification_root.toLowerCase(),
    committee_count:payment.verification_committee,quorum:payment.verification_quorum,registry_size:payment.verification_registry_size,drawn,jar_signer_index:jarIndex,
    client_id:profile.clientId,service_profile:pin,execution_initialization:initialization,execution_certificate:certificate,
    execution_policy:{chain_id:originalPolicy.chainId,settlement:originalPolicy.settlement.toLowerCase(),key_registry:originalPolicy.keyRegistry.toLowerCase(),
      creator:originalPolicy.creator.toLowerCase(),cost:toHex(originalPolicy.cost,{size:32})}}
  let context: {state:string;key:Record<string,unknown>|null;expires:number}|undefined
  let submitted = false
  const checkContext = (value: unknown) => {
    const c = object(value)
    exact(c,['binding_preimage','state','enc_public_jwk','expires_at'])
    if (executionBodyHash(object(c.binding_preimage)) !== executionBodyHash(expectedBinding)
      || typeof c.state !== 'string' || !/^[0-9a-f]{64}$/.test(c.state)
      || typeof c.expires_at !== 'number' || !Number.isSafeInteger(c.expires_at) || c.expires_at <= Math.floor(Date.now()/1000)
      || c.expires_at > initialization.expires) throw new Error('Paid session context differs from original client intent')
    const next = {state:c.state,key:params.kind === 'oauth' ? null : encryptedKey(c.enc_public_jwk),expires:c.expires_at}
    if (params.kind === 'oauth' && c.enc_public_jwk !== null) throw new Error('OAuth session unexpectedly carries an encryption key')
    if (context && executionBodyHash(context) !== executionBodyHash(next)) throw new Error('Original paid session context changed')
    context = next
  }
  const ready = () => {
    if (!context) throw new Error('Recover original paid session context before approval')
    if(context.expires<=Math.floor(Date.now()/1000))throw new Error('Original paid session context expired')
    return context
  }
  // Before EVERY agent request: the provider's current registration, read at the latest block (one
  // eth_call; formerly a head-number read and then a call at that number, which is no fresher).
  // The chain ID is the client's (see chainIdOf); only the registry record is read each time.
  const checkProvider = async (signal: AbortSignal) => {
    if (chain.addresses.ServiceRegistry?.toLowerCase() !== a.registry.toLowerCase() || await chainIdOf(chain.client) !== a.chainId) throw new Error('Paid agent chain or registry changed')
    signal.throwIfAborted()
    // At the followed head when a live follower is attached (the same "latest" registration, without
    // a round trip), otherwise read at latest as before. The check itself is unchanged.
    const current = await currentServiceRecord(chain, a.serviceId)
    signal.throwIfAborted()
    if (current.status > 1 || current.revision < a.revision || current.serviceType !== 1
      || current.owner.toLowerCase() !== record.owner.toLowerCase() || current.authKey.toLowerCase() !== record.authKey.toLowerCase()
      || current.pendingOwner.toLowerCase() !== record.pendingOwner.toLowerCase() || current.manifestHash.toLowerCase() !== a.manifestHash.toLowerCase()
      || current.endpoint !== profile.endpoint) throw new Error('Original paid agent provider changed')
  }
  // One attempt: provider check plus HTTP, cut off at the attempt budget so pacing can count on it.
  const control = (path:string,method:'GET'|'POST',body?:Record<string,unknown>|Uint8Array,signal?:AbortSignal,publicRoute=false,oauth?:{accessToken:string;proof:string}): Promise<PaidAgentHttpResponse> => bounded(signal,async active=>{
    active.throwIfAborted()
    await checkProvider(active)
    const result = await paidRequest(profile.endpoint+path,{method,body:body instanceof Uint8Array?body.slice():body&&new TextEncoder().encode(JSON.stringify(body)),
      bearer:publicRoute?undefined:pollSecret,oauth,maxBytes:10*1024*1024,signal:active})
    active.throwIfAborted()
    if (result.body.length > 10*1024*1024) throw new Error('Paid agent response exceeds bound')
    return result
  },attemptBudgetMs)
  const BUSY=[429,503], LIMITED=[429]
  /** The signed session expiry, once the original context is known: the deadline of every paced read. */
  const sessionDeadline = () => context ? context.expires*1000 : undefined
  // The creation request has no session yet: its window is the signed payment's remaining time. An
  // already expired payment keeps the single attempt (its refusal is final anyway). 2026-10-31: the
  // agent answered 503 on creation right after a keeper was restored and the SDK gave up at once.
  const creationDeadline = () => payment.expires*1000 > clock.now() ? payment.expires*1000 : undefined
  /**
   * A safely repeatable request: repeated on a status in `retryOn` only while the wait fits before
   * `deadlineMs`, the deadline re-read before EVERY send. No deadline = one attempt (status quo). Any
   * other status is returned for the caller's checks; transport errors propagate and are never repeated.
   */
  const paced = async (route:string,send:()=>Promise<PaidAgentHttpResponse>,retryOn:number[],deadlineMs:number|undefined,signal?:AbortSignal):Promise<PaidAgentHttpResponse> => {
    if (deadlineMs === undefined) return send()
    const backoff = new PaidBackoff(clock,route,deadlineMs,attemptBudgetMs)
    for (;;) {
      signal?.throwIfAborted()
      backoff.readyToSend()
      const response = await send()
      if (!retryOn.includes(response.status)) return response
      await backoff.wait(response.status,paidResponseWaitMs(response),signal)
    }
  }
  const read = (route:string,path:string,signal?:AbortSignal,publicRoute=false) =>
    paced(route,()=>control(path,'GET',undefined,signal,publicRoute),BUSY,sessionDeadline(),signal)
  const ok = (response:PaidAgentHttpResponse,statuses:number[]) => {if(!statuses.includes(response.status))throw new PaidAgentControlError(sessionId,response.status,
    response.retryAfterMs!==undefined&&Number.isSafeInteger(response.retryAfterMs)&&response.retryAfterMs>=0?response.retryAfterMs:undefined)}
  const memberFor = (provided:PaidVerifierWitness) => {
    const member = members.find(m=>m.index===provided.index)
    if (!member || executionBodyHash(member as unknown as Record<string,unknown>) !== executionBodyHash(provided as unknown as Record<string,unknown>)) throw new Error('Approval member differs from independently anchored witnesses')
    return member
  }
  /** Signs the approval ONCE and returns its exact request body; sends nothing. */
  const signApproval = async (proposed:PaidAgentProposal,member:PaidVerifierWitness,stage:'presentation_sign'|'presentation_attest'|'credential',body:Record<string,unknown>,signal?:AbortSignal):Promise<RetainedPaidApproval> => {
    proposed=structuredClone(proposed);member=memberFor(structuredClone(member));body=structuredClone(body)
    id(proposed.id)
    if(!Number.isSafeInteger(proposed.expires)||proposed.expires<=Math.floor(Date.now()/1000)||proposed.expires>ready().expires)throw new Error('Proposal exceeds the original live session expiry')
    return bounded(signal,async active=>{
      const {policy} = await readClientExecutionPolicy(chain.client,deployment,payment,expected,member)
      active.throwIfAborted()
      const authorization = await approveExecutionRequest({payment,certificate,signer:activeSigner(active),policy,expected:{stage,operatorKey:member.publicKey,body},
        proposal:{stage:proposed.stage,operator_key:proposed.operator_key,unsigned_body:proposed.unsigned_body,expires:proposed.expires}})
      active.throwIfAborted()
      return {proposalId:proposed.id,body:JSON.stringify({authorization}),expires:Math.min(proposed.expires,ready().expires)}
    })
  }
  /** Checks a retained approval (possibly loaded from storage) and returns its exact bytes. */
  const retainedBytes = (approval:RetainedPaidApproval):Uint8Array => {
    const a=object(approval)
    exact(a,['proposalId','body','expires'])
    id(a.proposalId)
    if(typeof a.body!=='string'||a.body.length>2*1024*1024||!Number.isSafeInteger(a.expires))throw new Error('Invalid retained paid approval')
    let parsed:Record<string,unknown>
    try{parsed=object(JSON.parse(a.body) as unknown)}catch{throw new Error('Invalid retained paid approval')}
    exact(parsed,['authorization']);object(parsed.authorization)
    if((a.expires as number)<=Math.floor(Date.now()/1000)||(a.expires as number)>ready().expires)throw new Error('Retained approval is outside the original live session expiry')
    return new TextEncoder().encode(a.body)
  }
  /** ONE send of the retained bytes; never re-signed, never repeated here. */
  const deliver = async (approval:RetainedPaidApproval,signal?:AbortSignal):Promise<PaidAgentHttpResponse> => {
    const bytes=retainedBytes(approval)
    const response = await control('/v1/sessions/'+sessionId+'/execution/'+approval.proposalId+'/approve','POST',bytes,signal)
    if(response.status===204&&response.body.length)throw new Error('Approval reply unexpectedly contains a body')
    return response
  }
  const sendRetainedApproval = async (approval:RetainedPaidApproval,signal?:AbortSignal):Promise<PaidApprovalDelivery> => {
    const response = await deliver(approval,signal)
    if(response.status===204)return {status:'accepted'}
    if(response.status===429||response.status===503){const hintMs=paidResponseWaitMs(response);return {status:'busy',httpStatus:response.status,...(hintMs!==undefined?{hintMs}:{})}}
    ok(response,[204]);throw new Error('unreachable')
  }
  /** The complete body a JAR signer or attester is approved for, built from the original intent. */
  const requestBody = (stage:'presentation_sign'|'presentation_attest',member:PaidVerifierWitness):Record<string,unknown> => {
    const c=ready()
    if(params.kind==='oauth'||(stage==='presentation_sign'?member.index!==jarIndex:member.index===jarIndex))throw new Error('Incorrect JAR signer or attester')
    return {operation:params.operation,operation_sig:params.operationSig,delegation:params.delegation??null,
      session:{response_uri:profile.endpoint+'/v1/response?session='+sessionId,enc_jwk:c.key,state:c.state,random:params.random.toLowerCase()},
      epoch:payment.verification_epoch,seed:payment.verification_seed.toLowerCase(),committee_count:payment.verification_committee,
      registry_size:payment.verification_registry_size,quorum:payment.verification_quorum,payment:typedPayment}
  }
  /** The complete credential body a drawn verifier is approved for, from the separately accepted presentation. */
  const credentialBody = (accepted:ClientApprovedPresentation):Record<string,unknown> => {
    const approved=presented(accepted),c=ready()
    if((params.kind==='oauth')!==(approved.oauth!==null))throw new Error('Presentation kind differs from the original session')
    if(approved.oauth!==null&&approved.oauth.session_id!==sessionId)throw new Error('OAuth presentation differs from the original session')
    let exp=Math.min(approved.iat+3600,c.expires,params.operation.exp)
    for(const credential of [...approved.credentials,...(approved.oauth?[approved.oauth.access_token]:[])]){
      const expiry=issuerExpiry(credential)
      if(expiry!==undefined)exp=Math.min(exp,expiry)
    }
    if(!Number.isSafeInteger(exp)||exp<=Math.floor(Date.now()/1000))throw new Error('Original credential presentation expired')
    return {payment:typedPayment,holder:approved.holder,credentials:approved.credentials,
      ...(approved.holder_proof!==null?{holder_proof:approved.holder_proof}:{}),...(approved.oauth!==null?{oauth:approved.oauth,session_id:sessionId}:{}),token_type:'JWT',
      seed:payment.verification_seed.toLowerCase(),epoch:payment.verification_epoch,slot_id:params.operation.slot_id,registry_size:payment.verification_registry_size,
      committee:payment.verification_committee,quorum:payment.verification_quorum,iat:approved.iat,exp,...(identity!==null?{identity}:{}),
      chain_id:payment.chain_id,action:params.operation.action,payload_digest:payment.payload_digest.toLowerCase(),random:params.random.toLowerCase(),client_id:profile.clientId,
      description:params.operation.description,operation_exp:params.operation.exp,operation:params.operation,operation_sig:params.operationSig,...(params.delegation?{delegation:params.delegation}:{})}
  }
  // The direct API keeps its single-attempt behaviour: sign once, send once.
  const approve = async (proposed:PaidAgentProposal,member:PaidVerifierWitness,stage:'presentation_sign'|'presentation_attest'|'credential',body:Record<string,unknown>,signal?:AbortSignal) => {
    const approval = await signApproval(proposed,member,stage,body,signal)
    ok(await deliver(approval,signal),[204])
  }
  const callbackId = (approved:ClientApprovedPresentation) => keccak256(concatBytes(new TextEncoder().encode('keykeeper/retained-presentation/v1'),
    epochBytes(sessionId.length),new TextEncoder().encode(sessionId),protocolHex(executionBodyHash(approved as unknown as Record<string,unknown>),32,'presentation hash'),epochBytes(ready().expires))).slice(2)
  const oauthContext=Object.freeze({nonce,dpopHtu:dpopHtu(profile.endpoint,sessionId),platformAudience:platformAudience(profile.endpoint,payment.chain_id)})
  const oauthClaims=(accessToken:string):Record<string,unknown>=>{
    if(typeof accessToken!=='string'||accessToken.length>16*1024||! /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(accessToken))throw new Error('Invalid original OAuth access token')
    let claims:Record<string,unknown>
    try{claims=object(decodeJson(accessToken.split('.')[1]!))}catch{throw new Error('Invalid original OAuth access token')}
    // A bearer token (no cnf.jkt) is refused by name: only a DPoP-bound token can authorize a paid session.
    if(claims.cnf===null||typeof claims.cnf!=='object'||Array.isArray(claims.cnf)||typeof (claims.cnf as Record<string,unknown>).jkt!=='string')
      throw new Error('OAuth access token is a bearer token (no cnf.jkt): only a DPoP-bound token can authorize a paid session')
    const now=Math.floor(Date.now()/1000),cnf=object(claims.cnf)
    if(typeof claims.iat!=='number'||!Number.isSafeInteger(claims.iat)||claims.iat<0||claims.iat>now+60
      ||typeof claims.exp!=='number'||!Number.isSafeInteger(claims.exp)||claims.exp<=now||claims.exp<=claims.iat
      ||!(typeof claims.aud==='string'?claims.aud===oauthContext.platformAudience:Array.isArray(claims.aud)&&claims.aud.includes(oauthContext.platformAudience))
      ||typeof cnf.jkt!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(cnf.jkt))throw new Error('OAuth token does not bind this original audience, time or DPoP key')
    return claims
  }
  const checkOAuth=async(approved:ClientApprovedPresentation)=>{
    if(params.kind!=='oauth'||approved.oauth===null||approved.holder!==''||approved.holder_proof!==null
      ||approved.oauth.session_id!==sessionId)throw new Error('Invalid original OAuth presentation')
    const claims=oauthClaims(approved.oauth.access_token),proof=approved.oauth.dpop_proof
    if(approved.iat!==claims.iat||proof.length>4*1024||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(proof))throw new Error('OAuth presentation changed its original issuance time or proof')
    let header:Record<string,unknown>,payload:Record<string,unknown>
    try{header=object(decodeJson(proof.split('.')[0]!));payload=object(decodeJson(proof.split('.')[1]!))}catch{throw new Error('Invalid original DPoP proof')}
    const jwk=object(header.jwk);exact(jwk,['kty','crv','x','y'])
    if(header.alg!=='ES256'||header.typ!=='dpop+jwt'||jwk.kty!=='EC'||jwk.crv!=='P-256'
      ||typeof jwk.x!=='string'||typeof jwk.y!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(jwk.x)||!/^[A-Za-z0-9_-]{43}$/.test(jwk.y)
      ||payload.htm!=='POST'||payload.htu!==oauthContext.dpopHtu||payload.nonce!==nonce
      ||typeof payload.iat!=='number'||!Number.isSafeInteger(payload.iat)||Math.abs(payload.iat-Math.floor(Date.now()/1000))>60
      ||typeof payload.jti!=='string'||!payload.jti||payload.ath!==await accessTokenHash(approved.oauth.access_token)
      ||object(claims.cnf).jkt!==await jwkThumbprint({kty:'EC',crv:'P-256',x:jwk.x,y:jwk.y}))throw new Error('DPoP proof differs from the original token, nonce or target')
    const publicKey=concatBytes(new Uint8Array([4]),b64urlDecode(jwk.x),b64urlDecode(jwk.y))
    if(!p256.verify(b64urlDecode(proof.split('.')[2]!),sha256(new TextEncoder().encode(proof.split('.').slice(0,2).join('.'))),publicKey,{lowS:false}))throw new Error('Invalid original DPoP signature')
  }
  let oauthSubmitted=false
  const poll = async (signal?:AbortSignal,options?:{wait?:boolean}):Promise<SessionStatusResult> => {
    // A held poll needs an attempt budget above the agent's 20 s hold.
    const held=options?.wait===true&&attemptBudgetMs>=HELD_POLL_MIN_BUDGET_MS
    const response = await read('GET /v1/sessions/{id}','/v1/sessions/'+sessionId+(held?'?wait=1':''),signal);ok(response,[200])
    const raw = decode(response.body)
    // A malformed status list is a typed `revocation_status_invalid` preflight refusal, checked
    // before the generic protocol parse would fold it into a session error.
    if (raw.status === 'done' && raw.compound_token && typeof raw.compound_token === 'object') {
      const ct = raw.compound_token as Record<string,unknown>
      if (ct.status_attestations != null) assertStatusAttestationsWire(ct.status_attestations,Array.isArray(ct.verifier_indexes)?ct.verifier_indexes.length:undefined)
    }
    if (raw.execution_context !== undefined) checkContext(raw.execution_context)
    if (raw.binding_preimage !== null && raw.binding_preimage !== undefined && executionBodyHash(object(raw.binding_preimage)) !== executionBodyHash(expectedBinding)) throw new Error('Paid poll operation binding changed')
    const status = parseVerifierAgentSessionStatus(raw,sessionId)
    if (status.status === 'done') {
      const token = decodeCompoundToken(status.compoundToken as unknown as CompoundTokenWire)
      if (toHex(token.slotId).toLowerCase() !== payment.slot.toLowerCase() || toHex(token.seed).toLowerCase() !== payment.verification_seed.toLowerCase()
        || token.epoch !== payment.verification_epoch || !token.requestHash || toHex(token.requestHash)!==toHex(rh)
        || !token.paymentHash || toHex(token.paymentHash)!==paymentHash || token.exp>ready().expires
        || token.exp<=Math.floor(Date.now()/1000)||token.binding!==BINDING_HOLDER_KEY||token.tokenType!=='JWT'
        || (identity===null?token.identityHash!==undefined:!token.identityHash||toHex(token.identityHash)!==keccak256(toHex(identity)))) throw new Error('Paid committee result changed its original operation, holder binding or payment')
      const set={registrySize:payment.verification_registry_size,pubkeys:new Map(members.map(m=>[m.index,protocolHex(m.publicKey,32,'key')]))},now=Math.floor(Date.now()/1000)
      const verified=verifyCompoundToken({token,set,committee:payment.verification_committee,quorum:payment.verification_quorum,now,leeway:0,slotRuleHash:ruleHash})
      verifyEvidenceBinding(status.compoundToken as unknown as CompoundTokenWire, status.evidenceCt, compoundTokenHash(token), set.pubkeys, payment.verification_quorum)
      // Paid preflight: revocation-status attestations sit outside the token hash and are
      // REQUIRED, checked exactly as a keeper will (same keys, counted signers and quorum), so a
      // grant every keeper would refuse never reaches one. Missing (absent, null or empty) is
      // `revocation_status_missing` unless the migration opt-out is set; stale or invalid are
      // always refused. Accepted attestations are carried to the keepers unchanged.
      requireStatusAttestations({tokenHash:compoundTokenHash(token),attestations:token.statusAttestations,
        counted:verified.verifiedSigners,set,quorum:payment.verification_quorum,now,allowMissing:allowMissingStatus})
      // The signed payment hash already matched; carry its own original preimage to keepers.
      status.compoundToken!.payment=structuredClone(payment)
      // Downstream keepers receive the client's anchored witnesses, never unchecked agent proofs.
      status.verifierProofs=drawn.map(index=>{
        const member=members.find(m=>m.index===index)!
        return {verifier_index:index,operator:member.operator.slice(2),pubkey:member.publicKey.slice(2),proof:member.proof.map(p=>p.slice(2))}
      })
    }
    return status
  }
  return Object.freeze({sessionId,profile,paymentHash,pacing,get initialization(){return structuredClone(initialization)},
    get oauthContext(){ready();if(params.kind!=='oauth')throw new Error('Wallet session has no OAuth context');return oauthContext},
    prepareOAuthPresentation(accessToken:string,oauthSigner:DpopSigner,signal?:AbortSignal){
      ready();if(params.kind!=='oauth')throw new Error('Wallet session cannot submit OAuth credentials')
      return bounded(signal,async active=>{
        const claims=oauthClaims(accessToken)
        const proof=await oauthSigner.proof({htm:'POST',htu:oauthContext.dpopHtu,nonce,accessToken})
        active.throwIfAborted()
        const approved=presented({holder:'',credentials:[],holder_proof:null,oauth:{access_token:accessToken,dpop_proof:proof,session_id:sessionId},iat:Number(claims.iat)})
        await checkOAuth(approved);active.throwIfAborted();return approved
      })
    },
    submitOAuthPresentation(approved:ClientApprovedPresentation,signal?:AbortSignal){
      approved=presented(approved);ready()
      return bounded(signal,async active=>{
        if(oauthSubmitted)throw new Error('OAuth presentation already sent; reconcile the original retained callback')
        await checkOAuth(approved);active.throwIfAborted()
        // Recheck after asynchronous proof validation to fence concurrent submissions.
        if(oauthSubmitted)throw new Error('OAuth presentation already sent; reconcile the original retained callback')
        oauthSubmitted=true
        const response=await control('/v1/sessions/'+sessionId+'/oauth-response','POST',undefined,active,false,
          {accessToken:approved.oauth!.access_token,proof:approved.oauth!.dpop_proof})
        ok(response,[200,202])
        const status=decode(response.body).status
        if(status!==(response.status===202?'awaiting_client_approval':'accepted'))throw new Error('Invalid OAuth presentation submission result')
      })
    },
    async create(signal?:AbortSignal) {
      if(submitted)throw new Error('Paid creation already sent; reconcile by reading the original session')
      signal?.throwIfAborted();submitted=true
      const response=await paced('POST /v1/sessions',()=>control('/v1/sessions','POST',{...unsigned,execution_initialization:initialization},signal,true),BUSY,creationDeadline(),signal)
      ok(response,[200,201]);const reply=decode(response.body)
      if(reply.session_id!==sessionId || reply.poll_secret!==pollSecret || executionBodyHash(object(reply.service_profile))!==executionBodyHash(pin)
        || reply.qr_payload!=null || (params.kind!=='oauth' && reply.request_uri!==requestUri)) throw new Error('Initialized paid creation reply changed identity, owner or provider')
      if(params.kind==='oauth'&&(reply.nonce!==nonce||reply.dpop_htu!==oauthContext.dpopHtu||reply.platform_audience!==oauthContext.platformAudience||reply.request_uri!=null))throw new Error('OAuth creation reply changed its original nonce or audience')
      checkContext(reply.execution_context)
    },reconcile:(signal?:AbortSignal)=>poll(signal),poll,
    async proposals(signal?:AbortSignal) {
      const response=await read('GET /v1/sessions/{id}/execution','/v1/sessions/'+sessionId+'/execution',signal);ok(response,[200])
      const values=decode(response.body).proposals
      if(!Array.isArray(values)||values.length>256)throw new Error('Invalid paid proposals')
      return values.map(value=>{const p=object(value);exact(p,['id','stage','operator_key','unsigned_body','expires']);id(p.id);object(p.unsigned_body);return structuredClone(p) as unknown as PaidAgentProposal})
    },
    async approveRequest(proposal:PaidAgentProposal,stage:'presentation_sign'|'presentation_attest',member:PaidVerifierWitness,signal?:AbortSignal) {
      await approve(proposal,member,stage,requestBody(stage,member),signal)
    },
    prepareRequestApproval(proposal:PaidAgentProposal,stage:'presentation_sign'|'presentation_attest',member:PaidVerifierWitness,signal?:AbortSignal) {
      return signApproval(proposal,member,stage,requestBody(stage,member),signal)
    },
    prepareCredentialApproval(proposal:PaidAgentProposal,member:PaidVerifierWitness,approved:ClientApprovedPresentation,signal?:AbortSignal) {
      return signApproval(proposal,member,'credential',credentialBody(approved),signal)
    },
    sendRetainedApproval,
    async approvalState(proposal:string,signal?:AbortSignal) {
      id(proposal)
      const response=await read('GET /v1/sessions/{id}/execution/{delivery}','/v1/sessions/'+sessionId+'/execution/'+proposal,signal);ok(response,[200])
      const state=decode(response.body)
      if(state.id!==proposal||typeof state.state!=='string'||!/^[a-z_]{1,32}$/.test(state.state))throw new Error('Invalid paid delivery state')
      return state.state
    },
    async presentations(signal?:AbortSignal) {
      const response=await read('GET /v1/sessions/{id}/presentations','/v1/sessions/'+sessionId+'/presentations',signal);ok(response,[200])
      const values=decode(response.body).presentations
      if(!Array.isArray(values)||values.length>16)throw new Error('Invalid retained presentation list')
      return values.map(value=>{const p=object(value);exact(p,['id','presentation','expires','selected']);
        const presentation=presented(p.presentation as unknown as ClientApprovedPresentation)
        if(presentation.oauth!==null&&presentation.oauth.session_id!==sessionId)throw new Error('Retained OAuth presentation differs from the original session')
        if(p.id!==callbackId(presentation)||p.expires!==ready().expires||typeof p.selected!=='boolean')throw new Error('Retained presentation identity changed')
        return {id:id(p.id),presentation,expires:ready().expires,selected:p.selected}})
    },
    async resumePresentation(callback:string,approved:ClientApprovedPresentation,signal?:AbortSignal) {
      approved=presented(approved)
      if(approved.oauth!==null&&approved.oauth.session_id!==sessionId)throw new Error('OAuth presentation differs from the original session')
      if(id(callback)!==callbackId(approved)||(params.kind==='oauth')!==(approved.oauth!==null))throw new Error('Callback differs from the client-accepted presentation')
      const response=await paced('POST /v1/sessions/{id}/presentations/{callback}/resume',()=>control('/v1/sessions/'+sessionId+'/presentations/'+callback+'/resume','POST',undefined,signal),LIMITED,sessionDeadline(),signal);ok(response,[200])
    },
    async approveCredentials(proposal:PaidAgentProposal,member:PaidVerifierWitness,approved:ClientApprovedPresentation,signal?:AbortSignal) {
      await approve(proposal,member,'credential',credentialBody(approved),signal)
    },
    async rejectProposal(proposal:string,signal?:AbortSignal) {
      const response=await control('/v1/sessions/'+sessionId+'/execution/'+id(proposal)+'/reject','POST',undefined,signal);ok(response,[204])
    },
    async requestObject(signal?:AbortSignal) {
      const c=ready()
      if(params.kind==='oauth')throw new Error('OAuth sessions have no wallet request object')
      const member=members.find(m=>m.index===jarIndex)!
      const response=await read('GET /v1/request/{id}','/v1/request/'+sessionId,signal,true);ok(response,[200])
      const jwt=new TextDecoder('utf-8',{fatal:true}).decode(response.body).trim()
      if(jwt.split('.').length!==3)throw new Error('Invalid compact Request Object')
      const request=await verifyRequestObject(jwt,{nowSecs:Math.floor(Date.now()/1000),leewaySecs:0,
        resolveKey:(did)=>{if(did!==profile.clientId.replace(/^decentralized_identifier:/,''))throw new Error('Request issuer changed');return Promise.resolve({kty:'OKP',crv:'Ed25519',x:b64(protocolHex(member.publicKey,32,'drawn signer key'))})}})
      const claims=request.claims
      if(request.header.alg!=='EdDSA'||claims.client_id!==profile.clientId||claims.response_uri!==profile.endpoint+'/v1/response?session='+sessionId
        ||claims.response_mode!=='direct_post.jwt'||claims.response_type!=='vp_token'||claims.state!==c.state||claims.nonce!==nonce
        ||!Number.isSafeInteger(claims.iat)||!Number.isSafeInteger(claims.exp)||Number(claims.iat)>Math.floor(Date.now()/1000)+60
        ||Number(claims.exp)<=Number(claims.iat)||Number(claims.exp)-Number(claims.iat)>600
        ||Number(claims.exp)<=Math.floor(Date.now()/1000)||Number(claims.exp)>params.operation.exp||claims.client_metadata?.jwks?.keys?.length!==1
        ||executionBodyHash(object(claims.dcql_query))!==executionBodyHash(dcql)
        ||executionBodyHash(object(claims.client_metadata?.jwks?.keys?.[0]))!==executionBodyHash(c.key!))throw new Error('Request Object changed its client-selected session or query')
      if(claims.transaction_data!==undefined){
        if(!Array.isArray(claims.transaction_data)||claims.transaction_data.length!==1)throw new Error('Invalid request transaction data')
        const td=decodeJson<Record<string,unknown>>(claims.transaction_data[0]!)
        if(td.type!=='keykeeper-op/v1'||['chain_id','slot_id','action','payload_digest','description'].some(k=>td[k]!==params.operation[k as keyof typeof params.operation]))throw new Error('Request transaction data changed the authorized operation')
      }
      const qrPayload='openid4vp://?client_id='+encodeURIComponent(profile.clientId)+'&request_uri='+encodeURIComponent(requestUri)
      return {request,requestUri,qrPayload}
    }})
  })
}
