// VERIFY · STAGE 1 — bring up the real production-mode stack.
//
//   - keykeeper-network demo fleet in THRESHOLD mode (KK_THRESHOLD_SET=1):
//     Besu (Prague/EIP-2537) + 5 nodes + 3 prod-profile verifiers + 3 threshold
//     accountants; contracts deployed, operators registered, genesis BLS-DKG,
//     demo slot created. The prod verifier profile (signed-VC only) is the fleet
//     default, so the production credential path is what gets exercised.
//   - keykeeper-explorer attached to the fleet's docker network (its compose is
//     purpose-built to ATTACH, not own, the stack).
//   - the host tasra-cli (release) — the signed-VC path + on-chain stress
//     slot creation shell out to it.
//
// Then a health gate: nodes /readyz, verifiers /health, explorer /api/overview,
// and the demo slot's key anchored on-chain. Nothing here is mocked.
//
// Standalone:  tsx test/verify/bringup.ts        (= npm run verify:up)
//              tsx test/verify/bringup.ts --down  (= npm run verify:down)

import {existsSync} from 'node:fs'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createPublicClient, http, type Hex} from 'viem'
import {keyRegistryAbi} from '../../src/chain/abis/keyRegistry.ts'
import {explorerRpcUrl, fleetChain} from './_explorerRpc.ts'
import {configurePaidWalletFleet} from './_paid-wallet-config.ts'
import {banner, chainEnvPath, explorerDir, fleetConfig, have, log, networkDir, sdkRoot, runStep, type StepResult} from './_run.ts'

const FLEET_NETWORK = process.env.KK_FLEET_NETWORK ?? 'keykeeper-swarm_default'
const ACCOUNTANT_URLS = process.env.KK_ACCOUNTANT_URLS ?? '' // accountant is a polling daemon (no HTTP listener)

/** Pass deployment settings to the guarded network lifecycle; do not rewrite .env. */
function explorerEnv(): Record<string, string> {
  const fleet = fleetChain(chainEnvPath)
  return {
    FLEET_NETWORK,
    CHAIN_ENV_FILE: chainEnvPath,
    RPC_URL: explorerRpcUrl(process.env, fleet.rpc),
    CHAIN_ID: String(process.env.KK_CHAIN_ID ?? fleet.chainId ?? '1337'),
    // fleetEnv belongs to make fleet-up only. Carry local reward approval to
    // the later guarded Explorer restart; official networks need operator setup.
    ...(String(process.env.KK_CHAIN_ID ?? fleet.chainId) === '43112' ? {KK_EXPLORER_REWARDS: '1'} : {}),
    NODE_URLS: 'http://keykeeper-node-1:8080,http://keykeeper-node-2:8080,http://keykeeper-node-3:8080,http://keykeeper-node-4:8080,http://keykeeper-node-5:8080',
    VERIFIER_URLS: 'http://keykeeper-verifier-1:8081,http://keykeeper-verifier-2:8081,http://keykeeper-verifier-3:8081',
    ACCOUNTANT_URLS,
    ...(process.env.KK_EXPLORER_PORT ? {EXPLORER_PORT: process.env.KK_EXPLORER_PORT} : {}),
    ...(process.env.KK_EXPLORER_DB_PORT ? {EXPLORER_DB_PORT: process.env.KK_EXPLORER_DB_PORT} : {}),
  }
}

async function onchainKeySet(rpcUrl: string, registry: Hex, slot: Hex): Promise<boolean> {
  try {
    const chain = createPublicClient({transport: http(rpcUrl)})
    const r = (await chain.readContract({address: registry, abi: keyRegistryAbi, functionName: 'getKeySlot', args: [slot]})) as {publicKey?: string} | unknown[]
    const pk = (r as {publicKey?: string}).publicKey ?? (Array.isArray(r) ? (r[4] as string) : undefined)
    return !!pk && pk !== '0x'
  } catch {
    return false
  }
}

async function probe(url: string, ms = 3000): Promise<number | null> {
  try {
    return (await fetch(url, {signal: AbortSignal.timeout(ms)})).status
  } catch {
    return null
  }
}

