// Payer-side prepaid timeout escape against a deterministic fake chain that implements the
// Settlement escape rules. Selectors and topics are pinned to the compiler's method identifiers and
// `cast sig` / `cast sig-event` output, and again to keccak of the canonical signature text, so the
// vendored ABI cannot agree with itself by construction.
import {afterEach, describe, expect, it, vi} from 'vitest'
import {createPublicClient, createWalletClient, custom, decodeFunctionData, defineChain, encodeAbiParameters, encodeErrorResult, encodeEventTopics,
  encodeFunctionResult, keccak256, parseTransaction, toEventSelector, toFunctionSelector, toHex, type Abi, type AbiFunction, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {settlementAbi} from '../../src/chain/abis/settlement.js'
import {createPrepaidEscapeClient, decodePrepaidEscapeRevert, decodePrepaidEscapeLogs, prepaidEscapeId, MAX_ESCAPE_PER_CALL,
  type EscapePrepaidArgs, type PrepaidEscapeCheckpoint} from '../../src/chain/prepaidEscape.js'
import * as chainEntry from '../../src/chain/index.js'
import * as rootEntry from '../../src/index.js'
import {PrepaidEscapeError, PrepaidEscapeUncertainError, isPrepaidEscapeError} from '../../src/errors.js'

const h = (n: number, length = 32): Hex => `0x${n.toString(16).padStart(2, '0').repeat(length)}`
const id = (n: number): Hex => keccak256(toHex(`request-${n}`))
const sig = (text: string) => keccak256(toHex(text))
const deployment = {chainId: 43112, settlement: h(1, 20)}
const slot = h(3)
const NOW = 2_000_000n
const DAY = 86_400n
const chain = defineChain({id: 43112, name: 'local', nativeCurrency: {name: 'AVAX', symbol: 'AVAX', decimals: 18}, rpcUrls: {default: {http: ['http://127.0.0.1:1']}}})
const blockHash = (n: number): Hex => keccak256(toHex(`block-${n}`))
const payerKey = h(11)

interface Request {cost: bigint; settled: boolean; escapedAt: bigint; opensAt: bigint}
interface Change {
  delay?: bigint; legacy?: string; localSigner?: boolean
  failSend?: 'lost-after-mine' | 'lost-before-mine'; noMine?: boolean; reverts?: boolean; wrongRefund?: boolean
  failPersist?: PrepaidEscapeCheckpoint['phase']; beforeSimulate?: (state: State) => void
  inconsistent?: boolean; chainId?: number; repeatFirstId?: boolean
}
interface State {delay: bigint; head: number; nonce: number; requests: Map<string, Request>}

function revert(data: Hex): Error {
  return Object.assign(new Error('execution reverted'), {code: 3, data})
}
const contractError = (errorName: string, args?: readonly unknown[]) => encodeErrorResult({abi: settlementAbi as Abi, errorName, args})

/** The Settlement escapePrepaid rules, in contract order. */
function escapeRule(state: State, slotId: Hex, ids: readonly Hex[], timestamp: bigint): Hex | undefined {
  if (slotId !== slot) return contractError('ReservationUnavailable', [ids[0]])
  if (state.delay === 0n) return contractError('EscapeDisabled')
  if (ids.length === 0) return contractError('EmptyBundle')
  if (ids.length > MAX_ESCAPE_PER_CALL) return contractError('TooManyCovered', [BigInt(ids.length), 64n])
  const seen = new Set<string>()
  for (const requestId of ids) {
    const r = state.requests.get(requestId)
    if (!r || r.cost === 0n || r.settled || seen.has(requestId)) return contractError('ReservationUnavailable', [requestId])
    if (timestamp < r.opensAt) return contractError('EscapeNotOpen', [requestId, r.opensAt])
    seen.add(requestId)
  }
  return undefined
}

function fixture(requests: [Hex, Request][], change: Change = {}) {
  vi.spyOn(Date, 'now').mockReturnValue(Number(NOW) * 1000)
  const payer = privateKeyToAccount(payerKey)
  const state: State = {delay: change.delay ?? 14n * DAY, head: 20, nonce: 4, requests: new Map(requests)}
  const sent: {data: Hex; nonce: number; hash: Hex}[] = []
  const trace: string[] = [], checkpoints: PrepaidEscapeCheckpoint[] = []
  const receipts = new Map<string, Record<string, unknown>>(), transactions = new Map<string, Record<string, unknown>>()
  let counter = 0
  const mine = (data: Hex, nonce: number, gas: Hex, gasPrice: Hex, hash: Hex) => {
    const {args} = decodeFunctionData({abi: settlementAbi, data}) as unknown as {args: [Hex, Hex[]]}
    const [slotId, ids] = args
    state.head += 1
    const number = state.head, logs: Record<string, unknown>[] = []
    const failure = change.reverts ? '0x01' : escapeRule(state, slotId, ids, NOW)
    if (!failure) {
      let total = 0n
      for (const requestId of ids) {
        const r = state.requests.get(requestId)!
        r.settled = true; r.escapedAt = NOW; total += r.cost
        logs.push({topics: encodeEventTopics({abi: settlementAbi, eventName: 'PrepaidEscaped', args: {slotId, requestId: change.repeatFirstId ? ids[0] : requestId}}),
          data: encodeAbiParameters([{type: 'uint256'}], [change.wrongRefund ? r.cost + 1n : r.cost])})
      }
      logs.push({topics: encodeEventTopics({abi: settlementAbi, eventName: 'PrepaidBatchEscaped', args: {slotId, caller: payer.address}}),
        data: encodeAbiParameters([{type: 'uint256'}, {type: 'uint256'}], [total, BigInt(ids.length)])})
    }
    state.nonce = nonce + 1
    const where = {blockHash: blockHash(number), blockNumber: toHex(number), transactionHash: hash, transactionIndex: '0x0'}
    receipts.set(hash, {...where, from: payer.address, to: deployment.settlement, cumulativeGasUsed: gas, gasUsed: gas, contractAddress: null,
      logs: logs.map((log, i) => ({...log, ...where, address: deployment.settlement, logIndex: toHex(i), removed: false})),
      logsBloom: '0x' + '00'.repeat(256), status: failure ? '0x0' : '0x1', effectiveGasPrice: gasPrice, type: '0x0'})
    transactions.get(hash)!.blockHash = blockHash(number)
    transactions.get(hash)!.blockNumber = toHex(number)
  }
  const submit = (data: Hex, nonce: number, gas: Hex, gasPrice: Hex, hash: Hex) => {
    sent.push({data, nonce, hash})
    transactions.set(hash, {hash, from: payer.address, to: deployment.settlement, input: data, value: '0x0', nonce: toHex(nonce), gas, gasPrice,
      chainId: '0xa868', type: '0x0', blockHash: null, blockNumber: null, transactionIndex: null, v: '0x1b', r: h(1), s: h(2)})
    if (change.failSend === 'lost-before-mine') throw new Error('transport lost before the node accepted it')
    if (!change.noMine) mine(data, nonce, gas, gasPrice, hash)
    if (change.failSend === 'lost-after-mine') throw new Error('transport lost after send')
    return hash
  }
  const transport = custom({request: async ({method, params}: {method: string; params?: unknown}) => {
    trace.push(method)
    if (method === 'eth_chainId') return toHex(change.chainId ?? 43112)
    if (method === 'eth_blockNumber') return toHex(state.head)
    if (method === 'eth_getBlockByNumber') {
      const at = (params as unknown[])[0]
      const n = at === 'latest' ? state.head : Number(BigInt(at as Hex))
      return {number: toHex(n), hash: blockHash(n), timestamp: toHex(NOW), transactions: []}
    }
    if (method === 'eth_call') {
      const [call, block] = params as [{to: string; data: Hex; from?: string}, {blockHash?: Hex; requireCanonical?: boolean} | string]
      const {functionName, args} = decodeFunctionData({abi: settlementAbi, data: call.data}) as {functionName: string; args: readonly Hex[]}
      if (functionName === 'escapePrepaid') {
        expect(typeof block === 'string' || block?.blockHash === undefined).toBe(true)
        expect(call.from?.toLowerCase()).toBe(payer.address.toLowerCase())
        change.beforeSimulate?.(state)
        const failure = escapeRule(state, args[0]!, args[1] as unknown as Hex[], NOW)
        if (failure) throw revert(failure)
        return '0x'
      }
      expect(typeof block === 'object' && block.requireCanonical).toBe(true)
      if (functionName === 'version' && change.legacy === 'fail') throw revert('0x')
      if (functionName === 'version') return encodeFunctionResult({abi: settlementAbi, functionName: 'version', result: change.legacy ?? '3'})
      if (change.legacy) throw revert('0x')
      const r = args?.[1] ? state.requests.get(args[1]) : undefined
      const cost = r?.cost ?? 0n, settled = r?.settled ?? false
      const values: Record<string, unknown> = {
        prepaidEscapeDelay: state.delay, prepaidCost: cost, prepaidSettled: settled, prepaidEscapedAt: r?.escapedAt ?? 0n,
        prepaidEscapableAt: change.inconsistent ? 1n : (state.delay === 0n || cost === 0n || settled ? 0n : r!.opensAt),
      }
      return encodeFunctionResult({abi: settlementAbi as Abi, functionName, result: values[functionName]})
    }
    if (method === 'eth_gasPrice') return toHex(25n)
    if (method === 'eth_estimateGas') return toHex(150_000n)
    if (method === 'eth_getTransactionCount') {
      const at = (params as unknown[])[1]
      return toHex(at === 'pending' ? state.nonce : state.nonce)
    }
    if (method === 'eth_sendTransaction') {
      const [tx] = params as [{data: Hex; nonce: Hex; gas: Hex; gasPrice: Hex}]
      return submit(tx.data, Number(BigInt(tx.nonce)), tx.gas, tx.gasPrice, keccak256(toHex(`tx-${counter++}`)))
    }
    if (method === 'eth_sendRawTransaction') {
      const raw = (params as Hex[])[0]!, tx = parseTransaction(raw)
      return submit(tx.data!, tx.nonce!, toHex(tx.gas!), toHex(tx.gasPrice!), keccak256(raw))
    }
    if (method === 'eth_getTransactionByHash') return transactions.get((params as Hex[])[0]!) ?? null
    if (method === 'eth_getTransactionReceipt') return receipts.get((params as Hex[])[0]!) ?? null
    throw new Error(`unexpected RPC ${method}`)
  }}, {retryCount: 0})
  const client = createPublicClient({chain, transport})
  const signer = createWalletClient({chain, account: change.localSigner ? payer : payer.address, transport})
  const persist = async (checkpoint: PrepaidEscapeCheckpoint) => {
    trace.push(checkpoint.phase)
    if (change.failPersist === checkpoint.phase) throw new Error('journal failed')
    if (checkpoint.phase === 'prepared' && checkpoints.some(c => c.phase === 'prepared' && c.record.escapeId === checkpoint.record.escapeId)) throw new Error('existing durable record')
    checkpoints.push(structuredClone(checkpoint))
  }
  const escape = createPrepaidEscapeClient(client, deployment)
  const run = (ids: readonly Hex[], override: Partial<EscapePrepaidArgs> = {}) =>
    escape.escapePrepaid({slotId: slot, requestIds: ids, signer, maxGas: 6_000_000n, maxGasPrice: 50n, persist, receiptTimeoutMs: 50, ...override})
  const prepared = () => checkpoints.filter((c): c is Extract<PrepaidEscapeCheckpoint, {phase: 'prepared'}> => c.phase === 'prepared')
  return {state, sent, trace, checkpoints, prepared, escape, run, client, signer, payer, persist}
}
const open = (cost = 10n): Request => ({cost, settled: false, escapedAt: 0n, opensAt: NOW - DAY})
const later = (cost = 10n): Request => ({cost, settled: false, escapedAt: 0n, opensAt: NOW + 3n * DAY})
afterEach(() => { vi.restoreAllMocks() })

describe('prepaid escape ABI', () => {
  const fn = (name: string): AbiFunction => {
    const item = (settlementAbi as Abi).find((i): i is AbiFunction => i.type === 'function' && i.name === name)
    if (!item) throw new Error(`missing ${name}`)
    return item
  }
  it('pins selectors, event topics and error selectors to the compiler and to the canonical signatures', () => {
    for (const [name, selector, canonical] of [
      ['escapePrepaid', '0xe27f5093', 'escapePrepaid(bytes32,bytes32[])'],
      ['prepaidEscapableAt', '0xa1524a14', 'prepaidEscapableAt(bytes32,bytes32)'],
      ['prepaidEscapeDelay', '0x68260a91', 'prepaidEscapeDelay()'],
      ['prepaidEscapeSince', '0xe98d9f6f', 'prepaidEscapeSince()'],
      ['prepaidEscapedAt', '0x23e0fd34', 'prepaidEscapedAt(bytes32,bytes32)'],
      ['MAX_ESCAPE_PER_CALL', '0xad938bb9', 'MAX_ESCAPE_PER_CALL()'],
      ['version', '0x54fd4d50', 'version()'],
    ] as const) {
      expect(toFunctionSelector(fn(name)), name).toBe(selector)
      expect(sig(canonical).slice(0, 10), canonical).toBe(selector)
    }
    for (const [eventName, topic, canonical] of [
      ['PrepaidEscaped', '0x1b57c1da61f3b37dbca2c5c951e590705be75c72ea94dd1f8efc2011f78ab033', 'PrepaidEscaped(bytes32,bytes32,uint256)'],
      ['PrepaidBatchEscaped', '0x6de3b9537149cbd0adec7883e124981c8e1aaa8fb60f25aacf30b2ff006307fd', 'PrepaidBatchEscaped(bytes32,address,uint256,uint256)'],
      ['PrepaidEscapeDelayChanged', '0xf229782dd3f29f77793953c193624c5dca295cfa7d7d0f27af86253dc7395318', 'PrepaidEscapeDelayChanged(uint64,uint64)'],
    ] as const) {
      expect(encodeEventTopics({abi: settlementAbi as Abi, eventName})[0], eventName).toBe(topic)
      expect(sig(canonical)).toBe(topic)
      expect(toEventSelector(canonical)).toBe(topic)
    }
    for (const [errorName, selector, canonical, args] of [
      ['EscapeDisabled', '0xe4d1bca0', 'EscapeDisabled()', undefined],
      ['EscapeNotOpen', '0xf794f05e', 'EscapeNotOpen(bytes32,uint64)', [h(5), 7n]],
      ['InvalidEscapeDelay', '0xab4555d1', 'InvalidEscapeDelay(uint64)', [1n]],
      ['ReservationUnavailable', '0xb389429d', 'ReservationUnavailable(bytes32)', [h(5)]],
    ] as const) {
      expect(contractError(errorName, args).slice(0, 10), errorName).toBe(selector)
      expect(sig(canonical).slice(0, 10)).toBe(selector)
    }
  })
  it('does not ship the governance-only delay setter', () => {
    expect((settlementAbi as Abi).some(i => i.type === 'function' && i.name === 'setPrepaidEscapeDelay')).toBe(false)
    expect(Object.keys(chainEntry).some(k => /setPrepaidEscapeDelay|EscapeDelay/i.test(k))).toBe(false)
    expect(MAX_ESCAPE_PER_CALL).toBe(64)
  })
  it('exports the client from tasra-sdk/chain and the typed errors from both entry points', () => {
    expect(chainEntry.createPrepaidEscapeClient).toBe(createPrepaidEscapeClient)
    expect(chainEntry.PrepaidEscapeError).toBe(PrepaidEscapeError)
    expect(rootEntry.PrepaidEscapeError).toBe(PrepaidEscapeError)
    expect(rootEntry.PrepaidEscapeUncertainError).toBe(PrepaidEscapeUncertainError)
    expect(rootEntry.isPrepaidEscapeError).toBe(isPrepaidEscapeError)
  })
})

describe('escapableAt', () => {
  it('maps every on-chain state at one canonical block', async () => {
    const reconciled = {cost: 10n, settled: true, escapedAt: 0n, opensAt: 0n}, escaped = {cost: 10n, settled: true, escapedAt: NOW - 5n, opensAt: 0n}
    const f = fixture([[id(2), reconciled], [id(3), escaped], [id(4), later()], [id(5), open()], [id(6), {...open(), opensAt: NOW}]])
    const observed = await f.escape.escapableAt({slotId: slot, requestIds: [id(1), id(2), id(3), id(4), id(5), id(6)]})
    expect(observed).toMatchObject({blockNumber: 20n, blockHash: blockHash(20), blockTimestamp: NOW, escapeDelaySeconds: 14n * DAY, slotId: slot})
    expect(observed.requests).toEqual([
      {requestId: id(1), status: 'notReserved'},
      {requestId: id(2), status: 'settled'},
      {requestId: id(3), status: 'settled', escapedAt: new Date(Number(NOW - 5n) * 1000)},
      {requestId: id(4), status: 'notOpen', opensAt: new Date(Number(NOW + 3n * DAY) * 1000)},
      {requestId: id(5), status: 'open', opensAt: new Date(Number(NOW - DAY) * 1000)},
      // Exactly at opensAt the contract no longer reverts (block.timestamp < opensAt).
      {requestId: id(6), status: 'open', opensAt: new Date(Number(NOW) * 1000)},
    ])
    expect(f.sent).toHaveLength(0)
  })
  it('reports a zero delay as disabled for reserved requests and keeps final states final', async () => {
    const f = fixture([[id(1), open()], [id(2), {cost: 10n, settled: true, escapedAt: 0n, opensAt: 0n}]], {delay: 0n})
    const observed = await f.escape.escapableAt({slotId: slot, requestIds: [id(1), id(2), id(3)]})
    expect(observed.escapeDelaySeconds).toBe(0n)
    expect(observed.requests.map(r => r.status)).toEqual(['disabled', 'settled', 'notReserved'])
  })
  it('refuses inconsistent getters instead of guessing', async () => {
    for (const [requests, delay] of [[[[id(1), {cost: 10n, settled: true, escapedAt: 0n, opensAt: 0n}]], 14n * DAY], [[], 14n * DAY],
      [[[id(1), open()]], 0n], [[[id(1), {...open(), escapedAt: NOW}]], 14n * DAY]] as const) {
      const f = fixture(requests as unknown as [Hex, Request][], {inconsistent: true, delay})
      await expect(f.escape.escapableAt({slotId: slot, requestIds: [id(1)]})).rejects.toThrow(/inconsistent/)
    }
    const zero = fixture([[id(1), {...open(), opensAt: 0n}]], {})
    await expect(zero.escape.escapableAt({slotId: slot, requestIds: [id(1)]})).rejects.toThrow(/inconsistent/)
  })
  it('refuses a wrong RPC chain and a stale head', async () => {
    await expect(fixture([[id(1), open()]], {chainId: 1}).escape.escapableAt({slotId: slot, requestIds: [id(1)]})).rejects.toThrow(/chain mismatch/)
    const f = fixture([[id(1), open()]])
    vi.spyOn(Date, 'now').mockReturnValue(Number(NOW + 31n) * 1000)
    await expect(f.escape.escapableAt({slotId: slot, requestIds: [id(1)]})).rejects.toThrow(/stale/)
    await expect(f.run([id(1)])).rejects.toThrow(/stale/)
    expect(f.sent).toHaveLength(0)
  })
  it('names a Settlement without the escape, and keeps any other read failure a failure', async () => {
    const legacy = fixture([], {legacy: '2'})
    const error = await legacy.escape.escapableAt({slotId: slot, requestIds: [id(1)]}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PrepaidEscapeError)
    expect(error).toMatchObject({code: 'escape_unsupported', local: true, sent: false, retryable: false})
    const odd = fixture([], {legacy: '9'})
    const other = await odd.escape.escapableAt({slotId: slot, requestIds: [id(1)]}).catch((e: unknown) => e)
    expect(other).not.toBeInstanceOf(PrepaidEscapeError)
    const unreadable = fixture([], {legacy: 'fail'})
    const failed = await unreadable.escape.escapableAt({slotId: slot, requestIds: [id(1)]}).catch((e: unknown) => e)
    expect(failed).toBeInstanceOf(Error)
    expect(failed).not.toBeInstanceOf(PrepaidEscapeError)
  })
  it('validates slot and request IDs before any RPC', async () => {
    const f = fixture([])
    for (const [slotId, requestIds] of [[h(0), [id(1)]], [slot, [h(0)]], [slot, ['0x01']], [slot, [id(1), id(1).toUpperCase().replace('0X', '0x')]],
      [slot, Array.from({length: 1025}, (_, i) => id(i))]] as const) {
      await expect(f.escape.escapableAt({slotId, requestIds: requestIds as Hex[]})).rejects.toThrow()
    }
    await expect(f.escape.escapableAt({slotId: slot, requestIds: []})).rejects.toMatchObject({code: 'empty_request', local: true})
    expect(f.trace).toHaveLength(0)
    expect(() => createPrepaidEscapeClient(f.client, {chainId: 43112, settlement: h(0, 20)})).toThrow(/deployment/)
  })
})

describe('escapePrepaid', () => {
  it('refuses locally with the opening time when a request is not yet open; nothing journaled or sent', async () => {
    const f = fixture([[id(1), open()], [id(2), later()]])
    const error = await f.run([id(1), id(2)]).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PrepaidEscapeError)
    expect(error).toMatchObject({code: 'escape_not_open', local: true, sent: false, retryable: true, requestId: id(2),
      opensAt: new Date(Number(NOW + 3n * DAY) * 1000)})
    expect(String(error)).toContain(new Date(Number(NOW + 3n * DAY) * 1000).toISOString())
    expect(f.checkpoints).toHaveLength(0)
    expect(f.sent).toHaveLength(0)
    expect(f.trace).not.toContain('eth_estimateGas')
  })
  it('refuses locally when disabled, unreserved or already complete', async () => {
    for (const [requests, delay, code, requestId] of [
      [[[id(1), open()]], 0n, 'escape_disabled', undefined],
      [[], 14n * DAY, 'reservation_unavailable', id(1)],
      [[[id(1), {cost: 10n, settled: true, escapedAt: NOW, opensAt: 0n}]], 14n * DAY, 'reservation_unavailable', id(1)],
    ] as const) {
      const f = fixture(requests as unknown as [Hex, Request][], {delay})
      const error = await f.run([id(1)]).catch((e: unknown) => e)
      expect(error, code).toMatchObject({code, local: true, retryable: false, ...(requestId ? {requestId} : {})})
      expect(f.sent).toHaveLength(0)
      expect(f.checkpoints).toHaveLength(0)
    }
  })
  it('simulates, journals before one broadcast, and confirms from the events', async () => {
    const f = fixture([[id(1), open(7n)], [id(2), open(5n)]])
    const result = await f.run([id(1), id(2)])
    expect(result).toMatchObject({slotId: slot, refunded: 12n})
    expect(result.calls).toHaveLength(1)
    expect(result.calls[0]).toMatchObject({requestIds: [id(1), id(2)], refunded: 12n, blockNumber: 21n, blockHash: blockHash(21),
      refunds: [{requestId: id(1), refunded: 7n}, {requestId: id(2), refunded: 5n}], escapeId: prepaidEscapeId(deployment, slot, [id(1), id(2)])})
    expect(f.checkpoints.map(c => c.phase)).toEqual(['prepared', 'submitted', 'confirmed'])
    expect(f.checkpoints[2]).toMatchObject({refunded: '12', blockHash: blockHash(21)})
    expect(f.trace.indexOf('eth_call')).toBeLessThan(f.trace.indexOf('prepared'))
    expect(f.trace.indexOf('prepared')).toBeLessThan(f.trace.indexOf('eth_sendTransaction'))
    expect(f.sent).toHaveLength(1)
    const record = f.prepared()[0]!.record
    expect(record.transaction).toMatchObject({chainId: 43112, from: f.payer.address, to: deployment.settlement, value: '0', nonce: 4, gas: '150000', gasPrice: '25'})
    expect(decodeFunctionData({abi: settlementAbi, data: f.sent[0]!.data})).toEqual({functionName: 'escapePrepaid', args: [slot, [id(1), id(2)]]})
    expect(f.state.requests.get(id(1))).toMatchObject({settled: true, escapedAt: NOW})
  })
  it('chunks to at most 64 requests per transaction in caller order', async () => {
    const ids = Array.from({length: 130}, (_, i) => id(i))
    const f = fixture(ids.map((requestId, i) => [requestId, open(BigInt(i + 1))]))
    const result = await f.run(ids)
    expect(f.sent.map(s => (decodeFunctionData({abi: settlementAbi, data: s.data}).args as [Hex, Hex[]])[1])).toEqual([ids.slice(0, 64), ids.slice(64, 128), ids.slice(128)])
    expect(f.sent.map(s => s.nonce)).toEqual([4, 5, 6])
    expect(result.calls.map(c => c.requestIds.length)).toEqual([64, 64, 2])
    expect(result.refunded).toBe(BigInt((130 * 131) / 2))
    expect(f.checkpoints.map(c => c.phase)).toEqual(Array(3).fill(['prepared', 'submitted', 'confirmed']).flat())
    expect(new Set(f.prepared().map(c => c.record.escapeId)).size).toBe(3)
  })
  it('maps a contract refusal found by the simulation and sends nothing for that call', async () => {
    for (const [mutate, code] of [
      [(s: State) => { s.requests.get(id(1))!.settled = true }, 'reservation_unavailable'],
      [(s: State) => { s.delay = 0n }, 'escape_disabled'],
      [(s: State) => { s.requests.get(id(1))!.opensAt = NOW + 60n }, 'escape_not_open'],
    ] as const) {
      const f = fixture([[id(1), open()]], {beforeSimulate: mutate})
      const error = await f.run([id(1)]).catch((e: unknown) => e)
      expect(error, code).toBeInstanceOf(PrepaidEscapeError)
      expect(error, code).toMatchObject({code, local: false, sent: false})
      if (code === 'escape_not_open') expect((error as PrepaidEscapeError).opensAt).toEqual(new Date(Number(NOW + 60n) * 1000))
      expect(f.checkpoints).toHaveLength(0)
      expect(f.sent).toHaveLength(0)
    }
  })
  it('a failed durable preparation prevents the broadcast', async () => {
    const f = fixture([[id(1), open()]], {failPersist: 'prepared'})
    await expect(f.run([id(1)])).rejects.toThrow('journal failed')
    expect(f.sent).toHaveLength(0)
  })
  it('refuses budgets, journal, signer chain and depth before any read', async () => {
    const f = fixture([[id(1), open()]])
    for (const override of [{maxGas: 0n}, {maxGasPrice: 0n}, {maxGas: 149_999n}, {confirmations: 0}, {receiptTimeoutMs: 120_001},
      {persist: undefined as never}]) {
      await expect(f.run([id(1)], override)).rejects.toThrow()
    }
    const other = createWalletClient({chain: {...chain, id: 1}, account: f.payer, transport: custom({request: async () => toHex(1)})})
    await expect(f.run([id(1)], {signer: other})).rejects.toThrow(/chain/)
    expect(f.sent).toHaveLength(0)
    expect(f.checkpoints).toHaveLength(0)
  })
  it('a reverted mined call is uncertain and reconciles as reverted without a resend', async () => {
    const f = fixture([[id(1), open()]], {reverts: true})
    const error = await f.run([id(1)]).catch((e: unknown) => e) as PrepaidEscapeUncertainError
    expect(error).toBeInstanceOf(PrepaidEscapeUncertainError)
    expect(error).toMatchObject({code: 'escape_uncertain', retryable: false, requestIds: [id(1)], transactionHash: f.sent[0]!.hash})
    const resolution = await f.escape.reconcileEscape({record: f.prepared()[0]!.record, transactionHash: error.transactionHash as Hex})
    expect(resolution).toMatchObject({state: 'reverted', requests: [{requestId: id(1), settled: false}]})
    expect(f.sent).toHaveLength(1)
  })
  it('events that do not match the call leave it uncertain', async () => {
    // A wrong amount, and one PrepaidEscaped per request with the right count and total but the wrong IDs.
    for (const change of [{wrongRefund: true}, {repeatFirstId: true}]) {
      const f = fixture([[id(1), open()], [id(2), open()]], change)
      await expect(f.run([id(1), id(2)])).rejects.toBeInstanceOf(PrepaidEscapeUncertainError)
      expect(f.checkpoints.map(c => c.phase)).toEqual(['prepared', 'submitted'])
      expect(f.sent).toHaveLength(1)
    }
  })
})

