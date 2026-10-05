import {describe, expect, it, vi} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import {hashTypedData, toHex, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import fc from 'fast-check'
import {paymentIntentHash, paymentIntentTypedData, type PaymentIntentWire} from '../../src/committee/payment.js'
import {approveExecutionRequest, createExecutionCertificate, createLocalExecutionSigner,
  executionApprovalTypedData, executionBodyHash, executionCertificateTypedData, verifyExecutionAuthorization,
  MAX_EXECUTION_BODY_BYTES, type ExecutionAuthorization, type ExecutionConsentPolicy,
  type ExecutionProposal, type ExecutionStage, type ExpectedExecution} from '../../src/committee/execution.js'

const h = (byte: number, length = 32): Hex => `0x${byte.toString(16).padStart(2, '0').repeat(length)}`
const creator = privateKeyToAccount(h(11)), outsider = privateKeyToAccount(h(12))
const operator = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(22)))
const otherOperator = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(23)))
const body = () => ({credentials: ['client-approved credential'], slot_id: 'slot', exp: 1040})
function payment(): PaymentIntentWire {
  return {chain_id: 43112, settlement: h(1, 20), key_registry: h(2, 20), slot: h(3), action: 'sign',
    payload_digest: h(4), session_commitment: h(5), nonce: h(6), max_cost: '10', expires: 1060,
    verification_epoch: 7, verification_seed: h(8), verification_root: h(9),
    verification_registry_size: 5, verification_committee: 3, verification_quorum: 2,
    keeper_assignment: {key_epoch: 1, committee_version: 2, threshold: 2,
      coordinator: Array<number>(32).fill(9), contributors: [9, 10, 11].map(n => Array<number>(32).fill(n))}, signature: h(1, 65)}
}
async function fixture(stage: ExecutionStage = 'credential', intent = payment()) {
  intent.signature = await creator.signTypedData(paymentIntentTypedData(intent))
  const policy: ExecutionConsentPolicy = {chainId: 43112, settlement: h(1, 20), keyRegistry: h(2, 20),
    creator: creator.address, paymentHash: paymentIntentHash(intent), cost: 9n, nowSecs: 1000}
  const signer = createLocalExecutionSigner(new Uint8Array(32).fill(21))
  const certificate = await createExecutionCertificate({payment: intent, policy, publicKey: signer.publicKey, expires: 1050, creator})
  const expected: ExpectedExecution = {stage, operatorKey: operator, body: body()}
  const proposal: ExecutionProposal = {stage, operator_key: operator, unsigned_body: body(), expires: 1040}
  const options = {payment: intent, certificate, signer, policy, expected, proposal}
  return {...options, options, verify: (authorization: ExecutionAuthorization) => verifyExecutionAuthorization({payment: intent, policy, expected, authorization})}
}

