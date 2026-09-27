---
name: tasra-chain
description: Load pinned Tasra deployment manifests and read public registry or slot state. Use for tasra-releases, Fuji configuration, keeper discovery, explorer queries, events and advanced chain integration.
metadata:
  package: tasra-sdk
  sources:
    - docs/fuji.md
    - docs/application-api.md
    - docs/chain.md
    - dist/chain/index.d.ts
---

# Configure a deployment and read public state

Canonical public records are in https://github.com/t3-foundry/tasra-releases.
For Fuji, fetch `networks/testnet/current.json` and the manifest it names,
`deployments/tasra-fuji-v1.json`, relative to that directory. Pin both to the same
reviewed repository commit. Verify the original manifest bytes using the trusted
pointer checksum with `parsePinnedNetworkManifest`, then call `addressBookFromManifest`.
The complete bootstrap is in installed `docs/fuji.md` and `examples/connect-fuji.ts`.

A checksum from an untrusted source does not establish authenticity.
`observeNetworkManifest` compares deployed code with the pinned record; it does not
certify keeper/credential service readiness. The current candidate's protected
operations are tested on the local fleet, **not Fuji**.

For the local fleet, use the example's public chain/RPC/addresses and development
CA, checking current deployment identity before writes. There is no shipped public
fleet launcher yet. A missing environment is a blocked check, not permission to
read an unrelated private demo config or invent service routes.

## Application reads

```ts
import {createTasra, type TasraDeployment} from 'tasra-sdk/app'
import type {Hex} from 'viem'

export async function inspectSlot(deployment: TasraDeployment, slotId: Hex) {
  const tasra = createTasra({deployment})
  return tasra.slots.get(slotId)
}
```

`defineDeployment` validates descriptor shape; it does not authenticate its source.
`tasra.check()` checks chain and registry code. `slots.get` returns metadata;
`(await tasra.slots.ecdsa(slotId)).getAddress()` reads an Ethereum address without
credentials. Pass `keeperUrl` only for an explicitly approved routing map.

## Advanced chain consumers

Explorer/indexer applications should keep `createTasraChainClient` and typed
readers/events from `tasra-sdk/chain`. An existing read client may be injected into
`createTasra({deployment, chain})`; its registry addresses and chain must agree.
Use `assignedNodes` plus NodeRegistry records for the slot's keeper identities;
a configured URL list alone is not evidence of assignment.

Read [manifest, discovery, address-book and event details](references/advanced.md)
for these integrations. The SDK retains advanced writers, governance and metering
APIs; choose them by capability, not a fixed number of clients. `chainId` must be
explicit for the chosen deployment, and slot IDs are 32-byte hex strings.

Install `viem` for `/chain` and `/app`. Only `/chain/node` imports Node TLS helpers;
keep it out of browser/extension bundles. Missing services in a manifest should
be reported explicitly; the manifest does not contain keys or bearer tokens.
