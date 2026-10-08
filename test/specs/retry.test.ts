import {afterEach, describe, expect, it, vi} from 'vitest'
import {classifyRefusal, classifyRefusedWrite, classifyRetry, parseRetryAfter, retryDelayMs, retryIdempotent} from '../../src/retry.js'
import {AuthDeniedError, httpError, NodeUnreachableError, TasraHttpError} from '../../src/errors.js'
import {fetchHolderNonce} from '../../src/auth/holderProof.js'
import {createRenewal} from '../../src/auth/verifier.js'

const zero = () => 0, top = () => 0.999
const http = (status: number, retryAfterMs?: number) => new TasraHttpError({status, url: 'https://v.example', retryAfterMs})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Retry-After parsing', () => {
  it('accepts delta-seconds and HTTP-dates, refuses malformed or absurd values', () => {
    const now = Date.parse('2026-10-08T12:00:00Z')
    expect(parseRetryAfter('1', now)).toBe(1000)
    expect(parseRetryAfter(' 120 ', now)).toBe(120_000)
    expect(parseRetryAfter('0', now)).toBe(0)
    expect(parseRetryAfter('Thu, 08 Oct 2026 12:00:30 GMT', now)).toBe(30_000)
    expect(parseRetryAfter('Thu, 08 Oct 2026 11:00:00 GMT', now)).toBe(0)
    for (const bad of [undefined, null, '', '-1', '1.5', '0x10', 'soon', '99999999', '1'.repeat(70), 'Thu, 08 Oct 2027 12:00:00 GMT'])
      expect(parseRetryAfter(bad, now)).toBeUndefined()
  })
  it('records the header on HTTP errors and marks only explicit waits retryable', async () => {
    const err = await httpError(new Response('busy', {status: 422, headers: {'retry-after': '2'}}), 'https://r.example/v1/relay/forward')
    expect(err).toMatchObject({status: 422, retryAfterMs: 2000, retryable: true})
    expect((await httpError(new Response('x', {status: 422}), 'u')).retryable).toBe(false)
    expect((await httpError(new Response('x', {status: 425}), 'u')).retryable).toBe(true)
    const denied = await httpError(new Response('x', {status: 403, headers: {'retry-after': '5'}}), 'u')
    expect(denied).toBeInstanceOf(AuthDeniedError); expect(denied.retryable).toBe(false)
    expect(http(429, -5).retryAfterMs).toBeUndefined()
  })
})

describe('bounded retry schedule', () => {
  it('never waits less than the service asked and adds bounded jitter', () => {
    expect(retryDelayMs(0, 1000, {random: zero})).toBe(1000)
    expect(retryDelayMs(0, 1000, {random: top})).toBe(1199)
    expect(retryDelayMs(0, 30_000, {random: top, maxDelayMs: 60_000, maxTotalWaitMs: 60_000})).toBe(30_999)
  })
  it('stops instead of shortening a long Retry-After or exceeding the total budget', () => {
    expect(retryDelayMs(0, 11_000)).toBeUndefined()
    expect(retryDelayMs(0, 5_000, {maxTotalWaitMs: 4_000})).toBeUndefined()
    expect(retryDelayMs(1, 5_000, {maxTotalWaitMs: 10_000}, 6_000)).toBeUndefined()
    expect(retryDelayMs(3, 1)).toBeUndefined() // default 4 attempts
  })
  it('uses full-jitter exponential backoff without a header', () => {
    expect(retryDelayMs(0, undefined, {random: top})).toBe(249)
    expect(retryDelayMs(2, undefined, {random: top})).toBe(999)
    expect(retryDelayMs(2, undefined, {random: zero})).toBe(0)
  })
  it('refuses invalid policies', () => {
    for (const policy of [{maxAttempts: 0}, {maxAttempts: 11}, {maxDelayMs: 0}, {baseDelayMs: 20_000}, {maxTotalWaitMs: 600_001}])
      expect(() => retryDelayMs(0, undefined, policy)).toThrow(/retry policy/)
  })
  it('classifies refusals, explicit waits and final failures', () => {
    expect(classifyRetry(http(429, 1000))).toEqual({retry: true, retryAfterMs: 1000})
    expect(classifyRetry(http(503))).toEqual({retry: true, retryAfterMs: undefined})
    expect(classifyRetry(http(409)).retry).toBe(false)
    expect(classifyRetry(http(410, 0))).toEqual({retry: true, retryAfterMs: 0})
    expect(classifyRetry(http(400, 1000)).retry).toBe(false)
    expect(classifyRetry(http(502)).retry).toBe(true)
    expect(classifyRetry(new NodeUnreachableError({url: 'u'})).retry).toBe(true)
    expect(classifyRetry(new Error('x')).retry).toBe(false)
    expect(classifyRefusal(http(502)).retry).toBe(false)
    expect(classifyRefusal(http(503)).retry).toBe(true)
    expect(classifyRefusedWrite(http(503, 1000)).retry).toBe(false)
    expect(classifyRefusedWrite(http(429, 1000))).toEqual({retry: true, retryAfterMs: 1000})
  })
})

