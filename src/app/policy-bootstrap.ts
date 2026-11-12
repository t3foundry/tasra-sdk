// Customer authorization bootstrap: a holder application runs paid operations on a slot whose rule
// salt it never holds.
//
// The slot's creator (the party that holds the rule and its salt) signs a short-lived EIP-712
// statement that binds the exact raw rule (by keccak256, the hash verifier tokens carry) to the
// slot's on-chain salted commitment and rule version, on one chain and KeyRegistry, for one holder
// application and a bounded set of actions. The holder receives that statement and the raw rule,
// never the salt. Before anything is signed or spent, paidOperation checks the statement's
// signature against the slot creator it reads on chain, and its commitment and rule version
// against the same canonical slot read; afterwards the verifier quorum's token binds the same rule
// hash. A monotonic per-slot sequence refuses an older statement once a newer one was accepted.
//
// paidPolicyOperation adds an application-chosen operation key: the operation is bound to that key
// in the durable store before any reservation, and calling it again with the same key resumes the
// original journal entry instead of starting a second operation.

import {concat, hashTypedData, isAddress, keccak256, recoverTypedDataAddress, toHex, type Address, type Hex, type LocalAccount, type TypedDataDefinition} from 'viem'
import {keyRegistryAbi} from '../chain/abis/keyRegistry.js'
import type {TasraChainClient} from '../chain/client.js'
import {requireAddress} from '../chain/deployments.js'
import {ruleCommitment} from '../chain/write.js'
import {canonicalize, MAX_RULE_LEN} from '../auth/oid4vp.js'
import type {CommitteeAction} from '../oid4vp/binding.js'
import {presentationOperationTypedData} from '../oid4vp/verifier-agent.js'
import {TasraError} from '../errors.js'
import type {ApplicationStore} from './ready-slot.js'
import {storeIdentity} from './store-commit.js'

/** EIP-712 domain name of a slot policy statement (version `1`, the KeyRegistry as verifying contract). */
export const SLOT_POLICY_DOMAIN_NAME = 'Tasra Slot Policy'
/** EIP-712 domain name of a holder application's policy retrieval request. */
export const SLOT_POLICY_REQUEST_DOMAIN_NAME = 'Tasra Slot Policy Request'
/** Longest lifetime of one slot policy statement, in seconds (one day). */
export const SLOT_POLICY_MAX_LIFETIME_SECS = 86_400
/** Longest age of a policy retrieval request, in seconds. */
export const SLOT_POLICY_REQUEST_MAX_AGE_SECS = 120
const SKEW_SECS = 60
const HEX32 = /^0x[0-9a-fA-F]{64}$/
const SIGNATURE = /^0x[0-9a-fA-F]{130}$/
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const ACTION_BITS: Record<CommitteeAction, number> = {'sign': 1, 'decrypt': 2, 'ibe-extract': 4, 'dual-approve': 8}
const ACTIONS = Object.keys(ACTION_BITS) as CommitteeAction[]

const POLICY_TYPES = {
  SlotPolicy: [
    {name: 'slotId', type: 'bytes32'},
    {name: 'ruleVersion', type: 'uint64'},
    {name: 'ruleCommitment', type: 'bytes32'},
    {name: 'ruleHash', type: 'bytes32'},
    {name: 'audience', type: 'address'},
    {name: 'actions', type: 'uint8'},
    {name: 'sequence', type: 'uint64'},
    {name: 'issuedAt', type: 'uint64'},
    {name: 'expiresAt', type: 'uint64'},
    {name: 'bootstrapId', type: 'bytes32'},
  ],
} as const

const REQUEST_TYPES = {
  SlotPolicyRequest: [
    {name: 'slotId', type: 'bytes32'},
    {name: 'audience', type: 'address'},
    {name: 'nonce', type: 'bytes32'},
    {name: 'issuedAt', type: 'uint64'},
  ],
} as const

/**
 * Stable refusal categories of the policy bootstrap; branch on `code`, never on the message.
 * None is retryable with the same input.
 */
