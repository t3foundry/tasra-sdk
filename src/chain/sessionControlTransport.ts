import type {AgentTransport} from './registeredAgent.js'

/** Bounded response from the approved agent's session control routes; non-success is never a retry instruction. */
export interface SessionControlHttpResponse {
  /** Observed HTTP status (204 for an acknowledged revoke, a typed refusal otherwise). */
  status: number
  /** Exact bounded bytes. */
  body: Uint8Array
  /** Parsed `Retry-After` in ms, when the service sent one. A wait hint, never a resend instruction. */
  retryAfterMs?: number
}

/**
 * Transport for a session grant's refresh and revoke (`POST /v1/sessions/refresh|revoke`). The
 * routes carry no bearer: the session-key signature in the body is their authorization.
 */
export interface SessionControlTransport {
  /** Require verified TLS, connection-time destination checks, no redirects and cancellation. */
  sessionControlRequest(url: string, options: {
    /** Complete client-built JSON bytes. */
    body: Uint8Array
    /** Maximum response bytes; the caller must also validate the protocol envelope. */
    maxBytes: number
    /** Cancellation and deadline owned by the client. */
    signal: AbortSignal
  }): Promise<SessionControlHttpResponse>
}

/**
 * One guarded transport for everything a client sends to an approved verifier-agent: discovery,
 * session creation and polling ({@link AgentTransport}) and session-grant refresh and revoke
 * ({@link SessionControlTransport}). `createNodeAgentTransport` and `createBrowserAgentTransport`
 * return it.
 */
export type SessionAgentTransport = AgentTransport & SessionControlTransport
