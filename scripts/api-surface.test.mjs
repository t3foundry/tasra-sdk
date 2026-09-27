import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {publicSurface} from './api-surface.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'tasra-api-surface-'))
  t.after(() => rmSync(root, {recursive: true, force: true}))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({name: 'tasra-sdk', exports: {'.': {types: './dist/index.d.ts'}}}))
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({compilerOptions: {target: 'ES2022'}, include: ['src']}))
  return root
}

void test('public surface detects new exports and changed signatures', t => {
  const root = fixture(t)
  writeFileSync(join(root, 'src/index.ts'), 'export function policy(input: string): boolean {return !!input}')
  const before = publicSurface(root)
  writeFileSync(join(root, 'src/index.ts'), 'export function policy(input: number): boolean {return !!input}\nexport const added = 1')
  const after = publicSurface(root)
  assert.equal(after.length, before.length + 1)
  assert.notEqual(after.find(e => e.id === before[0].id).shape, before[0].shape)
  assert.ok(after.some(e => e.id === 'tasra-sdk#added'))
})

void test('contract snapshot detects changes in a referenced non-exported interface', t => {
  const root = fixture(t)
  const source = amount => `interface InternalOptions { amount: ${amount} }\nexport function transfer(options: InternalOptions): void { void options }`
  writeFileSync(join(root, 'src/index.ts'), source('number'))
  const before = publicSurface(root, {includeContracts: true})
  writeFileSync(join(root, 'src/index.ts'), source('string'))
  assert.notDeepEqual(publicSurface(root, {includeContracts: true}), before)
})

void test('contract emission accepts JSON imports while requiring every source declaration', t => {
  const root = fixture(t)
  writeFileSync(join(root, 'package.json'), JSON.stringify({name: 'tasra-sdk', type: 'module', exports: {'.': {types: './dist/index.d.ts'}}}))
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({compilerOptions: {target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', resolveJsonModule: true, outDir: 'dist', rootDir: 'src'}, include: ['src']}))
  writeFileSync(join(root, 'src/data.json'), '{"value":1}')
  writeFileSync(join(root, 'src/index.ts'), 'import data from "./data.json" with {type:"json"}; export function readValue(): number {return data.value}')
  assert.equal(publicSurface(root, {includeContracts: true}).exports.length, 1)
})
