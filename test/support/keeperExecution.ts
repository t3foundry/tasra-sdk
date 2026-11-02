import {ed25519} from '@noble/curves/ed25519'
import {toHex, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {approveExecutionRequest, createExecutionCertificate, createLocalExecutionSigner,
  type ExecutionConsentPolicy} from '../../src/committee/execution.js'
import {paymentIntentHash, paymentIntentTypedData, type PaymentIntentWire} from '../../src/committee/payment.js'
import type {KeeperExecutionApprover} from '../../src/committee/keeperExecution.js'
import {hex, wireBytes} from './executionRecovery.js'

/** Real creator/client signatures over a caller-selected operation; no service bypass. */
export async function keeperExecutionFixture(action: PaymentIntentWire['action'], payloadDigest: Hex,
  overrides: Partial<PaymentIntentWire> = {}) {
  const creator = privateKeyToAccount(hex(11))
  const keys = [22,23].map(n => toHex(ed25519.getPublicKey(new Uint8Array(32).fill(n))))
  const nowSecs = Math.floor(Date.now()/1000)
  const payment: PaymentIntentWire = {chain_id:43112,settlement:hex(1,20),key_registry:hex(2,20),slot:hex(3),
    action,payload_digest:payloadDigest,session_commitment:hex(5),nonce:hex(6),max_cost:'10',expires:nowSecs+120,
    verification_epoch:7,verification_seed:hex(8),verification_root:hex(9),verification_registry_size:5,
    verification_committee:3,verification_quorum:2,keeper_assignment:{key_epoch:1,committee_version:2,threshold:1,
      coordinator:wireBytes(keys[0]!),contributors:[...keys].sort().map(wireBytes)},signature:hex(1,65),...structuredClone(overrides)}
  payment.signature = await creator.signTypedData(paymentIntentTypedData(payment))
  const policy: ExecutionConsentPolicy = {chainId:payment.chain_id,settlement:payment.settlement,keyRegistry:payment.key_registry,
    creator:creator.address,paymentHash:paymentIntentHash(payment),cost:9n,nowSecs}
  const signer = createLocalExecutionSigner(new Uint8Array(32).fill(21))
  const certificate = await createExecutionCertificate({payment,policy,publicKey:signer.publicKey,expires:payment.expires,creator})
  const approveExecution: KeeperExecutionApprover = async request => {
    const stages = (request.kind === 'ibe-extract'||request.kind === 'sealed-decrypt')
      ? [{stage:'contributor' as const,operatorKey:keys[request.nodeUrl.includes('keeper1')?1:0]!}]
      : [{stage:'coordinator' as const,operatorKey:keys[0]!},
        ...payment.keeper_assignment.contributors.map(key=>({stage:'contributor' as const,operatorKey:toHex(Uint8Array.from(key))}))]
    return {policy,authorizations:await Promise.all(stages.map(expected=>approveExecutionRequest({payment,policy,certificate,signer,
      expected:{...expected,body:request.body},proposal:{stage:expected.stage,operator_key:expected.operatorKey,
        unsigned_body:request.body,expires:payment.expires}})))}
  }
  return {creator,payment,policy,keys,signer,certificate,approveExecution,execution:{certificate,signer}}
}
