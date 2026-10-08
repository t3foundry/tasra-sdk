import {readFileSync} from 'node:fs'
import {createServer, type Server} from 'node:https'
import {lookup} from 'node:dns'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {createNodeKeeperRecoveryTransport, createNodePaidAgentTransport, createNodeServiceStatusTransport, createNodeAgentWalletFetch, createNodeAgentTransport, createNodeRelayTransport, createNodeServiceDiscoveryTransport, isPublicServiceAddress} from '../../src/chain/node.js'
import {authenticateApprovedService, encodeServiceManifest, serviceChallengeTypedData, type ServiceChallenge, type ServiceManifest} from '../../src/chain/serviceIdentity.js'
import {createTasraChainClient} from '../../src/chain/client.js'
import {hashServiceManifest, type ServiceApproval, type ServiceRecord} from '../../src/chain/services.js'
import {privateKeyToAccount} from 'viem/accounts'
import type {Address, Hex} from 'viem'
import type {RegisteredAgentSession} from '../../src/chain/registeredAgent.js'
vi.mock('node:dns', async importOriginal => {
  const original = await importOriginal<typeof import('node:dns')>()
  return {...original, lookup: vi.fn(original.lookup)}
})
const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url))
const vector = JSON.parse(fixture('service-identity-v1.json').toString()) as {publicAddresses: string[]; privateAddresses: string[]; privateKey: Hex; owner: Address; challenge: ServiceChallenge; manifestBytes: string}
const ca = fixture('service-test-ca.pem')
const servers: Server[] = []
async function serve(handler: Parameters<typeof createServer>[1]) {
  const server = createServer({key: fixture('service-test-key.pem'), cert: fixture('service-test-cert.pem')}, handler)
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as {port: number}
  return `https://localhost:${address.port}`
}
const options = () => ({maxBytes: 128, signal: new AbortController().signal})
afterEach(async () => {
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  vi.restoreAllMocks()
})

