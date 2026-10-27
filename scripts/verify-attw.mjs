import {execFileSync} from 'node:child_process'
import {unlinkSync, readdirSync, mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'

const root = fileURLToPath(new URL('../', import.meta.url))
const npm = process.env.npm_execpath
const npmBin = npm ? process.execPath : 'npm'
const npmArgs = npm ? [npm] : []

// Pack to a fresh temp directory so the tgz name is unambiguous.
const dest = join(tmpdir(), 'tasra-attw-' + randomUUID().slice(0, 8))
mkdirSync(dest, {recursive: true})

execFileSync(npmBin, [...npmArgs, 'pack', '--pack-destination', dest], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'inherit'],
  encoding: 'utf8',
})

const tgzFiles = readdirSync(dest).filter(f => f.endsWith('.tgz'))
if (tgzFiles.length !== 1) throw new Error(`Expected exactly one .tgz in ${dest}, found ${tgzFiles.length}`)
const tgzPath = join(dest, tgzFiles[0])

try {
  const attwBin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'attw.cmd' : 'attw')
  execFileSync(attwBin, [tgzPath, '--ignore-rules', 'cjs-resolves-to-esm'], {cwd: root, stdio: 'inherit'})
} finally {
  try { unlinkSync(tgzPath) } catch (_) { /* ignore cleanup errors */ }
}