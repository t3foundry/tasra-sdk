import {encodeAbiParameters, keccak256, toHex, type Hex, type TypedDataDefinition} from 'viem'
import {typedDataHash as hashTypedData} from '../internal/typedData.js'
import {keccak_256} from '@noble/hashes/sha3'
import {concatBytes} from '@noble/hashes/utils'
import {bytesToHex, hexToBytes} from '../crypto/hex.js'

/** Immutable execution assignment from independently verified slot discovery. */
export interface PaidKeeperAssignment {
  /** Sharing epoch. */
  key_epoch: number
  /** Slot committee version. */
  committee_version: number
  /** Required contributor count. */
  threshold: number
  /** Registered Ed25519 coordinator key, serialized as 32 bytes. */
  coordinator: number[]
  /** Strictly sorted distinct registered Ed25519 keys, including the coordinator. */
  contributors: number[][]
}

/** Creator spending authorization; it neither reserves funds nor authorizes key access. */
export interface PaymentIntentWire {
  /** EVM chain identifier. */
  chain_id: number
  /** Settlement proxy address. */
  settlement: Hex
  /** KeyRegistry proxy address. */
  key_registry: Hex
  /** Slot identifier. */
  slot: Hex
  /** Billable operation; a dual approval is separate from the final keeper signature. */
  action: 'sign' | 'decrypt' | 'eoa-sign' | 'ibe-extract' | 'dual-approve'
  /** Digest of the exact operation payload. */
  payload_digest: Hex
  /** Commitment to the presentation random, audience and operation expiry. */
  session_commitment: Hex
  /** Unique creator payment nonce. */
  nonce: Hex
  /** Maximum TASRA base units, as a decimal string to avoid precision loss. */
  max_cost: string
  /** Payment expiry in Unix seconds. */
  expires: number
  /** Pinned verification epoch. */
  verification_epoch: number
  /** Pinned beacon seed. */
  verification_seed: Hex
  /** Pinned verifier snapshot root. */
  verification_root: Hex
  /** Pinned verifier registry size. */
  verification_registry_size: number
  /** Pinned verifier committee size. */
  verification_committee: number
  /** Pinned verifier quorum. */
  verification_quorum: number
  /** Fixed keeper sharing and execution membership. */
  keeper_assignment: PaidKeeperAssignment
  /** Creator's 65-byte EIP-712 signature. */
  signature: Hex
  /**
   * Prepaid allowances: the allowance this operation is debited from. When present the creator
   * signature is over `SlotAllowancePaymentIntent` (these fields plus `allowanceId`), never over
   * `SlotAssignedPaymentIntent`, so neither signature can stand in for the other. Absent on a
   * per-operation (reservation-backed) payment, whose JSON is then unchanged.
   */
  allowance_id?: Hex
  /** Prepaid allowances: the accountant-quorum debit voucher for this operation; not part of the signed intent. */
  debit_voucher?: DebitVoucherWire
}

/** Accountant-quorum debit of one operation against an allowance (threshold BN254 over {@link debitVoucherDigest}). */
export interface DebitVoucherWire {
  /** Allowance the operation is debited from. */
  allowance_id: Hex
  /** Per-allowance sequence number, from 1. */
  seq: number
  /** The operation's {@link prepaidRequestId}. */
  request_id: Hex
  /** TASRA base units fixed at the quote block, decimal. */
  cost: string
  /** Total debited through `seq`, decimal; never above the allowance amount. */
  cumulative: string
  /** Canonical block the cost was quoted at; the group key is read there. */
  quote_block: Hex
  /** 64-byte BN254 G1 aggregate (x || y). */
  signature: Hex
}

function uint(n: number, bits: number, name: string): void {
  if (!Number.isSafeInteger(n) || n < 0 || BigInt(n) >= (1n << BigInt(bits))) throw new Error(`${name}: invalid uint${bits}`)
}
function be(n: number, size: number): Uint8Array {
  let value = BigInt(n)
  const result = new Uint8Array(size)
  for (let i = size - 1; i >= 0; i--) {
    result[i] = Number(value & 255n)
    value >>= 8n
  }
  return result
}
function hex(value: unknown, size: number, name: string): asserts value is Hex {
  if (typeof value !== 'string' || !new RegExp(`^0x[0-9a-f]{${size * 2}}$`, 'i').test(value)) throw new Error(`${name}: invalid ${size}-byte hex`)
}
function key(value: unknown): asserts value is number[] {
  if (!Array.isArray(value) || value.length !== 32 || !Array.from(value).every(v => Number.isInteger(v) && v >= 0 && v <= 255) || value.every(v => v === 0)) {
    throw new Error('invalid paid keeper key')
  }
}

