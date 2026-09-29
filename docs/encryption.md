# Encrypt data and authorize decryption

Use a **non-exportable BLS slot** when credential holders should decrypt data
without receiving the master key. A slot is the network-managed key plus its access rule.

## Start with a new application

Follow [Build encrypted notes](encrypted-notes.md) for exact installation and run
commands. It creates a fresh issuer, Alice and Bob, then a BLS slot from the public
manifest. The only application runtime dependency is `tasra-sdk`.

1. Connect with `new TasraClient({manifest, wallet, store})`.
2. Issue a holder-bound credential with `tasra.credentials.issue` and define the
   issuer-rooted document scope with `tasra.credentials.policy`.
3. Call `tasra.slots.create({name, mode: 'bls', policy, threshold, verifiers})`.
4. Encrypt using `slot.encrypt(identity, bytes)`; decrypt using `slot.decrypt`
   with `tasra.credentials.authorize(...)` and required keeper receipts.
5. Verify the plaintext, actual server refusal for Bob, and ciphertext tampering.

Creation, rule commitment/delivery, key readiness and verifier setup are SDK
operations. Keep the private store and original intent when resuming; reconcile
unknown transaction outcomes before another submission.

## Advanced existing committee integrations

The remaining sections describe the lower-level committee/session path for
applications that already supply credentials and slots. Use it only when its
protocol matches your deployment; it is not the setup for the new tutorial.

### Before you start


Download and checksum-verify the selected manifest from
[tasra-releases](https://github.com/t3-foundry/tasra-releases). Confirm that the
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
[verifier-agent presentation flow](api.md#tasra-sdkoid4vp--credential-wallets-against-the-verifier-agent).

### Run the complete example

From your application directory, after installing the compatible SDK and `tsx` as developer tooling:

```sh
npx tsx node_modules/tasra-sdk/examples/getting-started.ts
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
