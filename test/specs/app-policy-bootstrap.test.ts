// Slot policy statements: the creator tells a holder application which rule a slot enforces,
// never handing over the rule salt. Offline statement checks, the on-chain half
// (requireCurrentSlotPolicy) and the store's sequence high-water mark (admitSlotPolicySequence).
// No operation requires a statement: any key may open a session and the slot's rule decides.
import {describe, expect, it, vi} from 'vitest'
import {keccak256, toHex, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {admitSlotPolicySequence, createSlotPolicyRequest, issueSlotPolicyBootstrap, requireCurrentSlotPolicy, slotPolicyHash, slotPolicyTypedData, verifySlotPolicyBootstrap, verifySlotPolicyRequest,
  type SlotPolicyBootstrap, type SlotPolicyStatement} from '../../src/app/policy-bootstrap.js'
import {createMemoryStore} from '../../src/app/memory-store.js'
import {ruleCommitment} from '../../src/chain/write.js'
import type {TasraChainClient} from '../../src/chain/client.js'

const h = (n: number, len = 32): Hex => `0x${n.toString(16).padStart(2, '0').repeat(len)}`
const creator = privateKeyToAccount(h(7)), app = privateKeyToAccount(h(21)), otherApp = privateKeyToAccount(h(22))
const slot = h(3), salt = h(4), rule = JSON.stringify({credentials: [{id: 'a', format: 'dc+sd-jwt', claims: [{path: ['iss'], values: ['did:web:issuer.example']}]}]})
const commitment = ruleCommitment(salt, rule)
const deployment = {chainId: 43112, keyRegistry: h(2, 20)}

/** The slot as KeyRegistry returns it, at the block discovery reads. */
const onChain = {creator: creator.address, ruleCommitment: commitment, ruleVersion: 0, exists: true, cancelled: false}
function chainReader(slotState: Partial<typeof onChain> = {}): TasraChainClient {
  return {client: {getChainId: vi.fn(async () => 43112), readContract: vi.fn(async () => ({...onChain, ruleVersion: BigInt(onChain.ruleVersion), ...slotState,
    ...(slotState.ruleVersion !== undefined ? {ruleVersion: BigInt(slotState.ruleVersion)} : {})}))},
  addresses: {KeyRegistry: deployment.keyRegistry}} as unknown as TasraChainClient
}
const issue = (over: Partial<Parameters<typeof issueSlotPolicyBootstrap>[1]> = {}) => issueSlotPolicyBootstrap(chainReader(),
  {signer: creator, slot, rule, salt, audience: app.address, actions: ['sign', 'decrypt'], sequence: 1, ...over})
/** Re-sign a statement as `signer` (the creator unless named). */
async function resign(statement: SlotPolicyStatement, signer = creator, ruleText = rule): Promise<SlotPolicyBootstrap> {
  return {statement, rule: ruleText, signature: await signer.signTypedData(slotPolicyTypedData(statement))}
}
const expect_ = {chainId: 43112, keyRegistry: deployment.keyRegistry, slot, audience: app.address, action: 'sign' as const, signer: creator.address}

describe('slot policy statements, offline', () => {
  it('the creator issues a statement bound to the on-chain commitment and rule version; it carries no salt', async () => {
    const b = await issue()
    expect(b.statement).toMatchObject({chainId: 43112, slot, ruleCommitment: commitment.toLowerCase(), ruleVersion: 0, ruleHash: keccak256(toHex(rule)), audience: app.address})
    expect(JSON.stringify(b).toLowerCase()).not.toContain(salt.slice(2))
    const {signer} = await verifySlotPolicyBootstrap(b, expect_)
    expect(signer).toBe(creator.address)
  })

  it('the issuer refuses a slot it does not create, a salt that does not reproduce the commitment and a dead slot', async () => {
    await expect(issueSlotPolicyBootstrap(chainReader(), {signer: otherApp, slot, rule, salt, audience: app.address, actions: ['sign'], sequence: 1})).rejects.toMatchObject({code: 'not-issuable'})
    await expect(issue({salt: h(5)})).rejects.toMatchObject({code: 'not-issuable'})
    await expect(issueSlotPolicyBootstrap(chainReader({cancelled: true}), {signer: creator, slot, rule, salt, audience: app.address, actions: ['sign'], sequence: 1})).rejects.toMatchObject({code: 'not-issuable'})
    await expect(issue({ttlSecs: 86_401})).rejects.toMatchObject({code: 'malformed'})
    await expect(issue({actions: []})).rejects.toMatchObject({code: 'malformed'})
  })

  it('refuses a substituted rule, a substituted commitment or rule hash, and another signer', async () => {
    const b = await issue()
    const other = JSON.stringify({credentials: [{id: 'a', format: 'dc+sd-jwt', claims: [{path: ['iss'], values: ['did:web:attacker.example']}]}]})
    await expect(verifySlotPolicyBootstrap({...b, rule: other}, expect_)).rejects.toMatchObject({code: 'substituted-rule'})
    // Fields changed without the creator's key: the signature no longer recovers to the creator.
    await expect(verifySlotPolicyBootstrap({...b, statement: {...b.statement, ruleCommitment: h(66)}}, expect_)).rejects.toMatchObject({code: 'wrong-signer'})
    await expect(verifySlotPolicyBootstrap({...b, rule: other, statement: {...b.statement, ruleHash: keccak256(toHex(other))}}, expect_)).rejects.toMatchObject({code: 'wrong-signer'})
    await expect(verifySlotPolicyBootstrap(await resign(b.statement, otherApp), expect_)).rejects.toMatchObject({code: 'wrong-signer'})
  })

  it('refuses another deployment, slot or application, an action out of scope and a malformed bootstrap', async () => {
    const b = await issue({actions: ['decrypt']})
    await expect(verifySlotPolicyBootstrap(b, {...expect_, chainId: 1})).rejects.toMatchObject({code: 'wrong-deployment'})
    await expect(verifySlotPolicyBootstrap(b, {...expect_, keyRegistry: h(77, 20)})).rejects.toMatchObject({code: 'wrong-deployment'})
    await expect(verifySlotPolicyBootstrap(b, {...expect_, slot: h(78)})).rejects.toMatchObject({code: 'wrong-slot'})
    await expect(verifySlotPolicyBootstrap(b, {...expect_, audience: otherApp.address})).rejects.toMatchObject({code: 'wrong-audience'})
    await expect(verifySlotPolicyBootstrap(b, expect_)).rejects.toMatchObject({code: 'out-of-scope'})
    await expect(verifySlotPolicyBootstrap({...b, salt} as unknown as SlotPolicyBootstrap, {...expect_, action: 'decrypt'})).rejects.toMatchObject({code: 'malformed'})
    await expect(verifySlotPolicyBootstrap({...b, signature: '0x00'}, {...expect_, action: 'decrypt'})).rejects.toMatchObject({code: 'malformed'})
    await expect(verifySlotPolicyBootstrap({...b, rule: 'x'.repeat(4097)}, {...expect_, action: 'decrypt'})).rejects.toMatchObject({code: 'malformed'})
  })

  it('refuses an expired statement, one not valid yet and one claiming more than a day', async () => {
    const t = Math.floor(Date.now() / 1000)
    const b = await issue({ttlSecs: 60, nowSecs: t})
    await expect(verifySlotPolicyBootstrap(b, {...expect_, nowSecs: t + 60})).rejects.toMatchObject({code: 'stale'})
    await expect(verifySlotPolicyBootstrap(b, {...expect_, nowSecs: t - 120})).rejects.toMatchObject({code: 'stale'})
    const long = await resign({...b.statement, expiresAt: b.statement.issuedAt + 86_401})
    await expect(verifySlotPolicyBootstrap(long, {...expect_, nowSecs: t})).rejects.toMatchObject({code: 'stale'})
  })

  it('a holder application signs its retrieval request; the issuer checks deployment, age and signer', async () => {
    const request = await createSlotPolicyRequest(app, {chainId: 43112, keyRegistry: deployment.keyRegistry, slot})
    expect((await verifySlotPolicyRequest(request, {chainId: 43112, keyRegistry: deployment.keyRegistry})).audience).toBe(app.address)
    await expect(verifySlotPolicyRequest(request, {chainId: 1, keyRegistry: deployment.keyRegistry})).rejects.toMatchObject({code: 'wrong-deployment'})
    await expect(verifySlotPolicyRequest(request, {chainId: 43112, keyRegistry: deployment.keyRegistry, nowSecs: request.issuedAt + 121})).rejects.toMatchObject({code: 'stale'})
    await expect(verifySlotPolicyRequest({...request, audience: otherApp.address}, {chainId: 43112, keyRegistry: deployment.keyRegistry})).rejects.toMatchObject({code: 'wrong-signer'})
    await expect(verifySlotPolicyRequest({...request, extra: 1} as never, {chainId: 43112, keyRegistry: deployment.keyRegistry})).rejects.toMatchObject({code: 'malformed'})
  })
})

describe('slot policy statements against the chain and the store', () => {
  it('the on-chain half: the signer is the current creator and the commitment and rule version are the slot\'s', async () => {
    const b = await issue(), {signer} = await verifySlotPolicyBootstrap(b, expect_)
    const observed = {creator: creator.address, ruleCommitment: commitment, ruleVersion: 0}
    expect(() => requireCurrentSlotPolicy(b.statement, signer, observed)).not.toThrow()
    for (const changed of [{ruleCommitment: h(66)}, {ruleVersion: 1}, {creator: otherApp.address}]) {
      expect(() => requireCurrentSlotPolicy(b.statement, signer, {...observed, ...changed})).toThrow(expect.objectContaining({code: 'changed-policy'}))
    }
  })

  it('the sequence high-water mark refuses an older statement and another one with the same sequence', async () => {
    const store = createMemoryStore()
    const newer = await issue({sequence: 5}), older = await issue({sequence: 4})
    await admitSlotPolicySequence(store, newer.statement)
    // The same statement again is fine; an older one, or another one with the same sequence, is not.
    await admitSlotPolicySequence(store, newer.statement)
    await expect(admitSlotPolicySequence(store, older.statement)).rejects.toMatchObject({code: 'replayed'})
    await expect(admitSlotPolicySequence(store, (await issue({sequence: 5, ttlSecs: 120})).statement)).rejects.toMatchObject({code: 'equivocated'})
    await admitSlotPolicySequence(store, (await issue({sequence: 6})).statement)
    // Another holder application keeps its own mark.
    await admitSlotPolicySequence(store, (await issue({sequence: 1, audience: otherApp.address})).statement)
    expect(slotPolicyHash(newer.statement)).toMatch(/^0x[0-9a-f]{64}$/)
  })
})
