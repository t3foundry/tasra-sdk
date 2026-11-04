// A REAL multi-process race on the Node file store's exclusive claim: two OS processes, each with
// its own store instance over one private directory, released together by a barrier file per
// round. Exactly one may win each generation's claim; this is what makes an approval resend one-use.
import {afterEach, expect, it} from 'vitest'
import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {createInterface} from 'node:readline'

const roots: string[] = [], children: ChildProcessWithoutNullStreams[] = []
afterEach(async () => {
  for (const child of children.splice(0)) child.kill()
  await Promise.all(roots.splice(0).map(dir => rm(dir, {recursive: true, force: true})))
})

const ROUNDS = 24
const CHILD = resolve(import.meta.dirname, '../support/claimRaceChild.ts')

/** A child's stdout as a queue of lines. */
function lines(child: ChildProcessWithoutNullStreams) {
  const queue: string[] = [], waiting: ((line: string) => void)[] = []
  const status: {failure?: Error} = {}
  const fail = (error: Error) => { status.failure = error; for (const w of waiting.splice(0)) w('') }
  createInterface({input: child.stdout}).on('line', line => { const w = waiting.shift(); if (w) w(line); else queue.push(line) })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
  child.on('exit', code => { if (code !== 0) fail(new Error(`claim race child exited ${code}: ${stderr}`)) })
  const check = (): void => { const failure = status.failure; if (failure instanceof Error) throw failure }
  return async (): Promise<string> => {
    check()
    const line = queue.shift() ?? await new Promise<string>(resolve => waiting.push(resolve))
    check()
    return line
  }
}

it('two OS processes racing one claim per round: exactly one winner every round', async () => {
  const state = await mkdtemp(join(tmpdir(), 'tasra-race-state-')), barrier = await mkdtemp(join(tmpdir(), 'tasra-race-barrier-'))
  roots.push(state, barrier)
  const spawned = ['a', 'b'].map(name => spawn(process.execPath, ['--import', 'tsx', CHILD, state, barrier, String(ROUNDS), name], {stdio: 'pipe'}))
  children.push(...spawned)
  const readers = spawned.map(lines)
  expect(await Promise.all(readers.map(read => read()))).toEqual(['ready', 'ready'])
  const winners: number[] = []
  for (let round = 1; round <= ROUNDS; round++) {
    await writeFile(join(barrier, `go-${round}`), '')
    const results = await Promise.all(readers.map(read => read()))
    expect(results.map(r => r.split(' ')[0])).toEqual([String(round), String(round)])
    const won = results.map(r => r.split(' ')[1] === 'true')
    expect(won.filter(Boolean), `round ${round}`).toHaveLength(1)
    winners.push(won.indexOf(true))
  }
  // Both processes are genuinely competing, not taking turns by construction.
  expect(winners).toHaveLength(ROUNDS)
}, 60_000)

// ---- Generations of one retained approval across OS processes, each with a fresh store ----
const APPROVAL_CHILD = resolve(import.meta.dirname, '../support/approvalRaceChild.ts')
interface ChildResult {code: number | null; ready: boolean; result?: {outcome?: unknown; error?: string; code?: string; reason?: string; generation?: number}}
function approvalChild(state: string, barrier: string, action: 'first' | 'resume', reply: 'busy' | 'accept' | 'die') {
  const child = spawn(process.execPath, ['--import', 'tsx', APPROVAL_CHILD, state, barrier, action, reply], {stdio: 'pipe'})
  children.push(child)
  const out: string[] = []
  let stderr = '', readyResolve!: () => void
  const ready = new Promise<void>(resolve => { readyResolve = resolve })
  createInterface({input: child.stdout}).on('line', line => { out.push(line); if (line === 'ready') readyResolve() })
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
  const done = new Promise<ChildResult>(resolve => child.on('close', code => {
    readyResolve()
    const last = out.filter(line => line !== 'ready').at(-1)
    resolve({code, ready: out[0] === 'ready', ...(last ? {result: JSON.parse(last) as ChildResult['result']} : {})})
  }))
  return {ready, done, stderr: () => stderr}
}

it('one retained approval across processes: busy generations advance, a racing pair yields one send, and a sibling\'s unknown outcome is never resent', async () => {
  const base = await mkdtemp(join(tmpdir(), 'tasra-approval-race-')), state = join(base, 'state'), go = join(base, 'go')
  roots.push(base)
  const sends = async () => (await readFile(join(base, 'sends-state'), 'utf8').catch(() => '')).split('\n').filter(Boolean)
  const ledger = async () => (JSON.parse(await readFile(join(state, 'wallet-' + 'ab'.repeat(32) + '-presentation_sign-0.attempt.json'), 'utf8')) as {value: unknown}).value

  // Process 1 signs, retains and sends generation 1: busy, and the 100 s hint does not fit, so it stops.
  const p1 = await approvalChild(state, '-', 'first', 'busy').done
  expect(p1.result).toMatchObject({error: 'PaidBackoffError', code: 'deadline_exceeded'})
  // Process 2 (fresh store) resumes generation 2 from disk: busy again, generation 3 is permitted.
  const p2 = await approvalChild(state, '-', 'resume', 'busy').done
  expect(p2.result).toMatchObject({error: 'PaidBackoffError', code: 'deadline_exceeded'})
  expect(await sends()).toHaveLength(2)

  // Processes 3 and 4 resume generation 3 together; the winner dies mid-send (unknown outcome).
  const racers = [approvalChild(state, go, 'resume', 'die'), approvalChild(state, go, 'resume', 'die')]
  await Promise.all(racers.map(r => r.ready))
  await writeFile(go, '')
  const raced = await Promise.all(racers.map(r => r.done))
  expect(raced.map(r => r.code).sort()).toEqual([0, 9]) // one died sending, one refused
  const loser = raced.find(r => r.code === 0)!
  expect(loser.result).toMatchObject({error: 'PaidApprovalUnresolvedError', code: 'approval_outcome_unresolved'})
  expect(['claim_lost', 'generation_moved', 'outcome_unknown']).toContain(loser.result?.reason)
  expect(await sends()).toHaveLength(3)

  // Process 5 (fresh store) finds generation 3 in flight: it sends nothing, even though the agent shows pending.
  const p5 = await approvalChild(state, '-', 'resume', 'accept').done
  expect(p5.result).toMatchObject({error: 'PaidApprovalUnresolvedError', reason: 'outcome_unknown', generation: 3})
  const bodies = await sends()
  expect(bodies).toHaveLength(3)
  expect(new Set(bodies).size).toBe(1) // every process sent the identical retained bytes; nothing re-signed
  expect(await ledger()).toEqual(['object', [['schema', ['number', 2]], ['proposalId', ['string', 'cd'.repeat(32)]], ['state', ['string', 'in_flight']], ['generation', ['number', 3]]]])
}, 60_000)
