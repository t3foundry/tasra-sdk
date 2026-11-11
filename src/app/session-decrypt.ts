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
// The re-open never resends a paid write: the message is paid afresh (a new request id) on the new
// grant's draw, and only within the same two-debit bound (an end before the message paid costs
// nothing; an end after a confirmed-stale refusal is that refusal's one retry).

import type {Hex} from 'viem'
import {TasraError} from '../errors.js'
import {PaidDrawMovedError, readCurrentBeaconEpoch} from '../chain/prepaid.js'
import type {DecryptionBindingWire} from '../crypto/recipient.js'
import type {KeeperExecutionApprover} from '../committee/keeperExecution.js'
import {decryptWithSessionGrant, type SessionDecryptItem, type SessionDecryptOptions, type SessionDecryptResult,
  type SessionVerifierProofWire} from '../decryption/session.js'
import {paidSessionDecrypt, type PaidOperationConfig, type PaidSessionDecrypt} from './paid-operation.js'
import {SessionEndedError, type GrantedSession} from './session-grants.js'

/** One message to decrypt under a session. */
export interface SessionMessageRequest {
  /** Paid operation configuration (the slot creator pays each message). */
  config: PaidOperationConfig
  /** The accepted session ({@link GrantedSession}); call its `start()` so it follows the beacon. */
  session: GrantedSession
  /**
   * Open a NEW session (a fresh presentation, accepted and started) when `session` ended before
   * this message was served (`SessionEndedError`). Called at most once per message; without it the
   * end is thrown. The message then continues on the returned session
   * ({@link SessionMessageResult.session}); the caller keeps that one for its next messages.
   */
  reopen?(ended: SessionEndedError): Promise<GrantedSession>
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
   * `readCurrentBeaconEpoch` on `config.chain.client` and `config.deployment`). A keeper's refusal
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
    /** The message is paid and sent again on a refreshed grant (`reason`: `draw-moved` or `stale`). */
    onRetry?(reason: 'draw-moved' | 'stale'): void
    /** The session ended under this message and `reopen` is called (`code`: the end's). */
    onReopen?(code: string): void
  }
}

/** A decrypted message. */
export interface SessionMessageResult {
  plaintext: Uint8Array
  /** Every payment this message made, in order (two only after a stale-grant retry). */
  requestIds: Hex[]
  /** The epoch of the grant that served it. */
  grantEpoch: bigint
  /** The session that served it: `request.session`, or the one `reopen` returned. */
  session: GrantedSession
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

/** The chain's beacon epoch now, or undefined when the read fails (never cached across decisions). */
async function chainBeacon(request: SessionMessageRequest): Promise<bigint | undefined> {
  try {
    const epoch = await (request.latestBeaconEpoch ? request.latestBeaconEpoch() : readCurrentBeaconEpoch(request.config.chain.client, {...request.config.deployment}))
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
 * `SessionEndedError` (present again).
 */
export async function decryptInSession(request: SessionMessageRequest): Promise<SessionMessageResult> {
  const {slot, hooks} = request
  let session = request.session
  const requestIds: Hex[] = []
  let retried = false, reopened = false
  for (;;) {
    let grant: ReturnType<GrantedSession['current']>, verified: Awaited<ReturnType<GrantedSession['verifiedFor']>>
    try {
      await settle(session)
      grant = session.current()
      verified = await session.verifiedFor(slot)
    } catch (error) {
      // The session ended (nothing of this attempt is paid yet): open a new one, once.
      if (!(error instanceof SessionEndedError) || !request.reopen || reopened) throw error
      reopened = true
      hooks?.onReopen?.(error.code)
      session = await request.reopen(error)
      continue
    }
    const proofs = request.verifierProofs ? await request.verifierProofs(slot, BigInt(grant.epoch)) : undefined
    let paid: PaidSessionDecrypt
    try {
      paid = await paidSessionDecrypt(request.config, {slot, decryption: request.message.decryption, grant: {epoch: grant.epoch, seed: grant.seed},
        ...request.ttlSecs !== undefined ? {ttlSecs: request.ttlSecs} : {}, ...request.signal ? {signal: request.signal} : {},
        onBeaconEpoch: epoch => session.observeBeacon(epoch),
        onRequestId: async id => { requestIds.push(id); await hooks?.onRequestId?.(id) }})
    } catch (error) {
      // The grant left the window before anything was signed or paid: refresh and pay once more.
      if (error instanceof PaidDrawMovedError && !retried) {
        session.observeBeacon(error.beaconEpoch)
        retried = true
        hooks?.onRetry?.('draw-moved')
        continue
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
