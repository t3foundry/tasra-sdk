# tasra-sdk/chain/node

Generated from public TypeScript exports.

[SDK reference](README.md) · [Task guides](../README.md) · [Errors](../errors.md)

## Functions

Operations you can import and call.

<details>
<summary>Browse 6 functions</summary>

- [createNodeAgentTransport](#createnodeagenttransport)
- [createNodeAgentWalletFetch](#createnodeagentwalletfetch)
- [createNodeRelayTransport](#createnoderelaytransport)
- [createNodeServiceDiscoveryTransport](#createnodeservicediscoverytransport)
- [createNodeServiceStatusTransport](#createnodeservicestatustransport)
- [isPublicServiceAddress](#ispublicserviceaddress)

</details>

### createNodeAgentTransport

Session secrets use this same guarded connection and can only travel to a session GET.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/node.ts#L73)

Import: `import {createNodeAgentTransport} from 'tasra-sdk/chain/node'`

```ts
declare function createNodeAgentTransport(policy?: ServiceTransportPolicy): AgentTransport;
```

| Parameter | Type | Description |
|---|---|---|
| ` policy? ` | ` ServiceTransportPolicy ` | Explicit private-host exceptions and additional trusted certificate roots. |

Returns: ` AgentTransport `.

### createNodeAgentWalletFetch

Wallet protocol requests restricted to the selected session and approved DID, with socket checks.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/node.ts#L84)

Import: `import {createNodeAgentWalletFetch} from 'tasra-sdk/chain/node'`

```ts
declare function createNodeAgentWalletFetch(session: Pick<RegisteredAgentSession, 'profile' | 'requestUri' | 'sessionId'>, policy?: ServiceTransportPolicy): typeof fetch;
```

| Parameter | Type | Description |
|---|---|---|
| ` session ` | ` Pick<RegisteredAgentSession, 'profile' \| 'requestUri' \| 'sessionId'> ` | Authenticated session whose request, response and DID URLs are allowed. |
| ` policy? ` | ` ServiceTransportPolicy ` | Explicit private-host exceptions and additional trusted certificate roots. |

Returns: ` typeof fetch `.

### createNodeRelayTransport

Discovery and relay traffic use the same socket-bound destination and TLS policy.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/node.ts#L63)

Import: `import {createNodeRelayTransport} from 'tasra-sdk/chain/node'`

```ts
declare function createNodeRelayTransport(policy?: ServiceTransportPolicy): RelayTransport;
```

| Parameter | Type | Description |
|---|---|---|
| ` policy? ` | ` ServiceTransportPolicy ` | Explicit private-host exceptions and additional trusted certificate roots. |

Returns: ` RelayTransport `.

### createNodeServiceDiscoveryTransport

Create a bounded HTTPS transport that validates destinations at socket connection time.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/node.ts#L47)

Import: `import {createNodeServiceDiscoveryTransport} from 'tasra-sdk/chain/node'`

```ts
declare function createNodeServiceDiscoveryTransport(policy?: ServiceTransportPolicy): ServiceDiscoveryTransport;
```

| Parameter | Type | Description |
|---|---|---|
| ` policy? ` | ` ServiceTransportPolicy ` | Explicit private-host exceptions and additional trusted certificate roots. |

Returns: ` ServiceDiscoveryTransport `.

### createNodeServiceStatusTransport

Public readiness and relay-policy observations, with the same socket/TLS policy.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/node.ts#L55)

Import: `import {createNodeServiceStatusTransport} from 'tasra-sdk/chain/node'`

```ts
declare function createNodeServiceStatusTransport(policy?: ServiceTransportPolicy): ServiceDiscoveryTransport;
```

| Parameter | Type | Description |
|---|---|---|
| ` policy? ` | ` ServiceTransportPolicy ` | Explicit private-host exceptions and additional trusted certificate roots. |

Returns: ` ServiceDiscoveryTransport `.

### isPublicServiceAddress

Conservative globally routable destinations; special-purpose exceptions require explicit policy.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/node.ts#L27)

Import: `import {isPublicServiceAddress} from 'tasra-sdk/chain/node'`

```ts
declare function isPublicServiceAddress(address: string): boolean;
```

| Parameter | Type | Description |
|---|---|---|
| ` address ` | ` string ` | IPv4 or IPv6 address resolved for the service destination. |

Returns: ` boolean `.

## Types

Options, data structures and return types.

<details>
<summary>Browse 1 types</summary>

- [ServiceTransportPolicy](#servicetransportpolicy)

</details>

### ServiceTransportPolicy

Caller-approved destination and certificate policy for Node.js service transports.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/chain/node.ts#L36)

```ts
export interface ServiceTransportPolicy {
    allowedPrivateHosts?: readonly string[];
    ca?: string | Buffer | (string | Buffer)[];
}
```

Fields:

- **` allowedPrivateHosts `**: Exact, canonical hostnames/IPs only. Application configuration, never downloaded metadata.
- **` ca `**: Additional deployment CA roots. Certificate and hostname verification remain mandatory.
