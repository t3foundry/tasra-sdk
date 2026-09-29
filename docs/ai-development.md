# Skills and example prompts

Describe the application you want to build, then give your coding agent the SDK's
instructions. TASRA ships task-specific **skills**: readable `SKILL.md` files with
API guidance, examples and verification steps. They help an agent choose an
existing SDK flow, keep authorization checks intact and test the result instead
of inventing APIs or rebuilding SDK internals.

You can use the prompts below in your editor or coding agent. They start with
user outcomes; you do not need to know SDK client names first. For the operations
behind them, see [Application flows](flows.md).

## Install and find the skills

Start in your application's directory:

```sh
npm install tasra-sdk@latest
node -p "require('tasra-sdk/package.json').version"
ls node_modules/tasra-sdk/skills
cat node_modules/tasra-sdk/skills/tasra-getting-started/SKILL.md
```

The version command reports the package actually installed. Keep your lockfile
with the project. You can also open these files in any editor; the shell examples
use macOS/Linux or Git Bash.

Installing the SDK places skills in `node_modules/tasra-sdk/skills/`. **It does
not register them with your agent.** For an agent that discovers project skills
under `.agents/skills`, copy the complete selected folders:

```sh
mkdir -p .agents/skills
cp -R node_modules/tasra-sdk/skills/tasra-getting-started .agents/skills/
cp -R node_modules/tasra-sdk/skills/tasra-create-slot .agents/skills/
```

Review existing folders before copying so you preserve custom instructions. To
install the whole set in that discovery directory instead:

```sh
cp -R node_modules/tasra-sdk/skills/tasra-* .agents/skills/
```

Check your agent's project-skill directory; it may use a different location.
Start a new session if needed and explicitly ask it to use `tasra-getting-started`
and the skill for your task. An agent without skill discovery can read the
installed `SKILL.md` directly when you provide its path. Copying only `SKILL.md`
is insufficient: some skills also need their `references/` folder.

After an SDK upgrade, refresh copied skills from that installed package and
record the installed version. npm does not update `.agents/skills` copies.
Paths beginning `docs/`, `examples/` and `dist/` in skill instructions refer to
`node_modules/tasra-sdk/`; `references/` stays inside the copied skill folder.
See the [skill installation guide](../skills/README.md) for the complete convention.

## Choose a skill

Load the getting-started skill and the relevant task skill. You do not need to
load all instructions for every request.

| Task | Skill |
|---|---|
| Set up a TypeScript app and connect to a deployment | [tasra-getting-started](../skills/tasra-getting-started/SKILL.md) |
| Create, provision or resume a slot | [tasra-create-slot](../skills/tasra-create-slot/SKILL.md) |
| Give a user operation-specific authorization | [tasra-credentials-and-sessions](../skills/tasra-credentials-and-sessions/SKILL.md) |
| Define who may use a slot or decrypt a document | [tasra-dcql-rules](../skills/tasra-dcql-rules/SKILL.md) |
| Handle refusal, cancellation and uncertain results | [tasra-handle-errors](../skills/tasra-handle-errors/SKILL.md) |
| Build shared Ethereum accounts or document signing | [tasra-sign-and-decrypt](../skills/tasra-sign-and-decrypt/SKILL.md) |
| Encrypt documents with scoped access | [tasra-ibe-identity-scoped](../skills/tasra-ibe-identity-scoped/SKILL.md) |
| Inspect deployment, registry and slot state | [tasra-chain](../skills/tasra-chain/SKILL.md) |
| Collect multiple approvals for one signature | [tasra-committee-path](../skills/tasra-committee-path/SKILL.md) |
| Integrate a credential wallet, issuer or OAuth provider | [tasra-oid4vp-wallet-and-verifier-agent](../skills/tasra-oid4vp-wallet-and-verifier-agent/SKILL.md) |
| Integrate an explicitly chosen Hovi issuer | [tasra-hovi-issuer](../skills/tasra-hovi-issuer/SKILL.md) |

Skills are instructions, not credentials, network configuration or access grants.
They contain no operator secrets. Give the agent public deployment configuration
and explicit authority for the local test effects you want. Keep private keys,
credentials, authorization tokens and recovery journals out of prompts and public
logs. Skill installation does not start a fleet or authorize external account
creation, publishing or transactions.

## Start with this common prompt

