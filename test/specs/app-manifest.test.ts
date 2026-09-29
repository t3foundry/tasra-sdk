import {createHash} from 'node:crypto'
import {describe, expect, it, vi} from 'vitest'
import {loadApplicationManifest, resolveApplicationManifest, type ApplicationDeployment, type ApplicationManifest, type LoadApplicationManifestOptions} from '../../src/app/manifest.js'
import type {NetworkManifest} from '../../src/chain/manifest.js'
import {NETWORKS} from '../../src/chain/networks.js'

const address = `0x${'12'.repeat(20)}` as const
const hash = `0x${'ab'.repeat(32)}` as const
const coordinator = 'lowest-operator-id' as const
function descriptor(): ApplicationDeployment {
  return {schemaVersion: 1, name: 'local', chainId: 43112, rpcUrl: 'http://localhost:9650', coordinator,
    addresses: {KeyRegistry: address, NodeRegistry: address}, verifierAgentUrl: 'https://localhost:19444',
    keeperUrls: {'http://keeper:8080': 'http://localhost:8091'}}
}
function release(): NetworkManifest {
  return {schemaVersion: 1, network: 'testnet', chainId: 43113, deploymentId: 'fuji-1', revision: 7, status: 'active', protocolVersion: '0.3.0',
    verifiedAt: {blockNumber: '12', blockHash: hash, timestamp: '2026-09-20T00:00:00Z'},
    contracts: ['NodeRegistry', 'KeyRegistry'].map(name => ({name, address, abi: `contracts/abi/0.3.0/${name}.json`,
      runtimeCodeHash: hash, deployment: {transactionHash: hash, blockNumber: '11'}, create2: null, proxy: null})),
    services: [{kind: 'verifier-agent', url: 'https://verifier.example'}]}
}
function download(body: string, status = 200) {
  return vi.fn(async () => new Response(body, {status}))
}

