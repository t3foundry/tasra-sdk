// ADR-0090 D7/D8 per-message KEM decrypts under a session grant. Each item carries its own payment
// (normally an allowance debit voucher) and its own sealed reply; one session-key proof covers the
// request: a single proof for one item, an ordered batch proof for `/v1/committee/decrypt/partials`.
//
// The wire is the keeper's (keykeeper-node `api/sealed_session.rs`):
// - an ITEM is today's sealed `/decrypt/partial` body without `committee_token` (and the evidence
//   fields), plus the operation's own (REQUIRED) `payment` and its `key_slot_id`, plus its one
//   contributor approval (kind `session-decrypt`, over the item body alone);
// - the batch body is `{session_grant, session_key, proof, items, verifier_proofs?}`; the single body
//   is the item's fields beside `session_grant`, `session_key` and `proof`;
// - the batch reply is one `{status: 200, partial}` or `{status, code, error}` per item, in order;
//   the single reply is the partial, or `{code, error}` with a non-2xx status (an older keeper
//   sends `{error}` alone).
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
import {parseRetryAfter} from '../internal/retryAfter.js'
import {TasraError} from '../errors.js'

/** One ciphertext to decrypt under the grant. */
export interface SessionDecryptItem {
  ciphertext: Ciphertext
  /** Exact identity (associated data) bytes the ciphertext was encrypted under. */
  identity: Uint8Array
  /** Fresh client recipient the keepers seal to. */
  recipient: ClientRecipient
  /** Canonical key epoch of the ciphertext. */
  ciphertextEpoch: number
  /** This item's own payment ({@link paidSessionDecrypt}); every keeper requires one per item. */
  payment: PaymentIntentWire
  /** Approves each keeper's contribution for exactly this item's payment. */
  approveExecution: KeeperExecutionApprover
  /**
   * Read a keeper's RETAINED partial for this item, after it answered that the item already ran
   * (`409 recoverable`: executed, audit row missing; `409 already claimed`: the payment was used).
   * Never re-sends work or pays again (`PaidSessionDecrypt.recoverPartial`). Returns the partial JSON.
   */
  recover?(nodeUrl: string, signal?: AbortSignal): Promise<unknown>
}

/** A verifier witness on the wire, as for a compound-token request (`verifier_proofs`). */
export interface SessionVerifierProofWire {verifier_index: number; operator: string; pubkey: string; proof: string[]}

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
  /**
   * Anchored membership witnesses of the grant's draw at the grant's epoch. A keeper with a
   * verifier-set registry (every production keeper) REQUIRES them; with them the request always
   * uses the batch route (the single route's approved item body cannot carry them).
   */
  verifierProofs?: SessionVerifierProofWire[]
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  /** Clock override, Unix seconds (tests). */
  clock?: () => number
  combine?: SessionCombiner
}

/** One keeper's refusal of one item. */
export interface SessionItemRefusal {
  nodeUrl: string
  status: number
  /** The keeper's stable code (`forbidden`, `session-stale`, ...), or `status N` from a keeper without one. */
  code: string
  /** The keeper's public-safe message, truncated. */
  message?: string
  /** `request`: the keeper refused the whole request before any item ran; `item`: this item alone. */
  scope: 'request' | 'item'
}

/**
 * One item's outcome: the plaintext, or why it failed (an item's refusal never fails the batch).
 * `stale` (see {@link isStaleSessionRefusal}) is true only when the grant was refused as no longer
 * current (its epoch left the beacon's window, or it passed its `exp`) and NO keeper ran this item:
 * every keeper answered, none contributed, none said it already ran it, and every refusal is one
 * that precedes execution. Only then may the caller refresh the grant and pay the message again,
 * and only after confirming the staleness itself (a keeper's word is not proof): {@link decryptInSession}
 * does, once, when a fresh chain read shows the grant two epochs behind. The unused debit stays in
 * the cumulative voucher and is refunded (paid = 0) when it settles after the payment's expiry.
 */
export type SessionDecryptResult = {ok: true; plaintext: Uint8Array}
  | {ok: false; error: string; codes: string[]; refusals: SessionItemRefusal[]; stale: boolean}

