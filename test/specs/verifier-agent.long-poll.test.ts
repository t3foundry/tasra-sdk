// waitForSession against a long-poll (`?wait=1`) verifier-agent and an old one that ignores it.
// Time is a fake clock, so "no sleep" and "no hot loop" are exact request times and counts.
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {VerifierAgentSessionError, waitForSession, type SessionPhase} from '../../src/verifier-agent/index.js'

const BASE = 'http://agent.example'
const token = {token_type: 'JWT', seed: `0x${'01'.repeat(32)}`, epoch: 4, slot_id: `0x${'02'.repeat(32)}`, vp_hash: `0x${'03'.repeat(32)}`,
  holder_hash: `0x${'04'.repeat(32)}`, rule_hash: `0x${'05'.repeat(32)}`, request_hash: `0x${'06'.repeat(32)}`, binding: 'holder_key',
  verifier_indexes: [0, 1], iat: 1, exp: 2, signatures: [{verifier_index: 0, signature: '0x00'}]}

/** `[at ms, phase]` steps; the session is in the last step whose time has passed. */
type Timeline = Array<[number, SessionPhase]>
const phaseAt = (timeline: Timeline, now: number): SessionPhase => timeline.filter(([at]) => at <= now).at(-1)![1]
const body = (phase: SessionPhase) => phase === 'done'
  ? {status: 'done', phase, compound_token: token}
  : phase === 'failed' ? {status: 'failed', phase, error: 'refused'} : {status: 'pending', phase}

/** A fake verifier-agent. `longPoll` servers hold a `?wait=1` request until the phase differs
 *  from its request-time value or 20 s pass; old servers answer at once; `always` holds every
 *  request (a slow reply), whatever it asks. Honours `signal`. */
function server(timeline: Timeline, longPoll: boolean | 'always') {
  const requests: Array<{at: number; url: string}> = []
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const start = Date.now()
    requests.push({at: start, url})
    const signal = init?.signal ?? undefined
    const hold = longPoll === 'always' || (longPoll && url.endsWith('?wait=1'))
    const initial = phaseAt(timeline, start)
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearInterval(tick); reject(new DOMException('aborted', 'AbortError')) }
      const tick = setInterval(() => {
        if (!hold || phaseAt(timeline, Date.now()) !== initial || Date.now() - start >= 20_000) {
          clearInterval(tick); signal?.removeEventListener('abort', abort); resolve()
        }
      }, 50)
      if (!hold || initial === 'done' || initial === 'failed') { clearInterval(tick); resolve(); return }
      signal?.addEventListener('abort', abort, {once: true})
    })
    return new Response(JSON.stringify(body(phaseAt(timeline, Date.now()))), {status: 200})
  })
  vi.stubGlobal('fetch', fetchImpl)
  return requests
}

const wait = (opts: Parameters<typeof waitForSession>[5] = {}, timeoutMs = 120_000) =>
  waitForSession(BASE, 's1', 'secret', 2000, timeoutMs, {random: () => 0.5, ...opts})

