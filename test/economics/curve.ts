// E2E: ECONOMICS — bonding-curve funding on the prod fleet.
//
// The production way a client acquires TSRA: buy on the sigmoid bonding curve
// with EURC (not a deployer hand-out). We mint EURC, buy TSRA, and assert the
// curve invariants (inventory transfer, reserve growth, monotonic price), then
// redeem some TSRA back to EURC (VWAP). Slot-free — no beacon dependency.
//
// Run: tsx test/economics/curve.ts

import assert from 'node:assert/strict'
import {formatEther, parseUnits, type Hex} from 'viem'
import {Suite} from '../fleet/_assert.ts'
import {gate, loadFleetConfig} from '../fleet/_fleet.ts'
import {createTasraWriteClient, generateClientKey} from '../../src/chain/write.ts'
import {httpFaucet} from '../../src/slots/faucet.ts'
import {bondingCurveAbi} from '../../src/chain/abis/bondingCurve.ts'
import {mockEurcAbi} from '../../src/chain/abis/mockEurc.ts'
import {createFileStore} from '../../src/app/node.ts'
import {localPrepaidSettings} from '../fleet/_prepaid-funding.ts'
import {isNotOperatorRevert} from '../fleet/_production-refusals.ts'

const cfg = loadFleetConfig()
const s = new Suite('e2e: economics — bonding curve buy/redeem')

if (!(await gate(s, cfg))) {
  s.done()
  process.exit(0)
}

const curve = cfg.raw.BONDING_CURVE as `0x${string}`
const eurc = cfg.raw.EURC as `0x${string}`
const settings = localPrepaidSettings(cfg), privateKey = generateClientKey()
const client = createTasraWriteClient({rpcUrl: cfg.rpcUrl, addresses: cfg.book, privateKey, chainId: cfg.chainId})
assert.equal(await client.pub.getChainId(), 43112, 'Economics fixture refuses any nonlocal chain before funding')
const store = createFileStore(settings.directory), key = 'curve-' + client.address
const original = {chainId: 43112, curve, eurc, privateKey, address: client.address,
  transactions: [] as Array<{step: string; hash: Hex; blockHash: Hex}>}
assert.equal(await store.load(key), undefined)
await store.save(key, {...original, phase: 'funding'})
// A lost faucet reply does not authorize another transfer. Preserve the actor
// and fail; recovery can inspect the original address without replaying it.
await httpFaucet(cfg.faucetUrl).fund(client.address)
async function mine(step: string, send: () => Promise<Hex>) {
  const nonce = await client.pub.getTransactionCount({address: client.address, blockTag: 'pending'})
  await store.save(key, {...original, phase: 'prepared', step, nonce})
  const hash = await send()
  await store.save(key, {...original, phase: 'submitted', step, nonce, hash})
  const receipt = await client.pub.waitForTransactionReceipt({hash})
  assert.equal(receipt.status, 'success', `Original ${step} transaction failed`)
  original.transactions.push({step, hash, blockHash: receipt.blockHash})
  await store.save(key, {...original, phase: 'confirmed'})
}
s.ok('client funded for gas', (await client.ethBalance()) > 0n)

const dec = (await client.pub.readContract({address: eurc, abi: mockEurcAbi, functionName: 'decimals'})) as number
const eurcOf = (a: `0x${string}`) => client.pub.readContract({address: eurc, abi: mockEurcAbi, functionName: 'balanceOf', args: [a]}) as Promise<bigint>
const sold = () => client.pub.readContract({address: curve, abi: bondingCurveAbi, functionName: 'soldTokens'}) as Promise<bigint>
const reserve = () => client.pub.readContract({address: curve, abi: bondingCurveAbi, functionName: 'reserve'}) as Promise<bigint>
const spot = () => client.pub.readContract({address: curve, abi: bondingCurveAbi, functionName: 'spotPrice'}) as Promise<bigint>

// ── mint EURC to the client ───────────────────────────────────────────────────
const spend = parseUnits('10000', dec) // 10,000 EURC
await mine('mint', () => client.wallet.writeContract({address: eurc, abi: mockEurcAbi, functionName: 'mint', args: [client.address, spend]}))
s.eq('client minted EURC', await eurcOf(client.address), spend)

const tsra0 = await client.tsraBalance()
const eurc0 = await eurcOf(client.address)
const sold0 = await sold()
const reserve0 = await reserve()
const spot0 = await spot()

// ── buy TSRA on the curve ─────────────────────────────────────────────────────
await mine('approve', () => client.wallet.writeContract({address: eurc, abi: mockEurcAbi, functionName: 'approve', args: [curve, spend]}))
await mine('buy', () => client.wallet.writeContract({address: curve, abi: bondingCurveAbi, functionName: 'buy', args: [spend, 0n]}))

const tsra1 = await client.tsraBalance()
const bought = tsra1 - tsra0
s.ok('buy delivered TSRA to the client', bought > 0n, `+${formatEther(bought)} TSRA for 10k EURC`)
s.eq('buy pulled exactly the EURC spent', eurc0 - (await eurcOf(client.address)), spend)
s.eq('curve reserve grew by the EURC spent', (await reserve()) - reserve0, spend)
s.eq('curve soldTokens grew by the TSRA bought', (await sold()) - sold0, bought)
s.ok('spot price is non-decreasing after a buy (sigmoid)', (await spot()) >= spot0, `${formatEther(spot0)} → ${formatEther(await spot())}`)

// ── redeem is OPERATOR-ONLY (production-fidelity check) ───────────────────────
// BondingCurve.redeem is gated by NodeRegistry.isActive — it's the operator
// REVENUE path (earn TSRA via settlement → redeem to EURC at VWAP), NOT a client
// flow. A client buys to fund slots and never redeems. Assert the gate rejects
// our non-operator client (revert), rather than skipping it.
await assert.rejects(() => client.pub.simulateContract({account: client.address, address: curve, abi: bondingCurveAbi,
  functionName: 'redeem', args: [bought / 2n, 0n]}), isNotOperatorRevert)
s.ok('redeem correctly rejects a non-operator client (NotOperator gate)', true)
await store.save(key, {...original, phase: 'complete', bought, nonOperatorRefused: true})

s.done()
