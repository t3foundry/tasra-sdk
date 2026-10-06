// Native SDK wallet control. Every mutation is retained before sending; an
// uncertain write is never repeated. Services supply proposals, not client intent.
import assert from 'node:assert/strict'
import {executionBodyHash} from '../../src/committee/execution.ts'
import {PaidAgentControlError, type ClientApprovedPresentation, type RegisteredPaidAgentSession} from '../../src/chain/registeredPaidAgent.ts'
import type {PaidVerifierWitness} from '../../src/chain/prepaid.ts'
import type {ApplicationStore} from '../../src/app/node.ts'
import type {VerifiedRequestObject} from '../../src/oid4vp/request-object.ts'
import type {SessionStatusResult} from '../../src/verifier-agent/index.ts'
import {VerifierAgentSessionError} from '../../src/verifier-agent/index.ts'

export interface PaidWalletPresentation {
  approved: ClientApprovedPresentation
  form: Record<string, string>
}
export interface PaidWalletDriverOptions {
  session: RegisteredPaidAgentSession
  members: readonly PaidVerifierWitness[]
  store: ApplicationStore
  signal: AbortSignal
  makePresentation(request: VerifiedRequestObject): PaidWalletPresentation
  submit(request: VerifiedRequestObject, presentation: PaidWalletPresentation): Promise<void>
  wait(): Promise<void>
}

export async function drivePaidWalletSession(options: PaidWalletDriverOptions): Promise<SessionStatusResult> {
  const {session, store, signal, wait} = options
  const members = structuredClone([...options.members]), prefix = `wallet-${session.sessionId}`
  assert(/^[0-9a-f]{64}$/.test(session.sessionId), 'Invalid original SDK session')
  assert(members.length && new Set(members.map(m => m.publicKey.toLowerCase())).size === members.length,
    'Original drawn witnesses must be distinct')
  const attempt = async (name: string, original: unknown, work: () => Promise<void>) => {
    signal.throwIfAborted()
    const key = prefix + '-' + name
    return store.withLock(key, async () => {
      assert.equal(await store.load(key), undefined, 'Original paid write already attempted; reconcile it without redelivery')
      await store.save(key, {original, phase: 'prepared'})
      // A crash or uncertain response retains prepared. No catch/retry deletes it.
      signal.throwIfAborted()
      await work()
      await store.save(key, {original, phase: 'confirmed'})
    })
  }
  const approve = async (presentation?: ClientApprovedPresentation) => {
    let count = 0
    for (const proposed of await session.proposals(signal)) {
      signal.throwIfAborted()
      const member = members.find(m => m.publicKey.toLowerCase() === proposed.operator_key.toLowerCase())
      assert(member, 'Agent proposed an operator outside the original anchored draw')
      assert(['presentation_sign', 'presentation_attest', 'credential'].includes(proposed.stage), 'Invalid agent operator stage')
      const name = proposed.stage + '-' + member.index, key = prefix + '-' + name
      const retained = await store.load<{original: unknown; phase: string}>(key)
      // A stage belongs to one operator and one original body. A new proposal ID
      // cannot authorize another billable attempt on the same paid stage.
      const original = {stage: proposed.stage, operator_key: member.publicKey, unsigned_body: proposed.unsigned_body}
      if (retained) {
        assert.deepEqual(retained.original, original, 'Agent changed an already approved operator stage')
        assert.equal(retained.phase, 'confirmed', 'Original operator approval outcome is unknown; reconcile it')
        continue
      }
      if (proposed.stage === 'credential') {
        assert(presentation, 'Credential work requires the original locally accepted presentation')
        await attempt(name, original, () => session.approveCredentials(proposed, member, presentation, signal))
      } else {
        assert(!presentation, 'Unexpected new request-signing stage after credential disclosure')
        await attempt(name, original, () => session.approveRequest(proposed,
          proposed.stage === 'presentation_sign' ? 'presentation_sign' : 'presentation_attest', member, signal))
      }
      count++
    }
    return count
  }
  const pendingConsent = (error: unknown) => error instanceof PaidAgentControlError
    && error.sessionId === session.sessionId && error.httpStatus === 425
  const checkedPoll = async () => {
    signal.throwIfAborted()
    const status = await session.poll(signal)
    if (status.status === 'failed') throw new VerifierAgentSessionError('refused', session.sessionId, 'Original paid credential verification refused')
    return status
  }
  const resume = async (callback: string, approved: ClientApprovedPresentation) => {
    try {await session.resumePresentation(callback, approved, signal)}
    catch (error) {
      if (pendingConsent(error)) return
      // A failed verifier run makes continuation return409. Confirm the original
      // terminal status before classifying it as credential refusal; a busy or
      // unknown409 remains an error and never causes another POST.
      if (error instanceof PaidAgentControlError && error.sessionId === session.sessionId && error.httpStatus === 409) await checkedPoll()
      throw error
    }
  }
  await attempt('create', {sessionId: session.sessionId, paymentHash: session.paymentHash, initialization: session.initialization},
    () => session.create(signal))
  let request: VerifiedRequestObject
  for (;;) {
    signal.throwIfAborted()
    try { request = (await session.requestObject(signal)).request; break }
    catch (error) {
      if (!pendingConsent(error)) throw error
      await checkedPoll()
      await approve()
      await wait()
    }
  }
  const presentation = structuredClone(options.makePresentation(request))
  // Validate canonical plain JSON before persisting or disclosing credentials.
  executionBodyHash(presentation.approved as unknown as Record<string, unknown>)
  assert.deepEqual(Object.keys(presentation.approved).sort(), ['credentials', 'holder', 'holder_proof', 'iat', 'oauth'])
  assert(presentation.approved.oauth === null && presentation.approved.credentials.length > 0 && presentation.form.response,
    'Paid wallet requires the original encrypted credential presentation')
  await attempt('presentation', {request: request.claims, presentation}, () => options.submit(request, presentation))
  let callback: string | undefined
  let approvedCredentialCount = 0
  for (;;) {
    signal.throwIfAborted()
    const status = await checkedPoll()
    if (status.status === 'done') return status
    const retained = await session.presentations(signal)
    for (const candidate of retained) {
      assert.deepEqual(candidate.presentation, presentation.approved, 'Agent callback changed the original client presentation')
      assert(!callback || callback === candidate.id, 'Agent changed the original retained callback')
      callback = candidate.id
    }
    if (callback) {
      const resumed = await store.load<{phase: string}>(prefix + '-resume-initial')
      if (!resumed) {
        // HTTP425 is an explicit refusal to dispatch without client approval. It
        // creates credential proposals; unknown transport outcomes still stop here.
        await attempt('resume-initial', {callback, approved: presentation.approved}, async () => {
          await resume(callback!, presentation.approved)
        })
      } else assert.equal(resumed.phase, 'confirmed', 'Original continuation outcome is unknown; reconcile it')
      const approvals = await approve(presentation.approved)
      if (approvals > 0) {
        approvedCredentialCount += approvals
        const key = 'resume-' + approvedCredentialCount
        await attempt(key, {callback, approved: presentation.approved}, async () => {
          await resume(callback!, presentation.approved)
        })
      }
    }
    await wait()
  }
}
