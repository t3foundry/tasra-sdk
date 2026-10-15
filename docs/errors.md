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
| `TasraHttpError` | `status`, `url`, `body` (200 chars), `retryAfterMs?` | 5xx / 429 / 425; 409/410/422 with `Retry-After` |
| `AuthDeniedError` | as above; 401/403 | **never** |
| `NodeUnreachableError` | `url` — no HTTP answer at all | yes |
| `ThresholdNotMetError` | `got`, `need`, `reasons[]` | yes, unless every node denied |
| `SlotRotatedError` | `expected`, `actual` epoch | yes |
| `CommitteeAuthorizeError` | as `TasraHttpError` — a verifier refused to co-sign | 5xx / 429 |
| `DcqlMalformedError` | the rule is not well-formed OID4VP-DCQL | **never** |
| `VerifierAgentSessionError` | `kind`, `correlation`, `httpStatus?` — a Verifier Agent session failed | `timeout` / `unavailable` only |
| `RuleAmendmentError` | `code`, `slotId`, and when known `pendingVersion`, `pendingCommitment`, `hasGuardian`, `notBefore`, `chainTime`, `have`, `need`, `results`, `phase` — a rule amendment refused before signing, or one that did not reach the asked state | `timelock` / `below-threshold` / `timeout` only |

`isRetryable(e)` returns `false` for errors outside the `TasraError` hierarchy.
A `true` result describes a possibly transient failure; it does not prove that
repeating the operation is safe. Restrict automatic retries to safe reads, with
an attempt limit, deadline and cancellation. Never automatically repeat a
transaction, signing request or approval submission after an uncertain outcome.
For a request that is safe to send again, `retryIdempotent(work, {policy, signal})`
waits at least the service's `Retry-After` (plus bounded jitter), backs off without
one, and rethrows the last failure once a wait would exceed `maxDelayMs` or
`maxTotalWaitMs`. It cannot tell whether a request is safe to repeat; never wrap a
paid operation, reservation or approval with it.

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
| `PaidOperationRecoveryError` | `tasra-sdk/app` | `requestId`, `phase`, a stable `code` and `resumable`. `resumable: false` is final (`reservation-failed`, `session-refused` such as a committee refusal or HTTP 403/410, `payment-expired`), a write only reconciliation can settle (`session-write-uncertain`), or an execution only `recover` may read (`execution-uncertain`). `aborted` is the caller's own cancellation of a step that sent nothing uncertain. Otherwise call `resumePaidOperation`; never start the operation again. |
| `PaidReservationUncertainError` | `tasra-sdk/chain` | `code: 'reservation-uncertain'`, `requestId`, optional `transactionHash`; a reservation may have been broadcast (including when an abort ended the receipt wait). Reconcile it from the journal; never reserve it again. |
| `PaidReservationAbortedError` | `tasra-sdk/chain` | `code: 'aborted'`, `requestId`; the caller's signal stopped the reservation before its durable preparation. Nothing was journaled, claimed or sent; reserving again is safe. |
| `PaidApprovalUnresolvedError` | `tasra-sdk` or `tasra-sdk/chain` | `code: 'approval_outcome_unresolved'`, `reason` (`claim_lost`, `generation_moved`, `outcome_unknown`, `no_permit`, `legacy_state`, `conflict`), optional `proposalId`, `generation`, `key`. A retained operator approval may already have reached the agent, or its permit was claimed elsewhere; it is never resent. Reconcile the delivery by reading it. |
| `PaidBackoffError` | `tasra-sdk` or `tasra-sdk/chain` | `code` (`deadline_exceeded`, `server_wait_too_long`, `no_time_to_send`, `attempts_exhausted`), `route`, optional `httpStatus`, `retryAfterMs`, `remainingMs`, `neededMs`; a definite 429/503 could not be waited out inside its deadline. Nothing was sent after that refusal; a retained approval keeps its permit, so resume the paid operation later. |
| `PaidReservationQuotaError` | `tasra-sdk` or `tasra-sdk/chain` | `code: 'reservation_quota'`, `reason`, `retryAfterMs`, `url`; the accountant's reservation quota outlasted the prepare window. Nothing was reserved. |
| `PaidOperationAbandonRefusedError` | `tasra-sdk/app` | `abandonPaidOperation` refused because something could still land: `requestId`, `phase` and, when payment expiry alone unblocks it, `notBefore` (Unix seconds, `retryable: true`). A prepared reservation needs `reconcilePaidOperation` first. |
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
