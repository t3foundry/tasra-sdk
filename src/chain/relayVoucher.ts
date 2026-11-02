import {sha256, type Hex} from 'viem'
import type {PresentationDelegation, PresentationOperation} from '../verifier-agent/index.js'
import {assertCompoundTokenWire} from '../verifier-agent/index.js'
import {assertStatusAttestationsWire, type CompoundTokenWire, type StatusAttestationWire} from '../committee/token.js'
import {requestHash} from '../oid4vp/binding.js'
import {bytesToHex, hexToBytes} from '../crypto/hex.js'
import type {RelayAttempt} from './registeredRelay.js'

/** Sponsor-signed operation returned by an authenticated relayer, before wallet consent. */
export interface RelayVoucherIntent {
  /** Relay action binding the prepared request digest to the sponsorship slot. */
  operation: PresentationOperation
  /** Sponsor delegate's EIP-712 operation signature. */
  operation_sig: string
  /** Slot creator's authorization of that sponsor delegate. */
  delegation: PresentationDelegation
  /** Original forward request's EIP-712 digest, presented as the session message. */
  message_hex: string
  /** Independently approved sponsorship slot. */
  sponsorship_slot: string
}

/** Holder-bound authorization for exactly one forwarded request, in relayer wire format. */
export interface RelayVoucher {
  /** Unpaid committee token; relay sponsorship does not reserve slot credit. */
  compound_token: CompoundTokenWire
  /** Snapshot membership proofs accompanying the token signatures. */
  verifier_proofs: {verifier_index: number; operator: string; pubkey: string; proof: string[]}[]
  /** Freshness attestations, when supplied outside the token. */
  status_attestations?: StatusAttestationWire[]
  /** Sealed evidence carried unchanged when supplied by the agent. */
  evidence_ct?: string
}

/** Wallet consent callback and an independently approved sponsorship slot. */
export interface RelaySponsorshipConfig {
  /** Expected slot, reviewed independently of the relayer's reply. */
  slotId: Hex
  /**
   * Complete an OID4VP session through an approved verifier-agent using this sponsor intent.
   * Authenticate the agent, its Request Object and creator authorization before presenting
   * credentials. Persist wallet-session recovery under attempt.id; honor signal cancellation.
   * Return the resulting wire voucher, without a new forward signature or payment reservation.
   * The relayer independently verifies committee signatures, membership and revocation status.
   */
  authorize(context: {attempt: RelayAttempt; intent: RelayVoucherIntent; signal: AbortSignal}): Promise<RelayVoucher>
}

const hex = (value: unknown, size: number): value is string => typeof value === 'string' && new RegExp(`^(?:0x)?[0-9a-fA-F]{${size * 2}}$`).test(value)
const same = (a: unknown, b: string) => typeof a === 'string' && a.replace(/^0x/, '').toLowerCase() === b.replace(/^0x/, '').toLowerCase()
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0

/**
 * Validate intent shape and exact request/chain/slot binding; creator authority is verified by the approved agent.
 * @param raw Sponsor intent received from the authenticated approved relayer.
 * @param attempt Original signed forward request, retained before wallet authorization.
 * @param slotId Independently approved sponsorship slot.
 */
