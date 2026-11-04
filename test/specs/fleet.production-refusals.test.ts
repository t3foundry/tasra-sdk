import {expect, it} from 'vitest'
import {BaseError, ContractFunctionRevertedError, encodeErrorResult} from 'viem'
import {bondingCurveAbi} from '../../src/chain/abis/bondingCurve.ts'
import {isNotOperatorRevert, isPinnedGovernanceSlotRefusal} from '../fleet/_production-refusals.ts'

const slot = `0x${'ab'.repeat(32)}`
const refusal = JSON.stringify({error: `slot ${slot.slice(2)} is not this node's governance slot`})
it('recognizes the exact pinned-governance refusal observed on the real keeper', () => {
  expect(isPinnedGovernanceSlotRefusal(403, refusal, slot)).toBe(true)
})
it.each([
  [400, refusal, slot], [404, refusal, slot], [200, refusal, slot],
  [403, refusal, `0x${'cd'.repeat(32)}`], [403, '{"error":"missing governance:sign scope"}', slot],
  [403, 'not JSON', slot], [403, 'null', slot], [403, '{"error":"governance signing requires a BN254 governance slot"}', slot],
  [403, JSON.stringify({...JSON.parse(refusal), partial: 'must never be returned'}), slot],
])('refuses unrelated governance failures (%s, %s)', (status, body, requested) => {
  expect(isPinnedGovernanceSlotRefusal(status as number, body as string, requested as string)).toBe(false)
})
const notOperator = () => new ContractFunctionRevertedError({abi: bondingCurveAbi, functionName: 'redeem',
  data: encodeErrorResult({abi: bondingCurveAbi, errorName: 'NotOperator'})})
it('recognizes decoded NotOperator directly and through a viem execution wrapper', () => {
  expect(isNotOperatorRevert(notOperator())).toBe(true)
  expect(isNotOperatorRevert(new BaseError('call failed', {cause: notOperator()}))).toBe(true)
})
it.each([
  new Error('NotOperator'), new BaseError('RPC unavailable'),
  new ContractFunctionRevertedError({abi: bondingCurveAbi, functionName: 'redeem', message: 'NotOperator'}),
  new ContractFunctionRevertedError({abi: bondingCurveAbi, functionName: 'redeem', data: '0xdeadbeef'}),
  {data: {errorName: 'NotOperator'}},
])('does not confuse transport errors or undecoded reverts with an operator gate: %s', error => {
  expect(isNotOperatorRevert(error)).toBe(false)
})
