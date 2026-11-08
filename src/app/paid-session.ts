// Client-side driver for one registered paid verifier-agent session.
//
// Every billable write (session creation, each operator-stage approval, the wallet
// presentation, each continuation) is journaled `prepared` in the application store before
// it is sent and `confirmed` after its reply. A write whose reply was lost stays `prepared`
// and is never sent again by this driver: the caller reconciles it. Services supply
// proposals, never client intent; every proposal is checked against the anchored draw.
//
// One exception, for operator-stage approvals only, when the store implements `claim`: the signed
// approval body is retained BEFORE its first send and, after a definite 429/503 (not processed),
// resent byte-identically under a durable generation-bound permit, inside the approval's signed
// expiry (paid-approval.ts). Repeatable reads are paced the same way by the session itself.

import {executionBodyHash} from '../committee/execution.js'
import {MAX_PROPOSAL_WAIT_MS, PaidAgentControlError, type ClientApprovedPresentation, type PaidAgentProposal,
  type PaidRetainedPresentation, type RegisteredPaidAgentSession, type RetainedPaidApproval} from '../chain/registeredPaidAgent.js'
import {reconcileRetainedApproval, retainAndDeliverApproval, retainAndDeliverApprovals, supportsDurableApproval, type ApprovalJournalRecord} from './paid-approval.js'
import type {PaidVerifierWitness} from '../chain/prepaid.js'
import type {VerifiedRequestObject} from '../oid4vp/request-object.js'
import {VerifierAgentSessionError, type SessionStatusResult} from '../verifier-agent/index.js'
import type {ApplicationStore} from './ready-slot.js'

/** A presentation the client's own wallet built: the approved body and the encrypted form it posts. */
export interface PaidWalletPresentation {
  /** Complete presentation the client accepts for credential verification. */
  approved: ClientApprovedPresentation
  /** Encrypted `direct_post.jwt` form fields; must carry `response`. */
  form: Record<string, string>
}

/** Where a holder fetches the session's request object: the request URI and its `openid4vp://` QR/deep-link payload. */
export interface PaidSessionRequestLink {
  /** Agent-hosted request URI (`<endpoint>/v1/request/<session>`). */
  requestUri: string
  /** `openid4vp://?client_id=…&request_uri=…`, for a QR code or deep link. */
  qrPayload: string
}

/** How the holder answers the session's request object. */
export type PaidSessionHolder =
  | {
    /** The client holds the credential and posts the presentation itself (SDK wallet). */
    kind: 'local'
    /** Observe the verified request and its link (e.g. to log or hand off); not billable, shown again on resume. */
    present?(request: {request: VerifiedRequestObject} & PaidSessionRequestLink): void | Promise<void>
    /** Build the presentation for the verified request; called once, before anything is disclosed. Receives the request link too. */
    makePresentation(request: VerifiedRequestObject, link: PaidSessionRequestLink): PaidWalletPresentation | Promise<PaidWalletPresentation>
    /** Post the encrypted presentation to the agent's response URI. Called once; never repeated. */
    submit(request: VerifiedRequestObject, presentation: PaidWalletPresentation): Promise<void>
  }
  | {
    /** An external wallet (phone, Hovi) scans the request; the client approves what the agent retained. */
    kind: 'external'
    /** Show the verified request to the holder (render `qrPayload`). Called once. */
    present(request: {request: VerifiedRequestObject; requestUri: string; qrPayload: string}): void | Promise<void>
    /** Accept or refuse the complete presentation the agent retained from the wallet callback. */
    accept(candidate: PaidRetainedPresentation, request: VerifiedRequestObject): boolean | Promise<boolean>
  }

