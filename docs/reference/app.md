# tasra-sdk/app

Generated from public TypeScript exports.

[Reference index](README.md) · [Task guides](../README.md) · [Errors](../errors.md)

<details>
<summary>Find an export</summary>

- [ApplicationErrorCode](#applicationerrorcode)
- [AuthorizationRequest](#authorizationrequest)
- [AuthorizedOperationOptions](#authorizedoperationoptions)
- [BlsSlot](#blsslot)
- [createPreparedSlot](#createpreparedslot)
- [createTasra](#createtasra)
- [CreationReconciliationRequiredError](#creationreconciliationrequirederror)
- [defineDeployment](#definedeployment)
- [EcdsaSlot](#ecdsaslot)
- [FrostSlot](#frostslot)
- [OperationAuthorizer](#operationauthorizer)
- [OperationGrant](#operationgrant)
- [prepareSlot](#prepareslot)
- [registeredWalletAuthorization](#registeredwalletauthorization)
- [SlotCreationJournal](#slotcreationjournal)
- [SlotMetadata](#slotmetadata)
- [TasraApplication](#tasraapplication)
- [TasraApplicationConfig](#tasraapplicationconfig)
- [TasraApplicationError](#tasraapplicationerror)
- [TasraDeployment](#tasradeployment)
- [toViemAccount](#toviemaccount)

</details>

## ApplicationErrorCode

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L21)

```ts
export type ApplicationErrorCode = 'CHAIN_MISMATCH' | 'SLOT_NOT_FOUND' | 'SLOT_CANCELLED' | 'WRONG_SLOT_MODE' | 'KEY_NOT_READY' | 'SLOT_CHANGED' | 'INVALID_AUTHORIZATION' | 'INVALID_RESULT'
```

## AuthorizationRequest

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L27)

```ts
export type AuthorizationRequest = Readonly<OperationInput & {signal?: AbortSignal}>
```

## AuthorizedOperationOptions

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L30)

```ts
export interface AuthorizedOperationOptions {
  authorize: OperationAuthorizer
  description?: string
  signal?: AbortSignal
  userSignature?: Uint8Array
}
```

## BlsSlot

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L206)

```ts
export type BlsSlot = Awaited<ReturnType<TasraApplication['slots']['bls']>>
```

## createPreparedSlot

Create or resume ONE persisted intent. The store must atomically save each snapshot
before resolving and serialize runs for this intent (one process/tab at a time).
Known transaction hashes are waited on, never resubmitted. If a transport or crash
loses a submission hash, reconcile with the wallet before resuming. Abort stops local
work; it cannot cancel a transaction already submitted to the network.
Returns after on-chain creation; DKG and creator provisioning are separate stages.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/creation.ts#L43)

Import: `import {createPreparedSlot} from 'tasra-sdk/app'`

```ts
declare function createPreparedSlot(input: SlotCreationJournal, config: { wallet: WriteClientWalletConfig["wallet"]; persist: (journal: SlotCreationJournal) => Promise<void>; options?: Omit<CommitRevealOptions, "recovery">; }): Promise<SlotCreationJournal>
```

| Parameter | Type | Description |
|---|---|---|
| `input` | `SlotCreationJournal` |  |
| `config` | `{ wallet: WriteClientWalletConfig["wallet"]; persist: (journal: SlotCreationJournal) => Promise<void>; options?: Omit<CommitRevealOptions, "recovery">; }` |  |

Returns: `Promise<SlotCreationJournal>`.

## createTasra

Configure one application client. Construction does no I/O and holds no wallet credentials.
Start with `await tasra.slots.ecdsa(slotId)` and `await account.getAddress()`;
provide an authorizer only when signing or decrypting.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L58)

Import: `import {createTasra} from 'tasra-sdk/app'`

```ts
declare function createTasra(config: TasraApplicationConfig): { deployment: Readonly<TasraDeployment>; chain: TasraChainClient; check(): Promise<{ chainId: number; registries: { name: "NodeRegistry" | "KeyRegistry"; deployed: boolean; }[]; ready: boolean; authorization: "unknown"; nativeMultiApproverIbe: "unsupported"; taskContextEnforcement: "unsupported"; }>; slots: { get: (slotId: Hex) => Promise<SlotMetadata>; ecdsa(slotId: Hex): Promise<{ slotId: `0x${string}`; getAddress: () => Promise<`0x${string}`>; signDigest(input: Uint8Array, options: AuthorizedOperationOptions): Promise<EoaSignature>; }>; frost(slotId: Hex): Promise<{ slotId: `0x${string}`; sign(input: Uint8Array, options: AuthorizedOperationOptions & { requireReceipt?: boolean; }): Promise<{ receiptStatus: "verified" | "absent"; receipt?: OperationReceipt; keySlotId: string; groupPublicKey: Uint8Array; signature: FrostSignature; messageSha256: Uint8Array; epoch: number; }>; approvals(policy: { quorum: number; credentialGated: boolean; }): Promise<{ create(message: Uint8Array, options?: { signal?: AbortSignal; }): Promise<DualSignRequest>; resume(requestId: string, expectedMessage: Uint8Array): DualSignRequest; }>; }>; bls(slotId: Hex): Promise<{ slotId: `0x${string}`; encrypt(identity: string, plaintext: Uint8Array): Promise<IbeCiphertext>; decrypt(identity: string, ciphertext: IbeCiphertext, options: AuthorizedOperationOptions & { requireReceipts?: boolean; }): Promise<Omit<StrictExtractionResult, "key"> & { plaintext: Uint8Array; }>; extractIdentity(identity: string, options: AuthorizedOperationOptions & { requireReceipts?: boolean; }): Promise<StrictExtractionResult>; }>; }; }
```

| Parameter | Type | Description |
|---|---|---|
| `config` | `TasraApplicationConfig` |  |

Returns: `{ deployment: Readonly<TasraDeployment>; chain: TasraChainClient; check(): Promise<{ chainId: number; registries: { name: "NodeRegistry" | "KeyRegistry"; deployed: boolean; }[]; ready: boolean; authorization: "unknown"; nativeMultiApproverIbe: "unsupported"; taskContextEnforcement: "unsupported"; }>; slots: { get: (slotId: Hex) => Promise<SlotMetadata>; ecdsa(slotId: Hex): Promise<{ slotId: `0x${string}`; getAddress: () => Promise<`0x${string}`>; signDigest(input: Uint8Array, options: AuthorizedOperationOptions): Promise<EoaSignature>; }>; frost(slotId: Hex): Promise<{ slotId: `0x${string}`; sign(input: Uint8Array, options: AuthorizedOperationOptions & { requireReceipt?: boolean; }): Promise<{ receiptStatus: "verified" | "absent"; receipt?: OperationReceipt; keySlotId: string; groupPublicKey: Uint8Array; signature: FrostSignature; messageSha256: Uint8Array; epoch: number; }>; approvals(policy: { quorum: number; credentialGated: boolean; }): Promise<{ create(message: Uint8Array, options?: { signal?: AbortSignal; }): Promise<DualSignRequest>; resume(requestId: string, expectedMessage: Uint8Array): DualSignRequest; }>; }>; bls(slotId: Hex): Promise<{ slotId: `0x${string}`; encrypt(identity: string, plaintext: Uint8Array): Promise<IbeCiphertext>; decrypt(identity: string, ciphertext: IbeCiphertext, options: AuthorizedOperationOptions & { requireReceipts?: boolean; }): Promise<Omit<StrictExtractionResult, "key"> & { plaintext: Uint8Array; }>; extractIdentity(identity: string, options: AuthorizedOperationOptions & { requireReceipts?: boolean; }): Promise<StrictExtractionResult>; }>; }; }`.

## CreationReconciliationRequiredError

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/creation.ts#L17)

```ts
(slotId: Hex, step: "commit" | "reveal"): CreationReconciliationRequiredError
```

Import: `import {CreationReconciliationRequiredError} from 'tasra-sdk/app'`

- `slotId: \`0x${string}\``
- `step: "commit" &#124; "reveal"`
- `retryable: boolean` — `false` when retrying the identical request cannot succeed.
- `name: string`
- `message: string`
- `stack: string &#124; undefined`
- `cause: unknown`

## defineDeployment

Validate a caller-approved descriptor. This does not establish its authenticity.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/deployment.ts#L18)

Import: `import {defineDeployment} from 'tasra-sdk/app'`

```ts
declare function defineDeployment(value: TasraDeployment): Readonly<TasraDeployment>
```

| Parameter | Type | Description |
|---|---|---|
| `value` | `TasraDeployment` |  |

Returns: `Readonly<TasraDeployment>`.

## EcdsaSlot

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L204)

```ts
export type EcdsaSlot = Awaited<ReturnType<TasraApplication['slots']['ecdsa']>>
```

## FrostSlot

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L205)

```ts
export type FrostSlot = Awaited<ReturnType<TasraApplication['slots']['frost']>>
```

## OperationAuthorizer

Called once for the exact operation. Applications display the wallet request here.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L29)

```ts
export type OperationAuthorizer = (request: AuthorizationRequest) => Promise<OperationGrant>
```

## OperationGrant

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L26)

```ts
export interface OperationGrant {token: CompoundTokenWire; verifierProofs: VerifierProof[]}
```

## prepareSlot

Prepare without I/O. Save this private journal durably before requesting creation.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/creation.ts#L24)

Import: `import {prepareSlot} from 'tasra-sdk/app'`

```ts
declare function prepareSlot(deployment: TasraDeployment, creator: Address, input: CreateSlotArgs): SlotCreationJournal
```

| Parameter | Type | Description |
|---|---|---|
| `deployment` | `TasraDeployment` |  |
| `creator` | `\`0x${string}\`` |  |
| `input` | `CreateSlotArgs` |  |

Returns: `SlotCreationJournal`.

## registeredWalletAuthorization

Request-bound authorization through an independently approved registered agent.
`present` displays a QR/deep link or runs the application's credential wallet.
It never changes the selected provider or transfers a presentation to a fallback.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/authorization.ts#L12)

Import: `import {registeredWalletAuthorization} from 'tasra-sdk/app'`

```ts
declare function registeredWalletAuthorization(config: { client: ReturnType<typeof createRegisteredAgentClient>; signer: TypedDataSigner; delegation?: PresentationDelegation; present: (session: RegisteredVerifierAgentSession, signal?: AbortSignal) => Promise<void>; onPhase?: (phase: SessionPhase) => void; timeoutMs?: number; }): OperationAuthorizer
```

| Parameter | Type | Description |
|---|---|---|
| `config` | `{ client: ReturnType<typeof createRegisteredAgentClient>; signer: TypedDataSigner; delegation?: PresentationDelegation; present: (session: RegisteredVerifierAgentSession, signal?: AbortSignal) => Promise<void>; onPhase?: (phase: SessionPhase) => void; timeoutMs?: number; }` |  |

Returns: `OperationAuthorizer`.

## SlotCreationJournal

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/creation.ts#L7)

```ts
export interface SlotCreationJournal {
  schemaVersion: 1
  deployment: TasraDeployment
  creator: Address
  /** Private durable data: includes the rule and its salt. Do not put in public evidence. */
  intent: CreateSlotArgs & {slotId: Hex; salt: Hex; ruleSalt: Hex}
  commit?: {phase: 'submitting' | 'submitted' | 'confirmed'; hash?: Hex}
  reveal?: {phase: 'submitting' | 'submitted' | 'confirmed'; hash?: Hex; seeded?: boolean}
  result?: Awaited<ReturnType<TasraWriteClient['createSlotCommitReveal']>>
}
```

## SlotMetadata

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L44)

```ts
export interface SlotMetadata {
  slotId: Hex
  mode: number
  epoch: number
  threshold: {k: number; n: number}
  publicKey: Hex
  ready: boolean
}
```

## TasraApplication

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L203)

```ts
export type TasraApplication = ReturnType<typeof createTasra>
```

## TasraApplicationConfig

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L36)

```ts
export interface TasraApplicationConfig {
  deployment: TasraDeployment
  /** Reuse the read client in an existing app. Its actual chain is checked before use. */
  chain?: TasraChainClient
  /** Caller-approved routing, e.g. local Docker hostnames to published loopback ports. */
  keeperUrl?: (registeredUrl: string) => string
  fetchImpl?: typeof fetch
}
```

## TasraApplicationError

See the declaration and linked source for the contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/client.ts#L22)

```ts
(code: ApplicationErrorCode, message: string): TasraApplicationError
```

Import: `import {TasraApplicationError} from 'tasra-sdk/app'`

- `code: ApplicationErrorCode`
- `retryable: boolean` — `false` when retrying the identical request cannot succeed.
- `name: string`
- `message: string`
- `stack: string &#124; undefined`
- `cause: unknown`

## TasraDeployment

Public, versioned application configuration. Never contains credentials or private keys.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/deployment.ts#L5)

```ts
export interface TasraDeployment {
  schemaVersion: 1
  name: string
  chainId: number
  rpcUrl: string
  addresses: AddressBook
  /** Explicit coordinator convention of the tested network build. */
  coordinator: 'lowest-operator-id' | 'assigned-first'
  /** Optional immutable deployment provenance; an active manifest alone is not readiness. */
  provenance?: {networkRevision: string; manifestSha256?: string}
}
```

## toViemAccount

Use a Tasra slot as a viem account. Every signing call gets fresh authorization;
this adapter never broadcasts a transaction. Pass it to viem's createWalletClient.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/viem.ts#L11)

Import: `import {toViemAccount} from 'tasra-sdk/app'`

```ts
declare function toViemAccount(slot: EcdsaSlot, options: AuthorizedOperationOptions): Promise<LocalAccount>
```

| Parameter | Type | Description |
|---|---|---|
| `slot` | `{ slotId: \`0x${string}\`; getAddress: () => Promise<\`0x${string}\`>; signDigest(input: Uint8Array, options: AuthorizedOperationOptions): Promise<EoaSignature>; }` |  |
| `options` | `AuthorizedOperationOptions` |  |

Returns: `Promise<{ address: Address; nonceManager?: NonceManager | undefined; sign?: ((parameters: { hash: Hash; }) => Promise<Hex>) | undefined | undefined; signAuthorization?: ((parameters: AuthorizationRequest) => Promise<SignAuthorizationReturnType>) | undefined | undefined; signMessage: ({ message }: { message: SignableMessage; }) => Promise<Hex>; signTransaction: <serializer extends SerializeTransactionFn<TransactionSerializable> = SerializeTransactionFn<TransactionSerializable>, transaction extends Parameters<serializer>[0] = Parameters<serializer>[0]>(transaction: transaction, options?: { serializer?: serializer | undefined; } | undefined) => Promise<Hex>; signTypedData: <const typedData extends TypedData | Record<string, unknown>, primaryType extends keyof typedData | "EIP712Domain" = keyof typedData>(parameters: TypedDataDefinition<typedData, primaryType>) => Promise<Hex>; publicKey: Hex; source: string; type: "local"; }>`.

