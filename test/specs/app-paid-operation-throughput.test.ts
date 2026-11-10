// ONE process, ONE creator / gas payer, 64 concurrent allowance-backed paid operations on 64 distinct
// lanes: the full paidOperation path from the request ID up to the session's first POST, with every
// network peer (discovery, accountant witnesses, the debit voucher round, the execution policy reads,
// the agent authentication) a fake that answers after a fixed delay. The real orchestration, journal
// and file store run. Concurrent operations must overlap their round trips: the wall is a few round
// trips, never one per operation. An application that opens one file store object per call on one
// directory (the flow bench does) must batch its journal commits exactly as one shared object does:
// keyed per store object, every new operation committed the global index on its own, one after
// another (64 durable commits in a row, one per operation, before any session POST).
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {defineChain, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {performance} from 'node:perf_hooks'

vi.mock('../../src/chain/billing.js', async original => ({...await original<typeof import('../../src/chain/billing.js')>(), requirePrepaidSlot: vi.fn()}))
vi.mock('../../src/chain/prepaid.js', async original => ({...await original<typeof import('../../src/chain/prepaid.js')>(),
  discoverPaidOperationContext: vi.fn(), readClientExecutionPolicy: vi.fn(), readCurrentBeaconEpoch: vi.fn(), followPaidRequest: vi.fn()}))
vi.mock('../../src/chain/verifierSnapshot.js', () => ({fetchDrawnVerifierWitnesses: vi.fn()}))
vi.mock('../../src/chain/registeredPaidAgent.js', async original => ({...await original<typeof import('../../src/chain/registeredPaidAgent.js')>(), prepareRegisteredPaidSession: vi.fn()}))
vi.mock('../../src/app/paid-session.js', async original => ({...await original<typeof import('../../src/app/paid-session.js')>(), drivePaidSession: vi.fn()}))
vi.mock('../../src/committee/execution.js', async original => ({...await original<typeof import('../../src/committee/execution.js')>(), createExecutionCertificate: vi.fn()}))
vi.mock('../../src/app/paid-allowance.js', async original => ({...await original<typeof import('../../src/app/paid-allowance.js')>(),
  selectAllowanceLane: vi.fn(), obtainAllowanceVoucher: vi.fn()}))

import {paidOperation, type PaidOperationConfig} from '../../src/app/paid-operation.js'
import {createFileStore} from '../../src/app/node.js'
import {createMemoryStore} from '../../src/app/memory-store.js'
import {STORE_COMMIT, storeIdentity, withCommit, type StoreCommitSteps} from '../../src/app/store-commit.js'
import type {ApplicationStore} from '../../src/app/ready-slot.js'
import {requirePrepaidSlot} from '../../src/chain/billing.js'
import {discoverPaidOperationContext, readClientExecutionPolicy, readCurrentBeaconEpoch} from '../../src/chain/prepaid.js'
import {fetchDrawnVerifierWitnesses} from '../../src/chain/verifierSnapshot.js'
import {prepareRegisteredPaidSession, type RegisteredPaidAgentSession} from '../../src/chain/registeredPaidAgent.js'
import {drivePaidSession} from '../../src/app/paid-session.js'
import {createExecutionCertificate} from '../../src/committee/execution.js'
import {obtainAllowanceVoucher, selectAllowanceLane} from '../../src/app/paid-allowance.js'
import {prepaidRequestId} from '../../src/committee/payment.js'
import {ruleCommitment} from '../../src/chain/write.js'

const h = (n: number, len = 32): Hex => `0x${n.toString(16).padStart(2, '0').repeat(len)}`
const creator = privateKeyToAccount(h(7))
const slot = h(3), salt = h(4), rule = JSON.stringify({credentials: [{id: 'a', format: 'dc+sd-jwt', claims: [{path: ['iss'], values: ['did:web:issuer.example']}]}]})
const chainDef = defineChain({id: 43112, name: 'local', nativeCurrency: {name: 'AVAX', symbol: 'AVAX', decimals: 18}, rpcUrls: {default: {http: ['http://localhost:1']}}})
const deployment = {chainId: 43112, settlement: h(1, 20), keyRegistry: h(2, 20), verifierSet: h(5, 20), accountantSet: h(6, 20), beacon: h(9, 20)}
const coordinator = {operator: h(11, 20), publicKey: h(12), url: 'http://127.0.0.1:4001'}
const witnesses = [{index: 0, operator: h(13, 20), publicKey: h(14), proof: []}]
/** One fake network round trip (RPC, accountant HTTP, agent HTTP). */
const RTT_MS = 50
const OPS = 64
const later = <T>(value: () => T): Promise<T> => new Promise(resolve => setTimeout(() => resolve(value()), RTT_MS))

const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, {recursive: true, force: true}) })

