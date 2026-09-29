import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {parse} from 'yaml'
import {releaseTag} from './release-tag.mjs'

void test('stable releases advance latest and prereleases use next', () => {
  assert.equal(releaseTag('v1.2.3', '1.2.3'), 'latest')
  assert.equal(releaseTag('v1.2.3+build.1', '1.2.3+build.1'), 'latest')
  for (const version of ['0.3.0-next.0', '1.2.3-alpha.1', '1.2.3-rc.2+build.5']) {
    assert.equal(releaseTag(`v${version}`, version), 'next')
  }
})

void test('mismatched or malformed versions cannot select a publish tag', () => {
  assert.throws(() => releaseTag('v1.2.3', '1.2.4'), /does not match/)
  assert.throws(() => releaseTag('1.2.3', '1.2.3'), /does not match/)
  for (const version of ['banana', '1.2', '01.2.3', '1.2.3-']) {
    assert.throws(() => releaseTag(`v${version}`, version), /Invalid package version/)
  }
})

void test('workflow helper writes only the validated npm tag to GitHub output', t => {
  const directory = mkdtempSync(join(tmpdir(), 'tasra-release-tag-'))
  t.after(() => rmSync(directory, {recursive: true, force: true}))
  const output = join(directory, 'output')
  const run = ref => spawnSync(process.execPath, [fileURLToPath(new URL('./release-tag.mjs', import.meta.url))], {
    env: {...process.env, GITHUB_REF_NAME: ref, GITHUB_OUTPUT: output},
    encoding: 'utf8',
  })
  const packageVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  assert.equal(run(`v${packageVersion}`).status, 0)
  assert.equal(readFileSync(output, 'utf8'), `npm_tag=${releaseTag(`v${packageVersion}`, packageVersion)}\n`)
  assert.notEqual(run('v0.0.0').status, 0)
  assert.equal(readFileSync(output, 'utf8'), `npm_tag=${releaseTag(`v${packageVersion}`, packageVersion)}\n`)
})

void test('release workflow uses the validated distribution tag when publishing', () => {
  const workflow = parse(readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'))
  const steps = workflow.jobs.publish.steps
  const check = steps.find(step => step.id === 'release_tag')
  const publish = steps.find(step => step.run?.startsWith('npm publish '))
  assert.equal(check?.run, 'node scripts/release-tag.mjs')
  assert.match(publish?.run ?? '', /--tag "\$\{\{ steps\.release_tag\.outputs\.npm_tag \}\}"/)
  assert.ok(steps.indexOf(check) < steps.indexOf(publish))
})