export type SlotPolicyErrorCode =
  /** The statement, rule or signature is not well formed. */
  | 'malformed'
  /** The statement names another chain or KeyRegistry. */
  | 'wrong-deployment'
  /** The statement names another slot. */
  | 'wrong-slot'
  /** The statement was issued to another holder application. */
  | 'wrong-audience'
  /** The requested action is not in the statement's scope. */
  | 'out-of-scope'
  /** The statement expired, is not valid yet or claims a lifetime over the maximum. */
  | 'stale'
  /** The supplied rule is not the rule the statement hashes. */
  | 'substituted-rule'
  /** The statement is not signed by the expected slot creator. */
  | 'wrong-signer'
  /** The slot's on-chain commitment, rule version or creator differs from the statement. */
  | 'changed-policy'
  /** A newer statement for this slot and holder application was already accepted. */
  | 'replayed'
  /** Another statement with the same sequence was already accepted. */
  | 'equivocated'
  /** The issuer is not the slot's creator, the slot is not live, or the rule and salt do not reproduce its commitment. */
  | 'not-issuable'

/** A slot policy statement or retrieval request refused before anything was signed or spent. */
export class SlotPolicyError extends TasraError {
  /** Refusal category; never infer it from the message. */
  readonly code: SlotPolicyErrorCode
  constructor(code: SlotPolicyErrorCode, message: string, opts: {cause?: unknown} = {}) {
    super(message, {cause: opts.cause})
    this.code = code
  }
}

/** The public policy of one slot as its creator attests it to one holder application. Contains no salt. */
export interface SlotPolicyStatement {
  /** Chain the slot lives on. */
  chainId: number
  /** KeyRegistry that holds the slot. */
  keyRegistry: Address
  /** Slot the statement describes. */
  slot: Hex
  /** On-chain rule version the rule belongs to. */
  ruleVersion: number
  /** On-chain salted rule commitment the rule belongs to. */
  ruleCommitment: Hex
  /** keccak256 of the exact raw rule bytes, the hash verifier tokens bind. */
  ruleHash: Hex
  /** Holder application key the statement was issued to. */
  audience: Address
  /** Committee actions the holder application may run with this statement. */
  actions: CommitteeAction[]
  /** Monotonic issue counter per slot and holder application; a lower one is refused once a higher one was accepted. */
  sequence: number
  /** Unix seconds of issue. */
  issuedAt: number
  /** Unix seconds after which the statement no longer starts an operation. */
  expiresAt: number
  /** Random identifier of this issue. */
  bootstrapId: Hex
}

/** A creator-signed slot policy statement and the exact raw rule it hashes. Never carries the rule salt. */
export interface SlotPolicyBootstrap {
  /** The signed statement. */
  statement: SlotPolicyStatement
  /** The exact raw rule bytes the statement's `ruleHash` covers, as provisioned. */
  rule: string
  /** The slot creator's 65-byte EIP-712 signature over the statement. */
  signature: Hex
}

/** A holder application's signed request for a slot policy statement. Not a holder credential. */
export interface SlotPolicyRequest {
  /** Chain the slot lives on. */
  chainId: number
  /** KeyRegistry that holds the slot. */
  keyRegistry: Address
  /** Slot whose policy is requested. */
  slot: Hex
  /** Holder application key that signs the request and receives the statement. */
  audience: Address
  /** Random request nonce; the issuer refuses a nonce it has already answered. */
  nonce: Hex
  /** Unix seconds of the request. */
  issuedAt: number
  /** The holder application's 65-byte EIP-712 signature over the request. */
  signature: Hex
}

const lower = (value: string) => value.toLowerCase()
const same = (a: string, b: string) => lower(a) === lower(b)
const now = () => Math.floor(Date.now() / 1000)
const uint = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max
const address = (value: unknown): value is Address => typeof value === 'string' && isAddress(value, {strict: false}) && !same(value, ZERO_ADDRESS)
const hex32 = (value: unknown): value is Hex => typeof value === 'string' && HEX32.test(value)
const random32 = (): Hex => { const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32)); const value = toHex(bytes); bytes.fill(0); return value }

