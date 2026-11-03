import {readFileSync} from 'node:fs'
import {afterEach,describe, expect, it, vi} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import {sha256} from '@noble/hashes/sha256'
import {bytesToHex} from '@noble/hashes/utils'
import {auditOperationId, decodeOperationReceipt, protocolHex, verifyOperationReceipt} from '../../src/committee/receipts.js'
import {createDualSignClient, dualSignApprovalPayload, paidDualSignApprovalPayload, OperationOutcomeUnknownError} from '../../src/committee/dual-sign.js'
import {paymentIntentHash, prepaidRequestId, type PaymentIntentWire} from '../../src/committee/payment.js'
import {decryptIdentityStrict, extractIdentityStrict, type StrictExtractionOptions} from '../../src/committee/extraction.js'
import {compoundTokenHash, decodeCompoundToken, opAttestationHash, type CompoundTokenWire} from '../../src/committee/token.js'
import {collectIbeExtractionPartials, committeeSign, requestIbeExtractionPartials, type IbeExtractionPartial} from '../../src/committee/client.js'
import {requestHash} from '../../src/oid4vp/binding.js'
import {keeperExecutionFixture} from '../support/keeperExecution.js'
import type {LocalExecutionSigner} from '../../src/committee/execution.js'
import {createDecryptionRecipient, decryptionBinding} from '../../src/crypto/recipient.js'
import {sealIbeFixture} from '../support/sealedIbe.js'

// A deadline that one in-process keeper reply must BEAT. 30 ms failed under a loaded certification
// host (keykeeper-network run d704c33e, 2026-11-03: the reply landed after the deadline, got 0 not
// 1); the hanging keepers still never answer, so the margin changes what is waited for, not what is
// asserted.
const KEEPER_REPLY_MARGIN_MS = 1000
const executionSigners:LocalExecutionSigner[]=[]
afterEach(()=>executionSigners.splice(0).forEach(signer=>signer.dispose()))

const slotId = '0x' + '11'.repeat(32), message = new TextEncoder().encode('Approve invoice 42')
const seed = new Uint8Array(32).fill(9), key = ed25519.getPublicKey(seed)
const hex = (bytes: Uint8Array) => '0x' + bytesToHex(bytes)
const token: CompoundTokenWire = {token_type: 'JWT', slot_id: slotId, seed: '22'.repeat(32), epoch: 1,
  vp_hash: '33'.repeat(32), holder_hash: '44'.repeat(32), rule_hash: '55'.repeat(32), verifier_indexes: [0], iat: 1, exp: 9999999999, signatures: []}
const tokenHash = compoundTokenHash(decodeCompoundToken(token))
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status, headers: {'content-type': 'application/json'}})
function receiptWire(operation: 'sign' | 'ibe-extract', payload: Uint8Array) {
  const slot = protocolHex(slotId, 32, 'slot'), op = auditOperationId(slot, operation, tokenHash, sha256(payload))
  return {op_id: hex(op), token_hash: hex(tokenHash), op_attestation: hex(ed25519.sign(opAttestationHash(43112, op, slot, tokenHash), seed))}
}

describe('keeper operation receipts', () => {
  it('retains and verifies evidence against independent operation and keeper inputs', () => {
    const receipt = decodeOperationReceipt(receiptWire('sign', message))!
    const expected = {chainId: 43112, slotId: protocolHex(slotId, 32, 'slot'), opId: receipt.opId, tokenHash, keeperPublicKey: key}
    expect(verifyOperationReceipt(receipt, expected)).toBe(true)
    expect(verifyOperationReceipt(receipt, {...expected, chainId: 1})).toBe(false)
    expect(verifyOperationReceipt(receipt, {...expected, opId: new Uint8Array(32)})).toBe(false)
    expect(verifyOperationReceipt(receipt, {...expected, tokenHash: new Uint8Array(32)})).toBe(false)
    expect(verifyOperationReceipt(receipt, {...expected, keeperPublicKey: new Uint8Array(32)})).toBe(false)
    expect(verifyOperationReceipt(receipt, {...expected, keeperPublicKey: new Uint8Array(1)})).toBe(false)
    expect(verifyOperationReceipt(undefined, expected)).toBe(false)
    expect(verifyOperationReceipt({...receipt, attestation: new Uint8Array(64)}, expected)).toBe(false)
    expect(verifyOperationReceipt({...receipt, attestation: new Uint8Array(1)}, expected)).toBe(false)
  })
  it('refuses partial tuples and invalid hex while representing unsigned replies explicitly', () => {
    expect(decodeOperationReceipt({})).toBeUndefined()
    expect(decodeOperationReceipt({op_id: null, token_hash: null, op_attestation: null})).toBeUndefined()
    expect(() => decodeOperationReceipt({op_id: 'ff'.repeat(32)})).toThrow('token hash')
    expect(() => protocolHex('zz'.repeat(32), 32, 'digest')).toThrow('digest')
    expect(() => auditOperationId(new Uint8Array(1), 'sign', tokenHash, sha256(message))).toThrow('32-byte')
    expect(auditOperationId(protocolHex(slotId, 32, 'slot'), 'sign', tokenHash, sha256(message)))
      .not.toEqual(auditOperationId(protocolHex(slotId, 32, 'slot'), 'decrypt', tokenHash, sha256(message)))
  })
  it('preserves receipt fields through the public signing transport', async () => {
    const signature = ed25519.sign(message, seed)
    const result = await committeeSign({nodeUrl: 'https://keeper.example', committeeToken: token, message,
      fetchImpl: vi.fn(async () => json({key_slot_id: slotId, group_public_key: hex(key), signature_r: hex(signature.slice(0, 32)),
        signature_z: hex(signature.slice(32)), message_sha256: hex(sha256(message)), epoch: 1, ...receiptWire('sign', message)}))})
    expect(result.receipt).toEqual(decodeOperationReceipt(receiptWire('sign', message)))
  })
})

