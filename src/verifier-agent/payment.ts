import type {Hex} from 'viem'
import {assertPaymentIntentWire, paymentSessionCommitment, type PaymentIntentWire} from '../committee/payment.js'
import type {CreateSessionParams} from './index.js'

/** Internal shared wire validation for URL and authenticated-provider sessions. */
export function sessionPaymentFields(params: CreateSessionParams, clientId?: string): {payment?: PaymentIntentWire; random?: string} {
  if (params.payment === undefined && params.random === undefined) return {}
  if (!params.payment || typeof params.random !== 'string' || !/^0x[0-9a-f]{64}$/i.test(params.random)) throw new Error('payment and its 32-byte random are required together')
  assertPaymentIntentWire(params.payment)
  const p = params.payment, op = params.operation
  const action = p.action === 'eoa-sign' ? 'sign' : p.action
  if (p.chain_id !== op.chain_id || p.slot.toLowerCase() !== op.slot_id.toLowerCase() || action !== op.action
    || p.payload_digest.toLowerCase() !== op.payload_digest.toLowerCase() || p.expires !== op.exp) throw new Error('payment differs from session operation or expiry')
  if (clientId !== undefined && paymentSessionCommitment(params.random as Hex, clientId, op.exp).toLowerCase() !== p.session_commitment.toLowerCase()) throw new Error('payment does not bind the approved agent audience and random')
  return {payment: p, random: params.random}
}
