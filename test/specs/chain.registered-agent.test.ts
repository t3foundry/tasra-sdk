import {derivedNonce, vpNonceBound} from '../../src/oid4vp/binding.js'
import type {VerifiedRequestObject} from '../../src/oid4vp/request-object.js'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {bytesToHex, type Address, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {openRegisteredVerifierAgentSession, awaitRegisteredVerifierAgentResult, assertRegisteredWalletRequest} from '../../src/chain/registeredOperation.js'
import {createRegisteredAgentClient, AgentSessionCreationUnknownError, SNAPSHOT_PENDING_REASON, type ApprovedAgentProfile, type AgentTransport, type AgentHttpResponse, type AgentSessionRecovery} from '../../src/chain/registeredAgent.js'
import {acceptsServiceResponse} from '../../src/chain/serviceRequestPolicy.js'
import {authenticateApprovedService} from '../../src/chain/serviceIdentity.js'
import type {ServiceRecord} from '../../src/chain/services.js'
import type {TasraChainClient} from '../../src/chain/client.js'
import type {CreateSessionParams} from '../../src/verifier-agent/index.js'
import {createSessionKey, sessionGrantCreateFragment} from '../../src/app/session-grants.js'
import {sessionKeyThumbprint} from '../../src/committee/session-grant.js'
import {createDecryptionRecipient, decryptionBinding} from '../../src/crypto/recipient.js'
vi.mock('../../src/chain/serviceIdentity.js', async original => ({...await original<typeof import('../../src/chain/serviceIdentity.js')>(), authenticateApprovedService: vi.fn()}))
const address = (s: string) => `0x${s.repeat(20)}` as Address
const hash = (s: string) => `0x${s.repeat(32)}` as Hex
const encoded = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
const params: CreateSessionParams = {operation: {chain_id: 31337, slot_id: hash('11'), action: 'sign', payload_digest: hash('22'), description: 'Sign', exp: 1900000000}, operationSig: 'signature', messageHex: 'aabb'}

function harness() {
  const profiles: ApprovedAgentProfile[] = ['one', 'two'].map((host, i) => ({endpoint: `https://${host}.example/api`, clientId: `decentralized_identifier:did:web:${host}.example`,
    approval: {chainId: 31337, registry: address('11'), serviceId: hash(i ? '22' : '33'), serviceType: 1, owner: address(i ? '44' : '55'), revision: 1n, manifestHash: hash('66')}}))
  const records: ServiceRecord[] = profiles.map(p => ({owner: p.approval.owner, pendingOwner: address('00'), authKey: address('77'), serviceType: 1, status: 0, revision: 1n, manifestHash: p.approval.manifestHash, endpoint: p.endpoint}))
  const chain = {addresses: {ServiceRegistry: address('11')}, client: {getChainId: vi.fn(async () => 31337), getBlockNumber: vi.fn(async () => 1n)}, readers: {serviceRegistry: {getService: vi.fn(async (id: Hex) => ({...records[profiles.findIndex(p => p.approval.serviceId === id)]!}))}}} as unknown as TasraChainClient
  vi.mocked(authenticateApprovedService).mockImplementation(async (_, a) => {
    const i = profiles.findIndex(p => p.approval.serviceId === a.serviceId)
    if (records[i]!.status !== 0) throw new Error('inactive')
    return {record: {...records[i]!}, manifest: {capabilities: ['oid4vp']}} as Awaited<ReturnType<typeof authenticateApprovedService>>
  })
  const profilePin = (i: number) => { const p = profiles[i]!, a = p.approval; return {chainId: a.chainId, registry: a.registry, serviceId: a.serviceId, serviceType: 1, owner: a.owner, revision: '1', manifestHash: a.manifestHash, authKey: records[i]!.authKey, endpoint: p.endpoint, clientId: p.clientId} }
  const sessionId = (i: number) => (i ? '22' : '11').repeat(32)
  const reply = (i: number) => {
    const p = profiles[i]!, id = sessionId(i), request = `${p.endpoint}/v1/request/${id}`
    return {session_id: id, poll_secret: 'ab'.repeat(32), request_uri: request, qr_payload: `openid4vp://?client_id=${encodeURIComponent(p.clientId)}&request_uri=${encodeURIComponent(request)}`, service_profile: profilePin(i)}
  }
  const transport: AgentTransport = {request: vi.fn(), agentRequest: vi.fn(async (url, opts) => {
    const i = url.startsWith(profiles[0]!.endpoint) ? 0 : 1
    return encoded(opts.body ? reply(i) : {status: 'pending', phase: 'awaiting_wallet', binding_preimage: {service_profile: profilePin(i)}})
  })}
  return {profiles, records, chain, transport, reply, profilePin, client: createRegisteredAgentClient(chain, {profiles, transport})}
}
beforeEach(() => { vi.mocked(authenticateApprovedService).mockReset() })

describe('registered verifier-agent sessions', () => {
  it('restores a JSON checkpoint at the original draining provider with no new creation or discovery', async () => {
    const h = harness(), original = await h.client.createSession(params)
    const checkpoint = JSON.parse(JSON.stringify(original.recovery)) as AgentSessionRecovery
    original.recovery.pollSecret = 'ff'.repeat(32)
    expect(original.recovery.pollSecret).toBe(original.pollSecret)
    h.records[0]!.status = 1; h.records[0]!.revision = 2n
    const restarted = createRegisteredAgentClient(h.chain, {profiles: [...h.profiles].reverse(), transport: h.transport})
    const restored = await restarted.restoreSession(checkpoint)
    expect(restored.sessionId).toBe(original.sessionId)
    expect(restored.recovery).toEqual(checkpoint)
    checkpoint.pollSecret = 'ff'.repeat(32)
    checkpoint.serviceProfile.endpoint = 'https://attacker.example'
    await restored.poll()
    const calls = vi.mocked(h.transport.agentRequest).mock.calls
    expect(calls.filter(([, options]) => options.body !== undefined)).toHaveLength(1)
    expect(calls.slice(1).every(([url, options]) => url === `${original.profile.endpoint}/v1/sessions/${original.sessionId}` && options.bearer === original.pollSecret)).toBe(true)
    expect(authenticateApprovedService).toHaveBeenCalledTimes(1)
    expect(Object.isFrozen(restored)).toBe(true)
  })
  it.each(['owner', 'authKey', 'pendingOwner', 'manifestHash', 'endpoint', 'retired', 'chain', 'registry', 'role', 'revision'])('restore refuses live %s changes before bearer disclosure', async change => {
    const h = harness(), original = await h.client.createSession(params)
    const checkpoint = original.recovery
    if (change === 'owner' || change === 'authKey' || change === 'pendingOwner') h.records[0]![change] = address('99')
    else if (change === 'manifestHash') h.records[0]!.manifestHash = hash('99')
    else if (change === 'endpoint') h.records[0]!.endpoint = 'https://attacker.example'
    else if (change === 'retired') h.records[0]!.status = 2
    else if (change === 'role') h.records[0]!.serviceType = 0
    else if (change === 'revision') h.records[0]!.revision = 0n
    else if (change === 'registry') h.chain.addresses.ServiceRegistry = address('99')
    else vi.mocked(h.chain.client.getChainId).mockResolvedValue(999)
    await expect(h.client.restoreSession(checkpoint)).rejects.toThrow()
    expect(h.transport.agentRequest).toHaveBeenCalledTimes(1)
    expect(original.recovery).toEqual(checkpoint)
  })
  it.each(['version', 'sessionId', 'pollSecret', 'requestUri', 'qrPayload', 'approval', 'paid', 'pendingOwner', 'authKey'])('refuses malformed or substituted recovery %s before network I/O', async field => {
    const h = harness(), original = await h.client.createSession(params)
    const checkpoint = original.recovery
    if (field === 'approval') checkpoint.serviceProfile.manifestHash = hash('99')
    else if (field === 'paid') Object.assign(checkpoint, {payment: {nonce: hash('99')}})
    else if (field === 'authKey') checkpoint.serviceProfile.authKey = 'invalid'
    else Object.assign(checkpoint, {[field]: field === 'version' ? 2 : 'https://attacker.example'})
    await expect(h.client.restoreSession(checkpoint)).rejects.toThrow()
    expect(h.chain.client.getChainId).not.toHaveBeenCalled()
    expect(h.transport.agentRequest).toHaveBeenCalledTimes(1)
  })
  it('refuses removed approvals and mismatched result profiles without creating or switching sessions', async () => {
    const h = harness(), original = await h.client.createSession(params), checkpoint = original.recovery
    const changed = createRegisteredAgentClient(h.chain, {profiles: [h.profiles[1]!], transport: h.transport})
    await expect(changed.restoreSession(checkpoint)).rejects.toThrow('independently approved')
    expect(h.transport.agentRequest).toHaveBeenCalledTimes(1)
    vi.mocked(h.transport.agentRequest).mockResolvedValue(encoded({status: 'pending', phase: 'awaiting_wallet', binding_preimage: {service_profile: h.profilePin(1)}}))
    await expect(h.client.restoreSession(checkpoint)).rejects.toThrow('another session profile')
    const calls = vi.mocked(h.transport.agentRequest).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[1]![1].body).toBeUndefined()
    expect(calls[1]![0]).toContain('one.example')
  })
  it('honors restore cancellation before I/O and blocks a late secret after an ignored abort', async () => {
    const h = harness(), original = await h.client.createSession(params), controller = new AbortController()
    controller.abort()
    await expect(h.client.restoreSession(original.recovery, {signal: controller.signal})).rejects.toThrow()
    expect(h.chain.client.getChainId).not.toHaveBeenCalled()
    const active = new AbortController()
    let release!: (id: number) => void
    vi.mocked(h.chain.client.getChainId).mockImplementation(() => new Promise<number>(resolve => {release = resolve}))
    const waiting = expect(h.client.restoreSession(original.recovery, {signal: active.signal})).rejects.toThrow()
    active.abort(); await waiting; release(31337); await Promise.resolve(); await Promise.resolve()
    expect(h.transport.agentRequest).toHaveBeenCalledTimes(1)
  })
  it.each(['binding', 'token', 'reply'])('refuses paid %s state through an unpaid checkpoint without recreating the session', async where => {
    const h = harness(), original = await h.client.createSession(params)
    const reply: Record<string, unknown> = {status: 'pending', phase: 'awaiting_wallet', binding_preimage: {service_profile: h.profilePin(0)}}
    if (where === 'binding') Object.assign(reply.binding_preimage as object, {payment: {nonce: hash('99')}})
    else if (where === 'token') reply.compound_token = {payment_hash: hash('99')}
    else reply.payment_hash = hash('99')
    vi.mocked(h.transport.agentRequest).mockResolvedValue(encoded(reply))
    await expect(h.client.restoreSession(original.recovery)).rejects.toThrow('unexpected payment')
    expect(vi.mocked(h.transport.agentRequest).mock.calls.filter(([, opts]) => opts.body)).toHaveLength(1)
  })
  it('pins the original provider while draining, with no bearer sent during discovery', async () => {
    const h = harness(), session = await h.client.createSession(params)
    h.records[0]!.status = 1; h.records[0]!.revision = 2n
    expect((await session.poll()).phase).toBe('awaiting_wallet')
    expect(authenticateApprovedService).toHaveBeenCalledTimes(1)
    const calls = vi.mocked(h.transport.agentRequest).mock.calls
    expect(calls[0]![1].bearer).toBeUndefined()
    expect(calls[1]![0]).toBe(`${h.profiles[0]!.endpoint}/v1/sessions/${session.sessionId}`)
    expect(calls[1]![1].bearer).toBe(session.pollSecret)
    expect(Object.isFrozen(session)).toBe(true)
  })
  it.each(['owner', 'authKey', 'manifestHash', 'endpoint', 'retired', 'chain'])('refuses %s changes before sending the poll secret', async change => {
    const h = harness(), session = await h.client.createSession(params)
    if (change === 'owner' || change === 'authKey') h.records[0]![change] = address('99')
    else if (change === 'manifestHash') h.records[0]!.manifestHash = hash('99')
    else if (change === 'endpoint') h.records[0]!.endpoint = 'https://attacker.example'
    else if (change === 'retired') h.records[0]!.status = 2
    else vi.mocked(h.chain.client.getChainId).mockResolvedValue(999)
    await expect(session.poll()).rejects.toThrow()
    expect(h.transport.agentRequest).toHaveBeenCalledTimes(1)
  })
  it('skips inactive discovery candidates and explicitly creates a fresh session at another provider', async () => {
    const h = harness(), original = await h.client.createSession(params)
    h.records[0]!.status = 1; h.records[0]!.revision = 2n
    const next = await h.client.createSession(params, {profileIndex: 1})
    expect(next.sessionId).not.toBe(original.sessionId)
    await original.poll()
    const last = vi.mocked(h.transport.agentRequest).mock.calls.at(-1)!
    expect(last[0]).toContain('one.example')
    const selected = await h.client.createSession(params)
    expect(selected.profile.endpoint).toContain('two.example')
  })
  it('names the transport reason behind an uncertain creation without retrying it', async () => {
    // Certification run 39: the reason (an HTTP refusal status) was dropped, leaving nothing to diagnose.
    const h = harness(), transport = new Error('Service HTTP status, content type or encoding refused (HTTP 503, application/json)')
    vi.mocked(h.transport.agentRequest).mockRejectedValue(transport)
    const error = await h.client.createSession(params).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AgentSessionCreationUnknownError)
    expect((error as Error).message).toContain('Transport: Service HTTP status, content type or encoding refused (HTTP 503, application/json)')
    expect((error as Error).cause).toBe(transport)
    expect(h.transport.agentRequest).toHaveBeenCalledTimes(1)
  })
  describe('a creation refused because no verifier snapshot is anchored yet', () => {
    // Native certification run 41: a fresh fleet's catch-up epochs outran snapshot anchoring and
    // the agent's pre-creation 503 was filed as an uncertain creation, which is never retried.
    const pending = (retryAfterMs: number | null = 1, error = SNAPSHOT_PENDING_REASON): AgentHttpResponse =>
      ({status: 503, body: new TextEncoder().encode(JSON.stringify({error})), ...(retryAfterMs === null ? {} : {retryAfterMs})})
    function withExchange(h: ReturnType<typeof harness>, replies: AgentHttpResponse[]) {
      const exchange = vi.fn(async (url: string, options: {body: Uint8Array}) => {
        const next = replies.shift()
        if (next) return next
        const i = url.startsWith(h.profiles[0]!.endpoint) ? 0 : 1
        expect(options.body.length).toBeGreaterThan(0)
        return {status: 201, body: new TextEncoder().encode(JSON.stringify(h.reply(i)))}
      })
      h.transport.agentExchange = exchange
      return {exchange, client: createRegisteredAgentClient(h.chain, {profiles: h.profiles, transport: h.transport})}
    }
    it('re-sends the identical creation after the hint and opens exactly one session', async () => {
      const h = harness(), {exchange, client} = withExchange(h, [pending(), pending()])
      const session = await client.createSession(params)
      expect(session.profile.endpoint).toBe(h.profiles[0]!.endpoint)
      expect(exchange).toHaveBeenCalledTimes(3)
      const bodies = exchange.mock.calls.map(([, o]) => new TextDecoder().decode(o.body))
      expect(new Set(bodies).size).toBe(1)
      expect(h.transport.agentRequest).not.toHaveBeenCalledWith(expect.stringMatching(/\/v1\/sessions$/), expect.anything())
    })
    it('never retries a 503 without Retry-After or with another reason', async () => {
      for (const reply of [pending(null), pending(1, 'beacon read failed: chain error: seed read failed')]) {
        const h = harness(), {exchange, client} = withExchange(h, [reply])
        const error = await client.createSession(params).catch((e: unknown) => e)
        expect(error).toBeInstanceOf(AgentSessionCreationUnknownError)
        expect((error as Error).message).toContain('Transport: Agent session creation refused (HTTP 503)')
        expect(exchange).toHaveBeenCalledTimes(1)
      }
    })
    it('stops after five attempts and leaves the creation uncertain', async () => {
      const h = harness(), {exchange, client} = withExchange(h, Array.from({length: 9}, () => pending()))
      await expect(client.createSession(params)).rejects.toBeInstanceOf(AgentSessionCreationUnknownError)
      expect(exchange).toHaveBeenCalledTimes(5)
    })
    it('admits a session-creation 503 only through the exchange, and only with a body', () => {
      const shape = {method: 'POST', headers: {}, responseTypes: ['application/json']} as unknown as Parameters<typeof acceptsServiceResponse>[1]
      expect(acceptsServiceResponse('agent', shape, true, 503, 'application/json')).toBe(false)
      expect(acceptsServiceResponse('agent', shape, true, 503, 'application/json', true)).toBe(true)
      expect(acceptsServiceResponse('agent', shape, false, 503, 'application/json', true)).toBe(false)
      expect(acceptsServiceResponse('agent', shape, true, 201, 'application/json', true)).toBe(true)
    })
  })
  it('does not fail over an uncertain creation POST automatically', async () => {
    const h = harness()
    vi.mocked(h.transport.agentRequest).mockRejectedValue(new Error('lost reply'))
    await expect(h.client.createSession(params)).rejects.toBeInstanceOf(AgentSessionCreationUnknownError)
    expect(h.transport.agentRequest).toHaveBeenCalledTimes(1)
    expect(authenticateApprovedService).toHaveBeenCalledTimes(1)
  })
  it.each(['request_uri', 'qr_payload', 'service_profile'])('refuses substituted wallet/profile metadata: %s', async field => {
    const h = harness()
    vi.mocked(h.transport.agentRequest).mockResolvedValue(encoded({...h.reply(0), [field]: 'https://attacker.example'}))
    await expect(h.client.createSession(params)).rejects.toThrow()
  })
  it('does not send operations to an unapproved endpoint returned by discovery', async () => {
    const h = harness(); h.records[0]!.endpoint = 'https://attacker.example'; h.records[1]!.status = 1
    await expect(h.client.createSession(params)).rejects.toThrow('No approved')
    expect(h.transport.agentRequest).not.toHaveBeenCalled()
  })
  it('bounds ignored cancellation without sending late secrets', async () => {
    const h = harness(), session = await h.client.createSession(params), controller = new AbortController()
    let release: (id: number) => void = () => {}
    vi.mocked(h.chain.client.getChainId).mockImplementation(() => new Promise<number>(resolve => {release = resolve}))
    const waiting = session.poll(controller.signal)
    const assertion = expect(waiting).rejects.toThrow()
    controller.abort(); await assertion; release(31337); await Promise.resolve(); await Promise.resolve()
    expect(h.transport.agentRequest).toHaveBeenCalledTimes(1)
  })
})

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

