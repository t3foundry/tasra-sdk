import {ed25519} from '@noble/curves/ed25519'
import {equalBytes} from '@noble/curves/utils.js'
import {sha256} from '@noble/hashes/sha256'
import {encodeFunctionData, keccak256, toHex, type Hex} from 'viem'
import {validate} from '../auth/oid4vp.js'
import {keyRegistryAbi} from '../chain/abis/index.js'
import {dualSignApprovalPayload, type DualSignApprover, type DualSignRequest} from '../committee/dual-sign.js'
import {protocolHex} from '../committee/receipts.js'
import {b64urlDecode} from '../oid4vp/jose.js'
import type {TasraApplication, OperationAuthorizer} from './client.js'
import {signingIntentDigest, type SigningIntent} from './signing-intents.js'
import type {TasraIdentity} from './identity.js'
import type {ApplicationStore} from './ready-slot.js'
import type {TasraWallet, WalletTransactionJournal} from './wallet.js'
import {TasraApplicationError} from './client.js'
import {assembleDualOperation, prepareDualOperation, type DualOperationApprovalRecord, type DualOperationKind, type DualOperationProof,
  type PreparedDualOperation} from '../committee/dual-operation.js'

/**
 * Required approval count and either trusted Ed25519 keys or a credential rule.
 */
export interface ApprovalPolicy {
  /**
   * Minimum distinct approvals required to complete a signing request.
   */
  quorum: number
  /** Static Ed25519 approver keys. Use either this list or a credential policy. */
  approvers?: readonly Uint8Array[]
  /** Exact raw DCQL rule whose unsalted hash the network must enforce. */
  credentialPolicy?: string
}

/** A slot's installed native approval policy, as `KeyRegistry` holds it. */
export interface InstalledApprovalPolicy {
  /** Required distinct approvals; 0 means no policy is installed. */
  quorum: number
  /** keccak256 of the raw credential rule, or zero for static approvers. */
  ruleHash: Hex
  /** Static Ed25519 approver keys (lowercase hex), empty for a credential policy. */
  approvers: Hex[]
}

/** The policy was already on chain exactly as requested: nothing was sent (the policy is set-once). */
export interface ApprovalPolicyAlreadyInstalled {
  /** Nothing was sent: the requested policy is the installed one. */
  phase: 'already-installed'
  /** The slot whose policy was found installed. */
  slotId: Hex
  /** No transaction: kept so code reading `.hash` of a journal still compiles. */
  hash?: undefined
}

/** Key modes the network enforces operation approvals on: FROST (collector), BLS (KEM/IBE), secp256k1 and P-256 tECDSA. */
const POLICY_MODES = [0, 1, 2, 4]
const ZERO32 = `0x${'00'.repeat(32)}` as Hex

/**
 * Read a slot's native approval policy (`KeyRegistry.dualControlPolicy` / `dualControlApprovers`).
 * @param app Application client for the slot deployment.
 * @param slotId Slot to read.
 */
export async function readApprovalPolicy(app: Pick<TasraApplication, 'deployment' | 'chain'>, slotId: Hex): Promise<InstalledApprovalPolicy> {
  protocolHex(slotId, 32, 'slot id')
  const registry = app.deployment.addresses.KeyRegistry!
  const [policy, keys] = await Promise.all([
    app.chain.client.readContract({address: registry, abi: keyRegistryAbi, functionName: 'dualControlPolicy', args: [slotId]}),
    app.chain.client.readContract({address: registry, abi: keyRegistryAbi, functionName: 'dualControlApprovers', args: [slotId]}),
  ])
  return {quorum: Number(policy[0]), ruleHash: policy[1].toLowerCase() as Hex, approvers: keys.map(key => key.toLowerCase() as Hex)}
}

