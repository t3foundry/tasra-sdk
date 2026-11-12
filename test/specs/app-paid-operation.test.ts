// Orchestration boundaries of paidOperation: what is journaled before each billable step,
// which steps are never repeated, and how resume continues. Protocol crypto, RPC canonicality,
// reservation and session bodies have their own suites; here they are replaced by spies.
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {defineChain, hexToBytes, keccak256, toHex, type Address, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {ed25519} from '@noble/curves/ed25519'
import {readFileSync} from 'node:fs'
import {sha256} from '@noble/hashes/sha256'
import {createDecryptionRecipient, decryptionBinding} from '../../src/crypto/recipient.js'
import {requestHash} from '../../src/oid4vp/binding.js'
import {sealIbeFixture} from '../support/sealedIbe.js'

const ibeVector = JSON.parse(readFileSync(new URL('../ibe-vectors.json', import.meta.url), 'utf8')) as {
  identity: string; shares: {identifier: number; d_i: string}[]; verifying_shares: {identifier: number; g2: string; g1: string}[]
}
const ibeRecipient = await createDecryptionRecipient()
const ibeBinding = decryptionBinding(sha256(new TextEncoder().encode(ibeVector.identity)), 1, ibeRecipient)
const ibePublic = new Map(ibeVector.verifying_shares.map(s => [s.identifier, hexToBytes(('0x' + s.g2.replace(/^0x/, '') + s.g1.replace(/^0x/, '')) as Hex)]))
const ibeRecovery = {recipient: ibeRecipient, identity: ibeVector.identity, verifyingShares: ibePublic}

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
vi.mock('../../src/app/paid-allowance.js', async original => ({...await original<typeof import('../../src/app/paid-allowance.js')>(),
  selectAllowanceLane: vi.fn(async () => undefined), obtainAllowanceVoucher: vi.fn()}))
vi.mock('../../src/chain/keeperRecovery.js', async original => ({...await original<typeof import('../../src/chain/keeperRecovery.js')>(), recoverKeeperExecution: vi.fn()}))

import {paidOperation, paidFinalSign, resumePaidFinalSign, paidSessionDecrypt, resumePaidSessionDecrypt, paidOperationPhase, resumePaidOperation, reconcilePaidOperation, listPaidOperations, abandonPaidOperation, recoverPaidOperation,
  PaidOperationRecoveryError, PaidOperationAbandonRefusedError, NewerVerifierEpoch, type PaidOperationConfig} from '../../src/app/paid-operation.js'
import {createMemoryStore} from '../../src/app/memory-store.js'
import {paidRecordKey} from '../../src/app/paid-keys.js'
import {createFileStore} from '../../src/app/node.js'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {BillingModeError, requirePrepaidSlot} from '../../src/chain/billing.js'
import {discoverPaidOperationContext, drawnIntentFields, PaidDrawMovedError, readClientExecutionPolicy, readCurrentBeaconEpoch, type PaidOperationContext,
  type UndrawnPaidOperationContext} from '../../src/chain/prepaid.js'
import {fetchDrawnVerifierWitnesses} from '../../src/chain/verifierSnapshot.js'
import {reserveApplicationPayment, reconcileApplicationPayment, reconcileApplicationReservation, selectApplicationGasPayer, ApplicationPayerRecoveryError,
  type ApplicationReservationStatus} from '../../src/app/paid-reservation.js'
import type {ApplicationStore} from '../../src/app/ready-slot.js'
import {loadPaidReservationJournal} from '../../src/app/paid-journal.js'
import {prepareRegisteredPaidSession, type RegisteredPaidAgentSession} from '../../src/chain/registeredPaidAgent.js'
import {drivePaidSession, PaidSessionRecoveryError} from '../../src/app/paid-session.js'
import {PaidAgentControlError} from '../../src/chain/registeredPaidAgent.js'
import {VerifierAgentSessionError} from '../../src/verifier-agent/index.js'
import {RevocationStatusPreflightError, StatusRefreshError, UnderfundedSlotError} from '../../src/errors.js'
import {assembleCompoundToken, compoundTokenHash, decodeCompoundToken, selectVerifierCommittee, statusAttestationHash, type CompoundTokenPayload,
  type CompoundTokenWire} from '../../src/committee/token.js'
import {statusRefreshHash, statusRefreshHolderSigner} from '../../src/committee/status-refresh.js'
import {decodeJson, p256HolderKey, verifyCompactJws, type Jwk} from '../../src/oid4vp/jose.js'
import {PaidReservationAbortedError, PaidReservationStaleEpochError, PaidReservationUncertainError} from '../../src/chain/reservation.js'
import {verifierAgentResult} from '../../src/oid4vp/verifier-agent.js'
import {createExecutionCertificate} from '../../src/committee/execution.js'
import {recoverKeeperExecution} from '../../src/chain/keeperRecovery.js'
import {ruleCommitment} from '../../src/chain/write.js'
import {paymentIntentHash, paymentIntentTypedData, prepaidRequestId} from '../../src/committee/payment.js'
import {selectAllowanceLane, obtainAllowanceVoucher, AllowanceRefusedError, AllowanceUnavailableError} from '../../src/app/paid-allowance.js'
import {recoverTypedDataAddress} from 'viem'
import {createSessionKey, sessionGrantCreateFragment} from '../../src/app/session-grants.js'

const h = (n: number, len = 32): Hex => `0x${n.toString(16).padStart(2, '0').repeat(len)}`
const creator = privateKeyToAccount(h(7)), payer = privateKeyToAccount(h(8))
const slot = h(3), salt = h(4), rule = JSON.stringify({credentials: [{id: 'a', format: 'dc+sd-jwt', claims: [{path: ['iss'], values: ['did:web:issuer.example']}]}]})
const chainDef = defineChain({id: 43112, name: 'local', nativeCurrency: {name: 'AVAX', symbol: 'AVAX', decimals: 18}, rpcUrls: {default: {http: ['http://localhost:1']}}})
const deployment = {chainId: 43112, settlement: h(1, 20), keyRegistry: h(2, 20), verifierSet: h(5, 20), accountantSet: h(6, 20), beacon: h(9, 20)}
const coordinator = {operator: h(11, 20), publicKey: h(12), url: 'http://127.0.0.1:4001'}
// One drawn verifier (committee 1, quorum 1) with a real key: execute() re-checks the journaled
// grant's revocation-status attestations against these anchored witnesses before any send.
const verifierSeed = new Uint8Array(32).fill(15)
const drawnIndex = selectVerifierCommittee(hexToBytes(slot), 7, hexToBytes(h(41)), 3, 1)[0]!
const witnesses = [{index: drawnIndex, operator: h(13, 20), publicKey: toHex(ed25519.getPublicKey(verifierSeed)), proof: []}]
/** Status attestation mode of the grant the mocked agent result returns. */
type StatusMode = 'fresh' | 'stale' | 'missing' | 'forged'
let statusMode: StatusMode = 'fresh'
function grantToken(expected: {requestHash: Uint8Array; paymentHash?: string}, mode: StatusMode) {
  const now = Math.floor(Date.now() / 1000)
  const payload: CompoundTokenPayload = {tokenType: 'JWT', seed: hexToBytes(h(41)), epoch: 7, slotId: hexToBytes(slot), vpHash: hexToBytes(h(43)),
    holderHash: hexToBytes(h(44)), ruleHash: hexToBytes(h(45)), requestHash: expected.requestHash, paymentHash: hexToBytes(expected.paymentHash as Hex),
    binding: 1, verifierIndexes: [drawnIndex], iat: now, exp: now + 600}
  const hash = compoundTokenHash(payload), until = mode === 'stale' ? now - 60 : now + 30
  const attestation = {verifierIndex: drawnIndex, statusUntil: until, signature: ed25519.sign(statusAttestationHash(hash, drawnIndex, until), verifierSeed)}
  if (mode === 'forged') attestation.statusUntil = now + 3_600
  return assembleCompoundToken(payload, [{verifierIndex: drawnIndex, signature: ed25519.sign(hash, verifierSeed)}], mode === 'missing' ? undefined : [attestation])
}

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
  statusMode = 'fresh'
  vi.mocked(verifierAgentResult).mockImplementation(expected => ({token: grantToken(expected, statusMode),
    verifierProofs: [{verifierIndex: drawnIndex, operator: '13'.repeat(20), pubkey: witnesses[0]!.publicKey.slice(2), proof: []}]}))
  const holder = {kind: 'local' as const, makePresentation: vi.fn(), submit: vi.fn()}
  const request = {slot, operation: {action: 'sign' as const, message: new TextEncoder().encode('hello')}, rule: {rule, salt}, holder}
  return {store, client, config, request, holder}
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requirePrepaidSlot).mockResolvedValue({slot, mode: 'prepaid'})
  vi.mocked(loadPaidReservationJournal).mockResolvedValue(undefined)
  // The beacon at the payment's own epoch: no reservation waited past it.
  vi.mocked(readCurrentBeaconEpoch).mockReset().mockResolvedValue(7n)
  reservation('none')
})
const observedAt = {blockNumber: 20n, blockHash: h(20), blockTimestamp: 1n}
function reservation(state: ApplicationReservationStatus['state'], payerLocked = false, once = false) {
  const value: ApplicationReservationStatus = {state, payerLocked, requestId: h(0), observedAt, ...(state === 'uncertain' || state === 'not-reserved' ? {reason: 'test ' + state} : {})}
  if (once) vi.mocked(reconcileApplicationReservation).mockResolvedValueOnce(value)
  else vi.mocked(reconcileApplicationReservation).mockResolvedValue(value)
}

