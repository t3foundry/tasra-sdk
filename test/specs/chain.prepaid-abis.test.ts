// Selectors and topics below come from the Foundry artifact's `methodIdentifiers` and
// `cast keccak`, not from viem, so a regenerated ABI cannot agree with itself by construction.
import {describe, expect, it} from 'vitest'
import {encodeAbiParameters, encodeErrorResult, encodeEventTopics, keccak256, toFunctionSelector, toHex, type Abi, type AbiFunction, type Hex} from 'viem'
import {CONTRACT_ABIS, prepaidFaultOracleAbi, settlementAbi} from '../../src/chain/abis/index.js'
import {decodeContractLogs, eventNamesOf, categoryFor} from '../../src/chain/events.js'
import {describeRevert} from '../../src/chain/revertReason.js'

const fn = (abi: Abi, name: string): AbiFunction => {
  const item = abi.find((i): i is AbiFunction => i.type === 'function' && i.name === name)
  if (!item) throw new Error(`missing ${name}`)
  return item
}

describe('prepaid contract ABIs', () => {
  it('carries the four additive Settlement items with the compiler selectors', () => {
    const abi = settlementAbi as Abi
    expect(toFunctionSelector(fn(abi, 'initializePrepaid'))).toBe('0x16698c20')
    expect(toFunctionSelector(fn(abi, 'prepaidBatch'))).toBe('0xb1d0b7a8')
    expect(toFunctionSelector(fn(abi, 'prepaidFromGenesis'))).toBe('0x47b02a64')
    expect(toFunctionSelector(fn(abi, 'prepaidEnabled'))).toBe('0x88fa7ec6')
    expect(toFunctionSelector(fn(abi, 'version'))).toBe('0x54fd4d50')
    expect(abi.some(i => i.type === 'error' && i.name === 'ZeroBatchId')).toBe(true)
    expect(describeRevert({data: '0x7a83d671'})).toBe('ZeroBatchId()')
  })

  it('registers PrepaidFaultOracle with its compiler selectors, event and errors', () => {
    expect(CONTRACT_ABIS.PrepaidFaultOracle).toBe(prepaidFaultOracleAbi)
    const abi = prepaidFaultOracleAbi as Abi
    expect(toFunctionSelector(fn(abi, 'contest'))).toBe('0x6840be07')
    expect(toFunctionSelector(fn(abi, 'verdictDigest'))).toBe('0x7e6499ba')
    expect(toFunctionSelector(fn(abi, 'resolutionId'))).toBe('0xa7f1d31c')
    expect(toFunctionSelector(fn(abi, 'resolved'))).toBe('0x8920870e')
    expect(toFunctionSelector(fn(abi, 'MAX_VERDICT_LIFETIME'))).toBe('0xcce37e0a')
    expect(eventNamesOf('PrepaidFaultOracle')).toEqual(['PrepaidFaultResolved'])
    expect(encodeEventTopics({abi, eventName: 'PrepaidFaultResolved'})[0])
      .toBe('0x1896dedbe024ccb474c041df5d8a33863642dec3a4c5f452668414b41b51ca28')
    expect(describeRevert({data: '0x1a48cd91'})).toBe('WrongBatch()')
    expect(describeRevert({data: encodeErrorResult({abi, errorName: 'RequestNotSettled'})})).toBe('RequestNotSettled()')
    expect(categoryFor('PrepaidFaultOracle', 'PrepaidFaultResolved')).toBe('slashing')
  })

  it('decodes a PrepaidFaultResolved log including the fault kind and bounty fields', () => {
    const word = (n: number): Hex => toHex(n, {size: 32})
    const oracle = '0x00000000000000000000000000000000000000ab'
    const topics = encodeEventTopics({abi: prepaidFaultOracleAbi, eventName: 'PrepaidFaultResolved',
      args: {resolution: word(1), slotId: word(2), requestId: word(3)}}) as [Hex, ...Hex[]]
    const data = encodeAbiParameters(
      [{type: 'bytes32'}, {type: 'bytes32'}, {type: 'address'}, {type: 'address'}, {type: 'uint8'}, {type: 'uint64'}, {type: 'uint256'}],
      [word(4), keccak256('0x01'), '0x00000000000000000000000000000000000000c1', '0x00000000000000000000000000000000000000c2', 3, 9n, 77n])
    const [event] = decodeContractLogs('PrepaidFaultOracle', oracle, [{address: oracle, topics, data, blockNumber: 5n, blockHash: word(6),
      transactionHash: word(7), transactionIndex: 0, logIndex: 1, removed: false}])
    expect(event).toMatchObject({category: 'slashing', eventName: 'PrepaidFaultResolved'})
    expect(event!.args).toMatchObject({slotId: word(2), requestId: word(3), batchId: word(4), kind: 3, epoch: 9n, taken: 77n,
      offender: '0x00000000000000000000000000000000000000C1', beneficiary: '0x00000000000000000000000000000000000000c2'})
  })
})
