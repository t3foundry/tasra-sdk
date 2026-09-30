import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync, existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'tasra-hooks-'))
  t.after(() => rmSync(root, {recursive: true, force: true}))
  const env = {...process.env, CI: '', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0'}
  const run = (command, args, options = {}) => spawnSync(command, args, {cwd: root, env, encoding: 'utf8', timeout: 15_000, ...options})
  const git = (...args) => { const r = run('git', args); assert.equal(r.status, 0, r.stderr); return r.stdout.trim() }
  git('init', '-q'); git('config', 'user.name', 'Hook Test'); git('config', 'user.email', 'hook@example.invalid')
  mkdirSync(join(root, 'scripts')); mkdirSync(join(root, '.githooks'))
  for (const file of ['install-hooks.mjs', 'git-hook.mjs']) copyFileSync(new URL(file, import.meta.url), join(root, 'scripts', file))
  for (const file of ['pre-commit', 'pre-push']) copyFileSync(new URL(`../.githooks/${file}`, import.meta.url), join(root, '.githooks', file))
  // A controllable verifier tests actual Git hook invocation, not the SDK again.
  writeFileSync(join(root, 'scripts/verify.mjs'), `import {appendFileSync,readFileSync,existsSync,writeFileSync} from 'node:fs';
appendFileSync('invocations.log',JSON.stringify({args:process.argv.slice(2),index:process.env.GIT_INDEX_FILE})+'\\n');
if(existsSync('mutate.flag'))writeFileSync('source.txt','changed during verification');
process.exitCode=Number(readFileSync('result.txt','utf8'));
`)
  writeFileSync(join(root, '.gitignore'), '*.log\nmutate.flag\n')
  writeFileSync(join(root, 'result.txt'), '0'); writeFileSync(join(root, 'source.txt'), 'initial')
  git('add', '.'); git('commit', '-qm', 'fixture baseline')
  const install = options => run(process.execPath, ['scripts/install-hooks.mjs'], options)
  const calls = () => existsSync(join(root, 'invocations.log')) ? readFileSync(join(root, 'invocations.log'), 'utf8').trim().split('\n').map(line => JSON.parse(line)) : []
  return {root, env, run, git, install, calls}
}
void test('setup installs executable hooks, is idempotent and skips CI', t => {
  const f = fixture(t)
  assert.equal(f.install({env: {...f.env, CI: 'true'}}).status, 0)
  assert.equal(f.run('git', ['config', '--get', 'core.hooksPath']).status, 1)
  assert.equal(f.install().status, 0); assert.equal(f.install().status, 0)
  assert.equal(f.git('config', '--get', 'core.hooksPath'), '.githooks')
  writeFileSync(join(f.root, 'source.txt'), 'changed')
  f.git('commit', '-am', 'exercise real hook with alternate index')
  assert.deepEqual(f.calls(), [{args: ['--quick']}], 'Git index environment must not escape into verifier fixtures')
})
void test('setup preserves custom hook paths and existing default hooks', t => {
  const f = fixture(t)
  f.git('config', 'core.hooksPath', '/custom/hooks')
  assert.equal(f.install().status, 1)
  assert.equal(f.git('config', '--get', 'core.hooksPath'), '/custom/hooks')
  f.git('config', '--unset', 'core.hooksPath')
  const hook = join(f.root, '.git/hooks/pre-commit'); writeFileSync(hook, 'existing custom hook')
  assert.equal(f.install().status, 1); assert.equal(readFileSync(hook, 'utf8'), 'existing custom hook')
  assert.equal(f.run('git', ['config', '--get', 'core.hooksPath']).status, 1)
})
void test('failing verifier blocks a real commit without changing HEAD', t => {
  const f = fixture(t); assert.equal(f.install().status, 0)
  const before = f.git('rev-parse', 'HEAD')
  writeFileSync(join(f.root, 'result.txt'), '17')
  const result = f.run('git', ['commit', '-am', 'must fail'])
  assert.notEqual(result.status, 0); assert.equal(f.git('rev-parse', 'HEAD'), before)
  assert.deepEqual(f.calls(), [{args: ['--quick']}])
})
void test('push checks exact committed input, propagates failure and succeeds after correction', t => {
  const f = fixture(t); assert.equal(f.install().status, 0)
  const remote = mkdtempSync(join(tmpdir(), 'tasra-hooks-remote-'))
  t.after(() => rmSync(remote, {recursive: true, force: true}))
  assert.equal(f.run('git', ['init', '--bare', '-q', remote]).status, 0)
  f.git('remote', 'add', 'fixture', remote)
  const push = () => f.run('git', ['push', 'fixture', 'HEAD:refs/heads/test'])
  writeFileSync(join(f.root, 'extra.txt'), 'uncommitted')
  assert.match(push().stderr, /Commit or set aside/); assert.equal(f.calls().length, 0)
  rmSync(join(f.root, 'extra.txt'))
  writeFileSync(join(f.root, 'result.txt'), '17')
  f.git('add', '.'); f.git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'failing fixture')
  assert.notEqual(push().status, 0)
  assert.equal(f.git('ls-remote', 'fixture'), '')
  writeFileSync(join(f.root, 'result.txt'), '0'); f.git('commit', '-am', 'correct fixture')
  writeFileSync(join(f.root, 'mutate.flag'), 'yes')
  assert.match(push().stderr, /Checkout changed during verification/)
  assert.equal(f.git('ls-remote', 'fixture'), '')
  rmSync(join(f.root, 'mutate.flag')); f.git('commit', '-am', 'record changed fixture')
  assert.equal(push().status, 0)
  assert.match(f.git('ls-remote', 'fixture'), new RegExp(f.git('rev-parse', 'HEAD')))
  assert.deepEqual(f.calls().map(call => call.args), [[], ['--quick'], [], ['--quick'], []])
})
void test('push rejects other tips, permits deletion-only updates, and fails on missing verifier', t => {
  const f = fixture(t); assert.equal(f.install().status, 0)
  const old = f.git('rev-parse', 'HEAD')
  writeFileSync(join(f.root, 'source.txt'), 'second'); f.git('commit', '-am', 'second')
  const zeros = '0'.repeat(40), hook = input => f.run('sh', ['.githooks/pre-push'], {input})
  assert.match(hook(`refs/heads/old ${old} refs/heads/old ${zeros}\n`).stderr, /Other branch\/tag tips/)
  assert.equal(hook(`(delete) ${zeros} refs/heads/old ${old}\n`).status, 0)
  assert.equal(f.calls().length, 1)
  rmSync(join(f.root, 'scripts/verify.mjs'))
  assert.notEqual(f.run('sh', ['.githooks/pre-commit']).status, 0)
})

