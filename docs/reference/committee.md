# tasra-sdk/committee

Generated from public TypeScript exports.

[SDK reference](README.md) · [Task guides](../README.md) · [Errors](../errors.md)

## Classes

Clients, adapters and error classes.

<details>
<summary>Browse 2 classes</summary>

- [CommitteeAuthorizeError](#committeeauthorizeerror)
- [OperationOutcomeUnknownError](#operationoutcomeunknownerror)

</details>

### CommitteeAuthorizeError

A verifier refused to co-sign a committee token. Extends
` TasraHttpError `, so `.status`, `.url`, `.body`, and `.retryable` are
all available and `isAuthDenied()` recognises a 401/403 here too.

Distinct from a generic HTTP error because the committee flow polls several
verifiers and tolerates individual refusals as long as a quorum co-signs - see
` ThresholdNotMetError ` for the failure that means the quorum was missed.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/client.ts#L71)

Import: `import {CommitteeAuthorizeError} from 'tasra-sdk/committee'`

```ts
declare class CommitteeAuthorizeError {
    constructor(status: number, message: string, opts?: {
        url?: string;
        body?: string;
    });
}
```

- ` readonly status: number; ` — HTTP status code returned by the service.

- ` readonly url: string; ` — Service URL that failed.

- ` readonly body: string; ` — Response body retained as diagnostic information.

- ` readonly retryable: boolean; ` — `false` when retrying the identical request cannot succeed.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

### OperationOutcomeUnknownError

A signing request may have been accepted despite a transport or response failure. Reconcile before resubmitting.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/dual-sign.ts#L14)

Import: `import {OperationOutcomeUnknownError} from 'tasra-sdk/committee'`

```ts
declare class OperationOutcomeUnknownError {
    constructor(operation: 'dual-create' | 'dual-approve', requestId?: string, cause?: unknown);
}
```

- ` readonly operation: 'dual-create' | 'dual-approve'; ` — Request phase whose submission outcome must be reconciled.

- ` readonly requestId?: string; ` — Existing native signing request identifier, when known.

- ` readonly retryable: boolean; ` — `false` when retrying the identical request cannot succeed.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

## Functions

Operations you can import and call.

<details>
<summary>Browse 37 functions</summary>

- [assembleCompoundToken](#assemblecompoundtoken)
- [auditOperationId](#auditoperationid)
- [buildVerifierProofs](#buildverifierproofs)
- [clientBindingHash](#clientbindinghash)
- [committeeAuthorize](#committeeauthorize)
- [committeeChainReadsFromClient](#committeechainreadsfromclient)
- [committeeDecrypt](#committeedecrypt)
- [committeeDecryptRequest](#committeedecryptrequest)
- [committeeSign](#committeesign)
- [committeeSignEoaDigest](#committeesigneoadigest)
- [committeeSignRequest](#committeesignrequest)
- [compoundTokenCanonicalBytes](#compoundtokencanonicalbytes)
- [compoundTokenHash](#compoundtokenhash)
- [createDualSignClient](#createdualsignclient)
- [decodeCompoundToken](#decodecompoundtoken)
- [decodeOperationReceipt](#decodeoperationreceipt)
- [decryptIdentityStrict](#decryptidentitystrict)
- [dpopHtu](#dpophtu)
- [dualSignApprovalPayload](#dualsignapprovalpayload)
- [ed25519ClientSigner](#ed25519clientsigner)
- [extractIdentityStrict](#extractidentitystrict)
- [gatherCommitteeToken](#gathercommitteetoken)
- [holderProofPerVerifier](#holderproofperverifier)
- [ibeDecryptRequest](#ibedecryptrequest)
- [ibeExtractRequest](#ibeextractrequest)
- [merkleProof](#merkleproof)
- [merkleRoot](#merkleroot)
- [normalizeOrigin](#normalizeorigin)
- [opAttestationHash](#opattestationhash)
- [platformAudience](#platformaudience)
- [requestCommitteeToken](#requestcommitteetoken)
- [requestIbeExtractionPartials](#requestibeextractionpartials)
- [selectVerifierCommittee](#selectverifiercommittee)
- [verifierLeaf](#verifierleaf)
- [verifyCompoundToken](#verifycompoundtoken)
- [verifyMerkleProof](#verifymerkleproof)
- [verifyOperationReceipt](#verifyoperationreceipt)

</details>

### assembleCompoundToken

Encode a token payload and verifier signatures into the keeper JSON wire format. This does not verify signatures.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/token.ts#L480)

Import: `import {assembleCompoundToken} from 'tasra-sdk/committee'`

```ts
declare function assembleCompoundToken(p: CompoundTokenPayload, signatures: CommitteeSignature[]): CompoundTokenWire;
```

| Parameter | Type | Description |
|---|---|---|
| ` p ` | ` CompoundTokenPayload ` | - Compound token payload, excluding signatures. |
| ` signatures ` | ` CommitteeSignature[] ` | - Verifier signatures to include in the wire object. |

Returns: ` CompoundTokenWire `.

### auditOperationId

Deterministic operation ID, matching keykeeper_committee::audit_op_id.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/receipts.ts#L49)

Import: `import {auditOperationId} from 'tasra-sdk/committee'`

```ts
declare function auditOperationId(slotId: Uint8Array, operation: 'sign' | 'decrypt' | 'ibe-extract', tokenHash: Uint8Array, payloadDigest: Uint8Array): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` slotId ` | ` Uint8Array ` | - 32-byte slot identifier. |
| ` operation ` | ` 'sign' \| 'decrypt' \| 'ibe-extract' ` | - Operation name bound into the audit identifier. |
| ` tokenHash ` | ` Uint8Array ` | - 32-byte compound token hash. |
| ` payloadDigest ` | ` Uint8Array ` | - 32-byte operation payload digest. |

Returns: ` Uint8Array `.

### buildVerifierProofs

Build snapshot-inclusion proofs for the token's `signerIndexes` from the full ordered verifier
directory. Returns `undefined` (never a wrong proof) when the directory is incomplete, a key is
missing, or the reconstructed root disagrees with the anchored `snapshotRoot` - so a mismatch
degrades to the keeper's configured-set path rather than shipping a proof the keeper rejects.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/request.ts#L239)

Import: `import {buildVerifierProofs} from 'tasra-sdk/committee'`

```ts
declare function buildVerifierProofs(verifiers: CommitteeVerifier[], registrySize: number, signerIndexes: number[], snapshotRoot?: Uint8Array): VerifierProof[] | undefined;
```

| Parameter | Type | Description |
|---|---|---|
| ` verifiers ` | ` CommitteeVerifier[] ` | - Complete verifier directory including indices, operators and public keys. |
| ` registrySize ` | ` number ` | - Expected number of registry entries. |
| ` signerIndexes ` | ` number[] ` | - Verifier indices whose inclusion proofs are required. |
| ` snapshotRoot? ` | ` Uint8Array ` | - Optional independently anchored verifier snapshot root. |

Returns: ` VerifierProof[] | undefined `.

### clientBindingHash

The 32-byte hash the client (== the credential holder) signs to attest it authorized this
operation on `slotId` under the compound token whose canonical hash is `tokenHash`:
`keccak256(DOMAIN || slotId || tokenHash)`. Byte-identical to the reference `client_binding_hash`, so
the keeper (hot path) and accountant (audit) verify the client signature over the same bytes.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/token.ts#L225)

Import: `import {clientBindingHash} from 'tasra-sdk/committee'`

```ts
declare function clientBindingHash(slotId: Uint8Array, tokenHash: Uint8Array): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` slotId ` | ` Uint8Array ` | - 32-byte slot identifier. |
| ` tokenHash ` | ` Uint8Array ` | - 32-byte compound token hash. |

Returns: ` Uint8Array `.

### committeeAuthorize

Ask one verifier to authorize the request. Throws CommitteeAuthorizeError
 (with `.status`) on a non-2xx - notably 403 when this verifier wasn't drawn.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/client.ts#L210)

Import: `import {committeeAuthorize} from 'tasra-sdk/committee'`

```ts
declare function committeeAuthorize(verifierUrl: string, body: CommitteeAuthorizeBody): Promise<CommitteeAuthorizeReply>;
```

| Parameter | Type | Description |
|---|---|---|
| ` verifierUrl ` | ` string ` | - Verifier HTTP base URL. |
| ` body ` | ` CommitteeAuthorizeBody ` | - Credential presentation and operation context for this verifier. |

Returns: ` Promise<CommitteeAuthorizeReply> `.

### committeeChainReadsFromClient

Adapt the SDK chain client's `readers` into [CommitteeChainReads](#committeechainreads).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/request.ts#L145)

Import: `import {committeeChainReadsFromClient} from 'tasra-sdk/committee'`

```ts
declare function committeeChainReadsFromClient(readers: {
    beacon: {
        seed(): Promise<unknown>;
        epoch(): Promise<unknown>;
        seedAt?(epoch: bigint): Promise<unknown>;
    };
    keyRegistry: {
        verifierPolicy(id: `0x${string}`): Promise<readonly [
            number,
            number
        ]>;
    };
    verifierSet?: {
        snapshotAt(epoch: bigint): Promise<unknown>;
    };
}): CommitteeChainReads;
```

| Parameter | Type | Description |
|---|---|---|
| ` readers ` | See detailed type below. | - Chain reader methods for the beacon, slot verifier policy and optional verifier snapshots. |

**` readers ` type**

```ts
{
    beacon: {
        seed(): Promise<unknown>;
        epoch(): Promise<unknown>;
        seedAt?(epoch: bigint): Promise<unknown>;
    };
    keyRegistry: {
        verifierPolicy(id: `0x${string}`): Promise<readonly [
            number,
            number
        ]>;
    };
    verifierSet?: {
        snapshotAt(epoch: bigint): Promise<unknown>;
    };
}
```

Returns: ` CommitteeChainReads `.

### committeeDecrypt

Decrypt via committee authorization. The slot id is taken from the token.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/client.ts#L488)

Import: `import {committeeDecrypt} from 'tasra-sdk/committee'`

```ts
declare function committeeDecrypt(opts: CommitteeDecryptOpts): Promise<Uint8Array>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` CommitteeDecryptOpts ` | - Keeper endpoint, compound authorization, ciphertext and associated data. |

Returns: ` Promise<Uint8Array> `.

### committeeDecryptRequest

One-call committee-authorized threshold decrypt.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/request.ts#L440)

Import: `import {committeeDecryptRequest} from 'tasra-sdk/committee'`

```ts
declare function committeeDecryptRequest(opts: CommitteeDecryptRequestOpts): Promise<Uint8Array>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` CommitteeDecryptRequestOpts ` | - Token request settings, keeper endpoint, ciphertext and associated data. |

Returns: ` Promise<Uint8Array> `.

### committeeSign

Sign via committee authorization. The slot id is taken from the token.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/client.ts#L412)

Import: `import {committeeSign} from 'tasra-sdk/committee'`

```ts
declare function committeeSign(opts: CommitteeSignOpts): Promise<FrostSignResult>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` CommitteeSignOpts ` | - Keeper endpoint, compound authorization and message to sign. |

Returns: ` Promise<FrostSignResult> `.

### committeeSignEoaDigest

Sign an Ethereum digest using credential-based committee authorization.
Open the verifier-agent session with action `sign` and message equal to `digest`.
The keeper checks the token's request binding against SHA-256(digest), then
threshold-signs the original digest. This never falls back to JWT authorization.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/ecdsa.ts#L40)

Import: `import {committeeSignEoaDigest} from 'tasra-sdk/committee'`

```ts
declare function committeeSignEoaDigest(opts: CommitteeEoaSignOpts): Promise<EoaSignature>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` CommitteeEoaSignOpts ` | - Compound authorization, keeper endpoint and 32-byte ECDSA digest. |

Returns: ` Promise<EoaSignature> `.

Return details: Ethereum signature components and the secp256k1 group public key.

Throws: On malformed input/response, network failure, or keeper rejection.
HTTP 401/403 is an authorization denial; do not retry it as a network failure.

### committeeSignRequest

One-call committee-authorized threshold sign: resolve token (+proofs) then POST to the keeper.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/request.ts#L399)

Import: `import {committeeSignRequest} from 'tasra-sdk/committee'`

```ts
declare function committeeSignRequest(opts: CommitteeSignRequestOpts): Promise<FrostSignResult>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` CommitteeSignRequestOpts ` | - Token request settings, keeper endpoint and message to sign. |

Returns: ` Promise<FrostSignResult> `.

### compoundTokenCanonicalBytes

Canonical, domain-separated, length-prefixed byte encoding hashed for signing.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/token.ts#L157)

Import: `import {compoundTokenCanonicalBytes} from 'tasra-sdk/committee'`

```ts
declare function compoundTokenCanonicalBytes(p: CompoundTokenPayload): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` p ` | ` CompoundTokenPayload ` | - Compound token payload, excluding signatures. |

Returns: ` Uint8Array `.

### compoundTokenHash

`keccak256` of the canonical bytes - the value each quorum verifier signs.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/token.ts#L189)

Import: `import {compoundTokenHash} from 'tasra-sdk/committee'`

```ts
declare function compoundTokenHash(p: CompoundTokenPayload): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` p ` | ` CompoundTokenPayload ` | - Compound token payload, excluding signatures. |

Returns: ` Uint8Array `.

### createDualSignClient

Native multi-approver FROST lifecycle. Never falls back to a JWT route or creates
a new request after an ambiguous POST. All approval and result checks use the
original expected message, slot, public key and quorum, not server-selected values.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/dual-sign.ts#L122)

Import: `import {createDualSignClient} from 'tasra-sdk/committee'`

```ts
declare function createDualSignClient(input: DualSignConfig): {
    create(message: Uint8Array, options?: {
        signal?: AbortSignal;
    }): Promise<DualSignRequest>;
    resume(requestId: string, expectedMessage: Uint8Array): DualSignRequest;
};
```

| Parameter | Type | Description |
|---|---|---|
| ` input ` | ` DualSignConfig ` | - Trusted slot key, keeper endpoint and required approver policy. |

Returns:

```ts
{
    create(message: Uint8Array, options?: {
        signal?: AbortSignal;
    }): Promise<DualSignRequest>;
    resume(requestId: string, expectedMessage: Uint8Array): DualSignRequest;
}
```

### decodeCompoundToken

Decode a wire compound token into the byte-level payload + signatures for verification.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/token.ts#L504)

Import: `import {decodeCompoundToken} from 'tasra-sdk/committee'`

```ts
declare function decodeCompoundToken(w: CompoundTokenWire): CompoundTokenPayload & {
    signatures: CommitteeSignature[];
};
```

| Parameter | Type | Description |
|---|---|---|
| ` w ` | ` CompoundTokenWire ` | - Keeper JSON token representation to decode into byte fields. |

Returns:

```ts
CompoundTokenPayload & {
    signatures: CommitteeSignature[];
}
```

### decodeOperationReceipt

Decode the optional receipt tuple. Incomplete tuples are protocol errors.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/receipts.ts#L32)

Import: `import {decodeOperationReceipt} from 'tasra-sdk/committee'`

```ts
declare function decodeOperationReceipt(reply: {
    op_id?: unknown;
    token_hash?: unknown;
    op_attestation?: unknown;
}): OperationReceipt | undefined;
```

| Parameter | Type | Description |
|---|---|---|
| ` reply ` | ` { op_id?: unknown; token_hash?: unknown; op_attestation?: unknown; } ` | - Keeper response fields for operation identifier, token hash and signature. |

Returns: ` OperationReceipt | undefined `.

### decryptIdentityStrict

Decrypt an IBE ciphertext and clear the intermediate identity key on every exit.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/extraction.ts#L144)

Import: `import {decryptIdentityStrict} from 'tasra-sdk/committee'`

```ts
declare function decryptIdentityStrict(opts: StrictExtractionOptions & {
    ciphertext: IbeCiphertext;
}): Promise<Omit<StrictExtractionResult, 'key'> & {
    plaintext: Uint8Array;
}>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` StrictExtractionOptions & { ciphertext: IbeCiphertext; } ` | - Strict extraction requirements plus the IBE ciphertext to decrypt. |

Returns:

```ts
Promise<Omit<StrictExtractionResult, 'key'> & {
    plaintext: Uint8Array;
}>
```

### dpopHtu

The `htu` (RFC 9449) a DPoP proof for an OAuth response must carry:
`{origin}/v1/sessions/oauth-response`.

Session-INDEPENDENT, deliberately: RFC 9449 defines `htu` as the request URI WITHOUT query
or fragment, and a client library that derives it from the URL it is about to call - which
every conformant one does - produces this string, not one carrying a session id. The
session is already bound by the `nonce`.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/oauth.ts#L66)

Import: `import {dpopHtu} from 'tasra-sdk/committee'`

```ts
declare function dpopHtu(origin: string): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` origin ` | ` string ` | - Platform origin used to derive the OAuth response target. |

Returns: ` string `.

### dualSignApprovalPayload

Exact existing Rust canonical_dual_sig_payload, including little-endian lengths.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/dual-sign.ts#L35)

Import: `import {dualSignApprovalPayload} from 'tasra-sdk/committee'`

```ts
declare function dualSignApprovalPayload(slotId: string, message: Uint8Array, requestId: string): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` slotId ` | ` string ` | - 32-byte slot identifier as hexadecimal text. |
| ` message ` | ` Uint8Array ` | - Original message bytes to authorize. |
| ` requestId ` | ` string ` | - Existing native signing request identifier. |

Returns: ` Uint8Array `.

### ed25519ClientSigner

A [ClientSigner](#clientsigner) from a 32-byte ed25519 secret key (the common `did:key` holder).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/request.ts#L96)

Import: `import {ed25519ClientSigner} from 'tasra-sdk/committee'`

```ts
declare function ed25519ClientSigner(secretKey: Uint8Array): ClientSigner;
```

| Parameter | Type | Description |
|---|---|---|
| ` secretKey ` | ` Uint8Array ` | - 32-byte Ed25519 secret seed used to sign client request bindings. |

Returns: ` ClientSigner `.

### extractIdentityStrict

Extract using a distinct assigned quorum, one epoch and the chain-anchored group key.
Read slot metadata before calling; this helper deliberately cannot authenticate caller
configuration. Never populate pinned shares from the extraction response itself.
All temporary partials are cleared even on rejection. No master key is reconstructed.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/extraction.ts#L82)

Import: `import {extractIdentityStrict} from 'tasra-sdk/committee'`

```ts
declare function extractIdentityStrict(input: StrictExtractionOptions): Promise<StrictExtractionResult>;
```

| Parameter | Type | Description |
|---|---|---|
| ` input ` | ` StrictExtractionOptions ` | - Expected slot key, epoch, quorum, keepers and authorized identity. |

Returns: ` Promise<StrictExtractionResult> `.

### gatherCommitteeToken

Fan out to the candidate verifiers, collect signatures from the drawn committee
until quorum, and assemble the compound token. Verifies that our locally
recomputed canonical token hash equals the hash the verifiers signed (a built-in
encoding cross-check). Returns the wire token to POST to the keeper.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/client.ts#L298)

Import: `import {gatherCommitteeToken} from 'tasra-sdk/committee'`

```ts
declare function gatherCommitteeToken(opts: GatherCommitteeTokenOpts): Promise<CompoundTokenWire>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` GatherCommitteeTokenOpts ` | - Verifier requests, committee draw and required signature quorum. |

Returns: ` Promise<CompoundTokenWire> `.

### holderProofPerVerifier

One holder proof-of-possession per drawn verifier: fetch THAT verifier's nonce, sign it
with the holder key over the same credentials + slot, hand it back for that verifier only.
Pass the result as `holderProof` to [requestCommitteeToken](#requestcommitteetoken) (or the one-call
helpers built on it).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/request.ts#L71)

Import: `import {holderProofPerVerifier} from 'tasra-sdk/committee'`

```ts
declare function holderProofPerVerifier(opts: {
    signer: HolderSigner;
    audience: string;
    credentials: string[];
    slotId?: string;
    action?: string;
    ttlSecs?: number;
}): HolderProofPerVerifier;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` { signer: HolderSigner; audience: string; credentials: string[]; slotId?: string; action?: string; ttlSecs?: number; } ` | - Holder signer, credentials, audience and optional operation binding. |

Returns: ` HolderProofPerVerifier `.

### ibeDecryptRequest

One-call identity-scoped decrypt (the read path): token to extraction fan-out
to verify each partial to combine to decrypt. The intermediate `sk_ID` never surfaces.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/request.ts#L501)

Import: `import {ibeDecryptRequest} from 'tasra-sdk/committee'`

```ts
declare function ibeDecryptRequest(opts: IbeExtractRequestOpts & {
    ciphertext: IbeCiphertext;
}): Promise<Uint8Array>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` IbeExtractRequestOpts & { ciphertext: IbeCiphertext; } ` | - Authorization context, identity and IBE ciphertext to decrypt. |

Returns: ` Promise<Uint8Array> `.

### ibeExtractRequest

Resolve an identity-scoped committee token, fan out for extraction partials, verify
each (identifiable abort - the error names the node), and return `sk_ID` (48-byte
compressed G1).

 CUSTODY OPT-IN: holding `sk_ID` is a durable capability over every past and future
ciphertext to this identity. Prefer [ibeDecryptRequest](#ibedecryptrequest), which combines,
decrypts and drops it. Zeroize the returned bytes when done.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/request.ts#L485)

Import: `import {ibeExtractRequest} from 'tasra-sdk/committee'`

```ts
declare function ibeExtractRequest(opts: IbeExtractRequestOpts): Promise<Uint8Array>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` IbeExtractRequestOpts ` | - Authorization context, keeper endpoints and requested identity. |

Returns: ` Promise<Uint8Array> `.

### merkleProof

The inclusion proof (sibling hashes, leaf to root) for `index` in `leaves`. `null` if `index`
is out of range. Mirrors the reference `merkle_proof`; pairs with [`verifyMerkleProof`].

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/token.ts#L291)

Import: `import {merkleProof} from 'tasra-sdk/committee'`

```ts
declare function merkleProof(leaves: Uint8Array[], index: number): Uint8Array[] | null;
```

| Parameter | Type | Description |
|---|---|---|
| ` leaves ` | ` Uint8Array[] ` | - Ordered Merkle leaf hashes. |
| ` index ` | ` number ` | - Zero-based index of the leaf to prove. |

Returns: ` Uint8Array[] | null `.

### merkleRoot

Build the Merkle root over `leaves` (sorted-pair; an odd node is promoted unchanged to the
next level). `null` for an empty set. Byte-identical to the reference `merkle_root`, so a root
built here matches the on-chain `VerifierSetRegistry`/`Settlement` anchored root.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/token.ts#L277)

Import: `import {merkleRoot} from 'tasra-sdk/committee'`

```ts
declare function merkleRoot(leaves: Uint8Array[]): Uint8Array | null;
```

| Parameter | Type | Description |
|---|---|---|
| ` leaves ` | ` Uint8Array[] ` | - Ordered Merkle leaf hashes. |

Returns: ` Uint8Array | null `.

### normalizeOrigin

Normalise an origin the way the reference endpoint normaliser
does: trim, drop a trailing slash, lower-case the scheme and authority, keep the path as
written.

 The PATH keeps its case deliberately - a path is case-sensitive, and lower-casing it
would silently rewrite an agent deployed under `/API`.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/oauth.ts#L29)

Import: `import {normalizeOrigin} from 'tasra-sdk/committee'`

```ts
declare function normalizeOrigin(url: string): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` url ` | ` string ` | - Endpoint text to normalize; scheme and authority are lowercased while the path is preserved. |

Returns: ` string `.

### opAttestationHash

The hash a keeper signs to attest it served `opId` on `slotId` under the token `tokenHash`.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/token.ts#L203)

Import: `import {opAttestationHash} from 'tasra-sdk/committee'`

```ts
declare function opAttestationHash(chainId: number | bigint, opId: Uint8Array, slotId: Uint8Array, tokenHash: Uint8Array): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` chainId ` | ` number \| bigint ` | - EVM chain identifier. |
| ` opId ` | ` Uint8Array ` | - 32-byte audit operation identifier. |
| ` slotId ` | ` Uint8Array ` | - 32-byte slot identifier. |
| ` tokenHash ` | ` Uint8Array ` | - 32-byte compound token hash. |

Returns: ` Uint8Array `.

### platformAudience

The OAuth audience the tenant registers with its IdP and every rule pins:
`{origin}/authz/{chainId}`.

The chain id is in it so a token minted for a testnet deployment of the same platform
cannot authorize on mainnet.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/oauth.ts#L51)

Import: `import {platformAudience} from 'tasra-sdk/committee'`

```ts
declare function platformAudience(origin: string, chainId: number | bigint): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` origin ` | ` string ` | - Platform origin used to derive the token audience. |
| ` chainId ` | ` number \| bigint ` | - EVM chain identifier for the selected network. |

Returns: ` string `.

### requestCommitteeToken

Read the verifier committee draw, request authorization and assemble the quorum token with available membership proofs.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/request.ts#L292)

Import: `import {requestCommitteeToken} from 'tasra-sdk/committee'`

```ts
declare function requestCommitteeToken(opts: RequestCommitteeTokenOpts): Promise<CommitteeTokenResult>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` RequestCommitteeTokenOpts ` | - Chain draw, verifier directory, credentials and holder authorization. |

Returns: ` Promise<CommitteeTokenResult> `.

### requestIbeExtractionPartials

Fan out to the keeper nodes and collect extraction partials. Nodes that refuse or are
down are skipped; throws - naming every node and its reason - only when NONE served.
The caller combines with `ibeCombineDecrypt`/`ibeCombineExtract`, which pairing-verify
each partial (identifiable abort names the node via the identifier).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/client.ts#L613)

Import: `import {requestIbeExtractionPartials} from 'tasra-sdk/committee'`

```ts
declare function requestIbeExtractionPartials(opts: IbeExtractOpts): Promise<IbeExtractionPartial[]>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` IbeExtractOpts ` | - Compound token, identity, keepers and optional expected epoch. |

Returns: ` Promise<IbeExtractionPartial[]> `.

### selectVerifierCommittee

Deterministically select `count` distinct verifier indexes in `[0, registrySize)` for one
request: `index = keccak256(SELECT_DOMAIN || slotId || epoch(u64 BE) || seed || iter(u64 BE)) mod registrySize`,
skipping a repeat and incrementing `iter`. Identical, identically-ordered to what the
verifier selects and the keeper reconstructs.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/token.ts#L92)

Import: `import {selectVerifierCommittee} from 'tasra-sdk/committee'`

```ts
declare function selectVerifierCommittee(slotId: Uint8Array, epoch: number | bigint, seed: Uint8Array, registrySize: number, count: number): number[];
```

| Parameter | Type | Description |
|---|---|---|
| ` slotId ` | ` Uint8Array ` | - 32-byte slot identifier. |
| ` epoch ` | ` number \| bigint ` | - Beacon epoch for the committee draw. |
| ` seed ` | ` Uint8Array ` | - 32-byte beacon seed for that epoch. |
| ` registrySize ` | ` number ` | - Number of entries in the verifier registry. |
| ` count ` | ` number ` | - Number of distinct verifier indices to select. |

Returns: ` number[] `.

### verifierLeaf

`keccak256(DOMAIN || index(u32 BE) || operator(20) || keccak256(pubkey))` - matches the on-chain leaf.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/token.ts#L238)

Import: `import {verifierLeaf} from 'tasra-sdk/committee'`

```ts
declare function verifierLeaf(index: number, operator: Uint8Array, pubkey: Uint8Array): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` index ` | ` number ` | - Zero-based verifier registry index. |
| ` operator ` | ` Uint8Array ` | - 20-byte operator address. |
| ` pubkey ` | ` Uint8Array ` | - 32-byte Ed25519 verifier public key. |

Returns: ` Uint8Array `.

### verifyCompoundToken

Verify rule binding, committee selection, token lifetime, Ed25519 signatures and quorum against the supplied verifier set.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/token.ts#L376)

Import: `import {verifyCompoundToken} from 'tasra-sdk/committee'`

```ts
declare function verifyCompoundToken(opts: VerifyCompoundTokenOptions): VerifiedToken;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` VerifyCompoundTokenOptions ` | - Decoded token and independently established verifier, rule and time constraints. |

Returns: ` VerifiedToken `.

Return details: Fields attested by the verified committee token.

Throws: If any binding, freshness, signer or quorum check fails.

### verifyMerkleProof

Verify a sorted-pair keccak Merkle inclusion proof (leaf to root).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/token.ts#L253)

Import: `import {verifyMerkleProof} from 'tasra-sdk/committee'`

```ts
declare function verifyMerkleProof(leaf: Uint8Array, proof: Uint8Array[], root: Uint8Array): boolean;
```

| Parameter | Type | Description |
|---|---|---|
| ` leaf ` | ` Uint8Array ` | - Leaf hash to prove. |
| ` proof ` | ` Uint8Array[] ` | - Sibling hashes ordered from the leaf toward the root. |
| ` root ` | ` Uint8Array ` | - Expected Merkle root. |

Returns: ` boolean `.

### verifyOperationReceipt

Verify the receipt against independently established operation and keeper identities.
Returns false for absent, malformed or mismatched evidence. Does not prove log completeness.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/receipts.ts#L75)

Import: `import {verifyOperationReceipt} from 'tasra-sdk/committee'`

```ts
declare function verifyOperationReceipt(receipt: OperationReceipt | undefined, expected: ReceiptExpectation): boolean;
```

| Parameter | Type | Description |
|---|---|---|
| ` receipt ` | ` OperationReceipt \| undefined ` | - Decoded receipt, or undefined if the keeper supplied none. |
| ` expected ` | ` ReceiptExpectation ` | - Trusted operation hashes, chain identifier and keeper public key. |

Returns: ` boolean `.

## Types

Options, data structures and return types.

<details>
<summary>Browse 36 types</summary>

- [ClientSigner](#clientsigner)
- [CommitteeAuthorizeBody](#committeeauthorizebody)
- [CommitteeAuthorizeReply](#committeeauthorizereply)
- [CommitteeChainReads](#committeechainreads)
- [CommitteeDecryptOpts](#committeedecryptopts)
- [CommitteeDecryptRequestOpts](#committeedecryptrequestopts)
- [CommitteeEoaSignOpts](#committeeeoasignopts)
- [CommitteeSignature](#committeesignature)
- [CommitteeSignatureWire](#committeesignaturewire)
- [CommitteeSignOpts](#committeesignopts)
- [CommitteeSignRequestOpts](#committeesignrequestopts)
- [CommitteeTokenResult](#committeetokenresult)
- [CommitteeVerifier](#committeeverifier)
- [CompoundTokenPayload](#compoundtokenpayload)
- [CompoundTokenWire](#compoundtokenwire)
- [DualSignApprover](#dualsignapprover)
- [DualSignConfig](#dualsignconfig)
- [DualSignRequest](#dualsignrequest)
- [DualSignStatus](#dualsignstatus)
- [ExtractionEvidence](#extractionevidence)
- [ExtractionKeeper](#extractionkeeper)
- [GatherCommitteeTokenOpts](#gathercommitteetokenopts)
- [HolderProofPerVerifier](#holderproofperverifier-1)
- [IbeExtractionPartial](#ibeextractionpartial)
- [IbeExtractOpts](#ibeextractopts)
- [IbeExtractRequestOpts](#ibeextractrequestopts)
- [OperationReceipt](#operationreceipt)
- [ReceiptExpectation](#receiptexpectation)
- [RequestCommitteeTokenOpts](#requestcommitteetokenopts)
- [StrictExtractionOptions](#strictextractionoptions)
- [StrictExtractionResult](#strictextractionresult)
- [TokenType](#tokentype)
- [VerifiedToken](#verifiedtoken)
- [VerifierProof](#verifierproof)
- [VerifierSet](#verifierset)
- [VerifyCompoundTokenOptions](#verifycompoundtokenoptions)

</details>

### ClientSigner

client request signature. The client (== the credential holder) proves it authorized
this exact request by signing `clientBindingHash(slotId, tokenHash)`. Supply an ed25519 signer
(the holder's authentication key) - the keeper (hot path) and the accountant (audit) verify it.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/request.ts#L46)

```ts
export interface ClientSigner {
    publicKey: Uint8Array;
    sign(bindingHash: Uint8Array): Uint8Array | Promise<Uint8Array>;
}
```

Fields:

- **` publicKey `**: 32-byte ed25519 public key.
- **` sign `**: Sign the 32-byte client-binding hash to 64-byte ed25519 signature.

### CommitteeAuthorizeBody

Credential presentation and request context sent to one verifier for committee authorization.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/client.ts#L82)

```ts
export interface CommitteeAuthorizeBody {
    holder: string;
    credentials: string[];
    holderProof: string;
    tokenType: TokenType;
    seed: Uint8Array;
    epoch: number | bigint;
    slotId: Uint8Array;
    registrySize: number;
    committee: number;
    iat: number | bigint;
    exp: number | bigint;
    identity?: string;
    binding?: RequestBindingPreimage;
}
```

Fields:

- **` holder `**: Holder DID (the credentials' subject).
- **` credentials `**: Compact-JWS verifiable credentials.
- **` holderProof `**: F1/F4: holder proof-of-possession. Build via `createHolderProof` (bind it to `slotId`). Empty string means omitted from the wire, which only a verifier with `require_holder_binding = false` accepts.
- **` tokenType `**: Compound authorization token category.
- **` seed `**: 32-byte on-chain beacon seed.
- **` epoch `**: Beacon epoch used for the verifier committee draw.
- **` slotId `**: 32-byte slot id.
- **` registrySize `**: Active verifier-set size at `epoch`.
- **` committee `**: The slot's verifierPolicy committee size.
- **` iat `**: Issue time in Unix seconds.
- **` exp `**: Expiration time in Unix seconds.
- **` identity `**: The requested IBE identity, present **iff** the operation is identity-scoped. The committee evaluates the slot's scope binding against it and folds `keccak256(identity)` into the signed token - a quorum attests THIS identity and the token is unusable for any other. Omit for every other operation.
- **` binding `**: request binding: the preimage every drawn verifier re-derives `request_hash` and the KB-JWT nonce from. Send it whenever the keeper runs `require_request_binding` (production posture): the reply then carries `request_hash` + `binding`, which the gathered token must include or the keeper refuses it. Absent = legacy (unbound) path.

### CommitteeAuthorizeReply

Verifier signature, token hashes and committee metadata for an authorization request.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/client.ts#L137)

```ts
export interface CommitteeAuthorizeReply {
    verifierIndex: number;
    tokenHash: Uint8Array;
    vpHash: Uint8Array;
    holderHash: Uint8Array;
    ruleHash: Uint8Array;
    identityHash?: Uint8Array;
    signature: Uint8Array;
    committeeIndexes: number[];
    ruleVersion?: number;
    requestHash?: Uint8Array;
    binding: number;
}
```

Fields:

- **` verifierIndex `**: Zero-based verifier registry index.
- **` tokenHash `**: 32-byte compound token hash.
- **` vpHash `**: Hash of the credential presentation bound into the token.
- **` holderHash `**: `keccak256` of the holder this verifier authenticated - inside the signed bytes.
- **` ruleHash `**: `keccak256` of the RAW rule this verifier evaluated (UNSALTED) - what the keeper binds against its own `keccak256(rule)`.
- **` identityHash `**: the identity binding this verifier signed - present iff the request carried `identity`. Inside the signed bytes, like `holderHash`.
- **` signature `**: This verifier's signature over the compound token hash.
- **` committeeIndexes `**: The full ordered committee draw, so the caller knows whom else to ask.
- **` ruleVersion `**: The slot's `ruleVersion` this authorization was evaluated against.  Diagnostic, not a gate. The keeper binds `ruleHash` to its own rule hash, so a token minted under a superseded policy is refused there whatever this says. Its value is that it explains the refusal: without it, a token minted moments before an amendment activates is rejected with nothing to distinguish it from a genuinely unauthorized request. `undefined` from a verifier that predates rule versioning.
- **` requestHash `**: present when the request carried a binding preimage; inside the signed bytes.
- **` binding `**: binding strength byte (`bindingFromWire`); `0x00` when the verifier declared none.

### CommitteeChainReads

The chain reads the committee flow needs. Adapt from the SDK chain client with
[committeeChainReadsFromClient](#committeechainreadsfromclient), or supply raw viem reads.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/request.ts#L126)

```ts
export interface CommitteeChainReads {
    seed(): Promise<`0x${string}` | Uint8Array>;
    epoch(): Promise<bigint | number>;
    seedAt?(epoch: bigint): Promise<`0x${string}` | Uint8Array>;
    verifierPolicy(slotId: `0x${string}`): Promise<readonly [
        number,
        number
    ]>;
    snapshot?(epoch: bigint): Promise<{
        root: `0x${string}` | Uint8Array;
        size: number;
    } | null>;
}
```

Fields:

- **` seed `**: 32-byte beacon seed for the current epoch.
- **` epoch `**: Current beacon epoch.
- **` seedAt `**: Seed of a past epoch (`ThresholdRandomBeacon.seedAt`) - needed for `epochLag > 0`.
- **` verifierPolicy `**: The slot's `[committee, quorum]` verifier policy (both `uint16`).
- **` snapshot `**: Optional anchored verifier-set snapshot `{root, size}` at an epoch - enables trustless proofs. Return `null` when none is anchored.

### CommitteeDecryptOpts

Committee-authorized group decryption request and optional verifier membership proofs.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/client.ts#L456)

```ts
export interface CommitteeDecryptOpts {
    nodeUrl: string;
    committeeToken: CompoundTokenWire;
    ciphertext: Ciphertext;
    identity: Uint8Array;
    decryptingSet: number[];
    blsPeers: BlsPeer[];
    userSignature?: Uint8Array;
    ciphertextEpoch?: number;
    targetKeykeeper?: string;
    verifierProofs?: VerifierProof[];
    clientPubkey?: Uint8Array;
    clientSignature?: Uint8Array;
}
```

Fields:

- **` nodeUrl `**: Keeper HTTP base URL.
- **` committeeToken `**: Compound token authorizing this operation.
- **` ciphertext `**: Ciphertext to decrypt.
- **` identity `**: Original encryption associated data.
- **` decryptingSet `**: Threshold participant identifiers for the decryption ceremony.
- **` blsPeers `**: Peer identifiers for the selected BLS participants.
- **` userSignature `**: Optional Ed25519 owner signature over the canonical operation request.
- **` ciphertextEpoch `**: Expected key epoch of the ciphertext; used to detect rotation.
- **` targetKeykeeper `**: Optional 20-byte operator address to pin the intended keeper.
- **` verifierProofs `**: Verifier membership proofs for the selected snapshot.
- **` clientPubkey `**: 32-byte Ed25519 client public key used to verify clientSignature; supply both fields together.
- **` clientSignature `**: Client signature over the slot and compound token binding.

### CommitteeDecryptRequestOpts

Operation-specific fields for [committeeDecryptRequest](#committeedecryptrequest).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/request.ts#L416)

```ts
export interface CommitteeDecryptRequestOpts extends RequestCommitteeTokenOpts {
    nodeUrl: string;
    ciphertext: CommitteeDecryptOpts['ciphertext'];
    identity: Uint8Array;
    decryptingSet: number[];
    blsPeers: CommitteeDecryptOpts['blsPeers'];
    userSignature?: Uint8Array;
    ciphertextEpoch?: number;
    targetKeykeeper?: string;
}
```

Fields:

- **` nodeUrl `**: Keeper HTTP base URL.
- **` ciphertext `**: Ciphertext to decrypt.
- **` identity `**: Original encryption associated data.
- **` decryptingSet `**: Threshold participant identifiers for the decryption ceremony.
- **` blsPeers `**: Peer identifiers for the selected BLS participants.
- **` userSignature `**: Optional Ed25519 owner signature over the canonical operation request.
- **` ciphertextEpoch `**: Expected key epoch of the ciphertext; used to detect rotation.
- **` targetKeykeeper `**: Optional 20-byte operator address to pin the intended keeper.
- **` chain `**: Reader methods for the beacon and slot verifier policy.
- **` epochLag `**: Pin the draw to `latest - epochLag` (0 or 1). 1 = the previous epoch, always anchored: no wait for the accountants.
- **` verifiers `**: The active verifier set (index to URL; add operator+pubkey to enable trustless proofs). Asking the whole set is fine - non-drawn verifiers reply 403 and are skipped.
- **` slotId `**: 0x-prefixed 32-byte slot id.
- **` holder `**: Holder DID (the credentials' subject).
- **` credentials `**: Compact-JWS verifiable credentials.
- **` holderProof `**: Proof of holder-key possession. Supply a per-verifier callback when each verifier has its own nonce store. Omitting it requires allowNoHolderProof and compatible verifier policy.
- **` allowNoHolderProof `**: Send no holder proof. Only valid against `require_holder_binding = false`.
- **` tokenType `**: Token type - default `'JWT'`.
- **` ttlSecs `**: Token TTL in seconds - default 300.
- **` nowSecs `**: Override "now" (unix seconds), mainly for tests.
- **` clientSigner `**: sign the request bundle with the holder's key so the keeper + audit can verify the user authorized this operation. Omit to skip (keeper accepts unless it requires it).
- **` scopedIdentity `**: Identity string for an IBE-scoped operation. Verifiers bind its hash into the token and evaluate the credential scope. Omit for group signing and group decryption; ciphertext associated data is a separate field.

### CommitteeEoaSignOpts

Compound authorization, keeper endpoint and digest for threshold ECDSA signing.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/ecdsa.ts#L8)

```ts
export interface CommitteeEoaSignOpts {
    fetchImpl?: typeof fetch;
    nodeUrl: string;
    committeeToken: CompoundTokenWire;
    digest: Uint8Array;
    verifierProofs?: VerifierProof[];
    requestId?: string;
    userSignature?: Uint8Array;
    targetKeykeeper?: string;
    signal?: AbortSignal;
}
```

Fields:

- **` fetchImpl `**: HTTP transport override; defaults to the global fetch implementation.
- **` nodeUrl `**: Keeper HTTP base URL.
- **` committeeToken `**: Authorization from awaitVerifierAgentResult; its slot selects the signing key.
- **` digest `**: Exactly 32 bytes: the transaction signing hash, not a serialized transaction.
- **` verifierProofs `**: Membership proofs returned with the authorization.
- **` requestId `**: Request identifier used to correlate or resume the operation.
- **` userSignature `**: Required only by slots configured with an additional owner-signature gate.
- **` targetKeykeeper `**: Optional 20-byte operator address to pin the intended keeper.
- **` signal `**: Optional signal that cancels the request.

### CommitteeSignature

One verifier's signature within a compound token.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/token.ts#L308)

```ts
export interface CommitteeSignature {
    verifierIndex: number;
    signature: Uint8Array;
}
```

Fields:

- **` verifierIndex `**: Zero-based verifier registry index.
- **` signature `**: Raw Ed25519 verifier signature.

### CommitteeSignatureWire

One verifier's signature on the wire (hex).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/token.ts#L417)

```ts
export interface CommitteeSignatureWire {
    verifier_index: number;
    signature: string;
}
```

Fields:

- **` verifier_index `**: Zero-based verifier registry index.
- **` signature `**: Hexadecimal Ed25519 verifier signature.

### CommitteeSignOpts

Committee-authorized FROST signing request and optional verifier membership proofs.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/client.ts#L382)

```ts
export interface CommitteeSignOpts {
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    nodeUrl: string;
    committeeToken: CompoundTokenWire;
    message: Uint8Array;
    signingSet?: number[];
    userSignature?: Uint8Array;
    targetKeykeeper?: string;
    verifierProofs?: VerifierProof[];
    clientPubkey?: Uint8Array;
    clientSignature?: Uint8Array;
}
```

Fields:

- **` signal `**: Optional signal that cancels the request.
- **` fetchImpl `**: HTTP transport override; defaults to the global fetch implementation.
- **` nodeUrl `**: Keeper HTTP base URL.
- **` committeeToken `**: Compound token authorizing this operation.
- **` message `**: Raw message bytes to sign.
- **` signingSet `**: Optional threshold participant identifiers for the signing ceremony.
- **` userSignature `**: Optional Ed25519 owner signature over the canonical operation request.
- **` targetKeykeeper `**: Optional 20-byte operator address to pin the intended keeper.
- **` verifierProofs `**: Verifier membership proofs for the selected snapshot.
- **` clientPubkey `**: 32-byte Ed25519 client public key used to verify clientSignature over the slot and token hash; supply both fields together.
- **` clientSignature `**: Client signature over the slot and compound token binding.

### CommitteeSignRequestOpts

Operation-specific fields for [committeeSignRequest](#committeesignrequest) (everything `committeeSign` needs
except the token, which this resolves).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/request.ts#L381)

```ts
export interface CommitteeSignRequestOpts extends RequestCommitteeTokenOpts {
    nodeUrl: string;
    message: Uint8Array;
    signingSet?: number[];
    userSignature?: Uint8Array;
    targetKeykeeper?: string;
}
```

Fields:

- **` nodeUrl `**: Keeper HTTP base URL.
- **` message `**: Raw message bytes to sign.
- **` signingSet `**: Optional threshold participant identifiers for the signing ceremony.
- **` userSignature `**: Optional Ed25519 owner signature over the canonical operation request.
- **` targetKeykeeper `**: The keeper this request targets (anti-Sybil). Defaults to letting the node accept it.
- **` chain `**: Reader methods for the beacon and slot verifier policy.
- **` epochLag `**: Pin the draw to `latest - epochLag` (0 or 1). 1 = the previous epoch, always anchored: no wait for the accountants.
- **` verifiers `**: The active verifier set (index to URL; add operator+pubkey to enable trustless proofs). Asking the whole set is fine - non-drawn verifiers reply 403 and are skipped.
- **` slotId `**: 0x-prefixed 32-byte slot id.
- **` holder `**: Holder DID (the credentials' subject).
- **` credentials `**: Compact-JWS verifiable credentials.
- **` holderProof `**: Proof of holder-key possession. Supply a per-verifier callback when each verifier has its own nonce store. Omitting it requires allowNoHolderProof and compatible verifier policy.
- **` allowNoHolderProof `**: Send no holder proof. Only valid against `require_holder_binding = false`.
- **` tokenType `**: Token type - default `'JWT'`.
- **` ttlSecs `**: Token TTL in seconds - default 300.
- **` nowSecs `**: Override "now" (unix seconds), mainly for tests.
- **` clientSigner `**: sign the request bundle with the holder's key so the keeper + audit can verify the user authorized this operation. Omit to skip (keeper accepts unless it requires it).
- **` scopedIdentity `**: Identity string for an IBE-scoped operation. Verifiers bind its hash into the token and evaluate the credential scope. Omit for group signing and group decryption; ciphertext associated data is a separate field.

### CommitteeTokenResult

Assembled compound token, committee draw and optional proofs and client signature.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/request.ts#L204)

```ts
export interface CommitteeTokenResult {
    token: CompoundTokenWire;
    committee: number;
    quorum: number;
    registrySize: number;
    seed: Uint8Array;
    epoch: number;
    verifierProofs?: VerifierProof[];
    clientPubkey?: Uint8Array;
    clientSignature?: Uint8Array;
    ruleVersion?: number;
}
```

Fields:

- **` token `**: Compound committee authorization token.
- **` committee `**: Number of verifiers selected for the committee.
- **` quorum `**: Minimum required verifier signatures.
- **` registrySize `**: Number of entries in the verifier registry.
- **` seed `**: Beacon seed used for committee selection.
- **` epoch `**: Beacon epoch used for the verifier committee draw.
- **` verifierProofs `**: Trustless snapshot-inclusion proofs for the token's signers, when derivable; else `undefined` (the keeper then uses its configured verifier set).
- **` clientPubkey `**: Ed25519 client public key corresponding to clientSignature, when a client signer was supplied.
- **` clientSignature `**: Client signature over the slot and compound token binding.
- **` ruleVersion `**: Policy version reported by the verifiers, when available. Diagnostic only; the keeper enforces the token rule hash against its current rule.

### CommitteeVerifier

One member of the active verifier set. `operator`+`pubkey` are needed only to build the
trustless snapshot proofs; `index`+`url` alone suffice for the keeper's configured-set path.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/request.ts#L113)

```ts
export interface CommitteeVerifier {
    index: number;
    url: string;
    operator?: string;
    pubkey?: string;
}
```

Fields:

- **` index `**: Zero-based verifier registry index.
- **` url `**: Verifier HTTP base URL.
- **` operator `**: 20-byte operator address (hex).
- **` pubkey `**: 32-byte ed25519 signing pubkey (hex).

### CompoundTokenPayload

The data the quorum verifiers sign over. All byte fields are 32 bytes unless noted.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/token.ts#L119)

```ts
export interface CompoundTokenPayload {
    tokenType: TokenType;
    seed: Uint8Array;
    epoch: number | bigint;
    slotId: Uint8Array;
    vpHash: Uint8Array;
    holderHash: Uint8Array;
    ruleHash: Uint8Array;
    identityHash?: Uint8Array;
    requestHash?: Uint8Array;
    binding?: number;
    verifierIndexes: number[];
    iat: number | bigint;
    exp: number | bigint;
}
```

Fields:

- **` tokenType `**: Compound authorization token category.
- **` seed `**: Beacon seed used for committee selection.
- **` epoch `**: Beacon epoch used for the verifier committee draw.
- **` slotId `**: 32-byte slot identifier.
- **` vpHash `**: Hash of the credential presentation bound into the token.
- **` holderHash `**: Keccak-256 hash of the authenticated holder identifier. Stable across repeated presentations by the same holder and signed as part of the token.
- **` ruleHash `**: Keccak-256 hash of the raw rule bytes, without salt. This differs from the salted on-chain ruleCommitment.
- **` identityHash `**: Keccak-256 hash of the authorized IBE identity. Present only for identity-scoped operations and included in the signed encoding; identity-blind endpoints reject scoped tokens.
- **` requestHash `**: Keccak-256 operation-binding hash. Required when keepers enforce request binding; absent only on authorization paths that do not derive it.
- **` binding `**: How the holder's key possession was proved. `0x00` = Unbound (no proof), `0x01` = HolderKey (KB-JWT nonce verified), `0x02` = IssuerAsserted (reserved). Always present in the canonical bytes; defaults to `0x00` when omitted.
- **` verifierIndexes `**: Indices of the selected verifier committee.
- **` iat `**: Issue time in Unix seconds.
- **` exp `**: Expiration time in Unix seconds.

### CompoundTokenWire

The compound token JSON a client submits with `/v1/committee/{sign,decrypt}`.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/token.ts#L425)

```ts
export interface CompoundTokenWire {
    token_type: TokenType;
    seed: string;
    epoch: number;
    slot_id: string;
    vp_hash: string;
    holder_hash: string;
    rule_hash: string;
    identity_hash?: string;
    request_hash?: string;
    binding?: string;
    verifier_indexes: number[];
    iat: number;
    exp: number;
    signatures: CommitteeSignatureWire[];
}
```

Fields:

- **` token_type `**: Compound authorization token category.
- **` seed `**: Hexadecimal beacon seed.
- **` epoch `**: Beacon epoch used for the verifier committee draw.
- **` slot_id `**: Hexadecimal 32-byte slot identifier.
- **` vp_hash `**: Hexadecimal hash of the credential presentation.
- **` holder_hash `**: Hexadecimal hash of the authenticated holder identifier.
- **` rule_hash `**: `keccak256` of the RAW rule (UNSALTED) - the counterpart of `DualControlPolicy.ruleHash`, never the salted `KeySlot.ruleCommitment`.
- **` identity_hash `**: `0x..` identity binding - present iff the token is identity-scoped.
- **` request_hash `**: `0x..` request binding hash - present when minted via the verifier-agent flow.
- **` binding `**: `"unbound"` | `"holder_key"` | `"issuer_asserted"`.
- **` verifier_indexes `**: Indices of the selected verifier committee.
- **` iat `**: Issue time in Unix seconds.
- **` exp `**: Expiration time in Unix seconds.
- **` signatures `**: Hexadecimal verifier signatures and their registry indices.

### DualSignApprover

Ed25519 approver public key and callback that signs canonical approval bytes.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/dual-sign.ts#L87)

```ts
export interface DualSignApprover {
    publicKey: Uint8Array;
    sign: (payload: Uint8Array) => Promise<Uint8Array>;
}
```

Fields:

- **` publicKey `**: 32-byte Ed25519 approver public key.
- **` sign `**: Sign the exact supplied canonical bytes; the SDK verifies the result locally.

### DualSignConfig

Trusted slot key, keeper endpoint and approver policy for a native signing request.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/dual-sign.ts#L46)

```ts
export interface DualSignConfig {
    chainId: number;
    nodeUrl: string;
    slotId: string;
    groupPublicKey: Uint8Array;
    quorum: number;
    credentialGated: boolean;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}
```

Fields:

- **` chainId `**: EVM chain identifier.
- **` nodeUrl `**: Keeper HTTP base URL.
- **` slotId `**: 32-byte slot identifier.
- **` groupPublicKey `**: Expected 32-byte FROST group public key.
- **` quorum `**: Expected approver quorum, read from the slot policy. Not the keeper threshold.
- **` credentialGated `**: Whether every approval requires a request-bound credential authorization.
- **` fetchImpl `**: HTTP transport override; defaults to the global fetch implementation.
- **` timeoutMs `**: Timeout for an individual HTTP request in milliseconds.

### DualSignRequest

Handle for checking, approving and waiting for one native multi-approver signing request.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/dual-sign.ts#L95)

```ts
export interface DualSignRequest {
    readonly requestId: string;
    readonly slotId: string;
    readonly nodeUrl: string;
    status(options?: {
        signal?: AbortSignal;
    }): Promise<DualSignStatus>;
    approve(options: {
        signer: DualSignApprover;
        authorization?: {
            token: CompoundTokenWire;
            verifierProofs: VerifierProof[];
        };
        signal?: AbortSignal;
    }): Promise<DualSignStatus>;
    wait(options?: {
        signal?: AbortSignal;
        timeoutMs?: number;
        intervalMs?: number;
        onStatus?: (status: DualSignStatus) => void;
    }): Promise<FrostSignResult>;
}
```

Fields:

- **` requestId `**: Request identifier used to correlate or resume the operation.
- **` slotId `**: 32-byte slot identifier.
- **` nodeUrl `**: Keeper HTTP base URL.
- **` status `**: Fetch and validate the current request state.
- **` approve `**: Sign and submit one approval, with credential authorization when required.
- **` wait `**: Poll until a verified signature is available or the request fails or times out.

### DualSignStatus

Native signing request progress, verified completed signature or terminal failure.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/dual-sign.ts#L66)

```ts
export type DualSignStatus = {
    status: 'pending' | 'signing';
    have: number;
    need: number;
} | {
    status: 'signed';
    result: FrostSignResult;
} | {
    status: 'failed';
};
```

Fields:

- **` status `**: Lifecycle state: pending or signing until the request is signed or fails.

### ExtractionEvidence

Keeper identity, share identifier and receipt verification status for an accepted extraction share.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/extraction.ts#L49)

```ts
export interface ExtractionEvidence {
    operator: string;
    identifier: number;
    nodeUrl: string;
    receipt?: OperationReceipt;
    receiptStatus: 'absent' | 'unverified' | 'verified';
}
```

Fields:

- **` operator `**: Keeper operator address.
- **` identifier `**: Nonzero threshold participant identifier.
- **` nodeUrl `**: Keeper HTTP base URL.
- **` receipt `**: Optional keeper attestation; presence alone does not establish validity.
- **` receiptStatus `**: Whether the receipt is absent, present but unchecked, or verified.

### ExtractionKeeper

Assigned keeper endpoint with independently established operator, key and optional share metadata.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/extraction.ts#L11)

```ts
export interface ExtractionKeeper {
    operator: string;
    nodeUrl: string;
    identifier?: number;
    publicKey?: Uint8Array;
    verifyingShareG2?: Uint8Array;
}
```

Fields:

- **` operator `**: On-chain assigned operator address. Two URLs cannot count as two operators.
- **` nodeUrl `**: Keeper HTTP base URL.
- **` identifier `**: Group share identifier from trusted deployment/slot metadata, when known.
- **` publicKey `**: Authenticated Ed25519 keeper key used to verify operation receipts.
- **` verifyingShareG2 `**: Independently authenticated G2 verifying share, not copied from the HTTP reply.

### GatherCommitteeTokenOpts

Verifier requests and quorum configuration for assembling a compound token.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/client.ts#L276)

```ts
export interface GatherCommitteeTokenOpts {
    verifiers: Array<{
        index: number;
        url: string;
    }>;
    authorize: CommitteeAuthorizeBody;
    quorum: number;
    onReplies?: (all: CommitteeAuthorizeReply[], reference: CommitteeAuthorizeReply) => void;
    holderProofFor?: (verifier: {
        index: number;
        url: string;
    }) => Promise<string> | string;
}
```

Fields:

- **` verifiers `**: Candidate verifiers to ask (index to base URL). Asking the whole registry is fine - non-drawn verifiers reply 403 and are skipped.
- **` authorize `**: Authorization input shared across requests to the selected verifiers.
- **` quorum `**: The slot's verifierPolicy quorum (minimum distinct committee signatures).
- **` onReplies `**: Observe all replies and the reply used as the token payload reference. Useful when verifiers report different policy versions.
- **` holderProofFor `**: Mint a separate holder proof for each verifier, overriding authorize.holderProof. Called concurrently; a rejection excludes that verifier while other requests continue.

### HolderProofPerVerifier

Callback that mints a separate holder proof for each verifier.

 A single proof cannot serve a committee: it is bound to a nonce that lives in ONE
verifier's store, consumed atomically, so the first verifier to answer spends it and the
rest refuse (401) under `require_holder_binding`. Pass a function instead of a string and
the gather asks each candidate verifier for its own nonce.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/request.ts#L61)

```ts
export type HolderProofPerVerifier = (verifier: CommitteeVerifier) => Promise<string> | string;
```

### IbeExtractionPartial

One node's extraction partial, decoded from the wire.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/client.ts#L519)

```ts
export interface IbeExtractionPartial {
    keySlotId?: string;
    receipt?: OperationReceipt;
    identifier: number;
    value: Uint8Array;
    verifyingShareG2: Uint8Array;
    epoch: number;
    nodeUrl: string;
}
```

Fields:

- **` keySlotId `**: Echoed slot, when supplied by the server. Required by the strict helper.
- **` receipt `**: Optional keeper attestation; presence alone does not establish validity.
- **` identifier `**: The node's BLS group identifier (1..n).
- **` value `**: 48-byte compressed G1 partial `D_i = sk_i * Q_ID`.
- **` verifyingShareG2 `**: The node's 96-byte G2 verifying share (the dual-group reply's first half).
- **` epoch `**: Slot epoch when served.
- **` nodeUrl `**: The node that served it (for identifiable-abort reporting).

### IbeExtractOpts

Committee authorization and keeper endpoints for extracting shares of one IBE identity key.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/client.ts#L537)

```ts
export interface IbeExtractOpts {
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    nodeUrls: string[];
    committeeToken: CompoundTokenWire;
    identity: string;
    userSignature?: Uint8Array;
    ciphertextEpoch?: number;
    verifierProofs?: VerifierProof[];
    clientPubkey?: Uint8Array;
    clientSignature?: Uint8Array;
}
```

Fields:

- **` signal `**: Optional signal that cancels the request.
- **` fetchImpl `**: HTTP transport override; defaults to the global fetch implementation.
- **` nodeUrls `**: Base URLs of at least k keeper nodes holding the slot's BLS shards.
- **` committeeToken `**: MUST be identity-scoped: the keeper enforces `identity_hash == keccak256(identity)`.
- **` identity `**: The requested IBE identity, in the clear (the node computes Q_ID from it).
- **` userSignature `**: Owner signature over `keccak256("keykeeper:ibe-extract:v1" || identity)` when the slot has a registered `user_pubkey`.
- **` ciphertextEpoch `**: Expected key epoch of the ciphertext; used to detect rotation.
- **` verifierProofs `**: Verifier membership proofs for the selected snapshot.
- **` clientPubkey `**: 32-byte Ed25519 client public key used to verify clientSignature; supply both fields together.
- **` clientSignature `**: Client signature over the slot and compound token binding.

### IbeExtractRequestOpts

Operation-specific fields for [ibeDecryptRequest](#ibedecryptrequest) / [ibeExtractRequest](#ibeextractrequest).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/request.ts#L462)

```ts
export interface IbeExtractRequestOpts extends RequestCommitteeTokenOpts {
    nodeUrls: string[];
    identity: string;
    userSignature?: Uint8Array;
    ciphertextEpoch?: number;
}
```

Fields:

- **` nodeUrls `**: Base URLs of at least k keeper nodes holding the slot's BLS shards.
- **` identity `**: The IBE identity to extract for - becomes the token's `scopedIdentity`, so a quorum attests exactly this identity and the keepers enforce the hash binding.
- **` userSignature `**: Owner signature over the identity-bound extract marker, when the slot has one.
- **` ciphertextEpoch `**: Expected key epoch of the ciphertext; used to detect rotation.
- **` chain `**: Reader methods for the beacon and slot verifier policy.
- **` epochLag `**: Pin the draw to `latest - epochLag` (0 or 1). 1 = the previous epoch, always anchored: no wait for the accountants.
- **` verifiers `**: The active verifier set (index to URL; add operator+pubkey to enable trustless proofs). Asking the whole set is fine - non-drawn verifiers reply 403 and are skipped.
- **` slotId `**: 0x-prefixed 32-byte slot id.
- **` holder `**: Holder DID (the credentials' subject).
- **` credentials `**: Compact-JWS verifiable credentials.
- **` holderProof `**: Proof of holder-key possession. Supply a per-verifier callback when each verifier has its own nonce store. Omitting it requires allowNoHolderProof and compatible verifier policy.
- **` allowNoHolderProof `**: Send no holder proof. Only valid against `require_holder_binding = false`.
- **` tokenType `**: Token type - default `'JWT'`.
- **` ttlSecs `**: Token TTL in seconds - default 300.
- **` nowSecs `**: Override "now" (unix seconds), mainly for tests.
- **` clientSigner `**: sign the request bundle with the holder's key so the keeper + audit can verify the user authorized this operation. Omit to skip (keeper accepts unless it requires it).
- **` scopedIdentity `**: Identity string for an IBE-scoped operation. Verifiers bind its hash into the token and evaluate the credential scope. Omit for group signing and group decryption; ciphertext associated data is a separate field.

### OperationReceipt

A keeper's operation attestation. Presence alone does not mean verified.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/receipts.ts#L10)

```ts
export interface OperationReceipt {
    opId: Uint8Array;
    tokenHash: Uint8Array;
    attestation: Uint8Array;
}
```

Fields:

- **` opId `**: 32-byte audit operation identifier.
- **` tokenHash `**: 32-byte compound token hash.
- **` attestation `**: Ed25519 signature over the chain-bound operation attestation hash.

### ReceiptExpectation

Expected operation hashes and independently authenticated keeper key for receipt verification.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/receipts.ts#L55)

```ts
export interface ReceiptExpectation {
    chainId: number | bigint;
    slotId: Uint8Array;
    opId: Uint8Array;
    tokenHash: Uint8Array;
    keeperPublicKey: Uint8Array;
}
```

Fields:

- **` chainId `**: EVM chain identifier.
- **` slotId `**: 32-byte slot identifier.
- **` opId `**: 32-byte audit operation identifier.
- **` tokenHash `**: 32-byte compound token hash.
- **` keeperPublicKey `**: Ed25519 identity key authenticated independently, e.g. from NodeRegistry.

### RequestCommitteeTokenOpts

Chain reads, verifier directory, credential presentation and optional request-signing context.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/request.ts#L172)

```ts
export interface RequestCommitteeTokenOpts {
    chain: CommitteeChainReads;
    epochLag?: number;
    verifiers: CommitteeVerifier[];
    slotId: string;
    holder: string;
    credentials: string[];
    holderProof?: string | HolderProofPerVerifier;
    allowNoHolderProof?: boolean;
    tokenType?: TokenType;
    ttlSecs?: number;
    nowSecs?: number;
    clientSigner?: ClientSigner;
    scopedIdentity?: string;
}
```

Fields:

- **` chain `**: Reader methods for the beacon and slot verifier policy.
- **` epochLag `**: Pin the draw to `latest - epochLag` (0 or 1). 1 = the previous epoch, always anchored: no wait for the accountants.
- **` verifiers `**: The active verifier set (index to URL; add operator+pubkey to enable trustless proofs). Asking the whole set is fine - non-drawn verifiers reply 403 and are skipped.
- **` slotId `**: 0x-prefixed 32-byte slot id.
- **` holder `**: Holder DID (the credentials' subject).
- **` credentials `**: Compact-JWS verifiable credentials.
- **` holderProof `**: Proof of holder-key possession. Supply a per-verifier callback when each verifier has its own nonce store. Omitting it requires allowNoHolderProof and compatible verifier policy.
- **` allowNoHolderProof `**: Send no holder proof. Only valid against `require_holder_binding = false`.
- **` tokenType `**: Token type - default `'JWT'`.
- **` ttlSecs `**: Token TTL in seconds - default 300.
- **` nowSecs `**: Override "now" (unix seconds), mainly for tests.
- **` clientSigner `**: sign the request bundle with the holder's key so the keeper + audit can verify the user authorized this operation. Omit to skip (keeper accepts unless it requires it).
- **` scopedIdentity `**: Identity string for an IBE-scoped operation. Verifiers bind its hash into the token and evaluate the credential scope. Omit for group signing and group decryption; ciphertext associated data is a separate field.

### StrictExtractionOptions

Expected slot epoch, threshold, chain key and keeper trust requirements for identity-key extraction.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/extraction.ts#L25)

```ts
export interface StrictExtractionOptions extends Omit<IbeExtractOpts, 'nodeUrls' | 'ciphertextEpoch'> {
    chainId: number | bigint;
    slotId: string;
    threshold: number;
    epoch: number;
    groupPublicKey: Uint8Array;
    keepers: readonly ExtractionKeeper[];
    shareTrust: 'pinned-shares' | 'anchored-group';
    requireReceipts?: boolean;
}
```

Fields:

- **` chainId `**: EVM chain identifier.
- **` slotId `**: 32-byte slot identifier.
- **` threshold `**: Minimum number of distinct assigned keeper shares.
- **` epoch `**: Slot key epoch used to match the extraction shares.
- **` groupPublicKey `**: Group key pinned to this slot/epoch on chain (96-byte G2).
- **` keepers `**: Assigned keepers with independently established identity and key metadata.
- **` shareTrust `**: pinned-shares requires an independently authenticated verifying share and identifier for EVERY keeper. anchored-group verifies the final key against chain, but does not claim independent provenance of each returned verifying share.
- **` requireReceipts `**: Require a valid operation attestation from every share used. Default false.
- **` signal `**: Optional signal that cancels the request.
- **` identity `**: The requested IBE identity, in the clear (the node computes Q_ID from it).
- **` userSignature `**: Owner signature over `keccak256("keykeeper:ibe-extract:v1" || identity)` when the slot has a registered `user_pubkey`.
- **` fetchImpl `**: HTTP transport override; defaults to the global fetch implementation.
- **` committeeToken `**: MUST be identity-scoped: the keeper enforces `identity_hash == keccak256(identity)`.
- **` verifierProofs `**: Verifier membership proofs for the selected snapshot.
- **` clientPubkey `**: 32-byte Ed25519 client public key used to verify clientSignature; supply both fields together.
- **` clientSignature `**: Client signature over the slot and compound token binding.

### StrictExtractionResult

Extracted identity key and provenance evidence. The caller must clear the returned key when finished.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/extraction.ts#L63)

```ts
export interface StrictExtractionResult {
    key: Uint8Array;
    epoch: number;
    shareTrust: StrictExtractionOptions['shareTrust'];
    evidence: ExtractionEvidence[];
}
```

Fields:

- **` key `**: Durable identity capability. Caller owns and must clear this buffer when finished.
- **` epoch `**: Slot key epoch used to match the extraction shares.
- **` shareTrust `**: Trust model used for validating the returned shares.
- **` evidence `**: Provenance and receipt status for every accepted share.

### TokenType

Compound authorization token category, used in the signed canonical encoding.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/token.ts#L26)

```ts
export type TokenType = 'JWT' | 'refresh';
```

### VerifiedToken

What a valid compound token attests.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/token.ts#L324)

```ts
export interface VerifiedToken {
    slotId: Uint8Array;
    vpHash: Uint8Array;
    holderHash: Uint8Array;
    identityHash?: Uint8Array;
    epoch: number | bigint;
    tokenType: TokenType;
    verifiedSigners: number[];
}
```

Fields:

- **` slotId `**: 32-byte slot identifier.
- **` vpHash `**: Hash of the credential presentation bound into the token.
- **` holderHash `**: The holder a quorum attested - the value a distinctness rule keys on.
- **` identityHash `**: the quorum-attested identity binding - present iff the token is scoped.
- **` epoch `**: Beacon epoch used for the verifier committee draw.
- **` tokenType `**: Compound authorization token category.
- **` verifiedSigners `**: Indices of the distinct verifier signatures that passed verification.

### VerifierProof

Trustless verifier-set inclusion proof, passed to the keeper.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/client.ts#L40)

```ts
export interface VerifierProof {
    verifierIndex: number;
    operator: string;
    pubkey: string;
    proof: string[];
}
```

Fields:

- **` verifierIndex `**: Zero-based verifier registry index.
- **` operator `**: 20-byte operator address (hex).
- **` pubkey `**: 32-byte ed25519 pubkey (hex).
- **` proof `**: Sorted-pair keccak Merkle proof (each 32-byte hex).

### VerifierSet

The active verifier set: registry size + index to Ed25519 public key (32 bytes).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/token.ts#L316)

```ts
export interface VerifierSet {
    registrySize: number;
    pubkeys: Map<number, Uint8Array>;
}
```

Fields:

- **` registrySize `**: Number of entries in the verifier registry.
- **` pubkeys `**: Registry index to authenticated Ed25519 public key mapping.

### VerifyCompoundTokenOptions

Compound token, trusted verifier set, expected rule binding and freshness constraints.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/token.ts#L352)

```ts
export interface VerifyCompoundTokenOptions {
    token: CompoundTokenPayload & {
        signatures: CommitteeSignature[];
    };
    set: VerifierSet;
    committee: number;
    quorum: number;
    now: number;
    leeway: number;
    slotRuleHash: Uint8Array;
}
```

Fields:

- **` token `**: The decoded token, signatures included (see `decodeCompoundToken`).
- **` set `**: The active verifier set to verify signatures against.
- **` committee `**: Committee size - how many verifiers the on-chain draw selects.
- **` quorum `**: Minimum co-signatures required *from the drawn committee*.
- **` now `**: Current time, UNIX **seconds**.
- **` leeway `**: Clock-skew tolerance, **seconds**, applied to both `iat` and `exp`.
- **` slotRuleHash `**: Expected Keccak-256 hash of the raw rule bytes, without salt. Do not supply the on-chain salted ruleCommitment.

## Constants and ABI values

Shared values and contract definitions.

| Export | Description | Definition |
|---|---|---|
| `OAUTH_RESPONSE_PATH` | The path an OAuth response is POSTed to - the `htu` a DPoP proof must name. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/oauth.ts#L17) |
