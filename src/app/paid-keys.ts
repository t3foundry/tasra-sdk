// Store keys of the paid-operation journal, shared by the operation and payer-selection modules.
import type {Address, Hex} from 'viem'
import {TasraError} from '../errors.js'
import type {ApplicationStore} from './ready-slot.js'

export const HEX32 = /^0x[0-9a-f]{64}$/i
/** Prefix of every paid-operation journal key (the index uses `paid-op-index`). */
export const RECORD_PREFIX = 'paid-op-'
export const RECORD_KEY = /^paid-op-[0-9a-f]{64}$/

export function paidRecordKey(requestId: Hex): string {
  if (typeof requestId !== 'string' || !HEX32.test(requestId)) throw new TasraError('Invalid paid operation request ID')
  return RECORD_PREFIX + requestId.slice(2).toLowerCase()
}

/** The gas payer a paid operation journaled, or undefined (no journal, or one written before payers were recorded). */
export async function recordedPaidOperationPayer(store: ApplicationStore, requestId: Hex): Promise<{address: Address; chainId: number} | undefined> {
  const record = await store.load<{schema?: number; payer?: unknown; payment?: {chain_id?: unknown}}>(paidRecordKey(requestId))
  if (record === undefined || record.payer === undefined) return undefined
  if (!record || record.schema !== 1 || typeof record.payer !== 'string' || !/^0x[0-9a-f]{40}$/i.test(record.payer)
    || typeof record.payment?.chain_id !== 'number') throw new TasraError('Invalid paid operation journal')
  return {address: record.payer as Address, chainId: record.payment.chain_id}
}
