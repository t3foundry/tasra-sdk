# Fund a slot for use

Creating a slot prepares its key and access policy. Before signing or decrypting,
add **TASRA usage credits**. The token symbol used by the SDK is **TSRA**.

There are three steps:

1. Send **AVAX to the creator wallet** to pay transaction gas.
2. Buy **TSRA with EURC** from the network's **BondingCurve** contract.
3. Deposit **TSRA into the slot's Settlement balance**.

AVAX is not sent to a slot ID. An Ethereum slot's derived account separately needs
AVAX when it sends Ethereum transactions. Its account balance is not usage credit.

## Prepaid deployment protocol

The certification deployment requires a mined TASRA reservation before verification or
keeper work. Depositing funds alone does not create that reservation. The SDK's existing
one-call application helpers do not yet orchestrate this complete lifecycle.

For clients integrating with an independently verified reservation service,
`tasra-sdk/committee` exports `PaymentIntentWire`, `paymentIntentTypedData`,
`paymentIntentHash`, `keeperAssignmentCommitment` and `paymentSessionCommitment`.
The payment intent binds the deployment, slot, exact operation, fee cap, presentation
session, verifier committee and keeper assignment. Amounts use decimal TASRA base-unit
strings. JSON integer inputs must be safe integers; unsafe numbers are refused.

The creator signs the typed data. A presentation delegate has no implicit spending
authority. Verify the deployment, current assignment, fee quote, creator signature and
mined reservation independently before opening a session. Hashing an intent does not
establish any of those facts.

Before constructing an intent, use `discoverPaidOperationContext` from `tasra-sdk/chain`.
Supply independently approved Settlement, KeyRegistry, VerifierSetRegistry and beacon
addresses. It checks the registry beacon pointers and reads the keeper sharing, eligible
workers and anchored verifier context at one fresh canonical block. If the current epoch
has no snapshot, only the immediately preceding epoch is eligible as a fallback.

```ts
import {discoverPaidOperationContext} from 'tasra-sdk/chain'

const context = await discoverPaidOperationContext(client, {
  ...deployment,
  verifierSet,
  beacon,
}, slotId, {
  defaultVerificationPolicy: {committee: 3, quorum: 2},
})
const unsignedPayment = {
  ...context.intentFields,
  action,
  payload_digest: payloadDigest,
  nonce,
  max_cost: maximumTasraCost,
  expires,
  session_commitment: paymentSessionCommitment(random, audience, expires),
}
```

Use the verifier defaults approved for your deployment; the numbers above are examples.
A slot's nonzero policy overrides them. Missing defaults for a slot with no override are
refused. Discovery selects the eligible assigned keeper with the lowest registered operator
ID as coordinator, or accepts an explicit `coordinator` address. The intent includes all
currently eligible assigned contributors. It refuses fewer contributors than the threshold.

The result includes the creator, published group key, endpoints, available TASRA and block
identity. Only `intentFields` belongs in the payment preimage. The application still chooses
the exact operation digest, fresh nonce and presentation random, audience, fee cap and expiry;
the creator must review and sign them. A positive balance is not a fee quote or reserved
credit. Discovery makes no service request or transaction, and later reservation and
execution checks must revalidate chain state. HTTPS is required except with the explicit
`allowLocalHttp` option on local chain43112; that option never enables HTTP on Fuji.

For direct reservation submission, call `reservePaidOperation` from `tasra-sdk/chain`
with the signed intent, an independently selected deployment and expected operation,
a Viem public client, and an account-bound Viem gas-payer wallet. It gathers the same
quote from the supplied accountants, compares the deployment's digest, recovers the
creator signature and simulates the threshold-authorized contract call. All reads for
the quote use its fresh canonical block; unsupported canonical reads fail.

Set `maxGas` and `maxGasPrice` explicitly. These limit native transaction gas; the
intent's `max_cost` separately limits TASRA. Supply trusted, bounded clients and
accountant HTTPS endpoints. `allowLocalHttp` permits HTTP only on chain43112.
The function does not mint tokens, fund a wallet, enable a slot or create a new intent.
Use the discovery helper above before creator signing.

