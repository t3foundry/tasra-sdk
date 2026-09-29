# Build encrypted notes

Encrypt a private note and let Alice open it with her credential. Bob receives a
credential from the same issuer, but the slot policy gives him no access. The app
also proves that changing an encrypted byte fails authentication.

The complete application is [encrypted-notes.ts](../examples/encrypted-notes.ts).
It uses Node.js and `tasra-sdk`; no separate wallet or cryptography library is needed.

## 1. Create the project

Install Node.js **24**. The example downloads and checksum-verifies the testnet
manifest from [tasra-releases](https://github.com/t3-foundry/tasra-releases).
The deployment needs BLS key generation, creator-signed rule provisioning,
OID4VP with SD-JWT and `did:jwk` support, scoped identity extraction and keeper
receipts. It must support the requested 2-of-3 keeper and verifier policies and
provide any usage credits needed by the operations.

Use a macOS/Linux shell or WSL for these commands and the private file store.

```sh
mkdir my-encrypted-notes
cd my-encrypted-notes
npm init -y
npm pkg set type=module
npm install tasra-sdk@latest
npm install --save-dev tsx typescript @types/node
cp node_modules/tasra-sdk/examples/encrypted-notes.ts app.ts
cp node_modules/tasra-sdk/examples/tutorial-support.ts .
cp node_modules/tasra-sdk/examples/tutorial-negative.ts .
cp node_modules/tasra-sdk/examples/network.ts .
cp node_modules/tasra-sdk/examples/fund-slot.ts .
printf '.tasra/\nnode_modules/\n' > .gitignore
```

`network.ts` downloads the release pointer and verifies the manifest bytes.
`tutorial-support.ts` creates and privately saves fresh wallets and identities.
It prints the creator address and waits for you to fund it through the selected
network's faucet or your own wallet. `tutorial-negative.ts` submits an unauthorized
credential to test server refusal. The application creates its own slot.

## 2. Check and run

Before protected operations, the terminal example pauses for **TSRA usage credit**.
In a second terminal in the same project, run its printed `fund-slot.ts ... status`
command. Follow [Fund a slot](funding.md) to obtain EURC, buy TSRA from BondingCurve,
and deposit TSRA into the printed slot. Replace `.tasra/first-slot` in those commands
with this app's printed directory. Fund every new slot; creator AVAX pays gas and
does not provide usage credits. Keep the app running while funding. After its
15-minute wait expires, a new run creates fresh accounts and slots; funding
the old slot does not resume the exited run.


Typecheck on any platform:

```sh
npx tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --resolveJsonModule app.ts
```

Run the application and fund the printed creator address on the selected chain
within its 15-minute funding wait:

```sh
npx tsx network.ts
npx tsx app.ts
```

Expect a final `PASS: Alice decrypted, Bob refused by verifier, tamper rejected.`
The app prints the new private directory and its `evidence.json` path. It creates
all its own identities, credentials and slot; no existing learner account or slot
ID is required. Every full run creates fresh state.

## 3. Read the code

1. **Create identities and credentials.** `tasra.identities.create()` creates each
   person. `tasra.credentials.issue()` gives them a document-scoped credential.
2. **Create the slot.** `tasra.credentials.policy()` pins the issuer, Alice's DID,
   role and document scope. `tasra.slots.create()` saves the intent, commits and
   reveals it, waits for the 2-of-3 BLS key, and provisions the policy.
3. **Encrypt and open.** `notes.encrypt(identity, bytes)` uses the public key.
   `notes.decrypt(identity, ciphertext, {authorize, requireReceipts: true})`
   verifies Alice's operation authorization, keeper quorum and receipts.
4. **Check failures.** Bob's credential is submitted to the real verifier.
   The tamper test first decrypts the original ciphertext successfully with an
   extracted key, then requires the exact authentication-tag failure for the
   changed ciphertext. Network failures do not count as a passing tamper test.

Private keys, credentials and durable SDK journals stay below `.tasra/`. Only
`evidence.json` is intended for review: it contains transaction references,
receipt references and the three test outcomes. Do not publish the whole directory.

An extracted identity key remains a decryption capability after a credential
expires. Give each immutable document version a fresh identity. The SDK reports
anchored-group assurance, not independently certified per-keeper verifying shares.

`npx tsx network.ts` saves the verified manifest and its checksum pin. Keep both
files with the application so restarts use the same deployment. The examples use
`lowest-operator-id` as the explicit coordinator convention; confirm it matches
the selected service. Fund each newly printed creator address with at least one
native token on the selected chain before continuing.
