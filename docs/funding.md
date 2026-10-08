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

### Detect the billing mode first

A deployment bills either by metering (legacy, `Settlement.version()` is `"1"`, for example
`tasra.fuji.v1`) or per operation from a prepaid reservation (`"2"`). Nothing off-chain
reports which, so read it from the Settlement contract before choosing a flow:

```ts
import {createBillingModeDetector} from 'tasra-sdk/chain'

const billing = createBillingModeDetector(publicClient, {chainId, settlement})
const {mode} = await billing.mode(slotId) // 'legacy' | 'prepaid' | 'unknown'
```

Version `"2"` is prepaid for a slot once `prepaidEnabled(slot)` is set, and for every slot of a
prepaid-from-genesis deployment (its first funding enables it). An upgraded deployment keeps
a slot on legacy billing until its cutover. Any other version, a failed read, a chain mismatch
or a reorganized block is `unknown`: start neither flow. The detector caches `prepaid`
(one-way per slot) until `invalidate`, `legacy` for `legacyTtlMs` (default 60 s), and
never `unknown`. Paid entry points such as `discoverPaidOperationContext` throw
`BillingModeError` (`mode`, `settlementVersion`) on a legacy or unreadable slot;
`requirePrepaidSlot` is the same guard on its own. `readSlotFunding` on a version `"1"`
Settlement reports the balance with `enabled: false`, `reserved: 0n` and
`settlementVersion: '1'`.

The certification deployment requires a mined TASRA reservation before verification or
keeper work. Depositing funds alone does not create that reservation. `paidOperation`
from `tasra-sdk/app` runs the complete lifecycle for one operation; the primitives below
remain available for applications that compose it themselves.

### One paid operation

```ts
import {paidOperation, resumePaidOperation, PaidOperationRecoveryError} from 'tasra-sdk/app'
import {createFileStore} from 'tasra-sdk/app/node'
import {createNodePaidAgentTransport} from 'tasra-sdk/chain/node'

const config = {chain, deployment, creator, gasPayer, store: createFileStore(stateDir),
  agent: {profile, transport: createNodePaidAgentTransport()}, accountantUrls,
  limits: {maxCost, maxGas, maxGasPrice}}
const op = await paidOperation(config, {slot, operation: {action: 'sign', message},
  rule: {rule, salt}, holder})
const signature = await op.execute(() => committeeSign({nodeUrl: op.coordinatorUrl,
  committeeToken: op.compound_token, message, verifierProofs: op.verifierProofs,
  approveExecution: op.approveExecution}))
op.dispose()
```

It refuses a legacy or unreadable slot (`BillingModeError`), checks the creator and the
slot's salted rule commitment, signs the operation and payment intent, verifies the drawn
verifier witnesses from an approved accountant's snapshot, reserves through
`reserveApplicationPayment` with the caller's dedicated gas payer, certifies a local
execution key, drives the registered session (`drivePaidSession`) and verifies the grant.
`holder` is `{kind: 'local', makePresentation, submit}` when the SDK wallet presents
(`makePresentation(request, {requestUri, qrPayload})`, plus an optional `present` hook with
the same link, so applications never rebuild the request URI), or
`{kind: 'external', present, accept}` when a phone wallet scans `qrPayload` and the
application accepts the complete retained presentation.

Each billable step is journaled in the store before it is sent. When an outcome is
uncertain the call throws `PaidOperationRecoveryError` (`requestId`, `phase`:
`reservation`, `session` or `execution`, a stable `code` and `resumable`). `resumable`
separates a final refusal (`session-refused`, `reservation-failed`, `payment-expired`) and
steps only reconciliation or `recover` can settle from an interruption worth resuming. Never call `paidOperation` again for that
work, which would pay twice. Call `resumePaidOperation(config, requestId, {holder})`: it
re-reads the session and skips confirmed writes, and refuses any write whose outcome is
unknown. Cancelling through `signal` after the operation is journaled throws code
`aborted`, resumable unless the payment expired, when the step sent nothing uncertain; if
a reservation or session write may have been sent, that step's uncertain code is reported
instead. An abort before the journal is written rethrows the signal's reason: nothing was
sent.

