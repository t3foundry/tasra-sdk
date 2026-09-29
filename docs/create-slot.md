# Create your first slot

**Goal:** create one slot for signing documents. Continue in the project from
[Connect to TASRA](getting-started.md).

A creator wallet pays for setup. An issuer identity defines whose membership
credentials this slot will accept. This lesson saves both so the same command
can resume the same slot.

## 1. Add the lesson files

```sh
cp node_modules/tasra-sdk/examples/learning-context.ts .
cp node_modules/tasra-sdk/examples/learning-create-slot.ts .
```

This file-store example runs on macOS, Linux or WSL.

Add `.tasra/` to your project's `.gitignore`. This directory holds private keys
and recovery state; keep it private.

## 2. Read the creation step

Open `learning-create-slot.ts`. Its main operation is:

```ts
const slot = await tasra.slots.create({
  name: 'first-document-signer', mode: 'frost', policy,
  threshold: {k: 2, n: 3}, verifiers: {committee: 3, quorum: 2},
}, {wallet: creator, onProgress: ({step, phase}) => console.log('Slot creation:', step, phase)})
```

`frost` selects document signing. The example uses two of three key holders and
two of three authorization verifiers. The selected network must support these
settings, FROST and credential authorization. Connection alone does not establish this.

## 3. Fund your account and create

```sh
npx tsc --noEmit
npx tsx learning-create-slot.ts
```

The first run prints your new creator address. Fund it on the selected network
with AVAX using the [official Fuji C-Chain faucet](https://core.app/tools/testnet-faucet/?subnet=c&token=c)
or your own wallet, then run the command again.
The creator account needs enough AVAX for setup gas; a nonzero balance may still be insufficient.

**Success:** `Slot ready: 0x…`. This means its key and policy are ready. The SDK saves
the slot ID; you will not copy it between lessons.

## 4. Add usage credit

[Fund the slot](funding.md): obtain EURC, buy TSRA from BondingCurve, then deposit
TSRA into this slot's Settlement balance before signing. AVAX in the creator
wallet pays gas; it does not provide the slot's usage credit.

<details>
<summary>What the complete script does</summary>

<!-- learning-create-slot-example -->
```ts
import {store, tasra} from './learning-context.js'

// Save fresh keys before the first network write; later runs reuse them.
await store.withLock('lesson', async () => {
  const creator = tasra.wallets.create({privateKey: await store.load<`0x${string}`>('creator-key')})
  await store.save('creator-key', creator.exportPrivateKey())
  console.log('Creator address:', creator.address)
  if (await tasra.chain.client.getBalance({address: creator.address}) === 0n) {
    console.log('Fund this creator address with AVAX on the selected network, then run again.')
    return
  }

  const issuer = tasra.identities.create({seed: await store.load<Uint8Array>('issuer-key')})
  await store.save('issuer-key', issuer.exportPrivateKey())
  const policy = tasra.credentials.policy({issuer, type: 'urn:my-app:member'})

  // One named signing slot, ready for later document-signing lessons.
  const slot = await tasra.slots.create({
    name: 'first-document-signer', mode: 'frost', policy,
    threshold: {k: 2, n: 3}, verifiers: {committee: 3, quorum: 2},
  }, {wallet: creator, onProgress: ({step, phase}) => console.log('Slot creation:', step, phase)})
  await store.save('slot-id', slot.slotId)
  console.log('Slot ready:', slot.slotId)
  console.log('Before signing: buy TSRA with EURC and fund this slot. Follow node_modules/tasra-sdk/docs/funding.md.')
})
```

The [shared context](../examples/learning-context.ts) loads the manifest you downloaded,
opens the private store and prevents accidental reuse on another manifest snapshot.
Creation saves progress, creates the key, delivers the access rule and configures
its verifier policy. The optional `onProgress` callback reports these stages,
including public transaction hashes when available. Progress is observational:
callback errors do not stop creation, and a resumed run reports the stages it
actually visits again. Keep the durable store even when displaying progress.

Keep the same name, keys, request, manifest and store to resume. Changing the request
is not an update. After an uncertain submission or stale lock, preserve the state
and follow [recovery guidance](application-api.md#recovery-boundaries).

</details>

**Next: [Fund your slot →](funding.md)**
