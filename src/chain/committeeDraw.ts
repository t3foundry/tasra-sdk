// One block for the whole committee draw (robustness audit 2026-11-13, P6).
//
// A draw is (slot, epoch, seed) over the epoch's anchored verifier snapshot. Read as separate
// `latest` calls, a beacon push between them paired epoch N with seed N+1 - a draw no verifier
// derives - and a failed snapshot read silently fell back to the directory size, which no
// verifier uses either. Here the beacon epoch, its seed and its snapshot are read at ONE block
// hash (EIP-1898, `requireCanonical`), choosing the newest epoch anchored at that block, as payment
// discovery does. A missing anchor or a failed read is an error, never a substitute.

import {decodeFunctionResult, encodeFunctionData, type Address, type Hex, type PublicClient} from 'viem'
import {thresholdRandomBeaconAbi} from './abis/thresholdRandomBeacon.js'
import {verifierSetRegistryAbi} from './abis/verifierSetRegistry.js'
import type {CommitteeDraw} from '../committee/request.js'

const ZERO32 = /^0x0{64}$/i

/**
 * A `CommitteeChainReads.drawAt` reading the beacon epoch, its seed and its anchored verifier
 * snapshot at one canonical block. `epochLag` 1 pins the previous epoch; with 0 the latest epoch is
 * used when it is anchored at that block, else the previous one (its anchor lags the beacon push by
 * a settle tick; keepers and verifiers admit both).
 * @param client - Read client for the deployment.
 * @param beacon - ThresholdRandomBeacon address.
 * @param verifierSet - VerifierSetRegistry address.
 */
export function oneBlockDraw(client: PublicClient, beacon: Address, verifierSet: Address): (epochLag?: number) => Promise<CommitteeDraw> {
  return async (epochLag = 0) => {
    const head = await client.getBlock({blockTag: 'latest'})
    if (head.hash === null) throw new Error('committee draw: latest block has no hash')
    const blockHash = head.hash
    const call = async (to: Address, data: Hex) => {
      const result = await client.call({to, data, blockHash, requireCanonical: true, batch: false})
      if (result.data === undefined) throw new Error('committee draw: empty chain read')
      return result.data
    }
    const latest = decodeFunctionResult({abi: thresholdRandomBeaconAbi, functionName: 'epoch',
      data: await call(beacon, encodeFunctionData({abi: thresholdRandomBeaconAbi, functionName: 'epoch'}))})
    const at = async (epoch: bigint) => {
      const [seed, snapshot] = await Promise.all([
        call(beacon, encodeFunctionData({abi: thresholdRandomBeaconAbi, functionName: 'seedAt', args: [epoch]}))
          .then(data => decodeFunctionResult({abi: thresholdRandomBeaconAbi, functionName: 'seedAt', data})),
        call(verifierSet, encodeFunctionData({abi: verifierSetRegistryAbi, functionName: 'snapshotAt', args: [epoch]}))
          .then(data => decodeFunctionResult({abi: verifierSetRegistryAbi, functionName: 'snapshotAt', data}) as unknown as readonly [Hex, bigint | number]),
      ])
      const [root, size] = snapshot
      const anchored = !ZERO32.test(seed) && !ZERO32.test(root) && Number(size) > 0
      return anchored ? {epoch: Number(epoch), seed, root, size: Number(size)} : undefined
    }
    const lag = BigInt(Math.max(0, Math.min(1, Math.floor(epochLag))))
    let epoch = latest >= lag ? latest - lag : 0n
    let draw = await at(epoch)
    if (!draw && lag === 0n && epoch > 0n) draw = await at(--epoch)
    if (!draw) throw new Error(`committee draw: no anchored seed and verifier snapshot at epoch ${epoch} (block ${blockHash})`)
    return {...draw, blockHash}
  }
}
