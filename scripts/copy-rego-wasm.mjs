// Ship the vendored keykeeper-rego wasm into dist/. tsc compiles TypeScript only; the .wasm,
// its wasm-bindgen glue, the glue's declarations and PINS.json are copied verbatim, AFTER the
// pins check, so a build can never package bytes that differ from the pinned network build.
import {copyFileSync, mkdirSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {REGO_WASM_FILES, REGO_WASM_UNPINNED, regoPinFindings} from './check-rego-pins.mjs'

const root = resolve(import.meta.dirname, '..')
const from = join(root, 'src/auth/rego/wasm'), to = join(root, 'dist/auth/rego/wasm')
const findings = regoPinFindings(from)
if (findings.length) { console.error(findings.join('\n')); process.exit(1) }
mkdirSync(to, {recursive: true})
for (const file of [...REGO_WASM_FILES, ...REGO_WASM_UNPINNED]) copyFileSync(join(from, file), join(to, file))
