// kk_oauth (ADR-0078) conformance harness.
//
// Runs every row of rego-vectors.json through the SHIPPED SDK surface: the pure-TS grammar
// test, the commitment function, and the network's own keykeeper-rego engine as the SDK loads
// it (WebAssembly, hash-checked). Families:
//
//   evaluation  — evaluateEnvelope(rule, presentation) must reach the row's verdict
//                 (allow / reject / malformed);
//   gate        — the network's `run_gate` is `keykeeper_rego::load(rule).is_ok()`: here that is
//                 lintEnvelope succeeding AND reporting `admissible` (lint's admissibility IS
//                 `load`). A refused row must also refuse at evaluation, as `malformed`;
//   commitment  — canonicalize(rule) and ruleCommitment(salt, rule) must equal the row's
//                 canonical form and commitment, which the Rust side computed;
//   allowlist_v1 — the loaded engine enforces exactly the corpus's builtin allow-list.
//
// Every vector rule is also classified by the pure-TS isOauthEnvelope, which must agree with the
// engine's own grammar test (the network's `keykeeper_dcql::grammar`).
//
// test/rego-vectors.json is a BYTE-IDENTICAL copy of the network's
// crates/libs/keykeeper-rego/tests/vectors/rego_vectors.json. When a network checkout is present
// (KK_NETWORK_DIR, or the usual sibling locations) the copy is compared byte for byte and a
// difference FAILS: refresh the copy, never edit it. Without a checkout the comparison is
// reported as skipped.
//
// Exits non-zero on any mismatch.

import {existsSync, readFileSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {canonicalize} from '../src/auth/oid4vp.ts'
import {evaluateEnvelope, isOauthEnvelope, lintEnvelope, loadRego, RegoEnvelopeError, type OauthPresentation} from '../src/auth/rego.ts'
// ⚠ The SHIPPED commitment function, not a local recomputation (see oid4vp.conformance.ts).
import {ruleCommitment} from '../src/chain/write.ts'

interface EvalVector {
  name: string
  rule: string
  presentation: OauthPresentation
  expect: 'allow' | 'reject' | 'malformed'
}
interface GateVector {
  name: string
  rule: string
  expect: 'accept' | 'malformed'
}
interface CommitVector {
  name: string
  salt_hex: string
  rule: string
  canonical: string
  commitment_hex: string
}

const here = dirname(fileURLToPath(import.meta.url))
const localRaw = readFileSync(join(here, 'rego-vectors.json'))
// Integers beyond 2^53 are kept as their exact source text (JSON.rawJSON), so a presentation
// re-serialises byte-exact: the corpus pins that an out-of-i64 claim reaches the policy as a
// string and 2^53+1 stays exact, which a lossy JS number would silently break.
type RawJson = {rawJSON?: (text: string) => unknown}
const exact = (_key: string, value: unknown, context?: {source?: string}) =>
  typeof value === 'number' && !Number.isSafeInteger(value) && Number.isInteger(value) && context?.source && (JSON as RawJson).rawJSON
    ? (JSON as RawJson).rawJSON!(context.source)
    : value
const corpus = JSON.parse(localRaw.toString('utf8'), exact as never) as {
  allowlist_v1: string[]
  evaluation: EvalVector[]
  gate: GateVector[]
  commitment: CommitVector[]
}

let passed = 0
const failures: string[] = []
const check = (label: string, cond: boolean, detail = '') => {
  if (cond) passed++
  else failures.push(detail ? `${label}: ${detail}` : label)
}

// ─── drift guard ─────────────────────────────────────────────────────────────

const NETWORK_CORPUS = 'crates/libs/keykeeper-rego/tests/vectors/rego_vectors.json'
const networkDirs = [
  process.env.KK_NETWORK_DIR,
  resolve(here, '..', '..', '..', 'Blockchain', 'keykeeper-network'),
  resolve(here, '..', '..', '..', 'managination', 'keykeeper-network'),
  resolve(here, '..', '..', 'keykeeper-network'),
].filter((d): d is string => d !== undefined)
const network = networkDirs.map(d => join(d, NETWORK_CORPUS)).find(p => existsSync(p))
if (network) {
  check(`drift: test/rego-vectors.json is byte-identical to ${network}`, readFileSync(network).equals(localRaw),
    'refresh the copy from the network (cp, never edit)')
} else {
  console.log(`  - drift guard skipped: no keykeeper-network checkout (set KK_NETWORK_DIR)`)
}

// ─── families ────────────────────────────────────────────────────────────────

const engine = await loadRego()
const probe: OauthPresentation = {holder: 'h', credentials: []}

check('allowlist_v1: the engine enforces exactly the corpus allow-list',
  JSON.stringify(engine.allowlistV1()) === JSON.stringify(corpus.allowlist_v1),
  `${JSON.stringify(engine.allowlistV1())} vs ${JSON.stringify(corpus.allowlist_v1)}`)

for (const v of corpus.evaluation) {
  const verdict = await evaluateEnvelope(v.rule, v.presentation)
  const actual = verdict.allow ? 'allow' : verdict.kind
  check(`eval/${v.name}`, actual === v.expect, `expected ${v.expect}, got ${actual}${verdict.allow ? '' : ` (${verdict.message})`}`)
}

for (const v of corpus.gate) {
  let actual: 'accept' | 'malformed'
  try {
    actual = (await lintEnvelope(v.rule)).admissible ? 'accept' : 'malformed'
  } catch (e) {
    if (!(e instanceof RegoEnvelopeError) || e.kind !== 'malformed') throw e
    actual = 'malformed'
  }
  check(`gate/${v.name}`, actual === v.expect, `expected ${v.expect}, got ${actual}`)
  if (v.expect === 'malformed') {
    const verdict = await evaluateEnvelope(v.rule, probe)
    check(`gate/${v.name}: refused at evaluation too`, !verdict.allow && verdict.kind === 'malformed', JSON.stringify(verdict))
  }
}

for (const v of corpus.commitment) {
  check(`commit/${v.name}: canonical form`, canonicalize(v.rule) === v.canonical)
  check(`commit/${v.name}: commitment`, ruleCommitment(`0x${v.salt_hex}`, v.rule) === `0x${v.commitment_hex}`,
    ruleCommitment(`0x${v.salt_hex}`, v.rule))
}

// ─── grammar agreement ───────────────────────────────────────────────────────

const glue = (await import('../src/auth/rego/wasm/keykeeper_rego_wasm.js')) as unknown as {isOauthEnvelope(rule: string): boolean}
const rules = [...corpus.evaluation, ...corpus.gate, ...corpus.commitment].map(v => v.rule)
for (const v of corpus.commitment) rules.push(v.canonical)
for (const rule of rules) {
  check(`grammar: isOauthEnvelope agrees with the network on ${rule.slice(0, 48)}…`, isOauthEnvelope(rule) === glue.isOauthEnvelope(rule))
}
check('grammar: every commitment rule is an envelope', corpus.commitment.every(v => isOauthEnvelope(v.rule)))

const total = corpus.evaluation.length + corpus.gate.length + corpus.commitment.length
console.log(`rego conformance: ${passed} checks passed over ${total} vectors (${corpus.evaluation.length} evaluation, ${corpus.gate.length} gate, ${corpus.commitment.length} commitment)`)
if (failures.length) {
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
