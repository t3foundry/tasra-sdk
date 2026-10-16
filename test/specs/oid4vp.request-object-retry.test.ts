// fetchRequestObject while the verifier-agent's paid exchange is still running.
//
// The agent answers the wallet's `GET <request_uri>` with HTTP 503, `Retry-After: 2` and
// {"error": REQUEST_OBJECT_IN_PROGRESS} while the paid work that GET started runs detached; the
// same GET repeated joins that work and never sends or pays again. These tests pin that ONLY that
// answer is retried, only as the identical GET, within bounded attempts, waits and wall clock, and
// that the 200 path is unchanged.
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {ed25519DidKey, ed25519HolderKey, signCompactJws} from '../../src/oid4vp/jose.js'
import {
  CLIENT_ID_PREFIX_DID,
  REQUEST_OBJECT_AT_CAPACITY,
  REQUEST_OBJECT_IN_PROGRESS,
  REQUEST_OBJECT_TYP,
  fetchRequestObject,
  verifyRequestObject,
  type RequestObjectClaims,
} from '../../src/oid4vp/request-object.js'

const key = ed25519HolderKey(new Uint8Array(32).fill(0x41))
const did = ed25519DidKey(Uint8Array.from(Buffer.from((key.publicJwk as {x: string}).x, 'base64url')))
const claims: RequestObjectClaims = {
  iss: did, client_id: `${CLIENT_ID_PREFIX_DID}${did}`, response_type: 'vp_token', response_mode: 'direct_post.jwt',
  response_uri: 'https://agent.example/v1/sessions/s1/response', nonce: 'derived-nonce', state: 'state-1', iat: 1_000, exp: 9_999_999_999,
  dcql_query: {credentials: [{id: 'c', format: 'dc+sd-jwt', meta: {vct_values: ['https://example.com/Card']}, claims: [{path: ['given_name']}]}]},
}
const JAR = signCompactJws({typ: REQUEST_OBJECT_TYP, kid: `${did}#${did.slice('did:key:'.length)}`}, claims, {alg: 'EdDSA', privateKey: key.privateKey})
const URI = 'https://agent.example/v1/request/s1'
const ACCEPT = {Accept: `application/${REQUEST_OBJECT_TYP}`}
// The agent's exact text (keykeeper-verifier-agent server/delivery.rs `IN_PROGRESS`).
const AGENT_IN_PROGRESS = 'paid verifier exchange in progress; it will not be sent again - retry this request'
// The agent's exact text (delivery.rs `AT_CAPACITY`, commit e1c54ed8).
const AGENT_AT_CAPACITY = 'paid verifier exchange capacity saturated on this agent; nothing was sent or billed and the approval stands - retry this request'
const UNCERTAIN = 'paid delivery outcome uncertain (timeout); reconciliation pending - it cannot be sent again'

const inProgress = (retryAfter: string | null = '2'): Response =>
  new Response(JSON.stringify({error: REQUEST_OBJECT_IN_PROGRESS}), {status: 503,
    headers: {'content-type': 'application/json', ...(retryAfter === null ? {} : {'retry-after': retryAfter})}})
const atCapacity = (retryAfter: string | null = '2'): Response =>
  new Response(JSON.stringify({error: REQUEST_OBJECT_AT_CAPACITY}), {status: 503,
    headers: {'content-type': 'application/json', ...(retryAfter === null ? {} : {'retry-after': retryAfter})}})
const jarReply = (): Response => new Response(`${JAR}\n`, {status: 200, headers: {'content-type': `application/${REQUEST_OBJECT_TYP}`}})
const withProps = (res: Response, props: {redirected?: boolean; url?: string}): Response => {
  for (const [k, v] of Object.entries(props)) Object.defineProperty(res, k, {value: v})
  return res
}