describe('retryIdempotent', () => {
  it('waits the requested time between identical sends and returns the success', async () => {
    vi.useFakeTimers()
    const work = vi.fn().mockRejectedValueOnce(http(429, 2000)).mockResolvedValueOnce('done')
    const onRetry = vi.fn()
    const result = retryIdempotent(work, {policy: {random: zero}, onRetry})
    await vi.advanceTimersByTimeAsync(1999)
    expect(work).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toBe('done')
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({attempt: 0, delayMs: 2000}))
  })
  it('rethrows the final failure unchanged and never retries non-retryable errors', async () => {
    const final = http(400)
    const work = vi.fn().mockRejectedValue(final)
    await expect(retryIdempotent(work)).rejects.toBe(final)
    expect(work).toHaveBeenCalledTimes(1)
    const busy = http(429, 60_000)
    const busyWork = vi.fn().mockRejectedValue(busy)
    await expect(retryIdempotent(busyWork)).rejects.toBe(busy)
    expect(busyWork).toHaveBeenCalledTimes(1)
  })
  it('honors cancellation during a wait', async () => {
    const controller = new AbortController()
    const pending = retryIdempotent(() => Promise.reject(http(503, 5000)), {signal: controller.signal})
    controller.abort(new Error('cancelled'))
    await expect(pending).rejects.toThrow('cancelled')
  })
  it('stops after maxAttempts', async () => {
    const work = vi.fn().mockRejectedValue(http(503, 0))
    await expect(retryIdempotent(work, {policy: {maxAttempts: 3}})).rejects.toMatchObject({status: 503})
    expect(work).toHaveBeenCalledTimes(3)
  })
})

describe('verifier capacity refusals (SP-11)', () => {
  it('mints a nonce after a 429 + Retry-After with the identical body', async () => {
    const bodies: unknown[] = []
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(init.body)
      return bodies.length === 1 ? new Response('at capacity', {status: 429, headers: {'retry-after': '0'}})
        : Response.json({nonce: 'n', expires_at: 9})
    })
    vi.stubGlobal('fetch', fetch)
    expect(await fetchHolderNonce('https://v.example/', {slotId: '0x01', action: 'sign'})).toEqual({nonce: 'n', expiresAt: 9})
    expect(bodies).toHaveLength(2); expect(bodies[0]).toBe(bodies[1])
  })
  it('does not retry a nonce on a generic 5xx or when retry is disabled', async () => {
    const fetch = vi.fn(async () => new Response('boom', {status: 500}))
    vi.stubGlobal('fetch', fetch)
    await expect(fetchHolderNonce('https://v.example')).rejects.toMatchObject({status: 500})
    expect(fetch).toHaveBeenCalledTimes(1)
    fetch.mockImplementation(async () => new Response('x', {status: 429, headers: {'retry-after': '0'}}))
    await expect(fetchHolderNonce('https://v.example', {retry: false})).rejects.toMatchObject({status: 429})
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('retries renewal creation only on a 429 capacity refusal, never after a possibly processed failure', async () => {
    const fetch = vi.fn(async () => new Response('x', {status: 429, headers: {'retry-after': '0'}}))
    vi.stubGlobal('fetch', fetch)
    fetch.mockImplementationOnce(async () => new Response('x', {status: 429, headers: {'retry-after': '0'}}))
      .mockImplementationOnce(async () => Response.json({renewal_token: 't', holder: 'h', expires_at: 1, scopes: []}))
    expect((await createRenewal('https://v.example', {dcql_rule: 'any', presentation: {}})).renewalToken).toBe('t')
    expect(fetch).toHaveBeenCalledTimes(2)
    fetch.mockReset(); fetch.mockImplementation(async () => new Response('x', {status: 503, headers: {'retry-after': '0'}}))
    await expect(createRenewal('https://v.example', {dcql_rule: 'any', presentation: {}})).rejects.toMatchObject({status: 503})
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('retry argument guards', () => {
  it('refuses invalid random sources, attempt state and Retry-After values', () => {
    expect(() => retryDelayMs(0, undefined, {random: 5 as unknown as () => number})).toThrow(/random/)
    expect(() => retryDelayMs(-1, undefined)).toThrow(/state/)
    expect(() => retryDelayMs(0, undefined, {}, -5)).toThrow(/state/)
    expect(() => retryDelayMs(0, 1.5)).toThrow(/Retry-After/)
    expect(retryDelayMs(0, undefined, {random: top, baseDelayMs: 5000, maxTotalWaitMs: 100})).toBeUndefined()
  })
  it('validates the policy before the first send', async () => {
    const work = vi.fn(async () => 1)
    await expect(retryIdempotent(work, {policy: {maxAttempts: 99}})).rejects.toThrow(/retry policy/)
    expect(work).not.toHaveBeenCalled()
  })
})
