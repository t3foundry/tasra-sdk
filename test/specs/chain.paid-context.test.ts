import {afterEach, expect, it, vi} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import * as randomness from '@noble/hashes/utils'
import {createPublicClient, custom, decodeFunctionData, encodeFunctionResult, getAddress, keccak256, recoverTypedDataAddress, toHex, type Abi, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {discoverPaidOperationContext, readClientExecutionPolicy, type PaidContextOptions} from '../../src/chain/prepaid.js'
import {UnderfundedSlotError} from '../../src/errors.js'
import {BillingModeError} from '../../src/chain/billing.js'
import {paymentIntentHash, paymentIntentTypedData, paymentSessionCommitment, type PaymentIntentWire} from '../../src/committee/payment.js'
import {verifierLeaf} from '../../src/committee/token.js'
import {keyRegistryAbi} from '../../src/chain/abis/keyRegistry.js'
import {nodeRegistryAbi} from '../../src/chain/abis/nodeRegistry.js'
import {settlementAbi} from '../../src/chain/abis/settlement.js'
import {thresholdRandomBeaconAbi} from '../../src/chain/abis/thresholdRandomBeacon.js'
import {verifierSetRegistryAbi} from '../../src/chain/abis/verifierSetRegistry.js'
import {accountantSetRegistryAbi} from '../../src/chain/abis/accountantSetRegistry.js'
import {attachHeadFollower, createHeadFollower, unfollowHeads} from '../../src/chain/headFollower.js'

vi.mock('@noble/hashes/utils', async importOriginal => {
  const actual = await importOriginal<typeof import('@noble/hashes/utils')>()
  return {...actual, randomBytes: vi.fn(actual.randomBytes)}
})

const h = (n: number, len = 32): Hex => `0x${n.toString(16).padStart(2, '0').repeat(len)}`
interface Changes {
  policy?: [number, number]; size?: number; unanchored?: boolean; noPrevious?: boolean; missingSeed?: boolean
  beaconMismatch?: 'key' | 'snapshot' | 'accountant'; epoch?: bigint; sharingEpoch?: bigint; sharingVersion?: bigint
  accountantUnanchored?: boolean; accountantNoPrevious?: boolean; accountantSize?: number
  inactive?: number[]; duplicateId?: boolean; duplicateKey?: boolean; insufficient?: boolean
  enabled?: boolean; available?: bigint; cancelled?: boolean; noKey?: boolean; age?: number; orphan?: boolean
  chain?: number; unsupported?: boolean; url?: string; chainId?: number; onChainId?: () => void
  reserved?: bigint; settled?: boolean; refunded?: bigint; root?: Hex; tagged?: boolean; creator?: Hex; registeredKey?: Hex
  legacy?: boolean; genesis?: boolean; version?: string
  // D8: the reservation's stored quote block h(19) (block 19), read for the paid epoch only.
  anchorEpoch?: bigint; anchorReorg?: boolean; anchorPruned?: boolean
  /** The KeyRegistry now points to another NodeRegistry, where every node is inactive. */
  movedNodes?: boolean
}
function fixture(change: Changes = {}) {
  const deployment = {chainId: change.chainId ?? 43112, settlement: h(1, 20), keyRegistry: h(2, 20), verifierSet: h(5, 20), accountantSet: h(8, 20), beacon: h(6, 20)}
  const nodes = h(7, 20), moved = h(77, 20), approved = {...deployment}, slotId = h(3), creator = privateKeyToAccount(h(11))
  const keys = [1, 2, 3].map(n => toHex(ed25519.getPublicKey(new Uint8Array(32).fill(n))))
  const operators = [11, 12, 13].map(n => h(n, 20)), ids = [30n, 10n, 20n]
  const calls: {method: string; name?: string; args?: readonly unknown[]; at?: unknown; params?: unknown}[] = []
  let heads = 0
  const client = createPublicClient({transport: custom({request: async ({method, params}: {method: string; params?: unknown}) => {
    calls.push({method, params})
    if (method === 'eth_chainId') {change.onChainId?.(); return toHex(change.chain ?? approved.chainId)}
    if (method === 'eth_getBlockByHash') return (params as [Hex])[0] === h(19) ? {number: '0x13', hash: h(19), timestamp: toHex(990), transactions: []} : null
    if (method === 'eth_getBlockByNumber' && (params as [string])[0] === '0x13') return {number: '0x13', hash: change.anchorReorg ? h(98) : h(19), timestamp: toHex(990), transactions: []}
    if (method === 'eth_getBlockByNumber') return {number: '0x14', hash: heads++ > 0 && change.orphan ? h(99) : h(20), timestamp: toHex(1000 - (change.age ?? 0)), transactions: []}
    if (method !== 'eth_call') throw new Error(`unexpected RPC ${method}`)
    if (change.unsupported) throw new Error('canonical reads unavailable')
    const [call, at] = params as [{to: Hex; data: Hex}, {blockHash?: Hex}]
    const anchorRead = at.blockHash === h(19)
    if (!anchorRead) expect(at).toEqual({blockHash: h(20), requireCanonical: true})
    const abi: Abi = call.to === nodes || call.to.toLowerCase() === moved ? nodeRegistryAbi : call.to === approved.keyRegistry ? keyRegistryAbi
      : call.to === approved.beacon ? thresholdRandomBeaconAbi : call.to === approved.verifierSet ? verifierSetRegistryAbi
        : call.to === approved.accountantSet ? accountantSetRegistryAbi : settlementAbi
    const {functionName: name, args} = decodeFunctionData({abi, data: call.data})
    calls[calls.length - 1] = {method, name, args, at, params}
    if (anchorRead) {
      if (abi !== thresholdRandomBeaconAbi || name !== 'epoch') throw new Error(`only the beacon epoch is read at the quote block, not ${name}`)
      if (change.anchorPruned) throw new Error('missing trie node')
      return encodeFunctionResult({abi, functionName: 'epoch', result: change.anchorEpoch ?? change.epoch ?? 7n})
    }
    // A legacy Settlement (version 1) has none of the prepaid getters: they revert.
    if (change.legacy && abi === settlementAbi && name !== 'version' && name !== 'balanceOf') throw new Error('execution reverted')
    const index = operators.findIndex(op => op.toLowerCase() === String(args?.[0]).toLowerCase())
    const previous = args?.[0] !== (change.epoch ?? 7n)
    const accountant = call.to === approved.accountantSet
    const values: Record<string, unknown> = {
      prepaidEnabled: change.enabled ?? true, balanceOf: change.available ?? 100n,
      version: change.version ?? (change.legacy ? '1' : '2'), prepaidFromGenesis: change.genesis ?? false,
      prepaidCost: change.reserved ?? 5n, prepaidSettled: change.settled ?? false,
      prepaidRefunded: change.refunded ?? 0n, prepaidAssignmentBlock: h(19),
      randomBeacon: change.beaconMismatch === 'key' ? h(99, 20) : approved.beacon,
      beacon: change.beaconMismatch === (accountant ? 'accountant' : 'snapshot') ? h(99, 20) : approved.beacon,
      epoch: change.epoch ?? 7n, seedAt: change.missingSeed ? h(0) : previous ? h(8) : h(9),
      snapshotAt: accountant
        ? change.accountantUnanchored && !previous || change.accountantNoPrevious && previous ? [h(0), 0] : [h(19), change.accountantSize ?? 3]
        : change.unanchored && !previous || change.noPrevious && previous ? [h(0), 0] : [change.root ?? (previous ? h(17) : h(18)), change.size ?? 5],
      verifierPolicy: change.policy ?? [3, 2], nodeRegistry: change.movedNodes ? moved : nodes, assignedNodes: operators,
      getKeySlot: {creator: change.creator ?? creator.address, ruleCommitment: h(33), threshold: {k: change.insufficient ? 3 : 2, n: 3}, mode: 0,
        publicKey: change.noKey ? '0x' : keys[0], epoch: change.sharingEpoch ?? 1n, committeeVersion: change.sharingVersion ?? 2n,
        exists: true, cancelled: change.cancelled ?? false, expiry: 2000n, ruleVersion: 1n, auth: 0},
      operatorIdOf: change.duplicateId ? 1n : ids[index], hasTag: change.tagged ?? true,
      nodeOf: {operator: operators[index], dns: 'keeper', url: change.url ?? `https://keeper${index}.example`, p2pAddr: '', pubkey: change.registeredKey ?? keys[change.duplicateKey ? 0 : index],
        stake: 100n, rewardBalance: 0n, unbondingAt: 0n, active: call.to.toLowerCase() !== moved && !change.inactive?.includes(index)},
    }
    return encodeFunctionResult({abi, functionName: name, result: values[name]})
  }}, {retryCount: 0})})
  // Tests observe once unless they ask to wait: the anchor wait is exercised with an injected clock.
  return {client, deployment, slotId, creator, keys, operators, calls, run: (options?: PaidContextOptions) => discoverPaidOperationContext(client, deployment, slotId, {anchorWait: {timeoutMs: 0}, ...options})}
}
afterEach(() => { vi.restoreAllMocks(); vi.mocked(randomness.randomBytes).mockReset() })
const now = () => vi.spyOn(Date, 'now').mockReturnValue(1_000_000)

it('refuses a legacy Settlement or a slot not cut over with a typed billing refusal', async () => {
  now()
  const legacy: unknown = await fixture({legacy: true}).run().catch((error: unknown) => error)
  expect(legacy).toBeInstanceOf(BillingModeError)
  expect(legacy).toMatchObject({mode: 'legacy', settlementVersion: '1', retryable: false})
  const upgraded: unknown = await fixture({enabled: false}).run().catch((error: unknown) => error)
  expect(upgraded).toMatchObject({name: 'BillingModeError', mode: 'legacy', settlementVersion: '2'})
  // Prepaid from genesis but never funded: prepaid billing, so the refusal is the funding one.
  const unfunded: unknown = await fixture({enabled: false, genesis: true, available: 0n}).run().catch((error: unknown) => error)
  expect(unfunded).toBeInstanceOf(UnderfundedSlotError)
  // When nothing can be read, billing is unknown: refused, retryable, never guessed.
  await expect(fixture({unsupported: true}).run()).rejects.toMatchObject({name: 'BillingModeError', mode: 'unknown', retryable: true})
})

it('judges billing inside discovery: an unknown Settlement version is refused even with prepaidEnabled, and no separate billing observation runs', async () => {
  now()
  for (const version of ['5', '2.1']) {
    const refused: unknown = await fixture({version}).run().catch((error: unknown) => error)
    expect(refused, version).toBeInstanceOf(BillingModeError)
    expect(refused).toMatchObject({mode: 'unknown', settlementVersion: version})
  }
  for (const version of ['2', '3', '4']) {
    const f = fixture({version}); await f.run()
    // One head observation and one canonical recheck: the version is read at discovery's own block.
    expect(f.calls.filter(c => c.method === 'eth_getBlockByNumber'), version).toHaveLength(2)
    expect(f.calls.filter(c => c.name === 'version'), version).toHaveLength(1)
  }
})

it('identifies an exhausted activated slot without inventing an HTTP response or starting payment work', async () => {
  now(); const f = fixture({available: 0n})
  const error: unknown = await f.run().catch((error: unknown) => error)
  expect(error).toBeInstanceOf(UnderfundedSlotError)
  expect(error).toMatchObject({slotId: f.slotId, availableTasraUnits: 0n, retryable: false})
  if (!(error instanceof UnderfundedSlotError)) throw new Error('Expected the typed funding refusal')
  expect(error.status).toBeUndefined()
  expect(error.url).toBeUndefined()
  expect(f.calls.every(call => ['eth_chainId', 'eth_getBlockByNumber', 'eth_call', 'eth_getCode'].includes(call.method))).toBe(true)
})

it('discovers one canonical assignment/policy and produces creator-signable intent fields without mutations', async () => {
  now(); vi.mocked(randomness.randomBytes).mockReturnValueOnce(Uint8Array.of(0))
  const f = fixture(), context = await f.run()
  expect(context).toMatchObject({blockHash: h(20), blockNumber: 20n, available: 100n, creator: f.creator.address,
    coordinator: {operator: getAddress(f.operators[1]!), publicKey: f.keys[1]}, intentFields: {verification_epoch: 7, verification_seed: h(9), verification_root: h(18),
      verification_committee: 3, verification_quorum: 2, keeper_assignment: {key_epoch: 1, committee_version: 2, threshold: 2}}})
  expect(context.contributors.map(c => c.publicKey)).toEqual([...f.keys].sort())
  const payment = {...context.intentFields, action: 'sign' as const, payload_digest: h(44), nonce: h(45), max_cost: '10', expires: 1060,
    session_commitment: paymentSessionCommitment(h(46), 'did:web:agent.example', 1060)}
  const typed = paymentIntentTypedData(payment), signature = await f.creator.signTypedData(typed)
  expect(await recoverTypedDataAddress({...typed, signature})).toBe(f.creator.address)
  expect(f.calls.every(call => ['eth_chainId', 'eth_call', 'eth_getBlockByNumber', 'eth_getCode'].includes(call.method))).toBe(true)
})
it('uses only the immediately previous anchored snapshot and refuses missing current seed', async () => {
  now(); const f = fixture({unanchored: true})
  expect((await f.run()).intentFields).toMatchObject({verification_epoch: 6, verification_seed: h(8), verification_root: h(17)})
  expect(f.calls.filter(c => c.name === 'snapshotAt').map(c => c.args)).toEqual([[7n], [7n], [6n], [6n]])
  for (const change of [{unanchored: true, noPrevious: true}, {unanchored: true, epoch: 0n}, {missingSeed: true, unanchored: true}]) await expect(fixture(change).run()).rejects.toThrow(/seed|snapshot/)
})
it('waits for both role anchors and never selects an epoch missing its accountant snapshot', async () => {
  now()
  expect((await fixture({accountantUnanchored: true}).run()).intentFields.verification_epoch).toBe(6)
  for (const change of [
    {accountantUnanchored: true, accountantNoPrevious: true},
    {unanchored: true, accountantNoPrevious: true},
    {accountantUnanchored: true, epoch: 0n},
    {accountantSize: 0}, {accountantSize: 65536},
  ]) await expect(fixture(change).run()).rejects.toThrow(/snapshot/)
  await expect(fixture({beaconMismatch: 'accountant'}).run()).rejects.toThrow(/beacon/)
})
it('requires explicit defaults and enforces the native verifier policy bounds', async () => {
  now()
  await expect(fixture({policy: [0, 0]}).run()).rejects.toThrow(/policy/)
  expect((await fixture({policy: [0, 0]}).run({defaultVerificationPolicy: {committee: 3, quorum: 2}})).intentFields.verification_quorum).toBe(2)
  expect((await fixture().run({defaultVerificationPolicy: {committee: 1, quorum: 1}})).intentFields.verification_committee).toBe(3)
  expect((await fixture({policy: [4096, 3000], size: 5000}).run()).intentFields.verification_committee).toBe(4096)
  for (const policy of [[0, 1], [3, 0], [3, 4], [6, 2], [4097, 3000]] as [number, number][]) await expect(fixture({policy}).run()).rejects.toThrow(/policy/)
})
it('draws each eligible coordinator without ID bias and rejects the uneven byte range', async () => {
  now()
  const draw = vi.mocked(randomness.randomBytes)
  // Each accepted byte selects one of three members; 255 would bias member 0
  // if reduced modulo three instead of being rejected.
  for (const [byte, index] of [[0, 1], [1, 2], [2, 0], [254, 0]] as const) {
    draw.mockReturnValueOnce(Uint8Array.of(255)).mockReturnValueOnce(Uint8Array.of(byte))
    const f = fixture(), context = await f.run()
    expect(context.coordinator.operator).toBe(getAddress(f.operators[index]!))
    expect(context.intentFields.keeper_assignment.coordinator).toEqual([...ed25519.getPublicKey(new Uint8Array(32).fill(index + 1))])
    expect(context.contributors).toHaveLength(3)
  }
  expect(draw).toHaveBeenCalledTimes(8)
  draw.mockReturnValueOnce(Uint8Array.of(1))
  const f = fixture({inactive: [0]}), context = await f.run()
  expect(context.coordinator.operator).toBe(getAddress(f.operators[2]!))
  expect(context.contributors).toHaveLength(2)
})
it('honors an explicitly selected eligible coordinator and excludes inactive contributors', async () => {
  now(); const f = fixture({inactive: [0]})
  const draw = vi.mocked(randomness.randomBytes)
  const c = await f.run({coordinator: f.operators[2]})
  expect(c.coordinator.operator).toBe(getAddress(f.operators[2]!))
  expect(c.contributors.map(m => m.operator.toLowerCase()).sort()).toEqual(f.operators.slice(1).sort())
  await expect(f.run({coordinator: f.operators[0]})).rejects.toThrow(/coordinator/)
  await expect(f.run({coordinator: h(88, 20)})).rejects.toThrow(/coordinator/)
  expect(draw).not.toHaveBeenCalled()
  await expect(fixture({inactive: [0], insufficient: true}).run()).rejects.toThrow(/threshold/)
})
it('refuses mismatched deployment pointers, inactive/unfunded slots and ambiguous keeper identities', async () => {
  now()
  for (const change of [{beaconMismatch: 'key' as const}, {beaconMismatch: 'snapshot' as const}, {enabled: false}, {available: 0n}, {cancelled: true}, {noKey: true}, {duplicateId: true}, {duplicateKey: true}]) await expect(fixture(change).run()).rejects.toThrow()
})
it('refuses stale heads, reorgs, unsupported canonical reads and lossy JSON integers', async () => {
  now()
  for (const change of [{age: 31}, {age: -3}, {orphan: true}, {chain: 43113}, {unsupported: true}, {epoch: 9007199254740992n}, {sharingEpoch: 9007199254740992n}, {sharingVersion: 9007199254740992n}]) await expect(fixture(change).run()).rejects.toThrow()
})
it('requires HTTPS on Fuji even when local HTTP is explicitly requested', async () => {
  now()
  await expect(fixture({chainId: 43113, url: 'http://keeper.example'}).run({allowLocalHttp: true})).rejects.toThrow(/transport/)
  expect((await fixture({url: 'http://127.0.0.1:8091'}).run({allowLocalHttp: true})).coordinator.url).toBe('http://127.0.0.1:8091')
})
it('pins deployment and approved defaults before asynchronous discovery starts', async () => {
  now(); const options = {defaultVerificationPolicy: {committee: 3, quorum: 2}}
  const f = fixture({policy: [0, 0], onChainId: () => {f.deployment.beacon = h(99, 20); options.defaultVerificationPolicy.committee = 1}})
  expect((await f.run(options)).intentFields.verification_committee).toBe(3)
})


function reservedPayment(): PaymentIntentWire {
  return {chain_id:43112,settlement:h(1,20),key_registry:h(2,20),slot:h(3),action:'sign',
    payload_digest:h(44),session_commitment:h(46),nonce:h(45),max_cost:'10',expires:1060,
    verification_epoch:7,verification_seed:h(9),verification_root:h(18),verification_registry_size:5,
    verification_committee:3,verification_quorum:2,keeper_assignment:{key_epoch:1,committee_version:2,threshold:2,
      coordinator:Array<number>(32).fill(9),contributors:[9,10,11].map(n=>Array<number>(32).fill(n))},signature:h(1,65)}
}
const intendedWork={slot:h(3),action:'sign' as const,payloadDigest:h(44)}

it('reads client consent from the original mined reservation and one canonical registry snapshot',async()=>{
  now();const f=fixture(), payment=reservedPayment()
  const observation=await readClientExecutionPolicy(f.client,f.deployment,payment,intendedWork)
  expect(observation).toMatchObject({blockHash:h(20),blockNumber:20n,policy:{chainId:43112,
    settlement:f.deployment.settlement,keyRegistry:f.deployment.keyRegistry,creator:f.creator.address,
    paymentHash:paymentIntentHash(payment),cost:5n,nowSecs:1000}})
  expect(f.calls.filter(c=>c.name==='prepaidCost')[0]?.args).toHaveLength(2)
  expect(f.calls.filter(c=>c.name==='snapshotAt').map(c=>c.args)).toEqual([[7n]])
  expect(f.calls.every(c=>['eth_chainId','eth_call','eth_getBlockByNumber','eth_getBlockByHash','eth_getCode'].includes(c.method))).toBe(true)
  // D8: the paid epoch is read once at the stored quote block, canonically, then rechecked by number.
  expect(f.calls.filter(c=>c.method==='eth_call'&&(c.at as {blockHash?:Hex}).blockHash===h(19)).map(c=>[c.name,c.at]))
    .toEqual([['epoch',{blockHash:h(19),requireCanonical:true}]])
  expect(f.calls.some(c=>c.method==='eth_getBlockByNumber'&&(c.params as unknown[])[0]==='0x13')).toBe(true)
})

it('refuses new client consent on settled, expired, unavailable or changed canonical context',async()=>{
  now()
  for(const change of [{settled:true},{reserved:0n},{reserved:11n},{refunded:1n},{enabled:false},
    {beaconMismatch:'key' as const},{beaconMismatch:'snapshot' as const},{cancelled:true},{creator:h(0,20)},
    {missingSeed:true},{root:h(99)},{size:6},{epoch:9n},{policy:[3,1] as [number,number]},
    {age:31},{orphan:true},{unsupported:true},{chain:43113}]){
    const f=fixture(change)
    await expect(readClientExecutionPolicy(f.client,f.deployment,reservedPayment(),intendedWork)).rejects.toThrow()
    expect(f.calls.every(c=>['eth_chainId','eth_call','eth_getBlockByNumber','eth_getBlockByHash','eth_getCode'].includes(c.method))).toBe(true)
  }
  // D8: quote-block failures carry their exact code, so an assertion thrown inside the fake
  // transport (which would surface as unavailable) cannot pass for a definite refusal.
  for(const [change,code] of [[{anchorEpoch:9n},'paid_epoch_refused'],[{anchorEpoch:6n},'paid_epoch_refused'],
    [{anchorReorg:true},'paid_epoch_refused'],[{anchorPruned:true},'paid_epoch_unavailable']] as const){
    const f=fixture(change)
    await expect(readClientExecutionPolicy(f.client,f.deployment,reservedPayment(),intendedWork)).rejects
      .toMatchObject({name:'PaidEpochError',code,retryable:code==='paid_epoch_unavailable'})
    // The only quote-block read is the canonical beacon epoch call (no fixture assertion fired).
    expect(f.calls.filter(c=>c.method==='eth_call'&&(c.at as {blockHash?:Hex}).blockHash===h(19)).map(c=>[c.name,c.at]))
      .toEqual([['epoch',{blockHash:h(19),requireCanonical:true}]])
  }
  const f=fixture()
  await expect(readClientExecutionPolicy(f.client,f.deployment,{...reservedPayment(),expires:1000},intendedWork)).rejects.toThrow(/expiry|expired/)
})

it('requires explicit defaults and preserves the reserved previous epoch without silently redrawing',async()=>{
  now();const f=fixture({policy:[0,0]})
  await expect(readClientExecutionPolicy(f.client,f.deployment,reservedPayment(),intendedWork)).rejects.toThrow(/policy/)
  const d={...f.deployment,defaultVerificationPolicy:{committee:3,quorum:2}}
  expect((await readClientExecutionPolicy(f.client,d,reservedPayment(),intendedWork)).policy.cost).toBe(5n)
  const previous={...reservedPayment(),verification_epoch:6,verification_seed:h(8),verification_root:h(17)}
  expect((await readClientExecutionPolicy(f.client,d,previous,intendedWork)).policy.paymentHash).toBe(paymentIntentHash(previous))
  await expect(readClientExecutionPolicy(f.client,d,{...previous,verification_epoch:5},intendedWork)).rejects.toThrow(/current or previous/)
  // D8: judged at the quote block (epoch 7), not the later head (9): 6 is still admitted.
  const crossed=fixture({policy:[0,0],epoch:9n,anchorEpoch:7n})
  expect((await readClientExecutionPolicy(crossed.client,d,previous,intendedWork)).policy.paymentHash).toBe(paymentIntentHash(previous))
})

it('requires an anchored drawn key that is still active and tagged before approving its work',async()=>{
  now();const base=fixture(), member={index:0,operator:base.operators[0]!,publicKey:base.keys[0]!,proof:[] as Hex[]}
  const root=toHex(verifierLeaf(0,Uint8Array.from(Buffer.from(member.operator.slice(2),'hex')),
    Uint8Array.from(Buffer.from(member.publicKey.slice(2),'hex'))))
  const payment={...reservedPayment(),verification_root:root,verification_registry_size:1,verification_committee:1,verification_quorum:1}
  const change={root,size:1,policy:[1,1] as [number,number]}
  const good=fixture(change)
  expect((await readClientExecutionPolicy(good.client,good.deployment,payment,intendedWork,member)).policy.creator).toBe(base.creator.address)
  expect(good.calls.filter(c=>c.name==='hasTag')[0]?.args?.[1]).toBe(keccak256(toHex('verifier')))
  for(const extra of [{inactive:[0]},{tagged:false},{registeredKey:base.keys[1]!}]){
    const f=fixture({...change,...extra})
    await expect(readClientExecutionPolicy(f.client,f.deployment,payment,intendedWork,member)).rejects.toThrow(/standing/)
  }
  for(const target of [{...member,index:1},{...member,publicKey:base.keys[1]!},{...member,operator:base.operators[1]!},
    {...member,proof:[h(99)]},{...member,proof:Array<Hex>(33).fill(h(99))}]){
    const f=fixture(change)
    await expect(readClientExecutionPolicy(f.client,f.deployment,payment,intendedWork,target)).rejects.toThrow(/member/)
    expect(f.calls.some(c=>c.name==='nodeOf')).toBe(false)
  }
})
it('reads a verifier standing early at the last seen NodeRegistry, but judges it at the registry the pointer names now',async()=>{
  now();const base=fixture(), member={index:0,operator:base.operators[0]!,publicKey:base.keys[0]!,proof:[] as Hex[]}
  const root=toHex(verifierLeaf(0,Uint8Array.from(Buffer.from(member.operator.slice(2),'hex')),
    Uint8Array.from(Buffer.from(member.publicKey.slice(2),'hex'))))
  const payment={...reservedPayment(),verification_root:root,verification_registry_size:1,verification_committee:1,verification_quorum:1}
  const change:Changes={root,size:1,policy:[1,1]}, f=fixture(change)
  await readClientExecutionPolicy(f.client,f.deployment,payment,intendedWork,member)
  // The pointer moves: the early read at the old registry is discarded and the moved one decides.
  change.movedNodes=true
  const before=f.calls.length
  await expect(readClientExecutionPolicy(f.client,f.deployment,payment,intendedWork,member)).rejects.toThrow(/standing/)
  const standing=f.calls.slice(before).filter(c=>c.name==='nodeOf').map(c=>(c.params as [{to:Hex}])[0].to.toLowerCase())
  expect(standing).toEqual([h(7,20),h(77,20)])
  // Learned: the next decision reads the moved registry early, once.
  const next=f.calls.length
  await expect(readClientExecutionPolicy(f.client,f.deployment,payment,intendedWork,member)).rejects.toThrow(/standing/)
  expect(f.calls.slice(next).filter(c=>c.name==='nodeOf').map(c=>(c.params as [{to:Hex}])[0].to.toLowerCase())).toEqual([h(77,20)])
})
it('waits a bounded time for an admissible complete epoch while a new epoch\'s anchors land, then refuses', async () => {
  now()
  // Neither the latest nor the previous epoch is complete for two polls; the anchors then land.
  const change: Changes = {unanchored: true, noPrevious: true}
  const f = fixture(change), sleeps: number[] = []
  let t = 1_000_000
  const clock = {now: () => t, sleep: async (ms: number) => { sleeps.push(ms); t += ms; if (sleeps.length === 2) { change.unanchored = false; change.noPrevious = false } }, jitter: () => 0}
  const context = await f.run({anchorWait: {timeoutMs: 5_000, pollMs: 1_000, clock}})
  expect(sleeps).toEqual([1_000, 1_000])
  expect(context.intentFields).toMatchObject({verification_epoch: 7, verification_seed: h(9), verification_root: h(18)})
  // One fresh head per attempt (three observations) plus the closing canonical re-read; never a
  // re-read of an old block.
  expect(f.calls.filter(c => c.method === 'eth_getBlockByNumber')).toHaveLength(4)
  // Past the bound the refusal is unchanged, after exactly the waits that fit.
  const stuck = fixture({unanchored: true, noPrevious: true}), waits: number[] = []
  let u = 1_000_000
  await expect(stuck.run({anchorWait: {timeoutMs: 2_500, pollMs: 1_000, clock: {now: () => u, sleep: async (ms: number) => { waits.push(ms); u += ms }, jitter: () => 0}}}))
    .rejects.toThrow('no current or previous anchored verifier and accountant snapshots')
  expect(waits).toEqual([1_000, 1_000])
  // The default keeps a single observation when told so, and refuses an unbounded or absurd wait.
  await expect(fixture({unanchored: true, noPrevious: true}).run()).rejects.toThrow(/no current or previous/)
  for (const bad of [{timeoutMs: -1}, {timeoutMs: 120_001}, {pollMs: 50}, {pollMs: 10_001}]) await expect(f.run({anchorWait: bad})).rejects.toThrow('invalid anchor wait')
})

it('serves a repeated discovery at a followed, vouched-for head from the block-pinned cache and its pre-reads', async () => {
  now()
  const f = fixture()
  const follower = createHeadFollower(f.client, {finality: 'instant', now: () => 1_000_000})
  attachHeadFollower(f.client, follower)
  try {
    await follower.ingest({number: 20n, hash: h(20), parentHash: h(21), timestamp: 1000n})
    const first = await f.run()
    // Let the slot's pre-read (registered by the first discovery) settle.
    await new Promise(resolve => setTimeout(resolve, 0))
    const before = f.calls.filter(c => c.method === 'eth_call').length
    const second = await f.run()
    const {keeper_assignment: _a, ...rest} = first.intentFields
    expect(second.intentFields).toMatchObject(rest)
    expect(f.calls.filter(c => c.method === 'eth_call').length - before).toBe(0)
  } finally { unfollowHeads(f.client) }
  // A follower that cannot vouch (probabilistic finality) never serves the cache: every read is sent.
  const g = fixture()
  attachHeadFollower(g.client, createHeadFollower(g.client, {now: () => 1_000_000}))
  try {
    await g.run(); const before = g.calls.filter(c => c.method === 'eth_call').length
    await g.run()
    expect(g.calls.filter(c => c.method === 'eth_call').length - before).toBeGreaterThan(10)
  } finally { unfollowHeads(g.client) }
})
