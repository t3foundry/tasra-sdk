// LIVE, ISOLATED LOCAL FLEET ONLY (chain 43112): customer authorization bootstrap end to end.
//
// Two parties with separate private stores. The CREATOR side (the party that keeps the rule and
// its salt, for example a control plane's isolated signer) creates and funds a FROST slot, then
// issues a slot policy bootstrap to one holder application key: no salt leaves it. The HOLDER
// APPLICATION never sees the salt. It runs paidPolicyOperation with the bootstrap, a remote
// creator signer (an EIP-712 callback into the creator side that sees typed data only, never a
// credential or the message bytes) and its own gas payer and store, and signs directly against
// the keepers. Then it checks:
//   - the holder store holds no salt;
//   - a second call with the same operation key, after the bootstrap's own lifetime, returns the
//     original operation (same request ID, no second reservation) and its execution stays refused;
//   - a substituted rule, another audience and an older sequence are refused before any spending.
//
// Run by hand with the same KK_PREPAID_* configuration as verifierAgentWallet.ts, against a fleet
// started for this purpose. Never point it at a shared, Fuji or production deployment:
//   npx tsx test/live/policyBootstrap.ts
import assert from 'node:assert/strict'
import {mkdtempSync, readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createWalletClient, http, type Hex} from 'viem'
import {generatePrivateKey, privateKeyToAccount} from 'viem/accounts'
import {createFileStore} from '../../src/app/node.ts'
import {issueSlotPolicyBootstrap, SlotPolicyError} from '../../src/app/policy-bootstrap.ts'
import {paidPolicyOperation, readPolicyOperation} from '../../src/app/policy-operation.ts'
import {createTasraChainClient} from '../../src/chain/client.ts'
import {createTasraWriteClient} from '../../src/chain/write.ts'
import {createNodeAgentWalletFetch, createNodePaidAgentTransport} from '../../src/chain/node.ts'
import type {PaidContextDeployment} from '../../src/chain/prepaid.ts'
import {committeeSign} from '../../src/committee/client.js'
import {verify as verifyFrostSignature} from '../../src/crypto/frost.js'
import {buildResponse, parseSdJwt, planPresentation, submitResponse, utf8} from '../../src/oid4vp/index.js'
import type {VerifiedRequestObject} from '../../src/oid4vp/request-object.ts'
import {loadFleetConfig} from '../fleet/_fleet.ts'
import {paidWalletSettings} from '../fleet/_paid-wallet.ts'
import {createWalletSlot, issueWallet, WALLET_RULE} from '../fleet/_wallet.ts'

