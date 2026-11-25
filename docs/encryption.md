# Encrypt data and authorize decryption

Use a **non-exportable BLS slot** when credential holders should decrypt data
without receiving the master key. A slot is the network-managed key plus its access rule.

## Start with a new application

Follow [Build encrypted notes](encrypted-notes.md) for exact installation and run
commands. It creates a fresh issuer, Alice and Bob, then a BLS slot from the public
manifest. The only application runtime dependency is `@t3foundry/tasra-sdk`.

1. Connect with `new TasraClient({manifest, wallet, store})`.
2. Issue a holder-bound credential with `tasra.credentials.issue` and define the
   issuer-rooted document scope with `tasra.credentials.policy`.
3. Call `tasra.slots.create({name, mode: 'bls', policy, threshold, verifiers})`.
4. Encrypt: `slot.encrypt(aad, dataKey)` wraps a data key with BLS KEM, or
   `slot.encryptForIdentity(identity, bytes)` uses identity-based encryption. Decrypt with
   `slot.decrypt` or `slot.decryptForIdentity`, passing a client recipient, the slot's
   authenticated verifying shares and `tasra.credentials.authorize(...)`.
5. Verify the plaintext, actual server refusal for Bob, and ciphertext tampering.

Creation, rule commitment/delivery, key readiness and verifier setup are SDK
operations. Keep the private store and original intent when resuming; reconcile
unknown transaction outcomes before another submission.

## Decrypt many messages in one session

One credential presentation can authorize many KEM decryptions. `openDecryptSession` asks the
wallet once, receives a short-lived **session grant** signed by the slot's drawn verifiers, and
then decrypts any number of messages of the granted slots with no further wallet step. Each
keeper request is authorized by the grant and a proof from a session key that never leaves the
client. Nothing is paid: the keepers meter the work against the slot's balance, which its owner
funds ([funding](funding.md)).

```ts
import {createTasra, openDecryptSession} from '@t3foundry/tasra-sdk/app'
import {createFileStore} from '@t3foundry/tasra-sdk/app/node'
import {createNodeAgentTransport} from '@t3foundry/tasra-sdk/chain/node'

const app = createTasra({deployment})
const session = await openDecryptSession({
  app,
  agent: {profile, transport: createNodeAgentTransport()}, // an independently approved verifier-agent
  store: createFileStore('.tasra/sessions'),
  signer,                      // any EVM key of the application: it signs the operation request
  present: async opened => showQr(opened.qrPayload), // the wallet step
}, {
  slots: [slotId],
  first: {slot: slotId, ciphertext: messages[0].ciphertext, identity: messages[0].identity},
})

const plaintext = await session.decrypt(slotId, messages[0])
const results = await session.decryptMany(slotId, messages) // 64 per keeper request, one result each
await session.revoke()
```

What the application supplies, and what it does not:

- **The slot IDs** (1 to 16 KEM slots) and **the first message**: a session opens from a KEM
  decrypt presentation of one real ciphertext.
- **A signing key of its own.** Any key may sign the operation request: the slot's creator, a
  delegate the creator signed for (`delegation`), or an unrelated key. The slot's rule decides
  whether the presented credential is admitted, and the verifiers count the request against that
  signer's quota.
- **The wallet step** (`present`) and a durable private store (`createFileStore`,
  `createIndexedDbStore` from `/app/browser`, or `createMemoryStore` for tests).
- **No rule, no rule salt, no TSRA** and nothing else the slot owner holds. An application that
  does hold the rule may pass `ruleHash(slot)` so a grant naming another rule is refused locally.

Before the grant is used, the SDK verifies it against the request (slots, lifetimes, this session
key) and against each slot's verifier draw as anchored on chain: the beacon seed, the
verifier-set snapshot root and the slot's committee policy are read from the chain, and the
verifier keys come from a snapshot artifact served by an accountant and checked leaf by leaf
against that root (`snapshotHosts`, by default the registered accountants).

The session refreshes its grant in the background before it expires and whenever the beacon
moves to a new epoch. Lifetimes are requested with `accessTtlSecs`, `idleTimeoutSecs` and
`absoluteTtlSecs`; the platform clamps them (45 s per grant, 30 minutes idle, 12 hours in all).

