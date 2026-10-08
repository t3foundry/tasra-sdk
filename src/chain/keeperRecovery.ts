import {type Hex, type PublicClient} from 'viem'
import {MAX_EXECUTION_BODY_BYTES, type ClientExecutionSigner} from '../committee/execution.js'
import {assertPaymentIntentWire, type PaymentIntentWire} from '../committee/payment.js'
import {createExecutionRecoveryAuthorization, paidExecutionRequest, verifyRecoveredExecutionResult,
  type ExecutionRecoveryTarget, type RecoveredExecutionReply, type SignedPaidExecutionReport} from '../committee/recovery.js'
import {parseExecutionJson} from '../committee/recoveryJson.js'
import {protocolHex} from '../committee/receipts.js'
import {readKeeperExecutionRecoveryPolicy, type ExpectedPaidOperation, type KeeperExecutionRecoveryObservation,
  type PaidKeeperEndpoint, type PaidKeeperTransportOptions, type PrepaidDeployment} from './prepaid.js'

/** Bounded keeper responses; no body text is included in transport errors. */
export interface KeeperRecoveryHttpResponse {
  /** Observed status; a refusal is never permission to execute or reserve again. */
  status: number
  /** Exact bounded response bytes. Completed results are private; never log them. */
  body: Uint8Array
  /** Parsed `Retry-After` in ms, when the keeper sent one. */
  retryAfterMs?: number
}

/** Client-approved transport for public evidence and authenticated retained-result reads. */
export interface KeeperRecoveryTransport {
  /** TLS and socket destination policy, no redirects, no automatic resends, bounded cancellation. */
  keeperRecoveryRequest(url: string, options: {
    /** Complete locally constructed JSON; recovery contains only public payment and a fresh client signature. */
    body: Uint8Array
    /** Bound checked while receiving, including responses without Content-Length. */
    maxBytes: number
    /** Caller-owned cancellation plus the SDK's total recovery deadline. */
    signal: AbortSignal
  }): Promise<KeeperRecoveryHttpResponse>
}

/** Result disclosed only after original canonical payment and exact-byte commitment checks. */
export interface RecoveredKeeperExecution {
  /** Original history; its accepted-time policy grants no fresh execution permission. */
  observation: KeeperExecutionRecoveryObservation
  /** Signed original completed work evidence. */
  execution: SignedPaidExecutionReport
  /** Operation-specific retained result encoding. */
  encoding: RecoveredExecutionReply['encoding']
  /** Exact JSON bytes as a string, authenticated before exposure; may differ from the original HTTP envelope. */
  resultJson: string
}

/** Safe status error without private result text; no failed read triggers paid work. */
export class KeeperRecoveryError extends Error {
  constructor(
    /** Observed original keeper response status. */ readonly httpStatus: number,
    /** Keeper-requested wait before reading again, in ms, when sent. */ readonly retryAfterMs?: number,
  ) {
    super(`Keeper result recovery returned HTTP ${httpStatus}`)
    this.name = 'KeeperRecoveryError'
  }
}

/** Immutable local recovery intent and explicitly approved network capabilities. */
export interface RecoverKeeperExecutionOptions {
  /** Trusted bounded EIP-1898 RPC client for the independently selected chain. */
  client: PublicClient
  /** Approved chain and contract addresses. */
  deployment: PrepaidDeployment
  /** Original creator payment retained before submission. */
  payment: PaymentIntentWire
  /** Independently intended slot, action and payload digest. */
  expected: ExpectedPaidOperation
  /** Original assigned worker endpoint retained at submission, not downloaded from its response. */
  keeper: PaidKeeperEndpoint
  /** Original paid stage and creator-certified client public key retained before submission. */
  target: Omit<ExecutionRecoveryTarget, 'operatorKey'>
  /** Original client-only execution signer; its private seed is never sent. */
  signer: ClientExecutionSigner
  /** Caller-approved guarded transport; Node applications can use createNodeKeeperRecoveryTransport. */
  transport: KeeperRecoveryTransport
  /** Explicit local HTTP endpoint policy; never permits HTTP on official Fuji. */
  transportPolicy?: PaidKeeperTransportOptions
  /** Optional cancellation. The complete read, RPC and signature flow also has a 60-second deadline. */
  signal?: AbortSignal
  /** Optional nonzero local correlation nonce for a deterministic authenticated read. */
  nonce?: Hex
}

