import {describe, expect, it, vi} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import {sha256} from '@noble/hashes/sha256'
import {decodeFunctionData, keccak256, toHex, type Hex} from 'viem'
import {approveWithCredential, identityApprover, setApprovalPolicy} from '../../src/app/approvals.js'
import {createIdentity, credentialPolicy} from '../../src/app/identity.js'
import type {TasraApplication, OperationGrant} from '../../src/app/client.js'
import type {TasraWallet} from '../../src/app/wallet.js'
import type {ApplicationStore} from '../../src/app/ready-slot.js'
import type {DualSignRequest, DualSignStatus} from '../../src/committee/dual-sign.js'
import {dualSignApprovalPayload, paidDualSignApprovalPayload} from '../../src/committee/dual-sign.js'
import {paymentIntentHash, prepaidRequestId, type PaymentIntentWire} from '../../src/committee/payment.js'
import {keyRegistryAbi} from '../../src/chain/abis/index.js'
const slot = `0x${'11'.repeat(32)}` as const, registry = `0x${'22'.repeat(20)}` as const, zero = `0x${'00'.repeat(32)}` as const
function setup() {
  const frost = vi.fn(async () => ({})), readContract = vi.fn(async ({functionName}: {functionName: string}): Promise<readonly [number, Hex] | readonly Hex[]> => functionName === 'dualControlApprovers' ? approvers.map(key => toHex(key)) : [2, zero]), transfer = vi.fn(async () => ({hash: slot, phase: 'confirmed'}))
  const app = {deployment: {chainId: 43112, addresses: {KeyRegistry: registry}}, slots: {frost}, chain: {client: {readContract}}} as unknown as TasraApplication
  const wallet = {wallet: {chain: {id: 43112}}, transfer} as unknown as TasraWallet
  const store = {} as ApplicationStore
  const identities = [createIdentity(), createIdentity()]
  const approvers = identities.map(identity => identityApprover(identity).publicKey)
  return {app, wallet, store, identities, approvers, frost, readContract, transfer}
}
describe('application approval helpers', () => {
  it('passes a separate fixed approval payment to the wallet and refuses a substituted result', async () => {
    const s = setup(), message = new Uint8Array([3, 4]), identity = s.identities[0]!
    const h = (n: number, size = 32) => ('0x' + n.toString(16).padStart(2, '0').repeat(size)) as Hex
    const payment: PaymentIntentWire = {
      chain_id: 43112, settlement: h(1, 20), key_registry: registry, slot, action: 'sign', payload_digest: toHex(sha256(message)),
      session_commitment: h(5), nonce: h(6), max_cost: '100', expires: Math.floor(Date.now() / 1000) + 600,
      verification_epoch: 7, verification_seed: h(8), verification_root: h(9), verification_registry_size: 1, verification_committee: 1, verification_quorum: 1,
      keeper_assignment: {key_epoch: 0, committee_version: 0, threshold: 1, coordinator: Array<number>(32).fill(1), contributors: [Array<number>(32).fill(1)]}, signature: h(1, 65),
    }
    const requestId = prepaidRequestId(payment).slice(2), payload = paidDualSignApprovalPayload(43112, slot, message, requestId, payment)
    const approval: PaymentIntentWire = {...payment, action: 'dual-approve', payload_digest: toHex(sha256(payload))}
    const approve = vi.fn(async () => ({status: 'pending' as const, have: 1, need: 2}))
    const status = vi.fn<() => Promise<DualSignStatus>>(async () => ({status: 'pending', have: 0, need: 2}))
    const request = {requestId, slotId: slot, payment, approve, status} as unknown as DualSignRequest
    const grant = {token: {payment: approval, payment_hash: paymentIntentHash(approval), exp: approval.expires}, verifierProofs: []} as unknown as OperationGrant
    const authorize = vi.fn(async () => grant)
    await expect(approveWithCredential(s.app, request, message, {identity, authorize})).rejects.toThrow('own reservation')
    await expect(approveWithCredential(s.app, request, message, {identity, authorize, payment, random: h(33)})).rejects.toThrow('reservation differs')
    expect(authorize).not.toHaveBeenCalled()
    await approveWithCredential(s.app, request, message, {identity, authorize, payment: approval, random: h(33)})
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({payment: approval, random: h(33), action: 'dual-approve', payloadDigest: sha256(payload)}))
    const submitted = (authorize.mock.calls[0] as unknown as [{nowSecs: number; ttlSecs: number}])[0]
    expect(submitted.nowSecs + submitted.ttlSecs).toBe(approval.expires)
    const changed = {...approval, nonce: h(66)}
    authorize.mockResolvedValue({...grant, token: {...grant.token, payment: changed, payment_hash: paymentIntentHash(changed)}})
    await expect(approveWithCredential(s.app, request, message, {identity, authorize, payment: approval, random: h(33)})).rejects.toThrow('changed the reserved')
    expect(approve).toHaveBeenCalledTimes(1)
    status.mockResolvedValue({status: 'uncertain'})
    authorize.mockClear()
    await expect(approveWithCredential(s.app, request, message, {identity, authorize})).resolves.toEqual({status: 'uncertain'})
    expect(authorize).not.toHaveBeenCalled()
    expect(approve).toHaveBeenCalledTimes(1)
  })
  it('signs canonical approval bytes with the identity public key and refuses destroyed or wrong-algorithm keys', async () => {
    const identity = createIdentity(), signer = identityApprover(identity), payload = dualSignApprovalPayload(slot, new Uint8Array([1, 2]), 'request-1')
    const signature = await signer.sign(payload)
    expect(ed25519.verify(signature, payload, signer.publicKey, {zip215: false})).toBe(true)
    expect(ed25519.verify(signature, dualSignApprovalPayload(slot, new Uint8Array([1, 2]), 'request-2'), signer.publicKey, {zip215: false})).toBe(false)
    identity.destroy()
    await expect(signer.sign(payload)).rejects.toThrow('destroyed')
    expect(() => identityApprover(createIdentity({algorithm: 'P-256'}))).toThrow('Ed25519')
  })
  it('encodes the exact static quorum and keys and confirms the on-chain policy', async () => {
    const s = setup(), result = await setApprovalPolicy(s.app, slot, {quorum: 2, approvers: s.approvers}, s)
    expect(result.phase).toBe('confirmed')
    expect(s.frost).toHaveBeenCalledWith(slot)
    const [name, transaction, store] = s.transfer.mock.calls[0]! as unknown as [string, {to: string; data: `0x${string}`}, ApplicationStore]
    expect(name).toBe(`approval-${slot.slice(2)}`)
    expect(store).toBe(s.store)
    expect(transaction.to).toBe(registry)
    const decoded = decodeFunctionData({abi: keyRegistryAbi, data: transaction.data})
    expect(decoded.functionName).toBe('setDualControlPolicy')
    expect(decoded.args).toEqual([slot, 2, zero, s.approvers.map(key => toHex(key))])
  })
  it('hashes the explicit credential rule and refuses mismatched policy readback', async () => {
    const s = setup(), policy = credentialPolicy({issuer: s.identities[0]!, type: 'member'})
    s.readContract.mockImplementation(async ({functionName}) => functionName === 'dualControlApprovers' ? [] : [2, keccak256(toHex(policy))])
    await setApprovalPolicy(s.app, slot, {quorum: 2, credentialPolicy: policy}, s)
    const transaction = (s.transfer.mock.calls[0] as unknown as [string, {data: `0x${string}`}])[1]
    expect(decodeFunctionData({abi: keyRegistryAbi, data: transaction.data}).args).toEqual([slot, 2, keccak256(toHex(policy)), []])
    s.readContract.mockImplementation(async ({functionName}) => functionName === 'dualControlApprovers' ? [] : [1, zero])
    await expect(setApprovalPolicy(s.app, slot, {quorum: 2, credentialPolicy: policy}, s)).rejects.toThrow('differs')
  })
  it('refuses changed static membership even when quorum and rule hash match', async () => {
    const s = setup()
    s.readContract.mockImplementation(async ({functionName}) => functionName === 'dualControlApprovers' ? [toHex(s.approvers[0]!), zero] : [2, zero])
    await expect(setApprovalPolicy(s.app, slot, {quorum: 2, approvers: s.approvers}, s)).rejects.toThrow('approval keys differ')
  })
  it('rejects ambiguous, duplicate and impossible policies before spending', async () => {
    const s = setup()
    for (const policy of [{quorum: 0, approvers: s.approvers}, {quorum: 3, approvers: s.approvers}, {quorum: 1},
      {quorum: 2, approvers: [s.approvers[0]!, s.approvers[0]!]}, {quorum: 1, approvers: [new Uint8Array(31)]}, {quorum: 1, approvers: [new Uint8Array(32)]},
      {quorum: 1, credentialPolicy: 'malformed'}, {quorum: 1, approvers: s.approvers, credentialPolicy: '{}'}]) {
      await expect(setApprovalPolicy(s.app, slot, policy, s)).rejects.toThrow()
    }
    expect(s.transfer).not.toHaveBeenCalled()
  })
  it('binds credential authorization to the exact chain, registry, slot, message and request', async () => {
    const s = setup(), message = new Uint8Array([3, 4]), identity = s.identities[0]!, grant = {token: {}, verifierProofs: []} as unknown as OperationGrant
    const approve = vi.fn(async () => ({status: 'pending' as const, have: 1, need: 2})), authorize = vi.fn(async () => grant)
    const status = vi.fn(async () => ({status: 'pending' as const, have: 0, need: 2}))
    const request = {requestId: 'request-1', slotId: slot, approve, status} as unknown as DualSignRequest
    await approveWithCredential(s.app, request, message, {identity, authorize})
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({chainId: 43112, keyRegistry: registry, slotId: slot, action: 'dual-approve',
      payloadDigest: sha256(dualSignApprovalPayload(slot, message, request.requestId))}))
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({authorization: grant}))
    await expect(approveWithCredential(s.app, request, message, {identity, authorize, signal: AbortSignal.abort()})).rejects.toThrow()
    expect(approve).toHaveBeenCalledTimes(1)
  })
  it.each(['uncertain', 'failed', 'signing'] as const)('does no credential work for a %s request', async state => {
    const s = setup(), authorize = vi.fn(), approve = vi.fn()
    const observed = {status: state, have: 2, need: 2}
    const request = {requestId: 'request-1', slotId: slot, approve,
      status: vi.fn(async () => observed)} as unknown as DualSignRequest
    await expect(approveWithCredential(s.app, request, new Uint8Array([3, 4]), {
      identity: s.identities[0]!, authorize,
    })).resolves.toEqual(observed)
    expect(authorize).not.toHaveBeenCalled()
    expect(approve).not.toHaveBeenCalled()
    expect(s.frost).not.toHaveBeenCalled()
  })
})
