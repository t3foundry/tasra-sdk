# Advanced clients and OAuth


Start with the [shared-account tutorial](shared-account.md) for a complete app.
The [generated reference](reference/README.md) covers public signatures, option
fields, return types, and source comments across all eight library entry points. This page maps
imports to tasks; [chain](chain.md), [signing](signing.md), and [errors](errors.md)
provide operation details. Code fragments below assume their named inputs already exist.

## Choose a client

Start new applications with `TasraClient` from `@t3foundry/tasra-sdk/app`. The runtime class
is separate from the root module's existing `TasraClient` session-client type.
Install the latest SDK with `npm install @t3foundry/tasra-sdk@latest`; see
[installation](installation.md) for runtime and TypeScript setup.

| Entry point | Import | Use it for | Requires |
|---|---|---|---|
| `new TasraClient({manifest})` / `TasraClient.fromManifest(url)` | `@t3foundry/tasra-sdk/app` | Create slots, use wallets and credentials, encrypt and sign | Public deployment manifest; wallet and durable store for slot creation |
| `createFileStore` | `@t3foundry/tasra-sdk/app/node` | Private durable state for a Node application | A private local directory |
| `createTasraChainClient` | `@t3foundry/tasra-sdk/chain` | Read contracts and discover the network | RPC, chain ID, deployment addresses |
| `createTasraWriteClient` | `@t3foundry/tasra-sdk/chain` | Create slots, fund them, change on-chain state | Deployment configuration and funded transaction signer |
| `createCommitteeSlotClient` | `@t3foundry/tasra-sdk/chain` | Credential-gated threshold encryption/decryption and FROST signing | Chain client, slot, holder, credentials and verifier proofs |
| `createTasraSlotClient` | `@t3foundry/tasra-sdk/chain` | Chain-discovered managed sessions | Chain client, identity and session authentication |
| `createTasraClient` | `@t3foundry/tasra-sdk` | Managed sessions with explicit endpoints | Keeper URLs and session authentication; verifier for credential redemption |

The remaining factories support advanced integrations and existing applications.
Managed-session local decryption requires an **exportable** BLS slot. Threshold
custody uses the committee client; it does not export the master key.
For Ethereum signatures, see [`signEoaDigest`](signing.md), not committee FROST signing.

## Common results

