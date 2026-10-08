// Orchestration boundaries of paidOperation: what is journaled before each billable step,
// which steps are never repeated, and how resume continues. Protocol crypto, RPC canonicality,
// reservation and session bodies have their own suites; here they are replaced by spies.
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {defineChain, type Address, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'

vi.mock('../../src/chain/billing.js', async original => ({...await original<typeof import('../../src/chain/billing.js')>(), requirePrepaidSlot: vi.fn()}))
vi.mock('../../src/chain/prepaid.js', async original => ({...await original<typeof import('../../src/chain/prepaid.js')>(),
  discoverPaidOperationContext: vi.fn(), readClientExecutionPolicy: vi.fn()}))
vi.mock('../../src/chain/verifierSnapshot.js', () => ({fetchDrawnVerifierWitnesses: vi.fn()}))
vi.mock('../../src/app/paid-reservation.js', async original => ({...await original<typeof import('../../src/app/paid-reservation.js')>(),
  reserveApplicationPayment: vi.fn(), reconcileApplicationPayment: vi.fn(), reconcileApplicationReservation: vi.fn()}))
vi.mock('../../src/app/paid-journal.js', async original => ({...await original<typeof import('../../src/app/paid-journal.js')>(), loadPaidReservationJournal: vi.fn()}))
vi.mock('../../src/chain/registeredPaidAgent.js', async original => ({...await original<typeof import('../../src/chain/registeredPaidAgent.js')>(), prepareRegisteredPaidSession: vi.fn()}))
vi.mock('../../src/app/paid-session.js', async original => ({...await original<typeof import('../../src/app/paid-session.js')>(), drivePaidSession: vi.fn()}))
vi.mock('../../src/oid4vp/verifier-agent.js', async original => ({...await original<typeof import('../../src/oid4vp/verifier-agent.js')>(), verifierAgentResult: vi.fn()}))
vi.mock('../../src/committee/execution.js', async original => ({...await original<typeof import('../../src/committee/execution.js')>(), createExecutionCertificate: vi.fn()}))
vi.mock('../../src/chain/keeperExecution.js', () => ({createKeeperExecutionApprover: vi.fn(() => vi.fn())}))
vi.mock('../../src/chain/keeperRecovery.js', async original => ({...await original<typeof import('../../src/chain/keeperRecovery.js')>(), recoverKeeperExecution: vi.fn()}))

import {paidOperation, paidOperationPhase, resumePaidOperation, reconcilePaidOperation, PaidOperationRecoveryError, type PaidOperationConfig} from '../../src/app/paid-operation.js'
import {createMemoryStore} from '../../src/app/memory-store.js'
import {BillingModeError, requirePrepaidSlot} from '../../src/chain/billing.js'
import {discoverPaidOperationContext, readClientExecutionPolicy} from '../../src/chain/prepaid.js'
import {fetchDrawnVerifierWitnesses} from '../../src/chain/verifierSnapshot.js'
import {reserveApplicationPayment, reconcileApplicationPayment, reconcileApplicationReservation, ApplicationPayerRecoveryError, type ApplicationReservationStatus} from '../../src/app/paid-reservation.js'
import {loadPaidReservationJournal} from '../../src/app/paid-journal.js'
import {prepareRegisteredPaidSession, type RegisteredPaidAgentSession} from '../../src/chain/registeredPaidAgent.js'
import {drivePaidSession} from '../../src/app/paid-session.js'
import {verifierAgentResult} from '../../src/oid4vp/verifier-agent.js'
import {createExecutionCertificate} from '../../src/committee/execution.js'
import {recoverKeeperExecution} from '../../src/chain/keeperRecovery.js'
import {ruleCommitment} from '../../src/chain/write.js'
import {prepaidRequestId} from '../../src/committee/payment.js'

const h = (n: number, len = 32): Hex => `0x${n.toString(16).padStart(2, '0').repeat(len)}`
const creator = privateKeyToAccount(h(7)), payer = privateKeyToAccount(h(8))
const slot = h(3), salt = h(4), rule = JSON.stringify({credentials: [{id: 'a', format: 'dc+sd-jwt', claims: [{path: ['iss'], values: ['did:web:issuer.example']}]}]})
const chainDef = defineChain({id: 43112, name: 'local', nativeCurrency: {name: 'AVAX', symbol: 'AVAX', decimals: 18}, rpcUrls: {default: {http: ['http://localhost:1']}}})
const deployment = {chainId: 43112, settlement: h(1, 20), keyRegistry: h(2, 20), verifierSet: h(5, 20), accountantSet: h(6, 20), beacon: h(9, 20)}
const coordinator = {operator: h(11, 20), publicKey: h(12), url: 'http://127.0.0.1:4001'}
const witnesses = [{index: 0, operator: h(13, 20), publicKey: h(14), proof: []}]

function setup(change: {creator?: Address; ruleCommitment?: Hex; reorg?: boolean} = {}) {
  const store = createMemoryStore()
  const client = {
    readContract: vi.fn(async () => ({ruleCommitment: change.ruleCommitment ?? ruleCommitment(salt, rule)})),
    getBlock: vi.fn(async () => ({hash: change.reorg ? h(99) : h(20)})),
  }
  const config: PaidOperationConfig = {
    chain: {client, addresses: {ServiceRegistry: h(30, 20)}} as unknown as PaidOperationConfig['chain'],
    deployment, creator, store, accountantUrls: ['http://127.0.0.1:9000'], allowLocalHttp: true,
    gasPayer: {account: payer, chain: chainDef} as unknown as PaidOperationConfig['gasPayer'],
    agent: {profile: {endpoint: 'https://agent.example', clientId: 'decentralized_identifier:did:web:agent.example',
      approval: {chainId: 43112, registry: h(30, 20), serviceId: h(31), owner: h(32, 20), revision: 1n, manifestHash: h(33), serviceType: 1}},
    transport: {} as PaidOperationConfig['agent']['transport']},
    limits: {maxCost: 100n, maxGas: 500_000n, maxGasPrice: 10n ** 11n}, pollIntervalMs: 10,
  }
  vi.mocked(discoverPaidOperationContext).mockResolvedValue({blockNumber: 20n, blockHash: h(20), blockTimestamp: 1n, creator: change.creator ?? creator.address,
    mode: 0, groupPublicKey: h(40), coordinator, contributors: [coordinator], available: 100n,
    intentFields: {chain_id: 43112, settlement: deployment.settlement, key_registry: deployment.keyRegistry, slot, verification_epoch: 7, verification_seed: h(41),
      verification_root: h(42), verification_registry_size: 3, verification_committee: 1, verification_quorum: 1,
      keeper_assignment: {key_epoch: 1, committee_version: 1, threshold: 1, coordinator: Array<number>(32).fill(12), contributors: [Array<number>(32).fill(12)]}}})
  vi.mocked(fetchDrawnVerifierWitnesses).mockResolvedValue({witnesses, artifact: {}, host: 'http://127.0.0.1:9000'})
  vi.mocked(reserveApplicationPayment).mockResolvedValue({transactionHash: h(50)} as Awaited<ReturnType<typeof reserveApplicationPayment>>)
  vi.mocked(readClientExecutionPolicy).mockResolvedValue({policy: {}} as Awaited<ReturnType<typeof readClientExecutionPolicy>>)
  vi.mocked(createExecutionCertificate).mockImplementation(async ({publicKey, expires}) => ({execution_key: `0x${Buffer.from(publicKey).toString('hex')}`, expires, creator_signature: h(51, 65)}))
  vi.mocked(prepareRegisteredPaidSession).mockResolvedValue({sessionId: 'ab'.repeat(32)} as RegisteredPaidAgentSession)
  vi.mocked(drivePaidSession).mockResolvedValue({status: 'done', phase: 'done'} as Awaited<ReturnType<typeof drivePaidSession>>)
  vi.mocked(verifierAgentResult).mockReturnValue({token: {binding: 'holder_key'} as never, verifierProofs: [{verifierIndex: 0, operator: '13'.repeat(20), pubkey: '14'.repeat(32), proof: []}]})
  const holder = {kind: 'local' as const, makePresentation: vi.fn(), submit: vi.fn()}
  const request = {slot, operation: {action: 'sign' as const, message: new TextEncoder().encode('hello')}, rule: {rule, salt}, holder}
  return {store, client, config, request, holder}
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requirePrepaidSlot).mockResolvedValue({slot, mode: 'prepaid'})
  vi.mocked(loadPaidReservationJournal).mockResolvedValue(undefined)
  reservation('none')
})
const observedAt = {blockNumber: 20n, blockHash: h(20), blockTimestamp: 1n}
function reservation(state: ApplicationReservationStatus['state'], payerLocked = false, once = false) {
  const value: ApplicationReservationStatus = {state, payerLocked, requestId: h(0), observedAt, ...(state === 'uncertain' || state === 'not-reserved' ? {reason: 'test ' + state} : {})}
  if (once) vi.mocked(reconcileApplicationReservation).mockResolvedValueOnce(value)
  else vi.mocked(reconcileApplicationReservation).mockResolvedValue(value)
}

