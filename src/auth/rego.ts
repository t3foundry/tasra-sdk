// OAuth policy envelopes (`kk_oauth`, ADR-0078): a Rego policy over the claims of an
// organization's own DPoP-bound access token, committed as a slot's rule.
//
// TWO HALVES, deliberately different:
//
//   1. `isOauthEnvelope` is pure TypeScript. It is the grammar dispatch the rule commitment
//      needs (an envelope is committed in RFC 8785 canonical form, like an OID4VP query), so
//      computing or checking a commitment never has to load WebAssembly. It mirrors
//      `keykeeper_dcql::grammar` byte for byte: one JSON object whose ONLY member is
//      `kk_oauth`, a duplicated `kk_oauth` is NOT an envelope, and a rule longer than
//      MAX_RULE_LEN UTF-8 bytes never is.
//
//   2. Everything that reads INSIDE an envelope - pack, unpack, lint (schema + static gate),
//      evaluate - runs the network's own `keykeeper-rego` crate compiled to WebAssembly. There
//      is no TypeScript reimplementation of the gate or the evaluator: the SDK's verdict is the
//      verdict the drawn verifiers and the accountants reach, because it is the same code at the
//      same regorus pin. The shared corpus (test/rego-vectors.json) proves it.
//
// The .wasm (~1 MB) is loaded on first use only, from beside this module, and its SHA-256 is
// checked against the pinned build BEFORE it is instantiated. Nothing here sets a timer:
// regorus's execution timer panics on wasm32, and on the client the static gate's bounds are
// the whole bound (it is the caller's own CPU).

import {TasraError} from '../errors.js'
import {MAX_RULE_LEN} from './oid4vp.js'

/** The single top-level member that marks a rule as an OAuth policy envelope. */
export const OAUTH_ENVELOPE_KEY = 'kk_oauth'

/** Entrypoint the network's example policies use (`package tasra.slot`). */
export const DEFAULT_REGO_ENTRYPOINT = 'data.tasra.slot.allow'

/**
 * The refusal text a holder sees when an envelope's policy denies. Deliberately generic: rule
 * contents are confidential to the operator set, so a refusal never names a claim or clause.
 */
export const REGO_POLICY_REFUSED = 'kk_oauth policy refused'

/**
 * SHA-256 of the vendored `keykeeper_rego_wasm_bg.wasm`, as recorded in its PINS.json.
 * `scripts/check-rego-pins.mjs` asserts the two agree, so this constant cannot drift from the
 * pinned build.
 */
export const REGO_WASM_SHA256 = '09ed834a292b7a0e79e4da32af21027c740e5cbe705d9eb69ee425bd8beba88a'

// ─── grammar dispatch (pure) ─────────────────────────────────────────────────

/**
 * Whether `rule` is a `kk_oauth` policy envelope: a JSON object whose only member is
 * `kk_oauth`. Structural only - the envelope's contents are not validated (use
 * {@link lintEnvelope}). Total: never throws.
 *
 * Matches the network's grammar dispatch exactly, so the SDK commits an envelope the same way
 * every keeper and verifier re-derives it. A duplicated `kk_oauth` member is not an envelope,
 * and neither is anything longer than `MAX_RULE_LEN` UTF-8 bytes.
 *
 * @param rule - Clear rule text to classify.
 */
export function isOauthEnvelope(rule: string): boolean {
  if (typeof rule !== 'string' || utf8Length(rule) > MAX_RULE_LEN) return false
  return new TopLevelScan(rule).onlyEnvelopeKey()
}

/** UTF-8 length of a JS string as `TextEncoder` would encode it (a lone surrogate is 3 bytes). */
function utf8Length(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && isLowSurrogate(s.charCodeAt(i + 1))) {
      n += 4
      i++
    } else n += 3
  }
  return n
}

function isLowSurrogate(c: number): boolean {
  return c >= 0xdc00 && c <= 0xdfff
}

/** Thrown inside the scanner only; {@link isOauthEnvelope} turns it into `false`. */
class NotJson extends Error {}

/**
 * A strict RFC 8259 scanner that reads the top-level object's member NAMES and skips every
 * value without materialising it - the same walk serde_json does for the network's check
 * (`next_key::<Cow<str>>` + `IgnoredAny`). Two details are serde_json's, not JSON.parse's:
 *
 *  - a top-level member name is decoded strictly: a `\u` escape naming an unpaired surrogate
 *    is an error there, while inside a VALUE any four hex digits are accepted;
 *  - values carry no depth limit (serde_json skips ignored values iteratively).
 */
