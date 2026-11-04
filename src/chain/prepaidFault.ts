// Clients for prepaid payout faults: the accountant witness intake, its health status, and
// the PrepaidFaultOracle that executes a threshold-signed verdict.
//
// A victim (or anyone holding signed evidence) hands an accountant a proof bundle; the
// accountant set adjudicates and threshold-signs a verdict; anyone may relay that verdict to
// the oracle, which slashes the offender (and pays a bounty to the under-credited worker).
// None of these calls is retried automatically: a lost claim reply is re-sent by the caller
// once it has decided to, and a contest transaction is reconciled like any other write.

import {encodeFunctionData, type Account, type Address, type Chain, type Hex, type PublicClient, type Transport, type WalletClient} from 'viem'
import {prepaidFaultOracleAbi} from './abis/prepaidFaultOracle.js'
import {revertError} from './revertReason.js'
import {httpError, TasraError} from '../errors.js'

/** Fault kinds in the oracle's enum order. */
export const PREPAID_FAULT_KINDS = ['WrongPayout', 'KeeperUndercredit', 'KeeperOvercredit', 'VerifierUndercredit', 'VerifierOvercredit'] as const
/** A prepaid payout fault kind. */
export type PrepaidFaultKind = (typeof PREPAID_FAULT_KINDS)[number]

/** The verdict the accountant set threshold-signs and the oracle executes. */
export interface PrepaidFaultVerdict {
  /** Slot of the settled request. */
  slotId: Hex
  /** Settled prepaid request. */
  requestId: Hex
  /** Mined batch that settled it. */
  batchId: Hex
  /** Commitment to the adjudicated evidence. */
  evidenceHash: Hex
  /** Operator to slash. */
  offender: Address
  /** Under-credited worker paid the bounty; zero for every other kind. */
  beneficiary: Address
  /** Fault kind. */
  kind: PrepaidFaultKind
  /** Beacon epoch the verdict was signed at; must be current when executed. */
  epoch: bigint
  /** Unix deadline, at most 120 s after execution time. */
  deadline: bigint
}

/** Accountant claim intake byte limit (the witness's own bundle maximum). */
export const MAX_PREPAID_FAULT_BUNDLE_BYTES = 768 * 1024
const HEX32 = /^0x[0-9a-fA-F]{64}$/
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const MAX_VERDICT_LIFETIME = 120n

function verdictTuple(v: PrepaidFaultVerdict, nowSecs: bigint) {
  for (const [name, value] of [['slotId', v.slotId], ['requestId', v.requestId], ['batchId', v.batchId], ['evidenceHash', v.evidenceHash]] as const) {
    if (typeof value !== 'string' || !HEX32.test(value) || /^0x0{64}$/.test(value)) throw new TasraError(`Invalid prepaid fault verdict ${name}`)
  }
  if (!ADDRESS.test(v.offender) || v.offender.toLowerCase() === ZERO_ADDRESS || !ADDRESS.test(v.beneficiary)) throw new TasraError('Invalid prepaid fault verdict offender or beneficiary')
  const kind = PREPAID_FAULT_KINDS.indexOf(v.kind)
  if (kind < 0) throw new TasraError('Invalid prepaid fault kind')
  const undercredit = v.kind === 'KeeperUndercredit' || v.kind === 'VerifierUndercredit'
  const none = v.beneficiary.toLowerCase() === ZERO_ADDRESS
  if (undercredit ? none || v.beneficiary.toLowerCase() === v.offender.toLowerCase() : !none) throw new TasraError('Only an under-credit verdict names a beneficiary, and never the offender')
  if (typeof v.epoch !== 'bigint' || v.epoch < 0n || v.epoch >= 2n ** 64n || typeof v.deadline !== 'bigint'
    || v.deadline <= nowSecs || v.deadline - nowSecs > MAX_VERDICT_LIFETIME) throw new TasraError('Prepaid fault verdict epoch or deadline is outside the oracle window')
  return {slotId: v.slotId, requestId: v.requestId, batchId: v.batchId, evidenceHash: v.evidenceHash, offender: v.offender,
    beneficiary: v.beneficiary, kind, epoch: v.epoch, deadline: v.deadline}
}
function signatureBytes(signature: Hex): Hex {
  if (typeof signature !== 'string' || !/^0x(?:[0-9a-fA-F]{2}){1,512}$/.test(signature)) throw new TasraError('Invalid prepaid fault verdict signature')
  return signature
}

