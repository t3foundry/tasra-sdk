import {expect, it} from 'vitest'
import {PaidOperationRecoveryError} from '../../src/app/paid-operation.ts'
import {VerifierAgentSessionError} from '../../src/verifier-agent/index.ts'
import {isPaidCredentialRefusal} from '../fleet/_credential-refusal.ts'

const requestId = `0x${'ab'.repeat(32)}` as const
const refused = new VerifierAgentSessionError('refused', 'original-session', 'credential refused')
it('recognizes the terminal paid credential refusal observed on the live fleet', () => {
  expect(isPaidCredentialRefusal(new PaidOperationRecoveryError(requestId, 'session', refused,
    {code: 'session-refused', resumable: false}))).toBe(true)
})
it.each([
  ['direct legacy error', refused],
  ['transport interruption', new PaidOperationRecoveryError(requestId, 'session',
    new VerifierAgentSessionError('unavailable', 'original-session', 'transport lost', 502))],
  ['protocol refusal', new PaidOperationRecoveryError(requestId, 'session',
    new VerifierAgentSessionError('protocol', 'original-session', 'wrong endpoint', 403), {code: 'session-refused'})],
  ['unrelated failure', new Error('refused')],
  ['wrong phase', new PaidOperationRecoveryError(requestId, 'execution', refused, {code: 'session-refused'})],
  ['uncertain write', new PaidOperationRecoveryError(requestId, 'session', refused, {code: 'session-write-uncertain'})],
  ['resumable session', new PaidOperationRecoveryError(requestId, 'session', refused, {code: 'session-refused', resumable: true})],
  ['lookalike error', {phase: 'session', code: 'session-refused', resumable: false, cause: refused}],
])('does not count %s as verifier credential enforcement', (_name, error) => {
  expect(isPaidCredentialRefusal(error)).toBe(false)
})
