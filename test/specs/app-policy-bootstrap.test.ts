// Customer authorization bootstrap: a holder application runs paid operations from a creator-signed
// slot policy statement, never holding the rule salt. Offline statement checks, the on-chain half
// inside paidOperation, the store's sequence high-water mark, and one-operation-per-key recovery.
// Reservation, session and keeper steps are spies, as in app-paid-operation.test.ts.
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {defineChain, keccak256, toHex, type Address, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {ed25519} from '@noble/curves/ed25519'

vi.mock('../../src/chain/billing.js', async original => ({...await original<typeof import('../../src/chain/billing.js')>(), requirePrepaidSlot: vi.fn()}))
vi.mock('../../src/chain/prepaid.js', async original => ({...await original<typeof import('../../src/chain/prepaid.js')>(),
  discoverPaidOperationContext: vi.fn(), readClientExecutionPolicy: vi.fn(), readCurrentBeaconEpoch: vi.fn()}))
vi.mock('../../src/chain/verifierSnapshot.js', () => ({fetchDrawnVerifierWitnesses: vi.fn()}))
vi.mock('../../src/app/paid-reservation.js', async original => ({...await original<typeof import('../../src/app/paid-reservation.js')>(),
  reserveApplicationPayment: vi.fn(), reconcileApplicationPayment: vi.fn(), reconcileApplicationReservation: vi.fn()}))
vi.mock('../../src/app/paid-journal.js', async original => ({...await original<typeof import('../../src/app/paid-journal.js')>(), loadPaidReservationJournal: vi.fn()}))
vi.mock('../../src/chain/registeredPaidAgent.js', async original => ({...await original<typeof import('../../src/chain/registeredPaidAgent.js')>(), prepareRegisteredPaidSession: vi.fn()}))
vi.mock('../../src/app/paid-session.js', async original => ({...await original<typeof import('../../src/app/paid-session.js')>(), drivePaidSession: vi.fn()}))
vi.mock('../../src/oid4vp/verifier-agent.js', async original => ({...await original<typeof import('../../src/oid4vp/verifier-agent.js')>(), verifierAgentResult: vi.fn()}))
vi.mock('../../src/committee/execution.js', async original => ({...await original<typeof import('../../src/committee/execution.js')>(), createExecutionCertificate: vi.fn()}))
vi.mock('../../src/chain/keeperExecution.js', () => ({createKeeperExecutionApprover: vi.fn(() => vi.fn())}))

import {paidOperation, paidOperationPhase, type PaidOperationConfig} from '../../src/app/paid-operation.js'
import {paidPolicyOperation, readPolicyOperation} from '../../src/app/policy-operation.js'
import {createSlotPolicyRequest, issueSlotPolicyBootstrap, policyOperationKey, slotPolicyHash, slotPolicyTypedData, verifySlotPolicyBootstrap, verifySlotPolicyRequest,
  PolicyOperationError, SlotPolicyError, type SlotPolicyBootstrap, type SlotPolicyStatement} from '../../src/app/policy-bootstrap.js'
import {createMemoryStore} from '../../src/app/memory-store.js'
import {paidRecordKey} from '../../src/app/paid-keys.js'
import {requirePrepaidSlot} from '../../src/chain/billing.js'
import {discoverPaidOperationContext, readClientExecutionPolicy, readCurrentBeaconEpoch, type PaidOperationContext} from '../../src/chain/prepaid.js'
import {fetchDrawnVerifierWitnesses} from '../../src/chain/verifierSnapshot.js'
import {reserveApplicationPayment, reconcileApplicationReservation} from '../../src/app/paid-reservation.js'
import {loadPaidReservationJournal} from '../../src/app/paid-journal.js'
import {prepareRegisteredPaidSession, type RegisteredPaidAgentSession} from '../../src/chain/registeredPaidAgent.js'
import {drivePaidSession, PaidSessionRecoveryError} from '../../src/app/paid-session.js'
import {verifierAgentResult} from '../../src/oid4vp/verifier-agent.js'
import {createExecutionCertificate} from '../../src/committee/execution.js'
import {assembleCompoundToken, compoundTokenHash, selectVerifierCommittee, statusAttestationHash, type CompoundTokenPayload} from '../../src/committee/token.js'
import {ruleCommitment} from '../../src/chain/write.js'
import {hexToBytes} from 'viem'
import type {TasraChainClient} from '../../src/chain/client.js'

const h = (n: number, len = 32): Hex => `0x${n.toString(16).padStart(2, '0').repeat(len)}`
const creator = privateKeyToAccount(h(7)), payer = privateKeyToAccount(h(8)), app = privateKeyToAccount(h(21)), otherApp = privateKeyToAccount(h(22))
const slot = h(3), salt = h(4), rule = JSON.stringify({credentials: [{id: 'a', format: 'dc+sd-jwt', claims: [{path: ['iss'], values: ['did:web:issuer.example']}]}]})
const commitment = ruleCommitment(salt, rule)
const chainDef = defineChain({id: 43112, name: 'local', nativeCurrency: {name: 'AVAX', symbol: 'AVAX', decimals: 18}, rpcUrls: {default: {http: ['http://localhost:1']}}})
const deployment = {chainId: 43112, settlement: h(1, 20), keyRegistry: h(2, 20), verifierSet: h(5, 20), accountantSet: h(6, 20), beacon: h(9, 20)}
const coordinator = {operator: h(11, 20), publicKey: h(12), url: 'http://127.0.0.1:4001'}
const verifierSeed = new Uint8Array(32).fill(15)
const drawnIndex = selectVerifierCommittee(hexToBytes(slot), 7, hexToBytes(h(41)), 3, 1)[0]!
const witnesses = [{index: drawnIndex, operator: h(13, 20), publicKey: toHex(ed25519.getPublicKey(verifierSeed)), proof: []}]

function grantToken(expected: {requestHash: Uint8Array; paymentHash?: string}) {
  const now = Math.floor(Date.now() / 1000)
  const payload: CompoundTokenPayload = {tokenType: 'JWT', seed: hexToBytes(h(41)), epoch: 7, slotId: hexToBytes(slot), vpHash: hexToBytes(h(43)),
    holderHash: hexToBytes(h(44)), ruleHash: hexToBytes(keccak256(toHex(rule))), requestHash: expected.requestHash, paymentHash: hexToBytes(expected.paymentHash as Hex),
    binding: 1, verifierIndexes: [drawnIndex], iat: now, exp: now + 600}
  const hash = compoundTokenHash(payload), until = now + 30
  return assembleCompoundToken(payload, [{verifierIndex: drawnIndex, signature: ed25519.sign(hash, verifierSeed)}],
    [{verifierIndex: drawnIndex, statusUntil: until, signature: ed25519.sign(statusAttestationHash(hash, drawnIndex, until), verifierSeed)}])
}

/** The slot as KeyRegistry returns it, at the block discovery reads. */
const onChain = {creator: creator.address, ruleCommitment: commitment, ruleVersion: 0, exists: true, cancelled: false}
function chainReader(slotState: Partial<typeof onChain> = {}): TasraChainClient {
  return {client: {getChainId: vi.fn(async () => 43112), readContract: vi.fn(async () => ({...onChain, ruleVersion: BigInt(onChain.ruleVersion), ...slotState,
    ...(slotState.ruleVersion !== undefined ? {ruleVersion: BigInt(slotState.ruleVersion)} : {})}))},
  addresses: {KeyRegistry: deployment.keyRegistry}} as unknown as TasraChainClient
}
const issue = (over: Partial<Parameters<typeof issueSlotPolicyBootstrap>[1]> = {}) => issueSlotPolicyBootstrap(chainReader(),
  {signer: creator, slot, rule, salt, audience: app.address, actions: ['sign', 'decrypt'], sequence: 1, ...over})
/** Re-sign a statement as `signer` (the creator unless named). */
async function resign(statement: SlotPolicyStatement, signer = creator, ruleText = rule): Promise<SlotPolicyBootstrap> {
  return {statement, rule: ruleText, signature: await signer.signTypedData(slotPolicyTypedData(statement))}
}
const expect_ = {chainId: 43112, keyRegistry: deployment.keyRegistry, slot, audience: app.address, action: 'sign' as const, signer: creator.address}

function setup(context: Partial<PaidOperationContext> = {}) {
  const store = createMemoryStore()
  const client = {readContract: vi.fn(async () => ({ruleCommitment: commitment, ruleVersion: 0n})), getBlock: vi.fn(async () => ({hash: h(20)}))}
  const signTypedData = vi.fn(creator.signTypedData.bind(creator))
  const config: PaidOperationConfig = {
    chain: {client, addresses: {ServiceRegistry: h(30, 20)}} as unknown as PaidOperationConfig['chain'],
    deployment, creator: {address: creator.address, signTypedData: signTypedData as typeof creator.signTypedData}, store, accountantUrls: ['http://127.0.0.1:9000'], allowLocalHttp: true,
    gasPayer: {account: payer, chain: chainDef} as unknown as PaidOperationConfig['gasPayer'],
    agent: {profile: {endpoint: 'https://agent.example', clientId: 'decentralized_identifier:did:web:agent.example',
      approval: {chainId: 43112, registry: h(30, 20), serviceId: h(31), owner: h(32, 20), revision: 1n, manifestHash: h(33), serviceType: 1}},
    transport: {} as PaidOperationConfig['agent']['transport']},
    limits: {maxCost: 100n, maxGas: 500_000n, maxGasPrice: 10n ** 11n}, pollIntervalMs: 10,
  }
  vi.mocked(discoverPaidOperationContext).mockResolvedValue({blockNumber: 20n, blockHash: h(20), blockTimestamp: 1n, creator: creator.address,
    mode: 0, groupPublicKey: h(40), coordinator, contributors: [coordinator], available: 100n, ruleCommitment: commitment, ruleVersion: 0,
    intentFields: {chain_id: 43112, settlement: deployment.settlement, key_registry: deployment.keyRegistry, slot, verification_epoch: 7, verification_seed: h(41),
      verification_root: h(42), verification_registry_size: 3, verification_committee: 1, verification_quorum: 1,
      keeper_assignment: {key_epoch: 1, committee_version: 1, threshold: 1, coordinator: Array<number>(32).fill(12), contributors: [Array<number>(32).fill(12)]}},
    ...context} as PaidOperationContext)
  vi.mocked(fetchDrawnVerifierWitnesses).mockResolvedValue({witnesses, artifact: {}, host: 'http://127.0.0.1:9000'})
  vi.mocked(reserveApplicationPayment).mockResolvedValue({transactionHash: h(50)} as Awaited<ReturnType<typeof reserveApplicationPayment>>)
  vi.mocked(readClientExecutionPolicy).mockResolvedValue({policy: {}} as Awaited<ReturnType<typeof readClientExecutionPolicy>>)
  vi.mocked(createExecutionCertificate).mockImplementation(async ({publicKey, expires}) => ({execution_key: `0x${Buffer.from(publicKey).toString('hex')}`, expires, creator_signature: h(51, 65)}))
  vi.mocked(prepareRegisteredPaidSession).mockResolvedValue({sessionId: 'ab'.repeat(32)} as RegisteredPaidAgentSession)
  vi.mocked(drivePaidSession).mockResolvedValue({status: 'done', phase: 'done'})
  vi.mocked(verifierAgentResult).mockImplementation(expected => ({token: grantToken(expected),
    verifierProofs: [{verifierIndex: drawnIndex, operator: '13'.repeat(20), pubkey: witnesses[0]!.publicKey.slice(2), proof: []}]}))
  const holder = {kind: 'local' as const, makePresentation: vi.fn(), submit: vi.fn()}
  const operation = {action: 'sign' as const, message: new TextEncoder().encode('hello')}
  return {store, client, config, holder, operation, signTypedData}
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  vi.mocked(requirePrepaidSlot).mockResolvedValue({slot, mode: 'prepaid'})
  vi.mocked(loadPaidReservationJournal).mockResolvedValue(undefined)
  vi.mocked(readCurrentBeaconEpoch).mockReset().mockResolvedValue(7n)
  vi.mocked(reconcileApplicationReservation).mockResolvedValue({state: 'none', payerLocked: false, requestId: h(0), observedAt: {blockNumber: 20n, blockHash: h(20), blockTimestamp: 1n}})
})