/** Poll until nodes + verifiers + explorer answer and the demo slot key is anchored. */
async function waitHealthy(timeoutMs = 180_000): Promise<{ok: boolean; detail: string}> {
  const deadline = Date.now() + timeoutMs
  let detail = ''
  while (Date.now() < deadline) {
    // fleetConfig() republishes chain.env into process.env first — see _run.ts. Without that
    // the SDK's env-driven config returns empty values and the gate blames the fleet.
    const cfg = fleetConfig()
    const node = cfg.nodeUrls[0] ? await probe(`${cfg.nodeUrls[0]}/readyz`) : null
    const ver = cfg.verifierUrls[0] ? await probe(`${cfg.verifierUrls[0]}/health`) : null
    const exp = await probe(`${cfg.explorerApi}/overview`)
    const registry = cfg.book.KeyRegistry
    const keyed = registry && cfg.slotId ? await onchainKeySet(cfg.rpcUrl, registry, cfg.slotId) : false
    detail = `node/readyz=${node ?? 'DOWN'} verifier/health=${ver ?? 'DOWN'} explorer/overview=${exp ?? 'DOWN'} slotKeyAnchored=${keyed}`
    if (node === 200 && ver === 200 && exp === 200 && keyed) return {ok: true, detail}
    await new Promise(r => setTimeout(r, 4000))
  }
  return {ok: false, detail}
}

