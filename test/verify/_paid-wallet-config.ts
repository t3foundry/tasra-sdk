// The local orchestrator knows the deployment source tree. Live wallet suites
// still consume only explicit configuration and the SDK; no external CLI is
// used for reservations, consent, credentials or key operations.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {readFileSync, writeFileSync, mkdirSync, mkdtempSync, openSync, closeSync, fsyncSync} from 'node:fs'
import {resolve, join} from 'node:path'
import {createPublicClient, http, keccak256, toHex} from 'viem'
import {nodeRegistryAbi} from '../../src/chain/abis/nodeRegistry.ts'
import {paidWalletSettings, readPaidConfigFile} from '../fleet/_paid-wallet.ts'
import {localPrepaidSettings} from '../fleet/_prepaid-funding.ts'
import type {FleetConfig} from '../fleet/_fleet.ts'

export function generatedInteger(text: string, section: string, key: string): number {
  assert(/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(section) && /^[a-zA-Z_][a-zA-Z_0-9]*$/.test(key), 'Invalid generated policy identifier')
  let current = '', matches = 0, value: number | undefined
  for (const line of text.split('\n')) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/)
    if (header) {current = header[1]!; continue}
    if (current !== section || !new RegExp('^\\s*' + key + '\\s*=').test(line)) continue
    matches++
    const assignment = line.match(new RegExp('^\\s*' + key + '\\s*=\\s*([0-9]+)\\s*(?:#.*)?$'))
    assert(assignment, 'Generated fleet policy contains a noninteger value')
    value = Number(assignment[1])
  }
  assert(matches === 1 && Number.isSafeInteger(value) && value! >= 0, 'Generated fleet policy is absent, duplicated or unsafe')
  return value!
}

export function ownedPublishedPort(value: unknown, root: string, project: string, service: string, port: string) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Missing original Docker container observation')
  const c = value as {Id?: string; Config?: {Labels?: Record<string, string>}; State?: {Running?: boolean};
    NetworkSettings?: {Ports?: Record<string, Array<{HostIp: string; HostPort: string}> | null>}}
  const labels = c.Config?.Labels
  assert(typeof c.Id === 'string' && /^[0-9a-f]{64}$/.test(c.Id) && !/^0+$/.test(c.Id) && c.State?.Running === true,
    'Local SDK routing requires an exact running container identity')
  assert(labels?.['com.docker.compose.project'] === project && labels['com.docker.compose.service'] === service
    && labels['com.docker.compose.project.working_dir'] === resolve(root, 'lab'), 'SDK routing refuses a foreign or archived fleet container')
  const bindings = c.NetworkSettings?.Ports?.[port]
  assert(Array.isArray(bindings) && bindings.length > 0 && bindings.every(b => ['127.0.0.1', '0.0.0.0', '::', '::1'].includes(b.HostIp)
    && /^[1-9][0-9]{0,4}$/.test(b.HostPort) && Number(b.HostPort) <= 65535), 'Local SDK route has no bounded published port')
  const ports = new Set(bindings.map(b => b.HostPort))
  assert.equal(ports.size, 1, 'Local SDK published route is ambiguous')
  return {id: c.Id, port: Number(bindings[0]!.HostPort)}
}

