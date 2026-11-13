// Custody health of a slot (network ADR-0099 D5): what each keeper of the committee says about its
// own share, verified against the operator's REGISTERED identity key, plus the committee's state
// read from the chain.
//
// A keeper answers `GET /v1/keys/:id/custody-health` with a JSON body and an `attestation`: a
// statement signed by its operator identity key (ed25519) over `custodyStatementHash`. Only the
// statement is signed. The SDK therefore:
//   - verifies the signature under the key NodeRegistry holds for the polled operator, never the
//     `pubkey` the reply names;
//   - refuses an unsigned, malformed, stale or mismatched reply with a typed `CustodyHealthError`;
//   - returns only signed fields, and derives the committee's liveness, margin and rotation lock
//     from its own chain reads, never from the reply's unsigned body.
// The hash mirrors `keykeeper_committee::custody_health::custody_statement_hash` byte for byte.

import {ed25519} from '@noble/curves/ed25519'
import {keccak_256} from '@noble/hashes/sha3'
import {concatBytes, utf8ToBytes} from '@noble/hashes/utils'
import {bytesToHex, getAddress, hexToBytes, isAddress, keccak256, toHex, type Address, type Hex} from 'viem'
import {TasraError} from '../errors.js'
import {resolveKeeperMembers, withNetworkDeadline} from '../internal/network.js'
import {viemErrorChainHas} from '../internal/viemErrors.js'
import {keyRegistryAbi} from './abis/keyRegistry.js'
import {nodeRegistryAbi} from './abis/nodeRegistry.js'
import {chainIdOf} from './chainId.js'
import type {TasraChainClient} from './client.js'
import {requireAddress} from './deployments.js'
import {ROTATION_LOCK_SENTINEL} from './rotationLock.js'

/** Domain tag of {@link custodyStatementHash}; a changed preimage gets a new name on the network. */
export const CUSTODY_HEALTH_DOMAIN = 'keykeeper-committee/custody-health/v1'

/** Default maximum age of a statement, in seconds; the keepers count a peer's statement for 900 s. */
export const CUSTODY_STATEMENT_MAX_AGE_SECS = 900

/** Largest custody-health reply read from a keeper, in bytes. */
const MAX_REPLY_BYTES = 64 * 1024

/** NodeRegistry keeper tag, `keccak256("keykeeper")`: a live committee member is an active keeper. */
const KEEPER_TAG = keccak256(toHex('keykeeper'))

/** The reshare states a keeper reports for its own share. */
export type CustodyReshareState = 'current' | 'pending' | 'not_member' | 'no_key' | 'unknown'
const RESHARE_STATES: readonly string[] = ['current', 'pending', 'not_member', 'no_key', 'unknown']

/** The last threshold-ECDSA reshare the keeper failed for the slot, as it signed it. */
export interface CustodyFailure {
  /** Committee version the failed reshare targeted. */
  committeeVersion: number
  /** On-chain operator id of the party the refusal named, or `null` when it named none. */
  blamedOperatorId: number | null
  /** The keeper's reason text; diagnostic, never parse it. */
  reason: string
}

/** What one keeper signed about one slot. Hex fields are lowercase. */
export interface CustodyStatement {
  /** Chain the keeper read. */
  chainId: number
  /** Slot the statement is about. */
  slot: Hex
  /** Operator address of the signing keeper. */
  operator: Address
  /** The chain's key epoch as the keeper read it. */
  epoch: number
  /** The chain's committee version as the keeper read it. */
  committeeVersion: number
  /** The chain's anchored public key as the keeper read it; `0x` before a key exists. */
  publicKey: Hex
  /** Whether the keeper's share is at the chain's generation; `pending` means a reshare it has not finished. */
  reshare: CustodyReshareState
  /** Committee version of the share the keeper holds, or `null` when it holds none or cannot tell. */
  shareCommitteeVersion: number | null
  /** Whether the keeper's share belongs to the chain's key, or `null` when it cannot tell. */
  shareMatchesChainKey: boolean | null
  /** Older share generations the keeper still holds, or `null` when it cannot tell. */
  retainedGenerations: number | null
  /** The keeper's last failed reshare of this slot, or `null`. */
  lastFailure: CustodyFailure | null
  /** Unix seconds at which the keeper made the statement. */
  observedAt: number
}

