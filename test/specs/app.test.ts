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
import * as prepaid from '../../src/chain/prepaid.js'
import {paymentIntentHash, prepaidRequestId, type PaymentIntentWire} from '../../src/committee/payment.js'
import {keeperExecutionFixture} from '../support/keeperExecution.js'
import type {ClientExecutionSigner, ExecutionAuthorization} from '../../src/committee/execution.js'
import {createDecryptionRecipient, decryptionBinding} from '../../src/crypto/recipient.js'
import {sealIbeFixture} from '../support/sealedIbe.js'
import {approveDualOperation, assembleDualOperation, dualOperationPayload, prepareDualOperation} from '../../src/committee/dual-operation.js'
import {approveSigningIntent, signingIntentDigest} from '../../src/app/signing-intents.js'
import {p256} from '@noble/curves/p256'

const executionSigners: (ClientExecutionSigner & {dispose():void})[] = []
afterEach(() => { executionSigners.splice(0).forEach(signer=>signer.dispose()); vi.restoreAllMocks(); vi.useRealTimers() })

const slotId: Hex = `0x${'11'.repeat(32)}`, operator: Hex = `0x${'22'.repeat(20)}`
const seed = new Uint8Array(32).fill(9), keeperKey = ed25519.getPublicKey(seed)
const deployment: TasraDeployment = {schemaVersion: 1, name: 'test', chainId: 43112, rpcUrl: 'http://localhost:9650',
  addresses: {KeyRegistry: `0x${'33'.repeat(20)}`, NodeRegistry: `0x${'44'.repeat(20)}`, Settlement: `0x${'55'.repeat(20)}`}, coordinator: 'lowest-operator-id'}
