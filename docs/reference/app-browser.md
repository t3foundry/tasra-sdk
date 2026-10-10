# tasra-sdk/app/browser

Generated from public TypeScript exports.

[SDK reference](README.md) · [Task guides](../README.md) · [Errors](../errors.md)

## Classes

Clients, adapters and error classes.

<details>
<summary>Browse 1 classes</summary>

- [StoreLockedError](#storelockederror)

</details>

### StoreLockedError

A state lock is already held and requires reconciliation before manual removal.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/store-errors.ts#L6)

Import: `import {StoreLockedError} from 'tasra-sdk/app/browser'`

```ts
declare class StoreLockedError {
    constructor(key: string);
}
```

- ` readonly key: string; ` — Store entry whose exclusive lock could not be acquired.

- ` readonly retryable: boolean; ` — `false` when retrying the identical request cannot succeed.

- ` name: string; `

- ` message: string; `

- ` stack?: string; `

- ` cause?: unknown; `

## Functions

Operations you can import and call.

<details>
<summary>Browse 4 functions</summary>

- [createBrowserKeeperRecoveryTransport](#createbrowserkeeperrecoverytransport)
- [createBrowserPaidAgentTransport](#createbrowserpaidagenttransport)
- [createBrowserRelayTransport](#createbrowserrelaytransport)
- [createIndexedDbStore](#createindexeddbstore)

</details>

### createBrowserKeeperRecoveryTransport

Browser transport for reading a keeper's retained paid result (the two POST recovery reads only).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/browser.ts#L243)

Import: `import {createBrowserKeeperRecoveryTransport} from 'tasra-sdk/app/browser'`

```ts
declare function createBrowserKeeperRecoveryTransport(options?: BrowserKeeperRecoveryTransportOptions): KeeperRecoveryTransport;
```

| Parameter | Type | Description |
|---|---|---|
| ` options? ` | ` BrowserKeeperRecoveryTransportOptions ` | Fetch override, approved private hosts, local development HTTP and request deadline. |

Returns: ` KeeperRecoveryTransport `.

### createBrowserPaidAgentTransport

Browser transport for registered paid sessions: authenticated discovery plus owner-only
session control, with the same route, method, bearer and bound checks as the Node transport.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/browser.ts#L223)

Import: `import {createBrowserPaidAgentTransport} from 'tasra-sdk/app/browser'`

```ts
declare function createBrowserPaidAgentTransport(options?: BrowserTransportOptions): PaidAgentTransport;
```

| Parameter | Type | Description |
|---|---|---|
| ` options? ` | ` BrowserTransportOptions ` | Fetch override, approved private hosts and request deadline. |

Returns: ` PaidAgentTransport `.

### createBrowserRelayTransport

Browser transport for registered relayers: discovery, forward and status, with
`relayExchange` reporting busy refusals and their `Retry-After`.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/browser.ts#L253)

Import: `import {createBrowserRelayTransport} from 'tasra-sdk/app/browser'`

```ts
declare function createBrowserRelayTransport(options?: BrowserTransportOptions): RelayTransport;
```

| Parameter | Type | Description |
|---|---|---|
| ` options? ` | ` BrowserTransportOptions ` | Fetch override, approved private hosts and request deadline. |

Returns: ` RelayTransport `.

### createIndexedDbStore

Durable private state for browser applications: IndexedDB records committed with strict
durability before `save` resolves, and Web Locks (exclusive, shared by every tab, worker and
extension service worker of this origin) for `withLock`. Values must be plain data (strings,
finite numbers, booleans, bigints, Uint8Array, arrays and plain objects).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/browser.ts#L66)

Import: `import {createIndexedDbStore} from 'tasra-sdk/app/browser'`

```ts
declare function createIndexedDbStore(options?: IndexedDbStoreOptions): ApplicationStore;
```

| Parameter | Type | Description |
|---|---|---|
| ` options? ` | ` IndexedDbStoreOptions ` | Database name, factory/lock overrides and lock-wait behavior. |

Returns: ` ApplicationStore `.

## Types

Options, data structures and return types.

<details>
<summary>Browse 4 types</summary>

- [ApplicationStore](#applicationstore)
- [BrowserKeeperRecoveryTransportOptions](#browserkeeperrecoverytransportoptions)
- [BrowserTransportOptions](#browsertransportoptions)
- [IndexedDbStoreOptions](#indexeddbstoreoptions)

</details>

### ApplicationStore

Implementations must save atomically and exclusively lock across processes/tabs.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/ready-slot.ts#L38)

```ts
export interface ApplicationStore {
    load<T>(key: string): Promise<T | undefined>;
    save(key: string, value: unknown): Promise<void>;
    withLock<T>(key: string, operation: () => Promise<T>): Promise<T>;
    list?(prefix: string): Promise<string[]>;
    claim?(key: string): Promise<boolean>;
}
```

Fields:

- **` load `**: Load a saved value, or return undefined when the key does not exist.
- **` save `**: Atomically persist private state before resolving.
- **` withLock `**: Exclusively serialize work for the key across all participating processes or tabs.
- **` list `**: Optional: keys starting with `prefix`, in any order. Used only for one-time maintenance such as backfilling the paid operation index; stores without it still work everywhere else.
- **` claim `**: Optional: atomically and durably create the record `key` only if it does not exist, across all participating processes or tabs. Resolves true for exactly one caller, false when the key already exists. Paid approvals use it as a one-use, generation-bound send claim; without it a retained approval is sent once and never resent.

### BrowserKeeperRecoveryTransportOptions

Options for [createBrowserKeeperRecoveryTransport](#createbrowserkeeperrecoverytransport).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/browser.ts#L229)

```ts
export interface BrowserKeeperRecoveryTransportOptions extends BrowserTransportOptions {
    allowLocalHttp?: boolean;
}
```

Fields:

- **` allowLocalHttp `**: Local development fleet: also permit plain HTTP to loopback names and private IP literals (and only those), like the keepers of a local chain. Default false: HTTPS only. The recovery reads separately permit HTTP only on the local development chain (43112) with the paid operation's `allowLocalHttp`.
- **` fetch `**: Fetch implementation (default global fetch).
- **` allowedPrivateHosts `**: Exact loopback names or private IP literals the application approves (e.g. `localhost` during local development).
- **` timeoutMs `**: Absolute per-request deadline in ms (default 30000).

### BrowserTransportOptions

Options shared by the browser transports.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/browser.ts#L135)

```ts
export interface BrowserTransportOptions {
    fetch?: typeof fetch;
    allowedPrivateHosts?: readonly string[];
    timeoutMs?: number;
}
```

Fields:

- **` fetch `**: Fetch implementation (default global fetch).
- **` allowedPrivateHosts `**: Exact loopback names or private IP literals the application approves (e.g. `localhost` during local development).
- **` timeoutMs `**: Absolute per-request deadline in ms (default 30000).

### IndexedDbStoreOptions

Options for [createIndexedDbStore](#createindexeddbstore).

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/browser.ts#L31)

```ts
export interface IndexedDbStoreOptions {
    name?: string;
    indexedDB?: IDBFactory;
    locks?: LockManager;
    failIfLocked?: boolean;
}
```

Fields:

- **` name `**: Database name; one per application and deployment (default `tasra-sdk-state`).
- **` indexedDB `**: IndexedDB factory (default `globalThis.indexedDB`).
- **` locks `**: Web Locks manager (default `navigator.locks`). Required: tabs must share exclusive locks.
- **` failIfLocked `**: Fail with StoreLockedError instead of waiting when another tab holds the lock (default false: wait).