const input = () => ({chainId: 31337, keyRegistry: address('12'), slotId: hash('11'), action: 'sign' as const,
  message: new Uint8Array([1, 2, 3]), description: 'Approve this exact message', signer: privateKeyToAccount(hash('01'))})

/** A KEM decrypt opened in session mode for a fresh Ed25519 session key over two slots. */
async function sessionInput() {
  const key = await createSessionKey({alg: 'Ed25519'})
  const fragment = sessionGrantCreateFragment(key, {slots: [hash('99'), hash('11')], accessTtlSecs: 30, idleTimeoutSecs: 600, absoluteTtlSecs: 3600})
  const binding = decryptionBinding(new Uint8Array(32).fill(7), 1, await createDecryptionRecipient())
  return {key, fragment, request: {chainId: 31337, keyRegistry: address('12'), slotId: hash('11'), action: 'decrypt' as const, ...binding,
    description: 'Open a decrypt session', signer: privateKeyToAccount(hash('01')), sessionGrant: fragment.session_grant}}
}
const grantParams = (request: {slots: string[]; access_ttl_secs: number; idle_timeout_secs: number; absolute_ttl_secs: number}) => ({session_id: hash('ab'), slots: request.slots,
  requested: {access_ttl_secs: request.access_ttl_secs, idle_timeout_secs: request.idle_timeout_secs, absolute_ttl_secs: request.absolute_ttl_secs},
  granted: {access_ttl_secs: request.access_ttl_secs, idle_timeout_secs: 300, absolute_ttl_secs: request.absolute_ttl_secs}})

