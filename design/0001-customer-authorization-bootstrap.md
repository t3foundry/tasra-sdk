# 0001 Customer authorization bootstrap (D12)

Status: implemented on `feature/customer-authorization-bootstrap`, not released. Maintenance
note, not published SDK content.

Network ground truth: keykeeper-network `origin/develop` 33906978 (contains f99651b0) and
`perf/integration-c25` 23b21783. The composition below uses only network behaviour certified at
57695596 (salted rule commitment, verifier rule fetch, drawn-signer request object with a
second-member cross-check, creator-signed payment intent and execution certificate). It needs
no network commit after 57695596.

## Problem

`paidOperation` needs the slot's exact raw rule and its salt. The SDK uses them for three things
only:

1. to prove, before anything is signed or spent, that the rule is the one the slot committed to
   on chain (`ruleCommitment(salt, rule)` against `KeyRegistry.getKeySlot().ruleCommitment`);
2. to compare the wallet-facing Request Object's `dcql_query` with the expected query before
   any credential is disclosed, and to choose the presentation family (wallet or OAuth);
3. to check that the verifier quorum's compound token binds `keccak256(raw rule)`.

Only (1) needs the salt. (2) and (3) need the raw rule bytes. The network itself never takes
the rule from the client: each drawn verifier fetches rule and salt from a keeper, checks them
against the on-chain commitment (`keykeeper-verifier/src/rule_fetch.rs`), and composes the
Request Object's query from it; the verifier-agent refuses a JAR a second drawn member does not
compose identically (`keykeeper-verifier-agent/src/server/request.rs`). So the rule is already
disclosed to every holder that opens a session for the slot; the salt is not, and the salt is
what keeps chain observers from confirming guesses about the rule.

## Decision

The holder receives a **slot policy bootstrap**: the raw rule plus an EIP-712 statement signed by
the slot's current creator. The salt never leaves the creator side.

### 1. What the holder receives and how it is authenticated

`SlotPolicyStatement`, domain `{name: "Tasra Slot Policy", version: "1", chainId,
verifyingContract: KeyRegistry}`, type `SlotPolicy`:

| Field | Binds |
|---|---|
| `slotId` | the slot |
| `ruleVersion` | `getKeySlot().ruleVersion` |
| `ruleCommitment` | `getKeySlot().ruleCommitment` (the salted on-chain commitment) |
| `ruleHash` | `keccak256(raw rule)`, the hash verifier tokens bind |
| `audience` | the holder application key it was issued to |
| `actions` | bitmask of committee actions (sign 1, decrypt 2, ibe-extract 4, dual-approve 8) |
| `sequence` | monotonic issue counter per slot and audience |
| `issuedAt`, `expiresAt` | lifetime, at most 86400 s |
| `bootstrapId` | random issue identifier |

Chain and registry are in the domain. The holder checks, in this order and before anything is
signed or spent:

- offline (`verifySlotPolicyBootstrap`): strict shape (unknown fields refused, rule at most
  4096 bytes), deployment, slot, audience, the requested action in scope, lifetime, that
  `keccak256(rule) == ruleHash`, and that the signature recovers to the configured creator;
- on chain, inside `paidOperation`, at the one canonical block discovery reads: the slot's
  creator is the signer, and its commitment and rule version equal the statement's;
- in the holder's durable store: the statement's `sequence` is not lower than one already
  accepted for this deployment, slot and audience (`replayed`), and an equal sequence names the
  same statement (`equivocated`).

After the session the existing check that the verifier quorum's token binds `ruleHash` still
runs, so a wrong rule fails twice over: at the JAR comparison and at the token.

Trust: the creator is the party that set the commitment and already signs every paid operation's
payment intent and execution certificate, so trusting its statement about its own rule adds no
new trusted party. The salted commitment stays the network's proof; the creator's signature
replaces the salt as the holder's proof.

### 2. Who supplies it and what authorizes retrieval

The creator side (for the Console, the isolated signer that unwraps rule and salt) issues it with
`issueSlotPolicyBootstrap`, which reads the slot and refuses unless the signer is the creator and
the rule and salt reproduce the commitment. Distribution can use any channel because the
statement is authenticated by its signature, not by the channel.