describe('paidOperation', () => {
  it('reserves once, certifies, drives the session and executes exactly once', async () => {
    const f = setup()
    const op = await paidOperation(f.config, f.request)
    expect(op.requestId).toBe(prepaidRequestId(op.payment))
    expect(op.payment.max_cost).toBe('100')
    expect(op.payment.slot).toBe(slot)
    expect(op.coordinatorUrl).toBe(coordinator.url)
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
    expect(vi.mocked(reserveApplicationPayment).mock.calls[0]![1]).toBe(f.config.gasPayer)
    expect(vi.mocked(reserveApplicationPayment).mock.calls[0]![5].store).toBe(f.store)
    expect(createExecutionCertificate).toHaveBeenCalledTimes(1)
    expect(vi.mocked(drivePaidSession).mock.calls[0]![0]).toMatchObject({resume: true, members: witnesses})
    expect(await paidOperationPhase(f.store, op.requestId)).toBe('authorized')
    const work = vi.fn(async () => 'signature')
    expect(await op.execute(work)).toBe('signature')
    expect(await paidOperationPhase(f.store, op.requestId)).toBe('executed')
    await expect(op.execute(work)).rejects.toBeInstanceOf(PaidOperationRecoveryError)
    expect(work).toHaveBeenCalledTimes(1)
    op.dispose()
  })

  it('refuses a legacy or unknown slot before any discovery, signature or reservation', async () => {
    const f = setup()
    vi.mocked(requirePrepaidSlot).mockRejectedValue(new BillingModeError({slot, mode: 'legacy', settlementVersion: '1'}))
    await expect(paidOperation(f.config, f.request)).rejects.toMatchObject({name: 'BillingModeError', mode: 'legacy'})
    const detector = {mode: vi.fn(), invalidate: vi.fn(), requirePrepaid: vi.fn(async () => { throw new BillingModeError({slot, mode: 'unknown', reason: 'rpc'}) })}
    await expect(paidOperation({...f.config, billing: detector}, f.request)).rejects.toMatchObject({mode: 'unknown'})
    expect(discoverPaidOperationContext).not.toHaveBeenCalled()
    expect(reserveApplicationPayment).not.toHaveBeenCalled()
  })

  it('refuses a different creator, a different rule or a reorganized rule read before reserving', async () => {
    for (const change of [{creator: h(77, 20)}, {ruleCommitment: h(78)}, {reorg: true}]) {
      const f = setup(change)
      await expect(paidOperation(f.config, f.request)).rejects.toThrow(/creator|rule|reorganized/)
    }
    expect(fetchDrawnVerifierWitnesses).not.toHaveBeenCalled()
    expect(reserveApplicationPayment).not.toHaveBeenCalled()
  })

  it('refuses invalid limits and a gas payer on another chain', async () => {
    const f = setup()
    await expect(paidOperation({...f.config, limits: {...f.config.limits, maxCost: 0n}}, f.request)).rejects.toThrow(/TASRA limit/)
    await expect(paidOperation({...f.config, gasPayer: {account: payer, chain: {...chainDef, id: 1}} as unknown as PaidOperationConfig['gasPayer']}, f.request)).rejects.toThrow(/another chain/)
    await expect(paidOperation({...f.config, accountantUrls: []}, f.request)).rejects.toThrow(/accountant/)
  })

  it('keeps an uncertain reservation locked and resumes by on-chain reconciliation, never a second reservation', async () => {
    const f = setup()
    vi.mocked(reserveApplicationPayment).mockRejectedValueOnce(new Error('receipt timeout'))
    const error = await paidOperation(f.config, f.request).catch((e: unknown) => e) as PaidOperationRecoveryError
    expect(error).toBeInstanceOf(PaidOperationRecoveryError)
    expect(error.phase).toBe('reservation')
    expect(await paidOperationPhase(f.store, error.requestId)).toBe('reserving')
    vi.mocked(loadPaidReservationJournal).mockResolvedValue({phase: 'submitted', transactionHash: h(60)} as Awaited<ReturnType<typeof loadPaidReservationJournal>>)
    reservation('uncertain', true)
    vi.mocked(reconcileApplicationPayment).mockResolvedValue({status: 'success'} as Awaited<ReturnType<typeof reconcileApplicationPayment>>)
    const op = await resumePaidOperation(f.config, error.requestId, {holder: f.holder})
    expect(reconcileApplicationReservation).toHaveBeenCalledWith(f.client, f.store, expect.objectContaining({settlement: deployment.settlement}), op.payment,
      expect.anything(), {payer: payer.address, confirmations: undefined})
    expect(reconcileApplicationPayment).toHaveBeenCalledWith(f.client, f.store, expect.objectContaining({settlement: deployment.settlement}), error.requestId, expect.anything(), h(60), undefined)
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
    expect(op.requestId).toBe(error.requestId)
    // Resuming an authorized operation returns the same grant without new work.
    await resumePaidOperation(f.config, error.requestId)
    expect(drivePaidSession).toHaveBeenCalledTimes(1)
    expect(createExecutionCertificate).toHaveBeenCalledTimes(1)
  })

  it('needs a located transaction hash to reconcile a hashless reservation, and refuses a reverted one', async () => {
    const f = setup()
    vi.mocked(reserveApplicationPayment).mockRejectedValueOnce(new Error('lost before hash'))
    const {requestId} = await paidOperation(f.config, f.request).catch((e: unknown) => e) as PaidOperationRecoveryError
    vi.mocked(loadPaidReservationJournal).mockResolvedValue({phase: 'prepared'} as Awaited<ReturnType<typeof loadPaidReservationJournal>>)
    reservation('uncertain', true)
    await expect(resumePaidOperation(f.config, requestId, {holder: f.holder})).rejects.toMatchObject({phase: 'reservation'})
    expect(reconcileApplicationPayment).not.toHaveBeenCalled()
    vi.mocked(reconcileApplicationPayment).mockResolvedValue({status: 'reverted'} as Awaited<ReturnType<typeof reconcileApplicationPayment>>)
    const reverted = await resumePaidOperation(f.config, requestId, {holder: f.holder, transactionHash: h(61)}).catch((e: unknown) => e) as PaidOperationRecoveryError
    expect(reverted).toMatchObject({phase: 'reservation', cause: {message: /reverted/}})
    expect(await paidOperationPhase(f.store, requestId)).toBe('failed')
    await expect(resumePaidOperation(f.config, requestId, {holder: f.holder})).rejects.toMatchObject({phase: 'reservation'})
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
  })

  it('passes a payer held by another request through without claiming uncertainty for this one', async () => {
    const f = setup()
    vi.mocked(reserveApplicationPayment).mockRejectedValueOnce(new ApplicationPayerRecoveryError(h(70)))
    const error = await paidOperation(f.config, f.request).catch((e: unknown) => e) as ApplicationPayerRecoveryError
    expect(error).toBeInstanceOf(ApplicationPayerRecoveryError)
    expect(error.requestId).toBe(h(70))
  })

  it('resumes an interrupted session with the original certificate, signer and owner secret', async () => {
    const f = setup()
    vi.mocked(drivePaidSession).mockRejectedValueOnce(new Error('lost approval reply'))
    const error = await paidOperation(f.config, f.request).catch((e: unknown) => e) as PaidOperationRecoveryError
    expect(error.phase).toBe('session')
    expect(await paidOperationPhase(f.store, error.requestId)).toBe('certified')
    await expect(resumePaidOperation(f.config, error.requestId)).rejects.toThrow(/holder strategy/)
    await resumePaidOperation(f.config, error.requestId, {holder: f.holder})
    const [first, second] = vi.mocked(prepareRegisteredPaidSession).mock.calls
    expect(second![2]).toEqual(first![2])
    expect(second![3].certificate).toEqual(first![3].certificate)
    expect(second![3].pollSecret).toBe(first![3].pollSecret)
    expect(Buffer.from(second![3].signer.publicKey)).toEqual(Buffer.from(first![3].signer.publicKey))
    expect(createExecutionCertificate).toHaveBeenCalledTimes(1)
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
  })

  it('journals an uncertain execution, never re-runs it, and recovers the retained keeper result', async () => {
    const f = setup()
    const op = await paidOperation(f.config, f.request)
    const work = vi.fn(async () => { throw new Error('keeper reply lost') })
    await expect(op.execute(work)).rejects.toMatchObject({phase: 'execution'})
    expect(await paidOperationPhase(f.store, op.requestId)).toBe('executing')
    const resumed = await resumePaidOperation(f.config, op.requestId)
    await expect(resumed.execute(work)).rejects.toBeInstanceOf(PaidOperationRecoveryError)
    expect(work).toHaveBeenCalledTimes(1)
    vi.mocked(recoverKeeperExecution).mockResolvedValue({resultJson: '{}'} as Awaited<ReturnType<typeof recoverKeeperExecution>>)
    const transport = {keeperRecoveryRequest: vi.fn()}
    await resumed.recover({transport})
    expect(vi.mocked(recoverKeeperExecution).mock.calls[0]![0]).toMatchObject({keeper: coordinator, transport, payment: op.payment,
      target: {stage: 'coordinator'}})
  })
})