type Vectors = {identity: string; mpk: string; plaintext: string; threshold: {k: number};
  shares: {identifier: number; d_i: string}[]; verifying_shares: {identifier: number; g2: string; g1: string}[];
  ciphertext: {u: string; nonce: string; aead_ct: string}}
const vector = JSON.parse(readFileSync(new URL('../ibe-vectors.json', import.meta.url), 'utf8')) as Vectors
const recipient = await createDecryptionRecipient()
const binding = decryptionBinding(sha256(new TextEncoder().encode(vector.identity)), 1, recipient)
const ibeRequestHash = requestHash(43112, protocolHex(slotId, 32, 'slot'), 'ibe-extract', binding.payloadDigest)
const ibeToken = {...token, request_hash: hex(ibeRequestHash), binding: 'holder_key'}
const ibeTokenHash = compoundTokenHash(decodeCompoundToken(ibeToken))
const unhex = (value: string) => new Uint8Array(Buffer.from(value.replace(/^0x/, ''), 'hex'))
const b64 = (value: string) => Buffer.from(unhex(value)).toString('base64')
function extraction(overrides: Partial<StrictExtractionOptions> = {}, mutate?: (row: Record<string, unknown>, index: number) => void): StrictExtractionOptions {
  const keepers = vector.shares.map((share, index) => ({operator: '0x' + (index + 1).toString(16).padStart(40, '0'),
    nodeUrl: `https://keeper-${index}.example`, identifier: share.identifier, publicKey: key,
    verifyingShareG2: unhex(vector.verifying_shares[index]!.g2)}))
  return {chainId: 43112, slotId, threshold: vector.threshold.k, epoch: 1, groupPublicKey: unhex(vector.mpk), keepers,
    identity: vector.identity, committeeToken: ibeToken, recipient,
    verifyingShares: new Map(vector.verifying_shares.map(s => [s.identifier, new Uint8Array([...unhex(s.g2), ...unhex(s.g1)])])),
    shareTrust: 'pinned-shares', requireReceipts: true,
    fetchImpl: vi.fn(async url => {
      const index = keepers.findIndex(k => String(url).startsWith(k.nodeUrl))
      const share = vector.shares[index]!, verifying = vector.verifying_shares[index]!
      const op = auditOperationId(protocolHex(slotId, 32, 'slot'), 'ibe-extract', ibeTokenHash, binding.payloadDigest)
      const row: Record<string, unknown> = {key_slot_id: slotId, identifier: share.identifier, extraction_share: b64(share.d_i),
        verifying_share: Buffer.concat([unhex(verifying.g2), unhex(verifying.g1)]).toString('base64'), epoch: 1,
        op_id: hex(op), token_hash: hex(ibeTokenHash), op_attestation: hex(ed25519.sign(opAttestationHash(43112, op, protocolHex(slotId, 32, 'slot'), ibeTokenHash), seed))}
      mutate?.(row, index)
      return json(await sealIbeFixture(row, recipient, ibeRequestHash))
    }), ...overrides}
}

