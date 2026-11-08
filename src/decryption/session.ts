// ADR-0090 D7/D8 per-message KEM decrypts under a session grant. Each item carries its own payment
// (normally an allowance debit voucher) and its own sealed reply; one session-key proof covers the
// request: a single proof for one item, an ordered batch proof for `/v1/committee/decrypt/partials`.
//
// Reply handling is the sealed path's (decryption/sealed.ts): same slot/epoch/verifying-share
// checks, same HPKE open bound to the request hash; shares are then verified IN BATCHES per item
// (kem.verifyDecryptSharesBatch, exactly the per-share verdicts) before the combine.

import {randomBytes} from '@noble/hashes/utils'
import {base64Decode, base64Encode} from '../crypto/envelope.js'
import {bytesToHex, hexToBytes} from '../crypto/hex.js'
import {combineDecryptShares, decodeKemU, verifyDecryptSharesBatch, type Ciphertext, type DecryptShare} from '../crypto/kem.js'
import {kemContentDigest, recipientPayloadDigest, type ClientRecipient, type SealedShareWire} from '../crypto/recipient.js'
import {requestHash} from '../oid4vp/binding.js'
import {withKeeperExecutionApprovals, type KeeperExecutionApprover} from '../committee/keeperExecution.js'
import type {PaymentIntentWire} from '../committee/payment.js'
import {MAX_BATCH_ITEMS, checkProofWindow, encodeSessionProof, sessionBatchProofHash, sessionKeyThumbprint, toBase64Url, sessionProofHash,
  type SessionGrantWire, type SessionProofWire, type VerifiedSessionGrant} from '../committee/session-grant.js'
import type {SessionKeyHandle} from '../app/session-grants.js'
import {withNetworkDeadline} from '../internal/network.js'
import {httpError, TasraError} from '../errors.js'

/** One ciphertext to decrypt under the grant. */
export interface SessionDecryptItem {
  ciphertext: Ciphertext
  /** Exact identity (associated data) bytes the ciphertext was encrypted under. */
  identity: Uint8Array
  /** Fresh client recipient the keepers seal to. */
  recipient: ClientRecipient
  /** Canonical key epoch of the ciphertext. */
  ciphertextEpoch: number
  /** This item's own payment (paidSessionDecrypt); omitted only where a slot is unpaid. */
  payment?: PaymentIntentWire
  /** Approves each keeper's contribution for exactly this item's payment. */
  approveExecution?: KeeperExecutionApprover
}

/** Pluggable combine (e.g. a Web Worker); default runs combineDecryptShares in-process. */
export type SessionCombiner = (shares: DecryptShare[], ct: Ciphertext, identity: Uint8Array) => Uint8Array | Promise<Uint8Array>

/** Request-wide settings. */
export interface SessionDecryptOptions {
  /** Distinct assigned keeper endpoints. */
  nodeUrls: string[]
  chainId: number | bigint
  /** Slot the grant names. */
  slotId: `0x${string}`
  /** Current grant (GrantedSession.current()). */
  grant: SessionGrantWire
  /** The same grant verified for this slot (GrantedSession.verifiedFor). */
  verified: VerifiedSessionGrant
  /** The session key the grant binds. */
  key: SessionKeyHandle
  /** Keeper identifier → authenticated 144-byte G2 ‖ G1 verifying share. */
  verifyingShares: ReadonlyMap<number, Uint8Array>
  /** Distinct verified contributions needed per item. */
  threshold: number
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  /** Clock override, Unix seconds (tests). */
  clock?: () => number
  combine?: SessionCombiner
}

/** One item's outcome: the plaintext, or why it failed (an item's refusal never fails the batch). */
export type SessionDecryptResult = {ok: true; plaintext: Uint8Array} | {ok: false; error: string; codes: string[]}

function freshJti(): string {
  return toBase64Url(randomBytes(24))
}

interface Prepared { item: SessionDecryptItem; requestHash: Uint8Array; body: Record<string, unknown>; U: ReturnType<typeof decodeKemU> }