for (const flag of ['--assume-unchanged', '--skip-worktree']) void test(`push rejects edits hidden with ${flag}`, t => {
  const f = fixture(t); assert.equal(f.install().status, 0)
  writeFileSync(join(f.root, 'result.txt'), '17')
  f.git('add', '.'); f.git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'committed verifier fails')
  f.git('update-index', flag, 'result.txt')
  writeFileSync(join(f.root, 'result.txt'), '0')
  assert.equal(f.git('status', '--porcelain'), '', 'ordinary status hides the changed input')
  const head = f.git('rev-parse', 'HEAD')
  const result = f.run('sh', ['.githooks/pre-push'], {input: `refs/heads/test ${head} refs/heads/test ${'0'.repeat(40)}\n`})
  assert.notEqual(result.status, 0, 'a passing working copy must not approve failing committed content')
  assert.match(result.stderr, /index flags/)
  assert.equal(f.calls().length, 0)
})

test('install succeeds when the working tree was copied without a git binary', t => {
  const {install, env} = fixture(t)
  // A container that installs this package through a `file:` dependency lands here: npm runs
  // `prepare` for linked local deps even under --ignore-scripts, `.git` rides along in the build
  // context so the directory check passes, and the base image has no git. Hooks are a developer
  // convenience — failing here fails the consumer's whole install.
  const result = install({env: {...env, PATH: ''}})
  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(result.stderr, /Hook setup failed/)
})
