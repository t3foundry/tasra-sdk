// ADR-0090 D7 messages under a session grant, end to end: decrypt through the keepers and survive
// a beacon-epoch boundary. Nothing is paid: the grant and the session-key proof authorize each
// message, and the keepers meter the work.
//
// Keepers admit a grant only while its epoch is the beacon's latest or previous, and the agent
// continues a session exactly ONE epoch per refresh. So a grant must follow the beacon: the
// session refreshes in the background as soon as a CHAIN observation (the beacon poll, a fresh
// read a keeper refusal triggers) shows the beacon past the grant's epoch; a keeper's own claim
// about the beacon is never taken as one. The held grant stays admissible for the whole next
// epoch. A message that still crosses the boundary (its grant two epochs behind by the time the
// keepers judge it) is refused by every keeper BEFORE any item runs; then, and only when a fresh
// chain read confirms the grant really left the window, this helper waits for the refreshed grant
// and sends the message once more.
//
// A session that ENDS under a message (a definite refusal such as `session_context_changed`, the
// beacon two epochs past the grant, idle/absolute expiry) is re-opened ONCE for that message when
// the caller supplies `reopen` (a fresh presentation is the caller's: only it holds the wallet);
// the message is then sent under the new session's grant. Concurrent messages of one ended
// session share ONE re-open: the first calls `reopen`, the others wait for it and continue on its
// new session.

import type {Hex} from 'viem'
import {TasraError} from '../errors.js'
import {MAX_BATCH_ITEMS} from '../committee/session-grant.js'
import {decryptWithSessionGrant, type SessionDecryptItem, type SessionDecryptOptions, type SessionDecryptResult,
  type SessionVerifierProofWire} from '../decryption/session.js'
import {SessionEndedError, type GrantedSession} from './session-grants.js'

/** What every message of a session shares: the session, its slot's keepers and the chain reads. */
export interface SessionDecryptContext {
  /** The accepted session ({@link GrantedSession}); call its `start()` so it follows the beacon. */
  session: GrantedSession
  /**
   * Open a NEW session when `session` ended before a message was served (`SessionEndedError`): ONE
   * fresh presentation in session mode, accepted and started. The message is then sent under its
   * grant. Called at most once per message, and once per ended session across concurrent messages
   * (the others continue on its new session); without it the end is thrown.
   */
  reopen?(ended: SessionEndedError): Promise<GrantedSession>
  /** KEM slot the grant names. */
  slot: Hex
  /** The keepers and their shares: everything {@link decryptWithSessionGrant} takes but the grant, key and proofs. */
  keepers: Omit<SessionDecryptOptions, 'grant' | 'verified' | 'key' | 'slotId' | 'verifierProofs' | 'signal'>
  /** The anchored membership witnesses of the grant's draw at `epoch` (every production keeper requires them). */
  verifierProofs?(slot: Hex, epoch: bigint): Promise<SessionVerifierProofWire[] | undefined>
  /**
   * The beacon's latest epoch, read FRESH from the chain for each decision (`readCurrentBeaconEpoch`
   * with `{fresh: true}`: an RPC `latest` head of its own, never a followed tip that may lag the
   * keepers' head). A keeper's refusal text never sets the session's beacon: it only triggers this
   * read. Without it a keeper's "stale" is never confirmed, so it is thrown, not retried.
   */
  latestBeaconEpoch?(): Promise<bigint>
  /** Aborts the keeper requests. */
  signal?: AbortSignal
  /** Observers (timing, accounting); a throw from one is the caller's own. */
  hooks?: {
    /** The message is sent again on a refreshed grant (`reason`: `stale`). */
    onRetry?(reason: 'stale'): void
    /** The session ended under this message and `reopen` is called (`code`: the end's). */
    onReopen?(code: string): void
  }
}

/** One message to decrypt under a session. */
export interface SessionMessageRequest extends SessionDecryptContext {
  /** The ciphertext, its identity, epoch and a fresh client recipient. */
  message: SessionDecryptItem
}

/** Up to 64 messages of one slot, decrypted in one request per keeper. */
export interface SessionBatchRequest extends SessionDecryptContext {
  /** The ciphertexts, each with its own fresh client recipient. */
  messages: SessionDecryptItem[]
}

