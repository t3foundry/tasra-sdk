import {equalBytes} from '@noble/curves/utils.js'
import {sha256} from '@noble/hashes/sha256'
import {keccak_256} from '@noble/hashes/sha3'
import {utf8ToBytes} from '@noble/hashes/utils'
import {recoverAddress, toHex, type Hex} from 'viem'
import {createTasraChainClient, type TasraChainClient} from '../chain/client.js'
import {addressFromEoaPubkey, type EoaSignature} from '../signing/ecdsa.js'
import {verify} from '../crypto/frost.js'
import {ibeEncrypt, type IbeCiphertext} from '../crypto/ibe.js'
import {TasraError} from '../errors.js'
import {committeeSign, type VerifierProof} from '../committee/client.js'
import {committeeSignEoaDigest} from '../committee/ecdsa.js'
import {createDualSignClient} from '../committee/dual-sign.js'
import {decryptIdentityStrict, extractIdentityStrict, type StrictExtractionOptions} from '../committee/extraction.js'
import {auditOperationId, protocolHex, verifyOperationReceipt} from '../committee/receipts.js'
import {compoundTokenHash, decodeCompoundToken, type CompoundTokenWire} from '../committee/token.js'
import {payloadDigestFor, requestHash} from '../oid4vp/binding.js'
import type {OperationInput} from '../oid4vp/verifier-agent.js'
import {defineDeployment, type TasraDeployment} from './deployment.js'

/**
 * Failure categories for deployment, slot, authorization and result validation.
 */
export type ApplicationErrorCode = 'CHAIN_MISMATCH' | 'SLOT_NOT_FOUND' | 'SLOT_CANCELLED' | 'WRONG_SLOT_MODE' | 'KEY_NOT_READY' | 'SLOT_CHANGED' | 'INVALID_AUTHORIZATION' | 'INVALID_RESULT'
/**
 * An application operation rejected because its deployment, slot, authorization or result failed validation.
 */
export class TasraApplicationError extends TasraError {
  constructor(/** Stable application error category used to choose recovery behavior. */ readonly code: ApplicationErrorCode, message: string) { super(message) }
}

/**
 * Holder-bound committee token and verifier membership proofs for one operation.
 */
export interface OperationGrant {
  /** Fresh compound verifier token bound to the holder and exact operation. */
  token: CompoundTokenWire
  /** Membership proofs for the verifiers that authorized the operation. */
  verifierProofs: VerifierProof[]
}
/**
 * Immutable operation details presented to the application authorizer.
 */
export type AuthorizationRequest = Readonly<OperationInput & {
  /** Cancellation signal propagated to the authorization provider. */
  signal?: AbortSignal
}>
/** Called once for the exact operation. Applications display the wallet request here. */
export type OperationAuthorizer = (request: AuthorizationRequest) => Promise<OperationGrant>
/**
 * Authorization callback, consent description and cancellation controls for a protected operation.
 */
export interface AuthorizedOperationOptions {
  /**
   * Obtain a fresh holder-bound grant for this exact operation.
   */
  authorize: OperationAuthorizer
  /**
   * Human-readable consent text attached to the authorization request.
   */
  description?: string
  /**
   * Cancel pending authorization or network work.
   */
  signal?: AbortSignal
  /**
   * Optional holder signature forwarded to the keeper operation.
   */
  userSignature?: Uint8Array
}
/**
 * Deployment, chain reader and transport choices used by the application client.
 */
export interface TasraApplicationConfig {
  /** Application-approved chain, registry and coordinator configuration. */
  deployment: TasraDeployment
  /** Reuse the read client in an existing app. Its actual chain is checked before use. */
  chain?: TasraChainClient
  /** Caller-approved routing, e.g. local Docker hostnames to published loopback ports. */
  keeperUrl?: (registeredUrl: string) => string
  /** HTTP implementation used for keeper operation requests. */
  fetchImpl?: typeof fetch
}
/**
 * Current slot mode, key epoch, threshold and anchored public key.
 */
export interface SlotMetadata {
  /**
   * 32-byte identifier of the slot on this deployment.
   */
  slotId: Hex
  /**
   * Registry key-mode ordinal: 0 for FROST, 1 for BLS or 2 for threshold ECDSA.
   */
  mode: number
  /**
   * Current key epoch recorded by the registry.
   */
  epoch: number
  /**
   * Minimum participating shares k and total assigned shares n.
   */
  threshold: {k: number; n: number}
  /**
   * Anchored group public key as hexadecimal bytes.
   */
  publicKey: Hex
  /**
   * Whether the registry contains a nonempty group public key.
   */
  ready: boolean
}