describe('client-retained execution consent', () => {
  it('matches independent Rust vectors with genuine creator and client signatures', async () => {
    const f = await fixture(), authorization = await approveExecutionRequest(f.options)
    expect(paymentIntentHash(f.payment)).toBe('0x7dba29411d2dd206eb4fc475d78a1f3be8d0ddc410c45f9b5a1ebb144478ceb5')
    expect(authorization.certificate.execution_key).toBe('0xd54207da194977dcf46adbfec2bc2e75b52d5a8a42184fedfdc00024f0e3e8da')
    expect(executionBodyHash(body())).toBe('0xfff58bf5c45bb036054960dce606b82b9d6c886e5f6d9e6b540b2591ac034dcd')
    expect(hashTypedData(executionCertificateTypedData(f.payment, f.certificate))).toBe('0xaf5a86a8e05df807ceef24f9f2cdc54500fc32aee641612ad8762cad0d745639')
    expect(hashTypedData(executionApprovalTypedData(f.payment, authorization))).toBe('0x48708ba42684cdf77bdd85d6b9d29436e214c3a85912aea49f3cbb5b42177bef')
    await expect(f.verify(authorization)).resolves.toBeUndefined()
    expect(JSON.stringify(authorization)).not.toContain('private')
    f.signer.dispose()
  })

  it.each(['coordinator', 'contributor', 'presentation_sign', 'presentation_attest', 'credential'] as const)('accepts the intended %s stage without changing its ordinal', async stage => {
    const intent = payment()
    intent.keeper_assignment = {key_epoch: 1, committee_version: 2, threshold: 1,
      coordinator: Array.from(ed25519.getPublicKey(new Uint8Array(32).fill(22))),
      contributors: [Array.from(ed25519.getPublicKey(new Uint8Array(32).fill(22)))]}
    const f = await fixture(stage, intent), authorization = await approveExecutionRequest(f.options)
    expect(executionApprovalTypedData(intent, authorization).message.stage).toBe(['coordinator', 'contributor', 'presentation_sign', 'presentation_attest', 'credential'].indexOf(stage))
    await expect(f.verify(authorization)).resolves.toBeUndefined()
    f.signer.dispose()
  })

  it('refuses an agent replacement credential and every altered operation field before client signing', async () => {
    const f = await fixture(), sign = vi.fn(f.signer.sign)
    const changes = [{credentials: ['attacker replacement']}, {slot_id: 'other'}, {exp: 1041}, {extra: null}]
    for (const change of changes) await expect(approveExecutionRequest({...f.options, signer: {publicKey: f.signer.publicKey, sign},
      proposal: {...f.proposal, unsigned_body: {...body(), ...change}}})).rejects.toThrow(/client-built intent/)
    for (const change of [{stage: 'presentation_sign' as const}, {operator_key: otherOperator}]) {
      await expect(approveExecutionRequest({...f.options, signer: {publicKey: f.signer.publicKey, sign}, proposal: {...f.proposal, ...change}})).rejects.toThrow(/client-built intent/)
    }
    expect(sign).not.toHaveBeenCalled()
    f.signer.dispose()
  })

  it('refuses credential replacement even when the stolen approval envelope is edited to match', async () => {
    const f = await fixture(), authorization = await approveExecutionRequest(f.options)
    const expected = {...f.expected, body: {...body(), credentials: ['attacker replacement']}}
    await expect(verifyExecutionAuthorization({...f.options, expected, authorization})).rejects.toThrow(/intended live stage/)
    await expect(verifyExecutionAuthorization({...f.options, expected,
      authorization: {...authorization, body_hash: executionBodyHash(expected.body)}})).rejects.toThrow(/client execution signature/)
    f.signer.dispose()
  })

  it('does not accept a relabeled operator or stage under the original client signature', async () => {
    const f = await fixture(), authorization = await approveExecutionRequest(f.options)
    await expect(verifyExecutionAuthorization({...f.options, expected: {...f.expected, operatorKey: otherOperator},
      authorization: {...authorization, operator_key: otherOperator}})).rejects.toThrow(/client execution signature/)
    await expect(verifyExecutionAuthorization({...f.options, expected: {...f.expected, stage: 'presentation_sign'},
      authorization: {...authorization, stage: 'presentation_sign'}})).rejects.toThrow(/client execution signature/)
    f.signer.dispose()
  })

  it('refuses noncreator consent and an uncertified local signer before its signing callback', async () => {
    const f = await fixture(), sign = vi.fn(f.signer.sign)
    const certificate = {...f.certificate, creator_signature: await outsider.signTypedData(executionCertificateTypedData(f.payment, f.certificate))}
    await expect(approveExecutionRequest({...f.options, certificate, signer: {publicKey: f.signer.publicKey, sign}})).rejects.toThrow(/slot creator/)
    await expect(approveExecutionRequest({...f.options, signer: {publicKey: ed25519.getPublicKey(new Uint8Array(32).fill(24)), sign}})).rejects.toThrow(/differs from creator certificate/)
    const forged = {...f.payment, signature: await outsider.signTypedData(paymentIntentTypedData(f.payment))}
    await expect(approveExecutionRequest({...f.options, payment: forged, signer: {publicKey: f.signer.publicKey, sign}})).rejects.toThrow(/slot creator/)
    expect(sign).not.toHaveBeenCalled()
    f.signer.dispose()
  })

  it('refuses unassigned keeper work and billing-only approval stages before signing', async () => {
    const f = await fixture(), sign = vi.fn(f.signer.sign)
    for (const stage of ['coordinator', 'contributor'] as const) await expect(approveExecutionRequest({...f.options,
      expected: {...f.expected, stage}, proposal: {...f.proposal, stage}, signer: {publicKey: f.signer.publicKey, sign}})).rejects.toThrow(/unassigned keeper/)
    expect(sign).not.toHaveBeenCalled()
    const intent = payment(); intent.action = 'dual-approve'
    intent.keeper_assignment = {key_epoch: 1, committee_version: 2, threshold: 1,
      coordinator: Array.from(ed25519.getPublicKey(new Uint8Array(32).fill(22))),
      contributors: [Array.from(ed25519.getPublicKey(new Uint8Array(32).fill(22)))]}
    const dual = await fixture('coordinator', intent), dualSign = vi.fn(dual.signer.sign)
    await expect(approveExecutionRequest({...dual.options, signer: {publicKey: dual.signer.publicKey, sign: dualSign}})).rejects.toThrow(/unassigned keeper/)
    expect(dualSign).not.toHaveBeenCalled()
    f.signer.dispose(); dual.signer.dispose()
  })

  it('requires independent deployment, exact payment, nonzero backed cost and a live clock', async () => {
    const f = await fixture(), sign = vi.fn(f.signer.sign)
    const changes: Partial<ExecutionConsentPolicy>[] = [{chainId: 43113}, {chainId: 0}, {settlement: h(7, 20)},
      {keyRegistry: h(7, 20)}, {creator: h(0, 20)}, {settlement: h(0, 20)}, {keyRegistry: h(0, 20)},
      {paymentHash: h(7)}, {cost: 0n}, {cost: 11n}, {nowSecs: 1060}, {nowSecs: -3000}, {nowSecs: NaN}]
    for (const change of changes) await expect(approveExecutionRequest({...f.options, policy: {...f.policy, ...change},
      signer: {publicKey: f.signer.publicKey, sign}})).rejects.toThrow()
    for (const field of ['session_commitment', 'nonce', 'verification_seed'] as const) {
      const intent = {...f.payment, [field]: h(0)}
      intent.signature = await creator.signTypedData(paymentIntentTypedData(intent))
      await expect(approveExecutionRequest({...f.options, payment: intent, policy: {...f.policy, paymentHash: paymentIntentHash(intent)},
        signer: {publicKey: f.signer.publicKey, sign}})).rejects.toThrow(/consent policy/)
    }
    expect(sign).not.toHaveBeenCalled()
    f.signer.dispose()
  })

  it('caps both certificate and stage lifetime before asking either signer', async () => {
    const f = await fixture(), sign = vi.fn(f.signer.sign), signTypedData = vi.fn(creator.signTypedData)
    for (const expires of [0, 1000, 1061, -1, 1040.5, NaN]) await expect(createExecutionCertificate({...f.options,
      publicKey: f.signer.publicKey, expires, creator: {address: creator.address, signTypedData}})).rejects.toThrow()
    expect(signTypedData).not.toHaveBeenCalled()
    for (const expires of [0, 1000, 1051, -1, 1040.5, NaN]) await expect(approveExecutionRequest({...f.options,
      proposal: {...f.proposal, expires}, signer: {publicKey: f.signer.publicKey, sign}})).rejects.toThrow()
    expect(sign).not.toHaveBeenCalled()
    const authorization = await approveExecutionRequest(f.options)
    for (const nowSecs of [1040, 1050]) await expect(verifyExecutionAuthorization({...f.options, policy: {...f.policy, nowSecs}, authorization})).rejects.toThrow(/expired|live stage/)
    f.signer.dispose()
  })

  it('rejects unknown envelope fields and malformed signatures instead of silently dropping them', async () => {
    const f = await fixture(), authorization = await approveExecutionRequest(f.options), sign = vi.fn(f.signer.sign)
    for (const proof of [{...authorization, unknown: true}, {...authorization, certificate: {...f.certificate, unknown: true}},
      {...authorization, signature: '0x00' as Hex}, {...authorization, signature: h(0, 64)},
      {...authorization, operator_key: h(0)}, {...authorization, stage: 'unknown' as ExecutionStage}]) {
      await expect(f.verify(proof)).rejects.toThrow()
    }
    const proposal = {...f.proposal, body_hash: executionBodyHash(body())}
    await expect(approveExecutionRequest({...f.options, proposal, signer: {publicKey: f.signer.publicKey, sign}})).rejects.toThrow(/unknown/)
    const missing = {...f.proposal}; delete (missing as Partial<ExecutionProposal>).unsigned_body
    await expect(approveExecutionRequest({...f.options, proposal: missing, signer: {publicKey: f.signer.publicKey, sign}})).rejects.toThrow(/missing/)
    expect(sign).not.toHaveBeenCalled()
    f.signer.dispose()
  })

  it('locally rejects a malicious signer and a wallet returning another creator signature', async () => {
    const f = await fixture()
    await expect(approveExecutionRequest({...f.options, signer: {publicKey: f.signer.publicKey, sign: async () => new Uint8Array(64)}})).rejects.toThrow(/client execution signature/)
    await expect(createExecutionCertificate({...f.options, publicKey: f.signer.publicKey, expires: 1050,
      creator: {address: creator.address, signTypedData: args => outsider.signTypedData(args)}})).rejects.toThrow(/slot creator/)
    const signTypedData = vi.fn(creator.signTypedData)
    await expect(createExecutionCertificate({...f.options, publicKey: f.signer.publicKey, expires: 1050,
      creator: {address: outsider.address, signTypedData}})).rejects.toThrow(/current creator/)
    expect(signTypedData).not.toHaveBeenCalled()
    f.signer.dispose()
  })

  it('refuses both small-order and mixed-order execution public keys', async () => {
    const f = await fixture(), mixed = '0x9a276fd96db6d6b855f4115053d81f74006dcf69dd6df902430469beaae00f37' as Hex
    for (const execution_key of [h(0), mixed, '0x00' as Hex]) expect(() => executionCertificateTypedData(f.payment,
      {...f.certificate, execution_key})).toThrow()
    const authorization = await approveExecutionRequest(f.options)
    for (const operator_key of [h(0), mixed]) expect(() => executionApprovalTypedData(f.payment, {...authorization, operator_key})).toThrow()
    f.signer.dispose()
  })

  it('retains the original body and consent across an asynchronous signing callback', async () => {
    const f = await fixture()
    const expected = structuredClone(f.expected), paymentHash = paymentIntentHash(f.payment)
    const approval = await approveExecutionRequest({...f.options, signer: {publicKey: f.signer.publicKey, sign: async hash => {
      f.expected.body.credentials = ['changed while signing']; f.proposal.unsigned_body.exp = 0
      f.payment.max_cost = '99'; f.policy.paymentHash = h(99); f.certificate.expires = 0
      return f.signer.sign(hash)
    }}})
    expect(approval.body_hash).toBe(executionBodyHash(expected.body))
    expect(approval.certificate.expires).toBe(1050)
    expect(paymentHash).toBe('0x7dba29411d2dd206eb4fc475d78a1f3be8d0ddc410c45f9b5a1ebb144478ceb5')
    f.signer.dispose()
  })

  it('binds changed credential bytes even if the attacker edits the public body commitment', async () => {
    const f = await fixture(), authorization = await approveExecutionRequest(f.options)
    await fc.assert(fc.asyncProperty(fc.uint8Array({minLength: 1, maxLength: 128}), async bytes => {
      const expected = {...f.expected, body: {...body(), credentials: [toHex(bytes)]}}
      await expect(verifyExecutionAuthorization({...f.options, expected,
        authorization: {...authorization, body_hash: executionBodyHash(expected.body)}})).rejects.toThrow(/client execution signature/)
    }), {numRuns: 32, seed: 20261005})
    f.signer.dispose()
  })
})

