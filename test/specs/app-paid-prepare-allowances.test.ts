// prepareAllowances (ADR-0090): a slot's allowance lanes opened BEFORE its first paid operation,
// through the journaled lane reservation, so the first operation on each lane reserves nothing.
// Chain reads, accountants, the agent and the keepers are fakes (as in app-paid-flush-budget);
// the lane journal, the payer claim and the operation journal are the real code on a memory store.
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {defineChain, hexToBytes, toHex, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {ed25519} from '@noble/curves/ed25519'

vi.mock('../../src/chain/billing.js', async original => ({...await original<typeof import('../../src/chain/billing.js')>(), requirePrepaidSlot: vi.fn()}))
vi.mock('../../src/chain/prepaid.js', async original => ({...await original<typeof import('../../src/chain/prepaid.js')>(),
  discoverPaidOperationContext: vi.fn(), readClientExecutionPolicy: vi.fn(), readCurrentBeaconEpoch: vi.fn()}))
vi.mock('../../src/chain/verifierSnapshot.js', () => ({fetchDrawnVerifierWitnesses: vi.fn()}))
vi.mock('../../src/chain/registeredPaidAgent.js', async original => ({...await original<typeof import('../../src/chain/registeredPaidAgent.js')>(), prepareRegisteredPaidSession: vi.fn()}))
vi.mock('../../src/oid4vp/verifier-agent.js', async original => ({...await original<typeof import('../../src/oid4vp/verifier-agent.js')>(), verifierAgentResult: vi.fn()}))
vi.mock('../../src/committee/execution.js', async original => ({...await original<typeof import('../../src/committee/execution.js')>(), createExecutionCertificate: vi.fn()}))
vi.mock('../../src/chain/keeperExecution.js', () => ({createKeeperExecutionApprover: vi.fn(() => vi.fn())}))
vi.mock('../../src/chain/allowance.js', async original => ({...await original<typeof import('../../src/chain/allowance.js')>(),
  collectDebitVoucher: vi.fn(), reservePrepaidAllowance: vi.fn(), reconcilePrepaidAllowance: vi.fn(), pushDebitVoucher: vi.fn(async () => [])}))

import {paidOperation, prepareAllowances, type PaidOperationConfig} from '../../src/app/paid-operation.js'
import {createMemoryStore} from '../../src/app/memory-store.js'
import {requirePrepaidSlot} from '../../src/chain/billing.js'
import {discoverPaidOperationContext, readClientExecutionPolicy, readCurrentBeaconEpoch, type PaidOperationContext} from '../../src/chain/prepaid.js'
import {fetchDrawnVerifierWitnesses} from '../../src/chain/verifierSnapshot.js'
import {PaidAgentControlError, prepareRegisteredPaidSession, type PaidAgentProposal, type RegisteredPaidAgentSession, type RetainedPaidApproval} from '../../src/chain/registeredPaidAgent.js'
import {verifierAgentResult} from '../../src/oid4vp/verifier-agent.js'
import {createExecutionCertificate} from '../../src/committee/execution.js'
import {collectDebitVoucher, prepaidAllowanceId, reconcilePrepaidAllowance, reservePrepaidAllowance} from '../../src/chain/allowance.js'
import {inspectAllowanceLanes, settleAllowanceRefills, settleAllowanceVoucherPushes} from '../../src/app/paid-allowance.js'
import {assembleCompoundToken, compoundTokenHash, selectVerifierCommittee, statusAttestationHash, type CompoundTokenPayload} from '../../src/committee/token.js'
import {prepaidRequestId, type DebitVoucherWire} from '../../src/committee/payment.js'
import {ruleCommitment} from '../../src/chain/write.js'
import type {PaidWalletPresentation} from '../../src/app/paid-session.js'
import {PaidReservationUncertainError} from '../../src/chain/reservation.js'

const h = (n: number, len = 32): Hex => `0x${n.toString(16).padStart(2, '0').repeat(len)}`
const creator = privateKeyToAccount(h(7)), payer = privateKeyToAccount(h(8))
const slot = h(3), salt = h(4), rule = JSON.stringify({credentials: [{id: 'a', format: 'dc+sd-jwt', claims: [{path: ['iss'], values: ['did:web:issuer.example']}]}]})
const chainDef = defineChain({id: 43112, name: 'local', nativeCurrency: {name: 'AVAX', symbol: 'AVAX', decimals: 18}, rpcUrls: {default: {http: ['http://localhost:1']}}})
const deployment = {chainId: 43112, settlement: h(1, 20), keyRegistry: h(2, 20), verifierSet: h(5, 20), accountantSet: h(6, 20), beacon: h(9, 20)}
const coordinator = {operator: h(11, 20), publicKey: h(12), url: 'http://127.0.0.1:4001'}
const verifierSeed = new Uint8Array(32).fill(15)
const drawnIndex = selectVerifierCommittee(hexToBytes(slot), 7, hexToBytes(h(41)), 3, 1)[0]!
const witnesses = [{index: drawnIndex, operator: h(13, 20), publicKey: toHex(ed25519.getPublicKey(verifierSeed)), proof: []}]
const now = () => Math.floor(Date.now() / 1000)

function grantToken(expected: {requestHash: Uint8Array; paymentHash?: string}) {
  const t = now()
  const payload: CompoundTokenPayload = {tokenType: 'JWT', seed: hexToBytes(h(41)), epoch: 7, slotId: hexToBytes(slot), vpHash: hexToBytes(h(43)),
    holderHash: hexToBytes(h(44)), ruleHash: hexToBytes(h(45)), requestHash: expected.requestHash, paymentHash: hexToBytes(expected.paymentHash as Hex),
    binding: 1, verifierIndexes: [drawnIndex], iat: t, exp: t + 600}
  const hash = compoundTokenHash(payload), until = t + 30
  const attestation = {verifierIndex: drawnIndex, statusUntil: until, signature: ed25519.sign(statusAttestationHash(hash, drawnIndex, until), verifierSeed)}
  return assembleCompoundToken(payload, [{verifierIndex: drawnIndex, signature: ed25519.sign(hash, verifierSeed)}], [attestation])
}

/** A registered paid agent session with durable (retained) approvals and batch approvals, as the agent advertises today. */
/** A registered paid agent session with durable (retained) approvals and batch approvals, as the agent advertises today. */
/** `n` keeps session and proposal IDs distinct across operations in one store. */
function agentSession(n = 0) {
  const id = (0xab - n).toString(16).repeat(32), key = witnesses[0]!.publicKey
  const flags = {jar: false, sent: false, selected: false, approved: false, done: false}
  const proposal = (stage: PaidAgentProposal['stage'], n: number): PaidAgentProposal => ({id: n.toString(16).padStart(2, '0').repeat(32), stage, operator_key: key, unsigned_body: {stage}, expires: now() + 600})
  const retained = (p: PaidAgentProposal): RetainedPaidApproval => ({proposalId: p.id, body: JSON.stringify({authorization: {proposal: p.id}}), expires: p.expires})
  const presentation: PaidWalletPresentation = {approved: {holder: 'h', credentials: ['a.b.c'], holder_proof: null, oauth: null, iat: 1000}, form: {response: 'jwe'}}
  const session = {
    sessionId: id, paymentHash: h(60), initialization: {expires: now() + 600},
    pacing: {clock: {now: () => Date.now(), jitter: () => 0, sleep: async () => {}}, attemptBudgetMs: 5_000}, batchApprovals: true,
    create: vi.fn(async () => {}), reconcile: vi.fn(async () => ({status: 'pending'})),
    requestObject: vi.fn(async () => {
      if (!flags.jar) throw new PaidAgentControlError(id, 425)
      return {request: {claims: {nonce: 'n'}}, requestUri: 'https://agent.example/v1/request/' + id, qrPayload: 'openid4vp://?x'}
    }),
    proposals: vi.fn(async () => !flags.jar ? [proposal('presentation_sign', 0xa1 - 3 * n), proposal('presentation_attest', 0xa2 - 3 * n)]
      : flags.selected && !flags.approved ? [proposal('credential', 0xa3 - 3 * n)] : []),
    prepareRequestApproval: vi.fn(async (p: PaidAgentProposal) => retained(p)),
    prepareCredentialApproval: vi.fn(async (p: PaidAgentProposal) => retained(p)),
    sendRetainedApprovals: vi.fn(async (approvals: RetainedPaidApproval[]) => { flags.jar = true; return {kind: 'results', results: new Map(approvals.map(a => [a.proposalId, 204]))} }),
    sendRetainedApproval: vi.fn(async () => { flags.approved = true; return {status: 'accepted'} }),
    approvalState: vi.fn(async () => 'approved'),
    approveRequest: vi.fn(async () => { throw new Error('legacy single send used') }),
    approveCredentials: vi.fn(async () => { throw new Error('legacy single send used') }),
    presentations: vi.fn(async () => flags.sent ? [{id: (0x23 + n).toString(16).repeat(32), presentation: structuredClone(presentation.approved), expires: now() + 600, selected: flags.selected}] : []),
    resumePresentation: vi.fn(async () => { flags.selected = true; if (!flags.approved) throw new PaidAgentControlError(id, 425); flags.done = true }),
    poll: vi.fn(async () => ({status: flags.done ? 'done' as const : 'pending' as const, phase: flags.done ? 'done' as const : 'awaiting_wallet' as const})),
  } as unknown as RegisteredPaidAgentSession
  const holder = {kind: 'local' as const, makePresentation: vi.fn(() => structuredClone(presentation)), submit: vi.fn(async () => { flags.sent = true })}
  return {session, holder}
}

afterEach(async () => { await settleAllowanceRefills(); await settleAllowanceVoucherPushes(); vi.restoreAllMocks() })
beforeEach(() => { vi.clearAllMocks() })

/** reservePrepaidAllowance as the real one journals it (prepared, submitted, confirmed); `fail` decides per call. */
function reservations(fail: (call: number, signal?: AbortSignal) => Promise<void> | void = () => {}) {
  let nonce = 4, call = 0
  vi.mocked(reservePrepaidAllowance).mockImplementation(async (_client, _wallet, _d, intent, options) => {
    await fail(call++, options.signal)
    const allowanceId = prepaidAllowanceId(intent)
    const record = {schema: 1 as const, allowanceId, intent, quote: {} as never, transaction: {chainId: 43112, from: payer.address, to: deployment.settlement, data: '0x' as Hex,
      value: '0' as const, nonce: nonce++, gas: '1', gasPrice: '1'}}
    await options.persist({phase: 'prepared', record})
    await options.persist({phase: 'submitted', allowanceId, transactionHash: h(77)})
    await options.persist({phase: 'confirmed', allowanceId, transactionHash: h(77), blockHash: h(20)})
    return {transactionHash: h(77), quote: {} as never, allowance: {allowanceId, slotId: slot, assignmentBlock: h(19), amount: BigInt(intent.amount), spent: 0n,
      maxOpCost: BigInt(intent.max_op_cost), expiresAt: BigInt(intent.expires_at), reservedAt: BigInt(now()), actions: intent.actions, closed: false,
      blockNumber: 20n, blockHash: h(20), blockTimestamp: BigInt(now())}}
  })
}

function world(lanes = 2) {
  const store = createMemoryStore()
  const client = {
    readContract: vi.fn(async () => ({ruleCommitment: ruleCommitment(salt, rule)})),
    getBlock: vi.fn(async () => ({hash: h(0x70), number: 20n, timestamp: BigInt(now())})),
  }
  // reserveAhead stays ON (the default): an opened lane must need no top-up either.
  const config: PaidOperationConfig = {
    chain: {client, addresses: {ServiceRegistry: h(30, 20)}} as unknown as PaidOperationConfig['chain'],
    deployment, creator, store, accountantUrls: ['http://127.0.0.1:9000', 'http://127.0.0.1:9001', 'http://127.0.0.1:9002'], allowLocalHttp: true,
    gasPayer: {account: payer, chain: chainDef} as unknown as PaidOperationConfig['gasPayer'],
    agent: {profile: {endpoint: 'https://agent.example', clientId: 'decentralized_identifier:did:web:agent.example',
      approval: {chainId: 43112, registry: h(30, 20), serviceId: h(31), owner: h(32, 20), revision: 1n, manifestHash: h(33), serviceType: 1}},
    transport: {} as PaidOperationConfig['agent']['transport']},
    limits: {maxCost: 100n, maxGas: 500_000n, maxGasPrice: 10n ** 11n}, pollIntervalMs: 10,
    allowances: {enabled: true, amount: 1000n, lanes},
  }
  const context = (): PaidOperationContext => ({blockNumber: 20n, blockHash: h(20), blockTimestamp: BigInt(now()), creator: creator.address,
    mode: 0, groupPublicKey: h(40), coordinator, contributors: [coordinator], available: 100n, ruleCommitment: ruleCommitment(salt, rule),
    intentFields: {chain_id: 43112, settlement: deployment.settlement, key_registry: deployment.keyRegistry, slot, verification_epoch: 7, verification_seed: h(41),
      verification_root: h(42), verification_registry_size: 3, verification_committee: 1, verification_quorum: 1,
      keeper_assignment: {key_epoch: 1, committee_version: 1, threshold: 1, coordinator: Array<number>(32).fill(12), contributors: [Array<number>(32).fill(12)]}}})
  vi.mocked(requirePrepaidSlot).mockResolvedValue({slot, mode: 'prepaid'})
  vi.mocked(readCurrentBeaconEpoch).mockResolvedValue(7n)
  vi.mocked(discoverPaidOperationContext).mockImplementation(async () => context())
  vi.mocked(fetchDrawnVerifierWitnesses).mockResolvedValue({witnesses, artifact: {}, host: 'http://127.0.0.1:9000'})
  vi.mocked(readClientExecutionPolicy).mockResolvedValue({policy: {}} as Awaited<ReturnType<typeof readClientExecutionPolicy>>)
  vi.mocked(createExecutionCertificate).mockImplementation(async ({publicKey, expires}) => ({execution_key: `0x${Buffer.from(publicKey).toString('hex')}`, expires, creator_signature: h(51, 65)}))
  vi.mocked(verifierAgentResult).mockImplementation(expected => ({token: grantToken(expected),
    verifierProofs: [{verifierIndex: drawnIndex, operator: '13'.repeat(20), pubkey: witnesses[0]!.publicKey.slice(2), proof: []}]}))
  vi.mocked(collectDebitVoucher).mockImplementation(async (_client, _d, debit) => {
    const voucher: DebitVoucherWire = {allowance_id: debit.payment.allowance_id!, seq: debit.seq, request_id: prepaidRequestId(debit.payment), cost: '40',
      cumulative: String(40 * debit.seq), quote_block: debit.quoteBlock, signature: h(5, 64)}
    return {voucher, partials: [], outcomes: []}
  })
  const lanesOf = () => inspectAllowanceLanes(store, deployment, slot, lanes)
  return {config, store, lanesOf}
}

const discoveries = () => vi.mocked(discoverPaidOperationContext).mock.calls.length
const sends = () => vi.mocked(reservePrepaidAllowance).mock.calls.length

describe('prepareAllowances', () => {
  it('opens every lane ahead, so the first paid operation on each lane sends no reservation', async () => {
    const {config, lanesOf} = world(2)
    reservations()
    const prepared = await prepareAllowances(config, {slot})
    expect(prepared).toEqual({slot, lanes: [{lane: 0, outcome: 'reserved'}, {lane: 1, outcome: 'reserved'}]})
    // One reservation and one fresh discovery per lane: no context shared across lanes.
    expect(sends()).toBe(2)
    expect(discoveries()).toBe(2)
    const opened = await lanesOf()
    expect(opened.map(l => [l.phase, l.seq])).toEqual([['confirmed', 0], ['confirmed', 0]])
    // The first operation on each lane: a voucher, never a reservation (nor a background top-up).
    for (let i = 0; i < 2; i++) {
      const agent = agentSession(i)
      vi.mocked(prepareRegisteredPaidSession).mockResolvedValue(agent.session)
      const op = await paidOperation(config, {slot, operation: {action: 'sign', message: new TextEncoder().encode(`hello ${i}`)}, rule: {rule, salt}, holder: agent.holder})
      expect(await op.execute(async () => 'signature')).toBe('signature')
      op.dispose()
    }
    await settleAllowanceRefills()
    expect(sends()).toBe(2)
    expect(vi.mocked(collectDebitVoucher)).toHaveBeenCalledTimes(2)
    const after = await lanesOf()
    expect(after.map(l => [l.allowanceId, l.seq])).toEqual(opened.map(l => [l.allowanceId, 1]))
  })

  it('is idempotent: a second call reports not-needed and reads, signs and sends nothing', async () => {
    const {config, lanesOf} = world(2)
    reservations()
    await prepareAllowances(config, {slot})
    const before = await lanesOf(), [sent, discovered] = [sends(), discoveries()]
    expect(await prepareAllowances(config, {slot})).toEqual({slot, lanes: [{lane: 0, outcome: 'not-needed'}, {lane: 1, outcome: 'not-needed'}]})
    expect(await prepareAllowances(config, {slot, lanes: [1]})).toEqual({slot, lanes: [{lane: 1, outcome: 'not-needed'}]})
    expect([sends(), discoveries()]).toEqual([sent, discovered])
    expect(await lanesOf()).toEqual(before)
  })

  it('honours cancellation: an aborted lane leaves nothing on its journal and later lanes never start', async () => {
    const {config, lanesOf} = world(2)
    const controller = new AbortController()
    // The first reservation is cancelled before it is prepared (nothing broadcast).
    reservations(async (_call, signal) => { controller.abort(new Error('user cancelled')); signal?.throwIfAborted() })
    const result = await prepareAllowances(config, {slot, concurrency: 1, signal: controller.signal})
    expect(result.lanes.map(l => l.outcome)).toEqual(['cancelled', 'cancelled'])
    expect((result.lanes[0]!.error as Error).message).toBe('user cancelled')
    expect(result.lanes[1]!.error).toBeUndefined()
    expect(sends()).toBe(1)
    expect(discoveries()).toBe(1)
    // No signing marker left behind: a later call signs anew.
    expect((await lanesOf()).map(l => [l.allowanceId, l.next])).toEqual([[undefined, undefined], [undefined, undefined]])
    // Aborted before the call: refused at once, nothing read.
    await expect(prepareAllowances(config, {slot, signal: controller.signal})).rejects.toThrow('user cancelled')
    expect(discoveries()).toBe(1)
    reservations()
    expect((await prepareAllowances(config, {slot})).lanes.map(l => l.outcome)).toEqual(['reserved', 'reserved'])
  })

  it('reports one lane failure on that lane only; the other lanes open and a retry opens the failed one', async () => {
    const {config, lanesOf} = world(3)
    reservations(call => { if (call === 1) throw new Error('accountants refused the quote') })
    const result = await prepareAllowances(config, {slot})
    const failed = result.lanes.filter(l => l.outcome === 'failed')
    expect(failed).toHaveLength(1)
    expect((failed[0]!.error as Error).message).toBe('accountants refused the quote')
    expect(result.lanes.filter(l => l.outcome === 'reserved')).toHaveLength(2)
    const lanes = await lanesOf()
    for (const l of lanes) {
      if (l.lane === failed[0]!.lane) expect([l.allowanceId, l.next]).toEqual([undefined, undefined])
      else expect(l.phase).toBe('confirmed')
    }
    const again = await prepareAllowances(config, {slot})
    expect(again.lanes.map(l => l.outcome)).toEqual(lanes.map(l => l.lane === failed[0]!.lane ? 'reserved' : 'not-needed'))
    expect(sends()).toBe(4)
  })

  it('reports an uncertain reservation as pending and reconciles it on the next call without re-signing', async () => {
    const {config, lanesOf} = world(1)
    reservations()
    vi.mocked(reservePrepaidAllowance).mockImplementationOnce(async (_client, _wallet, _d, intent, options) => {
      const allowanceId = prepaidAllowanceId(intent)
      await options.persist({phase: 'prepared', record: {schema: 1, allowanceId, intent, quote: {} as never,
        transaction: {chainId: 43112, from: payer.address, to: deployment.settlement, data: '0x', value: '0', nonce: 4, gas: '1', gasPrice: '1'}}})
      throw new PaidReservationUncertainError(allowanceId, h(78), new Error('receipt timeout'))
    })
    expect((await prepareAllowances(config, {slot})).lanes).toEqual([{lane: 0, outcome: 'pending'}])
    expect((await lanesOf())[0]!.next).toMatchObject({phase: 'prepared'})
    // Mined after all: the next call reconciles it (no second intent, no second send).
    vi.mocked(reconcilePrepaidAllowance).mockResolvedValueOnce({state: 'reserved', allowance: {assignmentBlock: h(19)} as never})
    ;(config.chain.client as unknown as {getTransactionCount: () => Promise<number>}).getTransactionCount = vi.fn(async () => 5)
    expect((await prepareAllowances(config, {slot})).lanes).toEqual([{lane: 0, outcome: 'reserved'}])
    expect(sends()).toBe(1)
    expect((await lanesOf())[0]!.next).toMatchObject({phase: 'confirmed'})
    expect((await prepareAllowances(config, {slot})).lanes).toEqual([{lane: 0, outcome: 'not-needed'}])
    expect(sends()).toBe(1)
  })

  it('refuses invalid input and a configuration without allowances, before any read', async () => {
    const {config} = world(2)
    await expect(prepareAllowances({...config, allowances: undefined}, {slot})).rejects.toThrow(/allowances option/)
    await expect(prepareAllowances(config, {slot, lanes: [2]})).rejects.toThrow(/distinct indices 0\.\.1/)
    await expect(prepareAllowances(config, {slot, lanes: [0, 0]})).rejects.toThrow(/distinct/)
    await expect(prepareAllowances(config, {slot, lanes: []})).rejects.toThrow(/distinct/)
    await expect(prepareAllowances(config, {slot, concurrency: 0})).rejects.toThrow(/concurrency/)
    await expect(prepareAllowances(config, {slot: '0x12'})).rejects.toThrow(/slot/)
    expect(discoveries()).toBe(0)
  })

  it('reports a discovery whose creator is not the signer as that lane failing, and signs nothing', async () => {
    const {config, lanesOf} = world(1)
    reservations()
    vi.mocked(discoverPaidOperationContext).mockResolvedValue({...await vi.mocked(discoverPaidOperationContext).getMockImplementation()!(undefined as never, undefined as never, slot),
      creator: payer.address})
    const result = await prepareAllowances(config, {slot})
    expect(result.lanes[0]).toMatchObject({lane: 0, outcome: 'failed'})
    expect((result.lanes[0]!.error as Error).message).toMatch(/slot creator/)
    expect(sends()).toBe(0)
    expect((await lanesOf())[0]!.next).toBeUndefined()
  })
})
