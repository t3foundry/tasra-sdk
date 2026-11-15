// ADR-0099 custody health: a keeper's reply counts only when its statement verifies under the
// operator's REGISTERED identity key, names this chain, slot and operator, is fresh, and its
// unsigned body agrees with the signed statement. The committee's liveness comes from the chain.
import {describe, expect, it, vi} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import {bytesToHex, encodePacked, getAddress, keccak256, toHex, type Address, type Hex} from 'viem'
import {
  CUSTODY_HEALTH_DOMAIN,
  CustodyHealthError,
  assessCustodyHealth,
  custodyStatementHash,
  custodyStatementIsCurrent,
  parseCustodyStatement,
  readCustodyHealth,
  verifyCustodyHealthReply,
  verifyCustodyStatement,
  type CustodyStatement,
} from '../../src/chain/custodyHealth.js'
import {ROTATION_LOCK_SENTINEL} from '../../src/chain/rotationLock.js'
import type {TasraChainClient} from '../../src/chain/client.js'

const CHAIN = 43112
const SLOT = `0x${'11'.repeat(32)}` as Hex
const KEY = `0x02${'ab'.repeat(32)}` as Hex
const NOW = 1_800_000_000
const op = (n: number): Address => getAddress(`0x${n.toString(16).padStart(40, '0')}`)
const secret = (n: number) => new Uint8Array(32).fill(n)
const pub = (n: number) => ed25519.getPublicKey(secret(n))

/** The statement as the keeper serializes it (snake case, lowercase hex). */
function wire(operator: Address, over: Record<string, unknown> = {}) {
  return {
    chain_id: CHAIN, slot: SLOT, operator: operator.toLowerCase(), epoch: 0, committee_version: 2, public_key: KEY, reshare: 'current',
    share_committee_version: 2, share_matches_chain_key: true, retained_generations: 0, last_failure: null, observed_at: NOW, ...over,
  }
}

/** A reply the way `api/custody_health.rs` builds it, signed by key `n`. */
function reply(operator: Address, n: number, over: Record<string, unknown> = {}, body: Record<string, unknown> = {}) {
  const statement = wire(operator, over)
  const signature = ed25519.sign(custodyStatementHash(parseCustodyStatement(statement)), secret(n))
  return {
    slot: statement.slot, mode: 'tecdsa',
    chain: {public_key: statement.public_key, address: null, epoch: statement.epoch, committee_version: statement.committee_version, k: 2, n: 3, cancelled: false, rotation_locked: true},
    committee: {members: 3, live_members: 3, margin: 1, not_live: []},
    local: null, reshare: statement.reshare, health: 'ok', observed_at: statement.observed_at, last_failure: statement.last_failure,
    attestation: {statement, pubkey: bytesToHex(pub(n)), signature: bytesToHex(signature)},
    ...body,
  }
}

const expected = (operator: Address, n: number) => ({chainId: CHAIN, slotId: SLOT, operator, registeredPublicKey: pub(n), nowSecs: NOW})

function refused(run: () => unknown, code: string): CustodyHealthError {
  try {
    run()
  } catch (e) {
    expect(e).toBeInstanceOf(CustodyHealthError)
    expect((e as CustodyHealthError).code).toBe(code)
    return e as CustodyHealthError
  }
  throw new Error('accepted')
}

