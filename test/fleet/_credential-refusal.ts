import {PaidOperationRecoveryError} from '../../src/app/paid-operation.ts'
import {VerifierAgentSessionError} from '../../src/verifier-agent/index.ts'

// A transport failure or generic HTTP refusal does not prove terminal credential
// session refusal. Admission can refuse an expired credential before verifier work.
export function isPaidCredentialRefusal(error: unknown): boolean {
  return error instanceof PaidOperationRecoveryError
    && error.phase === 'session' && error.code === 'session-refused' && !error.resumable
    && error.cause instanceof VerifierAgentSessionError && error.cause.kind === 'refused'
}
