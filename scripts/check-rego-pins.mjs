// The vendored keykeeper-rego wasm (ADR-0078) must be EXACTLY the build PINS.json names.
//
// The .wasm is the network's own `keykeeper-rego` crate compiled by the network's
// `scripts/build-rego-wasm.sh`; PINS.json records the network commit and the sha256 of each
// artifact that build produced. This check refuses a tree whose committed bytes differ from
// those pins, or whose pins name a dirty network tree, so a hand-edited glue file or a wasm
// rebuilt from uncommitted sources cannot reach a release. The runtime loader verifies the
// .wasm hash again before instantiation (src/auth/rego.ts).
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

/** Artifacts the package ships, keyed by file name; every one has a pinned sha256. */
export const REGO_WASM_FILES = ['keykeeper_rego_wasm_bg.wasm', 'keykeeper_rego_wasm.js']
/** Files that ship beside them without a hash pin (type declarations and the pins themselves). */
export const REGO_WASM_UNPINNED = ['keykeeper_rego_wasm.d.ts', 'PINS.json']

export function regoPinFindings(directory) {
  const findings = []
  let pins
  try { pins = JSON.parse(readFileSync(join(directory, 'PINS.json'), 'utf8')) }
  catch (error) { return [`PINS.json unreadable: ${error.message}`] }
  if (!/^[0-9a-f]{40}$/.test(pins.network_commit ?? '')) findings.push('PINS.json network_commit is not a 40-hex commit')
  if (pins.network_tree_dirty !== false) findings.push('PINS.json names a DIRTY network tree; rebuild from a clean commit')
  for (const file of REGO_WASM_FILES) {
    const want = pins.sha256?.[file]
    if (!/^[0-9a-f]{64}$/.test(want ?? '')) { findings.push(`PINS.json has no sha256 for ${file}`); continue }
    let have
    try { have = createHash('sha256').update(readFileSync(join(directory, file))).digest('hex') }
    catch (error) { findings.push(`${file} unreadable: ${error.message}`); continue }
    if (have !== want) findings.push(`${file} sha256 ${have} differs from PINS.json ${want}`)
  }
  return findings
}

/** The runtime loader re-checks the .wasm against a constant; it must name the pinned hash. */
export function loaderPinFindings(loaderSource, directory) {
  const pinned = JSON.parse(readFileSync(join(directory, 'PINS.json'), 'utf8')).sha256?.['keykeeper_rego_wasm_bg.wasm']
  const match = loaderSource.match(/export const REGO_WASM_SHA256 = '([0-9a-f]{64})'/)
  if (!match) return ['src/auth/rego.ts declares no REGO_WASM_SHA256 constant']
  return match[1] === pinned ? [] : [`src/auth/rego.ts REGO_WASM_SHA256 ${match[1]} differs from PINS.json ${pinned}`]
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, '..')
  const directory = join(root, 'src/auth/rego/wasm')
  const findings = regoPinFindings(directory)
  if (!findings.length) findings.push(...loaderPinFindings(readFileSync(join(root, 'src/auth/rego.ts'), 'utf8'), directory))
  if (findings.length) { console.error(findings.join('\n')); process.exitCode = 1 }
  else {
    const pins = JSON.parse(readFileSync(join(directory, 'PINS.json'), 'utf8'))
    console.log(`Rego wasm pins verified: keykeeper-rego @ ${pins.network_commit.slice(0, 8)} (regorus ${pins.regorus}, rustc ${pins.rustc}, wasm-bindgen ${pins.wasm_bindgen}).`)
  }
}