Its required `persist` callback is part of the spending guarantee. On `prepared`,
atomically create a durable record keyed by `record.requestId` and reject an existing
record, including concurrent attempts. Resolve only after the record survives process
loss. On `submitted` and `confirmed`, durably update that same record. A process-local
map or a no-op callback is insufficient. Use the application's transactional database
or an equivalently durable exclusive file journal; never overwrite or delete an
uncertain preparation to enable a retry. Keep the presentation random and audience
alongside the intent in the application's session journal.

`createPaidReservationJournal` from `tasra-sdk/app` supplies this callback for an
`ApplicationStore`. For Node.js, use `createFileStore` from `tasra-sdk/app/node` in a
private directory. Browser applications must supply durable storage and exclusive locks
shared across tabs; an in-memory store does not meet this contract.

```ts
import {createPaidReservationJournal} from 'tasra-sdk/app'
import {createFileStore} from 'tasra-sdk/app/node'

const store = createFileStore('.tasra/payments')
const journal = createPaidReservationJournal(store, payment, {random, audience})
const result = await reservePaidOperation(client, wallet, deployment, payment, expected, {
  ...limits,
  persist: journal.persist,
})
```

The adapter checks the session commitment, durably retains the original intent, quote,
transaction, random and audience before submission, and refuses any existing preparation.
It also refuses changed hashes and out-of-order checkpoint updates. After restart,
`loadPaidReservationJournal(store, requestId)` reads the saved evidence without network I/O.
A saved `confirmed` phase may have become orphaned: recheck canonical chain state before
using it. A `prepared` record without a hash may still have been broadcast. Reconcile that
original transaction using its saved payer and nonce; never delete the record to retry.
This adapter coordinates each reservation identity. Other operations sharing a gas payer
still need application-wide nonce coordination.

Only after durable preparation does the helper submit one transaction. It neither
retries through another wallet method nor replaces a transaction. It checks the mined
transaction against the saved nonce, sender, call data and gas bounds, then checks the
canonical reservation's exact cost and assignment block. A successful return includes
the transaction hash and reservation receipt. `PaidReservationUncertainError` carries
the request ID and any known hash; inspect the journal and `readPaidOperationReceipt`
before further spending. Absence of a hash or an HTTP response does not prove that
the transaction was never sent. Other uses of the gas-payer account must coordinate
nonces with this application.

For a local signer, it also decodes the returned signed bytes and recovers their sender before
broadcast, checking every saved transaction field and rechecking expiry after signing.
A lost or incorrect RPC reply leaves the locally computed hash in the uncertainty error;
retain that error's hash with your recovery evidence. The prepared journal still survives
if no subsequent checkpoint can be saved. The selected payer and chain are captured before
asynchronous work so callback changes cannot redirect the request.

After restart, `reconcilePaidReservation` checks the transaction against the original durable
record without requesting a quote, signing, broadcasting or changing the journal:

```ts
import {loadPaidReservationJournal} from 'tasra-sdk/app'
import {reconcilePaidReservation} from 'tasra-sdk/chain'

const saved = await loadPaidReservationJournal(store, requestId)
if (!saved) throw new Error('Original reservation journal is required')
const transactionHash = saved.transactionHash ?? independentlyRecoveredHash
const resolution = await reconcilePaidReservation(
  client, deployment, saved.record, expected, transactionHash, 2,
)
console.log(resolution.status, resolution.gasCost)
```

The candidate hash may come from the journal or an independent search for the original
payer/nonce. A matching hash alone is insufficient: the SDK checks sender, destination,
nonce, call data, value, chain, transaction type and gas bounds against the saved record.
It verifies creator consent using the original canonical quote block and requires the
requested confirmation depth at a fresh head. The RPC must retain that historical state;
missing state, unknown transactions, reorgs or missing receipts never become evidence of
non-submission. Expired intents can still be inspected. A successful result includes current
reservation state, even after final settlement or a refund. A reverted result proves only
that this original transaction reverted; another transaction may have reserved the same intent.
`gasCost` is the original transaction's consumed native gas in wei, not TASRA usage charges.
Neither result authorizes another spend or keeper operation. Keep the original journal;
the helper does not clear a payer lock, retry a payment or resume an expired session.

