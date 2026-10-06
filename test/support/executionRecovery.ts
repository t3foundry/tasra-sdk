import {ed25519} from '@noble/curves/ed25519'
import {sha256} from '@noble/hashes/sha256'
import {toHex, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {approveExecutionRequest, createExecutionCertificate, createLocalExecutionSigner, executionConsentBinding,
  type ExecutionConsentPolicy, type ExecutionStage} from '../../src/committee/execution.js'
import {paymentIntentHash, paymentIntentTypedData, type PaymentIntentWire} from '../../src/committee/payment.js'
import {paidExecutionRequest, paidExecutionReportSigningHash, type SignedPaidExecutionReport} from '../../src/committee/recovery.js'

export const hex = (n: number, len = 32): Hex => `0x${n.toString(16).padStart(2, '0').repeat(len)}`
export const wireBytes = (h: Hex) => Array.from(Buffer.from(h.slice(2), 'hex'))
export async function executionRecoveryFixture(stage: ExecutionStage = 'coordinator', action: PaymentIntentWire['action'] = 'sign') {
  const creator = privateKeyToAccount(hex(11)), workerSecret = new Uint8Array(32).fill(22)
  const operatorKey = toHex(ed25519.getPublicKey(workerSecret)), contributorKey = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(23)))
  const payment: PaymentIntentWire = {chain_id: 43112, settlement: hex(1,20), key_registry: hex(2,20), slot: hex(3), action,
    payload_digest: hex(4), session_commitment: hex(5), nonce: hex(6), max_cost:'10', expires:1060,
    verification_epoch:7, verification_seed:hex(8), verification_root:hex(9), verification_registry_size:5,
    verification_committee:3, verification_quorum:2, keeper_assignment:{key_epoch:1,committee_version:2,threshold:1,
      coordinator:wireBytes(operatorKey),contributors:[operatorKey,contributorKey].sort().map(wireBytes)}, signature:hex(1,65)}
  // Match the independent pre-existing Rust approval vector for the credential stage.
  if (stage === 'credential') payment.keeper_assignment = {key_epoch:1,committee_version:2,threshold:2,
    coordinator:Array<number>(32).fill(9),contributors:[9,10,11].map(n=>Array<number>(32).fill(n))}
  payment.signature = await creator.signTypedData(paymentIntentTypedData(payment))
  const policy:ExecutionConsentPolicy={chainId:43112,settlement:payment.settlement,keyRegistry:payment.key_registry,
    creator:creator.address,paymentHash:paymentIntentHash(payment),cost:9n,nowSecs:1000}
  const signer=createLocalExecutionSigner(new Uint8Array(32).fill(21))
  const certificate=await createExecutionCertificate({payment,policy,publicKey:signer.publicKey,expires:1050,creator})
  const unsignedBody=stage==='credential'?{credentials:['client-approved credential'],slot_id:'slot',exp:1040}
    :{message:'locally approved message',payment,compound_token:'private holder authorization'}
  const authorization=await approveExecutionRequest({payment,policy,certificate,signer,
    expected:{stage,operatorKey,body:unsignedBody},proposal:{stage,operator_key:operatorKey,unsigned_body:unsignedBody,expires:1040}})
  const consent={authorization,inputs_commitment:Array<number>(32).fill(61),verified_at:1000}
  const execution:SignedPaidExecutionReport={report:{request:paidExecutionRequest(payment),operator_key:wireBytes(operatorKey),stage,
    binding:wireBytes(executionConsentBinding(payment,consent,hex(62))),reservation_block:Array<number>(32).fill(62),cost:[...Array<number>(31).fill(0),9],
    outcome:{succeeded:{result_commitment:Array<number>(32).fill(63)}}},consent,signature:'0x'}
  const resign=()=>{execution.signature=toHex(ed25519.sign(Buffer.from(paidExecutionReportSigningHash(payment,execution.report).slice(2),'hex'),workerSecret))}
  let resultJson = '{"signature":"completed internal result","audit_receipt":null}'
  if(action==='ibe-extract')resultJson=JSON.stringify({key_slot_id:payment.slot,epoch:1,identifier:7,extraction_share:'share',verifying_share:'verification',audit_receipt:null})
  const resultBytes=new TextEncoder().encode(resultJson)
  const commitment=action==='ibe-extract'
    ? sha256(Buffer.concat([Buffer.from('keykeeper/prepaid-ibe-result/v1'),Buffer.from(payment.slot.slice(2),'hex'),
      Buffer.from('00000000000000010007','hex'),Buffer.from('shareverification')]))
    : sha256(Buffer.concat([Buffer.from('keykeeper/prepaid-execution-result/v1'),resultBytes]))
  execution.report.outcome.succeeded.result_commitment=[...commitment];resign()
  const target={stage,operatorKey,executionKey:certificate.execution_key}
  const expected={slot:payment.slot,action:payment.action,payloadDigest:payment.payload_digest}
  const keeper={operator:hex(31,20),publicKey:operatorKey,url:'https://keeper.example'}
  const deployment={chainId:43112,settlement:payment.settlement,keyRegistry:payment.key_registry}
  const reply=()=>({execution:structuredClone(execution),encoding:action==='ibe-extract'?'ibe-extract' as const:'json' as const,result_json:resultJson})
  return {payment,policy,signer,certificate,creator,operatorKey,contributorKey,target,execution,resign,resultJson,reply,keeper,expected,deployment}
}
