// E2E: BLS threshold server-side DECRYPT correctness on the prod fleet.
//
// A sovereign client creates a BLS slot (commit-reveal), encrypts an envelope to
// the slot's MPK locally, then asks the committee to threshold-decrypt it via
// /v1/decrypt (the server combines k partial decryptions) and asserts the
// recovered plaintext matches. Also exercises the BlsId→PeerId committee map.
//
// Authorization: paid original wallet session and explicit keeper-stage consent.
// Run: tsx test/e2e/decrypt-server.ts

import {Suite, bytesEq} from '../fleet/_assert.ts'
import {discoverCommittee, gate, loadFleetConfig, mintLocalJwt, provisionRule} from '../fleet/_fleet.ts'
import {authorizeWallet,createWalletSlot, WALLET_RULE as SLOT_DCQL_RULE} from '../fleet/_wallet.ts'
import {decryptPayloadDigest} from '../../src/oid4vp/index.ts'
import {encryptEnvelope} from '../../src/crypto/envelope.ts'
import {committeeDecrypt} from '../../src/committee/client.ts'
import {hexToBytes} from '../../src/crypto/hex.ts'

const cfg = loadFleetConfig()
const s = new Suite('e2e: BLS server-side threshold decrypt')

if (!(await gate(s, cfg))) {
  s.done()
  process.exit(0)
}

const K = 2
const created = await createWalletSlot(cfg,'bls',K,3,SLOT_DCQL_RULE)
const {slotId,ruleSalt,creatorKey} = created
s.ok('client created a BLS slot (commit-reveal)', /^0x[0-9a-f]{64}$/.test(slotId))

// wait for the key
let committee: string[] = []
let mpkHex = ''
for (let i = 0; i < 45 && !mpkHex; i++) {
  committee = await discoverCommittee(cfg, slotId)
  for (const u of committee) {
    const r = (await (await fetch(`${u}/v1/keys/${slotId}/public`)).json()) as {group_public_key?: string}
    if (r.group_public_key) {
      mpkHex = r.group_public_key
      break
    }
  }
  if (!mpkHex) await new Promise(r => setTimeout(r, 2000))
}
s.ok('committee DKG anchored the BLS key', /^[0-9a-f]{192}$/i.test(mpkHex), `committee=${committee.length}`)

const adminJwt = mintLocalJwt(cfg)
const prov = await provisionRule(committee, slotId, SLOT_DCQL_RULE, ruleSalt, adminJwt)
s.ok('provisioned the rule + salt on the committee', prov.ok, prov.errors.join('; '))

// ── build the BlsId→PeerId committee map + a ciphertext ───────────────────────
// The BLS identifier is PUBLIC — read it from /v1/info (`node_identifier`, the value the
// node pins for exactly this bls_peers map), not from raw shard export. `/v1/shards/key`
// exports SECRET master-key material we don't need here, and since the client-sovereign
// custody gate it's denied by default on a group/credential slot — so a
// non-exportable slot like this one returns 403 and the map came up empty. `/v1/info` needs
// no export capability and no auth.
const peers: Array<{id: number; peer_id: string}> = []
for (const url of committee) {
  const info = (await (await fetch(`${url}/v1/info`)).json()) as {peer_id: string; node_identifier: number}
  peers.push({id: info.node_identifier, peer_id: info.peer_id})
}
peers.sort((a, b) => a.id - b.id)
s.ok('resolved committee BlsId→PeerId map', peers.length >= K, `peers=${peers.length}`)

const identity = 'decrypt-e2e'
const plaintext = new TextEncoder().encode('threshold-decrypt round-trip 🔐')
const env = encryptEnvelope(hexToBytes(slotId), hexToBytes(`0x${mpkHex}`), new TextEncoder().encode(identity), plaintext, 0n)
const grant = await authorizeWallet(cfg,slotId,creatorKey,{action:'decrypt',payloadDigest:decryptPayloadDigest(env.ciphertext.u,env.ciphertext.aeadCt)})
const recovered = await committeeDecrypt({nodeUrl:grant.coordinatorUrl,committeeToken:grant.compound_token,verifierProofs:grant.verifierProofs,
  approveExecution:grant.approveExecution,ciphertext:env.ciphertext,identity:new TextEncoder().encode(identity),
  decryptingSet:peers.map(p=>p.id),blsPeers:peers.map(p=>({id:p.id,peerId:p.peer_id})),ciphertextEpoch:0})
grant.dispose()
s.ok('/v1/decrypt returned a paid result on the selected coordinator',true)
s.ok('server-decrypted plaintext matches the original',bytesEq(recovered,plaintext))

s.done()
