// E2E: AUDIT + METERING on the prod fleet.
//
// A sovereign client creates a FROST slot, signs N times through one coordinator,
// then asserts that node's sign-audit log and the metering view (derived from
// sign_audit, the data accountants pull to bill) both reflect exactly those ops.
//
// Audit uses `audit:read`; meters require the registered accountant's signature.
// Run: tsx test/e2e/audit-metering.ts

import {randomBytes} from 'node:crypto'
import {committeeSign} from '../../src/committee/client.ts'
import {Suite} from '../fleet/_assert.ts'
import {discoverCommittee, gate, keeperSlotN, loadFleetConfig, mintLocalJwt, mintAdminJwt, provisionRule} from '../fleet/_fleet.ts'
import {authorizeWallet,createWalletSlot, WALLET_RULE as SLOT_DCQL_RULE} from '../fleet/_wallet.ts'
import {readAccountantMetering} from '../fleet/_metering.ts'

const cfg = loadFleetConfig()
const s = new Suite('e2e: audit + metering')

if (!(await gate(s, cfg))) {
  s.done()
  process.exit(0)
}

const SUBJECT = 'did:demo:audit-e2e'
const N = 4
const K = 3
// ⚠⚠ SIZE THE COMMITTEE OFF THE REGISTRY, NOT OFF HTTP. This read `n: cfg.nodeUrls.length` until
//    2026-09-29 and reverted `InsufficientFilteredPool(4, 5)` on a fleet whose five keeper
//    containers were all healthy — one of them was unbonding, so the chain could seat only four.
//    `keeperSlotN` bounds n by BOTH views; see its note for why scaling the fleet cannot fix it.
const pool = await keeperSlotN(cfg)
s.info(`keeper pool: ${pool.reachable} reachable, ${pool.eligible} ${pool.tag}-tagged active → n=${pool.n}`)
if (!s.ok(`keeper pool can seat a ${K}-of-n committee`, pool.n >= K,
  `only ${pool.n} keeper(s) are both reachable and ${pool.tag}-tagged active; need ${K}`)) {
  s.done()
  process.exit(1)
}
const created = await createWalletSlot(cfg,'frost',K,pool.n,SLOT_DCQL_RULE)
const {slotId,ruleSalt,creatorKey} = created
s.ok('client created a FROST slot (commit-reveal)', /^0x[0-9a-f]{64}$/.test(slotId))

// wait for the key
let committee: string[] = []
let ready = false
for (let i = 0; i < 45 && !ready; i++) {
  committee = await discoverCommittee(cfg, slotId)
  for (const u of committee) {
    const r = (await (await fetch(`${u}/v1/keys/${slotId}/public`)).json()) as {group_public_key?: string}
    if (r.group_public_key) {
      ready = true
      break
    }
  }
  if (!ready) await new Promise(r => setTimeout(r, 2000))
}
s.ok('committee DKG anchored the key', ready, `committee=${committee.length}`)

const adminJwt = mintAdminJwt(cfg)
const prov = await provisionRule(committee, slotId, SLOT_DCQL_RULE, ruleSalt, adminJwt)
s.ok('provisioned the rule + salt on the committee', prov.ok, prov.errors.join('; '))

// JWT carries the sign scope + audit:read, under a known subject
const jwt = mintLocalJwt(cfg, {sub: SUBJECT, scope: ['audit:read']})
const subjects = new Set<string>()
let coord = ''
for (let i = 0; i < N; i++) {
  const message = randomBytes(32)
  const grant = await authorizeWallet(cfg,slotId,creatorKey,{action:'sign',message})
  if (coord && coord !== grant.coordinatorUrl) throw new Error('Audit coordinator changed during the original paid batch')
  coord = grant.coordinatorUrl
  await committeeSign({nodeUrl:coord,committeeToken:grant.compound_token,verifierProofs:grant.verifierProofs,evidenceCt:grant.evidenceCt,
    approveExecution:grant.approveExecution,message})
  subjects.add(grant.compound_token.vp_hash)
  grant.dispose()
}
s.ok('served the signed paid coordinator',!!coord)
s.eq(`performed ${N} signs`,subjects.size,N)

// ── audit log on the coordinator reflects the signs ───────────────────────────
const auth = {Authorization: `Bearer ${jwt}`}
const countRes = (await (await fetch(`${coord}/v1/audit/${slotId}/count`, {headers: auth})).json()) as {count?: number; total?: number}
const auditCount = countRes.count ?? countRes.total ?? 0
s.ok('audit count reflects the signs', auditCount >= N, `count=${auditCount}`)

const listRes = (await (await fetch(`${coord}/v1/audit/${slotId}`, {headers: auth})).json()) as {entries: Array<{subject: string; outcome: string; message_sha256: string}>}
s.ok('audit list returns entries', (listRes.entries?.length ?? 0) >= N, `entries=${listRes.entries?.length}`)
s.ok('audit entries name the served presentations and successful outcomes', listRes.entries.slice(0, N).every(e => subjects.has(e.subject) && e.outcome === 'success'))
s.ok('audit entries have distinct message digests', new Set(listRes.entries.map(e => e.message_sha256)).size >= N)

// ── metering (derived from sign_audit) reflects the retrievals ────────────────
const meter = await readAccountantMetering(cfg, coord, slotId)
s.ok('metering total reflects the signs', meter.total >= N, `total=${meter.total}`)
const count = meter.by_subject?.filter(r => subjects.has(r.subject)).reduce((sum,r) => sum+r.count,0)
s.eq('metering attributes the operations to the served wallet presentations', count, N)

// unauthorized: a JWT WITHOUT audit:read must be denied
const noScope = mintLocalJwt(cfg, {sub: SUBJECT, scope: ['EmployeeOf:dept=Engineering']})
const denied = await fetch(`${coord}/v1/audit/${slotId}/count`, {headers: {Authorization: `Bearer ${noScope}`}})
s.ok('audit denied without audit:read scope', denied.status === 401 || denied.status === 403, `HTTP ${denied.status}`)
const bearer = await fetch(`${coord}/v1/metering/${slotId}`, {headers: auth})
s.eq('retired bearer metering route is absent', bearer.status, 404)
const unsigned = await fetch(`${coord}/v1/metering/${slotId}/signed`, {headers: auth})
s.eq('bearer cannot replace accountant metering signature', unsigned.status, 403)

s.done()