describe('reconcileEscape', () => {
  it('a hashless lost broadcast that mined reconciles as completed by reading state, never resending', async () => {
    const f = fixture([[id(1), open()], [id(2), open()]], {failSend: 'lost-after-mine'})
    const error = await f.run([id(1), id(2)]).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PrepaidEscapeUncertainError)
    expect(error).toMatchObject({transactionHash: undefined})
    expect(f.checkpoints.map(c => c.phase)).toEqual(['prepared'])
    const start = f.trace.length
    const resolution = await f.escape.reconcileEscape({record: f.prepared()[0]!.record})
    expect(resolution).toMatchObject({state: 'completed', blockNumber: 21n, requests: [
      {requestId: id(1), settled: true, escapedAt: new Date(Number(NOW) * 1000)}, {requestId: id(2), settled: true, escapedAt: new Date(Number(NOW) * 1000)}]})
    expect(f.trace.slice(start).some(m => /send/.test(m))).toBe(false)
    expect(f.sent).toHaveLength(1)
  })
  it('a locally signed lost broadcast is journaled with its hash and reconciles as escaped', async () => {
    const f = fixture([[id(1), open(9n)]], {localSigner: true, failSend: 'lost-after-mine'})
    const error = await f.run([id(1)]).catch((e: unknown) => e) as PrepaidEscapeUncertainError
    const prepared = f.prepared()[0]!
    expect(prepared.transactionHash).toBe(f.sent[0]!.hash)
    expect(error.transactionHash).toBe(prepared.transactionHash)
    expect(f.trace.indexOf('prepared')).toBeLessThan(f.trace.indexOf('eth_sendRawTransaction'))
    expect(await f.escape.reconcileEscape({record: prepared.record, transactionHash: prepared.transactionHash!}))
      .toMatchObject({state: 'escaped', refunded: 9n, transactionHash: prepared.transactionHash})
    expect(f.sent).toHaveLength(1)
  })
  it('stays uncertain while the nonce is unspent, and is not-escaped once another transaction spends it', async () => {
    const f = fixture([[id(1), open()]], {failSend: 'lost-before-mine'})
    await expect(f.run([id(1)])).rejects.toBeInstanceOf(PrepaidEscapeUncertainError)
    const record = f.prepared()[0]!.record
    expect(await f.escape.reconcileEscape({record})).toMatchObject({state: 'uncertain', requests: [{requestId: id(1), settled: false}]})
    // A broadcast the node accepted but has not mined, and a hash the node never saw, are both still uncertain.
    expect(await f.escape.reconcileEscape({record, transactionHash: f.sent[0]!.hash})).toMatchObject({state: 'uncertain', transactionHash: f.sent[0]!.hash})
    expect(await f.escape.reconcileEscape({record, transactionHash: h(77)})).toMatchObject({state: 'uncertain'})
    f.state.nonce = 5 // another transaction from the payer used nonce 4
    expect(await f.escape.reconcileEscape({record})).toMatchObject({state: 'not-escaped'})
    // A request reconciled by the network meanwhile is final: the call has nothing left to do.
    f.state.requests.get(id(1))!.settled = true
    expect(await f.escape.reconcileEscape({record})).toMatchObject({state: 'completed', requests: [{requestId: id(1), settled: true}]})
    expect(f.sent).toHaveLength(1)
  })
  it('refuses a different candidate transaction and corrupt records before concluding', async () => {
    const f = fixture([[id(1), open()]])
    const result = await f.run([id(1)])
    const record = f.prepared()[0]!.record
    expect(await f.escape.reconcileEscape({record, transactionHash: result.calls[0]!.transactionHash})).toMatchObject({state: 'escaped'})
    for (const edit of [(r: typeof record) => { r.transaction.nonce = 9 }, (r: typeof record) => { r.transaction.gas = '1' }]) {
      const changed = structuredClone(record); edit(changed)
      await expect(f.escape.reconcileEscape({record: changed, transactionHash: result.calls[0]!.transactionHash})).rejects.toThrow(/candidate/)
    }
    for (const edit of [(r: typeof record) => { r.escapeId = h(9) }, (r: typeof record) => { r.requestIds = [id(2)] }, (r: typeof record) => { r.transaction.to = h(9, 20) },
      (r: typeof record) => { r.transaction.data = '0xdead' }, (r: typeof record) => { (r as {schema: number}).schema = 2 }]) {
      const changed = structuredClone(record); edit(changed)
      await expect(f.escape.reconcileEscape({record: changed})).rejects.toThrow(/record|request/)
    }
    await expect(f.escape.reconcileEscape({record, confirmations: 65})).rejects.toThrow(/confirmations/)
    await expect(f.escape.reconcileEscape({record, transactionHash: h(0)})).rejects.toThrow(/hash/)
    // Deeper confirmation: the observation moves to head - 1 once a later block exists.
    await expect(f.escape.reconcileEscape({record, transactionHash: result.calls[0]!.transactionHash, confirmations: 2})).resolves.toMatchObject({blockNumber: 20n})
    f.state.head += 1
    expect(await f.escape.reconcileEscape({record, transactionHash: result.calls[0]!.transactionHash, confirmations: 2}))
      .toMatchObject({state: 'escaped', blockNumber: 21n, refunded: 10n})
    expect(f.sent).toHaveLength(1)
  })
})

