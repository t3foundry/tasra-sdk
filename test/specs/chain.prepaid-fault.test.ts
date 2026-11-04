import {describe, expect, it, vi} from 'vitest'
import {decodeFunctionData, type Address, type Hex} from 'viem'
import {contestPrepaidFault, encodePrepaidFaultContest, readPrepaidFaultResolution, readPrepaidFaultStatus, submitPrepaidFaultClaim,
  MAX_PREPAID_FAULT_BUNDLE_BYTES, type PrepaidFaultVerdict} from '../../src/chain/prepaidFault.js'
import {prepaidFaultOracleAbi} from '../../src/chain/abis/prepaidFaultOracle.js'
import {TasraHttpError} from '../../src/errors.js'

const h = (n: number, len = 32): Hex => `0x${n.toString(16).padStart(2, '0').repeat(len)}`
const zero = h(0, 20) as Address
const now = 1_000_000n
const verdict = (change: Partial<PrepaidFaultVerdict> = {}): PrepaidFaultVerdict => ({slotId: h(1), requestId: h(2), batchId: h(3), evidenceHash: h(4),
  offender: h(5, 20), beneficiary: zero, kind: 'WrongPayout', epoch: 9n, deadline: now + 60n, ...change})

describe('PrepaidFaultOracle contest', () => {
  it('encodes the compiler selector and the enum ordinal', () => {
    const data = encodePrepaidFaultContest(verdict({kind: 'VerifierOvercredit'}), '0x1234', now)
    expect(data.slice(0, 10)).toBe('0x6840be07')
    const {args} = decodeFunctionData({abi: prepaidFaultOracleAbi, data})
    expect((args[0] as {kind: number}).kind).toBe(4)
    expect(args[1]).toBe('0x1234')
  })
  it('applies the oracle preconditions locally', () => {
    const bad: Partial<PrepaidFaultVerdict>[] = [{slotId: h(0)}, {evidenceHash: h(0)}, {offender: zero}, {kind: 'Other' as never},
      {kind: 'KeeperUndercredit'}, {kind: 'KeeperUndercredit', beneficiary: h(5, 20)}, {beneficiary: h(6, 20)},
      {deadline: now}, {deadline: now + 121n}, {epoch: -1n}]
    for (const change of bad) expect(() => encodePrepaidFaultContest(verdict(change), '0x12', now), JSON.stringify(change, (_k, v: unknown) => typeof v === 'bigint' ? v.toString() : v)).toThrow()
    expect(() => encodePrepaidFaultContest(verdict({kind: 'KeeperUndercredit', beneficiary: h(6, 20)}), '0x12', now)).not.toThrow()
    expect(() => encodePrepaidFaultContest(verdict(), '0x', now)).toThrow(/signature/)
  })
  it('simulates before sending once, and sends nothing when the oracle refuses', async () => {
    const deadline = BigInt(Math.floor(Date.now() / 1000)) + 60n
    const client = {simulateContract: vi.fn(async () => ({request: {to: 'sim'}}))}
    const wallet = {account: {address: h(7, 20)}, writeContract: vi.fn(async () => h(8))}
    expect(await contestPrepaidFault(client as never, wallet as never, h(9, 20), verdict({deadline}), '0x12')).toBe(h(8))
    expect(wallet.writeContract).toHaveBeenCalledWith({to: 'sim'})
    client.simulateContract.mockRejectedValueOnce(Object.assign(new Error('reverted'), {data: '0x6d5703c2'}))
    await expect(contestPrepaidFault(client as never, wallet as never, h(9, 20), verdict({deadline}), '0x12')).rejects.toThrow(/refused.*AlreadyResolved\(\)/)
    expect(wallet.writeContract).toHaveBeenCalledTimes(1)
  })
  it('reads the one-per-offender-and-batch resolution at one block', async () => {
    const client = {getBlockNumber: vi.fn(async () => 50n), readContract: vi.fn(async ({functionName}: {functionName: string; blockNumber?: bigint}) => functionName === 'resolutionId' ? h(10) : true)}
    expect(await readPrepaidFaultResolution(client as never, h(9, 20), {slotId: h(1), batchId: h(3), offender: h(5, 20)})).toEqual({resolutionId: h(10), resolved: true})
    expect(client.readContract.mock.calls.every(([call]) => (call as {blockNumber: bigint}).blockNumber === 50n)).toBe(true)
    await expect(readPrepaidFaultResolution(client as never, h(9, 20), {slotId: '0x01', batchId: h(3), offender: h(5, 20)})).rejects.toThrow(/Invalid/)
  })
})

