# `@t3foundry/tasra-sdk/chain` — on-chain + network-service

> The chain subpath: reads, writes, slot creation, discovery, and the slot-driven clients.

## User-class gas sponsorship

Configure registered relay writes with `sponsorship: {slotId, authorize}` when the
relayer's user-class policy requires a holder-bound voucher. Approve `slotId`
independently of the relayer. Provide durable `persistAttempt` and `resumeAttempt`
callbacks. The SDK saves the signed forward request before asking the authenticated
relayer for `/v1/relay/voucher-intent`, then checks the intent's chain, slot, digest,
expiry and delegation scope. Your `authorize({attempt, intent, signal})` callback
completes the wallet flow through an independently approved verifier-agent and
returns `{compound_token, verifier_proofs}` in wire format, optionally with
`status_attestations` and `evidence_ct`. Do not include session metadata in this bundle.
Authenticate the agent and its Request Object before presenting credentials; the
agent must verify the sponsor's creator/delegate authority. Retain session recovery
under `attempt.id` and honor cancellation.

Create the agent session with the original `intent.operation`, `intent.operation_sig`,
`intent.delegation` and `intent.message_hex`; do not sign a replacement operation. Persist
the creation intent under `attempt.id` before its POST, then persist the returned session's
`unpaidRecovery` checkpoint before wallet delivery. It contains the poll secret: keep it in
private durable application storage, never logs or public artifacts. After restart,
`agent.restoreUnpaidSession(checkpoint, {signal})` checks the independently approved profile
and live registry, then polls only that original session. It performs no creation POST or
provider failover. Retain the original operation separately, derive its request hash, and
use `assertRegisteredWalletRequest` before presenting and immediately before submitting.
If creation was interrupted before its checkpoint was saved, retain that uncertain intent
and refuse automatic creation of another session. Paid sessions use payment recovery and
do not expose an unpaid checkpoint.

The SDK checks the returned voucher's request binding and persists the voucher with
the original signature before submitting. The relayer independently verifies the
committee signatures, snapshot proofs, standing and revocation freshness. No TASRA
reservation is created for this relay authorization. TASRA slot funding and AVAX gas
sponsorship remain separate balances. Busy retries and alternative providers receive
the same signed request and voucher. Restarting with a retained, unexpired voucher
does not sign a new request or open another wallet session. A consumed nonce with
an unresolvable execution outcome refuses replacement; investigate that original
request before creating another operation. Expired vouchers require explicit recovery
and are not silently renewed. Native wallet/fleet acceptance is required before rollout.

