# Tasra SDK

Build TypeScript apps that encrypt data and sign transactions through a distributed
keeper network. Use verifiable credentials to control who can decrypt or sign.

**[Start here: build an account Alice and Bob can use →](docs/shared-account.md)**

The complete TypeScript example creates a slot, issues development credentials,
and confirms transactions on a running local fleet. It uses the SDK directly, with
no CLI or operator secrets. Install the packed checkout: this example uses an
unpublished `0.3.0-next.0` candidate. [Compatibility](docs/compatibility.md).

**New candidate API:** [one application client, typed slots, viem signing and safe creation](docs/application-api.md).

## Install

```sh
npm install tasra-sdk viem
```

Node.js **22.12+**, ESM, and modern browsers with WebCrypto.
`viem` is needed for `tasra-sdk/app` and `tasra-sdk/chain`; install just `tasra-sdk` for local crypto.
[Installation and compatibility](docs/installation.md).

## What do you want to build?

| Your goal | Start here |
|---|---|
| Read the registry first (no writes) | [TypeScript quickstart](docs/getting-started.md) |
| Encrypt data and let credential holders decrypt it | [Live encryption guide](docs/encryption.md) |
| Create a slot for your app | [Complete application](docs/shared-account.md) |
| Store encrypted notes for one authorized holder | [Encrypted notes app](docs/encrypted-notes.md) |
| Collect Alice's and Bob's document signatures | [Document-signing workflow](docs/document-signing.md) |
| Require multiple approvers for one signature | [Native approval recipes](docs/native-approvals.md) |
| Get an Ethereum address and sign transactions | [Ethereum signing](docs/signing.md) |
| Add a credential wallet or OAuth login | [Authentication APIs](docs/api.md#tasra-sdkoid4vp--credential-wallets-against-the-verifier-agent) |
| Find an API or solve an error | [API reference](docs/reference/README.md) · [Errors](docs/errors.md) |

<a id="which-client-do-i-want"></a>

For client selection, see [Choose a client](docs/api.md#choose-a-client).

A **slot** is a network-managed key with an access rule. Use BLS slots for encryption,
FROST slots for FROST signatures, and tECDSA slots for Ethereum accounts.
[All capabilities](docs/capabilities.md) · [Documentation index](docs/README.md).

Deployment addresses and service URLs come from
[**tasra-releases**](https://github.com/t3-foundry/tasra-releases).
The [Fuji configuration guide](docs/fuji.md) loads `networks/testnet/current.json`
and its manifest from one pinned commit, then verifies the checksum. The current
SDK/service version is not deployed on Fuji; current live development uses a compatible local fleet.

## Try local encryption without a network

<details>
<summary>Optional: a complete offline TypeScript example</summary>

Install `tasra-sdk` and `tsx`, save this as `demo.ts`, and run `npx tsx demo.ts`.
It prints `Hello Tasra`. These are public demo keys; never use them for real data.
This checks local encryption only. For live authorization, use the
[live encryption guide](docs/encryption.md).

<!-- offline-example -->
```ts
import {encryptEnvelope, decryptWithMasterKey, hexToBytes} from 'tasra-sdk'

/** Public, fixed DEMO keys. Never encrypt a real secret with these. */
function offlineRoundTrip(): string {
  const msk = new Uint8Array(32)
  msk[0] = 1
  const mpk = hexToBytes('93e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb8')
  const identity = new TextEncoder().encode('demo')
  try {
    const envelope = encryptEnvelope(new Uint8Array(32), mpk, identity,
      new TextEncoder().encode('Hello Tasra'), 0n)
    return new TextDecoder().decode(decryptWithMasterKey(msk, envelope.ciphertext, identity))
  } finally {
    msk.fill(0)
  }
}

console.log(offlineRoundTrip()) // Hello Tasra
```

</details>

## Use with a coding agent

The package includes [task-based skills](skills/README.md). Follow their installation
instructions to register them with your agent, and refresh them after SDK upgrades.
The same guides and examples are available to developers without an agent.

## Project

Candidate **0.3.0-next.0**, unpublished. Existing imports remain available.
See [migration guidance](docs/consumer-migrations.md) and
[deployment compatibility](docs/compatibility.md) before upgrading.
Before 1.0, minor releases may change APIs; patches do not.
The package has [not had an independent cryptographic audit](SECURITY.md#cryptographic-posture).

[Contributing](https://github.com/t3-foundry/tasra-sdk/blob/develop/CONTRIBUTING.md) · [Changelog](CHANGELOG.md) ·
[Security](SECURITY.md) · [Apache-2.0 license](LICENSE)
