// The paid pacer: strict hint parsing, the hint as a floor, the deadline never extended, and the
// transports that surface a limiter's text/plain 429 with its wait headers. Deterministic clock.
import {expect, it} from 'vitest'
import {PaidBackoff, paidResponseWaitMs, paidServerWaitMs, systemPacingClock, PAID_MAX_ATTEMPTS, PAID_MAX_WAIT_MS} from '../../src/chain/paidPacing.js'
import {acceptsServiceResponse, serviceRequestShape} from '../../src/chain/serviceRequestPolicy.js'
import {createBrowserPaidAgentTransport} from '../../src/app/browser.js'
import {PaidBackoffError, isPaidBackoffError, isRetryable} from '../../src/errors.js'

function clock(start = 0) {
  const state = {now: start, overrun: 0, jitter: 0, sleeps: [] as number[]}
  return {state, clock: {now: () => state.now, sleep: async (ms: number) => { state.sleeps.push(ms); state.now += ms + state.overrun }, jitter: () => state.jitter}}
}

it('parses Retry-After and x-ratelimit-after strictly as integer seconds; the longer wins', () => {
  expect(paidServerWaitMs('3')).toBe(3000)
  expect(paidServerWaitMs(undefined, '2')).toBe(2000)
  expect(paidServerWaitMs('1', '4')).toBe(4000)
  expect(paidServerWaitMs('5', '4')).toBe(5000)
  expect(paidServerWaitMs('0')).toBe(0)
  expect(paidServerWaitMs('999999')).toBe(999_999_000)
  expect(paidServerWaitMs()).toBeUndefined()
  expect(paidServerWaitMs(null, null)).toBeUndefined()
  for (const garbage of ['', '-1', '+1', '1.5', ' 1', '1 ', '1s', '9999999', 'Wed, 21 Oct 2015 07:28:00 GMT', '0x10', '1, 2', '١']) {
    expect(paidServerWaitMs(garbage), garbage).toBeUndefined()
    // A garbage value never hides the other, valid header.
    expect(paidServerWaitMs(garbage, '5'), garbage).toBe(5000)
  }
})

it('reads a reply hint from raw headers, or from a whole-second retryAfterMs of a transport without them', () => {
  const body = new Uint8Array()
  expect(paidResponseWaitMs({status: 429, body, rateLimitAfter: '2', retryAfterMs: 9000})).toBe(2000)
  expect(paidResponseWaitMs({status: 429, body, retryAfter: 'Wed, 21 Oct 2015 07:28:00 GMT', retryAfterMs: 4000})).toBeUndefined()
  expect(paidResponseWaitMs({status: 429, body, retryAfterMs: 3000})).toBe(3000)
  for (const ms of [1500, -1000, 1e12, Number.NaN]) expect(paidResponseWaitMs({status: 429, body, retryAfterMs: ms})).toBeUndefined()
  expect(paidResponseWaitMs({status: 429, body})).toBeUndefined()
})

it('waits max(hint, backoff), keeps one attempt budget, and refuses without sleeping past the deadline', async () => {
  const c = clock(), backoff = new PaidBackoff(c.clock, 'GET /v1/test', 10_000, 3_000)
  expect(backoff.readyToSend()).toBe(10_000) // a first attempt needs only time left
  await backoff.wait(429, 2000)
  expect(backoff.readyToSend()).toBe(8_000)
  await backoff.wait(503, undefined)
  expect(c.state.sleeps).toEqual([2000, 1000])
  // 7 s left: a 5 s hint plus the 3 s attempt budget does not fit.
  const error = await backoff.wait(429, 5000).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(PaidBackoffError)
  expect(error).toMatchObject({code: 'deadline_exceeded', route: 'GET /v1/test', httpStatus: 429, retryAfterMs: 5000, remainingMs: 7000, neededMs: 8000, attempts: 3})
  expect(isPaidBackoffError(error) && isRetryable(error)).toBe(true)
  expect(c.state.sleeps).toHaveLength(2)
})

it('never shortens a hint: the ceiling is honoured in full, above it is refused typed', async () => {
  const c = clock(), backoff = new PaidBackoff(c.clock, 'GET /v1/test', 1_000_000, 3_000)
  await backoff.wait(429, PAID_MAX_WAIT_MS)
  expect(c.state.sleeps).toEqual([PAID_MAX_WAIT_MS])
  await expect(backoff.wait(429, PAID_MAX_WAIT_MS + 1000)).rejects.toMatchObject({code: 'server_wait_too_long', retryAfterMs: PAID_MAX_WAIT_MS + 1000})
  expect(c.state.sleeps).toHaveLength(1)
  // Jitter only lengthens, and never into the last attempt's budget.
  c.state.jitter = 10_000
  const tight = new PaidBackoff(c.clock, 'GET /v1/test', c.state.now + 6_000, 3_000)
  await tight.wait(429, 2000)
  expect(c.state.sleeps.at(-1)).toBe(3000) // 2000 + jitter capped at the 1000 ms slack
  expect(tight.readyToSend()).toBe(3000) // exactly one attempt's budget is still left
})