describe('accountant fault witness', () => {
  const bundle = {version: 1, slot: h(1), batch_id: h(3), reconcile_block: 12, requests: []}
  it('posts a bounded bundle once and resolves only on 202', async () => {
    const fetch = vi.fn(async () => new Response(null, {status: 202}))
    expect(await submitPrepaidFaultClaim('https://acct.example/', bundle, {fetch: fetch as unknown as typeof globalThis.fetch})).toEqual({status: 202})
    expect(fetch).toHaveBeenCalledWith('https://acct.example/v1/prepaid-fault/claim', expect.objectContaining({method: 'POST', redirect: 'error', credentials: 'omit'}))
  })
  it('surfaces refusals with their retry hint and never resends', async () => {
    for (const [status, retryable] of [[403, false], [400, false], [413, false], [503, true], [429, true]] as const) {
      const fetch = vi.fn(async () => new Response('no', {status, headers: {'retry-after': '3'}}))
      const error = await submitPrepaidFaultClaim('https://acct.example', bundle, {fetch: fetch as unknown as typeof globalThis.fetch}).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(TasraHttpError)
      expect(error).toMatchObject({status, retryable})
      expect(fetch).toHaveBeenCalledTimes(1)
    }
  })
  it('refuses malformed or oversized bundles and unsafe endpoints before sending', async () => {
    const fetch = vi.fn()
    const send = (b: Record<string, unknown>, base = 'https://acct.example') => submitPrepaidFaultClaim(base, b, {fetch: fetch as unknown as typeof globalThis.fetch})
    for (const b of [{...bundle, version: 2}, {...bundle, slot: '0x1'}, {...bundle, reconcile_block: -1}, {...bundle, requests: undefined}]) await expect(send(b)).rejects.toThrow(/bundle/)
    await expect(send({...bundle, requests: ['x'.repeat(MAX_PREPAID_FAULT_BUNDLE_BYTES)]})).rejects.toThrow(/limit/)
    await expect(send(bundle, 'http://acct.example')).rejects.toThrow(/endpoint/)
    await expect(send(bundle, 'https://acct.example/?x=1')).rejects.toThrow(/endpoint/)
    expect(fetch).not.toHaveBeenCalled()
    const local = vi.fn(async () => new Response(null, {status: 202}))
    await expect(submitPrepaidFaultClaim('http://127.0.0.1:9000', bundle, {fetch: local as unknown as typeof globalThis.fetch, allowLocalHttp: true})).resolves.toEqual({status: 202})
  })
  it('reads witness health as bounded JSON', async () => {
    const fetch = vi.fn(async () => Response.json({ready: true}))
    expect(await readPrepaidFaultStatus('https://acct.example', {fetch: fetch as unknown as typeof globalThis.fetch})).toEqual({ready: true})
    fetch.mockImplementationOnce(async () => new Response('x', {status: 500}))
    await expect(readPrepaidFaultStatus('https://acct.example', {fetch: fetch as unknown as typeof globalThis.fetch})).rejects.toMatchObject({status: 500})
    fetch.mockImplementationOnce(async () => new Response('[]', {status: 200}))
    await expect(readPrepaidFaultStatus('https://acct.example', {fetch: fetch as unknown as typeof globalThis.fetch})).rejects.toThrow(/Invalid/)
  })
})
