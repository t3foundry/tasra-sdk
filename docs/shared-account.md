# Build an Ethereum account Alice and Bob can use

Create one shared Ethereum account, let Alice and Bob each send a transaction,
and verify that Mallory is refused. The app uses **tasra-sdk as its only runtime
dependency**. It creates its own wallets, credentials and slot; no learner account,
private key, slot ID or CLI setup is copied from another project.

Install the latest SDK from npm in step 2. Check [deployment compatibility](compatibility.md)
before running the app.

## 1. Prepare the network connection

Install Node.js **22.12+** (24 recommended). The example downloads the testnet
pointer and manifest from [tasra-releases](https://github.com/t3-foundry/tasra-releases)
and checks the manifest checksum. It resolves the RPC, contracts and verifier from
that configuration, with an explicit `lowest-operator-id` coordinator convention.

The selected deployment must support tECDSA key generation, creator-signed rule
provisioning, OID4VP authorization and transaction signing. This example requests
2-of-3 keepers and a 2-of-3 verifier policy, using SD-JWT credentials bound to
fresh `did:jwk` identities. A manifest or registry check does not establish support
for those operations. Any deployment-specific usage credits must also be available.

The application generates its own creator wallet and prints its public address.
Fund it with AVAX using the [official Fuji C-Chain faucet](https://core.app/tools/testnet-faucet/?subnet=c&token=c) or a wallet you control. No shared private
key or precreated learner account is required.

## 2. Create your application

In a new terminal, create the project and install the latest SDK from npm:

```sh
mkdir my-shared-account
cd my-shared-account
npm init -y
npm pkg set type=module
npm install tasra-sdk@latest
npm install --save-dev typescript tsx @types/node
cp node_modules/tasra-sdk/examples/shared-account.ts app.ts
cp node_modules/tasra-sdk/examples/tutorial-support.ts tutorial-support.ts
cp node_modules/tasra-sdk/examples/tutorial-negative.ts tutorial-negative.ts
cp node_modules/tasra-sdk/examples/network.ts network.ts
cp node_modules/tasra-sdk/examples/fund-slot.ts .
```

These copy commands use a macOS/Linux shell or WSL. You can copy
the same files with your IDE. Open `app.ts`: it contains the slot, credential and
wallet operations. `tutorial-support.ts` supplies shared network and identity setup and
public evidence output; `tutorial-negative.ts` exercises verifier rejection.
The SDK implements slot orchestration, credential creation and wallet signing.

Save **`.gitignore`** with this line:

```text
.tasra/
```

Save **`tsconfig.json`**:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "resolveJsonModule": true,
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["*.ts"]
}
```

## 3. Check and execute

Before protected operations, the terminal example pauses for **TSRA usage credit**.
In a second terminal in the same project, run its printed `fund-slot.ts ... status`
command. Follow [Fund a slot](funding.md) to obtain EURC, buy TSRA from BondingCurve,
and deposit TSRA into the printed slot. Replace `.tasra/first-slot` in those commands
with this app's printed directory. Fund every new slot; creator AVAX pays gas and
does not provide usage credits. The app waits up to 15 minutes per slot.

First typecheck the app (the same command on macOS, Linux and Windows):

```sh
npx tsc --noEmit
```

Run the application:

```sh
npx tsx network.ts
npx tsx app.ts
```

The app prints its creator address and chain, then waits up to 15 minutes for
at least one native token. In a separate window, use the network’s faucet or transfer
native tokens
from a wallet you control. Fund the printed address on the printed chain. The
creator pays setup transactions and funds the shared account's transaction gas.

Key generation and threshold signing can take time. The app records the shared
account address, Alice's and Bob's confirmed transactions, and Mallory's refusal.
It prints the evidence location at the end.

Each invocation starts a fresh demonstration with a **new slot** and isolated
private store. An interrupted invocation is not resumed by starting the tutorial
again. Preserve its store and reconcile any pending transactions first. The SDK's
named operations support resuming the same intent when your application reopens
the same store; see [recovery boundaries](application-api.md#recovery-boundaries).

## 4. Read the application

| Step | Application API | Result |
|---|---|---|
| Connect | `new TasraClient({manifest, store})` | Public deployment configuration and private durable state. |
| Create users | `tasra.identities.create`, `tasra.credentials.issue` | A fresh issuer and separate holder-bound credentials. |
| Define access | `tasra.credentials.policy` | Only the intended credential holders can request signing. |
| Create the account | `tasra.slots.create` with `mode: 'ecdsa'` | Commitment, creation, key generation and rule provisioning handled by the SDK. |
| Send transactions | `tasra.credentials.authorize`, `tasra.wallets.fromSlot`, `transfer` | Each exact transaction is authorized, signed and confirmed. |
| Check refusal | The separate negative-test helper submits a nonmatching presentation | The verifier refuses Mallory and the account nonce does not change. |

Two of three **keepers** cooperate to sign. Either authorized **user**, Alice or
Bob, may initiate a transaction; this is not a two-user approval workflow.
The app submits zero-value self-transfers with nonces `0` and `1` from the same
account. It checks the receipts and verifies that Mallory's request leaves the
nonce at `2`. The refusal must come from the verifier; local credential filtering
is not counted as server-side evidence.

For two people approving one signature, use [native approvals](native-approvals.md).
For two independent document signatures, use [document signing](document-signing.md).

## 5. Check the results

Open the printed run directory:

- `evidence.json`: the slot/account, confirmed transactions and verifier-refusal result.
- `alice-receipt.json` and `bob-receipt.json`: the actual chain receipts.

The evidence records public account activity. The rest of `.tasra/` contains
private identities, credentials and recovery state. Share only reviewed evidence
files, never the entire directory.




## If it stops

| Symptom | Next action |
|---|---|
| Cannot import `tasra-sdk/app` | Run `npm install tasra-sdk@latest` inside your app directory. |
| Missing configuration or helper file | Copy every file listed in step 2 and run from the app folder. |
| Connection refused | Check RPC access and the downloaded release manifest. |
| Certificate verification failure | Check the service certificate and system trust; keep TLS verification enabled. |
| Slot is not ready | Inspect its DKG status and preserve the private store. |
| No keeper accepted the rule | Confirm creator-signed provisioning support and the selected deployment identity. |
| Authorization refused for Alice/Bob | Check issuer and verifier compatibility; a denial is not a connectivity retry. |
| Submission outcome is uncertain | Reconcile the recorded hash before retrying; do not discard the journal. |

[Application source](../examples/shared-account.ts) ·
[Application API](application-api.md) · [Documentation index](README.md)

`npx tsx network.ts` saves the verified manifest and its checksum pin. Keep both
files with the application so restarts use the same deployment. The examples use
`lowest-operator-id` as the explicit coordinator convention; confirm it matches
the selected service. Fund each newly printed creator address with at least one
native token on the selected chain before continuing.