it('catches an overrunning sleep before the next send, and refuses any send past the deadline', async () => {
  const c = clock(), backoff = new PaidBackoff(c.clock, 'GET /v1/test', 10_000, 3_000)
  c.state.overrun = 6_000
  await backoff.wait(429, 2000)
  expect(() => backoff.readyToSend()).toThrow(expect.objectContaining({code: 'no_time_to_send', remainingMs: 2000, neededMs: 3000}))
  const late = new PaidBackoff(c.clock, 'GET /v1/test', c.state.now, 3_000)
  expect(() => late.readyToSend()).toThrow(expect.objectContaining({code: 'no_time_to_send', neededMs: 0}))
})

it('bounds attempts even with an unreachable deadline', async () => {
  const c = clock(), backoff = new PaidBackoff(c.clock, 'GET /v1/test', Number.MAX_SAFE_INTEGER, 3_000)
  let error: unknown
  for (let i = 0; i < PAID_MAX_ATTEMPTS && !error; i++) error = await backoff.wait(429, undefined).catch((e: unknown) => e)
  expect(error).toMatchObject({code: 'attempts_exhausted', attempts: PAID_MAX_ATTEMPTS})
  expect(c.state.sleeps).toHaveLength(PAID_MAX_ATTEMPTS - 1)
  expect(Math.max(...c.state.sleeps)).toBe(8000)
})

it('the system clock sleeps, aborts and jitters within a quarter of the base', async () => {
  expect(Math.abs(systemPacingClock.now() - Date.now())).toBeLessThan(1000)
  await systemPacingClock.sleep(1)
  const controller = new AbortController()
  const sleeping = systemPacingClock.sleep(60_000, controller.signal)
  controller.abort(new Error('stop'))
  await expect(sleeping).rejects.toThrow('stop')
  await expect(systemPacingClock.sleep(1, controller.signal)).rejects.toThrow('stop')
  for (let i = 0; i < 50; i++) { const j = systemPacingClock.jitter(1000); expect(j >= 0 && j <= 250).toBe(true) }
})

it('accepts a paid 429/503 of any media type (the limiter answers text/plain), nothing else', () => {
  const url = 'https://agent.example/v1/sessions/' + 'ab'.repeat(32) + '/execution'
  const shape = serviceRequestShape('paid-agent', url, {maxBytes: 1024, bearer: 'cd'.repeat(32), method: 'GET'})
  for (const status of [429, 503]) for (const type of ['text/plain', '', 'text/html', 'application/json']) expect(acceptsServiceResponse('paid-agent', shape, false, status, type)).toBe(true)
  for (const status of [200, 409, 500]) expect(acceptsServiceResponse('paid-agent', shape, false, status, 'text/plain')).toBe(false)
  const relay = serviceRequestShape('relay', 'https://relay.example/v1/relay/' + '0x' + 'ab'.repeat(32), {maxBytes: 1024})
  expect(acceptsServiceResponse('relay', relay, false, 429, 'text/plain')).toBe(false)
})

it('the browser paid transport surfaces a limiter 429 with its raw wait headers', async () => {
  const response = new Response('Too Many Requests! Wait for 2s', {status: 429, headers: {'content-type': 'text/plain; charset=utf-8', 'x-ratelimit-after': '2', 'retry-after': '1'}})
  const transport = createBrowserPaidAgentTransport({fetch: (async () => response) as typeof globalThis.fetch})
  const reply = await transport.paidAgentRequest('https://agent.example/v1/sessions/' + 'ab'.repeat(32) + '/execution', {method: 'GET', bearer: 'cd'.repeat(32), maxBytes: 1024, signal: new AbortController().signal})
  expect(reply).toMatchObject({status: 429, retryAfter: '1', rateLimitAfter: '2', retryAfterMs: 1000})
  expect(paidResponseWaitMs(reply)).toBe(2000)
})

it('permits ?wait=1 only on the owner session status read', () => {
  const base = 'https://agent.example/v1/sessions/' + 'ab'.repeat(32), bearer = 'cd'.repeat(32)
  expect(serviceRequestShape('paid-agent', base + '?wait=1', {maxBytes: 1024, bearer, method: 'GET'}).method).toBe('GET')
  for (const url of [base + '?wait=1&x=1', base + '?wait=2', base + '/execution?wait=1', 'https://agent.example/v1/request/' + 'ab'.repeat(32) + '?wait=1'])
    expect(() => serviceRequestShape('paid-agent', url, {maxBytes: 1024, bearer, method: 'GET'})).toThrow()
  // Still an owner read: no bearer or a body is refused.
  expect(() => serviceRequestShape('paid-agent', base + '?wait=1', {maxBytes: 1024, method: 'GET'})).toThrow()
  expect(() => serviceRequestShape('paid-agent', base + '?wait=1', {maxBytes: 1024, bearer, method: 'POST', body: new Uint8Array([1])})).toThrow()
})
