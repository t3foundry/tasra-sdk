// Measure complete production wallet → committee operations at one and several
// entry nodes. Every operation has a fresh holder presentation bound to its
// exact payload; reported latency includes wallet authorization.
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {Suite, metric} from '../fleet/_assert.ts'
import {gate, loadFleetConfig} from '../fleet/_fleet.ts'
import {authorizeWallet, createWalletSlot} from '../fleet/_wallet.ts'
import {paidWalletCoordinator, paidWalletBlsSharing} from '../fleet/_paid-wallet.ts'
import {frostVerify} from '../fleet/_crypto.ts'
import {encryptEnvelope} from '../../src/crypto/envelope.ts'
import {hexToBytes} from '../../src/crypto/hex.ts'
import {committeeSign} from '../../src/committee/client.ts'
import {decryptWithCommitteePartials} from '../../src/decryption/sealed.ts'
import {createDecryptionRecipient, decryptionBinding, kemContentDigest} from '../../src/crypto/recipient.ts'

const cfg = loadFleetConfig()
const s = new Suite('stress: production wallet key operations (sign + decrypt)')
if (!(await gate(s,cfg))) { s.done(); process.exit(0) }
const duration = Number(process.env.KK_STRESS_DURATION ?? 12)*1000
const concurrency = Number(process.env.KK_STRESS_CONC ?? 4)
const requestsPerSecond = Number(process.env.KK_STRESS_RPS ?? 2)
assert(Number.isFinite(requestsPerSecond) && requestsPerSecond > 0)
s.info(`offered load: ${requestsPerSecond} complete wallet operations/s; ${concurrency} workers`)
const n = Math.min(cfg.nodeUrls.length,5)
const k = Math.min(Number(process.env.KK_K ?? 3),n)
assert(Number.isFinite(duration) && duration > 0)
assert(Number.isInteger(concurrency) && concurrency > 0)
assert(k >= 2 && n >= k)

async function measure(name: string, operation: (worker: number) => Promise<void>) {
  const latencies: number[] = []
  let passed = 0
  let failed = 0
  const start = Date.now()
  let nextStart = start
  const worker = async (index: number) => {
    while (Date.now()-start < duration) {
      const reserved = nextStart
      nextStart += 1000/requestsPerSecond
      if (reserved >= start+duration) break
      await new Promise(resolve=>setTimeout(resolve,Math.max(0,reserved-Date.now())))
      const t = Date.now()
      try { await operation(index); passed++ }
      catch(error) { failed++; s.info(`${name} failure: ${String(error).slice(0,500)}`) }
      latencies.push(Date.now()-t)
    }
  }
  await Promise.all(Array.from({length:concurrency},(_,i)=>worker(i)))
  latencies.sort((a,b)=>a-b)
  const wall = (Date.now()-start)/1000
  s.info(`${name}: ${passed} successful, ${failed} failed in ${wall.toFixed(2)}s`)
  metric(`${name} throughput`,passed/wall,'ops/s')
  metric(`${name} p95`,latencies[Math.min(latencies.length-1,Math.floor(latencies.length*.95))] ?? 0,'ms')
  s.ok(`${name} sustained throughput > 0`,passed>0)
  s.ok(`${name} success rate ≥ 95%`,passed/(passed+failed)>=.95,`${passed}/${passed+failed}`)
}

const frost = await createWalletSlot(cfg,'frost',k,n)
const sign = async (worker: number) => {
  const message = randomBytes(32)
  const coordinator = await paidWalletCoordinator(cfg,frost.slotId,worker)
  const grant = await authorizeWallet(cfg,frost.slotId,frost.creatorKey,{action:'sign',message},undefined,false,coordinator)
  const result = await committeeSign({nodeUrl:grant.coordinatorUrl,
    committeeToken:grant.compound_token,verifierProofs:grant.verifierProofs,evidenceCt:grant.evidenceCt,approveExecution:grant.approveExecution,message})
  assert(frostVerify(result.signature.r,result.signature.z,hexToBytes(frost.publicKey),message))
  grant.dispose()
}
await sign(0)
s.ok('sign produces a cryptographically valid FROST signature',true)
await measure('FROST sign',()=>sign(0))
await measure('FROST sign spread-entry',sign)

const bls = await createWalletSlot(cfg,'bls',k,n)
const sharing = await paidWalletBlsSharing(cfg, bls.slotId)
assert(sharing.verifyingShares.size >= k)
const decrypt = async (worker: number) => {
  const identity = new TextEncoder().encode('stress-keyops')
  const plaintext = randomBytes(32)
  const envelope = encryptEnvelope(hexToBytes(bls.slotId),hexToBytes(bls.publicKey),identity,plaintext,0n)
  const coordinator = await paidWalletCoordinator(cfg,bls.slotId,worker)
  const recipient = await createDecryptionRecipient()
  const binding = decryptionBinding(kemContentDigest(envelope.ciphertext, identity), sharing.epoch, recipient)
  const grant = await authorizeWallet(cfg,bls.slotId,bls.creatorKey,
    {action:'decrypt',...binding},undefined,false,coordinator)
  assert.equal(grant.payment.keeper_assignment.key_epoch, sharing.epoch)
  assert.equal(grant.payment.keeper_assignment.committee_version, sharing.assignment.committee_version)
  const output = await decryptWithCommitteePartials({nodeUrls:sharing.nodeUrls,chainId:43112,recipient,
    verifyingShares:sharing.verifyingShares,threshold:sharing.threshold,
    committeeToken:grant.compound_token,verifierProofs:grant.verifierProofs,evidenceCt:grant.evidenceCt,approveExecution:grant.approveExecution,
    ciphertext:envelope.ciphertext,identity,ciphertextEpoch:sharing.epoch})
  assert.deepEqual(Buffer.from(output),plaintext)
  grant.dispose()
}
await decrypt(0)
s.ok('decrypt recovers the correct plaintext',true)
await measure('BLS decrypt',()=>decrypt(0))
await measure('BLS decrypt spread-entry',decrypt)
s.done()
