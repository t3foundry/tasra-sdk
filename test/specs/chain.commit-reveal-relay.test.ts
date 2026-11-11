import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {createWalletClient, defineChain, http, decodeFunctionData, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {createTasraWriteClient} from '../../src/chain/write.js'
import {keyRegistryAbi} from '../../src/chain/abis/keyRegistry.js'
import {SlotSeedUnavailableError} from '../../src/chain/commitmentRecovery.js'
const SIG = `0x${'5c'.repeat(64)}` as Hex, DIGEST = `0x${'aa'.repeat(32)}` as Hex
/** The accountant set: every ask answered with the seed unless `seedStatus` says otherwise. */
let seedStatus = 200
const seedFetch = vi.fn(async () => ({ok: seedStatus === 200, status: seedStatus, headers: new Headers(),
  json: async () => ({commitment: `0x${'07'.repeat(32)}`, digest: DIGEST, signature: SIG}), text: async () => ''}) as unknown as Response)
const mocks = vi.hoisted(() => ({submit: vi.fn(), read: vi.fn(), receipt: vi.fn(), block: vi.fn()}))
vi.mock('viem', async original => ({...await original<typeof import('viem')>(), createPublicClient: () => ({readContract: mocks.read, waitForTransactionReceipt: mocks.receipt, getBlock: mocks.block})}))
vi.mock('../../src/chain/registeredRelay.js', async original => ({...await original<typeof import('../../src/chain/registeredRelay.js')>(), createRegisteredRelaySubmitter: () => ({submit: mocks.submit})}))
const address = `0x${'11'.repeat(20)}` as const, hash = (v: string) => `0x${v.repeat(32)}` as Hex
const chain = defineChain({id: 31337, name: 'fixture', nativeCurrency: {name: 'ETH', symbol: 'ETH', decimals: 18}, rpcUrls: {default: {http: ['http://localhost:1']}}})
function fixture(withBeacon = true) {
  const wallet = createWalletClient({account: privateKeyToAccount(hash('01')), chain, transport: http()})
  const direct = vi.spyOn(wallet, 'writeContract').mockRejectedValue(new Error('Unexpected direct transaction'))
  const nudge = vi.spyOn(wallet, 'sendTransaction').mockRejectedValue(new Error('Unexpected direct gas payment'))
  const writer = createTasraWriteClient({rpcUrl: 'http://localhost:1', wallet, addresses: {KeyRegistry: address, ...(withBeacon ? {ThresholdRandomBeacon: address} : {}), ServiceRegistry: address}, relay: {forwarder: address, approvals: [{chainId: 31337, registry: address, serviceId: hash('02'), owner: address, serviceType: 0, revision: 1n, manifestHash: hash('03')}], transport: {request: vi.fn(), relayRequest: vi.fn()}}})
  const args = {slotId: hash('04'), salt: hash('05'), ruleSalt: hash('06'), rule: 'verify:demo', k: 2, n: 3, mode: 'bls' as const, accountantUrls: ['http://a'], slotSeedRetryMs: 0}
  return {writer, args, direct, nudge}
}
beforeEach(() => {
  vi.clearAllMocks()
  seedStatus = 200
  vi.stubGlobal('fetch', seedFetch)
  mocks.read.mockImplementation(async ({functionName}: {functionName: string}) => {
    if (functionName === 'computeCommitment') return hash('07')
    if (functionName === 'slotCommits') return [2n, 5n, address, false]
    if (functionName === 'epoch') return 2n
    if (functionName === 'randomBeacon') return address
    if (functionName === 'commitSeedDigest') return DIGEST
    // The pre-send draw guard (resolveDrawTags) reads these. Answered with a pool that COMFORTABLY
    // seats args.n, so these cases exercise the guard's passing path instead of its best-effort
    // swallow — a create that the pool supports must still go straight through.
    if (functionName === 'nodeRegistry') return address
    if (functionName === 'drawActive') return [[], 9n, 0n]
    throw new Error(`Unexpected read ${functionName}`)
  })
  mocks.receipt.mockResolvedValue({status: 'success'})
  mocks.submit.mockImplementation(async (_to, _data, label) => ({id: hash('08'), txHash: label === 'commitKeySlot' ? hash('09') : hash('10')}))
})
afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals()})
it('resolves an omitted beacon from the pinned registry before submitting', async () => {
  const h = fixture(false)
  await h.writer.createSlotCommitReveal(h.args)
  // ⚠ NOT calls[0] any more, and the index is the wrong thing to assert: the pre-send draw guard
  //   now reads nodeRegistry/drawActive first, so pinning position 0 made this test fail for a
  //   reason it does not care about. What it names — the beacon is resolved from the pinned
  //   registry, and before anything is submitted — is what it asserts.
  expect(mocks.read.mock.calls.map(c => c[0]?.functionName)).toContain('randomBeacon')
  expect(mocks.read.mock.calls.find(c => c[0]?.functionName === 'randomBeacon')?.[0]).toMatchObject({address})
  expect(mocks.submit).toHaveBeenCalledTimes(2)
  mocks.submit.mockClear()
  // Target the BEACON read specifically. `mockRejectedValueOnce` used to be unambiguous because the
  // beacon was the first read; it would now land on the guard's probe, which swallows failures by
  // design, and this case would pass while proving nothing.
  const inner = mocks.read.getMockImplementation()!
  mocks.read.mockImplementation(async (arg: {functionName: string}) =>
    arg.functionName === 'randomBeacon' ? Promise.reject(new Error('registry unavailable')) : inner(arg))
  await expect(h.writer.createSlotCommitReveal(h.args)).rejects.toThrow('registry unavailable')
  expect(mocks.submit).not.toHaveBeenCalled()
})
it.each([false, true])('routes commit and reveal through the registered submitter (with policy: %s)', async withPolicy => {
  const h = fixture()
  const result = await h.writer.createSlotCommitReveal({...h.args, ...(withPolicy ? {rulePolicy: {admin: address, guardian: `0x${'22'.repeat(20)}` as const, timelockSecs: 120}} : {})})
  expect(result).toMatchObject({slotId: h.args.slotId, ruleSalt: h.args.ruleSalt, commitTx: hash('09'), revealTx: hash('10'), targetEpoch: 2})
  const calls = mocks.submit.mock.calls.map(([, data]) => decodeFunctionData({abi: keyRegistryAbi, data}))
  expect(calls.map(c => c.functionName)).toEqual(['commitKeySlot', withPolicy ? 'revealKeySlotWithSeedAndPolicy' : 'revealKeySlotWithSeed'])
  expect(calls[1]!.args).toContain(h.args.slotId)
  expect(calls[1]!.args).toContain(h.args.salt)
  expect(h.direct).not.toHaveBeenCalled()
  expect(h.nudge).not.toHaveBeenCalled()
  // No wait means no beacon poll: the target epoch is not something creation waits for.
  expect(mocks.read.mock.calls.map(c => c[0]?.functionName)).not.toContain('epoch')
})
it('propagates an uncertain reveal without a second submit or direct fallback', async () => {
  const h = fixture()
  mocks.submit.mockRejectedValueOnce(new Error('commit unavailable'))
  await expect(h.writer.createSlotCommitReveal(h.args)).rejects.toThrow('commit unavailable')
  expect(mocks.submit).toHaveBeenCalledTimes(1)
  mocks.submit.mockClear()
  mocks.submit.mockResolvedValueOnce({id: hash('08'), txHash: hash('09')}).mockRejectedValueOnce(new Error('unknown relay outcome'))
  await expect(h.writer.createSlotCommitReveal(h.args)).rejects.toThrow('unknown relay outcome')
  expect(mocks.submit).toHaveBeenCalledTimes(2)
  expect(h.direct).not.toHaveBeenCalled()
})
// ⚠⚠ NO BEACON-EPOCH FALLBACK. Without a seed the commitment stands and the caller is told so; the
//    SDK used to commit AGAIN on the epoch path and poll the beacon for up to three minutes here (one
//    to two hours of real wait at the production cadence), nudging chain time on a direct wallet.
it('fails fast with a typed error when no seed can be had, after exactly one commit', async () => {
  const h = fixture()
  seedStatus = 503
  const error = await h.writer.createSlotCommitReveal(h.args).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(SlotSeedUnavailableError)
  expect(error).toMatchObject({retryable: true, detail: {committed: true, slotId: h.args.slotId, commitment: hash('07'), commitTx: hash('09'), expiryEpoch: 5}})
  expect((error as Error).message).toMatch(/commitment .* stands.*recovery\.commitTx/s)
  const sent = mocks.submit.mock.calls.map(([, data]) => decodeFunctionData({abi: keyRegistryAbi, data}).functionName)
  expect(sent).toEqual(['commitKeySlot'])
  expect(mocks.read.mock.calls.map(c => c[0]?.functionName)).not.toContain('epoch')
  expect(h.nudge).not.toHaveBeenCalled()
})

