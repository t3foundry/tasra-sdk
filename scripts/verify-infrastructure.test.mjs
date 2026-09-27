import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync, spawnSync} from 'node:child_process'
import {execute, acquireLock, fingerprint} from './verify-lib.mjs'
const stage = (id, code, timeoutMs = 5000) => ({id, command: process.execPath, args: ['-e', code], timeoutMs})
function fixture(t) { const directory = mkdtempSync(join(tmpdir(), 'tasra-verifier-')); t.after(() => rmSync(directory, {recursive: true, force: true})); return {directory, cwd: directory, output: null} }
void test('failure injection preserves exit status and blocks later work', async t => {
  const options = fixture(t)
  const result = await execute([stage('failure', 'console.error("deliberate failure");process.exit(17)'), stage('never', 'require("fs").writeFileSync("sentinel","bad")')], options)
  assert.equal(result.status, 'failed'); assert.equal(result.results[0].exitCode, 17)
  assert.equal(result.results[1].status, 'not_run'); assert.equal(existsSync(join(options.directory, 'sentinel')), false)
  assert.match(readFileSync(join(options.directory, 'failure.log'), 'utf8'), /deliberate failure/)
})
void test('successful commands produce passing evidence', async t => {
  const result = await execute([stage('success', 'console.log("observed")')], fixture(t))
  assert.equal(result.status, 'passed'); assert.equal(result.results[0].exitCode, 0)
})
void test('missing executable and empty stage set cannot pass', async t => {
  const options = fixture(t)
  assert.equal((await execute([{id: 'missing', command: join(options.directory, 'does-not-exist'), args: [], timeoutMs: 1000}], options)).status, 'failed')
  assert.equal((await execute([], options)).status, 'failed')
})
void test('timeout is a failure even when the child handles SIGTERM with exit zero', async t => {
  const result = await execute([stage('timeout', 'process.on("SIGTERM",()=>process.exit(0));setInterval(()=>{},100)', 500)], fixture(t))
  assert.equal(result.status, 'failed'); assert.equal(result.results[0].timedOut, true)
})
void test('cancelled verification does not execute stages', async t => {
  const controller = new AbortController(); controller.abort()
  const result = await execute([stage('never', 'process.exit(0)')], {...fixture(t), signal: controller.signal})
  assert.equal(result.status, 'failed'); assert.equal(result.results[0].status, 'not_run')
})
void test('one writer protects build and coverage outputs', t => {
  const {directory} = fixture(t), release = acquireLock(directory)
  assert.throws(() => acquireLock(directory), /already running/)
  release(); acquireLock(directory)()
})
void test('fingerprint includes untracked edits and tracked deletions, excludes ignored outputs', t => {
  const {directory} = fixture(t)
  execFileSync('git', ['init', '-q', directory])
  writeFileSync(join(directory, '.gitignore'), 'output/\n')
  writeFileSync(join(directory, 'tracked'), 'before'); execFileSync('git', ['add', '.'], {cwd: directory})
  const initial = fingerprint(directory)
  mkdirSync(join(directory, 'output')); writeFileSync(join(directory, 'output', 'generated'), 'ignored'); assert.equal(fingerprint(directory), initial)
  writeFileSync(join(directory, 'new'), 'untracked'); assert.notEqual(fingerprint(directory), initial)
  rmSync(join(directory, 'new')); assert.equal(fingerprint(directory), initial)
  rmSync(join(directory, 'tracked')); assert.notEqual(fingerprint(directory), initial)
})
void test('architecture and focused-test checks parse code, not quoted fixtures', async () => {
  const {sourceFindings} = await import('./verify-repository.mjs')
  assert.equal(sourceFindings('src/crypto/example.ts', "import fs from 'node:fs'").length, 1)
  assert.deepEqual(sourceFindings('src/chain/node.ts', "import fs from 'node:fs'"), [])
  assert.equal(sourceFindings('test/specs/example.test.ts', "test['only']('case',()=>{})").length, 1)
  assert.deepEqual(sourceFindings('test/specs/example.test.ts', 'const fixture="test.only()"'), [])
})
void test('workflow checks reject bad YAML, duplicate keys, missing commands and swallowed failures', async () => {
  const {workflowFindings} = await import('./verify-repository.mjs')
  assert.ok(workflowFindings('jobs: [', {}).length)
  assert.ok(workflowFindings('jobs: {}\njobs: {}', {}).length)
  assert.ok(workflowFindings('jobs:\n  build:\n    steps:\n      - run: npm run missing', {}).length)
  assert.ok(workflowFindings('jobs:\n  build:\n    steps:\n      - run: npm run verify || true', {verify: 'node verify.mjs'}).length)
  assert.deepEqual(workflowFindings('jobs:\n  build:\n    steps:\n      - run: npm run verify', {verify: 'node verify.mjs'}), [])
})

for (const mode of ['timeout', 'cancel']) void test(`${mode} finishes process-group cleanup before the verifier exits`, async t => {
  if (process.platform === 'win32') { t.skip('POSIX process-group guarantee; CI runs Linux/macOS'); return }
  const {directory} = fixture(t)
  const pidFile = join(directory, 'descendant.pid'), beatFile = join(directory, 'heartbeat')
  const descendant = `process.on('SIGTERM',()=>{}); require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid)); setInterval(()=>require('fs').appendFileSync(${JSON.stringify(beatFile)},'x'),20)`
  const parent = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},100)`
  const runner = join(directory, 'runner.mjs')
  const library = new URL('./verify-lib.mjs', import.meta.url).href
  writeFileSync(runner, `import {execute} from ${JSON.stringify(library)};
    const controller=new AbortController();
    ${mode === 'cancel' ? 'setTimeout(()=>controller.abort(),500);' : ''}
    const result=await execute([{id:'tree',command:process.execPath,args:['-e',${JSON.stringify(parent)}],timeoutMs:${mode === 'timeout' ? 500 : 5000}}],{cwd:${JSON.stringify(directory)},directory:${JSON.stringify(directory)},output:null,signal:controller.signal});
    if(result.status!=='failed')process.exitCode=1;
  `)
  t.after(() => {
    if (existsSync(pidFile)) { try { process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error } }
  })
  const result = spawnSync(process.execPath, [runner], {encoding: 'utf8', timeout: 8000})
  assert.equal(result.status, 0, result.stderr)
  assert.ok(existsSync(pidFile), 'descendant actually started')
  await new Promise(resolve => setTimeout(resolve, 100))
  const before = readFileSync(beatFile, 'utf8')
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.equal(readFileSync(beatFile, 'utf8'), before, 'descendant must not continue writing after verifier exit')
})

void test('CI cannot upload unrestricted private verification evidence', async () => {
  const {workflowFindings} = await import('./verify-repository.mjs')
  const workflow = path => `jobs:\n  build:\n    steps:\n      - uses: actions/upload-artifact@pinned\n        with:\n          path: ${JSON.stringify(path)}`
  assert.ok(workflowFindings(workflow('.verification/'), {}).length)
  for (const path of ['internal/', './internal/', '**/*', '.', '']) assert.ok(workflowFindings(workflow(path), {}).length, `Unsafe path accepted: ${path}`)
  assert.deepEqual(workflowFindings(workflow('.verification/report.json'), {}), [])
})
