# Migrate an application to the candidate SDK

The unpublished `0.3.0-next.0` candidate keeps existing SDK imports available and
adds `tasra-sdk/app`. You can adopt the application API one operation at a time;
you do not need to rewrite working integrations to install the candidate.
Check [deployment compatibility](compatibility.md) first. The candidate's current
application flows require a compatible local fleet and are not deployed on Fuji.

## Choose the boundary to migrate

| Existing application code | Candidate API | Preserve or check |
|---|---|---|
| Separate registry reads and custom slot-mode checks | `createTasra` and typed `slots.ecdsa`, `slots.frost`, `slots.bls` handles | Pin the intended chain and registries; handle missing, cancelled, unready and wrong-mode slots. |
| Custom Ethereum address derivation or wallet glue | ECDSA `getAddress` and `toViemAccount` | Authorize the exact operation for the acting holder; verify gas funding separately from metering. |
| Manual IBE partial collection and combination | BLS `decrypt` | Use the intended identity and authorization; require receipts when your application depends on them. Keep the anchored-group assurance limits explicit. |
| Custom create/status/approve transport | Native FROST approval lifecycle | Preserve request ID, message, coordinator and policy; distinguish uncertain submission from a confirmed failure. |
| Ad hoc slot-creation retry state | `prepareSlot` and `createPreparedSlot` | Persist each journal atomically before submission; reconcile unknown outcomes instead of creating a replacement slot. |
| Legacy `keykeeper-sdk` package imports | Corresponding `tasra-sdk` entry points | Check exported types and the [API reference](reference/README.md); package-name replacement alone does not validate behavior. |

The [application API guide](application-api.md) shows the typed operations and error
handling. Complete [shared-account](shared-account.md), [encrypted-notes](encrypted-notes.md),
[native approval](native-approvals.md) and [document-signing](document-signing.md)
examples demonstrate the surrounding application responsibilities.

## Validate your application

1. Install the [packed candidate](installation.md#test-an-unpublished-sdk) and keep
   its exact version and integrity in your application's lockfile.
2. Typecheck and build your application in its actual Node or browser environment.
   Install `viem` for the `/app` and `/chain` entries and provide browser WebCrypto.
3. Exercise the migrated operation on a compatible development deployment with
   newly issued development credentials. Include a refused holder, wrong operation
   binding and a malformed result where the operation supports them.
4. Check restart and retry behavior. An ambiguous network error is not proof that a
   write failed; retain transaction hashes, creation journals and approval request IDs.
5. Compare application-visible results with your existing flow before changing
   production traffic. Build success alone does not establish network compatibility.

Never copy demo issuer keys, holder credentials or recovery journals into production.
See [security guidance](../SECURITY.md) and [errors and retries](errors.md).