describe('registered session-mode sessions', () => {
  it('sends the recipient binding and the canonical session grant request, and no payment field', async () => {
    const h = harness(), {fragment, request} = await sessionInput()
    vi.mocked(h.transport.agentRequest).mockImplementationOnce(async () => encoded({...h.reply(0), session_grant_params: grantParams(fragment.session_grant)}))
    const session = await openRegisteredVerifierAgentSession(h.client, request)
    const body = JSON.parse(new TextDecoder().decode(vi.mocked(h.transport.agentRequest).mock.calls[0]![1].body)) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['decryption', 'message_hex', 'operation', 'operation_sig', 'session_grant'])
    expect(body.decryption).toEqual(request.decryption)
    // Slots travel ascending, as the agent canonicalizes them.
    expect(body.session_grant).toEqual({...fragment.session_grant, slots: [hash('11'), hash('99')]})
    expect(session.sessionGrantParams).toEqual({sessionId: hash('ab'), slots: [hash('11'), hash('99')],
      requested: {accessTtlSecs: 30, idleTimeoutSecs: 600, absoluteTtlSecs: 3600}, granted: {accessTtlSecs: 30, idleTimeoutSecs: 300, absoluteTtlSecs: 3600}})
    expect(session.sessionGrantRequest).toEqual(body.session_grant)
    expect(session.recovery.sessionId).toBe(session.sessionId)
  })
  it('sends neither field for a plain session and refuses a grant the reply opens unasked', async () => {
    const h = harness()
    await openRegisteredVerifierAgentSession(h.client, input())
    const body = JSON.parse(new TextDecoder().decode(vi.mocked(h.transport.agentRequest).mock.calls[0]![1].body)) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['message_hex', 'operation', 'operation_sig'])
    const {fragment} = await sessionInput()
    vi.mocked(h.transport.agentRequest).mockImplementationOnce(async () => encoded({...h.reply(0), session_grant_params: grantParams(fragment.session_grant)}))
    await expect(openRegisteredVerifierAgentSession(h.client, input())).rejects.toThrow(/never requested/)
  })
  it.each(['missing', 'raised lifetime', 'another slot', 'changed request'] as const)('refuses a creation reply whose granted parameters are %s', async reason => {
    const h = harness(), {fragment, request} = await sessionInput()
    const params = grantParams({...fragment.session_grant, slots: [hash('11'), hash('99')]})
    if (reason === 'raised lifetime') params.granted.idle_timeout_secs = 601
    if (reason === 'another slot') params.slots = [hash('11'), hash('98')]
    if (reason === 'changed request') params.requested.access_ttl_secs = 45
    vi.mocked(h.transport.agentRequest).mockImplementationOnce(async () => encoded({...h.reply(0), ...(reason === 'missing' ? {} : {session_grant_params: params})}))
    await expect(openRegisteredVerifierAgentSession(h.client, request)).rejects.toThrow(/changed the requested session grant/)
  })
  it.each(['sign', 'foreign slot', 'zero lifetime'] as const)('refuses a session grant request for %s before discovery or POST', async reason => {
    const h = harness(), {fragment, request} = await sessionInput()
    const bad = reason === 'sign' ? {...input(), sessionGrant: fragment.session_grant}
      : reason === 'foreign slot' ? {...request, sessionGrant: {...fragment.session_grant, slots: [hash('99')]}}
      : {...request, sessionGrant: {...fragment.session_grant, idle_timeout_secs: 0}}
    await expect(openRegisteredVerifierAgentSession(h.client, bad)).rejects.toThrow(/session grant/i)
    expect(h.transport.agentRequest).not.toHaveBeenCalled()
    expect(authenticateApprovedService).not.toHaveBeenCalled()
  })
  it('surfaces a completed poll\'s grant unverified, its error code, and refuses a grant on a pending session or any payment', async () => {
    const h = harness(), {fragment, request} = await sessionInput()
    vi.mocked(h.transport.agentRequest).mockImplementationOnce(async () => encoded({...h.reply(0), session_grant_params: grantParams({...fragment.session_grant, slots: [hash('11'), hash('99')]})}))
    const session = await openRegisteredVerifierAgentSession(h.client, request)
    const token = {token_type: 'JWT', seed: hash('03'), slot_id: hash('11'), vp_hash: hash('12'), holder_hash: hash('12'), rule_hash: hash('12'), epoch: 1, iat: 100, exp: 200,
      request_hash: bytesToHex(session.requestHash), binding: 'holder_key', verifier_indexes: [0], signatures: [{verifier_index: 0, signature: '0x' + '34'.repeat(64)}]}
    const done = (extra: Record<string, unknown>, compound_token: unknown = token) => encoded({status: 'done', phase: 'done', compound_token, binding_preimage: {service_profile: h.profilePin(0)}, ...extra})
    const grant = {chain_id: 31337, opaque: true}
    vi.mocked(h.transport.agentRequest).mockResolvedValue(done({session_grant: grant, refresh_seq: 0}))
    expect((await awaitRegisteredVerifierAgentResult(session)).sessionGrant).toEqual({grant: {session_grant: grant, refresh_seq: 0}})
    vi.mocked(h.transport.agentRequest).mockResolvedValue(done({session_grant_error: 'session_unavailable'}))
    expect((await awaitRegisteredVerifierAgentResult(session)).sessionGrant).toEqual({error: 'session_unavailable'})
    vi.mocked(h.transport.agentRequest).mockResolvedValue(done({}))
    expect((await awaitRegisteredVerifierAgentResult(session)).sessionGrant).toBeUndefined()
    vi.mocked(h.transport.agentRequest).mockResolvedValue(done({session_grant: grant, refresh_seq: 1}))
    await expect(awaitRegisteredVerifierAgentResult(session)).rejects.toThrow(/refresh seq 0/)
    vi.mocked(h.transport.agentRequest).mockResolvedValue(encoded({status: 'pending', phase: 'verifying', session_grant: grant, refresh_seq: 0, binding_preimage: {service_profile: h.profilePin(0)}}))
    await expect(session.poll()).rejects.toThrow(/not done/)
    // The network bills metered only: a token or reply naming a payment is refused.
    vi.mocked(h.transport.agentRequest).mockResolvedValue(done({}, {...token, payment_hash: hash('55')}))
    await expect(awaitRegisteredVerifierAgentResult(session)).rejects.toThrow(/payment/)
    vi.mocked(h.transport.agentRequest).mockResolvedValue(done({payment: {max_cost: '1'}}))
    await expect(awaitRegisteredVerifierAgentResult(session)).rejects.toThrow(/payment/)
  })
  it('reports an uncertain creation without any payment identity', async () => {
    const h = harness()
    vi.mocked(h.transport.agentRequest).mockRejectedValue(new Error('lost session reply'))
    const error = await openRegisteredVerifierAgentSession(h.client, input()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AgentSessionCreationUnknownError)
    expect(error).not.toHaveProperty('paymentHash')
    expect(h.transport.agentRequest).toHaveBeenCalledTimes(1)
  })
  it('binds the wallet nonce to this session key: a plain nonce, another key or a changed draw is refused', async () => {
    const h = harness(), {fragment, request} = await sessionInput()
    vi.mocked(h.transport.agentRequest).mockImplementationOnce(async () => encoded({...h.reply(0), session_grant_params: grantParams({...fragment.session_grant, slots: [hash('11'), hash('99')]})}))
    const session = await openRegisteredVerifierAgentSession(h.client, request)
    const thumbprint = sessionKeyThumbprint(fragment.session_grant.session_key)
    const binding = {operation: session.operation, random: hash('01'), seed: hash('03'), snapshot_root: hash('02'), epoch: 1, registry_size: 3, committee_count: 3, quorum: 2,
      session_key_thumbprint: bytesToHex(thumbprint) as string | undefined}
    const bytes = (h32: string) => new Uint8Array(Buffer.from(h32.slice(2), 'hex'))
    const check = (changed: Partial<typeof binding> = {}, nonceKey: Uint8Array | null = thumbprint) => {
      const b = {...binding, ...changed}
      const nonce = vpNonceBound(session.requestHash, bytes(b.random), {epoch: b.epoch, snapshotRoot: bytes(b.snapshot_root), registrySize: b.registry_size, committee: b.committee_count,
        quorum: b.quorum, operationExp: session.operation.exp}, nonceKey ?? undefined)
      const ro = {jwt: 'already-verified', header: {alg: 'EdDSA'}, signerDid: session.profile.clientId.replace('decentralized_identifier:', ''), signerKey: {kty: 'OKP', crv: 'Ed25519', x: ''}, claims: {
        iss: session.profile.clientId.replace('decentralized_identifier:', ''), state: 'state', client_id: session.profile.clientId, response_mode: 'direct_post.jwt', response_uri: session.profile.endpoint + '/v1/response?session=' + session.sessionId, nonce, exp: session.operation.exp, dcql_query: {credentials: []},
      }} as VerifiedRequestObject
      assertRegisteredWalletRequest(session, ro, {status: 'pending', phase: 'awaiting_wallet', bindingPreimage: {...b, nonce}})
    }
    expect(() => check()).not.toThrow()
    // A nonce that names no session key, or another one, authorizes no grant for this key.
    expect(() => check({}, null)).toThrow(/nonce/)
    expect(() => check({}, new Uint8Array(32).fill(5))).toThrow(/nonce/)
    expect(() => check({session_key_thumbprint: undefined})).toThrow(/another session key/)
    expect(() => check({session_key_thumbprint: hash('55')})).toThrow(/another session key/)
  })
  it('refuses a plain session whose wallet request names a session key', async () => {
    const h = harness(), session = await openRegisteredVerifierAgentSession(h.client, input())
    const random = new Uint8Array(32).fill(1), snapshotRoot = new Uint8Array(32).fill(2)
    const nonce = derivedNonce(session.requestHash, random, {epoch: 1, snapshotRoot, registrySize: 3, committee: 3, quorum: 2, operationExp: session.operation.exp})
    const ro = {jwt: 'already-verified', header: {alg: 'EdDSA'}, signerDid: session.profile.clientId.replace('decentralized_identifier:', ''), signerKey: {kty: 'OKP', crv: 'Ed25519', x: ''}, claims: {
      iss: session.profile.clientId.replace('decentralized_identifier:', ''), client_id: session.profile.clientId,
      response_mode: 'direct_post.jwt', response_uri: session.profile.endpoint + '/v1/response?session=' + session.sessionId, nonce, state: 'state', exp: session.operation.exp, dcql_query: {credentials: []},
    }} as VerifiedRequestObject
    const status = {status: 'pending' as const, phase: 'awaiting_wallet' as const, bindingPreimage: {operation: session.operation, random: bytesToHex(random), snapshot_root: bytesToHex(snapshotRoot), epoch: 1, registry_size: 3, committee_count: 3, quorum: 2, nonce}}
    expect(() => assertRegisteredWalletRequest(session, ro, status)).not.toThrow()
    expect(() => assertRegisteredWalletRequest(session, ro, {...status, bindingPreimage: {...status.bindingPreimage, session_key_thumbprint: hash('55')}})).toThrow(/another session key/)
  })
})
describe('registered application operation flow', () => {
  it('retains authenticated polling and checks the returned operation binding', async () => {
    const h = harness(), session = await openRegisteredVerifierAgentSession(h.client, input())
    const expected = bytesToHex(session.requestHash)
    session.requestHash.fill(0) // callers cannot mutate the stored expected binding
    expect(bytesToHex(session.requestHash)).toBe(expected)
    const token = {token_type: 'JWT', seed: hash('12'), slot_id: hash('11'), vp_hash: hash('12'), holder_hash: hash('12'), rule_hash: hash('12'), epoch: 1, iat: 100, exp: 200,
      request_hash: expected, binding: 'holder_key', verifier_indexes: [0], signatures: [{verifier_index: 0, signature: '0x' + '34'.repeat(64)}]}
    vi.mocked(h.transport.agentRequest).mockResolvedValue(encoded({status: 'done', phase: 'done', compound_token: token, binding_preimage: {service_profile: h.profilePin(0)}}))
    expect((await awaitRegisteredVerifierAgentResult(session)).token.request_hash).toBe(expected)
    vi.mocked(h.transport.agentRequest).mockResolvedValue(encoded({status: 'done', phase: 'done', compound_token: {...token, request_hash: hash('99')}, binding_preimage: {service_profile: h.profilePin(0)}}))
    await expect(awaitRegisteredVerifierAgentResult(session)).rejects.toThrow(/does not bind/)
    h.records[0]!.authKey = address('99')
    const calls = vi.mocked(h.transport.agentRequest).mock.calls.length
    await expect(awaitRegisteredVerifierAgentResult(session)).rejects.toThrow(/profile changed/)
    expect(h.transport.agentRequest).toHaveBeenCalledTimes(calls)
  })
  it('enforces the caller deadline even when a transport ignores cancellation', async () => {
    vi.useFakeTimers()
    const h = harness(), session = await openRegisteredVerifierAgentSession(h.client, input())
    vi.mocked(h.transport.agentRequest).mockImplementation(() => new Promise(() => {}))
    const assertion = expect(awaitRegisteredVerifierAgentResult(session, {timeoutMs: 50})).rejects.toMatchObject({kind: 'timeout'})
    await vi.advanceTimersByTimeAsync(50)
    await assertion
  })
  it('cancels before polling and never automatically creates a replacement session', async () => {
    const h = harness(), session = await openRegisteredVerifierAgentSession(h.client, input()), controller = new AbortController()
    controller.abort()
    await expect(awaitRegisteredVerifierAgentResult(session, {signal: controller.signal})).rejects.toMatchObject({kind: 'cancelled'})
    expect(h.transport.agentRequest).toHaveBeenCalledTimes(1)
  })
})

