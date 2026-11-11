// ADR-0090 D7–D9 one message under a session grant, end to end: pay on the grant's draw, decrypt
// through the keepers, and survive a beacon-epoch boundary.
//
// Keepers admit a grant only while its epoch is the beacon's latest or previous, and the agent
// continues a session exactly ONE epoch per refresh. So a grant must follow the beacon: the
// session refreshes in the background as soon as a CHAIN observation (this payment's discovery,
// the beacon poll, a fresh read a keeper refusal triggers) shows the beacon past the grant's
// epoch; a keeper's own claim about the beacon is never taken as one. The held grant
// stays admissible for the whole next epoch. A message that still crosses the boundary (its grant
// two epochs behind by the time the keepers judge it) is refused by every keeper BEFORE any item
// runs; then, and only when a fresh chain read confirms the grant really left the window, this
// helper waits for the refreshed grant, pays the message again on its draw and sends it once more.
//
// What the first payment costs: its debit stays in the cumulative allowance voucher (it uses
// allowance headroom until settled) and, unexecuted, is refunded (paid = 0, prepaidRefunded =
// cost) when the settlement worker settles it after the payment's expiry; that close is blocked
// while an operator named on that debit is unreachable. The residual risk is bounded: a keeper can
// compute its partial yet answer "stale" (and later report the execution it approved), so a
// message may pay at most TWO debits, and only when every other keeper also refused before
// execution AND the chain independently shows the grant two epochs behind, i.e. the retry was due.
//
// A session that ENDS under a message (a definite refusal such as `session_context_changed`, the
// beacon two epochs past the grant, idle/absolute expiry) is re-opened ONCE for that message when
// the caller supplies `reopen` (a fresh presentation is the caller's: only it holds the wallet).
// The re-open never resends a paid write. Its presentation IS a paid KEM decrypt, so it must
// decrypt THIS message: it returns the decrypt shares it opened, and this helper verifies them
// against this message's ciphertext and the keepers' authenticated verifying shares and combines
// them itself (the AEAD open under this message's identity), so a plaintext of any other message
// can never be returned for this one. The message is then served; nothing more is paid. Its
// payment counts among the message's debits (and its ids in `requestIds`): an end before the message paid costs
// that one debit; an end after a confirmed-stale refusal is that refusal's one retry. The bound is
// enforced: no payment and no re-open is started once the message holds MAX_MESSAGE_DEBITS (2).
//
// Concurrent messages of one ended session share ONE re-open: the first calls `reopen` (serving
// its own message), the others wait for it and continue on its new session, each paying its own
// message there as usual; when that presentation opened no grant they re-open in turn.

import type {Hex} from 'viem'
import {TasraError} from '../errors.js'
import {PaidDrawMovedError, readCurrentBeaconEpoch} from '../chain/prepaid.js'
import {PaidReservationStaleEpochError} from '../chain/reservation.js'
import type {DecryptionBindingWire} from '../crypto/recipient.js'
import type {KeeperExecutionApprover} from '../committee/keeperExecution.js'
import {combineDecryptShares, decodeKemU, verifyDecryptSharesBatch, type DecryptShare} from '../crypto/kem.js'
import {decryptWithSessionGrant, type SessionDecryptItem, type SessionDecryptOptions, type SessionDecryptResult,
  type SessionVerifierProofWire} from '../decryption/session.js'
import {NewerVerifierEpoch, paidSessionDecrypt, type PaidOperationConfig, type PaidSessionDecrypt} from './paid-operation.js'
import {SessionEndedError, type GrantedSession} from './session-grants.js'