/** Inputs to {@link drivePaidSession}. */
export interface PaidSessionDriverOptions {
  /** Prepared session from prepareRegisteredPaidSession. */
  session: RegisteredPaidAgentSession
  /** Anchored drawn verifier witnesses the session was prepared with. */
  members: readonly PaidVerifierWitness[]
  /** Private durable store with exclusive locks. */
  store: ApplicationStore
  /** Cancellation for the whole drive. */
  signal: AbortSignal
  /** Holder strategy. */
  holder: PaidSessionHolder
  /**
   * Wait between polls when nothing else signals progress; receives the agent's Retry-After hint
   * when it sent one. While committee work is in flight (phase `verifying`) the driver holds a
   * status poll instead (`?wait=1`) and continues as soon as the agent answers a change; right
   * after it approved new proposals it continues at once.
   */
  wait(retryAfterMs?: number): Promise<void>
  /** Observe the verified request before any credential is disclosed (receives a detached copy). */
  observeRequest?(request: VerifiedRequestObject): void | Promise<void>
  /**
   * Resume a previous drive from the store: confirmed writes are skipped (creation is
   * reconciled by an authenticated read). Unknown creation can also be confirmed by a
   * verified read of the original session; every other unknown write still refuses. Default false: any
   * retained write refuses, so a first drive can never collide with an earlier attempt.
   */
  resume?: boolean
  /** Journal key prefix; default `wallet-` (compatible with records written by earlier drivers). */
  journalPrefix?: string
}

/** A retained write's outcome is unknown, or a resumed write differs from its original. */
export class PaidSessionRecoveryError extends Error {
  constructor(/** Journal entry that blocks the drive. */ readonly key: string, message: string) {
    super(message)
    this.name = 'PaidSessionRecoveryError'
  }
}

/** A held status poll that took this long ended on the agent's hold timer (20 s), not on a change. */
const HELD_POLL_ENDED_MS = 15_000

const ABSENT_ANCHORS = ['no anchored verifier and accountant snapshots', 'no current or previous anchored verifier and accountant snapshots']

/**
 * Retry a read-only discovery while the verifier and accountant snapshots for the current epoch
 * are not yet anchored. Only those two explicit outcomes are retried, before any reservation,
 * consent or delivery; every other failure is final.
 * @param read Discovery to run.
 * @param signal Bounds the total wait.
 * @param wait Delay between attempts.
 */
export async function waitForPaidSnapshot<T>(read: () => Promise<T>, signal: AbortSignal, wait: () => Promise<void>): Promise<T> {
  for (;;) {
    signal.throwIfAborted()
    try { return await read() }
    catch (error) {
      signal.throwIfAborted()
      if (!(error instanceof Error) || !ABSENT_ANCHORS.includes(error.message)) throw error
      await wait()
    }
  }
}

function same(a: unknown, b: unknown): boolean {
  try { return executionBodyHash(a as Record<string, unknown>) === executionBodyHash(b as Record<string, unknown>) }
  catch { return JSON.stringify(a) === JSON.stringify(b) }
}

/**
 * Drive one prepared paid session to a completed, verified committee token.
 * Creation, request-object approval, presentation, continuation and credential approvals are
 * each journaled before sending; an unknown outcome is never redelivered.
 * @param options Session, anchored witnesses, store, holder strategy and pacing.
 */
