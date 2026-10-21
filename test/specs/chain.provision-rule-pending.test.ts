// `provisionRule({expect: 'pending'})`: delivering a PROPOSED amendment to the keepers.
//
// The keeper texts below are copied from the keeper (`storage/repo/key_slot.rs`), wrapped in its
// `{"error": ...}` body, because the retry decision is made on them:
//   - 409 "already has a different DCQL rule provisioned"  - not yet ingested the proposal: RETRY
//   - 403 "may provision only the slot's pending amendment" - the admin's form of the same: RETRY
//   - 409 "pending rule amendment changed"                 - terminal: nothing was written
// Everything else fails at once, and the default `expect: 'active'` path never retries at all.
import {afterEach, describe, expect, it, vi} from 'vitest'
import {provisionRule} from '../../src/chain/provisionRule.js'
import {RuleAmendmentError} from '../../src/chain/ruleAmendment.js'
import {ruleCommitment} from '../../src/chain/write.js'

const SLOT = `0x${'11'.repeat(32)}` as const
const SALT = `0x${'22'.repeat(32)}` as const
const RULE = 'any'
const KEY_REGISTRY = `0x${'33'.repeat(20)}` as const
const ID = SLOT.slice(2)

const NOT_INGESTED_409 = `key_slot ${ID} already has a different DCQL rule provisioned`
const ADMIN_NOT_INGESTED_403 =
  `key_slot ${ID}: the rule admin may provision only the slot's pending amendment; this rule does not match a pending ` +
  'commitment this keeper has recorded (retry after RuleUpdateProposed is ingested)'
const PENDING_CHANGED_409 =
  `key_slot ${ID}: the pending rule amendment changed while this rule was being stored (superseded by a newer proposal ` +
  'or activated); nothing was written for pending version 2 - check `slot rule status` and re-deliver if this rule is still the pending proposal'

const err = (status: number, text: string) => new Response(JSON.stringify({error: text}), {status})
const okPending = (extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({key_slot_id: ID, provisioned: false, pending: true, pending_version: 2, ...extra}), {status: 200})

function fakeChain() {
  return {client: {chain: {id: 43112}}, addresses: {KeyRegistry: KEY_REGISTRY}} as never
}

function signer(calls: unknown[] = []) {
  return {
    address: '0x9999999999999999999999999999999999999999' as const,
    signTypedData: async (td: unknown) => {
      calls.push(td)
      return `0x${'ab'.repeat(65)}` as const
    },
  }
}

/** A fetch that answers each call from `script` in order (the last entry repeats). */
function scripted(script: Array<() => Response>) {
  let i = 0
  return vi.fn(async () => script[Math.min(i++, script.length - 1)]!()) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}

afterEach(() => {
  vi.useRealTimers()
})

