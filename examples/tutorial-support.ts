/** Shared manifest loading and fresh identities for the runnable examples. */
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {TasraClient, type CredentialPolicyOptions} from 'tasra-sdk/app'
import {createFileStore} from 'tasra-sdk/app/node'
import {loadNetwork} from './network.js'
import {proveServerRefusal as refuse} from './tutorial-negative.js'

export async function createTutorial(name: string, type: string, role: string, names = ['alice', 'bob', 'mallory']) {
  // 1. Load public network configuration and save fresh keys before funding.
  const network = loadNetwork()
  const options = {manifest: network.deployment, verifierAgentUrl: network.verifierAgentUrl}
  const configured = new TasraClient(options)
  const {verifierAgentUrl} = configured
  if (!(await configured.check()).ready || !verifierAgentUrl) throw new Error('Network registries or verifier configuration are unavailable')
  const health = await fetch(verifierAgentUrl + '/health', {signal: AbortSignal.timeout(10_000)})
  if (!health.ok) throw new Error(`Verifier health: HTTP ${health.status}`)
  mkdirSync('.tasra', {recursive: true, mode: 0o700})
  const directory = mkdtempSync(resolve('.tasra', name + '-'))
  const store = createFileStore(directory), wallet = configured.wallets.create()
  await store.save('creator-key', wallet.exportPrivateKey())
  await store.save('network-pin', network.deployment.provenance!.manifestSha256)
  const tasra = new TasraClient({...options, wallet, store})
  // Send AVAX for setup gas; usage credit is deposited separately after slot creation.
  console.log(`Creator: ${wallet.address} on chain ${tasra.deployment.chainId}.`)
  console.log('Fund this address with at least 1 AVAX for gas. Fuji faucet: https://core.app/tools/testnet-faucet/?subnet=c&token=c. Waiting up to 15 minutes.')
  const deadline = Date.now() + 15 * 60_000
  while (await tasra.chain.client.getBalance({address: wallet.address}) < 10n ** 18n) {
    if (Date.now() >= deadline) throw new Error(`Creator funding timed out. Preserve private state in ${directory}.`)
    await new Promise(resolve => setTimeout(resolve, 5000))
  }

  // Pause before use so the developer explicitly buys TSRA and credits this slot.
  const awaitUsageCredit = async (slotId: `0x${string}`) => {
    await store.save('slot-id', slotId)
    console.log(`Slot created: ${slotId}. Fund its TSRA usage credit in a second terminal.`)
    console.log(`npx tsx fund-slot.ts ${JSON.stringify(directory)} status --slot ${slotId}`)
    console.log('Follow the funding guide to buy TSRA with EURC, then deposit TSRA into this slot. Waiting up to 15 minutes.')
    const deadline = Date.now() + 15 * 60_000
    while (await tasra.chain.readers.settlement.balanceOf(slotId) === 0n) {
      if (Date.now() >= deadline) throw new Error(`Slot credit timed out. Preserve private state in ${directory}.`)
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
    console.log('Slot has TSRA credit; operations still require enough credit for their network charges.')
  }

  // 2. Each demo creates its own issuer and people; no precreated accounts or credentials.
  const issuer = tasra.identities.create()
  const users = Object.fromEntries(names.map(name => {
    const identity = tasra.identities.create()
    const credential = tasra.credentials.issue({issuer, holder: identity, type, claims: {role}})
    return [name, {identity, credential}]
  }))
  await store.save('identity-keys', {issuer: issuer.exportPrivateKey(),
    users: Object.fromEntries(Object.entries(users).map(([name, user]) => [name, user.identity.exportPrivateKey()]))})
  await store.save('credentials', Object.fromEntries(Object.entries(users).map(([name, user]) => [name, user.credential])))
  const policy = (allowed: string[], identityScope?: CredentialPolicyOptions['identityScope']) => tasra.credentials.policy({
    issuer, type, subjects: allowed.map(name => users[name]!.identity.did), claims: {role: [role]}, identityScope,
  })
  const authorize = (name: string) => tasra.credentials.authorize({verifierAgentUrl, signer: wallet.signer,
    identity: users[name]!.identity, credentials: [users[name]!.credential]})
  // Public evidence is deliberately separate from the SDK's private durable journals.
  const save = (file: string, value: unknown) => writeFileSync(resolve(directory, file),
    JSON.stringify(value, (_, value: unknown) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n', {mode: 0o600})
  const proveServerRefusal = (slotId: `0x${string}`, name: string, action: 'sign' | 'ibe-extract',
    payload: {message?: Uint8Array; identity?: string}, queryId = 'access') =>
    refuse(tasra, wallet.signer, slotId, users[name]!.identity, users[name]!.credential, {action, ...payload}, queryId)
  console.log(`Fresh creator and identities ready. Private state: ${directory}`)
  return {tasra, wallet, issuer, users, store, directory, save, policy, authorize, proveServerRefusal, awaitUsageCredit}
}

export function stopped(error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+(?:~[\w.-]*)*/g, '[credential omitted]')
  console.error(`Stopped: ${message}`)
  process.exitCode = 1
}
