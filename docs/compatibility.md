# SDK and deployment compatibility

Install the SDK with `npm install tasra-sdk@latest`. Select a network from
[tasra-releases](https://github.com/t3-foundry/tasra-releases), download its deployment
manifest and verify the release checksum before configuring the client.

A manifest identifies contracts and services. An active record, matching chain ID,
or successful registry read does not establish support for a protected operation.
Confirm the required routes and authorization formats for the selected deployment.

| Operation | Required deployment support |
|---|---|
| Public registry and slot reads | Reachable RPC and the contracts named by the manifest. |
| Create a slot | Compatible registry, funded creator, requested keeper mode and threshold, distributed key generation, creator-signed rule provisioning and verifier-policy configuration. |
| Credential authorization | OID4VP verifier agent, accepted issuer and holder formats, verifier membership proofs and operation-bound grants. |
| OAuth authorization | OAuth verifier sessions, a supported issuer and audience, DPoP-bound tokens and an OAuth slot policy. |
| Ethereum transactions | tECDSA signing route, ready slot, operation authorization and native gas at the slot account. |
| Document signing | FROST signing route and the required authorization and receipt support. |
| Identity-based decryption | BLS identity extraction, scope enforcement and required receipt support. |
| Native approvals | FROST approval lifecycle and the selected static-key or credential-gated approval policy. |

The runnable examples request 2-of-3 keeper and 2-of-3 verifier thresholds. The
deployment must have enough eligible members and support the chosen slot mode.
They create SD-JWT credentials bound to fresh `did:jwk` identities; the verifier
must accept those issuer and holder formats and the policy's pinned issuer.

Creator gas, a slot account's spendable balance, and any usage or lease charges are
separate. Fund each required balance through the selected network's published
funding mechanism. A funded account does not authorize signing or decryption.

Before using a workflow, execute its intended operation and an expected refusal
with your application's policy. Record the deployment identity, installed package
version and observed results. An unavailable route is an unsupported or unavailable
operation; do not substitute another authorization route or disable checks.

[Documentation index](README.md)
