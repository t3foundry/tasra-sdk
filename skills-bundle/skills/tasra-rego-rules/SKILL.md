---
name: tasra-rego-rules
description: Write, lint, test and commit a Rego access policy (a kk_oauth envelope) for a Tasra slot whose holders sign in with their organization's own identity provider (OAuth, DPoP-bound access tokens). Use when an OAuth slot's decision needs more than DCQL value lists — nested roles, several claims combined, helper rules, case-insensitive matches.
compatibility: Requires tasra-sdk to be installed (npm install tasra-sdk)
metadata:
  package: @t3foundry/tasra-skills
  sources: "node_modules/tasra-sdk/docs/flows.md, node_modules/tasra-sdk/dist/auth/rego.d.ts, node_modules/tasra-sdk/dist/chain/write.d.ts, node_modules/tasra-sdk/dist/chain/provisionRule.d.ts, node_modules/tasra-sdk/dist/committee/oauth.d.ts"
---

# Write a Rego policy for an OAuth slot

A Rego rule is a **`kk_oauth` policy envelope**: two halves with different jobs.

- `tokens` is **data the network enforces before any policy runs**: the token format,
  the trusted issuers, the audiences and the maximum token age. The drawn verifiers check
  the token signature, its DPoP proof and these pins first.
- `policy` is a **Rego v1 module that decides on claims only**. It never re-checks issuer,
  audience or expiry, and it has no clock.

Use it only for slots created with `authType: 'oauth'`. Keepers refuse an envelope on any
other slot, wallet (OID4VP) paths refuse it, and it never authorizes identity-scoped (IBE)
operations. If the decision is a plain value list (`role` is one of …), an OAuth DCQL
query is simpler — see `tasra-dcql-rules`.

```ts
import {evaluateEnvelope, lintEnvelope, packEnvelope, type OauthTokens} from 'tasra-sdk'
import {platformAudience} from 'tasra-sdk/committee'

const POLICY = `package tasra.slot

default allow := false

allow if "treasury-signer" in input.tokens.corp.claims.realm_access.roles
`

export async function treasuryPolicy(issuer: string, agentOrigin: string, chainId: number) {
  const tokens: OauthTokens = {corp: {format: 'oauth+access-token+dpop', iss: [issuer],
    aud: [platformAudience(agentOrigin, chainId)], max_age_secs: 300}}
  const envelope = await packEnvelope(POLICY, tokens)
  const lint = await lintEnvelope(envelope)
  if (!lint.admissible) throw new Error(`keepers would not store this rule: ${lint.admissionError}`)
  const holder = `${issuer}#alice`
  const claims = {iss: issuer, sub: 'alice', aud: tokens.corp!.aud,
    realm_access: {roles: ['treasury-signer']}}
  const verdict = await evaluateEnvelope(envelope,
    {holder, credentials: [{format: 'oauth+access-token+dpop', issuer, claims}]})
  if (!verdict.allow) throw new Error('the policy refuses the holder it was written for')
  return envelope
}
```

`packEnvelope` refuses anything the network's static gate refuses. `lintEnvelope` also
says whether keepers would store it **today** (one token per envelope for now).
`evaluateEnvelope` runs the network's own engine (WebAssembly, hash-checked on load), so a
local verdict is the verdict the verifiers reach for the same claims. It does not verify the
token signature, DPoP proof or age. Test a holder who must be refused as well as one who must
be allowed.

## Commit it to a slot

Create the slot with the low-level writer from `tasra-sdk/chain`. The application-level
`tasra.slots.create({policy})` accepts DCQL policies only and refuses an envelope.

```ts
import {provisionRule, type ProvisionRuleArgs, type TasraChainClient, type TasraWriteClient} from 'tasra-sdk/chain'

type Journal = (entry: {rule: string; ruleSalt: `0x${string}`; slotId?: `0x${string}`}) => Promise<void>

export async function createRegoSlot(writer: TasraWriteClient, chain: TasraChainClient,
  creator: ProvisionRuleArgs['signer'], envelope: string, journal: Journal) {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const ruleSalt = `0x${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}` as const
  await journal({rule: envelope, ruleSalt})
  const created = await writer.createSlotCommitReveal({rule: envelope, ruleSalt, authType: 'oauth',
    mode: 'frost', k: 2, n: 3})
  await journal({rule: created.rule, ruleSalt, slotId: created.slotId})
  return provisionRule(chain, {slotId: created.slotId, rule: created.rule, ruleSalt, signer: creator})
}
```

**Persist the exact envelope string and its salt before submitting.** The chain stores only
a salted commitment, and the salt exists nowhere else. The policy source is committed byte
for byte: reformatting, re-indenting or re-ordering it is a different rule (an amendment).
`unpackEnvelope` recovers the parts; `packEnvelope` of those parts reproduces the string.
Provision after the slot's key exists; `tasra-create-slot` covers durable creation,
recovery and retries.

Holders authorize through the Verifier Agent's OAuth session (`createOauthSession`,
`submitOauthResponse`, `waitForSession` from `tasra-sdk/verifier-agent`), not with a wallet
presentation — see `tasra-oid4vp-wallet-and-verifier-agent`.

## What a refused holder sees

Only `kk_oauth policy refused` (`REGO_POLICY_REFUSED`, HTTP 403), or `this slot's kk_oauth
rule is malformed` (400). The policy is confidential to the network's operators, so a refusal
never names a claim or clause. Debug locally with `evaluateEnvelope`; never by probing the
network.

The policy language is restricted on purpose: about two dozen builtins, no `data`, no
`with`, no recursion, at most two nested loops, a 3 KiB source, and `input` read only as
`input.tokens.<declared id>…`, `input.holder` or `input.v`. Read
[policy rules, input document and examples](references/advanced.md) before writing anything
beyond the example above.
