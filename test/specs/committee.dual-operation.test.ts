// Operation dual-control statements, approvals and the dual_control bundle, checked against
// keykeeper_committee::dual_operation byte for byte. The statement binds no payment.
import {afterEach, describe, expect, it, vi} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import {sha256} from '@noble/hashes/sha256'
import {approveDualOperation, assembleDualOperation, dualOperationFromPayload, dualOperationPayload, dualOperationRequestId, prepareDualOperation, requireCurrentDualOperation,
  requireDualOperationProof, requireDualOperationRequest, validateDualOperationStatement, DUAL_OPERATION_DOMAIN,
  type DualOperationApprover, type DualOperationKind, type DualOperationStatement} from '../../src/committee/dual-operation.js'
import {committeeSignEoaDigest, committeeSignP256Digest} from '../../src/committee/ecdsa.js'
import {collectSealedPartials} from '../../src/decryption/sealed.js'
import {requestHash, type CommitteeAction} from '../../src/oid4vp/binding.js'
import type {CompoundTokenWire} from '../../src/committee/token.js'
import {p256} from '@noble/curves/p256'

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')
const h = (n: number, len = 32) => `0x${n.toString(16).padStart(2, '0').repeat(len)}` as const
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

const SLOT = new Uint8Array(32).fill(1), DIGEST = new Uint8Array(32).fill(2)
const idFor = (operation: DualOperationKind, chainId = 43112) => dualOperationRequestId(chainId, SLOT, operation, DIGEST)
const statement = (over: Partial<DualOperationStatement> = {}): DualOperationStatement => {
  const operation = over.operation ?? 'secp256k1-sign'
  return {chain_id: 43112, slot: [...SLOT], operation, epoch: 2, payload_digest: [...DIGEST], request_id: over.request_id ?? idFor(operation),
    issued_at: 1_800_000_000, expires_at: 1_800_000_120, identity: null, ...over}
}
const approver = (seed: number): DualOperationApprover & {secret: Uint8Array} => {
  const secret = new Uint8Array(32).fill(seed)
  return {secret, publicKey: ed25519.getPublicKey(secret), sign: async bytes => ed25519.sign(bytes, secret)}
}
/** A prepared statement for signing `digest` on the test slot. */
const prepare = (over: Partial<Parameters<typeof prepareDualOperation>[0]> = {}) =>
  prepareDualOperation({chainId: 43112, slot: h(1), payloadDigest: h(2), operation: 'secp256k1-sign', epoch: 2, ...over})
const expectations = {expectSlot: h(1), expectPayloadDigest: h(2)}

