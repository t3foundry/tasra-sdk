// E2E: DCQL access control at the verifier.
//
//   - A presentation that SATISFIES the slot rule yields a JWT whose scope
//     carries the required claim.
//   - A presentation that FAILS the rule must NEVER yield a usable token
//     silently. The honest outcome is a 403 NAMING THE REASON; a `demo-faults`
//     verifier with KK_DEMO_FAULT_MISISSUE instead returns a token PLUS a
//     self-incriminating `fault_statement` (the input to the slashing path).
//     Both are acceptable; a token with no fault_statement is the violation.
//
// ⚠⚠ THIS SUITE WAS VACUOUS ON TWO COUNTS UNTIL 2026-09-29, and both are the
//    same shape as `[].every()` — a green that could not go red.
//
//    1. IT ASSERTED `status >= 400`, so HTTP 404 read as "denied". Under
//       production posture the unsigned `/v1/verify` route is NOT REGISTERED
//       AT ALL (server/mod.rs gates it behind `!production_posture` and
//       `allow_unsigned_verify`), so on a posture fleet every verifier 404s and
//       the denial half reported three passes having exercised no policy. A
//       missing route is not a denial: only a 4xx that carries a REASON is.
//    2. IT DENIED NOBODY. The shared `ENGINEERING_RULE` has `claims: []`,
//       documented in _fleet.ts as "a universal grant — any JWT scope satisfies
//       it", so `dept: Sales` satisfied the rule too. The rule under test has to
//       CONSTRAIN the claim the fixture varies, which is why this file carries
//       its own rule instead of the shared universal one.
//
// ⚠ A posture fleet is therefore EXPECTED to fail this suite today, and the
//   failure names why (ADR-0062 Phase E: the fleet and this harness are
//   half-migrated to the committee path, which is the endpoint that survives
//   posture). That is deliberate — an inapplicable suite reporting green is the
//   defect this rewrite removes, not a state to paper back over.
//
// Run: tsx test/e2e/access-dcql.ts

import {Suite} from '../fleet/_assert.ts'
import {engineeringPresentation, gate, loadFleetConfig} from '../fleet/_fleet.ts'
import {decodeJwtClaims} from '../../src/auth/verifier.ts'

const cfg = loadFleetConfig()
const s = new Suite('e2e: DCQL access control')

if (!(await gate(s, cfg))) {
  s.done()
  process.exit(0)
}

// The policy under test: `dept` must be Engineering. Both halves use THIS rule, so
// "accepted" and "denied" are statements about one policy rather than two. Same shape
// as test/slashing/verifier-misissue-slash.ts, which has always constrained the claim.
const ENGINEERING_ONLY_RULE =
  '{"credentials":[{"id":"emp","format":"jwt_vc_json","claims":[{"path":["dept"],"values":["Engineering"]}]}],"_kk_legacy":true}'

async function verify(url: string, presentation: unknown) {
  const res = await fetch(`${url}/v1/verify`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({dcql_rule: ENGINEERING_ONLY_RULE, presentation}),
    signal: AbortSignal.timeout(6000),
  })
  // Keep the RAW body: the reason is the assertion, and a truncated or swallowed one
  // leaves a 404 and a policy refusal indistinguishable.
  const text = await res.text()
  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    /* non-JSON body — `text` still carries whatever arrived */
  }
  return {status: res.status, body, text}
}

// ── happy path: an Engineering employee gets a scoped token ───────────────────
{
  const verifier = cfg.verifierUrls[0]!
  const {status, body, text} = await verify(verifier, engineeringPresentation('did:demo:alice'))
  const token = (body.token ?? body.jwt) as string | undefined
  s.ok('passing VP is accepted (2xx)', status >= 200 && status < 300, `HTTP ${status}: ${text.slice(0, 200)}`)
  s.ok('passing VP returns a token', !!token)
  if (token) {
    const claims = decodeJwtClaims(token)
    const scope = Array.isArray(claims?.scope) ? claims!.scope.join(' ') : String(claims?.scope ?? '')
    s.ok('token scope carries the required claim', scope.includes('EmployeeOf:dept=Engineering'), scope)
    s.eq('token subject is the holder', String(claims?.sub ?? ''), 'did:demo:alice')
  }
}

// ── denial invariant: a failing VP never yields a silent usable token ─────────
const failingVp = {
  holder: 'did:demo:mallory',
  credentials: [
    {issuer: 'did:web:hr.acmecorp.example', credential_type: 'EmployeeOf', claims: {dept: 'Sales'}},
  ],
}
// The one status a rule refusal produces: `dcql::EvalError::Reject` → `ApiError::reject`
// → 403 with `{"error": "<reason>"}`. 400 is `Malformed` — the RULE is wrong, not the
// presentation, so it proves nothing about access control and must not count as a denial.
const RULE_REFUSAL = 403
for (const verifier of cfg.verifierUrls) {
  const short = verifier.replace(/^https?:\/\//, '')
  const {status, body, text} = await verify(verifier, failingVp)
  const token = (body.token ?? body.jwt) as string | undefined
  const fault = body.fault_statement
  const reason = typeof body.error === 'string' ? body.error : ''
  const where = `HTTP ${status}: ${text.slice(0, 200) || '<empty body>'}`

  if (token && fault) {
    // Mis-issued, but emitted the fault_statement that lets a challenger slash it.
    // Acceptable — surfaced, not silent. Reachable only on a `demo-faults` build with
    // KK_DEMO_FAULT_MISISSUE; a posture fleet cannot take this branch (the feature is
    // mutually exclusive with production posture) and is expected to take the 403 one.
    s.ok(`verifier ${short}: mis-issued but emitted a fault_statement (byzantine, slashable)`, true)
    s.info(`fault verifier=${(fault as {verifier?: string}).verifier ?? '?'}`)
  } else if (token) {
    s.ok(`verifier ${short}: failing VP must not yield a silent token`, false, 'got a token with no fault_statement')
  } else if (status === RULE_REFUSAL && reason) {
    s.ok(`verifier ${short}: failing VP refused by the rule (403 + reason)`, true, reason)
  } else if (status === 404) {
    s.ok(
      `verifier ${short}: POST /v1/verify is served`,
      false,
      `${where} — the unsigned route is unregistered under production posture; ` +
        'this suite proves nothing until it is ported to the committee path (ADR-0062 Phase E)',
    )
  } else {
    s.ok(
      `verifier ${short}: failing VP refused by the rule (403 + reason)`,
      false,
      `${where} — a refusal must be ${RULE_REFUSAL} and must name its reason`,
    )
  }
}

s.done()
