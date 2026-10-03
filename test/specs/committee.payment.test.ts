import {afterEach, describe, expect, it, vi} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import type {Hex} from 'viem'
import {keeperAssignmentCommitment, paymentIntentHash, paymentSessionCommitment, type PaymentIntentWire} from '../../src/committee/payment.js'
import {assembleCompoundToken, compoundTokenHash, decodeCompoundToken, selectVerifierCommittee, verifyCompoundToken, type CompoundTokenPayload} from '../../src/committee/token.js'
import {assertCompoundTokenWire, createOauthSession, createOid4vpSession, type CreateSessionParams} from '../../src/verifier-agent/index.js'
import {verifierAgentResult} from '../../src/oid4vp/verifier-agent.js'
import {gatherCommitteeToken, type CommitteeAuthorizeBody} from '../../src/committee/client.js'
import {bytesToHex, hexToBytes} from '../../src/crypto/hex.js'

const h = (byte: number, length = 32): Hex => `0x${byte.toString(16).padStart(2, '0').repeat(length)}`
const payment = (): PaymentIntentWire => ({
  chain_id: 43112, settlement: h(1, 20), key_registry: h(2, 20), slot: h(3), action: 'sign',
  payload_digest: h(4), session_commitment: h(5), nonce: h(6), max_cost: '10', expires: 1060,
  verification_epoch: 7, verification_seed: h(8), verification_root: h(9),
  verification_registry_size: 5, verification_committee: 3, verification_quorum: 2,
  keeper_assignment: {key_epoch: 1, committee_version: 2, threshold: 2, coordinator: Array<number>(32).fill(9), contributors: [9, 10, 11].map(n => Array<number>(32).fill(n))},
  signature: h(1, 65),
})
const payload = (): CompoundTokenPayload => ({
  tokenType: 'JWT', seed: hexToBytes(h(8)), epoch: 7, slotId: hexToBytes(h(3)),
  vpHash: hexToBytes(h(12)), holderHash: hexToBytes(h(13)), ruleHash: hexToBytes(h(14)),
  requestHash: hexToBytes(h(15)), binding: 1,
  verifierIndexes: selectVerifierCommittee(hexToBytes(h(3)), 7, hexToBytes(h(8)), 5, 3), iat: 1000, exp: 1060,
})
const params = (): CreateSessionParams => ({
  operation: {chain_id: 43112, slot_id: h(3), action: 'sign', payload_digest: h(4), description: 'test', exp: 1060},
  operationSig: h(2, 65), messageHex: h(4), payment: payment(), random: h(33),
})
afterEach(() => vi.unstubAllGlobals())

