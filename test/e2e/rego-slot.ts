// A Rego `kk_oauth` slot end to end, through the SDK only, as METERED operations: pack the policy,
// create the slot (authType 'oauth'), fund its Settlement balance with a finite TASRA deposit,
// provision the envelope with the creator's signature, obtain DPoP-bound access tokens from the
// deployment's OAuth identity provider, open an OAuth session on the approved verifier agent,
// present the token, verify the committee token's sealed evidence under the drawn verifiers' keys
// as anchored on chain, then sign at an assigned keeper. A holder WITH the role signs; one WITHOUT
// it is refused by the verifiers with the generic policy refusal. For both, the SDK's local engine
// (`evaluateEnvelope` over the token's actual claims) must reach the same verdict the deployment
// reached. Nothing is paid or reserved: the keepers meter the work.
//
// The session is opened by a key that is NOT the slot's creator (any key may open a session; the
// slot's rule decides), so the suite also proves that an operation needs nothing owner-held.
//
// Needs the wallet configuration test/verify/bringup.ts writes (KK_WALLET_*) and an OAuth identity
// provider (KK_BYO_IDP=1) whose realm has a DPoP client and two password-grant users: one holding
// the role the policy names, one not. Configuration (all environment; the defaults match a local
// deployment brought up with an identity provider):
//   TASRA_IDP_URL            identity provider base URL   (http://127.0.0.1:18080)
//   TASRA_IDP_REALM          realm                         (kk)
//   TASRA_IDP_CLIENT         DPoP public client            (kk-demo)
//   TASRA_IDP_ALLOWED        user:password with the role   (alice:alice-pw)
//   TASRA_IDP_REFUSED        user:password without it      (bob:bob-pw)
//   TASRA_PLATFORM_AUDIENCE  optional cross-check: must equal the audience derived from the
//                            approved verifier agent (chain.env KK_PLATFORM_AUDIENCE)
// Skips (exit 0) when the identity provider is unreachable, unless TASRA_FLEET_REQUIRED=1.
import {ed25519} from '@noble/curves/ed25519'
import {parseEther, type Hex} from 'viem'
import {generatePrivateKey, privateKeyToAccount} from 'viem/accounts'
import {Suite} from '../fleet/_assert.ts'
import {discoverCommittee, gate, loadFleetConfig} from '../fleet/_fleet.ts'
import {fundWalletSlot, walletKeepers, walletSettings} from '../fleet/_wallet-settings.ts'
import {installAgentFetch} from '../fleet/_agent-fetch.ts'
import {fixtureOperationTtlSeconds} from '../fleet/_certification-timing.ts'
import {waitForSlotKeyOnChain} from '../fleet/_anchored-key.ts'
import {createTasraWriteClient, generateClientKey} from '../../src/chain/write.ts'
import {createTasraChainClient} from '../../src/chain/client.ts'
import {provisionRule} from '../../src/chain/provisionRule.ts'
import {createSlotDrawReader} from '../../src/chain/sessionDraw.ts'
import {evaluateEnvelope, isOauthEnvelope, lintEnvelope, packEnvelope, REGO_POLICY_REFUSED, type EnvelopeVerdict} from '../../src/auth/rego.ts'
import {createDpopKey, type DpopKey} from '../../src/auth/dpop.ts'
import {decodeJwtClaims} from '../../src/auth/verifier.ts'
import {platformAudience} from '../../src/committee/oauth.ts'
import {verifyEvidenceBinding} from '../../src/committee/evidence.ts'
import {compoundTokenHash, decodeCompoundToken} from '../../src/committee/token.ts'
import {createOauthSession, submitOauthResponse, waitForSession, VerifierAgentSessionError} from '../../src/verifier-agent/index.ts'
import {presentationOperationTypedData, verifierAgentResult} from '../../src/oid4vp/verifier-agent.ts'
import {requestHash} from '../../src/oid4vp/binding.ts'
import {committeeSign} from '../../src/committee/client.ts'
import {hexToBytes} from '../../src/crypto/hex.ts'

/** The role-only policy: authorize iff the realm role is present. */
const POLICY = 'package tasra.slot\n\ndefault allow := false\n\nallow if "treasury-signer" in input.tokens.kc.claims.realm_access.roles\n'
const ROLE_CLAIM_LEAKS = /realm_access|treasury-signer|tokens\.kc/
const SLOT_TASRA_UNITS = 1_000_000_000_000_000_000n   // the new slot's whole metered deposit: 1 TASRA, funded once
const POLL_TIMEOUT_MS = 120_000                       // longest wait for the verifiers' answer

