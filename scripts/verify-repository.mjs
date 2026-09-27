import {readFileSync, existsSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {join, dirname} from 'node:path'
import {builtinModules} from 'node:module'
import ts from 'typescript'
import {publicationFindings, loadPublication} from './publication.mjs'
import {parseDocument} from 'yaml'

export function sourceFindings(file, source) {
  const findings = [], ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const isBuiltin = name => name.startsWith('node:') || builtinModules.includes(name)
  const checkImport = name => {
    if (file.startsWith('src/') && file !== 'src/chain/node.ts' && isBuiltin(name)) findings.push('Node built-in outside the explicit tasra-sdk/chain/node entry')
  }
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) checkImport(node.moduleSpecifier.text)
    if (ts.isCallExpression(node)) {
      if ((node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) checkImport(node.arguments[0].text)
      const callee = node.expression
      const property = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isElementAccessExpression(callee) && ts.isStringLiteral(callee.argumentExpression) ? callee.argumentExpression.text : undefined
      if (property === 'only' && (file.startsWith('test/') || file.endsWith('.test.mjs') || file.endsWith('.test.ts'))) findings.push('Focused test (.only) would invalidate suite coverage')
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return findings
}
export function workflowFindings(source, scripts) {
  const document = parseDocument(source, {uniqueKeys: true})
  if (document.errors.length) return document.errors.map(error => error.message)
  const workflow = document.toJS(), findings = []
  if (!workflow?.jobs || typeof workflow.jobs !== 'object') return ['Workflow has no jobs']
  for (const job of Object.values(workflow.jobs)) for (const step of job.steps ?? []) {
    if (step.uses?.startsWith('actions/upload-artifact@')) {
      const paths = String(step.with?.path ?? '').split(/\s+/).filter(Boolean)
      const approved = ['.verification/report.json', '.verification/quality/report.json', '.verification/mutation/report.json', '.verification/performance/report.json', 'coverage/', '.tasra/docs-evidence/evidence.json', '.tasra/docs-evidence/alice-receipt.json', '.tasra/docs-evidence/bob-receipt.json', '.tasra/docs-evidence/provenance.json']
      if (!paths.length || paths.some(path => !approved.includes(path))) findings.push('Artifact upload must not include unapproved files or unrestricted verification evidence')
    }
    if (typeof step.run !== 'string') continue
    for (const match of step.run.matchAll(/\bnpm run ([\w:-]+)/g)) if (!(match[1] in scripts)) findings.push(`Unknown npm script: ${match[1]}`)
    if (/\bnpm run (?:verify|ci)(?:\s|$)/.test(step.run) && (step['continue-on-error'] || job['continue-on-error'] || /\|\||\|\s*tee\b/.test(step.run))) findings.push('Verification exit status must not be suppressed')
  }
  return findings
}
export function checkRepository(root) {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {cwd: root}).toString().split('\0').filter(Boolean)
  const problems = publicationFindings(root)
  for (const file of files) {
    if (existsSync(join(root, file)) && /^(?:\.verification|\.tasra)\//.test(file)) problems.push(`Private state must not be tracked: ${file}`)
  }
  if (!problems.length) {
    const publicFiles = [...loadPublication(root), 'examples/document-signing/.gitignore', 'examples/document-signing/.npmignore']
    for (const file of files) if (existsSync(join(root, file)) && /^(?:docs|skills|examples)\//.test(file) && !publicFiles.includes(file)) problems.push(`Unreviewed public content: ${file}; classify it in publication.json or move it to private storage`)
  }
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const components = ['package.json', 'site/package.json', 'examples/document-signing/package.json']
  const discovered = [...new Set(files.filter(file => /(^|\/)package\.json$/.test(file) && existsSync(join(root, file))))].sort()
  if (JSON.stringify(discovered) !== JSON.stringify([...components].sort())) problems.push('Package inventory changed: update verification coverage deliberately: ' + discovered.join(', '))
  for (const file of ['package.json', 'site/package.json']) {
    const manifest = JSON.parse(readFileSync(join(root, file), 'utf8'))
    const lock = JSON.parse(readFileSync(join(root, dirname(file), 'package-lock.json'), 'utf8')).packages['']
    for (const field of ['name', 'version', 'dependencies', 'devDependencies', 'peerDependencies']) {
      const sorted = value => value && typeof value === 'object' ? JSON.stringify(Object.entries(value).sort()) : JSON.stringify(value)
      if (sorted(manifest[field]) !== sorted(lock[field])) problems.push(`${file}: lockfile disagrees with ${field}`)
    }
  }
  for (const file of [...new Set(files)]) {
    if (!existsSync(join(root, file))) continue
    if (/\.(?:ts|mjs)$/.test(file)) for (const problem of sourceFindings(file, readFileSync(join(root, file), 'utf8'))) problems.push(`${file}: ${problem}`)
    if (/^\.github\/workflows\/.*\.ya?ml$/.test(file)) for (const problem of workflowFindings(readFileSync(join(root, file), 'utf8'), packageJson.scripts)) problems.push(`${file}: ${problem}`)
  }
  for (const file of ['AGENTS.md', 'CONTRIBUTING.md', 'SECURITY.md']) {
    const text = readFileSync(join(root, file), 'utf8')
    for (const match of text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
      if (/^[a-z]+:/i.test(match[1])) continue
      if (!existsSync(join(root, dirname(file), match[1]))) problems.push(`${file}: missing link ${match[1]}`)
    }
  }
  return problems
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const findings = checkRepository(fileURLToPath(new URL('../', import.meta.url)))
  if (findings.length) { console.error(findings.join('\n')); process.exitCode = 1 }
  else console.log('Repository checks passed: package coverage, lock consistency, Node boundary, focused tests, workflow commands and review links.')
}