/**
 * Whether a keeper refusal says the session grant is no longer current: the stable code
 * `session-stale`, or (older keepers, whose whole-request refusals carry no code) the fixed messages
 * of the grant-freshness check and of the epoch-window seed pin. Both are judged before any item
 * is admitted, so such a refusal never follows an execution.
 */
export function isStaleSessionRefusal(r: Pick<SessionItemRefusal, 'status' | 'code' | 'message'>): boolean {
  if (r.code === 'session-stale') return true
  if (r.status !== 403 || !r.message) return false
  return /^session grant expired at \d+ \(now \d+\)/.test(r.message) || /\bepoch \d+ is not current \(beacon latest \d+\)/.test(r.message)
}

/** Statuses that a keeper answers only before an item runs (409 can mean "already ran"; 5xx is unknown). */
const PRE_EXECUTION = new Set([400, 401, 402, 403, 404, 410, 413, 429])
const MAX_MESSAGE_CHARS = 240

function freshJti(): string {
  return toBase64Url(randomBytes(24))
}

interface Prepared { item: SessionDecryptItem; requestHash: Uint8Array; body: Record<string, unknown>; U: ReturnType<typeof decodeKemU> }

function prepare(o: SessionDecryptOptions, item: SessionDecryptItem): Prepared {
  const content = kemContentDigest(item.ciphertext, item.identity)
  const digest = recipientPayloadDigest(content, item.ciphertextEpoch, item.recipient.recipient)
  const hash = requestHash(o.chainId, hexToBytes(o.slotId), 'decrypt', digest)
  if (!item.payment) throw new TasraError('Every session item carries its own payment')
  if (item.payment.action !== 'decrypt' || item.payment.slot.toLowerCase() !== o.slotId.toLowerCase()
    || item.payment.payload_digest.toLowerCase() !== bytesToHex(digest).toLowerCase()) throw new TasraError('Session item payment is not bound to this ciphertext and recipient')
  const body: Record<string, unknown> = {
    key_slot_id: o.slotId.slice(2).toLowerCase(),
    identity: new TextDecoder('utf-8', {fatal: true}).decode(item.identity),
    recipient: item.recipient.recipient, ciphertext_epoch: item.ciphertextEpoch,
    ciphertext: {u: base64Encode(item.ciphertext.u), nonce: base64Encode(item.ciphertext.nonce), aead_ct: base64Encode(item.ciphertext.aeadCt)},
    payment: structuredClone(item.payment),
  }
  return {item, requestHash: hash, body, U: decodeKemU(item.ciphertext.u)}
}

async function proofFor(o: SessionDecryptOptions, hashes: Uint8Array[], batch: boolean): Promise<SessionProofWire> {
  const iat = (o.clock ?? (() => Math.floor(Date.now() / 1000)))()
  const jti = freshJti()
  checkProofWindow(o.verified, o.key.jwk, {iat, jti}, iat)
  const grantHash = o.verified.grantHash
  const hash = batch ? sessionBatchProofHash(grantHash, hashes, iat, jti) : sessionProofHash(grantHash, hashes[0]!, iat, jti)
  return encodeSessionProof({iat, jti, signature: await o.key.sign(hash)})
}

interface Candidate { identifier: number; value: Uint8Array; verifyingShare: Uint8Array }

/** One item's answer from one keeper. */
type ItemReply = {status: 200; partial: unknown} | {status: number; code: string; message?: string; scope: 'request' | 'item'}

const messageOf = (error: unknown): string | undefined => typeof error === 'string' && error ? error.slice(0, MAX_MESSAGE_CHARS) : undefined

/** Codes of an item whose work already RAN at that keeper: re-serve it by recovery, never by paying again. */
const RAN = new Set(['recoverable', 'already-claimed'])

/**
 * The item code a keeper refusal names. A batch item and (since the second security review) the
 * single route both carry the keeper's stable `code` (`recoverable`, `conflict`, ...), which
 * decides; only an older keeper's single route, answering `{error}` alone, is told apart by its
 * fixed messages.
 */
