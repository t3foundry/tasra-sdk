import {decodeEventLog, encodeFunctionData, hashTypedData, parseAbi, type Account, type Address, type Chain, type Hex, type Transport, type WalletClient} from 'viem'
import type {TasraChainClient} from './client.js'
import {authenticateApprovedService, type ServiceDiscoveryTransport} from './serviceIdentity.js'
import {SERVICE_TYPES, type ServiceApproval} from './services.js'
import {revertError} from './revertReason.js'
import {retryDelayMs} from '../retry.js'
import {assertRelayVoucher, assertRelayVoucherIntent, type RelayVoucher, type RelaySponsorshipConfig} from './relayVoucher.js'

/**
 * Guarded discovery and transaction relay transport with bounded response bodies.
 */
export interface RelayTransport extends ServiceDiscoveryTransport {
  /** Guard the socket just like discovery. Accept bounded JSON status bodies for 200/202/422. */
  relayRequest(url: string, options: {body?: Uint8Array; maxBytes: number; signal: AbortSignal}): Promise<Uint8Array>
  /** Optional: the same guarded request, also reporting status and `Retry-After` for busy refusals. */
  relayExchange?(url: string, options: {body?: Uint8Array; maxBytes: number; signal: AbortSignal}): Promise<RelayHttpResponse>
}

/** Bounded relayer reply with the wait it requested, if any. */
export interface RelayHttpResponse {
  /** HTTP status: 200/202 accepted or status, 422 a pre-acceptance refusal. */
  status: number
  /** Bounded JSON body. */
  body: Uint8Array
  /** Parsed `Retry-After` in ms, when sent. */
  retryAfterMs?: number
}

/**
 * Chain, forwarder, signer and exact calldata identifying a relay operation.
 */
export interface RelayIntent {
  /** Chain on which the forwarded call is intended to execute. */
  chainId: number
  /** Independently pinned forwarding contract. */
  forwarder: Address
  /** Account authorizing the forwarded operation. */
  from: Address
  /** Target contract of the forwarded operation. */
  to: Address
  /** Exact encoded calldata to execute. */
  data: Hex
  /** Application label used to locate the operation recovery record. */
  label: string
}

/**
 * Approved relay providers, pinned forwarder and durable recovery callbacks.
 */
export interface RegisteredRelayConfig {
  /** Holder-bound voucher flow for user-class calls; requires durable persistAttempt. */
  sponsorship?: RelaySponsorshipConfig
  /** Application approvals, in preference order. Registry membership alone never selects a service. */
  approvals: readonly ServiceApproval[]
  /** Guarded HTTP transport for service authentication and relay submission. */
  transport: RelayTransport
  /** Independently pinned deployment forwarder; never supplied by a relayer manifest. */
  forwarder: Address
  /** Default operation label used when persisting or resuming relay attempts. */
  label?: string
  /** Persist the signed reconciliation handle before its first POST. */
  persistAttempt?: (attempt: RelayAttempt) => Promise<void>
  /** Load this durable operation's previous attempt before signing, including after a restart. Unknown execution blocks replacement, including a consumed nonce outside the log window. */
  resumeAttempt?: (intent: RelayIntent) => Promise<RelayAttempt | undefined>
  /** Relay status polling interval in milliseconds; defaults to 1500. */
  pollMs?: number
  /** Deadline in milliseconds after a submission leaves the serialization queue; defaults to 120000 and cannot exceed it. */
  timeoutMs?: number
  /** At most three authenticated providers receive the identical signed request. */
  maxAttempts?: number
  /** Status polling budget per provider in milliseconds; defaults to 10000 and cannot exceed 30000. */
  attemptMs?: number
  /** Re-sends of the identical signed request to one provider after a busy refusal, 0..5 (default 3). Waits honor `Retry-After`, at most 10 s in total per provider. */
  busyRetries?: number
}

/**
 * True for a relayer refusal about its own load rather than the request: a full lane, a full
 * journal or an unavailable shared sponsorship budget. The relayer answers these 422 `rejected`
 * with `Retry-After` before journaling anything. "shared daily spend cap reached", quota and
 * policy refusals are not busy.
 * @param reason The `reason` text of a relayer `rejected` status.
 */
export function isRelayBusyReason(reason: unknown): boolean {
  return typeof reason === 'string' && reason.length <= 512 && reason.startsWith('relayer busy:')
}