class TopLevelScan {
  private i = 0
  constructor(private readonly s: string) {}

  onlyEnvelopeKey(): boolean {
    try {
      this.ws()
      this.expect(0x7b) // {
      this.ws()
      let members = 0
      let onlyEnvelope = true
      if (this.peek() === 0x7d) {
        this.i++
      } else {
        for (;;) {
          this.expect(0x22) // "
          const key = this.string(true)
          this.ws()
          this.expect(0x3a) // :
          this.value()
          members++
          if (key !== OAUTH_ENVELOPE_KEY) onlyEnvelope = false
          this.ws()
          if (this.peek() === 0x2c) {
            this.i++
            this.ws()
            continue
          }
          this.expect(0x7d)
          break
        }
      }
      this.ws()
      if (this.i !== this.s.length) return false
      return onlyEnvelope && members === 1
    } catch (e) {
      if (e instanceof NotJson) return false
      throw e
    }
  }

  private peek(): number {
    return this.i < this.s.length ? this.s.charCodeAt(this.i) : -1
  }

  private expect(c: number): void {
    if (this.peek() !== c) throw new NotJson()
    this.i++
  }

  private ws(): void {
    for (;;) {
      const c = this.peek()
      if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) this.i++
      else return
    }
  }

  private hex4(): number {
    if (this.i + 4 > this.s.length) throw new NotJson()
    const h = this.s.slice(this.i, this.i + 4)
    if (!/^[0-9a-fA-F]{4}$/.test(h)) throw new NotJson()
    this.i += 4
    return parseInt(h, 16)
  }

  /** After the opening quote. Returns the decoded text when `decode`, else ''. */
  private string(decode: boolean): string {
    let out = ''
    for (;;) {
      const c = this.peek()
      if (c < 0) throw new NotJson()
      this.i++
      if (c === 0x22) return out
      if (c < 0x20) throw new NotJson()
      if (c !== 0x5c) {
        if (decode) out += String.fromCharCode(c)
        continue
      }
      const e = this.peek()
      this.i++
      switch (e) {
        case 0x22: out += decode ? '"' : ''; break
        case 0x5c: out += decode ? '\\' : ''; break
        case 0x2f: out += decode ? '/' : ''; break
        case 0x62: out += decode ? '\b' : ''; break
        case 0x66: out += decode ? '\f' : ''; break
        case 0x6e: out += decode ? '\n' : ''; break
        case 0x72: out += decode ? '\r' : ''; break
        case 0x74: out += decode ? '\t' : ''; break
        case 0x75: {
          const n = this.hex4()
          if (!decode) break
          if (isLowSurrogate(n)) throw new NotJson()
          if (n >= 0xd800 && n <= 0xdbff) {
            if (this.peek() !== 0x5c) throw new NotJson()
            this.i++
            if (this.peek() !== 0x75) throw new NotJson()
            this.i++
            const n2 = this.hex4()
            if (!isLowSurrogate(n2)) throw new NotJson()
            out += String.fromCharCode(n, n2)
          } else out += String.fromCharCode(n)
          break
        }
        default:
          throw new NotJson()
      }
    }
  }

  private digits(): number {
    const start = this.i
    while (this.peek() >= 0x30 && this.peek() <= 0x39) this.i++
    return this.i - start
  }

  private number(): void {
    if (this.peek() === 0x2d) this.i++
    const first = this.peek()
    if (first === 0x30) {
      this.i++
    } else if (first >= 0x31 && first <= 0x39) {
      this.digits()
    } else throw new NotJson()
    if (this.peek() === 0x2e) {
      this.i++
      if (this.digits() === 0) throw new NotJson()
    }
    if (this.peek() === 0x65 || this.peek() === 0x45) {
      this.i++
      if (this.peek() === 0x2b || this.peek() === 0x2d) this.i++
      if (this.digits() === 0) throw new NotJson()
    }
  }

  private literal(text: string): void {
    if (this.s.startsWith(text, this.i)) this.i += text.length
    else throw new NotJson()
  }

  /** Skip one value, iteratively (an explicit stack, so nesting depth costs no call stack). */
  private value(): void {
    const stack: number[] = []
    for (;;) {
      this.ws()
      const c = this.peek()
      let opened = false
      if (c === 0x7b || c === 0x5b) {
        this.i++
        this.ws()
        const close = c === 0x7b ? 0x7d : 0x5d
        if (this.peek() === close) this.i++
        else {
          stack.push(c)
          opened = true
          if (c === 0x7b) this.memberName()
        }
      } else if (c === 0x22) {
        this.i++
        this.string(false)
      } else if (c === 0x2d || (c >= 0x30 && c <= 0x39)) {
        this.number()
      } else if (c === 0x74) this.literal('true')
      else if (c === 0x66) this.literal('false')
      else if (c === 0x6e) this.literal('null')
      else throw new NotJson()
      if (opened) continue
      // A value just ended: close every container it completes.
      for (;;) {
        const top = stack[stack.length - 1]
        if (top === undefined) return
        this.ws()
        const d = this.peek()
        if (d === 0x2c) {
          this.i++
          if (top === 0x7b) {
            this.ws()
            this.memberName()
          }
          break
        }
        if (d === (top === 0x7b ? 0x7d : 0x5d)) {
          this.i++
          stack.pop()
          continue
        }
        throw new NotJson()
      }
    }
  }

  /** A nested member name and its colon (names below the top level are not decoded). */
  private memberName(): void {
    this.expect(0x22)
    this.string(false)
    this.ws()
    this.expect(0x3a)
  }
}

