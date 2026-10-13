import {BaseError, ContractFunctionRevertedError} from 'viem'

export function isPinnedGovernanceSlotRefusal(status: number, body: string, slot: string): boolean {
  if (status !== 403 || body.length > 2048 || !/^0x[0-9a-fA-F]{64}$/.test(slot)) return false
  try {
    const value = JSON.parse(body) as Record<string, unknown>
    return value !== null && typeof value === 'object' && Object.keys(value).length === 1
      && value.error === `slot ${slot.slice(2).toLowerCase()} is not this node's governance slot`
  } catch {return false}
}

export function isNotOperatorRevert(error: unknown): boolean {
  const reverted = error instanceof BaseError ? error.walk(e => e instanceof ContractFunctionRevertedError) : undefined
  return reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName === 'NotOperator'
}
