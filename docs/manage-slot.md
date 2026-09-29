# Manage your slot

**Goal:** understand the slot lifecycle: create, read, renew and cancel.
A slot is an on-chain resource, so cancellation preserves its history.

| Action | SDK operation |
|---|---|
| Create | `tasra.slots.create(...)` |
| Read | `tasra.slots.get(slotId)` |
| Update its lease | `lifecycle.renewSlot(slotId)` |
| Stop using it | `lifecycle.cancelSlot(slotId)` |

The creator wallet performs management transactions. A user's signing credential
does not grant these administrative rights.

## Renew the lease

Run this when you want to extend the slot's lifetime. Renewal is a transaction
and needs native tokens for gas. Each execution requests another renewal.

```sh
cp node_modules/tasra-sdk/examples/learning-renew-slot.ts .
npx tsc --noEmit
npx tsx learning-renew-slot.ts
```

<!-- learning-renew-slot-example -->
```ts
import {createTasraWriteClient} from 'tasra-sdk/chain'
import {savedCreator, savedSlotId, tasra} from './learning-context.js'

const slotId = await savedSlotId()
const creator = await savedCreator()
const lifecycle = createTasraWriteClient({...tasra.deployment, wallet: creator.wallet})
const before = await tasra.chain.readers.keyRegistry.getKeySlot(slotId)
const transaction = await lifecycle.renewSlot(slotId)
const after = await tasra.chain.readers.keyRegistry.getKeySlot(slotId)
console.log('Confirmed transaction:', transaction)
console.log('Previous lease expiry:', before.expiry)
console.log('Current lease expiry:', after.expiry)
```

**Success:** a confirmed transaction hash and the previous/current lease expiry.
The chain writer handles administration; `TasraClient.slots` handles application use.

## Cancel when finished

Keep the slot active if you want to use it in the next lessons.
Cancellation is final for this slot; it does not erase historical data or previously
exported keys.

<details>
<summary>Show cancellation commands and code</summary>

```sh
cp node_modules/tasra-sdk/examples/learning-cancel-slot.ts .
npx tsc --noEmit
npx tsx learning-cancel-slot.ts --confirm-cancel
```

<!-- learning-cancel-slot-example -->
```ts
import {createTasraWriteClient} from 'tasra-sdk/chain'
import {savedCreator, savedSlotId, tasra} from './learning-context.js'

if (!process.argv.includes('--confirm-cancel')) throw new Error('Cancellation is final. Add --confirm-cancel only when finished with this slot.')
const slotId = await savedSlotId()
const creator = await savedCreator()
const lifecycle = createTasraWriteClient({...tasra.deployment, wallet: creator.wallet})
console.log('Confirmed transaction:', await lifecycle.cancelSlot(slotId))
// Cancelled slots remain visible in the registry's historical record.
const record = await tasra.chain.readers.keyRegistry.getKeySlot(slotId)
console.log('Cancelled:', record.cancelled)
```

**Success:** `Cancelled: true`. The registry reader still returns the record;
`tasra.slots.get()` rejects a cancelled slot.

</details>

<details>
<summary>What about changing the key or access rule?</summary>

There is no generic `slots.update()` or `slots.delete()`. Key rotation and resharing
are advanced operations. The verifier policy is set once. Access-rule amendments
require authority configured at creation; the basic slot's rule is fixed.
See [advanced application behavior](application-api.md) when you need those controls.

Renew/cancel do not use the creation workflow's durable journal. Keep returned
transaction hashes. If a request fails after submission, reconcile it before
retrying; a timeout does not prove that the transaction failed.

</details>

**Next: [Build an app →](README.md#build-an-app)**
