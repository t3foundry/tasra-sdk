/* tslint:disable */
/* eslint-disable */

/**
 * The allow-list this build enforces (the corpus pins it).
 */
export function allowlistV1(): string;

/**
 * Evaluate `rule` against a presentation `{"holder": "...", "credentials": [{"format",
 * "issuer", "claims"}]}` - the shape the fault bridge projects a sealed presentation onto.
 * `{"ok": true}` iff the policy allows; a refusal carries the network's generic reason.
 */
export function evaluate(rule: string, presentation_json: string): string;

/**
 * Is `rule` a `kk_oauth` envelope? The SAME structural test every network dispatch site asks
 * (`keykeeper_dcql::grammar`).
 */
export function isOauthEnvelope(rule: string): boolean;

/**
 * Authoring check (schema + gate, any phase) plus whether a keeper would ADMIT it today.
 * `{"ok": true, "report": {...}, "admissible": bool, "admission_error": "..."|null}`.
 */
export function lint(envelope: string): string;

/**
 * Pack `(source, tokens JSON text, entrypoint)` into the committed (RFC 8785) envelope.
 * `{"ok": true, "envelope": "<packed>"}`.
 */
export function pack(source: string, tokens_json: string, entrypoint: string): string;

/**
 * `{"ok": true, "source": "...", "tokens": {...}, "entrypoint": "..."}`.
 */
export function unpack(envelope: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly allowlistV1: (a: number) => void;
    readonly evaluate: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly isOauthEnvelope: (a: number, b: number) => number;
    readonly lint: (a: number, b: number, c: number) => void;
    readonly pack: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly unpack: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export: (a: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export3: (a: number, b: number) => number;
    readonly __wbindgen_export4: (a: number, b: number, c: number, d: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
