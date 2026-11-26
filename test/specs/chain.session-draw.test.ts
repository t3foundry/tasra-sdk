// The chain reads a session grant (and a wallet request) is judged by: beacon epochs and one
// slot's verifier draw, each at ONE observed head, plus the snapshot-artifact reader that
// authenticates the epoch's verifier keys against the anchored root.
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import {decodeFunctionData, encodeFunctionResult, hexToBytes, toHex, type Abi, type Address, type Hex, type PublicClient} from 'viem'
import {merkleRoot, selectVerifierCommittee, verifierLeaf, verifyMerkleProof} from '../../src/committee/token.js'
import {keyRegistryAbi} from '../../src/chain/abis/keyRegistry.js'
import {thresholdRandomBeaconAbi} from '../../src/chain/abis/thresholdRandomBeacon.js'
import {verifierSetRegistryAbi} from '../../src/chain/abis/verifierSetRegistry.js'

const pinned = vi.fn()
vi.mock('../../src/chain/pinnedReads.js', () => ({pinnedRegistryCall: (...a: unknown[]) => pinned(...a)}))
const discoverBlsSharing = vi.fn()
vi.mock('../../src/committee/blsSharing.js', () => ({discoverBlsSharing: (...a: unknown[]) => discoverBlsSharing(...a)}))
const {createSlotDrawReader, readBeaconDrawState, readCurrentBeaconEpoch, readSlotVerifierDraw} = await import('../../src/chain/sessionDraw.js')
const {readSlotSharing} = await import('../../src/chain/slotSharing.js')
const {SlotBalanceError, isSlotBalanceRefusal, httpError, isAuthDenied, isRetryable} = await import('../../src/errors.js')

const h = (n: number, len = 32) => `0x${n.toString(16).padStart(2, '0').repeat(len)}` as Hex
const deployment = {chainId: 43112, keyRegistry: h(0x21, 20) as Address, beacon: h(0x22, 20) as Address, verifierSet: h(0x23, 20) as Address}
const slot = h(4), ZERO = h(0)
const entries = [1, 2, 3, 4, 5].map((n, index) => ({index, operator: h(n, 20), pubkey: toHex(ed25519.getPublicKey(new Uint8Array(32).fill(n)))}))
const leaves = entries.map(e => verifierLeaf(e.index, hexToBytes(e.operator), hexToBytes(e.pubkey)))
const root = toHex(merkleRoot(leaves)!)

/** The chain at one head. */
let chain: {latest: bigint; seeds: Record<string, Hex>; snapshots: Record<string, readonly [Hex, number]>; policy: readonly [number, number]; keyBeacon: Address; setBeacon: Address}
let blocks: number
const client = {getChainId: vi.fn(async () => 43112), getBlock: vi.fn(async () => { blocks++; return {number: 100n, hash: h(0xb1), timestamp: BigInt(Math.floor(Date.now() / 1000))} })} as unknown as PublicClient
beforeEach(() => {
  blocks = 0
  vi.mocked(client.getChainId).mockResolvedValue(43112)
  chain = {latest: 8n, seeds: {7: h(5), 8: h(6)}, snapshots: {7: [root, 5], 8: [root, 5]}, policy: [3, 2], keyBeacon: deployment.beacon, setBeacon: deployment.beacon}
  pinned.mockReset().mockImplementation(async (_client: unknown, at: {blockHash: Hex}, to: Address, data: Hex) => {
    expect(at.blockHash).toBe(h(0xb1))
    const abi = (to === deployment.keyRegistry ? keyRegistryAbi : to === deployment.beacon ? thresholdRandomBeaconAbi : verifierSetRegistryAbi) as Abi
    const call = decodeFunctionData({abi, data}), arg = String(call.args?.[0])
    const result = call.functionName === 'epoch' ? chain.latest : call.functionName === 'seedAt' ? chain.seeds[arg] ?? ZERO
      : call.functionName === 'snapshotAt' ? chain.snapshots[arg] ?? [ZERO, 0] : call.functionName === 'verifierPolicy' ? chain.policy
        : call.functionName === 'randomBeacon' ? chain.keyBeacon : chain.setBeacon
    return encodeFunctionResult({abi, functionName: call.functionName, result} as never)
  })
})

