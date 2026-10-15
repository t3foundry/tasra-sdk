// A Rego `kk_oauth` slot end to end, through the SDK only: pack the policy, create the slot
// (authType 'oauth'), provision the envelope with the creator's signature, obtain DPoP-bound
// access tokens from the deployment's OAuth identity provider, open an OAuth session on the
// verifier agent and sign. A holder WITH the role signs; one WITHOUT it is refused with the
// generic policy refusal. For both, the SDK's local engine (`evaluateEnvelope` over the
// token's actual claims) must reach the same verdict the deployment reached.
//
// Needs a deployment with an OAuth identity provider whose realm has a DPoP client and two
// password-grant users: one holding the role the policy names, one not. Configuration (all
// environment; the defaults match a local deployment brought up with an identity provider):
//   TASRA_IDP_URL            identity provider base URL   (http://127.0.0.1:18080)
//   TASRA_IDP_REALM          realm                         (kk)
//   TASRA_IDP_CLIENT         DPoP public client            (kk-demo)
//   TASRA_IDP_ALLOWED        user:password with the role   (alice:alice-pw)
//   TASRA_IDP_REFUSED        user:password without it      (bob:bob-pw)
//   TASRA_PLATFORM_AUDIENCE  the platform audience tokens carry (chain.env KK_PLATFORM_AUDIENCE)
//   TASRA_VERIFIER_AGENT_URL verifier-agent base URL the client posts to (http://127.0.0.1:8390)
// Skips (exit 0) when the identity provider is unreachable, unless TASRA_FLEET_REQUIRED=1.
import {ed25519} from '@noble/curves/ed25519'
import {parseEther, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {Suite} from '../fleet/_assert.ts'
import {discoverCommittee, gate, loadFleetConfig} from '../fleet/_fleet.ts'
import {createTasraWriteClient, generateClientKey} from '../../src/chain/write.ts'
import {createTasraChainClient} from '../../src/chain/client.ts'
import {provisionRule} from '../../src/chain/provisionRule.ts'
import {evaluateEnvelope, isOauthEnvelope, lintEnvelope, packEnvelope, REGO_POLICY_REFUSED, type EnvelopeVerdict} from '../../src/auth/rego.ts'
import {createDpopKey, type DpopKey} from '../../src/auth/dpop.ts'
import {decodeJwtClaims} from '../../src/auth/verifier.ts'
import {createOauthSession, submitOauthResponse, waitForSession, VerifierAgentSessionError} from '../../src/verifier-agent/index.ts'
import {presentationOperationTypedData, verifierAgentResult} from '../../src/oid4vp/verifier-agent.ts'
import {requestHash} from '../../src/oid4vp/binding.ts'
import {committeeSign} from '../../src/committee/client.ts'
import {hexToBytes} from '../../src/crypto/hex.ts'

/** The role-only policy: authorize iff the realm role is present. */
const POLICY = 'package tasra.slot\n\ndefault allow := false\n\nallow if "treasury-signer" in input.tokens.kc.claims.realm_access.roles\n'
const ROLE_CLAIM_LEAKS = /realm_access|treasury-signer|tokens\.kc/

const cfg = loadFleetConfig()
const s = new Suite('e2e: Rego kk_oauth slot (OAuth + DPoP → policy → committee token → FROST sign)')
if (!(await gate(s, cfg))) { s.done(); process.exit(process.env.TASRA_FLEET_REQUIRED ? 1 : 0) }

const env = (k: string, d: string) => process.env[k] ?? d
const idpBase = env('TASRA_IDP_URL', 'http://127.0.0.1:18080').replace(/\/$/, '')
const realm = env('TASRA_IDP_REALM', 'kk')
const client = env('TASRA_IDP_CLIENT', 'kk-demo')
const agentUrl = env('TASRA_VERIFIER_AGENT_URL', process.env.KK_VERIFIER_AGENT_DIRECT_URL ?? 'http://127.0.0.1:8390')
const audience = process.env.TASRA_PLATFORM_AUDIENCE ?? process.env.KK_PLATFORM_AUDIENCE ?? ''
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
s.ok('platform audience configured (TASRA_PLATFORM_AUDIENCE / chain.env KK_PLATFORM_AUDIENCE)', audience !== '')
if (!cfg.book.KeyRegistry || !cfg.deployPk) { s.ok('KEY_REGISTRY and DEPLOY_PK configured', false); s.done(); process.exit(1) }

// ── 1. pack + create + provision ─────────────────────────────────────────────
const tokens = {kc: {format: 'oauth+access-token+dpop', iss: [issuer], aud: [audience], max_age_secs: 300}}
const envelope = await packEnvelope(POLICY, tokens)
const lint = await lintEnvelope(envelope)
s.ok('packed envelope is a kk_oauth envelope keepers would store', isOauthEnvelope(envelope) && lint.admissible, lint.admissionError)

const creatorKey = generateClientKey()
const writer = createTasraWriteClient({rpcUrl: cfg.rpcUrl, addresses: cfg.book, privateKey: creatorKey, chainId: cfg.chainId})
const funder = createTasraWriteClient({rpcUrl: cfg.rpcUrl, addresses: cfg.book, privateKey: cfg.deployPk as Hex, chainId: cfg.chainId})
await funder.sendEth(writer.address, parseEther('1'))
const created = await writer.createSlotCommitReveal({
  oauthPolicy: {policy: POLICY, tokens}, authType: 'oauth', k: 2, n: 3, mode: 'frost', tags: ['keykeeper'], maxWaitMs: 180_000,
})
const slotId = created.slotId
s.ok(`slot created from oauthPolicy (${slotId.slice(0, 18)}…, ${created.seeded ? 'seeded' : 'epoch'} reveal)`, created.rule === envelope)

let committee: string[]
let groupKey = ''
for (const deadline = Date.now() + 240_000; ;) {
  committee = await discoverCommittee(cfg, slotId)
  if (committee.length === 3) {
    const pub = (await (await fetch(`${committee[0]}/v1/keys/${slotId}/public`)).json()) as {group_public_key?: string}
    if (pub.group_public_key) { groupKey = pub.group_public_key; break }
  }
  if (Date.now() > deadline) break
  await new Promise(r => setTimeout(r, 2000))
}
if (!s.ok('FROST DKG complete on a 3-keeper committee', groupKey !== '')) { s.done(); process.exit(1) }

const chain = createTasraChainClient({rpcUrl: cfg.rpcUrl, addresses: cfg.book, chainId: cfg.chainId})
const creator = privateKeyToAccount(creatorKey)
const provisioned = await provisionRule(chain, {slotId, rule: created.rule, ruleSalt: created.ruleSalt, signer: creator, keeperUrls: committee})
  .then(r => ({ok: true, detail: `${r.results.length} keepers`}), (e: unknown) => ({ok: false, detail: `${String(e)} ${JSON.stringify((e as {cause?: unknown}).cause ?? '')}`.slice(0, 600)}))
s.ok(`envelope provisioned by the creator's signature (${provisioned.detail})`, provisioned.ok, provisioned.detail)

// ── 2. tokens, local verdicts, fleet verdicts ────────────────────────────────
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

const message = new TextEncoder().encode(`rego-slot e2e ${Date.now()}`)
async function present(accessToken: string, key: DpopKey) {
  const op = presentationOperationTypedData({chainId: cfg.chainId, keyRegistry: cfg.book.KeyRegistry!, slotId, action: 'sign', message, description: 'Rego slot e2e signature'})
  const operationSig = await creator.signTypedData(op.typedData)
  let session
  for (const deadline = Date.now() + 180_000; ;) {
    try {
      session = await createOauthSession(agentUrl, {operation: op.operation, operationSig, messageHex: op.messageHex})
      break
    } catch (e) {
      // A fresh slot can precede the current anchored verifier snapshot by a moment.
      if (!String(e).includes('no anchored verifier snapshot') || Date.now() > deadline) throw e
      await new Promise(r => setTimeout(r, 2000))
    }
  }
  await submitOauthResponse(agentUrl, {sessionId: session.sessionId, pollSecret: session.pollSecret, accessToken, nonce: session.nonce, dpopHtu: session.dpopHtu, signer: key.signer})
  const status = await waitForSession(agentUrl, session.sessionId, session.pollSecret, 1000, 120_000)
  return verifierAgentResult({sessionId: session.sessionId, requestHash: requestHash(cfg.chainId, hexToBytes(slotId), 'sign', op.payloadDigest)}, status)
}

// alice: holds the role.
const alice = await dpopToken(allowed)
const aliceLocal = await localVerdict(alice.accessToken)
s.ok(`local engine allows ${allowed.name} (her token's claims)`, aliceLocal.allow, JSON.stringify(aliceLocal))
const grant = await present(alice.accessToken, alice.key)
s.eq(`${allowed.name}: committee declares holder_key binding for the DPoP-verified token`, (grant.token as unknown as {binding?: string}).binding, 'holder_key')
const signed = await committeeSign({nodeUrl: committee[0]!, committeeToken: grant.token, message, verifierProofs: grant.verifierProofs, evidenceCt: grant.evidenceCt})
const signature = new Uint8Array([...signed.signature.r, ...signed.signature.z])
s.ok(`${allowed.name}: keeper produced a FROST signature that verifies under the slot's group key`,
  ed25519.verify(signature, message, hexToBytes(groupKey)))
s.ok(`${allowed.name}: local verdict agrees with the fleet (allow / allow)`, aliceLocal.allow)

// bob: authenticates, lacks the role.
const bob = await dpopToken(refused)
const bobLocal = await localVerdict(bob.accessToken)
s.ok(`local engine refuses ${refused.name} with the generic policy refusal`, !bobLocal.allow && bobLocal.kind === 'reject' && bobLocal.message === REGO_POLICY_REFUSED, JSON.stringify(bobLocal))
const fleet = await present(bob.accessToken, bob.key).then(() => 'granted', (e: unknown) => e)
const refusal = fleet instanceof VerifierAgentSessionError ? fleet.message : String(fleet)
s.info(`deployment answered: ${refusal}`)
s.ok(`${refused.name}: refused by the deployment as a session refusal`, fleet instanceof VerifierAgentSessionError && fleet.kind === 'refused', refusal)
s.ok(`${refused.name}: the refusal is the policy's ('${REGO_POLICY_REFUSED}')`, refusal.includes(REGO_POLICY_REFUSED), refusal)
s.ok(`${refused.name}: the refusal names nothing from the rule`, !ROLE_CLAIM_LEAKS.test(refusal), refusal)
s.ok(`${refused.name}: local verdict agrees with the fleet (reject / reject)`, !bobLocal.allow && fleet !== 'granted')
s.done()
