import {decodeFunctionResult, encodeFunctionData, type Account, type Address, type Chain, type Hex, type PublicClient, type Transport, type WalletClient} from 'viem'
import {settlementAbi} from '../chain/abis/settlement.js'
import {reservePaidOperation, reconcilePaidReservation, PaidReservationAbortedError, type ReservePaidOperationOptions, type PaidReservationResolution} from '../chain/reservation.js'
import type {ExpectedPaidOperation, PrepaidDeployment} from '../chain/prepaid.js'
import {prepaidRequestId, type PaymentIntentWire} from '../committee/payment.js'
import {createPaidReservationJournal, loadPaidReservationJournal, type PaidReservationSession} from './paid-journal.js'
import type {ApplicationStore} from './ready-slot.js'
import {dedicatedPayerBusy} from './payer-queue.js'
import {recordedPaidOperationPayer} from './paid-keys.js'
import {chainIdOf} from '../chain/chainId.js'

/** Durable application reservation controls, shared by every use of this gas payer. */
export interface ApplicationReservationOptions extends Omit<ReservePaidOperationOptions, 'persist'> {
  /** Private atomic store whose locks coordinate all participating processes or tabs. */
  store: ApplicationStore
  /** Original presentation random and independently approved audience. */
  session: PaidReservationSession
}

/** Another reservation may have consumed this payer's nonce; reconcile it before proceeding. */
export class ApplicationPayerRecoveryError extends Error {
  constructor(/** Original reservation that must be reconciled. */ readonly requestId: Hex) {
    super('gas payer has an unresolved reservation; reconcile its original transaction')
    this.name = 'ApplicationPayerRecoveryError'
  }
}

interface PayerState {
  schema: 1
  chainId: number
  payer: Address
  // Never accept a stale pending nonce after a verified inclusion, even after restart.
  nextNonce: number
  pending?: {requestId: Hex; nonce: number}
}
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
function payerKey(chainId: number, payer: Address): string {
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || !/^0x[0-9a-f]{40}$/i.test(payer) || /^0x0{40}$/i.test(payer)) throw new Error('invalid reservation gas payer')
  return `prepaid-payer-${chainId}-${payer.toLowerCase()}`
}
async function loadPayer(store: ApplicationStore, chainId: number, payer: Address): Promise<PayerState> {
  const value = await store.load<PayerState>(payerKey(chainId, payer))
  if (value === undefined) return {schema: 1, chainId, payer, nextNonce: 0}
  if (!value || value.schema !== 1 || value.chainId !== chainId || typeof value.payer !== 'string' || !same(value.payer, payer)
    || !Number.isSafeInteger(value.nextNonce) || value.nextNonce < 0
    || (value.pending !== undefined && (!value.pending || typeof value.pending.requestId !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value.pending.requestId)
      || !Number.isSafeInteger(value.pending.nonce) || value.pending.nonce < value.nextNonce || value.pending.nonce >= Number.MAX_SAFE_INTEGER))) throw new Error('invalid durable reservation payer state')
  return structuredClone(value)
}

/**
 * Reserve one operation while exclusively coordinating its gas payer across the application.
 * The same private store must cover all reservation callers, including different deployments
 * on one chain. Use a dedicated payer: unrelated wallet/CLI transactions are not coordinated.
 * Any uncertainty after preparation retains a durable payer claim; elapsed time never clears it.
 * An `options.signal` abort before the durable preparation refuses with
 * `PaidReservationAbortedError` (code `aborted`; no journal, no payer claim, nothing sent).
 * After it the broadcast cannot be cancelled: an abort ends only the receipt wait, as
 * `PaidReservationUncertainError`, and the payer stays claimed until reconciled.
 * @param client - Trusted bounded RPC client; submission retries disabled.
 * @param wallet - Dedicated account-bound gas payer.
 * @param deployment - Independently approved prepaid deployment.
 * @param original - Fixed creator intent from verified assignment and session discovery.
 * @param expected - Independently derived operation.
 * @param options - Durable store, original session, endpoints and explicit gas limits.
 */
