import {beforeEach, describe, expect, it, vi} from 'vitest'
import {keccak256, type EIP1193Provider, type Hex, type LocalAccount, type TransactionSerializable} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {createLocalWallet, connectWallet, type WalletTransactionJournal} from '../../src/app/wallet.js'
const state = vi.hoisted(() => ({rpcChain: vi.fn(), walletChain: vi.fn(), raw: vi.fn(), send: vi.fn(), prepare: vi.fn(), sign: vi.fn(), wait: vi.fn(), accounts: vi.fn(), request: vi.fn(), typed: vi.fn(), balance: vi.fn(), count: vi.fn()}))
vi.mock('viem', async importOriginal => {
  const original = await importOriginal<typeof import('viem')>()
  return {...original,
    createPublicClient: () => ({getChainId: state.rpcChain, sendRawTransaction: state.raw, waitForTransactionReceipt: state.wait, getBalance: state.balance, getTransactionCount: state.count}),
    createWalletClient: (config: {account?: {address: Hex} | Hex; chain: unknown}) => ({...config, account: typeof config.account === 'string' ? {address: config.account} : config.account,
      getChainId: state.walletChain, requestAddresses: state.request, getAddresses: state.accounts, prepareTransactionRequest: state.prepare, signTransaction: state.sign, sendTransaction: state.send, signTypedData: state.typed}),
  }
})
const from = '0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1'
const fees = {type: 'eip1559' as const, chainId: 43112, nonce: 0, gas: 21000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n}
const serialized = await privateKeyToAccount(`0x${'01'.repeat(32)}`).signTransaction({...fees, to: from, value: 0n}), hash = keccak256(serialized)
const deployment = {schemaVersion: 1 as const, name: 'test', chainId: 43112, rpcUrl: 'http://localhost:1', coordinator: 'lowest-operator-id' as const,
  addresses: {KeyRegistry: `0x${'11'.repeat(20)}`, NodeRegistry: `0x${'22'.repeat(20)}`} as const}
const make = () => createLocalWallet(deployment, {privateKey: `0x${'01'.repeat(32)}`})
const request = {to: from, value: 0n} as const
beforeEach(() => {
  vi.clearAllMocks(); state.rpcChain.mockResolvedValue(43112); state.walletChain.mockResolvedValue(43112)
  state.accounts.mockResolvedValue([from]); state.request.mockResolvedValue([from]); state.prepare.mockImplementation((args: Record<string, unknown>) => ({...fees, ...args})); state.sign.mockImplementation((args: TransactionSerializable & {account: LocalAccount}) => args.account.signTransaction(args))
  state.raw.mockImplementation(({serializedTransaction}: {serializedTransaction: Hex}) => keccak256(serializedTransaction)); state.send.mockResolvedValue(hash); state.wait.mockResolvedValue({status: 'success', transactionHash: hash})
})
describe('application wallet adapters', () => {
  it('restores an EVM account without consumer crypto or wallet dependencies', () => {
    const wallet = make()
    expect(wallet.address).toBe(from)
    expect(wallet.exportPrivateKey()).toBe(`0x${'01'.repeat(32)}`)
    expect(createLocalWallet(deployment).address).not.toBe(wallet.address)
  })
  it('persists recoverable signed bytes before broadcast and waits only on their saved hash', async () => {
    const wallet = make(), snapshots: WalletTransactionJournal[] = []
    state.raw.mockImplementation(() => { expect(snapshots[0]).toMatchObject({phase: 'signed', hash, signedTransaction: serialized}); return hash })
    const journal = await wallet.sendTransaction(request, {persist: async value => { snapshots.push(value) }})
    expect(snapshots.map(v => v.phase)).toEqual(['signed', 'submitted'])
    const receipt = await wallet.waitForTransaction(journal)
    expect(receipt.phase).toBe('confirmed')
    expect(state.wait).toHaveBeenCalledWith({hash, timeout: 120000, checkReplacement: false})
    expect(state.raw).toHaveBeenCalledTimes(1)
  })
  it('does not broadcast when durable storage fails', async () => {
    await expect(make().sendTransaction(request, {persist: async () => { throw new Error('disk full') }})).rejects.toThrow('disk full')
    expect(state.raw).not.toHaveBeenCalled()
    expect(state.send).not.toHaveBeenCalled()
  })
  it('preserves the signed hash across transport failure without retrying', async () => {
    const saved: WalletTransactionJournal[] = []
    state.raw.mockRejectedValue(new Error('connection reset'))
    await expect(make().sendTransaction(request, {persist: async value => { saved.push(value) }})).rejects.toThrow('connection reset')
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({phase: 'signed', hash, signedTransaction: serialized})
    expect(state.raw).toHaveBeenCalledTimes(1)
  })
  it.each(['rpc', 'wallet'])('refuses %s chain mismatch before signing or sending', async side => {
    (side === 'rpc' ? state.rpcChain : state.walletChain).mockResolvedValue(1)
    await expect(make().sendTransaction(request, {persist: vi.fn()})).rejects.toThrow('chain')
    expect(state.sign).not.toHaveBeenCalled(); expect(state.raw).not.toHaveBeenCalled()
  })
  it('persists an external-wallet unknown outcome and refuses unsafe resume', async () => {
    const wallet = await connectWallet(deployment, {} as EIP1193Provider), saved: WalletTransactionJournal[] = []
    state.send.mockRejectedValue(new Error('disconnected'))
    await expect(wallet.sendTransaction(request, {persist: async value => { saved.push(value) }})).rejects.toThrow('disconnected')
    expect(saved[0]).toMatchObject({phase: 'submitting', from})
    expect(saved[0]?.hash).toBeUndefined()
    await expect(wallet.waitForTransaction(saved[0]!)).rejects.toThrow('reconcile')
    expect(state.send).toHaveBeenCalledTimes(1)
  })
  it('requests connection explicitly and rejects an account change before sending', async () => {
    const wallet = await connectWallet(deployment, {} as EIP1193Provider)
    expect(state.request).toHaveBeenCalledOnce()
    state.accounts.mockResolvedValue([])
    await expect(wallet.sendTransaction(request, {persist: vi.fn()})).rejects.toThrow('account changed')
    expect(state.send).not.toHaveBeenCalled()
  })
  it('makes named transfers resumable without a second broadcast, and rejects changed intent', async () => {
    const values = new Map<string, unknown>(), locks: string[] = [], wallet = make()
    const store = {async load<T>(key: string) { return values.get(key) as T | undefined }, async save(key: string, value: unknown) { values.set(key, structuredClone(value)) },
      async withLock<T>(key: string, action: () => Promise<T>) { locks.push(key); return action() }}
    expect((await wallet.transfer('alice-first', request, store)).phase).toBe('confirmed')
    expect((await wallet.transfer('alice-first', request, store)).hash).toBe(hash)
    expect(state.raw).toHaveBeenCalledTimes(1)
    await expect(wallet.transfer('alice-first', {...request, value: 2n}, store)).rejects.toThrow('different request')
    expect(new Set(locks).size).toBe(1)
  })

  it('snapshots a named transfer before waiting for the account lock', async () => {
    const input = {...request, value: 3n}
    const store = {async load<T>(_key: string) { return undefined as T | undefined }, save: vi.fn(),
      async withLock<T>(_key: string, action: () => Promise<T>) { input.value = 99n; return action() }}
    await make().transfer('first-payment', input, store)
    expect(state.prepare).toHaveBeenCalledWith(expect.objectContaining({value: 3n}))
  })
  it('refuses altered signed bytes, chain or wallet on saved receipt observation', async () => {
    const wallet = make(), journal = await wallet.sendTransaction(request, {persist: vi.fn()})
    for (const changed of [{chainId: 1}, {from: deployment.addresses.KeyRegistry}, {signedTransaction: '0x0103' as Hex}]) {
      await expect(wallet.waitForTransaction({...journal, ...changed})).rejects.toThrow()
    }
    expect(state.wait).not.toHaveBeenCalled()
  })
})

