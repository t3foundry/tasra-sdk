/** Adversarial test only: bypass wallet filtering to test the verifier's own refusal. */
import type {TasraClient, TasraIdentity} from 'tasra-sdk/app'
import {
  openVerifierAgentSession, fetchRequestObject, parseOpenid4vpUri, parseSdJwt,
  sdJwtCredentialView, buildResponse, submitResponse, awaitVerifierAgentResult,
  VerifierAgentSessionError, type TypedDataSigner,
} from 'tasra-sdk/oid4vp'

export async function proveServerRefusal(tasra: TasraClient, signer: TypedDataSigner,
  slotId: `0x${string}`, identity: TasraIdentity, credential: string,
  operation: {action: 'sign' | 'ibe-extract'; message?: Uint8Array; identity?: string}, queryId = 'access') {
  if (!tasra.verifierAgentUrl) throw new Error('Manifest has no verifier agent')
  const session = await openVerifierAgentSession({verifierAgentUrl: tasra.verifierAgentUrl,
    chainId: tasra.deployment.chainId, keyRegistry: tasra.deployment.addresses.KeyRegistry!,
    slotId, signer, ...operation, description: 'Negative authorization test'})
  const ro = await fetchRequestObject(parseOpenid4vpUri(session.qrPayload).requestUri)
  const parsed = parseSdJwt(credential)
  await submitResponse(ro, buildResponse({ro, holder: identity.holder,
    candidate: {held: {sdJwt: credential}, parsed, view: sdJwtCredentialView(parsed), queryId}}))
  try { await awaitVerifierAgentResult(session, {timeoutMs: 60_000}) }
  catch (error) {
    if (error instanceof VerifierAgentSessionError && error.kind === 'refused' && /no presented credential satisfies query/i.test(error.message)) return 'verifier-refused' as const
    throw error
  }
  throw new Error('Unauthorized user obtained a grant')
}
