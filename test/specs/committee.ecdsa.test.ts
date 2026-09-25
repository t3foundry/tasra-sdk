import {afterEach, describe, expect, it, vi} from 'vitest'
import {committeeSignEoaDigest} from '../../src/committee/ecdsa.js'
import {isAuthDenied} from '../../src/errors.js'
import type {CompoundTokenWire} from '../../src/committee/token.js'

const token = {token_type: 'JWT', slot_id: '0x' + '11'.repeat(32)} as CompoundTokenWire
const valid = {mode: 'tecdsa', group_public_key: '02' + '22'.repeat(32),
  signature_r: '33'.repeat(32), signature_s: '44'.repeat(32), signature_v: 1}
const options = {nodeUrl: 'https://keeper.example/', committeeToken: token, digest: new Uint8Array(32)}
afterEach(() => vi.unstubAllGlobals())

describe('committeeSignEoaDigest', () => {
  it('preserves bound token/proofs, uses the ECDSA route, and sends no bearer token', async () => {
    const fetcher = vi.fn(() => Promise.resolve(Response.json(valid)))
    vi.stubGlobal('fetch', fetcher)
    const signal = new AbortController().signal
    const result = await committeeSignEoaDigest({...options, requestId: 'req-1', signal,
      targetKeykeeper: '0x' + 'aa'.repeat(20), userSignature: new Uint8Array(64),
      verifierProofs: [{verifierIndex: 3, operator: '0x12', pubkey: '0x34', proof: ['0x56']}]})
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://keeper.example/v1/committee/sign/eoa-digest')
    expect(request.headers).toEqual({'Content-Type': 'application/json', 'x-request-id': 'req-1'})
    expect(request.signal).toBe(signal)
    expect(JSON.parse(request.body as string)).toEqual({committee_token: token, digest: '00'.repeat(32),
      verifier_proofs: [{verifier_index: 3, operator: '12', pubkey: '34', proof: ['56']}],
      user_signature: '00'.repeat(64), target_keykeeper: 'aa'.repeat(20)})
    expect(result.r).toEqual(new Uint8Array(32).fill(0x33))
    expect(result.yParity).toBe(1)
  })
  it('omits optional fields and accepts parity zero', async () => {
    const fetcher = vi.fn(() => Promise.resolve(Response.json({...valid, signature_v: 0})))
    vi.stubGlobal('fetch', fetcher)
    expect((await committeeSignEoaDigest(options)).yParity).toBe(0)
    const [, request] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(request.body as string)).toEqual({committee_token: token, digest: '00'.repeat(32)})
  })
  it('rejects wrong digest and owner signature lengths before network I/O', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(committeeSignEoaDigest({...options, digest: new Uint8Array(31)})).rejects.toThrow('digest must be 32')
    await expect(committeeSignEoaDigest({...options, userSignature: new Uint8Array(63)})).rejects.toThrow('userSignature must be 64')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('propagates a keeper denial without falling back or retrying', async () => {
    const fetcher = vi.fn(() => Promise.resolve(new Response('credential denied', {status: 403})))
    vi.stubGlobal('fetch', fetcher)
    const error = await committeeSignEoaDigest(options).catch((e: unknown) => e)
    expect(isAuthDenied(error)).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each([
    null, {...valid, mode: 'tecdsa-p256'}, {...valid, signature_v: undefined},
    {...valid, signature_v: 27}, {...valid, signature_r: 'zz'.repeat(32)},
    {...valid, signature_s: '11'}, {...valid, group_public_key: 3},
    {...valid, group_public_key: '04' + '22'.repeat(32)},
  ])('rejects malformed or non-Ethereum signature replies (%#)', async reply => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json(reply))))
    await expect(committeeSignEoaDigest(options)).rejects.toThrow('invalid secp256k1')
  })
})
