# Build with TASRA

**[Start here: build an account Alice and Bob can use](shared-account.md).**
A complete SDK-only app: create a slot, authorize each user, send real transactions,
and verify an unauthorized user is refused. [Compatibility](compatibility.md).

[Application API](application-api.md) · [Encrypted notes tutorial](encrypted-notes.md) · [Document-signing tutorial](document-signing.md) · [Native approvals](native-approvals.md)

## Build an app

| I want to… | Guide |
|---|---|
| Find Fuji addresses and the deployment manifest | [tasra-releases configuration](fuji.md) |
| Start with public registry reads | [Read-only quickstart](getting-started.md) |
| Install the SDK or check runtime support | [Installation](installation.md) |
| Encrypt data and authorize decryption | [Live encryption](encryption.md) |
| Create and provision a slot | [Slot setup](prerequisites.md#operator-setup) |
| Get an Ethereum address and sign transactions | [Ethereum signing](signing.md) |
| Use credential presentation or OAuth | [Authentication APIs](api.md#tasra-sdkoid4vp--credential-wallets-against-the-verifier-agent) |
| Encrypt identity-scoped messages or files | [IBE APIs](api.md#large-objects-under-ibe--ibesealblob--ibeopenblob) |
| Read contracts, discover keepers, or fund slots | [Chain APIs](chain.md) |
| Diagnose a failed request | [Errors and retries](errors.md) |

## Look something up

[API overview](api.md) · [Generated reference](reference/README.md) · [Capability catalogue](capabilities.md) ·
[Live configuration](prerequisites.md) · [Glossary](glossary.md)

## Understand the system

[Architecture](architecture.md) explains clients, sessions, and the network.
[Deployment responsibilities](DEVELOPER-EXPERIENCE.md) explains what the SDK,
CLI, and deployment supply.

## Build with a coding agent

[Application-building skills](../skills/README.md) provide task instructions for
connecting your application, creating slots, authorizing users and handling errors.
The same guides and examples work without an agent.

## Package information

[Migration guidance](consumer-migrations.md) · [Changelog](../CHANGELOG.md) ·
[Security policy](../SECURITY.md) ·
[Contribute to TASRA SDK](https://github.com/t3-foundry/tasra-sdk/blob/develop/CONTRIBUTING.md)
