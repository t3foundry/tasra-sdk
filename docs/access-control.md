# Give a user access

**Goal:** prepare Alice to use the slot you created. Keep that slot active.

An **identity** identifies a person or application. A **credential** is a signed
statement about that identity. An **issuer** signs it. The slot's **policy** decides
which credentials permit an operation.

Our slot accepts membership credentials from the issuer saved during creation.
Giving Alice a credential from that same issuer lets her request a signature.
Creating an identity alone would not grant access.

## Prepare Alice

```sh
cp node_modules/tasra-sdk/examples/learning-authorize.ts .
npx tsc --noEmit
npx tsx learning-authorize.ts
```

The script restores your issuer, creates and saves Alice's identity, and issues a
fresh membership credential. It prepares this authorization callback:

```ts
const authorize = tasra.credentials.authorize({
  verifierAgentUrl: tasra.verifierAgentUrl, signer: creator.signer,
  identity: alice, credentials: [credential],
})
```

**Success:** Alice's credential is ready. No signing request has been sent yet.
The next lesson uses `authorize` for the exact message being signed.

<details>
<summary>Complete script and how permission is checked</summary>

<!-- learning-authorize-example -->
```ts
import {savedCreator, store, tasra} from './learning-context.js'

// Restore the issuer whose rule was committed when this slot was created.
const issuerKey = await store.load<Uint8Array>('issuer-key')
if (!issuerKey) throw new Error('Complete the create-slot lesson first')
const issuer = tasra.identities.create({seed: issuerKey})
const alice = await store.withLock('alice', async () => {
  const identity = tasra.identities.create({seed: await store.load<Uint8Array>('alice-key')})
  await store.save('alice-key', identity.exportPrivateKey())
  return identity
})
const credential = tasra.credentials.issue({
  issuer, holder: alice, type: 'urn:my-app:member', claims: {name: 'Alice'},
})
const creator = await savedCreator()
if (!tasra.verifierAgentUrl) throw new Error('The network manifest must advertise a verifier agent')

// Prepare the callback; credentials are presented only when an operation calls it.
export const authorize = tasra.credentials.authorize({
  verifierAgentUrl: tasra.verifierAgentUrl, signer: creator.signer,
  identity: alice, credentials: [credential],
})
console.log('Alice has a membership credential ready for the signing lesson.')
```

The network checks Alice's credential against the slot's committed rule. It must
support the credential format and issuer accepted by that rule. This tutorial's
command initiates consent; an interactive app should supply the callback's
`approve` option to display its own consent screen.

This is a membership example. A document-encryption policy additionally needs
scopes limiting which document identities the holder may decrypt.

</details>

OAuth sign-in and multiple-person approvals come later, under **Go deeper**.

**Next: [Use your slot →](signing-and-encryption.md)**
