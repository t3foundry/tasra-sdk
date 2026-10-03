import {hashTypedData, type Hex} from 'viem'
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
  /** Final billable key operation. */
  action: 'sign' | 'decrypt' | 'eoa-sign' | 'ibe-extract'
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

const ACTIONS = {'sign': 0, 'decrypt': 1, 'eoa-sign': 2, 'ibe-extract': 3} as const
const TYPES = {SlotAssignedPaymentIntent: [
  {name: 'keyRegistry', type: 'address'}, {name: 'slotId', type: 'bytes32'},
  {name: 'action', type: 'uint8'}, {name: 'payloadDigest', type: 'bytes32'},
  {name: 'sessionCommitment', type: 'bytes32'}, {name: 'nonce', type: 'bytes32'},
  {name: 'maxCost', type: 'uint256'}, {name: 'expires', type: 'uint64'},
  {name: 'verificationEpoch', type: 'uint64'}, {name: 'verificationSeed', type: 'bytes32'},
  {name: 'verificationRoot', type: 'bytes32'}, {name: 'verificationRegistrySize', type: 'uint32'},
  {name: 'verificationCommittee', type: 'uint32'}, {name: 'verificationQuorum', type: 'uint32'},
  {name: 'keeperAssignment', type: 'bytes32'},
]} as const

/**
 * Build creator EIP-712 data. Validate chain backing, price, expiry and creator independently before spending.
 * @param p - Creator payment intent before attaching its signature.
 */
export function paymentIntentTypedData(p: Omit<PaymentIntentWire, 'signature'>) {
  uint(p.chain_id, 64, 'chain_id')
  uint(p.expires, 64, 'expires')
  uint(p.verification_epoch, 64, 'verification_epoch')
  for (const k of ['verification_registry_size', 'verification_committee', 'verification_quorum'] as const) uint(p[k], 32, k)
  for (const k of ['settlement', 'key_registry'] as const) hex(p[k], 20, k)
  for (const k of ['slot', 'payload_digest', 'session_commitment', 'nonce', 'verification_seed', 'verification_root'] as const) hex(p[k], 32, k)
  if (!Object.hasOwn(ACTIONS, p.action)) throw new Error('unsupported payment action')
  if (typeof p.max_cost !== 'string' || !/^[0-9]{1,78}$/.test(p.max_cost) || BigInt(p.max_cost) >= 1n << 256n) throw new Error('max_cost: invalid decimal TASRA base units')
  if (!p.verification_quorum || p.verification_quorum > p.verification_committee || p.verification_committee > p.verification_registry_size) throw new Error('invalid payment verifier policy')
  return {
    domain: {name: 'Keykeeper Assigned Slot Payment', version: '1', chainId: p.chain_id, verifyingContract: p.settlement},
    primaryType: 'SlotAssignedPaymentIntent' as const, types: TYPES,
    message: {
      keyRegistry: p.key_registry, slotId: p.slot, action: ACTIONS[p.action], payloadDigest: p.payload_digest,
      sessionCommitment: p.session_commitment, nonce: p.nonce, maxCost: BigInt(p.max_cost), expires: BigInt(p.expires),
      verificationEpoch: BigInt(p.verification_epoch), verificationSeed: p.verification_seed, verificationRoot: p.verification_root,
      verificationRegistrySize: p.verification_registry_size, verificationCommittee: p.verification_committee,
      verificationQuorum: p.verification_quorum, keeperAssignment: keeperAssignmentCommitment(p.keeper_assignment),
    },
  }
}

/**
 * Hash the creator intent. A matching hash is not proof of a mined reservation or a valid creator signature.
 * @param p - Creator payment intent; a signature is not part of the EIP-712 preimage.
 */
export function paymentIntentHash(p: Omit<PaymentIntentWire, 'signature'>): Hex {
  return hashTypedData(paymentIntentTypedData(p))
}

/**
 * Derive the Settlement reservation identity for this exact payment and operation.
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
 * Validate the wire representation and its signed commitment, without chain access.
 * @param value - Untrusted payment object; signature encoding is checked, not signer recovery.
 */
export function assertPaymentIntentWire(value: unknown): asserts value is PaymentIntentWire {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('payment must be an object')
  const p = value as PaymentIntentWire
  hex(p.signature, 65, 'payment signature')
  paymentIntentHash(p)
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