const vector = JSON.parse(readFileSync(new URL('../ibe-vectors.json', import.meta.url), 'utf8')) as {mpk: string; identity: string; shares: {identifier: number; d_i: string}[]; verifying_shares: {g2: string; g1: string}[]}
const unhex = (v: string) => new Uint8Array(Buffer.from(v.replace(/^0x/, ''), 'hex'))
const recipient = await createDecryptionRecipient()
const binding = decryptionBinding(sha256(new TextEncoder().encode(vector.identity)), 1, recipient)
const extractionOptions = {recipient, verifyingShares: new Map(vector.shares.map((s, i) => [s.identifier, new Uint8Array([...unhex(vector.verifying_shares[i]!.g2), ...unhex(vector.verifying_shares[i]!.g1)])]))}
function fixture(mode = 2, options: Partial<Pick<TasraApplicationConfig, 'keeperUrl' | 'allowLocalPaidHttp'>> = {}) {
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

async function paidFixture(mode = 2, options: Parameters<typeof fixture>[1] = {}) {
  const f = fixture(mode, options), random: Hex = `0x${'66'.repeat(32)}`, message = new Uint8Array(32).fill(1)
  const action = mode === 1 ? 'ibe-extract' : 'sign'
  const digest = mode === 1 ? binding.payloadDigest : payloadDigestFor(action, {message})
  const otherKey = ed25519.getPublicKey(new Uint8Array(32).fill(10))
  const consent = await keeperExecutionFixture(mode===2?'eoa-sign':action,toHex(digest),{
    chain_id:deployment.chainId,settlement:deployment.addresses.Settlement!,key_registry:deployment.addresses.KeyRegistry!,slot:slotId,
    session_commitment:random,nonce:random,verification_epoch:1,verification_seed:random,verification_root:random,
    verification_registry_size:3,keeper_assignment:{key_epoch:1,committee_version:1,threshold:2,
      coordinator:[...keeperKey],contributors:[toHex(keeperKey),toHex(otherKey)].sort().map(key=>[...hexToBytes(key)])}})
  executionSigners.push(consent.signer)
  const {payment,execution}=consent
  const endpoint = {operator, publicKey: toHex(keeperKey), url: 'https://paid.example'}
  const contributors=[keeperKey,otherKey].map((key,i)=>({...endpoint,publicKey:toHex(key),
    operator:`0x${(i+1).toString(16).padStart(40,'0')}` as Hex,url:mode===1?`https://keeper-${i}.example`:i===0?endpoint.url:'https://other-keeper.example'}))
  const target: prepaid.PaidKeeperTarget = {...endpoint,contributors,receipt:{blockTimestamp:BigInt(Math.floor(Date.now()/1000)),
    blockNumber:20n,blockHash:random,assignmentBlock:random,requestId:prepaidRequestId(payment),cost:9n,refunded:0n,settled:false},groupPublicKey:f.metadata.publicKey,mode}
  // Canonical RPC/creator/roster checks have separate chain.paid-route regressions.
  // Here the boundary is controlled to exercise the app's consent and actual crypto results.
  const resolve = vi.spyOn(prepaid, 'resolvePaidKeeperTarget').mockResolvedValue(target)
  const authorize = vi.fn<OperationAuthorizer>(async request => {
    const grant = await f.authorize(request)
    return {...grant, token: {...grant.token, payment: structuredClone(payment), payment_hash: paymentIntentHash(payment), exp: payment.expires}}
  })
  return {...f, authorize, unpaidAuthorize: f.authorize, payment, random, message, target, resolve,execution}
}

describe('paid application execution', () => {
  it.each([0, 2])('routes mode %i to the paid coordinator with fixed consent and verifies its signature', async mode => {
    const f = await paidFixture(mode)
    const options = {authorize: f.authorize, payment: f.payment, random: f.random,execution:f.execution}
    if (mode === 2) await (await f.app.slots.ecdsa(slotId)).signDigest(f.message, options)
    else await (await f.app.slots.frost(slotId)).sign(f.message, options)
    expect(f.fetchImpl).toHaveBeenCalledTimes(1)
    expect(String(f.fetchImpl.mock.calls[0]![0])).toMatch(/^https:\/\/paid\.example\//)
    expect(f.chain.readers.keyRegistry.assignedNodes).not.toHaveBeenCalled()
    // Before and after the wallet step; the keeper approval reuses the second read.
    expect(f.resolve).toHaveBeenCalledTimes(2)
    const sent=JSON.parse(String(f.fetchImpl.mock.calls[0]![1]?.body)) as {execution_authorizations:ExecutionAuthorization[]}
    expect(sent.execution_authorizations.map(proof=>proof.stage).sort()).toEqual(['contributor','contributor','coordinator'])
    expect(f.resolve.mock.calls[0]![3].action).toBe(mode === 2 ? 'eoa-sign' : 'sign')
    const request = f.authorize.mock.calls[0]![0]
    expect(request.payment).toEqual(f.payment)
    expect(request.random).toBe(f.random)
    expect(request.nowSecs! + request.ttlSecs!).toBe(f.payment.expires)
  })
  it('extracts real IBE shares only from signed contributors', async () => {
    const f = await paidFixture(1), slot = await f.app.slots.bls(slotId)
    const plaintext = new TextEncoder().encode('paid note')
    const ciphertext = await slot.encryptForIdentity(vector.identity, plaintext)
    const result = await slot.decryptForIdentity(vector.identity, ciphertext, {...extractionOptions, authorize: f.authorize, payment: f.payment, random: f.random, execution: f.execution})
    expect(result.plaintext).toEqual(plaintext)
    expect(f.fetchImpl.mock.calls.map(([url]) => new URL(String(url)).hostname).sort()).toEqual(['keeper-0.example', 'keeper-1.example'])
    expect(f.chain.readers.keyRegistry.assignedNodes).not.toHaveBeenCalled()
  })
  it.each(['unfunded', 'expired', 'mapped-http', 'missing-random'])('refuses %s before credential consent or keeper work', async reason => {
    const f = await paidFixture(2, reason === 'mapped-http' ? {keeperUrl: () => 'http://paid.example'} : {})
    if (reason === 'unfunded') f.resolve.mockRejectedValue(new Error('reservation not funded'))
    if (reason === 'expired') f.payment.expires = 1
    const slot = await f.app.slots.ecdsa(slotId)
    await expect(slot.signDigest(f.message, {authorize: f.authorize, payment: f.payment, random: reason === 'missing-random' ? undefined : f.random, execution: f.execution})).rejects.toThrow()
    expect(f.authorize).not.toHaveBeenCalled()
    expect(f.fetchImpl).not.toHaveBeenCalled()
  })
  it.each(['downgrade', 'substitution', 'settlement', 'rotation'])('refuses %s during wallet authorization before keeper work', async reason => {
    const f = await paidFixture(), slot = await f.app.slots.ecdsa(slotId)
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
    await expect(slot.signDigest(f.message, {authorize, payment: f.payment, random: f.random, execution: f.execution})).rejects.toThrow()
    expect(f.fetchImpl).not.toHaveBeenCalled()
  })
  it('keeps the original payment if a consent callback mutates its copy', async () => {
    const f = await paidFixture(), slot = await f.app.slots.ecdsa(slotId), original = structuredClone(f.payment)
    await slot.signDigest(f.message, {payment: f.payment, random: f.random, execution: f.execution, authorize: async request => {
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
    const f = await paidFixture(), slot = await f.app.slots.ecdsa(slotId)
    f.fetchImpl.mockRejectedValue(new Error('connection lost'))
    await expect(slot.signDigest(f.message, {authorize: f.authorize, payment: f.payment, random: f.random, execution: f.execution})).rejects.toThrow()
    expect(f.fetchImpl).toHaveBeenCalledTimes(1)
    expect(f.chain.readers.keyRegistry.assignedNodes).not.toHaveBeenCalled()
  })
  it('allows mapped local HTTP only with the explicit local transport option', async () => {
    const f = await paidFixture(2, {keeperUrl: url => url==='https://paid.example'?'http://127.0.0.1:18080':'http://127.0.0.1:18081', allowLocalPaidHttp: true})
    await (await f.app.slots.ecdsa(slotId)).signDigest(f.message, {authorize: f.authorize, payment: f.payment, random: f.random, execution: f.execution})
    expect(String(f.fetchImpl.mock.calls[0]![0])).toMatch(/^http:\/\/127\.0\.0\.1:18080\//)
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
    await vi.waitFor(() => expect(f.chain.readers.keyRegistry.assignedNodes).toHaveBeenCalledTimes(1))
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
      await vi.waitFor(() => expect(f.fetchImpl).toHaveBeenCalledTimes(1))
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
    await vi.waitFor(() => expect(f.fetchImpl).toHaveBeenCalledTimes(1))
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

describe('native approvals on a paid threshold ECDSA signature', () => {
  const approverSeeds = [31, 32, 33].map(n => new Uint8Array(32).fill(n))
  const approverFor = (seedBytes: Uint8Array) => ({publicKey: ed25519.getPublicKey(seedBytes), sign: async (payload: Uint8Array) => ed25519.sign(payload, seedBytes)})
  async function bundle(f: Awaited<ReturnType<typeof paidFixture>>, change: {digest?: Uint8Array; payment?: PaymentIntentWire; nowSecs?: number} = {}) {
    const payment = change.payment ?? f.payment
    const prepared = prepareDualOperation({payment, operation: 'secp256k1-sign', epoch: 1, ...(change.nowSecs !== undefined ? {nowSecs: change.nowSecs} : {})})
    const records = await Promise.all(approverSeeds.slice(0, 2).map(s => approveDualOperation({prepared, payment, expectSlot: slotId,
      expectPayloadDigest: payment.payload_digest, approver: approverFor(s), ...(change.nowSecs !== undefined ? {nowSecs: change.nowSecs} : {})})))
    return assembleDualOperation({prepared, approvals: records, quorum: 2, ...(change.nowSecs !== undefined ? {nowSecs: change.nowSecs} : {})})
  }
  it('carries the assembled bundle inside the client-approved keeper body, unchanged', async () => {
    const f = await policyFixture(), slot = await f.app.slots.ecdsa(slotId), proof = await bundle(f)
    await slot.signDigest(f.message, {authorize: f.authorize, payment: f.payment, random: f.random, execution: f.execution, dualControl: proof})
    expect(f.fetchImpl).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(f.fetchImpl.mock.calls[0]![1]?.body)) as {dual_control: unknown; execution_authorizations: ExecutionAuthorization[]}
    expect(body.dual_control).toEqual(proof)
    // The keeper approvals sign the complete body: the bundle is inside what the client consented to.
    expect(body.execution_authorizations).toHaveLength(3)
  })
  it.each(['another digest', 'another payment', 'stale', 'no payment'] as const)('refuses a bundle for %s before credential consent or keeper work', async reason => {
    const f = await paidFixture(2), slot = await f.app.slots.ecdsa(slotId)
    const other = {...f.payment, nonce: `0x${'77'.repeat(32)}` as Hex}
    const proof = reason === 'another payment' ? await bundle(f, {payment: other})
      : reason === 'stale' ? await bundle(f, {nowSecs: Math.floor(Date.now() / 1000) - 600}) : await bundle(f)
    const digest = reason === 'another digest' ? new Uint8Array(32).fill(2) : f.message
    const options = reason === 'no payment' ? {authorize: f.unpaidAuthorize, dualControl: proof}
      : {authorize: f.authorize, payment: f.payment, random: f.random, execution: f.execution, dualControl: proof}
    await expect(slot.signDigest(digest, options)).rejects.toThrow()
    expect(f.authorize).not.toHaveBeenCalled()
    expect(f.unpaidAuthorize).not.toHaveBeenCalled()
    expect(f.fetchImpl).not.toHaveBeenCalled()
  })
  /** The paid fixture with a static 2-of-3 policy installed on chain. */
  async function policyFixture(mode = 2) {
    const f = await paidFixture(mode)
    Object.assign(f.policy, {quorum: 2, approvers: approverSeeds.map(s => toHex(ed25519.getPublicKey(s)))})
    return f
  }
  const noKeeperWork = (f: Awaited<ReturnType<typeof paidFixture>>) => {
    expect(f.authorize).not.toHaveBeenCalled()
    expect(f.unpaidAuthorize).not.toHaveBeenCalled()
    expect(f.fetchImpl).not.toHaveBeenCalled()
  }
  it('refuses, on a slot with an installed policy, a signature without a bundle, before credential consent', async () => {
    const f = await policyFixture(), slot = await f.app.slots.ecdsa(slotId)
    await expect(slot.signDigest(f.message, {authorize: f.authorize, payment: f.payment, random: f.random, execution: f.execution})).rejects.toMatchObject({code: 'INVALID_AUTHORIZATION'})
    noKeeperWork(f)
  })
  it.each(['one approval', 'a duplicate approver', 'an approver outside the set', 'a forged approval'] as const)('refuses a bundle with %s against the on-chain quorum', async reason => {
    const f = await policyFixture(), slot = await f.app.slots.ecdsa(slotId), proof = await bundle(f)
    const outsider = approverFor(new Uint8Array(32).fill(44))
    const statementBytes = dualOperationPayload(proof.statement)
    const forgedOutsider = {approver_pubkey: toHex(outsider.publicKey).slice(2), signature: toHex(await outsider.sign(statementBytes)).slice(2), verifier_proofs: []}
    const approvals = reason === 'one approval' ? [proof.approvals[0]!]
      : reason === 'a duplicate approver' ? [proof.approvals[0]!, proof.approvals[1]!, proof.approvals[0]!]
      : reason === 'an approver outside the set' ? [proof.approvals[0]!, forgedOutsider]
      : [proof.approvals[0]!, {...proof.approvals[1]!, signature: '00'.repeat(64)}]
    await expect(slot.signDigest(f.message, {authorize: f.authorize, payment: f.payment, random: f.random, execution: f.execution, dualControl: {...proof, approvals}}))
      .rejects.toMatchObject({code: 'INVALID_AUTHORIZATION'})
    noKeeperWork(f)
  })
  it('signs a structured transaction intent: the SDK derives the digest, and the payment must pay for exactly it', async () => {
    const f = await paidFixture(2), slot = await f.app.slots.ecdsa(slotId)
    const intent = {kind: 'transaction' as const, transaction: {chainId: 43114, type: 'eip1559' as const, to: `0x${'99'.repeat(20)}` as Hex, value: 1n, nonce: 0, gas: 21_000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n}}
    const digest = signingIntentDigest(intent)
    expect(toHex(digest)).toBe(keccak256(serializeTransaction(intent.transaction)))
    // The fixture's payment pays for its own message, not for this transaction.
    await expect(slot.signIntent(intent, {authorize: f.authorize, payment: f.payment, random: f.random, execution: f.execution})).rejects.toThrow(/does not pay for this signing intent/)
    noKeeperWork(f)
    const unpaid = await slot.signIntent(intent, {authorize: f.unpaidAuthorize})
    expect(unpaid.digest).toEqual(digest)
    expect(await recoverAddress({hash: toHex(digest), signature: {r: toHex(unpaid.r), s: toHex(unpaid.s), yParity: unpaid.yParity}})).toBe(await slot.getAddress())
  })
  it('refuses an intent without a chain, an oversized one and the wrong curve', async () => {
    const f = fixture(2), slot = await f.app.slots.ecdsa(slotId)
    expect(() => signingIntentDigest({kind: 'transaction', transaction: {to: `0x${'99'.repeat(20)}`, value: 1n, nonce: 0, gas: 21_000n, gasPrice: 1n}})).toThrow(/chain/)
    expect(() => signingIntentDigest({kind: 'message', message: new Uint8Array(65_537)})).toThrow(/exceeds/)
    expect(() => signingIntentDigest({kind: 'typed-data', typedData: {domain: {name: 'x'}, types: {T: [{name: 'a', type: 'uint8'}]}, primaryType: 'T', message: {a: 1}}})).toThrow(/chain/)
    await expect(slot.signIntent({kind: 'sha256', data: new Uint8Array(1)} as never, {authorize: f.authorize})).rejects.toMatchObject({code: 'WRONG_SLOT_MODE'})
    expect(f.fetchImpl).not.toHaveBeenCalled()
  })
  it('an approver signs only the intent it reviewed, against the payment for exactly that intent', async () => {
    const f = await paidFixture(2), intent = {kind: 'message' as const, message: 'pay 1 TSRA'}
    const digest = signingIntentDigest(intent)
    const payment = {...f.payment, payload_digest: toHex(sha256(digest))}
    const prepared = prepareDualOperation({payment, operation: 'secp256k1-sign', epoch: 1})
    const approver = approverFor(approverSeeds[0]!)
    expect((await approveSigningIntent({prepared, payment, intent, approver})).approval.approver_pubkey).toBe(toHex(approver.publicKey).slice(2))
    await expect(approveSigningIntent({prepared, payment, intent: {kind: 'message', message: 'pay 100 TSRA'}, approver})).rejects.toThrow(/does not pay/)
    await expect(approveSigningIntent({prepared: prepareDualOperation({payment, operation: 'p256-sign', epoch: 1}), payment, intent, approver})).rejects.toThrow(/names p256-sign/)
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
