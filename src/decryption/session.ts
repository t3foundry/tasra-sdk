// ADR-0090 D7 per-message KEM decrypts under a session grant. Each item carries its own sealed
// reply; one session-key proof covers the request: a single proof for one item, an ordered batch
// proof for `/v1/committee/decrypt/partials`. Nothing is paid: the keepers meter the work.
//
// The wire is the keeper's (keykeeper-node `api/sealed_session.rs`):
// - an ITEM is `{key_slot_id, identity, recipient, ciphertext_epoch, ciphertext{u,nonce,aead_ct},
//   dual_control?, user_signature?}`;
// - the batch body is `{session_grant, session_key, proof, items, verifier_proofs?}`; the single body
//   is the item's fields beside `session_grant`, `session_key` and `proof`;
// - the proof signs `request_hash(chain, slot, decrypt, payload_digest(content, ciphertext_epoch,
//   recipient))` per item; the item body itself is not hashed or signed;
// - the batch reply is one `{status: 200, partial}` or `{status, code, error}` per item, in order;
//   the single reply is the partial, or `{code, error}` with a non-2xx status (an older keeper
//   sends `{error}` alone).
//
// Reply handling is the sealed path's (decryption/sealed.ts): same slot/epoch/verifying-share
// checks, same HPKE open bound to the request hash; shares are then verified IN BATCHES per item
// (kem.verifyDecryptSharesBatch, exactly the per-share verdicts) before the combine.

import {keccak_256} from '@noble/hashes/sha3'
import {concatBytes, randomBytes} from '@noble/hashes/utils'
import {base64Decode, base64Encode} from '../crypto/envelope.js'
import {bytesToHex, hexToBytes} from '../crypto/hex.js'
import {combineDecryptShares, decodeKemU, verifyDecryptSharesBatch, type Ciphertext, type DecryptShare} from '../crypto/kem.js'
import {kemContentDigest, recipientPayloadDigest, type ClientRecipient, type SealedShareWire} from '../crypto/recipient.js'
import {requestHash} from '../oid4vp/binding.js'
import type {DualOperationProof} from '../committee/dual-operation.js'
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
  /** Native approvals for this item (`assembleDualOperation`), on a slot with an approval policy. */
  dualControl?: DualOperationProof
  /** 64-byte owner signature, on a slot with a registered owner key. */
  userSignature?: Uint8Array
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
   * verifier-set registry (every production keeper) REQUIRES them; with them the request uses
   * the batch route.
   */
  verifierProofs?: SessionVerifierProofWire[]
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  /** Clock override, Unix seconds (tests). */
  clock?: () => number
  combine?: SessionCombiner
  /**
   * How long a keeper may take, in milliseconds, before the next keeper is asked as well. Default:
   * 1500 plus 50 per item. A keeper that answers late still counts.
   */
  hedgeAfterMs?: number
  /** Randomness for retry jitter, in [0, 1) (tests). Default `Math.random`. */
  random?: () => number
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
 * every keeper answered, none contributed, and every refusal is one that precedes execution. Only
 * then should the caller refresh the grant and send the message again, after confirming the
 * staleness itself (a keeper's word is not proof): {@link decryptInSession} does, once, when a
 * fresh chain read shows the grant two epochs behind.
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
  if (/^session grant expired at \d+ \(now \d+\)/.test(r.message)) return true
  // The epoch-window message is stale only when the grant is BEHIND the keeper's window. A grant
  // AHEAD of it (the keeper's beacon lags; C24 keepers answer that `forbidden` with the same text)
  // is the keeper's problem: retry later or elsewhere, never refresh because of it.
  const window = /\bepoch (\d+) is not current \(beacon latest (\d+)\)/.exec(r.message)
  return window !== null && BigInt(window[1]!) + 1n < BigInt(window[2]!)
}

/**
 * Statuses that a keeper answers only before an item runs (a 409 or a 5xx leaves that open). 402
 * is the metered admission bound: the slot's balance does not cover its unsettled metered work.
 */
const PRE_EXECUTION = new Set([400, 401, 402, 403, 404, 410, 413, 429])

/**
 * Whether a keeper answers `status` only before an operation runs (a 409 or a 5xx leaves that
 * open). Shared with the one-shot sealed fan-out, which tells staleness by the same rule.
 * @param status - The keeper's HTTP status.
 */
export function isPreExecutionStatus(status: number): boolean {
  return PRE_EXECUTION.has(status)
}

/**
 * Whether a keeper refused an item because the slot's Settlement balance does not cover its
 * unsettled metered work (HTTP 402). Nothing ran; the slot's owner funds the slot.
 * @param r - One keeper refusal.
 */
