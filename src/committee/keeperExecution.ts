import {toHex} from 'viem'
import {sha256} from '@noble/hashes/sha256'
import {base64Decode} from '../crypto/envelope.js'
import {decryptPayloadDigest} from '../oid4vp/binding.js'
import {assertPaymentIntentWire, paymentIntentHash, type PaymentIntentWire} from './payment.js'
import {protocolHex} from './receipts.js'
import {executionBodyHash, MAX_EXECUTION_BODY_BYTES, verifyExecutionAuthorization, type ExecutionAuthorization, type ExecutionConsentPolicy} from './execution.js'

/** Exact public route semantics used to reconstruct client-approved keeper inputs. */
export type KeeperExecutionKind = 'committee-sign' | 'committee-eoa-digest' | 'committee-decrypt' | 'ibe-extract' | 'dual-sign'

/** Complete locally constructed request presented to the client's approval capability. */
export interface KeeperExecutionApprovalRequest {
  /** Exact route semantics, independent of the returned proof. */
  kind: KeeperExecutionKind
  /** Original registered or explicitly application-mapped keeper endpoint. */
  nodeUrl: string
  /** Original payment preimage carried by this request. */
  payment: PaymentIntentWire
  /** Complete client-built JSON object, excluding only execution_authorizations. */
  body: Record<string, unknown>
  /** Caller cancellation; the approver must check it before invoking its signer. */
  signal?: AbortSignal
}

/** Independently read creator/fee policy and client signatures for the exact request. */
export interface KeeperExecutionApprovals {
  /** Fresh independently authenticated original payment, creator and reserved fee. */
  policy: ExecutionConsentPolicy
  /** Coordinator plus signed contributors, or only the targeted IBE contributor. */
  authorizations: ExecutionAuthorization[]
}

/** Local client approval capability; never give this callback to an agent or keeper. */
export type KeeperExecutionApprover = (request: KeeperExecutionApprovalRequest) => Promise<KeeperExecutionApprovals>

function bareBytes(value: unknown, field: string): Uint8Array {
  if (typeof value !== 'string' || !/^(?:0x)?(?:[0-9a-f]{2})*$/i.test(value)) throw new Error(`Invalid client-built ${field}`)
  return Uint8Array.from((value.replace(/^0x/, '').match(/../g) ?? []).map(byte=>Number.parseInt(byte,16)))
}

/** Internal payload check shared by the independent chain approver and transport boundary. */
export function requireKeeperExecutionPayload(request: KeeperExecutionApprovalRequest): void {
  const {body,payment,kind}=request
  assertPaymentIntentWire(payment)
  if (Object.hasOwn(body,'execution_authorizations')) throw new Error('Keeper approval body must exclude its envelope')
  executionBodyHash(body)
  let digest:Uint8Array, action:PaymentIntentWire['action']
  switch(kind){
    case 'committee-sign': case 'dual-sign':
      action='sign';digest=sha256(bareBytes(body.message_hex,'message'));break
    case 'committee-eoa-digest':{
      action='eoa-sign';const bytes=bareBytes(body.digest,'ECDSA digest')
      if(bytes.length!==32)throw new Error('Client-built ECDSA digest must contain 32 bytes')
      digest=sha256(bytes);break
    }
    case 'committee-decrypt':{
      action='decrypt'
      if(!body.ciphertext||typeof body.ciphertext!=='object'||Array.isArray(body.ciphertext))throw new Error('Invalid client-built ciphertext')
      const ct=body.ciphertext as Record<string,unknown>
      if(typeof ct.u!=='string'||typeof ct.nonce!=='string'||typeof ct.aead_ct!=='string')throw new Error('Invalid client-built ciphertext bytes')
      // The established paid decrypt digest excludes nonce, but the full body signature still binds it.
      digest=decryptPayloadDigest(base64Decode(ct.u),base64Decode(ct.aead_ct));break
    }
    case 'ibe-extract':
      action='ibe-extract'
      if(typeof body.identity!=='string')throw new Error('Invalid client-built IBE identity')
      digest=sha256(new TextEncoder().encode(body.identity));break
    default:throw new Error('Unknown keeper execution route')
  }
  if(action!==payment.action||toHex(digest).toLowerCase()!==payment.payload_digest.toLowerCase())throw new Error('Client-built keeper payload differs from retained payment')
  if(kind==='dual-sign'){
    assertPaymentIntentWire(body.payment)
    if(typeof body.key_slot_id!=='string'||body.key_slot_id.replace(/^0x/,'').toLowerCase()!==payment.slot.slice(2).toLowerCase()
      ||paymentIntentHash(body.payment)!==paymentIntentHash(payment))throw new Error('Client-built dual request differs from retained payment')
  }else{
    if(!body.committee_token||typeof body.committee_token!=='object'||Array.isArray(body.committee_token))throw new Error('Missing client-built keeper grant')
    const token=body.committee_token as Record<string,unknown>
    assertPaymentIntentWire(token.payment)
    if(typeof token.slot_id!=='string'||token.slot_id.replace(/^0x/,'').toLowerCase()!==payment.slot.slice(2).toLowerCase()
      ||typeof token.payment_hash!=='string'||token.payment_hash.replace(/^0x/,'').toLowerCase()!==paymentIntentHash(payment).slice(2).toLowerCase()
      ||paymentIntentHash(token.payment)!==paymentIntentHash(payment))throw new Error('Client-built keeper grant differs from retained payment')
  }
}

