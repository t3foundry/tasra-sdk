import {evidenceBody} from '../committee/evidence.js'
import {withKeeperExecutionApprovals, type KeeperExecutionApprover} from '../committee/keeperExecution.js'
import {readIbeReply} from '../committee/client.js'
import {decodeOperationReceipt, type OperationReceipt} from '../committee/receipts.js'
import {withNetworkDeadline} from '../internal/network.js'
import {sha256} from '@noble/hashes/sha256'
import {base64Decode, base64Encode} from '../crypto/envelope.js'
import {bytesToHex} from '../crypto/hex.js'
import {combineDecryptShares, verifyDecryptShare, type Ciphertext, type DecryptShare} from '../crypto/kem.js'
import {ibeVerifyShare} from '../crypto/ibe.js'
import {checkedDecryptionRequestHash, kemContentDigest, recipientPayloadDigest, type ClientRecipient, type SealedShareWire} from '../crypto/recipient.js'
import type {CompoundTokenWire} from '../committee/token.js'
import type {VerifierProof} from '../committee/client.js'
import {httpError} from '../errors.js'

/** Recipient-bound authorization and independently authenticated keeper quorum for local decryption. */
export interface SealedRequestOpts {
  /** Client-owned exact-body approval capability, required for paid contributions. */
  approveExecution?: KeeperExecutionApprover
  /** Cancel the complete fan-out, including approvals and response bodies. */
  signal?: AbortSignal
  /** Guarded HTTP transport; defaults to global fetch. */
  fetchImpl?: typeof fetch
  /** Distinct keeper endpoints resolved from the assigned operator roster. */
  nodeUrls: string[]
  /** Deployment chain identifier included in the signed request binding. */
  chainId: number | bigint
  /** Holder authorization bound to this content, recipient, slot, chain and action. */
  committeeToken: CompoundTokenWire
  /** Original client-held recipient created before requesting authorization. */
  recipient: ClientRecipient
  /** Canonical key epoch authorized for the ciphertext. */
  ciphertextEpoch: number
  /** Authenticate this package against the slot's published commitment before use.
   * Keys are keeper identifiers, values are 144-byte G2 || G1 verifying shares. */
  verifyingShares: ReadonlyMap<number, Uint8Array>
  /** Required number of distinct authenticated and pairing-verified contributions. */
  threshold: number
  /** Registry membership proofs for the token's anchored verifier snapshot. */
  verifierProofs?: VerifierProof[]
  /** Optional assigned operator address pinned by the operation policy. */
  targetKeykeeper?: string
  /** Slot-owner signature over the canonical KEM request when required by slot policy. */
  userSignature?: Uint8Array
  /** Original sealed credential evidence associated with the compound token. */
  evidenceCt?: string
  /** Use the same id when producing the KEM owner signature. */
  requestId?: string
}
/** Locally opened and verified contribution. Clear its value after combining or discarding it. */
export interface SealedPartial {
  /** Validated operation receipt when the keeper includes one. */
  receipt?: OperationReceipt
  /** Distinct BLS participant identifier. */
  identifier: number
  /** Sensitive unsealed contribution, held only on the client. */
  value: Uint8Array
  /** Independently authenticated 144-byte G2 || G1 public verifying share. */
  verifyingShare: Uint8Array
  /** Authorized canonical key epoch. */
  epoch: number
  /** Endpoint from which this verified contribution was received. */
  nodeUrl: string
}

/** Collect the first threshold of distinct, locally opened and verified contributions.
 * The whole fan-out is bounded to 15 seconds. Outstanding reads are cancelled at quorum;
 * invalid, duplicate and late contributions are cleared. The caller owns returned values.
 * @param opts - Original recipient-bound grant, trusted public shares and assigned endpoints.
 * @param action - KEM decryption or IBE extraction; must match the signed token binding.
 * @param identity - Original UTF-8 identity bytes bound by authorization.
 * @param ciphertext - Complete KEM ciphertext, required for the decrypt action.
 */
