# Documentation verification

The initial read-only checks below are retained for context. The newer
[shared-account acceptance](evidence/shared-account/README.md) proves fresh slot
creation, Alice/Bob transactions, and verifier-side denial using the packed SDK.

Checked on **2026-09-25**, using Node.js **24.15.0**, viem **2.56.8**, and SDK
**0.2.2 from the working tree** on `feature/sdk-documentation-quickstart`.
These documentation/example changes were unpublished at the time of testing.

## Local fleet: SDK contract reads

Command from the SDK checkout:

```sh
node --import tsx examples/connect-local.ts
```

Observed output:

```text
Connected to local Tasra (43112)
Block: 15343
Active operators: 10
Slot creation: direct
```

This exercised the SDK's chain client and typed NodeRegistry/KeyRegistry readers
against the running fleet. It required no CLI, private key, or credentials.

## Local fleet: Ethereum address lookup

```sh
node --import tsx examples/slot-address.ts 0xcd4e83e8b838100279e5c159deb9ab72cb52eea5791258d39adaa7d2b22447c4
```

Observed output:

```text
0xA189C4BC996b5208570e3Df6F1C3F83967Bc4478
```

The SDK read an existing slot, checked its mode/state, and derived its address from
the on-chain secp256k1 public key. No signature or transaction was requested.

## Fuji: public deployment discovery only

```sh
node --import tsx examples/connect-fuji.ts
```

Observed output:

```text
Connected to Fuji (43113)
Deployment: tasra-fuji-v1
Block: 58698713
KeyRegistry: 0x45F432aB5709e9920b5ec349D29663D7200A8C39
Slot creation: commit/reveal
```

The example fetched pointer and manifest from `tasra-releases` commit
`3b34d86432c4577eef5d8a10e14eda272f87769b`, verified the SHA-256, checked RPC chain
identity, and read the registry. **The current SDK/service version is not deployed
on Fuji.** This is evidence of those public reads only.

## Static and offline checks

- `npm run typecheck` — passed, including the shipped examples.
- ESLint on all three new examples — passed.
- `npm run build` — passed.
- Manifest and signing-path unit suites — **23 tests passed**.
- Tutorial code blocks matched their complete example files byte-for-byte after
  trimming final whitespace.

## Fresh application check

Packed the built checkout with `npm pack --ignore-scripts`, then installed that
artifact plus `viem@2.56.8` and `tsx@4.23.13` into a new temporary application.
Copied the code blocks directly from the documentation; no imports pointed back
into the SDK source checkout.

- `node --import tsx app.ts` — local chain **43112**, block **18412**,
  **10** active operators, **direct** slot creation.
- The README's offline snippet printed **`Hello Tasra`** using the installed artifact.
- `node --import tsx address.ts` with the slot ID above returned the same
  **`0xA189C4BC996b5208570e3Df6F1C3F83967Bc4478`** address from the installed artifact.
- Relative Markdown links and section anchors — **19 files checked, zero issues**.

This tests the unpublished packed checkout, not a fresh download of the registry's
`tasra-sdk@0.2.2` artifact. New example files and documentation require a subsequent
package release before they appear in registry installations.

## Scope

The initial checks on this page cover connectivity, address derivation and offline
crypto. The [subsequent live acceptance](evidence/shared-account/README.md) separately
proves slot creation, development credentials, Alice/Bob signing and verifier denial.
Decryption and revocation are not covered by that shared-account run. The fleet was
already running; installing the SDK does not start it.

[Documentation index](README.md)