it('refuses before committing when no accountant is known, and says nothing was sent', async () => {
  const h = fixture()
  const error = await h.writer.createSlotCommitReveal({...h.args, accountantUrls: []}).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(SlotSeedUnavailableError)
  expect(error).toMatchObject({detail: {committed: false}})
  expect((error as Error).message).toContain('no commitment was sent')
  expect(mocks.submit).not.toHaveBeenCalled()
  expect(seedFetch).not.toHaveBeenCalled()
})

it('reports an unused expired commitment on resume before asking for a seed or revealing', async () => {
  const h = fixture()
  mocks.read.mockImplementation(async ({functionName}: {functionName: string}) => functionName === 'computeCommitment' ? hash('07') : functionName === 'slotCommits' ? [2n, 5n, h.writer.address, false] : 6n)
  await expect(h.writer.createSlotCommitReveal({...h.args, recovery: {commitTx: hash('09'), onTransaction: vi.fn(async () => {})}})).rejects.toThrow('commitment expired')
  expect(seedFetch).not.toHaveBeenCalled()
  expect(mocks.submit).not.toHaveBeenCalled()
  expect(h.direct).not.toHaveBeenCalled()
})

it('resumes a known commit without sending it again and stops on ambiguous reveal', async () => {
  const h = fixture(), onTransaction = vi.fn(async () => {})
  mocks.read.mockImplementation(async ({functionName}: {functionName: string}) => functionName === 'computeCommitment' ? hash('07') : functionName === 'slotCommits' ? [2n, 5n, h.writer.address, false] : functionName === 'commitSeedDigest' ? DIGEST : 2n)
  mocks.submit.mockRejectedValueOnce(new Error('connection lost after send'))
  await expect(h.writer.createSlotCommitReveal({...h.args, recovery: {commitTx: hash('09'), onTransaction}})).rejects.toThrow('connection lost')
  expect(mocks.submit).toHaveBeenCalledTimes(1)
  expect(onTransaction.mock.calls).toEqual([[{step: 'commit', phase: 'confirmed', hash: hash('09'), seeded: false}], [{step: 'reveal', phase: 'submitting', seeded: true}]])
})
it('reconciles both saved hashes without another transaction', async () => {
  const h = fixture(), onTransaction = vi.fn(async () => {})
  mocks.read.mockImplementation(async ({functionName}: {functionName: string}) => functionName === 'computeCommitment' ? hash('07') : [2n, 5n, h.writer.address, true])
  expect(await h.writer.createSlotCommitReveal({...h.args, recovery: {commitTx: hash('09'), revealTx: hash('10'), seeded: true, onTransaction}})).toMatchObject({commitTx: hash('09'), revealTx: hash('10'), seeded: true})
  expect(mocks.submit).not.toHaveBeenCalled()
})
it.each(['creator', 'used', 'unconsumed'])('refuses inconsistent recovery: %s', async failure => {
  const h = fixture()
  mocks.read.mockImplementation(async ({functionName}: {functionName: string}) => functionName === 'computeCommitment' ? hash('07') : [2n, 5n, failure === 'creator' ? address : h.writer.address, failure === 'used'])
  await expect(h.writer.createSlotCommitReveal({...h.args, recovery: {commitTx: hash('09'), revealTx: failure === 'unconsumed' ? hash('10') : undefined, onTransaction: vi.fn()}})).rejects.toThrow()
  expect(mocks.submit).not.toHaveBeenCalled()
})
