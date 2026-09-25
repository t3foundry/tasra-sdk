import {readFileSync, readdirSync, existsSync, statSync} from 'node:fs'
import {dirname, resolve} from 'node:path'

const root = resolve(import.meta.dirname, '..')
const markdown = (directory: string): string[] => readdirSync(directory).flatMap(name => {
  const file = resolve(directory, name)
  return statSync(file).isDirectory() ? markdown(file) : name.endsWith('.md') ? [file] : []
})
const files = [resolve(root, 'README.md'), resolve(root, 'CONTRIBUTING.md'), ...markdown(resolve(root, 'docs'))]
const withoutCode = (text: string) => text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '')
function anchors(file: string): Set<string> {
  const content = withoutCode(readFileSync(file, 'utf8'))
  const result = new Set([...content.matchAll(/<a\s+id="([^"]+)"/g)].map(match => match[1]!))
  const seen = new Map<string, number>()
  for (const match of content.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = match[1]!.trim().toLowerCase().replace(/[^\p{L}\p{N}\-_ ]/gu, '').replaceAll(' ', '-')
    const count = seen.get(base) ?? 0
    result.add(count ? `${base}-${count}` : base)
    seen.set(base, count + 1)
  }
  return result
}
const failures: string[] = []
for (const file of files) {
  const content = withoutCode(readFileSync(file, 'utf8'))
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1]!
    if (/^[a-z]+:/i.test(target)) continue
    const [path, anchor] = target.split('#')
    const destination = path ? resolve(dirname(file), path) : file
    if (!existsSync(destination)) failures.push(`${file}: missing ${target}`)
    else if (anchor && destination.endsWith('.md') && !anchors(destination).has(anchor)) failures.push(`${file}: missing anchor ${target}`)
  }
}
for (const [doc, marker, example] of [
  ['docs/getting-started.md', 'connect-local-example', 'examples/connect-local.ts'],
  ['docs/fuji.md', 'connect-fuji-example', 'examples/connect-fuji.ts'],
  ['docs/signing.md', 'slot-address-example', 'examples/slot-address.ts'],
]) {
  const snippet = readFileSync(resolve(root, doc!), 'utf8').match(new RegExp(`<!-- ${marker} -->\\s*\x60\x60\x60ts\\n([\\s\\S]*?)\x60\x60\x60`))?.[1]
  if (snippet?.trim() !== readFileSync(resolve(root, example!), 'utf8').trim()) failures.push(`${doc}: tutorial differs from ${example}`)
}
if (failures.length) throw new Error(failures.join('\n'))
console.log(`Documentation links/anchors: ${files.length} pages checked; tutorial sources match.`)
