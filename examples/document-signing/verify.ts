import { readFileSync } from 'node:fs'
import { verifyBundle, type Manifest, type Bundle } from './model.js'
import { readKey } from './backend.js'
import { deployment } from './config.js'
const [pdfFile, expectedFile, bundleFile] = process.argv.slice(2)
if (!pdfFile || !expectedFile || !bundleFile)
  throw new Error(
    'Usage: npm run verify -- document.pdf expected-request.json signatures.json',
  )
const expected = JSON.parse(readFileSync(expectedFile, 'utf8')) as Manifest
if (
  expected.chainId !== deployment.chainId ||
  expected.keyRegistry !== deployment.addresses.KeyRegistry
)
  throw new Error('Unexpected deployment')
await verifyBundle(
  readFileSync(pdfFile),
  expected,
  JSON.parse(readFileSync(bundleFile, 'utf8')) as Bundle,
  readKey,
)
console.log(
  'VERIFIED: exact PDF, expected request, Alice and Bob signatures against current anchored keys.',
)