function samePolicy(observed: InstalledApprovalPolicy, quorum: number, ruleHash: Hex, keys: readonly Hex[]): boolean {
  const expected = keys.map(key => key.toLowerCase()).sort(), actual = [...observed.approvers].sort()
  return observed.quorum === quorum && observed.ruleHash === ruleHash.toLowerCase()
    && expected.length === actual.length && expected.every((key, i) => key === actual[i])
}

/** A ready slot in a mode the network enforces approvals on; the same errors `app.slots.frost` gave. */
async function policySlot(app: Pick<TasraApplication, 'slots'>, slotId: Hex) {
  const slot = await app.slots.get(slotId)
  if (!POLICY_MODES.includes(slot.mode)) throw new TasraApplicationError('WRONG_SLOT_MODE', `Slot mode ${slot.mode} does not support native approvals`)
  if (!slot.ready) throw new TasraApplicationError('KEY_NOT_READY', 'Slot key generation has not completed')
  return slot
}

/**
 * Install an explicit native approval policy using a durable named transaction, on a FROST, BLS or
 * threshold ECDSA (secp256k1 or P-256) slot. The slot creator's wallet sends it
 * (`KeyRegistry.setDualControlPolicy`); no slot-key signature is involved. The policy is SET-ONCE:
 * an identical policy already on chain resolves `already-installed` without sending, a different
 * one refuses before sending. A transaction whose outcome was unknown is reconciled by calling this
 * again with the same name (the wallet's journal), never by a replacement.
 * @param app Application client for the slot deployment.
 * @param slotId Slot whose approval policy is being installed.
 * @param input Required quorum and either approver keys or a credential rule.
 * @param options Creator wallet and durable store for the named policy transaction.
 */
export async function setApprovalPolicy(app: Pick<TasraApplication, 'deployment' | 'chain' | 'slots'>, slotId: Hex,
  input: ApprovalPolicy, options: {wallet: TasraWallet; store: ApplicationStore; name?: string}): Promise<WalletTransactionJournal | ApprovalPolicyAlreadyInstalled> {
  protocolHex(slotId, 32, 'slot id')
  const {quorum, credentialPolicy} = input, approvers = input.approvers?.map(key => key.slice())
  const {wallet, store} = options, name = options.name ?? `approval-${slotId.slice(2)}`
  if (!Number.isSafeInteger(quorum) || quorum < 1 || quorum > 65535) throw new Error('Invalid approval quorum')
  if ((approvers !== undefined) === (credentialPolicy !== undefined)) throw new Error('Choose static approvers or a credential policy')
  if (approvers && (quorum > approvers.length || approvers.some(key => key.length !== 32) || new Set(approvers.map(key => toHex(key))).size !== approvers.length)) throw new Error('Approval keys must be distinct and satisfy the quorum')
  for (const key of approvers ?? []) {
    const point = ed25519.Point.fromHex(key, false)
    if (point.isSmallOrder() || !point.isTorsionFree()) throw new Error('Approval keys must be prime-order Ed25519 points')
  }
  if (credentialPolicy !== undefined) validate(credentialPolicy)
  const ruleHash = credentialPolicy === undefined ? ZERO32 : keccak256(toHex(credentialPolicy))
  const keys = (approvers ?? []).map(key => toHex(key))
  const data = encodeFunctionData({abi: keyRegistryAbi, functionName: 'setDualControlPolicy', args: [slotId, quorum, ruleHash, keys]})
  await policySlot(app, slotId)
  if (wallet.wallet.chain.id !== app.deployment.chainId) throw new Error('Approval wallet uses a different chain')
  // Set-once: judge what is on chain before anything is signed or sent.
  const before = await readApprovalPolicy(app, slotId)
  if (before.quorum !== 0) {
    if (samePolicy(before, quorum, ruleHash, keys)) return {phase: 'already-installed', slotId}
    throw new Error('A different approval policy is already installed on this slot; policies are set-once')
  }
  const transaction = await wallet.transfer(name, {to: app.deployment.addresses.KeyRegistry!, data}, store)
  const observed = await readApprovalPolicy(app, slotId)
  if (observed.quorum !== quorum || observed.ruleHash !== ruleHash.toLowerCase()) throw new Error('On-chain approval policy differs from the requested policy')
  if (!samePolicy(observed, quorum, ruleHash, keys)) throw new Error('On-chain approval keys differ from the requested policy')
  return transaction
}