describe('paidOperation', () => {
  it('checks the rule against the commitment discovery read at its canonical block, without a second slot read', async () => {
    const f = setup()
    const base = await discoverPaidOperationContext(undefined as never, undefined as never, slot)
    vi.mocked(discoverPaidOperationContext).mockResolvedValueOnce({...base, ruleCommitment: ruleCommitment(salt, rule)})
    await paidOperation(f.config, f.request)
    expect(f.client.readContract).not.toHaveBeenCalled()
    expect(f.client.getBlock).not.toHaveBeenCalled()
    vi.mocked(discoverPaidOperationContext).mockResolvedValueOnce({...base, ruleCommitment: h(66)})
    await expect(paidOperation(f.config, f.request)).rejects.toThrow('differs from the slot commitment')
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
  })

  it('preserves supplied rule bytes for the verifier token hash across journal and resume', async () => {
    const f = setup()
    const raw = JSON.stringify(JSON.parse(rule), null, 2) + '\n'
    expect(ruleCommitment(salt, raw)).toBe(ruleCommitment(salt, rule))
    f.request.rule.rule = raw
    const op = await paidOperation(f.config, f.request)
    expect(vi.mocked(prepareRegisteredPaidSession).mock.calls[0]![1].ruleHash).toBe(keccak256(toHex(raw)))
    expect(await f.store.load(`paid-op-${op.requestId.slice(2)}`)).toMatchObject({rule: raw})
    op.dispose()
    const resumed = await resumePaidOperation(f.config, op.requestId, {holder: f.holder})
    expect(vi.mocked(prepareRegisteredPaidSession).mock.calls.at(-1)![1].ruleHash).toBe(keccak256(toHex(raw)))
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
    resumed.dispose()
  })

  it('reserves once, certifies, drives the session and executes exactly once', async () => {
    const f = setup()
    const op = await paidOperation(f.config, f.request)
    expect(op.requestId).toBe(prepaidRequestId(op.payment))
    expect(op.payment.max_cost).toBe('100')
    expect(op.payment.slot).toBe(slot)
    expect(vi.mocked(fetchDrawnVerifierWitnesses).mock.calls[0]?.[3]?.waitForPublicationMs).toBe(150_000)
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

  it('refuses a legacy or unknown slot before any signature or reservation; a cached detector refuses before discovery', async () => {
    const f = setup()
    // Without a detector the billing check is discovery's own (same block-pinned round): no separate observation.
    vi.mocked(discoverPaidOperationContext).mockRejectedValueOnce(new BillingModeError({slot, mode: 'legacy', settlementVersion: '1'}))
    await expect(paidOperation(f.config, f.request)).rejects.toMatchObject({name: 'BillingModeError', mode: 'legacy'})
    expect(requirePrepaidSlot).not.toHaveBeenCalled()
    expect(fetchDrawnVerifierWitnesses).not.toHaveBeenCalled()
    vi.mocked(discoverPaidOperationContext).mockClear()
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

  it('retains the original application payment through unknown creation and a failed recovery read', async () => {
    const f = setup(), sessionId = 'ab'.repeat(32)
    // Compose the real session driver and application error classification.
    // Protocol/provider verification remains the session's responsibility and
    // is exercised with genuine signatures in chain.registered-paid-agent.
    const actual = await vi.importActual<typeof import('../../src/app/paid-session.js')>('../../src/app/paid-session.js')
    vi.mocked(drivePaidSession).mockImplementation(actual.drivePaidSession)
    const create = vi.fn(async () => {throw new Error('lost original creation reply')})
    const reconcile = vi.fn(async () => ({status: 'pending' as const}))
      .mockRejectedValueOnce(new PaidAgentControlError(sessionId, 404))
    const requestObject = vi.fn(async () => {throw new Error('stopped after verified creation read')})
    vi.mocked(prepareRegisteredPaidSession).mockImplementation(async (_chain, _config, params) => ({
      sessionId, paymentHash: paymentIntentHash(params.payment), initialization: {expires: params.operation.exp},
      create, reconcile, requestObject,
    } as unknown as RegisteredPaidAgentSession))
    const error = await paidOperation(f.config, f.request).catch((e: unknown) => e) as PaidOperationRecoveryError
    expect(error).toMatchObject({phase: 'session', code: 'session-interrupted', resumable: true})
    const original = await f.store.load('wallet-' + sessionId + '-create')
    expect(original).toMatchObject({phase: 'prepared'})
    // A 404 on a recovery GET cannot prove the original POST was refused:
    // applications must retain the pending payment rather than pay again.
    await expect(resumePaidOperation(f.config, error.requestId, {holder: f.holder})).rejects.toMatchObject({
      requestId: error.requestId, code: 'session-interrupted', resumable: true,
      cause: expect.objectContaining({cause: expect.objectContaining({httpStatus: 404})}),
    })
    expect(await f.store.load('wallet-' + sessionId + '-create')).toEqual(original)
    expect(await paidOperationPhase(f.store, error.requestId)).toBe('certified')
    await expect(resumePaidOperation(f.config, error.requestId, {holder: f.holder})).rejects.toMatchObject({
      requestId: error.requestId, code: 'session-interrupted', resumable: true,
      cause: expect.objectContaining({message: 'stopped after verified creation read'}),
    })
    expect(await f.store.load('wallet-' + sessionId + '-create')).toEqual({...original as object, phase: 'confirmed'})
    expect(create).toHaveBeenCalledTimes(1)
    expect(reconcile).toHaveBeenCalledTimes(2)
    expect(requestObject).toHaveBeenCalledTimes(1)
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
    expect(createExecutionCertificate).toHaveBeenCalledTimes(1)
    expect(f.holder.submit).not.toHaveBeenCalled()
  })

  // D5 class: a store may hand back the journaled seed as a Buffer view over memory it reuses; the
  // resumed signer must own its secret, or the store's reuse zeroes it under the certified key.
  it('resumes with an execution signer that survives the store wiping the Buffer view it returned', async () => {
    const f = setup()
    vi.mocked(drivePaidSession).mockRejectedValueOnce(new Error('lost approval reply'))
    const error = await paidOperation(f.config, f.request).catch((e: unknown) => e) as PaidOperationRecoveryError
    const pools: Buffer[] = [], load = f.store.load.bind(f.store)
    f.store.load = (async (key: string) => {
      const value = await load<Record<string, unknown>>(key)
      if (value?.seed instanceof Uint8Array) {
        const pool = Buffer.alloc(64, 0xee); pool.set(value.seed, 16); pools.push(pool)
        value.seed = pool.subarray(16, 48)
      }
      return value
    }) as typeof f.store.load
    const message = new Uint8Array(32).fill(5)
    let signed: {publicKey: Uint8Array; signature: Uint8Array} | undefined
    vi.mocked(prepareRegisteredPaidSession).mockImplementationOnce(async (_chain, _config, _params, options) => {
      for (const pool of pools) pool.fill(0)
      signed = {publicKey: options.signer.publicKey, signature: await options.signer.sign(message)}
      return {sessionId: 'ab'.repeat(32)} as RegisteredPaidAgentSession
    })
    await resumePaidOperation(f.config, error.requestId, {holder: f.holder})
    expect(pools.length).toBeGreaterThan(0)
    const certificate = vi.mocked(createExecutionCertificate).mock.calls[0]![0].publicKey
    expect(signed!.publicKey).toEqual(certificate)
    expect(ed25519.verify(signed!.signature, message, signed!.publicKey, {zip215: false})).toBe(true)
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
  it('bounds the original artifact publication wait by the configured budget and intent lifetime before reserving', async () => {
    const f = setup()
    const op = await paidOperation({...f.config, snapshotWaitMs: 2_000}, {...f.request, operation: {...f.request.operation, ttlSecs: 1}})
    expect(vi.mocked(fetchDrawnVerifierWitnesses).mock.calls[0]?.[3]?.waitForPublicationMs).toBe(1_000)
    expect(vi.mocked(fetchDrawnVerifierWitnesses).mock.calls[0]?.[1]).toEqual(op.payment)
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
  })
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

  it('pays a sign on a threshold P-256 slot (mode 4) as eoa-sign, the keeper eoa-digest route', async () => {
    const f = setup()
    const resolved = await discoverPaidOperationContext(undefined as never, undefined as never, slot)
    vi.mocked(discoverPaidOperationContext).mockReset().mockResolvedValue({...resolved, mode: 4})
    const op = await paidOperation(f.config, f.request)
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

  it('wraps a refused grant as a session failure and classifies cancellation as aborted', async () => {
    const f = setup()
    vi.mocked(verifierAgentResult).mockReturnValueOnce({token: {} as never, verifierProofs: []})
    await expect(paidOperation(f.config, f.request)).rejects.toThrow(/anchored verifier proofs/)
    const g = setup(), controller = new AbortController(), reason = new Error('user cancelled')
    vi.mocked(drivePaidSession).mockImplementationOnce(async () => { controller.abort(reason); throw new Error('aborted') })
    expect(await paidOperation(g.config, {...g.request, signal: controller.signal}).catch((e: unknown) => e))
      .toMatchObject({name: 'PaidOperationRecoveryError', phase: 'session', code: 'aborted', resumable: true, cause: reason})
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

describe('paid operation error classification', () => {
  const session = 'ab'.repeat(32)
  it.each([
    [new VerifierAgentSessionError('refused', session, 'committee refused'), 'session-refused', false],
    [new PaidAgentControlError(session, 403), 'session-refused', false],
    [new PaidAgentControlError(session, 410), 'session-refused', false],
    [new VerifierAgentSessionError('protocol', session, 'gone', 404), 'session-refused', false],
    [new PaidSessionRecoveryError('wallet-x-create', 'unknown outcome'), 'session-write-uncertain', false],
    [new PaidAgentControlError(session, 503), 'session-interrupted', true],
    [new PaidAgentControlError(session, 429), 'session-interrupted', true],
    [new PaidAgentControlError(session, 409), 'session-interrupted', true],
    [new VerifierAgentSessionError('unavailable', session, 'down', 502), 'session-interrupted', true],
    [new TypeError('fetch failed'), 'session-interrupted', true],
  ] as const)('classifies a session failure %# as %s', async (cause, code, resumable) => {
    const f = setup()
    vi.mocked(drivePaidSession).mockRejectedValueOnce(cause)
    const error = await paidOperation(f.config, f.request).catch((e: unknown) => e) as PaidOperationRecoveryError
    expect(error).toBeInstanceOf(PaidOperationRecoveryError)
    expect(error).toMatchObject({phase: 'session', code, resumable, cause})
  })

  it('reports an interrupted session after payment expiry as final', async () => {
    const f = setup()
    vi.mocked(drivePaidSession).mockImplementationOnce(async () => {
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 7_200_000)
      throw new TypeError('fetch failed')
    })
    const error = await paidOperation(f.config, f.request).catch((e: unknown) => e) as PaidOperationRecoveryError
    vi.restoreAllMocks()
    expect(error).toMatchObject({code: 'payment-expired', resumable: false})
  })

  it('separates a refused reservation (nothing sent) from an uncertain one', async () => {
    const f = setup()
    vi.mocked(reserveApplicationPayment).mockRejectedValueOnce(new UnderfundedSlotError({slotId: slot, status: 402, url: 'https://a', message: 'x'}))
    expect(await paidOperation(f.config, f.request).catch((e: unknown) => e)).toMatchObject({phase: 'reservation', code: 'reservation-refused', resumable: true})
    const g = setup()
    vi.mocked(reserveApplicationPayment).mockRejectedValueOnce(new Error('receipt timeout'))
    vi.mocked(loadPaidReservationJournal).mockResolvedValueOnce({phase: 'submitted'} as Awaited<ReturnType<typeof loadPaidReservationJournal>>)
    expect(await paidOperation(g.config, g.request).catch((e: unknown) => e)).toMatchObject({code: 'reservation-uncertain', resumable: true})
    const k = setup()
    vi.mocked(reserveApplicationPayment).mockImplementationOnce(async () => {
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 7_200_000)
      throw new Error('payment expiry is outside the allowed lifetime')
    })
    const expiredError = await paidOperation(k.config, k.request).catch((e: unknown) => e)
    vi.restoreAllMocks()
    expect(expiredError).toMatchObject({code: 'reservation-refused', resumable: false})
  })

  it('never replaces a stale-epoch refusal with a re-signed intent: the journal stays reconcilable and is found if it lands', async () => {
    const f = setup(), ids: Hex[] = []
    vi.mocked(reserveApplicationPayment).mockRejectedValueOnce(new PaidReservationStaleEpochError(7))
    const error = await paidOperation(f.config, {...f.request, onRequestId: (id: Hex) => { ids.push(id) }}).catch((e: unknown) => e)
    expect(error).toMatchObject({phase: 'reservation', code: 'reservation-refused', resumable: true})
    // One intent only: no second discovery, signature or reservation.
    expect(vi.mocked(discoverPaidOperationContext)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(reserveApplicationPayment)).toHaveBeenCalledTimes(1)
    expect(ids).toHaveLength(1)
    expect(await paidOperationPhase(f.store, ids[0]!)).toBe('reserving')
    // Not abandonable while whoever holds the intent could still get it reserved (payment expiry + 30 s quote age).
    const refused = await abandonPaidOperation(f.store, ids[0]!, {reason: 'retry'}).catch((e: unknown) => e) as PaidOperationAbandonRefusedError
    expect(refused).toBeInstanceOf(PaidOperationAbandonRefusedError)
    const record = await f.store.load<{payment: {expires: number}}>('paid-op-' + ids[0]!.slice(2).toLowerCase())
    expect(refused.notBefore).toBeGreaterThanOrEqual(record!.payment.expires + 30)
    // If someone lands it meanwhile, reconciliation finds it on chain: it is reserved, never forgotten.
    reservation('reserved')
    expect(await reconcilePaidOperation(f.config, ids[0]!)).toMatchObject({phase: 'reserved'})
  })

  it('signs once more when the payer freed up two epochs after discovery and nothing was prepared yet', async () => {
    const f = setup(), ids: Hex[] = []
    vi.mocked(readCurrentBeaconEpoch).mockResolvedValueOnce(9n).mockResolvedValue(7n)
    const op = await paidOperation(f.config, {...f.request, onRequestId: (id: Hex) => { ids.push(id) }})
    expect(ids).toHaveLength(2)
    expect(op.requestId).toBe(ids[1])
    // The stale intent never reached an accountant: no reservation was attempted for it.
    expect(vi.mocked(reserveApplicationPayment)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(reserveApplicationPayment).mock.calls[0]![3]).toMatchObject({nonce: op.payment.nonce})
    expect(vi.mocked(discoverPaidOperationContext)).toHaveBeenCalledTimes(2)
    expect(await paidOperationPhase(f.store, ids[0]!)).toBe('failed')
  })

  it('keeps an intent one epoch behind (still admissible) and never re-signs once a preparation is journaled', async () => {
    const f = setup(), ids: Hex[] = []
    vi.mocked(readCurrentBeaconEpoch).mockResolvedValue(8n)
    await paidOperation(f.config, {...f.request, onRequestId: (id: Hex) => { ids.push(id) }})
    expect(ids).toHaveLength(1)
    const g = setup(), later: Hex[] = []
    vi.mocked(readCurrentBeaconEpoch).mockResolvedValue(50n)
    vi.mocked(loadPaidReservationJournal).mockResolvedValue({phase: 'prepared'} as Awaited<ReturnType<typeof loadPaidReservationJournal>>)
    vi.mocked(reserveApplicationPayment).mockClear()
    await paidOperation(g.config, {...g.request, onRequestId: (id: Hex) => { later.push(id) }})
    expect(later).toHaveLength(1)
    expect(vi.mocked(reserveApplicationPayment)).toHaveBeenCalledTimes(1)
  })

  it('reports a second wait past two epochs as a refusal, with both unsent intents journaled failed', async () => {
    const f = setup(), ids: Hex[] = []
    vi.mocked(readCurrentBeaconEpoch).mockResolvedValue(9n)
    const error = await paidOperation(f.config, {...f.request, onRequestId: (id: Hex) => { ids.push(id) }}).catch((e: unknown) => e)
    expect(error).toMatchObject({phase: 'reservation', code: 'reservation-refused', resumable: false})
    expect(ids).toHaveLength(2)
    expect(vi.mocked(reserveApplicationPayment)).not.toHaveBeenCalled()
    for (const id of ids) expect(await paidOperationPhase(f.store, id)).toBe('failed')
  })

  it('codes resume outcomes and execution uncertainty', async () => {
    const f = setup()
    vi.mocked(reserveApplicationPayment).mockRejectedValueOnce(new Error('lost'))
    vi.mocked(loadPaidReservationJournal).mockResolvedValueOnce({phase: 'prepared'} as Awaited<ReturnType<typeof loadPaidReservationJournal>>)
    const {requestId} = await paidOperation(f.config, f.request).catch((e: unknown) => e) as PaidOperationRecoveryError
    reservation('uncertain', true)
    expect(await resumePaidOperation(f.config, requestId, {holder: f.holder}).catch((e: unknown) => e)).toMatchObject({code: 'reservation-uncertain', resumable: true})
    reservation('not-reserved')
    expect(await resumePaidOperation(f.config, requestId, {holder: f.holder}).catch((e: unknown) => e)).toMatchObject({code: 'reservation-failed', resumable: false})
    expect(await resumePaidOperation(f.config, requestId, {holder: f.holder}).catch((e: unknown) => e)).toMatchObject({code: 'reservation-failed', resumable: false})
    const g = setup(), op = await paidOperation(g.config, g.request)
    expect(await op.execute(async () => { throw new Error('reply lost') }).catch((e: unknown) => e)).toMatchObject({phase: 'execution', code: 'execution-uncertain', resumable: false})
  })
})

describe('paid operation observability', () => {
  it('reports the request ID before witnesses or reservation, and a throwing observer stops before spending', async () => {
    const f = setup(), seen: Hex[] = []
    vi.mocked(fetchDrawnVerifierWitnesses).mockImplementationOnce(async () => {
      expect(seen).toHaveLength(1)
      return {witnesses, artifact: {}, host: 'http://127.0.0.1:9000'}
    })
    const op = await paidOperation(f.config, {...f.request, onRequestId: id => { seen.push(id) }})
    expect(seen).toEqual([op.requestId])
    const g = setup()
    await expect(paidOperation(g.config, {...g.request, onRequestId: () => { throw new Error('app refused') }})).rejects.toThrow('app refused')
    expect(fetchDrawnVerifierWitnesses).toHaveBeenCalledTimes(1)
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
    expect(await listPaidOperations(g.store)).toEqual([])
  })

  it('lists journaled operations by phase without the store key scheme', async () => {
    const f = setup()
    const done = await paidOperation(f.config, f.request)
    await done.execute(async () => 1)
    vi.mocked(reserveApplicationPayment).mockRejectedValueOnce(new Error('lost'))
    vi.mocked(loadPaidReservationJournal).mockResolvedValueOnce({phase: 'submitted'} as Awaited<ReturnType<typeof loadPaidReservationJournal>>)
    const stuck = await paidOperation(f.config, f.request).catch((e: unknown) => e) as PaidOperationRecoveryError
    const all = await listPaidOperations(f.store)
    expect(all).toEqual([
      {requestId: done.requestId.toLowerCase(), phase: 'executed', slot, action: 'sign', expires: done.payment.expires, payer: payer.address},
      expect.objectContaining({requestId: stuck.requestId.toLowerCase(), phase: 'reserving'}),
    ])
    expect((await listPaidOperations(f.store, {phase: 'reserving'})).map(o => o.requestId)).toEqual([stuck.requestId.toLowerCase()])
    expect(await listPaidOperations(f.store, {phase: ['executing', 'failed']})).toEqual([])
    await f.store.save('paid-op-index', {schema: 2})
    await expect(listPaidOperations(f.store)).rejects.toThrow(/index/)
  })
})

describe('paid IBE partial recovery', () => {
  const contributors = [12, 21, 22].map(n => ({operator: h(n, 20), publicKey: h(n), url: `http://127.0.0.1:40${n}`}))
  async function ibe() {
    const f = setup()
    const base = await discoverPaidOperationContext(undefined as never, undefined as never, slot)
    vi.mocked(discoverPaidOperationContext).mockResolvedValue({...base, mode: 1, contributors,
      intentFields: {...base.intentFields, keeper_assignment: {...base.intentFields.keeper_assignment, threshold: 2,
        contributors: [12, 21, 22].map(n => Array<number>(32).fill(n))}}})
    const op = await paidOperation({...f.config, keeperUrl: url => url.replace('127.0.0.1', 'localhost')},
      {...f.request, operation: {action: 'ibe-extract' as const, identity: ibeVector.identity, ...ibeBinding}})
    await op.execute(async () => { throw new Error('fan-out reply lost') }).catch(() => {})
    return {...f, op}
  }
  const share = async (identifier: number) => {
    const partial = ibeVector.shares.find(s => s.identifier === identifier)!
    return JSON.stringify(await sealIbeFixture({key_slot_id: slot, epoch: 1, identifier,
      extraction_share: Buffer.from(hexToBytes(partial.d_i as Hex)).toString('base64'), verifying_share: Buffer.from(ibePublic.get(identifier)!).toString('base64')},
      ibeRecipient, requestHash(43112, hexToBytes(slot), 'ibe-extract', ibeBinding.payloadDigest)))
  }
  const transport = {keeperRecoveryRequest: vi.fn()}

  it('recovers an original contributor sealed reply without a recipient opening key', async () => {
    const {op, config} = await ibe()
    const sealed = {resultJson: await share(2)} as Awaited<ReturnType<typeof recoverKeeperExecution>>
    vi.mocked(recoverKeeperExecution).mockResolvedValue(sealed)
    const before = vi.mocked(prepareRegisteredPaidSession).mock.calls.length
    expect(await op.recover({transport, contributorKey: contributors[1]!.publicKey})).toBe(sealed)
    expect(vi.mocked(recoverKeeperExecution).mock.calls.at(-1)![0]).toMatchObject({
      keeper: {...contributors[1], url: contributors[1]!.url.replace('127.0.0.1', 'localhost')}, target: {stage: 'contributor'}, payment: op.payment,
    })
    expect(vi.mocked(prepareRegisteredPaidSession).mock.calls.length).toBe(before)
    const recovered = await recoverPaidOperation({...config, keeperUrl: url => url.replace('127.0.0.1','localhost')}, op.requestId)
    try {expect(await recovered.recover({transport, contributorKey: contributors[1]!.publicKey})).toBe(sealed)} finally {recovered.dispose()}
  })

  it('refuses unassigned or malformed contributor keys and conflicting recovery stages before I/O', async () => {
    const {op} = await ibe()
    for (const options of [{contributorKey: h(99)}, {contributorKey: '0x12' as Hex},
      {contributorKey: contributors[1]!.publicKey, stage: 'coordinator' as const}]) {
      await expect(op.recover({transport, ...options})).rejects.toThrow(/contributor/)
    }
    expect(recoverKeeperExecution).not.toHaveBeenCalled()
  })

  it('reads retained contributor results until the threshold, never re-sending an extraction', async () => {
    const {op} = await ibe()
    expect(vi.mocked(prepareRegisteredPaidSession).mock.calls[0]![2].decryption).toEqual(ibeBinding.decryption)
    let n = 0
    vi.mocked(recoverKeeperExecution).mockImplementation(async options => {
      if (options.keeper.operator === contributors[0]!.operator) throw new Error('keeper offline')
      return {resultJson: await share(++n)} as Awaited<ReturnType<typeof recoverKeeperExecution>>
    })
    const result = await op.recoverIbePartials({transport, ...ibeRecovery, concurrency: 1})
    expect(result.threshold).toBe(2)
    expect(result.partials.map(p => p.partial.identifier)).toEqual([1, 2])
    expect(result.partials[0]!.partial).toMatchObject({value: hexToBytes(ibeVector.shares[0]!.d_i as Hex), epoch: 1, keySlotId: slot, nodeUrl: 'http://localhost:4021'})
    expect(result.partials[0]!.partial.verifyingShareG2).toHaveLength(96)
    expect(result.failures).toEqual([{operator: contributors[0]!.operator, message: 'keeper offline'}])
    const calls = vi.mocked(recoverKeeperExecution).mock.calls.map(([o]) => o)
    expect(calls).toHaveLength(3)
    expect(calls.every(o => o.target.stage === 'contributor' && o.transport === transport)).toBe(true)
  })

  it('refuses missing or substituted recipient and identity before reading any contributor', async () => {
    const {op} = await ibe()
    await expect(op.recoverIbePartials({transport})).rejects.toThrow(/Original client recipient/)
    await expect(op.recoverIbePartials({transport, ...ibeRecovery, recipient: await createDecryptionRecipient()})).rejects.toThrow(/differs from original authorization/)
    await expect(op.recoverIbePartials({transport, ...ibeRecovery, identity: 'another identity'})).rejects.toThrow(/differs from original authorization/)
    expect(recoverKeeperExecution).not.toHaveBeenCalled()
  })

  it('does not form a quorum from duplicate identifiers or untrusted public shares', async () => {
    const {op} = await ibe()
    vi.mocked(recoverKeeperExecution).mockResolvedValue({resultJson: await share(1)} as Awaited<ReturnType<typeof recoverKeeperExecution>>)
    await expect(op.recoverIbePartials({transport, ...ibeRecovery})).rejects.toThrow(/1 of 2/)
    await expect(op.recoverIbePartials({transport, ...ibeRecovery, verifyingShares: new Map([[1, new Uint8Array(144)]])})).rejects.toThrow(/0 of 2/)
  })

  it('refuses tampered sealed retained results without repeating a paid operation', async () => {
    const {op} = await ibe()
    const row = JSON.parse(await share(1)) as {sealed_share: {ciphertext: string}}
    row.sealed_share.ciphertext = Buffer.alloc(64).toString('base64')
    vi.mocked(recoverKeeperExecution).mockResolvedValue({resultJson: JSON.stringify(row)} as Awaited<ReturnType<typeof recoverKeeperExecution>>)
    await expect(op.recoverIbePartials({transport, ...ibeRecovery})).rejects.toThrow(/0 of 2/)
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
    expect(drivePaidSession).toHaveBeenCalledTimes(1)
  })

  it('stops starting reads once the threshold is met and refuses below it', async () => {
    const {op} = await ibe()
    vi.mocked(recoverKeeperExecution).mockImplementation(async options =>
      ({resultJson: await share(contributors.findIndex(k => k.operator === options.keeper.operator) + 1)} as Awaited<ReturnType<typeof recoverKeeperExecution>>))
    expect((await op.recoverIbePartials({transport, ...ibeRecovery, concurrency: 1})).partials).toHaveLength(2)
    expect(recoverKeeperExecution).toHaveBeenCalledTimes(2)
    vi.mocked(recoverKeeperExecution).mockReset().mockRejectedValue(new Error('404'))
    await expect(op.recoverIbePartials({transport, ...ibeRecovery})).rejects.toThrow(/0 of 2/)
    vi.mocked(recoverKeeperExecution).mockReset().mockResolvedValue({resultJson: JSON.stringify({identifier: 1, extraction_share: 'AA==', verifying_share: 'AA==', epoch: 1, key_slot_id: slot})} as Awaited<ReturnType<typeof recoverKeeperExecution>>)
    await expect(op.recoverIbePartials({transport, ...ibeRecovery})).rejects.toThrow(/IBE partials/)
    await expect(op.recoverIbePartials({transport, ...ibeRecovery, concurrency: 17})).rejects.toThrow(/concurrency/)
    const controller = new AbortController(); controller.abort(new Error('stop'))
    await expect(op.recoverIbePartials({transport, ...ibeRecovery, signal: controller.signal})).rejects.toThrow('stop')
  })

  it('refuses a non-IBE operation', async () => {
    const f = setup(), op = await paidOperation(f.config, f.request)
    await expect(op.recoverIbePartials({transport})).rejects.toThrow(/ibe-extract/)
  })
})

describe('abandonPaidOperation', () => {
  const later = (secs: number) => vi.spyOn(Date, 'now').mockReturnValue(Date.now() + secs * 1000)
  async function unsent() {
    const f = setup()
    vi.mocked(reserveApplicationPayment).mockRejectedValueOnce(new ApplicationPayerRecoveryError(h(70)))
    await expect(paidOperation(f.config, f.request)).rejects.toBeInstanceOf(ApplicationPayerRecoveryError)
    const requestId = prepaidRequestId(vi.mocked(reserveApplicationPayment).mock.calls.at(-1)![3])
    return {...f, requestId}
  }

  it('closes an unsent reservation, hides it from the list and refuses to resume or reserve it', async () => {
    const f = await unsent()
    // The signed intent reached the accountants: not before its payment and quote windows have passed.
    const early = await abandonPaidOperation(f.store, f.requestId, {reason: 'user cancelled'}).catch((e: unknown) => e) as PaidOperationAbandonRefusedError
    expect(early).toBeInstanceOf(PaidOperationAbandonRefusedError)
    vi.spyOn(Date, 'now').mockReturnValue(early.notBefore! * 1000)
    const closed = await abandonPaidOperation(f.store, f.requestId, {reason: 'user cancelled'})
    expect(closed).toMatchObject({requestId: f.requestId.toLowerCase(), from: 'reserving', reason: 'user cancelled'})
    expect(await paidOperationPhase(f.store, f.requestId)).toBe('abandoned')
    // Idempotent: the original record is returned.
    expect(await abandonPaidOperation(f.store, f.requestId, {reason: 'again'})).toEqual(closed)
    expect(await listPaidOperations(f.store)).toEqual([])
    expect(await listPaidOperations(f.store, {includeAbandoned: true})).toEqual([expect.objectContaining({phase: 'abandoned', payer: payer.address,
      abandoned: {reason: 'user cancelled', at: closed.at, phase: 'reserving'}})])
    expect(await listPaidOperations(f.store, {phase: 'abandoned'})).toHaveLength(1)
    expect(await listPaidOperations(f.store, {phase: 'reserving', includeAbandoned: true})).toEqual([])
    await expect(resumePaidOperation(f.config, f.requestId, {holder: f.holder})).rejects.toThrow(/abandoned/)
    expect(await reconcilePaidOperation(f.config, f.requestId)).toMatchObject({phase: 'abandoned', reservation: 'none', next: 'closed', reason: 'user cancelled', payer: payer.address})
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
  })

  it('never reserves a journal closed between journaling and reservation', async () => {
    const f = setup(), inner = f.store
    const store: ApplicationStore = {...inner, load: inner.load.bind(inner), withLock: inner.withLock.bind(inner),
      async save(key, value) {
        await inner.save(key, value)
        const record = value as {phase?: string}
        if (key.startsWith('paid-op-') && key !== 'paid-op-index' && record.phase === 'reserving') await inner.save(key, {...record, phase: 'abandoned'})
      }}
    await expect(paidOperation({...f.config, store}, f.request)).rejects.toThrow(/closed before its reservation/)
    expect(reserveApplicationPayment).not.toHaveBeenCalled()
  })

  it('refuses a prepared reservation until reconciliation settles it', async () => {
    const f = await unsent()
    vi.mocked(loadPaidReservationJournal).mockResolvedValueOnce({phase: 'prepared'} as Awaited<ReturnType<typeof loadPaidReservationJournal>>)
    const refused = await abandonPaidOperation(f.store, f.requestId, {reason: 'x'}).catch((e: unknown) => e)
    expect(refused).toBeInstanceOf(PaidOperationAbandonRefusedError)
    expect(refused).toMatchObject({phase: 'reserving', notBefore: undefined, retryable: false, message: /reconcile/})
    vi.mocked(loadPaidReservationJournal).mockRejectedValueOnce(new Error('corrupt'))
    await expect(abandonPaidOperation(f.store, f.requestId, {reason: 'x'})).rejects.toBeInstanceOf(PaidOperationAbandonRefusedError)
    expect(await paidOperationPhase(f.store, f.requestId)).toBe('reserving')
    // Reconciliation proves it never happened; then it can be closed.
    reservation('not-reserved')
    await reconcilePaidOperation(f.config, f.requestId)
    expect(await abandonPaidOperation(f.store, f.requestId, {reason: 'never reserved'})).toMatchObject({from: 'failed'})
    expect(await reconcilePaidOperation(f.config, f.requestId)).toMatchObject({phase: 'abandoned', reservation: 'not-reserved', next: 'closed'})
  })

  it('closes a paid but unfinished operation only after its payment expired', async () => {
    const f = setup()
    const op = await paidOperation(f.config, f.request)
    await op.execute(async () => { throw new Error('reply lost') }).catch(() => {})
    const refused = await abandonPaidOperation(f.store, op.requestId, {reason: 'give up'}).catch((e: unknown) => e) as PaidOperationAbandonRefusedError
    expect(refused).toMatchObject({phase: 'executing', notBefore: op.payment.expires + 120, retryable: true})
    later(op.payment.expires - Date.now() / 1000 + 60)
    await expect(abandonPaidOperation(f.store, op.requestId, {reason: 'give up'})).rejects.toBeInstanceOf(PaidOperationAbandonRefusedError)
    vi.restoreAllMocks(); later(op.payment.expires - Date.now() / 1000 + 121)
    expect(await abandonPaidOperation(f.store, op.requestId, {reason: 'give up'})).toMatchObject({from: 'executing'})
    vi.restoreAllMocks()
    expect(await reconcilePaidOperation(f.config, op.requestId)).toMatchObject({phase: 'abandoned', reservation: 'reserved', next: 'closed'})
    // Retained results stay readable.
    vi.mocked(recoverKeeperExecution).mockResolvedValue({resultJson: '{}'} as Awaited<ReturnType<typeof recoverKeeperExecution>>)
    const recovery = await recoverPaidOperation(f.config, op.requestId)
    expect(recovery.phase).toBe('abandoned')
    await recovery.recover({transport: {keeperRecoveryRequest: vi.fn()}})
    recovery.dispose()
  })

  it('closes a completed operation at once and validates its input', async () => {
    const f = setup(), op = await paidOperation(f.config, f.request)
    await op.execute(async () => 1)
    expect(await abandonPaidOperation(f.store, op.requestId, {reason: 'archived'})).toMatchObject({from: 'executed'})
    await expect(abandonPaidOperation(f.store, op.requestId, {reason: ' '})).rejects.toThrow(/reason/)
    await expect(abandonPaidOperation(f.store, op.requestId, {reason: 'x'.repeat(513)})).rejects.toThrow(/reason/)
    await expect(abandonPaidOperation(f.store, op.requestId, undefined as never)).rejects.toThrow(/reason/)
    await expect(abandonPaidOperation(f.store, h(90), {reason: 'x'})).rejects.toThrow(/No paid operation journal/)
    await expect(abandonPaidOperation(f.store, '0x1' as Hex, {reason: 'x'})).rejects.toThrow(/request ID/)
  })
})

describe('recorded gas payer', () => {
  const other = privateKeyToAccount(h(9))
  it('resumes and reconciles a reservation with the payer it journaled, refusing another', async () => {
    const f = setup()
    vi.mocked(reserveApplicationPayment).mockRejectedValueOnce(new Error('lost'))
    vi.mocked(loadPaidReservationJournal).mockResolvedValueOnce({phase: 'submitted'} as Awaited<ReturnType<typeof loadPaidReservationJournal>>)
    const {requestId} = await paidOperation(f.config, f.request).catch((e: unknown) => e) as PaidOperationRecoveryError
    const swapped = {...f.config, gasPayer: {account: other, chain: chainDef} as unknown as PaidOperationConfig['gasPayer']}
    await expect(resumePaidOperation(swapped, requestId, {holder: f.holder})).rejects.toThrow(/journaled with gas payer/)
    reservation('uncertain', true)
    expect(await reconcilePaidOperation(swapped, requestId)).toMatchObject({payer: payer.address, next: 'wait'})
    expect(vi.mocked(reconcileApplicationReservation).mock.calls.at(-1)![5]).toMatchObject({payer: payer.address})
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
  })

  it('selectApplicationGasPayer honours the recorded payer for a resume, whatever its claim', async () => {
    const f = setup()
    vi.mocked(reserveApplicationPayment).mockRejectedValueOnce(new Error('lost'))
    vi.mocked(loadPaidReservationJournal).mockResolvedValueOnce({phase: 'submitted'} as Awaited<ReturnType<typeof loadPaidReservationJournal>>)
    const {requestId} = await paidOperation(f.config, f.request).catch((e: unknown) => e) as PaidOperationRecoveryError
    const wallet = (account: typeof payer) => ({account, chain: chainDef}) as unknown as PaidOperationConfig['gasPayer']
    const pool = [wallet(other), wallet(payer)]
    await f.store.save(`prepaid-payer-43112-${payer.address.toLowerCase()}`, {schema: 1, chainId: 43112, payer: payer.address, nextNonce: 1, pending: {requestId, nonce: 1}})
    expect((await selectApplicationGasPayer(f.store, pool))!.account.address).toBe(other.address)
    expect((await selectApplicationGasPayer(f.store, pool, {resume: requestId}))!.account.address).toBe(payer.address)
    await expect(selectApplicationGasPayer(f.store, [wallet(other)], {resume: requestId})).rejects.toThrow(/not in the pool/)
    // No journal (or a journal from before payers were recorded): normal selection.
    expect((await selectApplicationGasPayer(f.store, pool, {resume: h(90)}))!.account.address).toBe(other.address)
    const key = `paid-op-${requestId.slice(2).toLowerCase()}`, record = await f.store.load<Record<string, unknown>>(key)
    await f.store.save(key, {...record, payer: undefined})
    expect((await selectApplicationGasPayer(f.store, pool, {resume: requestId}))!.account.address).toBe(other.address)
    expect((await listPaidOperations(f.store))[0]).not.toHaveProperty('payer')
    await f.store.save(key, {...record, payer: 'nope'})
    await expect(selectApplicationGasPayer(f.store, pool, {resume: requestId})).rejects.toThrow(/Invalid paid operation journal/)
  })
})

describe('paid operation abort classification', () => {
  it('reports an abort before the reservation as aborted and resumable, and resume reserves once', async () => {
    const f = setup(), controller = new AbortController(), reason = new Error('stop')
    vi.mocked(fetchDrawnVerifierWitnesses).mockImplementationOnce(async () => { controller.abort(reason); return {witnesses, artifact: {}, host: 'http://127.0.0.1:9000'} })
    const error = await paidOperation(f.config, {...f.request, signal: controller.signal}).catch((e: unknown) => e) as PaidOperationRecoveryError
    expect(error).toMatchObject({phase: 'reservation', code: 'aborted', resumable: true, cause: reason})
    expect(reserveApplicationPayment).not.toHaveBeenCalled()
    await resumePaidOperation(f.config, error.requestId, {holder: f.holder})
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
  })

  it('hands its signal to the reservation: a refused unsent one is aborted, a broadcast one stays uncertain with the payer locked', async () => {
    const f = setup(), controller = new AbortController(), reason = new Error('stop')
    vi.mocked(reserveApplicationPayment).mockImplementationOnce(async (_c, _w, _d, payment, _e, options) => {
      expect(options.signal).toBe(controller.signal)
      controller.abort(reason)
      throw new PaidReservationAbortedError(prepaidRequestId(payment), reason)
    })
    const error = await paidOperation(f.config, {...f.request, signal: controller.signal}).catch((e: unknown) => e) as PaidOperationRecoveryError
    expect(error).toMatchObject({phase: 'reservation', code: 'aborted', resumable: true, cause: reason})
    expect((await listPaidOperations(f.store))[0]).toMatchObject({phase: 'reserving'})
    await resumePaidOperation(f.config, error.requestId, {holder: f.holder})
    const g = setup(), late = new AbortController()
    vi.mocked(reserveApplicationPayment).mockImplementationOnce(async (_c, _w, _d, payment) => {
      late.abort(reason)
      throw new PaidReservationUncertainError(prepaidRequestId(payment), h(50), reason)
    })
    vi.mocked(loadPaidReservationJournal).mockResolvedValueOnce({phase: 'submitted'} as Awaited<ReturnType<typeof loadPaidReservationJournal>>)
    expect(await paidOperation(g.config, {...g.request, signal: late.signal}).catch((e: unknown) => e)).toMatchObject({phase: 'reservation', code: 'reservation-uncertain', resumable: true})
  })

  it('rethrows an abort before anything is journaled', async () => {
    const f = setup(), controller = new AbortController()
    await expect(paidOperation(f.config, {...f.request, signal: controller.signal, onRequestId: () => controller.abort(new Error('early'))})).rejects.toThrow('early')
    expect(await listPaidOperations(f.store)).toEqual([])
  })

  it('lets an uncertain reservation win over an abort, and an aborted unsent one stay resumable', async () => {
    const f = setup(), controller = new AbortController()
    vi.mocked(reserveApplicationPayment).mockImplementationOnce(async () => { controller.abort(new Error('stop')); throw new Error('cancelled') })
    expect(await paidOperation(f.config, {...f.request, signal: controller.signal}).catch((e: unknown) => e)).toMatchObject({code: 'aborted', resumable: true})
    const g = setup(), second = new AbortController()
    vi.mocked(reserveApplicationPayment).mockImplementationOnce(async () => { second.abort(new Error('stop')); throw new Error('cancelled') })
    vi.mocked(loadPaidReservationJournal).mockResolvedValueOnce({phase: 'submitted'} as Awaited<ReturnType<typeof loadPaidReservationJournal>>)
    expect(await paidOperation(g.config, {...g.request, signal: second.signal}).catch((e: unknown) => e)).toMatchObject({code: 'reservation-uncertain', resumable: true})
  })

  it('classifies session aborts: before or while preparing, while driving, and an uncertain write wins', async () => {
    const f = setup()
    vi.mocked(drivePaidSession).mockRejectedValueOnce(new TypeError('fetch failed'))
    const {requestId} = await paidOperation(f.config, f.request).catch((e: unknown) => e) as PaidOperationRecoveryError
    const aborted = () => { const c = new AbortController(); c.abort(new Error('stop')); return c.signal }
    expect(await resumePaidOperation(f.config, requestId, {holder: f.holder, signal: aborted()}).catch((e: unknown) => e))
      .toMatchObject({phase: 'session', code: 'aborted', resumable: true})
    const controller = new AbortController()
    vi.mocked(prepareRegisteredPaidSession).mockImplementationOnce(async () => { controller.abort(new Error('stop')); throw new Error('cancelled') })
    expect(await resumePaidOperation(f.config, requestId, {holder: f.holder, signal: controller.signal}).catch((e: unknown) => e)).toMatchObject({code: 'aborted'})
    vi.mocked(prepareRegisteredPaidSession).mockRejectedValueOnce(new Error('agent unreachable'))
    await expect(resumePaidOperation(f.config, requestId, {holder: f.holder})).rejects.toThrow('agent unreachable')
    const writing = new AbortController()
    vi.mocked(drivePaidSession).mockImplementationOnce(async () => { writing.abort(new Error('stop')); throw new PaidSessionRecoveryError('wallet-x-create', 'unknown outcome') })
    expect(await resumePaidOperation(f.config, requestId, {holder: f.holder, signal: writing.signal}).catch((e: unknown) => e)).toMatchObject({code: 'session-write-uncertain', resumable: false})
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 7_200_000)
    const late = await resumePaidOperation(f.config, requestId, {holder: f.holder, signal: aborted()}).catch((e: unknown) => e)
    vi.restoreAllMocks()
    expect(late).toMatchObject({code: 'aborted', resumable: false})
  })
})

describe('recoverPaidOperation', () => {
  it('opens recovery reads for a sent execution without a holder, a session or new work', async () => {
    const f = setup(), op = await paidOperation(f.config, f.request)
    await expect(recoverPaidOperation(f.config, op.requestId)).rejects.toThrow(/after its keeper work was sent/)
    await op.execute(async () => { throw new Error('reply lost') }).catch(() => {})
    expect(await reconcilePaidOperation(f.config, op.requestId)).toMatchObject({next: 'recover'})
    vi.mocked(recoverKeeperExecution).mockResolvedValue({resultJson: '{"signature":"00"}'} as Awaited<ReturnType<typeof recoverKeeperExecution>>)
    const recovery = await recoverPaidOperation(f.config, op.requestId)
    expect(recovery).toMatchObject({requestId: op.requestId, phase: 'executing', payment: op.payment})
    const transport = {keeperRecoveryRequest: vi.fn()}
    expect((await recovery.recover({transport})).resultJson).toBe('{"signature":"00"}')
    expect(vi.mocked(recoverKeeperExecution).mock.calls[0]![0]).toMatchObject({keeper: coordinator, transport, target: {stage: 'coordinator'}})
    await expect(recovery.recoverIbePartials({transport})).rejects.toThrow(/ibe-extract/)
    recovery.dispose()
    expect(drivePaidSession).toHaveBeenCalledTimes(1)
    await expect(recoverPaidOperation(f.config, h(90))).rejects.toThrow(/No paid operation journal/)
  })

  it('refuses IBE partial recovery for a journal written before contributors were recorded', async () => {
    const f = setup()
    const op = await paidOperation(f.config, {...f.request, operation: {action: 'ibe-extract' as const, identity: ibeVector.identity, ...ibeBinding}})
    await op.execute(async () => { throw new Error('reply lost') }).catch(() => {})
    const key = `paid-op-${op.requestId.slice(2).toLowerCase()}`
    await f.store.save(key, {...await f.store.load<Record<string, unknown>>(key), contributors: undefined})
    const recovery = await recoverPaidOperation(f.config, op.requestId)
    await expect(recovery.recoverIbePartials({transport: {keeperRecoveryRequest: vi.fn()}})).rejects.toThrow(/contributors/)
    await f.store.save(key, {...await f.store.load<Record<string, unknown>>(key), seed: undefined})
    await expect(recoverPaidOperation(f.config, op.requestId)).rejects.toThrow(/execution consent/)
  })
})

describe('paid operation index backfill', () => {
  it('indexes journals the index does not know, once, oldest first', async () => {
    const f = setup()
    const a = await paidOperation(f.config, f.request)
    const b = await paidOperation(f.config, f.request)
    // `a` was journaled before the index existed: only `b` is indexed.
    await f.store.save('paid-op-index-0', {schema: 1, ids: [b.requestId.toLowerCase()]})
    await f.store.save('paid-op-unrelated', {x: 1})
    expect((await listPaidOperations(f.store)).map(o => o.requestId)).toEqual([b.requestId.toLowerCase()])
    const all = await listPaidOperations(f.store, {backfill: true})
    expect(all.map(o => o.requestId)).toEqual([a.requestId.toLowerCase(), b.requestId.toLowerCase()])
    expect(await f.store.load('paid-op-index')).toMatchObject({backfilled: true})
    // Once: a later unindexed journal is not picked up again.
    await f.store.save('paid-op-index', {schema: 1, ids: [], backfilled: true})
    await f.store.save('paid-op-index-0', {schema: 1, ids: []})
    expect(await listPaidOperations(f.store, {backfill: true})).toEqual([])
    const c = await paidOperation(f.config, f.request)
    expect((await listPaidOperations(f.store)).map(o => o.requestId)).toEqual([c.requestId.toLowerCase()])
    await f.store.save('paid-op-index', {schema: 1, ids: [], backfilled: 'yes'})
    await expect(listPaidOperations(f.store)).rejects.toThrow(/index/)
  })

  it('keeps reading an existing single-list index and appends new operations to bounded segments', async () => {
    const f = setup()
    // A store an earlier SDK wrote: two operations in the original `paid-op-index` list.
    const x = await paidOperation(f.config, f.request), y = await paidOperation(f.config, f.request)
    const legacy = {schema: 1, ids: [x.requestId.toLowerCase(), y.requestId.toLowerCase()]}
    await f.store.save('paid-op-index', legacy)
    await f.store.save('paid-op-index-0', {schema: 1, ids: Array.from({length: 256}, (_, i) => '0x' + i.toString(16).padStart(64, '0'))})
    const z = await paidOperation(f.config, f.request)
    // The legacy list is read first and never rewritten; a full segment is never rewritten either.
    expect(await f.store.load('paid-op-index')).toEqual(legacy)
    expect((await f.store.load<{ids: Hex[]}>('paid-op-index-0'))!.ids).toHaveLength(256)
    expect(await f.store.load('paid-op-index-1')).toEqual({schema: 1, ids: [z.requestId.toLowerCase()]})
    expect((await listPaidOperations(f.store)).map(o => o.requestId)).toEqual([x, y, z].map(o => o.requestId.toLowerCase()))
    // An id listed in both the legacy list and a segment is listed once.
    await f.store.save('paid-op-index-1', {schema: 1, ids: [x.requestId.toLowerCase(), z.requestId.toLowerCase()]})
    expect((await listPaidOperations(f.store)).map(o => o.requestId)).toEqual([x, y, z].map(o => o.requestId.toLowerCase()))
    await f.store.save('paid-op-index-1', {schema: 1, ids: ['0x12']})
    await expect(listPaidOperations(f.store)).rejects.toThrow(/index/)
  })

  it('continues in the next segment after a crash left it started', async () => {
    const f = setup()
    const full = Array.from({length: 256}, (_, i) => ('0x' + i.toString(16).padStart(64, '0')) as Hex)
    await f.store.save('paid-op-index-0', {schema: 1, ids: full})
    await f.store.save('paid-op-index-1', {schema: 1, ids: [h(77)]})
    const op = await paidOperation(f.config, f.request)
    expect(await f.store.load('paid-op-index-1')).toEqual({schema: 1, ids: [h(77), op.requestId.toLowerCase()]})
    expect(await f.store.load('paid-op-index-2')).toBeUndefined()
  })

  it('a failed index commit spanning two segments leaves no gap that hides later operations', async () => {
    const f = setup()
    let failSegment = true
    const store: ApplicationStore = {...f.store, load: f.store.load.bind(f.store), withLock: f.store.withLock.bind(f.store), list: f.store.list?.bind(f.store),
      save: async (key: string, value: unknown) => {
        if (failSegment && key === 'paid-op-index-0') { failSegment = false; throw new Error('disk full') }
        return f.store.save(key, value)
      }}
    const config = {...f.config, store}
    // More new operations than one segment holds, in one journal commit that fails on the first segment.
    const results = await Promise.allSettled(Array.from({length: 257}, () => paidOperation(config, f.request)))
    expect(results.some(r => r.status === 'rejected')).toBe(true)
    expect(await f.store.load('paid-op-index-0')).toBeUndefined()
    const later = await paidOperation(config, f.request)
    expect((await listPaidOperations(store)).map(o => o.requestId)).toContain(later.requestId.toLowerCase())
  })

  it('journals concurrent operations in one process with a file store, none refused on its locks', async () => {
    const f = setup()
    const dir = await mkdtemp(join(tmpdir(), 'tasra-paid-index-'))
    try {
      const config = {...f.config, store: createFileStore(dir)}
      const ops = await Promise.all(Array.from({length: 32}, () => paidOperation(config, f.request)))
      const listed = (await listPaidOperations(config.store)).map(o => o.requestId)
      expect(new Set(listed)).toEqual(new Set(ops.map(op => op.requestId.toLowerCase())))
      expect(listed).toHaveLength(32)
    } finally { await rm(dir, {recursive: true, force: true}) }
  })

  it('needs a store that can list its keys', async () => {
    const inner = createMemoryStore()
    const store: ApplicationStore = {load: inner.load.bind(inner), save: inner.save.bind(inner), withLock: inner.withLock.bind(inner)}
    await expect(listPaidOperations(store, {backfill: true})).rejects.toThrow(/list its keys/)
    expect(await listPaidOperations(store)).toEqual([])
  })
})

// The operation journal's own commits: a new operation's record and index entry (one commit for
// every concurrent new operation of a process), each local phase transition (one commit with its
// unlock), and the execution consent (with the session's creation). A crash may keep any subset
// of one commit; each case below resumes to what a crash at that point always resumed to.
describe('paid operation journal commits', () => {
  it('concurrent new operations of one process share the index commit instead of queueing on its lock one by one', async () => {
    const f = setup(), inner = createMemoryStore(), locks: string[] = []
    // A store without native commit steps: every lock is visible.
    const store: ApplicationStore = {load: inner.load.bind(inner), save: inner.save.bind(inner), claim: inner.claim!.bind(inner), list: inner.list!.bind(inner),
      withLock: (key, action) => { locks.push(key); return inner.withLock(key, action) }}
    const config = {...f.config, store}
    const ops = await Promise.all(Array.from({length: 32}, () => paidOperation(config, f.request)))
    const listed = (await listPaidOperations(store)).map(o => o.requestId)
    expect(new Set(listed)).toEqual(new Set(ops.map(op => op.requestId.toLowerCase())))
    expect(listed).toHaveLength(32)
    // One index commit per wave of arrivals, not one per operation.
    const indexCommits = locks.filter(k => k === 'paid-op-index').length
    expect(indexCommits).toBeGreaterThan(0)
    expect(indexCommits).toBeLessThanOrEqual(4)
    for (const op of ops) op.dispose()
  })

  it('an operation already journaled under its request ID is refused alone; the others of its commit are journaled', async () => {
    const f = setup()
    const clash = paidOperation(f.config, {...f.request, onRequestId: async id => { await f.store.save(`paid-op-${id.slice(2).toLowerCase()}`, {schema: 1, phase: 'reserving'}) }})
    const fine = paidOperation(f.config, f.request)
    await expect(clash).rejects.toThrow(/already journaled/)
    const op = await fine
    expect((await listPaidOperations(f.store)).map(o => o.requestId)).toEqual([op.requestId.toLowerCase()])
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
    op.dispose()
  })

  it('a crash that kept the index entry but not the record: listed by no one, resumed by no one, nothing reserved', async () => {
    const f = setup(), ghost = h(0x66)
    await f.store.save('paid-op-index-0', {schema: 1, ids: [ghost]})
    expect(await listPaidOperations(f.store)).toEqual([])
    await expect(resumePaidOperation(f.config, ghost, {holder: f.holder})).rejects.toThrow(/No paid operation journal/)
    const op = await paidOperation(f.config, f.request)
    expect((await f.store.load<{ids: Hex[]}>('paid-op-index-0'))?.ids).toEqual([ghost, op.requestId.toLowerCase()])
    expect((await listPaidOperations(f.store)).map(o => o.requestId)).toEqual([op.requestId.toLowerCase()])
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
    op.dispose()
  })

  it('a crash that kept the record but not its index entry: found and resumed by its request ID, reserved once', async () => {
    const f = setup(), inner = f.store, save = inner.save.bind(inner)
    let requestId: Hex | undefined
    inner.save = async (key, value) => { if (key.startsWith('paid-op-index')) throw new Error('crash before the index entry'); return save(key, value) }
    await expect(paidOperation(f.config, {...f.request, onRequestId: id => { requestId = id }})).rejects.toThrow('crash')
    inner.save = save
    // Nothing was reserved: the reservation starts only after the journal commit resolved.
    expect(reserveApplicationPayment).not.toHaveBeenCalled()
    expect(await paidOperationPhase(f.store, requestId!)).toBe('reserving')
    const op = await resumePaidOperation(f.config, requestId!, {holder: f.holder})
    expect(await paidOperationPhase(f.store, requestId!)).toBe('authorized')
    op.dispose()
  })

  it('a crash before the `executing` commit: nothing ran, the journal stays `authorized`, and execute runs once later', async () => {
    const f = setup(), save = f.store.save.bind(f.store)
    const op = await paidOperation(f.config, f.request)
    let crash = true
    f.store.save = async (key, value) => {
      if (crash && (value as {phase?: string}).phase === 'executing') { crash = false; throw new Error('crash before the commit') }
      return save(key, value)
    }
    const work = vi.fn(async () => 'signature')
    await expect(op.execute(work)).rejects.toBeInstanceOf(PaidOperationRecoveryError)
    expect(work).not.toHaveBeenCalled()
    expect(await paidOperationPhase(f.store, op.requestId)).toBe('authorized')
    expect(await op.execute(work)).toBe('signature')
    expect(work).toHaveBeenCalledTimes(1)
    expect(await paidOperationPhase(f.store, op.requestId)).toBe('executed')
    op.dispose()
  })
})

describe('execution consent journaled with the session creation', () => {
  /** The real driver; each session's identity derives from its consent, as prepareRegisteredPaidSession derives it. */
  async function realDriver(f: ReturnType<typeof setup>) {
    const actual = await vi.importActual<typeof import('../../src/app/paid-session.js')>('../../src/app/paid-session.js')
    vi.mocked(drivePaidSession).mockImplementation(actual.drivePaidSession)
    const created: string[] = [], phaseAtCreate: (string | undefined)[] = []
    vi.mocked(prepareRegisteredPaidSession).mockImplementation(async (_chain, _config, params, consent) => {
      const sessionId = keccak256(toHex(consent.certificate.execution_key)).slice(2)
      return {sessionId, paymentHash: paymentIntentHash(params.payment), initialization: {expires: params.operation.exp, key: consent.certificate.execution_key},
        create: vi.fn(async () => { created.push(sessionId); phaseAtCreate.push(await paidOperationPhase(f.store, prepaidRequestId(params.payment))) }),
        reconcile: vi.fn(async () => ({status: 'pending'})),
        requestObject: vi.fn(async () => { throw new Error('stopped after creation') }),
      } as unknown as RegisteredPaidAgentSession
    })
    return {created, phaseAtCreate}
  }

  it('is durable before the creation POST, and a failed creation keeps it for the resume', async () => {
    const f = setup(), d = await realDriver(f)
    const error = await paidOperation(f.config, f.request).catch((e: unknown) => e) as PaidOperationRecoveryError
    expect(error).toMatchObject({phase: 'session'})
    expect(d.phaseAtCreate).toEqual(['certified'])
    expect(await paidOperationPhase(f.store, error.requestId)).toBe('certified')
    await expect(resumePaidOperation(f.config, error.requestId, {holder: f.holder})).rejects.toMatchObject({phase: 'session'})
    // Resumed with the same consent: the same session, never created twice.
    expect(new Set(d.created).size).toBe(1)
    expect(d.created).toHaveLength(1)
    expect(createExecutionCertificate).toHaveBeenCalledTimes(1)
  })

  it('a crash that kept the creation record but not the consent: nothing was sent; the resume certifies anew under a new session and never repeats the old POST', async () => {
    const f = setup(), d = await realDriver(f), save = f.store.save.bind(f.store)
    let requestId: Hex | undefined
    // The commit's consent never reached the disk, its creation record did, and the process died:
    // nothing it does afterwards reaches the disk either.
    let dead = false
    f.store.save = async (key, value) => {
      if (dead || (value as {phase?: string}).phase === 'certified') return
      if (key.endsWith('-create')) { await save(key, value); dead = true; throw new Error('process died') }
      return save(key, value)
    }
    await expect(paidOperation(f.config, {...f.request, onRequestId: id => { requestId = id }})).rejects.toThrow()
    f.store.save = save
    expect(d.created).toEqual([])
    expect(await paidOperationPhase(f.store, requestId!)).toBe('reserved')
    await expect(resumePaidOperation(f.config, requestId!, {holder: f.holder})).rejects.toMatchObject({phase: 'session'})
    expect(createExecutionCertificate).toHaveBeenCalledTimes(2)
    expect(d.created).toHaveLength(1)
    const [first, second] = vi.mocked(prepareRegisteredPaidSession).mock.calls
    expect(second![3].certificate).not.toEqual(first![3].certificate)
    expect(await paidOperationPhase(f.store, requestId!)).toBe('certified')
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
  })

  it('a crash that kept the consent but not the creation record: the resume creates that same session once', async () => {
    const f = setup(), d = await realDriver(f), save = f.store.save.bind(f.store)
    let requestId: Hex | undefined
    let dead = false
    f.store.save = async (key, value) => {
      if (dead) return
      if (key.endsWith('-create')) { dead = true; throw new Error('process died') }
      return save(key, value)
    }
    await expect(paidOperation(f.config, {...f.request, onRequestId: id => { requestId = id }})).rejects.toThrow()
    f.store.save = save
    expect(d.created).toEqual([])
    expect(await paidOperationPhase(f.store, requestId!)).toBe('certified')
    await expect(resumePaidOperation(f.config, requestId!, {holder: f.holder})).rejects.toMatchObject({phase: 'session'})
    expect(createExecutionCertificate).toHaveBeenCalledTimes(1)
    expect(d.created).toHaveLength(1)
    const [first, second] = vi.mocked(prepareRegisteredPaidSession).mock.calls
    expect(second![3].certificate).toEqual(first![3].certificate)
  })
})

describe('revocation-status preflight', () => {
  // The keeper's rule, applied to the journaled grant before the `executing` checkpoint: a refusal
  // sends nothing, so the journal stays `authorized` and the keeper work never runs.
  it.each([
    ['missing', 'revocation_status_missing'],
    ['stale', 'revocation_status_stale'],
    ['forged', 'revocation_status_invalid'],
  ] as const)('refuses a %s grant before execution and leaves the journal authorized', async (mode, code) => {
    const f = setup()
    statusMode = mode
    const op = await paidOperation(f.config, f.request)
    expect(await paidOperationPhase(f.store, op.requestId)).toBe('authorized')
    const work = vi.fn(async () => 'signature')
    const error = await op.execute(work).catch((e: unknown) => e) as RevocationStatusPreflightError
    expect(error).toBeInstanceOf(RevocationStatusPreflightError)
    expect(error).not.toBeInstanceOf(PaidOperationRecoveryError)
    expect(error).toMatchObject({code, sent: false, presentAgain: true, retryable: false, requestId: op.requestId})
    expect(work).not.toHaveBeenCalled()
    expect(await paidOperationPhase(f.store, op.requestId)).toBe('authorized')
    // Nothing is retried, reserved or presented again automatically.
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
    expect(drivePaidSession).toHaveBeenCalledTimes(1)
    op.dispose()
  })

  it('accepts a missing list only under the explicit migration opt-out, never a stale or forged one', async () => {
    const f = setup()
    const config = {...f.config, allowMissingStatusAttestations: true}
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    statusMode = 'missing'
    const op = await paidOperation(config, f.request)
    expect(vi.mocked(prepareRegisteredPaidSession).mock.calls[0]![1]).toMatchObject({allowMissingStatusAttestations: true})
    expect(await op.execute(async () => 'signature')).toBe('signature')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('revocation_status_missing'))
    expect(await paidOperationPhase(f.store, op.requestId)).toBe('executed')
    for (const mode of ['stale', 'forged'] as const) {
      const g = setup()
      statusMode = mode
      const refused = await paidOperation({...g.config, allowMissingStatusAttestations: true}, g.request)
      const work = vi.fn(async () => 1)
      await expect(refused.execute(work)).rejects.toBeInstanceOf(RevocationStatusPreflightError)
      expect(work).not.toHaveBeenCalled()
      expect(await paidOperationPhase(g.store, refused.requestId)).toBe('authorized')
    }
    warn.mockRestore()
  })

  it('passes the default (required) setting to the session and surfaces its completion refusal typed, journal certified', async () => {
    const f = setup()
    vi.mocked(drivePaidSession).mockRejectedValueOnce(new RevocationStatusPreflightError({code: 'revocation_status_missing', message: 'missing'}))
    let requestId: Hex | undefined
    const error = await paidOperation(f.config, {...f.request, onRequestId: id => { requestId = id }}).catch((e: unknown) => e)
    expect(vi.mocked(prepareRegisteredPaidSession).mock.calls[0]![1]).toMatchObject({allowMissingStatusAttestations: false})
    expect(error).toBeInstanceOf(RevocationStatusPreflightError)
    expect(error).toMatchObject({code: 'revocation_status_missing', sent: false, requestId})
    expect(await paidOperationPhase(f.store, requestId!)).toBe('certified')
    expect(verifierAgentResult).not.toHaveBeenCalled()
  })
})

describe('explicit status refresh of a paid grant', () => {
  // `keykeeper/committee-status-refresh/v1`: same token, same payment, no new session or payment;
  // the seq is journaled before anything is sent and never reused; only `authorized` (or explicit
  // recovery of an uncertain execution) may refresh, and nothing here makes keeper work certain.
  interface Journal {
    phase: string; pollSecret: string; certificate: {execution_key: Hex}
    grant: {compound_token: CompoundTokenWire; sessionId?: string}
    statusRefresh?: {seq: number; original: unknown; refused?: {seq: number; at: number; reasons: unknown[]}
      attempts: {seq: number; via: string; principal: string; phase: string; outcome?: string; statusUntil?: number}[]}
  }
  interface Proof {kind: string; seq: number; issued_at: number; signature: string}
  const journalKey = (id: Hex) => `paid-op-${id.slice(2).toLowerCase()}`
  const journal = async (f: ReturnType<typeof setup>, id: Hex) => (await f.store.load<Journal>(journalKey(id)))!
  const encode = (body: unknown) => new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body))
  const tokenHashOf = (wire: CompoundTokenWire) => compoundTokenHash(decodeCompoundToken(wire))
  const attestation = (wire: CompoundTokenWire, until: number, index = drawnIndex, seed = verifierSeed) =>
    ({verifier_index: index, status_until: until, signature: toHex(ed25519.sign(statusAttestationHash(tokenHashOf(wire), index, until), seed))})
  /** A relay answer: the agent's `{token_hash, status_attestations}`, signed by the drawn verifier unless overridden. */
  const relayOk = (wire: CompoundTokenWire, until = Math.floor(Date.now() / 1000) + 30) =>
    ({status: 200, body: encode({token_hash: toHex(tokenHashOf(wire)), status_attestations: [attestation(wire, until)]})})
  /** Install a relay transport; every call records the proof and the seq the journal held at that moment. */
  function relay(f: ReturnType<typeof setup>, id: Hex, answer: (wire: CompoundTokenWire) => {status: number; body: Uint8Array; retryAfterMs?: number}) {
    const seen: {url: string; bearer?: string; proof: Proof; journaledSeq?: number}[] = []
    const paidAgentRequest = vi.fn(async (url: string, opts: {method: string; body?: Uint8Array; bearer?: string}) => {
      const {proof} = JSON.parse(new TextDecoder().decode(opts.body)) as {proof: Proof}
      const j = await journal(f, id)
      seen.push({url, bearer: opts.bearer, proof, journaledSeq: j.statusRefresh?.seq})
      return answer(j.grant.compound_token)
    })
    Object.assign(f.config.agent.transport, {paidAgentRequest})
    return {paidAgentRequest, seen}
  }

  it('refreshes a stale authorized grant only when asked, with the original execution key, then executes it once', async () => {
    const f = setup()
    statusMode = 'stale'
    const op = await paidOperation(f.config, f.request)
    const before = await journal(f, op.requestId)
    const {paidAgentRequest, seen} = relay(f, op.requestId, wire => relayOk(wire))
    // execute() never refreshes on its own.
    await expect(op.execute(vi.fn())).rejects.toBeInstanceOf(RevocationStatusPreflightError)
    expect(paidAgentRequest).not.toHaveBeenCalled()

    const out = await op.refreshStatus()
    expect(paidAgentRequest).toHaveBeenCalledTimes(1)
    expect(seen[0]).toMatchObject({url: `https://agent.example/v1/sessions/${'ab'.repeat(32)}/status-refresh`, bearer: before.pollSecret, journaledSeq: 1})
    expect(vi.mocked(paidAgentRequest).mock.calls[0]![1]).toMatchObject({method: 'POST'})
    const proof = seen[0]!.proof
    expect(proof).toMatchObject({kind: 'client_execution', seq: 1})
    const digest = statusRefreshHash({chainId: 43112, tokenHash: tokenHashOf(before.grant.compound_token), paymentHash: hexToBytes(paymentIntentHash(op.payment)),
      principal: 'client_execution', seq: 1, issuedAt: proof.issued_at})
    expect(ed25519.verify(hexToBytes(proof.signature as Hex), digest, hexToBytes(before.certificate.execution_key))).toBe(true)

    const after = await journal(f, op.requestId)
    expect(out).toMatchObject({requestId: op.requestId, seq: 1, refreshed: [drawnIndex], failures: []})
    expect(after.phase).toBe('authorized')
    expect(after.statusRefresh).toMatchObject({seq: 1, original: before.grant.compound_token.status_attestations,
      attempts: [{seq: 1, via: 'agent', principal: 'client_execution', phase: 'authorized', outcome: 'refreshed', statusUntil: out.statusUntil}]})
    expect(after.grant.compound_token.status_attestations).toEqual(out.compound_token.status_attestations)
    // Same token: signatures and every hashed field unchanged.
    expect(after.grant.compound_token.signatures).toEqual(before.grant.compound_token.signatures)
    expect(tokenHashOf(after.grant.compound_token)).toEqual(tokenHashOf(before.grant.compound_token))
    expect(op.compound_token.status_attestations).toEqual(out.compound_token.status_attestations)

    const work = vi.fn(async (o: {compound_token: CompoundTokenWire}) => o.compound_token)
    expect((await op.execute(work)).status_attestations).toEqual(out.compound_token.status_attestations)
    expect(work).toHaveBeenCalledTimes(1)
    expect(await paidOperationPhase(f.store, op.requestId)).toBe('executed')
    // No new reservation, session or payment.
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
    expect(drivePaidSession).toHaveBeenCalledTimes(1)
    expect(prepareRegisteredPaidSession).toHaveBeenCalledTimes(1)
    await expect(op.refreshStatus()).rejects.toThrow(/only before execution/)
    op.dispose()
  })

  it('journals the seq before sending and never reuses one across simulated crashes', async () => {
    const f = setup()
    const op = await paidOperation(f.config, f.request)
    let drop = false
    const {paidAgentRequest, seen} = relay(f, op.requestId, wire => {
      if (drop) { drop = false; throw new Error('connection reset') }
      return relayOk(wire)
    })
    // Crash 1: the process dies right after the seq is journaled; nothing was signed or sent.
    const save = f.store.save.bind(f.store)
    let die = true
    f.store.save = async (key: string, value: unknown) => {
      await save(key, value)
      if (die && (value as Journal).statusRefresh) { die = false; throw new Error('process died') }
    }
    await expect(op.refreshStatus()).rejects.toThrow('process died')
    expect(paidAgentRequest).not.toHaveBeenCalled()
    expect((await journal(f, op.requestId)).statusRefresh).toMatchObject({seq: 1, attempts: [{seq: 1}]})

    // Restart: a new handle from the journal. Crash 2: the reply is lost after sending.
    const resumed = await resumePaidOperation(f.config, op.requestId)
    drop = true
    const lost = await resumed.refreshStatus().catch((e: unknown) => e)
    expect(lost).toBeInstanceOf(StatusRefreshError)
    expect(lost).toMatchObject({code: 'status_refresh_unreachable', seq: 2, requestId: op.requestId, retryable: true})
    expect(await paidOperationPhase(f.store, op.requestId)).toBe('authorized')

    const ok = await resumed.refreshStatus()
    expect(ok.seq).toBe(3)
    expect(seen.map(s => [s.proof.seq, s.journaledSeq])).toEqual([[2, 2], [3, 3]])
    const j = await journal(f, op.requestId)
    expect(j.statusRefresh!.seq).toBe(3)
    expect(j.statusRefresh!.attempts.map(a => [a.seq, a.outcome])).toEqual([[1, undefined], [2, 'status_refresh_unreachable'], [3, 'refreshed']])
    // The first handle sees the refreshed grant too, and never repeats a seq.
    expect((await op.refreshStatus()).seq).toBe(4)
    resumed.dispose(); op.dispose()
  })

  it('refuses a refresh after the send; explicit recovery refreshes without making the execution certain', async () => {
    const f = setup()
    const op = await paidOperation(f.config, f.request)
    const {paidAgentRequest} = relay(f, op.requestId, wire => relayOk(wire))
    // A post-send keeper refusal (here a lost or 403 reply) leaves the execution uncertain.
    await expect(op.execute(async () => { throw new Error('keeper 403 revocation_status_stale') })).rejects.toMatchObject({code: 'execution-uncertain'})
    expect(await paidOperationPhase(f.store, op.requestId)).toBe('executing')
    await expect(op.refreshStatus()).rejects.toThrow(/only before execution/)
    expect(paidAgentRequest).not.toHaveBeenCalled()
    expect((await journal(f, op.requestId)).statusRefresh).toBeUndefined()

    const recovery = await recoverPaidOperation(f.config, op.requestId)
    await expect(recovery.refreshStatus({} as never)).rejects.toThrow(/explicitRecovery/)
    expect(paidAgentRequest).not.toHaveBeenCalled()
    const out = await recovery.refreshStatus({explicitRecovery: true})
    expect(out.seq).toBe(1)
    const j = await journal(f, op.requestId)
    expect(j.phase).toBe('executing')
    expect(j.statusRefresh!.attempts[0]).toMatchObject({phase: 'executing', outcome: 'refreshed'})
    // Still uncertain: never executable again, never "no work", only recovery reads.
    await expect(op.execute(vi.fn())).rejects.toBeInstanceOf(PaidOperationRecoveryError)
    expect(await reconcilePaidOperation(f.config, op.requestId)).toMatchObject({phase: 'executing', next: 'recover'})
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
    expect(drivePaidSession).toHaveBeenCalledTimes(1)
    recovery.dispose(); op.dispose()
  })

  it.each([
    [404, '{"error":"status_refresh_unknown"}', 'status_refresh_unknown'],
    [409, '{"error":"status_refresh_unavailable"}', 'status_refresh_unavailable'],
    [409, '{"error":"status_refresh_replayed"}', 'status_refresh_replayed'],
    [409, '{"error":"status_refresh_context_changed"}', 'status_refresh_context_changed'],
    [410, '{"error":"status_refresh_expired"}', 'status_refresh_expired'],
    [403, '{"error":"status_refresh_unauthenticated"}', 'status_refresh_unauthenticated'],
    [403, '{"error":"status_refresh_refused"}', 'status_refresh_refused'],
    [503, '{"error":"status_refresh_unavailable_status"}', 'status_refresh_unavailable_status'],
    [503, '{"error":"status_refresh_quorum_unmet"}', 'status_refresh_quorum_unmet'],
    [429, '{"error":"per-token interval"}', 'status_refresh_rate_limited'],
  ] as const)('surfaces HTTP %i %s as %s once, journaled, nothing retried or reopened', async (status, body, code) => {
    const f = setup()
    const op = await paidOperation(f.config, f.request)
    const before = await journal(f, op.requestId)
    const {paidAgentRequest} = relay(f, op.requestId, () => ({status, body: encode(body), ...(status === 429 ? {retryAfterMs: 5000} : {})}))
    const error = await op.refreshStatus().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(StatusRefreshError)
    expect(error).toMatchObject({code, httpStatus: status, requestId: op.requestId, seq: 1, ...(status === 429 ? {retryAfterMs: 5000, retryable: true} : {})})
    expect(paidAgentRequest).toHaveBeenCalledTimes(1)
    const j = await journal(f, op.requestId)
    expect(j.phase).toBe('authorized')
    expect(j.grant.compound_token).toEqual(before.grant.compound_token)
    expect(j.statusRefresh!.attempts).toMatchObject([{seq: 1, outcome: code}])
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
    expect(drivePaidSession).toHaveBeenCalledTimes(1)
    op.dispose()
  })

  it('a revocation refusal stops execute although the journaled attestations are still fresh; only a later success lifts it', async () => {
    const f = setup() // statusMode 'fresh': the journaled ORIGINAL attestations alone pass the keeper's rule
    const op = await paidOperation(f.config, f.request)
    const before = await journal(f, op.requestId)
    const now = Math.floor(Date.now() / 1000)
    expect(before.grant.compound_token.status_attestations!.every(a => a.status_until > now + 5)).toBe(true)
    let answer = (_wire: CompoundTokenWire) => ({status: 403,
      body: encode({error: 'status_refresh_refused', reasons: [{verifier_index: drawnIndex, code: 'status_refresh_refused'}]})})
    relay(f, op.requestId, wire => answer(wire))
    const error = await op.refreshStatus().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(StatusRefreshError)
    expect(error).toMatchObject({code: 'status_refresh_refused', seq: 1, retryable: false})
    // Journaled as a refusal; the grant (and its still-fresh attestations) is unchanged.
    const j = await journal(f, op.requestId)
    expect(j.grant.compound_token).toEqual(before.grant.compound_token)
    expect(j.statusRefresh).toMatchObject({seq: 1, refused: {seq: 1}, attempts: [{seq: 1, outcome: 'status_refresh_refused'}]})
    // execute() refuses it locally - typed, nothing sent, journal still `authorized`.
    const work = vi.fn(async () => 'ran')
    const refused = await op.execute(work).catch((e: unknown) => e)
    expect(refused).toBeInstanceOf(RevocationStatusPreflightError)
    expect(refused).toMatchObject({code: 'revocation_status_refused', sent: false, requestId: op.requestId})
    expect(work).not.toHaveBeenCalled()
    expect(await paidOperationPhase(f.store, op.requestId)).toBe('authorized')
    // Another handle (another process) honours the journaled mark too.
    const resumed = await resumePaidOperation(f.config, op.requestId)
    await expect(resumed.execute(work)).rejects.toMatchObject({code: 'revocation_status_refused'})
    expect(work).not.toHaveBeenCalled()
    // A failed later attempt keeps it.
    answer = () => { throw new Error('connection reset') }
    await expect(op.refreshStatus()).rejects.toMatchObject({code: 'status_refresh_unreachable', seq: 2})
    expect((await journal(f, op.requestId)).statusRefresh).toMatchObject({seq: 2, refused: {seq: 1}})
    await expect(op.execute(work)).rejects.toMatchObject({code: 'revocation_status_refused'})
    // A later successful refresh (no verifier refuses now) lifts the mark.
    answer = wire => relayOk(wire)
    expect((await op.refreshStatus()).seq).toBe(3)
    expect((await journal(f, op.requestId)).statusRefresh!).not.toHaveProperty('refused')
    expect(await op.execute(work)).toBe('ran')
    expect(work).toHaveBeenCalledTimes(1)
    resumed.dispose(); op.dispose()
  })

  it('never takes authority from an unsigned or forged relay answer, or from a signer outside the original token', async () => {
    const other = (drawnIndex + 1) % 3
    const answers: [string, (wire: CompoundTokenWire) => {status: number; body: Uint8Array}][] = [
      ['unsigned', wire => ({status: 200, body: encode({token_hash: toHex(tokenHashOf(wire)), status_attestations: [{verifier_index: drawnIndex, status_until: Math.floor(Date.now() / 1000) + 30}]})})],
      ['bare claim', wire => ({status: 200, body: encode({token_hash: toHex(tokenHashOf(wire)), fresh: true})})],
      ['forged', wire => ({status: 200, body: encode({token_hash: toHex(tokenHashOf(wire)),
        status_attestations: [attestation(wire, Math.floor(Date.now() / 1000) + 30, drawnIndex, new Uint8Array(32).fill(16))]})})],
      ['non-original signer', wire => ({status: 200, body: encode({token_hash: toHex(tokenHashOf(wire)),
        status_attestations: [attestation(wire, Math.floor(Date.now() / 1000) + 30, other, new Uint8Array(32).fill(16))]})})],
      ['past the token cap', wire => relayOk(wire, decodeCompoundToken(wire).exp as number)],
    ]
    for (const [label, answer] of answers) {
      const f = setup()
      statusMode = 'stale'
      const op = await paidOperation(f.config, f.request)
      const before = await journal(f, op.requestId)
      relay(f, op.requestId, answer)
      const error = await op.refreshStatus().catch((e: unknown) => e)
      expect(error, label).toBeInstanceOf(StatusRefreshError)
      expect((error as StatusRefreshError).code, label).toBe('status_refresh_invalid_response')
      expect((await journal(f, op.requestId)).grant.compound_token, label).toEqual(before.grant.compound_token)
      await expect(op.execute(vi.fn()), label).rejects.toBeInstanceOf(RevocationStatusPreflightError)
      op.dispose()
    }
  })

  it('proves with the recorded holder key on request, and refreshes directly at the original signers', async () => {
    const f = setup()
    const op = await paidOperation(f.config, f.request)
    const {seen} = relay(f, op.requestId, wire => relayOk(wire))
    const holder = p256HolderKey(new Uint8Array(32).fill(0x21))
    await op.refreshStatus({holder: statusRefreshHolderSigner(holder)})
    const proof = seen[0]!.proof
    expect(proof.kind).toBe('holder_key')
    const header = decodeJson<{typ: string; jwk: Jwk}>(proof.signature.split('.')[0]!)
    expect(header).toMatchObject({typ: 'keykeeper-status-refresh+jwt', jwk: holder.publicJwk})
    expect(verifyCompactJws<{refresh: string}>(proof.signature, header.jwk).payload.refresh).toMatch(/^0x[0-9a-f]{64}$/)
    expect((await journal(f, op.requestId)).statusRefresh!.attempts[0]).toMatchObject({principal: 'holder_key', outcome: 'refreshed'})

    const wire = (await journal(f, op.requestId)).grant.compound_token
    const until = Math.floor(Date.now() / 1000) + 40
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({token_hash: toHex(tokenHashOf(wire)), verifier_index: drawnIndex,
      status_until: until, status_signature: attestation(wire, until).signature}), {status: 200}))
    const other = (drawnIndex + 1) % 3
    const out = await op.refreshStatus({via: {verifiers: [{index: drawnIndex, url: 'https://v.example'}, {index: other, url: 'https://w.example'}], fetch: fetchImpl}})
    expect(out.seq).toBe(2)
    expect(fetchImpl).toHaveBeenCalledTimes(1) // the non-signer is never asked
    expect(String(fetchImpl.mock.calls[0]![0])).toBe('https://v.example/v1/committee/status-refresh')
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body))).toMatchObject({chain_id: 43112, token_hash: toHex(tokenHashOf(wire)), proof: {seq: 2, kind: 'client_execution'}})
    expect((await journal(f, op.requestId)).statusRefresh!.attempts[1]).toMatchObject({via: 'direct', outcome: 'refreshed'})
    op.dispose()
  })

  it('refuses the relay for a journal that predates recorded sessions without consuming a seq', async () => {
    const f = setup()
    const op = await paidOperation(f.config, f.request)
    const key = journalKey(op.requestId), j = await journal(f, op.requestId)
    await f.store.save(key, {...j, grant: {...j.grant, sessionId: undefined}})
    const {paidAgentRequest} = relay(f, op.requestId, wire => relayOk(wire))
    await expect(op.refreshStatus()).rejects.toThrow(/predates recorded agent sessions/)
    expect(paidAgentRequest).not.toHaveBeenCalled()
    expect((await journal(f, op.requestId)).statusRefresh).toBeUndefined()
    op.dispose()
  })
})

/** As discovery returns one during an anchor gap: the keeper sharing only, no verification fields at all. */
function undrawnOf(context: PaidOperationContext): UndrawnPaidOperationContext {
  const {verification_epoch: _e, verification_seed: _s, verification_root: _r, verification_registry_size: _n, verification_committee: _c, verification_quorum: _q, ...sharing} =
    drawnIntentFields(context)
  return {...context, undrawn: true, intentFields: sharing}
}

describe('paidOperation with ADR-0090 allowances (default off)', () => {
  const allowance = h(0x44)
  const enabled = (f: ReturnType<typeof setup>) => ({...f.config, allowances: {enabled: true, amount: 1_000n}})
  function lane() {
    vi.mocked(selectAllowanceLane).mockImplementation(async (_env, context) => ({lane: 1, allowanceId: allowance,
      fields: {...drawnIntentFields(context), verification_epoch: 6, verification_seed: h(46)}}))
    vi.mocked(obtainAllowanceVoucher).mockImplementation(async (_env, _ticket, payment) => ({allowance_id: allowance, seq: 3, request_id: prepaidRequestId(payment),
      cost: '40', cumulative: '120', quote_block: h(70), signature: h(5, 64)}))
  }

  it('stays on the per-operation reservation unless explicitly enabled', async () => {
    const f = setup()
    lane()
    await paidOperation(f.config, f.request)
    expect(selectAllowanceLane).not.toHaveBeenCalled()
    expect(obtainAllowanceVoucher).not.toHaveBeenCalled()
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
    expect(vi.mocked(discoverPaidOperationContext).mock.calls[0]![3]).toMatchObject({fundedByAllowance: false})
  })

  it('signs the allowance payment intent on a lane with room and is debited by voucher, never reserved', async () => {
    const f = setup()
    lane()
    const op = await paidOperation(enabled(f), f.request)
    expect(reserveApplicationPayment).not.toHaveBeenCalled()
    expect(vi.mocked(discoverPaidOperationContext).mock.calls[0]![3]).toMatchObject({fundedByAllowance: true})
    expect(op.payment).toMatchObject({allowance_id: allowance, verification_epoch: 6, verification_seed: h(46), debit_voucher: {seq: 3, request_id: op.requestId}})
    // The creator signed the distinct SlotAllowancePaymentIntent; the request ID binds the allowance.
    const {debit_voucher: _voucher, ...signed} = op.payment
    expect(paymentIntentTypedData(signed).primaryType).toBe('SlotAllowancePaymentIntent')
    expect(await recoverTypedDataAddress({...paymentIntentTypedData(signed), signature: op.payment.signature})).toBe(creator.address)
    expect(op.requestId).toBe(prepaidRequestId(signed))
    expect(vi.mocked(obtainAllowanceVoucher).mock.calls[0]![1]).toEqual({lane: 1})
    expect(vi.mocked(obtainAllowanceVoucher).mock.calls[0]![2].debit_voucher).toBeUndefined()
    // Execution consent reads the backing with the voucher attached.
    expect(vi.mocked(readClientExecutionPolicy).mock.calls[0]![2].debit_voucher).toMatchObject({seq: 3})
    expect(await f.store.load(`paid-op-${op.requestId.slice(2)}`)).toMatchObject({phase: 'authorized', allowance: {lane: 1}})
    op.dispose()
  })

  it('during an anchor gap a lane that serves the operation pays at once: one undrawn discovery, the allowance\'s draw, no anchor wait', async () => {
    const f = setup()
    lane()
    const base = await discoverPaidOperationContext(undefined as never, undefined as never, slot)
    const undrawn = undrawnOf(base)
    vi.mocked(discoverPaidOperationContext).mockClear()
    vi.mocked(discoverPaidOperationContext).mockResolvedValueOnce(undrawn)
    // The ticket carries the ALLOWANCE's draw (fieldsFor copies it from the allowance intent).
    vi.mocked(selectAllowanceLane).mockImplementation(async () => ({lane: 1, allowanceId: allowance,
      fields: {...base.intentFields, verification_epoch: 6, verification_seed: h(46)}}))
    const op = await paidOperation(enabled(f), f.request)
    // Asked for an undrawn answer during a gap, discovered ONCE: it waited for no anchors.
    expect(vi.mocked(discoverPaidOperationContext)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(discoverPaidOperationContext).mock.calls[0]![3]).toMatchObject({fundedByAllowance: true, undrawnDuringAnchorGap: true})
    expect(vi.mocked(selectAllowanceLane).mock.calls[0]![1].undrawn).toBe(true)
    expect(op.payment).toMatchObject({allowance_id: allowance, verification_epoch: 6, verification_seed: h(46)})
    expect(reserveApplicationPayment).not.toHaveBeenCalled()
    op.dispose()
  })

  it('during an anchor gap with no serving lane, discovers the draw (waiting for its anchors) and never pays from the undrawn context', async () => {
    const f = setup()
    const base = await discoverPaidOperationContext(undefined as never, undefined as never, slot)
    vi.mocked(discoverPaidOperationContext).mockClear()
    vi.mocked(discoverPaidOperationContext).mockResolvedValueOnce(undrawnOf(base))
    vi.mocked(selectAllowanceLane).mockResolvedValue(undefined)
    const op = await paidOperation(enabled(f), f.request)
    const calls = vi.mocked(discoverPaidOperationContext).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[1]![3]).not.toHaveProperty('undrawnDuringAnchorGap')
    // Selected again on the drawn context, then paid per operation at THAT draw.
    expect(vi.mocked(selectAllowanceLane).mock.calls.map(c => c[1].undrawn)).toEqual([true, undefined])
    expect(op.payment).toMatchObject({verification_epoch: 7, verification_seed: h(41), verification_root: h(42)})
    expect(op.payment.allowance_id).toBeUndefined()
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
    op.dispose()
  })

  it('falls back to a per-operation reservation when no lane has room', async () => {
    const f = setup()
    vi.mocked(selectAllowanceLane).mockResolvedValue(undefined)
    const op = await paidOperation(enabled(f), f.request)
    expect(op.payment.allowance_id).toBeUndefined()
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
    expect(obtainAllowanceVoucher).not.toHaveBeenCalled()
    op.dispose()
  })

  it('a refused debit is journaled failed and the operation falls back once to a fresh per-operation payment', async () => {
    const f = setup()
    lane()
    vi.mocked(obtainAllowanceVoucher).mockRejectedValueOnce(new AllowanceRefusedError('the accountants refused the debit'))
    const ids: Hex[] = []
    const op = await paidOperation(enabled(f), {...f.request, onRequestId: id => { ids.push(id) }})
    expect(ids).toHaveLength(2)
    expect(op.requestId).toBe(ids[1])
    expect(op.payment.allowance_id).toBeUndefined()
    expect(await paidOperationPhase(f.store, ids[0]!)).toBe('failed')
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
    expect(selectAllowanceLane).toHaveBeenCalledTimes(1)
    await expect(resumePaidOperation(enabled(f), ids[0]!)).rejects.toMatchObject({code: 'reservation-failed'})
    op.dispose()
  })

  it('unreachable accountants leave the debit resumable; resume asks for the SAME payment and continues', async () => {
    const f = setup()
    lane()
    vi.mocked(obtainAllowanceVoucher).mockRejectedValueOnce(new AllowanceUnavailableError('accountants unavailable'))
    const error = await paidOperation(enabled(f), f.request).catch((e: unknown) => e) as PaidOperationRecoveryError
    expect(error).toBeInstanceOf(PaidOperationRecoveryError)
    expect(error).toMatchObject({code: 'reservation-refused', resumable: true, phase: 'reservation'})
    expect(reserveApplicationPayment).not.toHaveBeenCalled()
    expect(await reconcilePaidOperation(enabled(f), error.requestId)).toMatchObject({phase: 'reserving', next: 'reserve'})
    const op = await resumePaidOperation(enabled(f), error.requestId, {holder: f.holder})
    const [first, second] = vi.mocked(obtainAllowanceVoucher).mock.calls
    expect(second![2]).toEqual(first![2])
    expect(op.requestId).toBe(error.requestId)
    expect(op.payment.debit_voucher).toMatchObject({request_id: error.requestId})
    expect(reconcileApplicationReservation).not.toHaveBeenCalled()
    expect(reserveApplicationPayment).not.toHaveBeenCalled()
    op.dispose()
  })
})

