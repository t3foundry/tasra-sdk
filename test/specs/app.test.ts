import {readFileSync} from 'node:fs'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import {bls12_381} from '@noble/curves/bls12-381'
import {secp256k1} from '@noble/curves/secp256k1'
import {sha256} from '@noble/hashes/sha256'
import {keccak_256} from '@noble/hashes/sha3'
import {recoverAddress, toHex, hexToBytes, recoverMessageAddress, recoverTransactionAddress, serializeTransaction, keccak256, type Hex, type TransactionSerialized} from 'viem'
import {createTasra, defineDeployment, toViemAccount, type OperationAuthorizer, type TasraDeployment} from '../../src/app/index.js'
import type {TasraChainClient} from '../../src/chain/client.js'
import {payloadDigestFor, requestHash} from '../../src/oid4vp/binding.js'
import type {TasraApplicationConfig} from '../../src/app/client.js'
import {createDecryptionRecipient, decryptionBinding} from '../../src/crypto/recipient.js'
import {sealIbeFixture} from '../support/sealedIbe.js'
import {approveDualOperation, assembleDualOperation, dualOperationPayload, prepareDualOperation, type DualOperationKind} from '../../src/committee/dual-operation.js'
import {approveSigningIntent, signingIntentDigest} from '../../src/app/signing-intents.js'
import {p256} from '@noble/curves/p256'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

const slotId: Hex = `0x${'11'.repeat(32)}`, operator: Hex = `0x${'22'.repeat(20)}`
const seed = new Uint8Array(32).fill(9), keeperKey = ed25519.getPublicKey(seed)
const deployment: TasraDeployment = {schemaVersion: 1, name: 'test', chainId: 43112, rpcUrl: 'http://localhost:9650',
  addresses: {KeyRegistry: `0x${'33'.repeat(20)}`, NodeRegistry: `0x${'44'.repeat(20)}`, Settlement: `0x${'55'.repeat(20)}`}, coordinator: 'lowest-operator-id'}
