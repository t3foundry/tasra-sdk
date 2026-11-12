import {describe, expect, it, vi} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import {hexToBytes} from '../../src/crypto/hex.js'
import {createMemoryStore} from '../../src/app/memory-store.js'
import {STORE_COMMIT, type LockedCommit, type StoreCommitSteps} from '../../src/app/store-commit.js'
import type {ApplicationStore} from '../../src/app/ready-slot.js'
import {acceptSessionGrant, createSessionKey, loadGrantedSession, sessionGrantCreateFragment, SessionEndedError, SessionRevokeIncompleteError, SessionRevokeUnconfirmedError, type GrantedSessionOptions, type SessionKeyHandle, type SlotTrust} from '../../src/app/session-grants.js'
import {BINDING_HOLDER_KEY, type VerifierSet} from '../../src/committee/token.js'
import {acceptsServiceResponse, serviceRequestShape} from '../../src/chain/serviceRequestPolicy.js'
import type {PaidAgentTransport} from '../../src/chain/paidAgentTransport.js'
import type {ApprovedAgentProfile} from '../../src/chain/registeredAgent.js'
import {encodeSessionGrant, sessionControlHash, sessionGrantHash, sessionGrantPayload, sessionKeyThumbprint, verifySessionSignature,
  type GrantSlot, type SessionGrantWire} from '../../src/committee/session-grant.js'

// Verifier i signs with the Ed25519 seed [0x10+i; 32] (as the reference vectors); registry 7, committee 3, quorum 2.
const seeds = Array.from({length: 7}, (_, i) => new Uint8Array(32).fill(0x10 + i))
const set: VerifierSet = {registrySize: 7, pubkeys: new Map(seeds.map((s, i) => [i, ed25519.getPublicKey(s)]))}
const slotA = ('0x' + '01'.repeat(32)) as `0x${string}`, slotB = ('0x' + '02'.repeat(32)) as `0x${string}`
const rules: Record<string, Uint8Array> = {[slotA]: new Uint8Array(32).fill(0xfe), [slotB]: new Uint8Array(32).fill(0xfd)}
const trust = async (slot: `0x${string}`): Promise<SlotTrust> => ({set, committee: 3, quorum: 2, ruleHash: rules[slot.toLowerCase()]!, seed: new Uint8Array(32).fill(0x5e)})
const T0 = 1_800_000_000
const profile: ApprovedAgentProfile = {endpoint: 'https://agent.test', clientId: 'decentralized_identifier:did:web:agent.test',
  approval: {chainId: 43112, registry: `0x${'04'.repeat(20)}`, serviceId: `0x${'05'.repeat(32)}`, serviceType: 1, owner: `0x${'06'.repeat(20)}`, revision: 1n, manifestHash: `0x${'07'.repeat(32)}`}}
// The registered paid-agent transport, driven by a fetch stand-in, with the SHARED request/response policy applied.
function agentVia(fetchImpl: typeof fetch): {profile: ApprovedAgentProfile; transport: PaidAgentTransport} {
  const transport: PaidAgentTransport = {request: vi.fn(), paidAgentRequest: async (url, opts) => {
    const shape = serviceRequestShape('paid-agent', url, {body: opts.body, maxBytes: opts.maxBytes, bearer: opts.bearer, method: opts.method})
    const res = await fetchImpl(url, {method: shape.method, headers: shape.headers, body: opts.body && new TextDecoder().decode(opts.body)})
    if (!acceptsServiceResponse('paid-agent', shape, Boolean(opts.body), res.status, res.headers.get('content-type')?.split(';')[0] ?? '')) throw new Error('refused by the paid agent policy')
    const retry = res.headers.get('retry-after')
    return {status: res.status, body: new Uint8Array(await res.arrayBuffer()), ...retry ? {retryAfterMs: Number(retry) * 1000} : {}}
  }}
  return {profile, transport}
}
const transportFor = (fetchImpl: typeof fetch, chainId = 43112) => ({chainId, agent: agentVia(fetchImpl), trust})

function grant(key: SessionKeyHandle, o: {iat: number; ttl?: number; idle?: number; absoluteExp?: number; slots?: string[]; sessionId?: Uint8Array; chainId?: bigint; epoch?: bigint}): SessionGrantWire {
  const slots: GrantSlot[] = (o.slots ?? [slotA, slotB]).map(s => ({slotId: hexToBytes(s), ruleHash: rules[s]!}))
  const payload = sessionGrantPayload({chainId: o.chainId ?? 43112n, sessionId: o.sessionId ?? new Uint8Array(32).fill(0x5a), holderHash: new Uint8Array(32).fill(0x48),
    sessionKeyThumbprint: sessionKeyThumbprint(key.jwk), binding: BINDING_HOLDER_KEY, action: 'decrypt', seed: new Uint8Array(32).fill(0x5e), epoch: o.epoch ?? 42n,
    slots, iat: o.iat, exp: o.iat + (o.ttl ?? 30), idleTimeoutSecs: o.idle ?? 600, absoluteExp: o.absoluteExp ?? T0 + 3600})
  const hash = sessionGrantHash(payload)
  return encodeSessionGrant({payload, signatures: seeds.map((s, i) => ({verifierIndex: i, signature: ed25519.sign(hash, s)}))})
}

async function opened(opts: {clock: () => number; fetchImpl?: typeof fetch; onEnded?: (e: SessionEndedError) => void; ttl?: number; extra?: Partial<GrantedSessionOptions>}) {
  const key = await createSessionKey({alg: 'Ed25519'})
  const store = createMemoryStore()
  const fragment = sessionGrantCreateFragment(key, {slots: [slotB, slotA], accessTtlSecs: 40, idleTimeoutSecs: 600, absoluteTtlSecs: 3600})
  const fetchImpl = opts.fetchImpl ?? (vi.fn() as unknown as typeof fetch)
  const session = await acceptSessionGrant({store, key, clock: opts.clock, onEnded: opts.onEnded, transport: transportFor(fetchImpl), ...opts.extra},
    fragment, {session_grant: grant(key, {iat: T0, ttl: opts.ttl}), refresh_seq: 0})
  return {key, store, session, fetchImpl}
}
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}})

