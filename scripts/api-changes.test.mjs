import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {compareSnapshots, generateReport, renderReport, validateSnapshot} from './api-changes.mjs'
import {hash, publicSurface} from './api-surface.mjs'

const entry = (id, shape = 'one', extras = {}) => ({id: `sdk#${id}`, kind: 'value', source: 'src/index.ts', shape: hash(shape), ...extras})
const snapshot = (exports, declaration = 'declarations') => ({schemaVersion: 1, declarationsHash: hash(declaration), exports})

test('reports additions, removals and kind/signature changes independently', () => {
  const before = snapshot([entry('removed'), entry('changed'), entry('same'), entry('kind')])
  const after = snapshot([entry('same'), entry('changed', 'two'), entry('added'), entry('kind', 'one', {kind: 'type'})], 'new declarations')
  const result = compareSnapshots(before, after)
  assert.deepEqual(result.added.map(e => e.id), ['sdk#added'])
  assert.deepEqual(result.removed.map(e => e.id), ['sdk#removed'])
  assert.deepEqual(result.changed.map(e => [e.id, e.reasons]), [['sdk#changed', ['shape']], ['sdk#kind', ['kind']]])
  assert.equal(result.declarationsChanged, true)
  assert.deepEqual(result.relocated, [])
})

test('source moves and declaration-only drift do not become invented signature changes', () => {
  const result = compareSnapshots(snapshot([entry('same')]), snapshot([entry('same', 'one', {source: 'src/moved.ts'})], 'new declaration'))
  assert.equal(result.changed.length, 0)
  assert.deepEqual(result.relocated, [{id: 'sdk#same', before: 'src/index.ts', after: 'src/moved.ts'}])
  assert.equal(result.declarationsChanged, true)
})

test('removal of every export is reported, never treated as an empty baseline', () => {
  const result = compareSnapshots(snapshot([entry('removed')]), snapshot([], 'empty module'))
  assert.deepEqual(result.removed.map(e => e.id), ['sdk#removed'])
  assert.equal(result.declarationsChanged, true)
})

test('rejects malformed, empty, duplicated or legacy baselines', () => {
  for (const invalid of [null, [], {}, snapshot([]), snapshot([entry('x'), entry('x')]), {...snapshot([entry('x')]), schemaVersion: 2}, snapshot([{...entry('x'), shape: 'invalid'}]), snapshot([{...entry('x'), kind: 'unknown'}])]) {
    assert.throws(() => validateSnapshot(invalid), /invalid|duplicate/)
  }
})

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'tasra-api-changes-'))
  t.after(() => rmSync(root, {recursive: true, force: true}))
  mkdirSync(join(root, 'src'))
  mkdirSync(join(root, 'api'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({name: 'sdk', version: '1.0.0', exports: {'.': {types: './dist/index.d.ts'}}}))
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({compilerOptions: {target: 'ES2022', module: 'ESNext', rootDir: 'src', outDir: 'dist', skipLibCheck: true, types: []}, include: ['src']}))
  writeFileSync(join(root, 'src/index.ts'), 'interface Options { name: string }\nexport function read(options: Options): string { return options.name }\n')
  return root
}

test('real compiler detects a reachable internal interface change without replacing the reviewed baseline', t => {
  const root = fixture(t)
  const baselinePath = join(root, 'api/api-baseline.json')
  const original = JSON.stringify(publicSurface(root, {includeContracts: true}), null, 2) + '\n'
  writeFileSync(baselinePath, original)
  const initial = generateReport(root)
  assert.equal(initial.changes.declarationsChanged, false)
  writeFileSync(join(root, 'src/index.ts'), 'interface Options { name: string; required: boolean }\nexport function read(options: Options): string { return options.name }\n')
  writeFileSync(join(root, 'api/current-snapshot.json'), JSON.stringify(publicSurface(root, {includeContracts: true})))
  const report = generateReport(root)
  assert.equal(report.changes.declarationsChanged, true)
  assert.equal(readFileSync(baselinePath, 'utf8'), original, 'report generation must never reset its baseline')
  assert.equal(report.baseline.sha256, hash(original))
  assert.deepEqual(JSON.parse(readFileSync(join(root, '.verification/api-changes/report.json'), 'utf8')), report)
  const markdown = readFileSync(join(root, '.verification/api-changes/report.md'), 'utf8')
  assert.match(markdown, /Declaration bundle changed: \*\*yes\*\*/)
  assert.match(markdown, /not a compatibility verdict/)
})

test('missing or corrupted baseline fails instead of treating current API as baseline', t => {
  const root = fixture(t)
  assert.throws(() => generateReport(root), /ENOENT/)
  writeFileSync(join(root, 'api/api-baseline.json'), '{}')
  assert.throws(() => generateReport(root), /invalid or empty/)
})

test('explicit baseline is used and unchanged reports say none without a breaking verdict', t => {
  const root = fixture(t)
  const baselinePath = join(root, 'reviewed-baseline.json')
  const data = publicSurface(root, {includeContracts: true})
  writeFileSync(baselinePath, JSON.stringify(data))
  const report = generateReport(root, {baselinePath})
  assert.equal(report.baseline.path, 'reviewed-baseline.json')
  assert.deepEqual(report.changes, {added: [], removed: [], changed: [], relocated: [], declarationsChanged: false})
  assert.match(renderReport(report), /0 added, 0 removed, 0 changed/)
  assert.match(renderReport(report), /unchanged inventory does not prove unchanged runtime behavior/)
})