Retrieval is authorized by a **holder application key**: a key the organization enrolls for one
application, which is the statement's `audience`. The application signs a
`SlotPolicyRequest` (EIP-712, `{slotId, audience, nonce, issuedAt}`, at most 120 s old) with
`createSlotPolicyRequest`; the issuer checks it with `verifySlotPolicyRequest`, then checks
enrolment and that the nonce is new. This key is neither a holder credential (the wallet
credential or OAuth token the rule names) nor a Console API key (control-plane scope only).

The bootstrap discloses the rule to the enrolled application. Every holder that opens a session
sees the same rule in the Request Object, so this is no new disclosure. The salt is not
disclosed.

### 3. Composition

- **Creator consent** stays the existing remote `creator.signTypedData` callback. It signs
  typed data only: the presentation operation (slot, action, payload digest), the payment intent
  and the execution certificate. The Console signer should authenticate the calling application
  by the same application key and refuse consent for a revoked application or action; that
  per-operation consent is what the keepers enforce (`payment_auth.rs`, `execution_auth.rs`).
- **Holder identity** is unchanged: the SDK wallet, an external wallet, or an OAuth+DPoP holder
  talks to the verifier-agent and the keepers directly. Holder credentials and sign or decrypt
  payloads never pass through the Console.
- **Payment** is unchanged: the application's own dedicated gas payer reserves; the slot's
  TSRA balance pays the fee.

### 4. Network changes

None needed. Two network items would remove remaining trust in the SDK composition, but are not
required:

- a verifier-quorum-signed rule attestation (slot, commitment, rule hash) that a holder could
  read before a session, which would make the creator's statement unnecessary;
- ERC-1271 creator signatures, without which a contract cannot be a slot creator that signs paid
  operations (Q14, see below).

## Recovery: one operation per application key

`paidPolicyOperation` adds an application-chosen `operationKey`. Before anything is signed, the
key is bound in the store to the exact operation (deployment, slot, action, payload digest,
holder family, session mode); each request ID derived for it is recorded before witnesses are
fetched, so before the operation's own journal and before any reservation. Every later call with
the same key:

- resumes the original journal entry with `resumePaidOperation` (lost response, unknown session
  write, unknown keeper outcome, or the bootstrap expired or was superseded meanwhile); a
  changed policy or an expired grant then fails the original, never a replacement;
- refuses a different operation under the key (`key-reused`);
- refuses an original that is `failed` or `abandoned` (`closed`): a new key is needed;
- refuses an original that never reached its journal (`unjournaled`) unless the caller passes
  `restartUnjournaled`, and even then only when no request was derived or the derived request's
  payment window has passed (`in-flight` otherwise), so a slow original can never be reserved
  beside its replacement. A takeover by another process stops the slow original at its next
  request ID (`superseded`), before anything is reserved.

The journal stores the bootstrap and the raw rule; its salt field is zero.

## Out of scope and decisions for the owners

- **Self-custody hand-off (Q14, Q22).** ADR-0088 `proposeCreator`/`acceptCreator` refuse only the
  current creator (`KeyRegistry.sol` 1118-1134, unchanged on c25). Payment intents and execution
  certificates are recovered with `ecrecover` against the creator (`payment_auth.rs` 151-156,
  `execution_auth.rs` 89-95; no ERC-1271 on develop or c25). A secp256k1 slot that becomes its
  own creator needs its own signature for every paid operation, which needs a paid operation of
  itself: nothing could be signed, renewed or handed off again. A contract creator cannot sign
  any paid operation while it holds the slot. The SDK hand-off helpers now refuse both
  (`self-custody`, `contract-holder`). Longer creator cycles (A created by B's account, B by A's)
  are not detectable from one slot and stay a product decision.
- **Salt wrapping at rest (Q26)** is unaffected: the bootstrap needs only the creator side to
  hold rule and salt, however it stores them.
- **tECDSA reshare and custody address continuity (Q25)** are unaffected.
