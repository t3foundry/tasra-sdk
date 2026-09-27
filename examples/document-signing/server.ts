import { createServer, type IncomingMessage } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import { pollOid4vpSession } from 'tasra-sdk/verifier-agent'
import { verifyCompactJws } from 'tasra-sdk/oid4vp'
import { loadService, liveBackend, readKey } from './backend.js'
import { deployment, verifierAgentUrl } from './config.js'
import { Store, lockDirectory } from './store.js'
import {
  Workflow,
  publicView,
  Conflict,
  type RequestRecord,
} from './workflow.js'
import {
  people,
  verifyBundle,
  type Person,
  type Manifest,
  type Bundle,
} from './model.js'

const port = Number(process.env.PORT ?? 4177)
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid PORT')
const origin = `http://127.0.0.1:${port}`,
  host = `127.0.0.1:${port}`
const config = loadService(),
  store = new Store<RequestRecord>(),
  unlock = lockDirectory()
const workflow = new Workflow(store, liveBackend(config), {
  chainId: deployment.chainId,
  keyRegistry: deployment.addresses.KeyRegistry!,
  slots: config.slots,
})
workflow.recover()
function owner(req: IncomingMessage) {
  const supplied = Buffer.from(
      req.headers.authorization?.replace(/^Bearer /, '') ?? '',
    ),
    expected = Buffer.from(config.senderToken)
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    throw new Conflict(
      'Open the private sender-console link printed by the server',
    )
}
async function body(
  req: IncomingMessage,
  limit = 12 * 1024 * 1024,
): Promise<Record<string, unknown>> {
  if (!req.headers['content-type']?.startsWith('application/json'))
    throw new Error('Expected JSON')
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of req) {
    length += (chunk as Buffer).length
    if (length > limit) throw new Error('Request too large')
    chunks.push(chunk as Buffer)
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected JSON object')
  return value as Record<string, unknown>
}
const text = (v: unknown) => {
  if (typeof v !== 'string') throw new Error('Expected text')
  return v
}
const server = createServer((req, res) => {
  void (async () => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-src 'self' blob:; object-src 'self' blob:; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
    )
    const json = (value: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(value))
    }
    try {
      if (req.headers.host !== host)
        throw new Conflict('Unexpected host; use the printed loopback URL')
      if (req.method !== 'GET' && req.headers.origin !== origin)
        throw new Conflict('Unexpected request origin')
      const url = new URL(req.url ?? '/', origin),
        path = url.pathname
      if (req.method === 'GET' && path === '/api/config')
        return json({
          chainId: deployment.chainId,
          keyRegistry: deployment.addresses.KeyRegistry,
          verifierAgentUrl,
          slots: config.slots,
        })
      if (path === '/api/requests') {
        owner(req)
        if (req.method === 'GET')
          return json(store.list().map(publicView).reverse())
        if (req.method === 'POST') {
          const b = await body(req)
          return json(
            await workflow.create({
              id: text(b.id),
              title: text(b.title),
              version: Number(b.version),
              pdf: Buffer.from(text(b.pdfBase64), 'base64'),
            }),
            201,
          )
        }
      }
      if (req.method === 'POST' && path === '/api/verify') {
        const b = await body(req)
        // The caller supplies its independently saved expected request, not one inferred from the bundle.
        const expected = b.expected as Manifest
        if (
          expected.chainId !== deployment.chainId ||
          expected.keyRegistry !== deployment.addresses.KeyRegistry
        )
          throw new Error('Unexpected deployment')
        await verifyBundle(
          Buffer.from(text(b.pdfBase64), 'base64'),
          expected,
          b.bundle as Bundle,
          readKey,
        )
        return json({
          verified: true,
          policy: 'Current anchored signer keys; not an archival timestamp',
        })
      }
      const match = /^\/api\/requests\/([0-9a-f-]{36})(?:\/(.*))?$/i.exec(path)
      if (match) {
        const id = match[1]!,
          action = match[2] ?? '',
          record = store.get(id)
        if (req.method === 'GET') {
          if (!action) return json(publicView(record))
          if (action === 'pdf') {
            res.setHeader('Content-Security-Policy', "frame-ancestors 'self'")
            res.writeHead(200, {
              'content-type': 'application/pdf',
              'content-disposition': 'inline; filename="document.pdf"',
            })
            res.end(Buffer.from(record.pdfBase64, 'base64'))
            return
          }
          if (action === 'request') {
            res.writeHead(200, {
              'content-type': 'application/json',
              'content-disposition': 'attachment; filename="request.json"',
            })
            res.end(JSON.stringify(record.manifest, null, 2))
            return
          }
          if (action === 'bundle') {
            if (record.status !== 'completed')
              throw new Conflict('Both signatures are required')
            const bundle = {
              manifest: record.manifest,
              signatures: people.map((p) => record.signers[p].signature!),
            }
            await verifyBundle(
              Buffer.from(record.pdfBase64, 'base64'),
              record.manifest,
              bundle,
              readKey,
            )
            res.writeHead(200, {
              'content-type': 'application/json',
              'content-disposition': 'attachment; filename="signatures.json"',
            })
            res.end(JSON.stringify(bundle, null, 2))
            return
          }
        }
        if (req.method === 'POST' && action === 'cancel') {
          owner(req)
          return json(await workflow.close(id, 'cancelled'))
        }
        const signerMatch =
          /^(alice|bob)\/(prepare|session|transport|complete|decline)$/.exec(
            action,
          )
        if (req.method === 'POST' && signerMatch) {
          const person = signerMatch[1] as Person,
            verb = signerMatch[2],
            b = await body(req, 2 * 1024 * 1024)
          if (verb === 'prepare')
            return json(
              await workflow.prepare(id, person, text(b.documentSha256)),
            )
          if (verb === 'decline') {
            const { header, payload } = verifyCompactJws(
              text(b.proof),
              config.holderKeys[person],
            )
            if (
              header.typ !== 'tasra-decline+jwt' ||
              payload.aud !== 'tasra-sign-decline/v1' ||
              payload.requestId !== id ||
              payload.documentSha256 !== record.manifest.documentSha256 ||
              payload.person !== person ||
              typeof payload.exp !== 'number' ||
              !Number.isSafeInteger(payload.exp) ||
              payload.exp < Date.now() / 1000 ||
              payload.exp > Date.now() / 1000 + 180
            )
              throw new Conflict('Invalid decline authorization')
            return json(await workflow.close(id, 'declined', person))
          }
          const attemptId = text(b.attemptId)
          if (verb === 'complete')
            return json(await workflow.complete(id, person, attemptId))
          const saved = record.sessions[person]
          if (
            record.signers[person].attemptId !== attemptId ||
            !saved ||
            record.signers[person].phase !== 'awaiting_wallet'
          )
            throw new Conflict('Wallet session is no longer active')
          if (verb === 'session') {
            const status = await pollOid4vpSession(
              verifierAgentUrl,
              saved.sessionId,
              saved.pollSecret,
            )
            return json({
              sessionId: saved.sessionId,
              requestUri: saved.requestUri,
              qrPayload: saved.qrPayload,
              operation: saved.operation,
              requestHash: saved.requestHash,
              bindingPreimage: status.bindingPreimage,
              status: status.status,
            })
          }
          if (verb === 'transport') {
            const target = new URL(text(b.url)),
              method = b.method === 'POST' ? 'POST' : 'GET'
            const allowed =
              target.origin === new URL(verifierAgentUrl).origin &&
              ((method === 'GET' &&
                (target.href === saved.requestUri ||
                  (target.pathname === '/.well-known/did.json' &&
                    !target.search))) ||
                (method === 'POST' &&
                  target.href ===
                    verifierAgentUrl +
                      '/v1/response?session=' +
                      saved.sessionId))
            if (!allowed)
              throw new Conflict(
                'Wallet transport is outside the configured session',
              )
            const response = await fetch(target, {
              method,
              redirect: 'error',
              signal: AbortSignal.timeout(15000),
              headers:
                method === 'POST'
                  ? { 'content-type': 'application/x-www-form-urlencoded' }
                  : {
                      accept:
                        'application/json, application/oauth-authz-req+jwt',
                    },
              body: method === 'POST' ? text(b.body) : undefined,
            })
            return json({
              status: response.status,
              contentType: response.headers.get('content-type'),
              body: await response.text(),
            })
          }
        }
      }
      if (req.method === 'GET') {
        if (
          /^\/pdf-assets\/(?:pdf\.worker\.mjs|(?:cmaps|standard_fonts|wasm)\/[a-zA-Z0-9_.-]+)$/.test(
            path,
          )
        ) {
          res.writeHead(200, {
            'content-type': path.endsWith('.mjs')
              ? 'text/javascript'
              : path.endsWith('.wasm')
                ? 'application/wasm'
                : 'application/octet-stream',
          })
          res.end(readFileSync(join(import.meta.dirname, 'public', path)))
          return
        }
        const assets: Record<string, [string, string]> = {
          '/app.js': ['app.js', 'text/javascript'],
          '/styles.css': ['styles.css', 'text/css'],
          '/sample.pdf': ['sample.pdf', 'application/pdf'],
        }
        const asset = assets[path]
        if (asset) {
          res.writeHead(200, { 'content-type': asset[1] })
          res.end(readFileSync(join(import.meta.dirname, 'public', asset[0])))
          return
        }
        if (
          path === '/' ||
          path === '/verify' ||
          /^\/sign\/[0-9a-f-]{36}\/(alice|bob)$/i.test(path)
        ) {
          res.writeHead(200, { 'content-type': 'text/html' })
          res.end(readFileSync(join(import.meta.dirname, 'public/index.html')))
          return
        }
      }
      json({ error: 'Not found' }, 404)
    } catch (e) {
      // Never return raw transport errors that could embed a presentation or token.
      const message =
        e instanceof Conflict
          ? e.message
          : e instanceof Error && e.name === 'AuthorizationRefused'
            ? 'The verifier refused this credential'
            : 'Request failed; inspect the request status and local configuration'
      json(
        { error: message },
        e instanceof Conflict
          ? 409
          : e instanceof Error && e.name === 'AuthorizationRefused'
            ? 403
            : 400,
      )
    }
  })().catch(() => {
    if (!res.headersSent) res.writeHead(500)
    res.end()
  })
})
server.listen(port, '127.0.0.1', () =>
  console.log(
    `Sender console (private): ${origin}/#sender=${config.senderToken}`,
  ),
)
let stopped = false
function stop() {
  if (stopped) return
  stopped = true
  server.close(() => {
    unlock()
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 5000).unref()
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