/**
 * Calldata for `PrepaidFaultOracle.contest`, after the oracle's local preconditions
 * (nonzero subject, beneficiary rule, a deadline within 120 s). Chain-dependent checks
 * (current epoch, settled request and batch, signature) stay with the oracle.
 * @param verdict Threshold-signed verdict.
 * @param signature BN254 threshold signature over the verdict digest.
 * @param nowSecs Current time in Unix seconds (default: now).
 */
export function encodePrepaidFaultContest(verdict: PrepaidFaultVerdict, signature: Hex, nowSecs = BigInt(Math.floor(Date.now() / 1000))): Hex {
  return encodeFunctionData({abi: prepaidFaultOracleAbi, functionName: 'contest', args: [verdictTuple(verdict, nowSecs), signatureBytes(signature)]})
}

/**
 * Whether the oracle already punished this offender for this batch (one resolution per
 * offender and batch, whatever the kind or evidence).
 * @param client Trusted RPC client.
 * @param oracle Independently approved PrepaidFaultOracle.
 * @param subject Slot, batch and offender.
 */
export async function readPrepaidFaultResolution(client: PublicClient, oracle: Address, subject: {slotId: Hex; batchId: Hex; offender: Address}): Promise<{resolutionId: Hex; resolved: boolean}> {
  if (!ADDRESS.test(oracle) || !HEX32.test(subject.slotId) || !HEX32.test(subject.batchId) || !ADDRESS.test(subject.offender)) throw new TasraError('Invalid prepaid fault resolution query')
  const block = await client.getBlockNumber({cacheTime: 0})
  const resolutionId = await client.readContract({address: oracle, abi: prepaidFaultOracleAbi, functionName: 'resolutionId', args: [subject.slotId, subject.batchId, subject.offender], blockNumber: block})
  const resolved = await client.readContract({address: oracle, abi: prepaidFaultOracleAbi, functionName: 'resolved', args: [resolutionId], blockNumber: block})
  return {resolutionId, resolved}
}

/**
 * Relay a threshold-signed verdict to the oracle. The call is simulated first, so an oracle
 * refusal (WrongEpoch, AlreadyResolved, BadSignature, ...) is named and nothing is sent; the
 * transaction is then sent once and its hash returned. Reconcile an unknown outcome with
 * {@link readPrepaidFaultResolution}; never resend blindly.
 * @param client Trusted RPC client.
 * @param wallet Account- and chain-bound sender (any account: contest is permissionless).
 * @param oracle Independently approved PrepaidFaultOracle.
 * @param verdict Threshold-signed verdict.
 * @param signature BN254 threshold signature over the verdict digest.
 */
export async function contestPrepaidFault(client: PublicClient, wallet: WalletClient<Transport, Chain, Account>, oracle: Address,
  verdict: PrepaidFaultVerdict, signature: Hex): Promise<Hex> {
  if (!ADDRESS.test(oracle) || /^0x0{40}$/.test(oracle)) throw new TasraError('Invalid PrepaidFaultOracle address')
  const args = [verdictTuple(verdict, BigInt(Math.floor(Date.now() / 1000))), signatureBytes(signature)] as const
  const {request} = await client.simulateContract({address: oracle, abi: prepaidFaultOracleAbi, functionName: 'contest', args, account: wallet.account})
    .catch((error: unknown) => { throw revertError(error, 'prepaid fault contest refused') })
  return wallet.writeContract(request)
}

