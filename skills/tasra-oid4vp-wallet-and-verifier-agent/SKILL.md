---
name: tasra-oid4vp-wallet-and-verifier-agent
description: Connect an application authorizer to a credential wallet or issue local development credentials. Use for registered verifier agents, OID4VP presentations, SD-JWT holder binding, OID4VCI receiving or an explicitly requested OAuth/DPoP integration.
metadata:
  package: tasra-sdk
  sources:
    - docs/application-api.md
    - dist/app/authorization.d.ts
    - dist/oid4vp/index.d.ts
    - examples/encrypted-notes.ts
---

# Connect the application to a credential wallet

For new candidate applications, return an `OperationAuthorizer` and let typed slots
supply the exact operation. Select and approve the verifier-agent provider before
sending it a presentation. An arbitrary URL or a service listed in a manifest is
not, on its own, proof of registry approval.

```ts
import {registeredWalletAuthorization} from 'tasra-sdk/app'

export function connectWallet(config: Parameters<typeof registeredWalletAuthorization>[0]) {
  return registeredWalletAuthorization(config)
}
```

The configuration contains an independently approved registered agent `client`,
a `signer` for the operation request, and `present(session, signal)`. That callback
displays the selected request QR/deep link, or runs the application's credential
wallet. Preserve the session's authenticated provider and request binding; do not
redirect a presentation to a fallback provider after timeout or refusal.
The adapter waits for a result and requires verifier membership proofs.

## Local development without an issuer account

Read `examples/encrypted-notes.ts` or `examples/shared-account.ts`. They generate
separate issuer/holder keys with `ed25519HolderKey`, issue `issueSdJwtVc` credentials
bound with `holderCnf`, and supply an authorizer using the explicitly configured
local verifier-agent endpoint. This local endpoint example does not establish a
production registered-provider approval.

Forward the actual operation to `openVerifierAgentSession`, present with
`presentToRequestUri`, and obtain `{token, verifierProofs}` with
`awaitVerifierAgentResult`. Do not omit membership proofs. Tokens are compound
objects, not bearer JWT strings. A credential must be presented by its bound holder;
generating a different key at presentation time will fail.

| Action | Exact operation input |
|---|---|
| `sign` | Message bytes; for ECDSA this is the 32-byte digest requested by the adapter |
| `ibe-extract` | Identity string; do not pass a signing message |
| `dual-approve` | SHA-256 of the SDK's canonical approval payload for slot/message/request ID |
| Advanced `decrypt` | `decryptPayloadDigest(u, aeadCt)` |

The creator/delegate's operation-signing key, credential issuer key, holder key
and threshold slot key have distinct roles. Keep them separate. The relying app
receives authorization; a real user's holder secrets remain in the wallet context.
Synthetic tutorial credentials are not a production identity-enrollment scheme.

## Wallet and issuer implementation details

For receiving credentials, SD-JWT disclosure selection, DID resolution, TLS trust,
issuer APIs, or explicitly requested OAuth/DPoP flows, read
[wallet, issuer and verifier-agent details](references/advanced.md) and the installed
declarations. Those specialized flows remain supported; OAuth is not a legacy
`SessionAuth` mode. `tasra-hovi-issuer` is optional and only relevant when Hovi is chosen.

A local filter rejecting a credential is good wallet behavior, but server refusal
acceptance must deliberately reach the verifier as shown by the complete examples.
