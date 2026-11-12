// Operation dual-control statements, approvals and the dual_control bundle (ported from tasra-cli
// dual-operation and checked against keykeeper_committee::dual_operation byte for byte).
import {afterEach, describe, expect, it, vi} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import {sha256} from '@noble/hashes/sha256'
import {privateKeyToAccount} from 'viem/accounts'
import {approveDualOperation, assembleDualOperation, dualOperationFromPayload, dualOperationPayload, prepareDualOperation, requireCurrentDualOperation, requireDualOperationProof, validateDualOperationStatement,
  type DualOperationApprover, type DualOperationStatement} from '../../src/committee/dual-operation.js'
import {committeeSignEoaDigest} from '../../src/committee/ecdsa.js'
import {paymentIntentHash, paymentIntentTypedData, prepaidRequestId, type PaymentIntentWire} from '../../src/committee/payment.js'
import {requestHash} from '../../src/oid4vp/binding.js'
import type {CompoundTokenWire} from '../../src/committee/token.js'
import {keeperExecutionFixture} from '../support/keeperExecution.js'

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')
const h = (n: number, len = 32) => `0x${n.toString(16).padStart(2, '0').repeat(len)}` as const
const creator = privateKeyToAccount(h(7))
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

/** Printed by keykeeper_committee::dual_operation::Statement::payload (serde_json) for these fields. */
const RUST_VECTOR = '6b65796b65657065723a6475616c2d6f7065726174696f6e3a7631007b22636861696e5f6964223a34333131322c22736c6f74223a5b312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c315d2c226f7065726174696f6e223a22736563703235366b312d7369676e222c2265706f6368223a322c227061796c6f61645f646967657374223a5b322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c325d2c22726571756573745f6964223a2261626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162222c227061796d656e745f68617368223a5b332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c335d2c226973737565645f6174223a313830303030303030302c22657870697265735f6174223a313830303030303132302c226964656e74697479223a6e756c6c7d'
const RUST_VECTOR_IBE = '6b65796b65657065723a6475616c2d6f7065726174696f6e3a7631007b22636861696e5f6964223a34333131322c22736c6f74223a5b312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c312c315d2c226f7065726174696f6e223a226962652d65787472616374222c2265706f6368223a322c227061796c6f61645f646967657374223a5b322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c322c325d2c22726571756573745f6964223a2261626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162222c227061796d656e745f68617368223a5b332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c332c335d2c226973737565645f6174223a313830303030303030302c22657870697265735f6174223a313830303030303132302c226964656e74697479223a226973737565722f70617469656e742fc3a95c2278227d'
const statement = (over: Partial<DualOperationStatement> = {}): DualOperationStatement => ({chain_id: 43112, slot: Array(32).fill(1), operation: 'secp256k1-sign',
  epoch: 2, payload_digest: Array(32).fill(2), request_id: 'ab'.repeat(32), payment_hash: Array(32).fill(3), issued_at: 1_800_000_000, expires_at: 1_800_000_120, identity: null, ...over})

async function payment(over: Partial<PaymentIntentWire> = {}): Promise<PaymentIntentWire> {
  const unsigned = {chain_id: 43112, settlement: h(1, 20), key_registry: h(2, 20), slot: h(3), action: 'eoa-sign' as const, payload_digest: hex(sha256(new Uint8Array(32).fill(9))).replace(/^/, '0x') as `0x${string}`,
    session_commitment: h(4), nonce: h(5), max_cost: '100', expires: Math.floor(Date.now() / 1000) + 600, verification_epoch: 7, verification_seed: h(6),
    verification_root: h(8), verification_registry_size: 3, verification_committee: 1, verification_quorum: 1,
    keeper_assignment: {key_epoch: 2, committee_version: 1, threshold: 1, coordinator: Array<number>(32).fill(12), contributors: [Array<number>(32).fill(12)]}, ...over}
  return {...unsigned, signature: await creator.signTypedData(paymentIntentTypedData(unsigned))}
}
const approver = (seed: number): DualOperationApprover & {secret: Uint8Array} => {
  const secret = new Uint8Array(32).fill(seed)
  return {secret, publicKey: ed25519.getPublicKey(secret), sign: async bytes => ed25519.sign(bytes, secret)}
}