describe('service HTTPS destination boundary', () => {
  it('restricts result recovery to two bounded POST reads with verified TLS and no credential headers', async () => {
    const hits = vi.fn()
    const endpoint = await serve((req, res) => {hits(req.url, req.method, req.headers); req.resume()
      res.writeHead(req.url?.endsWith('/recover') ? 403 : 200, {'content-type':'application/json'}); res.end('{}')})
    const transport = createNodeKeeperRecoveryTransport({allowedPrivateHosts:['localhost'],ca})
    const args = {...options(), body:new TextEncoder().encode('{}')}
    expect(await transport.keeperRecoveryRequest(endpoint+'/v1/prepaid/execution',args)).toMatchObject({status:200})
    expect(await transport.keeperRecoveryRequest(endpoint+'/v1/prepaid/execution/recover',args)).toMatchObject({status:403})
    expect(hits.mock.calls.map(([url, method])=>[url,method])).toEqual([['/v1/prepaid/execution','POST'],['/v1/prepaid/execution/recover','POST']])
    for(const call of hits.mock.calls){expect(call[2].authorization).toBeUndefined();expect(call[2].cookie).toBeUndefined()}
    for(const path of ['/v1/prepaid/execution/close','/v1/sign','/v1/relay/forward','/v1/prepaid/execution?redirect=1'])
      expect(()=>transport.keeperRecoveryRequest(endpoint+path,args)).toThrow(/path/)
    expect(()=>transport.keeperRecoveryRequest(endpoint+'/v1/prepaid/execution',{...args,body:new Uint8Array(65537)})).toThrow(/bounds/)
    await expect(createNodeKeeperRecoveryTransport({ca}).keeperRecoveryRequest(endpoint+'/v1/prepaid/execution',args)).rejects.toThrow(/destination policy/)
    await expect(createNodeKeeperRecoveryTransport({allowedPrivateHosts:['localhost']}).keeperRecoveryRequest(endpoint+'/v1/prepaid/execution',args)).rejects.toThrow()
    expect(hits).toHaveBeenCalledTimes(2)
  })
  it('refuses redirects and oversized recovery replies without a second request', async () => {
    const hits=vi.fn()
    const endpoint=await serve((req,res)=>{hits(req.url);req.resume()
      if(req.url?.endsWith('/recover'))res.writeHead(307,{location:'/v1/sign','content-type':'application/json'})
      else res.writeHead(200,{'content-type':'application/json'})
      res.end('{"large":"'+'x'.repeat(200)+'"}')})
    const transport=createNodeKeeperRecoveryTransport({allowedPrivateHosts:['localhost'],ca})
    const args={...options(),body:new TextEncoder().encode('{}')}
    await expect(transport.keeperRecoveryRequest(endpoint+'/v1/prepaid/execution/recover',args)).rejects.toThrow(/status/)
    await expect(transport.keeperRecoveryRequest(endpoint+'/v1/prepaid/execution',args)).rejects.toThrow(/large/)
    expect(hits).toHaveBeenCalledTimes(2)
  })
  it('measures plaintext readiness and JSON policy only over bounded, approved TLS destinations', async () => {
    const hits = vi.fn()
    const endpoint = await serve((req, res) => {
      hits(req.url)
      res.setHeader('content-type', req.url === '/readyz' ? 'text/plain; charset=utf-8' : 'application/json')
      res.end(req.url === '/readyz' ? 'ready' : '{"entries":[]}')
    })
    const transport = createNodeServiceStatusTransport({allowedPrivateHosts: ['localhost'], ca})
    expect(new TextDecoder().decode(await transport.request(endpoint + '/readyz', options()))).toBe('ready')
    expect(new TextDecoder().decode(await transport.request(endpoint + '/v1/relay/policy', options()))).toBe('{"entries":[]}')
    expect(() => transport.request(endpoint + '/v1/rpc', options())).toThrow(/path/)
    expect(() => transport.request(endpoint + '/readyz', {...options(), body: new Uint8Array()})).toThrow(/method/)
    await expect(createNodeServiceStatusTransport({ca}).request(endpoint + '/readyz', options())).rejects.toThrow(/destination policy/)
    expect(hits).toHaveBeenCalledTimes(2)
  })

  it('reports status and Retry-After for relay busy refusals and paid agent waits', async () => {
    const endpoint = await serve((req, res) => { req.resume()
      res.writeHead(422, {'content-type': 'application/json', 'retry-after': '3'})
      res.end('{"id":"","state":"rejected","reason":"relayer busy: the request journal is full; retry shortly or submit directly"}') })
    const relay = createNodeRelayTransport({allowedPrivateHosts: ['localhost'], ca})
    const reply = await relay.relayExchange!(endpoint + '/v1/relay/forward', {...options(), maxBytes: 4096, body: new Uint8Array(3)})
    expect(reply).toMatchObject({status: 422, retryAfterMs: 3000})
    expect(JSON.parse(new TextDecoder().decode(reply.body))).toMatchObject({state: 'rejected'})
    // The legacy byte interface is unchanged.
    expect(await relay.relayRequest(endpoint + '/v1/relay/forward', {...options(), maxBytes: 4096, body: new Uint8Array(3)})).toBeInstanceOf(Uint8Array)
    const agentEndpoint = await serve((req, res) => { req.resume(); res.writeHead(425, {'content-type': 'application/json', 'retry-after': 'nonsense'}); res.end('{}') })
    const paid = createNodePaidAgentTransport({allowedPrivateHosts: ['localhost'], ca})
    const wait = await paid.paidAgentRequest(agentEndpoint + '/v1/sessions/' + 'a'.repeat(64), {method: 'GET', bearer: 'b'.repeat(64), maxBytes: 128, signal: new AbortController().signal})
    expect(wait.status).toBe(425); expect(wait.retryAfterMs).toBeUndefined()
  })

  it.each([200, 202, 422])('bounds relay JSON separately from discovery (HTTP %s)', async status => {
    const endpoint = await serve((req, res) => { req.resume(); res.writeHead(status, {'content-type': 'application/json'}); res.end('{}') })
    const transport = createNodeRelayTransport({allowedPrivateHosts: ['localhost'], ca})
    await expect(transport.relayRequest(endpoint + '/v1/relay/forward', {...options(), body: new Uint8Array(3_000)})).resolves.toBeDefined()
    expect(() => transport.request(endpoint + '/v1/service/identity', {...options(), body: new Uint8Array(3_000)})).toThrow('bounds')
    expect(() => transport.relayRequest(endpoint + '/v1/relay/forward', {...options(), body: new Uint8Array(65_537)})).toThrow('bounds')
    expect(() => transport.relayRequest(endpoint + '/arbitrary', options())).toThrow('path')
    expect(() => transport.relayRequest(endpoint + '/v1/relay/forward', options())).toThrow('method')
  })
  it('applies destination and redirect checks to relay POSTs', async () => {
    const endpoint = await serve((req, res) => { req.resume(); res.writeHead(307, {location: 'https://127.0.0.1/secret', 'content-type': 'application/json'}); res.end('{}') })
    const body = new TextEncoder().encode('{}')
    await expect(createNodeRelayTransport({ca}).relayRequest(endpoint + '/v1/relay/forward', {...options(), body})).rejects.toThrow('destination policy')
    await expect(createNodeRelayTransport({ca, allowedPrivateHosts: ['localhost']}).relayRequest(endpoint + '/v1/relay/forward', {...options(), body})).rejects.toThrow('status')
  })
  it.each(vector.publicAddresses)('allows public address %s', address => expect(isPublicServiceAddress(address)).toBe(true))
  it.each(vector.privateAddresses)('refuses special address %s', address => expect(isPublicServiceAddress(address)).toBe(false))
  it('refuses private DNS before connecting and permits an explicit host with verified TLS', async () => {
    const hits = vi.fn()
    const endpoint = await serve((req, res) => { hits(req.headers); res.writeHead(200, {'content-type': 'application/json'}); res.end('{}') })
    await expect(createNodeServiceDiscoveryTransport({ca}).request(endpoint, options())).rejects.toThrow('destination policy')
    expect(hits).not.toHaveBeenCalled()
    const result = await createNodeServiceDiscoveryTransport({allowedPrivateHosts: ['localhost'], ca}).request(endpoint, options())
    expect(new TextDecoder().decode(result)).toBe('{}')
    expect(hits).toHaveBeenCalledTimes(1)
    expect(hits.mock.calls[0]![0].authorization).toBeUndefined()
    expect(hits.mock.calls[0]![0].cookie).toBeUndefined()
  })
  it('accepts the maximum registered base length plus the manifest path', async () => {
    const endpoint = await serve((_req, res) => { res.setHeader('content-type', 'application/json'); res.end('{}') })
    const base = endpoint + '/' + 'a'.repeat(511 - endpoint.length)
    expect(base.length).toBe(512)
    await expect(createNodeServiceDiscoveryTransport({allowedPrivateHosts: ['localhost'], ca}).request(base + '/.well-known/keykeeper-service.json', options())).resolves.toBeDefined()
  })
  it('rejects mixed public/private DNS answers', async () => {
    const original = await vi.importActual<typeof import('node:dns')>('node:dns')
    vi.mocked(lookup).mockImplementationOnce((...args: Parameters<typeof lookup>) => {
      const callback = args.at(-1) as unknown as (error: null, addresses: {address: string; family: number}[]) => void
      callback(null, [{address: '8.8.8.8', family: 4}, {address: '127.0.0.1', family: 4}])
    })
    await expect(createNodeServiceDiscoveryTransport().request('https://mixed.example.org', options())).rejects.toThrow('DNS answer')
    vi.mocked(lookup).mockImplementation(original.lookup)
  })
  it('does not turn a private-host exception into a TLS-verification exception', async () => {
    const endpoint = await serve((_req, res) => res.end('{}'))
    await expect(createNodeServiceDiscoveryTransport({allowedPrivateHosts: ['localhost']}).request(endpoint, options())).rejects.toThrow()
  })
  it('does not follow redirects or send another request', async () => {
    const hits = vi.fn()
    const endpoint = await serve((_req, res) => { hits(); res.writeHead(302, {location: 'https://127.0.0.1/secret', 'content-type': 'application/json'}); res.end('{}') })
    await expect(createNodeServiceDiscoveryTransport({allowedPrivateHosts: ['localhost'], ca}).request(endpoint, options())).rejects.toThrow('status')
    expect(hits).toHaveBeenCalledTimes(1)
  })
  it.each([false, true])('bounds chunked and declared bodies (content length=%s)', async length => {
    const endpoint = await serve((_req, res) => {
      res.writeHead(200, {'content-type': 'application/json', ...(length ? {'content-length': 129} : {})})
      res.write('x'.repeat(100)); res.end('x'.repeat(29))
    })
    await expect(createNodeServiceDiscoveryTransport({allowedPrivateHosts: ['localhost'], ca}).request(endpoint, options())).rejects.toThrow('too large')
  })
  it.each([{'content-type': 'text/html'}, {'content-type': 'application/json', 'content-encoding': 'gzip'}])('rejects unexpected response formats %#', async headers => {
    const endpoint = await serve((_req, res) => { res.writeHead(200, headers); res.end('{}') })
    await expect(createNodeServiceDiscoveryTransport({allowedPrivateHosts: ['localhost'], ca}).request(endpoint, options())).rejects.toThrow('encoding refused')
  })
  it('cancels a stalled HTTPS response', async () => {
    const endpoint = await serve(() => {})
    const controller = new AbortController()
    const result = createNodeServiceDiscoveryTransport({allowedPrivateHosts: ['localhost'], ca}).request(endpoint, {...options(), signal: controller.signal})
    const assertion = expect(result).rejects.toThrow()
    controller.abort()
    await assertion
  })
  it('completes a real TLS manifest and signed challenge handshake before returning an endpoint', async () => {
    const signer = privateKeyToAccount(vector.privateKey)
    const requests: string[] = []
    const endpoint = await serve((req, res) => {
      requests.push(`${req.method} ${req.url}`)
      res.setHeader('content-type', 'application/json')
      if (req.method === 'GET') { res.end(manifest); return }
      const chunks: Buffer[] = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        const challenge = JSON.parse(Buffer.concat(chunks).toString()) as ServiceChallenge
        void signer.signTypedData(serviceChallengeTypedData(challenge)).then(signature => res.end(JSON.stringify({signature})))
      })
    })
    const manifest = encodeServiceManifest({...JSON.parse(vector.manifestBytes) as ServiceManifest, endpoint})
    const approval: ServiceApproval = {...vector.challenge, owner: vector.owner, serviceType: 1, revision: 1n, manifestHash: hashServiceManifest(manifest)}
    const record: ServiceRecord = {owner: approval.owner, pendingOwner: '0x0000000000000000000000000000000000000000', authKey: signer.address,
      serviceType: 1, status: 0, revision: 1n, manifestHash: approval.manifestHash, endpoint}
    const chain = createTasraChainClient({rpcUrl: 'http://127.0.0.1:1', chainId: approval.chainId, addresses: {ServiceRegistry: approval.registry}})
    vi.spyOn(chain.client, 'getChainId').mockResolvedValue(approval.chainId)
    vi.spyOn(chain.client, 'getBlockNumber').mockResolvedValue(10n)
    vi.spyOn(chain.readers.serviceRegistry, 'getService').mockResolvedValue(record)
    const result = await authenticateApprovedService(chain, approval, createNodeServiceDiscoveryTransport({allowedPrivateHosts: ['localhost'], ca}))
    expect(result.record.endpoint).toBe(endpoint)
    expect(requests).toEqual(['GET /.well-known/keykeeper-service.json', 'POST /v1/service/identity'])
  })
})


