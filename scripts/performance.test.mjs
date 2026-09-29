import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {compareRuns, exportBaseline, renderReport, validateRun} from './performance.mjs'

function run(scale = 1) {
  return {schemaVersion: 1, protocolHash: 'protocol', sourceHash: 'source', lockHash: 'lock', environment: {node: 'v24', v8: 'v8', platform: 'linux', arch: 'arm64', osRelease: 'release', cpu: 'cpu', cpuCount: 4}, measurements: ['encrypt-1KiB', 'decrypt-1KiB', 'serialize-roundtrip-1KiB', 'assemble-3-shards'].map(name => ({name, iterations: 8, millisecondsPerOperation: [10, 10, 10, 10, 10, 10, 100].map(n => n * scale)}))}
}

test('detects a reproducible slowdown despite an outlier, without asserting a cause', () => {
  const comparison = compareRuns(run(), run(1.4))
  assert.equal(comparison.status, 'warning')
  assert.ok(comparison.comparisons.every(value => value.warning && value.baselineMedian === 10 && value.candidateMedian === 14))
  assert.match(renderReport({comparison}), /investigate/)
})

test('ordinary timing noise is report-only and source/dependency changes remain comparable', () => {
  const candidate = {...run(1.05), sourceHash: 'changed', lockHash: 'changed'}
  assert.equal(compareRuns(run(), candidate).status, 'no-warning')
  assert.equal(compareRuns(run(), run(0.5)).status, 'no-warning')
})

test('runtime, platform, CPU, workload or protocol mismatch cannot produce a green verdict', () => {
  for (const key of Object.keys(run().environment)) {
    const candidate = run()
    candidate.environment[key] = 'different'
    assert.equal(compareRuns(run(), candidate).status, 'incompatible')
  }
  assert.equal(compareRuns(run(), {...run(), protocolHash: 'new'}).status, 'incompatible')
  const candidate = run()
  candidate.measurements[0].iterations++
  assert.equal(compareRuns(run(), candidate).status, 'incompatible')
})

test('empty, corrupt, duplicate, nonfinite and zero measurements fail instead of passing', () => {
  for (const value of [null, {}, {...run(), measurements: []}, {...run(), measurements: Array(4).fill(run().measurements[0])}]) assert.throws(() => validateRun(value))
  for (const value of [0, -1, NaN, Infinity, '10']) {
    const candidate = run()
    candidate.measurements[0].millisecondsPerOperation[0] = value
    assert.throws(() => compareRuns(run(), candidate), /Invalid measurements/)
  }
  const candidate = run()
  candidate.measurements[0].millisecondsPerOperation.pop()
  assert.throws(() => validateRun(candidate))
  assert.throws(() => compareRuns(run(), run(), 0), /threshold/)
})


test('commit baseline exports only SDK source and metadata without mutating checkout', t => {
  const folder = mkdtempSync(join(tmpdir(), 'performance-git-test-'))
  t.after(() => rmSync(folder, {recursive: true, force: true}))
  const repository = join(folder, 'repository')
  mkdirSync(join(repository, 'src/crypto'), {recursive: true})
  writeFileSync(join(repository, 'src/crypto/kem.ts'), 'export const fixture = true\n')
  writeFileSync(join(repository, 'package.json'), '{"type":"module"}')
  writeFileSync(join(repository, 'package-lock.json'), '{}')
  writeFileSync(join(repository, 'unrelated.txt'), 'must not be copied')
  const git = args => execFileSync('git', args, {cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']})
  git(['init'])
  git(['add', '.'])
  git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'])
  const before = git(['status', '--porcelain'])
  const exported = join(folder, 'exported')
  const commit = exportBaseline('HEAD', exported, repository)
  assert.match(commit, /^[a-f0-9]{40}$/)
  assert.equal(readFileSync(join(exported, 'src/crypto/kem.ts'), 'utf8'), 'export const fixture = true\n')
  assert.equal(existsSync(join(exported, 'unrelated.txt')), false)
  assert.equal(existsSync(join(exported, '.git')), false)
  assert.equal(git(['status', '--porcelain']), before)
  assert.throws(() => exportBaseline('--help', join(folder, 'bad'), repository), /failed/)
  assert.throws(() => exportBaseline('missing-commit', join(folder, 'bad'), repository), /failed/)
})
