# Build an Ethereum account Alice and Bob can use

Create one tECDSA account, let Alice and Bob each send a transaction, and prove
that Mallory cannot get permission. The application uses **TypeScript, tasra-sdk,
and viem**. It does not invoke the CLI or read another project's configuration.

**This example uses an unreleased SDK addition.** Install the packed checkout below;
the published `0.2.2` package does not include `committeeSignEoaDigest` yet.
[Compatibility](compatibility.md) · [Actual results](evidence/shared-account/README.md)

## 1. Prepare the SDK and local fleet

Install Node.js **22.12+** (24 recommended). Use a checkout containing this example.
From the SDK directory:

```sh
npm ci
npm pack
```

This creates `tasra-sdk-0.2.2.tgz`. Keep its full path for the next step.

You need the compatible local fleet running. The app includes these public values
at the top of the file, so you can see and change every deployment dependency:

| Configuration | Tested value |
|---|---|
| Chain | Local Avalanche, `43112` |
| RPC | `http://127.0.0.1:9650/ext/bc/C/rpc` |
| KeyRegistry | `0x94c75679D75bfdc310669c0De4dE4398E922232b` |
| NodeRegistry | `0xEA7A0602b6DB6Aa767C5649b4d5083c426Cb8083` |
| Verifier agent | `https://localhost:19444` |
| Keeper transport | Docker names `keykeeper-node-1`–`5` mapped to local ports `8091`–`8095` |
| TLS trust | Public development CA supplied as `examples/local-fleet-ca.pem` |
| Funding | Avalanche's public local-development funder, embedded in the app |

The app checks the local chain and verifier service before funding anything.
The CA contains no private key. It is for this fleet only; replace it with your
fleet's public CA if needed. TLS verification stays enabled.

**If you have only a clean IDE:** install Node.js, obtain this SDK checkout, and
get access to a compatible development fleet with the configuration above.
Neither the SDK nor `tasra-releases` currently provides a complete local-fleet
launcher. That deployment prerequisite remains; the app creates all its own
wallets, credentials, slot, rule, and account funding once the fleet is available.
Do not substitute Fuji: its services have not been upgraded for this walkthrough.

## 2. Create your application

In a new terminal, replacing `/path/to/tasra-sdk` with your checkout's actual path:

```sh
mkdir my-shared-account
cd my-shared-account
npm init -y
npm pkg set type=module
npm install /path/to/tasra-sdk/tasra-sdk-0.2.2.tgz viem@2
npm install --save-dev tsx
```

Copy these **two files** from the installed package into your app folder using
your IDE file explorer:

| Copy from | Save as |
|---|---|
| `node_modules/tasra-sdk/examples/shared-account.ts` | `app.ts` |
| `node_modules/tasra-sdk/examples/local-fleet-ca.pem` | `local-fleet-ca.pem` |

Open `app.ts`. It is the entire application, not a wrapper around an existing demo.
Save a `.gitignore` containing `.tasra/` before committing your app: that directory
will hold the example's private development keys and credentials.

## 3. Run the app

macOS / Linux:

```sh
NODE_EXTRA_CA_CERTS=local-fleet-ca.pem npx tsx app.ts
```

PowerShell:

```powershell
$env:NODE_EXTRA_CA_CERTS = "$PWD/local-fleet-ca.pem"
npx tsx app.ts
```

Key generation and threshold signing take time. The app prints each completed stage:

```text
1. Fresh creator funded; Alice, Bob and Mallory have separate credentials.
2. Created and provisioned slot 0x…
   Ethereum account: 0x…
3. alice: confirmed 0x… (nonce 0)
3. bob: confirmed 0x… (nonce 1)
4. Mallory: refused by verifier; nonce unchanged (2).
Evidence: …/evidence.json
```

Every run creates a **new** slot using local test funds. Recovery records are saved
before slot creation, and transaction hashes are saved before broadcasting.
If a run stops, keep its files and diagnose the error before starting another run.

## 4. Understand the five stages

| Stage in `app.ts` | SDK calls | What it proves |
|---|---|---|
| Create identities | `ed25519HolderKey`, `issueSdJwtVc` | Each user has a separate holder key and a credential signed by the fresh development issuer. |
| Create an account | `createTasraWriteClient`, `createSlot` / `createSlotCommitReveal`, `addressFromEoaPubkey` | The fleet creates a distributed key; the app derives its Ethereum address from the public key. |
| Configure access | `provisionRule`, `setVerifierPolicy` | The creator provisions the exact committed rule with its own signature. No admin JWT is used. |
| Authorize and transact | `openVerifierAgentSession`, `presentToRequestUri`, `awaitVerifierAgentResult`, `committeeSignEoaDigest` | The wallet presents a credential for the exact transaction digest; the fleet signs it and the chain confirms it. |
| Reject Mallory | `buildResponse`, `submitResponse`, `awaitVerifierAgentResult` | A deliberately nonmatching presentation reaches the server and is refused. A local wallet filter is not counted as this proof. |

The rule pins the fresh issuer, credential type, `treasury-signer` role, and subject
**Alice or Bob**. Mallory has a correctly signed credential and its own holder key,
but its subject is excluded. Two of three **keepers** sign; either authorized
**user** can initiate a transaction. This is not a two-user approval workflow.

The transaction is a zero-value self-transfer. Both receipts must have the same
sender, with nonces 0 and 1. The example verifies signature recovery before sending.
It does not retry signing after a denial or silently switch authorization modes.

## 5. Inspect the evidence

In the printed run directory, open:

- `evidence.json` — slot, account, fleet versions, both transaction hashes and denial result.
- `alice-receipt.json` and `bob-receipt.json` — actual chain receipts.
- `recovery.json` — **private** development keys, credentials, rule and creation salts.

Only the first three files are suitable for sharing. The automated test copies
only those public files into its evidence directory.

## If it stops

| Error or symptom | Next action |
|---|---|
| Missing `committeeSignEoaDigest` export | Install the packed current checkout; the registry version predates this addition. |
| Connection refused / health check failure | Restore the local fleet and check the public URLs at the top of `app.ts`. |
| Certificate verification failure | Point `NODE_EXTRA_CA_CERTS` to the correct public CA before starting Node. |
| Slot not ready | Inspect the saved slot ID and fleet DKG status; do not discard the recovery file. |
| No keeper accepted the rule | Confirm the fleet supports `/rule/by-creator` and the addresses match the deployment. |
| ECDSA route returns 404 | The keeper build lacks the required route; check [compatibility](compatibility.md). |
| Authorization refused for Alice/Bob | Confirm issuer resolution and verifier policy support. A denial is not a retryable connectivity failure. |
| Transaction submitted, then RPC failed | Check the hash in the saved submission file before attempting another transaction. |

## Run the same acceptance check automatically

From the SDK checkout:

```sh
npm run verify:docs
npm run test:docs:live
```

`verify:docs` checks links, tutorial/source agreement, and generated API reference.
`test:docs:live` builds and packs the SDK, installs it in a fresh temporary app,
copies the same example, and checks both receipts and the server-side denial.
It requires the compatible running local fleet and creates a new development slot.
Public evidence is written to `.tasra/docs-evidence/`.

CI runs the static documentation checks on normal builds. After these changes land
on `develop`, maintainers can select **live_docs** in the CI workflow's manual run
to execute the same live check on the configured local-fleet runner and upload only
public evidence. It is opt-in because it creates a slot and spends local test funds.

[Full application source](../examples/shared-account.ts) ·
[Signing API](signing.md) · [API reference](reference/README.md) · [Documentation index](README.md)