describe('strict identity extraction', () => {
  it('decrypts reference ciphertext and verifies every receipt without exporting partials', async () => {
    const result = await decryptIdentityStrict({...extraction(), ciphertext: {u: unhex(vector.ciphertext.u), nonce: unhex(vector.ciphertext.nonce), aeadCt: unhex(vector.ciphertext.aead_ct)}})
    expect(result.plaintext).toEqual(unhex(vector.plaintext))
    expect(result.evidence.every(e => e.receiptStatus === 'verified')).toBe(true)
    expect(result).not.toHaveProperty('key')
    expect(result.evidence[0]).not.toHaveProperty('value')
  })
  it.each(['threshold', 'epoch', 'group', 'trust', 'token-slot', 'duplicate-operator', 'duplicate-url', 'missing-pinned-share', 'missing-receipt-key', 'identifier'])('rejects invalid configuration: %s', async field => {
    const o = extraction(), ks = [...o.keepers]
    if (field === 'threshold') o.threshold = 0
    if (field === 'epoch') o.epoch = -1
    if (field === 'group') o.groupPublicKey = new Uint8Array(1)
    if (field === 'trust') o.shareTrust = 'unknown' as 'pinned-shares'
    if (field === 'token-slot') o.slotId = 'ff'.repeat(32)
    if (field === 'duplicate-operator') ks[1] = {...ks[1]!, operator: ks[0]!.operator}
    if (field === 'duplicate-url') ks[1] = {...ks[1]!, nodeUrl: ks[0]!.nodeUrl + '/'}
    if (field === 'missing-pinned-share') ks[0] = {...ks[0]!, verifyingShareG2: undefined}
    if (field === 'missing-receipt-key') ks[0] = {...ks[0]!, publicKey: undefined}
    if (field === 'identifier') ks[0] = {...ks[0]!, identifier: 0}
    o.keepers = ks
    await expect(extractIdentityStrict(o)).rejects.toThrow()
    expect(o.fetchImpl).not.toHaveBeenCalled()
  })
  it.each(['slot', 'epoch', 'identifier', 'share', 'verifying', 'receipt', 'missing-receipt'])('rejects inconsistent reply: %s', async field => {
    const opts = extraction({}, (row, index) => {
      if (index !== 0) return
      if (field === 'slot') row.key_slot_id = 'ff'.repeat(32)
      if (field === 'epoch') row.epoch = 2
      if (field === 'identifier') row.identifier = vector.shares[1]!.identifier
      if (field === 'share') row.extraction_share = 'AA=='
      if (field === 'verifying') row.verifying_share = Buffer.alloc(144).toString('base64')
      if (field === 'receipt') row.op_attestation = '00'.repeat(64)
      if (field === 'missing-receipt') { delete row.op_id; delete row.token_hash; delete row.op_attestation }
    })
    // One invalid member in a two-member draw cannot form the required quorum.
    opts.keepers = opts.keepers.slice(0, vector.threshold.k)
    await expect(extractIdentityStrict(opts)).rejects.toThrow()
  })
  it('requires the configured quorum even if some servers returned valid responses', async () => {
    const opts = extraction(), original = opts.fetchImpl!
    opts.fetchImpl = vi.fn(async (url, init) => String(url).includes('keeper-0.') ? original(url, init) : json({}, 503))
    await expect(extractIdentityStrict(opts)).rejects.toThrow(/threshold|Only|only/)
  })
  it('rejects an unanchored group even when individual shares are self-consistent', async () => {
    await expect(extractIdentityStrict(extraction({groupPublicKey: vector.verifying_shares[0] ? unhex(vector.verifying_shares[0].g2) : new Uint8Array(96)}))).rejects.toThrow()
  })
  it('reports the weaker explicit anchored-group trust and unsigned evidence honestly', async () => {
    const opts = extraction({shareTrust: 'anchored-group', requireReceipts: false}, row => {delete row.op_id; delete row.token_hash; delete row.op_attestation})
    opts.keepers = opts.keepers.map(({verifyingShareG2: _, publicKey: __, identifier: ___, ...k}) => k)
    const result = await extractIdentityStrict(opts)
    expect(result.shareTrust).toBe('anchored-group')
    expect(result.evidence.every(e => e.receiptStatus === 'absent')).toBe(true)
    result.key.fill(0)
  })
  it('does not mark receipts verified without an authenticated keeper key', async () => {
    const opts = extraction({requireReceipts: false})
    opts.keepers = opts.keepers.map(k => ({...k, publicKey: undefined}))
    const result = await extractIdentityStrict(opts)
    expect(result.evidence.every(e => e.receiptStatus === 'unverified')).toBe(true)
    result.key.fill(0)
  })

  it('finishes with two verified members while the third fetch ignores cancellation', async () => {
    // Freeze the deadline: this must complete from the verified quorum itself,
    // never by waiting for a timer to give up on the third keeper.
    vi.useFakeTimers()
    try {
    const opts = extraction(), original = opts.fetchImpl!
    let stalledSignal: AbortSignal | undefined
    opts.fetchImpl = vi.fn((url, init) => {
      if (String(url).includes('keeper-2.')) {
        stalledSignal = init?.signal ?? undefined
        return new Promise<Response>(() => {})
      }
      return original(url, init)
    })
    const result = await extractIdentityStrict({...opts, timeoutMs: 500})
    expect(result.evidence.map(e => e.identifier).sort()).toEqual(vector.shares.slice(0, 2).map(p => p.identifier).sort())
    expect(stalledSignal?.aborted).toBe(true)
    result.key.fill(0)
    } finally { vi.useRealTimers() }
  }, 2_000)

  it.each(['slot', 'receipt', 'pairing'])('skips an invalid %s reply without consuming quorum capacity', async field => {
    const opts = extraction({}, (row, index) => {
      if (index !== 0) return
      if (field === 'slot') row.key_slot_id = 'ff'.repeat(32)
      if (field === 'receipt') row.op_attestation = '00'.repeat(64)
      if (field === 'pairing') row.extraction_share = b64(vector.shares[1]!.d_i)
    })
    const result = await extractIdentityStrict(opts)
    expect(result.evidence.map(e => e.identifier).sort()).toEqual(vector.shares.slice(1).map(p => p.identifier).sort())
    result.key.fill(0)
  })

  it('counts a duplicated share identifier only once under anchored-group trust', async () => {
    const opts = extraction({shareTrust: 'anchored-group', requireReceipts: false}, (row, index) => {
      if (index !== 1) return
      row.identifier = vector.shares[0]!.identifier
      row.extraction_share = b64(vector.shares[0]!.d_i)
      row.verifying_share = Buffer.concat([unhex(vector.verifying_shares[0]!.g2), unhex(vector.verifying_shares[0]!.g1)]).toString('base64')
    })
    opts.keepers = opts.keepers.map(({identifier: _, verifyingShareG2: __, ...k}) => k)
    const result = await extractIdentityStrict(opts)
    expect(result.evidence.map(e => e.identifier).sort()).toEqual([vector.shares[0]!.identifier, vector.shares[2]!.identifier].sort())
    result.key.fill(0)
  })

  it('cancels stalled response bodies when another verified quorum completes', async () => {
    const opts = extraction(), original = opts.fetchImpl!
    const cancelled = vi.fn()
    opts.fetchImpl = vi.fn((url, init) => String(url).includes('keeper-2.')
      ? Promise.resolve(new Response(new ReadableStream<Uint8Array>({start(c) { c.enqueue(new TextEncoder().encode('{')) }, cancel: cancelled})))
      : original(url, init))
    const result = await extractIdentityStrict(opts)
    expect(result.evidence).toHaveLength(2)
    expect(cancelled).toHaveBeenCalledOnce()
    result.key.fill(0)
  })

  it.each(['declared', 'streamed'])('refuses %s oversized reply before it can count', async kind => {
    const opts = extraction(), original = opts.fetchImpl!
    opts.keepers = opts.keepers.slice(0, 2)
    opts.fetchImpl = vi.fn((url, init) => String(url).includes('keeper-0.')
      ? Promise.resolve(new Response('x'.repeat(16 * 1024 + 1), kind === 'declared' ? {headers: {'content-length': String(16 * 1024 + 1)}} : undefined))
      : original(url, init))
    await expect(extractIdentityStrict(opts)).rejects.toThrow(/16 KiB/)
  })
})

