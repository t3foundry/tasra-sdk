// npm only for a CERTIFIED commit (keykeeper-network release model, 2026-11-18).
//
// A release candidate is a pair - a keykeeper-network commit and a tasra-sdk commit - certified
// together. keykeeper-network's release workflow then publishes t3foundry/tasra-releases vX.Y.Z,
// whose release-manifest.json names the SDK it was certified with (sdkPackage: name, version,
// commit, integrity) and ships that tarball. This module decides whether THIS tag may go to npm:
// only if a published, certified, non-prerelease tasra-releases release names exactly this commit,
// package, version and npm integrity. The release workflow verifies that release's signature
// separately (cosign over SHA256SUMS, which covers the manifest).
//
//   node scripts/certified-release.mjs RELEASES_NDJSON COMMIT INTEGRITY
//
// RELEASES_NDJSON: one {tag, isPrerelease, manifest} object per line. Prints the matching tag.
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

export function findCertifiedRelease(releases, {commit, name, version, integrity}) {
  for (const [key, value] of Object.entries({commit, name, version, integrity})) {
    if (typeof value !== 'string' || !value) throw new Error(`Missing ${key}`)
  }
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`Commit ${commit} is not a full SHA`)
  const naming = releases.filter(r => r?.manifest?.sdkPackage?.commit === commit)
  const certified = naming.filter(r => r.manifest.certified === true && r.isPrerelease === false)
  if (certified.length === 0) {
    const why = naming.length
      ? `only in ${naming.map(r => r.tag).join(', ')}, none a certified, non-prerelease release`
      : 'in no published t3foundry/tasra-releases release'
    throw new Error(`tasra-sdk ${commit} is not certified: it appears ${why}. Certify the pair and publish the keykeeper-network release first.`)
  }
  for (const r of certified) {
    const sdk = r.manifest.sdkPackage
    if (sdk.name !== name) throw new Error(`${r.tag} names package ${sdk.name}, this tag packs ${name}`)
    if (sdk.version !== version) throw new Error(`${r.tag} certified version ${sdk.version}, this tag is ${version}`)
    if (sdk.integrity !== integrity) {
      throw new Error(`${r.tag} certified integrity ${sdk.integrity}, this tag packs ${integrity}: the published bytes would not be the certified ones`)
    }
  }
  return certified[0].tag
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, commit, integrity] = process.argv.slice(2)
  const {name, version} = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const releases = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  const tag = findCertifiedRelease(releases, {commit, name, version, integrity})
  console.error(`${name}@${version} (${commit}) was certified with keykeeper-network ${tag}`)
  console.log(tag)
}