/**
 * Adapt an SDK Ed25519 identity to native approval signatures without exporting its key.
 * @param identity Live Ed25519 identity used to sign approval payloads.
 * @returns Approver adapter exposing the public key and signing callback.
 */
export function identityApprover(identity: TasraIdentity): DualSignApprover {
  if (identity.algorithm !== 'Ed25519') throw new Error('Native approval requires an Ed25519 identity')
  const publicKey = b64urlDecode(identity.holder.publicJwk.x!)
  return {publicKey: publicKey.slice(), async sign(payload) {
    const secret = identity.exportPrivateKey()
    try {
      if (!equalBytes(ed25519.getPublicKey(secret), publicKey)) throw new Error('Approval identity key changed')
      return ed25519.sign(payload, secret)
    } finally {secret.fill(0)}
  }}
}

/**
 * Present a credential for this exact request, then sign its canonical approval payload.
 * @param app Application client for the request deployment.
 * @param request Native signing request awaiting an approval.
 * @param message Exact document bytes identified by the request.
 * @param options Approver identity, credential authorizer and cancellation controls.
 */
export async function approveWithCredential(app: Pick<TasraApplication, 'deployment' | 'slots'>, request: DualSignRequest,
  message: Uint8Array, options: {identity: TasraIdentity; authorize: OperationAuthorizer; signal?: AbortSignal; description?: string}) {
  const {identity, authorize, signal, description} = options
  const slotId = request.slotId as Hex
  const canonical = dualSignApprovalPayload(slotId, message.slice(), request.requestId)
  signal?.throwIfAborted()
  const current = await request.status({signal})
  if (current.status !== 'pending') return current
  const signer = identityApprover(identity)
  signal?.throwIfAborted()
  await app.slots.frost(slotId)
  const authorization = await authorize({chainId: app.deployment.chainId, keyRegistry: app.deployment.addresses.KeyRegistry!,
    slotId, action: 'dual-approve', payloadDigest: sha256(canonical), description: description ?? 'Approve exact document request', signal})
  signal?.throwIfAborted()
  return request.approve({signer, authorization, signal})
}

/** The operation a slot mode's approvals name: FROST signs through the keeper's collector instead. */
function operationKind(mode: number, identity: string | undefined): DualOperationKind {
  if (mode === 2 && identity === undefined) return 'secp256k1-sign'
  if (mode === 4 && identity === undefined) return 'p256-sign'
  if (mode === 1) return identity === undefined ? 'kem-decrypt' : 'ibe-extract'
  if (mode === 0) throw new TasraApplicationError('WRONG_SLOT_MODE', 'FROST signatures collect approvals through slot.approvals(), not an operation bundle')
  throw new TasraApplicationError('WRONG_SLOT_MODE', `Slot mode ${mode} has no operation approvals for this request`)
}

/**
 * Prepare the approval statement for ONE operation (a threshold ECDSA or P-256 signature, a KEM
 * decrypt or an IBE extraction), bound to the chain, slot, payload digest, key epoch and the
 * operation's request hash, current for at most 300 s. Reads the slot (mode, epoch, readiness) and
 * the policy; sends nothing. Hand the result to each approver (`approveDualOperation` or
 * `approveSigningIntent`), then assemble.
 * @param app Application client for the slot deployment.
 * @param input The slot and what it will run: a signing `intent` or the 32-byte `digest` to sign
 *   (ECDSA and P-256 slots), or the operation's `payloadDigest` (the recipient-bound digest of a
 *   KEM decrypt or IBE extraction); the IBE identity; and the lifetime.
 */