it('refuses substituted wallet operation, nonce, audience and disclosure endpoint', async () => {
  const h = harness(), session = await openRegisteredVerifierAgentSession(h.client, input())
  const random = new Uint8Array(32).fill(1), snapshotRoot = new Uint8Array(32).fill(2)
  const nonce = derivedNonce(session.requestHash, random, {epoch: 1, snapshotRoot, registrySize: 3, committee: 3, quorum: 2, operationExp: session.operation.exp})
  const td = {...session.operation, type: 'keykeeper-op/v1', credential_ids: ['licence']}
  const ro = {jwt: 'already-verified', header: {alg: 'EdDSA'}, signerDid: session.profile.clientId.replace('decentralized_identifier:', ''), signerKey: {kty: 'OKP', crv: 'Ed25519', x: ''}, claims: {
    iss: session.profile.clientId.replace('decentralized_identifier:', ''), client_id: session.profile.clientId,
    response_mode: 'direct_post.jwt', response_uri: session.profile.endpoint + '/v1/response?session=' + session.sessionId, nonce, state: 'state', exp: session.operation.exp,
    dcql_query: {credentials: []}, transaction_data: [Buffer.from(JSON.stringify(td)).toString('base64url')],
  }} as VerifiedRequestObject
  const status = {status: 'pending' as const, phase: 'awaiting_wallet' as const, bindingPreimage: {operation: session.operation, random: bytesToHex(random), snapshot_root: bytesToHex(snapshotRoot), epoch: 1, registry_size: 3, committee_count: 3, quorum: 2, nonce}}
  expect(() => assertRegisteredWalletRequest(session, ro, status)).not.toThrow()
  expect(() => assertRegisteredWalletRequest(session, {...ro, claims: {...ro.claims,
    response_uri: session.profile.endpoint + '/v1/response?session=' + 'ff'.repeat(32),
  }}, status)).toThrow(/outside/)
  for (const field of ['client_id', 'response_uri', 'nonce', 'transaction_data'] as const) {
    const bad = {...ro, claims: {...ro.claims, [field]: field === 'transaction_data' ? [Buffer.from(JSON.stringify({...td, description: 'Different authorization'})).toString('base64url')] : 'different'}}
    expect(() => assertRegisteredWalletRequest(session, bad, status)).toThrow()
  }
  expect(() => assertRegisteredWalletRequest(session, ro, {...status, bindingPreimage: {...status.bindingPreimage, operation: {...session.operation, action: 'decrypt'}}})).toThrow(/operation/)
})

