# Read your slot

**Goal:** inspect the slot you created. This step makes no transactions and needs
no credential presentation.

## Check its state

Copy the reader into the same project:

```sh
cp node_modules/tasra-sdk/examples/learning-read-slot.ts .
npx tsc --noEmit
npx tsx learning-read-slot.ts
```

Open `learning-read-slot.ts`:

<!-- learning-read-slot-example -->
```ts
import {savedSlotId, tasra} from './learning-context.js'

const slotId = await savedSlotId()
const slot = await tasra.slots.get(slotId)
console.log('Slot:', slot.slotId)
console.log('Key ready:', slot.ready)
console.log('Key epoch:', slot.epoch)
console.log('Threshold:', slot.threshold)
```

**Success:** `Key ready: true`, followed by the key epoch and threshold.
The epoch identifies the slot's current key generation. `k` is the required
number of key holders; `n` is the number assigned to the slot.

The slot ID is loaded from your private lesson store. In a larger app, keep your
slot IDs with your application records. The application client does not have a
`slots.list()` method.

`slots.get()` checks that the slot exists and has not been cancelled. To inspect a cancelled
slot's record, use the registry reader shown in the next lesson.

**Next: [Control access →](access-control.md)**
