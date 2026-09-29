# Native approval quorum for one FROST signature

Create one FROST signature after Alice and Bob approve. The approval quorum counts
people (or configured identity keys); the keeper threshold counts cryptographic
shares. They are separate numbers.

Use the manifest-based `TasraClient` and `tasra.slots.create()` to create a ready
FROST slot. Then configure the native approval policy through the SDK:

```ts
import {setApprovalPolicy, identityApprover} from 'tasra-sdk/app'

const signers = [identityApprover(alice), identityApprover(bob)]
await setApprovalPolicy(tasra, slot.slotId, {
  quorum: 2, approvers: signers.map(signer => signer.publicKey),
}, {wallet: creator, store})
const approvals = await slot.approvals({quorum: 2, credentialGated: false})
const request = await approvals.create(exactMessageBytes)
// Save request ID, coordinator, slot, message and expected policy before approval.
await request.approve({signer: signers[0]!})
await request.approve({signer: signers[1]!})
const signature = await request.wait({timeoutMs: 120_000})
```

`alice` and `bob` are Ed25519 identities created by `tasra.identities.create()`.
`identityApprover` adapts their keys without requiring an application signing
library. The SDK checks slot, message and quorum before requesting each signature,
and verifies the resulting FROST signature against the expected group key.

For credential-gated approval, pass `{quorum: 2, credentialPolicy: rule}` to
`setApprovalPolicy` and use `slot.approvals({quorum: 2, credentialGated: true})`.
Approve each holder with:

```ts
import {approveWithCredential} from 'tasra-sdk/app'

await approveWithCredential(tasra, request, exactMessageBytes, {
  identity: alice,
  authorize: tasra.credentials.authorize({
    verifierAgentUrl: tasra.verifierAgentUrl!, signer: creator.signer,
    identity: alice, credentials: [aliceCredential],
  }),
})
```

The SDK constructs the canonical approval digest, obtains the holder-bound
operation grant and signs the exact request. The network counts distinct holders;
Alice presenting again cannot stand in for Bob. The lower-level `createDualSignClient`
and explicit approval transport remain available for specialized integrations.

After a restart, use `approvals.resume(saved.requestId, saved.message)` with the
original coordinator and pinned policy. After an ambiguous POST, catch
`OperationOutcomeUnknownError` and reconcile status. Do not automatically create
a replacement request. If creation lost its request ID, the current protocol
cannot discover it through this SDK; preserve that uncertainty for an operator.

This is separate from two detached signatures in a document workflow. It does
not enable multi-approver IBE extraction.

Two complete examples exercise these behaviors:

- [Static approver keys](../examples/native-approvals.ts): distinct approvals, duplicate-vote prevention and cross-request replay refusal.
- [Credential-gated approvals](../examples/credential-approvals.ts): Alice and Bob present separate holder-bound credentials for the exact request; Alice's repeated approval does not add another vote. The SDK verifies the final threshold signature.

## Create a fresh project and run

Before protected operations, the terminal example pauses for **TSRA usage credit**.
In a second terminal in the same project, run its printed `fund-slot.ts ... status`
command. Follow [Fund a slot](funding.md) to obtain EURC, buy TSRA from BondingCurve,
and deposit TSRA into the printed slot. Replace `.tasra/first-slot` in those commands
with this app's printed directory. Fund every new slot; creator AVAX pays gas and
does not provide usage credits. Keep the app running while funding. After its
15-minute wait expires, a new run creates fresh accounts and slots; funding
the old slot does not resume the exited run.


Use Node.js **24**. The examples download and checksum-verify the testnet manifest
from [tasra-releases](https://github.com/t3-foundry/tasra-releases). The deployment
must support FROST creation and the selected native approval policy. Credential
approvals additionally require operation-bound OID4VP, SD-JWT and `did:jwk`
support. Ensure sufficient keeper/verifier membership and usage credits.
In a new terminal, create the project and install the latest SDK from npm:

```sh
mkdir my-approval-workflow
cd my-approval-workflow
npm init -y
npm pkg set type=module
npm install tasra-sdk@latest
npm install --save-dev tsx typescript @types/node
cp node_modules/tasra-sdk/examples/native-approvals.ts .
cp node_modules/tasra-sdk/examples/credential-approvals.ts .
cp node_modules/tasra-sdk/examples/tutorial-support.ts .
cp node_modules/tasra-sdk/examples/tutorial-negative.ts .
cp node_modules/tasra-sdk/examples/network.ts .
cp node_modules/tasra-sdk/examples/fund-slot.ts .
printf '.tasra/\nnode_modules/\n' > .gitignore
npx tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --resolveJsonModule native-approvals.ts credential-approvals.ts
npx tsx network.ts
npx tsx native-approvals.ts
npx tsx credential-approvals.ts
```

`tasra-sdk` is the only application runtime dependency. The visible tutorial helper
loads the release manifest and creates fresh identities, credentials and a creator
wallet. Each run prints its creator address and waits up to 15 minutes for funding
through the network faucet or your own wallet. Each example creates its own slot and approval policy. No precreated
learner accounts, slots or credentials are required.

The static example must finish with `PASS: two distinct approvals, duplicate vote
prevented, replay refused.` The credential example must finish with `PASS: Alice and
Bob approved; duplicate holder added no vote.` Each prints the location of its
`evidence.json` containing the checked outcomes and public transaction references.

Private keys, credentials and recovery journals stay in `.tasra/`; do not publish
that whole directory. Each complete example run creates a new directory and slot.
For an interrupted prior run, preserve and reconcile its original state. A completed
setup alone does not establish that the approval flow succeeded.

`npx tsx network.ts` saves the verified manifest and its checksum pin. Keep both
files with the application so restarts use the same deployment. The examples use
`lowest-operator-id` as the explicit coordinator convention; confirm it matches
the selected service. Fund each newly printed creator address with at least one
native token on the selected chain before continuing.