/**
 * Stable refusal categories of a custody-health reply; branch on `code`, never on the message.
 * `unreachable` and `stale` may pass on a later poll; the others need a different keeper or reply.
 */
export type CustodyHealthErrorCode =
  | 'unsigned'
  | 'malformed'
  | 'bad-signature'
  | 'stale'
  | 'mismatch'
  | 'not-registered'
  | 'unreachable'
  | 'no-slot'

/** A custody-health reply that was not counted, or a slot that could not be read. */
export class CustodyHealthError extends TasraError {
  /** Refusal category; never infer it from the message. */
  readonly code: CustodyHealthErrorCode
  /** Operator whose reply was refused, when the refusal is about one keeper. */
  readonly operator?: Address

  constructor(code: CustodyHealthErrorCode, message: string, opts: {operator?: Address; cause?: unknown} = {}) {
    super(message, {cause: opts.cause, retryable: code === 'unreachable' || code === 'stale'})
    this.code = code
    if (opts.operator !== undefined) this.operator = opts.operator
  }
}

function u64(v: number): Uint8Array {
  const out = new Uint8Array(8)
  new DataView(out.buffer).setBigUint64(0, BigInt(v))
  return out
}
function lengthPrefixed(b: Uint8Array): Uint8Array {
  return concatBytes(u64(b.length), b)
}
function optU64(v: number | null): Uint8Array {
  return v === null ? new Uint8Array([0]) : concatBytes(new Uint8Array([1]), u64(v))
}

/**
 * `keccak256(domain || fields)`, every field fixed-width or length-prefixed and every optional
 * field tagged: the 32 bytes a keeper signs. Identical to the network's `custody_statement_hash`.
 * @param s Statement to hash; integers must be non-negative safe integers.
 */
export function custodyStatementHash(s: CustodyStatement): Uint8Array {
  const failure = s.lastFailure === null
    ? new Uint8Array([0])
    : concatBytes(new Uint8Array([1]), u64(s.lastFailure.committeeVersion), optU64(s.lastFailure.blamedOperatorId),
      lengthPrefixed(utf8ToBytes(s.lastFailure.reason)))
  return keccak_256(concatBytes(
    utf8ToBytes(CUSTODY_HEALTH_DOMAIN),
    u64(s.chainId), hexToBytes(s.slot), hexToBytes(s.operator), u64(s.epoch), u64(s.committeeVersion),
    lengthPrefixed(hexToBytes(s.publicKey)), lengthPrefixed(utf8ToBytes(s.reshare)),
    optU64(s.shareCommitteeVersion), optU64(s.shareMatchesChainKey === null ? null : Number(s.shareMatchesChainKey)),
    optU64(s.retainedGenerations), failure, u64(s.observedAt),
  ))
}

/**
 * Whether `signature` is the operator's ed25519 signature over the statement. Take `publicKey`
 * from NodeRegistry for `statement.operator`, never from the reply.
 * @param statement Statement as parsed from the reply.
 * @param publicKey The operator's registered 32-byte identity key.
 * @param signature 64-byte signature from the reply.
 */
export function verifyCustodyStatement(statement: CustodyStatement, publicKey: Uint8Array, signature: Uint8Array): boolean {
  if (publicKey.length !== 32 || signature.length !== 64) return false
  try {
    return ed25519.verify(signature, custodyStatementHash(statement), publicKey, {zip215: false})
  } catch {
    return false
  }
}

const malformed = (message: string, operator?: Address) => new CustodyHealthError('malformed', message, operator ? {operator} : {})

