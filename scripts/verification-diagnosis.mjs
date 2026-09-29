import {readFileSync, writeFileSync, existsSync} from 'node:fs'
import {join, resolve, relative} from 'node:path'

export function diagnose(report, logs = {}) {
  const failed = (report.stages ?? []).find(s => s.status === 'failed')
  if (!failed) return {status: report.status, classification: report.status === 'passed' ? 'no-failure' : 'unclassified', reproduction: 'Not attempted by diagnosis; inspect execution evidence.', likelyCause: report.error ? 'The runner reported an error; inspect report.json.' : 'No failed stage recorded.', nextAction: report.status === 'passed' ? 'Inspect security, mutation and performance evidence; reconcile with requirements.' : 'Inspect runner/environment and unexecuted checks before retrying.'}
  const log = logs[failed.id] ?? ''
  const environment = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EACCES|EPERM|ENOSPC|Cannot find package|command not found/.test(log)
  const assertion = /ERR_ASSERTION|AssertionError|AssertionError:|expected .+ to|FAIL\s+test\//.test(log)
  const classification = failed.timedOut || failed.aborted ? 'interrupted' : environment ? 'possible-environment-failure' : assertion ? 'behavioral-failure' : 'check-failure'
  return {status: report.status, failedStage: failed.id, classification, exitCode: failed.exitCode,
    reproduction: 'Observed once by this run; independent reproduction not yet established.',
    likelyCause: classification === 'possible-environment-failure' ? 'Log contains an environment error marker; this is a hypothesis, not an exemption.' : classification === 'interrupted' ? 'Timeout or cancellation prevented verification.' : 'The named check rejected the candidate; inspect its assertions and surrounding code.',
    nextAction: `Reproduce ${failed.id} on these inputs; compare an appropriate baseline, fix the demonstrated cause, add regression protection where feasible, then run full verification.`}
}
export function writeDiagnosis(root, report, runDirectory, outputDirectory) {
  const logs = {}
  for (const stage of report.stages ?? []) {
    if (!stage.log || stage.status !== 'failed') continue
    // Derive the known stage log path; never follow a report-supplied path.
    if (!/^[a-z0-9:_-]+$/i.test(stage.id)) continue
    const path = join(runDirectory, stage.id + '.log')
    if (existsSync(path)) logs[stage.id] = readFileSync(path, 'utf8').slice(-100_000)
  }
  const diagnosis = {...diagnose(report, logs), runId: report.runId, source: report.sourceAfter ?? report.sourceBefore}
  writeFileSync(join(outputDirectory, 'diagnosis.json'), JSON.stringify(diagnosis, null, 2) + '\n', {mode: 0o600})
  const evidence = relative(outputDirectory, resolve(runDirectory, 'report.json'))
  const lines = ['# Verification follow-up', '', `Run: ${report.runId}`, `Classification: ${diagnosis.classification}`, '', `Observed: ${diagnosis.failedStage ?? report.status}`, '', diagnosis.reproduction, '', `Likely cause: ${diagnosis.likelyCause}`, '', `Next action: ${diagnosis.nextAction}`, '', `[Execution evidence](${evidence})`, '', 'See CONTRIBUTING.md. Diagnose from execution evidence; automated classification is provisional.']
  writeFileSync(join(outputDirectory, 'diagnosis.md'), lines.join('\n') + '\n', {mode: 0o600})
  return diagnosis
}