describe('createMemoryStore', () => {
  it('detaches saved values and serializes work per key', async () => {
    const store = createMemoryStore(), value = {n: 1n, bytes: new Uint8Array([1])}
    await store.save('k', value); value.bytes[0] = 9
    expect(await store.load('k')).toEqual({n: 1n, bytes: new Uint8Array([1])})
    expect(await store.load('missing')).toBeUndefined()
    await expect(store.save('../escape', 1)).rejects.toThrow(/key/)
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const a = store.withLock('k', async () => { order.push('a-start'); await gate; order.push('a-end') })
    const b = store.withLock('k', async () => { order.push('b') })
    const other = store.withLock('other', async () => { order.push('other') })
    await other; release(); await Promise.all([a, b])
    expect(order).toEqual(['a-start', 'other', 'a-end', 'b'])
  })
})

describe('paidOperation edges', () => {
  it('waits for the current snapshots to be anchored, then maps a FROST sign on an EOA slot to eoa-sign', async () => {
    const f = setup()
    const resolved = await discoverPaidOperationContext(undefined as never, undefined as never, slot)
    vi.mocked(discoverPaidOperationContext).mockReset()
      .mockRejectedValueOnce(new Error('no anchored verifier and accountant snapshots'))
      .mockResolvedValue({...resolved, mode: 2})
    const op = await paidOperation(f.config, f.request)
    expect(discoverPaidOperationContext).toHaveBeenCalledTimes(2)
    expect(op.payment.action).toBe('eoa-sign')
  })

  it('refuses invalid inputs before reading the chain', async () => {
    const f = setup()
    await expect(paidOperation(f.config, {...f.request, slot: '0x01'})).rejects.toThrow(/slot/)
    await expect(paidOperation({...f.config, snapshotWaitMs: 0}, f.request)).rejects.toThrow(/timing/)
    await expect(paidOperation({...f.config, deployment: {...deployment, beacon: h(0, 20)}}, f.request)).rejects.toThrow(/approved/)
    await expect(paidOperation({...f.config, chain: {...f.config.chain, addresses: {}} as PaidOperationConfig['chain']}, f.request)).rejects.toThrow(/ServiceRegistry/)
    await expect(paidOperation(f.config, {...f.request, operation: {...f.request.operation, ttlSecs: 4000}})).rejects.toThrow(/lifetime/)
    expect(reserveApplicationPayment).not.toHaveBeenCalled()
  })

  it('resumes a request that never prepared a reservation by reserving it once, or a confirmed one without reserving', async () => {
    const f = setup()
    vi.mocked(reserveApplicationPayment).mockRejectedValueOnce(new ApplicationPayerRecoveryError(h(70)))
    vi.mocked(loadPaidReservationJournal).mockResolvedValueOnce(undefined)
    await expect(paidOperation(f.config, f.request)).rejects.toBeInstanceOf(ApplicationPayerRecoveryError)
    reservation('none')
    const requestId = prepaidRequestId(vi.mocked(reserveApplicationPayment).mock.calls[0]![3])
    expect(await paidOperationPhase(f.store, requestId)).toBe('reserving')
    await resumePaidOperation(f.config, requestId, {holder: f.holder})
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(2)

    const g = setup()
    vi.mocked(reserveApplicationPayment).mockRejectedValueOnce(new Error('crash after confirmation'))
    const error = await paidOperation(g.config, g.request).catch((e: unknown) => e) as PaidOperationRecoveryError
    reservation('reserved')
    await resumePaidOperation(g.config, error.requestId, {holder: g.holder})
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(3)
    expect(reconcileApplicationPayment).not.toHaveBeenCalled()
  })

  it('refuses to resume an unknown request', async () => {
    const f = setup()
    await expect(resumePaidOperation(f.config, h(90))).rejects.toThrow(/No paid operation journal/)
    await expect(resumePaidOperation(f.config, '0x12' as Hex)).rejects.toThrow(/request ID/)
    expect(await paidOperationPhase(f.store, h(90))).toBeUndefined()
  })

  it('wraps a refused grant as a session failure and keeps cancellation as cancellation', async () => {
    const f = setup()
    vi.mocked(verifierAgentResult).mockReturnValueOnce({token: {} as never, verifierProofs: []})
    await expect(paidOperation(f.config, f.request)).rejects.toThrow(/anchored verifier proofs/)
    const g = setup(), controller = new AbortController()
    vi.mocked(drivePaidSession).mockImplementationOnce(async () => { controller.abort(new Error('user cancelled')); throw new Error('aborted') })
    await expect(paidOperation(g.config, {...g.request, signal: controller.signal})).rejects.toThrow('aborted')
  })
})

