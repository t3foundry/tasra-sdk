import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {afterEach, describe, expect, it} from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const address = `0x${'11'.repeat(20)}`, hash = `0x${'ab'.repeat(32)}`
const manifest = {schemaVersion: 1, network: 'testnet', chainId: 43113,
  deploymentId: 'document-test', revision: 1, status: 'active', protocolVersion: '0.3.0',
  verifiedAt: {blockNumber: '12', blockHash: hash, timestamp: '2026-09-20T00:00:00Z'},
  contracts: ['NodeRegistry', 'KeyRegistry'].map(name => ({name, address,
    abi: `contracts/abi/0.3.0/${name}.json`, runtimeCodeHash: hash,
    deployment: {transactionHash: hash, blockNumber: '11'}, create2: null, proxy: null})),
  services: [{kind: 'verifier-agent', url: 'https://verifier.example'}]}
const body = JSON.stringify(manifest)
const sha256 = createHash('sha256').update(body).digest('hex')
const identity = () => ({chainId: 43113, keyRegistry: address, manifestSha256: sha256,
  coordinator: 'lowest-operator-id', verifierAgentUrl: 'https://verifier.example'})
const directories: string[] = []
afterEach(() => {for (const directory of directories.splice(0)) rmSync(directory, {recursive: true, force: true})})

function load(savedNetwork: unknown) {
  const directory = mkdtempSync(join(tmpdir(), 'tasra-document-network-'))
  directories.push(directory)
  // Copy the actual app modules into an isolated consumer so its package boundary
  // resolves the SDK as it does after installation, without a network connection.
  cpSync(join(root, 'examples/document-signing'), directory, {recursive: true})
  mkdirSync(join(directory, 'node_modules'), {recursive: true})
  symlinkSync(root, join(directory, 'node_modules/tasra-sdk'), 'dir')
  writeFileSync(join(directory, 'network.json'), body)
  writeFileSync(join(directory, 'network-pin.json'), JSON.stringify({sha256,
    manifestUrl: 'https://raw.githubusercontent.com/t3-foundry/tasra-releases/main/networks/testnet/deployments/document-test.json'}))
  const state = join(directory, '.tasra')
  mkdirSync(state)
  writeFileSync(join(state, 'service.json'), JSON.stringify({network: savedNetwork,
    creatorKey: `0x${'33'.repeat(32)}`, slots: {}, holderKeys: {}, senderToken: 'private-test-token'}))
  return spawnSync(process.execPath, ['--import', pathToFileURL(join(root, 'node_modules/tsx/dist/loader.mjs')).href,
    '--input-type=module', '--eval', `
      globalThis.fetch = () => { throw new Error('Unexpected network request') }
      const {loadService} = await import('./backend.ts')
      try { console.log(loadService().senderToken) }
      catch (error) { console.error(error.message); process.exitCode = 1 }
    `], {cwd: directory, encoding: 'utf8', timeout: 10_000,
    env: {...process.env, TASRA_SIGN_DATA: state}})
}

describe('document service deployment binding', () => {
  it('loads existing service state for the exact saved network identity', () => {
    const result = load(identity())
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe('private-test-token')
  })
  it.each([
    ['manifest digest', {manifestSha256: 'cd'.repeat(32)}],
    ['coordinator convention', {coordinator: 'assigned-first'}],
    ['verifier endpoint', {verifierAgentUrl: 'https://replacement.example'}],
    ['chain', {chainId: 43114}],
    ['registry', {keyRegistry: `0x${'44'.repeat(20)}`}],
  ])('refuses service state with a different %s', (_label, changed) => {
    const result = load({...identity(), ...changed})
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('network configuration differs')
  })
  it('refuses unbound legacy service state instead of assuming its current network', () => {
    const result = load(undefined)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('network configuration differs')
  })
})
