// A Rego `kk_oauth` slot end to end, through the SDK only, as PAID operations: pack the policy,
// create the slot (authType 'oauth'), fund it with a finite TASRA credit, provision the envelope
// with the creator's signature, obtain DPoP-bound access tokens from the deployment's OAuth
// identity provider, and run each presentation as one paid job on the registered verifier
// agent: reserve TASRA, open a registered OAuth session, approve the drawn verifiers' work,
// verify the committee token and its sealed evidence, then sign at the assigned keeper. A holder
// WITH the role signs; one WITHOUT it is refused by the verifiers with the generic policy
// refusal. For both, the SDK's local engine (`evaluateEnvelope` over the token's actual claims)
// must reach the same verdict the deployment reached.
//
// Every job keeps its own journal folder (under KK_PREPAID_EVIDENCE_DIR/rego-slot-jobs), written
// once per record and kept whatever the result. A job whose outcome is unknown stops the suite;
// nothing is sent again, and a later run refuses to start while such a job is open.
//
// Needs a paid deployment (the KK_PREPAID_* configuration test/verify/bringup.ts writes) with an
// OAuth identity provider (KK_BYO_IDP=1) whose realm has a DPoP client and two password-grant
// users: one holding the role the policy names, one not. Configuration (all environment; the
// defaults match a local deployment brought up with an identity provider):
//   TASRA_IDP_URL            identity provider base URL   (http://127.0.0.1:18080)
//   TASRA_IDP_REALM          realm                         (kk)
//   TASRA_IDP_CLIENT         DPoP public client            (kk-demo)
//   TASRA_IDP_ALLOWED        user:password with the role   (alice:alice-pw)
//   TASRA_IDP_REFUSED        user:password without it      (bob:bob-pw)
//   TASRA_PLATFORM_AUDIENCE  optional cross-check: must equal the audience derived from the
//                            approved verifier agent (chain.env KK_PLATFORM_AUDIENCE)
// Skips (exit 0) when the identity provider is unreachable, unless TASRA_FLEET_REQUIRED=1.
import {existsSync, mkdirSync, readdirSync, writeFileSync} from 'node:fs'
import {randomBytes} from 'node:crypto'
import {join} from 'node:path'
import {ed25519} from '@noble/curves/ed25519'
import {createWalletClient, http, keccak256, parseEther, toHex, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {Suite} from '../fleet/_assert.ts'
import {discoverCommittee, gate, loadFleetConfig} from '../fleet/_fleet.ts'
import {paidWalletSettings} from '../fleet/_paid-wallet.ts'
import {waitForPaidSnapshot} from '../fleet/_paid-wallet-session.ts'
import {fundFreshWalletSlot} from '../fleet/_prepaid-funding.ts'
import {withDedicatedPayer} from '../fleet/_payer-queue.ts'
import {createTasraWriteClient, generateClientKey} from '../../src/chain/write.ts'
import {createTasraChainClient} from '../../src/chain/client.ts'
import {provisionRule} from '../../src/chain/provisionRule.ts'
import {createNodePaidAgentTransport} from '../../src/chain/node.ts'
import {discoverPaidOperationContext, readClientExecutionPolicy, type PaidVerifierWitness} from '../../src/chain/prepaid.ts'
import {fetchDrawnVerifierWitnesses} from '../../src/chain/verifierSnapshot.ts'
import {reservePaidOperation} from '../../src/chain/reservation.ts'
import {prepareRegisteredPaidSession, PaidAgentControlError, type ClientApprovedPresentation,
  type RegisteredPaidAgentSession} from '../../src/chain/registeredPaidAgent.ts'
import {createKeeperExecutionApprover} from '../../src/chain/keeperExecution.ts'
import {evaluateEnvelope, isOauthEnvelope, lintEnvelope, packEnvelope, REGO_POLICY_REFUSED, type EnvelopeVerdict} from '../../src/auth/rego.ts'
import {createDpopKey, type DpopKey} from '../../src/auth/dpop.ts'
import {decodeJwtClaims} from '../../src/auth/verifier.ts'
import {platformAudience} from '../../src/committee/oauth.ts'
import {paymentIntentHash, paymentIntentTypedData, paymentSessionCommitment, type PaymentIntentWire} from '../../src/committee/payment.ts'
import {createExecutionCertificate, createLocalExecutionSigner, executionBodyHash} from '../../src/committee/execution.ts'
import {verifyEvidenceBinding} from '../../src/committee/evidence.ts'
import {compoundTokenHash, decodeCompoundToken} from '../../src/committee/token.ts'
import {presentationOperationTypedData, verifierAgentResult} from '../../src/oid4vp/verifier-agent.ts'
import {requestHash} from '../../src/oid4vp/binding.ts'
import {committeeSign} from '../../src/committee/client.ts'
import {hexToBytes} from '../../src/crypto/hex.ts'

/** The role-only policy: authorize iff the realm role is present. */
const POLICY = 'package tasra.slot\n\ndefault allow := false\n\nallow if "treasury-signer" in input.tokens.kc.claims.realm_access.roles\n'
const ROLE_CLAIM_LEAKS = /realm_access|treasury-signer|tokens\.kc/

// What the suite may spend. TASRA amounts are base units (18 decimals).
const SLOT_TASRA_UNITS = 1_000_000_000_000_000_000n   // the new slot's whole credit: 1 TASRA, funded once
const MAX_TASRA_UNITS = 1_000_000_000_000_000n        // one operation costs at most 0.001 TASRA of it
const MAX_GAS = 2_000_000n                            // gas limit of each reservation
const MAX_FEE_PER_GAS = 100_000_000_000n              // at most 100 gwei per unit of gas
const OPERATION_SECS = 600                            // an unused reservation expires after 10 minutes
const POLL_TIMEOUT_MS = 120_000                       // longest wait for the verifiers' answer

const cfg = loadFleetConfig()
const s = new Suite('e2e: Rego kk_oauth slot (OAuth + DPoP → policy → paid committee token → FROST sign)')
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

// The paid configuration: the independently approved verifier agent, accountant hosts, keeper
// routes and durable evidence directory. Production keepers serve nothing unpaid.
let settings: ReturnType<typeof paidWalletSettings>
try { settings = paidWalletSettings(cfg) } catch (e) {
  s.ok('paid deployment configured (KK_PREPAID_*)', false, (e as Error).message); s.done(); process.exit(1)
}
const book = cfg.book
if (!book.KeyRegistry || !book.Settlement || !book.VerifierSetRegistry || !book.AccountantSetRegistry || !book.ThresholdRandomBeacon || !cfg.deployPk) {
  s.ok('KeyRegistry, Settlement, verifier/accountant set registries, beacon and DEPLOY_PK configured', false); s.done(); process.exit(1)
}
// The audience every paid OAuth session checks is derived from the approved agent, never configured.
const audience = platformAudience(settings.profile.endpoint, cfg.chainId)
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
  oauthPolicy: {policy: POLICY, tokens}, authType: 'oauth', k: 2, n: 3, mode: 'frost', tags: ['keykeeper'], maxWaitMs: 180_000,
})
const slotId = created.slotId
s.ok(`slot created from oauthPolicy (${slotId.slice(0, 18)}…, ${created.seeded ? 'seeded' : 'epoch'} reveal)`, created.rule === envelope)

