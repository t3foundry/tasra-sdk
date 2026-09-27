# Build with the application API

`tasra-sdk/app` is the starting point for new applications in the **unpublished
0.3.0-next.0 candidate**. Existing entry points remain available. This page explains
what application code owns and what the SDK checks.

## Install the candidate

In the SDK checkout, run `npm ci` and `npm pack`. In a new ESM TypeScript application:

```sh
npm install /absolute/path/tasra-sdk-0.3.0-next.0.tgz viem
npm install --save-dev typescript tsx @types/node
```

Use Node 22.12 or newer. Do not assume `npm install tasra-sdk` contains this candidate.
The [complete shared-account example](../examples/shared-account.ts) runs from the
installed package against the documented local deployment. Its address lookup and
signing now use this API.

## Configure once, choose a slot

```ts
import {createTasra, defineDeployment} from 'tasra-sdk/app'

const deployment = defineDeployment({
  schemaVersion: 1,
  name: 'My approved deployment',
  chainId: 43112,
  rpcUrl: 'http://127.0.0.1:9650/ext/bc/C/rpc',
  addresses: {
    KeyRegistry: '0x94c75679D75bfdc310669c0De4dE4398E922232b',
    NodeRegistry: '0xEA7A0602b6DB6Aa767C5649b4d5083c426Cb8083',
  },
  coordinator: 'lowest-operator-id',
})
const tasra = createTasra({deployment})
```

These are the local rehearsal addresses recorded on 26 September 2026. Redeployment
changes them. Public release manifests belong in
[tasra-releases](https://github.com/t3-foundry/tasra-releases); use the
[manifest verification procedure](fuji.md) for a public deployment. A descriptor
validates configuration shape; it does not authenticate whoever supplied it.
The current SDK/service version is not deployed on Fuji.

`await tasra.check()` checks the RPC chain and registry bytecode presence. It does
not certify keeper availability, enrollment, issuer compatibility or all operations.
Use `keeperUrl` only for a routing map your application approves, such as the
explicit Docker-to-loopback map in the runnable example.

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

The complete local example uses the explicitly configured local verifier agent
and creates synthetic credentials itself. That is a development issuer, not an
application enrollment service.

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

## Create safely and recover

```ts
import {prepareSlot, createPreparedSlot} from 'tasra-sdk/app'

const journal = prepareSlot(deployment, creatorAddress, {
  dcqlRule: JSON.stringify(rule), mode: 'tecdsa', authType: 'oid4vp', k: 2, n: 3,
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

On restart, load the latest snapshot and call `createPreparedSlot` again. Known
hashes are waited on and never resubmitted. A `submitting` step without a hash
raises `CreationReconciliationRequiredError`: recover the transaction hash from
the wallet/chain, check it belongs to this intent, then resume. Do not invent a
new slot or salt. Creation ends at the confirmed reveal; wait for DKG and call
`provisionRule` as shown in the complete example. A cancelled local wait cannot
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