/** The running re-open of an ended session, shared by every message that finds it ended. */
const reopening = new WeakMap<GrantedSession, Promise<GrantedSession>>()
/** An ended session's re-opened successor: later messages of the ended session continue there. */
const successors = new WeakMap<GrantedSession, GrantedSession>()

/** A decrypted message. */
export interface SessionMessageResult {
  /** The decrypted message bytes. */
  plaintext: Uint8Array
  /** The epoch of the grant that served it. */
  grantEpoch: bigint
  /** The session for the next messages: `request.session`, or the one `reopen` returned. */
  session: GrantedSession
}

/** The outcome of a batch: one result per message, in order. */
export interface SessionBatchResult {
  /** Per message: the plaintext, or the keepers' refusal. */
  results: SessionDecryptResult[]
  /** The epoch of the grant that served it. */
  grantEpoch: bigint
  /** The session for the next messages: `request.session`, or the one `reopen` returned. */
  session: GrantedSession
}

/** A message the keepers refused (after the one retry a stale grant earns). */
export class SessionMessageError extends TasraError {
  constructor(
    /** The keepers' refusal. */
    readonly result: Extract<SessionDecryptResult, {ok: false}>,
  ) {
    super(`session item refused: ${result.error}`)
    this.name = 'SessionMessageError'
  }
  /** The first keeper code, for classification. */
  get code(): string { return this.result.codes[0] ?? 'session-item' }
  /**
   * True when a keeper refused the message because the slot's Settlement balance does not cover
   * its unsettled metered work (HTTP 402): the slot's owner must fund the slot.
   */
  get slotBalance(): boolean { return this.result.refusals.some(r => r.status === 402) }
}

/** The chain's beacon epoch now, or undefined when the read fails or none is configured (never cached across decisions). */
async function chainBeacon(context: SessionDecryptContext): Promise<bigint | undefined> {
  if (!context.latestBeaconEpoch) return undefined
  try {
    const epoch = await context.latestBeaconEpoch()
    return typeof epoch === 'bigint' && epoch >= 0n ? epoch : undefined
  } catch { return undefined }
}

/**
 * Wait for a refresh only when the held grant cannot serve (two epochs behind the observed beacon).
 * A grant one epoch behind is still admissible for the whole epoch: the message uses it at once
 * and the follow runs in the background (re-kicked here, honoring its backoff); it never waits for
 * a refresh that may take a whole anchoring delay.
 */
async function settle(session: GrantedSession): Promise<void> {
  const beacon = session.beaconEpoch
  if (beacon === undefined) return
  const at = BigInt(session.current().epoch)
  if (at >= beacon) return
  if (at + 1n >= beacon) { session.observeBeacon(beacon); return }
  try { await session.followBeacon() } catch (error) {
    // The follow moved the grant into the window before it gave up: use it; a later observation retries.
    if (!(error instanceof SessionEndedError) && BigInt(session.current().epoch) + 1n >= (session.beaconEpoch ?? beacon)) return
    throw error
  }
}

/** The session a message continues on after `session` ended: a successor, a running re-open's, or a re-open of its own. */
async function continueAfterEnd(context: SessionDecryptContext, session: GrantedSession, ended: SessionEndedError, reopened: boolean): Promise<{session: GrantedSession; opened: boolean}> {
  // Another message already re-opened it: continue on its session.
  const after = successors.get(session)
  if (after) return {session: after, opened: false}
  // Another message is re-opening it now: wait for its session (one presentation per end).
  const running = reopening.get(session)
  if (running) {
    try { return {session: await running, opened: false} } catch { throw ended }
  }
  // At most once per message.
  if (!context.reopen || reopened) throw ended
  context.hooks?.onReopen?.(ended.code)
  const flight = context.reopen(ended).then(next => {
    if (!next || typeof next.current !== 'function') throw new TasraError('Session re-open returned no session')
    successors.set(session, next)
    return next
  })
  reopening.set(session, flight)
  try { return {session: await flight, opened: true} } finally { if (reopening.get(session) === flight) reopening.delete(session) }
}