// ─── the wasm engine ─────────────────────────────────────────────────────────

/** One token an envelope trusts: its format, issuers, audiences and freshness bound. */
export interface OauthTokenSpec {
  /** Token format; phase 1 admits `oauth+access-token+dpop` only. */
  format: string
  /** Accepted issuers, each byte-equal to the IdP's discovery `issuer`. */
  iss: string[]
  /** Audiences the token must carry (the platform audience the tenant registered). */
  aud: string[]
  /** Maximum token age in seconds (1..=86400). */
  max_age_secs: number
  /** Top-level claim names also exposed lower-cased under `claims_ci`. */
  ci_claims?: string[]
}

/** The envelope's token map: token id (`^[a-z][a-z0-9_]{0,31}$`) to its specification. */
export type OauthTokens = Record<string, OauthTokenSpec>

/** The authored parts of an envelope. */
export interface OauthPolicyInput {
  /** Rego v1 module source, committed byte for byte. */
  policy: string
  /** Token specifications, as an object or as the JSON text of one. */
  tokens: OauthTokens | string
  /** Rule to evaluate; defaults to {@link DEFAULT_REGO_ENTRYPOINT}. */
  entrypoint?: string
}

/** An envelope taken apart: the exact policy source, its tokens and its entrypoint. */
export interface UnpackedEnvelope {
  /** Rego source exactly as committed. */
  policy: string
  /** Token specifications. */
  tokens: OauthTokens
  /** Entrypoint rule. */
  entrypoint: string
}

/** What the static gate found in a policy. */
export interface EnvelopeGateReport {
  /** The module's package. */
  package: string
  /** Number of rules defined. */
  rules: number
  /** User-defined function names. */
  functions: string[]
  /** Builtins the policy calls (all from the allow-list). */
  builtins: string[]
  /** Token ids the policy reads. */
  tokensRead: string[]
  /** Deepest iteration nesting. */
  maxIterDepth: number
}

/** Result of {@link lintEnvelope}. */
export interface EnvelopeLint {
  /** The gate's report. */
  report: EnvelopeGateReport
  /** Whether a keeper would store this envelope today (current phase limits included). */
  admissible: boolean
  /** Why it is not admissible, when it is not. */
  admissionError?: string
}

/** The presentation an envelope is evaluated against: the verified claims of each token. */
export interface OauthPresentation {
  /** Stable holder identity (`{iss}#{sub}` on the network). */
  holder: string
  /** One entry per presented token. */
  credentials: {
    /** Token format, e.g. `oauth+access-token+dpop`. */
    format: string
    /** The token's `iss`. */
    issuer: string
    /** The token's verified payload. */
    claims: Record<string, unknown>
  }[]
}

/**
 * A local evaluation verdict. `reject`: the policy (or a platform pin such as issuer or
 * audience) refused this presentation. `malformed`: the rule itself is unusable.
 */
export type EnvelopeVerdict =
  | {allow: true}
  | {allow: false; kind: 'reject' | 'malformed'; message: string}

