// Certification-only admission. The network's shared guard owns instance naming,
// checkout claims and port offsets; callers must not invent another fleet identity.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {realpathSync} from 'node:fs'
import {join} from 'node:path'

export interface FleetScope {
  root: string
  project: string
  prefix: string
  instance: string
  offset: number
}

export function admittedScope(root: string, output: string, env: NodeJS.ProcessEnv): FleetScope {
  const fields = output.split('\0')
  assert.equal(fields.pop(), '', 'Fleet admission output is not terminated')
  assert(fields.length % 2 === 0, 'Fleet admission output is malformed')
  const settings: Record<string, string> = {}
  for (let i = 0; i < fields.length; i += 2) {
    const key = fields[i]!, value = fields[i + 1]!
    assert(/^[A-Z][A-Z_0-9]*$/.test(key) && !(key in settings), 'Fleet admission output has duplicate or invalid settings')
    settings[key] = value
  }
  const instance = env.KK_FLEET_INSTANCE ?? ''
  if (!instance) {
    assert.equal(fields.length, 0, 'Default fleet admission returned an instance')
    const project = env.COMPOSE_PROJECT_NAME ?? 'keykeeper-swarm'
    assert(/^[a-z0-9][a-z0-9_-]*$/.test(project), 'Invalid owned fleet project')
    return {root, project, prefix: 'keykeeper', instance: '', offset: 0}
  }
  assert.equal(settings.KK_FLEET_INSTANCE, instance, 'Fleet admission changed the selected instance')
  assert(/^[a-z0-9]{1,12}$/.test(instance), 'Invalid fleet instance')
  assert.equal(settings.KK_FLEET_CN_PREFIX, `kki-${instance}`, 'Fleet prefix differs from admitted instance')
  assert.equal(settings.COMPOSE_PROJECT_NAME, settings.KK_FLEET_CN_PREFIX, 'Fleet project differs from admitted instance')
  const offset = Number(settings.KK_FLEET_PORT_OFFSET)
  assert(Number.isInteger(offset) && offset >= 16000 && offset <= 46000, 'Invalid admitted fleet offset')
  return {root, project: settings.COMPOSE_PROJECT_NAME!, prefix: settings.KK_FLEET_CN_PREFIX!, instance, offset}
}

export function resolveFleetScope(root: string, env: NodeJS.ProcessEnv = process.env): FleetScope {
  const physical = realpathSync(root)
  let output: string
  try {
    output = execFileSync('bash', [join(physical, 'lab/e2e/prepare-instance-env.sh'), physical],
      {env, encoding: 'utf8', timeout: 10_000, maxBuffer: 65_536, stdio: ['ignore', 'pipe', 'pipe']})
  } catch {
    throw new Error('Fleet checkout, instance or endpoint admission failed; no SDK discovery attempted')
  }
  return admittedScope(physical, output, env)
}

export function scopedContainer(scope: FleetScope, role: 'keykeeper' | 'accountant' | 'verifier', index: string) {
  assert(/^[1-9][0-9]{0,2}$/.test(index), 'Invalid local operator index')
  const suffix = `${role === 'keykeeper' ? 'node' : role}-${index}`
  return {name: `${scope.prefix}-swarm-${suffix}`, service: `keykeeper-${suffix}`,
    port: role === 'verifier' ? '8081/tcp' : '8080/tcp'}
}
