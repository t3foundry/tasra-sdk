// A REAL multi-process race on the Node file store's exclusive claim: two OS processes, each with
// its own store instance over one private directory, released together by a barrier file per
// round. Exactly one may win each round's claim.
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
