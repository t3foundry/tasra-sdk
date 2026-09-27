import { build } from 'esbuild'
import { cpSync, mkdirSync } from 'node:fs'
await build({
  entryPoints: ['web/app.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  outfile: 'public/app.js',
})
mkdirSync('public/pdf-assets', { recursive: true })
cpSync(
  'node_modules/pdfjs-dist/build/pdf.worker.mjs',
  'public/pdf-assets/pdf.worker.mjs',
)
for (const dir of ['cmaps', 'standard_fonts', 'wasm'])
  cpSync('node_modules/pdfjs-dist/' + dir, 'public/pdf-assets/' + dir, {
    recursive: true,
  })
