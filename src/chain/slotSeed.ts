// accountant-seeded creation: the per-commitment draw seed.
//
// Under the older beacon-epoch creation a slot was committed, then revealed once the beacon had
// advanced past the commit's target epoch. The wait is what made the committee draw ungrindable -
// the seed must post-date the commitment - and it cost ONE TO TWO BEACON EPOCHS (the target is
// `COMMIT_GAP = 2` epochs past the epoch the commit landed in), which at the production cadence of
// one hour is one to two hours.
//
// accountant-seeded creation keeps the property and drops the wait: the accountant set threshold-signs
// `KeyRegistry.commitSeedDigest(commitment)` on demand, and the reveal derives the draw seed from
// that signature. It post-dates the commitment because it is OVER the commitment.
//
// This module is the client half, and the ONLY way the SDK creates a slot. There is no fallback to
// the epoch wait: the epoch seed comes from the same k-of-n accountant set, so a fallback adds no
// liveness - only a wait of up to two hours. A seed that cannot be had within the bounded window is
// a typed failure the caller can act on (`SlotSeedUnavailableError`), never a silent wait.

import type {Hex} from 'viem'
import type {TasraChainClient} from './client.js'
import {keyRegistryAbi} from './abis/index.js'
import {resolveAccountantUrls} from './discovery.js'
import {parseRetryAfter} from '../internal/retryAfter.js'

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

type Asked = {seed: SlotSeed} | {answer: SlotSeedAnswer; retryable: boolean; retryAfterMs?: number}

/**
 * Statuses that mean "not yet" rather than "no":
 * - 404: this accountant's chain view has not reached the commit receipt yet;
 * - 429: it sheds load and says when to come back (`Retry-After`);
 * - 503: its threshold set is not up, or it is already leading a round (one at a time, by design:
 *   a queue there is a queue in front of the beacon);
 * - 502/504: it could not read the chain, or a proxy timed out.
 * A 409 is the opposite: the commitment is bound to another reveal path, or already revealed, and
 * no retry can change it.
 */
const RETRYABLE = new Set([404, 429, 502, 503, 504])

/** Default time the creation path keeps re-asking while the set answers "not yet". */
export const DEFAULT_SLOT_SEED_RETRY_MS = 90_000
/**
 * Default stagger between launching the asks of one round. The asks run CONCURRENTLY and the first
 * valid seed wins; the stagger only keeps a healthy set from leading n threshold rounds for one
 * commitment (each accountant leads at most one round at a time and sheds the rest with a 503).
 * An ask that fails launches the next one at once, without waiting for the stagger.
 */
export const DEFAULT_SLOT_SEED_HEDGE_MS = 750

async function askOne(url: string, commitment: Hex, timeoutMs: number, expectedDigest: string, signal: AbortSignal): Promise<Asked> {
  let end = url.length
  while (end > 0 && url[end - 1] === '/') end--
  const base = url.slice(0, end)
  let res: Response
  try {
    res = await fetch(`${base}/v1/slot-seed`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({commitment}),
      signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]),
    })
  } catch (e) {
    // A timeout is "busy", and asked again in the next round. A refused or reset connection is
    // "down", and is not: an accountant that is down is down for longer than the retry window, and
    // a set that is entirely unreachable must fail FAST rather than pay the window to say so.
    const timedOut = e instanceof Error && e.name === 'TimeoutError'
    return {answer: {url, reason: `${timedOut ? 'timed out' : 'unreachable'}: ${e instanceof Error ? e.message : String(e)}`}, retryable: timedOut}
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const retryable = RETRYABLE.has(res.status)
    return {answer: {url, status: res.status, reason: text.slice(0, 200) || `HTTP ${res.status}`}, retryable, ...retryable ? {retryAfterMs: parseRetryAfter(typeof res.headers?.get === 'function' ? res.headers.get('retry-after') : undefined)} : {}}
  }
  const seed = parseSeed(await res.json().catch(() => null), commitment)
  if (!seed) return {answer: {url, status: res.status, reason: 'malformed seed response'}, retryable: false}
  // A digest that is not the registry's own means this accountant is bound to a DIFFERENT
  // registry or chain - its signature could never satisfy the reveal. Skip it rather than
  // spending gas to be told so.
  if (seed.digest !== expectedDigest) return {answer: {url, status: res.status, reason: 'digest is not this registry\'s commitSeedDigest'}, retryable: false}
  return {seed}
}

type Round = {seed: SlotSeed} | {asked: Extract<Asked, {answer: SlotSeedAnswer}>[]; settled: boolean}

/**
 * One round: every accountant asked once, CONCURRENTLY. Asks launch `hedgeMs` apart in `order`, or at
 * once when an earlier ask fails; the first valid seed wins and cancels the rest. A 409 ends the
 * round: it is the chain's answer, not one accountant's state.
 */
