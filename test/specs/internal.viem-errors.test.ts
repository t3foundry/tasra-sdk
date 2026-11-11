import {createRequire} from 'node:module'
import {describe, expect, it} from 'vitest'
import * as esm from 'viem'
import {isAnyViemError, isViemError, viemErrorChainHas} from '../../src/internal/viemErrors.js'

// viem's CommonJS build: the classes a caller's `require('viem')` client throws.
const cjs = createRequire(import.meta.url)('viem') as typeof esm
const hash = ('0x' + 'ab'.repeat(32)) as esm.Hash

describe('isViemError', () => {
  it('the CommonJS and ES module builds really are different classes', () => {
    expect(new cjs.TransactionReceiptNotFoundError({hash})).not.toBeInstanceOf(esm.TransactionReceiptNotFoundError)
  })

  it('recognises a viem error by name from either build', () => {
    for (const viem of [esm, cjs]) {
      const e: unknown = new viem.TransactionReceiptNotFoundError({hash})
      expect(isViemError(e, 'TransactionReceiptNotFoundError')).toBe(true)
      expect(isAnyViemError(e)).toBe(true)
    }
  })

  it('refuses another viem error, a plain Error with the same name, and non-objects', () => {
    expect(isViemError(new cjs.TransactionNotFoundError({hash}), 'TransactionReceiptNotFoundError')).toBe(false)
    expect(isViemError(new cjs.WaitForTransactionReceiptTimeoutError({hash}), 'TransactionReceiptNotFoundError')).toBe(false)
    const impostor = Object.assign(new Error('x'), {name: 'TransactionReceiptNotFoundError'})
    expect(isViemError(impostor, 'TransactionReceiptNotFoundError')).toBe(false)
    expect(isViemError({name: 'TransactionReceiptNotFoundError'}, 'TransactionReceiptNotFoundError')).toBe(false)
    for (const v of [undefined, null, 'TransactionReceiptNotFoundError', 7]) expect(isViemError(v, 'TransactionReceiptNotFoundError')).toBe(false)
    expect(isAnyViemError(new Error('plain'))).toBe(false)
  })
})

describe('viemErrorChainHas', () => {
  const names = ['ContractFunctionRevertedError', 'ContractFunctionZeroDataError']

  it('finds the named error itself or in the cause chain, from either build, as BaseError.walk does', () => {
    for (const viem of [esm, cjs]) {
      const zero = new viem.ContractFunctionZeroDataError({functionName: 'pendingCreator'})
      expect(viemErrorChainHas(zero, names)).toBe(true)
      const wrapped = new viem.ContractFunctionExecutionError(zero, {abi: [], functionName: 'pendingCreator'})
      expect(viemErrorChainHas(wrapped, names)).toBe(true)
      expect(wrapped.walk(x => x instanceof viem.ContractFunctionZeroDataError)).toBeTruthy()
    }
  })

  it('is false for a transport failure, a non-viem root and a cyclic chain without the name', () => {
    expect(viemErrorChainHas(new cjs.HttpRequestError({url: 'http://x'}), names)).toBe(false)
    expect(viemErrorChainHas(new Error('fetch failed', {cause: new cjs.ContractFunctionZeroDataError({functionName: 'f'})}), names)).toBe(false)
    const a = new cjs.BaseError('a'), b = new cjs.BaseError('b')
    Object.assign(a, {cause: b}); Object.assign(b, {cause: a})
    expect(viemErrorChainHas(a, names)).toBe(false)
  })
})
