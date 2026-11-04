import {beforeEach, describe, expect, it, vi} from 'vitest'
import {createWalletClient, defineChain, encodeAbiParameters, encodeEventTopics, encodeFunctionData, http, sha256, type Address, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import type {TasraChainClient} from '../../src/chain/client.js'
import {authenticateApprovedService} from '../../src/chain/serviceIdentity.js'
import {createRegisteredRelaySubmitter, isRelayBusyReason, reconcileRelayAttempt, relayForwarderAbi, RelayOutcomeUnknownError, type RelayAttempt, type RelayTransport} from '../../src/chain/registeredRelay.js'
import type {ServiceApproval} from '../../src/chain/services.js'
import {assertRelayVoucherIntent, assertRelayVoucher, type RelayVoucher, type RelayVoucherIntent} from '../../src/chain/relayVoucher.js'
import {requestHash} from '../../src/oid4vp/binding.js'
import {hexToBytes, bytesToHex} from '../../src/crypto/hex.js'

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
    // timeoutMs bounds how long the LAST provider is watched; fixtures that never execute end there.
    {approvals: [approval('01'), approval('02')], forwarder, transport, attemptMs: 1, pollMs: 10, timeoutMs: 300, ...overrides}, wallet)
  return {chain, client, wallet, sign, transport, bodies, submitter,
    setNonce: (value: bigint) => { nonce = value }, expire: () => { expired = true },
    setRequest: (body: Uint8Array) => { bodies.push(body); request = JSON.parse(new TextDecoder().decode(body)) }}
}

const sponsorSlot = hash('77')
function sponsorIntent(a: RelayAttempt): RelayVoucherIntent {
  return {operation: {chain_id: a.chainId, slot_id: sponsorSlot, action: 'relay', payload_digest: sha256(a.id), description: 'Sponsor this exact request', exp: a.request.deadline},
    operation_sig: `0x${'aa'.repeat(65)}`, delegation: {chain_id: a.chainId, slot_ids: [sponsorSlot], actions: ['relay'], delegate: account.address,
      nonce: 1, exp: a.request.deadline + 100, signature: `0x${'bb'.repeat(65)}`}, message_hex: a.id, sponsorship_slot: sponsorSlot}
}
function voucher(a: RelayAttempt): RelayVoucher {
  const now = Math.floor(Date.now() / 1000)
  return {compound_token: {token_type: 'JWT', seed: hash('01'), epoch: 1, slot_id: sponsorSlot, vp_hash: hash('02'), holder_hash: hash('03'), rule_hash: hash('04'),
    request_hash: bytesToHex(requestHash(a.chainId, hexToBytes(sponsorSlot), 'relay', hexToBytes(sha256(a.id)))), binding: 'holder_key', verifier_indexes: [0], iat: now, exp: now + 120,
    signatures: [{verifier_index: 0, signature: `0x${'ab'.repeat(64)}`}]}, verifier_proofs: [{verifier_index: 0, operator: account.address, pubkey: hash('05'), proof: []}]}
}

