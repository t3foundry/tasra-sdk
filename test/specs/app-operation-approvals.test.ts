// Native two-person approvals beyond FROST (keykeeper-network a98adff6): installing a set-once
// policy on a threshold ECDSA slot by a creator transaction, preparing the statement for ONE
// operation from the slot's own epoch and mode, and assembling a bundle judged against the
// ON-CHAIN policy before anything is sent. No payment is involved.
import {describe, expect, it, vi} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import {sha256} from '@noble/hashes/sha256'
import {decodeFunctionData, hexToBytes, toHex, type Hex} from 'viem'
import {assembleOperationApproval, prepareOperationApproval, readApprovalPolicy, setApprovalPolicy} from '../../src/app/approvals.js'
import {approveDualOperation} from '../../src/committee/dual-operation.js'
import {keyRegistryAbi} from '../../src/chain/abis/index.js'
import {requestHash} from '../../src/oid4vp/binding.js'
import {signingIntentDigest} from '../../src/app/signing-intents.js'
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

/** The 32-byte digest the slot signs, and the statement payload digest it yields (its SHA-256). */
const digest = new Uint8Array(32).fill(5), payloadDigest = toHex(sha256(digest))

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

describe('operation approval bundles for a threshold ECDSA signature', () => {
  const installed = {quorum: 2, ruleHash: zero, approvers: keys}
  it('prepares a statement bound to the chain, slot, digest, key epoch and the request hash, and no payment', async () => {
    const s = setup(2, {installed})
    const prepared = await prepareOperationApproval(s.app, {slotId: slot, digest})
    expect(prepared.statement).toMatchObject({operation: 'secp256k1-sign', epoch: 1, chain_id: 43112, identity: null,
      slot: [...hexToBytes(slot)], payload_digest: [...sha256(digest)],
      request_id: toHex(requestHash(43112, hexToBytes(slot), 'sign', sha256(digest))).slice(2)})
    expect(prepared.statement).not.toHaveProperty('payment_hash')
    expect(prepared.statement.expires_at - prepared.statement.issued_at).toBe(300)
    expect((await prepareOperationApproval(setup(4, {installed}).app, {slotId: slot, digest})).statement.operation).toBe('p256-sign')
    // A structured intent is the same statement as its digest.
    const intent = {kind: 'message' as const, message: 'pay 1 TSRA'}
    expect((await prepareOperationApproval(s.app, {slotId: slot, intent, nowSecs: 7})).statement)
      .toEqual((await prepareOperationApproval(s.app, {slotId: slot, digest: signingIntentDigest(intent), nowSecs: 7})).statement)
  })
  it.each([
    ['no installed policy', () => setup(2), {slotId: slot, digest}, 'no native approval policy'],
    ['a FROST slot (collector instead)', () => setup(0, {installed}), {slotId: slot, digest}, 'slot.approvals()'],
    ['a digest that is not 32 bytes', () => setup(2, {installed}), {slotId: slot, digest: new Uint8Array(31)}, 'exactly 32 bytes'],
    ['no operation named', () => setup(2, {installed}), {slotId: slot}, 'exactly one of'],
    ['two operations named', () => setup(2, {installed}), {slotId: slot, digest, payloadDigest: sha256(digest)}, 'exactly one of'],
  ] as const)('refuses %s', async (_name, make, input, message) => {
    await expect(prepareOperationApproval(make().app, input)).rejects.toThrow(message)
  })
  it('names the slot\'s CURRENT key epoch: a statement prepared before a rotation is another operation', async () => {
    const before = await prepareOperationApproval(setup(2, {installed}).app, {slotId: slot, digest, nowSecs: 7})
    const after = await prepareOperationApproval(setup(2, {installed, epoch: 2}).app, {slotId: slot, digest, nowSecs: 7})
    expect(before.statement.epoch).toBe(1); expect(after.statement.epoch).toBe(2)
    expect(after.message_hex).not.toBe(before.message_hex)
  })
  it('assembles distinct in-set approvals up to the on-chain quorum, and refuses missing, duplicate, foreign, stale or other-statement approvals', async () => {
    const s = setup(2, {installed})
    const prepared = await prepareOperationApproval(s.app, {slotId: slot, digest})
    const sign = (i: number, prep = prepared) => approveDualOperation({prepared: prep, expectSlot: slot, expectPayloadDigest: payloadDigest, approver: approver(seeds[i]!)})
    const [a, b] = [await sign(0), await sign(1)]
    const proof = await assembleOperationApproval(s.app, {prepared, approvals: [a, b]})
    expect(proof.approvals.map(x => x.approver_pubkey)).toEqual([keys[0]!.slice(2), keys[1]!.slice(2)])
    // Missing: one approval for a quorum of two read from chain.
    await expect(assembleOperationApproval(s.app, {prepared, approvals: [a]})).rejects.toThrow('needs 2 distinct approvals')
    // Duplicate approver.
    await expect(assembleOperationApproval(s.app, {prepared, approvals: [a, a]})).rejects.toThrow('duplicate approver')
    // A valid signature by a key outside the installed set.
    const outsider = new Uint8Array(32).fill(99)
    const foreign = await approveDualOperation({prepared, expectSlot: slot, expectPayloadDigest: payloadDigest, approver: approver(outsider)})
    await expect(assembleOperationApproval(s.app, {prepared, approvals: [a, foreign]})).rejects.toThrow("not in the slot's approver set")
    // Stale: past the statement's expiry.
    await expect(assembleOperationApproval(s.app, {prepared, approvals: [a, b], nowSecs: prepared.statement.expires_at})).rejects.toThrow('not current')
    // An approval of another operation (another digest) never counts toward this one.
    const otherDigest = new Uint8Array(32).fill(6)
    const otherPrepared = await prepareOperationApproval(s.app, {slotId: slot, digest: otherDigest})
    const wrong = await approveDualOperation({prepared: otherPrepared, expectSlot: slot, expectPayloadDigest: toHex(sha256(otherDigest)), approver: approver(seeds[1]!)})
    await expect(assembleOperationApproval(s.app, {prepared, approvals: [a, wrong]})).rejects.toThrow('approvals name different operations')
  })
  it('an approver refuses to sign a statement for another digest than the one it expects', async () => {
    const s = setup(2, {installed}), prepared = await prepareOperationApproval(s.app, {slotId: slot, digest})
    await expect(approveDualOperation({prepared, expectSlot: slot, expectPayloadDigest: h(55), approver: approver(seeds[0]!)})).rejects.toThrow('unexpected operation digest')
  })
})

