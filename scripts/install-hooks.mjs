import {existsSync, readdirSync, realpathSync, chmodSync} from 'node:fs'
import {spawnSync, execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {join, resolve} from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
function install() {
  // Published packages and CI do not need developer Git configuration.
  if (process.env.CI && process.env.CI !== 'false') return
  if (!existsSync(join(root, '.git'))) return
  // A working tree COPIED without the git binary is not a developer environment either. A
  // container that installs this package through a `file:` dependency hits exactly that: npm runs
  // this `prepare` for linked local deps even under --ignore-scripts, `.git` rode along in the
  // build context so the check above passes, and git is absent from the base image. Hooks are a
  // convenience; never fail a consumer's install for them.
  const gitBinary = spawnSync('git', ['--version'])
  if (gitBinary.error || gitBinary.status !== 0) return
  const git = args => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim()
  if (realpathSync(git(['rev-parse', '--show-toplevel'])) !== realpathSync(root)) return
  const configured = spawnSync('git', ['config', '--get', 'core.hooksPath'], {cwd: root, encoding: 'utf8'})
  if (configured.error || ![0, 1].includes(configured.status)) throw new Error('Cannot inspect Git hooks configuration.')
  const hooksPath = configured.stdout.trim()
  if (hooksPath && hooksPath !== '.githooks') throw new Error(`Existing core.hooksPath (${hooksPath}) was preserved. Integrate the repository hooks with it before enabling automatic verification.`)
  if (!hooksPath) {
    const hooks = resolve(root, git(['rev-parse', '--git-path', 'hooks']))
    const existing = existsSync(hooks) ? readdirSync(hooks).filter(name => !name.endsWith('.sample')) : []
    if (existing.length) throw new Error(`Existing Git hooks were preserved (${existing.join(', ')}). Integrate them before enabling automatic verification.`)
  }
  for (const name of ['pre-commit', 'pre-push']) chmodSync(join(root, '.githooks', name), 0o755)
  if (!hooksPath) git(['config', '--local', 'core.hooksPath', '.githooks'])
  console.log('Automatic verification enabled: quick checks before commit; full checks before push.')
}
try { install() }
catch (error) { console.error(`Hook setup failed: ${error.message}`); process.exitCode = 1 }
