// Node example utilities, not part of the SDK's public API.
import {randomBytes} from 'node:crypto'
import type {Hex} from 'viem'
import {readFileSync} from 'node:fs'
import {ed25519DidKey, hexToBytes, createDecryptionRecipient, decryptionBinding, kemContentDigest, type HolderSigner, type Ciphertext} from 'tasra-sdk'
import {
  addressBookFromManifest, createTasraChainClient, parsePinnedNetworkManifest,
  observeNetworkManifest,
  createCommitteeSlotClient, type TasraChainClient, type SlotCommitteeDecryptOptions,
} from 'tasra-sdk/chain'
import {discoverBlsSharing, holderProofPerVerifier} from 'tasra-sdk/committee'
import {ed25519} from '@noble/curves/ed25519'

export function required(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name]?.trim()
  if (!value) throw new Error(`Missing ${name}. See docs/prerequisites.md and https://github.com/t3foundry/tasra-releases for Fuji deployment records.`)
  return value
}

export function slotId(name = 'KK_SLOT_ID'): `0x${string}` {
  const value = required(name)
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} must be a 0x-prefixed bytes32`)
  return value as `0x${string}`
}

export async function loadNetwork() {
  const digest = required('KK_MANIFEST_SHA256')
  const manifest = parsePinnedNetworkManifest(readFileSync(required('KK_MANIFEST_FILE'), 'utf8'), digest)
  const addresses = addressBookFromManifest(manifest)
  const rpcUrl = required('KK_RPC_URL')
  const observation = await observeNetworkManifest(manifest, rpcUrl)
  if (!observation.matches) throw new Error('Deployment code does not match the pinned manifest')
  return {manifest, digest, rpcUrl, addresses,
    chain: createTasraChainClient({rpcUrl, addresses, chainId: manifest.chainId})}
}

export function loadHolder(prefix = 'KK') {
  const secretKey = hexToBytes(readFileSync(required(`${prefix}_HOLDER_KEY_FILE`), 'utf8').trim())
  try {
    if (secretKey.length !== 32) throw new Error('Holder key must contain exactly 32 bytes of hex')
    const credentials: unknown = JSON.parse(readFileSync(required(`${prefix}_CREDENTIALS_FILE`), 'utf8'))
    if (!Array.isArray(credentials) || !credentials.length || !credentials.every(v => typeof v === 'string' && v.length > 0)) {
      throw new Error('Credentials file must be a nonempty JSON array of compact-JWS credentials')
    }
    const holder = ed25519DidKey(ed25519.getPublicKey(secretKey))
    const signer: HolderSigner = {alg: 'EdDSA', did: holder, secretKey}
    return {holder, signer, secretKey, credentials: credentials as string[]}
  } catch (error) {
    secretKey.fill(0)
    throw error
  }
}

export function committeeClient(chain: TasraChainClient, slot: string, identity: ReturnType<typeof loadHolder>, action: 'sign' | 'decrypt') {
  return createCommitteeSlotClient({chain, holder: identity.holder, credentials: identity.credentials,
    holderProof: holderProofPerVerifier({signer: identity.signer, credentials: identity.credentials,
      audience: required('KK_VERIFIER_AUDIENCE'), slotId: slot, action}),
  })
}

/** Prepare the original client recipient and authenticated sharing before holder authorization. */
export async function sealedDecryptOptions(chain: TasraChainClient, slot: Hex,
  envelope: {ciphertext: Ciphertext; identity: Uint8Array; epoch: bigint | null}): Promise<SlotCommitteeDecryptOptions> {
  const [canonical, chainId, operators] = await Promise.all([
    chain.readers.keyRegistry.getKeySlot(slot), chain.client.getChainId(), chain.readers.keyRegistry.assignedNodes(slot),
  ])
  if (!canonical.exists || canonical.mode !== 1 || envelope.epoch === null || envelope.epoch !== BigInt(canonical.epoch)) throw new Error('Envelope is not for the canonical BLS slot epoch')
  const keepers = await Promise.all(operators.map(async operator => {
    const node = await chain.readers.nodeRegistry.nodeOf(operator)
    return {operator, nodeUrl: node.url, publicKey: hexToBytes(node.pubkey)}
  }))
  const epoch = Number(canonical.epoch), threshold = canonical.threshold.k
  const sharing = await discoverBlsSharing({chainId,slotId:slot,epoch,committeeVersion:Number(canonical.committeeVersion),threshold,keepers})
  const recipient = await createDecryptionRecipient()
  const {payloadDigest} = decryptionBinding(kemContentDigest(envelope.ciphertext,envelope.identity),epoch,recipient)
  return {ciphertext:envelope.ciphertext,identity:envelope.identity,ciphertextEpoch:epoch,recipient,threshold,verifyingShares:sharing.verifyingShares,
    binding:{chainId,action:'decrypt',payloadDigest,random:randomBytes(32),clientId:required('KK_VERIFIER_AUDIENCE')}}
}
