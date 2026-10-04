import {ed25519} from '@noble/curves/ed25519'
import {equalBytes} from '@noble/curves/utils.js'
import {sha256} from '@noble/hashes/sha256'
import {encodeFunctionData, keccak256, toHex, type Hex} from 'viem'
import {validate} from '../auth/oid4vp.js'
import {keyRegistryAbi} from '../chain/abis/index.js'
import {dualSignApprovalPayload, paidDualSignApprovalPayload, type DualSignApprover, type DualSignRequest} from '../committee/dual-sign.js'
import {protocolHex} from '../committee/receipts.js'
import {b64urlDecode} from '../oid4vp/jose.js'
import type {TasraApplication, OperationAuthorizer} from './client.js'
import {assertPaymentIntentWire, paymentIntentHash, type PaymentIntentWire} from '../committee/payment.js'
import type {TasraIdentity} from './identity.js'
import type {ApplicationStore} from './ready-slot.js'
import type {TasraWallet} from './wallet.js'

/**
 * Required approval count and either trusted Ed25519 keys or a credential rule.
 */
export interface ApprovalPolicy {
  /**
   * Minimum distinct approvals required to complete a signing request.
   */
  quorum: number
  /** Static Ed25519 approver keys. Use either this list or a credential policy. */
  approvers?: readonly Uint8Array[]
  /** Exact raw DCQL rule whose unsalted hash the network must enforce. */
  credentialPolicy?: string
}

/**
 * Install an explicit native FROST approval policy using a durable named transaction.
 * @param app Application client for the slot deployment.
 * @param slotId FROST slot whose approval policy is being installed.
 * @param input Required quorum and either approver keys or a credential rule.
 * @param options Creator wallet and durable store for the named policy transaction.
 */
export async function setApprovalPolicy(app: Pick<TasraApplication, 'deployment' | 'chain' | 'slots'>, slotId: Hex,
  input: ApprovalPolicy, options: {wallet: TasraWallet; store: ApplicationStore; name?: string}) {
  protocolHex(slotId, 32, 'slot id')
  const {quorum, credentialPolicy} = input, approvers = input.approvers?.map(key => key.slice())
  const {wallet, store} = options, name = options.name ?? `approval-${slotId.slice(2)}`
  if (!Number.isSafeInteger(quorum) || quorum < 1 || quorum > 65535) throw new Error('Invalid approval quorum')
  if ((approvers !== undefined) === (credentialPolicy !== undefined)) throw new Error('Choose static approvers or a credential policy')
  if (approvers && (quorum > approvers.length || approvers.some(key => key.length !== 32) || new Set(approvers.map(key => toHex(key))).size !== approvers.length)) throw new Error('Approval keys must be distinct and satisfy the quorum')
  for (const key of approvers ?? []) {
    const point = ed25519.Point.fromHex(key, false)
    if (point.isSmallOrder() || !point.isTorsionFree()) throw new Error('Approval keys must be prime-order Ed25519 points')
  }
  if (credentialPolicy !== undefined) validate(credentialPolicy)
  const ruleHash = credentialPolicy === undefined ? `0x${'00'.repeat(32)}` as Hex : keccak256(toHex(credentialPolicy))
  const data = encodeFunctionData({abi: keyRegistryAbi, functionName: 'setDualControlPolicy', args: [slotId, quorum, ruleHash, (approvers ?? []).map(key => toHex(key))]})
  await app.slots.frost(slotId)
  if (wallet.wallet.chain.id !== app.deployment.chainId) throw new Error('Approval wallet uses a different chain')
  const transaction = await wallet.transfer(name, {to: app.deployment.addresses.KeyRegistry!, data}, store)
  const [observed, observedKeys] = await Promise.all([
    app.chain.client.readContract({address: app.deployment.addresses.KeyRegistry!, abi: keyRegistryAbi, functionName: 'dualControlPolicy', args: [slotId]}),
    app.chain.client.readContract({address: app.deployment.addresses.KeyRegistry!, abi: keyRegistryAbi, functionName: 'dualControlApprovers', args: [slotId]}),
  ])
  if (observed[0] !== quorum || observed[1].toLowerCase() !== ruleHash.toLowerCase()) throw new Error('On-chain approval policy differs from the requested policy')
  const expectedKeys = (approvers ?? []).map(key => toHex(key)).sort()
  const actualKeys = observedKeys.map(key => key.toLowerCase()).sort()
  if (expectedKeys.length !== actualKeys.length || expectedKeys.some((key, i) => key !== actualKeys[i])) throw new Error('On-chain approval keys differ from the requested policy')
  return transaction
}

