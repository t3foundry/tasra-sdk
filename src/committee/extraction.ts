import {equalBytes} from '@noble/curves/utils.js'
import {utf8ToBytes} from '@noble/hashes/utils'
import {sha256} from '@noble/hashes/sha256'
import {ibeCombineExtract, ibeDecryptWithKey, ibeVerifyShare, type IbeCiphertext} from '../crypto/ibe.js'
import {TasraError, ThresholdNotMetError} from '../errors.js'
import {requestIbeExtractionPartials, type IbeExtractOpts} from './client.js'
import {compoundTokenHash, decodeCompoundToken} from './token.js'
import {auditOperationId, protocolHex, verifyOperationReceipt, type OperationReceipt} from './receipts.js'

/** Assigned keeper endpoint with independently established operator, key and optional share metadata. */
export interface ExtractionKeeper {
  /** On-chain assigned operator address. Two URLs cannot count as two operators. */
  operator: string
  /** Keeper HTTP base URL. */
  nodeUrl: string
  /** Group share identifier from trusted deployment/slot metadata, when known. */
  identifier?: number
  /** Authenticated Ed25519 keeper key used to verify operation receipts. */
  publicKey?: Uint8Array
  /** Independently authenticated G2 verifying share, not copied from the HTTP reply. */
  verifyingShareG2?: Uint8Array
}

/** Expected slot epoch, threshold, chain key and keeper trust requirements for identity-key extraction. */
export interface StrictExtractionOptions extends Omit<IbeExtractOpts, 'nodeUrls' | 'ciphertextEpoch'> {
  /** EVM chain identifier. */
  chainId: number | bigint
  /** 32-byte slot identifier. */
  slotId: string
  /** Minimum number of distinct assigned keeper shares. */
  threshold: number
  /** Slot key epoch used to match the extraction shares. */
  epoch: number
  /** Group key pinned to this slot/epoch on chain (96-byte G2). */
  groupPublicKey: Uint8Array
  /** Assigned keepers with independently established identity and key metadata. */
  keepers: readonly ExtractionKeeper[]
  /**
   * pinned-shares requires an independently authenticated verifying share and identifier
   * for EVERY keeper. anchored-group verifies the final key against chain, but does not
   * claim independent provenance of each returned verifying share.
   */
  shareTrust: 'pinned-shares' | 'anchored-group'
  /** Require a valid operation attestation from every share used. Default false. */
  requireReceipts?: boolean
}

/** Keeper identity, share identifier and receipt verification status for an accepted extraction share. */
export interface ExtractionEvidence {
  /** Keeper operator address. */
  operator: string
  /** Nonzero threshold participant identifier. */
  identifier: number
  /** Keeper HTTP base URL. */
  nodeUrl: string
  /** Optional keeper attestation; presence alone does not establish validity. */
  receipt?: OperationReceipt
  /** Whether the receipt is absent, present but unchecked, or verified. */
  receiptStatus: 'absent' | 'unverified' | 'verified'
}

/** Extracted identity key and provenance evidence. The caller must clear the returned key when finished. */
export interface StrictExtractionResult {
  /** Durable identity capability. Caller owns and must clear this buffer when finished. */
  key: Uint8Array
  /** Slot key epoch used to match the extraction shares. */
  epoch: number
  /** Trust model used for validating the returned shares. */
  shareTrust: StrictExtractionOptions['shareTrust']
  /** Provenance and receipt status for every accepted share. */
  evidence: ExtractionEvidence[]
}

/**
 * Extract using a distinct assigned quorum, one epoch and the chain-anchored group key.
 * Read slot metadata before calling; this helper deliberately cannot authenticate caller
 * configuration. Never populate pinned shares from the extraction response itself.
 * All temporary partials are cleared even on rejection. No master key is reconstructed.
 *
 * @param input - Expected slot key, epoch, quorum, keepers and authorized identity.
 */