/** Busy-refusal parse of a POST reply; anything else (accepted, other refusals, garbage) is undefined. */
function busyRefusal(reply: RelayHttpResponse): {retryAfterMs?: number} | undefined {
  if (reply.status !== 422 || reply.body.length > 4_096) return undefined
  try {
    const status = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(reply.body)) as {state?: unknown; reason?: unknown}
    if (status?.state !== 'rejected' || !isRelayBusyReason(status.reason)) return undefined
  } catch { return undefined }
  const after = reply.retryAfterMs
  return after !== undefined && Number.isSafeInteger(after) && after >= 0 ? {retryAfterMs: after} : {}
}

/**
 * Verified forwarded transaction result with optional gas and native-token cost.
 */
export interface RelayReceipt {
  /**
   * Signed relay-request identifier.
   */
  id: string
  /**
   * Verified forwarded transaction hash.
   */
  txHash: Hex
  /**
   * Gas consumed by the forwarded transaction, when reported.
   */
  gasUsed?: number
  /**
   * Native-token transaction cost in base units, encoded as decimal text.
   */
  costWei?: string
}

/**
 * Forwarder ABI used to submit requests, read nonces and verify execution events.
 */
export const relayForwarderAbi = parseAbi([
  'function nonces(address owner) view returns (uint256)',
  'function execute((address from, address to, uint256 value, uint256 gas, uint48 deadline, bytes data, bytes signature) request) payable',
  'event ExecutedForwardRequest(address indexed signer, uint256 nonce, bool success)',
])
const types = {ForwardRequest: [
  {name: 'from', type: 'address'}, {name: 'to', type: 'address'}, {name: 'value', type: 'uint256'},
  {name: 'gas', type: 'uint256'}, {name: 'nonce', type: 'uint256'}, {name: 'deadline', type: 'uint48'}, {name: 'data', type: 'bytes'},
]} as const

/** JSON-safe reconciliation handle. Persist before POST to resume safely after a client restart. */
export interface RelayAttempt {
  /** Wallet voucher persisted before relay submission, bound to this exact signed request. */
  voucher?: RelayVoucher
  /** Chain bound into the signed forward request. */
  chainId: number
  /** Pinned forwarder contract expected to execute the request. */
  forwarder: Address
  /** Decimal block number from which reconciliation scans execution logs. */
  fromBlock: string
  /** EIP-712 hash identifying the exact signed forward request. */
  id: Hex
  /** Signed sender, target, calldata, gas, nonce and deadline used for submission and reconciliation. */
  request: {from: Address; to: Address; value: '0'; gas: number; nonce: number; deadline: number; data: Hex; signature: Hex; label: string}
}

/**
 * A relay request has no verified terminal result and must be reconciled before replacement.
 */
export class RelayOutcomeUnknownError extends Error {
  constructor(/** Persisted signed relay attempt whose execution outcome remains unknown. */ readonly attempt: RelayAttempt, reason = 'No verified chain result before the relay deadline') {
    super(`${reason}; reconcile request ${attempt.id} before signing another operation`)
    this.name = 'RelayOutcomeUnknownError'
  }
}

function typed(attempt: Pick<RelayAttempt, 'chainId' | 'forwarder' | 'request'>) {
  const r = attempt.request
  return {domain: {name: 'KeykeeperForwarder', version: '1', chainId: attempt.chainId, verifyingContract: attempt.forwarder},
    types, primaryType: 'ForwardRequest' as const,
    message: {from: r.from, to: r.to, value: 0n, gas: BigInt(r.gas), nonce: BigInt(r.nonce), deadline: r.deadline, data: r.data}}
}

function executeData(attempt: RelayAttempt): Hex {
  const r = attempt.request
  return encodeFunctionData({abi: relayForwarderAbi, functionName: 'execute', args: [{...r, value: 0n, gas: BigInt(r.gas)}]})
}

function scope(timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('Relay deadline exceeded')), timeoutMs)
  return {signal: controller.signal, close: () => { clearTimeout(timer); controller.abort() },
    async run<T>(work: () => Promise<T>): Promise<T> {
      controller.signal.throwIfAborted()
      let abort = () => {}
      try {
        return await Promise.race([work(), new Promise<never>((_, reject) => {
          abort = () => reject(controller.signal.reason)
          controller.signal.addEventListener('abort', abort, {once: true})
        })])
      } finally { controller.signal.removeEventListener('abort', abort) }
    },
  }
}
type Scope = ReturnType<typeof scope>

