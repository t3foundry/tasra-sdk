# tasra-sdk/oid4vp

Generated from public TypeScript exports.

[SDK reference](README.md) · [Task guides](../README.md) · [Errors](../errors.md)

## Classes

Clients, adapters and error classes.

<details>
<summary>Browse 1 classes</summary>

- [VerifierAgentSessionError](#verifieragentsessionerror)

</details>

### VerifierAgentSessionError

A Verifier Agent session did not produce a compound token. `kind` says why;
`retryable` is true only for `timeout` and `unavailable` - the session may
still complete, so poll again. Extends ` TasraError `.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L131)

Import: `import {VerifierAgentSessionError} from 'tasra-sdk/oid4vp'`

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
<summary>Browse 64 functions</summary>

- [assertCompoundTokenWire](#assertcompoundtokenwire)
- [awaitVerifierAgentResult](#awaitverifieragentresult)
- [b64url](#b64url)
- [b64urlDecode](#b64urldecode)
- [base58Decode](#base58decode)
- [base58Encode](#base58encode)
- [buildResponse](#buildresponse)
- [concatKdf](#concatkdf)
- [createOid4vpSession](#createoid4vpsession)
- [decodeJson](#decodejson)
- [decryptJwe](#decryptjwe)
- [decryptPayloadDigest](#decryptpayloaddigest)
- [defaultKeyResolver](#defaultkeyresolver)
- [derivedNonce](#derivednonce)
- [didJwk](#didjwk)
- [didJwkIssuer](#didjwkissuer)
- [didWebUrl](#didweburl)
- [disclosureDigest](#disclosuredigest)
- [ed25519DidKey](#ed25519didkey)
- [ed25519FromDidKey](#ed25519fromdidkey)
- [ed25519HolderKey](#ed25519holderkey)
- [encryptJwe](#encryptjwe)
- [fetchRequestObject](#fetchrequestobject)
- [fromUtf8](#fromutf8)
- [holderCnf](#holdercnf)
- [holderSigner](#holdersigner)
- [issueSdJwtVc](#issuesdjwtvc)
- [jwkFromDid](#jwkfromdid)
- [nextPollDelay](#nextpolldelay)
- [openVerifierAgentSession](#openverifieragentsession)
- [p256DidKey](#p256didkey)
- [p256DidKeyIssuer](#p256didkeyissuer)
- [p256HolderKey](#p256holderkey)
- [p256PublicJwk](#p256publicjwk)
- [parseCredentialOfferUri](#parsecredentialofferuri)
- [parseOpenid4vpUri](#parseopenid4vpuri)
- [parseSdJwt](#parsesdjwt)
- [payloadDigest](#payloaddigest)
- [payloadDigestFor](#payloaddigestfor)
- [peekSdJwt](#peeksdjwt)
- [planPresentation](#planpresentation)
- [pollOid4vpSession](#polloid4vpsession)
- [presentationOperationTypedData](#presentationoperationtypeddata)
- [presentSdJwt](#presentsdjwt)
- [presentToRequestUri](#presenttorequesturi)
- [randomHolderKey](#randomholderkey)
- [receiveCredential](#receivecredential)
- [requestedClaimNames](#requestedclaimnames)
- [requestHash](#requesthash)
- [resolveDidWeb](#resolvedidweb)
- [responseEncryptionKey](#responseencryptionkey)
- [sdHash](#sdhash)
- [sdJwtClaims](#sdjwtclaims)
- [sdJwtCredentialView](#sdjwtcredentialview)
- [signCompactJws](#signcompactjws)
- [submitResponse](#submitresponse)
- [utf8](#utf8)
- [verificationKey](#verificationkey)
- [verifierAgentResult](#verifieragentresult)
- [verifierAgentVerifierProofs](#verifieragentverifierproofs)
- [verifyCompactJws](#verifycompactjws)
- [verifyKbJwt](#verifykbjwt)
- [verifyRequestObject](#verifyrequestobject)
- [waitForSession](#waitforsession)

</details>

### assertCompoundTokenWire

The compound token the verifier-agent hands back must be the wire shape the keepers verify -
 checked field by field before anything is built on it.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L159)

Import: `import {assertCompoundTokenWire} from 'tasra-sdk/oid4vp'`

```ts
declare function assertCompoundTokenWire(raw: unknown, correlation: string): Record<string, unknown>;
```

| Parameter | Type | Description |
|---|---|---|
| ` raw ` | ` unknown ` | - Untrusted compound_token response value. |
| ` correlation ` | ` string ` | - Session identifier used to correlate validation errors. |

Returns: ` Record<string, unknown> `.

### awaitVerifierAgentResult

Poll until the wallet has presented and the committee answered. Rejects with an
`VerifierAgentSessionError` whose `kind` the UI explains - `refused` (the verifier-agent's `error` names the
refusing side), `timeout`, `unavailable`, `protocol`, `cancelled` - and whose
`correlation` is the session id. A token that binds another request than this session
opened, or one whose proofs are malformed, is a `protocol` refusal: nothing is built on it.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/verifier-agent.ts#L190)

Import: `import {awaitVerifierAgentResult} from 'tasra-sdk/oid4vp'`

```ts
declare function awaitVerifierAgentResult(session: Pick<OpenedVerifierAgentSession, 'verifierAgentUrl' | 'sessionId' | 'pollSecret' | 'requestHash'>, opts?: {
    intervalMs?: number;
    timeoutMs?: number;
} & WaitOpts): Promise<VerifierAgentResult>;
```

| Parameter | Type | Description |
|---|---|---|
| ` session ` | ` Pick<OpenedVerifierAgentSession, 'verifierAgentUrl' \| 'sessionId' \| 'pollSecret' \| 'requestHash'> ` | - Opened session credentials and expected request-binding hash. |
| ` opts? ` | ` { intervalMs?: number; timeoutMs?: number; } & WaitOpts ` | - Polling intervals, timeout, cancellation and progress callback. |

Returns: ` Promise<VerifierAgentResult> `.

### b64url

Encode bytes or UTF-8 text as unpadded base64url.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L28)

Import: `import {b64url} from 'tasra-sdk/oid4vp'`

```ts
declare function b64url(bytes: Uint8Array | string): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` bytes ` | ` Uint8Array \| string ` | - Raw bytes, or text encoded as UTF-8 before conversion. |

Returns: ` string `.

### b64urlDecode

Decode base64url text into bytes.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L39)

Import: `import {b64urlDecode} from 'tasra-sdk/oid4vp'`

```ts
declare function b64urlDecode(s: string): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` s ` | ` string ` | - Base64url-encoded text, with optional padding. |

Returns: ` Uint8Array `.

### base58Decode

Decode base58btc text, preserving leading zero bytes and rejecting invalid characters.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L173)

Import: `import {base58Decode} from 'tasra-sdk/oid4vp'`

```ts
declare function base58Decode(s: string): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` s ` | ` string ` | - Base58btc text to decode. |

Returns: ` Uint8Array `.

### base58Encode

Encode bytes as base58btc, preserving leading zero bytes.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L154)

Import: `import {base58Encode} from 'tasra-sdk/oid4vp'`

```ts
declare function base58Encode(bytes: Uint8Array): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` bytes ` | ` Uint8Array ` | - Bytes to encode, including any leading zeros. |

Returns: ` string `.

### buildResponse

Bind the chosen credential to the request (KB-JWT) and wrap it as the verifier-agent expects it.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/wallet.ts#L119)

Import: `import {buildResponse} from 'tasra-sdk/oid4vp'`

```ts
declare function buildResponse(opts: BuildResponseOpts): BuiltResponse;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` BuildResponseOpts ` | - Verified request, chosen credential, holder key and disclosure settings. |

Returns: ` BuiltResponse `.

### concatKdf

Concat KDF (NIST SP 800-56A, single-pass SHA-256) - AlgorithmID = `enc` for ECDH-ES direct.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jwe.ts#L33)

Import: `import {concatKdf} from 'tasra-sdk/oid4vp'`

```ts
declare function concatKdf(z: Uint8Array, alg: string, apu: Uint8Array, apv: Uint8Array, keyLen: number): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` z ` | ` Uint8Array ` | - ECDH shared secret bytes. |
| ` alg ` | ` string ` | - Algorithm identifier included in the KDF context. |
| ` apu ` | ` Uint8Array ` | - Producer party information. |
| ` apv ` | ` Uint8Array ` | - Recipient party information. |
| ` keyLen ` | ` number ` | - Derived key length in bytes. |

Returns: ` Uint8Array `.

### createOid4vpSession

Create an OID4VP session on the Verifier Agent.

The verifier-agent derives a nonce, generates an ECDH key for JWE, and returns a QR
payload the wallet scans. The session ID and poll secret are used to poll
for the result.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L221)

Import: `import {createOid4vpSession} from 'tasra-sdk/oid4vp'`

```ts
declare function createOid4vpSession(verifierAgentUrl: string, params: CreateSessionParams): Promise<CreateSessionResult>;
```

| Parameter | Type | Description |
|---|---|---|
| ` verifierAgentUrl ` | ` string ` | - Verifier-agent HTTP base URL from the selected network manifest. |
| ` params ` | ` CreateSessionParams ` | - Signed operation, optional delegation and raw payload. |

Returns: ` Promise<CreateSessionResult> `.

### decodeJson

Decode a base64url JSON value. The generic type is a caller assertion, not runtime validation.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L48)

Import: `import {decodeJson} from 'tasra-sdk/oid4vp'`

```ts
declare function decodeJson<T = unknown>(b64: string): T;
```

| Parameter | Type | Description |
|---|---|---|
| ` b64 ` | ` string ` | - Base64url-encoded JSON text. |

Returns: ` T `.

### decryptJwe

Decrypt a compact JWE produced by [encryptJwe](#encryptjwe) (or a wallet) with the recipient's private scalar.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jwe.ts#L80)

Import: `import {decryptJwe} from 'tasra-sdk/oid4vp'`

```ts
declare function decryptJwe(compact: string, recipientPrivateKey: Uint8Array): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` compact ` | ` string ` | - Compact JWE using ECDH-ES and a supported AES-GCM algorithm. |
| ` recipientPrivateKey ` | ` Uint8Array ` | - Recipient 32-byte P-256 private scalar. |

Returns: ` string `.

### decryptPayloadDigest

The `decrypt` action's digest, mirroring the reference decrypt digest:
`sha256(DOMAIN || len(u) u64 LE || u || len(aead_ct) u64 LE || aead_ct)` - the AEAD nonce is
deliberately excluded (it is not authorised content).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/binding.ts#L149)

Import: `import {decryptPayloadDigest} from 'tasra-sdk/oid4vp'`

```ts
declare function decryptPayloadDigest(u: Uint8Array, aeadCt: Uint8Array): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` u ` | ` Uint8Array ` | - Ephemeral public key bytes from the group ciphertext. |
| ` aeadCt ` | ` Uint8Array ` | - Authenticated ciphertext bytes, including the tag. |

Returns: ` Uint8Array `.

### defaultKeyResolver

Create a signing-key resolver that fetches did:web keys and decodes did:key or did:jwk keys.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/request-object.ts#L85)

Import: `import {defaultKeyResolver} from 'tasra-sdk/oid4vp'`

```ts
declare function defaultKeyResolver(opts?: ResolveOpts): KeyResolver;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts? ` | ` ResolveOpts ` | - Fetch override and optional loopback HTTP permission. |

Returns: ` KeyResolver `.

### derivedNonce

`base64url(keccak256(NONCE_DOMAIN || request_hash || random || epoch u64 BE || snapshot_root ||
registry_size u32 BE || committee u32 BE || quorum u32 BE || operation_exp i64 BE))` - the
nonce a KB-JWT must carry (the reference vp-nonce derivation, domain v2).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/binding.ts#L89)

Import: `import {derivedNonce} from 'tasra-sdk/oid4vp'`

```ts
declare function derivedNonce(reqHash: Uint8Array, random: Uint8Array, ctx: NonceContext): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` reqHash ` | ` Uint8Array ` | - 32-byte request-binding hash. |
| ` random ` | ` Uint8Array ` | - 32 fresh random bytes. |
| ` ctx ` | ` NonceContext ` | - Beacon epoch, verifier snapshot, committee policy and operation expiry to bind. |

Returns: ` string `.

### didJwk

`did:jwk` of a JWK - the JSON is serialised in `kty, crv, x, y` order, the vault's convention.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L118)

Import: `import {didJwk} from 'tasra-sdk/oid4vp'`

```ts
declare function didJwk(jwk: Jwk): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` jwk ` | ` Jwk ` | - Public P-256 or Ed25519 JSON Web Key. |

Returns: ` string `.

### didJwkIssuer

A P-256/ES256 `did:jwk` issuer from a private scalar. Other issuer algorithms are not supported by this helper.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L217)

Import: `import {didJwkIssuer} from 'tasra-sdk/oid4vp'`

```ts
declare function didJwkIssuer(privateKey: Uint8Array, alg?: 'ES256'): SdJwtIssuer;
```

| Parameter | Type | Description |
|---|---|---|
| ` privateKey ` | ` Uint8Array ` | - 32-byte P-256 private scalar. |
| ` alg? ` | ` 'ES256' ` | - Signing algorithm; this helper accepts only ES256. |

Returns: ` SdJwtIssuer `.

### didWebUrl

The HTTPS URL a `did:web` resolves from (W3C did:web method).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/did-web.ts#L23)

Import: `import {didWebUrl} from 'tasra-sdk/oid4vp'`

```ts
declare function didWebUrl(did: string): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` did ` | ` string ` | - did:web identifier, with an optional fragment. |

Returns: ` string `.

### disclosureDigest

Compute the base64url SHA-256 digest of an encoded SD-JWT disclosure.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L48)

Import: `import {disclosureDigest} from 'tasra-sdk/oid4vp'`

```ts
declare function disclosureDigest(encoded: string): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` encoded ` | ` string ` | - Base64url-encoded SD-JWT disclosure string. |

Returns: ` string `.

### ed25519DidKey

`did:key` of an Ed25519 public key (multicodec 0xed01).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L198)

Import: `import {ed25519DidKey} from 'tasra-sdk/oid4vp'`

```ts
declare function ed25519DidKey(publicKey: Uint8Array): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` publicKey ` | ` Uint8Array ` | - 32-byte Ed25519 public key. |

Returns: ` string `.

### ed25519FromDidKey

The 32-byte Ed25519 key inside a `did:key:z6Mk...`; throws for any other key type.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L215)

Import: `import {ed25519FromDidKey} from 'tasra-sdk/oid4vp'`

```ts
declare function ed25519FromDidKey(did: string): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` did ` | ` string ` | - Ed25519 did:key identifier. |

Returns: ` Uint8Array `.

### ed25519HolderKey

An Ed25519 holder key from a 32-byte seed - the shape `tasra-cli vc issue-sd-jwt` binds.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L137)

Import: `import {ed25519HolderKey} from 'tasra-sdk/oid4vp'`

```ts
declare function ed25519HolderKey(seed: Uint8Array): HolderKey;
```

| Parameter | Type | Description |
|---|---|---|
| ` seed ` | ` Uint8Array ` | - 32-byte Ed25519 secret seed. |

Returns: ` HolderKey `.

### encryptJwe

Encrypt `plaintext` to the recipient's ephemeral P-256 JWK (the JAR's `client_metadata.jwks.keys[0]`)
as `header..iv.ciphertext.tag`. A fresh sender key per call; `kid` echoed when the recipient key has one.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jwe.ts#L58)

Import: `import {encryptJwe} from 'tasra-sdk/oid4vp'`

```ts
declare function encryptJwe(plaintext: string, recipient: EcJwk, enc?: JweEnc, random?: (n: number) => Uint8Array): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` plaintext ` | ` string ` | - UTF-8 plaintext to encrypt. |
| ` recipient ` | ` EcJwk ` | - Recipient public P-256 key. |
| ` enc? ` | ` JweEnc ` | - AES-GCM content encryption algorithm. |
| ` random? ` | ` (n: number) => Uint8Array ` | - Cryptographically secure random byte generator; defaults to Web Crypto. |

Returns: ` string `.

### fetchRequestObject

Fetch a JAR from `request_uri` (`Accept: application/oauth-authz-req+jwt`) and verify it.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/request-object.ts#L149)

Import: `import {fetchRequestObject} from 'tasra-sdk/oid4vp'`

```ts
declare function fetchRequestObject(requestUri: string, opts?: VerifyRequestObjectOpts & {
    fetchImpl?: typeof fetch;
}): Promise<VerifiedRequestObject>;
```

| Parameter | Type | Description |
|---|---|---|
| ` requestUri ` | ` string ` | - URL from the OpenID4VP request_uri parameter. |
| ` opts? ` | ` VerifyRequestObjectOpts & { fetchImpl?: typeof fetch; } ` | - Request signature verification settings and optional fetch implementation. |

Returns: ` Promise<VerifiedRequestObject> `.

### fromUtf8

Decode UTF-8 bytes into text using replacement characters for invalid sequences.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L21)

Import: `import {fromUtf8} from 'tasra-sdk/oid4vp'`

```ts
declare function fromUtf8(b: Uint8Array): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` b ` | ` Uint8Array ` | - UTF-8 bytes to decode. |

Returns: ` string `.

### holderCnf

The `cnf` a holder key binds to: `{kid: "<did:jwk>#0"}`, exactly as the Hovi wallet presents.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L193)

Import: `import {holderCnf} from 'tasra-sdk/oid4vp'`

```ts
declare function holderCnf(holder: Pick<HolderKey, 'did'>): {
    kid: string;
};
```

| Parameter | Type | Description |
|---|---|---|
| ` holder ` | ` Pick<HolderKey, 'did'> ` | - Holder did:jwk identifier to reference in the credential binding. |

Returns:

```ts
{
    kid: string;
}
```

### holderSigner

How to sign for this holder. P-256 keys sign ES256, Ed25519 keys EdDSA - a credential is bound to
one key, and the KB-JWT it is presented with has to be signed by that key's own algorithm. Issuers
outside the P-256 profile exist: `tasra-cli vc issue-sd-jwt` binds an Ed25519 holder key.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L100)

Import: `import {holderSigner} from 'tasra-sdk/oid4vp'`

```ts
declare function holderSigner(holder: HolderKey): JwsSigner;
```

| Parameter | Type | Description |
|---|---|---|
| ` holder ` | ` HolderKey ` | - Holder private key and public JWK identifying its signing algorithm. |

Returns: ` JwsSigner `.

### issueSdJwtVc

Mint a compact SD-JWT VC `issuer~d1~...~` with one disclosure per selectively disclosable claim.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L158)

Import: `import {issueSdJwtVc} from 'tasra-sdk/oid4vp'`

```ts
declare function issueSdJwtVc(opts: IssueSdJwtVcOpts): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` IssueSdJwtVcOpts ` | - Issuer key, claim values, holder binding and credential lifetime. |

Returns: ` string `.

### jwkFromDid

The public JWK inside a `did:jwk` or a `did:key` (Ed25519 / P-256); a `#fragment` is ignored.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L228)

Import: `import {jwkFromDid} from 'tasra-sdk/oid4vp'`

```ts
declare function jwkFromDid(did: string): Jwk;
```

| Parameter | Type | Description |
|---|---|---|
| ` did ` | ` string ` | - P-256 or Ed25519 did:key or did:jwk identifier; an optional fragment is ignored. |

Returns: ` Jwk `.

### nextPollDelay

The next polling delay: geometric growth (times1.5) capped at `max`, plus or minus20 % full jitter.
 Pure, so the schedule is testable without timers.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L437)

Import: `import {nextPollDelay} from 'tasra-sdk/oid4vp'`

```ts
declare function nextPollDelay(previousMs: number, baseMs: number, maxMs: number, random?: () => number): number;
```

| Parameter | Type | Description |
|---|---|---|
| ` previousMs ` | ` number ` | - Previous polling delay in milliseconds, or zero before the first poll. |
| ` baseMs ` | ` number ` | - Initial polling interval in milliseconds. |
| ` maxMs ` | ` number ` | - Maximum interval before jitter is applied. |
| ` random? ` | ` () => number ` | - Random source returning a value between zero and one. |

Returns: ` number `.

### openVerifierAgentSession

Sign the operation and open a session; hand `qrPayload` to the wallet.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/verifier-agent.ts#L138)

Import: `import {openVerifierAgentSession} from 'tasra-sdk/oid4vp'`

```ts
declare function openVerifierAgentSession(opts: OpenVerifierAgentSessionOpts): Promise<OpenedVerifierAgentSession>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` OpenVerifierAgentSessionOpts ` | - Operation details, signing wallet and verifier-agent endpoint. |

Returns: ` Promise<OpenedVerifierAgentSession> `.

### p256DidKey

`did:key` of a P-256 public key (multicodec 0x1200 to varint `80 24`, compressed point) - Hovi's issuer shape.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L206)

Import: `import {p256DidKey} from 'tasra-sdk/oid4vp'`

```ts
declare function p256DidKey(publicKeyUncompressedOrCompressed: Uint8Array): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` publicKeyUncompressedOrCompressed ` | ` Uint8Array ` | - SEC1-encoded P-256 public key in compressed or uncompressed form. |

Returns: ` string `.

### p256DidKeyIssuer

A P-256 issuer as `did:key` (Hovi Studio's issuer shape) from a private scalar.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L203)

Import: `import {p256DidKeyIssuer} from 'tasra-sdk/oid4vp'`

```ts
declare function p256DidKeyIssuer(privateKey: Uint8Array, opts?: {
    fragmentKid?: boolean;
}): SdJwtIssuer;
```

| Parameter | Type | Description |
|---|---|---|
| ` privateKey ` | ` Uint8Array ` | - 32-byte P-256 private scalar. |
| ` opts? ` | ` { fragmentKid?: boolean; } ` | - Whether kid should contain only the DID fragment. |

Returns: ` SdJwtIssuer `.

### p256HolderKey

Construct a holder identity from a 32-byte P-256 private scalar.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L127)

Import: `import {p256HolderKey} from 'tasra-sdk/oid4vp'`

```ts
declare function p256HolderKey(privateKey: Uint8Array): HolderKey;
```

| Parameter | Type | Description |
|---|---|---|
| ` privateKey ` | ` Uint8Array ` | - 32-byte P-256 private scalar. |

Returns: ` HolderKey `.

### p256PublicJwk

Derive a public P-256 JSON Web Key from a private scalar.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L109)

Import: `import {p256PublicJwk} from 'tasra-sdk/oid4vp'`

```ts
declare function p256PublicJwk(privateKey: Uint8Array): EcJwk;
```

| Parameter | Type | Description |
|---|---|---|
| ` privateKey ` | ` Uint8Array ` | - 32-byte P-256 private scalar. |

Returns: ` EcJwk `.

### parseCredentialOfferUri

Parse an `openid-credential-offer://?credential_offer=...` or `...?credential_offer_uri=...` URI.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/oid4vci.ts#L27)

Import: `import {parseCredentialOfferUri} from 'tasra-sdk/oid4vp'`

```ts
declare function parseCredentialOfferUri(uri: string): {
    offer?: CredentialOffer;
    offerUri?: string;
};
```

| Parameter | Type | Description |
|---|---|---|
| ` uri ` | ` string ` | - OpenID4VCI credential-offer URI containing an offer or offer URL. |

Returns:

```ts
{
    offer?: CredentialOffer;
    offerUri?: string;
}
```

### parseOpenid4vpUri

`openid4vp://?client_id=...&request_uri=...` (a QR payload or deep link) to its two parameters.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/request-object.ts#L69)

Import: `import {parseOpenid4vpUri} from 'tasra-sdk/oid4vp'`

```ts
declare function parseOpenid4vpUri(uri: string): {
    clientId?: string;
    requestUri: string;
};
```

| Parameter | Type | Description |
|---|---|---|
| ` uri ` | ` string ` | - Wallet deep link or QR payload containing request_uri. |

Returns:

```ts
{
    clientId?: string;
    requestUri: string;
}
```

### parseSdJwt

Parse a compact SD-JWT and check each disclosed claim against the issuer payload's disclosure hashes. This does not verify the issuer signature.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L64)

Import: `import {parseSdJwt} from 'tasra-sdk/oid4vp'`

```ts
declare function parseSdJwt(compact: string): ParsedSdJwt;
```

| Parameter | Type | Description |
|---|---|---|
| ` compact ` | ` string ` | - Compact SD-JWT credential or presentation. |

Returns: ` ParsedSdJwt `.

### payloadDigest

Compute the `payload_digest` for a given action and message.

For `sign` and `ibe-extract`, this is `sha256(message_bytes)` as 0x-hex.
Other actions should supply the digest directly.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L198)

Import: `import {payloadDigest} from 'tasra-sdk/oid4vp'`

```ts
declare function payloadDigest(action: string, messageHex: string): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` action ` | ` string ` | - Operation name: sign and ibe-extract hash the supplied bytes. |
| ` messageHex ` | ` string ` | - Hexadecimal message bytes or an already computed digest for other actions. |

Returns: ` string `.

### payloadDigestFor

The per-action `payload_digest` the keeper recomputes at `enforce_request_binding`:
`sign` = sha256(message), `ibe-extract` = sha256(identity), `decrypt` = the ciphertext
digest ([decryptPayloadDigest](#decryptpayloaddigest)), `dual-approve` = the digest the caller already
holds. Pass exactly one of the inputs the action needs.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/binding.ts#L119)

Import: `import {payloadDigestFor} from 'tasra-sdk/oid4vp'`

```ts
declare function payloadDigestFor(action: CommitteeAction, args: {
    message?: Uint8Array;
    identity?: string;
    payloadDigest?: Uint8Array;
}): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` action ` | ` CommitteeAction ` | - Operation whose payload will be bound. |
| ` args ` | ` { message?: Uint8Array; identity?: string; payloadDigest?: Uint8Array; } ` | - Message, identity or precomputed digest required by that operation. |

Returns: ` Uint8Array `.

### peekSdJwt

Decode (no verification) the issuer JWT's payload of a compact SD-JWT - for display.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L295)

Import: `import {peekSdJwt} from 'tasra-sdk/oid4vp'`

```ts
declare function peekSdJwt(compact: string): {
    iss?: string;
    vct?: string;
    exp?: number;
    sub?: string;
};
```

| Parameter | Type | Description |
|---|---|---|
| ` compact ` | ` string ` | - Compact SD-JWT credential or presentation to inspect without signature verification. |

Returns:

```ts
{
    iss?: string;
    vct?: string;
    exp?: number;
    sub?: string;
}
```

### planPresentation

Match held SD-JWT VCs against the request's `dcql_query`. Expired credentials are skipped.
Advisory: the drawn verifiers decide; a wrong local answer costs a wasted request, never access.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/wallet.ts#L50)

Import: `import {planPresentation} from 'tasra-sdk/oid4vp'`

```ts
declare function planPresentation(ro: Pick<VerifiedRequestObject, 'claims'>, held: readonly HeldSdJwt[], nowSecs?: number): PresentationPlan;
```

| Parameter | Type | Description |
|---|---|---|
| ` ro ` | ` Pick<VerifiedRequestObject, 'claims'> ` | - Verified request claims containing the DCQL query. |
| ` held ` | ` readonly HeldSdJwt[] ` | - Held SD-JWT credentials to consider. |
| ` nowSecs? ` | ` number ` | - Current time in Unix seconds for excluding expired credentials. |

Returns: ` PresentationPlan `.

### pollOid4vpSession

Fetch and validate one authorization session status. Transport failures and HTTP 502, 503 or 504 produce an unavailable error; malformed or other failed replies produce a protocol error. The polling secret is sent in the Authorization header.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L364)

Import: `import {pollOid4vpSession} from 'tasra-sdk/oid4vp'`

```ts
declare function pollOid4vpSession(verifierAgentUrl: string, sessionId: string, pollSecret: string): Promise<SessionStatusResult>;
```

| Parameter | Type | Description |
|---|---|---|
| ` verifierAgentUrl ` | ` string ` | - Verifier-agent HTTP base URL. |
| ` sessionId ` | ` string ` | - Opened session identifier. |
| ` pollSecret ` | ` string ` | - Secret returned at session creation; do not expose it in logs. |

Returns: ` Promise<SessionStatusResult> `.

### presentationOperationTypedData

The typed data a creator (or delegate) signs, plus the wire operation and the verifier-agent's `message_hex`.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/verifier-agent.ts#L78)

Import: `import {presentationOperationTypedData} from 'tasra-sdk/oid4vp'`

```ts
declare function presentationOperationTypedData(input: OperationInput): {
    typedData: Parameters<TypedDataSigner['signTypedData']>[0];
    operation: PresentationOperation;
    messageHex: string;
    payloadDigest: Uint8Array;
};
```

| Parameter | Type | Description |
|---|---|---|
| ` input ` | ` OperationInput ` | - Network, slot, operation payload, description and authorization lifetime. |

Returns:

```ts
{
    typedData: Parameters<TypedDataSigner['signTypedData']>[0];
    operation: PresentationOperation;
    messageHex: string;
    payloadDigest: Uint8Array;
}
```

### presentSdJwt

Build the presentation `issuer~selected...~kb-jwt`, the KB-JWT signed by the holder's own key.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L248)

Import: `import {presentSdJwt} from 'tasra-sdk/oid4vp'`

```ts
declare function presentSdJwt(opts: PresentSdJwtOpts): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` PresentSdJwtOpts ` | - Parsed credential, disclosure selection, holder key, nonce and audience. |

Returns: ` string `.

### presentToRequestUri

The whole wallet flow for one QR / deep link: fetch + verify the JAR, plan, let the caller
choose (consent screen), bind, encrypt, POST.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/wallet.ts#L171)

Import: `import {presentToRequestUri} from 'tasra-sdk/oid4vp'`

```ts
declare function presentToRequestUri(requestUriOrOpenid4vp: string, held: readonly HeldSdJwt[], holder: HolderKey, opts?: PresentOpts): Promise<{
    ro: VerifiedRequestObject;
    plan: PresentationPlan;
    built: BuiltResponse;
    redirectUri?: string;
}>;
```

| Parameter | Type | Description |
|---|---|---|
| ` requestUriOrOpenid4vp ` | ` string ` | - Request-object URL or OpenID4VP deep link. |
| ` held ` | ` readonly HeldSdJwt[] ` | - Held SD-JWT credentials available for selection. |
| ` holder ` | ` HolderKey ` | - Holder key that matches the selected credential binding. |
| ` opts? ` | ` PresentOpts ` | - Verification, consent selection and disclosure settings. |

Returns:

```ts
Promise<{
    ro: VerifiedRequestObject;
    plan: PresentationPlan;
    built: BuiltResponse;
    redirectUri?: string;
}>
```

### randomHolderKey

Generate a random P-256 holder key and its did:jwk identifier.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L143)

Import: `import {randomHolderKey} from 'tasra-sdk/oid4vp'`

```ts
declare function randomHolderKey(): HolderKey;
```

Returns: ` HolderKey `.

### receiveCredential

Run the pre-authorized code flow end to end and return the issued credential.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/oid4vci.ts#L92)

Import: `import {receiveCredential} from 'tasra-sdk/oid4vp'`

```ts
declare function receiveCredential(opts: ReceiveCredentialOpts): Promise<ReceivedCredential>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` ReceiveCredentialOpts ` | - Credential offer, holder key, optional transaction code and transport settings. |

Returns: ` Promise<ReceivedCredential> `.

### requestedClaimNames

The top-level claim names a credential query asks to see.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/wallet.ts#L81)

Import: `import {requestedClaimNames} from 'tasra-sdk/oid4vp'`

```ts
declare function requestedClaimNames(query: Query, queryId: string): string[];
```

| Parameter | Type | Description |
|---|---|---|
| ` query ` | ` Query ` | - Parsed DCQL query. |
| ` queryId ` | ` string ` | - Identifier of the credential query to inspect. |

Returns: ` string[] `.

### requestHash

`keccak256(DOMAIN || chain_id u64 BE || slot_id || len(action) u32 BE || action || payload_digest)` -
the ONE binding hash the verifier-agent, the JAR signer, every drawn verifier, the keeper, the
accountant audit and this SDK compute. The wallet's request body is deliberately NOT in it.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/binding.ts#L51)

Import: `import {requestHash} from 'tasra-sdk/oid4vp'`

```ts
declare function requestHash(chainId: number | bigint, slotId: Uint8Array, action: CommitteeAction, payloadDigest: Uint8Array): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` chainId ` | ` number \| bigint ` | - EVM chain identifier. |
| ` slotId ` | ` Uint8Array ` | - 32-byte slot identifier. |
| ` action ` | ` CommitteeAction ` | - Operation name bound into the request. |
| ` payloadDigest ` | ` Uint8Array ` | - 32-byte action-specific payload digest. |

Returns: ` Uint8Array `.

### resolveDidWeb

Fetch and minimally validate a `did:web` document.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/did-web.ts#L46)

Import: `import {resolveDidWeb} from 'tasra-sdk/oid4vp'`

```ts
declare function resolveDidWeb(did: string, opts?: ResolveOpts): Promise<DidDocument>;
```

| Parameter | Type | Description |
|---|---|---|
| ` did ` | ` string ` | - did:web identifier to resolve. |
| ` opts? ` | ` ResolveOpts ` | - Fetch override and optional loopback HTTP permission. |

Returns: ` Promise<DidDocument> `.

### responseEncryptionKey

The ephemeral P-256 key the wallet must encrypt its response to, when the verifier-agent served one.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/request-object.ts#L138)

Import: `import {responseEncryptionKey} from 'tasra-sdk/oid4vp'`

```ts
declare function responseEncryptionKey(ro: Pick<VerifiedRequestObject, 'claims'>): EcJwk | undefined;
```

| Parameter | Type | Description |
|---|---|---|
| ` ro ` | ` Pick<VerifiedRequestObject, 'claims'> ` | - Verified request claims containing optional recipient encryption keys. |

Returns: ` EcJwk | undefined `.

### sdHash

`base64url(sha256(prefix))` where `prefix` is everything before the KB-JWT, trailing `~` included.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L114)

Import: `import {sdHash} from 'tasra-sdk/oid4vp'`

```ts
declare function sdHash(prefix: string): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` prefix ` | ` string ` | - Presentation prefix before the key-binding JWT, including the trailing tilde. |

Returns: ` string `.

### sdJwtClaims

The credential's claims as the verifier sees them: plain payload claims + disclosed ones.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L88)

Import: `import {sdJwtClaims} from 'tasra-sdk/oid4vp'`

```ts
declare function sdJwtClaims(parsed: ParsedSdJwt): Record<string, unknown>;
```

| Parameter | Type | Description |
|---|---|---|
| ` parsed ` | ` ParsedSdJwt ` | - Parsed credential with disclosure hashes already checked. |

Returns: ` Record<string, unknown> `.

### sdJwtCredentialView

A ` CredentialView ` for the DCQL evaluator: format `dc+sd-jwt`, `types` = [`vct`].

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L103)

Import: `import {sdJwtCredentialView} from 'tasra-sdk/oid4vp'`

```ts
declare function sdJwtCredentialView(parsed: ParsedSdJwt): CredentialView;
```

| Parameter | Type | Description |
|---|---|---|
| ` parsed ` | ` ParsedSdJwt ` | - Parsed credential to expose for advisory DCQL matching. |

Returns: ` CredentialView `.

### signCompactJws

Sign a JSON payload as compact JWS. Set the header algorithm from the supplied signer.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L262)

Import: `import {signCompactJws} from 'tasra-sdk/oid4vp'`

```ts
declare function signCompactJws(header: Record<string, unknown>, payload: Record<string, unknown>, signer: JwsSigner): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` header ` | ` Record<string, unknown> ` | - JOSE header fields; the signer determines alg. |
| ` payload ` | ` Record<string, unknown> ` | - JSON claims to sign. |
| ` signer ` | ` JwsSigner ` | - Private key and supported JWS algorithm. |

Returns: ` string `.

### submitResponse

POST the built response to `response_uri`; returns the verifier-agent's `redirect_uri` when it gives one.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/wallet.ts#L141)

Import: `import {submitResponse} from 'tasra-sdk/oid4vp'`

```ts
declare function submitResponse(ro: Pick<VerifiedRequestObject, 'claims'>, built: Pick<BuiltResponse, 'form'>, fetchImpl?: typeof fetch): Promise<{
    redirectUri?: string;
}>;
```

| Parameter | Type | Description |
|---|---|---|
| ` ro ` | ` Pick<VerifiedRequestObject, 'claims'> ` | - Verified request containing the response endpoint. |
| ` built ` | ` Pick<BuiltResponse, 'form'> ` | - Built form fields to submit. |
| ` fetchImpl? ` | ` typeof fetch ` | - HTTP transport; defaults to the global fetch implementation. |

Returns:

```ts
Promise<{
    redirectUri?: string;
}>
```

### utf8

Encode text as UTF-8 bytes.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L15)

Import: `import {utf8} from 'tasra-sdk/oid4vp'`

```ts
declare function utf8(s: string): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` s ` | ` string ` | - Text to encode. |

Returns: ` Uint8Array `.

### verificationKey

The JWK behind `kid` (a full DID URL or a `#fragment`) in `doc`.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/did-web.ts#L63)

Import: `import {verificationKey} from 'tasra-sdk/oid4vp'`

```ts
declare function verificationKey(doc: DidDocument, kid: string): Jwk;
```

| Parameter | Type | Description |
|---|---|---|
| ` doc ` | ` DidDocument ` | - Resolved DID document containing public verification methods. |
| ` kid ` | ` string ` | - Signing key identifier or fragment to locate. |

Returns: ` Jwk `.

### verifierAgentResult

Validate request binding and proof encoding after either URL or registered-session polling.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/verifier-agent.ts#L202)

Import: `import {verifierAgentResult} from 'tasra-sdk/oid4vp'`

```ts
declare function verifierAgentResult(session: Pick<OpenedVerifierAgentSession, 'sessionId' | 'requestHash'>, r: SessionStatusResult): VerifierAgentResult;
```

| Parameter | Type | Description |
|---|---|---|
| ` session ` | ` Pick<OpenedVerifierAgentSession, 'sessionId' \| 'requestHash'> ` | - Session identifier and expected request-binding hash. |
| ` r ` | ` SessionStatusResult ` | - Completed session status to validate and decode. |

Returns: ` VerifierAgentResult `.

### verifierAgentVerifierProofs

The verifier-agent's `verifier_proofs` DTO (`{verifier_index, operator, pubkey, proof}`) to the SDK shape.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/verifier-agent.ts#L165)

Import: `import {verifierAgentVerifierProofs} from 'tasra-sdk/oid4vp'`

```ts
declare function verifierAgentVerifierProofs(raw: unknown): VerifierProof[] | undefined;
```

| Parameter | Type | Description |
|---|---|---|
| ` raw ` | ` unknown ` | - Verifier-agent verifier_proofs response value. |

Returns: ` VerifierProof[] | undefined `.

### verifyCompactJws

Verify a compact JWS under `jwk` and return its decoded payload; throws on any failure.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L277)

Import: `import {verifyCompactJws} from 'tasra-sdk/oid4vp'`

```ts
declare function verifyCompactJws<T = Record<string, unknown>>(jws: string, jwk: Jwk): {
    header: Record<string, unknown>;
    payload: T;
};
```

| Parameter | Type | Description |
|---|---|---|
| ` jws ` | ` string ` | - Compact JWS to verify. |
| ` jwk ` | ` Jwk ` | - Public JSON Web Key trusted by the caller for this signature. |

Returns:

```ts
{
    header: Record<string, unknown>;
    payload: T;
}
```

### verifyKbJwt

Verify the holder signature, presentation hash, nonce and audience of a key-binding JWT. This does not verify the issuer signature, credential lifetime or issuer trust.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L272)

Import: `import {verifyKbJwt} from 'tasra-sdk/oid4vp'`

```ts
declare function verifyKbJwt(presentation: string, expected: {
    nonce: string;
    aud: string;
}): {
    holderJwk: Jwk;
    claims: Record<string, unknown>;
};
```

| Parameter | Type | Description |
|---|---|---|
| ` presentation ` | ` string ` | - Compact SD-JWT presentation including its key-binding JWT. |
| ` expected ` | ` { nonce: string; aud: string; } ` | - Expected wallet challenge nonce and verifier audience. |

Returns:

```ts
{
    holderJwk: Jwk;
    claims: Record<string, unknown>;
}
```

### verifyRequestObject

Verify the request signature, JOSE type and agreement between client_id and the
issuer DID. Check expiration only when exp is a number; absence or a nonnumeric
value is not rejected by this helper. Require a nonce, response URI and DCQL query.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/request-object.ts#L113)

Import: `import {verifyRequestObject} from 'tasra-sdk/oid4vp'`

```ts
declare function verifyRequestObject(jwt: string, opts?: VerifyRequestObjectOpts): Promise<VerifiedRequestObject>;
```

| Parameter | Type | Description |
|---|---|---|
| ` jwt ` | ` string ` | - Signed OpenID4VP request JWT. |
| ` opts? ` | ` VerifyRequestObjectOpts ` | - Trusted key resolver, current time and expiration tolerance. |

Returns: ` Promise<VerifiedRequestObject> `.

### waitForSession

Poll until the session reaches a terminal state (done or failed) - bounded by
`timeoutMs`, with a growing jittered interval so many clients never poll in lock-step.
A transient `unavailable` answer (a 503, a dropped connection) is retried within the
deadline; a `protocol` answer stops at once; the deadline is a `timeout` error; the
caller's `signal` is a `cancelled` error. A terminal `failed` is RETURNED (the caller
decides how to explain it) - see `awaitVerifierAgentResult` for the version that throws `refused`.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L459)

Import: `import {waitForSession} from 'tasra-sdk/oid4vp'`

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
<summary>Browse 43 types</summary>

- [BuildResponseOpts](#buildresponseopts)
- [BuiltResponse](#builtresponse)
- [CommitteeAction](#committeeaction)
- [CreateSessionParams](#createsessionparams)
- [CreateSessionResult](#createsessionresult)
- [CredentialOffer](#credentialoffer)
- [DidDocument](#diddocument)
- [Disclosure](#disclosure)
- [EcJwk](#ecjwk)
- [HeldSdJwt](#heldsdjwt)
- [HolderKey](#holderkey)
- [IssuerMetadata](#issuermetadata)
- [IssueSdJwtVcOpts](#issuesdjwtvcopts)
- [JweEnc](#jweenc)
- [Jwk](#jwk)
- [JwsAlg](#jwsalg)
- [JwsSigner](#jwssigner)
- [KeyResolver](#keyresolver)
- [NonceContext](#noncecontext)
- [OkpJwk](#okpjwk)
- [OpenedVerifierAgentSession](#openedverifieragentsession)
- [OpenVerifierAgentSessionOpts](#openverifieragentsessionopts)
- [OperationInput](#operationinput)
- [ParsedSdJwt](#parsedsdjwt)
- [PresentationCandidate](#presentationcandidate)
- [PresentationDelegation](#presentationdelegation)
- [PresentationOperation](#presentationoperation)
- [PresentationPlan](#presentationplan)
- [PresentOpts](#presentopts)
- [PresentSdJwtOpts](#presentsdjwtopts)
- [ReceiveCredentialOpts](#receivecredentialopts)
- [ReceivedCredential](#receivedcredential)
- [RequestObjectClaims](#requestobjectclaims)
- [ResolveOpts](#resolveopts)
- [SdJwtIssuer](#sdjwtissuer)
- [SessionPhase](#sessionphase)
- [SessionStatusResult](#sessionstatusresult)
- [TypedDataSigner](#typeddatasigner)
- [VerifiedRequestObject](#verifiedrequestobject)
- [VerifierAgentResult](#verifieragentresult-1)
- [VerifierAgentSessionErrorKind](#verifieragentsessionerrorkind)
- [VerifyRequestObjectOpts](#verifyrequestobjectopts)
- [WaitOpts](#waitopts)

</details>

### BuildResponseOpts

Verified request, selected credential, holder key and disclosure options for a wallet response.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/wallet.ts#L87)

```ts
export interface BuildResponseOpts {
    ro: Pick<VerifiedRequestObject, 'claims'>;
    candidate: PresentationCandidate;
    holder: HolderKey;
    disclose?: 'all' | readonly string[];
    nowSecs?: number;
    enc?: JweEnc;
}
```

Fields:

- **` ro `**: Verified request claims to bind the response to.
- **` candidate `**: Credential selected for this presentation.
- **` holder `**: Holder key matching the selected credential binding.
- **` disclose `**: Override which disclosures to reveal (default: exactly the claims the query names).
- **` nowSecs `**: Current time override in Unix seconds.
- **` enc `**: Preferred content encryption when the verifier-agent lists several (default A256GCM).

### BuiltResponse

Holder-bound presentation and form fields ready for submission to the verifier agent.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/wallet.ts#L103)

```ts
export interface BuiltResponse {
    presentation: string;
    payload: string;
    form: Record<string, string>;
    encrypted: boolean;
}
```

Fields:

- **` presentation `**: The presentation `issuer~disclosures~kb-jwt` that went into `vp_token`.
- **` payload `**: The JARM payload `{vp_token: {<queryId>: [presentation]}, state}` as JSON.
- **` form `**: The form body to POST: `response=<JWE>` when the verifier-agent served an encryption key, else the plain fields.
- **` encrypted `**: Whether the form contains an encrypted JWE response.

### CommitteeAction

Operation names accepted by the committee request-binding protocol.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/binding.ts#L17)

```ts
export type CommitteeAction = 'sign' | 'decrypt' | 'ibe-extract' | 'dual-approve';
```

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

### CredentialOffer

Credential issuer, offered configurations and optional pre-authorized grant details.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/oid4vci.ts#L13)

```ts
export interface CredentialOffer {
    credential_issuer: string;
    credential_configuration_ids: string[];
    grants?: Record<string, {
        'pre-authorized_code'?: string;
        tx_code?: {
            input_mode?: string;
            length?: number;
            description?: string;
        };
        authorization_server?: string;
    }>;
}
```

Fields:

- **` credential_issuer `**: Issuer identifier and metadata base URL.
- **` credential_configuration_ids `**: Credential configurations available in the offer.
- **` grants `**: Grant details, including any pre-authorized code and transaction code requirements.

### DidDocument

DID document fields used to resolve a public verification key.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/did-web.ts#L7)

```ts
export interface DidDocument {
    id: string;
    verificationMethod?: Array<{
        id: string;
        type?: string;
        controller?: string;
        publicKeyJwk?: Jwk;
        publicKeyMultibase?: string;
    }>;
    authentication?: Array<string | {
        id: string;
    }>;
    assertionMethod?: Array<string | {
        id: string;
    }>;
}
```

Fields:

- **` id `**: DID identified by this document.
- **` verificationMethod `**: Public keys and verification method identifiers.
- **` authentication `**: Verification methods authorized for authentication.
- **` assertionMethod `**: Verification methods authorized for assertions.

### Disclosure

One top-level SD-JWT claim disclosure with its encoded value and digest.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L14)

```ts
export interface Disclosure {
    encoded: string;
    salt: string;
    name: string;
    value: unknown;
    digest: string;
}
```

Fields:

- **` encoded `**: base64url(JSON([salt, name, value])) - what travels on the wire.
- **` salt `**: Random salt decoded from the disclosure.
- **` name `**: Top-level claim name.
- **` value `**: Disclosed claim value.
- **` digest `**: base64url(sha256(encoded)) - what the issuer JWT's `_sd` array holds.

### EcJwk

Public P-256 JSON Web Key with base64url coordinates and optional JOSE metadata.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L53)

```ts
export interface EcJwk {
    kty: 'EC';
    crv: 'P-256';
    x: string;
    y: string;
    kid?: string;
    alg?: string;
    use?: string;
}
```

Fields:

- **` kty `**: EC key type discriminator.
- **` crv `**: P-256 curve identifier.
- **` x `**: Base64url-encoded public x coordinate.
- **` y `**: Base64url-encoded public y coordinate.
- **` kid `**: Optional signing key identifier.
- **` alg `**: JOSE signing algorithm identifier.
- **` use `**: Optional JOSE key-use hint.

### HeldSdJwt

A credential the wallet holds.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/wallet.ts#L11)

```ts
export interface HeldSdJwt {
    sdJwt: string;
    label?: string;
}
```

Fields:

- **` sdJwt `**: Compact SD-JWT credential stored by the wallet.
- **` label `**: For the consent screen.

### HolderKey

A holder key in the shape the Hovi profile presents: `cnf.kid = did:jwk:...#0`.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L84)

```ts
export interface HolderKey {
    privateKey: Uint8Array;
    publicJwk: Jwk;
    did: string;
}
```

Fields:

- **` privateKey `**: 32 bytes: a P-256 private scalar, or an Ed25519 seed.
- **` publicJwk `**: Public JSON Web Key for this holder.
- **` did `**: `did:jwk:<base64url(JSON(publicJwk))>`

### IssuerMetadata

Issuer endpoints and credential configurations used during credential issuance.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/oid4vci.ts#L38)

```ts
export interface IssuerMetadata {
    credential_issuer: string;
    credential_endpoint: string;
    nonce_endpoint?: string;
    authorization_servers?: string[];
    credential_configurations_supported: Record<string, {
        format: string;
        vct?: string;
        [k: string]: unknown;
    }>;
}
```

Fields:

- **` credential_issuer `**: Issuer identifier used as the proof audience.
- **` credential_endpoint `**: Endpoint accepting credential issuance requests.
- **` nonce_endpoint `**: Optional endpoint for obtaining a proof nonce.
- **` authorization_servers `**: Authorization servers associated with this issuer.
- **` credential_configurations_supported `**: Configuration identifiers mapped to credential formats and metadata.

### IssueSdJwtVcOpts

Issuer, claims, holder binding and lifetime for a top-level selective-disclosure credential.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L130)

```ts
export interface IssueSdJwtVcOpts {
    issuer: SdJwtIssuer;
    vct: string;
    claims: Record<string, unknown>;
    plain?: string[];
    cnf: {
        kid: string;
    } | {
        jwk: Jwk;
    };
    sub?: string;
    nowSecs?: number;
    ttlSecs?: number;
    header?: Record<string, unknown>;
    random?: () => Uint8Array;
}
```

Fields:

- **` issuer `**: Issuer identity and signing key.
- **` vct `**: Verifiable credential type identifier.
- **` claims `**: Every claim goes into a disclosure unless named in `plain` (which then travels in the clear).
- **` plain `**: Claim names to include directly in the issuer JWT instead of selective disclosures.
- **` cnf `**: The holder's key binding: `{kid: did:jwk...#0}` (Hovi's shape) or `{jwk}`.
- **` sub `**: Subject DID, when the credential names one (`sub`); the verifier derives the holder from it first.
- **` nowSecs `**: Current time override in Unix seconds.
- **` ttlSecs `**: Credential lifetime in seconds; defaults to 365 days.
- **` header `**: Extra header members (e.g. a `typ` override); `alg` and `kid` are set here.
- **` random `**: Secure random bytes used to salt each disclosure; defaults to 16 Web Crypto bytes.

### JweEnc

Supported AES-GCM content encryption algorithms for compact JWE.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jwe.ts#L9)

```ts
export type JweEnc = 'A256GCM' | 'A128GCM';
```

### Jwk

Supported public JSON Web Key: P-256 or Ed25519.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L81)

```ts
export type Jwk = EcJwk | OkpJwk;
```

Fields:

- **` kty `**: EC key type discriminator. OKP key type discriminator.
- **` crv `**: P-256 curve identifier. Ed25519 curve identifier.
- **` x `**: Base64url-encoded public x coordinate. Base64url-encoded Ed25519 public key.
- **` kid `**: Optional signing key identifier.

### JwsAlg

Supported compact JWS algorithms: ES256 for P-256 or EdDSA for Ed25519.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L246)

```ts
export type JwsAlg = 'ES256' | 'EdDSA';
```

### JwsSigner

A signer for a compact JWS: a raw private key of the named curve.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L248)

```ts
export interface JwsSigner {
    alg: JwsAlg;
    privateKey: Uint8Array;
}
```

Fields:

- **` alg `**: JOSE signing algorithm identifier.
- **` privateKey `**: 32-byte P-256 private scalar or Ed25519 secret seed, matching alg.

### KeyResolver

Resolve the signing key a JAR's `kid` names: `did:web` documents online, `did:key`/`did:jwk` offline.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/request-object.ts#L78)

```ts
export type KeyResolver = (did: string, kid: string | undefined) => Promise<Jwk>;
```

### NonceContext

The authenticated context a wallet nonce binds beyond the request hash and the session
random (the reference nonce context): the beacon epoch, the anchored verifier-set
snapshot root and size, the slot's effective policy and the creator-signed operation's
expiry. The verifier-agent, the JAR signer and every fan-out verifier rebuild it from their own reads;
changing any field needs a new wallet proof. `snapshotRoot` is all-zero only where no
verifier-set registry is configured (dev).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/binding.ts#L65)

```ts
export interface NonceContext {
    epoch: number | bigint;
    snapshotRoot: Uint8Array;
    registrySize: number;
    committee: number;
    quorum: number;
    operationExp: number | bigint;
}
```

Fields:

- **` epoch `**: Beacon epoch used for the verifier committee draw.
- **` snapshotRoot `**: 32-byte anchored verifier snapshot root.
- **` registrySize `**: Number of entries in the verifier registry.
- **` committee `**: Number of verifiers selected for the committee.
- **` quorum `**: Minimum required verifier signatures.
- **` operationExp `**: Creator-signed operation expiry in Unix seconds.

### OkpJwk

Public Ed25519 JSON Web Key with a base64url public key and optional key identifier.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L70)

```ts
export interface OkpJwk {
    kty: 'OKP';
    crv: 'Ed25519';
    x: string;
    kid?: string;
}
```

Fields:

- **` kty `**: OKP key type discriminator.
- **` crv `**: Ed25519 curve identifier.
- **` x `**: Base64url-encoded Ed25519 public key.
- **` kid `**: Optional signing key identifier.

### OpenedVerifierAgentSession

Opened wallet session with its signed operation and expected request-binding hash.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/verifier-agent.ts#L124)

```ts
export interface OpenedVerifierAgentSession extends CreateSessionResult {
    operation: PresentationOperation;
    requestHash: Uint8Array;
    verifierAgentUrl: string;
}
```

Fields:

- **` operation `**: Signed operation details presented for authorization.
- **` requestHash `**: The binding hash the token will carry - compare with the token's `request_hash`.
- **` verifierAgentUrl `**: Verifier-agent HTTP base URL for the selected network.
- **` sessionId `**: Opened authorization session identifier.
- **` pollSecret `**: Bearer token for polling - treat as a secret
- **` qrPayload `**: OpenID4VP deep link for a wallet or QR code.
- **` requestUri `**: URL from which the wallet retrieves the signed request.

### OpenVerifierAgentSessionOpts

Operation, signing wallet and verifier-agent endpoint for opening a presentation session.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/verifier-agent.ts#L114)

```ts
export interface OpenVerifierAgentSessionOpts extends OperationInput {
    verifierAgentUrl: string;
    signer: TypedDataSigner;
    delegation?: PresentationDelegation;
}
```

Fields:

- **` verifierAgentUrl `**: Verifier-agent HTTP base URL for the selected network.
- **` signer `**: The slot creator's key, or a delegate's (with `delegation`).
- **` delegation `**: Optional creator-signed delegation authorizing the signing wallet.
- **` chainId `**: EVM chain identifier.
- **` keyRegistry `**: The KeyRegistry address - the EIP-712 `verifyingContract`.
- **` slotId `**: 32-byte slot identifier.
- **` action `**: Operation whose payload and permission are being authorized.
- **` message `**: `sign`: the message; `ibe-extract`: use `identity`; `decrypt`/`dual-approve`: use `payloadDigest`.
- **` identity `**: Exact identity string for an IBE extraction operation.
- **` payloadDigest `**: Precomputed 32-byte digest for decrypt or dual-approve.
- **` description `**: Shown by the wallet as the operation's purpose.
- **` ttlSecs `**: Seconds the authorization stays valid (default 600, the verifier-agent caps at 3600).
- **` nowSecs `**: Current time override in Unix seconds.

### OperationInput

Slot operation, payload context and authorization lifetime used to construct EIP-712 typed data.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/verifier-agent.ts#L50)

```ts
export interface OperationInput {
    chainId: number;
    keyRegistry: `0x${string}`;
    slotId: `0x${string}` | Uint8Array;
    action: CommitteeAction;
    message?: Uint8Array;
    identity?: string;
    payloadDigest?: Uint8Array;
    description: string;
    ttlSecs?: number;
    nowSecs?: number;
}
```

Fields:

- **` chainId `**: EVM chain identifier.
- **` keyRegistry `**: The KeyRegistry address - the EIP-712 `verifyingContract`.
- **` slotId `**: 32-byte slot identifier.
- **` action `**: Operation whose payload and permission are being authorized.
- **` message `**: `sign`: the message; `ibe-extract`: use `identity`; `decrypt`/`dual-approve`: use `payloadDigest`.
- **` identity `**: Exact identity string for an IBE extraction operation.
- **` payloadDigest `**: Precomputed 32-byte digest for decrypt or dual-approve.
- **` description `**: Shown by the wallet as the operation's purpose.
- **` ttlSecs `**: Seconds the authorization stays valid (default 600, the verifier-agent caps at 3600).
- **` nowSecs `**: Current time override in Unix seconds.

### ParsedSdJwt

Decoded SD-JWT components with disclosure hashes checked; issuer signature verification is separate.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L28)

```ts
export interface ParsedSdJwt {
    compact: string;
    issuerJwt: string;
    header: Record<string, unknown>;
    payload: Record<string, unknown>;
    disclosures: Disclosure[];
    kbJwt?: string;
}
```

Fields:

- **` compact `**: Original compact SD-JWT credential or presentation.
- **` issuerJwt `**: The issuer-signed JWT (first `~`-segment).
- **` header `**: Decoded issuer JWT header; not authenticated by parsing alone.
- **` payload `**: Decoded issuer JWT claims; not authenticated by parsing alone.
- **` disclosures `**: Decoded claim disclosures whose hashes match the issuer payload.
- **` kbJwt `**: The Key Binding JWT, when the compact carries one (a presentation).

### PresentationCandidate

Held credential that matches a named DCQL query during local selection.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/wallet.ts#L19)

```ts
export interface PresentationCandidate {
    held: HeldSdJwt;
    parsed: ParsedSdJwt;
    view: CredentialView;
    queryId: string;
}
```

Fields:

- **` held `**: Original held credential and its display label.
- **` parsed `**: Parsed SD-JWT credential with disclosure hashes checked.
- **` view `**: Credential claims exposed for advisory DCQL matching.
- **` queryId `**: The credential query id this credential answers.

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

### PresentationPlan

Advisory credential selection, available candidates and unmatched query identifiers.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/wallet.ts#L31)

```ts
export interface PresentationPlan {
    satisfies: boolean;
    candidates: PresentationCandidate[];
    chosen?: PresentationCandidate;
    unmatched: string[];
}
```

Fields:

- **` satisfies `**: Whether the local (advisory) selection found a credential that satisfies the request.
- **` candidates `**: Every held credential that answers some query - the choice to offer the user.
- **` chosen `**: The default choice (the evaluator's pick), when satisfied.
- **` unmatched `**: Query ids nothing in the wallet answers.

### PresentOpts

Request verification, credential selection and disclosure options for a wallet presentation.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/wallet.ts#L153)

```ts
export interface PresentOpts extends VerifyRequestObjectOpts {
    fetchImpl?: typeof fetch;
    choose?: (plan: PresentationPlan) => PresentationCandidate | undefined | Promise<PresentationCandidate | undefined>;
    disclose?: 'all' | readonly string[];
}
```

Fields:

- **` fetchImpl `**: HTTP transport override; defaults to the global fetch implementation.
- **` choose `**: Pick among the candidates (default: the evaluator's choice). Return `undefined` to abort.
- **` disclose `**: Claim names to disclose, or all; defaults to the selected query's requested claims.
- **` resolveKey `**: Resolver supplying a trusted public key for the request issuer and key identifier.
- **` nowSecs `**: Current time override in Unix seconds.
- **` leewaySecs `**: Seconds of clock skew tolerated on `exp`.

### PresentSdJwtOpts

Selected disclosures and holder key for a nonce-bound, audience-bound SD-JWT presentation.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L226)

```ts
export interface PresentSdJwtOpts {
    parsed: ParsedSdJwt;
    disclose: 'all' | readonly string[];
    holder: HolderKey;
    nonce: string;
    aud: string;
    nowSecs?: number;
    extraKbClaims?: Record<string, unknown>;
}
```

Fields:

- **` parsed `**: Parsed SD-JWT credential with disclosure hashes checked.
- **` disclose `**: Which disclosures to reveal: claim names, or `'all'`. Undisclosed claims stay hidden.
- **` holder `**: Holder key matching the credential confirmation claim.
- **` nonce `**: The JAR's `nonce`.
- **` aud `**: The JAR's `client_id`, VERBATIM (prefix included).
- **` nowSecs `**: Current time override in Unix seconds.
- **` extraKbClaims `**: Extra KB-JWT claims (e.g. `transaction_data_hashes`).

### ReceiveCredentialOpts

Credential offer, holder key and optional transaction code for pre-authorized issuance.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/oid4vci.ts#L52)

```ts
export interface ReceiveCredentialOpts {
    offerUri?: string;
    offer?: CredentialOffer;
    holder: HolderKey;
    txCode?: string;
    credentialConfigurationId?: string;
    fetchImpl?: typeof fetch;
    nowSecs?: number;
}
```

Fields:

- **` offerUri `**: The scanned URI, or an already-parsed offer.
- **` offer `**: Already parsed credential offer; takes precedence over offerUri.
- **` holder `**: Holder key used to prove possession during issuance.
- **` txCode `**: The transaction code the issuer displayed, when the grant asks for one.
- **` credentialConfigurationId `**: Which configuration to request (default: the offer's first).
- **` fetchImpl `**: HTTP transport override; defaults to the global fetch implementation.
- **` nowSecs `**: Current time override in Unix seconds.

### ReceivedCredential

Issued compact credential with its selected configuration, format and issuer identifier.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/oid4vci.ts#L70)

```ts
export interface ReceivedCredential {
    credential: string;
    configurationId: string;
    format: string;
    issuer: string;
}
```

Fields:

- **` credential `**: The compact `dc+sd-jwt` (or whatever the configuration's format is).
- **` configurationId `**: Credential configuration selected for issuance.
- **` format `**: Credential format identifier.
- **` issuer `**: Credential issuer identifier returned by metadata.

### RequestObjectClaims

OpenID4VP request claims carrying the credential query and wallet response context.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/request-object.ts#L17)

```ts
export interface RequestObjectClaims {
    iss: string;
    client_id: string;
    response_type?: string;
    response_mode?: string;
    response_uri: string;
    nonce: string;
    state: string;
    iat?: number;
    exp?: number;
    dcql_query: DcqlQuery;
    client_metadata?: {
        jwks?: {
            keys: Jwk[];
        };
        vp_formats_supported?: Record<string, unknown>;
        encrypted_response_enc_values_supported?: string[];
        [k: string]: unknown;
    };
    transaction_data?: string[];
    [k: string]: unknown;
}
```

Fields:

- **` iss `**: DID of the request issuer.
- **` client_id `**: Verifier client identifier, optionally prefixed with decentralized_identifier:.
- **` response_type `**: Requested OpenID4VP response type.
- **` response_mode `**: `direct_post.jwt` (the verifier-agent always) or `direct_post`.
- **` response_uri `**: Endpoint receiving the wallet response.
- **` nonce `**: Challenge nonce for this operation.
- **` state `**: Opaque state echoed in the wallet response.
- **` iat `**: Issue time in Unix seconds.
- **` exp `**: Expiration time in Unix seconds.
- **` dcql_query `**: Credential requirements presented to the wallet.
- **` client_metadata `**: Verifier metadata, including optional response encryption keys.
- **` transaction_data `**: Encoded operation context displayed or bound by the wallet.

### ResolveOpts

Fetch implementation and optional loopback HTTP permission for did:web resolution.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/did-web.ts#L33)

```ts
export interface ResolveOpts {
    fetchImpl?: typeof fetch;
    allowInsecureLoopback?: boolean;
}
```

Fields:

- **` fetchImpl `**: HTTP transport override; defaults to the global fetch implementation.
- **` allowInsecureLoopback `**: Allow `http://` for a loopback host (tests, loopback services); never for a public host.

### SdJwtIssuer

Issuer DID, optional signing key identifier and compact JWS signer.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L121)

```ts
export interface SdJwtIssuer {
    did: string;
    kid?: string;
    signer: JwsSigner;
}
```

Fields:

- **` did `**: The issuer DID the credential's `iss` names; `kid` = `${did}#${fragment}` unless given.
- **` kid `**: Optional signing key identifier.
- **` signer `**: Private-key signer for the issuer JWT.

### SessionPhase

Displayable authorization progress. A done phase means the committee answered; it does not mean the requested signing or decryption operation executed.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L94)

```ts
export type SessionPhase = 'awaiting_wallet' | 'verifying' | 'done' | 'failed';
```

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

### TypedDataSigner

Anything that signs EIP-712 typed data for an address - a viem `LocalAccount` or `WalletClient`-bound account fits.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/verifier-agent.ts#L37)

```ts
export interface TypedDataSigner {
    address: `0x${string}`;
    signTypedData(args: {
        domain: {
            name: string;
            version: string;
            chainId: number;
            verifyingContract: `0x${string}`;
        };
        types: typeof PRESENTATION_OPERATION_TYPES;
        primaryType: 'PresentationOperation';
        message: {
            chainId: bigint;
            slotId: `0x${string}`;
            action: string;
            payloadDigest: `0x${string}`;
            description: string;
            exp: bigint;
        };
    }): Promise<`0x${string}`>;
}
```

Fields:

- **` address `**: EVM address of the creator or delegated signing wallet.
- **` signTypedData `**: Sign the operation EIP-712 payload using the wallet's key.

### VerifiedRequestObject

Request JWT, decoded claims and signing identity after request-object validation.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/request-object.ts#L51)

```ts
export interface VerifiedRequestObject {
    jwt: string;
    header: {
        alg: string;
        typ?: string;
        kid?: string;
    };
    claims: RequestObjectClaims;
    signerDid: string;
    signerKey: Jwk;
}
```

Fields:

- **` jwt `**: Original compact request JWT.
- **` header `**: Verified request JOSE header.
- **` claims `**: Validated request claims.
- **` signerDid `**: The DID `iss` names, after the `client_id` prefix agreed with it.
- **` signerKey `**: Public key used to verify the request signature.

### VerifierAgentResult

Compound committee token with optional request preimage and verifier membership proofs.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/verifier-agent.ts#L147)

```ts
export interface VerifierAgentResult {
    token: CompoundTokenWire;
    bindingPreimage?: Record<string, unknown>;
    verifierProofs?: VerifierProof[];
}
```

Fields:

- **` token `**: Compound committee authorization token.
- **` bindingPreimage `**: Operation context used to derive the request-binding hash.
- **` verifierProofs `**: The drawn verifiers' snapshot membership proofs the verifier-agent built at session creation - hand them to every keeper call (`verifierProofs`): a keeper in snapshot-required mode (`api.require_verifier_proofs`) refuses a committee request without them.

### VerifierAgentSessionErrorKind

Why a session did not yield a token - the class the UI explains, with a NON-SECRET
correlation reference (the session id; the poll secret is never part of an error).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L114)

```ts
export type VerifierAgentSessionErrorKind = 'timeout' | 'refused' | 'unavailable' | 'protocol' | 'cancelled';
```

### VerifyRequestObjectOpts

Signing-key resolver, evaluation time and expiration tolerance for request validation.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/request-object.ts#L96)

```ts
export interface VerifyRequestObjectOpts {
    resolveKey?: KeyResolver;
    nowSecs?: number;
    leewaySecs?: number;
}
```

Fields:

- **` resolveKey `**: Resolver supplying a trusted public key for the request issuer and key identifier.
- **` nowSecs `**: Current time override in Unix seconds.
- **` leewaySecs `**: Seconds of clock skew tolerated on `exp`.

### WaitOpts

Polling backoff, cancellation, progress callback and randomness options.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L417)

```ts
export interface WaitOpts {
    maxIntervalMs?: number;
    signal?: AbortSignal;
    onPhase?: (phase: SessionPhase) => void;
    random?: () => number;
}
```

Fields:

- **` maxIntervalMs `**: Ceiling for the growing interval (default 4 times intervalMs).
- **` signal `**: Cancel (a user closed the wallet prompt): rejects with `cancelled`.
- **` onPhase `**: Called on every poll with the phase the UI may show.
- **` random `**: Randomness for the jitter (tests inject a fixed value).

## Constants and ABI values

Shared values and contract definitions.

| Export | Description | Definition |
|---|---|---|
| `CLIENT_ID_PREFIX_DID` | OpenID4VP client identifier prefix for a DID-based verifier. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/request-object.ts#L14) |
| `COMMITTEE_ACTIONS` | Supported operation names accepted by request-binding validation. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/binding.ts#L19) |
| `CREDENTIAL_OFFER_SCHEME` | URI scheme for a wallet credential offer. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/oid4vci.ts#L6) |
| `DECRYPT_DIGEST_DOMAIN` | Domain separator for the ciphertext digest used in decryption authorization. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/binding.ts#L14) |
| `KB_JWT_TYP` | JOSE type identifier for the holder key-binding JWT. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L11) |
| `PRE_AUTHORIZED_GRANT` | OAuth grant identifier for credential issuance using a pre-authorized code. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/oid4vci.ts#L8) |
| `PRESENTATION_EIP712_NAME` | EIP-712 domain name for creator-signed presentation operations. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/verifier-agent.ts#L20) |
| `PRESENTATION_EIP712_VERSION` | EIP-712 domain version for creator-signed presentation operations. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/verifier-agent.ts#L22) |
| `PRESENTATION_OPERATION_TYPES` | The EIP-712 types mirrored from the reference presentation-auth types - do not reorder. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/verifier-agent.ts#L25) |
| `PROOF_TYP` | JOSE type identifier for an OpenID4VCI proof of key possession. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/oid4vci.ts#L10) |
| `REQUEST_BINDING_DOMAIN` | Domain separator for binding chain, slot, action and payload digest. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/binding.ts#L10) |
| `REQUEST_OBJECT_TYP` | JOSE type identifier for a signed authorization request object. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/request-object.ts#L12) |
| `SD_JWT_TYP` | JOSE type identifier for a selectively disclosable verifiable credential. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L9) |
| `VP_NONCE_DOMAIN` | Domain separator for deriving a wallet presentation nonce from the operation context. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/binding.ts#L12) |