/** A refused envelope operation: the rule or its authored parts are malformed. */
export class RegoEnvelopeError extends TasraError {
  /** `malformed` for a schema or gate failure; `reject` never reaches this class. */
  readonly kind: 'malformed' | 'reject'
  constructor(kind: 'malformed' | 'reject', message: string) {
    super(message, {retryable: false})
    this.kind = kind
  }
}

/** The loaded engine. Every method is synchronous once loaded. */
export interface RegoEngine {
  /** Pack authored parts into the canonical envelope; throws {@link RegoEnvelopeError}. */
  pack(input: OauthPolicyInput): string
  /** Take an envelope apart; throws {@link RegoEnvelopeError}. */
  unpack(envelope: string): UnpackedEnvelope
  /** Schema + gate report and admissibility; throws {@link RegoEnvelopeError} when malformed. */
  lint(envelope: string): EnvelopeLint
  /**
   * Evaluate the policy against a presentation (an object, or its JSON text verbatim - the
   * lossless form for claims holding integers beyond 2^53). Never throws for a refusal.
   */
  evaluate(rule: string, presentation: OauthPresentation | string): EnvelopeVerdict
  /** The builtin allow-list this build enforces. */
  allowlistV1(): string[]
}

/** Where {@link loadRego} reads the module from. */
export interface LoadRegoOptions {
  /**
   * The .wasm bytes, or a URL to fetch them from. Defaults to the module shipped beside this
   * file. Whatever the source, the bytes must hash to {@link REGO_WASM_SHA256}.
   */
  wasm?: BufferSource | URL | string
  /** HTTP implementation used for a non-`file:` URL. */
  fetchImpl?: typeof fetch
}

interface Glue {
  initSync(module: {module: BufferSource}): unknown
  isOauthEnvelope(rule: string): boolean
  pack(source: string, tokensJson: string, entrypoint: string): string
  unpack(envelope: string): string
  lint(envelope: string): string
  evaluate(rule: string, presentationJson: string): string
  allowlistV1(): string
}

let engine: Promise<RegoEngine> | undefined

/**
 * Load the policy engine once and reuse it. The module's SHA-256 is verified before it is
 * instantiated; a mismatch refuses to load. Concurrent callers share one load.
 *
 * In a bundler that does not emit assets referenced through `new URL(..., import.meta.url)`,
 * pass `wasm` explicitly (bytes or a URL).
 *
 * @param opts - Optional module source and HTTP implementation.
 */
export function loadRego(opts: LoadRegoOptions = {}): Promise<RegoEngine> {
  if (engine) return engine
  const loading = instantiate(opts)
  engine = loading
  loading.catch(() => {
    if (engine === loading) engine = undefined
  })
  return loading
}

async function instantiate(opts: LoadRegoOptions): Promise<RegoEngine> {
  const bytes = await wasmBytes(opts)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const hex = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('')
  if (hex !== REGO_WASM_SHA256) {
    throw new TasraError(`rego wasm sha256 ${hex} differs from the pinned ${REGO_WASM_SHA256}; refusing to load it`)
  }
  const glue = (await import('./rego/wasm/keykeeper_rego_wasm.js')) as unknown as Glue
  glue.initSync({module: bytes})
  return wrap(glue)
}

async function wasmBytes(opts: LoadRegoOptions): Promise<Uint8Array<ArrayBuffer>> {
  const src = opts.wasm
  if (src instanceof ArrayBuffer) return new Uint8Array(src.slice(0))
  if (ArrayBuffer.isView(src)) return new Uint8Array(src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength))
  const url = src === undefined ? new URL('./rego/wasm/keykeeper_rego_wasm_bg.wasm', import.meta.url) : new URL(String(src))
  if (url.protocol === 'file:') {
    // Node reads its own install directly; `getBuiltinModule` keeps any `node:` import out of
    // this module's graph, so browser bundles never see one.
    const fs = (globalThis as {process?: {getBuiltinModule?: (id: string) => unknown}}).process?.getBuiltinModule?.('node:fs') as
      | {readFileSync(path: URL): Uint8Array}
      | undefined
    if (!fs) throw new TasraError('loadRego: cannot read a file: URL here; pass `wasm` as bytes or an http(s) URL')
    const b = fs.readFileSync(url)
    return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)
  }
  const res = await (opts.fetchImpl ?? fetch)(url)
  if (!res.ok) throw new TasraError(`loadRego: fetching ${url.href} answered HTTP ${res.status}`, {retryable: res.status >= 500})
  return new Uint8Array(await res.arrayBuffer())
}