/**
 * Hash a validated assignment using the platform's fixed-width canonical encoding.
 * @param a - Fixed sharing and registered keeper keys from independent discovery.
 */
export function keeperAssignmentCommitment(a: PaidKeeperAssignment): Hex {
  uint(a.key_epoch, 64, 'key_epoch')
  uint(a.committee_version, 64, 'committee_version')
  uint(a.threshold, 16, 'threshold')
  key(a.coordinator)
  if (!Array.isArray(a.contributors) || a.contributors.length > 256 || a.threshold === 0 || a.threshold > a.contributors.length) throw new Error('invalid paid keeper threshold')
  const keys = Array.from(a.contributors, k => {
    key(k)
    return bytesToHex(Uint8Array.from(k))
  })
  if (keys.some((k, i) => i > 0 && k <= keys[i - 1]!) || !keys.includes(bytesToHex(Uint8Array.from(a.coordinator)))) throw new Error('invalid paid keeper membership/order')
  return bytesToHex(keccak_256(concatBytes(
    new TextEncoder().encode('keykeeper/paid-keeper-assignment/v1'),
    be(a.key_epoch, 8), be(a.committee_version, 8), be(a.threshold, 2),
    Uint8Array.from(a.coordinator), be(keys.length, 4),
    ...a.contributors.map(k => Uint8Array.from(k)),
  ))) as Hex
}

const ACTIONS = {'sign': 0, 'decrypt': 1, 'eoa-sign': 2, 'ibe-extract': 3, 'dual-approve': 6} as const
const BASE_FIELDS = [
  {name: 'keyRegistry', type: 'address'}, {name: 'slotId', type: 'bytes32'},
  {name: 'action', type: 'uint8'}, {name: 'payloadDigest', type: 'bytes32'},
  {name: 'sessionCommitment', type: 'bytes32'}, {name: 'nonce', type: 'bytes32'},
  {name: 'maxCost', type: 'uint256'}, {name: 'expires', type: 'uint64'},
  {name: 'verificationEpoch', type: 'uint64'}, {name: 'verificationSeed', type: 'bytes32'},
  {name: 'verificationRoot', type: 'bytes32'}, {name: 'verificationRegistrySize', type: 'uint32'},
  {name: 'verificationCommittee', type: 'uint32'}, {name: 'verificationQuorum', type: 'uint32'},
  {name: 'keeperAssignment', type: 'bytes32'},
] as const
const TYPES = {SlotAssignedPaymentIntent: BASE_FIELDS} as const
/** Prepaid allowances: a distinct type (same domain), so a per-operation signature never debits an allowance or the other way round. */
const ALLOWANCE_PAYMENT_TYPES = {SlotAllowancePaymentIntent: [...BASE_FIELDS, {name: 'allowanceId', type: 'bytes32'}]} as const
const ALLOWANCE_INTENT_TYPES = {SlotPrepaidAllowanceIntent: [
  {name: 'keyRegistry', type: 'address'}, {name: 'slotId', type: 'bytes32'}, {name: 'intentNonce', type: 'bytes32'},
  {name: 'amount', type: 'uint256'}, {name: 'maxOpCost', type: 'uint256'}, {name: 'actions', type: 'uint32'},
  {name: 'expiresAt', type: 'uint64'}, {name: 'verificationEpoch', type: 'uint64'}, {name: 'verificationSeed', type: 'bytes32'},
  {name: 'verificationRoot', type: 'bytes32'}, {name: 'verificationRegistrySize', type: 'uint32'},
  {name: 'verificationCommittee', type: 'uint32'}, {name: 'verificationQuorum', type: 'uint32'},
  {name: 'keeperAssignment', type: 'bytes32'},
]} as const
const PAYMENT_DOMAIN = {name: 'Keykeeper Assigned Slot Payment', version: '1'} as const
const ZERO32 = /^0x0{64}$/i
function units(value: unknown, name: string): bigint {
  if (typeof value !== 'string' || !/^[0-9]{1,78}$/.test(value) || BigInt(value) >= 1n << 256n) throw new Error(`${name}: invalid decimal TASRA base units`)
  return BigInt(value)
}
function verifierPolicy(p: {verification_registry_size: number; verification_committee: number; verification_quorum: number}, what: string): void {
  for (const k of ['verification_registry_size', 'verification_committee', 'verification_quorum'] as const) uint(p[k], 32, k)
  if (!p.verification_quorum || p.verification_quorum > p.verification_committee || p.verification_committee > p.verification_registry_size) throw new Error(`invalid ${what} verifier policy`)
}