/**
 * Adapt an SDK Ed25519 identity to native approval signatures without exporting its key.
 * @param identity Live Ed25519 identity used to sign approval payloads.
 * @returns Approver adapter exposing the public key and signing callback.
 */
export function identityApprover(identity: TasraIdentity): DualSignApprover {
  if (identity.algorithm !== 'Ed25519') throw new Error('Native approval requires an Ed25519 identity')
  const publicKey = b64urlDecode(identity.holder.publicJwk.x!)
  return {publicKey: publicKey.slice(), async sign(payload) {
    const secret = identity.exportPrivateKey()
    try {
      if (!equalBytes(ed25519.getPublicKey(secret), publicKey)) throw new Error('Approval identity key changed')
      return ed25519.sign(payload, secret)
    } finally {secret.fill(0)}
  }}
}

/**
 * Present a credential for this exact request, then sign its canonical approval payload.
 * @param app Application client for the request deployment.
 * @param request Native signing request awaiting an approval.
 * @param message Exact document bytes identified by the request.
 * @param options Approver identity, credential authorizer and cancellation controls.
 */
export async function approveWithCredential(app: Pick<TasraApplication, 'deployment' | 'slots'>, request: DualSignRequest,
  message: Uint8Array, options: {identity: TasraIdentity; authorize: OperationAuthorizer; signal?: AbortSignal; description?: string;
    /** Separate reserved credential approval intent; never the final keeper Sign intent. */
    payment?: PaymentIntentWire;
    /** Fixed presentation random committed by the approval payment. */
    random?: string}) {
  const {identity, authorize, signal, description} = options
  const slotId = request.slotId as Hex, payment = request.payment
  const canonical = payment ? paidDualSignApprovalPayload(app.deployment.chainId, slotId, message.slice(), request.requestId, payment)
    : dualSignApprovalPayload(slotId, message.slice(), request.requestId)
  signal?.throwIfAborted()
  const current = await request.status({signal})
  if (current.status !== 'pending') return current
  const approvalPayment = options.payment && structuredClone(options.payment)
  const nowSecs = Math.floor(Date.now() / 1000)
  if (payment && (!approvalPayment || !options.random)) throw new Error('Paid credential approval needs its own reservation and presentation random')
  if ((approvalPayment === undefined) !== (options.random === undefined)) throw new Error('Approval payment and presentation random are required together')
  if (options.random !== undefined && !/^0x[0-9a-f]{64}$/i.test(options.random)) throw new Error('Approval presentation random must contain 32 bytes')
  if (approvalPayment) {
    assertPaymentIntentWire(approvalPayment)
    if (approvalPayment.action !== 'dual-approve' || approvalPayment.chain_id !== app.deployment.chainId || approvalPayment.expires <= nowSecs ||
      approvalPayment.key_registry.toLowerCase() !== app.deployment.addresses.KeyRegistry!.toLowerCase() ||
      (payment && approvalPayment.settlement.toLowerCase() !== payment.settlement.toLowerCase()) ||
      approvalPayment.slot.toLowerCase() !== slotId.toLowerCase() || !equalBytes(protocolHex(approvalPayment.payload_digest, 32, 'approval digest'), sha256(canonical))) {
      throw new Error('Approval reservation differs from requested credential work')
    }
  }
  const signer = identityApprover(identity)
  signal?.throwIfAborted()
  await app.slots.frost(slotId)
  const authorization = await authorize({chainId: app.deployment.chainId, keyRegistry: app.deployment.addresses.KeyRegistry!,
    slotId, action: 'dual-approve', payloadDigest: sha256(canonical), description: description ?? 'Approve exact document request', signal,
    ...(approvalPayment ? {payment: structuredClone(approvalPayment), random: options.random, nowSecs, ttlSecs: approvalPayment.expires - nowSecs} : {})})
  signal?.throwIfAborted()
  if (approvalPayment) {
    assertPaymentIntentWire(authorization.token.payment)
    const expected = paymentIntentHash(approvalPayment)
    if (paymentIntentHash(authorization.token.payment) !== expected ||
      !equalBytes(protocolHex(authorization.token.payment_hash, 32, 'approval payment hash'), protocolHex(expected, 32, 'payment hash')) ||
      !Number.isSafeInteger(authorization.token.exp) || authorization.token.exp > approvalPayment.expires) throw new Error('Credential authorization changed the reserved approval payment')
  }
  return request.approve({signer, authorization, signal})
}