describe('application manifests', () => {
  it('resolves a local descriptor and snapshots its explicitly approved routing', () => {
    const input = descriptor(), resolved = resolveApplicationManifest(input)
    input.addresses.KeyRegistry = `0x${'34'.repeat(20)}`
    input.keeperUrls!['http://keeper:8080'] = 'http://attacker:8091'
    expect(resolved.deployment.addresses.KeyRegistry).toBe(address)
    expect(resolved.verifierAgentUrl).toBe('https://localhost:19444')
    expect(resolved.keeperUrl!('http://keeper:8080/')).toBe('http://localhost:8091')
    expect(resolved.keeperUrl!('https://another.example')).toBe('https://another.example')
    expect(resolved.deployment).not.toHaveProperty('keeperUrls')
  })
  it('resolves active release addresses, verifier service, network RPC and provenance', () => {
    const result = resolveApplicationManifest(release(), {coordinator})
    expect(result.deployment).toMatchObject({name: 'fuji-1', chainId: 43113, rpcUrl: NETWORKS.testnet.rpcUrl,
      addresses: {KeyRegistry: address, NodeRegistry: address}, coordinator, provenance: {networkRevision: 'fuji-1@7'}})
    expect(result.verifierAgentUrl).toBe('https://verifier.example')
    expect(result.keeperUrl).toBeUndefined()
    const input = release()
    input.services.push({kind: 'rpc', url: 'https://rpc.example'})
    expect(resolveApplicationManifest(input, {coordinator}).deployment.rpcUrl).toBe('https://rpc.example')
    expect(resolveApplicationManifest(input, {coordinator, rpcUrl: 'https://override.example'}).deployment.rpcUrl).toBe('https://override.example')
  })
  it('does not guess a coordinator convention from the protocol version', () => {
    expect(() => resolveApplicationManifest(release())).toThrow('explicit coordinator')
  })
  it.each(['planned', 'retired'] as const)('refuses an inactive %s deployment', status => {
    expect(() => resolveApplicationManifest({...release(), status}, {coordinator})).toThrow(status)
  })
  it('rejects mismatched chains, hybrid schemas and incomplete deployments', () => {
    for (const input of [{...release(), chainId: 43114}, {...release(), addresses: descriptor().addresses}, {...descriptor(), contracts: []},
      {...release(), contracts: undefined}, {...descriptor(), addresses: undefined}, null, [], {...descriptor(), coordinator: undefined},
      {...descriptor(), name: 5}, {...descriptor(), provenance: {networkRevision: 7}}, {...descriptor(), provenance: {networkRevision: 'r1', manifestSha256: 'fake'}}]) {
      expect(() => resolveApplicationManifest(input as unknown as ApplicationManifest)).toThrow()
    }
  })
  it.each(['rpc', 'verifier-agent'])('rejects ambiguous %s services, even with an RPC override', kind => {
    const input = release()
    input.services = [{kind, url: 'https://first.example'}, {kind, url: 'https://second.example'}]
    expect(() => resolveApplicationManifest(input, {coordinator, rpcUrl: 'https://override.example'})).toThrow('Ambiguous')
  })
  it.each(['file:///tmp/secret', 'https://user:password@example.test', 'https://example.test/#hidden'])('rejects invalid service and routing URLs: %s', url => {
    for (const input of [{...descriptor(), rpcUrl: url}, {...descriptor(), verifierAgentUrl: url},
      {...descriptor(), keeperUrls: {[url]: 'http://localhost:8091'}}, {...descriptor(), keeperUrls: {'http://keeper:8080': url}}]) {
      expect(() => resolveApplicationManifest(input)).toThrow()
    }
  })
  it('rejects ambiguous normalized routes and a public RPC downgrade', () => {
    expect(() => resolveApplicationManifest({...descriptor(), keeperUrls: {'http://keeper:80': 'http://localhost:8091', 'http://keeper/': 'http://localhost:8092'}})).toThrow('Ambiguous')
    expect(() => resolveApplicationManifest(release(), {coordinator, rpcUrl: 'http://rpc.example'})).toThrow('HTTPS')
    expect(() => resolveApplicationManifest({...descriptor(), keeperUrls: []} as unknown as ApplicationManifest)).toThrow('mappings')
  })
  it('accepts an exact byte pin, records it and refuses even trailing whitespace changes', async () => {
    const body = JSON.stringify(descriptor()), pin = createHash('sha256').update(body).digest('hex')
    const fetchImpl = download(body)
    const result = await loadApplicationManifest(new URL('https://example.test/network.json'), {sha256: pin, fetchImpl})
    expect(result.deployment.provenance?.manifestSha256).toBe(pin)
    expect(result.keeperUrl!('http://keeper:8080')).toBe('http://localhost:8091')
    expect(fetchImpl).toHaveBeenCalledOnce()
    await expect(loadApplicationManifest('https://example.test/network.json', {sha256: pin, fetchImpl: download(`${body}\n`)})).rejects.toThrow('SHA-256 mismatch')
    // A wrong digest is rejected before a malformed document is parsed.
    await expect(loadApplicationManifest('https://example.test/network.json', {sha256: pin, fetchImpl: download('not json')})).rejects.toThrow('SHA-256 mismatch')
  })
  it('retains the original trusted pin when caller options change during download', async () => {
    const body = JSON.stringify(descriptor()), pin = createHash('sha256').update(body).digest('hex')
    let deliver!: (response: Response) => void
    const response = new Promise<Response>(resolve => {deliver = resolve})
    const options: LoadApplicationManifestOptions = {sha256: pin, fetchImpl: vi.fn(() => response)}
    const task = loadApplicationManifest('https://example.test/network.json', options)
    options.sha256 = undefined
    deliver(new Response(`${body}\n`))
    await expect(task).rejects.toThrow('SHA-256 mismatch')
  })
  it('loads a release manifest with explicit options and preserves release provenance', async () => {
    const body = JSON.stringify(release()), pin = createHash('sha256').update(body).digest('hex')
    const result = await loadApplicationManifest('https://example.test/network.json', {coordinator, sha256: pin, fetchImpl: download(body)})
    expect(result.deployment.provenance).toEqual({networkRevision: 'fuji-1@7', manifestSha256: pin})
  })
  it('rejects malformed pins and unsupported URLs before fetching', async () => {
    const fetchImpl = download('{}')
    for (const source of ['file:///tmp/a', 'https://user:pass@example.test', 'https://example.test/#fragment']) {
      await expect(loadApplicationManifest(source, {fetchImpl})).rejects.toThrow()
    }
    await expect(loadApplicationManifest('https://example.test', {sha256: 'invalid', fetchImpl})).rejects.toThrow('pin')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('rejects unpinned remote HTTP manifests before fetching but accepts a trusted digest or loopback', async () => {
    const body = JSON.stringify(descriptor()), pin = createHash('sha256').update(body).digest('hex')
    const fetchImpl = download(body)
    await expect(loadApplicationManifest('http://example.test/network.json', {fetchImpl})).rejects.toThrow('HTTPS')
    expect(fetchImpl).not.toHaveBeenCalled()
    const pinned = await loadApplicationManifest('http://example.test/network.json', {sha256: pin, fetchImpl})
    expect(pinned.deployment.provenance?.manifestSha256).toBe(pin)
    await expect(loadApplicationManifest('http://example.test/network.json', {sha256: pin, fetchImpl: download(`${body} `)})).rejects.toThrow('SHA-256 mismatch')
    const loopback = await loadApplicationManifest('http://127.0.0.1:9650/network.json', {fetchImpl: download(body)})
    expect(loopback.deployment.name).toBe('local')
  })
  it('honors abort and rejects unsuccessful HTTP responses and malformed JSON', async () => {
    const fetchImpl = download('{}')
    await expect(loadApplicationManifest('https://example.test', {signal: AbortSignal.abort(), fetchImpl})).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
    await expect(loadApplicationManifest('https://example.test', {fetchImpl: download('{}', 404)})).rejects.toThrow('HTTP 404')
    await expect(loadApplicationManifest('https://example.test', {fetchImpl: download('not json')})).rejects.toThrow()
  })
  it('rejects an unpinned loopback HTTP manifest redirected to remote HTTP', async () => {
    const response = new Response(JSON.stringify(descriptor()))
    Object.defineProperty(response, 'url', {value: 'http://remote.example/network.json'})
    await expect(loadApplicationManifest('http://127.0.0.1:9650/network.json', {
      fetchImpl: vi.fn(async () => response),
    })).rejects.toThrow('loopback')
  })
  it('rejects a redirected manifest that downgrades HTTPS', async () => {
    const response = new Response(JSON.stringify(descriptor()))
    Object.defineProperty(response, 'url', {value: 'http://example.test/network.json'})
    await expect(loadApplicationManifest('https://example.test', {fetchImpl: vi.fn(async () => response)})).rejects.toThrow('requires HTTPS')
  })
})
