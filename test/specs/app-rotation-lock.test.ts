// The application helper for the ADR-0099 rotation lock: a durable named creator transaction,
// set-once (an already-locked slot sends nothing), confirmed by reading the chain again.
import {describe, expect, it, vi} from 'vitest'
import {ContractFunctionZeroDataError, decodeFunctionData, type Address, type Hex} from 'viem'
import {lockKeyRotation} from '../../src/app/rotation-lock.js'
import {RotationLockError, ROTATION_LOCK_SENTINEL} from '../../src/chain/rotationLock.js'
import {keyRegistryAbi} from '../../src/chain/abis/index.js'
import type {TasraApplication} from '../../src/app/client.js'
import type {TasraWallet} from '../../src/app/wallet.js'
import type {ApplicationStore} from '../../src/app/ready-slot.js'

const slot = `0x${'11'.repeat(32)}` as Hex, registry = `0x${'22'.repeat(20)}` as Address, creator = `0x${'33'.repeat(20)}` as Address

function setup(over: {mode?: number; last?: bigint; creator?: Address; cancelled?: boolean; applies?: boolean; legacy?: boolean; walletChain?: number} = {}) {
  let last = over.last ?? 0n
  const readContract = vi.fn(async ({functionName}: {functionName: string}) => {
    if (functionName === 'getKeySlot') return {exists: true, creator: over.creator ?? creator, mode: over.mode ?? 0, cancelled: over.cancelled ?? false}
    if (over.legacy) throw new ContractFunctionZeroDataError({functionName})
    return last
  })
  const transfer = vi.fn(async () => {
    if (over.applies !== false) last = ROTATION_LOCK_SENTINEL
    return {hash: slot, phase: 'confirmed'}
  })
  const app = {deployment: {chainId: 43112, addresses: {KeyRegistry: registry}}, chain: {client: {readContract}}} as unknown as TasraApplication
  const wallet = {address: creator, wallet: {chain: {id: over.walletChain ?? 43112}}, transfer} as unknown as TasraWallet
  return {app, wallet, store: {} as ApplicationStore, transfer}
}

describe('lockKeyRotation (application)', () => {
  it('sends lockKeyRotation(slot) as a named creator transaction and confirms the lock', async () => {
    const s = setup()
    expect(await lockKeyRotation(s.app, slot, s)).toEqual({hash: slot, phase: 'confirmed'})
    const [name, tx, store] = s.transfer.mock.calls[0]! as unknown as [string, {to: Address; data: Hex}, ApplicationStore]
    expect(name).toBe(`rotation-lock-${slot.slice(2)}`)
    expect(tx.to).toBe(registry)
    expect(decodeFunctionData({abi: keyRegistryAbi, data: tx.data})).toEqual({functionName: 'lockKeyRotation', args: [slot]})
    expect(store).toBe(s.store)
  })

  it('uses a caller-chosen journal name', async () => {
    const s = setup()
    await lockKeyRotation(s.app, slot, {...s, name: 'custody-lock'})
    expect((s.transfer.mock.calls[0] as unknown as [string])[0]).toBe('custody-lock')
  })

  it.each([
    ['the creator lock', {last: ROTATION_LOCK_SENTINEL}, {lockedByCreator: true, lockedByMode: false}],
    ['a secp256k1 tECDSA slot', {mode: 2}, {lockedByCreator: false, lockedByMode: true}],
    ['a P-256 tECDSA slot', {mode: 4}, {lockedByCreator: false, lockedByMode: true}],
  ])('%s resolves already-locked without sending', async (_n, over, flags) => {
    const s = setup(over)
    expect(await lockKeyRotation(s.app, slot, s)).toEqual({phase: 'already-locked', slotId: slot, ...flags})
    expect(s.transfer).not.toHaveBeenCalled()
  })

  it.each([
    ['not-creator', {creator: `0x${'44'.repeat(20)}` as Address}],
    ['cancelled', {cancelled: true}],
    ['unsupported', {legacy: true}],
  ])('refuses %s before sending', async (code, over) => {
    const s = setup(over)
    const e = await lockKeyRotation(s.app, slot, s).catch((err: unknown) => err)
    expect(e).toBeInstanceOf(RotationLockError)
    expect(e).toMatchObject({code})
    expect(s.transfer).not.toHaveBeenCalled()
  })

  it('refuses another chain and a malformed slot before reading', async () => {
    const s = setup({walletChain: 1})
    await expect(lockKeyRotation(s.app, slot, s)).rejects.toThrow('different chain')
    await expect(lockKeyRotation(setup().app, '0x12', s)).rejects.toThrow(/slot id/)
    expect(s.transfer).not.toHaveBeenCalled()
  })

  it('refuses not-confirmed when the chain does not show the lock', async () => {
    const s = setup({applies: false})
    await expect(lockKeyRotation(s.app, slot, s)).rejects.toMatchObject({code: 'not-confirmed'})
  })
})
