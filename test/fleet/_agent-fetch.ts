// The SDK's plain verifier-agent calls (`createOauthSession`, `submitOauthResponse`,
// `waitForSession`) use the global fetch, which trusts only the public roots. A local fleet's
// agent presents a certificate of the fleet's own CA (KK_WALLET_CA_FILE), so requests to the ONE
// approved agent origin go through node:https with that CA here. Certificate and hostname
// verification stay on; redirects are refused; every other origin keeps the original fetch.
import assert from 'node:assert/strict'
import {request} from 'node:https'

const MAX_REPLY_BYTES = 1_048_576

/** A fetch for the approved agent origin only, trusting the public roots plus `ca`. */
export function agentOriginFetch(endpoint: string, ca: string | undefined, fallback: typeof fetch = globalThis.fetch): typeof fetch {
  const origin = new URL(endpoint)
  assert(origin.protocol === 'https:' && !origin.username && !origin.password && !origin.search && !origin.hash, 'Approved agent endpoint must be a plain HTTPS origin')
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (url.origin !== origin.origin) return fallback(input, init)
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((value, name) => { headers[name] = value })
    const body = init?.body == null ? undefined : typeof init.body === 'string' ? init.body
      : init.body instanceof URLSearchParams ? init.body.toString() : undefined
    assert(init?.body == null || body !== undefined, 'Agent fetch carries text bodies only')
    const signal = init?.signal ?? AbortSignal.timeout(60_000)
    signal.throwIfAborted()
    return new Promise<Response>((resolve, reject) => {
      const req = request(url, {method: init?.method ?? 'GET', agent: false, signal, rejectUnauthorized: true, ...(ca ? {ca} : {}),
        headers: {...headers, 'accept-encoding': 'identity', ...(body !== undefined ? {'content-length': Buffer.byteLength(body)} : {})}}, res => {
        const status = res.statusCode ?? 0
        // A redirect would carry the session secret elsewhere: refuse it.
        if (status >= 300 && status < 400) { req.destroy(); reject(new Error(`Agent redirect refused (HTTP ${status})`)); return }
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > MAX_REPLY_BYTES) { req.destroy(); reject(new Error('Agent reply too large')); return }
          chunks.push(chunk)
        })
        res.on('error', reject)
        res.on('end', () => {
          const replyHeaders = new Headers()
          for (const [name, value] of Object.entries(res.headers)) if (value !== undefined) replyHeaders.set(name, Array.isArray(value) ? value.join(', ') : value)
          const bytes = Buffer.concat(chunks, size)
          resolve(new Response([204, 205, 304].includes(status) ? null : bytes, {status, headers: replyHeaders}))
        })
      })
      req.on('error', reject)
      req.end(body)
    })
  }
}

/** Route this process's global fetch to the approved agent origin through {@link agentOriginFetch}. */
export function installAgentFetch(endpoint: string, ca: string | undefined): void {
  globalThis.fetch = agentOriginFetch(endpoint, ca)
}