async function verifiedReceipt(chain: TasraChainClient, attempt: RelayAttempt, hash: Hex, budget: Scope): Promise<RelayReceipt | undefined> {
  const tx = await budget.run(() => chain.client.getTransaction({hash}))
  if (tx.to?.toLowerCase() !== attempt.forwarder.toLowerCase() || tx.value !== 0n || tx.input.toLowerCase() !== executeData(attempt).toLowerCase()) return
  const receipt = await budget.run(() => chain.client.getTransactionReceipt({hash}))
  if (receipt.status !== 'success') return
  const matches = receipt.logs.some(log => {
    if (log.address.toLowerCase() !== attempt.forwarder.toLowerCase()) return false
    try {
      const event = decodeEventLog({abi: relayForwarderAbi, eventName: 'ExecutedForwardRequest', data: log.data, topics: log.topics})
      return event.args.signer.toLowerCase() === attempt.request.from.toLowerCase() && event.args.nonce === BigInt(attempt.request.nonce) && event.args.success
    } catch { return false }
  })
  if (!matches) return
  return {id: attempt.id, txHash: hash, gasUsed: Number(receipt.gasUsed), costWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString()}
}

/**
 * Reconciled relay outcome. A receipt proves execution. Expired means the deadline passed with the nonce unused. Unresolvable means the nonce was consumed beyond the available log window; execution remains unknown and must not be retried as a new operation.
 */
export interface RelayReconciliation {
  /**
   * Verified successful execution receipt, when found.
   */
  receipt?: RelayReceipt
  /**
   * Whether the deadline passed while the request nonce remained unused.
   */
  expired: boolean
  /**
   * Whether the consumed nonce predates the available log scan, leaving execution unknown.
   */
  unresolvable?: boolean
}

async function reconcile(chain: TasraChainClient, attempt: RelayAttempt, budget: Scope): Promise<RelayReconciliation> {
  if (await budget.run(() => chain.client.getChainId()) !== attempt.chainId || hashTypedData(typed(attempt)) !== attempt.id) throw new Error('Relay reconciliation domain or request mismatch')
  const head = await budget.run(() => chain.client.getBlock({blockTag: 'latest'}))
  const nonce = await budget.run(() => chain.client.readContract({address: attempt.forwarder, abi: relayForwarderAbi, functionName: 'nonces', args: [attempt.request.from], blockNumber: head.number}))
  if (nonce < BigInt(attempt.request.nonce)) throw new RelayOutcomeUnknownError(attempt, 'Forwarder nonce moved backwards')
  if (nonce > BigInt(attempt.request.nonce)) {
    const start = BigInt(attempt.fromBlock)
    // A spent nonce prevents this exact request executing again, but does not prove whether
    // its inner call already ran. Report the bounded history gap without scanning indefinitely;
    // callers must preserve the original and must not infer permission for a new operation.
    if (start < 0n || head.number - start > 10_000n) return {expired: false, unresolvable: true}
    for (let from = start; from <= head.number; from += 2_000n) {
      const logs = await budget.run(() => chain.client.getLogs({address: attempt.forwarder,
        event: relayForwarderAbi[2], args: {signer: attempt.request.from}, fromBlock: from,
        toBlock: from + 1_999n < head.number ? from + 1_999n : head.number, strict: true}))
      for (const log of logs) {
        if (log.args.nonce !== BigInt(attempt.request.nonce) || !log.args.success) continue
        const receipt = await verifiedReceipt(chain, attempt, log.transactionHash, budget)
        if (receipt) return {receipt, expired: false}
      }
    }
    throw new RelayOutcomeUnknownError(attempt, 'Nonce consumed without a matching successful forward request')
  }
  return {expired: head.timestamp > BigInt(attempt.request.deadline)}
}

/**
 * Recover from a lost HTTP response or process restart using the trusted RPC, without broadcasting.
 * @param chain Trusted reader for the chain on which the forward request may have executed.
 * @param attempt Persisted signed request and original log-scan start block.
 * @param timeoutMs Maximum reconciliation duration in milliseconds; defaults to 30000.
 */
export async function reconcileRelayAttempt(chain: TasraChainClient, attempt: RelayAttempt, timeoutMs = 30_000): Promise<RelayReconciliation> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('Invalid reconciliation timeout')
  const budget = scope(timeoutMs)
  try { return await reconcile(chain, attempt, budget) } finally { budget.close() }
}

