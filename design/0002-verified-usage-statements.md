# 0002 Verified, creator-scoped usage statements (U6)

Status: design only. The network endpoints it needs do not exist on keykeeper-network
`origin/develop` 33906978 or `perf/integration-c25` 23b21783. Maintenance note, not published
SDK content.

## What exists

| Route | Authorization | Signed |
|---|---|---|
| `GET /v1/metering/:id` | node-wide `audit:read` JWT, off by default | no |
| `GET /v1/metering/:id/signed` | an active accountant operator's signed request | the total only |
| `GET /v1/metering/:id/statements?from&to` | an active accountant operator; only with `[chain] statement_log = true` (default off) | each statement, by the keeper's NodeRegistry ed25519 key, domain `keykeeper-metering-statement:v1` |
| `GET /v1/audit/:id[/count]` | `audit:read` JWT | no |

None is readable by a slot's creator, so a control plane cannot read its customers' usage
without node-wide credentials. `nodeApi.metering` calls the first route and verifies nothing.

## Network endpoints needed (U3 to U5)

1. `GET /v1/metering/:id/statements/by-creator?from&to&cursor` on every keeper, authorized by
   an EIP-712 signature of the slot's current creator over
   `{chainId, keyRegistry, slotId, from, to, cursor, issuedAt}` (ERC-1271 for a contract
   creator once Q14 is decided), at most 120 s old. Returns
   `{statements: MeteringStatement[], signatures: string[], next_cursor?: string}`.
2. The same authorization on `GET /v1/audit/:id/by-creator` (failures and denials, which
   statements omit), plus an IBE-extraction audit list.
3. `statement_log` on by default, with a retention a monthly invoice can rely on.
4. A signed envelope over the whole reply (range, cursor, every statement digest) by the
   answering keeper, so a page cannot be truncated or reordered unnoticed.

## Client interface the SDK would expose

```ts
/** One keeper statement for one slot and window, as the keeper signed it. */
interface MeteringStatement {
  chainId: number; slotId: Hex; keeper: Address; windowStart: number; windowSecs: number
  bySubject: {subject: string; ops: bigint}[]; signers: number[]; verifierOperators: Address[]
}
/** A statement whose keeper signature verified against the keeper's registered key. */
interface VerifiedMeteringStatement extends MeteringStatement { keeperKey: Hex; digest: Hex }

/**
 * Verify one statement: canonical bytes, domain `keykeeper-metering-statement:v1`, the keeper's
 * ed25519 signature against its NodeRegistry key at a canonical block, that the keeper was
 * assigned to the slot, window alignment and the bounds the network enforces.
 */
function verifyMeteringStatement(chain: TasraChainClient, statement: unknown, signature: Hex,
  options?: {blockNumber?: bigint}): Promise<VerifiedMeteringStatement>

/** Page creator-scoped statements from one keeper; every page envelope and statement is verified. */
function meteringStatements(chain: TasraChainClient, input: {
  slot: Hex; keeperUrl: string; from: number; to: number
  creator: Pick<LocalAccount, 'address' | 'signTypedData'>; pageSize?: number; signal?: AbortSignal
}): AsyncIterable<VerifiedMeteringStatement>

/** Usage across the assigned keepers: per subject, the maximum any keeper states, as settlement meters it. */
function slotUsage(chain: TasraChainClient, input: {slot: Hex; from: number; to: number
  creator: Pick<LocalAccount, 'address' | 'signTypedData'>}): Promise<{bySubject: Map<string, bigint>; keepers: Address[]}>
```

`nodeApi.metering` would be marked deprecated in favour of `meteringStatements` once the
endpoints exist. Subjects are the committee token's `vp_hash`, pseudonymous per presentation;
who may link them is a product decision (Console Q4 in its capability notes).
