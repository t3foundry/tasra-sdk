import {readFileSync, existsSync, lstatSync, realpathSync} from 'node:fs'
import {join, resolve, relative, sep} from 'node:path'

export const runtimePatterns = ['dist/**/*.js', 'dist/**/*.d.ts', 'dist/**/*.json']
export function loadPublication(root) {
  const manifest = JSON.parse(readFileSync(join(root, 'publication.json'), 'utf8'))
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Invalid publication manifest')
  for (const file of manifest.files) {
    if (typeof file !== 'string' || !/^(?:README\.md|CHANGELOG\.md|LICENSE|SECURITY\.md|(?:docs|skills|examples)\/[a-zA-Z0-9_./-]+)$/.test(file) || file.split('/').some(part => part.startsWith('.')) || /^(?:docs\/(?:evidence|modernization|development-verification|verification|RELEASING)|examples\/.*(?:node_modules|app\.js))/.test(file)) throw new Error(`Forbidden publication path: ${file}`)
    if (!existsSync(join(root, file)) || !lstatSync(join(root, file)).isFile() || !realpathSync(join(root, file)).startsWith(realpathSync(root) + sep)) throw new Error(`Missing, linked or non-file publication input: ${file}`)
    // Also reject parent directory symlinks, even if their target remains inside root.
    if (relative(realpathSync(root), realpathSync(join(root, file))) !== file) throw new Error(`Linked publication input: ${file}`)
  }
  if (new Set(manifest.files).size !== manifest.files.length) throw new Error('Duplicate publication inputs')
  return manifest.files
}
export function publicationFindings(root) {
  const findings = []
  try {
    const files = loadPublication(root)
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    if (JSON.stringify(pkg.files) !== JSON.stringify([...runtimePatterns, ...files])) findings.push('package.json files must match publication.json and the runtime patterns exactly')
  } catch (error) { findings.push(error.message) }
  return findings
}
export function publicDestination(root, file, target, allowed) {
  const [path, fragment] = target.split('#')
  let destination = resolve(file, '..', path)
  if (existsSync(destination) && lstatSync(destination).isDirectory()) destination = join(destination, 'README.md')
  const name = relative(root, destination)
  if (!allowed.includes(name)) throw new Error(`Unapproved publication link in ${relative(root, file)}: ${target}`)
  return {name, fragment}
}
