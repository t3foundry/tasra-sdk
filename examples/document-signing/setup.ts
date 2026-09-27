import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createWalletClient, http, parseEther, toHex, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  prepareSlot,
  createPreparedSlot,
  type SlotCreationJournal,
} from 'tasra-sdk/app'
import {
  createTasraWriteClient,
  provisionRule,
  resolveSlotKeeperUrls,
} from 'tasra-sdk/chain'
import {
  ed25519HolderKey,
  holderSigner,
  holderCnf,
  issueSdJwtVc,
} from 'tasra-sdk/oid4vp'
import {
  deployment,
  chain,
  evm,
  verifierAgentUrl,
  reachable,
  tasra,
} from './config.js'
import { stateDirectory, atomicSave, lockDirectory } from './store.js'
import { people, type Person } from './model.js'

export type Setup = {
  creatorKey: Hex
  issuerSeed: Hex
  holders: Record<string, Hex>
  funding?: { submitting: true; hash?: Hex }
  slots: Partial<Record<Person, Hex>>
  policies: Partial<Record<Person, { submitting: true; hash?: Hex }>>
}
export function loadSetup(): Setup {
  return JSON.parse(
    readFileSync(join(stateDirectory, 'setup.json'), 'utf8'),
  ) as Setup
}
const unlock = lockDirectory()
try {
  if (!(await tasra.check()).ready)
    throw new Error('Local registries unavailable; check config.ts')
  const health = await fetch(verifierAgentUrl + '/health', {
    signal: AbortSignal.timeout(10000),
  })
  if (!health.ok) throw new Error('Verifier unavailable')
  const file = join(stateDirectory, 'setup.json')
  const state: Setup = existsSync(file)
    ? loadSetup()
    : {
        creatorKey: generatePrivateKey(),
        issuerSeed: toHex(randomBytes(32)),
        holders: Object.fromEntries(
          ['alice', 'bob', 'mallory'].map((name) => [
            name,
            toHex(randomBytes(32)),
          ]),
        ),
        slots: {},
        policies: {},
      }
  const save = () => atomicSave(file, state)
  save()
  const creator = privateKeyToAccount(state.creatorKey)
  const writer = createTasraWriteClient({
    ...deployment,
    privateKey: state.creatorKey,
  })
  if (!state.funding) {
    state.funding = { submitting: true }
    save()
    // PUBLIC Avalanche local-development key. The descriptor fixes chain 43112.
    const funder = privateKeyToAccount(
      '0x56289e99c94b6912bfc12adc093c9b51124f0dc54ac7a766b2bc5ccf558d8027',
    )
    const wallet = createWalletClient({
      account: funder,
      chain: evm,
      transport: http(deployment.rpcUrl),
    })
    state.funding.hash = await wallet.sendTransaction({
      to: creator.address,
      value: parseEther('1'),
    })
    save()
  }
  if (!state.funding.hash)
    throw new Error(
      'Funding outcome unknown: reconcile setup.json before resuming',
    )
  if (
    (await chain.client.waitForTransactionReceipt({ hash: state.funding.hash }))
      .status !== 'success'
  )
    throw new Error('Funding reverted')
  const issuer = ed25519HolderKey(Buffer.from(state.issuerSeed.slice(2), 'hex'))
  mkdirSync(join(stateDirectory, 'wallets'), { recursive: true, mode: 0o700 })
  for (const [name, seed] of Object.entries(state.holders)) {
    const holder = ed25519HolderKey(Buffer.from(seed.slice(2), 'hex'))
    const credential = issueSdJwtVc({
      issuer: {
        did: issuer.did,
        kid: issuer.did + '#0',
        signer: holderSigner(issuer),
      },
      vct: 'DocumentSigner',
      sub: 'did:demo:' + name,
      claims: { role: 'document-signer' },
      cnf: holderCnf(holder),
      ttlSecs: 86400,
    })
    atomicSave(join(stateDirectory, 'wallets', name + '.json'), {
      schema: 'tasra-demo-wallet/v1',
      name,
      seed,
      credential,
    })
  }
  for (const person of people) {
    if (state.slots[person]) continue
    const rule = JSON.stringify({
      credentials: [
        {
          id: 'document',
          format: 'dc+sd-jwt',
          meta: { vct_values: ['DocumentSigner'] },
          claims: [
            { path: ['iss'], values: [issuer.did] },
            { path: ['sub'], values: ['did:demo:' + person] },
            { path: ['role'], values: ['document-signer'] },
          ],
        },
      ],
    })
    const journalPath = join(stateDirectory, person + '-creation.json')
    const journal: SlotCreationJournal = existsSync(journalPath)
      ? (JSON.parse(readFileSync(journalPath, 'utf8')) as SlotCreationJournal)
      : prepareSlot(deployment, creator.address, {
          dcqlRule: rule,
          mode: 'frost',
          authType: 'oid4vp',
          k: 2,
          n: 3,
        })
    const completed = await createPreparedSlot(journal, {
      wallet: writer.wallet,
      persist: async (value) => atomicSave(journalPath, value),
      options: { maxWaitMs: 300000 },
    })
    const slotId = completed.intent.slotId
    const deadline = Date.now() + 180000
    while (!(await tasra.slots.get(slotId)).ready) {
      if (Date.now() > deadline)
        throw new Error('DKG pending; resume setup later')
      await new Promise((r) => setTimeout(r, 1500))
    }
    await provisionRule(chain, {
      slotId,
      dcqlRule: completed.intent.dcqlRule,
      ruleSalt: completed.intent.ruleSalt,
      signer: creator,
      keeperUrls: (await resolveSlotKeeperUrls(chain, slotId)).map(reachable),
      signal: AbortSignal.timeout(30000),
    })
    if (!state.policies[person]) {
      state.policies[person] = { submitting: true }
      save()
      state.policies[person]!.hash = await writer.setVerifierPolicy(
        slotId,
        3,
        2,
      )
      save()
    }
    const hash = state.policies[person]!.hash
    if (!hash)
      throw new Error(
        'Policy outcome unknown: reconcile setup.json before resuming',
      )
    if (
      (await chain.client.waitForTransactionReceipt({ hash })).status !==
      'success'
    )
      throw new Error('Policy reverted')
    state.slots[person] = slotId
    save()
    console.log(person + ' slot ready: ' + slotId)
  }
  const serviceFile = join(stateDirectory, 'service.json')
  const existing = existsSync(serviceFile)
    ? (JSON.parse(readFileSync(serviceFile, 'utf8')) as { senderToken: string })
    : undefined
  atomicSave(serviceFile, {
    creatorKey: state.creatorKey,
    slots: state.slots,
    senderToken: existing?.senderToken ?? randomBytes(32).toString('hex'),
    holderKeys: Object.fromEntries(
      people.map((name) => [
        name,
        ed25519HolderKey(Buffer.from(state.holders[name]!.slice(2), 'hex'))
          .publicJwk,
      ]),
    ),
  })
  atomicSave(join(stateDirectory, 'public.json'), {
    deployment,
    verifierAgentUrl,
    issuerDid: issuer.did,
    slots: state.slots,
  })
  console.log(
    'Ready. Import .tasra/wallets/alice.json and bob.json into separate browser contexts. Wallet files are private.',
  )
} finally {
  unlock()
}
