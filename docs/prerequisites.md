# Prerequisites

For a first application, use the [quickstart](getting-started.md). New applications
connect from a public manifest and let the SDK create wallets, identities, credentials
and ready slots. No precreated learner account or slot is required.

## Network configuration

Use Node.js 24 and install `tasra-sdk@latest`. Download the network pointer and
manifest from [tasra-releases](https://github.com/t3-foundry/tasra-releases).
For Avalanche Fuji, use `networks/testnet/current.json`; resolve its `manifest`
path relative to `networks/testnet/`, and fetch both files from the same reviewed
commit. Verify the original manifest bytes against the pointer's trusted SHA-256.

Load the release with `TasraClient.fromManifest(manifestUrl, {sha256, coordinator})`.
The explicit coordinator convention must match the deployment. The SDK resolves
the RPC and configured verifier endpoint; it discovers assigned keepers from chain.
Do not invent missing service URLs. Keep TLS verification enabled.

## Accounts and protected operations

Create a wallet with `tasra.wallets.create()`, or connect an Ethereum provider with
`tasra.wallets.connect(provider)`. Save exported private keys in protected storage
before requesting funds. Fund the public creator address through the network's
faucet or a wallet you control. Creating a key does not fund it.

Supply the creator wallet and a durable store to `tasra.slots.create()`. The SDK
records the intent, creates the slot, waits for key generation, provisions its rule
and configures its verifier policy. Node applications can use `createFileStore`;
browser and database stores need atomic persistence and exclusive operation locks.

The selected deployment must support the requested mode, thresholds, authorization
format and service routes. Credential operations need an accepted issuer and
holder format. Slot-account gas and usage or lease charges are distinct from
creator gas. A healthy registry alone does not prove those requirements are met.

## Offline first result

```sh
npm install tasra-sdk@latest
npm install --save-dev tsx
npx tsx node_modules/tasra-sdk/examples/minimal.ts
```

Expected output: `Hello Tasra`. Public demo keys demonstrate local crypto only.
The example requires no network deployment or `viem`. Examples ship in the package.

<a id="application-configuration"></a>

## Advanced existing committee integrations

The SDK includes the chain runtime dependencies; install `viem` directly only if
your application imports it. The following advanced committee examples use a
provisioned **non-exportable BLS slot**,
an anchored verifier-set snapshot, sufficient metering funds, and a credential issued
to your holder DID. The application never needs keeper admin or issuer secrets.

| Environment variable | Value supplied by you or the deployment handoff |
|---|---|
| `KK_MANIFEST_FILE` | Local path to the exact downloaded deployment-manifest bytes |
| `KK_MANIFEST_SHA256` | SHA-256 from the trusted release checksum, not a digest invented from an untrusted download |
| `KK_RPC_URL` | RPC for the manifest's chain |
| `KK_SLOT_ID` | Provisioned BLS slot, 0x-prefixed bytes32 |
| `KK_HOLDER_KEY_FILE` | Private file containing a 32-byte Ed25519 holder seed as hex; examples derive its did:key |
| `KK_CREDENTIALS_FILE` | Private JSON file containing an array of issuer-signed compact-JWS credentials for that DID |
| `KK_VERIFIER_AUDIENCE` | Expected holder-proof audience published by the deployment |
| `KK_SIGN_SLOT_ID` | Separate FROST slot, required only for signing and live acceptance |

Keep key/credential files outside source control and readable only by their owner.
These Node examples use a file-backed holder; applications can instead supply the
SDK's `HolderSigner` callback backed by a wallet or key store.

```sh
npx tsx node_modules/tasra-sdk/examples/getting-started.ts
npx tsx node_modules/tasra-sdk/examples/committee-slot.ts
```

These direct committee examples require a slot with a verifier policy and a deployment
that accepts compound tokens without request binding. If keepers enforce
`api.require_request_binding`, use the verifier-agent authorization flow described in
[the wallet skill](../skills/tasra-oid4vp-wallet-and-verifier-agent/SKILL.md).
Do not weaken the deployment's policy to run an example.

The first command verifies a threshold encrypt/decrypt round trip. The second verifies
a threshold FROST signature. Missing inputs fail nonzero. Neither creates a network,
mints credentials, nor substitutes mock authorization.

<a id="operator-setup"></a>

## Advanced slot creation and provisioning

`examples/provision-slot.ts` creates a dedicated slot, persists recovery inputs before
submitting transactions, waits for DKG, and provisions the committed rule on keepers.
It selects commit/reveal when the registry requires it. Rule provisioning uses
`provisionRule` with the creator's own key; no admin JWT is required on compatible
fleets. For a complete tECDSA app, use the [shared-account tutorial](shared-account.md).

In addition to manifest/RPC configuration, provide:

| Variable | Meaning |
|---|---|
| `KK_CREATOR_KEY_FILE` | Private file containing a funded EVM key as 0x-prefixed hex |
| `KK_RULE_FILE` | Exact rule to commit and provision |
| `KK_SLOT_OUTPUT` | New recovery-record path; existing files are never overwritten |
| `KK_K`, `KK_N` | Threshold and keeper count |
| `KK_SLOT_MODE` | `bls` for encryption or `frost` for signing |
| `KK_CUSTODY` | `threshold`, or explicitly `exportable` for a personal BLS vault |

```sh
npx tsx node_modules/tasra-sdk/examples/provision-slot.ts
```

Preserve the recovery record even if provisioning fails. Follow deployment instructions
to fund metering, configure verifier policy, and enroll the holder before application use.
The example does not replace the deployment operator's lifecycle/recovery tooling.

## Exportable personal vault

An exportable slot is a separate custody choice. The holder can retain its master key;
revocation does not prevent future local decryption with that key. Deployments requiring
commit/reveal cannot create these slots with the current API, and the example refuses
that combination rather than weakening the registry requirement.

For an existing exportable BLS slot, configure the application inputs plus `KK_DCQL_RULE`
and run `examples/personal-vault.ts`. This example uses one-shot VP authentication;
it does not claim silent renewal.

[Deployment responsibilities](DEVELOPER-EXPERIENCE.md) · [Glossary](glossary.md)

## Gas and usage credit

Fund the creator wallet with AVAX for setup and token transaction gas. For Fuji,
use the [official C-Chain faucet](https://core.app/tools/testnet-faucet/?subnet=c&token=c).
Then buy TSRA with EURC from BondingCurve and deposit TSRA into each slot's
Settlement balance. Follow the runnable [funding guide](funding.md). An Ethereum
slot account additionally needs AVAX for its own transactions; this is separate
from creator gas and TSRA usage credit.
