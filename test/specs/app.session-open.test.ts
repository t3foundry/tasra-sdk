// openDecryptSession end to end, with no payment anywhere: one presentation in session mode (the
// signed Request Object checked against the chain-anchored draw before the wallet step), the
// grant verified against that draw and journaled, then decrypts under the grant.
// Seams that have their own suites are stand-ins: the agent session (chain.registered-agent), the
// chain reads (chain.session-draw), the slot sharing and the keeper fan-out (decryption.session).
// Real here: the session key, the create fragment, the wallet-request check, the grant
// verification and journal, and the session lifecycle.
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import {hexToBytes, bytesToHex} from '../../src/crypto/hex.js'
import {b64url} from '../../src/oid4vp/jose.js'
import {requestHash, vpNonceBound} from '../../src/oid4vp/binding.js'
import {BINDING_HOLDER_KEY, selectVerifierCommittee} from '../../src/committee/token.js'
import {encodeSessionGrant, sessionGrantHash, sessionGrantPayload, sessionKeyThumbprint, type SessionGrantRequestWire} from '../../src/committee/session-grant.js'
import {createMemoryStore} from '../../src/app/memory-store.js'
import type {SlotDrawTrust} from '../../src/chain/sessionDraw.js'
import type {TasraApplication} from '../../src/app/client.js'
import type {SessionAgentTransport} from '../../src/chain/sessionControlTransport.js'
import type {VerifiedRequestObject} from '../../src/oid4vp/request-object.js'

const openRegisteredVerifierAgentSession = vi.fn(), awaitRegisteredVerifierAgentResult = vi.fn()
vi.mock('../../src/chain/registeredAgent.js', async original => ({...await original<typeof import('../../src/chain/registeredAgent.js')>(), createRegisteredAgentClient: vi.fn(() => ({}))}))
vi.mock('../../src/chain/registeredOperation.js', async original => ({...await original<typeof import('../../src/chain/registeredOperation.js')>(),
  openRegisteredVerifierAgentSession: (...a: unknown[]) => openRegisteredVerifierAgentSession(...a), awaitRegisteredVerifierAgentResult: (...a: unknown[]) => awaitRegisteredVerifierAgentResult(...a)}))
const fetchRequestObject = vi.fn()
vi.mock('../../src/oid4vp/request-object.js', async original => ({...await original<typeof import('../../src/oid4vp/request-object.js')>(), fetchRequestObject: (...a: unknown[]) => fetchRequestObject(...a)}))
const drawReader = vi.fn(), readCurrentBeaconEpoch = vi.fn(), readBeaconDrawState = vi.fn()
vi.mock('../../src/chain/sessionDraw.js', () => ({createSlotDrawReader: vi.fn(() => drawReader), readCurrentBeaconEpoch: (...a: unknown[]) => readCurrentBeaconEpoch(...a),
  readBeaconDrawState: (...a: unknown[]) => readBeaconDrawState(...a)}))
const readSlotSharing = vi.fn()
vi.mock('../../src/chain/slotSharing.js', () => ({readSlotSharing: (...a: unknown[]) => readSlotSharing(...a)}))
vi.mock('../../src/chain/discovery.js', async original => ({...await original<typeof import('../../src/chain/discovery.js')>(), resolveAccountantUrls: vi.fn(async () => ['https://accountant.test'])}))
const decryptWithSessionGrant = vi.fn()
vi.mock('../../src/decryption/session.js', () => ({decryptWithSessionGrant: (...a: unknown[]) => decryptWithSessionGrant(...a)}))
const {openDecryptSession, SessionGrantUnavailableError} = await import('../../src/app/session-open.js')

