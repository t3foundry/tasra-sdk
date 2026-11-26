import {equalBytes} from '@noble/curves/utils.js'
import {sha256} from '@noble/hashes/sha256'
import {decryptionBinding, kemContentDigest, type ClientRecipient} from '../crypto/recipient.js'
import {decryptWithCommitteePartials} from '../decryption/sealed.js'
import {keccak_256} from '@noble/hashes/sha3'
import {utf8ToBytes} from '@noble/hashes/utils'
import {recoverAddress, toHex, type Hex} from 'viem'
import {createTasraChainClient, type TasraChainClient} from '../chain/client.js'
import {addressFromEoaPubkey, type EoaSignature} from '../signing/ecdsa.js'
import {verify} from '../crypto/frost.js'
import {kemEncrypt, type Ciphertext} from '../crypto/envelope.js'
import {ibeEncrypt, type IbeCiphertext} from '../crypto/ibe.js'
import {decryptIdentityStrict, extractIdentityStrict, type StrictExtractionOptions} from '../committee/extraction.js'
import {TasraError} from '../errors.js'
import {committeeSign, type VerifierProof} from '../committee/client.js'
import {committeeSignEoaDigest, committeeSignP256Digest, type P256DigestSignature} from '../committee/ecdsa.js'
import {keyRegistryAbi} from '../chain/abis/keyRegistry.js'
import {viemErrorChainHas} from '../internal/viemErrors.js'
import {signingIntentCurve, signingIntentDigest, type EthereumSigningIntent, type P256SigningIntent} from './signing-intents.js'
import {dualOperationPayload, requireDualOperationProof, type DualOperationProof} from '../committee/dual-operation.js'
import {ed25519} from '@noble/curves/ed25519'
import {createDualSignClient} from '../committee/dual-sign.js'
import {auditOperationId, protocolHex, verifyOperationReceipt} from '../committee/receipts.js'
import {compoundTokenHash, decodeCompoundToken, type CompoundTokenWire} from '../committee/token.js'
import {payloadDigestFor, requestHash} from '../oid4vp/binding.js'
import type {OperationInput} from '../oid4vp/verifier-agent.js'
import {defineDeployment, type TasraDeployment} from './deployment.js'
import {resolveKeeperMembers, withNetworkDeadline} from '../internal/network.js'
import {SingleFlight} from '../internal/bounded.js'
import {chainIdOf} from '../chain/chainId.js'

/** Run independent reads together; on failure, surface the error of the first failing read in
 *  argument order, the one a sequential read would have reported. */
async function inOrder<A, B>(first: Promise<A>, second: Promise<B>): Promise<[A, B]> {
  const [a, b] = await Promise.allSettled([first, second])
  if (a.status === 'rejected') throw a.reason
  if (b.status === 'rejected') throw b.reason
  return [a.value, b.value]
}

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
  /** Exact sealed presentation ciphertext for this grant. */
  evidenceCt?: string
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

/** {@link AuthorizedOperationOptions} for a threshold ECDSA digest signature. */
export interface EcdsaSignOptions extends AuthorizedOperationOptions {
  /**
   * The assembled native approval bundle for THIS digest (`prepareOperationApproval`, then
   * `approveDualOperation` or `approveSigningIntent`, then `assembleOperationApproval`). Required
   * by a slot with an approval policy. Checked locally against the chain, slot, key epoch and
   * SHA-256 of the digest before any credential work, and carried in the keeper request unchanged.
   */
  dualControl?: DualOperationProof
}