describe('agent session HTTPS transport', () => {
  it('restricts bearer secrets to pinned session GET paths', async () => {
    const hits: {method?: string; bearer?: string}[] = []
    const endpoint = await serve((req, res) => { hits.push({method: req.method, bearer: req.headers.authorization}); req.resume(); res.writeHead(req.method === 'POST' ? 201 : 200, {'content-type': 'application/json'}); res.end('{}') })
    const transport = createNodeAgentTransport({ca, allowedPrivateHosts: ['localhost']})
    await transport.agentRequest(endpoint + '/v1/sessions', {...options(), body: new TextEncoder().encode('{}')})
    await transport.agentRequest(endpoint + '/v1/sessions/' + 'ab'.repeat(32), {...options(), bearer: 'cd'.repeat(32)})
    expect(hits).toEqual([{method: 'POST', bearer: undefined}, {method: 'GET', bearer: 'Bearer ' + 'cd'.repeat(32)}])
    expect(() => transport.agentRequest(endpoint + '/arbitrary', {...options(), bearer: 'cd'.repeat(32)})).toThrow()
    expect(() => transport.agentRequest(endpoint + '/v1/sessions', {...options(), body: new Uint8Array(), bearer: 'cd'.repeat(32)})).toThrow()
    expect(() => transport.agentRequest(endpoint + '/v1/sessions/' + 'ab'.repeat(32), options())).toThrow()
  })
  it('refuses private destinations and redirects for session traffic', async () => {
    const endpoint = await serve((req, res) => { req.resume(); res.writeHead(307, {location: 'https://other.example', 'content-type': 'application/json'}); res.end('{}') })
    const opts = {...options(), body: new TextEncoder().encode('{}')}
    await expect(createNodeAgentTransport({ca}).agentRequest(endpoint + '/v1/sessions', opts)).rejects.toThrow('destination policy')
    await expect(createNodeAgentTransport({ca, allowedPrivateHosts: ['localhost']}).agentRequest(endpoint + '/v1/sessions', opts)).rejects.toThrow('status')
  })
})