export async function reserveApplicationPayment(
  client: PublicClient, wallet: WalletClient<Transport, Chain, Account>, deployment: PrepaidDeployment,
  original: PaymentIntentWire, expected: ExpectedPaidOperation, options: ApplicationReservationOptions,
): ReturnType<typeof reservePaidOperation> {
  const payment = structuredClone(original), d = {...deployment}, operation = {...expected}
  const payerWallet = {...wallet, account: {...wallet.account}, chain: {...wallet.chain}}
  const {store, session, ...limits} = {...options, session: structuredClone(options.session), accountantUrls: [...options.accountantUrls]}
  const payer = payerWallet.account.address, name = payerKey(d.chainId, payer)
  const journal = createPaidReservationJournal(store, payment, session), signal = limits.signal
  const refuseIfAborted = () => { if (signal?.aborted) throw new PaidReservationAbortedError(journal.requestId, signal.reason) }
  refuseIfAborted()
  return store.withLock(name, async () => {
    refuseIfAborted()
    const state = await loadPayer(store, d.chainId, payer)
    if (state.pending) throw new ApplicationPayerRecoveryError(state.pending.requestId)
    if (await journal.load()) throw new Error('reservation already journaled; reconcile the original attempt')
    let claimedNonce: number | undefined
    const result = await reservePaidOperation(client, payerWallet, d, payment, operation, {...limits, persist: async checkpoint => {
      if (checkpoint.phase === 'prepared') {
        const tx = checkpoint.record.transaction
        if (!same(tx.from, payer) || tx.chainId !== d.chainId || !Number.isSafeInteger(tx.nonce)
          || tx.nonce < state.nextNonce || tx.nonce >= Number.MAX_SAFE_INTEGER) throw new Error('reservation RPC nonce is below the durable payer floor or invalid')
        // Journal first: a crash before the payer claim cannot have broadcast. Every
        // existing journal still refuses retry; persist must finish before submission.
        await journal.persist(checkpoint)
        await store.save(name, {...state, pending: {requestId: journal.requestId, nonce: tx.nonce}} satisfies PayerState)
        claimedNonce = tx.nonce
      } else await journal.persist(checkpoint)
    }})
    if (claimedNonce === undefined) throw new Error('reservation completed without a durable payer claim')
    await store.save(name, {schema: 1, chainId: d.chainId, payer, nextNonce: claimedNonce + 1} satisfies PayerState)
    return result
  })
}

/**
 * Release an application's pending gas payer only after verifying the original mined transaction.
 * Success and revert both consume the nonce. Missing/replaced/reorganized transactions retain
 * the claim. This does not resubmit, delete the original journal or authorize keeper work.
 * @param client - Trusted bounded RPC client with historical canonical reads.
 * @param store - Same durable private store used for reservation.
 * @param deployment - Independently approved original deployment.
 * @param requestId - Original operation ID retained in the private journal.
 * @param expected - Independently selected original operation.
 * @param transactionHash - Saved or independently located candidate; its full identity is verified.
 * @param confirmations - Required canonical inclusion depth, 1..64 (default 1).
 */
export async function reconcileApplicationPayment(
  client: PublicClient, store: ApplicationStore, deployment: PrepaidDeployment, requestId: Hex,
  expected: ExpectedPaidOperation, transactionHash: Hex, confirmations = 1,
): Promise<PaidReservationResolution> {
  const d = {...deployment}, operation = {...expected}
  const journal = await loadPaidReservationJournal(store, requestId)
  if (!journal) throw new Error('reservation has no durable application journal')
  const tx = journal.record.transaction, name = payerKey(d.chainId, tx.from)
  return store.withLock(name, async () => {
    const state = await loadPayer(store, d.chainId, tx.from)
    if (!state.pending || !same(state.pending.requestId, requestId) || state.pending.nonce !== tx.nonce) throw new Error('reservation does not own the pending gas payer')
    if (journal.transactionHash && !same(journal.transactionHash, transactionHash)) throw new Error('candidate differs from the saved reservation hash')
    const resolution = await reconcilePaidReservation(client, d, journal.record, operation, transactionHash, confirmations)
    // Keep the located hash and canonical evidence even when the original submission
    // died before returning a hash. A failed evidence write must not release the payer.
    await store.save(`prepaid-recovery-${requestId.toLowerCase()}`, resolution)
    await store.save(name, {schema: 1, chainId: d.chainId, payer: tx.from, nextNonce: tx.nonce + 1} satisfies PayerState)
    return resolution
  })
}

/** Where an application reservation stands, from the journal, the payer claim and the chain. */
export type ApplicationReservationState =
  /** Nothing was ever prepared for this request (no journal, no payer claim) and the chain holds no reservation. */
  | 'none'
  /** The chain holds a reservation for this request ID (whoever's transaction mined it). */
  | 'reserved'
  /** The original prepared attempt can never reserve: its quote deadline has passed on chain without a reservation. Final. */
  | 'not-reserved'
  /** The outcome cannot be proven yet; nothing may be reserved again. Reconcile later. */
  | 'uncertain'

