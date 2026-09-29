// Check the rendered artifact: valid Markdown alone does not prove readable types.
import assert from 'node:assert/strict'
import {readFileSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import {test} from 'node:test'
import ts from 'typescript'

const root = join(import.meta.dirname, 'dist/reference')
const read = entry => readFileSync(join(root, entry, 'index.html'), 'utf8')
const section = (html, anchor) => {
  const start = html.indexOf(`id="${anchor}"`)
  assert(start >= 0, `Missing reference section ${anchor}`)
  return html.slice(start).split(/<h[23]\b/)[0]
}
// Decode one HTML layer, as a browser does. A double-escaped entity must stay visible.
const decode = html => html.replace(/&(amp|lt|gt|quot|apos|#(?:x[\da-f]+|\d+));/gi, (_, entity) => {
  if (entity[0] === '#') return String.fromCodePoint(entity[1] === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)))
  return {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"}[entity.toLowerCase()]
})
const stripTags = html => {
  const content = []
  let inTag = false, quote = ''
  for (const char of html) {
    if (!inTag) {
      if (char === '<') inTag = true
      else content.push(char)
    } else if (quote) {
      if (char === quote) quote = ''
    } else if (char === '"' || char === "'") quote = char
    else if (char === '>') inTag = false
  }
  return content.join('')
}
const text = html => decode(stripTags(html))
// Expressive Code stores newlines as DEL in the copy button's data-code attribute.
const codeText = value => decode(value).replaceAll('\u007f', '\n')
const rows = html => [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(match => [...match[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map(cell => cell[1]))

test('approval parameter retains its named application type', () => {
  const row = rows(section(read('app'), 'approvewithcredential')).find(row => text(row[0] ?? '') === 'app')
  assert(row, 'Missing app parameter')
  assert.equal(text(row[1]), "Pick<TasraApplication, 'deployment' | 'slots'>")
})
test('union parameter renders a literal pipe without leaking an HTML entity', () => {
  const row = rows(section(read('app'), 'loadapplicationmanifest')).find(row => text(row[0] ?? '') === 'source')
  assert(row, 'Missing source parameter')
  assert.equal(text(row[1]), 'string | URL')
})
test('template-literal return type is one intact code span', () => {
  const body = section(read('main'), 'addressfromeoapubkey')
  const result = body.match(/<p>Returns: ([\s\S]*?)\.\s*<\/p>/)?.[1]
  assert(result, 'Missing return type')
  assert.match(result, /^<code\b[^>]*>[^<]*<\/code>$/)
  assert.equal(text(result), '`0x${string}`')
})
test('every rendered parameter table keeps types intact or links its matching detailed block', () => {
  for (const entry of readdirSync(root, {withFileTypes: true}).filter(entry => entry.isDirectory())) {
    const page = read(entry.name)
    for (const table of page.matchAll(/<table>([\s\S]*?)<\/table>/g)) {
      if (!table[1].includes('<th>Parameter</th>')) continue
      for (const row of rows(table[1])) {
        if (!row.length) continue
        assert.equal(row.length, 3, `${entry.name}: broken parameter columns`)
        if (row[1] === 'See detailed type below.') {
          const tail = page.slice(table.index + table[0].length).split(/<h[23]\b|<table>/)[0]
          const details = [...tail.matchAll(/<p><strong>([\s\S]*?) type<\/strong><\/p>\s*([\s\S]*?)(?=<p><strong>|<p>Returns:|$)/g)]
          const detail = details.find(match => text(match[1]) === text(row[0]))
          assert(detail, `${entry.name}: missing named parameter detail`)
          const code = detail[2].match(/data-code="([^"]*)"/)?.[1]
          assert(code && codeText(code).length > 160, `${entry.name}: missing detailed parameter type`)
        } else {
          assert.match(row[1], /^<code\b[^>]*>[^<]*<\/code>$/, `${entry.name}: type escaped its code span`)
          assert.doesNotMatch(text(row[1]), /&#(?:124|96);|&(?:lt|gt);/, `${entry.name}: visible type entity`)
        }
      }
    }
  }
})

test('provisionRuleTypedData shows its nested signature and return as multiline TypeScript', () => {
  const body = section(read('chain'), 'provisionruletypeddata')
  const blocks = [...body.matchAll(/data-code="([^"]*)"/g)].map(match => codeText(match[1]))
  const signature = blocks.find(code => code.startsWith('declare function provisionRuleTypedData'))
  assert(signature && signature.split('\n').length > 10, 'Nested signature must be formatted across lines')
  const returned = blocks.find(code => code.trim().startsWith('{'))
  assert(returned, 'Structural return type needs its own code block')
  assert(returned.split('\n').length > 10, 'Nested return type must be indented across lines')
  assert(returned.includes('verifyingContract: `0x${string}`'))
  assert(returned.includes('primaryType: "PresentationOperation"'))
})

test('class reference preserves optional and readonly members, constructors and static methods', () => {
  const app = text(section(read('app'), 'tasraclient')).replace(/\s+/g, ' ')
  assert(app.includes('readonly verifierAgentUrl?: string'), 'Optional readonly field must retain its contract')
  assert(app.includes('constructor(options: TasraClientOptions)'), 'Constructor must use declaration syntax')
  assert(app.includes('static fromManifest'), 'Manifest-loading static method must be documented')
  assert.doesNotMatch(text(section(read('app'), 'tasraapplicationerror')), /static (?:captureStackTrace|prepareStackTrace|stackTraceLimit)|NodeJS\.CallSite/, 'Browser API must not inherit Node-only static documentation')
  const recipient = text(section(read('main'), 'recipientstore')).replace(/\s+/g, ' ')
  assert(recipient.includes('static fromJwtBodies'), 'Public static factory must be documented')
})

test('all reference pages keep metadata code intact and move long types out of inline prose', () => {
  for (const entry of readdirSync(root, {withFileTypes: true}).filter(entry => entry.isDirectory())) {
    const prose = read(entry.name).replace(/<pre\b[\s\S]*?<\/pre>/g, '')
    assert.doesNotMatch(text(prose), /\{@link(?:code|plain)?\b/, `${entry.name}: raw JSDoc link in prose`)
    for (const match of prose.matchAll(/<code\b[^>]*>([\s\S]*?)<\/code>/g)) {
      assert.doesNotMatch(match[1], /<[^>]+>/, `${entry.name}: inline code interpreted as HTML`)
      const value = text(match[1])
      assert(value.length <= 240, `${entry.name}: ${value.length}-character inline type should be a formatted block`)
      assert.doesNotMatch(value, /&#(?:124|96);|&(?:lt|gt);/, `${entry.name}: visible encoding artefact`)
    }
  }
})


test('all rendered API declarations parse as TypeScript and avoid flattened structural lines', () => {
  let parsed = 0
  for (const entry of readdirSync(root, {withFileTypes: true}).filter(entry => entry.isDirectory())) {
    const blocks = [...read(entry.name).matchAll(/data-code="([^"]*)"/g)].map(match => codeText(match[1]))
    for (const code of blocks) {
      for (const line of code.split('\n')) assert(line.length <= 240, `${entry.name}: flattened ${line.length}-character code line`)
      if (!/^(?:declare (?:function|class)|export (?:interface|type))\b/.test(code)) continue
      const source = ts.createSourceFile('reference.ts', code, ts.ScriptTarget.Latest, true)
      assert.deepEqual(source.parseDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [], `${entry.name}: malformed displayed TypeScript`)
      parsed++
    }
  }
  assert(parsed > 0, 'Reference declarations must be present')
  console.log(`Parsed ${parsed} rendered public declarations across all reference entries.`)
})

test('every API summary and parameter description is populated from source comments', () => {
  for (const entry of readdirSync(root, {withFileTypes: true}).filter(entry => entry.isDirectory())) {
    const page = read(entry.name)
    assert.doesNotMatch(text(page), /See the declaration and linked source for the contract/, `${entry.name}: missing source summary`)
    for (const table of page.matchAll(/<table>([\s\S]*?)<\/table>/g)) {
      if (!table[1].includes('<th>Parameter</th>')) continue
      for (const row of rows(table[1])) if (row.length) {
        assert(text(row[2] ?? '').trim().length > 0, `${entry.name}: missing description for ${text(row[0])}`)
      }
    }
  }
})

test('API explanations contain no internal document references or decorative banners', () => {
  for (const entry of readdirSync(root, {withFileTypes: true}).filter(entry => entry.isDirectory())) {
    const value = text(read(entry.name).replace(/<pre\b[\s\S]*?<\/pre>/g, ''))
    assert.doesNotMatch(value, /\bADR[- ]?\d+|local[ -]fleet|[⚠━─═⇒→←]/i, `${entry.name}: nonconsumer source comment`)
  }
})

test('SDK reference groups declarations and limits both page navigations to categories', () => {
  const allowed = new Set(['classes', 'functions', 'types', 'constants-and-abi-values'])
  let declarations = 0
  let sourceDeclarations = 0
  for (const entry of readdirSync(root, {withFileTypes: true}).filter(entry => entry.isDirectory())) {
    const page = read(entry.name)
    const groups = [...page.matchAll(/<h2\b[^>]*id="([^"]+)"/g)].map(match => match[1]).filter(id => id !== 'starlight__on-this-page')
    assert(groups.length > 0 && groups.length <= 4, `${entry.name}: expected at most four categories, got ${groups.length}`)
    assert(groups.every(id => allowed.has(id)), `${entry.name}: symbols leaked into category headings`)
    const ordered = [...allowed].filter(id => groups.includes(id))
    assert.deepEqual(groups, ordered, `${entry.name}: category order`)
    declarations += [...page.matchAll(/<h3\b[^>]*id="([^"]+)"/g)].length
    const source = readFileSync(join(import.meta.dirname, '..', 'docs', 'reference', `${entry.name}.md`), 'utf8')
    sourceDeclarations += [...source.matchAll(/^### /gm)].length
    const navigations = [...page.matchAll(/<(?:mobile-)?starlight-toc\b[^>]*>([\s\S]*?)<\/(?:mobile-)?starlight-toc>/g)]
    assert(navigations.length >= 2, `${entry.name}: missing desktop/mobile page navigation`)
    for (const nav of navigations) {
      const links = [...nav[1].matchAll(/href="#([^"]+)"/g)].map(match => match[1]).filter(id => id !== '_top')
      assert.deepEqual(links, groups, `${entry.name}: page navigation must contain categories only`)
    }
  }
  assert.equal(declarations, sourceDeclarations, 'Grouping must retain every declaration')
})

test('case-colliding function and type anchors retain their distinct contracts', () => {
  for (const [entry, name] of [['app', 'createApplicationSlot'], ['committee', 'holderProofPerVerifier'], ['oid4vp', 'verifierAgentResult']]) {
    const page = read(entry)
    const anchor = name.toLowerCase()
    assert.match(text(section(page, anchor)), new RegExp(`declare function ${name}`))
    assert.match(text(section(page, anchor + '-1')), /export (?:interface|type) /)
    assert.doesNotMatch(text(section(page, anchor)), /export (?:interface|type) /, 'A function section must not include later declarations')
  }
})