describe('extraction collection lifecycle', () => {
  const lowLevel = () => {
    const opts = extraction()
    return {...opts, nodeUrls: opts.keepers.map(k => k.nodeUrl), ciphertextEpoch: opts.epoch}
  }

  it('preserves collect-all input order while a quorum collects only distinct valid shares', async () => {
    const opts = lowLevel(), original = opts.fetchImpl!, {threshold: _, ...allOpts} = opts
    const all = await requestIbeExtractionPartials(allOpts)
    expect(all.map(p => p.identifier)).toEqual(vector.shares.map(p => p.identifier))
    all.forEach(p => p.value.fill(0))
    opts.fetchImpl = vi.fn((url, init) => String(url).includes('keeper-2.') ? new Promise<Response>(() => {}) : original(url, init))
    const quorum = await requestIbeExtractionPartials(opts)
    expect(quorum).toHaveLength(vector.threshold.k)
    quorum.forEach(p => p.value.fill(0))
  })

  it.each([0, -1, 1.5, 4])('refuses invalid threshold %s before any HTTP request', async threshold => {
    const opts = lowLevel()
    await expect(requestIbeExtractionPartials({...opts, threshold})).rejects.toThrow('threshold')
    expect(opts.fetchImpl).not.toHaveBeenCalled()
  })

  it.each([0, -1, 1.5, 2_147_483_648])('refuses invalid deadline %s before any HTTP request', async timeoutMs => {
    const opts = lowLevel()
    await expect(requestIbeExtractionPartials({...opts, timeoutMs})).rejects.toThrow('timeout')
    expect(opts.fetchImpl).not.toHaveBeenCalled()
  })

  it('refuses duplicate endpoints before any HTTP request', async () => {
    const opts = lowLevel()
    await expect(requestIbeExtractionPartials({...opts, nodeUrls: [opts.nodeUrls[0]!, opts.nodeUrls[0]! + '/']})).rejects.toThrow('Duplicate')
    expect(opts.fetchImpl).not.toHaveBeenCalled()
  })

  it('propagates an already cancelled caller without starting requests', async () => {
    const opts = lowLevel(), controller = new AbortController(), reason = new Error('caller cancelled')
    controller.abort(reason)
    await expect(extractIdentityStrict({...opts, signal: controller.signal})).rejects.toBe(reason)
    expect(opts.fetchImpl).not.toHaveBeenCalled()
  })

  it('propagates caller cancellation and clears already accepted partials', async () => {
    const opts = lowLevel(), original = opts.fetchImpl!, controller = new AbortController()
    const reason = new Error('caller cancelled'), accepted: IbeExtractionPartial[] = []
    let received!: () => void
    const ready = new Promise<void>(resolve => {received = resolve})
    opts.fetchImpl = vi.fn((url, init) => String(url).includes('keeper-0.') ? original(url, init) : new Promise<Response>(() => {}))
    const running = collectIbeExtractionPartials({...opts, signal: controller.signal}, p => { accepted.push(p); received() })
    const rejected = expect(running).rejects.toBe(reason)
    await ready
    controller.abort(reason)
    await rejected
    expect(accepted).toHaveLength(1)
    expect(accepted[0]!.value.every(b => b === 0)).toBe(true)
  })

  it('deadline clears accepted partials and refuses an incomplete quorum', async () => {
    const opts = lowLevel(), original = opts.fetchImpl!, accepted: IbeExtractionPartial[] = []
    opts.fetchImpl = vi.fn((url, init) => String(url).includes('keeper-0.') ? original(url, init) : new Promise<Response>(() => {}))
    await expect(collectIbeExtractionPartials({...opts, timeoutMs: KEEPER_REPLY_MARGIN_MS}, p => { accepted.push(p) })).rejects.toMatchObject({got: 1, need: 2})
    expect(accepted[0]!.value.every(b => b === 0)).toBe(true)
  })

  it('clears rejected partials while preserving the successful caller-owned quorum', async () => {
    const opts = lowLevel(), original = opts.fetchImpl!, rejected: IbeExtractionPartial[] = []
    let release!: () => void
    const gate = new Promise<void>(resolve => {release = resolve})
    opts.fetchImpl = vi.fn(async (url, init) => {
      if (!String(url).includes('keeper-0.')) await gate
      return original(url, init)
    })
    const accepted = await collectIbeExtractionPartials(opts, p => {
      if (p.nodeUrl === opts.nodeUrls[0]) { rejected.push(p); release(); throw new Error('independently refused') }
    })
    expect(rejected[0]!.value.every(b => b === 0)).toBe(true)
    expect(accepted).toHaveLength(2)
    expect(accepted.every(p => p.value.some(b => b !== 0))).toBe(true)
    accepted.forEach(p => p.value.fill(0))
  })

  it('ignores a late fetch result, cancels its body and preserves the returned quorum', async () => {
    const opts = lowLevel(), original = opts.fetchImpl!, checked: IbeExtractionPartial[] = []
    let release!: (response: Response) => void
    opts.fetchImpl = vi.fn((url, init) => String(url).includes('keeper-2.')
      ? new Promise<Response>(resolve => { release = resolve }) : original(url, init))
    const result = await collectIbeExtractionPartials(opts, p => { checked.push(p) })
    const copies = result.map(p => p.value.slice()), cancel = vi.fn()
    release(new Response(new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new TextEncoder().encode('{}')) }, cancel,
    })))
    // Let the ignored fetch's body reader run; no network timer or retry is needed.
    await new Promise<void>(resolve => {setTimeout(resolve, 0)})
    expect(cancel).toHaveBeenCalledOnce()
    expect(checked).toHaveLength(2)
    expect(result.map(p => p.value)).toEqual(copies)
    result.forEach(p => p.value.fill(0))
  })

  it('a collect-all deadline returns completed replies in input order', async () => {
    const opts = lowLevel(), original = opts.fetchImpl!, {threshold: _, ...allOpts} = opts
    allOpts.fetchImpl = vi.fn((url, init) => String(url).includes('keeper-0.') ? original(url, init) : new Promise<Response>(() => {}))
    const result = await requestIbeExtractionPartials({...allOpts, timeoutMs: KEEPER_REPLY_MARGIN_MS})
    expect(result.map(p => p.identifier)).toEqual([vector.shares[0]!.identifier])
    result.forEach(p => p.value.fill(0))
  })

  it('collect-all preserves input order when two replies finish before the first', async () => {
    const opts = lowLevel(), original = opts.fetchImpl!, {threshold: _, ...allOpts} = opts
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    allOpts.fetchImpl = vi.fn(async (url, init) => {
      if (String(url).includes('keeper-0.')) await gate
      return original(url, init)
    })
    const order: number[] = []
    const result = await collectIbeExtractionPartials(allOpts, p => {
      order.push(p.identifier)
      if (order.length === 2) release()
    })
    expect(order.slice(0, 2).sort()).toEqual(vector.shares.slice(1).map(p => p.identifier).sort())
    expect(order[2]).toBe(vector.shares[0]!.identifier)
    expect(result.map(p => p.identifier)).toEqual(vector.shares.map(p => p.identifier))
    result.forEach(p => p.value.fill(0))
  })

  it('a collect-all deadline refuses when no keeper finishes', async () => {
    const opts = lowLevel(), {threshold: _, ...allOpts} = opts
    const fetchImpl = vi.fn((_url: Parameters<typeof fetch>[0], _init?: RequestInit) => new Promise<Response>(() => {}))
    allOpts.fetchImpl = fetchImpl
    await expect(requestIbeExtractionPartials({...allOpts, timeoutMs: 20})).rejects.toThrow('deadline exceeded')
    expect(fetchImpl.mock.calls.every(([, init]) => init?.signal?.aborted)).toBe(true)
  })

  it('preserves a caller-supplied null cancellation reason', async () => {
    const opts = lowLevel(), controller = new AbortController()
    opts.fetchImpl = vi.fn(() => new Promise<Response>(() => {}))
    const rejected = expect(requestIbeExtractionPartials({...opts, signal: controller.signal})).rejects.toBe(null)
    controller.abort(null)
    await rejected
  })

  it.each(['identifier', 'encoding', 'epoch', 'slot', 'pairing'])('low-level quorum skips invalid %s replies', async field => {
    const opts = extraction({}, (row, index) => {
      if (index !== 0) return
      if (field === 'identifier') row.identifier = 0
      if (field === 'encoding') row.extraction_share = 'AA=='
      if (field === 'epoch') row.epoch = 2
      if (field === 'slot') row.key_slot_id = 'ff'.repeat(32)
      if (field === 'pairing') row.extraction_share = b64(vector.shares[1]!.d_i)
    })
    const result = await requestIbeExtractionPartials({...opts, nodeUrls: opts.keepers.map(k => k.nodeUrl), ciphertextEpoch: 1})
    expect(result.map(p => p.identifier).sort()).toEqual(vector.shares.slice(1).map(p => p.identifier).sort())
    result.forEach(p => p.value.fill(0))
  })
})