const cfg = loadFleetConfig()
// Select the fixture lifetime before signing; reference remains 600s.
const OPERATION_SECS = fixtureOperationTtlSeconds(cfg)
const s = new Suite('e2e: Rego kk_oauth slot (OAuth + DPoP → policy → committee token → FROST sign)')
if (!(await gate(s, cfg))) { s.done(); process.exit(process.env.TASRA_FLEET_REQUIRED ? 1 : 0) }

const env = (k: string, d: string) => process.env[k] ?? d
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
const idpBase = env('TASRA_IDP_URL', 'http://127.0.0.1:18080').replace(/\/$/, '')
const realm = env('TASRA_IDP_REALM', 'kk')
const client = env('TASRA_IDP_CLIENT', 'kk-demo')
const configuredAudience = process.env.TASRA_PLATFORM_AUDIENCE ?? process.env.KK_PLATFORM_AUDIENCE
const user = (spec: string) => { const i = spec.indexOf(':'); return {name: spec.slice(0, i), password: spec.slice(i + 1)} }
const allowed = user(env('TASRA_IDP_ALLOWED', 'alice:alice-pw'))
const refused = user(env('TASRA_IDP_REFUSED', 'bob:bob-pw'))

let issuer: string
try {
  const discovery = await fetch(`${idpBase}/realms/${realm}/.well-known/openid-configuration`, {signal: AbortSignal.timeout(5000)})
  issuer = ((await discovery.json()) as {issuer: string}).issuer
} catch (e) {
  if (process.env.TASRA_FLEET_REQUIRED) { s.ok('identity provider reachable', false, String(e)); s.done(); process.exit(1) }
  s.skip('suite', `no identity provider at ${idpBase} (${String(e)})`)
  s.done()
  process.exit(0)
}
s.ok(`identity provider up, iss=${issuer}`, issuer.startsWith('https://'))

// The wallet configuration: the independently approved verifier agent, snapshot hosts, keeper
// routes and durable evidence directory.
let settings: ReturnType<typeof walletSettings>
try { settings = walletSettings(cfg) } catch (e) {
  s.ok('wallet deployment configured (KK_WALLET_*)', false, (e as Error).message); s.done(); process.exit(1)
}
const book = cfg.book
if (!book.KeyRegistry || !book.Settlement || !book.VerifierSetRegistry || !book.ThresholdRandomBeacon || !cfg.deployPk) {
  s.ok('KeyRegistry, Settlement, verifier set registry, beacon and DEPLOY_PK configured', false); s.done(); process.exit(1)
}
const agentUrl = settings.profile.endpoint
// The SDK's OAuth session calls use the global fetch: trust the fleet CA for the approved agent only.
installAgentFetch(agentUrl, settings.transportPolicy.ca)
// The audience every OAuth session checks is derived from the approved agent, never configured.
const audience = platformAudience(agentUrl, cfg.chainId)
s.ok(`platform audience derived from the approved verifier agent (${audience})`,
  configuredAudience === undefined || configuredAudience === audience, `configured ${configuredAudience}`)

// ── 1. pack + create + fund + provision ──────────────────────────────────────
const tokens = {kc: {format: 'oauth+access-token+dpop', iss: [issuer], aud: [audience], max_age_secs: 300}}
const envelope = await packEnvelope(POLICY, tokens)
const lint = await lintEnvelope(envelope)
s.ok('packed envelope is a kk_oauth envelope keepers would store', isOauthEnvelope(envelope) && lint.admissible, lint.admissionError)

const creatorKey = generateClientKey()
const writer = createTasraWriteClient({rpcUrl: cfg.rpcUrl, addresses: book, privateKey: creatorKey, chainId: cfg.chainId})
const funder = createTasraWriteClient({rpcUrl: cfg.rpcUrl, addresses: book, privateKey: cfg.deployPk as Hex, chainId: cfg.chainId})
await funder.sendEth(writer.address, parseEther('1'))
const created = await writer.createSlotCommitReveal({
  oauthPolicy: {policy: POLICY, tokens}, authType: 'oauth', k: 2, n: 3, mode: 'frost', tags: ['keykeeper'],
})
const slotId = created.slotId
s.ok(`slot created from oauthPolicy (${slotId.slice(0, 18)}…, ${created.seeded ? 'seeded' : 'epoch'} reveal)`, created.rule === envelope)

// The owner funds the slot's metered balance once (journaled); the deposit is pinned to exactly
// 1 TASRA whatever the fleet's default. The holders below fund nothing.
const funded = await fundWalletSlot({...cfg, raw: {...cfg.raw, KK_SLOT_TASRA_UNITS: SLOT_TASRA_UNITS.toString()}}, writer, created, created.rule)
s.ok('slot holds exactly its finite 1 TASRA metered deposit', funded.balance === SLOT_TASRA_UNITS)

