import {afterEach, expect, it} from 'vitest'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import type {Hex} from 'viem'
import {createFileStore} from '../../src/app/node.js'
import {createPaidReservationJournal, loadPaidReservationJournal, type ApplicationReservationJournal} from '../../src/app/paid-journal.js'
import {paymentSessionCommitment, prepaidRequestId, type PaymentIntentWire} from '../../src/committee/payment.js'
import type {PaidReservationRecord} from '../../src/chain/reservation.js'
import {selectApplicationGasPayer} from '../../src/app/paid-reservation.js'
import {withDedicatedPayer} from '../../src/app/payer-queue.js'
import {createMemoryStore} from '../../src/app/memory-store.js'

const h = (n: number, length = 32): Hex => `0x${n.toString(16).padStart(2, '0').repeat(length)}`
const directories: string[] = []
afterEach(async () => {await Promise.all(directories.splice(0).map(directory => rm(directory, {recursive: true, force: true})))})
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'tasra-paid-journal-')); directories.push(directory)
  const store = createFileStore(directory), session = {random: h(33), audience: 'did:web:agent.example'}
  const payment: PaymentIntentWire = {chain_id: 43112, settlement: h(1, 20), key_registry: h(2, 20), slot: h(3), action: 'sign', payload_digest: h(4),
    session_commitment: paymentSessionCommitment(session.random, session.audience, 1060), nonce: h(6), max_cost: '10', expires: 1060,
    verification_epoch: 7, verification_seed: h(8), verification_root: h(9), verification_registry_size: 5, verification_committee: 3, verification_quorum: 2,
    keeper_assignment: {key_epoch: 1, committee_version: 2, threshold: 2, coordinator: Array<number>(32).fill(9), contributors: [9, 10, 11].map(n => Array<number>(32).fill(n))}, signature: h(1, 65)}
  const requestId = prepaidRequestId(payment)
  // Controlled persistence fixture. Authority/ABI/signature checks are exercised by
  // chain.reservation; a stored phase is explicitly not chain or spending authorization.
  const record: PaidReservationRecord = {schema: 1, requestId, payment: structuredClone(payment),
    quote: {slot: payment.slot, quote_block: h(19), request_ids: [requestId], costs: ['10'], legacy_nonce: 0, deadline: 1060, digest: h(20), signature: h(21, 64), mined: false},
    transaction: {chainId: 43112, from: h(11, 20), to: payment.settlement, data: '0x01020304', value: '0', nonce: 4, gas: '100000', gasPrice: '25'}}
  const journal = createPaidReservationJournal(store, payment, session)
  return {directory, store, session, payment, record, journal, requestId, name: `prepaid-${requestId}`}
}
it('retains original payment/session/transaction and every phase across fresh file-store instances', async () => {
  const f = await fixture()
  expect(await f.journal.load()).toBeUndefined()
  await f.journal.persist({phase: 'prepared', record: f.record})
  const restarted = createPaidReservationJournal(createFileStore(f.directory), f.payment, f.session)
  expect(await restarted.load()).toEqual({schemaVersion: 1, phase: 'prepared', record: f.record, session: f.session})
  await restarted.persist({phase: 'submitted', requestId: f.requestId, transactionHash: h(70)})
  await restarted.persist({phase: 'confirmed', requestId: f.requestId, transactionHash: h(70), blockHash: h(71)})
  const saved = await loadPaidReservationJournal(createFileStore(f.directory), f.requestId)
  expect(saved).toEqual({schemaVersion: 1, phase: 'confirmed', record: f.record, session: f.session, transactionHash: h(70), blockHash: h(71)})
  saved!.record.payment.max_cost = '99'
  expect((await restarted.load())!.record.payment.max_cost).toBe('10')
  await expect(restarted.persist({phase: 'prepared', record: f.record})).rejects.toThrow(/already journaled/)
})
it('allows only one preparation from two processes using the same private directory', async () => {
  const f = await fixture()
  const script = `
    import {createFileStore} from './src/app/node.ts';
    import {createPaidReservationJournal} from './src/app/paid-journal.ts';
    const {directory,payment,session,record}=JSON.parse(process.env.TASRA_JOURNAL_FIXTURE);
    const journal=createPaidReservationJournal(createFileStore(directory),payment,session);
    try {await journal.persist({phase:'prepared',record}); console.log('created')}
    catch(error) {if (!/locked|already journaled/.test(error.message)) throw error; console.log('refused')}
  `
  const run = () => promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: new URL('../../', import.meta.url), timeout: 20000,
    env: {...process.env, TASRA_JOURNAL_FIXTURE: JSON.stringify({directory: f.directory, payment: f.payment, session: f.session, record: f.record})},
  })
  const results = await Promise.all([run(), run()])
  expect(results.map(result => result.stdout.trim()).sort()).toEqual(['created', 'refused'])
  expect((await f.journal.load())!.record).toEqual(f.record)
})
it('refuses every repeat including a corrupt existing record before interpreting it', async () => {
  const f = await fixture()
  await f.store.save(f.name, {interrupted: true})
  await expect(f.journal.persist({phase: 'prepared', record: f.record})).rejects.toThrow(/already journaled/)
  await expect(f.journal.load()).rejects.toThrow(/identity\/schema/)
  expect(await f.store.load(f.name)).toEqual({interrupted: true})
})
it('snapshots mutable inputs before locking and never replaces the original consent', async () => {
  const f = await fixture(), original = structuredClone(f.record), session = {...f.session}
  const pending = f.journal.persist({phase: 'prepared', record: f.record})
  f.record.transaction.data = '0xffff'; f.payment.max_cost = '99'; f.session.random = h(88)
  await pending
  expect(await f.journal.load()).toEqual({schemaVersion: 1, phase: 'prepared', record: original, session})
  expect(() => createPaidReservationJournal(f.store, original.payment, {...session, random: h(22)})).toThrow(/session/)
})
it('refuses wrong session, intent, deployment, quote and foreign request identity without saving', async () => {
  const f = await fixture()
  expect(() => createPaidReservationJournal(f.store, f.payment, {...f.session, audience: 'did:web:other'})).toThrow(/session/)
  for (const change of [
    (record: PaidReservationRecord) => {record.requestId = h(99)},
    (record: PaidReservationRecord) => {record.payment.signature = h(2, 65)},
    (record: PaidReservationRecord) => {record.transaction.to = h(2, 20)},
    (record: PaidReservationRecord) => {record.transaction.nonce = -1},
    (record: PaidReservationRecord) => {record.quote.costs = ['11']},
    (record: PaidReservationRecord) => {record.quote.request_ids = [h(99)]},
  ]) {
    const record = structuredClone(f.record); change(record)
    await expect(f.journal.persist({phase: 'prepared', record})).rejects.toThrow()
    expect(await f.journal.load()).toBeUndefined()
  }
})
it('refuses phase skips, changed transaction hashes and regressions while retaining evidence', async () => {
  const f = await fixture()
  await expect(f.journal.persist({phase: 'submitted', requestId: f.requestId, transactionHash: h(70)})).rejects.toThrow(/no durable preparation/)
  await f.journal.persist({phase: 'prepared', record: f.record})
  await expect(f.journal.persist({phase: 'confirmed', requestId: f.requestId, transactionHash: h(70), blockHash: h(71)})).rejects.toThrow(/requires/)
  await expect(f.journal.persist({phase: 'submitted', requestId: f.requestId, transactionHash: h(0)})).rejects.toThrow(/invalid/)
  await f.journal.persist({phase: 'submitted', requestId: f.requestId, transactionHash: h(70)})
  await expect(f.journal.persist({phase: 'confirmed', requestId: f.requestId, transactionHash: h(72), blockHash: h(71)})).rejects.toThrow(/hash changed/)
  await expect(f.journal.persist({phase: 'submitted', requestId: f.requestId, transactionHash: h(70)})).rejects.toThrow(/repeated or regress/)
  expect(await f.journal.load()).toMatchObject({phase: 'submitted', transactionHash: h(70)})
})
it('retains an uncertain preparation after storage reports failure following its durable write', async () => {
  const f = await fixture()
  const failing = createPaidReservationJournal({...f.store, save: async (key, value) => {await f.store.save(key, value); throw new Error('lost acknowledgement')}}, f.payment, f.session)
  await expect(failing.persist({phase: 'prepared', record: f.record})).rejects.toThrow(/lost acknowledgement/)
  expect((await f.journal.load())!.phase).toBe('prepared')
  await expect(f.journal.persist({phase: 'prepared', record: f.record})).rejects.toThrow(/already journaled/)
})
it('rejects malformed stored checkpoint evidence instead of exposing a confirmed result', async () => {
  const f = await fixture()
  const journal: ApplicationReservationJournal = {schemaVersion: 1, phase: 'confirmed', record: f.record, session: f.session, transactionHash: h(70)}
  await f.store.save(f.name, journal)
  await expect(loadPaidReservationJournal(f.store, f.requestId)).rejects.toThrow(/checkpoint/)
})
it('retains a pre-broadcast signed hash with the preparation and refuses a different submitted hash', async () => {
  const f = await fixture()
  await expect(f.journal.persist({phase: 'prepared', record: f.record, transactionHash: h(0)})).rejects.toThrow(/checkpoint/)
  await f.journal.persist({phase: 'prepared', record: f.record, transactionHash: h(70)})
  expect(await loadPaidReservationJournal(createFileStore(f.directory), f.requestId)).toMatchObject({phase: 'prepared', transactionHash: h(70)})
  await expect(f.journal.persist({phase: 'submitted', requestId: f.requestId, transactionHash: h(72)})).rejects.toThrow(/hash changed/)
  await f.journal.persist({phase: 'submitted', requestId: f.requestId, transactionHash: h(70)})
  expect(await f.journal.load()).toMatchObject({phase: 'submitted', transactionHash: h(70)})
})