A reservation still in flight is reconciled on chain first, by the deterministic request ID
and the gas payer's nonce, so no transaction hash is needed (a local signer's hash is
journaled before broadcast anyway; pass `transactionHash` to prove a mined original
sooner). The chain holding the reservation advances the operation. A quote deadline passed
without one marks it `failed`: it is never reserved again. Anything else stays
`reserving`, the call throws and the gas payer stays locked. Resume makes a first
reservation only when nothing was ever prepared for the request (no journal, no payer
claim, nothing on chain). To inspect without any billable or keeper work, use
`reconcilePaidOperation(config, requestId)` (or `resumePaidOperation` with
`reconcileOnly: true`); it returns `{phase, reservation, payerLocked, next}`, where
`next` is `reserve`, `resume`, `wait`, `recover`, `done`, `abandon` or `closed`.
For `recover`, `recoverPaidOperation(config, requestId)` opens the read-only `recover` and
`recoverIbePartials` straight from the journal, without a holder or a full resume.
Journals written before SDK commit dfafff3 did not record the assigned contributors: they
support `recover` but not `recoverIbePartials`.
`reconcileApplicationReservation` is the same proof for applications composing
`reserveApplicationPayment` themselves.

Pass `onRequestId` to `paidOperation` to receive the request ID as soon as it is derived,
before anything is reserved, to link an in-flight run to its payment.
`listPaidOperations(store, {phase})` lists journaled operations (`requestId`, `phase`,
`slot`, `action`, `expires`, the recorded gas `payer`), e.g. `{phase: ['reserving',
'certified', 'executing']}` at startup for work to reconcile, without reading the store's
key scheme. `{backfill: true}` once indexes journals written before the index existed
(the built-in stores can list their keys).

`abandonPaidOperation(store, requestId, {reason})` closes an operation for good, only when
nothing can still land under it: a reservation never prepared, a `failed` or `executed`
operation, or any other phase once its payment has expired (plus a two-minute skew margin).
Otherwise it throws `PaidOperationAbandonRefusedError` (`notBefore` says when expiry
unblocks it); a prepared reservation must be settled by `reconcilePaidOperation` first.
Abandoned operations are left out of `listPaidOperations` unless `includeAbandoned` (or
phase `abandoned`) is asked for, and `resumePaidOperation` refuses them.

One gas payer serializes reservations, and an uncertain one keeps it locked until
reconciled. To spread load, keep a few dedicated payers and pick one per operation with
`selectApplicationGasPayer(store, wallets)`: it skips payers holding an unresolved claim,
prefers payers idle in this process and rotates round-robin; `undefined` means every payer
needs reconciliation. Pass the chosen wallet as that operation's `gasPayer`. The journal
records it, and a reserving operation resumes only with that payer; pass `{resume:
requestId}` to `selectApplicationGasPayer` to get it back from the pool. `execute` runs once; after an
uncertain execution use `op.recover({transport: createNodeKeeperRecoveryTransport()})`
to read the keeper's retained result. An identity extraction fans out to every assigned
contributor; after a lost reply, `op.recoverIbePartials({transport})` reads each
contributor's retained, commitment-verified partial (bounded concurrency, stopping at the
payment's keeper threshold) and returns them in the shape the IBE combine helpers accept,
never re-sending an extraction. In a browser, `createBrowserKeeperRecoveryTransport({allowLocalHttp:
true})` reads local development keepers over HTTP (loopback and private hosts only).
`createMemoryStore` suits tests only.

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
Supply independently approved Settlement, KeyRegistry, VerifierSetRegistry, AccountantSetRegistry and beacon
addresses. It checks the registry beacon pointers and reads the keeper sharing, eligible
workers and anchored verifier context at one fresh canonical block. The selected epoch must
have both verifier and accountant snapshots. If either current snapshot is missing, only
the immediately preceding epoch is eligible as a fallback.

```ts
import {discoverPaidOperationContext} from 'tasra-sdk/chain'

const context = await discoverPaidOperationContext(client, {
  ...deployment,
  verifierSet,
  accountantSet,
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

Credential approvals use `action: 'dual-approve'` and their exact approval payload digest.
Each holder's approval has its own intent, session and reservation. These payments do not
fund the final keeper signature, which requires a separate `sign` intent and reservation.
The final paid signature uses the separate native dual-control lifecycle described below.

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
shared across tabs; an in-memory store does not meet this contract. `createIndexedDbStore`
from `tasra-sdk/app/browser` does: each `save` resolves only after a strict-durability
IndexedDB commit, and `withLock` takes an exclusive Web Lock shared by every tab, worker
and extension service worker of the origin (`failIfLocked: true` refuses instead of
waiting). The same entry provides fetch transports for paid sessions, keeper result
recovery and relayers. They use the Node transports' route, method, bearer and bound
checks, require HTTPS, send no cookies, follow no redirects and refuse loopback names and
private IP literals unless approved. A browser cannot check where a name resolves, so rely
on its private-network protections; services must allow the origin through CORS and
expose `Retry-After`.

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
This adapter coordinates each reservation identity. For multiple operations sharing a gas
payer, use the application wrapper below.

### Coordinate the gas payer

`reserveApplicationPayment` takes the same clients, deployment, payment and expected
operation, plus a durable store and the original session:

```ts
import {reserveApplicationPayment, reconcileApplicationPayment} from 'tasra-sdk/app'

