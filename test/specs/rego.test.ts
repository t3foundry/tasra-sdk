// src/auth/rego.ts: the pure grammar test, the hash-checked loader and the engine wrappers
// (ADR-0078). The corpus (rego.conformance) pins the DECISIONS; this file pins the plumbing
// around them - every way the loader obtains bytes, every way it refuses them, the cache, and
// that the pure-TS grammar test cannot drift from the network's (a property run against the
// engine's own `isOauthEnvelope`).
import {afterEach, describe, expect, it, vi} from 'vitest'
import fc from 'fast-check'
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {
  DEFAULT_REGO_ENTRYPOINT,
  evaluateEnvelope,
  isOauthEnvelope,
  lintEnvelope,
  loadRego,
  packEnvelope,
  RegoEnvelopeError,
  REGO_POLICY_REFUSED,
  REGO_WASM_SHA256,
  unpackEnvelope,
  type OauthPresentation,
} from '../../src/auth/rego.js'
import {canAccess, RecipientStore, validateRule} from '../../src/recipient/store.js'
import {DcqlMalformedError} from '../../src/auth/oid4vp.js'

const WASM_PATH = new URL('../../src/auth/rego/wasm/keykeeper_rego_wasm_bg.wasm', import.meta.url)
const WASM = readFileSync(WASM_PATH)
const GLUE = '../../src/auth/rego/wasm/keykeeper_rego_wasm.js'

/** The fleet's role-only policy (lab/fleet/policies/rego/role-only.*), inline so this stays hermetic. */
const POLICY = 'package tasra.slot\n\ndefault allow := false\n\nallow if "treasury-signer" in input.tokens.kc.claims.realm_access.roles\n'
const ISS = 'https://idp.kk.local/realms/kk'
const AUD = 'https://localhost:19444/authz/43112'
const TOKENS = {kc: {format: 'oauth+access-token+dpop', iss: [ISS], aud: [AUD], max_age_secs: 300}}
const ENVELOPE =
  '{"kk_oauth":{"policy":{"entrypoint":"data.tasra.slot.allow","lang":"rego/v1","source":"package tasra.slot\\n\\ndefault allow := false\\n\\nallow if \\"treasury-signer\\" in input.tokens.kc.claims.realm_access.roles\\n"},' +
  '"tokens":{"kc":{"aud":["https://localhost:19444/authz/43112"],"format":"oauth+access-token+dpop","iss":["https://idp.kk.local/realms/kk"],"max_age_secs":300}},"v":1}}'
const pres = (roles: string[]): OauthPresentation => ({
  holder: `${ISS}#alice`,
  credentials: [{format: 'oauth+access-token+dpop', issuer: ISS, claims: {aud: [AUD], realm_access: {roles}}}],
})

/** A fresh copy of rego.ts (and its glue), so the module-level engine cache starts empty. */
async function freshRego() {
  vi.resetModules()
  return import('../../src/auth/rego.js')
}

afterEach(() => {
  vi.doUnmock(GLUE)
  vi.resetModules()
})

