import {expect, it} from 'vitest'
import {mkdtempSync, readFileSync, rmSync, statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {requireRecipientCoverage, saveCertificationEvidence, type RecipientEvidence} from '../verify/recipient-fees.ts'

const hex = (digit: string): `0x${string}` => `0x${digit.repeat(64)}`
const address = (digit: string): `0x${string}` => `0x${digit.repeat(40)}`
/** Three windows: a pushed bundle, a per-slot claim root and a consolidated batch. */
function fixture(): RecipientEvidence {
  return {
    windows: [
      {slot: hex('1'), nonce: 2n, baseNonce: 0n, transactionHash: hex('a')},
      {slot: hex('2'), nonce: 5n, baseNonce: 0n, transactionHash: hex('b')},
      {slot: hex('3'), nonce: 1n, baseNonce: 0n, transactionHash: hex('c')},
    ],
    bundles: [{slot: hex('1'), nonce: 2n, recipients: [address('1'), address('2')], amounts: [15n, 5n], totalPaid: 20n, transactionHash: hex('a')}],
    roots: [{slot: hex('2'), nonce: 5n, root: hex('7'), total: 30n, transactionHash: hex('b')}],
    consolidated: [{batchId: hex('8'), root: hex('9'), total: 40n, coveredCount: 1n, transactionHash: hex('c')}],
  }
}
it('accepts every settlement path and states what a slot was charged where the chain says it', () => {
  expect(requireRecipientCoverage(fixture())).toEqual([
    {slot: hex('1'), nonce: 2n, kind: 'bundle', charged: 20n},
    {slot: hex('2'), nonce: 5n, kind: 'root', charged: 30n},
    {slot: hex('3'), nonce: 1n, kind: 'consolidated'},
  ])
  expect(requireRecipientCoverage({windows: [], bundles: [], roots: [], consolidated: []})).toEqual([])
})
it.each(['no-evidence', 'two-kinds', 'overpaid', 'underpaid', 'length-mismatch', 'duplicate-recipient', 'zero-recipient', 'empty-bundle',
  'bundle-other-tx', 'zero-root', 'root-other-tx', 'zero-consolidated-root', 'empty-consolidated', 'duplicate-window', 'stale-window',
  'orphan-bundle', 'duplicate-bundle'] as const)('refuses missing, inconsistent or substituted recipient evidence: %s', kind => {
  const e = fixture(), bundle = e.bundles[0]!, root = e.roots[0]!
  if (kind === 'no-evidence') e.bundles = []
  if (kind === 'two-kinds') e.roots.push({slot: hex('1'), nonce: 2n, root: hex('7'), total: 20n, transactionHash: hex('a')})
  if (kind === 'overpaid') bundle.amounts = [15n, 6n]
  if (kind === 'underpaid') bundle.amounts = [15n, 4n]
  if (kind === 'length-mismatch') bundle.amounts = [20n]
  if (kind === 'duplicate-recipient') bundle.recipients = [address('1'), address('1')]
  if (kind === 'zero-recipient') bundle.recipients = [address('1'), address('0')]
  if (kind === 'empty-bundle') { bundle.recipients = []; bundle.amounts = []; bundle.totalPaid = 0n }
  if (kind === 'bundle-other-tx') bundle.transactionHash = hex('d')
  if (kind === 'zero-root') root.root = hex('0')
  if (kind === 'root-other-tx') root.transactionHash = hex('d')
  if (kind === 'zero-consolidated-root') e.consolidated[0]!.root = hex('0')
  if (kind === 'empty-consolidated') e.consolidated[0]!.coveredCount = 0n
  if (kind === 'duplicate-window') e.windows.push({...e.windows[0]!})
  if (kind === 'stale-window') e.windows[0]!.baseNonce = 2n
  if (kind === 'orphan-bundle') e.bundles.push({...bundle, slot: hex('4')})
  if (kind === 'duplicate-bundle') e.bundles.push({...bundle})
  expect(() => requireRecipientCoverage(e)).toThrow()
})
it('retains private evidence exclusively without overwriting an earlier original', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sdk-recipient-evidence-'))
  try {
    const file = join(dir, 'evidence.json')
    saveCertificationEvidence(file, {charged: 123n})
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({charged: '123'})
    expect(() => saveCertificationEvidence(file, {charged: 0n})).toThrow()
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({charged: '123'})
  } finally {rmSync(dir, {recursive: true, force: true})}
})