describe('provisionRule expect: pending', () => {
  it('retries the not-ingested 409 every 3 s with ONE signature, then resolves pending', async () => {
    vi.useFakeTimers()
    const signed: unknown[] = []
    const fetchImpl = scripted([() => err(409, NOT_INGESTED_409), () => err(409, NOT_INGESTED_409), () => okPending()])
    const run = provisionRule(fakeChain(), {
      slotId: SLOT, rule: RULE, ruleSalt: SALT, signer: signer(signed), keeperUrls: ['http://k1'], fetchImpl, expect: 'pending',
    })
    await vi.advanceTimersByTimeAsync(2_999)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(3_000)
    const r = await run
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(signed).toHaveLength(1)
    expect(r.results[0]).toMatchObject({ok: true, pending: true, pendingVersion: 2})
    // The SAME body every time: the one signature serves every retry.
    const bodies = vi.mocked(fetchImpl).mock.calls.map(c => (c as unknown[])[1] as RequestInit).map(i => i.body)
    expect(new Set(bodies).size).toBe(1)
  })

  it("retries the rule admin's pre-ingestion 403", async () => {
    vi.useFakeTimers()
    const fetchImpl = scripted([() => err(403, ADMIN_NOT_INGESTED_403), () => okPending({authorized_by: 'rule_admin'})])
    const run = provisionRule(fakeChain(), {
      slotId: SLOT, rule: RULE, ruleSalt: SALT, signer: signer(), keeperUrls: ['http://k1'], fetchImpl, expect: 'pending',
    })
    await vi.advanceTimersByTimeAsync(3_000)
    const r = await run
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(r.results[0]!.authorizedBy).toBe('rule_admin')
  })

  it.each([
    ['a different 403', 403, 'creator authorization: not the slot creator; rule admin authorization: not the rule admin'],
    ['a 400 commitment mismatch', 400, "dcql_rule does not match the slot's on-chain commitment"],
  ])('does not retry %s', async (_label, status, text) => {
    const fetchImpl = scripted([() => err(status, text), () => okPending()])
    await expect(provisionRule(fakeChain(), {
      slotId: SLOT, rule: RULE, ruleSalt: SALT, signer: signer(), keeperUrls: ['http://k1'], fetchImpl, expect: 'pending',
    })).rejects.toThrow(/0 of 1/)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('an ok answer that took the rule as ACTIVE is not-pending, naming the keeper', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).startsWith('http://k2') ? new Response(JSON.stringify({provisioned: true, pending: false}), {status: 200}) : okPending(),
    ) as unknown as typeof fetch
    const e = await provisionRule(fakeChain(), {
      slotId: SLOT, rule: RULE, ruleSalt: SALT, signer: signer(), keeperUrls: ['http://k1', 'http://k2'], fetchImpl, expect: 'pending',
    }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(RuleAmendmentError)
    expect((e as RuleAmendmentError).code).toBe('not-pending')
    expect((e as RuleAmendmentError).message).toContain('http://k2')
    expect((e as RuleAmendmentError).message).not.toContain('http://k1')
    expect((e as RuleAmendmentError).results).toHaveLength(2)
  })

  it('the pending-changed 409 is terminal: not retried, thrown with the results', async () => {
    const fetchImpl = scripted([() => err(409, PENDING_CHANGED_409), () => okPending()])
    const e = await provisionRule(fakeChain(), {
      slotId: SLOT, rule: RULE, ruleSalt: SALT, signer: signer(), keeperUrls: ['http://k1'], fetchImpl, expect: 'pending',
    }).catch((x: unknown) => x)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect((e as RuleAmendmentError).code).toBe('pending-changed')
    expect((e as RuleAmendmentError).results?.[0]).toMatchObject({ok: false, status: 409})
  })

  it('classifies on the FULL body, even past the 300 characters kept in `error`', async () => {
    const long = `${'x'.repeat(400)} ${PENDING_CHANGED_409}`
    const fetchImpl = scripted([() => new Response(long, {status: 409})])
    const e = await provisionRule(fakeChain(), {
      slotId: SLOT, rule: RULE, ruleSalt: SALT, signer: signer(), keeperUrls: ['http://k1'], fetchImpl, expect: 'pending',
    }).catch((x: unknown) => x)
    expect((e as RuleAmendmentError).code).toBe('pending-changed')
    expect((e as RuleAmendmentError).results?.[0]!.error).toHaveLength(300)
  })

  it('a keeper still not ingested past retryConflictMs fails without claiming self-heal', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).startsWith('http://k2') ? err(409, NOT_INGESTED_409) : okPending(),
    ) as unknown as typeof fetch
    const run = provisionRule(fakeChain(), {
      slotId: SLOT, rule: RULE, ruleSalt: SALT, signer: signer(), keeperUrls: ['http://k1', 'http://k2'], fetchImpl,
      expect: 'pending', retryConflictMs: 6_000,
    }).catch((x: unknown) => x)
    await vi.advanceTimersByTimeAsync(9_000)
    const e = (await run) as Error & {results?: unknown[]}
    expect(e).toBeInstanceOf(Error)
    expect(e.message).toMatch(/1 of 2/)
    expect(e.message).not.toMatch(/self-heal/)
    expect(e.message).toMatch(/not peer-healed/)
    expect(e.results).toHaveLength(2)
    // 0 s, 3 s, 6 s: the deadline is checked before each wait.
    expect(vi.mocked(fetchImpl).mock.calls.filter(c => String(c[0]).startsWith('http://k2'))).toHaveLength(3)
  })

  it('refuses a retryConflictMs that outlives the signature, before signing', async () => {
    const signed: unknown[] = []
    await expect(provisionRule(fakeChain(), {
      slotId: SLOT, rule: RULE, ruleSalt: SALT, signer: signer(signed), keeperUrls: ['http://k1'], fetchImpl: scripted([okPending]),
      expect: 'pending', ttlSecs: 60, retryConflictMs: 60_001,
    })).rejects.toThrow(/outlives the authorization/)
    expect(signed).toHaveLength(0)
  })

  it.each([-1, 1.5, Number.NaN])('refuses retryConflictMs %s before signing', async bad => {
    const signed: unknown[] = []
    await expect(provisionRule(fakeChain(), {
      slotId: SLOT, rule: RULE, ruleSalt: SALT, signer: signer(signed), keeperUrls: ['http://k1'], fetchImpl: scripted([okPending]),
      expect: 'pending', retryConflictMs: bad,
    })).rejects.toThrow(/retryConflictMs/)
    expect(signed).toHaveLength(0)
  })
})

