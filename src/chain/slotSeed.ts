// accountant-seeded creation: the per-commitment draw seed.
//
// Under beacon-epoch creation a slot is committed, then revealed once the beacon has advanced past the
// commit's target epoch. The wait is what makes the committee draw ungrindable - the seed must
// post-date the commitment - and it costs one BEACON EPOCH, which at the production cadence is up
// to an hour.
//
// accountant-seeded creation keeps the property and drops the wait: the accountant set threshold-signs
// `KeyRegistry.commitSeedDigest(commitment)` on demand, and the reveal derives the draw seed from
// that signature. It post-dates the commitment because it is OVER the commitment.
//
// This module is the client half. It is deliberately best-effort: when no accountant answers, the
// caller falls back to the epoch wait, which still works and is what every existing deployment
// does. A seed that cannot be fetched is slower, never wrong.

import type {Hex} from 'viem'
import type {TasraChainClient} from './client.js'
import {keyRegistryAbi} from './abis/index.js'
import {resolveAccountantUrls} from './discovery.js'

/** What an accountant returns from `POST /v1/slot-seed`. */
export interface SlotSeed {
  /**
   * Creation commitment for which the seed was requested.
   */
  commitment: Hex
  /** `KeyRegistry.commitSeedDigest(commitment)` - what the signature is over. */
  digest: Hex
  /** The 64-byte BN254 G1 threshold signature; pass as `seedSig` to `revealKeySlotWithSeed`. */
  signature: Hex
}

/** A 64-byte BN254 G1 point, hex-encoded: the wire size of a threshold signature. */
const SIG_HEX_LEN = 2 + 64 * 2

function parseSeed(body: unknown, commitment: Hex): SlotSeed | null {
  if (!body || typeof body !== 'object') return null
  const {digest, signature} = body as Record<string, unknown>
  if (typeof digest !== 'string' || typeof signature !== 'string') return null
  if (!/^0x[0-9a-fA-F]{64}$/.test(digest)) return null
  // Pin the LENGTH, not just the alphabet. An accountant that answered with a short or
  // over-long signature would otherwise be discovered by a reverting reveal, which costs gas and
  // names `BadSeedSignature` - a message that points at the signature's validity, not its shape.
  if (signature.length !== SIG_HEX_LEN || !/^0x[0-9a-fA-F]+$/.test(signature)) return null
  // An all-zero signature is the point at infinity. The contract rejects it (it would otherwise
  // verify against an all-zero key from anyone), but rejecting it here means a misbehaving
  // accountant cannot make a caller pay for the discovery.
  if (BigInt(signature) === 0n) return null
  return {commitment, digest: digest.toLowerCase() as Hex, signature: signature.toLowerCase() as Hex}
}

/** One accountant's answer to one ask, when it was not a usable seed. */
export interface SlotSeedAnswer {
  /** The accountant base URL that was asked. */
  url: string
  /** HTTP status, when a response arrived. */
  status?: number
  /** Why the answer was not usable: the response reason, a transport error, or a shape/digest fault. */
  reason: string
}

/** Why no seed was obtained: every answer of the LAST round of asks, and how many rounds ran. */
export interface SlotSeedFailure {
  /** Rounds of asks made (one round asks every accountant once). */
  rounds: number
  /** Each accountant's answer in the last round. Empty when no accountant is registered. */
  answers: SlotSeedAnswer[]
  /** One line naming the dominant cause, for logs and bench records. */
  reason: string
}

type Asked = {seed: SlotSeed} | {answer: SlotSeedAnswer; retryable: boolean}

/**
 * Statuses that mean "not yet" rather than "no":
 * - 404: this accountant's chain view has not reached the commit receipt yet;
 * - 503: its threshold set is not up, or it is already leading a round (one at a time, by design:
 *   a queue there is a queue in front of the beacon);
 * - 502/504: it could not read the chain, or a proxy timed out.
 * A 409 is the opposite: the commitment is bound to another reveal path, or already revealed, and
 * no retry can change it.
 */
const RETRYABLE = new Set([404, 502, 503, 504])

