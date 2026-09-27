# tasra-sdk

Generated from public TypeScript exports.

[Reference index](README.md) · [Task guides](../README.md) · [Errors](../errors.md)

<details>
<summary>Find an export</summary>

- [accessTokenHash](#accesstokenhash)
- [addressFromEoaPubkey](#addressfromeoapubkey)
- [aggregateFrostSignature](#aggregatefrostsignature)
- [auth0DpopSigner](#auth0dpopsigner)
- [AuthDeniedError](#authdeniederror)
- [BlsPeer](#blspeer)
- [buildHolderProof](#buildholderproof)
- [BuildHolderProofOpts](#buildholderproofopts)
- [buildTasraText](#buildtasratext)
- [canAccess](#canaccess)
- [canonicalizeDcql](#canonicalizedcql)
- [Ciphertext](#ciphertext)
- [ClaimResult](#claimresult)
- [combineDecryptShares](#combinedecryptshares)
- [CommitteeAuthorizeError](#committeeauthorizeerror)
- [createDpopKey](#createdpopkey)
- [createHolderProof](#createholderproof)
- [createOauthSession](#createoauthsession)
- [CreateOauthSessionResult](#createoauthsessionresult)
- [createOid4vpSession](#createoid4vpsession)
- [createRenewal](#createrenewal)
- [CreateSessionParams](#createsessionparams)
- [CreateSessionResult](#createsessionresult)
- [createTasraClient](#createtasraclient)
- [credentialsCommitment](#credentialscommitment)
- [CredentialView](#credentialview)
- [DcqlClaimQuery](#dcqlclaimquery)
- [DcqlCredentialQuery](#dcqlcredentialquery)
- [DcqlCredentialSetQuery](#dcqlcredentialsetquery)
- [DcqlMalformedError](#dcqlmalformederror)
- [DcqlMeta](#dcqlmeta)
- [DcqlQuery](#dcqlquery)
- [DcqlSelection](#dcqlselection)
- [decodeJwtClaims](#decodejwtclaims)
- [decryptCustody](#decryptcustody)
- [DecryptCustodyOpts](#decryptcustodyopts)
- [DecryptShare](#decryptshare)
- [decryptWithMasterKey](#decryptwithmasterkey)
- [decryptWithShardDelivery](#decryptwithsharddelivery)
- [DpopKey](#dpopkey)
- [DpopSigner](#dpopsigner)
- [ed25519DidKey](#ed25519didkey)
- [encryptEnvelope](#encryptenvelope)
- [EoaSignature](#eoasignature)
- [EoaSignOpts](#eoasignopts)
- [ethSignatureV](#ethsignaturev)
- [evaluateDcql](#evaluatedcql)
- [evaluateIdentityScoped](#evaluateidentityscoped)
- [Faucet](#faucet)
- [FaucetGrant](#faucetgrant)
- [fetchAndAssembleKey](#fetchandassemblekey)
- [fetchHolderNonce](#fetchholdernonce)
- [fetchMpk](#fetchmpk)
- [fromBytes](#frombytes)
- [FrostCommitment](#frostcommitment)
- [FrostShare](#frostshare)
- [FrostSignature](#frostsignature)
- [FrostSignResult](#frostsignresult)
- [GroupEnvelope](#groupenvelope)
- [HeldCredential](#heldcredential)
- [hexToBytes](#hextobytes)
- [HolderNonce](#holdernonce)
- [HolderProofAuth](#holderproofauth)
- [HolderSigner](#holdersigner)
- [httpFaucet](#httpfaucet)
- [ibeBlobChunkRange](#ibeblobchunkrange)
- [ibeBlobDecryptKey](#ibeblobdecryptkey)
- [ibeBlobDigest](#ibeblobdigest)
- [IbeBlobHeader](#ibeblobheader)
- [ibeBlobWrappedKey](#ibeblobwrappedkey)
- [IbeCiphertext](#ibeciphertext)
- [ibeCombineDecrypt](#ibecombinedecrypt)
- [ibeCombineExtract](#ibecombineextract)
- [ibeDecryptBlobChunk](#ibedecryptblobchunk)
- [IbeDecryptionShare](#ibedecryptionshare)
- [ibeDecryptRequest](#ibedecryptrequest)
- [ibeDecryptWithKey](#ibedecryptwithkey)
- [ibeEncrypt](#ibeencrypt)
- [IbeExtractionPartial](#ibeextractionpartial)
- [IbeExtractOpts](#ibeextractopts)
- [ibeExtractRequest](#ibeextractrequest)
- [IbeExtractRequestOpts](#ibeextractrequestopts)
- [ibeOpenBlob](#ibeopenblob)
- [ibeSealBlob](#ibesealblob)
- [ibeUnwrapBlobKey](#ibeunwrapblobkey)
- [IbeVerifyingShares](#ibeverifyingshares)
- [ibeVerifyShare](#ibeverifyshare)
- [isAuthDenied](#isauthdenied)
- [isHeaderSafeNonce](#isheadersafenonce)
- [isJwtExpiringSoon](#isjwtexpiringsoon)
- [isOid4vpRule](#isoid4vprule)
- [isRetryable](#isretryable)
- [issueAdminCredential](#issueadmincredential)
- [IssuedToken](#issuedtoken)
- [isTasraPost](#istasrapost)
- [jsonCredential](#jsoncredential)
- [jwkThumbprint](#jwkthumbprint)
- [JwtClaims](#jwtclaims)
- [jwtExpMs](#jwtexpms)
- [NodeUnreachableError](#nodeunreachableerror)
- [OpenSessionOpts](#opensessionopts)
- [parseTasraPost](#parsetasrapost)
- [payloadDigest](#payloaddigest)
- [pollOid4vpSession](#polloid4vpsession)
- [PresentationDelegation](#presentationdelegation)
- [PresentationOperation](#presentationoperation)
- [RecipientStore](#recipientstore)
- [redeemCredential](#redeemcredential)
- [redeemRenewalToken](#redeemrenewaltoken)
- [RedemptionGrant](#redemptiongrant)
- [RenewalGrant](#renewalgrant)
- [requestIbeExtractionPartials](#requestibeextractionpartials)
- [revokeRenewal](#revokerenewal)
- [revokeSlotUser](#revokeslotuser)
- [scopeCovers](#scopecovers)
- [ScopeNamespace](#scopenamespace)
- [SealedBlob](#sealedblob)
- [selectDcql](#selectdcql)
- [Session](#session)
- [SessionAuth](#sessionauth)
- [SessionStatusResult](#sessionstatusresult)
- [ShardDecryptOpts](#sharddecryptopts)
- [ShardSignOpts](#shardsignopts)
- [signCustody](#signcustody)
- [SignCustodyOpts](#signcustodyopts)
- [signEoaDigest](#signeoadigest)
- [SignOpts](#signopts)
- [signUserRequest](#signuserrequest)
- [signWithShardDelivery](#signwithsharddelivery)
- [SlotRotatedError](#slotrotatederror)
- [submitOauthResponse](#submitoauthresponse)
- [TasraClient](#tasraclient)
- [TasraClientConfig](#tasraclientconfig)
- [TasraError](#tasraerror)
- [TasraHttpError](#tasrahttperror)
- [ThresholdNotMetError](#thresholdnotmeterror)
- [toBytes](#tobytes)
- [userSignaturePayload](#usersignaturepayload)
- [validateDcql](#validatedcql)
- [validateRecipientRule](#validaterecipientrule)
- [VerifierAgentSessionError](#verifieragentsessionerror)
- [VerifierAgentSessionErrorKind](#verifieragentsessionerrorkind)
- [verifyDecryptShare](#verifydecryptshare)
- [verifyFrostSignature](#verifyfrostsignature)
- [verifyPresentation](#verifypresentation)
- [verifyVpJwt](#verifyvpjwt)
- [VpJwtAuth](#vpjwtauth)
- [waitForSession](#waitforsession)
- [Constants and ABI values](#constants-and-abi-values)

</details>

## accessTokenHash

RFC 9449 §4.2 `ath`: base64url(sha256(ASCII(access_token))).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/dpop.ts#L52)

Import: `import {accessTokenHash} from 'tasra-sdk'`

```ts
declare function accessTokenHash(accessToken: string): Promise<string>
```

| Parameter | Type | Description |
|---|---|---|
| `accessToken` | `string` |  |

Returns: `Promise<string>`.

## addressFromEoaPubkey

Derive the EIP-55 checksummed `0x` Ethereum address of a threshold EOA from its
secp256k1 group public key — pass `EoaSignature.groupPublicKey` (33-byte
compressed) or a 65-byte uncompressed key. Pure `@noble` (no ethers/web3): the
key is decompressed, keccak-256'd over X‖Y, and the low 20 bytes are checksummed.
This is what an ethers `Signer.getAddress()` returns for a Tasra EOA slot.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/signing/ecdsa.ts#L98)

Import: `import {addressFromEoaPubkey} from 'tasra-sdk'`

```ts
declare function addressFromEoaPubkey(pubkey: Uint8Array): `0x${string}`
```

| Parameter | Type | Description |
|---|---|---|
| `pubkey` | `Uint8Array<ArrayBufferLike>` |  |

Returns: ``0x${string}``.

## aggregateFrostSignature

Combine k Round-1 commitments + k Round-2 shares into the group signature.
`commitments` MUST be in the same order that was sent to every node (the
binding factors depend on the serialized list order). Each share is
identifiable-abort verified; an invalid share throws naming its identifier.

Mirrors the reference signing implementation::aggregate.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/frost.ts#L129)

Import: `import {aggregateFrostSignature} from 'tasra-sdk'`

```ts
declare function aggregateFrostSignature(message: Uint8Array, groupPublicKey: Uint8Array, commitments: FrostCommitment[], shares: FrostShare[]): FrostSignature
```

| Parameter | Type | Description |
|---|---|---|
| `message` | `Uint8Array<ArrayBufferLike>` |  |
| `groupPublicKey` | `Uint8Array<ArrayBufferLike>` |  |
| `commitments` | `FrostCommitment[]` |  |
| `shares` | `FrostShare[]` |  |

Returns: `FrostSignature`.

## auth0DpopSigner

Wrap `auth0-spa-js`'s own proof minter as a {@link DpopSigner}.

The SDK holds the key, so this is the ONLY way an Auth0 app can produce a proof whose
`jkt` matches its token's `cnf.jkt`.

```ts
const signer = auth0DpopSigner((args) => auth0.generateDpopProof(args))
```

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/dpop.ts#L147)

Import: `import {auth0DpopSigner} from 'tasra-sdk'`

```ts
declare function auth0DpopSigner(generate: (args: { url: string; method: string; nonce?: string; accessToken?: string; }) => Promise<string>): DpopSigner
```

| Parameter | Type | Description |
|---|---|---|
| `generate` | `(args: { url: string; method: string; nonce?: string; accessToken?: string; }) => Promise<string>` |  |

Returns: `DpopSigner`.

## AuthDeniedError

The credential was rejected: 401 or 403. Never retryable — the same token will
be refused again. Re-claim (redeem a fresh credential or renewal) instead.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/errors.ts#L71)

```ts
(args: { status: number; url: string; body?: string; message?: string; }): AuthDeniedError
```

Import: `import {AuthDeniedError} from 'tasra-sdk'`

- `status: number`
- `url: string`
- `body: string`
- `retryable: boolean` — `false` when retrying the identical request cannot succeed.
- `name: string`
- `message: string`
- `stack: string &#124; undefined`
- `cause: unknown`

## BlsPeer

A node's BLS identifier + its libp2p PeerId, for the custody decrypting set.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/decryption/client.ts#L42)

```ts
export interface BlsPeer {
  id: number
  peerId: string
}
```

## buildHolderProof

Build a holder-proof compact-JWS (header.payload.signature).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/holderProof.ts#L119)

Import: `import {buildHolderProof} from 'tasra-sdk'`

```ts
declare function buildHolderProof(opts: BuildHolderProofOpts): Promise<string>
```

| Parameter | Type | Description |
|---|---|---|
| `opts` | `BuildHolderProofOpts` |  |

Returns: `Promise<string>`.

## BuildHolderProofOpts

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/holderProof.ts#L100)

```ts
export interface BuildHolderProofOpts {
  signer: HolderSigner
  /** The verifier's expected audience (its token `iss`). */
  audience: string
  /** The challenge from {@link fetchHolderNonce}. */
  nonce: string
  /** The exact compact-JWS credentials being presented, in order. */
  credentials: string[]
  /** Echo the nonce's slot binding (when the nonce was slot-bound). */
  slotId?: string
  /** Echo the nonce's action binding. */
  action?: string
  /** Proof lifetime, seconds (default 300). */
  ttlSecs?: number
  /** Override `iat` (Unix seconds) — for tests. */
  nowSecs?: number
}
```

## buildTasraText

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/detect.ts#L31)

Import: `import {buildTasraText} from 'tasra-sdk'`

```ts
declare function buildTasraText(envelopeBytes: Uint8Array): string
```

| Parameter | Type | Description |
|---|---|---|
| `envelopeBytes` | `Uint8Array<ArrayBufferLike>` |  |

Returns: `string`.

## canAccess

Convenience: can this recipient access a slot with `rule`? Platform-blind.

Accepts a {@link RecipientStore} or a bare {@link HeldCredential} list.
Unlike {@link RecipientStore.satisfies}, a MALFORMED rule returns `false`
(fail-closed) rather than throwing.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/recipient/store.ts#L96)

Import: `import {canAccess} from 'tasra-sdk'`

```ts
declare function canAccess(rule: string, store: RecipientStore | HeldCredential[]): boolean
```

| Parameter | Type | Description |
|---|---|---|
| `rule` | `string` |  |
| `store` | `RecipientStore &#124; HeldCredential[]` |  |

Returns: `boolean`.

## canonicalizeDcql

RFC 8785 (JCS) canonical form: sorted keys, no insignificant whitespace, ECMAScript
number formatting, UTF-8.

⚠ Why the commitment needs this at all: the rule stops being an opaque string the
moment it becomes the `dcql_query` inside a signed OID4VP request object. It must be
parsed and re-serialised, and any JSON library may reorder keys or restyle
whitespace. Hashing raw bytes would break the commitment at exactly the point the
rule is used for its new purpose.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L977)

Import: `import {canonicalizeDcql} from 'tasra-sdk'`

```ts
declare function canonicalizeDcql(rule: string): string
```

| Parameter | Type | Description |
|---|---|---|
| `rule` | `string` |  |

Returns: `string`.

## Ciphertext

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/kem.ts#L127)

```ts
export interface Ciphertext {
  /** 96-byte compressed G2 ephemeral public key U = r·G2. */
  u: Uint8Array
  /** 12-byte ChaCha20-Poly1305 nonce, derived from U. */
  nonce: Uint8Array
  /** AEAD ciphertext: plaintext.len + 16 (Poly1305 tag). */
  aeadCt: Uint8Array
}
```

## ClaimResult

The result of a claim lookup.

⚠ NOT `unknown | undefined`, and that is load-bearing: JSON `null` is a PRESENT
claim whose value is null. Collapsing "absent" and "present-but-null" into
`undefined` would make `{"path":["x"]}` (presence-only) deny a credential the reference implementation
side grants — `Value::Null` is `Some`, not `None`.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L190)

```ts
export type ClaimResult = {found: true; value: unknown} | {found: false}
```

## combineDecryptShares

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/kem.ts#L263)

Import: `import {combineDecryptShares} from 'tasra-sdk'`

```ts
declare function combineDecryptShares(shares: DecryptShare[], ct: Ciphertext, identity: Uint8Array, opts?: { verify?: boolean; }): Uint8Array
```

| Parameter | Type | Description |
|---|---|---|
| `shares` | `DecryptShare[]` |  |
| `ct` | `Ciphertext` |  |
| `identity` | `Uint8Array<ArrayBufferLike>` |  |
| `opts` | `{ verify?: boolean; }` |  |

Returns: `Uint8Array<ArrayBufferLike>`.

## CommitteeAuthorizeError

A verifier refused to co-sign a committee token. Extends
{@link TasraHttpError}, so `.status`, `.url`, `.body`, and `.retryable` are
all available and `isAuthDenied()` recognises a 401/403 here too.

Distinct from a generic HTTP error because the committee flow polls several
verifiers and tolerates individual refusals as long as a quorum co-signs — see
{@link ThresholdNotMetError} for the failure that means the quorum was missed.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/client.ts#L70)

```ts
(status: number, message: string, opts?: { url?: string; body?: string; }): CommitteeAuthorizeError
```

Import: `import {CommitteeAuthorizeError} from 'tasra-sdk'`

- `status: number`
- `url: string`
- `body: string`
- `retryable: boolean` — `false` when retrying the identical request cannot succeed.
- `name: string`
- `message: string`
- `stack: string &#124; undefined`
- `cause: unknown`

## createDpopKey

Mint a fresh ES256 DPoP key.

Non-extractable: the private half never leaves WebCrypto, so it cannot be copied out of a
compromised page along with the token. That is the entire point of sender constraining.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/dpop.ts#L72)

Import: `import {createDpopKey} from 'tasra-sdk'`

```ts
declare function createDpopKey(): Promise<DpopKey>
```

Returns: `Promise<DpopKey>`.

## createHolderProof

Convenience: fetch a nonce and build the holder proof in one step. Returns the
compact-JWS to put in the `holder_proof` field of a `verify-vp-jwt` /
`committee-authorize` request.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/holderProof.ts#L154)

Import: `import {createHolderProof} from 'tasra-sdk'`

```ts
declare function createHolderProof(verifierUrl: string, opts: { signer: HolderSigner; audience: string; credentials: string[]; slotId?: string; action?: string; ttlSecs?: number; }): Promise<string>
```

| Parameter | Type | Description |
|---|---|---|
| `verifierUrl` | `string` |  |
| `opts` | `{ signer: HolderSigner; audience: string; credentials: string[]; slotId?: string; action?: string; ttlSecs?: number; }` |  |

Returns: `Promise<string>`.

## createOauthSession

Open an `oauth` session — same creator authorisation, same committee draw, same
derived nonce, same poll contract as {@link createOid4vpSession}. No QR, no Request
Object, no JWE key: the client presents an access token its own IdP minted.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L233)

Import: `import {createOauthSession} from 'tasra-sdk'`

```ts
declare function createOauthSession(verifierAgentUrl: string, params: CreateSessionParams): Promise<CreateOauthSessionResult>
```

| Parameter | Type | Description |
|---|---|---|
| `verifierAgentUrl` | `string` |  |
| `params` | `CreateSessionParams` |  |

Returns: `Promise<CreateOauthSessionResult>`.

## CreateOauthSessionResult

an `oauth` session — the client brings a DPoP-bound access token.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L67)

```ts
export interface CreateOauthSessionResult {
  sessionId: string
  /** Treat as a secret. Rides `X-Poll-Secret` on the response endpoint, `Authorization:
   *  Bearer` when polling — DPoP owns `Authorization` on the response endpoint. */
  pollSecret: string
  /** The nonce the DPoP proof must carry. Returned so a client that can mint a proof
   *  directly needs no RFC 9449 challenge round trip. */
  nonce: string
  /** The `htu` the DPoP proof must name. Session-INDEPENDENT by RFC 9449 (`htu` excludes
   *  query and fragment), which is why any conformant client library derives the same
   *  string from the URL it is about to call. */
  dpopHtu: string
  /** The `aud` the tenant must have registered with its IdP for tokens minted for this
   *  platform. A token whose `aud` does not contain it is refused by every drawn verifier,
   *  and that is the single most common onboarding mistake — surfaced so a client can say
   *  so instead of showing a bare 400. */
  platformAudience: string
}
```

## createOid4vpSession

Create an OID4VP session on the Verifier Agent.

The verifier-agent derives a nonce, generates an ECDH key for JWE, and returns a QR
payload the wallet scans. The session ID and poll secret are used to poll
for the result.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L196)

Import: `import {createOid4vpSession} from 'tasra-sdk'`

```ts
declare function createOid4vpSession(verifierAgentUrl: string, params: CreateSessionParams): Promise<CreateSessionResult>
```

| Parameter | Type | Description |
|---|---|---|
| `verifierAgentUrl` | `string` |  |
| `params` | `CreateSessionParams` |  |

Returns: `Promise<CreateSessionResult>`.

## createRenewal

Create a long-lived renewal from a presentation. On the prod (signed) path,
pass `credentials` (compact JWS JWT-VCs) — they're signature-verified and
replace the presentation's credentials. `slot_ids` (if given) are rotated via
a webhook when the renewal is revoked.
POST {verifier}/v1/renewals

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L50)

Import: `import {createRenewal} from 'tasra-sdk'`

```ts
declare function createRenewal(verifierUrl: string, body: { dcql_rule: string; presentation: unknown; credentials?: string[]; slot_ids?: string[]; }): Promise<RenewalGrant>
```

| Parameter | Type | Description |
|---|---|---|
| `verifierUrl` | `string` |  |
| `body` | `{ dcql_rule: string; presentation: unknown; credentials?: string[]; slot_ids?: string[]; }` |  |

Returns: `Promise<RenewalGrant>`.

## CreateSessionParams

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L48)

```ts
export interface CreateSessionParams {
  operation: PresentationOperation
  /** 0x-hex 65-byte EIP-712 signature over the operation */
  operationSig: string
  /** Optional EIP-712 delegation from the slot creator */
  delegation?: PresentationDelegation
  /** The raw payload as 0x-hex */
  messageHex: string
}
```

## CreateSessionResult

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L58)

```ts
export interface CreateSessionResult {
  sessionId: string
  /** Bearer token for polling — treat as a secret */
  pollSecret: string
  qrPayload: string
  requestUri: string
}
```

## createTasraClient

The high-level integration surface: configure connection parameters once, then
open a managed {@link Session} per slot.

The session obtains a DCQL-gated JWT, keeps it fresh, and Lagrange-assembles the
slot's master key from the fleet **lazily — on the first `decrypt`** (so
`encrypt`/`sign` never pay a shard fetch, and a sign-only slot never reconstructs
a key at all), re-assembling when the slot rotates. `Session.close()` zeroizes it.

This is the layer most integrations want. Below it sit the composable primitives
(`redeemCredential`, `fetchAndAssembleKey`, `encryptEnvelope`, …) that it
orchestrates — drop to those when you need finer control. To resolve endpoints
from chain instead of hardcoding them, use {@link createTasraSlotClient }.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/client/client.ts#L184)

Import: `import {createTasraClient} from 'tasra-sdk'`

```ts
declare function createTasraClient(config: TasraClientConfig): TasraClient
```

| Parameter | Type | Description |
|---|---|---|
| `config` | `TasraClientConfig` | \`nodes\` is always required. \`verifier\` is required for every auth mode except \`{jwt}\`; \`identity\` is required for \`{redemptionToken}\` and \`{vpJwt}\`. Both are validated when \`openSession\` runs. |

Returns: `TasraClient`.

Return details: a client whose sessions you open per slot

Throws: {Error} if `nodes` is empty

Example from source:

```ts
const kk = createTasraClient({
  nodes: ['https://node-1', 'https://node-2', 'https://node-3'],
  verifier: 'https://verifier',
  identity: 'did:example:alice',
})

const s = await kk.openSession(slotId, {renewalToken})
const env = s.encrypt(new TextEncoder().encode('only slot members can read this'))
const msg = await s.decrypt(env)      // assembles the key on first use
const sig = await s.sign(messageBytes)
await s.close()                       // zeroizes the assembled key
```

## credentialsCommitment

`base64url(sha256(credentials joined by "\n"))`.

MUST byte-for-byte match the verifier's `credentials_commitment`
(the reference holder-proof implementation). Order-sensitive and delimiter-framed so both
sides agree without JSON canonicalization. Binds a holder proof to the exact set of
compact-JWS credentials being presented.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/holderProof.ts#L41)

Import: `import {credentialsCommitment} from 'tasra-sdk'`

```ts
declare function credentialsCommitment(credentials: string[]): string
```

| Parameter | Type | Description |
|---|---|---|
| `credentials` | `string[]` |  |

Returns: `string`.

## CredentialView

One verified credential, as the evaluator needs to see it.

One verified credential, as the evaluator needs to see it. A consumer must expose
the credential's actual shape: its parsed payload, not a flat string set.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L200)

```ts
export interface CredentialView {
  /** The credential's format identifier, e.g. `"jwt_vc_json"`. */
  readonly format: string
  /** The credential's type list (for `jwt_vc_json`, its `type` array). */
  readonly types: readonly string[]
  /**
   * The claim at `path`, or absent when the path does not resolve. A `null` segment selects
   * every element of an array, so the answer may be an array the credential does not
   * literally hold.
   */
  claim(path: readonly ClaimPathSegment[]): ClaimResult
}
```

## DcqlClaimQuery

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L110)

```ts
export interface ClaimQuery {
  /** Path components into the credential: object keys, and `null` for every array element. */
  path: ClaimPathSegment[]
  /** Allowed values. Absent ⇒ the claim need only be PRESENT. */
  values?: unknown[]
}
```

## DcqlCredentialQuery

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L139)

```ts
export interface CredentialQuery {
  /** Unique within the query; referenced by `credential_sets.options`. */
  id: string
  format: string
  meta?: Meta
  claims?: ClaimQuery[]
  /**
   * The claim path holding this credential's identity-scope grant (a scope
   * string or array of scope strings, matched by {@link scopeCovers}). Present ⇒ a
   * satisfied match of this query authorizes an identity-scoped operation ONLY for
   * identities the grant covers. The named path must also appear as a `claims` entry;
   * `kk_scope_namespace` is a required companion.
   */
  kk_identity_scope_claim?: string[]
  /** whose grant power the scope claim carries. Required whenever
   *  `kk_identity_scope_claim` is present; refused without it. */
  kk_scope_namespace?: ScopeNamespace
}
```

## DcqlCredentialSetQuery

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L158)

```ts
export interface CredentialSetQuery {
  /** Each option is a list of credential-query ids that must ALL match. */
  options: string[][]
  /** Default `true`. */
  required?: boolean
  /**
   * Display-only, passed through to the wallet's consent screen.
   *
   * ⚠ Deliberately allowed where every other unsupported field is refused: it cannot
   * affect the decision, and it is what explains the request to the user. It sits
   * inside the committed bytes, so an owner cannot change what the user is told
   * without changing the slot's `ruleCommitment`.
   */
  purpose?: unknown
}
```

## DcqlMalformedError

The rule is not a well-formed OID4VP-DCQL query (or exceeds `MAX_RULE_LEN`).
Never retryable — the same rule fails identically. Extends
{@link TasraError} so one `instanceof` catches every SDK error.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L20)

```ts
(message: string): DcqlMalformedError
```

Import: `import {DcqlMalformedError} from 'tasra-sdk'`

- `retryable: boolean` — `false` when retrying the identical request cannot succeed.
- `name: string`
- `message: string`
- `stack: string &#124; undefined`
- `cause: unknown`

## DcqlMeta

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L78)

```ts
export interface Meta {
  /** `jwt_vc_json`: outer array = alternatives; inner array = types that must ALL be present. */
  type_values?: string[][]
  /** `dc+sd-jwt`: acceptable Verifiable Credential Type (`vct`) values — a flat list of alternatives. */
  vct_values?: string[]
  /**
   * `oauth+*` ONLY (and REQUIRED there): how old the token's authentication may
   * be, in seconds.
   *
   * An OAuth access token carries no status list, so freshness IS the revocation signal: a
   * leaver's session stops minting tokens, and this bounds how long an already-minted one
   * stays usable. `exp` cannot serve — the IdP picks it, and a tenant issuing 24-hour tokens
   * would silently widen every slot's revocation window.
   */
  max_age_secs?: number
}
```

## DcqlQuery

A DCQL query. `credential_sets` absent ⇒ EVERY entry in `credentials` is required.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L175)

```ts
export interface Query {
  credentials: CredentialQuery[]
  credential_sets?: CredentialSetQuery[]
}
```

## DcqlSelection

The result of credential selection against a rule.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L739)

```ts
export interface Selection {
  /** Whether the rule can be satisfied by the given credentials. */
  satisfied: boolean
  /** The minimal set of credentials that satisfy the rule (empty when unsatisfied). */
  credentials: CredentialView[]
  /** Credential query ids that no presented credential satisfies. */
  unsatisfied: string[]
}
```

## decodeJwtClaims

Decode JWT claims WITHOUT verifying the signature (for expiry/UX only).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L234)

Import: `import {decodeJwtClaims} from 'tasra-sdk'`

```ts
declare function decodeJwtClaims(jwt: string): JwtClaims | null
```

| Parameter | Type | Description |
|---|---|---|
| `jwt` | `string` |  |

Returns: `JwtClaims | null`.

## decryptCustody

Decrypt via the custody path: the node runs the whole k-of-n ceremony and
returns the plaintext (one HTTP round-trip).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/decryption/client.ts#L68)

Import: `import {decryptCustody} from 'tasra-sdk'`

```ts
declare function decryptCustody(opts: DecryptCustodyOpts): Promise<Uint8Array>
```

| Parameter | Type | Description |
|---|---|---|
| `opts` | `DecryptCustodyOpts` |  |

Returns: `Promise<Uint8Array<ArrayBufferLike>>`.

## DecryptCustodyOpts

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/decryption/client.ts#L47)

```ts
export interface DecryptCustodyOpts {
  nodeUrl: string
  jwt: string
  slotId: string
  ciphertext: Ciphertext
  /** AEAD additional-authenticated-data (the identity the envelope was bound to). */
  identity: Uint8Array
  /** BLS identifiers (k..n, distinct) to run the ceremony with. */
  decryptingSet: number[]
  /** The libp2p peers for those identifiers. */
  blsPeers: BlsPeer[]
  /** 64-byte Ed25519 user signature, required iff the slot has an owner pubkey. */
  userSignature?: Uint8Array
  /** Pin the ciphertext epoch; a rotated slot returns 410. */
  ciphertextEpoch?: number
  targetKeykeeper?: string
  requestId?: string
}
```

## DecryptShare

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/kem.ts#L232)

```ts
export interface DecryptShare {
  /** 1-indexed BLS participant identifier (u16). */
  id: number
  /** 96-byte compressed G2 partial decryption D_i = sk_i·U. */
  decryptionShare: Uint8Array
  /** 144-byte verifying share: 96B compressed G2 (sk_i·g2) ‖ 48B compressed G1
   *  (sk_i·g1). Required only for verifyDecryptShare. */
  verifyingShare?: Uint8Array
}
```

## decryptWithMasterKey

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/kem.ts#L206)

Import: `import {decryptWithMasterKey} from 'tasra-sdk'`

```ts
declare function decryptWithMasterKey(mskBytes: Uint8Array, ct: Ciphertext, identity: Uint8Array): Uint8Array
```

| Parameter | Type | Description |
|---|---|---|
| `mskBytes` | `Uint8Array<ArrayBufferLike>` |  |
| `ct` | `Ciphertext` |  |
| `identity` | `Uint8Array<ArrayBufferLike>` |  |

Returns: `Uint8Array<ArrayBufferLike>`.

## decryptWithShardDelivery

Decrypt via the shard-delivery path: fetch a partial decryption from each
node and combine the shares locally (the master key is never assembled).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/decryption/client.ts#L126)

Import: `import {decryptWithShardDelivery} from 'tasra-sdk'`

```ts
declare function decryptWithShardDelivery(opts: ShardDecryptOpts): Promise<Uint8Array>
```

| Parameter | Type | Description |
|---|---|---|
| `opts` | `ShardDecryptOpts` |  |

Returns: `Promise<Uint8Array<ArrayBufferLike>>`.

## DpopKey

An ES256 key pair for DPoP, plus a {@link DpopSigner} over it.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/dpop.ts#L58)

```ts
export interface DpopKey {
  /** The public half, as the JWK that rides in every proof header. */
  publicJwk: JsonWebKey
  /** RFC 7638 thumbprint — the value the IdP puts in the token's `cnf.jkt`. */
  thumbprint(): Promise<string>
  signer: DpopSigner
}
```

## DpopSigner

Anything that can produce a DPoP proof for a given request.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/dpop.ts#L28)

```ts
export interface DpopSigner {
  /**
   * Mint a proof binding `accessToken` to `(htm, htu, nonce)`.
   *
   * An implementation MUST sign with the key the access token is bound to; a proof under
   * any other key is refused by every drawn verifier with `DPoP proof jwk is not the key
   * the access token is bound to`.
   */
  proof(args: {htm: string; htu: string; nonce: string; accessToken: string}): Promise<string>
}
```

## ed25519DidKey

A did:key identifier for an Ed25519 public key (multicodec 0xed01, base58btc). Useful
when the holder is identified by a self-certifying did:key.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/holderProof.ts#L179)

Import: `import {ed25519DidKey} from 'tasra-sdk'`

```ts
declare function ed25519DidKey(publicKey: Uint8Array): string
```

| Parameter | Type | Description |
|---|---|---|
| `publicKey` | `Uint8Array<ArrayBufferLike>` |  |

Returns: `string`.

## encryptEnvelope

Encrypt `plaintext` to a slot's group key — ChaCha20-Poly1305 under a BLS12-381
G2 ElGamal KEM. Local and synchronous: it needs only the slot's **public** key,
so no JWT, no node round-trip, and no assembled secret.

The three byte-string parameters are easy to transpose — they are, in order:
*which slot*, *whose key*, *what to bind*.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/envelope.ts#L249)

Import: `import {encryptEnvelope} from 'tasra-sdk'`

```ts
declare function encryptEnvelope(slotId: Uint8Array, mpkBytes: Uint8Array, identity: Uint8Array, plaintext: Uint8Array, epoch?: bigint | null): GroupEnvelope
```

| Parameter | Type | Description |
|---|---|---|
| `slotId` | `Uint8Array<ArrayBufferLike>` | the 32-byte slot id (raw bytes, not hex) |
| `mpkBytes` | `Uint8Array<ArrayBufferLike>` | the slot's 96-byte compressed G2 group public key, as served by \`GET /v1/keys/{slot}/public\` (see \`fetchMpk\`) |
| `identity` | `Uint8Array<ArrayBufferLike>` | additional authenticated data bound into the AEAD. Conventionally the slot id itself; the managed session defaults to exactly that. |
| `plaintext` | `Uint8Array<ArrayBufferLike>` | the bytes to encrypt |
| `epoch` | `bigint &#124; null` | the current slot epoch, producing a v0x02 envelope; \`null\` produces a legacy v0x01 envelope with no epoch binding |

Returns: `GroupEnvelope`.

Return details: the envelope — pass through `toBytes()` then `buildTasraText()` for
the opaque `[KK]<base64>` wire form

Throws: {Error} if `slotId` is not 32 bytes, `identity` exceeds its cap, `plaintext`
exceeds {@link MAX_PLAINTEXT_LEN}, or `epoch` is negative or above 2^63 - 1

Example from source:

```ts
const {mpkBytes, epoch} = await fetchMpk(nodeUrl, slotHex)
const env  = encryptEnvelope(hexToBytes(slotHex), mpkBytes, hexToBytes(slotHex), bytes, BigInt(epoch))
const wire = buildTasraText(toBytes(env))   // hand to ANY transport
```

## EoaSignature

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/signing/ecdsa.ts#L29)

```ts
export interface EoaSignature {
  /** 33-byte compressed secp256k1 group public key (the EOA's pubkey). */
  groupPublicKey: Uint8Array
  /** 32-byte big-endian r. */
  r: Uint8Array
  /** 32-byte big-endian s (low-s normalized per EIP-2). */
  s: Uint8Array
  /** Raw recovery id, 0 or 1. Use ethSignatureV() to get the EVM `v`. */
  yParity: 0 | 1
}
```

## EoaSignOpts

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/signing/ecdsa.ts#L18)

```ts
export interface EoaSignOpts {
  nodeUrl: string
  jwt: string
  /** 0x-prefixed (or bare) bytes32 slot id (must be a tecdsa-mode slot). */
  slotId: string
  /** The 32-byte prehash to sign (e.g. the EIP-1559 signing hash). */
  digest: Uint8Array
  /** 20-byte operator address to pin (anti-Sybil). */
  targetKeykeeper?: string
}
```

## ethSignatureV

Map the raw recovery id (0/1) to an Ethereum `v`: legacy 27/28, or EIP-155
(`35 + 2·chainId + yParity`) when a chainId is given.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/signing/ecdsa.ts#L77)

Import: `import {ethSignatureV} from 'tasra-sdk'`

```ts
declare function ethSignatureV(yParity: number, chainId?: number): number
```

| Parameter | Type | Description |
|---|---|---|
| `yParity` | `number` |  |
| `chainId` | `number &#124; undefined` |  |

Returns: `number`.

## evaluateDcql

Does `credentials` satisfy `rule`?

Returns `true` to grant and `false` to deny; throws {@link DcqlMalformedError} when
the rule itself is broken. ⚠ Takes NO holder identity — DCQL constrains credentials,
and holder identity is established by the presentation's holder binding. That is why
the legacy `required_sub_in` clause has no encoding here.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L698)

Import: `import {evaluateDcql} from 'tasra-sdk'`

```ts
declare function evaluateDcql(rule: string, credentials: readonly CredentialView[]): boolean
```

| Parameter | Type | Description |
|---|---|---|
| `rule` | `string` |  |
| `credentials` | `readonly CredentialView[]` |  |

Returns: `boolean`.

## evaluateIdentityScoped

Does `credentials` authorize an identity-scoped operation on `identity`?

The {@link evaluate} WHO gate PLUS the WHICH gate: a satisfied credential query
carrying `kk_identity_scope_claim` must have a matching credential whose scope grant
(a string or array at that path) covers `identity` ({@link scopeCovers}) and — under
`kk_scope_namespace: "issuer"` — whose verified issuer owns the identity's namespace
(its first `/`-segment must byte-equal the issuer DID, the self-grant-over-others
gate). A rule with no scope binding on any satisfied query denies: an unscoped rule
can never authorize a scoped operation.

⚠ Local evaluation is ADVISORY here as everywhere in this SDK — the verifier
committee runs the authoritative check; a wrong local answer costs a wasted request,
never access.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L836)

Import: `import {evaluateIdentityScoped} from 'tasra-sdk'`

```ts
declare function evaluateIdentityScoped(rule: string, credentials: readonly CredentialView[], identity: string): boolean
```

| Parameter | Type | Description |
|---|---|---|
| `rule` | `string` |  |
| `credentials` | `readonly CredentialView[]` |  |
| `identity` | `string` |  |

Returns: `boolean`.

## Faucet

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/slots/faucet.ts#L18)

```ts
export interface Faucet {
  /** Top up `address` with gas + TSRA. */
  fund(address: string): Promise<FaucetGrant>
}
```

## FaucetGrant

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/slots/faucet.ts#L8)

```ts
export interface FaucetGrant {
  address: string
  /** Native gas funded, wei (decimal string). */
  ethWei?: string
  /** TSRA funded, base units (decimal string). */
  tsra?: string
  /** Funding tx hashes, if the faucet reports them. */
  txHashes?: string[]
}
```

## fetchAndAssembleKey

Fetch BLS shards from the configured nodes and Lagrange-interpolate the slot's
**master secret key** in this process. Requests every URL in `cfg.urls`
concurrently and assembles from whichever k respond.

⚠ This is the one operation that reconstructs whole key material client-side.
No node ever sees the assembled key, but your process now holds it: keep it for
as long as you need decrypts and then wipe it (`msk.fill(0)`) — `Session.close()`
does this for you, which is why the managed {@link createTasraClient }
surface is preferable to calling this directly.
The sign and threshold-decrypt paths never assemble a key at all.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/keys/node-client.ts#L62)

Import: `import {fetchAndAssembleKey} from 'tasra-sdk'`

```ts
declare function fetchAndAssembleKey(cfg: NodeConfig, slotHex: string): Promise<Uint8Array>
```

| Parameter | Type | Description |
|---|---|---|
| `cfg` | `NodeConfig` | node base URLs plus a DCQL-gated JWT authorizing shard release |
| `slotHex` | `string` | the 32-byte slot id, with or without the \`0x\` prefix |

Returns: `Promise<Uint8Array<ArrayBufferLike>>`.

Return details: the assembled master secret key

Throws: {Error} if no node released a shard — the message distinguishes an auth
rejection (401/403: re-claim, do not retry) from transient failures such as a
cold DKG or an unreachable node

## fetchHolderNonce

Mint a single-use challenge nonce, optionally bound to a slot id + action (F4).
POST {verifier}/v1/nonce

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/holderProof.ts#L61)

Import: `import {fetchHolderNonce} from 'tasra-sdk'`

```ts
declare function fetchHolderNonce(verifierUrl: string, opts?: { slotId?: string; action?: string; }): Promise<HolderNonce>
```

| Parameter | Type | Description |
|---|---|---|
| `verifierUrl` | `string` |  |
| `opts` | `{ slotId?: string; action?: string; } &#124; undefined` |  |

Returns: `Promise<HolderNonce>`.

## fetchMpk

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/keys/node-client.ts#L19)

Import: `import {fetchMpk} from 'tasra-sdk'`

```ts
declare function fetchMpk(nodeUrl: string, slotHex: string): Promise<{ mpkBytes: Uint8Array; epoch: number; }>
```

| Parameter | Type | Description |
|---|---|---|
| `nodeUrl` | `string` |  |
| `slotHex` | `string` |  |

Returns: `Promise<{ mpkBytes: Uint8Array; epoch: number; }>`.

## fromBytes

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/envelope.ts#L107)

Import: `import {fromBytes} from 'tasra-sdk'`

```ts
declare function fromBytes(bytes: Uint8Array): GroupEnvelope
```

| Parameter | Type | Description |
|---|---|---|
| `bytes` | `Uint8Array<ArrayBufferLike>` |  |

Returns: `GroupEnvelope`.

## FrostCommitment

One node's Round-1 commitment (from POST /v1/shards/sign/commit).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/frost.ts#L95)

```ts
export interface FrostCommitment {
  /** 1-indexed FROST participant id (u16). */
  identifier: number
  /** 32-byte compressed Edwards hiding nonce commitment D_i. */
  hiding: Uint8Array
  /** 32-byte compressed Edwards binding nonce commitment E_i. */
  binding: Uint8Array
}
```

## FrostShare

One node's Round-2 signature share (from POST /v1/shards/sign/partial).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/frost.ts#L105)

```ts
export interface FrostShare {
  identifier: number
  /** 32-byte little-endian scalar z_i. */
  z: Uint8Array
  /** 32-byte compressed Edwards verifying share Y_i = g^{s_i}. */
  verifyingShare: Uint8Array
}
```

## FrostSignature

A FROST-Ed25519 group signature: R (32B compressed) + z (32B LE scalar).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/frost.ts#L114)

```ts
export interface FrostSignature {
  r: Uint8Array
  z: Uint8Array
}
```

## FrostSignResult

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/signing/frost.ts#L72)

```ts
export interface FrostSignResult {
  /** Optional keeper evidence; verify separately with verifyOperationReceipt. */
  receipt?: OperationReceipt
  keySlotId: string
  /** 32-byte compressed Edwards group public key. */
  groupPublicKey: Uint8Array
  /** The group signature (R, z). Verify with verifyFrostSignature(). */
  signature: FrostSignature
  /** SHA-256 of the signed message, as returned by the node. */
  messageSha256: Uint8Array
  epoch: number
}
```

## GroupEnvelope

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/envelope.ts#L35)

```ts
export interface GroupEnvelope {
  /** On-chain key-slot identifier (bytes32). */
  slotId: Uint8Array
  /** AEAD additional authenticated data — must match at decrypt time. */
  identity: Uint8Array
  /** KEM ciphertext (U, nonce, AEAD output). */
  ciphertext: Ciphertext
  /** Slot epoch this envelope was produced under. Present in v0x02 only. */
  epoch: bigint | null
}
```

## HeldCredential

One credential the recipient holds, described as a structured credential view.
Build these from your own store of verifiable credentials / verifier JWTs.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/recipient/store.ts#L18)

```ts
export interface HeldCredential {
  /** The credential's format identifier (e.g. `"jwt_vc_json"`). */
  format: string
  /** The credential's type list (for `jwt_vc_json`, its `type` array). */
  types: readonly string[]
  /** The parsed credential body (JSON object with claims). */
  body: unknown
}
```

## hexToBytes

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/hex.ts#L2)

Import: `import {hexToBytes} from 'tasra-sdk'`

```ts
declare function hexToBytes(hex: string): Uint8Array
```

| Parameter | Type | Description |
|---|---|---|
| `hex` | `string` |  |

Returns: `Uint8Array<ArrayBufferLike>`.

## HolderNonce

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/holderProof.ts#L45)

```ts
export interface HolderNonce {
  nonce: string
  /** Expiry, Unix seconds. */
  expiresAt: number
  /** The slot's DCQL rule (present only for public-disclosure slots). */
  dcqlRule?: string
  /** The salt used in the rule's on-chain commitment (present with dcqlRule). */
  dcqlSalt?: string
  /** Rule version counter (present with dcqlRule). */
  ruleVersion?: number
}
```

## HolderProofAuth

Holder proof-of-possession options (F1/F4). The SDK fetches a `/v1/nonce` and
signs a holder proof with `signer` (the holder DID's authentication key), bound
to `audience` (the verifier's token `iss`) and the presented credentials.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/client/client.ts#L37)

```ts
export interface HolderProofAuth {
  signer: HolderSigner
  /** The verifier's expected audience (its token `iss`). */
  audience: string
  /** Optionally scope the proof to a slot / action (must match the slot being opened). */
  slotId?: string
  action?: string
  ttlSecs?: number
}
```

## HolderSigner

A signer for the holder DID's `authentication` key. Either the SDK holds the raw
Ed25519 secret, or the caller supplies a `sign` callback (HSM / wallet / WebCrypto)
that returns the raw JWS signature bytes for the given signing input.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/holderProof.ts#L91)

```ts
export type HolderSigner =
  | {alg: 'EdDSA'; did: string; secretKey: Uint8Array; kid?: string}
  | {
      alg: 'EdDSA' | 'ES256'
      did: string
      sign: (signingInput: Uint8Array) => Uint8Array | Promise<Uint8Array>
      kid?: string
    }
```

## httpFaucet

HTTP faucet client: POST {faucetUrl}/faucet {address} → FaucetGrant.
Matches the network faucet service.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/slots/faucet.ts#L27)

Import: `import {httpFaucet} from 'tasra-sdk'`

```ts
declare function httpFaucet(faucetUrl: string): Faucet
```

| Parameter | Type | Description |
|---|---|---|
| `faucetUrl` | `string` |  |

Returns: `Faucet`.

## ibeBlobChunkRange

The byte range of chunk `i` inside the body — for range requests and streaming.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe-blob.ts#L88)

Import: `import {ibeBlobChunkRange} from 'tasra-sdk'`

```ts
declare function ibeBlobChunkRange(header: IbeBlobHeader, index: number): { start: number; end: number; plainLength: number; }
```

| Parameter | Type | Description |
|---|---|---|
| `header` | `IbeBlobHeader` |  |
| `index` | `number` |  |

Returns: `{ start: number; end: number; plainLength: number; }`.

## ibeBlobDecryptKey

A WebCrypto key for `dek`, importable once per blob and reused across chunks.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe-blob.ts#L152)

Import: `import {ibeBlobDecryptKey} from 'tasra-sdk'`

```ts
declare function ibeBlobDecryptKey(dek: Uint8Array): Promise<CryptoKey>
```

| Parameter | Type | Description |
|---|---|---|
| `dek` | `Uint8Array<ArrayBufferLike>` |  |

Returns: `Promise<CryptoKey>`.

## ibeBlobDigest

`sha256(body)` — what a producer signs in its manifest so a reader can check provenance.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe-blob.ts#L191)

Import: `import {ibeBlobDigest} from 'tasra-sdk'`

```ts
declare function ibeBlobDigest(body: Uint8Array): Uint8Array
```

| Parameter | Type | Description |
|---|---|---|
| `body` | `Uint8Array<ArrayBufferLike>` |  |

Returns: `Uint8Array<ArrayBufferLike>`.

## IbeBlobHeader

The clear header stored beside the ciphertext body. Nothing in it is secret.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe-blob.ts#L36)

```ts
export interface IbeBlobHeader {
  v: 1
  /** 16 random bytes, base64 — the object's identity for the chunk binding. */
  blobId: string
  /** The IBE identity the data key is wrapped to. */
  identity: string
  contentType: string
  /** Plaintext size in bytes. */
  size: number
  chunkSize: number
  chunkCount: number
  /** `ibeEncrypt(mpk, identity, dek)` — the wire shape of `bls::ibe::Ciphertext`. */
  wrappedKey: {u: string; nonce: string; aead_ct: string}
}
```

## ibeBlobWrappedKey

The blob's IBE-wrapped data key as an `IbeCiphertext` (what `ibeDecryptWithKey` takes).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe-blob.ts#L136)

Import: `import {ibeBlobWrappedKey} from 'tasra-sdk'`

```ts
declare function ibeBlobWrappedKey(header: IbeBlobHeader): IbeCiphertext
```

| Parameter | Type | Description |
|---|---|---|
| `header` | `IbeBlobHeader` |  |

Returns: `IbeCiphertext`.

## IbeCiphertext

Encrypted message — wire shape of `bls::ibe::Ciphertext`.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe.ts#L46)

```ts
export interface IbeCiphertext {
  /** 96-byte compressed G2 ephemeral public key U = r·G2. */
  u: Uint8Array
  /** 12-byte ChaCha20-Poly1305 nonce, derived deterministically from U. */
  nonce: Uint8Array
  /** AEAD output (plaintext.len + 16-byte tag). */
  aeadCt: Uint8Array
}
```

## ibeCombineDecrypt

Combine k extraction partials and AEAD-decrypt `ct` — mirrors
`bls::ibe::combine_decrypt` (verify every share → Lagrange-combine → `T = e(sk_ID,U)`
→ KDF → open). The intermediate `sk_ID` never leaves this function.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe.ts#L282)

Import: `import {ibeCombineDecrypt} from 'tasra-sdk'`

```ts
declare function ibeCombineDecrypt(verifyingShares: IbeVerifyingShares, shares: IbeDecryptionShare[], ct: IbeCiphertext, identity: Uint8Array): Uint8Array
```

| Parameter | Type | Description |
|---|---|---|
| `verifyingShares` | `IbeVerifyingShares` |  |
| `shares` | `IbeDecryptionShare[]` |  |
| `ct` | `IbeCiphertext` |  |
| `identity` | `Uint8Array<ArrayBufferLike>` |  |

Returns: `Uint8Array<ArrayBufferLike>`.

## ibeCombineExtract

Lagrange-combine k verified partials into the identity key `sk_ID = msk · Q_ID`
(48-byte compressed G1).

⚠ Holding `sk_ID` is a DURABLE capability over every past and future ciphertext to
this identity — prefer {@link ibeCombineDecrypt}, which uses and drops it. Verifies
every share first (a caller combining unverified shares could be fed garbage that
silently fails the AEAD later, unattributed).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe.ts#L256)

Import: `import {ibeCombineExtract} from 'tasra-sdk'`

```ts
declare function ibeCombineExtract(verifyingShares: IbeVerifyingShares, shares: IbeDecryptionShare[], identity: Uint8Array): Uint8Array
```

| Parameter | Type | Description |
|---|---|---|
| `verifyingShares` | `IbeVerifyingShares` |  |
| `shares` | `IbeDecryptionShare[]` |  |
| `identity` | `Uint8Array<ArrayBufferLike>` |  |

Returns: `Uint8Array<ArrayBufferLike>`.

## ibeDecryptBlobChunk

Decrypt one chunk (its exact body slice, see {@link ibeBlobChunkRange}).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe-blob.ts#L157)

Import: `import {ibeDecryptBlobChunk} from 'tasra-sdk'`

```ts
declare function ibeDecryptBlobChunk(key: CryptoKey, header: IbeBlobHeader, index: number, chunk: Uint8Array): Promise<Uint8Array>
```

| Parameter | Type | Description |
|---|---|---|
| `key` | `CryptoKey` |  |
| `header` | `IbeBlobHeader` |  |
| `index` | `number` |  |
| `chunk` | `Uint8Array<ArrayBufferLike>` |  |

Returns: `Promise<Uint8Array<ArrayBufferLike>>`.

## IbeDecryptionShare

One node's partial `D_i = sk_i · Q_ID` (48-byte compressed G1).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe.ts#L56)

```ts
export interface IbeDecryptionShare {
  /** 1-indexed BLS group identifier (the extract reply's `identifier`). */
  identifier: number
  /** 48-byte compressed G1. */
  value: Uint8Array
}
```

## ibeDecryptRequest

One-call identity-scoped decrypt (the read path): token → extraction fan-out
→ verify each partial → combine → decrypt. The intermediate `sk_ID` never surfaces.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/request.ts#L473)

Import: `import {ibeDecryptRequest} from 'tasra-sdk'`

```ts
declare function ibeDecryptRequest(opts: IbeExtractRequestOpts & { ciphertext: IbeCiphertext; }): Promise<Uint8Array>
```

| Parameter | Type | Description |
|---|---|---|
| `opts` | `IbeExtractRequestOpts & { ciphertext: IbeCiphertext; }` |  |

Returns: `Promise<Uint8Array<ArrayBufferLike>>`.

## ibeDecryptWithKey

Decrypt with an already-extracted identity key (48-byte compressed G1) — the
custody-opt-in path pairing with {@link ibeCombineExtract}.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe.ts#L300)

Import: `import {ibeDecryptWithKey} from 'tasra-sdk'`

```ts
declare function ibeDecryptWithKey(skIdBytes: Uint8Array, ct: IbeCiphertext, identity: Uint8Array): Uint8Array
```

| Parameter | Type | Description |
|---|---|---|
| `skIdBytes` | `Uint8Array<ArrayBufferLike>` |  |
| `ct` | `IbeCiphertext` |  |
| `identity` | `Uint8Array<ArrayBufferLike>` |  |

Returns: `Uint8Array<ArrayBufferLike>`.

## ibeEncrypt

Encrypt `message` to `identity` under the slot's master public key (96-byte
compressed G2). Offline and permissionless — the identity's key need not exist yet.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe.ts#L189)

Import: `import {ibeEncrypt} from 'tasra-sdk'`

```ts
declare function ibeEncrypt(mpkBytes: Uint8Array, identity: Uint8Array, message: Uint8Array): IbeCiphertext
```

| Parameter | Type | Description |
|---|---|---|
| `mpkBytes` | `Uint8Array<ArrayBufferLike>` |  |
| `identity` | `Uint8Array<ArrayBufferLike>` |  |
| `message` | `Uint8Array<ArrayBufferLike>` |  |

Returns: `IbeCiphertext`.

## IbeExtractionPartial

One node's extraction partial, decoded from the wire.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/client.ts#L487)

```ts
export interface IbeExtractionPartial {
  /** Echoed slot, when supplied by the server. Required by the strict helper. */
  keySlotId?: string
  receipt?: OperationReceipt
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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/client.ts#L503)

```ts
export interface IbeExtractOpts {
  signal?: AbortSignal
  fetchImpl?: typeof fetch
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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/request.ts#L459)

Import: `import {ibeExtractRequest} from 'tasra-sdk'`

```ts
declare function ibeExtractRequest(opts: IbeExtractRequestOpts): Promise<Uint8Array>
```

| Parameter | Type | Description |
|---|---|---|
| `opts` | `IbeExtractRequestOpts` |  |

Returns: `Promise<Uint8Array<ArrayBufferLike>>`.

## IbeExtractRequestOpts

Operation-specific fields for {@link ibeDecryptRequest} / {@link ibeExtractRequest}.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/request.ts#L439)

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

## ibeOpenBlob

Open a whole sealed blob with `sk_ID`: unwrap the key, decrypt every chunk, return the
plaintext. Streaming consumers use `ibeUnwrapBlobKey` + `ibeDecryptBlobChunk` per range.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe-blob.ts#L173)

Import: `import {ibeOpenBlob} from 'tasra-sdk'`

```ts
declare function ibeOpenBlob(skIdBytes: Uint8Array, header: IbeBlobHeader, body: Uint8Array): Promise<Uint8Array>
```

| Parameter | Type | Description |
|---|---|---|
| `skIdBytes` | `Uint8Array<ArrayBufferLike>` |  |
| `header` | `IbeBlobHeader` |  |
| `body` | `Uint8Array<ArrayBufferLike>` |  |

Returns: `Promise<Uint8Array<ArrayBufferLike>>`.

## ibeSealBlob

Seal `plaintext` to `identity` under the slot's master public key: a fresh data key,
IBE-wrapped, and the body as independently-decryptable AES-256-GCM chunks. Offline and
permissionless, like `ibeEncrypt`.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe-blob.ts#L100)

Import: `import {ibeSealBlob} from 'tasra-sdk'`

```ts
declare function ibeSealBlob(mpkBytes: Uint8Array, identity: string, plaintext: Uint8Array, opts?: { contentType?: string; chunkSize?: number; }): Promise<SealedBlob>
```

| Parameter | Type | Description |
|---|---|---|
| `mpkBytes` | `Uint8Array<ArrayBufferLike>` |  |
| `identity` | `string` |  |
| `plaintext` | `Uint8Array<ArrayBufferLike>` |  |
| `opts` | `{ contentType?: string; chunkSize?: number; }` |  |

Returns: `Promise<SealedBlob>`.

## ibeUnwrapBlobKey

Unwrap the data key with the identity's extracted key `sk_ID` (48-byte compressed G1 —
`ibeCombineExtract`'s output). One pairing; the caller keeps the returned key in memory only
as long as it decrypts, then zeroizes it.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe-blob.ts#L145)

Import: `import {ibeUnwrapBlobKey} from 'tasra-sdk'`

```ts
declare function ibeUnwrapBlobKey(skIdBytes: Uint8Array, header: IbeBlobHeader): Uint8Array
```

| Parameter | Type | Description |
|---|---|---|
| `skIdBytes` | `Uint8Array<ArrayBufferLike>` |  |
| `header` | `IbeBlobHeader` |  |

Returns: `Uint8Array<ArrayBufferLike>`.

## IbeVerifyingShares

A node's dual-group verifying share — only the 96-byte G2 half is needed here.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe.ts#L64)

```ts
export type IbeVerifyingShares = ReadonlyMap<number, Uint8Array>
```

## ibeVerifyShare

Verify one extraction partial against its node's dual-group verifying share (the
96-byte G2 half): `e(D_i, G2) == e(Q_ID, Y_i)`. Throws naming the identifier —
identifiable abort: the caller knows WHICH node served a bad share.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe.ts#L230)

Import: `import {ibeVerifyShare} from 'tasra-sdk'`

```ts
declare function ibeVerifyShare(verifyingShares: IbeVerifyingShares, identity: Uint8Array, share: IbeDecryptionShare): void
```

| Parameter | Type | Description |
|---|---|---|
| `verifyingShares` | `IbeVerifyingShares` |  |
| `identity` | `Uint8Array<ArrayBufferLike>` |  |
| `share` | `IbeDecryptionShare` |  |

Returns: `void`.

## isAuthDenied

True when `e` is an auth rejection — i.e. retrying is pointless, re-claim
instead. Keyed on the HTTP status rather than the class, so it also catches
subclasses that carry their own name (e.g. `CommitteeAuthorizeError`).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/errors.ts#L171)

Import: `import {isAuthDenied} from 'tasra-sdk'`

```ts
declare function isAuthDenied(e: unknown): e is TasraHttpError
```

| Parameter | Type | Description |
|---|---|---|
| `e` | `unknown` |  |

Returns: `boolean`.

## isHeaderSafeNonce

Guard for a nonce that can ride in a header (the agent's challenge carries it back).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/dpop.ts#L163)

Import: `import {isHeaderSafeNonce} from 'tasra-sdk'`

```ts
declare function isHeaderSafeNonce(nonce: string): boolean
```

| Parameter | Type | Description |
|---|---|---|
| `nonce` | `string` |  |

Returns: `boolean`.

## isJwtExpiringSoon

True when the token is expired or within `skewMs` of expiring.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L251)

Import: `import {isJwtExpiringSoon} from 'tasra-sdk'`

```ts
declare function isJwtExpiringSoon(jwt: string, skewMs?: number): boolean
```

| Parameter | Type | Description |
|---|---|---|
| `jwt` | `string` |  |
| `skewMs` | `number` |  |

Returns: `boolean`.

## isOid4vpRule

True when `rule` parses as a supported OID4VP-DCQL query.

This is the grammar dispatch used by the commitment. It must stay a TOTAL function —
a legacy kk-DCQL rule is not an error here, it is simply "not OID4VP".

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L1028)

Import: `import {isOid4vpRule} from 'tasra-sdk'`

```ts
declare function isOid4vpRule(rule: string): boolean
```

| Parameter | Type | Description |
|---|---|---|
| `rule` | `string` |  |

Returns: `boolean`.

## isRetryable

True when retrying the identical request could plausibly succeed. Non-SDK
errors (a `TypeError` from a bug) report `false`.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/errors.ts#L179)

Import: `import {isRetryable} from 'tasra-sdk'`

```ts
declare function isRetryable(e: unknown): boolean
```

| Parameter | Type | Description |
|---|---|---|
| `e` | `unknown` |  |

Returns: `boolean`.

## issueAdminCredential

Admin-mint a single-use credential (redemption token) for the given scopes.
Requires the verifier's admin secret. Pair with redeemCredential() to get a
JWT whose `sub` is the recipient DID you pass there.
POST {verifier}/v1/admin/credentials/issue  (header: X-Admin-Secret)

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L123)

Import: `import {issueAdminCredential} from 'tasra-sdk'`

```ts
declare function issueAdminCredential(verifierUrl: string, adminSecret: string, opts: { scopes: string[]; slotIds?: string[]; ttlSecs?: number; }): Promise<RedemptionGrant>
```

| Parameter | Type | Description |
|---|---|---|
| `verifierUrl` | `string` |  |
| `adminSecret` | `string` |  |
| `opts` | `{ scopes: string[]; slotIds?: string[]; ttlSecs?: number; }` |  |

Returns: `Promise<RedemptionGrant>`.

## IssuedToken

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L11)

```ts
export interface IssuedToken {
  /** The signed JWT (EdDSA) to present to keykeeper-nodes as a Bearer token. */
  token: string
  /** Expiry, Unix seconds. */
  exp: number
  /** Subject / holder the token was minted for. */
  holder: string
}
```

## isTasraPost

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/detect.ts#L6)

Import: `import {isTasraPost} from 'tasra-sdk'`

```ts
declare function isTasraPost(text: string): boolean
```

| Parameter | Type | Description |
|---|---|---|
| `text` | `string` |  |

Returns: `boolean`.

## jsonCredential

A {@link CredentialView} over a parsed JSON credential body.

Path resolution walks object keys, plus `null` for "every element of this array". A path
that runs into the wrong shape is ABSENT rather than an error, which is what makes the
evaluator fail closed.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L220)

Import: `import {jsonCredential} from 'tasra-sdk'`

```ts
declare function jsonCredential(args: { format: string; types: readonly string[]; body: unknown; }): CredentialView
```

| Parameter | Type | Description |
|---|---|---|
| `args` | `{ format: string; types: readonly string[]; body: unknown; }` |  |

Returns: `CredentialView`.

## jwkThumbprint

RFC 7638 JWK thumbprint of an EC P-256 public key.

⚠ The member order is LEXICOGRAPHIC and the JSON has no whitespace — the RFC hashes an
exactly specified string, so `JSON.stringify` over an object literal in a different order
yields a different thumbprint and the token's `cnf.jkt` would never match.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/dpop.ts#L120)

Import: `import {jwkThumbprint} from 'tasra-sdk'`

```ts
declare function jwkThumbprint(jwk: JsonWebKey): Promise<string>
```

| Parameter | Type | Description |
|---|---|---|
| `jwk` | `JsonWebKey` |  |

Returns: `Promise<string>`.

## JwtClaims

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L218)

```ts
export interface JwtClaims {
  sub?: string
  iss?: string
  aud?: string
  exp?: number
  iat?: number
  scope?: string | string[]
  [k: string]: unknown
}
```

## jwtExpMs

Expiry as epoch-ms, or null if absent/unparseable.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L245)

Import: `import {jwtExpMs} from 'tasra-sdk'`

```ts
declare function jwtExpMs(jwt: string): number | null
```

| Parameter | Type | Description |
|---|---|---|
| `jwt` | `string` |  |

Returns: `number | null`.

## NodeUnreachableError

The request never got an HTTP answer — DNS failure, connection refused,
timeout, CORS. Retryable: the service may simply not be up yet.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/errors.ts#L81)

```ts
(args: { url: string; message?: string; cause?: unknown; }): NodeUnreachableError
```

Import: `import {NodeUnreachableError} from 'tasra-sdk'`

- `url: string`
- `retryable: boolean` — `false` when retrying the identical request cannot succeed.
- `name: string`
- `message: string`
- `stack: string &#124; undefined`
- `cause: unknown`

## OpenSessionOpts

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/client/client.ts#L70)

```ts
export interface OpenSessionOpts {
  /** AAD for envelopes this session encrypts. Default = the 32-byte slot id. */
  identity?: Uint8Array
  /** JWT refresh skew (ms) for isJwtExpiringSoon. Default 30_000. */
  skewMs?: number
}
```

## parseTasraPost

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/detect.ts#L19)

Import: `import {parseTasraPost} from 'tasra-sdk'`

```ts
declare function parseTasraPost(text: string): GroupEnvelope | null
```

| Parameter | Type | Description |
|---|---|---|
| `text` | `string` |  |

Returns: `GroupEnvelope | null`.

## payloadDigest

Compute the `payload_digest` for a given action and message.

For `sign` and `ibe-extract`, this is `sha256(message_bytes)` as 0x-hex.
Other actions should supply the digest directly.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L176)

Import: `import {payloadDigest} from 'tasra-sdk'`

```ts
declare function payloadDigest(action: string, messageHex: string): string
```

| Parameter | Type | Description |
|---|---|---|
| `action` | `string` |  |
| `messageHex` | `string` |  |

Returns: `string`.

## pollOid4vpSession

Poll an OID4VP session on the Verifier Agent for its result — ONE poll.

The reply is validated against the contract: `status` ∈ {pending, done, failed}, a
`phase` the UI may show, and, when done, a well-formed compound token. The poll secret
travels only in the `Authorization` header and never appears in an error.

Throws `VerifierAgentSessionError`: `unavailable` for 502/503/504 (the session may still complete —
`waitForSession` keeps polling), `protocol` for any other non-2xx or a malformed reply.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L344)

Import: `import {pollOid4vpSession} from 'tasra-sdk'`

```ts
declare function pollOid4vpSession(verifierAgentUrl: string, sessionId: string, pollSecret: string): Promise<SessionStatusResult>
```

| Parameter | Type | Description |
|---|---|---|
| `verifierAgentUrl` | `string` |  |
| `sessionId` | `string` |  |
| `pollSecret` | `string` |  |

Returns: `Promise<SessionStatusResult>`.

## PresentationDelegation

EIP-712 delegation from the slot creator to a delegate address.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L36)

```ts
export interface PresentationDelegation {
  chain_id: number
  slot_ids: string[]
  /** 0x-hex 20-byte delegate address */
  delegate: string
  actions: string[]
  exp: number
  nonce: number
  /** 0x-hex 65-byte EIP-712 signature */
  signature: string
}
```

## PresentationOperation

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L21)

```ts
export interface PresentationOperation {
  chain_id: number
  /** 0x-hex 32-byte slot identifier */
  slot_id: string
  /** "sign" | "decrypt" | "ibe-extract" | "dual-approve" */
  action: string
  /** 0x-hex 32-byte digest (sha256 of the message for sign/ibe-extract) */
  payload_digest: string
  /** Human-readable description shown in transaction_data */
  description: string
  /** Unix timestamp — when the authorization expires */
  exp: number
}
```

## RecipientStore

A recipient's local credential store. Holds structured credentials and
evaluates them against OID4VP-DCQL rules. Each credential is individually
matched — no aggregation into a single subject.

Everything here is in-memory and synchronous: deciding access reveals nothing
to the platform.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/recipient/store.ts#L35)

```ts
(credentials?: (HeldCredential | CredentialView)[]): RecipientStore
```

Import: `import {RecipientStore} from 'tasra-sdk'`

- `add: (credential: HeldCredential &#124; CredentialView) => RecipientStore` — Add a credential (returns `this` for chaining).
- `views: () => readonly CredentialView[]` — The credential views held in this store.
- `satisfies: (rule: string) => boolean` — Does this recipient satisfy `rule`? Pure, local, platform-blind.

## redeemCredential

Redeem an admin-issued, single-use credential/invite token for a JWT.
POST {verifier}/v1/credentials/redeem  {redemption_token, recipient_did}

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L96)

Import: `import {redeemCredential} from 'tasra-sdk'`

```ts
declare function redeemCredential(verifierUrl: string, redemptionToken: string, recipientDid: string): Promise<IssuedToken>
```

| Parameter | Type | Description |
|---|---|---|
| `verifierUrl` | `string` |  |
| `redemptionToken` | `string` |  |
| `recipientDid` | `string` |  |

Returns: `Promise<IssuedToken>`.

## redeemRenewalToken

Redeem a long-lived renewal token for a fresh JWT.
POST {verifier}/v1/renewals/redeem  {renewal_token}

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L82)

Import: `import {redeemRenewalToken} from 'tasra-sdk'`

```ts
declare function redeemRenewalToken(verifierUrl: string, renewalToken: string): Promise<IssuedToken>
```

| Parameter | Type | Description |
|---|---|---|
| `verifierUrl` | `string` |  |
| `renewalToken` | `string` |  |

Returns: `Promise<IssuedToken>`.

## RedemptionGrant

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L110)

```ts
export interface RedemptionGrant {
  /** Single-use token to exchange for a JWT via redeemCredential(). */
  redemptionToken: string
  /** Expiry of the redemption token, Unix seconds. */
  expiresAt: number
}
```

## RenewalGrant

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L34)

```ts
export interface RenewalGrant {
  /** Long-lived token to exchange for fresh JWTs via redeemRenewalToken(). */
  renewalToken: string
  holder: string
  /** Expiry, Unix seconds. */
  expiresAt: number
  scopes: string[]
}
```

## requestIbeExtractionPartials

Fan out to the keeper nodes and collect extraction partials. Nodes that refuse or are
down are skipped; throws — naming every node and its reason — only when NONE served.
The caller combines with `ibeCombineDecrypt`/`ibeCombineExtract`, which pairing-verify
each partial (identifiable abort names the node via the identifier).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/committee/client.ts#L572)

Import: `import {requestIbeExtractionPartials} from 'tasra-sdk'`

```ts
declare function requestIbeExtractionPartials(opts: IbeExtractOpts): Promise<IbeExtractionPartial[]>
```

| Parameter | Type | Description |
|---|---|---|
| `opts` | `IbeExtractOpts` |  |

Returns: `Promise<IbeExtractionPartial[]>`.

## revokeRenewal

Revoke a renewal token — future redeems are denied, and any bound slots get a
rotation webhook. POST {verifier}/v1/renewals/revoke  {renewal_token}

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L67)

Import: `import {revokeRenewal} from 'tasra-sdk'`

```ts
declare function revokeRenewal(verifierUrl: string, renewalToken: string): Promise<void>
```

| Parameter | Type | Description |
|---|---|---|
| `verifierUrl` | `string` |  |
| `renewalToken` | `string` |  |

Returns: `Promise<void>`.

## revokeSlotUser

Admin: revoke a holder's (DID's) access to a slot and, by default, rotate the
slot — re-keying it so any JWT the revoked holder still holds is
cryptographically useless for anything encrypted after the rotation. The
verifier blocklists the DID and fires a rotation webhook to the nodes.
Requires the verifier's admin secret. Resolve handle→DID upstream; the
verifier blocklists strictly by DID.
POST {verifier}/v1/admin/slots/revoke-user  (header: X-Admin-Secret)

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L152)

Import: `import {revokeSlotUser} from 'tasra-sdk'`

```ts
declare function revokeSlotUser(verifierUrl: string, adminSecret: string, opts: { slotId: string; did: string; rotate?: boolean; reason?: string; }): Promise<void>
```

| Parameter | Type | Description |
|---|---|---|
| `verifierUrl` | `string` |  |
| `adminSecret` | `string` |  |
| `opts` | `{ slotId: string; did: string; rotate?: boolean; reason?: string; }` |  |

Returns: `Promise<void>`.

## scopeCovers

Whether the scope `grant` (from a verified credential) covers the requested
`identity`. Fail-closed on oversize or NUL-bearing inputs.

⚠ Implemented over UTF-8 BYTES, not UTF-16 code units, deliberately: the reference implementation
compares raw bytes, the length cap is in bytes, and the `/`-boundary check indexes a
byte position. Operating on `.length`/`charAt` would diverge for any non-ASCII
segment.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/identityScope.ts#L44)

Import: `import {scopeCovers} from 'tasra-sdk'`

```ts
declare function scopeCovers(grant: string, identity: string): boolean
```

| Parameter | Type | Description |
|---|---|---|
| `grant` | `string` |  |
| `identity` | `string` |  |

Returns: `boolean`.

## ScopeNamespace

How a `kk_identity_scope_claim` grant is bound to a grantor.

The binding is deliberately application-agnostic — no namespace vocabulary. An
identity is an opaque `/`-segmented string; the mechanism only relates a grant to the
credential's verified issuer, and applications choose what the segments mean.

 - `"issuer"` (the only self-service-safe form): a grant reaches only the granting
   credential's VERIFIED issuer's namespace — the requested identity's first
   `/`-segment must byte-equal the issuer DID, so each namespace is rooted at its
   grantor's own DID (`<issuer>/…`). A human label belongs in the slot (policy
   class) or a deeper segment, never in this binding position.
 - `"any"`: administrative delegation — the credential may grant over any namespace.
   The validator REFUSES `"any"` combined with an open issuer set.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L137)

```ts
export type ScopeNamespace = 'issuer' | 'any'
```

## SealedBlob

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe-blob.ts#L51)

```ts
export interface SealedBlob {
  header: IbeBlobHeader
  /** The concatenated encrypted chunks. */
  body: Uint8Array
}
```

## selectDcql

Select the minimal set of credentials that satisfy `rule` — the inverse of
{@link evaluate}. Given a rule and held credentials, returns which to present.

When `credential_sets` are present, picks the cheapest satisfying option
(fewest credential queries). When absent, every credential query must be
satisfied.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L756)

Import: `import {selectDcql} from 'tasra-sdk'`

```ts
declare function selectDcql(rule: string, credentials: readonly CredentialView[], opts?: ValidateOptions): Selection
```

| Parameter | Type | Description |
|---|---|---|
| `rule` | `string` |  |
| `credentials` | `readonly CredentialView[]` |  |
| `opts` | `ValidateOptions` |  |

Returns: `Selection`.

## Session

A live, managed access session for one key slot.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/client/session.ts#L35)

```ts
export interface Session {
  /** 0x-prefixed bytes32 slot id. */
  readonly slotId: string
  /** Subject the JWT was minted for. */
  readonly holder: string
  /** 96-byte compressed G2 group public key of the currently-assembled epoch. */
  readonly mpkBytes: Uint8Array
  /** Epoch of the currently-assembled master key. */
  readonly epoch: number
  /** The current (possibly auto-renewed) JWT. */
  readonly jwt: string

  /** Encrypt to this slot's group key. Local + synchronous (needs no JWT). */
  encrypt(
    plaintext: Uint8Array,
    opts?: {identity?: Uint8Array; epoch?: bigint | null},
  ): Uint8Array
  /** Decrypt with the assembled master key. Refreshes the JWT first and, on an
   *  epoch mismatch (the slot rotated), re-assembles and retries once. */
  decrypt(envelope: Uint8Array | GroupEnvelope): Promise<Uint8Array>
  /** FROST-Ed25519 custody signature over `message`. */
  sign(message: Uint8Array, opts?: SignOpts): Promise<FrostSignResult>
  /** Threshold-ECDSA signature over a 32-byte digest (EVM EOA slots). */
  signDigest(
    digest: Uint8Array,
    opts?: {targetKeykeeper?: string},
  ): Promise<EoaSignature>
  /** Renew the JWT if it is near expiry and re-assemble on rotation. */
  ensureFresh(): Promise<void>
  /** Zeroize the assembled key and drop this session from its client. */
  close(): Promise<void>
}
```

## SessionAuth

How to obtain the slot JWT — exactly one of four modes.

`renewalToken` is the ONLY mode that silently auto-renews; the other three
resolve once and then fail loud on expiry, prompting a fresh `openSession`.

The `?: undefined` members make the modes **mutually exclusive at compile
time**. Without them `{jwt, renewalToken}` type-checked (it structurally
satisfies `{jwt: string}`) and the loser was silently ignored at runtime.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/client/client.ts#L64)

```ts
export type SessionAuth =
  | {jwt: string; renewalToken?: undefined; redemptionToken?: undefined; vpJwt?: undefined}
  | {renewalToken: string; jwt?: undefined; redemptionToken?: undefined; vpJwt?: undefined}
  | {redemptionToken: string; jwt?: undefined; renewalToken?: undefined; vpJwt?: undefined}
  | {vpJwt: VpJwtAuth; jwt?: undefined; renewalToken?: undefined; redemptionToken?: undefined}
```

## SessionStatusResult

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L90)

```ts
export interface SessionStatusResult {
  status: 'pending' | 'done' | 'failed'
  phase: SessionPhase
  compoundToken?: Record<string, unknown>
  verifierProofs?: unknown
  bindingPreimage?: Record<string, unknown>
  error?: string
}
```

## ShardDecryptOpts

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/decryption/client.ts#L86)

```ts
export interface ShardDecryptOpts {
  /** Base URLs of ≥ k nodes to fetch partial decryptions from. */
  nodeUrls: string[]
  jwt: string
  slotId: string
  ciphertext: Ciphertext
  identity: Uint8Array
  ciphertextEpoch?: number
  /** Pairing-verify each share before combining (identifiable abort). Default false. */
  verifyShares?: boolean
}
```

## ShardSignOpts

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/signing/frost.ts#L151)

```ts
export interface ShardSignOpts {
  /** Base URLs of exactly the k chosen committee nodes. */
  nodeUrls: string[]
  jwt: string
  slotId: string
  message: Uint8Array
  /** The slot's 32-byte group public key. Fetched from nodeUrls[0] if omitted. */
  groupPublicKey?: Uint8Array
  /** Verify the aggregate locally before returning (default true). */
  verify?: boolean
}
```

## signCustody

Sign a message via the custody path: the node runs the whole FROST ceremony
and returns the final group signature (one HTTP round-trip).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/signing/frost.ts#L87)

Import: `import {signCustody} from 'tasra-sdk'`

```ts
declare function signCustody(opts: SignCustodyOpts): Promise<FrostSignResult>
```

| Parameter | Type | Description |
|---|---|---|
| `opts` | `SignCustodyOpts` |  |

Returns: `Promise<FrostSignResult>`.

## SignCustodyOpts

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/signing/frost.ts#L53)

```ts
export interface SignCustodyOpts {
  nodeUrl: string
  jwt: string
  /** 0x-prefixed (or bare) bytes32 slot id. */
  slotId: string
  /** Raw message bytes to sign. */
  message: Uint8Array
  /** Explicit signer set (u16 ids). Omit → node uses 1..k. Passing MORE than k
   *  ids makes the node use the robust ROAST coordinator. */
  signingSet?: number[]
  /** 64-byte Ed25519 user signature — required iff the slot has a registered
   *  owner pubkey. Build with signUserRequest(). */
  userSignature?: Uint8Array
  /** 20-byte operator address to pin (anti-Sybil). */
  targetKeykeeper?: string
  /** Idempotency key. Required when userSignature is set. */
  requestId?: string
}
```

## signEoaDigest

Threshold-sign a 32-byte digest with a tecdsa slot's key. Returns the raw
Ethereum signature components; assemble into a transaction with ethSignatureV().

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/signing/ecdsa.ts#L44)

Import: `import {signEoaDigest} from 'tasra-sdk'`

```ts
declare function signEoaDigest(opts: EoaSignOpts): Promise<EoaSignature>
```

| Parameter | Type | Description |
|---|---|---|
| `opts` | `EoaSignOpts` |  |

Returns: `Promise<EoaSignature>`.

## SignOpts

Per-call overrides for a FROST custody signature.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/client/session.ts#L23)

```ts
export interface SignOpts {
  /** Explicit signer set (u16 ids); omit → node uses 1..k. */
  signingSet?: number[]
  /** 64-byte Ed25519 user signature — required iff the slot has an owner key. */
  userSignature?: Uint8Array
  /** 20-byte operator address to pin (anti-Sybil). */
  targetKeykeeper?: string
  /** Idempotency key (required when userSignature is set). */
  requestId?: string
}
```

## signUserRequest

Sign the user-gated payload with the slot owner's 32-byte Ed25519 secret key.
The result goes in SignCustodyOpts.userSignature (also pass the same requestId).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/signing/frost.ts#L140)

Import: `import {signUserRequest} from 'tasra-sdk'`

```ts
declare function signUserRequest(secretKey: Uint8Array, slotId: string, message: Uint8Array, requestId: string): Uint8Array
```

| Parameter | Type | Description |
|---|---|---|
| `secretKey` | `Uint8Array<ArrayBufferLike>` |  |
| `slotId` | `string` |  |
| `message` | `Uint8Array<ArrayBufferLike>` |  |
| `requestId` | `string` |  |

Returns: `Uint8Array<ArrayBufferLike>`.

## signWithShardDelivery

Sign via the shard-delivery path: the CLIENT fans out to k nodes (Round 1
commit, Round 2 partial) and aggregates the shares locally into the group
signature. The node URLs must be exactly the k committee members.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/signing/frost.ts#L225)

Import: `import {signWithShardDelivery} from 'tasra-sdk'`

```ts
declare function signWithShardDelivery(opts: ShardSignOpts): Promise<FrostSignature>
```

| Parameter | Type | Description |
|---|---|---|
| `opts` | `ShardSignOpts` |  |

Returns: `Promise<FrostSignature>`.

## SlotRotatedError

The slot was re-keyed (rotated) since the key in hand was assembled, so that
key cannot read anything encrypted after the rotation. Retryable: re-assemble
at the new epoch and try again — the managed {@link Session } does this for you.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/errors.ts#L128)

```ts
(args: { expected: number; actual: number; slotId?: string; message?: string; }): SlotRotatedError
```

Import: `import {SlotRotatedError} from 'tasra-sdk'`

- `expected: number` — The epoch the caller's key/envelope belongs to.
- `actual: number` — The slot's current on-chain/served epoch.
- `retryable: boolean` — `false` when retrying the identical request cannot succeed.
- `name: string`
- `message: string`
- `stack: string &#124; undefined`
- `cause: unknown`

## submitOauthResponse

Deliver an access token + DPoP proof to an `oauth` session.

Speaks the RFC 9449 §9 resource-server contract — token in `Authorization: DPoP`, proof in
`DPoP:` — so a conformant client library needs no custom code. It also handles the
`use_dpop_nonce` challenge ITSELF: on a `401` carrying `DPoP-Nonce`, it re-mints the proof
with the server's nonce and resends ONCE. One retry, not a loop: a server that keeps
challenging is broken, and retrying forever would hide that.

`signer` must be the key the token is bound to — see `../auth/dpop.js` for the two shapes.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L288)

Import: `import {submitOauthResponse} from 'tasra-sdk'`

```ts
declare function submitOauthResponse(verifierAgentUrl: string, args: { sessionId: string; pollSecret: string; accessToken: string; nonce: string; dpopHtu: string; signer: DpopSigner; }): Promise<void>
```

| Parameter | Type | Description |
|---|---|---|
| `verifierAgentUrl` | `string` |  |
| `args` | `{ sessionId: string; pollSecret: string; accessToken: string; nonce: string; dpopHtu: string; signer: DpopSigner; }` |  |

Returns: `Promise<void>`.

## TasraClient

A configured client. Holds no key material itself — each {@link Session} it
opens owns its own JWT and (lazily) assembled master key.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/client/client.ts#L81)

```ts
export interface TasraClient {
  readonly config: Readonly<TasraClientConfig>
  /** Obtain a JWT (per `auth`), assemble the slot key, and return a managed Session. */
  openSession(
    slotId: string,
    auth: SessionAuth,
    opts?: OpenSessionOpts,
  ): Promise<Session>
  /** Currently-open sessions (live references). */
  sessions(): readonly Session[]
  /** Zeroize + close every open session. */
  closeAll(): Promise<void>
}
```

## TasraClientConfig

Connection parameters for {@link createTasraClient}. Set once and reused by
every session the client opens.

`verifier` and `identity` are optional in the type because `{jwt}` auth needs
neither, but each is enforced at `openSession` time for the modes that do.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/client/client.ts#L23)

```ts
export interface TasraClientConfig {
  /** k-of-n keykeeper-node base URLs. */
  nodes: string[]
  /** Verifier base URL — required for renewalToken / redemptionToken / vpJwt auth. */
  verifier?: string
  /** This holder's DID — recipient_did / holder for credential & vp-jwt auth. */
  identity?: string
}
```

## TasraError

Base class for every error this SDK throws deliberately. Catch this to
distinguish SDK failures from programming errors (`TypeError`, etc.).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/errors.ts#L33)

```ts
(message: string, opts?: { retryable?: boolean; cause?: unknown; }): TasraError
```

Import: `import {TasraError} from 'tasra-sdk'`

- `retryable: boolean` — `false` when retrying the identical request cannot succeed.
- `name: string`
- `message: string`
- `stack: string &#124; undefined`
- `cause: unknown`

## TasraHttpError

A node or verifier answered with a non-2xx status. `body` is the response body,
truncated to 200 characters — enough to carry the service's own error text
without dumping a page of HTML into a log line.

5xx and 429 are marked retryable; other 4xx are not.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/errors.ts#L51)

```ts
(args: { status: number; url: string; body?: string; message?: string; retryable?: boolean; }): TasraHttpError
```

Import: `import {TasraHttpError} from 'tasra-sdk'`

- `status: number`
- `url: string`
- `body: string`
- `retryable: boolean` — `false` when retrying the identical request cannot succeed.
- `name: string`
- `message: string`
- `stack: string &#124; undefined`
- `cause: unknown`

## ThresholdNotMetError

Fewer than the required number of participants answered — too few shards to
assemble a key, too few verifier signatures for a quorum, too few nodes for a
signing set.

`reasons` carries one entry per participant that failed, which is what makes
this actionable: previously those were collected and then discarded, so a DNS
failure and a cold DKG produced the same opaque message.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/errors.ts#L99)

```ts
(args: { got: number; need: number; reasons?: readonly string[]; message?: string; retryable?: boolean; }): ThresholdNotMetError
```

Import: `import {ThresholdNotMetError} from 'tasra-sdk'`

- `got: number` — How many participants answered successfully.
- `need: number` — How many were needed.
- `reasons: readonly string[]` — Why each failing participant failed, one string per participant.
- `retryable: boolean` — `false` when retrying the identical request cannot succeed.
- `name: string`
- `message: string`
- `stack: string &#124; undefined`
- `cause: unknown`

## toBytes

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/envelope.ts#L51)

Import: `import {toBytes} from 'tasra-sdk'`

```ts
declare function toBytes(env: GroupEnvelope): Uint8Array
```

| Parameter | Type | Description |
|---|---|---|
| `env` | `GroupEnvelope` |  |

Returns: `Uint8Array<ArrayBufferLike>`.

## userSignaturePayload

The canonical payload the node verifies for a user-gated sign:
domain ‖ u64_LE(len slot) ‖ slot ‖ u64_LE(32) ‖ SHA256(message) ‖
u64_LE(len requestId) ‖ requestId.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/signing/frost.ts#L120)

Import: `import {userSignaturePayload} from 'tasra-sdk'`

```ts
declare function userSignaturePayload(slotId: string, message: Uint8Array, requestId: string): Uint8Array
```

| Parameter | Type | Description |
|---|---|---|
| `slotId` | `string` |  |
| `message` | `Uint8Array<ArrayBufferLike>` |  |
| `requestId` | `string` |  |

Returns: `Uint8Array<ArrayBufferLike>`.

## validateDcql

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L434)

Import: `import {validateDcql} from 'tasra-sdk'`

```ts
declare function validateDcql(rule: string, opts?: ValidateOptions): Query
```

| Parameter | Type | Description |
|---|---|---|
| `rule` | `string` |  |
| `opts` | `ValidateOptions` |  |

Returns: `Query`.

## validateRecipientRule

Explicitly validate a slot's rule client-side: returns normally if well-formed,
throws {@link DcqlMalformedError} otherwise.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/recipient/store.ts#L110)

Import: `import {validateRecipientRule} from 'tasra-sdk'`

```ts
declare function validateRecipientRule(rule: string): void
```

| Parameter | Type | Description |
|---|---|---|
| `rule` | `string` |  |

Returns: `void`.

## VerifierAgentSessionError

A Verifier Agent session did not produce a compound token. `kind` says why;
`retryable` is true only for `timeout` and `unavailable` — the session may
still complete, so poll again. Extends {@link TasraError}.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L118)

```ts
(kind: VerifierAgentSessionErrorKind, correlation: string, message: string, httpStatus?: number): VerifierAgentSessionError
```

Import: `import {VerifierAgentSessionError} from 'tasra-sdk'`

- `kind: VerifierAgentSessionErrorKind`
- `correlation: string` — The session id — safe to show and to log.
- `httpStatus: number &#124; undefined` — The HTTP status that produced a `protocol`/`unavailable` error, when there was one.
- `retryable: boolean` — `false` when retrying the identical request cannot succeed.
- `name: string`
- `message: string`
- `stack: string &#124; undefined`
- `cause: unknown`

## VerifierAgentSessionErrorKind

Why a session did not yield a token — the class the UI explains, with a NON-SECRET
correlation reference (the session id; the poll secret is never part of an error).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L101)

```ts
export type VerifierAgentSessionErrorKind =
  /** The deadline passed while the verifier-agent still reported `pending`. */
  | 'timeout'
  /** The verifier-agent reported `failed`: a verifier or the wallet refused (`error` says which). */
  | 'refused'
  /** The verifier-agent (or its store) could not answer — retry later, the session may still complete. */
  | 'unavailable'
  /** The verifier-agent answered something the contract does not allow (a malformed reply, 401/404). */
  | 'protocol'
  /** The caller's `AbortSignal` fired. */
  | 'cancelled'
```

## verifyDecryptShare

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/kem.ts#L245)

Import: `import {verifyDecryptShare} from 'tasra-sdk'`

```ts
declare function verifyDecryptShare(share: DecryptShare, u: Uint8Array): boolean
```

| Parameter | Type | Description |
|---|---|---|
| `share` | `DecryptShare` |  |
| `u` | `Uint8Array<ArrayBufferLike>` |  |

Returns: `boolean`.

## verifyFrostSignature

Verify a FROST-Ed25519 group signature: g^z == R + Y^c, where
c = H_chal(R, Y, len(msg), msg). Returns false on any malformed input.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/frost.ts#L188)

Import: `import {verifyFrostSignature} from 'tasra-sdk'`

```ts
declare function verifyFrostSignature(groupPublicKey: Uint8Array, message: Uint8Array, sig: FrostSignature): boolean
```

| Parameter | Type | Description |
|---|---|---|
| `groupPublicKey` | `Uint8Array<ArrayBufferLike>` |  |
| `message` | `Uint8Array<ArrayBufferLike>` |  |
| `sig` | `FrostSignature` |  |

Returns: `boolean`.

## verifyPresentation

Present credentials directly for a JWT. The `body` shape is defined by the
verifier (a DCQL rule + a presentation/credentials); we pass it through
untouched so this stays agnostic to the credential format.
POST {verifier}/v1/verify

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L180)

Import: `import {verifyPresentation} from 'tasra-sdk'`

```ts
declare function verifyPresentation(verifierUrl: string, body: { dcql_rule: string; presentation: unknown; credentials?: unknown; }): Promise<IssuedToken>
```

| Parameter | Type | Description |
|---|---|---|
| `verifierUrl` | `string` |  |
| `body` | `{ dcql_rule: string; presentation: unknown; credentials?: unknown; }` |  |

Returns: `Promise<IssuedToken>`.

## verifyVpJwt

The PRODUCTION credential path: present signed JWT-VCs + holder proof for a
DCQL-gated JWT. The verifier checks each credential's signature against its
configured trust anchor (by `iss`), that each `sub` equals `holder`, that
`holder_proof` proves live control of the holder DID authentication key, then
evaluates the rule. `credentials` are compact JWS strings (e.g. from
`tasra-cli vc issue`).
POST {verifier}/v1/verify-vp-jwt

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/verifier.ts#L201)

Import: `import {verifyVpJwt} from 'tasra-sdk'`

```ts
declare function verifyVpJwt(verifierUrl: string, body: { dcql_rule: string; holder: string; credentials: string[]; holder_proof: string; }): Promise<IssuedToken>
```

| Parameter | Type | Description |
|---|---|---|
| `verifierUrl` | `string` |  |
| `body` | `{ dcql_rule: string; holder: string; credentials: string[]; holder_proof: string; }` |  |

Returns: `Promise<IssuedToken>`.

## VpJwtAuth

The `vpJwt` auth mode's payload: signed VCs + a holder-key proof → JWT.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/client/client.ts#L48)

```ts
export interface VpJwtAuth {
  dcqlRule: string
  credentials: string[]
  holderProof: HolderProofAuth
}
```

## waitForSession

Poll until the session reaches a terminal state (done or failed) — bounded by
`timeoutMs`, with a growing jittered interval so many clients never poll in lock-step.
A transient `unavailable` answer (a 503, a dropped connection) is retried within the
deadline; a `protocol` answer stops at once; the deadline is a `timeout` error; the
caller's `signal` is a `cancelled` error. A terminal `failed` is RETURNED (the caller
decides how to explain it) — see `awaitVerifierAgentResult` for the version that throws `refused`.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L422)

Import: `import {waitForSession} from 'tasra-sdk'`

```ts
declare function waitForSession(verifierAgentUrl: string, sessionId: string, pollSecret: string, intervalMs?: number, timeoutMs?: number, opts?: WaitOpts): Promise<SessionStatusResult>
```

| Parameter | Type | Description |
|---|---|---|
| `verifierAgentUrl` | `string` |  |
| `sessionId` | `string` |  |
| `pollSecret` | `string` | - bearer token returned by \`createOid4vpSession\` |
| `intervalMs` | `number` | - initial polling interval in milliseconds (default 2000) |
| `timeoutMs` | `number` | - total deadline in milliseconds (default 300000 = 5 min) |
| `opts` | `WaitOpts` |  |

Returns: `Promise<SessionStatusResult>`.

## Constants and ABI values

| Export | Definition |
|---|---|
| `DCQL_MAX_RULE_LEN` | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L66) |
| `FORMAT_JWT_VC_JSON` | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/oid4vp.ts#L27) |
| `IBE_BLOB_DEFAULT_CHUNK` | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/ibe-blob.ts#L32) |
| `MAX_IDENTITY_LEN` | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/auth/identityScope.ts#L31) |
| `MAX_PLAINTEXT_LEN` | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/crypto/envelope.ts#L302) |