describe('paid protocol conformance', () => {
  it('matches Rust assignment and EIP-712 fixed vectors', () => {
    expect(keeperAssignmentCommitment(payment().keeper_assignment)).toBe('0xa4cf48dfd2a9c21b21a4d74dc24e9c598289fb71ea32b1b0049681dd800a867b')
    expect(paymentIntentHash(payment())).toBe('0x7dba29411d2dd206eb4fc475d78a1f3be8d0ddc410c45f9b5a1ebb144478ceb5')
  })
  it('binds each deployment, fee, operation, committee and assignment input', () => {
    const original = payment()
    const changes: Partial<PaymentIntentWire>[] = [
      {chain_id: 43113}, {settlement: h(2, 20)}, {key_registry: h(1, 20)}, {slot: h(33)},
      {action: 'eoa-sign'}, {payload_digest: h(33)}, {session_commitment: h(33)}, {nonce: h(33)},
      {max_cost: '9007199254740993'}, {expires: 1061}, {verification_epoch: 8}, {verification_seed: h(33)},
      {verification_root: h(33)}, {verification_registry_size: 6}, {verification_committee: 4}, {verification_quorum: 3},
      {keeper_assignment: {...original.keeper_assignment, committee_version: 3}},
      {keeper_assignment: {...original.keeper_assignment, key_epoch: 2}},
      {keeper_assignment: {...original.keeper_assignment, threshold: 3}},
      {keeper_assignment: {...original.keeper_assignment, coordinator: Array<number>(32).fill(10)}},
      {keeper_assignment: {...original.keeper_assignment, contributors: [9, 10, 12].map(n => Array<number>(32).fill(n))}},
    ]
    for (const change of changes) expect(paymentIntentHash({...original, ...change})).not.toBe(paymentIntentHash(original))
    expect(paymentSessionCommitment(h(1), 'did:web:test', 1060)).not.toBe(paymentSessionCommitment(h(1), 'did:web:other', 1060))
    expect(paymentSessionCommitment(h(1), 'did:web:test', 1060)).not.toBe(paymentSessionCommitment(h(2), 'did:web:test', 1060))
    expect(paymentSessionCommitment(h(1), 'did:web:test', 1060)).not.toBe(paymentSessionCommitment(h(1), 'did:web:test', 1061))
  })
  it('refuses lossy integers, invalid costs, and ambiguous keeper membership', () => {
    for (const max_cost of ['', '1e18', '-1', '1.5', (1n << 256n).toString()]) expect(() => paymentIntentHash({...payment(), max_cost})).toThrow()
    for (const chain_id of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN]) expect(() => paymentIntentHash({...payment(), chain_id})).toThrow()
    for (const contributors of [[], [9, 9], [10, 9], [0, 9], [10, 11]]) expect(() => keeperAssignmentCommitment({...payment().keeper_assignment, contributors: contributors.map(n => Array<number>(32).fill(n))})).toThrow()
    const sparse = payment().keeper_assignment
    sparse.coordinator = Array<number>(32)
    sparse.coordinator[0] = 9
    expect(() => keeperAssignmentCommitment(sparse)).toThrow(/keeper key/)
    expect(() => paymentIntentHash({...payment(), verification_quorum: 4})).toThrow()
  })
  it('verifies actual Ed25519 paid signatures and refuses payment substitution/downgrade', () => {
    const p = payload()
    const paid = {...p, paymentHash: hexToBytes(paymentIntentHash(payment())), payment: payment()}
    // Independently encoded from Rust TokenPayload::canonical_bytes and hashed with cast.
    expect(p.verifierIndexes).toEqual([1, 2, 4])
    expect(bytesToHex(compoundTokenHash(paid))).toBe('0x8c9107626629ab65ce62dd1d1a89fdc067c26bbdd03ef0a08d1a2bb2114a8fc0')
    const keys = new Map(p.verifierIndexes.map(i => [i, new Uint8Array(32).fill(i + 1)]))
    const pubkeys = new Map([...keys].map(([i, sk]) => [i, ed25519.getPublicKey(sk)]))
    const signatures = [...keys].map(([verifierIndex, sk]) => ({verifierIndex, signature: ed25519.sign(compoundTokenHash(paid), sk)}))
    const wire = assembleCompoundToken(paid, signatures)
    expect(wire.payment).toEqual(payment())
    const check = (token: ReturnType<typeof decodeCompoundToken>) => verifyCompoundToken({token, set: {registrySize: 5, pubkeys}, committee: 3, quorum: 2, now: 1030, leeway: 0, slotRuleHash: p.ruleHash})
    expect(check(decodeCompoundToken(wire)).verifiedSigners).toHaveLength(3)
    expect(check(decodeCompoundToken(wire)).paymentHash).toEqual(paid.paymentHash)
    for (const paymentHash of [undefined, hexToBytes(h(0)), hexToBytes(h(99))]) expect(() => check({...p, paymentHash, signatures})).toThrow()
    expect(() => decodeCompoundToken({...wire, payment: {...payment(), max_cost: '11'}})).toThrow(/payment preimage/)
    expect(() => decodeCompoundToken({...wire, payment_hash: undefined})).toThrow(/payment preimage/)
    expect(() => compoundTokenHash({...p, paymentHash: new Uint8Array(31)})).toThrow(/32 bytes/)
    expect(assembleCompoundToken(p, []).payment_hash).toBeUndefined()
    expect(decodeCompoundToken(assembleCompoundToken(p, []))).not.toHaveProperty('paymentHash')
  })
})

