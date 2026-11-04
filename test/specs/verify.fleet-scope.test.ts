// Real child admission using a private synthetic checkout; no Docker or RPC.
import {afterEach, expect, it} from 'vitest'
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {admittedScope, resolveFleetScope, scopedContainer} from '../verify/_fleet-scope.ts'

const roots: string[] = []
afterEach(() => {for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true})})
const settings = {KK_FLEET_INSTANCE: 'cert1', KK_FLEET_CN_PREFIX: 'kki-cert1', COMPOSE_PROJECT_NAME: 'kki-cert1', KK_FLEET_PORT_OFFSET: '33000'}
const encode = (values: Record<string, string>) => Object.entries(values).flat().join('\0') + '\0'

it('uses admitted instance names for every operator role and its service port', () => {
  const scope = admittedScope('/owned', encode(settings), {KK_FLEET_INSTANCE: 'cert1'})
  expect(scope.offset).toBe(33000)
  expect(scopedContainer(scope, 'accountant', '2')).toEqual({name: 'kki-cert1-swarm-accountant-2', service: 'keykeeper-accountant-2', port: '8080/tcp'})
  expect(scopedContainer(scope, 'keykeeper', '5')).toEqual({name: 'kki-cert1-swarm-node-5', service: 'keykeeper-node-5', port: '8080/tcp'})
  expect(scopedContainer(scope, 'verifier', '3')).toEqual({name: 'kki-cert1-swarm-verifier-3', service: 'keykeeper-verifier-3', port: '8081/tcp'})
})
it('retains the default fleet naming and explicit project', () => {
  const scope = admittedScope('/owned', '', {COMPOSE_PROJECT_NAME: 'original-project'})
  expect(scope).toEqual({root: '/owned', prefix: 'keykeeper', project: 'original-project', instance: '', offset: 0})
  expect(scopedContainer(scope, 'keykeeper', '1').name).toBe('keykeeper-swarm-node-1')
})
it.each(['', '0', '-1', '1;docker', '1/other', '1000'])('refuses an invalid local operator index %s', index => {
  expect(() => scopedContainer(admittedScope('/owned', '', {}), 'accountant', index)).toThrow()
})
it.each([
  {KK_FLEET_INSTANCE: 'other'}, {KK_FLEET_CN_PREFIX: 'keykeeper'}, {COMPOSE_PROJECT_NAME: 'default'},
  {KK_FLEET_PORT_OFFSET: '0'}, {KK_FLEET_PORT_OFFSET: '46001'}, {KK_FLEET_PORT_OFFSET: '33000.5'},
])('refuses inconsistent admitted scope %j', overrides => {
  expect(() => admittedScope('/owned', encode({...settings, ...overrides}), {KK_FLEET_INSTANCE: 'cert1'})).toThrow()
})
it.each(['unterminated', 'KEY\0', 'KEY\0value\0KEY\0other\0'])('refuses malformed admission output', output => {
  expect(() => admittedScope('/owned', output, {})).toThrow()
})
it('runs admission in the actual checkout and refuses a failed guard without a fallback', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sdk-fleet-scope-'))); roots.push(root)
  mkdirSync(join(root, 'lab/e2e'), {recursive: true})
  const script = join(root, 'lab/e2e/prepare-instance-env.sh')
  writeFileSync(script, '#!/bin/bash\n[ "$1" = "$EXPECTED_ROOT" ] || exit 71\nexit 0\n')
  const physical = resolveFleetScope(root, {PATH: process.env.PATH, EXPECTED_ROOT: root})
  expect(physical.instance).toBe('')
  writeFileSync(script, '#!/bin/bash\necho "private guard diagnostics" >&2\nexit 72\n')
  expect(() => resolveFleetScope(root, {PATH: process.env.PATH})).toThrow('Fleet checkout, instance or endpoint admission failed')
})
