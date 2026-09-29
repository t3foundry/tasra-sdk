// Generate reference signatures, parameter documentation and types from public exports.
import ts from 'typescript'
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {relative, resolve} from 'node:path'

const root = resolve(import.meta.dirname, '..')
const check = process.argv.includes('--check')
const config = ts.readConfigFile(resolve(root, 'tsconfig.json'), (path) => ts.sys.readFile(path))
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
const program = ts.createProgram(parsed.fileNames, parsed.options)
const checker = program.getTypeChecker()
const entries = {app: 'src/app/index.ts', 'app-node': 'src/app/node.ts', main: 'src/index.ts', chain: 'src/chain/index.ts', committee: 'src/committee/index.ts',
  oid4vp: 'src/oid4vp/index.ts', 'verifier-agent': 'src/verifier-agent/index.ts', 'chain-node': 'src/chain/node.ts'}
const flags = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope
const text = (parts: readonly ts.SymbolDisplayPart[] | undefined) => ts.displayPartsToString(parts ? [...parts] : undefined)
// Use a delimiter longer than any backtick run in the type. Padding keeps a
// template literal's own backticks inside the span. Only GFM table cells escape pipes.
const escapeTable = (value: string) => value.replaceAll('\\', '\\\\').replaceAll('|', '\\|')
const inlineCode = (value: string, table = false) => {
  const delimiter = '`'.repeat(Math.max(0, ...[...value.matchAll(/`+/g)].map(match => match[0].length)) + 1)
  const content = value.replace(/\r?\n\s*/g, ' ')
  return `${delimiter} ${table ? escapeTable(content) : content} ${delimiter}`
}
const cell = (value: string) => escapeTable(value).replace(/\r?\n/g, ' ')
const printer = ts.createPrinter({removeComments: true})
const annotation = (node: ts.TypeNode) => printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile())
function parameterType(symbol: ts.Symbol, at: ts.Declaration) {
  // Keep the author's public aliases instead of expanding mapped/conditional types.
  if ((ts.isParameter(at) || ts.isPropertyDeclaration(at) || ts.isPropertySignature(at)) && at.type) return annotation(at.type)
  return checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, at), at, flags)
}

// Re-parse declarations before printing so inferred structural types receive the
// same indentation as source annotations, without altering their public contract.
function formatDeclaration(value: string) {
  const source = ts.createSourceFile('reference.ts', value, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  return printer.printFile(source).trim()
}
function formatType(value: string) {
  const source = ts.createSourceFile('reference.ts', `type ReferenceType = ${value}`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declaration = source.statements[0]
  if (!declaration || !ts.isTypeAliasDeclaration(declaration)) throw new Error(`Cannot format reference type: ${value}`)
  return annotation(declaration.type)
}
const codeBlock = (value: string) => `\`\`\`ts\n${value}\n\`\`\`\n\n`
const compact = (value: string) => value.replace(/\s+/g, ' ').trim()
const detailedType = (value: string) => compact(value).length > 160 || /[{}]/.test(value.replace(/`[^`]*`/g, ''))
function declarationBlock(value: string) {
  const block = codeBlock(formatDeclaration(value))
  return value.length > 6000 ? `<details>\n<summary>Full declaration</summary>\n\n${block}</details>\n\n` : block
}
function parameterName(symbol: ts.Symbol, at: ts.Declaration) {
  if (!ts.isParameter(at)) return symbol.name
  return `${at.dotDotDotToken ? '...' : ''}${at.name.getText()}${at.questionToken || at.initializer ? '?' : ''}`
}
function signatureText(signature: ts.Signature, at: ts.Declaration) {
  const declaration = signature.declaration
  const typeParameters = declaration?.typeParameters?.length
    ? `<${declaration.typeParameters.map(parameter => printer.printNode(ts.EmitHint.Unspecified, parameter, parameter.getSourceFile())).join(', ')}>` : ''
  const parameters = signature.parameters.map(parameter => {
    const location = parameter.valueDeclaration ?? at
    return `${parameterName(parameter, location)}: ${parameterType(parameter, location)}`
  }).join(', ')
  const returnType = declaration?.type
  const result = returnType && ts.isTypeNode(returnType) ? annotation(returnType) : checker.typeToString(signature.getReturnType(), at, flags)
  return {parameters, typeParameters, result}
}

const pending: {file: string; body: string}[] = []
function emit(file: string, body: string) { pending.push({file, body: body.trimEnd() + '\n'}) }
function writeReference(file: string, body: string) {
  const path = resolve(root, 'docs/reference', file)
  if (check) {
    if (readFileSync(path, 'utf8') !== body) throw new Error(`Reference is stale: ${file}. Run npm run docs:reference`)
  } else writeFileSync(path, body)
}
mkdirSync(resolve(root, 'docs/reference'), {recursive: true})
const counts: Record<string, number> = {}
const missing: string[] = []
const sdkOwned = (declaration: ts.Declaration) => relative(root, declaration.getSourceFile().fileName).replaceAll('\\', '/').startsWith('src/')
const publicMember = (symbol: ts.Symbol) => !symbol.name.startsWith('#') && !symbol.declarations?.some(declaration =>
  ts.getCombinedModifierFlags(declaration) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected))
function sourceDescription(symbol: ts.Symbol, context: string) {
  const value = text(symbol.getDocumentationComment(checker)).trim()
  if (!value) missing.push(context)
  return value
}
for (const [name, file] of Object.entries(entries)) {
  const source = program.getSourceFile(resolve(root, file))
  if (!source) throw new Error(`Missing public entry: ${file}`)
  const module = checker.getSymbolAtLocation(source)!
  const exports = checker.getExportsOfModule(module).sort((a, b) => a.name.localeCompare(b.name, 'en'))
  // Only section-bearing exports have generated heading anchors. Constants are
  // source-linked table entries, so references to them remain inline code.
  const exportNames = new Set(exports.filter(item => {
    const target = item.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(item) : item
    const at = target.valueDeclaration ?? target.declarations?.[0]
    return at && (ts.isInterfaceDeclaration(at) || ts.isTypeAliasDeclaration(at) || ts.isClassDeclaration(at)
      || checker.getTypeOfSymbolAtLocation(target, at).getCallSignatures().length > 0)
  }).map(item => item.name))
  const anchors = new Map<string, string>()
  const occurrences = new Map<string, number>()
  for (const title of exportNames) {
    const base = title.toLowerCase()
    const occurrence = occurrences.get(base) ?? 0
    occurrences.set(base, occurrence + 1)
    anchors.set(title, base + (occurrence ? `-${occurrence}` : ''))
  }
  const documentation = (value: string) => value.replace(/\{@link(?:code|plain)?\s+([^\s|}]+)(?:[\s|]+([^}]*?))?\s*\}/g, (_match, target: string, label: string | undefined) => exportNames.has(target) ? `[${label?.trim() || target}](#${anchors.get(target)})` : inlineCode(label?.trim() || target))
  const entry = name === 'main' ? 'tasra-sdk' : `tasra-sdk/${name === 'chain-node' ? 'chain/node' : name === 'app-node' ? 'app/node' : name}`
  let body = `# ${entry}\n\nGenerated from public TypeScript exports.\n\n[SDK reference](README.md) · [Task guides](../README.md) · [Errors](../errors.md)\n\n`
  const sections: {title: string; group: string; start: number}[] = []
  const values: string[] = []
  let count = 0
  for (const exported of exports) {
    const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
    if (!declaration) continue
    const location = relative(root, declaration.getSourceFile().fileName).replaceAll('\\', '/')
    const line = declaration.getSourceFile().getLineAndCharacterOfPosition(declaration.getStart()).line + 1
    const sourceLink = `[Source](https://github.com/t3-foundry/tasra-sdk/blob/develop/${location}#L${line})`
    const signatures = checker.getTypeOfSymbolAtLocation(symbol, declaration).getCallSignatures()
    const typeDeclaration = ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration)
    if (!signatures.length && !typeDeclaration && !ts.isClassDeclaration(declaration)) {
      values.push(`| \`${exported.name}\` | ${cell(documentation(sourceDescription(symbol, `${location}:${line} ${exported.name}`)))} | ${sourceLink} |`)
      continue
    }
    count++
    sections.push({title: exported.name, group: typeDeclaration ? 'Types' : ts.isClassDeclaration(declaration) ? 'Classes' : 'Functions', start: body.length})
    body += `## ${exported.name}\n\n${documentation(sourceDescription(symbol, `${location}:${line} ${exported.name}`))}\n\n${sourceLink}\n\n`
    if (typeDeclaration) {
      body += declarationBlock(declaration.getText())
      const fields = checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(symbol))
        .filter(field => publicMember(field) && field.declarations?.some(sdkOwned))
        .map(field => ({name: field.name, description: documentation(sourceDescription(field, `${location}:${line} ${exported.name}.${field.name}`))}))
      if (fields.length) {
        body += 'Fields:\n\n'
        for (const field of fields) body += `- **${inlineCode(field.name)}**: ${field.description.replace(/\n+/g, ' ')}\n`
        body += '\n'
      }
      continue
    }
    if (ts.isClassDeclaration(declaration)) {
      const classType = checker.getTypeOfSymbolAtLocation(symbol, declaration)
      const constructors = classType.getConstructSignatures()
      body += `Import: \`import {${exported.name}} from '${entry}'\`\n\n`
      if (constructors.length) {
        const generics = declaration.typeParameters?.length ? `<${declaration.typeParameters.map(parameter => printer.printNode(ts.EmitHint.Unspecified, parameter, parameter.getSourceFile())).join(', ')}>` : ''
        body += declarationBlock(`declare class ${exported.name}${generics} { ${constructors.map(signature => `constructor(${signatureText(signature, declaration).parameters});`).join('\n')} }`)
      }
      const instance = checker.getDeclaredTypeOfSymbol(symbol)
      const groups = [
        {members: checker.getPropertiesOfType(instance), isStatic: false},
        {members: checker.getPropertiesOfType(classType).filter(member => {
          const at = member.valueDeclaration ?? member.declarations?.[0]
          // Include SDK-owned inherited statics, but not ambient Node extensions
          // of built-ins such as Error.captureStackTrace in the browser API.
          return member.name !== 'prototype' && at && sdkOwned(at)
        }), isStatic: true},
      ]
      for (const {members, isStatic} of groups) for (const member of members) {
        const at = member.valueDeclaration ?? member.declarations?.[0]
        if (!at || (ts.getCombinedModifierFlags(at) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) || member.name.startsWith('#')) continue
        const modifiers = `${isStatic ? 'static ' : ''}${ts.getCombinedModifierFlags(at) & ts.ModifierFlags.Readonly ? 'readonly ' : ''}`
        const memberName = `${member.name}${member.flags & ts.SymbolFlags.Optional ? '?' : ''}`
        const calls = checker.getTypeOfSymbolAtLocation(member, at).getCallSignatures()
        const isMethod = ts.isMethodDeclaration(at) || ts.isMethodSignature(at)
        const memberText = isMethod && calls.length ? calls.map(signature => {
          const parts = signatureText(signature, at)
          return `${modifiers}${memberName}${parts.typeParameters}(${parts.parameters}): ${parts.result};`
        }).join('\n') : `${modifiers}${memberName}: ${parameterType(member, at)};`
        const owned = member.declarations?.some(sdkOwned)
        const description = documentation(owned
          ? sourceDescription(member, `${location}:${line} ${exported.name}.${member.name}`)
          : text(member.getDocumentationComment(checker)))
        if (detailedType(memberText) || memberText.includes('\n')) {
          body += `**${isStatic ? 'static ' : ''}${member.name}**${description ? ` — ${description}` : ''}\n\n`
          // Parse members inside a class to keep method/static/optional syntax intact.
          const formatted = formatDeclaration(`declare class ReferenceMember { ${memberText} }`)
          const memberBody = formatted.slice(formatted.indexOf('{') + 1, formatted.lastIndexOf('}')).trimEnd().replace(/^\n/, '').replace(/^ {4}/gm, '')
          body += codeBlock(memberBody)
        } else body += `- ${inlineCode(memberText)}${description ? ` — ${description}` : ''}\n\n`
      }
      continue
    }
    body += `Import: \`import {${exported.name}} from '${entry}'\`\n\n`
    body += declarationBlock(signatures.map(signature => {
      const parts = signatureText(signature, declaration)
      return `declare function ${exported.name}${parts.typeParameters}(${parts.parameters}): ${parts.result};`
    }).join('\n'))
    for (const signature of signatures) {
      const parameters: {name: string; type: string}[] = []
      if (signature.parameters.length) {
        body += '| Parameter | Type | Description |\n|---|---|---|\n'
        for (const parameter of signature.parameters) {
          const at = parameter.valueDeclaration ?? declaration
          const name = parameterName(parameter, at)
          const type = parameterType(parameter, at)
          const typeCell = compact(type).length > 160 ? 'See detailed type below.' : inlineCode(type, true)
          if (compact(type).length > 160) parameters.push({name, type})
          body += `| ${inlineCode(name, true)} | ${typeCell} | ${cell(documentation(sourceDescription(parameter, `${location}:${line} ${exported.name} parameter ${name}`)))} |\n`
        }
        body += '\n'
      }
      for (const parameter of parameters) body += `**${inlineCode(parameter.name)} type**\n\n${codeBlock(formatType(parameter.type))}`
      const {result} = signatureText(signature, declaration)
      body += detailedType(result) ? `Returns:\n\n${codeBlock(formatType(result))}` : `Returns: ${inlineCode(result)}.\n\n`
      for (const tag of signature.getJsDocTags()) {
        const detail = documentation(text(tag.text))
        if (tag.name === 'example') body += `Example from source:\n\n${detail}\n\n`
        else if (tag.name === 'throws' || tag.name === 'returns') body += `${tag.name === 'throws' ? 'Throws' : 'Return details'}: ${detail}\n\n`
      }
    }
  }
  if (values.length) {
    sections.push({title: 'Constants and ABI values', group: 'Constants and ABI values', start: body.length})
    body += `## Constants and ABI values\n\n| Export | Description | Definition |\n|---|---|---|\n${values.join('\n')}\n`
  }
  const rendered = body
  body = rendered.slice(0, sections[0]?.start ?? rendered.length)
  const categories = [
    ['Classes', 'Clients, adapters and error classes.'],
    ['Functions', 'Operations you can import and call.'],
    ['Types', 'Options, data structures and return types.'],
    ['Constants and ABI values', 'Shared values and contract definitions.'],
  ] as const
  const groupedOccurrences = new Map<string, number>()
  for (const [group, description] of categories) {
    const members = sections.map((section, index) => ({...section,
      content: rendered.slice(section.start, sections[index + 1]?.start ?? rendered.length),
    })).filter(section => section.group === group)
    if (!members.length) continue
    if (group === 'Classes') members.sort((a, b) => Number(a.title.endsWith('Error')) - Number(b.title.endsWith('Error')) || a.title.localeCompare(b.title, 'en'))
    body += `## ${group}\n\n${description}\n\n`
    if (group === 'Constants and ABI values') {
      body += members[0]!.content.replace(/^## [^\n]+\n\n/, '')
      continue
    }
    const links = members.map(({title}) => {
      // Grouping must not silently change previously published symbol fragments.
      const base = title.toLowerCase()
      const occurrence = groupedOccurrences.get(base) ?? 0
      groupedOccurrences.set(base, occurrence + 1)
      const anchor = base + (occurrence ? `-${occurrence}` : '')
      if (anchor !== anchors.get(title)) throw new Error(`Grouping would change the anchor for ${entry}#${title}`)
      return `- [${title}](#${anchor})`
    })
    body += `<details>\n<summary>Browse ${members.length} ${group.toLowerCase()}</summary>\n\n${links.join('\n')}\n\n</details>\n\n`
    body += members.map(section => section.content.replace(/^## /, '### ')).join('')
  }
  counts[entry] = count
  emit(`${name}.md`, body)
}
const modules: Record<string, {label: string; purpose: string}> = {
  app: {label: 'Application client', purpose: 'Connect, create slots, manage identities and run application workflows.'},
  'app-node': {label: 'Local storage (Node.js)', purpose: 'Persist application state and coordinate local operations.'},
  main: {label: 'Core utilities', purpose: 'Signing, encryption, credentials and shared helpers.'},
  chain: {label: 'Chain access', purpose: 'Read contracts, submit transactions, discover services and fund slots.'},
  committee: {label: 'Committee operations', purpose: 'Threshold requests, approvals and operation receipts.'},
  oid4vp: {label: 'Credentials and OID4VP', purpose: 'Credential presentations, wallet flows and issuer verification.'},
  'verifier-agent': {label: 'Verifier integration', purpose: 'Connect wallet and credential flows to a verifier agent.'},
  'chain-node': {label: 'Chain tools (Node.js)', purpose: 'Load chain configuration from Node.js files.'},
}
emit('README.md', `# SDK reference\n\nLook up the TypeScript classes, functions, options and return types you use in your code.\nStart with the [learning path](../README.md) if you are building your first TASRA app.\n\n## Choose a module\n\nMost applications start with **tasra-sdk/app**. Open a module, then choose Classes,\nFunctions, Types or Constants from its page navigation. Each group has its own lookup list.\n\n| Module | Import | What you will find |\n|---|---|---|\n${Object.entries(entries).map(([name]) => {
  const entry = name === 'main' ? 'tasra-sdk' : `tasra-sdk/${name === 'chain-node' ? 'chain/node' : name === 'app-node' ? 'app/node' : name}`
  return `| [${modules[name]!.label}](${name}.md) | \`${entry}\` | ${modules[name]!.purpose} |`
}).join('\n')}\n\n## Read a declaration\n\nFunctions show their import, parameters and return value. Classes show constructors,\nproperties and methods. Types describe the data you pass in or receive. Constants\nand contract ABIs link to their definitions. Follow **Source** for the implementation.\n\nThe declarations and descriptions are generated from the SDK source. They describe\nprogramming interfaces; use the [application guides](../README.md) for complete\nrunnable examples and [Errors](../errors.md) for recovery guidance.\n`)


if (missing.length) throw new Error(`Missing source JSDoc (${missing.length} entries):\n${[...new Set(missing)].join('\n')}`)

for (const {file, body} of pending) writeReference(file, body)
console.log(`${check ? 'Checked' : 'Generated'} reference for ${Object.values(counts).reduce((a, b) => a + b, 0)} exported operations and types across ${Object.keys(entries).length} entry points.`)
