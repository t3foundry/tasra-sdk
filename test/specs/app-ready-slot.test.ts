import {beforeEach, describe, expect, it, vi} from 'vitest'
import {createWalletClient, defineChain, http, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {ApplicationSlotRecoveryError, createApplicationSlot, type ApplicationStore, type CreateApplicationSlot, type ReadySlotJournal, type SlotCreationProgress} from '../../src/app/ready-slot.js'
import {ruleCommitment} from '../../src/chain/write.js'
import {createTasra} from '../../src/app/client.js'
import type {TasraChainClient} from '../../src/chain/client.js'

const mocks = vi.hoisted(() => ({create: vi.fn(), provision: vi.fn(), policy: vi.fn()}))
vi.mock('../../src/chain/provisionRule.js', () => ({provisionRule: mocks.provision}))
vi.mock('../../src/chain/discovery.js', () => ({resolveSlotKeeperUrls: async () => ['http://keeper:8080']}))
vi.mock('../../src/chain/write.js', async importOriginal => ({...await importOriginal<typeof import('../../src/chain/write.js')>(), createTasraWriteClient: () => ({pub: {getChainId: async () => 43112}, createSlotCommitReveal: mocks.create, setVerifierPolicy: mocks.policy})}))
const hex = (v: string) => `0x${v.repeat(32)}` as Hex
const deployment = {schemaVersion: 1 as const, name: 'local', rpcUrl: 'http://localhost:1', chainId: 43112, coordinator: 'lowest-operator-id' as const,
  addresses: {KeyRegistry: `0x${'11'.repeat(20)}` as Hex, NodeRegistry: `0x${'22'.repeat(20)}` as Hex}}
const signer = privateKeyToAccount(hex('01'))
const wallet = createWalletClient({account: signer, transport: http(deployment.rpcUrl), chain: defineChain({id: 43112, name: 'test', nativeCurrency: {name: 'AVAX', symbol: 'AVAX', decimals: 18}, rpcUrls: {default: {http: [deployment.rpcUrl]}}})})
const request: CreateApplicationSlot = {name: 'notes', mode: 'bls', policy: JSON.stringify({credentials: [{id: 'employee', format: 'dc+sd-jwt', meta: {vct_values: ['Employee']}, claims: [{path: ['iss'], values: ['did:example:issuer']}]}]}), threshold: {k: 2, n: 3}, verifiers: {committee: 3, quorum: 2}}
const oauthQuery = {id: 'login', format: 'oauth+access-token+dpop', meta: {max_age_secs: 300}, claims: [{path: ['iss'], values: ['https://idp.example']}, {path: ['aud', null], values: ['tasra']}] }
const oauthRequest: CreateApplicationSlot = {...request, authType: 'oauth', policy: JSON.stringify({credentials: [oauthQuery]})}
function fixture() {
  const data = new Map<string, unknown>()
  const save = vi.fn(async (key: string, value: unknown) => {data.set(key, structuredClone(value))})
  const store: ApplicationStore = {load: async <T>(key: string) => structuredClone(data.get(key)) as T | undefined, save, withLock: async (_key, run) => run()}
  const metadata = {auth: 1, exists: true, cancelled: false, mode: 1, epoch: 1, threshold: {k: 2, n: 3}, publicKey: '0x1234'}
  const chain = {addresses: deployment.addresses, client: {getChainId: async () => 43112, getCode: async () => '0x01', waitForTransactionReceipt: vi.fn(async () => ({status: 'success'}))},
    readers: {keyRegistry: {getKeySlot: vi.fn(async () => {const saved = data.get('slot-notes') as ReadySlotJournal; return {...metadata, creator: signer.address, ruleCommitment: ruleCommitment(saved.creation.intent.ruleSalt, saved.request.policy)}}), verifierPolicy: vi.fn(async () => [3, 2])}}}
  const app = createTasra({deployment, chain: chain as unknown as TasraChainClient})
  return {data, store, metadata, app, chain, options: {wallet, signer, store, keeperUrl: () => 'http://localhost:8091'}}
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.create.mockImplementation(async args => {
    await args.recovery.onTransaction({step: 'commit', phase: 'confirmed', hash: hex('02')})
    await args.recovery.onTransaction({step: 'reveal', phase: 'confirmed', hash: hex('03')})
    return {slotId: args.slotId, ruleSalt: args.ruleSalt}
  })
  mocks.provision.mockResolvedValue({})
  mocks.policy.mockImplementation(async (_id, _committee, _quorum, persist) => {
    await persist({phase: 'submitting'})
    await persist({phase: 'submitted', hash: hex('04')})
    await persist({phase: 'confirmed', hash: hex('04')})
    return hex('04')
  })
})
describe('ready application slot', () => {
  it('creates and resumes OAuth slots with the selected authorization family and generic rule', async () => {
    const f = fixture()
    f.metadata.auth = 2
    const slotId = await createApplicationSlot(f.app, oauthRequest, f.options)
    expect(await createApplicationSlot(f.app, oauthRequest, f.options)).toBe(slotId)
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({authType: 'oauth', rule: oauthRequest.policy}))
    expect(mocks.provision).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({rule: oauthRequest.policy}))
    const saved = f.data.get('slot-notes') as ReadySlotJournal
    expect(saved.request.authType).toBe('oauth')
    expect(saved.creation.intent.authType).toBe('oauth')
  })
  it.each<[string, unknown]>([
    ['OAuth rule with default OID4VP', {...oauthRequest, authType: undefined}],
    ['credential rule with OAuth', {...request, authType: 'oauth'}],
    ['unknown authorization family', {...request, authType: 'other'}],
    ...(['oid4vp', 'oauth'] as const).map(authType => ['mixed rule with ' + authType, {...request, authType, policy: JSON.stringify({credentials: [(JSON.parse(request.policy) as {credentials: unknown[]}).credentials[0], oauthQuery]})}] as [string, unknown]),
  ])('rejects %s before locking or persisting', async (_label, input) => {
    const f = fixture()
    const lock = vi.spyOn(f.store, 'withLock')
    await expect(createApplicationSlot(f.app, input as CreateApplicationSlot, f.options)).rejects.toThrow('authorization')
    expect(lock).not.toHaveBeenCalled()
    expect(f.store.save).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it.each([
    {dcqlRule: request.policy},
    {rule: request.policy, dcqlRule: request.policy},
    {rule: request.policy, dcqlRule: 'different'},
    {rule: request.policy, dcqlRule: undefined},
  ])('rejects an old rule property in a ready journal without rewriting or performing I/O: %j', async fields => {
    const f = fixture()
    await createApplicationSlot(f.app, request, f.options)
    const saved = f.data.get('slot-notes') as ReadySlotJournal
    const {rule: _rule, ...intent} = saved.creation.intent
    saved.creation.intent = {...intent, ...fields} as never
    const before = structuredClone(saved)
    vi.clearAllMocks()
    const chainId = vi.spyOn(f.chain.client, 'getChainId')
    await expect(createApplicationSlot(f.app, request, f.options)).rejects.toThrow(/rule/i)
    expect(f.data.get('slot-notes')).toEqual(before)
    expect(f.store.save).not.toHaveBeenCalled()
    expect(chainId).not.toHaveBeenCalled()
    expect(f.chain.readers.keyRegistry.getKeySlot).not.toHaveBeenCalled()
    expect(mocks.provision).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.policy).not.toHaveBeenCalled()
  })
  it('rejects an altered authorization family in the saved request before provisioning', async () => {
    const f = fixture()
    await createApplicationSlot(f.app, request, f.options)
    const saved = f.data.get('slot-notes') as ReadySlotJournal
    saved.request.authType = 'oauth'
    await expect(createApplicationSlot(f.app, request, f.options)).rejects.toThrow('intent differs')
    expect(mocks.provision).toHaveBeenCalledTimes(1)
  })
  it('rejects an altered authorization family in the creation journal before provisioning', async () => {
    const f = fixture()
    await createApplicationSlot(f.app, request, f.options)
    const saved = f.data.get('slot-notes') as ReadySlotJournal
    saved.creation.intent.authType = 'oauth'
    await expect(createApplicationSlot(f.app, request, f.options)).rejects.toThrow('different creator, deployment or policy')
    expect(mocks.provision).toHaveBeenCalledTimes(1)
  })
  it('rejects an unexpected on-chain authorization family before provisioning', async () => {
    const f = fixture()
    f.metadata.auth = 2
    await expect(createApplicationSlot(f.app, request, f.options)).rejects.toThrow('On-chain slot changed')
    expect(mocks.provision).not.toHaveBeenCalled()
  })
  it('rejects malformed access policies before taking a lock or writing state', async () => {
    const f = fixture()
    const lock = vi.spyOn(f.store, 'withLock')
    await expect(createApplicationSlot(f.app, {...request, policy: 'typo not a rule'}, f.options)).rejects.toThrow()
    expect(lock).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('rejects a different provisioning signer before taking any action', async () => {
    const f = fixture()
    await expect(createApplicationSlot(f.app, request, {...f.options, signer: privateKeyToAccount(hex('05'))})).rejects.toThrow('Provisioning signer differs')
    expect(f.store.save).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('creates, provisions and resumes the same usable slot without repeat writes', async () => {
    const f = fixture()
    const first = await createApplicationSlot(f.app, request, f.options)
    expect(await createApplicationSlot(f.app, request, f.options)).toBe(first)
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.provision).toHaveBeenCalledTimes(2)
    expect(mocks.provision).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({slotId: first, keeperUrls: ['http://localhost:8091']}))
    expect(mocks.policy).toHaveBeenCalledTimes(1)
  })
  it('reports public milestones after persistence on a fresh creation and on resume', async () => {
    const f = fixture()
    const events: unknown[] = []
    const onProgress = vi.fn((event: unknown) => {
      const saved = f.data.get('slot-notes') as ReadySlotJournal
      expect(saved).toBeDefined()
      if (typeof event === 'object' && event && 'step' in event && event.step === 'commit') expect(saved.creation.commit?.phase).toBe('confirmed')
      events.push(event)
    })
    const slotId = await createApplicationSlot(f.app, request, {...f.options, onProgress})
    expect(events).toEqual([
      {step: 'commit', phase: 'confirmed', slotId, transactionHash: hex('02')},
      {step: 'reveal', phase: 'confirmed', slotId, transactionHash: hex('03')},
      {step: 'key_generation', phase: 'complete', slotId},
      {step: 'rule_provisioning', phase: 'waiting', slotId},
      {step: 'rule_provisioning', phase: 'complete', slotId},
      {step: 'verifier_policy', phase: 'submitting', slotId},
      {step: 'verifier_policy', phase: 'submitted', slotId, transactionHash: hex('04')},
      {step: 'verifier_policy', phase: 'confirmed', slotId, transactionHash: hex('04')},
      {step: 'ready', phase: 'complete', slotId},
    ])
    expect(JSON.stringify(events)).not.toContain(request.policy)
    events.length = 0
    await createApplicationSlot(f.app, request, {...f.options, onProgress})
    expect(events).toEqual([
      {step: 'key_generation', phase: 'complete', slotId},
      {step: 'rule_provisioning', phase: 'waiting', slotId},
      {step: 'rule_provisioning', phase: 'complete', slotId},
      {step: 'ready', phase: 'complete', slotId},
    ])
  })
  it('does not let a progress observer break creation or cause a duplicate transaction', async () => {
    const f = fixture()
    const onProgress = vi.fn(() => {throw new Error('UI failed')})
    await createApplicationSlot(f.app, request, {...f.options, onProgress})
    await createApplicationSlot(f.app, request, {...f.options, onProgress})
    expect(onProgress).toHaveBeenCalled()
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.policy).toHaveBeenCalledTimes(1)
  })
  it('persists the intent before any transaction and refuses failed storage', async () => {
    const f = fixture()
    vi.mocked(f.store.save).mockRejectedValue(new Error('disk full'))
    await expect(createApplicationSlot(f.app, request, f.options)).rejects.toThrow('disk full')
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('retries failed provisioning on the same slot without another commit/reveal', async () => {
    const f = fixture()
    mocks.provision.mockRejectedValueOnce(new Error('one keeper unavailable'))
    await expect(createApplicationSlot(f.app, request, f.options)).rejects.toThrow('one keeper unavailable')
    expect(mocks.policy).not.toHaveBeenCalled()
    await createApplicationSlot(f.app, request, f.options)
    expect(mocks.create).toHaveBeenCalledTimes(1)
    expect(mocks.provision).toHaveBeenCalledTimes(2)
  })
  it('never resubmits a verifier-policy transaction with unknown outcome', async () => {
    const f = fixture()
    mocks.policy.mockImplementationOnce(async (_id, _c, _q, persist) => {await persist({phase: 'submitting'}); throw new Error('connection lost')})
    const firstFailure: unknown = await createApplicationSlot(f.app, request, f.options).then(() => undefined, error => error)
    expect(firstFailure).toBeInstanceOf(ApplicationSlotRecoveryError)
    expect(firstFailure).toMatchObject({
      code: 'VERIFIER_POLICY_OUTCOME_UNKNOWN', recoveryName: request.name, retryable: false,
      cause: expect.objectContaining({message: 'connection lost'}),
    } satisfies Partial<ApplicationSlotRecoveryError>)
    await expect(createApplicationSlot(f.app, request, f.options)).rejects.toMatchObject({
      code: 'VERIFIER_POLICY_OUTCOME_UNKNOWN', recoveryName: request.name,
      slotId: (f.data.get('slot-notes') as ReadySlotJournal).creation.intent.slotId,
      retryable: false,
    } satisfies Partial<ApplicationSlotRecoveryError>)
    expect(mocks.policy).toHaveBeenCalledTimes(1)
  })
  it('reports a reverted verifier-policy receipt with its original hash and does not resubmit', async () => {
    const f = fixture()
    mocks.policy.mockImplementationOnce(async (_id, _c, _q, persist) => {await persist({phase: 'submitted', hash: hex('04')}); throw new Error('timeout')})
    await expect(createApplicationSlot(f.app, request, f.options)).rejects.toMatchObject({
      code: 'VERIFIER_POLICY_RECEIPT_PENDING', transactionHash: hex('04'), retryable: false,
      cause: expect.objectContaining({message: 'timeout'}),
    } satisfies Partial<ApplicationSlotRecoveryError>)
    f.chain.client.waitForTransactionReceipt.mockResolvedValueOnce({status: 'reverted'})
    await expect(createApplicationSlot(f.app, request, f.options)).rejects.toMatchObject({
      code: 'VERIFIER_POLICY_REVERTED', recoveryName: request.name, transactionHash: hex('04'), retryable: false,
    } satisfies Partial<ApplicationSlotRecoveryError>)
    expect(mocks.policy).toHaveBeenCalledTimes(1)
  })
  it('waits for a saved policy hash after receipt failure without signing again', async () => {
    const f = fixture()
    mocks.policy.mockImplementationOnce(async (_id, _c, _q, persist) => {await persist({phase: 'submitted', hash: hex('04')}); throw new Error('timeout')})
    await expect(createApplicationSlot(f.app, request, f.options)).rejects.toMatchObject({
      code: 'VERIFIER_POLICY_RECEIPT_PENDING', transactionHash: hex('04'), retryable: false,
    } satisfies Partial<ApplicationSlotRecoveryError>)
    const onProgress = vi.fn()
    await createApplicationSlot(f.app, request, {...f.options, onProgress})
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({step: 'verifier_policy', phase: 'submitted', transactionHash: hex('04')}))
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({step: 'verifier_policy', phase: 'confirmed', transactionHash: hex('04')}))
    expect(f.chain.client.waitForTransactionReceipt).toHaveBeenCalledWith(expect.objectContaining({hash: hex('04')}))
    expect(mocks.policy).toHaveBeenCalledTimes(1)
  })
  it('rejects a different policy or deployment for an existing recovery name', async () => {
    const f = fixture()
    await createApplicationSlot(f.app, request, f.options)
    await expect(createApplicationSlot(f.app, {...request, policy: request.policy.replace('Employee', 'OtherType')}, f.options)).rejects.toMatchObject({
      code: 'SAVED_INTENT_MISMATCH', recoveryName: request.name, retryable: false,
    } satisfies Partial<ApplicationSlotRecoveryError>)
    const saved = f.data.get('slot-notes') as ReadySlotJournal
    saved.creation.deployment.addresses.KeyRegistry = deployment.addresses.NodeRegistry
    await expect(createApplicationSlot(f.app, request, f.options)).rejects.toThrow('different creator, deployment or policy')
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })
  it('does not report readiness with a different on-chain verifier policy', async () => {
    const f = fixture()
    f.chain.readers.keyRegistry.verifierPolicy.mockResolvedValue([3, 1])
    await expect(createApplicationSlot(f.app, request, f.options)).rejects.toMatchObject({
      code: 'VERIFIER_POLICY_MISMATCH', recoveryName: request.name, retryable: false,
    } satisfies Partial<ApplicationSlotRecoveryError>)
  })
  it('rejects an altered threshold on resume before provisioning', async () => {
    const f = fixture()
    await createApplicationSlot(f.app, request, f.options)
    f.metadata.threshold.k = 1
    await expect(createApplicationSlot(f.app, request, f.options)).rejects.toMatchObject({
      code: 'SLOT_STATE_MISMATCH', recoveryName: request.name, retryable: false,
    } satisfies Partial<ApplicationSlotRecoveryError>)
    expect(mocks.provision).toHaveBeenCalledTimes(1)
  })
  it('honors cancellation while waiting for key generation without provisioning', async () => {
    const f = fixture()
    f.metadata.publicKey = '0x'
    const controller = new AbortController()
    const onProgress = vi.fn((event: SlotCreationProgress) => {
      if (event.step === 'key_generation' && event.phase === 'waiting') queueMicrotask(() => controller.abort())
    })
    await expect(createApplicationSlot(f.app, request, {...f.options, signal: controller.signal, onProgress})).rejects.toMatchObject({name: 'AbortError'})
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({step: 'key_generation', phase: 'waiting'}))
    expect(mocks.provision).not.toHaveBeenCalled()
  })
})
