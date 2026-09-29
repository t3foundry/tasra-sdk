/** Encrypt a private note; only Alice's credential may unlock it. */
import {randomUUID} from 'node:crypto'
import {ibeDecryptWithKey} from 'tasra-sdk'
import type {ReadySlotJournal} from 'tasra-sdk/app'
import {createTutorial} from './tutorial-support.js'

async function main() {
  // 1. Connect from the public manifest and create fresh identities with the SDK.
  const {tasra, awaitUsageCredit, issuer, users, policy, authorize, proveServerRefusal, directory, save, store} =
    await createTutorial('encrypted-notes', 'DocumentReader', 'document-reader')
  const identity = `${issuer.did}/notes/${randomUUID()}/version/1`
  for (const user of Object.values(users)) {
    user.credential = tasra.credentials.issue({issuer, holder: user.identity, type: 'DocumentReader',
      claims: {role: 'document-reader', documents: [identity]}})
  }
  await store.save('credentials', Object.fromEntries(Object.entries(users).map(([name, user]) => [name, user.credential])))

  // 2. Commit Alice's document-scoped policy; the SDK creates and provisions a ready slot.
  const notes = await tasra.slots.create({name: 'private-notes', mode: 'bls',
    policy: policy(['alice'], {claim: 'documents'}), threshold: {k: 2, n: 3},
    verifiers: {committee: 3, quorum: 2}})
  await awaitUsageCredit(notes.slotId)

  // 3. Encrypt with the public key; Alice presents her credential to decrypt.
  const plaintext = new TextEncoder().encode('A synthetic private note')
  const ciphertext = await notes.encrypt(identity, plaintext)
  await store.save('encrypted-document', {identity, ciphertext})
  const opened = await notes.decrypt(identity, ciphertext, {authorize: authorize('alice'),
    signal: AbortSignal.timeout(120_000), requireReceipts: true})
  try {
    if (new TextDecoder().decode(opened.plaintext) !== 'A synthetic private note') throw new Error('Decryption differs')
  } finally { opened.plaintext.fill(0); plaintext.fill(0) }

  // 4. Test server refusal separately from ciphertext authentication, with a positive control.
  const refusal = await proveServerRefusal(notes.slotId, 'bob', 'ibe-extract', {identity})
  const extracted = await notes.extractIdentity(identity, {authorize: authorize('alice'),
    signal: AbortSignal.timeout(120_000), requireReceipts: true})
  let tamperRejected = false
  try {
    const identityBytes = new TextEncoder().encode(identity)
    const control = ibeDecryptWithKey(extracted.key, ciphertext, identityBytes)
    try { if (new TextDecoder().decode(control) !== 'A synthetic private note') throw new Error('Positive control failed') }
    finally { control.fill(0) }
    const tampered = {...ciphertext, aeadCt: ciphertext.aeadCt.slice()}
    tampered.aeadCt[0] = tampered.aeadCt[0]! ^ 1
    try { const unexpected = ibeDecryptWithKey(extracted.key, tampered, identityBytes); unexpected.fill(0) }
    catch (error) { if (error instanceof Error && error.message === 'invalid tag') tamperRejected = true; else throw error }
    if (!tamperRejected) throw new Error('Tampered ciphertext was accepted')
  } finally { extracted.key.fill(0) }

  // Evidence exposes transaction and receipt references, never the private creation journal.
  const journal = await store.load<ReadySlotJournal>('slot-private-notes')
  if (!journal?.creation.result) throw new Error('Missing creation evidence')
  const {commitTx, revealTx, targetEpoch, seeded} = journal.creation.result
  const hex = (bytes: Uint8Array) => `0x${Buffer.from(bytes).toString('hex')}`
  save('evidence.json', {chainId: tasra.deployment.chainId, addresses: tasra.deployment.addresses,
    slotId: notes.slotId, creation: {slotId: notes.slotId, commitTx, revealTx, targetEpoch, seeded},
    createdAt: new Date().toISOString(), alice: 'decrypted', bob: refusal, tamperRejected,
    shareTrust: opened.shareTrust, receipts: opened.evidence.map(e => ({operator: e.operator, identifier: e.identifier,
      status: e.receiptStatus, ...(e.receipt ? {opId: hex(e.receipt.opId), tokenHash: hex(e.receipt.tokenHash), attestation: hex(e.receipt.attestation)} : {})}))})
  console.log(`PASS: Alice decrypted, Bob refused by verifier, tamper rejected. Evidence: ${directory}/evidence.json`)
}

main().catch((error: unknown) => {
  // Keep credential-bearing error objects out of terminal output.
  const message = (error instanceof Error ? error.message : String(error)).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+(?:~[\w.-]*)*/g, '[credential omitted]')
  console.error(`Stopped: ${message}`)
  process.exitCode = 1
})
