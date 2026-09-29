// The pre-send FILTERED-draw guard, driven through `createSlot`/`createSlotCommitReveal` rather
// than through its predicate.
//
// ⚠⚠ A GATE'S REGRESSION TEST MUST DRIVE THE ENTRY POINT, NOT THE HELPER. `filteredDrawCannotSeat`
//    has its own unit test; that one would stay green if `resolveDrawTags` stopped calling it, which
//    is exactly the regression worth catching — the tagged branch used to return before reading the
//    pool at all, so the predicate existing is not the same thing as the create consulting it.
import {beforeEach, expect, it, vi} from 'vitest'
import {createWalletClient, defineChain, http, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {createTasraWriteClient} from '../../src/chain/write.js'

const mocks = vi.hoisted(() => ({submit: vi.fn(), read: vi.fn(), receipt: vi.fn()}))
vi.mock('viem', async original => ({...await original<typeof import('viem')>(), createPublicClient: () => ({readContract: mocks.read, waitForTransactionReceipt: mocks.receipt})}))
vi.mock('../../src/chain/registeredRelay.js', async original => ({...await original<typeof import('../../src/chain/registeredRelay.js')>(), createRegisteredRelaySubmitter: () => ({submit: mocks.submit})}))

const address = `0x${'11'.repeat(20)}` as const
const hash = (v: string) => `0x${v.repeat(32)}` as Hex
const chain = defineChain({id: 31337, name: 'fixture', nativeCurrency: {name: 'ETH', symbol: 'ETH', decimals: 18}, rpcUrls: {default: {http: ['http://localhost:1']}}})

/** `candidates` is what `drawActive` reports as the tagged-active pool; everything else is scenery. */
function fixture(candidates: bigint | Error) {
  mocks.read.mockImplementation(async ({functionName}: {functionName: string}) => {
    if (functionName === 'nodeRegistry') return address
    if (functionName === 'drawActive') {
      if (candidates instanceof Error) throw candidates
      return [[], candidates, 0n]
    }
    if (functionName === 'computeCommitment') return hash('07')
    if (functionName === 'slotCommits') return [2n, 5n, address, false]
    if (functionName === 'epoch') return 2n
    if (functionName === 'randomBeacon') return address
    if (functionName === 'activeCount') return candidates instanceof Error ? 0n : candidates
    throw new Error(`Unexpected read ${functionName}`)
  })
  const wallet = createWalletClient({account: privateKeyToAccount(hash('01')), chain, transport: http()})
  vi.spyOn(wallet, 'writeContract').mockRejectedValue(new Error('Unexpected direct transaction'))
  vi.spyOn(wallet, 'sendTransaction').mockRejectedValue(new Error('Unexpected direct gas payment'))
  const writer = createTasraWriteClient({rpcUrl: 'http://localhost:1', wallet, addresses: {KeyRegistry: address, NodeRegistry: address, ThresholdRandomBeacon: address, ServiceRegistry: address}, relay: {forwarder: address, approvals: [{chainId: 31337, registry: address, serviceId: hash('02'), owner: address, serviceType: 0, revision: 1n, manifestHash: hash('03')}], transport: {request: vi.fn(), relayRequest: vi.fn()}}})
  return {writer, args: {slotId: hash('04'), salt: hash('05'), ruleSalt: hash('06'), rule: 'verify:demo', k: 3, n: 5, mode: 'bls' as const}}
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.receipt.mockResolvedValue({status: 'success'})
  mocks.submit.mockImplementation(async (_to: unknown, _data: unknown, label: string) => ({id: hash('08'), txHash: label === 'commitKeySlot' ? hash('09') : hash('10')}))
})

it('refuses a tagged create the pool cannot seat, before anything is sent', async () => {
  // The shortfall measured on the local fleet: 4 tagged-ACTIVE keepers, a slot asking for 5.
  const h = fixture(4n)
  await expect(h.writer.createSlot(h.args)).rejects.toThrow(/InsufficientFilteredPool\(4, 5\)/)
  // BEFORE ANYTHING IS SENT is half the point: on-chain the slot is created and paid for.
  expect(mocks.submit).not.toHaveBeenCalled()
})

it('refuses the commit too, not just the reveal', async () => {
  // Where the real revert landed, and why refusing late is not enough: commit-reveal pays for the
  // commit, then surfaces the shortfall at `revealKeySlot` a beacon epoch later.
  const h = fixture(4n)
  await expect(h.writer.createSlotCommitReveal(h.args)).rejects.toThrow(/InsufficientFilteredPool\(4, 5\)/)
  expect(mocks.submit).not.toHaveBeenCalled()
})

it('names the shortfall in terms the caller can act on', async () => {
  const h = fixture(4n)
  const err = await h.writer.createSlot(h.args).catch((e: Error) => e)
  // The tag it filtered on, so a caller with several tags knows which pool is short...
  expect(String(err)).toContain('"keykeeper"')
  // ...and the trap that produces this, because HTTP health is the wrong thing to size n from.
  expect(String(err)).toMatch(/answering HTTP is not necessarily ACTIVE/)
})

it('lets a pool that exactly fits through', async () => {
  // n == candidates is seatable. A guard that refused here would break every fleet deliberately
  // sized to its keeper count — the commonest shape there is.
  const h = fixture(5n)
  await expect(h.writer.createSlot(h.args)).resolves.toMatchObject({slotId: h.args.slotId})
  expect(mocks.submit).toHaveBeenCalled()
})

it('sends anyway when the pool cannot be read', async () => {
  // BEST EFFORT, DELIBERATELY: this guard exists to improve a message. If it became a new way to
  // fail — an RPC hiccup, a deployment whose registry will not answer — it would cost more than
  // the revert it replaces. The chain stays the authority.
  const h = fixture(new Error('registry unavailable'))
  await expect(h.writer.createSlot(h.args)).resolves.toMatchObject({slotId: h.args.slotId})
  expect(mocks.submit).toHaveBeenCalled()
})
