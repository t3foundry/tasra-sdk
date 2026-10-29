import {ed25519} from '@noble/curves/ed25519'
import {bls12_381} from '@noble/curves/bls12-381'
import {keccak_256} from '@noble/hashes/sha3'
import {concatBytes, utf8ToBytes} from '@noble/hashes/utils'
import {equalBytes} from '@noble/curves/utils.js'
import {verifyDecryptShare} from '../crypto/kem.js'
import {withNetworkDeadline, resolveKeeperMembers} from '../internal/network.js'
import {readIbeReply} from './client.js'
import {protocolHex} from './receipts.js'

/** Assigned operator and transport identity established independently from NodeRegistry. */
export interface BlsSharingKeeper {
  /** On-chain operator address; two URLs cannot count as different operators. */
  operator: string
  /** Independently resolved keeper endpoint, with any caller-approved route mapping applied. */
  nodeUrl: string
  /** Registered Ed25519 operator identity key, never taken from the HTTP reply. */
  publicKey: Uint8Array
}

/** Canonical slot sharing and assigned identities to authenticate before requesting contributions. */
export interface BlsSharingOptions {
  /** Deployment chain ID. */
  chainId: number | bigint
  /** Original 32-byte slot identifier. */
  slotId: string
  /** Key epoch read independently from the canonical slot or reserved payment. */
  epoch: number
  /** Sharing version read independently; reshares can change it without changing the epoch. */
  committeeVersion: number
  /** Required number of distinct assigned operators. */
  threshold: number
  /** Assigned operators with registry-authenticated identity keys. */
  keepers: readonly BlsSharingKeeper[]
  /** Optional guarded transport, also used by applications with mapped keeper routes. */
  fetchImpl?: typeof fetch
  /** Allow loopback HTTP for disposable local chain43112 only. Default false. */
  allowLocalHttp?: boolean
  /** Cancel all pending metadata reads. The complete discovery is bounded to 15 seconds. */
  signal?: AbortSignal
}

/** Authenticated operator self-reports. Final decryption must still verify the chain-anchored group key. */
export interface BlsSharing {
  /** Public 144-byte G2 || G1 shares indexed by distinct participant identifier. */
  verifyingShares: ReadonlyMap<number, Uint8Array>
  /** Assigned endpoints whose signed reports verified for the exact sharing. */
  keepers: readonly (BlsSharingKeeper & {identifier: number})[]
  /** Metadata refusals, retained without counting them toward the threshold. */
  failures: readonly {operator: string; message: string}[]
}

function uint(value: number | bigint, bytes: number): Uint8Array {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('Invalid share-report integer')
  let n = BigInt(value)
  if (n < 0n || n >= 1n << BigInt(bytes * 8)) throw new Error('Share-report integer out of range')
  const out = new Uint8Array(bytes)
  for (let i = bytes - 1; i >= 0; i--) {out[i] = Number(n & 255n); n >>= 8n}
  return out
}

/**
 * Authenticate each keeper's public BLS share using the existing operator share-report signature.
 * A report authenticates that operator's claim; it is not a chain commitment to a full polynomial.
 * Callers must retain pairing checks and final verification against the anchored group key.
 * No secret share is fetched and no payment or decryption work is started.
 *
 * @param input - Canonical epoch/version, threshold and independently authenticated assigned keepers.
 */
