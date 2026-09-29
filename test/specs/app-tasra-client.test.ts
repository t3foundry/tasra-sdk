import {afterEach, describe, expect, expectTypeOf, it, vi} from 'vitest'
import {TasraClient, type TasraClientOptions} from '../../src/app/tasra-client.js'
import {createLocalWallet} from '../../src/app/wallet.js'
import type {ApplicationDeployment} from '../../src/app/manifest.js'
import type {ApplicationStore} from '../../src/app/ready-slot.js'
import type {EcdsaSlot, FrostSlot, BlsSlot} from '../../src/app/client.js'

const mocks = vi.hoisted(() => ({create: vi.fn()}))
vi.mock('../../src/app/ready-slot.js', () => ({createApplicationSlot: mocks.create}))
const slotId = `0x${'ab'.repeat(32)}` as const
const address = `0x${'12'.repeat(20)}` as const
const manifest: ApplicationDeployment = {schemaVersion: 1, name: 'local', chainId: 43112, coordinator: 'lowest-operator-id',
  rpcUrl: 'http://localhost:9650', addresses: {KeyRegistry: address, NodeRegistry: address},
  verifierAgentUrl: 'https://localhost:19444', keeperUrls: {'http://keeper:8080': 'http://localhost:8091'}}
const request = {name: 'team', mode: 'ecdsa' as const, policy: 'explicit policy', threshold: {k: 2, n: 3}, verifiers: {committee: 3, quorum: 2}}
const store: ApplicationStore = {load: async () => undefined, save: async () => {}, withLock: async (_key, action) => action()}
function chain(mode: number): NonNullable<TasraClientOptions['chain']> {
  return {addresses: manifest.addresses, client: {getChainId: vi.fn(async () => 43112)}, readers: {keyRegistry: {
    getKeySlot: vi.fn(async () => ({exists: true, cancelled: false, mode, epoch: 1, threshold: {k: 2, n: 3}, publicKey: '0x12'})),
  }}} as unknown as NonNullable<TasraClientOptions['chain']>
}
afterEach(() => {vi.restoreAllMocks(); mocks.create.mockReset()})

describe('manifest-first TasraClient', () => {
  it('constructs and creates a local wallet and identity without network requests', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network request'))
    const client = new TasraClient({manifest})
    expect(client.deployment.chainId).toBe(43112)
    expect(client.verifierAgentUrl).toBe('https://localhost:19444')
    expect(client.wallets.create().address).toMatch(/^0x[0-9a-fA-F]{40}$/)
    const identity = client.identities.create()
    expect(identity.did).toMatch(/^did:jwk:/)
    identity.destroy()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
  it.each(['wallet', 'store', 'both'])('requires durable state and a creator before any creation: missing %s', async missing => {
    const wallet = createLocalWallet(manifest)
    const client = new TasraClient({manifest, ...(missing !== 'wallet' && missing !== 'both' ? {wallet} : {}),
      ...(missing !== 'store' && missing !== 'both' ? {store} : {})})
    await expect(client.slots.create(request)).rejects.toThrow('creator wallet and durable store')
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('accepts a newly created wallet and durable store per operation without rebuilding the client', async () => {
    const client = new TasraClient({manifest, chain: chain(2)})
    const wallet = client.wallets.create()
    mocks.create.mockResolvedValue(slotId)
    expect((await client.slots.create(request, {wallet, store})).slotId).toBe(slotId)
    expect(mocks.create.mock.calls[0]![2].wallet).toBe(wallet.wallet)
    expect(mocks.create.mock.calls[0]![2].store).toBe(store)
  })
  it('preserves hosted manifest routing and verifier settings through construction', async () => {
    const wallet = createLocalWallet(manifest), fetchImpl = vi.fn(async () => new Response(JSON.stringify(manifest)))
    const client = await TasraClient.fromManifest('https://example.test/network.json', {fetchImpl, wallet, store, chain: chain(2)})
    mocks.create.mockResolvedValue(slotId)
    const slot = await client.slots.create(request)
    expect(slot.slotId).toBe(slotId)
    expect(client.verifierAgentUrl).toBe(manifest.verifierAgentUrl)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const options = mocks.create.mock.calls[0]![2]
    expect(options.keeperUrl('http://keeper:8080')).toBe('http://localhost:8091')
    expect(options.fetchImpl).toBe(fetchImpl)
    expect(options.store).toBe(store)
    expect(options.wallet).toBe(wallet.wallet)
  })
  it('preserves caller overrides and cancellation when creating a slot', async () => {
    const keeperUrl = vi.fn(() => 'http://localhost:9000'), signal = new AbortController().signal, onProgress = vi.fn()
    const client = await TasraClient.fromManifest('https://example.test/network.json', {
      fetchImpl: vi.fn(async () => new Response(JSON.stringify(manifest))), wallet: createLocalWallet(manifest), store,
      chain: chain(0), keeperUrl, verifierAgentUrl: 'https://approved.example',
    })
    mocks.create.mockResolvedValue(slotId)
    const slot = await client.slots.create({...request, mode: 'frost'}, {signal, timeoutMs: 1234, onProgress})
    expect(slot.slotId).toBe(slotId)
    expect(client.verifierAgentUrl).toBe('https://approved.example')
    expect(mocks.create.mock.calls[0]![2]).toMatchObject({keeperUrl, signal, timeoutMs: 1234, onProgress})
  })
  it('returns mode-specific APIs and preserves their TypeScript types', async () => {
    mocks.create.mockResolvedValue(slotId)
    const options = {manifest, wallet: createLocalWallet(manifest), store}
    const ecdsa = new TasraClient({...options, chain: chain(2)}).slots.create(request)
    const frost = new TasraClient({...options, chain: chain(0)}).slots.create({...request, mode: 'frost'})
    const bls = new TasraClient({...options, chain: chain(1)}).slots.create({...request, mode: 'bls'})
    expectTypeOf(ecdsa).toEqualTypeOf<Promise<EcdsaSlot>>()
    expectTypeOf(frost).toEqualTypeOf<Promise<FrostSlot>>()
    expectTypeOf(bls).toEqualTypeOf<Promise<BlsSlot>>()
    expect(await ecdsa).toHaveProperty('signDigest')
    expect(await frost).toHaveProperty('sign')
    expect(await bls).toHaveProperty('decrypt')
  })
  it('keeps the requested mode even when the caller edits its object while awaiting creation', async () => {
    const client = new TasraClient({manifest, wallet: createLocalWallet(manifest), store, chain: chain(2)})
    const input = {...request, mode: 'ecdsa' as 'ecdsa' | 'bls'}
    mocks.create.mockImplementation(async () => {input.mode = 'bls'; return slotId})
    expect(await client.slots.create(input)).toHaveProperty('signDigest')
  })
  it('propagates creation failures without trying to load or create a replacement slot', async () => {
    const injected = chain(2), client = new TasraClient({manifest, wallet: createLocalWallet(manifest), store, chain: injected})
    mocks.create.mockRejectedValue(new Error('Transaction outcome unknown'))
    await expect(client.slots.create(request)).rejects.toThrow('Transaction outcome unknown')
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(injected.readers.keyRegistry.getKeySlot).not.toHaveBeenCalled()
  })
})