function dualFixture(credentialGated = false) {
  let have = 0
  const signature = ed25519.sign(message, seed)
  const reply = {key_slot_id: slotId, message_sha256: hex(sha256(message)), group_public_key: hex(key), epoch: 1,
    signature_r: hex(signature.slice(0, 32)), signature_z: hex(signature.slice(32))}
  const pending = () => ({status: 'pending', key_slot_id: slotId, message_sha256: hex(sha256(message)), have, need: 2})
  const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const path = String(url)
    if (path.endsWith('/approve')) {
      const body = JSON.parse(String(init?.body)) as {approver_pubkey: string; signature: string}
      expect(ed25519.verify(protocolHex(body.signature, 64, 'sig'), dualSignApprovalPayload(slotId, message, 'request-1'), protocolHex(body.approver_pubkey, 32, 'pk'))).toBe(true)
      have++
      return json({have, need: 2, signed: have === 2, ...(have === 2 ? {reply} : {})})
    }
    if (init?.method === 'POST') return json({...pending(), request_id: 'request-1', credential_gated: credentialGated}, 201)
    return json(have === 2 ? {status: 'signed', reply} : pending())
  })
  const config = {chainId: 43112, nodeUrl: 'https://keeper.example', slotId, groupPublicKey: key, quorum: 2, credentialGated, fetchImpl}
  const signer = {publicKey: key, sign: async (payload: Uint8Array) => ed25519.sign(payload, seed)}
  return {config, fetchImpl, signer, reply, pending}
}

