// Real production wallet authorization shared by the live suites.
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {privateKeyToAccount} from 'viem/accounts'
import {parseEther, type Address, type Hex} from 'viem'
import {createTasraChainClient} from '../../src/chain/client.ts'
import {createTasraWriteClient, generateClientKey} from '../../src/chain/write.ts'
import {createRegisteredAgentClient} from '../../src/chain/registeredAgent.ts'
import {assertRegisteredWalletRequest, awaitRegisteredVerifierAgentResult, openRegisteredVerifierAgentSession, type RegisteredVerifierAgentSession} from '../../src/chain/registeredOperation.ts'
import {createNodeAgentTransport, createNodeAgentWalletFetch} from '../../src/chain/node.ts'
import {VerifierAgentSessionError} from '../../src/verifier-agent/index.ts'
import {
  buildResponse, defaultKeyResolver, ed25519HolderKey, fetchRequestObject, issueSdJwtVc, parseSdJwt, planPresentation,
  sdJwtCredentialView, submitResponse, type HolderKey, type OperationInput, type VerifiedRequestObject,
} from '../../src/oid4vp/index.ts'
import {discoverCommittee, mintAdminJwt, provisionRule, type FleetConfig} from './_fleet.ts'
import {assertLocalMeteredFleet, fundWalletSlot, localFleetSettings, walletKeepers, walletSettings} from './_wallet-settings.ts'
import {fixtureOperationTtlSeconds} from './_certification-timing.ts'
import {waitForCommitteeShares, waitForSlotKeyOnChain} from './_anchored-key.ts'
import {issuerStatus} from './_issuer-status.ts'

export const WALLET_RULE = JSON.stringify({credentials:[{claims:[{path:['iss'],values:['did:web:hr.acmecorp.example']},{path:['dept'],values:['Engineering']}],format:'dc+sd-jwt',id:'employee',meta:{vct_values:['EmployeeOf']}}]})

export function issueWallet(cfg: FleetConfig, opts: {dept?: string; issuer?: string; ttlSecs?: number; issuerKey?: string; vct?: string; claims?: Record<string, unknown>} = {}) {
  const holder = ed25519HolderKey(randomBytes(32))
  const claims = opts.claims ?? {dept:opts.dept ?? 'Engineering'}
  assert(!Object.hasOwn(claims, 'credentialStatus') && !Object.hasOwn(claims, 'status'), 'Issuer status must come from its original allocation ledger')
  const status = issuerStatus(cfg, holder.did)
  const sdJwt = issueSdJwtVc({
    issuer:{did:opts.issuer ?? cfg.issuerDid, signer:{alg:'EdDSA',privateKey:Buffer.from(opts.issuerKey ?? cfg.issuerKey,'base64url')}},
    vct:opts.vct ?? 'EmployeeOf', claims:{...claims, credentialStatus:status}, plain:['credentialStatus'], cnf:{jwk:holder.publicJwk},
    sub:holder.did, ttlSecs:opts.ttlSecs ?? 3600,
  })
  return {holder, sdJwt}
}

/**
 * The wallet step of one registered session: fetch its Request Object over the session's own
 * guarded routes, verify it against the opened operation (and, in session mode, this client's
 * session key), then present the held credential as an encrypted direct_post.jwt.
 */
export async function presentWallet(cfg: FleetConfig, session: RegisteredVerifierAgentSession, wallet: {holder: HolderKey; sdJwt: string},
  options: {forcePresentation?: boolean; observeRequest?: (request: VerifiedRequestObject, fetcher: typeof fetch) => void | Promise<void>; signal?: AbortSignal} = {}) {
  const settings = walletSettings(cfg)
  // Wallet traffic stays on the approved session: its request URI, response URI and the agent DID.
  const fetcher = createNodeAgentWalletFetch(session, settings.transportPolicy)
  const request = await fetchRequestObject(session.requestUri, {fetchImpl: fetcher, resolveKey: defaultKeyResolver({fetchImpl: fetcher}), ...(options.signal ? {signal: options.signal} : {})})
  assertRegisteredWalletRequest(session, request, await session.poll(options.signal))
  await options.observeRequest?.(request, fetcher)
  const plan = planPresentation(request, [{sdJwt: wallet.sdJwt}]), parsed = parseSdJwt(wallet.sdJwt)
  const candidate = options.forcePresentation ? {held: {sdJwt: wallet.sdJwt}, parsed, view: sdJwtCredentialView(parsed), queryId: request.claims.dcql_query.credentials[0]!.id} : plan.chosen
  assert(candidate, 'Held credential does not answer the wallet request')
  const built = buildResponse({ro: request, candidate, holder: wallet.holder, disclose: 'all'})
  assert(built.encrypted && built.form.response, 'Presentation must use encrypted direct_post.jwt')
  await submitResponse(request, built, fetcher)
}

/**
 * One metered wallet authorization through the SDK: sign the operation request, open a session at
 * the independently approved registered verifier-agent, verify its Request Object against the
 * opened operation, present the held credential (encrypted direct_post.jwt) and collect the
 * holder-bound committee token with its anchored verifier proofs. Nothing is paid or reserved.
 *
 * `signerKey` signs the operation request. ANY key may open a session (the slot's rule decides):
 * suites about the creator pass the creator key, others may pass an unrelated key.
 * `coordinator` pins the assigned keeper the caller sends the operation to (default: the first
 * assigned keeper); `coordinatorUrl` is that keeper's local route.
 */