function itemCode(status: number, code: unknown, error: unknown): string {
  const text = typeof error === 'string' ? error : ''
  const coded = typeof code === 'string' && /^[a-z0-9_-]{1,48}$/.test(code) ? code : undefined
  if (coded !== undefined) {
    // `conflict` is the family of every 409 but `recoverable`; a claimed payment is the one the
    // fan-out must not resend, named by the conflict's message.
    if (status === 409 && coded === 'conflict' && text.includes('already claimed')) return 'already-claimed'
    return coded
  }
  // Fallback for an older keeper without codes on the single route.
  if (status === 409 && text.includes('recover its result through the paid-execution recovery route')) return 'recoverable'
  if (status === 409 && text.includes('already claimed')) return 'already-claimed'
  return `status ${status}`
}

/** Largest keeper reply a session request reads, in bytes (64 sealed partials fit well below). */
const MAX_KEEPER_REPLY_BYTES = 4_194_304

/**
 * The reply body as text, refused the moment it passes `cap` BYTES while it streams (a declared
 * `content-length` over the cap is refused before reading), so a hostile keeper cannot make the
 * SDK buffer an unbounded body. A response without a body stream falls back to `text()`, capped.
 */
async function readCappedText(res: Response, cap: number, signal?: AbortSignal): Promise<string> {
  const tooLarge = () => new TasraError('Session keeper reply exceeds its byte limit')
  if (Number(res.headers.get('content-length')) > cap) {
    void res.body?.cancel().catch(() => {})
    throw tooLarge()
  }
  const reader = res.body?.getReader()
  if (!reader) {
    const text = await res.text()
    if (new TextEncoder().encode(text).length > cap) throw tooLarge()
    return text
  }
  const decoder = new TextDecoder()
  let bytes = 0, text = ''
  try {
    for (;;) {
      signal?.throwIfAborted()
      const {done, value} = await reader.read()
      if (done) break
      bytes += value.length
      if (bytes > cap) throw tooLarge()
      text += decoder.decode(value, {stream: true})
    }
    return text + decoder.decode()
  } finally {
    // Includes the cap refusal; never wait for a hostile body's cancel.
    void reader.cancel().catch(() => {})
  }
}

/**
 * Decrypt 1..64 ciphertexts under a session grant: one request per keeper (the single route for
 * one item without verifier proofs, the batch route otherwise), one fresh session-key proof per
 * request, then per item the first `threshold` distinct contributions that open and batch-verify
 * are combined locally. A keeper's `413 batch-too-large` splits the batch into requests of its
 * `max_items` (nothing ran), a `429` is retried once after its `Retry-After` inside the deadline,
 * and an item a keeper already ran (`409 recoverable` / `already claimed`) is re-served through
 * `item.recover` when the threshold is still short; nothing is ever paid twice.
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
  if (o.verifierProofs !== undefined && (!Array.isArray(o.verifierProofs) || o.verifierProofs.length === 0)) throw new TasraError('Session verifier proofs, when given, are nonempty')
  const prepared = items.map(item => prepare(o, item))
  const state: FanOutState = {candidates: prepared.map(() => new Map<number, Candidate>()), codes: prepared.map(() => [] as string[]),
    ran: prepared.map(() => [] as string[]), refusals: prepared.map(() => [] as SessionItemRefusal[]), answered: prepared.map(() => 0), errors: [] as string[]}
  try {
    await withNetworkDeadline(signal => fanOut({...o, signal}, prepared, state), o.signal)
    await recoverShort(o, prepared, state)
    return await combineAll(o, prepared, state)
  } finally {
    for (const c of state.candidates) for (const v of c.values()) v.value.fill(0)
  }
}

interface FanOutState {
  candidates: Map<number, Candidate>[]; codes: string[][]; ran: string[][]
  /** Per item: every keeper refusal, in arrival order. */
  refusals: SessionItemRefusal[][]
  /** Per item: how many keepers answered it at all (a transport failure is no answer). */
  answered: number[]
  errors: string[]
}

