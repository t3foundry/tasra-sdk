// LIVE, ISOLATED LOCAL FLEET ONLY (chain 43112): an unpaid decrypt session end to end.
//
// A slot owner creates and funds a BLS slot. A READER, with a key that is not the creator's, opens
// ONE decrypt session through the SDK's `openDecryptSession` (one wallet presentation in session
// mode), then decrypts many messages in it with no further presentation: single requests and a
// batch. Nothing is paid, reserved or signed by the creator. Then it checks:
//   - every plaintext is the original;
//   - the grant was verified against the slot's draw as anchored on chain (the SDK refuses it
//     otherwise) and names the reader's own session key;
//   - a slot the session does not name is refused locally;
//   - after `revoke()` the session serves nothing.
//
// Run by hand with the KK_WALLET_* configuration test/verify/bringup.ts writes, against a fleet
// started for this purpose. Never point it at a shared, Fuji or production deployment:
//   npx tsx test/live/sessionDecrypt.ts
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {mkdtempSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {generatePrivateKey, privateKeyToAccount} from 'viem/accounts'
import {createTasra} from '../../src/app/client.ts'
import {createFileStore} from '../../src/app/node.ts'
import {openDecryptSession} from '../../src/app/session-open.ts'
import {SessionEndedError} from '../../src/app/session-grants.ts'
import {createTasraChainClient} from '../../src/chain/client.ts'
import {createNodeAgentTransport} from '../../src/chain/node.ts'
import {encryptEnvelope} from '../../src/crypto/envelope.ts'
import {hexToBytes} from '../../src/crypto/hex.ts'
import {loadFleetConfig} from '../fleet/_fleet.ts'
import {walletBlsSharing, walletSettings} from '../fleet/_wallet-settings.ts'
import {createWalletSlot, issueWallet, presentWallet} from '../fleet/_wallet.ts'

const cfg = loadFleetConfig()
assert.equal(cfg.chainId, 43112, 'The session gate runs only on an isolated local fleet (chain 43112)')
const settings = walletSettings(cfg)
cfg.nodeUrls = settings.keeperUrls
const t0 = Date.now(), step = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`)

// ---- owner side: create, provision and fund the slot ----
const slot = await createWalletSlot(cfg, 'bls', 2, 3)
const sharing = await walletBlsSharing(cfg, slot.slotId)
const identity = new TextEncoder().encode('session-decrypt-gate')
const messages = Array.from({length: 6}, () => {
  const plaintext = randomBytes(32)
  return {plaintext, ciphertext: encryptEnvelope(hexToBytes(slot.slotId), sharing.groupPublicKey, identity, plaintext, BigInt(sharing.epoch)).ciphertext, identity}
})
step(`owner created and funded BLS slot ${slot.slotId}; ${messages.length} messages encrypted`)

// ---- reader side: its own key, store and credential; nothing owner-held ----
const reader = privateKeyToAccount(generatePrivateKey())
assert.notEqual(reader.address.toLowerCase(), privateKeyToAccount(slot.creatorKey).address.toLowerCase())
const chain = createTasraChainClient({rpcUrl: cfg.rpcUrl, addresses: cfg.book, chainId: 43112, multicall3: false})
const app = createTasra({chain, keeperUrl: settings.keeperUrl,
  deployment: {schemaVersion: 1, name: 'local-session-gate', chainId: 43112, rpcUrl: cfg.rpcUrl, addresses: cfg.book, coordinator: 'assigned-first'}})
const wallet = issueWallet(cfg)
let presentations = 0
const session = await openDecryptSession({app, store: createFileStore(mkdtempSync(join(tmpdir(), 'tasra-session-reader-'))),
  agent: {profile: settings.profile, transport: createNodeAgentTransport(settings.transportPolicy)}, signer: reader,
  snapshotHosts: settings.accountantUrls, defaultVerificationPolicy: settings.defaultVerificationPolicy,
  keeperUrl: settings.keeperUrl, allowLocalHttp: true,
  present: async (opened, signal) => { presentations++; await presentWallet(cfg, opened, wallet, {...(signal ? {signal} : {})}) },
}, {slots: [slot.slotId], first: {slot: slot.slotId, ...messages[0]!}, description: 'Local session gate', signal: AbortSignal.timeout(240_000)})
step(`reader ${reader.address} opened session ${session.session.sessionId} with one presentation`)

try {
  for (const [index, message] of messages.slice(0, 3).entries()) {
    const plaintext = await session.decrypt(slot.slotId, message)
    assert.deepEqual(Buffer.from(plaintext), message.plaintext, `Message ${index} decrypted to another plaintext`)
  }
  const batch = await session.decryptMany(slot.slotId, messages.slice(3))
  assert.equal(batch.length, 3)
  for (const [index, result] of batch.entries()) {
    assert(result.ok, `Batch message ${index} was refused: ${result.ok ? '' : result.error}`)
    assert.deepEqual(Buffer.from(result.plaintext), messages[3 + index]!.plaintext, `Batch message ${index} decrypted to another plaintext`)
  }
  assert.equal(presentations, 1, 'Every message after the opening must be served without another presentation')
  step('3 single decrypts and a batch of 3 served under the grant; one presentation in total')
  await assert.rejects(session.decrypt(`0x${'ab'.repeat(32)}`, messages[0]!), /not named by this session/)
} finally {
  await session.revoke()
}
await assert.rejects(session.decrypt(slot.slotId, messages[0]!), (error: unknown) => error instanceof SessionEndedError)
step('revoked: the session serves nothing more')
console.log('sessionDecrypt live gate: OK')
