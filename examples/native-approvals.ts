/** Two distinct people approve one threshold signature; duplicate and replay checks follow. */
import {setApprovalPolicy, identityApprover, type ReadySlotJournal} from 'tasra-sdk/app'
import {dualSignApprovalPayload} from 'tasra-sdk/committee'
import {createTutorial, stopped} from './tutorial-support.js'
const hex = (bytes: Uint8Array) => `0x${Buffer.from(bytes).toString('hex')}` as `0x${string}`

async function main() {
  // 1. Fresh local development identities and a manifest-based client.
  const {tasra, awaitUsageCredit, wallet, users, store, directory, save, policy: accessPolicy} =
    await createTutorial('native-approvals', 'DocumentSigner', 'document-signer')
  const policy = accessPolicy(['alice', 'bob'])
  // 2. Create and provision a FROST slot through the SDK.
  const slot = await tasra.slots.create({name: 'document-approvals', mode: 'frost', policy,
    threshold: {k: 2, n: 3}, verifiers: {committee: 3, quorum: 2}})
  await awaitUsageCredit(slot.slotId)
  const creation = (await store.load<ReadySlotJournal>('slot-document-approvals'))!.creation.result!
  const {commitTx, revealTx, targetEpoch, seeded} = creation
  // 3. Two distinct identity keys must approve the same invoice request.
  const signers = [identityApprover(users.alice!.identity), identityApprover(users.bob!.identity)]
  const policyTransaction = await setApprovalPolicy(tasra, slot.slotId, {quorum: 2, approvers: signers.map(s => s.publicKey)}, {wallet, store})
  // Allow the network's event watchers to observe the confirmed policy.
  await new Promise(resolve => setTimeout(resolve, 4000))
  const approvals = await slot.approvals({quorum: 2, credentialGated: false})
  const message = new TextEncoder().encode('Approve synthetic invoice 42, version 1'), request = await approvals.create(message)
  save('request.json', {requestId: request.requestId, coordinator: request.nodeUrl, slotId: slot.slotId, message: hex(message), quorum: 2})
  const first = await request.approve({signer: signers[0]!})
  if (first.status !== 'pending' || first.have !== 1) throw new Error('First approver did not leave request pending')
  try { await request.approve({signer: signers[0]!}) } catch (error) {
    if (!(error instanceof Error) || !('status' in error) || ![400, 403, 409].includes(Number(error.status))) throw error
  }
  const duplicate = await request.status()
  if (duplicate.status !== 'pending' || duplicate.have !== 1) throw new Error('Duplicate approver changed quorum')
  await request.approve({signer: signers[1]!})
  const result = await request.wait({timeoutMs: 120_000})

  // 4. A protocol negative check replays the first approval against a new request.
  const next = await approvals.create(message)
  const replay = await fetch(`${next.nodeUrl}/v1/dual-sign/${next.requestId}/approve`, {method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({approver_pubkey: hex(signers[0]!.publicKey), signature: hex(await signers[0]!.sign(dualSignApprovalPayload(slot.slotId, message, request.requestId)))})})
  if (![400, 403].includes(replay.status)) throw new Error('Cross-request approval replay was not refused')
  const afterReplay = await next.status()
  if (afterReplay.status !== 'pending' || afterReplay.have !== 0) throw new Error('Replay added a vote')
  let changedRejected = false
  try { await approvals.resume(next.requestId, new Uint8Array([1])).status() } catch (error) {
    if (error instanceof Error && /message or slot/.test(error.message)) changedRejected = true; else throw error
  }
  if (!changedRejected) throw new Error('Changed message accepted')
  const evidence = {chainId: tasra.deployment.chainId, addresses: tasra.deployment.addresses, createdAt: new Date().toISOString(), slotId: slot.slotId,
    creation: {slotId: slot.slotId, commitTx, revealTx, targetEpoch, seeded}, policyHash: policyTransaction.hash,
    requestId: request.requestId, quorum: 2, duplicateHave: duplicate.have, replayHttpStatus: replay.status, replayHave: afterReplay.have,
    changedMessageRejected: changedRejected, verifiedSignature: {r: hex(result.signature.r), z: hex(result.signature.z), groupPublicKey: hex(result.groupPublicKey)},
    mode: 'static-approver-keys', receipt: result.receipt ? 'present-unverified' : 'absent'}
  save('evidence.json', evidence)
  console.log(`PASS: two distinct approvals, duplicate vote prevented, replay refused. Evidence: ${directory}/evidence.json`)
}

main().catch(stopped)
