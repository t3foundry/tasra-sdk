# Your first TypeScript app

Connect to a running local Tasra fleet and read its on-chain registry. You will see
the chain ID, current block, active operator count, and slot-creation mode.

## Before you start

Install **Node.js 22.12+** from [nodejs.org](https://nodejs.org/en/download).
It includes npm. Check `node --version` and `npm --version` in your IDE terminal.

You also need a **running local development fleet**. The configuration below is the
local fleet used to verify this guide. If you use another fleet or redeploy it,
replace the RPC URL and registry addresses with that deployment's values.
The SDK connects to a fleet; installing it does not start one.

No wallet, credentials, CLI, or private keys are needed for these reads.
Without a local fleet, you can still [read public Fuji contracts](fuji.md) or try
[local encryption](../README.md#try-local-encryption-without-a-network).
The current SDK/service version is not deployed on Fuji; use a compatible local
fleet for current signing, authorization, and decryption examples.

## 1. Create the app

```sh
mkdir my-tasra-app
cd my-tasra-app
npm init -y
npm pkg set type=module
npm install tasra-sdk@0.2.2 viem@2
npm install --save-dev tsx
```

Keep `package-lock.json` with your application. To test an unpublished SDK change,
[install a locally packed build](installation.md#test-an-unpublished-sdk).

## 2. Write the app

Create **`app.ts`** and paste this complete file. It uses only installed packages;
there are no helper scripts or private repository imports.

<!-- connect-local-example -->
```ts
import {addressBookFromObject, createTasraChainClient} from 'tasra-sdk/chain'

// Public configuration of the local development fleet; update after a redeploy.
const chain = createTasraChainClient({
  rpcUrl: 'http://127.0.0.1:9650/ext/bc/C/rpc',
  chainId: 43112,
  addresses: addressBookFromObject({
    NodeRegistry: '0xEA7A0602b6DB6Aa767C5649b4d5083c426Cb8083',
    KeyRegistry: '0x94c75679D75bfdc310669c0De4dE4398E922232b',
  }),
})

if (await chain.client.getChainId() !== 43112) throw new Error('Expected local chain 43112')
const block = await chain.client.getBlockNumber()
const operators = await chain.readers.nodeRegistry.activeCount()
const commitReveal = await chain.readers.keyRegistry.requiresCommitReveal()
console.log('Connected to local Tasra (43112)')
console.log(`Block: ${block}`)
console.log(`Active operators: ${operators}`)
console.log(`Slot creation: ${commitReveal ? 'commit/reveal' : 'direct'}`)
```

`createTasraChainClient` connects the SDK to the RPC and the two registries.
`readers` exposes typed contract reads; `client` exposes the underlying viem client.
These are public reads and spend no gas.

## 3. Run it

```sh
npx tsx app.ts
```

Expected output on the documented local fleet:

```text
Connected to local Tasra (43112)
Block: 1996
Active operators: 10
Slot creation: direct
```

The block number increases over time. The operator count and creation mode depend
on the fleet. This proves connectivity and contract reads; it does not create a
slot or test authorization.

Source: [examples/connect-local.ts](../examples/connect-local.ts). This new example is
in the current checkout and its packed artifact; do not assume it is already in the
registry release. The inline file above can be copied directly.

## If it fails

| Symptom | Fix |
|---|---|
| `node` or `npm` is not found | Install Node.js and reopen your terminal. |
| Cannot find `tasra-sdk` or `viem` | Run the installation commands in `my-tasra-app`. |
| Connection refused / HTTP request failed | Start or restore access to the fleet; check the RPC URL. |
| `Expected local chain 43112` | The RPC points to a different chain. Use the local fleet's endpoint. |
| Contract call returns no data | Check registry addresses against the current local deployment. |

## Choose your next operation

- [Encrypt and decrypt with credentials](encryption.md).
- [Get an Ethereum address and sign transactions](signing.md).
- [Create a slot](prerequisites.md#operator-setup).
- [Load Fuji configuration from tasra-releases](fuji.md).

[Documentation index](README.md)
