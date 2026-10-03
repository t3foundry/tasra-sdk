# Tasra Sign

A TypeScript app for two people to sign the same document using separate FROST slots.
Each person authorizes their own signature. This is not one shared-signature quorum.

## Install and connect

Copy this directory into your application, rename `gitignore.template` to `.gitignore`,
then run:

```sh
npm install tasra-sdk@latest
cp node_modules/tasra-sdk/examples/fund-slot.ts .
npm run build
npx tsx network.ts
npm run setup
```

`network.ts` downloads the current testnet manifest from
[tasra-releases](https://github.com/t3-foundry/tasra-releases/tree/main/networks),
verifies its SHA-256, and saves `network.json` and `network-pin.json`. Keep those files
together. The example explicitly selects the `lowest-operator-id` coordinator policy;
confirm that the chosen services use this policy before creating slots.

Setup saves a new creator wallet and prints its address. Fund that address with at
least 0.05 AVAX through the [official Fuji C-Chain faucet](https://core.app/tools/testnet-faucet/?subnet=c&token=c) or your own wallet, then rerun
`npm run setup`. The saved creator is reused. The network must support FROST slots,
credential authorization and creator-signed rule provisioning. After creation, buy TSRA with EURC from BondingCurve and deposit TSRA into each
slot's Settlement balance before starting the app. Use the printed status commands
with `fund-slot.ts`; change `status` to `mint-test-eurc 10000000` (test EURC only),
`buy 10000000 1000000000000000000` (spend 10 EURC, require at least 1 TSRA), then
`fund 1000000000000000000` (deposit 1 TSRA). Keep each command's `--slot` argument.
Repeat the deposit for both slots, acquiring enough TSRA first. These are example
budgets; actual charges vary. The commands report confirmed hashes and balances.
EURC uses 6 decimals and TSRA uses 18. Creator AVAX is gas, not slot usage credit.
Each explicit write submits new transactions; inspect hashes and balances after
an uncertain result before retrying.

```sh
npm start
```

Open the private sender-console URL printed by the server. Create a request, save
`request.json`, then use separate browser profiles for Alice and Bob. Import their
generated wallet files, review the document, and sign. Download the document and
signature bundle after both signatures complete.

## Verify and test

```sh
npm run verify -- document.pdf request.json signatures.json
npm test
```

Keep `request.json` independently of the downloaded bundle. Verification binds both
signatures to its document digest, signer slots, chain and request ID. Preserve `.tasra`
if an operation is interrupted; it contains private keys, credentials and recovery state.
Do not publish that directory. A manifest or successful contract read does not prove
that the network supports every authorization or signing operation.
