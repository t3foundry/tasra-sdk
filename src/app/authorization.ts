import {openRegisteredVerifierAgentSession, awaitRegisteredVerifierAgentResult, type RegisteredVerifierAgentSession} from '../chain/registeredOperation.js'
import {createRegisteredAgentClient} from '../chain/registeredAgent.js'
import type {TypedDataSigner} from '../oid4vp/verifier-agent.js'
import type {PresentationDelegation, SessionPhase} from '../verifier-agent/index.js'
import type {OperationAuthorizer} from './client.js'

/**
 * Request-bound authorization through an independently approved registered agent.
 * `present` displays a QR/deep link or runs the application's credential wallet.
 * It never changes the selected provider or transfers a presentation to a fallback.
 */
export function registeredWalletAuthorization(config: {
  client: ReturnType<typeof createRegisteredAgentClient>
  signer: TypedDataSigner
  delegation?: PresentationDelegation
  present: (session: RegisteredVerifierAgentSession, signal?: AbortSignal) => Promise<void>
  onPhase?: (phase: SessionPhase) => void
  timeoutMs?: number
}): OperationAuthorizer {
  const {client, signer, delegation, present, onPhase, timeoutMs} = config
  return async request => {
    const session = await openRegisteredVerifierAgentSession(client, {...request, signer, delegation})
    request.signal?.throwIfAborted()
    await present(session, request.signal)
    request.signal?.throwIfAborted()
    const result = await awaitRegisteredVerifierAgentResult(session, {signal: request.signal, onPhase, timeoutMs})
    if (!result.verifierProofs?.length) throw new Error('Authorization did not include verifier membership proofs')
    return {token: result.token, verifierProofs: result.verifierProofs}
  }
}