/** Outcome of {@link reconcileApplicationReservation}. */
export interface ApplicationReservationStatus {
  /** Proven state; only `none` permits a first reservation. */
  state: ApplicationReservationState
  /** Original request identity. */
  requestId: Hex
  /** Whether this request still holds its gas payer's durable claim after reconciliation. */
  payerLocked: boolean
  /** Hash journaled or reported for the original attempt, when known. */
  transactionHash?: Hex
  /** Why the state is `uncertain` or `not-reserved`; safe to log. */
  reason?: string
  /** Canonical block the chain observation was made at. */
  observedAt: {blockNumber: bigint; blockHash: Hex; blockTimestamp: bigint}
}

/** Options for {@link reconcileApplicationReservation}. */
export interface ReconcileApplicationReservationOptions {
  /**
   * Gas payer the request would use. Needed when no journal exists, to prove the payer holds no
   * claim for it; with a journal the payer is read from the journaled transaction.
   */
  payer?: Address
  /** Observation depth below the head, 1..64 (default 1). */
  confirmations?: number
}

const HEX32 = /^0x[0-9a-f]{64}$/i
async function observeReservation(client: PublicClient, d: PrepaidDeployment, slot: Hex, requestId: Hex, confirmations: number) {
  if (await chainIdOf(client) !== d.chainId) throw new Error('reservation reconciliation chain mismatch')
  const head = await client.getBlock({blockTag: 'latest'})
  const now = BigInt(Math.floor(Date.now() / 1000))
  if (head.number === null || head.hash === null || !HEX32.test(head.hash) || now - head.timestamp > 30n || head.timestamp - now > 2n) throw new Error('reservation reconciliation head is stale or unavailable')
  const block = confirmations === 1 ? head : await client.getBlock({blockNumber: head.number - BigInt(confirmations - 1)})
  const blockHash = block.hash
  if (block.number === null || blockHash === null || !HEX32.test(blockHash)) throw new Error('reservation reconciliation block unavailable')
  const read = async (functionName: 'prepaidCost' | 'prepaidAssignmentBlock') => {
    const result = await client.call({to: d.settlement, data: encodeFunctionData({abi: settlementAbi, functionName, args: [slot, requestId]}),
      blockHash, requireCanonical: true, batch: false})
    if (result.data === undefined) throw new Error(`empty ${functionName} observation`)
    return decodeFunctionResult({abi: settlementAbi, functionName, data: result.data})
  }
  const [cost, assignment] = await Promise.all([read('prepaidCost'), read('prepaidAssignmentBlock')])
  return {at: {blockNumber: block.number, blockHash, blockTimestamp: block.timestamp}, cost: cost as bigint, assignment: assignment as Hex}
}

/**
 * Reconcile an application reservation by its deterministic request ID and the payer's nonce,
 * without submitting, replacing or reserving anything. Works without a transaction hash, e.g.
 * after a crash between broadcast and the `submitted` checkpoint.
 *
 * - No journal and no payer claim: `none` (nothing was prepared, so nothing was broadcast),
 *   unless the chain already holds the reservation (`reserved`).
 * - Chain holds the reservation: `reserved`.
 * - Not reserved and a canonical block past the quote deadline: `not-reserved` (the contract
 *   refuses the original signed quote from then on). Final for this attempt.
 * - Otherwise `uncertain`; the original transaction may still be mined.
 *
 * The payer claim is released only when the journaled nonce is consumed on chain, or when the
 * attempt is provably dead and no transaction at that nonce is known to the RPC (the floor then
 * stays at that nonce). Every other case keeps the payer locked.
 * @param client - Trusted bounded RPC client with canonical reads.
 * @param store - Same private store used for the reservation.
 * @param deployment - Independently approved original deployment.
 * @param payment - Original creator payment intent (its request ID is the reservation key).
 * @param expected - Independently selected original operation.
 * @param options - Gas payer for the no-journal case and observation depth.
 */
