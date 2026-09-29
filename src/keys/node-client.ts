// HTTP client for the keykeeper node API. Talks to nodes directly. A browser
// app needs the node's `api.cors_allowed_origins` to include its origin; there
// is no proxy in this package.

import {assembleKey, type Shard} from '../crypto/kem.js'
import {hexToBytes} from '../crypto/hex.js'
import {httpError, isAuthDenied, TasraError, ThresholdNotMetError} from '../errors.js'

export interface NodeConfig {
  urls: string[]
  jwt: string
}

export interface MpkResponse {
  group_public_key: string
  epoch: number
}

/**
 * Fetch a slot's group public key and epoch from a keeper. Reject a reply without a ready key.
 *
 * @param nodeUrl - Keeper HTTP base URL from the downloaded network manifest or authenticated registry.
 * @param slotHex - 32-byte slot identifier, with or without the 0x prefix.
 */
export async function fetchMpk(
  nodeUrl: string,
  slotHex: string,
): Promise<{mpkBytes: Uint8Array; epoch: number}> {
  const clean = slotHex.startsWith('0x') ? slotHex : `0x${slotHex}`
  const res = await fetch(`${nodeUrl.replace(/\/$/, '')}/v1/keys/${clean}/public`)
  // This is on the critical path of every openSession, so the error has to carry
  // enough to debug: which slot, which node, and what the node actually said.
  if (!res.ok) {
    throw await httpError(res, nodeUrl, `fetchMpk(${clean.slice(0, 10)}…)`)
  }
  const body = (await res.json()) as MpkResponse
  if (!body.group_public_key) {
    // A known-but-unkeyed slot answers 200 with an empty key - DKG has not
    // finished yet. Transient, unlike a 404.
    throw new TasraError(
      `fetchMpk: ${nodeUrl} served slot ${clean.slice(0, 10)}… with no group_public_key ` +
        `(DKG has not completed for this slot yet)`,
      {retryable: true},
    )
  }
  return {mpkBytes: hexToBytes(body.group_public_key), epoch: body.epoch ?? 0}
}

/**
 * Fetch key shards concurrently and interpolate the slot's master secret key in this process. The caller must obtain a sufficient threshold from one epoch and clear the returned key after use.
 *
 * @param cfg - Keeper URLs and a JWT authorizing shard release.
 * @param slotHex - 32-byte slot identifier, with or without the 0x prefix.
 * @returns The reconstructed master secret key as a 32-byte little-endian scalar.
 * @throws If no shards are returned or interpolation fails.
 */
export async function fetchAndAssembleKey(
  cfg: NodeConfig,
  slotHex: string,
): Promise<Uint8Array> {
  const clean = slotHex.startsWith('0x') ? slotHex : `0x${slotHex}`
  const body = JSON.stringify({key_slot_id: clean})
  const shards: Shard[] = []

  const results = await Promise.allSettled(
    cfg.urls.map(async nodeUrl => {
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.jwt}`,
      }
      const res = await fetch(`${nodeUrl.replace(/\/$/, '')}/v1/shards/key`, {method: 'POST', headers, body})
      if (!res.ok) throw await httpError(res, nodeUrl, `shards/key from ${nodeUrl}`)
      const data = (await res.json()) as {
        identifier: number
        shard: string
        epoch: number
      }
      return {id: data.identifier, bytes: b64ToBytes(data.shard)} satisfies Shard
    }),
  )

  const reasons: string[] = []
  const errors: unknown[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') shards.push(r.value)
    else {
      errors.push(r.reason)
      reasons.push(r.reason instanceof Error ? r.reason.message : String(r.reason))
    }
  }
  if (shards.length === 0) {
    // Surface an AUTH failure as such: when every node rejected with 401/403
    // (expired/denied/revoked JWT), the caller must re-claim - retrying the same
    // token is futile, and a generic message reads as transient and gets
    // retry-looped. Only when the failures are NOT auth (cold DKG, network) is
    // it transient.
    //
    // Either way the per-node `reasons` ride along on the error rather than
    // being discarded, so a caller can tell a DNS failure from a cold DKG.
    const denied = errors.filter(isAuthDenied)
    throw new ThresholdNotMetError({
      got: 0,
      need: cfg.urls.length ? 1 : 0,
      reasons,
      retryable: denied.length !== errors.length,
      message:
        denied.length === errors.length && denied.length > 0
          ? `fetchAndAssembleKey: every node denied the JWT (re-claim; retrying the same token will fail) — ${reasons.join('; ')}`
          : `fetchAndAssembleKey: no shards collected from ${cfg.urls.length} node(s) — ${reasons.join('; ')}`,
    })
  }
  return assembleKey(shards)
}

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

// There is no `triggerDkg` here, and no keeper endpoint that creates a slot: a
// slot created over HTTP would have no on-chain record - no creator, no
// contract-drawn committee, no `KeySlotCreated` - and a DCQL rule nothing could
// commitment-check.
//
// Create the slot ON CHAIN
// (`createTasraWriteClient(...).createSlot(...)`, or the operator CLI
// `tasra-cli slot create`); each drawn keeper then runs the ceremony itself
// from the event. Afterwards the clear-text rule must be provisioned to the
// committee WITH its salt.