describe('paid session transport', () => {
  for (const kind of ['wallet', 'oauth'] as const) {
    it(`${kind} sends the fixed payment/random once and omits them from legacy sessions`, async () => {
      const fetch = vi.fn(async () => Response.json(kind === 'wallet'
        ? {session_id: 'id', poll_secret: 'secret', qr_payload: 'openid4vp://test', request_uri: 'https://test/request'}
        : {session_id: 'id', poll_secret: 'secret', nonce: 'nonce', dpop_htu: 'https://test/response', platform_audience: 'test'}))
      vi.stubGlobal('fetch', fetch)
      const create = kind === 'wallet' ? createOid4vpSession : createOauthSession
      await create('https://test', params())
      const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as Record<string, unknown>
      expect(body.payment).toEqual(payment())
      expect(body.random).toBe(h(33))
      const legacy = params(); delete legacy.payment; delete legacy.random
      await create('https://test', legacy)
      const old = JSON.parse((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].body as string) as Record<string, unknown>
      expect(old).not.toHaveProperty('payment'); expect(old).not.toHaveProperty('random')
      expect(fetch).toHaveBeenCalledTimes(2)
    })
  }
  it('refuses missing random, mismatched operation and malformed payment before HTTP', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const bad: CreateSessionParams[] = [
      {...params(), random: undefined}, {...params(), payment: undefined}, {...params(), random: '0x00'},
      {...params(), payment: {...payment(), chain_id: 43113}},
      {...params(), payment: {...payment(), action: 'decrypt'}},
      {...params(), payment: {...payment(), slot: h(2)}},
      {...params(), payment: {...payment(), signature: '0x00'}},
    ]
    for (const p of bad) await expect(createOid4vpSession('https://test', p)).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('normalizes absent payment and rejects malformed commitments and changed preimages', () => {
    const wire = assembleCompoundToken(payload(), [{verifierIndex: payload().verifierIndexes[0]!, signature: new Uint8Array(64)}])
    expect(assertCompoundTokenWire({...wire, payment: null, payment_hash: null}, 'id')).not.toHaveProperty('payment_hash')
    expect(() => assertCompoundTokenWire({...wire, payment_hash: 'oops'}, 'id')).toThrow(/payment_hash/)
    expect(() => assertCompoundTokenWire({...wire, payment_hash: h(0), payment: payment()}, 'id')).toThrow(/payment/)
    const paid = {...wire, payment_hash: paymentIntentHash(payment()), payment: payment()}
    const result = {status: 'done' as const, phase: 'done' as const, compoundToken: paid}
    const session = {sessionId: 'id', requestHash: payload().requestHash!, paymentHash: paid.payment_hash}
    expect(verifierAgentResult(session, result).token.payment).toEqual(payment())
    expect(() => verifierAgentResult({...session, paymentHash: h(99)}, result)).toThrow(/payment/)
    expect(() => verifierAgentResult(session, {...result, compoundToken: {...wire}})).toThrow(/payment/)
    expect(() => verifierAgentResult({...session, paymentHash: undefined}, result)).toThrow(/payment/)
    expect(() => verifierAgentResult(session, {...result, compoundToken: {...paid, payment: {...payment(), max_cost: '11'}}})).toThrow(/payment/)
  })
})

describe('paid verifier gathering', () => {
  const authorize = (): CommitteeAuthorizeBody => ({
    holder: 'did:test:holder', credentials: ['credential'], holderProof: 'proof', tokenType: 'JWT',
    seed: payload().seed, epoch: 7, slotId: payload().slotId, registrySize: 5, committee: 3, iat: 1000, exp: 1060,
    payment: payment(), binding: {chainId: 43112, action: 'sign', payloadDigest: hexToBytes(h(4)), random: hexToBytes(h(33)), clientId: 'did:web:test'},
  })
  it('carries the same payment through every verifier and assembled token', async () => {
    const p = {...payload(), paymentHash: hexToBytes(paymentIntentHash(payment()))}
    const hash = compoundTokenHash(p)
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      expect((JSON.parse(init.body as string) as Record<string, unknown>).payment).toEqual(payment())
      const index = Number(new URL(url).hostname.split('.')[0])
      return Response.json({verifier_index: index, token_hash: bytesToHex(hash), vp_hash: h(12), holder_hash: h(13), rule_hash: h(14), request_hash: h(15), payment_hash: paymentIntentHash(payment()), binding: 'holder_key', signature: h(1, 64), committee_indexes: p.verifierIndexes})
    })
    vi.stubGlobal('fetch', fetch)
    const result = await gatherCommitteeToken({verifiers: p.verifierIndexes.map(index => ({index, url: `https://${index}.test`})), authorize: authorize(), quorum: 2})
    expect(result.payment).toEqual(payment()); expect(result.payment_hash).toBe(paymentIntentHash(payment()))
    expect(fetch).toHaveBeenCalledTimes(3)
  })
  it('cannot assemble an unpaid downgrade or spend with a different verification policy', async () => {
    const fetch = vi.fn(async () => Response.json({payment_hash: null}))
    vi.stubGlobal('fetch', fetch)
    await expect(gatherCommitteeToken({verifiers: [{index: 0, url: 'https://test'}], authorize: authorize(), quorum: 2})).rejects.toThrow(/payment commitment/)
    fetch.mockClear()
    await expect(gatherCommitteeToken({verifiers: [{index: 0, url: 'https://test'}], authorize: authorize(), quorum: 1})).rejects.toThrow(/quorum differs/)
    expect(fetch).not.toHaveBeenCalled()
  })
})
