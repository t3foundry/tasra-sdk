# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package follows
semantic versioning with one pre-1.0 caveat: a minor bump may change the API, a patch
never does.

## [Unreleased]

## [0.3.0] — 2026-10-03

A minor bump: a public option is removed.

### Removed
- `clientSigner` on `requestCommitteeToken` / `committeeSignRequest` / `committeeDecryptRequest` /
  `ibeExtractRequest` and on `createCommitteeSlotClient`, with `ClientSigner` and
  `ed25519ClientSigner`. They put `client_pubkey` + `client_signature` into the keeper's
  `/v1/committee/sign`, `/v1/committee/decrypt` and `/v1/shards/ibe/extract` bodies - fields the
  keeper retired when request binding moved INTO the compound token (`request_hash` +
  `BindingStrength`, enforced by the keeper under `require_request_binding`). The keeper had been
  silently dropping them; since 2026-10-03 it refuses any undeclared field with a 422, so the
  option would now make every call fail. Nothing is lost: the holder binding the option claimed
  to provide is carried by the token on every call already. `clientBindingHash` (a pure
  function pinned by the conformance vectors) stays exported.
- `credentials` on `verifyPresentation`'s body type: the verifier's `VerifyBody` declares only
  `dcql_rule` and `presentation` and refuses anything else.

### Changed
- The committee sign / decrypt / extract bodies are asserted to carry ONLY the keys the keeper
  declares (`test/committee.one-call.ts`, `test/committee.guards.ts`) - the SDK-side mirror of the
  keeper's strict-body test.
- `verify:security` runs `scripts/audit.mjs`: `npm audit` at high/critical with EXPLICIT, dated,
  per-advisory exceptions in `security/audit-exceptions.json` (an expired or no-longer-matching
  exception fails the gate), instead of a lowered audit level. One exception is recorded:
  GHSA-ch52-4w7c-c8xp on `http-cache-semantics`, a build-time dependency of the docs site's
  `astro` with no patched release; it does not reach the published package.

## [0.2.4] — 2026-10-01

### Fixed

- Point npm package repository, issues, and homepage metadata to the publishing
  GitHub repository.
- Make the funding tutorial resolve the EURC token from the verified BondingCurve
  when the Fuji release manifest omits a separate token entry; reject conflicting
  token addresses before writes.
- Let the Fuji application examples proceed with 0.05 AVAX of creator gas and
  use a purchase amount that meets the documented 1 TSRA minimum.
- Avoid failing a consumer's install when Git is unavailable.
- Update the development Next.js dependency past the `next/og` security advisory.

## [0.2.3] — 2026-09-30

### Added

- Rule amendment on `tasra-sdk/chain`. The write client gains `proposeRuleUpdate`,
  `endorseRuleUpdate`, `vetoRuleUpdate` and `activateRuleUpdate`; each refuses, before
  signing, what the contract would revert (missing or immutable slot, wrong signer, an
  amendment already pending, the current rule, a policy envelope on a non-`oauth` slot or
  one keepers would not store, the timelock judged on chain time, too few keeper
  adoptions). `readRuleAmendment` reads the active rule, the amendment policy and the
  pending amendment with its adoption votes. `amendSlotRule` drives propose → deliver →
  adoption → guardian endorsement → activation, resumes from the chain state when called
  again, and returns `{version, ruleCommitment, proposeTx?, activateTx?}`. Refusals are a
  `RuleAmendmentError` with a stable `code`.
- `provisionRule` options `expect: 'pending'` (deliver a proposed amendment; keepers that
  have not yet seen the proposal are retried with the same signature, and a keeper that
  stores the rule as active is an error), `retryConflictMs` (default 120000) and
  `delegation` (a creator delegation). Each keeper result now carries `authorizedBy`
  (`creator`, `delegate` or `rule_admin`) when the keeper reports it. The default
  `expect: 'active'` delivery is unchanged.
- OAuth policy envelopes (`kk_oauth`): a slot whose holders sign in with their
  organization's identity provider can commit a Rego policy over the DPoP-bound access
  token's claims. `packEnvelope`, `unpackEnvelope`, `lintEnvelope` and `evaluateEnvelope`
  run the network's own policy engine, shipped as a pinned WebAssembly module that is
  loaded on first use and SHA-256-checked before instantiation; `isOauthEnvelope` is pure
  TypeScript. `createSlot` / `createSlotCommitReveal` accept `oauthPolicy: {policy, tokens,
  entrypoint?}`, require `authType: 'oauth'` for an envelope, refuse one keepers would not
  store before any transaction, and return the committed string as `rule`.
  `ruleCommitment` commits an envelope in canonical (RFC 8785) form. Package size: the
  module adds 965,157 bytes unpacked (about 328 KB compressed); applications that never
  call the engine do not load it. Third-party notices for the compiled engine are in
  `NOTICE`.
- Additive `tasra-sdk/app` entry for typed slot operations, public EVM address lookup,
  exact-operation authorization, a registered wallet adapter and viem accounts.
- Durable prepared creation journals with known-transaction recovery and explicit
  refusal to retry an uncertain submission.
- Native FROST approval lifecycle, canonical approval payloads, strict IBE extraction,
  and operation receipt preservation/verification.