export async function extractIdentityStrict(input: StrictExtractionOptions): Promise<StrictExtractionResult> {
  input = {...input, committeeToken: structuredClone(input.committeeToken), verifierProofs: input.verifierProofs && structuredClone(input.verifierProofs), userSignature: input.userSignature?.slice()}
  const slot = protocolHex(input.slotId, 32, 'slot id')
  if (!equalBytes(slot, protocolHex(input.committeeToken.slot_id, 32, 'token slot'))) throw new TasraError('Extraction token selects another slot')
  if (!Number.isSafeInteger(input.threshold) || input.threshold < 1 || input.threshold > input.keepers.length ||
    !Number.isSafeInteger(input.epoch) || input.epoch < 0 || input.groupPublicKey.length !== 96 ||
    !['pinned-shares', 'anchored-group'].includes(input.shareTrust)) throw new TasraError('Invalid extraction threshold, epoch, group key or trust mode')
  const group = input.groupPublicKey.slice(), identity = utf8ToBytes(input.identity)
  const keepers = input.keepers.map(k => ({...k, operator: k.operator.toLowerCase(),
    publicKey: k.publicKey?.slice(), verifyingShareG2: k.verifyingShareG2?.slice()}))
  for (const k of keepers) {
    protocolHex(k.operator, 20, 'keeper operator')
    if (!k.nodeUrl || k.identifier !== undefined && (!Number.isSafeInteger(k.identifier) || k.identifier < 1 || k.identifier > 65535) ||
      input.shareTrust === 'pinned-shares' && (k.identifier === undefined || k.verifyingShareG2?.length !== 96) ||
      input.requireReceipts && k.publicKey?.length !== 32) throw new TasraError('Missing trusted keeper identity, share or receipt key')
  }
  if (new Set(keepers.map(k => k.operator)).size !== keepers.length || new Set(keepers.map(k => k.nodeUrl.replace(/\/$/, ''))).size !== keepers.length) {
    throw new TasraError('Duplicate extraction keeper or endpoint')
  }
  const byUrl = new Map(keepers.map(k => [k.nodeUrl, k]))
  const threshold = input.threshold, epoch = input.epoch, shareTrust = input.shareTrust, required = input.requireReceipts
  const tokenHash = compoundTokenHash(decodeCompoundToken(input.committeeToken))
  const opId = auditOperationId(slot, 'ibe-extract', tokenHash, sha256(identity))
  const partials = await requestIbeExtractionPartials({...input, nodeUrls: keepers.map(k => k.nodeUrl), ciphertextEpoch: epoch})
  let key: Uint8Array | undefined
  try {
    input.signal?.throwIfAborted()
    if (partials.length < threshold) throw new ThresholdNotMetError({got: partials.length, need: threshold})
    const ids = new Set<number>(), evidence: ExtractionEvidence[] = []
    for (const p of partials) {
      const k = byUrl.get(p.nodeUrl)
      if (!k || !Number.isSafeInteger(p.identifier) || p.identifier < 1 || p.identifier > 65535 || ids.has(p.identifier) ||
        p.epoch !== epoch || !equalBytes(protocolHex(p.keySlotId, 32, 'extraction slot'), slot) || p.value.length !== 48 || p.verifyingShareG2.length !== 96 ||
        k.identifier !== undefined && k.identifier !== p.identifier || k.verifyingShareG2 && !equalBytes(k.verifyingShareG2, p.verifyingShareG2)) {
        throw new TasraError('Extraction share has inconsistent slot, epoch, keeper or key provenance')
      }
      ids.add(p.identifier)
      let receiptStatus: ExtractionEvidence['receiptStatus'] = p.receipt ? 'unverified' : 'absent'
      if (p.receipt && k.publicKey) {
        if (!verifyOperationReceipt(p.receipt, {chainId: input.chainId, slotId: slot, tokenHash, opId, keeperPublicKey: k.publicKey})) {
          throw new TasraError('Invalid extraction operation receipt')
        }
        receiptStatus = 'verified'
      }
      if (required && receiptStatus !== 'verified') throw new TasraError('Verified extraction receipt required')
      evidence.push({operator: k.operator, identifier: p.identifier, nodeUrl: p.nodeUrl, ...(p.receipt ? {receipt: p.receipt} : {}), receiptStatus})
    }
    key = ibeCombineExtract(new Map(partials.map(p => [p.identifier, p.verifyingShareG2])), partials, identity)
    // Returned shares must combine to the slot's independently anchored master public key.
    ibeVerifyShare(new Map([[1, group]]), identity, {identifier: 1, value: key})
    return {key, epoch, shareTrust, evidence}
  } catch (error) {
    key?.fill(0)
    throw error
  } finally { for (const p of partials) p.value.fill(0) }
}

/**
 * Decrypt an IBE ciphertext and clear the intermediate identity key on every exit.
 *
 * @param opts - Strict extraction requirements plus the IBE ciphertext to decrypt.
 */
export async function decryptIdentityStrict(opts: StrictExtractionOptions & {ciphertext: IbeCiphertext}): Promise<Omit<StrictExtractionResult, 'key'> & {plaintext: Uint8Array}> {
  const {key, ...evidence} = await extractIdentityStrict(opts)
  try { return {...evidence, plaintext: ibeDecryptWithKey(key, opts.ciphertext, utf8ToBytes(opts.identity))} }
  finally { key.fill(0) }
}