function endpoint(keeper: PaidKeeperEndpoint, deployment: PrepaidDeployment, policy: PaidKeeperTransportOptions): string {
  protocolHex(keeper.operator, 20, 'retained keeper operator'); protocolHex(keeper.publicKey, 32, 'retained keeper key')
  if (keeper.url.length > 512) throw new Error('Invalid retained keeper endpoint')
  const url = new URL(keeper.url)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.search || url.hash
    || (url.protocol !== 'https:' && !(deployment.chainId === 43112 && policy.allowLocalHttp === true && local && url.protocol === 'http:'))) throw new Error('Invalid retained keeper transport policy')
  return url.toString().replace(/\/$/, '')
}

/**
 * Read completed keeper results without resubmitting payment, key work, nonce preparation or closure.
 * Authenticate the worker report and original canonical reserved history before requesting a fresh
 * client signature. Then independently verify returned evidence and exact result bytes. Missing,
 * failed, interrupted, orphaned or unavailable history is a refusal, never an automatic retry of work.
 * @param options Locally retained original intent, client signer and approved read capabilities.
 */
export async function recoverKeeperExecution(options: RecoverKeeperExecutionOptions): Promise<RecoveredKeeperExecution> {
  assertPaymentIntentWire(options.payment)
  const payment = structuredClone(options.payment), deployment = {...options.deployment}, expected = {...options.expected}
  const keeper = {...options.keeper}, target = {...options.target, operatorKey: keeper.publicKey}
  const client = options.client, signer = options.signer, transport = options.transport, policy = {...options.transportPolicy}, nonce = options.nonce
  const base = endpoint(keeper, deployment, policy)
  const controller = new AbortController(), active = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
  const timer = setTimeout(() => controller.abort(new Error('Keeper result recovery deadline exceeded')), 60_000)
  let abort = () => {}
  const work = async (): Promise<RecoveredKeeperExecution> => {
    active.throwIfAborted()
    const request = paidExecutionRequest(payment)
    const query = new TextEncoder().encode(JSON.stringify({request, stage: target.stage}))
    const evidence = await transport.keeperRecoveryRequest(base + '/v1/prepaid/execution', {body: query, maxBytes: 65_536, signal: active})
    active.throwIfAborted()
    if (evidence.status !== 200) throw new KeeperRecoveryError(evidence.status, evidence.retryAfterMs)
    const execution = parseExecutionJson(evidence.body, 65_536) as SignedPaidExecutionReport
    const observation = await readKeeperExecutionRecoveryPolicy(client, deployment, payment, expected, target, execution, policy)
    active.throwIfAborted()
    // The retained endpoint is itself a client-approved network destination; the original operator identity must match.
    if (observation.keeper.operator.toLowerCase() !== keeper.operator.toLowerCase()) throw new Error('Retained keeper differs from original canonical operator')
    const authorization = await createExecutionRecoveryAuthorization({payment, policy: observation.policy, target, execution, signer,
      nowSecs: Math.floor(Date.now() / 1000), nonce})
    active.throwIfAborted()
    // result_json is a JSON string; escaping a maximum-size result may require six bytes per source byte.
    const maxReplyBytes = 6 * MAX_EXECUTION_BODY_BYTES + 65_536
    const body = new TextEncoder().encode(JSON.stringify({payment, authorization}))
    const response = await transport.keeperRecoveryRequest(base + '/v1/prepaid/execution/recover', {body, maxBytes: maxReplyBytes, signal: active})
    active.throwIfAborted()
    if (response.status !== 200) throw new KeeperRecoveryError(response.status, response.retryAfterMs)
    const reply = parseExecutionJson(response.body, maxReplyBytes) as RecoveredExecutionReply
    const resultJson = await verifyRecoveredExecutionResult({payment, policy: observation.policy, target, expectedExecution: execution, reply})
    active.throwIfAborted()
    return {observation, execution: reply.execution, encoding: reply.encoding, resultJson}
  }
  try {
    active.throwIfAborted()
    return await Promise.race([work(), new Promise<never>((_, reject) => {
      abort = () => reject(active.reason); active.addEventListener('abort', abort, {once: true})
      if (active.aborted) abort()
    })])
  } finally {clearTimeout(timer); active.removeEventListener('abort', abort); controller.abort()}
}
