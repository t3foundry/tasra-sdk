/** Two holder-bound credentials approve the same native FROST request. */
import {setApprovalPolicy, approveWithCredential, type ReadySlotJournal} from 'tasra-sdk/app'
import {createTutorial, stopped} from './tutorial-support.js'
const hex = (bytes: Uint8Array) => `0x${Buffer.from(bytes).toString('hex')}`

async function main() {
  // 1. Create all identities locally and use the public network manifest.
  const {tasra, awaitUsageCredit, wallet, users, store, directory, save, policy, authorize} =
    await createTutorial('credential-approvals', 'DocumentSigner', 'document-signer')
  const rule = policy(['alice', 'bob'])
  const slot = await tasra.slots.create({name: 'credential-approvals', mode: 'frost', policy: rule,
    threshold: {k: 2, n: 3}, verifiers: {committee: 3, quorum: 2}})
  await awaitUsageCredit(slot.slotId)

  // 2. Commit a two-holder approval policy, separate from the keeper threshold.
  const transaction = await setApprovalPolicy(tasra, slot.slotId, {quorum: 2, credentialPolicy: rule}, {wallet, store})
  await new Promise(resolve => setTimeout(resolve, 4000)) // Allow network event watchers to observe the confirmed policy.
  const approvals = await slot.approvals({quorum: 2, credentialGated: true})
  const message = new TextEncoder().encode('Approve exact synthetic document version 1')
  const request = await approvals.create(message)
  save('request.json', {requestId: request.requestId, coordinator: request.nodeUrl, slotId: slot.slotId, message: hex(message)})

  // 3. The SDK binds each credential and approval signature to this exact request.
  const approve = (name: string) => approveWithCredential(tasra, request, message, {
    identity: users[name]!.identity, authorize: authorize(name), signal: AbortSignal.timeout(120_000),
  })
  const first = await approve('alice')
  if (first.status !== 'pending' || first.have !== 1) throw new Error('One holder reached quorum unexpectedly')
  try { await approve('alice') } catch (error) {
    if (!(error instanceof Error) || !('status' in error) || ![400, 403, 409].includes(Number(error.status))) throw error
  }
  const duplicate = await request.status()
  if (duplicate.status !== 'pending' || duplicate.have !== 1) throw new Error('Same holder counted twice')
  await approve('bob')
  const result = await request.wait({timeoutMs: 120_000})
  const journal = await store.load<ReadySlotJournal>('slot-credential-approvals')
  const {commitTx, revealTx, targetEpoch, seeded} = journal!.creation.result!
  save('evidence.json', {chainId: tasra.deployment.chainId, addresses: tasra.deployment.addresses,
    createdAt: new Date().toISOString(), slotId: slot.slotId,
    creation: {slotId: slot.slotId, commitTx, revealTx, targetEpoch, seeded}, policyHash: transaction.hash,
    requestId: request.requestId, mode: 'credential-gated', quorum: 2, duplicateHolderHave: duplicate.have,
    verifiedSignature: {r: hex(result.signature.r), z: hex(result.signature.z), groupPublicKey: hex(result.groupPublicKey)}})
  console.log(`PASS: Alice and Bob approved; duplicate holder added no vote. Evidence: ${directory}/evidence.json`)
}

main().catch(stopped)