function baseMessage(p: Omit<PaymentIntentWire, 'signature'>) {
  uint(p.chain_id, 64, 'chain_id')
  uint(p.expires, 64, 'expires')
  uint(p.verification_epoch, 64, 'verification_epoch')
  for (const k of ['settlement', 'key_registry'] as const) hex(p[k], 20, k)
  for (const k of ['slot', 'payload_digest', 'session_commitment', 'nonce', 'verification_seed', 'verification_root'] as const) hex(p[k], 32, k)
  if (!Object.hasOwn(ACTIONS, p.action)) throw new Error('unsupported payment action')
  units(p.max_cost, 'max_cost')
  verifierPolicy(p, 'payment')
  return {
    keyRegistry: p.key_registry, slotId: p.slot, action: ACTIONS[p.action], payloadDigest: p.payload_digest,
    sessionCommitment: p.session_commitment, nonce: p.nonce, maxCost: BigInt(p.max_cost), expires: BigInt(p.expires),
    verificationEpoch: BigInt(p.verification_epoch), verificationSeed: p.verification_seed, verificationRoot: p.verification_root,
    verificationRegistrySize: p.verification_registry_size, verificationCommittee: p.verification_committee,
    verificationQuorum: p.verification_quorum, keeperAssignment: keeperAssignmentCommitment(p.keeper_assignment),
  }
}

/**
 * Build creator EIP-712 data. Validate chain backing, price, expiry and creator independently before spending.
 * A payment naming an `allowance_id` (a prepaid allowance) is the distinct `SlotAllowancePaymentIntent`; the
 * `debit_voucher` is never part of the signed data.
 * @param p - Creator payment intent before attaching its signature.
 */
export function paymentIntentTypedData(p: Omit<PaymentIntentWire, 'signature'>): TypedDataDefinition {
  const domain = {...PAYMENT_DOMAIN, chainId: p.chain_id, verifyingContract: p.settlement}
  if (p.allowance_id !== undefined) {
    hex(p.allowance_id, 32, 'allowance_id')
    if (ZERO32.test(p.allowance_id)) throw new Error('allowance_id: must be nonzero')
    return {domain, primaryType: 'SlotAllowancePaymentIntent', types: ALLOWANCE_PAYMENT_TYPES,
      message: {...baseMessage(p), allowanceId: p.allowance_id}}
  }
  return {domain, primaryType: 'SlotAssignedPaymentIntent', types: TYPES, message: baseMessage(p)}
}

/**
 * Hash the creator intent. A matching hash is not proof of a mined reservation or a valid creator signature.
 * @param p - Creator payment intent; a signature is not part of the EIP-712 preimage.
 */
export function paymentIntentHash(p: Omit<PaymentIntentWire, 'signature'>): Hex {
  return hashTypedData(paymentIntentTypedData(p))
}

/**
 * Derive the Settlement reservation identity for this exact payment and operation. Unchanged by
 * Prepaid allowances: an allowance-backed payment's own signing hash is the authorization commitment, so
 * the ID binds the allowance too.
 * @param p - Fixed creator intent; neither hashing nor an ID proves a mined reservation.
 */
