import {describe, expect, it, vi} from 'vitest'
import {assertLocalPrepaidFleet, localPrepaidSettings, type LocalPrepaidFleet} from '../fleet/_prepaid-funding.ts'
import type {TasraWriteClient} from '../../src/chain/write.ts'

const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as const
const cfg = (): LocalPrepaidFleet => ({chainId: 43112, rpcUrl: 'http://127.0.0.1:43112',
  raw: {KK_PREPAID_EVIDENCE_DIR: '/private/certification-evidence'},
  book: {Settlement: address(1), TasraToken: address(2), KeyRegistry: address(3)}})

describe('fresh paid fleet funding boundary', () => {
  it('uses a finite TASRA deposit independently of native gas funding', () => {
    expect(localPrepaidSettings(cfg())).toEqual({directory: '/private/certification-evidence', amount: 1000000000000000000n})
    const input = cfg(); input.raw.KK_PREPAID_SLOT_TASRA_UNITS = '7'
    expect(localPrepaidSettings(input).amount).toBe(7n)
  })
  it('refuses Fuji, mainnet and a guessed development chain before any RPC', () => {
    for (const chainId of [43113, 43114, 1337, 31337]) {
      expect(() => localPrepaidSettings({...cfg(), chainId})).toThrow(/local chain 43112/)
    }
  })
  it('refuses remote, credential-bearing and decorated RPC endpoints', () => {
    for (const rpcUrl of ['https://api.avax.network', 'http://user:secret@localhost:43112', 'http://localhost:43112?token=secret',
      'http://localhost:43112#fragment', 'ftp://localhost:43112']) {
      expect(() => localPrepaidSettings({...cfg(), rpcUrl})).toThrow(/loopback endpoint/)
    }
  })
  it('requires durable private evidence instead of an implicit scratch directory', () => {
    expect(() => localPrepaidSettings({...cfg(), raw: {}})).toThrow(/KK_PREPAID_EVIDENCE_DIR/)
  })
  it('refuses zero, negative, fractional, noncanonical, oversized and unlimited deposits', () => {
    for (const units of ['0', '-1', '1.5', '01', '1e18', '9'.repeat(79), ((1n << 256n) - 1n).toString(), '10000000000000000001']) {
      expect(() => localPrepaidSettings({...cfg(), raw: {...cfg().raw, KK_PREPAID_SLOT_TASRA_UNITS: units}})).toThrow(/TASRA/)
    }
  })
  it('refuses an RPC answering Fuji before reading or mutating contracts', async () => {
    const readContract = vi.fn(), getChainId = vi.fn().mockResolvedValue(43113)
    await expect(assertLocalPrepaidFleet(cfg(), {pub: {getChainId, readContract}} as unknown as TasraWriteClient)).rejects.toThrow(/RPC chain/)
    expect(readContract).not.toHaveBeenCalled()
  })
  it('refuses legacy settlement instead of pretending the creator can activate it', async () => {
    const readContract = vi.fn().mockResolvedValue(false)
    await expect(assertLocalPrepaidFleet(cfg(), {pub: {getChainId: async () => 43112, readContract}} as unknown as TasraWriteClient)).rejects.toThrow(/prepaid genesis/)
    expect(readContract).toHaveBeenCalledTimes(1)
  })
  it('checks the real settlement token rather than treating native AVAX as slot credit', async () => {
    const readContract = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(address(9))
    await expect(assertLocalPrepaidFleet(cfg(), {pub: {getChainId: async () => 43112, readContract}} as unknown as TasraWriteClient)).rejects.toThrow(/configured TASRA/)
    expect(readContract).toHaveBeenCalledTimes(2)
  })
})
