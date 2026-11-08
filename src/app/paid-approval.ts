// Durable, generation-bound resend authority for ONE retained paid operator approval.
//
// The agent's per-client limiter answers 429 BEFORE any handler runs, and its handlers answer
// 429/503 before changing delivery state, so a busy refusal of an approval POST means it was not
// processed. Clients behind one egress address share that limiter: a burst of distinct paid users
// sees 429 after their TASRA is reserved. Turning that into a dead end loses a paid request, but a
// blind resend could approve twice or after an unknown outcome. The rules (mirroring `tasra-cli`):
//
// - The approval is signed ONCE, and its exact request body is retained in the application store
//   BEFORE the first send. Every send, in this or any later process, sends those bytes; nothing is
//   ever re-signed.
// - `<entry>.attempt` holds `permit` | `in_flight` with a generation g (schema 2). Every send of g,
//   the first included, must (1) win the exclusive claim record `<entry>.claim.<g>` (the store's
//   atomic insert-if-absent), (2) re-read the ledger and still find `permit(g)`, (3) durably write
//   `in_flight(g)`. A lost claim or a moved generation sends nothing.
// - Only the holder of g, on a 429/503 answer to THAT send and with the ledger still `in_flight(g)`,
//   writes `permit(g+1)`; after its wait it must claim exactly g+1 again.
// - A transport error, timeout, abort, crash or any other answer leaves `in_flight(g)`: unresolved,
//   reconciled by reading the delivery state, never by resending. No ledger, a ledger of another
//   schema, or a record without a retained body (written by an older SDK) is never resent.
// - A 409 that follows a busy refusal is resolved by reading the delivery state.

import {PaidApprovalUnresolvedError, type PaidApprovalUnresolvedReason} from '../errors.js'
import {PaidAgentControlError, type RegisteredPaidAgentSession, type RetainedPaidApproval} from '../chain/registeredPaidAgent.js'
import {PaidBackoff} from '../chain/paidPacing.js'
import type {ApplicationStore} from './ready-slot.js'

/** Ledger format carrying a generation. Anything else is legacy and never resent. */
export const APPROVAL_LEDGER_SCHEMA = 2
/** Generation of a new approval's first send. */
export const FIRST_APPROVAL_GENERATION = 1
/** Generations are bounded so a claim key always fits the store's key grammar. */
const MAX_GENERATION = 1_000_000
const ROUTE = 'POST /v1/sessions/{id}/execution/{delivery}/approve'
const KEY = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/

/** Journal entry of one paid operator approval. */
export interface ApprovalJournalRecord {
  /** The stage's original identity (stage, operator key, unsigned body). */
  original: unknown
  /** `prepared` before the first send, `confirmed` once the agent accepted it. */
  phase: 'prepared' | 'confirmed'
  /** The retained signed request body; absent on records written by older SDK versions. */
  approval?: RetainedPaidApproval & {schema: 2}
}

/** One generation-bound permit state. */
export type ApprovalLedgerState = {state: 'permit' | 'in_flight'; generation: number} | {state: 'legacy'}

/** What a durable approval needs: the store (with `claim`), the session, the journal entry and cancellation. */
export interface DurableApprovalContext {
  /** Application store; must implement `claim`. */
  store: ApplicationStore
  /** Prepared session with the retained-approval methods. */
  session: RegisteredPaidAgentSession
  /** Journal entry key of this approval stage. */
  key: string
  /** Cancellation; an abort during a send leaves that generation unresolved. */
  signal: AbortSignal
}

/** Ledger entry beside the approval's journal entry. */
export const approvalLedgerKey = (key: string) => key + '.attempt'
/** Exclusive claim record of generation `generation`. */
export const approvalClaimKey = (key: string, generation: number) => key + '.claim.' + generation

/**
 * Whether this store and session support durable approval resends for journal entry `key`: the store
 * has an atomic `claim`, the session can sign without sending and send retained bytes, and every
 * derived key fits the store's key grammar. Otherwise approvals are sent once and never resent.
 */