describe('custodyStatementHash', () => {
  it('is keccak256 over the network preimage, written out field by field', () => {
    const s = parseCustodyStatement(wire(op(0x22), {
      epoch: 3, committee_version: 7, share_committee_version: null, share_matches_chain_key: false, retained_generations: 2,
      last_failure: {committee_version: 7, blamed_operator_id: 4, reason: 'seal open'},
    }))
    const preimage = encodePacked(
      ['string', 'uint64', 'bytes32', 'address', 'uint64', 'uint64', 'uint64', 'bytes', 'uint64', 'string',
        'uint8', 'uint8', 'uint64', 'uint8', 'uint64', 'uint8', 'uint64', 'uint8', 'uint64', 'uint64', 'string', 'uint64'],
      [CUSTODY_HEALTH_DOMAIN, 43112n, SLOT, op(0x22), 3n, 7n, 33n, KEY, 7n, 'current',
        0, 1, 0n, 1, 2n, 1, 7n, 1, 4n, 9n, 'seal open', BigInt(NOW)],
    )
    expect(toHex(custodyStatementHash(s))).toBe(keccak256(preimage))
    expect(CUSTODY_HEALTH_DOMAIN).toBe('keykeeper-committee/custody-health/v1')
  })

  it('binds every field, and only the registered key verifies', () => {
    const base = parseCustodyStatement(wire(op(0x22)))
    const sig = ed25519.sign(custodyStatementHash(base), secret(7))
    expect(verifyCustodyStatement(base, pub(7), sig)).toBe(true)
    const mutations: Partial<CustodyStatement>[] = [
      {chainId: 1}, {slot: `0x${'12'.repeat(32)}`}, {operator: op(0x23)}, {epoch: 1}, {committeeVersion: 3}, {publicKey: '0x03ab'},
      {reshare: 'pending'}, {shareCommitteeVersion: 1}, {shareCommitteeVersion: null}, {shareMatchesChainKey: false}, {shareMatchesChainKey: null},
      {retainedGenerations: 1}, {retainedGenerations: null}, {lastFailure: {committeeVersion: 2, blamedOperatorId: null, reason: 'x'}}, {observedAt: NOW + 1},
    ]
    for (const m of mutations) expect(verifyCustodyStatement({...base, ...m}, pub(7), sig), JSON.stringify(m)).toBe(false)
    const failed = {...base, lastFailure: {committeeVersion: 2, blamedOperatorId: 4, reason: 'x'}}
    const fsig = ed25519.sign(custodyStatementHash(failed), secret(7))
    for (const lf of [{committeeVersion: 2, blamedOperatorId: null, reason: 'x'}, {committeeVersion: 2, blamedOperatorId: 5, reason: 'x'}, {committeeVersion: 2, blamedOperatorId: 4, reason: 'y'}]) {
      expect(verifyCustodyStatement({...failed, lastFailure: lf}, pub(7), fsig)).toBe(false)
    }
    expect(verifyCustodyStatement(base, pub(8), sig)).toBe(false)
    expect(verifyCustodyStatement(base, pub(7).slice(1), sig)).toBe(false)
    expect(verifyCustodyStatement(base, pub(7), sig.slice(1))).toBe(false)
    expect(verifyCustodyStatement({...base, epoch: -1}, pub(7), sig)).toBe(false)
  })
})

describe('parseCustodyStatement', () => {
  it('decodes last_failure and treats missing options as null', () => {
    const s = parseCustodyStatement({...wire(op(1), {last_failure: {committee_version: 3, blamed_operator_id: null, reason: 'too few dealers'}}),
      share_committee_version: undefined, retained_generations: undefined})
    expect(s.lastFailure).toEqual({committeeVersion: 3, blamedOperatorId: null, reason: 'too few dealers'})
    expect(s).toMatchObject({shareCommitteeVersion: null, retainedGenerations: null, operator: op(1).toLowerCase()})
    expect(parseCustodyStatement(wire(op(1), {last_failure: {committee_version: 3, reason: 'r'}})).lastFailure?.blamedOperatorId).toBeNull()
  })

  it.each([
    ['an unknown field', {extra: 1}],
    ['a missing field', {observed_at: undefined}],
    ['an unknown reshare state', {reshare: 'done'}],
    ['a short slot', {slot: '0x11'}],
    ['odd hex', {public_key: '0x123'}],
    ['a negative epoch', {epoch: -1}],
    ['an unsafe integer', {committee_version: 2 ** 60}],
    ['a string number', {chain_id: '43112'}],
    ['a non-boolean match', {share_matches_chain_key: 'yes'}],
    ['an out-of-range blamed id', {last_failure: {committee_version: 1, blamed_operator_id: 70000, reason: 'r'}}],
    ['a failure with an unknown field', {last_failure: {committee_version: 1, reason: 'r', party: 1}}],
    ['a failure without a reason string', {last_failure: {committee_version: 1, reason: 5}}],
  ])('refuses %s', (_n, over) => {
    const raw = wire(op(1), over) as Record<string, unknown>
    for (const [k, v] of Object.entries(over)) if (v === undefined) delete raw[k]
    refused(() => parseCustodyStatement(raw), 'malformed')
  })

  it('refuses a non-object', () => {
    refused(() => parseCustodyStatement([]), 'malformed')
    refused(() => parseCustodyStatement(null), 'malformed')
  })
})