describe('session grant lifecycle (ADR-0090 D7, SDK)', () => {
  it('builds the create fragment: sorted distinct slots, the public JWK only, positive lifetimes', async () => {
    const key = await createSessionKey({alg: 'Ed25519'})
    const f = sessionGrantCreateFragment(key, {slots: [slotB, slotA]})
    expect(f.session_grant.slots).toEqual([slotA, slotB])
    expect(f.session_grant.session_key).toEqual(key.jwk)
    expect(JSON.stringify(f)).not.toMatch(/"d"/)
    expect(f.session_grant).toMatchObject({access_ttl_secs: 30, idle_timeout_secs: 600, absolute_ttl_secs: 3600})
    expect(() => sessionGrantCreateFragment(key, {slots: [slotA, slotA]})).toThrow(/distinct/)
    expect(() => sessionGrantCreateFragment(key, {slots: [slotA], accessTtlSecs: 0})).toThrow(/positive/)
    expect(() => sessionGrantCreateFragment(key, {slots: []})).toThrow(/1\.\.16/)
  })

  it('creates a non-extractable WebCrypto P-256 key whose ES256 signatures verify', async () => {
    const key = await createSessionKey({alg: 'ES256'})
    expect(key.jwk).toMatchObject({kty: 'EC', crv: 'P-256'})
    const hash = new Uint8Array(32).fill(7)
    expect(verifySessionSignature(key.jwk, hash, await key.sign(hash))).toBe(true)
    key.dispose()
    await expect(key.sign(hash)).rejects.toThrow(/disposed/)
  })

  it('accepts only a grant that binds this key, the requested slots and lifetimes, and verifies per slot', async () => {
    const clock = () => T0 + 1
    const key = await createSessionKey({alg: 'Ed25519'}), other = await createSessionKey({alg: 'Ed25519'})
    const fragment = sessionGrantCreateFragment(key, {slots: [slotA, slotB], accessTtlSecs: 20, idleTimeoutSecs: 600, absoluteTtlSecs: 3600})
    const accept = (g: SessionGrantWire, refresh_seq = 0) => acceptSessionGrant({store: createMemoryStore(), key, clock, transport: transportFor(vi.fn() as unknown as typeof fetch)}, fragment, {session_grant: g, refresh_seq})
    await expect(accept(grant(other, {iat: T0}))).rejects.toThrow(/another session key/)
    await expect(accept(grant(key, {iat: T0, ttl: 30}))).rejects.toThrow(/requested access TTL/)
    await expect(accept(grant(key, {iat: T0, ttl: 20, idle: 900}))).rejects.toThrow(/idle timeout/)
    await expect(accept(grant(key, {iat: T0, ttl: 20}), 3)).rejects.toThrow(/fresh session grant/)
    const forged = grant(key, {iat: T0, ttl: 20}); forged.signatures = forged.signatures.map(s => ({...s, signature: '0x' + '00'.repeat(64)}))
    await expect(accept(forged)).rejects.toThrow(/invalid grant signature/)
    const ok = await accept(grant(key, {iat: T0, ttl: 20, slots: [slotA]}))
    expect(ok.current().slots).toHaveLength(1)
    expect((await ok.verifiedFor(slotA)).verifiedSigners.length).toBeGreaterThanOrEqual(2)
    await expect(ok.verifiedFor(slotB)).rejects.toThrow(/not named/)
  })

  it('refreshes with a seq durably reserved BEFORE the request is sent, signed over (grant_hash, seq, issued_at)', async () => {
    let now = T0 + 20
    const seen: number[] = []
    const ctx: {store?: ReturnType<typeof createMemoryStore>; key?: SessionKeyHandle} = {}
    const fetchImpl = (async (url: string, init: RequestInit) => {
      expect(url).toBe('https://agent.test/v1/sessions/refresh')
      // No bearer: the session-key signature is the authorization.
      expect(init.headers).not.toHaveProperty('authorization')
      const body = JSON.parse(String(init.body)) as {grant: SessionGrantWire; seq: number; issued_at: number; signature: string}
      // The seq was persisted before this request left the client.
      const stored = await ctx.store!.load<{lastSeq: number}>('tasra.session-grant.0x' + '5a'.repeat(32))
      expect(stored?.lastSeq).toBe(body.seq)
      seen.push(body.seq)
      const {decodeSessionGrant} = await import('../../src/committee/session-grant.js')
      const hash = sessionControlHash('refresh', sessionGrantHash(decodeSessionGrant(body.grant).payload), body.seq, body.issued_at)
      expect(verifySessionSignature(ctx.key!.jwk, hash, hexToBytes(body.signature))).toBe(true)
      return reply(200, {session_grant: grant(ctx.key!, {iat: now}), refresh_seq: body.seq})
    }) as unknown as typeof fetch
    const o = await opened({clock: () => now, fetchImpl})
    ctx.store = o.store; ctx.key = o.key
    const g1 = await o.session.refresh()
    expect(g1.iat).toBe(T0 + 20)
    now += 25
    await o.session.refresh()
    expect(seen).toEqual([1, 2])
    expect(o.session.current().iat).toBe(T0 + 45)
  })

  it('follows the beacon: refreshes once it moved past the grant\'s epoch (a skipped epoch would need a new presentation), not before', async () => {
    const now = T0 + 5
    const calls: number[] = []
    const ctx: {key?: SessionKeyHandle} = {}
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {seq: number}
      calls.push(body.seq)
      // The agent continued the session onto the next epoch's draw.
      return reply(200, {session_grant: grant(ctx.key!, {iat: now, epoch: 43n}), refresh_seq: body.seq})
    }) as unknown as typeof fetch
    const o = await opened({clock: () => now, fetchImpl})
    ctx.key = o.key
    expect(await o.session.refreshForEpoch(42n)).toBe(false)
    expect(await o.session.refreshForEpoch(41n)).toBe(false)
    expect(calls).toEqual([])
    expect(await o.session.refreshForEpoch(43n)).toBe(true)
    expect(calls).toEqual([1])
    expect(o.session.current().epoch).toBe(43)
    expect(await o.session.refreshForEpoch(43n)).toBe(false)
    expect(calls).toEqual([1])
  })

  it('refuses a refresh reply that does not move the grant, so refreshForEpoch never reports success without moving (C8 review F5)', async () => {
    const now = T0 + 5
    let mode: 'same' | 'same-epoch' = 'same'
    const ctx: {key?: SessionKeyHandle} = {}
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {seq: number}
      // 'same': the agent answers with the grant the client already holds (iat T0, epoch 42).
      const g = mode === 'same' ? grant(ctx.key!, {iat: T0}) : grant(ctx.key!, {iat: now})
      return reply(200, {session_grant: g, refresh_seq: body.seq})
    }) as unknown as typeof fetch
    const o = await opened({clock: () => now, fetchImpl})
    ctx.key = o.key
    const held = o.session.current()
    await expect(o.session.refresh()).rejects.toMatchObject({code: 'refresh-unchanged'})
    await expect(o.session.refreshForEpoch(43n)).rejects.toMatchObject({code: 'refresh-unchanged'})
    expect(o.session.current()).toEqual(held)
    // A newer grant still on the old epoch is a valid refresh, but not a move to the beacon's epoch.
    mode = 'same-epoch'
    await expect(o.session.refreshForEpoch(43n)).rejects.toThrow(/stayed on epoch 42/)
    expect(o.session.current().epoch).toBe(42)
  })

  it('refuses a grant drawn on a seed that is not the beacon seed of its epoch (C8 review F4)', async () => {
    const key = await createSessionKey({alg: 'Ed25519'})
    const fragment = sessionGrantCreateFragment(key, {slots: [slotA, slotB], accessTtlSecs: 40, idleTimeoutSecs: 600, absoluteTtlSecs: 3600})
    const beacon = new Uint8Array(32).fill(0x5f)
    const transport = {...transportFor(vi.fn() as unknown as typeof fetch), trust: async (slot: `0x${string}`) => ({...await trust(slot), seed: beacon})}
    await expect(acceptSessionGrant({store: createMemoryStore(), key, clock: () => T0 + 1, transport}, fragment, {session_grant: grant(key, {iat: T0}), refresh_seq: 0}))
      .rejects.toMatchObject({code: 'seed-mismatch'})
  })

  it('refuses a refreshed grant that changes the session, adds a slot or answers another seq', async () => {
    const now = T0 + 20
    let mode = 'absolute'
    const ref: {key?: SessionKeyHandle} = {}
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {seq: number}
      if (mode === 'absolute') return reply(200, {session_grant: grant(ref.key!, {iat: now, absoluteExp: T0 + 7200}), refresh_seq: body.seq})
      if (mode === 'seq') return reply(200, {session_grant: grant(ref.key!, {iat: now}), refresh_seq: body.seq + 1})
      return reply(200, {session_grant: grant(ref.key!, {iat: now, sessionId: new Uint8Array(32).fill(1)}), refresh_seq: body.seq})
    }) as unknown as typeof fetch
    const o = await opened({clock: () => now, fetchImpl})
    ref.key = o.key
    await expect(o.session.refresh()).rejects.toThrow(/changed the session/)
    mode = 'seq'
    await expect(o.session.refresh()).rejects.toThrow(/does not answer this seq/)
    mode = 'id'
    await expect(o.session.refresh()).rejects.toThrow(/changed the session/)
  })

  it('a typed verifier refusal, a 404 or a local idle/absolute limit ends the session and asks for a new presentation', async () => {
    let now = T0 + 10
    const ended: string[] = []
    const fetchImpl = (async () => reply(403, {code: 'session_revoked'})) as unknown as typeof fetch
    const o = await opened({clock: () => now, fetchImpl, onEnded: e => ended.push(e.code)})
    await expect(o.session.refresh()).rejects.toBeInstanceOf(SessionEndedError)
    expect(ended).toEqual(['session_revoked'])
    expect(() => o.session.current()).toThrow(/present again/)

    const p = await opened({clock: () => now, fetchImpl: (async () => reply(404, {})) as unknown as typeof fetch, onEnded: e => ended.push(e.code)})
    await expect(p.session.refresh()).rejects.toThrow(/do not support/)

    const q = await opened({clock: () => now, onEnded: e => ended.push(e.code)})
    now = T0 + 601
    expect(() => q.session.current()).toThrow(/idle/)
    await expect(q.session.refresh()).rejects.toMatchObject({code: 'local-idle'})
    expect(q.fetchImpl).not.toHaveBeenCalled()

    now = T0 + 10
    const r = await opened({clock: () => now})
    now = T0 + 3600
    expect(() => r.session.current()).toThrow(/absolute expiry/)
  })

  it('a transient refresh failure keeps the session (retry before exp)', async () => {
    const o = await opened({clock: () => T0 + 20, fetchImpl: (async () => reply(503, {code: 'busy'})) as unknown as typeof fetch})
    await expect(o.session.refresh()).rejects.toThrow(/retry/)
    expect(o.session.current().iat).toBe(T0)
  })

  it('refreshes in the background before exp', async () => {
    vi.useFakeTimers()
    try {
      let now = T0
      const ref: {key?: SessionKeyHandle} = {}
      const calls: number[] = []
      const fetchImpl = (async (_u: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as {seq: number}
        calls.push(now)
        return reply(200, {session_grant: grant(ref.key!, {iat: now}), refresh_seq: body.seq})
      }) as unknown as typeof fetch
      const o = await opened({clock: () => now, fetchImpl})
      ref.key = o.key
      o.session.start()
      // Lead = max(5, 30/3) = 10 s: the first refresh fires at exp - 10 = T0 + 20.
      now = T0 + 20
      await vi.advanceTimersByTimeAsync(20_000)
      expect(calls).toEqual([T0 + 20])
      o.session.stop()
    } finally { vi.useRealTimers() }
  })

  it('revokes with the next seq under the revoke domain and ends locally', async () => {
    const now = T0 + 5
    const ref: {key?: SessionKeyHandle} = {}
    const bodies: {seq: number; grant: SessionGrantWire; issued_at: number; signature: string}[] = []
    const fetchImpl = (async (url: string, init: RequestInit) => {
      expect(url).toBe('https://agent.test/v1/sessions/revoke')
      bodies.push(JSON.parse(String(init.body)))
      return new Response(null, {status: 204})
    }) as unknown as typeof fetch
    const o = await opened({clock: () => now, fetchImpl})
    ref.key = o.key
    const {decodeSessionGrant} = await import('../../src/committee/session-grant.js')
    const jwk = ref.key!.jwk
    await o.session.revoke()
    const b = bodies[0]!
    expect(b.seq).toBe(1)
    const grantHash = sessionGrantHash(decodeSessionGrant(b.grant).payload)
    expect(verifySessionSignature(jwk, sessionControlHash('revoke', grantHash, 1, b.issued_at), hexToBytes(b.signature))).toBe(true)
    expect(verifySessionSignature(jwk, sessionControlHash('refresh', grantHash, 1, b.issued_at), hexToBytes(b.signature))).toBe(false)
    expect(() => o.session.current()).toThrow(/session_revoked/)
  })
})