describe('complete JSON body commitment', () => {
  it('preserves all fields and null/absence while ignoring JSON object insertion order', () => {
    expect(executionBodyHash({b: 2, a: ['credential', null]})).toBe(executionBodyHash({a: ['credential', null], b: 2}))
    expect(executionBodyHash({field: null})).not.toBe(executionBodyHash({}))
    expect(executionBodyHash({credentials: ['one', 'two']})).not.toBe(executionBodyHash({credentials: ['two', 'one']}))
    expect(executionBodyHash({emoji: '\uD83D\uDE00', control: '\u0000', safe: Number.MAX_SAFE_INTEGER, negative: -Number.MAX_SAFE_INTEGER, bool: true})).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('rejects lossy numbers, non-JSON objects, accessors, sparse arrays and unpaired Unicode', () => {
    const getter = vi.fn(() => 'credential'), accessor = Object.defineProperty({}, 'credential', {enumerable: true, get: getter})
    const accessorArray = Object.defineProperty(['credential'], '0', {enumerable: true, get: getter})
    const hiddenArray = Object.assign(['credential'], {hidden: 'ignored'})
    const symbol = {[Symbol('hidden')]: 'ignored'}, hidden = Object.defineProperty({}, 'credential', {value: 'ignored'})
    const invalid = [undefined, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 1n, new Date(), new Uint8Array(1),
      () => 'credential', Array(1), accessor, accessorArray, hiddenArray, hidden, symbol, '\uD800', '\uDC00', {'\uD800': 'bad'}]
    for (const value of invalid) expect(() => executionBodyHash({value})).toThrow()
    expect(getter).not.toHaveBeenCalled()
    expect(() => executionBodyHash({execution_authorization: null})).toThrow(/unsigned/)
    expect(() => executionBodyHash([] as unknown as Record<string, unknown>)).toThrow(/unsigned/)
    expect(() => executionBodyHash(null as unknown as Record<string, unknown>)).toThrow(/unsigned/)
  })

  it('applies depth, node and serialized byte caps including multibyte strings', () => {
    let nested: unknown = 0
    for (let i = 0; i < 34; i++) nested = [nested]
    expect(() => executionBodyHash({nested})).toThrow(/nesting/)
    expect(() => executionBodyHash({nodes: Array<boolean>(65_536).fill(false)})).toThrow(/node bound/)
    expect(() => executionBodyHash({credential: 'x'.repeat(MAX_EXECUTION_BODY_BYTES)})).toThrow(/byte bound/)
    expect(() => executionBodyHash({credential: '😀'.repeat(MAX_EXECUTION_BODY_BYTES / 3)})).toThrow(/byte bound/)
  })

  it('refuses accessor proposals before cloning can evaluate them', async () => {
    const f = await fixture(), getter = vi.fn(() => ['attacker credential'])
    const unsigned_body = Object.defineProperty({}, 'credentials', {enumerable: true, get: getter})
    await expect(approveExecutionRequest({...f.options, proposal: {...f.proposal, unsigned_body}})).rejects.toThrow(/non-JSON/)
    expect(getter).not.toHaveBeenCalled()
    f.signer.dispose()
  })
})

describe('local-only execution signer', () => {
  it('copies the seed and public key, verifies real signatures, and permanently disables signing on disposal', async () => {
    const seed = new Uint8Array(32).fill(21), signer = createLocalExecutionSigner(seed), publicKey = signer.publicKey
    seed.fill(0); signer.publicKey.fill(0)
    const message = new Uint8Array(32).fill(7), signature = await signer.sign(message)
    expect(ed25519.verify(signature, message, publicKey, {zip215: false})).toBe(true)
    expect(signer.publicKey).toEqual(publicKey)
    await expect(signer.sign(new Uint8Array(31))).rejects.toThrow(/32-byte/)
    signer.dispose(); signer.dispose()
    await expect(signer.sign(message)).rejects.toThrow(/disposed/)
    expect(Object.keys(signer)).toEqual(['publicKey', 'sign', 'dispose'])
  })
  it('generates fresh client keys and refuses malformed seeds without exporting a private seed', () => {
    const first = createLocalExecutionSigner(), second = createLocalExecutionSigner()
    expect(first.publicKey).not.toEqual(second.publicKey)
    first.dispose(); second.dispose()
    for (const length of [0, 31, 33]) expect(() => createLocalExecutionSigner(new Uint8Array(length))).toThrow(/32 bytes/)
  })
})