describe('native dual-sign lifecycle', () => {
  it('creates, approves and verifies a native final signature', async () => {
    const {config, signer} = dualFixture()
    const client = createDualSignClient(config), request = await client.create(message)
    expect((await request.approve({signer})).status).toBe('pending')
    const secondSeed = new Uint8Array(32).fill(10)
    expect((await request.approve({signer: {publicKey: ed25519.getPublicKey(secondSeed), sign: async payload => ed25519.sign(payload, secondSeed)}})).status).toBe('signed')
    expect((await request.wait()).groupPublicKey).toEqual(key)
    expect((await client.resume(request.requestId, message).status()).status).toBe('signed')
    expect((await request.approve({signer})).status).toBe('signed')
  })
  it('canonical approvals change with slot, message and request ID', () => {
    const a = dualSignApprovalPayload(slotId, message, 'a')
    expect(new TextDecoder().decode(a.slice(0, 21))).toBe('keykeeper:dual-sig:v1')
    expect(a).not.toEqual(dualSignApprovalPayload('22'.repeat(32), message, 'a'))
    expect(a).not.toEqual(dualSignApprovalPayload(slotId, new Uint8Array([1]), 'a'))
    expect(a).not.toEqual(dualSignApprovalPayload(slotId, message, 'b'))
    expect(() => dualSignApprovalPayload(slotId, message, '../bad')).toThrow('request ID')
  })
  it('requires explicit per-approval committee authorization for credential-gated slots', async () => {
    const {config, signer, fetchImpl} = dualFixture(true)
    const request = await createDualSignClient(config).create(message)
    await expect(request.approve({signer})).rejects.toThrow('authorization')
    await expect(request.approve({signer, authorization: {token, verifierProofs: []}})).rejects.toThrow('proofs')
    const approvalToken = {...token, binding: 'holder_key' as const, request_hash: hex(requestHash(43112, protocolHex(slotId, 32, 'slot'), 'dual-approve', sha256(dualSignApprovalPayload(slotId, message, request.requestId))))}
    await request.approve({signer, authorization: {token: approvalToken, verifierProofs: [{verifierIndex: 0, operator: '0x' + '11'.repeat(20), pubkey: hex(key), proof: ['0x' + '22'.repeat(32)]}]}})
    const body = JSON.parse(String(fetchImpl.mock.calls.at(-1)?.[1]?.body)) as Record<string, unknown>
    expect(body.committee_token).toEqual(approvalToken)
    expect(body).not.toHaveProperty('bearer')
  })
  it('refuses a modified message or quorum before asking the approver to sign', async () => {
    const {config, signer, pending} = dualFixture()
    const sign = vi.fn(signer.sign)
    const request = createDualSignClient({...config, fetchImpl: vi.fn(async () => json({...pending(), message_sha256: '00'.repeat(32)}))}).resume('request-1', message)
    await expect(request.approve({signer: {...signer, sign}})).rejects.toThrow('message')
    expect(sign).not.toHaveBeenCalled()
    await expect(createDualSignClient({...config, quorum: 3}).resume('request-1', message).status()).rejects.toThrow('quorum')
  })
  it('refuses invalid local signatures and wrong group final signatures', async () => {
    const {config, signer, reply} = dualFixture()
    const request = await createDualSignClient(config).create(message)
    await expect(request.approve({signer: {...signer, sign: async () => new Uint8Array(64)}})).rejects.toThrow('local approval')
    const forged = createDualSignClient({...config, fetchImpl: vi.fn(async () => json({status: 'signed', reply: {...reply, group_public_key: '00'.repeat(32)}}))}).resume('request-1', message)
    await expect(forged.status()).rejects.toThrow('result')
  })
  it.each([503, 'network', 'json', 'binding'])('reports uncertain create outcomes without retry: %s', async failure => {
    const {config, pending} = dualFixture()
    const transport = vi.fn(async () => {
      if (failure === 'network') throw new Error('connection lost')
      if (failure === 'json') return new Response('invalid JSON', {status: 201})
      if (failure === 'binding') return json({...pending(), key_slot_id: 'ff'.repeat(32), request_id: 'request-1'})
      return json({}, Number(failure))
    })
    await expect(createDualSignClient({...config, fetchImpl: transport}).create(message)).rejects.toBeInstanceOf(OperationOutcomeUnknownError)
    expect(transport).toHaveBeenCalledTimes(1)
  })
  it('reports definite refusal and preserves cancellation before submission', async () => {
    const {config} = dualFixture()
    await expect(createDualSignClient({...config, fetchImpl: vi.fn(async () => json({}, 403))}).create(message)).rejects.toMatchObject({status: 403})
    const abort = AbortSignal.abort(new Error('cancelled'))
    await expect(createDualSignClient(config).create(message, {signal: abort})).rejects.toThrow('cancelled')
    expect(config.fetchImpl).not.toHaveBeenCalled()
  })
  it('stops polling failed requests and validates polling options', async () => {
    const {config} = dualFixture()
    const request = createDualSignClient({...config, fetchImpl: vi.fn(async () => json({status: 'failed'}))}).resume('r', message)
    await expect(request.wait()).rejects.toThrow('failed')
    await expect(request.wait({intervalMs: 0})).rejects.toThrow('interval')
    expect(() => createDualSignClient({...config, quorum: 0})).toThrow('quorum')
    expect(() => createDualSignClient({...config, timeoutMs: 0})).toThrow('timeout')
  })
  it('preserves an uncertain persisted outcome without another approval or ceremony', async () => {
    const {config, signer} = dualFixture()
    const transport = vi.fn<typeof fetch>(async () => json({status: 'uncertain'}))
    const sign = vi.fn(signer.sign)
    const request = createDualSignClient({...config, fetchImpl: transport}).resume('request-1', message)
    await expect(request.status()).resolves.toEqual({status: 'uncertain'})
    await expect(request.approve({signer: {...signer, sign}})).resolves.toEqual({status: 'uncertain'})
    await expect(request.wait()).rejects.toMatchObject({requestId: 'request-1'})
    expect(sign).not.toHaveBeenCalled()
    expect(transport).toHaveBeenCalledTimes(3)
    for (const [, init] of transport.mock.calls) expect(init?.method ?? 'GET').toBe('GET')
  })
})

