# Handling failures

> The error taxonomy, what is retryable, and how to tell a denial from an outage.

Use exported error classes and fields instead of matching `err.message`.
`TasraError` covers the typed failures in the table below, but some SDK errors
extend plain `Error`, including the reconciliation errors described later.

For a read that is safe to repeat, classify the failure before scheduling a
bounded retry. The recovery functions below are application callbacks:

```ts
import {
  isAuthDenied, isRetryable, ThresholdNotMetError, SlotRotatedError,
} from 'tasra-sdk'

try {
  await readStatus() // An application read with no write effects.
} catch (e) {
  if (isAuthDenied(e)) return reclaimCredential() // 401/403 — retrying is futile
  if (e instanceof ThresholdNotMetError) {
    // One reason per participant that failed.
    console.warn(`only ${e.got}/${e.need} answered:`, e.reasons)
  }
  if (e instanceof SlotRotatedError) throw e // Review the changed slot.
  if (isRetryable(e)) return scheduleBoundedReadRetry()
  throw e
}
```

| Class | Carries | `retryable` |
|---|---|---|
| `TasraError` | base for all of the below | — |
| `TasraHttpError` | `status`, `url`, `body` (200 chars) | 5xx / 429 |
| `AuthDeniedError` | as above; 401/403 | **never** |
| `NodeUnreachableError` | `url` — no HTTP answer at all | yes |
| `ThresholdNotMetError` | `got`, `need`, `reasons[]` | yes, unless every node denied |
| `SlotRotatedError` | `expected`, `actual` epoch | yes |
| `CommitteeAuthorizeError` | as `TasraHttpError` — a verifier refused to co-sign | 5xx / 429 |
| `DcqlMalformedError` | the rule is not well-formed OID4VP-DCQL | **never** |
| `VerifierAgentSessionError` | `kind`, `correlation`, `httpStatus?` — a Verifier Agent session failed | `timeout` / `unavailable` only |

`isRetryable(e)` returns `false` for errors outside the `TasraError` hierarchy.
A `true` result describes a possibly transient failure; it does not prove that
repeating the operation is safe. Restrict automatic retries to safe reads, with
an attempt limit, deadline and cancellation. Never automatically repeat a
transaction, signing request or approval submission after an uncertain outcome.
`isAuthDenied(e)` is keyed on HTTP status rather than class, so it also catches a
403 from `CommitteeAuthorizeError`.

Argument validation (a malformed slot id, a client configured with no nodes) still
throws plain `Error` — those are programming mistakes, not runtime conditions to
branch on.

## Uncertain submissions

Retain the original operation details and reconcile before submitting again:

| Error | Import | Retained details and recovery |
|---|---|---|
| `CreationReconciliationRequiredError` | `tasra-sdk/app` | `slotId`, `step`; preserve the creation journal and reconcile the wallet transaction before resuming. |
| `ApplicationSlotRecoveryError` | `tasra-sdk/app` | `code`, `recoveryName`, optional `slotId` and `transactionHash`; inspect the saved named intent or original verifier-policy transaction before resuming. `VERIFIER_POLICY_OUTCOME_UNKNOWN` means a submission may have happened without a recorded hash; never submit another policy transaction until reconciled. `VERIFIER_POLICY_RECEIPT_PENDING` has a saved hash and can resume receipt observation. |
| `OperationOutcomeUnknownError` | `tasra-sdk/committee` | `operation`, optional `requestId`; inspect the original approval request. If its ID was lost, retain that uncertainty. |
| `RelayOutcomeUnknownError` | `tasra-sdk/chain` | `attempt`; use `reconcileRelayAttempt` with that signed request and the trusted chain reader before considering a replacement. |
| `AgentSessionCreationUnknownError` | `tasra-sdk/chain` | `profile`; session creation may have reached that provider. A replacement requires explicitly opening a fresh wallet session; do not transfer session secrets or presentations. |

The last two classes extend plain `Error`, so check them explicitly with
`instanceof`. Unknown errors and cancellation after submission also leave the
remote outcome uncertain. Stopping local work does not undo a submitted request.
Log only public diagnostic references, never entire errors, signed requests,
credentials or tokens.

---

[Back to the README](../README.md) · [Documentation index](README.md)
