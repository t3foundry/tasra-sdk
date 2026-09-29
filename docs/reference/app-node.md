# tasra-sdk/app/node

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

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/node.ts#L28)

Import: `import {StoreLockedError} from 'tasra-sdk/app/node'`

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
<summary>Browse 1 functions</summary>

- [createFileStore](#createfilestore)

</details>

### createFileStore

The directory is private, trusted application state, not an untrusted shared folder.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/node.ts#L67)

Import: `import {createFileStore} from 'tasra-sdk/app/node'`

```ts
declare function createFileStore(directory: string): ApplicationStore;
```

| Parameter | Type | Description |
|---|---|---|
| ` directory ` | ` string ` | Private application state directory owned by the current operating-system user. |

Returns: ` ApplicationStore `.

## Types

Options, data structures and return types.

<details>
<summary>Browse 1 types</summary>

- [ApplicationStore](#applicationstore)

</details>

### ApplicationStore

Durable private state storage with exclusive locking for each named operation.

[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/src/app/node.ts#L11)

```ts
export interface ApplicationStore {
    load<T>(key: string): Promise<T | undefined>;
    save<T>(key: string, value: T): Promise<void>;
    withLock<T>(key: string, action: () => Promise<T>): Promise<T>;
}
```

Fields:

- **` load `**: Load a saved value, or return undefined when the key does not exist.
- **` save `**: Atomically persist private state before resolving.
- **` withLock `**: Exclusively serialize work for the key across all participating processes or tabs.