// ⚠⚠ A JAR WITHOUT `transaction_data` IS VALID. Requiring it made the Tasra Vault the only
//    wallet that could complete a presentation on any fleet, because Hovi silently never POSTs
//    a response when the entry is present — so one QR could serve one wallet, never both.
//    These pin the exact envelope: absent is accepted, present is still checked strictly, and
//    nothing that was bound before became unbound.
it('accepts a Request Object with no transaction_data, and still binds the operation', async () => {
  const h = harness(), session = await openRegisteredVerifierAgentSession(h.client, input())
  const random = new Uint8Array(32).fill(1), snapshotRoot = new Uint8Array(32).fill(2)
  const nonce = derivedNonce(session.requestHash, random, {epoch: 1, snapshotRoot, registrySize: 3, committee: 3, quorum: 2, operationExp: session.operation.exp})
  const base = {jwt: 'already-verified', header: {alg: 'EdDSA'}, signerDid: session.profile.clientId.replace('decentralized_identifier:', ''), signerKey: {kty: 'OKP', crv: 'Ed25519', x: ''}, claims: {
    iss: session.profile.clientId.replace('decentralized_identifier:', ''), client_id: session.profile.clientId,
    response_mode: 'direct_post.jwt', response_uri: session.profile.endpoint + '/v1/response?session=' + session.sessionId, nonce, state: 'state', exp: session.operation.exp,
    dcql_query: {credentials: []},
  }} as VerifiedRequestObject
  const status = {status: 'pending' as const, phase: 'awaiting_wallet' as const, bindingPreimage: {operation: session.operation, random: bytesToHex(random), snapshot_root: bytesToHex(snapshotRoot), epoch: 1, registry_size: 3, committee_count: 3, quorum: 2, nonce}}

  // The Hovi-compatible JAR. This threw 'Wallet request has no unique transaction data'.
  expect(() => assertRegisteredWalletRequest(session, base, status)).not.toThrow()

  // ⚠ What survives the relaxation: request_hash covers chain_id, slot_id, action and
  //   payload_digest, and the nonce is derived from it — so a substituted operation is still
  //   refused with no transaction_data anywhere in the request.
  expect(() => assertRegisteredWalletRequest(session, base, {...status, bindingPreimage: {...status.bindingPreimage, operation: {...session.operation, action: 'decrypt'}}})).toThrow(/operation/)
  expect(() => assertRegisteredWalletRequest(session, {...base, claims: {...base.claims, nonce: 'different'}}, status)).toThrow(/nonce/)
})