let committee: string[]
let groupKey = ''
for (const deadline = Date.now() + 240_000; ;) {
  committee = await discoverCommittee(cfg, slotId)
  if (committee.length === 3) {
    const pub = (await (await fetch(`${committee[0]}/v1/keys/${slotId}/public`)).json()) as {group_public_key?: string}
    // A keeper answers once ITS DKG finished; the operations below need the key on chain.
    if (pub.group_public_key) { await waitForSlotKeyOnChain(writer.pub, book.KeyRegistry, slotId, pub.group_public_key, deadline); groupKey = pub.group_public_key; break }
  }
  if (Date.now() > deadline) break
  await sleep(2000)
}
if (!s.ok('FROST DKG complete on a 3-keeper committee', groupKey !== '')) { s.done(); process.exit(1) }

const chain = createTasraChainClient({rpcUrl: cfg.rpcUrl, addresses: book, chainId: cfg.chainId, multicall3: false})
const creator = privateKeyToAccount(creatorKey)
const provisioned = await provisionRule(chain, {slotId, rule: created.rule, ruleSalt: created.ruleSalt, signer: creator, keeperUrls: committee})
  .then(r => ({ok: true, detail: `${r.results.length} keepers`}), (e: unknown) => ({ok: false, detail: `${String(e)} ${JSON.stringify((e as {cause?: unknown}).cause ?? '')}`.slice(0, 600)}))
s.ok(`envelope provisioned by the creator's signature (${provisioned.detail})`, provisioned.ok, provisioned.detail)

// ── 2. tokens, local verdicts ────────────────────────────────────────────────
const tokenUrl = `${idpBase}/realms/${realm}/protocol/openid-connect/token`
async function dpopToken(u: {name: string; password: string}): Promise<{key: DpopKey; accessToken: string}> {
  const key = await createDpopKey()
  const form = new URLSearchParams({grant_type: 'password', client_id: client, username: u.name, password: u.password, scope: 'openid'})
  const request = async (nonce?: string) => fetch(tokenUrl, {method: 'POST', body: form,
    headers: {'content-type': 'application/x-www-form-urlencoded', DPoP: await key.tokenRequestProof({htm: 'POST', htu: tokenUrl, nonce})}})
  let res = await request()
  const challenge = res.headers.get('dpop-nonce')
  if (!res.ok && challenge) res = await request(challenge)
  if (!res.ok) throw new Error(`token request for ${u.name}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
  const body = (await res.json()) as {access_token: string; token_type: string}
  if (body.token_type.toLowerCase() !== 'dpop') throw new Error(`token for ${u.name} is ${body.token_type}, not DPoP-bound`)
  return {key, accessToken: body.access_token}
}

/** The local pre-check: the network's engine over the token's own claims. */
async function localVerdict(accessToken: string): Promise<EnvelopeVerdict> {
  const claims = decodeJwtClaims(accessToken) as Record<string, unknown>
  return evaluateEnvelope(envelope, {holder: `${String(claims.iss)}#${String(claims.sub)}`,
    credentials: [{format: 'oauth+access-token+dpop', issuer: String(claims.iss), claims}]})
}

// ── 3. one metered presentation per holder ───────────────────────────────────
const message = new TextEncoder().encode(`rego-slot e2e ${Date.now()}`)
// The requester: a fresh key with no role on the slot. The creator signs nothing below.
const requester = privateKeyToAccount(generatePrivateKey())
async function present(name: string, token: {key: DpopKey; accessToken: string}) {
  const op = presentationOperationTypedData({chainId: cfg.chainId, keyRegistry: book.KeyRegistry!, slotId, action: 'sign', message,
    description: `Rego slot e2e ${name}`, ttlSecs: OPERATION_SECS})
  const operationSig = await requester.signTypedData(op.typedData)
  let session
  for (const deadline = Date.now() + 180_000; ;) {
    try {
      session = await createOauthSession(agentUrl, {operation: op.operation, operationSig, messageHex: op.messageHex})
      break
    } catch (e) {
      // A fresh slot can precede the current anchored verifier snapshot by a moment; every other
      // refusal is final.
      if (!String(e).includes('verifier snapshot not yet anchored') || Date.now() > deadline) throw e
      await sleep(2000)
    }
  }
  await submitOauthResponse(agentUrl, {sessionId: session.sessionId, pollSecret: session.pollSecret, accessToken: token.accessToken,
    nonce: session.nonce, dpopHtu: session.dpopHtu, signer: token.key.signer})
  const status = await waitForSession(agentUrl, session.sessionId, session.pollSecret, 1000, POLL_TIMEOUT_MS)
  return verifierAgentResult({sessionId: session.sessionId, requestHash: requestHash(cfg.chainId, hexToBytes(slotId), 'sign', op.payloadDigest)}, status)
}