function record(v: unknown, what: string, keys: readonly string[], required: readonly string[], operator?: Address): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw malformed(`custody-health ${what} is not an object`, operator)
  const r = v as Record<string, unknown>
  const unknown = Object.keys(r).find(k => !keys.includes(k))
  if (unknown !== undefined) throw malformed(`custody-health ${what} carries an unsigned field ${JSON.stringify(unknown)}`, operator)
  const missing = required.find(k => !(k in r))
  if (missing !== undefined) throw malformed(`custody-health ${what} lacks ${missing}`, operator)
  return r
}
function int(v: unknown, field: string, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > max) throw malformed(`custody statement ${field} is not an integer in range`)
  return v
}
function optInt(v: unknown, field: string, max?: number): number | null {
  return v === undefined || v === null ? null : int(v, field, max)
}
function hex(v: unknown, field: string, bytes?: number): Hex {
  if (typeof v !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(v) || (bytes !== undefined && v.length !== 2 + bytes * 2)) {
    throw malformed(`custody statement ${field} is not ${bytes === undefined ? 'hex' : `${bytes} bytes of hex`}`)
  }
  return v.toLowerCase() as Hex
}

const STATEMENT_KEYS = ['chain_id', 'slot', 'operator', 'epoch', 'committee_version', 'public_key', 'reshare', 'share_committee_version',
  'share_matches_chain_key', 'retained_generations', 'last_failure', 'observed_at']
const STATEMENT_REQUIRED = ['chain_id', 'slot', 'operator', 'epoch', 'committee_version', 'public_key', 'reshare', 'observed_at']

/**
 * Parse a statement as the network serializes it (snake case). Refuses unknown fields: they would
 * not be covered by the signature. Throws `CustodyHealthError` with code `malformed`.
 * @param raw The `attestation.statement` value of a reply.
 */
export function parseCustodyStatement(raw: unknown): CustodyStatement {
  const r = record(raw, 'statement', STATEMENT_KEYS, STATEMENT_REQUIRED)
  if (typeof r.reshare !== 'string' || !RESHARE_STATES.includes(r.reshare)) throw malformed('custody statement reshare is not a known state')
  const matches = r.share_matches_chain_key
  if (matches !== undefined && matches !== null && typeof matches !== 'boolean') throw malformed('custody statement share_matches_chain_key is not a boolean')
  let lastFailure: CustodyFailure | null = null
  if (r.last_failure !== undefined && r.last_failure !== null) {
    const f = record(r.last_failure, 'last_failure', ['committee_version', 'blamed_operator_id', 'reason'], ['committee_version', 'reason'])
    if (typeof f.reason !== 'string') throw malformed('custody statement last_failure.reason is not a string')
    lastFailure = {committeeVersion: int(f.committee_version, 'last_failure.committee_version'),
      blamedOperatorId: optInt(f.blamed_operator_id, 'last_failure.blamed_operator_id', 0xffff), reason: f.reason}
  }
  return {
    chainId: int(r.chain_id, 'chain_id'), slot: hex(r.slot, 'slot', 32), operator: hex(r.operator, 'operator', 20),
    epoch: int(r.epoch, 'epoch'), committeeVersion: int(r.committee_version, 'committee_version'), publicKey: hex(r.public_key, 'public_key'),
    reshare: r.reshare as CustodyReshareState, shareCommitteeVersion: optInt(r.share_committee_version, 'share_committee_version'),
    shareMatchesChainKey: (matches ?? null), retainedGenerations: optInt(r.retained_generations, 'retained_generations'),
    lastFailure, observedAt: int(r.observed_at, 'observed_at'),
  }
}

