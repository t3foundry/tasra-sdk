// Certification-only: preserve independent accountant evidence before fleet destruction.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {closeSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, writeFileSync} from 'node:fs'
import {dirname, join, relative} from 'node:path'
import {createPublicClient, http, parseAbiItem} from 'viem'
import type {PaidReservationRecord} from '../../src/chain/reservation.ts'
import type {FleetConfig} from '../fleet/_fleet.ts'
import {resolveFleetScope} from './_fleet-scope.ts'

export const RECIPIENT_FEE_TIMEOUT_MS = 300_000
const hex32 = /^0x[0-9a-f]{64}$/i
const json = (value: unknown) => JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n'
export function saveCertificationEvidence(file: string, value: unknown) {
  const fd = openSync(file, 'wx', 0o600)
  try {writeFileSync(fd, json(value)); fsyncSync(fd)} finally {closeSync(fd)}
  const parent = openSync(dirname(file), 'r'); try {fsyncSync(parent)} finally {closeSync(parent)}
}
const save = saveCertificationEvidence

/** Successful helper exit alone is insufficient: every original batch needs retained evidence. */
export function requireRecipientCoverage(witness: unknown, proof: unknown, records: PaidReservationRecord[]) {
  const w = witness as {chain_id: number; slot: string; requests: Array<{id: string; settled: boolean; events: Array<{batch_id: string; transaction_hash: string}>}>}
  const p = proof as {schema: number; chain_id: number; slot: string; verified: Array<{batch_id: string; transaction_hash: string; archive: string; fees: string}>}
  assert.equal(w.chain_id, 43112); assert.equal(p.schema, 1); assert.equal(p.chain_id, 43112)
  assert.equal(w.slot, records[0]!.payment.slot.toLowerCase()); assert.equal(p.slot, w.slot)
  assert.deepEqual(w.requests.map(r => r.id.toLowerCase()).sort(), records.map(r => r.requestId.toLowerCase()).sort(), 'Recipient proof omitted or substituted an original')
  const expected = new Map<string, string>()
  for (const request of w.requests) {
    assert.equal(request.settled, true); assert.equal(request.events.length, 1)
    const event = request.events[0]!
    assert.match(event.batch_id, hex32); assert.match(event.transaction_hash, hex32)
    const batch = event.batch_id.toLowerCase(), tx = event.transaction_hash.toLowerCase()
    if (expected.has(batch)) assert.equal(expected.get(batch), tx)
    expected.set(batch, tx)
  }
  assert.equal(p.verified.length, expected.size, 'Every original batch needs recipient evidence')
  const seen = new Set<string>()
  for (const item of p.verified) {
    const batch = item.batch_id.toLowerCase()
    assert(!seen.has(batch), 'Duplicate recipient proof'); seen.add(batch)
    assert.equal(expected.get(batch), item.transaction_hash.toLowerCase(), 'Recipient proof changed the canonical transaction')
    assert.equal(typeof item.archive, 'string'); assert.equal(typeof item.fees, 'string')
  }
}

export async function retainRecipientFees(cfg: FleetConfig, records: PaidReservationRecord[], output: string,
  networkRoot: string, sdkRoot: string, chainEnv: string) {
  assert(records.length > 0 && records.length <= 256)
  const scope = resolveFleetScope(networkRoot)
  const settlement = cfg.book.Settlement
  assert(settlement)
  const client = createPublicClient({transport: http(cfg.rpcUrl, {retryCount: 0, timeout: 15_000, fetchOptions: {redirect: 'error'}})})
  assert.equal(await client.getChainId(), 43112, 'Recipient proof refuses official networks')
  const deadline = Date.now() + RECIPIENT_FEE_TIMEOUT_MS
  const run = (name: string, helper: string, args: string[]) => {
    const remaining = deadline - Date.now(); assert(remaining > 0, 'Recipient evidence deadline elapsed; retain fleet')
    try {
      const stdout = execFileSync(process.execPath, [join(scope.root, 'lab/e2e/checks', helper), ...args],
        {cwd: scope.root, timeout: remaining, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']})
      writeFileSync(join(output, name + '.log'), stdout, {flag: 'wx', mode: 0o600})
    } catch { throw new Error('Independent recipient fee verification failed; retain fleet and private originals') }
  }
  const tickets = new Map<string, string>()
  for (const record of records) {
    assert.match(record.requestId, hex32); assert(!tickets.has(record.requestId))
    assert.equal(record.payment.chain_id, 43112)
    assert.equal(record.payment.settlement.toLowerCase(), settlement.toLowerCase())
    const file = join(output, 'ticket-' + record.requestId.slice(2) + '.private.json')
    save(file, record); tickets.set(record.requestId, file)
  }
  for (const [index, slot] of [...new Set(records.map(r => r.payment.slot))].entries()) {
    const selected = records.filter(r => r.payment.slot === slot)
    assert(selected.length <= 64, 'Slot exceeds the bounded recipient witness')
    const block = await client.getBlock()
    const logs = await client.getLogs({address: settlement, event: parseAbiItem('event Funded(bytes32 indexed slotId,address indexed from,uint256 amount,uint256 newBalance)'),
      args: {slotId: slot}, fromBlock: 0n, toBlock: block.number, strict: true})
    assert(logs.length > 0 && logs.every(l => !l.removed), 'Original slot funding missing')
    const funded = logs.reduce((sum, l) => sum + l.args.amount, 0n)
    assert.equal((await client.getBlock({blockNumber: block.number})).hash, block.hash, 'Funding observation reorganized')
    save(join(output, `funding-${index}.json`), {block: block.number, hash: block.hash, logs})
    const witnessFile = join(output, `conservation-${index}.json`), feeDir = join(output, `recipients-${index}`)
    run(`conservation-${index}`, 'prepaid-settlement.mjs', ['--rpc', cfg.rpcUrl, '--settlement', settlement, '--slot', slot,
      '--funded', funded.toString(), '--from-block', '0', '--allow-full-refund',
      ...selected.flatMap(r => ['--ticket', tickets.get(r.requestId)!]), '--out', witnessFile])
    run(`recipients-${index}`, 'prepaid-fees-fleet.mjs', ['--rpc', cfg.rpcUrl, '--sdk', sdkRoot, '--witness', witnessFile,
      '--configs', join(scope.root, 'lab/configs'), '--chain-env', chainEnv, '--out', feeDir])
    const proof = JSON.parse(readFileSync(join(feeDir, 'PASS.json'), 'utf8')) as {verified: Array<{archive: string; fees: string}>}
    requireRecipientCoverage(JSON.parse(readFileSync(witnessFile, 'utf8')), proof, selected)
    for (const item of proof.verified) for (const file of [item.archive, item.fees]) {
      const rel = relative(feeDir, file)
      assert(rel && !rel.startsWith('..') && !rel.startsWith('/'), 'Recipient evidence escaped its private directory')
      assert(lstatSync(file).isFile() && readFileSync(file).length > 0, 'Recipient evidence is absent')
    }
  }
  const manifest: Record<string, string> = {}
  for (const entry of readdirSync(output, {recursive: true, withFileTypes: true})) {
    assert(entry.isDirectory() || entry.isFile(), 'Recipient evidence cannot contain links')
    const file = join(entry.parentPath, entry.name)
    if (entry.isFile()) manifest[relative(output, file)] = createHash('sha256').update(readFileSync(file)).digest('hex')
    const fd = openSync(file, 'r'); try {fsyncSync(fd)} finally {closeSync(fd)}
  }
  save(join(output, 'RECIPIENT-MANIFEST.json'), manifest)
  return manifest
}