describe('verifyCustodyHealthReply', () => {
  const me = op(0x22)

  it('returns only the signed statement', () => {
    const r = verifyCustodyHealthReply(reply(me, 7), expected(me, 7))
    expect(r.operator).toBe(me)
    expect(r.statement).toMatchObject({reshare: 'current', committeeVersion: 2, shareMatchesChainKey: true})
    expect(Object.keys(r)).toEqual(['operator', 'statement'])
  })

  it('accepts a registered key given as hex, and a statement with a last failure', () => {
    const lf = {committee_version: 3, blamed_operator_id: 4, reason: 'seal'}
    const r = verifyCustodyHealthReply(reply(me, 7, {reshare: 'pending', last_failure: lf}), {...expected(me, 7), registeredPublicKey: bytesToHex(pub(7))})
    expect(r.statement.lastFailure).toEqual({committeeVersion: 3, blamedOperatorId: 4, reason: 'seal'})
  })

  it('refuses an unsigned reply', () => {
    const {attestation: _a, ...unsigned} = reply(me, 7)
    refused(() => verifyCustodyHealthReply(unsigned, expected(me, 7)), 'unsigned')
    refused(() => verifyCustodyHealthReply({...unsigned, attestation: null}, expected(me, 7)), 'unsigned')
  })

  it('refuses a reply signed by a key other than the registered one, even when it names that key', () => {
    refused(() => verifyCustodyHealthReply(reply(me, 8), expected(me, 7)), 'mismatch')
    const forged = reply(me, 8)
    forged.attestation.pubkey = bytesToHex(pub(7))
    refused(() => verifyCustodyHealthReply(forged, expected(me, 7)), 'bad-signature')
  })

  it('refuses a tampered statement', () => {
    const r = reply(me, 7)
    r.attestation.statement.reshare = 'pending'
    refused(() => verifyCustodyHealthReply({...r, reshare: 'pending'}, expected(me, 7)), 'bad-signature')
  })

  it.each([
    ['another chain', {chain_id: 1}],
    ['another slot', {slot: `0x${'12'.repeat(32)}`}],
    ['another operator', {operator: op(0x23).toLowerCase()}],
  ])('refuses a statement about %s', (_n, over) => {
    refused(() => verifyCustodyHealthReply(reply(me, 7, over), expected(me, 7)), 'mismatch')
  })

  it('refuses a stale or future statement, inside the age only', () => {
    refused(() => verifyCustodyHealthReply(reply(me, 7, {observed_at: NOW - 901}), expected(me, 7)), 'stale')
    refused(() => verifyCustodyHealthReply(reply(me, 7, {observed_at: NOW + 901}), expected(me, 7)), 'stale')
    expect(verifyCustodyHealthReply(reply(me, 7, {observed_at: NOW - 900}), expected(me, 7)).operator).toBe(me)
    refused(() => verifyCustodyHealthReply(reply(me, 7, {observed_at: NOW - 60}), {...expected(me, 7), maxAgeSecs: 30}), 'stale')
    const e = refused(() => verifyCustodyHealthReply(reply(me, 7, {observed_at: 1}), {...expected(me, 7), nowSecs: undefined}), 'stale')
    expect(e.retryable).toBe(true)
  })

  it.each([
    ['reshare', {reshare: 'pending'}],
    ['slot', {slot: `0x${'12'.repeat(32)}`}],
    ['observed_at', {observed_at: NOW - 1}],
    ['chain.epoch', {chain: {epoch: 9}}],
    ['chain.committee_version', {chain: {committee_version: 9}}],
    ['chain.public_key', {chain: {public_key: '0x03'}}],
    ['last_failure', {last_failure: {committee_version: 1, blamed_operator_id: null, reason: 'x'}}],
  ])('refuses an unsigned %s that contradicts the statement', (field, body) => {
    const e = refused(() => verifyCustodyHealthReply(reply(me, 7, {}, body), expected(me, 7)), 'mismatch')
    expect(e.message).toContain(field)
  })

  it('refuses a body failure that disagrees in any part', () => {
    const lf = {committee_version: 3, blamed_operator_id: 4, reason: 'seal'}
    for (const body of [{last_failure: null}, {last_failure: {...lf, reason: 'other'}}, {last_failure: {...lf, blamed_operator_id: null}}]) {
      refused(() => verifyCustodyHealthReply(reply(me, 7, {last_failure: lf}, body), expected(me, 7)), 'mismatch')
    }
    expect(verifyCustodyHealthReply(reply(me, 7, {}, {chain: undefined, slot: undefined}), expected(me, 7)).operator).toBe(me)
  })

  it('refuses malformed attestations and names the operator', () => {
    const r = reply(me, 7)
    for (const att of [{...r.attestation, signature: '0x12'}, {...r.attestation, pubkey: 'zz'}, {...r.attestation, extra: 1}, 'x',
      {...r.attestation, statement: {...r.attestation.statement, extra: true}}]) {
      const e = refused(() => verifyCustodyHealthReply({...r, attestation: att}, expected(me, 7)), 'malformed')
      expect(e.operator).toBe(me)
    }
    refused(() => verifyCustodyHealthReply('nope', expected(me, 7)), 'malformed')
  })

  it('refuses a bad expectation as a caller error', () => {
    expect(() => verifyCustodyHealthReply(reply(me, 7), {...expected(me, 7), operator: 'x' as Address})).toThrow(/not an address/)
    expect(() => verifyCustodyHealthReply(reply(me, 7), {...expected(me, 7), registeredPublicKey: new Uint8Array(31)})).toThrow(/32 bytes/)
  })
})

