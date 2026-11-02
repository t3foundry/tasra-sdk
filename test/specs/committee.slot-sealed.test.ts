import {readFileSync} from 'node:fs'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {CipherSuite, HkdfSha256} from '@hpke/core'
import {DhkemX25519HkdfSha256} from '@hpke/dhkem-x25519'
import {Chacha20Poly1305} from '@hpke/chacha20poly1305'
import {createCommitteeSlotClient, type SlotCommitteeDecryptOptions} from '../../src/chain/committeeClient.js'
import type {TasraChainClient} from '../../src/chain/client.js'
import {requestCommitteeToken, type CommitteeTokenResult} from '../../src/committee/index.js'
import {resolveSlotKeeperUrls, resolveVerifierDirectory} from '../../src/chain/discovery.js'
import {createDecryptionRecipient, kemContentDigest, recipientPayloadDigest} from '../../src/crypto/recipient.js'
import {hexToBytes, bytesToHex} from '../../src/crypto/hex.js'
import {base64Encode} from '../../src/crypto/envelope.js'
import {requestHash} from '../../src/oid4vp/binding.js'
import {paymentIntentHash} from '../../src/committee/payment.js'
import {keeperExecutionFixture} from '../support/keeperExecution.js'

vi.mock('../../src/committee/index.js', async importOriginal => ({...await importOriginal<typeof import('../../src/committee/index.js')>(), requestCommitteeToken: vi.fn()}))
vi.mock('../../src/chain/discovery.js', async importOriginal => ({...await importOriginal<typeof import('../../src/chain/discovery.js')>(), resolveSlotKeeperUrls: vi.fn(), resolveVerifierDirectory: vi.fn()}))

interface Vector {
  slot_id: string; identity: string; plaintext: string
  kem: {u: string; nonce: string; aead_ct: string}
  shares: {identifier: number; verifying_share: string; kem_partial: string}[]
}
const vector = JSON.parse(readFileSync(new URL('../recipient-vectors.json', import.meta.url), 'utf8')) as Vector
const slotId = bytesToHex(hexToBytes(vector.slot_id))
const utf8 = (s: string) => new TextEncoder().encode(s)
const suite = new CipherSuite({kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Chacha20Poly1305()})
beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.restoreAllMocks())

async function fixture() {
  const recipient = await createDecryptionRecipient()
  const ciphertext = {u: hexToBytes(vector.kem.u), nonce: hexToBytes(vector.kem.nonce), aeadCt: hexToBytes(vector.kem.aead_ct)}
  const identity = utf8(vector.identity)
  const digest = recipientPayloadDigest(kemContentDigest(ciphertext, identity), 0, recipient.recipient)
  const paid = await keeperExecutionFixture('decrypt', bytesToHex(digest) as `0x${string}`, {slot: slotId as `0x${string}`})
  const f = await keeperExecutionFixture('decrypt', bytesToHex(digest) as `0x${string}`, {
    ...paid.payment, keeper_assignment: {...paid.payment.keeper_assignment,key_epoch:0,threshold:2},
  })
  const hash = requestHash(43112, hexToBytes(slotId), 'decrypt', digest)
  const token: CommitteeTokenResult['token'] = {slot_id: slotId, request_hash: bytesToHex(hash), token_type: 'JWT', seed: '08'.repeat(32), epoch: 7,
    vp_hash: '01'.repeat(32), holder_hash: '02'.repeat(32), rule_hash: '03'.repeat(32), binding: 'holder_key', iat: 0, exp: 9999999999,
    verifier_indexes: [0,1], signatures: [{verifier_index:0,signature:'00'.repeat(64)},{verifier_index:1,signature:'00'.repeat(64)}], payment:f.payment,payment_hash:paymentIntentHash(f.payment)}
  vi.mocked(requestCommitteeToken).mockResolvedValue({token, epoch:7, committee:2, quorum:2, registrySize:2,
    seed:new Uint8Array(32).fill(8), verifierProofs:[0,1].map(i=>({verifierIndex:i,operator:'0x'+'11'.repeat(20),pubkey:'0x'+'12'.repeat(32),proof:[]}))})
  vi.mocked(resolveSlotKeeperUrls).mockResolvedValue(['https://keeper0.example','https://keeper1.example'])
  vi.mocked(resolveVerifierDirectory).mockResolvedValue([])
  const getKeySlot = vi.fn(async () => ({mode:1,epoch:0n,threshold:{k:2,n:2}}))
  const getChainId = vi.fn(async () => 43112)
  const snapshotAt = vi.fn(async () => ({root:'0x'+'01'.repeat(32),size:2}))
  const chain = {client:{getChainId},readers:{keyRegistry:{getKeySlot},verifierSet:{snapshotAt},beacon:{}}} as unknown as TasraChainClient
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toMatch(/^https:\/\/keeper[01]\.example\/v1\/committee\/decrypt\/partial$/)
    const body = JSON.parse(String(init?.body)) as Record<string,unknown>
    expect(body.recipient).toEqual(recipient.recipient)
    expect(JSON.stringify(body)).not.toMatch(/private_key|recovery_seed|bls_peers|decrypting_set/)
    const approvals = body.execution_authorizations as {stage:string}[]
    expect(approvals).toHaveLength(1)
    expect(approvals[0]!.stage).toBe('contributor')
    const index = String(url).includes('keeper1') ? 1 : 0
    const share = vector.shares[index]!, vs = hexToBytes(share.verifying_share)
    const aad = new Uint8Array(32+2+8+vs.length)
    aad.set(hash);new DataView(aad.buffer).setUint16(32,share.identifier);aad.set(vs,42)
    const pk = await suite.kem.deserializePublicKey(hexToBytes(recipient.recipient.public_key))
    const sealed = await suite.seal({recipientPublicKey:pk,info:utf8('keykeeper:sealed-decryption-share:v1')},hexToBytes(share.kem_partial),aad)
    return new Response(JSON.stringify({key_slot_id:slotId,identifier:share.identifier,epoch:0,
      verifying_share:base64Encode(vs),sealed_share:{enc:base64Encode(new Uint8Array(sealed.enc)),ciphertext:base64Encode(new Uint8Array(sealed.ct))}}))
  })
  const opts: SlotCommitteeDecryptOptions = {recipient,ciphertext,identity,ciphertextEpoch:0,threshold:2,
    verifyingShares:new Map(vector.shares.map(s => [s.identifier,hexToBytes(s.verifying_share)])),
    binding:{chainId:43112,action:'decrypt',payloadDigest:digest,random:new Uint8Array(32).fill(5),clientId:'https://wallet.example'},
    payment:f.payment,approveExecution:f.approveExecution,fetchImpl}
  const client = createCommitteeSlotClient({chain,holder:'did:example:holder',credentials:['vc'],holderProof:'holder-proof'})
  return {client,opts,fetchImpl,getKeySlot,getChainId,snapshotAt}
}

