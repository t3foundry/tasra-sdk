# Use your slot

**Goal:** sign your first message with the existing slot and Alice's credential.
Finish [Give a user access](access-control.md) first.

Complete [Buy TASRA and fund your slot](funding.md) before signing. A ready key
and a funded creator wallet do not provide the slot's usage credits.

## Sign a message

```sh
cp node_modules/tasra-sdk/examples/learning-sign.ts .
npx tsc --noEmit
npx tsx learning-sign.ts
```

<!-- learning-sign-example -->
```ts
import {authorize} from './learning-authorize.js'
import {savedSlotId, tasra} from './learning-context.js'

const signer = await tasra.slots.frost(await savedSlotId())
const message = new TextEncoder().encode('I approve this first TASRA example.')
const result = await signer.sign(message, {authorize})
console.log('Signature verified:', result.signature)
console.log('Key epoch:', result.epoch)
```

**Success:** `Signature verified`, followed by the signature and key epoch.
The SDK requests authorization and verifies the returned signature.
For a real document, sign a statement containing its digest, version and request ID.
Keep that statement with the document.

## Choose what to build next

Each slot has one mode, chosen at creation. Your first slot uses `frost`.
Create a separate slot for a different kind of key.

| Application | Mode | Next tutorial |
|---|---|---|
| Document approval | `frost` | [Collect document signatures](document-signing.md) |
| Shared Ethereum account | `ecdsa` | [Let Alice and Bob send transactions](shared-account.md) |
| Private documents | `bls` | [Encrypt notes for an authorized reader](encrypted-notes.md) |

An Ethereum slot signs transactions from one address; that address needs funds for
transaction fees. Encryption uses a public key, while decryption requires permission.
Use a new access identity for each encrypted document version. Access expiry cannot
remove plaintext or decryption keys someone already holds.

You have connected, created, funded, inspected and used a slot.
Continue to [manage your slot](manage-slot.md) to renew it or cancel it when finished.
You can also choose one application tutorial above.