export async function prepareOperationApproval(app: Pick<TasraApplication, 'deployment' | 'chain' | 'slots'>,
  input: {slotId: Hex; intent?: SigningIntent; digest?: Uint8Array; payloadDigest?: Uint8Array; identity?: string; ttlSecs?: number; nowSecs?: number}): Promise<PreparedDualOperation> {
  const slotId = toHex(protocolHex(input.slotId, 32, 'slot id'))
  if ([input.intent, input.digest, input.payloadDigest].filter(v => v !== undefined).length !== 1) throw new TasraApplicationError('INVALID_AUTHORIZATION', 'Name the operation by exactly one of intent, digest or payloadDigest')
  const signed = input.intent !== undefined ? signingIntentDigest(input.intent) : input.digest
  if (signed !== undefined && signed.length !== 32) throw new TasraApplicationError('INVALID_AUTHORIZATION', 'A signing digest is exactly 32 bytes')
  // A signature's payload digest is SHA-256 of the digest the slot signs (the keeper's own derivation).
  const payloadDigest = signed !== undefined ? sha256(signed) : input.payloadDigest!
  if (payloadDigest.length !== 32) throw new TasraApplicationError('INVALID_AUTHORIZATION', 'A payload digest is exactly 32 bytes')
  const [slot, policy] = await Promise.all([policySlot(app, slotId), readApprovalPolicy(app, slotId)])
  if (policy.quorum === 0) throw new TasraApplicationError('INVALID_AUTHORIZATION', 'Slot has no native approval policy')
  const operation = operationKind(slot.mode, input.identity)
  if ((signed !== undefined) !== (operation === 'secp256k1-sign' || operation === 'p256-sign')) throw new TasraApplicationError('WRONG_SLOT_MODE', `Slot mode ${slot.mode} does not run this operation`)
  return prepareDualOperation({chainId: app.deployment.chainId, slot: slotId, payloadDigest, operation, epoch: slot.epoch,
    ...(input.identity !== undefined ? {identity: input.identity} : {}), ...(input.ttlSecs !== undefined ? {ttlSecs: input.ttlSecs} : {}),
    ...(input.nowSecs !== undefined ? {nowSecs: input.nowSecs} : {})})
}

/**
 * Assemble independent approvals of one prepared statement into the `dual_control` bundle, judged
 * against the slot's ON-CHAIN policy before anything is sent: its quorum, and for a static policy every
 * approver's membership. Signatures verify strictly; duplicates and approvals of another statement
 * refuse. The keeper and every ECDSA member re-check all of it.
 * @param app Application client for the slot deployment.
 * @param input Prepared statement and approval records.
 */
export async function assembleOperationApproval(app: Pick<TasraApplication, 'deployment' | 'chain'>,
  input: {prepared: PreparedDualOperation; approvals: DualOperationApprovalRecord[]; nowSecs?: number}): Promise<DualOperationProof> {
  const slotId = toHex(Uint8Array.from(input.prepared.statement.slot))
  const policy = await readApprovalPolicy(app, slotId)
  if (policy.quorum === 0) throw new TasraApplicationError('INVALID_AUTHORIZATION', 'Slot has no native approval policy')
  if (policy.ruleHash === ZERO32) {
    const members = new Set(policy.approvers.map(key => key.slice(2)))
    for (const record of input.approvals) {
      if (!members.has(String(record.approval?.approver_pubkey ?? '').replace(/^0x/, '').toLowerCase())) throw new TasraApplicationError('INVALID_AUTHORIZATION', 'Approver is not in the slot\'s approver set')
    }
  } else if (input.approvals.some(record => record.approval?.committee_token === undefined)) {
    throw new TasraApplicationError('INVALID_AUTHORIZATION', 'Credential-gated approvals need each approver\'s holder-bound grant')
  }
  return assembleDualOperation({prepared: input.prepared, approvals: input.approvals, quorum: policy.quorum, ...(input.nowSecs !== undefined ? {nowSecs: input.nowSecs} : {})})
}