Use this once in a fresh project, then choose an application prompt below. Replace
`<project-name>` and supply the deployment's public manifest file or URL.

```text
Help me build <project-name> with the latest Tasra SDK from npm. I am new to
TASRA. Use the installed tasra-getting-started skill, then only the skills needed
for my application. Read the installed docs, types and relevant complete example;
use SDK flows wherever available and do not invent APIs. Record the installed
package version without assuming a particular release.

Create a small TypeScript project with clear filenames and minimal comments
explaining the main steps. Download the selected network manifest from tasra-releases and verify its checksum. If the
manifest or a required service is missing, identify that missing input; do not
invent an endpoint or use private configuration from another project.

Use fresh application identities, wallets, credentials and slots when needed,
with private durable storage. Do not require copied learner keys or precreated
slots. Start with read-only connection checks. Before executing writes, confirm
the selected network and describe the intended effects and funding; reuse any
explicit authorization I have already given. Execute transactions only within
that authorized scope.

Give me the exact commands to install, typecheck, test and run the app. Test what
you can, show the observed results, and clearly list anything blocked or untested.
Keep public evidence separate from keys, credentials and recovery state.
```

The selected deployment must support the requested mode, authorization format
and service routes. A successful connection check alone does not prove that a
protected operation works. Authorize network effects by naming the network,
funding source and intended transactions. Keep credentials and private keys out
of prompts; use private application storage.

## 1. Connect and understand the environment

```text
Create a small terminal app that connects to my selected TASRA network from its
public manifest. Show the chain, whether the configured registries are available,
and the active registered-node count. Explain what each result proves and what
it does not. Distinguish registered nodes from keepers. Do not create accounts,
slots or transactions.
```

Use [tasra-getting-started](../skills/tasra-getting-started/SKILL.md) and
[tasra-chain](../skills/tasra-chain/SKILL.md). Start from the [connection tutorial](getting-started.md).

## 2. Create a wallet for my application

```text
Add a wallet for my application. Generate it through the SDK, save its key
privately before it receives funds, and restore the same wallet after restart.
Show its public address and balance. Use only the network's published faucet or a wallet I control when funding is authorized. Explain the difference between
this setup wallet and an account controlled by a TASRA slot.
```

## 3. Let Alice and Bob use one Ethereum account

```text
Build a team spending demo with one shared Ethereum account. Alice and Bob should
each be able to send a small authorized test transaction using their own credentials.
Mallory must be refused. Create all necessary development identities and the
shared account through the SDK. Verify the confirmed transactions and show that
Mallory's attempt did not change the account's transaction count. Either Alice
or Bob may act; this is not a requirement for both to approve each payment.
```

Use [tasra-sign-and-decrypt](../skills/tasra-sign-and-decrypt/SKILL.md);
[complete shared-account app](shared-account.md).

## 4. Encrypt private notes

```text
Build a private-notes app. Alice can encrypt a note and later read it with her
credential. Bob has a credential from the same issuer but must not read Alice's
note. Let the SDK handle encryption and authorized decryption. Test Alice's
successful read, Bob's refusal by the verifier, and detection of changed encrypted
data. Keep the encrypted note separate from private keys and credentials.
```

Use [tasra-ibe-identity-scoped](../skills/tasra-ibe-identity-scoped/SKILL.md);
[complete encrypted-notes app](encrypted-notes.md).

## 5. Protect document versions separately

```text
Build a small encrypted document archive. Give each immutable document version
its own access identity. Grant Alice access to one version and show that this
does not automatically grant her a different version. Store enough public metadata
to find and decrypt an authorized version after restart. Explain which access
cannot be revoked once someone has obtained the decryption key or plaintext.
```

## 6. Collect two independent document signatures

```text
Build an agreement-signing app. Alice and Bob review the same document, then each
signs with their own TASRA-backed identity. Mark the agreement complete only when
both distinct signatures verify for that exact document and request. Export the
document, expected request and signature bundle. Reject a changed document, a
signature copied from another request, and two copies of Alice's signature.
```

Use [tasra-sign-and-decrypt](../skills/tasra-sign-and-decrypt/SKILL.md);
[complete document-signing app](document-signing.md).

## 7. Require two approvals for one signature

```text
Build a release-approval workflow where Alice and Bob must both approve the same
release document before the system produces one final signature. Use the SDK's
native approval flow. Show that Alice approving twice does not replace Bob and
that an approval cannot be reused for another request. Save the request details
so the app can resume it. Explain how people approving differ from keepers signing.
```

