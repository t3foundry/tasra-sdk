# SDK and deployment compatibility

A matching chain ID or an active manifest does not establish service compatibility.
Check the **operation and authorization route**, not just the displayed version.

| SDK / environment | Verified behavior | Status |
|---|---|---|
| Current checkout (package metadata `0.2.2`, unreleased changes) + documented local fleet | Fresh slot creation, creator rule provisioning, credential presentation, request-bound ECDSA signatures, Alice/Bob receipts, server-side Mallory refusal | [Live proof](evidence/shared-account/README.md); install a packed checkout |
| Published npm `0.2.2` | Does not include the new `committeeSignEoaDigest` helper or shared-account example | Cannot run the new walkthrough unchanged |
| Current checkout + Fuji `tasra-fuji-v1` | Manifest download/checksum and public contract reads | Services have not been upgraded for the current SDK walkthrough; signing and credential flows are not certified |
| Any other local fleet, SDK revision, or deployment | Not established by these results | Rerun the acceptance check |

The latest accepted local run is dated **2026-09-26**, after a fleet redeployment.
The tutorial contains that deployment's public addresses.

The recorded local keeper version string alone is not a sufficient compatibility
pin. The proof records deployment addresses, observed service versions, SDK source
commit/dirty state, example hash, and packed artifact hash. The two chain receipts
are the evidence for the operations actually executed.

## Required local-fleet capabilities

The shared-account example needs:

- Local chain **43112**, funded public development account, and the specified registries.
- At least three tECDSA keepers, with 2-of-3 key generation/signing enabled.
- Creator-signed `POST /v1/keys/:slot/rule/by-creator` provisioning.
- An OID4VP verifier agent, trusted verifier-set snapshot, and a 3-member/2-signature policy.
- Ed25519 `did:jwk` issuer/holder resolution and SD-JWT credential presentation.
- `POST /v1/committee/sign/eoa-digest`, accepting request-bound compound tokens and verifier proofs.
- Development metering configuration permitting the operations without an additional slot-funding step.

The app funds creator gas and the slot account's transaction gas. If another fleet
charges metering, its slot funding step is also required; gas funding does not cover it.
The example does not disable verifier policy, holder binding, certificate checks, or authorization.

For public deployment records, use the [Fuji manifest guide](fuji.md). For a newer
service rollout, refresh the compatibility evidence before describing it as supported.

[Documentation index](README.md)