function onlyKeys(value: object, allowed: readonly string[], what: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new SlotPolicyError('malformed', `${what} has an unknown field ${key}`)
}

function actionBits(actions: readonly CommitteeAction[]): number {
  if (!Array.isArray(actions) || actions.length === 0 || actions.length > ACTIONS.length || new Set(actions).size !== actions.length) {
    throw new SlotPolicyError('malformed', 'Policy actions must be a non-empty list of distinct committee actions')
  }
  let bits = 0
  for (const action of actions as readonly CommitteeAction[]) {
    if (!ACTIONS.includes(action)) throw new SlotPolicyError('malformed', `Unknown committee action ${String(action)}`)
    bits |= ACTION_BITS[action]
  }
  return bits
}

/** Validate an untrusted statement's shape and bounds; returns a normalized copy. */
function statementShape(value: unknown): SlotPolicyStatement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SlotPolicyError('malformed', 'Policy statement must be an object')
  const s = value as Record<string, unknown>
  onlyKeys(s, ['chainId', 'keyRegistry', 'slot', 'ruleVersion', 'ruleCommitment', 'ruleHash', 'audience', 'actions', 'sequence', 'issuedAt', 'expiresAt', 'bootstrapId'], 'Policy statement')
  if (!uint(s.chainId) || s.chainId === 0 || !address(s.keyRegistry) || !hex32(s.slot) || !uint(s.ruleVersion) || !hex32(s.ruleCommitment) || !hex32(s.ruleHash)
    || !address(s.audience) || !uint(s.sequence) || !uint(s.issuedAt) || !uint(s.expiresAt) || !hex32(s.bootstrapId) || !Array.isArray(s.actions)) {
    throw new SlotPolicyError('malformed', 'Policy statement has a missing or invalid field')
  }
  actionBits(s.actions as CommitteeAction[])
  return {chainId: s.chainId, keyRegistry: s.keyRegistry, slot: lower(s.slot) as Hex, ruleVersion: s.ruleVersion, ruleCommitment: lower(s.ruleCommitment) as Hex,
    ruleHash: lower(s.ruleHash) as Hex, audience: s.audience, actions: [...s.actions as CommitteeAction[]], sequence: s.sequence, issuedAt: s.issuedAt,
    expiresAt: s.expiresAt, bootstrapId: lower(s.bootstrapId) as Hex}
}

/** Validate an untrusted bootstrap's shape and bounds; returns a normalized copy. */
function bootstrapShape(value: unknown): SlotPolicyBootstrap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SlotPolicyError('malformed', 'Policy bootstrap must be an object')
  const b = value as Record<string, unknown>
  onlyKeys(b, ['statement', 'rule', 'signature'], 'Policy bootstrap')
  if (typeof b.rule !== 'string' || b.rule.length === 0 || new TextEncoder().encode(b.rule).length > MAX_RULE_LEN) {
    throw new SlotPolicyError('malformed', `Policy rule must be 1..${MAX_RULE_LEN} bytes`)
  }
  if (typeof b.signature !== 'string' || !SIGNATURE.test(b.signature)) throw new SlotPolicyError('malformed', 'Policy signature must be 65 bytes')
  return {statement: statementShape(b.statement), rule: b.rule, signature: b.signature as Hex}
}

/**
 * The EIP-712 typed data a slot creator signs for a slot policy statement.
 * @param statement Statement to sign or verify.
 */
export function slotPolicyTypedData(statement: SlotPolicyStatement): TypedDataDefinition<typeof POLICY_TYPES, 'SlotPolicy'> {
  const s = statementShape(statement)
  return {domain: {name: SLOT_POLICY_DOMAIN_NAME, version: '1', chainId: s.chainId, verifyingContract: s.keyRegistry}, types: POLICY_TYPES, primaryType: 'SlotPolicy',
    message: {slotId: s.slot, ruleVersion: BigInt(s.ruleVersion), ruleCommitment: s.ruleCommitment, ruleHash: s.ruleHash, audience: s.audience,
      actions: actionBits(s.actions), sequence: BigInt(s.sequence), issuedAt: BigInt(s.issuedAt), expiresAt: BigInt(s.expiresAt), bootstrapId: s.bootstrapId}}
}

