# tasra-sdk/chain

Generated from public TypeScript exports.

[SDK reference](README.md) · [Task guides](../README.md) · [Errors](../errors.md)

## Classes

Clients, adapters and error classes.

<details>
<summary>Browse 10 classes</summary>

- [AgentSessionCreationUnknownError](#agentsessioncreationunknownerror)
- [CustodyHealthError](#custodyhealtherror)
- [RelayOutcomeUnknownError](#relayoutcomeunknownerror)
- [ReshareRosterError](#resharerostererror)
- [RotationLockError](#rotationlockerror)
- [RuleAmendmentError](#ruleamendmenterror)
- [SlotCommitmentExpiredError](#slotcommitmentexpirederror)
- [SlotHandoffError](#slothandofferror)
- [SlotRevealNotYetError](#slotrevealnotyeterror)
- [SlotSeedUnavailableError](#slotseedunavailableerror)

</details>

### AgentSessionCreationUnknownError

Session creation may have reached the provider, so automatic retry is unsafe.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/registeredAgent.ts#L88)

Import: `import {AgentSessionCreationUnknownError} from 'tasra-sdk/chain'`

```ts
declare class AgentSessionCreationUnknownError {
    constructor(profile: Readonly<ApprovedAgentProfile>, cause?: unknown);
}
```

- ` readonly profile: Readonly<ApprovedAgentProfile>; ` — Approved verifier-agent profile whose session creation outcome is unknown.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

### CustodyHealthError

A custody-health reply that was not counted, or a slot that could not be read.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/custodyHealth.ts#L98)

Import: `import {CustodyHealthError} from 'tasra-sdk/chain'`

```ts
declare class CustodyHealthError {
    constructor(code: CustodyHealthErrorCode, message: string, opts?: {
        operator?: Address;
        cause?: unknown;
    });
}
```

- ` readonly code: CustodyHealthErrorCode; ` — Refusal category; never infer it from the message.

- ` readonly operator?: Address; ` — Operator whose reply was refused, when the refusal is about one keeper.

- ` readonly retryable: boolean; ` — `false` when retrying the identical request cannot succeed.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

### RelayOutcomeUnknownError

A relay request has no verified terminal result and must be reconciled before replacement.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/registeredRelay.ts#L168)

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

### ReshareRosterError

A reshare roster refused before any vote was signed.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/reshareRoster.ts#L25)

Import: `import {ReshareRosterError} from 'tasra-sdk/chain'`

```ts
declare class ReshareRosterError {
    constructor(code: ReshareRosterErrorCode, message: string, opts?: {
        staying?: number;
        k?: number;
    });
}
```

- ` readonly code: ReshareRosterErrorCode; ` — Refusal category; never infer it from the message.

- ` readonly staying?: number; ` — Current members the roster keeps; set for `keeps-too-few`.

- ` readonly k?: number; ` — Current threshold the roster must keep; set for `keeps-too-few`.

- ` readonly retryable: boolean; ` — `false` when retrying the identical request cannot succeed.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

### RotationLockError

A lock or rotation refused before signing, or a lock the chain did not show after it mined.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/rotationLock.ts#L52)

Import: `import {RotationLockError} from 'tasra-sdk/chain'`

```ts
declare class RotationLockError {
    constructor(code: RotationLockErrorCode, slotId: Hex, message: string, opts?: {
        cause?: unknown;
    });
}
```

- ` readonly code: RotationLockErrorCode; ` — Refusal category; never infer it from the message.

- ` readonly slotId: Hex; ` — Slot the refused call targeted.

- ` readonly retryable: boolean; ` — `false` when retrying the identical request cannot succeed.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

### RuleAmendmentError

A rule-amendment call refused before signing, or an amendment that did not reach the state the
caller asked for. Retryable only for `timelock`, `below-threshold` and `timeout`.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/ruleAmendmentCore.ts#L70)

Import: `import {RuleAmendmentError} from 'tasra-sdk/chain'`

```ts
declare class RuleAmendmentError {
    constructor(code: RuleAmendmentErrorCode, slotId: Hex, message: string, details?: RuleAmendmentErrorDetails);
}
```

- ` readonly code: RuleAmendmentErrorCode; ` — Refusal category; never infer it from the message.

- ` readonly slotId: Hex; ` — Slot the refused call targeted.

- ` readonly pendingVersion?: number; ` — Version of the amendment already pending on chain.

- ` readonly pendingCommitment?: Hex; ` — Salted commitment of the amendment already pending on chain.

- ` readonly hasGuardian?: boolean; ` — Whether the slot has a guardian that could veto the pending amendment.

- ` readonly notBefore?: number; ` — Chain time (Unix seconds) from which the pending amendment may activate.

- ` readonly chainTime?: number; ` — Latest block timestamp (Unix seconds) the check was made against.

- ` readonly have?: number; ` — Keeper adoption votes recorded for the pending amendment.

- ` readonly need?: number; ` — Keeper adoption votes activation needs.

- ` readonly results?: readonly KeeperProvisionResult[]; ` — Per-keeper delivery outcomes, when the refusal came from rule delivery.

- ` readonly phase?: string; ` — Orchestrator phase that was running when the refusal was raised.

- ` readonly retryable: boolean; ` — `false` when retrying the identical request cannot succeed.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

### SlotCommitmentExpiredError

A creation may keep its slot/rule inputs, but needs a durably saved new commit salt.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/commitmentRecovery.ts#L9)

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

### SlotHandoffError

A hand-off refused before signing, or one that did not reach the state the caller asked for.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/slotHandoff.ts#L40)

Import: `import {SlotHandoffError} from 'tasra-sdk/chain'`

```ts
declare class SlotHandoffError {
    constructor(code: SlotHandoffErrorCode, slotId: Hex, message: string, opts?: {
        cause?: unknown;
    });
}
```

- ` readonly code: SlotHandoffErrorCode; ` — Refusal category; never infer it from the message.

- ` readonly slotId: Hex; ` — Slot the refused call targeted.

- ` readonly retryable: boolean; ` — `false` when retrying the identical request cannot succeed.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

### SlotRevealNotYetError

An existing beacon-epoch commitment (made by an older SDK) cannot be revealed yet. The check is made
once; the SDK never waits for the epoch. Resume the same creation once the beacon reaches `targetEpoch`.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/commitmentRecovery.ts#L51)

Import: `import {SlotRevealNotYetError} from 'tasra-sdk/chain'`

```ts
declare class SlotRevealNotYetError {
    constructor(slotId: Hex, commitment: Hex, targetEpoch: number, currentEpoch: number, expiryEpoch: number);
}
```

- ` readonly slotId: Hex; ` — Slot identifier reserved by the creation intent.

- ` readonly commitment: Hex; ` — The epoch-path commitment.

- ` readonly targetEpoch: number; ` — First beacon epoch in which it can be revealed.

- ` readonly currentEpoch: number; ` — Beacon epoch observed by the check.

- ` readonly expiryEpoch: number; ` — Last beacon epoch in which it can be revealed.

- ` readonly retryable: boolean; ` — `false` when retrying the identical request cannot succeed.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

### SlotSeedUnavailableError

No accountant seed could be had for a creation within the bounded window. There is no beacon-epoch
fallback: the epoch seed comes from the same accountant set, so waiting for it adds no liveness,
only up to two hours. `committed` says whether a commitment is already on chain.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/commitmentRecovery.ts#L23)

Import: `import {SlotSeedUnavailableError} from 'tasra-sdk/chain'`

```ts
declare class SlotSeedUnavailableError {
    constructor(detail: {
        slotId: Hex;
        committed: boolean;
        commitment: Hex;
        commitTx?: Hex;
        expiryEpoch?: number;
        failure: SlotSeedFailure;
    });
}
```

**detail** — Which creation, whether its commitment is on chain, and every accountant's last answer.

```ts
readonly detail: {
    slotId: Hex;
    committed: boolean;
    commitment: Hex;
    commitTx?: Hex;
    expiryEpoch?: number;
    failure: SlotSeedFailure;
};
```

- ` readonly retryable: boolean; ` — `false` when retrying the identical request cannot succeed.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

## Functions

Operations you can import and call.

<details>
<summary>Browse 87 functions</summary>

- [addressBookFromBroadcast](#addressbookfrombroadcast)
- [addressBookFromEnv](#addressbookfromenv)
- [addressBookFromManifest](#addressbookfrommanifest)
- [addressBookFromObject](#addressbookfromobject)
- [amendSlotRule](#amendslotrule)
- [applicationServiceProfilesDocument](#applicationserviceprofilesdocument)
- [assertAnchoredWalletRequest](#assertanchoredwalletrequest)
- [assertEurcFaucetAllowed](#asserteurcfaucetallowed)
- [assertExpiredSlotCommitment](#assertexpiredslotcommitment)
- [assertRegisteredWalletRequest](#assertregisteredwalletrequest)
- [assertRelayVoucher](#assertrelayvoucher)
- [assertRelayVoucherIntent](#assertrelayvoucherintent)
- [assessCustodyHealth](#assesscustodyhealth)
- [authenticateApprovedService](#authenticateapprovedservice)
- [awaitRegisteredVerifierAgentResult](#awaitregisteredverifieragentresult)
- [categoryFor](#categoryfor)
- [checkTecdsaReshareRoster](#checktecdsareshareroster)
- [createCommitteeSlotClient](#createcommitteeslotclient)
- [createHeadFollower](#createheadfollower)
- [createRegisteredAgentClient](#createregisteredagentclient)
- [createRegisteredRelaySubmitter](#createregisteredrelaysubmitter)
- [createSlotDrawReader](#createslotdrawreader)
- [createTasraChainClient](#createtasrachainclient)
- [createTasraSlotClient](#createtasraslotclient)
- [createTasraWriteClient](#createtasrawriteclient)
- [custodyStatementHash](#custodystatementhash)
- [custodyStatementIsCurrent](#custodystatementiscurrent)
- [decodeContractLogs](#decodecontractlogs)
- [decodeKeyRotationLockedLogs](#decodekeyrotationlockedlogs)
- [decodeRotationLockRevert](#decoderotationlockrevert)
- [deriveServiceId](#deriveserviceid)
- [drawnVerifierWitnesses](#drawnverifierwitnesses)
- [encodeServiceChallenge](#encodeservicechallenge)
- [encodeServiceManifest](#encodeservicemanifest)
- [eventNamesOf](#eventnamesof)
- [fetchDrawnVerifierWitnesses](#fetchdrawnverifierwitnesses)
- [followHeads](#followheads)
- [formatBps](#formatbps)
- [formatUnits](#formatunits)
- [formatWad](#formatwad)
- [generateClientKey](#generateclientkey)
- [hashServiceManifest](#hashservicemanifest)
- [headFollowerOf](#headfollowerof)
- [isRelayBusyReason](#isrelaybusyreason)
- [isRotationLocked](#isrotationlocked)
- [jsonSafe](#jsonsafe)
- [networkNameForChain](#networknameforchain)
- [observeNetworkManifest](#observenetworkmanifest)
- [openRegisteredVerifierAgentSession](#openregisteredverifieragentsession)
- [parseApplicationServiceProfiles](#parseapplicationserviceprofiles)
- [parseCustodyStatement](#parsecustodystatement)
- [parseNetworkManifest](#parsenetworkmanifest)
- [parsePinnedNetworkManifest](#parsepinnednetworkmanifest)
- [parsePrometheus](#parseprometheus)
- [parseServiceChallenge](#parseservicechallenge)
- [provisionRule](#provisionrule)
- [provisionRuleTypedData](#provisionruletypeddata)
- [readApprovedServiceRecord](#readapprovedservicerecord)
- [readBeaconDrawState](#readbeacondrawstate)
- [readCurrentBeaconEpoch](#readcurrentbeaconepoch)
- [readCustodyHealth](#readcustodyhealth)
- [readRotationLock](#readrotationlock)
- [readRuleAmendment](#readruleamendment)
- [readSlotHandoff](#readslothandoff)
- [readSlotSharing](#readslotsharing)
- [readSlotVerifierDraw](#readslotverifierdraw)
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
- [unfollowHeads](#unfollowheads)
- [validateServiceChallenge](#validateservicechallenge)
- [validateServiceEndpoint](#validateserviceendpoint)
- [vaultKey](#vaultkey)
- [verifyCustodyHealthReply](#verifycustodyhealthreply)
- [verifyCustodyStatement](#verifycustodystatement)
- [verifyRuleCommitment](#verifyrulecommitment)
- [verifyServiceIdentity](#verifyserviceidentity)
- [verifyServiceManifest](#verifyservicemanifest)

</details>

### addressBookFromBroadcast

Build an AddressBook from a parsed Foundry broadcast run JSON. The last
deployment of a given contract name wins (re-deploys later in the run
override). Proxied contracts resolve to the proxy, which is the address
callers must actually talk to.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/deployments.ts#L160)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/deployments.ts#L264)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/manifest.ts#L159)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/deployments.ts#L288)

Import: `import {addressBookFromObject} from 'tasra-sdk/chain'`

```ts
declare function addressBookFromObject(obj: Record<string, string>): AddressBook;
```

| Parameter | Type | Description |
|---|---|---|
| ` obj ` | ` Record<string, string> ` | Object containing canonical contract names or supported environment aliases. |

Returns: ` AddressBook `.

### amendSlotRule

Amend a slot's rule end to end: propose (as the rule admin), deliver the rule to the keepers,
wait for their adoption votes, endorse when a guardian client is given, wait for chain time to
pass `notBefore`, activate, and confirm the active commitment on chain.

Resumable: a proposal already pending with this rule is not proposed again, and a rule already
active returns at once. Every refusal it can know in advance is raised before anything is signed.
It never activates on a timer alone: activation needs the observed votes AND chain time.

An amendable rule means whoever holds the admin key can change who may sign with this key,
without changing the key. Keep the admin key as safe as the slot itself. The guardian can veto
during the delay; without a guardian nobody can. Slots created without a rule admin can never
become amendable.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/ruleAmendment.ts#L131)

Import: `import {amendSlotRule} from 'tasra-sdk/chain'`

```ts
declare function amendSlotRule(writer: TasraWriteClient, chain: TasraChainClient, a: AmendSlotRuleArgs): Promise<AmendSlotRuleResult>;
```

| Parameter | Type | Description |
|---|---|---|
| ` writer ` | ` TasraWriteClient ` | Write client of the slot's rule admin; it proposes and activates. |
| ` chain ` | ` TasraChainClient ` | Reader for the deployment that owns the slot. |
| ` a ` | ` AmendSlotRuleArgs ` | The amendment, its deliverer, an optional guardian client and wait controls. |

Returns: ` Promise<AmendSlotRuleResult> `.

### applicationServiceProfilesDocument

Publish only public approvals, with no runtime transport or private key material.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/serviceProfiles.ts#L86)

Import: `import {applicationServiceProfilesDocument} from 'tasra-sdk/chain'`

```ts
declare function applicationServiceProfilesDocument(profiles: ApplicationServiceProfiles): Record<string, unknown>;
```

| Parameter | Type | Description |
|---|---|---|
| ` profiles ` | ` ApplicationServiceProfiles ` | Application-approved service profiles to serialize without private runtime data. |

Returns: ` Record<string, unknown> `.

### assertAnchoredWalletRequest

As [assertRegisteredWalletRequest](#assertregisteredwalletrequest), and re-anchored on the session's own verifier draw as
the CHAIN gives it, before anything is presented or a QR is shown. Nothing the agent reports
about its draw is taken on trust:
- the draw (`readSlotVerifierDraw` / `createSlotDrawReader`, for the slot and the epoch the
  session names) is the chain's: the epoch is the beacon's current or previous one, the seed is
  `seedAt(epoch)`, the root and size are the verifier set's `snapshotAt(epoch)`, the committee
  and quorum the slot's policy; the session's reported context must equal it field for field;
- the committee is recomputed locally from those values and must be the one the session names,
  with every drawn member's key proven against the anchored root (`trust.witnesses`);
- the Request Object must verify under the authenticated key of the member drawn to sign it,
  whatever key its DID document served;
- the nonce is derived locally from that anchored context (and, in session mode, this client's
  session key).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/registeredOperation.ts#L196)

Import: `import {assertAnchoredWalletRequest} from 'tasra-sdk/chain'`

```ts
declare function assertAnchoredWalletRequest(session: RegisteredVerifierAgentSession, ro: VerifiedRequestObject, status: SessionStatusResult, trust: SlotDrawTrust): void;
```

| Parameter | Type | Description |
|---|---|---|
| ` session ` | ` RegisteredVerifierAgentSession ` | Authenticated session bound to the signed operation. |
| ` ro ` | ` VerifiedRequestObject ` | Wallet request object as fetched from the session's `requestUri`. |
| ` status ` | ` SessionStatusResult ` | Session status carrying the operation binding preimage. |
| ` trust ` | ` SlotDrawTrust ` | The slot's draw at the session's epoch, read from the chain with authenticated members. |

Returns: ` void `.

### assertEurcFaucetAllowed

Recheck the actual RPC chain immediately before any faucet transaction.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/networks.ts#L89)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/commitmentRecovery.ts#L64)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/registeredOperation.ts#L121)

Import: `import {assertRegisteredWalletRequest} from 'tasra-sdk/chain'`

```ts
declare function assertRegisteredWalletRequest(session: RegisteredVerifierAgentSession, ro: VerifiedRequestObject, status: SessionStatusResult): void;
```

| Parameter | Type | Description |
|---|---|---|
| ` session ` | ` RegisteredVerifierAgentSession ` | Authenticated session bound to the signed operation. |
| ` ro ` | ` VerifiedRequestObject ` | Verified wallet request object whose claims will be presented. |
| ` status ` | ` SessionStatusResult ` | Session status carrying the operation binding preimage. |

Returns: ` void `.

### assertRelayVoucher

Validate voucher shape/binding before submission; signature, standing and status authority remain the relayer's gate.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/relayVoucher.ts#L81)

Import: `import {assertRelayVoucher} from 'tasra-sdk/chain'`

```ts
declare function assertRelayVoucher(raw: unknown, attempt: RelayAttempt, slotId: Hex): asserts raw is RelayVoucher;
```

| Parameter | Type | Description |
|---|---|---|
| ` raw ` | ` unknown ` | Wire voucher returned by the application's approved wallet flow. |
| ` attempt ` | ` RelayAttempt ` | Original signed forward request to which the voucher must be bound. |
| ` slotId ` | ` Hex ` | Independently approved sponsorship slot. |

Returns: ` asserts raw is RelayVoucher `.

### assertRelayVoucherIntent

Validate intent shape and exact request/chain/slot binding; creator authority is verified by the approved agent.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/relayVoucher.ts#L60)

Import: `import {assertRelayVoucherIntent} from 'tasra-sdk/chain'`

```ts
declare function assertRelayVoucherIntent(raw: unknown, attempt: RelayAttempt, slotId: Hex): asserts raw is RelayVoucherIntent;
```

| Parameter | Type | Description |
|---|---|---|
| ` raw ` | ` unknown ` | Sponsor intent received from the authenticated approved relayer. |
| ` attempt ` | ` RelayAttempt ` | Original signed forward request, retained before wallet authorization. |
| ` slotId ` | ` Hex ` | Independently approved sponsorship slot. |

Returns: ` asserts raw is RelayVoucherIntent `.

### assessCustodyHealth

Classify a committee by its live members: `frozen` below `k`, `ok` when all are live or more
than one above `k`, `at_risk` otherwise. The keepers' reshare monitor rule with a margin of one.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/custodyHealth.ts#L329)

Import: `import {assessCustodyHealth} from 'tasra-sdk/chain'`

```ts
declare function assessCustodyHealth(live: number, k: number, n: number): CustodyHealthLevel;
```

| Parameter | Type | Description |
|---|---|---|
| ` live ` | ` number ` | Live committee members. |
| ` k ` | ` number ` | Signing threshold. |
| ` n ` | ` number ` | Committee size. |

Returns: ` CustodyHealthLevel `.

### authenticateApprovedService

Uncached, bounded discovery only. A result is a short-lived observation, not verifier-agent or gas authorization.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L260)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/registeredOperation.ts#L70)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/events.ts#L69)

Import: `import {categoryFor} from 'tasra-sdk/chain'`

```ts
declare function categoryFor(contract: ContractName, eventName: string): EventCategory;
```

| Parameter | Type | Description |
|---|---|---|
| ` contract ` | ` ContractName ` | Contract that emitted the event. |
| ` eventName ` | ` string ` | Decoded event name used for category overrides. |

Returns: ` EventCategory `.

### checkTecdsaReshareRoster

Check a threshold-ECDSA reshare proposal against the network's overlap rule before anything is signed: a
well-formed roster (`n` distinct addresses, `2 <= k <= n <= 50`, since threshold ECDSA needs at
least two signers) that keeps at least the current `k` members. Refuses `invalid-roster` and
`keeps-too-few` as a `ReshareRosterError`.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/reshareRoster.ts#L79)

Import: `import {checkTecdsaReshareRoster} from 'tasra-sdk/chain'`

```ts
declare function checkTecdsaReshareRoster(input: TecdsaReshareRosterInput): TecdsaReshareRosterPlan;
```

| Parameter | Type | Description |
|---|---|---|
| ` input ` | ` TecdsaReshareRosterInput ` | Current committee and threshold, and the proposed roster and threshold. |

Returns: ` TecdsaReshareRosterPlan `.

### createCommitteeSlotClient

Create registry-discovered threshold signing, encryption and decryption operations. Signing and decryption require holder credentials and proofs against an anchored verifier snapshot. Encryption needs only the public group key read from the chain. The master key is not reconstructed by these threshold operations.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/committeeClient.ts#L146)

Import: `import {createCommitteeSlotClient} from 'tasra-sdk/chain'`

```ts
declare function createCommitteeSlotClient(cfg: CommitteeSlotClientConfig): CommitteeSlotClient;
```

| Parameter | Type | Description |
|---|---|---|
| ` cfg ` | ` CommitteeSlotClientConfig ` | Chain reader and optional holder credentials and proof callbacks. |

Returns: ` CommitteeSlotClient `.

Return details: Committee client whose operations each take a slot ID.

### createHeadFollower

Create a head follower for `client`. It does nothing until started or fed.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/headFollower.ts#L95)

Import: `import {createHeadFollower} from 'tasra-sdk/chain'`

```ts
declare function createHeadFollower(client: PublicClient, options?: HeadFollowerOptions): HeadFollower;
```

| Parameter | Type | Description |
|---|---|---|
| ` client ` | ` PublicClient ` | Trusted client of the deployment (the same RPC the operation reads). |
| ` options? ` | ` HeadFollowerOptions ` | Finality, window, liveness and polling. |

Returns: ` HeadFollower `.

### createRegisteredAgentClient

Selection authenticates public metadata first. Once POSTed, never silently switch providers.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/registeredAgent.ts#L181)

Import: `import {createRegisteredAgentClient} from 'tasra-sdk/chain'`

```ts
declare function createRegisteredAgentClient(chain: TasraChainClient, config: {
    profiles: readonly ApprovedAgentProfile[];
    transport: AgentTransport;
}): {
    restoreSession(input: AgentSessionRecovery, options?: {
        signal?: AbortSignal;
    }): Promise<RegisteredAgentSession>;
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
    restoreSession(input: AgentSessionRecovery, options?: {
        signal?: AbortSignal;
    }): Promise<RegisteredAgentSession>;
    createSession(params: CreateSessionParams, options?: {
        profileIndex?: number;
        signal?: AbortSignal;
    }): Promise<RegisteredAgentSession>;
}
```

### createRegisteredRelaySubmitter

One signer per instance. Serializes nonces and blocks new signatures after an uncertain result.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/registeredRelay.ts#L284)

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

### createSlotDrawReader

A reader of slot draws for session grants: for `(slot, epoch)` it reads the anchored draw from
the chain, fetches the epoch's verifier snapshot from an approved accountant, verifies every
leaf against the anchored root and returns the drawn verifiers' keys and membership proofs.
A verified result is kept per `(slot, epoch)` (an anchored epoch never changes); a failure is
never kept.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/sessionDraw.ts#L240)

Import: `import {createSlotDrawReader} from 'tasra-sdk/chain'`

```ts
declare function createSlotDrawReader(config: SlotDrawReaderConfig): (slot: Hex, epoch: bigint, signal?: AbortSignal) => Promise<SlotDrawTrust>;
```

| Parameter | Type | Description |
|---|---|---|
| ` config ` | ` SlotDrawReaderConfig ` | - Chain client, deployment, snapshot hosts and the default verifier policy. |

Returns: ` (slot: Hex, epoch: bigint, signal?: AbortSignal) => Promise<SlotDrawTrust> `.

### createTasraChainClient

Create a read-only chain client with typed contract readers and windowed event queries. Configure addresses and the chain ID from a network manifest downloaded from tasra-releases.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/client.ts#L350)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/slotClient.ts#L78)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/write.ts#L647)

Import: `import {createTasraWriteClient} from 'tasra-sdk/chain'`

```ts
declare function createTasraWriteClient(cfg: WriteClientConfig): TasraWriteClient;
```

| Parameter | Type | Description |
|---|---|---|
| ` cfg ` | ` WriteClientConfig ` | RPC, manifest contract addresses, chain ID and an explicit signing account. |

Returns: ` TasraWriteClient `.

### custodyStatementHash

`keccak256(domain || fields)`, every field fixed-width or length-prefixed and every optional
field tagged: the 32 bytes a keeper signs. Identical to the network's `custody_statement_hash`.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/custodyHealth.ts#L128)

Import: `import {custodyStatementHash} from 'tasra-sdk/chain'`

```ts
declare function custodyStatementHash(s: CustodyStatement): Uint8Array;
```

| Parameter | Type | Description |
|---|---|---|
| ` s ` | ` CustodyStatement ` | Statement to hash; integers must be non-negative safe integers. |

Returns: ` Uint8Array `.

### custodyStatementIsCurrent

Whether a verified statement proves the keeper holds a share of the chain's current generation:
`current`, a share of the chain's key, at the chain's committee version. The rule the keepers
apply before retiring old shares.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/custodyHealth.ts#L314)

Import: `import {custodyStatementIsCurrent} from 'tasra-sdk/chain'`

```ts
declare function custodyStatementIsCurrent(s: CustodyStatement, chain: {
    committeeVersion: number;
    publicKey: Hex;
}): boolean;
```

| Parameter | Type | Description |
|---|---|---|
| ` s ` | ` CustodyStatement ` | A verified statement. |
| ` chain ` | ` { committeeVersion: number; publicKey: Hex; } ` | The chain's committee version and public key. |

Returns: ` boolean `.

### decodeContractLogs

Decode raw logs (already filtered to `address`) against `contract`'s ABI.
Non-matching / anonymous logs are skipped. `strict:false` tolerates logs
whose indexed topics can't be fully decoded.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/events.ts#L131)

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

### decodeKeyRotationLockedLogs

Decode every `KeyRotationLocked(bytes32 indexed slotId)` among `logs`. Other events are skipped.
A tECDSA slot is locked by its mode and may never emit one; use `isRotationLocked` for the state.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/rotationLock.ts#L225)

Import: `import {decodeKeyRotationLockedLogs} from 'tasra-sdk/chain'`

```ts
declare function decodeKeyRotationLockedLogs(logs: readonly Log[], keyRegistry?: Address): KeyRotationLockedEvent[];
```

| Parameter | Type | Description |
|---|---|---|
| ` logs ` | ` readonly Log[] ` | Raw logs, from a receipt or `getLogs`. |
| ` keyRegistry? ` | ` Address ` | When given, logs from any other contract are skipped. |

Returns: ` KeyRotationLockedEvent[] `.

### decodeRotationLockRevert

Decode `RotationLocked()` or `TecdsaReshareKeepsTooFew(staying, k)` from an error or raw revert
data; `undefined` for anything else. Both are final: the identical call reverts again.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/rotationLock.ts#L194)

Import: `import {decodeRotationLockRevert} from 'tasra-sdk/chain'`

```ts
declare function decodeRotationLockRevert(error: unknown): RotationLockRevert | undefined;
```

| Parameter | Type | Description |
|---|---|---|
| ` error ` | ` unknown ` | A viem or RPC error carrying revert data, or the revert data itself. |

Returns: ` RotationLockRevert | undefined `.

### deriveServiceId

Matches serviceIdFor on the proxy. Provider transfer does not change this ID.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/services.ts#L120)

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

### drawnVerifierWitnesses

Verify a snapshot artifact against the anchored draw and return the drawn members with
Merkle proofs. Every leaf is checked against the anchored root, operators are strictly
ordered and keys distinct; the draw is recomputed locally from the anchored seed.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/verifierSnapshot.ts#L84)

Import: `import {drawnVerifierWitnesses} from 'tasra-sdk/chain'`

```ts
declare function drawnVerifierWitnesses(value: unknown, original: AnchoredVerifierDraw, registry: Address): VerifierWitness[];
```

| Parameter | Type | Description |
|---|---|---|
| ` value ` | ` unknown ` | Parsed artifact JSON from an approved host; untrusted. |
| ` original ` | ` AnchoredVerifierDraw ` | The slot's anchored verifier draw. |
| ` registry ` | ` Address ` | Independently approved VerifierSetRegistry address. |

Returns: ` VerifierWitness[] `.

### encodeServiceChallenge

Canonical wire encoding accepted by both responder implementations.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L175)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L106)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/events.ts#L83)

Import: `import {eventNamesOf} from 'tasra-sdk/chain'`

```ts
declare function eventNamesOf(contract: ContractName): string[];
```

| Parameter | Type | Description |
|---|---|---|
| ` contract ` | ` ContractName ` | Contract whose vendored ABI supplies the event definitions. |

Returns: ` string[] `.

### fetchDrawnVerifierWitnesses

Fetch an epoch's verifier snapshot from the first approved accountant that serves a bounded,
identity-encoded JSON body (no redirects), and return the drawn witnesses for the draw.
A host whose artifact does not verify is skipped; the call fails if none does.
`waitForPublicationMs` defaults to zero. A positive value (at most 150000 ms)
permits paced reads only while every host returns 404, using the original
policy captured at entry. Invalid artifacts and other failures are not retried.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/verifierSnapshot.ts#L132)

Import: `import {fetchDrawnVerifierWitnesses} from 'tasra-sdk/chain'`

```ts
declare function fetchDrawnVerifierWitnesses(hosts: readonly string[], original: AnchoredVerifierDraw, registry: Address, options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
    waitForPublicationMs?: number;
    fetch?: typeof fetch;
}): Promise<{
    witnesses: VerifierWitness[];
    artifact: unknown;
    host: string;
}>;
```

| Parameter | Type | Description |
|---|---|---|
| ` hosts ` | ` readonly string[] ` | Independently approved accountant origins, in preference order. |
| ` original ` | ` AnchoredVerifierDraw ` | The slot's anchored verifier draw. |
| ` registry ` | ` Address ` | Independently approved VerifierSetRegistry address. |
| ` options? ` | ` { signal?: AbortSignal; timeoutMs?: number; waitForPublicationMs?: number; fetch?: typeof fetch; } ` | Cancellation, per-host timeout (default 15000 ms), optional bounded publication wait and a fetch implementation. |

Returns:

```ts
Promise<{
    witnesses: VerifierWitness[];
    artifact: unknown;
    host: string;
}>
```

### followHeads

Follow `client`'s chain head: operations on this client then read block-pinned facts from
the followed tip and its pre-reads, falling back to RPC whenever the follower cannot vouch.
Replaces (and stops) a follower attached before. Returns the started follower.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/headFollower.ts#L240)

Import: `import {followHeads} from 'tasra-sdk/chain'`

```ts
declare function followHeads(client: PublicClient, options?: HeadFollowerOptions): HeadFollower;
```

| Parameter | Type | Description |
|---|---|---|
| ` client ` | ` PublicClient ` | Trusted client of the deployment. |
| ` options? ` | ` HeadFollowerOptions ` | Finality (declare `instant` only for a chain whose accepted blocks are final), window, liveness, polling. |

Returns: ` HeadFollower `.

### formatBps

Format a basis-points integer (e.g. 1000) as a percentage string ("10%").

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/format.ts#L45)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/format.ts#L22)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/format.ts#L55)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/write.ts#L614)

Import: `import {generateClientKey} from 'tasra-sdk/chain'`

```ts
declare function generateClientKey(): Hex;
```

Returns: ` Hex `.

### hashServiceManifest

Hash the exact downloaded/published bytes; never parse and re-serialize before checking.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/services.ts#L145)

Import: `import {hashServiceManifest} from 'tasra-sdk/chain'`

```ts
declare function hashServiceManifest(bytes: Uint8Array): Hex;
```

| Parameter | Type | Description |
|---|---|---|
| ` bytes ` | ` Uint8Array ` | Exact canonical manifest bytes; do not parse and reserialize before hashing. |

Returns: ` Hex `.

### headFollowerOf

The follower attached to `client`, if any.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/headFollower.ts#L229)

Import: `import {headFollowerOf} from 'tasra-sdk/chain'`

```ts
declare function headFollowerOf(client: PublicClient): HeadFollower | undefined;
```

| Parameter | Type | Description |
|---|---|---|
| ` client ` | ` PublicClient ` | Client the follower was attached to. |

Returns: ` HeadFollower | undefined `.

### isRelayBusyReason

True for a relayer refusal about its own load rather than the request: a full lane, a full
journal or an unavailable shared sponsorship budget. The relayer answers these 422 `rejected`
with `Retry-After` before journaling anything. "shared daily spend cap reached", quota and
policy refusals are not busy.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/registeredRelay.ts#L84)

Import: `import {isRelayBusyReason} from 'tasra-sdk/chain'`

```ts
declare function isRelayBusyReason(reason: unknown): boolean;
```

| Parameter | Type | Description |
|---|---|---|
| ` reason ` | ` unknown ` | The `reason` text of a relayer `rejected` status. |

Returns: ` boolean `.

### isRotationLocked

Whether no rotation can change the slot's key: the creator locked it, or it is a threshold
ECDSA slot (locked by its mode). Refuses `no-slot` and `unsupported` as a `RotationLockError`.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/rotationLock.ts#L134)

Import: `import {isRotationLocked} from 'tasra-sdk/chain'`

```ts
declare function isRotationLocked(chain: TasraChainClient, slotId: Hex): Promise<boolean>;
```

| Parameter | Type | Description |
|---|---|---|
| ` chain ` | ` TasraChainClient ` | Reader for the deployment that owns the slot. |
| ` slotId ` | ` Hex ` | Slot to read. |

Returns: ` Promise<boolean> `.

### jsonSafe

Recursively convert bigints to strings so a decoded event can be JSON
serialized / stored. Leaves everything else intact.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/events.ts#L167)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/networks.ts#L49)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/manifest.ts#L208)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/registeredOperation.ts#L36)

Import: `import {openRegisteredVerifierAgentSession} from 'tasra-sdk/chain'`

```ts
declare function openRegisteredVerifierAgentSession(client: Pick<ReturnType<typeof createRegisteredAgentClient>, 'createSession'>, opts: OperationInput & {
    signer: TypedDataSigner;
    delegation?: PresentationDelegation;
    profileIndex?: number;
    signal?: AbortSignal;
    sessionGrant?: SessionGrantRequestWire;
}): Promise<RegisteredVerifierAgentSession>;
```

| Parameter | Type | Description |
|---|---|---|
| ` client ` | ` Pick<ReturnType<typeof createRegisteredAgentClient>, 'createSession'> ` | Registered agent client with independently approved providers. |
| ` opts ` | See detailed type below. | Exact operation, authorizing signer and optional delegation or cancellation. |

**` opts ` type**

```ts
OperationInput & {
    signer: TypedDataSigner;
    delegation?: PresentationDelegation;
    profileIndex?: number;
    signal?: AbortSignal;
    sessionGrant?: SessionGrantRequestWire;
}
```

Returns: ` Promise<RegisteredVerifierAgentSession> `.

### parseApplicationServiceProfiles

Parse the public, JSON-safe deployment approval file. Decimal revisions preserve uint64.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/serviceProfiles.ts#L50)

Import: `import {parseApplicationServiceProfiles} from 'tasra-sdk/chain'`

```ts
declare function parseApplicationServiceProfiles(value: unknown): ApplicationServiceProfiles;
```

| Parameter | Type | Description |
|---|---|---|
| ` value ` | ` unknown ` | Parsed approval object or its JSON text. |

Returns: ` ApplicationServiceProfiles `.

### parseCustodyStatement

Parse a statement as the network serializes it (snake case). Refuses unknown fields: they would
not be covered by the signature. Throws `CustodyHealthError` with code `malformed`.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/custodyHealth.ts#L192)

Import: `import {parseCustodyStatement} from 'tasra-sdk/chain'`

```ts
declare function parseCustodyStatement(raw: unknown): CustodyStatement;
```

| Parameter | Type | Description |
|---|---|---|
| ` raw ` | ` unknown ` | The `attestation.statement` value of a reply. |

Returns: ` CustodyStatement `.

### parseNetworkManifest

Validate data only. Authenticity requires a trusted digest or signature separately.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/manifest.ts#L104)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/manifest.ts#L148)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/offchain.ts#L202)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L190)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/provisionRule.ts#L207)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/provisionRule.ts#L144)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/services.ts#L190)

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

### readBeaconDrawState

The beacon's latest epoch and its draw epoch ([BeaconDrawState](#beacondrawstate)) at ONE fresh observed head
(the followed tip when live, else `latest`), through block-pinned reads. The previous epoch's
snapshot is read only while the latest one is not anchored. Performs no transaction.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/sessionDraw.ts#L117)

Import: `import {readBeaconDrawState} from 'tasra-sdk/chain'`

```ts
declare function readBeaconDrawState(client: PublicClient, deployment: BeaconDeployment): Promise<BeaconDrawState>;
```

| Parameter | Type | Description |
|---|---|---|
| ` client ` | ` PublicClient ` | - Trusted bounded Viem RPC client for the selected deployment. |
| ` deployment ` | ` BeaconDeployment ` | - Independently approved chain and contract addresses, the beacon and verifier set included. |

Returns: ` Promise<BeaconDrawState> `.

### readCurrentBeaconEpoch

The beacon's current epoch at a fresh observed head (the followed tip when live, else `latest`),
through a block-pinned read. Performs no transaction.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/sessionDraw.ts#L89)

Import: `import {readCurrentBeaconEpoch} from 'tasra-sdk/chain'`

```ts
declare function readCurrentBeaconEpoch(client: PublicClient, deployment: BeaconDeployment, options?: {
    fresh?: boolean;
}): Promise<bigint>;
```

| Parameter | Type | Description |
|---|---|---|
| ` client ` | ` PublicClient ` | - Trusted bounded Viem RPC client for the selected deployment. |
| ` deployment ` | ` BeaconDeployment ` | - Independently approved chain and contract addresses, the beacon included. |
| ` options? ` | ` { fresh?: boolean; } ` | - `fresh`: read at an RPC `latest` head of its own, never a followed tip. For a decision a tip lagging the chain would get wrong (confirming that a grant left the window: a keeper judged it at a newer head). |

Returns: ` Promise<bigint> `.

### readCustodyHealth

Poll every assigned keeper of a slot for its custody health and verify each reply against the
operator's registered identity key. The committee's liveness, margin, health and rotation lock
come from the SDK's own chain reads; the keepers contribute only their signed statements.
A keeper whose reply is refused is listed in `refused` and never counted. Refuses `no-slot`.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/custodyHealth.ts#L446)

Import: `import {readCustodyHealth} from 'tasra-sdk/chain'`

```ts
declare function readCustodyHealth(chain: TasraChainClient, slotId: Hex, options?: ReadCustodyHealthOptions): Promise<CustodyHealthReport>;
```

| Parameter | Type | Description |
|---|---|---|
| ` chain ` | ` TasraChainClient ` | Reader for the deployment that owns the slot. |
| ` slotId ` | ` Hex ` | Slot to poll. |
| ` options? ` | ` ReadCustodyHealthOptions ` | Expected chain, transport, cancellation and freshness policy. |

Returns: ` Promise<CustodyHealthReport> `.

### readRotationLock

Read a slot's rotation lock: whether the creator locked it, whether its mode locks it, and the
effective lock. Refuses `no-slot` and `unsupported` as a `RotationLockError`.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/rotationLock.ts#L124)

Import: `import {readRotationLock} from 'tasra-sdk/chain'`

```ts
declare function readRotationLock(chain: TasraChainClient, slotId: Hex): Promise<RotationLockStatus>;
```

| Parameter | Type | Description |
|---|---|---|
| ` chain ` | ` TasraChainClient ` | Reader for the deployment that owns the slot. |
| ` slotId ` | ` Hex ` | Slot to read. |

Returns: ` Promise<RotationLockStatus> `.

### readRuleAmendment

Read a slot's active rule commitment, amendment policy and pending amendment, including the
keeper adoption votes and the votes activation needs.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/ruleAmendment.ts#L61)

Import: `import {readRuleAmendment} from 'tasra-sdk/chain'`

```ts
declare function readRuleAmendment(chain: TasraChainClient, slotId: Hex): Promise<RuleAmendmentStatus>;
```

| Parameter | Type | Description |
|---|---|---|
| ` chain ` | ` TasraChainClient ` | Reader for the deployment that owns the slot. |
| ` slotId ` | ` Hex ` | Slot to read; a missing or cancelled slot throws `RuleAmendmentError` code `no-slot`. |

Returns: ` Promise<RuleAmendmentStatus> `.

### readSlotHandoff

Read a slot's creator, rule admin, guardian and any pending hand-off of either role.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/slotHandoff.ts#L129)

Import: `import {readSlotHandoff} from 'tasra-sdk/chain'`

```ts
declare function readSlotHandoff(chain: TasraChainClient, slotId: Hex): Promise<SlotHandoffStatus>;
```

| Parameter | Type | Description |
|---|---|---|
| ` chain ` | ` TasraChainClient ` | Reader for the deployment that owns the slot. |
| ` slotId ` | ` Hex ` | Slot to read; refuses `no-slot`, `cancelled` and `unsupported` as a `SlotHandoffError`. |

Returns: ` Promise<SlotHandoffStatus> `.

### readSlotSharing

Read a BLS slot's current sharing: the slot's epoch, sharing version and threshold, its assigned
keepers with their registered identity keys, and each keeper's authenticated 144-byte public
verifying share. This is everything a recipient-sealed decryption or a session decrypt needs
beside its authorization. Performs no transaction; fetches no secret.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/slotSharing.ts#L45)

Import: `import {readSlotSharing} from 'tasra-sdk/chain'`

```ts
declare function readSlotSharing(chain: TasraChainClient, slotId: Hex, options?: SlotSharingOptions): Promise<SlotSharing>;
```

| Parameter | Type | Description |
|---|---|---|
| ` chain ` | ` TasraChainClient ` | - Reader for the deployment owning the slot. |
| ` slotId ` | ` Hex ` | - 32-byte slot ID of a BLS slot with a published key. |
| ` options? ` | ` SlotSharingOptions ` | - Keeper route mapping, transport, local HTTP and cancellation. |

Returns: ` Promise<SlotSharing> `.

### readSlotVerifierDraw

One slot's verifier draw at `epoch`, read at ONE fresh observed head: the beacon seed and the
anchored verifier-set snapshot of that epoch, and the slot's committee policy. The epoch must be
the beacon's latest or previous one (no keeper or verifier admits another) with its seed and
snapshot anchored, and the registries must point at this beacon. Performs no transaction.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/sessionDraw.ts#L152)

Import: `import {readSlotVerifierDraw} from 'tasra-sdk/chain'`

```ts
declare function readSlotVerifierDraw(client: PublicClient, deployment: SessionDrawDeployment, slot: Hex, epoch: bigint, options?: SlotVerifierDrawOptions): Promise<AnchoredVerifierDraw>;
```

| Parameter | Type | Description |
|---|---|---|
| ` client ` | ` PublicClient ` | - Trusted bounded Viem RPC client for the selected deployment. |
| ` deployment ` | ` SessionDrawDeployment ` | - Independently approved chain and contract addresses. |
| ` slot ` | ` Hex ` | - 32-byte slot ID. |
| ` epoch ` | ` bigint ` | - The grant's (or token's) draw epoch. |
| ` options? ` | ` SlotVerifierDrawOptions ` | - The deployment's default verifier policy. |

Returns: ` Promise<AnchoredVerifierDraw> `.

### reconcileRelayAttempt

Recover from a lost HTTP response or process restart using the trusted RPC, without broadcasting.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/registeredRelay.ts#L271)

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

Request a committee draw seed and compare its digest with the registry. Checks signature encoding and rejects the point at infinity; signature cryptography is verified during the on-chain reveal. Accountants are asked concurrently and the first valid seed wins.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/slotSeed.ts#L226)

Import: `import {requestSlotSeed} from 'tasra-sdk/chain'`

```ts
declare function requestSlotSeed(chain: TasraChainClient, keyRegistry: `0x${string}`, commitment: Hex, opts?: SlotSeedOptions): Promise<SlotSeed | null>;
```

| Parameter | Type | Description |
|---|---|---|
| ` chain ` | ` TasraChainClient ` | Reader for the deployment owning the commitment. |
| ` keyRegistry ` | `` `0x${string}` `` | Registry that will receive the reveal transaction. |
| ` commitment ` | ` Hex ` | Previously submitted creation commitment. |
| ` opts? ` | ` SlotSeedOptions ` | Accountant endpoints, request timeout, retry window and cancellation. |

Returns: ` Promise<SlotSeed | null> `.

Return details: A seed response, or null when no accountant returns an acceptable response within the window.

### requireAddress

Resolve a contract address, throwing a clear error if missing.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/deployments.ts#L325)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/deployments.ts#L305)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/discovery.ts#L146)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/networks.ts#L61)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/discovery.ts#L124)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/discovery.ts#L47)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/discovery.ts#L68)

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

Compute the salted rule commitment. OID4VP queries and `kk_oauth` policy envelopes use canonical JSON; other rule formats retain their exact bytes.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/write.ts#L588)

Import: `import {ruleCommitment} from 'tasra-sdk/chain'`

```ts
declare function ruleCommitment(ruleSalt: Hex, rule: string): Hex;
```

| Parameter | Type | Description |
|---|---|---|
| ` ruleSalt ` | ` Hex ` | Private 32-byte salt saved with the slot creation intent. |
| ` rule ` | ` string ` | Clear authorization rule; OID4VP queries and policy envelopes are canonicalized before hashing. |

Returns: ` Hex `.

### serviceChallengeTypedData

Build validated EIP-712 data binding a challenge to the approved service revision and endpoint.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L149)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/format.ts#L9)

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

### unfollowHeads

Detach and stop the follower of `client`.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/headFollower.ts#L252)

Import: `import {unfollowHeads} from 'tasra-sdk/chain'`

```ts
declare function unfollowHeads(client: PublicClient): void;
```

| Parameter | Type | Description |
|---|---|---|
| ` client ` | ` PublicClient ` | Client whose follower to stop. |

Returns: ` void `.

### validateServiceChallenge

Responder must validate against its own configured profile before asking its dedicated key to sign.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L206)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L90)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/deployments.ts#L77)

Import: `import {vaultKey} from 'tasra-sdk/chain'`

```ts
declare function vaultKey(tranche: VaultTranche): string;
```

| Parameter | Type | Description |
|---|---|---|
| ` tranche ` | ` VaultTranche ` | Vesting allocation name. |

Returns: ` string `.

### verifyCustodyHealthReply

Verify one keeper's custody-health reply and return its signed statement. Refused, as a
`CustodyHealthError`: `unsigned` (no attestation), `malformed`, `mismatch` (another chain, slot
or operator, a key other than the registered one, or an unsigned field that contradicts the
signed statement), `bad-signature`, and `stale` (older or newer than the allowed age).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/custodyHealth.ts#L269)

Import: `import {verifyCustodyHealthReply} from 'tasra-sdk/chain'`

```ts
declare function verifyCustodyHealthReply(reply: unknown, expected: ExpectedCustodyReply): VerifiedCustodyReport;
```

| Parameter | Type | Description |
|---|---|---|
| ` reply ` | ` unknown ` | The parsed JSON reply. |
| ` expected ` | ` ExpectedCustodyReply ` | What the reply must be about and the operator's registered key. |

Returns: ` VerifiedCustodyReport `.

### verifyCustodyStatement

Whether `signature` is the operator's ed25519 signature over the statement. Take `publicKey`
from NodeRegistry for `statement.operator`, never from the reply.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/custodyHealth.ts#L149)

Import: `import {verifyCustodyStatement} from 'tasra-sdk/chain'`

```ts
declare function verifyCustodyStatement(statement: CustodyStatement, publicKey: Uint8Array, signature: Uint8Array): boolean;
```

| Parameter | Type | Description |
|---|---|---|
| ` statement ` | ` CustodyStatement ` | Statement as parsed from the reply. |
| ` publicKey ` | ` Uint8Array ` | The operator's registered 32-byte identity key. |
| ` signature ` | ` Uint8Array ` | 64-byte signature from the reply. |

Returns: ` boolean `.

### verifyRuleCommitment

Return whether the disclosed rule and salt reproduce the on-chain commitment. Invalid inputs and mismatches return false.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/write.ts#L601)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L221)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L131)

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
<summary>Browse 121 types</summary>

- [Address](#address)
- [AddressBook](#addressbook)
- [AgentHttpResponse](#agenthttpresponse)
- [AgentSessionRecovery](#agentsessionrecovery)
- [AgentTransport](#agenttransport)
- [AmendmentPhase](#amendmentphase)
- [AmendSlotRuleArgs](#amendslotruleargs)
- [AmendSlotRuleResult](#amendslotruleresult)
- [AnchoredVerifierDraw](#anchoredverifierdraw)
- [ApplicationServiceProfiles](#applicationserviceprofiles)
- [ApprovedAgentProfile](#approvedagentprofile)
- [ApprovedServiceProfile](#approvedserviceprofile)
- [AuthenticatedService](#authenticatedservice)
- [BeaconDeployment](#beacondeployment)
- [BeaconDrawState](#beacondrawstate)
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
- [CreateSlotFromPolicyArgs](#createslotfrompolicyargs)
- [CustodyFailure](#custodyfailure)
- [CustodyHealthErrorCode](#custodyhealtherrorcode)
- [CustodyHealthLevel](#custodyhealthlevel)
- [CustodyHealthReport](#custodyhealthreport)
- [CustodyReshareState](#custodyresharestate)
- [CustodyStatement](#custodystatement)
- [DecodedEvent](#decodedevent)
- [EventCategory](#eventcategory)
- [ExpectedCustodyReply](#expectedcustodyreply)
- [FetchOpts](#fetchopts)
- [FollowedHead](#followedhead)
- [GetLogsWindowedOpts](#getlogswindowedopts)
- [HeadFollower](#headfollower)
- [HeadFollowerOptions](#headfolloweroptions)
- [KeeperProvisionResult](#keeperprovisionresult)
- [KeyListReply](#keylistreply)
- [KeyRotationLockedEvent](#keyrotationlockedevent)
- [KeySlotSummary](#keyslotsummary)
- [MeteringReply](#meteringreply)
- [NetworkManifest](#networkmanifest)
- [NetworkName](#networkname)
- [NetworkPreset](#networkpreset)
- [NodeInfo](#nodeinfo)
- [ProposeRuleArgs](#proposeruleargs)
- [ProposeRuleResult](#proposeruleresult)
- [ProvisionRuleArgs](#provisionruleargs)
- [ProvisionRuleResult](#provisionruleresult)
- [ReadCustodyHealthOptions](#readcustodyhealthoptions)
- [RegisteredAgentSession](#registeredagentsession)
- [RegisteredRelayConfig](#registeredrelayconfig)
- [RegisteredVerifierAgentSession](#registeredverifieragentsession)
- [RelayAttempt](#relayattempt)
- [RelayConfig](#relayconfig)
- [RelayHttpResponse](#relayhttpresponse)
- [RelayIntent](#relayintent)
- [RelayReceipt](#relayreceipt)
- [RelayReconciliation](#relayreconciliation)
- [RelaySponsorshipConfig](#relaysponsorshipconfig)
- [RelayTransport](#relaytransport)
- [RelayVoucher](#relayvoucher)
- [RelayVoucherIntent](#relayvoucherintent)
- [ReshareRosterErrorCode](#resharerostererrorcode)
- [ResolvedEndpoints](#resolvedendpoints)
- [ResolvedNetworkProfile](#resolvednetworkprofile)
- [RotationLockErrorCode](#rotationlockerrorcode)
- [RotationLockResult](#rotationlockresult)
- [RotationLockRevert](#rotationlockrevert)
- [RotationLockStatus](#rotationlockstatus)
- [RpcBatchOptions](#rpcbatchoptions)
- [RuleAmendmentErrorCode](#ruleamendmenterrorcode)
- [RuleAmendmentStatus](#ruleamendmentstatus)
- [RuleInput](#ruleinput)
- [ServiceApproval](#serviceapproval)
- [ServiceChallenge](#servicechallenge)
- [ServiceDiscoveryTransport](#servicediscoverytransport)
- [ServiceManifest](#servicemanifest)
- [ServiceRecord](#servicerecord)
- [ServiceStatus](#servicestatus)
- [ServiceType](#servicetype)
- [SessionAgentTransport](#sessionagenttransport)
- [SessionControlHttpResponse](#sessioncontrolhttpresponse)
- [SessionControlTransport](#sessioncontroltransport)
- [SessionDrawDeployment](#sessiondrawdeployment)
- [SignedHeartbeat](#signedheartbeat)
- [SlotAuthType](#slotauthtype)
- [SlotCommitteeDecryptOptions](#slotcommitteedecryptoptions)
- [SlotCommitteeSignOptions](#slotcommitteesignoptions)
- [SlotDrawReaderConfig](#slotdrawreaderconfig)
- [SlotDrawTrust](#slotdrawtrust)
- [SlotGroupKey](#slotgroupkey)
- [SlotHandoffErrorCode](#slothandofferrorcode)
- [SlotHandoffStatus](#slothandoffstatus)
- [SlotMode](#slotmode)
- [SlotSeed](#slotseed)
- [SlotSeedAnswer](#slotseedanswer)
- [SlotSeedFailure](#slotseedfailure)
- [SlotSeedOptions](#slotseedoptions)
- [SlotSharing](#slotsharing)
- [SlotSharingOptions](#slotsharingoptions)
- [SlotTransferProposal](#slottransferproposal)
- [SlotVerifierDrawOptions](#slotverifierdrawoptions)
- [TasraChainClient](#tasrachainclient)
- [TasraSlotClient](#tasraslotclient)
- [TasraSlotClientConfig](#tasraslotclientconfig)
- [TasraWriteClient](#tasrawriteclient)
- [TecdsaReshareRosterInput](#tecdsaresharerosterinput)
- [TecdsaReshareRosterPlan](#tecdsaresharerosterplan)
- [VaultTranche](#vaulttranche)
- [VerifiedCustodyReport](#verifiedcustodyreport)
- [VerifierInfo](#verifierinfo)
- [VerifierProofWire](#verifierproofwire)
- [VerifierWitness](#verifierwitness)
- [WriteClientConfig](#writeclientconfig)
- [WriteClientKeyConfig](#writeclientkeyconfig)
- [WriteClientWalletConfig](#writeclientwalletconfig)

</details>

### Address

Hex-encoded EVM contract or account address.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/deployments.ts#L23)

```ts
export type Address = `0x${string}`;
```

### AddressBook

Canonical contract name to deployed address (lowercased keys allowed too).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/deployments.ts#L26)

```ts
export type AddressBook = Partial<Record<ContractName, Address>> & {
    [k: string]: Address | undefined;
};
```

### AgentHttpResponse

A session-creation reply read with its status; the body stays bounded by the caller.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/registeredAgent.ts#L22)

```ts
export interface AgentHttpResponse {
    status: number;
    body: Uint8Array;
    retryAfterMs?: number;
}
```

Fields:

- **` status `**: HTTP status of the reply.
- **` body `**: Bounded reply bytes.
- **` retryAfterMs `**: Parsed Retry-After, in milliseconds, when the agent sent one.

### AgentSessionRecovery

Private application state for restoring the original session, never a provider approval.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/registeredAgent.ts#L72)

```ts
export interface AgentSessionRecovery extends Pick<CreateSessionResult, 'sessionId' | 'pollSecret' | 'qrPayload' | 'requestUri'> {
    version: 1;
    serviceProfile: {
        chainId: number;
        registry: string;
        serviceId: string;
        serviceType: 1;
        owner: string;
        revision: string;
        manifestHash: string;
        authKey: string;
        endpoint: string;
        clientId: string;
    };
    pendingOwner: string;
}
```

Fields:

- **` version `**: Checkpoint format.
- **` serviceProfile `**: Creation identity, compared with independent approvals and the live registry.
- **` pendingOwner `**: Pending owner at creation; a later transfer stops recovery before bearer delivery.
- **` sessionId `**: Opened authorization session identifier.
- **` pollSecret `**: Bearer token for polling - treat as a secret
- **` qrPayload `**: OpenID4VP deep link for a wallet or QR code.
- **` requestUri `**: URL from which the wallet retrieves the signed request.

### AgentTransport

Guarded HTTPS transport for service discovery and verifier-agent sessions.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/registeredAgent.ts#L11)

```ts
export interface AgentTransport extends ServiceDiscoveryTransport {
    agentRequest(url: string, options: {
        body?: Uint8Array;
        bearer?: string;
        maxBytes: number;
        signal: AbortSignal;
    }): Promise<Uint8Array>;
    agentExchange?(url: string, options: {
        body: Uint8Array;
        maxBytes: number;
        signal: AbortSignal;
    }): Promise<AgentHttpResponse>;
}
```

Fields:

- **` agentRequest `**: Same socket/TLS policy as discovery; bearer is allowed only on a session GET.
- **` agentExchange `**: Optional session-creation exchange that also returns a 503 with its status and Retry-After, so the agent's one retryable pre-creation refusal can be retried. Without it creation never retries.
- **` request `**: Perform a bounded request using the required destination, TLS and cancellation policy; return response bytes.

### AmendmentPhase

Progress points `amendSlotRule` reports, in order.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/ruleAmendment.ts#L83)

```ts
export type AmendmentPhase = 'proposed' | 'delivered' | 'adopted' | 'endorsed' | 'activated';
```

### AmendSlotRuleArgs

Arguments of [amendSlotRule](#amendslotrule): the amendment, who delivers it, and optional guardian endorsement.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/ruleAmendment.ts#L86)

```ts
export type AmendSlotRuleArgs = ProposeRuleArgs & {
    deliverer: TypedDataSigner;
    guardian?: TasraWriteClient;
    onPhase?: (p: AmendmentPhase, d?: unknown) => void;
    maxWaitMs?: number;
    signal?: AbortSignal;
};
```

Fields:

- **` slotId `**: 32-byte identifier of the slot whose rule changes.
- **` ruleSalt `**: The slot's rule salt (from creation). Amendments reuse it; it is never minted here.
- **` deliverer `**: Signs the rule delivery to the keepers: the slot creator or the rule admin.
- **` guardian `**: The guardian's write client; when given, it endorses the amendment to waive the remaining delay.
- **` onPhase `**: Called at each completed phase with that phase's result.
- **` maxWaitMs `**: Milliseconds allowed from delivery to activation (default: the slot's timelock plus 10 minutes).
- **` signal `**: Cancels waiting and keeper requests.

### AmendSlotRuleResult

Outcome of [amendSlotRule](#amendslotrule).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/ruleAmendment.ts#L100)

```ts
export interface AmendSlotRuleResult {
    version: number;
    ruleCommitment: Hex;
    proposeTx?: Hex;
    activateTx?: Hex;
}
```

Fields:

- **` version `**: Rule version now active.
- **` ruleCommitment `**: Salted commitment of the rule now active.
- **` proposeTx `**: Proposal transaction; absent when the proposal already existed (a resumed run).
- **` activateTx `**: Activation transaction; absent when the rule was already active or another party activated it.

### AnchoredVerifierDraw

One slot's verifier draw at one epoch, as anchored on chain: the beacon seed and the verifier-set
snapshot root and size of the epoch, and the slot's committee policy. Read it from the chain
(`readSlotVerifierDraw`), never from a service.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/verifierSnapshot.ts#L17)

```ts
export interface AnchoredVerifierDraw {
    chain_id: number;
    slot: Hex;
    verification_epoch: number;
    verification_seed: Hex;
    verification_root: Hex;
    verification_registry_size: number;
    verification_committee: number;
    verification_quorum: number;
}
```

Fields:

- **` chain_id `**: Deployment chain ID.
- **` slot `**: 32-byte slot ID.
- **` verification_epoch `**: Beacon epoch of the draw.
- **` verification_seed `**: `beacon.seedAt(epoch)`.
- **` verification_root `**: Anchored verifier-set snapshot root of the epoch.
- **` verification_registry_size `**: Anchored verifier-set size of the epoch.
- **` verification_committee `**: The slot's verifier committee size.
- **` verification_quorum `**: Signatures required from that committee.

### ApplicationServiceProfiles

Reviewed application configuration, never a list downloaded from a service registry.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/serviceProfiles.ts#L21)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/registeredAgent.ts#L40)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/serviceProfiles.ts#L9)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L241)

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

### BeaconDeployment

The beacon and verifier-set registry of a deployment, independently approved by the application.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/sessionDraw.ts#L27)

```ts
export interface BeaconDeployment {
    chainId: number;
    beacon: Address;
    verifierSet: Address;
}
```

Fields:

- **` chainId `**: Deployment chain ID; the RPC's chain must equal it.
- **` beacon `**: ThresholdRandomBeacon address.
- **` verifierSet `**: VerifierSetRegistry address.

### BeaconDrawState

The beacon's latest epoch and the newest epoch a session grant can be drawn on now.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/sessionDraw.ts#L98)

```ts
export interface BeaconDrawState {
    latest: bigint;
    draw?: bigint;
}
```

Fields:

- **` latest `**: The beacon's latest epoch.
- **` draw `**: `latest` once its verifier-set snapshot is anchored, else `latest - 1` when that one is, else absent: the epoch the verifier-agent draws a new grant (or a session continuation) on, as the agent picks it (`pick_draw_epoch`). A refresh before it moves past a grant's epoch can only re-sign the grant on its own epoch.

### ChainClientConfig

RPC and contract configuration for read-only network access.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/client.ts#L63)

```ts
export interface ChainClientConfig {
    rpcUrl: string;
    addresses: AddressBook;
    chainId?: number;
    logWindow?: number;
    multicall3?: Address | false;
    rpcBatch?: RpcBatchOptions | false;
}
```

Fields:

- **` rpcUrl `**: JSON-RPC HTTP endpoint of the chain.
- **` addresses `**: Resolved deployment addresses.
- **` chainId `**: Chain id; defaults to DEFAULT_CHAIN_ID (the RPC is never consulted).
- **` logWindow `**: getLogs block-window size; keep <= the RPC's range cap (anvil/besu: large; public: ~2k).
- **` multicall3 `**: Multicall3 address for batching. Omit to probe the canonical address, supply an explicit address to probe that deployment, or set false to disable batching. Unavailable batching falls back to individual reads. Block-pinned reads batch through it only where its code matches the canonical Multicall3.
- **` rpcBatch `**: JSON-RPC batching for small requests (calls, chain ID, blocks, code, nonces): requests issued together share one HTTP request of at most `batchSize` (default 32, at most 1000) after waiting `wait` milliseconds (default 0, at most 100). Each request keeps its own result and error. Log queries and transactions are never batched. Set false for an RPC without batches.

### CommitRevealOptions

Recovery and timing controls for commit-reveal creation. Creation uses only the accountant-seeded path: the seed is asked for concurrently, retried within a bounded window, and its absence is a typed error ([SlotSeedUnavailableError](#slotseedunavailableerror)); there is no beacon-epoch wait.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/write.ts#L202)

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
    accountantUrls?: string[];
    slotSeedTimeoutMs?: number;
    slotSeedRetryMs?: number;
    slotSeedHedgeMs?: number;
    onSeed?: (seed: SlotSeed) => void;
    onSeedError?: (failure: SlotSeedFailure) => void;
}
```

Fields:

- **` recovery `**: Durable creation flow. Awaited before submission and after receiving each hash. Enabling recovery disables automatic transaction resubmission. Only supply hashes from the same persisted intent; never reconstruct lost salts. Resuming a beacon-epoch commitment made by an older SDK checks its target epoch ONCE and throws [SlotRevealNotYetError](#slotrevealnotyeterror) until it is reached; it never waits.
- **` signal `**: Cancel cooperative creation waits; already submitted transactions remain on chain.
- **` accountantUrls `**: Accountant base URLs for the seed request. Resolved from `NodeRegistry` when omitted.
- **` slotSeedTimeoutMs `**: Per-accountant HTTP timeout for the seed request (default 20 s, capped by the retry window).
- **` slotSeedRetryMs `**: Total time to keep re-asking the accountant set while it answers "not yet" (404 before its view reaches the commit receipt, 503 while it leads another creation's round, 429, a timeout). Backs off with jitter and honours `Retry-After`. Default ` DEFAULT_SLOT_SEED_RETRY_MS ` (90 s).
- **` slotSeedHedgeMs `**: Stagger between the concurrent asks of one round (default ` DEFAULT_SLOT_SEED_HEDGE_MS `; 0 asks every accountant at once).
- **` onSeed `**: The seed that was obtained, before the reveal is sent.
- **` onSeedError `**: Why no seed was obtained (each accountant's last answer), just before [SlotSeedUnavailableError](#slotseedunavailableerror) is thrown.

### CommitteeDecryptOptions

Decryption options for a registry-discovered committee slot.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/committeeClient.ts#L114)

```ts
export type CommitteeDecryptOptions = SlotCommitteeDecryptOptions;
```

Fields:

- **` binding `**: Original authorization preimage binding the complete ciphertext, identity, recipient and epoch.
- **` ciphertext `**: Group ciphertext to decrypt through committee authorization.
- **` identity `**: Original associated data used when encrypting the group ciphertext.
- **` decryptingSet `**: Historical coordinator selection; ignored by client-sealed delivery.
- **` blsPeers `**: Historical coordinator peer map; ignored by client-sealed delivery.
- **` userSignature `**: Optional Ed25519 slot-owner signature required by the keeper policy.
- **` ciphertextEpoch `**: Expected slot key epoch for detecting ciphertext-key rotation.
- **` targetKeykeeper `**: Pin the keeper this request targets (anti-Sybil); an on-chain assigned operator.
- **` threshold `**: Required number of distinct authenticated and pairing-verified contributions.
- **` recipient `**: Original client-held recipient created before requesting authorization.
- **` signal `**: Cancel the complete fan-out, including approvals and response bodies.
- **` verifyingShares `**: Authenticate this package against the slot's published commitment before use. Keys are keeper identifiers, values are 144-byte G2 || G1 verifying shares.
- **` fetchImpl `**: Guarded HTTP transport; defaults to global fetch.
- **` requestId `**: Use the same id when producing the KEM owner signature.

### CommitteeSignOptions

Signing options for a registry-discovered committee slot.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/committeeClient.ts#L110)

```ts
export type CommitteeSignOptions = SlotCommitteeSignOptions;
```

Fields:

- **` signingSet `**: Optional FROST participant identifiers selected for signing.
- **` userSignature `**: Optional Ed25519 slot-owner approval signature for the signing request.
- **` targetKeykeeper `**: Pin the keeper this request targets (anti-Sybil). Must be one of the slot's on-chain assigned operators; there is no way to point at an off-chain node.

### CommitteeSlotClient

Slot-based committee operations that discover keepers and verifiers from the chain.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/committeeClient.ts#L119)

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
- **` decrypt `**: Discover assigned keepers, validate canonical epoch/quorum and collect client-sealed contributions. Recipient and request binding are required before holder authorization; no custody fallback exists.
- **` verifierDirectory `**: The resolved active verifier directory (discovered once, then cached).

### CommitteeSlotClientConfig

Chain discovery and holder-proof configuration for threshold signing and identity decryption.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/committeeClient.ts#L37)

```ts
export interface CommitteeSlotClientConfig {
    chain: TasraChainClient;
    holder?: string;
    credentials?: string[];
    dcqlRule?: string;
    holderProof?: string | HolderProofPerVerifier;
    ttlSecs?: number;
}
```

Fields:

- **` chain `**: Read client for the deployment (RPC + address book).
- **` holder `**: Holder DID (the credentials' subject). Required for ` CommitteeSlotClient.sign ` and ` CommitteeSlotClient.decrypt `, which must present credentials to the verifier committee. Not needed for ` CommitteeSlotClient.encrypt `, which only reads the slot's public group key from chain.
- **` credentials `**: Compact-JWS verifiable credentials presented to the committee. Required for sign/decrypt.
- **` dcqlRule `**: Ignored compatibility field. Verifiers fetch the committed rule from a keeper; supplying this field does not change authorization.
- **` holderProof `**: Holder proof-of-possession for the holder DID authentication key. Required for sign/decrypt. One string serves one verifier: the proof names its audience and burns a nonce that lives in that verifier, so on any deployment whose policy draws a committee the others answer 401 ("aud does not include this verifier"). Pass `holderProofPerVerifier({signer, audience, credentials, slotId})` there - it mints a fresh proof per drawn verifier, on every request.
- **` ttlSecs `**: Compound-token TTL in seconds (default 300).

### ContractName

Canonical contract names supported by the bundled ABI registry.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/abis/index.ts#L67)

```ts
export type ContractName = keyof typeof CONTRACT_ABIS;
```

### ContractObservation

Observed contract code and proxy implementation compared with a manifest record.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/manifest.ts#L172)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/manifest.ts#L10)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/write.ts#L238)

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
- **` authType `**: `KeyRegistry.AuthType` for this slot - how a holder authorises against the rule. Defaults to `'unspecified'` (ordinal 0), interpreted as OID4VP by current keepers. Choose `'oid4vp'` for wallet credentials or `'oauth'` for OAuth/OIDC. The separate administrative `'bls-bn254'` mode requires `'governance'` (ordinal 3); this type cannot authorize customer key modes or wallet grants. Update fleet readers to support ordinal 3 before creating authority slots.
- **` tags `**: Committee-draw filter tags; default `["keykeeper"]`.
- **` slotId `**: Explicit 32-byte slot identifier, generated when omitted.
- **` salt `**: 32-byte committee-selection salt, generated when omitted.
- **` rulePolicy `**: Install amendment authority in the creation transaction. Omission makes the rule immutable. A later policy transaction can lose the race with key generation.
- **` exportable `**: Allow raw share export, permitting a holder with enough shares to retain the reconstructed key permanently. Revocation cannot remove an exported key. Disabled by default and incompatible with rulePolicy.
- **` rule `**: Clear rule. OAuth and wallet policies share the DCQL grammar.

### CreateSlotFromPolicyArgs

Slot creation from an authored Rego policy instead of a rule string. The SDK packs
`oauthPolicy` into the canonical `kk_oauth` envelope with the network's own engine, refuses
it when a keeper would not store it, and commits the envelope. Requires `authType: 'oauth'`.
The packed envelope is returned as `rule`: provision exactly that string.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/write.ts#L290)

```ts
export type CreateSlotFromPolicyArgs = Omit<CreateSlotArgs, 'rule'> & {
    rule?: undefined;
    oauthPolicy: OauthPolicyInput;
};
```

Fields:

- **` tags `**: Committee-draw filter tags; default `["keykeeper"]`.
- **` n `**: Total keeper shares assigned to the slot.
- **` slotId `**: Explicit 32-byte slot identifier, generated when omitted.
- **` k `**: Minimum participating keeper shares required for an operation.
- **` mode `**: Key algorithm and threshold operation family.
- **` salt `**: 32-byte committee-selection salt, generated when omitted.
- **` rulePolicy `**: Install amendment authority in the creation transaction. Omission makes the rule immutable. A later policy transaction can lose the race with key generation.
- **` ruleSalt `**: Private 32-byte authorization-rule salt, generated when omitted. Distinct from the committee-selection salt.
- **` authType `**: `KeyRegistry.AuthType` for this slot - how a holder authorises against the rule. Defaults to `'unspecified'` (ordinal 0), interpreted as OID4VP by current keepers. Choose `'oid4vp'` for wallet credentials or `'oauth'` for OAuth/OIDC. The separate administrative `'bls-bn254'` mode requires `'governance'` (ordinal 3); this type cannot authorize customer key modes or wallet grants. Update fleet readers to support ordinal 3 before creating authority slots.
- **` exportable `**: Allow raw share export, permitting a holder with enough shares to retain the reconstructed key permanently. Revocation cannot remove an exported key. Disabled by default and incompatible with rulePolicy.
- **` rule `**: Must be omitted: the rule is the packed envelope.
- **` oauthPolicy `**: Rego policy source, token specifications and optional entrypoint.

### CustodyFailure

The last threshold-ECDSA reshare the keeper failed for the slot, as it signed it.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/custodyHealth.ts#L46)

```ts
export interface CustodyFailure {
    committeeVersion: number;
    blamedOperatorId: number | null;
    reason: string;
}
```

Fields:

- **` committeeVersion `**: Committee version the failed reshare targeted.
- **` blamedOperatorId `**: On-chain operator id of the party the refusal named, or `null` when it named none.
- **` reason `**: The keeper's reason text; diagnostic, never parse it.

### CustodyHealthErrorCode

Stable refusal categories of a custody-health reply; branch on `code`, never on the message.
`unreachable` and `stale` may pass on a later poll; the others need a different keeper or reply.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/custodyHealth.ts#L87)

```ts
export type CustodyHealthErrorCode = 'unsigned' | 'malformed' | 'bad-signature' | 'stale' | 'mismatch' | 'not-registered' | 'unreachable' | 'no-slot';
```

### CustodyHealthLevel

How a committee fares against its threshold: the keepers' own classification.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/custodyHealth.ts#L320)

```ts
export type CustodyHealthLevel = 'ok' | 'at_risk' | 'frozen';
```

### CustodyHealthReport

A slot's custody health: chain state read by the SDK, and the keepers' verified statements.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/custodyHealth.ts#L354)

```ts
export interface CustodyHealthReport {
    slotId: Hex;
    chainId: number;
    chain: {
        mode: number;
        publicKey: Hex;
        epoch: number;
        committeeVersion: number;
        k: number;
        n: number;
        cancelled: boolean;
        rotationLocked: boolean | null;
    };
    committee: {
        members: number;
        liveMembers: number;
        margin: number;
        notLive: Address[];
    };
    health: CustodyHealthLevel;
    current: Address[];
    proven: boolean;
    pending: Address[];
    reports: VerifiedCustodyReport[];
    refused: {
        operator: Address;
        error: CustodyHealthError;
    }[];
}
```

Fields:

- **` slotId `**: Slot that was polled.
- **` chainId `**: Chain the statements were checked against.
- **` chain `**: The slot as the chain records it.
- **` committee `**: The committee's liveness, from NodeRegistry: a live member is an active, keeper-tagged operator.
- **` health `**: Classification from `liveMembers`, `k` and `n`.
- **` current `**: Members whose verified statement proves a share of the chain's current generation.
- **` proven `**: Whether at least `k` members proved it, so the current generation can sign without any older one.
- **` pending `**: Members whose verified statement reports a reshare they have not finished.
- **` reports `**: Every verified statement, one per member that answered.
- **` refused `**: Members whose reply was refused or not received; none of these is counted.

### CustodyReshareState

The reshare states a keeper reports for its own share.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/custodyHealth.ts#L42)

```ts
export type CustodyReshareState = 'current' | 'pending' | 'not_member' | 'no_key' | 'unknown';
```

### CustodyStatement

What one keeper signed about one slot. Hex fields are lowercase.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/custodyHealth.ts#L56)

```ts
export interface CustodyStatement {
    chainId: number;
    slot: Hex;
    operator: Address;
    epoch: number;
    committeeVersion: number;
    publicKey: Hex;
    reshare: CustodyReshareState;
    shareCommitteeVersion: number | null;
    shareMatchesChainKey: boolean | null;
    retainedGenerations: number | null;
    lastFailure: CustodyFailure | null;
    observedAt: number;
}
```

Fields:

- **` chainId `**: Chain the keeper read.
- **` slot `**: Slot the statement is about.
- **` operator `**: Operator address of the signing keeper.
- **` epoch `**: The chain's key epoch as the keeper read it.
- **` committeeVersion `**: The chain's committee version as the keeper read it.
- **` publicKey `**: The chain's anchored public key as the keeper read it; `0x` before a key exists.
- **` reshare `**: Whether the keeper's share is at the chain's generation; `pending` means a reshare it has not finished.
- **` shareCommitteeVersion `**: Committee version of the share the keeper holds, or `null` when it holds none or cannot tell.
- **` shareMatchesChainKey `**: Whether the keeper's share belongs to the chain's key, or `null` when it cannot tell.
- **` retainedGenerations `**: Older share generations the keeper still holds, or `null` when it cannot tell.
- **` lastFailure `**: The keeper's last failed reshare of this slot, or `null`.
- **` observedAt `**: Unix seconds at which the keeper made the statement.

### DecodedEvent

A normalized, storage-ready decoded log.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/events.ts#L90)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/events.ts#L13)

```ts
export type EventCategory = 'node' | 'slot' | 'slashing' | 'tasra' | 'settlement' | 'beacon' | 'governance';
```

### ExpectedCustodyReply

What a reply must be about, and the key it must be signed with.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/custodyHealth.ts#L214)

```ts
export interface ExpectedCustodyReply {
    chainId: number;
    slotId: Hex;
    operator: Address;
    registeredPublicKey: Uint8Array | Hex;
    nowSecs?: number;
    maxAgeSecs?: number;
}
```

Fields:

- **` chainId `**: Chain the statement must name.
- **` slotId `**: Slot that was polled.
- **` operator `**: Operator whose keeper was polled.
- **` registeredPublicKey `**: The operator's identity key as NodeRegistry holds it (32 bytes, or its hex).
- **` nowSecs `**: Current Unix seconds; defaults to the local clock.
- **` maxAgeSecs `**: Maximum statement age in either direction, in seconds; defaults to ` CUSTODY_STATEMENT_MAX_AGE_SECS `.

### FetchOpts

Timeout and optional bearer authorization for direct service reads.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/offchain.ts#L12)

```ts
export interface FetchOpts {
    timeoutMs?: number;
    jwt?: string;
}
```

Fields:

- **` timeoutMs `**: Per-request timeout in ms (default 4000).
- **` jwt `**: Bearer JWT, for the few authenticated reads (metering/audit).

### FollowedHead

A followed header.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/headFollower.ts#L30)

```ts
export interface FollowedHead extends PinnedBlock {
    parentHash: Hex;
}
```

Fields:

- **` parentHash `**: Hash of the parent block.
- **` blockNumber `**: Block number.
- **` blockHash `**: Block hash.
- **` blockTimestamp `**: Block timestamp, Unix seconds.

### GetLogsWindowedOpts

Inclusive block range, contract filter and progress callback for event scanning.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/client.ts#L157)

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

### HeadFollower

A started (or startable) head follower for one client.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/headFollower.ts#L52)

```ts
export interface HeadFollower {
    readonly finality: 'instant' | 'probabilistic';
    tip(): FollowedHead | undefined;
    isCanonical(at: PinnedBlock): boolean | undefined;
    live(): boolean;
    ingest(header: unknown): Promise<void>;
    ingestFinalized(header: unknown): Promise<void>;
    onHead(listener: (tip: FollowedHead) => void): () => void;
    noteMinedBlock(blockNumber: bigint): void;
    gaps(): number;
    start(): void;
    stop(): void;
}
```

Fields:

- **` finality `**: The finality the deployment was declared with.
- **` tip `**: The newest header while live, otherwise undefined.
- **` isCanonical `**: True only when `at` is provably canonical (see module comment); false or undefined means: recheck by RPC.
- **` live `**: Whether a head or poll confirmed the tip within `liveAfterMs` (and, when opted in, its block is at most `maxTipAgeMs` old).
- **` ingest `**: Feed one header (the poller, a newHeads subscription or tests). Serialized; never throws.
- **` ingestFinalized `**: Feed the RPC's current `finalized` header (read beside `latest`). Serialized; never throws.
- **` onHead `**: Run `listener` after every new tip; returns the unsubscribe function.
- **` noteMinedBlock `**: A block this process saw one of its own transactions mined in. Until the followed tip reaches it, `tip()` answers undefined (callers read the RPC head): an older tip cannot show that transaction's effects, so a read at it would contradict what the caller just observed.
- **` gaps `**: Number of gaps (unlinkable headers) seen; diagnostics only.
- **` start `**: Start polling (HTTP) or subscribing (WebSocket). Idempotent.
- **` stop `**: Stop and forget every header.

### HeadFollowerOptions

Head follower options.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/headFollower.ts#L36)

```ts
export interface HeadFollowerOptions {
    finality?: 'instant' | 'probabilistic';
    window?: number;
    liveAfterMs?: number;
    maxTipAgeMs?: number;
    pollMs?: number;
    now?: () => number;
}
```

Fields:

- **` finality `**: `instant` (an accepted block never reorganizes: Avalanche C-Chain) lets `isCanonical` answer; default `probabilistic` (it never does).
- **` window `**: Headers held, 2..1024 (default 64); also the deepest reorg or gap it links back.
- **` liveAfterMs `**: A follower whose tip no head or poll confirmed for this long is not live (default and maximum 2000 ms).
- **` maxTipAgeMs `**: Opt-in: also refuse a tip whose block timestamp is older than this (1..2000 ms; default off).
- **` pollMs `**: Poll interval on HTTP transports, below `liveAfterMs` (default min(1000, liveAfterMs / 2) ms). WebSocket transports subscribe instead.
- **` now `**: Clock in ms (tests).

### KeeperProvisionResult

One keeper's answer. `pending` marks a rule stored against a PENDING amendment.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/provisionRule.ts#L90)

```ts
export interface KeeperProvisionResult {
    url: string;
    ok: boolean;
    provisioned?: boolean;
    pending?: boolean;
    pendingVersion?: number;
    status?: number;
    error?: string;
    authorizedBy?: 'creator' | 'delegate' | 'rule_admin';
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
- **` authorizedBy `**: Which authority the keeper accepted the signature as, when it says.

### KeyListReply

Slot summaries returned by a keeper key-list endpoint.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/offchain.ts#L102)

```ts
export interface KeyListReply {
    slots: KeySlotSummary[];
    [k: string]: unknown;
}
```

Fields:

- **` slots `**: Slot summaries included in the keeper response.

### KeyRotationLockedEvent

One `KeyRotationLocked` event.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/rotationLock.ts#L208)

```ts
export interface KeyRotationLockedEvent {
    slotId: Hex;
    address: Address;
    blockNumber: bigint | null;
    transactionHash: Hex | null;
}
```

Fields:

- **` slotId `**: Slot whose rotation was locked.
- **` address `**: Contract that emitted the event; compare it with the deployment's KeyRegistry.
- **` blockNumber `**: Block of the event, when the log carries it.
- **` transactionHash `**: Transaction of the event, when the log carries it.

### KeySlotSummary

Keeper-reported slot threshold, key epoch and optional rule or activity metadata.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/offchain.ts#L77)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/offchain.ts#L126)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/manifest.ts#L43)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/networks.ts#L7)

```ts
export type NetworkName = 'local' | 'testnet' | 'mainnet';
```

### NetworkPreset

Default network currency, RPC, governance and token configuration.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/networks.ts#L11)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/offchain.ts#L52)

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
    admin_auth?: 'separate' | 'unconfigured';
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
- **` admin_auth `**: Separate admin-key verification, or administrative routes awaiting operator configuration. Missing on older keepers.

### ProposeRuleArgs

A rule amendment: the new rule (a clear rule string, or an authored Rego policy the SDK packs
into a `kk_oauth` envelope) for an existing slot, committed with the slot's saved rule salt.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/write.ts#L394)

```ts
export type ProposeRuleArgs = ({
    rule: string;
} | {
    oauthPolicy: OauthPolicyInput;
}) & {
    slotId: Hex;
    ruleSalt: Hex;
};
```

Fields:

- **` slotId `**: 32-byte identifier of the slot whose rule changes.
- **` ruleSalt `**: The slot's rule salt (from creation). Amendments reuse it; it is never minted here.

### ProposeRuleResult

A confirmed `proposeRuleUpdate`, decoded from its `RuleUpdateProposed` event.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/write.ts#L450)

```ts
export interface ProposeRuleResult {
    slotId: Hex;
    txHash: Hex;
    version: number;
    notBefore: number;
    ruleCommitment: Hex;
    ruleSalt: Hex;
    rule: string;
    relay?: RelayReceipt;
}
```

Fields:

- **` slotId `**: Slot whose rule amendment was proposed.
- **` txHash `**: Transaction that carried the proposal.
- **` version `**: Amendment version the contract assigned.
- **` notBefore `**: Chain time (Unix seconds) from which the amendment may activate.
- **` ruleCommitment `**: Salted commitment of the proposed rule.
- **` ruleSalt `**: Rule salt the commitment was computed with.
- **` rule `**: Exact rule string committed; deliver exactly this to the keepers.
- **` relay `**: Relay receipt, when the proposal was gas-sponsored.

### ProvisionRuleArgs

Creator-signed rule delivery request with the private salt used at slot creation.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/provisionRule.ts#L41)

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
    expect?: 'active' | 'pending';
    retryConflictMs?: number;
    delegation?: PresentationDelegation;
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
- **` expect `**: Which rule the keepers must store. `'active'` (default) is the slot's current rule, delivered once per keeper exactly as before. `'pending'` is a proposed amendment: a keeper that has not yet ingested the proposal is retried, and a keeper that stores it as the ACTIVE rule is an error.
- **` retryConflictMs `**: Milliseconds to keep retrying a keeper that has not yet ingested the proposal, every 3 s (default 120000). Used only with `expect: 'pending'`, and must not exceed `ttlSecs`, because one signature serves every retry.
- **` delegation `**: A creator delegation authorizing `signer` to deliver for the creator. A rule admin delivering a pending amendment signs without one; keepers do not accept an admin delegation.
- **` rule `**: Clear rule. OAuth and wallet policies share the DCQL grammar.

### ProvisionRuleResult

Committed rule hash and per-keeper delivery outcomes.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/provisionRule.ts#L124)

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

### ReadCustodyHealthOptions

Transport and policy for [readCustodyHealth](#readcustodyhealth).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/custodyHealth.ts#L336)

```ts
export interface ReadCustodyHealthOptions {
    chainId?: number;
    fetchImpl?: typeof fetch;
    route?: (url: string) => string;
    allowLocalHttp?: boolean;
    signal?: AbortSignal;
    nowSecs?: number;
    maxAgeSecs?: number;
}
```

Fields:

- **` chainId `**: Expected chain; defaults to the chain the client's RPC answers.
- **` fetchImpl `**: Fetch used for the keeper requests; defaults to the global fetch.
- **` route `**: Map a registered keeper URL to the address to request, for an application with mapped keeper routes.
- **` allowLocalHttp `**: Allow loopback HTTP on the disposable local chain 43112 only. Default false.
- **` signal `**: Cancel the poll. The complete poll is bounded to 15 seconds.
- **` nowSecs `**: Current Unix seconds for the freshness check; defaults to the local clock.
- **` maxAgeSecs `**: Maximum statement age in seconds; defaults to ` CUSTODY_STATEMENT_MAX_AGE_SECS `.

### RegisteredAgentSession

Session pinned to its authenticated provider, with a closure for polling that provider.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/registeredAgent.ts#L58)

```ts
export interface RegisteredAgentSession extends Readonly<CreateSessionResult> {
    readonly sessionGrantRequest?: SessionGrantRequestWire;
    readonly profile: Readonly<ApprovedAgentProfile>;
    readonly recovery: AgentSessionRecovery;
    poll(signal?: AbortSignal): Promise<SessionStatusResult>;
}
```

Fields:

- **` sessionGrantRequest `**: Session mode: the canonical session-grant request this session was opened with (its key thumbprint is in the wallet nonce).
- **` profile `**: Provider identity and endpoint pinned when the session was opened.
- **` recovery `**: Private JSON checkpoint of this session. Save it before wallet delivery to restore the session after a restart.
- **` poll `**: Poll only the original endpoint/profile. A provider change requires a fresh wallet session.
- **` sessionId `**: Opened authorization session identifier.
- **` pollSecret `**: Bearer token for polling - treat as a secret
- **` qrPayload `**: OpenID4VP deep link for a wallet or QR code.
- **` requestUri `**: URL from which the wallet retrieves the signed request.
- **` sessionGrantParams `**: Session mode: the granted (clamped) session parameters the agent answered at creation.

### RegisteredRelayConfig

Approved relay providers, pinned forwarder and durable recovery callbacks.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/registeredRelay.ts#L50)

```ts
export interface RegisteredRelayConfig {
    sponsorship?: RelaySponsorshipConfig;
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
    busyRetries?: number;
}
```

Fields:

- **` sponsorship `**: Holder-bound voucher flow for user-class calls; requires durable persistAttempt.
- **` approvals `**: Application approvals, in preference order. Registry membership alone never selects a service.
- **` transport `**: Guarded HTTP transport for service authentication and relay submission.
- **` forwarder `**: Independently pinned deployment forwarder; never supplied by a relayer manifest.
- **` label `**: Default operation label used when persisting or resuming relay attempts.
- **` persistAttempt `**: Persist the signed reconciliation handle before its first POST.
- **` resumeAttempt `**: Load this durable operation's previous attempt before signing, including after a restart. Unknown execution blocks replacement, including a consumed nonce outside the log window.
- **` pollMs `**: Relay status polling interval in milliseconds; defaults to 1500.
- **` timeoutMs `**: Deadline in milliseconds after a submission leaves the serialization queue; defaults to 120000 and cannot exceed it.
- **` maxAttempts `**: At most three authenticated providers receive the identical signed request.
- **` attemptMs `**: Status polling budget per provider in milliseconds; defaults to 10000 and cannot exceed 30000.
- **` busyRetries `**: Re-sends of the identical signed request to one provider after a busy refusal, 0..5 (default 3). Waits honor `Retry-After`, at most 10 s in total per provider.

### RegisteredVerifierAgentSession

Authenticated provider session bound to one signed operation and request hash.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/registeredOperation.ts#L16)

```ts
export interface RegisteredVerifierAgentSession extends RegisteredAgentSession {
    readonly operation: PresentationOperation;
    readonly requestHash: Uint8Array;
    readonly verifierAgentUrl: string;
}
```

Fields:

- **` operation `**: Signed operation associated with this session.
- **` requestHash `**: Defensive copy of the operation request hash.
- **` verifierAgentUrl `**: Authenticated provider endpoint retained for this session.
- **` sessionGrantRequest `**: Session mode: the canonical session-grant request this session was opened with (its key thumbprint is in the wallet nonce).
- **` profile `**: Provider identity and endpoint pinned when the session was opened.
- **` recovery `**: Private JSON checkpoint of this session. Save it before wallet delivery to restore the session after a restart.
- **` poll `**: Poll only the original endpoint/profile. A provider change requires a fresh wallet session.
- **` sessionId `**: Opened authorization session identifier.
- **` pollSecret `**: Bearer token for polling - treat as a secret
- **` qrPayload `**: OpenID4VP deep link for a wallet or QR code.
- **` requestUri `**: URL from which the wallet retrieves the signed request.
- **` sessionGrantParams `**: Session mode: the granted (clamped) session parameters the agent answered at creation.

### RelayAttempt

JSON-safe reconciliation handle. Persist before POST to resume safely after a client restart.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/registeredRelay.ts#L150)

```ts
export interface RelayAttempt {
    voucher?: RelayVoucher;
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

- **` voucher `**: Wallet voucher persisted before relay submission, bound to this exact signed request.
- **` chainId `**: Chain bound into the signed forward request.
- **` forwarder `**: Pinned forwarder contract expected to execute the request.
- **` fromBlock `**: Decimal block number from which reconciliation scans execution logs.
- **` id `**: EIP-712 hash identifying the exact signed forward request.
- **` request `**: Signed sender, target, calldata, gas, nonce and deadline used for submission and reconciliation.

### RelayConfig

Approved relay configuration for gas-sponsored sender-bound contract calls. The creator signs the forward request; the relayer pays gas. ERC-20 approvals still require direct transactions.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/write.ts#L161)

```ts
export type RelayConfig = RegisteredRelayConfig;
```

Fields:

- **` sponsorship `**: Holder-bound voucher flow for user-class calls; requires durable persistAttempt.
- **` approvals `**: Application approvals, in preference order. Registry membership alone never selects a service.
- **` transport `**: Guarded HTTP transport for service authentication and relay submission.
- **` forwarder `**: Independently pinned deployment forwarder; never supplied by a relayer manifest.
- **` label `**: Default operation label used when persisting or resuming relay attempts.
- **` persistAttempt `**: Persist the signed reconciliation handle before its first POST.
- **` resumeAttempt `**: Load this durable operation's previous attempt before signing, including after a restart. Unknown execution blocks replacement, including a consumed nonce outside the log window.
- **` pollMs `**: Relay status polling interval in milliseconds; defaults to 1500.
- **` timeoutMs `**: Deadline in milliseconds after a submission leaves the serialization queue; defaults to 120000 and cannot exceed it.
- **` maxAttempts `**: At most three authenticated providers receive the identical signed request.
- **` attemptMs `**: Status polling budget per provider in milliseconds; defaults to 10000 and cannot exceed 30000.
- **` busyRetries `**: Re-sends of the identical signed request to one provider after a busy refusal, 0..5 (default 3). Waits honor `Retry-After`, at most 10 s in total per provider.

### RelayHttpResponse

Bounded relayer reply with the wait it requested, if any.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/registeredRelay.ts#L20)

```ts
export interface RelayHttpResponse {
    status: number;
    body: Uint8Array;
    retryAfterMs?: number;
}
```

Fields:

- **` status `**: HTTP status: 200/202 accepted or status, 422 a pre-acceptance refusal.
- **` body `**: Bounded JSON body.
- **` retryAfterMs `**: Parsed `Retry-After` in ms, when sent.

### RelayIntent

Chain, forwarder, signer and exact calldata identifying a relay operation.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/registeredRelay.ts#L32)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/registeredRelay.ts#L117)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/registeredRelay.ts#L224)

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

### RelaySponsorshipConfig

Wallet consent callback and an independently approved sponsorship slot.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/relayVoucher.ts#L36)

```ts
export interface RelaySponsorshipConfig {
    slotId: Hex;
    authorize(context: {
        attempt: RelayAttempt;
        intent: RelayVoucherIntent;
        signal: AbortSignal;
    }): Promise<RelayVoucher>;
}
```

Fields:

- **` slotId `**: Expected slot, reviewed independently of the relayer's reply.
- **` authorize `**: Complete an OID4VP session through an approved verifier-agent using this sponsor intent. Authenticate the agent, its Request Object and creator authorization before presenting credentials. Persist wallet-session recovery under attempt.id; honor signal cancellation. Return the resulting wire voucher, without a new forward signature or payment reservation. The relayer independently verifies committee signatures, membership and revocation status.

### RelayTransport

Guarded discovery and transaction relay transport with bounded response bodies.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/registeredRelay.ts#L12)

```ts
export interface RelayTransport extends ServiceDiscoveryTransport {
    relayRequest(url: string, options: {
        body?: Uint8Array;
        maxBytes: number;
        signal: AbortSignal;
    }): Promise<Uint8Array>;
    relayExchange?(url: string, options: {
        body?: Uint8Array;
        maxBytes: number;
        signal: AbortSignal;
    }): Promise<RelayHttpResponse>;
}
```

Fields:

- **` relayRequest `**: Guard the socket just like discovery. Accept bounded JSON status bodies for 200/202/422.
- **` relayExchange `**: Optional: the same guarded request, also reporting status and `Retry-After` for busy refusals.
- **` request `**: Perform a bounded request using the required destination, TLS and cancellation policy; return response bytes.

### RelayVoucher

Holder-bound authorization for exactly one forwarded request, in relayer wire format.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/relayVoucher.ts#L24)

```ts
export interface RelayVoucher {
    compound_token: CompoundTokenWire;
    verifier_proofs: {
        verifier_index: number;
        operator: string;
        pubkey: string;
        proof: string[];
    }[];
    status_attestations?: StatusAttestationWire[];
    evidence_ct?: string;
}
```

Fields:

- **` compound_token `**: Unpaid committee token; relay sponsorship does not reserve slot credit.
- **` verifier_proofs `**: Snapshot membership proofs accompanying the token signatures.
- **` status_attestations `**: Freshness attestations, when supplied outside the token.
- **` evidence_ct `**: Sealed evidence carried unchanged when supplied by the agent.

### RelayVoucherIntent

Sponsor-signed operation returned by an authenticated relayer, before wallet consent.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/relayVoucher.ts#L10)

```ts
export interface RelayVoucherIntent {
    operation: PresentationOperation;
    operation_sig: string;
    delegation: PresentationDelegation;
    message_hex: string;
    sponsorship_slot: string;
}
```

Fields:

- **` operation `**: Relay action binding the prepared request digest to the sponsorship slot.
- **` operation_sig `**: Sponsor delegate's EIP-712 operation signature.
- **` delegation `**: Slot creator's authorization of that sponsor delegate.
- **` message_hex `**: Original forward request's EIP-712 digest, presented as the session message.
- **` sponsorship_slot `**: Independently approved sponsorship slot.

### ReshareRosterErrorCode

Stable refusal categories of the reshare roster check; branch on `code`, never on the message.
None is retryable: each needs a different roster or threshold.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/reshareRoster.ts#L22)

```ts
export type ReshareRosterErrorCode = 'keeps-too-few' | 'invalid-roster' | 'no-slot';
```

### ResolvedEndpoints

How the session's endpoints were resolved from chain - surfaced so callers can see
which verifier was chosen and which keeper committee the slot is bound to.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/slotClient.ts#L26)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/networks.ts#L28)

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

### RotationLockErrorCode

Stable refusal categories of the rotation lock API; branch on `code`, never on the message.
None is retryable: each needs a different slot, key or registry first.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/rotationLock.ts#L49)

```ts
export type RotationLockErrorCode = 'no-slot' | 'cancelled' | 'unsupported' | 'not-creator' | 'locked' | 'not-confirmed';
```

### RotationLockResult

Outcome of ` TasraWriteClient.lockKeyRotation `: the lock was sent and confirmed, or the
slot was already locked and nothing was sent.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/write.ts#L405)

```ts
export type RotationLockResult = {
    phase: 'locked';
    slotId: Hex;
    txHash: Hex;
    relay?: RelayReceipt;
} | {
    phase: 'already-locked';
    slotId: Hex;
    lockedByCreator: boolean;
    lockedByMode: boolean;
    txHash?: undefined;
};
```

Fields:

- **` phase `**: The lock transaction mined and the chain now shows the creator's lock. Nothing was sent: no rotation could change this slot's key already.
- **` slotId `**: Slot that was locked. Slot that was found locked.
- **` txHash `**: Transaction that carried the lock. No transaction.

### RotationLockRevert

A decoded rotation-lock revert: the rotation lock, or a tECDSA reshare roster that keeps too few members.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/rotationLock.ts#L173)

```ts
export type RotationLockRevert = {
    name: 'RotationLocked';
} | {
    name: 'TecdsaReshareKeepsTooFew';
    staying: number;
    k: number;
};
```

Fields:

- **` name `**: `RotationLocked()`: no rotation can change this slot's key. `TecdsaReshareKeepsTooFew(staying, k)`: the threshold-ECDSA reshare roster keeps too few current members.

### RotationLockStatus

A slot's rotation lock as the chain records it.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/rotationLock.ts#L66)

```ts
export interface RotationLockStatus {
    slotId: Hex;
    creator: Address;
    mode: number;
    cancelled: boolean;
    lastRotatedAt: bigint;
    lockedByCreator: boolean;
    lockedByMode: boolean;
    locked: boolean;
}
```

Fields:

- **` slotId `**: Slot that was read.
- **` creator `**: Slot creator, the only account that may call `lockKeyRotation`.
- **` mode `**: `KeyRegistry.Mode` ordinal: 0 FROST, 1 BLS, 2 secp256k1 tECDSA, 3 BLS-BN254, 4 P-256 tECDSA.
- **` cancelled `**: Whether the slot is cancelled; a cancelled slot cannot be locked.
- **` lastRotatedAt `**: Raw `lastRotatedAt`: 0 never rotated, a block timestamp, or the lock sentinel.
- **` lockedByCreator `**: The creator called `lockKeyRotation` (the sentinel is set).
- **` lockedByMode `**: The slot's mode is threshold ECDSA, which no rotation ever changes.
- **` locked `**: Effective lock: no rotation path can change this slot's key.

### RpcBatchOptions

Bounds of one JSON-RPC batch.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/client.ts#L86)

```ts
export interface RpcBatchOptions {
    batchSize?: number;
    wait?: number;
}
```

Fields:

- **` batchSize `**: Most requests in one HTTP request.
- **` wait `**: Milliseconds to collect requests before sending.

### RuleAmendmentErrorCode

Stable refusal categories of the rule-amendment API; branch on `code`, never on the message.
`timelock`, `below-threshold` and `timeout` may succeed later; every other code needs a change first.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/ruleAmendmentCore.ts#L21)

```ts
export type RuleAmendmentErrorCode =
    | 'no-slot'
    | 'immutable'
    | 'not-admin'
    | 'pending'
    | 'same-rule'
    | 'wrong-auth-type'
    | 'not-admissible'
    | 'no-pending'
    | 'timelock'
    | 'below-threshold'
    | 'not-guardian'
    | 'not-deliverer'
    | 'not-pending'
    | 'pending-changed'
    | 'timeout'
    | 'not-activated'
;
```

### RuleAmendmentStatus

A slot's rule and amendment state as the chain records it.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/ruleAmendment.ts#L42)

```ts
export interface RuleAmendmentStatus {
    ruleCommitment: Hex;
    ruleVersion: number;
    authType: SlotAuthType;
    policy: {
        admin: Address;
        guardian?: Address;
        timelockSecs: number;
    } | null;
    pending: {
        version: number;
        ruleCommitment: Hex;
        notBefore: number;
        adoptions: number;
        needed: number;
    } | null;
}
```

Fields:

- **` ruleCommitment `**: Salted commitment of the ACTIVE rule.
- **` ruleVersion `**: Version of the active rule.
- **` authType `**: Authorization family recorded at creation.
- **` policy `**: Who may amend the rule and how slowly; `null` means the rule is immutable.
- **` pending `**: The pending amendment with its keeper adoption votes, or `null` when none is pending.

### RuleInput

Clear authorization policy, not its salted on-chain commitment.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/ruleInput.ts#L2)

```ts
export interface RuleInput {
    rule: string;
}
```

Fields:

- **` rule `**: Clear rule. OAuth and wallet policies share the DCQL grammar.

### ServiceApproval

Pin the approved revision so an endpoint, key or provider change requires a new decision.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/services.ts#L82)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L58)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L234)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L38)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/services.ts#L46)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/services.ts#L43)

```ts
export type ServiceStatus = (typeof SERVICE_STATUSES)[keyof typeof SERVICE_STATUSES];
```

### ServiceType

Registry ordinal identifying a gas relay, verifier agent or vault service.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/services.ts#L39)

```ts
export type ServiceType = (typeof SERVICE_TYPES)[keyof typeof SERVICE_TYPES];
```

### SessionAgentTransport

One guarded transport for everything a client sends to an approved verifier-agent: discovery,
session creation and polling ([AgentTransport](#agenttransport)) and session-grant refresh and revoke
([SessionControlTransport](#sessioncontroltransport)). `createNodeAgentTransport` and `createBrowserAgentTransport`
return it.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/sessionControlTransport.ts#L35)

```ts
export type SessionAgentTransport = AgentTransport & SessionControlTransport;
```

Fields:

- **` agentRequest `**: Same socket/TLS policy as discovery; bearer is allowed only on a session GET.
- **` agentExchange `**: Optional session-creation exchange that also returns a 503 with its status and Retry-After, so the agent's one retryable pre-creation refusal can be retried. Without it creation never retries.
- **` request `**: Perform a bounded request using the required destination, TLS and cancellation policy; return response bytes.
- **` sessionControlRequest `**: Require verified TLS, connection-time destination checks, no redirects and cancellation.

### SessionControlHttpResponse

Bounded response from the approved agent's session control routes; non-success is never a retry instruction.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/sessionControlTransport.ts#L4)

```ts
export interface SessionControlHttpResponse {
    status: number;
    body: Uint8Array;
    retryAfterMs?: number;
}
```

Fields:

- **` status `**: Observed HTTP status (204 for an acknowledged revoke, a typed refusal otherwise).
- **` body `**: Exact bounded bytes.
- **` retryAfterMs `**: Parsed `Retry-After` in ms, when the service sent one. A wait hint, never a resend instruction.

### SessionControlTransport

Transport for a session grant's refresh and revoke (`POST /v1/sessions/refresh|revoke`). The
routes carry no bearer: the session-key signature in the body is their authorization.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/sessionControlTransport.ts#L17)

```ts
export interface SessionControlTransport {
    sessionControlRequest(url: string, options: {
        body: Uint8Array;
        maxBytes: number;
        signal: AbortSignal;
    }): Promise<SessionControlHttpResponse>;
}
```

Fields:

- **` sessionControlRequest `**: Require verified TLS, connection-time destination checks, no redirects and cancellation.

### SessionDrawDeployment

[BeaconDeployment](#beacondeployment) plus the KeyRegistry that holds each slot's verifier policy.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/sessionDraw.ts#L37)

```ts
export interface SessionDrawDeployment extends BeaconDeployment {
    keyRegistry: Address;
}
```

Fields:

- **` keyRegistry `**: KeyRegistry address.
- **` chainId `**: Deployment chain ID; the RPC's chain must equal it.
- **` beacon `**: ThresholdRandomBeacon address.
- **` verifierSet `**: VerifierSetRegistry address.

### SignedHeartbeat

Operator heartbeat carrying an epoch, public key and signature; reading it does not verify it.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/offchain.ts#L111)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/write.ts#L129)

```ts
export type SlotAuthType = 'unspecified' | 'oid4vp' | 'oauth' | 'governance';
```

### SlotCommitteeDecryptOptions

Everything a committee-authorized threshold decrypt needs beyond the slot id.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/committeeClient.ts#L80)

```ts
export interface SlotCommitteeDecryptOptions extends Pick<SealedRequestOpts, 'recipient' | 'verifyingShares' | 'threshold' | 'signal' | 'fetchImpl' | 'requestId'> {
    binding: RequestBindingPreimage;
    ciphertext: Ciphertext;
    identity: Uint8Array;
    decryptingSet?: number[];
    blsPeers?: BlsPeer[];
    userSignature?: Uint8Array;
    ciphertextEpoch: number;
    targetKeykeeper?: string;
}
```

Fields:

- **` binding `**: Original authorization preimage binding the complete ciphertext, identity, recipient and epoch.
- **` ciphertext `**: Group ciphertext to decrypt through committee authorization.
- **` identity `**: Original associated data used when encrypting the group ciphertext.
- **` decryptingSet `**: Historical coordinator selection; ignored by client-sealed delivery.
- **` blsPeers `**: Historical coordinator peer map; ignored by client-sealed delivery.
- **` userSignature `**: Optional Ed25519 slot-owner signature required by the keeper policy.
- **` ciphertextEpoch `**: Expected slot key epoch for detecting ciphertext-key rotation.
- **` targetKeykeeper `**: Pin the keeper this request targets (anti-Sybil); an on-chain assigned operator.
- **` threshold `**: Required number of distinct authenticated and pairing-verified contributions.
- **` recipient `**: Original client-held recipient created before requesting authorization.
- **` signal `**: Cancel the complete fan-out, including approvals and response bodies.
- **` verifyingShares `**: Authenticate this package against the slot's published commitment before use. Keys are keeper identifiers, values are 144-byte G2 || G1 verifying shares.
- **` fetchImpl `**: Guarded HTTP transport; defaults to global fetch.
- **` requestId `**: Use the same id when producing the KEM owner signature.

### SlotCommitteeSignOptions

Per-call overrides for a committee-authorized FROST signature.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/committeeClient.ts#L69)

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

### SlotDrawReaderConfig

Configuration of [createSlotDrawReader](#createslotdrawreader).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/sessionDraw.ts#L212)

```ts
export interface SlotDrawReaderConfig extends SlotVerifierDrawOptions {
    client: PublicClient;
    deployment: SessionDrawDeployment;
    snapshotHosts: readonly string[];
    fetch?: typeof fetch;
    waitForPublicationMs?: number;
}
```

Fields:

- **` client `**: Trusted bounded Viem RPC client for the selected deployment.
- **` deployment `**: Independently approved chain and contract addresses.
- **` snapshotHosts `**: Independently approved accountant origins that serve the verifier-set snapshot artifacts (`GET /v1/verifier-set/{epoch}`), in preference order (e.g. `resolveAccountantUrls`). A host supplies only leaves: every artifact is verified against the root anchored on chain.
- **` fetch `**: Fetch implementation for the artifact reads (default global fetch).
- **` waitForPublicationMs `**: How long a freshly anchored epoch's artifact may take to be published, ms (default 15000, at most 150000).
- **` defaultVerificationPolicy `**: The deployment's default verifier committee policy, used when the slot names none on chain (`verifierPolicy(slot)` = 0/0). It must be the policy the deployment's verifier-agent and keepers are configured with; without it such a slot is refused.

### SlotDrawTrust

What a client needs to verify a slot's grant and to send it to keepers.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/sessionDraw.ts#L194)

```ts
export interface SlotDrawTrust {
    draw: AnchoredVerifierDraw;
    set: VerifierSet;
    committee: number;
    quorum: number;
    seed: Uint8Array;
    witnesses: VerifierWitness[];
    verifierProofs: VerifierProofWire[];
}
```

Fields:

- **` draw `**: The anchored draw the material was built from.
- **` set `**: The epoch's whole verifier set (every key authenticated against the anchored root), by snapshot index, with its size.
- **` committee `**: The slot's committee size.
- **` quorum `**: Signatures required.
- **` seed `**: `beacon.seedAt(epoch)`.
- **` witnesses `**: The drawn verifiers with their anchored membership proofs.
- **` verifierProofs `**: The same witnesses in the keeper wire form.

### SlotGroupKey

The slot's on-chain group public key + epoch (and mode), for local envelope encrypt.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/discovery.ts#L108)

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

### SlotHandoffErrorCode

Stable refusal categories of the hand-off API; branch on `code`, never on the message.
None is retryable: each needs a change of key, offer or slot first.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/slotHandoff.ts#L21)

```ts
export type SlotHandoffErrorCode =
    | 'no-slot'
    | 'cancelled'
    | 'unsupported'
    | 'not-creator'
    | 'not-admin'
    | 'immutable'
    | 'same-holder'
    | 'already-offered'
    | 'guardian'
    | 'nothing-pending'
    | 'not-offered'
    | 'not-confirmed'
    | 'self-custody'
    | 'contract-holder'
;
```

### SlotHandoffStatus

A slot's roles and pending hand-offs as the chain records them; `null` means none.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/slotHandoff.ts#L54)

```ts
export interface SlotHandoffStatus {
    creator: Address;
    pendingCreator: Address | null;
    ruleAdmin: Address | null;
    guardian: Address | null;
    pendingRuleAdmin: Address | null;
    slotAccount: Address | null;
}
```

Fields:

- **` creator `**: Slot creator.
- **` pendingCreator `**: Wallet offered the creator role, not yet accepted.
- **` ruleAdmin `**: Rule admin; `null` means the rule is immutable.
- **` guardian `**: Rule guardian.
- **` pendingRuleAdmin `**: Wallet offered the rule admin role, not yet accepted.
- **` slotAccount `**: The slot's own Ethereum account (a ready secp256k1 threshold slot), or `null`.

### SlotMode

The slot's key type, mirroring `KeyRegistry.Mode` on-chain:
`frost` Ed25519 threshold signatures, `bls` BLS12-381 encryption/decryption,
`tecdsa` secp256k1 threshold ECDSA (an EVM account - what `signEoaDigest` needs),
`bls-bn254`, and `tecdsa-p256` (ES256). A deployment need not run keepers for
every mode; creating a slot the network cannot key leaves it without a group key.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/write.ts#L116)

```ts
export type SlotMode = 'frost' | 'bls' | 'tecdsa' | 'bls-bn254' | 'tecdsa-p256';
```

### SlotSeed

What an accountant returns from `POST /v1/slot-seed`.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/slotSeed.ts#L25)

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

### SlotSeedAnswer

One accountant's answer to one ask, when it was not a usable seed.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/slotSeed.ts#L56)

```ts
export interface SlotSeedAnswer {
    url: string;
    status?: number;
    reason: string;
}
```

Fields:

- **` url `**: The accountant base URL that was asked.
- **` status `**: HTTP status, when a response arrived.
- **` reason `**: Why the answer was not usable: the response reason, a transport error, or a shape/digest fault.

### SlotSeedFailure

Why no seed was obtained: every answer of the LAST round of asks, and how many rounds ran.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/slotSeed.ts#L66)

```ts
export interface SlotSeedFailure {
    rounds: number;
    answers: SlotSeedAnswer[];
    reason: string;
}
```

Fields:

- **` rounds `**: Rounds of asks made (one round asks every accountant once).
- **` answers `**: Each accountant's answer in the last round. Empty when no accountant is registered.
- **` reason `**: One line naming the dominant cause, for logs and bench records.

### SlotSeedOptions

Accountant endpoint overrides, per-request timeout and the bounded retry window for committee
seed discovery.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/slotSeed.ts#L187)

```ts
export interface SlotSeedOptions {
    urls?: string[];
    timeoutMs?: number;
    retryForMs?: number;
    hedgeMs?: number;
    signal?: AbortSignal;
    onFailure?: (failure: SlotSeedFailure) => void;
}
```

Fields:

- **` urls `**: Accountant base URLs. Resolved from `NodeRegistry` when omitted.
- **` timeoutMs `**: Per-accountant HTTP timeout (default 20 s). Within a retry window it is also capped by what is left of the window.
- **` retryForMs `**: Keep asking for up to this long while some refusal is a "not yet" (404 before the accountant's view reaches the commit, 503 while another creation's round holds it, 429, a timeout). Rounds back off with jitter and honour `Retry-After`; a `Retry-After` that lands past the window ends it at once. Default 0: one round. `createSlotCommitReveal` passes ` DEFAULT_SLOT_SEED_RETRY_MS `.
- **` hedgeMs `**: Stagger between the concurrent asks of one round (default ` DEFAULT_SLOT_SEED_HEDGE_MS `; 0 asks all at once).
- **` signal `**: Cancels the asks and the waits between rounds.
- **` onFailure `**: Called once with every answer of the last round when no seed was obtained.

### SlotSharing

A BLS slot's canonical sharing and the keepers that proved their part of it.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/slotSharing.ts#L23)

```ts
export interface SlotSharing extends BlsSharing {
    chainId: number;
    epoch: number;
    committeeVersion: number;
    threshold: number;
    nodeUrls: string[];
}
```

Fields:

- **` chainId `**: Chain the slot lives on, as the RPC reports it.
- **` epoch `**: The slot's current key epoch.
- **` committeeVersion `**: The slot's sharing version (a reshare changes it without changing the epoch).
- **` threshold `**: Contributions needed for one operation.
- **` nodeUrls `**: The verified keepers' endpoints, in registry order.
- **` verifyingShares `**: Public 144-byte G2 || G1 shares indexed by distinct participant identifier.
- **` keepers `**: Assigned endpoints whose signed reports verified for the exact sharing.
- **` failures `**: Metadata refusals, retained without counting them toward the threshold.

### SlotSharingOptions

Options of [readSlotSharing](#readslotsharing).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/slotSharing.ts#L11)

```ts
export interface SlotSharingOptions {
    keeperUrl?(registeredUrl: string): string;
    fetchImpl?: typeof fetch;
    allowLocalHttp?: boolean;
    signal?: AbortSignal;
}
```

Fields:

- **` keeperUrl `**: Caller-approved routing of a registered keeper URL (e.g. local Docker hostnames to published loopback ports).
- **` fetchImpl `**: Guarded HTTP transport for the share reports; defaults to global fetch.
- **` allowLocalHttp `**: Allow loopback HTTP for a disposable local chain 43112 only. Default false.
- **` signal `**: Cancel the reads.

### SlotTransferProposal

Outcome of ` TasraWriteClient.proposeSlotTransfer `.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/write.ts#L430)

```ts
export interface SlotTransferProposal {
    slotId: Hex;
    txHash: Hex;
    to: Address;
    ruleAdmin: Address | null;
    guardian: Address | null;
    callerIsRuleAdmin: boolean;
    settlementBalance?: bigint;
    relay?: RelayReceipt;
}
```

Fields:

- **` slotId `**: Slot offered.
- **` txHash `**: Transaction that carried the offer.
- **` to `**: Wallet that may accept.
- **` ruleAdmin `**: Rule admin, which does not move with the slot; `null` when the rule is immutable.
- **` guardian `**: Guardian, which does not move with the slot.
- **` callerIsRuleAdmin `**: True when this account is also the rule admin and so needs the second hand-off.
- **` settlementBalance `**: TSRA base units the slot holds at the Settlement (its metered funding), which go with it; set when a Settlement address is configured.
- **` relay `**: Relay receipt, when the offer was gas-sponsored.

### SlotVerifierDrawOptions

Options of [readSlotVerifierDraw](#readslotverifierdraw).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/sessionDraw.ts#L132)

```ts
export interface SlotVerifierDrawOptions {
    defaultVerificationPolicy?: {
        committee: number;
        quorum: number;
    };
}
```

Fields:

- **` defaultVerificationPolicy `**: The deployment's default verifier committee policy, used when the slot names none on chain (`verifierPolicy(slot)` = 0/0). It must be the policy the deployment's verifier-agent and keepers are configured with; without it such a slot is refused.

### TasraChainClient

A read client for a deployment: a configured viem client, log helpers and typed readers.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/client.ts#L298)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/slotClient.ts#L58)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/slotClient.ts#L40)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/write.ts#L1578)

<details>
<summary>Full declaration</summary>

```ts
export interface TasraWriteClient {
    account: Account;
    address: Address;
    wallet: WalletClient<Transport, Chain, Account>;
    pub: PublicClient;
    createSlot(args: CreateSlotArgs | CreateSlotFromPolicyArgs): Promise<{
        slotId: Hex;
        txHash: Hex;
        ruleSalt: Hex;
        rule: string;
        relay?: RelayReceipt;
    }>;
    createSlotCommitReveal(args: (CreateSlotArgs | CreateSlotFromPolicyArgs) & CommitRevealOptions): Promise<{
        slotId: Hex;
        commitTx: Hex;
        revealTx: Hex;
        targetEpoch: number;
        ruleSalt: Hex;
        rule: string;
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
    proposeRuleUpdate(a: ProposeRuleArgs): Promise<ProposeRuleResult>;
    endorseRuleUpdate(slotId: Hex): Promise<Hex>;
    vetoRuleUpdate(slotId: Hex): Promise<Hex>;
    activateRuleUpdate(slotId: Hex): Promise<Hex>;
    proposeSlotTransfer(slotId: Hex, to: Address): Promise<SlotTransferProposal>;
    withdrawSlotTransfer(slotId: Hex): Promise<Hex>;
    acceptSlotTransfer(slotId: Hex): Promise<Hex>;
    proposeRuleAdminTransfer(slotId: Hex, to: Address): Promise<Hex>;
    withdrawRuleAdminTransfer(slotId: Hex): Promise<Hex>;
    acceptRuleAdminTransfer(slotId: Hex): Promise<Hex>;
    lockKeyRotation(slotId: Hex): Promise<RotationLockResult>;
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

</details>

Fields:

- **` account `**: The account every write is signed with.
- **` address `**: Convenience alias for `account.address`.
- **` wallet `**: The underlying wallet client.
- **` pub `**: A read client on the same RPC, used for receipts and balance reads.
- **` createSlot `**: Create a slot directly. Persist the generated slot ID and rule salt; provisioning requires the saved salt. Use prepared creation to persist the intent before submission. A `kk_oauth` policy envelope (as `rule`, or authored as `oauthPolicy`) requires `authType: 'oauth'` and must pass the network's gate; both are checked before any chain call. `rule` in the result is the exact string committed.
- **` createSlotCommitReveal `**: Create a slot using commit-reveal with an accountant seed; never waits for a beacon epoch (throws `SlotSeedUnavailableError` without a seed). Persist the slot ID and rule salt; prepared creation preserves them before submission. Policy envelopes are checked as for `createSlot`; `rule` in the result is the exact string committed.
- **` fundSlot `**: Approve TSRA and fund the slot settlement balance in token base units.
- **` sendEth `**: Send native currency in base units and wait for a successful receipt.
- **` transferTsra `**: Transfer TSRA in token base units and wait for confirmation.
- **` rotateKey `**: Request a new distributed key generation epoch for the slot. A slot whose rotation is locked (by its creator, or a threshold-ECDSA slot by its mode) is refused before signing as a `RotationLockError` with code `locked`; the chain would revert `RotationLocked()`, which is final.
- **` reshareKey `**: Redistribute the slot key among the supplied operators using the new threshold. On a threshold-ECDSA slot the roster must keep at least the current `k` members (only staying members re-deal the key) and `k` must be at least 2; otherwise it is refused before signing as a `ReshareRosterError`.
- **` cancelSlot `**: Cancel the slot using the configured account authority.
- **` renewSlot `**: Renew the slot lease; the configured account must be its creator.
- **` setVerifierPolicy `**: Set the verifier committee size and quorum, optionally persisting transaction progress.
- **` setRulePolicy `**: Pin amendment authority while the slot is fresh. Prefer passing rulePolicy at creation so key generation cannot win the race. The guardian must differ from the administrator, and omitting a guardian requires the contract minimum timelock.
- **` proposeRuleUpdate `**: Propose a new rule for the slot, signed by its rule admin (relayed calls are still signed by this account). The slot's saved `ruleSalt` is reused. Refused before signing, as a `RuleAmendmentError`: a missing slot, an immutable slot, a signer that is not the rule admin, an amendment already pending, a policy envelope on a slot not created with `authType: 'oauth'`, an envelope keepers would not store, and the current rule. An amendable rule means whoever holds the admin key can change who may sign with this key, without changing the key: keep the admin key as safe as the slot itself. The guardian can veto during the delay; without a guardian nobody can. A slot created without a rule admin can never become amendable. Deliver the returned `rule` with `provisionRule({expect: 'pending'})`; the amendment activates only once enough keepers hold it.
- **` endorseRuleUpdate `**: Waive the remaining delay of the pending amendment, signed by the slot's guardian. Refuses `not-guardian` and `no-pending` before signing.
- **` vetoRuleUpdate `**: Discard the pending amendment, signed by the slot's guardian. Refuses `not-guardian` and `no-pending` before signing.
- **` activateRuleUpdate `**: Activate the pending amendment; anyone may send it. Refuses `no-pending`, `timelock` (judged on the latest block timestamp, not the local clock) and `below-threshold` before signing.
- **` proposeSlotTransfer `**: Offer the slot to `to` as its next creator, signed by the current creator. It moves only when `to` accepts with acceptSlotTransfer; a new offer replaces an earlier one. Only the creator moves: the rule admin and the guardian stay, and the result names them. When this account is also the rule admin, hand that role over separately with proposeRuleAdminTransfer. At acceptance every delegation this account signed for the slot stops working. The slot's Settlement balance goes with the slot and nothing is refunded; the result carries the balance when a Settlement address is configured. Refused before signing, as a `SlotHandoffError`: `no-slot`, `cancelled`, `unsupported` (a KeyRegistry without the hand-off), `not-creator`, `same-holder`, `already-offered`, `self-custody` (the slot's own threshold account, which could never authorize an operation of itself again) and `contract-holder` (keepers accept creator signatures from an externally owned account only).
- **` withdrawSlotTransfer `**: Withdraw the pending creator offer, signed by the creator. Refuses `not-creator` and `nothing-pending` before signing.
- **` acceptSlotTransfer `**: Become the slot's creator, signed by the offered wallet. Refuses `nothing-pending`, `not-offered` and `self-custody` before signing. Afterwards sign fresh delegations for the apps that use the slot and update their configuration: the previous creator's delegations no longer verify.
- **` proposeRuleAdminTransfer `**: Offer the slot's rule admin role to `to`, signed by the rule admin. It moves only when `to` accepts. It can never go to the guardian, and the guardian is not asked. Refuses `immutable`, `not-admin`, `same-holder`, `guardian` and `already-offered` before signing.
- **` withdrawRuleAdminTransfer `**: Withdraw the pending rule admin offer, signed by the rule admin. Refuses `not-admin` and `nothing-pending` before signing.
- **` acceptRuleAdminTransfer `**: Become the slot's rule admin, signed by the offered wallet. Refuses `nothing-pending`, `not-offered` and `guardian` before signing.
- **` lockKeyRotation `**: Lock the slot's key against every rotation, for good, signed by its creator (`KeyRegistry.lockKeyRotation`, relayed when a relay is configured). After it, every rotation path reverts `RotationLocked()` for everyone, the creator included; resharing still works, because it moves the shares and keeps the key. Set-once: a slot that is already locked resolves `already-locked` without sending. That includes every threshold-ECDSA slot (`tecdsa`, `tecdsa-p256`), which the network locks by its mode, so such a slot never emits `KeyRotationLocked`; read the state with `isRotationLocked`. Refused before signing, as a `RotationLockError`: `no-slot`, `cancelled`, `unsupported` (a KeyRegistry without the lock) and `not-creator`; `not-confirmed` when the transaction mined but the chain does not show the lock.
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
- **` settlementBalance `**: Read the TSRA balance a slot holds at the Settlement (its metered funding).
- **` relayEnabled `**: Whether writes are submitted through a registered relay rather than directly.
- **` lastRelay `**: Return the last verified relay receipt, if any.
- **` pendingRelayAttempt `**: Return the signed relay attempt awaiting reconciliation, if any.
- **` reconcileRelay `**: Inspect the pending attempt against the chain without signing a replacement.

### TecdsaReshareRosterInput

A threshold-ECDSA reshare proposal: the slot's current committee and the roster to vote for.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/reshareRoster.ts#L42)

```ts
export interface TecdsaReshareRosterInput {
    current: readonly Address[];
    currentK: number;
    next: readonly Address[];
    k: number;
    n: number;
}
```

Fields:

- **` current `**: The slot's current roster (`KeyRegistry.assignedNodes`).
- **` currentK `**: The slot's current threshold `k`.
- **` next `**: The proposed roster, in the order the vote will carry it.
- **` k `**: The proposed threshold.
- **` n `**: The proposed committee size; must equal the roster length.

### TecdsaReshareRosterPlan

How a valid proposal moves the committee. Addresses are checksummed.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/reshareRoster.ts#L56)

```ts
export interface TecdsaReshareRosterPlan {
    staying: Address[];
    joining: Address[];
    leaving: Address[];
}
```

Fields:

- **` staying `**: Current members that stay; these are the dealers, at least the current `k` of them.
- **` joining `**: New members that receive a share without dealing.
- **` leaving `**: Current members that leave the committee.

### VaultTranche

Named vesting allocation used to resolve its deployed vault.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/deployments.ts#L71)

```ts
export type VaultTranche = (typeof VAULT_TRANCHES)[number];
```

### VerifiedCustodyReport

A keeper's custody statement whose signature verified under the operator's registered key.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/custodyHealth.ts#L230)

```ts
export interface VerifiedCustodyReport {
    operator: Address;
    statement: CustodyStatement;
}
```

Fields:

- **` operator `**: Operator that signed it (checksummed).
- **` statement `**: The signed statement; nothing outside it is returned.

### VerifierInfo

Verifier-reported runtime settings and token lifetime.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/offchain.ts#L174)

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

### VerifierProofWire

A drawn verifier's membership proof on the wire, as keepers take it (`verifier_proofs`).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/sessionDraw.ts#L182)

```ts
export interface VerifierProofWire {
    verifier_index: number;
    operator: string;
    pubkey: string;
    proof: string[];
}
```

Fields:

- **` verifier_index `**: Index in the epoch's snapshot.
- **` operator `**: Operator address, bare hex.
- **` pubkey `**: Ed25519 committee key, bare hex.
- **` proof `**: Sibling hashes, bare hex.

### VerifierWitness

One drawn verifier with its Merkle membership proof in the epoch's anchored snapshot.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/verifierSnapshot.ts#L37)

```ts
export interface VerifierWitness {
    index: number;
    operator: Hex;
    publicKey: Hex;
    proof: Hex[];
}
```

Fields:

- **` index `**: Index in the epoch's snapshot.
- **` operator `**: Operator address.
- **` publicKey `**: Ed25519 committee key.
- **` proof `**: Sibling hashes up to the anchored root.

### WriteClientConfig

Either a private-key signer or an account-bound wallet with network write configuration.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/write.ts#L197)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/write.ts#L177)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/write.ts#L187)

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
| `ACCOUNTANT_TAG` | The on-chain role tag accountant operators register under: `keccak256("accountant")`. The same tag the accountants themselves resolve their set with. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/discovery.ts#L140) |
| `accountantSetRegistryAbi` | AccountantSetRegistry contract interface for accountant-set snapshots and membership evidence. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/abis/accountantSetRegistry.ts#L5) |
| `accountantSlashingAbi` | AccountantSlashing contract interface for accountant penalties and related evidence. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/abis/accountantSlashing.ts#L5) |
| `bondingCurveAbi` | BondingCurve contract interface for TSRA purchases, redemptions and pricing. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/abis/bondingCurve.ts#L5) |
| `CONTRACT_ABIS` | Contract name to ABI. Keys match Foundry artifact names. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/abis/index.ts#L44) |
| `CONTRACT_CATEGORY` | Default category per contract (the global event feed groups by this). | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/events.ts#L23) |
| `CUSTODY_HEALTH_DOMAIN` | Domain tag of [custodyStatementHash](#custodystatementhash); a changed preimage gets a new name on the network. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/custodyHealth.ts#L30) |
| `CUSTODY_STATEMENT_MAX_AGE_SECS` | Default maximum age of a statement, in seconds; the keepers count a peer's statement for 900 s. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/custodyHealth.ts#L33) |
| `DEFAULT_CHAIN_ID` | Fallback chain ID retained for explicitly configured loopback connections. Set the chain ID from the downloaded tasra-releases network manifest for deployment access. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/deployments.ts#L64) |
| `DEFAULT_SLOT_SEED_HEDGE_MS` | Default stagger between launching the asks of one round. The asks run CONCURRENTLY and the first valid seed wins; the stagger only keeps a healthy set from leading n threshold rounds for one commitment (each accountant leads at most one round at a time and sheds the rest with a 503). An ask that fails launches the next one at once, without waiting for the stagger. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/slotSeed.ts#L97) |
| `DEFAULT_SLOT_SEED_RETRY_MS` | Default time the creation path keeps re-asking while the set answers "not yet". | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/slotSeed.ts#L90) |
| `equivocationSlasherAbi` | EquivocationSlasher contract interface for submitting conflicting-signature evidence. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/abis/equivocationSlasher.ts#L5) |
| `fixedTasraPriceOracleAbi` | FixedTasraPriceOracle contract interface for converting TSRA amounts using the configured fixed exchange rate. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/abis/fixedTasraPriceOracle.ts#L5) |
| `IMPLEMENTATION_SLOT` | EIP-1967 storage slot containing a proxy implementation address. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/manifest.ts#L168) |
| `keeperShareRegistryAbi` | KeeperShareRegistry contract interface for anchored keeper verifying-share commitments. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/abis/keeperShareRegistry.ts#L5) |
| `keyRegistryAbi` | KeyRegistry contract interface for slot creation, key epochs and authorization policies. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/abis/keyRegistry.ts#L5) |
| `livenessRegistryAbi` | LivenessRegistry contract interface for registered operator liveness observations. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/abis/livenessRegistry.ts#L5) |
| `MAX_RESHARE_PARTIES` | Largest committee the network deals a key to (`KeyRegistry.MAX_N`). | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/reshareRoster.ts#L16) |
| `mockEurcAbi` | MockEurc contract interface for test-token balances, transfers, approvals and minting. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/abis/mockEurc.ts#L5) |
| `NETWORKS` | Built-in network defaults; use a tasra-releases manifest for deployed contract addresses. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/networks.ts#L39) |
| `nodeApi` | Direct keeper HTTP reads for status, keys, public keys, heartbeats and metering. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/offchain.ts#L145) |
| `nodeRegistryAbi` | NodeRegistry contract interface for operator registration, role tags, stake and activity. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/abis/nodeRegistry.ts#L5) |
| `platformExecutorAbi` | PlatformExecutor contract interface for platform-authorized contract execution. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/abis/platformExecutor.ts#L5) |
| `prevrandaoSaltBeaconAbi` | PrevrandaoSaltBeacon contract interface for chain-randomness-derived committee seeds. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/abis/prevrandaoSaltBeacon.ts#L5) |
| `PROVISION_RULE_ACTION` | Action identifier accepted by the creator-authorized rule provisioning endpoint. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/provisionRule.ts#L36) |
| `ROTATION_LOCK_SELECTORS` | Selectors and the event topic of the rotation-lock additions to `KeyRegistry`, each the keccak256 of the Solidity signature in its comment. A stale signature is a different selector, so a test pins each value against its signature and against the vendored ABI. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/rotationLock.ts#L29) |
| `ROTATION_LOCK_SENTINEL` | `lastRotatedAt` value the contract writes to lock a slot: 2^64 - 1, never a real timestamp. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/rotationLock.ts#L22) |
| `SERVICE_CHALLENGE_LIFETIME_SECONDS` | Challenge lifetime in seconds, leaving room for clock differences. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L29) |
| `SERVICE_CHALLENGE_SECONDS` | Maximum accepted identity challenge validity window in seconds. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L24) |
| `SERVICE_IDENTITY_MAX_BYTES` | Maximum accepted identity challenge response size in bytes. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L20) |
| `SERVICE_IDENTITY_PATH` | HTTPS endpoint that signs a registered-service identity challenge. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L12) |
| `SERVICE_IDENTITY_PROTOCOL` | Protocol identifier required in registered-service manifests. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L33) |
| `SERVICE_MANIFEST_MAX_BYTES` | Maximum accepted service manifest size in bytes. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L16) |
| `SERVICE_MANIFEST_PATH` | HTTPS path where a registered service publishes its canonical manifest. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/serviceIdentity.ts#L8) |
| `SERVICE_STATUSES` | Registry lifecycle ordinals for active, draining and retired services. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/services.ts#L35) |
| `SERVICE_TYPES` | Permanent ServiceRegistry ABI ordinals. Registration grants no operator privileges. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/services.ts#L31) |
| `serviceRegistryAbi` | ServiceRegistry contract interface for provider-owned service records and lifecycle updates. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/abis/serviceRegistry.ts#L5) |
| `settlementAbi` | Settlement contract interface for metered slot balances and operation settlement. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/abis/settlement.ts#L5) |
| `tasraTokenAbi` | TasraToken contract interface for TSRA balances, transfers, approvals and supply. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/abis/tasraToken.ts#L5) |
| `tasraVestingVaultAbi` | TasraVestingVault contract interface for allocation vesting and token release. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/abis/tasraVestingVault.ts#L5) |
| `thresholdRandomBeaconAbi` | ThresholdRandomBeacon contract interface for threshold-signed randomness epochs. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/abis/thresholdRandomBeacon.ts#L5) |
| `treasuryAbi` | Treasury contract interface for treasury balances, authorized withdrawals and refunds. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/abis/treasury.ts#L5) |
| `VAULT_TRANCHES` | The vesting tranches Deploy.s.sol creates, in the order it creates them. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/deployments.ts#L67) |
| `VERIFIER_TAG` | The on-chain role tag verifier operators register under: `keccak256("verifier")`. The same tag the accountants use to build the settlement split, and the CLI to resolve a tagged operator set. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/discovery.ts#L28) |
| `verifierApi` | Direct verifier HTTP reads for status and Prometheus metrics. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/offchain.ts#L189) |
| `verifierSetRegistryAbi` | VerifierSetRegistry contract interface for verifier-set snapshots and membership roots. | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/chain/abis/verifierSetRegistry.ts#L5) |