async function fanOut(o: SessionDecryptOptions, prepared: Prepared[], state: FanOutState): Promise<void> {
  const settled = await Promise.allSettled(o.nodeUrls.map(async nodeUrl => {
    const base = nodeUrl.replace(/\/$/, '')
    const approved = await Promise.all(prepared.map(p => withKeeperExecutionApprovals({body: p.body, kind: 'session-decrypt', nodeUrl,
      payment: p.item.payment, approveExecution: p.item.approveExecution, signal: o.signal})))
    const replies = await send(o, base, prepared.map((p, i) => ({index: i, hash: p.requestHash, body: approved[i]!})))
    await Promise.all(replies.map(async (reply, i) => {
      state.answered[i]!++
      if (reply.status !== 200) {
        const r = reply as {status: number; code: string; message?: string; scope: 'request' | 'item'}
        state.codes[i]!.push(r.code)
        state.refusals[i]!.push({nodeUrl, status: r.status, code: r.code, ...r.message ? {message: r.message} : {}, scope: r.scope})
        if (RAN.has(r.code)) state.ran[i]!.push(nodeUrl)
        return
      }
      await accept(o, prepared[i]!, state.candidates[i]!, state.codes[i]!, (reply as {partial: unknown}).partial)
    }))
  }))
  for (const s of settled) if (s.status === 'rejected') state.errors.push(String(s.reason))
}

/** Open one partial and keep it as a candidate (one per keeper identifier). */
async function accept(o: SessionDecryptOptions, p: Prepared, candidates: Map<number, Candidate>, codes: string[], partial: unknown): Promise<void> {
  const opened = await openPartial(o, p, partial)
  if (!opened) { codes.push('invalid-partial'); return }
  if (candidates.has(opened.identifier)) opened.value.fill(0)
  else candidates.set(opened.identifier, opened)
}

interface Outgoing { index: number; hash: Uint8Array; body: Record<string, unknown> }

/** Send `items` to one keeper and answer one reply per item, in order (splitting on 413, retrying a 429 once). */
async function send(o: SessionDecryptOptions, base: string, items: Outgoing[], split = false, retried = false): Promise<ItemReply[]> {
  const batch = items.length > 1 || o.verifierProofs !== undefined || split
  const proof = await proofFor(o, items.map(i => i.hash), batch)
  const session = {session_grant: o.grant, session_key: o.key.jwk, proof}
  const body = batch ? {...session, items: items.map(i => i.body), ...o.verifierProofs ? {verifier_proofs: o.verifierProofs} : {}} : {...items[0]!.body, ...session}
  const url = `${base}${batch ? '/v1/committee/decrypt/partials' : '/v1/committee/decrypt/partial'}`
  const res = await (o.fetchImpl ?? fetch)(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal: o.signal,
    redirect: 'error', credentials: 'omit'})
  const text = await readCappedText(res, MAX_KEEPER_REPLY_BYTES, o.signal)
  let json: Record<string, unknown> | undefined
  try { const v = text ? JSON.parse(text) as unknown : undefined; json = v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined } catch { json = undefined }
  // 413 batch-too-large: refused before anything ran; split into requests of the keeper's limit, each with its own proof.
  if (res.status === 413 && json?.code === 'batch-too-large' && !split) {
    const max = json.max_items
    if (typeof max !== 'number' || !Number.isSafeInteger(max) || max < 1 || max >= items.length) throw new TasraError(`Session keeper refused the batch size without a usable max_items (${url})`)
    const out: ItemReply[] = []
    for (let i = 0; i < items.length; i += max) out.push(...await send(o, base, items.slice(i, i + max), true))
    return out
  }
  // 429: the keeper's per-IP item bucket (or the grant's jti budget) is short now; nothing ran. One retry with a fresh proof.
  if (res.status === 429 && !retried) {
    const wait = parseRetryAfter(res.headers.get('retry-after')) ?? 1_000
    if (wait <= 5_000) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, wait)
        o.signal?.addEventListener('abort', () => { clearTimeout(t); reject(o.signal!.reason) }, {once: true})
      })
      return send(o, base, items, split, true)
    }
  }
  if (!batch) {
    if (res.ok) return [{status: 200, partial: json}]
    return [{status: res.status, code: itemCode(res.status, json?.code, json?.error), ...messageOf(json?.error) ? {message: messageOf(json?.error)} : {}, scope: 'item'}]
  }
  if (!res.ok) {
    // A whole-request refusal answers every item the same way (none of them ran).
    const code = itemCode(res.status, json?.code, json?.error), message = messageOf(json?.error)
    return items.map(() => ({status: res.status, code, ...message ? {message} : {}, scope: 'request' as const}))
  }
  const replies = json?.items
  if (!Array.isArray(replies) || replies.length !== items.length) throw new TasraError('Session keeper reply does not answer every item exactly once')
  return replies.map((reply: unknown): ItemReply => {
    const r = reply as {status?: unknown; partial?: unknown; code?: unknown; error?: unknown}
    if (r?.status === 200) return {status: 200, partial: r.partial}
    const status = typeof r?.status === 'number' ? r.status : 0
    const message = messageOf(r?.error)
    return {status, code: itemCode(status, r?.code, r?.error), ...message ? {message} : {}, scope: 'item'}
  })
}

