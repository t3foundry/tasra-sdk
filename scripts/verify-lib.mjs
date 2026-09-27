import {spawn, execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {mkdirSync, readFileSync, writeFileSync, lstatSync, readlinkSync, unlinkSync, openSync, closeSync} from 'node:fs'
import {join} from 'node:path'

export function fingerprint(root) {
  const names = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {cwd: root}).toString().split('\0').filter(Boolean)
  const hash = createHash('sha256')
  for (const name of [...new Set(names)].sort()) {
    hash.update(name + '\0')
    try {
      const path = join(root, name), stat = lstatSync(path)
      hash.update(String(stat.mode) + '\0')
      hash.update(stat.isSymbolicLink() ? readlinkSync(path) : readFileSync(path))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      hash.update('DELETED')
    }
    hash.update('\0')
  }
  return hash.digest('hex')
}

export function acquireLock(directory) {
  mkdirSync(directory, {recursive: true})
  const file = join(directory, 'lock')
  // Do not guess whether a stale PID belongs to another process. Recovery is explicit.
  let fd
  try { fd = openSync(file, 'wx', 0o600) }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Verification is already running, or .verification/lock is stale. Check its PID before removing it.', {cause: error})
    throw error
  }
  writeFileSync(fd, `${process.pid}\n`)
  closeSync(fd)
  return () => unlinkSync(file)
}

export async function runStage(stage, {cwd, log, signal, output = process.stdout, env = process.env}) {
  const start = Date.now()
  const fd = openSync(log, 'w', 0o600)
  let bytes = 0, truncated = false
  const write = chunk => {
    output?.write(chunk)
    if (bytes < 20 * 1024 * 1024) { writeFileSync(fd, chunk); bytes += chunk.length }
    else if (!truncated) { writeFileSync(fd, '\n[log truncated at 20 MiB; output continues in terminal]\n'); truncated = true }
  }
  return await new Promise(resolve => {
    let child, timer, killTimer, timedOut = false, aborted = false, settled = false, terminationComplete = false, pendingResult
    const finish = (code, childSignal, error) => {
      if (settled) return
      // A direct child may exit before its descendants; retain the lock until escalation.
      if ((timedOut || aborted) && !terminationComplete) { pendingResult = [code, childSignal, error]; return }
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      closeSync(fd)
      resolve({id: stage.id, command: [stage.command, ...stage.args], status: code === 0 && !timedOut && !aborted && !error ? 'passed' : 'failed',
        exitCode: code, signal: childSignal, timedOut, aborted, error: error?.message, durationMs: Date.now() - start, log})
    }
    const kill = kind => {
      if (!child?.pid) return
      try { process.platform === 'win32' ? child.kill(kind) : process.kill(-child.pid, kind) }
      catch (error) { if (error.code !== 'ESRCH') write(Buffer.from(`Termination failed: ${error.message}\n`)) }
    }
    const stop = () => {
      if (killTimer) return
      kill('SIGTERM')
      killTimer = setTimeout(() => {
        kill('SIGKILL')
        terminationComplete = true
        if (pendingResult) finish(...pendingResult)
      }, 1000)
    }
    const abort = () => { aborted = true; stop() }
    if (signal?.aborted) { finish(null, null, new Error('Verification cancelled')); return }
    try {
      child = spawn(stage.command, stage.args, {cwd, env, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']})
      child.stdout.on('data', write)
      child.stderr.on('data', write)
      child.once('error', error => finish(null, null, error))
      child.once('close', (code, childSignal) => finish(code, childSignal))
      signal?.addEventListener('abort', abort, {once: true})
      timer = setTimeout(() => { timedOut = true; stop() }, stage.timeoutMs)
    } catch (error) { finish(null, null, error) }
  })
}

export async function execute(stages, options) {
  const results = []
  for (const stage of stages) {
    if (results.some(result => result.status !== 'passed') || options.signal?.aborted) {
      results.push({id: stage.id, status: 'not_run'})
      continue
    }
    options.output?.write(`\n=== ${stage.id} ===\n`)
    results.push(await runStage(stage, {...options, log: join(options.directory, `${stage.id}.log`)}))
  }
  return {status: results.every(result => result.status === 'passed') && results.length > 0 ? 'passed' : 'failed', results}
}