describe('operation approvals: modes, credential policies and wallet chain', () => {
  const installed = {quorum: 2, ruleHash: zero, approvers: keys}
  const recipientDigest = new Uint8Array(32).fill(8)
  it('names the KEM or IBE operation on a threshold BLS slot, and carries the IBE identity into the statement', async () => {
    const s = setup(1, {installed})
    const kem = (await prepareOperationApproval(s.app, {slotId: slot, payloadDigest: recipientDigest})).statement
    expect(kem).toMatchObject({operation: 'kem-decrypt', identity: null, payload_digest: [...recipientDigest],
      request_id: toHex(requestHash(43112, hexToBytes(slot), 'decrypt', recipientDigest)).slice(2)})
    const ibe = (await prepareOperationApproval(s.app, {slotId: slot, payloadDigest: recipientDigest, identity: 'issuer/patient-7'})).statement
    expect(ibe).toMatchObject({operation: 'ibe-extract', identity: 'issuer/patient-7',
      request_id: toHex(requestHash(43112, hexToBytes(slot), 'ibe-extract', recipientDigest)).slice(2)})
  })
  it('refuses an operation the slot mode does not run, naming the mode', async () => {
    // A decryption digest on an ECDSA slot, and a signing digest on a BLS slot.
    await expect(prepareOperationApproval(setup(2, {installed}).app, {slotId: slot, payloadDigest: recipientDigest})).rejects
      .toMatchObject({code: 'WRONG_SLOT_MODE', message: expect.stringContaining('Slot mode 2 does not run this operation')})
    await expect(prepareOperationApproval(setup(1, {installed}).app, {slotId: slot, digest})).rejects.toMatchObject({code: 'WRONG_SLOT_MODE'})
    await expect(prepareOperationApproval(setup(2, {installed}).app, {slotId: slot, digest, identity: 'x'})).rejects.toMatchObject({code: 'WRONG_SLOT_MODE'})
    await expect(prepareOperationApproval(setup(3, {installed}).app, {slotId: slot, digest})).rejects.toMatchObject({code: 'WRONG_SLOT_MODE'})
  })
  it('assemble refuses a slot with no policy', async () => {
    const prepared = await prepareOperationApproval(setup(2, {installed}).app, {slotId: slot, digest})
    const a = await approveDualOperation({prepared, expectSlot: slot, expectPayloadDigest: payloadDigest, approver: approver(seeds[0]!)})
    await expect(assembleOperationApproval(setup(2).app, {prepared, approvals: [a]})).rejects.toMatchObject({code: 'INVALID_AUTHORIZATION', message: expect.stringContaining('no native approval policy')})
  })
  it('under a credential policy every approval needs its holder-bound grant; any approver key may then count', async () => {
    const s = setup(2, {installed: {quorum: 1, ruleHash: h(0x33), approvers: []}})
    const prepared = await prepareOperationApproval(s.app, {slotId: slot, digest})
    const outsider = await approveDualOperation({prepared, expectSlot: slot, expectPayloadDigest: payloadDigest, approver: approver(new Uint8Array(32).fill(99))})
    await expect(assembleOperationApproval(s.app, {prepared, approvals: [outsider]})).rejects
      .toMatchObject({code: 'INVALID_AUTHORIZATION', message: expect.stringContaining('holder-bound grant')})
    const granted = {...outsider, approval: {...outsider.approval, committee_token: {binding: 'holder_key'} as never}}
    const proof = await assembleOperationApproval(s.app, {prepared, approvals: [granted]})
    expect(proof.approvals).toHaveLength(1)
    expect(proof.approvals[0]!.committee_token).toEqual({binding: 'holder_key'})
  })
  it('refuses to install a policy from a wallet on another chain, before reading or sending', async () => {
    const s = setup(2)
    const wallet = {wallet: {chain: {id: 1}}, transfer: s.transfer} as unknown as TasraWallet
    await expect(setApprovalPolicy(s.app, slot, {quorum: 1, approvers: [ed25519.getPublicKey(seeds[0]!)]}, {wallet, store: s.store})).rejects.toThrow('Approval wallet uses a different chain')
    expect(s.transfer).not.toHaveBeenCalled()
  })
})