describe('isOauthEnvelope (pure, mirrors keykeeper_dcql::grammar)', () => {
  it.each([
    ['the committed fleet envelope', ENVELOPE],
    ['any value under the one key', '{"kk_oauth":1}'],
    ['surrounding whitespace', ' \t\r\n{ "kk_oauth" : { } } \n'],
    ['an escaped key that decodes to kk_oauth', '{"kk\\u005foauth":{}}'],
    ['every literal and number shape in the value', '{"kk_oauth":[true,false,null,-0,0.5,1E+3,2e-2,12,"\\"\\\\\\/\\b\\f\\n\\r\\t",{}, []]}'],
    ['a lone surrogate escape inside a value', '{"kk_oauth":"\\ud800"}'],
    ['a duplicated key BELOW the top level', '{"kk_oauth":{"a":1,"a":2}}'],
    ['deep nesting (no depth limit on values)', `{"kk_oauth":${'['.repeat(1500)}${']'.repeat(1500)}}`],
  ])('accepts %s', (_label, rule) => {
    expect(isOauthEnvelope(rule)).toBe(true)
  })

  it.each([
    ['empty text', ''],
    ['an empty object', '{}'],
    ['a non-object', '[{"kk_oauth":1}]'],
    ['a duplicated top-level kk_oauth', '{"kk_oauth":1,"kk_oauth":1}'],
    ['a second member', '{"kk_oauth":1,"credentials":[]}'],
    ['another single key', '{"credentials":[]}'],
    ['an OID4VP query', '{"credentials":[{"id":"a","format":"dc+sd-jwt","claims":[{"path":["iss"],"values":["x"]}]}]}'],
    ['a legacy rule', 'verify:demo'],
    ['trailing text', '{"kk_oauth":1} x'],
    ['a top-level trailing comma', '{"kk_oauth":1,}'],
    ['a nested trailing comma (object)', '{"kk_oauth":{"a":1,}}'],
    ['a nested trailing comma (array)', '{"kk_oauth":[1,]}'],
    ['a missing colon', '{"kk_oauth" 1}'],
    ['a nested missing colon', '{"kk_oauth":{"a" 1}}'],
    ['a non-string nested key', '{"kk_oauth":{1:2}}'],
    ['an unterminated value', '{"kk_oauth":[1'],
    ['an unterminated string', '{"kk_oauth":"abc'],
    ['an unterminated key', '{"kk_oau'],
    ['a raw control character in a string', '{"kk_oauth":"a\u0001b"}'],
    ['an unknown escape', '{"kk_oauth":"\\x"}'],
    ['a short \\u escape', '{"kk_oauth":"\\u12"}'],
    ['a non-hex \\u escape', '{"kk_oauth":"\\u12zz"}'],
    ['a leading zero', '{"kk_oauth":01}'],
    ['a bare minus', '{"kk_oauth":-}'],
    ['a fraction with no digits', '{"kk_oauth":1.}'],
    ['an exponent with no digits', '{"kk_oauth":1e+}'],
    ['a misspelt literal', '{"kk_oauth":tru}'],
    ['a value that is no JSON value', '{"kk_oauth":undefined}'],
    ['a missing value', '{"kk_oauth":}'],
    ['a key with a lone low surrogate escape', '{"\\udc00":1}'],
    ['a key with a lone lead surrogate escape', '{"\\ud800":1}'],
    ['a key with a lead surrogate before a plain escape', '{"\\ud800\\n":1}'],
    ['a key with a lead surrogate before a non-low escape', '{"\\ud800\\u0041":1}'],
    ['a key with a paired surrogate', '{"\\ud83d\\ude00":1}'],
    ['a key with an unknown escape', '{"\\q":1}'],
    ['a key with a raw astral character', '{"kk_oauth😀":1}'],
  ])('refuses %s', (_label, rule) => {
    expect(isOauthEnvelope(rule)).toBe(false)
  })

  it('is total for a non-string', () => {
    expect(isOauthEnvelope(42 as unknown as string)).toBe(false)
  })

  it('counts UTF-8 bytes, not UTF-16 units, against MAX_RULE_LEN', () => {
    const wrap = (s: string) => `{"kk_oauth":"${s}"}`
    const overhead = wrap('').length // 15 ASCII bytes
    expect(isOauthEnvelope(wrap('a'.repeat(4096 - overhead)))).toBe(true)
    expect(isOauthEnvelope(wrap('a'.repeat(4097 - overhead)))).toBe(false)
    // 1361 three-byte characters = 4083 bytes, but only 1361 UTF-16 units.
    expect(isOauthEnvelope(wrap('€'.repeat(1361)))).toBe(false)
    expect(isOauthEnvelope(wrap('é'.repeat(2040)))).toBe(true) // 4080 + 15 bytes
    expect(isOauthEnvelope(wrap('😀'.repeat(1020)))).toBe(true) // 4080 + 15 bytes
    expect(isOauthEnvelope(wrap('😀'.repeat(1021)))).toBe(false)
    expect(isOauthEnvelope(wrap('\ud800'.repeat(1360)))).toBe(true) // a lone surrogate encodes as 3 bytes
    expect(isOauthEnvelope(wrap('\ud800'.repeat(1361)))).toBe(false)
  })

  it('agrees with the network engine on generated near-envelopes', async () => {
    await loadRego()
    const glue = (await import(GLUE)) as {isOauthEnvelope(rule: string): boolean}
    const significant = fc.constantFrom('{', '}', '[', ']', ',', ':', '"', '\\', 'u', 'd800', 'dc00', '0', '-', '.', 'e', ' ', '\n', 'kk_oauth', 'true', 'null', '\u0001', 'é', '😀', '\ud800')
    const mutate = (base: string) =>
      fc.tuple(fc.nat({max: base.length}), fc.nat({max: 3}), fc.oneof(significant, fc.string({maxLength: 4})), fc.constantFrom('insert', 'delete', 'replace')).map(
        ([at, len, text, op]) =>
          op === 'insert' ? base.slice(0, at) + text + base.slice(at) : op === 'delete' ? base.slice(0, at) + base.slice(at + len) : base.slice(0, at) + text + base.slice(at + len),
      )
    const json = fc.jsonValue({maxDepth: 4}).map(v => JSON.stringify({kk_oauth: v}))
    const rules = fc.oneof(
      json,
      json.chain(mutate),
      fc.constant(ENVELOPE).chain(mutate),
      fc.constant('{"kk_oauth":1}').chain(mutate),
      fc.array(fc.oneof(significant, fc.string({maxLength: 3})), {maxLength: 12}).map(parts => parts.join('')),
      fc.string(),
    )
    fc.assert(fc.property(rules, rule => isOauthEnvelope(rule) === glue.isOauthEnvelope(rule)), {numRuns: 3000})
  })
})

