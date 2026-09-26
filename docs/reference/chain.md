# tasra-sdk/chain

Generated from public TypeScript exports. Run `npm run docs:reference` to update.

[Reference index](README.md) · [Task guides](../README.md) · [Errors](../errors.md)

<details>
<summary>Find an export</summary>

- [Address](#address)
- [AddressBook](#addressbook)
- [addressBookFromBroadcast](#addressbookfrombroadcast)
- [addressBookFromEnv](#addressbookfromenv)
- [addressBookFromManifest](#addressbookfrommanifest)
- [addressBookFromObject](#addressbookfromobject)
- [AgentSessionCreationUnknownError](#agentsessioncreationunknownerror)
- [AgentTransport](#agenttransport)
- [ApplicationServiceProfiles](#applicationserviceprofiles)
- [applicationServiceProfilesDocument](#applicationserviceprofilesdocument)
- [ApprovedAgentProfile](#approvedagentprofile)
- [ApprovedServiceProfile](#approvedserviceprofile)
- [assertEurcFaucetAllowed](#asserteurcfaucetallowed)
- [assertExpiredSlotCommitment](#assertexpiredslotcommitment)
- [assertRegisteredWalletRequest](#assertregisteredwalletrequest)
- [authenticateApprovedService](#authenticateapprovedservice)
- [AuthenticatedService](#authenticatedservice)
- [awaitRegisteredVerifierAgentResult](#awaitregisteredverifieragentresult)
- [categoryFor](#categoryfor)
- [ChainClientConfig](#chainclientconfig)
- [CommitRevealOptions](#commitrevealoptions)
- [CommitteeDecryptOptions](#committeedecryptoptions)
- [CommitteeSignOptions](#committeesignoptions)
- [CommitteeSlotClient](#committeeslotclient)
- [CommitteeSlotClientConfig](#committeeslotclientconfig)
- [ContractName](#contractname)
- [ContractObservation](#contractobservation)
- [ContractRecord](#contractrecord)
- [createCommitteeSlotClient](#createcommitteeslotclient)
- [createRegisteredAgentClient](#createregisteredagentclient)
- [createRegisteredRelaySubmitter](#createregisteredrelaysubmitter)
- [CreateSlotArgs](#createslotargs)
- [createTasraChainClient](#createtasrachainclient)
- [createTasraSlotClient](#createtasraslotclient)
- [createTasraWriteClient](#createtasrawriteclient)
- [decodeContractLogs](#decodecontractlogs)
- [DecodedEvent](#decodedevent)
- [deriveServiceId](#deriveserviceid)
- [encodeServiceChallenge](#encodeservicechallenge)
- [encodeServiceManifest](#encodeservicemanifest)
- [EventCategory](#eventcategory)
- [eventNamesOf](#eventnamesof)
- [FetchOpts](#fetchopts)
- [formatBps](#formatbps)
- [formatUnits](#formatunits)
- [formatWad](#formatwad)
- [generateClientKey](#generateclientkey)
- [GetLogsWindowedOpts](#getlogswindowedopts)
- [hashServiceManifest](#hashservicemanifest)
- [jsonSafe](#jsonsafe)
- [KeeperProvisionResult](#keeperprovisionresult)
- [KeyListReply](#keylistreply)
- [KeySlotSummary](#keyslotsummary)
- [MeteringReply](#meteringreply)
- [NetworkManifest](#networkmanifest)
- [NetworkName](#networkname)
- [networkNameForChain](#networknameforchain)
- [NetworkPreset](#networkpreset)
- [NodeInfo](#nodeinfo)
- [observeNetworkManifest](#observenetworkmanifest)
- [openRegisteredVerifierAgentSession](#openregisteredverifieragentsession)
- [parseApplicationServiceProfiles](#parseapplicationserviceprofiles)
- [parseNetworkManifest](#parsenetworkmanifest)
- [parsePinnedNetworkManifest](#parsepinnednetworkmanifest)
- [parsePrometheus](#parseprometheus)
- [parseServiceChallenge](#parseservicechallenge)
- [provisionRule](#provisionrule)
- [ProvisionRuleArgs](#provisionruleargs)
- [ProvisionRuleResult](#provisionruleresult)
- [provisionRuleTypedData](#provisionruletypeddata)
- [readApprovedServiceRecord](#readapprovedservicerecord)
- [reconcileRelayAttempt](#reconcilerelayattempt)
- [RegisteredAgentSession](#registeredagentsession)
- [RegisteredRelayConfig](#registeredrelayconfig)
- [RegisteredVerifierAgentSession](#registeredverifieragentsession)
- [RelayAttempt](#relayattempt)
- [RelayConfig](#relayconfig)
- [RelayIntent](#relayintent)
- [RelayOutcomeUnknownError](#relayoutcomeunknownerror)
- [RelayReceipt](#relayreceipt)
- [RelayReconciliation](#relayreconciliation)
- [RelayTransport](#relaytransport)
- [requestSlotSeed](#requestslotseed)
- [requireAddress](#requireaddress)
- [requireVaultAddress](#requirevaultaddress)
- [resolveAccountantUrls](#resolveaccountanturls)
- [ResolvedEndpoints](#resolvedendpoints)
- [ResolvedNetworkProfile](#resolvednetworkprofile)
- [resolveNetworkProfile](#resolvenetworkprofile)
- [resolveSlotGroupKey](#resolveslotgroupkey)
- [resolveSlotKeeperUrls](#resolveslotkeeperurls)
- [resolveVerifierDirectory](#resolveverifierdirectory)
- [ruleCommitment](#rulecommitment)
- [ServiceApproval](#serviceapproval)
- [ServiceChallenge](#servicechallenge)
- [serviceChallengeTypedData](#servicechallengetypeddata)
- [ServiceDiscoveryTransport](#servicediscoverytransport)
- [ServiceManifest](#servicemanifest)
- [ServiceRecord](#servicerecord)
- [ServiceStatus](#servicestatus)
- [ServiceType](#servicetype)
- [SignedHeartbeat](#signedheartbeat)
- [SlotAuthType](#slotauthtype)
- [SlotCommitmentExpiredError](#slotcommitmentexpirederror)
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
- [truncateHex](#truncatehex)
- [validateServiceChallenge](#validateservicechallenge)
- [validateServiceEndpoint](#validateserviceendpoint)
- [vaultKey](#vaultkey)
- [VaultTranche](#vaulttranche)
- [VerifierInfo](#verifierinfo)
- [verifyRuleCommitment](#verifyrulecommitment)
- [verifyServiceIdentity](#verifyserviceidentity)
- [verifyServiceManifest](#verifyservicemanifest)
- [WriteClientConfig](#writeclientconfig)
- [WriteClientKeyConfig](#writeclientkeyconfig)
- [WriteClientWalletConfig](#writeclientwalletconfig)
- [Constants and ABI values](#constants-and-abi-values)

</details>

## Address

See the declaration and linked source for the contract.

[Source](../../src/chain/deployments.ts#L20)

```ts
export type Address = `0x${string}`
```

## AddressBook

Canonical contract name → deployed address (lowercased keys allowed too).

[Source](../../src/chain/deployments.ts#L23)

```ts
export type AddressBook = Partial<Record<ContractName, Address>> & {
  [k: string]: Address | undefined
}
```

## addressBookFromBroadcast

Build an AddressBook from a parsed Foundry broadcast run JSON. The last
deployment of a given contract name wins (re-deploys later in the run
override). Proxied contracts resolve to the proxy, which is the address
callers must actually talk to.

[Source](../../src/chain/deployments.ts#L157)

Import: `import {addressBookFromBroadcast} from 'tasra-sdk/chain'`

```ts
declare function addressBookFromBroadcast(json: unknown): AddressBook
```

| Parameter | Type | Description |
|---|---|---|
| `json` | `unknown` |  |

Returns: `AddressBook`.

## addressBookFromEnv

Build an AddressBook from deployment environment variables, resolving the
`ENV_ALIASES` shorthands (`KEY_REGISTRY`, `BEACON`, `TSRA_TOKEN`, …) to their
canonical contract names. Entries whose value is not a 0x-address are ignored,
so passing a whole `process.env` is safe.

Accepts either form:
- a **`chain.env`-style KEY=VALUE blob** — `#` comments, optional `export`
  prefixes, and quoted values are all handled
- an **environment object** such as `process.env` or `import.meta.env`

[Source](../../src/chain/deployments.ts#L281)

Import: `import {addressBookFromEnv} from 'tasra-sdk/chain'`

```ts
declare function addressBookFromEnv(src: string | Record<string, string | undefined>): AddressBook
```

| Parameter | Type | Description |
|---|---|---|
| `src` | `string &#124; Record<string, string &#124; undefined>` | the KEY=VALUE text blob, or an env-like object |

Returns: `AddressBook`.

Return details: an AddressBook keyed by canonical contract name (raw keys are kept too)

Example from source:

```ts
// from the ambient environment
const addresses = addressBookFromEnv(process.env)

// or from a deployment's chain.env file
const addresses = addressBookFromEnv(await readFile('chain.env', 'utf8'))
```

## addressBookFromManifest

Planned and retired records can be displayed, but cannot configure a live client.

[Source](../../src/chain/manifest.ts#L92)

Import: `import {addressBookFromManifest} from 'tasra-sdk/chain'`

```ts
declare function addressBookFromManifest(manifest: NetworkManifest): AddressBook
```

| Parameter | Type | Description |
|---|---|---|
| `manifest` | `NetworkManifest` |  |

Returns: `AddressBook`.

## addressBookFromObject

Normalise an explicit object into an AddressBook (validates addresses).

[Source](../../src/chain/deployments.ts#L302)

Import: `import {addressBookFromObject} from 'tasra-sdk/chain'`

```ts
declare function addressBookFromObject(obj: Record<string, string>): AddressBook
```

| Parameter | Type | Description |
|---|---|---|
| `obj` | `Record<string, string>` |  |

Returns: `AddressBook`.

## AgentSessionCreationUnknownError

See the declaration and linked source for the contract.

[Source](../../src/chain/registeredAgent.ts#L24)

```ts
(profile: Readonly<ApprovedAgentProfile>): AgentSessionCreationUnknownError
```

Import: `import {AgentSessionCreationUnknownError} from 'tasra-sdk/chain'`

- `profile: Readonly<ApprovedAgentProfile>` — 
- `name: string` — 
- `message: string` — 
- `stack: string &#124; undefined` — 
- `cause: unknown` — 

## AgentTransport

See the declaration and linked source for the contract.

[Source](../../src/chain/registeredAgent.ts#L6)

```ts
export interface AgentTransport extends ServiceDiscoveryTransport {
  /** Same socket/TLS policy as discovery; bearer is allowed only on a session GET. */
  agentRequest(url: string, options: {body?: Uint8Array; bearer?: string; maxBytes: number; signal: AbortSignal}): Promise<Uint8Array>
}
```

## ApplicationServiceProfiles

Reviewed application configuration, never a list downloaded from a service registry.

[Source](../../src/chain/serviceProfiles.ts#L12)

```ts
export interface ApplicationServiceProfiles {
  chainId: number
  registry: Address
  relayers: ApprovedServiceProfile[]
  verifierAgents: ApprovedAgentProfile[]
  vaultServices: ApprovedServiceProfile[]
}
```

## applicationServiceProfilesDocument

Publish only public approvals, with no runtime transport or private key material.

[Source](../../src/chain/serviceProfiles.ts#L66)

Import: `import {applicationServiceProfilesDocument} from 'tasra-sdk/chain'`

```ts
declare function applicationServiceProfilesDocument(profiles: ApplicationServiceProfiles): Record<string, unknown>
```

| Parameter | Type | Description |
|---|---|---|
| `profiles` | `ApplicationServiceProfiles` |  |

Returns: `Record<string, unknown>`.

## ApprovedAgentProfile

Both the application and committee verifiers must independently approve this verifier-agent identity.

[Source](../../src/chain/registeredAgent.ts#L12)

```ts
export interface ApprovedAgentProfile {
  approval: ServiceApproval
  endpoint: string
  clientId: string
}
```

## ApprovedServiceProfile

See the declaration and linked source for the contract.

[Source](../../src/chain/serviceProfiles.ts#L6)

```ts
export interface ApprovedServiceProfile {
  approval: ServiceApproval
  endpoint: string
}
```

## assertEurcFaucetAllowed

Recheck the actual RPC chain immediately before any faucet transaction.

[Source](../../src/chain/networks.ts#L55)

Import: `import {assertEurcFaucetAllowed} from 'tasra-sdk/chain'`

```ts
declare function assertEurcFaucetAllowed(profile: ResolvedNetworkProfile, actualChainId: number, actualEurcAddress: string): void
```

| Parameter | Type | Description |
|---|---|---|
| `profile` | `ResolvedNetworkProfile` |  |
| `actualChainId` | `number` |  |
| `actualEurcAddress` | `string` |  |

Returns: `void`.

## assertExpiredSlotCommitment

Read-only recovery gate. The caller must also reconcile every outstanding signed request.

[Source](../../src/chain/commitmentRecovery.ts#L16)

Import: `import {assertExpiredSlotCommitment} from 'tasra-sdk/chain'`

```ts
declare function assertExpiredSlotCommitment(chain: TasraChainClient, error: SlotCommitmentExpiredError): Promise<void>
```

| Parameter | Type | Description |
|---|---|---|
| `chain` | `TasraChainClient` |  |
| `error` | `SlotCommitmentExpiredError` |  |

Returns: `Promise<void>`.

## assertRegisteredWalletRequest

Bind the wallet's signed request to the operation and authenticated session before disclosure.

[Source](../../src/chain/registeredOperation.ts#L80)

Import: `import {assertRegisteredWalletRequest} from 'tasra-sdk/chain'`

```ts
declare function assertRegisteredWalletRequest(session: RegisteredVerifierAgentSession, ro: VerifiedRequestObject, status: SessionStatusResult): void
```

| Parameter | Type | Description |
|---|---|---|
| `session` | `RegisteredVerifierAgentSession` |  |
| `ro` | `VerifiedRequestObject` |  |
| `status` | `SessionStatusResult` |  |

Returns: `void`.

## authenticateApprovedService

Uncached, bounded discovery only. A result is a short-lived observation, not verifier-agent or gas authorization.

[Source](../../src/chain/serviceIdentity.ts#L170)

Import: `import {authenticateApprovedService} from 'tasra-sdk/chain'`

```ts
declare function authenticateApprovedService(chain: TasraChainClient, approved: ServiceApproval, transport: ServiceDiscoveryTransport): Promise<AuthenticatedService>
```

| Parameter | Type | Description |
|---|---|---|
| `chain` | `TasraChainClient` |  |
| `approved` | `ServiceApproval` |  |
| `transport` | `ServiceDiscoveryTransport` |  |

Returns: `Promise<AuthenticatedService>`.

## AuthenticatedService

See the declaration and linked source for the contract.

[Source](../../src/chain/serviceIdentity.ts#L161)

```ts
export interface AuthenticatedService {
  approval: ServiceApproval
  record: ServiceRecord
  manifest: ServiceManifest
  blockNumber: bigint
  expiresAt: number
}
```

## awaitRegisteredVerifierAgentResult

Poll the original authenticated session only; no URL reconstruction or provider failover.

[Source](../../src/chain/registeredOperation.ts#L34)

Import: `import {awaitRegisteredVerifierAgentResult} from 'tasra-sdk/chain'`

```ts
declare function awaitRegisteredVerifierAgentResult(session: RegisteredVerifierAgentSession, opts?: { intervalMs?: number; timeoutMs?: number; } & WaitOpts): Promise<VerifierAgentResult>
```

| Parameter | Type | Description |
|---|---|---|
| `session` | `RegisteredVerifierAgentSession` |  |
| `opts` | `{ intervalMs?: number; timeoutMs?: number; } & WaitOpts` |  |

Returns: `Promise<VerifierAgentResult>`.

## categoryFor

See the declaration and linked source for the contract.

[Source](../../src/chain/events.ts#L62)

Import: `import {categoryFor} from 'tasra-sdk/chain'`

```ts
declare function categoryFor(contract: ContractName, eventName: string): EventCategory
```

| Parameter | Type | Description |
|---|---|---|
| `contract` | `"NodeRegistry" &#124; "KeyRegistry" &#124; "ServiceRegistry" &#124; "Settlement" &#124; "TasraToken" &#124; "BondingCurve" &#124; "TasraSwapRouter" &#124; "Treasury" &#124; "TasraVestingVault" &#124; "ThresholdRandomBeacon" &#124; "PrevrandaoSaltBeacon" &#124; "EquivocationSlasher" &#124; "PlatformExecutor" &#124; "FixedTasraPriceOracle" &#124; "MockEurc" &#124; "AccountantSlashing" &#124; "LivenessRegistry" &#124; "VerifierSetRegistry" &#124; "AccountantSetRegistry" &#124; "KeeperShareRegistry"` |  |
| `eventName` | `string` |  |

Returns: `EventCategory`.

## ChainClientConfig

See the declaration and linked source for the contract.

[Source](../../src/chain/client.ts#L58)

```ts
export interface ChainClientConfig {
  /** JSON-RPC HTTP endpoint of the chain. */
  rpcUrl: string
  /** Resolved deployment addresses. */
  addresses: AddressBook
  /** Chain id; defaults to DEFAULT_CHAIN_ID (the RPC is never consulted). */
  chainId?: number
  /** getLogs block-window size; keep ≤ the RPC's range cap (anvil/besu: large; public: ~2k). */
  logWindow?: number
  /**
   * Where Multicall3 lives, for batching the per-item reads in {@link
   * TasraChainClient.readMany} (and therefore the registry enumerations built on it).
   *
   * - omitted — **auto**: probe {@link MULTICALL3_ADDRESS} once with `eth_getCode` and
   *   batch if something is deployed there. A chain without it costs one extra call,
   *   once, and then reads individually forever.
   * - an address — use that deployment instead of the canonical one. Still probed, so a
   *   wrong address degrades to individual reads rather than failing every read.
   * - `false` — never batch. For an RPC that rejects large `eth_call` payloads, or to
   *   keep one read per item for debugging.
   */
  multicall3?: Address | false
}
```

## CommitRevealOptions

Options for {@link TasraWriteClient.createSlotCommitReveal}.

The ADR-0075 fields are all opt-OUT or overrides: the default is to try the accountant set for
a per-commitment draw seed, and to fall back to the beacon-epoch wait when it cannot be had.

[Source](../../src/chain/write.ts#L169)

```ts
export interface CommitRevealOptions {
  /** Cap on the beacon-epoch wait, when the ADR-0075 fast path is unavailable. */
  maxWaitMs?: number
  /** Progress during that wait. Not called on the seeded path — there is no wait to report. */
  onEpoch?: (cur: number, target: number) => void
  /**
   * `false` skips the ADR-0075 seed request and goes straight to the epoch wait.
   *
   * ⚠ Turn this off only to exercise the ADR-0030 path deliberately (a test, or a deployment
   * whose accountants are known down). It is not a security control: both paths draw from a seed
   * that post-dates the commitment, and neither lets the creator choose.
   */
  slotSeed?: boolean
  /** Accountant base URLs for the seed request. Resolved from `NodeRegistry` when omitted. */
  accountantUrls?: string[]
  /** Per-accountant HTTP timeout for the seed request. */
  slotSeedTimeoutMs?: number
  /** The seed that was obtained, or `null` when the epoch wait is being used instead. */
  onSeed?: (seed: SlotSeed | null) => void
}
```

## CommitteeDecryptOptions

See the declaration and linked source for the contract.

[Source](../../src/chain/committeeClient.ts#L102)

```ts
export type CommitteeDecryptOptions = SlotCommitteeDecryptOptions
```

## CommitteeSignOptions

See the declaration and linked source for the contract.

[Source](../../src/chain/committeeClient.ts#L100)

```ts
export type CommitteeSignOptions = SlotCommitteeSignOptions
```

## CommitteeSlotClient

See the declaration and linked source for the contract.

[Source](../../src/chain/committeeClient.ts#L104)

```ts
export interface CommitteeSlotClient {
  /** Committee-authorized threshold FROST signature over `message`. */
  sign(slotId: string, message: Uint8Array, opts?: SlotCommitteeSignOptions): Promise<FrostSignResult>
  /**
   * Encrypt to the slot's group key. Local — reads the public key from chain, then
   * does the crypto in-process: no verifier, no JWT, no keeper node, and **no
   * credentials** (a client built with only `{chain}` can call this). BLS
   * (encryption) slots only.
   */
  encrypt(
    slotId: string,
    plaintext: Uint8Array,
    opts?: {identity?: Uint8Array; epoch?: bigint | null},
  ): Promise<Uint8Array>
  /** Committee-authorized threshold decrypt. */
  decrypt(slotId: string, opts: SlotCommitteeDecryptOptions): Promise<Uint8Array>
  /** The resolved active verifier directory (discovered once, then cached). */
  verifierDirectory(): Promise<CommitteeVerifier[]>
}
```

## CommitteeSlotClientConfig

See the declaration and linked source for the contract.

[Source](../../src/chain/committeeClient.ts#L32)

```ts
export interface CommitteeSlotClientConfig {
  /** Read client for the deployment (RPC + address book). */
  chain: TasraChainClient
  /**
   * Holder DID (the credentials' subject).
   *
   * Required for {@link CommitteeSlotClient.sign} and
   * {@link CommitteeSlotClient.decrypt}, which must present credentials to the
   * verifier committee. **Not** needed for {@link CommitteeSlotClient.encrypt},
   * which only reads the slot's public group key from chain.
   */
  holder?: string
  /** Compact-JWS verifiable credentials presented to the committee. Required for sign/decrypt. */
  credentials?: string[]
  /**
   * ⚠ UNUSED since — kept only so an existing config object still
   * type-checks. The verifier fetches the slot's rule from a keeper; nothing
   * here is sent. Remove it from your config.
   * Raw DCQL rule — its commitment must equal the slot's on-chain
   * `ruleCommitment`. Required for sign/decrypt.
   */
  dcqlRule?: string
  /**
   * Holder proof-of-possession for the holder DID authentication key. Required for sign/decrypt.
   *
   * One string serves ONE verifier: the proof names its audience and burns a nonce that lives in
   * that verifier, so on any deployment whose policy draws a committee the others answer 401 ("aud
   * does not include this verifier"). Pass `holderProofPerVerifier({signer, audience, credentials,
   * slotId})` there — it mints a fresh proof per drawn verifier, on every request.
   */
  holderProof?: string | HolderProofPerVerifier
  /** sign the request bundle so keeper + audit can verify you authorized it. */
  clientSigner?: ClientSigner
  /** Compound-token TTL in seconds (default 300). */
  ttlSecs?: number
}
```

## ContractName

See the declaration and linked source for the contract.

[Source](../../src/chain/abis/index.ts#L70)

```ts
export type ContractName = keyof typeof CONTRACT_ABIS
```

## ContractObservation

See the declaration and linked source for the contract.

[Source](../../src/chain/manifest.ts#L99)

```ts
export interface ContractObservation {
  name: string
  address: Address
  expectedCodeHash: Hex | null
  observedCodeHash: Hex | null
  implementation: Address | null
  implementationCodeHash: Hex | null
  matches: boolean
}
```

## ContractRecord

See the declaration and linked source for the contract.

[Source](../../src/chain/manifest.ts#L7)

```ts
export interface ContractRecord {
  name: string
  address: Address
  abi: string
  runtimeCodeHash: Hex | null
  deployment: {transactionHash: Hex; blockNumber: string} | null
  create2: {factory: Address; salt: Hex; initCodeHash: Hex} | null
  proxy: {implementation: Address; runtimeCodeHash: Hex; upgradeAuthority: Address | null} | null
}
```

## createCommitteeSlotClient

The few-lines integration surface for the **committee path**, driven by
just a slot id. Bring a chain client + your credentials once; every call resolves
the slot's keeper node and the active verifier set from chain, lets the
beacon-seeded on-chain draw pick the committee, gathers a quorum of attributable
verifier signatures, and submits the compound token to the keeper.

The key is never reconstructed: sign and decrypt run as threshold ceremonies on
the fleet. Contrast {@link createTasraSlotClient }, which mints a JWT and
returns a managed {@link Session } that assembles the master key locally.

**No static fallback, by design.** There is no way to hand in a hardcoded node or
verifier list — both come only from the registry. `sign`/`decrypt` also require
the trustless `VerifierSetRegistry` inclusion proofs to be derivable against an
anchored snapshot, and throw rather than let the keeper validate against its own
configured set.

`credentials`, `holder`, `dcqlRule`, and `holderProof` are checked when
`sign`/`decrypt` is called, not at construction — so `encrypt` works from a
chain client alone.

[Source](../../src/chain/committeeClient.ts#L164)

Import: `import {createCommitteeSlotClient} from 'tasra-sdk/chain'`

```ts
declare function createCommitteeSlotClient(cfg: CommitteeSlotClientConfig): CommitteeSlotClient
```

| Parameter | Type | Description |
|---|---|---|
| `cfg` | `CommitteeSlotClientConfig` | chain client, plus the credentials that authorize sign/decrypt |

Returns: `CommitteeSlotClient`.

Return details: a client bound to the deployment; every method takes the slot id

Example from source:

Encrypt with no credentials and no fleet — chain reads only.
```ts
const chain = createTasraChainClient({rpcUrl, addresses: addressBookFromEnv(process.env)})
const kk = createCommitteeSlotClient({chain})
const envelope = await kk.encrypt(slotId, new TextEncoder().encode('hello'))
```

Example from source:

Full committee path — sign and decrypt over the threshold.
```ts
const kk = createCommitteeSlotClient({
chain, holder: 'did:example:alice', credentials, dcqlRule, holderProof,
})
const sig = await kk.sign(slotId, messageBytes)
const plaintext = await kk.decrypt(slotId, {ciphertext, identity, decryptingSet, blsPeers})
```

## createRegisteredAgentClient

Selection authenticates public metadata first. Once POSTed, never silently switch providers.

[Source](../../src/chain/registeredAgent.ts#L65)

Import: `import {createRegisteredAgentClient} from 'tasra-sdk/chain'`

```ts
declare function createRegisteredAgentClient(chain: TasraChainClient, config: { profiles: readonly ApprovedAgentProfile[]; transport: AgentTransport; }): { createSession(params: CreateSessionParams, options?: { profileIndex?: number; signal?: AbortSignal; }): Promise<RegisteredAgentSession>; }
```

| Parameter | Type | Description |
|---|---|---|
| `chain` | `TasraChainClient` |  |
| `config` | `{ profiles: readonly ApprovedAgentProfile[]; transport: AgentTransport; }` |  |

Returns: `{ createSession(params: CreateSessionParams, options?: { profileIndex?: number; signal?: AbortSignal; }): Promise<RegisteredAgentSession>; }`.

## createRegisteredRelaySubmitter

One signer per instance. Serializes nonces and blocks new signatures after an uncertain result.

[Source](../../src/chain/registeredRelay.ts#L180)

Import: `import {createRegisteredRelaySubmitter} from 'tasra-sdk/chain'`

```ts
declare function createRegisteredRelaySubmitter(chain: TasraChainClient, config: RegisteredRelayConfig, wallet: WalletClient<Transport, Chain, Account>, options?: { persistAttempt?: (attempt: RelayAttempt) => Promise<void>; }): { submit: (to: Address, data: Hex, label?: string) => Promise<RelayReceipt>; pendingAttempt: () => RelayAttempt | undefined; reconcile(): Promise<RelayReconciliation | undefined>; }
```

| Parameter | Type | Description |
|---|---|---|
| `chain` | `TasraChainClient` |  |
| `config` | `RegisteredRelayConfig` |  |
| `wallet` | `{ account: Account; batch?: { multicall?: boolean &#124; Prettify<MulticallBatchOptions> &#124; undefined; } &#124; undefined; cacheTime: number; ccipRead?: false &#124; { request?: (parameters: CcipRequestParameters) => Promise<CcipRequestReturnType>; } &#124; undefined; chain: Chain; dataSuffix?: DataSuffix &#124; undefined; experimental_blockTag?: BlockTag &#124; undefined; key: string; name: string; pollingInterval: number; request: EIP1193RequestFn<WalletRpcSchema>; tokens: Tokens &#124; undefined; transport: TransportConfig<string, EIP1193RequestFn> & Record<string, any>; type: string; uid: string; addChain: (args: AddChainParameters) => Promise<void>; deployContract: <const abi extends Abi &#124; readonly unknown[], chainOverride extends Chain &#124; undefined>(args: DeployContractParameters<abi, Chain, Account, chainOverride>) => Promise<DeployContractReturnType>; fillTransaction: <chainOverride extends Chain &#124; undefined = undefined, accountOverride extends Account &#124; Address &#124; undefined = undefined>(args: FillTransactionParameters<Chain, Account, chainOverride, accountOverride>) => Promise<FillTransactionReturnType<Chain, chainOverride>>; getAddresses: () => Promise<GetAddressesReturnType>; getCallsStatus: (parameters: GetCallsStatusParameters) => Promise<GetCallsStatusReturnType>; getCapabilities: <chainId extends number &#124; undefined>(parameters?: GetCapabilitiesParameters<chainId>) => Promise<GetCapabilitiesReturnType<chainId>>; getChainId: () => Promise<GetChainIdReturnType>; getPermissions: () => Promise<GetPermissionsReturnType>; prepareAuthorization: (parameters: PrepareAuthorizationParameters<Account>) => Promise<PrepareAuthorizationReturnType>; prepareTransactionRequest: <const request extends PrepareTransactionRequestRequest<Chain, chainOverride>, chainOverride extends Chain &#124; undefined = undefined, accountOverride extends Account &#124; Address &#124; undefined = undefined>(args: PrepareTransactionRequestParameters<Chain, Account, chainOverride, accountOverride, request>) => Promise<{ [K in keyof (UnionRequiredBy<Extract<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> & (DeriveChain<Chain, chainOverride> extends Chain ? { chain: DeriveChain<Chain, chainOverride>; } : { chain?: undefined; }) & (DeriveAccount<Account, accountOverride> extends Account ? { account: Account & DeriveAccount<Account, accountOverride>; from: Address; } : { account?: undefined; from?: undefined; }), IsNever<ExtractFormattedTransactionRequest<DeriveChain<Chain, chainOverride>, { type?: ((request["type"] extends string ? request["type"] : IsNever<ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>>> extends false ? ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>> : request["type"] extends string &#124; undefined ? request["type"] : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)> extends "legacy" ? unknown : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)>) extends string ? string & (request["type"] extends string ? request["type"] : IsNever<ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>>> extends false ? ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>> : request["type"] extends string &#124; undefined ? request["type"] : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)> extends "legacy" ? unknown : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)>) : undefined) &#124; undefined; }, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, ((request["type"] extends string ? request["type"] : IsNever<ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>>> extends false ? ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>> : request["type"] extends string &#124; undefined ? request["type"] : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)> extends "legacy" ? unknown : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)>) extends string ? string & (request["type"] extends string ? request["type"] : IsNever<ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>>> extends false ? ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>> : request["type"] extends string &#124; undefined ? request["type"] : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)> extends "legacy" ? unknown : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)>) : undefined) &#124; undefined>> extends true ? unknown : ExactPartial<ExtractFormattedTransactionRequest<DeriveChain<Chain, chainOverride>, { type?: ((request["type"] extends string ? request["type"] : IsNever<ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>>> extends false ? ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>> : request["type"] extends string &#124; undefined ? request["type"] : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)> extends "legacy" ? unknown : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)>) extends string ? string & (request["type"] extends string ? request["type"] : IsNever<ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>>> extends false ? ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>> : request["type"] extends string &#124; undefined ? request["type"] : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)> extends "legacy" ? unknown : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)>) : undefined) &#124; undefined; }, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, ((request["type"] extends string ? request["type"] : IsNever<ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>>> extends false ? ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>> : request["type"] extends string &#124; undefined ? request["type"] : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)> extends "legacy" ? unknown : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)>) extends string ? string & (request["type"] extends string ? request["type"] : IsNever<ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>>> extends false ? ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>> : request["type"] extends string &#124; undefined ? request["type"] : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)> extends "legacy" ? unknown : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)>) : undefined) &#124; undefined>>> & { chainId?: number &#124; undefined; }, ParameterTypeToParameters<request["parameters"] extends readonly PrepareTransactionRequestParameterType[] ? request["parameters"][number] : "nonce" &#124; "chainId" &#124; "type" &#124; "gas" &#124; "blobVersionedHashes" &#124; "fees">> & (unknown extends request["kzg"] ? {} : Pick<request, "kzg">) & { _capabilities?: { [x: string]: any; } &#124; undefined; })]: (UnionRequiredBy<Extract<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> & (DeriveChain<Chain, chainOverride> extends Chain ? { chain: DeriveChain<Chain, chainOverride>; } : { chain?: undefined; }) & (DeriveAccount<Account, accountOverride> extends Account ? { account: Account & DeriveAccount<Account, accountOverride>; from: Address; } : { account?: undefined; from?: undefined; }), IsNever<ExtractFormattedTransactionRequest<DeriveChain<Chain, chainOverride>, { type?: ((request["type"] extends string ? request["type"] : IsNever<ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>>> extends false ? ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>> : request["type"] extends string &#124; undefined ? request["type"] : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)> extends "legacy" ? unknown : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)>) extends string ? string & (request["type"] extends string ? request["type"] : IsNever<ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>>> extends false ? ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>> : request["type"] extends string &#124; undefined ? request["type"] : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)> extends "legacy" ? unknown : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)>) : undefined) &#124; undefined; }, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, ((request["type"] extends string ? request["type"] : IsNever<ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>>> extends false ? ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>> : request["type"] extends string &#124; undefined ? request["type"] : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)> extends "legacy" ? unknown : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)>) extends string ? string & (request["type"] extends string ? request["type"] : IsNever<ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>>> extends false ? ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>> : request["type"] extends string &#124; undefined ? request["type"] : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)> extends "legacy" ? unknown : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)>) : undefined) &#124; undefined>> extends true ? unknown : ExactPartial<ExtractFormattedTransactionRequest<DeriveChain<Chain, chainOverride>, { type?: ((request["type"] extends string ? request["type"] : IsNever<ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>>> extends false ? ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>> : request["type"] extends string &#124; undefined ? request["type"] : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)> extends "legacy" ? unknown : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)>) extends string ? string & (request["type"] extends string ? request["type"] : IsNever<ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>>> extends false ? ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>> : request["type"] extends string &#124; undefined ? request["type"] : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)> extends "legacy" ? unknown : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)>) : undefined) &#124; undefined; }, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, ((request["type"] extends string ? request["type"] : IsNever<ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>>> extends false ? ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>> : request["type"] extends string &#124; undefined ? request["type"] : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)> extends "legacy" ? unknown : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)>) extends string ? string & (request["type"] extends string ? request["type"] : IsNever<ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>>> extends false ? ExtractCustomFormattedTransactionType<DeriveChain<Chain, chainOverride>, request, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">, UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends object ? request extends ExactPartial<UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">> ? UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> extends { type?: infer type &#124; undefined; } ? Extract<type, string> : never : never : never, NonNullable<"legacy" &#124; "eip1559" &#124; "eip2930" &#124; "eip4844" &#124; "eip7702" &#124; undefined>> : request["type"] extends string &#124; undefined ? request["type"] : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)> extends "legacy" ? unknown : GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)>) : undefined) &#124; undefined>>> & { chainId?: number &#124; undefined; }, ParameterTypeToParameters<request["parameters"] extends readonly PrepareTransactionRequestParameterType[] ? request["parameters"][number] : "nonce" &#124; "chainId" &#124; "type" &#124; "gas" &#124; "blobVersionedHashes" &#124; "fees">> & (unknown extends request["kzg"] ? {} : Pick<request, "kzg">) & { _capabilities?: { [x: string]: any; } &#124; undefined; })[K]; }>; requestAddresses: () => Promise<RequestAddressesReturnType>; requestPermissions: (args: RequestPermissionsParameters) => Promise<RequestPermissionsReturnType>; sendCalls: <const calls extends readonly unknown[], chainOverride extends Chain &#124; undefined = undefined>(parameters: SendCallsParameters<Chain, Account, chainOverride, calls>) => Promise<{ capabilities?: { [x: string]: any; } &#124; undefined; id: string; }>; sendCallsSync: <const calls extends readonly unknown[], chainOverride extends Chain &#124; undefined = undefined>(parameters: SendCallsSyncParameters<Chain, Account, chainOverride, calls>) => Promise<{ version: string; id: string; chainId: number; atomic: boolean; capabilities?: { [key: string]: any; } &#124; { [x: string]: any; } &#124; undefined; receipts?: WalletCallReceipt<bigint, "success" &#124; "reverted">[] &#124; undefined; statusCode: number; status: "pending" &#124; "success" &#124; "failure" &#124; undefined; }>; sendRawTransaction: (args: SendRawTransactionParameters) => Promise<SendRawTransactionReturnType>; sendRawTransactionSync: (args: SendRawTransactionSyncParameters) => Promise<TransactionReceipt>; sendTransaction: <const request extends SendTransactionRequest<Chain, chainOverride>, chainOverride extends Chain &#124; undefined = undefined>(args: SendTransactionParameters<Chain, Account, chainOverride, request>) => Promise<SendTransactionReturnType>; sendTransactionSync: <const request extends SendTransactionSyncRequest<Chain, chainOverride>, chainOverride extends Chain &#124; undefined = undefined>(args: SendTransactionSyncParameters<Chain, Account, chainOverride, request>) => Promise<TransactionReceipt>; showCallsStatus: (parameters: ShowCallsStatusParameters) => Promise<ShowCallsStatusReturnType>; signAuthorization: (parameters: SignAuthorizationParameters<Account>) => Promise<SignAuthorizationReturnType>; signMessage: (args: SignMessageParameters<Account>) => Promise<SignMessageReturnType>; signTransaction: <chainOverride extends Chain &#124; undefined, const request extends UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from"> = UnionOmit<ExtractChainFormatterParameters<DeriveChain<Chain, chainOverride>, "transactionRequest", TransactionRequest>, "from">>(args: SignTransactionParameters<Chain, Account, chainOverride, request>) => Promise<TransactionSerialized<GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)>, (GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)> extends "eip1559" ? \`0x02${string}\` : never) &#124; (GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)> extends "eip2930" ? \`0x01${string}\` : never) &#124; (GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)> extends "eip4844" ? \`0x03${string}\` : never) &#124; (GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)> extends "eip7702" ? \`0x04${string}\` : never) &#124; (GetTransactionType<request, (request extends LegacyProperties ? "legacy" : never) &#124; (request extends EIP1559Properties ? "eip1559" : never) &#124; (request extends EIP2930Properties ? "eip2930" : never) &#124; (request extends EIP4844Properties ? "eip4844" : never) &#124; (request extends EIP7702Properties ? "eip7702" : never) &#124; (request["type"] extends string &#124; undefined ? Extract<request["type"], string> : never)> extends "legacy" ? TransactionSerializedLegacy : never)>>; signTypedData: <const typedData extends { [key: string]: unknown; } &#124; { [x: string]: readonly TypedDataParameter[]; [x: \`string[${string}]\`]: undefined; [x: \`function[${string}]\`]: undefined; [x: \`uint64[${string}]\`]: undefined; [x: \`bytes32[${string}]\`]: undefined; [x: \`uint32[${string}]\`]: undefined; [x: \`bytes[${string}]\`]: undefined; [x: \`address[${string}]\`]: undefined; [x: \`uint256[${string}]\`]: undefined; [x: \`bool[${string}]\`]: undefined; [x: \`uint8[${string}]\`]: undefined; [x: \`uint16[${string}]\`]: undefined; [x: \`bytes1[${string}]\`]: undefined; [x: \`uint24[${string}]\`]: undefined; [x: \`bytes16[${string}]\`]: undefined; [x: \`bytes5[${string}]\`]: undefined; [x: \`bytes2[${string}]\`]: undefined; [x: \`bytes4[${string}]\`]: undefined; [x: \`bytes3[${string}]\`]: undefined; [x: \`bytes7[${string}]\`]: undefined; [x: \`bytes6[${string}]\`]: undefined; [x: \`bytes9[${string}]\`]: undefined; [x: \`bytes8[${string}]\`]: undefined; [x: \`bytes12[${string}]\`]: undefined; [x: \`bytes10[${string}]\`]: undefined; [x: \`bytes28[${string}]\`]: undefined; [x: \`bytes17[${string}]\`]: undefined; [x: \`bytes25[${string}]\`]: undefined; [x: \`bytes29[${string}]\`]: undefined; [x: \`bytes13[${string}]\`]: undefined; [x: \`bytes18[${string}]\`]: undefined; [x: \`bytes11[${string}]\`]: undefined; [x: \`bytes14[${string}]\`]: undefined; [x: \`bytes15[${string}]\`]: undefined; [x: \`bytes19[${string}]\`]: undefined; [x: \`bytes20[${string}]\`]: undefined; [x: \`bytes21[${string}]\`]: undefined; [x: \`bytes22[${string}]\`]: undefined; [x: \`bytes23[${string}]\`]: undefined; [x: \`bytes24[${string}]\`]: undefined; [x: \`bytes26[${string}]\`]: undefined; [x: \`bytes27[${string}]\`]: undefined; [x: \`bytes30[${string}]\`]: undefined; [x: \`bytes31[${string}]\`]: undefined; [x: \`int[${string}]\`]: undefined; [x: \`int16[${string}]\`]: undefined; [x: \`int8[${string}]\`]: undefined; [x: \`int120[${string}]\`]: undefined; [x: \`int24[${string}]\`]: undefined; [x: \`int32[${string}]\`]: undefined; [x: \`int40[${string}]\`]: undefined; [x: \`int48[${string}]\`]: undefined; [x: \`int56[${string}]\`]: undefined; [x: \`int64[${string}]\`]: undefined; [x: \`int72[${string}]\`]: undefined; [x: \`int80[${string}]\`]: undefined; [x: \`int88[${string}]\`]: undefined; [x: \`int96[${string}]\`]: undefined; [x: \`int104[${string}]\`]: undefined; [x: \`int112[${string}]\`]: undefined; [x: \`int128[${string}]\`]: undefined; [x: \`int136[${string}]\`]: undefined; [x: \`int144[${string}]\`]: undefined; [x: \`int152[${string}]\`]: undefined; [x: \`int160[${string}]\`]: undefined; [x: \`int168[${string}]\`]: undefined; [x: \`int176[${string}]\`]: undefined; [x: \`int184[${string}]\`]: undefined; [x: \`int192[${string}]\`]: undefined; [x: \`int200[${string}]\`]: undefined; [x: \`int208[${string}]\`]: undefined; [x: \`int216[${string}]\`]: undefined; [x: \`int224[${string}]\`]: undefined; [x: \`int232[${string}]\`]: undefined; [x: \`int240[${string}]\`]: undefined; [x: \`int248[${string}]\`]: undefined; [x: \`int256[${string}]\`]: undefined; [x: \`uint[${string}]\`]: undefined; [x: \`uint120[${string}]\`]: undefined; [x: \`uint40[${string}]\`]: undefined; [x: \`uint48[${string}]\`]: undefined; [x: \`uint56[${string}]\`]: undefined; [x: \`uint72[${string}]\`]: undefined; [x: \`uint80[${string}]\`]: undefined; [x: \`uint88[${string}]\`]: undefined; [x: \`uint96[${string}]\`]: undefined; [x: \`uint104[${string}]\`]: undefined; [x: \`uint112[${string}]\`]: undefined; [x: \`uint128[${string}]\`]: undefined; [x: \`uint136[${string}]\`]: undefined; [x: \`uint144[${string}]\`]: undefined; [x: \`uint152[${string}]\`]: undefined; [x: \`uint160[${string}]\`]: undefined; [x: \`uint168[${string}]\`]: undefined; [x: \`uint176[${string}]\`]: undefined; [x: \`uint184[${string}]\`]: undefined; [x: \`uint192[${string}]\`]: undefined; [x: \`uint200[${string}]\`]: undefined; [x: \`uint208[${string}]\`]: undefined; [x: \`uint216[${string}]\`]: undefined; [x: \`uint224[${string}]\`]: undefined; [x: \`uint232[${string}]\`]: undefined; [x: \`uint240[${string}]\`]: undefined; [x: \`uint248[${string}]\`]: undefined; string?: undefined; uint64?: undefined; bytes32?: undefined; uint32?: undefined; bytes?: undefined; address?: undefined; uint256?: undefined; bool?: undefined; uint8?: undefined; uint16?: undefined; bytes1?: undefined; uint24?: undefined; bytes16?: undefined; bytes5?: undefined; bytes2?: undefined; bytes4?: undefined; bytes3?: undefined; bytes7?: undefined; bytes6?: undefined; bytes9?: undefined; bytes8?: undefined; bytes12?: undefined; bytes10?: undefined; bytes28?: undefined; bytes17?: undefined; bytes25?: undefined; bytes29?: undefined; bytes13?: undefined; bytes18?: undefined; bytes11?: undefined; bytes14?: undefined; bytes15?: undefined; bytes19?: undefined; bytes20?: undefined; bytes21?: undefined; bytes22?: undefined; bytes23?: undefined; bytes24?: undefined; bytes26?: undefined; bytes27?: undefined; bytes30?: undefined; bytes31?: undefined; int16?: undefined; int8?: undefined; int120?: undefined; int24?: undefined; int32?: undefined; int40?: undefined; int48?: undefined; int56?: undefined; int64?: undefined; int72?: undefined; int80?: undefined; int88?: undefined; int96?: undefined; int104?: undefined; int112?: undefined; int128?: undefined; int136?: undefined; int144?: undefined; int152?: undefined; int160?: undefined; int168?: undefined; int176?: undefined; int184?: undefined; int192?: undefined; int200?: undefined; int208?: undefined; int216?: undefined; int224?: undefined; int232?: undefined; int240?: undefined; int248?: undefined; int256?: undefined; uint120?: undefined; uint40?: undefined; uint48?: undefined; uint56?: undefined; uint72?: undefined; uint80?: undefined; uint88?: undefined; uint96?: undefined; uint104?: undefined; uint112?: undefined; uint128?: undefined; uint136?: undefined; uint144?: undefined; uint152?: undefined; uint160?: undefined; uint168?: undefined; uint176?: undefined; uint184?: undefined; uint192?: undefined; uint200?: undefined; uint208?: undefined; uint216?: undefined; uint224?: undefined; uint232?: undefined; uint240?: undefined; uint248?: undefined; }, primaryType extends string>(args: SignTypedDataParameters<typedData, primaryType, Account>) => Promise<SignTypedDataReturnType>; switchChain: (args: SwitchChainParameters) => Promise<void>; waitForCallsStatus: (parameters: WaitForCallsStatusParameters) => Promise<WaitForCallsStatusReturnType>; watchAsset: (args: WatchAssetParameters) => Promise<WatchAssetReturnType>; writeContract: <const abi extends Abi &#124; readonly unknown[], functionName extends ContractFunctionName<abi, "nonpayable" &#124; "payable">, args extends ContractFunctionArgs<abi, "nonpayable" &#124; "payable", functionName>, chainOverride extends Chain &#124; undefined = undefined>(args: WriteContractParameters<abi, functionName, args, Chain, Account, chainOverride>) => Promise<WriteContractReturnType>; writeContractSync: <const abi extends Abi &#124; readonly unknown[], functionName extends ContractFunctionName<abi, "nonpayable" &#124; "payable">, args extends ContractFunctionArgs<abi, "nonpayable" &#124; "payable", functionName>, chainOverride extends Chain &#124; undefined = undefined>(args: WriteContractSyncParameters<abi, functionName, args, Chain, Account, chainOverride>) => Promise<WriteContractSyncReturnType>; token: { approveSync: (parameters: approveSync.Parameters<Chain, Account, Tokens &#124; undefined>) => Promise<{ owner: \`0x${string}\`; spender: \`0x${string}\`; value: bigint; decimals?: number &#124; undefined &#124; undefined; formatted?: string &#124; undefined &#124; undefined; receipt: TransactionReceipt; }>; approve: ((parameters: approve.Parameters<Chain, Account, Tokens &#124; undefined>) => Promise<approve.ReturnValue>) & { call: (args: approve.Args<Chain, Tokens &#124; undefined>) => ReturnType<typeof approve.call>; estimateGas: (parameters: approve.Parameters<Chain, Account, Tokens &#124; undefined>) => Promise<bigint>; extractEvent: typeof approve.extractEvent; simulate: (parameters: approve.Parameters<Chain, Account, Tokens &#124; undefined>) => ReturnType<typeof approve.simulate>; }; transferSync: (parameters: transferSync.Parameters<Chain, Account, Tokens &#124; undefined>) => Promise<{ from: \`0x${string}\`; to: \`0x${string}\`; value: bigint; decimals?: number &#124; undefined &#124; undefined; formatted?: string &#124; undefined &#124; undefined; receipt: TransactionReceipt; }>; transfer: ((parameters: transfer.Parameters<Chain, Account, Tokens &#124; undefined>) => Promise<transfer.ReturnValue>) & { call: (args: transfer.Args<Chain, Tokens &#124; undefined>) => ReturnType<typeof transfer.call>; estimateGas: (parameters: transfer.Parameters<Chain, Account, Tokens &#124; undefined>) => Promise<bigint>; extractEvent: typeof transfer.extractEvent; simulate: (parameters: transfer.Parameters<Chain, Account, Tokens &#124; undefined>) => ReturnType<typeof transfer.simulate>; }; }; extend: <const client extends { [x: string]: unknown; account?: undefined; batch?: undefined; cacheTime?: undefined; ccipRead?: undefined; chain?: undefined; dataSuffix?: undefined; experimental_blockTag?: undefined; key?: undefined; name?: undefined; pollingInterval?: undefined; request?: undefined; tokens?: undefined; transport?: undefined; type?: undefined; uid?: undefined; } & ExactPartial<ExtendableProtectedActions<Transport, Chain, Account, Tokens &#124; undefined>>>(fn: (client: Client<Transport, Chain, Account, WalletRpcSchema, WalletActions<Chain, Account, Tokens &#124; undefined>, Tokens &#124; undefined>) => client) => Client<Transport, Chain, Account, WalletRpcSchema, { [K in keyof client]: client[K]; } & WalletActions<Chain, Account, Tokens &#124; undefined>, Tokens &#124; undefined>; }` |  |
| `options` | `{ persistAttempt?: (attempt: RelayAttempt) => Promise<void>; }` |  |

Returns: `{ submit: (to: Address, data: Hex, label?: string) => Promise<RelayReceipt>; pendingAttempt: () => RelayAttempt | undefined; reconcile(): Promise<RelayReconciliation | undefined>; }`.

## CreateSlotArgs

See the declaration and linked source for the contract.

[Source](../../src/chain/write.ts#L190)

```ts
export interface CreateSlotArgs {
  dcqlRule: string
  /** rule salt; minted when omitted. NOT `salt` (committee selection). */
  ruleSalt?: Hex
  k: number
  n: number
  mode: SlotMode
  /**
   * `KeyRegistry.AuthType` for this slot — how a holder authorises against the rule.
   * Defaults to `'unspecified'` (ordinal 0), which declares nothing and is what every
   * slot predating the field reads as. Set it when the rule is an OID4VP-DCQL query
   * (`'oid4vp'`) or an OAuth/OIDC token rule (`'oauth'`).
   */
  authType?: SlotAuthType
  /** Committee-draw filter tags; default `["keykeeper"]`. */
  tags?: string[]
  /** Override the (otherwise random) slot id / salt. */
  slotId?: Hex
  salt?: Hex
  /**
   * amendment authority, pinned in the SAME transaction that creates the
   * slot. Omit for an immutable rule, which is the default.
   *
   * ⚠ Prefer this to calling {@link TasraWriteClient.setRulePolicy} afterwards.
   * That is a second transaction, and it CANNOT be won from a wallet that asks a
   * human to approve one — the keepers start their DKG the moment creation lands,
   * and the pin is refused once a key exists. See the note on `setRulePolicy`.
   */
  rulePolicy?: RulePolicyArgs
  /**
   * client-sovereign key custody: allow RAW shard export for this slot
   * (POST /v1/shards/key returns each keeper's secret share; k of them reconstruct the
   * master secret key). DANGEROUS — a holder who exports keeps the key permanently, so
   * revocation no longer locks them out. Off by default. Use ONLY for personal-vault /
   * key-recovery slots, never a group or credential-gated slot. Immutable at birth; cannot
   * be combined with rulePolicy (no single entry point for both).
   */
  exportable?: boolean
}
```

## createTasraChainClient

viem-based **read** client for a Tasra Network deployment: a configured
`PublicClient`, windowed log fetching + decoding, block-timestamp lookups, and
typed view-function readers for the registry entities.

Read-only by construction — no wallet, no signing. For on-chain writes (slot
creation, registration) use `createTasraWriteClient`.

This is a **dependency of** the slot-driven clients rather than an alternative to
them: both {@link createTasraSlotClient } and {@link createCommitteeSlotClient }
take one of these as their `chain` field. Build it first.

[Source](../../src/chain/client.ts#L269)

Import: `import {createTasraChainClient} from 'tasra-sdk/chain'`

```ts
declare function createTasraChainClient(cfg: ChainClientConfig): TasraChainClient
```

| Parameter | Type | Description |
|---|---|---|
| `cfg` | `ChainClientConfig` | \`rpcUrl\` + a resolved {@link AddressBook}. \`chainId\` defaults to \`DEFAULT_CHAIN_ID\` and the RPC is never consulted for it, so set it explicitly for any deployment that is not the local dev chain. |

Returns: `TasraChainClient`.

Return details: a read client exposing `publicClient`, `readers`, log helpers, and the
deployment's address book

Example from source:

```ts
const chain = createTasraChainClient({
  rpcUrl: 'http://127.0.0.1:8545',
  addresses: addressBookFromEnv(process.env),
})
const kk = createTasraSlotClient({chain, identity: 'did:example:alice'})
```

## createTasraSlotClient

Slot-driven managed JWT client — the same ergonomics as
{@link createTasraClient}, but you bring a slot id + a chain client instead of
hardcoding `{nodes, verifier}`:

- the keeper **nodes** come from the slot's on-chain committee
  (`assignedNodes` → `nodeOf().url`)
- the **verifier** is chosen at random from the on-chain verifier set
  (`NodeRegistry` operators tagged `keccak256("verifier")`) — that verifier
  validates your VP and issues the JWT
- the JWT then authorizes the operation at a keeper node

So the verifier is genuinely part of every session: `openSession` picks one from
chain, and the returned session's JWT was minted by it. Pass `onResolve` to see
which one. This is the production access path.

Composes the verifier-auth + session machinery with chain discovery — no new
crypto, just endpoint resolution moved from static config to the registry.
Contrast {@link createCommitteeSlotClient }, which takes the committee
path instead and never reconstructs the key.

[Source](../../src/chain/slotClient.ts#L106)

Import: `import {createTasraSlotClient} from 'tasra-sdk/chain'`

```ts
declare function createTasraSlotClient(cfg: TasraSlotClientConfig): TasraSlotClient
```

| Parameter | Type | Description |
|---|---|---|
| `cfg` | `TasraSlotClientConfig` | a {@link TasraChainClient} plus this holder's DID. Use \`rewriteUrl\` when on-chain URLs are not reachable as-is (e.g. mapping a demo fleet's in-cluster \`tasra-node-7:8080\` to a host port). |

Returns: `TasraSlotClient`.

Return details: a client that opens managed sessions from a bare slot id

Example from source:

```ts
const chain = createTasraChainClient({rpcUrl, addresses: addressBookFromEnv(process.env)})
const kk = createTasraSlotClient({
  chain,
  identity: 'did:example:alice',
  onResolve: r => console.log('verifier chosen:', r.verifier, 'of', r.verifierCount),
})

const s = await kk.openSession(slotId, {vpJwt: {dcqlRule, credentials, holderProof}})
const sig = await s.sign(messageBytes)
await s.close()
```

## createTasraWriteClient

A wallet-backed on-chain client. The returned object's `address` is the
sovereign identity.

Two signer shapes, same surface (see {@link WriteClientConfig}):
  - `privateKey` — the SDK owns the account and signs locally (Node, tests,
    faucets, CI). Historic behaviour, unchanged.
  - `wallet` — the caller supplies an account-bound viem `WalletClient`, so
    the SDK never touches a private key. This is the browser-wallet path
    (MetaMask/wagmi, Safe App, hardware wallet).

[Source](../../src/chain/write.ts#L358)

Import: `import {createTasraWriteClient} from 'tasra-sdk/chain'`

```ts
declare function createTasraWriteClient(cfg: WriteClientConfig): TasraWriteClient
```

| Parameter | Type | Description |
|---|---|---|
| `cfg` | `WriteClientConfig` |  |

Returns: `TasraWriteClient`.

## decodeContractLogs

Decode raw logs (already filtered to `address`) against `contract`'s ABI.
Non-matching / anonymous logs are skipped. `strict:false` tolerates logs
whose indexed topics can't be fully decoded.

[Source](../../src/chain/events.ts#L109)

Import: `import {decodeContractLogs} from 'tasra-sdk/chain'`

```ts
declare function decodeContractLogs(contract: ContractName, address: Address, logs: Log[]): DecodedEvent[]
```

| Parameter | Type | Description |
|---|---|---|
| `contract` | `"NodeRegistry" &#124; "KeyRegistry" &#124; "ServiceRegistry" &#124; "Settlement" &#124; "TasraToken" &#124; "BondingCurve" &#124; "TasraSwapRouter" &#124; "Treasury" &#124; "TasraVestingVault" &#124; "ThresholdRandomBeacon" &#124; "PrevrandaoSaltBeacon" &#124; "EquivocationSlasher" &#124; "PlatformExecutor" &#124; "FixedTasraPriceOracle" &#124; "MockEurc" &#124; "AccountantSlashing" &#124; "LivenessRegistry" &#124; "VerifierSetRegistry" &#124; "AccountantSetRegistry" &#124; "KeeperShareRegistry"` |  |
| `address` | `\`0x${string}\`` |  |
| `logs` | `Log[]` |  |

Returns: `DecodedEvent[]`.

## DecodedEvent

A normalized, storage-ready decoded log.

[Source](../../src/chain/events.ts#L80)

```ts
export interface DecodedEvent {
  category: EventCategory
  contract: ContractName
  address: Address
  eventName: string
  /** Decoded args (bigints preserved; use `jsonSafe` before persisting). */
  args: Record<string, unknown>
  blockNumber: bigint
  blockHash: string | null
  txHash: string
  txIndex: number | null
  logIndex: number
}
```

## deriveServiceId

Matches serviceIdFor on the proxy. Provider transfer does not change this ID.

[Source](../../src/chain/services.ts#L35)

Import: `import {deriveServiceId} from 'tasra-sdk/chain'`

```ts
declare function deriveServiceId(chainId: bigint, registry: Address, creator: Address, salt: Hex): Hex
```

| Parameter | Type | Description |
|---|---|---|
| `chainId` | `bigint` |  |
| `registry` | `\`0x${string}\`` |  |
| `creator` | `\`0x${string}\`` |  |
| `salt` | `\`0x${string}\`` |  |

Returns: ``0x${string}``.

## encodeServiceChallenge

Canonical wire encoding accepted by both responder implementations.

[Source](../../src/chain/serviceIdentity.ts#L115)

Import: `import {encodeServiceChallenge} from 'tasra-sdk/chain'`

```ts
declare function encodeServiceChallenge(challenge: ServiceChallenge): Uint8Array
```

| Parameter | Type | Description |
|---|---|---|
| `challenge` | `ServiceChallenge` |  |

Returns: `Uint8Array<ArrayBufferLike>`.

## encodeServiceManifest

Canonical v1 bytes: fixed field order, compact ASCII JSON, one LF. No optional/unknown fields.

[Source](../../src/chain/serviceIdentity.ts#L59)

Import: `import {encodeServiceManifest} from 'tasra-sdk/chain'`

```ts
declare function encodeServiceManifest(manifest: ServiceManifest): Uint8Array
```

| Parameter | Type | Description |
|---|---|---|
| `manifest` | `ServiceManifest` |  |

Returns: `Uint8Array<ArrayBufferLike>`.

## EventCategory

See the declaration and linked source for the contract.

[Source](../../src/chain/events.ts#L10)

```ts
export type EventCategory =
  | 'node'
  | 'slot'
  | 'slashing'
  | 'tasra'
  | 'settlement'
  | 'beacon'
  | 'governance'
```

## eventNamesOf

The set of event names declared by a contract's ABI.

[Source](../../src/chain/events.ts#L73)

Import: `import {eventNamesOf} from 'tasra-sdk/chain'`

```ts
declare function eventNamesOf(contract: ContractName): string[]
```

| Parameter | Type | Description |
|---|---|---|
| `contract` | `"NodeRegistry" &#124; "KeyRegistry" &#124; "ServiceRegistry" &#124; "Settlement" &#124; "TasraToken" &#124; "BondingCurve" &#124; "TasraSwapRouter" &#124; "Treasury" &#124; "TasraVestingVault" &#124; "ThresholdRandomBeacon" &#124; "PrevrandaoSaltBeacon" &#124; "EquivocationSlasher" &#124; "PlatformExecutor" &#124; "FixedTasraPriceOracle" &#124; "MockEurc" &#124; "AccountantSlashing" &#124; "LivenessRegistry" &#124; "VerifierSetRegistry" &#124; "AccountantSetRegistry" &#124; "KeeperShareRegistry"` |  |

Returns: `string[]`.

## FetchOpts

See the declaration and linked source for the contract.

[Source](../../src/chain/offchain.ts#L9)

```ts
export interface FetchOpts {
  /** Per-request timeout in ms (default 4000). */
  timeoutMs?: number
  /** Bearer JWT, for the few authenticated reads (metering/audit). */
  jwt?: string
}
```

## formatBps

Format a basis-points integer (e.g. 1000) as a percentage string ("10%").

[Source](../../src/chain/format.ts#L36)

Import: `import {formatBps} from 'tasra-sdk/chain'`

```ts
declare function formatBps(bps: number | bigint): string
```

| Parameter | Type | Description |
|---|---|---|
| `bps` | `number &#124; bigint` |  |

Returns: `string`.

## formatUnits

Format an 18-decimal token amount (wei) to a human string with up to
`maxFractionDigits` significant fractional digits, thousands-separated.
Generic over decimals.

[Source](../../src/chain/format.ts#L16)

Import: `import {formatUnits} from 'tasra-sdk/chain'`

```ts
declare function formatUnits(value: bigint, decimals?: number, maxFractionDigits?: number): string
```

| Parameter | Type | Description |
|---|---|---|
| `value` | `bigint` |  |
| `decimals` | `number` |  |
| `maxFractionDigits` | `number` |  |

Returns: `string`.

## formatWad

WAD (1e18 fixed-point) value to a decimal string, e.g. a price.

[Source](../../src/chain/format.ts#L42)

Import: `import {formatWad} from 'tasra-sdk/chain'`

```ts
declare function formatWad(wad: bigint, maxFractionDigits?: number): string
```

| Parameter | Type | Description |
|---|---|---|
| `wad` | `bigint` |  |
| `maxFractionDigits` | `number` |  |

Returns: `string`.

## generateClientKey

Fresh 0x-prefixed 32-byte private key for a new sovereign client account.

[Source](../../src/chain/write.ts#L315)

Import: `import {generateClientKey} from 'tasra-sdk/chain'`

```ts
declare function generateClientKey(): Hex
```

Returns: ``0x${string}``.

## GetLogsWindowedOpts

See the declaration and linked source for the contract.

[Source](../../src/chain/client.ts#L95)

```ts
export interface GetLogsWindowedOpts {
  fromBlock: bigint
  toBlock: bigint
  /** Restrict to these contracts (default: all present in the AddressBook). */
  contracts?: ContractName[]
  windowSize?: number
  /** Called after each window with the last block scanned (progress). */
  onWindow?: (toBlock: bigint, events: DecodedEvent[]) => void
}
```

## hashServiceManifest

Hash the exact downloaded/published bytes; never parse and re-serialize before checking.

[Source](../../src/chain/services.ts#L65)

Import: `import {hashServiceManifest} from 'tasra-sdk/chain'`

```ts
declare function hashServiceManifest(bytes: Uint8Array): Hex
```

| Parameter | Type | Description |
|---|---|---|
| `bytes` | `Uint8Array<ArrayBufferLike>` |  |

Returns: ``0x${string}``.

## jsonSafe

Recursively convert bigints to strings so a decoded event can be JSON
serialized / stored. Leaves everything else intact.

[Source](../../src/chain/events.ts#L144)

Import: `import {jsonSafe} from 'tasra-sdk/chain'`

```ts
declare function jsonSafe<T>(value: T): unknown
```

| Parameter | Type | Description |
|---|---|---|
| `value` | `T` |  |

Returns: `unknown`.

## KeeperProvisionResult

One keeper's answer. `pending` marks a rule stored against a PENDING amendment.

[Source](../../src/chain/provisionRule.ts#L58)

```ts
export interface KeeperProvisionResult {
  url: string
  ok: boolean
  /** The active rule was filled in by THIS call (false when it was already present). */
  provisioned?: boolean
  pending?: boolean
  pendingVersion?: number
  status?: number
  error?: string
}
```

## KeyListReply

See the declaration and linked source for the contract.

[Source](../../src/chain/offchain.ts#L71)

```ts
export interface KeyListReply {
  slots: KeySlotSummary[]
  [k: string]: unknown
}
```

## KeySlotSummary

See the declaration and linked source for the contract.

[Source](../../src/chain/offchain.ts#L58)

```ts
export interface KeySlotSummary {
  key_slot_id: string
  threshold_k: number
  threshold_n: number
  epoch: number
  group_public_key?: string | null
  dcql_rule?: string | null
  mode?: string
  created_at?: string
  last_signed_at?: string | null
  [k: string]: unknown
}
```

## MeteringReply

See the declaration and linked source for the contract.

[Source](../../src/chain/offchain.ts#L84)

```ts
export interface MeteringReply {
  key_slot_id: string
  since?: string
  until?: string
  total: number
  by_subject?: Array<{subject: string; count: number}>
  attestation?: unknown
  [k: string]: unknown
}
```

## NetworkManifest

See the declaration and linked source for the contract.

[Source](../../src/chain/manifest.ts#L16)

```ts
export interface NetworkManifest {
  schemaVersion: 1
  network: NetworkName
  chainId: number
  deploymentId: string
  revision: number
  status: 'planned' | 'active' | 'retired'
  protocolVersion: string
  verifiedAt: {blockNumber: string; blockHash: Hex; timestamp: string} | null
  contracts: ContractRecord[]
  services: {kind: string; url: string}[]
}
```

## NetworkName

See the declaration and linked source for the contract.

[Source](../../src/chain/networks.ts#L4)

```ts
export type NetworkName = 'local' | 'testnet' | 'mainnet'
```

## networkNameForChain

See the declaration and linked source for the contract.

[Source](../../src/chain/networks.ts#L25)

Import: `import {networkNameForChain} from 'tasra-sdk/chain'`

```ts
declare function networkNameForChain(chainId: number): NetworkName
```

| Parameter | Type | Description |
|---|---|---|
| `chainId` | `number` |  |

Returns: `NetworkName`.

## NetworkPreset

See the declaration and linked source for the contract.

[Source](../../src/chain/networks.ts#L5)

```ts
export interface NetworkPreset {
  readonly chainId: number
  readonly rpcUrl: string
  readonly nativeCurrency: Readonly<{name: string; symbol: string; decimals: number}>
  readonly eurc: Readonly<{kind: 'mock' | 'circle'; address: string | null; name: string; symbol: string; decimals: number; faucet: boolean}>
  readonly governance: Readonly<{delaySecs: number; floorSecs: number}>
  readonly productionPosture: boolean
}
```

## NodeInfo

See the declaration and linked source for the contract.

[Source](../../src/chain/offchain.ts#L46)

```ts
export interface NodeInfo {
  peer_id?: string
  node_identifier?: number
  version?: string
  build_profile?: string
  uptime_secs?: number
  connected_peers?: number | null
  rate_limit_enabled?: boolean
  admin_scope_enabled?: boolean
  [k: string]: unknown
}
```

## observeNetworkManifest

Observe a single finalized block. This verifies code identity, not business wiring or audit quality.

[Source](../../src/chain/manifest.ts#L110)

Import: `import {observeNetworkManifest} from 'tasra-sdk/chain'`

```ts
declare function observeNetworkManifest(manifest: NetworkManifest, rpcUrl: string): Promise<{ chainId: number; blockNumber: string; blockHash: `0x${string}`; observedAt: string; contracts: ContractObservation[]; matches: boolean; }>
```

| Parameter | Type | Description |
|---|---|---|
| `manifest` | `NetworkManifest` |  |
| `rpcUrl` | `string` |  |

Returns: `Promise<{ chainId: number; blockNumber: string; blockHash: `0x${string}`; observedAt: string; contracts: ContractObservation[]; matches: boolean; }>`.

## openRegisteredVerifierAgentSession

Sign once, authenticate an explicitly approved provider, and retain its pinned poll closure.

[Source](../../src/chain/registeredOperation.ts#L17)

Import: `import {openRegisteredVerifierAgentSession} from 'tasra-sdk/chain'`

```ts
declare function openRegisteredVerifierAgentSession(client: ReturnType<typeof createRegisteredAgentClient>, opts: OperationInput & { signer: TypedDataSigner; delegation?: PresentationDelegation; profileIndex?: number; signal?: AbortSignal; }): Promise<RegisteredVerifierAgentSession>
```

| Parameter | Type | Description |
|---|---|---|
| `client` | `{ createSession(params: CreateSessionParams, options?: { profileIndex?: number; signal?: AbortSignal; }): Promise<RegisteredAgentSession>; }` |  |
| `opts` | `OperationInput & { signer: TypedDataSigner; delegation?: PresentationDelegation; profileIndex?: number; signal?: AbortSignal; }` |  |

Returns: `Promise<RegisteredVerifierAgentSession>`.

## parseApplicationServiceProfiles

Parse the public, JSON-safe deployment approval file. Decimal revisions preserve uint64.

[Source](../../src/chain/serviceProfiles.ts#L33)

Import: `import {parseApplicationServiceProfiles} from 'tasra-sdk/chain'`

```ts
declare function parseApplicationServiceProfiles(value: unknown): ApplicationServiceProfiles
```

| Parameter | Type | Description |
|---|---|---|
| `value` | `unknown` |  |

Returns: `ApplicationServiceProfiles`.

## parseNetworkManifest

Validate data only. Authenticity requires a trusted digest or signature separately.

[Source](../../src/chain/manifest.ts#L44)

Import: `import {parseNetworkManifest} from 'tasra-sdk/chain'`

```ts
declare function parseNetworkManifest(value: unknown): NetworkManifest
```

| Parameter | Type | Description |
|---|---|---|
| `value` | `unknown` |  |

Returns: `NetworkManifest`.

## parsePinnedNetworkManifest

The digest must come from a verified release checksum file or application pin.

[Source](../../src/chain/manifest.ts#L84)

Import: `import {parsePinnedNetworkManifest} from 'tasra-sdk/chain'`

```ts
declare function parsePinnedNetworkManifest(text: string, expectedSha256: string): NetworkManifest
```

| Parameter | Type | Description |
|---|---|---|
| `text` | `string` |  |
| `expectedSha256` | `string` |  |

Returns: `NetworkManifest`.

## parsePrometheus

Parse a Prometheus text exposition into a flat map of `metric{labels}` →
value. Good enough for the explorer's dashboards (counters/gauges); skips
HELP/TYPE/comment lines and histograms' bucket internals are left as-is.

[Source](../../src/chain/offchain.ts#L142)

Import: `import {parsePrometheus} from 'tasra-sdk/chain'`

```ts
declare function parsePrometheus(text: string): Record<string, number>
```

| Parameter | Type | Description |
|---|---|---|
| `text` | `string` |  |

Returns: `Record<string, number>`.

## parseServiceChallenge

Call only after enforcing the same limit while receiving the HTTP body.

[Source](../../src/chain/serviceIdentity.ts#L127)

Import: `import {parseServiceChallenge} from 'tasra-sdk/chain'`

```ts
declare function parseServiceChallenge(bytes: Uint8Array): ServiceChallenge
```

| Parameter | Type | Description |
|---|---|---|
| `bytes` | `Uint8Array<ArrayBufferLike>` |  |

Returns: `ServiceChallenge`.

## provisionRule

Provision a slot's clear rule to every keeper drawn for it.

Throws unless EVERY keeper accepted it — a partial fan-out is reported, not swallowed, even
though it converges (see {@link fanoutError}). The result is attached as `cause.results` so a
caller that wants to tolerate a partial can inspect it.

[Source](../../src/chain/provisionRule.ts#L149)

Import: `import {provisionRule} from 'tasra-sdk/chain'`

```ts
declare function provisionRule(chain: TasraChainClient, args: ProvisionRuleArgs): Promise<ProvisionRuleResult>
```

| Parameter | Type | Description |
|---|---|---|
| `chain` | `TasraChainClient` |  |
| `args` | `ProvisionRuleArgs` |  |

Returns: `Promise<ProvisionRuleResult>`.

## ProvisionRuleArgs

See the declaration and linked source for the contract.

[Source](../../src/chain/provisionRule.ts#L39)

```ts
export interface ProvisionRuleArgs {
  slotId: Hex
  /** The clear DCQL rule, exactly as committed at creation. */
  dcqlRule: string
  /** The 32-byte rule salt `createSlot` returned. It exists NOWHERE else. */
  ruleSalt: Hex
  /** The slot's creator key (or a key it delegated to). */
  signer: TypedDataSigner
  /** Seconds the authorisation stays valid (default 600; the keeper caps at 3600). */
  ttlSecs?: number
  nowSecs?: number
  description?: string
  signal?: AbortSignal
  /** Overrides the on-chain committee; for tests and for a topology chain cannot see. */
  keeperUrls?: string[]
  fetchImpl?: typeof fetch
}
```

## ProvisionRuleResult

See the declaration and linked source for the contract.

[Source](../../src/chain/provisionRule.ts#L69)

```ts
export interface ProvisionRuleResult {
  slotId: Hex
  ruleCommitment: Hex
  results: KeeperProvisionResult[]
}
```

## provisionRuleTypedData

The EIP-712 operation a keeper checks against the slot's on-chain creator.

Reuses the `Keykeeper Presentation` domain and `PresentationOperation` struct so there is ONE
creator-authorisation encoding across the platform — the Rust side verifies this with the
same `keykeeper_eth::presentation_auth` it uses for ADR-0069 D5. A second dialect here would
be two things to keep in agreement, and the one that drifts is the one nobody is watching.

`payloadDigest` is the SALTED COMMITMENT, so the signature reads "provision the preimage of
commitment X to slot Y" rather than "provision anything for slot Y".

[Source](../../src/chain/provisionRule.ts#L86)

Import: `import {provisionRuleTypedData} from 'tasra-sdk/chain'`

```ts
declare function provisionRuleTypedData(input: { chainId: number; keyRegistry: Address; slotId: Hex; commitment: Hex; description: string; exp: number; }): { domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}`; }; types: { readonly PresentationOperation: readonly [{ readonly name: "chainId"; readonly type: "uint256"; }, { readonly name: "slotId"; readonly type: "bytes32"; }, { readonly name: "action"; readonly type: "string"; }, { readonly name: "payloadDigest"; readonly type: "bytes32"; }, { readonly name: "description"; readonly type: "string"; }, { readonly name: "exp"; readonly type: "uint256"; }]; }; primaryType: "PresentationOperation"; message: { chainId: bigint; slotId: `0x${string}`; action: string; payloadDigest: `0x${string}`; description: string; exp: bigint; }; }
```

| Parameter | Type | Description |
|---|---|---|
| `input` | `{ chainId: number; keyRegistry: Address; slotId: Hex; commitment: Hex; description: string; exp: number; }` |  |

Returns: `{ domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}`; }; types: { readonly PresentationOperation: readonly [{ readonly name: "chainId"; readonly type: "uint256"; }, { readonly name: "slotId"; readonly type: "bytes32"; }, { readonly name: "action"; readonly type: "string"; }, { readonly name: "payloadDigest"; readonly type: "bytes32"; }, { readonly name: "description"; readonly type: "string"; }, { readonly name: "exp"; readonly type: "uint256"; }]; }; primaryType: "PresentationOperation"; message: { chainId: bigint; slotId: `0x${string}`; action: string; payloadDigest: `0x${string}`; description: string; exp: bigint; }; }`.

## readApprovedServiceRecord

Read metadata only after matching an explicit application approval. Never contacts the service.
This does NOT authenticate its endpoint, verify its manifest or authorize a verifier-agent
origin. Those checks must precede sending any credentials, session secrets or transactions.

[Source](../../src/chain/services.ts#L107)

Import: `import {readApprovedServiceRecord} from 'tasra-sdk/chain'`

```ts
declare function readApprovedServiceRecord(chain: ServiceRegistryChainReader, approval: ServiceApproval): Promise<{ record: ServiceRecord; blockNumber: bigint; }>
```

| Parameter | Type | Description |
|---|---|---|
| `chain` | `ServiceRegistryChainReader` |  |
| `approval` | `ServiceApproval` |  |

Returns: `Promise<{ record: ServiceRecord; blockNumber: bigint; }>`.

## reconcileRelayAttempt

Recover from a lost HTTP response or process restart using the trusted RPC, without broadcasting.

[Source](../../src/chain/registeredRelay.ts#L173)

Import: `import {reconcileRelayAttempt} from 'tasra-sdk/chain'`

```ts
declare function reconcileRelayAttempt(chain: TasraChainClient, attempt: RelayAttempt, timeoutMs?: number): Promise<RelayReconciliation>
```

| Parameter | Type | Description |
|---|---|---|
| `chain` | `TasraChainClient` |  |
| `attempt` | `RelayAttempt` |  |
| `timeoutMs` | `number` |  |

Returns: `Promise<RelayReconciliation>`.

## RegisteredAgentSession

See the declaration and linked source for the contract.

[Source](../../src/chain/registeredAgent.ts#L18)

```ts
export interface RegisteredAgentSession extends Readonly<CreateSessionResult> {
  readonly profile: Readonly<ApprovedAgentProfile>
  /** Poll only the original endpoint/profile. A provider change requires a fresh wallet session. */
  poll(signal?: AbortSignal): Promise<SessionStatusResult>
}
```

## RegisteredRelayConfig

See the declaration and linked source for the contract.

[Source](../../src/chain/registeredRelay.ts#L21)

```ts
export interface RegisteredRelayConfig {
  /** Application approvals, in preference order. Registry membership alone never selects a service. */
  approvals: readonly ServiceApproval[]
  transport: RelayTransport
  /** Independently pinned deployment forwarder; never supplied by a relayer manifest. */
  forwarder: Address
  label?: string
  /** Persist the signed reconciliation handle before its first POST. */
  persistAttempt?: (attempt: RelayAttempt) => Promise<void>
  /** Load this durable operation's previous attempt before signing, including after a restart. */
  resumeAttempt?: (intent: RelayIntent) => Promise<RelayAttempt | undefined>
  pollMs?: number
  timeoutMs?: number
  /** At most three authenticated providers receive the identical signed request. */
  maxAttempts?: number
  attemptMs?: number
}
```

## RegisteredVerifierAgentSession

See the declaration and linked source for the contract.

[Source](../../src/chain/registeredOperation.ts#L10)

```ts
export interface RegisteredVerifierAgentSession extends RegisteredAgentSession {
  readonly operation: PresentationOperation
  readonly requestHash: Uint8Array
  readonly verifierAgentUrl: string
}
```

## RelayAttempt

JSON-safe reconciliation handle. Persist before POST to resume safely after a client restart.

[Source](../../src/chain/registeredRelay.ts#L57)

```ts
export interface RelayAttempt {
  chainId: number
  forwarder: Address
  fromBlock: string
  id: Hex
  request: {from: Address; to: Address; value: '0'; gas: number; nonce: number; deadline: number; data: Hex; signature: Hex; label: string}
}
```

## RelayConfig

platform-sponsored gas: route SENDER-BOUND calls (slot creation, verifier policy,
settlement funding, curve buys) through the pinned ERC-2771 forwarder via the platform
relayer. The client signs an EIP-712 forward request; the relayer applies its policy to the
inner call, pays the gas and submits `forwarder.execute` from its own key — the target sees
the SIGNER as `_msgSender()`, the relayer authorises nothing. ERC-20 `approve` is not
2771-aware and always comes from the local key.

[Source](../../src/chain/write.ts#L120)

```ts
export type RelayConfig = RegisteredRelayConfig
```

## RelayIntent

See the declaration and linked source for the contract.

[Source](../../src/chain/registeredRelay.ts#L12)

```ts
export interface RelayIntent {
  chainId: number
  forwarder: Address
  from: Address
  to: Address
  data: Hex
  label: string
}
```

## RelayOutcomeUnknownError

See the declaration and linked source for the contract.

[Source](../../src/chain/registeredRelay.ts#L65)

```ts
(attempt: RelayAttempt, reason?: string): RelayOutcomeUnknownError
```

Import: `import {RelayOutcomeUnknownError} from 'tasra-sdk/chain'`

- `attempt: RelayAttempt` — 
- `name: string` — 
- `message: string` — 
- `stack: string &#124; undefined` — 
- `cause: unknown` — 

## RelayReceipt

See the declaration and linked source for the contract.

[Source](../../src/chain/registeredRelay.ts#L39)

```ts
export interface RelayReceipt {
  id: string
  txHash: Hex
  gasUsed?: number
  costWei?: string
}
```

## RelayReconciliation

The outcome of reconciling one signed attempt against the chain.

⚠⚠ THREE OUTCOMES, NOT TWO, AND THE THIRD IS THE ONE THAT MATTERS OPERATIONALLY.
 - `receipt`      — it executed; here is the proof.
 - `expired`      — it never executed and never can (its deadline passed with the nonce still
                    free), so the same operation is safe to sign again.
 - `unresolvable` — its nonce HAS been consumed, so this request can never execute again
                    whatever took it, but the window in which that happened is now further back
                    than the log scan can reach. TERMINAL, outcome unknown.

Collapsing `unresolvable` into "unknown, try again later" is what wedged a live deployment: a
caller that blocks until an attempt resolves blocks FOREVER, because every new block moves the
attempt further out of scan range. It is not a transient condition and retrying cannot fix it.

⚠ `unresolvable` is NOT a statement that the operation did not happen — it very probably did.
A caller must not blindly redo the work; it must re-read the state the operation would have
changed, or surface the attempt for a human. Conflating it with `expired` would turn one
uncertain write into a duplicated one.

[Source](../../src/chain/registeredRelay.ts#L138)

```ts
export interface RelayReconciliation {
  receipt?: RelayReceipt
  expired: boolean
  unresolvable?: boolean
}
```

## RelayTransport

See the declaration and linked source for the contract.

[Source](../../src/chain/registeredRelay.ts#L7)

```ts
export interface RelayTransport extends ServiceDiscoveryTransport {
  /** Guard the socket just like discovery. Accept bounded JSON status bodies for 200/202/422. */
  relayRequest(url: string, options: {body?: Uint8Array; maxBytes: number; signal: AbortSignal}): Promise<Uint8Array>
}
```

## requestSlotSeed

Ask the accountant set for `commitment`'s draw seed, verifying the answer before returning it.

Returns `null` when no accountant could serve one — an unwired endpoint, a set that is down, or
a commitment the chain has not yet caught up to. The caller then falls back to ADR-0030's epoch
wait.

⚠⚠ THE DIGEST IS CHECKED AGAINST THE REGISTRY, not recomputed here. `commitSeedDigest` binds the
   chain id and the registry's own address, and re-deriving it in this SDK would create a second
   copy of that formula that can drift from the contract silently — the exact shape that has
   already cost this codebase a beacon outage. One `eth_call` against the contract the reveal is
   about to be sent to cannot disagree with it.

⚠ The SIGNATURE is not verified here. Verifying a BN254 pairing in TypeScript would mean
  shipping a pairing implementation to do, less reliably, what the reveal does on chain for the
  gas the caller is already spending. What IS checked is everything cheap: shape, length,
  non-infinity, and that the digest is the right one for this commitment.

[Source](../../src/chain/slotSeed.ts#L89)

Import: `import {requestSlotSeed} from 'tasra-sdk/chain'`

```ts
declare function requestSlotSeed(chain: TasraChainClient, keyRegistry: `0x${string}`, commitment: Hex, opts?: SlotSeedOptions): Promise<SlotSeed | null>
```

| Parameter | Type | Description |
|---|---|---|
| `chain` | `TasraChainClient` |  |
| `keyRegistry` | `\`0x${string}\`` |  |
| `commitment` | `\`0x${string}\`` |  |
| `opts` | `SlotSeedOptions` |  |

Returns: `Promise<SlotSeed | null>`.

## requireAddress

Resolve a contract address, throwing a clear error if missing.

[Source](../../src/chain/deployments.ts#L343)

Import: `import {requireAddress} from 'tasra-sdk/chain'`

```ts
declare function requireAddress(book: AddressBook, name: ContractName): Address
```

| Parameter | Type | Description |
|---|---|---|
| `book` | `AddressBook` |  |
| `name` | `"NodeRegistry" &#124; "KeyRegistry" &#124; "ServiceRegistry" &#124; "Settlement" &#124; "TasraToken" &#124; "BondingCurve" &#124; "TasraSwapRouter" &#124; "Treasury" &#124; "TasraVestingVault" &#124; "ThresholdRandomBeacon" &#124; "PrevrandaoSaltBeacon" &#124; "EquivocationSlasher" &#124; "PlatformExecutor" &#124; "FixedTasraPriceOracle" &#124; "MockEurc" &#124; "AccountantSlashing" &#124; "LivenessRegistry" &#124; "VerifierSetRegistry" &#124; "AccountantSetRegistry" &#124; "KeeperShareRegistry"` |  |

Returns: ``0x${string}``.

## requireVaultAddress

Resolve one vesting tranche's vault, falling back to the bare
`TasraVestingVault` entry.

⚠ That fallback is only self-evidently safe for a book built by
{@link addressBookFromBroadcast}, which deletes the bare key as soon as it
sees two vaults. A book built by {@link addressBookFromEnv} carries whatever
the deployment env declared: a `chain.env` with a single `VAULT=0x…` sets the
bare key regardless of how many vaults actually exist, so EVERY tranche then
resolves to that one address. Callers that aggregate across tranches must
de-duplicate on the resolved address — summing three identical vaults reports
3x the real locked supply. Prefer per-tranche keys
(`TASRA_VAULT_INVESTOR` / `_TEAM` / `_COMMUNITY`) in any multi-vault env.

[Source](../../src/chain/deployments.ts#L327)

Import: `import {requireVaultAddress} from 'tasra-sdk/chain'`

```ts
declare function requireVaultAddress(book: AddressBook, tranche: VaultTranche): Address
```

| Parameter | Type | Description |
|---|---|---|
| `book` | `AddressBook` |  |
| `tranche` | `"investor" &#124; "team" &#124; "community"` |  |

Returns: ``0x${string}``.

## resolveAccountantUrls

Every active accountant's HTTP base URL, in registry order.

Used to ask for an ADR-0075 slot seed. Any one of them can serve it — the seed is a threshold
signature the whole set produces, so whichever accountant answers leads the round and the
others verify. A caller therefore tries them in order and stops at the first success.

⚠ Read through `taggedActiveOperatorsPage`, NOT `activeOperators` + a `hasTag` fan-out. The
paged getter walks the contract's compact PER-TAG set, so its cost tracks the number of
accountants (single digits) rather than the operator population — ADR-0068's whole point. The
verifier directory beside this one cannot use it, because its `index` must be the position in
the global active list that the anchored snapshot's leaves are built from; nothing indexes into
this list, so it is free to take the cheap route.

[Source](../../src/chain/discovery.ts#L160)

Import: `import {resolveAccountantUrls} from 'tasra-sdk/chain'`

```ts
declare function resolveAccountantUrls(chain: TasraChainClient): Promise<string[]>
```

| Parameter | Type | Description |
|---|---|---|
| `chain` | `TasraChainClient` |  |

Returns: `Promise<string[]>`.

## ResolvedEndpoints

How the session's endpoints were resolved from chain — surfaced so callers can SEE
which verifier was chosen and which keeper committee the slot is bound to.

[Source](../../src/chain/slotClient.ts#L26)

```ts
export interface ResolvedEndpoints {
  slotId: string
  /** The slot's on-chain assigned keeper node URLs. */
  nodes: string[]
  /** The verifier chosen (at random) from the on-chain set — it issued the JWT. */
  verifier: string
  /** Size of the on-chain verifier set the choice was drawn from. */
  verifierCount: number
}
```

## ResolvedNetworkProfile

See the declaration and linked source for the contract.

[Source](../../src/chain/networks.ts#L13)

```ts
export interface ResolvedNetworkProfile extends NetworkPreset {
  readonly environment: NetworkName
  readonly eurc: NetworkPreset['eurc'] & {readonly address: Address}
}
```

## resolveNetworkProfile

See the declaration and linked source for the contract.

[Source](../../src/chain/networks.ts#L32)

Import: `import {resolveNetworkProfile} from 'tasra-sdk/chain'`

```ts
declare function resolveNetworkProfile(environment: NetworkName, options?: { chainId?: number; rpcUrl?: string; eurcAddress?: string; }): ResolvedNetworkProfile
```

| Parameter | Type | Description |
|---|---|---|
| `environment` | `NetworkName` |  |
| `options` | `{ chainId?: number; rpcUrl?: string; eurcAddress?: string; }` |  |

Returns: `ResolvedNetworkProfile`.

## resolveSlotGroupKey

Read the slot's group public key + epoch straight from `KeyRegistry.getKeySlot` — so
`encrypt` needs no verifier, no JWT, and no node round-trip (it's local + offline once
you hold the key).

[Source](../../src/chain/discovery.ts#L128)

Import: `import {resolveSlotGroupKey} from 'tasra-sdk/chain'`

```ts
declare function resolveSlotGroupKey(chain: TasraChainClient, slotId: `0x${string}`): Promise<SlotGroupKey>
```

| Parameter | Type | Description |
|---|---|---|
| `chain` | `TasraChainClient` |  |
| `slotId` | `\`0x${string}\`` |  |

Returns: `Promise<SlotGroupKey>`.

## resolveSlotKeeperUrls

The slot's assigned keeper nodes, resolved to their HTTP base URLs. These are the
nodes any `/v1/committee/{sign,decrypt}` request for this slot must target. Order
follows `assignedNodes`; url-less operators are skipped.

[Source](../../src/chain/discovery.ts#L45)

Import: `import {resolveSlotKeeperUrls} from 'tasra-sdk/chain'`

```ts
declare function resolveSlotKeeperUrls(chain: TasraChainClient, slotId: `0x${string}`): Promise<string[]>
```

| Parameter | Type | Description |
|---|---|---|
| `chain` | `TasraChainClient` |  |
| `slotId` | `\`0x${string}\`` |  |

Returns: `Promise<string[]>`.

## resolveVerifierDirectory

Enumerate the active verifier set from chain: every active `NodeRegistry` operator
carrying the `keccak256("verifier")` tag, resolved to `{index, url, operator, pubkey}`.

Hand the whole directory to the committee flow — the beacon-seeded on-chain draw
selects the per-request committee from it, and non-drawn verifiers reply
403 and are skipped.

`index` is assigned by **ascending operator address** — the same rule the network uses
to build every tagged set, so this directory's index/leaf order matches the anchored
`VerifierSetRegistry` snapshot. That makes the committee flow's inclusion proofs
derivable, so the keeper validates against on-chain state rather than any statically
configured set.

[Source](../../src/chain/discovery.ts#L75)

Import: `import {resolveVerifierDirectory} from 'tasra-sdk/chain'`

```ts
declare function resolveVerifierDirectory(chain: TasraChainClient): Promise<CommitteeVerifier[]>
```

| Parameter | Type | Description |
|---|---|---|
| `chain` | `TasraChainClient` |  |

Returns: `Promise<CommitteeVerifier[]>`.

## ruleCommitment

The salted rule commitment, `keccak256(DOMAIN ‖ salt ‖ body)`, with the SAME
dispatch as the reference implementation's the reference rule-commitment function — the one every keeper runs when a
rule is provisioned and every verifier runs when it hash-checks a fetched rule:

 - an OID4VP-DCQL rule (`isOid4vpRule`) commits to its RFC 8785 (JCS) canonical form. It
   gets parsed and re-serialised when embedded in a signed OID4VP request object, and any
   JSON library may reorder keys or restyle whitespace, so raw bytes would not survive;
 - any other rule — the keeper's bearer-JWT kk-DCQL grammar, the universal grant `"any"` —
   commits to its RAW bytes, unchanged. Canonicalising those here silently disagreed with
   the keeper, which refused the rule at provisioning as "dcql_rule does not match the
   slot's on-chain commitment" — an error that reads like a typo in a rule that is fine.

[Source](../../src/chain/write.ts#L292)

Import: `import {ruleCommitment} from 'tasra-sdk/chain'`

```ts
declare function ruleCommitment(ruleSalt: Hex, dcqlRule: string): Hex
```

| Parameter | Type | Description |
|---|---|---|
| `ruleSalt` | `\`0x${string}\`` |  |
| `dcqlRule` | `string` |  |

Returns: ``0x${string}``.

## ServiceApproval

Pin the approved revision so an endpoint, key or provider change requires a new decision.

[Source](../../src/chain/services.ts#L24)

```ts
export interface ServiceApproval {
  chainId: number
  registry: Address
  serviceId: Hex
  serviceType: ServiceType
  owner: Address
  revision: bigint
  manifestHash: Hex
}
```

## ServiceChallenge

JSON wire shape. Revision is decimal text to preserve all uint64 values in JavaScript.

[Source](../../src/chain/serviceIdentity.ts#L26)

```ts
export interface ServiceChallenge {
  version: 1
  chainId: number
  registry: Address
  serviceId: Hex
  revision: string
  endpoint: string
  manifestHash: Hex
  nonce: Hex
  expiresAt: number
}
```

## serviceChallengeTypedData

See the declaration and linked source for the contract.

[Source](../../src/chain/serviceIdentity.ts#L92)

Import: `import {serviceChallengeTypedData} from 'tasra-sdk/chain'`

```ts
declare function serviceChallengeTypedData(challenge: ServiceChallenge): { domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}`; }; primaryType: "ServiceIdentity"; types: { ServiceIdentity: { name: string; type: string; }[]; }; message: { serviceId: `0x${string}`; revision: bigint; endpoint: string; manifestHash: `0x${string}`; nonce: `0x${string}`; expiresAt: bigint; }; }
```

| Parameter | Type | Description |
|---|---|---|
| `challenge` | `ServiceChallenge` |  |

Returns: `{ domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}`; }; primaryType: "ServiceIdentity"; types: { ServiceIdentity: { name: string; type: string; }[]; }; message: { serviceId: `0x${string}`; revision: bigint; endpoint: string; manifestHash: `0x${string}`; nonce: `0x${string}`; expiresAt: bigint; }; }`.

## ServiceDiscoveryTransport

Trusted transport boundary. Implementations must enforce destination policy at connection time,
verified TLS, no redirects/proxies/credentials, body limits and cancellation. Use chain/node in Node.
Native browser fetch cannot enforce DNS policy; it is intentionally not a default implementation.

[Source](../../src/chain/serviceIdentity.ts#L158)

```ts
export interface ServiceDiscoveryTransport {
  request(url: string, options: {body?: Uint8Array; maxBytes: number; signal: AbortSignal}): Promise<Uint8Array>
}
```

## ServiceManifest

See the declaration and linked source for the contract.

[Source](../../src/chain/serviceIdentity.ts#L14)

```ts
export interface ServiceManifest {
  schemaVersion: 1
  chainId: number
  registry: Address
  serviceId: Hex
  serviceType: ServiceType
  endpoint: string
  protocol: typeof SERVICE_IDENTITY_PROTOCOL
  capabilities: string[]
}
```

## ServiceRecord

Provider claims, not authenticated endpoints or platform endorsements.

[Source](../../src/chain/services.ts#L12)

```ts
export interface ServiceRecord {
  owner: Address
  pendingOwner: Address
  authKey: Address
  serviceType: ServiceType
  status: ServiceStatus
  revision: bigint
  manifestHash: Hex
  endpoint: string
}
```

## ServiceStatus

See the declaration and linked source for the contract.

[Source](../../src/chain/services.ts#L9)

```ts
export type ServiceStatus = (typeof SERVICE_STATUSES)[keyof typeof SERVICE_STATUSES]
```

## ServiceType

See the declaration and linked source for the contract.

[Source](../../src/chain/services.ts#L8)

```ts
export type ServiceType = (typeof SERVICE_TYPES)[keyof typeof SERVICE_TYPES]
```

## SignedHeartbeat

See the declaration and linked source for the contract.

[Source](../../src/chain/offchain.ts#L76)

```ts
export interface SignedHeartbeat {
  operator: string
  epoch: number
  pubkey: string
  signature: string
  [k: string]: unknown
}
```

## SlotAuthType

How a holder authorises against this slot's rule, mirroring `KeyRegistry.AuthType`.
Pinned at creation and recorded on the slot; `unspecified` (the default) declares
nothing, which is what every slot created before the field existed reads as.

⚠ It is deliberately NOT part of `computeCommitment`, so a commit-reveal creation
may name an auth type the commit never covered — the commitment binds the
parameters that decide the committee, not this label.

[Source](../../src/chain/write.ts#L97)

```ts
export type SlotAuthType = 'unspecified' | 'oid4vp' | 'oauth'
```

## SlotCommitmentExpiredError

A creation may keep its slot/rule inputs, but needs a durably saved new commit salt.

[Source](../../src/chain/commitmentRecovery.ts#L7)

```ts
(chainId: number, keyRegistry: Address, slotId: Hex, commitment: Hex, creator: Address, salt: Hex): SlotCommitmentExpiredError
```

Import: `import {SlotCommitmentExpiredError} from 'tasra-sdk/chain'`

- `chainId: number` — 
- `keyRegistry: \`0x${string}\`` — 
- `slotId: \`0x${string}\`` — 
- `commitment: \`0x${string}\`` — 
- `creator: \`0x${string}\`` — 
- `salt: \`0x${string}\`` — 
- `name: string` — 
- `message: string` — 
- `stack: string &#124; undefined` — 
- `cause: unknown` — 

## SlotCommitteeDecryptOptions

Everything a committee-authorized threshold decrypt needs beyond the slot id.

[Source](../../src/chain/committeeClient.ts#L79)

```ts
export interface SlotCommitteeDecryptOptions {
  ciphertext: Ciphertext
  identity: Uint8Array
  /** BLS identifiers (k..n, distinct) to run the ceremony with. */
  decryptingSet: number[]
  /** The libp2p peers for those identifiers. */
  blsPeers: BlsPeer[]
  userSignature?: Uint8Array
  ciphertextEpoch?: number
  /** Pin the keeper this request targets (anti-Sybil); an on-chain assigned operator. */
  targetKeykeeper?: string
}
```

## SlotCommitteeSignOptions

Per-call overrides for a committee-authorized FROST signature.

[Source](../../src/chain/committeeClient.ts#L70)

```ts
export interface SlotCommitteeSignOptions {
  signingSet?: number[]
  userSignature?: Uint8Array
  /** Pin the keeper this request targets (anti-Sybil). Must be one of the slot's
   *  on-chain assigned operators; there is no way to point at an off-chain node. */
  targetKeykeeper?: string
}
```

## SlotGroupKey

The slot's on-chain group public key + epoch (and mode), for local envelope encrypt.

[Source](../../src/chain/discovery.ts#L115)

```ts
export interface SlotGroupKey {
  /** 0x-prefixed group public key (96-byte compressed G2 for a BLS slot). */
  publicKey: `0x${string}`
  epoch: number
  /** 0 = frost, 1 = bls (KeyRegistry.Mode). Encrypt applies to BLS slots. */
  mode: number
}
```

## SlotMode

The slot's key type, mirroring `KeyRegistry.Mode` on-chain:
`frost` Ed25519 threshold signatures, `bls` BLS12-381 encryption/decryption,
`tecdsa` secp256k1 threshold ECDSA (an EVM account — what `signEoaDigest` needs),
`bls-bn254`, and `tecdsa-p256` (ES256). A deployment need not run keepers for
every mode; creating a slot the fleet cannot key leaves it without a group key.

[Source](../../src/chain/write.ts#L78)

```ts
export type SlotMode = 'frost' | 'bls' | 'tecdsa' | 'bls-bn254' | 'tecdsa-p256'
```

## SlotSeed

What an accountant returns from `POST /v1/slot-seed`.

[Source](../../src/chain/slotSeed.ts#L22)

```ts
export interface SlotSeed {
  commitment: Hex
  /** `KeyRegistry.commitSeedDigest(commitment)` — what the signature is over. */
  digest: Hex
  /** The 64-byte BN254 G1 threshold signature; pass as `seedSig` to `revealKeySlotWithSeed`. */
  signature: Hex
}
```

## SlotSeedOptions

See the declaration and linked source for the contract.

[Source](../../src/chain/slotSeed.ts#L64)

```ts
export interface SlotSeedOptions {
  /** Accountant base URLs. Resolved from `NodeRegistry` when omitted. */
  urls?: string[]
  /** Per-accountant HTTP timeout. The round itself is bounded server-side. */
  timeoutMs?: number
}
```

## TasraChainClient

A read client for a deployment: a configured viem client, log helpers and typed readers.

[Source](../../src/chain/client.ts#L202)

```ts
export interface TasraChainClient {
  /**
   * The configured viem public client. No wallet, no signing.
   *
   * ⚠ NOT multicall-batched: batching is applied explicitly in {@link readMany}, so a
   * chain without Multicall3 keeps working. Firing many reads concurrently through this
   * client costs one request each — go through `readMany` for a per-item fan-out.
   */
  client: PublicClient
  /** The deployment's resolved contract addresses. */
  addresses: AddressBook
  deployedContracts(): ContractName[]
  logSources(contracts?: ContractName[]): Array<{address: Address; contract: ContractName}>
  /** Read one view function across many argument lists. Batched via Multicall3 when
   *  available; a failing item is `null` unless `allowFailure: false`. */
  readMany<T>(
    contract: ContractName,
    functionName: string,
    argsList: readonly unknown[][],
    opts?: ReadManyOpts & {allowFailure?: true},
  ): Promise<Array<T | null>>
  readMany<T>(
    contract: ContractName,
    functionName: string,
    argsList: readonly unknown[][],
    opts: ReadManyOpts & {allowFailure: false},
  ): Promise<T[]>
  /**
   * The Multicall3 address `readMany` will batch through, or `null` when it will read
   * items individually. Resolved once per client and cached; exposed so a caller can
   * SEE which mode it is in rather than inferring it from request counts.
   */
  multicallAddress(): Promise<Address | null>
  getBlockNumber(): Promise<bigint>
  getLogsWindowed(opts: GetLogsWindowedOpts): Promise<DecodedEvent[]>
  getBlockTimestamps(blockNumbers: Iterable<bigint>): Promise<Map<string, number>>
  read<C extends ContractName>(contract: C, functionName: string, args?: readonly unknown[]): Promise<unknown>
  readers: TasraChainReaders
}
```

## TasraSlotClient

See the declaration and linked source for the contract.

[Source](../../src/chain/slotClient.ts#L53)

```ts
export interface TasraSlotClient {
  /** Discover the slot's nodes + choose a verifier from chain, mint the JWT via that
   *  verifier, and return a managed session (encrypt / decrypt / sign). */
  openSession(slotId: string, auth: SessionAuth, opts?: OpenSessionOpts): Promise<Session>
  /** Resolve the endpoints for a slot WITHOUT opening a session (which verifier would be
   *  chosen + the slot's keeper committee). Handy for inspection. */
  resolveEndpoints(slotId: string): Promise<ResolvedEndpoints>
  /** The discovered active verifier directory (cached). */
  verifierDirectory(): Promise<CommitteeVerifier[]>
  sessions(): readonly Session[]
  closeAll(): Promise<void>
}
```

## TasraSlotClientConfig

See the declaration and linked source for the contract.

[Source](../../src/chain/slotClient.ts#L36)

```ts
export interface TasraSlotClientConfig {
  /** Read client for the deployment (RPC + address book). */
  chain: TasraChainClient
  /** This holder's DID (recipient_did / holder for the JWT). */
  identity?: string
  /**
   * Map an on-chain (in-cluster) node/verifier URL to a reachable one — e.g. rewrite the
   * demo fleet's `tasra-node-7:8080` to a host port. Default: identity (URLs used as-is,
   * correct when the caller shares the nodes' network).
   */
  rewriteUrl?: (url: string) => string
  /** Observe the per-session resolution (chosen verifier + discovered nodes). */
  onResolve?: (r: ResolvedEndpoints) => void
  /** JWT refresh skew (ms), forwarded to the session. */
  skewMs?: number
}
```

## TasraWriteClient

A write client for a deployment: slot lifecycle, funding, token and treasury
operations, signed by the configured account.

Written out rather than inferred for the same reason as {@link TasraChainClient }
— inference expands viem's client types inline, and once expanded they reference
internal viem module paths a consumer cannot name (TS2742).

[Source](../../src/chain/write.ts#L977)

```ts
export interface TasraWriteClient {
  /** The account every write is signed with. */
  account: Account
  /** Convenience alias for `account.address`. */
  address: Address
  /** The underlying wallet client. */
  wallet: WalletClient<Transport, Chain, Account>
  /** A read client on the same RPC, used for receipts and balance reads. */
  pub: PublicClient

  /**
   * Create a key slot on chain.
   *
   * ⚠⚠ **PERSIST `slotId` AND `ruleSalt` DURABLY BEFORE DOING ANYTHING ELSE.** This is
   * the only time you are given the salt. The chain stores only the salted commitment
   * `keccak256(DOMAIN ‖ ruleSalt ‖ rule)`, the salt is random and cannot be re-derived,
   * and the SDK persists nothing.
   *
   * Lose it and the slot is **permanently unusable**: a keeper recomputes that
   * commitment before accepting the clear rule, so provisioning fails with
   * `dcql_rule does not match the slot's on-chain commitment` — which reads like a typo
   * in a rule that is fine. There is no recovery path, on chain or off.
   */
  createSlot(args: CreateSlotArgs): Promise<{slotId: Hex; txHash: Hex; ruleSalt: Hex; relay?: RelayReceipt}>
  /**
   * Create a key slot through commit/reveal, so the committee is drawn from a seed that
   * did not exist when the parameters were committed. Tries an accountant seed
   * first and falls back to waiting for a beacon epoch when unavailable.
   *
   * ⚠⚠ The same durability requirement as {@link TasraWriteClient.createSlot}: persist
   * `slotId` and `ruleSalt` before anything else. The fallback can wait on the beacon,
   * increasing the time in which a crash could lose the salt.
   */
  createSlotCommitReveal(
    args: CreateSlotArgs & CommitRevealOptions,
  ): Promise<{slotId: Hex; commitTx: Hex; revealTx: Hex; targetEpoch: number; ruleSalt: Hex; seeded: boolean}>
  fundSlot(slotId: Hex, amount: bigint): Promise<{approveTx: Hex; fundTx: Hex; relay?: RelayReceipt}>
  sendEth(to: Address, wei: bigint): Promise<Hex>
  transferTsra(to: Address, amount: bigint): Promise<Hex>
  rotateKey(slotId: Hex, reason?: string): Promise<Hex>
  reshareKey(slotId: Hex, newOperators: Address[], k: number, n: number, reason?: string): Promise<Hex>
  cancelSlot(slotId: Hex): Promise<Hex>
  renewSlot(slotId: Hex): Promise<Hex>
  setVerifierPolicy(slotId: Hex, committee: number, quorum: number): Promise<Hex>
  setRulePolicy(slotId: Hex, policy: RulePolicyArgs): Promise<Hex>

  buyTsra(eurcAmount: bigint, minTsraOut: bigint): Promise<Hex>
  approveEurcForCurve(amount: bigint): Promise<Hex>
  mintMockEurc(to: Address, amount: bigint): Promise<Hex>
  eurcBalance(a: Address): Promise<bigint>
  redeemTsra(tsraAmount: bigint, minEurcOut?: bigint): Promise<{approveTx: Hex; redeemTx: Hex}>
  burnTsra(amount: bigint): Promise<Hex>
  spotPrice(): Promise<bigint>
  priceAt(sold: bigint): Promise<bigint>

  treasuryWithdraw(to: Address, amount: bigint): Promise<Hex>
  treasuryRefund(to: Address, amount: bigint): Promise<Hex>
  vaultRelease(tranche: VaultTranche): Promise<Hex>

  tsraBalance(of?: Address): Promise<bigint>
  ethBalance(of?: Address): Promise<bigint>
  settlementBalance(slotId: Hex): Promise<bigint>

  /** Whether writes are submitted through a registered relay rather than directly. */
  relayEnabled: boolean
  lastRelay(): RelayReceipt | undefined
  pendingRelayAttempt(): RelayAttempt | undefined
  reconcileRelay(): Promise<{receipt?: RelayReceipt; expired: boolean} | undefined>
}
```

## truncateHex

"0x1234…cdef" — middle-truncate an address/hash for compact display.

[Source](../../src/chain/format.ts#L4)

Import: `import {truncateHex} from 'tasra-sdk/chain'`

```ts
declare function truncateHex(hex: string, lead?: number, tail?: number): string
```

| Parameter | Type | Description |
|---|---|---|
| `hex` | `string` |  |
| `lead` | `number` |  |
| `tail` | `number` |  |

Returns: `string`.

## validateServiceChallenge

Responder must validate against its own configured profile before asking its dedicated key to sign.

[Source](../../src/chain/serviceIdentity.ts#L137)

Import: `import {validateServiceChallenge} from 'tasra-sdk/chain'`

```ts
declare function validateServiceChallenge(challenge: ServiceChallenge, approval: ServiceApproval, endpoint: string, now: number): void
```

| Parameter | Type | Description |
|---|---|---|
| `challenge` | `ServiceChallenge` |  |
| `approval` | `ServiceApproval` |  |
| `endpoint` | `string` |  |
| `now` | `number` |  |

Returns: `void`.

## validateServiceEndpoint

Reject aliases instead of signing a URL which another implementation normalizes differently.

[Source](../../src/chain/serviceIdentity.ts#L46)

Import: `import {validateServiceEndpoint} from 'tasra-sdk/chain'`

```ts
declare function validateServiceEndpoint(endpoint: string): URL
```

| Parameter | Type | Description |
|---|---|---|
| `endpoint` | `string` |  |

Returns: `URL`.

## vaultKey

Address-book key for one vesting tranche, e.g. TasraVestingVault_team.

[Source](../../src/chain/deployments.ts#L75)

Import: `import {vaultKey} from 'tasra-sdk/chain'`

```ts
declare function vaultKey(tranche: VaultTranche): string
```

| Parameter | Type | Description |
|---|---|---|
| `tranche` | `"investor" &#124; "team" &#124; "community"` |  |

Returns: `string`.

## VaultTranche

See the declaration and linked source for the contract.

[Source](../../src/chain/deployments.ts#L72)

```ts
export type VaultTranche = (typeof VAULT_TRANCHES)[number]
```

## VerifierInfo

See the declaration and linked source for the contract.

[Source](../../src/chain/offchain.ts#L120)

```ts
export interface VerifierInfo {
  version?: string
  uptime_secs?: number
  jwt_ttl_secs?: number
  rate_limit_enabled?: boolean
  [k: string]: unknown
}
```

## verifyRuleCommitment

Verify that a disclosed rule matches its on-chain commitment (defence
against a lying verifier inflating the rule). Returns `true` when the commitment
matches, `false` otherwise — never throws on a mismatch.

[Source](../../src/chain/write.ts#L302)

Import: `import {verifyRuleCommitment} from 'tasra-sdk/chain'`

```ts
declare function verifyRuleCommitment(dcqlRule: string, ruleSalt: Hex, onChainRuleCommitment: Hex): boolean
```

| Parameter | Type | Description |
|---|---|---|
| `dcqlRule` | `string` |  |
| `ruleSalt` | `\`0x${string}\`` |  |
| `onChainRuleCommitment` | `\`0x${string}\`` |  |

Returns: `boolean`.

## verifyServiceIdentity

See the declaration and linked source for the contract.

[Source](../../src/chain/serviceIdentity.ts#L145)

Import: `import {verifyServiceIdentity} from 'tasra-sdk/chain'`

```ts
declare function verifyServiceIdentity(challenge: ServiceChallenge, signature: Hex, authKey: Address, now: number): Promise<void>
```

| Parameter | Type | Description |
|---|---|---|
| `challenge` | `ServiceChallenge` |  |
| `signature` | `\`0x${string}\`` |  |
| `authKey` | `\`0x${string}\`` |  |
| `now` | `number` |  |

Returns: `Promise<void>`.

## verifyServiceManifest

See the declaration and linked source for the contract.

[Source](../../src/chain/serviceIdentity.ts#L78)

Import: `import {verifyServiceManifest} from 'tasra-sdk/chain'`

```ts
declare function verifyServiceManifest(bytes: Uint8Array, approval: ServiceApproval, record: ServiceRecord): ServiceManifest
```

| Parameter | Type | Description |
|---|---|---|
| `bytes` | `Uint8Array<ArrayBufferLike>` |  |
| `approval` | `ServiceApproval` |  |
| `record` | `ServiceRecord` |  |

Returns: `ServiceManifest`.

## WriteClientConfig

See the declaration and linked source for the contract.

[Source](../../src/chain/write.ts#L161)

```ts
export type WriteClientConfig = WriteClientKeyConfig | WriteClientWalletConfig
```

## WriteClientKeyConfig

Sovereign-key variant: the SDK owns the account and signs with `privateKey`.

[Source](../../src/chain/write.ts#L137)

```ts
export interface WriteClientKeyConfig extends WriteClientConfigBase {
  /** The CLIENT's own 0x-prefixed 32-byte private key (it signs + pays gas). */
  privateKey: Hex
  wallet?: undefined
}
```

## WriteClientWalletConfig

BYO-signer variant: the caller supplies an account-bound viem `WalletClient`,
so the SDK never sees a private key. This is the browser-wallet path —
MetaMask via wagmi's `getWalletClient()`, a Safe App connector, a hardware
wallet, or any `custom()` transport.

⚠ The supplied client MUST be bound to both an account and a chain (wagmi's
`getWalletClient()` returns one that is). The SDK calls `writeContract`
without passing `chain`/`account`, so an unbound client makes viem throw.

⚠ `rpcUrl` is still required: reads and receipt-waiting go through the SDK's
own PublicClient, never through the wallet's transport.

[Source](../../src/chain/write.ts#L156)

```ts
export interface WriteClientWalletConfig extends WriteClientConfigBase {
  wallet: WalletClient<Transport, Chain, Account>
  privateKey?: undefined
}
```

## Constants and ABI values

| Export | Definition |
|---|---|
| `ACCOUNTANT_TAG` | [Source](../../src/chain/discovery.ts#L144) |
| `accountantSetRegistryAbi` | [Source](../../src/chain/abis/accountantSetRegistry.ts#L5) |
| `accountantSlashingAbi` | [Source](../../src/chain/abis/accountantSlashing.ts#L5) |
| `bondingCurveAbi` | [Source](../../src/chain/abis/bondingCurve.ts#L5) |
| `CONTRACT_ABIS` | [Source](../../src/chain/abis/index.ts#L47) |
| `CONTRACT_CATEGORY` | [Source](../../src/chain/events.ts#L20) |
| `DEFAULT_CHAIN_ID` | [Source](../../src/chain/deployments.ts#L68) |
| `equivocationSlasherAbi` | [Source](../../src/chain/abis/equivocationSlasher.ts#L5) |
| `fixedTasraPriceOracleAbi` | [Source](../../src/chain/abis/fixedTasraPriceOracle.ts#L5) |
| `IMPLEMENTATION_SLOT` | [Source](../../src/chain/manifest.ts#L98) |
| `keeperShareRegistryAbi` | [Source](../../src/chain/abis/keeperShareRegistry.ts#L5) |
| `keyRegistryAbi` | [Source](../../src/chain/abis/keyRegistry.ts#L5) |
| `livenessRegistryAbi` | [Source](../../src/chain/abis/livenessRegistry.ts#L5) |
| `mockEurcAbi` | [Source](../../src/chain/abis/mockEurc.ts#L5) |
| `NETWORKS` | [Source](../../src/chain/networks.ts#L19) |
| `nodeApi` | [Source](../../src/chain/offchain.ts#L94) |
| `nodeRegistryAbi` | [Source](../../src/chain/abis/nodeRegistry.ts#L5) |
| `platformExecutorAbi` | [Source](../../src/chain/abis/platformExecutor.ts#L5) |
| `prevrandaoSaltBeaconAbi` | [Source](../../src/chain/abis/prevrandaoSaltBeacon.ts#L5) |
| `PROVISION_RULE_ACTION` | [Source](../../src/chain/provisionRule.ts#L37) |
| `SERVICE_CHALLENGE_LIFETIME_SECONDS` | [Source](../../src/chain/serviceIdentity.ts#L11) |
| `SERVICE_CHALLENGE_SECONDS` | [Source](../../src/chain/serviceIdentity.ts#L9) |
| `SERVICE_IDENTITY_MAX_BYTES` | [Source](../../src/chain/serviceIdentity.ts#L8) |
| `SERVICE_IDENTITY_PATH` | [Source](../../src/chain/serviceIdentity.ts#L6) |
| `SERVICE_IDENTITY_PROTOCOL` | [Source](../../src/chain/serviceIdentity.ts#L12) |
| `SERVICE_MANIFEST_MAX_BYTES` | [Source](../../src/chain/serviceIdentity.ts#L7) |
| `SERVICE_MANIFEST_PATH` | [Source](../../src/chain/serviceIdentity.ts#L5) |
| `SERVICE_STATUSES` | [Source](../../src/chain/services.ts#L7) |
| `SERVICE_TYPES` | [Source](../../src/chain/services.ts#L6) |
| `serviceRegistryAbi` | [Source](../../src/chain/abis/serviceRegistry.ts#L5) |
| `settlementAbi` | [Source](../../src/chain/abis/settlement.ts#L5) |
| `tasraSwapRouterAbi` | [Source](../../src/chain/abis/tasraSwapRouter.ts#L5) |
| `tasraTokenAbi` | [Source](../../src/chain/abis/tasraToken.ts#L5) |
| `tasraVestingVaultAbi` | [Source](../../src/chain/abis/tasraVestingVault.ts#L5) |
| `thresholdRandomBeaconAbi` | [Source](../../src/chain/abis/thresholdRandomBeacon.ts#L5) |
| `treasuryAbi` | [Source](../../src/chain/abis/treasury.ts#L5) |
| `VAULT_TRANCHES` | [Source](../../src/chain/deployments.ts#L71) |
| `VERIFIER_TAG` | [Source](../../src/chain/discovery.ts#L28) |
| `verifierApi` | [Source](../../src/chain/offchain.ts#L128) |
| `verifierSetRegistryAbi` | [Source](../../src/chain/abis/verifierSetRegistry.ts#L5) |
