import {expect, it} from 'vitest'
import {mkdtempSync, readFileSync, rmSync, statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type {PaidReservationRecord} from '../../src/chain/reservation.ts'
import {requireRecipientCoverage, saveCertificationEvidence} from '../verify/recipient-fees.ts'

const hex = (digit: string): `0x${string}` => `0x${digit.repeat(64)}`
function fixture() {
  const records = [1, 2].map(i => ({requestId: hex(String(i)), payment: {slot: hex('3')}})) as PaidReservationRecord[]
  const witness = {chain_id: 43112, slot: hex('3'), requests: records.map(r => ({id: r.requestId, settled: true,
    events: [{batch_id: hex('4'), transaction_hash: hex('5')}]}))}
  const proof = {schema: 1, chain_id: 43112, slot: hex('3'), verified: [{batch_id: hex('4'), transaction_hash: hex('5'), archive: '/private/archive.json', fees: '/private/fees.json'}]}
  return {records, witness, proof}
}
it('requires an independent proof of every original batch, including batched operations', () => {
  const {records, witness, proof} = fixture()
  expect(() => requireRecipientCoverage(witness, proof, records)).not.toThrow()
  witness.requests[1]!.events[0] = {batch_id: hex('6'), transaction_hash: hex('7')}
  expect(() => requireRecipientCoverage(witness, proof, records)).toThrow('Every original batch')
  proof.verified.push({batch_id: hex('6'), transaction_hash: hex('7'), archive: '/private/next-archive.json', fees: '/private/next-fees.json'})
  expect(() => requireRecipientCoverage(witness, proof, records)).not.toThrow()
})
it.each(['missing-request', 'substituted-request', 'unsettled', 'duplicate-event', 'missing-proof', 'wrong-transaction', 'wrong-batch', 'wrong-slot', 'wrong-chain', 'missing-archive'])(
  'refuses incomplete or substituted recipient evidence: %s', kind => {
    const {records, witness, proof} = fixture()
    if (kind === 'missing-request') witness.requests.pop()
    if (kind === 'substituted-request') witness.requests[0]!.id = hex('9')
    if (kind === 'unsettled') witness.requests[0]!.settled = false
    if (kind === 'duplicate-event') witness.requests[0]!.events.push(witness.requests[0]!.events[0]!)
    if (kind === 'missing-proof') proof.verified = []
    if (kind === 'wrong-transaction') proof.verified[0]!.transaction_hash = hex('8')
    if (kind === 'wrong-batch') proof.verified[0]!.batch_id = hex('8')
    if (kind === 'wrong-slot') proof.slot = hex('8')
    if (kind === 'wrong-chain') proof.chain_id = 43113
    if (kind === 'missing-archive') delete (proof.verified[0] as {archive?: string}).archive
    expect(() => requireRecipientCoverage(witness, proof, records)).toThrow()
  })
it('refuses a duplicated proof even when the number of proofs matches the batches', () => {
  const {records, witness, proof} = fixture()
  witness.requests[1]!.events[0] = {batch_id: hex('6'), transaction_hash: hex('7')}
  proof.verified.push({...proof.verified[0]!})
  expect(() => requireRecipientCoverage(witness, proof, records)).toThrow('Duplicate')
})
it('retains private evidence exclusively without overwriting an earlier original', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sdk-recipient-evidence-'))
  try {
    const file = join(dir, 'evidence.json')
    saveCertificationEvidence(file, {paid: 123n})
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({paid: '123'})
    expect(() => saveCertificationEvidence(file, {paid: 0n})).toThrow()
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({paid: '123'})
  } finally {rmSync(dir, {recursive: true, force: true})}
})