it('still checks transaction_data strictly whenever the Request Object carries it', async () => {
  const h = harness(), session = await openRegisteredVerifierAgentSession(h.client, input())
  const random = new Uint8Array(32).fill(1), snapshotRoot = new Uint8Array(32).fill(2)
  const nonce = derivedNonce(session.requestHash, random, {epoch: 1, snapshotRoot, registrySize: 3, committee: 3, quorum: 2, operationExp: session.operation.exp})
  const td = {...session.operation, type: 'keykeeper-op/v1', credential_ids: ['licence']}
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const withTd = (transaction_data: string[]) => ({jwt: 'already-verified', header: {alg: 'EdDSA'}, signerDid: session.profile.clientId.replace('decentralized_identifier:', ''), signerKey: {kty: 'OKP', crv: 'Ed25519', x: ''}, claims: {
    iss: session.profile.clientId.replace('decentralized_identifier:', ''), client_id: session.profile.clientId,
    response_mode: 'direct_post.jwt', response_uri: session.profile.endpoint + '/v1/response?session=' + session.sessionId, nonce, state: 'state', exp: session.operation.exp,
    dcql_query: {credentials: []}, transaction_data,
  }} as VerifiedRequestObject)
  const status = {status: 'pending' as const, phase: 'awaiting_wallet' as const, bindingPreimage: {operation: session.operation, random: bytesToHex(random), snapshot_root: bytesToHex(snapshotRoot), epoch: 1, registry_size: 3, committee_count: 3, quorum: 2, nonce}}

  expect(() => assertRegisteredWalletRequest(session, withTd([encode(td)]), status)).not.toThrow()
  // A description the creator never authorized is still refused — that is the whole point of
  // the entry, and it is the one field the nonce does NOT bind.
  expect(() => assertRegisteredWalletRequest(session, withTd([encode({...td, description: 'Different authorization'})]), status)).toThrow()
  expect(() => assertRegisteredWalletRequest(session, withTd([encode({...td, type: 'other/v1'})]), status)).toThrow()
  // Two entries are ambiguous about what was authorized, so they stay refused.
  expect(() => assertRegisteredWalletRequest(session, withTd([encode(td), encode(td)]), status)).toThrow(/unique transaction data/)
  expect(() => assertRegisteredWalletRequest(session, withTd([]), status)).toThrow(/unique transaction data/)
})