describe('session grant journal commits (store-commit steps, perf/sdk-c7)', () => {
  // A store with native commit steps: every journal write must arrive as ONE commit (lock + staged
  // values published together), never a bare lock followed by a separate save.
  function committingStore() {
    const base = createMemoryStore()
    const log: string[] = []
    const steps: StoreCommitSteps = {
      withCommit: (keys, action) => {
        const key = typeof keys === 'string' ? keys : keys[0]!
        return base.withLock(key, async () => {
          const staged = new Map<string, unknown>()
          const commit: LockedCommit = {stage: (k, v) => { staged.set(k, structuredClone(v)) }}
          const result = await action(commit)
          for (const [k, v] of staged) await base.save(k, v)
          log.push(`commit:${staged.size}`)
          return result
        })
      },
      saveAll: async entries => { for (const [k, v] of entries) await base.save(k, v); log.push('saveAll') },
      saveRederivable: async (k, v) => { await base.save(k, v); log.push('rederivable') },
    }
    const store: ApplicationStore & {[STORE_COMMIT]: StoreCommitSteps} = {
      load: k => base.load(k),
      save: async (k, v) => { log.push('save'); await base.save(k, v) },
      withLock: (k, op) => { log.push('lock'); return base.withLock(k, op) },
      [STORE_COMMIT]: steps,
    }
    return {store, log}
  }

  it('accepts, reserves a refresh seq, records the refresh and marks a revoke each in one commit', async () => {
    let now = T0 + 20
    const {store, log} = committingStore()
    const key = await createSessionKey({alg: 'Ed25519'})
    const fragment = sessionGrantCreateFragment(key, {slots: [slotB, slotA], accessTtlSecs: 40, idleTimeoutSecs: 600, absoluteTtlSecs: 3600})
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {seq: number}
      // The seq's commit was published before the request left the client.
      expect((await store.load<{lastSeq: number}>('tasra.session-grant.0x' + '5a'.repeat(32)))?.lastSeq).toBe(body.seq)
      if (url.endsWith('/v1/sessions/refresh')) return reply(200, {session_grant: grant(key, {iat: now}), refresh_seq: body.seq})
      return new Response(null, {status: 204})
    }) as unknown as typeof fetch
    const session = await acceptSessionGrant({store, key, clock: () => now, transport: transportFor(fetchImpl)},
      fragment, {session_grant: grant(key, {iat: T0}), refresh_seq: 0})
    expect(log).toEqual(['commit:1'])
    await session.refresh()
    expect(log).toEqual(['commit:1', 'commit:1', 'commit:1'])
    now += 5
    await session.revoke()
    expect(log.filter(e => e === 'lock' || e === 'save')).toEqual([])
    expect(log.every(e => e.startsWith('commit:'))).toBe(true)
  })
})

