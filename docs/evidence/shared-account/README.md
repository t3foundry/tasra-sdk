# Shared-account live evidence

On 2026-09-25, `npm run test:docs:live` packed the current SDK checkout, installed it
in a fresh temporary TypeScript app, and executed the shipped application against
the existing local fleet. No CLI was used.

| Result | Observed value |
|---|---|
| Chain | 43112 |
| New slot | `0xe2e8f4b74f7b5d4f8d3f7d938fa6db766b5422545592c35d52debe375934ce98` |
| Ethereum account | `0x15bC5CD66F90Ba9e410E76396452d9f3003133F3` |
| Alice | Confirmed, nonce 0, block 20333 |
| Bob | Confirmed, nonce 1, block 20336 |
| Mallory | Refused by verifier; account nonce stayed at 2 |

Alice transaction: `0x2c14dc6bb14db378eda1e7c96ccd9c349f7e9775645883051c6b7cecab54107a`.

Bob transaction: `0x47bdc1cd15b3c8330aca829c2dd67a0550353c276f29afdfaa0033b96eb73bd0`.

[Public run data](evidence.json) · [Alice receipt](alice-receipt.json) ·
[Bob receipt](bob-receipt.json) · [Artifact/source versions](provenance.json)

The test pins the SDK artifact and example by SHA-256. The source commit is recorded
with `sourceDirty: true` because these changes had not been committed or published.
The exact local registry addresses and observed keeper versions are in the run data.
Keeper version `0.1.0` alone is not a sufficient deployment compatibility identifier.

## Failures found during rehearsal

The first implementation assumed the first assigned keeper could coordinate signing.
The live fleet rejected it because that keeper was outside the chosen signing set.
The example now chooses the lowest on-chain operator ID among the assigned keepers.
A subsequent development run caught a JavaScript number/BigInt conversion in that
selection; the final implementation compares IDs as BigInts. Both earlier slots
and their recovery records were preserved; neither attempt is counted as acceptance.

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
