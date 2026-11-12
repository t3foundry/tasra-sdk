// Native two-person approvals beyond FROST (keykeeper-network a98adff6): installing a set-once
// policy on a threshold ECDSA slot by a creator transaction, preparing the statement for ONE final
// paid operation from the slot's own epoch and mode, and assembling a bundle judged against the
// ON-CHAIN policy before any paid send.
import {describe, expect, it, vi} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import {decodeFunctionData, toHex, type Hex} from 'viem'
import {assembleOperationApproval, prepareOperationApproval, readApprovalPolicy, setApprovalPolicy} from '../../src/app/approvals.js'
import {approveDualOperation} from '../../src/committee/dual-operation.js'
import {keyRegistryAbi} from '../../src/chain/abis/index.js'
import {prepaidRequestId, paymentIntentHash, type PaymentIntentWire} from '../../src/committee/payment.js'
import type {TasraApplication} from '../../src/app/client.js'
import type {TasraWallet} from '../../src/app/wallet.js'
import type {ApplicationStore} from '../../src/app/ready-slot.js'

const slot = `0x${'11'.repeat(32)}` as Hex, registry = `0x${'22'.repeat(20)}` as Hex, zero = `0x${'00'.repeat(32)}` as Hex
const seeds = [41, 42, 43].map(n => new Uint8Array(32).fill(n))
const approver = (s: Uint8Array) => ({publicKey: ed25519.getPublicKey(s), sign: async (p: Uint8Array) => ed25519.sign(p, s)})
const keys = seeds.map(s => toHex(ed25519.getPublicKey(s)))
const h = (n: number, size = 32) => ('0x' + n.toString(16).padStart(2, '0').repeat(size)) as Hex

function setup(mode = 2, options: {installed?: {quorum: number; ruleHash: Hex; approvers: Hex[]}; ready?: boolean; epoch?: number} = {}) {
  let policy = options.installed ?? {quorum: 0, ruleHash: zero, approvers: [] as Hex[]}
  const get = vi.fn(async () => ({slotId: slot, mode, epoch: options.epoch ?? 1, threshold: {k: 2, n: 3}, publicKey: '0x02', ready: options.ready ?? true}))
  const frost = vi.fn(async () => { throw new Error('WRONG_SLOT_MODE (the FROST-only check)') })
  const readContract = vi.fn(async ({functionName}: {functionName: string}) => functionName === 'dualControlApprovers' ? [...policy.approvers] : [policy.quorum, policy.ruleHash] as const)
  const transfer = vi.fn(async (_name: string, tx: {data: Hex}) => {
    const args = decodeFunctionData({abi: keyRegistryAbi, data: tx.data}).args as unknown as [Hex, number, Hex, Hex[]]
    policy = {quorum: args[1], ruleHash: args[2], approvers: args[3]}
    return {hash: h(9), phase: 'confirmed' as const}
  })
  const app = {deployment: {chainId: 43112, addresses: {KeyRegistry: registry}}, slots: {get, frost}, chain: {client: {readContract}}} as unknown as TasraApplication
  const wallet = {wallet: {chain: {id: 43112}}, transfer} as unknown as TasraWallet
  return {app, wallet, store: {} as ApplicationStore, transfer, get, frost}
}

function payment(change: Partial<PaymentIntentWire> = {}): PaymentIntentWire {
  return {chain_id: 43112, settlement: h(1, 20), key_registry: registry, slot, action: 'eoa-sign', payload_digest: h(5),
    session_commitment: h(6), nonce: h(7), max_cost: '100', expires: Math.floor(Date.now() / 1000) + 600,
    verification_epoch: 7, verification_seed: h(8), verification_root: h(9), verification_registry_size: 1, verification_committee: 1, verification_quorum: 1,
    keeper_assignment: {key_epoch: 1, committee_version: 1, threshold: 1, coordinator: Array<number>(32).fill(1), contributors: [Array<number>(32).fill(1)]},
    signature: h(1, 65), ...change}
}

describe('approval policy on a threshold ECDSA slot', () => {
  it.each([[2, 'secp256k1'], [4, 'P-256']] as const)('installs and verifies a static policy on a %s slot (%s) by the creator transaction', async (mode, _curve) => {
    const s = setup(mode)
    const result = await setApprovalPolicy(s.app, slot, {quorum: 2, approvers: seeds.map(x => ed25519.getPublicKey(x))}, s)
    expect(result).toMatchObject({phase: 'confirmed'})
    expect(s.frost).not.toHaveBeenCalled()
    expect(s.transfer).toHaveBeenCalledTimes(1)
    const decoded = decodeFunctionData({abi: keyRegistryAbi, data: (s.transfer.mock.calls[0]![1] as {data: Hex}).data})
    expect(decoded.functionName).toBe('setDualControlPolicy')
    expect(decoded.args).toEqual([slot, 2, zero, keys])
    expect(await readApprovalPolicy(s.app, slot)).toEqual({quorum: 2, ruleHash: zero, approvers: keys})
  })
  it('is set-once: an identical installed policy sends nothing; a different one refuses before sending', async () => {
    const same = setup(2, {installed: {quorum: 2, ruleHash: zero, approvers: [...keys].reverse()}})
    await expect(setApprovalPolicy(same.app, slot, {quorum: 2, approvers: seeds.map(x => ed25519.getPublicKey(x))}, same)).resolves.toEqual({phase: 'already-installed', slotId: slot})
    expect(same.transfer).not.toHaveBeenCalled()
    const other = setup(2, {installed: {quorum: 1, ruleHash: zero, approvers: keys}})
    await expect(setApprovalPolicy(other.app, slot, {quorum: 2, approvers: seeds.map(x => ed25519.getPublicKey(x))}, other)).rejects.toThrow('set-once')
    expect(other.transfer).not.toHaveBeenCalled()
  })
  it('refuses an unready key or an unsupported mode before sending', async () => {
    const unready = setup(2, {ready: false})
    await expect(setApprovalPolicy(unready.app, slot, {quorum: 1, approvers: [ed25519.getPublicKey(seeds[0]!)]}, unready)).rejects.toMatchObject({code: 'KEY_NOT_READY'})
    const odd = setup(3)
    await expect(setApprovalPolicy(odd.app, slot, {quorum: 1, approvers: [ed25519.getPublicKey(seeds[0]!)]}, odd)).rejects.toMatchObject({code: 'WRONG_SLOT_MODE'})
    expect(unready.transfer).not.toHaveBeenCalled(); expect(odd.transfer).not.toHaveBeenCalled()
  })
})

