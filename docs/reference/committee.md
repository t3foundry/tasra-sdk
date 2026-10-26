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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/client.ts#L78)

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

- ` readonly retryAfterMs?: number; ` — Service-requested wait from `Retry-After`, in ms, when one was sent.

- ` readonly retryable: boolean; ` — `false` when retrying the identical request cannot succeed.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

### OperationOutcomeUnknownError

A signing request may have been accepted despite a transport or response failure. Reconcile before resubmitting.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/dual-sign.ts#L17)

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
<summary>Browse 82 functions</summary>

- [acceptStatusRefreshRelay](#acceptstatusrefreshrelay)
- [approveExecutionRequest](#approveexecutionrequest)
- [assembleCompoundToken](#assemblecompoundtoken)
- [assertPaymentIntentWire](#assertpaymentintentwire)
- [assertStatusAttestationsWire](#assertstatusattestationswire)
- [auditOperationId](#auditoperationid)
- [buildVerifierProofs](#buildverifierproofs)
- [classifyStatusRefreshResponse](#classifystatusrefreshresponse)
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
- [createExecutionCertificate](#createexecutioncertificate)
- [createExecutionRecoveryAuthorization](#createexecutionrecoveryauthorization)
- [createLocalExecutionSigner](#createlocalexecutionsigner)
- [createStatusRefreshProof](#createstatusrefreshproof)
- [decodeCompoundToken](#decodecompoundtoken)
- [decodeOperationReceipt](#decodeoperationreceipt)
- [decryptIdentityStrict](#decryptidentitystrict)
- [dpopHtu](#dpophtu)
- [dualSignApprovalPayload](#dualsignapprovalpayload)
- [evidenceBindingMessage](#evidencebindingmessage)
- [executionApprovalTypedData](#executionapprovaltypeddata)
- [executionBodyHash](#executionbodyhash)
- [executionCertificateTypedData](#executioncertificatetypeddata)
- [executionConsentBinding](#executionconsentbinding)
- [executionInitializationTypedData](#executioninitializationtypeddata)
- [executionRecoverySigningHash](#executionrecoverysigninghash)
- [extractIdentityStrict](#extractidentitystrict)
- [gatherCommitteeToken](#gathercommitteetoken)
- [holderProofPerVerifier](#holderproofperverifier)
- [ibeDecryptRequest](#ibedecryptrequest)
- [ibeExtractRequest](#ibeextractrequest)
- [initializeExecutionSession](#initializeexecutionsession)
- [isValidSessionId](#isvalidsessionid)
- [keeperAssignmentCommitment](#keeperassignmentcommitment)
- [legacyDpopHtu](#legacydpophtu)
- [merkleProof](#merkleproof)
- [merkleRoot](#merkleroot)
- [normalizeOrigin](#normalizeorigin)
- [opAttestationHash](#opattestationhash)
- [paidDualSignApprovalPayload](#paiddualsignapprovalpayload)
- [paidExecutionReportSigningHash](#paidexecutionreportsigninghash)
- [paidExecutionRequest](#paidexecutionrequest)
- [parseStatusRefreshReply](#parsestatusrefreshreply)
- [paymentIntentHash](#paymentintenthash)
- [paymentIntentTypedData](#paymentintenttypeddata)
- [paymentSessionCommitment](#paymentsessioncommitment)
- [platformAudience](#platformaudience)
- [prepaidRequestId](#prepaidrequestid)
- [refreshStatusDirect](#refreshstatusdirect)
- [refreshStatusViaAgent](#refreshstatusviaagent)
- [requestCommitteeToken](#requestcommitteetoken)
- [requestIbeExtractionPartials](#requestibeextractionpartials)
- [requireStatusAttestations](#requirestatusattestations)
- [selectVerifierCommittee](#selectverifiercommittee)
- [signersThatVerify](#signersthatverify)
- [statusAttestationHash](#statusattestationhash)
- [statusRefreshHash](#statusrefreshhash)
- [statusRefreshHolderSigner](#statusrefreshholdersigner)
- [statusRefreshRelayBody](#statusrefreshrelaybody)
- [statusRefreshRequestBody](#statusrefreshrequestbody)
- [verifierLeaf](#verifierleaf)
- [verifyCompoundToken](#verifycompoundtoken)
- [verifyEvidenceBinding](#verifyevidencebinding)
- [verifyExecutionAuthorization](#verifyexecutionauthorization)
- [verifyExecutionConsent](#verifyexecutionconsent)
- [verifyMerkleProof](#verifymerkleproof)
- [verifyOperationReceipt](#verifyoperationreceipt)
- [verifyPaidExecutionEvidence](#verifypaidexecutionevidence)
- [verifyRecoveredExecutionResult](#verifyrecoveredexecutionresult)
- [verifySessionInitialization](#verifysessioninitialization)
- [verifyStatusAttestation](#verifystatusattestation)
- [verifyStatusAttestations](#verifystatusattestations)
- [withdrawsOriginal](#withdrawsoriginal)

</details>

### acceptStatusRefreshRelay

Verify a verifier-agent relay answer (`POST /v1/sessions/:id/status-refresh`). A 200 body must
be exactly `{token_hash, status_attestations}`; each attestation is re-verified here under the
original roster (the agent is not trusted). A non-200 answer becomes a typed
` StatusRefreshError `, with the relay's per-index `reasons` when it sent them.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/status-refresh.ts#L655)

Import: `import {acceptStatusRefreshRelay} from 'tasra-sdk/committee'`

```ts
declare function acceptStatusRefreshRelay(grant: StatusRefreshGrant, response: StatusRefreshHttpResponse): StatusRefreshResult;
```

| Parameter | Type | Description |
|---|---|---|
| ` grant ` | ` StatusRefreshGrant ` | - Grant, original roster, quorum and caps. |
| ` response ` | ` StatusRefreshHttpResponse ` | - The relay's bounded HTTP answer. |

Returns: ` StatusRefreshResult `.

### approveExecutionRequest

Approve a complete proposal ONLY after comparing it with a separately client-built body.
Applications must construct expected.body from their own intent and validated presentation,
never echo an agent's proposal into that field. This helper performs no automatic HTTP dispatch.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/execution.ts#L389)

Import: `import {approveExecutionRequest} from 'tasra-sdk/committee'`

```ts
declare function approveExecutionRequest(options: {
    payment: PaymentIntentWire;
    certificate: ExecutionCertificate;
    signer: ClientExecutionSigner;
    policy: ExecutionConsentPolicy;
    expected: ExpectedExecution;
    proposal: ExecutionProposal;
}): Promise<ExecutionAuthorization>;
```

| Parameter | Type | Description |
|---|---|---|
| ` options ` | See detailed type below. | Original consent, certified local signer, independent expected body and untrusted proposal. |

**` options ` type**

```ts
{
    payment: PaymentIntentWire;
    certificate: ExecutionCertificate;
    signer: ClientExecutionSigner;
    policy: ExecutionConsentPolicy;
    expected: ExpectedExecution;
    proposal: ExecutionProposal;
}
```

Returns: ` Promise<ExecutionAuthorization> `.

### assembleCompoundToken

Encode a token payload and verifier signatures into the keeper JSON wire format. This does not verify signatures.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L582)

Import: `import {assembleCompoundToken} from 'tasra-sdk/committee'`

```ts
declare function assembleCompoundToken(p: CompoundTokenPayload, signatures: CommitteeSignature[], statusAttestations?: StatusAttestation[]): CompoundTokenWire;
```

| Parameter | Type | Description |
|---|---|---|
| ` p ` | ` CompoundTokenPayload ` | - Compound token payload, excluding signatures. |
| ` signatures ` | ` CommitteeSignature[] ` | - Verifier signatures to include in the wire object. |
| ` statusAttestations? ` | ` StatusAttestation[] ` | - Optional revocation-status attestations, carried beside the signatures and never hashed. Validated strictly; an empty list is omitted. |

Returns: ` CompoundTokenWire `.

### assertPaymentIntentWire

Validate the wire representation and its signed commitment, without chain access.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/payment.ts#L168)

Import: `import {assertPaymentIntentWire} from 'tasra-sdk/committee'`

```ts
declare function assertPaymentIntentWire(value: unknown): asserts value is PaymentIntentWire;
```

| Parameter | Type | Description |
|---|---|---|
| ` value ` | ` unknown ` | - Untrusted payment object; signature encoding is checked, not signer recovery. |

Returns: ` asserts value is PaymentIntentWire `.

### assertStatusAttestationsWire

Strictly validate an untrusted `status_attestations` value: an array of at most
`maxEntries` (and ` MAX_STATUS_ATTESTATIONS `) objects with EXACTLY
`{verifier_index: u32, status_until: safe integer, signature: "0x" + 128 hex}` and distinct
indexes. Returns a fresh copy (the value a keeper receives unchanged).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L876)

Import: `import {assertStatusAttestationsWire} from 'tasra-sdk/committee'`

```ts
declare function assertStatusAttestationsWire(raw: unknown, maxEntries?: number): StatusAttestationWire[];
```

| Parameter | Type | Description |
|---|---|---|
| ` raw ` | ` unknown ` | - Untrusted wire value. |
| ` maxEntries? ` | ` number ` | - Upper bound, normally the token's committee draw length. |

Returns: ` StatusAttestationWire[] `.

### auditOperationId

Deterministic operation ID, matching keykeeper_committee::audit_op_id.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/receipts.ts#L49)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/request.ts#L207)

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

### classifyStatusRefreshResponse

Classify a non-200 refresh answer by its HTTP status and the stable code in its body. A code
that does not belong to the status is ignored; an unclassified answer is `status_refresh_http`.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/status-refresh.ts#L347)

Import: `import {classifyStatusRefreshResponse} from 'tasra-sdk/committee'`

```ts
declare function classifyStatusRefreshResponse(status: number, body: string): StatusRefreshCode;
```

| Parameter | Type | Description |
|---|---|---|
| ` status ` | ` number ` | - HTTP status. |
| ` body ` | ` string ` | - Response body text. |

Returns: ` StatusRefreshCode `.

### clientBindingHash

The 32-byte hash the client (== the credential holder) signs to attest it authorized this
operation on `slotId` under the compound token whose canonical hash is `tokenHash`:
`keccak256(DOMAIN || slotId || tokenHash)`. Byte-identical to the reference `client_binding_hash`, so
the keeper (hot path) and accountant (audit) verify the client signature over the same bytes.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L238)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/client.ts#L245)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/request.ts#L118)

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
Approvals, HTTP and response decoding share a 15-second deadline. A timeout
does not prove that the keeper performed no work and never triggers a retry.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/client.ts#L613)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/request.ts#L404)

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
Approvals, HTTP and response decoding share a 15-second deadline. A timeout
is an uncertain outcome; reconcile the original paid operation before resubmitting.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/client.ts#L526)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/ecdsa.ts#L49)

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
Approvals, HTTP and response decoding have one 15-second deadline. A timeout
requires reconciliation of the original operation, not a new paid attempt.

### committeeSignRequest

One-call committee-authorized threshold sign: resolve token (+proofs) then POST to the keeper.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/request.ts#L361)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L165)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L202)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/dual-sign.ts#L160)

Import: `import {createDualSignClient} from 'tasra-sdk/committee'`

```ts
declare function createDualSignClient(input: DualSignConfig): {
    create(message: Uint8Array, options?: {
        signal?: AbortSignal;
        payment?: PaymentIntentWire;
    }): Promise<DualSignRequest>;
    resume(requestId: string, expectedMessage: Uint8Array, options?: {
        payment?: PaymentIntentWire;
    }): DualSignRequest;
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
        payment?: PaymentIntentWire;
    }): Promise<DualSignRequest>;
    resume(requestId: string, expectedMessage: Uint8Array, options?: {
        payment?: PaymentIntentWire;
    }): DualSignRequest;
}
```

### createExecutionCertificate

Sign and verify a creator certificate without handing a private execution key to the agent.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/execution.ts#L303)

Import: `import {createExecutionCertificate} from 'tasra-sdk/committee'`

```ts
declare function createExecutionCertificate(options: {
    payment: PaymentIntentWire;
    policy: ExecutionConsentPolicy;
    publicKey: Uint8Array;
    expires: number;
    creator: ExecutionCreatorSigner;
}): Promise<ExecutionCertificate>;
```

| Parameter | Type | Description |
|---|---|---|
| ` options ` | ` { payment: PaymentIntentWire; policy: ExecutionConsentPolicy; publicKey: Uint8Array; expires: number; creator: ExecutionCreatorSigner; } ` | Independent consent policy, original payment, public execution key and creator wallet. |

Returns: ` Promise<ExecutionCertificate> `.

### createExecutionRecoveryAuthorization

Ask the original local client for a fresh read signature only after verifying work and financial evidence.
Applications must supply independently authenticated canonical history, not a server-provided policy.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/recovery.ts#L211)

Import: `import {createExecutionRecoveryAuthorization} from 'tasra-sdk/committee'`

```ts
declare function createExecutionRecoveryAuthorization(options: {
    payment: PaymentIntentWire;
    policy: ExecutionConsentPolicy;
    target: ExecutionRecoveryTarget;
    execution: SignedPaidExecutionReport;
    signer: ClientExecutionSigner;
    nowSecs: number;
    nonce?: Hex;
}): Promise<ExecutionRecoveryAuthorization>;
```

| Parameter | Type | Description |
|---|---|---|
| ` options ` | See detailed type below. | Retained payment, independently selected worker/client, historical policy and fresh clock. |

**` options ` type**

```ts
{
    payment: PaymentIntentWire;
    policy: ExecutionConsentPolicy;
    target: ExecutionRecoveryTarget;
    execution: SignedPaidExecutionReport;
    signer: ClientExecutionSigner;
    nowSecs: number;
    nonce?: Hex;
}
```

Returns: ` Promise<ExecutionRecoveryAuthorization> `.

### createLocalExecutionSigner

Create a disposable client-only Ed25519 execution signer. The seed is copied or generated
with Web Crypto, retained only locally and erased by dispose; caller copies remain its responsibility.
The copy never shares memory with the caller's bytes (a Node `Buffer` or any view of a larger
buffer included), so the caller may wipe its seed at once and dispose never touches it.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/execution.ts#L483)

Import: `import {createLocalExecutionSigner} from 'tasra-sdk/committee'`

```ts
declare function createLocalExecutionSigner(seed?: Uint8Array): LocalExecutionSigner;
```

| Parameter | Type | Description |
|---|---|---|
| ` seed? ` | ` Uint8Array ` | Optional local 32-byte seed, for private persistence or deterministic tests. |

Returns: ` LocalExecutionSigner `.

### createStatusRefreshProof

Sign one refresh proof. `client_execution` signs the hash with the execution key
(`0x`-hex Ed25519); `holder_key` signs a compact JWS (`typ: keykeeper-status-refresh+jwt`,
header `jwk`, payload `{"refresh":"0x<hash>"}`).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/status-refresh.ts#L223)

Import: `import {createStatusRefreshProof} from 'tasra-sdk/committee'`

```ts
declare function createStatusRefreshProof(opts: CreateStatusRefreshProofOptions): Promise<StatusRefreshProofWire>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` CreateStatusRefreshProofOptions ` | - Chain, token hash, original payment hash, seq, issue time and prover. |

Returns: ` Promise<StatusRefreshProofWire> `.

### decodeCompoundToken

Decode a wire compound token into the byte-level payload + signatures for verification.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L617)

Import: `import {decodeCompoundToken} from 'tasra-sdk/committee'`

```ts
declare function decodeCompoundToken(w: CompoundTokenWire): CompoundTokenPayload & {
    signatures: CommitteeSignature[];
    statusAttestations?: StatusAttestation[];
};
```

| Parameter | Type | Description |
|---|---|---|
| ` w ` | ` CompoundTokenWire ` | - Keeper JSON token representation to decode into byte fields. |

Returns:

```ts
CompoundTokenPayload & {
    signatures: CommitteeSignature[];
    statusAttestations?: StatusAttestation[];
}
```

### decodeOperationReceipt

Decode the optional receipt tuple. Incomplete tuples are protocol errors.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/receipts.ts#L32)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/extraction.ts#L144)

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

The `htu` (RFC 9449 §4.2) a DPoP proof for an OAuth response must carry:
`{origin}/v1/sessions/{sessionId}/oauth-response` — the exact POST target the proof is
presented at. A session ID is one ASCII path segment; separators and encoded path
characters are refused.

Per session, because RFC 9449 §4.3 checks `htu` against the request URI and a conformant
client library derives it from the URL it calls. The ORIGIN is still the agent origin the
verifiers approved, so a client posting to a different base URL (an internal hostname, a
proxy) must still sign over the value the agent returned, not over the URL it called.

Throws a non-retryable `TasraError` on a session id that is not one plain path segment,
exactly as the verifiers refuse one.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/oauth.ts#L97)

Import: `import {dpopHtu} from 'tasra-sdk/committee'`

```ts
declare function dpopHtu(origin: string, sessionId: string): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` origin ` | ` string ` | - Verifier-agent public origin the verifiers approved. |
| ` sessionId ` | ` string ` | - Original session identifier, 1 to 128 ASCII letters, digits, underscores or hyphens. |

Returns: ` string `.

### dualSignApprovalPayload

Exact existing Rust canonical_dual_sig_payload, including little-endian lengths.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/dual-sign.ts#L38)

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

### evidenceBindingMessage

`keccak256(DOMAIN ‖ tokenHash ‖ evidenceHash ‖ evidenceKeyId)` — the message each drawn
verifier signs beside its token signature. Byte-identical to the Rust
`keykeeper_committee::evidence_binding_message`. The SDK's own sealed-evidence path
(`./evidence.ts`) signs and verifies over this same function.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L499)

Import: `import {evidenceBindingMessage} from 'tasra-sdk/committee'`

```ts
declare function evidenceBindingMessage(tokenHash: Uint8Array, evidenceHash: Uint8Array, evidenceKeyId: Uint8Array): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` tokenHash ` | ` Uint8Array ` | - 32-byte compound-token signing hash. |
| ` evidenceHash ` | ` Uint8Array ` | - 32-byte keccak256 of the sealed evidence ciphertext. |
| ` evidenceKeyId ` | ` Uint8Array ` | - 32-byte keccak256 of the accountant evidence key it is sealed to. |

Returns: ` Uint8Array `.

### executionApprovalTypedData

Reconstruct the complete stage typed data; callers never sign an agent's opaque hash.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/execution.ts#L214)

Import: `import {executionApprovalTypedData} from 'tasra-sdk/committee'`

```ts
declare function executionApprovalTypedData(payment: PaymentIntentWire, approval: Omit<ExecutionAuthorization, 'signature'>): {
    domain: {
        name: string;
        version: string;
        chainId: number;
        verifyingContract: `0x${string}`;
    };
    primaryType: "ClientStageApproval";
    types: {
        readonly ClientStageApproval: readonly [
            {
                readonly name: "chainId";
                readonly type: "uint256";
            },
            {
                readonly name: "settlement";
                readonly type: "address";
            },
            {
                readonly name: "keyRegistry";
                readonly type: "address";
            },
            {
                readonly name: "slotId";
                readonly type: "bytes32";
            },
            {
                readonly name: "paymentHash";
                readonly type: "bytes32";
            },
            {
                readonly name: "requestId";
                readonly type: "bytes32";
            },
            {
                readonly name: "sessionCommitment";
                readonly type: "bytes32";
            },
            {
                readonly name: "certificateHash";
                readonly type: "bytes32";
            },
            {
                readonly name: "stage";
                readonly type: "uint8";
            },
            {
                readonly name: "operatorKey";
                readonly type: "bytes32";
            },
            {
                readonly name: "action";
                readonly type: "uint8";
            },
            {
                readonly name: "payloadDigest";
                readonly type: "bytes32";
            },
            {
                readonly name: "bodyHash";
                readonly type: "bytes32";
            },
            {
                readonly name: "expires";
                readonly type: "uint64";
            }
        ];
    };
    message: {
        certificateHash: `0x${string}`;
        stage: number;
        operatorKey: `0x${string}`;
        action: 0 | 1 | 2 | 6 | 3;
        payloadDigest: `0x${string}`;
        bodyHash: `0x${string}`;
        expires: bigint;
        chainId: bigint;
        settlement: `0x${string}`;
        keyRegistry: `0x${string}`;
        slotId: `0x${string}`;
        paymentHash: `0x${string}`;
        requestId: `0x${string}`;
        sessionCommitment: `0x${string}`;
    };
};
```

| Parameter | Type | Description |
|---|---|---|
| ` payment ` | ` PaymentIntentWire ` | Original independently retained payment. |
| ` approval ` | ` Omit<ExecutionAuthorization, 'signature'> ` | Stage, target and locally recomputed body commitment. |

Returns:

```ts
{
    domain: {
        name: string;
        version: string;
        chainId: number;
        verifyingContract: `0x${string}`;
    };
    primaryType: "ClientStageApproval";
    types: {
        readonly ClientStageApproval: readonly [
            {
                readonly name: "chainId";
                readonly type: "uint256";
            },
            {
                readonly name: "settlement";
                readonly type: "address";
            },
            {
                readonly name: "keyRegistry";
                readonly type: "address";
            },
            {
                readonly name: "slotId";
                readonly type: "bytes32";
            },
            {
                readonly name: "paymentHash";
                readonly type: "bytes32";
            },
            {
                readonly name: "requestId";
                readonly type: "bytes32";
            },
            {
                readonly name: "sessionCommitment";
                readonly type: "bytes32";
            },
            {
                readonly name: "certificateHash";
                readonly type: "bytes32";
            },
            {
                readonly name: "stage";
                readonly type: "uint8";
            },
            {
                readonly name: "operatorKey";
                readonly type: "bytes32";
            },
            {
                readonly name: "action";
                readonly type: "uint8";
            },
            {
                readonly name: "payloadDigest";
                readonly type: "bytes32";
            },
            {
                readonly name: "bodyHash";
                readonly type: "bytes32";
            },
            {
                readonly name: "expires";
                readonly type: "uint64";
            }
        ];
    };
    message: {
        certificateHash: `0x${string}`;
        stage: number;
        operatorKey: `0x${string}`;
        action: 0 | 1 | 2 | 6 | 3;
        payloadDigest: `0x${string}`;
        bodyHash: `0x${string}`;
        expires: bigint;
        chainId: bigint;
        settlement: `0x${string}`;
        keyRegistry: `0x${string}`;
        slotId: `0x${string}`;
        paymentHash: `0x${string}`;
        requestId: `0x${string}`;
        sessionCommitment: `0x${string}`;
    };
}
```

### executionBodyHash

Hash the complete unsigned body with the existing RFC8785 encoder and Rust bounds.
Explicit null and absent fields remain distinct; no operation field is dropped.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/execution.ts#L266)

Import: `import {executionBodyHash} from 'tasra-sdk/committee'`

```ts
declare function executionBodyHash(body: Record<string, unknown>): Hex;
```

| Parameter | Type | Description |
|---|---|---|
| ` body ` | ` Record<string, unknown> ` | Complete unsigned JSON object, excluding only its approval envelope. |

Returns: ` Hex `.

### executionCertificateTypedData

Reconstruct the creator certificate typed data from the original payment.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/execution.ts#L193)

Import: `import {executionCertificateTypedData} from 'tasra-sdk/committee'`

```ts
declare function executionCertificateTypedData(payment: PaymentIntentWire, certificate: Pick<ExecutionCertificate, 'execution_key' | 'expires'>): {
    domain: {
        name: string;
        version: string;
        chainId: number;
        verifyingContract: `0x${string}`;
    };
    primaryType: "ClientExecutionCertificate";
    types: {
        readonly ClientExecutionCertificate: readonly [
            {
                readonly name: "chainId";
                readonly type: "uint256";
            },
            {
                readonly name: "settlement";
                readonly type: "address";
            },
            {
                readonly name: "keyRegistry";
                readonly type: "address";
            },
            {
                readonly name: "slotId";
                readonly type: "bytes32";
            },
            {
                readonly name: "paymentHash";
                readonly type: "bytes32";
            },
            {
                readonly name: "requestId";
                readonly type: "bytes32";
            },
            {
                readonly name: "sessionCommitment";
                readonly type: "bytes32";
            },
            {
                readonly name: "executionKey";
                readonly type: "bytes32";
            },
            {
                readonly name: "expires";
                readonly type: "uint64";
            }
        ];
    };
    message: {
        executionKey: `0x${string}`;
        expires: bigint;
        chainId: bigint;
        settlement: `0x${string}`;
        keyRegistry: `0x${string}`;
        slotId: `0x${string}`;
        paymentHash: `0x${string}`;
        requestId: `0x${string}`;
        sessionCommitment: `0x${string}`;
    };
};
```

| Parameter | Type | Description |
|---|---|---|
| ` payment ` | ` PaymentIntentWire ` | Locally retained payment; signing this data does not reserve or spend funds. |
| ` certificate ` | ` Pick<ExecutionCertificate, 'execution_key' \| 'expires'> ` | Public execution key and expiry to certify. |

Returns:

```ts
{
    domain: {
        name: string;
        version: string;
        chainId: number;
        verifyingContract: `0x${string}`;
    };
    primaryType: "ClientExecutionCertificate";
    types: {
        readonly ClientExecutionCertificate: readonly [
            {
                readonly name: "chainId";
                readonly type: "uint256";
            },
            {
                readonly name: "settlement";
                readonly type: "address";
            },
            {
                readonly name: "keyRegistry";
                readonly type: "address";
            },
            {
                readonly name: "slotId";
                readonly type: "bytes32";
            },
            {
                readonly name: "paymentHash";
                readonly type: "bytes32";
            },
            {
                readonly name: "requestId";
                readonly type: "bytes32";
            },
            {
                readonly name: "sessionCommitment";
                readonly type: "bytes32";
            },
            {
                readonly name: "executionKey";
                readonly type: "bytes32";
            },
            {
                readonly name: "expires";
                readonly type: "uint64";
            }
        ];
    };
    message: {
        executionKey: `0x${string}`;
        expires: bigint;
        chainId: bigint;
        settlement: `0x${string}`;
        keyRegistry: `0x${string}`;
        slotId: `0x${string}`;
        paymentHash: `0x${string}`;
        requestId: `0x${string}`;
        sessionCommitment: `0x${string}`;
    };
}
```

### executionConsentBinding

Reconstruct the durable binding shared with the worker and accountant journals.
This is a commitment helper, not permission to execute or evidence of correct computation.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/execution.ts#L341)

Import: `import {executionConsentBinding} from 'tasra-sdk/committee'`

```ts
declare function executionConsentBinding(payment: PaymentIntentWire, consent: ExecutionConsent, reservationBlock: Hex): Hex;
```

| Parameter | Type | Description |
|---|---|---|
| ` payment ` | ` PaymentIntentWire ` | Original locally retained payment. |
| ` consent ` | ` ExecutionConsent ` | Public original consent; never includes the private request preimage. |
| ` reservationBlock ` | ` Hex ` | Canonical block hash at the worker's original admission. |

Returns: ` Hex `.

### executionInitializationTypedData

Reconstruct session initialization typed data from the original payment and client-built commitments.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/execution.ts#L416)

Import: `import {executionInitializationTypedData} from 'tasra-sdk/committee'`

```ts
declare function executionInitializationTypedData(payment: PaymentIntentWire, initialization: Omit<SessionInitialization, 'signature'>): {
    domain: {
        name: string;
        version: string;
        chainId: number;
        verifyingContract: `0x${string}`;
    };
    primaryType: "ClientSessionInitialization";
    types: {
        readonly ClientSessionInitialization: readonly [
            {
                readonly name: "chainId";
                readonly type: "uint256";
            },
            {
                readonly name: "settlement";
                readonly type: "address";
            },
            {
                readonly name: "keyRegistry";
                readonly type: "address";
            },
            {
                readonly name: "slotId";
                readonly type: "bytes32";
            },
            {
                readonly name: "paymentHash";
                readonly type: "bytes32";
            },
            {
                readonly name: "requestId";
                readonly type: "bytes32";
            },
            {
                readonly name: "sessionCommitment";
                readonly type: "bytes32";
            },
            {
                readonly name: "certificateHash";
                readonly type: "bytes32";
            },
            {
                readonly name: "profileHash";
                readonly type: "bytes32";
            },
            {
                readonly name: "bodyHash";
                readonly type: "bytes32";
            },
            {
                readonly name: "expires";
                readonly type: "uint64";
            }
        ];
    };
    message: {
        certificateHash: `0x${string}`;
        profileHash: `0x${string}`;
        bodyHash: `0x${string}`;
        expires: bigint;
        chainId: bigint;
        settlement: `0x${string}`;
        keyRegistry: `0x${string}`;
        slotId: `0x${string}`;
        paymentHash: `0x${string}`;
        requestId: `0x${string}`;
        sessionCommitment: `0x${string}`;
    };
};
```

| Parameter | Type | Description |
|---|---|---|
| ` payment ` | ` PaymentIntentWire ` | Original locally retained creator payment. |
| ` initialization ` | ` Omit<SessionInitialization, 'signature'> ` | Certificate, approved profile hash, complete create-body hash and expiry. |

Returns:

```ts
{
    domain: {
        name: string;
        version: string;
        chainId: number;
        verifyingContract: `0x${string}`;
    };
    primaryType: "ClientSessionInitialization";
    types: {
        readonly ClientSessionInitialization: readonly [
            {
                readonly name: "chainId";
                readonly type: "uint256";
            },
            {
                readonly name: "settlement";
                readonly type: "address";
            },
            {
                readonly name: "keyRegistry";
                readonly type: "address";
            },
            {
                readonly name: "slotId";
                readonly type: "bytes32";
            },
            {
                readonly name: "paymentHash";
                readonly type: "bytes32";
            },
            {
                readonly name: "requestId";
                readonly type: "bytes32";
            },
            {
                readonly name: "sessionCommitment";
                readonly type: "bytes32";
            },
            {
                readonly name: "certificateHash";
                readonly type: "bytes32";
            },
            {
                readonly name: "profileHash";
                readonly type: "bytes32";
            },
            {
                readonly name: "bodyHash";
                readonly type: "bytes32";
            },
            {
                readonly name: "expires";
                readonly type: "uint64";
            }
        ];
    };
    message: {
        certificateHash: `0x${string}`;
        profileHash: `0x${string}`;
        bodyHash: `0x${string}`;
        expires: bigint;
        chainId: bigint;
        settlement: `0x${string}`;
        keyRegistry: `0x${string}`;
        slotId: `0x${string}`;
        paymentHash: `0x${string}`;
        requestId: `0x${string}`;
        sessionCommitment: `0x${string}`;
    };
}
```

### executionRecoverySigningHash

Reconstruct the domain-separated fresh read hash. It cannot authorize another paid operation.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/recovery.ts#L198)

Import: `import {executionRecoverySigningHash} from 'tasra-sdk/committee'`

```ts
declare function executionRecoverySigningHash(payment: PaymentIntentWire, authorization: Omit<ExecutionRecoveryAuthorization, 'signature'>): Hex;
```

| Parameter | Type | Description |
|---|---|---|
| ` payment ` | ` PaymentIntentWire ` | Original payment, including its signed assignment and complete request identity. |
| ` authorization ` | ` Omit<ExecutionRecoveryAuthorization, 'signature'> ` | Exact stage, worker, original binding, clock and client nonce. |

Returns: ` Hex `.

### extractIdentityStrict

Extract using a distinct assigned quorum, one epoch and the chain-anchored group key.
Read slot metadata before calling; this helper deliberately cannot authenticate caller
configuration. Never populate pinned shares from the extraction response itself.
All temporary partials are cleared even on rejection. No master key is reconstructed.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/extraction.ts#L82)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/client.ts#L366)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/request.ts#L56)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/request.ts#L478)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/request.ts#L460)

Import: `import {ibeExtractRequest} from 'tasra-sdk/committee'`

```ts
declare function ibeExtractRequest(opts: IbeExtractRequestOpts): Promise<Uint8Array>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` IbeExtractRequestOpts ` | - Authorization context, keeper endpoints and requested identity. |

Returns: ` Promise<Uint8Array> `.

### initializeExecutionSession

Authorize one client-built creation body, including a locally generated owner bearer.
Retain the body, proof and signer privately until expiry: retrying the identical POST uses
the hash of these typed data as its session ID and cannot replace the original ECDH key.
This function neither reserves funds nor starts or pays an operator.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/execution.ts#L460)

Import: `import {initializeExecutionSession} from 'tasra-sdk/committee'`

```ts
declare function initializeExecutionSession(options: {
    payment: PaymentIntentWire;
    certificate: ExecutionCertificate;
    signer: ClientExecutionSigner;
    policy: ExecutionConsentPolicy;
    expected: ExpectedInitialization;
    expires: number;
}): Promise<SessionInitialization>;
```

| Parameter | Type | Description |
|---|---|---|
| ` options ` | See detailed type below. | Original payment, certified client signer and independently approved create intent. |

**` options ` type**

```ts
{
    payment: PaymentIntentWire;
    certificate: ExecutionCertificate;
    signer: ClientExecutionSigner;
    policy: ExecutionConsentPolicy;
    expected: ExpectedInitialization;
    expires: number;
}
```

Returns: ` Promise<SessionInitialization> `.

### isValidSessionId

Whether `sessionId` is one plain path segment: `[A-Za-z0-9_-]{1,128}`. Mirrors
`keykeeper_committee::oauth::validate_session_id`, which every drawn verifier runs.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/oauth.ts#L37)

Import: `import {isValidSessionId} from 'tasra-sdk/committee'`

```ts
declare function isValidSessionId(sessionId: string): boolean;
```

| Parameter | Type | Description |
|---|---|---|
| ` sessionId ` | ` string ` | - Session id returned by the verifier agent when the session was opened. |

Returns: ` boolean `.

### keeperAssignmentCommitment

Hash a validated assignment using the platform's fixed-width canonical encoding.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/payment.ts#L85)

Import: `import {keeperAssignmentCommitment} from 'tasra-sdk/committee'`

```ts
declare function keeperAssignmentCommitment(a: PaidKeeperAssignment): Hex;
```

| Parameter | Type | Description |
|---|---|---|
| ` a ` | ` PaidKeeperAssignment ` | - Fixed sharing and registered keeper keys from independent discovery. |

Returns: ` Hex `.

### legacyDpopHtu

Pre-remediation proof target for an agent that supplies no session identity.
New paid sessions never accept this target as a fallback.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/oauth.ts#L112)

Import: `import {legacyDpopHtu} from 'tasra-sdk/committee'`

```ts
declare function legacyDpopHtu(origin: string): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` origin ` | ` string ` | - Original platform origin. |

Returns: ` string `.

### merkleProof

The inclusion proof (sibling hashes, leaf to root) for `index` in `leaves`. `null` if `index`
is out of range. Mirrors the reference `merkle_proof`; pairs with [`verifyMerkleProof`].

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L304)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L290)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/oauth.ts#L51)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L216)

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

### paidDualSignApprovalPayload

Paid approval bytes, binding the final keeper reservation independently of each
credential approval's payment. Matches Rust canonical_paid_dual_sig_payload.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/dual-sign.ts#L57)

Import: `import {paidDualSignApprovalPayload} from 'tasra-sdk/committee'`

```ts
declare function paidDualSignApprovalPayload(chainId: number, slotId: string, message: Uint8Array, requestId: string, payment: PaymentIntentWire): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` chainId ` | ` number ` | - Expected deployment chain. |
| ` slotId ` | ` string ` | - Expected slot identifier. |
| ` message ` | ` Uint8Array ` | - Exact message to sign. |
| ` requestId ` | ` string ` | - Native dual-sign request identifier. |
| ` payment ` | ` PaymentIntentWire ` | - Final keeper Sign intent, already reserved independently. |

Returns: ` Uint8Array `.

### paidExecutionReportSigningHash

Reconstruct the Rust worker signing hash for a completed result. This does not verify its signer.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/recovery.ts#L161)

Import: `import {paidExecutionReportSigningHash} from 'tasra-sdk/committee'`

```ts
declare function paidExecutionReportSigningHash(payment: PaymentIntentWire, report: CompletedPaidExecutionReport): Hex;
```

| Parameter | Type | Description |
|---|---|---|
| ` payment ` | ` PaymentIntentWire ` | Original retained creator payment, used to recompute the complete request identity. |
| ` report ` | ` CompletedPaidExecutionReport ` | Untrusted completed report with strict wire shape. |

Returns: ` Hex `.

### paidExecutionRequest

Build a public evidence query identity from the locally retained payment, never a server proposal.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/recovery.ts#L147)

Import: `import {paidExecutionRequest} from 'tasra-sdk/committee'`

```ts
declare function paidExecutionRequest(payment: PaymentIntentWire): PaidExecutionRequest;
```

| Parameter | Type | Description |
|---|---|---|
| ` payment ` | ` PaymentIntentWire ` | Original creator-signed payment. This does not disclose private operation inputs. |

Returns: ` PaidExecutionRequest `.

### parseStatusRefreshReply

Strictly validate an untrusted verifier refresh reply. Throws ` StatusRefreshError `
(`status_refresh_invalid_response`). Validates the SHAPE only; the signature is checked against
the original roster by the refresh functions.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/status-refresh.ts#L295)

Import: `import {parseStatusRefreshReply} from 'tasra-sdk/committee'`

```ts
declare function parseStatusRefreshReply(raw: unknown): StatusRefreshReplyWire;
```

| Parameter | Type | Description |
|---|---|---|
| ` raw ` | ` unknown ` | - Parsed JSON reply. |

Returns: ` StatusRefreshReplyWire `.

### paymentIntentHash

Hash the creator intent. A matching hash is not proof of a mined reservation or a valid creator signature.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/payment.ts#L147)

Import: `import {paymentIntentHash} from 'tasra-sdk/committee'`

```ts
declare function paymentIntentHash(p: Omit<PaymentIntentWire, 'signature'>): Hex;
```

| Parameter | Type | Description |
|---|---|---|
| ` p ` | ` Omit<PaymentIntentWire, 'signature'> ` | - Creator payment intent; a signature is not part of the EIP-712 preimage. |

Returns: ` Hex `.

### paymentIntentTypedData

Build creator EIP-712 data. Validate chain backing, price, expiry and creator independently before spending.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/payment.ts#L120)

Import: `import {paymentIntentTypedData} from 'tasra-sdk/committee'`

```ts
declare function paymentIntentTypedData(p: Omit<PaymentIntentWire, 'signature'>): {
    domain: {
        name: string;
        version: string;
        chainId: number;
        verifyingContract: `0x${string}`;
    };
    primaryType: "SlotAssignedPaymentIntent";
    types: {
        readonly SlotAssignedPaymentIntent: readonly [
            {
                readonly name: "keyRegistry";
                readonly type: "address";
            },
            {
                readonly name: "slotId";
                readonly type: "bytes32";
            },
            {
                readonly name: "action";
                readonly type: "uint8";
            },
            {
                readonly name: "payloadDigest";
                readonly type: "bytes32";
            },
            {
                readonly name: "sessionCommitment";
                readonly type: "bytes32";
            },
            {
                readonly name: "nonce";
                readonly type: "bytes32";
            },
            {
                readonly name: "maxCost";
                readonly type: "uint256";
            },
            {
                readonly name: "expires";
                readonly type: "uint64";
            },
            {
                readonly name: "verificationEpoch";
                readonly type: "uint64";
            },
            {
                readonly name: "verificationSeed";
                readonly type: "bytes32";
            },
            {
                readonly name: "verificationRoot";
                readonly type: "bytes32";
            },
            {
                readonly name: "verificationRegistrySize";
                readonly type: "uint32";
            },
            {
                readonly name: "verificationCommittee";
                readonly type: "uint32";
            },
            {
                readonly name: "verificationQuorum";
                readonly type: "uint32";
            },
            {
                readonly name: "keeperAssignment";
                readonly type: "bytes32";
            }
        ];
    };
    message: {
        keyRegistry: `0x${string}`;
        slotId: `0x${string}`;
        action: 0 | 1 | 2 | 6 | 3;
        payloadDigest: `0x${string}`;
        sessionCommitment: `0x${string}`;
        nonce: `0x${string}`;
        maxCost: bigint;
        expires: bigint;
        verificationEpoch: bigint;
        verificationSeed: `0x${string}`;
        verificationRoot: `0x${string}`;
        verificationRegistrySize: number;
        verificationCommittee: number;
        verificationQuorum: number;
        keeperAssignment: `0x${string}`;
    };
};
```

| Parameter | Type | Description |
|---|---|---|
| ` p ` | ` Omit<PaymentIntentWire, 'signature'> ` | - Creator payment intent before attaching its signature. |

Returns:

```ts
{
    domain: {
        name: string;
        version: string;
        chainId: number;
        verifyingContract: `0x${string}`;
    };
    primaryType: "SlotAssignedPaymentIntent";
    types: {
        readonly SlotAssignedPaymentIntent: readonly [
            {
                readonly name: "keyRegistry";
                readonly type: "address";
            },
            {
                readonly name: "slotId";
                readonly type: "bytes32";
            },
            {
                readonly name: "action";
                readonly type: "uint8";
            },
            {
                readonly name: "payloadDigest";
                readonly type: "bytes32";
            },
            {
                readonly name: "sessionCommitment";
                readonly type: "bytes32";
            },
            {
                readonly name: "nonce";
                readonly type: "bytes32";
            },
            {
                readonly name: "maxCost";
                readonly type: "uint256";
            },
            {
                readonly name: "expires";
                readonly type: "uint64";
            },
            {
                readonly name: "verificationEpoch";
                readonly type: "uint64";
            },
            {
                readonly name: "verificationSeed";
                readonly type: "bytes32";
            },
            {
                readonly name: "verificationRoot";
                readonly type: "bytes32";
            },
            {
                readonly name: "verificationRegistrySize";
                readonly type: "uint32";
            },
            {
                readonly name: "verificationCommittee";
                readonly type: "uint32";
            },
            {
                readonly name: "verificationQuorum";
                readonly type: "uint32";
            },
            {
                readonly name: "keeperAssignment";
                readonly type: "bytes32";
            }
        ];
    };
    message: {
        keyRegistry: `0x${string}`;
        slotId: `0x${string}`;
        action: 0 | 1 | 2 | 6 | 3;
        payloadDigest: `0x${string}`;
        sessionCommitment: `0x${string}`;
        nonce: `0x${string}`;
        maxCost: bigint;
        expires: bigint;
        verificationEpoch: bigint;
        verificationSeed: `0x${string}`;
        verificationRoot: `0x${string}`;
        verificationRegistrySize: number;
        verificationCommittee: number;
        verificationQuorum: number;
        keeperAssignment: `0x${string}`;
    };
}
```

### paymentSessionCommitment

Commit a fixed presentation random and audience before reserving a payment.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/payment.ts#L181)

Import: `import {paymentSessionCommitment} from 'tasra-sdk/committee'`

```ts
declare function paymentSessionCommitment(random: Hex, clientId: string, operationExp: number): Hex;
```

| Parameter | Type | Description |
|---|---|---|
| ` random ` | ` Hex ` | - Fixed 32-byte cryptographic presentation random. |
| ` clientId ` | ` string ` | - Verifier-agent audience used for the presentation. |
| ` operationExp ` | ` number ` | - Original signed operation expiry in Unix seconds. |

Returns: ` Hex `.

### platformAudience

The OAuth audience the tenant registers with its IdP and every rule pins:
`{origin}/authz/{chainId}`.

The chain id is in it so a token minted for a testnet deployment of the same platform
cannot authorize on mainnet.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/oauth.ts#L76)

Import: `import {platformAudience} from 'tasra-sdk/committee'`

```ts
declare function platformAudience(origin: string, chainId: number | bigint): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` origin ` | ` string ` | - Platform origin used to derive the token audience. |
| ` chainId ` | ` number \| bigint ` | - EVM chain identifier for the selected network. |

Returns: ` string `.

### prepaidRequestId

Derive the Settlement reservation identity for this exact payment and operation.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/payment.ts#L155)

Import: `import {prepaidRequestId} from 'tasra-sdk/committee'`

```ts
declare function prepaidRequestId(p: Omit<PaymentIntentWire, 'signature'>): Hex;
```

| Parameter | Type | Description |
|---|---|---|
| ` p ` | ` Omit<PaymentIntentWire, 'signature'> ` | - Fixed creator intent; neither hashing nor an ID proves a mined reservation. |

Returns: ` Hex `.

### refreshStatusDirect

Refresh a grant's status directly at its original signers' verifiers
(`POST /v1/committee/status-refresh`), verify every reply under the original roster, and merge.
Sends the one proof once per original signer; never retries.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/status-refresh.ts#L605)

Import: `import {refreshStatusDirect} from 'tasra-sdk/committee'`

```ts
declare function refreshStatusDirect(opts: RefreshStatusDirectOptions): Promise<StatusRefreshResult>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` RefreshStatusDirectOptions ` | - Grant, roster, quorum, caps, chain, proof and verifier endpoints. |

Returns: ` Promise<StatusRefreshResult> `.

Return details: The merged grant and its new effective deadline.

Throws: StatusRefreshError when fewer than a quorum of fresh, valid, capped attestations arrive.

### refreshStatusViaAgent

Refresh a grant's status through the verifier-agent relay. The agent fans the proof out to the
original signers; its answer is re-verified here exactly as in [refreshStatusDirect](#refreshstatusdirect).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/status-refresh.ts#L717)

Import: `import {refreshStatusViaAgent} from 'tasra-sdk/committee'`

```ts
declare function refreshStatusViaAgent(opts: RefreshStatusViaAgentOptions): Promise<StatusRefreshResult>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` RefreshStatusViaAgentOptions ` | - Grant, roster, quorum, caps, agent session and proof. |

Returns: ` Promise<StatusRefreshResult> `.

Throws: StatusRefreshError on a typed refusal, an unsigned or forged reply, or no fresh quorum.

### requestCommitteeToken

Read the verifier committee draw, request authorization and assemble the quorum token with available membership proofs.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/request.ts#L260)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/client.ts#L787)

Import: `import {requestIbeExtractionPartials} from 'tasra-sdk/committee'`

```ts
declare function requestIbeExtractionPartials(opts: IbeExtractOpts): Promise<IbeExtractionPartial[]>;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` IbeExtractOpts ` | - Compound token, identity, keepers and optional expected epoch. |

Returns: ` Promise<IbeExtractionPartial[]> `.

### requireStatusAttestations

The keeper's status-freshness rule as a REQUIRED client preflight, run before any keeper call:
a missing list throws `revocation_status_missing` (unless `allowMissing`), fewer than `quorum`
fresh counted attestations `revocation_status_stale`, a malformed or forged list
`revocation_status_invalid` - each a ` RevocationStatusPreflightError `.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L854)

Import: `import {requireStatusAttestations} from 'tasra-sdk/committee'`

```ts
declare function requireStatusAttestations(opts: RequireStatusAttestationsOptions): StatusFreshness;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` RequireStatusAttestationsOptions ` | - Token hash, attestations, counted signers, verifier set, quorum, time and opt-out. |

Returns: ` StatusFreshness `.

### selectVerifierCommittee

Deterministically select `count` distinct verifier indexes in `[0, registrySize)` for one
request: `index = keccak256(SELECT_DOMAIN || slotId || epoch(u64 BE) || seed || iter(u64 BE)) mod registrySize`,
skipping a repeat and incrementing `iter`. Identical, identically-ordered to what the
verifier selects and the keeper reconstructs.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L96)

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

### signersThatVerify

The registry indexes whose Ed25519 signature over the token's own canonical hash verifies under
`set` (strict), distinct and drawn. Mirrors the reference `signers_that_verify`: no rule, draw,
lifetime or quorum check - only "which signatures are real", for counting status attestations.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L811)

Import: `import {signersThatVerify} from 'tasra-sdk/committee'`

```ts
declare function signersThatVerify(token: CompoundTokenPayload & {
    signatures: CommitteeSignature[];
}, set: VerifierSet): number[];
```

| Parameter | Type | Description |
|---|---|---|
| ` token ` | ` CompoundTokenPayload & { signatures: CommitteeSignature[]; } ` | - Decoded token (payload + signatures). |
| ` set ` | ` VerifierSet ` | - Anchored verifier keys. |

Returns: ` number[] `.

### statusAttestationHash

The 32-byte digest a drawn verifier signs to attest credential-status freshness for one token:
`keccak256(DOMAIN || tokenHash || verifierIndex(u32 BE) || statusUntil(i64 BE))`.
Byte-identical to the reference `status_attestation_hash`.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L734)

Import: `import {statusAttestationHash} from 'tasra-sdk/committee'`

```ts
declare function statusAttestationHash(tokenHash: Uint8Array, verifierIndex: number, statusUntil: number): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` tokenHash ` | ` Uint8Array ` | - 32-byte compound token hash ([compoundTokenHash](#compoundtokenhash)). |
| ` verifierIndex ` | ` number ` | - Zero-based verifier registry index. |
| ` statusUntil ` | ` number ` | - Unix seconds the verifier vouches until. |

Returns: ` Uint8Array `.

### statusRefreshHash

The 32-byte digest a refresh proof signs:
`keccak256(DOMAIN || chainId(u64 BE) || tokenHash || paymentHash|zero32 || principalKind(u8)
|| seq(u64 BE) || issuedAt(i64 BE))`.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/status-refresh.ts#L130)

Import: `import {statusRefreshHash} from 'tasra-sdk/committee'`

```ts
declare function statusRefreshHash(input: StatusRefreshHashInput): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` input ` | ` StatusRefreshHashInput ` | - Chain, token hash, original payment hash (paid only), principal, seq and issue time. |

Returns: ` Uint8Array `.

### statusRefreshHolderSigner

A [StatusRefreshHolderSigner](#statusrefreshholdersigner-1) over a local holder key (P-256 signs ES256, Ed25519 signs EdDSA).
The returned signer keeps a reference to `holder.privateKey`; the caller owns its lifetime.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/status-refresh.ts#L164)

Import: `import {statusRefreshHolderSigner} from 'tasra-sdk/committee'`

```ts
declare function statusRefreshHolderSigner(holder: HolderKey): StatusRefreshHolderSigner;
```

| Parameter | Type | Description |
|---|---|---|
| ` holder ` | ` HolderKey ` | - Holder key the credential was bound to at issuance. |

Returns: ` StatusRefreshHolderSigner `.

### statusRefreshRelayBody

The relay request body `{proof}` (for a caller-owned transport).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/status-refresh.ts#L741)

Import: `import {statusRefreshRelayBody} from 'tasra-sdk/committee'`

```ts
declare function statusRefreshRelayBody(proof: StatusRefreshProofWire): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` proof ` | ` StatusRefreshProofWire ` | - Refresh proof, validated before it is encoded. |

Returns: ` Uint8Array `.

### statusRefreshRequestBody

The exact verifier request body `{chain_id, token_hash, proof}` (≤ 4096 bytes).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/status-refresh.ts#L268)

Import: `import {statusRefreshRequestBody} from 'tasra-sdk/committee'`

```ts
declare function statusRefreshRequestBody(chainId: number, tokenHash: Uint8Array, proof: StatusRefreshProofWire): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` chainId ` | ` number ` | - Chain ID (a JavaScript safe integer). |
| ` tokenHash ` | ` Uint8Array ` | - 32-byte canonical token hash. |
| ` proof ` | ` StatusRefreshProofWire ` | - Signed proof. |

Returns: ` Uint8Array `.

### verifierLeaf

`keccak256(DOMAIN || index(u32 BE) || operator(20) || keccak256(pubkey))` - matches the on-chain leaf.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L251)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L391)

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

### verifyEvidenceBinding

Mirror of the Rust `verify_evidence_binding`: every signature must come from a DRAWN
verifier in `set` and verify (strict, non-ZIP-215) over [evidenceBindingMessage](#evidencebindingmessage);
distinct signers are counted once and must satisfy `quorum` of the drawn committee.
Throws on any failure; returns the verified indexes.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L534)

Import: `import {verifyEvidenceBinding} from 'tasra-sdk/committee'`

```ts
declare function verifyEvidenceBinding(opts: VerifyEvidenceBindingOptions): number[];
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` VerifyEvidenceBindingOptions ` | - Token and evidence hashes, the signatures, the verifier set, the drawn committee and the quorum. |

Returns: ` number[] `.

### verifyExecutionAuthorization

Verify creator consent, stage/operator/body binding and the strict local client signature.
The caller must independently authenticate the operator assignment and fresh payment backing.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/execution.ts#L320)

Import: `import {verifyExecutionAuthorization} from 'tasra-sdk/committee'`

```ts
declare function verifyExecutionAuthorization(options: {
    payment: PaymentIntentWire;
    policy: ExecutionConsentPolicy;
    expected: ExpectedExecution;
    authorization: ExecutionAuthorization;
}): Promise<void>;
```

| Parameter | Type | Description |
|---|---|---|
| ` options ` | ` { payment: PaymentIntentWire; policy: ExecutionConsentPolicy; expected: ExpectedExecution; authorization: ExecutionAuthorization; } ` | Original payment, independently selected policy/target and untrusted proof. |

Returns: ` Promise<void> `.

### verifyExecutionConsent

Verify public financial consent at its original admission time. The caller must first
authenticate the historical creator, reserved cost, canonical block and operator assignment.
Work admission must continue to use verifyExecutionAuthorization with the complete body.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/execution.ts#L366)

Import: `import {verifyExecutionConsent} from 'tasra-sdk/committee'`

```ts
declare function verifyExecutionConsent(options: {
    payment: PaymentIntentWire;
    policy: ExecutionConsentPolicy;
    consent: ExecutionConsent;
    expected: {
        stage: ExecutionStage;
        operatorKey: Hex;
        reservationBlock: Hex;
        executionBinding: Hex;
    };
}): Promise<void>;
```

| Parameter | Type | Description |
|---|---|---|
| ` options ` | See detailed type below. | Independently established history and worker binding, plus untrusted consent. |

**` options ` type**

```ts
{
    payment: PaymentIntentWire;
    policy: ExecutionConsentPolicy;
    consent: ExecutionConsent;
    expected: {
        stage: ExecutionStage;
        operatorKey: Hex;
        reservationBlock: Hex;
        executionBinding: Hex;
    };
}
```

Returns: ` Promise<void> `.

### verifyMerkleProof

Verify a sorted-pair keccak Merkle inclusion proof (leaf to root).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L266)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/receipts.ts#L75)

Import: `import {verifyOperationReceipt} from 'tasra-sdk/committee'`

```ts
declare function verifyOperationReceipt(receipt: OperationReceipt | undefined, expected: ReceiptExpectation): boolean;
```

| Parameter | Type | Description |
|---|---|---|
| ` receipt ` | ` OperationReceipt \| undefined ` | - Decoded receipt, or undefined if the keeper supplied none. |
| ` expected ` | ` ReceiptExpectation ` | - Trusted operation hashes, chain identifier and keeper public key. |

Returns: ` boolean `.

### verifyPaidExecutionEvidence

Authenticate public recovery evidence against independently established historical financial policy.
The policy time must equal the original accepted time, not the current recovery clock.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/recovery.ts#L176)

Import: `import {verifyPaidExecutionEvidence} from 'tasra-sdk/committee'`

```ts
declare function verifyPaidExecutionEvidence(options: {
    payment: PaymentIntentWire;
    policy: ExecutionConsentPolicy;
    target: ExecutionRecoveryTarget;
    execution: SignedPaidExecutionReport;
}): Promise<void>;
```

| Parameter | Type | Description |
|---|---|---|
| ` options ` | ` { payment: PaymentIntentWire; policy: ExecutionConsentPolicy; target: ExecutionRecoveryTarget; execution: SignedPaidExecutionReport; } ` | Retained payment/client identity, historical creator and fee, expected worker and untrusted evidence. |

Returns: ` Promise<void> `.

### verifyRecoveredExecutionResult

Verify the returned worker evidence and exact result bytes against the previously authenticated report.
Returns the retained JSON string only after its commitment matches; callers decode the operation's
internal result format themselves. It may differ from the original HTTP envelope and audit metadata.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/recovery.ts#L261)

Import: `import {verifyRecoveredExecutionResult} from 'tasra-sdk/committee'`

```ts
declare function verifyRecoveredExecutionResult(options: {
    payment: PaymentIntentWire;
    policy: ExecutionConsentPolicy;
    target: ExecutionRecoveryTarget;
    expectedExecution: SignedPaidExecutionReport;
    reply: RecoveredExecutionReply;
}): Promise<string>;
```

| Parameter | Type | Description |
|---|---|---|
| ` options ` | See detailed type below. | Original identity and history, authenticated expected report, and untrusted response. |

**` options ` type**

```ts
{
    payment: PaymentIntentWire;
    policy: ExecutionConsentPolicy;
    target: ExecutionRecoveryTarget;
    expectedExecution: SignedPaidExecutionReport;
    reply: RecoveredExecutionReply;
}
```

Returns: ` Promise<string> `.

### verifySessionInitialization

Verify fresh client consent before creating or retrying a registered agent session.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/execution.ts#L439)

Import: `import {verifySessionInitialization} from 'tasra-sdk/committee'`

```ts
declare function verifySessionInitialization(options: {
    payment: PaymentIntentWire;
    policy: ExecutionConsentPolicy;
    expected: ExpectedInitialization;
    initialization: SessionInitialization;
}): Promise<void>;
```

| Parameter | Type | Description |
|---|---|---|
| ` options ` | ` { payment: PaymentIntentWire; policy: ExecutionConsentPolicy; expected: ExpectedInitialization; initialization: SessionInitialization; } ` | Independently selected profile/body/policy, original payment and untrusted proof. |

Returns: ` Promise<void> `.

### verifyStatusAttestation

Verify ONE attestation's Ed25519 signature under the verifier's committee key over `tokenHash`
(no freshness, no quorum) - what a relay checks before forwarding it.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L748)

Import: `import {verifyStatusAttestation} from 'tasra-sdk/committee'`

```ts
declare function verifyStatusAttestation(pubkey: Uint8Array, tokenHash: Uint8Array, attestation: StatusAttestation): boolean;
```

| Parameter | Type | Description |
|---|---|---|
| ` pubkey ` | ` Uint8Array ` | - 32-byte Ed25519 committee public key of `attestation.verifierIndex`. |
| ` tokenHash ` | ` Uint8Array ` | - 32-byte compound token hash. |
| ` attestation ` | ` StatusAttestation ` | - Decoded attestation. |

Returns: ` boolean `.

Return details: Whether the signature verifies (strict: non-canonical encodings refused).

### verifyStatusAttestations

Verify a token's status attestations exactly as a keeper does and return the effective status
deadline (the quorum-th largest attested `status_until`). Throws on a duplicate index, an
oversize list, a bad signature from a counted verifier, or fewer than `quorum` attestations
fresh at `now` (`now <= status_until + STATUS_SKEW_SECS`; the token leeway is NOT applied).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L782)

Import: `import {verifyStatusAttestations} from 'tasra-sdk/committee'`

```ts
declare function verifyStatusAttestations(opts: VerifyStatusAttestationsOptions): number;
```

| Parameter | Type | Description |
|---|---|---|
| ` opts ` | ` VerifyStatusAttestationsOptions ` | - Token hash, attestations, counted signers, verifier set, quorum and time. |

Returns: ` number `.

### withdrawsOriginal

Whether a verifier's typed refresh outcome withdraws its ORIGINAL attestation from the merged
result: the verifier, answering for this token, said its status statement does not stand now
(revoked, past a cap, the principal does not verify, its context moved, it cannot read status,
or the proof replays). Transport, unknown or malformed outcomes withdraw nothing.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/status-refresh.ts#L393)

Import: `import {withdrawsOriginal} from 'tasra-sdk/committee'`

```ts
declare function withdrawsOriginal(code: StatusRefreshCode): boolean;
```

| Parameter | Type | Description |
|---|---|---|
| ` code ` | ` StatusRefreshCode ` | - A failure's code. |

Returns: ` boolean `.

## Types

Options, data structures and return types.

<details>
<summary>Browse 78 types</summary>

- [ClientExecutionSigner](#clientexecutionsigner)
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
- [CompletedPaidExecutionReport](#completedpaidexecutionreport)
- [CompoundTokenPayload](#compoundtokenpayload)
- [CompoundTokenWire](#compoundtokenwire)
- [CreateStatusRefreshProofOptions](#createstatusrefreshproofoptions)
- [DualSignApprover](#dualsignapprover)
- [DualSignConfig](#dualsignconfig)
- [DualSignRequest](#dualsignrequest)
- [DualSignStatus](#dualsignstatus)
- [EvidenceBindingWire](#evidencebindingwire)
- [ExecutionAuthorization](#executionauthorization)
- [ExecutionCertificate](#executioncertificate)
- [ExecutionConsent](#executionconsent)
- [ExecutionConsentPolicy](#executionconsentpolicy)
- [ExecutionCreatorSigner](#executioncreatorsigner)
- [ExecutionProposal](#executionproposal)
- [ExecutionRecoveryAuthorization](#executionrecoveryauthorization)
- [ExecutionRecoveryTarget](#executionrecoverytarget)
- [ExecutionStage](#executionstage)
- [ExpectedExecution](#expectedexecution)
- [ExpectedInitialization](#expectedinitialization)
- [ExtractionEvidence](#extractionevidence)
- [ExtractionKeeper](#extractionkeeper)
- [GatherCommitteeTokenOpts](#gathercommitteetokenopts)
- [HolderProofPerVerifier](#holderproofperverifier-1)
- [IbeExtractionPartial](#ibeextractionpartial)
- [IbeExtractOpts](#ibeextractopts)
- [IbeExtractRequestOpts](#ibeextractrequestopts)
- [KeeperExecutionApprovalRequest](#keeperexecutionapprovalrequest)
- [KeeperExecutionApprovals](#keeperexecutionapprovals)
- [KeeperExecutionApprover](#keeperexecutionapprover)
- [KeeperExecutionKind](#keeperexecutionkind)
- [LocalExecutionSigner](#localexecutionsigner)
- [OperationReceipt](#operationreceipt)
- [PaidExecutionRequest](#paidexecutionrequest-1)
- [PaidKeeperAssignment](#paidkeeperassignment)
- [PaymentIntentWire](#paymentintentwire)
- [ReceiptExpectation](#receiptexpectation)
- [RecoveredExecutionReply](#recoveredexecutionreply)
- [RefreshStatusDirectOptions](#refreshstatusdirectoptions)
- [RefreshStatusViaAgentOptions](#refreshstatusviaagentoptions)
- [RequestCommitteeTokenOpts](#requestcommitteetokenopts)
- [RequireStatusAttestationsOptions](#requirestatusattestationsoptions)
- [SessionInitialization](#sessioninitialization)
- [SignedPaidExecutionReport](#signedpaidexecutionreport)
- [StatusAttestation](#statusattestation)
- [StatusAttestationWire](#statusattestationwire)
- [StatusFreshness](#statusfreshness)
- [StatusRefreshGrant](#statusrefreshgrant)
- [StatusRefreshHashInput](#statusrefreshhashinput)
- [StatusRefreshHolderSigner](#statusrefreshholdersigner-1)
- [StatusRefreshHttpResponse](#statusrefreshhttpresponse)
- [StatusRefreshPrincipal](#statusrefreshprincipal)
- [StatusRefreshProofWire](#statusrefreshproofwire)
- [StatusRefreshProver](#statusrefreshprover)
- [StatusRefreshReplyWire](#statusrefreshreplywire)
- [StatusRefreshResult](#statusrefreshresult)
- [StrictExtractionOptions](#strictextractionoptions)
- [StrictExtractionResult](#strictextractionresult)
- [TokenType](#tokentype)
- [VerifiedToken](#verifiedtoken)
- [VerifierProof](#verifierproof)
- [VerifierSet](#verifierset)
- [VerifyCompoundTokenOptions](#verifycompoundtokenoptions)
- [VerifyEvidenceBindingOptions](#verifyevidencebindingoptions)
- [VerifyStatusAttestationsOptions](#verifystatusattestationsoptions)

</details>

### ClientExecutionSigner

Local Ed25519 signing capability; implementations must keep their key on the client.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/execution.ts#L120)

```ts
export interface ClientExecutionSigner {
    publicKey: Uint8Array;
    sign(message: Uint8Array): Promise<Uint8Array>;
}
```

Fields:

- **` publicKey `**: Public key used by the creator certificate.
- **` sign `**: Sign the SDK-reconstructed structured hash; never a hash supplied by an agent.

### CommitteeAuthorizeBody

Credential presentation and request context sent to one verifier for committee authorization.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/client.ts#L89)

```ts
export interface CommitteeAuthorizeBody {
    payment?: PaymentIntentWire;
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

- **` payment `**: Creator intent for the already mined reservation.
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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/client.ts#L146)

```ts
export interface CommitteeAuthorizeReply {
    sealedEvidence?: {
        hash: string;
        keyId: string;
        signature: string;
        ciphertext: string;
    };
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
    paymentHash?: Uint8Array;
    binding: number;
    statusAttestation?: {
        statusUntil: number;
        signature: Uint8Array;
    };
}
```

Fields:

- **` sealedEvidence `**: Complete sealed evidence returned and independently signed by this verifier.
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
- **` paymentHash `**: Payment commitment attested by this verifier.
- **` binding `**: binding strength byte (`bindingFromWire`); `0x00` when the verifier declared none.
- **` statusAttestation `**: This verifier's revocation-status freshness attestation (`status_until` + `status_signature` on the wire), when it sent one. Not authenticated here: [gatherCommitteeToken](#gathercommitteetoken) verifies it under the verifier's committee key before relaying it.

### CommitteeChainReads

The chain reads the committee flow needs. Adapt from the SDK chain client with
[committeeChainReadsFromClient](#committeechainreadsfromclient), or supply raw viem reads.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/request.ts#L99)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/client.ts#L575)

```ts
export interface CommitteeDecryptOpts {
    evidenceCt?: string;
    approveExecution?: KeeperExecutionApprover;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
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
}
```

Fields:

- **` evidenceCt `**: Exact sealed presentation ciphertext returned with this authorization.
- **` approveExecution `**: Required for a paid token: client-only exact-body stage approval capability.
- **` signal `**: Caller cancellation for canonical approval and keeper work.
- **` fetchImpl `**: Caller-approved HTTP implementation.
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

### CommitteeDecryptRequestOpts

Operation-specific fields for [committeeDecryptRequest](#committeedecryptrequest).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/request.ts#L378)

```ts
export interface CommitteeDecryptRequestOpts extends RequestCommitteeTokenOpts {
    approveExecution?: KeeperExecutionApprover;
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

- **` approveExecution `**: Client-owned exact-body approval capability, required when authorization carries payment.
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
- **` scopedIdentity `**: Identity string for an IBE-scoped operation. Verifiers bind its hash into the token and evaluate the credential scope. Omit for group signing and group decryption; ciphertext associated data is a separate field.

### CommitteeEoaSignOpts

Compound authorization, keeper endpoint and digest for threshold ECDSA signing.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/ecdsa.ts#L11)

```ts
export interface CommitteeEoaSignOpts {
    evidenceCt?: string;
    approveExecution?: KeeperExecutionApprover;
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

- **` evidenceCt `**: Exact sealed presentation ciphertext returned with this authorization.
- **` approveExecution `**: Required for a paid token: locally verify and approve the complete keeper body.
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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L321)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L433)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/client.ts#L494)

```ts
export interface CommitteeSignOpts {
    evidenceCt?: string;
    approveExecution?: KeeperExecutionApprover;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    nodeUrl: string;
    committeeToken: CompoundTokenWire;
    message: Uint8Array;
    signingSet?: number[];
    userSignature?: Uint8Array;
    targetKeykeeper?: string;
    verifierProofs?: VerifierProof[];
}
```

Fields:

- **` evidenceCt `**: Exact sealed presentation ciphertext returned with this authorization.
- **` approveExecution `**: Required for a paid token: client-only exact-body stage approval capability.
- **` signal `**: Optional signal that cancels the request.
- **` fetchImpl `**: HTTP transport override; defaults to the global fetch implementation.
- **` nodeUrl `**: Keeper HTTP base URL.
- **` committeeToken `**: Compound token authorizing this operation.
- **` message `**: Raw message bytes to sign.
- **` signingSet `**: Optional threshold participant identifiers for the signing ceremony.
- **` userSignature `**: Optional Ed25519 owner signature over the canonical operation request.
- **` targetKeykeeper `**: Optional 20-byte operator address to pin the intended keeper.
- **` verifierProofs `**: Verifier membership proofs for the selected snapshot.

### CommitteeSignRequestOpts

Operation-specific fields for [committeeSignRequest](#committeesignrequest) (everything `committeeSign` needs
except the token, which this resolves).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/request.ts#L341)

```ts
export interface CommitteeSignRequestOpts extends RequestCommitteeTokenOpts {
    approveExecution?: KeeperExecutionApprover;
    nodeUrl: string;
    message: Uint8Array;
    signingSet?: number[];
    userSignature?: Uint8Array;
    targetKeykeeper?: string;
}
```

Fields:

- **` approveExecution `**: Client-owned exact-body approval capability, required when authorization carries payment.
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
- **` scopedIdentity `**: Identity string for an IBE-scoped operation. Verifiers bind its hash into the token and evaluate the credential scope. Omit for group signing and group decryption; ciphertext associated data is a separate field.

### CommitteeTokenResult

Assembled compound token, committee draw and optional proofs and client signature.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/request.ts#L174)

```ts
export interface CommitteeTokenResult {
    evidenceCt?: string;
    token: CompoundTokenWire;
    committee: number;
    quorum: number;
    registrySize: number;
    seed: Uint8Array;
    epoch: number;
    verifierProofs?: VerifierProof[];
    ruleVersion?: number;
}
```

Fields:

- **` evidenceCt `**: Exact sealed presentation ciphertext returned with the token.
- **` token `**: Compound committee authorization token.
- **` committee `**: Number of verifiers selected for the committee.
- **` quorum `**: Minimum required verifier signatures.
- **` registrySize `**: Number of entries in the verifier registry.
- **` seed `**: Beacon seed used for committee selection.
- **` epoch `**: Beacon epoch used for the verifier committee draw.
- **` verifierProofs `**: Trustless snapshot-inclusion proofs for the token's signers, when derivable; else `undefined` (the keeper then uses its configured verifier set).
- **` ruleVersion `**: Policy version reported by the verifiers, when available. Diagnostic only; the keeper enforces the token rule hash against its current rule.

### CommitteeVerifier

One member of the active verifier set. `operator`+`pubkey` are needed only to build the
trustless snapshot proofs; `index`+`url` alone suffice for the keeper's configured-set path.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/request.ts#L86)

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

### CompletedPaidExecutionReport

Completed durable work report. Recovery deliberately refuses non-success outcomes.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/recovery.ts#L31)

```ts
export interface CompletedPaidExecutionReport {
    request: PaidExecutionRequest;
    operator_key: number[];
    stage: ExecutionStage;
    binding: number[];
    reservation_block: number[];
    cost: number[];
    outcome: {
        succeeded: {
            result_commitment: number[];
        };
    };
}
```

Fields:

- **` request `**: Exact original reserved request.
- **` operator_key `**: Worker identity, matched to independently authenticated assignment.
- **` stage `**: Original paid stage.
- **` binding `**: Original client consent, input and backing binding.
- **` reservation_block `**: Original canonical admission block, not the latest block.
- **` cost `**: Original reserved fee, unsigned big-endian TASRA base units.
- **` outcome `**: Successful result commitment; absence or failure never triggers another execution.

### CompoundTokenPayload

The data the quorum verifiers sign over. All byte fields are 32 bytes unless noted.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L123)

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
    paymentHash?: Uint8Array;
    payment?: PaymentIntentWire;
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
- **` paymentHash `**: Creator payment intent hash; uses a distinct signing domain when present.
- **` payment `**: Optional transport preimage. Must match paymentHash; chain backing is checked separately.
- **` binding `**: How the holder's key possession was proved. `0x00` = Unbound (no proof), `0x01` = HolderKey (KB-JWT nonce verified), `0x02` = IssuerAsserted (reserved). Always present in the canonical bytes; defaults to `0x00` when omitted.
- **` verifierIndexes `**: Indices of the selected verifier committee.
- **` iat `**: Issue time in Unix seconds.
- **` exp `**: Expiration time in Unix seconds.

### CompoundTokenWire

The compound token JSON a client submits with `/v1/committee/{sign,decrypt}`.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L441)

```ts
export interface CompoundTokenWire extends EvidenceBindingWire {
    token_type: TokenType;
    seed: string;
    epoch: number;
    slot_id: string;
    vp_hash: string;
    holder_hash: string;
    rule_hash: string;
    identity_hash?: string;
    request_hash?: string;
    payment_hash?: string;
    payment?: PaymentIntentWire;
    binding?: string;
    verifier_indexes: number[];
    iat: number;
    exp: number;
    signatures: CommitteeSignatureWire[];
    status_attestations?: StatusAttestationWire[];
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
- **` payment_hash `**: Creator payment-intent hash, attested by the verifier quorum.
- **` payment `**: Creator-signed intent carried to keepers for independent reservation checks.
- **` binding `**: `"unbound"` | `"holder_key"` | `"issuer_asserted"`.
- **` verifier_indexes `**: Indices of the selected verifier committee.
- **` iat `**: Issue time in Unix seconds.
- **` exp `**: Expiration time in Unix seconds.
- **` signatures `**: Hexadecimal verifier signatures and their registry indices.
- **` status_attestations `**: Revocation-status freshness attestations (`keykeeper/committee-status-attestation/v1`), one per drawn verifier that vouched. OUTSIDE the signed token bytes: it never moves the token hash. Keepers in production posture require a quorum of fresh ones.
- **` evidence_hash `**: Keccak-256 of the encoded ciphertext bytes.
- **` evidence_key_id `**: Certified accountant evidence-key identifier.
- **` evidence_signatures `**: Verifier signatures binding the token, ciphertext hash and evidence key.

### CreateStatusRefreshProofOptions

Inputs of [createStatusRefreshProof](#createstatusrefreshproof).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/status-refresh.ts#L201)

```ts
export interface CreateStatusRefreshProofOptions {
    chainId: number | bigint;
    tokenHash: Uint8Array;
    paymentHash?: Uint8Array;
    seq: number;
    issuedAt?: number;
    prover: StatusRefreshProver;
}
```

Fields:

- **` chainId `**: Chain ID.
- **` tokenHash `**: 32-byte canonical token hash.
- **` paymentHash `**: ORIGINAL payment hash of a paid grant (omit when unpaid).
- **` seq `**: Journaled sequence number (positive safe integer). Never reuse one.
- **` issuedAt `**: Unix seconds (default now).
- **` prover `**: Principal and signer.

### DualSignApprover

Ed25519 approver public key and callback that signs canonical approval bytes.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/dual-sign.ts#L123)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/dual-sign.ts#L74)

```ts
export interface DualSignConfig {
    approveExecution?: KeeperExecutionApprover;
    payment?: PaymentIntentWire;
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

- **` approveExecution `**: Required for paid creation: original client's complete final-work approvals.
- **` payment `**: Optional pinned final Sign payment for this coordinator; per-call replacements are refused.
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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/dual-sign.ts#L131)

```ts
export interface DualSignRequest {
    readonly payment?: PaymentIntentWire;
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
            evidenceCt?: string;
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

- **` payment `**: Final keeper Sign intent; each access returns a copy. Credential approvals pay separately.
- **` requestId `**: Request identifier used to correlate or resume the operation.
- **` slotId `**: 32-byte slot identifier.
- **` nodeUrl `**: Keeper HTTP base URL.
- **` status `**: Fetch and validate the current request state.
- **` approve `**: Sign and submit one approval, with credential authorization when required.
- **` wait `**: Poll until a verified signature is available or the request fails or times out.

### DualSignStatus

Native signing request progress, verified completed signature or terminal failure.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/dual-sign.ts#L98)

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
} | {
    status: 'uncertain';
};
```

Fields:

- **` status `**: Lifecycle state: pending or signing until the request is signed or fails. Work may have started, but its durable outcome is unavailable. Never retry the ceremony.

### EvidenceBindingWire

Sealed presentation bindings signed beside the unchanged compound-token hash.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/evidence.ts#L9)

```ts
export interface EvidenceBindingWire {
    evidence_hash?: string;
    evidence_key_id?: string;
    evidence_signatures?: {
        verifier_index: number;
        signature: string;
    }[];
}
```

Fields:

- **` evidence_hash `**: Keccak-256 of the encoded ciphertext bytes.
- **` evidence_key_id `**: Certified accountant evidence-key identifier.
- **` evidence_signatures `**: Verifier signatures binding the token, ciphertext hash and evidence key.

### ExecutionAuthorization

Client signature authorizing one exact body, stage and assigned operator.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/execution.ts#L32)

```ts
export interface ExecutionAuthorization {
    certificate: ExecutionCertificate;
    stage: ExecutionStage;
    operator_key: Hex;
    body_hash: Hex;
    expires: number;
    signature: Hex;
}
```

Fields:

- **` certificate `**: Creator-certified public execution key and bounded consent.
- **` stage `**: Paid stage being authorized.
- **` operator_key `**: Independently authenticated operator's Ed25519 public key.
- **` body_hash `**: Locally recomputed complete unsigned body hash.
- **` expires `**: Unix expiry no later than the certificate.
- **` signature `**: Client Ed25519 signature over the structured stage approval hash.

### ExecutionCertificate

Creator certificate for one payment and a client-owned Ed25519 public key.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/execution.ts#L22)

```ts
export interface ExecutionCertificate {
    execution_key: Hex;
    expires: number;
    creator_signature: Hex;
}
```

Fields:

- **` execution_key `**: Public key; never deliver its private seed to the verifier agent.
- **` expires `**: Unix expiry no later than the original creator payment.
- **` creator_signature `**: Creator EIP-712 signature over the certificate.

### ExecutionConsent

Public proof of the original client-approved work, without its private request body.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/execution.ts#L48)

```ts
export interface ExecutionConsent {
    authorization: ExecutionAuthorization;
    inputs_commitment: number[];
    verified_at: number;
}
```

Fields:

- **` authorization `**: Creator certificate and original client signature for this stage.
- **` inputs_commitment `**: Worker commitment to its exact accepted inputs; this is not a computation proof.
- **` verified_at `**: Original admission time, checked against canonical historical backing by the reader.

### ExecutionConsentPolicy

Independently selected deployment, creator and exact reserved payment.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/execution.ts#L80)

```ts
export interface ExecutionConsentPolicy {
    chainId: number;
    settlement: Address;
    keyRegistry: Address;
    creator: Address;
    paymentHash: Hex;
    cost: bigint;
    nowSecs: number;
}
```

Fields:

- **` chainId `**: Approved chain ID.
- **` settlement `**: Approved Settlement proxy.
- **` keyRegistry `**: Approved KeyRegistry proxy.
- **` creator `**: Creator read independently from the intended slot.
- **` paymentHash `**: Exact locally retained payment commitment, never copied from a proposal.
- **` cost `**: Nonzero fee from the canonical quote or mined reservation, in TASRA base units.
- **` nowSecs `**: Fresh clock supplied at the approval boundary; no stale policy cache.

### ExecutionCreatorSigner

Creator wallet capable of signing the separate execution certificate.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/execution.ts#L202)

```ts
export interface ExecutionCreatorSigner {
    address: Address;
    signTypedData(args: ReturnType<typeof executionCertificateTypedData>): Promise<Hex>;
}
```

Fields:

- **` address `**: Must equal the independently read slot creator. Delegation is not spending authority.
- **` signTypedData `**: Sign the SDK-reconstructed creator certificate typed data.

### ExecutionProposal

Untrusted agent proposal. An opaque body hash is deliberately not accepted.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/execution.ts#L108)

```ts
export interface ExecutionProposal {
    stage: ExecutionStage;
    operator_key: Hex;
    unsigned_body: Record<string, unknown>;
    expires: number;
}
```

Fields:

- **` stage `**: Requested stage; compared with the application's own selection.
- **` operator_key `**: Requested key; compared with an independently authenticated key.
- **` unsigned_body `**: Complete unsigned JSON body, with no execution_authorization envelope.
- **` expires `**: Requested bounded Unix expiry.

### ExecutionRecoveryAuthorization

Fresh client authorization to read one exact retained result; grants no work or fee authority.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/recovery.ts#L59)

```ts
export interface ExecutionRecoveryAuthorization {
    stage: ExecutionStage;
    operator_key: Hex;
    execution_binding: Hex;
    issued_at: number;
    nonce: Hex;
    signature: Hex;
}
```

Fields:

- **` stage `**: Independently selected stage.
- **` operator_key `**: Independently authenticated serving worker.
- **` execution_binding `**: Exact original execution binding from authenticated evidence.
- **` issued_at `**: Fresh client clock, within the service's 60-second read window and two-second future skew.
- **` nonce `**: Nonzero client-generated read correlation nonce; repeated reads remain permitted.
- **` signature `**: Original creator-certified client's fresh Ed25519 signature.

### ExecutionRecoveryTarget

Independently selected worker and original client key; never copied from a received report.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/recovery.ts#L75)

```ts
export interface ExecutionRecoveryTarget {
    stage: ExecutionStage;
    operatorKey: Hex;
    executionKey: Hex;
}
```

Fields:

- **` stage `**: Stage whose completed result the application intends to read.
- **` operatorKey `**: Key authenticated from the signed keeper assignment and canonical historical roster.
- **` executionKey `**: Public key retained from the client's original creator certificate.

### ExecutionStage

Stable stage names and ordinals from the shared execution report protocol.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/execution.ts#L18)

```ts
export type ExecutionStage = 'coordinator' | 'contributor' | 'presentation_sign' | 'presentation_attest' | 'credential';
```

### ExpectedExecution

Client-built complete unsigned body and independently selected destination.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/execution.ts#L98)

```ts
export interface ExpectedExecution {
    stage: ExecutionStage;
    operatorKey: Hex;
    body: Record<string, unknown>;
}
```

Fields:

- **` stage `**: Stage the application intends to authorize.
- **` operatorKey `**: Key from authenticated slot assignment or verifier snapshot/draw.
- **` body `**: Complete body reconstructed by the application, including optional field shape.

### ExpectedInitialization

Independent client intent for a registered agent session.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/execution.ts#L72)

```ts
export interface ExpectedInitialization {
    serviceProfile: Record<string, unknown>;
    body: Record<string, unknown>;
}
```

Fields:

- **` serviceProfile `**: Previously authenticated and approved agent profile; never copied from its response.
- **` body `**: Client-built complete create body, excluding execution_initialization.

### ExtractionEvidence

Keeper identity, share identifier and receipt verification status for an accepted extraction share.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/extraction.ts#L49)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/extraction.ts#L11)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/client.ts#L340)

```ts
export interface GatherCommitteeTokenOpts {
    onEvidence?: (ciphertext: string) => void;
    verifiers: Array<{
        index: number;
        url: string;
        pubkey?: string | Uint8Array;
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

- **` onEvidence `**: Required for sealed replies: retain this ciphertext beside the returned token.
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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/request.ts#L46)

```ts
export type HolderProofPerVerifier = (verifier: CommitteeVerifier) => Promise<string> | string;
```

### IbeExtractionPartial

One node's extraction partial, decoded from the wire.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/client.ts#L650)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/client.ts#L668)

```ts
export interface IbeExtractOpts {
    evidenceCt?: string;
    threshold?: number;
    timeoutMs?: number;
    approveExecution?: KeeperExecutionApprover;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    nodeUrls: string[];
    committeeToken: CompoundTokenWire;
    identity: string;
    userSignature?: Uint8Array;
    ciphertextEpoch?: number;
    verifierProofs?: VerifierProof[];
}
```

Fields:

- **` evidenceCt `**: Exact sealed presentation ciphertext returned with this authorization.
- **` threshold `**: Stop after this many distinct, pairing-verified shares. Without this option, collect every successful reply. The low-level check uses returned verifying shares; use extractIdentityStrict for independently pinned keeper provenance.
- **` timeoutMs `**: Deadline for the complete fan-out, including approvals and response bodies. Default 10000 ms. Cancellation cannot undo work a keeper already started.
- **` approveExecution `**: Required for paid extraction: approve only the exact targeted assigned contributor.
- **` signal `**: Optional signal that cancels the request.
- **` fetchImpl `**: HTTP transport override; defaults to the global fetch implementation.
- **` nodeUrls `**: Base URLs of at least k keeper nodes holding the slot's BLS shards.
- **` committeeToken `**: MUST be identity-scoped: the keeper enforces `identity_hash == keccak256(identity)`.
- **` identity `**: The requested IBE identity, in the clear (the node computes Q_ID from it).
- **` userSignature `**: Owner signature over `keccak256("keykeeper:ibe-extract:v1" || identity)` when the slot has a registered `user_pubkey`.
- **` ciphertextEpoch `**: Expected key epoch of the ciphertext; used to detect rotation.
- **` verifierProofs `**: Verifier membership proofs for the selected snapshot.

### IbeExtractRequestOpts

Operation-specific fields for [ibeDecryptRequest](#ibedecryptrequest) / [ibeExtractRequest](#ibeextractrequest).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/request.ts#L426)

```ts
export interface IbeExtractRequestOpts extends RequestCommitteeTokenOpts {
    threshold?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    approveExecution?: KeeperExecutionApprover;
    nodeUrls: string[];
    identity: string;
    userSignature?: Uint8Array;
    ciphertextEpoch?: number;
}
```

Fields:

- **` threshold `**: Keeper threshold from independently read slot metadata. When supplied, finish after that many distinct pairing-verified shares, cancelling the rest.
- **` timeoutMs `**: Keeper extraction deadline in milliseconds; default 10000.
- **` signal `**: Cancel the extraction fan-out. Does not undo already started keeper work.
- **` fetchImpl `**: HTTP transport override for keeper extraction requests.
- **` approveExecution `**: Client-owned exact-body approval capability for each paid extraction contributor.
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
- **` scopedIdentity `**: Identity string for an IBE-scoped operation. Verifiers bind its hash into the token and evaluate the credential scope. Omit for group signing and group decryption; ciphertext associated data is a separate field.

### KeeperExecutionApprovalRequest

Complete locally constructed request presented to the client's approval capability.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/keeperExecution.ts#L13)

```ts
export interface KeeperExecutionApprovalRequest {
    kind: KeeperExecutionKind;
    nodeUrl: string;
    payment: PaymentIntentWire;
    body: Record<string, unknown>;
    signal?: AbortSignal;
}
```

Fields:

- **` kind `**: Exact route semantics, independent of the returned proof.
- **` nodeUrl `**: Original registered or explicitly application-mapped keeper endpoint.
- **` payment `**: Original payment preimage carried by this request.
- **` body `**: Complete client-built JSON object, excluding only execution_authorizations.
- **` signal `**: Caller cancellation; the approver must check it before invoking its signer.

### KeeperExecutionApprovals

Independently read creator/fee policy and client signatures for the exact request.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/keeperExecution.ts#L27)

```ts
export interface KeeperExecutionApprovals {
    policy: ExecutionConsentPolicy;
    authorizations: ExecutionAuthorization[];
}
```

Fields:

- **` policy `**: Fresh independently authenticated original payment, creator and reserved fee.
- **` authorizations `**: Coordinator plus signed contributors, or only the targeted IBE contributor.

### KeeperExecutionApprover

Local client approval capability; never give this callback to an agent or keeper.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/keeperExecution.ts#L35)

```ts
export type KeeperExecutionApprover = (request: KeeperExecutionApprovalRequest) => Promise<KeeperExecutionApprovals>;
```

### KeeperExecutionKind

Exact public route semantics used to reconstruct client-approved keeper inputs.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/keeperExecution.ts#L10)

```ts
export type KeeperExecutionKind = 'committee-sign' | 'committee-eoa-digest' | 'committee-decrypt' | 'ibe-extract' | 'dual-sign';
```

### LocalExecutionSigner

Disposable local signer whose private seed never leaves its closure.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/execution.ts#L128)

```ts
export interface LocalExecutionSigner extends ClientExecutionSigner {
    dispose(): void;
}
```

Fields:

- **` dispose `**: Erase the retained private seed and permanently disable further signatures.
- **` publicKey `**: Public key used by the creator certificate.
- **` sign `**: Sign the SDK-reconstructed structured hash; never a hash supplied by an agent.

### OperationReceipt

A keeper's operation attestation. Presence alone does not mean verified.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/receipts.ts#L10)

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

### PaidExecutionRequest

Exact request identity in the keeper's public evidence; wire bytes are unsigned arrays.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/recovery.ts#L15)

```ts
export interface PaidExecutionRequest {
    chain_id: number;
    settlement: number[];
    slot: number[];
    action: number;
    payload_digest: number[];
    authorization_commitment: number[];
}
```

Fields:

- **` chain_id `**: Original deployment chain ID.
- **` settlement `**: Settlement address left-padded to 32 bytes.
- **` slot `**: Original slot.
- **` action `**: Stable paid action ordinal, not an arbitrary enum supplied by a server.
- **` payload_digest `**: Original operation payload commitment.
- **` authorization_commitment `**: Locally retained creator payment hash.

### PaidKeeperAssignment

Immutable execution assignment from independently verified slot discovery.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/payment.ts#L7)

```ts
export interface PaidKeeperAssignment {
    key_epoch: number;
    committee_version: number;
    threshold: number;
    coordinator: number[];
    contributors: number[][];
}
```

Fields:

- **` key_epoch `**: Sharing epoch.
- **` committee_version `**: Slot committee version.
- **` threshold `**: Required contributor count.
- **` coordinator `**: Registered Ed25519 coordinator key, serialized as 32 bytes.
- **` contributors `**: Strictly sorted distinct registered Ed25519 keys, including the coordinator.

### PaymentIntentWire

Creator spending authorization; it neither reserves funds nor authorizes key access.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/payment.ts#L21)

```ts
export interface PaymentIntentWire {
    chain_id: number;
    settlement: Hex;
    key_registry: Hex;
    slot: Hex;
    action: 'sign' | 'decrypt' | 'eoa-sign' | 'ibe-extract' | 'dual-approve';
    payload_digest: Hex;
    session_commitment: Hex;
    nonce: Hex;
    max_cost: string;
    expires: number;
    verification_epoch: number;
    verification_seed: Hex;
    verification_root: Hex;
    verification_registry_size: number;
    verification_committee: number;
    verification_quorum: number;
    keeper_assignment: PaidKeeperAssignment;
    signature: Hex;
}
```

Fields:

- **` chain_id `**: EVM chain identifier.
- **` settlement `**: Settlement proxy address.
- **` key_registry `**: KeyRegistry proxy address.
- **` slot `**: Slot identifier.
- **` action `**: Billable operation; a dual approval is separate from the final keeper signature.
- **` payload_digest `**: Digest of the exact operation payload.
- **` session_commitment `**: Commitment to the presentation random, audience and operation expiry.
- **` nonce `**: Unique creator payment nonce.
- **` max_cost `**: Maximum TASRA base units, as a decimal string to avoid precision loss.
- **` expires `**: Payment expiry in Unix seconds.
- **` verification_epoch `**: Pinned verification epoch.
- **` verification_seed `**: Pinned beacon seed.
- **` verification_root `**: Pinned verifier snapshot root.
- **` verification_registry_size `**: Pinned verifier registry size.
- **` verification_committee `**: Pinned verifier committee size.
- **` verification_quorum `**: Pinned verifier quorum.
- **` keeper_assignment `**: Fixed keeper sharing and execution membership.
- **` signature `**: Creator's 65-byte EIP-712 signature.

### ReceiptExpectation

Expected operation hashes and independently authenticated keeper key for receipt verification.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/receipts.ts#L55)

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

### RecoveredExecutionReply

Keeper recovery response containing exact committed JSON bytes as a string.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/recovery.ts#L85)

```ts
export interface RecoveredExecutionReply {
    execution: SignedPaidExecutionReport;
    encoding: 'json' | 'ibe-extract';
    result_json: string;
}
```

Fields:

- **` execution `**: Signed evidence for these exact bytes and their original paid admission.
- **` encoding `**: Explicit commitment scheme; matched to the independently retained action.
- **` result_json `**: Exact retained JSON; parsing or reserializing before hashing changes its commitment.

### RefreshStatusDirectOptions

Options of [refreshStatusDirect](#refreshstatusdirect).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/status-refresh.ts#L579)

```ts
export interface RefreshStatusDirectOptions extends StatusRefreshGrant {
    chainId: number;
    proof: StatusRefreshProofWire;
    verifiers: readonly {
        index: number;
        url: string;
    }[];
    fetch?: typeof fetch;
    allowHttp?: boolean;
    signal?: AbortSignal;
    timeoutMs?: number;
}
```

Fields:

- **` chainId `**: Chain ID (the one the proof signs).
- **` proof `**: One signed proof; fanned out unchanged to the original signers.
- **` verifiers `**: Verifier base URLs by registry index. Only indexes that verifiably signed the token are called.
- **` fetch `**: Fetch implementation (default global fetch).
- **` allowHttp `**: Permit `http:` endpoints (local development only).
- **` signal `**: Cancellation.
- **` timeoutMs `**: Per-verifier deadline, ms (default 15000).
- **` token `**: The grant as journaled (its signatures and every hashed field are never changed).
- **` set `**: Keys of the token epoch's anchored roster: the keys the token signatures verified under.
- **` quorum `**: The token's quorum.
- **` caps `**: Further hard caps, Unix seconds (e.g. the payment expiry). The token `exp` is always one.

### RefreshStatusViaAgentOptions

Options of [refreshStatusViaAgent](#refreshstatusviaagent).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/status-refresh.ts#L691)

```ts
export interface RefreshStatusViaAgentOptions extends StatusRefreshGrant {
    agentUrl: string;
    sessionId: string;
    pollSecret: string;
    proof: StatusRefreshProofWire;
    fetch?: typeof fetch;
    allowHttp?: boolean;
    signal?: AbortSignal;
    timeoutMs?: number;
}
```

Fields:

- **` agentUrl `**: Verifier-agent base URL (the one that ran the session).
- **` sessionId `**: Session identity.
- **` pollSecret `**: The session's owner bearer (`poll_secret`). Never logged.
- **` proof `**: One signed proof.
- **` fetch `**: Fetch implementation (default global fetch).
- **` allowHttp `**: Permit an `http:` agent URL (local development only).
- **` signal `**: Cancellation.
- **` timeoutMs `**: Deadline, ms (default 15000).
- **` token `**: The grant as journaled (its signatures and every hashed field are never changed).
- **` set `**: Keys of the token epoch's anchored roster: the keys the token signatures verified under.
- **` quorum `**: The token's quorum.
- **` caps `**: Further hard caps, Unix seconds (e.g. the payment expiry). The token `exp` is always one.

### RequestCommitteeTokenOpts

Chain reads, verifier directory, credential presentation and optional request-signing context.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/request.ts#L145)

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
- **` scopedIdentity `**: Identity string for an IBE-scoped operation. Verifiers bind its hash into the token and evaluate the credential scope. Omit for group signing and group decryption; ciphertext associated data is a separate field.

### RequireStatusAttestationsOptions

Inputs of [requireStatusAttestations](#requirestatusattestations).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L822)

```ts
export interface RequireStatusAttestationsOptions extends Omit<VerifyStatusAttestationsOptions, 'attestations'> {
    attestations: StatusAttestation[] | undefined;
    allowMissing?: boolean;
}
```

Fields:

- **` attestations `**: The token's attestations; `undefined` or empty means missing (as a keeper reads it).
- **` allowMissing `**: Accept a grant WITHOUT attestations (warning), for a deployment still inside the keepers' documented status-freshness migration window. Default false. Present-but-invalid or stale attestations are refused whatever this says.
- **` quorum `**: The token's quorum.
- **` tokenHash `**: The token's canonical hash (already verified by the caller).
- **` counted `**: Verifier indexes whose TOKEN signature verified (and that still stand). Others are ignored.
- **` set `**: Active verifier set the token signatures were verified against.
- **` now `**: Current time, Unix seconds.

### SessionInitialization

Client authorization to create a session; this is not a paid operator stage.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/execution.ts#L58)

```ts
export interface SessionInitialization {
    certificate: ExecutionCertificate;
    profile_hash: Hex;
    body_hash: Hex;
    expires: number;
    signature: Hex;
}
```

Fields:

- **` certificate `**: Public execution key certified by the slot creator.
- **` profile_hash `**: Hash of the independently approved registered agent profile.
- **` body_hash `**: Hash of the complete unsigned create body, including the client owner bearer.
- **` expires `**: Unix expiry bounded by the certificate.
- **` signature `**: Client Ed25519 signature in a separate initialization domain.

### SignedPaidExecutionReport

Untrusted public evidence from a keeper; authenticated before a recovery request is signed.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/recovery.ts#L49)

```ts
export interface SignedPaidExecutionReport {
    report: CompletedPaidExecutionReport;
    signature: Hex;
    consent: ExecutionConsent;
}
```

Fields:

- **` report `**: Completed report; not a work permit or a computation proof.
- **` signature `**: Registered worker's Ed25519 signature over the report signing hash.
- **` consent `**: Original client approval retained alongside the durable paid start.

### StatusAttestation

One decoded status-freshness attestation.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L689)

```ts
export interface StatusAttestation {
    verifierIndex: number;
    statusUntil: number;
    signature: Uint8Array;
}
```

Fields:

- **` verifierIndex `**: Zero-based verifier registry index (u32).
- **` statusUntil `**: Unix seconds until which this verifier vouches for the holder's credential status.
- **` signature `**: 64-byte Ed25519 signature over [statusAttestationHash](#statusattestationhash).

### StatusAttestationWire

One status attestation on the wire - exactly these three keys.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L699)

```ts
export interface StatusAttestationWire {
    verifier_index: number;
    status_until: number;
    signature: string;
}
```

Fields:

- **` verifier_index `**: Zero-based verifier registry index (u32).
- **` status_until `**: Unix seconds (i64, a JavaScript safe integer).
- **` signature `**: `0x` + 128 hex characters: the 64-byte Ed25519 signature.

### StatusFreshness

Accepted preflight outcome.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L834)

```ts
export type StatusFreshness = {
    kind: 'fresh';
    statusUntil: number;
} | {
    kind: 'missing-accepted';
};
```

Fields:

- **` kind `**: A quorum attests freshness. No attestations, accepted only under the migration opt-out.

### StatusRefreshGrant

The grant a refresh re-attests and the ORIGINAL trust it was verified under.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/status-refresh.ts#L354)

```ts
export interface StatusRefreshGrant {
    token: CompoundTokenWire;
    set: VerifierSet;
    quorum: number;
    caps?: readonly number[];
}
```

Fields:

- **` token `**: The grant as journaled (its signatures and every hashed field are never changed).
- **` set `**: Keys of the token epoch's anchored roster: the keys the token signatures verified under.
- **` quorum `**: The token's quorum.
- **` caps `**: Further hard caps, Unix seconds (e.g. the payment expiry). The token `exp` is always one.

### StatusRefreshHashInput

Inputs of [statusRefreshHash](#statusrefreshhash): exactly the signed list, nothing else.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/status-refresh.ts#L86)

```ts
export interface StatusRefreshHashInput {
    chainId: number | bigint;
    tokenHash: Uint8Array;
    paymentHash?: Uint8Array;
    principal: StatusRefreshPrincipal;
    seq: number | bigint;
    issuedAt: number;
}
```

Fields:

- **` chainId `**: Chain ID (u64).
- **` tokenHash `**: 32-byte canonical token hash ([compoundTokenHash](#compoundtokenhash)), unchanged by the refresh.
- **` paymentHash `**: 32-byte ORIGINAL payment hash of a paid grant; omit (all-zero) for an unpaid grant.
- **` principal `**: Principal kind.
- **` seq `**: Strictly increasing per token per verifier; positive u64.
- **` issuedAt `**: Unix seconds (i64); a verifier accepts it within 30 s of its clock.

### StatusRefreshHolderSigner

Holder-key signer for a `holder_key` refresh proof. The key must be the one recorded at issuance.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/status-refresh.ts#L145)

```ts
export interface StatusRefreshHolderSigner {
    alg: JwsAlg;
    publicJwk: Jwk;
    sign(signingInput: Uint8Array): Uint8Array | Promise<Uint8Array>;
}
```

Fields:

- **` alg `**: `ES256` for a P-256 key, `EdDSA` for an Ed25519 key (the recorded algorithm).
- **` publicJwk `**: Public JWK placed in the JWS header (its thumbprint must equal the recorded one).
- **` sign `**: Raw JWS signature over the signing input (ES256: 64-byte r||s; EdDSA: 64 bytes).

### StatusRefreshHttpResponse

A bounded HTTP answer.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/status-refresh.ts#L508)

```ts
export interface StatusRefreshHttpResponse {
    status: number;
    body: Uint8Array | string;
    retryAfterMs?: number;
}
```

Fields:

- **` status `**: HTTP status.
- **` body `**: Body bytes or text.
- **` retryAfterMs `**: Parsed `Retry-After`, ms.

### StatusRefreshPrincipal

Who proves the refresh: the principal the verifier recorded at issuance.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/status-refresh.ts#L82)

```ts
export type StatusRefreshPrincipal = 'holder_key' | 'client_execution';
```

### StatusRefreshProofWire

One refresh proof on the wire.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/status-refresh.ts#L189)

```ts
export interface StatusRefreshProofWire {
    kind: StatusRefreshPrincipal;
    seq: number;
    issued_at: number;
    signature: string;
}
```

Fields:

- **` kind `**: Principal kind.
- **` seq `**: Positive integer, strictly increasing per token per verifier.
- **` issued_at `**: Unix seconds.
- **` signature `**: `client_execution`: `0x` + 128 hex; `holder_key`: compact JWS.

### StatusRefreshProver

The principal and signer of one refresh proof.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/status-refresh.ts#L174)

```ts
export type StatusRefreshProver = {
    kind: 'client_execution';
    signer: ClientExecutionSigner;
} | {
    kind: 'holder_key';
    signer: StatusRefreshHolderSigner;
};
```

Fields:

- **` kind `**: Principal kind: a paid grant proves with its ORIGINAL creator-certified execution key. Principal kind: the holder key recorded at issuance.
- **` signer `**: Signer over the original execution key. Signer over the holder key recorded at issuance.

### StatusRefreshReplyWire

One verifier's refresh reply - exactly these four keys.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/status-refresh.ts#L274)

```ts
export interface StatusRefreshReplyWire {
    token_hash: string;
    verifier_index: number;
    status_until: number;
    status_signature: string;
}
```

Fields:

- **` token_hash `**: `0x` + 64 hex: the unchanged token hash.
- **` verifier_index `**: The verifier's registry index (u32).
- **` status_until `**: Unix seconds the verifier now vouches until.
- **` status_signature `**: 64-byte Ed25519 signature over the status-attestation hash, hex.

### StatusRefreshResult

A successful refresh.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/status-refresh.ts#L366)

```ts
export interface StatusRefreshResult {
    token: CompoundTokenWire;
    statusAttestations: StatusAttestationWire[];
    refreshed: number[];
    statusUntil: number;
    failures: StatusRefreshFailure[];
    ineligible: number[];
}
```

Fields:

- **` token `**: The grant with `status_attestations` replaced by the merge; signatures and hashed fields unchanged.
- **` statusAttestations `**: Merged attestations, one per counted verifier index (the later `status_until` wins), by index.
- **` refreshed `**: Indexes whose NEW attestation was accepted.
- **` statusUntil `**: Effective status deadline over the merged list (the quorum-th largest), Unix seconds.
- **` failures `**: Verifiers that contributed nothing, and why.
- **` ineligible `**: Original signers whose ORIGINAL attestation must not rejoin this result: withdrawn by their own typed negative outcome (direct), or left out of the relay's answer (relay: the relay's set is the whole answer). A caller merging with a journaled list drops these indexes from it.

### StrictExtractionOptions

Expected slot epoch, threshold, chain key and keeper trust requirements for identity-key extraction.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/extraction.ts#L25)

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
- **` evidenceCt `**: Exact sealed presentation ciphertext returned with this authorization.
- **` timeoutMs `**: Deadline for the complete fan-out, including approvals and response bodies. Default 10000 ms. Cancellation cannot undo work a keeper already started.
- **` approveExecution `**: Required for paid extraction: approve only the exact targeted assigned contributor.
- **` fetchImpl `**: HTTP transport override; defaults to the global fetch implementation.
- **` committeeToken `**: MUST be identity-scoped: the keeper enforces `identity_hash == keccak256(identity)`.
- **` userSignature `**: Owner signature over `keccak256("keykeeper:ibe-extract:v1" || identity)` when the slot has a registered `user_pubkey`.
- **` verifierProofs `**: Verifier membership proofs for the selected snapshot.

### StrictExtractionResult

Extracted identity key and provenance evidence. The caller must clear the returned key when finished.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/extraction.ts#L63)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L30)

```ts
export type TokenType = 'JWT' | 'refresh';
```

### VerifiedToken

What a valid compound token attests.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L337)

```ts
export interface VerifiedToken {
    paymentHash?: Uint8Array;
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

- **` paymentHash `**: Creator payment commitment authenticated by the verifier quorum, when present.
- **` slotId `**: 32-byte slot identifier.
- **` vpHash `**: Hash of the credential presentation bound into the token.
- **` holderHash `**: The holder a quorum attested - the value a distinctness rule keys on.
- **` identityHash `**: the quorum-attested identity binding - present iff the token is scoped.
- **` epoch `**: Beacon epoch used for the verifier committee draw.
- **` tokenType `**: Compound authorization token category.
- **` verifiedSigners `**: Indices of the distinct verifier signatures that passed verification.

### VerifierProof

Trustless verifier-set inclusion proof, passed to the keeper.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/client.ts#L47)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L329)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L367)

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

### VerifyEvidenceBindingOptions

Inputs to [verifyEvidenceBinding](#verifyevidencebinding).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L507)

```ts
export interface VerifyEvidenceBindingOptions {
    tokenHash: Uint8Array;
    evidenceHash: Uint8Array;
    evidenceKeyId: Uint8Array;
    signatures: CommitteeSignature[];
    set: VerifierSet;
    drawn: number[];
    quorum: number;
}
```

Fields:

- **` tokenHash `**: 32-byte compound-token signing hash.
- **` evidenceHash `**: 32-byte keccak256 of the sealed evidence ciphertext.
- **` evidenceKeyId `**: 32-byte keccak256 of the accountant evidence key it is sealed to.
- **` signatures `**: Each signer's evidence-binding signature, by verifier index.
- **` set `**: The anchored verifier set the signer keys are read from.
- **` drawn `**: The drawn committee (the token's `verifier_indexes`).
- **` quorum `**: How many distinct drawn signers must verify.

### VerifyStatusAttestationsOptions

Inputs of [verifyStatusAttestations](#verifystatusattestations), as a keeper checks them.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L759)

```ts
export interface VerifyStatusAttestationsOptions {
    tokenHash: Uint8Array;
    attestations: StatusAttestation[];
    counted: number[];
    set: VerifierSet;
    quorum: number;
    now: number;
}
```

Fields:

- **` tokenHash `**: The token's canonical hash (already verified by the caller).
- **` attestations `**: The token's attestations.
- **` counted `**: Verifier indexes whose TOKEN signature verified (and that still stand). Others are ignored.
- **` set `**: Active verifier set the token signatures were verified against.
- **` quorum `**: The token's quorum.
- **` now `**: Current time, Unix seconds.

## Constants and ABI values

Shared values and contract definitions.

| Export | Description | Definition |
|---|---|---|
| `DEFAULT_STATUS_WINDOW_SECS` | Default attested window (`[committee] status_window_secs`). | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L673) |
| `EXECUTION_APPROVAL_DOMAIN` | Client stage approvals bind complete request bodies and assigned operator keys. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/execution.ts#L11) |
| `EXECUTION_CERTIFICATE_DOMAIN` | Separate creator-consent domain; original payment commitments remain unchanged. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/execution.ts#L9) |
| `EXECUTION_INITIALIZATION_DOMAIN` | Client consent to one exact session and independently approved registered agent. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/execution.ts#L13) |
| `MAX_EXECUTION_BODY_BYTES` | Maximum complete unsigned request size shared with the Rust verifier. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/execution.ts#L15) |
| `MAX_SESSION_ID_LEN` | The longest session id an `htu` may carry — mirrors `MAX_SESSION_ID_LEN`. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/oauth.ts#L27) |
| `MAX_STATUS_ATTESTATIONS` | Most attestations one token may carry (mirrors the keeper cap). | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L675) |
| `MAX_STATUS_REFRESH_BODY_BYTES` | Largest request body a verifier accepts, in bytes. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/status-refresh.ts#L68) |
| `MAX_STATUS_WINDOW_SECS` | Longest usable window a verifier may attest (`55 - 10`). | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L671) |
| `OAUTH_RESPONSE_PATH` | Legacy session-independent response path. New sessions use dpopHtu(origin, sessionId). | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/oauth.ts#L19) |
| `OAUTH_RESPONSE_PATH_PREFIX` | The OAuth response route is `{PREFIX}{sessionId}{SUFFIX}` under the agent origin. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/oauth.ts#L22) |
| `OAUTH_RESPONSE_PATH_SUFFIX` | The trailing segment of the OAuth response route. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/oauth.ts#L24) |
| `REVOCATION_BOUND_SECS` | Decided revocation bound: no keeper accepts a grant later than `R + 60 s`. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L665) |
| `STATUS_ATTESTATION_DOMAIN` | Domain separator of the status-freshness statement (new name, `/v1`). | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L663) |
| `STATUS_CACHE_BOUND_SECS` | The verifier's attestation cache bound: `REVOCATION_BOUND_SECS - STATUS_SKEW_SECS`. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L669) |
| `STATUS_INVALID_CODE` | Stable client preflight code: attestations are present but malformed, duplicated, over the cap or carry a bad signature from a counted verifier (a keeper refuses these without a stable code). | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L684) |
| `STATUS_MISSING_CODE` | Stable keeper refusal code: the keeper requires attestations and the grant carries none. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L679) |
| `STATUS_REFRESH_DOMAIN` | Domain separator of the status-refresh proof (new name, `/v1`). | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/status-refresh.ts#L62) |
| `STATUS_REFRESH_FRESHNESS_SECS` | A verifier accepts `\|issued_at - now\| <= 30 s`. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/status-refresh.ts#L70) |
| `STATUS_REFRESH_JWT_TYP` | JOSE `typ` of a `holder_key` refresh proof. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/status-refresh.ts#L64) |
| `STATUS_REFRESH_PATH` | Verifier route (direct mode). | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/status-refresh.ts#L66) |
| `STATUS_SKEW_SECS` | The only skew a keeper allows past `status_until` (reserved inside the 60 s bound). | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L667) |
| `STATUS_STALE_CODE` | Stable keeper refusal code: attestations present but fewer than a quorum valid and fresh. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/committee/token.ts#L677) |
