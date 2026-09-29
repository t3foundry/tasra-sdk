// Publish only explicitly reviewed consumer documentation and example inputs.
import {readFileSync, mkdirSync, writeFileSync, cpSync, rmSync} from 'node:fs'
import {resolve, dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {loadPublication, publicDestination} from '../scripts/publication.mjs'

const route = name => '/' + (name.startsWith('docs/') ? name.slice(5) : 'source/' + name)
  .replace(/README\.md$/, '').replace(/\.md$/, '/').toLowerCase()
export function sync(root, content, publicDir) {
  const files = loadPublication(root)
  rmSync(content, {recursive: true, force: true}); rmSync(publicDir, {recursive: true, force: true})
  mkdirSync(content, {recursive: true}); mkdirSync(publicDir, {recursive: true})
  for (const name of files) {
    const file = join(root, name)
    if (name.startsWith('examples/') || !name.endsWith('.md')) {
      const target = join(publicDir, name); mkdirSync(dirname(target), {recursive: true}); cpSync(file, target)
      continue
    }
    const original = readFileSync(file, 'utf8'), title = /^# (.+)$/m.exec(original)?.[1] ?? name
    const body = original.replace(/^# .+\n/, '').replace(/\]\(([^)]+)\)/g, (match, target) => {
      if (/^[a-z]+:|^#/i.test(target)) return match
      const {name: destination, fragment} = publicDestination(root, file, target, files)
      const link = destination.endsWith('.md') && !destination.startsWith('examples/') ? route(destination) : '/' + destination
      return '](' + link + (fragment ? '#' + fragment : '') + ')'
    })
    const slug = route(name).replace(/^\//, '').replace(/\/$/, '') || 'index'
    const target = join(content, slug + '.md'); mkdirSync(dirname(target), {recursive: true})
    const toc = name.startsWith('docs/reference/') ? '\ntableOfContents:\n  minHeadingLevel: 2\n  maxHeadingLevel: 2' : ''
    writeFileSync(target, '---\ntitle: ' + JSON.stringify(title) + toc + '\n---\n' + body)
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  sync(resolve(import.meta.dirname, '..'), join(import.meta.dirname, 'src/content/docs'), join(import.meta.dirname, 'public'))
  cpSync(join(import.meta.dirname, 'assets/favicon.png'), join(import.meta.dirname, 'public/favicon.png'))
  const fontNotices = join(import.meta.dirname, 'public/fonts')
  mkdirSync(fontNotices, {recursive: true})
  for (const name of ['inter-LICENSE.txt', 'geist-mono-LICENSE.txt', 'README.md']) {
    cpSync(join(import.meta.dirname, 'assets/fonts', name), join(fontNotices, name))
  }
  console.log('Synchronized allowlisted public documentation and examples.')
}
