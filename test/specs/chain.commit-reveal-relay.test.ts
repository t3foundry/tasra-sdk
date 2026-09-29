import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {createWalletClient, defineChain, http, decodeFunctionData, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {createTasraWriteClient} from '../../src/chain/write.js'
import {keyRegistryAbi} from '../../src/chain/abis/keyRegistry.js'
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
  const args = {slotId: hash('04'), salt: hash('05'), ruleSalt: hash('06'), rule: 'verify:demo', k: 2, n: 3, mode: 'bls' as const}
  return {writer, args, direct, nudge}
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.read.mockImplementation(async ({functionName}: {functionName: string}) => {
    if (functionName === 'computeCommitment') return hash('07')
    if (functionName === 'slotCommits') return [2n, 5n, address, false]
    if (functionName === 'epoch') return 2n
    if (functionName === 'randomBeacon') return address
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
afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks()})
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
  expect(calls.map(c => c.functionName)).toEqual(['commitKeySlot', withPolicy ? 'revealKeySlotWithPolicy' : 'revealKeySlot'])
  expect(calls[1]!.args).toContain(h.args.slotId)
  expect(calls[1]!.args).toContain(h.args.salt)
  expect(h.direct).not.toHaveBeenCalled()
  expect(h.nudge).not.toHaveBeenCalled()
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
it('does not make direct gas-paying nudges while waiting for the beacon', async () => {
  vi.useFakeTimers()
  const h = fixture()
  mocks.read.mockImplementation(async ({functionName}: {functionName: string}) => functionName === 'computeCommitment' ? hash('07') : functionName === 'slotCommits' ? [2n, 5n, address, false] : 1n)
  const assertion = expect(h.writer.createSlotCommitReveal({...h.args, maxWaitMs: 5000})).rejects.toThrow('beacon did not reach')
  await vi.advanceTimersByTimeAsync(6001)
  await assertion
  expect(mocks.submit).toHaveBeenCalledTimes(1)
  expect(h.direct).not.toHaveBeenCalled()
  expect(h.nudge).not.toHaveBeenCalled()
})

it('reports an unused expired commitment before attempting another reveal', async () => {
  const h = fixture()
  mocks.read.mockImplementation(async ({functionName}: {functionName: string}) => functionName === 'computeCommitment' ? hash('07') : functionName === 'slotCommits' ? [2n, 5n, address, false] : 6n)
  await expect(h.writer.createSlotCommitReveal(h.args)).rejects.toThrow('commitment expired')
  expect(mocks.submit).toHaveBeenCalledTimes(1)
  expect(h.direct).not.toHaveBeenCalled()
})

it('resumes a known commit without sending it again and stops on ambiguous reveal', async () => {
  const h = fixture(), onTransaction = vi.fn(async () => {})
  mocks.read.mockImplementation(async ({functionName}: {functionName: string}) => functionName === 'computeCommitment' ? hash('07') : functionName === 'slotCommits' ? [2n, 5n, h.writer.address, false] : 2n)
  mocks.submit.mockRejectedValueOnce(new Error('connection lost after send'))
  await expect(h.writer.createSlotCommitReveal({...h.args, slotSeed: false, recovery: {commitTx: hash('09'), onTransaction}})).rejects.toThrow('connection lost')
  expect(mocks.submit).toHaveBeenCalledTimes(1)
  expect(onTransaction.mock.calls).toEqual([[{step: 'commit', phase: 'confirmed', hash: hash('09')}], [{step: 'reveal', phase: 'submitting', seeded: false}]])
})
it('nudges an idle beacon while resuming a confirmed direct-wallet commit', async () => {
  const wallet = createWalletClient({account: privateKeyToAccount(hash('01')), chain, transport: http()})
  const direct = vi.spyOn(wallet, 'writeContract').mockResolvedValue(hash('10'))
  let epoch = 1n
  const nudge = vi.spyOn(wallet, 'sendTransaction').mockImplementation(async () => {epoch = 2n; return hash('11')})
  mocks.block.mockResolvedValue({timestamp: BigInt(Math.floor(Date.now() / 1000) - 10)})
  mocks.read.mockImplementation(async ({functionName}: {functionName: string}) => {
    if (functionName === 'computeCommitment') return hash('07')
    if (functionName === 'slotCommits') return [2n, 5n, wallet.account.address, false]
    if (functionName === 'epoch') return epoch
    if (functionName === 'nodeRegistry') return address
    if (functionName === 'drawActive') return [[], 9n, 0n]
    throw new Error(`Unexpected read ${functionName}`)
  })
  const writer = createTasraWriteClient({rpcUrl: 'http://localhost:1', wallet,
    addresses: {KeyRegistry: address, ThresholdRandomBeacon: address}})
  const result = await writer.createSlotCommitReveal({slotId: hash('04'), salt: hash('05'), ruleSalt: hash('06'),
    rule: 'verify:demo', k: 2, n: 3, mode: 'bls', slotSeed: false, maxWaitMs: 7000,
    recovery: {commitTx: hash('09'), onTransaction: vi.fn()}})
  expect(result.revealTx).toBe(hash('10'))
  expect(nudge).toHaveBeenCalledWith({to: wallet.account.address, value: 0n})
  expect(direct).toHaveBeenCalledTimes(1)
}, 12_000)

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