Pass the same `payment` and committed `random` to `createOid4vpSession`,
`createOauthSession` or `openVerifierAgentSession`. For the high-level session helper,
keep the original operation expiry fixed with `nowSecs` and `ttlSecs`; it must match
the expiry committed before reservation. The verifier-agent checks the session random
and its configured audience against that commitment. `awaitVerifierAgentResult` checks
that the returned token preserves the expected payment hash and its preimage.

The registered-provider path supports the same `payment` and `random` through
`openRegisteredVerifierAgentSession`. Its operation expiry must equal the intent expiry.
It validates the random/audience commitment against the selected approved agent profile
before disclosure and never falls back to another paid provider. The returned session
retains an immutable payment commitment and defensive copies of the intent. The registered
wallet-request check compares the disclosed payment, seed, epoch, snapshot, policy and
random with that intent before presentation, even if a changed context produces a
self-consistent nonce. Registered result polling rejects a missing or substituted payment.
An uncertain paid creation error retains `paymentHash`; reconcile the original payment
before trying another session.

For direct verifier integration, `committeeAuthorize` and `gatherCommitteeToken` carry
the payment with the matching request binding and pinned verification epoch. The
assembled token includes both `payment_hash` and `payment`.

`tasra-sdk/chain` provides `readSlotFunding` for available, reserved and total TASRA,
and `readPaidOperationReceipt` for the exact operation's existing reservation. Both pin
reads to one fresh canonical block using EIP-1898 and refuse unsupported canonical reads,
stale heads and reorgs. The receipt also retains original cost and refunded amount after
settlement; reading it never authorizes another execution.

Use `resolvePaidKeeperTarget` with an independently selected deployment, slot, action and
payload digest. It checks the reservation, recovers the creator signature, verifies the
current sharing against the signed keeper assignment, and returns the assigned
coordinator, signed contributor endpoints and the slot's group public key. It never contacts the
keeper and refuses a settled payment. Supply a bounded, trusted Viem public client. HTTPS is the default; development
HTTP requires `allowLocalHttp: true` and chain43112 together. Fuji always requires HTTPS.
Private endpoint access and custom CA trust remain the application's transport policy.

Send the grant to that coordinator using the matching key-operation client and verify
the result against the discovered group key. Do not fail over a paid request to another keeper,
create a replacement reservation automatically, or treat an HTTP timeout as proof that
no work occurred. Keep the payment and operation identity for reconciliation.

The application ECDSA `signDigest`, FROST `sign`, and BLS `extractIdentity` / `decrypt`
methods accept `{authorize, payment, random}` for an already reserved operation. They
check canonical backing and current assignment before requesting credentials and again
after authorization. The authorization callback receives a defensive payment copy and
the original expiry through `nowSecs` / `ttlSecs`; registered wallet and credential
authorizers forward these to session creation. A changed or missing payment in the grant
is refused before contacting a keeper. Signatures use the paid coordinator; IBE extraction
uses only the signed contributors. Results are still cryptographically verified.
Custom `keeperUrl` mappings must preserve HTTPS. Local HTTP additionally requires
`allowLocalPaidHttp: true` on the application client and chain43112. The application does
not fail over a paid attempt or submit a replacement reservation. Each operation needs
its own payment; do not reuse one fixed payment for multiple Viem account calls.

Paid token signatures use a separate domain; existing unpaid token bytes stay unchanged.
This encoding compatibility does not enable unpaid service on a prepaid deployment.
The helpers cover discovery, reservation journaling and execution separately. Application-wide
gas nonce coordination and automatic final settlement orchestration remain separate work;
the helpers above do not claim a complete prepaid client.

## 1. Fund the creator with AVAX

