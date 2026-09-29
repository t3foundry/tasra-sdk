import {createPublicClient, createWalletClient, custom, defineChain, http, keccak256, toHex, parseTransaction, recoverTransactionAddress,
  type Account, type Address, type Chain, type EIP1193Provider, type Hex, type LocalAccount, type TransactionReceipt, type TransactionSerialized, type Transport, type WalletClient} from 'viem'
import {generatePrivateKey, privateKeyToAccount} from 'viem/accounts'
import {TasraError} from '../errors.js'
import type {TypedDataSigner} from '../oid4vp/verifier-agent.js'
import {defineDeployment, type TasraDeployment} from './deployment.js'
import type {AuthorizedOperationOptions, TasraApplication} from './client.js'
import {toViemAccount} from './viem.js'
import type {ApplicationStore} from './ready-slot.js'

/**
 * Recipient, native-token value and optional calldata, gas limit and nonce.
 */
export interface WalletTransactionInput {
  /**
   * Destination EVM address.
   */
  to: Address
  /**
   * Native-token value in base units; defaults to zero.
   */
  value?: bigint
  /**
   * Hex-encoded contract calldata; omitted for a plain transfer.
   */
  data?: Hex
  /**
   * Optional transaction gas limit.
   */
  gas?: bigint
  /**
   * Explicit transaction nonce when supplied.
   */
  nonce?: number
}
/** Private durable evidence; signed bytes permit explicit recovery without creating a new transaction. */
export interface WalletTransactionJournal {
  /**
   * Wallet journal schema version.
   */
  schemaVersion: 1
  /**
   * Chain to which the signed or submitted transaction is bound.
   */
  chainId: number
  /**
   * Signing account address.
   */
  from: Address
  /**
   * Original recipient, amount and transaction overrides.
   */
  request: WalletTransactionInput
  /**
   * Last persisted transaction-submission or confirmation stage.
   */
  phase: 'signed' | 'submitting' | 'submitted' | 'confirmed'
  /**
   * Transaction hash, when known.
   */
  hash?: Hex
  /**
   * Private signed bytes available for explicit transaction recovery.
   */
  signedTransaction?: Hex
  /**
   * Observed chain receipt after confirmation.
   */
  receipt?: TransactionReceipt
}
/**
 * Chain-bound wallet adapter with durable transaction submission and receipt recovery.
 */
