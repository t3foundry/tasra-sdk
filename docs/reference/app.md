# tasra-sdk/app

Generated from public TypeScript exports.

[SDK reference](README.md) · [Task guides](../README.md) · [Errors](../errors.md)

## Classes

Clients, adapters and error classes.

<details>
<summary>Browse 8 classes</summary>

- [TasraClient](#tasraclient)
- [ApplicationPayerRecoveryError](#applicationpayerrecoveryerror)
- [ApplicationSlotRecoveryError](#applicationslotrecoveryerror)
- [CreationReconciliationRequiredError](#creationreconciliationrequirederror)
- [PaidOperationAbandonRefusedError](#paidoperationabandonrefusederror)
- [PaidOperationRecoveryError](#paidoperationrecoveryerror)
- [PaidSessionRecoveryError](#paidsessionrecoveryerror)
- [TasraApplicationError](#tasraapplicationerror)

</details>

### TasraClient

Manifest-first application API. Construction validates configuration without network I/O.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/tasra-client.ts#L67)

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

### ApplicationPayerRecoveryError

Another reservation may have consumed this payer's nonce; reconcile it before proceeding.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-reservation.ts#L20)

Import: `import {ApplicationPayerRecoveryError} from 'tasra-sdk/app'`

```ts
declare class ApplicationPayerRecoveryError {
    constructor(requestId: Hex);
}
```

- ` readonly requestId: Hex; ` — Original reservation that must be reconciled.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

### ApplicationSlotRecoveryError

A creation state that requires inspection or reconciliation before resuming.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/ready-slot.ts#L18)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/creation.ts#L42)

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

### PaidOperationAbandonRefusedError

[abandonPaidOperation](#abandonpaidoperation) refused: something could still land under this operation.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-operation.ts#L1148)

Import: `import {PaidOperationAbandonRefusedError} from 'tasra-sdk/app'`

```ts
declare class PaidOperationAbandonRefusedError {
    constructor(requestId: Hex, phase: PaidOperationJournalPhase, reason: string, notBefore?: number);
}
```

- ` readonly requestId: Hex; ` — Reservation identity.

- ` readonly phase: PaidOperationJournalPhase; ` — Journaled phase that blocks abandoning.

- ` readonly notBefore?: number; ` — Unix seconds from which abandoning succeeds (payment expiry plus a skew margin), when time alone unblocks it.

- ` readonly retryable: boolean; ` — `false` when retrying the identical request cannot succeed.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

### PaidOperationRecoveryError

The operation stopped where repeating a step could pay or execute twice; resume or recover it.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-operation.ts#L248)

Import: `import {PaidOperationRecoveryError} from 'tasra-sdk/app'`

```ts
declare class PaidOperationRecoveryError {
    constructor(requestId: Hex, phase: PaidOperationPhase, cause: unknown, detail?: {
        code?: PaidOperationErrorCode;
        resumable?: boolean;
    });
}
```

- ` readonly code: PaidOperationErrorCode; ` — Stable machine-readable reason.

- ` readonly resumable: boolean; ` — Whether [resumePaidOperation](#resumepaidoperation) can still make progress; false for a final refusal or a step only `recover` can read.

- ` readonly requestId: Hex; ` — Reservation identity to resume with.

- ` readonly phase: PaidOperationPhase; ` — Step whose outcome is uncertain.

- ` readonly retryable: boolean; ` — `false` when retrying the identical request cannot succeed.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

### PaidSessionRecoveryError

A retained write's outcome is unknown, or a resumed write differs from its original.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-session.ts#L87)

Import: `import {PaidSessionRecoveryError} from 'tasra-sdk/app'`

```ts
declare class PaidSessionRecoveryError {
    constructor(key: string, message: string);
}
```

- ` readonly key: string; ` — Journal entry that blocks the drive.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

### TasraApplicationError

An application operation rejected because its deployment, slot, authorization or result failed validation.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L32)

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
<summary>Browse 37 functions</summary>

- [abandonPaidOperation](#abandonpaidoperation)
- [approveWithCredential](#approvewithcredential)
- [connectWallet](#connectwallet)
- [createApplicationSlot](#createapplicationslot)
- [createIdentity](#createidentity)
- [createLocalWallet](#createlocalwallet)
- [createMemoryStore](#creatememorystore)
- [createPaidReservationJournal](#createpaidreservationjournal)
- [createPreparedSlot](#createpreparedslot)
- [createSlotWallet](#createslotwallet)
- [createTasra](#createtasra)
- [credentialAuthorization](#credentialauthorization)
- [credentialPolicy](#credentialpolicy)
- [defineDeployment](#definedeployment)
- [drivePaidSession](#drivepaidsession)
- [identityApprover](#identityapprover)
- [issueCredential](#issuecredential)
- [listPaidOperations](#listpaidoperations)
- [loadApplicationManifest](#loadapplicationmanifest)
- [loadPaidReservationJournal](#loadpaidreservationjournal)
- [paidOperation](#paidoperation)
- [paidOperationPhase](#paidoperationphase)
- [prepareSlot](#prepareslot)
- [presentCredentials](#presentcredentials)
- [reconcileApplicationPayment](#reconcileapplicationpayment)
- [reconcileApplicationReservation](#reconcileapplicationreservation)
- [reconcilePaidOperation](#reconcilepaidoperation)
- [recoverPaidOperation](#recoverpaidoperation)
- [registeredWalletAuthorization](#registeredwalletauthorization)
- [reserveApplicationPayment](#reserveapplicationpayment)
- [resolveApplicationManifest](#resolveapplicationmanifest)
- [resumePaidOperation](#resumepaidoperation)
- [selectApplicationGasPayer](#selectapplicationgaspayer)
- [setApprovalPolicy](#setapprovalpolicy)
- [toViemAccount](#toviemaccount)
- [verifyCredential](#verifycredential)
- [waitForPaidSnapshot](#waitforpaidsnapshot)

</details>

### abandonPaidOperation

Close a paid operation for good, only when nothing can still land under it: no reservation,
session write or keeper work can still be accepted. The journal is kept (phase `abandoned`),
left out of [listPaidOperations](#listpaidoperations) by default and refused by [resumePaidOperation](#resumepaidoperation).
Abandoning an already abandoned operation returns its original record.

Allowed when the journal proves it:
- `reserving` with no reservation ever prepared (nothing was sent);
- `failed` (the reservation provably never happened);
- `executed` (completed and recorded);
- `reserved`, `certified`, `authorized` or `executing` once the creator-signed payment has
  expired (plus a skew margin): keepers, verifiers and the agent refuse it from then on.
  Retained results of an `executing` operation stay readable with [recoverPaidOperation](#recoverpaidoperation).

Refused (PaidOperationAbandonRefusedError) otherwise. A `reserving` operation whose
reservation was prepared must first be settled by [reconcilePaidOperation](#reconcilepaidoperation) (it becomes
`failed` or `reserved`), which also releases the gas payer.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-operation.ts#L1198)

Import: `import {abandonPaidOperation} from 'tasra-sdk/app'`

```ts
declare function abandonPaidOperation(store: ApplicationStore, requestId: Hex, options: AbandonPaidOperationOptions): Promise<AbandonedPaidOperation>;
```

| Parameter | Type | Description |
|---|---|---|
| ` store ` | ` ApplicationStore ` | Store the operation was journaled in. |
| ` requestId ` | ` Hex ` | Reservation identity. |
| ` options ` | ` AbandonPaidOperationOptions ` | Reason to journal. |

Returns: ` Promise<AbandonedPaidOperation> `.

### approveWithCredential

Present a credential for this exact request, then sign its canonical approval payload.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/approvals.ts#L90)

Import: `import {approveWithCredential} from 'tasra-sdk/app'`

```ts
declare function approveWithCredential(app: Pick<TasraApplication, 'deployment' | 'slots'>, request: DualSignRequest, message: Uint8Array, options: {
    identity: TasraIdentity;
    authorize: OperationAuthorizer;
    signal?: AbortSignal;
    description?: string;
    payment?: PaymentIntentWire;
    random?: string;
}): Promise<DualSignStatus>;
```

| Parameter | Type | Description |
|---|---|---|
| ` app ` | ` Pick<TasraApplication, 'deployment' \| 'slots'> ` | Application client for the request deployment. |
| ` request ` | ` DualSignRequest ` | Native signing request awaiting an approval. |
| ` message ` | ` Uint8Array ` | Exact document bytes identified by the request. |
| ` options ` | ` { identity: TasraIdentity; authorize: OperationAuthorizer; signal?: AbortSignal; description?: string; payment?: PaymentIntentWire; random?: string; } ` | Approver identity, credential authorizer and cancellation controls. |

Returns: ` Promise<DualSignStatus> `.

### connectWallet

Requests the user's wallet account. Chain switching remains an explicit wallet/user decision.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/wallet.ts#L204)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/ready-slot.ts#L202)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/identity.ts#L44)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/wallet.ts#L192)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/memory-store.ts#L17)

Import: `import {createMemoryStore} from 'tasra-sdk/app'`

```ts
declare function createMemoryStore(): ApplicationStore;
```

Returns: ` ApplicationStore `.

### createPaidReservationJournal

Persist reservation checkpoints and their session preimage using the application's store.
Preparation exclusively creates its request ID; every existing record refuses a new attempt.
For coordinated gas payer nonces and recovery, use reserveApplicationPayment instead.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-journal.ts#L98)

Import: `import {createPaidReservationJournal} from 'tasra-sdk/app'`

```ts
declare function createPaidReservationJournal(store: ApplicationStore, original: PaymentIntentWire, originalSession: PaidReservationSession): PaidReservationJournal;
```

| Parameter | Type | Description |
|---|---|---|
| ` store ` | ` ApplicationStore ` | - Durable private store with locks shared by all participating processes/tabs. |
| ` original ` | ` PaymentIntentWire ` | - Fixed creator intent supplied to reservePaidOperation. |
| ` originalSession ` | ` PaidReservationSession ` | - Random and approved audience committed by that intent. |

Returns: ` PaidReservationJournal `.

### createPreparedSlot

Create or resume one persisted slot intent. Persistence must be atomic and runs must be serialized. Saved transaction hashes are observed without resubmission; missing hashes require wallet reconciliation. Cancellation cannot undo a submitted transaction.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/creation.ts#L73)

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

### createSlotWallet

Use a threshold ECDSA slot with fresh operation authorization on every signature.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/wallet.ts#L219)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L146)

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
            signDigest(input: Uint8Array, options: AuthorizedOperationOptions): Promise<EoaSignature>;
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
                payment?: PaymentIntentWire;
                execution?: KeeperExecutionClientConsent;
            }): Promise<{
                create(message: Uint8Array, options?: {
                    signal?: AbortSignal;
                    payment?: PaymentIntentWire;
                }): Promise<DualSignRequest>;
                resume(requestId: string, expectedMessage: Uint8Array, options?: {
                    payment?: PaymentIntentWire;
                }): DualSignRequest;
            }>;
        }>;
        bls(slotId: Hex): Promise<{
            slotId: `0x${string}`;
            encrypt(identity: string, plaintext: Uint8Array): Promise<IbeCiphertext>;
            decrypt(identity: string, ciphertext: IbeCiphertext, options: IdentityExtractionOptions): Promise<Omit<StrictExtractionResult, "key"> & {
                plaintext: Uint8Array;
            }>;
            extractIdentity(identity: string, options: IdentityExtractionOptions): Promise<StrictExtractionResult>;
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
            signDigest(input: Uint8Array, options: AuthorizedOperationOptions): Promise<EoaSignature>;
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
                payment?: PaymentIntentWire;
                execution?: KeeperExecutionClientConsent;
            }): Promise<{
                create(message: Uint8Array, options?: {
                    signal?: AbortSignal;
                    payment?: PaymentIntentWire;
                }): Promise<DualSignRequest>;
                resume(requestId: string, expectedMessage: Uint8Array, options?: {
                    payment?: PaymentIntentWire;
                }): DualSignRequest;
            }>;
        }>;
        bls(slotId: Hex): Promise<{
            slotId: `0x${string}`;
            encrypt(identity: string, plaintext: Uint8Array): Promise<IbeCiphertext>;
            decrypt(identity: string, ciphertext: IbeCiphertext, options: IdentityExtractionOptions): Promise<Omit<StrictExtractionResult, "key"> & {
                plaintext: Uint8Array;
            }>;
            extractIdentity(identity: string, options: IdentityExtractionOptions): Promise<StrictExtractionResult>;
        }>;
    };
}
```

Return details: A client with read-only checks and authorized slot operations.

### credentialAuthorization

Authorize one exact SDK operation: sign its request, present a credential, collect bound proofs.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/identity.ts#L376)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/identity.ts#L260)

Import: `import {credentialPolicy} from 'tasra-sdk/app'`

```ts
declare function credentialPolicy(options: CredentialPolicyOptions): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` options ` | ` CredentialPolicyOptions ` | Trusted issuer and required credential claims. |

Returns: ` string `.

Return details: Validated DCQL rule suitable for slot creation.

### defineDeployment

Validate a caller-approved descriptor. This does not establish its authenticity.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/deployment.ts#L36)

Import: `import {defineDeployment} from 'tasra-sdk/app'`

```ts
declare function defineDeployment(value: TasraDeployment): Readonly<TasraDeployment>;
```

| Parameter | Type | Description |
|---|---|---|
| ` value ` | ` TasraDeployment ` | Caller-approved public deployment descriptor. |

Returns: ` Readonly<TasraDeployment> `.

### drivePaidSession

Drive one prepared paid session to a completed, verified committee token.
Creation, request-object approval, presentation, continuation and credential approvals are
each journaled before sending; an unknown outcome is never redelivered.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-session.ts#L127)

Import: `import {drivePaidSession} from 'tasra-sdk/app'`

```ts
declare function drivePaidSession(options: PaidSessionDriverOptions): Promise<SessionStatusResult>;
```

| Parameter | Type | Description |
|---|---|---|
| ` options ` | ` PaidSessionDriverOptions ` | Session, anchored witnesses, store, holder strategy and pacing. |

Returns: ` Promise<SessionStatusResult> `.

### identityApprover

Adapt an SDK Ed25519 identity to native approval signatures without exporting its key.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/approvals.ts#L71)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/identity.ts#L150)

Import: `import {issueCredential} from 'tasra-sdk/app'`

```ts
declare function issueCredential(options: IssueCredentialOptions): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` options ` | ` IssueCredentialOptions ` | Issuer, holder, credential type, application claims and lifetime. |

Returns: ` string `.

Return details: Serialized holder-bound SD-JWT credential.

### listPaidOperations

List the paid operations journaled in a store, oldest first, without relying on its key scheme.
Abandoned operations are left out unless asked for. Operations journaled before this index
existed are listed only after a one-time `backfill`; otherwise read them with `paidOperationPhase`.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-operation.ts#L1130)

Import: `import {listPaidOperations} from 'tasra-sdk/app'`

```ts
declare function listPaidOperations(store: ApplicationStore, filter?: ListPaidOperationsOptions): Promise<PaidOperationSummary[]>;
```

| Parameter | Type | Description |
|---|---|---|
| ` store ` | ` ApplicationStore ` | Store the operations were journaled in. |
| ` filter? ` | ` ListPaidOperationsOptions ` | Phases to keep, whether to include abandoned operations, and the one-time backfill. |

Returns: ` Promise<PaidOperationSummary[]> `.

### loadApplicationManifest

Fetch a public manifest; an optional trusted pin is checked before parsing any JSON.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/manifest.ts#L134)

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

### loadPaidReservationJournal

Load retained private evidence by request ID without transmitting or resubmitting anything.
Reverify the original transaction and reservation on chain before acting on a saved phase.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-journal.ts#L85)

Import: `import {loadPaidReservationJournal} from 'tasra-sdk/app'`

```ts
declare function loadPaidReservationJournal(store: ApplicationStore, requestId: Hex): Promise<ApplicationReservationJournal | undefined>;
```

| Parameter | Type | Description |
|---|---|---|
| ` store ` | ` ApplicationStore ` | - Durable private application store with atomic reads/writes. |
| ` requestId ` | ` Hex ` | - Original operation identity, never a replacement nonce. |

Returns: ` Promise<ApplicationReservationJournal | undefined> `.

### paidOperation

Authorize one paid committee operation. Returns a handle whose `execute` runs the keeper
operation once. Throws PaidOperationRecoveryError when a reservation, session write or the
execution outcome is uncertain; continue with [resumePaidOperation](#resumepaidoperation), never by calling
this again (that would be a second payment).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-operation.ts#L448)

Import: `import {paidOperation} from 'tasra-sdk/app'`

```ts
declare function paidOperation(config: PaidOperationConfig, request: PaidOperationRequest): Promise<PaidOperation>;
```

| Parameter | Type | Description |
|---|---|---|
| ` config ` | ` PaidOperationConfig ` | Approved deployment, creator, gas payer, store, agent, accountants and limits. |
| ` request ` | ` PaidOperationRequest ` | Slot, operation, original rule, holder strategy and cancellation. |

Returns: ` Promise<PaidOperation> `.

### paidOperationPhase

Read the journaled phase of a paid operation, for deciding between resume and recovery.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-operation.ts#L1087)

Import: `import {paidOperationPhase} from 'tasra-sdk/app'`

```ts
declare function paidOperationPhase(store: ApplicationStore, requestId: Hex): Promise<PaidOperationJournalPhase | undefined>;
```

| Parameter | Type | Description |
|---|---|---|
| ` store ` | ` ApplicationStore ` | Store the operation was journaled in. |
| ` requestId ` | ` Hex ` | Reservation identity. |

Returns: ` Promise<PaidOperationJournalPhase | undefined> `.

### prepareSlot

Prepare without I/O. Save this private journal durably before requesting creation.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/creation.ts#L55)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/identity.ts#L308)

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

### reconcileApplicationPayment

Release an application's pending gas payer only after verifying the original mined transaction.
Success and revert both consume the nonce. Missing/replaced/reorganized transactions retain
the claim. This does not resubmit, delete the original journal or authorize keeper work.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-reservation.ts#L113)

Import: `import {reconcileApplicationPayment} from 'tasra-sdk/app'`

```ts
declare function reconcileApplicationPayment(
    client: PublicClient,
    store: ApplicationStore,
    deployment: PrepaidDeployment,
    requestId: Hex,
    expected: ExpectedPaidOperation,
    transactionHash: Hex,
    confirmations?: number
): Promise<PaidReservationResolution>;
```

| Parameter | Type | Description |
|---|---|---|
| ` client ` | ` PublicClient ` | - Trusted bounded RPC client with historical canonical reads. |
| ` store ` | ` ApplicationStore ` | - Same durable private store used for reservation. |
| ` deployment ` | ` PrepaidDeployment ` | - Independently approved original deployment. |
| ` requestId ` | ` Hex ` | - Original operation ID retained in the private journal. |
| ` expected ` | ` ExpectedPaidOperation ` | - Independently selected original operation. |
| ` transactionHash ` | ` Hex ` | - Saved or independently located candidate; its full identity is verified. |
| ` confirmations? ` | ` number ` | - Required canonical inclusion depth, 1..64 (default 1). |

Returns: ` Promise<PaidReservationResolution> `.

### reconcileApplicationReservation

Reconcile an application reservation by its deterministic request ID and the payer's nonce,
without submitting, replacing or reserving anything. Works without a transaction hash, e.g.
after a crash between broadcast and the `submitted` checkpoint.

- No journal and no payer claim: `none` (nothing was prepared, so nothing was broadcast),
  unless the chain already holds the reservation (`reserved`).
- Chain holds the reservation: `reserved`.
- Not reserved and a canonical block past the quote deadline: `not-reserved` (the contract
  refuses the original signed quote from then on). Final for this attempt.
- Otherwise `uncertain`; the original transaction may still be mined.

The payer claim is released only when the journaled nonce is consumed on chain, or when the
attempt is provably dead and no transaction at that nonce is known to the RPC (the floor then
stays at that nonce). Every other case keeps the payer locked.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-reservation.ts#L213)

Import: `import {reconcileApplicationReservation} from 'tasra-sdk/app'`

```ts
declare function reconcileApplicationReservation(
    client: PublicClient,
    store: ApplicationStore,
    deployment: PrepaidDeployment,
    payment: PaymentIntentWire,
    expected: ExpectedPaidOperation,
    options?: ReconcileApplicationReservationOptions
): Promise<ApplicationReservationStatus>;
```

| Parameter | Type | Description |
|---|---|---|
| ` client ` | ` PublicClient ` | - Trusted bounded RPC client with canonical reads. |
| ` store ` | ` ApplicationStore ` | - Same private store used for the reservation. |
| ` deployment ` | ` PrepaidDeployment ` | - Independently approved original deployment. |
| ` payment ` | ` PaymentIntentWire ` | - Original creator payment intent (its request ID is the reservation key). |
| ` expected ` | ` ExpectedPaidOperation ` | - Independently selected original operation. |
| ` options? ` | ` ReconcileApplicationReservationOptions ` | - Gas payer for the no-journal case and observation depth. |

Returns: ` Promise<ApplicationReservationStatus> `.

### reconcilePaidOperation

Reconcile a paid operation without any billable or keeper work: no reservation, no session
write, no execution. A `reserving` operation is checked on chain by its request ID and payer
nonce (no transaction hash needed) and advanced only on proof: `reserved` when the chain holds
it, `failed` when its quote deadline passed without one. Anything else stays `reserving`
with `next: 'wait'` and the payer locked.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-operation.ts#L1004)

Import: `import {reconcilePaidOperation} from 'tasra-sdk/app'`

```ts
declare function reconcilePaidOperation(config: PaidOperationConfig, requestId: Hex, options?: Pick<ResumePaidOperationOptions, 'transactionHash' | 'confirmations'>): Promise<PaidOperationStatus>;
```

| Parameter | Type | Description |
|---|---|---|
| ` config ` | ` PaidOperationConfig ` | The configuration the operation started with. |
| ` requestId ` | ` Hex ` | Reservation identity. |
| ` options? ` | ` Pick<ResumePaidOperationOptions, 'transactionHash' \| 'confirmations'> ` | Located transaction hash and observation depth. |

Returns: ` Promise<PaidOperationStatus> `.

### recoverPaidOperation

Open the read-only recovery reads of a paid operation whose keeper work was sent, straight
from its journal: after [reconcilePaidOperation](#reconcilepaidoperation) reports `next: 'recover'` (phase
`executing`), or to re-read an `executed` result. No reservation, session or execution
happens, and no holder is needed. Refused for any other phase. Journals written before the
SDK recorded assigned contributors (before dfafff3) support `recover` but not
`recoverIbePartials`.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-operation.ts#L884)

Import: `import {recoverPaidOperation} from 'tasra-sdk/app'`

```ts
declare function recoverPaidOperation(config: PaidOperationConfig, requestId: Hex): Promise<PaidOperationRecovery>;
```

| Parameter | Type | Description |
|---|---|---|
| ` config ` | ` PaidOperationConfig ` | The configuration the operation started with. |
| ` requestId ` | ` Hex ` | Reservation identity. |

Returns: ` Promise<PaidOperationRecovery> `.

### registeredWalletAuthorization

Request-bound authorization through an independently approved registered agent.
`present` displays a QR/deep link or runs the application's credential wallet.
It never changes the selected provider or transfers a presentation to a fallback.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/authorization.ts#L13)

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

### reserveApplicationPayment

Reserve one operation while exclusively coordinating its gas payer across the application.
The same private store must cover all reservation callers, including different deployments
on one chain. Use a dedicated payer: unrelated wallet/CLI transactions are not coordinated.
Any uncertainty after preparation retains a durable payer claim; elapsed time never clears it.
An `options.signal` abort before the durable preparation refuses with
`PaidReservationAbortedError` (code `aborted`; no journal, no payer claim, nothing sent).
After it the broadcast cannot be cancelled: an abort ends only the receipt wait, as
`PaidReservationUncertainError`, and the payer stays claimed until reconciled.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-reservation.ts#L66)

Import: `import {reserveApplicationPayment} from 'tasra-sdk/app'`

```ts
declare function reserveApplicationPayment(
    client: PublicClient,
    wallet: WalletClient<Transport, Chain, Account>,
    deployment: PrepaidDeployment,
    original: PaymentIntentWire,
    expected: ExpectedPaidOperation,
    options: ApplicationReservationOptions
): ReturnType<typeof reservePaidOperation>;
```

| Parameter | Type | Description |
|---|---|---|
| ` client ` | ` PublicClient ` | - Trusted bounded RPC client; submission retries disabled. |
| ` wallet ` | ` WalletClient<Transport, Chain, Account> ` | - Dedicated account-bound gas payer. |
| ` deployment ` | ` PrepaidDeployment ` | - Independently approved prepaid deployment. |
| ` original ` | ` PaymentIntentWire ` | - Fixed creator intent from verified assignment and session discovery. |
| ` expected ` | ` ExpectedPaidOperation ` | - Independently derived operation. |
| ` options ` | ` ApplicationReservationOptions ` | - Durable store, original session, endpoints and explicit gas limits. |

Returns: ` ReturnType<typeof reservePaidOperation> `.

### resolveApplicationManifest

Validate caller-approved configuration without network I/O or readiness claims.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/manifest.ts#L94)

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

### resumePaidOperation

Continue a paid operation from its journal after a PaidOperationRecoveryError or a restart.
A `reserving` operation is first reconciled on chain (see [reconcilePaidOperation](#reconcilepaidoperation)); it
is reserved only when nothing was ever prepared for it (no journal, no payer claim, nothing on
chain), and never again after any preparation. An unprovable reservation throws
PaidOperationRecoveryError and keeps the gas payer locked. A session is re-read, skipping
confirmed writes; an authorized or executing operation returns its handle (use `recover` for
an uncertain execution). With `reconcileOnly` it returns the status instead and does no work.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-operation.ts#L1032)

Import: `import {resumePaidOperation} from 'tasra-sdk/app'`

```ts
declare function resumePaidOperation(config: PaidOperationConfig, requestId: Hex, options: ResumePaidOperationOptions & {
    reconcileOnly: true;
}): Promise<PaidOperationStatus>;
declare function resumePaidOperation(config: PaidOperationConfig, requestId: Hex, options?: ResumePaidOperationOptions & {
    reconcileOnly?: false;
}): Promise<PaidOperation>;
```

| Parameter | Type | Description |
|---|---|---|
| ` config ` | ` PaidOperationConfig ` | The same configuration the operation started with. |
| ` requestId ` | ` Hex ` | Reservation identity from the error or the journal. |
| ` options ` | ` ResumePaidOperationOptions & { reconcileOnly: true; } ` | Holder strategy, located transaction hash, cancellation, request observation, reconcile-only. |

Returns: ` Promise<PaidOperationStatus> `.

| Parameter | Type | Description |
|---|---|---|
| ` config ` | ` PaidOperationConfig ` | The same configuration the operation started with. |
| ` requestId ` | ` Hex ` | Reservation identity from the error or the journal. |
| ` options? ` | ` ResumePaidOperationOptions & { reconcileOnly?: false; } ` | Holder strategy, located transaction hash, cancellation, request observation, reconcile-only. |

Returns: ` Promise<PaidOperation> `.

### selectApplicationGasPayer

Pick a gas payer from a small pool of dedicated payers for the next paid operation.
Payers holding an unresolved durable reservation claim are skipped (reconcile them); among
the rest, ones idle in this process come first, rotating round-robin per pool so work is
spread fairly. Returns undefined when every payer holds a claim. Selection is advisory: a
payer claimed meanwhile still refuses safely (`ApplicationPayerRecoveryError`). With
`resume`, the payer recorded by that operation's journal is returned instead.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-reservation.ts#L284)

Import: `import {selectApplicationGasPayer} from 'tasra-sdk/app'`

```ts
declare function selectApplicationGasPayer<W extends WalletClient<Transport, Chain, Account>>(store: ApplicationStore, wallets: readonly W[], options?: SelectApplicationGasPayerOptions): Promise<W | undefined>;
```

| Parameter | Type | Description |
|---|---|---|
| ` store ` | ` ApplicationStore ` | - Private store shared by every process using these payers. |
| ` wallets ` | ` readonly W[] ` | - Distinct account- and chain-bound dedicated gas payers (1..64). |
| ` options? ` | ` SelectApplicationGasPayerOptions ` | - Operation being resumed, to honour its recorded payer. |

Returns: ` Promise<W | undefined> `.

### setApprovalPolicy

Install an explicit native FROST approval policy using a durable named transaction.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/approvals.ts#L37)

Import: `import {setApprovalPolicy} from 'tasra-sdk/app'`

```ts
declare function setApprovalPolicy(app: Pick<TasraApplication, 'deployment' | 'chain' | 'slots'>, slotId: Hex, input: ApprovalPolicy, options: {
    wallet: TasraWallet;
    store: ApplicationStore;
    name?: string;
}): Promise<WalletTransactionJournal>;
```

| Parameter | Type | Description |
|---|---|---|
| ` app ` | ` Pick<TasraApplication, 'deployment' \| 'chain' \| 'slots'> ` | Application client for the slot deployment. |
| ` slotId ` | ` Hex ` | FROST slot whose approval policy is being installed. |
| ` input ` | ` ApprovalPolicy ` | Required quorum and either approver keys or a credential rule. |
| ` options ` | ` { wallet: TasraWallet; store: ApplicationStore; name?: string; } ` | Creator wallet and durable store for the named policy transaction. |

Returns: ` Promise<WalletTransactionJournal> `.

### toViemAccount

Use a Tasra slot as a viem account. Every signing call gets fresh authorization;
this adapter never broadcasts a transaction. Pass it to viem's createWalletClient.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/viem.ts#L14)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/identity.ts#L201)

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

### waitForPaidSnapshot

Retry a read-only discovery while the verifier and accountant snapshots for the current epoch
are not yet anchored. Only those two explicit outcomes are retried, before any reservation,
consent or delivery; every other failure is final.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-session.ts#L104)

Import: `import {waitForPaidSnapshot} from 'tasra-sdk/app'`

```ts
declare function waitForPaidSnapshot<T>(read: () => Promise<T>, signal: AbortSignal, wait: () => Promise<void>): Promise<T>;
```

| Parameter | Type | Description |
|---|---|---|
| ` read ` | ` () => Promise<T> ` | Discovery to run. |
| ` signal ` | ` AbortSignal ` | Bounds the total wait. |
| ` wait ` | ` () => Promise<void> ` | Delay between attempts. |

Returns: ` Promise<T> `.

## Types

Options, data structures and return types.

<details>
<summary>Browse 68 types</summary>

- [AbandonedPaidOperation](#abandonedpaidoperation)
- [AbandonPaidOperationOptions](#abandonpaidoperationoptions)
- [ApplicationDeployment](#applicationdeployment)
- [ApplicationErrorCode](#applicationerrorcode)
- [ApplicationManifest](#applicationmanifest)
- [ApplicationReservationJournal](#applicationreservationjournal)
- [ApplicationReservationOptions](#applicationreservationoptions)
- [ApplicationReservationState](#applicationreservationstate)
- [ApplicationReservationStatus](#applicationreservationstatus)
- [ApplicationSlotRecoveryCode](#applicationslotrecoverycode)
- [ApplicationStore](#applicationstore)
- [ApprovalPolicy](#approvalpolicy)
- [AuthorizationRequest](#authorizationrequest)
- [AuthorizedOperationOptions](#authorizedoperationoptions)
- [BlsSlot](#blsslot)
- [CreateApplicationSlot](#createapplicationslot-1)
- [CreateApplicationSlotOptions](#createapplicationslotoptions)
- [CreateSlotOptions](#createslotoptions)
- [CredentialAuthorizationOptions](#credentialauthorizationoptions)
- [CredentialPolicyOptions](#credentialpolicyoptions)
- [EcdsaSlot](#ecdsaslot)
- [FrostSlot](#frostslot)
- [IdentityExtractionOptions](#identityextractionoptions)
- [IssueCredentialOptions](#issuecredentialoptions)
- [ListPaidOperationsOptions](#listpaidoperationsoptions)
- [LoadApplicationManifestOptions](#loadapplicationmanifestoptions)
- [OperationAuthorizer](#operationauthorizer)
- [OperationGrant](#operationgrant)
- [PaidOperation](#paidoperation-1)
- [PaidOperationConfig](#paidoperationconfig)
- [PaidOperationErrorCode](#paidoperationerrorcode)
- [PaidOperationJournalPhase](#paidoperationjournalphase)
- [PaidOperationNextStep](#paidoperationnextstep)
- [PaidOperationPhase](#paidoperationphase-1)
- [PaidOperationRecovery](#paidoperationrecovery)
- [PaidOperationRequest](#paidoperationrequest)
- [PaidOperationStatus](#paidoperationstatus)
- [PaidOperationSummary](#paidoperationsummary)
- [PaidReservationJournal](#paidreservationjournal)
- [PaidReservationSession](#paidreservationsession)
- [PaidSessionDriverOptions](#paidsessiondriveroptions)
- [PaidSessionHolder](#paidsessionholder)
- [PaidSessionRequestLink](#paidsessionrequestlink)
- [PaidStatusRefresh](#paidstatusrefresh)
- [PaidWalletPresentation](#paidwalletpresentation)
- [PresentCredentialsOptions](#presentcredentialsoptions)
- [ReadySlotJournal](#readyslotjournal)
- [ReconcileApplicationReservationOptions](#reconcileapplicationreservationoptions)
- [RecoveredIbePartial](#recoveredibepartial)
- [RecoveredIbePartials](#recoveredibepartials)
- [RecoverIbePartialsOptions](#recoveribepartialsoptions)
- [RefreshPaidStatusOptions](#refreshpaidstatusoptions)
- [ResolveApplicationManifestOptions](#resolveapplicationmanifestoptions)
- [ResolvedApplicationManifest](#resolvedapplicationmanifest)
- [ResumePaidOperationOptions](#resumepaidoperationoptions)
- [SelectApplicationGasPayerOptions](#selectapplicationgaspayeroptions)
- [SlotCreationJournal](#slotcreationjournal)
- [SlotCreationProgress](#slotcreationprogress)
- [SlotMetadata](#slotmetadata)
- [TasraApplication](#tasraapplication)
- [TasraApplicationConfig](#tasraapplicationconfig)
- [TasraClientOptions](#tasraclientoptions)
- [TasraDeployment](#tasradeployment)
- [TasraIdentity](#tasraidentity)
- [TasraWallet](#tasrawallet)
- [VerifyCredentialOptions](#verifycredentialoptions)
- [WalletTransactionInput](#wallettransactioninput)
- [WalletTransactionJournal](#wallettransactionjournal)

</details>

### AbandonedPaidOperation

Result of [abandonPaidOperation](#abandonpaidoperation).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-operation.ts#L1166)

```ts
export interface AbandonedPaidOperation {
    requestId: Hex;
    from: Exclude<PaidOperationJournalPhase, 'abandoned'>;
    reason: string;
    at: number;
}
```

Fields:

- **` requestId `**: Reservation identity (lowercase).
- **` from `**: Phase the operation was abandoned from.
- **` reason `**: Journaled reason.
- **` at `**: When it was abandoned, Unix seconds.

### AbandonPaidOperationOptions

Options for [abandonPaidOperation](#abandonpaidoperation).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-operation.ts#L1160)

```ts
export interface AbandonPaidOperationOptions {
    reason: string;
}
```

Fields:

- **` reason `**: Why the application closes the operation (1..512 characters); journaled and listed.

### ApplicationDeployment

Public application deployment settings with optional explicitly approved endpoint routing.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/manifest.ts#L10)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L28)

```ts
export type ApplicationErrorCode = 'CHAIN_MISMATCH' | 'SLOT_NOT_FOUND' | 'SLOT_CANCELLED' | 'WRONG_SLOT_MODE' | 'KEY_NOT_READY' | 'SLOT_CHANGED' | 'INVALID_AUTHORIZATION' | 'INVALID_RESULT';
```

### ApplicationManifest

A network manifest downloaded from tasra-releases or an explicitly approved application deployment.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/manifest.ts#L21)

```ts
export type ApplicationManifest = NetworkManifest | ApplicationDeployment;
```

Fields:

- **` schemaVersion `**: Deployment descriptor schema version. Network manifest schema version.
- **` chainId `**: EVM chain ID used to bind transactions and authorization. EVM chain ID matching the selected network profile.

### ApplicationReservationJournal

Durable reservation evidence; its phase never substitutes for fresh canonical chain checks.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-journal.ts#L15)

```ts
export interface ApplicationReservationJournal {
    schemaVersion: 1;
    phase: PaidReservationCheckpoint['phase'];
    record: PaidReservationRecord;
    session: PaidReservationSession;
    transactionHash?: Hex;
    blockHash?: Hex;
}
```

Fields:

- **` schemaVersion `**: Storage schema.
- **` phase `**: Last durably saved checkpoint.
- **` record `**: Original transaction, signed fee quote and creator intent.
- **` session `**: Original random and audience; keep this journal private.
- **` transactionHash `**: Locally signed hash journaled before broadcast, or the RPC-reported hash; absence does not prove no submission occurred.
- **` blockHash `**: Observed inclusion block at confirmation; it may later reorganize.

### ApplicationReservationOptions

Durable application reservation controls, shared by every use of this gas payer.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-reservation.ts#L12)

```ts
export interface ApplicationReservationOptions extends Omit<ReservePaidOperationOptions, 'persist'> {
    store: ApplicationStore;
    session: PaidReservationSession;
}
```

Fields:

- **` store `**: Private atomic store whose locks coordinate all participating processes or tabs.
- **` session `**: Original presentation random and independently approved audience.
- **` accountantUrls `**: Independently selected accountant HTTPS endpoints; all must agree on the same quote.
- **` allowLocalHttp `**: Permit HTTP only on local chain43112; never on Fuji.
- **` maxGas `**: Maximum transaction gas units.
- **` maxGasPrice `**: Maximum native gas price in wei; separate from the payment's TASRA cap.
- **` requestTimeoutMs `**: Per-accountant request timeout, 1..85000 ms (default 85000).
- **` receiptTimeoutMs `**: Receipt timeout, 1..120000 ms (default 60000).
- **` confirmations `**: Required confirmations, 1..64 (default 1).
- **` signal `**: Optional cancellation. Before the durable `prepared` checkpoint (nothing sent) an abort refuses with ` PaidReservationAbortedError `. From that checkpoint the one broadcast proceeds and every journal write completes; an abort then only ends the receipt wait, as ` PaidReservationUncertainError `: a broadcast transaction cannot be cancelled.
- **` clock `**: Time source for the accountant's reservation-quota wait (a `prepare` answered 429 with a valid `Retry-After` / `x-ratelimit-after` is repeated identically within min(150 s, half the payment's remaining lifetime)); wall-clock ms. Default: the system clock. Inject one in tests.

### ApplicationReservationState

Where an application reservation stands, from the journal, the payer claim and the chain.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-reservation.ts#L135)

```ts
export type ApplicationReservationState = 'none' | 'reserved' | 'not-reserved' | 'uncertain';
```

### ApplicationReservationStatus

Outcome of [reconcileApplicationReservation](#reconcileapplicationreservation).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-reservation.ts#L146)

```ts
export interface ApplicationReservationStatus {
    state: ApplicationReservationState;
    requestId: Hex;
    payerLocked: boolean;
    transactionHash?: Hex;
    reason?: string;
    observedAt: {
        blockNumber: bigint;
        blockHash: Hex;
        blockTimestamp: bigint;
    };
}
```

Fields:

- **` state `**: Proven state; only `none` permits a first reservation.
- **` requestId `**: Original request identity.
- **` payerLocked `**: Whether this request still holds its gas payer's durable claim after reconciliation.
- **` transactionHash `**: Hash journaled or reported for the original attempt, when known.
- **` reason `**: Why the state is `uncertain` or `not-reserved`; safe to log.
- **` observedAt `**: Canonical block the chain observation was made at.

### ApplicationSlotRecoveryCode

Stable recovery categories for a durable named slot creation.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/ready-slot.ts#L13)

```ts
export type ApplicationSlotRecoveryCode = 'SAVED_INTENT_MISMATCH' | 'SLOT_STATE_MISMATCH' | 'VERIFIER_POLICY_OUTCOME_UNKNOWN' | 'VERIFIER_POLICY_RECEIPT_PENDING' | 'VERIFIER_POLICY_REVERTED' | 'VERIFIER_POLICY_MISMATCH';
```

### ApplicationStore

Implementations must save atomically and exclusively lock across processes/tabs.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/ready-slot.ts#L38)

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
- **` list `**: Optional: keys starting with `prefix`, in any order. Used only for one-time maintenance such as backfilling the paid operation index; stores without it still work everywhere else.
- **` claim `**: Optional: atomically and durably create the record `key` only if it does not exist, across all participating processes or tabs. Resolves true for exactly one caller, false when the key already exists. Paid approvals use it as a one-use, generation-bound send claim; without it a retained approval is sent once and never resent.

### ApprovalPolicy

Required approval count and either trusted Ed25519 keys or a credential rule.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/approvals.ts#L19)

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

### AuthorizationRequest

Immutable operation details presented to the application authorizer.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L48)

```ts
export type AuthorizationRequest = Readonly<OperationInput & {
    payment?: PaymentIntentWire;
    random?: string;
    signal?: AbortSignal;
}>;
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
- **` payment `**: Fixed creator intent for the already mined reservation; never replace it during authorization.
- **` random `**: Presentation random committed by the payment.
- **` signal `**: Cancellation signal propagated to the authorization provider.

### AuthorizedOperationOptions

Authorization callback, consent description and cancellation controls for a protected operation.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L61)

```ts
export interface AuthorizedOperationOptions {
    execution?: KeeperExecutionClientConsent;
    payment?: PaymentIntentWire;
    random?: string;
    authorize: OperationAuthorizer;
    description?: string;
    signal?: AbortSignal;
    userSignature?: Uint8Array;
}
```

Fields:

- **` execution `**: Required with payment: original creator certificate and client-only execution signer.
- **` payment `**: Existing creator-signed reservation intent for this exact operation. Requires random.
- **` random `**: Fixed presentation random committed before reservation. Requires payment.
- **` authorize `**: Obtain a fresh holder-bound grant for this exact operation.
- **` description `**: Human-readable consent text attached to the authorization request.
- **` signal `**: Cancel pending authorization or network work.
- **` userSignature `**: Optional holder signature forwarded to the keeper operation.

### BlsSlot

Identity-based encryption handle with authorized decryption and explicit identity-key extraction.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L410)

```ts
export type BlsSlot = Awaited<ReturnType<TasraApplication['slots']['bls']>>;
```

Fields:

- **` slotId `**: Identifier of the BLS identity-encryption slot.
- **` encrypt `**: Public-key encryption; no credential or network authorization is requested.
- **` decrypt `**: Authorize identity-key extraction and decrypt the ciphertext after verifying threshold shares.
- **` extractIdentity `**: Explicit custody: the returned identity key persists independently of token expiry.

### CreateApplicationSlot

Named slot intent with an authorization rule, key threshold and verifier quorum.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/ready-slot.ts#L67)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/ready-slot.ts#L134)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/tasra-client.ts#L44)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/identity.ts#L335)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/identity.ts#L236)

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

### EcdsaSlot

Threshold Ethereum account handle that verifies each signature against the anchored public key.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L402)

```ts
export type EcdsaSlot = Awaited<ReturnType<TasraApplication['slots']['ecdsa']>>;
```

Fields:

- **` slotId `**: Identifier of the threshold ECDSA slot.
- **` getAddress `**: Recheck slot readiness and derive its Ethereum address from the current public key.
- **` signDigest `**: Authorize and sign an exact 32-byte Ethereum digest, then verify the recovered account.

### FrostSlot

Threshold Ed25519 signing handle with optional receipt checks and native approval sessions.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L406)

```ts
export type FrostSlot = Awaited<ReturnType<TasraApplication['slots']['frost']>>;
```

Fields:

- **` slotId `**: Identifier of the FROST signing slot.
- **` sign `**: Authorize the exact message and verify the returned signature, epoch and optional receipt.
- **` approvals `**: Quorum and approval mode must come from the application's independently pinned policy.

### IdentityExtractionOptions

Authorization, receipt requirements and fan-out deadline for a BLS identity operation.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L87)

```ts
export interface IdentityExtractionOptions extends AuthorizedOperationOptions {
    requireReceipts?: boolean;
    timeoutMs?: number;
}
```

Fields:

- **` requireReceipts `**: Require an authenticated receipt from every extraction share used. Default false.
- **` timeoutMs `**: Complete keeper extraction deadline in milliseconds, including approvals and response bodies. Default 10000. Does not cover the preceding wallet authorization.
- **` execution `**: Required with payment: original creator certificate and client-only execution signer.
- **` payment `**: Existing creator-signed reservation intent for this exact operation. Requires random.
- **` random `**: Fixed presentation random committed before reservation. Requires payment.
- **` authorize `**: Obtain a fresh holder-bound grant for this exact operation.
- **` description `**: Human-readable consent text attached to the authorization request.
- **` signal `**: Cancel pending authorization or network work.
- **` userSignature `**: Optional holder signature forwarded to the keeper operation.

### IssueCredentialOptions

Issuer, holder and claims for a signed, expiring SD-JWT credential.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/identity.ts#L118)

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

### ListPaidOperationsOptions

Options for [listPaidOperations](#listpaidoperations).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-operation.ts#L1111)

```ts
export interface ListPaidOperationsOptions {
    phase?: PaidOperationJournalPhase | readonly PaidOperationJournalPhase[];
    includeAbandoned?: boolean;
    backfill?: boolean;
}
```

Fields:

- **` phase `**: Phase or phases to keep, e.g. `['reserving', 'executing']` for work needing attention. Naming `abandoned` includes abandoned operations.
- **` includeAbandoned `**: Include abandoned operations (default false: they are closed and never need attention).
- **` backfill `**: Once per store, index journals written before the index existed. Needs a store that can list its keys (`list`); the built-in memory, file and IndexedDB stores can.

### LoadApplicationManifestOptions

Manifest download controls and an optional independently trusted SHA-256 pin.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/manifest.ts#L53)

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

### OperationAuthorizer

Called once for the exact operation. Applications display the wallet request here.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L57)

```ts
export type OperationAuthorizer = (request: AuthorizationRequest) => Promise<OperationGrant>;
```

### OperationGrant

Holder-bound committee token and verifier membership proofs for one operation.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L39)

```ts
export interface OperationGrant {
    token: CompoundTokenWire;
    verifierProofs: VerifierProof[];
}
```

Fields:

- **` token `**: Fresh compound verifier token bound to the holder and exact operation.
- **` verifierProofs `**: Membership proofs for the verifiers that authorized the operation.

### PaidOperation

A verified, paid committee authorization for exactly one keeper execution.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-operation.ts#L117)

```ts
export interface PaidOperation {
    readonly requestId: Hex;
    readonly payment: PaymentIntentWire;
    readonly coordinatorUrl: string;
    readonly compound_token: CompoundTokenWire;
    readonly verifierProofs: VerifierProof[];
    readonly verifier_proofs: {
        verifier_index: number;
        operator: string;
        pubkey: string;
        proof: string[];
    }[];
    readonly approveExecution: KeeperExecutionApprover;
    execute<R>(work: (operation: PaidOperation) => Promise<R>): Promise<R>;
    refreshStatus(options?: RefreshPaidStatusOptions): Promise<PaidStatusRefresh>;
    recover(options: {
        transport: KeeperRecoveryTransport;
        stage?: Extract<ExecutionStage, 'coordinator' | 'contributor'>;
        signal?: AbortSignal;
    }): Promise<RecoveredKeeperExecution>;
    recoverIbePartials(options: RecoverIbePartialsOptions): Promise<RecoveredIbePartials>;
    dispose(): void;
}
```

Fields:

- **` requestId `**: Reservation identity (`prepaid-request/v1`), the key for resume and recovery.
- **` payment `**: Original creator-signed payment intent.
- **` coordinatorUrl `**: The assigned coordinator keeper's reachable URL (after the approved route map).
- **` compound_token `**: Verified compound token carrying the payment.
- **` verifierProofs `**: Anchored verifier witnesses, for keeper calls.
- **` verifier_proofs `**: The same witnesses in wire form.
- **` approveExecution `**: Client approver for keeper stage signatures; pass as `approveExecution` to committee clients.
- **` execute `**: Run the keeper operation exactly once. A failure is journaled and never retried; use `recover`.
- **` refreshStatus `**: Explicitly refresh the grant's revocation-status attestations (`keykeeper/committee-status-refresh/v1`) for the SAME token and payment, before `execute`. Allowed only while the journal is `authorized` (nothing was sent). A new `seq` is journaled BEFORE the proof is signed or sent and is never reused, even after a crash. On success the grant's `status_attestations` are replaced in the journal (the original list is kept in its refresh history) and later `execute` calls and `compound_token` reads use them. Never automatic, never retried; no new session, payment or keeper work. Throws ` StatusRefreshError `.
- **` recover `**: Read the keeper's retained result after an uncertain execution. Performs no new work.
- **` recoverIbePartials `**: After an uncertain `ibe-extract` fan-out, read each assigned contributor's retained, commitment-verified partial (stage `contributor`) until the payment's keeper threshold is met. Performs no new work and never re-sends an extraction. Combine the partials with the pairing-verifying IBE combine helpers. Throws when fewer than the threshold are recoverable.
- **` dispose `**: Erase the local execution signer.

### PaidOperationConfig

Approved deployment, signers, services and spending limits shared by paid operations.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-operation.ts#L53)

```ts
export interface PaidOperationConfig {
    chain: TasraChainClient;
    deployment: PaidContextDeployment & {
        defaultVerificationPolicy?: {
            committee: number;
            quorum: number;
        };
    };
    creator: Pick<LocalAccount, 'address' | 'signTypedData'>;
    gasPayer: WalletClient<Transport, Chain, Account>;
    store: ApplicationStore;
    agent: {
        profile: ApprovedAgentProfile;
        transport: PaidAgentTransport;
    };
    accountantUrls: readonly string[];
    limits: {
        maxCost: bigint;
        maxGas: bigint;
        maxGasPrice: bigint;
    };
    allowLocalHttp?: boolean;
    keeperUrl?: (registeredUrl: string) => string;
    billing?: BillingModeDetector;
    fetch?: typeof fetch;
    snapshotWaitMs?: number;
    pollIntervalMs?: number;
    allowMissingStatusAttestations?: boolean;
}
```

Fields:

- **` chain `**: Trusted chain client; its ServiceRegistry address must match the approved agent profile.
- **` deployment `**: Independently approved contracts, with the deployment default verifier policy.
- **` creator `**: Slot creator: signs the operation, the payment intent and the execution certificate.
- **` gasPayer `**: Dedicated reservation gas payer (account- and chain-bound). Never shared with unrelated sends.
- **` store `**: Private durable store with exclusive locks shared by every process or tab using this payer.
- **` agent `**: Independently approved verifier-agent and its guarded transport.
- **` accountantUrls `**: Approved accountant origins: reservation quotes and verifier snapshot artifacts.
- **` limits `**: Finite spending limits: TASRA per operation, gas units and gas price for the reservation.
- **` allowLocalHttp `**: Permit HTTP on the local development chain (43112) only.
- **` keeperUrl `**: Caller-approved keeper route map (registered URL to reachable URL).
- **` billing `**: Cached billing detector for this deployment; a fresh read is used when absent.
- **` fetch `**: Fetch used for verifier snapshot artifacts (defaults to global fetch).
- **` snapshotWaitMs `**: Longest wait for the current epoch's snapshots to be anchored, ms (default 180000, max 300000).
- **` pollIntervalMs `**: Poll interval while waiting on the agent, ms (default 1000). Agent Retry-After hints take precedence.
- **` allowMissingStatusAttestations `**: Accept a grant WITHOUT revocation-status attestations (with a warning), only for a deployment still inside the keepers' documented status-freshness migration window. Default false: the grant is refused with `revocation_status_missing` before execution. Stale or invalid attestations are always refused.

### PaidOperationErrorCode

Stable reason a paid operation stopped. `resumable` on the error says whether
[resumePaidOperation](#resumepaidoperation) can still make progress.
- `reservation-refused`: nothing was prepared or sent (e.g. accountant refusal, underfunded
  slot, RPC failure before preparation). Resumable unless the payment expired.
- `reservation-uncertain`: a reservation may have been sent; resume reconciles it, never resends.
- `reservation-failed`: the original reservation provably never happened. Final.
- `session-interrupted`: transport loss, timeout or an unavailable agent; resume continues.
- `session-refused`: the committee, a verifier, the wallet or the agent refused (a failed
  session, HTTP 4xx such as 403/410). Final.
- `session-write-uncertain`: a journaled session write has an unknown outcome; resume refuses
  it until reconciled out of band. Not resumable.
- `payment-expired`: the creator-signed payment expired; nothing more can run under it. Final.
- `execution-uncertain`: the keeper may have run; use the handle's `recover`, never execute again.
- `aborted`: the caller's signal stopped a journaled operation before anything uncertain was
  sent in this step; resumable unless the payment expired. When the abort left a step uncertain
  (a reservation or session write may have been sent, or an execution), that step's uncertain
  code is reported instead. An abort before the journal is written rethrows the signal's reason:
  nothing was journaled or sent.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-operation.ts#L244)

```ts
export type PaidOperationErrorCode = 'reservation-refused' | 'reservation-uncertain' | 'reservation-failed' | 'session-interrupted' | 'session-refused' | 'session-write-uncertain' | 'payment-expired' | 'execution-uncertain' | 'aborted';
```

### PaidOperationJournalPhase

Journaled progress of one paid operation. `failed` is terminal: the original reservation
provably never happened and the operation must not be reserved again. `abandoned` is terminal
too: the application closed it with [abandonPaidOperation](#abandonpaidoperation) once nothing could still land.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-operation.ts#L300)

```ts
export type PaidOperationJournalPhase = 'reserving' | 'reserved' | 'certified' | 'authorized' | 'executing' | 'executed' | 'failed' | 'abandoned';
```

### PaidOperationNextStep

What the application should do next with a reconciled paid operation.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-operation.ts#L903)

```ts
export type PaidOperationNextStep = 'reserve' | 'resume' | 'wait' | 'recover' | 'done' | 'abandon' | 'closed';
```

### PaidOperationPhase

Where a paid operation stopped with an uncertain or unfinished outcome.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-operation.ts#L222)

```ts
export type PaidOperationPhase = 'reservation' | 'session' | 'execution';
```

### PaidOperationRecovery

Read-only recovery for a paid operation whose keeper work was sent; see [recoverPaidOperation](#recoverpaidoperation).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-operation.ts#L850)

```ts
export interface PaidOperationRecovery {
    readonly requestId: Hex;
    readonly payment: PaymentIntentWire;
    readonly phase: PaidOperationJournalPhase;
    recover: PaidOperation['recover'];
    recoverIbePartials: PaidOperation['recoverIbePartials'];
    refreshStatus(options: RefreshPaidStatusOptions & {
        explicitRecovery: true;
    }): Promise<PaidStatusRefresh>;
    dispose(): void;
}
```

Fields:

- **` requestId `**: Reservation identity.
- **` payment `**: Original creator-signed payment intent.
- **` phase `**: Journaled phase (`executing` or `executed`, or `abandoned` from one of them).
- **` recover `**: Read the keeper's retained result (coordinator stage by default). Performs no new work.
- **` recoverIbePartials `**: For `ibe-extract`: read contributors' retained partials up to the threshold. Performs no new work.
- **` refreshStatus `**: EXPLICIT RECOVERY ONLY: refresh the grant's revocation-status attestations while the execution is uncertain (`executing`), for an application that has independently decided to continue the SAME request (for example after `recover` found no coordinator record). It changes no keeper state and NOT the journal phase: the execution stays uncertain, `execute` stays refused, and neither a keeper 403 nor a recovery 404 becomes evidence that no work ran. Same journaled, never-reused `seq` as ` PaidOperation.refreshStatus `; requires `explicitRecovery: true`.
- **` dispose `**: Erase the local execution signer.

### PaidOperationRequest

The one operation to authorize and how its holder presents.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-operation.ts#L92)

```ts
export interface PaidOperationRequest {
    slot: Hex;
    operation: {
        action: CommitteeAction;
        message?: Uint8Array;
        identity?: string;
        payloadDigest?: Uint8Array;
        ttlSecs?: number;
        description?: string;
    };
    rule: {
        rule: string;
        salt: Hex;
    };
    holder: PaidSessionHolder;
    coordinator?: Address;
    signal?: AbortSignal;
    observeRequest?(request: VerifiedRequestObject): void | Promise<void>;
    onRequestId?(requestId: Hex): void | Promise<void>;
}
```

Fields:

- **` slot `**: Slot to operate on.
- **` operation `**: Committee action and payload: `message` for sign, `identity` for ibe-extract, `payloadDigest` for decrypt/dual-approve.
- **` rule `**: The slot's original DCQL rule and salt; checked against its on-chain commitment.
- **` holder `**: Holder strategy: the SDK wallet presents itself, or an external wallet scans the request.
- **` coordinator `**: Pin the coordinator keeper (operator address); otherwise the first eligible keeper.
- **` signal `**: Cancellation for the authorization (reservation, session, grant).
- **` observeRequest `**: Inspect the verified request object before any credential is disclosed.
- **` onRequestId `**: Receive the reservation identity as soon as it is derived, before witnesses are fetched or anything is reserved, to link this run to its payment. A throw stops the operation before any spending. Until the journal is written (just before reservation) `paidOperationPhase` returns undefined for it.

### PaidOperationStatus

Read-only reconciliation result of [reconcilePaidOperation](#reconcilepaidoperation).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-operation.ts#L920)

```ts
export interface PaidOperationStatus {
    requestId: Hex;
    phase: PaidOperationJournalPhase;
    payer?: Address;
    reservation: ApplicationReservationState;
    payerLocked: boolean;
    next: PaidOperationNextStep;
    reason?: string;
    transactionHash?: Hex;
}
```

Fields:

- **` requestId `**: Reservation identity.
- **` phase `**: Journaled phase after reconciliation.
- **` payer `**: Gas payer the journal recorded (absent from journals written before payers were recorded).
- **` reservation `**: Reservation state: proven from the chain while `reserving`, implied by the phase afterwards.
- **` payerLocked `**: Whether this operation still holds its gas payer's durable claim.
- **` next `**: Next safe step.
- **` reason `**: Why the reservation is `uncertain` or `not-reserved`; safe to log.
- **` transactionHash `**: Journaled or reported reservation transaction hash, when known.

### PaidOperationSummary

One journaled paid operation, as listed by [listPaidOperations](#listpaidoperations).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-operation.ts#L1093)

```ts
export interface PaidOperationSummary {
    requestId: Hex;
    phase: PaidOperationJournalPhase;
    slot: Hex;
    action: PaymentIntentWire['action'];
    expires: number;
    payer?: Address;
    abandoned?: {
        reason: string;
        at: number;
        phase: Exclude<PaidOperationJournalPhase, 'abandoned'>;
    };
}
```

Fields:

- **` requestId `**: Reservation identity (lowercase).
- **` phase `**: Journaled phase.
- **` slot `**: Slot the operation runs on.
- **` action `**: Paid action (`eoa-sign` for a FROST sign on an EOA slot).
- **` expires `**: Payment expiry, Unix seconds.
- **` payer `**: Gas payer the journal recorded (absent from journals written before payers were recorded).
- **` abandoned `**: Set for an abandoned operation: why and the phase it was abandoned from.

### PaidReservationJournal

Persistent callback adapter for reservePaidOperation, with immutable recovery identity.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-journal.ts#L31)

```ts
export interface PaidReservationJournal {
    readonly requestId: Hex;
    readonly persist: ReservePaidOperationOptions['persist'];
    load(): Promise<ApplicationReservationJournal | undefined>;
}
```

Fields:

- **` requestId `**: Locally derived operation identity.
- **` persist `**: Callback that durably records each checkpoint before allowing submission to continue.
- **` load `**: Read the original saved evidence, including after failures or process restart.

### PaidReservationSession

Private session preimage retained with a reservation for recovery after process loss.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-journal.ts#L7)

```ts
export interface PaidReservationSession {
    random: Hex;
    audience: string;
}
```

Fields:

- **` random `**: Fixed 32-byte presentation random committed before reservation.
- **` audience `**: Independently approved verifier-agent audience committed before reservation.

### PaidSessionDriverOptions

Inputs to [drivePaidSession](#drivepaidsession).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-session.ts#L61)

```ts
export interface PaidSessionDriverOptions {
    session: RegisteredPaidAgentSession;
    members: readonly PaidVerifierWitness[];
    store: ApplicationStore;
    signal: AbortSignal;
    holder: PaidSessionHolder;
    wait(retryAfterMs?: number): Promise<void>;
    observeRequest?(request: VerifiedRequestObject): void | Promise<void>;
    resume?: boolean;
    journalPrefix?: string;
}
```

Fields:

- **` session `**: Prepared session from prepareRegisteredPaidSession.
- **` members `**: Anchored drawn verifier witnesses the session was prepared with.
- **` store `**: Private durable store with exclusive locks.
- **` signal `**: Cancellation for the whole drive.
- **` holder `**: Holder strategy.
- **` wait `**: Wait between polls; receives the agent's Retry-After hint when it sent one.
- **` observeRequest `**: Observe the verified request before any credential is disclosed (receives a detached copy).
- **` resume `**: Resume a previous drive from the store: confirmed writes are skipped (creation is reconciled by an authenticated read), unknown ones still refuse. Default false: any retained write refuses, so a first drive can never collide with an earlier attempt.
- **` journalPrefix `**: Journal key prefix; default `wallet-` (compatible with records written by earlier drivers).

### PaidSessionHolder

How the holder answers the session's request object.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-session.ts#L40)

```ts
export type PaidSessionHolder = {
    kind: 'local';
    present?(request: {
        request: VerifiedRequestObject;
    } & PaidSessionRequestLink): void | Promise<void>;
    makePresentation(request: VerifiedRequestObject, link: PaidSessionRequestLink): PaidWalletPresentation | Promise<PaidWalletPresentation>;
    submit(request: VerifiedRequestObject, presentation: PaidWalletPresentation): Promise<void>;
} | {
    kind: 'external';
    present(request: {
        request: VerifiedRequestObject;
        requestUri: string;
        qrPayload: string;
    }): void | Promise<void>;
    accept(candidate: PaidRetainedPresentation, request: VerifiedRequestObject): boolean | Promise<boolean>;
};
```

Fields:

- **` kind `**: The client holds the credential and posts the presentation itself (SDK wallet). An external wallet (phone, Hovi) scans the request; the client approves what the agent retained.
- **` present `**: Observe the verified request and its link (e.g. to log or hand off); not billable, shown again on resume. Show the verified request to the holder (render `qrPayload`). Called once.

### PaidSessionRequestLink

Where a holder fetches the session's request object: the request URI and its `openid4vp://` QR/deep-link payload.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-session.ts#L32)

```ts
export interface PaidSessionRequestLink {
    requestUri: string;
    qrPayload: string;
}
```

Fields:

- **` requestUri `**: Agent-hosted request URI (`<endpoint>/v1/request/<session>`).
- **` qrPayload `**: `openid4vp://?client_id=…&request_uri=…`, for a QR code or deep link.

### PaidStatusRefresh

A successful paid status refresh.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-operation.ts#L186)

```ts
export interface PaidStatusRefresh {
    requestId: Hex;
    seq: number;
    statusUntil: number;
    compound_token: CompoundTokenWire;
    refreshed: number[];
    failures: StatusRefreshFailure[];
}
```

Fields:

- **` requestId `**: Reservation identity.
- **` seq `**: Journaled sequence number the proof used.
- **` statusUntil `**: Effective status deadline (quorum-th largest), Unix seconds; keepers accept until `+ 5 s`.
- **` compound_token `**: The journaled grant with its merged attestations (signatures and token hash unchanged).
- **` refreshed `**: Verifier indexes whose new attestation was accepted.
- **` failures `**: Original signers that contributed nothing, and why.

### PaidWalletPresentation

A presentation the client's own wallet built: the approved body and the encrypted form it posts.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-session.ts#L24)

```ts
export interface PaidWalletPresentation {
    approved: ClientApprovedPresentation;
    form: Record<string, string>;
}
```

Fields:

- **` approved `**: Complete presentation the client accepts for credential verification.
- **` form `**: Encrypted `direct_post.jwt` form fields; must carry `response`.

### PresentCredentialsOptions

Credential selection, request validation and cancellation controls for OID4VP presentation.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/identity.ts#L292)

```ts
export interface PresentCredentialsOptions extends PresentOpts {
    signal?: AbortSignal;
}
```

Fields:

- **` signal `**: Cancel pending wallet presentation work.
- **` fetchImpl `**: HTTP transport override; defaults to the global fetch implementation.
- **` choose `**: Pick among the candidates (default: the evaluator's choice). Return `undefined` to abort.
- **` disclose `**: Claim names to disclose, or all; defaults to the selected query's requested claims.
- **` resolveKey `**: Resolver supplying a trusted public key for the request issuer and key identifier.
- **` nowSecs `**: Current time override in Unix seconds.
- **` leewaySecs `**: Seconds of clock skew tolerated on `exp`.

### ReadySlotJournal

Private creation journal tracking rule delivery and verifier-policy installation.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/ready-slot.ts#L98)

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

### ReconcileApplicationReservationOptions

Options for [reconcileApplicationReservation](#reconcileapplicationreservation).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-reservation.ts#L162)

```ts
export interface ReconcileApplicationReservationOptions {
    payer?: Address;
    confirmations?: number;
}
```

Fields:

- **` payer `**: Gas payer the request would use. Needed when no journal exists, to prove the payer holds no claim for it; with a journal the payer is read from the journaled transaction.
- **` confirmations `**: Observation depth below the head, 1..64 (default 1).

### RecoveredIbePartial

One contributor's recovered extraction partial.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-operation.ts#L202)

```ts
export interface RecoveredIbePartial {
    keeper: PaidKeeperEndpoint;
    partial: IbeExtractionPartial;
    recovered: RecoveredKeeperExecution;
}
```

Fields:

- **` keeper `**: Assigned contributor, with its approved (routed) URL.
- **` partial `**: Decoded partial, in the shape the IBE combine helpers accept.
- **` recovered `**: Signed execution evidence and exact retained bytes.

### RecoveredIbePartials

Result of ` PaidOperation.recoverIbePartials `.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-operation.ts#L212)

```ts
export interface RecoveredIbePartials {
    threshold: number;
    partials: RecoveredIbePartial[];
    failures: {
        operator: Address;
        message: string;
    }[];
}
```

Fields:

- **` threshold `**: Keeper threshold from the payment's assignment.
- **` partials `**: At least `threshold` recovered partials, from distinct contributors.
- **` failures `**: Contributors whose retained result could not be read (operator and a safe message).

### RecoverIbePartialsOptions

Options for ` PaidOperation.recoverIbePartials `.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-operation.ts#L158)

```ts
export interface RecoverIbePartialsOptions {
    transport: KeeperRecoveryTransport;
    signal?: AbortSignal;
    concurrency?: number;
}
```

Fields:

- **` transport `**: Caller-approved guarded keeper recovery transport.
- **` signal `**: Cancellation for the whole recovery; each keeper read also has its own 60-second deadline.
- **` concurrency `**: Contributors read at once, 1..16 (default 4). No new read starts after the threshold is met.

### RefreshPaidStatusOptions

Options for ` PaidOperation.refreshStatus ` and ` PaidOperationRecovery.refreshStatus `.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-operation.ts#L168)

```ts
export interface RefreshPaidStatusOptions {
    via?: 'agent' | {
        verifiers: readonly {
            index: number;
            url: string;
        }[];
        fetch?: typeof fetch;
    };
    holder?: StatusRefreshHolderSigner;
    signal?: AbortSignal;
}
```

Fields:

- **` via `**: Route: `'agent'` (default) relays through the original session of the approved verifier-agent (journals written before the SDK recorded the session id cannot use it); `{verifiers}` calls the original signers' verifiers directly. Either way every answer is verified here under the anchored roster keys of the signers that verified the original token.
- **` holder `**: Prove with the holder key recorded at issuance (`holder_key`) instead of the creator-certified client execution key (`client_execution`, the default).
- **` signal `**: Cancellation. An abort after the `seq` was journaled still consumes it.

### ResolveApplicationManifestOptions

Explicit RPC and coordinator choices applied when resolving a network manifest.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/manifest.ts#L25)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/manifest.ts#L36)

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

### ResumePaidOperationOptions

Options shared by [resumePaidOperation](#resumepaidoperation) and [reconcilePaidOperation](#reconcilepaidoperation).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-operation.ts#L940)

```ts
export interface ResumePaidOperationOptions {
    holder?: PaidSessionHolder;
    transactionHash?: Hex;
    signal?: AbortSignal;
    observeRequest?(request: VerifiedRequestObject): void | Promise<void>;
    confirmations?: number;
    reconcileOnly?: boolean;
}
```

Fields:

- **` holder `**: Holder strategy, needed while the session is unfinished.
- **` transactionHash `**: A located original reservation transaction hash, when none was journaled; speeds a proof before the quote deadline.
- **` signal `**: Cancellation.
- **` observeRequest `**: Inspect the verified request object before any credential is disclosed.
- **` confirmations `**: Chain observation depth for reservation reconciliation, 1..64 (default 1).
- **` reconcileOnly `**: Only reconcile: never reserve, never drive the session, never execute. Returns the [PaidOperationStatus](#paidoperationstatus) instead of a handle. Same as [reconcilePaidOperation](#reconcilepaidoperation).

### SelectApplicationGasPayerOptions

Options for [selectApplicationGasPayer](#selectapplicationgaspayer).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/paid-reservation.ts#L263)

```ts
export interface SelectApplicationGasPayerOptions {
    resume?: Hex;
}
```

Fields:

- **` resume `**: Resuming this paid operation: return the gas payer its journal recorded, whatever its claim state (a reserving operation usually holds that payer's claim itself; resume reconciles it). Throws when the recorded payer is not in the pool. Falls back to normal selection for an operation journaled before payers were recorded, or with no journal.

### SlotCreationJournal

Private durable creation intent and transaction progress required to resume the same slot.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/creation.ts#L11)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/ready-slot.ts#L121)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L112)

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

### TasraApplication

Application client exposing checked slot operations and deployment readiness probes.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L398)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L97)

```ts
export interface TasraApplicationConfig {
    allowLocalPaidHttp?: boolean;
    deployment: TasraDeployment;
    chain?: TasraChainClient;
    keeperUrl?: (registeredUrl: string) => string;
    fetchImpl?: typeof fetch;
}
```

Fields:

- **` allowLocalPaidHttp `**: Permit paid keeper HTTP only on local chain43112; otherwise HTTPS is required.
- **` deployment `**: Application-approved chain, registry and coordinator configuration.
- **` chain `**: Reuse the read client in an existing app. Its actual chain is checked before use.
- **` keeperUrl `**: Caller-approved routing, e.g. local Docker hostnames to published loopback ports.
- **` fetchImpl `**: HTTP implementation used for keeper operation requests.

### TasraClientOptions

Network manifest and optional wallet, storage and transport adapters for an application.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/tasra-client.ts#L11)

```ts
export interface TasraClientOptions extends ResolveApplicationManifestOptions {
    allowLocalPaidHttp?: boolean;
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

- **` allowLocalPaidHttp `**: Permit paid keeper HTTP only on the explicitly selected local chain43112.
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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/deployment.ts#L5)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/identity.ts#L16)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/wallet.ts#L74)

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

### VerifyCredentialOptions

Optional issuer, holder, type and subject pins applied during credential verification.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/identity.ts#L170)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/wallet.ts#L14)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/wallet.ts#L37)

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