describe('contract error mapping', () => {
  const wrap = (data: Hex) => Object.assign(new Error('outer'), {cause: Object.assign(new Error('inner'), {cause: revert(data)})})
  it('maps every escape error to a stable code', () => {
    const cases = [
      [contractError('EscapeDisabled'), {code: 'escape_disabled', retryable: false}],
      [contractError('EscapeNotOpen', [id(1), NOW + 10n]), {code: 'escape_not_open', requestId: id(1), opensAt: new Date(Number(NOW + 10n) * 1000), retryable: true}],
      [contractError('ReservationUnavailable', [id(2)]), {code: 'reservation_unavailable', requestId: id(2)}],
      [contractError('InvalidEscapeDelay', [60n]), {code: 'invalid_escape_delay', delaySeconds: 60n}],
      [contractError('TooManyCovered', [65n, 64n]), {code: 'too_many_requests'}],
      [contractError('EmptyBundle'), {code: 'empty_request'}],
    ] as const
    for (const [data, expected] of cases) {
      const mapped = decodePrepaidEscapeRevert(wrap(data))
      expect(mapped, expected.code).toBeInstanceOf(PrepaidEscapeError)
      expect(mapped).toMatchObject({...expected, local: false, sent: false})
      expect(isPrepaidEscapeError(mapped)).toBe(true)
    }
    expect(decodePrepaidEscapeRevert(wrap(contractError('ZeroBatchId')))).toBeUndefined()
    expect(decodePrepaidEscapeRevert(new Error('socket hang up'))).toBeUndefined()
    expect(decodePrepaidEscapeRevert(wrap('0xdeadbeef'))).toBeUndefined()
    // An out-of-range opening time is reported without a date rather than throwing.
    const far = decodePrepaidEscapeRevert(wrap(contractError('EscapeNotOpen', [id(1), (1n << 64n) - 1n])))
    expect(far).toMatchObject({code: 'escape_not_open', requestId: id(1)})
    expect(far?.opensAt).toBeUndefined()
  })
  it('gives every code a stable message without a caller-supplied one', () => {
    for (const [code, text] of [['escape_disabled', /disabled/], ['escape_not_open', /opens at/], ['reservation_unavailable', /not reserved/],
      ['invalid_escape_delay', /delay 9 s/], ['too_many_requests', /too many/], ['empty_request', /at least one/], ['escape_unsupported', /no prepaid timeout escape/]] as const) {
      const error = new PrepaidEscapeError({code, local: true, delaySeconds: 9n})
      expect(error.message, code).toMatch(text)
      expect(error.message).toMatch(/nothing was sent/)
      expect(error.retryable).toBe(code === 'escape_not_open')
    }
  })
  it('decodes escape logs only from the approved Settlement and refuses a removed log', () => {
    const where = {blockHash: h(7), blockNumber: 1n, transactionHash: h(8), transactionIndex: 0, logIndex: 0}
    const escapedLog = {...where, address: deployment.settlement, removed: false, data: encodeAbiParameters([{type: 'uint256'}], [3n]),
      topics: encodeEventTopics({abi: settlementAbi, eventName: 'PrepaidEscaped', args: {slotId: slot, requestId: id(1)}}) as [Hex, ...Hex[]]}
    const foreign = {...escapedLog, address: h(9, 20)}
    expect(decodePrepaidEscapeLogs([escapedLog, foreign], deployment.settlement)).toEqual({escaped: [{slotId: slot, requestId: id(1), refunded: 3n}], batches: []})
    expect(() => decodePrepaidEscapeLogs([{...escapedLog, removed: true}], deployment.settlement)).toThrow(/reorganization/)
  })
})