const h = (n: number, len = 32) => `0x${n.toString(16).padStart(2, '0').repeat(len)}` as `0x${string}`
const slotA = h(1), slotB = h(2), CHAIN = 43112, EPOCH = 42
// Verifier i signs with the seed [0x10+i; 32]; registry 7, committee 3, quorum 2.
const seeds = Array.from({length: 7}, (_, i) => new Uint8Array(32).fill(0x10 + i))
const beaconSeed = new Uint8Array(32).fill(0x5e), root = h(0x77)
const endpoint = 'https://agent.test', clientId = 'decentralized_identifier:did:web:agent.test'
const profile = {endpoint, clientId, approval: {chainId: CHAIN, registry: h(4, 20), serviceId: h(5), serviceType: 1 as const, owner: h(6, 20), revision: 1n, manifestHash: h(7)}}

function trustFor(slot: `0x${string}`, epoch = EPOCH): SlotDrawTrust {
  const drawn = selectVerifierCommittee(hexToBytes(slot), epoch, beaconSeed, 7, 3)
  const witnesses = drawn.map(index => ({index, operator: h(0x30 + index, 20), publicKey: bytesToHex(ed25519.getPublicKey(seeds[index]!)) as `0x${string}`, proof: []}))
  return {draw: {chain_id: CHAIN, slot, verification_epoch: epoch, verification_seed: bytesToHex(beaconSeed) as `0x${string}`, verification_root: root,
    verification_registry_size: 7, verification_committee: 3, verification_quorum: 2},
  set: {registrySize: 7, pubkeys: new Map(seeds.map((seed, index) => [index, ed25519.getPublicKey(seed)]))}, committee: 3, quorum: 2, seed: beaconSeed, witnesses,
  verifierProofs: witnesses.map(w => ({verifier_index: w.index, operator: w.operator.slice(2), pubkey: w.publicKey.slice(2), proof: []}))}
}

/** What the agent holds for one opened session, built from the SDK's own create request. */
function agentSession(input: {slotId: `0x${string}`; payloadDigest: Uint8Array; sessionGrant: SessionGrantRequestWire}, change: {seed?: Uint8Array; signer?: number; nonceKey?: Uint8Array | null} = {}) {
  const sessionId = 'ab'.repeat(32), exp = Math.floor(Date.now() / 1000) + 600
  const operation = {chain_id: CHAIN, slot_id: input.slotId, action: 'decrypt', payload_digest: bytesToHex(input.payloadDigest), description: 'Open', exp}
  const rh = requestHash(CHAIN, hexToBytes(input.slotId), 'decrypt', input.payloadDigest)
  const thumbprint = sessionKeyThumbprint(input.sessionGrant.session_key), random = new Uint8Array(32).fill(9)
  const reportedSeed = change.seed ?? beaconSeed
  const drawn = selectVerifierCommittee(hexToBytes(input.slotId), EPOCH, beaconSeed, 7, 3)
  const signer = change.signer ?? drawn[beaconSeed[0]! % drawn.length]!
  const nonce = vpNonceBound(rh, random, {epoch: EPOCH, snapshotRoot: hexToBytes(root), registrySize: 7, committee: 3, quorum: 2, operationExp: exp},
    change.nonceKey === null ? undefined : change.nonceKey ?? thumbprint)
  const binding = {operation, random: bytesToHex(random), epoch: EPOCH, seed: bytesToHex(reportedSeed), snapshot_root: root, registry_size: 7, committee_count: 3, quorum: 2,
    drawn, jar_signer_index: drawn[beaconSeed[0]! % drawn.length]!, nonce, session_key_thumbprint: bytesToHex(thumbprint)}
  const claims = {iss: 'did:web:agent.test', client_id: clientId, response_mode: 'direct_post.jwt', response_uri: `${endpoint}/v1/response?session=${sessionId}`, nonce, state: 's', exp, dcql_query: {credentials: []}}
  const signing = `${b64url(JSON.stringify({alg: 'EdDSA', typ: 'oauth-authz-req+jwt'}))}.${b64url(JSON.stringify(claims))}`
  const jwt = `${signing}.${b64url(ed25519.sign(new TextEncoder().encode(signing), seeds[signer]!))}`
  const request = {jwt, header: {alg: 'EdDSA'}, claims, signerDid: 'did:web:agent.test', signerKey: {kty: 'OKP', crv: 'Ed25519', x: ''}} as unknown as VerifiedRequestObject
  const session = {sessionId, pollSecret: 'cd'.repeat(32), requestUri: `${endpoint}/v1/request/${sessionId}`, qrPayload: 'openid4vp://?x', profile, operation, verifierAgentUrl: endpoint,
    requestHash: rh, sessionGrantRequest: input.sessionGrant, recovery: {}, poll: vi.fn(async () => ({status: 'pending', phase: 'awaiting_wallet', bindingPreimage: binding}))}
  return {session, request, thumbprint}
}

