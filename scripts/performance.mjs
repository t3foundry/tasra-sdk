import {createHash} from 'node:crypto'
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {cpus, platform, arch, release, tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const digest = value => createHash('sha256').update(value).digest('hex')
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const expectedNames = ['encrypt-1KiB', 'decrypt-1KiB', 'serialize-roundtrip-1KiB', 'assemble-3-shards']

export function validateRun(run) {
  if (run?.schemaVersion !== 1 || !run.environment || !run.protocolHash || !run.sourceHash || !run.lockHash || !Array.isArray(run.measurements)) throw new Error('Invalid performance run metadata')
  for (const key of ['node', 'v8', 'platform', 'arch', 'osRelease', 'cpu', 'cpuCount']) {
    if (!run.environment[key]) throw new Error(`Missing environment ${key}`)
  }
  if (run.measurements.length !== expectedNames.length || new Set(run.measurements.map(m => m.name)).size !== expectedNames.length) throw new Error('Missing or duplicate measurements')
  for (const name of expectedNames) {
    const value = run.measurements.find(m => m.name === name)
    if (!value || !Number.isSafeInteger(value.iterations) || value.iterations < 1 || value.millisecondsPerOperation?.length !== 7 || !value.millisecondsPerOperation.every(n => Number.isFinite(n) && n > 0)) throw new Error(`Invalid measurements: ${name}`)
  }
  return run
}

export function compareRuns(baseline, candidate, threshold = 0.20) {
  validateRun(baseline)
  validateRun(candidate)
  if (!Number.isFinite(threshold) || threshold <= 0) throw new Error('Invalid regression threshold')
  const incompatible = []
  if (baseline.protocolHash !== candidate.protocolHash) incompatible.push('benchmark protocol')
  for (const key of Object.keys(baseline.environment)) if (baseline.environment[key] !== candidate.environment[key]) incompatible.push(`environment.${key}`)
  for (const measurement of baseline.measurements) if (measurement.iterations !== candidate.measurements.find(m => m.name === measurement.name).iterations) incompatible.push(`workload.${measurement.name}`)
  if (incompatible.length) return {status: 'incompatible', incompatible, comparisons: []}
  const comparisons = candidate.measurements.map(current => {
    const previous = baseline.measurements.find(m => m.name === current.name)
    const baselineMedian = median(previous.millisecondsPerOperation)
    const candidateMedian = median(current.millisecondsPerOperation)
    const change = candidateMedian / baselineMedian - 1
    const spread = (Math.max(...current.millisecondsPerOperation) - Math.min(...current.millisecondsPerOperation)) / candidateMedian
    return {name: current.name, baselineMedian, candidateMedian, change, spread, warning: change > threshold}
  })
  return {status: comparisons.some(item => item.warning) ? 'warning' : 'no-warning', threshold, comparisons}
}

function sourceHash(directory) {
  const files = readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))
  return digest(files.map(file => `${file.name}:${file.isDirectory() ? sourceHash(join(directory, file.name)) : digest(readFileSync(join(directory, file.name)))}`).join('\n'))
}

export function renderReport(report) {
  const result = report.comparison
  return `# Offline performance evidence\n\nStatus: **${result.status}**. Timing warnings are investigative signals, not merge failures or proof of performance.\n\n` +
    `Candidate: ${report.candidatePath}\nBaseline: ${report.baselinePath}\n\n` +
    (report.dependencyPolicy ? `Dependency policy: ${report.dependencyPolicy}\n\n` : '') +
    (result.error ? `Failure: ${result.error}\nNo regression verdict.\n` : '') +
    (result.incompatible ? `Incompatible: ${result.incompatible.join(', ')}. No regression verdict.\n` : '') +
    (result.status === 'baseline-recorded' ? 'Explicit baseline recorded. No comparison was performed.\n' : '') +
    (result.status === 'needs-baseline' ? 'No baseline exists. Record one explicitly on the revision you want to compare against.\n' : '') +
    (result.comparisons?.length ? '| Workload | Baseline ms/op | Candidate ms/op | Change | Candidate range / median | Signal |\n|---|---:|---:|---:|---:|---|\n' + result.comparisons.map(item => `| ${item.name} | ${item.baselineMedian.toFixed(4)} | ${item.candidateMedian.toFixed(4)} | ${(item.change * 100).toFixed(1)}% | ${(item.spread * 100).toFixed(1)}% | ${item.warning ? 'investigate' : 'no warning'} |`).join('\n') + '\n' : '') +
    '\nSeven measured batches after two warmup batches; every result asserted. No network, transaction, memory-leak, RPC-count or fleet-latency coverage. Compare on an idle machine; rerun warnings before diagnosing.\n'
}

function git(args, cwd = root) {
  const child = spawnSync('git', args, {cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024})
  if (child.error || child.status !== 0) throw new Error(`Baseline git operation failed: ${child.error?.message || child.stderr}`)
  return child.stdout
}