Download the selected manifest from
[tasra-releases](https://github.com/t3foundry/tasra-releases), verify its trusted
checksum, and derive the address book with `addressBookFromManifest`.

## Recover registered relay writes

For sponsored and unsponsored writes, retain the signed `RelayAttempt` before its
first POST and restore it with `resumeAttempt` after restarting. If its nonce was
consumed outside the 10,000-block reconciliation window, `submit` refuses another
signature with `RelayOutcomeUnknownError`. Calling the submitter's `reconcile()`
returns `{expired: false, unresolvable: true}` and keeps `pendingAttempt()` intact.
A spent nonce proves that the original signed request cannot execute again; it does
not prove whether its inner call already ran.

Preserve the original journal and investigate its receipt and resulting chain state.
Do not delete it, move its starting block or recreate the submitter to bypass this
fence. Reconciliation automatically releases the signer only for a verified receipt
or when the deadline passed with the original nonce still unused. This tightens the
older behavior that released an unresolvable signer; it does not extend the bounded
log scan or supply automatic recovery of unavailable historical receipts.

## Create a read client

```ts
import {createTasraChainClient} from '@t3foundry/tasra-sdk/chain'

// rpcUrl, chainId and addresses come from your deployment configuration.
const chain = createTasraChainClient({rpcUrl, chainId, addresses})
const block = await chain.client.getBlockNumber()
const slot = await chain.readers.keyRegistry.getKeySlot(slotId)
```

| Parameter | Required? | Source / meaning |
|---|---|---|
| `rpcUrl` | Yes | Deployment's JSON-RPC endpoint. |
| `addresses` | Yes | `addressBookFromManifest(manifest)` for the downloaded release manifest. Include the contracts your reads use. |
| `chainId` | Pass explicitly | Deployment chain ID. The constructor does not query the RPC to verify it. |
| `logWindow` | No | Maximum block range per `getLogs` query; defaults to 2,000. |
| `multicall3` | No | Auto-detected by default; pass an address or `false` to disable batching. |
| `rpcBatch` | No | JSON-RPC batching of small requests; defaults to batches of 32. Pass `{batchSize, wait}` to tune it or `false` for an RPC without batch support. |

**Returns:** a `TasraChainClient`. Use `client` for underlying viem calls and `readers`
for typed Tasra contract calls. Creating the client performs no network request;
individual reads can fail if the RPC is unreachable or a contract address is wrong.
Compare `await chain.client.getChainId()` with your configured ID before use.

## Verify a deployment

After loading `manifest` and `rpcUrl` as in the [Fuji guide](fuji.md):

```ts
import {observeNetworkManifest} from '@t3foundry/tasra-sdk/chain'

const observation = await observeNetworkManifest(manifest, rpcUrl)
if (!observation.matches) throw new Error('Deployed contract code differs from the manifest')
console.log(observation.blockNumber)
```

This checks chain identity, the manifest's recorded block, contract bytecode, and proxy
implementations at a finalized block. **Inspect `matches`**: mismatched code is reported
in the result. RPC errors or a chain mismatch can throw. Passing this check does not
verify credentials, service versions, access policy, or successful signing/decryption.

## Available chain APIs

A separate subpath export (so the crypto core stays lean and `viem` is only
loaded when you need it):

- **Contract ABIs** + a name→ABI map, generated from the Foundry artifacts.
- **Address discovery** — build an `AddressBook` from a Foundry broadcast JSON, an
  env file, or an inline object. `addressBookFromBroadcast`/`Env`/`Object`, `requireAddress`.
  Broadcast parsing handles both deploy shapes (plain `CREATE` and CREATE2 via the
  `DeterministicDeployer`) and resolves UUPS contracts to their proxy, never the
  implementation. Vesting vaults resolve per tranche — `requireVaultAddress(book, 'team')`.
- **Event registry + decoding** — `decodeContractLogs`, contract categorization, `jsonSafe`.
- **viem read client** — `createTasraChainClient`: a `PublicClient` with windowed
  `getLogs` and typed readers across NodeRegistry, KeyRegistry, Settlement,
  TasraToken, BondingCurve, Treasury, TasraVestingVault (per tranche), and the beacon.
- **Network-service read clients** — `nodeApi`, `verifierApi`, and a Prometheus parser
  for node/verifier info, key slots, heartbeats, and metering.
- **Sovereign write client** — `createTasraWriteClient` / `generateClientKey`:
  a client signs its own slot creation (incl. commit-reveal) + settlement funding,
  no relayer.
- **Slot-driven JWT client** — `createTasraSlotClient`: same surface as
  `createTasraClient`, but endpoints come from the registry — the keeper nodes from the
  slot's on-chain committee (`assignedNodes`) and the **verifier chosen from the on-chain
  verifier set** (`keccak256("verifier")`). That chosen verifier mints the session JWT, so
  the verifier participates in session authorization (`onResolve` surfaces which one).
- **Slot-driven committee client** — `createCommitteeSlotClient`: the committee path
  from just a **slot id**, with **no static fallback**. It resolves the slot's keeper node
  and the active verifier set **only from chain** (`resolveSlotKeeperUrls`,
  `resolveVerifierDirectory` — verifiers are `NodeRegistry` operators tagged
  `keccak256("verifier")`, `VERIFIER_TAG`, indexed by ascending address to match the
  anchored snapshot), lets the beacon-seeded on-chain draw pick the committee, gathers a
  quorum of attributable verifier signatures, and submits the compound token —
  `sign` / `encrypt` / `decrypt`. There is no way to pass a hardcoded node/verifier list,
  and it **requires** trustless `VerifierSetRegistry` inclusion proofs (throws rather than
  let the keeper validate against a statically-configured set).
- **Format helpers** — `truncateHex`, `formatUnits`, `formatBps`, `formatWad`.

## Fund creation and usage

The creator needs AVAX for gas on Avalanche. Buy TASRA with EURC through
`approveEurcForCurve` and `buyTsra`, then deposit it into each slot with `fundSlot`.
[The funding guide](funding.md) includes the official Fuji faucet, runnable
commands and separate wallet/slot balance checks.

## Commit/reveal slot creation

`writer.createSlotCommitReveal(args)` commits the slot parameters, then requests a
per-commitment seed from the accountant set. Compatible deployments can reveal the
slot immediately with that seed. If a seed is unavailable or the registry does not
support it, the client falls back to waiting for the beacon epoch before revealing.

The options in `CommitRevealOptions` let you set `accountantUrls`, bound each request
with `slotSeedTimeoutMs`, observe the seed request with `onSeed`, or use
`slotSeed: false` to select the epoch path. `onEpoch` reports only the fallback wait;
`maxWaitMs` bounds that wait. The result includes `seeded`, which reports whether the
seeded reveal succeeded, alongside `slotId`, `ruleSalt`, `commitTx`, `revealTx`, and
`targetEpoch`.

For a custom commit/reveal flow, use `resolveAccountantUrls(chain)` and
`requestSlotSeed(chain, keyRegistry, commitment, options)`. Seed responses are checked
against the registry's commitment digest; the contract verifies the signature during
reveal. A failed seeded reveal through a relay is returned to the caller rather than
starting another signed request with the same forwarder nonce.

## Slot-driven committee flow (no hardcoded endpoints)

The committee path derives its keeper node and verifier set from the slot id and accepts
**no static list at all** — a slot is bound to its keeper committee on-chain at creation, and
verifiers are discovered network-wide by their `keccak256("verifier")` tag. "Random verifier
selection" is the beacon-seeded, verifiable on-chain committee draw, not a client
coin-flip. And unlike the JWT-path `Session` — whose `decrypt` reconstructs the master key
client-side — committee `sign`/`decrypt` are **node-coordinated: the key is never
reassembled**. Keepers enforce authorization; metering and audit behavior depend
on deployment configuration. The flow
refuses to proceed unless the trustless on-chain verifier-set proofs are derivable, so it
never degrades to a keeper's statically-configured set.

```ts
import {createHolderProof} from '@t3foundry/tasra-sdk'
import {createTasraChainClient, createCommitteeSlotClient, addressBookFromManifest} from '@t3foundry/tasra-sdk/chain'

const chain = createTasraChainClient({rpcUrl, addresses: addressBookFromManifest(manifest)})
const audience = 'your-verifier-iss'
const holderProof = await createHolderProof(verifierUrl, {signer: holderSigner, audience, credentials, slotId})
const kk = createCommitteeSlotClient({chain, holder, credentials, holderProof, dcqlRule})

const sig = await kk.sign(slotId, message) // keeper + verifiers resolved from chain
const env = await kk.encrypt(slotId, plaintext) // local; group key read from KeyRegistry
const text = await kk.decrypt(slotId, {ciphertext, identity, decryptingSet, blsPeers})
```

`examples/committee-slot.ts` in the installed package is a runnable version.

**One holder proof does not serve a committee.** A proof is bound to a nonce that lives in
ONE verifier's store and is consumed atomically, so a single proof fanned to k verifiers is
spent by whichever answers first — the rest refuse under `require_holder_binding`. The
lower-level flow therefore accepts a proof **per verifier**: pass
`holderProofPerVerifier({signer, audience, credentials, slotId})` (from
`@t3foundry/tasra-sdk/committee`) as `holderProof` to `requestCommitteeToken` / `ibeDecryptRequest`
and each drawn verifier is asked for its own nonce.

## Keeper administrative capability

`nodeApi.info(keeperUrl)` reports the keeper's optional `admin_auth` field:

| Value | Keeper-reported capability |
|---|---|
| `separate` | Administrative tokens use an independent operator issuer key. |
| `unconfigured` | Administrative routes await operator configuration. |
| absent | The keeper did not report this capability. |

This is service metadata; reading it does not authenticate the keeper or grant
authority. Provisioning, rotation and governance require an administrative token
with the keeper's configured issuer, audience and `kk-admin+jwt` type. Obtain that
token from the operator; its signing seed belongs on the operator's system.

An unconfigured administrative route returns HTTP 503 with
`admin authentication not configured` in the response body. The SDK preserves
that diagnostic in `TasraHttpError.body` and the status in `TasraHttpError.status`.
The operator must configure the administrative issuer before retrying the action.

---

[Back to the README](../README.md) · [Documentation index](README.md)