export function prepaidRequestId(p: Omit<PaymentIntentWire, 'signature'>): Hex {
  const intentHash = paymentIntentHash(p)
  return bytesToHex(keccak_256(concatBytes(
    new TextEncoder().encode('keykeeper/prepaid-request/v1'), be(p.chain_id, 8),
    new Uint8Array(12), hexToBytes(p.settlement), hexToBytes(p.slot),
    Uint8Array.of(ACTIONS[p.action]), hexToBytes(p.payload_digest), hexToBytes(intentHash),
  ))) as Hex
}

/**
 * Validate a debit voucher's shape (not its signature). Mirrors the readers' constructor: nonzero
 * ids, cost and quote block, `cumulative >= cost`, a 64-byte non-infinity signature encoding.
 * @param value - Untrusted voucher.
 */
export function assertDebitVoucherWire(value: unknown): asserts value is DebitVoucherWire {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('debit voucher must be an object')
  const v = value as Record<string, unknown>
  const fields = ['allowance_id', 'seq', 'request_id', 'cost', 'cumulative', 'quote_block', 'signature']
  if (Object.keys(v).length !== fields.length || fields.some(k => !Object.hasOwn(v, k))) throw new Error('invalid debit voucher fields')
  for (const k of ['allowance_id', 'request_id', 'quote_block'] as const) {
    hex(v[k], 32, `debit voucher ${k}`)
    if (ZERO32.test(v[k])) throw new Error(`debit voucher ${k} must be nonzero`)
  }
  if (typeof v.seq !== 'number') throw new Error('debit voucher seq: invalid')
  uint(v.seq, 64, 'debit voucher seq')
  const cost = units(v.cost, 'debit voucher cost'), cumulative = units(v.cumulative, 'debit voucher cumulative')
  if (cost === 0n || cumulative < cost) throw new Error('debit voucher cost must be nonzero and at most its cumulative total')
  hex(v.signature, 64, 'debit voucher signature')
  if (/^0x0{128}$/i.test(v.signature)) throw new Error('debit voucher signature is the point at infinity')
}

/**
 * Validate the wire representation and its signed commitment, without chain access.
 * @param value - Untrusted payment object; signature encoding is checked, not signer recovery.
 */
export function assertPaymentIntentWire(value: unknown): asserts value is PaymentIntentWire {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('payment must be an object')
  const p = value as PaymentIntentWire
  hex(p.signature, 65, 'payment signature')
  paymentIntentHash(p)
  if (p.debit_voucher !== undefined) {
    if (p.allowance_id === undefined) throw new Error('a debit voucher needs the allowance_id it debits')
    assertDebitVoucherWire(p.debit_voucher)
    if (p.debit_voucher.allowance_id.toLowerCase() !== p.allowance_id.toLowerCase()) throw new Error('debit voucher names a different allowance than the payment intent')
    if (p.debit_voucher.request_id.toLowerCase() !== prepaidRequestId(p).toLowerCase()) throw new Error('debit voucher debits a different request')
    if (BigInt(p.debit_voucher.cost) > BigInt(p.max_cost)) throw new Error('debit voucher cost exceeds the payment cap')
  }
}

// ---- ADR-0090 prepaid allowances ---------------------------------------------------------

/** The paid actions an allowance can fund, as `PrepaidAction` bit ordinals. */
export type AllowanceAction = keyof typeof ACTIONS
/** `ALLOWANCE_ACTIONS`: sign, decrypt, eoa-sign, ibe-extract and dual-approve. */
export const ALLOWANCE_ACTIONS: number = Object.values(ACTIONS).reduce((bits: number, ordinal: number) => bits | (1 << ordinal), 0)

/**
 * The actions bitmap of an allowance (bit `i` = `PrepaidAction` ordinal `i`).
 * @param actions - Paid actions the allowance funds; at least one.
 */
export function allowanceActionBits(actions: readonly AllowanceAction[]): number {
  if (!actions.length) throw new Error('an allowance funds at least one action')
  return actions.reduce((bits, action) => {
    if (!Object.hasOwn(ACTIONS, action)) throw new Error('unsupported allowance action')
    return bits | (1 << ACTIONS[action])
  }, 0)
}

/**
 * Whether an allowance's actions bitmap funds `action`.
 * @param actions - Allowance bitmap.
 * @param action - Paid action of one operation.
 */