describe('slot policy statements, offline', () => {
  it('the creator issues a statement bound to the on-chain commitment and rule version; it carries no salt', async () => {
    const b = await issue()
    expect(b.statement).toMatchObject({chainId: 43112, slot, ruleCommitment: commitment.toLowerCase(), ruleVersion: 0, ruleHash: keccak256(toHex(rule)), audience: app.address})
    expect(JSON.stringify(b).toLowerCase()).not.toContain(salt.slice(2))
    const {signer} = await verifySlotPolicyBootstrap(b, expect_)
    expect(signer).toBe(creator.address)
  })

  it('the issuer refuses a slot it does not create, a salt that does not reproduce the commitment and a dead slot', async () => {
    await expect(issueSlotPolicyBootstrap(chainReader(), {signer: otherApp, slot, rule, salt, audience: app.address, actions: ['sign'], sequence: 1})).rejects.toMatchObject({code: 'not-issuable'})
    await expect(issue({salt: h(5)})).rejects.toMatchObject({code: 'not-issuable'})
    await expect(issueSlotPolicyBootstrap(chainReader({cancelled: true}), {signer: creator, slot, rule, salt, audience: app.address, actions: ['sign'], sequence: 1})).rejects.toMatchObject({code: 'not-issuable'})
    await expect(issue({ttlSecs: 86_401})).rejects.toMatchObject({code: 'malformed'})
    await expect(issue({actions: []})).rejects.toMatchObject({code: 'malformed'})
  })

  it('refuses a substituted rule, a substituted commitment or rule hash, and another signer', async () => {
    const b = await issue()
    const other = JSON.stringify({credentials: [{id: 'a', format: 'dc+sd-jwt', claims: [{path: ['iss'], values: ['did:web:attacker.example']}]}]})
    await expect(verifySlotPolicyBootstrap({...b, rule: other}, expect_)).rejects.toMatchObject({code: 'substituted-rule'})
    // Fields changed without the creator's key: the signature no longer recovers to the creator.
    await expect(verifySlotPolicyBootstrap({...b, statement: {...b.statement, ruleCommitment: h(66)}}, expect_)).rejects.toMatchObject({code: 'wrong-signer'})
    await expect(verifySlotPolicyBootstrap({...b, rule: other, statement: {...b.statement, ruleHash: keccak256(toHex(other))}}, expect_)).rejects.toMatchObject({code: 'wrong-signer'})
    await expect(verifySlotPolicyBootstrap(await resign(b.statement, otherApp), expect_)).rejects.toMatchObject({code: 'wrong-signer'})
  })

  it('refuses another deployment, slot or application, an action out of scope and a malformed bootstrap', async () => {
    const b = await issue({actions: ['decrypt']})
    await expect(verifySlotPolicyBootstrap(b, {...expect_, chainId: 1})).rejects.toMatchObject({code: 'wrong-deployment'})
    await expect(verifySlotPolicyBootstrap(b, {...expect_, keyRegistry: h(77, 20)})).rejects.toMatchObject({code: 'wrong-deployment'})
    await expect(verifySlotPolicyBootstrap(b, {...expect_, slot: h(78)})).rejects.toMatchObject({code: 'wrong-slot'})
    await expect(verifySlotPolicyBootstrap(b, {...expect_, audience: otherApp.address})).rejects.toMatchObject({code: 'wrong-audience'})
    await expect(verifySlotPolicyBootstrap(b, expect_)).rejects.toMatchObject({code: 'out-of-scope'})
    await expect(verifySlotPolicyBootstrap({...b, salt} as unknown as SlotPolicyBootstrap, {...expect_, action: 'decrypt'})).rejects.toMatchObject({code: 'malformed'})
    await expect(verifySlotPolicyBootstrap({...b, signature: '0x00'}, {...expect_, action: 'decrypt'})).rejects.toMatchObject({code: 'malformed'})
    await expect(verifySlotPolicyBootstrap({...b, rule: 'x'.repeat(4097)}, {...expect_, action: 'decrypt'})).rejects.toMatchObject({code: 'malformed'})
  })

  it('refuses an expired statement, one not valid yet and one claiming more than a day', async () => {
    const t = Math.floor(Date.now() / 1000)
    const b = await issue({ttlSecs: 60, nowSecs: t})
    await expect(verifySlotPolicyBootstrap(b, {...expect_, nowSecs: t + 60})).rejects.toMatchObject({code: 'stale'})
    await expect(verifySlotPolicyBootstrap(b, {...expect_, nowSecs: t - 120})).rejects.toMatchObject({code: 'stale'})
    const long = await resign({...b.statement, expiresAt: b.statement.issuedAt + 86_401})
    await expect(verifySlotPolicyBootstrap(long, {...expect_, nowSecs: t})).rejects.toMatchObject({code: 'stale'})
  })

  it('a holder application signs its retrieval request; the issuer checks deployment, age and signer', async () => {
    const request = await createSlotPolicyRequest(app, {chainId: 43112, keyRegistry: deployment.keyRegistry, slot})
    expect((await verifySlotPolicyRequest(request, {chainId: 43112, keyRegistry: deployment.keyRegistry})).audience).toBe(app.address)
    await expect(verifySlotPolicyRequest(request, {chainId: 1, keyRegistry: deployment.keyRegistry})).rejects.toMatchObject({code: 'wrong-deployment'})
    await expect(verifySlotPolicyRequest(request, {chainId: 43112, keyRegistry: deployment.keyRegistry, nowSecs: request.issuedAt + 121})).rejects.toMatchObject({code: 'stale'})
    await expect(verifySlotPolicyRequest({...request, audience: otherApp.address}, {chainId: 43112, keyRegistry: deployment.keyRegistry})).rejects.toMatchObject({code: 'wrong-signer'})
    await expect(verifySlotPolicyRequest({...request, extra: 1} as never, {chainId: 43112, keyRegistry: deployment.keyRegistry})).rejects.toMatchObject({code: 'malformed'})
  })
})

