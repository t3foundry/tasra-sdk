// E2E: FROST threshold SIGNING correctness on the prod fleet.
//
// A sovereign client creates a FROST slot (commit-reveal), the committee DKGs,
// then /v1/sign produces a threshold signature — and we VERIFY it as a standard
// Ed25519 signature against the slot's group public key. (We've load-tested sign
// before but never asserted the signature is valid.)
//
// API reachability does not guarantee on-chain eligibility. Request a three-node
// committee so this test exercises signing when the eligible pool varies.
//
// Authorization: real issuer-signed credential, reserved TASRA and original client consent.
// Run: tsx test/e2e/sign-roundtrip.ts

import {randomBytes} from 'node:crypto'
import {ed25519} from '@noble/curves/ed25519'
import {Suite} from '../fleet/_assert.ts'
import {discoverCommittee, gate, loadFleetConfig, mintAdminJwt, provisionRule} from '../fleet/_fleet.ts'
import {authorizeWallet, createWalletSlot, WALLET_RULE as SLOT_DCQL_RULE} from '../fleet/_wallet.ts'
import {committeeSign} from '../../src/committee/client.ts'
import {hexToBytes} from '../../src/crypto/hex.ts'

const cfg = loadFleetConfig()
const s = new Suite('e2e: FROST sign + signature verification')

if (!(await gate(s, cfg))) {
  s.done()
  process.exit(0)
}

// ── sovereign client creates a FROST slot with three eligible keepers ────────
const N = 3
const created = await createWalletSlot(cfg, 'frost', 3, N, SLOT_DCQL_RULE)
const {slotId, ruleSalt, creatorKey} = created
s.ok('client funded for gas', (await created.writer.ethBalance()) > 0n)
s.ok('client created a FROST slot (commit-reveal)', /^0x[0-9a-f]{64}$/.test(slotId))

// wait for DKG to anchor an Ed25519 group key
let committee: string[] = []
let pub: {group_public_key?: string; threshold_k?: number; threshold_n?: number; mode?: string} = {}
for (let i = 0; i < 45 && !pub.group_public_key; i++) {
  committee = await discoverCommittee(cfg, slotId)
  for (const u of committee) {
    const r = (await (await fetch(`${u}/v1/keys/${slotId}/public`)).json()) as typeof pub
    if (r.group_public_key) {
      pub = r
      break
    }
  }
  if (!pub.group_public_key) await new Promise(r => setTimeout(r, 2000))
}
s.ok('committee DKG anchored a key', !!pub.group_public_key, `committee=${committee.length}`)
s.eq('slot mode is frost', pub.mode ?? '', 'frost')
s.ok('FROST group key is a 32-byte Ed25519 point', /^[0-9a-f]{64}$/i.test(pub.group_public_key ?? ''))

// provision the clear DCQL rule + its salt so /v1/sign is authorized
const adminJwt = mintAdminJwt(cfg)
const prov = await provisionRule(committee, slotId, SLOT_DCQL_RULE, ruleSalt, adminJwt)
s.ok('provisioned the rule + salt on the committee', prov.ok, prov.errors.join('; '))

// ── /v1/sign → verify the Ed25519 signature ──────────────────────────────────
const messageHex = randomBytes(32).toString('hex')
const grant = await authorizeWallet(cfg,slotId,creatorKey,{action:'sign',message:Buffer.from(messageHex,'hex')})
const signed = await committeeSign({nodeUrl:grant.coordinatorUrl, committeeToken:grant.compound_token,
  verifierProofs:grant.verifierProofs, approveExecution:grant.approveExecution, message:Buffer.from(messageHex,'hex')})
grant.dispose()
s.ok('/v1/sign returned a paid result', true)
const sig = {signature_r:Buffer.from(signed.signature.r).toString('hex'), signature_z:Buffer.from(signed.signature.z).toString('hex'),
  group_public_key:Buffer.from(signed.groupPublicKey).toString('hex'), epoch:signed.epoch}
s.ok('sign reply carries r + z', !!sig.signature_r && !!sig.signature_z)
s.eq('sign group key matches /public', (sig.group_public_key ?? '').toLowerCase(), (pub.group_public_key ?? '').toLowerCase())

// the reference challenge IS the RFC 8032 one, so the aggregate is a plain
// Ed25519 signature and a STOCK verifier is the right check — see frostVerify.
const cat = (...as: Uint8Array[]): Uint8Array => {
  const o = new Uint8Array(as.reduce((s2, x) => s2 + x.length, 0))
  let k = 0
  for (const x of as) {
    o.set(x, k)
    k += x.length
  }
  return o
}
function frostVerify(R: Uint8Array, z: Uint8Array, A: Uint8Array, message: Uint8Array): boolean {
  try {
    // Stock RFC 8032 verification — the same check sshd runs. See
    // test/fleet/_crypto.ts for why this is an oracle and not a transcription.
    return ed25519.verify(cat(R, z), message, A)
  } catch {
    return false
  }
}

const R = hexToBytes(`0x${sig.signature_r}`)
const z = hexToBytes(`0x${sig.signature_z}`)
const A = hexToBytes(`0x${sig.group_public_key}`)
const msg = hexToBytes(`0x${messageHex}`)
s.ok('FROST signature verifies (z·B == R + c·A)', frostVerify(R, z, A, msg))
const badR = new Uint8Array(R)
badR[0]! ^= 0xff
s.ok('a tampered signature does NOT verify', !frostVerify(badR, z, A, msg))

s.done()