/** Options for the accountant fault endpoints. */
export interface PrepaidFaultHttpOptions {
  /** Fetch implementation (default global fetch). */
  fetch?: typeof fetch
  /** Cancellation. */
  signal?: AbortSignal
  /** Per-request deadline in ms (default 30000). */
  timeoutMs?: number
  /** Permit plain HTTP to a loopback accountant (local development only). */
  allowLocalHttp?: boolean
}

function accountantUrl(base: string, path: string, allowLocalHttp: boolean): string {
  const url = new URL(base)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || (allowLocalHttp && loopback && url.protocol === 'http:'))) throw new TasraError('Invalid accountant endpoint')
  return url.toString().replace(/\/$/, '') + path
}
function deadline(options: PrepaidFaultHttpOptions): AbortSignal {
  const ms = options.timeoutMs ?? 30_000
  if (!Number.isSafeInteger(ms) || ms < 1 || ms > 120_000) throw new TasraError('Invalid accountant request timeout')
  return options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms)
}

/**
 * Hand a proof bundle to an accountant's fault witness (`POST /v1/prepaid-fault/claim`).
 * Resolves on HTTP 202 (authenticated and durably stored). Any other status throws a
 * TasraHttpError with the service's `Retry-After`: 400 malformed, 403 nothing authenticated,
 * 413 too large are final; 408, 429 and 503 may be sent again later. Never re-sent here.
 * @param base Approved accountant origin.
 * @param bundle Proof bundle (`version` 1, `slot`, `batch_id`, `reconcile_block`, signed records).
 * @param options Fetch, cancellation, deadline and local HTTP allowance.
 */
export async function submitPrepaidFaultClaim(base: string, bundle: Record<string, unknown>, options: PrepaidFaultHttpOptions = {}): Promise<{status: 202}> {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle) || bundle.version !== 1
    || typeof bundle.slot !== 'string' || !HEX32.test(bundle.slot) || typeof bundle.batch_id !== 'string' || !HEX32.test(bundle.batch_id)
    || !Number.isSafeInteger(bundle.reconcile_block) || Number(bundle.reconcile_block) < 0 || !Array.isArray(bundle.requests)) throw new TasraError('Invalid prepaid fault proof bundle')
  const body = JSON.stringify(bundle)
  if (new TextEncoder().encode(body).length > MAX_PREPAID_FAULT_BUNDLE_BYTES) throw new TasraError('Prepaid fault proof bundle exceeds the witness limit')
  const url = accountantUrl(base, '/v1/prepaid-fault/claim', options.allowLocalHttp === true)
  const response = await (options.fetch ?? globalThis.fetch)(url, {method: 'POST', body, headers: {'content-type': 'application/json'},
    redirect: 'error', credentials: 'omit', cache: 'no-store', signal: deadline(options)})
  if (response.status === 202) { await response.body?.cancel().catch(() => {}); return {status: 202} }
  throw await httpError(response, url, 'prepaid-fault/claim')
}

/**
 * Read an accountant fault witness's adjudication health (`GET /v1/prepaid-fault/status`).
 * The body is returned as parsed JSON, bounded to 64 KiB; it is a monitoring view, not evidence.
 * @param base Approved accountant origin.
 * @param options Fetch, cancellation, deadline and local HTTP allowance.
 */
export async function readPrepaidFaultStatus(base: string, options: PrepaidFaultHttpOptions = {}): Promise<Record<string, unknown>> {
  const url = accountantUrl(base, '/v1/prepaid-fault/status', options.allowLocalHttp === true)
  const response = await (options.fetch ?? globalThis.fetch)(url, {headers: {accept: 'application/json'}, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: deadline(options)})
  if (response.status !== 200) throw await httpError(response, url, 'prepaid-fault/status')
  const text = await response.text()
  if (text.length > 65_536) throw new TasraError('Prepaid fault status exceeds its bound')
  const value = JSON.parse(text) as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TasraError('Invalid prepaid fault status')
  return value as Record<string, unknown>
}