export async function reconcileApplicationReservation(
  client: PublicClient, store: ApplicationStore, deployment: PrepaidDeployment, payment: PaymentIntentWire,
  expected: ExpectedPaidOperation, options: ReconcileApplicationReservationOptions = {},
): Promise<ApplicationReservationStatus> {
  const d = {...deployment}, original = structuredClone(payment), confirmations = options.confirmations ?? 1
  if (!Number.isSafeInteger(confirmations) || confirmations < 1 || confirmations > 64) throw new Error('invalid reservation reconciliation confirmations')
  if (original.chain_id !== d.chainId || !same(original.settlement, d.settlement) || !same(original.slot, expected.slot)
    || original.action !== expected.action || !same(original.payload_digest, expected.payloadDigest)) throw new Error('reservation reconciliation deployment or operation mismatch')
  const requestId = prepaidRequestId(original)
  const payer = (await loadPaidReservationJournal(store, requestId))?.record.transaction.from ?? options.payer
  const work = async (): Promise<ApplicationReservationStatus> => {
    // Re-read under the payer lock: a reservation journals and claims the payer under it.
    const journal = await loadPaidReservationJournal(store, requestId)
    if (journal && payer && !same(journal.record.transaction.from, payer)) throw new Error('reservation journal names another gas payer')
    const state = payer ? await loadPayer(store, d.chainId, payer) : undefined
    const owns = state?.pending !== undefined && same(state.pending.requestId, requestId)
    const observed = await observeReservation(client, d, original.slot, requestId, confirmations)
    const reserved = observed.cost !== 0n
    const base = {requestId, observedAt: observed.at}
    if (!journal) {
      // A payer claim is only ever written after the journal; one without it is not explainable.
      if (owns) return {...base, state: 'uncertain', payerLocked: true, reason: 'gas payer claims this request but no reservation journal exists'}
      return reserved ? {...base, state: 'reserved', payerLocked: false} : {...base, state: 'none', payerLocked: false}
    }
    const tx = journal.record.transaction, deadline = BigInt(journal.record.quote.deadline)
    const transactionHash = journal.transactionHash
    let result: ApplicationReservationStatus
    if (reserved) result = {...base, state: 'reserved', payerLocked: owns}
    else if (journal.phase === 'confirmed') result = {...base, state: 'uncertain', payerLocked: owns, reason: 'confirmed reservation is no longer observed on the canonical chain'}
    else if (observed.at.blockTimestamp > deadline) result = {...base, state: 'not-reserved', payerLocked: owns, reason: 'quote deadline passed without a reservation'}
    else result = {...base, state: 'uncertain', payerLocked: owns, reason: 'original reservation may still be mined until its quote deadline'}
    if (transactionHash) result.transactionHash = transactionHash
    if (owns && state?.pending?.nonce === tx.nonce) {
      const mined = await client.getTransactionCount({address: tx.from, blockNumber: observed.at.blockNumber})
      let nextNonce: number | undefined
      if (mined > tx.nonce) nextNonce = tx.nonce + 1
      else if (result.state === 'not-reserved' && await client.getTransactionCount({address: tx.from, blockTag: 'pending'}) <= tx.nonce) nextNonce = tx.nonce
      if (nextNonce !== undefined) {
        await store.save(payerKey(d.chainId, tx.from), {schema: 1, chainId: d.chainId, payer: tx.from, nextNonce} satisfies PayerState)
        result.payerLocked = false
      }
    }
    return result
  }
  return payer ? store.withLock(payerKey(d.chainId, payer), work) : work()
}

const cursors = new Map<string, number>()

/** Options for {@link selectApplicationGasPayer}. */
export interface SelectApplicationGasPayerOptions {
  /**
   * Resuming this paid operation: return the gas payer its journal recorded, whatever its claim
   * state (a reserving operation usually holds that payer's claim itself; resume reconciles it).
   * Throws when the recorded payer is not in the pool. Falls back to normal selection for an
   * operation journaled before payers were recorded, or with no journal.
   */
  resume?: Hex
}

/**
 * Pick a gas payer from a small pool of dedicated payers for the next paid operation.
 * Payers holding an unresolved durable reservation claim are skipped (reconcile them); among
 * the rest, ones idle in this process come first, rotating round-robin per pool so work is
 * spread fairly. Returns undefined when every payer holds a claim. Selection is advisory: a
 * payer claimed meanwhile still refuses safely (`ApplicationPayerRecoveryError`). With
 * `resume`, the payer recorded by that operation's journal is returned instead.
 * @param store - Private store shared by every process using these payers.
 * @param wallets - Distinct account- and chain-bound dedicated gas payers (1..64).
 * @param options - Operation being resumed, to honour its recorded payer.
 */
