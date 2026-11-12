// ADR-0090 encodings against the shared conformance vectors (a byte-identical copy of
// keykeeper-eth's tests/fixtures/prepaid-allowance-expected.json, equal to the contract branch's
// contracts/test/vectors/prepaid-allowance-conformance.json), and the BN254 threshold combine
// against the Rust/Solidity pinned vectors in keykeeper-bls::bn254.
import {describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'
import {keccak256, recoverTypedDataAddress, toHex, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {keccak_256} from '@noble/hashes/sha3'
import {sha256} from '@noble/hashes/sha256'
import {bn254, bn254_Fr} from '@noble/curves/bn254'
import {bytesToNumberBE} from '@noble/curves/utils.js'
import {ALLOWANCE_ACTIONS, PREPAID_ALLOWANCE_DOMAINS, allowanceActionBits, allowanceCloseDigest, allowanceFunds, allowanceId, allowanceReserveDigest,
  allowanceSettleDigest, assertPaymentIntentWire, debitVoucherDigest, keeperAssignmentCommitment, paymentIntentHash, paymentIntentTypedData,
  prepaidAllowanceIntentHash, prepaidAllowanceIntentTypedData, prepaidRequestId, type PaymentIntentWire, type PrepaidAllowanceIntentWire} from '../../src/committee/payment.js'
import {Bn254Error, combineBn254, decodeG1, decodeG2, encodeG1, encodeG2, hashToG1, verifyBn254} from '../../src/crypto/bn254.js'

type Vectors = Record<string, Record<string, unknown>> & {chain_id: number; settlement: Hex}
const raw = readFileSync(new URL('../prepaid-allowance-vectors.json', import.meta.url), 'utf8')
const v = JSON.parse(raw) as Vectors
const s = (section: string, key: string) => v[section]![key] as Hex
const n = (section: string, key: string) => v[section]![key] as number
const rep = (b: number, len = 32): Hex => `0x${b.toString(16).padStart(2, '0').repeat(len)}`
const bytes = (b: number) => Array<number>(32).fill(b)
// The vectors' fixed keeper assignment (tests/prepaid_allowance_vectors.rs `assignment()`).
const assignment = {key_epoch: 1, committee_version: 2, threshold: 2, coordinator: bytes(9), contributors: [bytes(9), bytes(10), bytes(11)]}

const ai = v.allowance_intent!
const allowanceIntent: Omit<PrepaidAllowanceIntentWire, 'signature'> = {
  chain_id: v.chain_id, settlement: v.settlement, key_registry: ai.key_registry as Hex, slot: ai.slot_id as Hex, intent_nonce: ai.intent_nonce as Hex,
  amount: ai.amount as string, max_op_cost: ai.max_op_cost as string, actions: ai.actions as number, expires_at: ai.expires_at as number,
  verification_epoch: ai.verification_epoch as number, verification_seed: ai.verification_seed as Hex, verification_root: ai.verification_root as Hex,
  verification_registry_size: ai.verification_registry_size as number, verification_committee: ai.verification_committee as number,
  verification_quorum: ai.verification_quorum as number, keeper_assignment: assignment,
}
const pi = v.allowance_payment_intent!
const allowancePayment: Omit<PaymentIntentWire, 'signature'> = {
  chain_id: v.chain_id, settlement: v.settlement, key_registry: allowanceIntent.key_registry, slot: allowanceIntent.slot, action: 'decrypt',
  payload_digest: pi.payload_digest as Hex, session_commitment: pi.session_commitment as Hex, nonce: pi.nonce as Hex, max_cost: pi.max_cost as string,
  expires: pi.expires as number, verification_epoch: 7, verification_seed: allowanceIntent.verification_seed, verification_root: allowanceIntent.verification_root,
  verification_registry_size: 5, verification_committee: 3, verification_quorum: 2, keeper_assignment: assignment, allowance_id: pi.allowance_id as Hex,
}

describe('ADR-0090 conformance vectors', () => {
  it('is the byte-identical shared fixture', () => {
    // SHA-256 of keykeeper-eth's fixture (= the contract branch's conformance file) when copied.
    // A regenerated network fixture is a NEW domain name and a new copy, never an edit here.
    expect(toHex(sha256(new TextEncoder().encode(raw)))).toBe('0xad3295e54a1fab6e2435b3389b10b1066a151ff6eb354c4a7b7d82a1f8c23278')
    expect(v.adr).toContain('ADR-0090')
  })

  it('domain words are keccak256 of the domain strings', () => {
    const d = v.domains as Record<string, {string: string; word: Hex}>
    const names = {allowance_id: 'allowanceId', reserve: 'reserve', debit_voucher: 'debitVoucher', allowance_settle: 'allowanceSettle', close: 'close'} as const
    for (const [key, name] of Object.entries(names)) {
      expect(d[key]!.string).toBe(PREPAID_ALLOWANCE_DOMAINS[name])
      expect(keccak256(toHex(d[key]!.string))).toBe(d[key]!.word)
    }
  })

  it('the allowance intent signing hash and the derived allowance id', () => {
    expect(keeperAssignmentCommitment(assignment)).toBe(ai.keeper_assignment)
    expect(prepaidAllowanceIntentTypedData(allowanceIntent).domain).toMatchObject(ai.eip712_domain as object)
    expect(prepaidAllowanceIntentHash(allowanceIntent)).toBe(ai.signing_hash)
    expect(s('allowance_id', 'intent_hash')).toBe(ai.signing_hash)
    expect(allowanceId(v.chain_id, v.settlement, s('allowance_id', 'slot_id'), s('allowance_id', 'intent_hash'))).toBe(s('allowance_id', 'expected'))
    expect(ALLOWANCE_ACTIONS).toBe(ai.actions)
    expect(allowanceActionBits(['sign', 'decrypt', 'eoa-sign', 'ibe-extract', 'dual-approve'])).toBe(ai.actions)
    expect(allowanceFunds(ALLOWANCE_ACTIONS, 'decrypt') && !allowanceFunds(allowanceActionBits(['sign']), 'decrypt')).toBe(true)
  })

  it('the allowance payment intent is its own typed intent and its request id binds the allowance', () => {
    expect(paymentIntentHash(allowancePayment)).toBe(pi.signing_hash)
    expect(prepaidRequestId(allowancePayment)).toBe(pi.request_id)
    const {allowance_id: _drop, ...perOperation} = allowancePayment
    expect(paymentIntentHash(perOperation)).not.toBe(pi.signing_hash)
    expect(paymentIntentTypedData(perOperation).primaryType).toBe('SlotAssignedPaymentIntent')
    expect(paymentIntentTypedData(allowancePayment).primaryType).toBe('SlotAllowancePaymentIntent')
    expect(prepaidRequestId({...allowancePayment, allowance_id: rep(0x45)})).not.toBe(pi.request_id)
    expect(() => paymentIntentHash({...allowancePayment, allowance_id: rep(0)})).toThrow(/nonzero/)
  })

  it('reserve, debit voucher, allowance settle and close digests', () => {
    const r = v.reserve!
    expect(allowanceReserveDigest(v.settlement, v.chain_id, {slot: r.slot_id as Hex, legacyNonce: BigInt(r.legacy_nonce as number), allowanceId: r.allowance_id as Hex,
      amount: BigInt(r.amount as string), maxOpCost: BigInt(r.max_op_cost as string), actions: r.actions as number, expiresAt: BigInt(r.expires_at as number),
      assignmentBlock: r.assignment_block as Hex, deadline: BigInt(r.deadline as number)})).toBe(r.expected)
    const d = v.debit_voucher!
    expect(debitVoucherDigest(v.settlement, v.chain_id, {allowanceId: d.allowance_id as Hex, seq: BigInt(d.seq as number), requestId: d.request_id as Hex,
      cost: BigInt(d.cost as string), cumulative: BigInt(d.cumulative as string), quoteBlock: d.quote_block as Hex})).toBe(d.expected)
    expect(d.request_id).toBe(pi.request_id)
    const st = v.allowance_settle!
    expect(allowanceSettleDigest(v.settlement, v.chain_id, {allowanceId: st.allowance_id as Hex, requestIds: st.request_ids as Hex[],
      costs: (st.costs as string[]).map(BigInt), paid: (st.paid as string[]).map(BigInt), batchId: st.batch_id as Hex, root: st.root as Hex,
      evidenceHash: st.evidence_hash as Hex, deadline: BigInt(st.deadline as number)})).toBe(st.expected)
    expect(allowanceCloseDigest(v.settlement, v.chain_id, s('close', 'allowance_id'), BigInt(v.close!.final_cumulative as string), BigInt(n('close', 'deadline')))).toBe(s('close', 'expected'))
  })

  it('a creator signature over one typed intent never verifies as the other', async () => {
    const creator = privateKeyToAccount(rep(11))
    const signature = await creator.signTypedData(paymentIntentTypedData(allowancePayment))
    expect(await recoverTypedDataAddress({...paymentIntentTypedData(allowancePayment), signature})).toBe(creator.address)
    const {allowance_id: _drop, ...perOperation} = allowancePayment
    expect(await recoverTypedDataAddress({...paymentIntentTypedData(perOperation), signature})).not.toBe(creator.address)
  })

  it('refuses unsafe allowance terms before signing', () => {
    const bad = (patch: Partial<PrepaidAllowanceIntentWire>) => () => prepaidAllowanceIntentHash({...allowanceIntent, ...patch})
    expect(bad({actions: 0})).toThrow(/actions/)
    expect(bad({actions: 1 << 4})).toThrow(/actions/)
    expect(bad({amount: '0'})).toThrow(/cap/)
    expect(bad({max_op_cost: '1000001'})).toThrow(/cap/)
    expect(bad({intent_nonce: rep(0)})).toThrow(/nonce/)
    expect(bad({verification_quorum: 4})).toThrow(/verifier policy/)
  })

  it('checks a carried voucher against its payment', () => {
    const payment = {...allowancePayment, signature: rep(1, 65)}
    const voucher = {allowance_id: pi.allowance_id as Hex, seq: 3, request_id: pi.request_id as Hex, cost: '250', cumulative: '1000', quote_block: rep(0x77), signature: rep(5, 64)}
    expect(() => assertPaymentIntentWire({...payment, debit_voucher: voucher})).not.toThrow()
    expect(() => assertPaymentIntentWire({...payment, debit_voucher: {...voucher, allowance_id: rep(0x45)}})).toThrow(/different allowance/)
    expect(() => assertPaymentIntentWire({...payment, debit_voucher: {...voucher, request_id: rep(0x66)}})).toThrow(/different request/)
    expect(() => assertPaymentIntentWire({...payment, debit_voucher: {...voucher, cost: '501', cumulative: '1000'}})).toThrow(/payment cap/)
    expect(() => assertPaymentIntentWire({...payment, debit_voucher: {...voucher, cumulative: '249'}})).toThrow(/cumulative/)
    expect(() => assertPaymentIntentWire({...payment, debit_voucher: {...voucher, signature: rep(0, 64)}})).toThrow(/infinity/)
    expect(() => assertPaymentIntentWire({...payment, debit_voucher: {...voucher, extra: 1}})).toThrow(/fields/)
    const {allowance_id: _drop, ...perOperation} = payment
    expect(() => assertPaymentIntentWire({...perOperation, debit_voucher: voucher})).toThrow(/allowance_id/)
  })
})

// keykeeper-bls::bn254 fixture_2_of_3: f(x) = a0 + a1 x over Fr from keccak-derived coefficients.
const fr = (label: string) => bn254_Fr.create(bytesToNumberBE(keccak_256(new TextEncoder().encode(label))))
const a0 = fr('keykeeper/bn254/test/a0'), a1 = fr('keykeeper/bn254/test/a1')
const shares = [1n, 2n, 3n].map(x => bn254_Fr.add(a0, bn254_Fr.mul(a1, x)))
const G1 = bn254.G1.ProjectivePoint, G2 = bn254.G2.ProjectivePoint
const mpk = encodeG2(G2.BASE.multiply(a0))
const digest = keccak_256(new TextEncoder().encode('keykeeper/bn254/sign/v1'))
const partial = (i: number, d = digest) => ({identifier: i + 1, partial: encodeG1(hashToG1(d).multiply(shares[i]!)), verifyingShare: encodeG2(G2.BASE.multiply(shares[i]!))})

describe('BN254 threshold combine (keykeeper-bls pinned vectors)', () => {
  it('hash-to-G1 matches the Solidity cross-language vector (including the y root)', () => {
    const p = hashToG1(keccak_256(new TextEncoder().encode('keykeeper/bn254/hash-to-g1/v1'))).toAffine()
    expect(p.x.toString()).toBe('19087822659226983304094903931621487610488637236896952482256115115831427222950')
    expect(p.y.toString()).toBe('10294133087086771874169011185385153168297318483131368819921099301397307044196')
  })

  it('combines 2-of-3 into the pinned signature under the pinned group key encoding', () => {
    expect(toHex(digest)).toBe('0x61737762ea8724ccac2bf126efe0fbb7f50a3f5d20d075b4a8938ac707e9f191')
    expect(toHex(mpk)).toBe('0x000cf999ca161e82d47cb74068da7969937dd7818bb2ab3a083034912751f7b8113dd565e5717a505286477f76102c6dab1d7068c51bd020e84e3e357452636d'
      + '2f16a3d45e1214b253745fac1072f716b46d4634ed32be6e0778f205dcfe11ff1575d909181d557502275b518f181d769c62828d688b083779c6f3150a7ef688')
    const signature = combineBn254(mpk, digest, [partial(0), partial(1)], 2)
    expect(toHex(signature)).toBe('0x1884fa811e89551bb80b026ed7bfb10010521c6afe9e58da8f85d822113fe033154de64e1fe32c89fc4ba2e9f7531413f13e2d85c852c83471fa0b1403aa4d7e')
    // Uniqueness: any k signers reach the same signature.
    expect(toHex(combineBn254(mpk, digest, [partial(2), partial(1)], 2))).toBe(toHex(signature))
    expect(verifyBn254(mpk, digest, signature)).toBe(true)
    expect(verifyBn254(mpk, keccak_256(new Uint8Array([1])), signature)).toBe(false)
  }, 30_000)

  it('names a byzantine member, refuses duplicates, a short set and a wrong group key', () => {
    const forged = {...partial(1), partial: partial(1, keccak_256(new Uint8Array([7]))).partial}
    expect(() => combineBn254(mpk, digest, [partial(0), forged], 2)).toThrow(/member 2/)
    expect(() => combineBn254(mpk, digest, [partial(0), partial(0)], 2)).toThrow(/duplicate/)
    expect(() => combineBn254(mpk, digest, [partial(0)], 2)).toThrow(Bn254Error)
    // One partial "combined" as threshold 1 interpolates to the wrong point for a 2-of-3 key.
    expect(() => combineBn254(mpk, digest, [partial(0)], 1)).toThrow(/group key/)
    expect(() => combineBn254(encodeG2(G2.BASE), digest, [partial(0), partial(1)], 2)).toThrow(/group key/)
  }, 30_000)

  it('refuses infinity, non-canonical coordinates and off-curve points', () => {
    expect(verifyBn254(mpk, digest, new Uint8Array(64))).toBe(false)
    expect(verifyBn254(new Uint8Array(128), digest, encodeG1(G1.BASE))).toBe(false)
    const p = encodeG1(G1.BASE), off = Uint8Array.from(p); off[63] = off[63]! ^ 1
    expect(() => decodeG1(off)).toThrow(Bn254Error)
    const big = new Uint8Array(64).fill(0xff)
    expect(() => decodeG1(big)).toThrow(Bn254Error)
    expect(decodeG1(p).equals(G1.BASE)).toBe(true)
    expect(decodeG2(mpk).equals(G2.BASE.multiply(a0))).toBe(true)
    const g2 = Uint8Array.from(mpk); g2[127] = g2[127]! ^ 1
    expect(() => decodeG2(g2)).toThrow(Bn254Error)
  })
})
