// P6 (robustness audit 2026-11-13): the committee draw - beacon epoch, its seed and its anchored
// verifier snapshot - is read at ONE block hash, never as separate `latest` reads.
import {expect, it} from 'vitest'
import {createPublicClient, custom, decodeFunctionData, defineChain, encodeFunctionResult, type Abi, type Hex} from 'viem'
import {oneBlockDraw} from '../../src/chain/committeeDraw.js'
import {thresholdRandomBeaconAbi} from '../../src/chain/abis/thresholdRandomBeacon.js'
import {verifierSetRegistryAbi} from '../../src/chain/abis/verifierSetRegistry.js'

const h = (n: number, length = 32): Hex => `0x${n.toString(16).padStart(2, '0').repeat(length)}`
const BEACON = h(0xbe, 20), SET = h(0x5e, 20)
const chain = defineChain({id: 43112, name: 'local', nativeCurrency: {name: 'AVAX', symbol: 'AVAX', decimals: 18}, rpcUrls: {default: {http: ['http://127.0.0.1:1']}}})

/** A chain at block 0x77 whose beacon is at `latest` and whose anchored epochs are `anchored`. */
function client(latest: bigint, anchored: bigint[]) {
  const pinned: unknown[] = []
  const request = async ({method, params}: {method: string; params?: unknown}) => {
    if (method === 'eth_getBlockByNumber') return {number: '0x77', hash: h(0x77), timestamp: '0x3e8', transactions: []}
    if (method !== 'eth_call') throw new Error(`unexpected ${method}`)
    const [call, block] = params as [{to: Hex; data: Hex}, unknown]
    pinned.push(block)
    const abi = (call.to.toLowerCase() === BEACON ? thresholdRandomBeaconAbi : verifierSetRegistryAbi) as Abi
    const {functionName, args} = decodeFunctionData({abi, data: call.data})
    const epoch = args?.[0] as bigint | undefined
    const has = epoch !== undefined && anchored.includes(epoch)
    if (functionName === 'epoch') return encodeFunctionResult({abi, functionName, result: latest})
    if (functionName === 'seedAt') return encodeFunctionResult({abi, functionName, result: has ? h(Number(epoch)) : h(0)})
    return encodeFunctionResult({abi, functionName, result: has ? [h(0x40 + Number(epoch)), 5n] : [h(0), 0n]})
  }
  return {client: createPublicClient({chain, transport: custom({request}, {retryCount: 0})}), pinned}
}

it('reads epoch, seed and snapshot at one block hash, canonical only', async () => {
  const {client: c, pinned} = client(7n, [6n, 7n])
  const draw = await oneBlockDraw(c, BEACON, SET)()
  expect(draw).toEqual({epoch: 7, seed: h(7), root: h(0x47), size: 5, blockHash: h(0x77)})
  expect(pinned.length).toBe(3)
  for (const block of pinned) expect(block).toEqual({blockHash: h(0x77), requireCanonical: true})
})

it('draws on the previous epoch while the latest is not anchored at that block, and refuses with neither', async () => {
  const {client: lag} = client(7n, [6n])
  expect((await oneBlockDraw(lag, BEACON, SET)()).epoch).toBe(6)
  expect((await oneBlockDraw(lag, BEACON, SET)(1)).epoch).toBe(6)
  const {client: none} = client(7n, [])
  await expect(oneBlockDraw(none, BEACON, SET)()).rejects.toThrow(/no anchored seed and verifier snapshot/)
})
