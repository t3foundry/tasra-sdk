// Durable device flushes of ONE allowance-backed paid operation through a real file store:
// discovery → journal → debit voucher on a lane → execution consent → paid agent session (creation,
// batched request-object approvals, wallet presentation, continuation, credential approval) →
// grant → execute. Chain reads, accountants, the agent and the keepers are fakes; everything the
// SDK journals is the real code on a real directory. Each flush (a coalesced directory flush,
// serving data barriers and directory syncs alike, or a per-file sync, see
// `fileStoreSyncCounters`) is one device-wide cache flush on macOS, so this count bounds the
// operations per second a host can journal. One operation alone shares no flush, so this is the
// UNSHARED cost: concurrent operations share flushes (one commit's directory flush is another's
// data barrier), which the file store's own group-commit tests measure.
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {defineChain, hexToBytes, toHex, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {ed25519} from '@noble/curves/ed25519'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {constants} from 'node:fs'

vi.mock('../../src/chain/billing.js', async original => ({...await original<typeof import('../../src/chain/billing.js')>(), requirePrepaidSlot: vi.fn()}))
vi.mock('../../src/chain/prepaid.js', async original => ({...await original<typeof import('../../src/chain/prepaid.js')>(),
  discoverPaidOperationContext: vi.fn(), readClientExecutionPolicy: vi.fn(), readCurrentBeaconEpoch: vi.fn()}))
vi.mock('../../src/chain/verifierSnapshot.js', () => ({fetchDrawnVerifierWitnesses: vi.fn()}))
vi.mock('../../src/chain/registeredPaidAgent.js', async original => ({...await original<typeof import('../../src/chain/registeredPaidAgent.js')>(), prepareRegisteredPaidSession: vi.fn()}))
vi.mock('../../src/oid4vp/verifier-agent.js', async original => ({...await original<typeof import('../../src/oid4vp/verifier-agent.js')>(), verifierAgentResult: vi.fn()}))
vi.mock('../../src/committee/execution.js', async original => ({...await original<typeof import('../../src/committee/execution.js')>(), createExecutionCertificate: vi.fn()}))
vi.mock('../../src/chain/keeperExecution.js', () => ({createKeeperExecutionApprover: vi.fn(() => vi.fn())}))
vi.mock('../../src/chain/allowance.js', async original => ({...await original<typeof import('../../src/chain/allowance.js')>(),
  collectDebitVoucher: vi.fn(), reservePrepaidAllowance: vi.fn(), pushDebitVoucher: vi.fn(async () => [])}))

import {paidOperation, paidOperationPhase, type PaidOperationConfig} from '../../src/app/paid-operation.js'
import {createFileStore, fileStoreSyncCounters} from '../../src/app/node.js'
import {requirePrepaidSlot} from '../../src/chain/billing.js'
import {discoverPaidOperationContext, readClientExecutionPolicy, readCurrentBeaconEpoch, type PaidOperationContext} from '../../src/chain/prepaid.js'
import {fetchDrawnVerifierWitnesses} from '../../src/chain/verifierSnapshot.js'
import {PaidAgentControlError, prepareRegisteredPaidSession, type PaidAgentProposal, type RegisteredPaidAgentSession, type RetainedPaidApproval} from '../../src/chain/registeredPaidAgent.js'
import {verifierAgentResult} from '../../src/oid4vp/verifier-agent.js'
import {createExecutionCertificate} from '../../src/committee/execution.js'
import {collectDebitVoucher, prepaidAllowanceId, reservePrepaidAllowance} from '../../src/chain/allowance.js'
import {reserveForLane, settleAllowanceVoucherPushes, type AllowanceEnv} from '../../src/app/paid-allowance.js'
import {assembleCompoundToken, compoundTokenHash, selectVerifierCommittee, statusAttestationHash, type CompoundTokenPayload} from '../../src/committee/token.js'
import {prepaidRequestId, type DebitVoucherWire} from '../../src/committee/payment.js'
import {ruleCommitment} from '../../src/chain/write.js'
import type {PaidWalletPresentation} from '../../src/app/paid-session.js'

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
function agentSession() {
  const id = 'ab'.repeat(32), key = witnesses[0]!.publicKey
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
    proposals: vi.fn(async () => !flags.jar ? [proposal('presentation_sign', 0xa1), proposal('presentation_attest', 0xa2)]
      : flags.selected && !flags.approved ? [proposal('credential', 0xa3)] : []),
    prepareRequestApproval: vi.fn(async (p: PaidAgentProposal) => retained(p)),
    prepareCredentialApproval: vi.fn(async (p: PaidAgentProposal) => retained(p)),
    sendRetainedApprovals: vi.fn(async (approvals: RetainedPaidApproval[]) => { flags.jar = true; return {kind: 'results', results: new Map(approvals.map(a => [a.proposalId, 204]))} }),
    sendRetainedApproval: vi.fn(async () => { flags.approved = true; return {status: 'accepted'} }),
    approvalState: vi.fn(async () => 'approved'),
    approveRequest: vi.fn(async () => { throw new Error('legacy single send used') }),
    approveCredentials: vi.fn(async () => { throw new Error('legacy single send used') }),
    presentations: vi.fn(async () => flags.sent ? [{id: '23'.repeat(32), presentation: structuredClone(presentation.approved), expires: now() + 600, selected: flags.selected}] : []),
    resumePresentation: vi.fn(async () => { flags.selected = true; if (!flags.approved) throw new PaidAgentControlError(id, 425); flags.done = true }),
    poll: vi.fn(async () => ({status: flags.done ? 'done' as const : 'pending' as const, phase: flags.done ? 'done' as const : 'awaiting_wallet' as const})),
  } as unknown as RegisteredPaidAgentSession
  const holder = {kind: 'local' as const, makePresentation: vi.fn(() => structuredClone(presentation)), submit: vi.fn(async () => { flags.sent = true })}
  return {session, holder}
}

