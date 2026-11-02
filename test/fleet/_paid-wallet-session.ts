// Native SDK wallet control. The durable orchestration now lives in the SDK
// (src/app/paid-session.ts); this keeps the fleet driver's original call shape.
import {drivePaidSession, waitForPaidSnapshot, type PaidWalletPresentation} from '../../src/app/paid-session.ts'
import type {RegisteredPaidAgentSession} from '../../src/chain/registeredPaidAgent.ts'
import type {PaidVerifierWitness} from '../../src/chain/prepaid.ts'
import type {ApplicationStore} from '../../src/app/node.ts'
import type {VerifiedRequestObject} from '../../src/oid4vp/request-object.ts'
import type {SessionStatusResult} from '../../src/verifier-agent/index.ts'

export {waitForPaidSnapshot}
export type {PaidWalletPresentation}
export interface PaidWalletDriverOptions {
  session: RegisteredPaidAgentSession
  members: readonly PaidVerifierWitness[]
  store: ApplicationStore
  signal: AbortSignal
  observeRequest?(request: VerifiedRequestObject): void | Promise<void>
  makePresentation(request: VerifiedRequestObject): PaidWalletPresentation
  submit(request: VerifiedRequestObject, presentation: PaidWalletPresentation): Promise<void>
  wait(): Promise<void>
}

export function drivePaidWalletSession(options: PaidWalletDriverOptions): Promise<SessionStatusResult> {
  return drivePaidSession({session: options.session, members: options.members, store: options.store, signal: options.signal,
    observeRequest: options.observeRequest, wait: () => options.wait(),
    holder: {kind: 'local', makePresentation: request => options.makePresentation(request), submit: (request, presentation) => options.submit(request, presentation)}})
}