describe('statement encoding: identical to keykeeper_committee::dual_operation', () => {
  it('produces exactly the reference payload bytes: the domain, then the fields in order, with no payment', () => {
    // keykeeper_committee::dual_operation::tests::the_signed_bytes_carry_no_payment, field for field.
    const s = statement({chain_id: 43113, operation: 'kem-decrypt', request_id: idFor('kem-decrypt', 43113), issued_at: 10, expires_at: 30})
    const ones = Array(32).fill('1').join(','), twos = Array(32).fill('2').join(',')
    const json = `{"chain_id":43113,"slot":[${ones}],"operation":"kem-decrypt","epoch":2,"payload_digest":[${twos}],"request_id":"${s.request_id}","issued_at":10,"expires_at":30,"identity":null}`
    const bytes = dualOperationPayload(s)
    expect(new TextDecoder().decode(DUAL_OPERATION_DOMAIN)).toBe('keykeeper:dual-operation:v1\0')
    expect(hex(bytes.subarray(0, DUAL_OPERATION_DOMAIN.length))).toBe(hex(DUAL_OPERATION_DOMAIN))
    expect(new TextDecoder().decode(bytes.subarray(DUAL_OPERATION_DOMAIN.length))).toBe(json)
    // A non-ASCII IBE identity is serde_json's compact string encoding.
    const ibe = dualOperationPayload(statement({operation: 'ibe-extract', identity: 'issuer/patient/é"x'}))
    expect(new TextDecoder().decode(ibe.subarray(DUAL_OPERATION_DOMAIN.length))).toMatch(/"identity":"issuer\/patient\/é\\"x"\}$/)
  })
  it('refuses a payload that still carries the retired payment_hash', () => {
    const bytes = dualOperationPayload(statement())
    const json = new TextDecoder().decode(bytes.subarray(DUAL_OPERATION_DOMAIN.length)).replace('"issued_at"', '"payment_hash":[],"issued_at"')
    expect(() => dualOperationFromPayload(new Uint8Array([...DUAL_OPERATION_DOMAIN, ...new TextEncoder().encode(json)]))).toThrow(/fields/)
    expect(() => validateDualOperationStatement({...statement(), payment_hash: Array(32).fill(3)})).toThrow(/fields/)
  })
  it.each([['frost-sign', 'sign'], ['secp256k1-sign', 'sign'], ['p256-sign', 'sign'], ['kem-decrypt', 'decrypt'], ['ibe-extract', 'ibe-extract']] as [DualOperationKind, CommitteeAction][])(
    'the request id of %s is the lowercase hex request hash under action %s', (operation, action) => {
      expect(dualOperationRequestId(43112, SLOT, operation, DIGEST)).toBe(hex(requestHash(43112, SLOT, action, DIGEST)))
      expect(dualOperationRequestId(43113, SLOT, operation, DIGEST)).not.toBe(dualOperationRequestId(43112, SLOT, operation, DIGEST))
    })
  it('round-trips, refuses non-canonical bytes and is time-bound like require_current', () => {
    const bytes = dualOperationPayload(statement())
    expect(dualOperationFromPayload(bytes)).toEqual(statement())
    expect(() => dualOperationFromPayload(new Uint8Array([...bytes, 0x20]))).toThrow(/noncanonical|encoding/)
    expect(() => requireCurrentDualOperation(statement(), 1_799_999_999)).toThrow(/not current/)
    expect(() => requireCurrentDualOperation(statement(), 1_800_000_120)).toThrow(/not current/)
    expect(() => requireCurrentDualOperation(statement(), 1_800_000_000)).not.toThrow()
  })
  it('refuses a lifetime over 300 s, a negative epoch, a bad request id, unknown fields and a misplaced identity', () => {
    expect(() => dualOperationPayload(statement({expires_at: 1_800_000_301}))).toThrow(/lifetime/)
    expect(() => dualOperationPayload(statement({epoch: -1}))).toThrow(/epoch/)
    expect(() => dualOperationPayload(statement({request_id: 'AB'.repeat(32)}))).toThrow(/request/)
    expect(() => dualOperationPayload({...statement(), extra: 1} as unknown as DualOperationStatement)).toThrow(/fields/)
    expect(() => dualOperationPayload(statement({identity: 'x'}))).toThrow(/only valid for IBE/)
    expect(() => dualOperationPayload(statement({operation: 'ibe-extract'}))).toThrow(/bounded identity/)
  })
})

describe('prepare, approve and assemble', () => {
  it('binds the statement to the operation request alone: chain, slot, operation, epoch, digest and its request hash', () => {
    const prepared = prepare({ttlSecs: 300, nowSecs: 1_800_000_000})
    expect(prepared.statement).toEqual(statement({expires_at: 1_800_000_300}))
    expect(prepared.statement).not.toHaveProperty('payment_hash')
    expect(prepared.message_hex).toBe(hex(dualOperationPayload(prepared.statement)))
    expect(prepared.payload_digest).toBe(hex(sha256(dualOperationPayload(prepared.statement))))
    expect(prepared.action).toBe('dual-approve')
    // The same operation on another chain or under another operation kind is another request.
    expect(prepare({chainId: 43113}).statement.request_id).not.toBe(prepared.statement.request_id)
    expect(prepare({operation: 'kem-decrypt'}).statement.request_id).toBe(idFor('kem-decrypt'))
    expect(prepare({operation: 'ibe-extract', identity: 'patient/1'}).statement.identity).toBe('patient/1')
  })
  it('accepts the slot and digest as bytes or hex, and refuses another length', () => {
    expect(prepare({slot: SLOT, payloadDigest: DIGEST, nowSecs: 5}).statement).toEqual(prepare({nowSecs: 5}).statement)
    expect(() => prepare({slot: h(1, 31)})).toThrow(/32 bytes/)
    expect(() => prepare({payloadDigest: new Uint8Array(31)})).toThrow(/invalid dual-operation request/)
  })
  it('an approver checks the carried bytes, the request id and its own expectations before signing', async () => {
    const prepared = prepare()
    const base = {prepared, ...expectations, approver: approver(11)}
    const record = await approveDualOperation(base)
    expect(ed25519.verify(Buffer.from(record.approval.signature, 'hex'), dualOperationPayload(prepared.statement), approver(11).publicKey)).toBe(true)
    await expect(approveDualOperation({...base, prepared: {...prepared, message_hex: '00'}})).rejects.toThrow(/payload differs/)
    await expect(approveDualOperation({...base, expectSlot: h(9)})).rejects.toThrow(/unexpected slot/)
    await expect(approveDualOperation({...base, expectPayloadDigest: h(9)})).rejects.toThrow(/unexpected operation digest/)
    // A statement whose request id is not its operation's request hash is one no keeper admits: never signed.
    const forged = {...prepared.statement, request_id: 'ab'.repeat(32)}
    await expect(approveDualOperation({...base, prepared: {...prepared, statement: forged, message_hex: hex(dualOperationPayload(forged))}})).rejects.toThrow(/request id differs/)
    const sign = vi.fn()
    await expect(approveDualOperation({...base, approver: {publicKey: approver(11).publicKey, sign: async b => { sign(); return ed25519.sign(b, new Uint8Array(32).fill(12)) }}}))
      .rejects.toThrow(/Invalid local approval signature/)
    expect(sign).toHaveBeenCalled()
  })
  it('a credentialed approval needs a holder-bound grant over THIS statement', async () => {
    const prepared = prepare()
    const bound = requestHash(43112, Uint8Array.from(prepared.statement.slot), 'dual-approve', sha256(dualOperationPayload(prepared.statement)))
    const grant = (token: Partial<CompoundTokenWire>) => ({compound_token: {binding: 'holder_key', request_hash: `0x${hex(bound)}`, ...token} as CompoundTokenWire, verifier_proofs: []})
    const base = {prepared, ...expectations, approver: approver(11)}
    expect((await approveDualOperation({...base, authorization: grant({})})).approval.committee_token).toBeDefined()
    await expect(approveDualOperation({...base, authorization: grant({request_hash: h(1)})})).rejects.toThrow(/another approval/)
    await expect(approveDualOperation({...base, authorization: grant({binding: 'bearer' as never})})).rejects.toThrow(/holder-bound/)
  })
  it('assembles distinct, verified approvals of one statement up to the quorum', async () => {
    const prepared = prepare(), base = {prepared, ...expectations}
    const a = await approveDualOperation({...base, approver: approver(11)}), b = await approveDualOperation({...base, approver: approver(12)})
    expect(assembleDualOperation({prepared, approvals: [a, b], quorum: 2}).approvals).toHaveLength(2)
    expect(() => assembleDualOperation({prepared, approvals: [a], quorum: 2})).toThrow(/needs 2 distinct/)
    expect(() => assembleDualOperation({prepared, approvals: [a, a], quorum: 2})).toThrow(/duplicate approver/)
    expect(() => assembleDualOperation({prepared, approvals: [a, {...b, statement: {...b.statement, epoch: 3}}], quorum: 2})).toThrow(/different operations/)
    expect(() => assembleDualOperation({prepared, approvals: [a, {...b, approval: {...b.approval, signature: '00'.repeat(64)}}], quorum: 2})).toThrow(/does not verify/)
  })
  it('an expired statement is refused at approve and assemble', async () => {
    const prepared = prepare({ttlSecs: 10})
    const later = prepared.statement.expires_at
    await expect(approveDualOperation({prepared, ...expectations, approver: approver(11), nowSecs: later})).rejects.toThrow(/not current/)
    expect(() => assembleDualOperation({prepared, approvals: [], quorum: 1, nowSecs: later})).toThrow(/not current/)
  })
})

describe('the dual_control body, with no payment anywhere', () => {
  const digest = new Uint8Array(32).fill(9), slot = h(3)
  const valid = {mode: 'tecdsa', group_public_key: '02' + '22'.repeat(32), signature_r: '33'.repeat(32), signature_s: '44'.repeat(32), signature_v: 1}
  async function bundle(operation: DualOperationKind = 'secp256k1-sign') {
    const payloadDigest = `0x${hex(sha256(digest))}`
    const prepared = prepareDualOperation({chainId: 43112, slot, payloadDigest, operation, epoch: 2})
    const base = {prepared, expectSlot: slot, expectPayloadDigest: payloadDigest}
    const proof = assembleDualOperation({prepared, approvals: [await approveDualOperation({...base, approver: approver(11)}), await approveDualOperation({...base, approver: approver(12)})], quorum: 2})
    return {proof, token: {token_type: 'JWT', slot_id: slot} as unknown as CompoundTokenWire}
  }
  it('carries the checked bundle inside the eoa-digest request body of an unpaid token', async () => {
    const {proof, token} = await bundle()
    const fetcher = vi.fn(() => Promise.resolve(Response.json(valid)))
    vi.stubGlobal('fetch', fetcher)
    await committeeSignEoaDigest({nodeUrl: 'https://keeper.example', committeeToken: token, digest, dualControl: proof, chainId: 43112})
    const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://keeper.example/v1/committee/sign/eoa-digest')
    const body = JSON.parse(request.body as string) as Record<string, unknown>
    expect(body.dual_control).toEqual(proof)
    // A keeper refuses unknown fields: nothing of the retired payment flow is sent.
    expect(Object.keys(body).sort()).toEqual(['committee_token', 'digest', 'dual_control'])
  })
  it('a P-256 slot carries its own bundle the same way', async () => {
    const {proof, token} = await bundle('p256-sign')
    const seed = new Uint8Array(32).fill(12), key = p256.getPublicKey(seed, true), signature = p256.sign(digest, seed, {prehash: false, lowS: false})
    const fetcher = vi.fn(() => Promise.resolve(Response.json({mode: 'tecdsa-p256', group_public_key: hex(key),
      signature_r: signature.r.toString(16).padStart(64, '0'), signature_s: signature.s.toString(16).padStart(64, '0')})))
    vi.stubGlobal('fetch', fetcher)
    await committeeSignP256Digest({nodeUrl: 'https://keeper.example', committeeToken: token, digest, groupPublicKey: key, dualControl: proof, chainId: 43112})
    const [, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect((JSON.parse(request.body as string) as {dual_control: unknown}).dual_control).toEqual(proof)
  })
  it('refuses, before any request, a bundle for another digest, curve or chain, or without the chain', async () => {
    const {proof, token} = await bundle()
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const opts = {nodeUrl: 'https://keeper.example', committeeToken: token, digest, dualControl: proof, chainId: 43112}
    await expect(committeeSignEoaDigest({...opts, digest: new Uint8Array(32).fill(8)})).rejects.toThrow(/another operation, slot or digest/)
    await expect(committeeSignEoaDigest({...opts, chainId: 43113})).rejects.toThrow(/another operation, slot or digest/)
    await expect(committeeSignEoaDigest({...opts, chainId: undefined})).rejects.toThrow(/chainId/)
    await expect(committeeSignEoaDigest({...opts, dualControl: {...proof, statement: {...proof.statement, operation: 'p256-sign'}}})).rejects.toThrow(/another operation/)
    await expect(committeeSignEoaDigest({...opts, committeeToken: {...token, slot_id: h(4)}})).rejects.toThrow(/another operation, slot or digest/)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('a sealed KEM decrypt request carries the bundle in every keeper body', async () => {
    const {proof} = await bundle('kem-decrypt')
    const bodies: Record<string, unknown>[] = []
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => { bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>); return new Response('{}', {status: 403}) })
    const {createDecryptionRecipient, recipientPayloadDigest, kemContentDigest} = await import('../../src/crypto/recipient.js')
    const recipient = await createDecryptionRecipient()
    const ciphertext = {u: new Uint8Array(96).fill(1), nonce: new Uint8Array(12), aeadCt: new Uint8Array(20)}, identity = new TextEncoder().encode('scope')
    const payload = recipientPayloadDigest(kemContentDigest(ciphertext, identity), 2, recipient.recipient)
    const token = {token_type: 'JWT', slot_id: slot, request_hash: `0x${hex(requestHash(43112, Buffer.from(slot.slice(2), 'hex'), 'decrypt', payload))}`} as unknown as CompoundTokenWire
    await collectSealedPartials({nodeUrls: ['https://k1.example', 'https://k2.example'], chainId: 43112, committeeToken: token, recipient, ciphertextEpoch: 2,
      verifyingShares: new Map([[1, new Uint8Array(144)], [2, new Uint8Array(144)]]), threshold: 2, dualControl: proof, fetchImpl}, 'decrypt', identity, ciphertext).catch(() => undefined)
    expect(bodies).toHaveLength(2)
    for (const body of bodies) {
      expect(body.dual_control).toEqual(proof)
      expect(body).not.toHaveProperty('payment')
      expect(body).not.toHaveProperty('execution_authorizations')
    }
  })
})

describe('dual-operation boundary refusals', () => {
  it('refuses a statement that is not an object or carries a field of the wrong type', () => {
    for (const s of [null, 'statement', [statement()]]) expect(() => validateDualOperationStatement(s)).toThrow(/^invalid dual-operation statement$/)
    expect(() => validateDualOperationStatement(statement({chain_id: -1}))).toThrow(/statement types/)
    expect(() => validateDualOperationStatement(statement({slot: Array(31).fill(1)}))).toThrow(/statement types/)
    expect(() => validateDualOperationStatement(statement({payload_digest: Array(32).fill(256)}))).toThrow(/statement types/)
    expect(() => validateDualOperationStatement(statement({operation: 'ed25519-sign' as DualOperationStatement['operation'], request_id: 'ab'.repeat(32)}))).toThrow(/statement types/)
    expect(() => validateDualOperationStatement(statement({identity: 7 as unknown as string}))).toThrow(/statement types/)
  })
  it('parses only bounded, correctly-domained, valid UTF-8 JSON payloads', () => {
    const bytes = dualOperationPayload(statement())
    expect(() => dualOperationFromPayload(new Uint8Array(8193))).toThrow(/exceeds limit/)
    const wrong = bytes.slice(); wrong[0] = wrong[0]! ^ 1
    expect(() => dualOperationFromPayload(wrong)).toThrow(/wrong dual-operation domain/)
    const domain = bytes.subarray(0, bytes.indexOf(0) + 1)
    expect(() => dualOperationFromPayload(new Uint8Array([...domain, 0xff, 0xfe]))).toThrow(/statement encoding/)
    expect(() => dualOperationFromPayload(new Uint8Array([...domain, ...new TextEncoder().encode('{"chain_id":')]))).toThrow(/statement encoding/)
  })
  it('refuses a zero, non-integer or over-long lifetime at prepare', () => {
    for (const ttlSecs of [0, -5, 1.5, 301]) expect(() => prepare({ttlSecs})).toThrow(/invalid dual-operation lifetime/)
  })
  it('a credentialed approval carries the verifier proofs as bare hex and the sealed evidence unchanged', async () => {
    const prepared = prepare()
    const bound = requestHash(43112, Uint8Array.from(prepared.statement.slot), 'dual-approve', sha256(dualOperationPayload(prepared.statement)))
    const record = await approveDualOperation({prepared, ...expectations, approver: approver(11),
      authorization: {compound_token: {binding: 'holder_key', request_hash: `0x${hex(bound)}`} as CompoundTokenWire, evidence_ct: 'AAEC',
        verifier_proofs: [{verifierIndex: 3, operator: h(0xaa, 20), pubkey: h(0xbb), proof: [h(0xcc), h(0xdd)]}]}})
    expect(record.approval.verifier_proofs).toEqual([{verifier_index: 3, operator: 'aa'.repeat(20), pubkey: 'bb'.repeat(32), proof: ['cc'.repeat(32), 'dd'.repeat(32)]}])
    expect(record.approval.evidence_ct).toBe('AAEC')
  })
  it('assemble refuses an invalid quorum, too many approvals and malformed approval records', async () => {
    const prepared = prepare()
    const a = await approveDualOperation({prepared, ...expectations, approver: approver(11)})
    for (const quorum of [0, 65, 1.5]) expect(() => assembleDualOperation({prepared, approvals: [a], quorum})).toThrow(/invalid approval quorum/)
    expect(() => assembleDualOperation({prepared, approvals: Array(65).fill(a), quorum: 2})).toThrow(/at most 64 approvals/)
    expect(() => assembleDualOperation({prepared, approvals: [{...a, approval: {...a.approval, signature: undefined as unknown as string}}], quorum: 1})).toThrow(/missing approver or signature/)
    expect(() => assembleDualOperation({prepared, approvals: [{...a, approval: {...a.approval, approver_pubkey: '11'.repeat(31)}}], quorum: 1})).toThrow(/invalid key length/)
    expect(() => assembleDualOperation({prepared, approvals: [{...a, approval: {...a.approval, signature: '11'.repeat(63)}}], quorum: 1})).toThrow(/invalid signature length/)
    expect(assembleDualOperation({prepared, approvals: [a], quorum: 1}).approvals).toEqual([a.approval])
  })
  it('a bundle is judged against the exact operation before it travels', async () => {
    const prepared = prepare()
    const expected = {chainId: 43112, operation: 'secp256k1-sign' as const, slot: SLOT, payloadDigest: DIGEST}
    expect(() => requireDualOperationProof({statement: prepared.statement, approvals: []}, expected)).toThrow(/invalid dual-operation approvals/)
    const a = await approveDualOperation({prepared, ...expectations, approver: approver(11)})
    const proof = {statement: prepared.statement, approvals: [a.approval]}
    expect(() => requireDualOperationProof(proof, expected)).not.toThrow()
    expect(() => requireDualOperationProof(proof, {...expected, epoch: 2})).not.toThrow()
    expect(() => requireDualOperationProof(proof, {...expected, epoch: 3})).toThrow(/key epoch/)
    expect(() => requireDualOperationProof(proof, {...expected, chainId: 1})).toThrow(/another operation, slot or digest/)
    expect(() => requireDualOperationRequest({...prepared.statement, request_id: 'cd'.repeat(32)}, expected)).toThrow(/request id differs/)
  })
})