/** What a reply must be about, and the key it must be signed with. */
export interface ExpectedCustodyReply {
  /** Chain the statement must name. */
  chainId: number
  /** Slot that was polled. */
  slotId: Hex
  /** Operator whose keeper was polled. */
  operator: Address
  /** The operator's identity key as NodeRegistry holds it (32 bytes, or its hex). */
  registeredPublicKey: Uint8Array | Hex
  /** Current Unix seconds; defaults to the local clock. */
  nowSecs?: number
  /** Maximum statement age in either direction, in seconds; defaults to {@link CUSTODY_STATEMENT_MAX_AGE_SECS}. */
  maxAgeSecs?: number
}

/** A keeper's custody statement whose signature verified under the operator's registered key. */
export interface VerifiedCustodyReport {
  /** Operator that signed it (checksummed). */
  operator: Address
  /** The signed statement; nothing outside it is returned. */
  statement: CustodyStatement
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** Compare an unsigned reply field with its signed counterpart; absent is fine, different is not. */
function agrees(body: Record<string, unknown>, s: CustodyStatement): string | undefined {
  const chain = typeof body.chain === 'object' && body.chain !== null ? body.chain as Record<string, unknown> : {}
  const failure = body.last_failure as {committee_version?: unknown; blamed_operator_id?: unknown; reason?: unknown} | null | undefined
  const checks: [string, unknown, unknown][] = [
    ['slot', typeof body.slot === 'string' ? body.slot.toLowerCase() : body.slot, s.slot],
    ['reshare', body.reshare, s.reshare],
    ['observed_at', body.observed_at, s.observedAt],
    ['chain.epoch', chain.epoch, s.epoch],
    ['chain.committee_version', chain.committee_version, s.committeeVersion],
    ['chain.public_key', typeof chain.public_key === 'string' ? chain.public_key.toLowerCase() : chain.public_key, s.publicKey],
  ]
  for (const [field, unsigned, signed] of checks) if (unsigned !== undefined && unsigned !== signed) return field
  if (failure !== undefined) {
    const f = s.lastFailure
    const differs = failure === null ? f !== null
      : !f || failure.committee_version !== f.committeeVersion || (failure.blamed_operator_id ?? null) !== f.blamedOperatorId || failure.reason !== f.reason
    if (differs) return 'last_failure'
  }
  return undefined
}

/**
 * Verify one keeper's custody-health reply and return its signed statement. Refused, as a
 * `CustodyHealthError`: `unsigned` (no attestation), `malformed`, `mismatch` (another chain, slot
 * or operator, a key other than the registered one, or an unsigned field that contradicts the
 * signed statement), `bad-signature`, and `stale` (older or newer than the allowed age).
 * @param reply The parsed JSON reply.
 * @param expected What the reply must be about and the operator's registered key.
 */
export function verifyCustodyHealthReply(reply: unknown, expected: ExpectedCustodyReply): VerifiedCustodyReport {
  if (!isAddress(expected.operator, {strict: false})) throw new TasraError(`custody-health: operator ${JSON.stringify(expected.operator)} is not an address`)
  const operator = getAddress(expected.operator)
  if (typeof reply !== 'object' || reply === null || Array.isArray(reply)) throw malformed('custody-health reply is not an object', operator)
  const body = reply as Record<string, unknown>
  if (body.attestation === undefined || body.attestation === null) {
    throw new CustodyHealthError('unsigned', `custody-health reply of ${operator} carries no signed attestation; it is not counted`, {operator})
  }
  const registered = typeof expected.registeredPublicKey === 'string' ? hexToBytes(expected.registeredPublicKey) : expected.registeredPublicKey
  if (registered.length !== 32) throw new TasraError(`custody-health: the registered key of ${operator} is not 32 bytes`)
  let statement: CustodyStatement, signature: Uint8Array, claimedKey: Hex
  try {
    const att = record(body.attestation, 'attestation', ['statement', 'pubkey', 'signature'], ['statement', 'pubkey', 'signature'])
    statement = parseCustodyStatement(att.statement)
    signature = hexToBytes(hex(att.signature, 'signature', 64))
    claimedKey = hex(att.pubkey, 'pubkey', 32)
  } catch (e) {
    if (e instanceof CustodyHealthError) throw new CustodyHealthError(e.code, `${e.message} (operator ${operator})`, {operator, cause: e})
    throw e
  }
  const mismatch = (what: string) => new CustodyHealthError('mismatch', `custody-health reply of ${operator}: ${what}`, {operator})
  if (statement.chainId !== expected.chainId) throw mismatch(`statement names chain ${statement.chainId}, not ${expected.chainId}`)
  if (!same(statement.slot, expected.slotId)) throw mismatch(`statement names slot ${statement.slot}, not ${expected.slotId}`)
  if (!same(statement.operator, operator)) throw mismatch(`statement names operator ${statement.operator}`)
  if (!same(claimedKey, bytesToHex(registered))) throw mismatch('it names an identity key other than the one NodeRegistry holds for the operator')
  if (!verifyCustodyStatement(statement, registered, signature)) {
    throw new CustodyHealthError('bad-signature', `custody-health statement of ${operator} does not verify under its registered key`, {operator})
  }
  const now = expected.nowSecs ?? Math.floor(Date.now() / 1000)
  const maxAge = expected.maxAgeSecs ?? CUSTODY_STATEMENT_MAX_AGE_SECS
  if (Math.abs(now - statement.observedAt) > maxAge) {
    throw new CustodyHealthError('stale', `custody-health statement of ${operator} was made at ${statement.observedAt}, more than ${maxAge}s from ${now}`, {operator})
  }
  const field = agrees(body, statement)
  if (field) throw mismatch(`its unsigned ${field} contradicts the signed statement`)
  return {operator, statement}
}

/**
 * Whether a verified statement proves the keeper holds a share of the chain's current generation:
 * `current`, a share of the chain's key, at the chain's committee version. The rule the keepers
 * apply before retiring old shares.
 * @param s A verified statement.
 * @param chain The chain's committee version and public key.
 */
export function custodyStatementIsCurrent(s: CustodyStatement, chain: {committeeVersion: number; publicKey: Hex}): boolean {
  return s.reshare === 'current' && s.shareMatchesChainKey === true && s.shareCommitteeVersion === chain.committeeVersion
    && s.committeeVersion === chain.committeeVersion && same(s.publicKey, chain.publicKey)
}

/** How a committee fares against its threshold: the keepers' own classification. */
export type CustodyHealthLevel = 'ok' | 'at_risk' | 'frozen'

/**
 * Classify a committee by its live members: `frozen` below `k`, `ok` when all are live or more
 * than one above `k`, `at_risk` otherwise. The keepers' reshare monitor rule with a margin of one.
 * @param live Live committee members.
 * @param k Signing threshold.
 * @param n Committee size.
 */
export function assessCustodyHealth(live: number, k: number, n: number): CustodyHealthLevel {
  if (live < k) return 'frozen'
  if (live >= n) return 'ok'
  return live <= k + 1 ? 'at_risk' : 'ok'
}

/** Transport and policy for {@link readCustodyHealth}. */
export interface ReadCustodyHealthOptions {
  /** Expected chain; defaults to the chain the client's RPC answers. */
  chainId?: number
  /** Fetch used for the keeper requests; defaults to the global fetch. */
  fetchImpl?: typeof fetch
  /** Map a registered keeper URL to the address to request, for an application with mapped keeper routes. */
  route?: (url: string) => string
  /** Allow loopback HTTP on the disposable local chain 43112 only. Default false. */
  allowLocalHttp?: boolean
  /** Cancel the poll. The complete poll is bounded to 15 seconds. */
  signal?: AbortSignal
  /** Current Unix seconds for the freshness check; defaults to the local clock. */
  nowSecs?: number
  /** Maximum statement age in seconds; defaults to {@link CUSTODY_STATEMENT_MAX_AGE_SECS}. */
  maxAgeSecs?: number
}

/** A slot's custody health: chain state read by the SDK, and the keepers' verified statements. */
export interface CustodyHealthReport {
  /** Slot that was polled. */
  slotId: Hex
  /** Chain the statements were checked against. */
  chainId: number
  /** The slot as the chain records it. */
  chain: {
    /** `KeyRegistry.Mode` ordinal. */
    mode: number
    /** Anchored public key; `0x` before a key exists. */
    publicKey: Hex
    /** Key epoch. */
    epoch: number
    /** Committee version; a reshare raises it. */
    committeeVersion: number
    /** Signing threshold. */
    k: number
    /** Committee size. */
    n: number
    /** Whether the slot is cancelled. */
    cancelled: boolean
    /** Whether no rotation can change the key; `null` on a KeyRegistry without the lock. */
    rotationLocked: boolean | null
  }
  /** The committee's liveness, from NodeRegistry: a live member is an active, keeper-tagged operator. */
  committee: {
    /** Assigned members. */
    members: number
    /** Members that are live keepers. */
    liveMembers: number
    /** `liveMembers - k`: further losses the slot survives; negative means it cannot sign. */
    margin: number
    /** Members that are not live keepers, the ones a reshare should replace. */
    notLive: Address[]
  }
  /** Classification from `liveMembers`, `k` and `n`. */
  health: CustodyHealthLevel
  /** Members whose verified statement proves a share of the chain's current generation. */
  current: Address[]
  /** Whether at least `k` members proved it, so the current generation can sign without any older one. */
  proven: boolean
  /** Members whose verified statement reports a reshare they have not finished. */
  pending: Address[]
  /** Every verified statement, one per member that answered. */
  reports: VerifiedCustodyReport[]
  /** Members whose reply was refused or not received; none of these is counted. */
  refused: {operator: Address; error: CustodyHealthError}[]
}

async function readBounded(response: Response, signal: AbortSignal): Promise<string> {
  if (Number(response.headers.get('content-length')) > MAX_REPLY_BYTES) {
    void response.body?.cancel().catch(() => {})
    throw new Error(`reply exceeds ${MAX_REPLY_BYTES} bytes`)
  }
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, {once: true})
  try {
    for (;;) {
      const {done, value} = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_REPLY_BYTES) { cancel(); throw new Error(`reply exceeds ${MAX_REPLY_BYTES} bytes`) }
      chunks.push(value)
    }
  } finally {
    signal.removeEventListener('abort', cancel)
  }
  return new TextDecoder('utf-8', {fatal: true}).decode(concatBytes(...chunks))
}