describe('registered wallet HTTPS transport', () => {
  it.each([200, 202])('preserves HTTP %s and the original callback body without resending', async status => {
    const hits: Array<{path?: string; bearer?: string; body: string}> = []
    const endpoint = await serve((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        hits.push({path: req.url, bearer: req.headers.authorization, body: Buffer.concat(chunks).toString()})
        res.writeHead(status, {'content-type': 'application/json'})
        res.end('{"pending":true}')
      })
    })
    const session = {sessionId: 'aa'.repeat(32), profile: {endpoint, clientId: `decentralized_identifier:did:web:localhost%3A${new URL(endpoint).port}`}, requestUri: endpoint + '/v1/request/' + 'aa'.repeat(32)} as RegisteredAgentSession
    const fetcher = createNodeAgentWalletFetch(session, {ca, allowedPrivateHosts: ['localhost']})
    const responseUrl = endpoint + '/v1/response?session=' + session.sessionId
    const response = await fetcher(responseUrl, {method: 'POST', headers: {authorization: 'owner-secret'}, body: 'response=original%2Bencrypted%2Bpresentation'})
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({pending: true})
    expect(hits).toEqual([{path: '/v1/response?session=' + session.sessionId, bearer: undefined, body: 'response=original%2Bencrypted%2Bpresentation'}])
  })
  it('refuses HTTP202 for approved request objects and DID documents', async () => {
    const endpoint = await serve((req, res) => {
      req.resume()
      res.writeHead(202, {'content-type': req.url?.startsWith('/v1/request/') ? 'application/oauth-authz-req+jwt' : 'application/json'})
      res.end('{}')
    })
    const session = {sessionId: 'aa'.repeat(32), profile: {endpoint, clientId: `decentralized_identifier:did:web:localhost%3A${new URL(endpoint).port}`}, requestUri: endpoint + '/v1/request/' + 'aa'.repeat(32)} as RegisteredAgentSession
    const fetcher = createNodeAgentWalletFetch(session, {ca, allowedPrivateHosts: ['localhost']})
    await expect(fetcher(session.requestUri)).rejects.toThrow(/status/)
    await expect(fetcher(endpoint + '/.well-known/did.json')).rejects.toThrow(/status/)
  })
  it.each(['application/json', 'application/did+json', 'application/did+ld+json'])('accepts %s only for the approved DID document', async type => {
    const endpoint = await serve((req, res) => {req.resume(); res.writeHead(200, {'content-type': type}); res.end('{}')})
    const session = {sessionId: 'aa'.repeat(32), profile: {endpoint, clientId: `decentralized_identifier:did:web:localhost%3A${new URL(endpoint).port}`}, requestUri: endpoint + '/v1/request/' + 'aa'.repeat(32)} as RegisteredAgentSession
    const fetcher = createNodeAgentWalletFetch(session, {ca, allowedPrivateHosts: ['localhost']})
    expect(await (await fetcher(endpoint + '/.well-known/did.json')).json()).toEqual({})
    await expect(fetcher(session.requestUri)).rejects.toThrow(/content type/)
    if (type !== 'application/json') await expect(fetcher(endpoint + '/v1/response?session=' + session.sessionId, {method: 'POST', body: 'response=fixture'})).rejects.toThrow(/content type/)
  })
  it('preserves request/form bytes only on the approved session routes', async () => {
    const hits: Array<{path?: string; type?: string; bearer?: string; body: string}> = []
    // A RequestListener returns void, so the async body is wrapped rather than passed
    // directly: a rejection in a handler handed straight to createServer is unhandled,
    // and the request would hang until the fetch timed out instead of failing here.
    const endpoint = await serve((req, res) => {
      void (async () => {
        const chunks = []
        for await (const chunk of req) chunks.push(chunk as Buffer)
        hits.push({path: req.url, type: req.headers['content-type'], bearer: req.headers.authorization, body: Buffer.concat(chunks).toString()})
        res.writeHead(200, {'content-type': req.url?.startsWith('/v1/request/') ? 'application/oauth-authz-req+jwt' : 'application/json'})
        res.end(req.url?.startsWith('/v1/request/') ? 'header.claims.signature' : '{}')
      })().catch((error: unknown) => {
        res.writeHead(500, {'content-type': 'text/plain'})
        res.end(String(error))
      })
    })
    const session = {sessionId: 'aa'.repeat(32), profile: {endpoint, clientId: `decentralized_identifier:did:web:localhost%3A${new URL(endpoint).port}`}, requestUri: endpoint + '/v1/request/' + 'aa'.repeat(32)} as RegisteredAgentSession
    const fetcher = createNodeAgentWalletFetch(session, {ca, allowedPrivateHosts: ['localhost']})
    expect(await (await fetcher(session.requestUri)).text()).toBe('header.claims.signature')
    await fetcher(endpoint + '/.well-known/did.json')
    await fetcher(endpoint + '/v1/response?session=' + session.sessionId, {method: 'POST', headers: {authorization: 'secret'}, body: 'response=abc%2Bdef'})
    expect(hits.at(-1)).toMatchObject({body: 'response=abc%2Bdef', type: 'application/x-www-form-urlencoded', bearer: undefined})
    await expect(fetcher(endpoint + '/v1/request/' + 'bb'.repeat(32))).rejects.toThrow(/outside/)
    await expect(fetcher(endpoint + '/v1/response?session=' + 'bb'.repeat(32), {method: 'POST', body: 'response=secret'})).rejects.toThrow(/outside/)
    await expect(fetcher(endpoint + '/v1/response', {method: 'POST', body: 'response=secret'})).rejects.toThrow(/outside/)
    await expect(fetcher('https://other.example/v1/response', {method: 'POST', body: 'secret'})).rejects.toThrow(/outside/)
    await expect(fetcher(endpoint + '/v1/response?session=' + session.sessionId, {method: 'POST', body: 'x'.repeat(1_048_577)})).rejects.toThrow(/bounds/)
    expect(hits).toHaveLength(3)
  })
})