describe('the engine', () => {
  it('packs the fleet policy into the committed envelope, from an object or JSON text', async () => {
    expect(await packEnvelope(POLICY, TOKENS)).toBe(ENVELOPE)
    expect(await packEnvelope(POLICY, JSON.stringify(TOKENS), DEFAULT_REGO_ENTRYPOINT)).toBe(ENVELOPE)
  })

  it('unpack returns the authored parts and pack(unpack(x)) == x', async () => {
    const u = await unpackEnvelope(ENVELOPE)
    expect(u).toEqual({policy: POLICY, tokens: TOKENS, entrypoint: DEFAULT_REGO_ENTRYPOINT})
    expect(await packEnvelope(u.policy, u.tokens, u.entrypoint)).toBe(ENVELOPE)
  })

  it('lints an admissible envelope with its gate report', async () => {
    expect(await lintEnvelope(ENVELOPE)).toEqual({
      report: {package: 'tasra.slot', rules: 2, functions: [], builtins: [], tokensRead: ['kc'], maxIterDepth: 0},
      admissible: true,
    })
  })

  it('reports a well-formed but not-yet-admissible envelope with the reason', async () => {
    const two = {...TOKENS, kc2: {...TOKENS.kc}}
    const engine = await loadRego()
    // Phase 1 admits one token; packing refuses two, so build the envelope by hand.
    const source = 'package tasra.slot\n\ndefault allow := false\n\nallow if {\n\t"a" in input.tokens.kc.claims.roles\n\t"b" in input.tokens.kc2.claims.roles\n}\n'
    const env = JSON.stringify({kk_oauth: {v: 1, tokens: two, policy: {lang: 'rego/v1', entrypoint: DEFAULT_REGO_ENTRYPOINT, source}}})
    const lint = engine.lint(env)
    expect(lint.admissible).toBe(false)
    expect(lint.admissionError).toMatch(/exactly one entry/)
  })

  it.each([
    ['lint', () => lintEnvelope('{"kk_oauth":1}')],
    ['unpack', () => unpackEnvelope('not json')],
    ['pack (gate refusal)', () => packEnvelope('package tasra.slot\n\nallow if http.send({})\n', TOKENS)],
    ['pack (duplicate token id in JSON text)', () => packEnvelope(POLICY, '{"kc":{},"kc":{}}')],
  ])('%s throws RegoEnvelopeError(malformed)', async (_label, run) => {
    const error = await run().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RegoEnvelopeError)
    expect((error as RegoEnvelopeError).kind).toBe('malformed')
    expect((error as RegoEnvelopeError).retryable).toBe(false)
  })

  it('evaluates allow, a generic policy refusal, and a malformed presentation', async () => {
    expect(await evaluateEnvelope(ENVELOPE, pres(['treasury-signer']))).toEqual({allow: true})
    expect(await evaluateEnvelope(ENVELOPE, pres(['viewer']))).toEqual({allow: false, kind: 'reject', message: REGO_POLICY_REFUSED})
    expect(await evaluateEnvelope(ENVELOPE, JSON.stringify(pres(['treasury-signer'])))).toEqual({allow: true})
    const bad = await evaluateEnvelope(ENVELOPE, 'not json')
    expect(bad).toMatchObject({allow: false, kind: 'malformed'})
  })

  it('exposes the builtin allow-list', async () => {
    const list = (await loadRego()).allowlistV1()
    expect(list).toContain('count')
    expect(list).not.toContain('http.send')
  })

  it('shares one load between concurrent callers', async () => {
    const rego = await freshRego()
    const [a, b] = [rego.loadRego(), rego.loadRego()]
    expect(a).toBe(b)
    await a
  })
})