describe('provisionRule expect: active (default) is unchanged', () => {
  it.each([
    ['the not-ingested 409', 409, NOT_INGESTED_409],
    ["the rule admin's 403", 403, ADMIN_NOT_INGESTED_403],
  ])('does not retry %s, and keeps the existing messages', async (_label, status, text) => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).startsWith('http://k2') ? err(status, text) : new Response('{}', {status: 200}),
    ) as unknown as typeof fetch
    await expect(provisionRule(fakeChain(), {
      slotId: SLOT, rule: RULE, ruleSalt: SALT, signer: signer(), keeperUrls: ['http://k1', 'http://k2'], fetchImpl,
    })).rejects.toThrow(/should self-heal from a peer/)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('an ok non-pending answer is fine on the active path', async () => {
    const fetchImpl = scripted([() => new Response(JSON.stringify({provisioned: true, pending: false, authorized_by: 'creator'}), {status: 200})])
    const r = await provisionRule(fakeChain(), {slotId: SLOT, rule: RULE, ruleSalt: SALT, signer: signer(), keeperUrls: ['http://k1'], fetchImpl})
    expect(r.results[0]).toMatchObject({ok: true, provisioned: true, pending: false, authorizedBy: 'creator'})
    expect(r.ruleCommitment).toBe(ruleCommitment(SALT, RULE))
  })

  it('ignores an unknown authorized_by value', async () => {
    const fetchImpl = scripted([() => new Response(JSON.stringify({provisioned: true, authorized_by: 'operator'}), {status: 200})])
    const r = await provisionRule(fakeChain(), {slotId: SLOT, rule: RULE, ruleSalt: SALT, signer: signer(), keeperUrls: ['http://k1'], fetchImpl})
    expect(r.results[0]).not.toHaveProperty('authorizedBy')
  })
})

