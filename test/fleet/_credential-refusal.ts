import {PaidOperationRecoveryError} from '../../src/app/paid-operation.ts'
import {VerifierAgentSessionError} from '../../src/verifier-agent/index.ts'

// A transport failure or generic HTTP refusal does not prove that the verifier
// committee rejected the original credential presentation.
export function isPaidCredentialRefusal(error: unknown): boolean {
  return error instanceof PaidOperationRecoveryError
    && error.phase === 'session' && error.code === 'session-refused' && !error.resumable
    && error.cause instanceof VerifierAgentSessionError && error.cause.kind === 'refused'
}
