# tasra-sdk/verifier-agent

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

Import: `import {VerifierAgentSessionError} from 'tasra-sdk/verifier-agent'`

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
<summary>Browse 9 functions</summary>

- [assertCompoundTokenWire](#assertcompoundtokenwire)
- [createOauthSession](#createoauthsession)
- [createOid4vpSession](#createoid4vpsession)
- [nextPollDelay](#nextpolldelay)
- [parseVerifierAgentSessionStatus](#parseverifieragentsessionstatus)
- [payloadDigest](#payloaddigest)
- [pollOid4vpSession](#polloid4vpsession)
- [submitOauthResponse](#submitoauthresponse)
- [waitForSession](#waitforsession)

</details>

### assertCompoundTokenWire

The compound token the verifier-agent hands back must be the wire shape the keepers verify -
 checked field by field before anything is built on it.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L159)

Import: `import {assertCompoundTokenWire} from 'tasra-sdk/verifier-agent'`

```ts
declare function assertCompoundTokenWire(raw: unknown, correlation: string): Record<string, unknown>;
```

| Parameter | Type | Description |
|---|---|---|
| ` raw ` | ` unknown ` | - Untrusted compound_token response value. |
| ` correlation ` | ` string ` | - Session identifier used to correlate validation errors. |

Returns: ` Record<string, unknown> `.

### createOauthSession

Open an `oauth` session - same creator authorisation, same committee draw, same
derived nonce, same poll contract as [createOid4vpSession](#createoid4vpsession). No QR, no Request
Object, no JWE key: the client presents an access token its own IdP minted.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L261)

Import: `import {createOauthSession} from 'tasra-sdk/verifier-agent'`

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

Import: `import {createOid4vpSession} from 'tasra-sdk/verifier-agent'`

```ts
declare function createOid4vpSession(verifierAgentUrl: string, params: CreateSessionParams): Promise<CreateSessionResult>;
```

| Parameter | Type | Description |
|---|---|---|
| ` verifierAgentUrl ` | ` string ` | - Verifier-agent HTTP base URL from the selected network manifest. |
| ` params ` | ` CreateSessionParams ` | - Signed operation, optional delegation and raw payload. |

Returns: ` Promise<CreateSessionResult> `.

### nextPollDelay

The next polling delay: geometric growth (times1.5) capped at `max`, plus or minus20 % full jitter.
 Pure, so the schedule is testable without timers.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L437)

Import: `import {nextPollDelay} from 'tasra-sdk/verifier-agent'`

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

### parseVerifierAgentSessionStatus

Shared validation for the explicit-URL and registered-agent transports.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L396)

Import: `import {parseVerifierAgentSessionStatus} from 'tasra-sdk/verifier-agent'`

```ts
declare function parseVerifierAgentSessionStatus(data: Record<string, unknown>, sessionId: string): SessionStatusResult;
```

| Parameter | Type | Description |
|---|---|---|
| ` data ` | ` Record<string, unknown> ` | - Untrusted JSON session response. |
| ` sessionId ` | ` string ` | - Session identifier used to correlate validation errors. |

Returns: ` SessionStatusResult `.

### payloadDigest

Compute the `payload_digest` for a given action and message.

For `sign` and `ibe-extract`, this is `sha256(message_bytes)` as 0x-hex.
Other actions should supply the digest directly.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L198)

Import: `import {payloadDigest} from 'tasra-sdk/verifier-agent'`

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

Import: `import {pollOid4vpSession} from 'tasra-sdk/verifier-agent'`

```ts
declare function pollOid4vpSession(verifierAgentUrl: string, sessionId: string, pollSecret: string): Promise<SessionStatusResult>;
```

| Parameter | Type | Description |
|---|---|---|
| ` verifierAgentUrl ` | ` string ` | - Verifier-agent HTTP base URL. |
| ` sessionId ` | ` string ` | - Opened session identifier. |
| ` pollSecret ` | ` string ` | - Secret returned at session creation; do not expose it in logs. |

Returns: ` Promise<SessionStatusResult> `.

### submitOauthResponse

Submit a DPoP-bound access token and proof to an OAuth session. The signer must use the key bound to that token. Retry once when the server responds with a DPoP nonce challenge.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L311)

Import: `import {submitOauthResponse} from 'tasra-sdk/verifier-agent'`

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

### waitForSession

Poll until the session reaches a terminal state (done or failed) - bounded by
`timeoutMs`, with a growing jittered interval so many clients never poll in lock-step.
A transient `unavailable` answer (a 503, a dropped connection) is retried within the
deadline; a `protocol` answer stops at once; the deadline is a `timeout` error; the
caller's `signal` is a `cancelled` error. A terminal `failed` is RETURNED (the caller
decides how to explain it) - see `awaitVerifierAgentResult` for the version that throws `refused`.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L459)

Import: `import {waitForSession} from 'tasra-sdk/verifier-agent'`

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
<summary>Browse 9 types</summary>

- [CreateOauthSessionResult](#createoauthsessionresult)
- [CreateSessionParams](#createsessionparams)
- [CreateSessionResult](#createsessionresult)
- [PresentationDelegation](#presentationdelegation)
- [PresentationOperation](#presentationoperation)
- [SessionPhase](#sessionphase)
- [SessionStatusResult](#sessionstatusresult)
- [VerifierAgentSessionErrorKind](#verifieragentsessionerrorkind)
- [WaitOpts](#waitopts)

</details>

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

### VerifierAgentSessionErrorKind

Why a session did not yield a token - the class the UI explains, with a NON-SECRET
correlation reference (the session id; the poll secret is never part of an error).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L114)

```ts
export type VerifierAgentSessionErrorKind = 'timeout' | 'refused' | 'unavailable' | 'protocol' | 'cancelled';
```

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