/**
 * The EIP-712 hash of a slot policy statement, the identity the holder's store records.
 * @param statement Statement to hash.
 */
export function slotPolicyHash(statement: SlotPolicyStatement): Hex {
  return hashTypedData(slotPolicyTypedData(statement))
}

/** What a holder application expects of a slot policy statement. */
export interface SlotPolicyExpectation {
  /** Chain of the approved deployment. */
  chainId: number
  /** KeyRegistry of the approved deployment. */
  keyRegistry: Address
  /** Slot the operation targets. */
  slot: Hex
  /** This holder application's key. */
  audience: Address
  /** Action the operation runs; it must be in the statement's scope. */
  action?: CommitteeAction
  /** Expected signer (the slot creator); the recovered signer is returned either way. */
  signer?: Address
  /** Current Unix seconds (default: the system clock). */
  nowSecs?: number
}

/**
 * Check a slot policy bootstrap offline: shape and bounds, deployment, slot, holder application,
 * action scope, lifetime, that the rule is the one the statement hashes, and the creator's
 * signature. The on-chain half (current creator, commitment and rule version at one canonical
 * block) is checked by paidOperation, which needs the chain anyway. Throws {@link SlotPolicyError}.
 * @param bootstrap Untrusted bootstrap as received.
 * @param expected Deployment, slot, holder application, action and signer to expect.
 * @returns The normalized bootstrap and the address that signed it.
 */
export async function verifySlotPolicyBootstrap(bootstrap: SlotPolicyBootstrap, expected: SlotPolicyExpectation): Promise<{bootstrap: SlotPolicyBootstrap; signer: Address}> {
  const b = bootstrapShape(bootstrap), s = b.statement, at = expected.nowSecs ?? now()
  if (s.chainId !== expected.chainId || !same(s.keyRegistry, expected.keyRegistry)) throw new SlotPolicyError('wrong-deployment', `Policy statement names chain ${s.chainId} registry ${s.keyRegistry}, not the approved deployment`)
  if (!same(s.slot, expected.slot)) throw new SlotPolicyError('wrong-slot', `Policy statement describes slot ${s.slot}, not ${expected.slot}`)
  if (!same(s.audience, expected.audience)) throw new SlotPolicyError('wrong-audience', `Policy statement was issued to ${s.audience}, not this application ${expected.audience}`)
  if (expected.action !== undefined && !s.actions.includes(expected.action)) throw new SlotPolicyError('out-of-scope', `Policy statement does not allow ${expected.action}`)
  if (s.expiresAt <= s.issuedAt || s.expiresAt - s.issuedAt > SLOT_POLICY_MAX_LIFETIME_SECS) throw new SlotPolicyError('stale', `Policy statement lifetime must be 1..${SLOT_POLICY_MAX_LIFETIME_SECS} seconds`)
  if (s.issuedAt > at + SKEW_SECS) throw new SlotPolicyError('stale', 'Policy statement is not valid yet')
  if (s.expiresAt <= at) throw new SlotPolicyError('stale', 'Policy statement expired')
  if (keccak256(toHex(b.rule)).toLowerCase() !== s.ruleHash) throw new SlotPolicyError('substituted-rule', 'Supplied rule is not the rule the policy statement hashes')
  let signer: Address
  try { signer = await recoverTypedDataAddress({...slotPolicyTypedData(s), signature: b.signature}) } catch (cause) { throw new SlotPolicyError('malformed', 'Policy signature does not recover', {cause}) }
  if (expected.signer !== undefined && !same(signer, expected.signer)) throw new SlotPolicyError('wrong-signer', `Policy statement is signed by ${signer}, not the slot creator ${expected.signer}`)
  return {bootstrap: b, signer}
}

