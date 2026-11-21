import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync, symlinkSync} from 'node:fs'
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
void test('fingerprint hashes a tracked symlink target name without reading its target file', t => {
  const {directory} = fixture(t)
  execFileSync('git', ['init', '-q', directory])
  const external = mkdtempSync(join(tmpdir(), 'tasra-fingerprint-target-'))
  t.after(() => rmSync(external, {recursive: true, force: true}))
  const target = join(external, 'secret')
  writeFileSync(target, 'first')
  symlinkSync(target, join(directory, 'linked'))
  execFileSync('git', ['add', 'linked'], {cwd: directory})
  const initial = fingerprint(directory)
  writeFileSync(target, 'second')
  assert.equal(fingerprint(directory), initial)
})
void test('architecture and focused-test checks parse code, not quoted fixtures', async () => {
  const {sourceFindings} = await import('./verify-repository.mjs')
  assert.equal(sourceFindings('src/crypto/example.ts', "import fs from 'node:fs'").length, 1)
  assert.deepEqual(sourceFindings('src/chain/node.ts', "import fs from 'node:fs'"), [])
  assert.deepEqual(sourceFindings('src/app/node.ts', "import fs from 'node:fs'"), [])
  assert.ok(sourceFindings('src/app/client.ts', "import fs from 'node:fs'").length > 0)
  assert.equal(sourceFindings('test/specs/example.test.ts', "test['only']('case',()=>{})").length, 1)
  assert.deepEqual(sourceFindings('test/specs/example.test.ts', 'const fixture="test.only()"'), [])
  assert.deepEqual(sourceFindings('src/app/client.ts', "import {equalBytes} from '@noble/curves/abstract/utils'"), ['Deprecated Noble curves utility import'])
  assert.deepEqual(sourceFindings('src/app/client.ts', "import {equalBytes} from '@noble/curves/utils.js'"), [])
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
  // The PARENT records the descendant's pid the moment it is spawned (the descendant need not have
  // booted), and the runner cancels only once that record exists: the kill always lands on a live
  // tree, however slow the host is to start processes. The timeout mode's 5 s is a bound on one Node
  // start-up (the parent's), generous on any host, not a speed claim.
  const descendant = `process.on('SIGTERM',()=>{}); setInterval(()=>require('fs').appendFileSync(${JSON.stringify(beatFile)},'x'),20)`
  const parent = `const c=require('child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});require('fs').writeFileSync(${JSON.stringify(pidFile)},String(c.pid));process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},100)`
  const runner = join(directory, 'runner.mjs')
  const library = new URL('./verify-lib.mjs', import.meta.url).href
  writeFileSync(runner, `import {existsSync} from 'node:fs';import {execute} from ${JSON.stringify(library)};
    const controller=new AbortController();
    ${mode === 'cancel' ? `const started=setInterval(()=>{if(existsSync(${JSON.stringify(pidFile)})){clearInterval(started);controller.abort()}},10);` : ''}
    const result=await execute([{id:'tree',command:process.execPath,args:['-e',${JSON.stringify(parent)}],timeoutMs:${mode === 'timeout' ? 5000 : 120_000}}],{cwd:${JSON.stringify(directory)},directory:${JSON.stringify(directory)},output:null,signal:controller.signal});
    if(result.status!=='failed')process.exitCode=1;
  `)
  t.after(() => {
    if (existsSync(pidFile)) { try { process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error } }
  })
  const result = spawnSync(process.execPath, [runner], {encoding: 'utf8', timeout: 180_000})
  assert.equal(result.status, 0, result.stderr)
  assert.ok(existsSync(pidFile), 'descendant actually spawned')
  // A descendant killed before it booted never wrote a heartbeat: that is cleanup too.
  const beats = () => existsSync(beatFile) ? readFileSync(beatFile, 'utf8') : ''
  await new Promise(resolve => setTimeout(resolve, 100))
  const before = beats()
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.equal(beats(), before, 'descendant must not continue writing after verifier exit')
})

void test('CI cannot upload unrestricted private verification evidence', async () => {
  const {workflowFindings} = await import('./verify-repository.mjs')
  const workflow = path => `jobs:\n  build:\n    steps:\n      - uses: actions/upload-artifact@pinned\n        with:\n          path: ${JSON.stringify(path)}`
  assert.ok(workflowFindings(workflow('.verification/'), {}).length)
  for (const path of ['internal/', './internal/', '**/*', '.', '']) assert.ok(workflowFindings(workflow(path), {}).length, `Unsafe path accepted: ${path}`)
  assert.deepEqual(workflowFindings(workflow('.verification/report.json'), {}), [])
})