describe('wallet reads and typed-data signatures are chain-checked first', () => {
  const typedData = {domain: {name: 'Tasra', chainId: 43112}, types: {Op: [{name: 'n', type: 'uint256'}]}, primaryType: 'Op', message: {n: 1n}} as const
  it('signs a copy of the typed data after the chain check, so a caller mutating its argument changes nothing signed', async () => {
    let seen: unknown
    state.typed.mockImplementation(async (data: unknown) => { seen = structuredClone(data); return '0x01' })
    const args = structuredClone(typedData) as {message: {n: bigint}}
    const pending = make().signer.signTypedData(args as never)
    args.message.n = 2n
    await expect(pending).resolves.toBe('0x01')
    expect(seen).toMatchObject({message: {n: 1n}})
  })
  it.each(['rpc', 'wallet'])('refuses a typed-data signature and both reads on a %s chain mismatch, without touching the account', async side => {
    (side === 'rpc' ? state.rpcChain : state.walletChain).mockResolvedValue(1)
    const wallet = make()
    await expect(wallet.signer.signTypedData(typedData as never)).rejects.toThrow('Wallet or RPC chain differs from the deployment')
    await expect(wallet.getBalance()).rejects.toThrow('Wallet or RPC chain differs from the deployment')
    await expect(wallet.getTransactionCount()).rejects.toThrow('Wallet or RPC chain differs from the deployment')
    expect(state.typed).not.toHaveBeenCalled(); expect(state.balance).not.toHaveBeenCalled(); expect(state.count).not.toHaveBeenCalled()
  })
  it('reads the balance and the PENDING nonce of the wallet address', async () => {
    state.balance.mockResolvedValue(5n); state.count.mockResolvedValue(3)
    const wallet = make()
    await expect(wallet.getBalance()).resolves.toBe(5n)
    await expect(wallet.getTransactionCount()).resolves.toBe(3)
    expect(state.balance).toHaveBeenCalledWith({address: from})
    expect(state.count).toHaveBeenCalledWith({address: from, blockTag: 'pending'})
  })
  it('a connected wallet whose account changed is refused before a read; connecting needs the chain and an authorized account', async () => {
    const wallet = await connectWallet(deployment, {} as EIP1193Provider)
    state.accounts.mockResolvedValue(['0x' + '99'.repeat(20)])
    await expect(wallet.getBalance()).rejects.toThrow('Connected wallet account changed')
    expect(state.balance).not.toHaveBeenCalled()
    state.walletChain.mockResolvedValue(1)
    await expect(connectWallet(deployment, {} as EIP1193Provider)).rejects.toThrow('Connected wallet chain differs from the deployment')
    state.walletChain.mockResolvedValue(43112); state.request.mockResolvedValue([])
    await expect(connectWallet(deployment, {} as EIP1193Provider)).rejects.toThrow('Wallet did not authorize an account')
  })
})
