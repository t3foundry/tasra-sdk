// Execute the real orchestrator with recorded process boundaries. No fleet writes.
import {afterEach, expect, it, vi} from 'vitest'
const control = vi.hoisted(() => ({fail: false, calls: [] as Array<{phase: string; name: string}>, teardown: 0}))
vi.mock('../verify/_run.ts', () => ({networkDir: '/network', sdkRoot: '/sdk', banner: () => {}, log: () => {}, have: async () => false,
  runStep: async (phase: string, spec: {name: string}) => {
    control.calls.push({phase, name: spec.name})
    return {phase, name: spec.name, status: phase === 'settlement' && control.fail ? 'fail' : 'pass', ms: 0, metrics: []}
  }}))
vi.mock('../verify/bringup.ts', () => ({bringUp: async () => {throw new Error('Unexpected bring-up')}, tearDown: async () => {control.teardown++; return []}}))
vi.mock('../verify/report.ts', () => ({writeReport: (rows: Array<{status: string}>) => ({anyRequiredFail: rows.some(r => r.status === 'fail'), mdPath: '/report', jsonPath: '/report.json'})}))
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetModules(); control.calls = []; control.teardown = 0})
it.each([true, false])('gates the actual destructive dispatch on original payment settlement (failure=%s)', async failure => {
  control.fail = failure
  for (const key of ['KK_VERIFY_BRINGUP', 'KK_VERIFY_BOOTSTRAP', 'KK_VERIFY_RUST', 'KK_VERIFY_PERF']) vi.stubEnv(key, '0')
  vi.stubEnv('KK_VERIFY_CORRECTNESS', '1'); vi.stubEnv('KK_VERIFY_DESTRUCTIVE', '1'); vi.stubEnv('KK_KEEP', '1')
  vi.spyOn(process, 'exit').mockImplementation(code => {throw new Error(`terminal-${code}`)})
  await expect(import('../verify/run.ts')).rejects.toThrow(`terminal-${failure ? 1 : 0}`)
  const settled = control.calls.findIndex(c => c.phase === 'settlement'), destructive = control.calls.findIndex(c => c.phase === 'destructive')
  expect(settled).toBeGreaterThan(-1)
  if (failure) expect(destructive).toBe(-1)
  else expect(destructive).toBeGreaterThan(settled)
  expect(control.teardown).toBe(0)
})