export function assertRelayVoucherIntent(raw: unknown, attempt: RelayAttempt, slotId: Hex): asserts raw is RelayVoucherIntent {
  if (!hex(slotId, 32) || !hex(attempt.id, 32) || !integer(attempt.chainId) || attempt.chainId === 0) throw new Error('Invalid relay voucher domain')
  const now = Math.floor(Date.now() / 1000)
  if (!object(raw) || !object(raw.operation) || !object(raw.delegation)) throw new Error('Invalid relay voucher intent')
  const o = raw.operation, d = raw.delegation
  if (o.action !== 'relay' || o.chain_id !== attempt.chainId || !same(o.slot_id, slotId) ||
      !same(raw.sponsorship_slot, slotId) || !same(raw.message_hex, attempt.id) || !same(o.payload_digest, sha256(attempt.id)) ||
      !hex(raw.operation_sig, 65) || typeof o.description !== 'string' || o.description.length > 4096 ||
      !integer(o.exp) || o.exp <= now || o.exp > attempt.request.deadline || o.exp > now + 3600 ||
      d.chain_id !== attempt.chainId || !Array.isArray(d.slot_ids) || d.slot_ids.length > 256 || !d.slot_ids.some(s => same(s, slotId)) ||
      !d.slot_ids.every(s => hex(s, 32)) || !Array.isArray(d.actions) || d.actions.length > 16 || !d.actions.includes('relay') ||
      !d.actions.every(a => typeof a === 'string' && a.length <= 64) || !hex(d.delegate, 20) || !hex(d.signature, 65) ||
      !integer(d.exp) || d.exp < o.exp || d.exp > now + 30 * 24 * 3600 || !integer(d.nonce)) throw new Error('Relay voucher intent does not bind this request and sponsorship slot')
}

/**
 * Validate voucher shape/binding before submission; signature, standing and status authority remain the relayer's gate.
 * @param raw Wire voucher returned by the application's approved wallet flow.
 * @param attempt Original signed forward request to which the voucher must be bound.
 * @param slotId Independently approved sponsorship slot.
 */
export function assertRelayVoucher(raw: unknown, attempt: RelayAttempt, slotId: Hex): asserts raw is RelayVoucher {
  if (!hex(slotId, 32) || !hex(attempt.id, 32) || !integer(attempt.chainId) || attempt.chainId === 0) throw new Error('Invalid relay voucher domain')
  if (!object(raw)) throw new Error('Invalid relay voucher')
  if (Object.keys(raw).some(k => !['compound_token', 'verifier_proofs', 'status_attestations', 'evidence_ct'].includes(k))) throw new Error('Unexpected relay voucher field')
  const t = assertCompoundTokenWire(raw.compound_token, attempt.id)
  const expected = bytesToHex(requestHash(attempt.chainId, hexToBytes(slotId), 'relay', hexToBytes(sha256(attempt.id))))
  const now = Math.floor(Date.now() / 1000)
  if (!same(t.slot_id, slotId) || !same(t.request_hash, expected) || t.binding !== 'holder_key' ||
      t.token_type !== 'JWT' || t.identity_hash != null || t.payment_hash != null || t.payment != null ||
      !integer(t.iat) || !integer(t.exp) || t.exp <= now || t.iat > now || !integer(t.epoch) || t.epoch === 0 ||
      !Array.isArray(raw.verifier_proofs) || raw.verifier_proofs.length < 1 || raw.verifier_proofs.length > 64) throw new Error('Relay voucher does not bind this request and sponsorship slot')
  const indexes = new Set<number>()
  for (const p of raw.verifier_proofs) {
    if (!object(p) || !integer(p.verifier_index) || p.verifier_index > 0xffff_ffff || indexes.has(p.verifier_index) ||
        !hex(p.operator, 20) || !hex(p.pubkey, 32) || !Array.isArray(p.proof) || p.proof.length > 32 || !p.proof.every(s => hex(s, 32))) throw new Error('Invalid relay voucher membership proof')
    indexes.add(p.verifier_index)
  }
  for (const s of t.signatures as {verifier_index: number; signature: string}[]) {
    if (!indexes.has(s.verifier_index) || !hex(s.signature, 64)) throw new Error('Relay voucher signature lacks a membership proof')
  }
  if (raw.status_attestations !== undefined) assertStatusAttestationsWire(raw.status_attestations, indexes.size)
  if (raw.evidence_ct !== undefined && (typeof raw.evidence_ct !== 'string' || raw.evidence_ct.length > 65_536)) throw new Error('Invalid relay voucher evidence')
}
