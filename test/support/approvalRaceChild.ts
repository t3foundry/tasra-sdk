// Child process for the multi-process retained-approval test (test/specs/app-claim-race.test.ts).
//
// Usage: node --import tsx approvalRaceChild.ts <stateDir> <barrier|-> <action> <reply>
//   action: `first` (sign, retain, deliver) or `resume` (reconcile from the durable files)
//   reply:  what the agent does with this process's send: `busy` (429 with a 100 s hint, which does
//           not fit the 30 s deadline), `accept` (204), or `die` (the process exits mid-send, so
//           the outcome is unknown and the generation stays in flight)
// Every process opens its OWN fresh file store over the shared directory, so everything it acts on
// was reloaded from disk. Each send appends the exact body to `<stateDir>/../sends-<stateDir name>`.
// Prints one JSON line: {outcome} or {error, code, reason, generation}.
import {appendFileSync, existsSync} from 'node:fs'
import {basename, dirname, join} from 'node:path'
import {createFileStore} from '../../src/app/node.js'
import {reconcileRetainedApproval, retainAndDeliverApproval, type ApprovalJournalRecord} from '../../src/app/paid-approval.js'
import {systemPacingClock} from '../../src/chain/paidPacing.js'
import type {RegisteredPaidAgentSession, RetainedPaidApproval} from '../../src/chain/registeredPaidAgent.js'

const [stateDir, barrier, action, reply] = process.argv.slice(2)
if (!stateDir || !barrier || !action || !reply) throw new Error('usage: approvalRaceChild <stateDir> <barrier|-> <first|resume> <busy|accept|die>')
const sends = join(dirname(stateDir), 'sends-' + basename(stateDir))
const key = 'wallet-' + 'ab'.repeat(32) + '-presentation_sign-0', proposalId = 'cd'.repeat(32)
const store = createFileStore(stateDir)
const session = {
  sessionId: 'ab'.repeat(32), pacing: {clock: systemPacingClock, attemptBudgetMs: 5_000},
  sendRetainedApproval: async (approval: RetainedPaidApproval) => {
    appendFileSync(sends, approval.body + '\n')
    if (reply === 'die') process.exit(9) // mid-send: the agent may or may not have it
    return reply === 'accept' ? {status: 'accepted' as const} : {status: 'busy' as const, httpStatus: 429 as const, hintMs: 100_000}
  },
  approvalState: async () => 'pending',
} as unknown as RegisteredPaidAgentSession
const ctx = {store, session, key, signal: new AbortController().signal}

process.stdout.write('ready\n')
if (barrier !== '-') while (!existsSync(barrier)) { /* spin on the start barrier */ }
try {
  const outcome = action === 'first'
    ? await retainAndDeliverApproval(ctx, {stage: 'presentation_sign'}, async () => ({proposalId,
      body: JSON.stringify({authorization: {signature: '0x01', nonce: process.pid}}), expires: Math.floor(Date.now() / 1000) + 30}))
    : await reconcileRetainedApproval(ctx, (await store.load<ApprovalJournalRecord>(key))!)
  process.stdout.write(JSON.stringify({outcome}) + '\n')
} catch (error) {
  const e = error as {name?: string; code?: string; reason?: string; generation?: number}
  process.stdout.write(JSON.stringify({error: e.name, code: e.code, reason: e.reason, generation: e.generation}) + '\n')
}