export async function selectApplicationGasPayer<W extends WalletClient<Transport, Chain, Account>>(store: ApplicationStore, wallets: readonly W[],
  options: SelectApplicationGasPayerOptions = {}): Promise<W | undefined> {
  if (!wallets.length || wallets.length > 64) throw new Error('supply 1..64 dedicated gas payers')
  const ids = wallets.map(w => `${w.chain.id}-${w.account.address.toLowerCase()}`)
  if (new Set(ids).size !== ids.length) throw new Error('duplicate gas payer in pool')
  if (options.resume !== undefined) {
    const recorded = await recordedPaidOperationPayer(store, options.resume)
    if (recorded !== undefined) {
      const wallet = wallets.find(w => w.chain.id === recorded.chainId && same(w.account.address, recorded.address))
      if (!wallet) throw new Error('the gas payer this operation recorded is not in the pool')
      return wallet
    }
  }
  const pool = ids.slice().sort().join(','), start = cursors.get(pool) ?? 0
  const free: {wallet: W; index: number; busy: boolean}[] = []
  for (let i = 0; i < wallets.length; i++) {
    const index = (start + i) % wallets.length, wallet = wallets[index]!
    const state = await loadPayer(store, wallet.chain.id, wallet.account.address)
    if (!state.pending) free.push({wallet, index, busy: dedicatedPayerBusy(ids[index]!)})
  }
  const chosen = free.find(c => !c.busy) ?? free[0]
  if (!chosen) return undefined
  cursors.set(pool, (chosen.index + 1) % wallets.length)
  return chosen.wallet
}

/**
 * Internal (ADR-0090 allowance reservations): run one gas-payer transaction under the same durable
 * payer claim as {@link reserveApplicationPayment}. `claim(nonce)` must be awaited from the
 * caller's `prepared` checkpoint, before broadcast: it refuses a nonce below the durable floor and
 * records the pending claim. On success the floor advances past the claimed nonce; on failure
 * after a claim the payer stays claimed until {@link releaseApplicationPayerClaim} proves it free.
 * @param store - Private store shared by every user of this payer.
 * @param chainId - Payer chain.
 * @param payer - Dedicated gas payer.
 * @param claimId - 32-byte identity of the transaction (an allowance id).
 * @param run - The reservation, given the claim hook.
 */
export async function withApplicationPayerClaim<T>(store: ApplicationStore, chainId: number, payer: Address, claimId: Hex,
  run: (claim: (nonce: number) => Promise<void>) => Promise<T>): Promise<T> {
  if (!HEX32.test(claimId)) throw new Error('invalid payer claim identity')
  const name = payerKey(chainId, payer)
  return store.withLock(name, async () => {
    const state = await loadPayer(store, chainId, payer)
    if (state.pending) throw new ApplicationPayerRecoveryError(state.pending.requestId)
    let claimed: number | undefined
    const result = await run(async nonce => {
      if (claimed !== undefined || !Number.isSafeInteger(nonce) || nonce < state.nextNonce || nonce >= Number.MAX_SAFE_INTEGER) throw new Error('payer nonce is below the durable floor or invalid')
      await store.save(name, {...state, pending: {requestId: claimId, nonce}} satisfies PayerState)
      claimed = nonce
    })
    if (claimed === undefined) throw new Error('payer transaction completed without a durable payer claim')
    await store.save(name, {schema: 1, chainId, payer, nextNonce: claimed + 1} satisfies PayerState)
    return result
  })
}

/**
 * Internal: release a payer claim held by `claimId` once the chain proves it free: the claimed
 * nonce is consumed at the head (floor = nonce + 1), or `dead` (the claimed transaction can never
 * apply) and no transaction at that nonce is pending (floor = nonce). Otherwise it stays claimed.
 * @param client - Trusted RPC client.
 * @param store - The same store.
 * @param chainId - Payer chain.
 * @param payer - Gas payer.
 * @param claimId - Identity that holds the claim.
 * @param dead - The caller proved the claimed transaction can never apply.
 */
export async function releaseApplicationPayerClaim(client: PublicClient, store: ApplicationStore, chainId: number, payer: Address, claimId: Hex, dead: boolean): Promise<boolean> {
  const name = payerKey(chainId, payer)
  return store.withLock(name, async () => {
    const state = await loadPayer(store, chainId, payer)
    if (!state.pending) return true
    if (!same(state.pending.requestId, claimId)) return false
    const nonce = state.pending.nonce
    let nextNonce: number | undefined
    if (await client.getTransactionCount({address: payer, blockTag: 'latest'}) > nonce) nextNonce = nonce + 1
    else if (dead && await client.getTransactionCount({address: payer, blockTag: 'pending'}) <= nonce) nextNonce = nonce
    if (nextNonce === undefined) return false
    await store.save(name, {schema: 1, chainId, payer, nextNonce} satisfies PayerState)
    return true
  })
}
