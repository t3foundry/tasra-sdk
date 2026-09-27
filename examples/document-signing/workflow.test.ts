import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  Workflow,
  type SigningBackend,
  type RequestRecord,
  type SessionRecord,
} from './workflow.js'
import { Store, lockDirectory } from './store.js'
import { type Proof, digest } from './model.js'
const pdf = new TextEncoder().encode('%PDF-1.4\ntest')
const alice = `0x${'11'.repeat(32)}` as const,
  bob = `0x${'22'.repeat(32)}` as const
const network = {
  chainId: 43112,
  keyRegistry: `0x${'33'.repeat(20)}` as const,
  slots: { alice, bob },
}
function fixture(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), 'tasra-sign-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  let submitted = 0
  const backend: SigningBackend = {
    async open() {
      return {
        sessionId: 'test',
        pollSecret: 'private',
        requestUri: 'https://example.test/request',
        qrPayload: 'test',
        requestHash: alice,
        operation: {},
      } as SessionRecord
    },
    async sign(_, person, __, before) {
      before()
      submitted++
      return {
        name: person,
        slotId: network.slots[person],
        publicKey: alice,
        epoch: 1,
        r: alice,
        z: alice,
        receiptStatus: 'verified',
      } as Proof
    },
    async verify() {},
  }
  const store = new Store<RequestRecord>(root),
    workflow = new Workflow(store, backend, network)
  return {
    root,
    store,
    backend,
    workflow,
    count: () => submitted,
    create: () =>
      workflow.create({
        id: randomUUID(),
        title: 'Agreement',
        version: 1,
        pdf,
      }),
  }
}
void test('creation is idempotent, freezes bytes and hides sessions', async (t) => {
  const f = fixture(t),
    r = await f.create(),
    id = r.manifest.requestId
  assert.deepEqual(
    await f.workflow.create({ id, title: 'Agreement', version: 1, pdf }),
    r,
  )
  await assert.rejects(
    f.workflow.create({ id, title: 'Changed', version: 1, pdf }),
    /different content/,
  )
  await assert.rejects(f.workflow.prepare(id, 'alice', 'wrong'), /differs/)
  const p = await f.workflow.prepare(id, 'alice', await digest(pdf))
  assert.ok(!('sessions' in p))
  assert.ok(!JSON.stringify(p).includes('private'))
})
void test('Alice then Bob; concurrent retries sign once; state survives restart', async (t) => {
  const f = fixture(t),
    r = await f.create(),
    id = r.manifest.requestId,
    hash = r.manifest.documentSha256
  await assert.rejects(f.workflow.prepare(id, 'bob', hash), /Alice must/)
  const prepared = await f.workflow.prepare(id, 'alice', hash),
    attempt = prepared.signers.alice.attemptId!
  const [a, b] = await Promise.all([
    f.workflow.complete(id, 'alice', attempt),
    f.workflow.complete(id, 'alice', attempt),
  ])
  assert.deepEqual(a, b)
  assert.equal(f.count(), 1)
  const restarted = new Workflow(
    new Store<RequestRecord>(f.root),
    f.backend,
    network,
  )
  restarted.recover()
  assert.deepEqual(await restarted.complete(id, 'alice', attempt), a)
  assert.equal(f.count(), 1)
  await assert.rejects(
    restarted.complete(id, 'alice', 'old'),
    /another attempt/,
  )
  const pb = await restarted.prepare(id, 'bob', hash)
  assert.equal(
    (await restarted.complete(id, 'bob', pb.signers.bob.attemptId!)).status,
    'completed',
  )
  assert.equal(f.count(), 2)
  await assert.rejects(restarted.close(id, 'cancelled'), /Cannot close/)
})
void test('post-submission failure is uncertain and never automatically retried', async (t) => {
  const f = fixture(t),
    r = await f.create(),
    id = r.manifest.requestId
  f.backend.verify = async () => {
    throw new Error('Bad signature')
  }
  const p = await f.workflow.prepare(id, 'alice', r.manifest.documentSha256)
  await assert.rejects(
    f.workflow.complete(id, 'alice', p.signers.alice.attemptId!),
    /Bad signature/,
  )
  assert.equal(f.store.get(id).signers.alice.phase, 'uncertain')
  await assert.rejects(
    f.workflow.prepare(id, 'alice', r.manifest.documentSha256),
    /reconciliation/,
  )
  await assert.rejects(f.workflow.close(id, 'cancelled'), /Cannot close/)
  assert.equal(f.count(), 1)
})
void test('crash during opening or signing is preserved; active writer cannot be duplicated', async (t) => {
  const f = fixture(t),
    r = await f.create(),
    saved = f.store.get(r.manifest.requestId)
  saved.signers.alice.phase = 'signing'
  saved.signers.bob.phase = 'opening'
  f.store.save(saved)
  f.workflow.recover()
  const after = f.store.get(r.manifest.requestId)
  assert.equal(after.signers.alice.phase, 'uncertain')
  assert.equal(after.signers.bob.phase, 'uncertain')
  const unlock = lockDirectory(f.root)
  try {
    assert.throws(() => lockDirectory(f.root), /Another writer/)
  } finally {
    unlock()
  }
})
void test('credential refusal precedes submission and permits a fresh attempt', async (t) => {
  const f = fixture(t),
    r = await f.create(),
    id = r.manifest.requestId
  f.backend.sign = async () => {
    const e = new Error('Denied')
    e.name = 'AuthorizationRefused'
    throw e
  }
  const p = await f.workflow.prepare(id, 'alice', r.manifest.documentSha256)
  await assert.rejects(
    f.workflow.complete(id, 'alice', p.signers.alice.attemptId!),
    /Denied/,
  )
  assert.equal(f.store.get(id).signers.alice.phase, 'refused')
  assert.equal(f.count(), 0)
  const next = await f.workflow.prepare(id, 'alice', r.manifest.documentSha256)
  assert.notEqual(next.signers.alice.attemptId, p.signers.alice.attemptId)
  await assert.rejects(
    f.workflow.complete(id, 'alice', p.signers.alice.attemptId!),
    /another attempt/,
  )
})
void test('cancel and decline close unsigned work permanently', async (t) => {
  for (const state of ['cancelled', 'declined'] as const) {
    const f = fixture(t),
      r = await f.create()
    await f.workflow.close(
      r.manifest.requestId,
      state,
      state === 'declined' ? 'alice' : undefined,
    )
    await assert.rejects(
      f.workflow.prepare(
        r.manifest.requestId,
        'alice',
        r.manifest.documentSha256,
      ),
      /closed/,
    )
  }
})
