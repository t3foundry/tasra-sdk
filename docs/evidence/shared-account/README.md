# Shared-account live evidence

On 2026-09-26, `npm run test:docs:live` packed the current SDK checkout, installed it
in a fresh temporary TypeScript app, and executed the shipped application against
the existing local fleet. No CLI was used.

| Result | Observed value |
|---|---|
| Chain | 43112 |
| New slot | `0x2ad7dc68c1f19525888798cef0586c0a86c58a1e37f078638a32d470e39eda33` |
| Ethereum account | `0xa9Bd337Be569Aa6cE90b17575207D8Bb8980f37E` |
| Alice | Confirmed, nonce 0, block 24064 |
| Bob | Confirmed, nonce 1, block 24066 |
| Mallory | Refused by verifier; account nonce stayed at 2 |

Alice transaction: `0x060b2736203f5653d9d3580bb2b7fa749bb3404db42dca041b5172edd9890ae4`.

Bob transaction: `0x5bb15ea16a27a701c2ec3d14de347ac194d1392f3dd3e52f5b03b56c908f0747`.

[Public run data](evidence.json) · [Alice receipt](alice-receipt.json) ·
[Bob receipt](bob-receipt.json) · [Artifact/source versions](provenance.json)

The test pins the SDK artifact and example by SHA-256. The source commit is recorded
with `sourceDirty: true` because these changes had not been committed or published.
The exact local registry addresses and observed keeper versions are in the run data.
Keeper version `0.1.0` alone is not a sufficient deployment compatibility identifier.

The latest run includes the verifier's refusal reason and session ID. The first
successful run from the earlier deployment is preserved in
[initial-run/evidence.json](initial-run/evidence.json), with its receipts and
artifact provenance beside it. The fleet was redeployed between those runs, so
historical receipts refer to the earlier local chain snapshot.

## Validation

- Full SDK gate: lint, type checking, build, **284 tests across 57 files**,
  coverage thresholds, declaration/package checks, and **39 package smoke checks** passed.
- Generated reference and documentation links/snippets: passed.
- Three updated skills: passed the skill validator.
- Final fresh-install live test: both users confirmed; Mallory refused by verifier.

## Failures found during rehearsal

The first implementation assumed the first assigned keeper could coordinate signing.
The live fleet rejected it because that keeper was outside the chosen signing set.
The example now chooses the lowest on-chain operator ID among the assigned keepers.
A subsequent development run caught a JavaScript number/BigInt conversion in that
selection; the final implementation compares IDs as BigInts. Both earlier slots
and their recovery records were preserved; neither attempt is counted as acceptance.
A later run detected the fleet redeployment via a failed read at the old registry.
The public addresses were refreshed, and registry checks now run before funding.

## What this proves

Fresh identities and credentials; a new 2-of-3 tECDSA slot; creator-signed rule
provisioning; separate Alice/Bob credential presentations; recovered Ethereum
signatures; two successful on-chain receipts; and a real verifier-side denial of
Mallory. All used the current SDK package, with no application imports from the
SDK source checkout or other private repositories.

This does not prove public Fuji compatibility, production credential enrollment,
revocation, two-user joint approval, or automatic fleet installation. The example
uses public local test funds and a fresh development issuer committed in its own
slot rule. No private keys, credentials or authorization tokens are included here.

[Run the tutorial](../../shared-account.md) · [Compatibility](../../compatibility.md)
