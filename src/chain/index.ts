// @t3foundry/tasra-sdk/chain - on-chain + network READ capability for building
// observability tooling (e.g. an explorer) on top of a Tasra Network.
//
// This is a separate subpath export (`@t3foundry/tasra-sdk/chain`) so the crypto core
// entry stays lean and viem is only pulled in when chain features are imported.

// Contract ABIs (generated from the Foundry artifacts) + nametoabi map.
export * from './abis/index.js'
// Chain reads a session grant is judged by: beacon epochs and a slot's anchored verifier draw.
export {readCurrentBeaconEpoch, readBeaconDrawState, readSlotVerifierDraw, createSlotDrawReader} from './sessionDraw.js'
export type {BeaconDrawState, BeaconDeployment, SessionDrawDeployment, SlotVerifierDrawOptions, SlotDrawReaderConfig, SlotDrawTrust, VerifierProofWire} from './sessionDraw.js'
export {drawnVerifierWitnesses, fetchDrawnVerifierWitnesses} from './verifierSnapshot.js'
export type {AnchoredVerifierDraw, VerifierWitness} from './verifierSnapshot.js'
// A BLS slot's keepers and authenticated public sharing, from the slot id alone.
export {readSlotSharing} from './slotSharing.js'
export type {SlotSharing, SlotSharingOptions} from './slotSharing.js'
export {followHeads, unfollowHeads, headFollowerOf, createHeadFollower, type HeadFollower, type HeadFollowerOptions, type FollowedHead} from './headFollower.js'
export {SlotCommitmentExpiredError, SlotRevealNotYetError, SlotSeedUnavailableError, assertExpiredSlotCommitment} from './commitmentRecovery.js'

// Deployment address discovery.
export {
  addressBookFromBroadcast,
  addressBookFromEnv,
  addressBookFromObject,
  DEFAULT_CHAIN_ID,
  requireAddress,
  requireVaultAddress,
  vaultKey,
  VAULT_TRANCHES,
} from './deployments.js'
export type {AddressBook, Address, VaultTranche} from './deployments.js'

// Network presets: chain id + RPC per known network. Only `local` today.
export {NETWORKS, networkNameForChain, resolveNetworkProfile, assertEurcFaucetAllowed} from './networks.js'
export type {NetworkName, NetworkPreset, ResolvedNetworkProfile} from './networks.js'

// Event registry + decoding.
export {
  CONTRACT_CATEGORY,
  categoryFor,
  eventNamesOf,
  decodeContractLogs,
  jsonSafe,
} from './events.js'
export type {EventCategory, DecodedEvent} from './events.js'

// viem read client (PublicClient + windowed logs + typed readers).
export {createTasraChainClient} from './client.js'
export type {
  ChainClientConfig,
  RpcBatchOptions,
  GetLogsWindowedOpts,
  TasraChainClient,
} from './client.js'

// Off-chain network read clients.
export {nodeApi, verifierApi, parsePrometheus} from './offchain.js'
export type {
  FetchOpts,
  NodeInfo,
  KeySlotSummary,
  KeyListReply,
  SignedHeartbeat,
  MeteringReply,
  VerifierInfo,
} from './offchain.js'

// Format helpers.
export {truncateHex, formatUnits, formatBps, formatWad} from './format.js'

// Client-side on-chain WRITE path: a sovereign client signs its own slot
// creation + settlement funding (no relayer). Pairs with the read client above.
// `ruleCommitment` is exported because a consumer that displays or verifies a
// slot's policy needs it: the commitment is the only link between an
// on-chain `KeySlot.ruleCommitment` and a candidate rule, and the plaintext must
// never go on chain. Without it here the package `exports` map makes it unreachable.
export {createTasraWriteClient, generateClientKey, ruleCommitment, verifyRuleCommitment} from './write.js'
// Creator-authorised rule provisioning: the step that makes a created slot USABLE.
// Without it a caller can create a slot and never deliver its rule, which needs an
// operator secret on the keeper's admin route.
export {provisionRule, provisionRuleTypedData, PROVISION_RULE_ACTION} from './provisionRule.js'
export type {ProvisionRuleArgs, ProvisionRuleResult, KeeperProvisionResult} from './provisionRule.js'
export type {RuleInput} from './ruleInput.js'
// Rule amendment: the status read and the end-to-end driver (the four writes live on the write client).
export {readRuleAmendment, amendSlotRule, RuleAmendmentError} from './ruleAmendment.js'
export type {RuleAmendmentStatus, RuleAmendmentErrorCode, AmendSlotRuleArgs, AmendSlotRuleResult, AmendmentPhase} from './ruleAmendment.js'
// Slot hand-offs: the read and the typed refusal (the six writes live on the write client).
export {readSlotHandoff, SlotHandoffError} from './slotHandoff.js'
export type {SlotHandoffStatus, SlotHandoffErrorCode} from './slotHandoff.js'
// ADR-0099: the rotation lock, the tECDSA reshare roster rule and the keepers' signed custody health.
export {readRotationLock, isRotationLocked, decodeRotationLockRevert, decodeKeyRotationLockedLogs, RotationLockError,
  ROTATION_LOCK_SENTINEL, ROTATION_LOCK_SELECTORS} from './rotationLock.js'
export type {RotationLockStatus, RotationLockErrorCode, RotationLockRevert, KeyRotationLockedEvent} from './rotationLock.js'
export {checkTecdsaReshareRoster, ReshareRosterError, MAX_RESHARE_PARTIES} from './reshareRoster.js'
export type {TecdsaReshareRosterInput, TecdsaReshareRosterPlan, ReshareRosterErrorCode} from './reshareRoster.js'
export {readCustodyHealth, verifyCustodyHealthReply, parseCustodyStatement, custodyStatementHash, verifyCustodyStatement,
  custodyStatementIsCurrent, assessCustodyHealth, CustodyHealthError, CUSTODY_HEALTH_DOMAIN, CUSTODY_STATEMENT_MAX_AGE_SECS} from './custodyHealth.js'