export function allowanceFunds(actions: number, action: AllowanceAction): boolean {
  return Object.hasOwn(ACTIONS, action) && (actions & (1 << ACTIONS[action])) !== 0
}

/** Creator authorization to lock `amount` of a slot's balance as an allowance (`SlotPrepaidAllowanceIntent`). */
export interface PrepaidAllowanceIntentWire {
  /** EVM chain identifier. */
  chain_id: number
  /** Settlement proxy address. */
  settlement: Hex
  /** KeyRegistry proxy address. */
  key_registry: Hex
  /** Slot identifier. */
  slot: Hex
  /** Unique nonzero creator nonce. */
  intent_nonce: Hex
  /** Escrow, TASRA base units, decimal. */
  amount: string
  /** Per-operation cap, TASRA base units, decimal; at most `amount`. */
  max_op_cost: string
  /** Funded actions bitmap ({@link allowanceActionBits}). */
  actions: number
  /** Expiry, Unix seconds; at most one hour ahead. */
  expires_at: number
  /** Pinned verification epoch. */
  verification_epoch: number
  /** Pinned beacon seed. */
  verification_seed: Hex
  /** Pinned verifier snapshot root. */
  verification_root: Hex
  /** Pinned verifier registry size. */
  verification_registry_size: number
  /** Pinned verifier committee size. */
  verification_committee: number
  /** Pinned verifier quorum. */
  verification_quorum: number
  /** Fixed keeper sharing and execution membership. */
  keeper_assignment: PaidKeeperAssignment
  /** Creator's 65-byte EIP-712 signature. */
  signature: Hex
}

/**
 * Build the creator EIP-712 data of an allowance intent (the payment domain: chain + Settlement).
 * @param p - Allowance intent before attaching its signature.
 */
export function prepaidAllowanceIntentTypedData(p: Omit<PrepaidAllowanceIntentWire, 'signature'>) {
  uint(p.chain_id, 64, 'chain_id')
  uint(p.expires_at, 64, 'expires_at')
  uint(p.verification_epoch, 64, 'verification_epoch')
  uint(p.actions, 32, 'actions')
  for (const k of ['settlement', 'key_registry'] as const) hex(p[k], 20, k)
  for (const k of ['slot', 'intent_nonce', 'verification_seed', 'verification_root'] as const) hex(p[k], 32, k)
  const amount = units(p.amount, 'amount'), maxOpCost = units(p.max_op_cost, 'max_op_cost')
  if (amount === 0n || maxOpCost === 0n || maxOpCost > amount) throw new Error('allowance amount and per-operation cap must be nonzero, cap <= amount')
  if (p.actions === 0 || (p.actions & ~ALLOWANCE_ACTIONS) !== 0) throw new Error('allowance actions must name only authorized operations')
  if (ZERO32.test(p.intent_nonce) || ZERO32.test(p.verification_seed)) throw new Error('allowance intent needs a nonzero nonce and verification seed')
  verifierPolicy(p, 'allowance')
  return {
    domain: {...PAYMENT_DOMAIN, chainId: p.chain_id, verifyingContract: p.settlement},
    primaryType: 'SlotPrepaidAllowanceIntent' as const, types: ALLOWANCE_INTENT_TYPES,
    message: {
      keyRegistry: p.key_registry, slotId: p.slot, intentNonce: p.intent_nonce, amount, maxOpCost, actions: p.actions,
      expiresAt: BigInt(p.expires_at), verificationEpoch: BigInt(p.verification_epoch), verificationSeed: p.verification_seed,
      verificationRoot: p.verification_root, verificationRegistrySize: p.verification_registry_size,
      verificationCommittee: p.verification_committee, verificationQuorum: p.verification_quorum,
      keeperAssignment: keeperAssignmentCommitment(p.keeper_assignment),
    },
  }
}

/**
 * The allowance intent's EIP-712 signing hash: the `intentHash` argument of `reservePrepaidAllowanceBls`.
 * @param p - Allowance intent; the signature is not part of the preimage.
 */
export function prepaidAllowanceIntentHash(p: Omit<PrepaidAllowanceIntentWire, 'signature'>): Hex {
  return hashTypedData(prepaidAllowanceIntentTypedData(p))
}