describe('session grant chain pin and agent transport (ADR-0090 D7, review 2026-11-09)', () => {
  it('refuses a grant for another chain on accept, on refresh and on resume', async () => {
    const clock = () => T0 + 1
    const key = await createSessionKey({alg: 'Ed25519'})
    const fragment = sessionGrantCreateFragment(key, {slots: [slotA, slotB]})
    // Accept: a grant for chain 1 under a deployment configured for 43112.
    await expect(acceptSessionGrant({store: createMemoryStore(), key, clock, transport: transportFor(vi.fn() as unknown as typeof fetch)}, fragment,
      {session_grant: grant(key, {iat: T0, chainId: 1n}), refresh_seq: 0})).rejects.toMatchObject({code: 'wrong-chain'})
    // A transport whose chain differs from its approved agent's is no single deployment.
    await expect(acceptSessionGrant({store: createMemoryStore(), key, clock, transport: transportFor(vi.fn() as unknown as typeof fetch, 1)}, fragment,
      {session_grant: grant(key, {iat: T0, chainId: 1n}), refresh_seq: 0})).rejects.toThrow(/single deployment chain/)
    // Refresh: the verifiers answer with a grant naming another chain.
    const ref: {key?: SessionKeyHandle} = {}
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {seq: number}
      return reply(200, {session_grant: grant(ref.key!, {iat: T0 + 1, chainId: 1n}), refresh_seq: body.seq})
    }) as unknown as typeof fetch
    const o = await opened({clock, fetchImpl})
    ref.key = o.key
    await expect(o.session.refresh()).rejects.toMatchObject({code: 'wrong-chain'})
    expect(o.session.current().chain_id).toBe(43112)
    // Resume: the journal is for 43112; a process configured for another deployment never serves it.
    const otherDeployment = {...transportFor(fetchImpl), chainId: 1, agent: {...agentVia(fetchImpl), profile: {...profile, approval: {...profile.approval, chainId: 1}}}}
    const id = '0x' + '5a'.repeat(32)
    await expect(loadGrantedSession({store: o.store, key: o.key, transport: otherDeployment, clock}, id)).rejects.toMatchObject({code: 'wrong-chain'})
    await expect(loadGrantedSession({store: o.store, key: o.key, transport: transportFor(fetchImpl), clock}, id)).resolves.toBeDefined()
  })

  it('sends refresh and revoke through the paid agent policy: POST with a body, never a bearer', () => {
    const body = new TextEncoder().encode('{}')
    for (const path of ['/v1/sessions/refresh', '/v1/sessions/revoke']) {
      const shape = serviceRequestShape('paid-agent', 'https://agent.test' + path, {body, maxBytes: 65_536, method: 'POST'})
      expect(shape.method).toBe('POST')
      expect(shape.headers).not.toHaveProperty('authorization')
      expect(() => serviceRequestShape('paid-agent', 'https://agent.test' + path, {body, maxBytes: 65_536, method: 'POST', bearer: 'ab'.repeat(32)})).toThrow(/owner bearer/)
      expect(() => serviceRequestShape('paid-agent', 'https://agent.test' + path, {maxBytes: 65_536, method: 'POST'})).toThrow(/owner bearer/)
      expect(() => serviceRequestShape('paid-agent', 'https://agent.test' + path, {maxBytes: 65_536, method: 'GET'})).toThrow(/owner bearer/)
    }
    expect(() => serviceRequestShape('paid-agent', 'https://agent.test/v1/sessions/continue', {body, maxBytes: 65_536, method: 'POST'})).toThrow()
  })

  it('retries 503 session_revoke_partial with a fresh seq until the agent answers 204', async () => {
    const answers = [reply(503, {code: 'session_revoke_partial', error: 'session_revoke_partial'}), reply(429, {code: 'session_rate_limited'}), new Response(null, {status: 204})]
    const seqs: number[] = []
    const fetchImpl = (async (url: string, init: RequestInit) => {
      expect(url).toBe('https://agent.test/v1/sessions/revoke')
      seqs.push((JSON.parse(String(init.body)) as {seq: number}).seq)
      return answers.shift()!
    }) as unknown as typeof fetch
    const ended: string[] = []
    const o = await opened({clock: () => T0 + 5, fetchImpl, onEnded: e => ended.push(e.code)})
    const sleeps: number[] = []
    await o.session.revoke({sleep: async ms => { sleeps.push(ms) }})
    expect(seqs).toEqual([1, 2, 3])
    expect(sleeps).toHaveLength(2)
    expect(ended).toEqual(['session_revoked'])
  })

  it('an incomplete revoke is retryable, and the session serves nothing meanwhile (across a reload)', async () => {
    const fetchImpl = (async () => reply(503, {code: 'session_revoke_partial'})) as unknown as typeof fetch
    const o = await opened({clock: () => T0 + 5, fetchImpl})
    const error = await o.session.revoke({deadlineMs: 0}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SessionRevokeIncompleteError)
    expect(error).toMatchObject({retryable: true, code: 'session_revoke_partial'})
    expect(() => o.session.current()).toThrow(/being revoked/)
    const reloaded = await loadGrantedSession({store: o.store, key: o.key, transport: transportFor(fetchImpl), clock: () => T0 + 5}, '0x' + '5a'.repeat(32))
    expect(() => reloaded.current()).toThrow(/being revoked/)
    // A definite refusal is not retried.
    const p = await opened({clock: () => T0 + 5, fetchImpl: (async () => reply(403, {code: 'session_unauthenticated'})) as unknown as typeof fetch})
    await expect(p.session.revoke()).rejects.toThrow(/session_unauthenticated/)
  })

  it('a 404 revoke is NOT a success: a typed "not confirmed" error, while the session still ends and its key is disposed locally', async () => {
    const fetchImpl = (async () => reply(404, {code: 'session_unknown', error: 'session_unknown'})) as unknown as typeof fetch
    const ended: string[] = []
    const o = await opened({clock: () => T0 + 5, fetchImpl, onEnded: e => ended.push(e.code)})
    const error = await o.session.revoke().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SessionRevokeUnconfirmedError)
    expect(error).toMatchObject({retryable: false, code: 'session_unknown'})
    await expect(o.key.sign(new Uint8Array(32))).rejects.toThrow(/Session key disposed/)
    expect(ended).toEqual(['session_revoked'])
    expect(() => o.session.current()).toThrow(/session_revoked/)
  })
})

