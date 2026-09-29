# Build with the application API

New to TASRA? Follow the [step-by-step learning path](README.md) first. This page
is a detailed reference for returning developers.

Start new applications with `TasraClient` from `tasra-sdk/app`. The SDK loads network
configuration, creates ready-to-use slots, adapts wallets, and issues and presents
credentials. Existing `createTasra` and lower-level APIs remain available. The application
chooses its policy, consent behavior and private storage; the SDK handles network
operations and cryptographic checks.

Install the latest SDK from npm as your application dependency. TypeScript and
`tsx` are development tools:

```sh
npm install tasra-sdk@latest
npm install --save-dev typescript tsx @types/node
```

## Connect using the deployment's manifest

Download network configuration from
[tasra-releases](https://github.com/t3-foundry/tasra-releases). For testnet,
`networks/testnet/current.json` names the manifest relative to `networks/testnet/`
and supplies its SHA-256 checksum. Read both files from the same reviewed commit.

```ts
import {TasraClient} from 'tasra-sdk/app'

// manifestUrl names the release manifest; sha256 comes from its trusted pointer.
const tasra = await TasraClient.fromManifest(manifestUrl, {
  sha256,
  coordinator: 'lowest-operator-id',
})
console.log(await tasra.check())
```

The coordinator option must match the deployment's convention; release manifests
do not currently record it. RPC and verifier URLs are resolved from the manifest's
services and network profile. Planned or retired records cannot configure a live
client. A checksum establishes integrity only when its source is trusted.

`check()` checks the RPC chain and registry bytecode presence. It does not certify
keeper availability, issuer acceptance or successful signing. Keep the manifest
revision and digest with the application, and review updates deliberately.

## Create a wallet, identity and slot

Continue with the client and deployment configuration loaded above. The creator wallet pays network fees;
fund its printed address through the network's faucet or a wallet you control.
The SDK generates fresh keys and preserves the same ones on restart.

```ts
import {TasraClient, createLocalWallet, createIdentity, credentialPolicy} from 'tasra-sdk/app'
import {createFileStore} from 'tasra-sdk/app/node'

const store = createFileStore('.tasra')
const tasra = await TasraClient.fromManifest(manifestUrl, {sha256, coordinator: 'lowest-operator-id', store})
const wallet = createLocalWallet(tasra.deployment, {
  privateKey: await store.load<`0x${string}`>('creator-key'),
})
await store.save('creator-key', wallet.exportPrivateKey())
console.log('Fund this creator address:', wallet.address)
if (await tasra.chain.client.getBalance({address: wallet.address}) === 0n) {
  throw new Error('Fund the saved creator wallet before running slot creation')
}

const issuer = createIdentity({seed: await store.load<Uint8Array>('issuer-key')})
await store.save('issuer-key', issuer.exportPrivateKey())
const policy = credentialPolicy({issuer, type: 'urn:my-app:member'})
const account = await tasra.slots.create({
  name: 'team-account', mode: 'ecdsa', policy,
  threshold: {k: 2, n: 3}, verifiers: {committee: 3, quorum: 2},
}, {wallet})
console.log('Shared account:', await account.getAddress())
```

You can also supply `wallet` in the `TasraClient` constructor when restoring an
existing creator. `tasra.wallets.create()` is the bound equivalent of
`createLocalWallet(tasra.deployment)`. Run creation after the creator has sufficient funds. `slots.create` commits the
access policy, saves recovery state, creates the slot, waits for key generation,
delivers the rule to its keepers and confirms the requested verifier policy.
Reusing the same name and request resumes the existing slot. An uncertain
transaction outcome stops for reconciliation; it does not silently create another
slot. Keep `.tasra` private and out of source control. `createFileStore` uses private
files and a process lock; a browser or database application supplies an
`ApplicationStore` with durable saves and exclusive locking.

Choose `mode: 'ecdsa'` for a shared Ethereum account, `'bls'` for encrypted documents,
or `'frost'` for document signatures. Keeper and verifier thresholds are explicit
application policy choices; the values above describe the example deployment.

## Choose credential or OAuth authorization

`slots.create` defaults to `authType: 'oid4vp'` for credential policies. For a
BYOIDP policy, pass `authType: 'oauth'` explicitly:

```ts
const account = await tasra.slots.create({
  name: 'workplace-account', mode: 'ecdsa', authType: 'oauth', policy: oauthPolicy,
  threshold: {k: 2, n: 3}, verifiers: {committee: 3, quorum: 2},
}, {wallet})
```

Here `oauthPolicy` is a validated DCQL JSON string whose credential queries use
`oauth+access-token+dpop`. Pin the IdP issuer, platform audience and token maximum
age; see [API overview’s OAuth section](api.md). Creation rejects policies whose query
formats disagree with the selected authorization type, including mixed credential
and OAuth policies. OAuth rules are still DCQL and use the same canonical JSON
commitment calculation as credential DCQL rules.

`credentials.authorize()` presents SD-JWT credentials through OID4VP; it does not
obtain or present an OAuth token. For OAuth operations, use the existing
`createOauthSession`, `submitOauthResponse` and `waitForSession` exports from
`tasra-sdk/verifier-agent` with a token from your IdP and its bound DPoP signer.
Connect that operation-bound flow to your application's `OperationAuthorizer`;
selecting `authType` at creation does not implement IdP sign-in for your app.

## Recovery boundaries

A normal interruption that lets the operation settle releases its store lock. Restart
with the same wallet, manifest, slot name and request to resume recorded transaction
hashes. A submission without a hash requires reconciliation; never delete the journal
or change the slot name to force a retry.

An abrupt process kill can leave a `createFileStore` lock behind. The SDK deliberately
does not expire or steal locks, and currently has no public stale-lock recovery method.
Stop, preserve the private store, establish that the owning process has ended, and
reconcile outstanding transactions before any manual intervention. Do not infer that
an old lock is safe to remove from its age alone.

The named `slots.create` workflow currently has no automatic expired-commit recovery
or public journal-reset operation. Preserve its journal and report this as unsupported
recovery. Low-level expiry checks do not themselves safely transition a named-slot
journal. Unavailable DKG is a readiness failure: keep the same intent, inspect the
deployment, and resume only when it can progress. It is not permission to create
a replacement slot or to bypass authorization.

## Fund a fresh creator

Create and privately save the creator wallet before requesting funds. Print its
public address, then use the selected network's faucet or transfer from a wallet
you control. A faucet URL must come from the network's published configuration;
the SDK does not infer one from the chain ID. No shared private key is required.

```ts
console.log('Creator address:', wallet.address)
console.log('Native balance:', await tasra.chain.client.getBalance({address: wallet.address}))
```

On Avalanche, fund the creator with AVAX for transaction fees. Then buy TASRA
with EURC through the bonding curve and deposit TASRA into the slot's Settlement
balance. Follow [Buy TASRA and fund your slot](funding.md) for the faucet link,
commands and balance checks. An Ethereum slot account also needs its own AVAX
for sending transactions. Funding does not grant permission to sign or decrypt;
each protected operation still needs valid authorization.

## Issue credentials and authorize a user

```ts
const alice = tasra.identities.create()
const credential = tasra.credentials.issue({
  issuer, holder: alice, type: 'urn:my-app:member', claims: {name: 'Alice'},
})
const authorize = tasra.credentials.authorize({
  verifierAgentUrl: tasra.verifierAgentUrl!, signer: wallet.signer,
  identity: alice, credentials: [credential],
})
const sharedWallet = await tasra.wallets.fromSlot(account.slotId, {authorize})
console.log(sharedWallet.address)
// A named transfer saves its signed bytes/hash and waits for confirmation.
// await sharedWallet.transfer('first-payment', {to: recipient, value: 1n}, store)
```

Each invocation opens a new operation-bound session and presents the credential.
The API does not promise that every token field changes between repeated operations:
`vp_hash` is not a session identifier or a uniqueness check. When testing fresh
wallet interactions, observe the session creation and presentation, alongside the
SDK's checks of operation binding and expiry; do not require unequal `vp_hash` values.

The application approves the credential issuer in the slot policy. Locally issued
credentials are for development unless your deployment trusts that issuer.
`identities.create` creates a `did:jwk` identity; save its explicitly exported key
if it must survive a restart. `credentials.issue`, `verify`, `present` and `authorize`
handle SD-JWT credentials and OID4VP presentations. Local credential verification
checks signatures, lifetime and supplied pins; it does not check revocation or
establish trust in an issuer.

Passing credentials to `authorize` permits their presentation for each exact
operation. Supply its `approve` callback to show your own consent screen. The SDK
creates the session, presents the credential, polls the result and checks the
operation binding. For an external Ethereum wallet, use
`await tasra.wallets.connect(provider)`; it requests account access and checks the
selected chain. The existing `toViemAccount` adapter remains available for advanced
Ethereum integrations, with viem installed by the SDK.

## Read an Ethereum address

```ts
const account = await tasra.slots.ecdsa(slotId)
console.log(await account.getAddress())
```

No credential, signer or wallet session is needed. The SDK checks that the slot
exists, is active, has completed key generation and uses secp256k1 tECDSA.

## Authorize each exact operation

An `OperationAuthorizer` receives the exact chain, registry, slot, action and
payload. Your app presents the wallet interaction and returns its compound token
and verifier membership proofs. The SDK checks request binding, holder binding,
expiry and slot stability before contacting a keeper.

Use `registeredWalletAuthorization({client, signer, present})` with an independently
approved registered agent. Its `present(session, signal)` callback displays a QR
or performs the app's credential-wallet flow. It polls the original authenticated
session and never transfers authorization to a fallback provider.

The examples use the manifest’s verifier agent and create their own issuer and
holder credentials. The verifier must support those formats and accept the issuer
pinned by the slot. Production enrollment and issuer governance belong to the application.

## Use your normal Ethereum library

```ts
import {toViemAccount} from 'tasra-sdk/app'

const walletAccount = await toViemAccount(account, {authorize})
const signature = await walletAccount.signMessage({message: 'Hello Tasra'})
// Or pass walletAccount to viem's createWalletClient.
```

Each signing call requests fresh authorization. The adapter supports message,
typed-data and transaction signing, verifies the recovered account, and does not
broadcast automatically. Store a signed transaction and its hash before sending
it; after a lost response, look up that hash before considering another submission.

## Encrypt a note

```ts
const notes = await tasra.slots.bls(slotId)
// issuerDid is the trusted credential issuer pinned by this slot's rule.
const identity = `${issuerDid}/notes/${crypto.randomUUID()}/version/1`
const ciphertext = await notes.encrypt(identity, new TextEncoder().encode('Hello'))
const {plaintext, evidence} = await notes.decrypt(identity, ciphertext, {authorize})
```

This uses `kk_scope_namespace: 'issuer'`: the credential must grant this identity,
and the committed rule must require the scope claim. The complete
[encrypted-notes app](../examples/encrypted-notes.ts) shows issuer, rule and credential setup.

Encryption needs only the anchored public key. Decryption requires a distinct
assigned keeper quorum, one epoch, valid shares and a combined identity key matching
the chain-anchored group key. Temporary extraction shares and the intermediate
identity key are cleared. The returned plaintext belongs to your app.

Use a fresh identity for every immutable document version. An extracted identity
key is a durable capability: token expiry does not revoke it. `extractIdentity`
returns that capability only when your app explicitly needs custody.

The application path reports `shareTrust: 'anchored-group'`. It does **not** claim
independently authenticated per-keeper verifying shares. Advanced callers with
independent share certificates can use `extractIdentityStrict` with `pinned-shares`.

## Sign a document

```ts
const signer = await tasra.slots.frost(slotId)
const signed = await signer.sign(documentManifestBytes, {authorize})
```

The SDK verifies the exact message, slot, epoch, anchored key and FROST signature.
Keep the immutable document digest and workflow request/version in the signed
manifest. For a two-person document workflow, use two signer-specific slots and
require two independent signatures. A native quorum on one slot is a different
workflow; see [native approvals](native-approvals.md).

## Require two approvals for one signature

For native FROST approvals, `setApprovalPolicy(tasra, slotId, policy, {wallet, store})`
sets and checks the on-chain policy through a durable transaction. Choose explicit
Ed25519 `approvers` with a `quorum`, or an exact `credentialPolicy` with a `quorum`.
`identityApprover(identity)` adapts an SDK Ed25519 identity to `request.approve`.
`approveWithCredential(tasra, request, message, {identity, authorize})` presents a
credential bound to that request before signing its canonical approval payload.
These helpers preserve the existing [native approval lifecycle](native-approvals.md),
including distinct approvers and refusal of cross-request replay.

## Advanced creation and recovery

```ts
import {prepareSlot, createPreparedSlot} from 'tasra-sdk/app'

const journal = prepareSlot(deployment, creatorAddress, {
  rule: JSON.stringify(rule), mode: 'tecdsa', authType: 'oid4vp', k: 2, n: 3,
})
const created = await createPreparedSlot(journal, {
  wallet: creatorWallet,
  persist: async snapshot => database.saveAtomically(snapshot),
})
```

`prepareSlot` creates the slot ID and both salts before network writes. The journal
contains private rule/recovery data; keep it out of public evidence. `persist` must
commit each snapshot before resolving. Serialize runs for the same intent with a
database lock or a single process. The SDK does not provide cross-tab locking.
Creation and provisioning require `rule`; `dcqlRule` is rejected even alongside
`rule`. Older journals must be explicitly migrated before resuming: follow the
[rule and recovery-state migration](consumer-migrations.md#use-generic-rule-names)
and preserve their exact policy, salts and transaction history.

On restart, load the latest snapshot and call `createPreparedSlot` again. Known
hashes are waited on and never resubmitted. A `submitting` step without a hash
raises `CreationReconciliationRequiredError`: recover the transaction hash from
the wallet/chain, check it belongs to this intent, then resume. Do not invent a
new slot or salt. The lower-level `createPreparedSlot` ends at the confirmed reveal; its caller waits
for DKG and calls `provisionRule`. The beginner `tasra.slots.create` method performs
those steps and configures the verifier policy for you. A cancelled local wait cannot
cancel a transaction already sent.

## Evidence and errors

FROST signing and IBE extraction preserve optional keeper receipts. The SDK checks
those receipts against the serving keeper key and expected operation references.
Use `requireReceipt` for FROST or `requireReceipts` for IBE to require their presence.
Unsigned replies are explicitly `absent`; a malformed or invalid receipt fails.
ECDSA and native dual-sign routes are not promised to emit these attestations.

Handle `TasraApplicationError.code` for chain mismatch, absent/cancelled slot,
wrong mode, unfinished DKG, changed slot, invalid grant or invalid result. Treat
HTTP 401/403 as refusals. Do not log raw grant objects or HTTP request bodies.

Task-context enforcement and native multi-approver IBE are not supported. Enforce
application-specific task boundaries in your own application; do not infer an IBE
approval quorum from the native FROST approval API.
