# Application flows

New to TASRA? Follow the [step-by-step learning path](README.md) first. This page
is a detailed reference for returning developers.

Build around an outcome: create a shared account, let a user approve a document,
or decrypt a file they are allowed to read. The application API combines the
protocol steps behind these outcomes so your app does not need to assemble
transaction state machines, credential presentations and threshold cryptography.

Start with `TasraClient` from `tasra-sdk/app`. Install with
`npm install tasra-sdk@latest`, then [connect your first app](getting-started.md).
See [installation](installation.md) for runtime and TypeScript setup. The snippets
below illustrate individual steps; the linked tutorials contain complete projects,
including fresh keys, funding, policies and storage.
Building with a coding agent? Use [Skills and example prompts](ai-development.md)
to turn these flows into application requests.

## Choose a flow

| Your application needs to… | Flow |
|---|---|
| Connect to a TASRA deployment | [Load a manifest](#connect-to-a-deployment) |
| Set up a usable slot and continue after an interruption | [Create and resume a slot](#create-and-resume-a-slot) |
| Create an account or connect a user's Ethereum wallet | [Use wallets and recorded transfers](#use-wallets-and-recorded-transfers) |
| Give users credentials for an application | [Create identities and credentials](#create-identities-and-credentials) |
| Ask a credential holder to authorize an action | [Authorize an exact operation](#authorize-an-exact-operation) |
| Let multiple eligible users use one Ethereum account | [Use a shared Ethereum account](#use-a-shared-ethereum-account) |
| Encrypt files and control who may decrypt them | [Encrypt and decrypt documents](#encrypt-and-decrypt-documents) |
| Produce a verified document signature | [Sign a document](#sign-a-document) |
| Require several people to approve one signature | [Collect multiple approvals](#collect-multiple-approvals) |
| Use an organization's identity provider | [Integrate OAuth authorization](#integrate-oauth-authorization) |

## Connect to a deployment

```ts
import {TasraClient} from 'tasra-sdk/app'

// manifest is a checksum-verified download from tasra-releases.
const tasra = new TasraClient({manifest, coordinator: 'lowest-operator-id'})
const status = await tasra.check()
```

The SDK resolves the chain, contract addresses and configured service endpoints.
`await TasraClient.fromManifest(manifestUrl, {sha256, coordinator})` downloads
and verifies a release manifest from tasra-releases. The coordinator convention
must match the selected deployment. You keep deployment configuration in one place instead of constructing a
separate client for every service.

Your app chooses a trusted deployment. Manifest shape validation does not prove
its authenticity; a hosted manifest can be pinned with an independently trusted
SHA-256 digest. `check()` checks the chain and registry bytecode, not end-to-end
keeper readiness or compatibility with a particular credential wallet. Release
manifests currently also need an explicit coordinator option.

[Connect and check a deployment](application-api.md#connect-using-the-deployments-manifest).

## Create and resume a slot

```ts
// creator is funded; store durably saves private state and locks each operation.
const account = await tasra.slots.create({
  name: 'team-account', mode: 'ecdsa', policy,
  threshold: {k: 2, n: 3}, verifiers: {committee: 3, quorum: 2},
}, {wallet: creator, store})
```

This one call saves the creation intent and salts, calculates the rule commitment,
executes commit/reveal, waits for distributed key generation, provisions the clear
rule to keepers and confirms the verifier policy. It returns a slot interface for
the selected mode:

| Mode | Resulting capability |
|---|---|
| `ecdsa` | Ethereum account and transaction signing |
| `bls` | Identity-based document encryption and authorized decryption |
| `frost` | Document signatures and native approval workflows |

You choose the access policy and thresholds, supply a funded creator and retain
the private store. The `policy` argument is the clear authorization rule; the SDK
computes its salted on-chain commitment. Advanced creation and provisioning APIs
accept that rule as `rule`.

Repeat the same call with the same name, request, creator, deployment and store
to continue its recorded progress. This avoids rebuilding a recovery state machine
in every application. It is not a guarantee of automatic recovery from every
failure: an uncertain submission without a hash needs reconciliation; expired
commitments and abandoned file locks have no automatic recovery. Preserve the
journal rather than changing the name to force another creation.

[Complete setup](application-api.md#create-a-wallet-identity-and-slot) ·
[Recovery boundaries](application-api.md#recovery-boundaries).

## Use wallets and recorded transfers

`tasra.wallets.create()` creates a local Ethereum wallet.
`await tasra.wallets.connect(provider)` connects an external EIP-1193 wallet,
requests account access and checks its selected chain. Your app decides when to
ask for access and handles any chain switch through the wallet.

```ts
// A stable name identifies this exact transfer in the private store.
const payment = await wallet.transfer('invoice-1042', {
  to: recipient, value: 1_000_000_000_000_000n,
}, store)
console.log(payment.hash)
```

The SDK records submission progress and waits for confirmation. Local and slot
wallets save signed bytes and their hash before broadcast. Reusing the same name
and request follows the recorded transaction; a different request under that name
is rejected. An unknown external-wallet outcome still needs reconciliation.

You persist a newly generated local wallet's exported private key before funding
it, protect that key and keep transaction records. The SDK does not automatically
fund accounts or choose payment recipients. A browser or database app supplies a
durable `ApplicationStore`; Node applications can use `createFileStore` from
`tasra-sdk/app/node`.

[Wallet setup and persistence](application-api.md#create-a-wallet-identity-and-slot) ·
[Shared account tutorial](shared-account.md).

## Create identities and credentials

```ts
const issuer = tasra.identities.create()
const alice = tasra.identities.create()
const credential = tasra.credentials.issue({
  issuer, holder: alice, type: 'urn:my-app:member', claims: {role: 'editor'},
})
const policy = tasra.credentials.policy({
  issuer, type: 'urn:my-app:member', claims: {role: ['editor']},
})
```

The SDK generates a `did:jwk` identity and key, issues a holder-bound SD-JWT
credential and builds a validated policy pinned to the chosen issuer. The
`credentials.verify()` helper checks supported signatures, lifetime and supplied
issuer, holder, credential type and subject pins. You do not need a separate application dependency
for these supported identity and credential operations.

Your app decides who may issue credentials and what membership means. Save keys
that must survive a restart and protect credentials. Local verification does not
establish issuer trust, check revocation or resolve `did:web` issuers. The built-in
helpers cover SD-JWT and supported key/DID formats; they are not a universal
credential-format converter.

[Issue credentials and authorize a user](application-api.md#issue-credentials-and-authorize-a-user).

## Authorize an exact operation

```ts
const authorize = tasra.credentials.authorize({
  verifierAgentUrl: tasra.verifierAgentUrl!, signer: creator.signer,
  identity: alice, credentials: [credential],
  approve: request => showConsent(request), // Your application presents the action.
})
```

Pass `authorize` to a slot's signing or decryption call. For each invocation the
SDK can ask for consent, opens an operation-specific verifier session, presents
the selected credential and collects authorization proofs. The protected slot
operation checks holder binding, expiry and the exact request before contacting
keepers. This replaces session, presentation and polling code in your app.

Passing credentials without an `approve` callback permits their presentation for
each requested operation. Your application owns the consent UI and selects a
trusted verifier. To present credentials to an existing request directly, use
`tasra.credentials.present(requestUri, identity, credentials, options)`.

For an **external credential wallet**, use
`registeredWalletAuthorization({client, signer, present})`. The `present` callback
displays the session's QR/deep link or runs your wallet integration; the SDK keeps
the selected registered agent and waits for that session's result. This is
separate from connecting an Ethereum wallet with `wallets.connect`.

External wallets and issuers must match the verifier's supported formats,
algorithms, trust configuration and holder-binding requirements. Compatibility
with every third-party implementation has not been established.

[Operation authorization and external wallets](application-api.md#authorize-each-exact-operation).

## Use a shared Ethereum account

```ts
const sharedWallet = await tasra.wallets.fromSlot(account.slotId, {authorize})
console.log(sharedWallet.address)
await sharedWallet.transfer('team-payment-1', {to: recipient, value: 1n}, store)
```

An ECDSA slot becomes a wallet backed by threshold signing. The SDK adapts message,
typed-data and transaction signing, asks for fresh authorization on each signature
and checks that the result matches the anchored Ethereum account. Different
eligible users supply their own authorizers to use the same slot.

Your app defines who is eligible, [funds the slot's TASRA usage balance](funding.md),
and sends AVAX to the slot's Ethereum address for payments and gas. A policy allowing Alice or Bob to act does not require both to
approve. Reading the address needs no credential presentation.

[Build the shared account app](shared-account.md) ·
[Integrate an Ethereum library](application-api.md#use-your-normal-ethereum-library).

## Encrypt and decrypt documents

```ts
const documents = await tasra.slots.bls(slotId)
const ciphertext = await documents.encrypt(documentIdentity, documentBytes)
const {plaintext} = await documents.decrypt(documentIdentity, ciphertext, {authorize})
```

Encryption uses the slot's anchored public key. Decryption obtains authorization,
collects threshold extraction shares, combines and checks the identity key, and
decrypts the bytes. The SDK clears temporary extraction material. You work with
file bytes rather than implementing distributed key extraction.

Your app stores the ciphertext and its identity, pins the issuer and requires a
credential scope matching that identity. Use a fresh identity for each immutable
document version. An explicitly extracted identity key remains a decryption
capability after an authorization token expires; token expiry cannot revoke an
already obtained key or plaintext. The current application flow does not provide
native multi-person approval for decryption.

[Build the encrypted notes app](encrypted-notes.md) ·
[Extraction and trust boundaries](application-api.md#encrypt-a-note).

## Sign a document

```ts
const documents = await tasra.slots.frost(slotId)
const signed = await documents.sign(documentManifestBytes, {authorize})
```

The SDK obtains authorization, coordinates threshold signing and verifies the
returned signature against the exact message, slot, epoch and anchored key.
Optional keeper receipts can be required with `requireReceipt: true`.

Your app defines the immutable bytes to sign, including a document digest and
workflow version, and stores the document and signature. A cryptographic signature
does not supply your application's review UI or establish legal-signature status.
Two detached signatures from two signer-specific slots and one signature requiring
a native approval quorum are different workflows.

[Build the document signing app](document-signing.md).

## Collect multiple approvals

Use `setApprovalPolicy(tasra, slotId, policy, {wallet, store})` to configure a FROST
slot with explicit approver keys or a credential policy and an approval quorum.
The helper records the policy transaction and checks the resulting on-chain policy.

Then `slot.approvals(...)` opens the approval client. Create a request for the exact
message, collect each person's `request.approve(...)`, and call `request.wait()`
for the verified final signature. `identityApprover(identity)` adapts an SDK
identity; `approveWithCredential(...)` presents a credential for the exact request
and signs its canonical approval payload.

This saves your app from implementing approval payloads, protocol polling and
final signature verification. Your app still provides the approval UI, pins the
expected policy and saves the original request ID, coordinator and message for
resume. A lost request ID after an ambiguous creation cannot currently be
automatically discovered. The approval quorum counts distinct approvers; the
keeper threshold counts cryptographic shares. Neither substitutes for the other.

[Complete static-key and credential approval examples](native-approvals.md).

## Integrate OAuth authorization

Create a slot with `authType: 'oauth'` and an OAuth policy using the
`oauth+access-token+dpop` query format. The creation flow validates the authorization
family, commits the rule and provisions the slot, just as for credential policies.

IdP sign-in is still an application integration. Obtain the IdP token and its bound
DPoP signer, then use `createOauthSession`, `submitOauthResponse` and
`waitForSession` from `tasra-sdk/verifier-agent` inside an `OperationAuthorizer`.
`credentials.authorize()` handles SD-JWT/OID4VP presentations; it does not acquire
or present OAuth tokens. Choose the trusted issuer, audience and token age in your
policy and keep token handling private.

[Credential and OAuth configuration](application-api.md#choose-credential-or-oauth-authorization).
