# tasra-sdk

Generated from public TypeScript exports.

[SDK reference](README.md) · [Task guides](../README.md) · [Errors](../errors.md)

## Classes

Clients, adapters and error classes.

<details>
<summary>Browse 10 classes</summary>

- [RecipientStore](#recipientstore)
- [AuthDeniedError](#authdeniederror)
- [CommitteeAuthorizeError](#committeeauthorizeerror)
- [DcqlMalformedError](#dcqlmalformederror)
- [NodeUnreachableError](#nodeunreachableerror)
- [SlotRotatedError](#slotrotatederror)
- [TasraError](#tasraerror)
- [TasraHttpError](#tasrahttperror)
- [ThresholdNotMetError](#thresholdnotmeterror)
- [VerifierAgentSessionError](#verifieragentsessionerror)

</details>

### RecipientStore

A recipient's local credential store. Holds structured credentials and
evaluates them against DCQL rules for advisory matching. It does not verify
credential signatures or establish issuer trust.

Everything here is in-memory and synchronous: deciding access reveals nothing
to the platform.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/recipient/store.ts#L27)

Import: `import {RecipientStore} from 'tasra-sdk'`

```ts
declare class RecipientStore {
    constructor(credentials?: (HeldCredential | CredentialView)[]);
}
```

- ` add(credential: HeldCredential | CredentialView): this; ` — Add a credential (returns `this` for chaining).

- ` views(): readonly CredentialView[]; ` — The credential views held in this store.

- ` satisfies(rule: string): boolean; ` — Check whether held credential views match the DCQL rule without network access.

**static fromJwtBodies** — Build a store from parsed JWT credential bodies.
Each entry needs a `type` array and an `iss` field in the body at minimum.

```ts
static fromJwtBodies(bodies: Array<{
    type: string[];
    iss: string;
    [key: string]: unknown;
}>): RecipientStore;
```

### AuthDeniedError

The credential was rejected: 401 or 403. Never retryable - the same token will
be refused again. Re-claim (redeem a fresh credential or renewal) instead.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/errors.ts#L75)

Import: `import {AuthDeniedError} from 'tasra-sdk'`

```ts
declare class AuthDeniedError {
    constructor(args: {
        status: number;
        url: string;
        body?: string;
        message?: string;
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

### CommitteeAuthorizeError

A verifier refused to co-sign a committee token. Extends
[TasraHttpError](#tasrahttperror), so `.status`, `.url`, `.body`, and `.retryable` are
all available and `isAuthDenied()` recognises a 401/403 here too.

Distinct from a generic HTTP error because the committee flow polls several
verifiers and tolerates individual refusals as long as a quorum co-signs - see
[ThresholdNotMetError](#thresholdnotmeterror) for the failure that means the quorum was missed.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/client.ts#L71)

Import: `import {CommitteeAuthorizeError} from 'tasra-sdk'`

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

### DcqlMalformedError

The rule is not a well-formed OID4VP-DCQL query (or exceeds `MAX_RULE_LEN`).
Never retryable - the same rule fails identically. Extends
[TasraError](#tasraerror) so one `instanceof` catches every SDK error.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L20)

Import: `import {DcqlMalformedError} from 'tasra-sdk'`

```ts
declare class DcqlMalformedError {
    constructor(message: string);
}
```

- ` readonly retryable: boolean; ` — `false` when retrying the identical request cannot succeed.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

### NodeUnreachableError

The request never got an HTTP answer - DNS failure, connection refused,
timeout, CORS. Retryable: the service may simply not be up yet.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/errors.ts#L85)

Import: `import {NodeUnreachableError} from 'tasra-sdk'`

```ts
declare class NodeUnreachableError {
    constructor(args: {
        url: string;
        message?: string;
        cause?: unknown;
    });
}
```

- ` readonly url: string; ` — Endpoint that could not be reached.

- ` readonly retryable: boolean; ` — `false` when retrying the identical request cannot succeed.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

### SlotRotatedError

The slot was re-keyed (rotated) since the key in hand was assembled, so that
key cannot read anything encrypted after the rotation. Retryable: re-assemble
at the new epoch and try again - the managed [Session](#session) does this for you.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/errors.ts#L133)

Import: `import {SlotRotatedError} from 'tasra-sdk'`

```ts
declare class SlotRotatedError {
    constructor(args: {
        expected: number;
        actual: number;
        slotId?: string;
        message?: string;
    });
}
```

- ` readonly expected: number; ` — The epoch the caller's key/envelope belongs to.

- ` readonly actual: number; ` — The slot's current on-chain/served epoch.

- ` readonly retryable: boolean; ` — `false` when retrying the identical request cannot succeed.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

### TasraError

Base class for typed SDK failures with a retryability hint.
Some SDK errors extend plain Error, including relay and agent-session
reconciliation errors. A retryable failure does not make a write safe to repeat.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/errors.ts#L34)

Import: `import {TasraError} from 'tasra-sdk'`

```ts
declare class TasraError {
    constructor(message: string, opts?: {
        retryable?: boolean;
        cause?: unknown;
    });
}
```

- ` readonly retryable: boolean; ` — `false` when retrying the identical request cannot succeed.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

### TasraHttpError

A node or verifier answered with a non-2xx status. `body` is the response body,
truncated to 200 characters - enough to carry the service's own error text
without dumping a page of HTML into a log line.

5xx and 429 are marked retryable; other 4xx are not.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/errors.ts#L52)

Import: `import {TasraHttpError} from 'tasra-sdk'`

```ts
declare class TasraHttpError {
    constructor(args: {
        status: number;
        url: string;
        body?: string;
        message?: string;
        retryable?: boolean;
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

### ThresholdNotMetError

Fewer than the required number of participants answered - too few shards to
assemble a key, too few verifier signatures for a quorum, too few nodes for a
signing set.

`reasons` carries one entry per participant that failed, which is what makes
this actionable: previously those were collected and then discarded, so a DNS
failure and a cold DKG produced the same opaque message.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/errors.ts#L104)

Import: `import {ThresholdNotMetError} from 'tasra-sdk'`

```ts
declare class ThresholdNotMetError {
    constructor(args: {
        got: number;
        need: number;
        reasons?: readonly string[];
        message?: string;
        retryable?: boolean;
    });
}
```

- ` readonly got: number; ` — How many participants answered successfully.

- ` readonly need: number; ` — How many were needed.

- ` readonly reasons: readonly string[]; ` — Why each failing participant failed, one string per participant.

- ` readonly retryable: boolean; ` — `false` when retrying the identical request cannot succeed.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

### VerifierAgentSessionError

A Verifier Agent session did not produce a compound token. `kind` says why;
`retryable` is true only for `timeout` and `unavailable` - the session may
still complete, so poll again. Extends [TasraError](#tasraerror).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L131)

Import: `import {VerifierAgentSessionError} from 'tasra-sdk'`

```ts
declare class VerifierAgentSessionError {
    constructor(kind: VerifierAgentSessionErrorKind, correlation: string, message: string, httpStatus?: number);
}
```

- ` readonly kind: VerifierAgentSessionErrorKind; ` — Failure category used to select recovery behavior.

- ` readonly correlation: string; ` — The session id - safe to show and to log.

- ` readonly httpStatus?: number; ` — The HTTP status that produced a `protocol`/`unavailable` error, when there was one.

- ` readonly retryable: boolean; ` — `false` when retrying the identical request cannot succeed.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

## Functions

Operations you can import and call.

<details>
<summary>Browse 80 functions</summary>

- [accessTokenHash](#accesstokenhash)
- [addressFromEoaPubkey](#addressfromeoapubkey)
- [aggregateFrostSignature](#aggregatefrostsignature)
- [auth0DpopSigner](#auth0dpopsigner)
- [buildHolderProof](#buildholderproof)
- [buildTasraText](#buildtasratext)
- [canAccess](#canaccess)
- [canonicalizeDcql](#canonicalizedcql)
- [combineDecryptShares](#combinedecryptshares)
- [createDpopKey](#createdpopkey)
- [createHolderProof](#createholderproof)
- [createOauthSession](#createoauthsession)
- [createOid4vpSession](#createoid4vpsession)
- [createRenewal](#createrenewal)
- [createTasraClient](#createtasraclient)
- [credentialsCommitment](#credentialscommitment)
- [decodeJwtClaims](#decodejwtclaims)
- [decryptCustody](#decryptcustody)
- [decryptWithMasterKey](#decryptwithmasterkey)
- [decryptWithShardDelivery](#decryptwithsharddelivery)
- [ed25519DidKey](#ed25519didkey)
- [encryptEnvelope](#encryptenvelope)
- [ethSignatureV](#ethsignaturev)
- [evaluateDcql](#evaluatedcql)
- [evaluateIdentityScoped](#evaluateidentityscoped)
- [fetchAndAssembleKey](#fetchandassemblekey)
- [fetchHolderNonce](#fetchholdernonce)
- [fetchMpk](#fetchmpk)
- [fromBytes](#frombytes)
- [hexToBytes](#hextobytes)
- [httpFaucet](#httpfaucet)
- [ibeBlobChunkRange](#ibeblobchunkrange)
- [ibeBlobDecryptKey](#ibeblobdecryptkey)
- [ibeBlobDigest](#ibeblobdigest)
- [ibeBlobWrappedKey](#ibeblobwrappedkey)
- [ibeCombineDecrypt](#ibecombinedecrypt)
- [ibeCombineExtract](#ibecombineextract)
- [ibeDecryptBlobChunk](#ibedecryptblobchunk)
- [ibeDecryptRequest](#ibedecryptrequest)
- [ibeDecryptWithKey](#ibedecryptwithkey)
- [ibeEncrypt](#ibeencrypt)
- [ibeExtractRequest](#ibeextractrequest)
- [ibeOpenBlob](#ibeopenblob)
- [ibeSealBlob](#ibesealblob)
- [ibeUnwrapBlobKey](#ibeunwrapblobkey)
- [ibeVerifyShare](#ibeverifyshare)
- [isAuthDenied](#isauthdenied)
- [isHeaderSafeNonce](#isheadersafenonce)
- [isJwtExpiringSoon](#isjwtexpiringsoon)
- [isOid4vpRule](#isoid4vprule)
- [isRetryable](#isretryable)
- [issueAdminCredential](#issueadmincredential)
- [isTasraPost](#istasrapost)
- [jsonCredential](#jsoncredential)
- [jwkThumbprint](#jwkthumbprint)
- [jwtExpMs](#jwtexpms)
- [parseTasraPost](#parsetasrapost)
- [payloadDigest](#payloaddigest)
- [pollOid4vpSession](#polloid4vpsession)
- [redeemCredential](#redeemcredential)
- [redeemRenewalToken](#redeemrenewaltoken)
- [requestIbeExtractionPartials](#requestibeextractionpartials)
- [revokeRenewal](#revokerenewal)
- [revokeSlotUser](#revokeslotuser)
- [scopeCovers](#scopecovers)
- [selectDcql](#selectdcql)
- [signCustody](#signcustody)
- [signEoaDigest](#signeoadigest)
- [signUserRequest](#signuserrequest)
- [signWithShardDelivery](#signwithsharddelivery)
- [submitOauthResponse](#submitoauthresponse)
- [toBytes](#tobytes)
- [userSignaturePayload](#usersignaturepayload)
- [validateDcql](#validatedcql)
- [validateRecipientRule](#validaterecipientrule)
- [verifyDecryptShare](#verifydecryptshare)
- [verifyFrostSignature](#verifyfrostsignature)
- [verifyPresentation](#verifypresentation)
- [verifyVpJwt](#verifyvpjwt)
- [waitForSession](#waitforsession)

</details>

### accessTokenHash

Compute the base64url SHA-256 access-token hash for the DPoP ath claim.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/dpop.ts#L36)

Import: `import {accessTokenHash} from 'tasra-sdk'`

```ts
declare function accessTokenHash(accessToken: string): Promise<string>;
```

| Parameter | Type | Description |
|---|---|---|
| ` accessToken ` | ` string ` | - Exact access token string to bind into the DPoP proof. |

Returns: ` Promise<string> `.

### addressFromEoaPubkey

Derive the EIP-55 checksummed `0x` Ethereum address of a threshold EOA from its
secp256k1 group public key - pass `EoaSignature.groupPublicKey` (33-byte
compressed) or a 65-byte uncompressed key. Pure `@noble` (no ethers/web3): the
key is decompressed, keccak-256'd over X||Y, and the low 20 bytes are checksummed.
This is what an ethers `Signer.getAddress()` returns for a Tasra EOA slot.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/signing/ecdsa.ts#L111)

Import: `import {addressFromEoaPubkey} from 'tasra-sdk'`

```ts
declare function addressFromEoaPubkey(pubkey: Uint8Array): `0x${string}`;
```

| Parameter | Type | Description |
|---|---|---|
| ` pubkey ` | ` Uint8Array ` | - SEC1-encoded secp256k1 public key, compressed or uncompressed. |

Returns: `` `0x${string}` ``.

### aggregateFrostSignature

Combine k Round-1 commitments + k Round-2 shares into the group signature.
`commitments` MUST be in the same order that was sent to every node (the
binding factors depend on the serialized list order). Each share is
identifiable-abort verified; an invalid share throws naming its identifier.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/frost.ts#L135)

Import: `import {aggregateFrostSignature} from 'tasra-sdk'`

```ts
declare function aggregateFrostSignature(message: Uint8Array, groupPublicKey: Uint8Array, commitments: FrostCommitment[], shares: FrostShare[]): FrostSignature;
```

| Parameter | Type | Description |
|---|---|---|
| ` message ` | ` Uint8Array ` | - Message signed by every participant. |
| ` groupPublicKey ` | ` Uint8Array ` | - 32-byte FROST group public key. |
| ` commitments ` | ` FrostCommitment[] ` | - Commitments from the selected signing participants. |
| ` shares ` | ` FrostShare[] ` | - Signature shares for those commitments. |

Returns: ` FrostSignature `.

### auth0DpopSigner

Wrap `auth0-spa-js`'s own proof minter as a [DpopSigner](#dpopsigner).

The SDK holds the key, so this is the ONLY way an Auth0 app can produce a proof whose
`jkt` matches its token's `cnf.jkt`.

```ts
const signer = auth0DpopSigner((args) => auth0.generateDpopProof(args))
```

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/dpop.ts#L134)

Import: `import {auth0DpopSigner} from 'tasra-sdk'`

```ts
declare function auth0DpopSigner(generate: (args: {
    url: string;
    method: string;
    nonce?: string;
    accessToken?: string;
}) => Promise<string>): DpopSigner;
```

| Parameter | Type | Description |
|---|---|---|
| ` generate ` | ` (args: { url: string; method: string; nonce?: string; accessToken?: string; }) => Promise<string> ` | - Callback that creates a DPoP proof using the identity provider client's bound key. |

Returns: ` DpopSigner `.

### buildHolderProof

Build a holder-proof compact-JWS (header.payload.signature).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/holderProof.ts#L135)

Import: `import {buildHolderProof} from 'tasra-sdk'`

```ts
declare function buildHolderProof(opts: BuildHolderProofOpts): Promise<string>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` BuildHolderProofOpts ` | - Holder signer, challenge, audience and ordered credentials to bind. |

Returns: ` Promise<string> `.

### buildTasraText

Encode serialized envelope bytes as a Tasra encrypted text payload.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/detect.ts#L46)

Import: `import {buildTasraText} from 'tasra-sdk'`

```ts
declare function buildTasraText(envelopeBytes: Uint8Array): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` envelopeBytes ` | ` Uint8Array ` | - Binary envelope produced by the envelope serializer. |

Returns: ` string `.

### canAccess

Check whether held credential views match a DCQL rule without network access.

Accepts a [RecipientStore](#recipientstore) or a bare [HeldCredential](#heldcredential) list.
Unlike ` RecipientStore.satisfies `, a malformed rule returns `false`
(fail-closed) rather than throwing.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/recipient/store.ts#L92)

Import: `import {canAccess} from 'tasra-sdk'`

```ts
declare function canAccess(rule: string, store: RecipientStore | HeldCredential[]): boolean;
```

| Parameter | Type | Description |
|---|---|---|
| ` rule ` | ` string ` | - DCQL policy encoded as JSON text. |
| ` store ` | ` RecipientStore \| HeldCredential[] ` | - Held credential views used for the local access decision. |

Returns: ` boolean `.

### canonicalizeDcql

RFC 8785 (JCS) canonical form: sorted keys, no insignificant whitespace, ECMAScript
number formatting, UTF-8.

 Why the commitment needs this at all: the rule stops being an opaque string the
moment it becomes the `dcql_query` inside a signed OID4VP request object. It must be
parsed and re-serialised, and any JSON library may reorder keys or restyle
whitespace. Hashing raw bytes would break the commitment at exactly the point the
rule is used for its new purpose.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L945)

Import: `import {canonicalizeDcql} from 'tasra-sdk'`

```ts
declare function canonicalizeDcql(rule: string): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` rule ` | ` string ` | - DCQL policy encoded as JSON text. |

Returns: ` string `.

### combineDecryptShares

Interpolate distinct partial decryptions and authenticate the plaintext. Enable verify to check each share before combining; the caller supplies a sufficient threshold.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/kem.ts#L286)

Import: `import {combineDecryptShares} from 'tasra-sdk'`

```ts
declare function combineDecryptShares(shares: DecryptShare[], ct: Ciphertext, identity: Uint8Array, opts?: {
    verify?: boolean;
}): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` shares ` | ` DecryptShare[] ` | - Distinct participant shares sufficient for the slot threshold. |
| ` ct ` | ` Ciphertext ` | - Ciphertext associated with the partial decryptions. |
| ` identity ` | ` Uint8Array ` | - Original encryption associated data. |
| ` opts? ` | ` { verify?: boolean; } ` | - Whether to verify each partial decryption before combining. |

Returns: ` Uint8Array `.

### createDpopKey

Generate an ES256 DPoP key pair with a non-extractable private key.
The returned signer can create proofs without exposing the private key bytes.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/dpop.ts#L55)

Import: `import {createDpopKey} from 'tasra-sdk'`

```ts
declare function createDpopKey(): Promise<DpopKey>;
```

Returns: ` Promise<DpopKey> `.

### createHolderProof

Convenience: fetch a nonce and build the holder proof in one step. Returns the
compact-JWS to put in the `holder_proof` field of a `verify-vp-jwt` /
`committee-authorize` request.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/holderProof.ts#L173)

Import: `import {createHolderProof} from 'tasra-sdk'`

```ts
declare function createHolderProof(verifierUrl: string, opts: {
    signer: HolderSigner;
    audience: string;
    credentials: string[];
    slotId?: string;
    action?: string;
    ttlSecs?: number;
}): Promise<string>;
```

| Parameter | Type | Description |
|---|---|---|
| ` verifierUrl ` | ` string ` | - Verifier HTTP base URL. |
| ` opts ` | ` { signer: HolderSigner; audience: string; credentials: string[]; slotId?: string; action?: string; ttlSecs?: number; } ` | - Holder signer, verifier audience, credentials and optional operation binding. |

Returns: ` Promise<string> `.

### createOauthSession

Open an `oauth` session - same creator authorisation, same committee draw, same
derived nonce, same poll contract as [createOid4vpSession](#createoid4vpsession). No QR, no Request
Object, no JWE key: the client presents an access token its own IdP minted.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L261)

Import: `import {createOauthSession} from 'tasra-sdk'`

```ts
declare function createOauthSession(verifierAgentUrl: string, params: CreateSessionParams): Promise<CreateOauthSessionResult>;
```

| Parameter | Type | Description |
|---|---|---|
| ` verifierAgentUrl ` | ` string ` | - Verifier-agent HTTP base URL from the selected network manifest. |
| ` params ` | ` CreateSessionParams ` | - Signed operation, optional delegation and raw payload. |

Returns: ` Promise<CreateOauthSessionResult> `.

### createOid4vpSession

Create an OID4VP session on the Verifier Agent.

The verifier-agent derives a nonce, generates an ECDH key for JWE, and returns a QR
payload the wallet scans. The session ID and poll secret are used to poll
for the result.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L221)

Import: `import {createOid4vpSession} from 'tasra-sdk'`

```ts
declare function createOid4vpSession(verifierAgentUrl: string, params: CreateSessionParams): Promise<CreateSessionResult>;
```

| Parameter | Type | Description |
|---|---|---|
| ` verifierAgentUrl ` | ` string ` | - Verifier-agent HTTP base URL from the selected network manifest. |
| ` params ` | ` CreateSessionParams ` | - Signed operation, optional delegation and raw payload. |

Returns: ` Promise<CreateSessionResult> `.

### createRenewal

Create a long-lived renewal from a presentation. On the prod (signed) path,
pass `credentials` (compact JWS JWT-VCs) - they're signature-verified and
replace the presentation's credentials. `slot_ids` (if given) are rotated via
a webhook when the renewal is revoked.
POST {verifier}/v1/renewals

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L57)

Import: `import {createRenewal} from 'tasra-sdk'`

```ts
declare function createRenewal(verifierUrl: string, body: {
    dcql_rule: string;
    presentation: unknown;
    credentials?: string[];
    slot_ids?: string[];
}): Promise<RenewalGrant>;
```

| Parameter | Type | Description |
|---|---|---|
| ` verifierUrl ` | ` string ` | - Verifier HTTP base URL. |
| ` body ` | ` { dcql_rule: string; presentation: unknown; credentials?: string[]; slot_ids?: string[]; } ` | - Policy, presentation and optional signed credentials or revocation-bound slots. |

Returns: ` Promise<RenewalGrant> `.

### createTasraClient

Create a client for JWT-authorized slot sessions. Configure endpoints from a network manifest downloaded from the tasra-releases repository.

Sessions assemble the master key lazily on first decryption and clear it on close. Only renewal-token authorization renews automatically; other modes require a new session after expiry.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/client/client.ts#L190)

Import: `import {createTasraClient} from 'tasra-sdk'`

```ts
declare function createTasraClient(config: TasraClientConfig): TasraClient;
```

| Parameter | Type | Description |
|---|---|---|
| ` config ` | ` TasraClientConfig ` | - Keeper URLs and the verifier or holder identity required by the selected authorization mode. |

Returns: ` TasraClient `.

Return details: A client that opens and tracks managed slot sessions.

Throws: If no keeper URL is supplied.

### credentialsCommitment

`base64url(sha256(credentials joined by "\n"))`.

MUST byte-for-byte match the verifier's `credentials_commitment`
(the reference holder-proof implementation). Order-sensitive and delimiter-framed so both
sides agree without JSON canonicalization. Binds a holder proof to the exact set of
compact-JWS credentials being presented.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/holderProof.ts#L43)

Import: `import {credentialsCommitment} from 'tasra-sdk'`

```ts
declare function credentialsCommitment(credentials: string[]): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` credentials ` | ` string[] ` | - Ordered compact credential strings; order is part of the commitment. |

Returns: ` string `.

### decodeJwtClaims

Decode JWT claims WITHOUT verifying the signature (for expiry/UX only).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L274)

Import: `import {decodeJwtClaims} from 'tasra-sdk'`

```ts
declare function decodeJwtClaims(jwt: string): JwtClaims | null;
```

| Parameter | Type | Description |
|---|---|---|
| ` jwt ` | ` string ` | - Compact JWT to decode without signature verification. |

Returns: ` JwtClaims | null `.

### decryptCustody

Decrypt via the custody path: the node runs the whole k-of-n ceremony and
 returns the plaintext (one HTTP round-trip).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/decryption/client.ts#L81)

Import: `import {decryptCustody} from 'tasra-sdk'`

```ts
declare function decryptCustody(opts: DecryptCustodyOpts): Promise<Uint8Array>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` DecryptCustodyOpts ` | - Keeper endpoint, JWT, ciphertext, associated data and decryption participants. |

Returns: ` Promise<Uint8Array> `.

### decryptWithMasterKey

Decrypt with a reconstructed BLS master secret key and the original associated data. Reject malformed keys or failed authentication.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/kem.ts#L214)

Import: `import {decryptWithMasterKey} from 'tasra-sdk'`

```ts
declare function decryptWithMasterKey(mskBytes: Uint8Array, ct: Ciphertext, identity: Uint8Array): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` mskBytes ` | ` Uint8Array ` | - 32-byte little-endian master secret scalar. |
| ` ct ` | ` Ciphertext ` | - Group ciphertext to decrypt. |
| ` identity ` | ` Uint8Array ` | - Original associated data supplied during encryption. |

Returns: ` Uint8Array `.

### decryptWithShardDelivery

Decrypt via the shard-delivery path: fetch a partial decryption from each
 node and combine the shares locally (the master key is never assembled).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/decryption/client.ts#L149)

Import: `import {decryptWithShardDelivery} from 'tasra-sdk'`

```ts
declare function decryptWithShardDelivery(opts: ShardDecryptOpts): Promise<Uint8Array>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` ShardDecryptOpts ` | - Keeper endpoints, JWT, ciphertext and optional per-share verification. |

Returns: ` Promise<Uint8Array> `.

### ed25519DidKey

A did:key identifier for an Ed25519 public key (multicodec 0xed01, base58btc). Useful
 when the holder is identified by a self-certifying did:key.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/holderProof.ts#L202)

Import: `import {ed25519DidKey} from 'tasra-sdk'`

```ts
declare function ed25519DidKey(publicKey: Uint8Array): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` publicKey ` | ` Uint8Array ` | - 32-byte Ed25519 public key. |

Returns: ` string `.

### encryptEnvelope

Encrypt `plaintext` to a slot's group key - ChaCha20-Poly1305 under a BLS12-381
G2 ElGamal KEM. Local and synchronous: it needs only the slot's **public** key,
so no JWT, no node round-trip, and no assembled secret.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/envelope.ts#L257)

Import: `import {encryptEnvelope} from 'tasra-sdk'`

```ts
declare function encryptEnvelope(slotId: Uint8Array, mpkBytes: Uint8Array, identity: Uint8Array, plaintext: Uint8Array, epoch?: bigint | null): GroupEnvelope;
```

| Parameter | Type | Description |
|---|---|---|
| ` slotId ` | ` Uint8Array ` | the 32-byte slot id (raw bytes, not hex) |
| ` mpkBytes ` | ` Uint8Array ` | the slot's 96-byte compressed G2 group public key, as served by `GET /v1/keys/{slot}/public` (see `fetchMpk`) |
| ` identity ` | ` Uint8Array ` | additional authenticated data bound into the AEAD. Conventionally the slot id itself; the managed session defaults to exactly that. |
| ` plaintext ` | ` Uint8Array ` | the bytes to encrypt |
| ` epoch? ` | ` bigint \| null ` | the current slot epoch, producing a v0x02 envelope; `null` produces a legacy v0x01 envelope with no epoch binding |

Returns: ` GroupEnvelope `.

Return details: the envelope - pass through `toBytes()` then `buildTasraText()` for
the opaque `[KK]<base64>` wire form

Throws: {Error} if `slotId` is not 32 bytes, `identity` exceeds its cap, `plaintext`
exceeds ` MAX_PLAINTEXT_LEN `, or `epoch` is negative or above 2^63 - 1

Example from source:

```ts
const {mpkBytes, epoch} = await fetchMpk(nodeUrl, slotHex)
const env = encryptEnvelope(hexToBytes(slotHex), mpkBytes, hexToBytes(slotHex), bytes, BigInt(epoch))
const wire = buildTasraText(toBytes(env)) // hand to ANY transport
```

### ethSignatureV

Map the raw recovery id (0/1) to an Ethereum `v`: legacy 27/28, or EIP-155
 (`35 + 2*chainId + yParity`) when a chainId is given.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/signing/ecdsa.ts#L88)

Import: `import {ethSignatureV} from 'tasra-sdk'`

```ts
declare function ethSignatureV(yParity: number, chainId?: number): number;
```

| Parameter | Type | Description |
|---|---|---|
| ` yParity ` | ` number ` | - Recovery parity, zero or one. |
| ` chainId? ` | ` number ` | - Optional chain identifier for an EIP-155 transaction signature. |

Returns: ` number `.

### evaluateDcql

Does `credentials` satisfy `rule`?

Returns `true` to grant and `false` to deny; throws [DcqlMalformedError](#dcqlmalformederror) when
the rule itself is broken.  Takes NO holder identity - DCQL constrains credentials,
and holder identity is established by the presentation's holder binding. That is why
the legacy `required_sub_in` clause has no encoding here.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L656)

Import: `import {evaluateDcql} from 'tasra-sdk'`

```ts
declare function evaluateDcql(rule: string, credentials: readonly CredentialView[]): boolean;
```

| Parameter | Type | Description |
|---|---|---|
| ` rule ` | ` string ` | - DCQL policy encoded as JSON text. |
| ` credentials ` | ` readonly CredentialView[] ` | - Credential views whose signatures and trust were already validated. |

Returns: ` boolean `.

### evaluateIdentityScoped

Does `credentials` authorize an identity-scoped operation on `identity`?

The ` evaluate ` WHO gate PLUS the WHICH gate: a satisfied credential query
carrying `kk_identity_scope_claim` must have a matching credential whose scope grant
(a string or array at that path) covers `identity` ([scopeCovers](#scopecovers)) and - under
`kk_scope_namespace: "issuer"` - whose verified issuer owns the identity's namespace
(its first `/`-segment must byte-equal the issuer DID, the self-grant-over-others
gate). A rule with no scope binding on any satisfied query denies: an unscoped rule
can never authorize a scoped operation.

 Local evaluation is ADVISORY here as everywhere in this SDK - the verifier
committee runs the authoritative check; a wrong local answer costs a wasted request,
never access.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L802)

Import: `import {evaluateIdentityScoped} from 'tasra-sdk'`

```ts
declare function evaluateIdentityScoped(rule: string, credentials: readonly CredentialView[], identity: string): boolean;
```

| Parameter | Type | Description |
|---|---|---|
| ` rule ` | ` string ` | - DCQL policy containing identity-scope constraints. |
| ` credentials ` | ` readonly CredentialView[] ` | - Authenticated credential views to evaluate. |
| ` identity ` | ` string ` | - Requested identity string whose scope must be authorized. |

Returns: ` boolean `.

### fetchAndAssembleKey

Fetch key shards concurrently and interpolate the slot's master secret key in this process. The caller must obtain a sufficient threshold from one epoch and clear the returned key after use.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/keys/node-client.ts#L57)

Import: `import {fetchAndAssembleKey} from 'tasra-sdk'`

```ts
declare function fetchAndAssembleKey(cfg: NodeConfig, slotHex: string): Promise<Uint8Array>;
```

| Parameter | Type | Description |
|---|---|---|
| ` cfg ` | ` NodeConfig ` | - Keeper URLs and a JWT authorizing shard release. |
| ` slotHex ` | ` string ` | - 32-byte slot identifier, with or without the 0x prefix. |

Returns: ` Promise<Uint8Array> `.

Return details: The reconstructed master secret key as a 32-byte little-endian scalar.

Throws: If no shards are returned or interpolation fails.

### fetchHolderNonce

Mint a single-use challenge nonce, optionally bound to a slot id + action (F4).
POST {verifier}/v1/nonce

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/holderProof.ts#L68)

Import: `import {fetchHolderNonce} from 'tasra-sdk'`

```ts
declare function fetchHolderNonce(verifierUrl: string, opts?: {
    slotId?: string;
    action?: string;
}): Promise<HolderNonce>;
```

| Parameter | Type | Description |
|---|---|---|
| ` verifierUrl ` | ` string ` | - Verifier HTTP base URL. |
| ` opts? ` | ` { slotId?: string; action?: string; } ` | - Optional slot and action binding for the single-use challenge. |

Returns: ` Promise<HolderNonce> `.

### fetchMpk

Fetch a slot's group public key and epoch from a keeper. Reject a reply without a ready key.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/keys/node-client.ts#L25)

Import: `import {fetchMpk} from 'tasra-sdk'`

```ts
declare function fetchMpk(nodeUrl: string, slotHex: string): Promise<{
    mpkBytes: Uint8Array;
    epoch: number;
}>;
```

| Parameter | Type | Description |
|---|---|---|
| ` nodeUrl ` | ` string ` | - Keeper HTTP base URL from the downloaded network manifest or authenticated registry. |
| ` slotHex ` | ` string ` | - 32-byte slot identifier, with or without the 0x prefix. |

Returns:

```ts
Promise<{
    mpkBytes: Uint8Array;
    epoch: number;
}>
```

### fromBytes

Parse a supported binary envelope and validate its version, field lengths and boundaries.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/envelope.ts#L118)

Import: `import {fromBytes} from 'tasra-sdk'`

```ts
declare function fromBytes(bytes: Uint8Array): GroupEnvelope;
```

| Parameter | Type | Description |
|---|---|---|
| ` bytes ` | ` Uint8Array ` | - Complete binary envelope to parse. |

Returns: ` GroupEnvelope `.

### hexToBytes

Decode hexadecimal text, accepting an optional 0x prefix. Reject odd-length input; callers must validate hexadecimal characters before decoding.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/hex.ts#L7)

Import: `import {hexToBytes} from 'tasra-sdk'`

```ts
declare function hexToBytes(hex: string): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` hex ` | ` string ` | - Hexadecimal bytes, with an optional 0x prefix. |

Returns: ` Uint8Array `.

### httpFaucet

HTTP faucet client: POST {faucetUrl}/faucet {address} to FaucetGrant.
Matches the network faucet service.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/slots/faucet.ts#L32)

Import: `import {httpFaucet} from 'tasra-sdk'`

```ts
declare function httpFaucet(faucetUrl: string): Faucet;
```

| Parameter | Type | Description |
|---|---|---|
| ` faucetUrl ` | ` string ` | - Faucet HTTP base URL advertised for the selected network. |

Returns: ` Faucet `.

### ibeBlobChunkRange

Return a chunk's encrypted byte range as [start, end), including its 16-byte tag.
The final chunk has header.size - index * header.chunkSize plaintext bytes.
An empty object has one chunk: start 0, end 16, plainLength 0.
Use a trusted header and validate that index is a safe integer before calling.
Negative indices and indices at or beyond header.chunkCount throw RangeError.
For an HTTP Range header, use end - 1 as the inclusive last byte.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe-blob.ts#L104)

Import: `import {ibeBlobChunkRange} from 'tasra-sdk'`

```ts
declare function ibeBlobChunkRange(header: IbeBlobHeader, index: number): {
    start: number;
    end: number;
    plainLength: number;
};
```

| Parameter | Type | Description |
|---|---|---|
| ` header ` | ` IbeBlobHeader ` | - Blob header describing plaintext length and chunk size. |
| ` index ` | ` number ` | - Zero-based integer chunk index below header.chunkCount. |

Returns:

```ts
{
    start: number;
    end: number;
    plainLength: number;
}
```

### ibeBlobDecryptKey

A WebCrypto key for `dek`, importable once per blob and reused across chunks.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe-blob.ts#L188)

Import: `import {ibeBlobDecryptKey} from 'tasra-sdk'`

```ts
declare function ibeBlobDecryptKey(dek: Uint8Array): Promise<CryptoKey>;
```

| Parameter | Type | Description |
|---|---|---|
| ` dek ` | ` Uint8Array ` | - 32-byte unwrapped AES data key to import for decryption. |

Returns: ` Promise<CryptoKey> `.

### ibeBlobDigest

`sha256(body)` - what a producer signs in its manifest so a reader can check provenance.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe-blob.ts#L242)

Import: `import {ibeBlobDigest} from 'tasra-sdk'`

```ts
declare function ibeBlobDigest(body: Uint8Array): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` body ` | ` Uint8Array ` | - Complete encrypted blob body to hash. |

Returns: ` Uint8Array `.

### ibeBlobWrappedKey

The blob's IBE-wrapped data key as an `IbeCiphertext` (what `ibeDecryptWithKey` takes).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe-blob.ts#L165)

Import: `import {ibeBlobWrappedKey} from 'tasra-sdk'`

```ts
declare function ibeBlobWrappedKey(header: IbeBlobHeader): IbeCiphertext;
```

| Parameter | Type | Description |
|---|---|---|
| ` header ` | ` IbeBlobHeader ` | - Blob header containing the wrapped data key. |

Returns: ` IbeCiphertext `.

### ibeCombineDecrypt

Combine k extraction partials and AEAD-decrypt `ct` - mirrors
`bls::ibe::combine_decrypt` (verify every share to Lagrange-combine to `T = e(sk_ID,U)`
to KDF to open). The intermediate `sk_ID` never leaves this function.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe.ts#L298)

Import: `import {ibeCombineDecrypt} from 'tasra-sdk'`

```ts
declare function ibeCombineDecrypt(verifyingShares: IbeVerifyingShares, shares: IbeDecryptionShare[], ct: IbeCiphertext, identity: Uint8Array): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` verifyingShares ` | ` IbeVerifyingShares ` | - Participant identifiers and authenticated G2 verifying shares. |
| ` shares ` | ` IbeDecryptionShare[] ` | - Distinct identity-key shares sufficient for the slot threshold. |
| ` ct ` | ` IbeCiphertext ` | - IBE ciphertext to decrypt. |
| ` identity ` | ` Uint8Array ` | - Identity bytes used during encryption. |

Returns: ` Uint8Array `.

### ibeCombineExtract

Lagrange-combine k verified partials into the identity key `sk_ID = msk * Q_ID`
(48-byte compressed G1).

 Holding `sk_ID` is a DURABLE capability over every past and future ciphertext to
this identity - prefer [ibeCombineDecrypt](#ibecombinedecrypt), which uses and drops it. Verifies
every share first (a caller combining unverified shares could be fed garbage that
silently fails the AEAD later, unattributed).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe.ts#L267)

Import: `import {ibeCombineExtract} from 'tasra-sdk'`

```ts
declare function ibeCombineExtract(verifyingShares: IbeVerifyingShares, shares: IbeDecryptionShare[], identity: Uint8Array): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` verifyingShares ` | ` IbeVerifyingShares ` | - Participant identifiers and authenticated G2 verifying shares. |
| ` shares ` | ` IbeDecryptionShare[] ` | - Distinct identity-key shares sufficient for the slot threshold. |
| ` identity ` | ` Uint8Array ` | - Exact bytes of the requested identity. |

Returns: ` Uint8Array `.

### ibeDecryptBlobChunk

Decrypt one chunk (its exact body slice, see [ibeBlobChunkRange](#ibeblobchunkrange)).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe-blob.ts#L200)

Import: `import {ibeDecryptBlobChunk} from 'tasra-sdk'`

```ts
declare function ibeDecryptBlobChunk(key: CryptoKey, header: IbeBlobHeader, index: number, chunk: Uint8Array): Promise<Uint8Array>;
```

| Parameter | Type | Description |
|---|---|---|
| ` key ` | ` CryptoKey ` | - AES-GCM decryption key imported from the unwrapped data key. |
| ` header ` | ` IbeBlobHeader ` | - Header providing chunk identity and authentication context. |
| ` index ` | ` number ` | - Zero-based integer chunk index below header.chunkCount. |
| ` chunk ` | ` Uint8Array ` | - Complete encrypted chunk including its authentication tag. |

Returns: ` Promise<Uint8Array> `.

### ibeDecryptRequest

One-call identity-scoped decrypt (the read path): token to extraction fan-out
to verify each partial to combine to decrypt. The intermediate `sk_ID` never surfaces.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/request.ts#L501)

Import: `import {ibeDecryptRequest} from 'tasra-sdk'`

```ts
declare function ibeDecryptRequest(opts: IbeExtractRequestOpts & {
    ciphertext: IbeCiphertext;
}): Promise<Uint8Array>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` IbeExtractRequestOpts & { ciphertext: IbeCiphertext; } ` | - Authorization context, identity and IBE ciphertext to decrypt. |

Returns: ` Promise<Uint8Array> `.

### ibeDecryptWithKey

Decrypt with an already-extracted identity key (48-byte compressed G1) - the
custody-opt-in path pairing with [ibeCombineExtract](#ibecombineextract).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe.ts#L320)

Import: `import {ibeDecryptWithKey} from 'tasra-sdk'`

```ts
declare function ibeDecryptWithKey(skIdBytes: Uint8Array, ct: IbeCiphertext, identity: Uint8Array): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` skIdBytes ` | ` Uint8Array ` | - 48-byte compressed extracted identity key. |
| ` ct ` | ` IbeCiphertext ` | - IBE ciphertext to decrypt. |
| ` identity ` | ` Uint8Array ` | - Identity bytes used during encryption. |

Returns: ` Uint8Array `.

### ibeEncrypt

Encrypt `message` to `identity` under the slot's master public key (96-byte
compressed G2). Offline and permissionless - the identity's key need not exist yet.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe.ts#L193)

Import: `import {ibeEncrypt} from 'tasra-sdk'`

```ts
declare function ibeEncrypt(mpkBytes: Uint8Array, identity: Uint8Array, message: Uint8Array): IbeCiphertext;
```

| Parameter | Type | Description |
|---|---|---|
| ` mpkBytes ` | ` Uint8Array ` | - 96-byte compressed BLS master public key. |
| ` identity ` | ` Uint8Array ` | - Exact identity bytes that decryption must use. |
| ` message ` | ` Uint8Array ` | - Plaintext bytes to encrypt. |

Returns: ` IbeCiphertext `.

### ibeExtractRequest

Resolve an identity-scoped committee token, fan out for extraction partials, verify
each (identifiable abort - the error names the node), and return `sk_ID` (48-byte
compressed G1).

 CUSTODY OPT-IN: holding `sk_ID` is a durable capability over every past and future
ciphertext to this identity. Prefer [ibeDecryptRequest](#ibedecryptrequest), which combines,
decrypts and drops it. Zeroize the returned bytes when done.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/request.ts#L485)

Import: `import {ibeExtractRequest} from 'tasra-sdk'`

```ts
declare function ibeExtractRequest(opts: IbeExtractRequestOpts): Promise<Uint8Array>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` IbeExtractRequestOpts ` | - Authorization context, keeper endpoints and requested identity. |

Returns: ` Promise<Uint8Array> `.

### ibeOpenBlob

Open a whole sealed blob with `sk_ID`: unwrap the key, decrypt every chunk, return the
plaintext. Streaming consumers use `ibeUnwrapBlobKey` + `ibeDecryptBlobChunk` per range.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe-blob.ts#L220)

Import: `import {ibeOpenBlob} from 'tasra-sdk'`

```ts
declare function ibeOpenBlob(skIdBytes: Uint8Array, header: IbeBlobHeader, body: Uint8Array): Promise<Uint8Array>;
```

| Parameter | Type | Description |
|---|---|---|
| ` skIdBytes ` | ` Uint8Array ` | - 48-byte compressed extracted identity key. |
| ` header ` | ` IbeBlobHeader ` | - Header returned when the blob was sealed. |
| ` body ` | ` Uint8Array ` | - Concatenated encrypted chunks in their original order. |

Returns: ` Promise<Uint8Array> `.

### ibeSealBlob

Seal `plaintext` to `identity` under the slot's master public key: a fresh data key,
IBE-wrapped, and the body as independently-decryptable AES-256-GCM chunks. Offline and
permissionless, like `ibeEncrypt`.
Empty plaintext produces one authenticated chunk with no plaintext and a 16-byte tag.
An exact multiple of chunkSize has no extra chunk; otherwise the last chunk is shorter.
Retain a trusted header, or authenticate a manifest containing both the header
and body digest. A signed body digest alone does not authenticate the media type.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe-blob.ts#L125)

Import: `import {ibeSealBlob} from 'tasra-sdk'`

```ts
declare function ibeSealBlob(mpkBytes: Uint8Array, identity: string, plaintext: Uint8Array, opts?: {
    contentType?: string;
    chunkSize?: number;
}): Promise<SealedBlob>;
```

| Parameter | Type | Description |
|---|---|---|
| ` mpkBytes ` | ` Uint8Array ` | - 96-byte compressed BLS master public key. |
| ` identity ` | ` string ` | - Identity string used to wrap the object data key. |
| ` plaintext ` | ` Uint8Array ` | - Complete plaintext object bytes. |
| ` opts? ` | ` { contentType?: string; chunkSize?: number; } ` | - Optional media type and integer plaintext chunk size of at least 1024 bytes; default chunk size is 1 MiB. |

Returns: ` Promise<SealedBlob> `.

### ibeUnwrapBlobKey

Unwrap the data key with the identity's extracted key `sk_ID` (48-byte compressed G1 -
`ibeCombineExtract`'s output). One pairing; the caller keeps the returned key in memory only
as long as it decrypts, then zeroizes it.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe-blob.ts#L177)

Import: `import {ibeUnwrapBlobKey} from 'tasra-sdk'`

```ts
declare function ibeUnwrapBlobKey(skIdBytes: Uint8Array, header: IbeBlobHeader): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` skIdBytes ` | ` Uint8Array ` | - 48-byte compressed extracted identity key. |
| ` header ` | ` IbeBlobHeader ` | - Header containing the wrapped data key and identity. |

Returns: ` Uint8Array `.

### ibeVerifyShare

Verify one extraction partial against its node's dual-group verifying share (the
96-byte G2 half): `e(D_i, G2) == e(Q_ID, Y_i)`. Throws naming the identifier -
identifiable abort: the caller knows WHICH node served a bad share.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe.ts#L237)

Import: `import {ibeVerifyShare} from 'tasra-sdk'`

```ts
declare function ibeVerifyShare(verifyingShares: IbeVerifyingShares, identity: Uint8Array, share: IbeDecryptionShare): void;
```

| Parameter | Type | Description |
|---|---|---|
| ` verifyingShares ` | ` IbeVerifyingShares ` | - Independently established participant identifiers and G2 verifying shares. |
| ` identity ` | ` Uint8Array ` | - Exact bytes of the requested identity. |
| ` share ` | ` IbeDecryptionShare ` | - Identity-key share to verify. |

Returns: ` void `.

### isAuthDenied

True when `e` is an auth rejection - i.e. retrying is pointless, re-claim
instead. Keyed on the HTTP status rather than the class, so it also catches
subclasses that carry their own name (e.g. `CommitteeAuthorizeError`).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/errors.ts#L178)

Import: `import {isAuthDenied} from 'tasra-sdk'`

```ts
declare function isAuthDenied(e: unknown): e is TasraHttpError;
```

| Parameter | Type | Description |
|---|---|---|
| ` e ` | ` unknown ` | - Caught value to classify as an authorization rejection. |

Returns: ` e is TasraHttpError `.

### isHeaderSafeNonce

Guard for a nonce that can ride in a header (the agent's challenge carries it back).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/dpop.ts#L154)

Import: `import {isHeaderSafeNonce} from 'tasra-sdk'`

```ts
declare function isHeaderSafeNonce(nonce: string): boolean;
```

| Parameter | Type | Description |
|---|---|---|
| ` nonce ` | ` string ` | - Nonce text to check before using it as an HTTP header value. |

Returns: ` boolean `.

### isJwtExpiringSoon

True when the token is expired or within `skewMs` of expiring.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L300)

Import: `import {isJwtExpiringSoon} from 'tasra-sdk'`

```ts
declare function isJwtExpiringSoon(jwt: string, skewMs?: number): boolean;
```

| Parameter | Type | Description |
|---|---|---|
| ` jwt ` | ` string ` | - Compact JWT to inspect without signature verification. |
| ` skewMs? ` | ` number ` | - Refresh lead time in milliseconds. |

Returns: ` boolean `.

### isOid4vpRule

True when `rule` parses as a supported OID4VP-DCQL query.

This is the grammar dispatch used by the commitment. It must stay a TOTAL function -
a legacy kk-DCQL rule is not an error here, it is simply "not OID4VP".

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L998)

Import: `import {isOid4vpRule} from 'tasra-sdk'`

```ts
declare function isOid4vpRule(rule: string): boolean;
```

| Parameter | Type | Description |
|---|---|---|
| ` rule ` | ` string ` | - Policy text to check for a supported DCQL shape. |

Returns: ` boolean `.

### isRetryable

True when a typed failure may be transient. Errors outside the TasraError
hierarchy return false. This hint does not make a write safe to repeat.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/errors.ts#L188)

Import: `import {isRetryable} from 'tasra-sdk'`

```ts
declare function isRetryable(e: unknown): boolean;
```

| Parameter | Type | Description |
|---|---|---|
| ` e ` | ` unknown ` | - Caught value to inspect for a retryable Tasra error. |

Returns: ` boolean `.

### issueAdminCredential

Admin-mint a single-use credential (redemption token) for the given scopes.
Requires the verifier's admin secret. Pair with redeemCredential() to get a
JWT whose `sub` is the recipient DID you pass there.
POST {verifier}/v1/admin/credentials/issue  (header: X-Admin-Secret)

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L145)

Import: `import {issueAdminCredential} from 'tasra-sdk'`

```ts
declare function issueAdminCredential(verifierUrl: string, adminSecret: string, opts: {
    scopes: string[];
    slotIds?: string[];
    ttlSecs?: number;
}): Promise<RedemptionGrant>;
```

| Parameter | Type | Description |
|---|---|---|
| ` verifierUrl ` | ` string ` | - Verifier HTTP base URL. |
| ` adminSecret ` | ` string ` | - Verifier administrative secret; keep it out of browser code and logs. |
| ` opts ` | ` { scopes: string[]; slotIds?: string[]; ttlSecs?: number; } ` | - Authorized scopes, optional slot bindings and lifetime. |

Returns: ` Promise<RedemptionGrant> `.

### isTasraPost

Check the Tasra text prefix and minimum length. This does not validate the envelope.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/detect.ts#L11)

Import: `import {isTasraPost} from 'tasra-sdk'`

```ts
declare function isTasraPost(text: string): boolean;
```

| Parameter | Type | Description |
|---|---|---|
| ` text ` | ` string ` | - Text payload to inspect for the Tasra prefix. |

Returns: ` boolean `.

### jsonCredential

A [CredentialView](#credentialview) over a parsed JSON credential body.

Path resolution walks object keys, plus `null` for "every element of this array". A path
that runs into the wrong shape is ABSENT rather than an error, which is what makes the
evaluator fail closed.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L182)

Import: `import {jsonCredential} from 'tasra-sdk'`

```ts
declare function jsonCredential(args: {
    format: string;
    types: readonly string[];
    body: unknown;
}): CredentialView;
```

| Parameter | Type | Description |
|---|---|---|
| ` args ` | ` { format: string; types: readonly string[]; body: unknown; } ` | - Format, credential types and parsed JSON body exposed to the evaluator. |

Returns: ` CredentialView `.

### jwkThumbprint

RFC 7638 JWK thumbprint of an EC P-256 public key.

 The member order is LEXICOGRAPHIC and the JSON has no whitespace - the RFC hashes an
exactly specified string, so `JSON.stringify` over an object literal in a different order
yields a different thumbprint and the token's `cnf.jkt` would never match.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/dpop.ts#L105)

Import: `import {jwkThumbprint} from 'tasra-sdk'`

```ts
declare function jwkThumbprint(jwk: JsonWebKey): Promise<string>;
```

| Parameter | Type | Description |
|---|---|---|
| ` jwk ` | ` JsonWebKey ` | - Public JSON Web Key whose required members form the thumbprint. |

Returns: ` Promise<string> `.

### jwtExpMs

Expiry as epoch-ms, or null if absent/unparseable.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L289)

Import: `import {jwtExpMs} from 'tasra-sdk'`

```ts
declare function jwtExpMs(jwt: string): number | null;
```

| Parameter | Type | Description |
|---|---|---|
| ` jwt ` | ` string ` | - Compact JWT whose expiration claim will be inspected without verification. |

Returns: ` number | null `.

### parseTasraPost

Decode a Tasra text payload into an envelope; return null for invalid input.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/detect.ts#L29)

Import: `import {parseTasraPost} from 'tasra-sdk'`

```ts
declare function parseTasraPost(text: string): GroupEnvelope | null;
```

| Parameter | Type | Description |
|---|---|---|
| ` text ` | ` string ` | - Text payload to inspect and decode. |

Returns: ` GroupEnvelope | null `.

### payloadDigest

Compute the `payload_digest` for a given action and message.

For `sign` and `ibe-extract`, this is `sha256(message_bytes)` as 0x-hex.
Other actions should supply the digest directly.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L198)

Import: `import {payloadDigest} from 'tasra-sdk'`

```ts
declare function payloadDigest(action: string, messageHex: string): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` action ` | ` string ` | - Operation name: sign and ibe-extract hash the supplied bytes. |
| ` messageHex ` | ` string ` | - Hexadecimal message bytes or an already computed digest for other actions. |

Returns: ` string `.

### pollOid4vpSession

Fetch and validate one authorization session status. Transport failures and HTTP 502, 503 or 504 produce an unavailable error; malformed or other failed replies produce a protocol error. The polling secret is sent in the Authorization header.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L364)

Import: `import {pollOid4vpSession} from 'tasra-sdk'`

```ts
declare function pollOid4vpSession(verifierAgentUrl: string, sessionId: string, pollSecret: string): Promise<SessionStatusResult>;
```

| Parameter | Type | Description |
|---|---|---|
| ` verifierAgentUrl ` | ` string ` | - Verifier-agent HTTP base URL. |
| ` sessionId ` | ` string ` | - Opened session identifier. |
| ` pollSecret ` | ` string ` | - Secret returned at session creation; do not expose it in logs. |

Returns: ` Promise<SessionStatusResult> `.

### redeemCredential

Redeem an admin-issued, single-use credential/invite token for a JWT.
POST {verifier}/v1/credentials/redeem  {redemption_token, recipient_did}

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L113)

Import: `import {redeemCredential} from 'tasra-sdk'`

```ts
declare function redeemCredential(verifierUrl: string, redemptionToken: string, recipientDid: string): Promise<IssuedToken>;
```

| Parameter | Type | Description |
|---|---|---|
| ` verifierUrl ` | ` string ` | - Verifier HTTP base URL. |
| ` redemptionToken ` | ` string ` | - Single-use credential redemption token. |
| ` recipientDid ` | ` string ` | - DID of the recipient redeeming the token. |

Returns: ` Promise<IssuedToken> `.

### redeemRenewalToken

Redeem a long-lived renewal token for a fresh JWT.
POST {verifier}/v1/renewals/redeem  {renewal_token}

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L95)

Import: `import {redeemRenewalToken} from 'tasra-sdk'`

```ts
declare function redeemRenewalToken(verifierUrl: string, renewalToken: string): Promise<IssuedToken>;
```

| Parameter | Type | Description |
|---|---|---|
| ` verifierUrl ` | ` string ` | - Verifier HTTP base URL. |
| ` renewalToken ` | ` string ` | - Long-lived renewal token to redeem. |

Returns: ` Promise<IssuedToken> `.

### requestIbeExtractionPartials

Fan out to the keeper nodes and collect extraction partials. Nodes that refuse or are
down are skipped; throws - naming every node and its reason - only when NONE served.
The caller combines with `ibeCombineDecrypt`/`ibeCombineExtract`, which pairing-verify
each partial (identifiable abort names the node via the identifier).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/client.ts#L613)

Import: `import {requestIbeExtractionPartials} from 'tasra-sdk'`

```ts
declare function requestIbeExtractionPartials(opts: IbeExtractOpts): Promise<IbeExtractionPartial[]>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` IbeExtractOpts ` | - Compound token, identity, keepers and optional expected epoch. |

Returns: ` Promise<IbeExtractionPartial[]> `.

### revokeRenewal

Revoke a renewal token - future redeems are denied, and any bound slots get a
rotation webhook. POST {verifier}/v1/renewals/revoke  {renewal_token}

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L77)

Import: `import {revokeRenewal} from 'tasra-sdk'`

```ts
declare function revokeRenewal(verifierUrl: string, renewalToken: string): Promise<void>;
```

| Parameter | Type | Description |
|---|---|---|
| ` verifierUrl ` | ` string ` | - Verifier HTTP base URL. |
| ` renewalToken ` | ` string ` | - Renewal token to revoke. |

Returns: ` Promise<void> `.

### revokeSlotUser

Submit an administrative request to revoke a holder DID's slot access.
Rotation is requested by default. A successful HTTP response confirms request
acceptance only; callers must confirm the new slot key and epoch before relying
on completed rotation. Resolve application handles to DIDs before calling.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L175)

Import: `import {revokeSlotUser} from 'tasra-sdk'`

```ts
declare function revokeSlotUser(verifierUrl: string, adminSecret: string, opts: {
    slotId: string;
    did: string;
    rotate?: boolean;
    reason?: string;
}): Promise<void>;
```

| Parameter | Type | Description |
|---|---|---|
| ` verifierUrl ` | ` string ` | - Verifier HTTP base URL. |
| ` adminSecret ` | ` string ` | - Verifier administrative secret. |
| ` opts ` | ` { slotId: string; did: string; rotate?: boolean; reason?: string; } ` | - Slot, holder DID, optional rotation request and revocation reason. |

Returns: ` Promise<void> `.

### scopeCovers

Whether the scope `grant` (from a verified credential) covers the requested
`identity`. Fail-closed on oversize or NUL-bearing inputs.

 Implemented over UTF-8 BYTES, not UTF-16 code units, deliberately: the reference implementation
compares raw bytes, the length cap is in bytes, and the `/`-boundary check indexes a
byte position. Operating on `.length`/`charAt` would diverge for any non-ASCII
segment.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/identityScope.ts#L47)

Import: `import {scopeCovers} from 'tasra-sdk'`

```ts
declare function scopeCovers(grant: string, identity: string): boolean;
```

| Parameter | Type | Description |
|---|---|---|
| ` grant ` | ` string ` | - Slash-delimited scope grant, optionally ending in a wildcard. |
| ` identity ` | ` string ` | - Requested identity string to compare with the grant. |

Returns: ` boolean `.

### selectDcql

Select the minimal set of credentials that satisfy `rule` - the inverse of
` evaluate `. Given a rule and held credentials, returns which to present.

When `credential_sets` are present, picks the cheapest satisfying option
(fewest credential queries). When absent, every credential query must be
satisfied.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L718)

Import: `import {selectDcql} from 'tasra-sdk'`

```ts
declare function selectDcql(rule: string, credentials: readonly CredentialView[], opts?: ValidateOptions): Selection;
```

| Parameter | Type | Description |
|---|---|---|
| ` rule ` | ` string ` | - DCQL policy encoded as JSON text. |
| ` credentials ` | ` readonly CredentialView[] ` | - Credential views available for local matching. |
| ` opts? ` | ` ValidateOptions ` | - Issuer-constraint validation options. |

Returns: ` Selection `.

### signCustody

Sign a message via the custody path: the node runs the whole FROST ceremony
 and returns the final group signature (one HTTP round-trip).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/signing/frost.ts#L97)

Import: `import {signCustody} from 'tasra-sdk'`

```ts
declare function signCustody(opts: SignCustodyOpts): Promise<FrostSignResult>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` SignCustodyOpts ` | - Keeper endpoint, JWT, message and optional participant or owner-approval settings. |

Returns: ` Promise<FrostSignResult> `.

### signEoaDigest

Threshold-sign a 32-byte digest with a tecdsa slot's key. Returns the raw
Ethereum signature components; assemble into a transaction with ethSignatureV().

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/signing/ecdsa.ts#L50)

Import: `import {signEoaDigest} from 'tasra-sdk'`

```ts
declare function signEoaDigest(opts: EoaSignOpts): Promise<EoaSignature>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` EoaSignOpts ` | - Keeper endpoint, JWT, slot and 32-byte ECDSA digest. |

Returns: ` Promise<EoaSignature> `.

### signUserRequest

Sign the user-gated payload with the slot owner's 32-byte Ed25519 secret key.
 The result goes in SignCustodyOpts.userSignature (also pass the same requestId).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/signing/frost.ts#L163)

Import: `import {signUserRequest} from 'tasra-sdk'`

```ts
declare function signUserRequest(secretKey: Uint8Array, slotId: string, message: Uint8Array, requestId: string): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` secretKey ` | ` Uint8Array ` | - 32-byte Ed25519 owner secret key. |
| ` slotId ` | ` string ` | - 32-byte slot identifier as hexadecimal text. |
| ` message ` | ` Uint8Array ` | - Raw message bytes to authorize. |
| ` requestId ` | ` string ` | - Request identifier to bind into the owner approval. |

Returns: ` Uint8Array `.

### signWithShardDelivery

Sign via the shard-delivery path: the CLIENT fans out to k nodes (Round 1
commit, Round 2 partial) and aggregates the shares locally into the group
signature. The node URLs must be exactly the k committee members.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/signing/frost.ts#L254)

Import: `import {signWithShardDelivery} from 'tasra-sdk'`

```ts
declare function signWithShardDelivery(opts: ShardSignOpts): Promise<FrostSignature>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` ShardSignOpts ` | - Selected keepers, JWT, message and local signature verification settings. |

Returns: ` Promise<FrostSignature> `.

### submitOauthResponse

Submit a DPoP-bound access token and proof to an OAuth session. The signer must use the key bound to that token. Retry once when the server responds with a DPoP nonce challenge.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L311)

Import: `import {submitOauthResponse} from 'tasra-sdk'`

```ts
declare function submitOauthResponse(verifierAgentUrl: string, args: {
    sessionId: string;
    pollSecret: string;
    accessToken: string;
    nonce: string;
    dpopHtu: string;
    signer: DpopSigner;
}): Promise<void>;
```

| Parameter | Type | Description |
|---|---|---|
| ` verifierAgentUrl ` | ` string ` | - Verifier-agent HTTP base URL. |
| ` args ` | ` { sessionId: string; pollSecret: string; accessToken: string; nonce: string; dpopHtu: string; signer: DpopSigner; } ` | - Session credentials, DPoP-bound access token, nonce and matching signer. |

Returns: ` Promise<void> `.

### toBytes

Serialize an envelope using the version selected by its epoch. Reject invalid epoch and oversized fields.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/envelope.ts#L57)

Import: `import {toBytes} from 'tasra-sdk'`

```ts
declare function toBytes(env: GroupEnvelope): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` env ` | ` GroupEnvelope ` | - Envelope to serialize, including its slot, ciphertext and optional epoch. |

Returns: ` Uint8Array `.

### userSignaturePayload

The canonical payload the node verifies for a user-gated sign:
 domain || u64_LE(len slot) || slot || u64_LE(32) || SHA256(message) ||
 u64_LE(len requestId) || requestId.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/signing/frost.ts#L136)

Import: `import {userSignaturePayload} from 'tasra-sdk'`

```ts
declare function userSignaturePayload(slotId: string, message: Uint8Array, requestId: string): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` slotId ` | ` string ` | - 32-byte slot identifier as hexadecimal text. |
| ` message ` | ` Uint8Array ` | - Raw message bytes to authorize. |
| ` requestId ` | ` string ` | - Request identifier to bind into the owner approval. |

Returns: ` Uint8Array `.

### validateDcql

Parse and validate the supported DCQL rule grammar. Reject unknown fields, unsupported constraints and rules that exceed the byte limit.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L389)

Import: `import {validateDcql} from 'tasra-sdk'`

```ts
declare function validateDcql(rule: string, opts?: ValidateOptions): Query;
```

| Parameter | Type | Description |
|---|---|---|
| ` rule ` | ` string ` | - DCQL policy encoded as JSON text. |
| ` opts? ` | ` ValidateOptions ` | - Whether each credential query must explicitly constrain its issuer. |

Returns: ` Query `.

### validateRecipientRule

Explicitly validate a slot's rule client-side: returns normally if well-formed,
throws [DcqlMalformedError](#dcqlmalformederror) otherwise.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/recipient/store.ts#L108)

Import: `import {validateRecipientRule} from 'tasra-sdk'`

```ts
declare function validateRecipientRule(rule: string): void;
```

| Parameter | Type | Description |
|---|---|---|
| ` rule ` | ` string ` | - DCQL policy encoded as JSON text. |

Returns: ` void `.

### verifyDecryptShare

Check a partial decryption against its supplied verifying share using a pairing. Return false for missing or malformed material.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/kem.ts#L260)

Import: `import {verifyDecryptShare} from 'tasra-sdk'`

```ts
declare function verifyDecryptShare(share: DecryptShare, u: Uint8Array): boolean;
```

| Parameter | Type | Description |
|---|---|---|
| ` share ` | ` DecryptShare ` | - Partial decryption and its public verifying share. |
| ` u ` | ` Uint8Array ` | - 96-byte compressed ephemeral G2 key from the ciphertext. |

Returns: ` boolean `.

### verifyFrostSignature

Verify the FROST-Ed25519 group signature using the challenge SHA-512 over
the concatenated commitment, group public key and message, reduced modulo
the scalar order. Return false if point decoding or signature verification fails.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/frost.ts#L199)

Import: `import {verifyFrostSignature} from 'tasra-sdk'`

```ts
declare function verifyFrostSignature(groupPublicKey: Uint8Array, message: Uint8Array, sig: FrostSignature): boolean;
```

| Parameter | Type | Description |
|---|---|---|
| ` groupPublicKey ` | ` Uint8Array ` | - 32-byte FROST group public key. |
| ` message ` | ` Uint8Array ` | - Original signed message bytes. |
| ` sig ` | ` FrostSignature ` | - Aggregated FROST signature to verify. |

Returns: ` boolean `.

### verifyPresentation

Present credentials directly for a JWT. The `body` shape is defined by the
verifier (a DCQL rule + a presentation/credentials); we pass it through
untouched so this stays agnostic to the credential format.
POST {verifier}/v1/verify

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L206)

Import: `import {verifyPresentation} from 'tasra-sdk'`

```ts
declare function verifyPresentation(verifierUrl: string, body: {
    dcql_rule: string;
    presentation: unknown;
    credentials?: unknown;
}): Promise<IssuedToken>;
```

| Parameter | Type | Description |
|---|---|---|
| ` verifierUrl ` | ` string ` | - Verifier HTTP base URL. |
| ` body ` | ` { dcql_rule: string; presentation: unknown; credentials?: unknown; } ` | - Policy and credential presentation for verifier evaluation. |

Returns: ` Promise<IssuedToken> `.

### verifyVpJwt

The PRODUCTION credential path: present signed JWT-VCs + holder proof for a
DCQL-gated JWT. The verifier checks each credential's signature against its
configured trust anchor (by `iss`), that each `sub` equals `holder`, that
`holder_proof` proves live control of the holder DID authentication key, then
evaluates the rule. `credentials` are compact JWS strings (e.g. from
`tasra-cli vc issue`).
POST {verifier}/v1/verify-vp-jwt

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L230)

Import: `import {verifyVpJwt} from 'tasra-sdk'`

```ts
declare function verifyVpJwt(verifierUrl: string, body: {
    dcql_rule: string;
    holder: string;
    credentials: string[];
    holder_proof: string;
}): Promise<IssuedToken>;
```

| Parameter | Type | Description |
|---|---|---|
| ` verifierUrl ` | ` string ` | - Verifier HTTP base URL. |
| ` body ` | ` { dcql_rule: string; holder: string; credentials: string[]; holder_proof: string; } ` | - Policy, holder DID, signed credentials and proof of holder-key possession. |

Returns: ` Promise<IssuedToken> `.

### waitForSession

Poll until the session reaches a terminal state (done or failed) - bounded by
`timeoutMs`, with a growing jittered interval so many clients never poll in lock-step.
A transient `unavailable` answer (a 503, a dropped connection) is retried within the
deadline; a `protocol` answer stops at once; the deadline is a `timeout` error; the
caller's `signal` is a `cancelled` error. A terminal `failed` is RETURNED (the caller
decides how to explain it) - see `awaitVerifierAgentResult` for the version that throws `refused`.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L459)

Import: `import {waitForSession} from 'tasra-sdk'`

```ts
declare function waitForSession(verifierAgentUrl: string, sessionId: string, pollSecret: string, intervalMs?: number, timeoutMs?: number, opts?: WaitOpts): Promise<SessionStatusResult>;
```

| Parameter | Type | Description |
|---|---|---|
| ` verifierAgentUrl ` | ` string ` | - Verifier-agent HTTP base URL. |
| ` sessionId ` | ` string ` | - Opened session identifier. |
| ` pollSecret ` | ` string ` | - bearer token returned by `createOid4vpSession` |
| ` intervalMs? ` | ` number ` | - initial polling interval in milliseconds (default 2000) |
| ` timeoutMs? ` | ` number ` | - total deadline in milliseconds (default 300000 = 5 min) |
| ` opts? ` | ` WaitOpts ` | - Cancellation, phase callback and polling backoff controls. |

Returns: ` Promise<SessionStatusResult> `.

## Types

Options, data structures and return types.

<details>
<summary>Browse 58 types</summary>

- [BlsPeer](#blspeer)
- [BuildHolderProofOpts](#buildholderproofopts)
- [Ciphertext](#ciphertext)
- [ClaimResult](#claimresult)
- [CreateOauthSessionResult](#createoauthsessionresult)
- [CreateSessionParams](#createsessionparams)
- [CreateSessionResult](#createsessionresult)
- [CredentialView](#credentialview)
- [DcqlClaimQuery](#dcqlclaimquery)
- [DcqlCredentialQuery](#dcqlcredentialquery)
- [DcqlCredentialSetQuery](#dcqlcredentialsetquery)
- [DcqlMeta](#dcqlmeta)
- [DcqlQuery](#dcqlquery)
- [DcqlSelection](#dcqlselection)
- [DecryptCustodyOpts](#decryptcustodyopts)
- [DecryptShare](#decryptshare)
- [DpopKey](#dpopkey)
- [DpopSigner](#dpopsigner)
- [EoaSignature](#eoasignature)
- [EoaSignOpts](#eoasignopts)
- [Faucet](#faucet)
- [FaucetGrant](#faucetgrant)
- [FrostCommitment](#frostcommitment)
- [FrostShare](#frostshare)
- [FrostSignature](#frostsignature)
- [FrostSignResult](#frostsignresult)
- [GroupEnvelope](#groupenvelope)
- [HeldCredential](#heldcredential)
- [HolderNonce](#holdernonce)
- [HolderProofAuth](#holderproofauth)
- [HolderSigner](#holdersigner)
- [IbeBlobHeader](#ibeblobheader)
- [IbeCiphertext](#ibeciphertext)
- [IbeDecryptionShare](#ibedecryptionshare)
- [IbeExtractionPartial](#ibeextractionpartial)
- [IbeExtractOpts](#ibeextractopts)
- [IbeExtractRequestOpts](#ibeextractrequestopts)
- [IbeVerifyingShares](#ibeverifyingshares)
- [IssuedToken](#issuedtoken)
- [JwtClaims](#jwtclaims)
- [OpenSessionOpts](#opensessionopts)
- [PresentationDelegation](#presentationdelegation)
- [PresentationOperation](#presentationoperation)
- [RedemptionGrant](#redemptiongrant)
- [RenewalGrant](#renewalgrant)
- [ScopeNamespace](#scopenamespace)
- [SealedBlob](#sealedblob)
- [Session](#session)
- [SessionAuth](#sessionauth)
- [SessionStatusResult](#sessionstatusresult)
- [ShardDecryptOpts](#sharddecryptopts)
- [ShardSignOpts](#shardsignopts)
- [SignCustodyOpts](#signcustodyopts)
- [SignOpts](#signopts)
- [TasraClient](#tasraclient)
- [TasraClientConfig](#tasraclientconfig)
- [VerifierAgentSessionErrorKind](#verifieragentsessionerrorkind)
- [VpJwtAuth](#vpjwtauth)

</details>

### BlsPeer

A node's BLS identifier + its libp2p PeerId, for the custody decrypting set.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/decryption/client.ts#L42)

```ts
export interface BlsPeer {
    id: number;
    peerId: string;
}
```

Fields:

- **` id `**: BLS threshold participant identifier.
- **` peerId `**: Network peer identifier for that participant.

### BuildHolderProofOpts

Holder signing key, verifier challenge and credentials to bind into a proof.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/holderProof.ts#L111)

```ts
export interface BuildHolderProofOpts {
    signer: HolderSigner;
    audience: string;
    nonce: string;
    credentials: string[];
    slotId?: string;
    action?: string;
    ttlSecs?: number;
    nowSecs?: number;
}
```

Fields:

- **` signer `**: Holder DID authentication key or signing callback.
- **` audience `**: The verifier's expected audience (its token `iss`).
- **` nonce `**: The challenge from [fetchHolderNonce](#fetchholdernonce).
- **` credentials `**: The exact compact-JWS credentials being presented, in order.
- **` slotId `**: Echo the nonce's slot binding (when the nonce was slot-bound).
- **` action `**: Echo the nonce's action binding.
- **` ttlSecs `**: Proof lifetime, seconds (default 300).
- **` nowSecs `**: Override `iat` (Unix seconds) - for tests.

### Ciphertext

BLS group encryption ciphertext containing an ephemeral key, nonce and authenticated payload.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/kem.ts#L128)

```ts
export interface Ciphertext {
    u: Uint8Array;
    nonce: Uint8Array;
    aeadCt: Uint8Array;
}
```

Fields:

- **` u `**: 96-byte compressed G2 ephemeral public key U = r*G2.
- **` nonce `**: 12-byte ChaCha20-Poly1305 nonce, derived from U.
- **` aeadCt `**: AEAD ciphertext: plaintext.len + 16 (Poly1305 tag).

### ClaimResult

Claim lookup result that distinguishes an absent claim from a present value, including JSON null.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L145)

```ts
export type ClaimResult = {
    found: true;
    value: unknown;
} | {
    found: false;
};
```

Fields:

- **` found `**: Whether the claim path resolves; a present JSON null value counts as found.

### CreateOauthSessionResult

an `oauth` session - the client brings a DPoP-bound access token.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L80)

```ts
export interface CreateOauthSessionResult {
    sessionId: string;
    pollSecret: string;
    nonce: string;
    dpopHtu: string;
    platformAudience: string;
}
```

Fields:

- **` sessionId `**: Opened authorization session identifier.
- **` pollSecret `**: Session secret used for polling and OAuth submission. Never expose it in logs.
- **` nonce `**: Initial DPoP challenge nonce for this session.
- **` dpopHtu `**: Canonical OAuth response URI to bind into the DPoP proof.
- **` platformAudience `**: Audience the identity provider must include in the access token for this platform.

### CreateSessionParams

Signed operation, optional delegation and payload submitted to the verifier agent.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L56)

```ts
export interface CreateSessionParams {
    operation: PresentationOperation;
    operationSig: string;
    delegation?: PresentationDelegation;
    messageHex: string;
}
```

Fields:

- **` operation `**: Signed operation details presented for authorization.
- **` operationSig `**: 0x-hex 65-byte EIP-712 signature over the operation
- **` delegation `**: Optional EIP-712 delegation from the slot creator
- **` messageHex `**: The raw payload as 0x-hex

### CreateSessionResult

Wallet presentation link and polling credentials for an opened authorization session.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L68)

```ts
export interface CreateSessionResult {
    sessionId: string;
    pollSecret: string;
    qrPayload: string;
    requestUri: string;
}
```

Fields:

- **` sessionId `**: Opened authorization session identifier.
- **` pollSecret `**: Bearer token for polling - treat as a secret
- **` qrPayload `**: OpenID4VP deep link for a wallet or QR code.
- **` requestUri `**: URL from which the wallet retrieves the signed request.

### CredentialView

Credential format, types and claim accessor used by the DCQL evaluator. Authenticate the credential before using an evaluation to authorize access.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L160)

```ts
export interface CredentialView {
    readonly format: string;
    readonly types: readonly string[];
    claim(path: readonly ClaimPathSegment[]): ClaimResult;
}
```

Fields:

- **` format `**: The credential's format identifier, e.g. `"jwt_vc_json"`.
- **` types `**: The credential's type list (for `jwt_vc_json`, its `type` array).
- **` claim `**: The claim at `path`, or absent when the path does not resolve. A `null` segment selects every element of an array, so the answer may be an array the credential does not literally hold.

### DcqlClaimQuery

A claim path with optional allowed values; omitting values requires the claim to exist.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L92)

```ts
export interface ClaimQuery {
    path: ClaimPathSegment[];
    values?: unknown[];
}
```

Fields:

- **` path `**: Path components into the credential: object keys, and `null` for every array element.
- **` values `**: Allowed values. Absent means the claim need only be PRESENT.

### DcqlCredentialQuery

A named credential requirement with format, claims and optional identity-scope constraints.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L108)

```ts
export interface CredentialQuery {
    id: string;
    format: string;
    meta?: Meta;
    claims?: ClaimQuery[];
    kk_identity_scope_claim?: string[];
    kk_scope_namespace?: ScopeNamespace;
}
```

Fields:

- **` id `**: Unique within the query; referenced by `credential_sets.options`.
- **` format `**: Credential format identifier.
- **` meta `**: Credential-format constraints.
- **` claims `**: Required claim paths and optional allowed values.
- **` kk_identity_scope_claim `**: Claim path containing a scope string or array of scope strings. It must also be requested in claims and accompanied by kk_scope_namespace.
- **` kk_scope_namespace `**: whose grant power the scope claim carries. Required whenever `kk_identity_scope_claim` is present; refused without it.

### DcqlCredentialSetQuery

Alternative groups of credential query identifiers, with optional display purpose.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L125)

```ts
export interface CredentialSetQuery {
    options: string[][];
    required?: boolean;
    purpose?: unknown;
}
```

Fields:

- **` options `**: Each option is a list of credential-query ids that must ALL match.
- **` required `**: Default `true`.
- **` purpose `**: Display-only wallet consent text. It does not affect credential matching, but remains part of the committed rule bytes.

### DcqlMeta

Format-specific credential type filters and OAuth authentication freshness requirements.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L79)

```ts
export interface Meta {
    type_values?: string[][];
    vct_values?: string[];
    max_age_secs?: number;
}
```

Fields:

- **` type_values `**: `jwt_vc_json`: outer array = alternatives; inner array = types that must ALL be present.
- **` vct_values `**: `dc+sd-jwt`: acceptable Verifiable Credential Type (`vct`) values - a flat list of alternatives.
- **` max_age_secs `**: Maximum age of OAuth authentication in seconds. Required for OAuth formats and evaluated separately from token expiration.

### DcqlQuery

A DCQL query. `credential_sets` absent means EVERY entry in `credentials` is required.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L135)

```ts
export interface Query {
    credentials: CredentialQuery[];
    credential_sets?: CredentialSetQuery[];
}
```

Fields:

- **` credentials `**: Named credential requirements.
- **` credential_sets `**: Optional alternative groups of credential requirements.

### DcqlSelection

The result of credential selection against a rule.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L697)

```ts
export interface Selection {
    satisfied: boolean;
    credentials: CredentialView[];
    unsatisfied: string[];
}
```

Fields:

- **` satisfied `**: Whether the rule can be satisfied by the given credentials.
- **` credentials `**: The minimal set of credentials that satisfy the rule (empty when unsatisfied).
- **` unsatisfied `**: Credential query ids that no presented credential satisfies.

### DecryptCustodyOpts

JWT-authorized group decryption coordinated by one keeper, including participant selection.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/decryption/client.ts#L50)

```ts
export interface DecryptCustodyOpts {
    nodeUrl: string;
    jwt: string;
    slotId: string;
    ciphertext: Ciphertext;
    identity: Uint8Array;
    decryptingSet: number[];
    blsPeers: BlsPeer[];
    userSignature?: Uint8Array;
    ciphertextEpoch?: number;
    targetKeykeeper?: string;
    requestId?: string;
}
```

Fields:

- **` nodeUrl `**: Keeper HTTP base URL.
- **` jwt `**: Compact bearer JWT authorizing the request.
- **` slotId `**: 32-byte slot identifier.
- **` ciphertext `**: Ciphertext to decrypt.
- **` identity `**: AEAD additional-authenticated-data (the identity the envelope was bound to).
- **` decryptingSet `**: BLS identifiers (k..n, distinct) to run the ceremony with.
- **` blsPeers `**: The libp2p peers for those identifiers.
- **` userSignature `**: 64-byte Ed25519 user signature, required iff the slot has an owner pubkey.
- **` ciphertextEpoch `**: Pin the ciphertext epoch; a rotated slot returns 410.
- **` targetKeykeeper `**: Optional 20-byte operator address to pin the intended keeper.
- **` requestId `**: Request identifier used to correlate or resume the operation.

### DecryptShare

One participant's partial BLS decryption and optional public verification material.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/kem.ts#L241)

```ts
export interface DecryptShare {
    id: number;
    decryptionShare: Uint8Array;
    verifyingShare?: Uint8Array;
}
```

Fields:

- **` id `**: 1-indexed BLS participant identifier (u16).
- **` decryptionShare `**: 96-byte compressed G2 partial decryption D_i = sk_i*U.
- **` verifyingShare `**: 144-byte verifying share: 96B compressed G2 (sk_i*g2) || 48B compressed G1 (sk_i*g1). Required only for verifyDecryptShare.

### DpopKey

An ES256 key pair for DPoP, plus a [DpopSigner](#dpopsigner) over it.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/dpop.ts#L42)

```ts
export interface DpopKey {
    publicJwk: JsonWebKey;
    thumbprint(): Promise<string>;
    signer: DpopSigner;
}
```

Fields:

- **` publicJwk `**: The public half, as the JWK that rides in every proof header.
- **` thumbprint `**: RFC 7638 thumbprint - the value the IdP puts in the token's `cnf.jkt`.
- **` signer `**: DPoP proof signer bound to this key.

### DpopSigner

Anything that can produce a DPoP proof for a given request.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/dpop.ts#L8)

```ts
export interface DpopSigner {
    proof(args: {
        htm: string;
        htu: string;
        nonce: string;
        accessToken: string;
    }): Promise<string>;
}
```

Fields:

- **` proof `**: Mint a proof binding `accessToken` to `(htm, htu, nonce)`. An implementation MUST sign with the key the access token is bound to; a proof under any other key is refused by every drawn verifier with `DPoP proof jwk is not the key the access token is bound to`.

### EoaSignature

Threshold ECDSA signature components, recovery identifier and signing public key.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/signing/ecdsa.ts#L33)

```ts
export interface EoaSignature {
    groupPublicKey: Uint8Array;
    r: Uint8Array;
    s: Uint8Array;
    yParity: 0 | 1;
}
```

Fields:

- **` groupPublicKey `**: 33-byte compressed secp256k1 group public key (the EOA's pubkey).
- **` r `**: 32-byte big-endian r.
- **` s `**: 32-byte big-endian s (low-s normalized per EIP-2).
- **` yParity `**: Raw recovery id, 0 or 1. Use ethSignatureV() to get the EVM `v`.

### EoaSignOpts

Keeper endpoint, JWT, slot and 32-byte digest for threshold ECDSA signing.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/signing/ecdsa.ts#L19)

```ts
export interface EoaSignOpts {
    nodeUrl: string;
    jwt: string;
    slotId: string;
    digest: Uint8Array;
    targetKeykeeper?: string;
}
```

Fields:

- **` nodeUrl `**: Keeper HTTP base URL.
- **` jwt `**: Compact bearer JWT authorizing the request.
- **` slotId `**: 0x-prefixed (or bare) bytes32 slot id (must be a tecdsa-mode slot).
- **` digest `**: The 32-byte prehash to sign (e.g. the EIP-1559 signing hash).
- **` targetKeykeeper `**: 20-byte operator address to pin (anti-Sybil).

### Faucet

Funding adapter that requests native gas and TSRA for an account.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/slots/faucet.ts#L21)

```ts
export interface Faucet {
    fund(address: string): Promise<FaucetGrant>;
}
```

Fields:

- **` fund `**: Top up `address` with gas + TSRA.

### FaucetGrant

Account funding result with optional amounts and transaction hashes reported by the faucet.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/slots/faucet.ts#L9)

```ts
export interface FaucetGrant {
    address: string;
    ethWei?: string;
    tsra?: string;
    txHashes?: string[];
}
```

Fields:

- **` address `**: Account that received or was requested to receive funding.
- **` ethWei `**: Native gas funded, wei (decimal string).
- **` tsra `**: TSRA funded, base units (decimal string).
- **` txHashes `**: Funding tx hashes, if the faucet reports them.

### FrostCommitment

One node's Round-1 commitment (from POST /v1/shards/sign/commit).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/frost.ts#L95)

```ts
export interface FrostCommitment {
    identifier: number;
    hiding: Uint8Array;
    binding: Uint8Array;
}
```

Fields:

- **` identifier `**: 1-indexed FROST participant id (u16).
- **` hiding `**: 32-byte compressed Edwards hiding nonce commitment D_i.
- **` binding `**: 32-byte compressed Edwards binding nonce commitment E_i.

### FrostShare

One node's Round-2 signature share (from POST /v1/shards/sign/partial).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/frost.ts#L105)

```ts
export interface FrostShare {
    identifier: number;
    z: Uint8Array;
    verifyingShare: Uint8Array;
}
```

Fields:

- **` identifier `**: Nonzero threshold participant identifier.
- **` z `**: 32-byte little-endian scalar z_i.
- **` verifyingShare `**: 32-byte compressed Edwards verifying share Y_i = g^{s_i}.

### FrostSignature

A FROST-Ed25519 group signature: R (32B compressed) + z (32B LE scalar).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/frost.ts#L115)

```ts
export interface FrostSignature {
    r: Uint8Array;
    z: Uint8Array;
}
```

Fields:

- **` r `**: 32-byte compressed Edwards group commitment.
- **` z `**: 32-byte little-endian aggregate signature scalar.

### FrostSignResult

FROST group signature with slot, key epoch, message digest and optional keeper receipt.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/signing/frost.ts#L76)

```ts
export interface FrostSignResult {
    receipt?: OperationReceipt;
    keySlotId: string;
    groupPublicKey: Uint8Array;
    signature: FrostSignature;
    messageSha256: Uint8Array;
    epoch: number;
}
```

Fields:

- **` receipt `**: Optional keeper evidence; verify separately with verifyOperationReceipt.
- **` keySlotId `**: Identifier of the slot that produced the result.
- **` groupPublicKey `**: 32-byte compressed Edwards group public key.
- **` signature `**: The group signature (R, z). Verify with verifyFrostSignature().
- **` messageSha256 `**: SHA-256 of the signed message, as returned by the node.
- **` epoch `**: Slot key epoch reported with the signature.

### GroupEnvelope

Serialized group ciphertext context: slot, associated data and optional key epoch.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/envelope.ts#L36)

```ts
export interface GroupEnvelope {
    slotId: Uint8Array;
    identity: Uint8Array;
    ciphertext: Ciphertext;
    epoch: bigint | null;
}
```

Fields:

- **` slotId `**: On-chain key-slot identifier (bytes32).
- **` identity `**: AEAD additional authenticated data - must match at decrypt time.
- **` ciphertext `**: KEM ciphertext (U, nonce, AEAD output).
- **` epoch `**: Slot epoch this envelope was produced under. Present in v0x02 only.

### HeldCredential

One credential the recipient holds, described as a structured credential view.
Build these from your own store of verifiable credentials / verifier JWTs.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/recipient/store.ts#L10)

```ts
export interface HeldCredential {
    format: string;
    types: readonly string[];
    body: unknown;
}
```

Fields:

- **` format `**: The credential's format identifier (e.g. `"jwt_vc_json"`).
- **` types `**: The credential's type list (for `jwt_vc_json`, its `type` array).
- **` body `**: The parsed credential body (JSON object with claims).

### HolderNonce

Single-use verifier challenge, expiry and optional disclosed slot policy.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/holderProof.ts#L48)

```ts
export interface HolderNonce {
    nonce: string;
    expiresAt: number;
    dcqlRule?: string;
    dcqlSalt?: string;
    ruleVersion?: number;
}
```

Fields:

- **` nonce `**: Single-use verifier challenge.
- **` expiresAt `**: Expiry, Unix seconds.
- **` dcqlRule `**: The slot's DCQL rule (present only for public-disclosure slots).
- **` dcqlSalt `**: The salt used in the rule's on-chain commitment (present with dcqlRule).
- **` ruleVersion `**: Rule version counter (present with dcqlRule).

### HolderProofAuth

Holder proof-of-possession options (F1/F4). The SDK fetches a `/v1/nonce` and
signs a holder proof with `signer` (the holder DID's authentication key), bound
to `audience` (the verifier's token `iss`) and the presented credentials.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/client/client.ts#L37)

```ts
export interface HolderProofAuth {
    signer: HolderSigner;
    audience: string;
    slotId?: string;
    action?: string;
    ttlSecs?: number;
}
```

Fields:

- **` signer `**: Holder DID authentication key or signing callback.
- **` audience `**: The verifier's expected audience (its token `iss`).
- **` slotId `**: Optionally scope the proof to a slot / action (must match the slot being opened).
- **` action `**: Optional action bound into the nonce and holder proof.
- **` ttlSecs `**: Holder-proof lifetime in seconds.

### HolderSigner

A signer for the holder DID's `authentication` key. Either the SDK holds the raw
Ed25519 secret, or the caller supplies a `sign` callback (HSM / wallet / WebCrypto)
that returns the raw JWS signature bytes for the given signing input.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/holderProof.ts#L98)

```ts
export type HolderSigner = {
    alg: 'EdDSA';
    did: string;
    secretKey: Uint8Array;
    kid?: string;
} | {
    alg: 'EdDSA' | 'ES256';
    did: string;
    sign: (signingInput: Uint8Array) => Uint8Array | Promise<Uint8Array>;
    kid?: string;
};
```

Fields:

- **` alg `**: JWS algorithm used by the holder authentication key.
- **` did `**: Holder DID identifying the authentication key.
- **` kid `**: Optional JOSE key identifier included in the proof header.

### IbeBlobHeader

The clear header stored beside the ciphertext body. Nothing in it is secret.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe-blob.ts#L36)

```ts
export interface IbeBlobHeader {
    v: 1;
    blobId: string;
    identity: string;
    contentType: string;
    size: number;
    chunkSize: number;
    chunkCount: number;
    wrappedKey: {
        u: string;
        nonce: string;
        aead_ct: string;
    };
}
```

Fields:

- **` v `**: Encrypted blob format version.
- **` blobId `**: 16 random bytes, base64 - the object's identity for the chunk binding.
- **` identity `**: The IBE identity the data key is wrapped to.
- **` contentType `**: Media type of the original plaintext object.
- **` size `**: Plaintext size in bytes.
- **` chunkSize `**: Maximum plaintext bytes in each chunk.
- **` chunkCount `**: Number of encrypted chunks in the body.
- **` wrappedKey `**: `ibeEncrypt(mpk, identity, dek)` - the wire shape of `bls::ibe::Ciphertext`.

### IbeCiphertext

Encrypted message - wire shape of `bls::ibe::Ciphertext`.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe.ts#L46)

```ts
export interface IbeCiphertext {
    u: Uint8Array;
    nonce: Uint8Array;
    aeadCt: Uint8Array;
}
```

Fields:

- **` u `**: 96-byte compressed G2 ephemeral public key U = r*G2.
- **` nonce `**: 12-byte ChaCha20-Poly1305 nonce, derived deterministically from U.
- **` aeadCt `**: AEAD output (plaintext.len + 16-byte tag).

### IbeDecryptionShare

One node's partial `D_i = sk_i * Q_ID` (48-byte compressed G1).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe.ts#L56)

```ts
export interface IbeDecryptionShare {
    identifier: number;
    value: Uint8Array;
}
```

Fields:

- **` identifier `**: 1-indexed BLS group identifier (the extract reply's `identifier`).
- **` value `**: 48-byte compressed G1.

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

### IbeVerifyingShares

A node's dual-group verifying share - only the 96-byte G2 half is needed here.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe.ts#L64)

```ts
export type IbeVerifyingShares = ReadonlyMap<number, Uint8Array>;
```

### IssuedToken

Verifier-issued bearer JWT with its holder identifier and expiry in Unix seconds.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L12)

```ts
export interface IssuedToken {
    token: string;
    exp: number;
    holder: string;
}
```

Fields:

- **` token `**: The signed JWT (EdDSA) to present to keykeeper-nodes as a Bearer token.
- **` exp `**: Expiry, Unix seconds.
- **` holder `**: Subject / holder the token was minted for.

### JwtClaims

Decoded JWT claims for local inspection. Their presence does not establish signature validity.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L248)

```ts
export interface JwtClaims {
    sub?: string;
    iss?: string;
    aud?: string;
    exp?: number;
    iat?: number;
    scope?: string | string[];
    [k: string]: unknown;
}
```

Fields:

- **` sub `**: Unverified subject claim.
- **` iss `**: Unverified issuer claim.
- **` aud `**: Unverified audience claim.
- **` exp `**: Unverified expiration time in Unix seconds.
- **` iat `**: Unverified issue time in Unix seconds.
- **` scope `**: Unverified scope claim.

### OpenSessionOpts

Associated data and token refresh skew for a managed slot session.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/client/client.ts#L104)

```ts
export interface OpenSessionOpts {
    identity?: Uint8Array;
    skewMs?: number;
}
```

Fields:

- **` identity `**: AAD for envelopes this session encrypts. Default = the 32-byte slot id.
- **` skewMs `**: JWT refresh skew (ms) for isJwtExpiringSoon. Default 30_000.

### PresentationDelegation

EIP-712 delegation from the slot creator to a delegate address.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L38)

```ts
export interface PresentationDelegation {
    chain_id: number;
    slot_ids: string[];
    delegate: string;
    actions: string[];
    exp: number;
    nonce: number;
    signature: string;
}
```

Fields:

- **` chain_id `**: EVM chain identifier.
- **` slot_ids `**: Slot identifiers covered by this delegation.
- **` delegate `**: 0x-hex 20-byte delegate address
- **` actions `**: Operation names the delegate may authorize.
- **` exp `**: Expiration time in Unix seconds.
- **` nonce `**: Delegation nonce included in the signed payload.
- **` signature `**: 0x-hex 65-byte EIP-712 signature

### PresentationOperation

Operation details signed by a slot creator or delegate for credential authorization.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L22)

```ts
export interface PresentationOperation {
    chain_id: number;
    slot_id: string;
    action: string;
    payload_digest: string;
    description: string;
    exp: number;
}
```

Fields:

- **` chain_id `**: EVM chain identifier.
- **` slot_id `**: 0x-hex 32-byte slot identifier
- **` action `**: "sign" | "decrypt" | "ibe-extract" | "dual-approve"
- **` payload_digest `**: 0x-hex 32-byte digest (sha256 of the message for sign/ibe-extract)
- **` description `**: Human-readable description shown in transaction_data
- **` exp `**: Unix timestamp - when the authorization expires

### RedemptionGrant

Single-use credential redemption token and its expiry in Unix seconds.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L128)

```ts
export interface RedemptionGrant {
    redemptionToken: string;
    expiresAt: number;
}
```

Fields:

- **` redemptionToken `**: Single-use token to exchange for a JWT via redeemCredential().
- **` expiresAt `**: Expiry of the redemption token, Unix seconds.

### RenewalGrant

Long-lived renewal token, authenticated holder, expiry and authorized scopes.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L36)

```ts
export interface RenewalGrant {
    renewalToken: string;
    holder: string;
    expiresAt: number;
    scopes: string[];
}
```

Fields:

- **` renewalToken `**: Long-lived token to exchange for fresh JWTs via redeemRenewalToken().
- **` holder `**: Authenticated holder identifier.
- **` expiresAt `**: Expiry, Unix seconds.
- **` scopes `**: Scopes authorized by the renewal grant.

### ScopeNamespace

Identity-scope authority. The issuer mode restricts grants to the verified issuer DID namespace. The any mode permits other namespaces and requires an explicit issuer allowlist.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L105)

```ts
export type ScopeNamespace = 'issuer' | 'any';
```

### SealedBlob

Encrypted blob header and ordered authenticated ciphertext chunks.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe-blob.ts#L56)

```ts
export interface SealedBlob {
    header: IbeBlobHeader;
    body: Uint8Array;
}
```

Fields:

- **` header `**: Metadata and wrapped data key required to open the blob.
- **` body `**: The concatenated encrypted chunks.

### Session

A live, managed access session for one key slot.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/client/session.ts#L35)

```ts
export interface Session {
    readonly slotId: string;
    readonly holder: string;
    readonly mpkBytes: Uint8Array;
    readonly epoch: number;
    readonly jwt: string;
    encrypt(plaintext: Uint8Array, opts?: {
        identity?: Uint8Array;
        epoch?: bigint | null;
    }): Uint8Array;
    decrypt(envelope: Uint8Array | GroupEnvelope): Promise<Uint8Array>;
    sign(message: Uint8Array, opts?: SignOpts): Promise<FrostSignResult>;
    signDigest(digest: Uint8Array, opts?: {
        targetKeykeeper?: string;
    }): Promise<EoaSignature>;
    ensureFresh(): Promise<void>;
    close(): Promise<void>;
}
```

Fields:

- **` slotId `**: 0x-prefixed bytes32 slot id.
- **` holder `**: Subject the JWT was minted for.
- **` mpkBytes `**: 96-byte compressed G2 group public key of the currently-assembled epoch.
- **` epoch `**: Epoch of the currently-assembled master key.
- **` jwt `**: The current JWT. Access after close throws.
- **` encrypt `**: Encrypt to this slot's group key. Local + synchronous (needs no JWT).
- **` decrypt `**: Decrypt with the assembled master key. Refreshes the JWT first and, on an epoch mismatch (the slot rotated), re-assembles and retries once.
- **` sign `**: FROST-Ed25519 custody signature over `message`.
- **` signDigest `**: Threshold-ECDSA signature over a 32-byte digest (EVM EOA slots).
- **` ensureFresh `**: Renew the JWT if it is near expiry and re-assemble on rotation.
- **` close `**: End this session, clear held key material and prevent further operations. Safe to call again.

### SessionAuth

Choose exactly one JWT authorization mode. Renewal tokens support automatic refresh; other modes require a new session after expiry.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/client/client.ts#L61)

```ts
export type SessionAuth = {
    jwt: string;
    renewalToken?: undefined;
    redemptionToken?: undefined;
    vpJwt?: undefined;
} | {
    renewalToken: string;
    jwt?: undefined;
    redemptionToken?: undefined;
    vpJwt?: undefined;
} | {
    redemptionToken: string;
    jwt?: undefined;
    renewalToken?: undefined;
    vpJwt?: undefined;
} | {
    vpJwt: VpJwtAuth;
    jwt?: undefined;
    renewalToken?: undefined;
    redemptionToken?: undefined;
};
```

Fields:

- **` jwt `**: Caller-supplied bearer JWT; omit when another authorization mode is selected.
- **` renewalToken `**: Renewal token for obtaining and refreshing bearer JWTs; omit when another mode is selected.
- **` redemptionToken `**: Single-use token exchanged for a bearer JWT; omit when another mode is selected.
- **` vpJwt `**: Credential presentation and holder proof for obtaining a bearer JWT; omit when another mode is selected.

### SessionStatusResult

Authorization session progress and optional committee result or failure detail.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L97)

```ts
export interface SessionStatusResult {
    status: 'pending' | 'done' | 'failed';
    phase: SessionPhase;
    compoundToken?: Record<string, unknown>;
    verifierProofs?: unknown;
    bindingPreimage?: Record<string, unknown>;
    error?: string;
}
```

Fields:

- **` status `**: Pending, completed or failed authorization state.
- **` phase `**: Displayable progress within the authorization lifecycle.
- **` compoundToken `**: Committee token returned after successful authorization.
- **` verifierProofs `**: Verifier membership proofs for the selected snapshot.
- **` bindingPreimage `**: Operation context used to derive the request-binding hash.
- **` error `**: Optional failure detail reported by the verifier agent.

### ShardDecryptOpts

Keeper endpoints, JWT and ciphertext for combining partial decryptions in the caller.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/decryption/client.ts#L100)

```ts
export interface ShardDecryptOpts {
    nodeUrls: string[];
    jwt: string;
    slotId: string;
    ciphertext: Ciphertext;
    identity: Uint8Array;
    ciphertextEpoch?: number;
    verifyShares?: boolean;
}
```

Fields:

- **` nodeUrls `**: Base URLs of at least k nodes to fetch partial decryptions from.
- **` jwt `**: Compact bearer JWT authorizing the request.
- **` slotId `**: 32-byte slot identifier.
- **` ciphertext `**: Ciphertext to decrypt.
- **` identity `**: Original encryption associated data.
- **` ciphertextEpoch `**: Expected key epoch of the ciphertext; used to detect rotation.
- **` verifyShares `**: Pairing-verify each share before combining (identifiable abort). Default false.

### ShardSignOpts

JWT-authorized FROST signing coordinated by the caller across selected keepers.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/signing/frost.ts#L175)

```ts
export interface ShardSignOpts {
    nodeUrls: string[];
    jwt: string;
    slotId: string;
    message: Uint8Array;
    groupPublicKey?: Uint8Array;
    verify?: boolean;
}
```

Fields:

- **` nodeUrls `**: Base URLs of exactly the k chosen committee nodes.
- **` jwt `**: Compact bearer JWT authorizing the request.
- **` slotId `**: 32-byte slot identifier.
- **` message `**: Raw message bytes to sign.
- **` groupPublicKey `**: The slot's 32-byte group public key. Fetched from nodeUrls[0] if omitted.
- **` verify `**: Verify the aggregate locally before returning (default true).

### SignCustodyOpts

JWT-authorized FROST signing coordinated by one keeper, with optional owner approval.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/signing/frost.ts#L54)

```ts
export interface SignCustodyOpts {
    nodeUrl: string;
    jwt: string;
    slotId: string;
    message: Uint8Array;
    signingSet?: number[];
    userSignature?: Uint8Array;
    targetKeykeeper?: string;
    requestId?: string;
}
```

Fields:

- **` nodeUrl `**: Keeper HTTP base URL.
- **` jwt `**: Compact bearer JWT authorizing the request.
- **` slotId `**: 0x-prefixed (or bare) bytes32 slot id.
- **` message `**: Raw message bytes to sign.
- **` signingSet `**: Explicit signer set (u16 ids). Omit to node uses 1..k. Passing MORE than k ids makes the node use the robust ROAST coordinator.
- **` userSignature `**: 64-byte Ed25519 user signature - required iff the slot has a registered owner pubkey. Build with signUserRequest().
- **` targetKeykeeper `**: 20-byte operator address to pin (anti-Sybil).
- **` requestId `**: Idempotency key. Required when userSignature is set.

### SignOpts

Per-call overrides for a FROST custody signature.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/client/session.ts#L23)

```ts
export interface SignOpts {
    signingSet?: number[];
    userSignature?: Uint8Array;
    targetKeykeeper?: string;
    requestId?: string;
}
```

Fields:

- **` signingSet `**: Explicit signer set (u16 ids); omit to node uses 1..k.
- **` userSignature `**: 64-byte Ed25519 user signature - required iff the slot has an owner key.
- **` targetKeykeeper `**: 20-byte operator address to pin (anti-Sybil).
- **` requestId `**: Idempotency key (required when userSignature is set).

### TasraClient

A configured client. Holds no key material itself - each [Session](#session) it
opens owns its own JWT and (lazily) assembled master key.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/client/client.ts#L115)

```ts
export interface TasraClient {
    readonly config: Readonly<TasraClientConfig>;
    openSession(slotId: string, auth: SessionAuth, opts?: OpenSessionOpts): Promise<Session>;
    sessions(): readonly Session[];
    closeAll(): Promise<void>;
}
```

Fields:

- **` config `**: Read-only snapshot of connection settings supplied when the client was created.
- **` openSession `**: Obtain a JWT (per `auth`), assemble the slot key, and return a managed Session.
- **` sessions `**: Currently-open sessions (live references).
- **` closeAll `**: Zeroize + close every open session.

### TasraClientConfig

Connection parameters for [createTasraClient](#createtasraclient). Set once and reused by
every session the client opens.

`verifier` and `identity` are optional in the type because `{jwt}` auth needs
neither, but each is enforced at `openSession` time for the modes that do.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/client/client.ts#L23)

```ts
export interface TasraClientConfig {
    nodes: readonly string[];
    verifier?: string;
    identity?: string;
}
```

Fields:

- **` nodes `**: k-of-n keykeeper-node base URLs.
- **` verifier `**: Verifier base URL - required for renewalToken / redemptionToken / vpJwt auth.
- **` identity `**: This holder's DID - recipient_did / holder for credential & vp-jwt auth.

### VerifierAgentSessionErrorKind

Why a session did not yield a token - the class the UI explains, with a NON-SECRET
correlation reference (the session id; the poll secret is never part of an error).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L114)

```ts
export type VerifierAgentSessionErrorKind = 'timeout' | 'refused' | 'unavailable' | 'protocol' | 'cancelled';
```

### VpJwtAuth

The `vpJwt` auth mode's payload: signed VCs + a holder-key proof to JWT.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/client/client.ts#L51)

```ts
export interface VpJwtAuth {
    dcqlRule: string;
    credentials: string[];
    holderProof: HolderProofAuth;
}
```

Fields:

- **` dcqlRule `**: DCQL policy JSON to evaluate.
- **` credentials `**: Compact signed credentials presented to the verifier.
- **` holderProof `**: Holder-key possession proof settings.

## Constants and ABI values

Shared values and contract definitions.

| Export | Description | Definition |
|---|---|---|
| `DCQL_MAX_RULE_LEN` | Cap on a rule, in BYTES, before parsing.   Deliberately the same 4096 as the legacy grammar for now, and it is not yet a justified number: 4096 was chosen against a terse five-clause language and an OID4VP-DCQL query expressing the same policy is several times larger. The keeper re-parses the rule on every request, so this bounds real per-request work. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L66) |
| `FORMAT_JWT_VC_JSON` | W3C JWT-VC JSON credential format. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L27) |
| `IBE_BLOB_DEFAULT_CHUNK` | Default chunk: 1 MiB of plaintext (+16-byte tag on the wire). | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe-blob.ts#L32) |
| `MAX_IDENTITY_LEN` | Max BYTE length of a scope grant or an identity (the reference implementation's cap). Anything longer fails closed - a grant or identity this large is a bug or an attack, not a real subject path. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/identityScope.ts#L31) |
| `MAX_PLAINTEXT_LEN` | Largest plaintext one envelope carries: the AEAD ciphertext cap minus the 16-byte tag. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/envelope.ts#L310) |
