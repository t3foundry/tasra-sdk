# tasra-sdk/app

Generated from public TypeScript exports.

[SDK reference](README.md) · [Task guides](../README.md) · [Errors](../errors.md)

## Classes

Clients, adapters and error classes.

<details>
<summary>Browse 4 classes</summary>

- [TasraClient](#tasraclient)
- [ApplicationSlotRecoveryError](#applicationslotrecoveryerror)
- [CreationReconciliationRequiredError](#creationreconciliationrequirederror)
- [TasraApplicationError](#tasraapplicationerror)

</details>

### TasraClient

Manifest-first application API. Construction validates configuration without network I/O.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/tasra-client.ts#L65)

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

### TasraApplicationError

An application operation rejected because its deployment, slot, authorization or result failed validation.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L28)

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
<summary>Browse 21 functions</summary>

- [approveWithCredential](#approvewithcredential)
- [connectWallet](#connectwallet)
- [createApplicationSlot](#createapplicationslot)
- [createIdentity](#createidentity)
- [createLocalWallet](#createlocalwallet)
- [createPreparedSlot](#createpreparedslot)
- [createSlotWallet](#createslotwallet)
- [createTasra](#createtasra)
- [credentialAuthorization](#credentialauthorization)
- [credentialPolicy](#credentialpolicy)
- [defineDeployment](#definedeployment)
- [identityApprover](#identityapprover)
- [issueCredential](#issuecredential)
- [loadApplicationManifest](#loadapplicationmanifest)
- [prepareSlot](#prepareslot)
- [presentCredentials](#presentcredentials)
- [registeredWalletAuthorization](#registeredwalletauthorization)
- [resolveApplicationManifest](#resolveapplicationmanifest)
- [setApprovalPolicy](#setapprovalpolicy)
- [toViemAccount](#toviemaccount)
- [verifyCredential](#verifycredential)

</details>

### approveWithCredential

Present a credential for this exact request, then sign its canonical approval payload.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/approvals.ts#L89)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/ready-slot.ts#L190)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L121)

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
            }): Promise<{
                create(message: Uint8Array, options?: {
                    signal?: AbortSignal;
                }): Promise<DualSignRequest>;
                resume(requestId: string, expectedMessage: Uint8Array): DualSignRequest;
            }>;
        }>;
        bls(slotId: Hex): Promise<{
            slotId: `0x${string}`;
            encrypt(identity: string, plaintext: Uint8Array): Promise<IbeCiphertext>;
            decrypt(identity: string, ciphertext: IbeCiphertext, options: AuthorizedOperationOptions & {
                requireReceipts?: boolean;
            }): Promise<Omit<StrictExtractionResult, "key"> & {
                plaintext: Uint8Array;
            }>;
            extractIdentity(identity: string, options: AuthorizedOperationOptions & {
                requireReceipts?: boolean;
            }): Promise<StrictExtractionResult>;
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
            }): Promise<{
                create(message: Uint8Array, options?: {
                    signal?: AbortSignal;
                }): Promise<DualSignRequest>;
                resume(requestId: string, expectedMessage: Uint8Array): DualSignRequest;
            }>;
        }>;
        bls(slotId: Hex): Promise<{
            slotId: `0x${string}`;
            encrypt(identity: string, plaintext: Uint8Array): Promise<IbeCiphertext>;
            decrypt(identity: string, ciphertext: IbeCiphertext, options: AuthorizedOperationOptions & {
                requireReceipts?: boolean;
            }): Promise<Omit<StrictExtractionResult, "key"> & {
                plaintext: Uint8Array;
            }>;
            extractIdentity(identity: string, options: AuthorizedOperationOptions & {
                requireReceipts?: boolean;
            }): Promise<StrictExtractionResult>;
        }>;
    };
}
```

Return details: A client with read-only checks and authorized slot operations.

### credentialAuthorization

Authorize one exact SDK operation: sign its request, present a credential, collect bound proofs.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/identity.ts#L368)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/identity.ts#L252)

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

### identityApprover

Adapt an SDK Ed25519 identity to native approval signatures without exporting its key.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/approvals.ts#L70)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/identity.ts#L142)

Import: `import {issueCredential} from 'tasra-sdk/app'`

```ts
declare function issueCredential(options: IssueCredentialOptions): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` options ` | ` IssueCredentialOptions ` | Issuer, holder, credential type, application claims and lifetime. |

Returns: ` string `.

Return details: Serialized holder-bound SD-JWT credential.

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/identity.ts#L300)

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

### registeredWalletAuthorization

Request-bound authorization through an independently approved registered agent.
`present` displays a QR/deep link or runs the application's credential wallet.
It never changes the selected provider or transfers a presentation to a fallback.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/authorization.ts#L13)

Import: `import {registeredWalletAuthorization} from 'tasra-sdk/app'`

```ts
declare function registeredWalletAuthorization(config: {
    client: ReturnType<typeof createRegisteredAgentClient>;
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
    client: ReturnType<typeof createRegisteredAgentClient>;
    signer: TypedDataSigner;
    delegation?: PresentationDelegation;
    present: (session: RegisteredVerifierAgentSession, signal?: AbortSignal) => Promise<void>;
    onPhase?: (phase: SessionPhase) => void;
    timeoutMs?: number;
}
```

Returns: ` OperationAuthorizer `.

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

### setApprovalPolicy

Install an explicit native FROST approval policy using a durable named transaction.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/approvals.ts#L36)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/identity.ts#L193)

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

## Types

Options, data structures and return types.

<details>
<summary>Browse 36 types</summary>

- [ApplicationDeployment](#applicationdeployment)
- [ApplicationErrorCode](#applicationerrorcode)
- [ApplicationManifest](#applicationmanifest)
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
- [IssueCredentialOptions](#issuecredentialoptions)
- [LoadApplicationManifestOptions](#loadapplicationmanifestoptions)
- [OperationAuthorizer](#operationauthorizer)
- [OperationGrant](#operationgrant)
- [PresentCredentialsOptions](#presentcredentialsoptions)
- [ReadySlotJournal](#readyslotjournal)
- [ResolveApplicationManifestOptions](#resolveapplicationmanifestoptions)
- [ResolvedApplicationManifest](#resolvedapplicationmanifest)
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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L24)

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
}
```

Fields:

- **` load `**: Load a saved value, or return undefined when the key does not exist.
- **` save `**: Atomically persist private state before resolving.
- **` withLock `**: Exclusively serialize work for the key across all participating processes or tabs.

### ApprovalPolicy

Required approval count and either trusted Ed25519 keys or a credential rule.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/approvals.ts#L18)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L44)

```ts
export type AuthorizationRequest = Readonly<OperationInput & {
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
- **` signal `**: Cancellation signal propagated to the authorization provider.

### AuthorizedOperationOptions

Authorization callback, consent description and cancellation controls for a protected operation.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L53)

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

Identity-based encryption handle with authorized decryption and explicit identity-key extraction.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L325)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/ready-slot.ts#L55)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/ready-slot.ts#L122)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/tasra-client.ts#L42)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/identity.ts#L327)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/identity.ts#L228)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L317)

```ts
export type EcdsaSlot = Awaited<ReturnType<TasraApplication['slots']['ecdsa']>>;
```

Fields:

- **` slotId `**: Identifier of the threshold ECDSA slot.
- **` getAddress `**: Recheck slot readiness and derive its Ethereum address from the current public key.
- **` signDigest `**: Authorize and sign an exact 32-byte Ethereum digest, then verify the recovered account.

### FrostSlot

Threshold Ed25519 signing handle with optional receipt checks and native approval sessions.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L321)

```ts
export type FrostSlot = Awaited<ReturnType<TasraApplication['slots']['frost']>>;
```

Fields:

- **` slotId `**: Identifier of the FROST signing slot.
- **` sign `**: Authorize the exact message and verify the returned signature, epoch and optional receipt.
- **` approvals `**: Quorum and approval mode must come from the application's independently pinned policy.

### IssueCredentialOptions

Issuer, holder and claims for a signed, expiring SD-JWT credential.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/identity.ts#L110)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L49)

```ts
export type OperationAuthorizer = (request: AuthorizationRequest) => Promise<OperationGrant>;
```

### OperationGrant

Holder-bound committee token and verifier membership proofs for one operation.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L35)

```ts
export interface OperationGrant {
    token: CompoundTokenWire;
    verifierProofs: VerifierProof[];
}
```

Fields:

- **` token `**: Fresh compound verifier token bound to the holder and exact operation.
- **` verifierProofs `**: Membership proofs for the verifiers that authorized the operation.

### PresentCredentialsOptions

Credential selection, request validation and cancellation controls for OID4VP presentation.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/identity.ts#L284)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/ready-slot.ts#L86)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/ready-slot.ts#L109)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L87)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L313)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L74)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/tasra-client.ts#L11)

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/identity.ts#L162)

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