describe('paidFinalSign: a final dual-control Sign paid without any presentation', () => {
  const allowance = h(0x45), message = new TextEncoder().encode('dual final')
  const enabled = (f: ReturnType<typeof setup>) => ({...f.config, allowances: {enabled: true, amount: 1_000n}})
  function lane() {
    vi.mocked(selectAllowanceLane).mockImplementation(async (_env, context) => ({lane: 2, allowanceId: allowance, fields: drawnIntentFields(context)}))
    vi.mocked(obtainAllowanceVoucher).mockImplementation(async (_env, _ticket, payment) => ({allowance_id: allowance, seq: 1, request_id: prepaidRequestId(payment),
      cost: '40', cumulative: '40', quote_block: h(70), signature: h(5, 64)}))
  }

  it('debits the final Sign from an allowance lane, certifies it and never opens a session or presentation', async () => {
    const f = setup()
    lane()
    const paid = await paidFinalSign(enabled(f), {slot, message})
    expect(reserveApplicationPayment).not.toHaveBeenCalled()
    expect(fetchDrawnVerifierWitnesses).not.toHaveBeenCalled()
    expect(prepareRegisteredPaidSession).not.toHaveBeenCalled()
    expect(drivePaidSession).not.toHaveBeenCalled()
    expect(f.holder.makePresentation).not.toHaveBeenCalled()
    expect(vi.mocked(selectAllowanceLane).mock.calls[0]![2]).toMatchObject({action: 'sign'})
    expect(paid.payment).toMatchObject({action: 'sign', allowance_id: allowance, payload_digest: toHex(sha256(message)), debit_voucher: {seq: 1, request_id: paid.requestId}})
    const {debit_voucher: _voucher, ...signed} = paid.payment
    expect(await recoverTypedDataAddress({...paymentIntentTypedData(signed), signature: paid.payment.signature})).toBe(creator.address)
    expect(createExecutionCertificate).toHaveBeenCalledTimes(1)
    expect(paid.coordinatorUrl).toBe(coordinator.url)
    expect(typeof paid.approveExecution).toBe('function')
    expect(await f.store.load(`paid-op-${paid.requestId.slice(2)}`)).toMatchObject({phase: 'certified', finalSign: true, allowance: {lane: 2}})
    // A final Sign has no session to resume through paidOperation's path.
    await expect(resumePaidOperation(enabled(f), paid.requestId, {holder: f.holder})).rejects.toThrow(/no session/)
    paid.dispose()
  })

  it('falls back to a per-operation reservation when no lane has room, like paidOperation', async () => {
    const f = setup()
    vi.mocked(selectAllowanceLane).mockResolvedValue(undefined)
    const paid = await paidFinalSign(enabled(f), {slot, message})
    expect(paid.payment.allowance_id).toBeUndefined()
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
    expect(obtainAllowanceVoucher).not.toHaveBeenCalled()
    paid.dispose()
  })

  it('an interrupted debit resumes the SAME payment, never a second one', async () => {
    const f = setup()
    lane()
    vi.mocked(obtainAllowanceVoucher).mockRejectedValueOnce(new AllowanceUnavailableError('accountants unavailable'))
    const error = await paidFinalSign(enabled(f), {slot, message}).catch((e: unknown) => e) as PaidOperationRecoveryError
    expect(error).toMatchObject({code: 'reservation-refused', resumable: true})
    const paid = await resumePaidFinalSign(enabled(f), error.requestId)
    const [first, second] = vi.mocked(obtainAllowanceVoucher).mock.calls
    expect(second![2]).toEqual(first![2])
    expect(paid.requestId).toBe(error.requestId)
    expect(reserveApplicationPayment).not.toHaveBeenCalled()
    paid.dispose()
  })

  it('refuses a non-FROST slot and a slot it is not the creator of, before any payment', async () => {
    const f = setup()
    lane()
    const resolved = await discoverPaidOperationContext(undefined as never, undefined as never, slot)
    vi.mocked(discoverPaidOperationContext).mockResolvedValueOnce({...resolved, mode: 2})
    await expect(paidFinalSign(enabled(f), {slot, message})).rejects.toThrow(/FROST/)
    const g = setup({creator: h(77, 20)})
    await expect(paidFinalSign(enabled(g), {slot, message})).rejects.toThrow(/creator/)
    await expect(paidFinalSign(enabled(g), {slot, message: new Uint8Array(0)})).rejects.toThrow(/message/)
    expect(obtainAllowanceVoucher).not.toHaveBeenCalled()
    expect(reserveApplicationPayment).not.toHaveBeenCalled()
  })
})