async function askOne(url: string, commitment: Hex, timeoutMs: number, expectedDigest: string): Promise<Asked> {
  let end = url.length
  while (end > 0 && url[end - 1] === '/') end--
  const base = url.slice(0, end)
  let res: Response
  try {
    res = await fetch(`${base}/v1/slot-seed`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({commitment}),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    // One unreachable accountant is not a failure of the set - the next one is asked. It is not
    // retried either: an accountant that is down is down for longer than the retry window, and
    // a set that is entirely unreachable must reach the epoch wait without paying the window.
    return {answer: {url, reason: `unreachable: ${e instanceof Error ? e.message : String(e)}`}, retryable: false}
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return {answer: {url, status: res.status, reason: text.slice(0, 200) || `HTTP ${res.status}`}, retryable: RETRYABLE.has(res.status)}
  }
  const seed = parseSeed(await res.json().catch(() => null), commitment)
  if (!seed) return {answer: {url, status: res.status, reason: 'malformed seed response'}, retryable: false}
  // A digest that is not the registry's own means this accountant is bound to a DIFFERENT
  // registry or chain - its signature could never satisfy the reveal. Skip it rather than
  // spending gas to be told so.
  if (seed.digest !== expectedDigest) return {answer: {url, status: res.status, reason: 'digest is not this registry\'s commitSeedDigest'}, retryable: false}
  return {seed}
}

/**
 * Accountant endpoint overrides and per-request timeout for committee seed discovery.
 */
export interface SlotSeedOptions {
  /** Accountant base URLs. Resolved from `NodeRegistry` when omitted. */
  urls?: string[]
  /** Per-accountant HTTP timeout. The round itself is bounded server-side. */
  timeoutMs?: number
  /**
   * Keep asking for up to this long while every refusal is a "not yet" (404 before the
   * accountant's view reaches the commit, 503 while another creation's round holds it). Default 0:
   * one round. `createSlotCommitReveal` passes a window, because there the alternative is a full
   * beacon epoch.
   */
  retryForMs?: number
  /** Called once with every answer of the last round when no seed was obtained. */
  onFailure?: (failure: SlotSeedFailure) => void
}

function summarise(answers: SlotSeedAnswer[]): string {
  if (!answers.length) return 'no accountant registered'
  const counts = new Map<string, number>()
  for (const a of answers) {
    const key = a.status !== undefined ? `${a.status} ${a.reason}` : a.reason
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}x ${k}`).join('; ')
}

/**
 * Request a committee draw seed and compare its digest with the registry. Checks signature encoding and rejects the point at infinity; signature cryptography is verified during the on-chain reveal.
 * @param chain Reader for the deployment owning the commitment.
 * @param keyRegistry Registry that will receive the reveal transaction.
 * @param commitment Previously submitted creation commitment.
 * @param opts Accountant endpoints, request timeout and retry window.
 * @returns A seed response, or null when no accountant returns an acceptable response.
 */
export async function requestSlotSeed(
  chain: TasraChainClient,
  keyRegistry: `0x${string}`,
  commitment: Hex,
  opts: SlotSeedOptions = {},
): Promise<SlotSeed | null> {
  const timeoutMs = opts.timeoutMs ?? 20_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new Error('Invalid slot-seed timeout')
  }
  const retryForMs = opts.retryForMs ?? 0
  if (!Number.isSafeInteger(retryForMs) || retryForMs < 0 || retryForMs > 600_000) {
    throw new Error('Invalid slot-seed retry window')
  }
  const urls = opts.urls ?? (await resolveAccountantUrls(chain).catch(() => []))
  if (!urls.length) {
    opts.onFailure?.({rounds: 0, answers: [], reason: summarise([])})
    return null
  }

  const expected = (await chain.client.readContract({
    address: keyRegistry,
    abi: keyRegistryAbi,
    functionName: 'commitSeedDigest',
    args: [commitment],
  })).toLowerCase()

  const deadline = Date.now() + retryForMs
  // Start at an accountant picked by the commitment, and move one on per round: concurrent
  // creators would otherwise all queue on the first one, whose single lead slot then sheds every
  // caller but one with a 503. Derived, not random, so a given creation asks in a fixed order.
  const offset = Number.parseInt(commitment.slice(-4), 16) % urls.length || 0
  let delay = 250
  for (let round = 1; ; round++) {
    const answers: SlotSeedAnswer[] = []
    let retryable = false, settled = false
    for (let i = 0; i < urls.length; i++) {
      const url = urls[(offset + round - 1 + i) % urls.length]
      if (url === undefined) continue
      const asked = await askOne(url, commitment, timeoutMs, expected)
      if ('seed' in asked) return asked.seed
      answers.push(asked.answer)
      retryable ||= asked.retryable
      // A 409 is the CHAIN's answer (wrong reveal path, already revealed), not one accountant's
      // state: another accountant that has not caught up yet would only say 404 and be retried
      // for nothing.
      settled ||= asked.answer.status === 409
    }
    if (!retryable || settled || Date.now() + delay > deadline) {
      opts.onFailure?.({rounds: round, answers, reason: summarise(answers)})
      return null
    }
    // Jittered so a burst of creators that were all shed together does not come back together.
    await new Promise(r => setTimeout(r, delay / 2 + Math.random() * delay / 2))
    delay = Math.min(delay * 2, 2_000)
  }
}
