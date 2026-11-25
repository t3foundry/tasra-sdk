# tasra-sdk/app

Generated from public TypeScript exports.

[SDK reference](README.md) · [Task guides](../README.md) · [Errors](../errors.md)

## Classes

Clients, adapters and error classes.

<details>
<summary>Browse 12 classes</summary>

- [GrantedSession](#grantedsession)
- [TasraClient](#tasraclient)
- [ApplicationSlotRecoveryError](#applicationslotrecoveryerror)
- [CreationReconciliationRequiredError](#creationreconciliationrequirederror)
- [SessionEndedError](#sessionendederror)
- [SessionGrantUnavailableError](#sessiongrantunavailableerror)
- [SessionMessageError](#sessionmessageerror)
- [SessionRefreshError](#sessionrefresherror)
- [SessionRevokeIncompleteError](#sessionrevokeincompleteerror)
- [SessionRevokeUnconfirmedError](#sessionrevokeunconfirmederror)
- [SlotPolicyError](#slotpolicyerror)
- [TasraApplicationError](#tasraapplicationerror)

</details>

### GrantedSession

An accepted, refreshable session grant.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-grants.ts#L372)

Import: `import {GrantedSession} from 'tasra-sdk/app'`

```ts
declare class GrantedSession {
    constructor(opts: GrantedSessionOptions, sessionId: string, record: SessionRecord);
}
```

- ` readonly sessionId: string; ` — Lowercase 0x-prefixed 32-byte session id.

- ` current(): SessionGrantWire; ` — The current grant on the wire, for keeper requests. Throws once the session ended or the grant
is past its deadline. A read is a USE: it keeps the session from going idle.

- `` verifiedFor(slot: `0x${string}`): Promise<VerifiedSessionGrant>; `` — Verified grant for one slot (re-verified against the slot's anchored committee).

- ` key: SessionKeyHandle; ` — The session key bound by this grant.

- ` refresh(): Promise<SessionGrantWire>; ` — Refresh now: a session-key signature over `(grant_hash, seq, issued_at)` with a fresh seq;
the verifiers re-check status, rules, idle and absolute limits and sign a new grant. A typed
refusal, a 404 (verifiers without session support) or a local limit ends the session.

- ` beaconEpoch: bigint | undefined; ` — The newest beacon epoch this session has observed, if any.

- ` observeBeacon(epoch: bigint): void; ` — Report the beacon's latest epoch AS READ FROM THE CHAIN (the beacon poll, a fresh
`readCurrentBeaconEpoch`). Never pass an epoch a keeper or any other
service claims: observations never move backwards, so one inflated value would stall the
session until it is presented again. Once it is past the grant's epoch the grant is refreshed in the BACKGROUND
(` followBeacon `): keepers still admit the current grant for the whole next epoch, so the
refresh lands well before the boundary that would end it, and no message waits for it. An
observation never moves backwards.

- ` observeDraw(state: BeaconDrawState): void; ` — Report the beacon's latest epoch and its DRAW epoch AS READ FROM THE CHAIN at one head
(`readBeaconDrawState`; the `beacon.drawState` poll does this). As ` observeBeacon `, and a
follow refreshes only once the draw epoch is past the grant's (the agent can continue the
session onto it); until then nothing is sent. Observations never move backwards.

- ` drawEpoch: bigint | undefined; ` — The newest draw epoch observed, if a `beacon.drawState` is configured and has answered.

- ` followBeacon(): Promise<boolean>; ` — Bring the grant up to the newest observed beacon epoch, one continuation per epoch (the agent
continues a session exactly ONE epoch). A refresh that stays on the old epoch (the new epoch's
anchors have not landed at the agent) is retried, bounded, while the held grant is still
admissible (its epoch the beacon's latest or previous); never past that. Single-flight; resolves
`true` when the grant moved, `false` when it was already current. Throws
[SessionEndedError](#sessionendederror) when the session cannot continue (present again), and a
` TasraError ` when ` stop ` interrupts it.

A caller of this method WAITS for the follow, so while it waits the follow's pauses keep the
process alive (a background follow, started by ` observeBeacon `, never does): a waiter
whose only pending work is an unreferenced timer would be dropped when the event loop drains.

- ` refreshForEpoch(beaconEpoch: bigint): Promise<boolean>; ` — Refresh now if the beacon has moved past the grant's epoch (`beaconEpoch`, as read from the
chain). Keepers admit a grant only while its epoch is the beacon's
latest or previous, and the agent continues a session ONE epoch at a time, so a grant must
follow the beacon every epoch, not only before its `exp`: wait for a second move and the
session needs a new presentation. Resolves `true` when it refreshed, `false` when the grant is
already on (or ahead of) that epoch.

- ` start(): void; ` — Refresh in the background before each grant's `exp`, until stopped or the session ends. With
`beacon` configured, also poll the beacon and follow it (` observeBeacon `). Background
refreshes keep a session alive only while it is USED (` current `) within its idle timeout:
an unused session reaches the idle timeout and ends (`local-idle`, `onEnded`), so the next use
presents again.

- ` stop(): void; ` — Stop background refresh and the beacon poll, and interrupt a running beacon follow: its
` followBeacon ` waiters reject at once (`SessionEndedError` when the session ended,
otherwise a `TasraError`), never left waiting on a cleared timer.

**revoke** — Revoke at the verifiers (effective at the next refresh; an issued grant runs to its `exp`, at
most 45 s), then end locally. The agent answers 204 only once `n - k + 1` members of every draw
that could hold the session acknowledged (so the rest can never form a quorum); `503
session_revoke_partial` (and a 429/503 busy answer) is retried, each attempt under a fresh
durably reserved seq, until `deadlineMs`. The session stops serving the moment revoke starts
(journaled), even when the revoke has not completed; call `revoke()` again after a
[SessionRevokeIncompleteError](#sessionrevokeincompleteerror). A 404 (the agent holds no session for this grant, so no
verifier was asked) ends and disposes the session locally and throws
[SessionRevokeUnconfirmedError](#sessionrevokeunconfirmederror).

```ts
revoke(options?: {
    deadlineMs?: number;
    sleep?: (ms: number) => Promise<void>;
}): Promise<void>;
```

### TasraClient

Manifest-first application API. Construction validates configuration without network I/O.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/tasra-client.ts#L65)

Import: `import {TasraClient} from 'tasra-sdk/app'`

```ts
declare class TasraClient {
    constructor(options: TasraClientOptions);
}
```

- ` readonly deployment: TasraApplication['deployment']; ` — Validated public deployment configuration.

- ` readonly chain: TasraApplication['chain']; ` — Read-only chain client used for discovery and verification.

- ` readonly verifierAgentUrl?: string; ` — Verifier-agent endpoint selected from configuration or the manifest.

**slots** — Open existing slot handles or create a durable named slot.

```ts
readonly slots: TasraApplication['slots'] & {
    create: <M extends CreateApplicationSlot['mode']>(input: CreateApplicationSlot & {
        mode: M;
    }, options?: CreateSlotOptions) => Promise<CreatedSlot<M>>;
};
```

**identities** — Create and restore holder or issuer DID identities.

```ts
readonly identities: {
    create: (options?: {
        algorithm?: "Ed25519" | "P-256";
        seed?: Uint8Array;
    }) => TasraIdentity;
};
```

**credentials** — Issue, verify, present and authorize using holder-bound credentials.

```ts
readonly credentials: {
    issue: (options: IssueCredentialOptions) => string;
    verify: (credential: string, expected?: VerifyCredentialOptions) => Record<string, unknown>;
    policy: (options: CredentialPolicyOptions) => string;
    authorize: (options: CredentialAuthorizationOptions) => OperationAuthorizer;
    present: (requestUri: string, identity: TasraIdentity, credentials: readonly string[], options?: PresentCredentialsOptions) => Promise<{
        ro: VerifiedRequestObject;
        plan: PresentationPlan;
        built: BuiltResponse;
        redirectUri?: string;
    }>;
};
```

**wallets** — Create a key-backed wallet, connect an external wallet or adapt an ECDSA slot.

```ts
readonly wallets: {
    create: (options?: Parameters<typeof createLocalWallet>[1]) => ReturnType<typeof createLocalWallet>;
    connect: (provider: Parameters<typeof connectWallet>[1]) => ReturnType<typeof connectWallet>;
    fromSlot: (slotId: Hex, options: AuthorizedOperationOptions) => ReturnType<typeof createSlotWallet>;
};
```

- ` readonly check: TasraApplication['check']; ` — Check the RPC chain ID and required registry bytecode.

- ` static fromManifest(source: string | URL, options?: Omit<TasraClientOptions, 'manifest'> & LoadApplicationManifestOptions): Promise<TasraClient>; ` — Download a network manifest from tasra-releases and construct the application client. An optional independently trusted digest is checked before parsing.

### ApplicationSlotRecoveryError

A creation state that requires inspection or reconciliation before resuming.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/ready-slot.ts#L20)

Import: `import {ApplicationSlotRecoveryError} from 'tasra-sdk/app'`

```ts
declare class ApplicationSlotRecoveryError {
    constructor(code: ApplicationSlotRecoveryCode, recoveryName: string, message: string, details?: {
        slotId?: Hex;
        transactionHash?: Hex;
        cause?: unknown;
    });
}
```

- ` readonly code: ApplicationSlotRecoveryCode; ` — Recovery category; never infer it from the message.

- ` readonly recoveryName: string; ` — Stable name of the private creation journal.

- ` readonly slotId?: Hex; ` — Public slot ID, if the creation journal already contains one.

- ` readonly transactionHash?: Hex; ` — Known verifier-policy transaction hash, if available.

- ` readonly retryable: boolean; ` — `false` when retrying the identical request cannot succeed.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

### CreationReconciliationRequiredError

Creation paused because the journal has no transaction hash and the submission outcome is unknown. This does not establish whether broadcasting occurred.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/creation.ts#L42)

Import: `import {CreationReconciliationRequiredError} from 'tasra-sdk/app'`

```ts
declare class CreationReconciliationRequiredError {
    constructor(slotId: Hex, step: 'commit' | 'reveal');
}
```

- ` readonly slotId: Hex; ` — Slot whose creation transaction hash must be recovered.

- ` readonly step: 'commit' | 'reveal'; ` — Commit or reveal phase whose submission outcome is unknown.

- ` readonly retryable: boolean; ` — `false` when retrying the identical request cannot succeed.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

### SessionEndedError

A session that can no longer be refreshed: the application must present again.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-grants.ts#L149)

Import: `import {SessionEndedError} from 'tasra-sdk/app'`

```ts
declare class SessionEndedError {
    constructor(code: string, message: string);
}
```

- ` readonly code: string; ` — A definite refusal (` SESSION_REFUSAL_CODES `), `unsupported` (a verifier-agent without
session refresh) or `local-*` (`local-idle`, `local-absolute`, `local-expired`,
`local-revoking`, `local-stale`: the beacon left the grant's window).

- ` readonly retryable: boolean; ` — `false` when retrying the identical request cannot succeed.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

### SessionGrantUnavailableError

The presentation completed, but no session grant came with it.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-open.ts#L124)

Import: `import {SessionGrantUnavailableError} from 'tasra-sdk/app'`

```ts
declare class SessionGrantUnavailableError {
    constructor(code: string);
}
```

- ` readonly code: string; ` — The agent's `session_*` code (`session_unavailable`: the verifiers keep no issuance records;
`session_context_changed`: the beacon ticked before the wallet answered; ...), or
`session_grant_missing` when it sent none.

- ` readonly retryable: boolean; ` — `false` when retrying the identical request cannot succeed.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

### SessionMessageError

A message the keepers refused (after the one retry a stale grant earns).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-decrypt.ts#L102)

Import: `import {SessionMessageError} from 'tasra-sdk/app'`

```ts
declare class SessionMessageError {
    constructor(result: Extract<SessionDecryptResult, {
        ok: false;
    }>);
}
```

**result** — The keepers' refusal.

```ts
readonly result: Extract<SessionDecryptResult, {
    ok: false;
}>;
```

- ` code: string; ` — The first keeper code, for classification.

- ` slotBalance: boolean; ` — True when a keeper refused the message because the slot's Settlement balance does not cover
its unsettled metered work (HTTP 402): the slot's owner must fund the slot.

- ` readonly retryable: boolean; ` — `false` when retrying the identical request cannot succeed.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

### SessionRefreshError

A transient refresh failure: the held grant is unchanged and still serves until its `exp`.
`retryAfterMs` is the agent's `Retry-After`, when it sends one: no verifier-agent or verifier
sets it today (2026-11), so the backoff alone paces the retries; the support is kept for when
one does.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-grants.ts#L349)

Import: `import {SessionRefreshError} from 'tasra-sdk/app'`

```ts
declare class SessionRefreshError {
    constructor(status: number, code: string | undefined, retryAfterMs: number | undefined);
}
```

- ` readonly retryable: true; ` — Always true: a later refresh may pass.

- ` readonly status: number; ` — HTTP status of the agent's reply.

- ` readonly code: string | undefined; ` — The agent's error code, when it sent one.

- ` readonly retryAfterMs: number | undefined; ` — Milliseconds to wait before retrying, when known.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

### SessionRevokeIncompleteError

A revoke that has not reached a quorum of every draw yet (`session_revoke_partial`, or the agent
stayed busy) within its deadline. The session no longer serves locally; retry `revoke()`.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-grants.ts#L851)

Import: `import {SessionRevokeIncompleteError} from 'tasra-sdk/app'`

```ts
declare class SessionRevokeIncompleteError {
    constructor(code: string);
}
```

- ` readonly retryable: true; ` — Always true: the same call may be repeated (each attempt signs a fresh seq).

- ` readonly code: string; ` — The agent's last answer (`session_revoke_partial`, `session_rate_limited`, `status 503`, ...).

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

### SessionRevokeUnconfirmedError

The agent answered 404 to a revoke: it holds no session for this grant, so no verifier was asked
and nothing confirmed the revocation. The session was still ended and its key disposed locally,
so it can never be refreshed (only this key could); the last issued grant runs to its `exp`.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-grants.ts#L864)

Import: `import {SessionRevokeUnconfirmedError} from 'tasra-sdk/app'`

```ts
declare class SessionRevokeUnconfirmedError {
    constructor();
}
```

- ` readonly retryable: false; ` — Retrying cannot help: the agent has no session to relay it for.

- ` readonly code: "session_unknown"; ` — Always `session_unknown`.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

### SlotPolicyError

A slot policy statement or retrieval request refused before anything was signed or spent.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/policy-bootstrap.ts#L96)

Import: `import {SlotPolicyError} from 'tasra-sdk/app'`

```ts
declare class SlotPolicyError {
    constructor(code: SlotPolicyErrorCode, message: string, opts?: {
        cause?: unknown;
    });
}
```

- ` readonly code: SlotPolicyErrorCode; ` — Refusal category; never infer it from the message.

- ` readonly retryable: boolean; ` — `false` when retrying the identical request cannot succeed.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

### TasraApplicationError

An application operation rejected because its deployment, slot, authorization or result failed validation.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/client.ts#L48)

Import: `import {TasraApplicationError} from 'tasra-sdk/app'`

```ts
declare class TasraApplicationError {
    constructor(code: ApplicationErrorCode, message: string);
}
```

- ` readonly code: ApplicationErrorCode; ` — Stable application error category used to choose recovery behavior.

- ` readonly retryable: boolean; ` — `false` when retrying the identical request cannot succeed.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

## Functions

Operations you can import and call.

<details>
<summary>Browse 47 functions</summary>

- [acceptSessionGrant](#acceptsessiongrant)
- [admitSlotPolicySequence](#admitslotpolicysequence)
- [approveDualOperation](#approvedualoperation)
- [approveSigningIntent](#approvesigningintent)
- [approveWithCredential](#approvewithcredential)
- [assembleOperationApproval](#assembleoperationapproval)
- [connectWallet](#connectwallet)
- [createApplicationSlot](#createapplicationslot)
- [createIdentity](#createidentity)
- [createLocalWallet](#createlocalwallet)
- [createMemoryStore](#creatememorystore)
- [createPreparedSlot](#createpreparedslot)
- [createSessionKey](#createsessionkey)
- [createSlotPolicyRequest](#createslotpolicyrequest)
- [createSlotWallet](#createslotwallet)
- [createTasra](#createtasra)
- [credentialAuthorization](#credentialauthorization)
- [credentialPolicy](#credentialpolicy)
- [decryptBatchInSession](#decryptbatchinsession)
- [decryptInSession](#decryptinsession)
- [defineDeployment](#definedeployment)
- [identityApprover](#identityapprover)
- [issueCredential](#issuecredential)
- [issueSlotPolicyBootstrap](#issueslotpolicybootstrap)
- [loadApplicationManifest](#loadapplicationmanifest)
- [loadGrantedSession](#loadgrantedsession)
- [lockKeyRotation](#lockkeyrotation)
- [openDecryptSession](#opendecryptsession)
- [prepareOperationApproval](#prepareoperationapproval)
- [prepareSlot](#prepareslot)
- [presentCredentials](#presentcredentials)
- [readApprovalPolicy](#readapprovalpolicy)
- [registeredWalletAuthorization](#registeredwalletauthorization)
- [requireCurrentSlotPolicy](#requirecurrentslotpolicy)
- [requireDualOperationProof](#requiredualoperationproof)
- [resolveApplicationManifest](#resolveapplicationmanifest)
- [sessionGrantCreateFragment](#sessiongrantcreatefragment)
- [setApprovalPolicy](#setapprovalpolicy)
- [signingIntentCurve](#signingintentcurve)
- [signingIntentDigest](#signingintentdigest)
- [slotPolicyHash](#slotpolicyhash)
- [slotPolicyRequestTypedData](#slotpolicyrequesttypeddata)
- [slotPolicyTypedData](#slotpolicytypeddata)
- [toViemAccount](#toviemaccount)
- [verifyCredential](#verifycredential)
- [verifySlotPolicyBootstrap](#verifyslotpolicybootstrap)
- [verifySlotPolicyRequest](#verifyslotpolicyrequest)

</details>

### acceptSessionGrant

Accept the grant the agent returned for a session-mode presentation, after checking it against
what was requested and against each slot's anchored committee, then persist it. The granted
values may be lower than requested, never higher; the key thumbprint must be this key's.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-grants.ts#L241)

Import: `import {acceptSessionGrant} from 'tasra-sdk/app'`

```ts
declare function acceptSessionGrant(opts: GrantedSessionOptions, fragment: SessionGrantCreateFragment, response: unknown): Promise<GrantedSession>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` GrantedSessionOptions ` | - Store, transport, session key and clock. |
| ` fragment ` | ` SessionGrantCreateFragment ` | - The fragment sent at create. |
| ` response ` | ` unknown ` | - The completed poll's grant (`SessionStatusResult.sessionGrant.grant`): `session_grant` and `refresh_seq` 0. |

Returns: ` Promise<GrantedSession> `.

### admitSlotPolicySequence

Accept a verified statement against the holder's durable high-water mark: a lower sequence than
one already accepted is `replayed`, the same sequence with another statement `equivocated`.
Records a higher one.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/policy-bootstrap.ts#L309)

Import: `import {admitSlotPolicySequence} from 'tasra-sdk/app'`

```ts
declare function admitSlotPolicySequence(store: ApplicationStore, statement: SlotPolicyStatement): Promise<void>;
```

| Parameter | Type | Description |
|---|---|---|
| ` store ` | ` ApplicationStore ` | Durable private store of the holder application. |
| ` statement ` | ` SlotPolicyStatement ` | Verified statement. |

Returns: ` Promise<void> `.

### approveDualOperation

`dual-operation approve`: check the statement against the approver's own expectations (the
slot and operation digest it was asked to approve) and its request hash, then sign its exact
bytes. A credentialed approver adds its holder-bound dual-approve grant, which must bind this
statement.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/dual-operation.ts#L245)

Import: `import {approveDualOperation} from 'tasra-sdk/app'`

```ts
declare function approveDualOperation(input: {
    prepared: PreparedDualOperation;
    expectSlot: string;
    expectPayloadDigest: string;
    approver: DualOperationApprover;
    authorization?: {
        compound_token: CompoundTokenWire;
        verifier_proofs: VerifierProof[];
        evidence_ct?: string;
    };
    nowSecs?: number;
}): Promise<DualOperationApprovalRecord>;
```

| Parameter | Type | Description |
|---|---|---|
| ` input ` | See detailed type below. | - Prepared statement, the expected slot and operation digest, the approver and its optional grant. |

**` input ` type**

```ts
{
    prepared: PreparedDualOperation;
    expectSlot: string;
    expectPayloadDigest: string;
    approver: DualOperationApprover;
    authorization?: {
        compound_token: CompoundTokenWire;
        verifier_proofs: VerifierProof[];
        evidence_ct?: string;
    };
    nowSecs?: number;
}
```

Returns: ` Promise<DualOperationApprovalRecord> `.

### approveSigningIntent

An approver's side of a native approval for a structured intent: recompute the digest from the
intent it reviewed, check the statement names exactly that digest on the expected slot, then
sign the statement. Refuses before signing on any difference.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/signing-intents.ts#L113)

Import: `import {approveSigningIntent} from 'tasra-sdk/app'`

```ts
declare function approveSigningIntent(input: {
    prepared: PreparedDualOperation;
    slotId: string;
    intent: SigningIntent;
    approver: DualOperationApprover;
    authorization?: {
        compound_token: CompoundTokenWire;
        verifier_proofs: VerifierProof[];
        evidence_ct?: string;
    };
    nowSecs?: number;
}): Promise<DualOperationApprovalRecord>;
```

| Parameter | Type | Description |
|---|---|---|
| ` input ` | See detailed type below. | Prepared statement, the slot the approver expects, the reviewed intent, the approver and its optional holder-bound grant. |

**` input ` type**

```ts
{
    prepared: PreparedDualOperation;
    slotId: string;
    intent: SigningIntent;
    approver: DualOperationApprover;
    authorization?: {
        compound_token: CompoundTokenWire;
        verifier_proofs: VerifierProof[];
        evidence_ct?: string;
    };
    nowSecs?: number;
}
```

Returns: ` Promise<DualOperationApprovalRecord> `.

### approveWithCredential

Present a credential for this exact request, then sign its canonical approval payload.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/approvals.ts#L153)

Import: `import {approveWithCredential} from 'tasra-sdk/app'`

```ts
declare function approveWithCredential(app: Pick<TasraApplication, 'deployment' | 'slots'>, request: DualSignRequest, message: Uint8Array, options: {
    identity: TasraIdentity;
    authorize: OperationAuthorizer;
    signal?: AbortSignal;
    description?: string;
}): Promise<DualSignStatus>;
```

| Parameter | Type | Description |
|---|---|---|
| ` app ` | ` Pick<TasraApplication, 'deployment' \| 'slots'> ` | Application client for the request deployment. |
| ` request ` | ` DualSignRequest ` | Native signing request awaiting an approval. |
| ` message ` | ` Uint8Array ` | Exact document bytes identified by the request. |
| ` options ` | ` { identity: TasraIdentity; authorize: OperationAuthorizer; signal?: AbortSignal; description?: string; } ` | Approver identity, credential authorizer and cancellation controls. |

Returns: ` Promise<DualSignStatus> `.

### assembleOperationApproval

Assemble independent approvals of one prepared statement into the `dual_control` bundle, judged
against the slot's ON-CHAIN policy before anything is sent: its quorum, and for a static policy every
approver's membership. Signatures verify strictly; duplicates and approvals of another statement
refuse. The keeper and every ECDSA member re-check all of it.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/approvals.ts#L216)

Import: `import {assembleOperationApproval} from 'tasra-sdk/app'`

```ts
declare function assembleOperationApproval(app: Pick<TasraApplication, 'deployment' | 'chain'>, input: {
    prepared: PreparedDualOperation;
    approvals: DualOperationApprovalRecord[];
    nowSecs?: number;
}): Promise<DualOperationProof>;
```

| Parameter | Type | Description |
|---|---|---|
| ` app ` | ` Pick<TasraApplication, 'deployment' \| 'chain'> ` | Application client for the slot deployment. |
| ` input ` | ` { prepared: PreparedDualOperation; approvals: DualOperationApprovalRecord[]; nowSecs?: number; } ` | Prepared statement and approval records. |

Returns: ` Promise<DualOperationProof> `.

### connectWallet

Requests the user's wallet account. Chain switching remains an explicit wallet/user decision.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/wallet.ts#L207)

Import: `import {connectWallet} from 'tasra-sdk/app'`

```ts
declare function connectWallet(deployment: TasraDeployment, provider: EIP1193Provider): Promise<TasraWallet>;
```

| Parameter | Type | Description |
|---|---|---|
| ` deployment ` | ` TasraDeployment ` | Approved network settings. |
| ` provider ` | ` EIP1193Provider ` | User-selected EIP-1193 wallet provider. |

Returns: ` Promise<TasraWallet> `.

Return details: Wallet bound to the authorized account and matching chain.

### createApplicationSlot

Durable creation, key readiness, rule delivery and explicit verifier policy in one operation.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/ready-slot.ts#L204)

Import: `import {createApplicationSlot} from 'tasra-sdk/app'`

```ts
declare function createApplicationSlot(app: TasraApplication, input: CreateApplicationSlot, options: CreateApplicationSlotOptions): Promise<`0x${string}`>;
```

| Parameter | Type | Description |
|---|---|---|
| ` app ` | ` TasraApplication ` | Application client connected to the target deployment. |
| ` input ` | ` CreateApplicationSlot ` | Stable named creation intent with rule and threshold policies. |
| ` options ` | ` CreateApplicationSlotOptions ` | Creator wallet, signer, durable store and cancellation controls. |

Returns: `` Promise<`0x${string}`> ``.

### createIdentity

Create a fresh DID and its credential signing key without a separate crypto library.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/identity.ts#L44)

Import: `import {createIdentity} from 'tasra-sdk/app'`

```ts
declare function createIdentity(options?: {
    algorithm?: 'Ed25519' | 'P-256';
    seed?: Uint8Array;
}): TasraIdentity;
```

| Parameter | Type | Description |
|---|---|---|
| ` options? ` | ` { algorithm?: 'Ed25519' \| 'P-256'; seed?: Uint8Array; } ` | Optional signing algorithm and 32-byte seed; defaults to a fresh Ed25519 key. |

Returns: ` TasraIdentity `.

Return details: Identity with public DID metadata and explicitly managed private-key custody.

### createLocalWallet

Create or restore a local key. Explicitly export and save a generated key before funding it.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/wallet.ts#L195)

Import: `import {createLocalWallet} from 'tasra-sdk/app'`

```ts
declare function createLocalWallet(deployment: TasraDeployment, options?: {
    privateKey?: Hex;
}): TasraWallet & {
    exportPrivateKey(): Hex;
};
```

| Parameter | Type | Description |
|---|---|---|
| ` deployment ` | ` TasraDeployment ` | Approved network settings. |
| ` options? ` | ` { privateKey?: Hex; } ` | Optional existing private key; a fresh key is generated otherwise. |

Returns:

```ts
TasraWallet & {
    exportPrivateKey(): Hex;
}
```

Return details: Chain-bound wallet with an explicit private-key export function.

### createMemoryStore

Create a process-local store. Values are deep-copied on save and load (like a durable store,
a caller mutating its object never changes saved state), and `withLock` serializes work per
key by waiting, in call order.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/memory-store.ts#L17)

Import: `import {createMemoryStore} from 'tasra-sdk/app'`

```ts
declare function createMemoryStore(): ApplicationStore;
```

Returns: ` ApplicationStore `.

### createPreparedSlot

Create or resume one persisted slot intent. Persistence must be atomic and runs must be serialized. Saved transaction hashes are observed without resubmission; missing hashes require wallet reconciliation. Cancellation cannot undo a submitted transaction.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/creation.ts#L73)

Import: `import {createPreparedSlot} from 'tasra-sdk/app'`

```ts
declare function createPreparedSlot(input: SlotCreationJournal, config: {
    wallet: WriteClientWalletConfig['wallet'];
    persist: (journal: SlotCreationJournal) => Promise<void>;
    options?: Omit<CommitRevealOptions, 'recovery'>;
}): Promise<SlotCreationJournal>;
```

| Parameter | Type | Description |
|---|---|---|
| ` input ` | ` SlotCreationJournal ` | Private journal returned by prepareSlot or a previous attempt. |
| ` config ` | ` { wallet: WriteClientWalletConfig['wallet']; persist: (journal: SlotCreationJournal) => Promise<void>; options?: Omit<CommitRevealOptions, 'recovery'>; } ` | Creator wallet, durable persistence callback and commit-reveal controls. |

Returns: ` Promise<SlotCreationJournal> `.

Return details: Updated journal after on-chain creation; key generation and rule provisioning are separate stages.

### createSessionKey

Create a fresh session key. Prefers a NON-EXTRACTABLE WebCrypto P-256 key (ES256), so the private
key never exists as bytes in the page; without WebCrypto ECDSA it uses an in-memory Ed25519 key.
A session key is per session: never reuse it across sessions.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-grants.ts#L41)

Import: `import {createSessionKey} from 'tasra-sdk/app'`

```ts
declare function createSessionKey(opts?: {
    alg?: 'ES256' | 'Ed25519';
}): Promise<SessionKeyHandle>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts? ` | ` { alg?: 'ES256' \| 'Ed25519'; } ` | - Force `Ed25519` (tests, runtimes without WebCrypto) or `ES256`. |

Returns: ` Promise<SessionKeyHandle> `.

### createSlotPolicyRequest

Sign a request for a slot policy statement with the holder application's key. The key identifies
the application to the issuer; it is neither a holder credential nor a control-plane key.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/policy-bootstrap.ts#L395)

Import: `import {createSlotPolicyRequest} from 'tasra-sdk/app'`

```ts
declare function createSlotPolicyRequest(signer: Pick<LocalAccount, 'address' | 'signTypedData'>, request: {
    chainId: number;
    keyRegistry: Address;
    slot: Hex;
    nonce?: Hex;
    nowSecs?: number;
}): Promise<SlotPolicyRequest>;
```

| Parameter | Type | Description |
|---|---|---|
| ` signer ` | ` Pick<LocalAccount, 'address' \| 'signTypedData'> ` | Holder application key. |
| ` request ` | ` { chainId: number; keyRegistry: Address; slot: Hex; nonce?: Hex; nowSecs?: number; } ` | Chain, KeyRegistry and slot; nonce and time default to fresh values. |

Returns: ` Promise<SlotPolicyRequest> `.

### createSlotWallet

Use a threshold ECDSA slot with fresh operation authorization on every signature.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/wallet.ts#L222)

Import: `import {createSlotWallet} from 'tasra-sdk/app'`

```ts
declare function createSlotWallet(application: TasraApplication, slotId: Hex, options: AuthorizedOperationOptions): Promise<TasraWallet>;
```

| Parameter | Type | Description |
|---|---|---|
| ` application ` | ` TasraApplication ` | Application client connected to the slot deployment. |
| ` slotId ` | ` Hex ` | Ready threshold ECDSA slot to expose as an Ethereum wallet. |
| ` options ` | ` AuthorizedOperationOptions ` | Fresh authorization callback used for every signature. |

Returns: ` Promise<TasraWallet> `.

### createTasra

Configure one application client. Construction does no I/O and holds no wallet credentials.
Start with `await tasra.slots.ecdsa(slotId)` and `await account.getAddress()`;
provide an authorizer only when signing or decrypting.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/client.ts#L171)

Import: `import {createTasra} from 'tasra-sdk/app'`

```ts
declare function createTasra(config: TasraApplicationConfig): {
    deployment: Readonly<TasraDeployment>;
    chain: TasraChainClient;
    check(): Promise<{
        chainId: number;
        registries: {
            name: "NodeRegistry" | "KeyRegistry";
            deployed: boolean;
        }[];
        ready: boolean;
        authorization: "unknown";
        nativeMultiApproverIbe: "unsupported";
        taskContextEnforcement: "unsupported";
    }>;
    slots: {
        get: (slotId: Hex) => Promise<SlotMetadata>;
        ecdsa(slotId: Hex): Promise<{
            slotId: `0x${string}`;
            getAddress: () => Promise<`0x${string}`>;
            signDigest(input: Uint8Array, options: EcdsaSignOptions): Promise<EoaSignature>;
            signIntent(intent: EthereumSigningIntent, options: EcdsaSignOptions): Promise<EoaSignature & {
                digest: Uint8Array;
            }>;
        }>;
        p256(slotId: Hex): Promise<{
            slotId: `0x${string}`;
            getPublicKey: () => Promise<Uint8Array<ArrayBufferLike>>;
            signDigest: (input: Uint8Array, options: EcdsaSignOptions) => Promise<P256DigestSignature>;
            signIntent(intent: P256SigningIntent, options: EcdsaSignOptions): Promise<P256DigestSignature & {
                digest: Uint8Array;
            }>;
        }>;
        frost(slotId: Hex): Promise<{
            slotId: `0x${string}`;
            sign(input: Uint8Array, options: AuthorizedOperationOptions & {
                requireReceipt?: boolean;
            }): Promise<{
                receiptStatus: "verified" | "absent";
                receipt?: OperationReceipt;
                keySlotId: string;
                groupPublicKey: Uint8Array;
                signature: FrostSignature;
                messageSha256: Uint8Array;
                epoch: number;
            }>;
            approvals(policy: {
                quorum: number;
                credentialGated: boolean;
            }): Promise<{
                create(message: Uint8Array, options?: {
                    signal?: AbortSignal;
                }): Promise<DualSignRequest>;
                resume(requestId: string, expectedMessage: Uint8Array): DualSignRequest;
            }>;
        }>;
        bls(slotId: Hex): Promise<{
            slotId: `0x${string}`;
            encrypt(aad: Uint8Array, dataKey: Uint8Array): Promise<Ciphertext>;
            decrypt(aad: Uint8Array, kemCt: Ciphertext, options: IdentityExtractionOptions): Promise<{
                plaintext: Uint8Array<ArrayBufferLike>;
                shareTrust: "anchored-group";
            }>;
            encryptForIdentity(identity: string, plaintext: Uint8Array): Promise<IbeCiphertext>;
            decryptForIdentity(identity: string, ciphertext: IbeCiphertext, options: IdentityExtractionOptions): Promise<Omit<StrictExtractionResult, "key"> & {
                plaintext: Uint8Array;
            }>;
            extractIdentityKey(identity: string, options: IdentityExtractionOptions): Promise<StrictExtractionResult>;
        }>;
    };
};
```

| Parameter | Type | Description |
|---|---|---|
| ` config ` | ` TasraApplicationConfig ` | Validated deployment settings and optional transport adapters. |

Returns:

```ts
{
    deployment: Readonly<TasraDeployment>;
    chain: TasraChainClient;
    check(): Promise<{
        chainId: number;
        registries: {
            name: "NodeRegistry" | "KeyRegistry";
            deployed: boolean;
        }[];
        ready: boolean;
        authorization: "unknown";
        nativeMultiApproverIbe: "unsupported";
        taskContextEnforcement: "unsupported";
    }>;
    slots: {
        get: (slotId: Hex) => Promise<SlotMetadata>;
        ecdsa(slotId: Hex): Promise<{
            slotId: `0x${string}`;
            getAddress: () => Promise<`0x${string}`>;
            signDigest(input: Uint8Array, options: EcdsaSignOptions): Promise<EoaSignature>;
            signIntent(intent: EthereumSigningIntent, options: EcdsaSignOptions): Promise<EoaSignature & {
                digest: Uint8Array;
            }>;
        }>;
        p256(slotId: Hex): Promise<{
            slotId: `0x${string}`;
            getPublicKey: () => Promise<Uint8Array<ArrayBufferLike>>;
            signDigest: (input: Uint8Array, options: EcdsaSignOptions) => Promise<P256DigestSignature>;
            signIntent(intent: P256SigningIntent, options: EcdsaSignOptions): Promise<P256DigestSignature & {
                digest: Uint8Array;
            }>;
        }>;
        frost(slotId: Hex): Promise<{
            slotId: `0x${string}`;
            sign(input: Uint8Array, options: AuthorizedOperationOptions & {
                requireReceipt?: boolean;
            }): Promise<{
                receiptStatus: "verified" | "absent";
                receipt?: OperationReceipt;
                keySlotId: string;
                groupPublicKey: Uint8Array;
                signature: FrostSignature;
                messageSha256: Uint8Array;
                epoch: number;
            }>;
            approvals(policy: {
                quorum: number;
                credentialGated: boolean;
            }): Promise<{
                create(message: Uint8Array, options?: {
                    signal?: AbortSignal;
                }): Promise<DualSignRequest>;
                resume(requestId: string, expectedMessage: Uint8Array): DualSignRequest;
            }>;
        }>;
        bls(slotId: Hex): Promise<{
            slotId: `0x${string}`;
            encrypt(aad: Uint8Array, dataKey: Uint8Array): Promise<Ciphertext>;
            decrypt(aad: Uint8Array, kemCt: Ciphertext, options: IdentityExtractionOptions): Promise<{
                plaintext: Uint8Array<ArrayBufferLike>;
                shareTrust: "anchored-group";
            }>;
            encryptForIdentity(identity: string, plaintext: Uint8Array): Promise<IbeCiphertext>;
            decryptForIdentity(identity: string, ciphertext: IbeCiphertext, options: IdentityExtractionOptions): Promise<Omit<StrictExtractionResult, "key"> & {
                plaintext: Uint8Array;
            }>;
            extractIdentityKey(identity: string, options: IdentityExtractionOptions): Promise<StrictExtractionResult>;
        }>;
    };
}
```

Return details: A client with read-only checks and authorized slot operations.

### credentialAuthorization

Authorize one exact SDK operation: sign its request, present a credential, collect bound proofs.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/identity.ts#L376)

Import: `import {credentialAuthorization} from 'tasra-sdk/app'`

```ts
declare function credentialAuthorization(options: CredentialAuthorizationOptions): OperationAuthorizer;
```

| Parameter | Type | Description |
|---|---|---|
| ` options ` | ` CredentialAuthorizationOptions ` | Approved verifier-agent endpoint, signer, holder credentials and local consent controls. |

Returns: ` OperationAuthorizer `.

### credentialPolicy

Build and validate the policy committed to a slot, with issuer trust pinned explicitly.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/identity.ts#L260)

Import: `import {credentialPolicy} from 'tasra-sdk/app'`

```ts
declare function credentialPolicy(options: CredentialPolicyOptions): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` options ` | ` CredentialPolicyOptions ` | Trusted issuer and required credential claims. |

Returns: ` string `.

Return details: Validated DCQL rule suitable for slot creation.

### decryptBatchInSession

Decrypt up to 64 messages of one slot under a session grant in ONE request per keeper (one
session-key proof over the ordered batch). Session handling is [decryptInSession](#decryptinsession)'s: a
batch the keepers refuse entirely as stale is sent again once when the chain confirms it, and
an ended session is re-opened through `reopen`. A message's own refusal never fails the batch:
each message gets its own result.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-decrypt.ts#L242)

Import: `import {decryptBatchInSession} from 'tasra-sdk/app'`

```ts
declare function decryptBatchInSession(request: SessionBatchRequest): Promise<SessionBatchResult>;
```

| Parameter | Type | Description |
|---|---|---|
| ` request ` | ` SessionBatchRequest ` | - Messages, session, slot and keepers. |

Returns: ` Promise<SessionBatchResult> `.

### decryptInSession

Decrypt one message under a session grant: send it to the keepers
(` decryptWithSessionGrant `) and combine the sealed partials locally. A message refused by
the keepers as stale with no keeper having run it (`SessionDecryptResult.stale`) is sent again
ONCE on the refreshed grant, and only when a fresh chain read
(` SessionDecryptContext.latestBeaconEpoch `) confirms it: the beacon's latest epoch is past
the grant's epoch + 1 (so the draw moved and no keeper may admit it). When the chain still says
the grant is admissible, or cannot be read, the keepers' "stale" is unconfirmed and the refusal
is thrown. Every other refusal throws [SessionMessageError](#sessionmessageerror); a session that cannot
continue throws `SessionEndedError` (present again), unless `reopen` opens a new one
(single-flight per ended session), under which the message is then sent.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-decrypt.ts#L226)

Import: `import {decryptInSession} from 'tasra-sdk/app'`

```ts
declare function decryptInSession(request: SessionMessageRequest): Promise<SessionMessageResult>;
```

| Parameter | Type | Description |
|---|---|---|
| ` request ` | ` SessionMessageRequest ` | - Message, session, slot and keepers. |

Returns: ` Promise<SessionMessageResult> `.

### defineDeployment

Validate a caller-approved descriptor. This does not establish its authenticity.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/deployment.ts#L36)

Import: `import {defineDeployment} from 'tasra-sdk/app'`

```ts
declare function defineDeployment(value: TasraDeployment): Readonly<TasraDeployment>;
```

| Parameter | Type | Description |
|---|---|---|
| ` value ` | ` TasraDeployment ` | Caller-approved public deployment descriptor. |

Returns: ` Readonly<TasraDeployment> `.

### identityApprover

Adapt an SDK Ed25519 identity to native approval signatures without exporting its key.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/approvals.ts#L134)

Import: `import {identityApprover} from 'tasra-sdk/app'`

```ts
declare function identityApprover(identity: TasraIdentity): DualSignApprover;
```

| Parameter | Type | Description |
|---|---|---|
| ` identity ` | ` TasraIdentity ` | Live Ed25519 identity used to sign approval payloads. |

Returns: ` DualSignApprover `.

Return details: Approver adapter exposing the public key and signing callback.

### issueCredential

Issue a holder-bound SD-JWT credential; protocol claims cannot be replaced by app claims.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/identity.ts#L150)

Import: `import {issueCredential} from 'tasra-sdk/app'`

```ts
declare function issueCredential(options: IssueCredentialOptions): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` options ` | ` IssueCredentialOptions ` | Issuer, holder, credential type, application claims and lifetime. |

Returns: ` string `.

Return details: Serialized holder-bound SD-JWT credential.

### issueSlotPolicyBootstrap

Issue a slot policy bootstrap as the slot creator. Reads the slot at the latest block and refuses
(`not-issuable`) unless it is live, the signer is its creator and the rule and salt reproduce its
commitment; then signs a statement that carries the rule hash, commitment and rule version but
not the salt. Hand the result to the holder application named as `audience`.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/policy-bootstrap.ts#L355)

Import: `import {issueSlotPolicyBootstrap} from 'tasra-sdk/app'`

```ts
declare function issueSlotPolicyBootstrap(chain: TasraChainClient, input: IssueSlotPolicyInput): Promise<SlotPolicyBootstrap>;
```

| Parameter | Type | Description |
|---|---|---|
| ` chain ` | ` TasraChainClient ` | Reader for the deployment that owns the slot. |
| ` input ` | ` IssueSlotPolicyInput ` | Creator signer, slot, rule, salt, holder application, scope, sequence and lifetime. |

Returns: ` Promise<SlotPolicyBootstrap> `.

### loadApplicationManifest

Fetch a public manifest; an optional trusted pin is checked before parsing any JSON.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/manifest.ts#L134)

Import: `import {loadApplicationManifest} from 'tasra-sdk/app'`

```ts
declare function loadApplicationManifest(source: string | URL, options?: LoadApplicationManifestOptions): Promise<ResolvedApplicationManifest>;
```

| Parameter | Type | Description |
|---|---|---|
| ` source ` | ` string \| URL ` | HTTPS manifest URL. HTTP is allowed only for loopback or with an independently trusted digest pin. |
| ` options? ` | ` LoadApplicationManifestOptions ` | Trusted digest pin, manifest resolution choices and HTTP controls. |

Returns: ` Promise<ResolvedApplicationManifest> `.

Return details: Parsed deployment after any supplied digest pin has been verified.

### loadGrantedSession

Load a journaled session (same process, same key) after a restart of its owner, e.g. a tab reload with the key kept.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-grants.ts#L877)

Import: `import {loadGrantedSession} from 'tasra-sdk/app'`

```ts
declare function loadGrantedSession(opts: GrantedSessionOptions, sessionId: string): Promise<GrantedSession>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` GrantedSessionOptions ` | - Lifecycle options; `key` must be the key the grant binds. |
| ` sessionId ` | ` string ` | - 0x-prefixed 32-byte session id. |

Returns: ` Promise<GrantedSession> `.

### lockKeyRotation

Lock a slot's key against every rotation, for good, with a durable named transaction from the
slot creator's wallet (`KeyRegistry.lockKeyRotation`). Afterwards no creator, operator vote or
revocation notice can rotate the key; resharing still works, because it keeps the key. Use it
when the key is an identity that must never change, such as a custody address.

The lock is SET-ONCE: a slot already locked resolves `already-locked` without sending. Every
threshold-ECDSA slot is locked by its mode already, so it resolves that way too and never emits
`KeyRotationLocked`. Refused before sending, as a `RotationLockError`: `no-slot`, `cancelled`,
`unsupported` (a KeyRegistry without the lock) and `not-creator`; `not-confirmed` when the
transaction confirmed but the chain does not show the lock. A transaction whose outcome was
unknown is reconciled by calling this again with the same name (the wallet's journal).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/rotation-lock.ts#L39)

Import: `import {lockKeyRotation} from 'tasra-sdk/app'`

```ts
declare function lockKeyRotation(app: Pick<TasraApplication, 'deployment' | 'chain'>, slotId: Hex, options: {
    wallet: TasraWallet;
    store: ApplicationStore;
    name?: string;
}): Promise<WalletTransactionJournal | RotationAlreadyLocked>;
```

| Parameter | Type | Description |
|---|---|---|
| ` app ` | ` Pick<TasraApplication, 'deployment' \| 'chain'> ` | Application client for the slot deployment. |
| ` slotId ` | ` Hex ` | Slot whose rotation is being locked. |
| ` options ` | ` { wallet: TasraWallet; store: ApplicationStore; name?: string; } ` | Creator wallet and durable store for the named lock transaction. |

Returns: ` Promise<WalletTransactionJournal | RotationAlreadyLocked> `.

### openDecryptSession

Open a decrypt session for `request.slots`: one credential presentation, then any number of
decrypts with no further wallet step ([DecryptSession](#decryptsession)). Nothing is paid and nothing
owner-held is needed: the slot id, a signing key of the application's own and the holder's
credential are enough.

Before the wallet step the session's signed Request Object is verified against the verifier
draw read from the chain (`assertAnchoredWalletRequest`), so `present` only ever sees a session
whose request was signed by the drawn verifier for exactly this operation and session key.

Refusals: a slot that is not a ready BLS slot; an agent that is not the approved one; a request
that does not match the chain-anchored draw; a wallet or committee refusal (`VerifierAgentSessionError`); a completed presentation without a grant
([SessionGrantUnavailableError](#sessiongrantunavailableerror)); a grant that does not verify against the request, this
session key or a slot's anchored draw (`SessionGrantError`).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-open.ts#L175)

Import: `import {openDecryptSession} from 'tasra-sdk/app'`

```ts
declare function openDecryptSession(config: DecryptSessionConfig, request: OpenDecryptSessionRequest): Promise<DecryptSession>;
```

| Parameter | Type | Description |
|---|---|---|
| ` config ` | ` DecryptSessionConfig ` | - Application client, approved agent, store, signer and the wallet step. |
| ` request ` | ` OpenDecryptSessionRequest ` | - Slots, the first message and the requested lifetimes. |

Returns: ` Promise<DecryptSession> `.

### prepareOperationApproval

Prepare the approval statement for ONE operation (a threshold ECDSA or P-256 signature, a KEM
decrypt or an IBE extraction), bound to the chain, slot, payload digest, key epoch and the
operation's request hash, current for at most 300 s. Reads the slot (mode, epoch, readiness) and
the policy; sends nothing. Hand the result to each approver (`approveDualOperation` or
`approveSigningIntent`), then assemble.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/approvals.ts#L190)

Import: `import {prepareOperationApproval} from 'tasra-sdk/app'`

```ts
declare function prepareOperationApproval(app: Pick<TasraApplication, 'deployment' | 'chain' | 'slots'>, input: {
    slotId: Hex;
    intent?: SigningIntent;
    digest?: Uint8Array;
    payloadDigest?: Uint8Array;
    identity?: string;
    ttlSecs?: number;
    nowSecs?: number;
}): Promise<PreparedDualOperation>;
```

| Parameter | Type | Description |
|---|---|---|
| ` app ` | ` Pick<TasraApplication, 'deployment' \| 'chain' \| 'slots'> ` | Application client for the slot deployment. |
| ` input ` | ` { slotId: Hex; intent?: SigningIntent; digest?: Uint8Array; payloadDigest?: Uint8Array; identity?: string; ttlSecs?: number; nowSecs?: number; } ` | The slot and what it will run: a signing `intent` or the 32-byte `digest` to sign (ECDSA and P-256 slots), or the operation's `payloadDigest` (the recipient-bound digest of a KEM decrypt or IBE extraction); the IBE identity; and the lifetime. |

Returns: ` Promise<PreparedDualOperation> `.

### prepareSlot

Prepare without I/O. Save this private journal durably before requesting creation.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/creation.ts#L55)

Import: `import {prepareSlot} from 'tasra-sdk/app'`

```ts
declare function prepareSlot(deployment: TasraDeployment, creator: Address, input: CreateSlotArgs): SlotCreationJournal;
```

| Parameter | Type | Description |
|---|---|---|
| ` deployment ` | ` TasraDeployment ` | Approved network settings. |
| ` creator ` | ` Address ` | Account that will own and create the slot. |
| ` input ` | ` CreateSlotArgs ` | Key mode, threshold, rule and optional creation policy. |

Returns: ` SlotCreationJournal `.

Return details: Private journal containing the generated slot ID and salts.

### presentCredentials

Present selected, holder-bound credentials to a signed OID4VP request. Passing credentials is
explicit consent to the default selection; provide `choose` to display a wallet consent screen.
A local policy mismatch throws locally and is not evidence of a verifier rejection.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/identity.ts#L308)

Import: `import {presentCredentials} from 'tasra-sdk/app'`

```ts
declare function presentCredentials(requestUri: string, identity: TasraIdentity, credentials: readonly string[], options?: PresentCredentialsOptions): Promise<{
    ro: VerifiedRequestObject;
    plan: PresentationPlan;
    built: BuiltResponse;
    redirectUri?: string;
}>;
```

| Parameter | Type | Description |
|---|---|---|
| ` requestUri ` | ` string ` | Signed request URI or OID4VP launch URI supplied by the verifier agent. |
| ` identity ` | ` TasraIdentity ` | Live holder identity bound to the selected credentials. |
| ` credentials ` | ` readonly string[] ` | Serialized SD-JWT credentials explicitly selected for this presentation. |
| ` options? ` | ` PresentCredentialsOptions ` | Optional consent selection, request checks, transport and cancellation settings. |

Returns:

```ts
Promise<{
    ro: VerifiedRequestObject;
    plan: PresentationPlan;
    built: BuiltResponse;
    redirectUri?: string;
}>
```

### readApprovalPolicy

Read a slot's native approval policy (`KeyRegistry.dualControlPolicy` / `dualControlApprovers`).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/approvals.ts#L62)

Import: `import {readApprovalPolicy} from 'tasra-sdk/app'`

```ts
declare function readApprovalPolicy(app: Pick<TasraApplication, 'deployment' | 'chain'>, slotId: Hex): Promise<InstalledApprovalPolicy>;
```

| Parameter | Type | Description |
|---|---|---|
| ` app ` | ` Pick<TasraApplication, 'deployment' \| 'chain'> ` | Application client for the slot deployment. |
| ` slotId ` | ` Hex ` | Slot to read. |

Returns: ` Promise<InstalledApprovalPolicy> `.

### registeredWalletAuthorization

Request-bound authorization through an independently approved registered agent.
`present` displays a QR/deep link or runs the application's credential wallet.
It never changes the selected provider or transfers a presentation to a fallback.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/authorization.ts#L13)

Import: `import {registeredWalletAuthorization} from 'tasra-sdk/app'`

```ts
declare function registeredWalletAuthorization(config: {
    client: Pick<ReturnType<typeof createRegisteredAgentClient>, 'createSession'>;
    signer: TypedDataSigner;
    delegation?: PresentationDelegation;
    present: (session: RegisteredVerifierAgentSession, signal?: AbortSignal) => Promise<void>;
    onPhase?: (phase: SessionPhase) => void;
    timeoutMs?: number;
}): OperationAuthorizer;
```

| Parameter | Type | Description |
|---|---|---|
| ` config ` | See detailed type below. | Approved agent client, operation signer, wallet presentation callback and polling controls. |

**` config ` type**

```ts
{
    client: Pick<ReturnType<typeof createRegisteredAgentClient>, 'createSession'>;
    signer: TypedDataSigner;
    delegation?: PresentationDelegation;
    present: (session: RegisteredVerifierAgentSession, signal?: AbortSignal) => Promise<void>;
    onPhase?: (phase: SessionPhase) => void;
    timeoutMs?: number;
}
```

Returns: ` OperationAuthorizer `.

### requireCurrentSlotPolicy

Compare a verified statement with the slot read on chain at one canonical block; throws `changed-policy`.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/policy-bootstrap.ts#L290)

Import: `import {requireCurrentSlotPolicy} from 'tasra-sdk/app'`

```ts
declare function requireCurrentSlotPolicy(statement: SlotPolicyStatement, signer: Address, observed: ObservedSlotPolicy): void;
```

| Parameter | Type | Description |
|---|---|---|
| ` statement ` | ` SlotPolicyStatement ` | Verified statement. |
| ` signer ` | ` Address ` | Address that signed it. |
| ` observed ` | ` ObservedSlotPolicy ` | Creator, commitment and rule version as read. |

Returns: ` void `.

### requireDualOperationProof

The client-side half of the keeper gate, before a bundle travels in an operation body: current,
the expected operation, and bound to this chain, slot, payload digest and request hash.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/dual-operation.ts#L304)

Import: `import {requireDualOperationProof} from 'tasra-sdk/app'`

```ts
declare function requireDualOperationProof(proof: DualOperationProof, expected: DualOperationExpectation): void;
```

| Parameter | Type | Description |
|---|---|---|
| ` proof ` | ` DualOperationProof ` | - Assembled bundle. |
| ` expected ` | ` DualOperationExpectation ` | - The chain, operation, slot and payload digest (and key epoch, when known) of the operation about to run. |

Returns: ` void `.

### resolveApplicationManifest

Validate caller-approved configuration without network I/O or readiness claims.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/manifest.ts#L94)

Import: `import {resolveApplicationManifest} from 'tasra-sdk/app'`

```ts
declare function resolveApplicationManifest(input: ApplicationManifest, options?: ResolveApplicationManifestOptions): ResolvedApplicationManifest;
```

| Parameter | Type | Description |
|---|---|---|
| ` input ` | ` ApplicationManifest ` | Downloaded network manifest or explicitly approved deployment settings. |
| ` options? ` | ` ResolveApplicationManifestOptions ` | Explicit RPC and coordinator choices for the manifest. |

Returns: ` ResolvedApplicationManifest `.

Return details: Validated deployment and optional routing without a network request.

### sessionGrantCreateFragment

Build the session-mode object for `POST /v1/sessions` (merge it into the create body). Slots are
sorted ascending, as the agent canonicalizes them; requested lifetimes travel as requested and
the agent clamps them to the platform caps.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-grants.ts#L102)

Import: `import {sessionGrantCreateFragment} from 'tasra-sdk/app'`

```ts
declare function sessionGrantCreateFragment(key: SessionKeyHandle, params: SessionGrantParams): SessionGrantCreateFragment;
```

| Parameter | Type | Description |
|---|---|---|
| ` key ` | ` SessionKeyHandle ` | - The session key whose public JWK the grant will bind. |
| ` params ` | ` SessionGrantParams ` | - Slots and requested lifetimes. |

Returns: ` SessionGrantCreateFragment `.

### setApprovalPolicy

Install an explicit native approval policy using a durable named transaction, on a FROST, BLS or
threshold ECDSA (secp256k1 or P-256) slot. The slot creator's wallet sends it
(`KeyRegistry.setDualControlPolicy`); no slot-key signature is involved. The policy is SET-ONCE:
an identical policy already on chain resolves `already-installed` without sending, a different
one refuses before sending. A transaction whose outcome was unknown is reconciled by calling this
again with the same name (the wallet's journal), never by a replacement.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/approvals.ts#L98)

Import: `import {setApprovalPolicy} from 'tasra-sdk/app'`

```ts
declare function setApprovalPolicy(app: Pick<TasraApplication, 'deployment' | 'chain' | 'slots'>, slotId: Hex, input: ApprovalPolicy, options: {
    wallet: TasraWallet;
    store: ApplicationStore;
    name?: string;
}): Promise<WalletTransactionJournal | ApprovalPolicyAlreadyInstalled>;
```

| Parameter | Type | Description |
|---|---|---|
| ` app ` | ` Pick<TasraApplication, 'deployment' \| 'chain' \| 'slots'> ` | Application client for the slot deployment. |
| ` slotId ` | ` Hex ` | Slot whose approval policy is being installed. |
| ` input ` | ` ApprovalPolicy ` | Required quorum and either approver keys or a credential rule. |
| ` options ` | ` { wallet: TasraWallet; store: ApplicationStore; name?: string; } ` | Creator wallet and durable store for the named policy transaction. |

Returns: ` Promise<WalletTransactionJournal | ApprovalPolicyAlreadyInstalled> `.

### signingIntentCurve

The curve an intent belongs to.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/signing-intents.ts#L103)

Import: `import {signingIntentCurve} from 'tasra-sdk/app'`

```ts
declare function signingIntentCurve(intent: SigningIntent): 'secp256k1' | 'p256';
```

| Parameter | Type | Description |
|---|---|---|
| ` intent ` | ` SigningIntent ` | Structured intent. |

Returns: ` 'secp256k1' | 'p256' `.

### signingIntentDigest

The 32-byte digest a slot signs for a structured intent. A transaction and typed data must name
a chain, and that chain must be `expectChainId` when given; every input is size-bounded.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/signing-intents.ts#L65)

Import: `import {signingIntentDigest} from 'tasra-sdk/app'`

```ts
declare function signingIntentDigest(intent: SigningIntent, options?: {
    expectChainId?: number;
}): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` intent ` | ` SigningIntent ` | Structured intent. |
| ` options? ` | ` { expectChainId?: number; } ` | Chain the transaction or typed data must name. |

Returns: ` Uint8Array `.

### slotPolicyHash

The EIP-712 hash of a slot policy statement, the identity the holder's store records.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/policy-bootstrap.ts#L227)

Import: `import {slotPolicyHash} from 'tasra-sdk/app'`

```ts
declare function slotPolicyHash(statement: SlotPolicyStatement): Hex;
```

| Parameter | Type | Description |
|---|---|---|
| ` statement ` | ` SlotPolicyStatement ` | Statement to hash. |

Returns: ` Hex `.

### slotPolicyRequestTypedData

The EIP-712 typed data a holder application signs to request a slot policy statement.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/policy-bootstrap.ts#L381)

Import: `import {slotPolicyRequestTypedData} from 'tasra-sdk/app'`

```ts
declare function slotPolicyRequestTypedData(request: Omit<SlotPolicyRequest, 'signature'>): TypedDataDefinition<typeof REQUEST_TYPES, 'SlotPolicyRequest'>;
```

| Parameter | Type | Description |
|---|---|---|
| ` request ` | ` Omit<SlotPolicyRequest, 'signature'> ` | Request fields (signature excluded). |

Returns: ` TypedDataDefinition<typeof REQUEST_TYPES, 'SlotPolicyRequest'> `.

### slotPolicyTypedData

The EIP-712 typed data a slot creator signs for a slot policy statement.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/policy-bootstrap.ts#L216)

Import: `import {slotPolicyTypedData} from 'tasra-sdk/app'`

```ts
declare function slotPolicyTypedData(statement: SlotPolicyStatement): TypedDataDefinition<typeof POLICY_TYPES, 'SlotPolicy'>;
```

| Parameter | Type | Description |
|---|---|---|
| ` statement ` | ` SlotPolicyStatement ` | Statement to sign or verify. |

Returns: ` TypedDataDefinition<typeof POLICY_TYPES, 'SlotPolicy'> `.

### toViemAccount

Use a Tasra slot as a viem account. Every signing call gets fresh authorization;
this adapter never broadcasts a transaction. Pass it to viem's createWalletClient.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/viem.ts#L14)

Import: `import {toViemAccount} from 'tasra-sdk/app'`

```ts
declare function toViemAccount(slot: EcdsaSlot, options: AuthorizedOperationOptions): Promise<LocalAccount>;
```

| Parameter | Type | Description |
|---|---|---|
| ` slot ` | ` EcdsaSlot ` | Ready threshold ECDSA slot. |
| ` options ` | ` AuthorizedOperationOptions ` | Fresh authorization callback and operation controls. |

Returns: ` Promise<LocalAccount> `.

Return details: Viem account that verifies signatures before returning them.

### verifyCredential

Verify an SD-JWT issued by a self-certifying did:jwk/did:key, its lifetime and optional pins.
Signature verification proves key control; trust in that issuer must come from the app's policy.
This does not perform revocation/status checks or resolve did:web issuers.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/identity.ts#L201)

Import: `import {verifyCredential} from 'tasra-sdk/app'`

```ts
declare function verifyCredential(credential: string, expected?: VerifyCredentialOptions): Record<string, unknown>;
```

| Parameter | Type | Description |
|---|---|---|
| ` credential ` | ` string ` | Serialized SD-JWT credential. |
| ` expected? ` | ` VerifyCredentialOptions ` | Optional trust pins and verification time. |

Returns: ` Record<string, unknown> `.

Return details: Verified disclosed claims; issuer trust depends on the supplied application pins.

### verifySlotPolicyBootstrap

Check a slot policy bootstrap offline: shape and bounds, deployment, slot, holder application,
action scope, lifetime, that the rule is the one the statement hashes, and the creator's
signature. The on-chain half (current creator, commitment and rule version at one canonical
block) is [requireCurrentSlotPolicy](#requirecurrentslotpolicy), against the caller's own slot read. Throws [SlotPolicyError](#slotpolicyerror).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/policy-bootstrap.ts#L258)

Import: `import {verifySlotPolicyBootstrap} from 'tasra-sdk/app'`

```ts
declare function verifySlotPolicyBootstrap(bootstrap: SlotPolicyBootstrap, expected: SlotPolicyExpectation): Promise<{
    bootstrap: SlotPolicyBootstrap;
    signer: Address;
}>;
```

| Parameter | Type | Description |
|---|---|---|
| ` bootstrap ` | ` SlotPolicyBootstrap ` | Untrusted bootstrap as received. |
| ` expected ` | ` SlotPolicyExpectation ` | Deployment, slot, holder application, action and signer to expect. |

Returns:

```ts
Promise<{
    bootstrap: SlotPolicyBootstrap;
    signer: Address;
}>
```

Return details: The normalized bootstrap and the address that signed it.

### verifySlotPolicyRequest

Check a holder application's policy request on the issuer side: shape, deployment, age and that
its `audience` signed it. The issuer then checks that the audience is an enrolled application
for this slot and that the nonce is new. Throws [SlotPolicyError](#slotpolicyerror).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/policy-bootstrap.ts#L409)

Import: `import {verifySlotPolicyRequest} from 'tasra-sdk/app'`

```ts
declare function verifySlotPolicyRequest(request: SlotPolicyRequest, expected: {
    chainId: number;
    keyRegistry: Address;
    nowSecs?: number;
    maxAgeSecs?: number;
}): Promise<SlotPolicyRequest>;
```

| Parameter | Type | Description |
|---|---|---|
| ` request ` | ` SlotPolicyRequest ` | Untrusted request as received. |
| ` expected ` | ` { chainId: number; keyRegistry: Address; nowSecs?: number; maxAgeSecs?: number; } ` | Deployment of the issuer, current time and accepted age. |

Returns: ` Promise<SlotPolicyRequest> `.

Return details: The normalized request.

## Types

Options, data structures and return types.

<details>
<summary>Browse 76 types</summary>

- [ApplicationDeployment](#applicationdeployment)
- [ApplicationErrorCode](#applicationerrorcode)
- [ApplicationManifest](#applicationmanifest)
- [ApplicationSlotRecoveryCode](#applicationslotrecoverycode)
- [ApplicationStore](#applicationstore)
- [ApprovalPolicy](#approvalpolicy)
- [ApprovalPolicyAlreadyInstalled](#approvalpolicyalreadyinstalled)
- [AuthorizationRequest](#authorizationrequest)
- [AuthorizedOperationOptions](#authorizedoperationoptions)
- [BlsSlot](#blsslot)
- [CreateApplicationSlot](#createapplicationslot-1)
- [CreateApplicationSlotOptions](#createapplicationslotoptions)
- [CreateSlotOptions](#createslotoptions)
- [CredentialAuthorizationOptions](#credentialauthorizationoptions)
- [CredentialPolicyOptions](#credentialpolicyoptions)
- [DecryptSession](#decryptsession)
- [DecryptSessionConfig](#decryptsessionconfig)
- [DualOperationApprovalRecord](#dualoperationapprovalrecord)
- [DualOperationApprover](#dualoperationapprover)
- [DualOperationExpectation](#dualoperationexpectation)
- [DualOperationKind](#dualoperationkind)
- [DualOperationProof](#dualoperationproof)
- [EcdsaSignOptions](#ecdsasignoptions)
- [EcdsaSlot](#ecdsaslot)
- [EthereumSigningIntent](#ethereumsigningintent)
- [FrostSlot](#frostslot)
- [GrantedSessionOptions](#grantedsessionoptions)
- [IdentityExtractionOptions](#identityextractionoptions)
- [InstalledApprovalPolicy](#installedapprovalpolicy)
- [IssueCredentialOptions](#issuecredentialoptions)
- [IssueSlotPolicyInput](#issueslotpolicyinput)
- [LoadApplicationManifestOptions](#loadapplicationmanifestoptions)
- [MessageSigningIntent](#messagesigningintent)
- [ObservedSlotPolicy](#observedslotpolicy)
- [OpenDecryptSessionRequest](#opendecryptsessionrequest)
- [OperationAuthorizer](#operationauthorizer)
- [OperationGrant](#operationgrant)
- [P256SigningIntent](#p256signingintent)
- [P256Slot](#p256slot)
- [PreparedDualOperation](#prepareddualoperation)
- [PresentCredentialsOptions](#presentcredentialsoptions)
- [ReadySlotJournal](#readyslotjournal)
- [ResolveApplicationManifestOptions](#resolveapplicationmanifestoptions)
- [ResolvedApplicationManifest](#resolvedapplicationmanifest)
- [RotationAlreadyLocked](#rotationalreadylocked)
- [SessionBatchRequest](#sessionbatchrequest)
- [SessionBatchResult](#sessionbatchresult)
- [SessionCiphertext](#sessionciphertext)
- [SessionDecryptContext](#sessiondecryptcontext)
- [SessionGrantCreateFragment](#sessiongrantcreatefragment-1)
- [SessionGrantParams](#sessiongrantparams)
- [SessionKeyHandle](#sessionkeyhandle)
- [SessionMessageRequest](#sessionmessagerequest)
- [SessionMessageResult](#sessionmessageresult)
- [SessionTransport](#sessiontransport)
- [SigningIntent](#signingintent)
- [SlotCreationJournal](#slotcreationjournal)
- [SlotCreationProgress](#slotcreationprogress)
- [SlotMetadata](#slotmetadata)
- [SlotPolicyBootstrap](#slotpolicybootstrap)
- [SlotPolicyErrorCode](#slotpolicyerrorcode)
- [SlotPolicyExpectation](#slotpolicyexpectation)
- [SlotPolicyRequest](#slotpolicyrequest)
- [SlotPolicyStatement](#slotpolicystatement)
- [SlotTrust](#slottrust)
- [TasraApplication](#tasraapplication)
- [TasraApplicationConfig](#tasraapplicationconfig)
- [TasraClientOptions](#tasraclientoptions)
- [TasraDeployment](#tasradeployment)
- [TasraIdentity](#tasraidentity)
- [TasraWallet](#tasrawallet)
- [TransactionSigningIntent](#transactionsigningintent)
- [TypedDataSigningIntent](#typeddatasigningintent)
- [VerifyCredentialOptions](#verifycredentialoptions)
- [WalletTransactionInput](#wallettransactioninput)
- [WalletTransactionJournal](#wallettransactionjournal)

</details>

### ApplicationDeployment

Public application deployment settings with optional explicitly approved endpoint routing.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/manifest.ts#L10)

```ts
export interface ApplicationDeployment extends TasraDeployment {
    verifierAgentUrl?: string;
    keeperUrls?: Record<string, string>;
}
```

Fields:

- **` verifierAgentUrl `**: Explicitly approved verifier-agent endpoint.
- **` keeperUrls `**: Exact registered URL to reachable URL mappings; never inferred from a hostname.
- **` schemaVersion `**: Deployment descriptor schema version.
- **` name `**: Human-readable deployment identifier.
- **` chainId `**: EVM chain ID used to bind transactions and authorization.
- **` rpcUrl `**: HTTP or HTTPS JSON-RPC endpoint from the approved network configuration.
- **` addresses `**: Contract addresses resolved from the network manifest.
- **` coordinator `**: Explicit coordinator convention of the tested network build.
- **` provenance `**: Optional immutable deployment provenance; an active manifest alone is not readiness.

### ApplicationErrorCode

Failure categories for deployment, slot, authorization and result validation.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/client.ts#L44)

```ts
export type ApplicationErrorCode = 'CHAIN_MISMATCH' | 'SLOT_NOT_FOUND' | 'SLOT_CANCELLED' | 'WRONG_SLOT_MODE' | 'KEY_NOT_READY' | 'SLOT_CHANGED' | 'INVALID_AUTHORIZATION' | 'INVALID_RESULT';
```

### ApplicationManifest

A network manifest downloaded from tasra-releases or an explicitly approved application deployment.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/manifest.ts#L21)

```ts
export type ApplicationManifest = NetworkManifest | ApplicationDeployment;
```

Fields:

- **` schemaVersion `**: Deployment descriptor schema version. Network manifest schema version.
- **` chainId `**: EVM chain ID used to bind transactions and authorization. EVM chain ID matching the selected network profile.

### ApplicationSlotRecoveryCode

Stable recovery categories for a durable named slot creation.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/ready-slot.ts#L15)

```ts
export type ApplicationSlotRecoveryCode = 'SAVED_INTENT_MISMATCH' | 'SLOT_STATE_MISMATCH' | 'VERIFIER_POLICY_OUTCOME_UNKNOWN' | 'VERIFIER_POLICY_RECEIPT_PENDING' | 'VERIFIER_POLICY_REVERTED' | 'VERIFIER_POLICY_MISMATCH';
```

### ApplicationStore

Implementations must save atomically and exclusively lock across processes/tabs.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/ready-slot.ts#L40)

```ts
export interface ApplicationStore {
    load<T>(key: string): Promise<T | undefined>;
    save(key: string, value: unknown): Promise<void>;
    withLock<T>(key: string, operation: () => Promise<T>): Promise<T>;
    list?(prefix: string): Promise<string[]>;
    claim?(key: string): Promise<boolean>;
}
```

Fields:

- **` load `**: Load a saved value, or return undefined when the key does not exist.
- **` save `**: Atomically persist private state before resolving.
- **` withLock `**: Exclusively serialize work for the key across all participating processes or tabs.
- **` list `**: Optional: keys starting with `prefix`, in any order, for an application's own maintenance of its records. The SDK's flows never need it.
- **` claim `**: Optional: atomically and durably create the record `key` only if it does not exist, across all participating processes or tabs. Resolves true for exactly one caller, false when the key already exists. For an application's own one-use claims (e.g. "this record is sent once"); the SDK's flows never need it.

### ApprovalPolicy

Required approval count and either trusted Ed25519 keys or a credential rule.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/approvals.ts#L22)

```ts
export interface ApprovalPolicy {
    quorum: number;
    approvers?: readonly Uint8Array[];
    credentialPolicy?: string;
}
```

Fields:

- **` quorum `**: Minimum distinct approvals required to complete a signing request.
- **` approvers `**: Static Ed25519 approver keys. Use either this list or a credential policy.
- **` credentialPolicy `**: Exact raw DCQL rule whose unsalted hash the network must enforce.

### ApprovalPolicyAlreadyInstalled

The policy was already on chain exactly as requested: nothing was sent (the policy is set-once).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/approvals.ts#L44)

```ts
export interface ApprovalPolicyAlreadyInstalled {
    phase: 'already-installed';
    slotId: Hex;
    hash?: undefined;
}
```

Fields:

- **` phase `**: Nothing was sent: the requested policy is the installed one.
- **` slotId `**: The slot whose policy was found installed.
- **` hash `**: No transaction: kept so code reading `.hash` of a journal still compiles.

### AuthorizationRequest

Immutable operation details presented to the application authorizer.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/client.ts#L66)

```ts
export type AuthorizationRequest = Readonly<OperationInput & {
    signal?: AbortSignal;
}>;
```

Fields:

- **` decryption `**: Public recipient and epoch metadata bound into the operation digest before creator authorization.
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
- **` signal `**: Cancellation signal propagated to the authorization provider.

### AuthorizedOperationOptions

Authorization callback, consent description and cancellation controls for a protected operation.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/client.ts#L75)

```ts
export interface AuthorizedOperationOptions {
    authorize: OperationAuthorizer;
    description?: string;
    signal?: AbortSignal;
    userSignature?: Uint8Array;
}
```

Fields:

- **` authorize `**: Obtain a fresh holder-bound grant for this exact operation.
- **` description `**: Human-readable consent text attached to the authorization request.
- **` signal `**: Cancel pending authorization or network work.
- **` userSignature `**: Optional holder signature forwarded to the keeper operation.

### BlsSlot

BLS slot handle: KEM key wrapping (encrypt/decrypt) and identity-based encryption (encryptForIdentity/decryptForIdentity/extractIdentityKey), each decrypted from verified threshold shares.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/client.ts#L547)

```ts
export type BlsSlot = Awaited<ReturnType<TasraApplication['slots']['bls']>>;
```

Fields:

- **` slotId `**: Identifier of the BLS key-encryption slot.
- **` encrypt `**: BLS KEM-wrap a symmetric data key. Local — no credential or network round-trip needed.
- **` decrypt `**: Authorize and recover the KEM-wrapped symmetric key from verified, recipient-sealed threshold shares.
- **` encryptForIdentity `**: Identity-based encryption (IBE) to an identity string, such as a patient or document id. Public-key encryption; no credential or network authorization is requested.
- **` decryptForIdentity `**: Authorize identity-key extraction and decrypt an IBE ciphertext after verifying threshold shares.
- **` extractIdentityKey `**: Authorize and extract the identity's IBE private key. Explicit custody: the returned identity key persists independently of token expiry.

### CreateApplicationSlot

Named slot intent with an authorization rule, key threshold and verifier quorum.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/ready-slot.ts#L69)

```ts
export interface CreateApplicationSlot {
    name: string;
    mode: 'ecdsa' | 'frost' | 'bls';
    policy: string;
    authType?: 'oid4vp' | 'oauth';
    threshold: {
        k: number;
        n: number;
    };
    verifiers: {
        committee: number;
        quorum: number;
    };
    tags?: string[];
    rulePolicy?: CreateSlotArgs['rulePolicy'];
}
```

Fields:

- **` name `**: Stable recovery name. Reusing it resumes the same intent, never creates another slot.
- **` mode `**: Key capability: Ethereum account, Ed25519 signing or identity encryption.
- **` policy `**: Clear authorization rule. Its salted commitment is stored on-chain.
- **` authType `**: Authorization family; defaults to credential-wallet OID4VP.
- **` threshold `**: Minimum signing or extraction shares k out of n assigned keepers.
- **` verifiers `**: Verifier committee size and required authorization quorum.
- **` tags `**: Keeper selection tags; defaults to keykeeper.
- **` rulePolicy `**: Optional amendment authority installed atomically during creation.

### CreateApplicationSlotOptions

Creator wallet, durable storage and network controls for creating a ready slot.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/ready-slot.ts#L136)

```ts
export interface CreateApplicationSlotOptions {
    wallet: WriteClientWalletConfig['wallet'];
    signer: TypedDataSigner;
    store: ApplicationStore;
    keeperUrl?: (url: string) => string;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    timeoutMs?: number;
    onProgress?: (progress: SlotCreationProgress) => void | Promise<void>;
}
```

Fields:

- **` wallet `**: Creator wallet bound to the intended account and chain.
- **` signer `**: Creator EIP-712 signer used to authorize rule delivery.
- **` store `**: Private atomic store used to persist and lock the named creation intent.
- **` keeperUrl `**: Explicit routing callback for registered keeper endpoints.
- **` fetchImpl `**: HTTP implementation used to deliver rules to keepers.
- **` signal `**: Cancel pending work without reversing submitted transactions.
- **` timeoutMs `**: Cooperative cancellation deadline in milliseconds; defaults to 300000. Checked between stages; in-flight RPC requests and wallet prompts may outlast it. A resumed verifier-policy receipt wait uses this duration independently.
- **` onProgress `**: Observational progress callback. Callback failures do not interrupt creation.

### CreateSlotOptions

Per-operation overrides for the creator wallet, durable store and cancellation deadline.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/tasra-client.ts#L42)

```ts
export interface CreateSlotOptions {
    wallet?: TasraClientOptions['wallet'];
    store?: ApplicationStore;
    signal?: AbortSignal;
    timeoutMs?: number;
    onProgress?: (progress: SlotCreationProgress) => void | Promise<void>;
}
```

Fields:

- **` wallet `**: Creator wallet override for this creation request.
- **` store `**: Durable store override for the named slot intent.
- **` signal `**: Cancel pending creation work; submitted transactions remain on-chain.
- **` timeoutMs `**: Cooperative creation deadline in milliseconds. In-flight RPC requests and wallet prompts may outlast it; resumed receipt polling has its own wait.
- **` onProgress `**: Receive safe creation milestones. Callback failures do not interrupt creation.

### CredentialAuthorizationOptions

Approved verifier-agent endpoint, holder credentials and consent controls for operation authorization.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/identity.ts#L335)

```ts
export interface CredentialAuthorizationOptions {
    verifierAgentUrl: string;
    signer: TypedDataSigner;
    identity: TasraIdentity;
    credentials: readonly string[];
    delegation?: PresentationDelegation;
    approve?: (request: AuthorizationRequest) => boolean | Promise<boolean>;
    presentation?: Omit<PresentCredentialsOptions, 'signal'>;
    onPhase?: (phase: SessionPhase) => void;
    timeoutMs?: number;
}
```

Fields:

- **` verifierAgentUrl `**: Explicitly approved verifier-agent endpoint used for the session.
- **` signer `**: Creator or delegated EIP-712 signer authorizing the operation.
- **` identity `**: Live holder identity bound to the credentials.
- **` credentials `**: Serialized holder-bound credentials selected by the application.
- **` delegation `**: Optional authorization delegating presentation to another signer.
- **` approve `**: Optional application consent screen, called before any session or credential disclosure.
- **` presentation `**: Wallet request validation and credential-selection options.
- **` onPhase `**: Observe verifier-agent session progress.
- **` timeoutMs `**: Maximum wait for the verifier-agent result in milliseconds.

### CredentialPolicyOptions

Trusted issuer and claim restrictions used to build a credential authorization rule.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/identity.ts#L236)

```ts
export interface CredentialPolicyOptions {
    issuer: string | Pick<TasraIdentity, 'did'>;
    type: string;
    subjects?: readonly string[];
    claims?: Record<string, readonly unknown[]>;
    identityScope?: {
        claim: string;
        namespace?: ScopeNamespace;
    };
}
```

Fields:

- **` issuer `**: Issuer DID trusted by the generated rule.
- **` type `**: Required credential type.
- **` subjects `**: Allowed subject values; must be nonempty when supplied.
- **` claims `**: Top-level claim names with an explicit, nonempty list of allowed values.
- **` identityScope `**: Restrict decrypt/extract operations to scopes named in this credential claim.

### DecryptSession

An open decrypt session: decrypt any number of messages of its slots, then revoke it.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-open.ts#L139)

```ts
export interface DecryptSession {
    readonly session: GrantedSession;
    decrypt(slot: Hex, message: SessionCiphertext, options?: {
        signal?: AbortSignal;
    }): Promise<Uint8Array>;
    decryptMany(slot: Hex, messages: readonly SessionCiphertext[], options?: {
        signal?: AbortSignal;
    }): Promise<SessionDecryptResult[]>;
    revoke(): Promise<void>;
    stop(): void;
}
```

Fields:

- **` session `**: The current underlying session (replaced after an automatic re-open).
- **` decrypt `**: Decrypt one message of a granted slot. Throws `SessionMessageError` when the keepers refuse it and `SessionEndedError` when the session ended (unless `presentAgainOnEnd`).
- **` decryptMany `**: Decrypt many messages of ONE granted slot: 64 per keeper request, each request under one session-key proof. One result per message, in order; a refused message never fails the others.
- **` revoke `**: Revoke the session at the verifiers and end it locally (`GrantedSession.revoke`). Afterwards nothing is decrypted and no new presentation is started, whatever `presentAgainOnEnd` says.
- **` stop `**: Stop the background refresh without revoking (the grant runs out on its own).

### DecryptSessionConfig

What every session of an application shares.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-open.ts#L40)

```ts
export interface DecryptSessionConfig {
    app: Pick<TasraApplication, 'deployment' | 'chain'>;
    agent: {
        profile: ApprovedAgentProfile;
        transport: SessionAgentTransport;
    };
    store: ApplicationStore;
    signer: TypedDataSigner;
    delegation?: PresentationDelegation;
    present(session: RegisteredVerifierAgentSession, signal?: AbortSignal): Promise<void>;
    snapshotHosts?: readonly string[];
    defaultVerificationPolicy?: {
        committee: number;
        quorum: number;
    };
    ruleHash?(slot: Hex): Uint8Array | undefined;
    keeperUrl?(registeredUrl: string): string;
    fetchImpl?: typeof fetch;
    walletFetch?(session: RegisteredVerifierAgentSession): typeof fetch;
    allowLocalHttp?: boolean;
}
```

Fields:

- **` app `**: The application client (`createTasra`): its deployment addresses and chain reader.
- **` agent `**: The independently approved verifier-agent and its guarded transport (`createNodeAgentTransport` / `createBrowserAgentTransport`).
- **` store `**: Durable private store for the session journal (`createFileStore`, `createIndexedDbStore`; `createMemoryStore` for tests).
- **` signer `**: The key that signs the operation request. ANY key may open a session: the slot's creator, a creator-signed delegate (with `delegation`), or an unrelated key. The slot's rule decides whether the presented credential is admitted; the verifiers meter this signer's own quota.
- **` delegation `**: A creator-signed delegation for `signer`, when it has one.
- **` present `**: The wallet step: show the session's `qrPayload` (a QR or deep link) or run the application's own credential wallet against it. Resolve once the wallet has been asked; the result is polled.
- **` snapshotHosts `**: Accountant origins that serve the verifier-set snapshot artifacts, in preference order. Default: the registered accountants (`resolveAccountantUrls`), read once per opening. A host supplies only leaves; each artifact is verified against the root anchored on chain.
- **` defaultVerificationPolicy `**: The deployment's default verifier policy, for slots that name none on chain.
- **` ruleHash `**: keccak256 of a slot's raw rule, when the application holds the rule (e.g. from a slot policy statement). A grant naming another rule for that slot is then refused before use. Optional: without it the rule hash is taken as the drawn quorum signed it.
- **` keeperUrl `**: Caller-approved routing of a registered keeper URL (e.g. local Docker hostnames to published loopback ports).
- **` fetchImpl `**: HTTP implementation for keeper requests and snapshot reads; defaults to global fetch.
- **` walletFetch `**: HTTP implementation for reading the session's signed Request Object from the approved agent (Node: `createNodeAgentWalletFetch(session, policy)`). Default: `fetchImpl`, else global fetch.
- **` allowLocalHttp `**: Allow loopback keeper HTTP on a disposable local chain 43112 only. Default false.

### DualOperationApprovalRecord

One approval with the statement it signs, as an approver hands it back.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/dual-operation.ts#L101)

```ts
export interface DualOperationApprovalRecord {
    statement: DualOperationStatement;
    approval: DualOperationApproval;
}
```

Fields:

- **` statement `**: The statement the approver signed.
- **` approval `**: Its signature (and grant).

### DualOperationApprover

An Ed25519 approver: its public key and a callback that signs the exact supplied bytes.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/dual-operation.ts#L109)

```ts
export interface DualOperationApprover {
    publicKey: Uint8Array;
    sign(payload: Uint8Array): Promise<Uint8Array>;
}
```

Fields:

- **` publicKey `**: 32-byte Ed25519 public key.
- **` sign `**: Sign the exact supplied bytes; the SDK verifies the result.

### DualOperationExpectation

The exact operation a statement must name.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/dual-operation.ts#L185)

```ts
export interface DualOperationExpectation {
    chainId: number;
    slot: Uint8Array;
    operation: DualOperationKind;
    payloadDigest: Uint8Array;
    epoch?: number;
}
```

Fields:

- **` chainId `**: Deployment chain.
- **` slot `**: 32-byte slot ID.
- **` operation `**: The approved operation.
- **` payloadDigest `**: 32-byte payload digest of the operation (SHA-256 of an ECDSA digest; the recipient-bound digest of a decryption).
- **` epoch `**: The slot's key epoch, when the caller has read it; checked when given.

### DualOperationKind

The operation a statement approves (Rust `Operation`, kebab-case).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/dual-operation.ts#L23)

```ts
export type DualOperationKind = 'frost-sign' | 'secp256k1-sign' | 'p256-sign' | 'kem-decrypt' | 'ibe-extract';
```

### DualOperationProof

The `dual_control` field of an operation request (Rust `Proof`).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/dual-operation.ts#L81)

```ts
export interface DualOperationProof {
    statement: DualOperationStatement;
    approvals: DualOperationApproval[];
}
```

Fields:

- **` statement `**: The one statement every approval signs.
- **` approvals `**: Distinct approvals of it.

### EcdsaSignOptions

[AuthorizedOperationOptions](#authorizedoperationoptions) for a threshold ECDSA digest signature.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/client.ts#L95)

```ts
export interface EcdsaSignOptions extends AuthorizedOperationOptions {
    dualControl?: DualOperationProof;
}
```

Fields:

- **` dualControl `**: The assembled native approval bundle for THIS digest (`prepareOperationApproval`, then `approveDualOperation` or `approveSigningIntent`, then `assembleOperationApproval`). Required by a slot with an approval policy. Checked locally against the chain, slot, key epoch and SHA-256 of the digest before any credential work, and carried in the keeper request unchanged.
- **` authorize `**: Obtain a fresh holder-bound grant for this exact operation.
- **` description `**: Human-readable consent text attached to the authorization request.
- **` signal `**: Cancel pending authorization or network work.
- **` userSignature `**: Optional holder signature forwarded to the keeper operation.

### EcdsaSlot

Threshold Ethereum account handle that verifies each signature against the anchored public key.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/client.ts#L537)

```ts
export type EcdsaSlot = Awaited<ReturnType<TasraApplication['slots']['ecdsa']>>;
```

Fields:

- **` slotId `**: Identifier of the threshold ECDSA slot.
- **` getAddress `**: Recheck slot readiness and derive its Ethereum address from the current public key.
- **` signDigest `**: Authorize and sign an exact 32-byte Ethereum digest, then verify the recovered account.
- **` signIntent `**: Sign a structured intent (a transaction, EIP-712 typed data or a personal message): the SDK derives the digest itself, then signs it like `signDigest`.

### EthereumSigningIntent

What a secp256k1 slot signs, from which the SDK derives the Ethereum digest itself.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/signing-intents.ts#L41)

```ts
export type EthereumSigningIntent = TransactionSigningIntent | TypedDataSigningIntent | MessageSigningIntent;
```

Fields:

- **` kind `**: Intent kind.

### FrostSlot

Threshold Ed25519 signing handle with optional receipt checks and native approval sessions.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/client.ts#L543)

```ts
export type FrostSlot = Awaited<ReturnType<TasraApplication['slots']['frost']>>;
```

Fields:

- **` slotId `**: Identifier of the FROST signing slot.
- **` sign `**: Authorize the exact message and verify the returned signature, epoch and optional receipt.
- **` approvals `**: Quorum and approval mode must come from the application's independently pinned policy.

### GrantedSessionOptions

Lifecycle options.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-grants.ts#L181)

```ts
export interface GrantedSessionOptions {
    store: ApplicationStore;
    transport: SessionTransport;
    key: SessionKeyHandle;
    refreshLeadSecs?: number;
    onEnded?(error: SessionEndedError): void;
    onRefreshed?(grant: SessionGrantWire): void;
    beacon?: {
        latestEpoch(): Promise<bigint>;
        drawState?(): Promise<BeaconDrawState>;
        pollMs?: number;
    };
    contextRetryMs?: number;
    followRetryMs?: number;
    clock?: () => number;
}
```

Fields:

- **` store `**: Store that journals the session record (grant, reserved seq, end).
- **` transport `**: Transport for the agent's session refresh and revoke routes.
- **` key `**: The session key the grant binds; it signs every refresh and revoke.
- **` refreshLeadSecs `**: Refresh this many seconds before `exp` (default: a third of the grant's lifetime, at least 5 s).
- **` onEnded `**: Called once when the session ends and a new presentation is needed.
- **` onRefreshed `**: Called after every accepted refresh with the new grant (re-derive per-epoch trust or proofs here).
- **` beacon `**: The beacon's latest epoch (e.g. `readCurrentBeaconEpoch`). With it, ` GrantedSession.start ` also polls the beacon every `pollMs` (default 2000) and refreshes the grant in the background the moment the beacon moves past the grant's epoch (` GrantedSession.observeBeacon `).
- **` contextRetryMs `**: How long a run of `session_context_changed` refresh refusals the chain does not confirm is retried before the session ends, ms (default 15000; needs `beacon`). See ` SESSION_REFUSAL_CODES `.
- **` followRetryMs `**: Pause between follow attempts while a new epoch's anchors land, ms (default 1000; tests use 0).
- **` clock `**: Clock override, Unix seconds (tests).

### IdentityExtractionOptions

Authorization, receipt requirements and fan-out deadline for a BLS identity operation.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/client.ts#L106)

```ts
export interface IdentityExtractionOptions extends AuthorizedOperationOptions {
    recipient?: ClientRecipient;
    dualControl?: DualOperationProof;
    verifyingShares?: ReadonlyMap<number, Uint8Array>;
    requireReceipts?: boolean;
    timeoutMs?: number;
}
```

Fields:

- **` recipient `**: Client-held recipient (`createDecryptionRecipient`), prepared before authorization.
- **` dualControl `**: The assembled native approval bundle for THIS decryption or extraction, required by a slot with an approval policy (`prepareOperationApproval` with the operation's `payloadDigest`).
- **` verifyingShares `**: Independently authenticated public package; 144-byte G2 || G1 per identifier.
- **` requireReceipts `**: Require an authenticated receipt from every extraction share used. Default false.
- **` timeoutMs `**: Complete keeper extraction deadline in milliseconds, including response bodies. Default 10000. Does not cover the preceding wallet authorization.
- **` authorize `**: Obtain a fresh holder-bound grant for this exact operation.
- **` description `**: Human-readable consent text attached to the authorization request.
- **` signal `**: Cancel pending authorization or network work.
- **` userSignature `**: Optional holder signature forwarded to the keeper operation.

### InstalledApprovalPolicy

A slot's installed native approval policy, as `KeyRegistry` holds it.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/approvals.ts#L34)

```ts
export interface InstalledApprovalPolicy {
    quorum: number;
    ruleHash: Hex;
    approvers: Hex[];
}
```

Fields:

- **` quorum `**: Required distinct approvals; 0 means no policy is installed.
- **` ruleHash `**: keccak256 of the raw credential rule, or zero for static approvers.
- **` approvers `**: Static Ed25519 approver keys (lowercase hex), empty for a credential policy.

### IssueCredentialOptions

Issuer, holder and claims for a signed, expiring SD-JWT credential.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/identity.ts#L118)

```ts
export interface IssueCredentialOptions {
    issuer: TasraIdentity;
    holder: TasraIdentity;
    type: string;
    claims: Record<string, unknown>;
    subject?: string;
    ttlSecs?: number;
    nowSecs?: number;
}
```

Fields:

- **` issuer `**: Identity whose private key signs the credential.
- **` holder `**: Identity whose DID receives the credential key binding.
- **` type `**: Credential type written to the vct claim.
- **` claims `**: Application claims; reserved protocol claims are rejected.
- **` subject `**: Defaults to the holder DID. Human/application subject DIDs are also supported.
- **` ttlSecs `**: Defaults to one hour.
- **` nowSecs `**: Issuance time in Unix seconds; defaults to the current clock.

### IssueSlotPolicyInput

What the slot creator attests in one policy statement.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/policy-bootstrap.ts#L326)

```ts
export interface IssueSlotPolicyInput {
    signer: Pick<LocalAccount, 'address' | 'signTypedData'>;
    slot: Hex;
    rule: string;
    salt: Hex;
    audience: Address;
    actions: CommitteeAction[];
    sequence: number;
    ttlSecs?: number;
    nowSecs?: number;
}
```

Fields:

- **` signer `**: The slot creator's signer (a local account or a remote EIP-712 signer).
- **` slot `**: Slot to describe.
- **` rule `**: Exact raw rule bytes as provisioned.
- **` salt `**: The rule salt; used only to check the commitment and never placed in the statement.
- **` audience `**: Holder application key the statement is issued to.
- **` actions `**: Committee actions the holder application may run.
- **` sequence `**: Monotonic issue counter per slot and holder application (issue a higher one to supersede).
- **` ttlSecs `**: Lifetime in seconds, 1..86400 (default 900).
- **` nowSecs `**: Current Unix seconds (default: the system clock).

### LoadApplicationManifestOptions

Manifest download controls and an optional independently trusted SHA-256 pin.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/manifest.ts#L53)

```ts
export interface LoadApplicationManifestOptions extends ResolveApplicationManifestOptions {
    sha256?: string;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
}
```

Fields:

- **` sha256 `**: Lowercase SHA-256 of the downloaded bytes, obtained from a trusted source.
- **` fetchImpl `**: HTTP implementation used to download manifest bytes.
- **` signal `**: Cancel the manifest HTTP download.
- **` rpcUrl `**: Explicit JSON-RPC endpoint override for the chosen network.
- **` coordinator `**: Required for release manifests, whose schema does not specify this convention.

### MessageSigningIntent

An EIP-191 personal message; the digest is its `personal_sign` hash.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/signing-intents.ts#L33)

```ts
export interface MessageSigningIntent {
    kind: 'message';
    message: string | Uint8Array;
}
```

Fields:

- **` kind `**: Intent kind.
- **` message `**: The message text or bytes, at most 64 KiB.

### ObservedSlotPolicy

The on-chain slot fields a statement must match at one canonical block.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/policy-bootstrap.ts#L275)

```ts
export interface ObservedSlotPolicy {
    creator: Address;
    ruleCommitment: Hex;
    ruleVersion: number;
}
```

Fields:

- **` creator `**: On-chain slot creator.
- **` ruleCommitment `**: On-chain salted rule commitment.
- **` ruleVersion `**: On-chain rule version.

### OpenDecryptSessionRequest

What one opening asks for.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-open.ts#L96)

```ts
export interface OpenDecryptSessionRequest extends Omit<SessionGrantParams, 'slots'> {
    slots: Hex[];
    first: SessionCiphertext & {
        slot: Hex;
    };
    description?: string;
    signal?: AbortSignal;
    onPhase?(phase: SessionPhase): void;
    timeoutMs?: number;
    presentAgainOnEnd?: boolean;
    onEnded?(error: SessionEndedError): void;
}
```

Fields:

- **` slots `**: The KEM slots the session may decrypt for (1..16, distinct); `first.slot` must be one of them.
- **` first `**: The message the opening presentation names: a session opens from a KEM decrypt of one real ciphertext. It is decrypted under the grant like any other message (`decrypt`).
- **` description `**: Shown by the wallet as the purpose of the presentation.
- **` signal `**: Cancel the opening (the wallet wait included).
- **` onPhase `**: Called on every poll with the phase the UI may show.
- **` timeoutMs `**: How long to wait for the wallet and the committee, ms (default 300000).
- **` presentAgainOnEnd `**: Present again automatically when the session ends under a message (idle or absolute expiry, a definite refusal, the beacon two epochs past the grant): `present` is called once more and the message continues on the new session. Default false: the end is thrown (`SessionEndedError`) and the application opens a new session when it chooses.
- **` onEnded `**: Called once when a session ends and a new presentation is needed.
- **` accessTtlSecs `**: Grant lifetime before a refresh is needed (platform cap 45 s, default 30).
- **` idleTimeoutSecs `**: Longest idle gap between refreshes (cap 1800 s).
- **` absoluteTtlSecs `**: Longest session life from its presentation (cap 12 h).

### OperationAuthorizer

Called once for the exact operation. Applications display the wallet request here.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/client.ts#L71)

```ts
export type OperationAuthorizer = (request: AuthorizationRequest) => Promise<OperationGrant>;
```

### OperationGrant

Holder-bound committee token and verifier membership proofs for one operation.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/client.ts#L55)

```ts
export interface OperationGrant {
    evidenceCt?: string;
    token: CompoundTokenWire;
    verifierProofs: VerifierProof[];
}
```

Fields:

- **` evidenceCt `**: Exact sealed presentation ciphertext for this grant.
- **` token `**: Fresh compound verifier token bound to the holder and exact operation.
- **` verifierProofs `**: Membership proofs for the verifiers that authorized the operation.

### P256SigningIntent

What a P-256 slot signs: the SHA-256 of exactly these bytes.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/signing-intents.ts#L44)

```ts
export interface P256SigningIntent {
    kind: 'sha256';
    data: Uint8Array;
}
```

Fields:

- **` kind `**: Intent kind.
- **` data `**: The bytes, at most 64 KiB.

### P256Slot

A ready threshold P-256 slot adapter returned by `app.slots.p256(slotId)`.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/client.ts#L539)

```ts
export type P256Slot = Awaited<ReturnType<TasraApplication['slots']['p256']>>;
```

Fields:

- **` slotId `**: Identifier of the threshold P-256 slot.
- **` getPublicKey `**: Recheck slot readiness and return its compressed P-256 group public key.
- **` signDigest `**: Authorize and sign an exact 32-byte digest, verified under the anchored P-256 key.
- **` signIntent `**: Sign the SHA-256 of exactly `intent.data`: the SDK derives the digest itself.

### PreparedDualOperation

A prepared statement and its exact signed bytes.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/dual-operation.ts#L89)

```ts
export interface PreparedDualOperation {
    statement: DualOperationStatement;
    message_hex: string;
    payload_digest: string;
    action: 'dual-approve';
}
```

Fields:

- **` statement `**: The statement approvers sign.
- **` message_hex `**: Hex of the signed preimage (domain + canonical JSON).
- **` payload_digest `**: Hex SHA-256 of the preimage: the digest a credentialed approver's dual-approve grant binds.
- **` action `**: The presentation action a credentialed approver's grant uses.

### PresentCredentialsOptions

Credential selection, request validation and cancellation controls for OID4VP presentation.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/identity.ts#L292)

```ts
export interface PresentCredentialsOptions extends PresentOpts {
    signal?: AbortSignal;
}
```

Fields:

- **` signal `**: Cancel pending wallet presentation work.
- **` choose `**: Pick among the candidates (default: the evaluator's choice). Return `undefined` to abort.
- **` disclose `**: Claim names to disclose, or all; defaults to the selected query's requested claims.
- **` fetchImpl `**: HTTP transport override; defaults to the global fetch implementation.
- **` resolveKey `**: Resolver supplying a trusted public key for the request issuer and key identifier.
- **` nowSecs `**: Current time override in Unix seconds.
- **` leewaySecs `**: Seconds of clock skew tolerated on `exp`.

### ReadySlotJournal

Private creation journal tracking rule delivery and verifier-policy installation.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/ready-slot.ts#L100)

```ts
export interface ReadySlotJournal {
    schemaVersion: 1;
    request: CreateApplicationSlot;
    creation: SlotCreationJournal;
    provisioned?: boolean;
    verifierPolicy?: {
        phase: 'submitting' | 'submitted' | 'confirmed';
        hash?: Hex;
    };
}
```

Fields:

- **` schemaVersion `**: Ready-slot journal schema version.
- **` request `**: Original named application creation request.
- **` creation `**: Private slot creation intent and its transaction history.
- **` provisioned `**: Whether this journal previously completed rule delivery.
- **` verifierPolicy `**: Durable verifier-policy transaction phase and hash.

### ResolveApplicationManifestOptions

Explicit RPC and coordinator choices applied when resolving a network manifest.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/manifest.ts#L25)

```ts
export interface ResolveApplicationManifestOptions {
    rpcUrl?: string;
    coordinator?: TasraDeployment['coordinator'];
}
```

Fields:

- **` rpcUrl `**: Explicit JSON-RPC endpoint override for the chosen network.
- **` coordinator `**: Required for release manifests, whose schema does not specify this convention.

### ResolvedApplicationManifest

Validated deployment settings and optional endpoint routing for an application client.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/manifest.ts#L36)

```ts
export interface ResolvedApplicationManifest {
    deployment: Readonly<TasraDeployment>;
    verifierAgentUrl?: string;
    keeperUrl?: (registeredUrl: string) => string;
}
```

Fields:

- **` deployment `**: Validated network configuration suitable for an application client.
- **` verifierAgentUrl `**: Verifier-agent endpoint advertised by the approved configuration.
- **` keeperUrl `**: Explicit routing function for registered keeper endpoints, when configured.

### RotationAlreadyLocked

The slot was already locked against rotation: nothing was sent (the lock is set-once).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/rotation-lock.ts#L10)

```ts
export interface RotationAlreadyLocked {
    phase: 'already-locked';
    slotId: Hex;
    lockedByCreator: boolean;
    lockedByMode: boolean;
    hash?: undefined;
}
```

Fields:

- **` phase `**: Nothing was sent: no rotation could change this slot's key already.
- **` slotId `**: The slot found locked.
- **` lockedByCreator `**: The creator locked it earlier.
- **` lockedByMode `**: It is a threshold-ECDSA slot, which the network locks by its mode.
- **` hash `**: No transaction: kept so code reading `.hash` of a journal still compiles.

### SessionBatchRequest

Up to 64 messages of one slot, decrypted in one request per keeper.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-decrypt.ts#L71)

```ts
export interface SessionBatchRequest extends SessionDecryptContext {
    messages: SessionDecryptItem[];
}
```

Fields:

- **` messages `**: The ciphertexts, each with its own fresh client recipient.
- **` session `**: The accepted session ([GrantedSession](#grantedsession)); call its `start()` so it follows the beacon.
- **` reopen `**: Open a NEW session when `session` ended before a message was served (`SessionEndedError`): ONE fresh presentation in session mode, accepted and started. The message is then sent under its grant. Called at most once per message, and once per ended session across concurrent messages (the others continue on its new session); without it the end is thrown.
- **` slot `**: KEM slot the grant names.
- **` keepers `**: The keepers and their shares: everything ` decryptWithSessionGrant ` takes but the grant, key and proofs.
- **` verifierProofs `**: The anchored membership witnesses of the grant's draw at `epoch` (every production keeper requires them).
- **` latestBeaconEpoch `**: The beacon's latest epoch, read FRESH from the chain for each decision (`readCurrentBeaconEpoch` with `{fresh: true}`: an RPC `latest` head of its own, never a followed tip that may lag the keepers' head). A keeper's refusal text never sets the session's beacon: it only triggers this read. Without it a keeper's "stale" is never confirmed, so it is thrown, not retried.
- **` signal `**: Aborts the keeper requests.
- **` hooks `**: Observers (timing, accounting); a throw from one is the caller's own.

### SessionBatchResult

The outcome of a batch: one result per message, in order.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-decrypt.ts#L92)

```ts
export interface SessionBatchResult {
    results: SessionDecryptResult[];
    grantEpoch: bigint;
    session: GrantedSession;
}
```

Fields:

- **` results `**: Per message: the plaintext, or the keepers' refusal.
- **` grantEpoch `**: The epoch of the grant that served it.
- **` session `**: The session for the next messages: `request.session`, or the one `reopen` returned.

### SessionCiphertext

One KEM ciphertext and the identity (associated data) it was encrypted under.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-open.ts#L88)

```ts
export interface SessionCiphertext {
    ciphertext: Ciphertext;
    identity: Uint8Array;
}
```

Fields:

- **` ciphertext `**: The KEM ciphertext.
- **` identity `**: Exact identity (associated data) bytes used at encryption.

### SessionDecryptContext

What every message of a session shares: the session, its slot's keepers and the chain reads.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-decrypt.ts#L30)

```ts
export interface SessionDecryptContext {
    session: GrantedSession;
    reopen?(ended: SessionEndedError): Promise<GrantedSession>;
    slot: Hex;
    keepers: Omit<SessionDecryptOptions, 'grant' | 'verified' | 'key' | 'slotId' | 'verifierProofs' | 'signal'>;
    verifierProofs?(slot: Hex, epoch: bigint): Promise<SessionVerifierProofWire[] | undefined>;
    latestBeaconEpoch?(): Promise<bigint>;
    signal?: AbortSignal;
    hooks?: {
        onRetry?(reason: 'stale'): void;
        onReopen?(code: string): void;
    };
}
```

Fields:

- **` session `**: The accepted session ([GrantedSession](#grantedsession)); call its `start()` so it follows the beacon.
- **` reopen `**: Open a NEW session when `session` ended before a message was served (`SessionEndedError`): ONE fresh presentation in session mode, accepted and started. The message is then sent under its grant. Called at most once per message, and once per ended session across concurrent messages (the others continue on its new session); without it the end is thrown.
- **` slot `**: KEM slot the grant names.
- **` keepers `**: The keepers and their shares: everything ` decryptWithSessionGrant ` takes but the grant, key and proofs.
- **` verifierProofs `**: The anchored membership witnesses of the grant's draw at `epoch` (every production keeper requires them).
- **` latestBeaconEpoch `**: The beacon's latest epoch, read FRESH from the chain for each decision (`readCurrentBeaconEpoch` with `{fresh: true}`: an RPC `latest` head of its own, never a followed tip that may lag the keepers' head). A keeper's refusal text never sets the session's beacon: it only triggers this read. Without it a keeper's "stale" is never confirmed, so it is thrown, not retried.
- **` signal `**: Aborts the keeper requests.
- **` hooks `**: Observers (timing, accounting); a throw from one is the caller's own.

### SessionGrantCreateFragment

The `session_grant` object added to `POST /v1/sessions` (session mode).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-grants.ts#L83)

```ts
export interface SessionGrantCreateFragment {
    session_grant: SessionGrantRequestWire;
}
```

Fields:

- **` session_grant `**: Session key, slots and requested lifetimes.

### SessionGrantParams

Requested session parameters; the platform clamps them and the grant carries the granted values.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-grants.ts#L71)

```ts
export interface SessionGrantParams {
    slots: `0x${string}`[];
    accessTtlSecs?: number;
    idleTimeoutSecs?: number;
    absoluteTtlSecs?: number;
}
```

Fields:

- **` slots `**: KEM slots (1..16, distinct).
- **` accessTtlSecs `**: Grant lifetime before a refresh is needed (platform cap 45 s, default 30).
- **` idleTimeoutSecs `**: Longest idle gap between refreshes (cap 1800 s).
- **` absoluteTtlSecs `**: Longest session life from its presentation (cap 12 h).

### SessionKeyHandle

A session key the client holds; only its public JWK ever leaves it.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-grants.ts#L26)

```ts
export interface SessionKeyHandle {
    readonly jwk: SessionKeyJwk;
    sign(hash: Uint8Array): Promise<Uint8Array>;
    dispose(): void;
}
```

Fields:

- **` jwk `**: Public JWK sent at session create (RFC 7638 members only).
- **` sign `**: 64-byte signature over a 32-byte proof or control hash (Ed25519, or ES256 `r ‖ s`).
- **` dispose `**: Forget the private key (in-memory Ed25519 keys are zeroed; WebCrypto keys are dropped).

### SessionMessageRequest

One message to decrypt under a session.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-decrypt.ts#L65)

```ts
export interface SessionMessageRequest extends SessionDecryptContext {
    message: SessionDecryptItem;
}
```

Fields:

- **` message `**: The ciphertext, its identity, epoch and a fresh client recipient.
- **` session `**: The accepted session ([GrantedSession](#grantedsession)); call its `start()` so it follows the beacon.
- **` reopen `**: Open a NEW session when `session` ended before a message was served (`SessionEndedError`): ONE fresh presentation in session mode, accepted and started. The message is then sent under its grant. Called at most once per message, and once per ended session across concurrent messages (the others continue on its new session); without it the end is thrown.
- **` slot `**: KEM slot the grant names.
- **` keepers `**: The keepers and their shares: everything ` decryptWithSessionGrant ` takes but the grant, key and proofs.
- **` verifierProofs `**: The anchored membership witnesses of the grant's draw at `epoch` (every production keeper requires them).
- **` latestBeaconEpoch `**: The beacon's latest epoch, read FRESH from the chain for each decision (`readCurrentBeaconEpoch` with `{fresh: true}`: an RPC `latest` head of its own, never a followed tip that may lag the keepers' head). A keeper's refusal text never sets the session's beacon: it only triggers this read. Without it a keeper's "stale" is never confirmed, so it is thrown, not retried.
- **` signal `**: Aborts the keeper requests.
- **` hooks `**: Observers (timing, accounting); a throw from one is the caller's own.

### SessionMessageResult

A decrypted message.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-decrypt.ts#L82)

```ts
export interface SessionMessageResult {
    plaintext: Uint8Array;
    grantEpoch: bigint;
    session: GrantedSession;
}
```

Fields:

- **` plaintext `**: The decrypted message bytes.
- **` grantEpoch `**: The epoch of the grant that served it.
- **` session `**: The session for the next messages: `request.session`, or the one `reopen` returned.

### SessionTransport

Where a session's refresh and revoke go, and how its slots are trusted. Refresh and revoke travel
through the SAME guarded registered-agent transport and request policy as every other agent
call (verified TLS, connection-time destination checks, no redirects, bounded replies); the routes
carry no bearer, because the session-key signature is their authorization.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-grants.ts#L139)

```ts
export interface SessionTransport {
    chainId: number;
    agent: {
        profile: ApprovedAgentProfile;
        transport: SessionControlTransport;
    };
    trust(slot: `0x${string}`, epoch: bigint): Promise<SlotTrust>;
}
```

Fields:

- **` chainId `**: The configured deployment chain: a grant naming any other chain is refused on accept, refresh and resume.
- **` agent `**: The approved verifier-agent and its guarded transport (`createNodeAgentTransport` / `createBrowserAgentTransport`).
- **` trust `**: Verification material per granted slot, read from the chain by the caller (`createSlotDrawReader`).

### SigningIntent

Either curve's structured intent.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/signing-intents.ts#L52)

```ts
export type SigningIntent = EthereumSigningIntent | P256SigningIntent;
```

Fields:

- **` kind `**: Intent kind.

### SlotCreationJournal

Private durable creation intent and transaction progress required to resume the same slot.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/creation.ts#L11)

```ts
export interface SlotCreationJournal {
    schemaVersion: 1;
    deployment: TasraDeployment;
    creator: Address;
    intent: CreateSlotArgs & {
        slotId: Hex;
        salt: Hex;
        ruleSalt: Hex;
    };
    commit?: {
        phase: 'submitting' | 'submitted' | 'confirmed';
        hash?: Hex;
    };
    reveal?: {
        phase: 'submitting' | 'submitted' | 'confirmed';
        hash?: Hex;
        seeded?: boolean;
    };
    result?: Awaited<ReturnType<TasraWriteClient['createSlotCommitReveal']>>;
}
```

Fields:

- **` schemaVersion `**: Creation journal schema version.
- **` deployment `**: Deployment snapshot saved when the intent was prepared.
- **` creator `**: Account authorized to commit and reveal this slot.
- **` intent `**: Private durable data: includes the rule and its salt. Do not put in public evidence.
- **` commit `**: Saved commit-submission phase and transaction hash, when known.
- **` reveal `**: Saved reveal phase, transaction hash and seed-path choice.
- **` result `**: Confirmed commit-reveal result after slot creation.

### SlotCreationProgress

Public milestone emitted while a named slot is created or resumed.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/ready-slot.ts#L123)

```ts
export interface SlotCreationProgress {
    step: 'commit' | 'reveal' | 'key_generation' | 'rule_provisioning' | 'verifier_policy' | 'ready';
    phase: 'waiting' | 'submitting' | 'submitted' | 'confirmed' | 'complete';
    slotId: Hex;
    transactionHash?: Hex;
}
```

Fields:

- **` step `**: Creation stage.
- **` phase `**: Current stage state. Transaction stages use submitting, submitted and confirmed.
- **` slotId `**: Public slot ID shared by every milestone.
- **` transactionHash `**: Public transaction hash when known.

### SlotMetadata

Current slot mode, key epoch, threshold and anchored public key.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/client.ts#L137)

```ts
export interface SlotMetadata {
    slotId: Hex;
    mode: number;
    epoch: number;
    threshold: {
        k: number;
        n: number;
    };
    publicKey: Hex;
    ready: boolean;
}
```

Fields:

- **` slotId `**: 32-byte identifier of the slot on this deployment.
- **` mode `**: Registry key-mode ordinal: 0 for FROST, 1 for BLS or 2 for threshold ECDSA.
- **` epoch `**: Current key epoch recorded by the registry.
- **` threshold `**: Minimum participating shares k and total assigned shares n.
- **` publicKey `**: Anchored group public key as hexadecimal bytes.
- **` ready `**: Whether the registry contains a nonempty group public key.

### SlotPolicyBootstrap

A creator-signed slot policy statement and the exact raw rule it hashes. Never carries the rule salt.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/policy-bootstrap.ts#L134)

```ts
export interface SlotPolicyBootstrap {
    statement: SlotPolicyStatement;
    rule: string;
    signature: Hex;
}
```

Fields:

- **` statement `**: The signed statement.
- **` rule `**: The exact raw rule bytes the statement's `ruleHash` covers, as provisioned.
- **` signature `**: The slot creator's 65-byte EIP-712 signature over the statement.

### SlotPolicyErrorCode

Stable refusal categories of the policy bootstrap; branch on `code`, never on the message.
None is retryable with the same input.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/policy-bootstrap.ts#L69)

```ts
export type SlotPolicyErrorCode = 'malformed' | 'wrong-deployment' | 'wrong-slot' | 'wrong-audience' | 'out-of-scope' | 'stale' | 'substituted-rule' | 'wrong-signer' | 'changed-policy' | 'replayed' | 'equivocated' | 'not-issuable';
```

### SlotPolicyExpectation

What a holder application expects of a slot policy statement.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/policy-bootstrap.ts#L232)

```ts
export interface SlotPolicyExpectation {
    chainId: number;
    keyRegistry: Address;
    slot: Hex;
    audience: Address;
    action?: CommitteeAction;
    signer?: Address;
    nowSecs?: number;
}
```

Fields:

- **` chainId `**: Chain of the approved deployment.
- **` keyRegistry `**: KeyRegistry of the approved deployment.
- **` slot `**: Slot the operation targets.
- **` audience `**: This holder application's key.
- **` action `**: Action the operation runs; it must be in the statement's scope.
- **` signer `**: Expected signer (the slot creator); the recovered signer is returned either way.
- **` nowSecs `**: Current Unix seconds (default: the system clock).

### SlotPolicyRequest

A holder application's signed request for a slot policy statement. Not a holder credential.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/policy-bootstrap.ts#L144)

```ts
export interface SlotPolicyRequest {
    chainId: number;
    keyRegistry: Address;
    slot: Hex;
    audience: Address;
    nonce: Hex;
    issuedAt: number;
    signature: Hex;
}
```

Fields:

- **` chainId `**: Chain the slot lives on.
- **` keyRegistry `**: KeyRegistry that holds the slot.
- **` slot `**: Slot whose policy is requested.
- **` audience `**: Holder application key that signs the request and receives the statement.
- **` nonce `**: Random request nonce; the issuer refuses a nonce it has already answered.
- **` issuedAt `**: Unix seconds of the request.
- **` signature `**: The holder application's 65-byte EIP-712 signature over the request.

### SlotPolicyStatement

The public policy of one slot as its creator attests it to one holder application. Contains no salt.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/policy-bootstrap.ts#L106)

```ts
export interface SlotPolicyStatement {
    chainId: number;
    keyRegistry: Address;
    slot: Hex;
    ruleVersion: number;
    ruleCommitment: Hex;
    ruleHash: Hex;
    audience: Address;
    actions: CommitteeAction[];
    sequence: number;
    issuedAt: number;
    expiresAt: number;
    bootstrapId: Hex;
}
```

Fields:

- **` chainId `**: Chain the slot lives on.
- **` keyRegistry `**: KeyRegistry that holds the slot.
- **` slot `**: Slot the statement describes.
- **` ruleVersion `**: On-chain rule version the rule belongs to.
- **` ruleCommitment `**: On-chain salted rule commitment the rule belongs to.
- **` ruleHash `**: keccak256 of the exact raw rule bytes, the hash verifier tokens bind.
- **` audience `**: Holder application key the statement was issued to.
- **` actions `**: Committee actions the holder application may run with this statement.
- **` sequence `**: Monotonic issue counter per slot and holder application; a lower one is refused once a higher one was accepted.
- **` issuedAt `**: Unix seconds of issue.
- **` expiresAt `**: Unix seconds after which the statement no longer starts an operation.
- **` bootstrapId `**: Random identifier of this issue.

### SlotTrust

Independently established verification material for one granted slot.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-grants.ts#L115)

```ts
export interface SlotTrust {
    set: VerifierSet;
    committee: number;
    quorum: number;
    ruleHash?: Uint8Array;
    seed: Uint8Array;
}
```

Fields:

- **` set `**: Active verifier set (registry size + index to Ed25519 key) at the grant's epoch.
- **` committee `**: The slot's committee size and quorum.
- **` quorum `**: Signatures from the slot's drawn committee required.
- **` ruleHash `**: keccak256 of the slot's raw rule, when the application holds the rule (its owner, or anyone the rule was shared with). With it, a grant naming another rule for the slot is refused here. Without it the grant's rule hash is taken as the drawn quorum signed it; the keepers still check it against the rule they hold.
- **` seed `**: The beacon seed of the grant's epoch, `beacon.seedAt(epoch)`, read from the chain: a grant on any other seed is refused.

### TasraApplication

Application client exposing checked slot operations and deployment readiness probes.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/client.ts#L533)

```ts
export type TasraApplication = ReturnType<typeof createTasra>;
```

Fields:

- **` deployment `**: Validated configuration for the selected deployment.
- **` chain `**: Read-only chain client bound to the selected deployment.
- **` check `**: Read-only chain and registry probe. Does not claim keeper/issuer compatibility.
- **` slots `**: Slot metadata reads and capability-specific signing or encryption adapters.

### TasraApplicationConfig

Deployment, chain reader and transport choices used by the application client.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/client.ts#L124)

```ts
export interface TasraApplicationConfig {
    deployment: TasraDeployment;
    chain?: TasraChainClient;
    keeperUrl?: (registeredUrl: string) => string;
    fetchImpl?: typeof fetch;
}
```

Fields:

- **` deployment `**: Application-approved chain, registry and coordinator configuration.
- **` chain `**: Reuse the read client in an existing app. Its actual chain is checked before use.
- **` keeperUrl `**: Caller-approved routing, e.g. local Docker hostnames to published loopback ports.
- **` fetchImpl `**: HTTP implementation used for keeper operation requests.

### TasraClientOptions

Network manifest and optional wallet, storage and transport adapters for an application.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/tasra-client.ts#L11)

```ts
export interface TasraClientOptions extends ResolveApplicationManifestOptions {
    manifest: ApplicationManifest;
    store?: ApplicationStore;
    wallet?: Pick<ReturnType<typeof createLocalWallet>, 'wallet' | 'signer'>;
    chain?: TasraApplicationConfig['chain'];
    keeperUrl?: TasraApplicationConfig['keeperUrl'];
    fetchImpl?: typeof fetch;
    verifierAgentUrl?: string;
}
```

Fields:

- **` manifest `**: Network manifest downloaded from tasra-releases, or approved application settings.
- **` store `**: Private durable store required when creating slots.
- **` wallet `**: Creator wallet; connect a browser wallet or explicitly generate a local one.
- **` chain `**: Optional existing read client; deployment consistency is checked.
- **` keeperUrl `**: Explicit mapping from registered keeper endpoints to reachable endpoints.
- **` fetchImpl `**: HTTP implementation for manifest and keeper requests.
- **` verifierAgentUrl `**: Explicit verifier-agent endpoint override.
- **` rpcUrl `**: Explicit JSON-RPC endpoint override for the chosen network.
- **` coordinator `**: Required for release manifests, whose schema does not specify this convention.

### TasraDeployment

Public, versioned application configuration. Never contains credentials or private keys.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/deployment.ts#L5)

```ts
export interface TasraDeployment {
    schemaVersion: 1;
    name: string;
    chainId: number;
    rpcUrl: string;
    addresses: AddressBook;
    coordinator: 'lowest-operator-id' | 'assigned-first';
    provenance?: {
        networkRevision: string;
        manifestSha256?: string;
    };
}
```

Fields:

- **` schemaVersion `**: Deployment descriptor schema version.
- **` name `**: Human-readable deployment identifier.
- **` chainId `**: EVM chain ID used to bind transactions and authorization.
- **` rpcUrl `**: HTTP or HTTPS JSON-RPC endpoint from the approved network configuration.
- **` addresses `**: Contract addresses resolved from the network manifest.
- **` coordinator `**: Explicit coordinator convention of the tested network build.
- **` provenance `**: Optional immutable deployment provenance; an active manifest alone is not readiness.

### TasraIdentity

DID identity with holder and issuer adapters backed by one managed signing key.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/identity.ts#L16)

```ts
export interface TasraIdentity {
    readonly did: string;
    readonly algorithm: 'Ed25519' | 'P-256';
    readonly holder: HolderKey;
    readonly issuer: SdJwtIssuer;
    exportPrivateKey(): Uint8Array;
    destroy(): void;
    toJSON(): {
        did: string;
        algorithm: 'Ed25519' | 'P-256';
    };
}
```

Fields:

- **` did `**: Self-certifying DID derived from the identity public key.
- **` algorithm `**: Signing curve used by holder and issuer adapters.
- **` holder `**: Advanced adapter access. Contains private key bytes; never log or serialize it.
- **` issuer `**: Advanced issuer adapter. Contains private key bytes; never log or serialize it.
- **` exportPrivateKey `**: Explicit backup. The caller must protect and eventually clear this independent copy.
- **` destroy `**: Clears SDK-owned key bytes. Cannot erase previously exported copies.
- **` toJSON `**: Return public identity metadata without serializing private key bytes.

### TasraWallet

Chain-bound wallet adapter with durable transaction submission and receipt recovery.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/wallet.ts#L76)

```ts
export interface TasraWallet {
    address: Address;
    wallet: WalletClient<Transport, Chain, Account>;
    signer: TypedDataSigner;
    getBalance(): Promise<bigint>;
    getTransactionCount(): Promise<number>;
    transfer(name: string, input: WalletTransactionInput, store: ApplicationStore): Promise<WalletTransactionJournal>;
    sendTransaction(input: WalletTransactionInput, options: {
        persist: (journal: WalletTransactionJournal) => Promise<void>;
    }): Promise<WalletTransactionJournal>;
    waitForTransaction(journal: WalletTransactionJournal, options?: {
        timeoutMs?: number;
        persist?: (journal: WalletTransactionJournal) => Promise<void>;
    }): Promise<WalletTransactionJournal>;
}
```

Fields:

- **` address `**: Selected EVM account address.
- **` wallet `**: Bound viem wallet for advanced integrations.
- **` signer `**: EIP-712 signer that rechecks account and chain consistency.
- **` getBalance `**: Read this account native-token balance in base units.
- **` getTransactionCount `**: Read the pending account nonce from the configured RPC.
- **` transfer `**: Persist and serialize a named transfer. Reusing its name only observes the saved transaction.
- **` sendTransaction `**: Serialize calls per account; persist must be durable before resolving. A failed send is never automatically retried.
- **` waitForTransaction `**: Observes the saved hash only; never signs, replaces, or broadcasts. Unknown external-wallet outcomes require reconciliation.

### TransactionSigningIntent

An EIP-155 or typed transaction; the digest is keccak256 of its unsigned serialization.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/signing-intents.ts#L17)

```ts
export interface TransactionSigningIntent {
    kind: 'transaction';
    transaction: TransactionSerializable;
}
```

Fields:

- **` kind `**: Intent kind.
- **` transaction `**: The transaction; it must name its `chainId`.

### TypedDataSigningIntent

EIP-712 typed data; the digest is its EIP-712 hash.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/signing-intents.ts#L25)

```ts
export interface TypedDataSigningIntent {
    kind: 'typed-data';
    typedData: TypedDataDefinition;
}
```

Fields:

- **` kind `**: Intent kind.
- **` typedData `**: The typed data; its domain must name a `chainId`.

### VerifyCredentialOptions

Optional issuer, holder, type and subject pins applied during credential verification.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/identity.ts#L170)

```ts
export interface VerifyCredentialOptions {
    issuer?: string | Pick<TasraIdentity, 'did'>;
    holder?: Pick<TasraIdentity, 'did'>;
    type?: string;
    subject?: string;
    nowSecs?: number;
}
```

Fields:

- **` issuer `**: Require this exact issuer DID when supplied.
- **` holder `**: Require this holder DID to match the credential key binding.
- **` type `**: Require this exact credential type.
- **` subject `**: Require this exact subject claim.
- **` nowSecs `**: Verification time in Unix seconds; defaults to the current clock.

### WalletTransactionInput

Recipient, native-token value and optional calldata, gas limit and nonce.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/wallet.ts#L16)

```ts
export interface WalletTransactionInput {
    to: Address;
    value?: bigint;
    data?: Hex;
    gas?: bigint;
    nonce?: number;
}
```

Fields:

- **` to `**: Destination EVM address.
- **` value `**: Native-token value in base units; defaults to zero.
- **` data `**: Hex-encoded contract calldata; omitted for a plain transfer.
- **` gas `**: Optional transaction gas limit.
- **` nonce `**: Explicit transaction nonce when supplied.

### WalletTransactionJournal

Private durable evidence; signed bytes permit explicit recovery without creating a new transaction.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/wallet.ts#L39)

```ts
export interface WalletTransactionJournal {
    schemaVersion: 1;
    chainId: number;
    from: Address;
    request: WalletTransactionInput;
    phase: 'signed' | 'submitting' | 'submitted' | 'confirmed';
    hash?: Hex;
    signedTransaction?: Hex;
    receipt?: TransactionReceipt;
}
```

Fields:

- **` schemaVersion `**: Wallet journal schema version.
- **` chainId `**: Chain to which the signed or submitted transaction is bound.
- **` from `**: Signing account address.
- **` request `**: Original recipient, amount and transaction overrides.
- **` phase `**: Last persisted transaction-submission or confirmation stage.
- **` hash `**: Transaction hash, when known.
- **` signedTransaction `**: Private signed bytes available for explicit transaction recovery.
- **` receipt `**: Observed chain receipt after confirmation.

## Constants and ABI values

Shared values and contract definitions.

| Export | Description | Definition |
|---|---|---|
| `SESSION_REFUSAL_CODES` | Refresh refusals no retry of the same session can pass (keykeeper-verifier `session_grant.rs`, relayed by the verifier-agent): the session ends and the application presents again. `session_context_changed`: the verifiers' live draw no longer admits the grant's epoch or seed (the beacon left the grant's window, or the draw changed); `session_continuation`: the session cannot cross an epoch; `session_unknown`: no agent session holds this grant; `session_wrong_key`, `session_key_not_bound`, `session_mismatch`, `session_invalid_request`, `session_lifetime`: this session's own refresh is malformed or bound elsewhere, every retry the same. Everything else (`session_rate_limited`, `session_quorum_unmet`, `session_unavailable`, `session_status_window`, untyped answers) is transient: the held grant still serves and the refresh is retried, backing off.  One exception: `session_context_changed` is also what a verifier answers when ITS beacon read lags the chain (the grant's epoch ahead of its live epoch) or the continuation epoch's seed is not anchored at it yet (keykeeper-verifier `validate_beacon_draw`), and the agent relays one such signer's code as final. With a `beacon` reader, the session ends on it only when the client's own chain read confirms the grant two epochs behind, or the refusal persists past `contextRetryMs`; until then it is retried as transient (the held grant still serves). | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-grants.ts#L317) |
| `SESSION_RETRYABLE_CODES` | Session-route refusals the SAME request may pass later (verifier `session_grant.rs`, C24): the held grant still serves and the refresh is retried, never below the answer's `Retry-After`. `session_verifier_behind` (503, NEW): a verifier's chain view trails the grant (its live beacon is older than the grant's epoch, or that epoch's seed is not anchored at its head yet); it passes once the verifier catches up, with no new presentation. Before C24 a verifier answered that as `session_context_changed`, which an up-to-date server now sends only for a definite change (it stays in ` SESSION_REFUSAL_CODES `, with the chain-confirmed exception for older servers). `session_rate_limited` (429), `session_unavailable`, `session_quorum_unmet` (503, the agent's mixed or older answers) and `session_status_window` are transient as before; any other non-refusal answer stays transient too. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-grants.ts#L333) |
| `SESSION_VERIFIER_BEHIND_RETRY_MS` | The pause before retrying a `session_verifier_behind` refusal that carries no `Retry-After` (the verifier sends 2 s and a current verifier-agent sets or relays it; an older agent relays the code without the header), ms. A Retry-After that is present always wins. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/session-grants.ts#L341) |
| `SIGNING_INTENT_MAX_BYTES` | Largest serialized transaction, typed-data document or message an intent may carry, in bytes. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/signing-intents.ts#L14) |
| `SLOT_POLICY_DOMAIN_NAME` | EIP-712 domain name of a slot policy statement (version `1`, the KeyRegistry as verifying contract). | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/policy-bootstrap.ts#L27) |
| `SLOT_POLICY_MAX_LIFETIME_SECS` | Longest lifetime of one slot policy statement, in seconds (one day). | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/policy-bootstrap.ts#L31) |
| `SLOT_POLICY_REQUEST_DOMAIN_NAME` | EIP-712 domain name of a holder application's policy retrieval request. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/policy-bootstrap.ts#L29) |
| `SLOT_POLICY_REQUEST_MAX_AGE_SECS` | Longest age of a policy retrieval request, in seconds. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/policy-bootstrap.ts#L33) |
