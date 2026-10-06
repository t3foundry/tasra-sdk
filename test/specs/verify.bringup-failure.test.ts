// Execute orchestrator control flow with recorded step boundaries. No real
// cargo, Docker, RPC, chain reset or explorer operation is run in this suite.
import {afterEach, expect, it, vi} from 'vitest'

const control = vi.hoisted(() => ({failName: '', calls: [] as string[], configurationCalls: 0}))
vi.mock('../verify/_run.ts', () => ({
  sdkRoot: '/owned/sdk', networkDir: '/owned/network', explorerDir: '/owned/explorer', chainEnvPath: '/owned/missing-chain.env',
  have: async () => true, banner: () => {}, log: () => {}, fleetConfig: () => ({}),
  sh: async () => {throw new Error('Explorer mutation must not run after a failed prerequisite')},
  runStep: async (phase: string, spec: {name: string}) => {
    control.calls.push(spec.name)
    return {phase, name: spec.name, status: spec.name === control.failName ? 'fail' : 'pass', ms: 0, metrics: []}
  },
}))
vi.mock('../verify/_paid-wallet-config.ts', () => ({configurePaidWalletFleet: async () => {
  control.configurationCalls++
  throw new Error('Original paid fleet configuration refused')
}}))
import {bringUp} from '../verify/bringup.ts'

afterEach(() => {vi.unstubAllEnvs(); control.calls = []; control.configurationCalls = 0; control.failName = ''})
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