export function isSlotBalanceSessionRefusal(r: Pick<SessionItemRefusal, 'status'>): boolean {
  return r.status === 402
}
const MAX_MESSAGE_CHARS = 240

function freshJti(): string {
  return toBase64Url(randomBytes(24))
}

interface Prepared { item: SessionDecryptItem; requestHash: Uint8Array; body: Record<string, unknown>; U: ReturnType<typeof decodeKemU> }

function prepare(o: SessionDecryptOptions, item: SessionDecryptItem): Prepared {
  const content = kemContentDigest(item.ciphertext, item.identity)
  const digest = recipientPayloadDigest(content, item.ciphertextEpoch, item.recipient.recipient)
  const hash = requestHash(o.chainId, hexToBytes(o.slotId), 'decrypt', digest)
  if (item.userSignature !== undefined && item.userSignature.length !== 64) throw new TasraError('Session item user signature must be 64 bytes')
  const body: Record<string, unknown> = {
    key_slot_id: o.slotId.slice(2).toLowerCase(),
    identity: new TextDecoder('utf-8', {fatal: true}).decode(item.identity),
    recipient: item.recipient.recipient, ciphertext_epoch: item.ciphertextEpoch,
    ciphertext: {u: base64Encode(item.ciphertext.u), nonce: base64Encode(item.ciphertext.nonce), aead_ct: base64Encode(item.ciphertext.aeadCt)},
    ...(item.dualControl ? {dual_control: structuredClone(item.dualControl)} : {}),
    ...(item.userSignature ? {user_signature: bytesToHex(item.userSignature).slice(2)} : {}),
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

/**
 * The item code a keeper refusal names: the keeper's stable `code` (`forbidden`, `conflict`,
 * `session-stale`, ...), or `status N` from a keeper that sent none.
 */
function itemCode(status: number, code: unknown): string {
  return typeof code === 'string' && /^[a-z0-9_-]{1,48}$/.test(code) ? code : `status ${status}`
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
 * Decrypt 1..64 ciphertexts under a session grant. Only `threshold` keepers are asked, in the
 * request's own order ({@link sessionKeeperOrder}); another keeper is asked only for items a keeper
 * failed, refused or answered late. One request per keeper (the single route for one item without
 * verifier proofs, the batch route otherwise), one fresh session-key proof per request, then per
 * item `threshold` distinct contributions that open and batch-verify are combined locally. A keeper's `413 batch-too-large` splits the batch into requests of its
 * `max_items` (nothing ran) and a `429` is sent again after its `Retry-After`, up to five times and ten seconds, inside the deadline.
 * Every opened contribution is cleared before returning.
 * @param o - Grant, key, keepers, shares and threshold.
 * @param items - Ciphertexts, each with its own recipient.
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
  const state: FanOutState = {candidates: prepared.map(() => new Map<number, Candidate>()), valid: prepared.map(() => [] as Candidate[]),
    codes: prepared.map(() => [] as string[]), refusals: prepared.map(() => [] as SessionItemRefusal[]), answered: prepared.map(() => 0),
    errors: [] as string[], closed: false}
  try {
    await withNetworkDeadline(signal => fanOut({...o, signal}, prepared, state), o.signal)
    return await combineAll(o, prepared, state)
  } finally {
    state.closed = true
    for (const c of state.candidates) for (const v of c.values()) v.value.fill(0)
    for (const list of state.valid) for (const v of list) v.value.fill(0)
  }
}

interface FanOutState {
  /** Per item: opened contributions not yet verified, one per keeper identifier. */
  candidates: Map<number, Candidate>[]
  /** Per item: contributions that verified, one per keeper identifier. */
  valid: Candidate[][]
  codes: string[][]
  /** Per item: every keeper refusal, in arrival order. */
  refusals: SessionItemRefusal[][]
  /** Per item: how many keepers answered it at all (a transport failure is no answer). */
  answered: number[]
  errors: string[]
  /** Set when the request is over: a late keeper reply is discarded, never kept. */
  closed: boolean
}

/**
 * The order in which a request asks its keepers: by `keccak256(seed ‖ endpoint)`. The seed is the
 * first item's request hash, which covers a fresh reply key, so the order is uniform per request and
 * every keeper is asked (and paid) for the same part of the work over time. The first `threshold`
 * keepers are asked; the rest only when one of those fails.
 * @param nodeUrls - The slot's keeper endpoints.
 * @param seed - The request's first request hash.
 */
export function sessionKeeperOrder(nodeUrls: readonly string[], seed: Uint8Array): string[] {
  return nodeUrls
    .map(url => ({url, rank: bytesToHex(keccak_256(concatBytes(seed, new TextEncoder().encode(url.replace(/\/$/, '')))))}))
    .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))
    .map(entry => entry.url)
}

