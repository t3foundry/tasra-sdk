import {mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {hash, publicSurface} from './api-surface.mjs'

export function validateSnapshot(snapshot, label = 'API snapshot', {allowEmpty = false} = {}) {
  const digest = /^[a-f0-9]{64}$/
  if (!snapshot || snapshot.schemaVersion !== 1 || !digest.test(snapshot.declarationsHash) || !Array.isArray(snapshot.exports) || (!allowEmpty && !snapshot.exports.length)) throw new Error(`${label}: invalid or empty snapshot`)
  const ids = new Set()
  for (const entry of snapshot.exports) {
    if (!entry || typeof entry.id !== 'string' || !/^[^\s#]+#[^\s#]+$/.test(entry.id) || ids.has(entry.id) || !['type', 'value'].includes(entry.kind) || typeof entry.source !== 'string' || !entry.source.trim() || !digest.test(entry.shape)) throw new Error(`${label}: invalid or duplicate export ${entry?.id}`)
    ids.add(entry.id)
  }
  return snapshot
}

export function compareSnapshots(baseline, current) {
  validateSnapshot(baseline, 'API baseline')
  validateSnapshot(current, 'Current API', {allowEmpty: true})
  const before = new Map(baseline.exports.map(entry => [entry.id, entry]))
  const after = new Map(current.exports.map(entry => [entry.id, entry]))
  const added = [], removed = [], changed = [], relocated = []
  for (const entry of current.exports) {
    const previous = before.get(entry.id)
    if (!previous) added.push(entry)
    else {
      const reasons = ['kind', 'shape'].filter(key => previous[key] !== entry[key])
      if (reasons.length) changed.push({id: entry.id, reasons, before: previous, after: entry})
      if (previous.source !== entry.source) relocated.push({id: entry.id, before: previous.source, after: entry.source})
    }
  }
  for (const entry of baseline.exports) if (!after.has(entry.id)) removed.push(entry)
  for (const list of [added, removed, changed, relocated]) list.sort((a, b) => a.id.localeCompare(b.id, 'en'))
  return {added, removed, changed, relocated, declarationsChanged: baseline.declarationsHash !== current.declarationsHash}
}

const code = value => '`' + String(value).replaceAll('`', '\\`').replaceAll('\n', ' ') + '`'
export function renderReport(report) {
  const {added, removed, changed, relocated, declarationsChanged} = report.changes
  const lines = ['# SDK API changes', '', `Baseline: ${code(report.baseline.path)} (${code(report.baseline.sha256)}).`, '',
    `Current SDK: ${code(report.package.name)} ${code(report.package.version)}. Observed: ${report.generatedAt}.`, '',
    `${added.length} added, ${removed.length} removed, ${changed.length} changed export signatures/kinds; ${relocated.length} declaration source relocations.`, '',
    `Declaration bundle changed: **${declarationsChanged ? 'yes' : 'no'}**.`, '',
    'This is a deterministic inventory comparison, not a compatibility verdict. Hashes do not establish whether a change is breaking. Declaration drift may include referenced internal types, comments or source moves and cannot always be attributed to individual exports. An unchanged inventory does not prove unchanged runtime behavior.', '']
  for (const [title, entries] of [['Added exports', added], ['Removed exports', removed]]) {
    lines.push(`## ${title}`, '', ...(entries.length ? entries.map(entry => `- ${code(entry.id)} (${entry.kind}; ${code(entry.source)})`) : ['None.']), '')
  }
  lines.push('## Changed export signatures or kinds', '', ...(changed.length ? changed.map(entry => `- ${code(entry.id)}: ${entry.reasons.join(', ')} changed; ${entry.before.kind} → ${entry.after.kind}; signature hash ${code(entry.before.shape)} → ${code(entry.after.shape)}.`) : ['None.']), '',
    '## Declaration source relocations', '', ...(relocated.length ? relocated.map(entry => `- ${code(entry.id)}: ${code(entry.before)} → ${code(entry.after)} (location change alone is not an API signature change).`) : ['None.']), '')
  return lines.join('\n')
}

export function generateReport(root, {baselinePath = join(root, 'api/api-baseline.json')} = {}) {
  // Always read a separately reviewed baseline. Generating a current snapshot must
  // not erase the API comparison, and a missing baseline must fail.
  const baselineBytes = readFileSync(baselinePath, 'utf8')
  const baseline = validateSnapshot(JSON.parse(baselineBytes), 'API baseline')
  const current = publicSurface(root, {includeContracts: true})
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const report = {schemaVersion: 1, generatedAt: new Date().toISOString(),
    package: {name: pkg.name, version: pkg.version},
    baseline: {path: relative(root, baselinePath).replaceAll('\\', '/'), sha256: hash(baselineBytes), declarationsHash: baseline.declarationsHash, exportCount: baseline.exports.length},
    current: {sha256: hash(JSON.stringify(current)), declarationsHash: current.declarationsHash, exportCount: current.exports.length},
    changes: compareSnapshots(baseline, current)}
  const output = join(root, '.verification/api-changes')
  mkdirSync(output, {recursive: true})
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  writeFileSync(join(output, 'report.md'), renderReport(report))
  return report
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 2 || args[0] !== '--baseline' || args[1].startsWith('--'))) throw new Error('Usage: node scripts/api-changes.mjs [--baseline PATH]')
  const root = resolve(import.meta.dirname, '..')
  const report = generateReport(root, args.length ? {baselinePath: resolve(args[1])} : {})
  const {added, removed, changed, declarationsChanged} = report.changes
  console.log(`API changes: ${added.length} added, ${removed.length} removed, ${changed.length} changed; declaration drift: ${declarationsChanged}. Evidence: .verification/api-changes/report.md`)
}