describe('paidSessionDecrypt: one session-grant KEM decrypt paid without any presentation (ADR-0090 D7)', () => {
  const allowance = h(0x46)
  const enabled = (f: ReturnType<typeof setup>) => ({...f.config, allowances: {enabled: true, amount: 1_000n}})
  function lane() {
    vi.mocked(selectAllowanceLane).mockImplementation(async (_env, context) => ({lane: 3, allowanceId: allowance, fields: drawnIntentFields(context)}))
    vi.mocked(obtainAllowanceVoucher).mockImplementation(async (_env, _ticket, payment) => ({allowance_id: allowance, seq: 1, request_id: prepaidRequestId(payment),
      cost: '40', cumulative: '40', quote_block: h(70), signature: h(5, 64)}))
  }
  async function blsSlot() {
    const resolved = await discoverPaidOperationContext(undefined as never, undefined as never, slot)
    vi.mocked(discoverPaidOperationContext).mockResolvedValue({...resolved, mode: 1})
  }
  async function binding() {
    const recipient = await createDecryptionRecipient()
    return decryptionBinding(sha256(new TextEncoder().encode('one chat message')), 0, recipient)
  }

  it('debits the decrypt from an allowance lane bound to this ciphertext and recipient, and never presents', async () => {
    const f = setup()
    lane(); await blsSlot()
    const b = await binding()
    const paid = await paidSessionDecrypt(enabled(f), {slot, decryption: b.decryption})
    expect(fetchDrawnVerifierWitnesses).not.toHaveBeenCalled()
    expect(prepareRegisteredPaidSession).not.toHaveBeenCalled()
    expect(drivePaidSession).not.toHaveBeenCalled()
    expect(f.holder.makePresentation).not.toHaveBeenCalled()
    expect(reserveApplicationPayment).not.toHaveBeenCalled()
    expect(vi.mocked(selectAllowanceLane).mock.calls[0]![2]).toMatchObject({action: 'decrypt'})
    expect(paid.payment).toMatchObject({action: 'decrypt', allowance_id: allowance, payload_digest: toHex(b.payloadDigest), debit_voucher: {seq: 1, request_id: paid.requestId}})
    expect(await f.store.load(`paid-op-${paid.requestId.slice(2)}`)).toMatchObject({phase: 'certified', sessionDecrypt: true, allowance: {lane: 3}})
    // Neither the presentation path nor the final Sign path resumes a session-grant decrypt.
    await expect(resumePaidOperation(enabled(f), paid.requestId, {holder: f.holder})).rejects.toThrow(/no presentation/)
    await expect(resumePaidFinalSign(enabled(f), paid.requestId)).rejects.toThrow(/No final Sign journal/)
    paid.dispose()
  })

  it('an interrupted debit resumes the SAME payment; a missing lane falls back to a per-operation reservation', async () => {
    const f = setup()
    lane(); await blsSlot()
    const b = await binding()
    vi.mocked(obtainAllowanceVoucher).mockRejectedValueOnce(new AllowanceUnavailableError('accountants unavailable'))
    const error = await paidSessionDecrypt(enabled(f), {slot, decryption: b.decryption}).catch((e: unknown) => e) as PaidOperationRecoveryError
    expect(error).toMatchObject({code: 'reservation-refused', resumable: true})
    const paid = await resumePaidSessionDecrypt(enabled(f), error.requestId)
    const [first, second] = vi.mocked(obtainAllowanceVoucher).mock.calls
    expect(second![2]).toEqual(first![2])
    expect(paid.requestId).toBe(error.requestId)
    paid.dispose()
    const g = setup()
    await blsSlot()
    vi.mocked(selectAllowanceLane).mockResolvedValue(undefined)
    const fallback = await paidSessionDecrypt(enabled(g), {slot, decryption: (await binding()).decryption})
    expect(fallback.payment.allowance_id).toBeUndefined()
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
    fallback.dispose()
  })

  it('refuses a FROST slot, a missing recipient binding and a foreign creator before any payment', async () => {
    const f = setup()
    lane()
    const b = await binding()
    await expect(paidSessionDecrypt(enabled(f), {slot, decryption: b.decryption})).rejects.toThrow(/BLS slot/)
    await expect(paidSessionDecrypt(enabled(f), {slot, decryption: {...b.decryption, content_digest: undefined}})).rejects.toThrow(/recipient binding/)
    await blsSlot()
    await expect(paidSessionDecrypt(enabled(setup({creator: h(77, 20)})), {slot, decryption: b.decryption})).rejects.toThrow(/creator/)
    expect(obtainAllowanceVoucher).not.toHaveBeenCalled()
    expect(reserveApplicationPayment).not.toHaveBeenCalled()
  })

  it('pays the GRANT\'s draw: discovery is pinned to its epoch, only a lane on that draw funds it, and the beacon epoch comes back', async () => {
    const f = setup()
    lane(); await blsSlot()
    const base = await discoverPaidOperationContext(undefined as never, undefined as never, slot)
    vi.mocked(discoverPaidOperationContext).mockResolvedValue({...base, mode: 1, beaconEpoch: 8n})
    const b = await binding()
    const grant = {epoch: base.intentFields.verification_epoch, seed: base.intentFields.verification_seed}
    const paid = await paidSessionDecrypt(enabled(f), {slot, decryption: b.decryption, grant})
    const discovery = vi.mocked(discoverPaidOperationContext).mock.calls.at(-1)!
    expect(discovery[3]).toMatchObject({verificationEpoch: BigInt(grant.epoch)})
    expect(vi.mocked(selectAllowanceLane).mock.calls.at(-1)![2]).toMatchObject({action: 'decrypt', drawPinned: true})
    expect(paid.payment).toMatchObject({verification_epoch: grant.epoch, verification_seed: grant.seed})
    expect(paid.beaconEpoch).toBe(8n)
    paid.dispose()
    // Without a grant the payment takes the fresh draw, unpinned (the earlier behaviour).
    const unpinned = await paidSessionDecrypt(enabled(f), {slot, decryption: (await binding()).decryption})
    expect(vi.mocked(discoverPaidOperationContext).mock.calls.at(-1)![3]).not.toHaveProperty('verificationEpoch')
    expect(vi.mocked(selectAllowanceLane).mock.calls.at(-1)![2]).toMatchObject({drawPinned: false})
    unpinned.dispose()
  })

  it('hands the lanes a reserve-ahead discovery of the next draw that is pinned and verified like a message\'s own', async () => {
    const f = setup()
    lane(); await blsSlot()
    const base = await discoverPaidOperationContext(undefined as never, undefined as never, slot)
    const paid = await paidSessionDecrypt(enabled(f), {slot, decryption: (await binding()).decryption,
      grant: {epoch: base.intentFields.verification_epoch, seed: base.intentFields.verification_seed}})
    const env = vi.mocked(selectAllowanceLane).mock.calls.at(-1)![0]
    expect(env.discover).toBeTypeOf('function')
    await env.discover!(slot, 9n)
    const discovery = vi.mocked(discoverPaidOperationContext).mock.calls.at(-1)!
    expect(discovery[2]).toBe(slot)
    expect(discovery[3]).toMatchObject({verificationEpoch: 9n, fundedByAllowance: true})
    paid.dispose()
  })

  it('refuses a grant whose seed is not the beacon\'s, and a moved draw, before anything is signed or debited', async () => {
    const f = setup()
    lane(); await blsSlot()
    const base = await discoverPaidOperationContext(undefined as never, undefined as never, slot)
    const b = await binding()
    await expect(paidSessionDecrypt(enabled(f), {slot, decryption: b.decryption, grant: {epoch: base.intentFields.verification_epoch, seed: h(0x99)}}))
      .rejects.toThrow(/seed the beacon does not hold/)
    await expect(paidSessionDecrypt(enabled(f), {slot, decryption: b.decryption, grant: {epoch: -1, seed: h(0x99)}})).rejects.toThrow(/Invalid session grant draw/)
    vi.mocked(discoverPaidOperationContext).mockRejectedValueOnce(new PaidDrawMovedError(5n, 7n))
    await expect(paidSessionDecrypt(enabled(f), {slot, decryption: b.decryption, grant: {epoch: 5, seed: h(0x99)}})).rejects.toMatchObject({code: 'draw-moved'})
    expect(obtainAllowanceVoucher).not.toHaveBeenCalled()
    expect(reserveApplicationPayment).not.toHaveBeenCalled()
  })

  it('a per-operation reservation whose payer freed up two epochs past the grant is refused UNSENT: NewerVerifierEpoch, journal failed, nothing reserved', async () => {
    const f = setup()
    await blsSlot()
    vi.mocked(selectAllowanceLane).mockResolvedValue(undefined)
    vi.mocked(readCurrentBeaconEpoch).mockResolvedValue(9n)
    const ids: Hex[] = []
    const error = await paidSessionDecrypt(enabled(f), {slot, decryption: (await binding()).decryption, onRequestId: id => { ids.push(id) }}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(NewerVerifierEpoch)
    expect(error).toMatchObject({code: 'newer-verifier-epoch', requestId: ids[0], beaconEpoch: 9n})
    // Once only, and never past the first prepare: no reservation was attempted, none was journaled.
    expect(ids).toHaveLength(1)
    expect(reserveApplicationPayment).not.toHaveBeenCalled()
    expect(await paidOperationPhase(f.store, ids[0]!)).toBe('failed')
    await expect(resumePaidSessionDecrypt(enabled(f), ids[0]!)).rejects.toThrow(/failed, not payable/)
    expect(reserveApplicationPayment).not.toHaveBeenCalled()
  })

  it('funds a session-grant OPENING only from a lane on the fresh draw (verifiers judge the grant at the live beacon)', async () => {
    const f = setup()
    const base = await discoverPaidOperationContext(undefined as never, undefined as never, slot)
    vi.mocked(discoverPaidOperationContext).mockResolvedValue({...base, mode: 1})
    vi.mocked(selectAllowanceLane).mockResolvedValue(undefined)
    const key = await createSessionKey({alg: 'Ed25519'})
    const fragment = sessionGrantCreateFragment(key, {slots: [slot]})
    const recipient = await createDecryptionRecipient()
    const b = decryptionBinding(sha256(new TextEncoder().encode('first message')), 0, recipient)
    vi.mocked(drivePaidSession).mockResolvedValue({status: 'done', phase: 'done', sessionGrant: {error: 'session_context_changed'}} as Awaited<ReturnType<typeof drivePaidSession>>)
    const op = await paidOperation(enabled(f), {...f.request, operation: {action: 'decrypt', decryption: b.decryption}, sessionGrant: fragment})
    expect(vi.mocked(selectAllowanceLane).mock.calls.at(-1)![2]).toMatchObject({action: 'decrypt', drawPinned: true})
    op.dispose()
    const plain = await paidOperation(enabled(setup()), {...f.request, operation: {action: 'decrypt', decryption: b.decryption}})
    expect(vi.mocked(selectAllowanceLane).mock.calls.at(-1)![2]).toMatchObject({drawPinned: false})
    plain.dispose()
  })
})

describe('paidOperation: session-grant presentation (ADR-0090 D7)', () => {
  it('journals the public create fragment, passes it to the session, and exposes the verified grant', async () => {
    const f = setup()
    const base = await discoverPaidOperationContext(undefined as never, undefined as never, slot)
    vi.mocked(discoverPaidOperationContext).mockResolvedValue({...base, mode: 1})
    const key = await createSessionKey({alg: 'Ed25519'})
    const fragment = sessionGrantCreateFragment(key, {slots: [slot]})
    const recipient = await createDecryptionRecipient()
    const b = decryptionBinding(sha256(new TextEncoder().encode('first message')), 0, recipient)
    const outcome = {grant: {session_grant: {stand_in: 'verified grant'} as never, refresh_seq: 0 as const}}
    vi.mocked(drivePaidSession).mockResolvedValue({status: 'done', phase: 'done', sessionGrant: outcome} as Awaited<ReturnType<typeof drivePaidSession>>)
    const op = await paidOperation(f.config, {...f.request, operation: {action: 'decrypt', decryption: b.decryption}, sessionGrant: fragment})
    expect(vi.mocked(prepareRegisteredPaidSession).mock.calls[0]![2].sessionGrant).toEqual(fragment.session_grant)
    expect(op.sessionGrant).toEqual(outcome)
    const journal = await f.store.load<{params: {sessionGrant?: unknown}; grant: {sessionGrant?: unknown}}>(`paid-op-${op.requestId.slice(2)}`)
    expect(journal?.params.sessionGrant).toEqual(fragment.session_grant)
    expect(JSON.stringify(journal)).not.toMatch(/"d":/)
    expect(journal?.grant.sessionGrant).toEqual(outcome)
    op.dispose()
    // A sign presentation cannot open a session, refused before anything is paid.
    vi.mocked(reserveApplicationPayment).mockClear()
    await expect(paidOperation(f.config, {...f.request, sessionGrant: fragment})).rejects.toThrow(/KEM decrypt/)
    expect(reserveApplicationPayment).not.toHaveBeenCalled()
  })
})

describe('paid OAuth holder through paidOperation', () => {
  const oauthRule = JSON.stringify({credentials: [{id: 'kc', format: 'oauth+access-token+dpop', claims: [{path: ['iss'], values: ['https://idp.example']}]}]})
  const oauthHolder = {kind: 'oauth' as const, credential: vi.fn()}

  it('propagates OAuth mode to the session it prepares and journals it with the operation', async () => {
    const f = setup({ruleCommitment: ruleCommitment(salt, oauthRule)})
    const ids: Hex[] = []
    await paidOperation(f.config, {...f.request, rule: {rule: oauthRule, salt}, holder: oauthHolder, onRequestId: id => { ids.push(id) }})
    expect(vi.mocked(prepareRegisteredPaidSession).mock.calls[0]![2]).toMatchObject({kind: 'oauth'})
    expect(vi.mocked(drivePaidSession).mock.calls[0]![0].holder).toBe(oauthHolder)
    expect((await f.store.load<{params: {kind?: string}}>(paidRecordKey(ids[0]!)))?.params.kind).toBe('oauth')
  })

  it('a resume must use the journaled holder family; a wallet holder cannot resume an OAuth session (and vice versa)', async () => {
    for (const [journaled, resumedWith] of [['oauth', 'local'], ['local', 'oauth']] as const) {
      const f = setup(journaled === 'oauth' ? {ruleCommitment: ruleCommitment(salt, oauthRule)} : {})
      const ids: Hex[] = []
      vi.mocked(drivePaidSession).mockRejectedValueOnce(new PaidSessionRecoveryError('k', 'unknown outcome'))
      await expect(paidOperation(f.config, {...f.request, ...(journaled === 'oauth' ? {rule: {rule: oauthRule, salt}, holder: oauthHolder} : {}),
        onRequestId: id => { ids.push(id) }})).rejects.toBeInstanceOf(PaidOperationRecoveryError)
      vi.mocked(prepareRegisteredPaidSession).mockClear()
      await expect(resumePaidOperation(f.config, ids[0]!, {holder: resumedWith === 'oauth' ? oauthHolder : f.holder}))
        .rejects.toThrow(journaled === 'oauth' ? 'journaled with an OAuth holder' : 'journaled with a wallet holder')
      expect(prepareRegisteredPaidSession).not.toHaveBeenCalled()
      // The matching holder resumes the original session (same params, same kind).
      await resumePaidOperation(f.config, ids[0]!, {holder: journaled === 'oauth' ? oauthHolder : f.holder})
      const params = vi.mocked(prepareRegisteredPaidSession).mock.calls[0]![2]
      expect(params.kind).toBe(journaled === 'oauth' ? 'oauth' : undefined)
    }
  })

  it.each(['OAuth holder on a wallet rule', 'wallet holder on an OAuth rule'] as const)('refuses an %s before anything is signed or reserved', async name => {
    const oauthOnWallet = name === 'OAuth holder on a wallet rule'
    const f = setup(oauthOnWallet ? {} : {ruleCommitment: ruleCommitment(salt, oauthRule)})
    const sign = vi.spyOn(f.config.creator, 'signTypedData')
    await expect(paidOperation(f.config, {...f.request, ...(oauthOnWallet ? {holder: oauthHolder} : {rule: {rule: oauthRule, salt}})}))
      .rejects.toThrow(oauthOnWallet ? 'An OAuth holder needs an OAuth' : 'An OAuth slot rule needs an OAuth holder')
    expect(sign).not.toHaveBeenCalled()
    expect(reserveApplicationPayment).not.toHaveBeenCalled()
    sign.mockRestore()
  })
  it.each([
    ['a rule mixing OAuth and wallet formats', JSON.stringify({credentials: [{id: 'w', format: 'dc+sd-jwt', claims: [{path: ['iss'], values: ['did:web:issuer.example']}]},
      {id: 'kc', format: 'oauth+access-token+dpop', claims: [{path: ['iss'], values: ['https://idp.example']}]}]}), 'oauth', 'Slot rule mixes OAuth and wallet credential formats'],
    ['the same mix under a wallet holder', JSON.stringify({credentials: [{id: 'kc', format: 'oauth+access-token+dpop', claims: [{path: ['iss'], values: ['https://idp.example']}]},
      {id: 'w', format: 'dc+sd-jwt', claims: [{path: ['iss'], values: ['did:web:issuer.example']}]}]}), 'local', 'Slot rule mixes OAuth and wallet credential formats'],
    ['an OAuth holder on a rule with no credential queries', JSON.stringify({credentials: []}), 'oauth', 'An OAuth holder needs an OAuth'],
    ['a wallet holder on a kk_oauth envelope', JSON.stringify({kk_oauth: {v: 1, tokens: {kc: {iss: 'https://idp.example'}},
      policy: {lang: 'rego/v1', entrypoint: 'data.tasra.slot.allow', source: 'package tasra.slot\n\ndefault allow := false\n'}}}), 'local', 'An OAuth slot rule needs an OAuth holder'],
  ] as const)('refuses %s before anything is signed, journaled or reserved', async (_name, slotRule, holderKind, message) => {
    const f = setup({ruleCommitment: ruleCommitment(salt, slotRule)})
    const sign = vi.spyOn(f.config.creator, 'signTypedData')
    await expect(paidOperation(f.config, {...f.request, rule: {rule: slotRule, salt}, ...(holderKind === 'oauth' ? {holder: oauthHolder} : {})})).rejects.toThrow(message)
    expect(sign).not.toHaveBeenCalled()
    expect(reserveApplicationPayment).not.toHaveBeenCalled()
    expect(await listPaidOperations(f.store)).toEqual([])
    sign.mockRestore()
  })
})

describe('a journal is served only under its own request id', () => {
  // A journal copied (or restored) under another request's key never continues that request: its
  // payment hashes to a different id, and every resume entry point refuses it before any work.
  async function copied(extra: Record<string, unknown>) {
    const f = setup(), ids: Hex[] = []
    await paidOperation(f.config, {...f.request, onRequestId: id => { ids.push(id) }})
    const original = await f.store.load<Record<string, unknown>>(paidRecordKey(ids[0]!))
    const foreign = h(0x7e)
    await f.store.save(paidRecordKey(foreign), {...original, phase: 'certified', ...extra})
    vi.mocked(readClientExecutionPolicy).mockClear(); vi.mocked(createExecutionCertificate).mockClear()
    return {f, foreign}
  }
  it('reconcile and resume refuse a journal whose payment names another request', async () => {
    const {f, foreign} = await copied({})
    await expect(reconcilePaidOperation(f.config, foreign)).rejects.toThrow('Paid operation journal does not match its request')
    await expect(resumePaidOperation(f.config, foreign)).rejects.toThrow('Paid operation journal does not match its request')
    expect(reserveApplicationPayment).toHaveBeenCalledTimes(1)
  })
  it('a final Sign resume refuses another request\'s journal, and a journal that is not a final Sign', async () => {
    const {f, foreign} = await copied({finalSign: true})
    await expect(resumePaidFinalSign(f.config, foreign)).rejects.toThrow('No final Sign journal for this request')
    await expect(resumePaidFinalSign(f.config, h(0x7f))).rejects.toThrow('No final Sign journal for this request')
    expect(readClientExecutionPolicy).not.toHaveBeenCalled()
  })
  it('a session-grant decrypt resume refuses another request\'s journal, and a journal that is not one', async () => {
    const {f, foreign} = await copied({sessionDecrypt: true})
    await expect(resumePaidSessionDecrypt(f.config, foreign)).rejects.toThrow('No session-grant decrypt journal for this request')
    await expect(resumePaidSessionDecrypt(f.config, h(0x7f))).rejects.toThrow('No session-grant decrypt journal for this request')
    expect(readClientExecutionPolicy).not.toHaveBeenCalled()
    expect(createExecutionCertificate).not.toHaveBeenCalled()
  })
})
