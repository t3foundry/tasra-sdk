import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFileSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {acquireLock, execute, fingerprint} from './verify-lib.mjs'
import {hash} from './api-surface.mjs'
import {writeDiagnosis} from './verification-diagnosis.mjs'

export function selectChecks(paths) {
  const shared = /^(package(?:-lock)?\.json|tsconfig.*\.json|scripts\/quality\.mjs)$/
  return [
    ['test:security', p => shared.test(p) || /^(src\/|test\/specs\/security\.|vitest\.security\.)/.test(p)],
    ['test:mutation', p => shared.test(p) || /^(src\/auth\/|test\/specs\/security\.|stryker\.|vitest\.security\.)/.test(p)],
    ['performance', p => shared.test(p) || /^(src\/(?:crypto|committee|signing|app)\/|test\/performance\/|scripts\/performance)/.test(p)],
  ].filter(([, matches]) => paths.some(matches)).map(([id]) => id)
}
export function snapshot(root) {
  const paths = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {cwd: root}).toString().split('\0').filter(Boolean)
  return Object.fromEntries([...new Set(paths)].sort().map(p => [p, existsSync(join(root, p)) ? hash(readFileSync(join(root, p))) : 'deleted']))
}
export function changedPaths(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(p => before[p] !== after[p]).sort()
}
export async function main(args = process.argv.slice(2), root = resolve(import.meta.dirname, '..')) {
  if (args.length > 1 || args.length && !['--all', '--changed'].includes(args[0])) throw new Error('Usage: npm run quality -- [--changed | --all]')
  const directory = join(root, '.verification/quality')
  mkdirSync(directory, {recursive: true, mode: 0o700})
  const unlock = acquireLock(directory), controller = new AbortController()
  const cancel = () => controller.abort()
  process.once('SIGTERM', cancel); process.once('SIGINT', cancel)
  const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 6)
  const runDirectory = join(directory, runId); mkdirSync(runDirectory)
  const report = {schemaVersion: 1, runId, status: 'running', sourceBefore: fingerprint(root), stages: [], startedAt: new Date().toISOString(), scope: 'Offline security properties, scoped mutations and performance observations. No live fleet acceptance or AI approval.'}
  const save = () => {
    const value = JSON.stringify(report, null, 2) + '\n'
    writeFileSync(join(runDirectory, 'report.json'), value)
    writeFileSync(join(directory, 'report.json'), value)
  }
  try {
    save()
    const current = snapshot(root)
    const previous = existsSync(join(directory, 'state.json')) ? JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8')).inputs : {}
    let paths = changedPaths(previous, current)
    // CI supplies a data-only Git ref, never interpolated into a shell command.
    const base = process.env.QUALITY_BASE
    if (base && !/^0+$/.test(base)) {
      const commit = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`], {cwd: root, encoding: 'utf8'}).trim()
      paths = execFileSync('git', ['diff', '--name-only', '-z', commit, '--'], {cwd: root}).toString().split('\0').filter(Boolean)
      paths.push(...execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {cwd: root}).toString().split('\0').filter(Boolean))
      report.base = commit
    }
    report.changedPaths = [...new Set(paths)]
    const selected = args[0] === '--all' ? ['test:security', 'test:mutation', 'performance'] : selectChecks(paths)
    if (!selected.length) { report.status = 'not-needed'; report.reason = 'No relevant changes; no checks executed.' }
    else {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
      for (const id of selected) if (!pkg.scripts[id]) throw new Error(`Missing quality command: ${id}`)
      const npm = process.env.npm_execpath
      const outcome = await execute(selected.map(id => ({id, command: npm ? process.execPath : 'npm', args: [...(npm ? [npm] : []), 'run', id], timeoutMs: id === 'test:mutation' ? 900_000 : 300_000})), {cwd: root, directory: runDirectory, signal: controller.signal, output: process.stdout})
      report.stages = outcome.results
      report.status = outcome.status
    }
    report.sourceAfter = fingerprint(root)
    if (report.sourceBefore !== report.sourceAfter) { report.status = 'failed'; report.error = 'Source changed during quality checks; rerun on a stable tree.' }
    if (controller.signal.aborted) { report.status = 'failed'; report.error = 'Quality checks cancelled.' }
    if (['passed', 'not-needed'].includes(report.status)) writeFileSync(join(directory, 'state.json'), JSON.stringify({inputs: current}, null, 2) + '\n')
  } catch (error) { report.status = 'failed'; report.error = error.message }
  finally {
    report.finishedAt = new Date().toISOString()
    try { save(); writeDiagnosis(root, report, runDirectory, directory) } finally { unlock(); process.removeListener('SIGTERM', cancel); process.removeListener('SIGINT', cancel) }
  }
  console.log(`Quality: ${report.status}. Evidence: .verification/quality/report.json; diagnosis: .verification/quality/diagnosis.md`)
  if (!['passed', 'not-needed'].includes(report.status)) process.exitCode = 1
  return report
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
