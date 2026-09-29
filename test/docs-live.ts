// Explicitly opted-in local acceptance: installs the packed artifact in a fresh app.
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'

if (process.env.TASRA_ALLOW_NETWORK_TRANSACTIONS !== '1') throw new Error('Set TASRA_ALLOW_NETWORK_TRANSACTIONS=1 only after authorizing transactions and creator funding on the selected network')

const root = resolve(import.meta.dirname, '..')
const scratch = mkdtempSync(join(tmpdir(), 'tasra-shared-account-'))
const output = resolve(root, process.env.TASRA_DOCS_EVIDENCE ?? '.tasra/docs-evidence')
const run = (command: string, args: string[], cwd = scratch, extraEnv = {}) =>
  execFileSync(command, args, {cwd, env: {...process.env, ...extraEnv}, stdio: 'inherit', timeout: 1_200_000})
const version = (name: string) => (JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')) as {version: string}).version
const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')

console.log(`Fresh application: ${scratch}`)
run('npm', ['pack', '--ignore-scripts', '--pack-destination', scratch, '--loglevel', 'error'], root)
const artifact = readdirSync(scratch).find(name => name.endsWith('.tgz'))!
writeFileSync(join(scratch, 'package.json'), JSON.stringify({name: 'tasra-docs-live', private: true, type: 'module'}))
run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(scratch, artifact)])
run('npm', ['install', '--save-dev', '--ignore-scripts', '--no-audit', '--no-fund', `tsx@${version('tsx')}`])
for (const file of ['tutorial-support.ts', 'tutorial-negative.ts', 'network.ts']) cpSync(join(scratch, 'node_modules/tasra-sdk/examples', file), join(scratch, file))
cpSync(join(scratch, 'node_modules/tasra-sdk/examples/shared-account.ts'), join(scratch, 'app.ts'))
run(process.execPath, ['--import', 'tsx', 'network.ts'], scratch)
run(process.execPath, ['--import', 'tsx', 'app.ts'], scratch)

// Copy only public evidence, never recovery files, keys, credentials or authorizations.
const runs = readdirSync(join(scratch, '.tasra')).filter(name => name.startsWith('shared-account-'))
if (runs.length !== 1) throw new Error('Expected exactly one example run')
const directory = join(scratch, '.tasra', runs[0]!)
const evidence = JSON.parse(readFileSync(join(directory, 'evidence.json'), 'utf8')) as {
  receipts: {user: string; nonce: number; from: string}[]; address: string
  mallory: {result: string; nonceBefore: number; nonceAfter: number}
}
if (evidence.receipts.map(r => r.user).join(',') !== 'alice,bob' ||
    evidence.receipts.map(r => r.nonce).join(',') !== '0,1' ||
    evidence.receipts.some(r => r.from.toLowerCase() !== evidence.address.toLowerCase()) ||
    evidence.mallory.result !== 'verifier-refused' || evidence.mallory.nonceBefore !== 2 || evidence.mallory.nonceAfter !== 2) {
  throw new Error('The walkthrough did not prove both signers and server-side denial')
}
mkdirSync(output, {recursive: true})
for (const name of ['evidence.json', 'alice-receipt.json', 'bob-receipt.json']) cpSync(join(directory, name), join(output, name))
writeFileSync(join(output, 'provenance.json'), JSON.stringify({
  checkedAt: new Date().toISOString(), node: process.version,
  sdk: (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {version: string}).version,
  tsx: version('tsx'),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
  sourceDirty: !!execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).trim(),
  packageSha256: hash(join(scratch, artifact)), exampleSha256: hash(join(scratch, 'app.ts')),
  sourceFiles: Object.fromEntries(['src/committee/ecdsa.ts', 'test/docs-live.ts'].map(file => [file, hash(join(root, file))])),
}, null, 2) + '\n')
console.log(`PASS: Alice + Bob confirmed, Mallory refused by verifier. Public evidence: ${output}`)
