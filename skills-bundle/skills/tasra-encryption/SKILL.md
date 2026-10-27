---
name: tasra-encryption
description: Encrypt and decrypt data with typed BLS KEM slots. Use for encrypted notes, private records, share provenance and large encrypted objects.
compatibility: Requires @t3foundry/tasra-sdk to be installed (npm install @t3foundry/tasra-sdk)
metadata:
  package: @t3foundry/tasra-skills
  sources: "node_modules/@t3foundry/tasra-sdk/dist/app/client.d.ts, node_modules/@t3foundry/tasra-sdk/dist/committee/extraction.d.ts, node_modules/@t3foundry/tasra-sdk/src/crypto/kem, node_modules/@t3foundry/tasra-sdk/dist/crypto/envelope.d.ts"
---

# Encrypt data with BLS KEM

A BLS KEM slot produces a **symmetric key** wrapped under the slot's BLS12-381
group public key. The slot never sees the payload: your application encrypts the
actual data (file, note, message) with the symmetric key using AES-256-GCM,
and the BLS KEM encapsulates *only* that key. Decryption reverses the flow —
the committee authorizes the keeper partials, the BLS KEM recovers the
symmetric key, and your application decrypts the payload with it.

```
┌─ encryption ──────────────────────────────────────────────────────┐
│                                                               │
│  payload ──► AES-256-GCM ◄── dataKey (32 B random)          │
│                    │                │                        │
│                    ▼                ▼                        │
│            aesCiphertext ←──┐  BLS KEM.encrypt(mpk, aad, dataKey) │
│                               │         │                        │
│                               │         ▼                        │
│                               └─► kemCiphertext: {u, nonce, aeadCt} │
│                                                               │
│  wire = kemCiphertext + aesCiphertext                       │
└─────────────────────────────────────────────────────────────────┘
```

## Encrypted data schema

All encrypted payloads produced or consumed by this skill follow the
`tasra-encrypt/v2` envelope format. The top-level JSON object contains two
keys: `manifest` (record identity and cryptographic parameters) and `envelope`
(the actual ciphertext material).

```json
{
  "manifest": {
    "schema":          "tasra-encrypt/v2",
    "recordId":        "<uuid>",
    "title":           "<human-readable label>",
    "version":         <monotonic integer>,
    "documentSha256":   "<sha-256 hex digest of the plaintext>",
    "chainId":         <Ethereum chain id (e.g. 43113 for Fuji)>,
    "keyRegistry":      "0x<contract address>",
    "slotId":           "0x<32-byte slot identifier>"
  },
  "envelope": {
    "encryptedAesKey": "<base64-encoded BLS KEM ciphertext (u ‖ nonce ‖ aeadCt)>",
    "aesCiphertext":   "<base64-encoded AES-256-GCM ciphertext>",
    "epoch":           <slot epoch at encryption time>
  }
}
```

**Manifest fields (all required)**

| Field | Type | Description |
|---|---|---|
| `schema` | string | Always `"tasra-encrypt/v2"`. Agents should reject unknown values. |
| `recordId` | string (uuid) | Stable identifier for the record. Used in logs, receipts, and AAD derivation. |
| `title` | string | Human-readable label; opaque to the crypto layer. |
| `version` | number | Monotonic version counter for the plaintext. Bumped on every update. |
| `documentSha256` | string (hex) | SHA-256 hash of the original plaintext (pre-encryption). Anchors integrity. |
| `chainId` | number | EVM chain where the slot's `KeyRegistry` contract is deployed. |
| `keyRegistry` | string | Hex-encoded contract address of the BLS key registry. |
| `slotId` | string | 32-byte BLS slot identifier, hex-encoded with `0x` prefix. |

**Envelope fields (all required)**

| Field | Type | Description |
|---|---|---|
| `encryptedAesKey` | string (base64) | BLS KEM ciphertext encoding the three components `u` (G₂ element), `nonce` (16 bytes), and `aeadCt` (GCM ciphertext over the data key). |
| `aesCiphertext` | string (base64) | The payload encrypted under AES-256-GCM with the data key from the KEM. |
| `epoch` | number | Slot epoch at the moment of encryption. Decryption must use the same epoch. |

**Agent guidance**

1. **Always set `schema` to `"tasra-encrypt/v2"`.** Consumers must reject
   unknown schema values.
2. **Derive AAD from `recordId`.** The AAD passed to AES-GCM and the BLS
   KEM should be a stable, collision-resistant scope derived from `recordId`
   (e.g. `SHA-256("tasra-encrypt/v2:" ‖ recordId)`).
3. **`documentSha256` is the plaintext hash**, not the ciphertext hash. Hash
   before encrypting. Verifiers recompute the hash after decryption to detect
   tampering upstream of the KEM.