let grants = 0
/** A grant for the request's key and slots (a new session id each time), signed by every verifier. */
function grantFor(request: SessionGrantRequestWire, change: {epoch?: number; slots?: string[]} = {}) {
  const now = Math.floor(Date.now() / 1000)
  const payload = sessionGrantPayload({chainId: BigInt(CHAIN), sessionId: new Uint8Array(32).fill(0x50 + (grants++ % 100)), holderHash: new Uint8Array(32).fill(0x48),
    sessionKeyThumbprint: sessionKeyThumbprint(request.session_key), binding: BINDING_HOLDER_KEY, action: 'decrypt', seed: beaconSeed, epoch: BigInt(change.epoch ?? EPOCH),
    slots: (change.slots ?? request.slots).map(s => ({slotId: hexToBytes(s), ruleHash: new Uint8Array(32).fill(0xfe)})), iat: now, exp: now + 30, idleTimeoutSecs: 600, absoluteExp: now + 3600})
  const hash = sessionGrantHash(payload)
  return encodeSessionGrant({payload, signatures: seeds.map((s, i) => ({verifierIndex: i, signature: ed25519.sign(hash, s)}))})
}

const ct = (n: number) => ({ciphertext: {u: new Uint8Array(96).fill(n), nonce: new Uint8Array(12), aeadCt: new Uint8Array([n])}, identity: new TextEncoder().encode('room')})
let sessionChange: Parameters<typeof agentSession>[1]
let pollResult: (request: SessionGrantRequestWire) => unknown
function config(over: Record<string, unknown> = {}) {
  const getKeySlot = vi.fn(async () => ({exists: true, cancelled: false, mode: 1, epoch: 3n, committeeVersion: 1n, threshold: {k: 2, n: 3}, publicKey: '0x01'}))
  const app = {deployment: {chainId: CHAIN, addresses: {KeyRegistry: h(0x21, 20), ThresholdRandomBeacon: h(0x22, 20), VerifierSetRegistry: h(0x23, 20)}},
    chain: {client: {}, readers: {keyRegistry: {getKeySlot}}}} as unknown as Pick<TasraApplication, 'deployment' | 'chain'>
  const present = vi.fn(async () => undefined)
  const signer = {address: h(0x99, 20), signTypedData: vi.fn()}
  return {present, getKeySlot, config: {app, agent: {profile, transport: {} as SessionAgentTransport}, store: createMemoryStore(), signer: signer as never, present, ...over}}
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionChange = {}
  pollResult = request => ({token: {}, sessionGrant: {grant: {session_grant: grantFor(request), refresh_seq: 0}}})
  drawReader.mockImplementation(async (slot: `0x${string}`, epoch: bigint) => trustFor(slot, Number(epoch)))
  readCurrentBeaconEpoch.mockResolvedValue(BigInt(EPOCH)); readBeaconDrawState.mockResolvedValue({latest: BigInt(EPOCH), draw: BigInt(EPOCH)})
  readSlotSharing.mockResolvedValue({chainId: CHAIN, epoch: 3, committeeVersion: 1, threshold: 2, nodeUrls: ['https://k1.test', 'https://k2.test', 'https://k3.test'],
    verifyingShares: new Map([[1, new Uint8Array(144)]]), keepers: [], failures: []})
  let opened: ReturnType<typeof agentSession>
  openRegisteredVerifierAgentSession.mockImplementation(async (_client: unknown, input: Parameters<typeof agentSession>[0]) => { opened = agentSession(input, sessionChange); return opened.session })
  fetchRequestObject.mockImplementation(async () => opened.request)
  awaitRegisteredVerifierAgentResult.mockImplementation(async (session: {sessionGrantRequest: SessionGrantRequestWire}) => pollResult(session.sessionGrantRequest))
  decryptWithSessionGrant.mockImplementation(async (_o: unknown, items: unknown[]) => items.map((_, i) => ({ok: true, plaintext: new Uint8Array([i + 1])})))
})

