import {recoverTypedDataAddress,type PublicClient} from 'viem'
import {approveExecutionRequest,type ClientExecutionSigner,type ExecutionCertificate} from '../committee/execution.js'
import {requireKeeperExecutionPayload,type KeeperExecutionApprover} from '../committee/keeperExecution.js'
import {assertPaymentIntentWire,paymentIntentHash,paymentIntentTypedData,prepaidRequestId,type PaymentIntentWire} from '../committee/payment.js'
import {resolvePaidKeeperTarget,type ExpectedPaidOperation,type PaidKeeperEndpoint,type PaidKeeperTarget,type PaidKeeperTransportOptions,type PrepaidDeployment} from './prepaid.js'

/** Client-owned certificate and signing capability for the original paid operation. */
export interface KeeperExecutionClientConsent {
  /** Original creator certificate; its payment, session and public client key stay fixed. */
  certificate:ExecutionCertificate
  /** Original local Ed25519 execution signer; never forward it to a service. */
  signer:ClientExecutionSigner
}

/** Independent chain and local client intent used before every keeper stage signature. */
export interface KeeperExecutionApproverOptions extends KeeperExecutionClientConsent {
  /** Trusted bounded canonical RPC client for the approved chain. */
  client:PublicClient
  /** Independently approved contracts and chain. */
  deployment:PrepaidDeployment
  /** Original creator intent retained before its reservation. */
  payment:PaymentIntentWire
  /** Intended slot, paid action and exact operation digest. */
  expected:ExpectedPaidOperation
  /** Explicit local HTTP exception; official Fuji still requires HTTPS. */
  transportPolicy?:PaidKeeperTransportOptions
  /** Caller-approved routing map; never populate it from a service response. */
  keeperUrl?:(registeredUrl:string)=>string
}

function endpoint(member:PaidKeeperEndpoint,chainId:number,policy:PaidKeeperTransportOptions,route:(url:string)=>string):string{
  const url=new URL(route(member.url))
  if(url.username||url.password||url.search||url.hash||(url.protocol!=='https:'
    &&!(chainId===43112&&policy.allowLocalHttp===true&&url.protocol==='http:')))throw new Error('Client-approved keeper route violates transport policy')
  return url.toString().replace(/\/$/,'')
}

/** A canonical read this recent is shared by the approvals of one operation (half the signing window). */
const SHARED_TARGET_MAX_AGE_SECS=15

/**
 * Create a client-only keeper approver bound to one independently retained payment and operation.
 * Before each signing callback, use canonical reserved TASRA, creator consent and eligible worker
 * sharing read within the last 15 seconds: the parallel approvals of one operation share one such
 * read, and an older one is read again. Sign the complete local request for coordinator/contributors,
 * or the one IBE contributor being contacted. This helper performs no HTTP dispatch or transaction.
 * @param options Approved deployment, original operation and creator-certified local signer.
 */
export function createKeeperExecutionApprover(options:KeeperExecutionApproverOptions):KeeperExecutionApprover{
  return approverWithTarget(options)
}

/**
 * Internal: an approver whose first approvals may use `target`, a canonical read the caller has
 * just made through `resolvePaidKeeperTarget` for this exact deployment, payment, operation and
 * transport policy. It is reused only while it is as recent as a shared read.
 * @param options Approved deployment, original operation and creator-certified local signer.
 * @param target Freshly resolved target for the same payment.
 */
export function createKeeperExecutionApproverWithTarget(options:KeeperExecutionApproverOptions,target:PaidKeeperTarget):KeeperExecutionApprover{
  if(target.receipt.requestId.toLowerCase()!==prepaidRequestId(options.payment).toLowerCase())throw new Error('Keeper target belongs to another payment')
  return approverWithTarget(options,target)
}

