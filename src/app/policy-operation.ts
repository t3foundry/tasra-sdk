// One holder-application operation per operation key, started from a slot policy bootstrap.
//
// The key's binding (the exact operation it names and the request IDs derived for it) is saved
// before anything is signed, and every request ID before its witnesses are fetched, so before the
// operation's own journal and long before any reservation. A later call with the same key never
// starts a second operation: it resumes the journaled original, refuses a different operation,
// and refuses a closed or never-journaled original unless the application explicitly restarts the
// latter once nothing of it can still be reserved.

import type {Address, Hex} from 'viem'
import {paidOperation, paidOperationPhase, resumePaidOperation, type PaidOperation, type PaidOperationConfig, type PaidOperationRequest} from './paid-operation.js'
import {exclusivelyRunning, policyOperationFingerprint, policyOperationKey, slotPolicyHash, validBinding, verifySlotPolicyBootstrap, PolicyOperationError,
  POLICY_OPERATION_MAX_ATTEMPTS, POLICY_SKEW_SECS, type PolicyOperationBinding, type SlotPolicyBootstrap} from './policy-bootstrap.js'
import {TasraError} from '../errors.js'

/** One holder-application operation started from a slot policy bootstrap. */
export interface PaidPolicyOperationRequest extends Omit<PaidOperationRequest, 'rule'> {
  /** Creator-signed slot policy bootstrap issued to this application. Used only when the key starts an operation. */
  policy: SlotPolicyBootstrap
  /** This holder application's key, the bootstrap's audience. */
  audience: Address
  /**
   * Application-chosen idempotency key, 1..128 characters of `A-Z a-z 0-9 . _ : -`, unique per
   * intended operation. A second call with it resumes the original operation, never a new one.
   */
  operationKey: string
  /**
   * Start again an original that never reached its journal (nothing of it was reserved): only
   * when no request was derived for it, or its payment window has passed. Default false.
   */
  restartUnjournaled?: boolean
}

const now = () => Math.floor(Date.now() / 1000)

/**
 * Run or resume one paid operation for a holder application that holds a slot policy bootstrap
 * instead of the rule salt. The first call with an operation key binds the key to this exact
 * operation in the durable store before anything is signed, then runs paidOperation with the
 * bootstrap. A later call with the same key, after a lost response, a crash or an uncertain step,
 * resumes the journaled original with resumePaidOperation (a fresher bootstrap is not needed and
 * not used), so a changed policy, an expired grant or an unknown keeper outcome never starts a
 * replacement. A key bound to another operation, a closed original and an original that never
 * reached its journal are refused with {@link PolicyOperationError}.
 * @param config Approved deployment, creator signer, gas payer, store, agent, accountants and limits.
 * @param request Slot, operation, bootstrap, application key, operation key and holder strategy.
 */
