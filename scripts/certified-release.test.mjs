import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {parse} from 'yaml'
import {findCertifiedRelease} from './certified-release.mjs'

const commit = '14cadc82dffb082a1cd17322239b313e926f3f0e'
const pkg = {commit, name: '@t3foundry/tasra-sdk', version: '0.5.0', integrity: 'sha512-AAAA'}
const release = (tag, sdkPackage, {certified = true, isPrerelease = false} = {}) =>
  ({tag, isPrerelease, manifest: {certified, sdkPackage: {registry: 'npm', ...sdkPackage}}})

void test('a published, certified release naming this commit, version and integrity admits the tag', () => {
  const releases = [release('v0.4.9', {...pkg, commit: 'f'.repeat(40)}), release('v0.5.0', pkg)]
  assert.equal(findCertifiedRelease(releases, pkg), 'v0.5.0')
})

void test('a commit no release names is not certified', () => {
  assert.throws(() => findCertifiedRelease([release('v0.5.0', {...pkg, commit: 'e'.repeat(40)})], pkg), /in no published/)
  assert.throws(() => findCertifiedRelease([], pkg), /is not certified/)
})

void test('a preview prerelease or an uncertified release never admits npm', () => {
  assert.throws(() => findCertifiedRelease([release('v0.5.0', pkg, {isPrerelease: true})], pkg), /none a certified, non-prerelease/)
  assert.throws(() => findCertifiedRelease([release('v0.5.0', pkg, {certified: false})], pkg), /none a certified, non-prerelease/)
})

void test('the certified bytes must be the bytes this tag packs', () => {
  assert.throws(() => findCertifiedRelease([release('v0.5.0', pkg)], {...pkg, integrity: 'sha512-BBBB'}), /would not be the certified ones/)
  assert.throws(() => findCertifiedRelease([release('v0.5.0', pkg)], {...pkg, version: '0.5.1'}), /certified version 0.5.0/)
  assert.throws(() => findCertifiedRelease([release('v0.5.0', pkg)], {...pkg, name: 'tasra-sdk'}), /names package/)
})

void test('inputs are required and the commit must be a full SHA', () => {
  assert.throws(() => findCertifiedRelease([], {...pkg, integrity: ''}), /Missing integrity/)
  assert.throws(() => findCertifiedRelease([], {...pkg, commit: '14cadc8'}), /not a full SHA/)
})

void test('the release workflow checks certification and its signature before any npm publish', () => {
  const steps = parse(readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')).jobs.publish.steps
  const at = name => steps.findIndex(s => s.name === name)
  const gate = at('Certified with a keykeeper-network release?')
  assert.ok(gate >= 0, 'the certification step exists')
  assert.ok(gate < steps.findIndex(s => String(s.run ?? '').includes('npm publish')), 'it runs before npm publish')
  assert.match(steps[gate].run, /cosign verify-blob/)
  assert.match(steps[gate].run, /managination\/keykeeper-network\/\\\.github\/workflows\/release\\\.yml@refs\/tags\/v/)
  assert.match(steps[gate].run, /certified-release\.mjs/)
})
