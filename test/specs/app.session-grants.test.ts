import {describe, expect, it, vi} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import {hexToBytes} from '../../src/crypto/hex.js'
import {createMemoryStore} from '../../src/app/memory-store.js'
import {acceptSessionGrant, createSessionKey, sessionGrantCreateFragment, SessionEndedError, type SessionKeyHandle, type SlotTrust} from '../../src/app/session-grants.js'
import {BINDING_HOLDER_KEY, type VerifierSet} from '../../src/committee/token.js'
import {encodeSessionGrant, sessionControlHash, sessionGrantHash, sessionGrantPayload, sessionKeyThumbprint, verifySessionSignature,
  type GrantSlot, type SessionGrantWire} from '../../src/committee/session-grant.js'

// Verifier i signs with the Ed25519 seed [0x10+i; 32] (as the reference vectors); registry 7, committee 3, quorum 2.
const seeds = Array.from({length: 7}, (_, i) => new Uint8Array(32).fill(0x10 + i))
const set: VerifierSet = {registrySize: 7, pubkeys: new Map(seeds.map((s, i) => [i, ed25519.getPublicKey(s)]))}
const slotA = ('0x' + '01'.repeat(32)) as `0x${string}`, slotB = ('0x' + '02'.repeat(32)) as `0x${string}`
const rules: Record<string, Uint8Array> = {[slotA]: new Uint8Array(32).fill(0xfe), [slotB]: new Uint8Array(32).fill(0xfd)}
const trust = async (slot: `0x${string}`): Promise<SlotTrust> => ({set, committee: 3, quorum: 2, ruleHash: rules[slot.toLowerCase()]!})
const T0 = 1_800_000_000

function grant(key: SessionKeyHandle, o: {iat: number; ttl?: number; idle?: number; absoluteExp?: number; slots?: string[]; sessionId?: Uint8Array}): SessionGrantWire {
  const slots: GrantSlot[] = (o.slots ?? [slotA, slotB]).map(s => ({slotId: hexToBytes(s), ruleHash: rules[s]!}))
  const payload = sessionGrantPayload({chainId: 43112n, sessionId: o.sessionId ?? new Uint8Array(32).fill(0x5a), holderHash: new Uint8Array(32).fill(0x48),
    sessionKeyThumbprint: sessionKeyThumbprint(key.jwk), binding: BINDING_HOLDER_KEY, action: 'decrypt', seed: new Uint8Array(32).fill(0x5e), epoch: 42n,
    slots, iat: o.iat, exp: o.iat + (o.ttl ?? 30), idleTimeoutSecs: o.idle ?? 600, absoluteExp: o.absoluteExp ?? T0 + 3600})
  const hash = sessionGrantHash(payload)
  return encodeSessionGrant({payload, signatures: seeds.map((s, i) => ({verifierIndex: i, signature: ed25519.sign(hash, s)}))})
}

async function opened(opts: {clock: () => number; fetchImpl?: typeof fetch; onEnded?: (e: SessionEndedError) => void; ttl?: number}) {
  const key = await createSessionKey({alg: 'Ed25519'})
  const store = createMemoryStore()
  const fragment = sessionGrantCreateFragment(key, {slots: [slotB, slotA], accessTtlSecs: 40, idleTimeoutSecs: 600, absoluteTtlSecs: 3600})
  const fetchImpl = opts.fetchImpl ?? (vi.fn() as unknown as typeof fetch)
  const session = await acceptSessionGrant({store, key, clock: opts.clock, onEnded: opts.onEnded, transport: {agentUrl: 'https://agent.test', fetchImpl, trust}},
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
    const accept = (g: SessionGrantWire, refresh_seq = 0) => acceptSessionGrant({store: createMemoryStore(), key, clock, transport: {agentUrl: 'https://a', trust}}, fragment, {session_grant: g, refresh_seq})
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
      expect(init).toMatchObject({redirect: 'error', credentials: 'omit'})
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
      return reply(200, {})
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
