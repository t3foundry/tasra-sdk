import type {Hex} from 'viem'
import {createTasra, type TasraApplication, type TasraApplicationConfig, type AuthorizedOperationOptions} from './client.js'
import {resolveApplicationManifest, loadApplicationManifest, type ApplicationManifest, type ResolveApplicationManifestOptions, type LoadApplicationManifestOptions} from './manifest.js'
import {createApplicationSlot, type ApplicationStore, type CreateApplicationSlot, type SlotCreationProgress} from './ready-slot.js'
import {createLocalWallet, connectWallet, createSlotWallet} from './wallet.js'
import {createIdentity, issueCredential, verifyCredential, credentialPolicy, credentialAuthorization, presentCredentials} from './identity.js'

/**
 * Network manifest and optional wallet, storage and transport adapters for an application.
 */
export interface TasraClientOptions extends ResolveApplicationManifestOptions {
  /**
   * Network manifest downloaded from tasra-releases, or approved application settings.
   */
  manifest: ApplicationManifest
  /**
   * Private durable store required when creating slots.
   */
  store?: ApplicationStore
  /** Creator wallet; connect a browser wallet or explicitly generate a local one. */
  wallet?: Pick<ReturnType<typeof createLocalWallet>, 'wallet' | 'signer'>
  /**
   * Optional existing read client; deployment consistency is checked.
   */
  chain?: TasraApplicationConfig['chain']
  /**
   * Explicit mapping from registered keeper endpoints to reachable endpoints.
   */
  keeperUrl?: TasraApplicationConfig['keeperUrl']
  /**
   * HTTP implementation for manifest and keeper requests.
   */
  fetchImpl?: typeof fetch
  /**
   * Explicit verifier-agent endpoint override.
   */
  verifierAgentUrl?: string
}
/**
 * Per-operation overrides for the creator wallet, durable store and cancellation deadline.
 */
export interface CreateSlotOptions {
  /**
   * Creator wallet override for this creation request.
   */
  wallet?: TasraClientOptions['wallet']
  /**
   * Durable store override for the named slot intent.
   */
  store?: ApplicationStore
  /**
   * Cancel pending creation work; submitted transactions remain on-chain.
   */
  signal?: AbortSignal
  /**
   * Cooperative creation deadline in milliseconds. In-flight RPC requests and wallet prompts may outlast it; resumed receipt polling has its own wait.
   */
  timeoutMs?: number
  /** Receive safe creation milestones. Callback failures do not interrupt creation. */
  onProgress?: (progress: SlotCreationProgress) => void | Promise<void>
}
type CreatedSlot<M extends CreateApplicationSlot['mode']> = Awaited<ReturnType<TasraApplication['slots'][M]>>

/** Manifest-first application API. Construction validates configuration without network I/O. */
export class TasraClient {
  /**
   * Validated public deployment configuration.
   */
  readonly deployment: TasraApplication['deployment']
  /**
   * Read-only chain client used for discovery and verification.
   */
  readonly chain: TasraApplication['chain']
  /**
   * Verifier-agent endpoint selected from configuration or the manifest.
   */
  readonly verifierAgentUrl?: string
  /**
   * Open existing slot handles or create a durable named slot.
   */
  readonly slots: TasraApplication['slots'] & {
    create: <M extends CreateApplicationSlot['mode']>(input: CreateApplicationSlot & {mode: M}, options?: CreateSlotOptions) => Promise<CreatedSlot<M>>
  }
  /**
   * Create and restore holder or issuer DID identities.
   */
  readonly identities = {create: createIdentity}
  /**
   * Issue, verify, present and authorize using holder-bound credentials.
   */
  readonly credentials = {issue: issueCredential, verify: verifyCredential, policy: credentialPolicy, authorize: credentialAuthorization, present: presentCredentials}
  /**
   * Create a key-backed wallet, connect an external wallet or adapt an ECDSA slot.
   */
  readonly wallets: {
    create: (options?: Parameters<typeof createLocalWallet>[1]) => ReturnType<typeof createLocalWallet>
    connect: (provider: Parameters<typeof connectWallet>[1]) => ReturnType<typeof connectWallet>
    fromSlot: (slotId: Hex, options: AuthorizedOperationOptions) => ReturnType<typeof createSlotWallet>
  }
  /**
   * Check the RPC chain ID and required registry bytecode.
   */
  readonly check: TasraApplication['check']

  /**
   * Validate manifest configuration and prepare the application adapters without network I/O.
   * @param options Manifest and explicitly chosen storage, wallet and transport settings.
   */
  constructor(options: TasraClientOptions) {
    options = {...options}
    const resolved = resolveApplicationManifest(options.manifest, options)
    const keeperUrl = options.keeperUrl ?? resolved.keeperUrl
    const app = createTasra({...resolved, keeperUrl, chain: options.chain, fetchImpl: options.fetchImpl})
    this.deployment = app.deployment
    this.chain = app.chain
    this.verifierAgentUrl = options.verifierAgentUrl ?? resolved.verifierAgentUrl
    this.check = app.check
    this.wallets = {
      create: config => createLocalWallet(app.deployment, config),
      connect: provider => connectWallet(app.deployment, provider),
      fromSlot: (slotId, config) => createSlotWallet(app, slotId, config),
    }
    this.slots = {...app.slots, create: async <M extends CreateApplicationSlot['mode']>(input: CreateApplicationSlot & {mode: M}, config: CreateSlotOptions = {}): Promise<CreatedSlot<M>> => {
      const request = structuredClone(input)
      const wallet = config.wallet ?? options.wallet, store = config.store ?? options.store
      if (!wallet || !store) throw new Error('Creating slots requires a creator wallet and durable store')
      const id = await createApplicationSlot(app, request, {...wallet, store, keeperUrl, fetchImpl: options.fetchImpl, signal: config.signal, timeoutMs: config.timeoutMs, onProgress: config.onProgress})
      return await app.slots[request.mode](id) as CreatedSlot<M>
    }}
  }

  /**
   * Download a network manifest from tasra-releases and construct the application client. An optional independently trusted digest is checked before parsing.
   * @param source Manifest download URL.
   * @param options Digest pin, deployment choices and application adapters.
   * @returns Client configured from the validated manifest.
   */
  static async fromManifest(source: string | URL, options: Omit<TasraClientOptions, 'manifest'> & LoadApplicationManifestOptions = {}) {
    options = {...options}
    const resolved = await loadApplicationManifest(source, options)
    return new TasraClient({...options, manifest: resolved.deployment, keeperUrl: options.keeperUrl ?? resolved.keeperUrl,
      verifierAgentUrl: options.verifierAgentUrl ?? resolved.verifierAgentUrl})
  }
}