const roots: string[] = []
afterEach(async () => { await settleAllowanceVoucherPushes(); vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(dir => rm(dir, {recursive: true, force: true}))) })
beforeEach(() => { vi.clearAllMocks() })

const flushes = () => fileStoreSyncCounters.flushes + fileStoreSyncCounters.fileSyncs

async function world() {
  const dir = await mkdtemp(join(tmpdir(), 'tasra-flush-budget-')); roots.push(dir)
  const store = createFileStore(dir)
  const client = {
    readContract: vi.fn(async () => ({ruleCommitment: ruleCommitment(salt, rule)})),
    getBlock: vi.fn(async () => ({hash: h(0x70), number: 20n, timestamp: BigInt(now())})),
  }
  const config: PaidOperationConfig = {
    chain: {client, addresses: {ServiceRegistry: h(30, 20)}} as unknown as PaidOperationConfig['chain'],
    deployment, creator, store, accountantUrls: ['http://127.0.0.1:9000', 'http://127.0.0.1:9001', 'http://127.0.0.1:9002'], allowLocalHttp: true,
    gasPayer: {account: payer, chain: chainDef} as unknown as PaidOperationConfig['gasPayer'],
    agent: {profile: {endpoint: 'https://agent.example', clientId: 'decentralized_identifier:did:web:agent.example',
      approval: {chainId: 43112, registry: h(30, 20), serviceId: h(31), owner: h(32, 20), revision: 1n, manifestHash: h(33), serviceType: 1}},
    transport: {} as PaidOperationConfig['agent']['transport']},
    limits: {maxCost: 100n, maxGas: 500_000n, maxGasPrice: 10n ** 11n}, pollIntervalMs: 10,
    allowances: {enabled: true, amount: 1000n, reserveAhead: false},
  }
  const context: PaidOperationContext = {blockNumber: 20n, blockHash: h(20), blockTimestamp: BigInt(now()), creator: creator.address,
    mode: 0, groupPublicKey: h(40), coordinator, contributors: [coordinator], available: 100n, ruleCommitment: ruleCommitment(salt, rule),
    intentFields: {chain_id: 43112, settlement: deployment.settlement, key_registry: deployment.keyRegistry, slot, verification_epoch: 7, verification_seed: h(41),
      verification_root: h(42), verification_registry_size: 3, verification_committee: 1, verification_quorum: 1,
      keeper_assignment: {key_epoch: 1, committee_version: 1, threshold: 1, coordinator: Array<number>(32).fill(12), contributors: [Array<number>(32).fill(12)]}}}
  vi.mocked(requirePrepaidSlot).mockResolvedValue({slot, mode: 'prepaid'})
  vi.mocked(readCurrentBeaconEpoch).mockResolvedValue(7n)
  vi.mocked(discoverPaidOperationContext).mockResolvedValue(context)
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
  // One confirmed lane allowance, reserved before the measured operation (it is shared by many).
  let nonce = 4
  vi.mocked(reservePrepaidAllowance).mockImplementation(async (_client, _wallet, _d, intent, options) => {
    const allowanceId = prepaidAllowanceId(intent)
    const record = {schema: 1 as const, allowanceId, intent, quote: {} as never, transaction: {chainId: 43112, from: payer.address, to: deployment.settlement, data: '0x' as Hex,
      value: '0' as const, nonce: nonce++, gas: '1', gasPrice: '1'}}
    await options.persist({phase: 'prepared', record})
    await options.persist({phase: 'confirmed', allowanceId, transactionHash: h(77), blockHash: h(20)})
    return {transactionHash: h(77), quote: {} as never, allowance: {allowanceId, slotId: slot, assignmentBlock: h(19), amount: BigInt(intent.amount), spent: 0n,
      maxOpCost: BigInt(intent.max_op_cost), expiresAt: BigInt(intent.expires_at), reservedAt: BigInt(now()), actions: intent.actions, closed: false,
      blockNumber: 20n, blockHash: h(20), blockTimestamp: BigInt(now())}}
  })
  const env: AllowanceEnv = {client: client as unknown as AllowanceEnv['client'], deployment, creator, gasPayer: config.gasPayer, store, accountantUrls: config.accountantUrls,
    allowLocalHttp: true, limits: config.limits, options: config.allowances!}
  expect(await reserveForLane(env, context, 0)).toBe('reserved')
  return {config, store}
}