describe('paid agent owner-control HTTPS transport', () => {
  const id = 'ab'.repeat(32), proposal = 'cd'.repeat(32), owner = 'ef'.repeat(32)
  const session = '/v1/sessions/' + id
  it('submits OAuth artifacts only on its guarded POST with a separate owner header and preserves HTTP202', async () => {
    const hits: Array<{authorization?: string; owner?: string; proof?: string; body: string}> = []
    const endpoint=await serve((req,res)=>{
      const chunks:Buffer[]=[];req.on('data',(chunk:Buffer)=>chunks.push(chunk));req.on('end',()=>{
        hits.push({authorization:req.headers.authorization,owner:req.headers['x-poll-secret'] as string|undefined,
          proof:req.headers.dpop as string|undefined,body:Buffer.concat(chunks).toString()})
        res.writeHead(202,{'content-type':'application/json'});res.end('{}')
      })
    })
    const t=createNodePaidAgentTransport({ca,allowedPrivateHosts:['localhost']})
    const oauth={accessToken:'original.access.token',proof:'original.dpop.proof'}
    expect((await t.paidAgentRequest(endpoint+session+'/oauth-response',{...options(),method:'POST',bearer:owner,oauth})).status).toBe(202)
    expect(hits).toEqual([{authorization:'DPoP '+oauth.accessToken,owner,proof:oauth.proof,body:''}])
    for(const path of [session,session+'/execution','/v1/request/'+id,'/v1/sessions']){
      expect(()=>t.paidAgentRequest(endpoint+path,{...options(),method:'POST',bearer:owner,oauth})).toThrow(/OAuth/)
    }
    expect(()=>t.paidAgentRequest(endpoint+session+'/oauth-response',{...options(),method:'POST',bearer:owner})).toThrow(/paid agent/)
    expect(()=>t.paidAgentRequest(endpoint+session+'/oauth-response',{...options(),method:'GET',bearer:owner,oauth})).toThrow(/paid agent/)
    expect(()=>t.paidAgentRequest(endpoint+session+'/oauth-response',{...options(),method:'POST',bearer:owner,oauth,body:new Uint8Array()})).toThrow(/paid agent/)
    for(const artifacts of [{...oauth,accessToken:'token\r\nX-Leak: owner'},{...oauth,proof:'malformed'},
      {...oauth,accessToken:'x'.repeat(16385)},{...oauth,proof:'x'.repeat(4097)}]){
      expect(()=>t.paidAgentRequest(endpoint+session+'/oauth-response',{...options(),method:'POST',bearer:owner,oauth:artifacts})).toThrow(/OAuth/)
    }
    expect(hits).toHaveLength(1)
  })
  it('preserves consent and recovery statuses, sends bodyless POSTs and keeps owners off public routes', async () => {
    const hits: Array<{path?: string; method?: string; bearer?: string; body: string}> = []
    let createStatus = 201
    const endpoint = await serve((req,res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        hits.push({path: req.url, method: req.method, bearer: req.headers.authorization, body: Buffer.concat(chunks).toString()})
        if (req.url?.endsWith('/approve')) {res.writeHead(204); res.end(); return}
        const status = req.url === '/v1/sessions' ? createStatus : req.url?.startsWith('/v1/request/') ? 425 : req.url?.endsWith('/resume') ? 503 : 200
        res.writeHead(status, {'content-type': 'application/json'}); res.end('{}')
      })
    })
    const transport = createNodePaidAgentTransport({ca, allowedPrivateHosts: ['localhost']})
    const body = new TextEncoder().encode('{"client":"public consent"}')
    for (const status of [201,200]) {
      createStatus = status
      expect((await transport.paidAgentRequest(endpoint+'/v1/sessions',{...options(),method:'POST',body})).status).toBe(status)
    }
    const request = await transport.paidAgentRequest(endpoint+'/v1/request/'+id,{...options(),method:'GET'})
    expect(request.status).toBe(425)
    expect(new TextDecoder().decode(request.body)).toBe('{}')
    const approved = await transport.paidAgentRequest(endpoint+session+'/execution/'+proposal+'/approve',{...options(),method:'POST',bearer:owner,body})
    expect(approved.status).toBe(204); expect(approved.body.length).toBe(0)
    expect((await transport.paidAgentRequest(endpoint+session+'/presentations/'+proposal+'/resume',{...options(),method:'POST',bearer:owner})).status).toBe(503)
    expect(hits.map(h=>h.bearer)).toEqual([undefined,undefined,undefined,'Bearer '+owner,'Bearer '+owner])
    expect(hits.at(-1)?.method).toBe('POST'); expect(hits.at(-1)?.body).toBe('')
    expect(hits).toHaveLength(5) // no automatic resend after an unknown delivery
  })
  it('refuses wrong paths, methods, bodies and owner-bearer disclosure before connecting', async () => {
    const hits = vi.fn()
    const endpoint = await serve((_req,res) => {hits();res.end('{}')})
    const t = createNodePaidAgentTransport({ca,allowedPrivateHosts:['localhost']})
    const body = new TextEncoder().encode('{}')
    for (const [path,method,secret,bytes] of [
      [session+'/execution','GET',undefined,undefined],
      ['/v1/sessions','POST',owner,body],
      ['/v1/request/'+id,'GET',owner,undefined],
      [session+'/execution','POST',owner,body],
      [session+'/execution/'+proposal+'/approve','GET',owner,body],
      [session+'/execution/'+proposal+'/approve','POST',owner,undefined],
      [session+'/execution/'+proposal+'/reject','POST',owner,body],
      [session+'/presentations/'+proposal+'/resume','GET',owner,undefined],
      [session+'/presentations/'+proposal+'/resume','POST','wrong',undefined],
      [session+'/execution?elsewhere=1','GET',owner,undefined],
      [session+'/../execution','GET',owner,undefined],
    ] as const) {
      expect(()=>t.paidAgentRequest(endpoint+path,{...options(),method,bearer:secret,body:bytes})).toThrow(/paid agent/)
    }
    expect(hits).not.toHaveBeenCalled()
  })
  it('applies private-address, TLS and redirect refusal to owner controls', async () => {
    const hits = vi.fn()
    const endpoint = await serve((req,res) => {hits(req.headers.authorization);req.resume();res.writeHead(307,{'content-type':'application/json',location:'https://other.example/secret'});res.end('{}')})
    const opts = {...options(),method:'GET' as const,bearer:owner}
    await expect(createNodePaidAgentTransport({ca}).paidAgentRequest(endpoint+session+'/execution',opts)).rejects.toThrow(/destination policy/)
    await expect(createNodePaidAgentTransport({allowedPrivateHosts:['localhost']}).paidAgentRequest(endpoint+session+'/execution',opts)).rejects.toThrow()
    expect(hits).not.toHaveBeenCalled()
    await expect(createNodePaidAgentTransport({ca,allowedPrivateHosts:['localhost']}).paidAgentRequest(endpoint+session+'/execution',opts)).rejects.toThrow(/status/)
    expect(hits).toHaveBeenCalledExactlyOnceWith('Bearer '+owner)
  })
  it('bounds chunked proposals and rejects a JSON success in place of the signed request object', async () => {
    const endpoint = await serve((req,res) => {req.resume();res.writeHead(200,{'content-type':'application/json'});res.end('x'.repeat(129))})
    const t = createNodePaidAgentTransport({ca,allowedPrivateHosts:['localhost']})
    await expect(t.paidAgentRequest(endpoint+session+'/execution',{...options(),method:'GET',bearer:owner})).rejects.toThrow(/too large/)
    await expect(t.paidAgentRequest(endpoint+'/v1/request/'+id,{...options(),method:'GET'})).rejects.toThrow(/content type/)
  })
  it('cancels an owner control without retrying its POST', async () => {
    const hits = vi.fn()
    const endpoint = await serve(req => {hits();req.resume()})
    const t = createNodePaidAgentTransport({ca,allowedPrivateHosts:['localhost']})
    const controller = new AbortController()
    const pending = t.paidAgentRequest(endpoint+session+'/execution/'+proposal+'/reject',{...options(),method:'POST',bearer:owner,signal:controller.signal})
    const failed = expect(pending).rejects.toThrow()
    controller.abort(); await failed
    expect(hits.mock.calls.length).toBeLessThanOrEqual(1)
  })
})
