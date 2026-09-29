# Read the public Fuji deployment

This example downloads a release manifest and reads public contracts. It does
not establish support for signing, authorization or decryption. Check those service
requirements separately before using protected operations.

Build a small app that connects to Tasra's Fuji deployment and reads how new slots
are created. You will see the chain ID, deployment, current block, and registry address.

You need an internet connection and **Node.js 22.12 or newer**, which includes npm.
Install Node.js from [nodejs.org](https://nodejs.org/en/download), then check
`node --version` and `npm --version` in your IDE terminal.
This first app only reads public data: it needs no wallet, funds, or credentials.

## 1. Create the app

Run these commands in your terminal:

```sh
mkdir my-tasra-app
cd my-tasra-app
npm init -y
npm pkg set type=module
npm install tasra-sdk@latest
npm install --save-dev tsx
```

Keep `package-lock.json` with your app so teammates install the same versions.

## 2. Add the code

Create **`app.ts`** in `my-tasra-app` and paste the entire file below.
All imports come from the installed SDK; there are no helper scripts to copy.

<!-- connect-fuji-example -->
```ts
import {
  NETWORKS, parsePinnedNetworkManifest, addressBookFromManifest,
  createTasraChainClient,
} from 'tasra-sdk/chain'

// Keep the pointer and manifest at the same reviewed tasra-releases commit.
const revision = '3b34d86432c4577eef5d8a10e14eda272f87769b'
const base = `https://raw.githubusercontent.com/t3-foundry/tasra-releases/${revision}/networks/testnet/`
async function download(path: string): Promise<string> {
  const response = await fetch(`${base}${path}`, {signal: AbortSignal.timeout(15_000)})
  if (!response.ok) throw new Error(`Download ${path}: HTTP ${response.status}`)
  return response.text()
}

const pointer = JSON.parse(await download('current.json')) as {
  schemaVersion: number; network: string; chainId: number; status: string
  manifest: string; sha256: string
}
if (pointer.schemaVersion !== 1 || pointer.network !== 'testnet' ||
    pointer.chainId !== 43113 || pointer.status !== 'active' ||
    typeof pointer.manifest !== 'string' || !/^deployments\/[a-z0-9.-]+\.json$/.test(pointer.manifest)) {
  throw new Error('Expected an active Fuji deployment pointer')
}
const manifest = parsePinnedNetworkManifest(await download(pointer.manifest), pointer.sha256)
if (manifest.network !== 'testnet' || manifest.chainId !== 43113) {
  throw new Error('Expected a Fuji manifest')
}
const addresses = addressBookFromManifest(manifest)
const chain = createTasraChainClient({
  rpcUrl: NETWORKS.testnet.rpcUrl, chainId: manifest.chainId, addresses,
})
if (await chain.client.getChainId() !== manifest.chainId) {
  throw new Error('RPC chain does not match the manifest')
}
const block = await chain.client.getBlockNumber()
const commitReveal = await chain.readers.keyRegistry.requiresCommitReveal()
console.log(`Connected to Fuji (${manifest.chainId})`)
console.log(`Deployment: ${manifest.deploymentId}`)
console.log(`Block: ${block}`)
console.log(`KeyRegistry: ${addresses.KeyRegistry}`)
console.log(`Slot creation: ${commitReveal ? 'commit/reveal' : 'direct'}`)
```

The deployment configuration comes from
[tasra-releases](https://github.com/t3-foundry/tasra-releases).
Its `networks/testnet/current.json` points to `deployments/tasra-fuji-v1.json` and
provides the SHA-256 checked by the SDK. Both downloads use the same reviewed
commit, so a later deployment update cannot silently change your app's configuration.
When updating the deployment, review that repository and change `revision` deliberately.

## 3. Run it

```sh
npx tsx app.ts
```

Expected output (the block number changes):

```text
Connected to Fuji (43113)
Deployment: tasra-fuji-v1
Block: 58698713
KeyRegistry: 0x45F432aB5709e9920b5ec349D29663D7200A8C39
Slot creation: commit/reveal
```

You have loaded a checksum-verified manifest and read the live KeyRegistry contract
using `tasra-sdk`. This does not create a slot, authorize a user, or test signing.
For a check of every deployed contract's code, see [deployment verification](chain.md#verify-a-deployment).

Source: [examples/connect-fuji.ts](../examples/connect-fuji.ts), included in the
installed SDK package. The inline file can be copied directly.

## If it fails

| What you see | What to do |
|---|---|
| `node` or `npm` is not found | Install Node.js and reopen the IDE terminal. |
| Cannot find `tasra-sdk` | Run the install commands inside `my-tasra-app`. |
| Download error, timeout, or `fetch failed` | Check access to GitHub and the Fuji RPC; retry after connectivity is restored. |
| Manifest checksum mismatch | Re-fetch both files at the same revision. Preserve the original manifest bytes; do not bypass the check. |
| RPC chain mismatch | Use `NETWORKS.testnet.rpcUrl` or your own Fuji RPC (chain 43113). |
| Contract read fails | Check the RPC and whether the pinned deployment is still supported in `tasra-releases`. |

## Build the next part

- **Protect app data:** [encrypt and decrypt with credentials](encryption.md).
- **Build a shared Ethereum account:** [get an address and sign transactions](signing.md).
- **Read slots or discover keepers:** [chain APIs](chain.md).

[Documentation index](README.md)