const word = (name: string) => keccak256(toHex(name))
/** Domain strings of the prepaid-allowance encodings. A change is a NEW name, never a digit. */
export const PREPAID_ALLOWANCE_DOMAINS = {
  allowanceId: 'keykeeper/prepaid-allowance-id/v1',
  reserve: 'keykeeper/prepaid-allowance-reserve/v1',
  debitVoucher: 'keykeeper/prepaid-debit/v1',
  allowanceSettle: 'keykeeper/prepaid-allowance-settle/v1',
  close: 'keykeeper/prepaid-allowance-close/v1',
} as const

/**
 * `keccak256(abi.encode(ID_DOMAIN, chainid, settlement, slotId, intentHash))`: the id every reader
 * derives from the creator's intent (chain id BEFORE the Settlement here, after it elsewhere).
 * @param chainId - EVM chain.
 * @param settlement - Settlement proxy.
 * @param slot - Slot.
 * @param intentHash - {@link prepaidAllowanceIntentHash} of the creator intent.
 */
export function allowanceId(chainId: number, settlement: Hex, slot: Hex, intentHash: Hex): Hex {
  return keccak256(encodeAbiParameters([{type: 'bytes32'}, {type: 'uint256'}, {type: 'address'}, {type: 'bytes32'}, {type: 'bytes32'}],
    [word(PREPAID_ALLOWANCE_DOMAINS.allowanceId), BigInt(chainId), settlement, slot, intentHash]))
}

/** The arguments of `reservePrepaidAllowanceBls` the accountant quorum signs. */
export interface AllowanceReserveArgs {
  /** Slot. */
  slot: Hex
  /** Reconciled legacy settlement cursor. */
  legacyNonce: bigint
  /** Derived allowance id. */
  allowanceId: Hex
  /** Escrow. */
  amount: bigint
  /** Per-operation cap. */
  maxOpCost: bigint
  /** Funded actions bitmap. */
  actions: number
  /** Expiry, Unix seconds. */
  expiresAt: bigint
  /** Quote block, immutable as the allowance's assignment block. */
  assignmentBlock: Hex
  /** Authorization deadline, Unix seconds. */
  deadline: bigint
}

/**
 * The reserve digest (`keykeeper/prepaid-allowance-reserve/v1`).
 * @param settlement - Settlement proxy.
 * @param chainId - EVM chain.
 * @param a - Reservation arguments.
 */
export function allowanceReserveDigest(settlement: Hex, chainId: number, a: AllowanceReserveArgs): Hex {
  return keccak256(encodeAbiParameters([
    {type: 'bytes32'}, {type: 'address'}, {type: 'uint256'}, {type: 'bytes32'}, {type: 'uint64'}, {type: 'bytes32'},
    {type: 'uint256'}, {type: 'uint256'}, {type: 'uint32'}, {type: 'uint64'}, {type: 'bytes32'}, {type: 'uint64'},
  ], [word(PREPAID_ALLOWANCE_DOMAINS.reserve), settlement, BigInt(chainId), a.slot, a.legacyNonce, a.allowanceId,
    a.amount, a.maxOpCost, a.actions, a.expiresAt, a.assignmentBlock, a.deadline]))
}

/** The fields a debit voucher's threshold signature covers. */
export interface DebitVoucherFields {
  /** Allowance. */
  allowanceId: Hex
  /** Per-allowance sequence. */
  seq: bigint
  /** Operation's request ID. */
  requestId: Hex
  /** Cost at the quote block. */
  cost: bigint
  /** Total debited through `seq`. */
  cumulative: bigint
  /** Quote block hash. */
  quoteBlock: Hex
}

/**
 * The debit-voucher digest (`keykeeper/prepaid-debit/v1`) the accountant threshold key signs.
 * @param settlement - Settlement proxy.
 * @param chainId - EVM chain.
 * @param v - Voucher fields.
 */
