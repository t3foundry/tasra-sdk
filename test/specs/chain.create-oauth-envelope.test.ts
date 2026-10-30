// Slot creation with a `kk_oauth` policy envelope (ADR-0078, plan Unit 2.1 SDK half).
//
// What must hold, each pinned below with the chain mocked (the relay path decodes every call):
//   - an envelope commits its RFC 8785 form, so key order and whitespace do not move it;
//   - `oauthPolicy` is packed with the network's engine and the result IS the committed rule;
//   - an envelope requires `authType: 'oauth'`, and one no keeper would store is refused - both
//     BEFORE any chain read or transaction (a slot stranded on chain costs gas and a draw);
//   - the restriction is one-directional: an OID4VP query on an `oauth` slot keeps working.
import {beforeEach, expect, it, vi} from 'vitest'
import {createWalletClient, decodeFunctionData, defineChain, http, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {createTasraWriteClient, ruleCommitment, verifyRuleCommitment} from '../../src/chain/write.js'
import {keyRegistryAbi} from '../../src/chain/abis/keyRegistry.js'
import {RegoEnvelopeError} from '../../src/auth/rego.js'
import {canonicalize} from '../../src/auth/oid4vp.js'

const mocks = vi.hoisted(() => ({submit: vi.fn(), read: vi.fn(), receipt: vi.fn()}))
vi.mock('viem', async original => ({...await original<typeof import('viem')>(), createPublicClient: () => ({readContract: mocks.read, waitForTransactionReceipt: mocks.receipt})}))
vi.mock('../../src/chain/registeredRelay.js', async original => ({...await original<typeof import('../../src/chain/registeredRelay.js')>(), createRegisteredRelaySubmitter: () => ({submit: mocks.submit})}))

const address = `0x${'11'.repeat(20)}` as const
const hash = (v: string): Hex => `0x${v.repeat(32)}`
const chain = defineChain({id: 31337, name: 'fixture', nativeCurrency: {name: 'ETH', symbol: 'ETH', decimals: 18}, rpcUrls: {default: {http: ['http://localhost:1']}}})

const POLICY = 'package tasra.slot\n\ndefault allow := false\n\nallow if "treasury-signer" in input.tokens.kc.claims.realm_access.roles\n'
const TOKENS = {kc: {format: 'oauth+access-token+dpop', iss: ['https://idp.kk.local/realms/kk'], aud: ['https://localhost:19444/authz/43112'], max_age_secs: 300}}
const ENVELOPE =
  '{"kk_oauth":{"policy":{"entrypoint":"data.tasra.slot.allow","lang":"rego/v1","source":"package tasra.slot\\n\\ndefault allow := false\\n\\nallow if \\"treasury-signer\\" in input.tokens.kc.claims.realm_access.roles\\n"},' +
  '"tokens":{"kc":{"aud":["https://localhost:19444/authz/43112"],"format":"oauth+access-token+dpop","iss":["https://idp.kk.local/realms/kk"],"max_age_secs":300}},"v":1}}'
/** The same envelope as an author might write it: other key order, indented. */
const ENVELOPE_RESTYLED = JSON.stringify({kk_oauth: {v: 1, tokens: TOKENS, policy: {source: POLICY, lang: 'rego/v1', entrypoint: 'data.tasra.slot.allow'}}}, null, 2)
const OID4VP_OAUTH_RULE = JSON.stringify({credentials: [{id: 'corp', format: 'oauth+access-token+dpop', claims: [{path: ['iss'], values: ['https://idp.kk.local/realms/kk']}, {path: ['aud', null], values: ['https://localhost:19444/authz/43112']}], meta: {max_age_secs: 300}}]})

function fixture() {
  const wallet = createWalletClient({account: privateKeyToAccount(hash('01')), chain, transport: http()})
  vi.spyOn(wallet, 'writeContract').mockRejectedValue(new Error('Unexpected direct transaction'))
  const writer = createTasraWriteClient({
    rpcUrl: 'http://localhost:1',
    wallet,
    addresses: {KeyRegistry: address, ThresholdRandomBeacon: address, ServiceRegistry: address},
    relay: {
      forwarder: address,
      approvals: [{chainId: 31337, registry: address, serviceId: hash('02'), owner: address, serviceType: 0, revision: 1n, manifestHash: hash('03')}],
      transport: {request: vi.fn(), relayRequest: vi.fn()},
    },
  })
  const args = {slotId: hash('04'), salt: hash('05'), ruleSalt: hash('06'), k: 2, n: 3, mode: 'frost' as const}
  return {writer, args}
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.read.mockImplementation(async ({functionName}: {functionName: string}) => {
    if (functionName === 'computeCommitment') return hash('07')
    if (functionName === 'slotCommits') return [2n, 5n, address, false]
    if (functionName === 'epoch') return 2n
    if (functionName === 'randomBeacon') return address
    throw new Error(`Unexpected read ${functionName}`)
  })
  mocks.receipt.mockResolvedValue({status: 'success'})
  mocks.submit.mockImplementation(async () => ({id: hash('08'), txHash: hash('09')}))
})