describe('beacon reads', () => {
  it('reads the latest epoch at one observed head, and refuses another chain or a stale head', async () => {
    expect(await readCurrentBeaconEpoch(client, deployment)).toBe(8n)
    expect(await readCurrentBeaconEpoch(client, deployment, {fresh: true})).toBe(8n)
    expect(blocks).toBe(2)
    vi.mocked(client.getChainId).mockResolvedValue(1)
    await expect(readCurrentBeaconEpoch(client, deployment)).rejects.toThrow(/chain does not match/)
    vi.mocked(client.getChainId).mockResolvedValue(43112)
    vi.mocked(client.getBlock).mockResolvedValueOnce({number: 100n, hash: h(0xb1), timestamp: BigInt(Math.floor(Date.now() / 1000) - 120)} as never)
    await expect(readCurrentBeaconEpoch(client, deployment)).rejects.toThrow(/stale/)
    await expect(readCurrentBeaconEpoch(client, {...deployment, beacon: ZERO.slice(0, 42) as Address})).rejects.toThrow(/address/)
  })
  it('the draw epoch is the latest once anchored, else the previous, else none', async () => {
    expect(await readBeaconDrawState(client, deployment)).toEqual({latest: 8n, draw: 8n})
    delete chain.snapshots[8]
    expect(await readBeaconDrawState(client, deployment)).toEqual({latest: 8n, draw: 7n})
    delete chain.snapshots[7]
    expect(await readBeaconDrawState(client, deployment)).toEqual({latest: 8n})
  })
})

describe('one slot\'s verifier draw, as the chain gives it', () => {
  it('reads the seed, the anchored snapshot and the slot policy of the current or previous epoch', async () => {
    expect(await readSlotVerifierDraw(client, deployment, slot, 8n)).toEqual({chain_id: 43112, slot, verification_epoch: 8, verification_seed: h(6),
      verification_root: root, verification_registry_size: 5, verification_committee: 3, verification_quorum: 2})
    expect((await readSlotVerifierDraw(client, deployment, slot, 7n)).verification_seed).toBe(h(5))
    expect(blocks).toBe(2)
  })
  it.each([[6n, /latest or previous/], [9n, /latest or previous/]] as const)('refuses epoch %s: no keeper or verifier admits it', async (epoch, message) => {
    chain.seeds[String(epoch)] = h(9); chain.snapshots[String(epoch)] = [root, 5]
    await expect(readSlotVerifierDraw(client, deployment, slot, epoch)).rejects.toThrow(message)
  })
  it('refuses an epoch without an anchored seed or snapshot, and registries that point at another beacon', async () => {
    delete chain.seeds[8]
    await expect(readSlotVerifierDraw(client, deployment, slot, 8n)).rejects.toThrow(/no anchored seed/)
    chain.seeds[8] = h(6); delete chain.snapshots[8]
    await expect(readSlotVerifierDraw(client, deployment, slot, 8n)).rejects.toThrow(/no anchored seed/)
    chain.snapshots[8] = [root, 5]; chain.setBeacon = h(0x55, 20) as Address
    await expect(readSlotVerifierDraw(client, deployment, slot, 8n)).rejects.toThrow(/beacon pointers/)
  })
  it('the slot policy wins over the network default; a slot without one needs the default; an impossible policy is refused', async () => {
    expect((await readSlotVerifierDraw(client, deployment, slot, 8n, {defaultVerificationPolicy: {committee: 5, quorum: 4}})).verification_committee).toBe(3)
    chain.policy = [0, 0]
    await expect(readSlotVerifierDraw(client, deployment, slot, 8n)).rejects.toThrow(/verifier policy/)
    expect(await readSlotVerifierDraw(client, deployment, slot, 8n, {defaultVerificationPolicy: {committee: 5, quorum: 4}})).toMatchObject({verification_committee: 5, verification_quorum: 4})
    chain.policy = [6, 2]
    await expect(readSlotVerifierDraw(client, deployment, slot, 8n)).rejects.toThrow(/verifier policy/)
    chain.policy = [0, 2]
    await expect(readSlotVerifierDraw(client, deployment, slot, 8n)).rejects.toThrow(/on-chain verifier policy/)
  })
})