/** One message to decrypt under a session. */
export interface SessionMessageRequest {
  /** Paid operation configuration (the slot creator pays each message). */
  config: PaidOperationConfig
  /** The accepted session ({@link GrantedSession}); call its `start()` so it follows the beacon. */
  session: GrantedSession
  /**
   * Open a NEW session when `session` ended before this message was served (`SessionEndedError`):
   * ONE fresh presentation (a paid KEM decrypt in session mode) of exactly `message` (its
   * `decryption` binding and recipient), accepted and started. Return the decrypt shares it opened
   * and its payment's request id ({@link SessionReopened}); the message is served from them, never
   * paid again. It may pay at most `budget.debits` (1 when the message already paid once); a
   * reply naming more, or none, is refused. Called at most once per message, and once per ended
   * session across concurrent messages (the others continue on its new session); without it the
   * end is thrown.
   */
  reopen?(ended: SessionEndedError, message: SessionMessageRequest['message'], budget: {debits: number}): Promise<SessionReopened>
  /** KEM slot the grant names. */
  slot: Hex
  /** The keepers and their shares: everything {@link decryptWithSessionGrant} takes but the grant, key and proofs. */
  keepers: Omit<SessionDecryptOptions, 'grant' | 'verified' | 'key' | 'slotId' | 'verifierProofs' | 'signal'>
  /** The anchored membership witnesses of the grant's draw at `epoch` (every production keeper requires them). */
  verifierProofs?(slot: Hex, epoch: bigint): Promise<SessionVerifierProofWire[] | undefined>
  /** The ciphertext, its recipient and its binding ({@link decryptionBinding}). */
  message: Omit<SessionDecryptItem, 'payment' | 'approveExecution' | 'recover'> & {decryption: DecryptionBindingWire}
  /**
   * The beacon's latest epoch, read FRESH from the chain for each decision (default
   * `readCurrentBeaconEpoch` on `config.chain.client` and `config.deployment`, at an RPC `latest`
   * head of its own, never a followed tip that may lag the keepers' head). A keeper's refusal
   * text never sets the session's beacon: it only triggers this read.
   */
  latestBeaconEpoch?(): Promise<bigint>
  /** Payment lifetime, seconds. */
  ttlSecs?: number
  signal?: AbortSignal
  /** Observers (timing, accounting); a throw from one is the caller's own. */
  hooks?: {
    onRequestId?(requestId: Hex): void | Promise<void>
    onPaid?(paid: PaidSessionDecrypt): void
    onApproval?(): void
    /**
     * The message is paid and sent again on a refreshed grant (`reason`: `draw-moved`, `stale`,
     * `reservation-stale` or `newer-verifier-epoch`).
     */
    onRetry?(reason: 'draw-moved' | 'stale' | 'reservation-stale' | 'newer-verifier-epoch'): void
    /** The session ended under this message and `reopen` is called (`code`: the end's). */
    onReopen?(code: string): void
  }
}

/** A re-open: its presentation decrypted the message in flight. */
export interface SessionReopened {
  /**
   * The presentation's decrypt shares for THIS message (D_i = sk_i·U of `message.ciphertext`, as
   * opened from the keepers' sealed partials, e.g. `collectSealedPartials`). Verified here against
   * this ciphertext and `keepers.verifyingShares`, combined against this ciphertext and identity
   * (AEAD), and zeroed after use: shares of any other message yield no plaintext.
   */
  shares: DecryptShare[]
  /** The presentation's payment request ids (normally one): counted in {@link SessionMessageResult.requestIds}. */
  requestIds: Hex[]
  /** The new session, absent when the presentation opened no grant. */
  session?: GrantedSession
}

/** A message pays at most this many debits, a re-open's presentation included. */
export const MAX_MESSAGE_DEBITS = 2

const HEX32 = /^0x[0-9a-fA-F]{64}$/

/** The running re-open of an ended session, shared by every message that finds it ended. */
const reopening = new WeakMap<GrantedSession, Promise<SessionReopened>>()
/** An ended session's re-opened successor: later messages of the ended session continue there. */
const successors = new WeakMap<GrantedSession, GrantedSession>()