export interface TasraWallet {
  /**
   * Selected EVM account address.
   */
  address: Address
  /**
   * Bound viem wallet for advanced integrations.
   */
  wallet: WalletClient<Transport, Chain, Account>
  /**
   * EIP-712 signer that rechecks account and chain consistency.
   */
  signer: TypedDataSigner
  /**
   * Read this account native-token balance in base units.
   */
  getBalance(): Promise<bigint>
  /**
   * Read the pending account nonce from the configured RPC.
   */
  getTransactionCount(): Promise<number>
  /** Persist and serialize a named transfer. Reusing its name only observes the saved transaction. */
  transfer(name: string, input: WalletTransactionInput, store: ApplicationStore): Promise<WalletTransactionJournal>
  /** Serialize calls per account; persist must be durable before resolving. A failed send is never automatically retried. */
  sendTransaction(input: WalletTransactionInput, options: {persist: (journal: WalletTransactionJournal) => Promise<void>}): Promise<WalletTransactionJournal>
  /** Observes the saved hash only; never signs, replaces, or broadcasts. Unknown external-wallet outcomes require reconciliation. */
  waitForTransaction(journal: WalletTransactionJournal, options?: {timeoutMs?: number; persist?: (journal: WalletTransactionJournal) => Promise<void>}): Promise<WalletTransactionJournal>
}
function chainFor(deployment: TasraDeployment) {
  return defineChain({id: deployment.chainId, name: deployment.name, nativeCurrency: {name: 'Native token', symbol: 'NATIVE', decimals: 18}, rpcUrls: {default: {http: [deployment.rpcUrl]}}})
}
async function verifySignedTransaction(journal: WalletTransactionJournal) {
  if (!journal.signedTransaction) return
  const transaction = parseTransaction(journal.signedTransaction)
  const sender = await recoverTransactionAddress({serializedTransaction: journal.signedTransaction as TransactionSerialized})
  const request = journal.request
  if (transaction.chainId !== journal.chainId || sender.toLowerCase() !== journal.from.toLowerCase() ||
      transaction.to?.toLowerCase() !== request.to.toLowerCase() || (transaction.value ?? 0n) !== (request.value ?? 0n) ||
      (transaction.data ?? '0x').toLowerCase() !== (request.data ?? '0x').toLowerCase() ||
      request.gas !== undefined && transaction.gas !== request.gas || request.nonce !== undefined && transaction.nonce !== request.nonce) {
    throw new TasraError('Signed transaction differs from its saved wallet, chain or request')
  }
}
function wrap(deployment: TasraDeployment, wallet: TasraWallet['wallet'], local?: LocalAccount): TasraWallet {
  const config = defineDeployment(deployment), address = wallet.account.address
  const pub = createPublicClient({chain: chainFor(config), transport: http(config.rpcUrl, {retryCount: 0})})
  async function assertChain() {
    if (await pub.getChainId() !== config.chainId || await wallet.getChainId() !== config.chainId) throw new TasraError('Wallet or RPC chain differs from the deployment')
    if (!local && !(await wallet.getAddresses()).some(a => a.toLowerCase() === address.toLowerCase())) throw new TasraError('Connected wallet account changed')
  }
  const result: TasraWallet = {address, wallet,
    signer: {address, async signTypedData(args) { const data = structuredClone(args); await assertChain(); return wallet.signTypedData(data) }},
    async getBalance() { await assertChain(); return pub.getBalance({address}) },
    async getTransactionCount() { await assertChain(); return pub.getTransactionCount({address, blockTag: 'pending'}) },
    async transfer(name, input, store) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(name)) throw new TasraError('Invalid transaction name')
      const request = structuredClone(input)
      const key = `transfer-${keccak256(toHex(JSON.stringify([config.chainId, address.toLowerCase(), name]))).slice(2)}`
      return store.withLock(`wallet-${config.chainId}-${address}`, async () => {
        const saved = await store.load<WalletTransactionJournal>(key)
        if (saved && (saved.request.to.toLowerCase() !== request.to.toLowerCase() ||
          (saved.request.value ?? 0n) !== (request.value ?? 0n) || (saved.request.data ?? '0x').toLowerCase() !== (request.data ?? '0x').toLowerCase() ||
          saved.request.gas !== request.gas || saved.request.nonce !== request.nonce)) throw new TasraError('Transaction name already identifies a different request')
        const persist = (journal: WalletTransactionJournal) => store.save(key, journal)
        const journal = saved ?? await result.sendTransaction(request, {persist})
        return result.waitForTransaction(journal, {persist})
      })
    },
    async sendTransaction(input, {persist}) {
      const request = structuredClone(input)
      await assertChain()
      const journal: WalletTransactionJournal = {schemaVersion: 1, chainId: config.chainId, from: address, request, phase: 'submitting'}
      if (local) {
        const prepared = await wallet.prepareTransactionRequest({...request, account: local, chain: wallet.chain})
        const serialized = await wallet.signTransaction({...prepared, account: local, chain: wallet.chain})
        journal.signedTransaction = serialized
        journal.hash = keccak256(serialized)
        journal.phase = 'signed'
        await verifySignedTransaction(journal)
        // If this save fails, neither the transport nor the provider has seen a send request.
        await persist(structuredClone(journal))
        await assertChain()
        const returned = await pub.sendRawTransaction({serializedTransaction: serialized})
        if (returned.toLowerCase() !== journal.hash.toLowerCase()) throw new TasraError('RPC returned a different transaction hash; reconcile the saved signed transaction')
      } else {
        await persist(structuredClone(journal))
        await assertChain()
        journal.hash = await wallet.sendTransaction({...request, account: wallet.account, chain: wallet.chain})
      }
      journal.phase = 'submitted'
      await persist(structuredClone(journal))
      return journal
    },
    async waitForTransaction(input, options = {}) {
      const journal = structuredClone(input), {timeoutMs = 120_000, persist} = options
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TasraError('Invalid transaction receipt timeout')
      if (journal.schemaVersion !== 1 || journal.chainId !== config.chainId || journal.from.toLowerCase() !== address.toLowerCase()) throw new TasraError('Saved transaction belongs to a different wallet or deployment')
      if (!journal.hash || !/^0x[0-9a-fA-F]{64}$/.test(journal.hash)) throw new TasraError('Transaction outcome is unknown; reconcile its hash with the wallet before waiting')
      if (journal.signedTransaction && keccak256(journal.signedTransaction) !== journal.hash) throw new TasraError('Saved transaction hash differs from its signed bytes')
      await verifySignedTransaction(journal)
      await assertChain()
      const receipt = await pub.waitForTransactionReceipt({hash: journal.hash, timeout: timeoutMs, checkReplacement: false})
      journal.phase = 'confirmed'
      journal.receipt = receipt
      await persist?.(structuredClone(journal))
      if (receipt.status !== 'success') throw new TasraError(`Transaction reverted: ${journal.hash}`)
      return journal
    },
  }
  return result
}