function prepare(o: SessionDecryptOptions, item: SessionDecryptItem): Prepared {
  const content = kemContentDigest(item.ciphertext, item.identity)
  const digest = recipientPayloadDigest(content, item.ciphertextEpoch, item.recipient.recipient)
  const hash = requestHash(o.chainId, hexToBytes(o.slotId), 'decrypt', digest)
  if (item.payment && (item.payment.action !== 'decrypt' || item.payment.slot.toLowerCase() !== o.slotId.toLowerCase()
    || item.payment.payload_digest.toLowerCase() !== bytesToHex(digest).toLowerCase())) throw new TasraError('Session item payment is not bound to this ciphertext and recipient')
  const body: Record<string, unknown> = {
    key_slot_id: o.slotId.slice(2).toLowerCase(),
    identity: new TextDecoder('utf-8', {fatal: true}).decode(item.identity),
    recipient: item.recipient.recipient, ciphertext_epoch: item.ciphertextEpoch,
    ciphertext: {u: base64Encode(item.ciphertext.u), nonce: base64Encode(item.ciphertext.nonce), aead_ct: base64Encode(item.ciphertext.aeadCt)},
    ...item.payment ? {payment: structuredClone(item.payment)} : {},
  }
  return {item, requestHash: hash, body, U: decodeKemU(item.ciphertext.u)}
}

async function proofFor(o: SessionDecryptOptions, hashes: Uint8Array[]): Promise<SessionProofWire> {
  const iat = (o.clock ?? (() => Math.floor(Date.now() / 1000)))()
  const jti = freshJti()
  checkProofWindow(o.verified, o.key.jwk, {iat, jti}, iat)
  const grantHash = o.verified.grantHash
  const hash = !batchRoute(hashes) ? sessionProofHash(grantHash, hashes[0]!, iat, jti) : sessionBatchProofHash(grantHash, hashes, iat, jti)
  return encodeSessionProof({iat, jti, signature: await o.key.sign(hash)})
}
// One item goes to the single route with a single proof; two or more use the batch route.
const batchRoute = (hashes: Uint8Array[]) => hashes.length > 1

interface Candidate { identifier: number; value: Uint8Array; verifyingShare: Uint8Array }

/**
 * Decrypt 1..64 ciphertexts under a session grant: one request per keeper (the single route for
 * one item, the batch route otherwise), one fresh session-key proof per request, then per item the
 * first `threshold` distinct contributions that open and batch-verify are combined locally.
 * Every opened contribution is cleared before returning.
 * @param o - Grant, key, keepers, shares and threshold.
 * @param items - Ciphertexts, each with its own recipient and payment.
 */
export async function decryptWithSessionGrant(o: SessionDecryptOptions, items: SessionDecryptItem[]): Promise<SessionDecryptResult[]> {
  if (items.length === 0 || items.length > MAX_BATCH_ITEMS) throw new TasraError(`A session request carries 1..${MAX_BATCH_ITEMS} items`)
  if (!Number.isInteger(o.threshold) || o.threshold < 1 || o.threshold > o.nodeUrls.length || o.threshold > o.verifyingShares.size) throw new TasraError('Invalid session decrypt threshold')
  if (new Set(o.nodeUrls.map(u => u.replace(/\/$/, ''))).size !== o.nodeUrls.length) throw new TasraError('Duplicate session keeper endpoint')
  if (bytesToHex(o.verified.slotId).toLowerCase() !== o.slotId.toLowerCase()) throw new TasraError('Session grant was verified for another slot')
  // A grant without its session key authorizes nothing: refuse before building or sending anything.
  if (bytesToHex(sessionKeyThumbprint(o.key.jwk)) !== bytesToHex(o.verified.sessionKeyThumbprint)) throw new TasraError('Session key thumbprint does not match the grant')
  return withNetworkDeadline(signal => run({...o, signal}, items), o.signal)
}