async function run(context: SessionDecryptContext, items: SessionDecryptItem[]): Promise<SessionBatchResult> {
  const {slot, hooks} = context
  if (items.length === 0 || items.length > MAX_BATCH_ITEMS) throw new TasraError(`A session request carries 1..${MAX_BATCH_ITEMS} messages`)
  let session = context.session
  let retried = false, reopened = false
  for (;;) {
    let grant: ReturnType<GrantedSession['current']>, verified: Awaited<ReturnType<GrantedSession['verifiedFor']>>
    try {
      await settle(session)
      grant = session.current()
      verified = await session.verifiedFor(slot)
    } catch (error) {
      // The session ended (nothing of this attempt was sent).
      if (!(error instanceof SessionEndedError)) throw error
      const next = await continueAfterEnd(context, session, error, reopened)
      reopened = reopened || next.opened
      session = next.session
      continue
    }
    const proofs = context.verifierProofs ? await context.verifierProofs(slot, BigInt(grant.epoch)) : undefined
    const results = await decryptWithSessionGrant({...context.keepers, slotId: slot, grant, verified, key: session.key,
      ...proofs ? {verifierProofs: proofs} : {}, ...context.signal ? {signal: context.signal} : {}}, items)
    if (results.length !== items.length) throw new TasraError('Session keepers did not answer every message')
    const refused = results.filter((r): r is Extract<SessionDecryptResult, {ok: false}> => !r.ok)
    if (refused.length > 0 && refused.every(r => r.stale) && !retried) {
      // Every keeper refused the grant as no longer current before running anything. Their text
      // (any "beacon latest N") is the keepers' claim, never fed into the session: it only
      // triggers a fresh chain read, and the chain's epoch is what the session follows. Send again
      // only when the chain CONFIRMS staleness; an unreadable chain confirms nothing.
      const latest = await chainBeacon(context)
      // The chain's epoch is a fair observation either way (a move past the grant starts its follow).
      if (latest !== undefined) session.observeBeacon(latest)
      if (latest !== undefined && latest > BigInt(grant.epoch) + 1n) {
        retried = true
        hooks?.onRetry?.('stale')
        // The whole request is sent again only when no message of it was served; otherwise the
        // served ones are returned and the caller re-sends the refused ones.
        if (refused.length === results.length) continue
      }
    }
    return {results, grantEpoch: BigInt(grant.epoch), session}
  }
}

/**
 * Decrypt one message under a session grant: send it to the keepers
 * ({@link decryptWithSessionGrant}) and combine the sealed partials locally. A message refused by
 * the keepers as stale with no keeper having run it (`SessionDecryptResult.stale`) is sent again
 * ONCE on the refreshed grant, and only when a fresh chain read
 * ({@link SessionDecryptContext.latestBeaconEpoch}) confirms it: the beacon's latest epoch is past
 * the grant's epoch + 1 (so the draw moved and no keeper may admit it). When the chain still says
 * the grant is admissible, or cannot be read, the keepers' "stale" is unconfirmed and the refusal
 * is thrown. Every other refusal throws {@link SessionMessageError}; a session that cannot
 * continue throws `SessionEndedError` (present again), unless `reopen` opens a new one
 * (single-flight per ended session), under which the message is then sent.
 * @param request - Message, session, slot and keepers.
 */
export async function decryptInSession(request: SessionMessageRequest): Promise<SessionMessageResult> {
  const {results, grantEpoch, session} = await run(request, [request.message])
  const result = results[0]
  if (!result) throw new TasraError('Session keepers answered no item')
  if (!result.ok) throw new SessionMessageError(result)
  return {plaintext: result.plaintext, grantEpoch, session}
}

/**
 * Decrypt up to 64 messages of one slot under a session grant in ONE request per keeper (one
 * session-key proof over the ordered batch). Session handling is {@link decryptInSession}'s: a
 * batch the keepers refuse entirely as stale is sent again once when the chain confirms it, and
 * an ended session is re-opened through `reopen`. A message's own refusal never fails the batch:
 * each message gets its own result.
 * @param request - Messages, session, slot and keepers.
 */
export function decryptBatchInSession(request: SessionBatchRequest): Promise<SessionBatchResult> {
  return run(request, [...request.messages])
}