| Call | Returns | Related guide |
|---|---|---|
| `tasra.check()` | Chain and registry availability; authorization compatibility remains unknown | [Quickstart](getting-started.md) |
| `tasra.slots.create(request)` | Ready typed slot with its committed access policy provisioned | [Application API](application-api.md#create-a-wallet-identity-and-slot) |
| `tasra.wallets.create()` / `tasra.wallets.connect(provider)` | Local wallet / promise of an external-wallet adapter | [Application API](application-api.md) |
| `tasra.wallets.fromSlot(slotId, {authorize})` | Promise of a threshold Ethereum wallet with named durable transfers | [Shared account](shared-account.md) |
| `tasra.identities.create()` | Fresh holder identity with a DID and explicit private-key export | [Credentials](application-api.md#issue-credentials-and-authorize-a-user) |
| `tasra.credentials.issue(input)` / `authorize(input)` | SD-JWT credential / operation authorizer | [Credentials](application-api.md#issue-credentials-and-authorize-a-user) |
| `parsePinnedNetworkManifest(text, sha256)` | Validated `NetworkManifest`; throws on checksum or schema mismatch | [Fuji configuration](fuji.md) |
| `createTasraChainClient(config)` | `TasraChainClient` with `client` and typed `readers` | [Chain reference](chain.md#create-a-read-client) |
| `chain.readers.keyRegistry.getKeySlot(slotId)` | Promise of slot state, including `exists`, `mode`, `publicKey`, `epoch`, `cancelled` | [Address lookup](signing.md#get-the-ethereum-address) |
| `addressFromEoaPubkey(pubkey)` | EIP-55 checksummed Ethereum address | [Address lookup](signing.md#get-the-ethereum-address) |
| `committeeSignEoaDigest(options)` | Promise of `{groupPublicKey, r, s, yParity}` using request-bound authorization | [Complete tutorial](shared-account.md) |
| `signEoaDigest(options)` | Promise of `{groupPublicKey, r, s, yParity}` | [Signing](signing.md) |
| `client.openSession(slotId, auth)` | Promise of a managed `Session` | [Exportable vault](encryption.md#if-you-want-an-exportable-personal-vault) |

## Application entry exports

`@t3foundry/tasra-sdk/app` provides `TasraClient`, the manifest loader, wallet and identity
adapters, credential helpers, slot creation and native approval helpers.
`@t3foundry/tasra-sdk/app/node` provides `createFileStore`; keep this Node-only import out of
browser bundles. See the [application guide](application-api.md) for the normal
workflow and [generated application reference](reference/app.md) for complete signatures.

## Main entry exports


| Group | Symbols |
|---|---|
| **Managed client** | `createTasraClient`, `TasraClient`, `Session`, `SessionAuth`, `VpJwtAuth`, `OpenSessionOpts`, `SignOpts` |
| **Errors** | `TasraError`, `TasraHttpError`, `AuthDeniedError`, `NodeUnreachableError`, `ThresholdNotMetError`, `SlotRotatedError`, `CommitteeAuthorizeError`, `DcqlMalformedError`, `VerifierAgentSessionError`, `isAuthDenied`, `isRetryable` |
| Crypto | `encryptEnvelope`, `decryptWithMasterKey`, `toBytes`, `fromBytes`, `buildTasraText`, `parseTasraPost`, `isTasraPost`, `GroupEnvelope` |
| Identity-scoped IBE | `ibeEncrypt`, `ibeCombineExtract`, `ibeCombineDecrypt`, `ibeDecryptWithKey`, `requestIbeExtractionPartials`; **large objects**: `ibeSealBlob`, `ibeOpenBlob`, `ibeUnwrapBlobKey`, `ibeBlobDecryptKey`, `ibeDecryptBlobChunk`, `ibeBlobChunkRange`, `ibeBlobDigest`, `IbeBlobHeader` |
| Node client | `fetchMpk`, `fetchAndAssembleKey` |
| Signing | `signCustody`, `signWithShardDelivery`, `signUserRequest`, `signEoaDigest`, `ethSignatureV`, `addressFromEoaPubkey`, `aggregateFrostSignature`, `verifyFrostSignature` |
| Decryption (threshold) | `decryptCustody`, `decryptWithShardDelivery`, `combineDecryptShares`, `verifyDecryptShare` |
| Verifier auth + JWT | `redeemCredential`, `redeemRenewalToken`, `createRenewal`, `revokeRenewal`, `issueAdminCredential`, `revokeSlotUser`, `verifyPresentation`, `verifyVpJwt`, `decodeJwtClaims`, `jwtExpMs`, `isJwtExpiringSoon` + `IssuedToken`, `JwtClaims` |
| DCQL (OID4VP-DCQL) | `validateDcql`, `evaluateDcql`, `selectDcql`, `canonicalizeDcql`, `isOid4vpRule`, `jsonCredential`, `evaluateIdentityScoped`, `scopeCovers`, `DcqlMalformedError`, `DCQL_MAX_RULE_LEN` + `DcqlQuery`, `CredentialView` |
| Verifier Agent sessions | `createOid4vpSession`, `pollOid4vpSession`, `waitForSession`, `payloadDigest`, `VerifierAgentSessionError`; `oauth` kind: `createOauthSession`, `submitOauthResponse` + `CreateSessionParams`, `CreateOauthSessionResult`, `SessionStatusResult` |
| DPoP (RFC 9449) | `createDpopKey`, `auth0DpopSigner`, `jwkThumbprint`, `accessTokenHash`, `isHeaderSafeNonce` + `DpopSigner`, `DpopKey` |
| Committee tokens | not on the main entry — see [`@t3foundry/tasra-sdk/committee`](#t3foundrytasra-sdkcommittee--protocol-internals) |
| Slot funding | `httpFaucet` (sovereign slot creation lives in `@t3foundry/tasra-sdk/chain`) |
| Utils | `hexToBytes` |

For new apps, use `tasra.slots.bls(...)` and `tasra.slots.frost(...)` for
credential-gated threshold custody. `createCommitteeSlotClient` remains available
for advanced committee integrations. Managed
`Session.decrypt` requires an exportable personal-vault slot; the session primitives,
verifier-auth helpers, and crypto are what it composes (use them directly when you
need finer control). To resolve endpoints from chain instead of hardcoding them, use the
`@t3foundry/tasra-sdk/chain` clients (`createTasraSlotClient` / `createCommitteeSlotClient`).
Verifier-auth helpers are pure HTTP/JSON; JWT inspection is client-side only (expiry/UX),
never a signature check. DCQL is a **generic** evaluator — scope *semantics* are the
consuming product's concern.

## Large objects under IBE — `ibeSealBlob` / `ibeOpenBlob`

`ibeEncrypt` is a KEM for a small payload. For an image, a scan series or any multi-megabyte
object, seal an **envelope**: a fresh 32-byte data key IBE-wrapped to the identity, the body
AES-256-GCM in fixed chunks (WebCrypto, default 1 MiB), each chunk's nonce
`blobId[0..8] ‖ be32(i)` and its AAD `"keykeeper/ibe-blob/v1" ‖ blobId ‖ be32(i) ‖ last ‖ identity`
— so a chunk cannot be reordered, dropped, truncated or replayed under another identity.

```ts
import {ibeSealBlob, ibeOpenBlob, ibeUnwrapBlobKey, ibeBlobDecryptKey, ibeDecryptBlobChunk, ibeBlobChunkRange} from '@t3foundry/tasra-sdk'

// producer (offline, nothing but the slot's public MPK)
const {header, body} = await ibeSealBlob(mpk, 'did:key:zPatient/imaging/2026-09', pngBytes, {contentType: 'image/png'})
// store `body` as a blob and `header` beside it (header.wrappedKey is the IBE ciphertext of the data key)

// consumer, after an identity-scoped extraction gave it sk_ID for that identity
const png = await ibeOpenBlob(skId, header, body) // whole object in memory, or …
const dek = ibeUnwrapBlobKey(skId, header) // … stream it:
const key = await ibeBlobDecryptKey(dek)
for (let i = 0; i < header.chunkCount; i++) {
  const {start, end} = ibeBlobChunkRange(header, i) // byte range of chunk i in `body`
  const plain = await ibeDecryptBlobChunk(key, header, i, await fetchRange(start, end))
}
```

`sk_ID` is a per-identity capability, so one extraction opens every object sealed to that
identity; time-box identities (`…/2026-09`) rather than expecting to revoke one. Use a producer-authenticated manifest containing both the header and the body
digest (`ibeBlobDigest(body)`) so the consumer can reject substituted metadata or
ciphertext before decrypting. A signed body digest alone does not protect the header.

Chunk size must be an integer of at least 1024 bytes. Empty input still has one
chunk: zero plaintext bytes and a 16-byte authentication tag. Exact chunk-size
multiples add no extra chunk; the last partial chunk contains the remaining bytes.
`ibeBlobChunkRange` returns an exclusive `end`; an HTTP Range request ends at
`end - 1`. Validate safe-integer indices in `[0, header.chunkCount)` and use a trusted
header. The SDK rejects negative and past-end indices; it does not validate every
malformed header or fractional index. Authenticate the header alongside the body
digest before trusting metadata such as `contentType`.

## `@t3foundry/tasra-sdk/oid4vp` — credential wallets against the Verifier Agent

The wallet protocol uses OpenID4VP 1.0 with DCQL, SD-JWT VC + KB-JWT, JARM
`direct_post.jwt`, and OpenID4VCI pre-authorized issuance. This subpath supports
two application roles:

```ts
// APP / RELYING PARTY: sign the operation with the slot creator's EVM key (EIP-712
// PresentationOperation), open a session on the verifier-agent, hand the openid4vp:// payload to a wallet,
// collect the compound token — the credentials never come back here.
import {openVerifierAgentSession, awaitVerifierAgentResult} from '@t3foundry/tasra-sdk/oid4vp'
const session = await openVerifierAgentSession({verifierAgentUrl, chainId, keyRegistry, slotId, action: 'sign', message, description, signer: creatorAccount})
showQr(session.qrPayload)
const {token} = await awaitVerifierAgentResult(session) // checks token.request_hash against the session

// WALLET: receive a credential from any OpenID4VCI issuer, then answer a request: fetch + verify
// the JAR (did:web → the verifier-agent's set document), plan against its dcql_query, let the user pick ONE
// credential, disclose only the claims asked for, bind with a KB-JWT, encrypt, POST.
import {randomHolderKey, receiveCredential, presentToRequestUri} from '@t3foundry/tasra-sdk/oid4vp'
const holder = randomHolderKey() // P-256 did:jwk, cnf.kid = did#0
const {credential} = await receiveCredential({offerUri, holder})
await presentToRequestUri(qrPayload, [{sdJwt: credential}], holder, {choose: askUser})
```

`planPresentation` / `buildResponse` / `submitResponse` are the steps behind `presentToRequestUri`
for a UI that wants a consent screen between them. One credential per presentation: a rule that
needs two credentials must use `credential_sets` with single-credential options (what the Hovi
Wallet can satisfy). Issuers use `issueSdJwtVc` (P-256 `did:key` or `did:jwk` issuer); the
request binding (`requestHash`, `derivedNonce`) lives in `binding` for the verifier-agent
side. A wallet copies the nonce; it never interprets it.

## Bring your own identity provider — OAuth + DPoP against the Verifier Agent

A slot created with `authType: 'oauth'` is authorized by an access token your users already get
from your own IdP, sender-constrained with DPoP (RFC 9449). Its rule is a `kk_oauth` policy
envelope: a Rego v1 policy over the DPoP-bound token's claims, plus a `tokens` map the network
enforces before the policy runs — the token format, the pinned issuer, the platform audience and
the maximum token age. Create the slot with an `oauthPolicy`; the SDK packs the envelope with the
network's own engine and refuses one keepers would not store, before any chain call:

```ts
import {platformAudience} from '@t3foundry/tasra-sdk/committee'

const POLICY = `package tasra.slot

default allow := false

allow if "treasury-signer" in input.tokens.corp.claims.realm_access.roles
`
const tokens = {corp: {format: 'oauth+access-token+dpop', iss: ['https://idp.example.com/realms/acme'],
  aud: [platformAudience(agentOrigin, chainId)], max_age_secs: 300}}

const created = await writer.createSlot({
  authType: 'oauth', oauthPolicy: {policy: POLICY, tokens}, mode: 'frost', k: 2, n: 3,
  rulePolicy: {admin: adminAddress, guardian: writer.address, timelockSecs: 3600},
})
// created.rule is the packed envelope: persist it with created.ruleSalt, then provisionRule(...)
```

`createSlotCommitReveal` takes the same arguments. The policy decides on claims only; it never
re-checks issuer, audience or age. Test it locally with `evaluateEnvelope` before committing it.
The audience
is derived, never chosen — `platformAudience(agentOrigin, chainId)` from
`@t3foundry/tasra-sdk/committee`, or read it back from any `createOauthSession` reply.

```ts
import {auth0DpopSigner, createOauthSession, submitOauthResponse, waitForSession} from '@t3foundry/tasra-sdk'
import {presentationOperationTypedData} from '@t3foundry/tasra-sdk/oid4vp'

const {typedData, operation, messageHex} = presentationOperationTypedData({
  chainId, keyRegistry, slotId, action: 'sign', message, description: 'Treasury payout #42',
})
const operationSig = await creatorSigner.signTypedData(typedData)

const session = await createOauthSession(verifierAgentUrl, {operation, operationSig, messageHex})
// → {sessionId, pollSecret, nonce, dpopHtu, platformAudience} — no QR, no Request Object

await submitOauthResponse(verifierAgentUrl, {
  sessionId: session.sessionId, pollSecret: session.pollSecret,
  accessToken, nonce: session.nonce, dpopHtu: session.dpopHtu,
  signer, // MUST sign with the key the token is bound to
})
const result = await waitForSession(verifierAgentUrl, session.sessionId, session.pollSecret)
if (result.status !== 'done') throw new Error(`refused: ${result.error}`)
// result.compoundToken + result.verifierProofs → the keeper's /v1/committee/sign
```

**The signer is decided by where your token's DPoP key lives:**

| Your token came from | `signer` |
|---|---|
| `auth0-spa-js` with `useDpop` | `auth0DpopSigner((args) => auth0.generateDpopProof(args))` |
| `oidc-client-ts` with `dpop` enabled | `{proof: ({htm, htu, nonce}) => userManager.dpopProof(htu, user, htm, nonce)}` (it computes `ath` from the user's token) |
| your own token request with a key from `createDpopKey()` | `key.signer` |

To obtain the token with a `createDpopKey()` key, put `await key.tokenRequestProof({htm: 'POST',
htu: tokenEndpoint})` in the token request's `DPoP` header (add `nonce` only if the IdP answered
`use_dpop_nonce`); a token-request proof carries no `ath`, because there is no token yet. Then
present with `key.signer`.

**Note: the `htu` is this session's route on the agent's PUBLIC origin:**
`{agentOrigin}/v1/sessions/{sessionId}/oauth-response`, returned as `session.dpopHtu`. When you
call the agent at that origin, it is exactly the URL `submitOauthResponse` posts to, so a
generic DPoP client that derives `htu` from the request URL works too. If you reach the agent
through a different base URL (an internal hostname, a proxy), sign over `session.dpopHtu` — the
origin the verifiers approved — not over the URL you called.

**Note: a refused delivery throws.** When the committee refuses (wrong role, stale token, wrong
audience…) the agent answers the POST itself with `{status: "failed", error}` — `403` for a
refusal, `503` when the drawn quorum could not be reached — and `submitOauthResponse` throws
`VerifierAgentSessionError` with `kind: 'refused'` and the verifiers' reasons in `message`. The
session is over; open a new one to retry. On success, `waitForSession` returns the token.
`submitOauthResponse` answers the agent's `use_dpop_nonce` challenge once by itself.

What the platform proves this way is PRESENCE, not intent — the user never sees the
operation; pin dual control on slots that need intent. Configuring a tenant identity
provider is a deployment task, documented by whoever operates the network.

### Amend the rule

A slot created with a `rulePolicy` can change its rule without changing its key. The rule admin
proposes the new rule, it is delivered to the keepers, the keepers adopt it, and once the delay
has passed it is activated. `amendSlotRule` drives every step, checks everything it can before
signing, and resumes where the chain is when called again with the same rule:

```ts
import {amendSlotRule, createTasraChainClient, createTasraWriteClient, readRuleAmendment} from '@t3foundry/tasra-sdk/chain'
import {privateKeyToAccount} from 'viem/accounts'

// The slot was created with rulePolicy {admin: adminAddress, guardian: creatorAddress, timelockSecs: 3600}.
const chain = createTasraChainClient({rpcUrl, chainId, addresses})
const admin = createTasraWriteClient({rpcUrl, chainId, addresses, privateKey: adminKey})
const creator = createTasraWriteClient({rpcUrl, chainId, addresses, privateKey: creatorKey})

const status = await readRuleAmendment(chain, slotId) // status.policy === null: the rule can never change
const amended = await amendSlotRule(admin, chain, {
  slotId,
  ruleSalt, // the slot's saved rule salt
  oauthPolicy: {policy: NEW_POLICY, tokens},
  deliverer: privateKeyToAccount(creatorKey), // signs the delivery to the keepers
  guardian: creator, // endorses, which waives the remaining delay
  onPhase: phase => console.log(phase), // proposed, delivered, adopted, endorsed, activated
})
// → {version, ruleCommitment, proposeTx?, activateTx?}
```

- `readRuleAmendment(chain, slotId)` returns the active commitment, the policy (`null` when the
  rule can never change) and the pending amendment with its keeper adoption votes.
- `proposeRuleUpdate`, `endorseRuleUpdate`, `vetoRuleUpdate` and `activateRuleUpdate` on the write
  client are the single steps. Each checks the contract's preconditions before signing and throws
  `RuleAmendmentError` with a `code`.
- `provisionRule(chain, {…, expect: 'pending'})` delivers a proposed rule, waiting for keepers
  that have not yet seen the proposal. The creator, a creator delegate or the rule admin may sign it.

**An amendable rule means whoever holds the admin key can change who may sign with this key,
without changing the key.** Keep the admin key as safe as the slot itself. The guardian can veto
during the delay; without a guardian nobody can. Slots created without a rule admin can never
become amendable. A proposal no keeper stores never activates, and a new one is refused while it
is pending, so lint the new policy first.

## Sealed committee evidence — `evidence_ct`

Each drawn verifier seals the presentation it evaluated to the accountant set's certified
evidence key, and signs a second message binding that ciphertext to the token it signed. When
the committee sealed one, the compound token carries three optional fields and the Verifier
Agent's poll reply carries the ciphertext BESIDE the token:

| Where | Field | What |
|---|---|---|
| `compound_token` | `evidence_hash` | `0x..` keccak256 of `bincode(ciphertext)` |
| `compound_token` | `evidence_key_id` | `0x..` keccak256 of the evidence key it is sealed to |
| `compound_token` | `evidence_signatures` | `[{verifier_index, signature}]` — each over `evidenceBindingMessage(tokenHash, evidenceHash, evidenceKeyId)` |
| poll reply | `evidence_ct` | base64url `bincode(ciphertext)` — surfaced as `evidenceCt` |

The three token fields come together or not at all (`assertCompoundTokenWire` refuses anything
else). They are NOT inside the token's signed canonical bytes, so `committee-token-vectors.json`
is unchanged. Hand `evidenceCt` to every keeper call (`committeeSign`, `committeeDecrypt`,
`requestIbeExtractionPartials` take an optional `evidenceCt`, posted as `evidence_ct`): a keeper
with `require_committee_evidence` refuses a token without it, and retains it so a mis-issuance
can be challenged. Nothing in the ciphertext is readable without a threshold of accountants.
`evidenceBindingMessage` / `verifyEvidenceBinding` (on `@t3foundry/tasra-sdk/committee`) mirror the
Rust functions and are pinned to `test/committee-evidence-vectors.json`.

## `@t3foundry/tasra-sdk/committee` — protocol internals

The compound-token layer — committee draw, canonical hashing, ed25519 quorum
verification, verifier-set Merkle proofs, wire codecs, and the
`/v1/committee-authorize` orchestration — lives behind its own subpath:

```ts
import {verifyCompoundToken, selectVerifierCommittee} from '@t3foundry/tasra-sdk/committee'
```

It also carries the derivations `platformAudience(origin, chainId)` and
`dpopHtu(origin, sessionId)` (+ `normalizeOrigin`, `isValidSessionId`,
`OAUTH_RESPONSE_PATH_PREFIX`/`_SUFFIX`), vector-pinned byte for byte
against `keykeeper-committee`'s `oauth` module (`test/dpop.ts`).

**Most consumers never need it.** Typed slots on `TasraClient` handle these
operations. Advanced integrations can use `createCommitteeSlotClient` from
`@t3foundry/tasra-sdk/chain`; reach for protocol primitives when implementing or auditing the
protocol itself.

These ~35 symbols are deep protocol internals — canonical hashing, Merkle proofs,
the committee draw, wire codecs — and they are **not** on the main entry, so
`import {…} from '@t3foundry/tasra-sdk'` autocompletes to the managed surface rather
than to `compoundTokenCanonicalBytes`.

---

[Back to the README](../README.md) · [Documentation index](README.md)