describe('paidOperation from a slot policy bootstrap', () => {
  it('journals the bootstrap and the raw rule before reserving; the salt is nowhere in the store', async () => {
    const f = setup(), b = await issue()
    const op = await paidOperation(f.config, {slot, operation: f.operation, rule: {policy: b, audience: app.address}, holder: f.holder})
    const record = await f.store.load<Record<string, unknown>>(paidRecordKey(op.requestId))
    expect(record).toMatchObject({rule, ruleSalt: h(0), policy: {statement: b.statement, signature: b.signature}})
    expect(JSON.stringify(record).toLowerCase()).not.toContain(salt.slice(2))
    expect(vi.mocked(prepareRegisteredPaidSession).mock.calls[0]![1]).toMatchObject({ruleHash: keccak256(toHex(rule)), dcqlQuery: JSON.parse(rule) as unknown})
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
    op.dispose()
  })

  it('refuses a changed commitment, a changed rule version or a handed-off creator before the creator signs or anything is reserved', async () => {
    const b = await issue()
    for (const context of [{ruleCommitment: h(66)}, {ruleVersion: 1}]) {
      const f = setup(context)
      await expect(paidOperation(f.config, {slot, operation: f.operation, rule: {policy: b, audience: app.address}, holder: f.holder})).rejects.toMatchObject({code: 'changed-policy'})
      expect(f.signTypedData).not.toHaveBeenCalled()
    }
    // The slot moved to a new creator: a statement signed by the former one does not start an operation for the new one.
    const next = privateKeyToAccount(h(23)), f = setup({creator: next.address})
    await expect(paidOperation({...f.config, creator: next}, {slot, operation: f.operation, rule: {policy: b, audience: app.address}, holder: f.holder})).rejects.toMatchObject({code: 'wrong-signer'})
    expect(fetchDrawnVerifierWitnesses).not.toHaveBeenCalled()
    expect(reserveApplicationPayment).not.toHaveBeenCalled()
  })

  it('reads the rule version at the canonical block when discovery did not carry it', async () => {
    const b = await issue(), f = setup({ruleCommitment: undefined, ruleVersion: undefined})
    f.client.readContract.mockResolvedValueOnce({ruleCommitment: commitment, ruleVersion: 2n})
    await expect(paidOperation(f.config, {slot, operation: f.operation, rule: {policy: b, audience: app.address}, holder: f.holder})).rejects.toMatchObject({code: 'changed-policy'})
    expect(f.client.getBlock).toHaveBeenCalled()
  })

  it('refuses a revoked action and a replayed or equivocating statement', async () => {
    const f = setup()
    const run = (policy: SlotPolicyBootstrap) => paidOperation(f.config, {slot, operation: f.operation, rule: {policy, audience: app.address}, holder: f.holder})
    await expect(run(await issue({actions: ['decrypt'], sequence: 1}))).rejects.toMatchObject({code: 'out-of-scope'})
    const newer = await issue({sequence: 5}), older = await issue({sequence: 4})
    ;(await run(newer)).dispose()
    // The same statement again is fine; an older one, or another one with the same sequence, is not.
    ;(await run(newer)).dispose()
    await expect(run(older)).rejects.toMatchObject({code: 'replayed'})
    await expect(run(await issue({sequence: 5}))).rejects.toMatchObject({code: 'equivocated'})
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(2)
  })
})