Use [tasra-committee-path](../skills/tasra-committee-path/SKILL.md);
[complete native approval examples](native-approvals.md).

## 8. Issue and verify team credentials

```text
Build a local team-membership demo with a development issuer and separate Alice
and Bob identities. Issue credentials with their roles, verify them, and use those
roles to define access to an application operation. Show an expired credential
and a credential from an untrusted issuer being rejected by the relevant check.
Explain the difference between a valid signature, issuer trust and revocation.
Keep issuer and holder keys private and use the SDK's supported credential format.
```

Use [tasra-credentials-and-sessions](../skills/tasra-credentials-and-sessions/SKILL.md)
and [tasra-dcql-rules](../skills/tasra-dcql-rules/SKILL.md).

## 9. Connect an existing Ethereum wallet

```text
Add a browser screen that connects my existing Ethereum wallet instead of
creating a local key. Request account access when I click Connect, show the
selected address, and check the network against my TASRA deployment. Handle
refused access and account or network changes clearly. Start with read-only
behavior; show a review screen before any later authorized transaction.
```

This uses an Ethereum provider. A credential wallet is a separate integration.

## 10. Authorize through an external credential wallet

```text
Let a user authorize one document-signing request with an external credential
wallet. Show the appropriate QR code or deep link, wait for the selected verifier's
result, and continue only if authorization matches the exact request. Handle
refusal, cancellation and timeout without silently changing providers. Tell me
which wallet, credential format and verifier configuration were actually tested;
report missing integration inputs instead of claiming universal compatibility.
```

Use [tasra-oid4vp-wallet-and-verifier-agent](../skills/tasra-oid4vp-wallet-and-verifier-agent/SKILL.md).

## 11. Use our organization's sign-in provider

```text
Connect a protected TASRA operation to our organization's OAuth sign-in.
First inspect the SDK support and tell me which public provider settings and
application-side sign-in steps are required. Build the supported integration
around our chosen issuer and intended audience, with explicit user consent.
Keep tokens private. Test with the configured provider only when authorized;
clearly separate completed application setup from a successful end-to-end sign-in.
```

OAuth slot setup exists, but the SDK does not supply the application's complete
IdP sign-in flow. Token acquisition and the bound DPoP signer require integration.
See [OAuth flow boundaries](flows.md#integrate-oauth-authorization).

## 12. Resume without duplicate operations

```text
Improve this app so restarting it continues the same slot creation or recorded
payment instead of creating another one. Use the SDK's durable operations and
keep the original private state. Test supported interruption points and confirm
that a completed operation is not submitted again. If a transaction outcome is
unknown, preserve it for reconciliation. Do not delete journals, steal abandoned
locks or claim unsupported recovery works.
```

Use [tasra-create-slot](../skills/tasra-create-slot/SKILL.md) and
[tasra-handle-errors](../skills/tasra-handle-errors/SKILL.md).

## 13. Prove the application works

```text
Review this app against its intended user behavior and run its typecheck and
tests. For authorized network tests, exercise the successful action, an
unauthorized holder, changed data and relevant restart behavior. Distinguish a
local validation failure from a real verifier refusal. Save exact commands,
observed outputs and public transaction or request references in an evidence
folder with the tested source. Redact private material and list unexecuted checks.
```

## 14. Build a read-only slot dashboard

```text
Build a simple dashboard for my application's slots using their public IDs and
the deployment manifest. Show each slot's mode, readiness, epoch and keeper
threshold from current public state. Explain unavailable or wrong-network results
without inventing data. Do not expose private credentials or recovery journals,
and do not suggest that a healthy registry proves protected operations will work.
```

Use [tasra-chain](../skills/tasra-chain/SKILL.md). Creating a UI framework project is
an application choice; the SDK supplies the deployment and slot operations.

## Review what the agent produced

Check that you can follow the generated runbook from a clean application folder.
Read the policy, consent behavior and state-storage choices, then inspect executed
tests and their actual outputs. Successful compilation is useful evidence, but it
does not prove wallet interoperability or live authorization. Skills improve the
agent's instructions; your application's behavior still needs verification.

[Application flows](flows.md) · [Complete TypeScript apps](README.md#build-an-app) ·
[Errors and recovery](errors.md)