function askRound(order: string[], commitment: Hex, timeoutMs: number, expected: string, hedgeMs: number, outer?: AbortSignal): Promise<Round> {
  return new Promise(resolve => {
    const cancel = new AbortController()
    const signal = outer ? AbortSignal.any([cancel.signal, outer]) : cancel.signal
    const asked: Extract<Asked, {answer: SlotSeedAnswer}>[] = []
    let next = 0, pending = 0, done = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (r: Round) => {
      if (done) return
      done = true
      clearTimeout(timer)
      cancel.abort()
      resolve(r)
    }
    const launch = () => {
      clearTimeout(timer)
      const url = order[next++]
      if (done || url === undefined) return
      pending++
      void askOne(url, commitment, timeoutMs, expected, signal).then(a => {
        pending--
        if (done) return
        if ('seed' in a) return finish({seed: a.seed})
        asked.push(a)
        if (a.answer.status === 409) return finish({asked, settled: true})
        if (next < order.length) launch()
        else if (pending === 0) finish({asked, settled: false})
      })
      if (next < order.length) timer = setTimeout(launch, hedgeMs)
    }
    if (!order.length) return finish({asked, settled: false})
    launch()
  })
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const aborted = () => {clearTimeout(timer); reject(signal?.reason)}
    const timer = setTimeout(() => {signal?.removeEventListener('abort', aborted); resolve()}, ms)
    signal?.addEventListener('abort', aborted, {once: true})
  })
}

/**
 * Accountant endpoint overrides, per-request timeout and the bounded retry window for committee
 * seed discovery.
 */
export interface SlotSeedOptions {
  /** Accountant base URLs. Resolved from `NodeRegistry` when omitted. */
  urls?: string[]
  /** Per-accountant HTTP timeout (default 20 s). Within a retry window it is also capped by what is left of the window. */
  timeoutMs?: number
  /**
   * Keep asking for up to this long while some refusal is a "not yet" (404 before the
   * accountant's view reaches the commit, 503 while another creation's round holds it, 429, a
   * timeout). Rounds back off with jitter and honour `Retry-After`; a `Retry-After` that lands past
   * the window ends it at once. Default 0: one round. `createSlotCommitReveal` passes
   * {@link DEFAULT_SLOT_SEED_RETRY_MS}.
   */
  retryForMs?: number
  /** Stagger between the concurrent asks of one round (default {@link DEFAULT_SLOT_SEED_HEDGE_MS}; 0 asks all at once). */
  hedgeMs?: number
  /** Cancels the asks and the waits between rounds. */
  signal?: AbortSignal
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
 * Request a committee draw seed and compare its digest with the registry. Checks signature encoding and rejects the point at infinity; signature cryptography is verified during the on-chain reveal. Accountants are asked concurrently and the first valid seed wins.
 * @param chain Reader for the deployment owning the commitment.
 * @param keyRegistry Registry that will receive the reveal transaction.
 * @param commitment Previously submitted creation commitment.
 * @param opts Accountant endpoints, request timeout, retry window and cancellation.
 * @returns A seed response, or null when no accountant returns an acceptable response within the window.
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
  const hedgeMs = opts.hedgeMs ?? DEFAULT_SLOT_SEED_HEDGE_MS
  if (!Number.isSafeInteger(hedgeMs) || hedgeMs < 0 || hedgeMs > 60_000) {
    throw new Error('Invalid slot-seed hedge delay')
  }
  opts.signal?.throwIfAborted()
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
  // creators would otherwise all lead on the first one, whose single lead slot then sheds every
  // caller but one with a 503. Derived, not random, so a given creation asks in a fixed order.
  const offset = Number.parseInt(commitment.slice(-4), 16) % urls.length || 0
  let delay = 250
  for (let round = 1; ; round++) {
    const order = urls.map((_, i) => urls[(offset + round - 1 + i) % urls.length]).filter((u): u is string => u !== undefined)
    // Inside a window, no ask outlives it by more than a second: the window is the bound a caller
    // was promised, not a floor under a 20 s ask that started just before it closed.
    const askMs = retryForMs > 0 ? Math.max(1_000, Math.min(timeoutMs, deadline - Date.now())) : timeoutMs
    const r = await askRound(order, commitment, askMs, expected, hedgeMs, opts.signal)
    if ('seed' in r) return r.seed
    opts.signal?.throwIfAborted()
    const answers = r.asked.map(a => a.answer)
    const notYet = r.asked.filter(a => a.retryable)
    const fail = () => {
      opts.onFailure?.({rounds: round, answers, reason: summarise(answers)})
      return null
    }
    if (!notYet.length || r.settled) return fail()
    // Jittered so a burst of creators that were all shed together does not come back together.
    // When EVERY "not yet" named a Retry-After, nobody will answer sooner than the earliest of them.
    const hinted = notYet.every(a => a.retryAfterMs !== undefined) ? Math.min(...notYet.map(a => a.retryAfterMs ?? 0)) : 0
    const wait = Math.max(delay / 2 + Math.random() * delay / 2, hinted)
    if (Date.now() + wait > deadline) return fail()
    await pause(wait, opts.signal)
    delay = Math.min(delay * 2, 4_000)
  }
}
