import {appendFileSync, readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export function releaseTag(gitTag, packageVersion) {
  const version = versionPattern.exec(packageVersion)
  if (!version) throw new Error(`Invalid package version: ${packageVersion}`)
  if (gitTag !== `v${packageVersion}`) throw new Error(`Git tag ${gitTag} does not match package.json version ${packageVersion}`)
  return version[4] ? 'next' : 'latest'
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const {version} = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const npmTag = releaseTag(process.env.GITHUB_REF_NAME, version)
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required')
  appendFileSync(process.env.GITHUB_OUTPUT, `npm_tag=${npmTag}\n`)
  console.log(`Publishing ${version} with npm tag ${npmTag}`)
}
