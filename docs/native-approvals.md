# Native approval quorum for one FROST signature

This candidate exposes the network's native dual-sign lifecycle through
`createDualSignClient` and `frostSlot.approvals`. The approval quorum counts people
(or configured approver keys); the keeper threshold counts cryptographic shares.
They are separate numbers.

```ts
const slot = await tasra.slots.frost(slotId)
const approvals = await slot.approvals({quorum: 2, credentialGated: false})
const request = await approvals.create(exactMessageBytes)
// Persist requestId, coordinator, slot, message and the independently pinned policy.
await request.approve({signer: aliceSigner})
await request.approve({signer: bobSigner})
const signature = await request.wait({timeoutMs: 120_000, signal})
```

Each signer implements `{publicKey, sign(bytes)}` and signs the exact supplied
canonical payload with Ed25519. Keep its private key outside model-authored tool
arguments. Static keys must already be authorized by the slot's native policy.
The SDK checks the pending slot, message and quorum before asking for a signature,
and checks the final FROST signature against the expected group key and message.

For credential-gated policies, each approval supplies `authorization: {token,
verifierProofs}` from its own holder-bound `dual-approve` session. Compute the
session's payload digest as SHA-256 of `dualSignApprovalPayload(slotId, message,
requestId)` from `tasra-sdk/committee`. The SDK checks that exact request binding;
it never falls back to a JWT endpoint. The network enforces distinct authorized
holders, not merely different delivery keys.

After a restart, use `approvals.resume(saved.requestId, saved.message)` with the
original coordinator and pinned policy. After an ambiguous POST, catch
`OperationOutcomeUnknownError` and reconcile status. Do not automatically create
a replacement request. If creation lost its request ID, the current protocol
cannot discover it through this SDK; preserve that uncertainty for an operator.

This is separate from two detached signatures in a document workflow. It does
not enable multi-approver IBE extraction.

Two complete examples exercise these behaviors on a compatible local fleet:

- [Static approver keys](../examples/native-approvals.ts): distinct approvals, duplicate-vote prevention and cross-request replay refusal.
- [Credential-gated approvals](../examples/credential-approvals.ts): Alice and Bob present separate holder-bound credentials for the exact request; Alice's repeated approval does not add another vote. The SDK verifies the final threshold signature.

Run either source file using the [local-fleet tutorial setup](shared-account.md#1-prepare-the-sdk-and-local-fleet).
Each example creates a development slot and saves its result and recovery data under
`.tasra/`. Keep holder keys, credentials and recovery journals private. Check that
your run reaches the final signature assertion; a completed setup alone does not
establish that the approval flow succeeded.