async function run(o: SessionDecryptOptions, items: SessionDecryptItem[]): Promise<SessionDecryptResult[]> {
  const prepared = items.map(item => prepare(o, item))
  const hashes = prepared.map(p => p.requestHash)
  const batch = batchRoute(hashes)
  const candidates = prepared.map(() => new Map<number, Candidate>())
  const codes = prepared.map(() => [] as string[])
  const controller = new AbortController()
  const signal = AbortSignal.any([controller.signal, o.signal!])
  const one = async (nodeUrl: string) => {
    const base = nodeUrl.replace(/\/$/, '')
    const approved = await Promise.all(prepared.map(p => withKeeperExecutionApprovals({body: p.body, kind: 'session-decrypt', nodeUrl,
      payment: p.item.payment, approveExecution: p.item.approveExecution, signal: o.signal})))
    const proof = await proofFor(o, hashes)
    const session = {session_grant: o.grant, session_key: o.key.jwk, proof}
    const body = batch ? {...session, items: approved} : {...approved[0]!, ...session}
    const url = `${base}${batch ? '/v1/committee/decrypt/partials' : '/v1/committee/decrypt/partial'}`
    const res = await (o.fetchImpl ?? fetch)(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal, redirect: 'error', credentials: 'omit'})
    const text = await res.text()
    if (text.length > 4_194_304) throw new TasraError('Session keeper reply exceeds its byte limit')
    if (!res.ok) throw await httpError(new Response(text, {status: res.status}), url, 'session partials')
    const json = JSON.parse(text) as Record<string, unknown>
    const replies = batch ? json.items : [{status: 200, partial: json}]
    if (!Array.isArray(replies) || replies.length !== prepared.length) throw new TasraError('Session keeper reply does not answer every item exactly once')
    await Promise.all(replies.map(async (reply: unknown, i: number) => {
      const r = reply as {status?: unknown; partial?: unknown; code?: unknown}
      if (r?.status !== 200) { codes[i]!.push(typeof r?.code === 'string' ? r.code : `status ${String(r?.status)}`); return }
      const opened = await openPartial(o, prepared[i]!, r.partial)
      if (!opened) { codes[i]!.push('invalid-partial'); return }
      if (candidates[i]!.has(opened.identifier)) opened.value.fill(0)
      else candidates[i]!.set(opened.identifier, opened)
    }))
  }
  const settled = await Promise.allSettled(o.nodeUrls.map(one))
  controller.abort()
  const errors = settled.flatMap(s => s.status === 'rejected' ? [String(s.reason)] : [])
  const combine = o.combine ?? ((shares, ct, identity) => combineDecryptShares(shares, ct, identity, {verify: false}))
  const results: SessionDecryptResult[] = []
  for (const [i, p] of prepared.entries()) {
    const list = [...candidates[i]!.values()]
    try {
      const shares: DecryptShare[] = list.map(c => ({id: c.identifier, decryptionShare: c.value, verifyingShare: c.verifyingShare}))
      const verdict = verifyDecryptSharesBatch(shares, p.U)
      const valid = shares.filter((_, j) => verdict[j]).slice(0, o.threshold)
      if (valid.length < o.threshold) { results.push({ok: false, error: `session partial threshold not met (${valid.length}/${o.threshold})${errors.length ? ': ' + errors.join('; ') : ''}`, codes: codes[i]!}); continue }
      results.push({ok: true, plaintext: await combine(valid, p.item.ciphertext, p.item.identity)})
    } catch (error) {
      results.push({ok: false, error: String(error), codes: codes[i]!})
    } finally { for (const c of list) c.value.fill(0) }
  }
  return results
}

async function openPartial(o: SessionDecryptOptions, p: Prepared, partial: unknown): Promise<Candidate | undefined> {
  const d = partial as {identifier?: unknown; epoch?: unknown; key_slot_id?: unknown; verifying_share?: unknown; sealed_share?: SealedShareWire}
  if (!d || typeof d.identifier !== 'number' || d.epoch !== p.item.ciphertextEpoch || typeof d.key_slot_id !== 'string'
    || d.key_slot_id.replace(/^0x/, '').toLowerCase() !== o.slotId.slice(2).toLowerCase() || typeof d.verifying_share !== 'string' || !d.sealed_share) return undefined
  const vs = o.verifyingShares.get(d.identifier)
  const supplied = base64Decode(d.verifying_share)
  if (!vs || vs.length !== 144 || supplied.length !== 144 || !vs.every((b, i) => b === supplied[i])) return undefined
  try {
    const value = await p.item.recipient.open(d.sealed_share, p.requestHash, d.identifier, d.epoch as number, vs)
    if (value.length !== 96) { value.fill(0); return undefined }
    return {identifier: d.identifier, value, verifyingShare: vs}
  } catch { return undefined }
}
