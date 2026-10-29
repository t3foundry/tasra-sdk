# SDK reference

Look up the TypeScript classes, functions, options and return types you use in your code.
Start with the [learning path](../README.md) if you are building your first TASRA app.

## Choose a module

Most applications start with **@t3foundry/tasra-sdk/app**. Open a module, then choose Classes,
Functions, Types or Constants from its page navigation. Each group has its own lookup list.

| Module | Import | What you will find |
|---|---|---|
| [Application client](app.md) | `@t3foundry/tasra-sdk/app` | Connect, create slots, manage identities and run application workflows. |
| [Local storage (Node.js)](app-node.md) | `@t3foundry/tasra-sdk/app/node` | Persist application state and coordinate local operations. |
| [Core utilities](main.md) | `@t3foundry/tasra-sdk` | Signing, encryption, credentials and shared helpers. |
| [Chain access](chain.md) | `@t3foundry/tasra-sdk/chain` | Read contracts, submit transactions, discover services and fund slots. |
| [Committee operations](committee.md) | `@t3foundry/tasra-sdk/committee` | Threshold requests, approvals and operation receipts. |
| [Credentials and OID4VP](oid4vp.md) | `@t3foundry/tasra-sdk/oid4vp` | Credential presentations, wallet flows and issuer verification. |
| [Verifier integration](verifier-agent.md) | `@t3foundry/tasra-sdk/verifier-agent` | Connect wallet and credential flows to a verifier agent. |
| [Chain tools (Node.js)](chain-node.md) | `@t3foundry/tasra-sdk/chain/node` | Load chain configuration from Node.js files. |

## Read a declaration

Functions show their import, parameters and return value. Classes show constructors,
properties and methods. Types describe the data you pass in or receive. Constants
and contract ABIs link to their definitions. Follow **Source** for the implementation.

The declarations and descriptions are generated from the SDK source. They describe
programming interfaces; use the [application guides](../README.md) for complete
runnable examples and [Errors](../errors.md) for recovery guidance.
