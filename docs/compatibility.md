# SDK and deployment compatibility

A matching chain ID or an active manifest does not establish service compatibility.
Check the **operation and authorization route**, not just the displayed version.

| SDK / environment | Available scope | Before use |
|---|---|---|
| Candidate `0.3.0-next.0` + compatible local fleet | Typed application API; ECDSA, FROST and BLS slots; exact-operation credentials; native static-key and credential-gated approvals; strict IBE extraction and receipt checks | Install a packed checkout and check the capabilities below. The candidate is unpublished. |
| Published npm `0.2.2` | Existing package APIs; excludes `tasra-sdk/app`, `committeeSignEoaDigest` and the new complete application examples | The current application tutorials cannot run unchanged. |
| Current checkout + Fuji `tasra-fuji-v1` | Deployment manifest discovery, checksum validation and public contract reads | Services have not been upgraded for the current SDK application tutorials. Do not use Fuji for those signing, credential or decryption flows. |
| Another deployment or SDK revision | Compatibility depends on its contracts, services and authorization configuration | Confirm the deployment's supported SDK version and exercise the intended operation. |

The tutorials include public example addresses for a local deployment. Update those
values after a redeployment; local addresses are not portable deployment identifiers.
A service version string, package build or successful public read does not establish
that authorization, signing or decryption works. Check the intended operation and an
expected refusal with your own development credentials before relying on a deployment.

See [migration guidance](consumer-migrations.md) for changes to application code.

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
service rollout, confirm its supported SDK version and operation routes.

[Documentation index](README.md)