export async function authorizeWallet(cfg: FleetConfig, slot: Hex, signerKey: Hex,
  input: Pick<OperationInput,'action'|'message'|'payloadDigest'|'identity'|'decryption'|'ttlSecs'>,
  wallet: {holder: HolderKey; sdJwt: string} = issueWallet(cfg), forcePresentation = false, coordinator?: Address,
  observeRequest?: (request: VerifiedRequestObject, fetcher: typeof fetch) => void | Promise<void>) {
  input = structuredClone(input)
  const settings = walletSettings(cfg), signer = privateKeyToAccount(signerKey)
  assert(cfg.book.KeyRegistry && cfg.book.ServiceRegistry, 'Wallet authorization needs the KeyRegistry and ServiceRegistry')
  const keepers = await walletKeepers(cfg, slot)
  const target = coordinator ? keepers.find(k => k.operator.toLowerCase() === coordinator.toLowerCase()) : keepers[0]
  assert(target, 'Requested coordinator is not an assigned keeper of the slot')
  const ttlSecs = fixtureOperationTtlSeconds(cfg, input.ttlSecs)
  const chain = createTasraChainClient({rpcUrl: cfg.rpcUrl, addresses: cfg.book, chainId: 43112, multicall3: false})
  const client = createRegisteredAgentClient(chain, {profiles: [settings.profile], transport: createNodeAgentTransport(settings.transportPolicy)})
  const signal = AbortSignal.timeout(Math.min(150_000, ttlSecs * 1000) + 60_000)
  // The registered client re-sends only the agent's "snapshot not yet anchored" refusal; every
  // other creation failure is final and surfaces here.
  const session = await openRegisteredVerifierAgentSession(client, {...input, ttlSecs, chainId: 43112, keyRegistry: cfg.book.KeyRegistry,
    slotId: slot, description: 'Local test operation', signer, signal})
  try {
    await presentWallet(cfg, session, wallet, {forcePresentation, observeRequest, signal})
  } catch (error) {
    // The agent judges what it can before any verifier work (an expired credential) in the
    // direct_post reply itself - a 4xx the wallet transport refuses to read - and ends the session
    // `failed`. That session's own outcome is the verdict; a refusal that left it pending (a
    // malformed or undecryptable response) keeps the submit error.
    const outcome = await awaitRegisteredVerifierAgentResult(session, {intervalMs: 500, timeoutMs: 10_000, signal})
      .then(() => undefined, (failure: unknown) => failure)
    if (outcome instanceof VerifierAgentSessionError && outcome.kind === 'refused') throw outcome
    throw error
  }
  const result = await awaitRegisteredVerifierAgentResult(session, {intervalMs: 1000, timeoutMs: 120_000, signal})
  assert.equal(result.token.binding, 'holder_key')
  assert(result.verifierProofs?.length, 'Authorization did not include verifier membership proofs')
  // ADR-0076: a sealed committee returns the evidence ciphertext BESIDE the token; a keeper
  // refuses an evidenced token without it, and refuses it beside an un-evidenced one.
  const evidence = result.evidenceCt !== undefined ? {evidenceCt: result.evidenceCt, evidence_ct: result.evidenceCt} : {}
  return {compound_token: result.token, verifierProofs: result.verifierProofs,
    verifier_proofs: result.verifierProofs.map(p => ({verifier_index: p.verifierIndex, operator: p.operator, pubkey: p.pubkey, proof: p.proof})),
    ...evidence, coordinator: target.operator, coordinatorUrl: target.url, sessionId: session.sessionId}
}

export async function createWalletSlot(cfg: FleetConfig, mode: 'frost'|'bls' = 'frost', k = 2, n = 3, rule = WALLET_RULE) {
  localFleetSettings(cfg)
  const creatorKey = generateClientKey()
  const writer = createTasraWriteClient({rpcUrl:cfg.rpcUrl,addresses:cfg.book,privateKey:creatorKey,chainId:cfg.chainId})
  await assertLocalMeteredFleet(cfg, writer)
  const funder = createTasraWriteClient({rpcUrl:cfg.rpcUrl,addresses:cfg.book,privateKey:cfg.deployPk as Hex,chainId:cfg.chainId})
  await funder.sendEth(writer.address,parseEther('1'))
  const created = await writer.createSlotCommitReveal({rule:rule,k,n,mode,authType:'oid4vp',tags:['keykeeper']})
  const {slotId,ruleSalt} = created
  // The owner funds the slot's metered Settlement balance once; holders need only a credential.
  await fundWalletSlot(cfg, writer, created, rule)
  const deadline = Date.now()+240000
  for (;;) {
    const committee = await discoverCommittee(cfg,slotId)
    if (committee.length === n) {
      const response = await fetch(`${committee[0]}/v1/keys/${slotId}/public`)
      assert.equal(response.status,200)
      const pub = await response.json() as {group_public_key?:string}
      if (pub.group_public_key) {
        // A keeper answers once ITS DKG finished; operations need the key anchored on chain.
        await waitForSlotKeyOnChain(writer.pub, cfg.book.KeyRegistry!, slotId, pub.group_public_key, deadline)
        // Anchored = enough members finished; every member may coordinate, so each must hold its share.
        const route = mode === 'bls' ? 'bls-share-report' : 'share-report'
        await waitForCommitteeShares(async keeper => (await fetch(`${keeper}/v1/keys/${slotId}/${route}`)).status, committee, {deadlineMs: deadline})
        const provisioned = await provisionRule(committee,slotId,rule,ruleSalt,mintAdminJwt(cfg))
        assert(provisioned.ok,provisioned.errors.join('; '))
        return {slotId,ruleSalt,committee,publicKey:pub.group_public_key,creatorKey,writer}
      }
    }
    assert(Date.now()<deadline,'slot DKG did not complete')
    await new Promise(resolve=>setTimeout(resolve,2000))
  }
}