/** The on-chain slot fields a statement must match at one canonical block. */
export interface ObservedSlotPolicy {
  /** On-chain slot creator. */
  creator: Address
  /** On-chain salted rule commitment. */
  ruleCommitment: Hex
  /** On-chain rule version. */
  ruleVersion: number
}

/**
 * Compare a verified statement with the slot read on chain at one canonical block; throws `changed-policy`.
 * @param statement Verified statement.
 * @param signer Address that signed it.
 * @param observed Creator, commitment and rule version as read.
 */
export function requireCurrentSlotPolicy(statement: SlotPolicyStatement, signer: Address, observed: ObservedSlotPolicy): void {
  if (!same(observed.creator, signer)) throw new SlotPolicyError('changed-policy', `Slot creator is ${observed.creator}; the policy statement is signed by ${signer}`)
  if (!same(observed.ruleCommitment, statement.ruleCommitment)) throw new SlotPolicyError('changed-policy', 'Slot rule commitment differs from the policy statement')
  if (observed.ruleVersion !== statement.ruleVersion) throw new SlotPolicyError('changed-policy', `Slot rule version is ${observed.ruleVersion}; the policy statement names ${statement.ruleVersion}`)
}

/** Store key of the highest accepted statement per deployment, slot and holder application. */
function sequenceKey(s: SlotPolicyStatement): string {
  return 'paid-policy-seq-' + keccak256(concat([toHex('tasra/slot-policy-sequence/v1'), toHex(BigInt(s.chainId), {size: 8}), s.keyRegistry, s.slot, s.audience])).slice(2)
}
interface SequenceRecord { schema: 1; sequence: number; hash: Hex }

/**
 * Accept a verified statement against the holder's durable high-water mark: a lower sequence than
 * one already accepted is `replayed`, the same sequence with another statement `equivocated`.
 * Records a higher one. Needs the private store the operation journals in.
 */
export async function admitSlotPolicySequence(store: ApplicationStore, statement: SlotPolicyStatement): Promise<void> {
  const key = sequenceKey(statement), hash = slotPolicyHash(statement).toLowerCase() as Hex
  await store.withLock(key, async () => {
    const seen = await store.load<SequenceRecord>(key)
    if (seen !== undefined) {
      if (!seen || seen.schema !== 1 || !uint(seen.sequence) || !hex32(seen.hash)) throw new TasraError('Invalid slot policy sequence record')
      if (statement.sequence < seen.sequence) throw new SlotPolicyError('replayed', `Policy statement sequence ${statement.sequence} is older than the accepted ${seen.sequence}`)
      if (statement.sequence === seen.sequence) {
        if (seen.hash !== hash) throw new SlotPolicyError('equivocated', `Another policy statement with sequence ${statement.sequence} was already accepted`)
        return
      }
    }
    await store.save(key, {schema: 1, sequence: statement.sequence, hash} satisfies SequenceRecord)
  })
}

/** What the slot creator attests in one policy statement. */
export interface IssueSlotPolicyInput {
  /** The slot creator's signer (a local account or a remote EIP-712 signer). */
  signer: Pick<LocalAccount, 'address' | 'signTypedData'>
  /** Slot to describe. */
  slot: Hex
  /** Exact raw rule bytes as provisioned. */
  rule: string
  /** The rule salt; used only to check the commitment and never placed in the statement. */
  salt: Hex
  /** Holder application key the statement is issued to. */
  audience: Address
  /** Committee actions the holder application may run. */
  actions: CommitteeAction[]
  /** Monotonic issue counter per slot and holder application (issue a higher one to supersede). */
  sequence: number
  /** Lifetime in seconds, 1..86400 (default 900). */
  ttlSecs?: number
  /** Current Unix seconds (default: the system clock). */
  nowSecs?: number
}