describe('statement encoding: identical to keykeeper_committee::dual_operation', () => {
  it('produces exactly the Rust payload bytes, including a non-ASCII IBE identity', () => {
    expect(hex(dualOperationPayload(statement()))).toBe(RUST_VECTOR)
    expect(hex(dualOperationPayload(statement({operation: 'ibe-extract', identity: 'issuer/patient/é"x'})))).toBe(RUST_VECTOR_IBE)
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

describe('prepare, approve and assemble (tasra-cli dual-operation, every check kept)', () => {
  it('binds the statement to the final payment, either backing, and caps it at the payment expiry', async () => {
    for (const p of [await payment(), await payment({allowance_id: h(0x44)})]) {
      const prepared = prepareDualOperation({payment: p, operation: 'secp256k1-sign', epoch: 2, ttlSecs: 300})
      const {debit_voucher: _v, ...signed} = p
      expect(prepared.statement.request_id).toBe(prepaidRequestId(signed).slice(2))
      expect(hex(Uint8Array.from(prepared.statement.payment_hash))).toBe(paymentIntentHash(signed).slice(2))
      expect(prepared.statement.expires_at).toBeLessThanOrEqual(p.expires)
      expect(prepared.message_hex).toBe(hex(dualOperationPayload(prepared.statement)))
    }
    const short = await payment({expires: Math.floor(Date.now() / 1000) + 30})
    expect(prepareDualOperation({payment: short, operation: 'secp256k1-sign', epoch: 2}).statement.expires_at).toBe(short.expires)
  })
  it('refuses another action or key epoch at prepare', async () => {
    const p = await payment()
    expect(() => prepareDualOperation({payment: p, operation: 'kem-decrypt', epoch: 2})).toThrow(/wrong action/)
    expect(() => prepareDualOperation({payment: p, operation: 'secp256k1-sign', epoch: 3})).toThrow(/key epoch/)
  })
  it('an approver checks the carried bytes, the payment and its own expectations before signing', async () => {
    const p = await payment(), prepared = prepareDualOperation({payment: p, operation: 'secp256k1-sign', epoch: 2})
    const base = {prepared, payment: p, expectSlot: p.slot, expectPayloadDigest: p.payload_digest, approver: approver(11)}
    const record = await approveDualOperation(base)
    expect(ed25519.verify(Buffer.from(record.approval.signature, 'hex'), dualOperationPayload(prepared.statement), approver(11).publicKey)).toBe(true)
    await expect(approveDualOperation({...base, prepared: {...prepared, message_hex: '00'}})).rejects.toThrow(/payload differs/)
    await expect(approveDualOperation({...base, payment: await payment({nonce: h(0x55)})})).rejects.toThrow(/differs from final payment/)
    await expect(approveDualOperation({...base, expectSlot: h(9)})).rejects.toThrow(/unexpected slot/)
    await expect(approveDualOperation({...base, expectPayloadDigest: h(9)})).rejects.toThrow(/unexpected operation digest/)
    const sign = vi.fn()
    await expect(approveDualOperation({...base, approver: {publicKey: approver(11).publicKey, sign: async b => { sign(); return ed25519.sign(b, new Uint8Array(32).fill(12)) }}}))
      .rejects.toThrow(/Invalid local approval signature/)
    expect(sign).toHaveBeenCalled()
  })
  it('a credentialed approval needs a holder-bound grant over THIS statement', async () => {
    const p = await payment(), prepared = prepareDualOperation({payment: p, operation: 'secp256k1-sign', epoch: 2})
    const bound = requestHash(43112, Uint8Array.from(prepared.statement.slot), 'dual-approve', sha256(dualOperationPayload(prepared.statement)))
    const grant = (token: Partial<CompoundTokenWire>) => ({compound_token: {binding: 'holder_key', request_hash: `0x${hex(bound)}`, ...token} as CompoundTokenWire, verifier_proofs: []})
    const base = {prepared, payment: p, expectSlot: p.slot, expectPayloadDigest: p.payload_digest, approver: approver(11)}
    expect((await approveDualOperation({...base, authorization: grant({})})).approval.committee_token).toBeDefined()
    await expect(approveDualOperation({...base, authorization: grant({request_hash: h(1)})})).rejects.toThrow(/another approval/)
    await expect(approveDualOperation({...base, authorization: grant({binding: 'bearer' as never})})).rejects.toThrow(/holder-bound/)
  })
  it('assembles distinct, verified approvals of one statement up to the quorum', async () => {
    const p = await payment(), prepared = prepareDualOperation({payment: p, operation: 'secp256k1-sign', epoch: 2})
    const base = {prepared, payment: p, expectSlot: p.slot, expectPayloadDigest: p.payload_digest}
    const a = await approveDualOperation({...base, approver: approver(11)}), b = await approveDualOperation({...base, approver: approver(12)})
    expect(assembleDualOperation({prepared, approvals: [a, b], quorum: 2}).approvals).toHaveLength(2)
    expect(() => assembleDualOperation({prepared, approvals: [a], quorum: 2})).toThrow(/needs 2 distinct/)
    expect(() => assembleDualOperation({prepared, approvals: [a, a], quorum: 2})).toThrow(/duplicate approver/)
    expect(() => assembleDualOperation({prepared, approvals: [a, {...b, statement: {...b.statement, epoch: 3}}], quorum: 2})).toThrow(/different operations/)
    expect(() => assembleDualOperation({prepared, approvals: [a, {...b, approval: {...b.approval, signature: '00'.repeat(64)}}], quorum: 2})).toThrow(/does not verify/)
  })
  it('an expired statement is refused at approve and assemble', async () => {
    const p = await payment(), prepared = prepareDualOperation({payment: p, operation: 'secp256k1-sign', epoch: 2, ttlSecs: 10})
    const later = prepared.statement.expires_at
    await expect(approveDualOperation({prepared, payment: p, expectSlot: p.slot, expectPayloadDigest: p.payload_digest, approver: approver(11), nowSecs: later})).rejects.toThrow(/not current/)
    expect(() => assembleDualOperation({prepared, approvals: [], quorum: 1, nowSecs: later})).toThrow(/not current/)
  })
})

describe('the dual_control body on eoa-digest', () => {
  const digest = new Uint8Array(32).fill(9)
  const valid = {mode: 'tecdsa', group_public_key: '02' + '22'.repeat(32), signature_r: '33'.repeat(32), signature_s: '44'.repeat(32), signature_v: 1}
  async function bundle() {
    // Real creator and client signatures (no service bypass): the keeper approval covers the body.
    const f = await keeperExecutionFixture('eoa-sign', `0x${hex(sha256(digest))}`)
    const p = f.payment, prepared = prepareDualOperation({payment: p, operation: 'secp256k1-sign', epoch: p.keeper_assignment.key_epoch})
    const base = {prepared, payment: p, expectSlot: p.slot, expectPayloadDigest: p.payload_digest}
    const proof = assembleDualOperation({prepared, approvals: [await approveDualOperation({...base, approver: approver(11)}), await approveDualOperation({...base, approver: approver(12)})], quorum: 2})
    return {p, proof, f, token: {token_type: 'JWT', slot_id: p.slot, payment: p, payment_hash: paymentIntentHash(p)} as unknown as CompoundTokenWire}
  }
  it('carries the checked bundle inside the request body', async () => {
    const {proof, token, f} = await bundle()
    const fetcher = vi.fn(() => Promise.resolve(Response.json(valid)))
    vi.stubGlobal('fetch', fetcher)
    const approved = vi.fn(f.approveExecution)
    await committeeSignEoaDigest({nodeUrl: 'https://keeper.example', committeeToken: token, digest, dualControl: proof, approveExecution: approved})
    // The client's execution approval covers the body WITH the bundle; the keeper receives it unchanged.
    expect((approved.mock.calls[0]![0] as {body: Record<string, unknown>}).body.dual_control).toEqual(proof)
    const [, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(request.body as string).dual_control).toEqual(proof)
  })
  it('refuses, before any request, a bundle for another digest, another curve or without a paid token', async () => {
    const {proof, token} = await bundle()
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const opts = {nodeUrl: 'https://keeper.example', committeeToken: token, digest, dualControl: proof}
    await expect(committeeSignEoaDigest({...opts, digest: new Uint8Array(32).fill(8)})).rejects.toThrow(/another operation, slot or digest/)
    await expect(committeeSignEoaDigest({...opts, committeeToken: {...token, payment: undefined} as CompoundTokenWire})).rejects.toThrow(/paid authorization/)
    await expect(committeeSignEoaDigest({...opts, dualControl: {...proof, statement: {...proof.statement, operation: 'p256-sign'}}})).rejects.toThrow(/another operation/)
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('dual-operation boundary refusals', () => {
  it('refuses a statement that is not an object or carries a field of the wrong type', () => {
    for (const s of [null, 'statement', [statement()]]) expect(() => validateDualOperationStatement(s)).toThrow(/^invalid dual-operation statement$/)
    expect(() => validateDualOperationStatement(statement({chain_id: -1}))).toThrow(/statement types/)
    expect(() => validateDualOperationStatement(statement({slot: Array(31).fill(1)}))).toThrow(/statement types/)
    expect(() => validateDualOperationStatement(statement({payload_digest: Array(32).fill(256)}))).toThrow(/statement types/)
    expect(() => validateDualOperationStatement(statement({operation: 'ed25519-sign' as DualOperationStatement['operation']}))).toThrow(/statement types/)
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
  it('refuses a zero or non-integer lifetime at prepare', async () => {
    const p = await payment()
    for (const ttlSecs of [0, -5, 1.5]) expect(() => prepareDualOperation({payment: p, operation: 'secp256k1-sign', epoch: 2, ttlSecs})).toThrow(/invalid dual-operation lifetime/)
  })
  it('a credentialed approval carries the verifier proofs as bare hex and the sealed evidence unchanged', async () => {
    const p = await payment(), prepared = prepareDualOperation({payment: p, operation: 'secp256k1-sign', epoch: 2})
    const bound = requestHash(43112, Uint8Array.from(prepared.statement.slot), 'dual-approve', sha256(dualOperationPayload(prepared.statement)))
    const record = await approveDualOperation({prepared, payment: p, expectSlot: p.slot, expectPayloadDigest: p.payload_digest, approver: approver(11),
      authorization: {compound_token: {binding: 'holder_key', request_hash: `0x${hex(bound)}`} as CompoundTokenWire, evidence_ct: 'AAEC',
        verifier_proofs: [{verifierIndex: 3, operator: h(0xaa, 20), pubkey: h(0xbb), proof: [h(0xcc), h(0xdd)]}]}})
    expect(record.approval.verifier_proofs).toEqual([{verifier_index: 3, operator: 'aa'.repeat(20), pubkey: 'bb'.repeat(32), proof: ['cc'.repeat(32), 'dd'.repeat(32)]}])
    expect(record.approval.evidence_ct).toBe('AAEC')
  })
  it('assemble refuses an invalid quorum, too many approvals and malformed approval records', async () => {
    const p = await payment(), prepared = prepareDualOperation({payment: p, operation: 'secp256k1-sign', epoch: 2})
    const base = {prepared, payment: p, expectSlot: p.slot, expectPayloadDigest: p.payload_digest}
    const a = await approveDualOperation({...base, approver: approver(11)})
    for (const quorum of [0, 65, 1.5]) expect(() => assembleDualOperation({prepared, approvals: [a], quorum})).toThrow(/invalid approval quorum/)
    expect(() => assembleDualOperation({prepared, approvals: Array(65).fill(a), quorum: 2})).toThrow(/at most 64 approvals/)
    expect(() => assembleDualOperation({prepared, approvals: [{...a, approval: {...a.approval, signature: undefined as unknown as string}}], quorum: 1})).toThrow(/missing approver or signature/)
    expect(() => assembleDualOperation({prepared, approvals: [{...a, approval: {...a.approval, approver_pubkey: '11'.repeat(31)}}], quorum: 1})).toThrow(/invalid key length/)
    expect(() => assembleDualOperation({prepared, approvals: [{...a, approval: {...a.approval, signature: '11'.repeat(63)}}], quorum: 1})).toThrow(/invalid signature length/)
    expect(assembleDualOperation({prepared, approvals: [a], quorum: 1}).approvals).toEqual([a.approval])
  })
  it('a bundle without approvals is refused before it travels', async () => {
    const p = await payment(), prepared = prepareDualOperation({payment: p, operation: 'secp256k1-sign', epoch: 2})
    const expected = {operation: 'secp256k1-sign' as const, slot: Uint8Array.from(prepared.statement.slot), payloadDigest: Uint8Array.from(prepared.statement.payload_digest), payment: p}
    expect(() => requireDualOperationProof({statement: prepared.statement, approvals: []}, expected)).toThrow(/invalid dual-operation approvals/)
    const a = await approveDualOperation({prepared, payment: p, expectSlot: p.slot, expectPayloadDigest: p.payload_digest, approver: approver(11)})
    expect(() => requireDualOperationProof({statement: prepared.statement, approvals: [a.approval]}, expected)).not.toThrow()
  })
})
