# tasra-sdk/chain

Generated from public TypeScript exports.

[SDK reference](README.md) · [Task guides](../README.md) · [Errors](../errors.md)

## Classes

Clients, adapters and error classes.

<details>
<summary>Browse 3 classes</summary>

- [AgentSessionCreationUnknownError](#agentsessioncreationunknownerror)
- [RelayOutcomeUnknownError](#relayoutcomeunknownerror)
- [SlotCommitmentExpiredError](#slotcommitmentexpirederror)

</details>

### AgentSessionCreationUnknownError

Session creation may have reached the provider, so automatic retry is unsafe.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/registeredAgent.ts#L45)

Import: `import {AgentSessionCreationUnknownError} from 'tasra-sdk/chain'`

```ts
declare class AgentSessionCreationUnknownError {
    constructor(profile: Readonly<ApprovedAgentProfile>);
}
```

- ` readonly profile: Readonly<ApprovedAgentProfile>; ` — Approved verifier-agent profile whose session creation outcome is unknown.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

### RelayOutcomeUnknownError

A relay request has no verified terminal result and must be reconciled before replacement.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/registeredRelay.ts#L111)

Import: `import {RelayOutcomeUnknownError} from 'tasra-sdk/chain'`

```ts
declare class RelayOutcomeUnknownError {
    constructor(attempt: RelayAttempt, reason?: string);
}
```

- ` readonly attempt: RelayAttempt; ` — Persisted signed relay attempt whose execution outcome remains unknown.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

### SlotCommitmentExpiredError

A creation may keep its slot/rule inputs, but needs a durably saved new commit salt.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/commitmentRecovery.ts#L7)

Import: `import {SlotCommitmentExpiredError} from 'tasra-sdk/chain'`

```ts
declare class SlotCommitmentExpiredError {
    constructor(chainId: number, keyRegistry: Address, slotId: Hex, commitment: Hex, creator: Address, salt: Hex);
}
```

- ` readonly chainId: number; ` — Chain containing the expired creation commitment.

- ` readonly keyRegistry: Address; ` — KeyRegistry contract that stores the commitment.

- ` readonly slotId: Hex; ` — Slot identifier reserved by the original creation intent.

- ` readonly commitment: Hex; ` — Expired commit-reveal commitment hash.

- ` readonly creator: Address; ` — Account that submitted the original commitment.

- ` readonly salt: Hex; ` — Original private commit salt; preserve it until outstanding requests are reconciled.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

## Functions

Operations you can import and call.

<details>
<summary>Browse 57 functions</summary>

- [addressBookFromBroadcast](#addressbookfrombroadcast)
- [addressBookFromEnv](#addressbookfromenv)
- [addressBookFromManifest](#addressbookfrommanifest)
- [addressBookFromObject](#addressbookfromobject)
- [applicationServiceProfilesDocument](#applicationserviceprofilesdocument)
- [assertEurcFaucetAllowed](#asserteurcfaucetallowed)
- [assertExpiredSlotCommitment](#assertexpiredslotcommitment)
- [assertRegisteredWalletRequest](#assertregisteredwalletrequest)
- [authenticateApprovedService](#authenticateapprovedservice)
- [awaitRegisteredVerifierAgentResult](#awaitregisteredverifieragentresult)
- [categoryFor](#categoryfor)
- [createCommitteeSlotClient](#createcommitteeslotclient)
- [createRegisteredAgentClient](#createregisteredagentclient)
- [createRegisteredRelaySubmitter](#createregisteredrelaysubmitter)
- [createTasraChainClient](#createtasrachainclient)
- [createTasraSlotClient](#createtasraslotclient)
- [createTasraWriteClient](#createtasrawriteclient)
- [decodeContractLogs](#decodecontractlogs)
- [deriveServiceId](#deriveserviceid)
- [encodeServiceChallenge](#encodeservicechallenge)
- [encodeServiceManifest](#encodeservicemanifest)
- [eventNamesOf](#eventnamesof)
- [formatBps](#formatbps)
- [formatUnits](#formatunits)
- [formatWad](#formatwad)
- [generateClientKey](#generateclientkey)
- [hashServiceManifest](#hashservicemanifest)
- [jsonSafe](#jsonsafe)
- [networkNameForChain](#networknameforchain)
- [observeNetworkManifest](#observenetworkmanifest)
- [openRegisteredVerifierAgentSession](#openregisteredverifieragentsession)
- [parseApplicationServiceProfiles](#parseapplicationserviceprofiles)
- [parseNetworkManifest](#parsenetworkmanifest)
- [parsePinnedNetworkManifest](#parsepinnednetworkmanifest)
- [parsePrometheus](#parseprometheus)
- [parseServiceChallenge](#parseservicechallenge)
- [provisionRule](#provisionrule)
- [provisionRuleTypedData](#provisionruletypeddata)
- [readApprovedServiceRecord](#readapprovedservicerecord)
- [reconcileRelayAttempt](#reconcilerelayattempt)
- [requestSlotSeed](#requestslotseed)
- [requireAddress](#requireaddress)
- [requireVaultAddress](#requirevaultaddress)
- [resolveAccountantUrls](#resolveaccountanturls)
- [resolveNetworkProfile](#resolvenetworkprofile)
- [resolveSlotGroupKey](#resolveslotgroupkey)
- [resolveSlotKeeperUrls](#resolveslotkeeperurls)
- [resolveVerifierDirectory](#resolveverifierdirectory)
- [ruleCommitment](#rulecommitment)
- [serviceChallengeTypedData](#servicechallengetypeddata)
- [truncateHex](#truncatehex)
- [validateServiceChallenge](#validateservicechallenge)
- [validateServiceEndpoint](#validateserviceendpoint)
- [vaultKey](#vaultkey)
- [verifyRuleCommitment](#verifyrulecommitment)
- [verifyServiceIdentity](#verifyserviceidentity)
- [verifyServiceManifest](#verifyservicemanifest)

</details>

### addressBookFromBroadcast

Build an AddressBook from a parsed Foundry broadcast run JSON. The last
deployment of a given contract name wins (re-deploys later in the run
override). Proxied contracts resolve to the proxy, which is the address
callers must actually talk to.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/deployments.ts#L160)

Import: `import {addressBookFromBroadcast} from 'tasra-sdk/chain'`

```ts
declare function addressBookFromBroadcast(json: unknown): AddressBook;
```

| Parameter | Type | Description |
|---|---|---|
| ` json ` | ` unknown ` | Parsed Foundry broadcast artifact containing deployment transactions. |

Returns: ` AddressBook `.

### addressBookFromEnv

Parse supported deployment environment keys or a KEY=VALUE text blob into contract addresses. Empty values and entries that are not valid addresses are ignored. Prefer deployment addresses from a tasra-releases network manifest.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/deployments.ts#L266)

Import: `import {addressBookFromEnv} from 'tasra-sdk/chain'`

```ts
declare function addressBookFromEnv(src: string | Record<string, string | undefined>): AddressBook;
```

| Parameter | Type | Description |
|---|---|---|
| ` src ` | ` string \| Record<string, string \| undefined> ` | Environment key-value object or serialized environment text. |

Returns: ` AddressBook `.

Return details: Address book keyed by canonical contract names.

### addressBookFromManifest

Planned and retired records can be displayed, but cannot configure a live client.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/manifest.ts#L159)

Import: `import {addressBookFromManifest} from 'tasra-sdk/chain'`

```ts
declare function addressBookFromManifest(manifest: NetworkManifest): AddressBook;
```

| Parameter | Type | Description |
|---|---|---|
| ` manifest ` | ` NetworkManifest ` | Network manifest whose lifecycle status must be active. |

Returns: ` AddressBook `.

### addressBookFromObject

Normalise an explicit object into an AddressBook (validates addresses).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/deployments.ts#L290)

Import: `import {addressBookFromObject} from 'tasra-sdk/chain'`

```ts
declare function addressBookFromObject(obj: Record<string, string>): AddressBook;
```

| Parameter | Type | Description |
|---|---|---|
| ` obj ` | ` Record<string, string> ` | Object containing canonical contract names or supported environment aliases. |

Returns: ` AddressBook `.

### applicationServiceProfilesDocument

Publish only public approvals, with no runtime transport or private key material.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/serviceProfiles.ts#L86)

Import: `import {applicationServiceProfilesDocument} from 'tasra-sdk/chain'`

```ts
declare function applicationServiceProfilesDocument(profiles: ApplicationServiceProfiles): Record<string, unknown>;
```

| Parameter | Type | Description |
|---|---|---|
| ` profiles ` | ` ApplicationServiceProfiles ` | Application-approved service profiles to serialize without private runtime data. |

Returns: ` Record<string, unknown> `.

### assertEurcFaucetAllowed

Recheck the actual RPC chain immediately before any faucet transaction.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/networks.ts#L89)

Import: `import {assertEurcFaucetAllowed} from 'tasra-sdk/chain'`

```ts
declare function assertEurcFaucetAllowed(profile: ResolvedNetworkProfile, actualChainId: number, actualEurcAddress: string): void;
```

| Parameter | Type | Description |
|---|---|---|
| ` profile ` | ` ResolvedNetworkProfile ` | Approved network profile and its mock-token faucet policy. |
| ` actualChainId ` | ` number ` | Chain ID read from the RPC immediately before the transaction. |
| ` actualEurcAddress ` | ` string ` | EURC contract address targeted by the mint transaction. |

Returns: ` void `.

### assertExpiredSlotCommitment

Read-only recovery gate. The caller must also reconcile every outstanding signed request.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/commitmentRecovery.ts#L21)

Import: `import {assertExpiredSlotCommitment} from 'tasra-sdk/chain'`

```ts
declare function assertExpiredSlotCommitment(chain: TasraChainClient, error: SlotCommitmentExpiredError): Promise<void>;
```

| Parameter | Type | Description |
|---|---|---|
| ` chain ` | ` TasraChainClient ` | Reader for the deployment owning the expired commitment. |
| ` error ` | ` SlotCommitmentExpiredError ` | Saved commitment context to check before replacing its commit salt. |

Returns: ` Promise<void> `.

### assertRegisteredWalletRequest

Bind the wallet's signed request to the operation and authenticated session before disclosure.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/registeredOperation.ts#L105)

Import: `import {assertRegisteredWalletRequest} from 'tasra-sdk/chain'`

```ts
declare function assertRegisteredWalletRequest(session: RegisteredVerifierAgentSession, ro: VerifiedRequestObject, status: SessionStatusResult): void;
```

| Parameter | Type | Description |
|---|---|---|
| ` session ` | ` RegisteredVerifierAgentSession ` | Authenticated session bound to the creator-authorized operation. |
| ` ro ` | ` VerifiedRequestObject ` | Verified wallet request object whose claims will be presented. |
| ` status ` | ` SessionStatusResult ` | Session status carrying the operation binding preimage. |

Returns: ` void `.

### authenticateApprovedService

Uncached, bounded discovery only. A result is a short-lived observation, not verifier-agent or gas authorization.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L260)

Import: `import {authenticateApprovedService} from 'tasra-sdk/chain'`

```ts
declare function authenticateApprovedService(chain: TasraChainClient, approved: ServiceApproval, transport: ServiceDiscoveryTransport): Promise<AuthenticatedService>;
```

| Parameter | Type | Description |
|---|---|---|
| ` chain ` | ` TasraChainClient ` | Trusted chain reader for the service registry. |
| ` approved ` | ` ServiceApproval ` | Application-approved service identity, revision and manifest hash. |
| ` transport ` | ` ServiceDiscoveryTransport ` | Guarded HTTPS transport for manifest and identity requests. |

Returns: ` Promise<AuthenticatedService> `.

### awaitRegisteredVerifierAgentResult

Poll the original authenticated session only; no URL reconstruction or provider failover.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/registeredOperation.ts#L54)

Import: `import {awaitRegisteredVerifierAgentResult} from 'tasra-sdk/chain'`

```ts
declare function awaitRegisteredVerifierAgentResult(session: RegisteredVerifierAgentSession, opts?: {
    intervalMs?: number;
    timeoutMs?: number;
} & WaitOpts): Promise<VerifierAgentResult>;
```

| Parameter | Type | Description |
|---|---|---|
| ` session ` | ` RegisteredVerifierAgentSession ` | Previously opened authenticated session. |
| ` opts? ` | ` { intervalMs?: number; timeoutMs?: number; } & WaitOpts ` | Polling cadence, deadline, cancellation and phase notifications. |

Returns: ` Promise<VerifierAgentResult> `.

### categoryFor

Choose the event category, including event-specific overrides for a contract.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/events.ts#L70)

Import: `import {categoryFor} from 'tasra-sdk/chain'`

```ts
declare function categoryFor(contract: ContractName, eventName: string): EventCategory;
```

| Parameter | Type | Description |
|---|---|---|
| ` contract ` | ` ContractName ` | Contract that emitted the event. |
| ` eventName ` | ` string ` | Decoded event name used for category overrides. |

Returns: ` EventCategory `.

### createCommitteeSlotClient

Create registry-discovered threshold signing, encryption and decryption operations. Signing and decryption require holder credentials and proofs against an anchored verifier snapshot. Encryption needs only the public group key read from the chain. The master key is not reconstructed by these threshold operations.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/committeeClient.ts#L141)

Import: `import {createCommitteeSlotClient} from 'tasra-sdk/chain'`

```ts
declare function createCommitteeSlotClient(cfg: CommitteeSlotClientConfig): CommitteeSlotClient;
```

| Parameter | Type | Description |
|---|---|---|
| ` cfg ` | ` CommitteeSlotClientConfig ` | Chain reader and optional holder credentials and proof callbacks. |

Returns: ` CommitteeSlotClient `.

Return details: Committee client whose operations each take a slot ID.

### createRegisteredAgentClient

Selection authenticates public metadata first. Once POSTed, never silently switch providers.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/registeredAgent.ts#L90)

Import: `import {createRegisteredAgentClient} from 'tasra-sdk/chain'`

```ts
declare function createRegisteredAgentClient(chain: TasraChainClient, config: {
    profiles: readonly ApprovedAgentProfile[];
    transport: AgentTransport;
}): {
    createSession(params: CreateSessionParams, options?: {
        profileIndex?: number;
        signal?: AbortSignal;
    }): Promise<RegisteredAgentSession>;
};
```

| Parameter | Type | Description |
|---|---|---|
| ` chain ` | ` TasraChainClient ` | Reader for the approved service registry. |
| ` config ` | ` { profiles: readonly ApprovedAgentProfile[]; transport: AgentTransport; } ` | Independently approved provider profiles and guarded HTTP transport. |

Returns:

```ts
{
    createSession(params: CreateSessionParams, options?: {
        profileIndex?: number;
        signal?: AbortSignal;
    }): Promise<RegisteredAgentSession>;
}
```

### createRegisteredRelaySubmitter

One signer per instance. Serializes nonces and blocks new signatures after an uncertain result.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/registeredRelay.ts#L229)

Import: `import {createRegisteredRelaySubmitter} from 'tasra-sdk/chain'`

```ts
declare function createRegisteredRelaySubmitter(chain: TasraChainClient, config: RegisteredRelayConfig, wallet: WalletClient<Transport, Chain, Account>, options?: {
    persistAttempt?: (attempt: RelayAttempt) => Promise<void>;
}): {
    submit: (to: Address, data: Hex, label?: string) => Promise<RelayReceipt>;
    pendingAttempt: () => RelayAttempt | undefined;
    reconcile(): Promise<RelayReconciliation | undefined>;
};
```

| Parameter | Type | Description |
|---|---|---|
| ` chain ` | ` TasraChainClient ` | Trusted chain reader used for nonce and receipt verification. |
| ` config ` | ` RegisteredRelayConfig ` | Approved relay providers, pinned forwarder and recovery controls. |
| ` wallet ` | ` WalletClient<Transport, Chain, Account> ` | Account-bound and chain-bound wallet that signs forward requests. |
| ` options? ` | ` { persistAttempt?: (attempt: RelayAttempt) => Promise<void>; } ` | Optional durable callback invoked before submitting a signed request. |

Returns:

```ts
{
    submit: (to: Address, data: Hex, label?: string) => Promise<RelayReceipt>;
    pendingAttempt: () => RelayAttempt | undefined;
    reconcile(): Promise<RelayReconciliation | undefined>;
}
```

### createTasraChainClient

Create a read-only chain client with typed contract readers and windowed event queries. Configure addresses and the chain ID from a network manifest downloaded from tasra-releases.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/client.ts#L281)

Import: `import {createTasraChainClient} from 'tasra-sdk/chain'`

```ts
declare function createTasraChainClient(cfg: ChainClientConfig): TasraChainClient;
```

| Parameter | Type | Description |
|---|---|---|
| ` cfg ` | ` ChainClientConfig ` | RPC endpoint, deployed addresses, chain ID and optional batching limits. |

Returns: ` TasraChainClient `.

Return details: Client exposing the viem public client, readers, event queries and address book.

### createTasraSlotClient

Create managed JWT sessions using keeper endpoints and a randomly selected verifier discovered from the chain. The verifier authenticates the holder and issues the session token. Session key operations may reconstruct private key material in the client; use threshold committee operations when that custody model is unsuitable.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/slotClient.ts#L78)

Import: `import {createTasraSlotClient} from 'tasra-sdk/chain'`

```ts
declare function createTasraSlotClient(cfg: TasraSlotClientConfig): TasraSlotClient;
```

| Parameter | Type | Description |
|---|---|---|
| ` cfg ` | ` TasraSlotClientConfig ` | Chain reader, holder identity and optional endpoint routing or discovery callback. |

Returns: ` TasraSlotClient `.

Return details: Client that opens and tracks managed slot sessions.

### createTasraWriteClient

Create an account-bound client for slot lifecycle, settlement and token transactions. Use deployed addresses and the chain ID from a tasra-releases network manifest.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/write.ts#L348)

Import: `import {createTasraWriteClient} from 'tasra-sdk/chain'`

```ts
declare function createTasraWriteClient(cfg: WriteClientConfig): TasraWriteClient;
```

| Parameter | Type | Description |
|---|---|---|
| ` cfg ` | ` WriteClientConfig ` | RPC, manifest contract addresses, chain ID and an explicit signing account. |

Returns: ` TasraWriteClient `.

### decodeContractLogs

Decode raw logs (already filtered to `address`) against `contract`'s ABI.
Non-matching / anonymous logs are skipped. `strict:false` tolerates logs
whose indexed topics can't be fully decoded.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/events.ts#L132)

Import: `import {decodeContractLogs} from 'tasra-sdk/chain'`

```ts
declare function decodeContractLogs(contract: ContractName, address: Address, logs: Log[]): DecodedEvent[];
```

| Parameter | Type | Description |
|---|---|---|
| ` contract ` | ` ContractName ` | Contract ABI used to decode each log. |
| ` address ` | ` Address ` | Deployed emitting contract address. |
| ` logs ` | ` Log[] ` | Raw logs carrying topics, data and optional block metadata. |

Returns: ` DecodedEvent[] `.

### deriveServiceId

Matches serviceIdFor on the proxy. Provider transfer does not change this ID.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/services.ts#L95)

Import: `import {deriveServiceId} from 'tasra-sdk/chain'`

```ts
declare function deriveServiceId(chainId: bigint, registry: Address, creator: Address, salt: Hex): Hex;
```

| Parameter | Type | Description |
|---|---|---|
| ` chainId ` | ` bigint ` | EVM chain ID used in the registry identifier domain. |
| ` registry ` | ` Address ` | Deployed ServiceRegistry address. |
| ` creator ` | ` Address ` | Original provider address that registered the service. |
| ` salt ` | ` Hex ` | Provider-chosen 32-byte registration salt. |

Returns: ` Hex `.

### encodeServiceChallenge

Canonical wire encoding accepted by both responder implementations.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L175)

Import: `import {encodeServiceChallenge} from 'tasra-sdk/chain'`

```ts
declare function encodeServiceChallenge(challenge: ServiceChallenge): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` challenge ` | ` ServiceChallenge ` | Validated challenge to encode in the protocol wire format. |

Returns: ` Uint8Array `.

### encodeServiceManifest

Canonical v1 bytes: fixed field order, compact ASCII JSON, one LF. No optional/unknown fields.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L106)

Import: `import {encodeServiceManifest} from 'tasra-sdk/chain'`

```ts
declare function encodeServiceManifest(manifest: ServiceManifest): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` manifest ` | ` ServiceManifest ` | Versioned service metadata to validate and encode canonically. |

Returns: ` Uint8Array `.

### eventNamesOf

The set of event names declared by a contract's ABI.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/events.ts#L84)

Import: `import {eventNamesOf} from 'tasra-sdk/chain'`

```ts
declare function eventNamesOf(contract: ContractName): string[];
```

| Parameter | Type | Description |
|---|---|---|
| ` contract ` | ` ContractName ` | Contract whose vendored ABI supplies the event definitions. |

Returns: ` string[] `.

### formatBps

Format a basis-points integer (e.g. 1000) as a percentage string ("10%").

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/format.ts#L45)

Import: `import {formatBps} from 'tasra-sdk/chain'`

```ts
declare function formatBps(bps: number | bigint): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` bps ` | ` number \| bigint ` | Rate in basis points, where 100 basis points is one percent. |

Returns: ` string `.

### formatUnits

Format a token amount with thousands separators and truncated fractional digits.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/format.ts#L22)

Import: `import {formatUnits} from 'tasra-sdk/chain'`

```ts
declare function formatUnits(value: bigint, decimals?: number, maxFractionDigits?: number): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` value ` | ` bigint ` | Signed integer amount in token base units. |
| ` decimals? ` | ` number ` | Number of decimal places used by the token. |
| ` maxFractionDigits? ` | ` number ` | Maximum fractional digits retained without rounding. |

Returns: ` string `.

### formatWad

WAD (1e18 fixed-point) value to a decimal string, e.g. a price.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/format.ts#L55)

Import: `import {formatWad} from 'tasra-sdk/chain'`

```ts
declare function formatWad(wad: bigint, maxFractionDigits?: number): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` wad ` | ` bigint ` | Signed integer value scaled by 10 to the power of 18. |
| ` maxFractionDigits? ` | ` number ` | Maximum fractional digits retained without rounding. |

Returns: ` string `.

### generateClientKey

Fresh 0x-prefixed 32-byte private key for a new sovereign client account.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/write.ts#L315)

Import: `import {generateClientKey} from 'tasra-sdk/chain'`

```ts
declare function generateClientKey(): Hex;
```

Returns: ` Hex `.

### hashServiceManifest

Hash the exact downloaded/published bytes; never parse and re-serialize before checking.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/services.ts#L120)

Import: `import {hashServiceManifest} from 'tasra-sdk/chain'`

```ts
declare function hashServiceManifest(bytes: Uint8Array): Hex;
```

| Parameter | Type | Description |
|---|---|---|
| ` bytes ` | ` Uint8Array ` | Exact canonical manifest bytes; do not parse and reserialize before hashing. |

Returns: ` Hex `.

### jsonSafe

Recursively convert bigints to strings so a decoded event can be JSON
serialized / stored. Leaves everything else intact.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/events.ts#L168)

Import: `import {jsonSafe} from 'tasra-sdk/chain'`

```ts
declare function jsonSafe<T>(value: T): unknown;
```

| Parameter | Type | Description |
|---|---|---|
| ` value ` | ` T ` | Value to convert recursively, including bigint and byte arrays. |

Returns: ` unknown `.

### networkNameForChain

Map a supported EVM chain ID to its network profile; reject unknown chains.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/networks.ts#L49)

Import: `import {networkNameForChain} from 'tasra-sdk/chain'`

```ts
declare function networkNameForChain(chainId: number): NetworkName;
```

| Parameter | Type | Description |
|---|---|---|
| ` chainId ` | ` number ` | EVM chain ID to resolve to a supported profile. |

Returns: ` NetworkName `.

### observeNetworkManifest

Observe a single finalized block. This verifies code identity, not business wiring or audit quality.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/manifest.ts#L208)

Import: `import {observeNetworkManifest} from 'tasra-sdk/chain'`

```ts
declare function observeNetworkManifest(manifest: NetworkManifest, rpcUrl: string): Promise<{
    chainId: number;
    blockNumber: string;
    blockHash: `0x${string}`;
    observedAt: string;
    contracts: ContractObservation[];
    matches: boolean;
}>;
```

| Parameter | Type | Description |
|---|---|---|
| ` manifest ` | ` NetworkManifest ` | Manifest containing expected deployment addresses and code hashes. |
| ` rpcUrl ` | ` string ` | RPC endpoint for the same chain as the manifest. |

Returns:

```ts
Promise<{
    chainId: number;
    blockNumber: string;
    blockHash: `0x${string}`;
    observedAt: string;
    contracts: ContractObservation[];
    matches: boolean;
}>
```

### openRegisteredVerifierAgentSession

Sign once, authenticate an explicitly approved provider, and retain its pinned poll closure.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/registeredOperation.ts#L33)

Import: `import {openRegisteredVerifierAgentSession} from 'tasra-sdk/chain'`

```ts
declare function openRegisteredVerifierAgentSession(client: ReturnType<typeof createRegisteredAgentClient>, opts: OperationInput & {
    signer: TypedDataSigner;
    delegation?: PresentationDelegation;
    profileIndex?: number;
    signal?: AbortSignal;
}): Promise<RegisteredVerifierAgentSession>;
```

| Parameter | Type | Description |
|---|---|---|
| ` client ` | ` ReturnType<typeof createRegisteredAgentClient> ` | Registered agent client with independently approved providers. |
| ` opts ` | ` OperationInput & { signer: TypedDataSigner; delegation?: PresentationDelegation; profileIndex?: number; signal?: AbortSignal; } ` | Exact operation, authorizing signer and optional delegation or cancellation. |

Returns: ` Promise<RegisteredVerifierAgentSession> `.

### parseApplicationServiceProfiles

Parse the public, JSON-safe deployment approval file. Decimal revisions preserve uint64.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/serviceProfiles.ts#L50)

Import: `import {parseApplicationServiceProfiles} from 'tasra-sdk/chain'`

```ts
declare function parseApplicationServiceProfiles(value: unknown): ApplicationServiceProfiles;
```

| Parameter | Type | Description |
|---|---|---|
| ` value ` | ` unknown ` | Parsed approval object or its JSON text. |

Returns: ` ApplicationServiceProfiles `.

### parseNetworkManifest

Validate data only. Authenticity requires a trusted digest or signature separately.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/manifest.ts#L104)

Import: `import {parseNetworkManifest} from 'tasra-sdk/chain'`

```ts
declare function parseNetworkManifest(value: unknown): NetworkManifest;
```

| Parameter | Type | Description |
|---|---|---|
| ` value ` | ` unknown ` | Untrusted parsed JSON to validate against the supported manifest schema. |

Returns: ` NetworkManifest `.

### parsePinnedNetworkManifest

The digest must come from a verified release checksum file or application pin.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/manifest.ts#L148)

Import: `import {parsePinnedNetworkManifest} from 'tasra-sdk/chain'`

```ts
declare function parsePinnedNetworkManifest(text: string, expectedSha256: string): NetworkManifest;
```

| Parameter | Type | Description |
|---|---|---|
| ` text ` | ` string ` | Exact UTF-8 manifest text downloaded from tasra-releases. |
| ` expectedSha256 ` | ` string ` | Independently trusted lowercase SHA-256 digest of that text. |

Returns: ` NetworkManifest `.

### parsePrometheus

Parse finite numeric Prometheus samples into a map keyed by metric name and labels. Ignore comment lines and nonnumeric values; histogram buckets remain separate samples.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/offchain.ts#L200)

Import: `import {parsePrometheus} from 'tasra-sdk/chain'`

```ts
declare function parsePrometheus(text: string): Record<string, number>;
```

| Parameter | Type | Description |
|---|---|---|
| ` text ` | ` string ` | Prometheus text exposition returned by a metrics endpoint. |

Returns: ` Record<string, number> `.

### parseServiceChallenge

Call only after enforcing the same limit while receiving the HTTP body.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L190)

Import: `import {parseServiceChallenge} from 'tasra-sdk/chain'`

```ts
declare function parseServiceChallenge(bytes: Uint8Array): ServiceChallenge;
```

| Parameter | Type | Description |
|---|---|---|
| ` bytes ` | ` Uint8Array ` | UTF-8 challenge JSON bytes to decode and validate. |

Returns: ` ServiceChallenge `.

### provisionRule

Deliver the clear rule and its salt to every assigned keeper using creator authorization. Throws if any delivery fails; inspect cause.results for individual outcomes.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/provisionRule.ts#L176)

Import: `import {provisionRule} from 'tasra-sdk/chain'`

```ts
declare function provisionRule(chain: TasraChainClient, args: ProvisionRuleArgs): Promise<ProvisionRuleResult>;
```

| Parameter | Type | Description |
|---|---|---|
| ` chain ` | ` TasraChainClient ` | Reader for the deployment that owns the slot. |
| ` args ` | ` ProvisionRuleArgs ` | Rule, saved salt, creator signer and optional transport controls. |

Returns: ` Promise<ProvisionRuleResult> `.

Return details: Commitment and successful delivery results for every selected keeper.

### provisionRuleTypedData

Build the EIP-712 authorization a keeper verifies against the slot creator. The payload digest is the salted rule commitment.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/provisionRule.ts#L122)

Import: `import {provisionRuleTypedData} from 'tasra-sdk/chain'`

```ts
declare function provisionRuleTypedData(input: {
    chainId: number;
    keyRegistry: Address;
    slotId: Hex;
    commitment: Hex;
    description: string;
    exp: number;
}): {
    domain: {
        name: string;
        version: string;
        chainId: number;
        verifyingContract: `0x${string}`;
    };
    types: {
        readonly PresentationOperation: readonly [
            {
                readonly name: "chainId";
                readonly type: "uint256";
            },
            {
                readonly name: "slotId";
                readonly type: "bytes32";
            },
            {
                readonly name: "action";
                readonly type: "string";
            },
            {
                readonly name: "payloadDigest";
                readonly type: "bytes32";
            },
            {
                readonly name: "description";
                readonly type: "string";
            },
            {
                readonly name: "exp";
                readonly type: "uint256";
            }
        ];
    };
    primaryType: "PresentationOperation";
    message: {
        chainId: bigint;
        slotId: `0x${string}`;
        action: string;
        payloadDigest: `0x${string}`;
        description: string;
        exp: bigint;
    };
};
```

| Parameter | Type | Description |
|---|---|---|
| ` input ` | ` { chainId: number; keyRegistry: Address; slotId: Hex; commitment: Hex; description: string; exp: number; } ` | Chain, registry, slot, commitment, consent description and expiry in Unix seconds. |

Returns:

```ts
{
    domain: {
        name: string;
        version: string;
        chainId: number;
        verifyingContract: `0x${string}`;
    };
    types: {
        readonly PresentationOperation: readonly [
            {
                readonly name: "chainId";
                readonly type: "uint256";
            },
            {
                readonly name: "slotId";
                readonly type: "bytes32";
            },
            {
                readonly name: "action";
                readonly type: "string";
            },
            {
                readonly name: "payloadDigest";
                readonly type: "bytes32";
            },
            {
                readonly name: "description";
                readonly type: "string";
            },
            {
                readonly name: "exp";
                readonly type: "uint256";
            }
        ];
    };
    primaryType: "PresentationOperation";
    message: {
        chainId: bigint;
        slotId: `0x${string}`;
        action: string;
        payloadDigest: `0x${string}`;
        description: string;
        exp: bigint;
    };
}
```

Return details: Typed data ready for the creator wallet to sign.

### readApprovedServiceRecord

Read metadata only after matching an explicit application approval. Never contacts the service.
This does not authenticate its endpoint, verify its manifest or authorize a verifier-agent
origin. Those checks must precede sending any credentials, session secrets or transactions.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/services.ts#L165)

Import: `import {readApprovedServiceRecord} from 'tasra-sdk/chain'`

```ts
declare function readApprovedServiceRecord(chain: ServiceRegistryChainReader, approval: ServiceApproval): Promise<{
    record: ServiceRecord;
    blockNumber: bigint;
}>;
```

| Parameter | Type | Description |
|---|---|---|
| ` chain ` | ` ServiceRegistryChainReader ` | Trusted chain reader with ServiceRegistry access. |
| ` approval ` | ` ServiceApproval ` | Independently approved identity, owner, revision and manifest hash. |

Returns:

```ts
Promise<{
    record: ServiceRecord;
    blockNumber: bigint;
}>
```

### reconcileRelayAttempt

Recover from a lost HTTP response or process restart using the trusted RPC, without broadcasting.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/registeredRelay.ts#L216)

Import: `import {reconcileRelayAttempt} from 'tasra-sdk/chain'`

```ts
declare function reconcileRelayAttempt(chain: TasraChainClient, attempt: RelayAttempt, timeoutMs?: number): Promise<RelayReconciliation>;
```

| Parameter | Type | Description |
|---|---|---|
| ` chain ` | ` TasraChainClient ` | Trusted reader for the chain on which the forward request may have executed. |
| ` attempt ` | ` RelayAttempt ` | Persisted signed request and original log-scan start block. |
| ` timeoutMs? ` | ` number ` | Maximum reconciliation duration in milliseconds; defaults to 30000. |

Returns: ` Promise<RelayReconciliation> `.

### requestSlotSeed

Request a committee draw seed and compare its digest with the registry. Checks signature encoding and rejects the point at infinity; signature cryptography is verified during the on-chain reveal.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/slotSeed.ts#L85)

Import: `import {requestSlotSeed} from 'tasra-sdk/chain'`

```ts
declare function requestSlotSeed(chain: TasraChainClient, keyRegistry: `0x${string}`, commitment: Hex, opts?: SlotSeedOptions): Promise<SlotSeed | null>;
```

| Parameter | Type | Description |
|---|---|---|
| ` chain ` | ` TasraChainClient ` | Reader for the deployment owning the commitment. |
| ` keyRegistry ` | `` `0x${string}` `` | Registry that will receive the reveal transaction. |
| ` commitment ` | ` Hex ` | Previously submitted creation commitment. |
| ` opts? ` | ` SlotSeedOptions ` | Accountant endpoints and request timeout. |

Returns: ` Promise<SlotSeed | null> `.

Return details: A seed response, or null when no accountant returns an acceptable response.

### requireAddress

Resolve a contract address, throwing a clear error if missing.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/deployments.ts#L327)

Import: `import {requireAddress} from 'tasra-sdk/chain'`

```ts
declare function requireAddress(book: AddressBook, name: ContractName): Address;
```

| Parameter | Type | Description |
|---|---|---|
| ` book ` | ` AddressBook ` | Resolved deployment addresses. |
| ` name ` | ` ContractName ` | Canonical contract name or supported address-book key. |

Returns: ` Address `.

### requireVaultAddress

Resolve the named vesting allocation. The unqualified vault address is accepted as a fallback; callers aggregating allocations must deduplicate resolved addresses.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/deployments.ts#L307)

Import: `import {requireVaultAddress} from 'tasra-sdk/chain'`

```ts
declare function requireVaultAddress(book: AddressBook, tranche: VaultTranche): Address;
```

| Parameter | Type | Description |
|---|---|---|
| ` book ` | ` AddressBook ` | Deployment contract addresses. |
| ` tranche ` | ` VaultTranche ` | Vesting allocation to resolve. |

Returns: ` Address `.

Return details: Address of the allocation vault; throws when missing.

### resolveAccountantUrls

Read active accountant HTTP endpoints through the registry role index, preserving registry order.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/discovery.ts#L146)

Import: `import {resolveAccountantUrls} from 'tasra-sdk/chain'`

```ts
declare function resolveAccountantUrls(chain: TasraChainClient): Promise<string[]>;
```

| Parameter | Type | Description |
|---|---|---|
| ` chain ` | ` TasraChainClient ` | Reader for the registry containing accountant role registrations. |

Returns: ` Promise<string[]> `.

### resolveNetworkProfile

Validate network overrides and resolve the required EURC token address.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/networks.ts#L61)

Import: `import {resolveNetworkProfile} from 'tasra-sdk/chain'`

```ts
declare function resolveNetworkProfile(environment: NetworkName, options?: {
    chainId?: number;
    rpcUrl?: string;
    eurcAddress?: string;
}): ResolvedNetworkProfile;
```

| Parameter | Type | Description |
|---|---|---|
| ` environment ` | ` NetworkName ` | Supported network profile identifier. |
| ` options? ` | ` { chainId?: number; rpcUrl?: string; eurcAddress?: string; } ` | Explicit chain, RPC and EURC address overrides from approved configuration. |

Returns: ` ResolvedNetworkProfile `.

### resolveSlotGroupKey

Read the slot's group public key + epoch straight from `KeyRegistry.getKeySlot` - so
`encrypt` needs no verifier, no JWT, and no node round-trip (it's local + offline once
you hold the key).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/discovery.ts#L124)

Import: `import {resolveSlotGroupKey} from 'tasra-sdk/chain'`

```ts
declare function resolveSlotGroupKey(chain: TasraChainClient, slotId: `0x${string}`): Promise<SlotGroupKey>;
```

| Parameter | Type | Description |
|---|---|---|
| ` chain ` | ` TasraChainClient ` | Reader for the deployment owning the slot. |
| ` slotId ` | `` `0x${string}` `` | Slot whose anchored public key and epoch are required. |

Returns: ` Promise<SlotGroupKey> `.

### resolveSlotKeeperUrls

The slot's assigned keeper nodes, resolved to their HTTP base URLs. These are the
nodes any `/v1/committee/{sign,decrypt}` request for this slot must target. Order
follows `assignedNodes`; url-less operators are skipped.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/discovery.ts#L47)

Import: `import {resolveSlotKeeperUrls} from 'tasra-sdk/chain'`

```ts
declare function resolveSlotKeeperUrls(chain: TasraChainClient, slotId: `0x${string}`): Promise<string[]>;
```

| Parameter | Type | Description |
|---|---|---|
| ` chain ` | ` TasraChainClient ` | Reader configured from the approved network manifest. |
| ` slotId ` | `` `0x${string}` `` | Slot whose assigned keeper endpoints are required. |

Returns: ` Promise<string[]> `.

### resolveVerifierDirectory

Read active verifier records in ascending operator-address order. Stable indices must match the anchored verifier snapshot; unreadable records reject discovery rather than silently renumbering the committee.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/discovery.ts#L68)

Import: `import {resolveVerifierDirectory} from 'tasra-sdk/chain'`

```ts
declare function resolveVerifierDirectory(chain: TasraChainClient): Promise<CommitteeVerifier[]>;
```

| Parameter | Type | Description |
|---|---|---|
| ` chain ` | ` TasraChainClient ` | Reader for the deployment registry. |

Returns: ` Promise<CommitteeVerifier[]> `.

Return details: Verifier endpoints, public keys and snapshot indices.

### ruleCommitment

Compute the salted rule commitment. OID4VP and OAuth rules use canonical JSON; other rule formats retain their exact bytes.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/write.ts#L291)

Import: `import {ruleCommitment} from 'tasra-sdk/chain'`

```ts
declare function ruleCommitment(ruleSalt: Hex, rule: string): Hex;
```

| Parameter | Type | Description |
|---|---|---|
| ` ruleSalt ` | ` Hex ` | Private 32-byte salt saved with the slot creation intent. |
| ` rule ` | ` string ` | Clear authorization rule; OID4VP and OAuth rules are canonicalized before hashing. |

Returns: ` Hex `.

### serviceChallengeTypedData

Build validated EIP-712 data binding a challenge to the approved service revision and endpoint.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L149)

Import: `import {serviceChallengeTypedData} from 'tasra-sdk/chain'`

```ts
declare function serviceChallengeTypedData(challenge: ServiceChallenge): {
    domain: {
        name: string;
        version: string;
        chainId: number;
        verifyingContract: `0x${string}`;
    };
    primaryType: "ServiceIdentity";
    types: {
        ServiceIdentity: {
            name: string;
            type: string;
        }[];
    };
    message: {
        serviceId: `0x${string}`;
        revision: bigint;
        endpoint: string;
        manifestHash: `0x${string}`;
        nonce: `0x${string}`;
        expiresAt: bigint;
    };
};
```

| Parameter | Type | Description |
|---|---|---|
| ` challenge ` | ` ServiceChallenge ` | Challenge binding the service revision, endpoint, nonce and expiry. |

Returns:

```ts
{
    domain: {
        name: string;
        version: string;
        chainId: number;
        verifyingContract: `0x${string}`;
    };
    primaryType: "ServiceIdentity";
    types: {
        ServiceIdentity: {
            name: string;
            type: string;
        }[];
    };
    message: {
        serviceId: `0x${string}`;
        revision: bigint;
        endpoint: string;
        manifestHash: `0x${string}`;
        nonce: `0x${string}`;
        expiresAt: bigint;
    };
}
```

### truncateHex

Abbreviate an address or hash by retaining its leading and trailing digits.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/format.ts#L9)

Import: `import {truncateHex} from 'tasra-sdk/chain'`

```ts
declare function truncateHex(hex: string, lead?: number, tail?: number): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` hex ` | ` string ` | Address or hash, with or without a hexadecimal prefix. |
| ` lead? ` | ` number ` | Number of leading hexadecimal digits to retain. |
| ` tail? ` | ` number ` | Number of trailing hexadecimal digits to retain. |

Returns: ` string `.

### validateServiceChallenge

Responder must validate against its own configured profile before asking its dedicated key to sign.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L206)

Import: `import {validateServiceChallenge} from 'tasra-sdk/chain'`

```ts
declare function validateServiceChallenge(challenge: ServiceChallenge, approval: ServiceApproval, endpoint: string, now: number): void;
```

| Parameter | Type | Description |
|---|---|---|
| ` challenge ` | ` ServiceChallenge ` | Parsed challenge received from the client. |
| ` approval ` | ` ServiceApproval ` | Approved service identity and revision. |
| ` endpoint ` | ` string ` | Expected canonical service endpoint. |
| ` now ` | ` number ` | Current Unix time in seconds used to validate the expiry. |

Returns: ` void `.

### validateServiceEndpoint

Reject aliases instead of signing a URL which another implementation normalizes differently.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L90)

Import: `import {validateServiceEndpoint} from 'tasra-sdk/chain'`

```ts
declare function validateServiceEndpoint(endpoint: string): URL;
```

| Parameter | Type | Description |
|---|---|---|
| ` endpoint ` | ` string ` | Canonical HTTPS base URL without credentials, query or fragment. |

Returns: ` URL `.

### vaultKey

Address-book key for one vesting tranche, e.g. TasraVestingVault_team.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/deployments.ts#L77)

Import: `import {vaultKey} from 'tasra-sdk/chain'`

```ts
declare function vaultKey(tranche: VaultTranche): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` tranche ` | ` VaultTranche ` | Vesting allocation name. |

Returns: ` string `.

### verifyRuleCommitment

Return whether the disclosed rule and salt reproduce the on-chain commitment. Invalid inputs and mismatches return false.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/write.ts#L302)

Import: `import {verifyRuleCommitment} from 'tasra-sdk/chain'`

```ts
declare function verifyRuleCommitment(rule: string, ruleSalt: Hex, onChainRuleCommitment: Hex): boolean;
```

| Parameter | Type | Description |
|---|---|---|
| ` rule ` | ` string ` | Clear rule received for the slot. |
| ` ruleSalt ` | ` Hex ` | Private salt associated with that rule commitment. |
| ` onChainRuleCommitment ` | ` Hex ` | Commitment read from the on-chain slot. |

Returns: ` boolean `.

### verifyServiceIdentity

Verify the challenge response against the registry authentication key and expected request digest.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L221)

Import: `import {verifyServiceIdentity} from 'tasra-sdk/chain'`

```ts
declare function verifyServiceIdentity(challenge: ServiceChallenge, signature: Hex, authKey: Address, now: number): Promise<void>;
```

| Parameter | Type | Description |
|---|---|---|
| ` challenge ` | ` ServiceChallenge ` | Expected challenge whose digest must be signed. |
| ` signature ` | ` Hex ` | Hex-encoded EIP-712 signature returned by the service. |
| ` authKey ` | ` Address ` | Authentication address pinned by the registry record. |
| ` now ` | ` number ` | Current Unix time in seconds used to validate the expiry. |

Returns: ` Promise<void> `.

### verifyServiceManifest

Verify exact manifest bytes against the approved hash, canonical encoding and registry record.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L131)

Import: `import {verifyServiceManifest} from 'tasra-sdk/chain'`

```ts
declare function verifyServiceManifest(bytes: Uint8Array, approval: ServiceApproval, record: ServiceRecord): ServiceManifest;
```

| Parameter | Type | Description |
|---|---|---|
| ` bytes ` | ` Uint8Array ` | Exact downloaded service manifest bytes. |
| ` approval ` | ` ServiceApproval ` | Application-approved service identity and pinned manifest hash. |
| ` record ` | ` ServiceRecord ` | Registry record whose endpoint and hash must match the manifest. |

Returns: ` ServiceManifest `.

## Types

Options, data structures and return types.

<details>
<summary>Browse 67 types</summary>

- [Address](#address)
- [AddressBook](#addressbook)
- [AgentTransport](#agenttransport)
- [ApplicationServiceProfiles](#applicationserviceprofiles)
- [ApprovedAgentProfile](#approvedagentprofile)
- [ApprovedServiceProfile](#approvedserviceprofile)
- [AuthenticatedService](#authenticatedservice)
- [ChainClientConfig](#chainclientconfig)
- [CommitRevealOptions](#commitrevealoptions)
- [CommitteeDecryptOptions](#committeedecryptoptions)
- [CommitteeSignOptions](#committeesignoptions)
- [CommitteeSlotClient](#committeeslotclient)
- [CommitteeSlotClientConfig](#committeeslotclientconfig)
- [ContractName](#contractname)
- [ContractObservation](#contractobservation)
- [ContractRecord](#contractrecord)
- [CreateSlotArgs](#createslotargs)
- [DecodedEvent](#decodedevent)
- [EventCategory](#eventcategory)
- [FetchOpts](#fetchopts)
- [GetLogsWindowedOpts](#getlogswindowedopts)
- [KeeperProvisionResult](#keeperprovisionresult)
- [KeyListReply](#keylistreply)
- [KeySlotSummary](#keyslotsummary)
- [MeteringReply](#meteringreply)
- [NetworkManifest](#networkmanifest)
- [NetworkName](#networkname)
- [NetworkPreset](#networkpreset)
- [NodeInfo](#nodeinfo)
- [ProvisionRuleArgs](#provisionruleargs)
- [ProvisionRuleResult](#provisionruleresult)
- [RegisteredAgentSession](#registeredagentsession)
- [RegisteredRelayConfig](#registeredrelayconfig)
- [RegisteredVerifierAgentSession](#registeredverifieragentsession)
- [RelayAttempt](#relayattempt)
- [RelayConfig](#relayconfig)
- [RelayIntent](#relayintent)
- [RelayReceipt](#relayreceipt)
- [RelayReconciliation](#relayreconciliation)
- [RelayTransport](#relaytransport)
- [ResolvedEndpoints](#resolvedendpoints)
- [ResolvedNetworkProfile](#resolvednetworkprofile)
- [RuleInput](#ruleinput)
- [ServiceApproval](#serviceapproval)
- [ServiceChallenge](#servicechallenge)
- [ServiceDiscoveryTransport](#servicediscoverytransport)
- [ServiceManifest](#servicemanifest)
- [ServiceRecord](#servicerecord)
- [ServiceStatus](#servicestatus)
- [ServiceType](#servicetype)
- [SignedHeartbeat](#signedheartbeat)
- [SlotAuthType](#slotauthtype)
- [SlotCommitteeDecryptOptions](#slotcommitteedecryptoptions)
- [SlotCommitteeSignOptions](#slotcommitteesignoptions)
- [SlotGroupKey](#slotgroupkey)
- [SlotMode](#slotmode)
- [SlotSeed](#slotseed)
- [SlotSeedOptions](#slotseedoptions)
- [TasraChainClient](#tasrachainclient)
- [TasraSlotClient](#tasraslotclient)
- [TasraSlotClientConfig](#tasraslotclientconfig)
- [TasraWriteClient](#tasrawriteclient)
- [VaultTranche](#vaulttranche)
- [VerifierInfo](#verifierinfo)
- [WriteClientConfig](#writeclientconfig)
- [WriteClientKeyConfig](#writeclientkeyconfig)
- [WriteClientWalletConfig](#writeclientwalletconfig)

</details>

### Address

Hex-encoded EVM contract or account address.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/deployments.ts#L23)

```ts
export type Address = `0x${string}`;
```

### AddressBook

Canonical contract name to deployed address (lowercased keys allowed too).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/deployments.ts#L26)

```ts
export type AddressBook = Partial<Record<ContractName, Address>> & {
    [k: string]: Address | undefined;
};
```

### AgentTransport

Guarded HTTPS transport for service discovery and verifier-agent sessions.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/registeredAgent.ts#L9)

```ts
export interface AgentTransport extends ServiceDiscoveryTransport {
    agentRequest(url: string, options: {
        body?: Uint8Array;
        bearer?: string;
        maxBytes: number;
        signal: AbortSignal;
    }): Promise<Uint8Array>;
}
```

Fields:

- **` agentRequest `**: Same socket/TLS policy as discovery; bearer is allowed only on a session GET.
- **` request `**: Perform a bounded request using the required destination, TLS and cancellation policy; return response bytes.

### ApplicationServiceProfiles

Reviewed application configuration, never a list downloaded from a service registry.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/serviceProfiles.ts#L21)

```ts
export interface ApplicationServiceProfiles {
    chainId: number;
    registry: Address;
    relayers: ApprovedServiceProfile[];
    verifierAgents: ApprovedAgentProfile[];
    vaultServices: ApprovedServiceProfile[];
}
```

Fields:

- **` chainId `**: Chain shared by all approved service profiles.
- **` registry `**: ServiceRegistry contract shared by the approved profiles.
- **` relayers `**: Independently approved relay providers in application preference order.
- **` verifierAgents `**: Independently approved verifier agents and their pinned audiences.
- **` vaultServices `**: Independently approved vault-service identities and endpoints.

### ApprovedAgentProfile

Both the application and committee verifiers must independently approve this verifier-agent identity.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/registeredAgent.ts#L15)

```ts
export interface ApprovedAgentProfile {
    approval: ServiceApproval;
    endpoint: string;
    clientId: string;
}
```

Fields:

- **` approval `**: Independently approved service registry identity and revision.
- **` endpoint `**: Expected canonical verifier-agent endpoint.
- **` clientId `**: Approved OID4VP client identifier derived from the agent DID.

### ApprovedServiceProfile

Application-approved service identity and its expected endpoint.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/serviceProfiles.ts#L9)

```ts
export interface ApprovedServiceProfile {
    approval: ServiceApproval;
    endpoint: string;
}
```

Fields:

- **` approval `**: Independently reviewed registry identity and metadata pins.
- **` endpoint `**: Expected canonical service endpoint.

### AuthenticatedService

Approved registry record and canonical manifest authenticated by a fresh endpoint challenge.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L241)

```ts
export interface AuthenticatedService {
    approval: ServiceApproval;
    record: ServiceRecord;
    manifest: ServiceManifest;
    blockNumber: bigint;
    expiresAt: number;
}
```

Fields:

- **` approval `**: Application-supplied service identity and metadata pins that were checked.
- **` record `**: Registry record checked during endpoint authentication.
- **` manifest `**: Canonical service manifest matching the approved hash and registry record.
- **` blockNumber `**: Chain block used for the final registry record check.
- **` expiresAt `**: Expiration of the endpoint authentication challenge in Unix seconds.

### ChainClientConfig

RPC and contract configuration for read-only network access.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/client.ts#L61)

```ts
export interface ChainClientConfig {
    rpcUrl: string;
    addresses: AddressBook;
    chainId?: number;
    logWindow?: number;
    multicall3?: Address | false;
}
```

Fields:

- **` rpcUrl `**: JSON-RPC HTTP endpoint of the chain.
- **` addresses `**: Resolved deployment addresses.
- **` chainId `**: Chain id; defaults to DEFAULT_CHAIN_ID (the RPC is never consulted).
- **` logWindow `**: getLogs block-window size; keep <= the RPC's range cap (anvil/besu: large; public: ~2k).
- **` multicall3 `**: Multicall3 address for batching. Omit to probe the canonical address, supply an explicit address to probe that deployment, or set false to disable batching. Unavailable batching falls back to individual reads.

### CommitRevealOptions

Recovery and timing controls for commit-reveal creation. Accountant seed discovery is attempted first; unavailable seeds fall back to a beacon epoch wait.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/write.ts#L164)

```ts
export interface CommitRevealOptions {
    recovery?: {
        commitTx?: Hex;
        revealTx?: Hex;
        seeded?: boolean;
        onTransaction: (event: {
            step: 'commit' | 'reveal';
            phase: 'submitting' | 'submitted' | 'confirmed';
            hash?: Hex;
            seeded?: boolean;
        }) => Promise<void>;
    };
    signal?: AbortSignal;
    maxWaitMs?: number;
    onEpoch?: (cur: number, target: number) => void;
    slotSeed?: boolean;
    accountantUrls?: string[];
    slotSeedTimeoutMs?: number;
    onSeed?: (seed: SlotSeed | null) => void;
}
```

Fields:

- **` recovery `**: Durable creation flow. Awaited before submission and after receiving each hash. Enabling recovery disables automatic transaction resubmission and chain-time nudges. Only supply hashes from the same persisted intent; never reconstruct lost salts.
- **` signal `**: Cancel cooperative creation waits; already submitted transactions remain on chain.
- **` maxWaitMs `**: Maximum beacon-epoch wait in milliseconds when no accountant seed is available.
- **` onEpoch `**: Progress during that wait. Not called on the seeded path - there is no wait to report.
- **` slotSeed `**: Attempt accountant seed discovery by default. Set false to wait for the beacon epoch instead; both paths bind the draw to the committed creation intent.
- **` accountantUrls `**: Accountant base URLs for the seed request. Resolved from `NodeRegistry` when omitted.
- **` slotSeedTimeoutMs `**: Per-accountant HTTP timeout for the seed request.
- **` onSeed `**: The seed that was obtained, or `null` when the epoch wait is being used instead.

### CommitteeDecryptOptions

Decryption options for a registry-discovered committee slot.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/committeeClient.ts#L111)

```ts
export type CommitteeDecryptOptions = SlotCommitteeDecryptOptions;
```

Fields:

- **` ciphertext `**: Group ciphertext to decrypt through committee authorization.
- **` identity `**: Original associated data used when encrypting the group ciphertext.
- **` decryptingSet `**: BLS identifiers (k..n, distinct) to run the ceremony with.
- **` blsPeers `**: The libp2p peers for those identifiers.
- **` userSignature `**: Optional Ed25519 slot-owner signature required by the keeper policy.
- **` ciphertextEpoch `**: Expected slot key epoch for detecting ciphertext-key rotation.
- **` targetKeykeeper `**: Pin the keeper this request targets (anti-Sybil); an on-chain assigned operator.

### CommitteeSignOptions

Signing options for a registry-discovered committee slot.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/committeeClient.ts#L107)

```ts
export type CommitteeSignOptions = SlotCommitteeSignOptions;
```

Fields:

- **` signingSet `**: Optional FROST participant identifiers selected for signing.
- **` userSignature `**: Optional Ed25519 slot-owner approval signature for the signing request.
- **` targetKeykeeper `**: Pin the keeper this request targets (anti-Sybil). Must be one of the slot's on-chain assigned operators; there is no way to point at an off-chain node.

### CommitteeSlotClient

Slot-based committee operations that discover keepers and verifiers from the chain.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/committeeClient.ts#L116)

```ts
export interface CommitteeSlotClient {
    sign(slotId: string, message: Uint8Array, opts?: SlotCommitteeSignOptions): Promise<FrostSignResult>;
    encrypt(slotId: string, plaintext: Uint8Array, opts?: {
        identity?: Uint8Array;
        epoch?: bigint | null;
    }): Promise<Uint8Array>;
    decrypt(slotId: string, opts: SlotCommitteeDecryptOptions): Promise<Uint8Array>;
    verifierDirectory(): Promise<CommitteeVerifier[]>;
}
```

Fields:

- **` sign `**: Committee-authorized threshold FROST signature over `message`.
- **` encrypt `**: Encrypt to the slot's group key. Local - reads the public key from chain, then does the crypto in-process: no verifier, no JWT, no keeper node, and **no credentials** (a client built with only `{chain}` can call this). BLS (encryption) slots only.
- **` decrypt `**: Committee-authorized threshold decrypt.
- **` verifierDirectory `**: The resolved active verifier directory (discovered once, then cached).

### CommitteeSlotClientConfig

Chain discovery and holder-proof configuration for threshold signing and identity decryption.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/committeeClient.ts#L35)

```ts
export interface CommitteeSlotClientConfig {
    chain: TasraChainClient;
    holder?: string;
    credentials?: string[];
    dcqlRule?: string;
    holderProof?: string | HolderProofPerVerifier;
    clientSigner?: ClientSigner;
    ttlSecs?: number;
}
```

Fields:

- **` chain `**: Read client for the deployment (RPC + address book).
- **` holder `**: Holder DID (the credentials' subject). Required for ` CommitteeSlotClient.sign ` and ` CommitteeSlotClient.decrypt `, which must present credentials to the verifier committee. Not needed for ` CommitteeSlotClient.encrypt `, which only reads the slot's public group key from chain.
- **` credentials `**: Compact-JWS verifiable credentials presented to the committee. Required for sign/decrypt.
- **` dcqlRule `**: Ignored compatibility field. Verifiers fetch the committed rule from a keeper; supplying this field does not change authorization.
- **` holderProof `**: Holder proof-of-possession for the holder DID authentication key. Required for sign/decrypt. One string serves one verifier: the proof names its audience and burns a nonce that lives in that verifier, so on any deployment whose policy draws a committee the others answer 401 ("aud does not include this verifier"). Pass `holderProofPerVerifier({signer, audience, credentials, slotId})` there - it mints a fresh proof per drawn verifier, on every request.
- **` clientSigner `**: sign the request bundle so keeper + audit can verify you authorized it.
- **` ttlSecs `**: Compound-token TTL in seconds (default 300).

### ContractName

Canonical contract names supported by the bundled ABI registry.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/abis/index.ts#L70)

```ts
export type ContractName = keyof typeof CONTRACT_ABIS;
```

### ContractObservation

Observed contract code and proxy implementation compared with a manifest record.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/manifest.ts#L172)

```ts
export interface ContractObservation {
    name: string;
    address: Address;
    expectedCodeHash: Hex | null;
    observedCodeHash: Hex | null;
    implementation: Address | null;
    implementationCodeHash: Hex | null;
    matches: boolean;
}
```

Fields:

- **` name `**: Contract name from the manifest.
- **` address `**: Address read at the finalized block.
- **` expectedCodeHash `**: Runtime hash pinned by the manifest.
- **` observedCodeHash `**: Observed runtime hash, or null when no code exists.
- **` implementation `**: Observed proxy implementation address, if present.
- **` implementationCodeHash `**: Observed implementation runtime hash, if present.
- **` matches `**: Whether deployed code and any proxy implementation match the manifest.

### ContractRecord

Manifest record of one deployed contract and its code, transaction and proxy evidence.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/manifest.ts#L10)

```ts
export interface ContractRecord {
    name: string;
    address: Address;
    abi: string;
    runtimeCodeHash: Hex | null;
    deployment: {
        transactionHash: Hex;
        blockNumber: string;
    } | null;
    create2: {
        factory: Address;
        salt: Hex;
        initCodeHash: Hex;
    } | null;
    proxy: {
        implementation: Address;
        runtimeCodeHash: Hex;
        upgradeAuthority: Address | null;
    } | null;
}
```

Fields:

- **` name `**: Canonical contract name used as the address-book key.
- **` address `**: Deployed contract address.
- **` abi `**: Relative ABI artifact path in the release repository.
- **` runtimeCodeHash `**: Expected runtime-bytecode hash, or null before deployment evidence exists.
- **` deployment `**: Deployment transaction and decimal block number, or null when unavailable.
- **` create2 `**: Deterministic deployment inputs, or null for other deployment methods.
- **` proxy `**: Expected implementation, code hash and upgrade authority for a proxy.

### CreateSlotArgs

Slot key mode, keeper threshold, private authorization rule and creation policies.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/write.ts#L198)

```ts
export interface CreateSlotArgs extends RuleInput {
    ruleSalt?: Hex;
    k: number;
    n: number;
    mode: SlotMode;
    authType?: SlotAuthType;
    tags?: string[];
    slotId?: Hex;
    salt?: Hex;
    rulePolicy?: RulePolicyArgs;
    exportable?: boolean;
}
```

Fields:

- **` ruleSalt `**: Private 32-byte authorization-rule salt, generated when omitted. Distinct from the committee-selection salt.
- **` k `**: Minimum participating keeper shares required for an operation.
- **` n `**: Total keeper shares assigned to the slot.
- **` mode `**: Key algorithm and threshold operation family.
- **` authType `**: `KeyRegistry.AuthType` for this slot - how a holder authorises against the rule. Defaults to `'unspecified'` (ordinal 0), which declares nothing and is what every slot predating the field reads as. Set it when the rule is an OID4VP-DCQL query (`'oid4vp'`) or an OAuth/OIDC token rule (`'oauth'`).
- **` tags `**: Committee-draw filter tags; default `["keykeeper"]`.
- **` slotId `**: Explicit 32-byte slot identifier, generated when omitted.
- **` salt `**: 32-byte committee-selection salt, generated when omitted.
- **` rulePolicy `**: Install amendment authority in the creation transaction. Omission makes the rule immutable. A later policy transaction can lose the race with key generation.
- **` exportable `**: Allow raw share export, permitting a holder with enough shares to retain the reconstructed key permanently. Revocation cannot remove an exported key. Disabled by default and incompatible with rulePolicy.
- **` rule `**: Clear rule. OAuth and wallet policies share the DCQL grammar.

### DecodedEvent

A normalized, storage-ready decoded log.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/events.ts#L91)

```ts
export interface DecodedEvent {
    category: EventCategory;
    contract: ContractName;
    address: Address;
    eventName: string;
    args: Record<string, unknown>;
    blockNumber: bigint;
    blockHash: string | null;
    txHash: string;
    txIndex: number | null;
    logIndex: number;
}
```

Fields:

- **` category `**: Display category derived from the contract and event name.
- **` contract `**: Contract ABI used to decode this event.
- **` address `**: Contract address that emitted the log.
- **` eventName `**: Decoded event name from the contract ABI.
- **` args `**: Decoded args (bigints preserved; use `jsonSafe` before persisting).
- **` blockNumber `**: Block containing the log.
- **` blockHash `**: Block hash reported by the RPC, or null when unavailable.
- **` txHash `**: Hash of the transaction that emitted the log.
- **` txIndex `**: Transaction position within the block, or null when unavailable.
- **` logIndex `**: Log position within the block.

### EventCategory

Display category assigned to decoded contract events.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/events.ts#L13)

```ts
export type EventCategory = 'node' | 'slot' | 'slashing' | 'tasra' | 'settlement' | 'beacon' | 'governance';
```

### FetchOpts

Timeout and optional bearer authorization for direct service reads.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/offchain.ts#L12)

```ts
export interface FetchOpts {
    timeoutMs?: number;
    jwt?: string;
}
```

Fields:

- **` timeoutMs `**: Per-request timeout in ms (default 4000).
- **` jwt `**: Bearer JWT, for the few authenticated reads (metering/audit).

### GetLogsWindowedOpts

Inclusive block range, contract filter and progress callback for event scanning.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/client.ts#L95)

```ts
export interface GetLogsWindowedOpts {
    fromBlock: bigint;
    toBlock: bigint;
    contracts?: ContractName[];
    windowSize?: number;
    onWindow?: (toBlock: bigint, events: DecodedEvent[]) => void;
}
```

Fields:

- **` fromBlock `**: First block to scan, inclusive.
- **` toBlock `**: Last block to scan, inclusive.
- **` contracts `**: Restrict to these contracts (default: all present in the AddressBook).
- **` windowSize `**: Number of blocks per query; defaults to the client logWindow setting.
- **` onWindow `**: Called after each window with the last block scanned (progress).

### KeeperProvisionResult

One keeper's answer. `pending` marks a rule stored against a PENDING amendment.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/provisionRule.ts#L70)

```ts
export interface KeeperProvisionResult {
    url: string;
    ok: boolean;
    provisioned?: boolean;
    pending?: boolean;
    pendingVersion?: number;
    status?: number;
    error?: string;
}
```

Fields:

- **` url `**: Keeper endpoint contacted by this attempt.
- **` ok `**: Whether the keeper accepted the HTTP request.
- **` provisioned `**: The active rule was filled in by THIS call (false when it was already present).
- **` pending `**: Whether the keeper stored the rule for a pending amendment.
- **` pendingVersion `**: Pending amendment version reported by the keeper.
- **` status `**: HTTP status when a response was received.
- **` error `**: Bounded response text or transport error for a failed delivery.

### KeyListReply

Slot summaries returned by a keeper key-list endpoint.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/offchain.ts#L100)

```ts
export interface KeyListReply {
    slots: KeySlotSummary[];
    [k: string]: unknown;
}
```

Fields:

- **` slots `**: Slot summaries included in the keeper response.

### KeySlotSummary

Keeper-reported slot threshold, key epoch and optional rule or activity metadata.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/offchain.ts#L75)

```ts
export interface KeySlotSummary {
    key_slot_id: string;
    threshold_k: number;
    threshold_n: number;
    epoch: number;
    group_public_key?: string | null;
    dcql_rule?: string | null;
    mode?: string;
    created_at?: string;
    last_signed_at?: string | null;
    [k: string]: unknown;
}
```

Fields:

- **` key_slot_id `**: Slot identifier returned by the keeper.
- **` threshold_k `**: Required threshold shares reported for the slot.
- **` threshold_n `**: Total assigned participants reported for the slot.
- **` epoch `**: Slot key epoch reported by the keeper.
- **` group_public_key `**: Encoded group public key, or null when the service has no ready key.
- **` dcql_rule `**: Disclosed authorization rule text, when included by the service.
- **` mode `**: Slot key mode reported by the keeper.
- **` created_at `**: Creation timestamp string reported by the service.
- **` last_signed_at `**: Most recent signing timestamp reported by the service, or null when absent.

### MeteringReply

Keeper-reported operation counts for a slot and optional subject breakdown.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/offchain.ts#L124)

```ts
export interface MeteringReply {
    key_slot_id: string;
    since?: string;
    until?: string;
    total: number;
    by_subject?: Array<{
        subject: string;
        count: number;
    }>;
    attestation?: unknown;
    [k: string]: unknown;
}
```

Fields:

- **` key_slot_id `**: Slot identifier whose operation counts were requested.
- **` since `**: Start of the reporting interval, when supplied by the service.
- **` until `**: End of the reporting interval, when supplied by the service.
- **` total `**: Total operations counted by the service.
- **` by_subject `**: Optional operation counts grouped by subject.
- **` attestation `**: Optional service-provided attestation; this read helper does not verify it.

### NetworkManifest

Versioned network deployment record published in tasra-releases.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/manifest.ts#L43)

```ts
export interface NetworkManifest {
    schemaVersion: 1;
    network: NetworkName;
    chainId: number;
    deploymentId: string;
    revision: number;
    status: 'planned' | 'active' | 'retired';
    protocolVersion: string;
    verifiedAt: {
        blockNumber: string;
        blockHash: Hex;
        timestamp: string;
    } | null;
    contracts: ContractRecord[];
    services: {
        kind: string;
        url: string;
    }[];
}
```

Fields:

- **` schemaVersion `**: Network manifest schema version.
- **` network `**: Network profile associated with this deployment.
- **` chainId `**: EVM chain ID matching the selected network profile.
- **` deploymentId `**: Stable deployment identifier.
- **` revision `**: Positive revision number of this deployment record.
- **` status `**: Lifecycle state; only active records can configure live clients.
- **` protocolVersion `**: Network protocol compatibility version.
- **` verifiedAt `**: Canonical block and timestamp recorded when deployment evidence was collected.
- **` contracts `**: Contract addresses and deployment evidence.
- **` services `**: Public service endpoints advertised by this network.

### NetworkName

Supported network profile identifier.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/networks.ts#L7)

```ts
export type NetworkName = 'local' | 'testnet' | 'mainnet';
```

### NetworkPreset

Default network currency, RPC, governance and token configuration.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/networks.ts#L11)

```ts
export interface NetworkPreset {
    readonly chainId: number;
    readonly rpcUrl: string;
    readonly nativeCurrency: Readonly<{
        name: string;
        symbol: string;
        decimals: number;
    }>;
    readonly eurc: Readonly<{
        kind: 'mock' | 'circle';
        address: string | null;
        name: string;
        symbol: string;
        decimals: number;
        faucet: boolean;
    }>;
    readonly governance: Readonly<{
        delaySecs: number;
        floorSecs: number;
    }>;
    readonly productionPosture: boolean;
}
```

Fields:

- **` chainId `**: Default EVM chain identifier for this network profile.
- **` rpcUrl `**: Default JSON-RPC endpoint; deployed configuration may supply an explicit override.
- **` nativeCurrency `**: Native gas-token name, symbol and decimal precision.
- **` eurc `**: EURC token policy, metadata and faucet eligibility; address may require deployment resolution.
- **` governance `**: Configured governance delay and minimum delay, both in seconds.
- **` productionPosture `**: Deployment-policy flag carried by the profile; the SDK does not use it to establish network readiness.

### NodeInfo

Keeper-reported runtime and connectivity metadata; fields depend on the server response.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/offchain.ts#L52)

```ts
export interface NodeInfo {
    peer_id?: string;
    node_identifier?: number;
    version?: string;
    build_profile?: string;
    uptime_secs?: number;
    connected_peers?: number | null;
    rate_limit_enabled?: boolean;
    admin_scope_enabled?: boolean;
    [k: string]: unknown;
}
```

Fields:

- **` peer_id `**: Keeper-reported network peer identifier.
- **` node_identifier `**: Keeper-reported node identifier.
- **` version `**: Keeper software version reported by the service.
- **` build_profile `**: Build profile reported by the keeper.
- **` uptime_secs `**: Keeper process uptime in seconds, as reported by the service.
- **` connected_peers `**: Reported connected-peer count, or null when unavailable.
- **` rate_limit_enabled `**: Whether the keeper reports rate limiting as enabled.
- **` admin_scope_enabled `**: Whether the keeper reports administrative scope checks as enabled.

### ProvisionRuleArgs

Creator-signed rule delivery request with the private salt used at slot creation.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/provisionRule.ts#L38)

```ts
export interface ProvisionRuleArgs extends RuleInput {
    slotId: Hex;
    ruleSalt: Hex;
    signer: TypedDataSigner;
    ttlSecs?: number;
    nowSecs?: number;
    description?: string;
    signal?: AbortSignal;
    keeperUrls?: string[];
    fetchImpl?: typeof fetch;
}
```

Fields:

- **` slotId `**: 32-byte identifier of the slot to provision.
- **` ruleSalt `**: The 32-byte rule salt `createSlot` returned. It exists NOWHERE else.
- **` signer `**: The slot's creator key (or a key it delegated to).
- **` ttlSecs `**: Seconds the authorisation stays valid (default 600; the keeper caps at 3600).
- **` nowSecs `**: Authorization issue time in Unix seconds; defaults to the current clock.
- **` description `**: Consent description included in the creator signature.
- **` signal `**: Cancel pending keeper HTTP requests.
- **` keeperUrls `**: Overrides the on-chain committee; for tests and for a topology chain cannot see.
- **` fetchImpl `**: HTTP implementation used for rule delivery.
- **` rule `**: Clear rule. OAuth and wallet policies share the DCQL grammar.

### ProvisionRuleResult

Committed rule hash and per-keeper delivery outcomes.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/provisionRule.ts#L102)

```ts
export interface ProvisionRuleResult {
    slotId: Hex;
    ruleCommitment: Hex;
    results: KeeperProvisionResult[];
}
```

Fields:

- **` slotId `**: Slot whose authorization rule was delivered.
- **` ruleCommitment `**: Salted commitment computed from the submitted rule and saved salt.
- **` results `**: Delivery result for each selected keeper.

### RegisteredAgentSession

Session pinned to its authenticated provider, with a closure for polling that provider.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/registeredAgent.ts#L33)

```ts
export interface RegisteredAgentSession extends Readonly<CreateSessionResult> {
    readonly profile: Readonly<ApprovedAgentProfile>;
    poll(signal?: AbortSignal): Promise<SessionStatusResult>;
}
```

Fields:

- **` profile `**: Provider identity and endpoint pinned when the session was opened.
- **` poll `**: Poll only the original endpoint/profile. A provider change requires a fresh wallet session.
- **` sessionId `**: Opened authorization session identifier.
- **` pollSecret `**: Bearer token for polling - treat as a secret
- **` qrPayload `**: OpenID4VP deep link for a wallet or QR code.
- **` requestUri `**: URL from which the wallet retrieves the signed request.

### RegisteredRelayConfig

Approved relay providers, pinned forwarder and durable recovery callbacks.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/registeredRelay.ts#L36)

```ts
export interface RegisteredRelayConfig {
    approvals: readonly ServiceApproval[];
    transport: RelayTransport;
    forwarder: Address;
    label?: string;
    persistAttempt?: (attempt: RelayAttempt) => Promise<void>;
    resumeAttempt?: (intent: RelayIntent) => Promise<RelayAttempt | undefined>;
    pollMs?: number;
    timeoutMs?: number;
    maxAttempts?: number;
    attemptMs?: number;
}
```

Fields:

- **` approvals `**: Application approvals, in preference order. Registry membership alone never selects a service.
- **` transport `**: Guarded HTTP transport for service authentication and relay submission.
- **` forwarder `**: Independently pinned deployment forwarder; never supplied by a relayer manifest.
- **` label `**: Default operation label used when persisting or resuming relay attempts.
- **` persistAttempt `**: Persist the signed reconciliation handle before its first POST.
- **` resumeAttempt `**: Load this durable operation's previous attempt before signing, including after a restart.
- **` pollMs `**: Relay status polling interval in milliseconds; defaults to 1500.
- **` timeoutMs `**: Deadline in milliseconds after a submission leaves the serialization queue; defaults to 120000 and cannot exceed it.
- **` maxAttempts `**: At most three authenticated providers receive the identical signed request.
- **` attemptMs `**: Status polling budget per provider in milliseconds; defaults to 10000 and cannot exceed 30000.

### RegisteredVerifierAgentSession

Authenticated provider session bound to one signed operation and request hash.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/registeredOperation.ts#L13)

```ts
export interface RegisteredVerifierAgentSession extends RegisteredAgentSession {
    readonly operation: PresentationOperation;
    readonly requestHash: Uint8Array;
    readonly verifierAgentUrl: string;
}
```

Fields:

- **` operation `**: Creator-signed operation associated with this session.
- **` requestHash `**: Defensive copy of the operation request hash.
- **` verifierAgentUrl `**: Authenticated provider endpoint retained for this session.
- **` profile `**: Provider identity and endpoint pinned when the session was opened.
- **` poll `**: Poll only the original endpoint/profile. A provider change requires a fresh wallet session.
- **` sessionId `**: Opened authorization session identifier.
- **` pollSecret `**: Bearer token for polling - treat as a secret
- **` qrPayload `**: OpenID4VP deep link for a wallet or QR code.
- **` requestUri `**: URL from which the wallet retrieves the signed request.

### RelayAttempt

JSON-safe reconciliation handle. Persist before POST to resume safely after a client restart.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/registeredRelay.ts#L95)

```ts
export interface RelayAttempt {
    chainId: number;
    forwarder: Address;
    fromBlock: string;
    id: Hex;
    request: {
        from: Address;
        to: Address;
        value: '0';
        gas: number;
        nonce: number;
        deadline: number;
        data: Hex;
        signature: Hex;
        label: string;
    };
}
```

Fields:

- **` chainId `**: Chain bound into the signed forward request.
- **` forwarder `**: Pinned forwarder contract expected to execute the request.
- **` fromBlock `**: Decimal block number from which reconciliation scans execution logs.
- **` id `**: EIP-712 hash identifying the exact signed forward request.
- **` request `**: Signed sender, target, calldata, gas, nonce and deadline used for submission and reconciliation.

### RelayConfig

Approved relay configuration for gas-sponsored sender-bound contract calls. The creator signs the forward request; the relayer pays gas. ERC-20 approvals still require direct transactions.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/write.ts#L123)

```ts
export type RelayConfig = RegisteredRelayConfig;
```

Fields:

- **` approvals `**: Application approvals, in preference order. Registry membership alone never selects a service.
- **` transport `**: Guarded HTTP transport for service authentication and relay submission.
- **` forwarder `**: Independently pinned deployment forwarder; never supplied by a relayer manifest.
- **` label `**: Default operation label used when persisting or resuming relay attempts.
- **` persistAttempt `**: Persist the signed reconciliation handle before its first POST.
- **` resumeAttempt `**: Load this durable operation's previous attempt before signing, including after a restart.
- **` pollMs `**: Relay status polling interval in milliseconds; defaults to 1500.
- **` timeoutMs `**: Deadline in milliseconds after a submission leaves the serialization queue; defaults to 120000 and cannot exceed it.
- **` maxAttempts `**: At most three authenticated providers receive the identical signed request.
- **` attemptMs `**: Status polling budget per provider in milliseconds; defaults to 10000 and cannot exceed 30000.

### RelayIntent

Chain, forwarder, signer and exact calldata identifying a relay operation.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/registeredRelay.ts#L18)

```ts
export interface RelayIntent {
    chainId: number;
    forwarder: Address;
    from: Address;
    to: Address;
    data: Hex;
    label: string;
}
```

Fields:

- **` chainId `**: Chain on which the forwarded call is intended to execute.
- **` forwarder `**: Independently pinned forwarding contract.
- **` from `**: Account authorizing the forwarded operation.
- **` to `**: Target contract of the forwarded operation.
- **` data `**: Exact encoded calldata to execute.
- **` label `**: Application label used to locate the operation recovery record.

### RelayReceipt

Verified forwarded transaction result with optional gas and native-token cost.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/registeredRelay.ts#L62)

```ts
export interface RelayReceipt {
    id: string;
    txHash: Hex;
    gasUsed?: number;
    costWei?: string;
}
```

Fields:

- **` id `**: Signed relay-request identifier.
- **` txHash `**: Verified forwarded transaction hash.
- **` gasUsed `**: Gas consumed by the forwarded transaction, when reported.
- **` costWei `**: Native-token transaction cost in base units, encoded as decimal text.

### RelayReconciliation

Reconciled relay outcome. A receipt proves execution. Expired means the deadline passed with the nonce unused. Unresolvable means the nonce was consumed beyond the available log window; execution remains unknown and must not be retried as a new operation.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/registeredRelay.ts#L167)

```ts
export interface RelayReconciliation {
    receipt?: RelayReceipt;
    expired: boolean;
    unresolvable?: boolean;
}
```

Fields:

- **` receipt `**: Verified successful execution receipt, when found.
- **` expired `**: Whether the deadline passed while the request nonce remained unused.
- **` unresolvable `**: Whether the consumed nonce predates the available log scan, leaving execution unknown.

### RelayTransport

Guarded discovery and transaction relay transport with bounded response bodies.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/registeredRelay.ts#L10)

```ts
export interface RelayTransport extends ServiceDiscoveryTransport {
    relayRequest(url: string, options: {
        body?: Uint8Array;
        maxBytes: number;
        signal: AbortSignal;
    }): Promise<Uint8Array>;
}
```

Fields:

- **` relayRequest `**: Guard the socket just like discovery. Accept bounded JSON status bodies for 200/202/422.
- **` request `**: Perform a bounded request using the required destination, TLS and cancellation policy; return response bytes.

### ResolvedEndpoints

How the session's endpoints were resolved from chain - surfaced so callers can see
which verifier was chosen and which keeper committee the slot is bound to.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/slotClient.ts#L26)

```ts
export interface ResolvedEndpoints {
    slotId: string;
    nodes: string[];
    verifier: string;
    verifierCount: number;
}
```

Fields:

- **` slotId `**: Slot identifier used to resolve the assigned service endpoints.
- **` nodes `**: The slot's on-chain assigned keeper node URLs.
- **` verifier `**: The verifier chosen (at random) from the on-chain set - it issued the JWT.
- **` verifierCount `**: Size of the on-chain verifier set the choice was drawn from.

### ResolvedNetworkProfile

Validated network profile with a concrete EURC contract address.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/networks.ts#L28)

```ts
export interface ResolvedNetworkProfile extends NetworkPreset {
    readonly environment: NetworkName;
    readonly eurc: NetworkPreset['eurc'] & {
        readonly address: Address;
    };
}
```

Fields:

- **` environment `**: Network profile selected when validating the chain and token address.
- **` eurc `**: Validated EURC policy with a concrete nonzero token contract address.
- **` chainId `**: Default EVM chain identifier for this network profile.
- **` rpcUrl `**: Default JSON-RPC endpoint; deployed configuration may supply an explicit override.
- **` nativeCurrency `**: Native gas-token name, symbol and decimal precision.
- **` governance `**: Configured governance delay and minimum delay, both in seconds.
- **` productionPosture `**: Deployment-policy flag carried by the profile; the SDK does not use it to establish network readiness.

### RuleInput

Clear authorization policy, not its salted on-chain commitment.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/ruleInput.ts#L2)

```ts
export interface RuleInput {
    rule: string;
}
```

Fields:

- **` rule `**: Clear rule. OAuth and wallet policies share the DCQL grammar.

### ServiceApproval

Pin the approved revision so an endpoint, key or provider change requires a new decision.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/services.ts#L57)

```ts
export interface ServiceApproval {
    chainId: number;
    registry: Address;
    serviceId: Hex;
    serviceType: ServiceType;
    owner: Address;
    revision: bigint;
    manifestHash: Hex;
}
```

Fields:

- **` chainId `**: Approved EVM chain ID.
- **` registry `**: Approved ServiceRegistry address.
- **` serviceId `**: Stable identifier of the approved service.
- **` serviceType `**: Expected service capability family.
- **` owner `**: Approved provider owner address.
- **` revision `**: Exact approved registry revision.
- **` manifestHash `**: Approved hash of the canonical service manifest.

### ServiceChallenge

JSON wire shape. Revision is decimal text to preserve all uint64 values in JavaScript.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L58)

```ts
export interface ServiceChallenge {
    version: 1;
    chainId: number;
    registry: Address;
    serviceId: Hex;
    revision: string;
    endpoint: string;
    manifestHash: Hex;
    nonce: Hex;
    expiresAt: number;
}
```

Fields:

- **` version `**: Service challenge format version; currently 1.
- **` chainId `**: Chain containing the approved service identity.
- **` registry `**: ServiceRegistry contract for the challenge.
- **` serviceId `**: Registered service identity that must answer the challenge.
- **` revision `**: Approved uint64 registry revision represented as decimal text.
- **` endpoint `**: Canonical HTTPS endpoint bound into the challenge.
- **` manifestHash `**: Approved hash of the canonical service manifest bytes.
- **` nonce `**: Fresh 32-byte challenge nonce encoded as lowercase hexadecimal.
- **` expiresAt `**: Challenge expiration time in Unix seconds.

### ServiceDiscoveryTransport

Trusted transport boundary. Implementations must enforce destination policy at connection time,
verified TLS, no redirects/proxies/credentials, body limits and cancellation. Use chain/node in Node.
Native browser fetch cannot enforce DNS policy; it is intentionally not a default implementation.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L234)

```ts
export interface ServiceDiscoveryTransport {
    request(url: string, options: {
        body?: Uint8Array;
        maxBytes: number;
        signal: AbortSignal;
    }): Promise<Uint8Array>;
}
```

Fields:

- **` request `**: Perform a bounded request using the required destination, TLS and cancellation policy; return response bytes.

### ServiceManifest

Canonical public metadata binding a service endpoint to its registry identity.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L38)

```ts
export interface ServiceManifest {
    schemaVersion: 1;
    chainId: number;
    registry: Address;
    serviceId: Hex;
    serviceType: ServiceType;
    endpoint: string;
    protocol: typeof SERVICE_IDENTITY_PROTOCOL;
    capabilities: string[];
}
```

Fields:

- **` schemaVersion `**: Service manifest encoding version; currently 1.
- **` chainId `**: Chain on which the service identity is registered.
- **` registry `**: ServiceRegistry contract holding the approved identity.
- **` serviceId `**: 32-byte registered service identifier.
- **` serviceType `**: Registered service category: relayer, verifier agent or vault service.
- **` endpoint `**: Canonical HTTPS service base URL pinned by the manifest.
- **` protocol `**: Required service identity protocol identifier.
- **` capabilities `**: Unique capability names committed in the service manifest.

### ServiceRecord

Provider claims, not authenticated endpoints or platform endorsements.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/services.ts#L21)

```ts
export interface ServiceRecord {
    owner: Address;
    pendingOwner: Address;
    authKey: Address;
    serviceType: ServiceType;
    status: ServiceStatus;
    revision: bigint;
    manifestHash: Hex;
    endpoint: string;
}
```

Fields:

- **` owner `**: Current provider account controlling the registration.
- **` pendingOwner `**: Account nominated for ownership transfer; zero when none is pending.
- **` authKey `**: Address whose key must sign endpoint identity challenges.
- **` serviceType `**: Registered capability family.
- **` status `**: Provider lifecycle state.
- **` revision `**: Registry revision used to detect changed provider metadata.
- **` manifestHash `**: Keccak-256 digest of the exact published manifest bytes.
- **` endpoint `**: Registered canonical HTTPS service base URL.

### ServiceStatus

Registry lifecycle status indicating whether a service accepts new work.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/services.ts#L18)

```ts
export type ServiceStatus = (typeof SERVICE_STATUSES)[keyof typeof SERVICE_STATUSES];
```

### ServiceType

Registry ordinal identifying a gas relay, verifier agent or vault service.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/services.ts#L14)

```ts
export type ServiceType = (typeof SERVICE_TYPES)[keyof typeof SERVICE_TYPES];
```

### SignedHeartbeat

Operator heartbeat carrying an epoch, public key and signature; reading it does not verify it.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/offchain.ts#L109)

```ts
export interface SignedHeartbeat {
    operator: string;
    epoch: number;
    pubkey: string;
    signature: string;
    [k: string]: unknown;
}
```

Fields:

- **` operator `**: Operator address claimed by the heartbeat.
- **` epoch `**: Heartbeat epoch reported by the operator; not a slot key epoch.
- **` pubkey `**: Encoded public key included with the heartbeat.
- **` signature `**: Encoded heartbeat signature; callers must verify it before trusting the heartbeat.

### SlotAuthType

Authorization family recorded at creation. The default unspecified value declares no family. This label is not included in the committee-selection commitment.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/write.ts#L105)

```ts
export type SlotAuthType = 'unspecified' | 'oid4vp' | 'oauth';
```

### SlotCommitteeDecryptOptions

Everything a committee-authorized threshold decrypt needs beyond the slot id.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/committeeClient.ts#L80)

```ts
export interface SlotCommitteeDecryptOptions {
    ciphertext: Ciphertext;
    identity: Uint8Array;
    decryptingSet: number[];
    blsPeers: BlsPeer[];
    userSignature?: Uint8Array;
    ciphertextEpoch?: number;
    targetKeykeeper?: string;
}
```

Fields:

- **` ciphertext `**: Group ciphertext to decrypt through committee authorization.
- **` identity `**: Original associated data used when encrypting the group ciphertext.
- **` decryptingSet `**: BLS identifiers (k..n, distinct) to run the ceremony with.
- **` blsPeers `**: The libp2p peers for those identifiers.
- **` userSignature `**: Optional Ed25519 slot-owner signature required by the keeper policy.
- **` ciphertextEpoch `**: Expected slot key epoch for detecting ciphertext-key rotation.
- **` targetKeykeeper `**: Pin the keeper this request targets (anti-Sybil); an on-chain assigned operator.

### SlotCommitteeSignOptions

Per-call overrides for a committee-authorized FROST signature.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/committeeClient.ts#L69)

```ts
export interface SlotCommitteeSignOptions {
    signingSet?: number[];
    userSignature?: Uint8Array;
    targetKeykeeper?: string;
}
```

Fields:

- **` signingSet `**: Optional FROST participant identifiers selected for signing.
- **` userSignature `**: Optional Ed25519 slot-owner approval signature for the signing request.
- **` targetKeykeeper `**: Pin the keeper this request targets (anti-Sybil). Must be one of the slot's on-chain assigned operators; there is no way to point at an off-chain node.

### SlotGroupKey

The slot's on-chain group public key + epoch (and mode), for local envelope encrypt.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/discovery.ts#L108)

```ts
export interface SlotGroupKey {
    publicKey: `0x${string}`;
    epoch: number;
    mode: number;
}
```

Fields:

- **` publicKey `**: 0x-prefixed group public key (96-byte compressed G2 for a BLS slot).
- **` epoch `**: Slot key epoch associated with the returned group public key.
- **` mode `**: 0 = frost, 1 = bls (KeyRegistry.Mode). Encrypt applies to BLS slots.

### SlotMode

The slot's key type, mirroring `KeyRegistry.Mode` on-chain:
`frost` Ed25519 threshold signatures, `bls` BLS12-381 encryption/decryption,
`tecdsa` secp256k1 threshold ECDSA (an EVM account - what `signEoaDigest` needs),
`bls-bn254`, and `tecdsa-p256` (ES256). A deployment need not run keepers for
every mode; creating a slot the network cannot key leaves it without a group key.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/write.ts#L92)

```ts
export type SlotMode = 'frost' | 'bls' | 'tecdsa' | 'bls-bn254' | 'tecdsa-p256';
```

### SlotSeed

What an accountant returns from `POST /v1/slot-seed`.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/slotSeed.ts#L22)

```ts
export interface SlotSeed {
    commitment: Hex;
    digest: Hex;
    signature: Hex;
}
```

Fields:

- **` commitment `**: Creation commitment for which the seed was requested.
- **` digest `**: `KeyRegistry.commitSeedDigest(commitment)` - what the signature is over.
- **` signature `**: The 64-byte BN254 G1 threshold signature; pass as `seedSig` to `revealKeySlotWithSeed`.

### SlotSeedOptions

Accountant endpoint overrides and per-request timeout for committee seed discovery.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/slotSeed.ts#L70)

```ts
export interface SlotSeedOptions {
    urls?: string[];
    timeoutMs?: number;
}
```

Fields:

- **` urls `**: Accountant base URLs. Resolved from `NodeRegistry` when omitted.
- **` timeoutMs `**: Per-accountant HTTP timeout. The round itself is bounded server-side.

### TasraChainClient

A read client for a deployment: a configured viem client, log helpers and typed readers.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/client.ts#L229)

```ts
export interface TasraChainClient {
    client: PublicClient;
    addresses: AddressBook;
    deployedContracts(): ContractName[];
    logSources(contracts?: ContractName[]): Array<{
        address: Address;
        contract: ContractName;
    }>;
    readMany<T>(contract: ContractName, functionName: string, argsList: readonly unknown[][], opts?: ReadManyOpts & {
        allowFailure?: true;
    }): Promise<Array<T | null>>;
    readMany<T>(contract: ContractName, functionName: string, argsList: readonly unknown[][], opts: ReadManyOpts & {
        allowFailure: false;
    }): Promise<T[]>;
    multicallAddress(): Promise<Address | null>;
    getBlockNumber(): Promise<bigint>;
    getLogsWindowed(opts: GetLogsWindowedOpts): Promise<DecodedEvent[]>;
    getBlockTimestamps(blockNumbers: Iterable<bigint>): Promise<Map<string, number>>;
    read<C extends ContractName>(contract: C, functionName: string, args?: readonly unknown[]): Promise<unknown>;
    readers: TasraChainReaders;
}
```

Fields:

- **` client `**: The configured viem public client. No wallet, no signing. not multicall-batched: batching is applied explicitly in ` readMany `, so a chain without Multicall3 keeps working. Firing many reads concurrently through this client costs one request each - go through `readMany` for a per-item fan-out.
- **` addresses `**: The deployment's resolved contract addresses.
- **` deployedContracts `**: Return known contract names with configured addresses; this does not probe their deployed code.
- **` logSources `**: Return distinct configured event-source addresses and their ABIs, including vesting tranches.
- **` readMany `**: Read one view function across many argument lists. Batched via Multicall3 when available; a failing item is `null` unless `allowFailure: false`.
- **` multicallAddress `**: The Multicall3 address `readMany` will batch through, or `null` when it will read items individually. Resolved once per client and cached; exposed so a caller can see which mode it is in rather than inferring it from request counts.
- **` getBlockNumber `**: Read the current chain block number from the configured RPC.
- **` getLogsWindowed `**: Scan an inclusive block range in windows and return decoded events.
- **` getBlockTimestamps `**: Read Unix timestamps in seconds, keyed by decimal block-number strings.
- **` read `**: Call a named read function through the configured address and known contract ABI.
- **` readers `**: Contract-specific read methods bound to the configured deployment.

### TasraSlotClient

Managed slot-session factory that resolves keeper and verifier endpoints from the registry.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/slotClient.ts#L58)

```ts
export interface TasraSlotClient {
    openSession(slotId: string, auth: SessionAuth, opts?: OpenSessionOpts): Promise<Session>;
    resolveEndpoints(slotId: string): Promise<ResolvedEndpoints>;
    verifierDirectory(): Promise<CommitteeVerifier[]>;
    sessions(): readonly Session[];
    closeAll(): Promise<void>;
}
```

Fields:

- **` openSession `**: Discover the slot's nodes + choose a verifier from chain, mint the JWT via that verifier, and return a managed session (encrypt / decrypt / sign).
- **` resolveEndpoints `**: Resolve the endpoints for a slot WITHOUT opening a session (which verifier would be chosen + the slot's keeper committee). Handy for inspection.
- **` verifierDirectory `**: The discovered active verifier directory (cached).
- **` sessions `**: Return currently open managed sessions.
- **` closeAll `**: Close all managed sessions and clear their reconstructed key material.

### TasraSlotClientConfig

Chain discovery and authorization options for a managed JWT slot session.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/slotClient.ts#L40)

```ts
export interface TasraSlotClientConfig {
    chain: TasraChainClient;
    identity?: string;
    rewriteUrl?: (url: string) => string;
    onResolve?: (r: ResolvedEndpoints) => void;
    skewMs?: number;
}
```

Fields:

- **` chain `**: Read client for the deployment (RPC + address book).
- **` identity `**: This holder's DID (recipient_did / holder for the JWT).
- **` rewriteUrl `**: Explicit routing from registered service URLs to reachable URLs. Omission uses registry URLs unchanged.
- **` onResolve `**: Observe the per-session resolution (chosen verifier + discovered nodes).
- **` skewMs `**: JWT refresh skew (ms), forwarded to the session.

### TasraWriteClient

Account-bound operations for slot creation, lifecycle management, settlement funding and token transactions.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/write.ts#L995)

```ts
export interface TasraWriteClient {
    account: Account;
    address: Address;
    wallet: WalletClient<Transport, Chain, Account>;
    pub: PublicClient;
    createSlot(args: CreateSlotArgs): Promise<{
        slotId: Hex;
        txHash: Hex;
        ruleSalt: Hex;
        relay?: RelayReceipt;
    }>;
    createSlotCommitReveal(args: CreateSlotArgs & CommitRevealOptions): Promise<{
        slotId: Hex;
        commitTx: Hex;
        revealTx: Hex;
        targetEpoch: number;
        ruleSalt: Hex;
        seeded: boolean;
    }>;
    fundSlot(slotId: Hex, amount: bigint): Promise<{
        approveTx: Hex;
        fundTx: Hex;
        relay?: RelayReceipt;
    }>;
    sendEth(to: Address, wei: bigint): Promise<Hex>;
    transferTsra(to: Address, amount: bigint): Promise<Hex>;
    rotateKey(slotId: Hex, reason?: string): Promise<Hex>;
    reshareKey(slotId: Hex, newOperators: Address[], k: number, n: number, reason?: string): Promise<Hex>;
    cancelSlot(slotId: Hex): Promise<Hex>;
    renewSlot(slotId: Hex): Promise<Hex>;
    setVerifierPolicy(slotId: Hex, committee: number, quorum: number, onTransaction?: (event: {
        phase: 'submitting' | 'submitted' | 'confirmed';
        hash?: Hex;
    }) => Promise<void>): Promise<Hex>;
    setRulePolicy(slotId: Hex, policy: RulePolicyArgs): Promise<Hex>;
    buyTsra(eurcAmount: bigint, minTsraOut: bigint): Promise<Hex>;
    approveEurcForCurve(amount: bigint): Promise<Hex>;
    mintMockEurc(to: Address, amount: bigint): Promise<Hex>;
    eurcBalance(a: Address): Promise<bigint>;
    redeemTsra(tsraAmount: bigint, minEurcOut?: bigint): Promise<{
        approveTx: Hex;
        redeemTx: Hex;
    }>;
    burnTsra(amount: bigint): Promise<Hex>;
    spotPrice(): Promise<bigint>;
    priceAt(sold: bigint): Promise<bigint>;
    treasuryWithdraw(to: Address, amount: bigint): Promise<Hex>;
    treasuryRefund(to: Address, amount: bigint): Promise<Hex>;
    vaultRelease(tranche: VaultTranche): Promise<Hex>;
    tsraBalance(of?: Address): Promise<bigint>;
    ethBalance(of?: Address): Promise<bigint>;
    settlementBalance(slotId: Hex): Promise<bigint>;
    relayEnabled: boolean;
    lastRelay(): RelayReceipt | undefined;
    pendingRelayAttempt(): RelayAttempt | undefined;
    reconcileRelay(): Promise<{
        receipt?: RelayReceipt;
        expired: boolean;
    } | undefined>;
}
```

Fields:

- **` account `**: The account every write is signed with.
- **` address `**: Convenience alias for `account.address`.
- **` wallet `**: The underlying wallet client.
- **` pub `**: A read client on the same RPC, used for receipts and balance reads.
- **` createSlot `**: Create a slot directly. Persist the generated slot ID and rule salt; provisioning requires the saved salt. Use prepared creation to persist the intent before submission.
- **` createSlotCommitReveal `**: Create a slot using commit-reveal, trying an accountant seed before waiting for a beacon epoch. Persist the slot ID and rule salt; prepared creation preserves them before submission.
- **` fundSlot `**: Approve TSRA and fund the slot settlement balance in token base units.
- **` sendEth `**: Send native currency in base units and wait for a successful receipt.
- **` transferTsra `**: Transfer TSRA in token base units and wait for confirmation.
- **` rotateKey `**: Request a new distributed key generation epoch for the slot.
- **` reshareKey `**: Redistribute the slot key among the supplied operators using the new threshold.
- **` cancelSlot `**: Cancel the slot using the configured account authority.
- **` renewSlot `**: Renew the slot lease; the configured account must be its creator.
- **` setVerifierPolicy `**: Set the verifier committee size and quorum, optionally persisting transaction progress.
- **` setRulePolicy `**: Pin amendment authority while the slot is fresh. Prefer passing rulePolicy at creation so key generation cannot win the race. The guardian must differ from the administrator, and omitting a guardian requires the contract minimum timelock.
- **` buyTsra `**: Buy TSRA with approved EURC while enforcing the minimum output amount.
- **` approveEurcForCurve `**: Approve the bonding curve to spend the specified EURC base units.
- **` mintMockEurc `**: Mint test EURC only after verifying the network and mock-token faucet policy.
- **` eurcBalance `**: Read an account EURC balance in base units.
- **` redeemTsra `**: Approve and redeem TSRA for EURC, enforcing any minimum output.
- **` burnTsra `**: Permanently burn TSRA from the configured account.
- **` spotPrice `**: Read the current bonding-curve spot price.
- **` priceAt `**: Read the bonding-curve price at the supplied sold-token amount.
- **` treasuryWithdraw `**: Request an authorized treasury withdrawal to the recipient.
- **` treasuryRefund `**: Request an authorized treasury refund to the recipient.
- **` vaultRelease `**: Release currently vested tokens for the named allocation.
- **` tsraBalance `**: Read TSRA base units for the supplied account or the configured signer.
- **` ethBalance `**: Read native-token base units for the supplied account or configured signer.
- **` settlementBalance `**: Read the prepaid TSRA settlement balance of a slot.
- **` relayEnabled `**: Whether writes are submitted through a registered relay rather than directly.
- **` lastRelay `**: Return the last verified relay receipt, if any.
- **` pendingRelayAttempt `**: Return the signed relay attempt awaiting reconciliation, if any.
- **` reconcileRelay `**: Inspect the pending attempt against the chain without signing a replacement.

### VaultTranche

Named vesting allocation used to resolve its deployed vault.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/deployments.ts#L71)

```ts
export type VaultTranche = (typeof VAULT_TRANCHES)[number];
```

### VerifierInfo

Verifier-reported runtime settings and token lifetime.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/offchain.ts#L172)

```ts
export interface VerifierInfo {
    version?: string;
    uptime_secs?: number;
    jwt_ttl_secs?: number;
    rate_limit_enabled?: boolean;
    [k: string]: unknown;
}
```

Fields:

- **` version `**: Verifier software version reported by the service.
- **` uptime_secs `**: Verifier process uptime in seconds.
- **` jwt_ttl_secs `**: Reported bearer-token lifetime in seconds.
- **` rate_limit_enabled `**: Whether the verifier reports rate limiting as enabled.

### WriteClientConfig

Either a private-key signer or an account-bound wallet with network write configuration.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/write.ts#L159)

```ts
export type WriteClientConfig = WriteClientKeyConfig | WriteClientWalletConfig;
```

Fields:

- **` wallet `**: Account-bound and chain-bound wallet used for writes; mutually exclusive with a raw private key. Must be omitted when supplying a raw private key.
- **` privateKey `**: Must be omitted when supplying a wallet signer. The client's own 0x-prefixed 32-byte private key (it signs + pays gas).
- **` rpcUrl `**: JSON-RPC endpoint for the deployment selected from the network manifest.
- **` addresses `**: Deployed contract address book from the selected network manifest.
- **` relay `**: When set, sender-bound calls are gas-sponsored through the platform relayer.
- **` chainId `**: EVM chain ID from the network manifest. Defaults to the bound wallet chain, or DEFAULT_CHAIN_ID for a loopback RPC when no chain is supplied.

### WriteClientKeyConfig

Sovereign-key variant: the SDK owns the account and signs with `privateKey`.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/write.ts#L139)

```ts
export interface WriteClientKeyConfig extends WriteClientConfigBase {
    privateKey: Hex;
    wallet?: undefined;
}
```

Fields:

- **` privateKey `**: The client's own 0x-prefixed 32-byte private key (it signs + pays gas).
- **` wallet `**: Must be omitted when supplying a raw private key.
- **` rpcUrl `**: JSON-RPC endpoint for the deployment selected from the network manifest.
- **` addresses `**: Deployed contract address book from the selected network manifest.
- **` relay `**: When set, sender-bound calls are gas-sponsored through the platform relayer.
- **` chainId `**: EVM chain ID from the network manifest. Defaults to the bound wallet chain, or DEFAULT_CHAIN_ID for a loopback RPC when no chain is supplied.

### WriteClientWalletConfig

Account-bound and chain-bound viem wallet used for signing without exposing its private key. Reads and receipt polling use the separately configured RPC.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/write.ts#L149)

```ts
export interface WriteClientWalletConfig extends WriteClientConfigBase {
    wallet: WalletClient<Transport, Chain, Account>;
    privateKey?: undefined;
}
```

Fields:

- **` wallet `**: Account-bound and chain-bound wallet used for writes; mutually exclusive with a raw private key.
- **` privateKey `**: Must be omitted when supplying a wallet signer.
- **` rpcUrl `**: JSON-RPC endpoint for the deployment selected from the network manifest.
- **` addresses `**: Deployed contract address book from the selected network manifest.
- **` relay `**: When set, sender-bound calls are gas-sponsored through the platform relayer.
- **` chainId `**: EVM chain ID from the network manifest. Defaults to the bound wallet chain, or DEFAULT_CHAIN_ID for a loopback RPC when no chain is supplied.

## Constants and ABI values

Shared values and contract definitions.

| Export | Description | Definition |
|---|---|---|
| `ACCOUNTANT_TAG` | The on-chain role tag accountant operators register under: `keccak256("accountant")`. The same tag the accountants themselves resolve their set with. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/discovery.ts#L140) |
| `accountantSetRegistryAbi` | AccountantSetRegistry contract interface for accountant-set snapshots and membership evidence. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/abis/accountantSetRegistry.ts#L5) |
| `accountantSlashingAbi` | AccountantSlashing contract interface for accountant penalties and related evidence. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/abis/accountantSlashing.ts#L5) |
| `bondingCurveAbi` | BondingCurve contract interface for TSRA purchases, redemptions and pricing. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/abis/bondingCurve.ts#L5) |
| `CONTRACT_ABIS` | Contract name to ABI. Keys match Foundry artifact names. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/abis/index.ts#L46) |
| `CONTRACT_CATEGORY` | Default category per contract (the global event feed groups by this). | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/events.ts#L23) |
| `DEFAULT_CHAIN_ID` | Fallback chain ID retained for explicitly configured loopback connections. Set the chain ID from the downloaded tasra-releases network manifest for deployment access. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/deployments.ts#L64) |
| `equivocationSlasherAbi` | EquivocationSlasher contract interface for submitting conflicting-signature evidence. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/abis/equivocationSlasher.ts#L5) |
| `fixedTasraPriceOracleAbi` | FixedTasraPriceOracle contract interface for converting TSRA amounts using the configured fixed exchange rate. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/abis/fixedTasraPriceOracle.ts#L5) |
| `IMPLEMENTATION_SLOT` | EIP-1967 storage slot containing a proxy implementation address. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/manifest.ts#L168) |
| `keeperShareRegistryAbi` | KeeperShareRegistry contract interface for anchored keeper verifying-share commitments. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/abis/keeperShareRegistry.ts#L5) |
| `keyRegistryAbi` | KeyRegistry contract interface for slot creation, key epochs and authorization policies. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/abis/keyRegistry.ts#L5) |
| `livenessRegistryAbi` | LivenessRegistry contract interface for registered operator liveness observations. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/abis/livenessRegistry.ts#L5) |
| `mockEurcAbi` | MockEurc contract interface for test-token balances, transfers, approvals and minting. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/abis/mockEurc.ts#L5) |
| `NETWORKS` | Built-in network defaults; use a tasra-releases manifest for deployed contract addresses. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/networks.ts#L39) |
| `nodeApi` | Direct keeper HTTP reads for status, keys, public keys, heartbeats and metering. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/offchain.ts#L143) |
| `nodeRegistryAbi` | NodeRegistry contract interface for operator registration, role tags, stake and activity. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/abis/nodeRegistry.ts#L5) |
| `platformExecutorAbi` | PlatformExecutor contract interface for platform-authorized contract execution. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/abis/platformExecutor.ts#L5) |
| `prevrandaoSaltBeaconAbi` | PrevrandaoSaltBeacon contract interface for chain-randomness-derived committee seeds. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/abis/prevrandaoSaltBeacon.ts#L5) |
| `PROVISION_RULE_ACTION` | Action identifier accepted by the creator-authorized rule provisioning endpoint. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/provisionRule.ts#L33) |
| `SERVICE_CHALLENGE_LIFETIME_SECONDS` | Challenge lifetime in seconds, leaving room for clock differences. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L29) |
| `SERVICE_CHALLENGE_SECONDS` | Maximum accepted identity challenge validity window in seconds. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L24) |
| `SERVICE_IDENTITY_MAX_BYTES` | Maximum accepted identity challenge response size in bytes. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L20) |
| `SERVICE_IDENTITY_PATH` | HTTPS endpoint that signs a registered-service identity challenge. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L12) |
| `SERVICE_IDENTITY_PROTOCOL` | Protocol identifier required in registered-service manifests. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L33) |
| `SERVICE_MANIFEST_MAX_BYTES` | Maximum accepted service manifest size in bytes. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L16) |
| `SERVICE_MANIFEST_PATH` | HTTPS path where a registered service publishes its canonical manifest. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L8) |
| `SERVICE_STATUSES` | Registry lifecycle ordinals for active, draining and retired services. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/services.ts#L10) |
| `SERVICE_TYPES` | Permanent ServiceRegistry ABI ordinals. Registration grants no operator privileges. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/services.ts#L6) |
| `serviceRegistryAbi` | ServiceRegistry contract interface for provider-owned service records and lifecycle updates. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/abis/serviceRegistry.ts#L5) |
| `settlementAbi` | Settlement contract interface for prepaid slot balances and operation settlement. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/abis/settlement.ts#L5) |
| `tasraSwapRouterAbi` | TasraSwapRouter contract interface for routed token exchanges. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/abis/tasraSwapRouter.ts#L5) |
| `tasraTokenAbi` | TasraToken contract interface for TSRA balances, transfers, approvals and supply. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/abis/tasraToken.ts#L5) |
| `tasraVestingVaultAbi` | TasraVestingVault contract interface for allocation vesting and token release. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/abis/tasraVestingVault.ts#L5) |
| `thresholdRandomBeaconAbi` | ThresholdRandomBeacon contract interface for threshold-signed randomness epochs. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/abis/thresholdRandomBeacon.ts#L5) |
| `treasuryAbi` | Treasury contract interface for treasury balances, authorized withdrawals and refunds. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/abis/treasury.ts#L5) |
| `VAULT_TRANCHES` | The vesting tranches Deploy.s.sol creates, in the order it creates them. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/deployments.ts#L67) |
| `VERIFIER_TAG` | The on-chain role tag verifier operators register under: `keccak256("verifier")`. The same tag the accountants use to build the settlement split, and the CLI to resolve a tagged operator set. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/discovery.ts#L28) |
| `verifierApi` | Direct verifier HTTP reads for status and Prometheus metrics. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/offchain.ts#L187) |
| `verifierSetRegistryAbi` | VerifierSetRegistry contract interface for verifier-set snapshots and membership roots. | [Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/abis/verifierSetRegistry.ts#L5) |
