import type {ServiceDiscoveryTransport} from './serviceIdentity.js'

/** Bounded response from the original approved agent; non-success is never a retry instruction. */
export interface PaidAgentHttpResponse {
  /** Observed HTTP status, including consent waits and unknown-delivery failures. */
  status: number
  /** Exact bounded bytes; never log credentials or bearer-bearing creation bodies. */
  body: Uint8Array
  /** Parsed `Retry-After` in ms, when the service sent one. A wait hint, never a resend instruction. */
  retryAfterMs?: number
  /**
   * Raw `Retry-After` header value, when sent. With {@link PaidAgentHttpResponse.rateLimitAfter} it
   * is parsed strictly (integer seconds) to pace a definite 429/503 refusal of a repeatable request.
   */
  retryAfter?: string
  /** Raw `x-ratelimit-after` header value (the agent's per-client limiter), when sent. */
  rateLimitAfter?: string
}

/** Transport for client-owned session initialization, consent and continuation. */
export interface PaidAgentTransport extends ServiceDiscoveryTransport {
  /** Require verified TLS, connection-time destination checks, no redirects and cancellation. */
  paidAgentRequest(url: string, options: {
    /** Explicit method, including bodyless refusal/continuation POSTs. */
    method: 'GET' | 'POST'
    /** Complete client-built JSON bytes, when this route accepts a body. */
    body?: Uint8Array
    /** Owner bearer only on authenticated session control paths. */
    bearer?: string
    /** Exact OAuth artifacts; permitted only on the original session's OAuth-response POST. */
    oauth?: {accessToken: string; proof: string}
    /** Maximum response bytes; caller must also validate the protocol envelope. */
    maxBytes: number
    /** Cancellation and deadline owned by the client. */
    signal: AbortSignal
  }): Promise<PaidAgentHttpResponse>
}
