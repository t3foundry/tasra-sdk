// Controlled policy observations; these tests do not claim a deployed fleet.
import {expect, it} from 'vitest'
import {mkdtempSync, writeFileSync, symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {generatedInteger, ownedPublishedPort} from '../verify/_paid-wallet-config.ts'
import {readPaidConfigFile} from '../fleet/_paid-wallet.ts'

const root = '/owned/network', project = 'keykeeper-cert-original', service = 'keykeeper-accountant-1'
function observation() {
  return {Id: 'a'.repeat(64), Config: {Labels: {'com.docker.compose.project': project,
    'com.docker.compose.service': service, 'com.docker.compose.project.working_dir': root + '/lab'}},
  State: {Running: true}, NetworkSettings: {Ports: {'8080/tcp': [{HostIp: '0.0.0.0', HostPort: '19001'}, {HostIp: '::', HostPort: '19001'}]}}}
}

it('reads only the exact generated committee section and preserves its deployed value', () => {
  const text = '[unrelated]\nquorum = 17\n[chain] # generated\ncommittee_count = 3\nquorum = 2 # approved\n'
  expect(generatedInteger(text, 'chain', 'quorum')).toBe(2)
  expect(generatedInteger(text, 'chain', 'committee_count')).toBe(3)
})
it.each(['[chain]\nquorum = 2\nquorum = 3', '[chain]\nquorum = 2\n[chain]\nquorum = 3',
  '[other]\nquorum = 2', '[chain]\nquorum = "2"', '[chain]\nquorum = 9007199254740992'])('refuses ambiguous, missing or unsafe generated policy: %s', text => {
  expect(() => generatedInteger(text, 'chain', 'quorum')).toThrow()
})
it('refuses regexp fragments as generated policy identifiers', () => {
  expect(() => generatedInteger('[chain]\nquorum = 2', 'chain', '.*')).toThrow(/identifier/)
})
it('accepts one original running owned identity with matching dual-stack published ports', () => {
  expect(ownedPublishedPort(observation(), root, project, service, '8080/tcp')).toEqual({id: 'a'.repeat(64), port: 19001})
})
it.each(['com.docker.compose.project', 'com.docker.compose.service', 'com.docker.compose.project.working_dir'] as const)(
  'refuses a foreign checkout, project or service even when its container name matches: %s', key => {
    const value = observation(); value.Config.Labels[key] = 'foreign'
    expect(() => ownedPublishedPort(value, root, project, service, '8080/tcp')).toThrow(/foreign or archived/)
  })
it('refuses a stopped archival identity and truncated or missing IDs', () => {
  const value = observation(); value.State.Running = false
  expect(() => ownedPublishedPort(value, root, project, service, '8080/tcp')).toThrow(/running/)
  value.State.Running = true
  for (const id of ['', 'a'.repeat(12), '0'.repeat(64)]) {
    value.Id = id
    expect(() => ownedPublishedPort(value, root, project, service, '8080/tcp')).toThrow(/identity/)
  }
})
it('refuses ambiguous, missing, unbounded or nonlocal Docker port observations', () => {
  for (const bindings of [[], [{HostIp: '0.0.0.0', HostPort: '65536'}], [{HostIp: 'remote.example', HostPort: '19001'}],
    [{HostIp: '127.0.0.1', HostPort: '19001'}, {HostIp: '::', HostPort: '19002'}]]) {
    const value = observation(); value.NetworkSettings.Ports['8080/tcp'] = bindings
    expect(() => ownedPublishedPort(value, root, project, service, '8080/tcp')).toThrow()
  }
  expect(() => ownedPublishedPort(observation(), root, project, service, '8081/tcp')).toThrow()
})
it('reads only bounded regular original configuration files without following symlinks', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sdk-paid-config-control-')), original = join(directory, 'original.json')
  writeFileSync(original, '{"approved":true}')
  expect(readPaidConfigFile(original, 32)).toBe('{"approved":true}')
  const alias = join(directory, 'alias.json'); symlinkSync(original, alias)
  expect(() => readPaidConfigFile(alias, 32)).toThrow()
  expect(() => readPaidConfigFile(directory, 32)).toThrow()
  expect(() => readPaidConfigFile(original, 8)).toThrow(/bounded/)
  writeFileSync(original, Buffer.from([0xff]))
  expect(() => readPaidConfigFile(original, 32)).toThrow()
})

it('binds published routes to the admitted exact name and instance label', () => {
  const original = observation()
  const value = {...original, Name: '/kki-cert1-swarm-accountant-1', Config: {Labels: {...original.Config.Labels, 'kk.fleet.instance': 'cert1'}}}
  const identity = {name: 'kki-cert1-swarm-accountant-1', instance: 'cert1'}
  expect(ownedPublishedPort(value, root, project, service, '8080/tcp', identity).port).toBe(19001)
  expect(() => ownedPublishedPort({...value, Name: '/keykeeper-swarm-accountant-1'}, root, project, service, '8080/tcp', identity)).toThrow(/identity changed/)
  expect(() => ownedPublishedPort(value, root, project, service, '8080/tcp', {...identity, instance: 'other'})).toThrow(/another fleet instance/)
})