| Failure | Meaning | What to do |
|---|---|---|
| `SessionGrantUnavailableError` `session_unavailable` | The presentation completed but the verifiers issue no session grants. | Use single operations (`slot.decrypt`). |
| `SessionGrantUnavailableError` `session_context_changed` | The beacon ticked before the wallet answered. | Open the session again. |
| `SessionMessageError` with `slotBalance` | A keeper answered HTTP 402: the slot's balance does not cover its unsettled metered work. | The slot's owner funds the slot; then decrypt again. |
| `SessionEndedError` | Idle or absolute expiry, a revocation, a definite refusal, or the grant fell two epochs behind. | Open a new session, or set `presentAgainOnEnd` to ask the wallet again automatically. |
| `SessionMessageError` | The keepers refused this message (`code` names the first refusal). | Treat like a refused single decrypt; other messages are unaffected. |
| `SessionGrantError` | The grant failed verification (wrong chain, key, slot, seed, signatures or quorum). | Do not use the grant; report the agent. |

The pieces are also exported for applications that drive the steps themselves:
`createSessionKey`, `sessionGrantCreateFragment`, `acceptSessionGrant`, `GrantedSession`
(`start`, `refresh`, `revoke`, `stop`), `decryptInSession` and `decryptBatchInSession` from
`/app`; `createSlotDrawReader`, `readSlotVerifierDraw`, `readSlotSharing`,
`readCurrentBeaconEpoch` and `readBeaconDrawState` from `/chain`. `createNodeAgentTransport`
(`/chain/node`) and `createBrowserAgentTransport` (`/app/browser`) carry discovery, session
creation and polling, and the session's refresh and revoke on one guarded transport.

## Advanced existing committee integrations

The remaining sections describe the lower-level committee/session path for
applications that already supply credentials and slots. Use it only when its
protocol matches your deployment; it is not the setup for the new tutorial.

### Before you start


Download and checksum-verify the selected manifest from
[tasra-releases](https://github.com/t3foundry/tasra-releases). Confirm that the
deployment supports the chosen authorization and decryption routes, then prepare:

| Input | Where it comes from |
|---|---|
| Deployment manifest, trusted checksum, RPC | The downloaded release manifest and its trusted pointer. |
| BLS slot ID | [Create and provision a slot](prerequisites.md#operator-setup), or use one supplied by the fleet owner. |
| Credential issued to your holder DID | An issuer accepted by the slot's credential rule. Creating a holder key does not issue a credential. |
| Holder signing key and verifier audience | Your wallet/key store and the deployment's verifier configuration. |
| Metering balance and verifier-set snapshot | The slot's funding and the deployment's active verifier set. |

Use [the configuration table](prerequisites.md#application-configuration) to set the
`KK_*` inputs for the shipped Node example. If the fleet uses a private CA, configure
`NODE_EXTRA_CA_CERTS` with its public CA file before starting Node.

The direct committee example requires a fleet that accepts compound tokens without
request binding. For a fleet enforcing request binding, use the
[verifier-agent presentation flow](api.md#t3foundrytasra-sdkoid4vp--credential-wallets-against-the-verifier-agent).

### Run the complete example

From your application directory, after installing the compatible SDK and `tsx` as developer tooling:

```sh
npx tsx node_modules/@t3foundry/tasra-sdk/examples/getting-started.ts
```

Expected result:

```text
Threshold decrypt succeeded; the master key was not exported.
```

Read [the application](../examples/getting-started.ts) and its
[configuration helpers](../examples/live-config.ts). Both ship in the npm package.
The helpers load your files, verify the deployment, discover keepers, and create
a fresh holder proof for each verifier. They do not start services or issue credentials.

### Understand the two operations

`createCommitteeSlotClient` is the application client for this flow:

| Operation | Behavior |
|---|---|
| `client.encrypt(slotId, plaintext, {identity})` | Reads the slot's public key and encrypts locally. Returns serialized envelope bytes. |
| `client.decrypt(slotId, request)` | Obtains authorization, requests threshold decryption from keepers, and returns plaintext bytes. |

Decode the encrypted envelope with `fromBytes` to obtain `ciphertext`, `identity`,
and `epoch`. Decryption also needs the keeper IDs and peer records discovered from
the slot. The complete example supplies these rather than assuming a fixed committee.

To verify access control, repeat with a holder whose credential does not satisfy
the rule. Record the authorization denial separately from connectivity failures.
If testing revocation, wait for the deployment's documented propagation/token-expiry
window. Revocation cannot erase plaintext already received.

### If you want an exportable personal vault

Use [examples/personal-vault.ts](../examples/personal-vault.ts) with an explicitly
exportable BLS slot and `createTasraSlotClient`. Its managed session assembles and
caches the master key for local decryption. A holder can retain that key after
revocation. Close sessions with `client.closeAll()` when finished.

See [errors and retry decisions](errors.md) for failures, and
[Advanced clients and OAuth](api.md) for other custody and encryption APIs.

[Documentation index](README.md)
