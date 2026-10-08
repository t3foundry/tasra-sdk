import type {Hex} from 'viem'
import {assertPaymentIntentWire, paymentIntentHash, paymentSessionCommitment, prepaidRequestId, type PaymentIntentWire} from '../committee/payment.js'
import type {PaidReservationCheckpoint, PaidReservationRecord, ReservePaidOperationOptions} from '../chain/reservation.js'
import type {ApplicationStore} from './ready-slot.js'

/** Private session preimage retained with a reservation for recovery after process loss. */
export interface PaidReservationSession {
  /** Fixed 32-byte presentation random committed before reservation. */
  random: Hex
  /** Independently approved verifier-agent audience committed before reservation. */
  audience: string
}

/** Durable reservation evidence; its phase never substitutes for fresh canonical chain checks. */
export interface ApplicationReservationJournal {
  /** Storage schema. */
  schemaVersion: 1
  /** Last durably saved checkpoint. */
  phase: PaidReservationCheckpoint['phase']
  /** Original transaction, signed fee quote and creator intent. */
  record: PaidReservationRecord
  /** Original random and audience; keep this journal private. */
  session: PaidReservationSession
  /** Locally signed hash journaled before broadcast, or the RPC-reported hash; absence does not prove no submission occurred. */
  transactionHash?: Hex
  /** Observed inclusion block at confirmation; it may later reorganize. */
  blockHash?: Hex
}

/** Persistent callback adapter for reservePaidOperation, with immutable recovery identity. */
export interface PaidReservationJournal {
  /** Locally derived operation identity. */
  readonly requestId: Hex
  /** Callback that durably records each checkpoint before allowing submission to continue. */
  readonly persist: ReservePaidOperationOptions['persist']
  /** Read the original saved evidence, including after failures or process restart. */
  load(): Promise<ApplicationReservationJournal | undefined>
}

const HASH = /^0x[0-9a-f]{64}$/i
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
function key(requestId: Hex): string {
  if (typeof requestId !== 'string' || !HASH.test(requestId)) throw new Error('invalid reservation journal request ID')
  return `prepaid-${requestId.toLowerCase()}`
}
function hash(value: unknown): value is Hex { return typeof value === 'string' && HASH.test(value) && !/^0x0{64}$/i.test(value) }
function validateSession(payment: PaymentIntentWire, session: PaidReservationSession): void {
  assertPaymentIntentWire(payment)
  if (!session || typeof session.random !== 'string' || !HASH.test(session.random) || typeof session.audience !== 'string'
    || !session.audience.length || session.audience.length > 4096
    || !same(paymentSessionCommitment(session.random, session.audience, payment.expires), payment.session_commitment)) throw new Error('reservation journal session differs from creator consent')
}
function validateJournal(value: unknown, requestId: Hex): ApplicationReservationJournal {
  if (!value || typeof value !== 'object') throw new Error('invalid reservation journal')
  const journal = value as ApplicationReservationJournal
  if (journal.schemaVersion !== 1 || !['prepared', 'submitted', 'confirmed'].includes(journal.phase)
    || !journal.record || journal.record.schema !== 1 || typeof journal.record.requestId !== 'string'
    || !same(journal.record.requestId, requestId)) throw new Error('reservation journal identity/schema mismatch')
  validateSession(journal.record.payment, journal.session)
  if (!same(prepaidRequestId(journal.record.payment), requestId)) throw new Error('reservation journal intent mismatch')
  const tx = journal.record.transaction, quote = journal.record.quote, payment = journal.record.payment
  if (!tx || tx.chainId !== payment.chain_id || typeof tx.to !== 'string' || !same(tx.to, payment.settlement)
    || typeof tx.from !== 'string' || !/^0x[0-9a-f]{40}$/i.test(tx.from) || /^0x0{40}$/i.test(tx.from)
    || tx.value !== '0' || !Number.isSafeInteger(tx.nonce) || tx.nonce < 0
    || typeof tx.data !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(tx.data)
    || typeof tx.gas !== 'string' || !/^[1-9][0-9]{0,77}$/.test(tx.gas)
    || typeof tx.gasPrice !== 'string' || !/^[1-9][0-9]{0,77}$/.test(tx.gasPrice)
    || !quote || typeof quote.slot !== 'string' || !same(quote.slot, payment.slot)
    || !Array.isArray(quote.request_ids) || quote.request_ids.length !== 1 || typeof quote.request_ids[0] !== 'string' || !same(quote.request_ids[0], requestId)
    || !Array.isArray(quote.costs) || quote.costs.length !== 1 || typeof quote.costs[0] !== 'string' || !/^[0-9]{1,78}$/.test(quote.costs[0]) || BigInt(quote.costs[0]) <= 0n || BigInt(quote.costs[0]) > BigInt(payment.max_cost)
    || !hash(quote.quote_block) || !hash(quote.digest) || typeof quote.signature !== 'string' || !/^0x[0-9a-f]{128}$/i.test(quote.signature)
    || quote.mined !== false || !Number.isSafeInteger(quote.legacy_nonce) || quote.legacy_nonce < 0
    || !Number.isSafeInteger(quote.deadline) || quote.deadline <= 0 || quote.deadline > payment.expires) throw new Error('invalid reservation journal transaction/quote')
  if (journal.phase === 'prepared' ? (journal.transactionHash !== undefined && !hash(journal.transactionHash)) || journal.blockHash !== undefined
    : !hash(journal.transactionHash) || (journal.phase === 'submitted' ? journal.blockHash !== undefined : !hash(journal.blockHash))) throw new Error('invalid reservation journal checkpoint')
  return journal
}

