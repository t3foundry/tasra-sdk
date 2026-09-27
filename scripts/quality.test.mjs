import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {selectChecks, changedPaths, main} from './quality.mjs'
import {diagnose} from './verification-diagnosis.mjs'

void test('changed inputs select costly checks only for relevant surfaces and catch removals', () => {
  assert.deepEqual(selectChecks(['docs/guide.md']), [])
  assert.deepEqual(selectChecks(['src/auth/identityScope.ts']), ['test:security', 'test:mutation'])
  assert.deepEqual(selectChecks(['src/crypto/kem.ts']), ['test:security', 'performance'])
  assert.deepEqual(selectChecks(['package-lock.json']), ['test:security', 'test:mutation', 'performance'])
  assert.deepEqual(changedPaths({'src/auth/identityScope.ts': 'old'}, {}), ['src/auth/identityScope.ts'])
})
void test('diagnosis distinguishes observation from an unproven cause and never echoes secret logs', () => {
  const report = {runId: 'one', status: 'failed', stages: [{id: 'test:security', status: 'failed', exitCode: 1}]}
  const value = diagnose(report, {'test:security': 'EPERM secret=private-test-sentinel'})
  assert.equal(value.classification, 'possible-environment-failure')
  assert.match(value.reproduction, /not yet established/)
  assert.ok(!JSON.stringify(value).includes('private-test-sentinel'))
  assert.equal(diagnose(report, {'test:security': 'AssertionError'}).classification, 'behavioral-failure')
  assert.equal(diagnose({status: 'failed', error: 'secret=private-test-sentinel', stages: []}).classification, 'unclassified')
  assert.ok(!JSON.stringify(diagnose({status:'failed',error:'private-test-sentinel'})).includes('private-test-sentinel'))
})
void test('failed selected command blocks following work, preserves failure and cannot advance changed-input state', async t => {
  const root = mkdtempSync(join(tmpdir(), 'tasra-quality-'))
  t.after(() => rmSync(root, {recursive: true, force: true}))
  execFileSync('git', ['init', '-q'], {cwd: root})
  writeFileSync(join(root, '.gitignore'), '.verification/\n')
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src/anything.ts'), 'export const value=1')
  const pkg = {scripts: {'test:security': 'node -e "process.exit(23)"', 'test:mutation': 'node -e "process.exit(0)"', performance: 'node -e "process.exit(0)"'}}
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg))
  const previous = process.exitCode, base = process.env.QUALITY_BASE
  delete process.env.QUALITY_BASE
  try {
    const failed = await main(['--all'], root)
    assert.equal(failed.status, 'failed')
    assert.equal(process.exitCode, 1)
    assert.equal(failed.stages[0].exitCode, 23)
    assert.equal(failed.stages[1].status, 'not_run')
    assert.equal(existsSync(join(root, '.verification/quality/state.json')), false)
    pkg.scripts['test:security'] = 'node -e "process.exit(0)"'
    writeFileSync(join(root, 'package.json'), JSON.stringify(pkg))
    process.exitCode = undefined
    assert.equal((await main(['--all'], root)).status, 'passed')
    assert.equal((await main(['--changed'], root)).status, 'not-needed')
    assert.equal(JSON.parse(readFileSync(join(root, '.verification/quality/report.json'))).status, 'not-needed')
  } finally { process.exitCode = previous; if (base === undefined) delete process.env.QUALITY_BASE; else process.env.QUALITY_BASE = base }
})