describe('paid operation reservation safety', () => {
  async function stuck() {
    const f = setup()
    vi.mocked(reserveApplicationPayment).mockRejectedValueOnce(new Error('process died after broadcast'))
    const error = await paidOperation(f.config, f.request).catch((e: unknown) => e) as PaidOperationRecoveryError
    expect(await paidOperationPhase(f.store, error.requestId)).toBe('reserving')
    return {...f, requestId: error.requestId}
  }

  it('never reserves again while the original reservation is unprovable; the payer stays locked', async () => {
    const f = await stuck()
    reservation('uncertain', true)
    const error = await resumePaidOperation(f.config, f.requestId, {holder: f.holder}).catch((e: unknown) => e) as PaidOperationRecoveryError
    expect(error).toBeInstanceOf(PaidOperationRecoveryError)
    expect(error.phase).toBe('reservation')
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
    expect(await paidOperationPhase(f.store, f.requestId)).toBe('reserving')
    expect(await reconcilePaidOperation(f.config, f.requestId)).toMatchObject({phase: 'reserving', reservation: 'uncertain', payerLocked: true, next: 'wait', reason: 'test uncertain'})
    // A failed observation is uncertainty too, never permission to reserve.
    vi.mocked(reconcileApplicationReservation).mockRejectedValueOnce(new Error('rpc down'))
    await expect(resumePaidOperation(f.config, f.requestId, {holder: f.holder})).rejects.toMatchObject({phase: 'reservation', cause: {message: 'rpc down'}})
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
  })

  it('reconcileOnly never reserves, drives a session or executes', async () => {
    const f = await stuck()
    reservation('none')
    const status = await resumePaidOperation(f.config, f.requestId, {reconcileOnly: true, holder: f.holder})
    expect(status).toMatchObject({requestId: f.requestId, phase: 'reserving', reservation: 'none', payerLocked: false, next: 'reserve'})
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
    reservation('reserved')
    expect(await resumePaidOperation(f.config, f.requestId, {reconcileOnly: true, holder: f.holder})).toMatchObject({phase: 'reserved', reservation: 'reserved', next: 'resume'})
    expect(await paidOperationPhase(f.store, f.requestId)).toBe('reserved')
    expect(createExecutionCertificate).not.toHaveBeenCalled()
    expect(prepareRegisteredPaidSession).not.toHaveBeenCalled()
    expect(drivePaidSession).not.toHaveBeenCalled()
    // Past reserving, reconciliation only reports the journal.
    expect(await reconcilePaidOperation(f.config, f.requestId)).toMatchObject({phase: 'reserved', reservation: 'reserved', next: 'resume'})
    expect(reconcileApplicationReservation).toHaveBeenCalledTimes(2)
    await expect(reconcilePaidOperation(f.config, h(90))).rejects.toThrow(/No paid operation journal/)
  })

  it('marks a provably unreserved operation failed, terminal for resume and reconcile', async () => {
    const f = await stuck()
    reservation('not-reserved')
    expect(await reconcilePaidOperation(f.config, f.requestId)).toMatchObject({phase: 'failed', reservation: 'not-reserved', next: 'abandon', reason: 'test not-reserved'})
    expect(await reconcilePaidOperation(f.config, f.requestId)).toMatchObject({phase: 'failed', reservation: 'not-reserved', next: 'abandon', reason: 'test not-reserved'})
    await expect(resumePaidOperation(f.config, f.requestId, {holder: f.holder})).rejects.toMatchObject({phase: 'reservation'})
    reservation('none')
    await expect(resumePaidOperation(f.config, f.requestId, {holder: f.holder})).rejects.toMatchObject({phase: 'reservation'})
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
  })

  it('reports later phases: executing needs recover, executed is done', async () => {
    const f = setup()
    const op = await paidOperation(f.config, f.request)
    await op.execute(async () => { throw new Error('lost') }).catch(() => {})
    expect(await reconcilePaidOperation(f.config, op.requestId)).toMatchObject({phase: 'executing', next: 'recover', payerLocked: false})
    const g = setup(), done = await paidOperation(g.config, g.request)
    await done.execute(async () => 1)
    expect(await reconcilePaidOperation(g.config, done.requestId)).toMatchObject({phase: 'executed', next: 'done'})
  })
})
