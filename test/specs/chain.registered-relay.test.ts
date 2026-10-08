import {beforeEach, describe, expect, it, vi} from 'vitest'
import {createWalletClient, defineChain, encodeAbiParameters, encodeEventTopics, encodeFunctionData, http, type Address, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import type {TasraChainClient} from '../../src/chain/client.js'
import {authenticateApprovedService} from '../../src/chain/serviceIdentity.js'
import {createRegisteredRelaySubmitter, isRelayBusyReason, reconcileRelayAttempt, relayForwarderAbi, RelayOutcomeUnknownError, type RelayAttempt, type RelayTransport} from '../../src/chain/registeredRelay.js'
import type {ServiceApproval} from '../../src/chain/services.js'

vi.mock('../../src/chain/serviceIdentity.js', async original => ({...await original<typeof import('../../src/chain/serviceIdentity.js')>(), authenticateApprovedService: vi.fn()}))

const address = (byte: string) => `0x${byte.repeat(20)}` as Address
const hash = (byte: string) => `0x${byte.repeat(32)}` as Hex
const forwarder = address('11'), target = address('22'), txHash = hash('33')
const account = privateKeyToAccount(hash('01'))
const chainDef = defineChain({id: 31337, name: 'fixture', nativeCurrency: {name: 'ETH', symbol: 'ETH', decimals: 18}, rpcUrls: {default: {http: ['http://localhost:1']}}})
const approval = (id: string): ServiceApproval => ({chainId: 31337, registry: address('44'), serviceId: hash(id), owner: address('55'), revision: 1n, manifestHash: hash('66'), serviceType: 0})
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

beforeEach(() => {
  vi.mocked(authenticateApprovedService).mockReset()
  vi.mocked(authenticateApprovedService).mockImplementation(async (_, a) => ({record: {endpoint: `https://${a.serviceId.slice(2, 4)}.example.com`}, manifest: {capabilities: ['relay-forward']}} as Awaited<ReturnType<typeof authenticateApprovedService>>))
})

function harness() {
  let nonce = 0n, expired = false
  let request: RelayAttempt['request'] | undefined
  const wallet = createWalletClient({account, chain: chainDef, transport: http('http://localhost:1')})
  const sign = vi.spyOn(wallet, 'signTypedData')
  const logs = () => [{address: forwarder, transactionHash: txHash,
    data: encodeAbiParameters([{type: 'uint256'}, {type: 'bool'}], [0n, true]),
    topics: encodeEventTopics({abi: relayForwarderAbi, eventName: 'ExecutedForwardRequest', args: {signer: account.address}}),
    args: {signer: account.address, nonce: 0n, success: true}}]
  const client = {
    getChainId: vi.fn(async () => 31337), getBlockNumber: vi.fn(async () => 10n),
    getBlock: vi.fn(async () => ({number: 11n, timestamp: BigInt(Math.floor(Date.now() / 1000) + (expired ? 1_000 : 0))})),
    readContract: vi.fn(async () => nonce), estimateGas: vi.fn(async () => 100_000n),
    getTransaction: vi.fn(async () => ({to: forwarder, value: 0n, input: encodeFunctionData({abi: relayForwarderAbi, functionName: 'execute', args: [{...request!, value: 0n, gas: BigInt(request!.gas)}]})})),
    getTransactionReceipt: vi.fn(async () => ({status: 'success', logs: logs(), gasUsed: 125_000n, effectiveGasPrice: 2n})),
    getLogs: vi.fn(async () => logs()),
  }
  const chain = {client} as unknown as TasraChainClient
  const bodies: Uint8Array[] = []
  const transport: RelayTransport = {request: vi.fn(), relayRequest: vi.fn(async (_url, {body}) => {
    if (body) { bodies.push(body); request = JSON.parse(new TextDecoder().decode(body)); nonce = 1n; return encode({state: 'queued'}) }
    return encode({id: 'ignored', state: 'unknown'})
  })}
  const submitter = (overrides: Partial<Parameters<typeof createRegisteredRelaySubmitter>[1]> = {}) => createRegisteredRelaySubmitter(chain,
    {approvals: [approval('01'), approval('02')], forwarder, transport, attemptMs: 1, pollMs: 10, ...overrides}, wallet)
  return {chain, client, wallet, sign, transport, bodies, submitter,
    setNonce: (value: bigint) => { nonce = value }, expire: () => { expired = true },
    setRequest: (body: Uint8Array) => { bodies.push(body); request = JSON.parse(new TextDecoder().decode(body)) }}
}

describe('approved registered relayer writes', () => {
  it('recovers an executed call after both HTTP responses are lost without contacting another provider', async () => {
    const h = harness()
    vi.mocked(h.transport.relayRequest).mockImplementation(async (_, {body}) => {
      if (body) { h.setRequest(body); h.setNonce(1n) }
      throw new Error('connection lost')
    })
    const result = await h.submitter().submit(target, '0x12345678')
    expect(result.txHash).toBe(txHash)
    expect(result.costWei).toBe('250000')
    expect(authenticateApprovedService).toHaveBeenCalledTimes(1)
    expect(h.sign).toHaveBeenCalledTimes(1)
    expect(h.bodies).toHaveLength(1)
  })

  it('reconciles the nonce then retries exactly the same signed bytes at an authenticated second provider', async () => {
    const h = harness()
    vi.mocked(h.transport.relayRequest).mockImplementation(async (url, {body}) => {
      if (body) { h.setRequest(body); if (url.includes('02.example')) h.setNonce(1n) }
      throw new Error('lost status')
    })
    expect((await h.submitter().submit(target, '0x12345678')).txHash).toBe(txHash)
    expect(authenticateApprovedService).toHaveBeenCalledTimes(2)
    expect(h.sign).toHaveBeenCalledTimes(1)
    expect(h.bodies).toHaveLength(2)
    expect(h.bodies[0]).toEqual(h.bodies[1])
  })

  it('refuses a relayer-supplied hash for another call and prevents another signature while unresolved', async () => {
    const h = harness()
    let saved: RelayAttempt | undefined
    const relay = h.submitter({maxAttempts: 1, persistAttempt: async a => { saved = a }})
    vi.mocked(h.transport.relayRequest).mockImplementation(async (_, {body}) => {
      if (body) { h.setRequest(body); return encode({state: 'queued'}) }
      return encode({id: saved!.id, state: 'mined', tx_hash: txHash})
    })
    h.client.getTransaction.mockResolvedValue({to: address('99'), value: 0n, input: '0x'})
    await expect(relay.submit(target, '0x12345678')).rejects.toBeInstanceOf(RelayOutcomeUnknownError)
    expect(h.client.getTransaction).toHaveBeenCalled()
    await expect(relay.submit(target, '0x12345678')).rejects.toBeInstanceOf(RelayOutcomeUnknownError)
    expect(h.sign).toHaveBeenCalledTimes(1)
    h.expire()
    expect(await relay.reconcile()).toEqual({expired: true})
    expect(relay.pendingAttempt()).toBeUndefined()
  })

  it('does not mistake a nonce consumed by a different request for success', async () => {
    const h = harness()
    h.client.getLogs.mockResolvedValue([])
    await expect(h.submitter().submit(target, '0x12345678')).rejects.toThrow('Nonce consumed without a matching')
    expect(h.bodies).toHaveLength(1)
  })

  it('bounds a transport that ignores cancellation and preserves a reconciliation handle', async () => {
    const h = harness()
    let saved: RelayAttempt | undefined
    vi.mocked(h.transport.relayRequest).mockImplementation(() => new Promise(() => {}))
    const relay = h.submitter({timeoutMs: 100, persistAttempt: async a => { saved = a }})
    await expect(relay.submit(target, '0x12345678')).rejects.toBeInstanceOf(RelayOutcomeUnknownError)
    expect(saved).toEqual(relay.pendingAttempt())
    expect(h.transport.relayRequest).toHaveBeenCalledTimes(1)
    h.expire()
    expect(await reconcileRelayAttempt(h.chain, JSON.parse(JSON.stringify(saved)) as RelayAttempt)).toEqual({expired: true})
  })

  it('does not POST to unauthenticated or draining candidates', async () => {
    const h = harness()
    vi.mocked(authenticateApprovedService).mockRejectedValue(new Error('stale approval'))
    await expect(h.submitter().submit(target, '0x12345678')).rejects.toThrow('No approved relayer authenticated')
    expect(h.transport.relayRequest).not.toHaveBeenCalled()
  })

  it('rejects agent approvals and inexact JSON nonces before asking for a signature', async () => {
    const h = harness()
    expect(() => h.submitter({approvals: [{...approval('01'), serviceType: 1}]})).toThrow('Invalid registered')
    h.setNonce(BigInt(Number.MAX_SAFE_INTEGER) + 1n)
    await expect(h.submitter().submit(target, '0x12345678')).rejects.toThrow('exact JSON integer')
    expect(h.sign).not.toHaveBeenCalled()
  })

  it('serializes concurrent calls and signs the second only after the first nonce is reconciled', async () => {
    const h = harness()
    const relay = h.submitter()
    h.client.getLogs.mockImplementation(async () => {
      const nonce = BigInt(h.bodies.length - 1)
      return [{address: forwarder, transactionHash: txHash, args: {signer: account.address, nonce, success: true},
        data: encodeAbiParameters([{type: 'uint256'}, {type: 'bool'}], [nonce, true]),
        topics: encodeEventTopics({abi: relayForwarderAbi, eventName: 'ExecutedForwardRequest', args: {signer: account.address}})}]
    })
    h.client.getTransactionReceipt.mockImplementation(async () => ({status: 'success', logs: await h.client.getLogs(), gasUsed: 125_000n, effectiveGasPrice: 2n}))
    vi.mocked(h.transport.relayRequest).mockImplementation(async (_, {body}) => {
      if (body) { h.setRequest(body); h.setNonce(BigInt(h.bodies.length)) }
      throw new Error('lost response')
    })
    await Promise.all([relay.submit(target, '0x12345678'), relay.submit(target, '0x12345679')])
    expect(h.bodies.map(b => (JSON.parse(new TextDecoder().decode(b)) as {nonce: number}).nonce)).toEqual([0, 1])
  })
})

describe('durable application relay recovery', () => {
  it('reuses a verified receipt after restart without signing or posting again', async () => {
    const h = harness(); let saved: RelayAttempt | undefined
    await h.submitter({persistAttempt: async a => { saved = JSON.parse(JSON.stringify(a)) as RelayAttempt }}).submit(target, '0x12345678')
    const resumed = h.submitter({resumeAttempt: async () => saved})
    expect((await resumed.submit(target, '0x12345678')).txHash).toBe(txHash)
    expect(h.sign).toHaveBeenCalledTimes(1)
    expect(h.bodies).toHaveLength(1)
    await expect(h.submitter({resumeAttempt: async () => saved}).submit(target, '0x99999999')).rejects.toThrow(/does not match/)
    expect(h.sign).toHaveBeenCalledTimes(1)
  })
  it('refuses another signature while the persisted attempt remains unresolved', async () => {
    const h = harness(); let saved: RelayAttempt | undefined
    vi.mocked(h.transport.relayRequest).mockImplementation(async (_, {body}) => {
      if (body) h.setRequest(body)
      throw new Error('submission result lost')
    })
    await expect(h.submitter({maxAttempts: 1, persistAttempt: async a => { saved = a }}).submit(target, '0x12345678')).rejects.toBeInstanceOf(RelayOutcomeUnknownError)
    await expect(h.submitter({resumeAttempt: async () => saved}).submit(target, '0x12345678')).rejects.toBeInstanceOf(RelayOutcomeUnknownError)
    expect(h.sign).toHaveBeenCalledTimes(1)
    expect(h.bodies).toHaveLength(1)
  })
})

// Reason texts are the relayer's Display strings (keykeeper-relayer policy.rs Reject).
const BUSY = ['relayer busy: the deferrable queue is full; retry shortly or submit directly',
  'relayer busy: the request journal is full; retry shortly or submit directly',
  'relayer busy: the shared sponsorship budget is unavailable; retry shortly or submit directly']
const rejected = (reason: string) => ({status: 422, body: encode({id: '', state: 'rejected', reason}), retryAfterMs: 0})

describe('relayer busy refusals', () => {
  it('classifies only load refusals as busy', () => {
    for (const reason of BUSY) expect(isRelayBusyReason(reason)).toBe(true)
    for (const reason of ['shared daily spend cap reached', 'daily spend cap reached', 'per-signer gas quota exceeded for this window',
      'no hot key is above the balance floor', 'duplicate request', 'bad request: relayer busy:', undefined, 7, 'relayer busy:' + 'x'.repeat(600)])
      expect(isRelayBusyReason(reason)).toBe(false)
  })

  it.each(BUSY)('re-sends the identical signed request to the same provider after Retry-After (%s)', async reason => {
    const h = harness()
    const urls: string[] = []
    h.transport.relayExchange = vi.fn(async (url: string, {body}: {body?: Uint8Array}) => {
      urls.push(url); h.setRequest(body!)
      if (urls.length < 3) return rejected(reason)
      h.setNonce(1n); return {status: 202, body: encode({id: 'x', state: 'queued'})}
    })
    expect((await h.submitter().submit(target, '0x12345678')).txHash).toBe(txHash)
    expect(h.sign).toHaveBeenCalledTimes(1)
    expect(h.bodies).toHaveLength(3)
    expect(h.bodies[1]).toEqual(h.bodies[0]); expect(h.bodies[2]).toEqual(h.bodies[0])
    expect(new Set(urls)).toEqual(new Set(['https://01.example.com/v1/relay/forward']))
    expect(authenticateApprovedService).toHaveBeenCalledTimes(1)
  })

  it('does not re-send after a non-busy refusal and bounds busy re-sends per provider', async () => {
    const g = harness()
    const seen: string[] = []
    g.transport.relayExchange = vi.fn(async (url: string, {body}: {body?: Uint8Array}) => {
      seen.push(url); g.setRequest(body!)
      return url.includes('01.') ? rejected('shared daily spend cap reached') : rejected(BUSY[1]!)
    })
    await expect(g.submitter({busyRetries: 2, timeoutMs: 2_000}).submit(target, '0x12345678')).rejects.toBeInstanceOf(RelayOutcomeUnknownError)
    expect(seen.filter(u => u.includes('01.'))).toHaveLength(1)
    expect(seen.filter(u => u.includes('02.'))).toHaveLength(3)
    expect(g.sign).toHaveBeenCalledTimes(1)
    expect(new Set(g.bodies.map(b => new TextDecoder().decode(b))).size).toBe(1)
  })

  it('refuses an out-of-range busy retry budget', () => {
    const h = harness()
    expect(() => h.submitter({busyRetries: 6})).toThrow('Invalid registered')
    expect(() => h.submitter({busyRetries: -1})).toThrow('Invalid registered')
  })
})

describe('relayer busy status', () => {
  it('re-sends the identical request when the status reports a busy refusal', async () => {
    const h = harness()
    let posts = 0, statuses = 0
    h.transport.relayExchange = vi.fn(async (_url: string, {body}: {body?: Uint8Array}) => {
      posts++; h.setRequest(body!)
      if (posts === 2) h.setNonce(1n)
      return {status: 202, body: encode({id: 'x', state: 'queued'})}
    })
    const relay = h.submitter({attemptMs: 5_000})
    vi.mocked(h.transport.relayRequest).mockImplementation(async () => {
      statuses++
      return encode({id: relay.pendingAttempt()!.id, state: 'rejected', reason: BUSY[0]})
    })
    expect((await relay.submit(target, '0x12345678')).txHash).toBe(txHash)
    expect(posts).toBe(2)
    expect(statuses).toBeGreaterThanOrEqual(1)
    expect(new Set(h.bodies.map(b => new TextDecoder().decode(b))).size).toBe(1)
  })
})