describe('custodyStatementIsCurrent and assessCustodyHealth', () => {
  it('requires current, the chain key and the chain committee version', () => {
    const s = parseCustodyStatement(wire(op(1)))
    const chain = {committeeVersion: 2, publicKey: KEY.toUpperCase().replace('0X', '0x') as Hex}
    expect(custodyStatementIsCurrent(s, chain)).toBe(true)
    expect(custodyStatementIsCurrent({...s, reshare: 'pending'}, chain)).toBe(false)
    expect(custodyStatementIsCurrent({...s, shareMatchesChainKey: null}, chain)).toBe(false)
    expect(custodyStatementIsCurrent({...s, shareCommitteeVersion: 1}, chain)).toBe(false)
    expect(custodyStatementIsCurrent(s, {...chain, committeeVersion: 3})).toBe(false)
    expect(custodyStatementIsCurrent(s, {...chain, publicKey: '0x03'})).toBe(false)
  })

  it('classifies like the keepers monitor, with a margin of one', () => {
    expect(assessCustodyHealth(1, 2, 3)).toBe('frozen')
    expect(assessCustodyHealth(3, 3, 3)).toBe('ok')
    expect(assessCustodyHealth(3, 2, 5)).toBe('at_risk')
    expect(assessCustodyHealth(4, 2, 5)).toBe('ok')
  })
})