/** Authorization, receipt requirements and fan-out deadline for a BLS identity operation. */
export interface IdentityExtractionOptions extends AuthorizedOperationOptions {
  /** Client-held recipient (`createDecryptionRecipient`), prepared before authorization. */
  recipient?: ClientRecipient
  /**
   * The assembled native approval bundle for THIS decryption or extraction, required by a slot
   * with an approval policy (`prepareOperationApproval` with the operation's `payloadDigest`).
   */
  dualControl?: DualOperationProof
  /** Independently authenticated public package; 144-byte G2 || G1 per identifier. */
  verifyingShares?: ReadonlyMap<number, Uint8Array>
  /** Require an authenticated receipt from every extraction share used. Default false. */
  requireReceipts?: boolean
  /** Complete keeper extraction deadline in milliseconds, including response bodies. Default 10000. Does not cover the preceding wallet authorization. */
  timeoutMs?: number
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
  // Concurrent operations on one slot share an in-flight `latest` slot read; an answered read is
  // never reused, so every later check (including the post-authorization recheck) reads again.
  const slotReads = new SingleFlight<Awaited<ReturnType<typeof chain.readers.keyRegistry.getKeySlot>>>(1024)
  async function assertChain() {
    if (await chainIdOf(chain.client) !== deployment.chainId) throw new TasraApplicationError('CHAIN_MISMATCH', 'RPC chain does not match the application deployment')
  }
  /**
   * Read slot metadata after checking the deployment chain and slot status.
   * @param slotId Identifier of the slot on this deployment.
   */
  async function get(slotId: Hex): Promise<SlotMetadata> {
    protocolHex(slotId, 32, 'slot id')
    const [, s] = await inOrder(assertChain(), slotReads.run(slotId.toLowerCase(), () => chain.readers.keyRegistry.getKeySlot(slotId)))
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
  async function keepers(slotId: Hex, caller?: AbortSignal) {
    return withNetworkDeadline(async signal => {
      const assigned = await chain.readers.keyRegistry.assignedNodes(slotId)
      const nodes = await resolveKeeperMembers(assigned, async operator => {
        const [node, id] = await Promise.all([chain.readers.nodeRegistry.nodeOf(operator), chain.readers.nodeRegistry.operatorIdOf(operator)])
        return {operator, nodeUrl: route(node.url), publicKey: protocolHex(node.pubkey, 32, 'keeper identity key'), id}
      }, signal)
      if (!nodes.length) throw new TasraError('Slot has no assigned keepers')
      if (deployment.coordinator === 'lowest-operator-id') nodes.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      return nodes
    }, caller)
  }
  // A slot under a native approval policy refuses every signature without its bundle: refuse
  // before any credential or keeper work. A KeyRegistry without the policy has none.
  async function requireNoApprovalPolicy(slotId: Hex) {
    let quorum: number
    try {
      quorum = Number((await chain.client.readContract({address: deployment.addresses.KeyRegistry!, abi: keyRegistryAbi, functionName: 'dualControlPolicy', args: [slotId]}))[0])
    } catch (error) {
      if (viemErrorChainHas(error, ['ContractFunctionRevertedError', 'ContractFunctionZeroDataError'])) return
      throw error
    }
    if (quorum > 0) throw new TasraApplicationError('INVALID_AUTHORIZATION', `Slot requires ${quorum} native approvals for every signature; supply the assembled dualControl bundle`)
  }
  // The keeper's quorum rule, judged against the ON-CHAIN policy before any credential or keeper
  // work: distinct approvers whose signatures verify over the statement, at least the quorum of
  // them, and for a static policy every one in the approver set.
  async function requireBundleMeetsPolicy(slotId: Hex, proof: DualOperationProof) {
    if (!Array.isArray(proof.approvals)) throw new TasraApplicationError('INVALID_AUTHORIZATION', 'The bundle carries no approvals')
    const registry = deployment.addresses.KeyRegistry!
    const [policy, approvers] = await Promise.all([
      chain.client.readContract({address: registry, abi: keyRegistryAbi, functionName: 'dualControlPolicy', args: [slotId]}),
      chain.client.readContract({address: registry, abi: keyRegistryAbi, functionName: 'dualControlApprovers', args: [slotId]}),
    ])
    const quorum = Number(policy[0]), staticSet = /^0x0{64}$/i.test(policy[1]) ? new Set(approvers.map(key => key.slice(2).toLowerCase())) : undefined
    if (quorum === 0) throw new TasraApplicationError('INVALID_AUTHORIZATION', 'Slot has no native approval policy for a bundle to satisfy')
    const payload = dualOperationPayload(proof.statement), seen = new Set<string>()
    for (const approval of proof.approvals) {
      const key = String(approval?.approver_pubkey ?? '').replace(/^0x/, '').toLowerCase(), signature = String(approval?.signature ?? '').replace(/^0x/, '')
      if (!/^[0-9a-f]{64}$/.test(key) || !/^[0-9a-fA-F]{128}$/.test(signature) || !ed25519.verify(signature, payload, key, {zip215: false})) {
        throw new TasraApplicationError('INVALID_AUTHORIZATION', 'An approval does not verify over the statement')
      }
      if (seen.has(key)) throw new TasraApplicationError('INVALID_AUTHORIZATION', 'The bundle names one approver twice')
      if (staticSet && !staticSet.has(key)) throw new TasraApplicationError('INVALID_AUTHORIZATION', 'An approver is not in the slot\'s approver set')
      seen.add(key)
    }
    if (seen.size < quorum) throw new TasraApplicationError('INVALID_AUTHORIZATION', `Slot requires ${quorum} distinct approvals; the bundle has ${seen.size}`)
  }
  async function authorize(s: SlotMetadata, action: OperationInput['action'], payload: Pick<OperationInput, 'message' | 'identity' | 'payloadDigest' | 'decryption'>, options: AuthorizedOperationOptions) {
    options.signal?.throwIfAborted()
    const expectedDigest = payload.decryption ? payload.payloadDigest! : payloadDigestFor(action, payload)
    const expected = requestHash(deployment.chainId, protocolHex(s.slotId, 32, 'slot'), action, expectedDigest)
    const grant = structuredClone(await options.authorize(Object.freeze({chainId: deployment.chainId, keyRegistry: deployment.addresses.KeyRegistry!, slotId: s.slotId,
      action, ...payload, message: payload.message?.slice(), payloadDigest: payload.payloadDigest?.slice(),
      description: options.description ?? `Tasra ${action}`, signal: options.signal})))
    options.signal?.throwIfAborted()
    if (grant.token.binding !== 'holder_key' || !Number.isSafeInteger(grant.token.exp) || grant.token.exp * 1000 <= Date.now() ||
      !equalBytes(protocolHex(grant.token.slot_id, 32, 'grant slot'), protocolHex(s.slotId, 32, 'slot')) ||
      !equalBytes(protocolHex(grant.token.request_hash, 32, 'request hash'), expected) || !grant.verifierProofs.length) {
      throw new TasraApplicationError('INVALID_AUTHORIZATION', 'Grant must be fresh and holder-bound to this exact operation')
    }
    // The network bills metered only: a grant naming a payment is not one this operation asked for.
    const carried = grant.token as unknown as {payment?: unknown; payment_hash?: unknown}
    if (carried.payment != null || carried.payment_hash != null) {
      throw new TasraApplicationError('INVALID_AUTHORIZATION', 'Grant introduced an unexpected payment')
    }
    // Authorization can take long enough for a rotation or expiry: re-read the slot before keeper work.
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
        const adapter = {
          /** Identifier of the threshold ECDSA slot. */
          slotId,
          /** Recheck slot readiness and derive its Ethereum address from the current public key. */
          getAddress,
          /**
           * Authorize and sign an exact 32-byte Ethereum digest, then verify the recovered account.
           * @param input Exactly 32 digest bytes.
           * @param options Fresh operation authorization and cancellation controls.
           */
          async signDigest(input: Uint8Array, options: EcdsaSignOptions): Promise<EoaSignature> {
            if (input.length !== 32) throw new TasraError('Ethereum digest must be exactly 32 bytes')
            const dualControl = options.dualControl && structuredClone(options.dualControl)
            const digest = input.slice(), s = await ready(slotId, 2)
            // Judged before any credential work: the bundle names this chain, slot, key epoch and digest.
            if (dualControl) {
              requireDualOperationProof(dualControl, {chainId: deployment.chainId, operation: 'secp256k1-sign', slot: protocolHex(slotId, 32, 'slot'), payloadDigest: sha256(digest), epoch: s.epoch})
              await requireBundleMeetsPolicy(slotId, dualControl)
            }
            else await requireNoApprovalPolicy(slotId)
            const grant = await authorize(s, 'sign', {message: digest}, options), node = (await keepers(slotId, options.signal))[0]!
            options.signal?.throwIfAborted()
            const result = await committeeSignEoaDigest({nodeUrl: node.nodeUrl, committeeToken: grant.token, evidenceCt: grant.evidenceCt, verifierProofs: grant.verifierProofs,
              digest, userSignature: options.userSignature, targetKeykeeper: node.operator, signal: options.signal, fetchImpl,
              ...(dualControl ? {dualControl, chainId: deployment.chainId} : {})})
            const publicKey = protocolHex(s.publicKey, 33, 'secp256k1 public key')
            const recovered = await recoverAddress({hash: toHex(digest), signature: {r: toHex(result.r), s: toHex(result.s), yParity: result.yParity}})
            if (!equalBytes(result.groupPublicKey, publicKey) || recovered.toLowerCase() !== addressFromEoaPubkey(publicKey).toLowerCase()) throw new TasraApplicationError('INVALID_RESULT', 'Signature does not match the anchored Ethereum account')
            return result
          },
          /**
           * Sign a structured intent (a transaction, EIP-712 typed data or a personal message): the
           * SDK derives the digest itself, then signs it like `signDigest`.
           * @param intent Structured intent; a transaction and typed data must name their chain.
           * @param options Fresh operation authorization and, on a slot with an approval policy, its approvals.
           */
          async signIntent(intent: EthereumSigningIntent, options: EcdsaSignOptions): Promise<EoaSignature & {digest: Uint8Array}> {
            if (signingIntentCurve(intent) !== 'secp256k1') throw new TasraApplicationError('WRONG_SLOT_MODE', 'A secp256k1 slot signs Ethereum intents only')
            const digest = signingIntentDigest(intent)
            return {...await adapter.signDigest(digest, options), digest}
          },
        }
        return adapter
      },
      /**
       * Open a ready threshold P-256 slot for verified P-256 signatures (not an Ethereum account).
       * @param slotId Identifier of the P-256 slot.
       */
      async p256(slotId: Hex) {
        await ready(slotId, 4)
        const getPublicKey = async () => protocolHex((await ready(slotId, 4)).publicKey, 33, 'P-256 public key')
        const signDigest = async (input: Uint8Array, options: EcdsaSignOptions): Promise<P256DigestSignature> => {
          if (input.length !== 32) throw new TasraError('P-256 digest must be exactly 32 bytes')
          const dualControl = options.dualControl && structuredClone(options.dualControl)
          const digest = input.slice(), s = await ready(slotId, 4)
          if (dualControl) {
            requireDualOperationProof(dualControl, {chainId: deployment.chainId, operation: 'p256-sign', slot: protocolHex(slotId, 32, 'slot'), payloadDigest: sha256(digest), epoch: s.epoch})
            await requireBundleMeetsPolicy(slotId, dualControl)
          }
          else await requireNoApprovalPolicy(slotId)
          const grant = await authorize(s, 'sign', {message: digest}, options), node = (await keepers(slotId, options.signal))[0]!
          options.signal?.throwIfAborted()
          // Verifies the signature under the anchored key and refuses any other key.
          return committeeSignP256Digest({nodeUrl: node.nodeUrl, committeeToken: grant.token, evidenceCt: grant.evidenceCt, verifierProofs: grant.verifierProofs,
            digest, groupPublicKey: protocolHex(s.publicKey, 33, 'P-256 public key'), userSignature: options.userSignature, targetKeykeeper: node.operator,
            signal: options.signal, fetchImpl, ...(dualControl ? {dualControl, chainId: deployment.chainId} : {})})
        }
        return {
          /** Identifier of the threshold P-256 slot. */
          slotId,
          /** Recheck slot readiness and return its compressed P-256 group public key. */
          getPublicKey,
          /**
           * Authorize and sign an exact 32-byte digest, verified under the anchored P-256 key.
           * @param input Exactly 32 digest bytes.
           * @param options Fresh operation authorization and, on a slot with an approval policy, its approvals.
           */
          signDigest,
          /**
           * Sign the SHA-256 of exactly `intent.data`: the SDK derives the digest itself.
           * @param intent The bytes to sign.
           * @param options Fresh operation authorization and, on a slot with an approval policy, its approvals.
           */
          async signIntent(intent: P256SigningIntent, options: EcdsaSignOptions): Promise<P256DigestSignature & {digest: Uint8Array}> {
            if (signingIntentCurve(intent) !== 'p256') throw new TasraApplicationError('WRONG_SLOT_MODE', 'A P-256 slot signs sha256 intents only')
            const digest = signingIntentDigest(intent)
            return {...await signDigest(digest, options), digest}
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
            const grant = await authorize(s, 'sign', {message}, options), node = (await keepers(slotId, options.signal))[0]!
            options.signal?.throwIfAborted()
            const result = await committeeSign({nodeUrl: node.nodeUrl, committeeToken: grant.token, evidenceCt: grant.evidenceCt, message, verifierProofs: grant.verifierProofs,
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
            const s = await ready(slotId, 0)
            const node = (await keepers(slotId))[0]!
            return createDualSignClient({chainId: deployment.chainId, nodeUrl: node.nodeUrl, slotId, groupPublicKey: protocolHex(s.publicKey, 32, 'FROST public key'),
              quorum: policy.quorum, credentialGated: policy.credentialGated, fetchImpl})
          },
        }
      },
/**
       * Open a ready BLS slot for KEM key wrapping and committee-authorized unwrapping.
       * @param slotId Identifier of the BLS slot.
       */
      async bls(slotId: Hex) {
        await ready(slotId, 1)
        const groupKey = (s: SlotMetadata) => {
          if (![194, 290].includes(s.publicKey.length)) throw new TasraError('Invalid anchored BLS public key')
          return protocolHex(s.publicKey, (s.publicKey.length - 2) / 2, 'BLS public key').slice(0, 96)
        }
        // A supplied bundle is judged before any credential work: it names this chain, slot, key
        // epoch and recipient-bound digest, and meets the slot's on-chain policy.
        const approvalBundle = async (s: SlotMetadata, operation: 'kem-decrypt' | 'ibe-extract', payloadDigest: Uint8Array, supplied?: DualOperationProof) => {
          if (!supplied) return undefined
          const proof = structuredClone(supplied)
          requireDualOperationProof(proof, {chainId: deployment.chainId, operation, slot: protocolHex(slotId, 32, 'slot'), payloadDigest, epoch: s.epoch})
          await requireBundleMeetsPolicy(slotId, proof)
          return proof
        }
        const extraction = async (identity: string, options: IdentityExtractionOptions) => {
          options.signal?.throwIfAborted()
          if (!options.recipient || !options.verifyingShares) throw new TasraError('Client recipient and authenticated public sharing required before extraction authorization')
          const s = await ready(slotId, 1)
          const binding = decryptionBinding(sha256(utf8ToBytes(identity)), s.epoch, options.recipient)
          const dualControl = await approvalBundle(s, 'ibe-extract', binding.payloadDigest, options.dualControl)
          const grant = await authorize(s, 'ibe-extract', {identity, ...binding}, options)
          const opts: StrictExtractionOptions = {chainId: deployment.chainId, slotId, threshold: s.threshold.k, epoch: s.epoch,
            recipient: options.recipient, verifyingShares: options.verifyingShares,
            groupPublicKey: groupKey(s), keepers: await keepers(slotId, options.signal), shareTrust: 'anchored-group', committeeToken: grant.token, evidenceCt: grant.evidenceCt,
            verifierProofs: grant.verifierProofs, identity, userSignature: options.userSignature, signal: options.signal, fetchImpl, requireReceipts: options.requireReceipts, timeoutMs: options.timeoutMs,
            ...(dualControl ? {dualControl} : {})}
          return opts
        }
        return {
          /** Identifier of the BLS key-encryption slot. */
          slotId,
          /**
           * BLS KEM-wrap a symmetric data key. Local — no credential or network round-trip needed.
           * @param aad Additional authenticated data binding the key to an application scope.
           * @param dataKey 32-byte symmetric key to wrap under the slot's group public key.
           */
          async encrypt(aad: Uint8Array, dataKey: Uint8Array) {
            return kemEncrypt(groupKey(await ready(slotId, 1)), aad, dataKey)
          },
          /**
           * Authorize and recover the KEM-wrapped symmetric key from verified, recipient-sealed threshold shares.
           * @param aad Original authenticated data from encryption.
           * @param kemCt BLS KEM ciphertext wrapping the symmetric key.
           * @param options Fresh authorization and optional verified-receipt requirement.
           */
          async decrypt(aad: Uint8Array, kemCt: Ciphertext, options: IdentityExtractionOptions) {
            // Recipient-bound partial decryption: keepers return sealed shares and the client verifies
            // and combines them. Keeper-side custody decryption (`/v1/committee/decrypt`) is retired
            // under the production runtime policy, so this path is the only one a production keeper serves.
            options.signal?.throwIfAborted()
            if (!options.recipient || !options.verifyingShares) throw new TasraError('Client recipient and authenticated public sharing required before decryption authorization')
            const s = await ready(slotId, 1)
            const binding = decryptionBinding(kemContentDigest(kemCt, aad), s.epoch, options.recipient)
            const dualControl = await approvalBundle(s, 'kem-decrypt', binding.payloadDigest, options.dualControl)
            const grant = await authorize(s, 'decrypt', binding, options)
            const nodes = await keepers(slotId, options.signal)
            const plaintext = await decryptWithCommitteePartials({nodeUrls: nodes.map(k => k.nodeUrl), chainId: deployment.chainId,
              committeeToken: grant.token, recipient: options.recipient, ciphertextEpoch: s.epoch, verifyingShares: options.verifyingShares,
              threshold: s.threshold.k, verifierProofs: grant.verifierProofs, userSignature: options.userSignature, evidenceCt: grant.evidenceCt,
              signal: options.signal, fetchImpl, ciphertext: kemCt, identity: aad, ...(dualControl ? {dualControl} : {})})
            return {plaintext, shareTrust: 'anchored-group' as const}
          },
          /**
           * Identity-based encryption (IBE) to an identity string, such as a patient or document id.
           * Public-key encryption; no credential or network authorization is requested.
           * @param identity Exact identity string the ciphertext is bound to.
           * @param plaintext Bytes to encrypt.
           */
          async encryptForIdentity(identity: string, plaintext: Uint8Array) { return ibeEncrypt(groupKey(await ready(slotId, 1)), utf8ToBytes(identity), plaintext) },
          /**
           * Authorize identity-key extraction and decrypt an IBE ciphertext after verifying threshold shares.
           * @param identity Exact encryption identity string.
           * @param ciphertext Encrypted payload bound to that identity.
           * @param options Fresh authorization and optional verified-receipt requirement.
           */
          async decryptForIdentity(identity: string, ciphertext: IbeCiphertext, options: IdentityExtractionOptions) {
            return decryptIdentityStrict({...await extraction(identity, options), ciphertext})
          },
          /**
           * Authorize and extract the identity's IBE private key.
           * Explicit custody: the returned identity key persists independently of token expiry.
           * @param identity Exact encryption identity string.
           * @param options Fresh authorization and optional verified-receipt requirement.
           */
          async extractIdentityKey(identity: string, options: IdentityExtractionOptions) {
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
/** A ready threshold P-256 slot adapter returned by `app.slots.p256(slotId)`. */
export type P256Slot = Awaited<ReturnType<TasraApplication['slots']['p256']>>
/**
 * Threshold Ed25519 signing handle with optional receipt checks and native approval sessions.
 */
export type FrostSlot = Awaited<ReturnType<TasraApplication['slots']['frost']>>
/**
 * BLS slot handle: KEM key wrapping (encrypt/decrypt) and identity-based encryption (encryptForIdentity/decryptForIdentity/extractIdentityKey), each decrypted from verified threshold shares.
 */
export type BlsSlot = Awaited<ReturnType<TasraApplication['slots']['bls']>>