const cfg = loadFleetConfig()
assert.equal(cfg.chainId, 43112, 'The bootstrap gate runs only on an isolated local fleet (chain 43112)')
const settings = paidWalletSettings(cfg)
cfg.nodeUrls = settings.keeperUrls
assert(cfg.book.Settlement && cfg.book.KeyRegistry && cfg.book.VerifierSetRegistry && cfg.book.AccountantSetRegistry && cfg.book.ThresholdRandomBeacon)
const t0 = Date.now(), step = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`)

// ---- creator side: create, fund, provision, then issue the bootstrap ----
const slot = await createWalletSlot(cfg, 'frost', 2, 3, WALLET_RULE)
const creator = privateKeyToAccount(slot.creatorKey)
const chain = createTasraChainClient({rpcUrl: cfg.rpcUrl, addresses: cfg.book, chainId: 43112, multicall3: false})
const app = privateKeyToAccount(generatePrivateKey())
const bootstrap = await issueSlotPolicyBootstrap(chain, {signer: creator, slot: slot.slotId, rule: WALLET_RULE, salt: slot.ruleSalt,
  audience: app.address, actions: ['sign'], sequence: 2, ttlSecs: 120})
assert(!JSON.stringify(bootstrap).toLowerCase().includes(slot.ruleSalt.slice(2).toLowerCase()), 'The bootstrap must not carry the salt')
step(`creator issued sequence ${bootstrap.statement.sequence} for slot ${slot.slotId} to ${app.address}`)
const signed: string[] = []
// The remote creator signer: typed data in, signature out. A real one checks the holder
// application and its scope before signing.
const remoteCreator = {address: creator.address, signTypedData: (async (typed: Parameters<typeof creator.signTypedData>[0]) => {
  signed.push(String(typed.primaryType))
  return creator.signTypedData(typed)
}) as typeof creator.signTypedData}

// ---- holder application side: its own store, gas payer and wallet; no salt ----
const holderDir = mkdtempSync(join(tmpdir(), 'tasra-holder-app-'))
const store = createFileStore(holderDir)
const funder = createTasraWriteClient({rpcUrl: cfg.rpcUrl, addresses: cfg.book, privateKey: cfg.deployPk as Hex, chainId: 43112})
const payerKey = generatePrivateKey(), payer = privateKeyToAccount(payerKey)
await funder.sendEth(payer.address, 10n ** 18n)
const gasPayer = createWalletClient({account: payer, chain: funder.wallet.chain, transport: http(cfg.rpcUrl, {retryCount: 0, timeout: 15_000, fetchOptions: {redirect: 'error'}})})
const deployment: PaidContextDeployment = {chainId: 43112, settlement: cfg.book.Settlement, keyRegistry: cfg.book.KeyRegistry,
  verifierSet: cfg.book.VerifierSetRegistry, accountantSet: cfg.book.AccountantSetRegistry, beacon: cfg.book.ThresholdRandomBeacon}
const config = {chain, deployment: {...deployment, defaultVerificationPolicy: settings.defaultVerificationPolicy}, creator: remoteCreator, gasPayer, store,
  agent: {profile: settings.profile, transport: createNodePaidAgentTransport(settings.transportPolicy)}, accountantUrls: settings.accountantUrls,
  limits: {maxCost: settings.maxCost, maxGas: settings.maxGas, maxGasPrice: settings.maxGasPrice}, allowLocalHttp: true, keeperUrl: settings.keeperUrl}
const wallet = issueWallet(cfg)
const fetcherFor = (request: VerifiedRequestObject) => {
  const sessionId = new URL(String(request.claims.response_uri)).searchParams.get('session') ?? ''
  return createNodeAgentWalletFetch({profile: settings.profile, requestUri: settings.profile.endpoint + '/v1/request/' + sessionId, sessionId}, settings.transportPolicy)
}
const holder = {kind: 'local' as const, makePresentation: (request: VerifiedRequestObject) => {
  const plan = planPresentation(request, [{sdJwt: wallet.sdJwt}]), parsed = parseSdJwt(wallet.sdJwt)
  assert(plan.chosen, 'Held credential does not answer the request')
  const iat = Math.floor(Date.now() / 1000), built = buildResponse({ro: request, candidate: plan.chosen, holder: wallet.holder, disclose: 'all', nowSecs: iat})
  assert(built.encrypted && built.form.response, 'Presentation must be encrypted')
  return {approved: {holder: typeof parsed.payload.sub === 'string' ? parsed.payload.sub : wallet.holder.did, credentials: [built.presentation], holder_proof: null, oauth: null, iat}, form: built.form}
}, submit: (request: VerifiedRequestObject, presentation: Parameters<typeof submitResponse>[1]) => submitResponse(request, presentation, fetcherFor(request)).then(() => {})}

const message = utf8('signed by a holder application that never held the rule salt')
const request = {slot: slot.slotId, operation: {action: 'sign' as const, message, ttlSecs: 600, description: 'Policy bootstrap gate'}, policy: bootstrap,
  audience: app.address, operationKey: 'policy-bootstrap-gate-1', holder}
const op = await paidPolicyOperation(config, request)
assert.deepEqual([...new Set(signed)].sort(), ['ClientExecutionCertificate', 'PresentationOperation', 'SlotAssignedPaymentIntent'].sort(), 'The remote creator signed only typed consent')
const sig = await op.execute(() => committeeSign({nodeUrl: op.coordinatorUrl, committeeToken: op.compound_token, message, verifierProofs: op.verifierProofs,
  evidenceCt: op.evidenceCt, approveExecution: op.approveExecution}))
assert(verifyFrostSignature(sig.groupPublicKey, message, sig.signature), 'Signature does not verify under the slot key')
op.dispose()
step(`signed directly against the keepers, request ${op.requestId}`)
for (const file of readdirSync(holderDir)) {
  assert(!readFileSync(join(holderDir, file), 'utf8').toLowerCase().includes(slot.ruleSalt.slice(2).toLowerCase()), `Holder store file ${file} holds the salt`)
}

// ---- recovery: the same key after the bootstrap expired returns the original operation ----
await new Promise(resolve => setTimeout(resolve, 125_000))
const again = await paidPolicyOperation(config, request)
assert.equal(again.requestId, op.requestId, 'The same operation key must resume the original operation')
await assert.rejects(again.execute(async () => 'second'), 'An executed operation never runs again')
again.dispose()
assert.deepEqual((await readPolicyOperation(config, {slot: slot.slotId, audience: app.address, operationKey: request.operationKey}))?.requestIds, [op.requestId])
step('the same operation key resumed the original journal entry; no second reservation')

// ---- refusals before any spending ----
const fresh = await issueSlotPolicyBootstrap(chain, {signer: creator, slot: slot.slotId, rule: WALLET_RULE, salt: slot.ruleSalt, audience: app.address, actions: ['sign'], sequence: 3})
const refusal = async (policy: typeof bootstrap, code: string, over: Record<string, unknown> = {}) => {
  const before = signed.length
  const e = await paidPolicyOperation(config, {...request, policy, operationKey: `policy-bootstrap-refusal-${code}`, ...over}).catch((err: unknown) => err)
  assert(e instanceof SlotPolicyError && e.code === code, `expected ${code}, got ${String(e)}`)
  assert.equal(signed.length, before, `${code}: the creator signed nothing`)
}
await refusal({...fresh, rule: WALLET_RULE.replace('Engineering', 'Finance')}, 'substituted-rule')
await refusal(fresh, 'wrong-audience', {audience: privateKeyToAccount(generatePrivateKey()).address})
const accepted = await paidPolicyOperation(config, {...request, policy: fresh, operationKey: 'policy-bootstrap-gate-2'})
accepted.dispose()
await refusal(await issueSlotPolicyBootstrap(chain, {signer: creator, slot: slot.slotId, rule: WALLET_RULE, salt: slot.ruleSalt, audience: app.address, actions: ['sign'], sequence: 1}), 'replayed')
console.log('policyBootstrap live gate: OK (operation 2 is authorized and left unexecuted; its reservation is closed unused by the accountants)')