/**
 * Load retained private evidence by request ID without transmitting or resubmitting anything.
 * Reverify the original transaction and reservation on chain before acting on a saved phase.
 * @param store - Durable private application store with atomic reads/writes.
 * @param requestId - Original operation identity, never a replacement nonce.
 */
export async function loadPaidReservationJournal(store: ApplicationStore, requestId: Hex): Promise<ApplicationReservationJournal | undefined> {
  const value = await store.load<unknown>(key(requestId))
  return value === undefined ? undefined : structuredClone(validateJournal(value, requestId))
}

/**
 * Persist reservation checkpoints and their session preimage using the application's store.
 * Preparation exclusively creates its request ID; every existing record refuses a new attempt.
 * For coordinated gas payer nonces and recovery, use reserveApplicationPayment instead.
 * @param store - Durable private store with locks shared by all participating processes/tabs.
 * @param original - Fixed creator intent supplied to reservePaidOperation.
 * @param originalSession - Random and approved audience committed by that intent.
 */
export function createPaidReservationJournal(store: ApplicationStore, original: PaymentIntentWire, originalSession: PaidReservationSession): PaidReservationJournal {
  const payment = structuredClone(original), session = structuredClone(originalSession)
  validateSession(payment, session)
  const requestId = prepaidRequestId(payment), paymentHash = paymentIntentHash(payment), name = key(requestId)
  const load = async () => {
    const journal = await loadPaidReservationJournal(store, requestId)
    if (journal && (!same(paymentIntentHash(journal.record.payment), paymentHash)
      || journal.record.payment.signature !== payment.signature || journal.session.random !== session.random || journal.session.audience !== session.audience)) throw new Error('reservation journal differs from the original intent/session')
    return journal
  }
  return Object.freeze({requestId, load, persist: async (input: PaidReservationCheckpoint) => {
    const checkpoint = structuredClone(input)
    const id = checkpoint.phase === 'prepared' ? checkpoint.record.requestId : checkpoint.requestId
    if (typeof id !== 'string' || !same(id, requestId)) throw new Error('reservation checkpoint has another request ID')
    await store.withLock(name, async () => {
      if (checkpoint.phase === 'prepared') {
        // Do not interpret an existing corrupt/partial record as permission to spend again.
        if (await store.load<unknown>(name) !== undefined) throw new Error('reservation already journaled; reconcile the original attempt')
        const journal: ApplicationReservationJournal = {schemaVersion: 1, phase: 'prepared', record: checkpoint.record, session: structuredClone(session),
          ...(checkpoint.transactionHash !== undefined ? {transactionHash: checkpoint.transactionHash} : {})}
        validateJournal(journal, requestId)
        if (!same(paymentIntentHash(journal.record.payment), paymentHash) || journal.record.payment.signature !== payment.signature) throw new Error('reservation checkpoint changed creator consent')
        await store.save(name, journal)
        return
      }
      const previous = await load()
      if (!previous) throw new Error('reservation checkpoint has no durable preparation')
      if (!hash(checkpoint.transactionHash)) throw new Error('invalid reservation transaction hash')
      if (previous.transactionHash && !same(previous.transactionHash, checkpoint.transactionHash)) throw new Error('reservation transaction hash changed')
      if (checkpoint.phase === 'submitted') {
        if (previous.phase !== 'prepared') throw new Error('reservation submission checkpoint cannot be repeated or regress')
      } else if (checkpoint.phase === 'confirmed') {
        if (previous.phase !== 'submitted' || !hash(checkpoint.blockHash)) throw new Error('reservation confirmation requires its submitted checkpoint')
      } else throw new Error('invalid reservation checkpoint phase')
      const next: ApplicationReservationJournal = {...previous, phase: checkpoint.phase, transactionHash: checkpoint.transactionHash,
        ...(checkpoint.phase === 'confirmed' ? {blockHash: checkpoint.blockHash} : {})}
      validateJournal(next, requestId)
      await store.save(name, next)
    })
  }})
}