/** A decrypted message. */
export interface SessionMessageResult {
  plaintext: Uint8Array
  /**
   * Every payment request id this message made, in order, a re-open's presentation included. At most
   * {@link MAX_MESSAGE_DEBITS} of them are debits: an allowance debit the accountant refused before
   * the per-operation fallback names an id too, but debits nothing, as does a reservation refused
   * before it was sent because the verifier epoch moved on (`NewerVerifierEpoch`).
   */
  requestIds: Hex[]
  /** The epoch of the grant that served it (after a presenting re-open: the new grant's, 0 without one). */
  grantEpoch: bigint
  /**
   * The session for the next messages: `request.session`, or the one `reopen` returned; absent
   * when the re-open's presentation served the message but opened no grant (open one again).
   */
  session?: GrantedSession
  /** The message was decrypted by the re-open's presentation, not under a grant. */
  presented?: true
}

/** A message the keepers refused (after the one retry a stale grant earns). */
export class SessionMessageError extends TasraError {
  constructor(readonly result: Extract<SessionDecryptResult, {ok: false}>, readonly requestIds: Hex[]) {
    super(`session item refused: ${result.error}`)
    this.name = 'SessionMessageError'
  }
  /** The first keeper code, for classification. */
  get code(): string { return this.result.codes[0] ?? 'session-item' }
}

/** The epoch of a re-opened session's grant (0 when there is none, or it already ended). */
function openedEpoch(session: GrantedSession | undefined): bigint {
  try { return session ? BigInt(session.current().epoch) : 0n } catch { return 0n }
}

/**
 * The plaintext of THIS message from a re-open's decrypt shares: each share's verifying share is the
 * keeper's authenticated one, each share verifies against this ciphertext's U, and the first
 * `threshold` valid ones are combined against this ciphertext and identity (the AEAD open). The
 * shares are zeroed whatever the outcome.
 */
async function combineReopened(request: SessionMessageRequest, shares: DecryptShare[]): Promise<Uint8Array> {
  const {ciphertext, identity} = request.message, {threshold, verifyingShares} = request.keepers
  try {
    if (!Array.isArray(shares)) throw new TasraError('Session re-open answered no decrypt shares')
    const seen = new Set<number>()
    const candidates: DecryptShare[] = []
    for (const share of shares) {
      const vs = share && verifyingShares.get(share.id)
      // One share per authenticated keeper; the supplied verifying share is never trusted.
      if (!vs || seen.has(share.id) || !(share.decryptionShare instanceof Uint8Array)) continue
      seen.add(share.id)
      candidates.push({id: share.id, decryptionShare: share.decryptionShare, verifyingShare: vs})
    }
    const verdict = verifyDecryptSharesBatch(candidates, decodeKemU(ciphertext.u))
    const valid = candidates.filter((_, i) => verdict[i]).slice(0, threshold)
    if (valid.length < threshold) throw new TasraError(`Session re-open shares do not decrypt this message (${valid.length}/${threshold} valid)`)
    const combine = request.keepers.combine ?? ((s: DecryptShare[], ct: typeof ciphertext, id: Uint8Array) => combineDecryptShares(s, ct, id, {verify: false}))
    try { return await combine(valid, ciphertext, identity) }
    catch (cause) { throw new TasraError('Session re-open shares do not decrypt this message (AEAD)', {cause}) }
  } finally {
    if (Array.isArray(shares)) for (const share of shares) if (share?.decryptionShare instanceof Uint8Array) share.decryptionShare.fill(0)
  }
}

