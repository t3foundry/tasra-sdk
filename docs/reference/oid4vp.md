# tasra-sdk/oid4vp

Generated from public TypeScript exports.

[Reference index](README.md) · [Task guides](../README.md) · [Errors](../errors.md)

<details>
<summary>Find an export</summary>

- [assertCompoundTokenWire](#assertcompoundtokenwire)
- [awaitVerifierAgentResult](#awaitverifieragentresult)
- [b64url](#b64url)
- [b64urlDecode](#b64urldecode)
- [base58Decode](#base58decode)
- [base58Encode](#base58encode)
- [buildResponse](#buildresponse)
- [BuildResponseOpts](#buildresponseopts)
- [BuiltResponse](#builtresponse)
- [CommitteeAction](#committeeaction)
- [concatKdf](#concatkdf)
- [createOid4vpSession](#createoid4vpsession)
- [CreateSessionParams](#createsessionparams)
- [CreateSessionResult](#createsessionresult)
- [CredentialOffer](#credentialoffer)
- [decodeJson](#decodejson)
- [decryptJwe](#decryptjwe)
- [decryptPayloadDigest](#decryptpayloaddigest)
- [defaultKeyResolver](#defaultkeyresolver)
- [derivedNonce](#derivednonce)
- [DidDocument](#diddocument)
- [didJwk](#didjwk)
- [didJwkIssuer](#didjwkissuer)
- [didWebUrl](#didweburl)
- [Disclosure](#disclosure)
- [disclosureDigest](#disclosuredigest)
- [EcJwk](#ecjwk)
- [ed25519DidKey](#ed25519didkey)
- [ed25519FromDidKey](#ed25519fromdidkey)
- [ed25519HolderKey](#ed25519holderkey)
- [encryptJwe](#encryptjwe)
- [fetchRequestObject](#fetchrequestobject)
- [fromUtf8](#fromutf8)
- [HeldSdJwt](#heldsdjwt)
- [holderCnf](#holdercnf)
- [HolderKey](#holderkey)
- [holderSigner](#holdersigner)
- [IssuerMetadata](#issuermetadata)
- [issueSdJwtVc](#issuesdjwtvc)
- [IssueSdJwtVcOpts](#issuesdjwtvcopts)
- [JweEnc](#jweenc)
- [Jwk](#jwk)
- [jwkFromDid](#jwkfromdid)
- [JwsAlg](#jwsalg)
- [JwsSigner](#jwssigner)
- [KeyResolver](#keyresolver)
- [nextPollDelay](#nextpolldelay)
- [NonceContext](#noncecontext)
- [OkpJwk](#okpjwk)
- [OpenedVerifierAgentSession](#openedverifieragentsession)
- [openVerifierAgentSession](#openverifieragentsession)
- [OpenVerifierAgentSessionOpts](#openverifieragentsessionopts)
- [OperationInput](#operationinput)
- [p256DidKey](#p256didkey)
- [p256DidKeyIssuer](#p256didkeyissuer)
- [p256HolderKey](#p256holderkey)
- [p256PublicJwk](#p256publicjwk)
- [parseCredentialOfferUri](#parsecredentialofferuri)
- [ParsedSdJwt](#parsedsdjwt)
- [parseOpenid4vpUri](#parseopenid4vpuri)
- [parseSdJwt](#parsesdjwt)
- [payloadDigest](#payloaddigest)
- [payloadDigestFor](#payloaddigestfor)
- [peekSdJwt](#peeksdjwt)
- [planPresentation](#planpresentation)
- [pollOid4vpSession](#polloid4vpsession)
- [PresentationCandidate](#presentationcandidate)
- [PresentationDelegation](#presentationdelegation)
- [PresentationOperation](#presentationoperation)
- [presentationOperationTypedData](#presentationoperationtypeddata)
- [PresentationPlan](#presentationplan)
- [PresentOpts](#presentopts)
- [presentSdJwt](#presentsdjwt)
- [PresentSdJwtOpts](#presentsdjwtopts)
- [presentToRequestUri](#presenttorequesturi)
- [randomHolderKey](#randomholderkey)
- [receiveCredential](#receivecredential)
- [ReceiveCredentialOpts](#receivecredentialopts)
- [ReceivedCredential](#receivedcredential)
- [requestedClaimNames](#requestedclaimnames)
- [requestHash](#requesthash)
- [RequestObjectClaims](#requestobjectclaims)
- [resolveDidWeb](#resolvedidweb)
- [ResolveOpts](#resolveopts)
- [responseEncryptionKey](#responseencryptionkey)
- [sdHash](#sdhash)
- [sdJwtClaims](#sdjwtclaims)
- [sdJwtCredentialView](#sdjwtcredentialview)
- [SdJwtIssuer](#sdjwtissuer)
- [SessionPhase](#sessionphase)
- [SessionStatusResult](#sessionstatusresult)
- [signCompactJws](#signcompactjws)
- [submitResponse](#submitresponse)
- [TypedDataSigner](#typeddatasigner)
- [utf8](#utf8)
- [verificationKey](#verificationkey)
- [VerifiedRequestObject](#verifiedrequestobject)
- [verifierAgentResult](#verifieragentresult)
- [VerifierAgentResult](#verifieragentresult-1)
- [VerifierAgentSessionError](#verifieragentsessionerror)
- [VerifierAgentSessionErrorKind](#verifieragentsessionerrorkind)
- [verifierAgentVerifierProofs](#verifieragentverifierproofs)
- [verifyCompactJws](#verifycompactjws)
- [verifyKbJwt](#verifykbjwt)
- [verifyRequestObject](#verifyrequestobject)
- [VerifyRequestObjectOpts](#verifyrequestobjectopts)
- [waitForSession](#waitforsession)
- [WaitOpts](#waitopts)
- [Constants and ABI values](#constants-and-abi-values)

</details>

## assertCompoundTokenWire

The compound token the verifier-agent hands back must be the wire shape the keepers verify —
checked field by field before anything is built on it.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L140)

Import: `import {assertCompoundTokenWire} from 'tasra-sdk/oid4vp'`

```ts
declare function assertCompoundTokenWire(raw: unknown, correlation: string): Record<string, unknown>
```

| Parameter | Type | Description |
|---|---|---|
| `raw` | `unknown` |  |
| `correlation` | `string` |  |

Returns: `Record<string, unknown>`.

## awaitVerifierAgentResult

Poll until the wallet has presented and the committee answered. Rejects with an
`VerifierAgentSessionError` whose `kind` the UI explains — `refused` (the verifier-agent's `error` names the
refusing side), `timeout`, `unavailable`, `protocol`, `cancelled` — and whose
`correlation` is the session id. A token that binds another request than this session
opened, or one whose proofs are malformed, is a `protocol` refusal: nothing is built on it.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/verifier-agent.ts#L156)

Import: `import {awaitVerifierAgentResult} from 'tasra-sdk/oid4vp'`

```ts
declare function awaitVerifierAgentResult(session: Pick<OpenedVerifierAgentSession, "verifierAgentUrl" | "sessionId" | "pollSecret" | "requestHash">, opts?: { intervalMs?: number; timeoutMs?: number; } & WaitOpts): Promise<VerifierAgentResult>
```

| Parameter | Type | Description |
|---|---|---|
| `session` | `Pick<OpenedVerifierAgentSession, "verifierAgentUrl" &#124; "sessionId" &#124; "pollSecret" &#124; "requestHash">` |  |
| `opts` | `{ intervalMs?: number; timeoutMs?: number; } & WaitOpts` |  |

Returns: `Promise<VerifierAgentResult>`.

## b64url

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L13)

Import: `import {b64url} from 'tasra-sdk/oid4vp'`

```ts
declare function b64url(bytes: Uint8Array | string): string
```

| Parameter | Type | Description |
|---|---|---|
| `bytes` | `string &#124; Uint8Array<ArrayBufferLike>` |  |

Returns: `string`.

## b64urlDecode

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L19)

Import: `import {b64urlDecode} from 'tasra-sdk/oid4vp'`

```ts
declare function b64urlDecode(s: string): Uint8Array
```

| Parameter | Type | Description |
|---|---|---|
| `s` | `string` |  |

Returns: `Uint8Array<ArrayBufferLike>`.

## base58Decode

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L102)

Import: `import {base58Decode} from 'tasra-sdk/oid4vp'`

```ts
declare function base58Decode(s: string): Uint8Array
```

| Parameter | Type | Description |
|---|---|---|
| `s` | `string` |  |

Returns: `Uint8Array<ArrayBufferLike>`.

## base58Encode

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L88)

Import: `import {base58Encode} from 'tasra-sdk/oid4vp'`

```ts
declare function base58Encode(bytes: Uint8Array): string
```

| Parameter | Type | Description |
|---|---|---|
| `bytes` | `Uint8Array<ArrayBufferLike>` |  |

Returns: `string`.

## buildResponse

Bind the chosen credential to the request (KB-JWT) and wrap it as the verifier-agent expects it.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/wallet.ts#L99)

Import: `import {buildResponse} from 'tasra-sdk/oid4vp'`

```ts
declare function buildResponse(opts: BuildResponseOpts): BuiltResponse
```

| Parameter | Type | Description |
|---|---|---|
| `opts` | `BuildResponseOpts` |  |

Returns: `BuiltResponse`.

## BuildResponseOpts

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/wallet.ts#L77)

```ts
export interface BuildResponseOpts {
  ro: Pick<VerifiedRequestObject, 'claims'>
  candidate: PresentationCandidate
  holder: HolderKey
  /** Override which disclosures to reveal (default: exactly the claims the query names). */
  disclose?: 'all' | readonly string[]
  nowSecs?: number
  /** Preferred content encryption when the verifier-agent lists several (default A256GCM). */
  enc?: JweEnc
}
```

## BuiltResponse

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/wallet.ts#L88)

```ts
export interface BuiltResponse {
  /** The presentation `issuer~disclosures~kb-jwt` that went into `vp_token`. */
  presentation: string
  /** The JARM payload `{vp_token: {<queryId>: [presentation]}, state}` as JSON. */
  payload: string
  /** The form body to POST: `response=<JWE>` when the verifier-agent served an encryption key, else the plain fields. */
  form: Record<string, string>
  encrypted: boolean
}
```

## CommitteeAction

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/binding.ts#L14)

```ts
export type CommitteeAction = 'sign' | 'decrypt' | 'ibe-extract' | 'dual-approve'
```

## concatKdf

Concat KDF (NIST SP 800-56A, single-pass SHA-256) — AlgorithmID = `enc` for ECDH-ES direct.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jwe.ts#L27)

Import: `import {concatKdf} from 'tasra-sdk/oid4vp'`

```ts
declare function concatKdf(z: Uint8Array, alg: string, apu: Uint8Array, apv: Uint8Array, keyLen: number): Uint8Array
```

| Parameter | Type | Description |
|---|---|---|
| `z` | `Uint8Array<ArrayBufferLike>` |  |
| `alg` | `string` |  |
| `apu` | `Uint8Array<ArrayBufferLike>` |  |
| `apv` | `Uint8Array<ArrayBufferLike>` |  |
| `keyLen` | `number` |  |

Returns: `Uint8Array<ArrayBufferLike>`.

## createOid4vpSession

Create an OID4VP session on the Verifier Agent.

The verifier-agent derives a nonce, generates an ECDH key for JWE, and returns a QR
payload the wallet scans. The session ID and poll secret are used to poll
for the result.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L196)

Import: `import {createOid4vpSession} from 'tasra-sdk/oid4vp'`

```ts
declare function createOid4vpSession(verifierAgentUrl: string, params: CreateSessionParams): Promise<CreateSessionResult>
```

| Parameter | Type | Description |
|---|---|---|
| `verifierAgentUrl` | `string` |  |
| `params` | `CreateSessionParams` |  |

Returns: `Promise<CreateSessionResult>`.

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

## CredentialOffer

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/oid4vci.ts#L13)

```ts
export interface CredentialOffer {
  credential_issuer: string
  credential_configuration_ids: string[]
  grants?: Record<string, {'pre-authorized_code'?: string; tx_code?: {input_mode?: string; length?: number; description?: string}; authorization_server?: string}>
}
```

## decodeJson

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L23)

Import: `import {decodeJson} from 'tasra-sdk/oid4vp'`

```ts
declare function decodeJson<T = unknown>(b64: string): T
```

| Parameter | Type | Description |
|---|---|---|
| `b64` | `string` |  |

Returns: `T`.

## decryptJwe

Decrypt a compact JWE produced by {@link encryptJwe} (or a wallet) with the recipient's private scalar.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jwe.ts#L64)

Import: `import {decryptJwe} from 'tasra-sdk/oid4vp'`

```ts
declare function decryptJwe(compact: string, recipientPrivateKey: Uint8Array): string
```

| Parameter | Type | Description |
|---|---|---|
| `compact` | `string` |  |
| `recipientPrivateKey` | `Uint8Array<ArrayBufferLike>` |  |

Returns: `string`.

## decryptPayloadDigest

The `decrypt` action's digest, mirroring the reference decrypt digest:
`sha256(DOMAIN ‖ len(u) u64 LE ‖ u ‖ len(aead_ct) u64 LE ‖ aead_ct)` — the AEAD nonce is
deliberately excluded (it is not authorised content).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/binding.ts#L124)

Import: `import {decryptPayloadDigest} from 'tasra-sdk/oid4vp'`

```ts
declare function decryptPayloadDigest(u: Uint8Array, aeadCt: Uint8Array): Uint8Array
```

| Parameter | Type | Description |
|---|---|---|
| `u` | `Uint8Array<ArrayBufferLike>` |  |
| `aeadCt` | `Uint8Array<ArrayBufferLike>` |  |

Returns: `Uint8Array<ArrayBufferLike>`.

## defaultKeyResolver

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/request-object.ts#L57)

Import: `import {defaultKeyResolver} from 'tasra-sdk/oid4vp'`

```ts
declare function defaultKeyResolver(opts?: ResolveOpts): KeyResolver
```

| Parameter | Type | Description |
|---|---|---|
| `opts` | `ResolveOpts` |  |

Returns: `KeyResolver`.

## derivedNonce

`base64url(keccak256(NONCE_DOMAIN ‖ request_hash ‖ random ‖ epoch u64 BE ‖ snapshot_root ‖
registry_size u32 BE ‖ committee u32 BE ‖ quorum u32 BE ‖ operation_exp i64 BE))` — the
nonce a KB-JWT must carry (the reference vp-nonce derivation, domain v2).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/binding.ts#L70)

Import: `import {derivedNonce} from 'tasra-sdk/oid4vp'`

```ts
declare function derivedNonce(reqHash: Uint8Array, random: Uint8Array, ctx: NonceContext): string
```

| Parameter | Type | Description |
|---|---|---|
| `reqHash` | `Uint8Array<ArrayBufferLike>` |  |
| `random` | `Uint8Array<ArrayBufferLike>` |  |
| `ctx` | `NonceContext` |  |

Returns: `string`.

## DidDocument

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/did-web.ts#L13)

```ts
export interface DidDocument {
  id: string
  verificationMethod?: Array<{id: string; type?: string; controller?: string; publicKeyJwk?: Jwk; publicKeyMultibase?: string}>
  authentication?: Array<string | {id: string}>
  assertionMethod?: Array<string | {id: string}>
}
```

## didJwk

`did:jwk` of a JWK — the JSON is serialised in `kty, crv, x, y` order, the vault's convention.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L67)

Import: `import {didJwk} from 'tasra-sdk/oid4vp'`

```ts
declare function didJwk(jwk: Jwk): string
```

| Parameter | Type | Description |
|---|---|---|
| `jwk` | `Jwk` |  |

Returns: `string`.

## didJwkIssuer

A `did:jwk` issuer (any key the app already holds, e.g. a patient's vault key granting a consent).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L163)

Import: `import {didJwkIssuer} from 'tasra-sdk/oid4vp'`

```ts
declare function didJwkIssuer(privateKey: Uint8Array, alg?: JwsAlg): SdJwtIssuer
```

| Parameter | Type | Description |
|---|---|---|
| `privateKey` | `Uint8Array<ArrayBufferLike>` |  |
| `alg` | `JwsAlg` |  |

Returns: `SdJwtIssuer`.

## didWebUrl

The HTTPS URL a `did:web` resolves from (W3C did:web method §3.2).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/did-web.ts#L21)

Import: `import {didWebUrl} from 'tasra-sdk/oid4vp'`

```ts
declare function didWebUrl(did: string): string
```

| Parameter | Type | Description |
|---|---|---|
| `did` | `string` |  |

Returns: `string`.

## Disclosure

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L17)

```ts
export interface Disclosure {
  /** base64url(JSON([salt, name, value])) — what travels on the wire. */
  encoded: string
  salt: string
  name: string
  value: unknown
  /** base64url(sha256(encoded)) — what the issuer JWT's `_sd` array holds. */
  digest: string
}
```

## disclosureDigest

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L38)

Import: `import {disclosureDigest} from 'tasra-sdk/oid4vp'`

```ts
declare function disclosureDigest(encoded: string): string
```

| Parameter | Type | Description |
|---|---|---|
| `encoded` | `string` |  |

Returns: `string`.

## EcJwk

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L27)

```ts
export interface EcJwk {
  kty: 'EC'
  crv: 'P-256'
  x: string
  y: string
  kid?: string
  alg?: string
  use?: string
}
```

## ed25519DidKey

`did:key` of an Ed25519 public key (multicodec 0xed01).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L123)

Import: `import {ed25519DidKey} from 'tasra-sdk/oid4vp'`

```ts
declare function ed25519DidKey(publicKey: Uint8Array): string
```

| Parameter | Type | Description |
|---|---|---|
| `publicKey` | `Uint8Array<ArrayBufferLike>` |  |

Returns: `string`.

## ed25519FromDidKey

The 32-byte Ed25519 key inside a `did:key:z6Mk…`; throws for any other key type.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L132)

Import: `import {ed25519FromDidKey} from 'tasra-sdk/oid4vp'`

```ts
declare function ed25519FromDidKey(did: string): Uint8Array
```

| Parameter | Type | Description |
|---|---|---|
| `did` | `string` |  |

Returns: `Uint8Array<ArrayBufferLike>`.

## ed25519HolderKey

An Ed25519 holder key from a 32-byte seed — the shape `tasra-cli vc issue-sd-jwt` binds.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L77)

Import: `import {ed25519HolderKey} from 'tasra-sdk/oid4vp'`

```ts
declare function ed25519HolderKey(seed: Uint8Array): HolderKey
```

| Parameter | Type | Description |
|---|---|---|
| `seed` | `Uint8Array<ArrayBufferLike>` |  |

Returns: `HolderKey`.

## encryptJwe

Encrypt `plaintext` to the recipient's ephemeral P-256 JWK (the JAR's `client_metadata.jwks.keys[0]`)
as `header..iv.ciphertext.tag`. A fresh sender key per call; `kid` echoed when the recipient key has one.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jwe.ts#L47)

Import: `import {encryptJwe} from 'tasra-sdk/oid4vp'`

```ts
declare function encryptJwe(plaintext: string, recipient: EcJwk, enc?: JweEnc, random?: (n: number) => Uint8Array): string
```

| Parameter | Type | Description |
|---|---|---|
| `plaintext` | `string` |  |
| `recipient` | `EcJwk` |  |
| `enc` | `JweEnc` |  |
| `random` | `(n: number) => Uint8Array` |  |

Returns: `string`.

## fetchRequestObject

Fetch a JAR from `request_uri` (`Accept: application/oauth-authz-req+jwt`) and verify it.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/request-object.ts#L102)

Import: `import {fetchRequestObject} from 'tasra-sdk/oid4vp'`

```ts
declare function fetchRequestObject(requestUri: string, opts?: VerifyRequestObjectOpts & { fetchImpl?: typeof fetch; }): Promise<VerifiedRequestObject>
```

| Parameter | Type | Description |
|---|---|---|
| `requestUri` | `string` |  |
| `opts` | `VerifyRequestObjectOpts & { fetchImpl?: typeof fetch; }` |  |

Returns: `Promise<VerifiedRequestObject>`.

## fromUtf8

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L11)

Import: `import {fromUtf8} from 'tasra-sdk/oid4vp'`

```ts
declare function fromUtf8(b: Uint8Array): string
```

| Parameter | Type | Description |
|---|---|---|
| `b` | `Uint8Array<ArrayBufferLike>` |  |

Returns: `string`.

## HeldSdJwt

A credential the wallet holds.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/wallet.ts#L17)

```ts
export interface HeldSdJwt {
  sdJwt: string
  /** For the consent screen. */
  label?: string
}
```

## holderCnf

The `cnf` a holder key binds to: `{kid: "<did:jwk>#0"}`, exactly as the Hovi wallet presents.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L149)

Import: `import {holderCnf} from 'tasra-sdk/oid4vp'`

```ts
declare function holderCnf(holder: Pick<HolderKey, "did">): { kid: string; }
```

| Parameter | Type | Description |
|---|---|---|
| `holder` | `Pick<HolderKey, "did">` |  |

Returns: `{ kid: string; }`.

## HolderKey

A holder key in the shape the Hovi profile presents: `cnf.kid = did:jwk:…#0`.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L45)

```ts
export interface HolderKey {
  /** 32 bytes: a P-256 private scalar, or an Ed25519 seed. */
  privateKey: Uint8Array
  publicJwk: Jwk
  /** `did:jwk:<base64url(JSON(publicJwk))>` */
  did: string
}
```

## holderSigner

How to sign for this holder. P-256 keys sign ES256, Ed25519 keys EdDSA — a credential is bound to
one key, and the KB-JWT it is presented with has to be signed by that key's own algorithm. Issuers
outside the P-256 profile exist: `tasra-cli vc issue-sd-jwt` binds an Ed25519 holder key.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L58)

Import: `import {holderSigner} from 'tasra-sdk/oid4vp'`

```ts
declare function holderSigner(holder: HolderKey): JwsSigner
```

| Parameter | Type | Description |
|---|---|---|
| `holder` | `HolderKey` |  |

Returns: `JwsSigner`.

## IssuerMetadata

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/oid4vci.ts#L30)

```ts
export interface IssuerMetadata {
  credential_issuer: string
  credential_endpoint: string
  nonce_endpoint?: string
  authorization_servers?: string[]
  credential_configurations_supported: Record<string, {format: string; vct?: string; [k: string]: unknown}>
}
```

## issueSdJwtVc

Mint a compact SD-JWT VC `issuer~d1~…~` with one disclosure per selectively disclosable claim.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L118)

Import: `import {issueSdJwtVc} from 'tasra-sdk/oid4vp'`

```ts
declare function issueSdJwtVc(opts: IssueSdJwtVcOpts): string
```

| Parameter | Type | Description |
|---|---|---|
| `opts` | `IssueSdJwtVcOpts` |  |

Returns: `string`.

## IssueSdJwtVcOpts

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L100)

```ts
export interface IssueSdJwtVcOpts {
  issuer: SdJwtIssuer
  vct: string
  /** Every claim goes into a disclosure unless named in `plain` (which then travels in the clear). */
  claims: Record<string, unknown>
  plain?: string[]
  /** The holder's key binding: `{kid: did:jwk…#0}` (Hovi's shape) or `{jwk}`. */
  cnf: {kid: string} | {jwk: Jwk}
  /** Subject DID, when the credential names one (`sub`); the verifier derives the holder from it first. */
  sub?: string
  nowSecs?: number
  ttlSecs?: number
  /** Extra header members (e.g. a `typ` override); `alg` and `kid` are set here. */
  header?: Record<string, unknown>
  random?: () => Uint8Array
}
```

## JweEnc

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jwe.ts#L11)

```ts
export type JweEnc = 'A256GCM' | 'A128GCM'
```

## Jwk

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L42)

```ts
export type Jwk = EcJwk | OkpJwk
```

## jwkFromDid

The public JWK inside a `did:jwk` or a `did:key` (Ed25519 / P-256); a `#fragment` is ignored.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L141)

Import: `import {jwkFromDid} from 'tasra-sdk/oid4vp'`

```ts
declare function jwkFromDid(did: string): Jwk
```

| Parameter | Type | Description |
|---|---|---|
| `did` | `string` |  |

Returns: `Jwk`.

## JwsAlg

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L158)

```ts
export type JwsAlg = 'ES256' | 'EdDSA'
```

## JwsSigner

A signer for a compact JWS: a raw private key of the named curve.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L160)

```ts
export interface JwsSigner {
  alg: JwsAlg
  privateKey: Uint8Array
}
```

## KeyResolver

Resolve the signing key a JAR's `kid` names: `did:web` documents online, `did:key`/`did:jwk` offline.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/request-object.ts#L55)

```ts
export type KeyResolver = (did: string, kid: string | undefined) => Promise<Jwk>
```

## nextPollDelay

The next polling delay: geometric growth (×1.5) capped at `max`, ±20 % full jitter.
Pure, so the schedule is testable without timers.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L404)

Import: `import {nextPollDelay} from 'tasra-sdk/oid4vp'`

```ts
declare function nextPollDelay(previousMs: number, baseMs: number, maxMs: number, random?: () => number): number
```

| Parameter | Type | Description |
|---|---|---|
| `previousMs` | `number` |  |
| `baseMs` | `number` |  |
| `maxMs` | `number` |  |
| `random` | `() => number` |  |

Returns: `number`.

## NonceContext

The authenticated context a wallet nonce binds beyond the request hash and the session
random (the reference nonce context): the beacon epoch, the anchored verifier-set
snapshot root and size, the slot's effective policy and the creator-signed operation's
expiry. The verifier-agent, the JAR signer and every fan-out verifier rebuild it from their own reads;
changing any field needs a new wallet proof. `snapshotRoot` is all-zero only where no
verifier-set registry is configured (dev).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/binding.ts#L56)

```ts
export interface NonceContext {
  epoch: number | bigint
  snapshotRoot: Uint8Array
  registrySize: number
  committee: number
  quorum: number
  operationExp: number | bigint
}
```

## OkpJwk

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L36)

```ts
export interface OkpJwk {
  kty: 'OKP'
  crv: 'Ed25519'
  x: string
  kid?: string
}
```

## OpenedVerifierAgentSession

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/verifier-agent.ts#L106)

```ts
export interface OpenedVerifierAgentSession extends CreateSessionResult {
  operation: PresentationOperation
  /** The binding hash the token will carry — compare with the token's `request_hash`. */
  requestHash: Uint8Array
  verifierAgentUrl: string
}
```

## openVerifierAgentSession

Sign the operation and open a session; hand `qrPayload` to the wallet.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/verifier-agent.ts#L114)

Import: `import {openVerifierAgentSession} from 'tasra-sdk/oid4vp'`

```ts
declare function openVerifierAgentSession(opts: OpenVerifierAgentSessionOpts): Promise<OpenedVerifierAgentSession>
```

| Parameter | Type | Description |
|---|---|---|
| `opts` | `OpenVerifierAgentSessionOpts` |  |

Returns: `Promise<OpenedVerifierAgentSession>`.

## OpenVerifierAgentSessionOpts

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/verifier-agent.ts#L99)

```ts
export interface OpenVerifierAgentSessionOpts extends OperationInput {
  verifierAgentUrl: string
  /** The slot creator's key, or a delegate's (with `delegation`). */
  signer: TypedDataSigner
  delegation?: PresentationDelegation
}
```

## OperationInput

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/verifier-agent.ts#L46)

```ts
export interface OperationInput {
  chainId: number
  /** The KeyRegistry address — the EIP-712 `verifyingContract`. */
  keyRegistry: `0x${string}`
  slotId: `0x${string}` | Uint8Array
  action: CommitteeAction
  /** `sign`: the message; `ibe-extract`: use `identity`; `decrypt`/`dual-approve`: use `payloadDigest`. */
  message?: Uint8Array
  identity?: string
  payloadDigest?: Uint8Array
  /** Shown by the wallet as the operation's purpose. */
  description: string
  /** Seconds the authorization stays valid (default 600, the verifier-agent caps at 3600). */
  ttlSecs?: number
  nowSecs?: number
}
```

## p256DidKey

`did:key` of a P-256 public key (multicodec 0x1200 → varint `80 24`, compressed point) — Hovi's issuer shape.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L127)

Import: `import {p256DidKey} from 'tasra-sdk/oid4vp'`

```ts
declare function p256DidKey(publicKeyUncompressedOrCompressed: Uint8Array): string
```

| Parameter | Type | Description |
|---|---|---|
| `publicKeyUncompressedOrCompressed` | `Uint8Array<ArrayBufferLike>` |  |

Returns: `string`.

## p256DidKeyIssuer

A P-256 issuer as `did:key` (Hovi Studio's issuer shape) from a private scalar.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L154)

Import: `import {p256DidKeyIssuer} from 'tasra-sdk/oid4vp'`

```ts
declare function p256DidKeyIssuer(privateKey: Uint8Array, opts?: { fragmentKid?: boolean; }): SdJwtIssuer
```

| Parameter | Type | Description |
|---|---|---|
| `privateKey` | `Uint8Array<ArrayBufferLike>` |  |
| `opts` | `{ fragmentKid?: boolean; }` |  |

Returns: `SdJwtIssuer`.

## p256HolderKey

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L71)

Import: `import {p256HolderKey} from 'tasra-sdk/oid4vp'`

```ts
declare function p256HolderKey(privateKey: Uint8Array): HolderKey
```

| Parameter | Type | Description |
|---|---|---|
| `privateKey` | `Uint8Array<ArrayBufferLike>` |  |

Returns: `HolderKey`.

## p256PublicJwk

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L62)

Import: `import {p256PublicJwk} from 'tasra-sdk/oid4vp'`

```ts
declare function p256PublicJwk(privateKey: Uint8Array): EcJwk
```

| Parameter | Type | Description |
|---|---|---|
| `privateKey` | `Uint8Array<ArrayBufferLike>` |  |

Returns: `EcJwk`.

## parseCredentialOfferUri

Parse an `openid-credential-offer://?credential_offer=…` or `…?credential_offer_uri=…` URI.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/oid4vci.ts#L20)

Import: `import {parseCredentialOfferUri} from 'tasra-sdk/oid4vp'`

```ts
declare function parseCredentialOfferUri(uri: string): { offer?: CredentialOffer; offerUri?: string; }
```

| Parameter | Type | Description |
|---|---|---|
| `uri` | `string` |  |

Returns: `{ offer?: CredentialOffer; offerUri?: string; }`.

## ParsedSdJwt

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L27)

```ts
export interface ParsedSdJwt {
  compact: string
  /** The issuer-signed JWT (first `~`-segment). */
  issuerJwt: string
  header: Record<string, unknown>
  payload: Record<string, unknown>
  disclosures: Disclosure[]
  /** The Key Binding JWT, when the compact carries one (a presentation). */
  kbJwt?: string
}
```

## parseOpenid4vpUri

`openid4vp://?client_id=…&request_uri=…` (a QR payload or deep link) → its two parameters.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/request-object.ts#L46)

Import: `import {parseOpenid4vpUri} from 'tasra-sdk/oid4vp'`

```ts
declare function parseOpenid4vpUri(uri: string): { clientId?: string; requestUri: string; }
```

| Parameter | Type | Description |
|---|---|---|
| `uri` | `string` |  |

Returns: `{ clientId?: string; requestUri: string; }`.

## parseSdJwt

Split a compact SD-JWT (`issuer~d1~…~[kb]`) into its parts, checking every disclosure against `_sd`.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L50)

Import: `import {parseSdJwt} from 'tasra-sdk/oid4vp'`

```ts
declare function parseSdJwt(compact: string): ParsedSdJwt
```

| Parameter | Type | Description |
|---|---|---|
| `compact` | `string` |  |

Returns: `ParsedSdJwt`.

## payloadDigest

Compute the `payload_digest` for a given action and message.

For `sign` and `ibe-extract`, this is `sha256(message_bytes)` as 0x-hex.
Other actions should supply the digest directly.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L176)

Import: `import {payloadDigest} from 'tasra-sdk/oid4vp'`

```ts
declare function payloadDigest(action: string, messageHex: string): string
```

| Parameter | Type | Description |
|---|---|---|
| `action` | `string` |  |
| `messageHex` | `string` |  |

Returns: `string`.

## payloadDigestFor

The per-action `payload_digest` the keeper recomputes at `enforce_request_binding`:
`sign` = sha256(message), `ibe-extract` = sha256(identity), `decrypt` = the ciphertext
digest ({@link decryptPayloadDigest}), `dual-approve` = the digest the caller already
holds. Pass exactly one of the inputs the action needs.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/binding.ts#L97)

Import: `import {payloadDigestFor} from 'tasra-sdk/oid4vp'`

```ts
declare function payloadDigestFor(action: CommitteeAction, args: { message?: Uint8Array; identity?: string; payloadDigest?: Uint8Array; }): Uint8Array
```

| Parameter | Type | Description |
|---|---|---|
| `action` | `CommitteeAction` |  |
| `args` | `{ message?: Uint8Array; identity?: string; payloadDigest?: Uint8Array; }` |  |

Returns: `Uint8Array<ArrayBufferLike>`.

## peekSdJwt

Decode (no verification) the issuer JWT's payload of a compact SD-JWT — for display.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L224)

Import: `import {peekSdJwt} from 'tasra-sdk/oid4vp'`

```ts
declare function peekSdJwt(compact: string): { iss?: string; vct?: string; exp?: number; sub?: string; }
```

| Parameter | Type | Description |
|---|---|---|
| `compact` | `string` |  |

Returns: `{ iss?: string; vct?: string; exp?: number; sub?: string; }`.

## planPresentation

Match held SD-JWT VCs against the request's `dcql_query`. Expired credentials are skipped.
Advisory: the drawn verifiers decide; a wrong local answer costs a wasted request, never access.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/wallet.ts#L46)

Import: `import {planPresentation} from 'tasra-sdk/oid4vp'`

```ts
declare function planPresentation(ro: Pick<VerifiedRequestObject, "claims">, held: readonly HeldSdJwt[], nowSecs?: number): PresentationPlan
```

| Parameter | Type | Description |
|---|---|---|
| `ro` | `Pick<VerifiedRequestObject, "claims">` |  |
| `held` | `readonly HeldSdJwt[]` |  |
| `nowSecs` | `number` |  |

Returns: `PresentationPlan`.

## pollOid4vpSession

Poll an OID4VP session on the Verifier Agent for its result — ONE poll.

The reply is validated against the contract: `status` ∈ {pending, done, failed}, a
`phase` the UI may show, and, when done, a well-formed compound token. The poll secret
travels only in the `Authorization` header and never appears in an error.

Throws `VerifierAgentSessionError`: `unavailable` for 502/503/504 (the session may still complete —
`waitForSession` keeps polling), `protocol` for any other non-2xx or a malformed reply.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L344)

Import: `import {pollOid4vpSession} from 'tasra-sdk/oid4vp'`

```ts
declare function pollOid4vpSession(verifierAgentUrl: string, sessionId: string, pollSecret: string): Promise<SessionStatusResult>
```

| Parameter | Type | Description |
|---|---|---|
| `verifierAgentUrl` | `string` |  |
| `sessionId` | `string` |  |
| `pollSecret` | `string` |  |

Returns: `Promise<SessionStatusResult>`.

## PresentationCandidate

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/wallet.ts#L23)

```ts
export interface PresentationCandidate {
  held: HeldSdJwt
  parsed: ParsedSdJwt
  view: CredentialView
  /** The credential query id this credential answers. */
  queryId: string
}
```

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

## presentationOperationTypedData

The typed data a creator (or delegate) signs, plus the wire operation and the verifier-agent's `message_hex`.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/verifier-agent.ts#L64)

Import: `import {presentationOperationTypedData} from 'tasra-sdk/oid4vp'`

```ts
declare function presentationOperationTypedData(input: OperationInput): { typedData: Parameters<TypedDataSigner["signTypedData"]>[0]; operation: PresentationOperation; messageHex: string; payloadDigest: Uint8Array; }
```

| Parameter | Type | Description |
|---|---|---|
| `input` | `OperationInput` |  |

Returns: `{ typedData: Parameters<TypedDataSigner["signTypedData"]>[0]; operation: PresentationOperation; messageHex: string; payloadDigest: Uint8Array; }`.

## PresentationPlan

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/wallet.ts#L31)

```ts
export interface PresentationPlan {
  /** Whether the local (advisory) selection found a credential that satisfies the request. */
  satisfies: boolean
  /** Every held credential that answers some query — the choice to offer the user. */
  candidates: PresentationCandidate[]
  /** The default choice (the evaluator's pick), when satisfied. */
  chosen?: PresentationCandidate
  /** Query ids nothing in the wallet answers. */
  unmatched: string[]
}
```

## PresentOpts

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/wallet.ts#L126)

```ts
export interface PresentOpts extends VerifyRequestObjectOpts {
  fetchImpl?: typeof fetch
  /** Pick among the candidates (default: the evaluator's choice). Return `undefined` to abort. */
  choose?: (plan: PresentationPlan) => PresentationCandidate | undefined | Promise<PresentationCandidate | undefined>
  disclose?: 'all' | readonly string[]
}
```

## presentSdJwt

Build the presentation `issuer~selected…~kb-jwt`, the KB-JWT signed by the holder's own key.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L186)

Import: `import {presentSdJwt} from 'tasra-sdk/oid4vp'`

```ts
declare function presentSdJwt(opts: PresentSdJwtOpts): string
```

| Parameter | Type | Description |
|---|---|---|
| `opts` | `PresentSdJwtOpts` |  |

Returns: `string`.

## PresentSdJwtOpts

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L171)

```ts
export interface PresentSdJwtOpts {
  parsed: ParsedSdJwt
  /** Which disclosures to reveal: claim names, or `'all'`. Undisclosed claims stay hidden. */
  disclose: 'all' | readonly string[]
  holder: HolderKey
  /** The JAR's `nonce`. */
  nonce: string
  /** The JAR's `client_id`, VERBATIM (prefix included). */
  aud: string
  nowSecs?: number
  /** Extra KB-JWT claims (e.g. `transaction_data_hashes`). */
  extraKbClaims?: Record<string, unknown>
}
```

## presentToRequestUri

The whole wallet flow for one QR / deep link: fetch + verify the JAR, plan, let the caller
choose (consent screen), bind, encrypt, POST.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/wallet.ts#L137)

Import: `import {presentToRequestUri} from 'tasra-sdk/oid4vp'`

```ts
declare function presentToRequestUri(requestUriOrOpenid4vp: string, held: readonly HeldSdJwt[], holder: HolderKey, opts?: PresentOpts): Promise<{ ro: VerifiedRequestObject; plan: PresentationPlan; built: BuiltResponse; redirectUri?: string; }>
```

| Parameter | Type | Description |
|---|---|---|
| `requestUriOrOpenid4vp` | `string` |  |
| `held` | `readonly HeldSdJwt[]` |  |
| `holder` | `HolderKey` |  |
| `opts` | `PresentOpts` |  |

Returns: `Promise<{ ro: VerifiedRequestObject; plan: PresentationPlan; built: BuiltResponse; redirectUri?: string; }>`.

## randomHolderKey

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L82)

Import: `import {randomHolderKey} from 'tasra-sdk/oid4vp'`

```ts
declare function randomHolderKey(): HolderKey
```

Returns: `HolderKey`.

## receiveCredential

Run the pre-authorized code flow end to end and return the issued credential.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/oid4vci.ts#L66)

Import: `import {receiveCredential} from 'tasra-sdk/oid4vp'`

```ts
declare function receiveCredential(opts: ReceiveCredentialOpts): Promise<ReceivedCredential>
```

| Parameter | Type | Description |
|---|---|---|
| `opts` | `ReceiveCredentialOpts` |  |

Returns: `Promise<ReceivedCredential>`.

## ReceiveCredentialOpts

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/oid4vci.ts#L38)

```ts
export interface ReceiveCredentialOpts {
  /** The scanned URI, or an already-parsed offer. */
  offerUri?: string
  offer?: CredentialOffer
  holder: HolderKey
  /** The transaction code the issuer displayed, when the grant asks for one. */
  txCode?: string
  /** Which configuration to request (default: the offer's first). */
  credentialConfigurationId?: string
  fetchImpl?: typeof fetch
  nowSecs?: number
}
```

## ReceivedCredential

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/oid4vci.ts#L51)

```ts
export interface ReceivedCredential {
  /** The compact `dc+sd-jwt` (or whatever the configuration's format is). */
  credential: string
  configurationId: string
  format: string
  issuer: string
}
```

## requestedClaimNames

The top-level claim names a credential query asks to see.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/wallet.ts#L72)

Import: `import {requestedClaimNames} from 'tasra-sdk/oid4vp'`

```ts
declare function requestedClaimNames(query: Query, queryId: string): string[]
```

| Parameter | Type | Description |
|---|---|---|
| `query` | `Query` |  |
| `queryId` | `string` |  |

Returns: `string[]`.

## requestHash

`keccak256(DOMAIN ‖ chain_id u64 BE ‖ slot_id ‖ len(action) u32 BE ‖ action ‖ payload_digest)` —
the ONE binding hash the verifier-agent, the JAR signer, every drawn verifier, the keeper, the
accountant audit and this SDK compute. The wallet's request body is deliberately NOT in it.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/binding.ts#L42)

Import: `import {requestHash} from 'tasra-sdk/oid4vp'`

```ts
declare function requestHash(chainId: number | bigint, slotId: Uint8Array, action: CommitteeAction, payloadDigest: Uint8Array): Uint8Array
```

| Parameter | Type | Description |
|---|---|---|
| `chainId` | `number &#124; bigint` |  |
| `slotId` | `Uint8Array<ArrayBufferLike>` |  |
| `action` | `CommitteeAction` |  |
| `payloadDigest` | `Uint8Array<ArrayBufferLike>` |  |

Returns: `Uint8Array<ArrayBufferLike>`.

## RequestObjectClaims

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/request-object.ts#L14)

```ts
export interface RequestObjectClaims {
  iss: string
  client_id: string
  response_type?: string
  /** `direct_post.jwt` (the verifier-agent always) or `direct_post`. */
  response_mode?: string
  response_uri: string
  nonce: string
  state: string
  iat?: number
  exp?: number
  dcql_query: DcqlQuery
  client_metadata?: {
    jwks?: {keys: Jwk[]}
    vp_formats_supported?: Record<string, unknown>
    encrypted_response_enc_values_supported?: string[]
    [k: string]: unknown
  }
  transaction_data?: string[]
  [k: string]: unknown
}
```

## resolveDidWeb

Fetch and minimally validate a `did:web` document.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/did-web.ts#L37)

Import: `import {resolveDidWeb} from 'tasra-sdk/oid4vp'`

```ts
declare function resolveDidWeb(did: string, opts?: ResolveOpts): Promise<DidDocument>
```

| Parameter | Type | Description |
|---|---|---|
| `did` | `string` |  |
| `opts` | `ResolveOpts` |  |

Returns: `Promise<DidDocument>`.

## ResolveOpts

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/did-web.ts#L30)

```ts
export interface ResolveOpts {
  fetchImpl?: typeof fetch
  /** Allow `http://` for a loopback host (tests, local fleets); never for a public host. */
  allowInsecureLoopback?: boolean
}
```

## responseEncryptionKey

The ephemeral P-256 key the wallet must encrypt its response to, when the verifier-agent served one.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/request-object.ts#L96)

Import: `import {responseEncryptionKey} from 'tasra-sdk/oid4vp'`

```ts
declare function responseEncryptionKey(ro: Pick<VerifiedRequestObject, "claims">): EcJwk | undefined
```

| Parameter | Type | Description |
|---|---|---|
| `ro` | `Pick<VerifiedRequestObject, "claims">` |  |

Returns: `EcJwk | undefined`.

## sdHash

`base64url(sha256(prefix))` where `prefix` is everything before the KB-JWT, trailing `~` included.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L88)

Import: `import {sdHash} from 'tasra-sdk/oid4vp'`

```ts
declare function sdHash(prefix: string): string
```

| Parameter | Type | Description |
|---|---|---|
| `prefix` | `string` |  |

Returns: `string`.

## sdJwtClaims

The credential's claims as the verifier sees them: plain payload claims + disclosed ones.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L70)

Import: `import {sdJwtClaims} from 'tasra-sdk/oid4vp'`

```ts
declare function sdJwtClaims(parsed: ParsedSdJwt): Record<string, unknown>
```

| Parameter | Type | Description |
|---|---|---|
| `parsed` | `ParsedSdJwt` |  |

Returns: `Record<string, unknown>`.

## sdJwtCredentialView

A {@link CredentialView} for the DCQL evaluator: format `dc+sd-jwt`, `types` = [`vct`].

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L81)

Import: `import {sdJwtCredentialView} from 'tasra-sdk/oid4vp'`

```ts
declare function sdJwtCredentialView(parsed: ParsedSdJwt): CredentialView
```

| Parameter | Type | Description |
|---|---|---|
| `parsed` | `ParsedSdJwt` |  |

Returns: `CredentialView`.

## SdJwtIssuer

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L94)

```ts
export interface SdJwtIssuer {
  /** The issuer DID the credential's `iss` names; `kid` = `${did}#${fragment}` unless given. */
  did: string
  kid?: string
  signer: JwsSigner
}
```

## SessionPhase

What the client may show while `status` is `pending` (gap-closure P6): never a secret,
never a promise — `done` means the committee answered, not that the operation ran.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L88)

```ts
export type SessionPhase = 'awaiting_wallet' | 'verifying' | 'done' | 'failed'
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

## signCompactJws

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L165)

Import: `import {signCompactJws} from 'tasra-sdk/oid4vp'`

```ts
declare function signCompactJws(header: Record<string, unknown>, payload: Record<string, unknown>, signer: JwsSigner): string
```

| Parameter | Type | Description |
|---|---|---|
| `header` | `Record<string, unknown>` |  |
| `payload` | `Record<string, unknown>` |  |
| `signer` | `JwsSigner` |  |

Returns: `string`.

## submitResponse

POST the built response to `response_uri`; returns the verifier-agent's `redirect_uri` when it gives one.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/wallet.ts#L115)

Import: `import {submitResponse} from 'tasra-sdk/oid4vp'`

```ts
declare function submitResponse(ro: Pick<VerifiedRequestObject, "claims">, built: Pick<BuiltResponse, "form">, fetchImpl?: typeof fetch): Promise<{ redirectUri?: string; }>
```

| Parameter | Type | Description |
|---|---|---|
| `ro` | `Pick<VerifiedRequestObject, "claims">` |  |
| `built` | `Pick<BuiltResponse, "form">` |  |
| `fetchImpl` | `{ (input: RequestInfo &#124; URL, init?: RequestInit): Promise<Response>; (input: string &#124; URL &#124; Request, init?: RequestInit): Promise<Response>; }` |  |

Returns: `Promise<{ redirectUri?: string; }>`.

## TypedDataSigner

Anything that signs EIP-712 typed data for an address — a viem `LocalAccount` or `WalletClient`-bound account fits.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/verifier-agent.ts#L36)

```ts
export interface TypedDataSigner {
  address: `0x${string}`
  signTypedData(args: {
    domain: {name: string; version: string; chainId: number; verifyingContract: `0x${string}`}
    types: typeof PRESENTATION_OPERATION_TYPES
    primaryType: 'PresentationOperation'
    message: {chainId: bigint; slotId: `0x${string}`; action: string; payloadDigest: `0x${string}`; description: string; exp: bigint}
  }): Promise<`0x${string}`>
}
```

## utf8

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L10)

Import: `import {utf8} from 'tasra-sdk/oid4vp'`

```ts
declare function utf8(s: string): Uint8Array
```

| Parameter | Type | Description |
|---|---|---|
| `s` | `string` |  |

Returns: `Uint8Array<ArrayBufferLike>`.

## verificationKey

The JWK behind `kid` (a full DID URL or a `#fragment`) in `doc`.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/did-web.ts#L49)

Import: `import {verificationKey} from 'tasra-sdk/oid4vp'`

```ts
declare function verificationKey(doc: DidDocument, kid: string): Jwk
```

| Parameter | Type | Description |
|---|---|---|
| `doc` | `DidDocument` |  |
| `kid` | `string` |  |

Returns: `Jwk`.

## VerifiedRequestObject

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/request-object.ts#L36)

```ts
export interface VerifiedRequestObject {
  jwt: string
  header: {alg: string; typ?: string; kid?: string}
  claims: RequestObjectClaims
  /** The DID `iss` names, after the `client_id` prefix agreed with it. */
  signerDid: string
  signerKey: Jwk
}
```

## verifierAgentResult

Validate request binding and proof encoding after either URL or registered-session polling.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/verifier-agent.ts#L163)

Import: `import {verifierAgentResult} from 'tasra-sdk/oid4vp'`

```ts
declare function verifierAgentResult(session: Pick<OpenedVerifierAgentSession, "sessionId" | "requestHash">, r: SessionStatusResult): VerifierAgentResult
```

| Parameter | Type | Description |
|---|---|---|
| `session` | `Pick<OpenedVerifierAgentSession, "sessionId" &#124; "requestHash">` |  |
| `r` | `SessionStatusResult` |  |

Returns: `VerifierAgentResult`.

## VerifierAgentResult

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/verifier-agent.ts#L122)

```ts
export interface VerifierAgentResult {
  token: CompoundTokenWire
  bindingPreimage?: Record<string, unknown>
  /**
   * The drawn verifiers' snapshot membership proofs the verifier-agent built at session creation —
   * hand them to every keeper call (`verifierProofs`): a keeper in snapshot-required mode
   * (`api.require_verifier_proofs`) refuses a committee request without them.
   */
  verifierProofs?: VerifierProof[]
}
```

## VerifierAgentSessionError

A Verifier Agent session did not produce a compound token. `kind` says why;
`retryable` is true only for `timeout` and `unavailable` — the session may
still complete, so poll again. Extends {@link TasraError}.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L118)

```ts
(kind: VerifierAgentSessionErrorKind, correlation: string, message: string, httpStatus?: number): VerifierAgentSessionError
```

Import: `import {VerifierAgentSessionError} from 'tasra-sdk/oid4vp'`

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

## verifierAgentVerifierProofs

The verifier-agent's `verifier_proofs` DTO (`{verifier_index, operator, pubkey, proof}`) → the SDK shape.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/verifier-agent.ts#L134)

Import: `import {verifierAgentVerifierProofs} from 'tasra-sdk/oid4vp'`

```ts
declare function verifierAgentVerifierProofs(raw: unknown): VerifierProof[] | undefined
```

| Parameter | Type | Description |
|---|---|---|
| `raw` | `unknown` |  |

Returns: `VerifierProof[] | undefined`.

## verifyCompactJws

Verify a compact JWS under `jwk` and return its decoded payload; throws on any failure.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/jose.ts#L175)

Import: `import {verifyCompactJws} from 'tasra-sdk/oid4vp'`

```ts
declare function verifyCompactJws<T = Record<string, unknown>>(jws: string, jwk: Jwk): { header: Record<string, unknown>; payload: T; }
```

| Parameter | Type | Description |
|---|---|---|
| `jws` | `string` |  |
| `jwk` | `Jwk` |  |

Returns: `{ header: Record<string, unknown>; payload: T; }`.

## verifyKbJwt

What the verifier checks of a presentation's KB-JWT, mirrored for tests and wallet self-checks.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L205)

Import: `import {verifyKbJwt} from 'tasra-sdk/oid4vp'`

```ts
declare function verifyKbJwt(presentation: string, expected: { nonce: string; aud: string; }): { holderJwk: Jwk; claims: Record<string, unknown>; }
```

| Parameter | Type | Description |
|---|---|---|
| `presentation` | `string` |  |
| `expected` | `{ nonce: string; aud: string; }` |  |

Returns: `{ holderJwk: Jwk; claims: Record<string, unknown>; }`.

## verifyRequestObject

Verify a JAR: signature under the key its `kid` names in the `iss` DID, `typ`, `exp`, `client_id` ↔ `iss`.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/request-object.ts#L75)

Import: `import {verifyRequestObject} from 'tasra-sdk/oid4vp'`

```ts
declare function verifyRequestObject(jwt: string, opts?: VerifyRequestObjectOpts): Promise<VerifiedRequestObject>
```

| Parameter | Type | Description |
|---|---|---|
| `jwt` | `string` |  |
| `opts` | `VerifyRequestObjectOpts` |  |

Returns: `Promise<VerifiedRequestObject>`.

## VerifyRequestObjectOpts

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/request-object.ts#L67)

```ts
export interface VerifyRequestObjectOpts {
  resolveKey?: KeyResolver
  nowSecs?: number
  /** Seconds of clock skew tolerated on `exp`. */
  leewaySecs?: number
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

Import: `import {waitForSession} from 'tasra-sdk/oid4vp'`

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

## WaitOpts

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L391)

```ts
export interface WaitOpts {
  /** Ceiling for the growing interval (default 4 × intervalMs). */
  maxIntervalMs?: number
  /** Cancel (a user closed the wallet prompt): rejects with `cancelled`. */
  signal?: AbortSignal
  /** Called on every poll with the phase the UI may show. */
  onPhase?: (phase: SessionPhase) => void
  /** Randomness for the jitter (tests inject a fixed value). */
  random?: () => number
}
```

## Constants and ABI values

| Export | Definition |
|---|---|
| `CLIENT_ID_PREFIX_DID` | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/request-object.ts#L12) |
| `COMMITTEE_ACTIONS` | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/binding.ts#L15) |
| `CREDENTIAL_OFFER_SCHEME` | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/oid4vci.ts#L9) |
| `DECRYPT_DIGEST_DOMAIN` | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/binding.ts#L12) |
| `KB_JWT_TYP` | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L15) |
| `PRE_AUTHORIZED_GRANT` | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/oid4vci.ts#L10) |
| `PRESENTATION_EIP712_NAME` | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/verifier-agent.ts#L20) |
| `PRESENTATION_EIP712_VERSION` | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/verifier-agent.ts#L21) |
| `PRESENTATION_OPERATION_TYPES` | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/verifier-agent.ts#L24) |
| `PROOF_TYP` | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/oid4vci.ts#L11) |
| `REQUEST_BINDING_DOMAIN` | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/binding.ts#L10) |
| `REQUEST_OBJECT_TYP` | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/request-object.ts#L11) |
| `SD_JWT_TYP` | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/sd-jwt.ts#L14) |
| `VP_NONCE_DOMAIN` | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/oid4vp/binding.ts#L11) |
