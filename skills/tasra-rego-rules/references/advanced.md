# Rego policies: the rules the network enforces

Everything here is enforced by the network's static gate and input builder. The SDK runs the
same code (`packEnvelope`, `lintEnvelope`, `evaluateEnvelope`), so a local refusal is the
refusal a keeper or verifier would give. Read the installed declarations in
`dist/auth/rego.d.ts` for exact types.

## The envelope

```json
{"kk_oauth": {
  "v": 1,
  "tokens": {"corp": {
    "format": "oauth+access-token+dpop",
    "iss": ["https://idp.example.com/realms/acme"],
    "aud": ["https://agent.example.com/authz/43113"],
    "max_age_secs": 300,
    "ci_claims": ["email"]
  }},
  "policy": {"lang": "rego/v1", "entrypoint": "data.tasra.slot.allow", "source": "package tasra.slot\n…"}
}}
```

Do not hand-write it; `packEnvelope(policy, tokens, entrypoint?)` produces the canonical
(RFC 8785) string, which is what the slot commits to. The schema refuses unknown fields at
every level and duplicate keys (it never resolves a duplicate to the last one).

| Field | Rule |
|---|---|
| token id (`corp`) | `^[a-z][a-z0-9_]{0,31}$`; **exactly one token per envelope today** — `lintEnvelope` reports a multi-token envelope as not admissible |
| `format` | `oauth+access-token+dpop` |
| `iss` | 1–8 entries, each byte-equal to the provider's discovery `issuer` |
| `aud` | required, 1–8 non-blank entries ≤ 512 bytes; use `platformAudience(agentOrigin, chainId)` from `tasra-sdk/committee` rather than typing it |
| `max_age_secs` | 1..=86400 |
| `ci_claims` | optional, ≤ 8 distinct top-level claim names (1–64 bytes) to expose lower-cased |
| `policy.lang` | `rego/v1` |
| `policy.entrypoint` | `data.<package>.allow`; default `data.tasra.slot.allow` |
| `policy.source` | ≤ 3 KiB |
| whole rule | ≤ 4096 UTF-8 bytes (`MAX_RULE_LEN`) |

## The input document — the only thing a policy sees

```json
{"v": 1,
 "tokens": {"corp": {"claims": {"sub": "…", "realm_access": {"roles": ["…"]}, "email": "Alice@Example.COM"},
                     "claims_ci": {"email": "alice@example.com"}}},
 "holder": "https://idp.example.com/realms/acme#<sub>"}
```

- `claims` is the token's verified payload. `claims_ci` holds ASCII-lower-cased copies of the
  string claims listed in `ci_claims` — the way to compare case-insensitively, because there is
  no `lower()` builtin.
- **Absent on purpose**: the token's format and issuer (the envelope owns them and they were
  already enforced), and any clock (freshness is `max_age_secs`, checked before the policy).
- Integers outside the 64-bit signed range arrive as **decimal strings**. Compare such a claim
  as a string.
- The presentation must hold exactly one token per declared id (matching format and a pinned
  issuer), the token's `aud` must contain a pinned audience, and no undeclared token may be
  present; otherwise the request is refused before the policy runs.
- Caps: any claim array ≤ 256 elements, claims nesting ≤ 64, the whole input ≤ 64 KiB. Over a
  cap, the holder is refused.

## The policy gate

| Allowed | Refused |
|---|---|
| exactly one module, Rego v1 syntax (`if`, `in`, `contains`, `every`) | Rego v0 syntax, several modules |
| `package` equal to the entrypoint's package | a mismatching package |
| `import rego.v1`, `import future.keywords…` | any other import |
| `input.tokens.<declared id>…`, `input.holder`, `input.v` | any other `input` path; iterating `input.tokens`; `data` |
| reading every declared token | a declared token the policy never reads, or an undeclared one |
| exactly one `default allow := <bool>` and at least one `allow if …` | any other form of `allow` |
| helper rules and functions with plain names | recursion (directly or through other rules/functions); a name that is reserved (`verify`, `tokens`, `input`, `data`, `rego`, `future`) or equal to a builtin or builtin namespace; dynamic calls |
| ≤ 32 rules, ≤ 64 statements per query | more |
| iteration nesting ≤ 2 (`some … in`, `every`, `xs[_]`, counted through function calls) | deeper nesting |
| bracket nesting `[`/`{` ≤ 6, parentheses ≤ 16 | deeper |
| | `with` |