beforeEach(() => { vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']}); vi.setSystemTime(0) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('waitForSession long poll', () => {
  it('long-poll server: each change is observed the moment it happens, with no sleep', async () => {
    const requests = server([[0, 'awaiting_wallet'], [3000, 'verifying'], [4000, 'done']], true)
    let doneAt = -1
    const result = wait().then(r => { doneAt = Date.now(); return r })
    await vi.advanceTimersByTimeAsync(5000)
    expect((await result).status).toBe('done')
    expect(requests.every(r => r.url === `${BASE}/v1/sessions/s1?wait=1`)).toBe(true)
    expect(requests.map(r => r.at)).toEqual([0, 3000])
    expect(doneAt).toBe(4000)
  })

  it('long-poll server: an unchanged reply after the 20 s hold is re-polled at once (within a small jitter)', async () => {
    const requests = server([[0, 'awaiting_wallet'], [45_000, 'done']], true)
    const result = wait()
    await vi.advanceTimersByTimeAsync(46_000)
    expect((await result).status).toBe('done')
    // random = 0.5: 0.5 x 10 % of the 2000 ms base = 100 ms, never the backoff.
    expect(requests.map(r => r.at)).toEqual([0, 20_100, 40_200])
  })

  it('old server ignoring wait: the backoff still applies and there is no hot loop', async () => {
    const requests = server([[0, 'awaiting_wallet']], false)
    const result = wait({}, 60_000).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(61_000)
    const err = await result
    expect(err).toBeInstanceOf(VerifierAgentSessionError)
    expect((err as VerifierAgentSessionError).kind).toBe('timeout')
    // 2000 x1.5 to the 8000 cap: one request per backoff step, no extra ones.
    expect(requests.map(r => r.at)).toEqual([0, 2000, 5000, 9500, 16_250, 24_250, 32_250, 40_250, 48_250, 56_250])
  })

  it('old server: a phase change resets the delay to the base interval', async () => {
    const requests = server([[0, 'awaiting_wallet'], [20_000, 'verifying'], [26_000, 'done']], false)
    let doneAt = -1
    const result = wait().then(r => { doneAt = Date.now(); return r })
    await vi.advanceTimersByTimeAsync(40_000)
    expect((await result).status).toBe('done')
    // verifying is seen at 24250: one immediate re-poll, then the BASE 2000 ms, not the grown 8000.
    expect(requests.map(r => r.at)).toEqual([0, 2000, 5000, 9500, 16_250, 24_250, 24_250, 26_250])
    expect(doneAt).toBe(26_250)
  })

  it('abort cancels an in-flight long poll promptly', async () => {
    server([[0, 'awaiting_wallet']], 'always')
    const controller = new AbortController()
    let settledAt = -1
    const result = wait({signal: controller.signal}).catch((e: unknown) => { settledAt = Date.now(); return e })
    await vi.advanceTimersByTimeAsync(1000)
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    const err = await result
    expect(err).toBeInstanceOf(VerifierAgentSessionError)
    expect((err as VerifierAgentSessionError).kind).toBe('cancelled')
    expect(settledAt).toBe(1000)
  })

  it('abort cancels a backoff sleep promptly', async () => {
    server([[0, 'awaiting_wallet']], false)
    const controller = new AbortController()
    let settledAt = -1
    const result = wait({signal: controller.signal}).catch((e: unknown) => { settledAt = Date.now(); return e })
    await vi.advanceTimersByTimeAsync(500)
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(((await result) as VerifierAgentSessionError).kind).toBe('cancelled')
    expect(settledAt).toBe(500)
  })
})

describe('waitForSession at volume', () => {
  /** Old-server replies per session id: pending until the session's `doneAfter`-th request. */
  function fleet(doneAfter: (id: string) => number) {
    const requests = new Map<string, number[]>()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const id = /sessions\/([^?]+)/.exec(url)![1]!
      const seen = requests.get(id) ?? []
      seen.push(Date.now()); requests.set(id, seen)
      return new Response(JSON.stringify(body(seen.length >= doneAfter(id) ? 'done' : 'awaiting_wallet')), {status: 200})
    }))
    return requests
  }

  it('1000 concurrent waits all complete, do not poll in lock-step and leave no timers behind', async () => {
    const requests = fleet(() => 3)
    const waits = Array.from({length: 1000}, (_, i) => waitForSession(BASE, `s${i}`, 'secret', 2000, 120_000))
    await vi.advanceTimersByTimeAsync(10_000)
    const results = await Promise.all(waits)
    expect(results.every(r => r.status === 'done')).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    // Default jitter spreads the second request of sessions that started together over ±20 %.
    const second = [...requests.values()].map(times => times[1]!)
    expect(Math.min(...second)).toBeGreaterThanOrEqual(1600)
    expect(Math.max(...second)).toBeLessThanOrEqual(2400)
    expect(new Set(second).size).toBeGreaterThan(400)
    expect(Math.max(...second) - Math.min(...second)).toBeGreaterThan(600)
  }, 60_000)

  it('1000 concurrent waits aborted mid-request or mid-sleep leave no timers or listeners behind', async () => {
    server([[0, 'awaiting_wallet']], 'always')
    const held = Array.from({length: 500}, () => new AbortController())
    const sleeping = Array.from({length: 500}, () => new AbortController())
    const heldWaits = held.map((c, i) => waitForSession(BASE, `h${i}`, 'secret', 2000, 120_000, {signal: c.signal}).catch((e: unknown) => e))
    await vi.advanceTimersByTimeAsync(1000)
    vi.unstubAllGlobals()
    fleet(() => Infinity)
    const sleepWaits = sleeping.map((c, i) => waitForSession(BASE, `z${i}`, 'secret', 2000, 120_000, {signal: c.signal}).catch((e: unknown) => e))
    await vi.advanceTimersByTimeAsync(100)
    for (const c of [...held, ...sleeping]) c.abort()
    await vi.advanceTimersByTimeAsync(0)
    const errors = await Promise.all([...heldWaits, ...sleepWaits])
    expect(errors.every(e => e instanceof VerifierAgentSessionError && e.kind === 'cancelled')).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  }, 60_000)
})