it('polls pending approvals, reports progress and honours cancellation', async () => {
  const {config, pending, reply} = dualFixture()
  const fetchImpl = vi.fn(async () => json({status: 'signed', reply})).mockResolvedValueOnce(json(pending()))
  const onStatus = vi.fn()
  const request = createDualSignClient({...config, fetchImpl}).resume('request-1', message)
  expect((await request.wait({intervalMs: 1, onStatus})).groupPublicKey).toEqual(key)
  expect(onStatus).toHaveBeenCalledTimes(2)
  const controller = new AbortController()
  const waiting = createDualSignClient({...config, fetchImpl: vi.fn(async () => json(pending()))}).resume('request-1', message)
  await expect(waiting.wait({signal: controller.signal, onStatus: () => {controller.abort(new Error('stop polling'))}})).rejects.toThrow('stop polling')
})
it('reports ambiguous approval results without sending another approval', async () => {
  const {config, signer, pending} = dualFixture()
  for (const response of [json({}, 503), json({have: 1, need: 2, signed: true}), new Response('not-json')]) {
    const fetchImpl = vi.fn(async (_url, init) => init?.method === 'POST' ? response : json(pending()))
    const request = createDualSignClient({...config, fetchImpl}).resume('request-1', message)
    await expect(request.approve({signer})).rejects.toBeInstanceOf(OperationOutcomeUnknownError)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  }
})
it('rejects malformed status JSON and a failed read without recreating a request', async () => {
  const {config} = dualFixture()
  await expect(createDualSignClient({...config, fetchImpl: vi.fn(async () => Response.json(null))}).resume('r', message).status()).rejects.toThrow('Malformed')
  await expect(createDualSignClient({...config, fetchImpl: vi.fn(async () => {throw new Error('offline')})}).resume('r', message).status()).rejects.toThrow('offline')
})

function paidDualFixture(signedPayment?:PaymentIntentWire) {
  const h = (n: number, size = 32) => ('0x' + n.toString(16).padStart(2, '0').repeat(size)) as `0x${string}`
  const payment: PaymentIntentWire = signedPayment ?? {
    chain_id: 43112, settlement: h(1, 20), key_registry: h(2, 20), slot: slotId as `0x${string}`, action: 'sign',
    payload_digest: hex(sha256(message)) as `0x${string}`, session_commitment: h(5), nonce: h(6), max_cost: '100', expires: 9999999999,
    verification_epoch: 7, verification_seed: h(8), verification_root: h(9), verification_registry_size: 3, verification_committee: 2, verification_quorum: 2,
    keeper_assignment: {key_epoch: 0, committee_version: 0, threshold: 1, coordinator: Array<number>(32).fill(1), contributors: [Array<number>(32).fill(1)]}, signature: h(1, 65),
  }
  const id = prepaidRequestId(payment).slice(2)
  const payload = paidDualSignApprovalPayload(43112, slotId, message, id, payment)
  const {config, signer, pending, reply} = dualFixture()
  const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (String(url).endsWith('/approve')) {
      const body = JSON.parse(String(init?.body)) as {signature: string; approver_pubkey: string}
      expect(ed25519.verify(protocolHex(body.signature, 64, 'sig'), payload, protocolHex(body.approver_pubkey, 32, 'key'), {zip215: false})).toBe(true)
      return json({have: 2, need: 2, signed: true, reply})
    }
    if (init?.method === 'POST') {
      expect(JSON.parse(String(init.body))).toMatchObject({payment})
      return json({...pending(), request_id: id, credential_gated: false, approval_payload: hex(payload)}, 201)
    }
    return json(pending())
  })
  return {payment, id, payload, config: {...config, fetchImpl}, signer, fetchImpl}
}

async function paidDualExecutionFixture(){
  const consent=await keeperExecutionFixture('sign',hex(sha256(message)) as `0x${string}`,{slot:slotId as `0x${string}`})
  executionSigners.push(consent.signer)
  const fixture=paidDualFixture(consent.payment)
  return {...fixture,config:{...fixture.config,approveExecution:consent.approveExecution}}
}