/**
 * Issue a slot policy bootstrap as the slot creator. Reads the slot at the latest block and refuses
 * (`not-issuable`) unless it is live, the signer is its creator and the rule and salt reproduce its
 * commitment; then signs a statement that carries the rule hash, commitment and rule version but
 * not the salt. Hand the result to the holder application named as `audience`.
 * @param chain Reader for the deployment that owns the slot.
 * @param input Creator signer, slot, rule, salt, holder application, scope, sequence and lifetime.
 */
export async function issueSlotPolicyBootstrap(chain: TasraChainClient, input: IssueSlotPolicyInput): Promise<SlotPolicyBootstrap> {
  const keyRegistry = requireAddress(chain.addresses, 'KeyRegistry')
  if (!hex32(input.slot) || !hex32(input.salt)) throw new SlotPolicyError('malformed', 'Slot and salt must be 32 bytes')
  if (!address(input.audience)) throw new SlotPolicyError('malformed', 'Audience must be a non-zero address')
  if (!uint(input.sequence)) throw new SlotPolicyError('malformed', 'Sequence must be a non-negative safe integer')
  const ttl = input.ttlSecs ?? 900
  if (!uint(ttl, SLOT_POLICY_MAX_LIFETIME_SECS) || ttl === 0) throw new SlotPolicyError('malformed', `Policy lifetime must be 1..${SLOT_POLICY_MAX_LIFETIME_SECS} seconds`)
  if (typeof input.rule !== 'string' || input.rule.length === 0 || new TextEncoder().encode(input.rule).length > MAX_RULE_LEN) throw new SlotPolicyError('malformed', `Policy rule must be 1..${MAX_RULE_LEN} bytes`)
  canonicalize(input.rule)
  actionBits(input.actions)
  const [chainId, slot] = await Promise.all([chain.client.getChainId(),
    chain.client.readContract({address: keyRegistry, abi: keyRegistryAbi, functionName: 'getKeySlot', args: [input.slot]})])
  if (!slot.exists || slot.cancelled) throw new SlotPolicyError('not-issuable', `Slot ${input.slot} is not live`)
  if (!same(slot.creator, input.signer.address)) throw new SlotPolicyError('not-issuable', `Slot ${input.slot} has creator ${slot.creator}, not ${input.signer.address}`)
  if (!same(slot.ruleCommitment, ruleCommitment(input.salt, input.rule))) throw new SlotPolicyError('not-issuable', 'Rule and salt do not reproduce the slot commitment')
  const issuedAt = input.nowSecs ?? now()
  const statement: SlotPolicyStatement = {chainId, keyRegistry, slot: lower(input.slot) as Hex, ruleVersion: Number(slot.ruleVersion), ruleCommitment: lower(slot.ruleCommitment) as Hex,
    ruleHash: keccak256(toHex(input.rule)), audience: input.audience, actions: [...input.actions], sequence: input.sequence, issuedAt, expiresAt: issuedAt + ttl, bootstrapId: random32()}
  const signature = await input.signer.signTypedData(slotPolicyTypedData(statement))
  return {statement, rule: input.rule, signature}
}

/**
 * The EIP-712 typed data a holder application signs to request a slot policy statement.
 * @param request Request fields (signature excluded).
 */
export function slotPolicyRequestTypedData(request: Omit<SlotPolicyRequest, 'signature'>): TypedDataDefinition<typeof REQUEST_TYPES, 'SlotPolicyRequest'> {
  if (!uint(request.chainId) || request.chainId === 0 || !address(request.keyRegistry) || !hex32(request.slot) || !address(request.audience) || !hex32(request.nonce) || !uint(request.issuedAt)) {
    throw new SlotPolicyError('malformed', 'Policy request has a missing or invalid field')
  }
  return {domain: {name: SLOT_POLICY_REQUEST_DOMAIN_NAME, version: '1', chainId: request.chainId, verifyingContract: request.keyRegistry}, types: REQUEST_TYPES,
    primaryType: 'SlotPolicyRequest', message: {slotId: request.slot, audience: request.audience, nonce: request.nonce, issuedAt: BigInt(request.issuedAt)}}
}

