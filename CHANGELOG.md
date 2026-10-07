# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package follows
semantic versioning with one pre-1.0 caveat: a minor bump may change the API, a patch
never does.

## [Unreleased]

### Fixed

- Local Hovi-profile certification now uses confirmed TASRA funding, registered
  paid sessions and original keeper approvals. P-256 credentials carry a status
  list signed by their issuer, with a separate durable allocation ledger. Snapshot
  readiness retries only absent-anchor reads; paid writes are never redelivered.

- OAuth DPoP proofs now bind the exact session response URL. `dpopHtu` requires
  the session ID; the explicit `legacyDpopHtu` helper retains the old target for
  pre-remediation integrations. Paid sessions refuse a legacy or different-session
  target and include the original session ID in verifier credential approval.

- Identity extraction completes after the first distinct, verified quorum and
  cancels unused requests. Invalid replies do not consume quorum capacity; failed
  and late decoded shares are cleared. The fan-out has a configurable 10-second
  default deadline and a 16 KiB response cap. Low-level collectors retain their
  collect-all behavior unless `threshold` is supplied; one-call IBE clients expose
  the same threshold, deadline, cancellation and keeper transport options.
- Update the root and documentation site locks to `source-map-js` 1.2.2 for
  GHSA-68fv-2mgg-jv7q; retain the existing native platform dependency metadata.
- Payment context discovery requires an approved `accountantSet` address and selects
  only a current or previous epoch with both verifier and accountant snapshots. This
  avoids reservation failures while the two role anchors are being published. All
  three registry beacon pointers must agree with the approved deployment.

### Added

- Expose the keeper's optional `NodeInfo.admin_auth` capability. `separate`
  reports an independent administrative issuer; `unconfigured` reports that
  administrative routes await operator configuration. An absent field is unknown.

- Add original-client keeper approvals to FROST, ECDSA, group decryption, IBE and
  paid dual-control creation. Application methods require the original execution
  certificate and signer; direct clients accept an independent chain approver.
  Complete outgoing bodies and assigned stage signatures are checked before dispatch.
  New source and genuine-signature regression cases await full SDK/native validation.
- Add completed keeper result recovery with a fresh signature by the original
  creator-certified client. Canonical historical creator, reserved TASRA and keeper
  roster checks precede signing; worker evidence and exact result commitments precede
  disclosure. The guarded Node transport permits only evidence and recovery POSTs.
  Reads neither start work nor submit a transaction, and never retry failed key work.
  New source and regression cases await the complete SDK and native validation gates.
- Add a guarded paid verifier-agent control transport for initialization, approvals
  and callback continuation, preserving consent/recovery HTTP statuses without
  automatic POST retries. OAuth artifacts use their own scoped POST and owner header.
- `prepareRegisteredPaidSession` authenticates the approved provider, checks original
  mined backing and canonical verifier policy, reconstructs complete client approval
  bodies and verifies wallet requests and completed quorum tokens. A lost creation
  reply is reconciled through an owner-authenticated read of the original context.
  OAuth proof preparation and submission retain the same original artifacts through
  uncertain outcomes. New source/regression coverage awaits full SDK/native gates.

- Client session initialization signatures bind the approved registered agent profile
  and complete client-built creation body, including its locally generated owner
  bearer. An identical request retains its session identity; initialization earns
  no operator fee and never exposes the private execution key.

- Client-owned execution certificate and stage approval helpers in
  `tasra-sdk/committee`. Creator consent binds a local Ed25519 public key to one
  payment; stage approvals bind the complete client-built body and independently
  authenticated operator. Private keys stay with the application. The helpers do
  not automatically authorize agent proposals or dispatch operations.

- `UnderfundedSlotError` identifies an exhausted slot during payment discovery and
  an accountant's HTTP 402 reservation refusal. It carries the slot ID and any
  observed available TASRA, without implying another transaction is safe to submit.

- Native dual-sign status exposes `uncertain` when a keeper has retained an execution
  latch without a terminal result. Approval stops without another signature request;
  polling raises `OperationOutcomeUnknownError` with the original request ID.
  Credential approval checks request status before requesting paid verification work.