/** The chain's beacon epoch now, or undefined when the read fails (never cached across decisions). */
async function chainBeacon(request: SessionMessageRequest): Promise<bigint | undefined> {
  try {
    const epoch = await (request.latestBeaconEpoch ? request.latestBeaconEpoch() : readCurrentBeaconEpoch(request.config.chain.client, {...request.config.deployment}, {fresh: true}))
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

/**
 * Decrypt one message under a session grant: pay it on the grant's draw ({@link paidSessionDecrypt}),
 * send it to the keepers ({@link decryptWithSessionGrant}), combine. A beacon move the payment's
 * discovery observes starts the grant's background refresh. A message whose grant the beacon has
 * already left is re-paid ONCE on the refreshed grant before anything is signed
 * (`PaidDrawMovedError`), or, refused by the keepers as stale with no keeper having run it
 * (`SessionDecryptResult.stale`), re-paid and re-sent ONCE, and only when a fresh chain read
 * ({@link SessionMessageRequest.latestBeaconEpoch}) confirms it: the beacon's latest epoch is past
 * the grant's epoch + 1 (so the draw moved and no keeper may admit it). When the chain still says
 * the grant is admissible, or cannot be read, the keepers' "stale" is unconfirmed and the refusal
 * is thrown: nothing is paid again. A grant-expiry claim is never confirmed this way (the session
 * checks `exp` itself before sending). Residual bound: at most two debits per message, the first
 * refunded unexecuted at settlement unless a keeper lied about not running it (module comment).
 * Every other refusal throws {@link SessionMessageError}; a session that cannot continue throws
 * `SessionEndedError` (present again). A session that ended is re-opened through `reopen`
 * (module comment): its presentation serves this message, single-flight per ended session.
 */
export async function decryptInSession(request: SessionMessageRequest): Promise<SessionMessageResult> {
  const {slot, hooks} = request
  let session = request.session
  const requestIds: Hex[] = []
  let retried = false
  /** A reservation refused before it was sent (`NewerVerifierEpoch`) was already paid again once. */
  let epochRetried = false
  /** Debits this message started: each payment, a stale-refused reservation (its intent may land), the re-open's presentation. */
  let debits = 0
  for (;;) {
    let grant: ReturnType<GrantedSession['current']>, verified: Awaited<ReturnType<GrantedSession['verifiedFor']>>
    try {
      await settle(session)
      grant = session.current()
      verified = await session.verifiedFor(slot)
    } catch (error) {
      // The session ended (nothing of this attempt is paid yet).
      if (!(error instanceof SessionEndedError)) throw error
      // Another message already re-opened it: continue on its session, paying as usual.
      const after = successors.get(session)
      if (after) { session = after; continue }
      // Another message is re-opening it now: wait for its session (one presentation per end).
      const running = reopening.get(session)
      if (running) {
        try { await running } catch { throw error }
        const opened = successors.get(session)
        if (opened) { session = opened; continue }
        // That presentation opened no grant: this message re-opens in turn (below).
      }
      // At most once per message: the re-open below always serves the message (or throws).
      if (!request.reopen || debits >= MAX_MESSAGE_DEBITS) throw error
      hooks?.onReopen?.(error.code)
      const ended = session, budget = MAX_MESSAGE_DEBITS - debits
      const flight = request.reopen(error, request.message, {debits: budget}).then(next => {
        if (next?.session) successors.set(ended, next.session)
        return next
      })
      reopening.set(ended, flight)
      let next: SessionReopened
      try { next = await flight } finally { if (reopening.get(ended) === flight) reopening.delete(ended) }
      const ids = next?.requestIds
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > budget || ids.some(id => typeof id !== 'string' || !HEX32.test(id))) {
        if (Array.isArray(next?.shares)) for (const share of next.shares) share?.decryptionShare?.fill?.(0)
        throw new TasraError(`Session re-open must name its presentation's payment (1..${budget} request ids)`)
      }
      requestIds.push(...ids)
      // The opening presentation decrypted this message: served from its shares; nothing more is paid.
      const plaintext = await combineReopened(request, next.shares)
      return {plaintext, requestIds, grantEpoch: openedEpoch(next.session), ...next.session ? {session: next.session} : {}, presented: true}
    }
    const proofs = request.verifierProofs ? await request.verifierProofs(slot, BigInt(grant.epoch)) : undefined
    // The two-debit bound, enforced (a re-open's presentation counts).
    if (debits >= MAX_MESSAGE_DEBITS) throw new TasraError(`Session message already started ${debits} debits; not paying again`)
    let paid: PaidSessionDecrypt
    try {
      paid = await paidSessionDecrypt(request.config, {slot, decryption: request.message.decryption, grant: {epoch: grant.epoch, seed: grant.seed},
        ...request.ttlSecs !== undefined ? {ttlSecs: request.ttlSecs} : {}, ...request.signal ? {signal: request.signal} : {},
        onBeaconEpoch: epoch => session.observeBeacon(epoch),
        onRequestId: async id => { requestIds.push(id); await hooks?.onRequestId?.(id) }})
      debits++
    } catch (error) {
      // The grant left the window before anything was signed or paid: refresh and pay once more.
      if (error instanceof PaidDrawMovedError && !retried) {
        session.observeBeacon(error.beaconEpoch)
        retried = true
        hooks?.onRetry?.('draw-moved')
        continue
      }
      // The reservation waited for its payer until the grant's epoch was two behind the beacon and
      // was refused BEFORE anything was sent: no reservation was prepared, persisted or broadcast,
      // and its journal is `failed` (never resumed). It debited nothing, so it does not count as a
      // debit; it is paid again once, on the refreshed grant (the epoch it carries is this
      // process's own chain read, which starts the follow), and only while the message is under
      // its debit bound. A second one is thrown.
      if (error instanceof NewerVerifierEpoch && error.code === 'newer-verifier-epoch' && !epochRetried && debits < MAX_MESSAGE_DEBITS) {
        session.observeBeacon(error.beaconEpoch)
        epochRetried = true
        hooks?.onRetry?.('newer-verifier-epoch')
        continue
      }
      // The accountant refused the reservation's draw as no longer current or previous (it waited
      // past an epoch tick; nothing was sent). That intent may still land, permissionlessly, until
      // it expires: it stays journaled and is never re-sent. It cannot execute (keepers execute a
      // session item only with the payment this helper sends them), so if it lands it is refunded
      // unexecuted at settlement, like a stale-refused first debit. Pay once more only when a fresh
      // chain read confirms the grant left the window (which also ends the session, so the retry
      // runs on a re-opened one): the same two-debit bound.
      const refused = error as {code?: unknown; cause?: unknown} | undefined
      if (refused?.code === 'reservation-refused' && refused.cause instanceof PaidReservationStaleEpochError && !retried) {
        debits++
        const latest = await chainBeacon(request)
        if (latest !== undefined) session.observeBeacon(latest)
        if (latest !== undefined && latest > BigInt(grant.epoch) + 1n) {
          retried = true
          hooks?.onRetry?.('reservation-stale')
          continue
        }
      }
      throw error
    }
    try {
      hooks?.onPaid?.(paid)
      const approveExecution: KeeperExecutionApprover = async approval => {
        const approved = await paid.approveExecution(approval)
        hooks?.onApproval?.()
        return approved
      }
      const {decryption: _binding, ...message} = request.message
      const [result] = await decryptWithSessionGrant({...request.keepers, slotId: slot, grant, verified, key: session.key,
        ...proofs ? {verifierProofs: proofs} : {}, ...request.signal ? {signal: request.signal} : {}},
      [{...message, payment: paid.payment, approveExecution}])
      if (!result) throw new TasraError('Session keepers answered no item')
      if (result.ok) return {plaintext: result.plaintext, requestIds, grantEpoch: BigInt(grant.epoch), session}
      if (result.stale && !retried) {
        // Every keeper refused the grant as no longer current before running anything. Their text
        // (any "beacon latest N") is the keepers' claim, never fed into the session: it only
        // triggers a fresh chain read, and the chain's epoch is what the session follows.
        // Pay again only when the chain CONFIRMS staleness: a keeper that computed its partial and
        // answered "stale" anyway must not earn a second debit while the grant is still admissible.
        // An unreadable chain confirms nothing.
        const latest = await chainBeacon(request)
        // The chain's epoch is a fair observation either way (a move past the grant starts its follow).
        if (latest !== undefined) session.observeBeacon(latest)
        if (latest !== undefined && latest > BigInt(grant.epoch) + 1n) {
          retried = true
          hooks?.onRetry?.('stale')
          continue
        }
      }
      throw new SessionMessageError(result, requestIds)
    } finally { paid.dispose() }
  }
}