export function debitVoucherDigest(settlement: Hex, chainId: number, v: DebitVoucherFields): Hex {
  return keccak256(encodeAbiParameters([
    {type: 'bytes32'}, {type: 'address'}, {type: 'uint256'}, {type: 'bytes32'}, {type: 'uint64'}, {type: 'bytes32'},
    {type: 'uint256'}, {type: 'uint256'}, {type: 'bytes32'},
  ], [word(PREPAID_ALLOWANCE_DOMAINS.debitVoucher), settlement, BigInt(chainId), v.allowanceId, v.seq, v.requestId, v.cost, v.cumulative, v.quoteBlock]))
}

/**
 * {@link debitVoucherDigest} of a wire voucher.
 * @param settlement - Settlement proxy.
 * @param chainId - EVM chain.
 * @param v - Shape-checked voucher.
 */
export function debitVoucherWireDigest(settlement: Hex, chainId: number, v: DebitVoucherWire): Hex {
  assertDebitVoucherWire(v)
  return debitVoucherDigest(settlement, chainId, {allowanceId: v.allowance_id, seq: BigInt(v.seq), requestId: v.request_id,
    cost: BigInt(v.cost), cumulative: BigInt(v.cumulative), quoteBlock: v.quote_block})
}

/** The arguments of `settlePrepaidAllowanceBls` the quorum signs (accountant settle path; for conformance). */
export interface AllowanceSettleArgs {
  /** Allowance. */
  allowanceId: Hex
  /** Settled request IDs. */
  requestIds: readonly Hex[]
  /** Their costs. */
  costs: readonly bigint[]
  /** Paid out of each cost. */
  paid: readonly bigint[]
  /** Claim batch. */
  batchId: Hex
  /** Payout root. */
  root: Hex
  /** Evidence hash. */
  evidenceHash: Hex
  /** Deadline. */
  deadline: bigint
}

/**
 * The allowance-settle digest (`keykeeper/prepaid-allowance-settle/v1`).
 * @param settlement - Settlement proxy.
 * @param chainId - EVM chain.
 * @param s - Settlement arguments.
 */
export function allowanceSettleDigest(settlement: Hex, chainId: number, s: AllowanceSettleArgs): Hex {
  return keccak256(encodeAbiParameters([
    {type: 'bytes32'}, {type: 'address'}, {type: 'uint256'}, {type: 'bytes32'}, {type: 'bytes32[]'}, {type: 'uint256[]'},
    {type: 'uint256[]'}, {type: 'bytes32'}, {type: 'bytes32'}, {type: 'bytes32'}, {type: 'uint64'},
  ], [word(PREPAID_ALLOWANCE_DOMAINS.allowanceSettle), settlement, BigInt(chainId), s.allowanceId, [...s.requestIds], [...s.costs], [...s.paid],
    s.batchId, s.root, s.evidenceHash, s.deadline]))
}

/**
 * The close digest (`keykeeper/prepaid-allowance-close/v1`).
 * @param settlement - Settlement proxy.
 * @param chainId - EVM chain.
 * @param allowance - Allowance.
 * @param finalCumulative - Every debit the quorum issued.
 * @param deadline - Deadline.
 */
export function allowanceCloseDigest(settlement: Hex, chainId: number, allowance: Hex, finalCumulative: bigint, deadline: bigint): Hex {
  return keccak256(encodeAbiParameters([{type: 'bytes32'}, {type: 'address'}, {type: 'uint256'}, {type: 'bytes32'}, {type: 'uint256'}, {type: 'uint64'}],
    [word(PREPAID_ALLOWANCE_DOMAINS.close), settlement, BigInt(chainId), allowance, finalCumulative, deadline]))
}


/**
 * Commit a fixed presentation random and audience before reserving a payment.
 * @param random - Fixed 32-byte cryptographic presentation random.
 * @param clientId - Verifier-agent audience used for the presentation.
 * @param operationExp - Original signed operation expiry in Unix seconds.
 */
export function paymentSessionCommitment(random: Hex, clientId: string, operationExp: number): Hex {
  hex(random, 32, 'random')
  uint(operationExp, 64, 'operation expiry')
  const audience = new TextEncoder().encode(clientId)
  return bytesToHex(keccak_256(concatBytes(new TextEncoder().encode('keykeeper/payment-session/v1'), hexToBytes(random), be(audience.length, 8), audience, be(operationExp, 8)))) as Hex
}