export async function drivePaidSession(options: PaidSessionDriverOptions): Promise<SessionStatusResult> {
  const {session, store, signal, wait, holder} = options
  const members = structuredClone([...options.members]), prefix = (options.journalPrefix ?? 'wallet-') + session.sessionId
  const resume = options.resume === true
  if (!/^[0-9a-f]{64}$/.test(session.sessionId)) throw new Error('Invalid original SDK session')
  if (!members.length || new Set(members.map(m => m.publicKey.toLowerCase())).size !== members.length) throw new Error('Original drawn witnesses must be distinct')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,40}$/.test(options.journalPrefix ?? 'wallet-')) throw new Error('Invalid paid session journal prefix')

  /** Journal, send once, confirm. Returns false when a resumed drive skipped a confirmed original. */
  const attempt = async (name: string, original: unknown, work: () => Promise<void>, recover?: () => Promise<void>): Promise<boolean> => {
    signal.throwIfAborted()
    const key = prefix + '-' + name
    return store.withLock(key, async () => {
      const retained = await store.load<{original: unknown; phase: string}>(key)
      if (retained !== undefined) {
        if (resume && retained?.phase === 'confirmed' && same(retained.original, original)) return false
        if (resume && retained?.phase === 'prepared' && same(retained.original, original) && recover) {
          // Only creation supplies this read-only recovery. It checks the original
          // provider, bearer and full context; no POST is repeated or replaced.
          await recover()
          signal.throwIfAborted()
          await store.save(key, {original: retained.original, phase: 'confirmed'})
          return false
        }
        throw new PaidSessionRecoveryError(key, retained?.phase === 'confirmed' && !resume
          ? 'Original paid write already attempted; reconcile it without redelivery'
          : 'Original paid write already attempted with an unknown or different outcome; reconcile it without redelivery')
      }
      await store.save(key, {original, phase: 'prepared'})
      // A crash or uncertain response retains prepared. No catch/retry deletes it.
      signal.throwIfAborted()
      await work()
      await store.save(key, {original, phase: 'confirmed'})
      return true
    })
  }
  /** First durable approval of a stage; refuses, sending nothing, when a record appeared concurrently. */
  const firstApproval = async (ctx: Parameters<typeof retainAndDeliverApproval>[0], original: unknown, sign: () => Promise<RetainedPaidApproval>) => {
    signal.throwIfAborted()
    if (!await retainAndDeliverApproval(ctx, original, sign)) {
      throw new PaidSessionRecoveryError(ctx.key, 'Original paid write already attempted with an unknown or different outcome; reconcile it without redelivery')
    }
  }
  const approve = async (presentation?: ClientApprovedPresentation, listed?: readonly PaidAgentProposal[]) => {
    // Every proposal is judged before any is sent: an operator outside the draw or an invalid stage
    // refuses the whole batch with nothing delivered. `listed` is a listing read beside a status poll.
    const planned = (listed ?? await session.proposals(signal)).map(proposed => {
      const member = members.find(m => m.publicKey.toLowerCase() === proposed.operator_key.toLowerCase())
      if (!member) throw new Error('Agent proposed an operator outside the original anchored draw')
      if (!['presentation_sign', 'presentation_attest', 'credential'].includes(proposed.stage)) throw new Error('Invalid agent operator stage')
      if (proposed.stage === 'credential' && !presentation) throw new Error('Credential work requires the original locally accepted presentation')
      if (proposed.stage !== 'credential' && presentation) throw new Error('Unexpected new request-signing stage after credential disclosure')
      return {proposed, member, name: proposed.stage + '-' + member.index}
    })
    // Distinct stages have distinct journal keys, signers and agent delivery rows: their approvals are
    // independent and go out together (one round trip per batch, not one per operator). A batch that
    // names one stage twice keeps the one-by-one order, where the second sees the first's journal.
    const one = (item: typeof planned[number]) => approveOne(item.proposed, item.member, item.name, presentation)
    if (new Set(planned.map(p => p.name)).size !== planned.length) {
      let count = 0
      for (const item of planned) { signal.throwIfAborted(); count += await one(item) }
      return count
    }
    signal.throwIfAborted()
    // An agent advertising batch approvals takes a batch of FIRST approvals in one request. Each
    // keeps its own signing, journal entry, permit and outcome (paid-approval.ts); only the send is
    // shared. Anything else (one proposal, a retained record to reconcile, a store or session
    // without durable approvals) goes one by one, as before.
    if (planned.length > 1 && session.batchApprovals === true && typeof session.sendRetainedApprovals === 'function'
      && planned.every(p => supportsDurableApproval(store, session, prefix + '-' + p.name))
      && (await Promise.all(planned.map(p => store.load(prefix + '-' + p.name)))).every(r => r === undefined)) {
      const kept = await retainAndDeliverApprovals(planned.map(({proposed, member, name}) => {
        const key = prefix + '-' + name
        const original = {stage: proposed.stage, operator_key: member.publicKey, unsigned_body: proposed.unsigned_body}
        const stage = proposed.stage === 'presentation_sign' ? 'presentation_sign' as const : 'presentation_attest' as const
        return {ctx: {store, session, key, signal}, original, sign: proposed.stage === 'credential'
          ? () => session.prepareCredentialApproval!(proposed, member, presentation!, signal)
          : () => session.prepareRequestApproval!(proposed, stage, member, signal)}
      }))
      const raced = kept.findIndex(k => !k)
      if (raced !== -1) throw new PaidSessionRecoveryError(prefix + '-' + planned[raced]!.name, 'Original paid write already attempted with an unknown or different outcome; reconcile it without redelivery')
      return planned.length
    }
    const results = await Promise.allSettled(planned.map(one))
    // Every send has settled (none is left in flight); report the first refusal in proposal order.
    for (const result of results) if (result.status === 'rejected') throw result.reason
    return results.reduce((sum, result) => sum + (result.status === 'fulfilled' ? result.value : 0), 0)
  }
  /** Approve one judged proposal; 1 when it sent or reconciled an approval, 0 when already confirmed. */
  const approveOne = async (proposed: PaidAgentProposal, member: PaidVerifierWitness, name: string, presentation?: ClientApprovedPresentation): Promise<number> => {
    const key = prefix + '-' + name
    const retained = await store.load<ApprovalJournalRecord>(key)
    // A stage belongs to one operator and one original body. A new proposal ID
    // cannot authorize another billable attempt on the same paid stage.
    const original = {stage: proposed.stage, operator_key: member.publicKey, unsigned_body: proposed.unsigned_body}
    // Durable approvals: the signed body is retained before the first send and resent only
    // byte-identically under a generation-bound, exclusively claimed permit (see paid-approval.ts).
    const durable = supportsDurableApproval(store, session, key)
    const ctx = {store, session, key, signal}
    if (retained) {
      if (!same(retained.original, original)) throw new PaidSessionRecoveryError(key, 'Agent changed an already approved operator stage')
      if (retained.phase === 'confirmed') return 0
      // A retained body may be reconciled on resume: confirmed if the agent already holds it,
      // resent identically only while the agent shows it pending under a durable permit.
      // A record without a retained body (an older SDK) or any unknown outcome still refuses.
      if (!(resume && durable && retained.phase === 'prepared' && retained.approval !== undefined)) {
        throw new PaidSessionRecoveryError(key, 'Original operator approval outcome is unknown; reconcile it')
      }
      await reconcileRetainedApproval(ctx, retained)
      return 1
    }
    if (proposed.stage === 'credential') {
      if (durable) await firstApproval(ctx, original, () => session.prepareCredentialApproval!(proposed, member, presentation!, signal))
      else await attempt(name, original, () => session.approveCredentials(proposed, member, presentation!, signal))
    } else {
      const stage = proposed.stage === 'presentation_sign' ? 'presentation_sign' : 'presentation_attest'
      if (durable) await firstApproval(ctx, original, () => session.prepareRequestApproval!(proposed, stage, member, signal))
      else await attempt(name, original, () => session.approveRequest(proposed, stage, member, signal))
    }
    return 1
  }
  const pendingConsent = (error: unknown) => error instanceof PaidAgentControlError
    && error.sessionId === session.sessionId && error.httpStatus === 425
  const checkedPoll = async (held = false) => {
    signal.throwIfAborted()
    const status = await (held ? session.poll(signal, {wait: true}) : session.poll(signal))
    if (status.status === 'failed') throw new VerifierAgentSessionError('refused', session.sessionId,
      'Original paid credential verification refused' + (status.error ? ': ' + status.error.slice(0, 500) : ''))
    return status
  }
  /**
   * Wait, when this drive has nothing to send, until the session may have moved past `last`.
   * While committee work is in flight (`verifying`) its end is a status or phase change the agent
   * announces, so one held poll waits for it (O(1) on the agent) and its answer is returned for the
   * drive to continue on at once. A held answer that came back at once unchanged (an agent without
   * long-poll support) falls back to the caller's pacing, so no agent is polled in a loop; a held
   * request that failed in transport returns nothing and the caller's next plain poll decides, as
   * before. In any other phase (waiting for a wallet callback, which the agent does not announce)
   * the caller's pacing applies unchanged. Returns the held answer, or undefined when it did not poll.
   */
  const settle = async (last: SessionStatusResult, hint?: number): Promise<SessionStatusResult | undefined> => {
    if (last.phase === 'verifying') {
      const started = Date.now()
      let next: SessionStatusResult
      try { next = await checkedPoll(true) }
      catch (error) {
        if (signal.aborted || error instanceof VerifierAgentSessionError || error instanceof PaidAgentControlError) throw error
        return undefined
      }
      if (next.status !== 'pending' || next.phase !== last.phase || Date.now() - started >= HELD_POLL_ENDED_MS) return next
    }
    await wait(hint)
    return undefined
  }
  const resumeCallback = async (callback: string, approved: ClientApprovedPresentation) => {
    try {await session.resumePresentation(callback, approved, signal)}
    catch (error) {
      if (pendingConsent(error)) return
      // Admission can reject an expired credential with 400; a failed verifier run
      // returns 409. Only the authenticated original session's terminal state proves
      // refusal. Other errors stay unresolved and never cause another POST.
      if (error instanceof PaidAgentControlError && error.sessionId === session.sessionId
        && (error.httpStatus === 400 || error.httpStatus === 409)) await checkedPoll()
      throw error
    }
  }

  let creationRecovered = false
  const created = await attempt('create', {sessionId: session.sessionId, paymentHash: session.paymentHash, initialization: session.initialization},
    () => session.create(signal), async () => {
      try {await session.reconcile(signal)}
      catch (error) {
        signal.throwIfAborted()
        // A failed read (including 404) does not prove that the original POST
        // was refused. Preserve the uncertain creation and its application fence.
        throw new Error('Original session creation cannot be verified; resume only this session', {cause: error})
      }
      creationRecovered = true
    })
  // A resumed drive recovers the original public context by an authenticated read instead.
  if (!created && !creationRecovered) await session.reconcile(signal)
  let opened: Awaited<ReturnType<RegisteredPaidAgentSession['requestObject']>>
  for (;;) {
    signal.throwIfAborted()
    try { opened = await session.requestObject(signal); break }
    catch (error) {
      if (!pendingConsent(error)) throw error
      // The status poll and the proposal listing are independent reads: read them together and
      // judge the status first, so a failed session still refuses before anything is approved.
      const [polled, listed] = await Promise.allSettled([checkedPoll(), session.proposals(signal)])
      if (polled.status === 'rejected') throw polled.reason
      if (listed.status === 'rejected') throw listed.reason
      const status = polled.value
      // Nothing listed yet from an agent that can hold the listing: ask it to answer when one is
      // pending instead of pacing locally (the same owner-only read, judged the same way).
      if (listed.value.length === 0 && session.proposalWait === true) {
        const held = await session.proposals(signal, {waitMs: MAX_PROPOSAL_WAIT_MS})
        if (await approve(undefined, held) > 0) continue
      }
      // 425 with proposals: once they are approved the next request-object fetch dispatches them
      // (and waits for the signer), so fetch again at once. Otherwise wait for the session to move.
      if (await approve(undefined, listed.value) > 0) continue
      await settle(status, (error as PaidAgentControlError).retryAfterMs)
    }
  }
  const request = opened.request
  // An optional observation completes before credential disclosure, on a detached copy.
  await options.observeRequest?.(structuredClone(request))
  signal.throwIfAborted()

  let accepted: ClientApprovedPresentation | undefined
  const link: PaidSessionRequestLink = {requestUri: opened.requestUri, qrPayload: opened.qrPayload}
  if (holder.kind === 'local') {
    await holder.present?.({request: structuredClone(request), ...link})
    const retained = await store.load<{original: {presentation: PaidWalletPresentation}; phase: string}>(prefix + '-presentation')
    if (retained !== undefined && resume) {
      // Never build or post a second presentation; continue with the original once it is confirmed.
      if (retained?.phase !== 'confirmed' || !retained.original?.presentation?.approved) throw new PaidSessionRecoveryError(prefix + '-presentation', 'Original presentation outcome is unknown; reconcile it without redelivery')
      accepted = structuredClone(retained.original.presentation.approved)
    }
  }
  if (holder.kind === 'local' && !accepted) {
    const presentation = structuredClone(await holder.makePresentation(structuredClone(request), {...link}))
    // Validate canonical plain JSON before persisting or disclosing credentials.
    executionBodyHash(presentation.approved as unknown as Record<string, unknown>)
    const keys = Object.keys(presentation.approved).sort()
    if (keys.join(',') !== 'credentials,holder,holder_proof,iat,oauth' || presentation.approved.oauth !== null
      || !presentation.approved.credentials.length || !presentation.form.response) throw new Error('Paid wallet requires the original encrypted credential presentation')
    await attempt('presentation', {request: request.claims, presentation}, () => holder.submit(request, presentation))
    accepted = presentation.approved
  } else if (holder.kind === 'external') {
    // Showing the request is not billable; a resumed drive shows it again.
    await holder.present(structuredClone(opened))
    const retained = await store.load<{original: {presentation?: ClientApprovedPresentation}; phase: string}>(prefix + '-accepted')
    if (retained) {
      if (retained.phase !== 'confirmed' || !retained.original.presentation) throw new PaidSessionRecoveryError(prefix + '-accepted', 'Original presentation acceptance is unknown; reconcile it')
      accepted = retained.original.presentation
    }
  }

  let callback: string | undefined
  let approvedCredentialCount = 0
  // The session status and the retained presentations are independent reads: each round reads them
  // together and judges the status first (a done or failed session ends the drive before any write).
  const observe = async (polled?: SessionStatusResult) => {
    const [status, candidates] = await Promise.allSettled([polled ?? checkedPoll(), session.presentations(signal)])
    if (status.status === 'rejected') throw status.reason
    return {status: status.value, candidates}
  }
  let observed = await observe()
  for (;;) {
    signal.throwIfAborted()
    const status = observed.status
    if (status.status === 'done') return status
    // Whether this round sent a write: its effect is read back at once instead of after a wait.
    let progressed = false
    if (observed.candidates.status === 'rejected') throw observed.candidates.reason
    const retainedCandidates = observed.candidates.value
    for (const candidate of retainedCandidates) {
      if (!accepted) {
        // External wallet: the client decides on the complete retained body, once.
        if (!await (holder as Extract<PaidSessionHolder, {kind: 'external'}>).accept(structuredClone(candidate), structuredClone(request))) {
          throw new VerifierAgentSessionError('refused', session.sessionId, 'Client refused the retained wallet presentation')
        }
        const chosen = structuredClone(candidate.presentation)
        await attempt('accepted', {presentation: chosen, callback: candidate.id}, async () => {})
        accepted = chosen
      }
      if (!same(candidate.presentation, accepted)) throw new Error('Agent callback changed the original client presentation')
      if (callback && callback !== candidate.id) throw new Error('Agent changed the original retained callback')
      callback = candidate.id
    }
    if (callback && accepted) {
      const approved = accepted
      const initial = await store.load<{phase: string}>(prefix + '-resume-initial')
      if (!initial) {
        // HTTP 425 is an explicit refusal to dispatch without client approval. It creates
        // credential proposals; unknown transport outcomes still stop here.
        progressed = await attempt('resume-initial', {callback, approved}, () => resumeCallback(callback!, approved))
      } else if (initial.phase !== 'confirmed') throw new PaidSessionRecoveryError(prefix + '-resume-initial', 'Original continuation outcome is unknown; reconcile it')
      const approvals = await approve(approved)
      if (approvals > 0) {
        approvedCredentialCount += approvals
        await attempt('resume-' + approvedCredentialCount, {callback, approved}, () => resumeCallback(callback!, approved))
        progressed = true
      }
    }
    // Each write is sent once, so `progressed` is true a bounded number of times.
    observed = await observe(progressed ? undefined : await settle(status))
  }
}
