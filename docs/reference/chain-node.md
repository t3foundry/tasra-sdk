# tasra-sdk/chain/node

Generated from public TypeScript exports. Run `npm run docs:reference` to update.

[Reference index](README.md) · [Task guides](../README.md) · [Errors](../errors.md)

## createNodeAgentTransport

Session secrets use this same guarded connection and can only travel to a session GET.

[Source](../../src/chain/node.ts#L54)

```ts
import {createNodeAgentTransport} from 'tasra-sdk/chain/node'

declare function createNodeAgentTransport(policy?: ServiceTransportPolicy): AgentTransport
```

| Parameter | Type | Description |
|---|---|---|
| `policy` | `ServiceTransportPolicy` |  |

Returns: `AgentTransport`.

## createNodeAgentWalletFetch

Wallet protocol requests restricted to the selected session and approved DID, with socket checks.

[Source](../../src/chain/node.ts#L61)

```ts
import {createNodeAgentWalletFetch} from 'tasra-sdk/chain/node'

declare function createNodeAgentWalletFetch(session: Pick<RegisteredAgentSession, "profile" | "requestUri" | "sessionId">, policy?: ServiceTransportPolicy): typeof fetch
```

| Parameter | Type | Description |
|---|---|---|
| `session` | `Pick<RegisteredAgentSession, "sessionId" &#124; "profile" &#124; "requestUri">` |  |
| `policy` | `ServiceTransportPolicy` |  |

Returns: `{ (input: RequestInfo | URL, init?: RequestInit): Promise<Response>; (input: string | URL | Request, init?: RequestInit): Promise<Response>; }`.

## createNodeRelayTransport

Discovery and relay traffic use the same socket-bound destination and TLS policy.

[Source](../../src/chain/node.ts#L47)

```ts
import {createNodeRelayTransport} from 'tasra-sdk/chain/node'

declare function createNodeRelayTransport(policy?: ServiceTransportPolicy): RelayTransport
```

| Parameter | Type | Description |
|---|---|---|
| `policy` | `ServiceTransportPolicy` |  |

Returns: `RelayTransport`.

## createNodeServiceDiscoveryTransport

See the declaration and linked source for the contract.

[Source](../../src/chain/node.ts#L37)

```ts
import {createNodeServiceDiscoveryTransport} from 'tasra-sdk/chain/node'

declare function createNodeServiceDiscoveryTransport(policy?: ServiceTransportPolicy): ServiceDiscoveryTransport
```

| Parameter | Type | Description |
|---|---|---|
| `policy` | `ServiceTransportPolicy` |  |

Returns: `ServiceDiscoveryTransport`.

## createNodeServiceStatusTransport

Public readiness and relay-policy observations, with the same socket/TLS policy.

[Source](../../src/chain/node.ts#L42)

```ts
import {createNodeServiceStatusTransport} from 'tasra-sdk/chain/node'

declare function createNodeServiceStatusTransport(policy?: ServiceTransportPolicy): ServiceDiscoveryTransport
```

| Parameter | Type | Description |
|---|---|---|
| `policy` | `ServiceTransportPolicy` |  |

Returns: `ServiceDiscoveryTransport`.

## isPublicServiceAddress

Conservative globally routable destinations; special-purpose exceptions require explicit policy.

[Source](../../src/chain/node.ts#L24)

```ts
import {isPublicServiceAddress} from 'tasra-sdk/chain/node'

declare function isPublicServiceAddress(address: string): boolean
```

| Parameter | Type | Description |
|---|---|---|
| `address` | `string` |  |

Returns: `boolean`.

## ServiceTransportPolicy

See the declaration and linked source for the contract.

[Source](../../src/chain/node.ts#L30)

```ts
export interface ServiceTransportPolicy {
  /** Exact, canonical hostnames/IPs only. Application configuration, never downloaded metadata. */
  allowedPrivateHosts?: readonly string[]
  /** Additional deployment CA roots. Certificate and hostname verification remain mandatory. */
  ca?: string | Buffer | (string | Buffer)[]
}
```