describe('the slot draw reader: keys authenticated against the anchored root', () => {
  const artifact = {version: 1, chain_id: 43112, registry: deployment.verifierSet, epoch: 8, root, size: 5, block_number: 15, block_hash: h(15), entries}
  const json = (value: unknown) => new Response(JSON.stringify(value), {status: 200, headers: {'content-type': 'application/json'}})
  it('returns the recomputed committee with proofs that verify, the whole epoch set, and keeps a verified draw', async () => {
    const fetch = vi.fn(async () => json(artifact))
    const reader = createSlotDrawReader({client, deployment, snapshotHosts: ['https://accountant.test'], fetch: fetch as unknown as typeof globalThis.fetch, waitForPublicationMs: 0})
    const trust = await reader(slot, 8n)
    const drawn = selectVerifierCommittee(hexToBytes(slot), 8, hexToBytes(h(6)), 5, 3)
    expect(trust.witnesses.map(w => w.index)).toEqual(drawn)
    expect(trust.verifierProofs.map(p => p.verifier_index)).toEqual(drawn)
    for (const w of trust.witnesses) expect(verifyMerkleProof(leaves[w.index]!, w.proof.map(p => hexToBytes(p)), hexToBytes(root))).toBe(true)
    expect([...trust.set.pubkeys.keys()].sort()).toEqual([0, 1, 2, 3, 4])
    expect(toHex(trust.set.pubkeys.get(2)!)).toBe(entries[2]!.pubkey)
    expect(trust).toMatchObject({committee: 3, quorum: 2, seed: hexToBytes(h(6))})
    expect(trust.verifierProofs[0]!.pubkey).not.toMatch(/^0x/)
    await reader(slot, 8n)
    expect(fetch).toHaveBeenCalledTimes(1)
    // A caller cannot corrupt the kept draw.
    trust.set.pubkeys.get(0)!.fill(0)
    expect(toHex((await reader(slot, 8n)).set.pubkeys.get(0)!)).toBe(entries[0]!.pubkey)
  })
  it('refuses an artifact whose leaves are not the anchored root\'s, and never keeps a failure', async () => {
    const forged = {...artifact, entries: entries.map(e => ({...e, pubkey: toHex(ed25519.getPublicKey(new Uint8Array(32).fill(e.index + 50)))}))}
    const fetch = vi.fn(async () => json(forged))
    const reader = createSlotDrawReader({client, deployment, snapshotHosts: ['https://accountant.test'], fetch: fetch as unknown as typeof globalThis.fetch, waitForPublicationMs: 0})
    await expect(reader(slot, 8n)).rejects.toThrow(/verifiable/)
    fetch.mockImplementation(async () => json(artifact))
    expect((await reader(slot, 8n)).witnesses).toHaveLength(3)
    expect(() => createSlotDrawReader({client, deployment, snapshotHosts: []})).toThrow(/snapshot hosts/)
  })
})

