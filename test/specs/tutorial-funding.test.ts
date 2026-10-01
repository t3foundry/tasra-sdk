import {afterEach, beforeEach, expect, test, vi} from 'vitest'

const doubles = vi.hoisted(() => {
  const writer = Object.fromEntries(['ethBalance', 'eurcBalance', 'tsraBalance', 'settlementBalance',
    'approveEurcForCurve', 'buyTsra', 'fundSlot', 'mintMockEurc'].map(name => [name, vi.fn()]))
  return {writer, loadNetwork: vi.fn(), load: vi.fn(), getSlot: vi.fn(), readContract: vi.fn(), createWriter: vi.fn(),
    slot: '0x' + 'ab'.repeat(32), key: '0x' + 'cd'.repeat(32)}
})
vi.mock('../../examples/network.js', () => ({loadNetwork: doubles.loadNetwork}))
vi.mock('tasra-sdk/app/node', () => ({createFileStore: () => ({load: doubles.load,
  withLock: async (_: string, run: () => Promise<void>) => run()})}))
vi.mock('tasra-sdk/app', () => ({TasraClient: class {
  deployment: {chainId: number; addresses: Record<string, string>}
  constructor(options: {manifest: {addresses?: Record<string, string>}}) {
    this.deployment = {chainId: 43113,
      addresses: {BondingCurve: '0x' + 'ef'.repeat(20), ...options.manifest.addresses}}
  }
  wallets = {create: () => ({address: '0xcreator', wallet: {}})}
  slots = {get: doubles.getSlot}
  chain = {client: {readContract: doubles.readContract}}
}}))
vi.mock('tasra-sdk/chain', () => ({bondingCurveAbi: [], createTasraWriteClient: doubles.createWriter}))
const originalArgs = process.argv
beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  doubles.loadNetwork.mockReturnValue({deployment: {provenance: {manifestSha256: 'trusted'}}})
  doubles.load.mockImplementation(async (key: string) => ({'network-pin': 'trusted', 'creator-key': doubles.key, 'slot-id': doubles.slot}[key]))
  doubles.createWriter.mockReturnValue(doubles.writer)
  doubles.readContract.mockResolvedValue('0x' + 'ab'.repeat(20))
  for (const mock of Object.values(doubles.writer)) mock.mockResolvedValue(1n)
  doubles.writer.fundSlot!.mockResolvedValue({approveTx: 'approve', fundTx: 'fund'})
})
afterEach(() => { process.argv = originalArgs; vi.restoreAllMocks() })
async function run(...args: string[]) {
  process.argv = ['node', 'fund-slot.ts', 'saved-state', ...args]
  await import('../../examples/fund-slot.js')
}
function expectNoWrites() {
  for (const name of ['approveEurcForCurve', 'buyTsra', 'fundSlot', 'mintMockEurc']) expect(doubles.writer[name]).not.toHaveBeenCalled()
}
test('status never mints, buys or funds', async () => {
  await run('status')
  expect(doubles.readContract).toHaveBeenCalledWith(expect.objectContaining({
    address: '0x' + 'ef'.repeat(20), functionName: 'eurc',
  }))
  expect(doubles.createWriter).toHaveBeenCalledWith(expect.objectContaining({addresses: {
    BondingCurve: '0x' + 'ef'.repeat(20), MockEurc: '0x' + 'ab'.repeat(20),
  }}))
  expect(doubles.writer.settlementBalance).toHaveBeenCalledWith(doubles.slot)
  expectNoWrites()
})
test('a conflicting manifest EURC address refuses funding before any write', async () => {
  doubles.readContract.mockResolvedValue('0x' + 'cd'.repeat(20))
  doubles.loadNetwork.mockReturnValue({deployment: {provenance: {manifestSha256: 'trusted'},
    addresses: {BondingCurve: '0x' + 'ef'.repeat(20), MockEurc: '0x' + 'ab'.repeat(20)}}})
  await expect(run('buy', '1000000', '1')).rejects.toThrow('does not match BondingCurve')
  expect(doubles.createWriter).not.toHaveBeenCalled()
  expectNoWrites()
})
test.each([['fund', '0'], ['fund', '-1'], ['fund', '1.5'], ['buy', '1000000', '0'], ['buy', '1000000'], ['fund', (2n ** 256n).toString()]])('invalid spend %j is rejected before reading a network', async (...args) => {
  await expect(run(...args)).rejects.toThrow()
  expect(doubles.loadNetwork).not.toHaveBeenCalled()
  expectNoWrites()
})
test('changed manifest refuses saved keys and funds', async () => {
  doubles.loadNetwork.mockReturnValue({deployment: {provenance: {manifestSha256: 'different'}}})
  await expect(run('fund', '1')).rejects.toThrow('State does not match')
  expect(doubles.createWriter).not.toHaveBeenCalled()
  expectNoWrites()
})
test('unknown or cancelled slot refuses deposit', async () => {
  doubles.getSlot.mockRejectedValue(new Error('Unknown or cancelled slot'))
  await expect(run('fund', '1')).rejects.toThrow('Unknown or cancelled')
  expectNoWrites()
})
test('buy preserves explicit budget and minimum; never deposits or retries', async () => {
  doubles.writer.buyTsra!.mockRejectedValue(new Error('Uncertain purchase'))
  await expect(run('buy', '1000000', '2000000000000000000')).rejects.toThrow('Uncertain purchase')
  expect(doubles.writer.approveEurcForCurve).toHaveBeenCalledWith(1000000n)
  expect(doubles.writer.buyTsra).toHaveBeenCalledExactlyOnceWith(1000000n, 2000000000000000000n)
  expect(doubles.writer.fundSlot).not.toHaveBeenCalled()
  expect(doubles.writer.mintMockEurc).not.toHaveBeenCalled()
})
test('deposit targets the explicit slot and exact amount without a purchase', async () => {
  const other = '0x' + 'ef'.repeat(32)
  await run('fund', '100', '--slot', other)
  expect(doubles.getSlot).toHaveBeenCalledWith(other)
  expect(doubles.writer.fundSlot).toHaveBeenCalledExactlyOnceWith(other, 100n)
  expect(doubles.writer.buyTsra).not.toHaveBeenCalled()
  expect(doubles.writer.mintMockEurc).not.toHaveBeenCalled()
})
