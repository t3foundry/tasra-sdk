import {readFileSync} from 'node:fs'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import {secp256k1} from '@noble/curves/secp256k1'
import {sha256} from '@noble/hashes/sha256'
import {keccak_256} from '@noble/hashes/sha3'
import {toHex, hexToBytes, recoverMessageAddress, recoverTransactionAddress, serializeTransaction, keccak256, type Hex, type TransactionSerialized} from 'viem'
import {createTasra, defineDeployment, toViemAccount, type OperationAuthorizer, type TasraDeployment} from '../../src/app/index.js'
import type {TasraChainClient} from '../../src/chain/client.js'
import {payloadDigestFor, requestHash} from '../../src/oid4vp/binding.js'
import type {TasraApplicationConfig} from '../../src/app/client.js'
import * as prepaid from '../../src/chain/prepaid.js'
import {paymentIntentHash, type PaymentIntentWire} from '../../src/committee/payment.js'

afterEach(() => vi.restoreAllMocks())

const slotId: Hex = `0x${'11'.repeat(32)}`, operator: Hex = `0x${'22'.repeat(20)}`
const seed = new Uint8Array(32).fill(9), keeperKey = ed25519.getPublicKey(seed)
const deployment: TasraDeployment = {schemaVersion: 1, name: 'test', chainId: 43112, rpcUrl: 'http://localhost:9650',
  addresses: {KeyRegistry: `0x${'33'.repeat(20)}`, NodeRegistry: `0x${'44'.repeat(20)}`, Settlement: `0x${'55'.repeat(20)}`}, coordinator: 'lowest-operator-id'}
