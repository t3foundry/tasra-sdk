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

For prepaid reservations, use `reserveApplicationPayment` from `@t3foundry/tasra-sdk/app` with
the original creator intent/session, explicit gas limits and one durable private store
shared by every caller of a dedicated gas payer. It serializes nonce selection across
slots/deployments on the same chain. An uncertain preparation holds that payer until
`reconcileApplicationPayment` verifies its original mined transaction; never remove a
journal or clear a claim based on age. It does not coordinate external wallet transactions
or submit cancellations. See `docs/funding.md` for the complete recovery contract.

Completed keeper result recovery uses `recoverKeeperExecution` with the original
payment, independently retained assigned worker and creator-certified local execution
signer. It reads canonical original creator, TASRA backing and eligible roster before
requesting a fresh client read signature, then verifies the worker evidence and exact
result commitment. Missing history, failed or interrupted work is refused. Never turn
a recovery refusal into another key operation or a replacement payment. The Node
`createNodeKeeperRecoveryTransport` permits only the two evidence/recovery POST paths
with verified TLS and socket destination checks; private results must not be logged.
Verify recovered cryptographic results against the original group key before use.

Paid application key operations require `execution: {certificate, signer}` from the
original creator-certified client, alongside the already reserved `payment` and fixed
presentation `random`. For direct keeper clients, construct `approveExecution` with
`createKeeperExecutionApprover` using independently selected contracts, expected payload
digest and original local signer. It rechecks canonical backing and current eligible
sharing before signing the complete body for assigned stages. Never forward the
execution seed to an agent or keeper, and never copy the expected digest from a proposal.

Paid dual-control uses `frostSlot.approvals({quorum, credentialGated, payment, execution})` to
pin the final Sign reservation and its assigned keeper. Each credential approval
needs a separate `dual-approve` payment and fixed presentation random; it binds the
paid approval bytes, including the final Sign commitment. Resume uncertain requests
using the original reservation ID and payment; do not mint replacement payments on timeout.

The SDK includes its wallet/chain runtime dependencies. Add `viem` directly only
when your application intentionally imports its advanced APIs. Only `/chain/node` imports Node TLS helpers;
keep it out of browser/extension bundles. Missing services in a manifest should
be reported explicitly; the manifest does not contain keys or bearer tokens.
