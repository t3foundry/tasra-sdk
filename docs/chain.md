# `tasra-sdk/chain` — on-chain + network-service

> The chain subpath: reads, writes, slot creation, discovery, and the slot-driven clients.

Download the selected manifest from
[tasra-releases](https://github.com/t3-foundry/tasra-releases), verify its trusted
checksum, and derive the address book with `addressBookFromManifest`.

## Create a read client

```ts
import {createTasraChainClient} from 'tasra-sdk/chain'

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

**Returns:** a `TasraChainClient`. Use `client` for underlying viem calls and `readers`
for typed Tasra contract calls. Creating the client performs no network request;
individual reads can fail if the RPC is unreachable or a contract address is wrong.
Compare `await chain.client.getChainId()` with your configured ID before use.

## Verify a deployment

After loading `manifest` and `rpcUrl` as in the [Fuji guide](fuji.md):

```ts
import {observeNetworkManifest} from 'tasra-sdk/chain'

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
import {createHolderProof} from 'tasra-sdk'
import {createTasraChainClient, createCommitteeSlotClient, addressBookFromManifest} from 'tasra-sdk/chain'

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
`tasra-sdk/committee`) as `holderProof` to `requestCommitteeToken` / `ibeDecryptRequest`
and each drawn verifier is asked for its own nonce.

---

[Back to the README](../README.md) · [Documentation index](README.md)
