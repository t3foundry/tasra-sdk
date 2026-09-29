# Migrate to the application API

Use `tasra-sdk/app` to adopt the application API one operation at a time.
Existing lower-level SDK imports remain available.
Creation and provisioning integrations must adopt the required `rule` property
and migrate any older recovery journals as described below.
Download the selected network manifest from
[tasra-releases](https://github.com/t3-foundry/tasra-releases) and verify its checksum.
Confirm that the deployment supports the required key modes, authorization formats
and service routes before executing protected operations.

## Choose the boundary to migrate

| Existing application code | Application API | Preserve or check |
|---|---|---|
| Separate registry reads and custom slot-mode checks | `TasraClient` from the public manifest and typed slot handles | Pin the intended chain and registries; handle missing, cancelled, unready and wrong-mode slots. |
| Custom Ethereum address derivation or wallet glue | `wallets.fromSlot` and durable `wallet.transfer` (`toViemAccount` remains an advanced adapter) | Authorize the exact operation for the acting holder; verify gas funding separately from metering. |
| Manual IBE partial collection and combination | BLS `decrypt` | Use the intended identity and authorization; require receipts when your application depends on them. Keep the anchored-group assurance limits explicit. |
| Custom create/status/approve transport | `setApprovalPolicy`, `identityApprover`, `approveWithCredential` and native FROST approval lifecycle | Preserve request ID, message, coordinator and policy; distinguish uncertain submission from a confirmed failure. |
| Ad hoc slot-creation retry state | `slots.create` with a stable name and `createFileStore` | Restore the same wallet, manifest and named request to resume; reconcile unknown outcomes. Expired commitments and abandoned locks still require operator intervention. |
| Legacy `keykeeper-sdk` package imports | Corresponding `tasra-sdk` entry points | Check exported types and the [SDK reference](reference/README.md); package-name replacement alone does not validate behavior. |

The [application API guide](application-api.md) shows the typed operations and error
handling. Complete [shared-account](shared-account.md), [encrypted-notes](encrypted-notes.md),
[native approval](native-approvals.md) and [document-signing](document-signing.md)
examples demonstrate the surrounding application responsibilities.

## Use generic rule names

Pass the clear policy as `rule` in `CreateSlotArgs`, `prepareSlot` and
`provisionRule`. This is a breaking input change: `dcqlRule` is rejected,
including when supplied alongside an identical `rule`. Rename the property in
creation and provisioning calls, then typecheck your application. Do not replace
the clear rule with its hash. `RuleInput`, `CreateSlotArgs` and `ProvisionRuleArgs`
are interfaces requiring `rule`; custom interfaces can extend them directly.

Creation journals require `intent.rule`; the SDK rejects journals containing
`intent.dcqlRule` and does not migrate them automatically. Before resuming an older
journal, back it up privately and rename only `intent.dcqlRule` to `intent.rule`.
Preserve the exact rule string, both salts, slot ID, creator, authorization type,
deployment, transaction hashes and all other recovery state. If both fields are
already present or the original value is uncertain, reconcile the saved state
before editing it. Do not delete the journal or create a replacement slot to bypass
this check. Application stores may nest this journal under `creation`; retain the
surrounding named request and provisioning state as well.

The slot stores `ruleCommitment`, the salted commitment, rather than `dcqlHash`.
Creation and provisioning still need the rule preimage and `ruleSalt`; retain both
in private recovery state. Credential and OAuth DCQL rules are canonicalized before
commitment hashing. OAuth/BYOIDP therefore does not imply a raw-byte commitment.

The SDK continues to send `dcql_rule` and `dcql_salt` on the keeper HTTP wire to
support deployed services. The SDK property rename requires no keeper upgrade and
changes neither the contract ABI nor the commitment algorithm. Advanced HTTP
integrations should preserve the deployed wire schema until their fleet supports a
versioned migration.

For the application API, `slots.create({policy, ...})` keeps the readable `policy`
property. Its default authorization type is `oid4vp`; select `authType: 'oauth'`
for an OAuth-only policy. Both types validate the policy family before creation.
Existing named credential requests with an omitted authorization type retain their
OID4VP meaning. Resume with the original policy and authorization type.

## Validate your application

1. Install the [latest SDK from npm](installation.md) and keep
   its exact version and integrity in your application's lockfile.
2. Typecheck and build your application in its actual Node or browser environment.
   The application API needs only `tasra-sdk` at runtime; provide browser WebCrypto.
   Install `viem` directly only if your own code intentionally imports its adapters.
3. Exercise the migrated operation on a compatible development deployment with
   newly issued development credentials. Include a refused holder, wrong operation
   binding and a malformed result where the operation supports them.
4. Check restart and retry behavior. An ambiguous network error is not proof that a
   write failed; retain transaction hashes, creation journals and approval request IDs.
5. Compare application-visible results with your existing flow before changing
   production traffic. Build success alone does not establish network compatibility.

Never copy demo issuer keys, holder credentials or recovery journals into production.
See [security guidance](../SECURITY.md) and [errors and retries](errors.md).
