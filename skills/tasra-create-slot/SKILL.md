---
name: tasra-create-slot
description: Create and provision a Tasra slot using a durable creation journal; resume known transactions and reconcile uncertain submissions. Also covers advanced funding, relay and lifecycle operations when requested.
metadata:
  package: tasra-sdk
  sources:
    - docs/application-api.md
    - examples/encrypted-notes.ts
    - dist/app/creation.d.ts
    - dist/chain/write.d.ts
---

# Create and recover a slot

For the candidate application path, use `prepareSlot` and `createPreparedSlot` from
`tasra-sdk/app`. Configure the actual deployment first using `tasra-getting-started`.
Decide the credential issuer, subject policy and any IBE scope before creating the
slot. A keeper threshold is not a number of human approvals.

```ts
import {prepareSlot, createPreparedSlot, type TasraDeployment,
  type SlotCreationJournal} from 'tasra-sdk/app'
import type {CreateSlotArgs, WriteClientWalletConfig} from 'tasra-sdk/chain'

export async function createKey(
  deployment: TasraDeployment,
  wallet: WriteClientWalletConfig['wallet'],
  rule: string,
  mode: CreateSlotArgs['mode'],
  persist: (journal: SlotCreationJournal) => Promise<void>,
) {
  const journal = prepareSlot(deployment, wallet.account.address, {
    dcqlRule: rule, mode, authType: 'oid4vp', k: 2, n: 3,
  })
  return createPreparedSlot(journal, {wallet, persist})
}
```

`persist` must atomically save each private snapshot before resolving. Serialize
writers for an intent, retain all salts and transaction hashes, and keep this data
out of public evidence. `examples/encrypted-notes.ts` includes the complete Node
store with fsync and atomic rename; browser storage needs equivalent durability
and concurrency control.

Creation uses commit/reveal and returns after on-chain creation. It does **not**
complete DKG, provision the rule or enroll a credential holder. Continue with:

1. Await the anchored group key with a bounded timeout and verify the requested mode.
2. Resolve assigned keeper URLs from chain; apply only the app's approved local route map.
3. Call `provisionRule` from `tasra-sdk/chain` with the creator signature and the exact
   saved rule/salt. No operator/admin JWT is needed.
4. Configure the verifier policy for protected operations. Check available verifier
   count before choosing committee/quorum. Configure native approvers separately
   if required; `tasra-committee-path` describes that workflow.
5. Fund gas and, on metered deployments, slot usage. Gas funding is not usage funding.
   Current local examples explicitly rely on the development fleet's metering setup.
6. Obtain a typed slot handle and perform a real authorized operation.

The complete implementation is in `examples/encrypted-notes.ts` and
`examples/document-signing.ts`. For an Ethereum account select creation mode
`tecdsa`; the application's corresponding handle is `slots.ecdsa`.

## Resume the same intent

Load the last persisted journal and pass it to `createPreparedSlot` with the same
wallet/deployment and durable store. Known commit/reveal hashes are reconciled,
not resubmitted. `CreationReconciliationRequiredError` means a submission may have
happened without a recorded hash: inspect the wallet/chain, recover that transaction,
and reconcile the journal. Do not delete the journal or generate a replacement slot.
Aborting local work cannot cancel an already submitted transaction.

## Advanced operations

For relay/sponsorship, funding curves, rotation, cancellation or deployments that
need low-level one-shot creation, read [advanced lifecycle and compatibility details](references/advanced.md).
Those primitives remain available; their older return-value persistence examples
are not a substitute for the new journal's crash-recovery contract.
