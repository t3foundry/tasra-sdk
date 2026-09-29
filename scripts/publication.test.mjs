import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {publicationFindings, loadPublication, runtimePatterns} from './publication.mjs'
import {sync} from '../site/sync.mjs'
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'tasra-publication-'))
  t.after(() => rmSync(root, {recursive: true, force: true}))
  mkdirSync(join(root, 'docs')); mkdirSync(join(root, 'internal'))
  writeFileSync(join(root, 'docs/README.md'), '# Guide\n\nPublic instructions.\n')
  writeFileSync(join(root, 'internal/plan.md'), '# Internal playbook\n')
  writeFileSync(join(root, 'publication.json'), JSON.stringify({schemaVersion: 1, files: ['docs/README.md']}))
  writeFileSync(join(root, 'package.json'), JSON.stringify({files: [...runtimePatterns, 'docs/README.md']}))
  return root
}
void test('new docs and unapproved drafts cannot silently become site content', t => {
  const root = fixture(t)
  writeFileSync(join(root, 'docs/unreviewed.md'), '# Internal draft\n')
  sync(root, join(root, 'output/content'), join(root, 'output/public'))
  assert.ok(existsSync(join(root, 'output/content/index.md')))
  assert.equal(existsSync(join(root, 'output/content/unreviewed.md')), false)
  assert.equal(existsSync(join(root, 'output/content/source/internal/plan.md')), false)
})
void test('links into internal files fail publication rather than copy them', t => {
  const root = fixture(t)
  writeFileSync(join(root, 'docs/README.md'), '# Guide\n[Internal](../internal/plan.md)\n')
  assert.throws(() => sync(root, join(root, 'output/content'), join(root, 'output/public')), /Unapproved publication link/)
})
void test('broad npm folders and symlinked inputs are rejected', t => {
  const root = fixture(t)
  assert.deepEqual(publicationFindings(root), [])
  writeFileSync(join(root, 'package.json'), JSON.stringify({files: ['docs']}))
  assert.match(publicationFindings(root).join(), /must match/)
  rmSync(join(root, 'docs/README.md')); symlinkSync('../internal/plan.md', join(root, 'docs/README.md'))
  assert.throws(() => loadPublication(root), /linked/)
})

void test('reference pages use category navigation while guides retain their default headings', t => {
  const root = fixture(t)
  mkdirSync(join(root, 'docs/reference'))
  writeFileSync(join(root, 'docs/reference/app.md'), '# Application client\n\n## Functions\n\n### connect\n')
  writeFileSync(join(root, 'publication.json'), JSON.stringify({schemaVersion: 1, files: ['docs/README.md', 'docs/reference/app.md']}))
  sync(root, join(root, 'output/content'), join(root, 'output/public'))
  const reference = readFileSync(join(root, 'output/content/reference/app.md'), 'utf8')
  const guide = readFileSync(join(root, 'output/content/index.md'), 'utf8')
  assert.match(reference, /tableOfContents:\n {2}minHeadingLevel: 2\n {2}maxHeadingLevel: 2/)
  assert.doesNotMatch(guide, /tableOfContents/)
  assert.match(reference, /### connect/)
})