it('discovers assigned endpoints and opens paid sealed contributions only on the client', async () => {
  const f = await fixture()
  expect(await f.client.decrypt(slotId,f.opts)).toEqual(hexToBytes(vector.plaintext))
  expect(f.fetchImpl).toHaveBeenCalledTimes(2)
  expect(requestCommitteeToken).toHaveBeenCalledWith(expect.objectContaining({binding:f.opts.binding,payment:f.opts.payment}))
})

it.each(['recipient','binding','ciphertextEpoch','verifyingShares','threshold'] as const)('refuses missing %s before authorization or chain reads', async field => {
  const f = await fixture(), opts = {...f.opts,[field]:undefined} as unknown as SlotCommitteeDecryptOptions
  await expect(f.client.decrypt(slotId,opts)).rejects.toThrow(/required/)
  expect(requestCommitteeToken).not.toHaveBeenCalled();expect(f.getKeySlot).not.toHaveBeenCalled();expect(f.fetchImpl).not.toHaveBeenCalled()
})

it('refuses substituted content before requesting holder authorization', async () => {
  const f = await fixture();f.opts.ciphertext.nonce[0]! ^= 1
  await expect(f.client.decrypt(slotId,f.opts)).rejects.toThrow(/preimage/)
  expect(requestCommitteeToken).not.toHaveBeenCalled();expect(f.fetchImpl).not.toHaveBeenCalled()
})

it.each(['chain','mode','epoch','threshold','snapshot'] as const)('refuses mismatched canonical %s without keeper work', async field => {
  const f = await fixture()
  if(field==='chain')f.getChainId.mockResolvedValue(43113)
  if(field==='mode')f.getKeySlot.mockResolvedValue({mode:0,epoch:0n,threshold:{k:2,n:2}})
  if(field==='epoch')f.getKeySlot.mockResolvedValue({mode:1,epoch:1n,threshold:{k:2,n:2}})
  if(field==='threshold')f.getKeySlot.mockResolvedValue({mode:1,epoch:0n,threshold:{k:1,n:2}})
  if(field==='snapshot')f.snapshotAt.mockResolvedValue({root:'0x'+'00'.repeat(32),size:0})
  await expect(f.client.decrypt(slotId,f.opts)).rejects.toThrow()
  expect(f.fetchImpl).not.toHaveBeenCalled()
  if(field!=='snapshot')expect(requestCommitteeToken).not.toHaveBeenCalled()
})
