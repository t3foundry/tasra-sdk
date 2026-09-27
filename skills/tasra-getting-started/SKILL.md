---
name: tasra-getting-started
description: Build a TypeScript application with the installed Tasra SDK. Use for initial setup, choosing a slot API, locating deployment manifests, or selecting a complete signing or encryption tutorial.
metadata:
  package: tasra-sdk
  sources:
    - docs/application-api.md
    - docs/compatibility.md
    - docs/shared-account.md
    - dist/app/index.d.ts
---

# Start a Tasra application

Use `tasra-sdk/app` for new credential-controlled applications. Keep existing
advanced clients when their capabilities are required; there is no client-count
limit or forced migration. This API is in the unpublished `0.3.0-next.0` candidate.

## Install and establish the environment

1. Inspect `node_modules/tasra-sdk/package.json` and probe the required exports.
   The candidate must be installed from a packed checkout; plain npm installation
   of an older release is not equivalent. Use Node 22.12+, ESM and `viem`.
2. Read `node_modules/tasra-sdk/docs/compatibility.md`. Current protected operations
   are tested on the local fleet, not Fuji. Missing fleet services are a blocked
   live check; do not manufacture an endpoint or downgrade authorization.
3. Public deployment records belong to https://github.com/t3-foundry/tasra-releases.
   `networks/testnet/current.json` points to `deployments/tasra-fuji-v1.json`, relative
   to `networks/testnet/`. Use both at one reviewed commit and verify the checksum
   with the procedure in `docs/fuji.md`. Public Fuji reads do not prove compatibility
   with this candidate's signing/credential services.
4. For the running local fleet, use the public configuration and CA in the installed
   example. Verify them before writes. Redeployment changes addresses and CA trust.
   Keep TLS verification enabled. No operator secret or sibling demo script is needed.

Paths beginning `docs/`, `examples/` or `dist/` in these skills are relative to the
**installed SDK package**, even after the skill folder is copied into `.agents/skills`.
Relative Markdown links to `references/` stay inside the copied skill folder.

## Write the application

```ts
import {createTasra, type TasraDeployment} from 'tasra-sdk/app'
import type {Hex} from 'viem'

export async function readAccount(deployment: TasraDeployment, slotId: Hex) {
  const tasra = createTasra({deployment})
  const health = await tasra.check()
  if (!health.ready) throw new Error('Configured registries are unavailable')
  const account = await tasra.slots.ecdsa(slotId)
  return account.getAddress()
}
```

`check()` probes chain ID and registry code presence, not issuer or keeper readiness.
Slot handles check mode/readiness. Address lookup and public-key encryption need no
credentials. Signing and decryption take an `OperationAuthorizer` per operation.

| Developer task | Skill | Complete installed source / lesson |
|---|---|---|
| Alice OR Bob signs an Ethereum transaction | `tasra-sign-and-decrypt` | `examples/shared-account.ts`, `docs/shared-account.md` |
| Encrypt notes for one credential holder | `tasra-ibe-identity-scoped` | `examples/encrypted-notes.ts`, `docs/encrypted-notes.md` |
| Alice AND Bob sign the same document separately | `tasra-sign-and-decrypt` | `examples/document-signing/`, `docs/document-signing.md` |
| Two approvals produce one FROST signature | `tasra-committee-path` | `examples/credential-approvals.ts`, `docs/native-approvals.md` |
| Create, provision or recover a slot | `tasra-create-slot` | `docs/application-api.md` |
| Add a wallet or issue development credentials | `tasra-oid4vp-wallet-and-verifier-agent` | `docs/application-api.md` |
| Discover registries, keepers or events | `tasra-chain` | `docs/chain.md` |
| Handle refusal, cancellation or uncertain writes | `tasra-handle-errors` | `docs/application-api.md` |

Read the chosen complete source before modifying it. Examples run as visible
TypeScript applications with the installed SDK; do not replace them with a hidden
helper script. The document lesson includes a persistent web app with separate signer wallets;
`examples/document-signing.ts` is its smaller terminal companion.

For a standalone Node app, `docs/installation.md` supplies the complete strict
NodeNext `tsconfig.json`, including `types: ["node"]`, and the typecheck command.

## Prove the result

Run the app in a fresh ESM project using only the installed package and its public
configuration. The lesson gives exact copy/install/run commands. Record package
integrity, network identity, slot/transaction IDs and verified results; keep keys,
credentials, grants and private creation journals out of public evidence.

A refusal test must reach the verifier; local credential filtering is not evidence
of server refusal. Re-running after a failed submission requires reconciliation,
not automatic creation of another slot. Native multi-approver IBE, full task-context
enforcement and independent per-share certificates remain upstream work.
