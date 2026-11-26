---
name: tasra-chain
description: Load pinned Tasra deployment manifests and read public registry or slot state. Use for tasra-releases, Fuji configuration, keeper discovery, explorer queries, events and advanced chain integration.
compatibility: Requires @t3foundry/tasra-sdk to be installed (npm install @t3foundry/tasra-sdk)
metadata:
  package: @t3foundry/tasra-skills
  sources: "node_modules/@t3foundry/tasra-sdk/docs/fuji.md, node_modules/@t3foundry/tasra-sdk/docs/application-api.md, node_modules/@t3foundry/tasra-sdk/docs/chain.md, node_modules/@t3foundry/tasra-sdk/dist/chain/index.d.ts"
---

# Configure a deployment and read public state

Canonical public records are in https://github.com/t3foundry/tasra-releases.
For Fuji, fetch `networks/testnet/current.json` and the manifest it names,
`deployments/tasra-fuji-v1.json`, relative to that directory. Pin both to the same
reviewed repository commit. Verify the original manifest bytes using the trusted
pointer checksum with `parsePinnedNetworkManifest`, then call `addressBookFromManifest`.
The pointer and manifest must agree on network, chain and active status.
A checksum from an untrusted source does not establish authenticity.
`observeNetworkManifest` compares deployed code with the pinned record; it does
not certify keeper, issuer or authorization readiness. Confirm support for the
specific protected operation before using it.

Use the release manifest for all network configuration. Report missing services
explicitly and keep TLS verification enabled. Obtain creator funds from the
selected network's faucet or a wallet controlled by the user.

## Application reads

```ts
import {TasraClient, type ApplicationManifest} from '@t3foundry/tasra-sdk/app'

export async function inspectSlot(manifest: ApplicationManifest, slotId: `0x${string}`) {
  const tasra = new TasraClient({manifest, coordinator: 'lowest-operator-id'})
  return tasra.slots.get(slotId)
}
```

`new TasraClient({manifest})` validates manifest configuration; it does not authenticate
its source. `TasraClient.fromManifest(url, {sha256, coordinator})` downloads a release manifest
and checks an independently trusted digest. Supply the deployment’s coordinator
convention explicitly; it is not recorded in the release schema.
`tasra.check()` checks chain and registry code. `slots.get` returns metadata;
`(await tasra.slots.ecdsa(slotId)).getAddress()` reads an Ethereum address without
credentials. Pass `keeperUrl` only for an explicitly approved routing map.

## Advanced chain consumers

User-class registered relay writes require `sponsorship: {slotId, authorize}` and
durable `persistAttempt` / `resumeAttempt`. Approve the sponsorship slot and the
verifier-agent independently. The callback completes the wallet flow for the supplied
sponsor intent and returns a wire voucher for the original attempt; it must not sign
another forward request or reserve TASRA. Retain session recovery by `attempt.id`.
The relayer verifies committee signatures and revocation freshness. See
`docs/chain.md` for request binding, recovery and expired-voucher limits.

For every registered relay write, an unresolvable consumed nonce retains the original
attempt and signer fence, including after `reconcile()`. Preserve its journal and
investigate the outcome; never create a new signature to bypass missing history.

Explorer/indexer applications should keep `createTasraChainClient` and typed
readers/events from `@t3foundry/tasra-sdk/chain`. An existing read client may be injected into
`createTasra({deployment, chain})`; its registry addresses and chain must agree.
Use `assignedNodes` plus NodeRegistry records for the slot's keeper identities;
a configured URL list alone is not evidence of assignment.

Read [manifest, discovery, address-book and event details](references/advanced.md)
for these integrations. The SDK retains advanced writers, governance and metering
APIs; choose them by capability, not a fixed number of clients. `chainId` must be
explicit for the chosen deployment, and slot IDs are 32-byte hex strings.

Billing is metered. The slot owner deposits TSRA with `writer.fundSlot(slotId, amount)` and reads
`writer.settlementBalance(slotId)`; keepers serve authorized operations and the accountants settle
recorded usage later. There is no payment, reservation or execution-consent step in the SDK, and a
holder application needs nothing the owner holds. See `docs/funding.md`.

For many KEM decryptions under one presentation use `openDecryptSession` from
`@t3foundry/tasra-sdk/app` (`docs/encryption.md`). Its chain reads are exported from
`@t3foundry/tasra-sdk/chain`: `readSlotSharing` (a BLS slot's keepers and authenticated verifying
shares from the slot ID), `createSlotDrawReader` / `readSlotVerifierDraw` (a slot's verifier draw
as anchored on chain, with membership proofs from an accountant's snapshot artifact) and
`readCurrentBeaconEpoch` / `readBeaconDrawState`. `createNodeAgentTransport` (`/chain/node`)
carries verifier-agent sessions and the session grant's refresh and revoke.

Native approvals on FROST use `frostSlot.approvals({quorum, credentialGated})`. ECDSA, P-256 and
BLS operations carry an approval bundle (`prepareOperationApproval`, `approveDualOperation` or
`approveSigningIntent`, `assembleOperationApproval`) as `dualControl`; the statement binds the
chain, slot, operation, key epoch, payload digest and request hash. See `docs/native-approvals.md`.

The SDK includes its wallet/chain runtime dependencies. Add `viem` directly only
when your application intentionally imports its advanced APIs. Only `/chain/node` imports Node TLS helpers;
keep it out of browser/extension bundles. Missing services in a manifest should
be reported explicitly; the manifest does not contain keys or bearer tokens.
