import {httpError} from '../errors.js'
// Off-chain read clients for the live network (keykeeper-node + verifier).
//
// Unlike the browser-oriented nodeClient.ts (which routes through a CORS proxy),
// these are direct server-to-server reads for the explorer's aggregator: a node
// or verifier base URL in, a typed status object out, with a built-in timeout.
// All endpoints here are the public, unauthenticated read surface.

/**
 * Timeout and optional bearer authorization for direct service reads.
 */
export interface FetchOpts {
  /** Per-request timeout in ms (default 4000). */
  timeoutMs?: number
  /** Bearer JWT, for the few authenticated reads (metering/audit). */
  jwt?: string
}

async function fetchJson<T>(url: string, opts: FetchOpts = {}): Promise<T> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 4000)
  try {
    const headers: Record<string, string> = {}
    if (opts.jwt) headers.Authorization = `Bearer ${opts.jwt}`
    const res = await fetch(url, {signal: ctrl.signal, headers})
    if (!res.ok) throw await httpError(res, url)
    return (await res.json()) as T
  } finally {
    clearTimeout(t)
  }
}

async function fetchText(url: string, opts: FetchOpts = {}): Promise<string> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 4000)
  try {
    const res = await fetch(url, {signal: ctrl.signal})
    if (!res.ok) throw await httpError(res, url)
    return await res.text()
  } finally {
    clearTimeout(t)
  }
}

const trim = (u: string) => u.replace(/\/$/, '')

//  keykeeper-node

/**
 * Keeper-reported runtime and connectivity metadata; fields depend on the server response.
 */
export interface NodeInfo {
  /** Keeper-reported network peer identifier. */
  peer_id?: string
  /** Keeper-reported node identifier. */
  node_identifier?: number
  /** Keeper software version reported by the service. */
  version?: string
  /** Build profile reported by the keeper. */
  build_profile?: string
  /** Keeper process uptime in seconds, as reported by the service. */
  uptime_secs?: number
  /** Reported connected-peer count, or null when unavailable. */
  connected_peers?: number | null
  /** Whether the keeper reports rate limiting as enabled. */
  rate_limit_enabled?: boolean
  /** Whether the keeper reports administrative scope checks as enabled. */
  admin_scope_enabled?: boolean
  [k: string]: unknown
}

/**
 * Keeper-reported slot threshold, key epoch and optional rule or activity metadata.
 */
export interface KeySlotSummary {
  /** Slot identifier returned by the keeper. */
  key_slot_id: string
  /** Required threshold shares reported for the slot. */
  threshold_k: number
  /** Total assigned participants reported for the slot. */
  threshold_n: number
  /** Slot key epoch reported by the keeper. */
  epoch: number
  /** Encoded group public key, or null when the service has no ready key. */
  group_public_key?: string | null
  /** Disclosed authorization rule text, when included by the service. */
  dcql_rule?: string | null
  /** Slot key mode reported by the keeper. */
  mode?: string
  /** Creation timestamp string reported by the service. */
  created_at?: string
  /** Most recent signing timestamp reported by the service, or null when absent. */
  last_signed_at?: string | null
  [k: string]: unknown
}

/**
 * Slot summaries returned by a keeper key-list endpoint.
 */
export interface KeyListReply {
  /** Slot summaries included in the keeper response. */
  slots: KeySlotSummary[]
  [k: string]: unknown
}

/**
 * Operator heartbeat carrying an epoch, public key and signature; reading it does not verify it.
 */
export interface SignedHeartbeat {
  /** Operator address claimed by the heartbeat. */
  operator: string
  /** Heartbeat epoch reported by the operator; not a slot key epoch. */
  epoch: number
  /** Encoded public key included with the heartbeat. */
  pubkey: string
  /** Encoded heartbeat signature; callers must verify it before trusting the heartbeat. */
  signature: string
  [k: string]: unknown
}

/**
 * Keeper-reported operation counts for a slot and optional subject breakdown.
 */
export interface MeteringReply {
  /** Slot identifier whose operation counts were requested. */
  key_slot_id: string
  /** Start of the reporting interval, when supplied by the service. */
  since?: string
  /** End of the reporting interval, when supplied by the service. */
  until?: string
  /** Total operations counted by the service. */
  total: number
  /** Optional operation counts grouped by subject. */
  by_subject?: Array<{subject: string; count: number}>
  /** Optional service-provided attestation; this read helper does not verify it. */
  attestation?: unknown
  [k: string]: unknown
}

/**
 * Direct keeper HTTP reads for status, keys, public keys, heartbeats and metering.
 */
export const nodeApi = {
  info: (base: string, o?: FetchOpts) =>
    fetchJson<NodeInfo>(`${trim(base)}/v1/info`, o),
  health: (base: string, o?: FetchOpts) =>
    fetchJson<{status: string}>(`${trim(base)}/health`, o),
  readyz: (base: string, o?: FetchOpts) =>
    fetchJson<{status: string; component?: string}>(`${trim(base)}/readyz`, o),
  keys: (base: string, o?: FetchOpts) =>
    fetchJson<KeyListReply>(`${trim(base)}/v1/keys`, {...o}),
  keySlot: (base: string, id: string, o?: FetchOpts) =>
    fetchJson<KeySlotSummary>(`${trim(base)}/v1/keys/${id}`, o),
  keySlotPublic: (base: string, id: string, o?: FetchOpts) =>
    fetchJson<{group_public_key?: string; epoch?: number}>(
      `${trim(base)}/v1/keys/${id}/public`,
      o,
    ),
  heartbeat: (base: string, o?: FetchOpts) =>
    fetchJson<SignedHeartbeat>(`${trim(base)}/v1/heartbeat`, o),
  metering: (base: string, id: string, o?: FetchOpts) =>
    fetchJson<MeteringReply>(`${trim(base)}/v1/metering/${id}`, o),
  metrics: (base: string, o?: FetchOpts) =>
    fetchText(`${trim(base)}/metrics`, o),
}

//  verifier

/**
 * Verifier-reported runtime settings and token lifetime.
 */
export interface VerifierInfo {
  /** Verifier software version reported by the service. */
  version?: string
  /** Verifier process uptime in seconds. */
  uptime_secs?: number
  /** Reported bearer-token lifetime in seconds. */
  jwt_ttl_secs?: number
  /** Whether the verifier reports rate limiting as enabled. */
  rate_limit_enabled?: boolean
  [k: string]: unknown
}

/**
 * Direct verifier HTTP reads for status and Prometheus metrics.
 */
export const verifierApi = {
  info: (base: string, o?: FetchOpts) =>
    fetchJson<VerifierInfo>(`${trim(base)}/v1/info`, o),
  health: (base: string, o?: FetchOpts) =>
    fetchJson<{status: string}>(`${trim(base)}/health`, o),
  metrics: (base: string, o?: FetchOpts) =>
    fetchText(`${trim(base)}/metrics`, o),
}

/**
 * Parse finite numeric Prometheus samples into a map keyed by metric name and labels. Ignore comment lines and nonnumeric values; histogram buckets remain separate samples.
 * @param text Prometheus text exposition returned by a metrics endpoint.
 */
export function parsePrometheus(text: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const sp = line.lastIndexOf(' ')
    if (sp < 0) continue
    const key = line.slice(0, sp).trim()
    const val = Number(line.slice(sp + 1).trim())
    if (Number.isFinite(val)) out[key] = val
  }
  return out
}
