// Certification-only: every metered settlement window of the workload names who was paid.
//
// A window is settled one of three ways, each leaving canonical evidence on chain:
//   - a pushed bundle: `BundleSettled(slot, nonce, recipients[], amounts[])`, whose amounts are
//     credited to the recipients in the same transaction and sum to the window's `Settled.totalPaid`;
//   - a per-slot claim root: `BundleRootSettled(slot, nonce, root, total)`;
//   - a consolidated batch: `ConsolidatedSettled(batchId, root, total, coveredCount)` in the same
//     transaction as the slot's `SettlementWindow`.
// Anything else (a window without recipient evidence, a bundle that pays more or less than the
// slot was charged, a zero claim root) fails the gate.
import assert from 'node:assert/strict'
import {closeSync, fsyncSync, openSync, writeFileSync} from 'node:fs'
import {dirname} from 'node:path'
import type {Address, Hex} from 'viem'

const json = (value: unknown) => JSON.stringify(value, (_key, v: unknown) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n'
/** Write private evidence once (never overwritten), flushed with its directory. */
export function saveCertificationEvidence(file: string, value: unknown) {
  const fd = openSync(file, 'wx', 0o600)
  try {writeFileSync(fd, json(value)); fsyncSync(fd)} finally {closeSync(fd)}
  const parent = openSync(dirname(file), 'r'); try {fsyncSync(parent)} finally {closeSync(parent)}
}

const ZERO32 = `0x${'00'.repeat(32)}`
const key = (slot: Hex, nonce: bigint) => `${slot.toLowerCase()}|${nonce}`

/** One settlement window of a slot, as `SettlementWindow` logged it. */
export interface WindowEvent {slot: Hex; nonce: bigint; baseNonce: bigint; transactionHash: Hex}
/** A pushed bundle with the amount the slot was charged for it (`Settled.totalPaid` of the same transaction). */
export interface BundleEvent {slot: Hex; nonce: bigint; recipients: readonly Address[]; amounts: readonly bigint[]; totalPaid: bigint; transactionHash: Hex}
/** A per-slot claim root. */
export interface RootEvent {slot: Hex; nonce: bigint; root: Hex; total: bigint; transactionHash: Hex}
/** A consolidated batch. */
export interface ConsolidatedEvent {batchId: Hex; root: Hex; total: bigint; coveredCount: bigint; transactionHash: Hex}
export interface RecipientEvidence {windows: WindowEvent[]; bundles: BundleEvent[]; roots: RootEvent[]; consolidated: ConsolidatedEvent[]}

/**
 * Every window has exactly one kind of recipient evidence, and that evidence is consistent.
 * Returns, per window, how it was settled and (where the chain states it) what the slot was charged.
 */
export function requireRecipientCoverage(evidence: RecipientEvidence): Array<{slot: Hex; nonce: bigint; kind: 'bundle' | 'root' | 'consolidated'; charged?: bigint}> {
  const {windows, bundles, roots, consolidated} = evidence
  assert(windows.length <= 4096, 'Unbounded settlement window evidence')
  const seen = new Set<string>()
  const bundleBy = new Map<string, BundleEvent>(), rootBy = new Map<string, RootEvent>()
  for (const b of bundles) { assert(!bundleBy.has(key(b.slot, b.nonce)), 'Duplicate bundle for one settlement window'); bundleBy.set(key(b.slot, b.nonce), b) }
  for (const r of roots) { assert(!rootBy.has(key(r.slot, r.nonce)), 'Duplicate claim root for one settlement window'); rootBy.set(key(r.slot, r.nonce), r) }
  const out: ReturnType<typeof requireRecipientCoverage> = []
  for (const w of windows) {
    const id = key(w.slot, w.nonce)
    assert(!seen.has(id), 'Settlement window logged twice'); seen.add(id)
    assert(w.nonce > w.baseNonce, 'Settlement window does not advance its cursor')
    const bundle = bundleBy.get(id), root = rootBy.get(id)
    const batch = consolidated.filter(c => c.transactionHash.toLowerCase() === w.transactionHash.toLowerCase())
    assert.equal([bundle, root, batch.length ? batch : undefined].filter(v => v !== undefined).length, 1, 'Settlement window needs exactly one kind of recipient evidence')
    if (bundle) {
      assert.equal(bundle.transactionHash.toLowerCase(), w.transactionHash.toLowerCase(), 'Bundle belongs to another transaction')
      assert(bundle.recipients.length === bundle.amounts.length && bundle.recipients.length > 0 && bundle.recipients.length <= 256, 'Malformed recipient bundle')
      assert.equal(new Set(bundle.recipients.map(r => r.toLowerCase())).size, bundle.recipients.length, 'Recipient paid twice in one bundle')
      assert(bundle.recipients.every(r => !/^0x0{40}$/i.test(r)) && bundle.amounts.every(a => a >= 0n), 'Invalid recipient or amount')
      assert.equal(bundle.amounts.reduce((sum, a) => sum + a, 0n), bundle.totalPaid, 'Recipients were paid more or less than the slot was charged')
      out.push({slot: w.slot, nonce: w.nonce, kind: 'bundle', charged: bundle.totalPaid})
    } else if (root) {
      assert.equal(root.transactionHash.toLowerCase(), w.transactionHash.toLowerCase(), 'Claim root belongs to another transaction')
      assert(root.root.toLowerCase() !== ZERO32 || root.total === 0n, 'A charged window needs a claim root')
      out.push({slot: w.slot, nonce: w.nonce, kind: 'root', charged: root.total})
    } else {
      assert.equal(batch.length, 1, 'One consolidated batch per transaction')
      assert(batch[0]!.coveredCount > 0n && (batch[0]!.root.toLowerCase() !== ZERO32 || batch[0]!.total === 0n), 'A charged consolidated batch needs a claim root')
      out.push({slot: w.slot, nonce: w.nonce, kind: 'consolidated'})
    }
  }
  for (const id of [...bundleBy.keys(), ...rootBy.keys()]) assert(seen.has(id), 'Recipient evidence without its settlement window')
  return out
}
