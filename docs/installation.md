# Install

> Installing, the optional viem peer, module format, and runtime support.

New to Tasra? Follow the [TypeScript quickstart](getting-started.md) first.

```sh
npm install tasra-sdk
```

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

Crypto deps are just `@noble/{curves,ciphers,hashes}`. **`viem` is an optional peer
dependency** — needed for `tasra-sdk/app` and `tasra-sdk/chain`, so a core-only consumer
neither installs nor bundles it:

```sh
npm install tasra-sdk viem   # for tasra-sdk/app or tasra-sdk/chain
```

For network configuration use `parsePinnedNetworkManifest`, `addressBookFromManifest`
and `observeNetworkManifest` from `tasra-sdk/chain`, and pin the manifest SHA-256 from
the deployment's published checksum. Planned or retired deployments cannot configure a
live client. Matching the code is not the same as an audit or a verified round trip.

## Typecheck a standalone Node tutorial

After installing the candidate tarball and copying a complete example, add:

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

Runs in the browser (Vite, Webpack, Next.js) and Node **≥22.12**. The SDK
persists nothing — no localStorage, no sessionStorage, no directory of slots —
so your product holds slot ids and credentials wherever it holds its own state.

## Module format

**This package is ESM-only** (`"type": "module"`, built with `tsc` under
`NodeNext`). There is no CommonJS build, and there deliberately won't be: the SDK
holds key material and session caches, and a dual ESM+CJS build would let two
copies of that state exist in one process.

You do not need a bundler or a transpile step. Modern Node and every current
bundler consume it directly:

```ts
import {createTasraClient} from 'tasra-sdk'   // ESM — the normal path
```

From CommonJS, both of these work on Node ≥22.12:

```js
const sdk = require('tasra-sdk')        // Node ≥22.12 can require() an ES module
const sdk = await import('tasra-sdk')   // works on any Node that supports ESM
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
- **Pre-1.0 versioning**: a minor bump may change the API, a patch never does.

The current SDK/service version is not deployed on Fuji. Use a compatible local
fleet to test current live operations. The [Fuji guide](fuji.md) covers public
deployment discovery and contract reads only.

## Test an unpublished SDK

From your `tasra-sdk` checkout, install dependencies and create the package:

```sh
npm ci
npm pack
```

`npm ci` runs the package's build through `prepare`. `npm pack` prints the generated
tarball filename. In your application directory, install that file instead of the
registry package (replace the path with your checkout's location):

```sh
npm install /path/to/tasra-sdk/tasra-sdk-0.3.0-next.0.tgz viem@2
npm install --save-dev tsx
```

This includes the checkout's current examples and docs. The package version alone
does not distinguish unpublished edits from the published version; record the
checkout commit and whether it has uncommitted changes with your test results.

---

[← Back to the README](../README.md) · [Documentation index](README.md)
