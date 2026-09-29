// Validate generated consumer routes and assets; a successful build alone
// does not guarantee that relative links resolve.
import {readdirSync, readFileSync, existsSync, statSync} from 'node:fs'
import {join, resolve, sep} from 'node:path'
const root = resolve(import.meta.dirname, 'dist')
const walk = directory => readdirSync(directory, {withFileTypes: true}).flatMap(entry => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)])
const missing = []
// Copied examples are source artifacts; their app routes exist only when run separately.
for (const file of walk(root).filter(file => file.endsWith('.html') && !file.startsWith(join(root, 'examples') + sep))) {
  const page = 'https://docs.invalid/' + file.slice(root.length + 1).replace(/index\.html$/, '')
  for (const match of readFileSync(file, 'utf8').matchAll(/(?:href|src)="([^"]+)"/g)) {
    const url = new URL(match[1].replaceAll('&amp;', '&'), page)
    if (url.origin !== 'https://docs.invalid') continue
    const target = resolve(root, '.' + decodeURIComponent(url.pathname))
    if (!target.startsWith(root + '/') && target !== root) { missing.push(`${file}: route escapes site`); continue }
    if (!existsSync(target) || (statSync(target).isDirectory() && !existsSync(join(target, 'index.html')))) missing.push(`${file.slice(root.length + 1)} → ${url.pathname}`)
  }
}
if (missing.length) { console.error('Broken generated site links:\n' + [...new Set(missing)].join('\n')); process.exitCode = 1 }
else console.log('Generated site links and asset routes passed.')