describe('openDecryptSession: one presentation, then decrypts under the grant, nothing paid', () => {
  it('opens in session mode with ANY signer, checks the request against the chain draw before the wallet step, and decrypts', async () => {
    const f = config()
    const session = await openDecryptSession(f.config, {slots: [slotB, slotA], first: {slot: slotA, ...ct(1)}})
    try {
      const input = openRegisteredVerifierAgentSession.mock.calls[0]![1] as Record<string, unknown> & {sessionGrant: SessionGrantRequestWire; decryption: {ciphertext_epoch: number}}
      expect(input).toMatchObject({chainId: CHAIN, slotId: slotA, action: 'decrypt', signer: f.config.signer})
      expect(input.sessionGrant.slots).toEqual([slotA, slotB])
      expect(input.decryption.ciphertext_epoch).toBe(3)
      // Nothing owner-held and nothing of the retired payment flow is asked of the application.
      for (const field of ['payment', 'random', 'rule', 'ruleSalt', 'execution']) expect(input).not.toHaveProperty(field)
      // The Request Object was read and judged BEFORE the wallet step.
      expect(fetchRequestObject.mock.invocationCallOrder[0]!).toBeLessThan(f.present.mock.invocationCallOrder[0]!)
      expect(drawReader).toHaveBeenCalledWith(slotA, BigInt(EPOCH), undefined)
      expect(session.session.current().epoch).toBe(EPOCH)

      expect(await session.decrypt(slotB, ct(2))).toEqual(new Uint8Array([1]))
      const [options, items] = decryptWithSessionGrant.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>[]]
      expect(options).toMatchObject({slotId: slotB, chainId: CHAIN, threshold: 2, nodeUrls: ['https://k1.test', 'https://k2.test', 'https://k3.test']})
      expect(options.verifierProofs).toEqual(trustFor(slotB).verifierProofs)
      expect(Object.keys(items[0]!).sort()).toEqual(['ciphertext', 'ciphertextEpoch', 'identity', 'recipient'])
      // Many messages: 64 per keeper request, each with its own fresh recipient.
      const many = await session.decryptMany(slotA, Array.from({length: 70}, (_, i) => ct(i)))
      expect(many).toHaveLength(70)
      expect(decryptWithSessionGrant.mock.calls.slice(1).map(c => (c[1] as unknown[]).length)).toEqual([64, 6])
      const recipients = decryptWithSessionGrant.mock.calls.flatMap(c => (c[1] as {recipient: {recipient: {public_key: string}}}[]).map(i => i.recipient.recipient.public_key))
      expect(new Set(recipients).size).toBe(recipients.length)
      await expect(session.decrypt(h(3), ct(3))).rejects.toThrow(/not named by this session/)
      // One presentation served all of it.
      expect(f.present).toHaveBeenCalledTimes(1)
      expect(openRegisteredVerifierAgentSession).toHaveBeenCalledTimes(1)
    } finally { session.stop() }
  })

  it.each([
    ['a seed that is not the beacon\'s', {seed: new Uint8Array(32).fill(0x66)}, /differs from the draw anchored on chain/],
    ['a request signed by another verifier than the one drawn', {signer: 6}, /not signed by the verifier drawn/],
    ['a nonce that names no session key', {nonceKey: null}, /nonce/],
    ['a nonce bound to another session key', {nonceKey: new Uint8Array(32).fill(5)}, /nonce/],
  ] as const)('refuses %s before the wallet step', async (_name, change, message) => {
    sessionChange = change as typeof sessionChange
    const f = config()
    await expect(openDecryptSession(f.config, {slots: [slotA], first: {slot: slotA, ...ct(1)}})).rejects.toThrow(message)
    expect(f.present).not.toHaveBeenCalled()
    expect(awaitRegisteredVerifierAgentResult).not.toHaveBeenCalled()
  })

  it('refuses when the chain does not admit the session\'s draw (epoch not current or previous, or not anchored)', async () => {
    drawReader.mockRejectedValue(new Error('draw epoch 42 is not the beacon\'s latest or previous epoch (50)'))
    const f = config()
    await expect(openDecryptSession(f.config, {slots: [slotA], first: {slot: slotA, ...ct(1)}})).rejects.toThrow(/latest or previous/)
    expect(f.present).not.toHaveBeenCalled()
  })

  it.each([['session_unavailable', false], ['session_context_changed', true]] as const)('a completed presentation without a grant is a typed %s refusal', async (code, retryable) => {
    pollResult = () => ({token: {}, sessionGrant: {error: code}})
    const error = await openDecryptSession(config().config, {slots: [slotA], first: {slot: slotA, ...ct(1)}}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SessionGrantUnavailableError)
    expect(error).toMatchObject({code, retryable})
    pollResult = () => ({token: {}})
    await expect(openDecryptSession(config().config, {slots: [slotA], first: {slot: slotA, ...ct(1)}})).rejects.toMatchObject({code: 'session_grant_missing'})
  })

  it('refuses a grant that names a slot that was not requested, or a draw the chain does not give', async () => {
    pollResult = request => ({token: {}, sessionGrant: {grant: {session_grant: grantFor(request, {slots: [slotA, h(9)]}), refresh_seq: 0}}})
    await expect(openDecryptSession(config().config, {slots: [slotA], first: {slot: slotA, ...ct(1)}})).rejects.toMatchObject({code: 'slot-not-granted'})
    // Signed by verifiers outside the slot's draw only: no quorum of the drawn committee.
    pollResult = request => {
      const wire = grantFor(request), drawn = selectVerifierCommittee(hexToBytes(slotA), EPOCH, beaconSeed, 7, 3)
      return {token: {}, sessionGrant: {grant: {session_grant: {...wire, signatures: wire.signatures.filter(s => drawn.includes(s.verifier_index)).slice(0, 1)}, refresh_seq: 0}}}
    }
    await expect(openDecryptSession(config().config, {slots: [slotA], first: {slot: slotA, ...ct(1)}})).rejects.toMatchObject({code: 'quorum-not-met'})
  })

  it('checks the rule hash only when the application supplies one', async () => {
    const wrong = config({ruleHash: () => new Uint8Array(32).fill(0x11)})
    await expect(openDecryptSession(wrong.config, {slots: [slotA], first: {slot: slotA, ...ct(1)}})).rejects.toMatchObject({code: 'rule-mismatch'})
    const right = await openDecryptSession(config({ruleHash: () => new Uint8Array(32).fill(0xfe)}).config, {slots: [slotA], first: {slot: slotA, ...ct(1)}})
    right.stop()
  })

  it('refuses a first message outside the session\'s slots and an agent of another chain before any request', async () => {
    const f = config()
    await expect(openDecryptSession(f.config, {slots: [slotB], first: {slot: slotA, ...ct(1)}})).rejects.toThrow(/one of the session's slots/)
    await expect(openDecryptSession({...f.config, agent: {...f.config.agent, profile: {...profile, approval: {...profile.approval, chainId: 1}}}}, {slots: [slotA], first: {slot: slotA, ...ct(1)}})).rejects.toThrow(/another chain/)
    expect(openRegisteredVerifierAgentSession).not.toHaveBeenCalled()
  })

  it('with presentAgainOnEnd an ended session is re-opened by one more presentation and the message continues; revoke ends it', async () => {
    const ended: string[] = []
    const walletFetch = vi.fn(() => fetch), keeperUrl = vi.fn((url: string) => url)
    const f = config({walletFetch, keeperUrl, fetchImpl: fetch, allowLocalHttp: true, defaultVerificationPolicy: {committee: 3, quorum: 2}, snapshotHosts: ['https://accountant.test'], delegation: {chain_id: CHAIN} as never})
    const session = await openDecryptSession(f.config, {slots: [slotA], first: {slot: slotA, ...ct(1)}, presentAgainOnEnd: true, accessTtlSecs: 30, idleTimeoutSecs: 900, absoluteTtlSecs: 7200,
      description: 'Read messages', timeoutMs: 1000, onPhase: () => undefined, onEnded: e => ended.push(e.code)})
    expect(walletFetch).toHaveBeenCalledTimes(1)
    expect(openRegisteredVerifierAgentSession.mock.calls[0]![1]).toMatchObject({description: 'Read messages', delegation: {chain_id: CHAIN}})
    expect((openRegisteredVerifierAgentSession.mock.calls[0]![1] as {sessionGrant: SessionGrantRequestWire}).sessionGrant).toMatchObject({access_ttl_secs: 30, idle_timeout_secs: 900, absolute_ttl_secs: 7200})
    const first = session.session
    // The verifiers end the session at its next refresh (a definite refusal): the next message presents again.
    vi.mocked(f.config.agent.transport as unknown as {sessionControlRequest: unknown}).sessionControlRequest = vi.fn(async () =>
      ({status: 409, body: new TextEncoder().encode('{"code":"session_revoked"}')})) as never
    await expect(first.refresh()).rejects.toMatchObject({code: 'session_revoked'})
    expect(ended).toEqual(['session_revoked'])
    expect(await session.decrypt(slotA, ct(2))).toEqual(new Uint8Array([1]))
    expect(f.present).toHaveBeenCalledTimes(2)
    expect(session.session).not.toBe(first)
    // Revoke: acknowledged by the agent with 204, then nothing more is served.
    vi.mocked(f.config.agent.transport as unknown as {sessionControlRequest: unknown}).sessionControlRequest = vi.fn(async () => ({status: 204, body: new Uint8Array()})) as never
    await session.revoke()
    await expect(session.decrypt(slotA, ct(3))).rejects.toMatchObject({code: 'session_revoked'})
    expect(f.present).toHaveBeenCalledTimes(2)
  })

  it('a keeper\'s 402 (the slot balance does not cover its metered work) is a typed refusal of the message', async () => {
    const session = await openDecryptSession(config().config, {slots: [slotA], first: {slot: slotA, ...ct(1)}})
    try {
      const refusals = ['a', 'b', 'c'].map(nodeUrl => ({nodeUrl, status: 402, code: 'payment-required', scope: 'item', message: 'slot balance does not cover unsettled metered work'}))
      decryptWithSessionGrant.mockResolvedValue([{ok: false, error: 'threshold not met', codes: refusals.map(r => r.code), refusals, stale: false}])
      const error = await session.decrypt(slotA, ct(1)).catch((e: unknown) => e)
      expect(error).toMatchObject({name: 'SessionMessageError', slotBalance: true})
      expect(decryptWithSessionGrant).toHaveBeenCalledTimes(1)
    } finally { session.stop() }
  })
})
