import {describe, expect, it, vi} from 'vitest'
import {bls12_381} from '@noble/curves/bls12-381'
import {createTasraClient} from '../../src/client/client.js'
import {newSession} from '../../src/client/session.js'
import {fetchAndAssembleKey, fetchMpk} from '../../src/keys/node-client.js'
import {signCustody} from '../../src/signing/frost.js'
import {signEoaDigest} from '../../src/signing/ecdsa.js'

vi.mock('../../src/keys/node-client.js', () => ({fetchMpk: vi.fn(), fetchAndAssembleKey: vi.fn()}))
vi.mock('../../src/signing/frost.js', () => ({signCustody: vi.fn()}))
vi.mock('../../src/signing/ecdsa.js', () => ({signEoaDigest: vi.fn()}))

const slotId = `0x${'11'.repeat(32)}`
const mpkBytes = bls12_381.G2.ProjectivePoint.BASE.toRawBytes(true)
const jwt = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({exp: Math.floor(Date.now() / 1000) + 3600})).toString('base64url')}.signature`

function session(msk: Uint8Array | null = null) {
  return newSession({slotId, slotIdBytes: new Uint8Array(32).fill(1), nodes: ['https://keeper.example'],
    verifier: undefined, jwt, holder: 'did:example:holder', renewalToken: undefined, mpkBytes,
    msk, epoch: 1, identity: new Uint8Array(32).fill(1), skewMs: 30_000, onClose: vi.fn()})
}

describe('managed session lifecycle', () => {
  it('snapshots keeper endpoints before a caller can mutate them', async () => {
    vi.mocked(fetchMpk).mockResolvedValue({mpkBytes, epoch: 1})
    vi.mocked(signCustody).mockResolvedValue({} as Awaited<ReturnType<typeof signCustody>>)
    const nodes = ['https://keeper.example']
    const client = createTasraClient({nodes})
    nodes[0] = 'https://changed.example'
    expect(client.config.nodes[0]).toBe('https://keeper.example')
    expect(Object.isFrozen(client.config.nodes)).toBe(true)
    const opened = await client.openSession(slotId, {jwt})
    await opened.sign(new Uint8Array([1]))
    expect(vi.mocked(fetchMpk).mock.calls.at(-1)?.[0]).toBe('https://keeper.example')
    expect(vi.mocked(signCustody).mock.calls.at(-1)?.[0].nodeUrl).toBe('https://keeper.example')
    await opened.close()
  })

  it('does not start a signing request when close wins during freshness work', async () => {
    vi.mocked(signCustody).mockClear()
    vi.mocked(signEoaDigest).mockClear()
    for (const kind of ['frost', 'ecdsa'] as const) {
      const opened = session()
      let resume!: () => void
      opened.ensureFresh = () => new Promise<void>(resolve => {resume = resolve})
      const signing = kind === 'frost' ? opened.sign(new Uint8Array([1])) : opened.signDigest(new Uint8Array(32))
      await opened.close()
      resume()
      await expect(signing).rejects.toThrow('closed')
    }
    expect(signCustody).not.toHaveBeenCalled()
    expect(signEoaDigest).not.toHaveBeenCalled()
  })

  it('assembles once for overlapping decrypts and clears the shared key on close', async () => {
    vi.mocked(fetchAndAssembleKey).mockReset()
    const opened = session()
    const ciphertext = opened.encrypt(new Uint8Array([7]))
    let finish!: (key: Uint8Array) => void
    vi.mocked(fetchAndAssembleKey).mockReturnValue(new Promise(resolve => {finish = resolve}))
    const first = opened.decrypt(ciphertext).catch(() => undefined)
    const second = opened.decrypt(ciphertext).catch(() => undefined)
    await vi.waitFor(() => expect(fetchAndAssembleKey).toHaveBeenCalled())
    expect(fetchAndAssembleKey).toHaveBeenCalledTimes(1)
    const key = new Uint8Array(32).fill(3)
    finish(key)
    await Promise.all([first, second])
    await opened.close()
    expect(key.every(byte => byte === 0)).toBe(true)
  })

  it('makes close terminal and clears an assembly that completes afterward', async () => {
    vi.mocked(fetchAndAssembleKey).mockReset()
    const opened = session()
    const ciphertext = opened.encrypt(new Uint8Array([7]))
    let finish!: (key: Uint8Array) => void
    const pendingKey = new Promise<Uint8Array>(resolve => {finish = resolve})
    vi.mocked(fetchAndAssembleKey).mockReturnValue(pendingKey)
    const decrypting = opened.decrypt(ciphertext)
    await vi.waitFor(() => expect(fetchAndAssembleKey).toHaveBeenCalled())
    await opened.close()
    const key = new Uint8Array(32).fill(9)
    finish(key)
    await expect(decrypting).rejects.toThrow('closed')
    expect(key.every(byte => byte === 0)).toBe(true)
    expect(() => opened.encrypt(new Uint8Array([1]))).toThrow('closed')
    await expect(opened.sign(new Uint8Array([1]))).rejects.toThrow('closed')
    await expect(opened.ensureFresh()).rejects.toThrow('closed')
    expect(() => opened.jwt).toThrow('closed')
  })
})