function approverWithTarget(options:KeeperExecutionApproverOptions,seed?:PaidKeeperTarget):KeeperExecutionApprover{
  assertPaymentIntentWire(options.payment)
  const payment=structuredClone(options.payment),certificate=structuredClone(options.certificate),deployment={...options.deployment}
  const expected={...options.expected},client=options.client,signer=options.signer,transportPolicy={...options.transportPolicy}
  const route=options.keeperUrl??((url:string)=>url)
  // Fixed by the retained payment: derive once per operation, not once per keeper.
  const paymentHash=paymentIntentHash(payment)
  let creatorOf:Promise<`0x${string}`>|undefined
  const creatorAddress=()=>creatorOf??=recoverTypedDataAddress({...paymentIntentTypedData(payment),signature:payment.signature})
  // One shared canonical read per operation instead of one per keeper. A read made by an earlier
  // approval is reused only while recent and the payment unexpired; otherwise read again. A failed
  // read is never reused. Every approval still applies the unchanged 30 s signing-clock check.
  let shared:Promise<PaidKeeperTarget>|undefined=seed&&Promise.resolve(structuredClone(seed))
  const reusable=(target:PaidKeeperTarget)=>{
    const now=Math.floor(Date.now()/1000),block=Number(target.receipt.blockTimestamp)
    return now-block<=SHARED_TARGET_MAX_AGE_SECS&&block-now<=2&&payment.expires>now
  }
  const resolveTarget=async():Promise<PaidKeeperTarget>=>{
    const earlier=shared
    if(earlier){
      const target=await earlier
      if(reusable(target))return target
      if(shared===earlier)shared=undefined
      else if(shared)return shared
    }
    const fresh=resolvePaidKeeperTarget(client,deployment,payment,expected,transportPolicy)
    shared=fresh
    fresh.catch(()=>{if(shared===fresh)shared=undefined})
    return fresh
  }
  return async request=>{
    const {kind,signal}=request
    signal?.throwIfAborted()
    requireKeeperExecutionPayload(request)
    if(paymentIntentHash(request.payment)!==paymentHash)throw new Error('Keeper approval request changed the locally retained payment')
    const body=structuredClone(request.body),nodeUrl=new URL(request.nodeUrl).toString().replace(/\/$/,'')
    const target=await resolveTarget()
    signal?.throwIfAborted()
    // The EOA-digest route signs for BOTH threshold-ECDSA curves: tecdsa (secp256k1, mode 2) and
    // tecdsa-p256 (mode 4). Every other route serves exactly one slot mode.
    const modes=kind==='committee-eoa-digest'?[2,4]:kind==='committee-decrypt'||kind==='sealed-decrypt'||kind==='ibe-extract'?[1]:[0]
    if(!modes.includes(target.mode))throw new Error('Keeper request route does not match the canonical slot mode')
    const coordinatorUrl=endpoint(target,deployment.chainId,transportPolicy,route)
    const contributors=target.contributors.map(member=>({...member,approvedUrl:endpoint(member,deployment.chainId,transportPolicy,route)}))
    if(new Set(contributors.map(m=>m.approvedUrl)).size!==contributors.length)throw new Error('Client-approved routing aliases multiple keeper identities')
    const member=contributors.find(m=>m.approvedUrl===nodeUrl)
    const stages=kind==='ibe-extract'||kind==='sealed-decrypt'
      ?member?[{stage:'contributor' as const,operatorKey:member.publicKey}]:[]
      :nodeUrl===coordinatorUrl?[{stage:'coordinator' as const,operatorKey:target.publicKey},
        ...contributors.map(m=>({stage:'contributor' as const,operatorKey:m.publicKey}))]:[]
    if(stages.length===0)throw new Error('Keeper approval request targets a different assigned endpoint')
    const creator=await creatorAddress()
    const nowSecs=Math.floor(Date.now()/1000)
    requireFreshSigningClock(target.receipt.blockTimestamp)
    const policy={chainId:deployment.chainId,settlement:deployment.settlement,keyRegistry:deployment.keyRegistry,
      creator,paymentHash,cost:target.receipt.cost,nowSecs}
    const authorizations=[]
    for(const stage of stages){
      signal?.throwIfAborted()
      policy.nowSecs=requireFreshSigningClock(target.receipt.blockTimestamp)
      const expires=Math.min(certificate.expires,payment.expires)
      authorizations.push(await approveExecutionRequest({payment,certificate,signer,policy,
        expected:{...stage,body},proposal:{stage:stage.stage,operator_key:stage.operatorKey,unsigned_body:body,expires}}))
    }
    signal?.throwIfAborted()
    requireFreshSigningClock(target.receipt.blockTimestamp)
    if(authorizations.some(proof=>proof.expires<=Math.floor(Date.now()/1000)))throw new Error('Keeper approval expired while the client was signing')
    return {policy,authorizations}
  }
}

function clockInteger(value:bigint):number{
  if(value<0n||value>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Canonical keeper clock exceeds the safe integer range')
  return Number(value)
}

function requireFreshSigningClock(timestamp:bigint):number{
  const now=Math.floor(Date.now()/1000),block=clockInteger(timestamp)
  if(now-block>30||block-now>2)throw new Error('Canonical keeper policy aged before client dispatch')
  return now
}
