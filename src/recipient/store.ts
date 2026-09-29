// In-memory credential matching for advisory access checks. No network requests
// are made; network authorization still depends on credential verification.

import {evaluate, validate, DcqlMalformedError, jsonCredential, type CredentialView} from '../auth/oid4vp.js'

/**
 * One credential the recipient holds, described as a structured credential view.
 * Build these from your own store of verifiable credentials / verifier JWTs.
 */
export interface HeldCredential {
  /** The credential's format identifier (e.g. `"jwt_vc_json"`). */
  format: string
  /** The credential's type list (for `jwt_vc_json`, its `type` array). */
  types: readonly string[]
  /** The parsed credential body (JSON object with claims). */
  body: unknown
}

/**
 * A recipient's local credential store. Holds structured credentials and
 * evaluates them against DCQL rules for advisory matching. It does not verify
 * credential signatures or establish issuer trust.
 *
 * Everything here is in-memory and synchronous: deciding access reveals nothing
 * to the platform.
 */
export class RecipientStore {
  /** Held credential views used for local policy evaluation. */
  private readonly credentials: CredentialView[]

  constructor(credentials: (HeldCredential | CredentialView)[] = []) {
    this.credentials = credentials.map(c =>
      'claim' in c && typeof c.claim === 'function'
        ? c
        : jsonCredential(c as HeldCredential),
    )
  }

  /** Add a credential (returns `this` for chaining). */
  add(credential: HeldCredential | CredentialView): this {
    this.credentials.push(
      'claim' in credential && typeof credential.claim === 'function'
        ? credential
        : jsonCredential(credential as HeldCredential),
    )
    return this
  }

  /** The credential views held in this store. */
  views(): readonly CredentialView[] {
    return this.credentials
  }

  /**
   * Check whether held credential views match the DCQL rule without network access.
   *
   * @returns Whether the supplied credential views satisfy the rule; this is not network authorization.
   * @throws {DcqlMalformedError} if the rule itself is broken (a slot-author
   *   bug - the same class the node returns as 400, not a 403 deny). Callers
   *   who want a never-throwing check should use {@link canAccess}.
   */
  satisfies(rule: string): boolean {
    return evaluate(rule, this.credentials)
  }

  /**
   * Build a store from parsed JWT credential bodies.
   * Each entry needs a `type` array and an `iss` field in the body at minimum.
   */
  static fromJwtBodies(
    bodies: Array<{type: string[]; iss: string; [key: string]: unknown}>,
  ): RecipientStore {
    const held: HeldCredential[] = bodies.map(b => ({
      format: 'jwt_vc_json',
      types: b.type,
      body: b,
    }))
    return new RecipientStore(held)
  }
}

/**
 * Check whether held credential views match a DCQL rule without network access.
 *
 * Accepts a {@link RecipientStore} or a bare {@link HeldCredential} list.
 * Unlike {@link RecipientStore.satisfies}, a malformed rule returns `false`
 * (fail-closed) rather than throwing.
 *
 * @param rule - DCQL policy encoded as JSON text.
 * @param store - Held credential views used for the local access decision.
 */
export function canAccess(rule: string, store: RecipientStore | HeldCredential[]): boolean {
  const s = Array.isArray(store) ? new RecipientStore(store) : store
  try {
    return s.satisfies(rule)
  } catch (e) {
    if (e instanceof DcqlMalformedError) return false
    throw e
  }
}

/**
 * Explicitly validate a slot's rule client-side: returns normally if well-formed,
 * throws {@link DcqlMalformedError} otherwise.
 *
 * @param rule - DCQL policy encoded as JSON text.
 */
export function validateRule(rule: string): void {
  validate(rule)
}