export type {CustodyStatement, CustodyFailure, CustodyReshareState, CustodyHealthErrorCode, ExpectedCustodyReply, VerifiedCustodyReport,
  CustodyHealthLevel, ReadCustodyHealthOptions, CustodyHealthReport} from './custodyHealth.js'
export type {
  CreateSlotArgs,
  CreateSlotFromPolicyArgs,
  CommitRevealOptions,
  ProposeRuleArgs,
  ProposeRuleResult,
  SlotTransferProposal,
  RotationLockResult,
  RelayConfig,
  RelayReceipt,
  TasraWriteClient,
  SlotAuthType,
  SlotMode,
  WriteClientConfig,
  WriteClientKeyConfig,
  WriteClientWalletConfig,
} from './write.js'

// Slot-driven on-chain discovery: resolve a slot's keeper URLs, the active verifier
// directory, and the slot's group key straight from the registry.
export {
  VERIFIER_TAG,
  ACCOUNTANT_TAG,
  resolveSlotKeeperUrls,
  resolveVerifierDirectory,
  resolveSlotGroupKey,
  resolveAccountantUrls,
} from './discovery.js'
export type {SlotGroupKey} from './discovery.js'

// accountant-seeded creation: the per-commitment draw seed. `createSlotCommitReveal` uses this internally; it is
// exported for a caller that drives commit and reveal itself (the CLI does) or wants to inspect
// what the accountant set answered before spending gas.
export {DEFAULT_SLOT_SEED_HEDGE_MS, DEFAULT_SLOT_SEED_RETRY_MS, requestSlotSeed} from './slotSeed.js'
export type {SlotSeed, SlotSeedAnswer, SlotSeedFailure, SlotSeedOptions} from './slotSeed.js'

// The few-lines committee surface, driven by just a slot id: discovers the
// keeper node + verifier set from chain, then sign / encrypt / decrypt.
export {createCommitteeSlotClient} from './committeeClient.js'
export type {
  CommitteeSlotClient,
  CommitteeSlotClientConfig,
  SlotCommitteeSignOptions,
  SlotCommitteeDecryptOptions,
  // Deprecated aliases, kept so the rename is not a hard break.
  CommitteeSignOptions,
  CommitteeDecryptOptions,
} from './committeeClient.js'

// Slot-driven managed JWT client: discovers the slot's keeper nodes and CHOOSES a verifier
// from chain (that verifier mints the JWT), then opens a managed session - same surface as
// createTasraClient but endpoints come from the registry, not static config.
export {createTasraSlotClient} from './slotClient.js'
export type {
  TasraSlotClient,
  TasraSlotClientConfig,
  ResolvedEndpoints,
} from './slotClient.js'

// Provider-owned service directory (metadata; endpoint authentication remains separate).
export {SERVICE_TYPES, SERVICE_STATUSES, deriveServiceId, hashServiceManifest, readApprovedServiceRecord} from './services.js'
export type {ServiceType, ServiceStatus, ServiceRecord, ServiceApproval} from './services.js'

export {SERVICE_MANIFEST_PATH, SERVICE_IDENTITY_PATH, SERVICE_MANIFEST_MAX_BYTES, SERVICE_IDENTITY_MAX_BYTES, SERVICE_CHALLENGE_SECONDS, SERVICE_CHALLENGE_LIFETIME_SECONDS, SERVICE_IDENTITY_PROTOCOL, validateServiceEndpoint, encodeServiceManifest, verifyServiceManifest, serviceChallengeTypedData, encodeServiceChallenge, parseServiceChallenge, validateServiceChallenge, verifyServiceIdentity, authenticateApprovedService} from './serviceIdentity.js'
export type {ServiceManifest, ServiceChallenge, ServiceDiscoveryTransport, AuthenticatedService} from './serviceIdentity.js'

export {createRegisteredRelaySubmitter, reconcileRelayAttempt, RelayOutcomeUnknownError, isRelayBusyReason} from './registeredRelay.js'
export type {RegisteredRelayConfig, RelayTransport, RelayAttempt, RelayIntent, RelayReconciliation, RelayHttpResponse} from './registeredRelay.js'
export type {RelayVoucher, RelayVoucherIntent, RelaySponsorshipConfig} from './relayVoucher.js'
export {assertRelayVoucher, assertRelayVoucherIntent} from './relayVoucher.js'

export {createRegisteredAgentClient, AgentSessionCreationUnknownError} from './registeredAgent.js'
export type {AgentTransport, AgentHttpResponse, ApprovedAgentProfile, RegisteredAgentSession, AgentSessionRecovery} from './registeredAgent.js'
export type {SessionControlHttpResponse, SessionControlTransport, SessionAgentTransport} from './sessionControlTransport.js'

export {parseApplicationServiceProfiles, applicationServiceProfilesDocument} from './serviceProfiles.js'
export type {ApplicationServiceProfiles, ApprovedServiceProfile} from './serviceProfiles.js'
export {openRegisteredVerifierAgentSession, awaitRegisteredVerifierAgentResult, assertRegisteredWalletRequest, assertAnchoredWalletRequest} from './registeredOperation.js'
export type {RegisteredVerifierAgentSession} from './registeredOperation.js'

// Versioned, digest-pinned public deployment records.
export * from './manifest.js'
