/** Encrypt a private note; only Alice's credential may unlock it. */
import {randomUUID, webcrypto as nodeWebCrypto} from 'node:crypto'
import {sha256} from '@noble/hashes/sha256'
import {utf8ToBytes} from '@noble/hashes/utils'
import {decryptPayloadDigest} from 'tasra-sdk/oid4vp'
import type {ReadySlotJournal} from 'tasra-sdk/app'
import {createTutorial} from './tutorial-support.js'

async function main() {
  // 1. Connect from the public manifest and create fresh identities with the SDK.
  const {tasra, awaitUsageCredit, issuer, users, policy, authorize, proveServerRefusal, directory, save, store} =
    await createTutorial('encrypted-notes', 'DocumentReader', 'document-reader')
  const recordId = randomUUID()
  const aad = sha256(utf8ToBytes(`tasra-encrypt/v2:${recordId}`))
  for (const user of Object.values(users)) {
    user.credential = tasra.credentials.issue({issuer, holder: user.identity, type: 'DocumentReader',
      claims: {role: 'document-reader', documents: [recordId]}})
  }
  await store.save('credentials', Object.fromEntries(Object.entries(users).map(([name, user]) => [name, user.credential])))

  // 2. Commit Alice's document-scoped policy; the SDK creates and provisions a ready slot.
  const notes = await tasra.slots.create({name: 'private-notes', mode: 'bls',
    policy: policy(['alice'], {claim: 'documents'}), threshold: {k: 2, n: 3},
    verifiers: {committee: 3, quorum: 2}})
  await awaitUsageCredit(notes.slotId)

  // 3. Generate an AES-256 data key, encrypt the payload, and wrap the key with the BLS KEM.
  const plaintext = new TextEncoder().encode('A synthetic private note')
  const dataKey = nodeWebCrypto.getRandomValues(new Uint8Array(32))
  const iv = nodeWebCrypto.getRandomValues(new Uint8Array(12))
  const aesKey = await nodeWebCrypto.subtle.importKey('raw', dataKey, 'AES-GCM', false, ['encrypt'])
  const aesCt = new Uint8Array(await nodeWebCrypto.subtle.encrypt(
    {name: 'AES-GCM', iv, additionalData: aad}, aesKey, plaintext))
  const kemCt = await notes.encrypt(aad, dataKey)
  dataKey.fill(0)
  await store.save('encrypted-document', {recordId, aad, kemCt, aesCt, iv})

  // Alice presents her credential to authorize decryption.
  const opened = await notes.decrypt(aad, kemCt, {authorize: authorize('alice'),
    signal: AbortSignal.timeout(120_000), requireReceipts: true})
  let openedNote: Uint8Array | undefined
  try {
    const decryptKey = await nodeWebCrypto.subtle.importKey('raw', opened.plaintext, 'AES-GCM', false, ['decrypt'])
    const decrypted = new Uint8Array(await nodeWebCrypto.subtle.decrypt(
      {name: 'AES-GCM', iv, additionalData: aad}, decryptKey, aesCt))
    if (new TextDecoder().decode(decrypted) !== 'A synthetic private note') throw new Error('Decryption differs')
    openedNote = decrypted
  } finally { opened.plaintext.fill(0) }

  // 4. Test server refusal separately from ciphertext authentication, with a positive control.
  const refusal = await proveServerRefusal(notes.slotId, 'bob', 'decrypt',
    {payloadDigest: decryptPayloadDigest(kemCt.u, kemCt.aeadCt)})
  let tamperRejected = false
  try {
    // Positive control: the main decrypt (step 3) already authenticated the original ct.
    const tamperedAead = kemCt.aeadCt.slice() as Uint8Array
    tamperedAead[0]! ^= 1
    const tampered = {u: kemCt.u.slice(), nonce: kemCt.nonce.slice(), aeadCt: tamperedAead}
    const bad = await notes.decrypt(aad, tampered, {authorize: authorize('alice'),
      signal: AbortSignal.timeout(120_000), requireReceipts: true})
    bad.plaintext.fill(0) // unreachable; throw before zeroizing
  } catch (error) {
    if (error instanceof Error && /authentication|invalid tag/i.test(error.message)) tamperRejected = true
    else throw error
  }
  if (!tamperRejected) throw new Error('Tampered ciphertext was accepted')
  try { openedNote?.fill(0); plaintext.fill(0) } catch { /* best-effort */ }

  // Evidence exposes transaction and receipt references, never the private creation journal.
  const journal = await store.load<ReadySlotJournal>('slot-private-notes')
  if (!journal?.creation.result) throw new Error('Missing creation evidence')
  const {commitTx, revealTx, targetEpoch, seeded} = journal.creation.result
  save('evidence.json', {chainId: tasra.deployment.chainId, addresses: tasra.deployment.addresses,
    slotId: notes.slotId, creation: {slotId: notes.slotId, commitTx, revealTx, targetEpoch, seeded},
    createdAt: new Date().toISOString(), alice: 'decrypted', bob: refusal, tamperRejected,
    shareTrust: opened.shareTrust, receipts: opened.evidence.map(e => ({operator: e.operator, identifier: e.identifier,
      status: e.receiptStatus}))})
  console.log(`PASS: Alice decrypted, Bob refused by verifier, tamper rejected. Evidence: ${directory}/evidence.json`)
}

main().catch((error: unknown) => {
  // Keep credential-bearing error objects out of terminal output.
  const message = (error instanceof Error ? error.message : String(error)).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+(?:~[\w.-]*)*/g, '[credential omitted]')
  console.error(`Stopped: ${message}`)
  process.exitCode = 1
})