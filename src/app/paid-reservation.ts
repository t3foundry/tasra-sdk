import type {Account, Address, Chain, Hex, PublicClient, Transport, WalletClient} from 'viem'
import {reservePaidOperation, reconcilePaidReservation, type ReservePaidOperationOptions, type PaidReservationResolution} from '../chain/reservation.js'
import type {ExpectedPaidOperation, PrepaidDeployment} from '../chain/prepaid.js'
import type {PaymentIntentWire} from '../committee/payment.js'
import {createPaidReservationJournal, loadPaidReservationJournal, type PaidReservationSession} from './paid-journal.js'
import type {ApplicationStore} from './ready-slot.js'

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
  const journal = createPaidReservationJournal(store, payment, session)
  return store.withLock(name, async () => {
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
