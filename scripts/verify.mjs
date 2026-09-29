import {readFileSync, writeFileSync, mkdirSync, renameSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {writeDiagnosis} from './verification-diagnosis.mjs'
import {acquireLock, fingerprint, execute} from './verify-lib.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const args = process.argv.slice(2)
if (args.length > 1 || (args.length && !['--quick', '--sdk', '--consumers'].includes(args[0]))) {
  console.error('Usage: npm run verify [-- --quick | -- --sdk | -- --consumers]')
  process.exit(2)
}
const profile = args[0]?.slice(2) ?? 'full'
const directory = join(root, '.verification')
let unlock
try { unlock = acquireLock(directory) }
catch (error) { console.error(error.message); process.exit(2) }
const controller = new AbortController()
const cancel = () => controller.abort()
process.once('SIGINT', cancel)
process.once('SIGTERM', cancel)
const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8)
const runDirectory = join(directory, runId)
mkdirSync(runDirectory)
const report = {schemaVersion: 1, runId, profile, status: 'running', startedAt: new Date().toISOString(),
  node: process.version, platform: process.platform, stages: [], scope: 'Deterministic checks only; independent review and applicable live acceptance remain required.'}
function save() {
  const text = JSON.stringify(report, null, 2) + '\n'
  writeFileSync(join(runDirectory, 'report.json'), text)
  writeFileSync(join(directory, 'report.json.tmp'), text)
  renameSync(join(directory, 'report.json.tmp'), join(directory, 'report.json'))
  const lines = [`# Verification: ${report.status}`, '', `Run: ${runId}`, `Profile: ${profile}`, `Commit: ${report.commit ?? 'unknown'}`,
    `Source fingerprint: ${report.sourceBefore ?? 'unknown'}`, '', report.scope, '', '| Stage | Result | Log |', '|---|---|---|',
    ...report.stages.map(stage => `| ${stage.id} | ${stage.status} | ${stage.log ? `[log](${runId}/${stage.id}.log)` : 'Not executed'} |`)]
  if (report.error) lines.push('', report.error)
  writeFileSync(join(directory, 'report.md'), lines.join('\n') + '\n')
}
const npm = process.env.npm_execpath
function script(id, timeoutMs = 300_000) {
  return {id, command: npm ? process.execPath : 'npm', args: [...(npm ? [npm] : []), 'run', id], timeoutMs}
}
try {
  save() // Clear any previous green result before doing work.
  report.commit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim()
  report.sourceBefore = fingerprint(root)
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  if (profile === 'full' && Number(process.versions.node.split('.')[0]) < 24) throw new Error('Full verification requires Node 24+ for the docs/app toolchains; use --sdk to test the SDK on Node 22.12.')
  const selected = profile === 'consumers' ? ['verify:consumers'] :
    ['verify:infrastructure', 'verify:repository', 'lint', 'typecheck', ...(profile === 'quick' ? [] : ['build', 'verify:docs', 'test:coverage', 'verify:pkg', 'verify:security', ...(profile === 'full' ? ['verify:document-app', 'verify:site'] : [])])]
  for (const id of selected) if (!packageJson.scripts[id]) throw new Error(`Missing mandatory npm script: ${id}`)
  const outcome = await execute(selected.map(id => script(id, id === 'verify:consumers' ? 1_200_000 : 300_000)),
    {cwd: root, directory: runDirectory, signal: controller.signal, output: process.stdout})
  report.stages = outcome.results.map(stage => ({...stage, log: stage.log ? `${runId}/${stage.id}.log` : undefined}))
  report.status = outcome.status
  report.sourceAfter = fingerprint(root)
  if (report.sourceBefore !== report.sourceAfter) { report.status = 'failed'; report.error = 'Repository inputs changed during verification. Re-run on a stable tree.' }
  if (controller.signal.aborted) { report.status = 'failed'; report.error = 'Verification cancelled.' }
} catch (error) { report.status = 'failed'; report.error = error.message }
finally {
  report.finishedAt = new Date().toISOString()
  try { save(); writeDiagnosis(root, report, runDirectory, directory) } finally { unlock() }
  process.removeListener('SIGINT', cancel)
  process.removeListener('SIGTERM', cancel)
}
console.log(`\nVerification ${report.status} (${profile}). Evidence: .verification/report.md`)
if (report.error) console.error(report.error)
process.exitCode = report.status === 'passed' ? 0 : 1