describe('paid native dual-control', () => {
  it('matches the keeper paid approval byte vector', () => {
    const f = paidDualFixture()
    expect(f.id).toBe('53ff383fabce624fec39a849f33ed22ba0e53d16a90828429dc37841807cc0a1')
    expect(paymentIntentHash(f.payment)).toBe('0x278794eda88fd96445c2a405b6220e6f472e0ceb8612b0b421ba63c18914454d')
    expect(f.payload.length).toBe(210)
    expect(hex(sha256(f.payload))).toBe('0xa51f08dcecce04013c17c1b4fc36bbb447d1c6ab4867bdb84e9c409edd4039e1')
  })
  it('requires a separately bound credential approval payment before asking for an approval signature', async () => {
    const f = await paidDualExecutionFixture()
    const request = createDualSignClient({...f.config, credentialGated: true}).resume(f.id, message, {payment: f.payment})
    const sign = vi.fn(f.signer.sign), signer = {...f.signer, sign}
    const approval: PaymentIntentWire = {...f.payment, action: 'dual-approve', payload_digest: hex(sha256(f.payload)) as `0x${string}`}
    const authorization = {
      token: {...token, binding: 'holder_key' as const, payment: approval, payment_hash: paymentIntentHash(approval),
        request_hash: hex(requestHash(43112, protocolHex(slotId, 32, 'slot'), 'dual-approve', sha256(f.payload)))},
      verifierProofs: [{verifierIndex: 0, operator: '0x' + '11'.repeat(20), pubkey: hex(key), proof: ['0x' + '22'.repeat(32)]}],
    }
    for (const payment of [f.payment, {...approval, chain_id: 43113}, {...approval, expires: 1}]) {
      await expect(request.approve({signer, authorization: {...authorization, token: {...authorization.token, payment, payment_hash: paymentIntentHash(payment)}}})).rejects.toThrow('own bound payment')
    }
    await expect(request.approve({signer, authorization: {...authorization, token: {...authorization.token, payment_hash: '00'.repeat(32)}}})).rejects.toThrow('own bound payment')
    expect(sign).not.toHaveBeenCalled()
    expect((await request.approve({signer, authorization})).status).toBe('signed')
    expect(sign).toHaveBeenCalledTimes(1)
  })
  it('binds and snapshots the final payment through creation, approval and resume', async () => {
    const f = await paidDualExecutionFixture(), client = createDualSignClient(f.config)
    const request = await client.create(message, {payment: f.payment})
    expect(request.requestId).toBe(f.id)
    expect(request.payment).toEqual(f.payment)
    request.payment!.nonce = ('0x' + 'ff'.repeat(32)) as `0x${string}`
    expect(request.payment!.nonce).toBe(f.payment.nonce)
    expect((await request.approve({signer: f.signer})).status).toBe('signed')
    const resumed = client.resume(f.id, message, {payment: f.payment})
    expect((await resumed.approve({signer: f.signer})).status).toBe('signed')
    expect(() => client.resume('wrong', message, {payment: f.payment})).toThrow('final payment')
  })
  it('refuses substituted intent inputs and never signs in the unpaid domain', async () => {
    const f = await paidDualExecutionFixture(), sig = await f.signer.sign(f.payload)
    expect(ed25519.verify(sig, dualSignApprovalPayload(slotId, message, f.id), key, {zip215: false})).toBe(false)
    const changed = {...f.payment, nonce: ('0x' + 'aa'.repeat(32)) as `0x${string}`}
    expect(ed25519.verify(sig, paidDualSignApprovalPayload(43112, slotId, message, f.id, changed), key, {zip215: false})).toBe(false)
    for (const payment of [{...f.payment, action: 'dual-approve' as const}, {...f.payment, chain_id: 43113}, {...f.payment, payload_digest: ('0x' + 'aa'.repeat(32)) as `0x${string}`}]) {
      await expect(createDualSignClient(f.config).create(message, {payment})).rejects.toThrow('payment differs')
    }
    await expect(createDualSignClient(f.config).create(message, {payment: {...f.payment, expires: 1}})).rejects.toThrow('expired')
    expect(f.fetchImpl).not.toHaveBeenCalled()
  })
  it('reports the stable reservation ID after an ambiguous creation response', async () => {
    const f = await paidDualExecutionFixture(), fetchImpl = vi.fn(async () => { throw new Error('response lost') })
    await expect(createDualSignClient({...f.config, fetchImpl}).create(message, {payment: f.payment}))
      .rejects.toMatchObject({operation: 'dual-create', requestId: f.id})
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('retains the independently routed payment and rejects per-call replacements', async () => {
    const f = await paidDualExecutionFixture(), payment = structuredClone(f.payment)
    const client = createDualSignClient({...f.config, payment})
    payment.nonce = ('0x' + 'aa'.repeat(32)) as `0x${string}`
    await expect(client.create(message, {payment})).rejects.toThrow('replace the pinned')
    expect(f.fetchImpl).not.toHaveBeenCalled()
    const request = await client.create(message)
    expect(request.payment).toEqual(f.payment)
    expect(client.resume(f.id, message).payment).toEqual(f.payment)
  })
  it('refuses a keeper-substituted paid approval payload', async () => {
    const f = await paidDualExecutionFixture(), {pending} = dualFixture()
    const fetchImpl = vi.fn(async () => json({...pending(), request_id: f.id, credential_gated: false,
      approval_payload: hex(new Uint8Array(f.payload.length))}, 201))
    await expect(createDualSignClient({...f.config, fetchImpl}).create(message, {payment: f.payment}))
      .rejects.toMatchObject({operation: 'dual-create', requestId: f.id})
  })
})