function endpoint(url: string, chainId: number, allowLocalHttp: boolean): string {
  const u = new URL(url)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  if (u.username || u.password || u.search || u.hash || (u.protocol !== 'https:' && !(u.protocol === 'http:' && allowLocalHttp && chainId === 43112 && local))) {
    throw new Error('keeper endpoint violates the transport policy (HTTPS only; loopback HTTP only on chain 43112 when allowed)')
  }
  return u.toString().replace(/\/$/, '')
}

/**
 * Poll every assigned keeper of a slot for its custody health and verify each reply against the
 * operator's registered identity key. The committee's liveness, margin, health and rotation lock
 * come from the SDK's own chain reads; the keepers contribute only their signed statements.
 * A keeper whose reply is refused is listed in `refused` and never counted. Refuses `no-slot`.
 * @param chain Reader for the deployment that owns the slot.
 * @param slotId Slot to poll.
 * @param options Expected chain, transport, cancellation and freshness policy.
 */
export async function readCustodyHealth(chain: TasraChainClient, slotId: Hex, options: ReadCustodyHealthOptions = {}): Promise<CustodyHealthReport> {
  const read = chain.client.readContract
  const keyRegistry = requireAddress(chain.addresses, 'KeyRegistry'), nodeRegistry = requireAddress(chain.addresses, 'NodeRegistry')
  const chainId = options.chainId ?? await chainIdOf(chain.client)
  const fetchImpl = options.fetchImpl ?? fetch
  const slot = await read({address: keyRegistry, abi: keyRegistryAbi, functionName: 'getKeySlot', args: [slotId]})
  if (!slot.exists) throw new CustodyHealthError('no-slot', `slot ${slotId} does not exist on this KeyRegistry; check the slot id and the network`)
  const mode = Number(slot.mode)
  let rotationLocked: boolean | null
  try {
    const last = await read({address: keyRegistry, abi: keyRegistryAbi, functionName: 'lastRotatedAt', args: [slotId]})
    rotationLocked = last === ROTATION_LOCK_SENTINEL || mode === 2 || mode === 4
  } catch (e) {
    if (!viemErrorChainHas(e, ['ContractFunctionRevertedError', 'ContractFunctionZeroDataError'])) throw e
    rotationLocked = null
  }
  const assigned = await read({address: keyRegistry, abi: keyRegistryAbi, functionName: 'assignedNodes', args: [slotId]})
  const k = Number(slot.threshold.k), n = Number(slot.threshold.n)
  const chainView = {mode, publicKey: slot.publicKey.toLowerCase() as Hex, epoch: Number(slot.epoch), committeeVersion: Number(slot.committeeVersion),
    k, n, cancelled: slot.cancelled, rotationLocked}

  type Outcome = {operator: Address; live: boolean; report?: VerifiedCustodyReport; error?: CustodyHealthError}
  const outcomes = await withNetworkDeadline(signal => resolveKeeperMembers(assigned, async (member): Promise<Outcome> => {
    const operator = getAddress(member)
    const [node, tagged] = await Promise.all([
      read({address: nodeRegistry, abi: nodeRegistryAbi, functionName: 'nodeOf', args: [operator]}),
      read({address: nodeRegistry, abi: nodeRegistryAbi, functionName: 'hasTag', args: [operator, KEEPER_TAG]}),
    ])
    const live = node.active && tagged
    if (!node.active || !/^0x[0-9a-fA-F]{64}$/.test(node.pubkey)) {
      return {operator, live, error: new CustodyHealthError('not-registered', `${operator} is not an active registered operator; its reply would not be counted`, {operator})}
    }
    let body: unknown
    try {
      const base = endpoint(options.route ? options.route(node.url) : node.url, chainId, options.allowLocalHttp === true)
      const response = await fetchImpl(`${base}/v1/keys/${slotId}/custody-health`, {signal, redirect: 'error', credentials: 'omit'})
      const text = await readBounded(response, signal)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      body = JSON.parse(text)
    } catch (e) {
      signal.throwIfAborted()
      return {operator, live, error: new CustodyHealthError('unreachable', `custody-health of ${operator} could not be read: ${e instanceof Error ? e.message : String(e)}`, {operator, cause: e})}
    }
    try {
      return {operator, live, report: verifyCustodyHealthReply(body, {chainId, slotId, operator, registeredPublicKey: node.pubkey,
        nowSecs: options.nowSecs, maxAgeSecs: options.maxAgeSecs})}
    } catch (e) {
      if (!(e instanceof CustodyHealthError)) throw e
      return {operator, live, error: e}
    }
  }, signal), options.signal)

  const liveMembers = outcomes.filter(o => o.live).length
  const reports = outcomes.flatMap(o => o.report ? [o.report] : [])
  const current = reports.filter(r => custodyStatementIsCurrent(r.statement, chainView)).map(r => r.operator)
  return {
    slotId, chainId, chain: chainView,
    committee: {members: assigned.length, liveMembers, margin: liveMembers - k, notLive: outcomes.filter(o => !o.live).map(o => o.operator)},
    health: assessCustodyHealth(liveMembers, k, n),
    current, proven: current.length >= k,
    pending: reports.filter(r => r.statement.reshare === 'pending').map(r => r.operator),
    reports,
    refused: outcomes.flatMap(o => o.error ? [{operator: o.operator, error: o.error}] : []),
  }
}