export function exportBaseline(ref, destination, repository = root) {
  const commit = git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], repository).trim()
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('Invalid resolved baseline commit')
  const files = git(['ls-tree', '-r', '--name-only', commit, '--', 'src', 'package.json', 'package-lock.json'], repository).trim().split('\n')
  for (const file of files) {
    if ((!file.startsWith('src/') && !['package.json', 'package-lock.json'].includes(file)) || file.split('/').some(part => part === '..')) throw new Error('Unsafe baseline path')
    const output = join(destination, file)
    mkdirSync(dirname(output), {recursive: true})
    writeFileSync(output, git(['show', `${commit}:${file}`], repository))
  }
  if (!existsSync(join(destination, 'src/crypto/kem.ts')) || !existsSync(join(destination, 'package-lock.json'))) throw new Error('Baseline lacks the required crypto source or lockfile')
  return commit
}

function writeReport(directory, report) {
  mkdirSync(directory, {recursive: true})
  writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  writeFileSync(join(directory, 'report.md'), renderReport(report))
}

function measure(directory, workload, environment, dependencyPolicy) {
  const metadata = () => ({sourceHash: sourceHash(join(directory, 'src')), lockHash: digest(readFileSync(join(directory, 'package-lock.json'))), protocolHash: digest(readFileSync(workload)), installedDependenciesHash: digest(readFileSync(join(root, 'node_modules/.package-lock.json')))})
  const before = metadata()
  const child = spawnSync(process.execPath, ['--import', 'tsx', workload], {cwd: directory, encoding: 'utf8', timeout: 120_000, maxBuffer: 2 * 1024 * 1024})
  if (child.error || child.status !== 0) throw new Error(`Benchmark failed: ${child.error?.message || child.stderr || `exit ${child.status}`}`)
  if (JSON.stringify(before) !== JSON.stringify(metadata())) throw new Error('Benchmark inputs changed while measuring; retry on stable source')
  const {measurements, correctness} = JSON.parse(child.stdout)
  return validateRun({schemaVersion: 1, recordedAt: new Date().toISOString(), environment, ...before, measurements, correctness, dependencyPolicy})
}

export function main(args = process.argv.slice(2)) {
  let baselinePath = join(root, '.verification/performance/baseline.json')
  let baselineRef = process.env.PERFORMANCE_BASE || ''
  let record = false
  let baselineExplicit = false
  const directory = join(root, '.verification/performance')
  writeReport(directory, {comparison: {status: 'running'}})
  let temporary
  try {
    for (let index = 0; index < args.length; index++) {
      if (args[index] === '--record-baseline') record = true
      else if (args[index] === '--baseline' && args[index + 1] && !args[index + 1].startsWith('--')) { baselinePath = resolve(args[++index]); baselineExplicit = true }
      else if (args[index] === '--baseline-ref' && args[index + 1] && !args[index + 1].startsWith('--')) baselineRef = args[++index]
      else throw new Error(`Unknown or incomplete argument: ${args[index]}`)
    }
    if (baselineRef && (record || baselineExplicit)) throw new Error('--baseline-ref/PERFORMANCE_BASE cannot be combined with --baseline or --record-baseline')
    const workload = join(root, 'test/performance/crypto.ts')
    const environment = {node: process.version, v8: process.versions.v8, platform: platform(), arch: arch(), osRelease: release(), cpu: cpus()[0]?.model || 'unknown', cpuCount: cpus().length}
    const dependencyPolicy = baselineRef ? 'same-run source comparison using candidate-installed dependencies for BOTH revisions; dependency-change performance is UNVERIFIED' : 'each recorded revision uses its installed dependencies; lock and installed-dependency hashes recorded'
    let baseline
    if (baselineRef) {
      temporary = mkdtempSync(join(tmpdir(), 'tasra-performance-baseline-'))
      const commit = exportBaseline(baselineRef, temporary)
      mkdirSync(join(temporary, 'test/performance'), {recursive: true})
      writeFileSync(join(temporary, 'test/performance/crypto.ts'), readFileSync(workload))
      symlinkSync(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir')
      baseline = {...measure(temporary, join(temporary, 'test/performance/crypto.ts'), environment, dependencyPolicy), commit}
      baselinePath = join(directory, `baseline-${commit}-${baseline.recordedAt.replaceAll(':', '-')}.json`)
      writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n')
    }
    const candidate = measure(root, workload, environment, dependencyPolicy)
    const candidatePath = join(directory, `run-${candidate.recordedAt.replaceAll(':', '-')}.json`)
    writeFileSync(candidatePath, JSON.stringify(candidate, null, 2) + '\n')
    let comparison
    if (record) {
      mkdirSync(dirname(baselinePath), {recursive: true})
      writeFileSync(baselinePath, JSON.stringify(candidate, null, 2) + '\n')
      comparison = {status: 'baseline-recorded'}
    } else if (!existsSync(baselinePath)) comparison = {status: 'needs-baseline'}
    else {
      baseline ??= JSON.parse(readFileSync(baselinePath, 'utf8'))
      if (baselineRef && baseline.installedDependenciesHash !== candidate.installedDependenciesHash) throw new Error('Installed dependencies changed between baseline and candidate')
      comparison = compareRuns(baseline, candidate)
    }
    const report = {candidatePath, baselinePath, dependencyPolicy, comparison}
    writeReport(directory, report)
    console.log(renderReport(report))
    if (['incompatible', 'needs-baseline'].includes(comparison.status)) process.exitCode = 2
    return report
  } catch (error) {
    writeReport(directory, {comparison: {status: 'failed', error: error.message}})
    throw error
  } finally {
    if (temporary) rmSync(temporary, {recursive: true, force: true})
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