it('selects gas payers round-robin, skipping claimed payers and preferring ones idle in this process', async () => {
  const store = createMemoryStore()
  const wallet = (n: number) => ({chain: {id: 43112}, account: {address: h(n, 20)}}) as unknown as Parameters<typeof selectApplicationGasPayer>[1][number]
  const pool = [wallet(41), wallet(42), wallet(43)]
  const picks = []
  for (let i = 0; i < 4; i++) picks.push((await selectApplicationGasPayer(store, pool))!.account.address)
  expect(picks).toEqual([h(41, 20), h(42, 20), h(43, 20), h(41, 20)])
  await store.save(`prepaid-payer-43112-${h(42, 20)}`, {schema: 1, chainId: 43112, payer: h(42, 20), nextNonce: 3, pending: {requestId: h(70), nonce: 3}})
  let release!: () => void
  const running = withDedicatedPayer(`43112-${h(43, 20)}`, () => new Promise<void>(resolve => { release = resolve }))
  // 42 is claimed and 43 is busy here: 41 is preferred even though it is not next in rotation.
  expect((await selectApplicationGasPayer(store, pool))!.account.address).toBe(h(41, 20))
  release(); await running
  await store.save(`prepaid-payer-43112-${h(41, 20)}`, {schema: 1, chainId: 43112, payer: h(41, 20), nextNonce: 3, pending: {requestId: h(71), nonce: 3}})
  await store.save(`prepaid-payer-43112-${h(43, 20)}`, {schema: 1, chainId: 43112, payer: h(43, 20), nextNonce: 3, pending: {requestId: h(72), nonce: 3}})
  expect(await selectApplicationGasPayer(store, pool)).toBeUndefined()
  await expect(selectApplicationGasPayer(store, [])).rejects.toThrow(/1\.\.64/)
  await expect(selectApplicationGasPayer(store, [wallet(41), wallet(41)])).rejects.toThrow(/duplicate/)
})