export function supportsDurableApproval(store: ApplicationStore, session: RegisteredPaidAgentSession, key: string): boolean {
  return typeof store.claim === 'function' && session.pacing !== undefined && typeof session.prepareRequestApproval === 'function'
    && typeof session.prepareCredentialApproval === 'function' && typeof session.sendRetainedApproval === 'function'
    && typeof session.approvalState === 'function' && KEY.test(approvalLedgerKey(key)) && KEY.test(approvalClaimKey(key, MAX_GENERATION))
}

const unresolved = (ctx: DurableApprovalContext, reason: PaidApprovalUnresolvedReason, proposalId?: string, generation?: number, cause?: unknown) =>
  new PaidApprovalUnresolvedError({reason, key: ctx.key, ...(proposalId !== undefined ? {proposalId} : {}), ...(generation !== undefined ? {generation} : {}),
    ...(cause !== undefined ? {cause} : {})})

/**
 * The recorded permit state, or undefined when no ledger was ever written.
 * @param store Application store.
 * @param key Journal entry key.
 * @param proposalId Delivery the ledger must belong to.
 */
export async function readApprovalLedger(store: ApplicationStore, key: string, proposalId: string): Promise<ApprovalLedgerState | undefined> {
  const value = await store.load<Record<string, unknown>>(approvalLedgerKey(key))
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || value.schema !== APPROVAL_LEDGER_SCHEMA || value.proposalId !== proposalId
    || (value.state !== 'permit' && value.state !== 'in_flight') || !Number.isSafeInteger(value.generation)
    || (value.generation as number) < FIRST_APPROVAL_GENERATION || (value.generation as number) > MAX_GENERATION) return {state: 'legacy'}
  return {state: value.state, generation: value.generation as number}
}

async function writeLedger(store: ApplicationStore, key: string, proposalId: string, state: 'permit' | 'in_flight', generation: number): Promise<void> {
  await store.save(approvalLedgerKey(key), {schema: APPROVAL_LEDGER_SCHEMA, proposalId, state, generation})
}

/**
 * The only way to start a send of `generation`: win its exclusive claim, confirm the ledger still
 * reads `permit(generation)`, then durably mark `in_flight(generation)`. A lost claim or a moved
 * generation sends nothing and is unresolved.
 * @param ctx Durable approval context.
 * @param proposalId Delivery identity.
 * @param generation Generation to send.
 */
export async function beginApprovalSend(ctx: DurableApprovalContext, proposalId: string, generation: number): Promise<void> {
  if (!Number.isSafeInteger(generation) || generation < FIRST_APPROVAL_GENERATION || generation > MAX_GENERATION) throw unresolved(ctx, 'generation_moved', proposalId, generation)
  if (!await ctx.store.claim!(approvalClaimKey(ctx.key, generation))) throw unresolved(ctx, 'claim_lost', proposalId, generation)
  const ledger = await readApprovalLedger(ctx.store, ctx.key, proposalId)
  if (ledger?.state !== 'permit' || ledger.generation !== generation) throw unresolved(ctx, 'generation_moved', proposalId, generation)
  await writeLedger(ctx.store, ctx.key, proposalId, 'in_flight', generation)
}

/** A 429/503 answered the send of `generation`: only while the ledger still reads `in_flight(generation)` is `permit(generation+1)` written. */
async function releaseBusy(ctx: DurableApprovalContext, proposalId: string, generation: number): Promise<number> {
  const ledger = await readApprovalLedger(ctx.store, ctx.key, proposalId)
  if (ledger?.state !== 'in_flight' || ledger.generation !== generation || generation >= MAX_GENERATION) throw unresolved(ctx, 'generation_moved', proposalId, generation)
  await writeLedger(ctx.store, ctx.key, proposalId, 'permit', generation + 1)
  return generation + 1
}