/** How long a keeper may take before the next one is asked as well: this base plus {@link HEDGE_PER_ITEM_MS} per item. */
const HEDGE_BASE_MS = 1_500
const HEDGE_PER_ITEM_MS = 50

/** Verify item `i`'s opened contributions once they could complete it; a share that fails is dropped. */
function verifyPending(o: SessionDecryptOptions, p: Prepared, state: FanOutState, i: number, force = false): void {
  const pending = [...state.candidates[i]!.values()]
  if (pending.length === 0 || (!force && state.valid[i]!.length + pending.length < o.threshold)) return
  state.candidates[i]!.clear()
  let verdict: boolean[]
  try {
    verdict = verifyDecryptSharesBatch(pending.map(c => ({id: c.identifier, decryptionShare: c.value, verifyingShare: c.verifyingShare})), p.U)
  } catch (error) {
    for (const c of pending) c.value.fill(0)
    state.codes[i]!.push('invalid-share')
    state.errors.push(String(error))
    return
  }
  pending.forEach((c, j) => {
    if (verdict[j]) state.valid[i]!.push(c)
    else { c.value.fill(0); state.codes[i]!.push('invalid-share') }
  })
}

/**
 * Ask the fewest keepers that can answer: the first `threshold` of {@link sessionKeeperOrder}, each
 * with every item. Another keeper is asked only for the items still short of `threshold` verified
 * contributions, when a keeper refused or failed them, returned a share that does not verify, or
 * has not answered within the hedge delay. Stops as soon as every item is complete.
 */
async function fanOut(o: SessionDecryptOptions, prepared: Prepared[], state: FanOutState): Promise<void> {
  const order = sessionKeeperOrder(o.nodeUrls, prepared[0]!.requestHash)
  const hedgeMs = o.hedgeAfterMs ?? HEDGE_BASE_MS + HEDGE_PER_ITEM_MS * prepared.length
  // Keepers asked for an item whose answer is awaited and not overdue.
  const awaited = prepared.map(() => 0)
  const running = new Set<Promise<void>>()
  const local = new AbortController()
  const onAbort = () => local.abort(o.signal?.reason)
  if (o.signal?.aborted) onAbort()
  else o.signal?.addEventListener('abort', onAbort, {once: true})
  const scoped = {...o, signal: local.signal}
  let next = 0
  let wake = () => {}
  const short = (i: number) => o.threshold - state.valid[i]!.length - state.candidates[i]!.size - awaited[i]!

  const ask = (indices: number[]): void => {
    const nodeUrl = order[next++]!
    const base = nodeUrl.replace(/\/$/, '')
    let counted = true
    const release = () => { if (counted) { counted = false; for (const i of indices) awaited[i]!-- } }
    for (const i of indices) awaited[i]!++
    const timer = setTimeout(() => { release(); wake() }, hedgeMs)
    const run = async (): Promise<void> => {
      try {
        const replies = await send(scoped, base, indices.map(i => ({index: i, hash: prepared[i]!.requestHash, body: prepared[i]!.body})))
        if (state.closed) return
        await Promise.all(replies.map(async (reply, j) => {
          const i = indices[j]!
          state.answered[i]!++
          if (reply.status !== 200) {
            const r = reply as {status: number; code: string; message?: string; scope: 'request' | 'item'}
            state.codes[i]!.push(r.code)
            state.refusals[i]!.push({nodeUrl, status: r.status, code: r.code, ...r.message ? {message: r.message} : {}, scope: r.scope})
            return
          }
          await accept(scoped, prepared[i]!, state, i, (reply as {partial: unknown}).partial)
        }))
        if (!state.closed) for (const i of indices) verifyPending(o, prepared[i]!, state, i)
      } catch (error) {
        if (!state.closed) state.errors.push(String(error))
      } finally {
        clearTimeout(timer)
        release()
      }
    }
    const task: Promise<void> = run().finally(() => { running.delete(task); wake() })
    running.add(task)
  }

  try {
    for (;;) {
      local.signal.throwIfAborted()
      if (prepared.every((_, i) => state.valid[i]!.length >= o.threshold)) return
      let asked = false
      while (next < order.length) {
        const lacking = prepared.map((_, i) => i).filter(i => short(i) > 0)
        if (lacking.length === 0) break
        ask(lacking)
        asked = true
      }
      if (asked) continue
      if (running.size === 0) return
      await new Promise<void>(resolve => { wake = resolve })
    }
  } finally {
    state.closed = true
    o.signal?.removeEventListener('abort', onAbort)
    // A keeper that is still working is no longer needed: stop reading it.
    local.abort(new TasraError('Session request finished'))
    await Promise.allSettled([...running])
  }
}

