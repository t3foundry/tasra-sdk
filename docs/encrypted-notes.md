# Build encrypted notes

Make a BLS slot, encrypt a note, and let Alice decrypt it through a credential-bound
keeper quorum. Prove Bob is refused by the verifier and modified ciphertext fails.
The complete app is [encrypted-notes.ts](../examples/encrypted-notes.ts).

## Run it from a new TypeScript project

Follow [candidate installation and local-fleet setup](shared-account.md#1-prepare-the-sdk-and-local-fleet),
then install the packed `0.3.0-next.0` candidate, viem and tsx in an ESM project.
Copy `node_modules/tasra-sdk/examples/encrypted-notes.ts` to `app.ts` and copy the
public `local-fleet-ca.pem` beside it. Add `.tasra/` to your `.gitignore`.

```sh
NODE_EXTRA_CA_CERTS=local-fleet-ca.pem npx tsx app.ts
```

The file contains the complete public configuration, development issuer, creator
wallet, funding and provisioning steps. No other project's script or private
operator configuration is needed. A compatible running local fleet is required.

## Read the app in three steps

1. **Prepare the policy.** The app creates a synthetic issuer and separate holders.
   Alice's rule pins that issuer, subject and role, and declares the identity-scope
   claim. A random note/version identity is inside the issuer's namespace. The SDK
   saves the creation intent before committing and revealing a 2-of-3 BLS slot.
2. **Encrypt and open.** `tasra.slots.bls(slotId).encrypt(identity, bytes)` uses the
   on-chain public key. `decrypt(identity, ciphertext, {authorize, requireReceipts:
   true})` requests Alice's operation-bound grant and verifies a distinct keeper
   quorum, the anchored group key and every returned operation receipt.
3. **Prove refusals.** The app deliberately submits Bob's credential to the server,
   rather than counting a wallet's local filtering as proof. It also flips one
   ciphertext byte and checks authenticated decryption fails.

The app writes private recovery data beneath `.tasra/encrypted-notes-*`. Its public
`evidence.json` contains outcomes and receipt references, not credentials or extracted
keys. Do not publish that directory wholesale.

An identity key is a durable decryption capability; token expiry
does not revoke an already extracted key. Give each new immutable version a fresh
identity. The SDK reports anchored-group assurance and does not claim independently
certified per-keeper verifying shares.