describe('a session follows the beacon across epoch boundaries (C19)', () => {
  // The agent continues a session ONE epoch per refresh, onto the epoch whose anchors it has; until
  // they land it answers a newer grant on the same epoch.
  function agentAt(ctx: {key?: SessionKeyHandle; now: number; drawable: bigint; seqs: number[]}) {
    return (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {seq: number; grant: SessionGrantWire}
      ctx.seqs.push(body.seq)
      const held = BigInt(body.grant.epoch)
      if (ctx.drawable > held + 1n) return reply(410, {code: 'session_expired'})
      ctx.now += 1
      return reply(200, {session_grant: grant(ctx.key!, {iat: ctx.now, epoch: ctx.drawable}), refresh_seq: body.seq})
    }) as unknown as typeof fetch
  }

  it('an observed beacon move refreshes the grant in the background, before the boundary that would end it', async () => {
    const ctx = {now: T0 + 5, drawable: 43n, seqs: [] as number[]}
    const refreshed: number[] = []
    const o = await opened({clock: () => ctx.now, fetchImpl: agentAt(ctx), extra: {followRetryMs: 0, onRefreshed: g => refreshed.push(g.epoch)}})
    ;(ctx as {key?: SessionKeyHandle}).key = o.key
    o.session.observeBeacon(42n)
    expect(ctx.seqs).toEqual([])
    // The beacon moved to 43 (seen by a payment's discovery): nothing waits, the refresh runs behind.
    o.session.observeBeacon(43n)
    expect(o.session.current().epoch).toBe(42)
    await o.session.followBeacon()
    expect(o.session.current().epoch).toBe(43)
    expect(refreshed).toEqual([43])
    // Observations never move back, and a current grant is not refreshed again.
    o.session.observeBeacon(42n)
    expect(await o.session.followBeacon()).toBe(false)
    expect(ctx.seqs).toEqual([1])
  })

  it('retries while the new epoch is not anchored at the agent, and stops once the grant is current', async () => {
    const ctx = {now: T0 + 5, drawable: 42n, seqs: [] as number[]}
    const agent = agentAt(ctx)
    // The agent's anchors for epoch 43 land after two same-epoch answers.
    const fetchImpl = (async (url: string, init: RequestInit) => {
      if (ctx.seqs.length === 2) ctx.drawable = 43n
      return agent(url, init)
    }) as unknown as typeof fetch
    const o = await opened({clock: () => ctx.now, fetchImpl, extra: {followRetryMs: 0}})
    ;(ctx as {key?: SessionKeyHandle}).key = o.key
    o.session.observeBeacon(43n)
    expect(await o.session.followBeacon()).toBe(true)
    expect(o.session.current().epoch).toBe(43)
    expect(ctx.seqs).toEqual([1, 2, 3])
  })

  it('never waits on a grant the beacon already left: two epochs behind, the session ends at once, with no refresh (C20)', async () => {
    const ctx = {now: T0 + 5, drawable: 44n, seqs: [] as number[]}
    const ended: string[] = []
    const o = await opened({clock: () => ctx.now, fetchImpl: agentAt(ctx), onEnded: e => ended.push(e.code), extra: {followRetryMs: 0}})
    ;(ctx as {key?: SessionKeyHandle}).key = o.key
    // The agent continues one epoch at a time and the verifiers judge the continuation at their live
    // beacon: no refresh can save a grant two epochs behind, so none is sent (each would spend quota).
    o.session.observeBeacon(44n)
    await expect(o.session.followBeacon()).rejects.toMatchObject({code: 'local-stale'})
    expect(ctx.seqs).toEqual([])
    expect(ended).toEqual(['local-stale'])
    expect(() => o.session.current()).toThrow(SessionEndedError)
  })

  it('start() polls the beacon and follows it without any message', async () => {
    vi.useFakeTimers()
    try {
      const ctx = {now: T0 + 5, drawable: 43n, seqs: [] as number[]}
      let beacon = 42n
      const o = await opened({clock: () => ctx.now, fetchImpl: agentAt(ctx), extra: {followRetryMs: 0, beacon: {latestEpoch: async () => beacon, pollMs: 1000}}})
      ;(ctx as {key?: SessionKeyHandle}).key = o.key
      o.session.start()
      await vi.advanceTimersByTimeAsync(1500)
      expect(ctx.seqs).toEqual([])
      beacon = 43n
      await vi.advanceTimersByTimeAsync(1000)
      await o.session.followBeacon()
      expect(o.session.current().epoch).toBe(43)
      expect(o.session.beaconEpoch).toBe(43n)
      o.session.stop()
    } finally { vi.useRealTimers() }
  })
})

describe('a failed follow is retried by a later observation at the same epoch (review F4)', () => {
  function sameEpochAgent(ctx: {key?: SessionKeyHandle; now: number; drawable: bigint; seqs: number[]}) {
    return (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {seq: number}
      ctx.seqs.push(body.seq)
      ctx.now += 1
      return reply(200, {session_grant: grant(ctx.key!, {iat: ctx.now, epoch: ctx.drawable}), refresh_seq: body.seq})
    }) as unknown as typeof fetch
  }

  it('after a run gives up, the same epoch observed again follows once the anchors land', async () => {
    const ctx: {key?: SessionKeyHandle; now: number; drawable: bigint; seqs: number[]} = {now: T0 + 5, drawable: 42n, seqs: []}
    const o = await opened({clock: () => ctx.now, fetchImpl: sameEpochAgent(ctx), extra: {followRetryMs: 0}})
    ctx.key = o.key
    o.session.observeBeacon(43n)
    // The background run gives up after its bounded attempts.
    await vi.waitFor(() => expect(ctx.seqs).toHaveLength(20))
    await new Promise(resolve => setTimeout(resolve, 0))
    ctx.drawable = 43n
    // Only the observation (no explicit followBeacon) may restart it.
    o.session.observeBeacon(43n)
    await vi.waitFor(() => expect(o.session.current().epoch).toBe(43))
    expect(ctx.seqs).toHaveLength(21)
  })

  it('backs off (bounded) before retrying a failed follow', async () => {
    vi.useFakeTimers()
    try {
      const ctx: {key?: SessionKeyHandle; now: number; drawable: bigint; seqs: number[]} = {now: T0 + 5, drawable: 42n, seqs: []}
      const o = await opened({clock: () => ctx.now, fetchImpl: sameEpochAgent(ctx), extra: {followRetryMs: 100}})
      ctx.key = o.key
      o.session.observeBeacon(43n)
      // 20 attempts, 19 pauses backing off from 100 ms (100, 200, 400, then 800): the run gives up
      // at 13.5 s, not after 19 back-to-back retries; the backoff before a new run is then 100 ms.
      await vi.advanceTimersByTimeAsync(1_000)
      expect(ctx.seqs).toHaveLength(4)
      await vi.advanceTimersByTimeAsync(12_550)
      expect(ctx.seqs).toHaveLength(20)
      // Within the backoff an observation starts nothing; after it, one does.
      o.session.observeBeacon(43n)
      await vi.advanceTimersByTimeAsync(0)
      expect(ctx.seqs).toHaveLength(20)
      ctx.drawable = 43n
      await vi.advanceTimersByTimeAsync(150)
      o.session.observeBeacon(43n)
      await vi.advanceTimersByTimeAsync(0)
      expect(o.session.current().epoch).toBe(43)
      expect(ctx.seqs).toHaveLength(21)
    } finally { vi.useRealTimers() }
  })
})

