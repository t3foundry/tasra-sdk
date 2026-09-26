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
const entries = {main: 'src/index.ts', chain: 'src/chain/index.ts', committee: 'src/committee/index.ts',
  oid4vp: 'src/oid4vp/index.ts', 'verifier-agent': 'src/verifier-agent/index.ts', 'chain-node': 'src/chain/node.ts'}
const flags = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope
const text = (parts: readonly ts.SymbolDisplayPart[] | undefined) => ts.displayPartsToString(parts ? [...parts] : undefined)
const cell = (s: string) => s.replace(/\|/g, '&#124;').replace(/\n/g, ' ').replace(/`/g, '\\`')
function emit(file: string, body: string) {
  const path = resolve(root, 'docs/reference', file)
  if (check) {
    if (readFileSync(path, 'utf8') !== body) throw new Error(`Reference is stale: ${file}. Run npm run docs:reference`)
  } else writeFileSync(path, body)
}
mkdirSync(resolve(root, 'docs/reference'), {recursive: true})
const counts: Record<string, number> = {}
for (const [name, file] of Object.entries(entries)) {
  const source = program.getSourceFile(resolve(root, file))
  if (!source) throw new Error(`Missing public entry: ${file}`)
  const module = checker.getSymbolAtLocation(source)!
  const exports = checker.getExportsOfModule(module).sort((a, b) => a.name.localeCompare(b.name, 'en'))
  const entry = name === 'main' ? 'tasra-sdk' : `tasra-sdk/${name === 'chain-node' ? 'chain/node' : name}`
  let body = `# ${entry}\n\nGenerated from public TypeScript exports. Run \`npm run docs:reference\` to update.\n\n[Reference index](README.md) · [Task guides](../README.md) · [Errors](../errors.md)\n\n`
  const values: string[] = []
  let count = 0
  for (const exported of exports) {
    const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
    if (!declaration) continue
    const location = relative(root, declaration.getSourceFile().fileName).replaceAll('\\', '/')
    const line = declaration.getSourceFile().getLineAndCharacterOfPosition(declaration.getStart()).line + 1
    const sourceLink = `[Source](../../${location}#L${line})`
    const signatures = checker.getTypeOfSymbolAtLocation(symbol, declaration).getCallSignatures()
    const typeDeclaration = ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration)
    if (!signatures.length && !typeDeclaration && !ts.isClassDeclaration(declaration)) {
      values.push(`| \`${exported.name}\` | ${sourceLink} |`)
      continue
    }
    count++
    body += `## ${exported.name}\n\n${text(symbol.getDocumentationComment(checker)) || 'See the declaration and linked source for the contract.'}\n\n${sourceLink}\n\n`
    if (typeDeclaration) {
      body += `\`\`\`ts\n${declaration.getText()}\n\`\`\`\n\n`
      continue
    }
    if (ts.isClassDeclaration(declaration)) {
      const constructors = checker.getTypeOfSymbolAtLocation(symbol, declaration).getConstructSignatures()
      if (constructors.length) body += `\`\`\`ts\n${constructors.map(sig => checker.signatureToString(sig, declaration, flags)).join('\n')}\n\`\`\`\n\n`
      const instance = checker.getDeclaredTypeOfSymbol(symbol)
      body += `Import: \`import {${exported.name}} from '${entry}'\`\n\n`
      for (const member of checker.getPropertiesOfType(instance)) {
        const at = member.valueDeclaration ?? member.declarations?.[0]
        if (!at || (ts.getCombinedModifierFlags(at) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected))) continue
        body += `- \`${member.name}: ${cell(checker.typeToString(checker.getTypeOfSymbolAtLocation(member, at), at, flags))}\` — ${text(member.getDocumentationComment(checker))}\n`
      }
      body += '\n'
      continue
    }
    body += `Import: \`import {${exported.name}} from '${entry}'\`\n\n\`\`\`ts\n${signatures.map(sig => `declare function ${exported.name}${checker.signatureToString(sig, declaration, flags)}`).join('\n')}\n\`\`\`\n\n`
    for (const signature of signatures) {
      if (signature.parameters.length) {
        body += '| Parameter | Type | Description |\n|---|---|---|\n'
        for (const parameter of signature.parameters) {
          const at = parameter.valueDeclaration ?? declaration
          body += `| \`${parameter.name}\` | \`${cell(checker.typeToString(checker.getTypeOfSymbolAtLocation(parameter, at), at, flags))}\` | ${cell(text(parameter.getDocumentationComment(checker)))} |\n`
        }
        body += '\n'
      }
      body += `Returns: \`${checker.typeToString(signature.getReturnType(), declaration, flags)}\`.\n\n`
      for (const tag of signature.getJsDocTags()) {
        const detail = text(tag.text)
        if (tag.name === 'example') body += `Example from source:\n\n${detail}\n\n`
        else if (tag.name === 'throws' || tag.name === 'returns') body += `${tag.name === 'throws' ? 'Throws' : 'Return details'}: ${detail}\n\n`
      }
    }
  }
  if (values.length) body += `## Constants and ABI values\n\n| Export | Definition |\n|---|---|\n${values.join('\n')}\n`
  const seenAnchors = new Map<string, number>()
  const links = [...body.matchAll(/^## (.+)$/gm)].map(match => {
    const title = match[1]!
    const base = title.toLowerCase().replaceAll(' ', '-')
    const occurrence = seenAnchors.get(base) ?? 0
    seenAnchors.set(base, occurrence + 1)
    return `- [${title}](#${base}${occurrence ? `-${occurrence}` : ''})`
  })
  const firstSection = body.indexOf('## ')
  if (firstSection >= 0) body = body.slice(0, firstSection) + `<details>\n<summary>Find an export</summary>\n\n${links.join('\n')}\n\n</details>\n\n` + body.slice(firstSection)
  counts[entry] = count
  emit(`${name}.md`, body)
}
emit('README.md', `# Generated API reference\n\nSignatures, options, return types, and source comments for every public entry point.\nGenerated by the TypeScript compiler from the current checkout; no registry or network access.\n\n| Import | Reference | Operations and types |\n|---|---|---|\n${Object.entries(entries).map(([name]) => {
  const entry = name === 'main' ? 'tasra-sdk' : `tasra-sdk/${name === 'chain-node' ? 'chain/node' : name}`
  return `| \`${entry}\` | [Open](${name}.md) | ${counts[entry]} |`
}).join('\n')}\n\nStart with the [shared-account tutorial](../shared-account.md) for runnable code.\nThe [API overview](../api.md) explains which client to use. Interface declarations\ninclude option fields and method contracts. HTTP error handling is covered in\n[Errors](../errors.md); source comments supply operation-specific throws where documented.\n\nThese pages are a reference, not runnable application files. Imported input/output\ntype names are defined in their corresponding entry's page. Re-exported values and\ncontract ABIs link directly to source to avoid duplicating large ABI arrays.\n`)
console.log(`${check ? 'Checked' : 'Generated'} reference for ${Object.values(counts).reduce((a, b) => a + b, 0)} exported operations and types across ${Object.keys(entries).length} entry points.`)