const accepted = (state: string) => state === 'approved' || state === 'dispatched' || state === 'finished'

async function confirm(ctx: DurableApprovalContext): Promise<void> {
  const record = await ctx.store.load<ApprovalJournalRecord>(ctx.key)
  await ctx.store.save(ctx.key, {original: record?.original, phase: 'confirmed'})
}

/** The retained approval of a journal record, or undefined for a record without one (older SDK). */
function retainedOf(record: ApprovalJournalRecord | undefined): RetainedPaidApproval | undefined {
  const a = record?.approval
  if (!a || typeof a !== 'object' || a.schema !== APPROVAL_LEDGER_SCHEMA) return undefined
  return {proposalId: a.proposalId, body: a.body, expires: a.expires}
}

/**
 * Sends the retained approval under the ledger's permit for `generation`, which the caller read.
 * Before EVERY send the deadline (the approval's signed expiry) is re-read and the permit is
 * exclusively claimed and consumed; only a 429/503 answer restores the next one, after which the
 * SAME bytes may be sent again inside the deadline. Throws `PaidBackoffError` when waiting stops
 * (the permit for the next generation stays durable for a later resume).
 * @param ctx Durable approval context.
 * @param approval The retained approval, as loaded from the store.
 * @param generation Generation the ledger permits.
 */
export async function deliverRetainedApproval(ctx: DurableApprovalContext, approval: RetainedPaidApproval, generation: number): Promise<void> {
  const {session, signal} = ctx, pacing = session.pacing!
  const backoff = new PaidBackoff(pacing.clock, ROUTE, approval.expires * 1000, pacing.attemptBudgetMs)
  let current = generation
  for (;;) {
    signal.throwIfAborted()
    // Not sent yet: a refusal here leaves the permit in place.
    backoff.readyToSend()
    await beginApprovalSend(ctx, approval.proposalId, current)
    let reply
    try { reply = await session.sendRetainedApproval!(approval, signal) }
    catch (cause) {
      if (cause instanceof PaidAgentControlError) {
        // An earlier busy attempt may have been accepted since: read, never assume.
        if (cause.httpStatus === 409 && backoff.retries > 0) {
          if (accepted(await session.approvalState!(approval.proposalId, signal))) { await confirm(ctx); return }
          throw unresolved(ctx, 'conflict', approval.proposalId, current, cause)
        }
        // A decided answer: `in_flight` stays, never resent.
        throw cause
      }
      throw unresolved(ctx, 'outcome_unknown', approval.proposalId, current, cause)
    }
    if (reply.status === 'accepted') { await confirm(ctx); return }
    // THIS send was definitely refused before processing: permit the NEXT generation, which this
    // caller must again claim exclusively after its wait.
    current = await releaseBusy(ctx, approval.proposalId, current)
    await backoff.wait(reply.httpStatus ?? 429, reply.hintMs, signal)
  }
}

/**
 * First approval of a stage: signs ONCE, retains the record and its exact body, durably grants ONE
 * permit (nothing has been sent), then delivers the body loaded back from the store under that
 * permit. Returns false, sending nothing, when a record already exists.
 * @param ctx Durable approval context.
 * @param original The stage's original identity.
 * @param sign Signs the approval without sending it.
 */
export async function retainAndDeliverApproval(ctx: DurableApprovalContext, original: unknown, sign: () => Promise<RetainedPaidApproval>): Promise<boolean> {
  const approval = await sign()
  ctx.signal.throwIfAborted()
  const retained = await ctx.store.withLock(ctx.key, async () => {
    if (await ctx.store.load(ctx.key) !== undefined) return false
    await ctx.store.save(ctx.key, {original, phase: 'prepared', approval: {schema: APPROVAL_LEDGER_SCHEMA, ...approval}} satisfies ApprovalJournalRecord)
    // A crash before this write leaves a record without a ledger: unresolved, never sent.
    await writeLedger(ctx.store, ctx.key, approval.proposalId, 'permit', FIRST_APPROVAL_GENERATION)
    return true
  })
  if (!retained) return false
  // The bytes come from the record just retained, exactly as any later resend's do.
  const kept = retainedOf(await ctx.store.load<ApprovalJournalRecord>(ctx.key))
  if (!kept) throw unresolved(ctx, 'no_permit', approval.proposalId)
  await deliverRetainedApproval(ctx, kept, FIRST_APPROVAL_GENERATION)
  return true
}