const result = await reserveApplicationPayment(client, wallet, deployment, payment, expected, {
  ...limits, store, session: {random, audience},
})

// After an uncertain submission, locate its original hash; this call never sends a transaction.
const resolution = await reconcileApplicationPayment(
  client, store, deployment, requestId, expected, independentlyRecoveredHash, 2,
)
```

All reservation callers must share the same store and use a dedicated gas payer. The
lock spans nonce selection, durable preparation, submission and verification. It covers
different slots and deployments on the same chain. A concurrent call either waits or is
refused, depending on the store; the file store refuses with `StoreLockedError`.
Unrelated CLI, wallet and low-level `reservePaidOperation` writes are outside this lock.

Once preparation claims a payer, any uncertain outcome retains that claim across restart.
`ApplicationPayerRecoveryError.requestId` identifies the operation to inspect. Recovery
requires the original exact transaction to be canonically mined, including a revert; it
retains the recovered evidence before releasing the payer. The original journal is never
deleted or made reusable. A durable nonce floor refuses RPC responses older than the last
verified consumption. Neither expiry nor an absent transaction hash releases a claim.
If the transaction never lands, the payer remains held: this API does not broadcast a
cancellation or replacement. A process killed while holding a file-store lock also leaves
that lock for explicit reconciliation under the store's existing recovery policy.

The wrapper returns the same verified reservation receipt as the low-level helper. It
does not resume authorization or keeper work, and it cannot coordinate other applications
using another store or an externally shared wallet.

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
methods accept `{authorize, payment, random, execution}` for an already reserved operation. They
check canonical backing and current assignment before requesting credentials and again
after authorization. The authorization callback receives a defensive payment copy and
the original expiry through `nowSecs` / `ttlSecs`; registered wallet and credential
authorizers forward these to session creation. A changed or missing payment in the grant
is refused before contacting a keeper. Signatures use the paid coordinator; IBE extraction
uses only the signed contributors. Results are still cryptographically verified.
`execution` contains the original creator-certified client certificate and its local
Ed25519 signer. Paid work without this capability is refused before a keeper request.
Keep the signer in the client; a verifier-agent does not receive its private seed.

```ts
const signature = await frostSlot.sign(message, {
  authorize,
  payment,
  random,
  execution: {certificate: originalCertificate, signer: originalExecutionSigner},
})
```

For direct keeper clients, supply `approveExecution` from
`createKeeperExecutionApprover` in `tasra-sdk/chain`. Retain the original signed payment
and independently computed operation digest, approved deployment and local execution
certificate. The approver re-reads canonical reserved TASRA, original creator and current
eligible sharing before each signing callback. It signs the complete client-built body
for the assigned coordinator and every signed contributor; IBE requests approve only
the contributor being contacted. A changed ciphertext nonce, participant selection,
credential token or optional field changes this body commitment.

```ts
const approveExecution = createKeeperExecutionApprover({
  client,
  deployment,
  payment,
  expected: {slot: slotId, action: 'sign', payloadDigest},
  certificate: originalCertificate,
  signer: originalExecutionSigner,
})
const result = await committeeSign({
  nodeUrl: assignedCoordinator.url,
  committeeToken: grant.token,
  verifierProofs: grant.verifierProofs,
  message,
  approveExecution,
})
```

The same capability is accepted by `committeeSignEoaDigest`, `committeeDecrypt`,
`requestIbeExtractionPartials` and paid `createDualSignClient`. The transport verifies
returned client signatures against the exact body before dispatch, refuses missing or
duplicate assigned stage approvals, and rechecks expiry. These source changes and
their regression cases still require the complete SDK and native deployment gates.
Custom `keeperUrl` mappings must preserve HTTPS. Local HTTP additionally requires
`allowLocalPaidHttp: true` on the application client and chain43112. The application does
not fail over a paid attempt or submit a replacement reservation. Each operation needs
its own payment; do not reuse one fixed payment for multiple Viem account calls.

Paid token signatures use a separate domain; existing unpaid token bytes stay unchanged.
This encoding compatibility does not enable unpaid service on a prepaid deployment.
The helpers cover discovery, reservation journaling and execution separately. Application-wide
gas nonce coordination and automatic final settlement orchestration remain separate work;
the helpers above do not claim a complete prepaid client.

### Client consent for paid stages

`tasra-sdk/committee` provides `createLocalExecutionSigner`,
`createExecutionCertificate`, `approveExecutionRequest`, and
`verifyExecutionAuthorization` for client-owned execution consent. The application
keeps the Ed25519 private execution key locally. The slot creator signs a separate
certificate binding its public key to the original payment, deployment, request ID,
session commitment and expiry. Payment hashes and reservation identities stay unchanged.

Before creating a paid session, call `initializeExecutionSession` with the original
payment, creator certificate, local signer and an `ExpectedInitialization` built
from your authenticated, approved agent profile and complete create body. Generate
`poll_secret` locally as a nonzero 32-byte lowercase hex string and include it in
that body. Add only the returned `execution_initialization` envelope to the POST.
The signature binds the bearer, profile, payment, exact field shape and expiry.
`verifySessionInitialization` rechecks that consent. The hash returned by
`hashTypedData(executionInitializationTypedData(payment, proof))`, without its
`0x` prefix, is the expected session ID. Keep the same complete body and proof
for reconciliation after a lost reply. One original payment request allocates one session; changing
the body or owner requires a new payment reservation, even with a fresh client
initialization signature.
Session initialization is not a paid operator stage. It performs no fee reservation,
HTTP dispatch or automatic approval. This helper alone does not implement the full
agent transport, JAR/attest, wallet or keeper orchestration.

For each stage, independently authenticate the destination operator and construct
the complete unsigned request body from your own operation intent and validated
presentation. Pass that body as `expected.body` and the agent's complete proposal as
`proposal.unsigned_body`. `approveExecutionRequest` compares their canonical hashes
before asking the local signer to authorize the stage. Operator, stage, payment,
action, payload and bounded expiry are part of the signed message. An opaque hash
from the agent is insufficient. Explicit `null` and absent fields are different;
the body must contain only safe JSON values and must exclude the
`execution_authorization` envelope.

`ExecutionConsentPolicy` must come from your approved deployment, independently read
slot creator, locally retained payment hash, canonical quote or mined reservation
cost, and a fresh clock. The helper checks signatures and commitments; the caller
still checks mined backing and verifier assignment. A valid signature alone does
not prove funds are reserved or that a verifier was drawn.

These consent helpers do not automatically approve wallet callbacks, poll an agent
approval queue, dispatch operations, or settle fees. Agent delivery and application
orchestration are separate integrations. Never copy an untrusted proposal into
`expected.body` without checking every field against your own intent. Never send the
private seed or signing capability to the agent. Call the local signer's `dispose()`
when its session finishes; persisted seed copies remain the application's responsibility.

### Read a completed keeper result

Keep the original payment, operation digest, assigned worker endpoint, creator
certificate and local execution signer privately until the result has been received
and verified. `recoverKeeperExecution` reads completed work from that original worker;
it does not reserve funds, prepare a nonce, repeat signing or close an unused stage.
It remains a read after the payment or original work approval expires.

```ts
import {recoverKeeperExecution} from 'tasra-sdk/chain'
import {createNodeKeeperRecoveryTransport} from 'tasra-sdk/chain/node'

