import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { hexToBytes } from 'tasra-sdk'
import { createFileStore } from 'tasra-sdk/app/node'
import { deployment, verifierAgentUrl, tasra, networkIdentity, assertSameNetwork, type NetworkIdentity } from './config.js'
import { stateDirectory, atomicSave, lockDirectory } from './store.js'
import { people, toHex, type Hex, type Person } from './model.js'

export type Setup = {
  schema: 'tasra-document-setup/v2'
  network: NetworkIdentity
  creatorKey: Hex
  issuerSeed: Hex
  holders: Record<string, Hex>
  slots: Partial<Record<Person, Hex>>
}
export function loadSetup(): Setup {
  const state = JSON.parse(readFileSync(join(stateDirectory, 'setup.json'), 'utf8')) as Setup
  if (state.schema !== 'tasra-document-setup/v2')
    throw new Error('Older setup state requires reconciliation. Preserve it; use a fresh TASRA_SIGN_DATA directory for this tutorial.')
  assertSameNetwork(state.network)
  return state
}
const unlock = lockDirectory()
try {
  if (!(await tasra.check()).ready)
    throw new Error('Network registries unavailable; check the downloaded manifest')
  const health = await fetch(verifierAgentUrl + '/health', { signal: AbortSignal.timeout(10000) })
  if (!health.ok) throw new Error('Verifier unavailable')

  // Save fresh creator and identity keys before funding or creating any slots.
  const file = join(stateDirectory, 'setup.json')
  const newIdentitySeed = () => {
    const identity = tasra.identities.create()
    try { return toHex(identity.exportPrivateKey()) } finally { identity.destroy() }
  }
  const state: Setup = existsSync(file) ? loadSetup() : {
    schema: 'tasra-document-setup/v2',
    network: networkIdentity,
    creatorKey: tasra.wallets.create().exportPrivateKey(),
    issuerSeed: newIdentitySeed(),
    holders: Object.fromEntries(['alice', 'bob', 'mallory'].map(name => [name, newIdentitySeed()])),
    slots: {},
  }
  const save = () => atomicSave(file, state)
  save()
  const store = createFileStore(join(stateDirectory, 'sdk'))
  const creator = tasra.wallets.create({ privateKey: state.creatorKey })
  await store.save('creator-key', creator.exportPrivateKey())
  await store.save('network-pin', networkIdentity.manifestSha256)
  console.log(`Creator: ${creator.address} on chain ${deployment.chainId}.`)
  if (await tasra.chain.client.getBalance({address: creator.address}) < 5n * 10n ** 16n) {
    throw new Error('Fund this address with at least 0.05 AVAX using the official Fuji C-Chain faucet or your wallet, then rerun npm run setup. Saved creator state will be reused.')
  }

  // Each signer receives a separate identity and holder-bound credential.
  const issuer = tasra.identities.create({ seed: hexToBytes(state.issuerSeed) })
  mkdirSync(join(stateDirectory, 'wallets'), { recursive: true, mode: 0o700 })
  for (const [name, seed] of Object.entries(state.holders)) {
    const holder = tasra.identities.create({ seed: hexToBytes(seed) })
    const credential = tasra.credentials.issue({
      issuer, holder, type: 'DocumentSigner', subject: 'did:demo:' + name,
      claims: { role: 'document-signer' }, ttlSecs: 86400,
    })
    atomicSave(join(stateDirectory, 'wallets', name + '.json'), {
      schema: 'tasra-demo-wallet/v1', name, seed, credential,
    })
    holder.destroy()
  }

  // A stable name lets the SDK resume creation, rule delivery, and verifier setup.
  for (const person of people) {
    const slot = await tasra.slots.create({
      name: 'document-' + person, mode: 'frost',
      policy: tasra.credentials.policy({
        issuer, type: 'DocumentSigner', subjects: ['did:demo:' + person],
        claims: { role: ['document-signer'] },
      }),
      threshold: { k: 2, n: 3 }, verifiers: { committee: 3, quorum: 2 },
    }, { wallet: creator, store })
    state.slots[person] = slot.slotId
    save()
    console.log(person + ' key ready: ' + slot.slotId)
    console.log(`Before starting the app, buy TSRA with EURC and fund this slot using the funding guide. Status: npx tsx fund-slot.ts ${JSON.stringify(join(stateDirectory, 'sdk'))} status --slot ${slot.slotId}`)
  }

  // Application records remain separate from the SDK's durable operation journals.
  const serviceFile = join(stateDirectory, 'service.json')
  const existing = existsSync(serviceFile)
    ? JSON.parse(readFileSync(serviceFile, 'utf8')) as { senderToken: string }
    : undefined
  const holderKeys = Object.fromEntries(people.map(name => {
    const identity = tasra.identities.create({ seed: hexToBytes(state.holders[name]!) })
    const publicKey = identity.holder.publicJwk
    identity.destroy()
    return [name, publicKey]
  }))
  atomicSave(serviceFile, {
    network: networkIdentity,
    creatorKey: state.creatorKey, slots: state.slots,
    senderToken: existing?.senderToken ?? randomBytes(32).toString('hex'), holderKeys,
  })
  atomicSave(join(stateDirectory, 'public.json'), {
    deployment, verifierAgentUrl, issuerDid: issuer.did, slots: state.slots,
  })
  issuer.destroy()
  console.log('Setup complete. Fund both slots with TSRA usage credit before npm start. Import .tasra/wallets/alice.json and bob.json into separate browser contexts. Wallet files are private.')
} finally {
  unlock()
}