/**
 * Sign a request for a slot policy statement with the holder application's key. The key identifies
 * the application to the issuer; it is neither a holder credential nor a control-plane key.
 * @param signer Holder application key.
 * @param request Chain, KeyRegistry and slot; nonce and time default to fresh values.
 */
export async function createSlotPolicyRequest(signer: Pick<LocalAccount, 'address' | 'signTypedData'>,
  request: {chainId: number; keyRegistry: Address; slot: Hex; nonce?: Hex; nowSecs?: number}): Promise<SlotPolicyRequest> {
  const fields = {chainId: request.chainId, keyRegistry: request.keyRegistry, slot: request.slot, audience: signer.address, nonce: request.nonce ?? random32(), issuedAt: request.nowSecs ?? now()}
  return {...fields, signature: await signer.signTypedData(slotPolicyRequestTypedData(fields))}
}

/**
 * Check a holder application's policy request on the issuer side: shape, deployment, age and that
 * its `audience` signed it. The issuer then checks that the audience is an enrolled application
 * for this slot and that the nonce is new. Throws {@link SlotPolicyError}.
 * @param request Untrusted request as received.
 * @param expected Deployment of the issuer, current time and accepted age.
 * @returns The normalized request.
 */
export async function verifySlotPolicyRequest(request: SlotPolicyRequest,
  expected: {chainId: number; keyRegistry: Address; nowSecs?: number; maxAgeSecs?: number}): Promise<SlotPolicyRequest> {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new SlotPolicyError('malformed', 'Policy request must be an object')
  onlyKeys(request, ['chainId', 'keyRegistry', 'slot', 'audience', 'nonce', 'issuedAt', 'signature'], 'Policy request')
  if (typeof request.signature !== 'string' || !SIGNATURE.test(request.signature)) throw new SlotPolicyError('malformed', 'Policy request signature must be 65 bytes')
  const {signature, ...fields} = request
  const typed = slotPolicyRequestTypedData(fields)
  if (fields.chainId !== expected.chainId || !same(fields.keyRegistry, expected.keyRegistry)) throw new SlotPolicyError('wrong-deployment', 'Policy request names another deployment')
  const at = expected.nowSecs ?? now(), maxAge = expected.maxAgeSecs ?? SLOT_POLICY_REQUEST_MAX_AGE_SECS
  if (!uint(maxAge, 3600) || maxAge === 0) throw new SlotPolicyError('malformed', 'Policy request age limit must be 1..3600 seconds')
  if (fields.issuedAt > at + SKEW_SECS || fields.issuedAt + maxAge < at) throw new SlotPolicyError('stale', 'Policy request is too old or not valid yet')
  let signer: Address
  try { signer = await recoverTypedDataAddress({...typed, signature}) } catch (cause) { throw new SlotPolicyError('malformed', 'Policy request signature does not recover', {cause}) }
  if (!same(signer, fields.audience)) throw new SlotPolicyError('wrong-signer', 'Policy request is not signed by its audience')
  return {...fields, slot: lower(fields.slot) as Hex, nonce: lower(fields.nonce) as Hex, signature}
}

// ---- operation binding: one application operation key, one journaled operation ----

/** Stable refusal categories of {@link paidPolicyOperation}; nothing was reserved by the refused call. */
export type PolicyOperationErrorCode =
  /** The key is bound to a different operation. */
  | 'key-reused'
  /** Another call with this key is running in this process. */
  | 'in-flight'
  /** The original never reached its journal; pass `restartUnjournaled` to start it again once that is safe. */
  | 'unjournaled'
  /** The original is closed (provably unreserved or abandoned); use a new operation key. */
  | 'closed'
  /** A later call with this key took over before this one derived its request; this call spent nothing. */
  | 'superseded'

/** A {@link paidPolicyOperation} refused without starting a second operation. */
export class PolicyOperationError extends TasraError {
  /** Refusal category; never infer it from the message. */
  readonly code: PolicyOperationErrorCode
  /** The original operation's request ID, when one is known. */
  readonly requestId?: Hex
  constructor(code: PolicyOperationErrorCode, message: string, opts: {requestId?: Hex; retryable?: boolean} = {}) {
    super(message, {retryable: opts.retryable ?? false})
    this.code = code
    if (opts.requestId !== undefined) this.requestId = opts.requestId
  }
}

