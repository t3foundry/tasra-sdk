import {beforeEach, describe, expect, it, vi} from 'vitest'
import {keccak256, type Hex, type LocalAccount, type TransactionSerializable} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {createLocalWallet, type WalletTransactionJournal} from '../../src/app/wallet.js'
const state = vi.hoisted(() => ({rpcChain: vi.fn(), walletChain: vi.fn(), raw: vi.fn(), send: vi.fn(), prepare: vi.fn(), sign: vi.fn(), wait: vi.fn(), accounts: vi.fn(), request: vi.fn(), typed: vi.fn()}))
vi.mock('viem', async importOriginal => {
  const original = await importOriginal<typeof import('viem')>()
  return {...original,
    createPublicClient: () => ({getChainId: state.rpcChain, sendRawTransaction: state.raw, waitForTransactionReceipt: state.wait}),
    createWalletClient: (config: {account?: {address: Hex} | Hex; chain: unknown}) => ({...config, account: typeof config.account === 'string' ? {address: config.account} : config.account,
      getChainId: state.walletChain, requestAddresses: state.request, getAddresses: state.accounts, prepareTransactionRequest: state.prepare, signTransaction: state.sign, sendTransaction: state.send, signTypedData: state.typed}),
  }
})
const from = '0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1'
const deployment = {schemaVersion: 1 as const, name: 'test', chainId: 43112, rpcUrl: 'http://localhost:1', coordinator: 'lowest-operator-id' as const,
  addresses: {KeyRegistry: `0x${'11'.repeat(20)}`, NodeRegistry: `0x${'22'.repeat(20)}`} as const}
const make = () => createLocalWallet(deployment, {privateKey: `0x${'01'.repeat(32)}`})
const request = {to: from, value: 0n} as const
beforeEach(() => {
  vi.clearAllMocks(); state.rpcChain.mockResolvedValue(43112); state.walletChain.mockResolvedValue(43112)
  state.accounts.mockResolvedValue([from]); state.request.mockResolvedValue([from]); state.prepare.mockImplementation((args: Record<string, unknown>) => ({...args, chainId: 43112, nonce: 0, gas: 21000n, gasPrice: 1n, type: 'legacy'})); state.sign.mockImplementation((args: TransactionSerializable & {account: LocalAccount}) => args.account.signTransaction(args))
  state.raw.mockImplementation(({serializedTransaction}: {serializedTransaction: Hex}) => keccak256(serializedTransaction)); state.wait.mockImplementation(({hash}: {hash: Hex}) => ({status: 'success', transactionHash: hash}))
})
describe('wallet adversarial regressions', () => {
  it('snapshots a send request before its first asynchronous chain check', async () => {
    let release!: (chain: number) => void
    state.rpcChain.mockReturnValueOnce(new Promise<number>(resolve => {release = resolve}))
    const wallet = make(), mutable = {to: from as Hex, value: 1n}, saved: WalletTransactionJournal[] = []
    const task = wallet.sendTransaction(mutable, {persist: async journal => {saved.push(journal)}})
    mutable.to = deployment.addresses.KeyRegistry
    mutable.value = 999n
    release(43112)
    await task
    expect(saved[0]!.request).toEqual({to: from, value: 1n})
  })
  it('keeps independent recovery records for simultaneous wallets reusing a transfer name', async () => {
    const first = make(), second = createLocalWallet(deployment, {privateKey: `0x${'02'.repeat(32)}`})
    const values = new Map<string, unknown>(), activeLocks = new Set<string>()
    let reads = 0, release!: () => void
    const bothRead = new Promise<void>(resolve => {release = resolve})
    const store = {
      async load<T>(key: string) {const saved = values.get(key); if (++reads === 2) release(); await bothRead; return saved as T | undefined},
      async save(key: string, value: unknown) {values.set(key, structuredClone(value))},
      async withLock<T>(key: string, action: () => Promise<T>) {
        if (activeLocks.has(key)) throw new Error('Already locked')
        activeLocks.add(key)
        try {return await action()} finally {activeLocks.delete(key)}
      },
    }
    await Promise.all([first.transfer('fund', request, store), second.transfer('fund', request, store)])
    expect(values.size).toBe(2)
    expect(new Set([...values.values()].map(value => (value as WalletTransactionJournal).from))).toEqual(new Set([first.address, second.address]))
  })
  it.each(['chain', 'signer', 'recipient', 'value'] as const)('rejects valid signed recovery bytes for a different %s', async changed => {
    const signer = privateKeyToAccount(`0x${(changed === 'signer' ? '02' : '01').repeat(32)}`)
    const signedTransaction = await signer.signTransaction({type: 'legacy', chainId: changed === 'chain' ? 1 : 43112,
      to: changed === 'recipient' ? deployment.addresses.KeyRegistry : from, value: changed === 'value' ? 99n : 0n,
      nonce: 0, gas: 21000n, gasPrice: 1n})
    const journal: WalletTransactionJournal = {schemaVersion: 1, chainId: 43112, from, request: {...request},
      phase: 'signed', signedTransaction, hash: keccak256(signedTransaction)}
    await expect(make().waitForTransaction(journal)).rejects.toThrow()
    expect(state.wait).not.toHaveBeenCalled()
  })

})