type Reply = {ok: true} & Record<string, unknown>
type Refusal = {ok: false; kind: 'malformed' | 'reject'; message: string}

function wrap(glue: Glue): RegoEngine {
  // A trap (a panic compiled with panic=abort) leaves the instance in an unknown state, so the
  // cached engine is dropped and the next call loads a fresh one.
  const call = (f: () => string): Reply | Refusal => {
    let text: string
    try {
      text = f()
    } catch (e) {
      engine = undefined
      throw new TasraError(`rego engine trapped: ${e instanceof Error ? e.message : String(e)}`, {cause: e})
    }
    return JSON.parse(text) as Reply | Refusal
  }
  const ok = (r: Reply | Refusal): Reply => {
    if (!r.ok) throw new RegoEnvelopeError(r.kind, r.message)
    return r
  }
  return {
    pack(input) {
      const tokens = typeof input.tokens === 'string' ? input.tokens : JSON.stringify(input.tokens)
      return ok(call(() => glue.pack(input.policy, tokens, input.entrypoint ?? DEFAULT_REGO_ENTRYPOINT))).envelope as string
    },
    unpack(envelope) {
      const r = ok(call(() => glue.unpack(envelope)))
      return {policy: r.source as string, tokens: r.tokens as OauthTokens, entrypoint: r.entrypoint as string}
    },
    lint(envelope) {
      const r = ok(call(() => glue.lint(envelope)))
      const g = r.report as {package: string; rules: number; functions: string[]; builtins: string[]; tokens_read: string[]; max_iter_depth: number}
      return {
        report: {package: g.package, rules: g.rules, functions: g.functions, builtins: g.builtins, tokensRead: g.tokens_read, maxIterDepth: g.max_iter_depth},
        admissible: r.admissible === true,
        ...(typeof r.admission_error === 'string' ? {admissionError: r.admission_error} : {}),
      }
    },
    evaluate(rule, presentation) {
      const text = typeof presentation === 'string' ? presentation : JSON.stringify(presentation)
      const r = call(() => glue.evaluate(rule, text))
      return r.ok ? {allow: true} : {allow: false, kind: r.kind, message: r.message}
    },
    allowlistV1() {
      return JSON.parse(glue.allowlistV1()) as string[]
    },
  }
}

/**
 * Pack a Rego policy and its token specifications into the canonical (RFC 8785) envelope a
 * slot commits to. The policy source is committed byte for byte - reformatting it is an
 * amendment. Refuses (with {@link RegoEnvelopeError}) anything the static gate refuses.
 *
 * @param policy - Rego v1 module source.
 * @param tokens - Token specifications (object or JSON text). Duplicate keys in JSON text are refused.
 * @param entrypoint - Rule to evaluate; defaults to {@link DEFAULT_REGO_ENTRYPOINT}.
 * @returns The envelope string to pass as the slot's rule.
 */
export async function packEnvelope(policy: string, tokens: OauthTokens | string, entrypoint?: string): Promise<string> {
  return (await loadRego()).pack({policy, tokens, entrypoint})
}

/**
 * Take an envelope apart into its exact policy source, tokens and entrypoint.
 * `packEnvelope(unpacked.policy, unpacked.tokens, unpacked.entrypoint)` reproduces it.
 *
 * @param envelope - Envelope rule text.
 */
export async function unpackEnvelope(envelope: string): Promise<UnpackedEnvelope> {
  return (await loadRego()).unpack(envelope)
}

/**
 * Run the schema and static gate and report whether a keeper would store the envelope today.
 * Throws {@link RegoEnvelopeError} when the envelope is malformed; an envelope valid in a later
 * phase but not admissible now returns `admissible: false` with the reason.
 *
 * @param envelope - Envelope rule text.
 */
export async function lintEnvelope(envelope: string): Promise<EnvelopeLint> {
  return (await loadRego()).lint(envelope)
}

/**
 * Evaluate an envelope against a presentation locally - the same gate and evaluator the
 * network's verifiers run. Advisory: the network still verifies the token, its DPoP proof,
 * its age and audience before any policy runs, which this does not.
 *
 * @param rule - Envelope rule text.
 * @param presentation - Holder and the verified claims of each presented token, or its JSON
 *   text passed verbatim (keeps integers beyond 2^53 exact, as the network reads them).
 */
export async function evaluateEnvelope(rule: string, presentation: OauthPresentation | string): Promise<EnvelopeVerdict> {
  return (await loadRego()).evaluate(rule, presentation)
}
