# tasra-sdk/verifier-agent

Generated from public TypeScript exports. Run `npm run docs:reference` to update.

[Reference index](README.md) · [Task guides](../README.md) · [Errors](../errors.md)

<details>
<summary>Find an export</summary>

- [assertCompoundTokenWire](#assertcompoundtokenwire)
- [createOauthSession](#createoauthsession)
- [CreateOauthSessionResult](#createoauthsessionresult)
- [createOid4vpSession](#createoid4vpsession)
- [CreateSessionParams](#createsessionparams)
- [CreateSessionResult](#createsessionresult)
- [nextPollDelay](#nextpolldelay)
- [parseVerifierAgentSessionStatus](#parseverifieragentsessionstatus)
- [payloadDigest](#payloaddigest)
- [pollOid4vpSession](#polloid4vpsession)
- [PresentationDelegation](#presentationdelegation)
- [PresentationOperation](#presentationoperation)
- [SessionPhase](#sessionphase)
- [SessionStatusResult](#sessionstatusresult)
- [submitOauthResponse](#submitoauthresponse)
- [VerifierAgentSessionError](#verifieragentsessionerror)
- [VerifierAgentSessionErrorKind](#verifieragentsessionerrorkind)
- [waitForSession](#waitforsession)
- [WaitOpts](#waitopts)

</details>

## assertCompoundTokenWire

The compound token the verifier-agent hands back must be the wire shape the keepers verify —
checked field by field before anything is built on it.

[Source](../../src/verifier-agent/index.ts#L140)

Import: `import {assertCompoundTokenWire} from 'tasra-sdk/verifier-agent'`

```ts
declare function assertCompoundTokenWire(raw: unknown, correlation: string): Record<string, unknown>
```

| Parameter | Type | Description |
|---|---|---|
| `raw` | `unknown` |  |
| `correlation` | `string` |  |

Returns: `Record<string, unknown>`.

## createOauthSession

Open an `oauth` session — same creator authorisation, same committee draw, same
derived nonce, same poll contract as {@link createOid4vpSession}. No QR, no Request
Object, no JWE key: the client presents an access token its own IdP minted.

[Source](../../src/verifier-agent/index.ts#L233)

Import: `import {createOauthSession} from 'tasra-sdk/verifier-agent'`

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

[Source](../../src/verifier-agent/index.ts#L67)

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

[Source](../../src/verifier-agent/index.ts#L196)

Import: `import {createOid4vpSession} from 'tasra-sdk/verifier-agent'`

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

[Source](../../src/verifier-agent/index.ts#L48)

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

[Source](../../src/verifier-agent/index.ts#L58)

```ts
export interface CreateSessionResult {
  sessionId: string
  /** Bearer token for polling — treat as a secret */
  pollSecret: string
  qrPayload: string
  requestUri: string
}
```

## nextPollDelay

The next polling delay: geometric growth (×1.5) capped at `max`, ±20 % full jitter.
Pure, so the schedule is testable without timers.

[Source](../../src/verifier-agent/index.ts#L404)

Import: `import {nextPollDelay} from 'tasra-sdk/verifier-agent'`

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

## parseVerifierAgentSessionStatus

Shared validation for the explicit-URL and registered-agent transports.

[Source](../../src/verifier-agent/index.ts#L371)

Import: `import {parseVerifierAgentSessionStatus} from 'tasra-sdk/verifier-agent'`

```ts
declare function parseVerifierAgentSessionStatus(data: Record<string, unknown>, sessionId: string): SessionStatusResult
```

| Parameter | Type | Description |
|---|---|---|
| `data` | `Record<string, unknown>` |  |
| `sessionId` | `string` |  |

Returns: `SessionStatusResult`.

## payloadDigest

Compute the `payload_digest` for a given action and message.

For `sign` and `ibe-extract`, this is `sha256(message_bytes)` as 0x-hex.
Other actions should supply the digest directly.

[Source](../../src/verifier-agent/index.ts#L176)

Import: `import {payloadDigest} from 'tasra-sdk/verifier-agent'`

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

[Source](../../src/verifier-agent/index.ts#L344)

Import: `import {pollOid4vpSession} from 'tasra-sdk/verifier-agent'`

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

[Source](../../src/verifier-agent/index.ts#L36)

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

[Source](../../src/verifier-agent/index.ts#L21)

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

## SessionPhase

What the client may show while `status` is `pending` (gap-closure P6): never a secret,
never a promise — `done` means the committee answered, not that the operation ran.

[Source](../../src/verifier-agent/index.ts#L88)

```ts
export type SessionPhase = 'awaiting_wallet' | 'verifying' | 'done' | 'failed'
```

## SessionStatusResult

See the declaration and linked source for the contract.

[Source](../../src/verifier-agent/index.ts#L90)

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

## submitOauthResponse

Deliver an access token + DPoP proof to an `oauth` session.

Speaks the RFC 9449 §9 resource-server contract — token in `Authorization: DPoP`, proof in
`DPoP:` — so a conformant client library needs no custom code. It also handles the
`use_dpop_nonce` challenge ITSELF: on a `401` carrying `DPoP-Nonce`, it re-mints the proof
with the server's nonce and resends ONCE. One retry, not a loop: a server that keeps
challenging is broken, and retrying forever would hide that.

`signer` must be the key the token is bound to — see `../auth/dpop.js` for the two shapes.

[Source](../../src/verifier-agent/index.ts#L288)

Import: `import {submitOauthResponse} from 'tasra-sdk/verifier-agent'`

```ts
declare function submitOauthResponse(verifierAgentUrl: string, args: { sessionId: string; pollSecret: string; accessToken: string; nonce: string; dpopHtu: string; signer: DpopSigner; }): Promise<void>
```

| Parameter | Type | Description |
|---|---|---|
| `verifierAgentUrl` | `string` |  |
| `args` | `{ sessionId: string; pollSecret: string; accessToken: string; nonce: string; dpopHtu: string; signer: DpopSigner; }` |  |

Returns: `Promise<void>`.

## VerifierAgentSessionError

A Verifier Agent session did not produce a compound token. `kind` says why;
`retryable` is true only for `timeout` and `unavailable` — the session may
still complete, so poll again. Extends {@link TasraError}.

[Source](../../src/verifier-agent/index.ts#L118)

```ts
(kind: VerifierAgentSessionErrorKind, correlation: string, message: string, httpStatus?: number): VerifierAgentSessionError
```

Import: `import {VerifierAgentSessionError} from 'tasra-sdk/verifier-agent'`

- `kind: VerifierAgentSessionErrorKind` — 
- `correlation: string` — The session id — safe to show and to log.
- `httpStatus: number &#124; undefined` — The HTTP status that produced a `protocol`/`unavailable` error, when there was one.
- `retryable: boolean` — `false` when retrying the identical request cannot succeed.
- `name: string` — 
- `message: string` — 
- `stack: string &#124; undefined` — 
- `cause: unknown` — 

## VerifierAgentSessionErrorKind

Why a session did not yield a token — the class the UI explains, with a NON-SECRET
correlation reference (the session id; the poll secret is never part of an error).

[Source](../../src/verifier-agent/index.ts#L101)

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

## waitForSession

Poll until the session reaches a terminal state (done or failed) — bounded by
`timeoutMs`, with a growing jittered interval so many clients never poll in lock-step.
A transient `unavailable` answer (a 503, a dropped connection) is retried within the
deadline; a `protocol` answer stops at once; the deadline is a `timeout` error; the
caller's `signal` is a `cancelled` error. A terminal `failed` is RETURNED (the caller
decides how to explain it) — see `awaitVerifierAgentResult` for the version that throws `refused`.

[Source](../../src/verifier-agent/index.ts#L422)

Import: `import {waitForSession} from 'tasra-sdk/verifier-agent'`

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

[Source](../../src/verifier-agent/index.ts#L391)

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