/**
 * Configure one application client. Construction does no I/O and holds no wallet credentials.
 * Start with `await tasra.slots.ecdsa(slotId)` and `await account.getAddress()`;
 * provide an authorizer only when signing or decrypting.
 * @param config Validated deployment settings and optional transport adapters.
 * @returns A client with read-only checks and authorized slot operations.
 */
export function createTasra(config: TasraApplicationConfig) {
  const deployment = defineDeployment(config.deployment)
  const chain = config.chain ?? createTasraChainClient(deployment)
  for (const name of ['KeyRegistry', 'NodeRegistry'] as const) {
    if (chain.addresses[name]?.toLowerCase() !== deployment.addresses[name]!.toLowerCase()) throw new TasraError(`Injected chain client uses a different ${name}`)
  }
  const route = config.keeperUrl ?? ((url: string) => url), fetchImpl = config.fetchImpl
  async function assertChain() {
    if (await chain.client.getChainId() !== deployment.chainId) throw new TasraApplicationError('CHAIN_MISMATCH', 'RPC chain does not match the application deployment')
  }
  /**
   * Read slot metadata after checking the deployment chain and slot status.
   * @param slotId Identifier of the slot on this deployment.
   */
  async function get(slotId: Hex): Promise<SlotMetadata> {
    protocolHex(slotId, 32, 'slot id')
    await assertChain()
    const s = await chain.readers.keyRegistry.getKeySlot(slotId)
    if (!s.exists) throw new TasraApplicationError('SLOT_NOT_FOUND', 'Slot does not exist on this deployment')
    if (s.cancelled) throw new TasraApplicationError('SLOT_CANCELLED', 'Slot is cancelled')
    return {slotId, mode: Number(s.mode), epoch: Number(s.epoch), threshold: {k: Number(s.threshold.k), n: Number(s.threshold.n)},
      publicKey: s.publicKey, ready: s.publicKey !== '0x'}
  }
  async function ready(slotId: Hex, mode: number) {
    const s = await get(slotId)
    if (s.mode !== mode) throw new TasraApplicationError('WRONG_SLOT_MODE', `Slot mode ${s.mode} does not support this operation`)
    if (!s.ready) throw new TasraApplicationError('KEY_NOT_READY', 'Slot key generation has not completed')
    return s
  }
  async function unchanged(s: SlotMetadata) {
    const current = await ready(s.slotId, s.mode)
    if (current.epoch !== s.epoch || current.publicKey !== s.publicKey || current.threshold.k !== s.threshold.k || current.threshold.n !== s.threshold.n) {
      throw new TasraApplicationError('SLOT_CHANGED', 'Slot changed while authorization was pending; authorize a new operation')
    }
  }
  async function keepers(slotId: Hex) {
    const assigned = await chain.readers.keyRegistry.assignedNodes(slotId)
    const nodes = await Promise.all(assigned.map(async operator => {
      const [node, id] = await Promise.all([chain.readers.nodeRegistry.nodeOf(operator), chain.readers.nodeRegistry.operatorIdOf(operator)])
      return {operator, nodeUrl: route(node.url), publicKey: protocolHex(node.pubkey, 32, 'keeper identity key'), id}
    }))
    if (!nodes.length) throw new TasraError('Slot has no assigned keepers')
    if (deployment.coordinator === 'lowest-operator-id') nodes.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    return nodes
  }
  async function authorize(s: SlotMetadata, action: OperationInput['action'], payload: Pick<OperationInput, 'message' | 'identity' | 'payloadDigest'>, options: AuthorizedOperationOptions) {
    options.signal?.throwIfAborted()
    const expectedDigest = payloadDigestFor(action, payload)
    const expected = requestHash(deployment.chainId, protocolHex(s.slotId, 32, 'slot'), action, expectedDigest)
    const grant = structuredClone(await options.authorize(Object.freeze({chainId: deployment.chainId, keyRegistry: deployment.addresses.KeyRegistry!, slotId: s.slotId,
      action, ...payload, message: payload.message?.slice(), payloadDigest: payload.payloadDigest?.slice(),
      description: options.description ?? `Tasra ${action}`, signal: options.signal})))
    options.signal?.throwIfAborted()
    if (grant.token.binding !== 'holder_key' || !Number.isSafeInteger(grant.token.exp) || grant.token.exp * 1000 <= Date.now() ||
      !equalBytes(protocolHex(grant.token.slot_id, 32, 'grant slot'), protocolHex(s.slotId, 32, 'slot')) ||
      !equalBytes(protocolHex(grant.token.request_hash, 32, 'request hash'), expected) || !grant.verifierProofs.length ||
      action === 'ibe-extract' && !equalBytes(protocolHex(grant.token.identity_hash, 32, 'identity hash'), keccak_256(utf8ToBytes(payload.identity!)))) {
      throw new TasraApplicationError('INVALID_AUTHORIZATION', 'Grant must be fresh and holder-bound to this exact operation')
    }
    await unchanged(s)
    options.signal?.throwIfAborted()
    return grant
  }
  return {
    /** Validated configuration for the selected deployment. */
    deployment,
    /** Read-only chain client bound to the selected deployment. */
    chain,
    /** Read-only chain and registry probe. Does not claim keeper/issuer compatibility. */
    async check() {
      await assertChain()
      const entries = await Promise.all((['KeyRegistry', 'NodeRegistry'] as const).map(async name => ({name,
        deployed: ((await chain.client.getCode({address: deployment.addresses[name]!}))?.length ?? 0) > 2})))
      return {chainId: deployment.chainId, registries: entries, ready: entries.every(e => e.deployed),
        authorization: 'unknown' as const, nativeMultiApproverIbe: 'unsupported' as const, taskContextEnforcement: 'unsupported' as const}
    },
    /** Slot metadata reads and capability-specific signing or encryption adapters. */
    slots: {
      get,
      /**
       * Open a ready threshold ECDSA slot for verified Ethereum signatures.
       * @param slotId Identifier of the ECDSA slot.
       */
      async ecdsa(slotId: Hex) {
        await ready(slotId, 2)
        const getAddress = async () => addressFromEoaPubkey(protocolHex((await ready(slotId, 2)).publicKey, 33, 'secp256k1 public key')) as Hex
        return {
          /** Identifier of the threshold ECDSA slot. */
          slotId,
          /** Recheck slot readiness and derive its Ethereum address from the current public key. */
          getAddress,
          /**
           * Authorize and sign an exact 32-byte Ethereum digest, then verify the recovered account.
           * @param input Exactly 32 digest bytes.
           * @param options Fresh operation authorization and cancellation controls.
           */
          async signDigest(input: Uint8Array, options: AuthorizedOperationOptions): Promise<EoaSignature> {
            if (input.length !== 32) throw new TasraError('Ethereum digest must be exactly 32 bytes')
            const digest = input.slice(), s = await ready(slotId, 2)
            const grant = await authorize(s, 'sign', {message: digest}, options), node = (await keepers(slotId))[0]!
            options.signal?.throwIfAborted()
            const result = await committeeSignEoaDigest({nodeUrl: node.nodeUrl, committeeToken: grant.token, verifierProofs: grant.verifierProofs,
              digest, userSignature: options.userSignature, targetKeykeeper: node.operator, signal: options.signal, fetchImpl})
            const publicKey = protocolHex(s.publicKey, 33, 'secp256k1 public key')
            const recovered = await recoverAddress({hash: toHex(digest), signature: {r: toHex(result.r), s: toHex(result.s), yParity: result.yParity}})
            if (!equalBytes(result.groupPublicKey, publicKey) || recovered.toLowerCase() !== addressFromEoaPubkey(publicKey).toLowerCase()) throw new TasraApplicationError('INVALID_RESULT', 'Signature does not match the anchored Ethereum account')
            return result
          },
        }
      },
      /**
       * Open a ready FROST slot for verified Ed25519 signatures and native approvals.
       * @param slotId Identifier of the FROST slot.
       */
      async frost(slotId: Hex) {
        await ready(slotId, 0)
        return {
          /** Identifier of the FROST signing slot. */
          slotId,
          /**
           * Authorize the exact message and verify the returned signature, epoch and optional receipt.
           * @param input Message bytes to sign.
           * @param options Fresh authorization and optional verified-receipt requirement.
           */
          async sign(input: Uint8Array, options: AuthorizedOperationOptions & {requireReceipt?: boolean}) {
            const message = input.slice(), s = await ready(slotId, 0)
            const grant = await authorize(s, 'sign', {message}, options), node = (await keepers(slotId))[0]!
            options.signal?.throwIfAborted()
            const result = await committeeSign({nodeUrl: node.nodeUrl, committeeToken: grant.token, message, verifierProofs: grant.verifierProofs,
              targetKeykeeper: node.operator, userSignature: options.userSignature, signal: options.signal, fetchImpl})
            const publicKey = protocolHex(s.publicKey, 32, 'FROST public key')
            if (!equalBytes(result.groupPublicKey, publicKey) || !equalBytes(result.messageSha256, sha256(message)) || result.epoch !== s.epoch ||
              !equalBytes(protocolHex(result.keySlotId, 32, 'result slot'), protocolHex(slotId, 32, 'slot')) || !verify(publicKey, message, result.signature)) {
              throw new TasraApplicationError('INVALID_RESULT', 'FROST signature does not match the expected slot, epoch or message')
            }
            const hash = compoundTokenHash(decodeCompoundToken(grant.token)), slot = protocolHex(slotId, 32, 'slot')
            const verified = verifyOperationReceipt(result.receipt, {chainId: deployment.chainId, slotId: slot, tokenHash: hash,
              opId: auditOperationId(slot, 'sign', hash, sha256(message)), keeperPublicKey: node.publicKey})
            if (result.receipt && !verified || options.requireReceipt && !verified) throw new TasraApplicationError('INVALID_RESULT', 'Verified keeper receipt required')
            return {...result, receiptStatus: verified ? 'verified' as const : 'absent' as const}
          },
          /** Quorum and approval mode must come from the application's independently pinned policy. */
          async approvals(policy: {quorum: number; credentialGated: boolean}) {
            const s = await ready(slotId, 0), node = (await keepers(slotId))[0]!
            return createDualSignClient({chainId: deployment.chainId, nodeUrl: node.nodeUrl, slotId, groupPublicKey: protocolHex(s.publicKey, 32, 'FROST public key'), ...policy, fetchImpl})
          },
        }
      },
      /**
       * Open a ready BLS slot for identity encryption and authorized extraction.
       * @param slotId Identifier of the BLS slot.
       */
      async bls(slotId: Hex) {
        await ready(slotId, 1)
        const groupKey = (s: SlotMetadata) => {
          if (![194, 290].includes(s.publicKey.length)) throw new TasraError('Invalid anchored BLS public key')
          return protocolHex(s.publicKey, (s.publicKey.length - 2) / 2, 'BLS public key').slice(0, 96)
        }
        const extraction = async (identity: string, options: AuthorizedOperationOptions & {requireReceipts?: boolean}) => {
          const s = await ready(slotId, 1), grant = await authorize(s, 'ibe-extract', {identity}, options)
          const opts: StrictExtractionOptions = {chainId: deployment.chainId, slotId, threshold: s.threshold.k, epoch: s.epoch,
            groupPublicKey: groupKey(s), keepers: await keepers(slotId), shareTrust: 'anchored-group', committeeToken: grant.token,
            verifierProofs: grant.verifierProofs, identity, userSignature: options.userSignature, signal: options.signal, fetchImpl, requireReceipts: options.requireReceipts}
          return opts
        }
        return {
          /** Identifier of the BLS identity-encryption slot. */
          slotId,
          /** Public-key encryption; no credential or network authorization is requested. */
          async encrypt(identity: string, plaintext: Uint8Array) { return ibeEncrypt(groupKey(await ready(slotId, 1)), utf8ToBytes(identity), plaintext) },
          /**
           * Authorize identity-key extraction and decrypt the ciphertext after verifying threshold shares.
           * @param identity Exact encryption identity string.
           * @param ciphertext Encrypted payload bound to that identity.
           * @param options Fresh authorization and optional verified-receipt requirement.
           */
          async decrypt(identity: string, ciphertext: IbeCiphertext, options: AuthorizedOperationOptions & {requireReceipts?: boolean}) {
            return decryptIdentityStrict({...await extraction(identity, options), ciphertext})
          },
          /** Explicit custody: the returned identity key persists independently of token expiry. */
          async extractIdentity(identity: string, options: AuthorizedOperationOptions & {requireReceipts?: boolean}) {
            return extractIdentityStrict(await extraction(identity, options))
          },
        }
      },
    },
  }
}

/**
 * Application client exposing checked slot operations and deployment readiness probes.
 */
export type TasraApplication = ReturnType<typeof createTasra>
/**
 * Threshold Ethereum account handle that verifies each signature against the anchored public key.
 */
export type EcdsaSlot = Awaited<ReturnType<TasraApplication['slots']['ecdsa']>>
/**
 * Threshold Ed25519 signing handle with optional receipt checks and native approval sessions.
 */
export type FrostSlot = Awaited<ReturnType<TasraApplication['slots']['frost']>>
/**
 * Identity-based encryption handle with authorized decryption and explicit identity-key extraction.
 */
export type BlsSlot = Awaited<ReturnType<TasraApplication['slots']['bls']>>
