---
name: tasra-committee-path
description: Use Tasra native FROST approval quorum or integrate request-bound committee operations. Use for two-person approval, dual-sign create/status/approve/resume, keeper receipts, and advanced compound-token consumers.
metadata:
  package: tasra-sdk
  sources:
    - docs/native-approvals.md
    - examples/credential-approvals.ts
    - dist/committee/dual-sign.d.ts
    - dist/committee/receipts.d.ts
---

# Request-bound operations and native approvals

For ordinary signing/decryption use typed slots from `tasra-sdk/app`; they validate
the exact-operation grant and anchored result. Reach for `tasra-sdk/committee`
when an existing application needs the lower-level contract, not simply because it
uses multiple keepers.

## One FROST signature after distinct people approve

Read `docs/native-approvals.md`. `examples/native-approvals.ts` uses registered
static approver keys; `examples/credential-approvals.ts` uses separate holder-bound
credential presentations. Both set the real slot policy before requesting approvals.

```ts
import type {TasraApplication} from 'tasra-sdk/app'
import type {Hex} from 'viem'

export async function startApproval(
  tasra: TasraApplication, slotId: Hex, message: Uint8Array,
  policy: {quorum: number; credentialGated: boolean},
) {
  const slot = await tasra.slots.frost(slotId)
  const approvals = await slot.approvals(policy)
  return approvals.create(message)
}
```

Supply quorum and mode from the application's independently pinned slot policy;
do not trust a status response to choose them. Save the request ID, coordinator,
slot, exact message and expected policy. Each signer implements `{publicKey,
sign(bytes)}` and signs the SDK-supplied canonical bytes with its authorized Ed25519
key. Keep private keys out of model-authored arguments and public evidence.

For credential mode, each `request.approve` also needs that holder's own
`authorization: {token, verifierProofs}`. Use action `dual-approve`; its
`payloadDigest` is SHA-256 of `dualSignApprovalPayload(slotId, message, requestId)`
from `tasra-sdk/committee`. Do not hash the message twice or duplicate the canonical
encoding in app code. The approval key must match the credential-bound holder.
The recipe shows the complete wallet flow and duplicate-holder refusal.

Call `request.status()` or bounded `request.wait({timeoutMs, signal})` to observe
completion. The SDK verifies the final signature against the expected group key
and original message. Native approval quorum counts people/keys; the keeper
threshold counts cryptographic shares. Two separate document signatures are a
third workflow, explained by `tasra-sign-and-decrypt`.

## Recovery and evidence

Use `approvals.resume(saved.requestId, saved.message)` with the original coordinator
and pinned policy after a restart. On `OperationOutcomeUnknownError`, reconcile
status before any further submission. If a create request lost its ID, the current
API cannot discover it; report the uncertain outcome rather than creating another.
Cancellation stops local work and does not retract an accepted approval.

Optional operation receipts are not proof merely because they are present. Use
`verifyOperationReceipt` with authenticated keeper identity and the expected operation
references, or typed FROST/BLS handles that perform those checks. Native dual-sign
results do not guarantee an attested receipt on every deployment.

For existing compound-token, verifier discovery and direct committee integrations,
read [advanced committee operations](references/advanced.md). Direct credential
committee helpers do not replace request-bound wallet authorization on a deployment
that requires it. Native multi-approver IBE and task-context enforcement are unsupported.
