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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/store-errors.ts#L6)

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

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/node.ts#L180)

Import: `import {createFileStore} from 'tasra-sdk/app/node'`

```ts
declare function createFileStore(directory: string, options?: FileStoreOptions): ApplicationStore;
```

| Parameter | Type | Description |
|---|---|---|
| ` directory ` | ` string ` | Private application state directory owned by the current operating-system user. |
| ` options? ` | ` FileStoreOptions ` | Bounded wait for a lock held by another process. |

Returns: ` ApplicationStore `.

## Types

Options, data structures and return types.

<details>
<summary>Browse 2 types</summary>

- [ApplicationStore](#applicationstore)
- [FileStoreOptions](#filestoreoptions)

</details>

### ApplicationStore

Durable private state storage with exclusive locking for each named operation.

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/node.ts#L14)

```ts
export interface ApplicationStore {
    load<T>(key: string): Promise<T | undefined>;
    save<T>(key: string, value: T): Promise<void>;
    withLock<T>(key: string, action: () => Promise<T>): Promise<T>;
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

### FileStoreOptions

Options for [createFileStore](#createfilestore).

[Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/node.ts#L165)

```ts
export interface FileStoreOptions {
    lockWaitMs?: number;
}
```

Fields:

- **` lockWaitMs `**: Longest wait, in ms, for a lock held by ANOTHER process before `withLock` refuses with StoreLockedError (default 10000; 0 refuses at once; at most 600000). A lock left by a crashed process is never removed or taken over: after the wait it still needs reconciliation. Calls in this process never refuse each other; they queue in call order.

## Constants and ABI values

Shared values and contract definitions.

| Export | Description | Definition |
|---|---|---|
| `fileStoreSyncCounters` | Durable-write steps the store counts (for tests and measurement); never part of the stored state. `flushes`: device flushes of a state directory (each one F_FULLFSYNC on macOS), whatever they served; `shared`: those that served a data barrier and a directory sync at once; `fileSyncs`: per-file syncs (only without O_DSYNC). | [Source](https://github.com/t3foundry/tasra-sdk/blob/develop/src/app/node.ts#L150) |
