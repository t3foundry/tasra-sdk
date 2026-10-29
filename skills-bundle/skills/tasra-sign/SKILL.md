---
name: tasra-sign
description: Use typed Tasra slots for Ethereum or FROST signing and credential-controlled decryption. Use for an EVM address, viem account, shared account, document signatures, or choosing between two signatures and native approval quorum.
compatibility: Requires @t3foundry/tasra-sdk to be installed (npm install @t3foundry/tasra-sdk)
metadata:
  package: @t3foundry/tasra-skills
  sources: "node_modules/@t3foundry/tasra-sdk/docs/application-api.md, node_modules/@t3foundry/tasra-sdk/docs/document-signing.md, node_modules/@t3foundry/tasra-sdk/docs/native-approvals.md, node_modules/@t3foundry/tasra-sdk/dist/app/index.d.ts"
---

# Sign with a typed slot

Use the `@t3foundry/tasra-sdk/app` interface for new applications. The installed
`docs/application-api.md` describes configuration and authorizers; complete sources
are under `examples/`. Do not lead an operation-bound application through bearer-JWT
session signing. Existing JWT/ethers and custody APIs are advanced compatibility paths.

## Ethereum wallet and durable transfers

```ts
import type {TasraClient, OperationAuthorizer, ApplicationStore} from '@t3foundry/tasra-sdk/app'

export async function sendPayment(tasra: TasraClient, slotId: `0x${string}`,
  to: `0x${string}`, authorize: OperationAuthorizer, store: ApplicationStore) {
  const wallet = await tasra.wallets.fromSlot(slotId, {authorize})
  return wallet.transfer('invoice-42', {to, value: 1n}, store)
}
```

The wallet adapter handles transaction preparation, exact-operation authorization,
verified signing, durable storage and submission. Reusing the same operation name
and request reconciles recorded state; do not change the request or generate a new
name to bypass an uncertain outcome. Fund the slot account's gas before sending.
Read its public address with `(await tasra.slots.ecdsa(slotId)).getAddress()`.

For applications already using viem, `toViemAccount` remains an explicit adapter
choice and supports message, typed-data and transaction signing. That advanced
path leaves broadcast and transaction persistence with the application.

`examples/shared-account.ts` creates one slot where **Alice OR Bob** may sign a
zero-value self-transfer, confirms both transactions and sends Mallory's deliberately
nonmatching presentation to the real verifier. A user quorum is not enforced by a
DCQL `values: [alice, bob]` list.

## Document signatures

```ts
import type {TasraClient, OperationAuthorizer} from '@t3foundry/tasra-sdk/app'

export async function signDocumentStatement(
  tasra: TasraClient, slotId: `0x${string}`, statement: Uint8Array, authorize: OperationAuthorizer,
) {
  const slot = await tasra.slots.frost(slotId)
  return slot.sign(statement, {authorize, requireReceipt: true})
}
```

The document example freezes the PDF digest, request ID, version, chain and assigned
signer slots into one statement. Alice and Bob use **separate** FROST slots and
holder-bound authorizations. Completion requires both independently verified
signatures over the same statement. Verify against expected signer assignments and
anchored keys, not arbitrary keys supplied by a downloaded bundle.

`examples/document-signing/` and `docs/document-signing.md` provide the web app:
PDF upload/preview, separate browser wallets, persistent requests, and verified
downloads. Preserve the frozen request and attempt ID before submission; duplicate
completion returns the saved proof. Interrupted submissions require reconciliation,
not automatic re-signing. Keep sender capability and wallet files private.
`examples/document-signing.ts` is the smaller terminal recipe. Neither example
provides trusted timestamps or archival verification across key rotations.
For **one** FROST signature requiring a native approver quorum, use
`tasra-committee-path` and `examples/credential-approvals.ts` instead.
