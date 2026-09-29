# How the application SDK connects to Tasra

New applications use `TasraClient` from `tasra-sdk/app`. A public manifest describes
the deployment; a wallet authorizes chain writes; a durable store retains private
operation state. The SDK then exposes:

- `slots.create`: persist the commitment, create the slot, wait for its key,
  deliver the committed rule and confirm the verifier policy.
- `identities` and `credentials`: create development DIDs, issue holder-bound
  credentials, define policy and present credentials for an exact operation.
- `wallets`: create/connect a wallet or adapt an ECDSA slot for confirmed transfers.
- Typed BLS/FROST/ECDSA handles: use the slot while checking its mode, authorization
  and the returned cryptographic result.

The network remains authoritative for credential acceptance and keeper execution.
The app still owns its business rules, user consent and protected storage. See
[Application API](application-api.md) and [recovery boundaries](application-api.md#recovery-boundaries).

## Advanced managed-session internals

The following describes the retained **exportable-key managed-session API**.
It is distinct from the current BLS identity-scoped tutorial, which extracts a
scoped identity capability and never assembles a master key in the application.

What `openSession` does internally, if you want to drive it yourself:

```ts
import {
  redeemCredential, fetchMpk, fetchAndAssembleKey,
  encryptEnvelope, toBytes, buildTasraText, hexToBytes,
} from 'tasra-sdk'

// 1. obtain a DCQL-gated JWT from the verifier
const {token: jwt} = await redeemCredential(verifierUrl, redemptionToken, 'did:example:alice')

// 2. assemble the slot's master key from k-of-n nodes (no node ever sees it whole)
const {mpkBytes, epoch} = await fetchMpk(nodeUrls[0], slotHex)
const msk = await fetchAndAssembleKey({urls: nodeUrls, jwt}, slotHex)

// 3. encrypt — publish buildTasraText(toBytes(env)) via any transport;
//    decrypt with `msk` on the way back
const env = encryptEnvelope(hexToBytes(slotHex), mpkBytes, aad, plaintextBytes, BigInt(epoch))
```

The master key only ever exists ephemerally, in your process — `Session.close()`
wipes it when you're done (if you hold a raw `msk` from `fetchAndAssembleKey`,
`msk.fill(0)` is the equivalent).

---

## Layering

```
the network ──────────────── keepers + verifiers + accountants + contracts, the source of truth
        ▲ HTTP / JSON-RPC
tasra-sdk (this repo) ───── manifest-based client + typed operations over protocol primitives
        ▲ composed by
your product ─────────────── a messaging app, a vault, a signer, an explorer — anything
```

License: Apache-2.0.

---

[Back to the README](../README.md) · [Documentation index](README.md)
