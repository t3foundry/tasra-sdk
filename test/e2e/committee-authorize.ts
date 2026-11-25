// Real wallet quorum grants with anchored membership proofs. A targeted sealed
// contribution refuses a sub-quorum token; a separate original client combines
// authenticated contributions only after full-quorum authorization.
import {Suite, bytesEq} from '../fleet/_assert.ts'
import {gate, loadFleetConfig} from '../fleet/_fleet.ts'
import {authorizeWallet, createWalletSlot} from '../fleet/_wallet.ts'
import {walletBlsSharing} from '../fleet/_wallet-settings.ts'
import {createDecryptionRecipient, decryptionBinding, kemContentDigest} from '../../src/crypto/recipient.ts'
import {encryptEnvelope} from '../../src/crypto/envelope.ts'
import {hexToBytes} from '../../src/crypto/hex.ts'
import {evidenceBody} from '../../src/committee/evidence.ts'
import {decryptWithCommitteePartials} from '../../src/decryption/sealed.ts'

const cfg = loadFleetConfig(), s = new Suite('e2e: wallet committee quorum authorization')
if (!(await gate(s, cfg))) {s.done(); process.exit(1)}
const slot = await createWalletSlot(cfg, 'bls')
const identity = 'committee-wallet-cert', identityBytes = new TextEncoder().encode(identity)
const plaintext = new TextEncoder().encode('quorum-authorized ciphertext')
const sharing = await walletBlsSharing(cfg, slot.slotId)
s.ok('signed sharing matches the original slot group key', bytesEq(sharing.groupPublicKey, hexToBytes(slot.publicKey).slice(0, 96)))
const env = encryptEnvelope(hexToBytes(slot.slotId), sharing.groupPublicKey, identityBytes, plaintext, BigInt(sharing.epoch))
const content = kemContentDigest(env.ciphertext, identityBytes)
const negativeRecipient = await createDecryptionRecipient()
const grant = await authorizeWallet(cfg, slot.slotId, slot.creatorKey,
  {action: 'decrypt', ...decryptionBinding(content, sharing.epoch, negativeRecipient)})
{
  s.ok('grant includes a verifier quorum and anchored membership proofs', grant.compound_token.signatures.length >= 2 && grant.verifier_proofs.length >= 2)
  const b64 = (value: Uint8Array) => Buffer.from(value).toString('base64')
  const body = {committee_token: {...grant.compound_token, signatures: grant.compound_token.signatures.slice(0, 1)},
    verifier_proofs: grant.verifier_proofs, ...evidenceBody(grant.compound_token, grant.evidenceCt), identity,
    recipient: negativeRecipient.recipient, ciphertext_epoch: sharing.epoch,
    ciphertext: {u: b64(env.ciphertext.u), nonce: b64(env.ciphertext.nonce), aead_ct: b64(env.ciphertext.aeadCt)}}
  const denied = await fetch(grant.coordinatorUrl + '/v1/committee/decrypt/partial', {method: 'POST',
    headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000), redirect: 'error', credentials: 'omit'})
  const reason = await denied.text()
  s.ok('sub-quorum token denied for its missing quorum', denied.status === 403 && /quorum|signature/i.test(reason), reason)
}
// Success uses a separate wallet authorization and its own original recipient.
const recipient = await createDecryptionRecipient()
const accepted = await authorizeWallet(cfg, slot.slotId, slot.creatorKey,
  {action: 'decrypt', ...decryptionBinding(content, sharing.epoch, recipient)})
{
  const result = await decryptWithCommitteePartials({nodeUrls: sharing.nodeUrls, chainId: 43112,
    recipient, verifyingShares: sharing.verifyingShares, threshold: sharing.threshold,
    committeeToken: accepted.compound_token, verifierProofs: accepted.verifierProofs,
    evidenceCt: accepted.evidenceCt,
    ciphertext: env.ciphertext, identity: identityBytes, ciphertextEpoch: sharing.epoch})
  try {s.ok('full quorum accepted by the keepers', true); s.ok('client threshold decrypt recovered the exact plaintext', bytesEq(result, plaintext))}
  finally {result.fill(0)}
}
s.done()