/**
 * Reconciles a retained, unconfirmed approval: reads its delivery state and resends the identical
 * retained body only when BOTH hold: the agent still shows it `pending`, and the ledger holds a
 * `permit` (nothing in flight; the last send, if any, was answered busy). Accepted consent is
 * confirmed, never resent; anything else is unresolved.
 * @param ctx Durable approval context.
 * @param record The stage's journal record.
 * @returns `accepted` when the agent already held it, `resent` when the identical body was accepted now.
 */
export async function reconcileRetainedApproval(ctx: DurableApprovalContext, record: ApprovalJournalRecord): Promise<'accepted' | 'resent'> {
  const approval = retainedOf(record)
  if (!approval) throw unresolved(ctx, 'legacy_state')
  const state = await ctx.session.approvalState!(approval.proposalId, ctx.signal)
  if (accepted(state)) { await confirm(ctx); return 'accepted' }
  const ledger = await readApprovalLedger(ctx.store, ctx.key, approval.proposalId)
  if (state !== 'pending' || ledger?.state !== 'permit') {
    const reason = ledger?.state === 'legacy' ? 'legacy_state' : ledger?.state === 'in_flight' ? 'outcome_unknown' : 'no_permit'
    throw unresolved(ctx, reason, approval.proposalId, ledger && ledger.state !== 'legacy' ? ledger.generation : undefined)
  }
  await deliverRetainedApproval(ctx, approval, ledger.generation)
  return 'resent'
}

const BATCH_ROUTE = 'POST /v1/sessions/{id}/execution/approve'

/** One first approval of a batch: its own journal entry, original identity and one-time signer. */
export interface BatchedApproval {
  /** Durable approval context of this entry (its own journal key). */
  ctx: DurableApprovalContext
  /** The stage's original identity. */
  original: unknown
  /** Signs this approval without sending it. */
  sign: () => Promise<RetainedPaidApproval>
}

/**
 * First approvals of several stages in ONE agent request (agents advertising batch approvals).
 * Each entry is handled exactly as {@link retainAndDeliverApproval} handles one: signed once, its
 * record and exact body retained under its own key with one permit, then its permit claimed and
 * marked in flight; only the send is shared. Per entry: 204 confirms; 409 is resolved by reading
 * the delivery state (accepted confirms, anything else is unresolved); 404/410/422 are decided
 * refusals (in flight stays, never resent); a transport failure or malformed reply leaves every
 * entry in flight, unresolved. A busy refusal of the whole request permits each entry's next
 * generation, and after one wait each continues alone through the single-approval route.
 * Resolves, once every entry has settled, to whether each entry was retained (false: a record
 * already existed and nothing was sent for it); rejects with the first entry's error in order.
 * @param items Entries in proposal order; distinct journal keys.
 */