describe('readCustodyHealth', () => {
  const ops = [op(0x21), op(0x22), op(0x23), op(0x24)]
  const keyOf = new Map(ops.map((o, i) => [o, i + 10]))
  interface Setup {mode?: number; lastRotatedAt?: bigint | 'missing' | 'down'; exists?: boolean; inactive?: Address[]; untagged?: Address[]; badKey?: Address[]; url?: string}
  function chainClient(s: Setup = {}) {
    const read = vi.fn(async ({functionName, args}: {functionName: string; args: readonly unknown[]}) => {
      switch (functionName) {
        case 'getKeySlot':
          return {exists: s.exists ?? true, mode: s.mode ?? 2, threshold: {k: 2, n: 4}, publicKey: KEY, epoch: 0n, committeeVersion: 2n, cancelled: false}
        case 'lastRotatedAt':
          if (s.lastRotatedAt === 'down') throw new Error('rpc down')
          if (s.lastRotatedAt === 'missing') throw Object.assign(new Error('zero data'), {name: 'ContractFunctionZeroDataError', shortMessage: 'x'})
          return s.lastRotatedAt ?? 0n
        case 'assignedNodes':
          return ops.map(o => o.toLowerCase())
        case 'nodeOf': {
          const o = getAddress(args[0] as Address)
          return {url: s.url ?? `https://k${keyOf.get(o)}.test/`, pubkey: s.badKey?.includes(o) ? '0x12' : bytesToHex(pub(keyOf.get(o)!)), active: !s.inactive?.includes(o)}
        }
        case 'hasTag':
          return !s.untagged?.includes(getAddress(args[0] as Address))
        default:
          throw new Error(`unexpected ${functionName}`)
      }
    })
    return {client: {readContract: read, getChainId: async () => CHAIN}, addresses: {KeyRegistry: op(0x91), NodeRegistry: op(0x92)}} as unknown as TasraChainClient
  }
  const respond = (body: unknown, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {status})

  it('counts verified current members and derives the committee from the chain', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const n = Number(/k(\d+)\.test/.exec(url)![1]), o = ops[n - 10]!
      expect(url).toBe(`https://k${n}.test/v1/keys/${SLOT}/custody-health`)
      if (n === 10) return respond(reply(o, n))
      if (n === 11) return respond(reply(o, n, {reshare: 'pending', share_committee_version: 1}, {committee: {members: 99, live_members: 99, margin: 99, not_live: []}}))
      if (n === 12) return respond(reply(o, n + 5)) // signed by another key
      return respond('oops', 500)
    })
    const r = await readCustodyHealth(chainClient({untagged: [ops[3]!]}), SLOT, {fetchImpl: fetchImpl as unknown as typeof fetch, nowSecs: NOW})
    expect(r.chainId).toBe(CHAIN)
    expect(r.chain).toMatchObject({mode: 2, k: 2, n: 4, committeeVersion: 2, rotationLocked: true, publicKey: KEY})
    expect(r.committee).toEqual({members: 4, liveMembers: 3, margin: 1, notLive: [ops[3]]})
    expect(r.health).toBe('at_risk')
    expect(r.current).toEqual([ops[0]])
    expect(r.proven).toBe(false)
    expect(r.pending).toEqual([ops[1]])
    expect(r.reports.map(x => x.operator)).toEqual([ops[0], ops[1]])
    expect(r.refused.map(x => [x.operator, x.error.code])).toEqual([[ops[2], 'mismatch'], [ops[3], 'unreachable']])
    expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1]).toMatchObject({redirect: 'error', credentials: 'omit'})
  })

  it('proves the generation at k current members and maps routes', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const n = Number(/k(\d+)\.mapped/.exec(url)![1])
      return respond(reply(ops[n - 10]!, n))
    })
    const r = await readCustodyHealth(chainClient({mode: 0, lastRotatedAt: ROTATION_LOCK_SENTINEL}), SLOT,
      {fetchImpl: fetchImpl as unknown as typeof fetch, nowSecs: NOW, chainId: CHAIN, route: u => u.replace('.test', '.mapped')})
    expect(r.current).toHaveLength(4)
    expect(r.proven).toBe(true)
    expect(r.health).toBe('ok')
    expect(r.chain.rotationLocked).toBe(true)
  })

  it('reports an unknown lock on an older registry and an unlocked FROST slot', async () => {
    const fetchImpl = vi.fn(async () => respond({}))
    const old = await readCustodyHealth(chainClient({mode: 0, lastRotatedAt: 'missing'}), SLOT, {fetchImpl: fetchImpl as unknown as typeof fetch, nowSecs: NOW})
    expect(old.chain.rotationLocked).toBeNull()
    expect(old.refused.every(x => x.error.code === 'unsigned')).toBe(true)
    const frost = await readCustodyHealth(chainClient({mode: 0}), SLOT, {fetchImpl: fetchImpl as unknown as typeof fetch, nowSecs: NOW})
    expect(frost.chain.rotationLocked).toBe(false)
  })

  it('never fetches an inactive or keyless operator', async () => {
    const fetchImpl = vi.fn(async () => respond({}))
    const r = await readCustodyHealth(chainClient({inactive: [ops[0]!], badKey: [ops[1]!]}), SLOT, {fetchImpl: fetchImpl as unknown as typeof fetch, nowSecs: NOW})
    expect(r.refused.slice(0, 2).map(x => x.error.code)).toEqual(['not-registered', 'not-registered'])
    expect(r.committee.notLive).toEqual([ops[0]])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('applies the transport policy and the reply bound', async () => {
    const big = new Response('x'.repeat(70 * 1024), {status: 200})
    const sized = new Response('{}', {status: 200, headers: {'content-length': String(1 << 20)}})
    const replies = [big, sized, respond('not json'), new Response(null, {status: 200})]
    const fetchImpl = vi.fn(async () => replies.shift()!)
    const r = await readCustodyHealth(chainClient(), SLOT, {fetchImpl: fetchImpl as unknown as typeof fetch, nowSecs: NOW})
    expect(r.refused.map(x => x.error.code)).toEqual(['unreachable', 'unreachable', 'unreachable', 'unreachable'])
    expect(r.refused[0]!.error.message).toMatch(/exceeds/)
    expect(r.refused[1]!.error.retryable).toBe(true)
  })

  it('refuses plain HTTP unless allowed on the local chain', async () => {
    const c = chainClient({url: 'http://127.0.0.1:4001'})
    const fetchImpl = vi.fn(async () => respond(reply(ops[0]!, 10)))
    const denied = await readCustodyHealth(c, SLOT, {fetchImpl: fetchImpl as unknown as typeof fetch, nowSecs: NOW})
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(denied.refused[0]!.error.message).toMatch(/transport policy/)
    const allowed = await readCustodyHealth(c, SLOT, {fetchImpl: fetchImpl as unknown as typeof fetch, nowSecs: NOW, allowLocalHttp: true})
    expect(fetchImpl).toHaveBeenCalled()
    expect(allowed.reports.map(x => x.operator)).toEqual([ops[0]])
    const elsewhere = await readCustodyHealth(c, SLOT, {fetchImpl: fetchImpl as unknown as typeof fetch, nowSecs: NOW, allowLocalHttp: true, chainId: 1})
    expect(elsewhere.reports).toEqual([])
  })

  it('refuses a missing slot and passes an RPC failure through', async () => {
    await expect(readCustodyHealth(chainClient({exists: false}), SLOT)).rejects.toMatchObject({code: 'no-slot'})
    await expect(readCustodyHealth(chainClient({lastRotatedAt: 'down'}), SLOT)).rejects.toThrow('rpc down')
  })

  it('stops when the caller cancels', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn(async () => { controller.abort(new Error('stop')); throw new Error('aborted') })
    await expect(readCustodyHealth(chainClient(), SLOT, {fetchImpl: fetchImpl as unknown as typeof fetch, signal: controller.signal})).rejects.toThrow('stop')
  })
})
