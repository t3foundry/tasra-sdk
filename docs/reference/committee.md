# tasra-sdk/committee

Generated from public TypeScript exports. Run `npm run docs:reference` to update.

[Reference index](README.md) · [Task guides](../README.md) · [Errors](../errors.md)

## assembleCompoundToken

See the declaration and linked source for the contract.

[Source](../../src/committee/token.ts#L455)

```ts
import {assembleCompoundToken} from 'tasra-sdk/committee'

declare function assembleCompoundToken(p: CompoundTokenPayload, signatures: CommitteeSignature[]): CompoundTokenWire
```

| Parameter | Type | Description |
|---|---|---|
| `p` | `CompoundTokenPayload` |  |
| `signatures` | `CommitteeSignature[]` |  |

Returns: `CompoundTokenWire`.

## buildVerifierProofs

Build snapshot-inclusion proofs for the token's `signerIndexes` from the full ordered verifier
directory. Returns `undefined` (never a wrong proof) when the directory is incomplete, a key is
missing, or the reconstructed root disagrees with the anchored `snapshotRoot` — so a mismatch
degrades to the keeper's configured-set path rather than shipping a proof the keeper rejects.

[Source](../../src/committee/request.ts#L241)

```ts
import {buildVerifierProofs} from 'tasra-sdk/committee'

declare function buildVerifierProofs(verifiers: CommitteeVerifier[], registrySize: number, signerIndexes: number[], snapshotRoot?: Uint8Array): VerifierProof[] | undefined
```

| Parameter | Type | Description |
|---|---|---|
| `verifiers` | `CommitteeVerifier[]` |  |
| `registrySize` | `number` |  |
| `signerIndexes` | `number[]` |  |
| `snapshotRoot` | `Uint8Array<ArrayBufferLike> &#124; undefined` |  |

Returns: `VerifierProof[] | undefined`.

## clientBindingHash

The 32-byte hash the client (== the credential holder) signs to attest it authorized this
operation on `slotId` under the compound token whose canonical hash is `tokenHash`:
`keccak256(DOMAIN ‖ slotId ‖ tokenHash)`. Byte-identical to the reference `client_binding_hash`, so
the keeper (hot path) and accountant (audit) verify the client signature over the same bytes.

[Source](../../src/committee/token.ts#L218)

```ts
import {clientBindingHash} from 'tasra-sdk/committee'

declare function clientBindingHash(slotId: Uint8Array, tokenHash: Uint8Array): Uint8Array
```

| Parameter | Type | Description |
|---|---|---|
| `slotId` | `Uint8Array<ArrayBufferLike>` |  |
| `tokenHash` | `Uint8Array<ArrayBufferLike>` |  |

Returns: `Uint8Array<ArrayBufferLike>`.

## ClientSigner

client request signature. The client (== the credential holder) proves it authorized
this exact request by signing `clientBindingHash(slotId, tokenHash)`. Supply an ed25519 signer
(the holder's authentication key) — the keeper (hot path) and the accountant (audit) verify it.

[Source](../../src/committee/request.ts#L46)

```ts
export interface ClientSigner {
  /** 32-byte ed25519 public key. */
  publicKey: Uint8Array
  /** Sign the 32-byte client-binding hash → 64-byte ed25519 signature. */
  sign(bindingHash: Uint8Array): Uint8Array | Promise<Uint8Array>
}
```

## committeeAuthorize

Ask one verifier to authorize the request. Throws CommitteeAuthorizeError
(with `.status`) on a non-2xx — notably 403 when this verifier wasn't drawn.

[Source](../../src/committee/client.ts#L193)

```ts
import {committeeAuthorize} from 'tasra-sdk/committee'

declare function committeeAuthorize(verifierUrl: string, body: CommitteeAuthorizeBody): Promise<CommitteeAuthorizeReply>
```

| Parameter | Type | Description |
|---|---|---|
| `verifierUrl` | `string` |  |
| `body` | `CommitteeAuthorizeBody` |  |

Returns: `Promise<CommitteeAuthorizeReply>`.

## CommitteeAuthorizeBody

See the declaration and linked source for the contract.

[Source](../../src/committee/client.ts#L79)

```ts
export interface CommitteeAuthorizeBody {
  /** Holder DID (the credentials' subject). */
  holder: string
  /** Compact-JWS verifiable credentials. */
  credentials: string[]
  /** F1/F4: holder proof-of-possession. Build via `createHolderProof`
   *  (bind it to `slotId`). Empty string ⇒ omitted from the wire, which only a
   *  verifier with `require_holder_binding = false` accepts. */
  holderProof: string
  tokenType: TokenType
  /** 32-byte on-chain beacon seed. */
  seed: Uint8Array
  epoch: number | bigint
  /** 32-byte slot id. */
  slotId: Uint8Array
  /** Active verifier-set size at `epoch`. */
  registrySize: number
  /** The slot's verifierPolicy committee size. */
  committee: number
  iat: number | bigint
  exp: number | bigint
  /**
   * The requested IBE identity, present **iff** the operation is
   * identity-scoped. The committee evaluates the slot's scope binding against it and
   * folds `keccak256(identity)` into the signed token — a quorum attests THIS identity
   * and the token is unusable for any other. Omit for every other operation.
   */
  identity?: string
  /**
   * request binding: the preimage every drawn verifier re-derives `request_hash`
   * and the KB-JWT nonce from. Send it whenever the keeper runs `require_request_binding`
   * (production posture): the reply then carries `request_hash` + `binding`, which the
   * gathered token must include or the keeper refuses it. Absent = legacy (unbound) path.
   */
  binding?: RequestBindingPreimage
}
```

## CommitteeAuthorizeError

A verifier refused to co-sign a committee token. Extends
{@link TasraHttpError}, so `.status`, `.url`, `.body`, and `.retryable` are
all available and `isAuthDenied()` recognises a 401/403 here too.

Distinct from a generic HTTP error because the committee flow polls several
verifiers and tolerates individual refusals as long as a quorum co-signs — see
{@link ThresholdNotMetError} for the failure that means the quorum was missed.

[Source](../../src/committee/client.ts#L69)

Import: `import {CommitteeAuthorizeError} from 'tasra-sdk/committee'`

- `status: number` — 
- `url: string` — 
- `body: string` — 
- `retryable: boolean` — `false` when retrying the identical request cannot succeed.
- `name: string` — 
- `message: string` — 
- `stack: string &#124; undefined` — 
- `cause: unknown` — 

## CommitteeAuthorizeReply

See the declaration and linked source for the contract.

[Source](../../src/committee/client.ts#L129)

```ts
export interface CommitteeAuthorizeReply {
  verifierIndex: number
  tokenHash: Uint8Array
  vpHash: Uint8Array
  /** `keccak256` of the holder this verifier authenticated — inside the signed bytes. */
  holderHash: Uint8Array
  /** `keccak256` of the RAW rule this verifier evaluated (UNSALTED) — what the keeper
   *  binds against its own `keccak256(rule)`. */
  ruleHash: Uint8Array
  /** the identity binding this verifier signed — present iff the request
   *  carried `identity`. Inside the signed bytes, like `holderHash`. */
  identityHash?: Uint8Array
  signature: Uint8Array
  /** The full ordered committee draw, so the caller knows whom else to ask. */
  committeeIndexes: number[]
  /**
   * The slot's `ruleVersion` this authorization was evaluated against.
   *
   * ⚠ Diagnostic, not a gate. The keeper binds `ruleHash` to its own rule hash,
   * so a token minted under a superseded policy is refused there
   * whatever this says. Its value is that it explains the refusal: without it, a
   * token minted moments before an amendment activates is rejected with nothing
   * to distinguish it from a genuinely unauthorized request.
   *
   * `undefined` from a verifier that predates rule versioning.
   */
  ruleVersion?: number
  /** present when the request carried a binding preimage; inside the signed bytes. */
  requestHash?: Uint8Array
  /** binding strength byte (`bindingFromWire`); `0x00` when the verifier declared none. */
  binding: number
}
```

## CommitteeChainReads

The chain reads the committee flow needs. Adapt from the SDK chain client with
{@link committeeChainReadsFromClient}, or supply raw viem reads.

[Source](../../src/committee/request.ts#L119)

```ts
export interface CommitteeChainReads {
  /** 32-byte beacon seed for the current epoch. */
  seed(): Promise<`0x${string}` | Uint8Array>
  /** Current beacon epoch. */
  epoch(): Promise<bigint | number>
  /** Seed of a past epoch (`ThresholdRandomBeacon.seedAt`) — needed for `epochLag > 0`. */
  seedAt?(epoch: bigint): Promise<`0x${string}` | Uint8Array>
  /** The slot's `[committee, quorum]` verifier policy (both `uint16`). */
  verifierPolicy(slotId: `0x${string}`): Promise<readonly [number, number]>
  /** Optional anchored verifier-set snapshot `{root, size}` at an epoch — enables trustless
   *  proofs. Return `null` when none is anchored. */
  snapshot?(epoch: bigint): Promise<{root: `0x${string}` | Uint8Array; size: number} | null>
}
```

## committeeChainReadsFromClient

Adapt the SDK chain client's `readers` into {@link CommitteeChainReads}.

[Source](../../src/committee/request.ts#L134)

```ts
import {committeeChainReadsFromClient} from 'tasra-sdk/committee'

declare function committeeChainReadsFromClient(readers: { beacon: { seed(): Promise<unknown>; epoch(): Promise<unknown>; seedAt?(epoch: bigint): Promise<unknown>; }; keyRegistry: { verifierPolicy(id: `0x${string}`): Promise<readonly [number, number]>; }; verifierSet?: { snapshotAt(epoch: bigint): Promise<unknown>; }; }): CommitteeChainReads
```

| Parameter | Type | Description |
|---|---|---|
| `readers` | `{ beacon: { seed(): Promise<unknown>; epoch(): Promise<unknown>; seedAt?(epoch: bigint): Promise<unknown>; }; keyRegistry: { verifierPolicy(id: \`0x${string}\`): Promise<readonly [number, number]>; }; verifierSet?: { snapshotAt(epoch: bigint): Promise<unknown>; }; }` |  |

Returns: `CommitteeChainReads`.

## committeeDecrypt

Decrypt via committee authorization. The slot id is taken from the token.

[Source](../../src/committee/client.ts#L448)

```ts
import {committeeDecrypt} from 'tasra-sdk/committee'

declare function committeeDecrypt(opts: CommitteeDecryptOpts): Promise<Uint8Array>
```

| Parameter | Type | Description |
|---|---|---|
| `opts` | `CommitteeDecryptOpts` |  |

Returns: `Promise<Uint8Array<ArrayBufferLike>>`.

## CommitteeDecryptOpts

See the declaration and linked source for the contract.

[Source](../../src/committee/client.ts#L431)

```ts
export interface CommitteeDecryptOpts {
  nodeUrl: string
  committeeToken: CompoundTokenWire
  ciphertext: Ciphertext
  identity: Uint8Array
  decryptingSet: number[]
  blsPeers: BlsPeer[]
  userSignature?: Uint8Array
  ciphertextEpoch?: number
  targetKeykeeper?: string
  verifierProofs?: VerifierProof[]
  /** client request signature (see {@link CommitteeSignOpts}). */
  clientPubkey?: Uint8Array
  clientSignature?: Uint8Array
}
```

## committeeDecryptRequest

One-call committee-authorized threshold decrypt.

[Source](../../src/committee/request.ts#L417)

```ts
import {committeeDecryptRequest} from 'tasra-sdk/committee'

declare function committeeDecryptRequest(opts: CommitteeDecryptRequestOpts): Promise<Uint8Array>
```

| Parameter | Type | Description |
|---|---|---|
| `opts` | `CommitteeDecryptRequestOpts` |  |

Returns: `Promise<Uint8Array<ArrayBufferLike>>`.

## CommitteeDecryptRequestOpts

Operation-specific fields for {@link committeeDecryptRequest}.

[Source](../../src/committee/request.ts#L405)

```ts
export interface CommitteeDecryptRequestOpts extends RequestCommitteeTokenOpts {
  nodeUrl: string
  ciphertext: CommitteeDecryptOpts['ciphertext']
  identity: Uint8Array
  decryptingSet: number[]
  blsPeers: CommitteeDecryptOpts['blsPeers']
  userSignature?: Uint8Array
  ciphertextEpoch?: number
  targetKeykeeper?: string
}
```

## CommitteeEoaSignOpts

See the declaration and linked source for the contract.

[Source](../../src/committee/ecdsa.ts#L7)

```ts
export interface CommitteeEoaSignOpts {
  nodeUrl: string
  /** Authorization from awaitVerifierAgentResult; its slot selects the signing key. */
  committeeToken: CompoundTokenWire
  /** Exactly 32 bytes: the transaction signing hash, not a serialized transaction. */
  digest: Uint8Array
  /** Membership proofs returned with the authorization. */
  verifierProofs?: VerifierProof[]
  requestId?: string
  /** Required only by slots configured with an additional owner-signature gate. */
  userSignature?: Uint8Array
  targetKeykeeper?: string
  signal?: AbortSignal
}
```

## committeeSign

Sign via committee authorization. The slot id is taken from the token.

[Source](../../src/committee/client.ts#L393)

```ts
import {committeeSign} from 'tasra-sdk/committee'

declare function committeeSign(opts: CommitteeSignOpts): Promise<FrostSignResult>
```

| Parameter | Type | Description |
|---|---|---|
| `opts` | `CommitteeSignOpts` |  |

Returns: `Promise<FrostSignResult>`.

## CommitteeSignature

One verifier's signature within a compound token.

[Source](../../src/committee/token.ts#L284)

```ts
export interface CommitteeSignature {
  verifierIndex: number
  signature: Uint8Array
}
```

## CommitteeSignatureWire

One verifier's signature on the wire (hex).

[Source](../../src/committee/token.ts#L410)

```ts
export interface CommitteeSignatureWire {
  verifier_index: number
  signature: string
}
```

## committeeSignEoaDigest

Sign an Ethereum digest using credential-based committee authorization.
Open the verifier-agent session with action `sign` and message equal to `digest`.
The keeper checks the token's request binding against SHA-256(digest), then
threshold-signs the original digest. This never falls back to JWT authorization.

[Source](../../src/committee/ecdsa.ts#L31)

```ts
import {committeeSignEoaDigest} from 'tasra-sdk/committee'

declare function committeeSignEoaDigest(opts: CommitteeEoaSignOpts): Promise<EoaSignature>
```

| Parameter | Type | Description |
|---|---|---|
| `opts` | `CommitteeEoaSignOpts` |  |

Returns: `Promise<EoaSignature>`.

Return details: Ethereum signature components and the secp256k1 group public key.

Throws: On malformed input/response, network failure, or keeper rejection.
HTTP 401/403 is an authorization denial; do not retry it as a network failure.

## CommitteeSignOpts

See the declaration and linked source for the contract.

[Source](../../src/committee/client.ts#L378)

```ts
export interface CommitteeSignOpts {
  nodeUrl: string
  committeeToken: CompoundTokenWire
  message: Uint8Array
  signingSet?: number[]
  userSignature?: Uint8Array
  targetKeykeeper?: string
  verifierProofs?: VerifierProof[]
  /** client request signature: the client's 32-byte ed25519 pubkey + its 64-byte
   *  signature over `clientBindingHash(slotId, tokenHash)`. Both or neither. */
  clientPubkey?: Uint8Array
  clientSignature?: Uint8Array
}
```

## committeeSignRequest

One-call committee-authorized threshold sign: resolve token (+proofs) then POST to the keeper.

[Source](../../src/committee/request.ts#L388)

```ts
import {committeeSignRequest} from 'tasra-sdk/committee'

declare function committeeSignRequest(opts: CommitteeSignRequestOpts): Promise<FrostSignResult>
```

| Parameter | Type | Description |
|---|---|---|
| `opts` | `CommitteeSignRequestOpts` |  |

Returns: `Promise<FrostSignResult>`.

## CommitteeSignRequestOpts

Operation-specific fields for {@link committeeSignRequest} (everything `committeeSign` needs
except the token, which this resolves).

[Source](../../src/committee/request.ts#L378)

```ts
export interface CommitteeSignRequestOpts extends RequestCommitteeTokenOpts {
  nodeUrl: string
  message: Uint8Array
  signingSet?: number[]
  userSignature?: Uint8Array
  /** The keeper this request targets (anti-Sybil). Defaults to letting the node accept it. */
  targetKeykeeper?: string
}
```

## CommitteeTokenResult

See the declaration and linked source for the contract.

[Source](../../src/committee/request.ts#L210)

```ts
export interface CommitteeTokenResult {
  token: CompoundTokenWire
  committee: number
  quorum: number
  registrySize: number
  seed: Uint8Array
  epoch: number
  /** Trustless snapshot-inclusion proofs for the token's signers, when derivable; else
   *  `undefined` (the keeper then uses its configured verifier set). */
  verifierProofs?: VerifierProof[]
  /** client request signature, when a `clientSigner` was supplied. */
  clientPubkey?: Uint8Array
  clientSignature?: Uint8Array
  /**
   * The slot's `ruleVersion` the committee evaluated against, as
   * reported by the verifiers. `undefined` from a verifier predating it.
   *
   * ⚠ Diagnostic, not a gate — the keeper binds `ruleHash` to its own rule hash,
   * so a token minted under a superseded policy is refused there
   * regardless. What this buys is being able to SAY that is what happened,
   * rather than leaving a refusal indistinguishable from an unauthorized one.
   */
  ruleVersion?: number
}
```

## CommitteeVerifier

One member of the active verifier set. `operator`+`pubkey` are needed only to build the
trustless snapshot proofs; `index`+`url` alone suffice for the keeper's configured-set path.

[Source](../../src/committee/request.ts#L107)

```ts
export interface CommitteeVerifier {
  index: number
  /** Verifier HTTP base URL. */
  url: string
  /** 20-byte operator address (hex). */
  operator?: string
  /** 32-byte ed25519 signing pubkey (hex). */
  pubkey?: string
}
```

## compoundTokenCanonicalBytes

Canonical, domain-separated, length-prefixed byte encoding hashed for signing.

[Source](../../src/committee/token.ts#L164)

```ts
import {compoundTokenCanonicalBytes} from 'tasra-sdk/committee'

declare function compoundTokenCanonicalBytes(p: CompoundTokenPayload): Uint8Array
```

| Parameter | Type | Description |
|---|---|---|
| `p` | `CompoundTokenPayload` |  |

Returns: `Uint8Array<ArrayBufferLike>`.

## compoundTokenHash

`keccak256` of the canonical bytes — the value each quorum verifier signs.

[Source](../../src/committee/token.ts#L192)

```ts
import {compoundTokenHash} from 'tasra-sdk/committee'

declare function compoundTokenHash(p: CompoundTokenPayload): Uint8Array
```

| Parameter | Type | Description |
|---|---|---|
| `p` | `CompoundTokenPayload` |  |

Returns: `Uint8Array<ArrayBufferLike>`.

## CompoundTokenPayload

The data the quorum verifiers sign over. All byte fields are 32 bytes unless noted.

[Source](../../src/committee/token.ts#L112)

```ts
export interface CompoundTokenPayload {
  tokenType: TokenType
  seed: Uint8Array
  epoch: number | bigint
  slotId: Uint8Array
  vpHash: Uint8Array
  /**
   * `keccak256` of the holder identifier the verifier committee authenticated.
   *
   * ⚠ A STABLE presenter identity, which `vpHash` is not — the same holder presenting twice
   * yields two different `vpHash`es. Inside the signed bytes, so it cannot be altered after
   * the committee signs. Required for any rule that counts DISTINCT people (dual-control).
   */
  holderHash: Uint8Array
  /**
   * `keccak256` of the RAW DCQL rule — UNSALTED, the same function as the on-chain
   * `DualControlPolicy.ruleHash`.
   *
   * ⚠ NOT the slot's `KeySlot.ruleCommitment`, which is the SALTED
   * `keccak256("keykeeper/rule-commitment/v1" ‖ salt ‖ rule)`. One invariant
   * holds across the codebase: `ruleCommitment` = salted, `ruleHash` = unsalted.
   */
  ruleHash: Uint8Array
  /**
   * `keccak256` of the IBE identity this token is scoped to — present **iff**
   * the committee authorized an identity-scoped operation (it ran the WHO + WHICH
   * evaluation against exactly this identity). Absent for every other operation.
   *
   * ⚠ Inside the signed canonical bytes (presence byte `0x00`/`0x01` + 32 bytes — never
   * a zero sentinel), so a token minted for one identity is unusable for any other, and
   * a scoped token can never pass as unscoped. Keepers REFUSE a scoped token on every
   * identity-blind endpoint.
   */
  identityHash?: Uint8Array
  /**
   * `keccak256` of the binding preimage that ties this token to a specific
   * operation and message. Present when the verifier-agent flow derived it; absent for legacy
   * (pre-verifier-agent) authorization flows. Keepers REQUIRE it under `require_request_binding`.
   */
  requestHash?: Uint8Array
  /**
   * How the holder's key possession was proved. `0x00` = Unbound (no proof),
   * `0x01` = HolderKey (KB-JWT nonce verified), `0x02` = IssuerAsserted (reserved).
   * Always present in the canonical bytes; defaults to `0x00` when omitted.
   */
  binding?: number
  verifierIndexes: number[]
  iat: number | bigint
  exp: number | bigint
}
```

## CompoundTokenWire

The compound token JSON a client submits with `/v1/committee/{sign,decrypt}`.

[Source](../../src/committee/token.ts#L416)

```ts
export interface CompoundTokenWire {
  token_type: TokenType
  seed: string
  epoch: number
  slot_id: string
  vp_hash: string
  holder_hash: string
  /** `keccak256` of the RAW rule (UNSALTED) — the counterpart of `DualControlPolicy.ruleHash`,
   *  never the salted `KeySlot.ruleCommitment`. */
  rule_hash: string
  /** `0x..` identity binding — present iff the token is identity-scoped. */
  identity_hash?: string
  /** `0x..` request binding hash — present when minted via the verifier-agent flow. */
  request_hash?: string
  /** `"unbound"` | `"holder_key"` | `"issuer_asserted"`. */
  binding?: string
  verifier_indexes: number[]
  iat: number
  exp: number
  signatures: CommitteeSignatureWire[]
}
```

## decodeCompoundToken

Decode a wire compound token into the byte-level payload + signatures for verification.

[Source](../../src/committee/token.ts#L475)

```ts
import {decodeCompoundToken} from 'tasra-sdk/committee'

declare function decodeCompoundToken(w: CompoundTokenWire): CompoundTokenPayload & { signatures: CommitteeSignature[]; }
```

| Parameter | Type | Description |
|---|---|---|
| `w` | `CompoundTokenWire` |  |

Returns: `CompoundTokenPayload & { signatures: CommitteeSignature[]; }`.

## dpopHtu

The `htu` (RFC 9449 §4.2) a DPoP proof for an OAuth response must carry:
`{origin}/v1/sessions/oauth-response`.

Session-INDEPENDENT, deliberately: RFC 9449 defines `htu` as the request URI WITHOUT query
or fragment, and a client library that derives it from the URL it is about to call — which
every conformant one does — produces this string, not one carrying a session id. The
session is already bound by the `nonce`.

[Source](../../src/committee/oauth.ts#L59)

```ts
import {dpopHtu} from 'tasra-sdk/committee'

declare function dpopHtu(origin: string): string
```

| Parameter | Type | Description |
|---|---|---|
| `origin` | `string` |  |

Returns: `string`.

## ed25519ClientSigner

A {@link ClientSigner} from a 32-byte ed25519 secret key (the common `did:key` holder).

[Source](../../src/committee/request.ts#L90)

```ts
import {ed25519ClientSigner} from 'tasra-sdk/committee'

declare function ed25519ClientSigner(secretKey: Uint8Array): ClientSigner
```

| Parameter | Type | Description |
|---|---|---|
| `secretKey` | `Uint8Array<ArrayBufferLike>` |  |

Returns: `ClientSigner`.

## gatherCommitteeToken

Fan out to the candidate verifiers, collect signatures from the drawn committee
until quorum, and assemble the compound token. Verifies that our locally
recomputed canonical token hash equals the hash the verifiers signed (a built-in
encoding cross-check). Returns the wire token to POST to the keeper.

[Source](../../src/committee/client.ts#L295)

```ts
import {gatherCommitteeToken} from 'tasra-sdk/committee'

declare function gatherCommitteeToken(opts: GatherCommitteeTokenOpts): Promise<CompoundTokenWire>
```

| Parameter | Type | Description |
|---|---|---|
| `opts` | `GatherCommitteeTokenOpts` |  |

Returns: `Promise<CompoundTokenWire>`.

## GatherCommitteeTokenOpts

See the declaration and linked source for the contract.

[Source](../../src/committee/client.ts#L258)

```ts
export interface GatherCommitteeTokenOpts {
  /** Candidate verifiers to ask (index → base URL). Asking the whole registry is
   *  fine — non-drawn verifiers reply 403 and are skipped. */
  verifiers: Array<{index: number; url: string}>
  authorize: CommitteeAuthorizeBody
  /** The slot's verifierPolicy quorum (minimum distinct committee signatures). */
  quorum: number
  /**
   * Observe the raw replies. Added rather than widening the return type, which
   * would break every existing caller for a diagnostic.
   *
   * `reference` is the reply whose `vpHash`/`ruleHash` were used to build the
   * token — so anything read from it describes the SAME evaluation the token
   * carries, which matters when verifiers straddle an amendment and disagree
   * about the rule version.
   */
  onReplies?: (all: CommitteeAuthorizeReply[], reference: CommitteeAuthorizeReply) => void
  /**
   * A holder proof PER VERIFIER, overriding `authorize.holderProof` for that verifier.
   *
   * ⚠ ONE HOLDER PROOF DOES NOT SERVE A COMMITTEE. A proof is bound to a nonce that is a
   * row in ONE verifier's store and `consume` is an atomic take — so one proof fanned to k
   * verifiers is spent by whichever answers first and the rest 401 under
   * `require_holder_binding`. This callback lets the caller mint one proof per drawn
   * verifier (nonce from THAT verifier, its audience, the same credentials + slot). Called
   * once per candidate verifier, concurrently; a rejection fails that verifier only, so a
   * quorum can still be reached from the others.
   */
  holderProofFor?: (verifier: {index: number; url: string}) => Promise<string> | string
}
```

## holderProofPerVerifier

One holder proof-of-possession per drawn verifier: fetch THAT verifier's nonce, sign it
with the holder key over the same credentials + slot, hand it back for that verifier only.
Pass the result as `holderProof` to {@link requestCommitteeToken} (or the one-call
helpers built on it).

[Source](../../src/committee/request.ts#L69)

```ts
import {holderProofPerVerifier} from 'tasra-sdk/committee'

declare function holderProofPerVerifier(opts: { signer: HolderSigner; audience: string; credentials: string[]; slotId?: string; action?: string; ttlSecs?: number; }): HolderProofPerVerifier
```

| Parameter | Type | Description |
|---|---|---|
| `opts` | `{ signer: HolderSigner; audience: string; credentials: string[]; slotId?: string; action?: string; ttlSecs?: number; }` |  |

Returns: `HolderProofPerVerifier`.

## HolderProofPerVerifier

A holder proof minted PER VERIFIER — see {@link holderProofPerVerifier}.

⚠ A single proof cannot serve a committee: it is bound to a nonce that lives in ONE
verifier's store, consumed atomically, so the first verifier to answer spends it and the
rest refuse (401) under `require_holder_binding`. Pass a function instead of a string and
the gather asks each candidate verifier for its own nonce.

[Source](../../src/committee/request.ts#L61)

```ts
export type HolderProofPerVerifier = (verifier: CommitteeVerifier) => Promise<string> | string
```

## ibeDecryptRequest

One-call identity-scoped decrypt (the read path): token → extraction fan-out
→ verify each partial → combine → decrypt. The intermediate `sk_ID` never surfaces.

[Source](../../src/committee/request.ts#L473)

```ts
import {ibeDecryptRequest} from 'tasra-sdk/committee'

declare function ibeDecryptRequest(opts: IbeExtractRequestOpts & { ciphertext: IbeCiphertext; }): Promise<Uint8Array>
```

| Parameter | Type | Description |
|---|---|---|
| `opts` | `IbeExtractRequestOpts & { ciphertext: IbeCiphertext; }` |  |

Returns: `Promise<Uint8Array<ArrayBufferLike>>`.

## IbeExtractionPartial

One node's extraction partial, decoded from the wire.

[Source](../../src/committee/client.ts#L479)

```ts
export interface IbeExtractionPartial {
  /** The node's BLS group identifier (1..n). */
  identifier: number
  /** 48-byte compressed G1 partial `D_i = sk_i · Q_ID`. */
  value: Uint8Array
  /** The node's 96-byte G2 verifying share (the dual-group reply's first half). */
  verifyingShareG2: Uint8Array
  /** Slot epoch when served. */
  epoch: number
  /** The node that served it (for identifiable-abort reporting). */
  nodeUrl: string
}
```

## IbeExtractOpts

See the declaration and linked source for the contract.

[Source](../../src/committee/client.ts#L492)

```ts
export interface IbeExtractOpts {
  /** Base URLs of ≥ k keeper nodes holding the slot's BLS shards. */
  nodeUrls: string[]
  /** MUST be identity-scoped: the keeper enforces `identity_hash == keccak256(identity)`. */
  committeeToken: CompoundTokenWire
  /** The requested IBE identity, in the clear (the node computes Q_ID from it). */
  identity: string
  /** Owner signature over `keccak256("keykeeper:ibe-extract:v1" ‖ identity)` when the
   *  slot has a registered `user_pubkey`. */
  userSignature?: Uint8Array
  ciphertextEpoch?: number
  verifierProofs?: VerifierProof[]
  /** client request signature (see {@link CommitteeSignOpts}). */
  clientPubkey?: Uint8Array
  clientSignature?: Uint8Array
}
```

## ibeExtractRequest

Resolve an identity-scoped committee token, fan out for extraction partials, verify
each (identifiable abort — the error names the node), and return `sk_ID` (48-byte
compressed G1).

⚠ CUSTODY OPT-IN: holding `sk_ID` is a durable capability over every past and future
ciphertext to this identity. Prefer {@link ibeDecryptRequest}, which combines,
decrypts and drops it. Zeroize the returned bytes when done.

[Source](../../src/committee/request.ts#L459)

```ts
import {ibeExtractRequest} from 'tasra-sdk/committee'

declare function ibeExtractRequest(opts: IbeExtractRequestOpts): Promise<Uint8Array>
```

| Parameter | Type | Description |
|---|---|---|
| `opts` | `IbeExtractRequestOpts` |  |

Returns: `Promise<Uint8Array<ArrayBufferLike>>`.

## IbeExtractRequestOpts

Operation-specific fields for {@link ibeDecryptRequest} / {@link ibeExtractRequest}.

[Source](../../src/committee/request.ts#L439)

```ts
export interface IbeExtractRequestOpts extends RequestCommitteeTokenOpts {
  /** Base URLs of ≥ k keeper nodes holding the slot's BLS shards. */
  nodeUrls: string[]
  /** The IBE identity to extract for — becomes the token's `scopedIdentity`, so a quorum
   *  attests exactly this identity and the keepers enforce the hash binding. */
  identity: string
  /** Owner signature over the identity-bound extract marker, when the slot has one. */
  userSignature?: Uint8Array
  ciphertextEpoch?: number
}
```

## merkleProof

The inclusion proof (sibling hashes, leaf→root) for `index` in `leaves`. `null` if `index`
is out of range. Mirrors the reference `merkle_proof`; pairs with [`verifyMerkleProof`].

[Source](../../src/committee/token.ts#L267)

```ts
import {merkleProof} from 'tasra-sdk/committee'

declare function merkleProof(leaves: Uint8Array[], index: number): Uint8Array[] | null
```

| Parameter | Type | Description |
|---|---|---|
| `leaves` | `Uint8Array<ArrayBufferLike>[]` |  |
| `index` | `number` |  |

Returns: `Uint8Array<ArrayBufferLike>[] | null`.

## merkleRoot

Build the Merkle root over `leaves` (sorted-pair; an odd node is promoted unchanged to the
next level). `null` for an empty set. Byte-identical to the reference `merkle_root`, so a root
built here matches the on-chain `VerifierSetRegistry`/`Settlement` anchored root.

[Source](../../src/committee/token.ts#L256)

```ts
import {merkleRoot} from 'tasra-sdk/committee'

declare function merkleRoot(leaves: Uint8Array[]): Uint8Array | null
```

| Parameter | Type | Description |
|---|---|---|
| `leaves` | `Uint8Array<ArrayBufferLike>[]` |  |

Returns: `Uint8Array<ArrayBufferLike> | null`.

## normalizeOrigin

Normalise an origin the way the reference endpoint normaliser
does: trim, drop a trailing slash, lower-case the scheme and authority, keep the path as
written.

⚠ The PATH keeps its case deliberately — a path is case-sensitive, and lower-casing it
would silently rewrite an agent deployed under `/API`.

[Source](../../src/committee/oauth.ts#L27)

```ts
import {normalizeOrigin} from 'tasra-sdk/committee'

declare function normalizeOrigin(url: string): string
```

| Parameter | Type | Description |
|---|---|---|
| `url` | `string` |  |

Returns: `string`.

## opAttestationHash

The hash a keeper signs to attest it served `opId` on `slotId` under the token `tokenHash`.

[Source](../../src/committee/token.ts#L199)

```ts
import {opAttestationHash} from 'tasra-sdk/committee'

declare function opAttestationHash(chainId: number | bigint, opId: Uint8Array, slotId: Uint8Array, tokenHash: Uint8Array): Uint8Array
```

| Parameter | Type | Description |
|---|---|---|
| `chainId` | `number &#124; bigint` |  |
| `opId` | `Uint8Array<ArrayBufferLike>` |  |
| `slotId` | `Uint8Array<ArrayBufferLike>` |  |
| `tokenHash` | `Uint8Array<ArrayBufferLike>` |  |

Returns: `Uint8Array<ArrayBufferLike>`.

## platformAudience

The OAuth audience the tenant registers with its IdP and every rule pins:
`{origin}/authz/{chainId}`.

The chain id is in it so a token minted for a testnet deployment of the same platform
cannot authorize on mainnet.

[Source](../../src/committee/oauth.ts#L46)

```ts
import {platformAudience} from 'tasra-sdk/committee'

declare function platformAudience(origin: string, chainId: number | bigint): string
```

| Parameter | Type | Description |
|---|---|---|
| `origin` | `string` |  |
| `chainId` | `number &#124; bigint` |  |

Returns: `string`.

## requestCommitteeToken

See the declaration and linked source for the contract.

[Source](../../src/committee/request.ts#L289)

```ts
import {requestCommitteeToken} from 'tasra-sdk/committee'

declare function requestCommitteeToken(opts: RequestCommitteeTokenOpts): Promise<CommitteeTokenResult>
```

| Parameter | Type | Description |
|---|---|---|
| `opts` | `RequestCommitteeTokenOpts` |  |

Returns: `Promise<CommitteeTokenResult>`.

## RequestCommitteeTokenOpts

See the declaration and linked source for the contract.

[Source](../../src/committee/request.ts#L160)

```ts
export interface RequestCommitteeTokenOpts {
  chain: CommitteeChainReads
  /** Pin the draw to `latest - epochLag` (0 or 1). 1 = the previous epoch, always anchored: no wait for the accountants. */
  epochLag?: number
  /** The active verifier set (index→url; add operator+pubkey to enable trustless proofs).
   *  Asking the whole set is fine — non-drawn verifiers reply 403 and are skipped. */
  verifiers: CommitteeVerifier[]
  /** 0x-prefixed 32-byte slot id. */
  slotId: string
  /** Holder DID (the credentials' subject). */
  holder: string
  /** Compact-JWS verifiable credentials. */
  credentials: string[]
  /**
   * Holder proof-of-possession. Required by default — it is what stops a stolen
   * credential being replayed by someone who did not earn it.
   *
   * ⚠ Optional only because the SERVER makes it optional: `holder_proof` is an
   * `Option` and a verifier with `require_holder_binding = false` accepts the
   * request without one. A client that refuses what the server accepts is the
   * same defect as one that demands a field the server ignores — it makes a
   * valid deployment unreachable. The opt-out is explicit so it cannot happen by
   * forgetting to pass a value.
   */
  holderProof?: string | HolderProofPerVerifier
  /** Send no holder proof. Only valid against `require_holder_binding = false`. */
  allowNoHolderProof?: boolean
  /** Token type — default `'JWT'`. */
  tokenType?: TokenType
  /** Token TTL in seconds — default 300. */
  ttlSecs?: number
  /** Override "now" (unix seconds), mainly for tests. */
  nowSecs?: number
  /** sign the request bundle with the holder's key so the keeper + audit can verify
   *  the user authorized this operation. Omit to skip (keeper accepts unless it requires it). */
  clientSigner?: ClientSigner
  /**
   * The requested IBE identity, for an identity-scoped operation ONLY (maps
   * to the wire field `identity`). The committee evaluates the slot's scope binding
   * against it and the token carries `identity_hash = keccak256(identity)` — a quorum
   * attests THIS identity, keepers refuse the token on every identity-blind endpoint,
   * and the extraction endpoint enforces the hash binding. Omit for sign/decrypt.
   *
   * ⚠ Named `scopedIdentity`, deliberately: `CommitteeDecryptRequestOpts.identity` is
   * the KEM's SENDER identity (AEAD associated data) — an unrelated concept that must
   * never be confused with the WHICH-gate binding.
   */
  scopedIdentity?: string
}
```

## requestIbeExtractionPartials

Fan out to the keeper nodes and collect extraction partials. Nodes that refuse or are
down are skipped; throws — naming every node and its reason — only when NONE served.
The caller combines with `ibeCombineDecrypt`/`ibeCombineExtract`, which pairing-verify
each partial (identifiable abort names the node via the identifier).

[Source](../../src/committee/client.ts#L552)

```ts
import {requestIbeExtractionPartials} from 'tasra-sdk/committee'

declare function requestIbeExtractionPartials(opts: IbeExtractOpts): Promise<IbeExtractionPartial[]>
```

| Parameter | Type | Description |
|---|---|---|
| `opts` | `IbeExtractOpts` |  |

Returns: `Promise<IbeExtractionPartial[]>`.

## selectVerifierCommittee

Deterministically select `count` distinct verifier indexes in `[0, registrySize)` for one
request: `index = keccak256(SELECT_DOMAIN ‖ slotId ‖ epoch(u64 BE) ‖ seed ‖ iter(u64 BE)) mod registrySize`,
skipping a repeat and incrementing `iter`. Identical, identically-ordered to what the
verifier selects and the keeper reconstructs.

[Source](../../src/committee/token.ts#L85)

```ts
import {selectVerifierCommittee} from 'tasra-sdk/committee'

declare function selectVerifierCommittee(slotId: Uint8Array, epoch: number | bigint, seed: Uint8Array, registrySize: number, count: number): number[]
```

| Parameter | Type | Description |
|---|---|---|
| `slotId` | `Uint8Array<ArrayBufferLike>` |  |
| `epoch` | `number &#124; bigint` |  |
| `seed` | `Uint8Array<ArrayBufferLike>` |  |
| `registrySize` | `number` |  |
| `count` | `number` |  |

Returns: `number[]`.

## TokenType

See the declaration and linked source for the contract.

[Source](../../src/committee/token.ts#L25)

```ts
export type TokenType = 'JWT' | 'refresh'
```

## VerifiedToken

What a valid compound token attests.

[Source](../../src/committee/token.ts#L296)

```ts
export interface VerifiedToken {
  slotId: Uint8Array
  vpHash: Uint8Array
  /** The holder a quorum attested — the value a distinctness rule keys on. */
  holderHash: Uint8Array
  /** the quorum-attested identity binding — present iff the token is scoped. */
  identityHash?: Uint8Array
  epoch: number | bigint
  tokenType: TokenType
  verifiedSigners: number[]
}
```

## verifierLeaf

`keccak256(DOMAIN ‖ index(u32 BE) ‖ operator(20) ‖ keccak256(pubkey))` — matches the on-chain leaf.

[Source](../../src/committee/token.ts#L225)

```ts
import {verifierLeaf} from 'tasra-sdk/committee'

declare function verifierLeaf(index: number, operator: Uint8Array, pubkey: Uint8Array): Uint8Array
```

| Parameter | Type | Description |
|---|---|---|
| `index` | `number` |  |
| `operator` | `Uint8Array<ArrayBufferLike>` |  |
| `pubkey` | `Uint8Array<ArrayBufferLike>` |  |

Returns: `Uint8Array<ArrayBufferLike>`.

## VerifierProof

Trustless verifier-set inclusion proof, passed to the keeper.

[Source](../../src/committee/client.ts#L39)

```ts
export interface VerifierProof {
  verifierIndex: number
  /** 20-byte operator address (hex). */
  operator: string
  /** 32-byte ed25519 pubkey (hex). */
  pubkey: string
  /** Sorted-pair keccak Merkle proof (each 32-byte hex). */
  proof: string[]
}
```

## VerifierSet

The active verifier set: registry size + index→ed25519 pubkey (32 bytes).

[Source](../../src/committee/token.ts#L290)

```ts
export interface VerifierSet {
  registrySize: number
  pubkeys: Map<number, Uint8Array>
}
```

## verifyCompoundToken

Re-verify a compound token exactly as the keeper does: bind `ruleHash` to the slot's
rule hash, reconstruct the committee, bind the claimed committee, check freshness,
ed25519-verify each signature over the canonical hash, then require a quorum of the drawn
committee.

Takes an options object rather than positional arguments: it needs four numbers
(`committee`, `quorum`, `now`, `leeway`), and transposing any two of them
compiled cleanly and failed at runtime — `quorum`/`committee` swapped reads as a
quorum failure, `now`/`leeway` swapped reads as an expired token.

[Source](../../src/committee/token.ts#L369)

```ts
import {verifyCompoundToken} from 'tasra-sdk/committee'

declare function verifyCompoundToken(opts: VerifyCompoundTokenOptions): VerifiedToken
```

| Parameter | Type | Description |
|---|---|---|
| `opts` | `VerifyCompoundTokenOptions` |  |

Returns: `VerifiedToken`.

Return details: the attested fields on success

Throws: {Error} on ANY failure — rule mismatch, wrong committee draw, expiry,
an unknown or invalid signer, or an unmet quorum

Example from source:

```ts
const attested = verifyCompoundToken({
  token: decodeCompoundToken(wire),
  set: verifierSet,
  committee: 5,
  quorum: 3,
  now: Math.floor(Date.now() / 1000),
  leeway: 30,
  slotRuleHash,
})
```

## VerifyCompoundTokenOptions

Everything {@link verifyCompoundToken} needs.

[Source](../../src/committee/token.ts#L319)

```ts
export interface VerifyCompoundTokenOptions {
  /** The decoded token, signatures included (see `decodeCompoundToken`). */
  token: CompoundTokenPayload & {signatures: CommitteeSignature[]}
  /** The active verifier set to verify signatures against. */
  set: VerifierSet
  /** Committee size — how many verifiers the on-chain draw selects. */
  committee: number
  /** Minimum co-signatures required *from the drawn committee*. */
  quorum: number
  /** Current time, UNIX **seconds**. */
  now: number
  /** Clock-skew tolerance, **seconds**, applied to both `iat` and `exp`. */
  leeway: number
  /**
   * `keccak256` of the slot's RAW rule (UNSALTED); the token's `ruleHash` must equal it.
   *
   * ⚠ NOT the on-chain `KeySlot.ruleCommitment`, which is salted — the keeper computes
   * this as `keccak256(rule)` over the rule text it fetched, exactly as here.
   */
  slotRuleHash: Uint8Array
}
```

## verifyMerkleProof

Verify a sorted-pair keccak Merkle inclusion proof (leaf→root).

[Source](../../src/committee/token.ts#L234)

```ts
import {verifyMerkleProof} from 'tasra-sdk/committee'

declare function verifyMerkleProof(leaf: Uint8Array, proof: Uint8Array[], root: Uint8Array): boolean
```

| Parameter | Type | Description |
|---|---|---|
| `leaf` | `Uint8Array<ArrayBufferLike>` |  |
| `proof` | `Uint8Array<ArrayBufferLike>[]` |  |
| `root` | `Uint8Array<ArrayBufferLike>` |  |

Returns: `boolean`.

## Constants and ABI values

| Export | Definition |
|---|---|
| `OAUTH_RESPONSE_PATH` | [Source](../../src/committee/oauth.ts#L17) |