export async function bringUp(): Promise<StepResult[]> {
  const results: StepResult[] = []
  const phase = 'bringup'

  // 1. host tasra-cli (release) — prereq for the signed-VC + on-chain stress paths
  if (await have('cargo')) {
    results.push(await runStep(phase, {name: 'build tasra-cli (release)', cmd: 'cargo', args: ['build', '--locked', '--release', '-p', 'tasra-cli'], cwd: networkDir, timeoutMs: 1_800_000}))
  } else {
    log('[skip] cargo not found — signed-VC operate step will be skipped')
    results.push({phase, name: 'build tasra-cli (release)', status: 'skip', ms: 0, metrics: [], detail: 'cargo not installed'})
  }
  if (results.some(r => r.status === 'fail')) return results

  // 2. fleet up (threshold mode, prod verifier profile is the default).
  // The demo fault injection (byzantine accountants/verifier for the slashing
  // scenarios) is opt-in and OFF by default in the fleet (KK_DEMO_FAULTS), so a
  // normal bring-up is honest. When the verify run opts into the demo-faults
  // scenarios (KK_VERIFY_DEMO_FAULTS=1, see the destructive phase), pass
  // KK_DEMO_FAULTS=1 through so the fleet actually comes up with those faults —
  // otherwise scenarios 12/13/14/15 would run against an honest fleet and fail.
  const freshFleet = process.env.KK_VERIFY_WIPE === '1' || process.env.KK_VERIFY_WIPE === 'true'
  // Paid operations need the accountant coordination endpoints and the automatic
  // payout worker. Only a freshly wiped fleet can declare an empty manual-root
  // history; resumed deployments retain their operator-supplied inventory policy.
  // KK_BYO_IDP=1: the fleet's OAuth identity provider (Keycloak). `test:prod` runs the Rego
  // kk_oauth slot suite (test/e2e/rego-slot.ts), which needs it; without it that suite fails
  // red under TASRA_FLEET_REQUIRED rather than certifying nothing.
  const fleetEnv = {KK_THRESHOLD_SET:'1', KK_PREPAID_PAYOUTS:'1', KK_AGG_SETTLE:'true', KK_BYO_IDP:'1',
    ...(freshFleet ? {KK_PAYOUT_DECLARE_NO_MANUAL_ROOTS:'1'} : {})}
  // KK_VERIFY_WIPE=1 → clean slate: delete volumes + Besu chain first, so the
  // fleet-up below is a fresh provision (new chain, redeployed contracts, fresh
  // genesis DKG + slot) rather than a resume of preserved state. This is the
  // "verify against a clean fleet + clean Besu" path; default is resume (fast).
  if (freshFleet) {
    results.push(await runStep(phase, {name: 'make fleet-wipe (clean slate — fresh chain)', cmd: 'make', args: ['fleet-wipe'], cwd: networkDir, timeoutMs: 300_000}))
    if (results.at(-1)?.status === 'fail') return results
  }
  if (process.env.KK_CHAIN_ID === '43112') {
    results.push(await runStep(phase,{name:'local Avalanche block ticker',cmd:'bash',
      args:[resolve(networkDir, 'lab/e2e/recreate-ticker.sh')],cwd:networkDir}))
    if (results.at(-1)?.status === 'fail') return results
  }
  results.push(await runStep(phase, {name:'make fleet-up (production threshold fleet)', cmd: 'make', args: ['fleet-up'], cwd: networkDir, env: fleetEnv, timeoutMs: 900_000}))
  if (results.at(-1)?.status === 'fail') return results

  const configuredAt = Date.now()
  try {
    const env = await configurePaidWalletFleet(fleetConfig(), networkDir, sdkRoot)
    Object.assign(process.env, env)
    results.push({phase, name: 'retain original paid wallet deployment configuration', status: 'pass', ms: Date.now() - configuredAt,
      metrics: [], detail: `Original private deployment evidence: ${env.KK_PREPAID_EVIDENCE_DIR}`})
  } catch (error) {
    results.push({phase, name: 'retain original paid wallet deployment configuration', status: 'fail', ms: Date.now() - configuredAt,
      metrics: [], detail: error instanceof Error ? error.message : 'Paid wallet configuration failed'})
    return results
  }

  // 3. explorer attached to the fleet network
  // `chainEnvPath` comes from _run.ts: the SDK's FleetConfig moved to a TASRA_* env-var model
  // and no longer carries it, so the harness owns the path (certify passes KK_CHAIN_ENV).
  if (!existsSync(chainEnvPath)) {
    results.push({phase, name: 'explorer up', status: 'fail', ms: 0, metrics: [], detail: `fleet chain.env missing at ${chainEnvPath} — fleet-up did not complete`})
  } else {
    const env = explorerEnv()
    results.push(await runStep(phase, {name: 'explorer build', cmd: 'bash',
      args: [resolve(networkDir, 'lab/e2e/repoint-explorer.sh'), explorerDir, 'build'],
      cwd: networkDir, env, timeoutMs: 600_000}))
    if (results.at(-1)?.status === 'fail') return results
    // The shared lifecycle proves resource ownership before removing the old index.
    results.push(await runStep(phase, {name: 'explorer docker compose up (fresh index)', cmd: 'bash',
      args: [resolve(networkDir, 'lab/e2e/repoint-explorer.sh'), explorerDir],
      cwd: networkDir, env, timeoutMs: 600_000}))
  }

  if (results.some(r => r.status === 'fail')) return results

  // 4. health gate
  banner(`${phase} · health gate`)
  const t0 = Date.now()
  const h = await waitHealthy()
  log(`${h.ok ? '✓' : '✗'} health: ${h.detail}`)
  results.push({phase, name: 'stack healthy (nodes + verifier + explorer + slot key anchored)', status: h.ok ? 'pass' : 'fail', ms: Date.now() - t0, metrics: [], detail: h.detail})
  return results
}

export async function tearDown(): Promise<StepResult[]> {
  const phase = 'teardown'
  const results: StepResult[] = []
  results.push(await runStep(phase, {name: 'explorer down', cmd: 'bash', args: [resolve(networkDir, 'lab/e2e/repoint-explorer.sh'), explorerDir, 'down'], cwd: networkDir, timeoutMs: 120_000, optional: true}))
  if (results.at(-1)?.status === 'fail') return results
  results.push(await runStep(phase, {name: 'make fleet-down', cmd: 'make', args: ['fleet-down'], cwd: networkDir, timeoutMs: 180_000, optional: true}))
  return results
}

// CLI entry: `verify:up` / `verify:down`
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const down = process.argv.includes('--down')
  const results = down ? await tearDown() : await bringUp()
  const failed = results.filter(r => r.status === 'fail')
  for (const r of results) log(`  ${r.status.toUpperCase().padEnd(4)} ${r.name}`)
  process.exit(failed.length ? 1 : 0)
}