// Without O_DSYNC (Windows) every file is synced on its own, so the count is per file, not per commit.
const DSYNC = (constants as {O_DSYNC?: number}).O_DSYNC ?? 0
it.skipIf(DSYNC === 0)('one allowance-backed paid operation journals within its durable flush budget, phase by phase', async () => {
  const {config, store} = await world()
  const agent = agentSession()
  const marks: [string, number][] = []
  const mark = (phase: string) => { marks.push([phase, flushes()]) }
  vi.mocked(createExecutionCertificate).mockImplementationOnce(async ({publicKey, expires}) => { mark('reserved'); return {execution_key: `0x${Buffer.from(publicKey).toString('hex')}`, expires, creator_signature: h(51, 65)} })
  vi.mocked(prepareRegisteredPaidSession).mockImplementation(async () => { mark('certified'); return agent.session })
  vi.mocked(verifierAgentResult).mockImplementationOnce(expected => { mark('session'); return {token: grantToken(expected),
    verifierProofs: [{verifierIndex: drawnIndex, operator: '13'.repeat(20), pubkey: witnesses[0]!.publicKey.slice(2), proof: []}]} })
  await settleAllowanceVoucherPushes()
  const start = flushes()
  marks.push(['start', start])
  const op = await paidOperation(config, {slot, operation: {action: 'sign', message: new TextEncoder().encode('hello')}, rule: {rule, salt}, holder: agent.holder})
  mark('authorized')
  expect(await op.execute(async () => 'signature')).toBe('signature')
  mark('executed')
  // The voucher push journal runs in the background, but it is this operation's flush too.
  await settleAllowanceVoucherPushes()
  mark('background')
  op.dispose()
  expect(await paidOperationPhase(store, op.requestId)).toBe('executed')
  expect(vi.mocked(collectDebitVoucher)).toHaveBeenCalledTimes(1)
  const phases = Object.fromEntries(marks.slice(1).map(([phase, at], i) => [phase, at - marks[i]![1]]))
  const total = flushes() - start
  // Before (a8e7102): 116 = 28 reservation (with the background push journal), 6 consent, 67 session,
  // 5 grant, 10 execution. Now one commit (a data barrier and a directory sync) per durable step:
  //   reserved   8 = journal+index, lane debit, voucher+`reserved`, lane advance+push journal+unlocks
  //   certified  0 = the consent is committed with the session's creation
  //   session   16 = creation 2, request-object approvals 2, presentation 2 + its confirmation 2
  //                  (published before the drive waits for the wallet callback), continuation 2,
  //                  credential approval 2 (carries the continuation's confirmation, which it
  //                  follows at once), final continuation 2 + its confirmation 2 (before the poll
  //                  that ends the drive); before C20 every continuation paid its own: 18
  //   authorized 2, executed 4 (`executing` before the keeper work, `executed` after it)
  expect(phases).toEqual({reserved: 8, certified: 0, session: 16, authorized: 2, executed: 4, background: 0})
  expect(total).toBeLessThanOrEqual(32)
})