// The funding helper journals the original rule, salt and deposit before it spends; the deposit
// is pinned to exactly 1 TASRA whatever the fleet's default.
const funded = await fundFreshWalletSlot({...cfg, raw: {...cfg.raw, KK_PREPAID_SLOT_TASRA_UNITS: SLOT_TASRA_UNITS.toString()}},
  writer, creatorKey, created, created.rule)
s.ok('slot holds exactly its finite 1 TASRA credit, enabled for paid operations',
  funded.enabled && funded.available === SLOT_TASRA_UNITS && funded.total === SLOT_TASRA_UNITS)

let committee: string[]
let groupKey = ''
for (const deadline = Date.now() + 240_000; ;) {
  committee = await discoverCommittee(cfg, slotId)
  if (committee.length === 3) {
    const pub = (await (await fetch(`${committee[0]}/v1/keys/${slotId}/public`)).json()) as {group_public_key?: string}
    if (pub.group_public_key) { groupKey = pub.group_public_key; break }
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

// ── 3. one paid job per presentation ─────────────────────────────────────────
const JOBS_DIR = join(settings.directory, 'rego-slot-jobs')
type Job = {dir: string; write(file: string, value: unknown): void; mark(file: string): void}
/** A new journal folder for one operation. An earlier job without an outcome blocks it. */
function newJob(name: string): Job {
  mkdirSync(JOBS_DIR, {recursive: true, mode: 0o700})
  for (const entry of readdirSync(JOBS_DIR)) {
    const dir = join(JOBS_DIR, entry)
    if (!existsSync(join(dir, 'outcome'))) throw new Error(`job ${dir} has no outcome: reconcile it before spending again`)
  }
  const dir = join(JOBS_DIR, `${new Date().toISOString().replace(/[-:]|\.\d+/g, '')}-${name}-${randomBytes(4).toString('hex')}`)
  mkdirSync(dir, {mode: 0o700})
  // 'wx': each record is written once and never replaced.
  const write = (file: string, value: unknown) => writeFileSync(join(dir, file),
    typeof value === 'string' ? value : JSON.stringify(value, (_, v: unknown) => typeof v === 'bigint' ? v.toString() : v, 2),
    {flag: 'wx', mode: 0o600})
  return {dir, write, mark: file => write(file, new Date().toISOString() + '\n')}
}
/** A definite refusal: nothing more was sent, and the job records it. */
class Refused extends Error {
  constructor(readonly by: 'sdk' | 'verifiers', message: string) { super(message) }
}
/** The outcome is unknown: the job stays open and nothing is sent again. */
class Unknown extends Error {}
const unknown = (job: Job, what: string) => new Unknown(`job ${job.dir}: ${what}; its outcome is unknown and nothing is sent again`)
/** Stop the suite on an unknown or failed job. Never retried: the journal is the reconciliation record. */
function stop(label: string, e: unknown): never {
  s.ok(`${label}: job reached a known outcome`, false, (e as Error).message ?? String(e))
  s.done()
  process.exit(1)
}

const deployment = {chainId: cfg.chainId, settlement: book.Settlement, keyRegistry: book.KeyRegistry,
  verifierSet: book.VerifierSetRegistry, accountantSet: book.AccountantSetRegistry, beacon: book.ThresholdRandomBeacon,
  defaultVerificationPolicy: settings.defaultVerificationPolicy}
const transport = createNodePaidAgentTransport(settings.transportPolicy)
// The creator is the slot's dedicated reservation gas payer, on a wallet that never retries a
// send: an uncertain reservation is reconciled from its journal, never replaced.
const gasWallet = createWalletClient({account: creator, chain: writer.wallet.chain,
  transport: http(cfg.rpcUrl, {retryCount: 0, timeout: 15_000, fetchOptions: {redirect: 'error'}})})

/** Reserve TASRA for one signature of `message` and present `token`; returns the verified grant. */
async function authorize(name: string, message: Uint8Array, token: {key: DpopKey; accessToken: string}) {
  const job = newJob(name)
  job.write('agent-profile.json', settings.profile)
  // Before the reservation nothing is spent: a failure here closes the job as not reserved.
  const prepare = async () => {
    const context = await waitForPaidSnapshot(() => discoverPaidOperationContext(chain.client, deployment, slotId,
      {allowLocalHttp: true, defaultVerificationPolicy: deployment.defaultVerificationPolicy}),
    AbortSignal.timeout(180_000), () => sleep(1000))
    if (context.creator.toLowerCase() !== creator.address.toLowerCase()) throw new Error('slot creator differs from this suite\'s creator')
    // The creator signs the operation and a payment intent capped at MAX_TASRA_UNITS.
    const built = presentationOperationTypedData({chainId: cfg.chainId, keyRegistry: deployment.keyRegistry, slotId,
      action: 'sign', message, description: `Rego slot e2e ${name}`, ttlSecs: OPERATION_SECS})
    const operationSig = await creator.signTypedData(built.typedData)
    const random = toHex(randomBytes(32))
    const unsigned = {...context.intentFields, action: 'sign' as const, payload_digest: toHex(built.payloadDigest),
      session_commitment: paymentSessionCommitment(random, settings.profile.clientId, built.operation.exp),
      nonce: toHex(randomBytes(32)), max_cost: MAX_TASRA_UNITS.toString(), expires: built.operation.exp}
    const payment: PaymentIntentWire = {...unsigned, signature: await creator.signTypedData(paymentIntentTypedData(unsigned))}
    job.write('operation.json', {operation: built.operation, operationSig, messageHex: built.messageHex, random, payment, coordinator: context.coordinator})
    const {witnesses} = await fetchDrawnVerifierWitnesses(settings.accountantUrls, payment, deployment.verifierSet, {waitForPublicationMs: 150_000})
    return {context, built, operationSig, random, payment, witnesses}
  }
  const {context, built, operationSig, random, payment, witnesses} = await prepare().catch((e: Error) => {
    job.write('outcome', `nothing reserved: ${e.message}\n`)
    throw e
  })
  const expected = {slot: slotId, action: payment.action, payloadDigest: payment.payload_digest}
  // The reservation: one transaction with the caps above. Each checkpoint is journaled before
  // the step it guards; the prepared record exists before anything is sent.
  try {
    await withDedicatedPayer(`${cfg.chainId}-${creator.address.toLowerCase()}`, () => reservePaidOperation(chain.client, gasWallet, deployment, payment, expected, {
      accountantUrls: settings.accountantUrls, allowLocalHttp: true, maxGas: MAX_GAS, maxGasPrice: MAX_FEE_PER_GAS,
      persist: async checkpoint => job.write(`reservation-${checkpoint.phase}.json`, checkpoint)}))
  } catch (e) {
    if (!existsSync(join(job.dir, 'reservation-prepared.json'))) {
      job.write('outcome', `nothing reserved: ${(e as Error).message}\n`)
      throw e
    }
    throw unknown(job, `the reservation was sent (${(e as Error).message})`)
  }
  try {
    // The execution client: a key the creator certifies for this one operation.
    const seed = randomBytes(32), signer = createLocalExecutionSigner(seed)
    const {policy} = await readClientExecutionPolicy(chain.client, deployment, payment, expected)
    const certificate = await createExecutionCertificate({payment, policy, publicKey: signer.publicKey, expires: payment.expires, creator})
    const pollSecret = toHex(randomBytes(32)).slice(2)
    job.write('execution-client.json', {certificate, seed: toHex(seed), pollSecret})
    seed.fill(0)
    // The slot's rule is the kk_oauth envelope: its token hash binds the raw provisioned bytes.
    const session = await prepareRegisteredPaidSession(chain, {profile: settings.profile, deployment, transport, members: witnesses,
      ruleHash: keccak256(toHex(created.rule)), dcqlQuery: JSON.parse(created.rule) as Record<string, unknown>},
    {operation: built.operation, operationSig, messageHex: built.messageHex, payment, random, kind: 'oauth'},
    {certificate, signer, pollSecret})
    job.write('session.json', {sessionId: session.sessionId, paymentHash: session.paymentHash})
    // The registered session: created once.
    job.mark('create.attempted')
    await session.create()
    let approved: ClientApprovedPresentation
    try {
      approved = await session.prepareOAuthPresentation(token.accessToken, token.key.signer)
    } catch (e) {
      // The SDK refused the token before sending it: no presentation left this machine.
      job.write('refusal', (e as Error).message)
      throw new Refused('sdk', (e as Error).message)
    }
    // The token and its proof are kept before they are sent, once.
    job.write('presentation.json', approved)
    await session.submitOAuthPresentation(approved)
    const status = await awaitVerifiers(job, session, witnesses, approved)
    const grant = verifierAgentResult({sessionId: session.sessionId, paymentHash: paymentIntentHash(payment),
      requestHash: requestHash(cfg.chainId, hexToBytes(slotId), 'sign', built.payloadDigest)}, status)
    // The sealed evidence ciphertext stays in the job, next to the grant that binds it.
    job.write('grant.json', {compound_token: grant.token, verifier_proofs: status.verifierProofs, evidence_ct: grant.evidenceCt})
    return {job, grant, payment, expected, certificate, signer, witnesses, coordinator: context.coordinator}
  } catch (e) {
    if (e instanceof Refused) {
      job.write('outcome', 'refused\n')
      throw e
    }
    throw unknown(job, `the session did not finish (${(e as Error).message})`)
  }
}

/** Approve each drawn verifier's work on the kept presentation until the session ends. */
async function awaitVerifiers(job: Job, session: RegisteredPaidAgentSession, members: PaidVerifierWitness[],
  approved: ClientApprovedPresentation) {
  const deadline = Date.now() + POLL_TIMEOUT_MS, approvedStages = new Set<number>()
  const same = (a: unknown) => executionBodyHash(a as Record<string, unknown>) === executionBodyHash(approved as unknown as Record<string, unknown>)
  let callback: string | undefined, resumes = 0
  const check = async () => {
    const status = await session.poll()
    if (status.status === 'failed') {
      job.write('refusal', status.error ?? 'the verifiers refused')
      throw new Refused('verifiers', status.error ?? 'the verifiers refused')
    }
    return status
  }
  const resume = async () => {
    job.mark(`resume-${++resumes}.attempted`)
    try { await session.resumePresentation(callback!, approved) } catch (e) {
      // HTTP 425: the agent waits for this client to approve each verifier's work.
      if (e instanceof PaidAgentControlError && e.httpStatus === 425) return
      // A refused continuation: the session's own state says whether the verifiers refused.
      if (e instanceof PaidAgentControlError && (e.httpStatus === 400 || e.httpStatus === 409)) await check()
      throw e
    }
  }
  for (;;) {
    const status = await check()
    if (status.status === 'done') return status
    if (!callback) {
      callback = (await session.presentations()).find(p => same(p.presentation))?.id
      if (callback) await resume()
    }
    if (callback) {
      let approvals = 0
      for (const proposal of await session.proposals()) {
        const member = members.find(m => m.publicKey.toLowerCase() === proposal.operator_key.toLowerCase())
        if (proposal.stage !== 'credential' || !member) throw new Error('the agent proposed work outside the anchored draw')
        if (approvedStages.has(member.index)) continue
        approvedStages.add(member.index)
        job.write(`approval-${member.index}.json`, {proposal: proposal.id, operator: member.operator})
        await session.approveCredentials(proposal, member, approved)
        approvals++
      }
      if (approvals) await resume()
    }
    if (Date.now() >= deadline) throw new Error(`no answer from the verifiers after ${POLL_TIMEOUT_MS / 1000}s`)
    await sleep(1000)
  }
}

const message = new TextEncoder().encode(`rego-slot e2e ${Date.now()}`)

// alice: holds the role.
const alice = await dpopToken(allowed)
const aliceLocal = await localVerdict(alice.accessToken)
s.ok(`local engine allows ${allowed.name} (her token's claims)`, aliceLocal.allow, JSON.stringify(aliceLocal))
const authorized = await authorize('allowed', message, alice).catch((e: unknown) => stop(`${allowed.name}: paid authorization`, e))
const {job, grant, payment} = authorized
s.ok(`${allowed.name}: paid job reserved within 0.001 TASRA, 2M gas and 100 gwei (job ${job.dir})`,
  BigInt(payment.max_cost) === MAX_TASRA_UNITS && existsSync(join(job.dir, 'reservation-confirmed.json')))
s.eq(`${allowed.name}: committee declares holder_key binding for the DPoP-verified token`, (grant.token as unknown as {binding?: string}).binding, 'holder_key')
// The keeper refuses an evidenced token without its ciphertext: the sealed evidence must be
// present and verify under the anchored drawn verifier keys BEFORE anything reaches a keeper.
const evidencePresent = typeof grant.evidenceCt === 'string' && grant.evidenceCt.length > 0 && typeof grant.token.evidence_hash === 'string'
let evidenceDetail = 'no sealed evidence beside the token'
let evidenceVerified = false
if (evidencePresent) {
  try {
    verifyEvidenceBinding(grant.token, grant.evidenceCt, compoundTokenHash(decodeCompoundToken(grant.token)),
      new Map(authorized.witnesses.map(w => [w.index, hexToBytes(w.publicKey)])), payment.verification_quorum)
    evidenceVerified = true
  } catch (e) { evidenceDetail = (e as Error).message }
}
s.ok(`${allowed.name}: sealed evidence present beside the token`, evidencePresent, evidenceDetail)
if (!s.ok(`${allowed.name}: sealed evidence verifies under the anchored drawn verifier quorum`, evidenceVerified, evidenceDetail)) {
  job.write('outcome', `not sent to a keeper: ${evidenceDetail}\n`)
  s.done(); process.exit(1)
}
const approveExecution = createKeeperExecutionApprover({client: chain.client, deployment, payment, expected: authorized.expected,
  certificate: authorized.certificate, signer: authorized.signer, keeperUrl: settings.keeperUrl, transportPolicy: {allowLocalHttp: true}})
// One request to the coordinator keeper the payment names; never repeated.
job.mark('sign.attempted')
const signed = await committeeSign({nodeUrl: settings.keeperUrl(authorized.coordinator.url), committeeToken: grant.token, message,
  verifierProofs: grant.verifierProofs, evidenceCt: grant.evidenceCt, approveExecution})
  .catch((e: unknown) => stop(`${allowed.name}: keeper sign`, unknown(job, `the signing request was sent (${(e as Error).message})`)))
const signature = new Uint8Array([...signed.signature.r, ...signed.signature.z])
job.write('signature.json', {r: toHex(signed.signature.r), z: toHex(signed.signature.z)})
job.write('outcome', 'signed\n')
s.ok(`${allowed.name}: keeper produced a FROST signature that verifies under the slot's group key`,
  ed25519.verify(signature, message, hexToBytes(groupKey)))
s.ok(`${allowed.name}: local verdict agrees with the fleet (allow / allow)`, aliceLocal.allow)

// bob: authenticates, lacks the role.
const bob = await dpopToken(refused)
const bobLocal = await localVerdict(bob.accessToken)
s.ok(`local engine refuses ${refused.name} with the generic policy refusal`, !bobLocal.allow && bobLocal.kind === 'reject' && bobLocal.message === REGO_POLICY_REFUSED, JSON.stringify(bobLocal))
const fleet = await authorize('refused', message, bob).then(r => r, (e: unknown) => {
  if (e instanceof Refused) return e
  return stop(`${refused.name}: paid authorization`, e)
})
if (!(fleet instanceof Refused)) {
  fleet.job.write('outcome', 'authorized, not refused\n')
  s.ok(`${refused.name}: refused by the deployment`, false, `job ${fleet.job.dir} was granted`)
  s.done(); process.exit(1)
}
const refusal = fleet.message
s.info(`deployment answered: ${refusal}`)
s.ok(`${refused.name}: refused by the drawn verifiers as a session refusal`, fleet.by === 'verifiers', refusal)
s.ok(`${refused.name}: the refusal is the policy's ('${REGO_POLICY_REFUSED}')`, refusal.includes(REGO_POLICY_REFUSED), refusal)
s.ok(`${refused.name}: the refusal names nothing from the rule`, !ROLE_CLAIM_LEAKS.test(refusal), refusal)
s.ok(`${refused.name}: local verdict agrees with the fleet (reject / reject)`, !bobLocal.allow)
s.done()