describe('a BLS slot\'s sharing from the slot id alone', () => {
  it('reads epoch, sharing version, threshold and the registry keepers, routes their URLs and returns the verified endpoints', async () => {
    const operators = [h(1, 20), h(2, 20), h(3, 20)] as Address[]
    const chainReader = {client, readers: {keyRegistry: {getKeySlot: vi.fn(async () => ({exists: true, cancelled: false, mode: 1, epoch: 4n, committeeVersion: 2n, threshold: {k: 2, n: 3}, publicKey: '0x01'})),
      assignedNodes: vi.fn(async () => operators)}, nodeRegistry: {nodeOf: vi.fn(async (op: Address) => ({url: `http://keeper-${op.slice(-1)}:4000`, pubkey: h(Number(op.slice(-1)) + 0x40)}))}}} as never
    discoverBlsSharing.mockImplementation(async (input: {keepers: {operator: string; nodeUrl: string}[]}) => ({verifyingShares: new Map([[1, new Uint8Array(144)], [2, new Uint8Array(144)]]),
      keepers: input.keepers.slice(0, 2).map((k, i) => ({...k, identifier: i + 1})), failures: [{operator: input.keepers[2]!.operator, message: 'down'}]}))
    const controller = new AbortController(), fetchImpl = vi.fn()
    const sharing = await readSlotSharing(chainReader, slot, {keeperUrl: url => url.replace('http://keeper-', 'https://localhost:440').replace(':4000', ''), fetchImpl, allowLocalHttp: true, signal: controller.signal})
    expect(sharing).toMatchObject({chainId: 43112, epoch: 4, committeeVersion: 2, threshold: 2, nodeUrls: ['https://localhost:4401', 'https://localhost:4402']})
    expect(discoverBlsSharing).toHaveBeenCalledWith(expect.objectContaining({chainId: 43112, slotId: slot, epoch: 4, committeeVersion: 2, threshold: 2, fetchImpl, allowLocalHttp: true, signal: controller.signal}))
    expect((discoverBlsSharing.mock.calls[0]![0] as {keepers: {publicKey: Uint8Array}[]}).keepers.map(k => toHex(k.publicKey))).toEqual([h(0x41), h(0x42), h(0x43)])
    // Without options the registered URLs are used as they are.
    await readSlotSharing(chainReader, slot)
    expect((discoverBlsSharing.mock.calls[1]![0] as {keepers: {nodeUrl: string}[]}).keepers[0]!.nodeUrl).toBe('http://keeper-1:4000')
    controller.abort(new Error('cancelled'))
    await expect(readSlotSharing(chainReader, slot, {signal: controller.signal})).rejects.toThrow('cancelled')
  })
  it('refuses a missing, cancelled or non-BLS slot before asking any keeper', async () => {
    const fetchImpl = vi.fn()
    const reader = (slotState: Record<string, unknown>) => ({client, readers: {keyRegistry: {getKeySlot: vi.fn(async () => ({exists: true, cancelled: false, mode: 1, epoch: 1n, committeeVersion: 1n,
      threshold: {k: 2, n: 3}, publicKey: '0x01', ...slotState})), assignedNodes: vi.fn(async () => [])}, nodeRegistry: {nodeOf: vi.fn()}}}) as never
    await expect(readSlotSharing(reader({exists: false}), slot, {fetchImpl})).rejects.toThrow(/does not exist/)
    await expect(readSlotSharing(reader({cancelled: true}), slot, {fetchImpl})).rejects.toThrow(/cancelled/)
    await expect(readSlotSharing(reader({mode: 2}), slot, {fetchImpl})).rejects.toThrow(/not a BLS slot/)
    await expect(readSlotSharing(reader({publicKey: '0x'}), slot, {fetchImpl})).rejects.toThrow(/published key/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('the metered admission bound (HTTP 402)', () => {
  it('is a typed, non-retryable refusal that is neither an authorization denial nor a payment error', async () => {
    const error = await httpError(new Response('{"error":"slot balance does not cover unsettled metered work"}', {status: 402}), 'https://keeper.test/v1/committee/sign', 'committee/sign')
    expect(error).toBeInstanceOf(SlotBalanceError)
    expect(error).toMatchObject({status: 402, code: 'slot-balance', retryable: false})
    expect(error.message).toContain('does not cover unsettled metered work')
    expect(isSlotBalanceRefusal(error)).toBe(true)
    expect(isAuthDenied(error)).toBe(false); expect(isRetryable(error)).toBe(false)
    expect(isSlotBalanceRefusal(await httpError(new Response('x', {status: 403}), 'https://keeper.test/x'))).toBe(false)
  })
})
