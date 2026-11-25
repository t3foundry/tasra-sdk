// LIVE, ISOLATED LOCAL FLEET ONLY (chain 43112): slot policy statements end to end.
//
// Two parties with separate private stores. The CREATOR side (the party that keeps the rule and
// its salt) creates and funds a FROST slot, then issues a slot policy bootstrap to one holder
// application key: no salt leaves it. The HOLDER APPLICATION never sees the salt and is NOT the
// slot's creator. It verifies the bootstrap offline, against its own slot read on chain and
// against its durable sequence mark, then opens a session with ITS OWN key (an open request: any
// key may open a session, the slot's rule decides) and signs directly against the keepers. The
// creator signs nothing for the operation. Then it checks:
//   - the holder store holds no salt;
//   - the committee token carries the rule hash the statement names;
//   - a substituted rule, another audience and an older sequence are refused before any session.
//
// Run by hand with the same KK_WALLET_* configuration as verifierAgentWallet.ts, against a fleet
// started for this purpose. Never point it at a shared, Fuji or production deployment:
//   npx tsx test/live/policyBootstrap.ts
import assert from 'node:assert/strict'
import {mkdtempSync, readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {generatePrivateKey, privateKeyToAccount} from 'viem/accounts'
import {createFileStore} from '../../src/app/node.ts'
import {admitSlotPolicySequence, issueSlotPolicyBootstrap, requireCurrentSlotPolicy, SlotPolicyError, verifySlotPolicyBootstrap,
  type SlotPolicyBootstrap} from '../../src/app/policy-bootstrap.ts'
import {createTasraChainClient} from '../../src/chain/client.ts'
import {committeeSign} from '../../src/committee/client.js'
import {verify as verifyFrostSignature} from '../../src/crypto/frost.js'
import {utf8} from '../../src/oid4vp/index.js'
import {loadFleetConfig} from '../fleet/_fleet.ts'
import {walletSettings} from '../fleet/_wallet-settings.ts'
import {authorizeWallet, createWalletSlot, issueWallet, WALLET_RULE} from '../fleet/_wallet.ts'

const cfg = loadFleetConfig()
assert.equal(cfg.chainId, 43112, 'The bootstrap gate runs only on an isolated local fleet (chain 43112)')
const settings = walletSettings(cfg)
cfg.nodeUrls = settings.keeperUrls
assert(cfg.book.KeyRegistry, 'KeyRegistry deployment missing')
const keyRegistry = cfg.book.KeyRegistry
const t0 = Date.now(), step = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`)

// ---- creator side: create, fund, provision, then issue the bootstrap ----
const slot = await createWalletSlot(cfg, 'frost', 2, 3, WALLET_RULE)
const creator = privateKeyToAccount(slot.creatorKey)
const chain = createTasraChainClient({rpcUrl: cfg.rpcUrl, addresses: cfg.book, chainId: 43112, multicall3: false})
const appKey = generatePrivateKey(), app = privateKeyToAccount(appKey)
assert.notEqual(app.address.toLowerCase(), creator.address.toLowerCase())
const bootstrap = await issueSlotPolicyBootstrap(chain, {signer: creator, slot: slot.slotId, rule: WALLET_RULE, salt: slot.ruleSalt,
  audience: app.address, actions: ['sign'], sequence: 2, ttlSecs: 120})
assert(!JSON.stringify(bootstrap).toLowerCase().includes(slot.ruleSalt.slice(2).toLowerCase()), 'The bootstrap must not carry the salt')
step(`creator issued sequence ${bootstrap.statement.sequence} for slot ${slot.slotId} to ${app.address}`)

// ---- holder application side: its own store and key; no salt, not the creator ----
const holderDir = mkdtempSync(join(tmpdir(), 'tasra-holder-app-'))
const store = createFileStore(holderDir)
/** The holder application's complete acceptance of one statement: offline, on chain, then its sequence mark. */
async function accept(policy: SlotPolicyBootstrap, audience = app.address) {
  const verified = await verifySlotPolicyBootstrap(policy, {chainId: 43112, keyRegistry, slot: slot.slotId, audience, action: 'sign'})
  const canonical = await chain.readers.keyRegistry.getKeySlot(slot.slotId)
  requireCurrentSlotPolicy(verified.bootstrap.statement, verified.signer,
    {creator: canonical.creator, ruleCommitment: canonical.ruleCommitment, ruleVersion: Number(canonical.ruleVersion)})
  await admitSlotPolicySequence(store, verified.bootstrap.statement)
  return verified.bootstrap
}
const accepted = await accept(bootstrap)
step('holder application verified the statement offline, on chain and against its sequence mark')

const message = utf8('signed by a holder application that never held the rule salt')
// The session is opened by the application's own key: the creator signs nothing for it.
const grant = await authorizeWallet(cfg, slot.slotId, appKey, {action: 'sign', message}, issueWallet(cfg))
assert.equal(grant.compound_token.rule_hash.toLowerCase(), accepted.statement.ruleHash.toLowerCase(),
  'The committee judged another rule than the statement names')
const sig = await committeeSign({nodeUrl: grant.coordinatorUrl, committeeToken: grant.compound_token, message, verifierProofs: grant.verifierProofs,
  evidenceCt: grant.evidenceCt, targetKeykeeper: grant.coordinator})
assert(verifyFrostSignature(sig.groupPublicKey, message, sig.signature), 'Signature does not verify under the slot key')
step('a non-creator key opened the session and signed directly against the keepers')
for (const file of readdirSync(holderDir)) {
  assert(!readFileSync(join(holderDir, file), 'utf8').toLowerCase().includes(slot.ruleSalt.slice(2).toLowerCase()), `Holder store file ${file} holds the salt`)
}

// ---- refusals before any session ----
const fresh = await issueSlotPolicyBootstrap(chain, {signer: creator, slot: slot.slotId, rule: WALLET_RULE, salt: slot.ruleSalt, audience: app.address, actions: ['sign'], sequence: 3})
const refusal = async (policy: SlotPolicyBootstrap, code: string, audience = app.address) => {
  const e = await accept(policy, audience).catch((err: unknown) => err)
  assert(e instanceof SlotPolicyError && e.code === code, `expected ${code}, got ${String(e)}`)
}
await refusal({...fresh, rule: WALLET_RULE.replace('Engineering', 'Finance')}, 'substituted-rule')
await refusal(fresh, 'wrong-audience', privateKeyToAccount(generatePrivateKey()).address)
await accept(fresh)
await refusal(await issueSlotPolicyBootstrap(chain, {signer: creator, slot: slot.slotId, rule: WALLET_RULE, salt: slot.ruleSalt, audience: app.address, actions: ['sign'], sequence: 1}), 'replayed')
console.log('policyBootstrap live gate: OK')