const recovered = await recoverKeeperExecution({
  client,
  deployment,
  payment,
  expected: {slot: slotId, action, payloadDigest},
  keeper: originalAssignedKeeper,
  target: {stage: originalStage, executionKey: originalCertificate.execution_key},
  signer: originalLocalExecutionSigner,
  transport: createNodeKeeperRecoveryTransport(approvedTransportPolicy),
})
// Decode the operation's retained internal result, then verify its cryptographic
// signature/share using recovered.observation.groupPublicKey before using it.
const internalResult = JSON.parse(recovered.resultJson)
```

Use an independently approved RPC deployment and the worker/client identities retained
before submission. The helper authenticates the worker report, then reads creator,
reserved TASRA and eligible keeper assignment at its original canonical block hash.
Every contract call requires EIP-1898 canonicality. Missing or orphaned history is
refused; it never falls back to latest state. The reserved fee and the original client
approval must match before the helper asks the local signer for a fresh read signature.
The current slot owner, remaining balance or payout status does not replace that history.

The helper checks the returned signed evidence and the exact retained result commitment
before exposing `resultJson`. This authenticates retained bytes; applications still
verify the result's cryptographic meaning. The internal format may differ from the
original HTTP response and exclude later audit metadata. IBE results use their existing
share commitment; added audit metadata is not part of that commitment.

The Node transport allows only the public evidence and private recovery POSTs, with
verified TLS, connection-time destination checks, bounded responses and no redirects.
Set explicit private hosts and additional CA roots through `approvedTransportPolicy`.
Browser applications supply an equivalently guarded `KeeperRecoveryTransport`.
Recovery never automatically retries key work. Missing, failed or interrupted stages,
HTTP refusals and unavailable history remain errors to reconcile against the original
payment. `KeeperRecoveryError.httpStatus` preserves HTTP refusals without private body
text. A lost read reply can be read again with fresh client authentication; the original
payment cannot be reused to start another operation.

These new recovery sources and regression cases still require the full SDK and native
deployment validation gates. Complete final fee orchestration remains unfinished work.

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

### Paid dual-control signatures

Reserve a final `sign` payment for SHA-256 of the exact message. Pass it as
`payment` and the original `{certificate, signer}` as `execution` to
`frostSlot.approvals({quorum, credentialGated, payment, execution})`. This resolves
and pins the assigned coordinator from chain. Then call `create(message)` on the
returned client. The lower-level `createDualSignClient` also accepts a pinned
`payment`, or `create(message, {payment})` when you already verified its coordinator.
Paid creation also requires its local `approveExecution` capability. Its complete-body
client approvals remain bound to the final Sign payment while credentialed approvers
use their separate payments. A local client-signing refusal occurs before dispatch and
does not become an unknown network outcome.

The request ID is the reservation ID without its `0x` prefix. Every approval signs
`paidDualSignApprovalPayload(chainId, slotId, message, requestId, payment)`, binding
the chain, slot, message, request and final payment commitment. A static approver
needs no credential verification. A credential approver needs a **separate** reserved
`dual-approve` intent whose payload digest is SHA-256 of these approval bytes. Pass
that intent and its fixed presentation `random` to `approveWithCredential`.
The final Sign payment cannot pay for credential approval work.

Opening a request and collecting approvals does not start keeper key work. A keeper
starts only after independently verifying the distinct approval quorum, current
policy, final reservation and assigned sharing. Fee settlement uses actual signed
work reports; a role whose operators did no work receives no fee.

Persist the message and original payments before sending. If creation has an unknown
outcome, its error includes the stable request ID. Resume with
`client.resume(requestId, message, {payment})` and poll before resubmitting. A pinned
client retains that payment automatically. The prepaid keeper deployment stores
dual-control bindings, approvals and terminal results in its encrypted durable journal.
After a keeper restart, resume against the original coordinator and request ID. A
completed result remains retrievable after the approval window expires. An interrupted
signing attempt is uncertain and does not reopen the payment for another execution;
reconcile its original payment and execution evidence.

The SDK does not run the platform's payout supervisor. Operators must configure that
service separately. After canonical settlement, the platform CLI can retrieve a minimal
claim plan from an assigned accountant with `payment claim-plan`. Save a private backup;
the claim command independently checks its proofs against the canonical chain root.
Claiming credits an operator's reward balance, and withdrawing that balance is a separate
transaction. Neither operation resumes keeper work or changes the saved reservation.

## Report a prepaid payout fault

When signed evidence shows a settled batch paid the wrong workers, hand it to an
accountant's fault witness with `submitPrepaidFaultClaim(accountantUrl, bundle)` from
`tasra-sdk/chain`. HTTP 202 means the claim was authenticated against the mined batch
and stored; 400, 403 and 413 are final, 408, 429 and 503 can be sent again later (the
error carries `retryAfterMs`). `readPrepaidFaultStatus` reports whether a witness can
adjudicate. The accountant set threshold-signs a verdict; anyone can relay it with
`contestPrepaidFault` (simulated first, so an oracle refusal such as `WrongEpoch()` or
`AlreadyResolved()` is named and nothing is sent). `readPrepaidFaultResolution` shows
whether the offender was already punished for that batch. None of these calls retries.

## Handle depleted slot credit

Catch `UnderfundedSlotError` from `tasra-sdk/chain` when discovering or reserving a new
payment. The error carries `slotId`; discovery of an activated zero-balance slot also
reports `availableTasraUnits: 0n`. An accountant refusal reports `status: 402` and its
endpoint. The API does not return a verified required/available amount with that refusal,
so the SDK leaves those amounts absent instead of estimating them.

Check fresh slot funding and top up TASRA before preparing new work. Available credit
excludes funds already reserved by other requests. A request can be underfunded with a
positive balance if its fee is larger, and concurrent requests can consume credit between
discovery and reservation; on-chain reservation remains atomic. AVAX in the slot creator's
wallet pays gas and does not fund service work. An already backed operation keeps its
reserved fee even when the slot's available balance reaches zero.

This error is not automatically retryable. After an uncertain broadcast, reconcile the
saved reservation rather than submitting it again in response to a balance change.


The paid session control transport is `createNodePaidAgentTransport` from
`tasra-sdk/chain/node`. It preserves HTTP425 consent waits, HTTP503 recovery
failures, HTTP204 approval acknowledgments and HTTP200 identical-creation
responses. It permits the owner bearer only on session control routes and never
follows redirects or retries an unknown POST. A caller must still pin the selected
registered provider and independently compose/check every approval body; the
transport does not authenticate a proposal or authorize paid work. Private hosts
and additional local CA roots must be explicit, with TLS verification retained.

### Registered paid session driver

`prepareRegisteredPaidSession` from `tasra-sdk/chain` takes the independently
approved agent profile, trusted deployment, every drawn verifier's anchored Merkle
witness, application-verified rule hash and intended DCQL query. Supply the original
operation, signed payment, fixed random, creator-certified local execution signer
and a locally retained owner bearer. Preparation authenticates the provider and
reads the mined reservation and effective verifier policy before producing the
initialization signature. It does not submit a reservation or creation request.

Retain the returned object, bearer and local signer before calling `create()`.
Creation is sent once. If the reply is lost, use `reconcile()` to read the locally
derived session ID from the same registered provider. The owner-authenticated
status includes the original public encryption key, state, expiry and complete
binding. The driver checks these against its own intent and refuses a changed
context. Provider changes are checked before any owner control request.

For wallet sessions, read `proposals()` and use `approveRequest()` for the assigned
`presentation_sign` operator and separate drawn `presentation_attest` operators.
The driver rebuilds each body from the original operation and recovered context;
it does not sign an agent-supplied digest. Once those stages have completed,
`requestObject()` verifies the anchored signer's signature, session claims,
encryption key, query and operation context before returning a QR payload.

Read `presentations()` after the wallet callback. Independently validate and accept
the complete presentation before calling `resumePresentation()` or
`approveCredentials()`. Every credential is retained and included in the expected
verifier body. A changed, truncated or substituted list is refused before signing.
Each selected verifier is checked against both the original anchored draw and its
current registered standing. HTTP425 indicates that separate consent is required;
HTTP503 indicates recovery is needed. Neither triggers an automatic resend.
`poll()` verifies a completed compound token's signatures, quorum, rule, operation,
payment, seed and expiry against the client-owned context.

For OAuth sessions, select `kind: 'oauth'`. After creation or reconciliation,
`oauthContext` supplies the locally derived nonce, DPoP target and chain-specific
audience. Use `prepareOAuthPresentation(accessToken, dpopSigner)` with the key bound
by the access token. Retain the returned complete presentation before calling
`submitOAuthPresentation()` once. The client checks the token's audience and
issuance time and verifies the DPoP signature, bound key, target, nonce and token
hash. This does not replace the committee's issuer, rule and holder verification.
HTTP202 means the callback is retained and still needs client approval. Continue
through presentation selection and drawn credential approvals. After an uncertain
submission, inspect the original retained callback; do not mint or resend a proof
automatically.

The Node paid transport sends OAuth artifacts only to the original session's
OAuth-response POST, with `Authorization: DPoP`, `DPoP` and a separate
`X-Poll-Secret`. It preserves HTTP202 and refuses header injection, redirects,
wrong routes and oversized artifacts.

These new driver sources and regressions still await the complete SDK verification
gate and native paid-session acceptance. Keeper operation delivery and final fee
settlement are separate from this authorization flow.
