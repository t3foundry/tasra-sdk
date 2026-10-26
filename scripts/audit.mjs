// `npm audit` with EXPLICIT, DATED exceptions - never a lowered audit level.
//
// An advisory with no patched release (the package's latest version is still inside the
// vulnerable range) cannot be fixed by upgrading, and `npm audit` has no exception list of its
// own; the only built-in escape is lowering `--audit-level`, which hides every future advisory
// too. So the exceptions live in `security/audit-exceptions.json`, one per advisory, each with
// the package, the scope it may apply to (`root` or `site`), a reason that names why the
// vulnerable code path is not reachable here, and an expiry: an expired exception fails the
// gate like the advisory itself, and so does an exception that no longer matches anything
// (the advisory got a fix; the exception must go).
//
// Usage: node scripts/audit.mjs            # both scopes
//        node scripts/audit.mjs site       # one scope
import {readFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'

const SEVERITIES = ['high', 'critical']
const DAY_MS = 24 * 60 * 60 * 1000
/** An exception may not be dated further out than this: a review each quarter. */
export const MAX_EXCEPTION_DAYS = 120

export function loadExceptions(path, now = Date.now()) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.exceptions)) throw new Error('Invalid audit exceptions file')
  const seen = new Set()
  for (const e of raw.exceptions) {
    for (const key of ['advisory', 'package', 'scope', 'reason', 'expires']) {
      if (typeof e[key] !== 'string' || !e[key].trim()) throw new Error(`Audit exception is missing ${key}`)
    }
    if (!/^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/.test(e.advisory)) throw new Error(`Audit exception has a malformed advisory id: ${e.advisory}`)
    if (!['root', 'site'].includes(e.scope)) throw new Error(`Audit exception has an unknown scope: ${e.scope}`)
    if (e.reason.trim().length < 40) throw new Error(`Audit exception ${e.advisory} needs a reason that names the unreachable path`)
    const expires = Date.parse(e.expires)
    if (!Number.isFinite(expires)) throw new Error(`Audit exception ${e.advisory} has an unparseable expiry`)
    if (expires - now > MAX_EXCEPTION_DAYS * DAY_MS) throw new Error(`Audit exception ${e.advisory} expires more than ${MAX_EXCEPTION_DAYS} days out`)
    const id = `${e.scope}:${e.advisory}`
    if (seen.has(id)) throw new Error(`Duplicate audit exception ${id}`)
    seen.add(id)
  }
  return raw.exceptions
}

/**
 * The advisories a scope's `npm audit --json` report carries at high/critical, keyed by GHSA id,
 * each with the package names it reaches. Transitive entries (`via` naming another package) are
 * collapsed onto the root advisory: one exception covers one advisory, however many packages
 * depend on the vulnerable one.
 */
export function advisoriesIn(report) {
  const out = new Map()
  for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      if (typeof via !== 'object' || !SEVERITIES.includes(via.severity)) continue
      const id = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/.exec(via.url ?? '')?.[0]
      if (!id) throw new Error(`Advisory on ${name} carries no GHSA id: ${via.url}`)
      const entry = out.get(id) ?? {advisory: id, package: via.name, severity: via.severity, title: via.title, reaches: new Set()}
      entry.reaches.add(name)
      out.set(id, entry)
    }
  }
  return out
}

/**
 * Pure verdict: the findings for one scope given its report and the exception list. Empty =
 * the scope passes. Every finding names what to do.
 */
export function auditFindings(scope, report, exceptions, now = Date.now()) {
  const findings = []
  const advisories = advisoriesIn(report)
  const scoped = exceptions.filter(e => e.scope === scope)
  const used = new Set()
  for (const [id, adv] of advisories) {
    const exception = scoped.find(e => e.advisory === id && e.package === adv.package)
    if (!exception) {
      findings.push(`${scope}: ${adv.severity} ${id} on ${adv.package} (${adv.title}) reaches ${[...adv.reaches].join(', ')} — upgrade, or add a dated exception with the reason it is unreachable`)
      continue
    }
    // Matched, so it is not stale - but an expired match is still a finding of its own.
    used.add(`${id}:${adv.package}`)
    if (Date.parse(exception.expires) < now) {
      findings.push(`${scope}: exception for ${id} on ${adv.package} expired ${exception.expires} — re-review the advisory (a patched version may exist now)`)
    }
  }
  for (const e of scoped) {
    if (!used.has(`${e.advisory}:${e.package}`)) findings.push(`${scope}: exception for ${e.advisory} on ${e.package} matches no advisory any more — remove it`)
  }
  return findings
}

function runAudit(scope) {
  const args = ['audit', '--json', '--include=dev', '--include=optional', '--audit-level=high']
  if (scope === 'root') args.push('--include=peer')
  if (scope === 'site') args.push('--prefix', 'site')
  const res = spawnSync('npm', args, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024})
  // npm audit exits 1 when it finds anything; the JSON is the verdict, the exit code is not.
  if (!res.stdout) throw new Error(`npm audit (${scope}) produced no report: ${res.stderr}`)
  return JSON.parse(res.stdout)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const scopes = process.argv[2] ? [process.argv[2]] : ['root', 'site']
  const exceptions = loadExceptions(new URL('../security/audit-exceptions.json', import.meta.url))
  const findings = scopes.flatMap(scope => auditFindings(scope, runAudit(scope), exceptions))
  if (findings.length) {
    for (const f of findings) console.error(`✗ ${f}`)
    process.exit(1)
  }
  const granted = exceptions.filter(e => scopes.includes(e.scope))
  console.log(`npm audit: no unexcepted high/critical advisory in ${scopes.join(' + ')}${granted.length ? `; ${granted.length} dated exception(s): ${granted.map(e => `${e.advisory} (${e.scope}, until ${e.expires})`).join(', ')}` : ''}`)
}