**Builtins — the complete allow-list:** `abs`, `contains`, `count`, `endswith`, `indexof`,
`is_array`, `is_boolean`, `is_null`, `is_number`, `is_object`, `is_string`, `max`, `min`,
`object.get`, `object.keys`, `sort`, `split`, `startswith`, `sum`, `to_number`, `trim`,
`trim_prefix`, `trim_suffix`, `type_name`. Nothing else: no `lower`/`upper` (use `ci_claims`),
no `regex.*`, `sprintf`, `json.*`, `time.*`, `http.send`, `io.jwt.*`, `crypto.*`, `print`,
`concat`, `array.concat`, `numbers.range`. `RegoEngine.allowlistV1()` returns the list the
installed build enforces. `lintEnvelope(...).report` shows which builtins, functions and
tokens a policy uses and its deepest iteration.

Keep evaluation cheap. The network bounds each evaluation in time; a policy that builds large
derived collections (a comprehension over a comprehension of a 256-element claim) is stopped
and the holder refused. Decide with direct membership tests and short loops.

## Patterns

Role in a nested array (Keycloak `realm_access.roles`):

```rego
package tasra.slot

default allow := false

allow if "treasury-signer" in input.tokens.corp.claims.realm_access.roles
```

Several claims plus a helper function (organization, client and MFA):

```rego
package tasra.slot

import rego.v1

default allow := false

has_mfa(c) if "mfa" in c.amr

allow if {
	c := input.tokens.corp.claims
	c.azp == "treasury-app"
	"treasury-signer" in c.realm_access.roles
	c.org_id == "org_acme"
	has_mfa(c)
}
```

Case-insensitive e-mail domain (declare `"ci_claims": ["email"]` in the token):

```rego
package tasra.slot

default allow := false

allow if endswith(input.tokens.corp.claims_ci.email, "@acme.example")
```

Alternatives (either rule body allows):

```rego
package tasra.slot

default allow := false

allow if "treasury-admin" in input.tokens.corp.claims.realm_access.roles

allow if {
	"treasury-signer" in input.tokens.corp.claims.realm_access.roles
	input.tokens.corp.claims.department == "finance"
}
```

A rule with several bodies is **OR**, and the statements in one body are **AND**. A missing
claim makes its statement undefined, so that body does not allow; it is not an error. A type
mismatch (`count(5)`) is undefined too.

## Testing

- `evaluateEnvelope(rule, presentation)` returns `{allow: true}` or
  `{allow: false, kind: 'reject' | 'malformed', message}`. Cover at least one holder who must be
  allowed and one who must be refused, built from the **real claim shape** your provider
  issues (decode a real access token's payload; do not guess nesting).
- To keep integers beyond 2^53 exact, pass the presentation as its JSON text verbatim instead
  of an object.
- `packEnvelope` and `lintEnvelope` throw `RegoEnvelopeError` (`kind: 'malformed'`) with the
  gate's reason — the construct it refused (`http.send`, `with`, a recursion, an undeclared
  token). A holder never sees that reason.
- The local verdict is advisory. It does not check the token signature, the DPoP proof or the
  token's age, which the verifiers do first.

## Changing a committed policy

The slot commits to the exact envelope string, and the network accepts nothing else. A
changed policy (even whitespace) is an amendment and needs the slot's configured amendment
policy; without one, create a new slot. With one, `amendSlotRule` on the write client
(`tasra-sdk/chain`) drives propose → `provisionRule({expect: 'pending'})` → adoption →
activation; `proposeRuleUpdate`, `endorseRuleUpdate`, `vetoRuleUpdate` and
`activateRuleUpdate` are the individual steps. Keep the policy source in version control with the
exact packed string and its salt, and recover the parts of a deployed rule with
`unpackEnvelope`.
