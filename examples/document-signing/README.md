# Tasra Sign

A small TypeScript document-signing app: upload a PDF, invite Alice and Bob,
collect two independently authorized FROST signatures, and verify the bundle.

Follow the SDK's `docs/document-signing.md` for installation, the local-fleet
prerequisite and the source walkthrough. This candidate is not deployed on Fuji.

After copying this directory from the installed SDK into your own application,
rename `gitignore.template` to `.gitignore` in your IDE, then run:

```sh
npm install /absolute/path/to/tasra-sdk-0.3.0-next.0.tgz
npm run build
NODE_EXTRA_CA_CERTS=local-fleet-ca.pem npm run setup
NODE_EXTRA_CA_CERTS=local-fleet-ca.pem npm start
```

Open the private sender-console link. Create a request, save `request.json`, and
open Alice and Bob invitations in separate browser profiles. Import their respective
`.tasra/wallets/alice.json` and `bob.json` files. Review and sign in order.
Download the PDF and `signatures.json`, then use the Verify page.

```sh
npm test
NODE_EXTRA_CA_CERTS=local-fleet-ca.pem npm run verify -- document.pdf request.json signatures.json
```

Read `config.ts`, `setup.ts`, `model.ts`, `backend.ts`, `web/wallet.ts`, then
`workflow.ts`. The app uses a local single-writer JSON store. Keep `.tasra/` private.
If an operation becomes uncertain, preserve its state and reconcile it; do not
create a replacement signature automatically. The verifier checks current keys,
not historical timestamps. Documents are readable by anyone with their invitation.
