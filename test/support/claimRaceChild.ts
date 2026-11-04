// Child process for the multi-process claim race (test/specs/app-claim-race.test.ts).
//
// Usage: node --import tsx claimRaceChild.ts <stateDir> <barrierDir> <rounds> <name>
// Prints `ready`, then for each round waits for `<barrierDir>/go-<round>`, races
// `claim(<entry>.claim.<round>)` on its OWN file store instance over the shared directory, and
// prints `<round> <true|false>`.
import {existsSync} from 'node:fs'
import {join} from 'node:path'
import {createFileStore} from '../../src/app/node.js'

const [stateDir, barrierDir, roundsText] = process.argv.slice(2)
if (!stateDir || !barrierDir || !roundsText) throw new Error('usage: claimRaceChild <stateDir> <barrierDir> <rounds> <name>')
const store = createFileStore(stateDir), rounds = Number(roundsText)
const entry = 'wallet-' + 'ab'.repeat(32) + '-presentation_sign-0'
process.stdout.write('ready\n')
for (let round = 1; round <= rounds; round++) {
  // Spin (no timer granularity) so both processes leave the barrier as close together as possible.
  while (!existsSync(join(barrierDir, `go-${round}`))) { /* wait for the barrier */ }
  const won = await store.claim!(`${entry}.claim.${round}`)
  process.stdout.write(`${round} ${won}\n`)
}