/** Open one partial and keep it for verification (one per keeper identifier). */
async function accept(o: SessionDecryptOptions, p: Prepared, state: FanOutState, i: number, partial: unknown): Promise<void> {
  const opened = await openPartial(o, p, partial)
  if (!opened) { state.codes[i]!.push('invalid-partial'); return }
  if (state.closed || state.candidates[i]!.has(opened.identifier) || state.valid[i]!.some(c => c.identifier === opened.identifier)) opened.value.fill(0)
  else state.candidates[i]!.set(opened.identifier, opened)
}

interface Outgoing { index: number; hash: Uint8Array; body: Record<string, unknown> }

/** Send `items` to one keeper and answer one reply per item, in order (splitting on 413, retrying a 429 once). */
/**
 * A keeper's 429 means its per-address bucket is short right now and nothing ran, so sending again
 * is safe. Several readers behind one address (an office, a NAT) drain one bucket together, so one
 * retry is not enough: a request is sent again up to this many times, waiting the keeper's
 * `Retry-After` plus a little jitter each time, within this total wait and the request deadline.
 */
const RATE_LIMIT_RETRIES = 5
const RATE_LIMIT_MAX_WAIT_MS = 5_000
const RATE_LIMIT_TOTAL_WAIT_MS = 10_000
const RATE_LIMIT_JITTER_MS = 250

async function send(o: SessionDecryptOptions, base: string, items: Outgoing[], split = false, retries = 0, waited = 0): Promise<ItemReply[]> {
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
  // 429: the keeper's per-IP item bucket (or the grant's jti budget) is short now; nothing ran. Send again with a fresh proof.
  if (res.status === 429 && retries < RATE_LIMIT_RETRIES) {
    const asked = parseRetryAfter(res.headers.get('retry-after')) ?? 1_000
    const wait = asked + Math.floor((o.random ?? Math.random)() * RATE_LIMIT_JITTER_MS)
    if (asked <= RATE_LIMIT_MAX_WAIT_MS && waited + wait <= RATE_LIMIT_TOTAL_WAIT_MS) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, wait)
        o.signal?.addEventListener('abort', () => { clearTimeout(t); reject(o.signal!.reason) }, {once: true})
      })
      return send(o, base, items, split, retries + 1, waited + wait)
    }
  }
  if (!batch) {
    if (res.ok) return [{status: 200, partial: json}]
    return [{status: res.status, code: itemCode(res.status, json?.code), ...messageOf(json?.error) ? {message: messageOf(json?.error)} : {}, scope: 'item'}]
  }
  if (!res.ok) {
    // A whole-request refusal answers every item the same way (none of them ran).
    const code = itemCode(res.status, json?.code), message = messageOf(json?.error)
    return items.map(() => ({status: res.status, code, ...message ? {message} : {}, scope: 'request' as const}))
  }
  const replies = json?.items
  if (!Array.isArray(replies) || replies.length !== items.length) throw new TasraError('Session keeper reply does not answer every item exactly once')
  return replies.map((reply: unknown): ItemReply => {
    const r = reply as {status?: unknown; partial?: unknown; code?: unknown; error?: unknown}
    if (r?.status === 200) return {status: 200, partial: r.partial}
    const status = typeof r?.status === 'number' ? r.status : 0
    const message = messageOf(r?.error)
    return {status, code: itemCode(status, r?.code), ...message ? {message} : {}, scope: 'item'}
  })
}

async function combineAll(o: SessionDecryptOptions, prepared: Prepared[], state: FanOutState): Promise<SessionDecryptResult[]> {
  const combine = o.combine ?? ((shares, ct, identity) => combineDecryptShares(shares, ct, identity, {verify: false}))
  const results: SessionDecryptResult[] = []
  for (const [i, p] of prepared.entries()) {
    try {
      // Contributions were verified as they completed the item; verify what is left for the count.
      verifyPending(o, p, state, i, true)
      const valid: DecryptShare[] = state.valid[i]!.slice(0, o.threshold).map(c => ({id: c.identifier, decryptionShare: c.value, verifyingShare: c.verifyingShare}))
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
 * contributed, every refusal precedes execution, and at least one names a stale grant. A transport failure leaves "did it run?" open: never stale.
 */
function staleUnrun(o: SessionDecryptOptions, state: FanOutState, i: number): boolean {
  const refusals = state.refusals[i]!
  return state.answered[i] === o.nodeUrls.length && state.candidates[i]!.size === 0 && state.valid[i]!.length === 0
    && refusals.length === o.nodeUrls.length && refusals.every(r => PRE_EXECUTION.has(r.status))
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
