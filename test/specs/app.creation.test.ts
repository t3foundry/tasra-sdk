import {beforeEach, describe, expect, it, vi} from 'vitest'
import {createWalletClient, defineChain, http, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {createPreparedSlot, prepareSlot, CreationReconciliationRequiredError, type SlotCreationJournal} from '../../src/app/creation.js'
import type {CommitRevealOptions, CreateSlotArgs} from '../../src/chain/write.js'
const mock = vi.hoisted(() => ({create: vi.fn(), chain: vi.fn()}))
vi.mock('../../src/chain/write.js', () => ({createTasraWriteClient: () => ({pub: {getChainId: mock.chain}, createSlotCommitReveal: mock.create})}))
const hex = (v: string) => `0x${v.repeat(32)}` as Hex
const wallet = createWalletClient({account: privateKeyToAccount(hex('01')), transport: http('http://localhost:1'), chain: defineChain({id: 43112, name: 'test', nativeCurrency: {name: 'AVAX', symbol: 'AVAX', decimals: 18}, rpcUrls: {default: {http: ['http://localhost:1']}}})})
const deployment = {schemaVersion: 1 as const, name: 'local', rpcUrl: 'http://localhost:1', chainId: 43112, coordinator: 'lowest-operator-id' as const,
  addresses: {KeyRegistry: `0x${'11'.repeat(20)}` as Hex, NodeRegistry: `0x${'22'.repeat(20)}` as Hex}}
const prepare = () => prepareSlot(deployment, wallet.account.address, {rule: 'verify:demo', mode: 'frost', k: 2, n: 3})
beforeEach(() => {vi.clearAllMocks(); mock.chain.mockResolvedValue(43112)})

describe('durable slot creation', () => {
  it('persists all randomness before signing and all transaction boundaries in order', async () => {
    const snapshots: SlotCreationJournal[] = [], journal = prepare()
    expect(prepare().intent.slotId).not.toBe(journal.intent.slotId)
    mock.create.mockImplementation(async (args: CreateSlotArgs & CommitRevealOptions) => {
      expect(snapshots[0]!.intent).toEqual(journal.intent)
      for (const step of ['commit', 'reveal'] as const) {
        await args.recovery!.onTransaction({step, phase: 'submitting'})
        await args.recovery!.onTransaction({step, phase: 'submitted', hash: hex(step === 'commit' ? '03' : '04')})
        await args.recovery!.onTransaction({step, phase: 'confirmed', hash: hex(step === 'commit' ? '03' : '04')})
      }
      return {slotId: args.slotId, ruleSalt: args.ruleSalt, commitTx: hex('03'), revealTx: hex('04'), targetEpoch: 1, seeded: false}
    })
    const result = await createPreparedSlot(journal, {wallet, persist: async snapshot => {snapshots.push(snapshot)}})
    expect(snapshots).toHaveLength(8)
    expect(snapshots[0]).not.toHaveProperty('commit')
    expect(result.reveal?.phase).toBe('confirmed')
    expect(result.result?.slotId).toBe(journal.intent.slotId)
    expect(journal).not.toHaveProperty('result')
  })
  it('does not send a transaction if the initial durable save fails', async () => {
    await expect(createPreparedSlot(prepare(), {wallet, persist: async () => {throw new Error('disk full')}})).rejects.toThrow('disk full')
    expect(mock.create).not.toHaveBeenCalled()
  })
  it.each(['commit', 'reveal'] as const)('refuses unknown %s outcomes and preserves the saved intent', async step => {
    const journal = prepare()
    journal[step] = {phase: 'submitting'}
    await expect(createPreparedSlot(journal, {wallet, persist: vi.fn()})).rejects.toBeInstanceOf(CreationReconciliationRequiredError)
    expect(mock.create).not.toHaveBeenCalled()
  })
  it('resumes using only saved transaction hashes and the same salts', async () => {
    const journal = prepare()
    journal.commit = {phase: 'confirmed', hash: hex('03')}
    journal.reveal = {phase: 'submitted', hash: hex('04'), seeded: true}
    mock.create.mockResolvedValue({slotId: journal.intent.slotId})
    await createPreparedSlot(journal, {wallet, persist: vi.fn()})
    expect(mock.create).toHaveBeenCalledWith(expect.objectContaining({...journal.intent, recovery: expect.objectContaining({commitTx: hex('03'), revealTx: hex('04'), seeded: true})}))
  })
  it.each(['schema', 'missing', 'creator', 'chain', 'reveal', 'hash', 'abort'])('rejects invalid recovery: %s', async field => {
    const journal = prepare()
    if (field === 'schema') journal.schemaVersion = 2 as 1
    if (field === 'missing') journal.intent.ruleSalt = '' as Hex
    if (field === 'creator') journal.creator = deployment.addresses.KeyRegistry
    if (field === 'chain') mock.chain.mockResolvedValue(1)
    if (field === 'reveal') journal.reveal = {phase: 'submitted', hash: hex('04')}
    if (field === 'hash') journal.commit = {phase: 'submitted', hash: '0x12'}
    await expect(createPreparedSlot(journal, {wallet, persist: vi.fn(), options: {signal: field === 'abort' ? AbortSignal.abort() : undefined}})).rejects.toThrow()
    expect(mock.create).not.toHaveBeenCalled()
  })
  it.each([{k: 0, n: 3}, {k: 4, n: 3}, {k: 1, n: 65536}, {k: 1, n: 2, exportable: true}, {k: 1, n: 2, rule: ''}])('rejects invalid intent %j', args => {
    expect(() => prepareSlot(deployment, wallet.account.address, {mode: 'frost', rule: 'verify:demo', ...args})).toThrow()
  })
})


it('prepares a journal with the required rule', () => {
  const journal = prepareSlot(deployment, wallet.account.address, {mode: 'frost', k: 2, n: 3, rule: 'verify:demo'})
  expect(journal.intent.rule).toBe('verify:demo')
  expect(journal.intent).not.toHaveProperty('dcqlRule')
})

const invalidRules = [{}, {rule: ''}, {dcqlRule: 'verify:demo'}, {rule: 'verify:demo', dcqlRule: 'verify:demo'}, {rule: 'a', dcqlRule: 'b'}, {rule: 'verify:demo', dcqlRule: undefined}]
it.each(invalidRules)('rejects unsupported creation input %j', fields => {
  expect(() => prepareSlot(deployment, wallet.account.address, {mode: 'frost', k: 2, n: 3, ...fields} as never)).toThrow(/rule/i)
})

it.each(invalidRules)('rejects unsupported saved rule %j without rewriting or performing I/O', async fields => {
  const journal = prepare(), persist = vi.fn()
  const {rule: _rule, ...intent} = journal.intent
  journal.intent = {...intent, ...fields} as never
  journal.commit = {phase: 'confirmed', hash: hex('03')}
  journal.reveal = {phase: 'submitted', hash: hex('04'), seeded: true}
  const before = structuredClone(journal)
  await expect(createPreparedSlot(journal, {wallet, persist})).rejects.toThrow(/rule/i)
  expect(journal).toEqual(before)
  expect(persist).not.toHaveBeenCalled()
  expect(mock.chain).not.toHaveBeenCalled()
  expect(mock.create).not.toHaveBeenCalled()
})