/** For each item still short of its threshold: read the retained partial of every keeper that said it already ran it. */
async function recoverShort(o: SessionDecryptOptions, prepared: Prepared[], state: FanOutState): Promise<void> {
  await Promise.all(prepared.map(async (p, i) => {
    if (!p.item.recover) return
    for (const nodeUrl of state.ran[i]!) {
      if (state.candidates[i]!.size >= o.threshold) return
      o.signal?.throwIfAborted()
      try { await accept(o, p, state.candidates[i]!, state.codes[i]!, await p.item.recover(nodeUrl, o.signal)) }
      catch (error) {
        o.signal?.throwIfAborted()
        state.codes[i]!.push('recovery-failed')
        state.errors.push(`recovery from ${nodeUrl}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }))
}

async function combineAll(o: SessionDecryptOptions, prepared: Prepared[], state: FanOutState): Promise<SessionDecryptResult[]> {
  const combine = o.combine ?? ((shares, ct, identity) => combineDecryptShares(shares, ct, identity, {verify: false}))
  const results: SessionDecryptResult[] = []
  for (const [i, p] of prepared.entries()) {
    const list = [...state.candidates[i]!.values()]
    try {
      const shares: DecryptShare[] = list.map(c => ({id: c.identifier, decryptionShare: c.value, verifyingShare: c.verifyingShare}))
      const verdict = verifyDecryptSharesBatch(shares, p.U)
      const valid = shares.filter((_, j) => verdict[j]).slice(0, o.threshold)
      if (valid.length < o.threshold) {
        const refusals = state.refusals[i]!
        const said = [...new Set(refusals.map(r => `${r.code}${r.message ? ' (' + r.message + ')' : ''}`))]
        const detail = [...said, ...state.errors]
        results.push({ok: false, error: `session partial threshold not met (${valid.length}/${o.threshold})${detail.length ? ': ' + detail.join('; ') : ''}`,
          codes: state.codes[i]!, refusals, stale: staleUnrun(o, state, i)})
        continue
      }
      results.push({ok: true, plaintext: await combine(valid, p.item.ciphertext, p.item.identity)})
    } catch (error) {
      results.push({ok: false, error: String(error), codes: state.codes[i]!, refusals: state.refusals[i]!, stale: false})
    }
  }
  return results
}

/**
 * True when item `i` is a staleness refusal that ran NOWHERE: every keeper answered it, none
 * contributed or said it already ran it (nor did a recovery read), every refusal precedes execution,
 * and at least one names a stale grant. A transport failure leaves "did it run?" open: never stale.
 */
function staleUnrun(o: SessionDecryptOptions, state: FanOutState, i: number): boolean {
  const refusals = state.refusals[i]!
  return state.answered[i] === o.nodeUrls.length && state.candidates[i]!.size === 0 && state.ran[i]!.length === 0
    && refusals.length === o.nodeUrls.length && refusals.every(r => PRE_EXECUTION.has(r.status) && !RAN.has(r.code))
    && refusals.some(isStaleSessionRefusal)
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