const vector = JSON.parse(readFileSync(new URL('../ibe-vectors.json', import.meta.url), 'utf8')) as {mpk: string; identity: string; shares: {identifier: number; d_i: string}[]; verifying_shares: {g2: string; g1: string}[]}
const unhex = (v: string) => new Uint8Array(Buffer.from(v.replace(/^0x/, ''), 'hex'))
const recipient = await createDecryptionRecipient()
const binding = decryptionBinding(sha256(new TextEncoder().encode(vector.identity)), 1, recipient)
const extractionOptions = {recipient, verifyingShares: new Map(vector.shares.map((s, i) => [s.identifier, new Uint8Array([...unhex(vector.verifying_shares[i]!.g2), ...unhex(vector.verifying_shares[i]!.g1)])]))}
function fixture(mode = 2, options: Partial<Pick<TasraApplicationConfig, 'keeperUrl'>> = {}) {
  const policy = {quorum: 0, ruleHash: `0x${'00'.repeat(32)}` as Hex, approvers: [] as Hex[]}
  const publicKey = mode === 2 ? secp256k1.getPublicKey(seed) : mode === 1 ? unhex(vector.mpk) : keeperKey
  const metadata = {exists: true, cancelled: false, mode, epoch: 1, threshold: {k: 2, n: 3}, publicKey: toHex(publicKey)}
  const chain = {addresses: {...deployment.addresses}, client: {getChainId: vi.fn(async () => 43112), getCode: vi.fn(async () => '0x01'),
    // KeyRegistry.dualControlPolicy and dualControlApprovers: no native approval policy unless a test installs one.
    readContract: vi.fn(async ({functionName}: {functionName: string}) => functionName === 'dualControlApprovers' ? [...policy.approvers] : [policy.quorum, policy.ruleHash] as const)},
    readers: {keyRegistry: {getKeySlot: vi.fn(async () => metadata), assignedNodes: vi.fn(async () => mode === 1 ? vector.shares.map((_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}` as Hex) : [operator])},
      nodeRegistry: {nodeOf: vi.fn(async (op: string) => ({url: mode === 1 ? `https://keeper-${parseInt(op.slice(-2), 16) - 1}.example` : 'https://keeper.example', pubkey: toHex(keeperKey)})), operatorIdOf: vi.fn(async (_op: string) => 1n)}}}
  const authorize = vi.fn<OperationAuthorizer>(async request => ({token: {token_type: 'JWT', slot_id: slotId, seed: '22'.repeat(32), epoch: 1,
    vp_hash: '33'.repeat(32), holder_hash: '44'.repeat(32), rule_hash: '55'.repeat(32), verifier_indexes: [0], iat: 1, exp: 9999999999,
    binding: 'holder_key', ...(request.identity ? {identity_hash: toHex(keccak_256(new TextEncoder().encode(request.identity)))} : {}), request_hash: toHex(requestHash(43112, hexToBytes(slotId), request.action, request.decryption ? request.payloadDigest! : payloadDigestFor(request.action, request))), signatures: []},
    verifierProofs: [{verifierIndex: 0, operator, pubkey: toHex(keeperKey), proof: []}]}))
  const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
    if (mode === 1) {
      const index = Number(/keeper-(\d+)/.exec(String(_url))![1]), share = vector.shares[index]!, verifying = vector.verifying_shares[index]!
      const body = JSON.parse(String(init?.body)) as {committee_token: {request_hash: Hex}}
      return Response.json(await sealIbeFixture({key_slot_id: slotId, identifier: share.identifier, extraction_share: Buffer.from(unhex(share.d_i)).toString('base64'),
        verifying_share: Buffer.concat([unhex(verifying.g2), unhex(verifying.g1)]).toString('base64'), epoch: 1}, recipient, hexToBytes(body.committee_token.request_hash)))
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
  return {app, chain, metadata, authorize, fetchImpl, policy}
}

describe('metered application execution', () => {
  it.each([0, 2])('routes mode %i to the registry coordinator with no payment or approval fields in the keeper body', async mode => {
    const f = fixture(mode), message = new Uint8Array(32).fill(1)
    if (mode === 2) await (await f.app.slots.ecdsa(slotId)).signDigest(message, {authorize: f.authorize})
    else await (await f.app.slots.frost(slotId)).sign(message, {authorize: f.authorize})
    expect(f.fetchImpl).toHaveBeenCalledTimes(1)
    expect(String(f.fetchImpl.mock.calls[0]![0])).toMatch(/^https:\/\/keeper\.example\//)
    const sent = JSON.parse(String(f.fetchImpl.mock.calls[0]![1]?.body)) as Record<string, unknown>
    // A keeper refuses unknown fields: nothing of the retired payment flow may be sent.
    expect(Object.keys(sent).filter(k => ['payment', 'execution_authorizations'].includes(k))).toEqual([])
    expect(sent.committee_token).not.toHaveProperty('payment')
    expect(f.authorize.mock.calls[0]![0]).not.toHaveProperty('payment')
  })
  it.each(['payment', 'payment_hash'])('refuses a grant that introduces a %s before keeper work', async field => {
    const f = fixture(), slot = await f.app.slots.ecdsa(slotId)
    const authorize: OperationAuthorizer = async request => {
      const grant = await f.authorize(request)
      ;(grant.token as unknown as Record<string, unknown>)[field] = field === 'payment' ? {max_cost: '1'} : `0x${'77'.repeat(32)}`
      return grant
    }
    await expect(slot.signDigest(new Uint8Array(32).fill(1), {authorize})).rejects.toMatchObject({code: 'INVALID_AUTHORIZATION'})
    expect(f.fetchImpl).not.toHaveBeenCalled()
  })
  it('sends a rotation seen during wallet authorization to no keeper', async () => {
    const f = fixture(), slot = await f.app.slots.ecdsa(slotId)
    const authorize: OperationAuthorizer = async request => { const grant = await f.authorize(request); f.metadata.epoch++; return grant }
    await expect(slot.signDigest(new Uint8Array(32).fill(1), {authorize})).rejects.toMatchObject({code: 'SLOT_CHANGED'})
    expect(f.fetchImpl).not.toHaveBeenCalled()
  })
})

describe('bounded keeper discovery and operations', () => {
  it.each(['lowest-operator-id', 'assigned-first'] as const)('bounds registry calls at eight and preserves %s selection across out-of-order replies', async coordinator => {
    const f = fixture(0)
    const app = createTasra({deployment: {...deployment, coordinator}, chain: f.chain as unknown as TasraChainClient, fetchImpl: f.fetchImpl})
    const members = Array.from({length: 20}, (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}` as Hex)
    f.chain.readers.keyRegistry.assignedNodes.mockResolvedValue(members)
    let inFlight = 0, peak = 0
    const delayed = async <T,>(op: string, result: T): Promise<T> => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise(resolve => setTimeout(resolve, 5 - parseInt(op.slice(-2), 16) % 4))
      inFlight--
      return result
    }
    f.chain.readers.nodeRegistry.nodeOf.mockImplementation(op => delayed(op, {url: `https://keeper-${op.slice(-2)}.example`, pubkey: toHex(keeperKey)}))
    f.chain.readers.nodeRegistry.operatorIdOf.mockImplementation(op => delayed(op, BigInt(21 - parseInt(op.slice(-2), 16))))
    await (await app.slots.frost(slotId)).sign(new Uint8Array([1]), {authorize: f.authorize})
    expect(peak).toBe(8)
    expect(inFlight).toBe(0)
    expect(f.chain.readers.nodeRegistry.nodeOf).toHaveBeenCalledTimes(20)
    expect(f.chain.readers.nodeRegistry.operatorIdOf).toHaveBeenCalledTimes(20)
    expect(String(f.fetchImpl.mock.calls[0]![0])).toContain(`keeper-${coordinator === 'assigned-first' ? '01' : '14'}.example`)
    expect(JSON.parse(String(f.fetchImpl.mock.calls[0]![1]?.body))).not.toHaveProperty('signing_set')
  })
  it('refuses a partial roster before requesting keeper work', async () => {
    const f = fixture(0)
    f.chain.readers.nodeRegistry.nodeOf.mockRejectedValue(new Error('registry unavailable'))
    await expect((await f.app.slots.frost(slotId)).sign(new Uint8Array([1]), {authorize: f.authorize})).rejects.toThrow('registry unavailable')
    expect(f.fetchImpl).not.toHaveBeenCalled()
  })
  it('times out stalled assignment discovery without dispatching work', async () => {
    vi.useFakeTimers()
    const f = fixture(0)
    f.chain.readers.keyRegistry.assignedNodes.mockImplementation(() => new Promise(() => {}))
    const pending = (await f.app.slots.frost(slotId)).sign(new Uint8Array([1]), {authorize: f.authorize})
    const outcome = pending.catch(error => error as Error)
    await vi.waitFor(() => expect(f.chain.readers.keyRegistry.assignedNodes).toHaveBeenCalledTimes(1), {timeout: 30_000})
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await outcome).toMatchObject({name: 'TimeoutError'})
    expect(f.chain.readers.nodeRegistry.nodeOf).not.toHaveBeenCalled()
    expect(f.fetchImpl).not.toHaveBeenCalled()
  })
  it.each([0, 2])('bounds mode %i HTTP work and response decoding without retrying', async mode => {
    for (const stuckBody of [false, true]) {
      vi.useFakeTimers()
      const f = fixture(mode)
      f.fetchImpl.mockImplementation(async () => stuckBody
        ? {ok: true, json: () => new Promise(() => {})} as Response
        : new Promise(() => {}))
      const options = {authorize: f.authorize}
      const pending = mode === 0 ? (await f.app.slots.frost(slotId)).sign(new Uint8Array([1]), options)
        : (await f.app.slots.ecdsa(slotId)).signDigest(new Uint8Array(32), options)
      const outcome = pending.catch(error => error as Error)
      await vi.waitFor(() => expect(f.fetchImpl).toHaveBeenCalledTimes(1), {timeout: 30_000})
      await vi.advanceTimersByTimeAsync(15_000)
      expect(await outcome).toMatchObject({name: 'TimeoutError'})
      expect(f.fetchImpl.mock.calls[0]![1]?.signal?.aborted).toBe(true)
      expect(f.fetchImpl).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
      vi.useRealTimers()
    }
  })
  it.each([0, 2])('honors mode %i caller cancellation even if the transport ignores its signal', async mode => {
    const f = fixture(mode), controller = new AbortController(), reason = new Error('caller cancelled')
    f.fetchImpl.mockImplementation(() => new Promise(() => {}))
    const options = {authorize: f.authorize, signal: controller.signal}
    const pending = mode === 0 ? (await f.app.slots.frost(slotId)).sign(new Uint8Array([1]), options)
      : (await f.app.slots.ecdsa(slotId)).signDigest(new Uint8Array(32), options)
    const outcome = pending.catch(error => error as Error)
    await vi.waitFor(() => expect(f.fetchImpl).toHaveBeenCalledTimes(1), {timeout: 30_000})
    controller.abort(reason)
    expect(await outcome).toBe(reason)
    expect(f.fetchImpl).toHaveBeenCalledTimes(1)
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
    const plaintext = new TextEncoder().encode('my private note'), ciphertext = await slot.encryptForIdentity(vector.identity, plaintext)
    expect(authorize).not.toHaveBeenCalled()
    const result = await slot.decryptForIdentity(vector.identity, ciphertext, {...extractionOptions, authorize})
    expect(result.plaintext).toEqual(plaintext)
    expect(result.shareTrust).toBe('anchored-group')
    expect(result.evidence.every(p => p.receiptStatus === 'absent')).toBe(true)
    const extracted = await slot.extractIdentityKey(vector.identity, {...extractionOptions, authorize})
    expect(extracted.key.length).toBe(48)
    extracted.key.fill(0)
    await expect(slot.decryptForIdentity('wrong-identity', ciphertext, {...extractionOptions, authorize})).rejects.toThrow()
    metadata.publicKey = '0x12'
    await expect(slot.encryptForIdentity(vector.identity, plaintext)).rejects.toThrow('BLS')
  })
  it('wraps a data key with KEM locally and refuses KEM decryption without a client recipient', async () => {
    const {app, authorize, fetchImpl} = fixture(1), slot = await app.slots.bls(slotId)
    const dataKey = new Uint8Array(32).fill(0x42), aad = new TextEncoder().encode('test-scope')
    const kemCt = await slot.encrypt(aad, dataKey)
    expect(kemCt.u.length).toBeGreaterThan(0)
    expect(authorize).not.toHaveBeenCalled()
    const calls = fetchImpl.mock.calls.length
    await expect(slot.decrypt(aad, kemCt, {authorize} as never)).rejects.toThrow(/recipient/i)
    expect(authorize).not.toHaveBeenCalled()
    expect(fetchImpl.mock.calls.length).toBe(calls)
  })
  it('passes the application extraction deadline through to a stalled keeper fan-out', async () => {
    const f = fixture(1), slot = await f.app.slots.bls(slotId), original = f.fetchImpl.getMockImplementation()!
    f.fetchImpl.mockImplementation((url, init) => String(url).includes('keeper-0.')
      ? original(url, init) : new Promise<Response>(() => {}))
    await expect(slot.extractIdentityKey(vector.identity, {...extractionOptions, authorize: f.authorize, timeoutMs: 500})).rejects.toThrow(/deadline|threshold/i)
    expect(f.fetchImpl.mock.calls.every(([, init]) => init?.signal?.aborted)).toBe(true)
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

describe('native approvals on a threshold ECDSA signature', () => {
  const approverSeeds = [31, 32, 33].map(n => new Uint8Array(32).fill(n))
  const approverFor = (seedBytes: Uint8Array) => ({publicKey: ed25519.getPublicKey(seedBytes), sign: async (payload: Uint8Array) => ed25519.sign(payload, seedBytes)})
  const message = new Uint8Array(32).fill(1)
  /** A 2-approval bundle for signing `digest` on the fixture slot (payload digest = SHA-256 of the digest). */
  async function bundle(change: {digest?: Uint8Array; chainId?: number; epoch?: number; nowSecs?: number; operation?: DualOperationKind} = {}) {
    const payloadDigest = toHex(sha256(change.digest ?? message)), time = change.nowSecs !== undefined ? {nowSecs: change.nowSecs} : {}
    const prepared = prepareDualOperation({chainId: change.chainId ?? 43112, slot: slotId, payloadDigest, operation: change.operation ?? 'secp256k1-sign', epoch: change.epoch ?? 1, ...time})
    const records = await Promise.all(approverSeeds.slice(0, 2).map(s => approveDualOperation({prepared, expectSlot: slotId, expectPayloadDigest: payloadDigest, approver: approverFor(s), ...time})))
    return assembleDualOperation({prepared, approvals: records, quorum: 2, ...time})
  }
  /** The fixture with a static 2-of-3 policy installed on chain. */
  function policyFixture(mode = 2) {
    const f = fixture(mode)
    Object.assign(f.policy, {quorum: 2, approvers: approverSeeds.map(s => toHex(ed25519.getPublicKey(s)))})
    return f
  }
  const noKeeperWork = (f: ReturnType<typeof fixture>) => {
    expect(f.authorize).not.toHaveBeenCalled()
    expect(f.fetchImpl).not.toHaveBeenCalled()
  }
  it('carries the assembled bundle in the keeper body, unchanged, with no payment', async () => {
    const f = policyFixture(), slot = await f.app.slots.ecdsa(slotId), proof = await bundle()
    await slot.signDigest(message, {authorize: f.authorize, dualControl: proof})
    expect(f.fetchImpl).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(f.fetchImpl.mock.calls[0]![1]?.body)) as Record<string, unknown>
    expect(body.dual_control).toEqual(proof)
    expect(proof.statement).not.toHaveProperty('payment_hash')
    expect(proof.statement.request_id).toBe(toHex(requestHash(43112, hexToBytes(slotId), 'sign', sha256(message))).slice(2))
    expect(body).not.toHaveProperty('execution_authorizations')
  })
  it.each(['another digest', 'another chain', 'another key epoch', 'another operation', 'stale'] as const)('refuses a bundle for %s before credential consent or keeper work', async reason => {
    const f = policyFixture(), slot = await f.app.slots.ecdsa(slotId)
    const proof = reason === 'another chain' ? await bundle({chainId: 43113}) : reason === 'another key epoch' ? await bundle({epoch: 2})
      : reason === 'another operation' ? await bundle({operation: 'p256-sign'})
      : reason === 'stale' ? await bundle({nowSecs: Math.floor(Date.now() / 1000) - 600}) : await bundle()
    const digest = reason === 'another digest' ? new Uint8Array(32).fill(2) : message
    await expect(slot.signDigest(digest, {authorize: f.authorize, dualControl: proof})).rejects.toThrow()
    noKeeperWork(f)
  })
  it('refuses a bundle whose request id is not the operation\'s request hash', async () => {
    const f = policyFixture(), slot = await f.app.slots.ecdsa(slotId), proof = await bundle()
    const forged = {...proof, statement: {...proof.statement, request_id: 'ab'.repeat(32)}}
    await expect(slot.signDigest(message, {authorize: f.authorize, dualControl: forged})).rejects.toThrow(/request id/)
    noKeeperWork(f)
  })
  it('refuses, on a slot with an installed policy, a signature without a bundle, before credential consent', async () => {
    const f = policyFixture(), slot = await f.app.slots.ecdsa(slotId)
    await expect(slot.signDigest(message, {authorize: f.authorize})).rejects.toMatchObject({code: 'INVALID_AUTHORIZATION'})
    noKeeperWork(f)
  })
  it('refuses a bundle on a slot without a policy', async () => {
    const f = fixture(), slot = await f.app.slots.ecdsa(slotId)
    await expect(slot.signDigest(message, {authorize: f.authorize, dualControl: await bundle()})).rejects.toMatchObject({code: 'INVALID_AUTHORIZATION'})
    noKeeperWork(f)
  })
  it.each(['one approval', 'a duplicate approver', 'an approver outside the set', 'a forged approval'] as const)('refuses a bundle with %s against the on-chain quorum', async reason => {
    const f = policyFixture(), slot = await f.app.slots.ecdsa(slotId), proof = await bundle()
    const outsider = approverFor(new Uint8Array(32).fill(44))
    const statementBytes = dualOperationPayload(proof.statement)
    const forgedOutsider = {approver_pubkey: toHex(outsider.publicKey).slice(2), signature: toHex(await outsider.sign(statementBytes)).slice(2), verifier_proofs: []}
    const approvals = reason === 'one approval' ? [proof.approvals[0]!]
      : reason === 'a duplicate approver' ? [proof.approvals[0]!, proof.approvals[1]!, proof.approvals[0]!]
      : reason === 'an approver outside the set' ? [proof.approvals[0]!, forgedOutsider]
      : [proof.approvals[0]!, {...proof.approvals[1]!, signature: '00'.repeat(64)}]
    await expect(slot.signDigest(message, {authorize: f.authorize, dualControl: {...proof, approvals}}))
      .rejects.toMatchObject({code: 'INVALID_AUTHORIZATION'})
    noKeeperWork(f)
  })
  it('signs a structured transaction intent: the SDK derives the digest', async () => {
    const f = fixture(2), slot = await f.app.slots.ecdsa(slotId)
    const intent = {kind: 'transaction' as const, transaction: {chainId: 43114, type: 'eip1559' as const, to: `0x${'99'.repeat(20)}` as Hex, value: 1n, nonce: 0, gas: 21_000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n}}
    const digest = signingIntentDigest(intent)
    expect(toHex(digest)).toBe(keccak256(serializeTransaction(intent.transaction)))
    const signed = await slot.signIntent(intent, {authorize: f.authorize})
    expect(signed.digest).toEqual(digest)
    expect(await recoverAddress({hash: toHex(digest), signature: {r: toHex(signed.r), s: toHex(signed.s), yParity: signed.yParity}})).toBe(await slot.getAddress())
  })
  it('signs an approved intent on a slot with a policy: the bundle names the intent\'s digest', async () => {
    const f = policyFixture(), slot = await f.app.slots.ecdsa(slotId), intent = {kind: 'message' as const, message: 'pay 1 TSRA'}
    const signed = await slot.signIntent(intent, {authorize: f.authorize, dualControl: await bundle({digest: signingIntentDigest(intent)})})
    expect(signed.digest).toEqual(signingIntentDigest(intent))
    await expect(slot.signIntent({kind: 'message', message: 'pay 100 TSRA'}, {authorize: f.authorize, dualControl: await bundle({digest: signingIntentDigest(intent)})})).rejects.toThrow(/another operation, slot or digest/)
  })
  it('refuses an intent without a chain, an oversized one and the wrong curve', async () => {
    const f = fixture(2), slot = await f.app.slots.ecdsa(slotId)
    expect(() => signingIntentDigest({kind: 'transaction', transaction: {to: `0x${'99'.repeat(20)}`, value: 1n, nonce: 0, gas: 21_000n, gasPrice: 1n}})).toThrow(/chain/)
    expect(() => signingIntentDigest({kind: 'message', message: new Uint8Array(65_537)})).toThrow(/exceeds/)
    expect(() => signingIntentDigest({kind: 'typed-data', typedData: {domain: {name: 'x'}, types: {T: [{name: 'a', type: 'uint8'}]}, primaryType: 'T', message: {a: 1}}})).toThrow(/chain/)
    await expect(slot.signIntent({kind: 'sha256', data: new Uint8Array(1)} as never, {authorize: f.authorize})).rejects.toMatchObject({code: 'WRONG_SLOT_MODE'})
    expect(f.fetchImpl).not.toHaveBeenCalled()
  })
  it('an approver signs only the intent it reviewed, on the slot it expects', async () => {
    const intent = {kind: 'message' as const, message: 'pay 1 TSRA'}
    const payloadDigest = toHex(sha256(signingIntentDigest(intent)))
    const prepared = prepareDualOperation({chainId: 43112, slot: slotId, payloadDigest, operation: 'secp256k1-sign', epoch: 1})
    const approver = approverFor(approverSeeds[0]!)
    expect((await approveSigningIntent({prepared, slotId, intent, approver})).approval.approver_pubkey).toBe(toHex(approver.publicKey).slice(2))
    await expect(approveSigningIntent({prepared, slotId, intent: {kind: 'message', message: 'pay 100 TSRA'}, approver})).rejects.toThrow(/unexpected operation digest/)
    await expect(approveSigningIntent({prepared, slotId: `0x${'12'.repeat(32)}`, intent, approver})).rejects.toThrow(/unexpected slot/)
    await expect(approveSigningIntent({prepared: prepareDualOperation({chainId: 43112, slot: slotId, payloadDigest, operation: 'p256-sign', epoch: 1}), slotId, intent, approver})).rejects.toThrow(/names p256-sign/)
  })
})

describe('a threshold P-256 slot', () => {
  const p256Seed = new Uint8Array(32).fill(12)
  function p256Fixture() {
    const f = fixture(4)
    const publicKey = p256.getPublicKey(p256Seed, true)
    f.metadata.publicKey = toHex(publicKey)
    f.fetchImpl.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {digest: string}
      const signature = p256.sign(hexToBytes(`0x${body.digest}`), p256Seed, {prehash: false, lowS: false})
      return Response.json({mode: 'tecdsa-p256', group_public_key: toHex(publicKey), signature_r: toHex(signature.r, {size: 32}), signature_s: toHex(signature.s, {size: 32})})
    })
    return {...f, publicKey}
  }
  it('signs the SHA-256 of exact bytes and verifies under the anchored key', async () => {
    const f = p256Fixture(), slot = await f.app.slots.p256(slotId), data = new TextEncoder().encode('webauthn client data')
    expect(await slot.getPublicKey()).toEqual(f.publicKey)
    const result = await slot.signIntent({kind: 'sha256', data}, {authorize: f.authorize})
    expect(result.digest).toEqual(sha256(data))
    expect(p256.verify(new Uint8Array([...result.r, ...result.s]), sha256(data), f.publicKey, {prehash: false, lowS: false})).toBe(true)
    expect((JSON.parse(String(f.fetchImpl.mock.calls[0]![1]?.body)) as {digest: string}).digest).toBe(toHex(sha256(data)).slice(2))
  })
  it('refuses a signature without a bundle on a slot with an installed policy, and a key that differs from the anchored one', async () => {
    const f = p256Fixture(), slot = await f.app.slots.p256(slotId)
    f.policy.quorum = 2
    await expect(slot.signDigest(new Uint8Array(32), {authorize: f.authorize})).rejects.toMatchObject({code: 'INVALID_AUTHORIZATION'})
    expect(f.fetchImpl).not.toHaveBeenCalled()
    f.policy.quorum = 0
    f.metadata.publicKey = toHex(p256.getPublicKey(new Uint8Array(32).fill(13), true))
    await expect(slot.signDigest(new Uint8Array(32), {authorize: f.authorize})).rejects.toThrow(/differs from the slot key/)
  })
  it('refuses a secp256k1 slot', async () => {
    await expect(fixture(2).app.slots.p256(slotId)).rejects.toMatchObject({code: 'WRONG_SLOT_MODE'})
  })
})