// alice: holds the role.
const alice = await dpopToken(allowed)
const aliceLocal = await localVerdict(alice.accessToken)
s.ok(`local engine allows ${allowed.name} (her token's claims)`, aliceLocal.allow, JSON.stringify(aliceLocal))
const grant = await present('allowed', alice).catch((e: unknown) => {
  s.ok(`${allowed.name}: authorized by the deployment`, false, (e as Error).message ?? String(e)); s.done(); process.exit(1)
})
s.eq(`${allowed.name}: committee declares holder_key binding for the DPoP-verified token`, (grant.token as unknown as {binding?: string}).binding, 'holder_key')
s.ok(`${allowed.name}: the grant carries anchored verifier membership proofs`, (grant.verifierProofs?.length ?? 0) > 0)
// The keeper refuses an evidenced token without its ciphertext: the sealed evidence must be
// present and verify under the drawn verifier keys AS ANCHORED ON CHAIN (read here, not taken
// from the agent) BEFORE anything reaches a keeper.
const evidencePresent = typeof grant.evidenceCt === 'string' && grant.evidenceCt.length > 0 && typeof grant.token.evidence_hash === 'string'
let evidenceDetail = 'no sealed evidence beside the token'
let evidenceVerified = false
if (evidencePresent) {
  try {
    const draws = createSlotDrawReader({client: chain.client, snapshotHosts: settings.accountantUrls, defaultVerificationPolicy: settings.defaultVerificationPolicy,
      deployment: {chainId: cfg.chainId, keyRegistry: book.KeyRegistry, beacon: book.ThresholdRandomBeacon, verifierSet: book.VerifierSetRegistry}})
    const draw = await draws(slotId, BigInt(grant.token.epoch))
    verifyEvidenceBinding(grant.token, grant.evidenceCt, compoundTokenHash(decodeCompoundToken(grant.token)), draw.set.pubkeys, draw.quorum)
    evidenceVerified = true
  } catch (e) { evidenceDetail = (e as Error).message }
}
s.ok(`${allowed.name}: sealed evidence present beside the token`, evidencePresent, evidenceDetail)
if (!s.ok(`${allowed.name}: sealed evidence verifies under the anchored drawn verifier quorum`, evidenceVerified, evidenceDetail)) { s.done(); process.exit(1) }
// One request to an assigned keeper; never repeated.
const keeper = (await walletKeepers(cfg, slotId))[0]!
const signed = await committeeSign({nodeUrl: keeper.url, committeeToken: grant.token, message, verifierProofs: grant.verifierProofs,
  evidenceCt: grant.evidenceCt, targetKeykeeper: keeper.operator})
const signature = new Uint8Array([...signed.signature.r, ...signed.signature.z])
s.ok(`${allowed.name}: keeper produced a FROST signature that verifies under the slot's group key`,
  ed25519.verify(signature, message, hexToBytes(groupKey)))
s.ok(`${allowed.name}: local verdict agrees with the fleet (allow / allow)`, aliceLocal.allow)

// bob: authenticates, lacks the role.
const bob = await dpopToken(refused)
const bobLocal = await localVerdict(bob.accessToken)
s.ok(`local engine refuses ${refused.name} with the generic policy refusal`, !bobLocal.allow && bobLocal.kind === 'reject' && bobLocal.message === REGO_POLICY_REFUSED, JSON.stringify(bobLocal))
const fleet = await present('refused', bob).then(() => 'granted', (e: unknown) => e)
const refusal = fleet instanceof VerifierAgentSessionError ? fleet.message : String(fleet)
s.info(`deployment answered: ${refusal}`)
s.ok(`${refused.name}: refused by the drawn verifiers as a session refusal`, fleet instanceof VerifierAgentSessionError && fleet.kind === 'refused', refusal)
s.ok(`${refused.name}: the refusal is the policy's ('${REGO_POLICY_REFUSED}')`, refusal.includes(REGO_POLICY_REFUSED), refusal)
s.ok(`${refused.name}: the refusal names nothing from the rule`, !ROLE_CLAIM_LEAKS.test(refusal), refusal)
s.ok(`${refused.name}: local verdict agrees with the fleet (reject / reject)`, !bobLocal.allow && fleet !== 'granted')
s.done()