/**
 * One signer per instance. Serializes nonces and blocks new signatures after an uncertain result.
 * @param chain Trusted chain reader used for nonce and receipt verification.
 * @param config Approved relay providers, pinned forwarder and recovery controls.
 * @param wallet Account-bound and chain-bound wallet that signs forward requests.
 * @param options Optional durable callback invoked before submitting a signed request.
 */
export function createRegisteredRelaySubmitter(chain: TasraChainClient, config: RegisteredRelayConfig, wallet: WalletClient<Transport, Chain, Account>,
  options: {persistAttempt?: (attempt: RelayAttempt) => Promise<void>} = {}) {
  if (!Array.isArray(config.approvals) || typeof config.transport?.request !== 'function' || typeof config.transport?.relayRequest !== 'function') {
    throw new Error('Relay requires approved registry profiles and a guarded RelayTransport; a URL alone is insufficient')
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(config.forwarder) || /^0x0{40}$/.test(config.forwarder)) throw new Error('Invalid pinned relay forwarder')
  const cfg = {...config, sponsorship: config.sponsorship && Object.freeze({...config.sponsorship}), approvals: config.approvals.map(a => Object.freeze({...a}))}
  if (cfg.sponsorship && (!/^0x[0-9a-fA-F]{64}$/.test(cfg.sponsorship.slotId) || /^0x0{64}$/.test(cfg.sponsorship.slotId) ||
      typeof cfg.sponsorship.authorize !== 'function' || typeof (cfg.persistAttempt ?? options.persistAttempt) !== 'function')) throw new Error('Relay sponsorship requires an approved slot, wallet authorization and durable persistence')
  const timeout = cfg.timeoutMs ?? 120_000, pollMs = cfg.pollMs ?? 1_500, attemptMs = cfg.attemptMs ?? 10_000, busyRetries = cfg.busyRetries ?? 3
  const attempts = cfg.maxAttempts ?? Math.min(3, cfg.approvals.length)
  if (!cfg.approvals.length || cfg.approvals.length > 16 || cfg.approvals.some(a => a.serviceType !== SERVICE_TYPES.gasRelayer) ||
    !Number.isInteger(attempts) || attempts < 1 || attempts > 3 || attempts > cfg.approvals.length ||
    !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120_000 || !Number.isSafeInteger(pollMs) || pollMs < 10 ||
    !Number.isSafeInteger(attemptMs) || attemptMs < 1 || attemptMs > 30_000 || !Number.isSafeInteger(busyRetries) || busyRetries < 0 || busyRetries > 5) throw new Error('Invalid registered relayer policy')
  const exchange = (url: string, options: {body?: Uint8Array; maxBytes: number; signal: AbortSignal}): Promise<RelayHttpResponse> =>
    cfg.transport.relayExchange ? cfg.transport.relayExchange(url, options)
      // A transport without status reporting: a 422 body still names the refusal; assume the relayer's 1 s hint.
      : cfg.transport.relayRequest(url, options).then(bytes => ({status: 422, body: bytes, retryAfterMs: 1_000}))
  let serial = Promise.resolve()
  let pending: RelayAttempt | undefined

  async function submit(to: Address, data: Hex, label?: string): Promise<RelayReceipt> {
    const previous = serial
    let release = () => {}
    serial = new Promise<void>(resolve => { release = resolve })
    await previous
    const budget = scope(timeout)
    let attempt: RelayAttempt | undefined
    try {
      if (pending) throw new RelayOutcomeUnknownError(pending)
      const chainId = await budget.run(() => chain.client.getChainId())
      if (chainId !== wallet.chain.id || cfg.approvals.some(a => a.chainId !== chainId)) throw new Error('Relay chain mismatch')
      const from = wallet.account.address
      const previousAttempt = await budget.run(async () => cfg.resumeAttempt?.({chainId, forwarder: cfg.forwarder, from, to, data, label: label ?? cfg.label ?? ''}))
      if (previousAttempt) {
        if (previousAttempt.chainId !== chainId || previousAttempt.forwarder.toLowerCase() !== cfg.forwarder.toLowerCase() ||
            previousAttempt.request.from.toLowerCase() !== from.toLowerCase() || previousAttempt.request.to.toLowerCase() !== to.toLowerCase() ||
            previousAttempt.request.data.toLowerCase() !== data.toLowerCase()) throw new Error('Persisted relay operation does not match this request')
        const result = await reconcile(chain, previousAttempt, budget)
        if (result.receipt) return result.receipt
        // Unknown execution never authorizes a replacement, regardless of sponsorship.
        if (result.unresolvable) { pending = previousAttempt; throw new RelayOutcomeUnknownError(previousAttempt) }
        if (!result.expired) {
          if (cfg.sponsorship) attempt = Object.freeze({...previousAttempt, request: Object.freeze({...previousAttempt.request})})
          else { pending = previousAttempt; throw new RelayOutcomeUnknownError(previousAttempt) }
        }
      }
      if (!attempt) {
      const fromBlock = await budget.run(() => chain.client.getBlockNumber({cacheTime: 0}))
      const nonce = await budget.run(() => chain.client.readContract({address: cfg.forwarder, abi: relayForwarderAbi, functionName: 'nonces', args: [from]}))
      // The inner call is estimated without an ABI, so viem cannot name a custom error; decode it, or a
      // deployment that refuses the write (CommitRevealRequired(), say) reads as an unexplained revert.
      const estimate = await budget.run(() => chain.client.estimateGas({account: from, to, data}))
        .catch(e => {throw revertError(e, 'relay: the inner call reverts at estimation')})
      const gas = estimate + estimate / 4n + 10_000n
      if (nonce > BigInt(Number.MAX_SAFE_INTEGER) || gas > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Relay nonce or gas exceeds the exact JSON integer range')
      const request: RelayAttempt['request'] = {from, to, value: '0', gas: Number(gas), nonce: Number(nonce), deadline: Math.floor(Date.now() / 1000) + 300, data, signature: '0x', label: label ?? cfg.label ?? ''}
      const unsigned = {chainId, forwarder: cfg.forwarder, request}
      request.signature = await budget.run(() => wallet.signTypedData({account: wallet.account, ...typed(unsigned)}))
      attempt = Object.freeze({...unsigned, request: Object.freeze(request), fromBlock: fromBlock.toString(), id: hashTypedData(typed(unsigned))})
      }
      let body = new TextEncoder().encode(JSON.stringify(attempt.request))
      if (body.length > 65_536) throw new Error('Relay request too large')
      // The application can durably store this handle before any endpoint receives it.
      const persist = cfg.persistAttempt ?? options.persistAttempt
      if (persist) await budget.run(() => persist(attempt!))
      let contacted = false
      const candidates = cfg.approvals.slice(0, attempts)
      for (const [index, approval] of candidates.entries()) {
        if (contacted) {
          const result = await reconcile(chain, attempt, budget)
          if (result.receipt) { pending = undefined; return result.receipt }
          if (result.expired) { pending = undefined; throw new Error('Forward request expired without execution') }
        }
        let endpoint: string
        try {
          const authenticated = await budget.run(() => authenticateApprovedService(chain, approval, {
            request: (url, opts) => cfg.transport.request(url, {...opts, signal: AbortSignal.any([opts.signal, budget.signal])}),
          }))
          if (!authenticated.manifest.capabilities.includes('relay-forward')) throw new Error('Service does not advertise relay-forward')
          endpoint = authenticated.record.endpoint
        } catch { budget.signal.throwIfAborted(); continue }
        if (cfg.sponsorship) {
          if (!attempt.voucher) {
            const intentBody = new TextEncoder().encode(JSON.stringify({kind: 'forward', ...attempt.request}))
            const bytes = await budget.run(() => cfg.transport.relayRequest(endpoint + '/v1/relay/voucher-intent', {body: intentBody, maxBytes: 65_536, signal: budget.signal}))
            if (bytes.length > 65_536) throw new Error('Relay voucher intent too large')
            const intent: unknown = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes))
            assertRelayVoucherIntent(intent, attempt, cfg.sponsorship.slotId)
            const voucher = JSON.parse(JSON.stringify(await budget.run(() => cfg.sponsorship!.authorize({attempt: attempt!, intent, signal: budget.signal})))) as unknown
            assertRelayVoucher(voucher, attempt, cfg.sponsorship.slotId)
            const freeze = (value: object): void => { for (const child of Object.values(value) as unknown[]) if (child && typeof child === 'object') freeze(child); Object.freeze(value) }
            freeze(voucher)
            attempt = Object.freeze({...attempt, voucher})
          }
          assertRelayVoucher(attempt.voucher, attempt, cfg.sponsorship.slotId)
          body = new TextEncoder().encode(JSON.stringify({...attempt.request, voucher: attempt.voucher}))
          if (body.length > 65_536) throw new Error('Relay request too large')
          // The voucher and original forward signature are retained together before any gas can be spent.
          await budget.run(() => persist!(attempt!))
        }
        pending = attempt
        contacted = true
        // A busy refusal (full lane/journal, unavailable shared budget) is answered before anything
        // is journaled. Re-send the IDENTICAL signed bytes after the requested wait: the forwarder
        // spends this nonce once, so a repeat can never execute the call twice. Nothing is re-signed.
        let busySends = 0, busyWaited = 0
        const post = async () => {
          for (;;) {
            let busy: {retryAfterMs?: number} | undefined
            try {
              busy = busyRefusal(await budget.run(() => exchange(endpoint + '/v1/relay/forward', {body, maxBytes: 4_096, signal: budget.signal})))
            } catch { budget.signal.throwIfAborted() }
            if (!busy) return
            const delay = retryDelayMs(busySends, busy.retryAfterMs ?? 1_000, {maxAttempts: busyRetries + 1, maxDelayMs: 10_000, maxTotalWaitMs: 10_000}, busyWaited)
            if (delay === undefined) return
            busySends++; busyWaited += delay
            await budget.run(() => new Promise(resolve => setTimeout(resolve, delay)))
          }
        }
        await post()
        // attemptMs is the failover window to the NEXT provider. The last provider has no successor, so its
        // accepted request is watched for the rest of the relay budget rather than declared unknown early
        // (a single approved relayer serialising several applications mined the call after 18 s).
        const until = index < candidates.length - 1 ? Date.now() + attemptMs : Number.POSITIVE_INFINITY
        do {
          // A lost POST response still has a deterministic status ID.
          try {
            const bytes = await budget.run(() => cfg.transport.relayRequest(endpoint + '/v1/relay/' + attempt!.id, {maxBytes: 4_096, signal: budget.signal}))
            if (bytes.length > 4_096) throw new Error('Relay status too large')
            const status = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)) as {id: string; tx_hash?: Hex; state: string}
            if (status.id !== attempt.id) throw new Error('Relay status request mismatch')
            if (status.state === 'mined' && /^0x[0-9a-fA-F]{64}$/.test(status.tx_hash ?? '')) {
              const receipt = await verifiedReceipt(chain, attempt, status.tx_hash!, budget)
              if (receipt) { pending = undefined; return receipt }
            }
            if (status.state === 'rejected' && isRelayBusyReason((status as {reason?: unknown}).reason) && busySends < busyRetries) {
              // Same identical bytes; counted against the same per-provider busy budget.
              busySends++
              await budget.run(() => new Promise(resolve => setTimeout(resolve, Math.min(1_000, Math.max(1, until - Date.now())))))
              await post()
            } else if (['failed', 'rejected', 'unknown'].includes(status.state)) break
          } catch {
            budget.signal.throwIfAborted()
            // A lost or unreadable status fails over to the next provider; the last one is reconciled on chain.
            if (index < candidates.length - 1) break
          }
          const result = await reconcile(chain, attempt, budget)
          if (result.receipt) { pending = undefined; return result.receipt }
          if (result.expired) { pending = undefined; throw new Error('Forward request expired without execution') }
          // A nonce spent beyond the log window is a final verdict: stop watching, keep the original.
          if (result.unresolvable) break
          await budget.run(() => new Promise(resolve => setTimeout(resolve, Math.min(pollMs, Math.max(1, until - Date.now())))))
        } while (Date.now() < until)
      }
      if (!contacted) throw new Error('No approved relayer authenticated')
      const result = await reconcile(chain, attempt, budget)
      if (result.receipt) { pending = undefined; return result.receipt }
      if (result.expired) { pending = undefined; throw new Error('Forward request expired without execution') }
      throw new RelayOutcomeUnknownError(attempt)
    } catch (error) {
      if (pending) throw new RelayOutcomeUnknownError(pending, error instanceof Error ? error.message : undefined)
      throw error
    } finally { budget.close(); release() }
  }
  return {submit, pendingAttempt: () => pending,
    async reconcile() {
      if (!pending) return undefined
      const current = pending
      const result = await reconcileRelayAttempt(chain, current)
      // Only verified execution or a proven unused expired nonce releases the signer.
      if (pending === current && (result.receipt || result.expired)) pending = undefined
      return result
    },
  }
}