export async function retainAndDeliverApprovals(items: readonly BatchedApproval[]): Promise<boolean[]> {
  if (items.length === 0) return []
  const session = items[0]!.ctx.session, signal = items[0]!.ctx.signal
  if (new Set(items.map(i => i.ctx.key)).size !== items.length || items.some(i => i.ctx.session !== session)) throw new Error('Invalid approval batch')
  // Signed before anything is retained: a signing failure retains and sends nothing.
  const approvals = await Promise.all(items.map(i => i.sign()))
  signal.throwIfAborted()
  const pacing = session.pacing!
  const backoff = new PaidBackoff(pacing.clock, BATCH_ROUTE, Math.min(...approvals.map(a => a.expires)) * 1000, pacing.attemptBudgetMs)
  // Not sent yet: a refusal here retains and sends nothing.
  backoff.readyToSend()
  const outcome: ({ok: true; value: boolean} | {ok: false; error: unknown})[] = items.map(() => ({ok: true, value: false}))
  const live: {index: number; approval: RetainedPaidApproval}[] = []
  await Promise.all(items.map(async (item, index) => {
    const approval = approvals[index]!
    try {
      const retained = await item.ctx.store.withLock(item.ctx.key, async () => {
        if (await item.ctx.store.load(item.ctx.key) !== undefined) return false
        await item.ctx.store.save(item.ctx.key, {original: item.original, phase: 'prepared', approval: {schema: APPROVAL_LEDGER_SCHEMA, ...approval}} satisfies ApprovalJournalRecord)
        await writeLedger(item.ctx.store, item.ctx.key, approval.proposalId, 'permit', FIRST_APPROVAL_GENERATION)
        return true
      })
      if (!retained) return
      outcome[index] = {ok: true, value: true}
      const kept = retainedOf(await item.ctx.store.load<ApprovalJournalRecord>(item.ctx.key))
      if (!kept) throw unresolved(item.ctx, 'no_permit', approval.proposalId)
      await beginApprovalSend(item.ctx, kept.proposalId, FIRST_APPROVAL_GENERATION)
      live.push({index, approval: kept})
    } catch (error) { outcome[index] = {ok: false, error} }
  }))
  live.sort((a, b) => a.index - b.index)
  if (live.length > 0) {
    let reply: Awaited<ReturnType<NonNullable<RegisteredPaidAgentSession['sendRetainedApprovals']>>> | undefined, failure: unknown
    try { reply = await session.sendRetainedApprovals!(live.map(l => l.approval), signal) } catch (cause) { failure = cause }
    if (reply === undefined) {
      // Unknown outcome for every entry of the request: in flight stays, nothing is resent.
      for (const l of live) outcome[l.index] = {ok: false, error: unresolved(items[l.index]!.ctx, 'outcome_unknown', l.approval.proposalId, FIRST_APPROVAL_GENERATION, failure)}
    } else if (reply.kind === 'busy') {
      // Refused before processing: each entry's next generation is permitted; after the wait each
      // continues alone under the single route's permit rules.
      const next = await Promise.all(live.map(l => releaseBusy(items[l.index]!.ctx, l.approval.proposalId, FIRST_APPROVAL_GENERATION).then(g => ({g}), (error: unknown) => ({error}))))
      let waited: unknown
      try { await backoff.wait(reply.httpStatus, reply.hintMs, signal) } catch (error) { waited = error }
      await Promise.all(live.map(async (l, i) => {
        const n = next[i]!
        if ('error' in n) { outcome[l.index] = {ok: false, error: n.error}; return }
        if (waited !== undefined) { outcome[l.index] = {ok: false, error: waited}; return }
        try { await deliverRetainedApproval(items[l.index]!.ctx, l.approval, n.g) } catch (error) { outcome[l.index] = {ok: false, error} }
      }))
    } else {
      await Promise.all(live.map(async l => {
        const ctx = items[l.index]!.ctx, status = reply.results.get(l.approval.proposalId)
        try {
          if (status === 204) await confirm(ctx)
          else if (status === 409) {
            // Already decided: read it, never assume.
            if (accepted(await session.approvalState!(l.approval.proposalId, signal))) await confirm(ctx)
            else throw unresolved(ctx, 'conflict', l.approval.proposalId, FIRST_APPROVAL_GENERATION, new PaidAgentControlError(session.sessionId, 409))
          } else throw new PaidAgentControlError(session.sessionId, status ?? 0)
        } catch (error) { outcome[l.index] = {ok: false, error} }
      }))
    }
  }
  for (const o of outcome) if (!o.ok) throw o.error
  return outcome.map(o => (o as {value: boolean}).value)
}
