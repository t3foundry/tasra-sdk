# Sign Ethereum transactions (ethers / viem / Hardhat)

> Threshold ECDSA for EVM accounts, wired into ethers, viem and Hardhat.

## Before you start

Load the network manifest from [tasra-releases](https://github.com/t3-foundry/tasra-releases).
You need a **secp256k1 tECDSA slot** (mode 2), completed distributed key generation, and the current registry
address. BLS, FROST, and P-256 slots cannot serve as Ethereum accounts.

Address lookup is public and requires no credential or funded wallet. Signing also
requires authorization accepted by the keeper, metering funds, and an enabled ECDSA
route. Broadcasting a transaction requires native gas funds on the slot's address.

## Get the Ethereum address

After the [quickstart installation](getting-started.md#1-create-the-app), save this as
**`address.ts`**. It reads the public key from the registry and derives the address;
no signature is needed. Use the manifest for the network where the slot was created.

<!-- slot-address-example -->
```ts
import {loadNetwork} from './network.js'
import {TasraClient} from 'tasra-sdk/app'

// Read the checksum-verified manifest downloaded from tasra-releases.
const network = loadNetwork()
const tasra = new TasraClient({manifest: network.deployment, verifierAgentUrl: network.verifierAgentUrl})
const slotId = process.argv[2]
if (!slotId || !/^0x[0-9a-fA-F]{64}$/.test(slotId)) {
  throw new Error('Usage: npx tsx address.ts <0x-prefixed slot ID>')
}
if (!(await tasra.check()).ready) throw new Error('Configured registries are unavailable')
const slot = await tasra.slots.ecdsa(slotId as `0x${string}`)
console.log(await slot.getAddress())
```

Run `npx tsx address.ts YOUR_SLOT_ID`, replacing `YOUR_SLOT_ID` with your slot's
0x-prefixed ID. Success prints one checksummed `0x…` Ethereum address.

The typed ECDSA handle checks existence, readiness and slot mode. `getAddress()`
derives the Ethereum address without requiring credentials. Create your own slot
with the [shared-account tutorial](shared-account.md) before using this lookup.

## Sign with credential-based authorization

For a complete runnable app, follow [Alice and Bob's shared account](shared-account.md).
It includes slot creation, issuer/holder keys, rule provisioning and actual receipts.
Install with `npm install tasra-sdk@latest`. The application uses
`tasra.credentials.authorize`, `tasra.wallets.fromSlot` and a named
`wallet.transfer`; the SDK handles signature verification and durable submission.
[Compatibility](compatibility.md).

## Advanced committee signing adapter

The lower-level operation below is for integrations that need explicit control
over the digest and verifier session.

After presenting a credential and obtaining `grant` from `awaitVerifierAgentResult`:

```ts
import {committeeSignEoaDigest} from 'tasra-sdk/committee'

const signature = await committeeSignEoaDigest({
  nodeUrl: coordinatorUrl,
  committeeToken: grant.token,
  verifierProofs: grant.verifierProofs,
  digest, // Uint8Array: exactly the 32-byte transaction signing hash
})
```

| Input | Meaning |
|---|---|
| `nodeUrl` | A keeper in the slot's active ECDSA signing subset; the example derives its order from on-chain operator IDs. |
| `committeeToken` | Fresh request-bound authorization for this slot and digest. Open the verifier session with `action: 'sign'` and `message: digest`. |
| `digest` | 32 bytes to sign. The binding uses SHA-256 of these bytes; ECDSA signs the original digest. |
| `verifierProofs` | Snapshot membership proofs returned with the authorization, required by the configured network. |
| `requestId`, `signal` | Optional request correlation and cancellation. |
| `userSignature`, `targetKeykeeper` | Optional additional owner signature and operator pin for fleets requiring them. |

Returns a promise of `{groupPublicKey, r, s, yParity}`. The key is compressed
secp256k1; `r` and `s` are 32-byte arrays; `yParity` is 0 or 1. Invalid digest lengths,
non-Ethereum replies, and malformed responses throw. HTTP failures use SDK error
classes; 401/403 is an authorization denial. The helper does not retry or fall back
to JWT authorization. Verify signature recovery and transaction receipts as in the tutorial.

## JWT-compatible adapters

The adapters below use the **JWT-authorized `/v1/sign/eoa-digest` route**. Confirm that
your fleet supports it. A request-bound verifier-agent compound authorization is not
a replacement JWT for these adapters. Running their offline self-tests does not
establish live compatibility.

For an EVM project, a **threshold-ECDSA (tECDSA) slot** *is* an Ethereum account
whose key is split across the fleet — every signature needs k-of-n nodes and no
machine ever holds the whole key. `signEoaDigest` signs a 32-byte prehash and
returns Ethereum `{r, s, yParity}`; `addressFromEoaPubkey` derives the EOA's
EIP-55 address from its secp256k1 group key (using only `@noble`):

```ts
import {signEoaDigest, ethSignatureV, addressFromEoaPubkey} from 'tasra-sdk'

const {groupPublicKey, r, s, yParity} = await signEoaDigest({nodeUrl, jwt, slotId, digest})
const from = addressFromEoaPubkey(groupPublicKey) // 0x… checksummed address
const v = ethSignatureV(yParity, chainId) // EIP-155 v
```

Wrap that in an **ethers v6 `Signer`** and it drops into ethers or Hardhat like any
key-backed account. `examples/ethers-signer.ts` (shipped with the package) is a complete, copy-paste
`TasraSigner extends AbstractSigner` (getAddress + signTransaction / signMessage /
signTypedData), with the JWT supplied by your `getJwt` callback:

```ts
import {redeemRenewalToken} from 'tasra-sdk'
import {TasraSigner} from './tasra-signer' // copied from the package's examples/ethers-signer.ts

const signer = new TasraSigner({
  nodes, slotId, // a tECDSA signing slot
  getJwt: async () => (await redeemRenewalToken(verifier, renewalToken)).token,
}).connect(provider)

await signer.getAddress()
await signer.sendTransaction({to, value}) // signed by the fleet, broadcast via the provider

// Hardhat: const c = await ethers.getContractAt(abi, addr, signer.connect(ethers.provider))
//          await c.transfer(to, amount)
```

Prefer **viem** (and thus wagmi, or an ERC-4337 stack)? `examples/viem-account.ts`
(shipped with the package) is the same adapter as a viem `LocalAccount` via `toAccount`. viem is
included by the SDK. If your application imports viem directly, declare it alongside:

```ts
import {createWalletClient, http} from 'viem'
import {redeemRenewalToken} from 'tasra-sdk'
import {createTasraAccount} from './tasra-account' // copied from the package's examples/viem-account.ts

const account = await createTasraAccount({
  nodes, slotId, // a tECDSA signing slot
  getJwt: async () => (await redeemRenewalToken(verifier, renewalToken)).token,
})
const wallet = createWalletClient({account, chain, transport: http(rpcUrl)})
await wallet.sendTransaction({to, value}) // signed by the fleet
```

Both are just adapters — the SDK's shipped surface stays signer-lib-agnostic (the
address helper uses only `@noble`; `ethers` is a dev-only dependency for that example,
while viem is included by the SDK). **Note:** the node's `/v1/sign/eoa-digest` path
may be feature-gated in your deployment; each example's offline self-test
(`npm run example:ethers` / `npm run example:viem`) proves the signature assembly
end-to-end with a local stand-in key.

## Allow Alice and Bob to use one account

Both users target the **same slot ID**, so both sign from the same Ethereum address.
Give each user their own holder key and an issuer credential accepted by the slot's
rule. Obtain fresh authorization for the acting user before each operation; do not
share a renewal token between users.

A rule allowing Alice **or** Bob permits either user to sign independently. Requiring
both users to approve the same transaction is a different authorization workflow;
keeper `k-of-n` alone does not implement two-user approval.

Verify each user separately: sign, broadcast, check the receipt and recovered sender,
then attempt the same operation with an unauthorized holder and record the denial.
[Credential presentation APIs](api.md#tasra-sdkoid4vp--credential-wallets-against-the-verifier-agent)
provide the wallet flow. The [shared-account app](shared-account.md) includes assertions
for both users' transactions and Mallory's server-side refusal.

---

[Back to the README](../README.md) · [Documentation index](README.md)
