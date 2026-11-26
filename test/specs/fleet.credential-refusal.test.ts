import {expect, it} from 'vitest'
import {VerifierAgentSessionError} from '../../src/verifier-agent/index.ts'
import {isCredentialRefusal} from '../fleet/_credential-refusal.ts'

const refused = new VerifierAgentSessionError('refused', 'original-session', 'credential refused')
it('recognizes the terminal credential refusal of a verifier-agent session', () => {
  expect(isCredentialRefusal(refused)).toBe(true)
})
it.each([
  ['transport interruption', new VerifierAgentSessionError('unavailable', 'original-session', 'transport lost', 502)],
  ['protocol refusal', new VerifierAgentSessionError('protocol', 'original-session', 'wrong endpoint', 403)],
  ['timeout', new VerifierAgentSessionError('timeout', 'original-session', 'still pending')],
  ['cancellation', new VerifierAgentSessionError('cancelled', 'original-session', 'polling cancelled')],
  ['unrelated failure', new Error('refused')],
  ['lookalike error', {kind: 'refused', retryable: false}],
  ['wrapped refusal', new Error('session failed', {cause: refused})],
])('does not count %s as verifier credential enforcement', (_name, error) => {
  expect(isCredentialRefusal(error)).toBe(false)
})