describe('paidPolicyOperation: one operation per key', () => {
  const request = (f: ReturnType<typeof setup>, policy: SlotPolicyBootstrap, over: Record<string, unknown> = {}) =>
    ({slot, operation: f.operation, policy, audience: app.address, operationKey: 'invoice-42', holder: f.holder, ...over})

  it('a lost response: the same key resumes the original operation, even with an expired bootstrap, and never reserves again', async () => {
    const f = setup(), t = Math.floor(Date.now() / 1000)
    const b = await issue({ttlSecs: 60, nowSecs: t})
    const first = await paidPolicyOperation(f.config, request(f, b))
    first.dispose()
    vi.useFakeTimers({now: (t + 3_600) * 1000, toFake: ['Date']})
    const again = await paidPolicyOperation(f.config, request(f, b))
    expect(again.requestId).toBe(first.requestId)
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
    expect(discoverPaidOperationContext).toHaveBeenCalledTimes(1)
    expect(await readPolicyOperation(f.config, {slot, audience: app.address, operationKey: 'invoice-42'})).toEqual({requestIds: [first.requestId], generation: 1})
    again.dispose()
  })

  it('an unknown session outcome: the same key continues the original session from its journal', async () => {
    const f = setup(), b = await issue()
    vi.mocked(drivePaidSession).mockRejectedValueOnce(new PaidSessionRecoveryError('wallet-x-create', 'unknown outcome'))
    const error = await paidPolicyOperation(f.config, request(f, b)).catch((e: unknown) => e) as {requestId: Hex}
    expect(error).toMatchObject({code: 'session-write-uncertain'})
    const resumed = await paidPolicyOperation(f.config, request(f, b))
    expect(resumed.requestId).toBe(error.requestId)
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
    expect(vi.mocked(drivePaidSession).mock.calls).toHaveLength(2)
    resumed.dispose()
  })

  it('an unknown keeper outcome: the same key returns the original handle, whose execution stays refused', async () => {
    const f = setup(), b = await issue()
    const op = await paidPolicyOperation(f.config, request(f, b))
    await expect(op.execute(async () => { throw new Error('keeper timeout') })).rejects.toBeDefined()
    op.dispose()
    expect(await paidOperationPhase(f.store, op.requestId)).toBe('executing')
    const again = await paidPolicyOperation(f.config, request(f, b))
    expect(again.requestId).toBe(op.requestId)
    const work = vi.fn(async () => 'x')
    await expect(again.execute(work)).rejects.toBeDefined()
    expect(work).not.toHaveBeenCalled()
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
    again.dispose()
  })

  it('refuses a key bound to another operation and a closed original', async () => {
    const f = setup(), b = await issue()
    ;(await paidPolicyOperation(f.config, request(f, b))).dispose()
    await expect(paidPolicyOperation(f.config, request(f, b, {operation: {action: 'sign', message: new TextEncoder().encode('other')}}))).rejects.toMatchObject({code: 'key-reused'})
    const id = (await readPolicyOperation(f.config, {slot, audience: app.address, operationKey: 'invoice-42'}))!.requestIds[0]!
    const key = paidRecordKey(id), record = await f.store.load<Record<string, unknown>>(key)
    await f.store.save(key, {...record, phase: 'failed', failure: {reason: 'test'}})
    await expect(paidPolicyOperation(f.config, request(f, b))).rejects.toMatchObject({code: 'closed', requestId: id})
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
  })

  it('an original that never derived a request is restarted only explicitly, with a fresh bootstrap', async () => {
    const b = await issue(), f = setup({ruleCommitment: h(66)})
    await expect(paidPolicyOperation(f.config, request(f, b))).rejects.toMatchObject({code: 'changed-policy'})
    await expect(paidPolicyOperation(f.config, request(f, b))).rejects.toMatchObject({code: 'unjournaled'})
    setup()
    const op = await paidPolicyOperation(f.config, request(f, await issue({sequence: 2}), {restartUnjournaled: true}))
    expect((await readPolicyOperation(f.config, {slot, audience: app.address, operationKey: 'invoice-42'}))).toEqual({requestIds: [op.requestId], generation: 2})
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
    op.dispose()
  })

  it('an original that derived a request but never journaled it is not restarted inside its payment window', async () => {
    const f = setup(), b = await issue()
    const stop = vi.fn(async () => { throw new Error('crash after the request id') })
    await expect(paidPolicyOperation(f.config, request(f, b, {onRequestId: stop}))).rejects.toThrow('crash')
    const [id] = (await readPolicyOperation(f.config, {slot, audience: app.address, operationKey: 'invoice-42'}))!.requestIds
    expect(await paidOperationPhase(f.store, id!)).toBeUndefined()
    await expect(paidPolicyOperation(f.config, request(f, b))).rejects.toMatchObject({code: 'unjournaled', requestId: id})
    await expect(paidPolicyOperation(f.config, request(f, b, {restartUnjournaled: true}))).rejects.toMatchObject({code: 'in-flight', requestId: id})
    vi.useFakeTimers({now: Date.now() + 700_000, toFake: ['Date']})
    const op = await paidPolicyOperation(f.config, request(f, await issue({sequence: 2, nowSecs: Math.floor(Date.now() / 1000)}), {restartUnjournaled: true}))
    expect(op.requestId).not.toBe(id)
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
    op.dispose()
  })

  it('a takeover by another process stops this call before it records or reserves anything', async () => {
    const f = setup(), b = await issue()
    const key = policyOperationKey({chainId: 43112, keyRegistry: deployment.keyRegistry, slot, audience: app.address}, 'invoice-42')
    const base = await discoverPaidOperationContext(undefined as never, undefined as never, slot)
    vi.mocked(discoverPaidOperationContext).mockImplementationOnce(async () => {
      const bound = await f.store.load<{generation: number}>(key)
      await f.store.save(key, {...bound, generation: bound!.generation + 1})
      return base
    })
    await expect(paidPolicyOperation(f.config, request(f, b))).rejects.toMatchObject({code: 'superseded'})
    expect(fetchDrawnVerifierWitnesses).not.toHaveBeenCalled()
    expect(reserveApplicationPayment).not.toHaveBeenCalled()
  })

  it('refuses a second concurrent call with the same key in one process', async () => {
    const f = setup(), b = await issue()
    let release!: () => void
    vi.mocked(drivePaidSession).mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({status: 'done', phase: 'done'}) }))
    const first = paidPolicyOperation(f.config, request(f, b))
    await vi.waitFor(() => expect(drivePaidSession).toHaveBeenCalled())
    await expect(paidPolicyOperation(f.config, request(f, b))).rejects.toBeInstanceOf(PolicyOperationError)
    release()
    ;(await first).dispose()
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
  })

  it('refuses a bad bootstrap before binding the key', async () => {
    const f = setup(), b = await issue()
    await expect(paidPolicyOperation(f.config, request(f, b, {audience: otherApp.address}))).rejects.toBeInstanceOf(SlotPolicyError)
    expect(await readPolicyOperation(f.config, {slot, audience: otherApp.address, operationKey: 'invoice-42'})).toBeUndefined()
    await expect(paidPolicyOperation(f.config, request(f, b, {operationKey: 'no spaces'}))).rejects.toThrow(/Operation key/)
    expect(slotPolicyHash(b.statement)).toMatch(/^0x[0-9a-f]{64}$/)
  })
})