interface Call {url: string; init: RequestInit | undefined; at: number}
/** A transport serving `replies` in order (the last one repeats), recording every call. */
function transport(replies: Array<() => Response | Promise<Response>>) {
  const calls: Call[] = []
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({url: String(input), init, at: Date.now()})
    return replies[Math.min(calls.length - 1, replies.length - 1)]!()
  }) as unknown as typeof fetch
  return {calls, fetchImpl}
}
const run = (p: Promise<unknown>) => p.then(v => ({ok: true as const, v}), (e: unknown) => ({ok: false as const, e}))
const msg = (r: {ok: boolean; e?: unknown}) => (r.e instanceof Error ? r.e.message : String(r.e))
const OPTS = {nowSecs: 2_000}

beforeEach(() => { vi.useFakeTimers({now: new Date('2026-10-16T00:00:00Z')}) })
afterEach(() => { vi.useRealTimers() })

describe('fetchRequestObject: in-progress and at-capacity retry', () => {
  it('pins the in-progress marker to the agent text', () => {
    expect(REQUEST_OBJECT_IN_PROGRESS).toBe(AGENT_IN_PROGRESS)
  })

  it('pins the at-capacity marker to the agent text', () => {
    expect(REQUEST_OBJECT_AT_CAPACITY).toBe(AGENT_AT_CAPACITY)
  })

  it('repeats the identical GET after an at-capacity 503 and returns the JAR', async () => {
    const {calls, fetchImpl} = transport([atCapacity, jarReply])
    const pending = run(fetchRequestObject(URI, {...OPTS, fetchImpl}))
    await vi.runAllTimersAsync()
    const result = await pending
    expect(result.ok).toBe(true)
    expect((result as {v: {jwt: string}}).v.jwt).toBe(JAR)
    expect(calls.map(c => c.at - calls[0]!.at)).toStrictEqual([0, 2_000])
    for (const c of calls) {
      expect(c.url).toBe(URI)
      expect(c.init?.method).toBeUndefined()
      expect(c.init?.body).toBeUndefined()
      expect(c.init?.headers).toStrictEqual(ACCEPT)
    }
  })

  it('stops an endless at-capacity answer at the default 120 s budget', async () => {
    const {calls, fetchImpl} = transport([atCapacity])
    const start = Date.now()
    const pending = run(fetchRequestObject(URI, {...OPTS, fetchImpl}))
    await vi.runAllTimersAsync()
    const result = await pending
    expect(result.ok).toBe(false)
    expect(msg(result)).toMatch(/request_uri .* → HTTP 503: .*capacity saturated/)
    expect(calls).toHaveLength(60)
    expect(Date.now() - start).toBe(118_000)
  })

  it('keeps mixed in-progress and at-capacity answers within one budget and one attempt count', async () => {
    {
      const {calls, fetchImpl} = transport([inProgress, atCapacity, inProgress, atCapacity, inProgress, atCapacity])
      const pending = run(fetchRequestObject(URI, {...OPTS, fetchImpl, inProgressRetry: {maxTotalMs: 9_000}}))
      await vi.runAllTimersAsync()
      expect((await pending).ok).toBe(false)
      expect(calls.map(c => c.at - calls[0]!.at)).toStrictEqual([0, 2_000, 4_000, 6_000, 8_000])
    }
    {
      const alternate = [inProgress, atCapacity]
      const {calls, fetchImpl} = transport(Array.from({length: 10}, (_, i) => alternate[i % 2]!))
      const pending = run(fetchRequestObject(URI, {...OPTS, fetchImpl, inProgressRetry: {maxAttempts: 5}}))
      await vi.runAllTimersAsync()
      expect((await pending).ok).toBe(false)
      expect(calls).toHaveLength(5)
    }
    {
      const {calls, fetchImpl} = transport([atCapacity, inProgress, atCapacity, jarReply])
      const pending = run(fetchRequestObject(URI, {...OPTS, fetchImpl}))
      await vi.runAllTimersAsync()
      expect((await pending).ok).toBe(true)
      expect(calls).toHaveLength(4)
    }
  })

  it('never retries the uncertain 503 after an at-capacity answer', async () => {
    const uncertain = () => new Response(JSON.stringify({error: UNCERTAIN}), {status: 503, headers: {'content-type': 'application/json', 'retry-after': '2'}})
    const {calls, fetchImpl} = transport([atCapacity, uncertain, jarReply])
    const pending = run(fetchRequestObject(URI, {...OPTS, fetchImpl}))
    await vi.runAllTimersAsync()
    const result = await pending
    expect(msg(result)).toMatch(/HTTP 503: .*uncertain/)
    expect(calls).toHaveLength(2)
  })

  it('keeps the 200 path unchanged: one GET with the same init, same bytes, same verification', async () => {
    const {calls, fetchImpl} = transport([jarReply])
    const got = await fetchRequestObject(URI, {...OPTS, fetchImpl})
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(URI)
    expect(calls[0]!.init).toStrictEqual({headers: ACCEPT})
    expect(got.jwt).toBe(JAR)
    expect(got).toStrictEqual(await verifyRequestObject(JAR, OPTS))
  })

  it('repeats the identical GET after an in-progress 503 and returns the JAR (regression)', async () => {
    const {calls, fetchImpl} = transport([inProgress, inProgress, jarReply])
    const pending = run(fetchRequestObject(URI, {...OPTS, fetchImpl}))
    await vi.runAllTimersAsync()
    const result = await pending
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(3)
    expect(calls.map(c => c.at - calls[0]!.at)).toStrictEqual([0, 2_000, 4_000])
    for (const c of calls) {
      expect(c.url).toBe(URI)
      expect(c.init?.method).toBeUndefined()
      expect(c.init?.body).toBeUndefined()
      expect(c.init?.headers).toStrictEqual(ACCEPT)
    }
    expect((result as {v: {jwt: string}}).v.jwt).toBe(JAR)
  })

  it('bounds the default wall clock at 120 s (the agent\'s longest detached exchange) and fails with the final 503', async () => {
    const {calls, fetchImpl} = transport([inProgress])
    const start = Date.now()
    const pending = run(fetchRequestObject(URI, {...OPTS, fetchImpl}))
    await vi.runAllTimersAsync()
    const result = await pending
    expect(result.ok).toBe(false)
    expect(msg(result)).toMatch(/request_uri .* → HTTP 503: .*in progress/)
    expect(calls).toHaveLength(60)
    expect(calls.at(-1)!.at - start).toBe(118_000)
    expect(Date.now() - start).toBe(118_000)
  })

  it('bounds the default attempt count at 64 even with the shortest waits', async () => {
    const {calls, fetchImpl} = transport([() => inProgress('0')])
    const start = Date.now()
    const pending = run(fetchRequestObject(URI, {...OPTS, fetchImpl}))
    await vi.runAllTimersAsync()
    expect((await pending).ok).toBe(false)
    expect(calls).toHaveLength(64)
    expect(Date.now() - start).toBe(63 * 500)
  })

  it('honours a smaller maxAttempts, and maxAttempts 1 disables the retry', async () => {
    for (const [maxAttempts, expected] of [[3, 3], [1, 1]] as const) {
      const {calls, fetchImpl} = transport([inProgress])
      const pending = run(fetchRequestObject(URI, {...OPTS, fetchImpl, inProgressRetry: {maxAttempts}}))
      await vi.runAllTimersAsync()
      expect((await pending).ok).toBe(false)
      expect(calls).toHaveLength(expected)
    }
  })

  it('bounds the wall clock by maxTotalMs and by notAfterMs, whichever is earlier', async () => {
    {
      const {calls, fetchImpl} = transport([() => inProgress('5')])
      const pending = run(fetchRequestObject(URI, {...OPTS, fetchImpl, inProgressRetry: {maxTotalMs: 12_000}}))
      await vi.runAllTimersAsync()
      expect((await pending).ok).toBe(false)
      expect(calls.map(c => c.at - calls[0]!.at)).toStrictEqual([0, 5_000, 10_000])
    }
    {
      const {calls, fetchImpl} = transport([inProgress])
      const pending = run(fetchRequestObject(URI, {...OPTS, fetchImpl, inProgressRetry: {notAfterMs: Date.now() + 5_000}}))
      await vi.runAllTimersAsync()
      expect((await pending).ok).toBe(false)
      expect(calls.map(c => c.at - calls[0]!.at)).toStrictEqual([0, 2_000, 4_000])
    }
  })

  it('cuts a hanging repeat off at the wall-clock deadline', async () => {
    let n = 0
    const fetchImpl = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      if (n++ === 0) return inProgress()
      return new Promise<Response>((_, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)))
    }) as unknown as typeof fetch
    const start = Date.now()
    const pending = run(fetchRequestObject(URI, {...OPTS, fetchImpl, inProgressRetry: {maxTotalMs: 10_000}}))
    await vi.runAllTimersAsync()
    const result = await pending
    expect(msg(result)).toMatch(/still unavailable when the retry budget ended/)
    expect(Date.now() - start).toBe(10_000)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['0', 500], ['1', 1_000], ['3', 3_000], ['3600', 5_000], ['86400', 5_000],
    ['999999999', 2_000], ['-5', 2_000], ['garbage', 2_000], ['', 2_000], [null, 2_000], ['1.5', 2_000],
  ])('clamps Retry-After %j to a %i ms wait', async (header, wait) => {
    const {calls, fetchImpl} = transport([() => inProgress(header), jarReply])
    const pending = run(fetchRequestObject(URI, {...OPTS, fetchImpl}))
    await vi.runAllTimersAsync()
    expect((await pending).ok).toBe(true)
    expect(calls[1]!.at - calls[0]!.at).toBe(wait)
  })

  it('accepts an HTTP-date Retry-After, clamped', async () => {
    for (const [offset, wait] of [[60_000, 5_000], [-60_000, 500], [3_000, 3_000]] as const) {
      vi.setSystemTime(new Date('2026-10-16T00:00:00Z'))
      const {calls, fetchImpl} = transport([() => inProgress(new Date(Date.now() + offset).toUTCString()), jarReply])
      const pending = run(fetchRequestObject(URI, {...OPTS, fetchImpl}))
      await vi.runAllTimersAsync()
      expect((await pending).ok).toBe(true)
      expect(calls[1]!.at - calls[0]!.at).toBe(wait)
    }
  })

  it('aborts promptly during the wait, with the signal reason and no further GET', async () => {
    const {calls, fetchImpl} = transport([inProgress])
    const controller = new AbortController()
    const pending = run(fetchRequestObject(URI, {...OPTS, fetchImpl, signal: controller.signal}))
    await vi.advanceTimersByTimeAsync(1_000)
    const reason = new Error('user cancelled')
    controller.abort(reason)
    const result = await pending
    expect(result.ok).toBe(false)
    expect((result as {e: unknown}).e).toBe(reason)
    expect(Date.now() - calls[0]!.at).toBe(1_000)
    await vi.runAllTimersAsync()
    expect(calls).toHaveLength(1)
  })

  it('aborts an in-flight GET through the caller signal', async () => {
    const seen: AbortSignal[] = []
    const fetchImpl = vi.fn((_u: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init!.signal!)
      return new Promise<Response>((_, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)))
    }) as unknown as typeof fetch
    const controller = new AbortController()
    const pending = run(fetchRequestObject(URI, {...OPTS, fetchImpl, signal: controller.signal}))
    await vi.advanceTimersByTimeAsync(10)
    const reason = new Error('stop')
    controller.abort(reason)
    const result = await pending
    expect((result as {e: unknown}).e).toBe(reason)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.aborted).toBe(true)
  })

  it('refuses an already-aborted signal before any GET', async () => {
    const {calls, fetchImpl} = transport([jarReply])
    const result = await run(fetchRequestObject(URI, {...OPTS, fetchImpl, signal: AbortSignal.abort(new Error('early'))}))
    expect(msg(result)).toBe('early')
    expect(calls).toHaveLength(0)
  })

  const json = (status: number, body: unknown, headers: Record<string, string> = {'retry-after': '2'}) => () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {status, headers: {'content-type': 'application/json', ...headers}})
  it.each([
    ['401', json(401, {error: REQUEST_OBJECT_IN_PROGRESS}), /HTTP 401/],
    ['403', json(403, {error: REQUEST_OBJECT_IN_PROGRESS}), /HTTP 403/],
    ['the uncertain-outcome 503', json(503, {error: UNCERTAIN}), /HTTP 503: .*uncertain/],
    ['a plain 503', json(503, '', {}), /HTTP 503/],
    ['a 503 with a near-miss marker', json(503, {error: `${REQUEST_OBJECT_IN_PROGRESS}.`}), /HTTP 503/],
    ['a 503 with the marker outside `error`', json(503, {message: REQUEST_OBJECT_IN_PROGRESS}), /HTTP 503/],
    ['a 503 with the marker as plain text', json(503, REQUEST_OBJECT_IN_PROGRESS), /HTTP 503/],
    ['a 500 carrying the marker', json(500, {error: REQUEST_OBJECT_IN_PROGRESS}), /HTTP 500/],
    ['a 500 carrying the capacity marker', json(500, {error: REQUEST_OBJECT_AT_CAPACITY}), /HTTP 500/],
    ['a 403 carrying the capacity marker', json(403, {error: REQUEST_OBJECT_AT_CAPACITY}), /HTTP 403/],
    ['a 503 with a near-miss capacity marker', json(503, {error: REQUEST_OBJECT_AT_CAPACITY.replace('billed', 'charged')}), /HTTP 503/],
    ['an at-capacity 503 reached by redirect', () => withProps(atCapacity(), {redirected: true, url: 'https://elsewhere.example/r'}), /HTTP 503/],
    ['an at-capacity 503 from a changed URI', () => withProps(atCapacity(), {url: 'https://agent.example/v1/request/s2'}), /HTTP 503/],
    ['an oversized at-capacity-looking 503', json(503, {error: REQUEST_OBJECT_AT_CAPACITY, pad: 'x'.repeat(5_000)}), /HTTP 503/],
    ['a 429', json(429, {error: 'slow down'}), /HTTP 429/],
    ['an in-progress 503 reached by redirect', () => withProps(inProgress(), {redirected: true, url: 'https://elsewhere.example/r'}), /HTTP 503/],
    ['an in-progress 503 from a changed URI', () => withProps(inProgress(), {url: 'https://agent.example/v1/request/s2'}), /HTTP 503/],
    ['an oversized in-progress-looking 503', json(503, {error: REQUEST_OBJECT_IN_PROGRESS, pad: 'x'.repeat(5_000)}), /HTTP 503/],
  ])('never retries %s', async (_name, reply, error) => {
    const {calls, fetchImpl} = transport([reply, jarReply])
    const pending = run(fetchRequestObject(URI, {...OPTS, fetchImpl}))
    await vi.runAllTimersAsync()
    const result = await pending
    expect(result.ok).toBe(false)
    expect(msg(result)).toMatch(error)
    expect(calls).toHaveLength(1)
  })

  it('still retries an in-progress 503 whose response URL is the requested one', async () => {
    const {calls, fetchImpl} = transport([() => withProps(inProgress(), {url: URI, redirected: false}), jarReply])
    const pending = run(fetchRequestObject(URI, {...OPTS, fetchImpl}))
    await vi.runAllTimersAsync()
    expect((await pending).ok).toBe(true)
    expect(calls).toHaveLength(2)
  })

  it('never retries a network error', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch
    const pending = run(fetchRequestObject(URI, {...OPTS, fetchImpl}))
    await vi.runAllTimersAsync()
    expect(msg(await pending)).toBe('fetch failed')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it.each([
    [{maxAttempts: 0}], [{maxAttempts: 257}], [{maxAttempts: 1.5}], [{maxTotalMs: -1}], [{maxTotalMs: 300_001}],
    [{minDelayMs: 99}], [{minDelayMs: 5_001}], [{maxDelayMs: 10_001}], [{minDelayMs: 3_000, maxDelayMs: 2_000}], [{notAfterMs: Number.NaN}],
  ])('rejects an out-of-range policy %j before any GET', async policy => {
    const {calls, fetchImpl} = transport([jarReply])
    expect(msg(await run(fetchRequestObject(URI, {...OPTS, fetchImpl, inProgressRetry: policy})))).toMatch(/invalid inProgressRetry\./)
    expect(calls).toHaveLength(0)
  })
})
