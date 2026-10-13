// Execute orchestrator control flow with recorded step boundaries. No real
// cargo, Docker, RPC, chain reset or explorer operation is run in this suite.
import {afterEach, expect, it, vi} from 'vitest'

const control = vi.hoisted(() => ({failName: '', calls: [] as string[], configurationCalls: 0, configure: false, specs: [] as {name: string; cmd: string; args: string[]}[]}))
vi.mock('../verify/_run.ts', () => ({
  sdkRoot: '/owned/sdk', networkDir: '/owned/network', explorerDir: '/owned/explorer', chainEnvPath: '/owned/missing-chain.env',
  have: async () => true, banner: () => {}, log: () => {}, fleetConfig: () => ({}),
  sh: async () => {throw new Error('Explorer mutation must not run after a failed prerequisite')},
  runStep: async (phase: string, spec: {name: string; cmd: string; args: string[]}) => {
    control.calls.push(spec.name)
    control.specs.push(spec)
    return {phase, name: spec.name, status: spec.name === control.failName ? 'fail' : 'pass', ms: 0, metrics: []}
  },
}))
vi.mock('../verify/_paid-wallet-config.ts', () => ({configurePaidWalletFleet: async () => {
  control.configurationCalls++
  if (control.configure) return {}
  throw new Error('Original paid fleet configuration refused')
}}))
vi.mock('node:fs', () => ({existsSync: () => true}))
vi.mock('../verify/_explorerRpc.ts', () => ({fleetChain: () => ({rpc: 'http://local', chainId: 43112}), explorerRpcUrl: () => 'http://local'}))
import {bringUp, tearDown} from '../verify/bringup.ts'

afterEach(() => {vi.unstubAllEnvs(); control.calls = []; control.configurationCalls = 0; control.failName = ''; control.configure = false; control.specs = []})
const stages = ['build tasra-cli (release)', 'make fleet-wipe (clean slate — fresh chain)', 'local Avalanche block ticker',
  'make fleet-up (production threshold fleet)']
it.each(stages)('stops immediately after the prerequisite fails: %s', async failed => {
  vi.stubEnv('KK_VERIFY_WIPE', '1'); vi.stubEnv('KK_CHAIN_ID', '43112'); control.failName = failed
  const results = await bringUp(), index = stages.indexOf(failed)
  expect(control.calls).toEqual(stages.slice(0, index + 1))
  expect(results.at(-1)?.status).toBe('fail')
  expect(control.configurationCalls).toBe(0)
  expect(results.some(r => r.name.startsWith('stack healthy'))).toBe(false)
})
it('retains the paid configuration failure and stops before explorer mutation or a misleading health pass', async () => {
  vi.stubEnv('KK_VERIFY_WIPE', '1'); vi.stubEnv('KK_CHAIN_ID', '43112')
  const results = await bringUp()
  expect(control.calls).toEqual(stages)
  expect(control.configurationCalls).toBe(1)
  expect(results.at(-1)).toMatchObject({phase: 'bringup', status: 'fail', name: 'retain original paid wallet deployment configuration',
    detail: 'Original paid fleet configuration refused'})
  expect(results.some(r => r.name.startsWith('stack healthy'))).toBe(false)
})

it('starts the local ticker through fleet ownership and chain identity admission', async () => {
  vi.stubEnv('KK_VERIFY_WIPE', '1'); vi.stubEnv('KK_CHAIN_ID', '43112'); vi.stubEnv('KK_FLEET_INSTANCE', 'isolated')
  control.failName = 'local Avalanche block ticker'
  await bringUp()
  expect(control.specs.at(-1)).toMatchObject({cmd: 'bash', args: ['/owned/network/lab/e2e/recreate-ticker.sh']})
  expect(control.specs.some(s => s.cmd === 'docker')).toBe(false)
})
it.each(['explorer build', 'explorer docker compose up (fresh index)'])('keeps Explorer mutations scoped and stops on %s', async failed => {
  vi.stubEnv('KK_VERIFY_WIPE', '1'); vi.stubEnv('KK_CHAIN_ID', '43112'); vi.stubEnv('KK_FLEET_INSTANCE', 'isolated')
  control.configure = true; control.failName = failed
  const results = await bringUp()
  expect(results.at(-1)?.status).toBe('fail')
  const calls = control.specs.filter(s => s.name.startsWith('explorer'))
  expect(calls[0]).toMatchObject({cmd: 'bash', args: ['/owned/network/lab/e2e/repoint-explorer.sh', '/owned/explorer', 'build']})
  expect(calls.length).toBe(failed === 'explorer build' ? 1 : 2)
  if (calls.length === 2) expect(calls[1]).toMatchObject({cmd: 'bash', args: ['/owned/network/lab/e2e/repoint-explorer.sh', '/owned/explorer']})
  expect(control.specs.some(s => s.cmd === 'docker')).toBe(false)
})
it('does not tear down the fleet when Explorer ownership or stop fails', async () => {
  control.failName = 'explorer down'
  const results = await tearDown()
  expect(results).toHaveLength(1)
  expect(results[0]?.status).toBe('fail')
  expect(control.specs[0]).toMatchObject({cmd: 'bash', args: ['/owned/network/lab/e2e/repoint-explorer.sh', '/owned/explorer', 'down']})
})