/**
 * Create or restore a local key. Explicitly export and save a generated key before funding it.
 * @param deployment Approved network settings.
 * @param options Optional existing private key; a fresh key is generated otherwise.
 * @returns Chain-bound wallet with an explicit private-key export function.
 */
export function createLocalWallet(deployment: TasraDeployment, options: {privateKey?: Hex} = {}): TasraWallet & {exportPrivateKey(): Hex} {
  const config = defineDeployment(deployment), key = options.privateKey ?? generatePrivateKey(), account = privateKeyToAccount(key)
  const wallet = createWalletClient({account, chain: chainFor(config), transport: http(config.rpcUrl, {retryCount: 0})})
  return {...wrap(config, wallet, account), exportPrivateKey: () => key}
}

/**
 * Requests the user's wallet account. Chain switching remains an explicit wallet/user decision.
 * @param deployment Approved network settings.
 * @param provider User-selected EIP-1193 wallet provider.
 * @returns Wallet bound to the authorized account and matching chain.
 */
export async function connectWallet(deployment: TasraDeployment, provider: EIP1193Provider): Promise<TasraWallet> {
  const config = defineDeployment(deployment), transport = custom(provider, {retryCount: 0}), chain = chainFor(config)
  const connection = createWalletClient({chain, transport})
  if (await connection.getChainId() !== config.chainId) throw new TasraError('Connected wallet chain differs from the deployment')
  const [address] = await connection.requestAddresses()
  if (!address) throw new TasraError('Wallet did not authorize an account')
  return wrap(config, createWalletClient({account: address, chain, transport}))
}

/**
 * Use a threshold ECDSA slot with fresh operation authorization on every signature.
 * @param application Application client connected to the slot deployment.
 * @param slotId Ready threshold ECDSA slot to expose as an Ethereum wallet.
 * @param options Fresh authorization callback used for every signature.
 */
export async function createSlotWallet(application: TasraApplication, slotId: Hex, options: AuthorizedOperationOptions): Promise<TasraWallet> {
  const account = await toViemAccount(await application.slots.ecdsa(slotId), options)
  const config = application.deployment
  return wrap(config, createWalletClient({account, chain: chainFor(config), transport: http(config.rpcUrl, {retryCount: 0})}), account)
}
