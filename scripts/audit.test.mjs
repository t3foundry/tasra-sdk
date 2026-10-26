import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {auditFindings, loadExceptions, MAX_EXCEPTION_DAYS} from './audit.mjs'

const NOW = Date.parse('2026-10-03T00:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const GHSA = 'GHSA-ch52-4w7c-c8xp'
const reason = 'No patched release exists; build-time only; no shared cache serves responses here.'

function report(entries) {
  // The shape `npm audit --json` emits: one entry per affected package, `via` naming either an
  // advisory object (the root) or a package name (transitive).
  const vulnerabilities = {}
  for (const [name, via] of entries) vulnerabilities[name] = {via}
  return {vulnerabilities}
}
const advisory = (name = 'http-cache-semantics', severity = 'high') => ({name, severity, title: 'max-stale disclosure', url: `https://github.com/advisories/${GHSA}`, range: '<=4.2.0'})

function exceptionsFile(t, exceptions) {
  const dir = mkdtempSync(join(tmpdir(), 'tasra-audit-'))
  t.after(() => rmSync(dir, {recursive: true, force: true}))
  const path = join(dir, 'audit-exceptions.json')
  writeFileSync(path, JSON.stringify({schemaVersion: 1, exceptions}))
  return path
}

void test('an unexcepted high advisory fails, and the finding names the package and what to do', () => {
  const findings = auditFindings('site', report([['http-cache-semantics', [advisory()]], ['astro', ['http-cache-semantics']]]), [], NOW)
  assert.equal(findings.length, 1)
  assert.match(findings[0], /GHSA-ch52-4w7c-c8xp on http-cache-semantics/)
  assert.match(findings[0], /dated exception/)
})

void test('a dated exception on the right scope and package admits exactly that advisory', t => {
  const exceptions = loadExceptions(exceptionsFile(t, [{advisory: GHSA, package: 'http-cache-semantics', scope: 'site', reason, expires: '2026-12-31'}]), NOW)
  assert.deepEqual(auditFindings('site', report([['http-cache-semantics', [advisory()]], ['astro', ['http-cache-semantics']]]), exceptions, NOW), [])
  // The same advisory in the OTHER scope is not covered.
  assert.equal(auditFindings('root', report([['http-cache-semantics', [advisory()]]]), exceptions, NOW).length, 1)
  // A second, different advisory is still reported beside the excepted one.
  const other = {...advisory('astro', 'critical'), url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc', title: 'other'}
  const findings = auditFindings('site', report([['http-cache-semantics', [advisory()]], ['astro', [other]]]), exceptions, NOW)
  assert.equal(findings.length, 1)
  assert.match(findings[0], /GHSA-aaaa-bbbb-cccc/)
})

void test('an expired exception and an exception matching nothing both fail', t => {
  const expired = loadExceptions(exceptionsFile(t, [{advisory: GHSA, package: 'http-cache-semantics', scope: 'site', reason, expires: '2026-10-01'}]), NOW)
  const findings = auditFindings('site', report([['http-cache-semantics', [advisory()]]]), expired, NOW)
  assert.equal(findings.length, 1)
  assert.match(findings[0], /expired 2026-10-01/)
  const stale = loadExceptions(exceptionsFile(t, [{advisory: GHSA, package: 'http-cache-semantics', scope: 'site', reason, expires: '2026-12-31'}]), NOW)
  const unused = auditFindings('site', report([]), stale, NOW)
  assert.equal(unused.length, 1)
  assert.match(unused[0], /matches no advisory any more/)
})

void test('the exception file refuses a vague reason, a far expiry, a bad id, a bad scope and a duplicate', t => {
  const good = {advisory: GHSA, package: 'http-cache-semantics', scope: 'site', reason, expires: '2026-12-31'}
  assert.throws(() => loadExceptions(exceptionsFile(t, [{...good, reason: 'fine'}]), NOW), /names the unreachable path/)
  const far = new Date(NOW + (MAX_EXCEPTION_DAYS + 2) * DAY).toISOString().slice(0, 10)
  assert.throws(() => loadExceptions(exceptionsFile(t, [{...good, expires: far}]), NOW), /days out/)
  assert.throws(() => loadExceptions(exceptionsFile(t, [{...good, advisory: 'CVE-2026-1'}]), NOW), /malformed advisory/)
  assert.throws(() => loadExceptions(exceptionsFile(t, [{...good, scope: 'everywhere'}]), NOW), /unknown scope/)
  assert.throws(() => loadExceptions(exceptionsFile(t, [good, good]), NOW), /Duplicate/)
})

void test('moderate advisories are not the gate\x27s business, and an advisory without a GHSA id is refused', () => {
  assert.deepEqual(auditFindings('root', report([['x', [{...advisory('x', 'moderate')}]]]), [], NOW), [])
  assert.throws(() => auditFindings('root', report([['x', [{...advisory('x'), url: 'https://example.invalid'}]]]), [], NOW), /no GHSA id/)
})
