# Deployment responsibilities

The SDK supplies application operations for wallets, credentials, slot creation,
signing and encryption. A usable application also needs a compatible deployment,
funding, an access policy and protected state storage.

| Component | Responsibility |
|---|---|
| Deployment | Reachable contracts and services, network manifest, supported modes and authorization formats, funding and issuer configuration. |
| SDK | Manifest loading, wallet adapters, slot commitments and provisioning, credential operations, cryptographic checks and durable operation journals. |
| Application | Access policy, consent, storage protection, issuer trust, funding decisions and results shown to users. |
| CLI | Optional command-line diagnostics and lifecycle operations. It is not required for SDK applications. |

## Configure and check an application

1. Install `tasra-sdk@latest` and retain the lockfile.
2. Download the network pointer and manifest from
   [tasra-releases](https://github.com/t3-foundry/tasra-releases) at one reviewed
   commit. Verify the pointer's trusted checksum against the exact manifest bytes.
3. Construct `TasraClient` with the release manifest and the deployment's coordinator
   convention. Run `check()` to verify chain identity and registry availability.
4. Create a wallet and private durable store. Fund the creator's public address
   through the network's faucet or a wallet you control.
5. Create identities and credentials, define the access policy and call `slots.create`
   with a stable name and the intended mode and thresholds.
6. Execute the protected operation and verify the result. Test an expected refusal
   separately; a local validation error is not evidence of verifier enforcement.

Keep the same wallet, manifest, named request and store when resuming. Recorded
transaction hashes are reconciled; a submission without a known hash needs
investigation before another submission. Do not delete journals to force progress.
Expired commitments and abandoned store locks have no automatic recovery path.

## Deployment inputs

- Network manifest, chain ID, reachable RPC and service URLs, contract addresses,
  coordinator convention and trusted checksum information.
- Supported SDK and service versions, key modes, authorization formats and optional routes.
- Funding mechanisms for creator gas, Ethereum account transactions and usage or leases.
- Accepted issuer and holder formats, issuer enrollment and revocation behavior.
- Compatible CLI binaries and checksums, when a command-line workflow needs them.

New slots may pin an application-controlled issuer when the verifier supports that
issuer and credential format. Existing policies may require enrollment with an
external issuer. Creating an identity does not enroll it with another organization.

Until the committed rule is provisioned, keepers refuse protected operations.
`slots.create` performs this step. Advanced callers can use `provisionRule` with
the creator's own signature; no keeper administrator secret is required.

## Record evidence of behavior

Record the package artifact, deployment identity, successful operation, expected
refusal and relevant transaction or request references. Keep private keys,
credentials, grants and recovery journals out of public evidence.

A build, registry read or working user interface does not establish signing,
decryption, credential acceptance or revocation. Test each required behavior on
the selected deployment. Revocation tests must allow for the issuer's documented
propagation and token-expiry window; signature verification alone is insufficient.

[Documentation index](README.md)