/** Session POST times (ms since the wave started), one per operation. */
let posts: number[] = []
let started = 0
beforeEach(() => {
  vi.clearAllMocks()
  posts = []
  vi.mocked(requirePrepaidSlot).mockResolvedValue({slot, mode: 'prepaid'})
  vi.mocked(readCurrentBeaconEpoch).mockImplementation(() => later(() => 7n))
  vi.mocked(discoverPaidOperationContext).mockImplementation(() => later(() => ({blockNumber: 20n, blockHash: h(20), blockTimestamp: 1n, creator: creator.address,
    mode: 0, groupPublicKey: h(40), coordinator, contributors: [coordinator], available: 100n, ruleCommitment: ruleCommitment(salt, rule),
    intentFields: {chain_id: 43112, settlement: deployment.settlement, key_registry: deployment.keyRegistry, slot, verification_epoch: 7, verification_seed: h(41),
      verification_root: h(42), verification_registry_size: 3, verification_committee: 1, verification_quorum: 1,
      keeper_assignment: {key_epoch: 1, committee_version: 1, threshold: 1, coordinator: Array<number>(32).fill(12), contributors: [Array<number>(32).fill(12)]}}})))
  // 64 distinct lanes, one per operation (as the lane cursor hands them out), each with its own allowance.
  let next = 0
  vi.mocked(selectAllowanceLane).mockImplementation(async (_env, context) => {
    const lane = next++
    return {lane, allowanceId: h(0x80 + lane), fields: {...context.intentFields}}
  })
  vi.mocked(fetchDrawnVerifierWitnesses).mockImplementation(() => later(() => ({witnesses, artifact: {}, host: 'http://127.0.0.1:9000'})))
  vi.mocked(obtainAllowanceVoucher).mockImplementation((_env, ticket, payment) => later(() => ({allowance_id: h(0x80 + ticket.lane), seq: 1,
    request_id: prepaidRequestId(payment), cost: '40', cumulative: '40', quote_block: h(70), signature: h(5, 64)})))
  vi.mocked(readClientExecutionPolicy).mockImplementation(() => later(() => ({policy: {}} as Awaited<ReturnType<typeof readClientExecutionPolicy>>)))
  vi.mocked(createExecutionCertificate).mockImplementation(async ({publicKey, expires}) => ({execution_key: `0x${Buffer.from(publicKey).toString('hex')}`, expires, creator_signature: h(51, 65)}))
  vi.mocked(prepareRegisteredPaidSession).mockImplementation(() => later(() => ({sessionId: 'ab'.repeat(32)} as RegisteredPaidAgentSession)))
  // The session's first POST: the end of the measured window. The drive stops there.
  vi.mocked(drivePaidSession).mockImplementation(async () => { posts.push(performance.now() - started); throw new Error('stop at the session POST') })
})

function config(store: ApplicationStore): PaidOperationConfig {
  const client = {readContract: vi.fn(), getBlock: vi.fn()}
  return {
    chain: {client, addresses: {ServiceRegistry: h(30, 20)}} as unknown as PaidOperationConfig['chain'],
    deployment, creator, store, accountantUrls: ['http://127.0.0.1:9000'], allowLocalHttp: true,
    gasPayer: {account: creator, chain: chainDef} as unknown as PaidOperationConfig['gasPayer'],
    agent: {profile: {endpoint: 'https://agent.example', clientId: 'decentralized_identifier:did:web:agent.example',
      approval: {chainId: 43112, registry: h(30, 20), serviceId: h(31), owner: h(32, 20), revision: 1n, manifestHash: h(33), serviceType: 1}},
    transport: {} as PaidOperationConfig['agent']['transport']},
    limits: {maxCost: 100n, maxGas: 500_000n, maxGasPrice: 10n ** 11n}, pollIntervalMs: 10,
    allowances: {enabled: true, amount: 1_000n},
  }
}