describe('delegation wire mapping', () => {
  const bodyOf = (fetchImpl: ReturnType<typeof vi.fn>) =>
    JSON.parse(String(((fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit).body)) as {authorization: Record<string, unknown>}

  it('sends the delegation with delegation_sig = signature and no `signature` key', async () => {
    const fetchImpl = scripted([() => new Response('{}', {status: 200})])
    const delegation = {chain_id: 43112, slot_ids: [SLOT], delegate: '0x9999999999999999999999999999999999999999', actions: ['provision-rule'], exp: 2_000_000_000, nonce: 7, signature: `0x${'cd'.repeat(65)}`}
    await provisionRule(fakeChain(), {slotId: SLOT, rule: RULE, ruleSalt: SALT, signer: signer(), keeperUrls: ['http://k1'], fetchImpl, delegation})
    const d = bodyOf(fetchImpl).authorization.delegation as Record<string, unknown>
    expect(d).toEqual({
      chain_id: 43112, slot_ids: [SLOT], delegate: delegation.delegate, actions: ['provision-rule'], exp: 2_000_000_000, nonce: 7,
      delegation_sig: delegation.signature,
    })
    expect(d).not.toHaveProperty('signature')
  })

  it('omits the delegation key entirely without one', async () => {
    const fetchImpl = scripted([() => new Response('{}', {status: 200})])
    await provisionRule(fakeChain(), {slotId: SLOT, rule: RULE, ruleSalt: SALT, signer: signer(), keeperUrls: ['http://k1'], fetchImpl})
    expect(Object.keys(bodyOf(fetchImpl).authorization)).not.toContain('delegation')
  })
})

describe('provisionRule expect: pending - retry decision on the FULL body, per keeper, abortable', () => {
  // The decision is made before the text is cut to 300 characters for `error`: a keeper that
  // wraps its refusal in a long preamble must still be recognised.
  it.each([
    ['the not-ingested 409', 409, NOT_INGESTED_409],
    ["the rule admin's pre-ingestion 403", 403, ADMIN_NOT_INGESTED_403],
  ])('retries %s even when the marker sits past character 300', async (_label, status, text) => {
    vi.useFakeTimers()
    const long = `${'x'.repeat(400)} ${text}`
    const fetchImpl = scripted([() => new Response(long, {status}), () => okPending()])
    const run = provisionRule(fakeChain(), {
      slotId: SLOT, rule: RULE, ruleSalt: SALT, signer: signer(), keeperUrls: ['http://k1'], fetchImpl, expect: 'pending',
    })
    await vi.advanceTimersByTimeAsync(3_000)
    const r = await run
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(r.results[0]).toMatchObject({ok: true, pending: true})
  })

  it('retries only the keeper that has not ingested; a keeper that already answered is not asked again', async () => {
    vi.useFakeTimers()
    let k1 = 0
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).startsWith('http://k1') ? (k1++ === 0 ? err(409, NOT_INGESTED_409) : okPending()) : okPending(),
    ) as unknown as typeof fetch
    const run = provisionRule(fakeChain(), {
      slotId: SLOT, rule: RULE, ruleSalt: SALT, signer: signer(), keeperUrls: ['http://k1', 'http://k2'], fetchImpl, expect: 'pending',
    })
    await vi.advanceTimersByTimeAsync(3_000)
    await run
    const urls = vi.mocked(fetchImpl).mock.calls.map(c => String(c[0]))
    expect(urls.filter(u => u.startsWith('http://k1'))).toHaveLength(2)
    expect(urls.filter(u => u.startsWith('http://k2'))).toHaveLength(1)
  })

  it('an already-aborted signal stops before anything is signed or fetched', async () => {
    const signed: unknown[] = []
    const fetchImpl = scripted([okPending])
    await expect(provisionRule(fakeChain(), {
      slotId: SLOT, rule: RULE, ruleSalt: SALT, signer: signer(signed), keeperUrls: ['http://k1'], fetchImpl, expect: 'pending',
      signal: AbortSignal.abort(new Error('stop now')),
    })).rejects.toThrow('stop now')
    expect(signed).toHaveLength(0)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('an abort during the retry wait rejects with the abort reason and no further request goes out', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const fetchImpl = scripted([() => err(409, NOT_INGESTED_409)])
    const run = provisionRule(fakeChain(), {
      slotId: SLOT, rule: RULE, ruleSalt: SALT, signer: signer(), keeperUrls: ['http://k1'], fetchImpl, expect: 'pending', signal: controller.signal,
    }).catch((x: unknown) => x)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    controller.abort(new Error('stop now'))
    const e = await run
    expect(e).toBeInstanceOf(Error)
    expect((e as Error).message).toBe('stop now')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('provisionRule input and transport edges', () => {
  it('refuses an unknown expect value before signing', async () => {
    const signed: unknown[] = []
    await expect(provisionRule(fakeChain(), {
      slotId: SLOT, rule: RULE, ruleSalt: SALT, signer: signer(signed), keeperUrls: ['http://k1'], fetchImpl: scripted([okPending]), expect: 'both' as never,
    })).rejects.toThrow(/expect must be 'active' or 'pending'/)
    expect(signed).toHaveLength(0)
  })

  it('a transport failure is not a "not ingested" answer: one attempt, no retry', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('connect ECONNREFUSED') }) as unknown as typeof fetch
    await expect(provisionRule(fakeChain(), {
      slotId: SLOT, rule: RULE, ruleSalt: SALT, signer: signer(), keeperUrls: ['http://k1'], fetchImpl, expect: 'pending',
    })).rejects.toThrow(/0 of 1/)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
