import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {relative, join} from 'node:path'
import ts from 'typescript'

export const hash = value => createHash('sha256').update(value).digest('hex')
export function publicSurface(root, {includeContracts = false} = {}) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile)
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
  const program = ts.createProgram(parsed.fileNames, {...parsed.options, declaration: true, emitDeclarationOnly: true, noEmit: false}), checker = program.getTypeChecker()
  const result = []
  for (const [entry, conditions] of Object.entries(pkg.exports)) {
    if (entry === './package.json') continue
    if (!conditions.types?.startsWith('./dist/') || !conditions.types.endsWith('.d.ts')) throw new Error(`Classify public entry: ${entry}`)
    const path = conditions.types.replace('./dist/', 'src/').replace(/\.d\.ts$/, '.ts')
    const file = program.getSourceFile(join(root, path))
    if (!file) throw new Error(`Missing public source: ${path}`)
    for (const exported of checker.getExportsOfModule(checker.getSymbolAtLocation(file))) {
      const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported
      const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
      if (!declaration) throw new Error(`No declaration: ${entry}#${exported.name}`)
      const kind = symbol.flags & ts.SymbolFlags.Value ? 'value' : 'type'
      const type = kind === 'value' ? checker.getTypeOfSymbolAtLocation(symbol, declaration) : checker.getDeclaredTypeOfSymbol(symbol)
      const shape = checker.typeToString(type, declaration, ts.TypeFormatFlags.NoTruncation)
      result.push({id: `${entry === '.' ? pkg.name : pkg.name + entry.slice(1)}#${exported.name}`, kind,
        source: relative(root, declaration.getSourceFile().fileName).replaceAll('\\', '/'), shape: hash(shape)})
    }
  }
  result.sort((a, b) => a.id.localeCompare(b.id, 'en'))
  if (!includeContracts) return result
  // Compiler-emitted declarations retain reachable internal interfaces/imports
  // that a rendered export signature can abbreviate to a type name.
  const declarations = []
  const emitted = program.emit(undefined, (path, content) => {
    if (path.endsWith('.d.ts')) declarations.push([relative(root, path).replaceAll('\\', '/'), hash(content)])
  }, undefined, true)
  // JSON inputs intentionally have no declaration output and can set emitSkipped
  // even when every TypeScript declaration emitted successfully.
  const expected = parsed.fileNames.filter(path => /\.tsx?$/.test(path) && !path.endsWith('.d.ts')).map(path => {
    const output = parsed.options.outDir ? join(parsed.options.outDir, relative(parsed.options.rootDir ?? program.getCommonSourceDirectory(), path)) : path
    return relative(root, output.replace(/\.tsx?$/, '.d.ts')).replaceAll('\\', '/')
  })
  if (emitted.diagnostics.length || !declarations.length || expected.some(path => !declarations.some(([emittedPath]) => emittedPath === path))) throw new Error('Could not emit every SDK declaration contract')
  declarations.sort(([a], [b]) => a.localeCompare(b, 'en'))
  return {schemaVersion: 1, declarationsHash: hash(JSON.stringify(declarations)), exports: result}
}
