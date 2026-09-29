# Connect to TASRA

**Goal:** connect a TypeScript app and read network information. You need Node.js
22.12+ and npm. Use a macOS, Linux or WSL terminal for the commands below.
This lesson needs no wallet or precreated slot.

## 1. Create the app

```sh
mkdir my-tasra-app
cd my-tasra-app
npm init -y
npm pkg set type=module
npm install tasra-sdk@latest
npm install --save-dev typescript tsx @types/node
cp node_modules/tasra-sdk/examples/network.ts .
cp node_modules/tasra-sdk/examples/connect-network.ts app.ts
```

Save **tsconfig.json** in this folder:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["*.ts"]
}
```

## 2. Download the network configuration

```sh
npx tsx network.ts
```

The supplied helper downloads the testnet manifest from
[tasra-releases](https://github.com/t3-foundry/tasra-releases), verifies its checksum
and saves `network.json` and `network-pin.json`. A manifest tells the SDK which
network and services to use. Keep these files for the following lessons.

## 3. Connect

Open **app.ts**:

<!-- connect-network-example -->
```ts
import {loadNetwork} from './network.js'
import {TasraClient} from 'tasra-sdk/app'

// Verify the manifest downloaded from tasra-releases; no wallet is needed.
const network = loadNetwork()
const tasra = new TasraClient({manifest: network.deployment, verifierAgentUrl: network.verifierAgentUrl})

// Check the actual chain and configured registries before using the network.
const health = await tasra.check()
if (!health.ready) throw new Error('Configured registries are unavailable')
console.log(`Connected to Tasra (${health.chainId})`)
console.log(`Block: ${await tasra.chain.client.getBlockNumber()}`)
console.log(`Active registered nodes: ${await tasra.chain.readers.nodeRegistry.activeCount()}`)
console.log('Registry contracts: available')
```

```sh
npx tsc --noEmit
npx tsx app.ts
```

**Success:** a chain ID, current block and registered-node count. The count includes
all registered node roles, not just keepers. These reads spend no gas.

<details>
<summary>What this check establishes</summary>

`check()` confirms the RPC chain and registry contracts. Later signing and
encryption steps also need compatible, available network services.

The helper uses the `lowest-operator-id` coordinator convention; confirm that it
matches your selected deployment before protected operations. Keep the downloaded
manifest unchanged while recovering a pending operation. For other manifests,
see [network configuration](fuji.md).

If the connection fails, check your network access and manifest. See
[installation help](installation.md) or [errors and recovery](errors.md).

</details>

**Next: [Create your first slot →](create-slot.md)**
