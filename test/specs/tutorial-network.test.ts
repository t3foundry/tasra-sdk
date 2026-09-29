import {createHash} from 'node:crypto'
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {downloadNetwork, loadNetwork} from '../../examples/network.js'

const directories: string[] = []
const scratch = () => { const path = mkdtempSync(join(tmpdir(), 'tasra-manifest-example-')); directories.push(path); return path }
afterEach(() => {for (const path of directories.splice(0)) rmSync(path, {recursive: true, force: true})})
const address = `0x${'12'.repeat(20)}`
const hash = `0x${'ab'.repeat(32)}`
const manifest = {schemaVersion: 1, network: 'testnet', chainId: 43113, deploymentId: 'example-testnet', revision: 1, status: 'active', protocolVersion: '0.3.0',
  verifiedAt: {blockNumber: '12', blockHash: hash, timestamp: '2026-09-20T00:00:00Z'},
  contracts: ['NodeRegistry', 'KeyRegistry'].map(name => ({name, address, abi: `contracts/abi/0.3.0/${name}.json`,
    runtimeCodeHash: hash, deployment: {transactionHash: hash, blockNumber: '11'}, create2: null, proxy: null})),
  services: [{kind: 'verifier-agent', url: 'https://verifier.example'}]}
function fixture(value: unknown = manifest) {
  const body = JSON.stringify(value)
  const pointer = {schemaVersion: 1, network: 'testnet', chainId: 43113, status: 'active', manifest: 'deployments/example.json', sha256: createHash('sha256').update(body).digest('hex')}
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify(pointer))).mockResolvedValueOnce(new Response(body))
  return {body, pointer, fetchImpl}
}

describe('downloaded tutorial manifest boundary', () => {
  it('downloads only release records and retains verified original bytes', async () => {
    const directory = scratch(), {body, pointer, fetchImpl} = fixture()
    await downloadNetwork(fetchImpl, directory)
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      'https://raw.githubusercontent.com/t3-foundry/tasra-releases/main/networks/testnet/current.json',
      'https://raw.githubusercontent.com/t3-foundry/tasra-releases/main/networks/testnet/deployments/example.json',
    ])
    expect(fetchImpl.mock.calls.every(([, options]) => options?.redirect === 'error')).toBe(true)
    expect(readFileSync(join(directory, 'network.json'), 'utf8')).toBe(body)
    const options = loadNetwork(directory)
    expect(options.deployment.chainId).toBe(43113)
    expect(options.deployment.addresses.KeyRegistry).toBe(address)
    expect(options.deployment.provenance?.manifestSha256).toBe(pointer.sha256)
    expect(options.verifierAgentUrl).toBe('https://verifier.example')
  })
  it.each(['https://attacker.example/record.json', '../secret.json', 'deployments/../../secret.json'])('rejects pointer path %s before another fetch', async path => {
    const directory = scratch(), {pointer} = fixture()
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({...pointer, manifest: path})))
    await expect(downloadNetwork(fetchImpl, directory)).rejects.toThrow('pointer')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('rejects changed manifest bytes both during download and when loaded later', async () => {
    const directory = scratch(), {body, pointer} = fixture()
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify(pointer))).mockResolvedValueOnce(new Response(body + '\n'))
    await expect(downloadNetwork(fetchImpl, directory)).rejects.toThrow(/sha.?256/i)
    await downloadNetwork(fixture().fetchImpl, directory)
    writeFileSync(join(directory, 'network.json'), body + '\n')
    expect(() => loadNetwork(directory)).toThrow(/sha.?256/i)
  })
  it.each(['planned', 'retired'])('rejects an inactive %s deployment even with a matching digest', async status => {
    await expect(downloadNetwork(fixture({...manifest, status}).fetchImpl, scratch())).rejects.toThrow()
  })
  it('rejects HTTP failures and a different chain before exposing configuration', async () => {
    await expect(downloadNetwork(vi.fn<typeof fetch>().mockResolvedValue(new Response('', {status: 503})), scratch())).rejects.toThrow('HTTP 503')
    await expect(downloadNetwork(fixture({...manifest, chainId: 43114}).fetchImpl, scratch())).rejects.toThrow()
  })
})