- Complete encrypted-notes, document-signing and native approval TypeScript examples,
  application guides and migration notes.

- `committeeSignEoaDigest` in `tasra-sdk/committee` for request-bound threshold
  Ethereum signing with verifier-agent compound tokens and membership proofs.
- SDK-only shared-account example that creates and provisions a tECDSA slot,
  confirms Alice/Bob transactions, and verifies Mallory's server-side denial.
- Generated API reference and explicit SDK/deployment compatibility guidance.
- Evidence pass-through on `tasra-sdk/committee`: `committeeSign`, `committeeDecrypt` and
  `requestIbeExtractionPartials` accept `evidenceCt` (the sealed presentation the verifier
  agent returns beside the compound token as `evidenceCt`) and forward it to keepers;
  `evidenceBindingMessage` and `verifyEvidenceBinding` check the token's evidence binding.
- `createDpopKey().tokenRequestProof({htm, htu, nonce?})` for identity providers that
  require a DPoP proof on the token request itself.
- `isValidSessionId`, `MAX_SESSION_ID_LEN`, `OAUTH_RESPONSE_PATH_PREFIX` and
  `OAUTH_RESPONSE_PATH_SUFFIX` in `tasra-sdk/committee`.

### Changed

- **Breaking** (`tasra-sdk/committee`): `dpopHtu(origin, sessionId)` now takes the session
  id and returns the per-session OAuth response URL
  (`/v1/sessions/<sessionId>/oauth-response`); the session id must be one plain path
  segment or the call throws.
- `assertCompoundTokenWire` refuses a compound token that carries only some of the
  evidence fields.
- `RecipientStore.satisfies` and `validateRule` refuse a `kk_oauth` policy envelope by
  name: held credentials cannot satisfy it (`canAccess` returns `false`).
- All 11 application-building skills lead with the current task workflow;
  specialized and compatibility details are available in supporting references.
- The shared-account tutorial always demonstrates durable prepared creation.
- The slot-provisioning example uses the creator's signature instead of an admin JWT.

### Removed

- **Breaking** (`tasra-sdk/committee`): `OAUTH_RESPONSE_PATH`; the response path is now
  per session (`OAUTH_RESPONSE_PATH_PREFIX` + session id + `OAUTH_RESPONSE_PATH_SUFFIX`).

### Fixed

- Every tasra-releases and repository link (docs, skills, examples, issue templates and
  the generated reference `[Source]` links) now points at the `t3foundry` organisation.
- The bring-your-own-identity-provider section of the API guide now shows the `kk_oauth`
  policy envelope (`oauthPolicy`) an OAuth slot uses, and how to amend it.
- Point npm package repository, issues, and homepage metadata to the publishing
  GitHub repository.
- Make the funding tutorial resolve the EURC token from the verified BondingCurve
  when the Fuji release manifest omits a separate token entry; reject conflicting
  token addresses before writes.
- Let the Fuji application examples proceed with 0.05 AVAX of creator gas and
  use a purchase amount that meets the documented 1 TSRA minimum.
- Update the development Next.js dependency past the `next/og` security advisory.
- Keep recovery salts out of public tutorial evidence; select public creation
  references explicitly.
- Align note identity/result guidance with the API and include a complete standalone
  Node TypeScript configuration.
- Point skills and onboarding docs to the published Fuji deployment pointer,
  manifest checksum and service URLs in `t3foundry/tasra-releases`; document
  bootstrap from a pinned repository commit.
- Narrow slot-creation results before reading the transaction hash in the skill's
  direct/commit-reveal example.

Install `tasra-sdk@latest` from npm. Network operations require compatible contracts
and services selected through a verified tasra-releases manifest.

## [0.2.2] — 2026-09-23

### Fixed

- Accept registered wallet Request Objects without `transaction_data`, while
  preserving operation and nonce binding checks. When `transaction_data` is present,
  continue to require exactly one entry matching the authorized operation, including
  its description.

## [0.2.1] — 2026-09-22

### Fixed

- Treat relay attempts with a consumed nonce outside the 10,000-block reconciliation
  window as terminal (`unresolvable`) and release the pending signer lock instead of
  retrying forever. Export the `RelayReconciliation` result type from `tasra-sdk/chain`.
  An unresolvable outcome does not prove that the operation failed; callers must check
  the resulting chain state before repeating the operation.

## [0.2.0] — 2026-09-22

### Added

- Per-commitment accountant seeds for faster slot creation on compatible deployments,
  with beacon-epoch fallback when a seed is unavailable.
- `requestSlotSeed`, `resolveAccountantUrls`, `ACCOUNTANT_TAG`, and the
  `SlotSeed`, `SlotSeedOptions`, and `CommitRevealOptions` types in `tasra-sdk/chain`.
- Seed-request options and a `seeded` result flag on `createSlotCommitReveal`.

### Changed

- Commit/reveal slot creation tries a seeded reveal before waiting for the beacon.
  A failed seeded reveal through a relay propagates its error to preserve relay retries.
- KeyRegistry ABI includes seeded reveal methods, `commitSeedDigest`, and related
  events and errors.

## [0.1.0]

Initial release of `tasra-sdk`: a TypeScript access layer for the Tasra network.