const OPERATION_KEY = /^[A-Za-z0-9._:-]{1,128}$/
const MAX_ATTEMPTS = 16

/** The durable binding of one application operation key. */
export interface PolicyOperationBinding {
  /** Record format. */
  schema: 1
  /** Hash of the operation the key is bound to. */
  fingerprint: Hex
  /** Hash of the policy statement the first call started with. */
  policy: Hex
  /** Incremented by every (re)start; only the current generation may record a request. */
  generation: number
  /** Unix seconds the key was first bound. */
  createdAt: number
  /** Requests derived for this key, oldest first; the last one is the operation. */
  attempts: {generation: number; requestId: Hex; notAfter: number}[]
}

/** Store key of one operation key's binding. */
export function policyOperationKey(statement: Pick<SlotPolicyStatement, 'chainId' | 'keyRegistry' | 'slot' | 'audience'>, operationKey: string): string {
  if (typeof operationKey !== 'string' || !OPERATION_KEY.test(operationKey)) throw new TasraError('Operation key must be 1..128 characters of A-Z a-z 0-9 . _ : -')
  return 'paid-policy-op-' + keccak256(concat([toHex('tasra/policy-operation/v1'), toHex(BigInt(statement.chainId), {size: 8}), statement.keyRegistry, statement.slot,
    statement.audience, toHex(operationKey)])).slice(2)
}

/** The operation identity a key binds: deployment, slot, action, exact payload digest, holder family and session mode. */
export function policyOperationFingerprint(input: {chainId: number; keyRegistry: Address; slot: Hex; holderKind: string; sessionGrant: boolean;
  operation: {action: CommitteeAction; message?: Uint8Array; identity?: string; payloadDigest?: Uint8Array; decryption?: Parameters<typeof presentationOperationTypedData>[0]['decryption']}}): Hex {
  const built = presentationOperationTypedData({...input.operation, chainId: input.chainId, keyRegistry: input.keyRegistry, slotId: input.slot, description: '', nowSecs: 0, ttlSecs: 1})
  return keccak256(toHex(JSON.stringify({chainId: input.chainId, keyRegistry: lower(input.keyRegistry), slot: lower(input.slot), action: input.operation.action,
    payloadDigest: toHex(built.payloadDigest), holder: input.holderKind === 'oauth' ? 'oauth' : 'wallet', sessionGrant: input.sessionGrant})))
}

/** Whether a stored value is a well-formed operation key binding. */
export function validBinding(value: unknown): value is PolicyOperationBinding {
  const b = value as PolicyOperationBinding
  return !!b && b.schema === 1 && hex32(b.fingerprint) && hex32(b.policy) && uint(b.generation) && b.generation >= 1 && uint(b.createdAt) && Array.isArray(b.attempts)
    && b.attempts.length <= MAX_ATTEMPTS && b.attempts.every(a => uint(a?.generation) && hex32(a?.requestId) && uint(a?.notAfter))
}

/** In-process calls per store identity and binding key. */
const running = new Map<string | ApplicationStore, Set<string>>()

/** Mark one binding key running in this process for the duration of `work`; refuses a second. */
export async function exclusivelyRunning<T>(store: ApplicationStore, key: string, work: () => Promise<T>): Promise<T> {
  const id = storeIdentity(store)
  let keys = running.get(id)
  if (!keys) { keys = new Set(); running.set(id, keys) }
  if (keys.has(key)) throw new PolicyOperationError('in-flight', 'Another call with this operation key is running in this process', {retryable: true})
  keys.add(key)
  try { return await work() } finally { keys.delete(key); if (keys.size === 0) running.delete(id) }
}

export {MAX_ATTEMPTS as POLICY_OPERATION_MAX_ATTEMPTS, SKEW_SECS as POLICY_SKEW_SECS}