export async function paidPolicyOperation(config: PaidOperationConfig, request: PaidPolicyOperationRequest): Promise<PaidOperation> {
  const {policy, audience, operationKey, restartUnjournaled, ...rest} = request
  const d = config.deployment, store = config.store
  const target = {chainId: d.chainId, keyRegistry: d.keyRegistry, slot: request.slot, audience}
  const key = policyOperationKey(target, operationKey)
  const fingerprint = policyOperationFingerprint({...target, operation: request.operation, holderKind: request.holder?.kind ?? '', sessionGrant: request.sessionGrant !== undefined})
  return exclusivelyRunning(store, key, async () => {
    const decision = await store.withLock(key, async (): Promise<{resume: Hex} | {start: number}> => {
      const bound = await store.load<PolicyOperationBinding>(key)
      if (bound === undefined) {
        // Checked before the key is bound, so a refused bootstrap leaves nothing behind.
        const {bootstrap} = await verifySlotPolicyBootstrap(policy, {...target, action: request.operation.action, signer: config.creator.address})
        await store.save(key, {schema: 1, fingerprint, policy: slotPolicyHash(bootstrap.statement), generation: 1, createdAt: now(), attempts: []} satisfies PolicyOperationBinding)
        return {start: 1}
      }
      if (!validBinding(bound)) throw new TasraError('Invalid policy operation binding')
      if (bound.fingerprint !== fingerprint) throw new PolicyOperationError('key-reused', 'This operation key is bound to a different operation')
      const last = bound.attempts.at(-1)
      if (last) {
        const phase = await paidOperationPhase(store, last.requestId)
        if (phase === 'failed' || phase === 'abandoned') {
          throw new PolicyOperationError('closed', `The original operation is ${phase}; it is never replaced under the same key`, {requestId: last.requestId})
        }
        if (phase !== undefined) return {resume: last.requestId}
        // Derived but never journaled: it may still be on its way to its journal and reservation
        // until its payment window closes.
        if (!restartUnjournaled) throw new PolicyOperationError('unjournaled', 'The original operation never reached its journal; restart it explicitly', {requestId: last.requestId})
        if (now() <= last.notAfter) throw new PolicyOperationError('in-flight', 'The original operation may still be journaled and reserved until its payment window closes', {requestId: last.requestId, retryable: true})
      } else if (!restartUnjournaled) {
        throw new PolicyOperationError('unjournaled', 'The original operation derived no request; restart it explicitly')
      }
      const {bootstrap} = await verifySlotPolicyBootstrap(policy, {...target, action: request.operation.action, signer: config.creator.address})
      const next: PolicyOperationBinding = {...bound, policy: slotPolicyHash(bootstrap.statement), generation: bound.generation + 1}
      await store.save(key, next)
      return {start: next.generation}
    })
    if ('resume' in decision) {
      return resumePaidOperation(config, decision.resume, {holder: request.holder, signal: request.signal, observeRequest: request.observeRequest})
    }
    const generation = decision.start, ttl = request.operation.ttlSecs ?? 600
    const onRequestId = async (requestId: Hex) => {
      await store.withLock(key, async () => {
        const bound = await store.load<PolicyOperationBinding>(key)
        if (!validBinding(bound) || bound.fingerprint !== fingerprint || bound.generation !== generation) {
          throw new PolicyOperationError('superseded', 'A later call with this operation key took over; this one stopped before any reservation')
        }
        if (bound.attempts.length >= POLICY_OPERATION_MAX_ATTEMPTS) throw new TasraError('Too many attempts recorded for this operation key')
        // The intent was signed with an expiry of at most now + ttl; past that it can never be reserved.
        await store.save(key, {...bound, attempts: [...bound.attempts, {generation, requestId: requestId.toLowerCase() as Hex, notAfter: now() + ttl + POLICY_SKEW_SECS}]} satisfies PolicyOperationBinding)
      })
      await request.onRequestId?.(requestId)
    }
    return paidOperation(config, {...rest, rule: {policy, audience}, onRequestId})
  })
}

/**
 * Read the binding of one operation key: the operation it names and the request IDs derived for
 * it (the last one is the operation). Undefined when the key was never used.
 * @param config The configuration the operation runs with.
 * @param request Slot, application key and operation key.
 */
export async function readPolicyOperation(config: Pick<PaidOperationConfig, 'deployment' | 'store'>,
  request: {slot: Hex; audience: Address; operationKey: string}): Promise<{requestIds: Hex[]; generation: number} | undefined> {
  const key = policyOperationKey({chainId: config.deployment.chainId, keyRegistry: config.deployment.keyRegistry, slot: request.slot, audience: request.audience}, request.operationKey)
  const bound = await config.store.load<PolicyOperationBinding>(key)
  if (bound === undefined) return undefined
  if (!validBinding(bound)) throw new TasraError('Invalid policy operation binding')
  return {requestIds: bound.attempts.map(a => a.requestId), generation: bound.generation}
}
