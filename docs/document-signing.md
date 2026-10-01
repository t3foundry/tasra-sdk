# Build a small document-signing app

Build **Tasra Sign**: upload a PDF, invite Alice and Bob, collect their approvals,
and download a verifiable signature bundle. This is a working TypeScript web app
with separate signer wallets and persistent request state.

Alice and Bob each authorize their own FROST slot. Completion requires **two
independent signatures over the same request**. Each slot uses a 2-of-3 keeper
committee; that threshold is separate from the two-person application workflow.

## 1. Start from an empty application directory

Install Node.js **24**. The commands below install the latest SDK from npm.

The application downloads the testnet manifest from
[tasra-releases](https://github.com/t3-foundry/tasra-releases) and verifies its
checksum. The selected deployment must support FROST slot creation, creator-signed
provisioning, OID4VP, SD-JWT credentials bound to `did:jwk` holders and required
keeper receipts. It needs sufficient members for 2-of-3 keeper and verifier
policies and any applicable usage credits. A successful registry read does not
prove that these protected operations are supported.

Create an app:

```sh
mkdir my-document-signing
cd my-document-signing
npm init -y
npm install tasra-sdk@latest
```

Using your IDE file explorer, copy the **contents** of
`node_modules/tasra-sdk/examples/document-signing/` into your app directory,
Accept replacement of the initial `package.json`. Rename `gitignore.template`
to `.gitignore` in your IDE; npm omits dot-ignore files from package archives.
Then install the latest SDK and the copied application's dependencies:

```sh
npm install tasra-sdk@latest
cp node_modules/tasra-sdk/examples/fund-slot.ts .
npm run build
```

Create the application identities and creator wallet:

```sh
npx tsx network.ts
npm run setup
```

If the creator is unfunded, setup prints its address and stops. Fund that address
on the printed network through its faucet or a wallet you control, then run setup
again. Use AVAX from the [official Fuji C-Chain faucet](https://core.app/tools/testnet-faucet/?subnet=c&token=c).
The saved creator key is reused. Setup creates the issuer, separate
Alice/Bob/Mallory wallet files, two FROST slots and their access policies.

Before `npm start`, follow [Fund a slot](funding.md) using `.tasra/sdk` instead of
`.tasra/first-slot`. Setup prints complete status commands for both slot IDs.
Keep each `--slot` argument when buying TSRA with EURC and depositing TSRA. Buy
enough TSRA, then fund **both** slots; the web app's slots do not share usage credit.
For a custom `TASRA_SIGN_DATA` directory, use the directory printed by setup.

```sh
npm start
```

Use macOS, Linux or WSL for this file-store example. TLS verification
remains enabled, and the application does not use a shared funding key.

The server prints a **private sender-console link**. Open that link to create
requests. Keep its token private. The server binds to `127.0.0.1:4177`; this tutorial
uses browser profiles on the same machine, not remote email invitations.

## 2. Send your first agreement

1. Open the sender console. Choose a PDF or **Use sample PDF**. Give it a title and version.
2. Select **Create signing request**. The app freezes the PDF digest, request ID,
   version, chain identity and Alice/Bob slot assignments.
3. Select **Save request** now. Keep `request.json` independently of the final bundle.
4. Open Alice's invitation in a separate browser profile. Import only
   `.tasra/wallets/alice.json`, review the PDF, tick the approval checkbox and sign.
5. Open Bob's invitation in another browser profile. Bob must wait for Alice.
   Import `.tasra/wallets/bob.json`, review and sign.
6. Download the original PDF and `signatures.json`. Reload either signer page:
   the saved approval remains visible.

Wallet seeds stay in their browser tab. The backend stores its creator key and
public holder keys, but does not load the private wallet files. It proxies the
signed request object and encrypted presentation only to the configured verifier.
Wallet files and creator state live in ignored `.tasra/`; never publish that folder.
Demo credentials expire after a day. Stop the server and rerun setup to refresh
credentials; it preserves existing identities and completed slot provisioning.

## 3. Understand the TypeScript you just ran

Read the app in this order. Each file has one concrete job:

| File | What you learn |
|---|---|
| [config.ts](../examples/document-signing/config.ts) | Load the public manifest with `TasraClient`. |
| [setup.ts](../examples/document-signing/setup.ts) | Create fresh SDK identities and wallets; call `tasra.slots.create()` with each signer’s policy. |
| [model.ts](../examples/document-signing/model.ts) | Define the exact signed statement and verify detached proofs. |
| [backend.ts](../examples/document-signing/backend.ts) | Open a creator-bound verifier session; sign with a typed FROST handle. |
| [web/wallet.ts](../examples/document-signing/web/wallet.ts) | Bind the wallet approval to the reviewed document and submit the holder-bound presentation. |
| [workflow.ts](../examples/document-signing/workflow.ts) | Enforce Alice → Bob, idempotent completion and recovery. |
| [server.ts](../examples/document-signing/server.ts) | Expose the request API, wallet transport and downloads. |
| [web/app.ts](../examples/document-signing/web/app.ts) | Implement upload, invitations, review and verification screens. |

The SDK operation at the center is small:

```ts
const handle = await tasra.slots.frost(slotId)
const signed = await handle.sign(statement(manifest), {
  requireReceipt: true,
  authorize: async () => ({
    token: grant.token,
    verifierProofs: grant.verifierProofs!,
  }),
})
```

`grant` comes from the matching wallet's accepted verifier session. The SDK checks
that authorization and the returned signature match the operation. The app also
checks the signer assignment and anchored public key before saving completion.

The browser hashes the **same PDF bytes it renders**, checks the signed verifier
request and bound operation, then presents its credential. PDF rendering uses the
bundled [PDF.js renderer](https://mozilla.github.io/pdf.js/examples/); it does not
upload documents to an external preview service. Use the page controls for multi-page
PDFs. The sample does not edit form fields or embed signature appearances in PDFs.

## 4. Verify without trusting the download

Open **Verify**, select the original PDF, your previously saved `request.json`,
and `signatures.json`. Or run in a macOS/Linux shell (bash or zsh):

```sh
npm run verify -- document.pdf request.json signatures.json
```

Verification checks the exact request, the PDF digest, two distinct assigned
signers, current on-chain keys and epochs, and both FROST signatures. It rejects
altered PDFs, versions, request IDs, swapped slots and duplicate Alice signatures.
The bundle's `receiptStatus` is a record of the live SDK check, not an independently
verifiable archived receipt; offline bundle verification does not establish it.

Do not obtain your expected request from an untrusted bundle: an attacker could
replace the entire document and both signatures with a different valid agreement.
The saved manifest supplies the expected identity of your request.

## 5. Observe retries, refusal and recovery

- Double-clicking or repeating completion returns the saved proof. It does not sign again.
- Restart the server after Alice signs. Her approval survives; Bob can continue.
- Import Mallory's wallet on Alice's invitation. The wallet rejects the mismatched
  credential. This local refusal does not establish server-side enforcement; your
  integration tests should also submit an unauthorized presentation to the verifier
  and assert its refusal.
- Cancel from the sender console, or decline using the assigned signer's wallet.
  A bare invitation is insufficient to authorize a decline or signature.
- If a process stops during session opening or keeper submission, the request is
  marked **uncertain**. The app refuses automatic re-signing. Preserve `.tasra/`
  and reconcile the saved request/session with the verifier and keeper records.
  The tutorial intentionally has no “reset and try again” button for this case.

The JSON store uses atomic replacement, fsync, a per-request queue and one process
lock. It is a small single-writer example; production deployments need an appropriate
database, authenticated enrollment and access control for documents, delivery,
retention, and a policy for historical key rotation. Anyone with a demo invitation
can read its document. Activity timestamps are local application timestamps, not
trusted timestamps or legal certification.

## Check your application

```sh
npm test
npm run build
```

These commands check the application locally. Then exercise the running app: complete
a request with Alice and Bob, reload it, verify the downloaded bundle and confirm
that a modified PDF fails verification. Unit tests and a build do not establish
that your deployment can authorize or sign.

## Run the same cryptographic workflow in a terminal

Before protected operations, the terminal example pauses for **TSRA usage credit**.
In a second terminal in the same project, run its printed `fund-slot.ts ... status`
command. Follow [Fund a slot](funding.md) to obtain EURC, buy TSRA from BondingCurve,
and deposit TSRA into the printed slot. Replace `.tasra/first-slot` in those commands
with this app's printed directory. Fund every new slot; creator AVAX pays gas and
does not provide usage credits. Keep the app running while funding. After its
15-minute wait expires, a new run creates fresh accounts and slots; funding
the old slot does not resume the exited run.


If you want to learn the SDK before running the web app, use
[document-signing.ts](../examples/document-signing.ts). It creates two fresh signer
slots through `tasra.slots.create()`, signs one exact PDF/request with both people,
and independently checks both signatures against their on-chain keys.

Create a separate application using a macOS/Linux shell or WSL.

```sh
mkdir my-document-signatures
cd my-document-signatures
npm init -y
npm pkg set type=module
npm install tasra-sdk@latest
npm install --save-dev tsx typescript @types/node
cp node_modules/tasra-sdk/examples/document-signing.ts app.ts
cp node_modules/tasra-sdk/examples/tutorial-support.ts .
cp node_modules/tasra-sdk/examples/tutorial-negative.ts .
cp node_modules/tasra-sdk/examples/network.ts .
cp node_modules/tasra-sdk/examples/fund-slot.ts .
printf '.tasra/\nnode_modules/\n' > .gitignore
npx tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --resolveJsonModule app.ts
npx tsx network.ts
npx tsx app.ts
```

The only application dependency is `tasra-sdk`. The shared tutorial helper loads
the downloaded release manifest with `TasraClient` and creates fresh identities,
credentials and a creator wallet. It prints the creator address and waits up to
15 minutes for funding through the network faucet or your own wallet. The application itself creates both slots,
freezes the PDF/request, signs and checks the evidence. No learner slots or accounts
are precreated; each full run creates a new private `.tasra/document-signing-*` folder.

Expect a final `PASS: Alice AND Bob signed; document tampering, replay and duplicate
signer rejected.` Inspect `document.pdf`, `request.json`, `signature-bundle.json`
and `evidence.json` in the printed directory. The checks also prove Bob's credential
is refused by the real verifier when submitted for Alice's slot. Private keys and
credentials share that directory; never publish the entire folder.


For **one signature requiring a native approval quorum**, follow
[native approvals](native-approvals.md); it has different semantics.

`npx tsx network.ts` saves the verified manifest and its checksum pin. Keep both
files with the application so restarts use the same deployment. The examples use
`lowest-operator-id` as the explicit coordinator convention; confirm it matches
the selected service. Fund each newly printed creator address with at least 0.05
AVAX on Fuji before continuing; more may be needed if gas costs rise.
