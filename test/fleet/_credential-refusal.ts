import {VerifierAgentSessionError} from '../../src/verifier-agent/index.ts'

// A transport failure, a timeout or a generic HTTP refusal does not prove a terminal credential
// refusal: only the session itself ending `failed` (the verifiers or the wallet refused) does.
export function isCredentialRefusal(error: unknown): boolean {
  return error instanceof VerifierAgentSessionError && error.kind === 'refused' && !error.retryable
}