describe('every follow waiter settles (C19 hang: exit 13, unsettled top-level await)', () => {
  function sameEpochAgent(ctx: {key?: SessionKeyHandle; now: number; drawable: bigint; seqs: number[]; landAfter?: number}) {
    return (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {seq: number}
      ctx.seqs.push(body.seq)
      if (ctx.landAfter !== undefined && ctx.seqs.length > ctx.landAfter) ctx.drawable = 43n
      ctx.now += 1
      return reply(200, {session_grant: grant(ctx.key!, {iat: ctx.now, epoch: ctx.drawable}), refresh_seq: body.seq})
    }) as unknown as typeof fetch
  }
  // The follow's pauses (backing off from this delay) are the only timers created with a multiple of it.
  const PAUSE_MS = 37
  function pauses() {
    const created: ReturnType<typeof setTimeout>[] = []
    const real = globalThis.setTimeout
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      const t = real(fn, ms)
      if (ms !== undefined && ms > 0 && ms % PAUSE_MS === 0) created.push(t)
      return t
    }) as typeof setTimeout)
    return {created, restore: () => spy.mockRestore()}
  }

  it('a caller waiting in followBeacon holds the process through the pauses; a background follow never does', async () => {
    const p = pauses()
    try {
      const ctx: {key?: SessionKeyHandle; now: number; drawable: bigint; seqs: number[]; landAfter?: number} = {now: T0 + 5, drawable: 42n, seqs: [], landAfter: 3}
      const o = await opened({clock: () => ctx.now, fetchImpl: sameEpochAgent(ctx), extra: {followRetryMs: PAUSE_MS}})
      ctx.key = o.key
      // Background only (an observation): its pause is unreferenced.
      o.session.observeBeacon(43n)
      await vi.waitFor(() => expect(p.created).toHaveLength(1))
      expect(p.created[0]!.hasRef()).toBe(false)
      // A caller joins and waits: the running pause now holds the process, and so does every later one.
      // (Before the fix every pause stayed unreferenced, so a top-level `await` on a message whose
      // only pending work was this pause was dropped when the event loop drained.)
      const waiting = o.session.followBeacon()
      expect(p.created[0]!.hasRef()).toBe(true)
      expect(await waiting).toBe(true)
      expect(p.created.length).toBeGreaterThan(1)
      expect(p.created.every(t => t.hasRef())).toBe(true)
      expect(o.session.current().epoch).toBe(43)
    } finally { p.restore() }
  })

  it('stop() rejects a waiting follow at once instead of leaving it on a cleared or distant timer', async () => {
    const ctx: {key?: SessionKeyHandle; now: number; drawable: bigint; seqs: number[]} = {now: T0 + 5, drawable: 42n, seqs: []}
    const o = await opened({clock: () => ctx.now, fetchImpl: sameEpochAgent(ctx), extra: {followRetryMs: 60_000}})
    ctx.key = o.key
    o.session.observeBeacon(43n)
    const waiting = o.session.followBeacon()
    await vi.waitFor(() => expect(ctx.seqs).toHaveLength(1))
    await new Promise(resolve => setImmediate(resolve))
    o.session.stop()
    await expect(waiting).rejects.toThrow(/follow stopped/)
    // The held grant is unchanged and still serves; a later observation follows again.
    expect(o.session.current().epoch).toBe(42)
    expect(ctx.seqs).toHaveLength(1)
  }, 2_000)

  it('a revoke while a follow pauses rejects its waiter at once; the ended session serves nothing', async () => {
    const ctx: {key?: SessionKeyHandle; now: number; drawable: bigint; seqs: number[]} = {now: T0 + 5, drawable: 42n, seqs: []}
    const agent = sameEpochAgent(ctx)
    // The revoke is acknowledged (204); refreshes stay on the old epoch.
    const fetchImpl = (async (url: string, init: RequestInit) => url.endsWith('/v1/sessions/revoke') ? new Response(null, {status: 204}) : agent(url, init)) as unknown as typeof fetch
    const o = await opened({clock: () => ctx.now, fetchImpl, extra: {followRetryMs: 60_000}})
    ctx.key = o.key
    o.session.observeBeacon(43n)
    const waiting = o.session.followBeacon()
    const settled = waiting.then(() => 'resolved', (e: unknown) => e)
    await vi.waitFor(() => expect(ctx.seqs).toHaveLength(1))
    await new Promise(resolve => setImmediate(resolve))
    await o.session.revoke()
    const outcome = await settled
    expect(outcome).toBeInstanceOf(Error)
    expect(() => o.session.current()).toThrow(SessionEndedError)
  }, 2_000)
})

describe('background refresh does not defeat the idle timeout (review F5)', () => {
  async function running() {
    vi.setSystemTime(T0 * 1000)
    const clock = () => Math.floor(Date.now() / 1000)
    const ref: {key?: SessionKeyHandle} = {}
    const calls: number[] = []
    const ended: string[] = []
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {seq: number; grant: SessionGrantWire}
      calls.push(clock())
      return reply(200, {session_grant: grant(ref.key!, {iat: clock()}), refresh_seq: body.seq})
    }) as unknown as typeof fetch
    const o = await opened({clock, fetchImpl, onEnded: e => ended.push(e.code)})
    ref.key = o.key
    o.session.start()
    return {o, calls, ended}
  }

  it('an unused session stops refreshing and ends at its idle timeout while start() runs', async () => {
    vi.useFakeTimers()
    try {
      const {o, calls, ended} = await running()
      await vi.advanceTimersByTimeAsync(700_000)
      expect(ended).toEqual(['local-idle'])
      // No refresh after the idle timeout (600 s) since the last use (acceptance).
      expect(calls.length).toBeGreaterThan(0)
      expect(Math.max(...calls)).toBeLessThanOrEqual(T0 + 600)
      expect(() => o.session.current()).toThrow(/idle/)
      const count = calls.length
      await vi.advanceTimersByTimeAsync(100_000)
      expect(calls).toHaveLength(count)
    } finally { vi.useRealTimers() }
  })

  it('a used session keeps refreshing past the idle timeout', async () => {
    vi.useFakeTimers()
    try {
      const {o, calls, ended} = await running()
      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(400_000)
        o.session.current()
      }
      expect(ended).toEqual([])
      expect(Math.max(...calls)).toBeGreaterThan(T0 + 1500)
      o.session.stop()
    } finally { vi.useRealTimers() }
  })
})