describe('operation approval bundles for a final paid ECDSA signature', () => {
  const installed = {quorum: 2, ruleHash: zero, approvers: keys}
  it('prepares a statement bound to the slot, digest, key epoch, request ID and payment hash', async () => {
    const s = setup(2, {installed}), p = payment()
    const prepared = await prepareOperationApproval(s.app, {payment: p})
    expect(prepared.statement).toMatchObject({operation: 'secp256k1-sign', epoch: 1, chain_id: 43112, identity: null,
      request_id: prepaidRequestId(p).slice(2), payment_hash: [...Buffer.from(paymentIntentHash(p).slice(2), 'hex')]})
    expect((await prepareOperationApproval(setup(4, {installed}).app, {payment: p})).statement.operation).toBe('p256-sign')
  })
  it.each([
    ['no installed policy', () => setup(2), payment(), 'no native approval policy'],
    ['another key epoch', () => setup(2, {installed, epoch: 2}), payment(), 'another key epoch'],
    ['a FROST slot (collector instead)', () => setup(0, {installed}), payment({action: 'sign'}), 'slot.approvals()'],
    ['another chain', () => setup(2, {installed}), payment({chain_id: 1}), 'another chain'],
  ] as const)('refuses %s', async (_name, make, p, message) => {
    await expect(prepareOperationApproval(make().app, {payment: p})).rejects.toThrow(message)
  })
  it('assembles distinct in-set approvals up to the on-chain quorum, and refuses missing, duplicate, foreign, stale or other-statement approvals', async () => {
    const s = setup(2, {installed}), p = payment()
    const prepared = await prepareOperationApproval(s.app, {payment: p})
    const sign = (i: number, prep = prepared) => approveDualOperation({prepared: prep, payment: p, expectSlot: slot, expectPayloadDigest: p.payload_digest, approver: approver(seeds[i]!)})
    const [a, b] = [await sign(0), await sign(1)]
    const proof = await assembleOperationApproval(s.app, {prepared, approvals: [a, b]})
    expect(proof.approvals.map(x => x.approver_pubkey)).toEqual([keys[0]!.slice(2), keys[1]!.slice(2)])
    // Missing: one approval for a quorum of two read from chain.
    await expect(assembleOperationApproval(s.app, {prepared, approvals: [a]})).rejects.toThrow('needs 2 distinct approvals')
    // Duplicate approver.
    await expect(assembleOperationApproval(s.app, {prepared, approvals: [a, a]})).rejects.toThrow('duplicate approver')
    // A valid signature by a key outside the installed set.
    const outsider = new Uint8Array(32).fill(99)
    const foreign = await approveDualOperation({prepared, payment: p, expectSlot: slot, expectPayloadDigest: p.payload_digest, approver: approver(outsider)})
    await expect(assembleOperationApproval(s.app, {prepared, approvals: [a, foreign]})).rejects.toThrow("not in the slot's approver set")
    // Stale: past the statement's expiry.
    await expect(assembleOperationApproval(s.app, {prepared, approvals: [a, b], nowSecs: prepared.statement.expires_at})).rejects.toThrow('not current')
    // An approval of another final payment (wrong payment binding) never counts toward this one.
    const otherPayment = payment({nonce: h(77)})
    const otherPrepared = await prepareOperationApproval(s.app, {payment: otherPayment})
    const wrong = await approveDualOperation({prepared: otherPrepared, payment: otherPayment, expectSlot: slot, expectPayloadDigest: otherPayment.payload_digest, approver: approver(seeds[1]!)})
    await expect(assembleOperationApproval(s.app, {prepared, approvals: [a, wrong]})).rejects.toThrow('approvals name different operations')
  })
  it('an approver refuses to sign a statement for another digest than the one it expects', async () => {
    const s = setup(2, {installed}), p = payment(), prepared = await prepareOperationApproval(s.app, {payment: p})
    await expect(approveDualOperation({prepared, payment: p, expectSlot: slot, expectPayloadDigest: h(55), approver: approver(seeds[0]!)})).rejects.toThrow('unexpected operation digest')
  })
})