describe('user-class sponsored relay writes', () => {
  function sponsored() {
    const h = harness(), persisted: RelayAttempt[] = [], calls: string[] = []
    let latest: RelayAttempt | undefined
    const authorize = vi.fn(async ({attempt}: {attempt: RelayAttempt}) => voucher(attempt))
    const persistAttempt = vi.fn(async (a: RelayAttempt) => { latest = a; persisted.push(structuredClone(a)); calls.push(a.voucher ? 'persist-voucher' : 'persist-request') })
    vi.mocked(h.transport.relayRequest).mockImplementation(async (url, {body}) => {
      calls.push(url.endsWith('voucher-intent') ? 'intent' : body ? 'forward' : 'status')
      if (url.endsWith('voucher-intent')) return encode(sponsorIntent(latest!))
      if (body) { h.setRequest(body); h.setNonce(1n) }
      throw new Error('lost response')
    })
    const config = {sponsorship: {slotId: sponsorSlot, authorize}, persistAttempt}
    return {...h, persisted, calls, authorize, persistAttempt, config, latest: () => latest}
  }

  it('obtains a bound voucher through an authenticated provider and persists it before the original call', async () => {
    const h = sponsored()
    expect((await h.submitter(h.config).submit(target, '0x12345678')).txHash).toBe(txHash)
    expect(h.calls).toEqual(['persist-request', 'intent', 'persist-voucher', 'forward', 'status'])
    expect(h.sign).toHaveBeenCalledTimes(1)
    expect(h.authorize).toHaveBeenCalledTimes(1)
    const context = h.authorize.mock.calls[0]![0]
    expect(context.attempt.id).toBe(h.persisted[0]!.id)
    expect(h.persisted[1]!.request).toEqual(h.persisted[0]!.request)
    expect(JSON.parse(new TextDecoder().decode(h.bodies[0])).voucher).toEqual(h.persisted[1]!.voucher)
  })

  it('requires durable storage and an independently approved slot', () => {
    const h = harness()
    expect(() => h.submitter({sponsorship: {slotId: sponsorSlot, authorize: async () => { throw new Error('unused') }}})).toThrow('durable persistence')
    expect(() => h.submitter({sponsorship: {slotId: hash('00'), authorize: async () => { throw new Error('unused') }}, persistAttempt: async () => {}})).toThrow('approved slot')
  })

  it.each(['chain', 'slot', 'message', 'digest', 'expiry', 'delegation'] as const)('refuses a mismatched %s intent before wallet consent or a forward POST', async changed => {
    const h = sponsored()
    vi.mocked(h.transport.relayRequest).mockImplementation(async () => {
      const i = sponsorIntent(h.latest()!)
      if (changed === 'chain') i.operation.chain_id++
      if (changed === 'slot') i.sponsorship_slot = hash('88')
      if (changed === 'message') i.message_hex = hash('88')
      if (changed === 'digest') i.operation.payload_digest = hash('88')
      if (changed === 'expiry') i.operation.exp++
      if (changed === 'delegation') i.delegation.actions = ['sign']
      return encode(i)
    })
    await expect(h.submitter(h.config).submit(target, '0x12345678')).rejects.toThrow('does not bind')
    expect(h.authorize).not.toHaveBeenCalled()
    expect(h.bodies).toHaveLength(0)
  })

  it('does not forward or replace the request when the wallet refuses', async () => {
    const h = sponsored()
    h.authorize.mockRejectedValue(new Error('wallet declined'))
    await expect(h.submitter(h.config).submit(target, '0x12345678')).rejects.toThrow('wallet declined')
    expect(h.calls).toEqual(['persist-request', 'intent'])
    expect(h.sign).toHaveBeenCalledTimes(1)
    expect(h.persisted).toHaveLength(1)
  })

  it('refuses a wallet result for another request before any gas-spending POST', async () => {
    const h = sponsored()
    h.authorize.mockImplementation(async ({attempt}) => { const v = voucher(attempt); v.compound_token.request_hash = hash('ff'); return v })
    await expect(h.submitter(h.config).submit(target, '0x12345678')).rejects.toThrow('does not bind')
    expect(h.calls).toEqual(['persist-request', 'intent'])
    expect(h.bodies).toHaveLength(0)
  })

  it('does not spend gas when retaining the voucher fails', async () => {
    const h = sponsored()
    const persistAttempt = async (a: RelayAttempt) => { if (a.voucher) throw new Error('storage unavailable'); await h.persistAttempt(a) }
    await expect(h.submitter({...h.config, persistAttempt}).submit(target, '0x12345678')).rejects.toThrow('storage unavailable')
    expect(h.calls).toEqual(['persist-request', 'intent'])
    expect(h.bodies).toHaveLength(0)
  })

  it('does not obtain an intent or show a wallet prompt for unauthenticated services', async () => {
    const h = sponsored()
    vi.mocked(authenticateApprovedService).mockRejectedValue(new Error('unapproved identity'))
    await expect(h.submitter(h.config).submit(target, '0x12345678')).rejects.toThrow('No approved relayer authenticated')
    expect(h.calls).toEqual(['persist-request'])
    expect(h.authorize).not.toHaveBeenCalled()
  })

  it('resumes the exact retained voucher and signature after a lost POST without a second wallet session', async () => {
    const h = sponsored()
    vi.mocked(h.transport.relayRequest).mockImplementation(async (url, {body}) => {
      if (url.endsWith('voucher-intent')) return encode(sponsorIntent(h.latest()!))
      if (body) h.setRequest(body)
      throw new Error('offline')
    })
    await expect(h.submitter({...h.config, maxAttempts: 1}).submit(target, '0x12345678')).rejects.toBeInstanceOf(RelayOutcomeUnknownError)
    const original = structuredClone(h.latest()!)
    vi.mocked(h.transport.relayRequest).mockImplementation(async (_, {body}) => {
      if (body) { h.setRequest(body); h.setNonce(1n) }
      throw new Error('lost response')
    })
    expect((await h.submitter({...h.config, resumeAttempt: async () => original}).submit(target, '0x12345678')).txHash).toBe(txHash)
    expect(h.sign).toHaveBeenCalledTimes(1)
    expect(h.authorize).toHaveBeenCalledTimes(1)
    expect(h.bodies[1]).toEqual(h.bodies[0])
  })

  it('uses one voucher and identical bytes across authenticated alternative providers', async () => {
    const h = sponsored()
    vi.mocked(h.transport.relayRequest).mockImplementation(async (url, {body}) => {
      if (url.endsWith('voucher-intent')) return encode(sponsorIntent(h.latest()!))
      if (body) { h.setRequest(body); if (url.includes('02.example')) h.setNonce(1n) }
      throw new Error('lost response')
    })
    expect((await h.submitter(h.config).submit(target, '0x12345678')).txHash).toBe(txHash)
    expect(h.sign).toHaveBeenCalledTimes(1)
    expect(h.authorize).toHaveBeenCalledTimes(1)
    expect(h.bodies).toHaveLength(2)
    expect(h.bodies[1]).toEqual(h.bodies[0])
  })

  it('keeps the original voucher and signature during busy backoff', async () => {
    const h = sponsored()
    let sends = 0
    h.transport.relayExchange = async (_, {body}) => {
      h.setRequest(body!)
      if (++sends === 1) return {status: 422, body: encode({state: 'rejected', reason: 'relayer busy: full lane'}), retryAfterMs: 0}
      h.setNonce(1n)
      return {status: 202, body: encode({state: 'queued'})}
    }
    expect((await h.submitter(h.config).submit(target, '0x12345678')).txHash).toBe(txHash)
    expect(sends).toBe(2)
    expect(h.bodies[0]).toEqual(h.bodies[1])
    expect(h.sign).toHaveBeenCalledTimes(1)
    expect(h.authorize).toHaveBeenCalledTimes(1)
  })

  it('refuses a replacement for a consumed nonce outside the reconciliation window', async () => {
    const h = sponsored()
    vi.mocked(h.transport.relayRequest).mockImplementation(async (url, {body}) => {
      if (url.endsWith('voucher-intent')) return encode(sponsorIntent(h.latest()!))
      if (body) h.setRequest(body)
      throw new Error('offline')
    })
    await expect(h.submitter({...h.config, maxAttempts: 1}).submit(target, '0x12345678')).rejects.toBeInstanceOf(RelayOutcomeUnknownError)
    const original = structuredClone(h.latest()!)
    h.setNonce(1n)
    h.client.getBlock.mockResolvedValue({number: 20_050n, timestamp: BigInt(Math.floor(Date.now() / 1000))})
    await expect(h.submitter({...h.config, resumeAttempt: async () => original}).submit(target, '0x12345678')).rejects.toBeInstanceOf(RelayOutcomeUnknownError)
    expect(h.bodies).toHaveLength(1)
    expect(h.sign).toHaveBeenCalledTimes(1)
    expect(h.authorize).toHaveBeenCalledTimes(1)
  })

  it('refuses foreign, paid or proofless wallet results before a forward POST', async () => {
    const h = sponsored()
    await h.submitter(h.config).submit(target, '0x12345678')
    const a = h.persisted[0]!
    const foreign = voucher(a); foreign.compound_token.request_hash = hash('ff')
    expect(() => assertRelayVoucher(foreign, a, sponsorSlot)).toThrow('does not bind')
    const paid = voucher(a); paid.compound_token.payment_hash = hash('ff')
    expect(() => assertRelayVoucher(paid, a, sponsorSlot)).toThrow('does not bind')
    const noProof = voucher(a); noProof.verifier_proofs = []
    expect(() => assertRelayVoucher(noProof, a, sponsorSlot)).toThrow('does not bind')
    expect(() => assertRelayVoucherIntent(sponsorIntent(a), a, hash('88'))).toThrow('does not bind')
  })
})

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

  it('keeps watching the last provider for the whole budget instead of failing over to nobody', async () => {
    // Certification run 38: the only approved relayer, serialising several applications, mined the
    // forward 18 s after acceptance while attemptMs (the failover window) was 10 s.
    const h = harness()
    vi.mocked(h.transport.relayRequest).mockImplementation(async (_, {body}) => {
      if (body) { h.setRequest(body); setTimeout(() => h.setNonce(1n), 150); return encode({state: 'queued'}) }
      return encode({id: saved!.id, state: 'queued'})
    })
    let saved: RelayAttempt | undefined
    const relay = h.submitter({approvals: [approval('01')], attemptMs: 20, pollMs: 10, timeoutMs: 5_000, persistAttempt: async a => { saved = a }})
    const result = await relay.submit(target, '0x12345678')
    expect(result.txHash).toBe(txHash)
    expect(relay.pendingAttempt()).toBeUndefined()
    expect(h.bodies).toHaveLength(1)
    expect(h.sign).toHaveBeenCalledTimes(1)
  })

  it('stops promptly with the reason when the only provider refuses the request outright', async () => {
    // Certification run 42: an identity-budget refusal was ignored and the provider was then watched
    // for the whole relay budget, reporting only "Relay deadline exceeded".
    const h = harness()
    let statuses = 0
    h.transport.relayExchange = vi.fn(async (_url: string, {body}: {body?: Uint8Array}) => {
      h.setRequest(body!)
      return {status: 422, body: encode({id: 'x', state: 'rejected', reason: "identity budget: this holder's daily sponsorship budget is used up"})}
    })
    vi.mocked(h.transport.relayRequest).mockImplementation(async () => { statuses++; throw new Error('unknown request id') })
    const relay = h.submitter({approvals: [approval('01')], attemptMs: 20, pollMs: 10, timeoutMs: 5_000})
    const started = Date.now()
    const error = await relay.submit(target, '0x12345678').catch((e: unknown) => e)
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(error).toBeInstanceOf(RelayOutcomeUnknownError)
    expect((error as Error).message).toContain("relayer refused: identity budget: this holder's daily sponsorship budget is used up")
    expect(statuses).toBe(0)
    expect(h.sign).toHaveBeenCalledTimes(1)
    expect(relay.pendingAttempt()).toBeDefined()
  })

  it('fails over past a provider that refused outright to one that accepts', async () => {
    const h = harness()
    const urls: string[] = []
    h.transport.relayExchange = vi.fn(async (url: string, {body}: {body?: Uint8Array}) => {
      urls.push(url); h.setRequest(body!)
      if (url.includes('01.example')) return {status: 422, body: encode({id: 'x', state: 'rejected', reason: 'target/selector not sponsored'})}
      h.setNonce(1n)
      return {status: 202, body: encode({id: 'x', state: 'queued'})}
    })
    const result = await h.submitter({attemptMs: 20, pollMs: 10, timeoutMs: 5_000}).submit(target, '0x12345678')
    expect(result.txHash).toBe(txHash)
    expect(urls.map(u => u.includes('01.example') ? 1 : 2)).toEqual([1, 2])
    expect(h.sign).toHaveBeenCalledTimes(1)
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
    // No verified result can arrive, so the outcome stays unknown once the relay budget ends.
    const relay = h.submitter({maxAttempts: 1, timeoutMs: 300, persistAttempt: async a => { saved = a }})
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

describe('unresolvable relay execution', () => {
  function unresolved(sponsorship: boolean) {
    const h = harness(), persisted: RelayAttempt[] = []
    const authorize = vi.fn(async ({attempt}: {attempt: RelayAttempt}) => voucher(attempt))
    const config = {maxAttempts: 1, persistAttempt: async (attempt: RelayAttempt) => { persisted.push(structuredClone(attempt)) },
      ...(sponsorship ? {sponsorship: {slotId: sponsorSlot, authorize}} : {})}
    vi.mocked(h.transport.relayRequest).mockImplementation(async (url, {body}) => {
      if (url.endsWith('voucher-intent')) return encode(sponsorIntent(persisted.at(-1)!))
      if (body) h.setRequest(body)
      throw new Error('original submission response lost')
    })
    return {...h, persisted, authorize, config}
  }

  it.each([false, true])('retains the original on restart outside the log window (sponsored=%s)', async sponsorship => {
    const h = unresolved(sponsorship)
    await expect(h.submitter(h.config).submit(target, '0x12345678')).rejects.toBeInstanceOf(RelayOutcomeUnknownError)
    const original = structuredClone(h.persisted.at(-1)!)
    const persisted = structuredClone(h.persisted), calls = vi.mocked(h.transport.relayRequest).mock.calls.length
    const discoveries = vi.mocked(authenticateApprovedService).mock.calls.length
    h.setNonce(1n)
    h.client.getBlock.mockResolvedValue({number: 20_050n, timestamp: BigInt(Math.floor(Date.now() / 1000))})
    const resumed = h.submitter({...h.config, resumeAttempt: async () => original})
    await expect(resumed.submit(target, '0x12345678')).rejects.toMatchObject({name: 'RelayOutcomeUnknownError', attempt: original})
    expect(resumed.pendingAttempt()).toEqual(original)
    await expect(resumed.submit(target, '0x12345679')).rejects.toMatchObject({name: 'RelayOutcomeUnknownError', attempt: original})
    expect(h.sign).toHaveBeenCalledTimes(1)
    expect(h.bodies).toHaveLength(1)
    expect(h.transport.relayRequest).toHaveBeenCalledTimes(calls)
    expect(authenticateApprovedService).toHaveBeenCalledTimes(discoveries)
    expect(h.authorize).toHaveBeenCalledTimes(sponsorship ? 1 : 0)
    expect(h.persisted).toEqual(persisted)
    expect(h.client.getLogs).not.toHaveBeenCalled()
  })

  it.each([false, true])('retains the signer after unresolvable reconciliation (sponsored=%s)', async sponsorship => {
    const h = unresolved(sponsorship), relay = h.submitter(h.config)
    await expect(relay.submit(target, '0x12345678')).rejects.toBeInstanceOf(RelayOutcomeUnknownError)
    const original = structuredClone(h.persisted.at(-1)!)
    const persisted = structuredClone(h.persisted), calls = vi.mocked(h.transport.relayRequest).mock.calls.length
    h.setNonce(1n)
    h.client.getBlock.mockResolvedValue({number: 20_050n, timestamp: BigInt(Math.floor(Date.now() / 1000))})
    expect(await relay.reconcile()).toEqual({expired: false, unresolvable: true})
    expect(relay.pendingAttempt()).toEqual(original)
    await expect(relay.submit(target, '0x12345678')).rejects.toMatchObject({name: 'RelayOutcomeUnknownError', attempt: original})
    await expect(relay.submit(address('99'), '0x12345679')).rejects.toMatchObject({name: 'RelayOutcomeUnknownError', attempt: original})
    expect(h.sign).toHaveBeenCalledTimes(1)
    expect(h.bodies).toHaveLength(1)
    expect(h.transport.relayRequest).toHaveBeenCalledTimes(calls)
    expect(h.authorize).toHaveBeenCalledTimes(sponsorship ? 1 : 0)
    expect(h.persisted).toEqual(persisted)
    expect(h.client.getLogs).not.toHaveBeenCalled()
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
    // The busy re-send waits its 1 s hint, so this fixture needs more than the default watch budget.
    const relay = h.submitter({attemptMs: 5_000, timeoutMs: 10_000})
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