export async function collectSealedPartials(opts: SealedRequestOpts, action: 'decrypt' | 'ibe-extract', identity: Uint8Array, ciphertext?: Ciphertext): Promise<SealedPartial[]> {
  return withNetworkDeadline(signal => collectWithinDeadline({...opts, signal}, action, identity, ciphertext), opts.signal)
}
async function collectWithinDeadline(opts: SealedRequestOpts, action: 'decrypt' | 'ibe-extract', identity: Uint8Array, ciphertext?: Ciphertext): Promise<SealedPartial[]> {
  if (!opts.recipient || !opts.verifyingShares || opts.nodeUrls.length === 0 || !Number.isInteger(opts.threshold) || opts.threshold < 1 || opts.threshold > opts.verifyingShares.size || opts.threshold > opts.nodeUrls.length) throw new Error('recipient, authenticated verifying shares, keeper URLs and a valid threshold are required')
  opts={...opts,nodeUrls:[...opts.nodeUrls],committeeToken:structuredClone(opts.committeeToken),verifyingShares:new Map([...opts.verifyingShares].map(([id,share])=>[id,share.slice()]))}
  if(new Set(opts.nodeUrls.map(u=>u.replace(/\/$/,''))).size!==opts.nodeUrls.length)throw new Error('duplicate sealed keeper endpoint')
  opts.signal?.throwIfAborted()
  const content = action === 'decrypt' ? kemContentDigest(ciphertext!, identity) : sha256(identity)
  const digest = recipientPayloadDigest(content, opts.ciphertextEpoch, opts.recipient.recipient)
  const hash = checkedDecryptionRequestHash(opts.chainId, opts.committeeToken.slot_id, action, digest, opts.committeeToken.request_hash)
  // Refuse lossy UTF-8 conversion: the request must bind the same identity bytes.
  const textIdentity = new TextDecoder('utf-8', {fatal: true}).decode(identity)
  const controller = new AbortController()
  const requests = opts.nodeUrls.map(async nodeUrl => {
    const url = `${nodeUrl.replace(/\/$/, '')}${action === 'decrypt' ? '/v1/committee/decrypt/partial' : '/v1/shards/ibe/extract'}`
    let body: Record<string, unknown> = {
      committee_token: opts.committeeToken, identity: textIdentity,
      recipient: opts.recipient.recipient, ciphertext_epoch: opts.ciphertextEpoch,
      ...(ciphertext ? {ciphertext: {u: base64Encode(ciphertext.u), nonce: base64Encode(ciphertext.nonce), aead_ct: base64Encode(ciphertext.aeadCt)}} : {}),
      ...evidenceBody(opts.committeeToken, opts.evidenceCt),
      ...(opts.targetKeykeeper?{target_keykeeper:opts.targetKeykeeper.replace(/^0x/,'')}:{}),
      ...(opts.userSignature ? {user_signature: bytesToHex(opts.userSignature).replace(/^0x/,'')} : {}),
      ...(opts.verifierProofs ? {verifier_proofs: opts.verifierProofs.map(p => ({verifier_index: p.verifierIndex, operator: p.operator.replace(/^0x/,''), pubkey: p.pubkey.replace(/^0x/,''), proof: p.proof.map(h=>h.replace(/^0x/,''))}))} : {}),
    }
    body=await withKeeperExecutionApprovals({body,kind:action==='decrypt'?'sealed-decrypt':'ibe-extract',nodeUrl,payment:opts.committeeToken.payment,approveExecution:opts.approveExecution,signal:opts.signal})
    opts.signal?.throwIfAborted()
    const res = await (opts.fetchImpl??fetch)(url, {method: 'POST', headers: {'Content-Type': 'application/json', ...(opts.requestId ? {'x-request-id': opts.requestId} : {})}, body: JSON.stringify(body), signal: AbortSignal.any([controller.signal,opts.signal!]),...(opts.committeeToken.payment?{redirect:'error' as const,credentials:'omit' as const}:{})})
    const text=await readIbeReply(res,opts.signal)
    opts.signal?.throwIfAborted()
    if (!res.ok) throw await httpError(new Response(text,{status:res.status}), url, 'sealed partial')
    const d = JSON.parse(text) as {identifier: number; epoch: number; key_slot_id: string; verifying_share: string; sealed_share: SealedShareWire; op_id?: unknown; token_hash?: unknown; op_attestation?: unknown}
    if (d.epoch !== opts.ciphertextEpoch || d.key_slot_id.replace(/^0x/, '').toLowerCase() !== opts.committeeToken.slot_id.replace(/^0x/, '').toLowerCase()) throw new Error('keeper returned another slot or epoch')
    const vs = opts.verifyingShares.get(d.identifier)
    const supplied = base64Decode(d.verifying_share)
    if (!vs || vs.length !== 144 || supplied.length !== 144 || !vs.every((b, i) => b === supplied[i])) throw new Error('keeper verifying share differs from authenticated package')
    const value = await opts.recipient.open(d.sealed_share, hash, d.identifier, d.epoch, vs)
    try {
      if (action === 'decrypt') {
        if (value.length !== 96 || !verifyDecryptShare({id: d.identifier, decryptionShare: value, verifyingShare: vs}, ciphertext!.u)) throw new Error('invalid KEM partial')
      } else {
        ibeVerifyShare(new Map([[d.identifier, vs.slice(0, 96)]]), identity, {identifier: d.identifier, value})
      }
      return {...(decodeOperationReceipt(d)?{receipt:decodeOperationReceipt(d)}:{}),identifier: d.identifier, value, verifyingShare: vs, epoch: d.epoch, nodeUrl}
    } catch (e) {value.fill(0); throw e}
  })
  const valid = new Map<number, SealedPartial>()
  const errors: string[] = []
  // Return at the first threshold of verified, distinct replies. A slow or
  // malicious keeper must not delay a successful operation. Wipe late arrivals.
  return new Promise<SealedPartial[]>((resolve, reject) => {
    let remaining = requests.length
    let done = false
    const cancelled=()=>{if(done)return;done=true;controller.abort();for(const p of valid.values())p.value.fill(0);reject(opts.signal?.reason)}
    opts.signal?.addEventListener('abort',cancelled,{once:true})
    const finish = () => {
      if (valid.size >= opts.threshold) {
        done = true
        opts.signal?.removeEventListener('abort',cancelled)
        controller.abort()
        resolve([...valid.values()])
      } else if (remaining + valid.size < opts.threshold) {
        done = true
        opts.signal?.removeEventListener('abort',cancelled)
        controller.abort()
        for (const p of valid.values()) p.value.fill(0)
        reject(new Error(`sealed partial threshold not met (${valid.size}/${opts.threshold}): ${errors.join('; ')}`))
      }
    }
    if(opts.signal?.aborted)cancelled()
    for (const request of requests) void request.then(p => {
      remaining--
      if (done) {p.value.fill(0); return}
      if (valid.has(p.identifier)) p.value.fill(0)
      else valid.set(p.identifier, p)
      finish()
    }, error => {
      remaining--
      if (done) return
      errors.push(String(error))
      finish()
    })
  })
}

/** Collect and combine recipient-sealed KEM contributions locally, then clear all partials.
 * Servers receive only the authorized public recipient and never the recovered plaintext.
 * @param opts - Recipient-bound quorum settings, complete ciphertext and original identity bytes.
 */
export async function decryptWithCommitteePartials(opts: SealedRequestOpts & {ciphertext: Ciphertext; identity: Uint8Array}): Promise<Uint8Array> {
  const partials = await collectSealedPartials(opts, 'decrypt', opts.identity, opts.ciphertext)
  const shares: DecryptShare[] = partials.map(p => ({id: p.identifier, decryptionShare: p.value, verifyingShare: p.verifyingShare}))
  try {return combineDecryptShares(shares, opts.ciphertext, opts.identity, {verify: true})}
  finally {for (const p of partials) p.value.fill(0)}
}