const lastCreation = () => {
  const calls = mocks.submit.mock.calls.map(([, data]) => decodeFunctionData({abi: keyRegistryAbi, data: data as Hex}))
  return calls.at(-1)!
}

it('an envelope commits its canonical form: restyling it does not move the commitment', () => {
  const salt = hash('06')
  expect(canonicalize(ENVELOPE_RESTYLED)).toBe(ENVELOPE)
  expect(ruleCommitment(salt, ENVELOPE_RESTYLED)).toBe(ruleCommitment(salt, ENVELOPE))
  expect(verifyRuleCommitment(ENVELOPE_RESTYLED, salt, ruleCommitment(salt, ENVELOPE))).toBe(true)
})

it.each(['createSlot', 'createSlotCommitReveal'] as const)('%s packs `oauthPolicy`, commits the envelope and returns it as the rule', async method => {
  const h = fixture()
  const result = await h.writer[method]({...h.args, authType: 'oauth', oauthPolicy: {policy: POLICY, tokens: TOKENS}})
  expect(result.rule).toBe(ENVELOPE)
  const call = lastCreation()
  expect(call.args[1]).toBe(ruleCommitment(h.args.ruleSalt, ENVELOPE))
  expect(call.args[5]).toBe(2) // AuthType.Oauth
})

it.each(['createSlot', 'createSlotCommitReveal'] as const)('%s accepts an envelope passed as `rule` on an oauth slot', async method => {
  const h = fixture()
  const result = await h.writer[method]({...h.args, authType: 'oauth', rule: ENVELOPE_RESTYLED})
  expect(result.rule).toBe(ENVELOPE_RESTYLED)
  expect(lastCreation().args[1]).toBe(ruleCommitment(h.args.ruleSalt, ENVELOPE))
})

it.each([
  ['an envelope rule with no authType', {rule: ENVELOPE}, /requires authType: 'oauth'/],
  ['an envelope rule on an oid4vp slot', {rule: ENVELOPE, authType: 'oid4vp'}, /requires authType: 'oauth'/],
  ['an envelope rule on an unspecified slot', {rule: ENVELOPE, authType: 'unspecified'}, /requires authType: 'oauth'/],
  ['oauthPolicy with no authType', {oauthPolicy: {policy: POLICY, tokens: TOKENS}}, /requires authType: 'oauth'/],
  ['oauthPolicy on an oid4vp slot', {oauthPolicy: {policy: POLICY, tokens: TOKENS}, authType: 'oid4vp'}, /requires authType: 'oauth'/],
  ['both rule and oauthPolicy', {rule: ENVELOPE, oauthPolicy: {policy: POLICY, tokens: TOKENS}, authType: 'oauth'}, /either `rule` or `oauthPolicy`/],
  ['a policy the gate refuses', {oauthPolicy: {policy: 'package tasra.slot\n\nallow if http.send({})\n', tokens: TOKENS}, authType: 'oauth'}, /gate|http\.send|not allowed|refused/],
  ['an envelope keepers would not store yet', {authType: 'oauth', rule: JSON.stringify({kk_oauth: {v: 1, tokens: {...TOKENS, kc2: TOKENS.kc}, policy: {lang: 'rego/v1', entrypoint: 'data.tasra.slot.allow', source: 'package tasra.slot\n\ndefault allow := false\n\nallow if {\n\t"a" in input.tokens.kc.claims.r\n\t"b" in input.tokens.kc2.claims.r\n}\n'}}})}, /keepers would not store this envelope/],
])('refuses %s before any chain read or transaction', async (_label, extra, message) => {
  for (const method of ['createSlot', 'createSlotCommitReveal'] as const) {
    const h = fixture()
    await expect(h.writer[method]({...h.args, ...extra} as never)).rejects.toThrow(message)
  }
  expect(mocks.read).not.toHaveBeenCalled()
  expect(mocks.submit).not.toHaveBeenCalled()
})

it('a gate refusal surfaces as RegoEnvelopeError', async () => {
  const h = fixture()
  await expect(h.writer.createSlot({...h.args, authType: 'oauth', oauthPolicy: {policy: 'package tasra.slot\n\nallow if http.send({})\n', tokens: TOKENS}})).rejects.toBeInstanceOf(RegoEnvelopeError)
})

it('an OID4VP OAuth query on an oauth slot still commits its canonical form (one-directional)', async () => {
  const h = fixture()
  const result = await h.writer.createSlot({...h.args, authType: 'oauth', rule: OID4VP_OAUTH_RULE})
  expect(result.rule).toBe(OID4VP_OAUTH_RULE)
  expect(lastCreation().args[1]).toBe(ruleCommitment(h.args.ruleSalt, OID4VP_OAUTH_RULE))
  expect(lastCreation().args[5]).toBe(2)
})