export async function discoverBlsSharing(input: BlsSharingOptions): Promise<BlsSharing> {
  input = {...input}
  input.signal?.throwIfAborted()
  const slot = protocolHex(input.slotId, 32, 'BLS sharing slot')
  uint(input.chainId, 8); uint(input.epoch, 8); uint(input.committeeVersion, 8)
  if (!input.keepers.length || input.keepers.length > 4096 || !Number.isSafeInteger(input.threshold) || input.threshold < 1 || input.threshold > input.keepers.length) throw new Error('Invalid BLS sharing threshold or keeper roster')
  const keepers = input.keepers.map(k => ({...k, operator: k.operator.toLowerCase(), publicKey: k.publicKey.slice(), nodeUrl: k.nodeUrl.replace(/\/$/, '')}))
  if (new Set(keepers.map(k => k.operator)).size !== keepers.length || new Set(keepers.map(k => k.nodeUrl)).size !== keepers.length) throw new Error('Duplicate BLS sharing operator or endpoint')
  for (const k of keepers) {
    protocolHex(k.operator, 20, 'BLS operator')
    if (k.publicKey.length !== 32) throw new Error('Invalid registered BLS keeper identity')
    const url = new URL(k.nodeUrl)
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && input.allowLocalHttp && BigInt(input.chainId) === 43112n && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('BLS sharing endpoint violates transport policy')
  }
  const fetchImpl = input.fetchImpl ?? fetch
  return withNetworkDeadline(async signal => {
    const results = await resolveKeeperMembers(keepers, async keeper => {
      try {
        const url = `${keeper.nodeUrl}/v1/keys/${input.slotId}/bls-share-report`
        const response = await fetchImpl(url, {signal, redirect: 'error', credentials: 'omit'})
        const text = await readIbeReply(response, signal)
        if (!response.ok) throw new Error(`BLS share report HTTP ${response.status}`)
        const r = JSON.parse(text) as {slot_id: string; epoch: number; committee_version: number; identifier: number; operator: string; pubkey: string; verifying_share: string; signature: string}
        if (!equalBytes(protocolHex(r.slot_id, 32, 'report slot'), slot) || r.epoch !== input.epoch || r.committee_version !== input.committeeVersion || !Number.isSafeInteger(r.identifier) || r.identifier < 1 || r.identifier > 65535 ||
          !equalBytes(protocolHex(r.operator, 20, 'report operator'), protocolHex(keeper.operator, 20, 'assigned operator')) || !equalBytes(protocolHex(r.pubkey, 32, 'report identity'), keeper.publicKey)) throw new Error('BLS report differs from assigned operator or canonical sharing')
        const share = protocolHex(r.verifying_share, 144, 'BLS public share')
        const digest = keccak_256(concatBytes(utf8ToBytes('keykeeper-committee/keeper-share-report/v1'), uint(input.chainId, 8), slot,
          uint(input.epoch, 8), uint(input.committeeVersion, 8), uint(r.identifier, 4), protocolHex(keeper.operator, 20, 'operator'), share))
        if (!ed25519.verify(protocolHex(r.signature, 64, 'share-report signature'), digest, keeper.publicKey, {zip215: false})) throw new Error('Invalid BLS operator share-report signature')
        // Reuse the contribution pairing check at U = g2 to validate G2 || G1 consistency.
        if (!verifyDecryptShare({id: r.identifier, verifyingShare: share, decryptionShare: share.slice(0, 96)}, bls12_381.G2.ProjectivePoint.BASE.toRawBytes(true))) throw new Error('Invalid dual-group BLS public share')
        return {keeper: {...keeper, identifier: r.identifier}, share}
      } catch (error) {
        signal.throwIfAborted()
        return {failure: {operator: keeper.operator, message: String(error)}}
      }
    }, signal)
    signal.throwIfAborted()
    const verified = results.flatMap(r => r.keeper ? [r] : [])
    const verifyingShares = new Map<number, Uint8Array>()
    for (const r of verified) {
      if (verifyingShares.has(r.keeper.identifier)) throw new Error('Duplicate identifier in signed BLS share reports')
      verifyingShares.set(r.keeper.identifier, r.share)
    }
    if (verified.length < input.threshold) throw new Error(`Authenticated BLS sharing threshold not met: ${verified.length}/${input.threshold}; ${results.flatMap(r => r.failure ? [r.failure.message] : []).join('; ')}`)
    return {verifyingShares, keepers: verified.map(r => r.keeper), failures: results.flatMap(r => r.failure ? [r.failure] : [])}
  }, input.signal)
}