describe('session recovery: definite refusals end, the follow refreshes once per epoch at the anchor (C20)', () => {
  it('a definite refresh refusal ends the session (present again): session_context_changed, session_continuation, a 404 session_unknown', async () => {
    for (const [status, code] of [[409, 'session_context_changed'], [403, 'session_continuation'], [404, 'session_unknown'], [403, 'session_wrong_key']] as const) {
      const ended: string[] = []
      const o = await opened({clock: () => T0 + 10, fetchImpl: (async () => reply(status, {code, error: code})) as unknown as typeof fetch, onEnded: e => ended.push(e.code)})
      await expect(o.session.refresh()).rejects.toMatchObject({code})
      expect(ended).toEqual([code])
      expect(() => o.session.current()).toThrow(SessionEndedError)
    }
  })

  it('a transient refusal keeps the session and carries its status, code and Retry-After', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({code: 'session_rate_limited'}), {status: 429, headers: {'content-type': 'application/json', 'retry-after': '3'}})) as unknown as typeof fetch
    const o = await opened({clock: () => T0 + 10, fetchImpl})
    await expect(o.session.refresh()).rejects.toMatchObject({name: 'SessionRefreshError', status: 429, code: 'session_rate_limited', retryAfterMs: 3000})
    expect(o.session.current().epoch).toBe(42)
  })

  it('session_verifier_behind (C24) is retried with the same grant, never ended on: its Retry-After, else 2 s', async () => {
    const {SESSION_RETRYABLE_CODES, SESSION_REFUSAL_CODES, SESSION_VERIFIER_BEHIND_RETRY_MS} = await import('../../src/app/session-grants.js')
    expect(SESSION_RETRYABLE_CODES.has('session_verifier_behind')).toBe(true)
    expect(SESSION_REFUSAL_CODES.has('session_verifier_behind')).toBe(false)
    for (const code of SESSION_RETRYABLE_CODES) expect(SESSION_REFUSAL_CODES.has(code)).toBe(false)
    // A Retry-After the agent sets or relays is honoured; an older agent sends the code without one: 2 s.
    for (const [header, expected] of [['5', 5000], [undefined, SESSION_VERIFIER_BEHIND_RETRY_MS]] as const) {
      const ended: string[] = []
      const fetchImpl = (async () => new Response(JSON.stringify({code: 'session_verifier_behind', error: 'session_verifier_behind'}),
        {status: 503, headers: {'content-type': 'application/json', ...header ? {'retry-after': header} : {}}})) as unknown as typeof fetch
      const o = await opened({clock: () => T0 + 10, fetchImpl, onEnded: e => ended.push(e.code)})
      await expect(o.session.refresh()).rejects.toMatchObject({name: 'SessionRefreshError', retryable: true, status: 503, code: 'session_verifier_behind', retryAfterMs: expected})
      expect(ended).toEqual([])
      expect(o.session.current().epoch).toBe(42)
      o.session.stop()
    }
    // Another transient code without a header keeps no invented pause.
    const busy = await opened({clock: () => T0 + 10, fetchImpl: (async () => reply(503, {code: 'session_unavailable'})) as unknown as typeof fetch})
    await expect(busy.session.refresh()).rejects.toMatchObject({code: 'session_unavailable', retryAfterMs: undefined})
  })

  it('a follow honours Retry-After before its next attempt (no retry storm against the per-holder quota)', async () => {
    vi.useFakeTimers()
    try {
      const at: number[] = []
      let limited = true
      const ref: {key?: SessionKeyHandle} = {}
      const fetchImpl = (async (_u: string, init: RequestInit) => {
        at.push(Date.now())
        const body = JSON.parse(String(init.body)) as {seq: number}
        if (limited) { limited = false; return new Response(JSON.stringify({code: 'session_rate_limited'}), {status: 429, headers: {'content-type': 'application/json', 'retry-after': '4'}}) }
        return reply(200, {session_grant: grant(ref.key!, {iat: T0 + 6, epoch: 43n}), refresh_seq: body.seq})
      }) as unknown as typeof fetch
      const o = await opened({clock: () => T0 + 5, fetchImpl, extra: {followRetryMs: 100}})
      ref.key = o.key
      o.session.observeBeacon(43n)
      await vi.advanceTimersByTimeAsync(3_900)
      expect(at).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(200)
      expect(at).toHaveLength(2)
      expect(o.session.current().epoch).toBe(43)
    } finally { vi.useRealTimers() }
  })

  it('with a draw observation the poll refreshes ONCE per epoch, at the anchor, never while the agent can only re-sign the old epoch (5 ms storm)', async () => {
    vi.useFakeTimers()
    try {
      // The beacon moved to 43 but its verifier snapshot anchors only 8 s later (the lab fleet's
      // anchoring lag); until then the agent draws on 42 and a refresh re-signs the grant there.
      const t0 = Date.now()
      const anchored = () => Date.now() - t0 >= 8_000
      const seqs: number[] = []
      const ref: {key?: SessionKeyHandle} = {}
      let iat = T0 + 5
      const fetchImpl = (async (_u: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as {seq: number}
        seqs.push(body.seq)
        return reply(200, {session_grant: grant(ref.key!, {iat: ++iat, epoch: anchored() ? 43n : 42n}), refresh_seq: body.seq})
      }) as unknown as typeof fetch
      const o = await opened({clock: () => T0 + 5, fetchImpl, extra: {followRetryMs: 1000, beacon: {
        latestEpoch: async () => 43n,
        drawState: async () => ({latest: 43n, ...anchored() ? {draw: 43n} : {draw: 42n}}),
        pollMs: 1000}}})
      ref.key = o.key
      o.session.start()
      await vi.advanceTimersByTimeAsync(7_500)
      expect(seqs).toEqual([])
      expect(o.session.drawEpoch).toBe(42n)
      await vi.advanceTimersByTimeAsync(1_000)
      expect(seqs).toEqual([1])
      expect(o.session.current().epoch).toBe(43)
      await vi.advanceTimersByTimeAsync(5_000)
      expect(seqs).toEqual([1])
      o.session.stop()
    } finally { vi.useRealTimers() }
  })

  it('a grant born stale (the beacon two epochs past it when the open completes) ends at the first poll, with no refresh', async () => {
    vi.useFakeTimers()
    try {
      const seqs: number[] = []
      const ended: string[] = []
      const fetchImpl = (async (_u: string, init: RequestInit) => { seqs.push((JSON.parse(String(init.body)) as {seq: number}).seq); return reply(503, {code: 'session_unavailable'}) }) as unknown as typeof fetch
      const o = await opened({clock: () => T0 + 5, fetchImpl, onEnded: e => ended.push(e.code), extra: {followRetryMs: 0,
        beacon: {latestEpoch: async () => 44n, drawState: async () => ({latest: 44n, draw: 43n}), pollMs: 1000}}})
      o.session.start()
      await vi.advanceTimersByTimeAsync(10)
      expect(ended).toEqual(['local-stale'])
      expect(seqs).toEqual([])
      expect(() => o.session.current()).toThrow(/local-stale/)
    } finally { vi.useRealTimers() }
  })

  it('a grant born one epoch behind with the next epoch already drawable refreshes at the first poll', async () => {
    vi.useFakeTimers()
    try {
      const ref: {key?: SessionKeyHandle} = {}
      const seqs: number[] = []
      const fetchImpl = (async (_u: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as {seq: number}
        seqs.push(body.seq)
        return reply(200, {session_grant: grant(ref.key!, {iat: T0 + 6, epoch: 43n}), refresh_seq: body.seq})
      }) as unknown as typeof fetch
      const o = await opened({clock: () => T0 + 5, fetchImpl, extra: {followRetryMs: 0,
        beacon: {latestEpoch: async () => 43n, drawState: async () => ({latest: 43n, draw: 43n}), pollMs: 60_000}}})
      ref.key = o.key
      o.session.start()
      await vi.advanceTimersByTimeAsync(10)
      expect(seqs).toEqual([1])
      expect(o.session.current().epoch).toBe(43)
      o.session.stop()
    } finally { vi.useRealTimers() }
  })

  it('the expiry refresh backs off on transient failures and honours Retry-After', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(T0 * 1000)
      const clock = () => Math.floor(Date.now() / 1000)
      const at: number[] = []
      const fetchImpl = (async () => { at.push(Date.now()); return new Response(JSON.stringify({code: 'session_rate_limited'}), {status: 429, headers: {'content-type': 'application/json', 'retry-after': '5'}}) }) as unknown as typeof fetch
      // A 40 s grant refreshed 30 s before exp: the first attempt at +10 s, then every Retry-After (5 s), not every second.
      const o = await opened({clock, fetchImpl, ttl: 40, extra: {refreshLeadSecs: 30}})
      o.session.start()
      await vi.advanceTimersByTimeAsync(10_500)
      expect(at).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(4_000)
      expect(at).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1_500)
      expect(at).toHaveLength(2)
      o.session.stop()
    } finally { vi.useRealTimers() }
  })
})

