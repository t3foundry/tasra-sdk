import {execFileSync, spawnSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const git = args => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim()
const mode = process.argv[2]
function requireVisibleIndex() {
  // Status intentionally trusts these flags, so a clean status alone cannot
  // establish that verification reads the committed content.
  const hidden = git(['ls-files', '-v', '-z']).split('\0').some(entry => /^(?:[a-z]|S) /.test(entry))
  if (hidden) throw new Error('Clear assume-unchanged/skip-worktree index flags before pushing; they can hide uncommitted verification inputs.')
}
function checkPush(input, head) {
  let updates = 0
  for (const line of input.trim().split('\n').filter(Boolean)) {
    const fields = line.trim().split(/\s+/)
    if (fields.length !== 4) throw new Error('Invalid pre-push ref information.')
    const [, localOid] = fields
    if (/^0+$/.test(localOid)) continue // Deleting a remote ref sends no implementation.
    if (!/^[0-9a-f]{40,64}$/.test(localOid)) throw new Error('Invalid pre-push object ID.')
    if (git(['rev-parse', `${localOid}^{commit}`]) !== head) throw new Error('Push the checked-out commit separately. Other branch/tag tips need verification in their own checkout.')
    updates++
  }
  return updates
}
function main() {
  if (!['pre-commit', 'pre-push'].includes(mode)) throw new Error('Unknown Git verification hook.')
  let head
  if (mode === 'pre-push') {
    const input = readFileSync(0, 'utf8')
    head = git(['rev-parse', 'HEAD'])
    if (!checkPush(input, head)) return
    requireVisibleIndex()
    if (git(['status', '--porcelain', '--untracked-files=all'])) throw new Error('Commit or set aside pending changes before pushing. Verification must cover the committed files being pushed.')
  }
  // Git exports repository/index variables in hooks. Never leak those into the
  // verifier's isolated fixture repositories (or npm's packed-app tests).
  const env = {...process.env}
  for (const key of git(['rev-parse', '--local-env-vars']).split('\n')) delete env[key]
  console.log(mode === 'pre-commit' ? 'Automatic quick checks (working tree; full verification runs before push).' : 'Automatic full verification before push.')
  const result = spawnSync(process.execPath, [join(root, 'scripts/verify.mjs'), ...(mode === 'pre-commit' ? ['--quick'] : [])], {cwd: root, env, stdio: 'inherit'})
  if (result.error) throw result.error
  if (result.status !== 0) { process.exitCode = result.status ?? 1; return }
  if (mode === 'pre-push') requireVisibleIndex()
  if (mode === 'pre-push' && (git(['rev-parse', 'HEAD']) !== head || git(['status', '--porcelain', '--untracked-files=all']))) throw new Error('Checkout changed during verification. Retry the push on the final committed tree.')
}
try { main() }
catch (error) { console.error(`Automatic verification stopped: ${error.message}`); process.exitCode = 1 }
