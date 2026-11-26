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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L221)

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
<summary>Browse 11 functions</summary>

- [assertCompoundTokenWire](#assertcompoundtokenwire)
- [checkSessionGrantParams](#checksessiongrantparams)
- [createOauthSession](#createoauthsession)
- [createOid4vpSession](#createoid4vpsession)
- [nextPollDelay](#nextpolldelay)
- [parseVerifierAgentSessionStatus](#parseverifieragentsessionstatus)
- [payloadDigest](#payloaddigest)
- [pollOid4vpSession](#polloid4vpsession)
- [sessionGrantRequest](#sessiongrantrequest)
- [submitOauthResponse](#submitoauthresponse)
- [waitForSession](#waitforsession)

</details>

### assertCompoundTokenWire

The compound token the verifier-agent hands back must be the wire shape the keepers verify -
 checked field by field before anything is built on it.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L249)

Import: `import {assertCompoundTokenWire} from 'tasra-sdk/verifier-agent'`

```ts
declare function assertCompoundTokenWire(raw: unknown, correlation: string): Record<string, unknown>;
```

| Parameter | Type | Description |
|---|---|---|
| ` raw ` | ` unknown ` | - Untrusted compound_token response value. |
| ` correlation ` | ` string ` | - Session identifier used to correlate validation errors. |

Returns: ` Record<string, unknown> `.

### checkSessionGrantParams

Check a creation reply's `session_grant_params` against the request: present exactly when a
grant was requested, the requested slots and values echoed, each granted value at most the request.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L137)

Import: `import {checkSessionGrantParams} from 'tasra-sdk/verifier-agent'`

```ts
declare function checkSessionGrantParams(value: unknown, request: SessionGrantRequestWire | undefined): SessionGrantParamsReply | undefined;
```

| Parameter | Type | Description |
|---|---|---|
| ` value ` | ` unknown ` | - Untrusted `session_grant_params` reply value. |
| ` request ` | ` SessionGrantRequestWire \| undefined ` | - The canonical request sent ([sessionGrantRequest](#sessiongrantrequest)). |

Returns: ` SessionGrantParamsReply | undefined `.

### createOauthSession

Open an `oauth` session - same creator authorisation, same committee draw, same
derived nonce, same poll contract as [createOid4vpSession](#createoid4vpsession). No QR, no Request
Object, no JWE key: the client presents an access token its own IdP minted.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L381)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L336)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L676)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L609)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L313)

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

Fetch and validate one authorization session status. Transport failures, a request that exceeds its timeout and HTTP 502, 503 or 504 produce an unavailable error; malformed or other failed replies produce a protocol error; an aborted signal produces a cancelled error. The polling secret is sent in the Authorization header.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L554)

Import: `import {pollOid4vpSession} from 'tasra-sdk/verifier-agent'`

```ts
declare function pollOid4vpSession(verifierAgentUrl: string, sessionId: string, pollSecret: string, opts?: PollSessionOpts): Promise<SessionStatusResult>;
```

| Parameter | Type | Description |
|---|---|---|
| ` verifierAgentUrl ` | ` string ` | - Verifier-agent HTTP base URL. |
| ` sessionId ` | ` string ` | - Opened session identifier. |
| ` pollSecret ` | ` string ` | - Secret returned at session creation; do not expose it in logs. |
| ` opts? ` | ` PollSessionOpts ` | - Long-poll request, cancellation and per-request timeout. |

Returns: ` Promise<SessionStatusResult> `.

### sessionGrantRequest

Validate a session-mode request before anything is signed or sent: KEM decrypt only, a public
key, 1..16 distinct 32-byte slots naming the presentation's own slot, positive whole-second
lifetimes. Returns the canonical form the create body carries (slots lowercase and ascending,
the key re-encoded with exactly its RFC 7638 members), or undefined without a request.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L119)

Import: `import {sessionGrantRequest} from 'tasra-sdk/verifier-agent'`

```ts
declare function sessionGrantRequest(params: Pick<CreateSessionParams, 'operation' | 'sessionGrant'>): SessionGrantRequestWire | undefined;
```

| Parameter | Type | Description |
|---|---|---|
| ` params ` | ` Pick<CreateSessionParams, 'operation' \| 'sessionGrant'> ` | - Session creation parameters. |

Returns: ` SessionGrantRequestWire | undefined `.

### submitOauthResponse

Submit a DPoP-bound access token and proof to an OAuth session. The signer must use the key bound to that token. Retry once when the server responds with a DPoP nonce challenge.

Speaks the RFC 9449 §9 resource-server contract — token in `Authorization: DPoP`, proof in
`DPoP:` — so a conformant client library needs no custom code. It also handles the
`use_dpop_nonce` challenge ITSELF: on a `401` carrying `DPoP-Nonce`, it re-mints the proof
with the server's nonce and resends ONCE. One retry, not a loop: a server that keeps
challenging is broken, and retrying forever would hide that.

`signer` must be the key the token is bound to — see `../auth/dpop.js` for the two shapes.

Note: the proof is signed over `dpopHtu` — the agent's PUBLIC origin plus this session's route,
as [createOauthSession](#createoauthsession) returned it — and posted to `verifierAgentUrl`. When the two
name the same host (the normal case) they are the same URL. When a client reaches the
agent through a different base URL, the proof must still name the public one: that is
the origin the verifiers approved.

Throws `VerifierAgentSessionError`: `refused` when the agent reports the session failed
(the committee refused, or could not be reached — `message` says which; not retryable on
this session), `unavailable` for other 502/503/504, `protocol` for any other non-2xx.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L458)

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
| ` args ` | ` { sessionId: string; pollSecret: string; accessToken: string; nonce: string; dpopHtu: string; signer: DpopSigner; } ` | - Session credentials, DPoP-bound access token, nonce, `dpopHtu` and matching signer. |

Returns: ` Promise<void> `.

### waitForSession

Poll until the session reaches a terminal state (done or failed) - bounded by
`timeoutMs`, with a growing jittered interval so many clients never poll in lock-step.
Every request asks the verifier-agent to hold its reply until the session moves
(`?wait=1`). A reply whose phase moved forward is followed by the next request at once;
an unchanged reply is followed by the backoff sleep, unless it took 15 s or more (the
server's hold ended), when the next request also goes at once. A server without long-poll
support answers at once and is polled on the backoff schedule. Any phase change resets the
backoff to `intervalMs`.
A transient `unavailable` answer (a 503, a dropped connection) is retried within the
deadline; a `protocol` answer stops at once; the deadline is a `timeout` error; the
caller's `signal` is a `cancelled` error. A terminal `failed` is RETURNED (the caller
decides how to explain it) - see `awaitVerifierAgentResult` for the version that throws `refused`.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L707)

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
<summary>Browse 11 types</summary>

- [CreateOauthSessionResult](#createoauthsessionresult)
- [CreateSessionParams](#createsessionparams)
- [CreateSessionResult](#createsessionresult)
- [PollSessionOpts](#pollsessionopts)
- [PresentationDelegation](#presentationdelegation)
- [PresentationOperation](#presentationoperation)
- [SessionGrantParamsReply](#sessiongrantparamsreply)
- [SessionPhase](#sessionphase)
- [SessionStatusResult](#sessionstatusresult)
- [VerifierAgentSessionErrorKind](#verifieragentsessionerrorkind)
- [WaitOpts](#waitopts)

</details>

### CreateOauthSessionResult

an `oauth` session - the client brings a DPoP-bound access token.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L158)

```ts
export interface CreateOauthSessionResult {
    sessionId: string;
    pollSecret: string;
    nonce: string;
    dpopHtu: string;
    platformAudience: string;
    sessionGrantParams?: SessionGrantParamsReply;
}
```

Fields:

- **` sessionId `**: Opened authorization session identifier.
- **` pollSecret `**: Session secret used for polling and OAuth submission. Never expose it in logs.
- **` nonce `**: Initial DPoP challenge nonce for this session.
- **` dpopHtu `**: Canonical OAuth response URI to bind into the DPoP proof.
- **` platformAudience `**: Audience the identity provider must include in the access token for this platform.
- **` sessionGrantParams `**: Session mode: the granted (clamped) session parameters the agent answered at creation.

### CreateSessionParams

Signed operation, optional delegation and payload submitted to the verifier agent.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L64)

```ts
export interface CreateSessionParams {
    decryption?: DecryptionBindingWire;
    sessionGrant?: SessionGrantRequestWire;
    operation: PresentationOperation;
    operationSig: string;
    delegation?: PresentationDelegation;
    messageHex: string;
}
```

Fields:

- **` decryption `**: Public decryption binding committed by the signed operation; never include private recipient material.
- **` sessionGrant `**: Session mode (KEM `decrypt` only): also open a refreshable session grant for this FRESH public session key (`sessionGrantCreateFragment`). The presentation nonce then binds the key's RFC 7638 thumbprint; the grant arrives on the poll (`SessionStatusResult.sessionGrant`).
- **` operation `**: Signed operation details presented for authorization.
- **` operationSig `**: 0x-hex 65-byte EIP-712 signature over the operation
- **` delegation `**: Optional EIP-712 delegation from the slot creator
- **` messageHex `**: The raw payload as 0x-hex

### CreateSessionResult

Wallet presentation link and polling credentials for an opened authorization session.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L84)

```ts
export interface CreateSessionResult {
    sessionId: string;
    pollSecret: string;
    qrPayload: string;
    requestUri: string;
    sessionGrantParams?: SessionGrantParamsReply;
}
```

Fields:

- **` sessionId `**: Opened authorization session identifier.
- **` pollSecret `**: Bearer token for polling - treat as a secret
- **` qrPayload `**: OpenID4VP deep link for a wallet or QR code.
- **` requestUri `**: URL from which the wallet retrieves the signed request.
- **` sessionGrantParams `**: Session mode: the granted (clamped) session parameters the agent answered at creation.

### PollSessionOpts

Options for one session status request.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L537)

```ts
export interface PollSessionOpts {
    wait?: boolean;
    signal?: AbortSignal;
    timeoutMs?: number;
}
```

Fields:

- **` wait `**: Ask the verifier-agent to hold the reply until the session status or phase changes (`?wait=1`, up to 20 s). A server without that support answers at once.
- **` signal `**: Cancel the request: rejects with `cancelled`.
- **` timeoutMs `**: Per-request ceiling in milliseconds (default 30000, which covers the 20 s hold); a reply that does not arrive in time is `unavailable`.

### PresentationDelegation

EIP-712 delegation from the slot creator to a delegate address.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L46)

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

Operation details signed (EIP-712) by the key that opens the session: the slot creator, a
creator-signed delegate, or any other key (an open request: the slot's rule decides, and the
verifiers meter the signer's own quota).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L30)

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

### SessionGrantParamsReply

The clamped session-grant parameters of a creation reply (`session_grant_params`).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L98)

```ts
export interface SessionGrantParamsReply {
    sessionId: string;
    slots: string[];
    requested: {
        accessTtlSecs: number;
        idleTimeoutSecs: number;
        absoluteTtlSecs: number;
    };
    granted: {
        accessTtlSecs: number;
        idleTimeoutSecs: number;
        absoluteTtlSecs: number;
    };
}
```

Fields:

- **` sessionId `**: Lowercase 0x-prefixed 32-byte id of the session the grant will name.
- **` slots `**: The requested slots, lowercase and ascending.
- **` requested `**: The lifetimes as requested, in seconds.
- **` granted `**: The lifetimes the platform granted, each at most the request.

### SessionPhase

Displayable authorization progress. A done phase means the committee answered; it does not mean the requested signing or decryption operation executed.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L174)

```ts
export type SessionPhase = 'awaiting_wallet' | 'verifying' | 'done' | 'failed';
```

### SessionStatusResult

Authorization session progress and optional committee result or failure detail.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L177)

```ts
export interface SessionStatusResult {
    evidenceCt?: string;
    status: 'pending' | 'done' | 'failed';
    phase: SessionPhase;
    compoundToken?: Record<string, unknown>;
    verifierProofs?: unknown;
    bindingPreimage?: Record<string, unknown>;
    error?: string;
    sessionGrant?: {
        grant?: {
            session_grant: SessionGrantWire;
            refresh_seq: 0;
        };
        error?: string;
    };
}
```

Fields:

- **` evidenceCt `**: Sealed presentation (base64url `bincode(Ciphertext)`) the token's `evidence_hash` names, retained unchanged and posted to the keeper beside the token as `evidence_ct`.
- **` status `**: Pending, completed or failed authorization state.
- **` phase `**: Displayable progress within the authorization lifecycle.
- **` compoundToken `**: Committee token returned after successful authorization.
- **` verifierProofs `**: Verifier membership proofs for the selected snapshot.
- **` bindingPreimage `**: Operation context used to derive the request-binding hash.
- **` error `**: Optional failure detail reported by the verifier agent.
- **` sessionGrant `**: Session mode, once `done`: the quorum-signed grant as the agent returned it (`refresh_seq` 0), or the agent's `session_*` code saying why none came with the token. UNVERIFIED here: hand `grant` to `acceptSessionGrant`, which checks it against the request, the session key and each slot's anchored committee before anything uses it. Absent otherwise.

### VerifierAgentSessionErrorKind

Why a session did not yield a token - the class the UI explains, with a NON-SECRET
correlation reference (the session id; the poll secret is never part of an error).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L204)

```ts
export type VerifierAgentSessionErrorKind = 'timeout' | 'refused' | 'unavailable' | 'protocol' | 'cancelled';
```

### WaitOpts

Polling backoff, cancellation, progress callback and randomness options.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/verifier-agent/index.ts#L656)

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