Run the [creation lesson](create-slot.md) to print your saved creator address.
For the downloaded Fuji manifest, use the
[official Avalanche Fuji C-Chain faucet](https://core.app/tools/testnet-faucet/?subnet=c&token=c)
and send test AVAX to that `0x` address on chain **43113**. The faucet may require
eligibility or a coupon; see [Avalanche's instructions](https://support.avax.network/en/articles/6110239-is-there-an-avax-faucet).
You can also transfer AVAX from a wallet you control on the same network.

Keep enough AVAX for creation, token approvals, purchases and deposits. Then rerun
creation. A nonzero gas balance does not guarantee every transaction can be paid.

## 2. Inspect the saved account and slot

Continue in the same project with its original `network.json`, `network-pin.json`
and private `.tasra/` state. Copy the funding command:

```sh
cp node_modules/tasra-sdk/examples/fund-slot.ts .
npx tsc --noEmit
npx tsx fund-slot.ts .tasra/first-slot status
```

For an application tutorial, replace `.tasra/first-slot` with the directory printed
by that app. It prints a complete status command when its slot needs credit.
The command restores the creator key; it never creates a replacement account.

Keep a terminal demo running while funding it in a second terminal, from the same
project directory. It waits up to 15 minutes. If it has exited, rerunning that demo
creates fresh state; funding its old slot will not resume the exited run. The first-slot
lessons and the web document app save state for later runs.

## 3. Buy TSRA with EURC

The curve accepts **EURC, not AVAX**. The funding helper reads the curve's EURC
token address from the contract named by your verified manifest; the manifest may
omit a separate token entry. The Fuji deployment uses test EURC; this optional command explicitly
mints **10 test EURC** to the saved creator:

```sh
npx tsx fund-slot.ts .tasra/first-slot mint-test-eurc 10000000
```

The SDK permits this only for a supported mock token. Real EURC must be acquired
and transferred to your creator wallet; it cannot be minted with this command.

Choose how much EURC to spend and the smallest TSRA output you will accept.
The following example spends **10 EURC** and requires at least **1 TSRA**. It reverts
if the curve cannot satisfy that minimum; these amounts are an example budget,
not a quoted exchange rate or a guarantee of how many operations you can run.

```sh
npx tsx fund-slot.ts .tasra/first-slot buy 10000000 1000000000000000000
```

Internally the command uses two confirmed SDK calls:

```ts
await writer.approveEurcForCurve(eurcAmount)
await writer.buyTsra(eurcAmount, minimumTsraOut)
```

**Success:** an approval hash, purchase hash and updated wallet TSRA balance.
Buying TSRA does not automatically credit a slot.

## 4. Deposit TSRA into the slot

This example deposits **1 TSRA** from your saved creator wallet:

```sh
npx tsx fund-slot.ts .tasra/first-slot fund 1000000000000000000
npx tsx fund-slot.ts .tasra/first-slot status
```

The SDK approves Settlement and confirms the deposit:

```ts
const {fundTx} = await writer.fundSlot(slotId, slotCredits)
console.log('Funding transaction:', fundTx)
console.log('Slot credit:', await writer.settlementBalance(slotId))
```

**Success:** a funding transaction hash and nonzero slot TSRA credit. Usage consumes
credit; top up according to the selected network's charges. A positive balance
alone does not guarantee sufficient credit for every operation.

All command amounts are **integer base units**: EURC has 6 decimals and TSRA has
18. The output labels these units. No extra token or wallet library is needed.

<details>
<summary>Several slots, transaction retries and recovery</summary>

Fund each slot separately. Add `--slot` with the ID printed by your application:

```sh
npx tsx fund-slot.ts .tasra/first-slot status --slot YOUR_PRINTED_SLOT_ID
npx tsx fund-slot.ts .tasra/first-slot fund 1000000000000000000 --slot YOUR_PRINTED_SLOT_ID
```

Replace `YOUR_PRINTED_SLOT_ID` with the full `0x` slot ID. The command checks that
the slot exists and is not cancelled before depositing. Keep the original network
manifest; a different snapshot is rejected for this saved state.

Each explicit `buy`, `mint-test-eurc` or `fund` invocation submits new transactions.
It is not a resumable payment journal. After a timeout or uncertain result,
inspect the recorded transaction and balances before deciding what to do next.
Do not blindly repeat a purchase or deposit. A confirmed approval may remain even
if its following purchase or deposit fails.

</details>

**Next: [Read your slot →](read-slot.md)**
