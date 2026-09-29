# Install

> Installing, bundled adapters, module format, and runtime support.

New to Tasra? Follow the [TypeScript quickstart](getting-started.md) first.

Install the latest SDK from npm:

```sh
npm install tasra-sdk@latest
```

Keep `package-lock.json` with your app to make subsequent installs reproducible.

The package ships JavaScript, type declarations, runnable examples and all eleven agent
skills; library implementation TypeScript and source maps are excluded (example TypeScript is included), so the shipped
JavaScript stays inspectable.

Releases published by the GitHub workflow carry [npm provenance](https://docs.npmjs.com/generating-provenance-statements)
— a signed attestation linking the tarball to the commit and workflow run that built
it, which npm shows on the package page. Manual bootstrap releases can omit provenance;
check the release notes and package page. Verify registry signatures and available
attestations with:

```sh
npm audit signatures
```

The SDK installs its crypto dependencies and viem wallet adapter automatically.
Apps using `tasra-sdk/app` or `tasra-sdk/chain` need only the SDK as a runtime dependency;
you do not need a separate crypto or Ethereum library to use the application API.
See the [manifest-first application guide](application-api.md).

For new applications, download a manifest from
[tasra-releases](https://github.com/t3-foundry/tasra-releases) and load it with
`TasraClient.fromManifest(url, {sha256, coordinator})`. Remote manifest URLs require HTTPS unless an independently trusted SHA-256 pin is provided; loopback HTTP is allowed for development. Obtain the SHA-256 from a
trusted release pointer. Pass the deployment's coordinator convention explicitly;
the release schema does not specify it. Planned and retired manifests cannot
configure a live client. `check()` verifies the chain and registry availability,
not support for every service operation.

Advanced chain-only integrations can use `parsePinnedNetworkManifest`,
`addressBookFromManifest` and `observeNetworkManifest` from `tasra-sdk/chain`.

## Typecheck a standalone Node tutorial

After installing the SDK and copying a complete example, add:

```sh
npm pkg set type=module
npm install --save-dev typescript tsx @types/node
```

Save this as `tsconfig.json` beside the application's TypeScript files:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "resolveJsonModule": true,
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["*.ts"]
}
```

Run `npx tsc --noEmit`, then the lesson's `tsx` command. Explicit Node types make
imports such as `node:fs` available to the type checker. This configuration is for
the Node tutorial apps; browser and extension projects retain their own framework configuration.

**Using a coding agent?** The package ships [agent skills](../skills/README.md) — one
folder per task (getting started, creating a slot, credentials, DCQL rules, errors,
signing, IBE, chain reads, the committee path, OID4VP, and getting real credentials
from a Hovi issuer). Installing the package does not register them; see the
[installation instructions](../skills/README.md) and refresh copied skills after every
SDK upgrade.

Runs in the browser (Vite, Webpack, Next.js) and Node **≥22.12**. The SDK writes no state unless you supply a store. Node applications can use
`createFileStore` from `tasra-sdk/app/node` for private, durable recovery state.
Browser and database applications provide their own `ApplicationStore` adapter.
Your product chooses where to keep credentials and exported identity keys.

## Module format

**This package is ESM-only** (`"type": "module"`, built with `tsc` under
`NodeNext`). There is no CommonJS build, and there deliberately won't be: the SDK
holds key material and session caches, and a dual ESM+CJS build would let two
copies of that state exist in one process.

You do not need a bundler or a transpile step. Modern Node and every current
bundler consume it directly:

```ts
import {TasraClient} from 'tasra-sdk/app' // ESM — application API
```

From CommonJS, both of these work on Node ≥22.12:

```js
const sdk = require('tasra-sdk/app') // Node ≥22.12 can require() an ES module
// Alternatively, load it asynchronously:
import('tasra-sdk/app').then(sdk => { /* use sdk.TasraClient here */ })
```

## Compatibility

- **Node ≥ 22.12**, or any evergreen browser. WebCrypto (`crypto.subtle`,
  `getRandomValues`) must be present — it is everywhere the above holds, but not
  on an insecure-context browser page (`http://` off loopback).
- **ESM only** (above). `require()` works on Node ≥ 22.12 and nowhere older.
- **Wire compatibility with the network is fixed per SDK version, not negotiated at runtime.**
  Every node, verifier and verifier-agent endpoint the SDK calls is under `/v1/`. The SDK
  does not check a node's version or feature set; a mismatch surfaces as an
  HTTP 404/403 at call time (`TasraHttpError`). Some routes are
  per-deployment feature gates — threshold ECDSA (`/v1/sign/eoa-digest`) and
  the admin scope among them — and `nodeApi.info()` in `tasra-sdk/chain`
  reports which are on.

Confirm operation support on the selected network before using protected routes.
A manifest or successful public read does not prove signing, authorization or
decryption compatibility.


---

[Back to the README](../README.md) · [Documentation index](README.md)