- Payment intents support the distinct `dual-approve` billing action for credential
  approvals. It uses ordinal 6, preserving existing payment hashes, and cannot pay for
  a final keeper signature. Native dual-control clients carry a separate final Sign
  reservation, bind every approval to its commitment, and resume with the original
  reservation ID after an uncertain creation response. Application approval clients
  resolve the payment's assigned coordinator; credential approvals pay independently.
- Paid committee-token hashing and creator payment-intent helpers in `tasra-sdk/committee`.
  Wallet and OAuth session clients can carry an already reserved payment and its fixed
  presentation random. Session results reject changed or missing payment commitments.
  These helpers do not submit reservations or settle fees.
- `readSlotFunding`, `readPaidOperationReceipt` and `resolvePaidKeeperTarget` in
  `tasra-sdk/chain`: fresh canonical TASRA observations and discovery of the signed
  coordinator, including current sharing, registered identity and creator-signature checks.
  The bundled Settlement ABI now targets v2, including prepaid calls and the changed
  legacy settlement selectors with base cursors. Legacy v1 settlement writes require
  their version-specific ABI.
- `reservePaidOperation` requests matching accountant quotes, checks creator consent and
  canonical contract simulation, then submits one gas-capped reservation with mandatory
  durable recovery checkpoints. Uncertain outcomes retain the request ID and any known
  transaction hash; the helper never automatically resubmits or changes payment identity.
- Registered verifier-agent sessions preserve prepaid intent/random and reject changed
  audience, expiry, wallet nonce context or returned payment commitment. Paid discovery
  never falls back to another provider. Settled payments cannot route a new keeper operation.
- Application ECDSA, FROST and IBE methods accept a reserved payment and fixed presentation
  random. They check canonical backing before and after authorization, preserve the payment
  commitment and route only to its selected coordinator or contributors. Returned signatures
  and IBE shares retain the existing cryptographic verification.
- `createPaidReservationJournal` adapts a durable application store to reservation checkpoints,
  preserving creator intent, transaction and private session context. Exclusive preparation
  refuses duplicate attempts across processes; restart reads never authorize resubmission.
- `discoverPaidOperationContext` reads the current keeper assignment and anchored verifier
  context before creator signing. It checks approved beacon pointers, explicit verifier
  defaults, eligible workers and positive TASRA funding at one fresh canonical block.
  Discovery, funding and receipt helpers snapshot caller inputs before asynchronous reads.
- `reconcilePaidReservation` verifies a saved transaction after restart without resubmitting.
  It checks the complete transaction identity, historical creator consent, canonical inclusion,
  confirmation depth and exact reservation backing, including expired or already settled intents.
  Reverts report native gas separately and do not assert that no other reservation exists.
- `reserveApplicationPayment` coordinates reservations through a durable lock per chain and
  gas payer. Uncertain submissions block further reservations across process restarts;
  `reconcileApplicationPayment` releases the payer only after verifying the original mined
  transaction. A retained nonce floor refuses stale RPC nonces. All callers must share one
  store and a dedicated payer; unrelated wallet transactions are outside this coordination.

### Fixed

- Locally signed reservations are decoded and their signer, destination, calldata, chain,
  nonce, value and gas verified before broadcast. Gas-payer inputs are pinned before awaits;
  expiry is rechecked after signing. Lost or false RPC replies retain the computed hash in
  the uncertainty error, without retrying the transaction.

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

### Changed

- All 11 application-building skills lead with the current task workflow;
  specialized and compatibility details are available in supporting references.
- The shared-account tutorial always demonstrates durable prepared creation.
- The slot-provisioning example uses the creator's signature instead of an admin JWT.

### Fixed

- Keep recovery salts out of public tutorial evidence; select public creation
  references explicitly.
- Align note identity/result guidance with the API and include a complete standalone
  Node TypeScript configuration.
- Point skills and onboarding docs to the published Fuji deployment pointer,
  manifest checksum and service URLs in `t3-foundry/tasra-releases`; document
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
