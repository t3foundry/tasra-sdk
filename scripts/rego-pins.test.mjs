import test from 'node:test'
import assert from 'node:assert/strict'
import {copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {REGO_WASM_FILES, REGO_WASM_UNPINNED, loaderPinFindings, regoPinFindings} from './check-rego-pins.mjs'

const source = resolve(import.meta.dirname, '..', 'src/auth/rego/wasm')
function copy() {
  const dir = mkdtempSync(join(tmpdir(), 'rego-pins-'))
  for (const file of [...REGO_WASM_FILES, ...REGO_WASM_UNPINNED]) copyFileSync(join(source, file), join(dir, file))
  return dir
}

void test('the committed rego wasm matches its pins', () => {
  assert.deepEqual(regoPinFindings(source), [])
})

void test('a one-byte change to a pinned artifact is refused', t => {
  for (const file of REGO_WASM_FILES) {
    const dir = copy()
    t.after(() => rmSync(dir, {recursive: true, force: true}))
    const bytes = readFileSync(join(dir, file))
    bytes[bytes.length - 1] ^= 1
    writeFileSync(join(dir, file), bytes)
    assert.match(regoPinFindings(dir).join('\n'), new RegExp(`${file.replace('.', '\\.')} sha256`))
  }
})

void test('pins naming a dirty network tree are refused', t => {
  const dir = copy()
  t.after(() => rmSync(dir, {recursive: true, force: true}))
  const pins = JSON.parse(readFileSync(join(dir, 'PINS.json'), 'utf8'))
  writeFileSync(join(dir, 'PINS.json'), JSON.stringify({...pins, network_tree_dirty: true}))
  assert.match(regoPinFindings(dir).join('\n'), /DIRTY/)
})

void test('the runtime loader pins the same .wasm hash as PINS.json', () => {
  const loader = readFileSync(resolve(import.meta.dirname, '..', 'src/auth/rego.ts'), 'utf8')
  assert.deepEqual(loaderPinFindings(loader, source), [])
  assert.match(loaderPinFindings(loader.replace(/REGO_WASM_SHA256 = '[0-9a-f]/, "REGO_WASM_SHA256 = 'x"), source).join(''), /declares no/)
  assert.match(loaderPinFindings(loader.replace(/(REGO_WASM_SHA256 = ')[0-9a-f]{64}/, `$1${'0'.repeat(64)}`), source).join(''), /differs/)
})