describe('loadRego sources and refusals', () => {
  it.each([
    ['Uint8Array bytes', () => new Uint8Array(WASM)],
    ['an ArrayBuffer', () => WASM.buffer.slice(WASM.byteOffset, WASM.byteOffset + WASM.byteLength)],
    ['a file: URL string', () => WASM_PATH.href],
  ])('loads from %s after checking its hash', async (_label, source) => {
    const rego = await freshRego()
    const engine = await rego.loadRego({wasm: source()})
    expect(engine.evaluate(ENVELOPE, pres(['treasury-signer']))).toEqual({allow: true})
  })

  it('fetches an http(s) URL with the supplied fetch', async () => {
    const rego = await freshRego()
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(WASM)))
    await rego.loadRego({wasm: new URL('https://cdn.example/engine.wasm'), fetchImpl})
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toBe('https://cdn.example/engine.wasm')
  })

  it('refuses bytes that differ from the pinned build, and does not cache the failure', async () => {
    const rego = await freshRego()
    const tampered = new Uint8Array(WASM)
    tampered[tampered.length - 1]! ^= 1
    await expect(rego.loadRego({wasm: tampered})).rejects.toThrow(`differs from the pinned ${REGO_WASM_SHA256}`)
    const engine = await rego.loadRego({wasm: new Uint8Array(WASM)})
    expect(engine.allowlistV1().length).toBeGreaterThan(0)
  })

  it('reports a failed fetch, retryable only for a server error', async () => {
    const rego = await freshRego()
    const at = (status: number) => rego.loadRego({wasm: 'https://cdn.example/engine.wasm', fetchImpl: async () => new Response('', {status})})
    await expect(at(404)).rejects.toMatchObject({retryable: false, message: expect.stringMatching(/HTTP 404/) as unknown})
    await expect(at(503)).rejects.toMatchObject({retryable: true})
  })

  it('cannot read a file: URL where the runtime has no fs, and says how to load instead', async () => {
    const rego = await freshRego()
    const holder = process as unknown as {getBuiltinModule?: unknown}
    const original = holder.getBuiltinModule
    holder.getBuiltinModule = undefined
    try {
      await expect(rego.loadRego({wasm: pathToFileURL('/nonexistent.wasm')})).rejects.toThrow(/pass `wasm` as bytes/)
    } finally {
      holder.getBuiltinModule = original
    }
  })

  it('drops a trapped engine so the next call loads a fresh instance', async () => {
    const actual = await vi.importActual<Record<string, unknown>>(GLUE)
    let trap = true
    const initSync = vi.fn(actual.initSync as (m: unknown) => unknown)
    vi.doMock(GLUE, () => ({
      ...actual,
      initSync,
      evaluate: (rule: string, p: string) => {
        if (trap) throw new WebAssembly.RuntimeError('unreachable')
        return (actual.evaluate as (r: string, p: string) => string)(rule, p)
      },
    }))
    const rego = await freshRego()
    const first = await rego.loadRego()
    // A fresh module graph has its own TasraError class, so match by name, not identity.
    expect(() => first.evaluate(ENVELOPE, pres(['treasury-signer']))).toThrow(expect.objectContaining({name: 'TasraError'}) as never)
    expect(() => first.evaluate(ENVELOPE, pres(['treasury-signer']))).toThrow(/rego engine trapped: unreachable/)
    trap = false
    const second = await rego.loadRego()
    expect(second).not.toBe(first)
    expect(initSync).toHaveBeenCalledTimes(2)
    expect(second.evaluate(ENVELOPE, pres(['treasury-signer']))).toEqual({allow: true})
  })
})

describe('wallet-side credential paths refuse an envelope by name', () => {
  it('RecipientStore.satisfies and validateRule throw; canAccess is false', () => {
    const store = new RecipientStore([{format: 'jwt_vc_json', types: ['X'], body: {iss: ISS}}])
    expect(() => store.satisfies(ENVELOPE)).toThrow(DcqlMalformedError)
    expect(() => store.satisfies(ENVELOPE)).toThrow(/kk_oauth policy envelope/)
    expect(() => validateRule(ENVELOPE)).toThrow(/use evaluateEnvelope/)
    expect(canAccess(ENVELOPE, store)).toBe(false)
  })
})