/** Attach proofs only to an immutable copy of the exact client-built body sent to the keeper. */
export async function withKeeperExecutionApprovals(options: {body:Record<string,unknown>;kind:KeeperExecutionKind;
  nodeUrl:string;payment?:PaymentIntentWire;approveExecution?:KeeperExecutionApprover;signal?:AbortSignal}):Promise<Record<string,unknown>> {
  const body=structuredClone(options.body),payment=options.payment&&structuredClone(options.payment)
  const {kind,nodeUrl,approveExecution,signal}=options
  signal?.throwIfAborted()
  if(!payment){if(approveExecution)throw new Error('Keeper execution approvals require the retained paid intent');return body}
  if(!approveExecution)throw new Error('Paid keeper work requires client execution approval')
  const request={body,kind,nodeUrl,payment,signal}
  requireKeeperExecutionPayload(request)
  const hash=executionBodyHash(body)
  const result=await approveExecution({...request,payment:structuredClone(payment),body:structuredClone(body)})
  signal?.throwIfAborted()
  const proofs=structuredClone(result.authorizations),policy={...result.policy,nowSecs:Math.floor(Date.now()/1000)}
  if(!Array.isArray(proofs)||proofs.length===0||proofs.length>257)throw new Error('Invalid keeper client approval count')
  const identities=new Set<string>()
  for(const proof of proofs){
    if(proof.stage!=='coordinator'&&proof.stage!=='contributor')throw new Error('Keeper client approval uses a different role')
    const identity=proof.stage+':'+proof.operator_key.toLowerCase()
    if(identities.has(identity)||proof.body_hash.toLowerCase()!==hash.toLowerCase())throw new Error('Keeper client approval duplicates a stage or changes the complete body')
    identities.add(identity)
    await verifyExecutionAuthorization({payment,policy,expected:{stage:proof.stage,operatorKey:proof.operator_key,body},authorization:proof})
    signal?.throwIfAborted()
  }
  const coordinator=toHex(Uint8Array.from(payment.keeper_assignment.coordinator))
  if(kind==='ibe-extract'){
    if(proofs.length!==1||proofs[0]!.stage!=='contributor')throw new Error('IBE extraction requires exactly its targeted contributor approval')
  }else{
    const expected=['coordinator:'+coordinator,...payment.keeper_assignment.contributors.map(key=>'contributor:'+toHex(Uint8Array.from(key)))]
    if(identities.size!==expected.length||expected.some(id=>!identities.has(id)))throw new Error('Keeper client approvals do not cover the signed worker assignment')
  }
  if(proofs.some(p=>p.expires<=Math.floor(Date.now()/1000)))throw new Error('Keeper client approval expired before dispatch')
  const approved={...body,execution_authorizations:proofs}
  if(new TextEncoder().encode(JSON.stringify(approved)).length>MAX_EXECUTION_BODY_BYTES)throw new Error('Approved keeper request exceeds its transport byte limit')
  return approved
}