export async function configurePaidWalletFleet(cfg: FleetConfig, networkRoot: string, sdkRoot: string): Promise<Record<string, string>> {
  // This function only reads the already deployed fleet. It neither resets a
  // chain nor creates/stops a container or submits an on-chain transaction.
  const outputRoot = resolve(sdkRoot, 'test/verify/out')
  localPrepaidSettings({...cfg, raw: {...cfg.raw, KK_PREPAID_EVIDENCE_DIR: outputRoot}})
  const rpc = createPublicClient({transport: http(cfg.rpcUrl, {retryCount: 0, timeout: 15_000, fetchOptions: {redirect: 'error'}})})
  assert.equal(await rpc.getChainId(), 43112, 'SDK configuration RPC must prove the local chain')
  assert(cfg.book.NodeRegistry && cfg.book.ServiceRegistry && cfg.book.KeyRegistry && cfg.book.Settlement)
  const project = process.env.COMPOSE_PROJECT_NAME ?? 'keykeeper-swarm'
  assert(/^[a-z0-9][a-z0-9_-]*$/.test(project), 'Invalid owned fleet project')
  const sourceRoot = resolve(networkRoot), configs = join(sourceRoot, 'lab/configs')
  const agentText = readFileSync(join(configs, 'verifier-agent.toml'), 'utf8')
  const accountantText = readFileSync(join(configs, 'accountant-1.toml'), 'utf8')
  const committee = generatedInteger(agentText, 'chain', 'committee_count'), quorum = generatedInteger(agentText, 'chain', 'quorum')
  const cap = generatedInteger(accountantText, 'threshold_beacon', 'max_dkg_set')
  assert(committee > 0 && quorum > 0 && quorum <= committee && committee <= 4096)
  const blockNumber = await rpc.getBlockNumber({cacheTime: 0}), block = await rpc.getBlock({blockNumber})
  const tagged = async (role: string) => [...await rpc.readContract({address: cfg.book.NodeRegistry!, abi: nodeRegistryAbi,
    functionName: 'taggedActiveOperators', args: [keccak256(toHex(role))], blockNumber})].sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0)
  const accountantOperators = await tagged('accountant'), keepers = await tagged('keykeeper')
  const selectedAccountants = cap > 0 ? accountantOperators.slice(0, cap) : accountantOperators
  assert(selectedAccountants.length > 0 && selectedAccountants.length <= 16 && keepers.length > 0 && keepers.length <= 256,
    'Local SDK operator population exceeds its explicitly bounded profile')
  const resources: Array<{role: string; registered: string; id: string; port: number}> = []
  const inspect = (role: string, index: string, registered: string) => {
    const name = `keykeeper-swarm-${role === 'keykeeper' ? 'node' : role}-${index}`
    const observed = JSON.parse(execFileSync('docker', ['inspect', name], {encoding: 'utf8', timeout: 10_000, maxBuffer: 1_048_576})) as unknown[]
    assert(Array.isArray(observed) && observed.length === 1, 'Original container inspection is ambiguous')
    const service = `keykeeper-${role === 'keykeeper' ? 'node' : role}-${index}`
    const published = ownedPublishedPort(observed[0], sourceRoot, project, service, '8080/tcp')
    resources.push({role, registered, ...published})
    return 'http://127.0.0.1:' + published.port
  }
  const accountantUrls: string[] = [], routes: Record<string, string> = {}
  for (const [role, operators] of [['accountant', selectedAccountants], ['keykeeper', keepers]] as const) {
    for (const operator of operators) {
      const node = await rpc.readContract({address: cfg.book.NodeRegistry, abi: nodeRegistryAbi, functionName: 'nodeOf', args: [operator], blockNumber})
      assert(node.active && node.operator.toLowerCase() === operator.toLowerCase(), 'SDK operator changed during configuration')
      const internal = node.url.match(new RegExp('^http://keykeeper-' + (role === 'keykeeper' ? 'node' : role) + '-([1-9][0-9]*):8080/?$'))
      const bridge = node.url.match(new RegExp('^https://keykeeper-cert\\.localhost:([1-9][0-9]*)/' + (role === 'keykeeper' ? 'keeper' : role) + '-([1-9][0-9]*)/?$'))
      assert(internal || bridge, 'Local SDK configuration requires the original owned operator route')
      // Accountant reservation calls use owned published loopback ports; the
      // original quote is authenticated by its actual threshold signatures.
      const mapped = inspect(role, internal?.[1] ?? bridge![2]!, node.url)
      if (role === 'accountant') accountantUrls.push(mapped)
      else routes[node.url.replace(/\/$/, '')] = bridge ? node.url.replace('keykeeper-cert.localhost', 'localhost').replace(/\/$/, '') : mapped
    }
  }
  assert.equal((await rpc.getBlock({blockNumber})).hash, block.hash, 'Local SDK policy observation reorganized')
  mkdirSync(outputRoot, {recursive: true, mode: 0o700})
  const directory = mkdtempSync(join(outputRoot, 'paid-wallet-original-'))
  const profileBytes = Buffer.from(readPaidConfigFile(cfg.raw.KK_PREPAID_AGENT_PROFILE ?? join(configs, 'services/verifier-agent/profile.json'), 65_536))
  assert(profileBytes.length > 0 && profileBytes.length <= 65_536)
  const profileFile = join(directory, 'agent-profile.json'), routeFile = join(directory, 'keeper-routes.json')
  writeFileSync(profileFile, profileBytes, {flag: 'wx', mode: 0o600})
  const routeBytes = cfg.raw.KK_PREPAID_KEEPER_ROUTE_MAP ? Buffer.from(readPaidConfigFile(cfg.raw.KK_PREPAID_KEEPER_ROUTE_MAP, 65_536)) : Buffer.from(JSON.stringify(routes))
  assert(routeBytes.length > 0 && routeBytes.length <= 65_536)
  writeFileSync(routeFile, routeBytes, {flag: 'wx', mode: 0o600})
  const env = {KK_PREPAID_EVIDENCE_DIR: directory, KK_PREPAID_AGENT_PROFILE: profileFile, KK_PREPAID_KEEPER_ROUTE_MAP: routeFile,
    KK_PREPAID_AGENT_PRIVATE_HOSTS: 'localhost', KK_PREPAID_ACCOUNTANT_URLS: accountantUrls.join(','),
    KK_PREPAID_VERIFIER_COUNT: String(committee), KK_PREPAID_VERIFIER_QUORUM: String(quorum),
    KK_PREPAID_SLOT_TASRA_UNITS: cfg.raw.KK_PREPAID_SLOT_TASRA_UNITS ?? '1000000000000000000',
    KK_PREPAID_MAX_TASRA_UNITS: cfg.raw.KK_PREPAID_MAX_TASRA_UNITS ?? '1000000000000000',
    KK_PREPAID_MAX_GAS: cfg.raw.KK_PREPAID_MAX_GAS ?? '2000000',
    KK_PREPAID_MAX_FEE_PER_GAS: cfg.raw.KK_PREPAID_MAX_FEE_PER_GAS ?? '100000000000'}
  paidWalletSettings({...cfg, raw: {...cfg.raw, ...env}})
  assert(cfg.raw.KK_STATUS_LIST_DIR && cfg.raw.KK_STATUS_LIST_URL && cfg.raw.KK_WALLET_CA_FILE,
    'SDK paid fleet must retain the approved issuer status publication and wallet CA from local TLS setup')
  writeFileSync(join(directory, 'deployment-observation.json'), JSON.stringify({schema: 1, networkRoot: sourceRoot, project,
    chainId: 43112, addresses: cfg.book, blockNumber: blockNumber.toString(), blockHash: block.hash, resources,
    agentPolicySha256: createHash('sha256').update(agentText).digest('hex'), accountantPolicySha256: createHash('sha256').update(accountantText).digest('hex'),
    profileSha256: createHash('sha256').update(profileBytes).digest('hex'), routesSha256: createHash('sha256').update(routeBytes).digest('hex'), env}, null, 2) + '\n',
    {flag: 'wx', mode: 0o600})
  for (const file of ['agent-profile.json', 'keeper-routes.json', 'deployment-observation.json']) {
    const fd = openSync(join(directory, file), 'r'); try {fsyncSync(fd)} finally {closeSync(fd)}
  }
  const dir = openSync(directory, 'r'); try {fsyncSync(dir)} finally {closeSync(dir)}
  return env
}