4. **`version` is monotonic.** Every ciphertext produced for the same
   `recordId` should increment `version`. Consumers can use it to detect stale
   or replayed ciphertexts.
5. **The `envelope.encryptedAesKey` encodes the full BLS KEM ciphertext.**
   The on-chain KEM contract expects `u` ‖ `nonce` ‖ `aeadCt` concatenated;
   the base64 value in the envelope holds that exact byte sequence.

## Full example

```ts
import { createTasra, createIdentity, issueCredential, credentialPolicy, credentialAuthorization } from '@t3foundry/tasra-sdk/app'
import { webcrypto } from 'node:crypto'  // or Web Crypto API in the browser

// ── Setup ───────────────────────────────────────────────────────
const tasra = createTasra({ deployment })
const alice = createIdentity()
const issuer = createIdentity()

// Create the slot with a credential-gated rule
const policy = credentialPolicy({
  issuer: issuer.did,
  type:   'DocumentReader',
  subjects: [alice.did],
})
const slotId = await createSlot(tasra, { mode: 'bls', rule: policy })

// Issue Alice a credential
const credential = issueCredential({ issuer, holder: alice, type: 'DocumentReader', claims: {} })

// ── Encrypt (producer — no credential needed) ──────────────
async function encryptNote(
  tasra: TasraApplication, slotId: `0x${string}`,
  note: Uint8Array, aad: Uint8Array,
): Promise<{ kemCt: Ciphertext; aesCt: Uint8Array; iv: Uint8Array }> {
  // 1. Generate a random AES-256 data key
  const dataKey = webcrypto.getRandomValues(new Uint8Array(32))

  // 2. Encrypt the payload with AES-256-GCM
  const iv = webcrypto.getRandomValues(new Uint8Array(12))
  const aesKey = await webcrypto.subtle.importKey('raw', dataKey, 'AES-GCM', false, ['encrypt'])
  const aesCt = new Uint8Array(await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad }, aesKey, note,
  ))

  // 3. BLS KEM-wrap the data key
  const slot = await tasra.slots.bls(slotId)
  const kemCt = await slot.encrypt(aad, dataKey)

  // 4. Zeroize the data key
  dataKey.fill(0)

  return { kemCt, aesCt, iv }
}

// ── Decrypt (consumer — credential required) ──────────────
async function decryptNote(
  tasra: TasraApplication, slotId: `0x${string}`,
  kemCt: Ciphertext, aesCt: Uint8Array, iv: Uint8Array,
  aad: Uint8Array, credential: string,
): Promise<Uint8Array> {
  // Authorize per-operation — presents credential to verifier committee
  const authorize = credentialAuthorization({
    verifierAgentUrl,
    signer:   alice.issuer as TypedDataSigner,
    identity: alice,
    credentials: [credential],
    approve:  req => { /* display consent dialog */; return true },
  })

  // 1. BLS KEM-recovers the symmetric key
  const slot = await tasra.slots.bls(slotId)
  const { plaintext: dataKey } = await slot.decrypt(aad, kemCt, {
    authorize,
    requireReceipts: true,
    description: `Decrypt note`,
  })

  // 2. Decrypt the payload with AES-256-GCM
  const aesKey = await webcrypto.subtle.importKey('raw', dataKey, 'AES-GCM', false, ['decrypt'])
  const note = new Uint8Array(await webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: aad }, aesKey, aesCt,
  ))

  // 3. Zeroize the data key
  dataKey.fill(0)

  return note
}
```

Encryption needs only the slot's public group key — no credential, no network
round-trip. The `aad` (additional authenticated data) binds the ciphertext to
an application scope; use a stable record identifier. `requireReceipts` refuses
an absent or invalid keeper receipt. The decryption result contains `plaintext:
Uint8Array`, `evidence` and `shareTrust`. Always zeroize key buffers when done.

## Integrating an existing application

`decryptIdentityStrict` from `@t3foundry/tasra-sdk/committee` accepts an independently
anchored group key, expected slot/epoch/threshold and assigned operator
identities/public keys. Supply the operation's token and verifier membership
proofs; do not rebuild collection/combination around untrusted response data.

Two assurance modes have different requirements:

- `anchored-group` verifies the combined result against the trusted group key.
  This is the application handle's mode. It does not independently authenticate each
  keeper's polynomial verifying share.
- `pinned-shares` additionally needs verifying shares/identifiers from an independent
  trusted source. A share returned alongside its own decryption response is not that source.

For offline cryptographic tests and lower-level KEM operations (custody path,
shard delivery, envelopes), read [advanced KEM operations](references/advanced.md).
