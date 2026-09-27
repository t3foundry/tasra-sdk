# Build a small document-signing app

Build **Tasra Sign**: upload a PDF, invite Alice and Bob, collect their approvals,
and download a verifiable signature bundle. This is a working TypeScript web app
with separate signer wallets and persistent request state.

Alice and Bob each authorize their own FROST slot. Completion requires **two
independent signatures over the same request**. Each slot uses a 2-of-3 keeper
committee; that threshold is separate from the two-person application workflow.

## 1. Start from an empty application directory

Install Node.js **24** and obtain the candidate SDK checkout. This example requires
unpublished `0.3.0-next.0`; the public `0.2.2` package does not contain its APIs.
In the SDK directory:

```sh
npm ci
npm pack
```

You also need the [compatible local fleet](shared-account.md#1-prepare-the-sdk-and-local-fleet).
Its public addresses, RPC, verifier and keeper mapping are visible in
[config.ts](../examples/document-signing/config.ts). The supplied CA belongs to the
example fleet. Replace the public descriptor and CA if your fleet differs.
**Do not use Fuji for this candidate.** SDK/releases do not yet provide a complete
clean-machine fleet launcher; access to a running compatible fleet is a prerequisite.

Create an app, substituting your checkout's path:

```sh
mkdir my-document-signing
cd my-document-signing
npm init -y
npm install /path/to/tasra-sdk/tasra-sdk-0.3.0-next.0.tgz
```

Using your IDE file explorer, copy the **contents** of
`node_modules/tasra-sdk/examples/document-signing/` into your app directory,
Accept replacement of the initial `package.json`. Rename `gitignore.template`
to `.gitignore` in your IDE; npm omits dot-ignore files from package archives.
Then install the candidate again so npm resolves the unreleased dependency locally:

```sh
npm install /path/to/tasra-sdk/tasra-sdk-0.3.0-next.0.tgz
npm run build
NODE_EXTRA_CA_CERTS=local-fleet-ca.pem npm run setup
NODE_EXTRA_CA_CERTS=local-fleet-ca.pem npm start
```

On PowerShell, set `$env:NODE_EXTRA_CA_CERTS="local-fleet-ca.pem"` before setup/start.
No CLI or another demo project's configuration is required. `setup.ts` creates a
funded local creator, a demo credential issuer, Alice/Bob/Mallory wallet files, two
fresh FROST slots, their rules and verifier policies. The funding key is Avalanche's
public **local-development** key. It is restricted to the local deployment here.

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
| [config.ts](../examples/document-signing/config.ts) | Connect `createTasra` to an explicit public deployment. |
| [setup.ts](../examples/document-signing/setup.ts) | Prepare and persist slot creation; provision a signer-specific DCQL rule. |
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
and `signatures.json`. Or run:

```sh
NODE_EXTRA_CA_CERTS=local-fleet-ca.pem npm run verify -- document.pdf request.json signatures.json
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

For the cryptographic workflow in one terminal file, use
[document-signing.ts](../examples/document-signing.ts).
For **one signature requiring a native approval quorum**, follow
[native approvals](native-approvals.md); it has different semantics.
