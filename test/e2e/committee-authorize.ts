// Real wallet quorum grants with anchored membership proofs; live decrypt and
// rejection of a token with fewer signatures than the required quorum.
import {Suite,bytesEq} from '../fleet/_assert.ts'
import {gate,loadFleetConfig} from '../fleet/_fleet.ts'
import {authorizeWallet,createWalletSlot} from '../fleet/_wallet.ts'
import {decryptPayloadDigest} from '../../src/oid4vp/index.ts'
import {encryptEnvelope} from '../../src/crypto/envelope.ts'
import {hexToBytes} from '../../src/crypto/hex.ts'
import {withKeeperExecutionApprovals} from '../../src/committee/keeperExecution.ts'
import {committeeDecrypt} from '../../src/committee/client.ts'

const cfg=loadFleetConfig(),s=new Suite('e2e: wallet committee quorum authorization')
if (!(await gate(s,cfg))) { s.done(); process.exit(1) }
const slot=await createWalletSlot(cfg,'bls')
const identity='committee-wallet-cert',plaintext=new TextEncoder().encode('quorum-authorized ciphertext')
const env=encryptEnvelope(hexToBytes(slot.slotId),hexToBytes(slot.publicKey),new TextEncoder().encode(identity),plaintext,0n)
const grant=await authorizeWallet(cfg,slot.slotId,slot.creatorKey,{action:'decrypt',payloadDigest:decryptPayloadDigest(env.ciphertext.u,env.ciphertext.aeadCt)})
s.ok('grant includes a verifier quorum and anchored membership proofs',grant.compound_token.signatures.length>=2 && grant.verifier_proofs.length>=2)
const peers=[]
for (const url of slot.committee) {
  const response=await fetch(`${url}/v1/info`)
  const info=await response.json() as {node_identifier:number;peer_id:string}
  peers.push({id:info.node_identifier,peer_id:info.peer_id})
}
const b64=(value:Uint8Array)=>Buffer.from(value).toString('base64')
const body={committee_token:grant.compound_token,verifier_proofs:grant.verifier_proofs,evidence_ct:grant.evidence_ct,
  ciphertext:{u:b64(env.ciphertext.u),nonce:b64(env.ciphertext.nonce),aead_ct:b64(env.ciphertext.aeadCt)},identity,
  decrypting_set:peers.map(p=>p.id).sort((a,b)=>a-b),bls_peers:peers}
const negative=await withKeeperExecutionApprovals({body:{...body,committee_token:{...grant.compound_token,signatures:grant.compound_token.signatures.slice(0,1)}},
  kind:'committee-decrypt',nodeUrl:grant.coordinatorUrl,payment:grant.payment,approveExecution:grant.approveExecution})
const denied=await fetch(`${grant.coordinatorUrl}/v1/committee/decrypt`,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(negative),signal:AbortSignal.timeout(30000),redirect:'error',credentials:'omit'})
const reason=await denied.text()
s.ok('sub-quorum token denied for its missing quorum',denied.status===403 && /quorum|signature/i.test(reason),reason)
grant.dispose()
// Keep the refused operation's original payment for fee reconciliation. The
// successful case has its own independently signed intent and reservation.
const accepted=await authorizeWallet(cfg,slot.slotId,slot.creatorKey,{action:'decrypt',payloadDigest:decryptPayloadDigest(env.ciphertext.u,env.ciphertext.aeadCt)})
const result=await committeeDecrypt({nodeUrl:accepted.coordinatorUrl,committeeToken:accepted.compound_token,
  verifierProofs:accepted.verifierProofs,evidenceCt:accepted.evidenceCt,approveExecution:accepted.approveExecution,ciphertext:env.ciphertext,
  identity:new TextEncoder().encode(identity),decryptingSet:peers.map(p=>p.id),blsPeers:peers.map(p=>({id:p.id,peerId:p.peer_id})),ciphertextEpoch:0})
accepted.dispose()
s.ok('full quorum accepted by the keeper',true)
s.ok('threshold decrypt recovered the exact plaintext',bytesEq(result,plaintext))
s.done()
