/** Two people independently sign the exact same document and request. */
import {writeFileSync} from 'node:fs'
import {createHash, randomUUID} from 'node:crypto'
import {verifyFrostSignature, hexToBytes} from 'tasra-sdk'
import type {ReadySlotJournal} from 'tasra-sdk/app'
import {createTutorial} from './tutorial-support.js'

type Hex = `0x${string}`
const toHex = (bytes: Uint8Array): Hex => `0x${Buffer.from(bytes).toString('hex')}`

async function main() {
  // 1. Read the public manifest and create fresh local wallets, identities and credentials.
  const {tasra, awaitUsageCredit, policy, authorize, proveServerRefusal, directory, save, store} =
    await createTutorial('document-signing', 'DocumentSigner', 'document-signer')
  const {chainId, addresses} = tasra.deployment

  // 2. Give each signer a slot; the SDK persists creation, waits for keys and provisions policy.
  const signers: Array<{name: string; slotId: Hex}> = []
  const creations = []
  for (const name of ['alice', 'bob']) {
    const slot = await tasra.slots.create({name: `${name}-documents`, mode: 'frost', policy: policy([name]),
      threshold: {k: 2, n: 3}, verifiers: {committee: 3, quorum: 2}})
    await awaitUsageCredit(slot.slotId)
    signers.push({name, slotId: slot.slotId})
    const journal = await store.load<ReadySlotJournal>(`slot-${name}-documents`)
    if (!journal?.creation.result) throw new Error('Missing creation evidence')
    const {commitTx, revealTx, targetEpoch, seeded} = journal.creation.result
    creations.push({slotId: slot.slotId, commitTx, revealTx, targetEpoch, seeded})
  }

  // 3. Freeze the document bytes and signer assignments before requesting either signature.
  // A tiny PDF fixture. Applications freeze the exact uploaded PDF bytes at this point.
  const objects = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Count 1/Kids[3 0 R]>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>']
  const content = 'BT /F1 18 Tf 72 700 Td (Synthetic agreement: Alice and Bob approve.) Tj ET\n'
  objects.push(`<</Length ${content.length}>>\nstream\n${content}endstream`)
  let pdfText = '%PDF-1.4\n'; const offsets = [0]
  for (const [index, object] of objects.entries()) { offsets.push(pdfText.length); pdfText += `${index + 1} 0 obj\n${object}\nendobj\n` }
  const xref = pdfText.length
  pdfText += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  pdfText += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`
  const pdf = new TextEncoder().encode(pdfText)
  writeFileSync(`${directory}/document.pdf`, pdf, {mode: 0o600})
  const manifest = {schema: 'tasra-document/v1', requestId: randomUUID(), version: 1,
    documentSha256: createHash('sha256').update(pdf).digest('hex'), chainId,
    keyRegistry: addresses.KeyRegistry, signers}
  const message = new TextEncoder().encode(JSON.stringify(manifest))
  save('request.json', manifest)
  const signatures: Array<{name: string; slotId: Hex; r: Hex; z: Hex; receiptStatus: string; epoch: number}> = []
  for (const signer of signers) {
    const handle = await tasra.slots.frost(signer.slotId)
    const result = await handle.sign(message, {authorize: authorize(signer.name), requireReceipt: true,
      signal: AbortSignal.timeout(120_000)})
    const proof = {name: signer.name, slotId: signer.slotId, r: toHex(result.signature.r), z: toHex(result.signature.z),
      receiptStatus: result.receiptStatus, epoch: result.epoch}
    signatures.push(proof)
    save(`${signer.name}-signature.json`, proof)
  }

  // 4. Read public keys independently and reject altered documents, replay and duplicate signers.
  // A verifier receives its expected request and independently reads signer keys from chain.
  // Never accept arbitrary public keys or signer assignments merely because a bundle carries them.
  const verifyBundle = async (bytes: Uint8Array, expected: typeof manifest, proofs: typeof signatures) => {
    if (createHash('sha256').update(bytes).digest('hex') !== expected.documentSha256 || proofs.length !== 2 ||
      new Set(proofs.map(p => p.name)).size !== 2 || new Set(proofs.map(p => p.slotId)).size !== 2) return false
    const payload = new TextEncoder().encode(JSON.stringify(expected))
    for (const person of expected.signers) {
      const proof = proofs.find(p => p.name === person.name && p.slotId === person.slotId)
      if (!proof) return false
      const key = await tasra.chain.readers.keyRegistry.getKeySlot(person.slotId)
      if (!key.exists || key.cancelled || key.mode !== 0 || Number(key.epoch) !== proof.epoch ||
        !verifyFrostSignature(hexToBytes(key.publicKey), payload, {r: hexToBytes(proof.r), z: hexToBytes(proof.z)})) return false
    }
    return true
  }
  if (!await verifyBundle(pdf, manifest, signatures)) throw new Error('Independent verification failed')
  const changedPdf = pdf.slice(); changedPdf[0] = changedPdf[0]! ^ 1
  const checks = {changedPdf: !await verifyBundle(changedPdf, manifest, signatures),
    anotherRequest: !await verifyBundle(pdf, {...manifest, requestId: randomUUID()}, signatures),
    anotherVersion: !await verifyBundle(pdf, {...manifest, version: 2}, signatures),
    duplicateSigner: !await verifyBundle(pdf, manifest, [signatures[0]!, signatures[0]!])}
  if (Object.values(checks).some(ok => !ok)) throw new Error('Negative document check failed')
  const bobCannotSignAlice = await proveServerRefusal(signers[0]!.slotId, 'bob', 'sign', {message})
  save('signature-bundle.json', {manifest, signatures})
  save('evidence.json', {chainId, addresses, createdAt: new Date().toISOString(), manifest, signatures,
    creations, independentVerification: true, checks, bobCannotSignAlice})
  console.log(`PASS: Alice AND Bob signed; document tampering, replay and duplicate signer rejected. Evidence: ${directory}/evidence.json`)
}

main().catch((error: unknown) => {
  // Keep credential-bearing error objects out of terminal output.
  const message = (error instanceof Error ? error.message : String(error)).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+(?:~[\w.-]*)*/g, '[credential omitted]')
  console.error(`Stopped: ${message}`)
  process.exitCode = 1
})