describe('session recovery review fixes (C21 review F4, F7, F8)', () => {
  const contextChanged = (async () => reply(409, {code: 'session_context_changed', error: 'session_context_changed'})) as unknown as typeof fetch

  it('a `session_context_changed` the chain does not confirm (the grant at the latest epoch: the verifier is behind) is retried, then ends past the bound', async () => {
    vi.useFakeTimers()
    try {
      const ended: string[] = []
      const o = await opened({clock: () => T0 + 10, fetchImpl: contextChanged, onEnded: e => ended.push(e.code),
        extra: {contextRetryMs: 5_000, beacon: {latestEpoch: async () => 42n}}})
      await expect(o.session.refresh()).rejects.toMatchObject({name: 'SessionRefreshError', code: 'session_context_changed'})
      expect(ended).toEqual([])
      expect(o.session.current().epoch).toBe(42)
      await vi.advanceTimersByTimeAsync(4_000)
      await expect(o.session.refresh()).rejects.toMatchObject({name: 'SessionRefreshError'})
      // The refusal persisted past the bound: the session ends.
      await vi.advanceTimersByTimeAsync(1_500)
      await expect(o.session.refresh()).rejects.toBeInstanceOf(SessionEndedError)
      expect(ended).toEqual(['session_context_changed'])
    } finally { vi.useRealTimers() }
  })

  it('a `session_context_changed` the chain confirms (the grant two epochs behind) ends at once; no retry', async () => {
    const ended: string[] = []
    const o = await opened({clock: () => T0 + 10, fetchImpl: contextChanged, onEnded: e => ended.push(e.code),
      extra: {contextRetryMs: 60_000, beacon: {latestEpoch: async () => 44n}}})
    await expect(o.session.refresh()).rejects.toMatchObject({code: 'session_context_changed'})
    expect(ended).toEqual(['session_context_changed'])
  })

  it('a failing `drawState` falls back to `latestEpoch`: the follow still refreshes, with one warning', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const ref: {key?: SessionKeyHandle} = {}
      const seqs: number[] = []
      const fetchImpl = (async (_u: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as {seq: number}
        seqs.push(body.seq)
        return reply(200, {session_grant: grant(ref.key!, {iat: T0 + 6, epoch: 43n}), refresh_seq: body.seq})
      }) as unknown as typeof fetch
      const o = await opened({clock: () => T0 + 5, fetchImpl, extra: {followRetryMs: 0,
        beacon: {latestEpoch: async () => 43n, drawState: async () => { throw new Error('rpc: method not found') }, pollMs: 1000}}})
      ref.key = o.key
      o.session.start()
      await vi.advanceTimersByTimeAsync(3_500)
      expect(seqs).toEqual([1])
      expect(o.session.current().epoch).toBe(43)
      expect(warn).toHaveBeenCalledTimes(1)
      o.session.stop()
    } finally { warn.mockRestore(); vi.useRealTimers() }
  })

  it('a grant the beacon left (two epochs behind) ends at once even inside a failed follow\'s backoff', async () => {
    vi.useFakeTimers()
    try {
      const ctx = {key: undefined as SessionKeyHandle | undefined, now: T0 + 5}
      const ended: string[] = []
      // The agent only re-signs the old epoch: every follow attempt fails; the run gives up and backs off.
      const fetchImpl = (async (_u: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as {seq: number}
        ctx.now += 1
        return reply(200, {session_grant: grant(ctx.key!, {iat: ctx.now, epoch: 42n}), refresh_seq: body.seq})
      }) as unknown as typeof fetch
      const o = await opened({clock: () => ctx.now, fetchImpl, onEnded: e => ended.push(e.code), extra: {followRetryMs: 1_000}})
      ctx.key = o.key
      o.session.observeBeacon(43n)
      // 20 attempts with 19 pauses (1, 2, 4, then 8 s): the run gives up after ~135 s; the next run may start 1 s later.
      await vi.advanceTimersByTimeAsync(135_500)
      expect(ended).toEqual([])
      o.session.observeBeacon(44n)
      await vi.advanceTimersByTimeAsync(0)
      expect(ended).toEqual(['local-stale'])
    } finally { vi.useRealTimers() }
  })
})

describe('session grant acceptance and resume refusals', () => {
  it('a session key signs 32-byte hashes only, on either key kind', async () => {
    for (const alg of ['Ed25519', 'ES256'] as const) {
      const key = await createSessionKey({alg})
      await expect(key.sign(new Uint8Array(31))).rejects.toThrow('Session key signs 32-byte hashes only')
      await expect(key.sign(new Uint8Array(33))).rejects.toThrow('Session key signs 32-byte hashes only')
    }
  })
  it('without a working WebCrypto ECDSA the default key is Ed25519; an explicit ES256 request fails instead of downgrading', async () => {
    const spy = vi.spyOn(globalThis.crypto.subtle, 'generateKey').mockRejectedValue(new Error('no ECDSA here'))
    try {
      const key = await createSessionKey()
      expect(key.jwk).toMatchObject({kty: 'OKP', crv: 'Ed25519'})
      const hash = new Uint8Array(32).fill(3)
      expect(verifySessionSignature(key.jwk, hash, await key.sign(hash))).toBe(true)
      await expect(createSessionKey({alg: 'ES256'})).rejects.toThrow('no ECDSA here')
    } finally { spy.mockRestore() }
  })
  it('refuses a grant naming a slot that was not requested, and an absolute lifetime above the request', async () => {
    const clock = () => T0 + 1, key = await createSessionKey({alg: 'Ed25519'})
    const accept = (fragment: ReturnType<typeof sessionGrantCreateFragment>, g: SessionGrantWire) =>
      acceptSessionGrant({store: createMemoryStore(), key, clock, transport: transportFor(vi.fn() as unknown as typeof fetch)}, fragment, {session_grant: g, refresh_seq: 0})
    await expect(accept(sessionGrantCreateFragment(key, {slots: [slotA]}), grant(key, {iat: T0}))).rejects.toMatchObject({code: 'slot-not-granted'})
    await expect(accept(sessionGrantCreateFragment(key, {slots: [slotA, slotB], absoluteTtlSecs: 600}), grant(key, {iat: T0, absoluteExp: T0 + 601}))).rejects
      .toMatchObject({code: 'absolute-exp'})
    await expect(accept(sessionGrantCreateFragment(key, {slots: [slotA, slotB], absoluteTtlSecs: 600}), grant(key, {iat: T0, absoluteExp: T0 + 600}))).resolves.toBeDefined()
  })
  it('refuses to accept the same session twice into one store, leaving the first journal unchanged', async () => {
    const o = await opened({clock: () => T0 + 1})
    const id = 'tasra.session-grant.0x' + '5a'.repeat(32), before = structuredClone(await o.store.load(id))
    expect(before).toBeDefined()
    const fragment = sessionGrantCreateFragment(o.key, {slots: [slotB, slotA], accessTtlSecs: 40, idleTimeoutSecs: 600, absoluteTtlSecs: 3600})
    await expect(acceptSessionGrant({store: o.store, key: o.key, clock: () => T0 + 1, transport: transportFor(o.fetchImpl)}, fragment,
      {session_grant: grant(o.key, {iat: T0 + 1}), refresh_seq: 0})).rejects.toThrow('Session grant already accepted for this session')
    expect(await o.store.load(id)).toEqual(before)
    expect(o.session.key).toBe(o.key)
  })
  it('current() refuses a grant past its exp (refresh first) while the session is otherwise live', async () => {
    let now = T0 + 1
    const o = await opened({clock: () => now})
    expect(o.session.current().exp).toBe(T0 + 30)
    now = T0 + 31
    expect(() => o.session.current()).toThrow(expect.objectContaining({code: 'expired'}))
  })
  it('resume refuses a malformed session id, a missing journal and another session key', async () => {
    const o = await opened({clock: () => T0 + 1})
    const opts = {store: o.store, key: o.key, transport: transportFor(o.fetchImpl), clock: () => T0 + 1}
    await expect(loadGrantedSession(opts, '0x5a')).rejects.toThrow('Invalid session id')
    await expect(loadGrantedSession(opts, '0x' + '6b'.repeat(32))).rejects.toThrow('No session grant journal for this session')
    const other = await createSessionKey({alg: 'Ed25519'})
    await expect(loadGrantedSession({...opts, key: other}, '0x' + '5a'.repeat(32))).rejects.toMatchObject({code: 'wrong-key'})
    expect((await loadGrantedSession(opts, '0x' + '5a'.repeat(32))).sessionId).toBe('0x' + '5a'.repeat(32))
  })
})