const vector = JSON.parse(readFileSync(new URL('../ibe-vectors.json', import.meta.url), 'utf8')) as {mpk: string; identity: string; shares: {identifier: number; d_i: string}[]; verifying_shares: {g2: string; g1: string}[]}
const unhex = (v: string) => new Uint8Array(Buffer.from(v.replace(/^0x/, ''), 'hex'))
function fixture(mode = 2, options: Partial<Pick<TasraApplicationConfig, 'keeperUrl' | 'allowLocalPaidHttp'>> = {}) {
  const publicKey = mode === 2 ? secp256k1.getPublicKey(seed) : mode === 1 ? unhex(vector.mpk) : keeperKey
  const metadata = {exists: true, cancelled: false, mode, epoch: 1, threshold: {k: 2, n: 3}, publicKey: toHex(publicKey)}
  const chain = {addresses: {...deployment.addresses}, client: {getChainId: vi.fn(async () => 43112), getCode: vi.fn(async () => '0x01')},
    readers: {keyRegistry: {getKeySlot: vi.fn(async () => metadata), assignedNodes: vi.fn(async () => mode === 1 ? vector.shares.map((_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}` as Hex) : [operator])},
      nodeRegistry: {nodeOf: vi.fn(async (op: string) => ({url: mode === 1 ? `https://keeper-${parseInt(op.slice(-2), 16) - 1}.example` : 'https://keeper.example', pubkey: toHex(keeperKey)})), operatorIdOf: vi.fn(async () => 1n)}}}
  const authorize = vi.fn<OperationAuthorizer>(async request => ({token: {token_type: 'JWT', slot_id: slotId, seed: '22'.repeat(32), epoch: 1,
    vp_hash: '33'.repeat(32), holder_hash: '44'.repeat(32), rule_hash: '55'.repeat(32), verifier_indexes: [0], iat: 1, exp: 9999999999,
    binding: 'holder_key', ...(request.identity ? {identity_hash: toHex(keccak_256(new TextEncoder().encode(request.identity)))} : {}), request_hash: toHex(requestHash(43112, hexToBytes(slotId), request.action, payloadDigestFor(request.action, request))), signatures: []},
    verifierProofs: [{verifierIndex: 0, operator, pubkey: toHex(keeperKey), proof: []}]}))
  const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
    if (mode === 1) {
      const index = Number(/keeper-(\d+)/.exec(String(_url))![1]), share = vector.shares[index]!, verifying = vector.verifying_shares[index]!
      return Response.json({key_slot_id: slotId, identifier: share.identifier, extraction_share: Buffer.from(unhex(share.d_i)).toString('base64'),
        verifying_share: Buffer.concat([unhex(verifying.g2), unhex(verifying.g1)]).toString('base64'), epoch: 1})
    }
    const body = JSON.parse(String(init?.body)) as {digest: string; message_hex: string; message: string}
    if (mode === 2) {
      const signature = secp256k1.sign(body.digest, seed)
      return Response.json({mode: 'tecdsa', group_public_key: toHex(publicKey), signature_r: toHex(signature.r, {size: 32}), signature_s: toHex(signature.s, {size: 32}), signature_v: signature.recovery})
    }
    const message = hexToBytes(('0x' + (body.message_hex ?? body.message)) as Hex), signature = ed25519.sign(message, seed)
    return Response.json({key_slot_id: slotId, group_public_key: toHex(publicKey), signature_r: toHex(signature.slice(0, 32)), signature_z: toHex(signature.slice(32)), message_sha256: toHex(sha256(message)), epoch: 1})
  })
  const app = createTasra({deployment, chain: chain as unknown as TasraChainClient, fetchImpl, ...options})
  return {app, chain, metadata, authorize, fetchImpl}
}

function paidFixture(mode = 2, options: Parameters<typeof fixture>[1] = {}) {
  const f = fixture(mode, options), random: Hex = `0x${'66'.repeat(32)}`, message = new Uint8Array(32).fill(1)
  const action = mode === 1 ? 'ibe-extract' : 'sign'
  const digest = payloadDigestFor(action, mode === 1 ? {identity: vector.identity} : {message})
  const payment: PaymentIntentWire = {chain_id: deployment.chainId, settlement: deployment.addresses.Settlement!, key_registry: deployment.addresses.KeyRegistry!, slot: slotId,
    action: mode === 2 ? 'eoa-sign' : action, payload_digest: toHex(digest), session_commitment: random, nonce: random, max_cost: '10', expires: Math.floor(Date.now() / 1000) + 120,
    verification_epoch: 1, verification_seed: random, verification_root: random, verification_registry_size: 3, verification_committee: 3, verification_quorum: 2,
    keeper_assignment: {key_epoch: 1, committee_version: 1, threshold: 2, coordinator: Array<number>(32).fill(9), contributors: [9, 10].map(n => Array<number>(32).fill(n))}, signature: `0x${'11'.repeat(65)}`}
  const endpoint = {operator, publicKey: toHex(keeperKey), url: 'https://paid.example'}
  const target: prepaid.PaidKeeperTarget = {...endpoint, contributors: mode === 1 ? [0, 1].map(i => ({...endpoint, operator: `0x${(i + 1).toString(16).padStart(40, '0')}` as Hex, url: `https://keeper-${i}.example`})) : [endpoint],
    receipt: {} as prepaid.PaidOperationReceipt, groupPublicKey: f.metadata.publicKey, mode}
  // Canonical RPC/creator/roster checks have separate chain.paid-route regressions.
  // Here the boundary is controlled to exercise the app's consent and actual crypto results.
  const resolve = vi.spyOn(prepaid, 'resolvePaidKeeperTarget').mockResolvedValue(target)
  const authorize = vi.fn<OperationAuthorizer>(async request => {
    const grant = await f.authorize(request)
    return {...grant, token: {...grant.token, payment: structuredClone(payment), payment_hash: paymentIntentHash(payment), exp: payment.expires}}
  })
  return {...f, authorize, unpaidAuthorize: f.authorize, payment, random, message, target, resolve}
}

describe('paid application execution', () => {
  it.each([0, 2])('routes mode %i to the paid coordinator with fixed consent and verifies its signature', async mode => {
    const f = paidFixture(mode)
    const options = {authorize: f.authorize, payment: f.payment, random: f.random}
    if (mode === 2) await (await f.app.slots.ecdsa(slotId)).signDigest(f.message, options)
    else await (await f.app.slots.frost(slotId)).sign(f.message, options)
    expect(f.fetchImpl).toHaveBeenCalledTimes(1)
    expect(String(f.fetchImpl.mock.calls[0]![0])).toMatch(/^https:\/\/paid\.example\//)
    expect(f.chain.readers.keyRegistry.assignedNodes).not.toHaveBeenCalled()
    expect(f.resolve).toHaveBeenCalledTimes(2)
    expect(f.resolve.mock.calls[0]![3].action).toBe(mode === 2 ? 'eoa-sign' : 'sign')
    const request = f.authorize.mock.calls[0]![0]
    expect(request.payment).toEqual(f.payment)
    expect(request.random).toBe(f.random)
    expect(request.nowSecs! + request.ttlSecs!).toBe(f.payment.expires)
  })
  it('extracts real IBE shares only from signed contributors', async () => {
    const f = paidFixture(1), slot = await f.app.slots.bls(slotId)
    const plaintext = new TextEncoder().encode('paid note')
    const ciphertext = await slot.encrypt(vector.identity, plaintext)
    const result = await slot.decrypt(vector.identity, ciphertext, {authorize: f.authorize, payment: f.payment, random: f.random})
    expect(result.plaintext).toEqual(plaintext)
    expect(f.fetchImpl.mock.calls.map(([url]) => new URL(String(url)).hostname).sort()).toEqual(['keeper-0.example', 'keeper-1.example'])
    expect(f.chain.readers.keyRegistry.assignedNodes).not.toHaveBeenCalled()
  })
  it.each(['unfunded', 'expired', 'mapped-http', 'missing-random'])('refuses %s before credential consent or keeper work', async reason => {
    const f = paidFixture(2, reason === 'mapped-http' ? {keeperUrl: () => 'http://paid.example'} : {})
    if (reason === 'unfunded') f.resolve.mockRejectedValue(new Error('reservation not funded'))
    if (reason === 'expired') f.payment.expires = 1
    const slot = await f.app.slots.ecdsa(slotId)
    await expect(slot.signDigest(f.message, {authorize: f.authorize, payment: f.payment, random: reason === 'missing-random' ? undefined : f.random})).rejects.toThrow()
    expect(f.authorize).not.toHaveBeenCalled()
    expect(f.fetchImpl).not.toHaveBeenCalled()
  })
  it.each(['downgrade', 'substitution', 'settlement', 'rotation'])('refuses %s during wallet authorization before keeper work', async reason => {
    const f = paidFixture(), slot = await f.app.slots.ecdsa(slotId)
    const authorize: OperationAuthorizer = async request => {
      const grant = await f.authorize(request)
      if (reason === 'downgrade') {delete grant.token.payment; delete grant.token.payment_hash}
      if (reason === 'substitution') {
        grant.token.payment!.max_cost = '11'
        grant.token.payment_hash = paymentIntentHash(grant.token.payment!)
      }
      if (reason === 'settlement') f.resolve.mockRejectedValue(new Error('already settled'))
      if (reason === 'rotation') f.metadata.epoch++
      return grant
    }
    await expect(slot.signDigest(f.message, {authorize, payment: f.payment, random: f.random})).rejects.toThrow()
    expect(f.fetchImpl).not.toHaveBeenCalled()
  })
  it('keeps the original payment if a consent callback mutates its copy', async () => {
    const f = paidFixture(), slot = await f.app.slots.ecdsa(slotId), original = structuredClone(f.payment)
    await slot.signDigest(f.message, {payment: f.payment, random: f.random, authorize: async request => {
      const grant = await f.authorize(request)
      request.payment!.max_cost = '99'
      f.payment.max_cost = '88'
      return grant
    }})
    expect(f.resolve.mock.calls[1]![2]).toEqual(original)
    const body = JSON.parse(String(f.fetchImpl.mock.calls[0]![1]?.body)) as {committee_token: {payment: PaymentIntentWire}}
    expect(body.committee_token.payment).toEqual(original)
  })
  it('never fails over to an unpaid coordinator after a paid attempt fails', async () => {
    const f = paidFixture(), slot = await f.app.slots.ecdsa(slotId)
    f.fetchImpl.mockRejectedValue(new Error('connection lost'))
    await expect(slot.signDigest(f.message, {authorize: f.authorize, payment: f.payment, random: f.random})).rejects.toThrow()
    expect(f.fetchImpl).toHaveBeenCalledTimes(1)
    expect(f.chain.readers.keyRegistry.assignedNodes).not.toHaveBeenCalled()
  })
  it('allows mapped local HTTP only with the explicit local transport option', async () => {
    const f = paidFixture(2, {keeperUrl: () => 'http://127.0.0.1:18080', allowLocalPaidHttp: true})
    await (await f.app.slots.ecdsa(slotId)).signDigest(f.message, {authorize: f.authorize, payment: f.payment, random: f.random})
    expect(String(f.fetchImpl.mock.calls[0]![0])).toMatch(/^http:\/\/127\.0\.0\.1:18080\//)
  })
})

describe('application API', () => {
  it('reads metadata and an Ethereum address without asking for authorization', async () => {
    const {app, authorize, fetchImpl} = fixture()
    expect(await app.check()).toMatchObject({ready: true, authorization: 'unknown', nativeMultiApproverIbe: 'unsupported'})
    expect(await app.slots.get(slotId)).toMatchObject({ready: true, mode: 2, threshold: {k: 2, n: 3}})
    expect(await (await app.slots.ecdsa(slotId)).getAddress()).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(authorize).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('signs through a viem account with fresh operation authorization for every call', async () => {
    const {app, authorize, fetchImpl} = fixture(), slot = await app.slots.ecdsa(slotId)
    const account = await toViemAccount(slot, {authorize})
    const signature = await account.signMessage({message: 'hello'})
    expect((await recoverMessageAddress({message: 'hello', signature})).toLowerCase()).toBe(account.address.toLowerCase())
    const tx = {type: 'eip1559' as const, chainId: 43112, nonce: 0, gas: 21000n, maxFeePerGas: 10n, maxPriorityFeePerGas: 1n, to: operator, value: 1n}
    const signed = await account.signTransaction(tx)
    expect((await recoverTransactionAddress({serializedTransaction: signed as TransactionSerialized})).toLowerCase()).toBe(account.address.toLowerCase())
    expect(authorize).toHaveBeenCalledTimes(2)
    expect(authorize.mock.calls[1]![0].message).toEqual(hexToBytes(keccak256(serializeTransaction(tx))))
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
  it('rejects account rotation before signing through an existing viem adapter', async () => {
    const {app, authorize, metadata, fetchImpl} = fixture()
    const account = await toViemAccount(await app.slots.ecdsa(slotId), {authorize})
    metadata.publicKey = toHex(secp256k1.getPublicKey(new Uint8Array(32).fill(8)))
    await expect(account.signMessage({message: 'hello'})).rejects.toMatchObject({code: 'SLOT_CHANGED'})
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it.each(['chain', 'missing', 'cancelled', 'mode', 'pending'])('rejects unusable slot: %s', async reason => {
    const {app, chain, metadata} = fixture()
    if (reason === 'chain') chain.client.getChainId.mockResolvedValue(1)
    if (reason === 'missing') metadata.exists = false
    if (reason === 'cancelled') metadata.cancelled = true
    if (reason === 'mode') metadata.mode = 1
    if (reason === 'pending') metadata.publicKey = '0x'
    await expect(app.slots.ecdsa(slotId)).rejects.toThrow()
  })
  it.each(['expiry', 'binding', 'slot', 'request', 'proof', 'rotation', 'refusal', 'abort'])('does not contact a keeper after invalid authorization: %s', async reason => {
    const {app, authorize, metadata, fetchImpl} = fixture(), slot = await app.slots.ecdsa(slotId)
    const signal = new AbortController()
    const changed: OperationAuthorizer = async request => {
      const grant = await authorize(request)
      if (reason === 'expiry') grant.token.exp = 1
      if (reason === 'binding') grant.token.binding = undefined
      if (reason === 'slot') grant.token.slot_id = 'ff'.repeat(32)
      if (reason === 'request') grant.token.request_hash = 'ff'.repeat(32)
      if (reason === 'proof') grant.verifierProofs = []
      if (reason === 'rotation') metadata.epoch++
      if (reason === 'refusal') throw new Error('refused')
      if (reason === 'abort') signal.abort(new Error('cancelled'))
      return grant
    }
    await expect(slot.signDigest(new Uint8Array(32), {authorize: changed, signal: signal.signal})).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('keeps the original digest when application code mutates its authorization request', async () => {
    const {app, authorize} = fixture(), slot = await app.slots.ecdsa(slotId), digest = new Uint8Array(32).fill(1)
    const result = await slot.signDigest(digest, {authorize: async request => {
      const grant = await authorize(request)
      request.message!.fill(2)
      digest.fill(3)
      return grant
    }})
    expect(secp256k1.verify(new Uint8Array([...result.r, ...result.s]), new Uint8Array(32).fill(1), result.groupPublicKey)).toBe(true)
  })
  it('rejects invalid digest length and an unanchored signature', async () => {
    const {app, authorize, fetchImpl} = fixture(), slot = await app.slots.ecdsa(slotId)
    await expect(slot.signDigest(new Uint8Array(1), {authorize})).rejects.toThrow('32 bytes')
    const wrongKey = new Uint8Array(32).fill(2), digest = new Uint8Array(32), sig = secp256k1.sign(digest, wrongKey)
    fetchImpl.mockResolvedValue(Response.json({mode: 'tecdsa', group_public_key: toHex(secp256k1.getPublicKey(wrongKey)), signature_r: toHex(sig.r, {size: 32}), signature_s: toHex(sig.s, {size: 32}), signature_v: sig.recovery}))
    await expect(slot.signDigest(digest, {authorize})).rejects.toMatchObject({code: 'INVALID_RESULT'})
  })
  it('verifies FROST signing and reports absent receipts explicitly', async () => {
    const {app, authorize} = fixture(0), slot = await app.slots.frost(slotId)
    expect((await slot.sign(new Uint8Array([1, 2, 3]), {authorize})).receiptStatus).toBe('absent')
    await expect(slot.sign(new Uint8Array([1]), {authorize, requireReceipt: true})).rejects.toMatchObject({code: 'INVALID_RESULT'})
    expect(await slot.approvals({quorum: 2, credentialGated: true})).toHaveProperty('resume')
  })
  it('encrypts publicly and decrypts with a distinct assigned extraction quorum', async () => {
    const {app, authorize, metadata} = fixture(1), slot = await app.slots.bls(slotId)
    const plaintext = new TextEncoder().encode('my private note'), ciphertext = await slot.encrypt(vector.identity, plaintext)
    expect(authorize).not.toHaveBeenCalled()
    const result = await slot.decrypt(vector.identity, ciphertext, {authorize})
    expect(result.plaintext).toEqual(plaintext)
    expect(result.shareTrust).toBe('anchored-group')
    expect(result.evidence.every(p => p.receiptStatus === 'absent')).toBe(true)
    const extracted = await slot.extractIdentity(vector.identity, {authorize})
    expect(extracted.key.length).toBe(48)
    extracted.key.fill(0)
    await expect(slot.decrypt('wrong-identity', ciphertext, {authorize})).rejects.toThrow()
    metadata.publicKey = '0x12'
    await expect(slot.encrypt(vector.identity, plaintext)).rejects.toThrow('BLS')
  })
  it('handles raw digest and typed-data signing through viem', async () => {
    const {app, authorize} = fixture(), account = await toViemAccount(await app.slots.ecdsa(slotId), {authorize})
    expect(await account.sign!({hash: '0x' + '01'.repeat(32) as Hex})).toMatch(/^0x[0-9a-f]{130}$/i)
    expect(await account.signTypedData({domain: {name: 'Tasra', chainId: 43112}, types: {Note: [{name: 'text', type: 'string'}]}, primaryType: 'Note', message: {text: 'signed'}})).toMatch(/^0x[0-9a-f]{130}$/i)
    expect(authorize).toHaveBeenCalledTimes(2)
  })
  it('does not accept a chain client from a different registry', () => {
    const {chain} = fixture()
    chain.addresses.KeyRegistry = operator
    expect(() => createTasra({deployment, chain: chain as unknown as TasraChainClient})).toThrow('different KeyRegistry')
  })
  it.each(['schema', 'chain', 'coordinator', 'url', 'credentials', 'registry'])('validates deployment: %s', field => {
    const d = structuredClone(deployment)
    if (field === 'schema') d.schemaVersion = 2 as 1
    if (field === 'chain') d.chainId = 0
    if (field === 'coordinator') d.coordinator = 'other' as 'assigned-first'
    if (field === 'url') d.rpcUrl = 'file:///tmp/rpc'
    if (field === 'credentials') d.rpcUrl = 'http://user:password@localhost'
    if (field === 'registry') d.addresses.KeyRegistry = '0x' as Hex
    expect(() => defineDeployment(d)).toThrow()
  })
})