async function wave(storeFor: () => ApplicationStore): Promise<number> {
  started = performance.now()
  const results = await Promise.allSettled(Array.from({length: OPS}, (_, i) => paidOperation(config(storeFor()), {slot,
    operation: {action: 'sign', message: new TextEncoder().encode(`op ${i}`)}, rule: {rule, salt},
    holder: {kind: 'local', makePresentation: vi.fn(), submit: vi.fn()}})))
  for (const r of results) expect(r.status === 'rejected' && String((r.reason as {cause?: unknown}).cause ?? r.reason)).toMatch(/stop at the session POST/)
  expect(posts).toHaveLength(OPS)
  return Math.max(...posts)
}

/** A file store object whose native commits that write the paid operation index are counted. */
function counted(directory: string, indexCommits: {n: number}): ApplicationStore {
  const store = createFileStore(directory)
  const steps = (store as unknown as Record<symbol, StoreCommitSteps>)[STORE_COMMIT]!
  const inner = steps.withCommit.bind(steps)
  steps.withCommit = (keys, action) => {
    if ((typeof keys === 'string' ? [keys] : keys).includes('paid-op-index')) indexCommits.n++
    return inner(keys, action)
  }
  return store
}

describe('paidOperation throughput in one process, one payer', () => {
  it.each([
    ['one store object shared by every operation', 'shared'],
    ['a store object per operation on one directory (as the flow bench)', 'per-op'],
  ])('overlaps 64 operations with %s', async (_name, mode) => {
    const directory = await mkdtemp(join(tmpdir(), 'kk-paid-tp-'))
    directories.push(directory)
    const indexCommits = {n: 0}
    const shared = counted(directory, indexCommits)
    const wall = await wave(() => mode === 'shared' ? shared : counted(directory, indexCommits))
    console.log(`[paid-op throughput ${mode}] ${OPS} ops, last session POST at ${wall.toFixed(0)} ms (${(wall / OPS).toFixed(1)} ms/op), ${indexCommits.n} index commits`)
    // New operations journal through shared index commits whatever store object each one holds:
    // one commit per operation queues all of them on the index lock, one durable commit each.
    expect(indexCommits.n).toBeLessThanOrEqual(8)
    // The wall is logged, not asserted: it depends on the device flush time under whatever else runs
    // (alone: ~0.45 s for both modes with the fix, ~2 s per-op without it, with ~5 round trips of
    // RTT_MS on each operation's own path). The commit count above is what decides.
  }, 60_000)

  it('keys the shared journal batch by directory and lock wait, never across them', async () => {
    const a = await mkdtemp(join(tmpdir(), 'kk-paid-tp-')), b = await mkdtemp(join(tmpdir(), 'kk-paid-tp-'))
    directories.push(a, b)
    expect(storeIdentity(createFileStore(a))).toBe(storeIdentity(createFileStore(a)))
    expect(storeIdentity(createFileStore(a))).not.toBe(storeIdentity(createFileStore(b)))
    expect(storeIdentity(createFileStore(a, {lockWaitMs: 0}))).not.toBe(storeIdentity(createFileStore(a)))
    // A store without native steps (an application store, the memory store) is its own identity.
    const memory = createMemoryStore()
    expect(storeIdentity(memory)).toBe(memory)
    expect(storeIdentity(createMemoryStore())).not.toBe(storeIdentity(memory))
  })

  it('never hands the native steps or identity to a wrapper that spreads or inherits a file store', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kk-paid-tp-'))
    directories.push(directory)
    const raw = createFileStore(directory)
    const loads: string[] = []
    const spread: ApplicationStore = {...raw, load: async <T>(key: string) => { loads.push(key); return raw.load<T>(key) }}
    const inherited = Object.assign(Object.create(raw) as ApplicationStore, {load: spread.load})
    // The raw store keeps its native identity (and so its shared commit batches).
    expect(storeIdentity(raw)).toBe(storeIdentity(createFileStore(directory)))
    expect(typeof storeIdentity(raw)).toBe('string')
    // A copy is its own, non-native store: no shared batch reads through another caller's load.
    expect(Object.getOwnPropertySymbols(spread)).not.toContain(STORE_COMMIT)
    expect(storeIdentity(spread)).toBe(spread)
    expect(storeIdentity(inherited)).toBe(inherited)
    // Its commits take the generic path: the wrapper's own lock and save, then visible to its load.
    const saves: string[] = []
    const wrapped: ApplicationStore = {...spread, save: async (key, value) => { saves.push(key); await raw.save(key, value) }}
    await withCommit(wrapped, 'k', async commit => { commit.stage('k', {v: 1}) })
    expect(saves).toEqual(['k'])
    expect(await spread.load('k')).toEqual({v: 1})
    expect(loads).toEqual(['k'])
  })
})
