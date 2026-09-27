/** Local-fleet walkthrough: one account, Alice OR Bob, and a real verifier denial. */
import {mkdirSync, mkdtempSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync} from 'node:fs'
import {randomBytes} from 'node:crypto'
import {resolve} from 'node:path'
import {createWalletClient, defineChain, http, keccak256, parseEther, toHex, type Hex} from 'viem'
import {generatePrivateKey, privateKeyToAccount} from 'viem/accounts'
import {createTasra, defineDeployment, prepareSlot, createPreparedSlot, toViemAccount} from 'tasra-sdk/app'
import {createTasraChainClient, createTasraWriteClient, provisionRule, resolveSlotKeeperUrls, nodeApi} from 'tasra-sdk/chain'
import {
  ed25519HolderKey, holderSigner, holderCnf, issueSdJwtVc, openVerifierAgentSession,
  presentToRequestUri, awaitVerifierAgentResult, fetchRequestObject, parseOpenid4vpUri,
  parseSdJwt, sdJwtCredentialView, buildResponse, submitResponse, VerifierAgentSessionError,
} from 'tasra-sdk/oid4vp'

// Public configuration of the existing development fleet. Update after redeployment.
const rpcUrl = 'http://127.0.0.1:9650/ext/bc/C/rpc'
const verifierAgentUrl = 'https://localhost:19444'
const addresses = {
  KeyRegistry: '0x94c75679D75bfdc310669c0De4dE4398E922232b',
  NodeRegistry: '0xEA7A0602b6DB6Aa767C5649b4d5083c426Cb8083',
} as const
const network = defineChain({id: 43112, name: 'Local Tasra', nativeCurrency: {name: 'AVAX', symbol: 'AVAX', decimals: 18}, rpcUrls: {default: {http: [rpcUrl]}}})
const chain = createTasraChainClient({rpcUrl, addresses, chainId: network.id})
const deployment = defineDeployment({schemaVersion: 1, name: 'Local Tasra', chainId: network.id, rpcUrl, addresses, coordinator: 'lowest-operator-id'})
const tasra = createTasra({deployment, chain, keeperUrl: reachable})
const client = chain.client
const freshHex = (): Hex => toHex(randomBytes(32))
const pause = () => new Promise(resolve => setTimeout(resolve, 2000))

// Docker keeper names are advertised on chain. Translate only this known local topology.
function reachable(url: string): string {
  const value = new URL(url)
  const match = /^keykeeper-node-([1-5])$/.exec(value.hostname)
  if (match && value.port === '8080') {
    value.hostname = '127.0.0.1'
    value.port = String(8090 + Number(match[1]))
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(value.hostname)) throw new Error('This demo requires local keepers')
  return value.toString().replace(/\/$/, '')
}

async function main() {
  // 1. Check before spending even public development funds.
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(rpcUrl).hostname) || await client.getChainId() !== 43112) {
    throw new Error('This example may run only on the local development chain 43112')
  }
  await chain.readers.keyRegistry.requiresCommitReveal().catch(() => {
    throw new Error('Cannot read KeyRegistry. Check the public fleet addresses; redeployment changes them.')
  })
  await chain.readers.nodeRegistry.activeCount()
  const health = await fetch(`${verifierAgentUrl}/health`, {signal: AbortSignal.timeout(10_000)})
  if (!health.ok) throw new Error(`Verifier-agent health: HTTP ${health.status}`)
  mkdirSync('.tasra', {recursive: true, mode: 0o700})
  const directory = mkdtempSync(resolve('.tasra/shared-account-'))
  const save = (file: string, value: unknown) => {
    const temporary = `${directory}/${file}.tmp`
    writeFileSync(temporary, JSON.stringify(value,
      (_, v: unknown) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n', {mode: 0o600})
    const fd = openSync(temporary, 'r')
    try { fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(temporary, `${directory}/${file}`)
    const dir = openSync(directory, 'r')
    try { fsyncSync(dir) } finally { closeSync(dir) }
  }
  console.log(`Private recovery files: ${directory}`)

  // 2. Create fresh application identities and credentials. No operator/issuer secrets.
  const creatorKey = generatePrivateKey()
  const creator = privateKeyToAccount(creatorKey)
  const issuer = ed25519HolderKey(randomBytes(32))
  const users = Object.fromEntries(['alice', 'bob', 'mallory'].map(name => {
    const holder = ed25519HolderKey(randomBytes(32))
    const credential = issueSdJwtVc({
      issuer: {did: issuer.did, kid: `${issuer.did}#0`, signer: holderSigner(issuer)},
      vct: 'TreasurySigner', sub: `did:demo:${name}`, claims: {role: 'treasury-signer'},
      cnf: holderCnf(holder), ttlSecs: 3600,
    })
    return [name, {holder, credential}]
  }))
  const rule = JSON.stringify({credentials: [{id: 'treasury', format: 'dc+sd-jwt',
    meta: {vct_values: ['TreasurySigner']}, claims: [
      {path: ['iss'], values: [issuer.did]},
      {path: ['sub'], values: ['did:demo:alice', 'did:demo:bob']},
      {path: ['role'], values: ['treasury-signer']},
    ]}]})
  const slotId = freshHex(), ruleSalt = freshHex(), salt = freshHex()
  save('recovery.json', {creatorKey, issuerKey: toHex(issuer.privateKey), slotId, ruleSalt, salt, rule,
    users: Object.fromEntries(Object.entries(users).map(([name, u]) => [name, {key: toHex(u.holder.privateKey), credential: u.credential}]))})
  // Avalanche's PUBLIC local-development funder; never use it on a shared/public chain.
  const funder = privateKeyToAccount('0x56289e99c94b6912bfc12adc093c9b51124f0dc54ac7a766b2bc5ccf558d8027')
  const funding = createWalletClient({account: funder, chain: network, transport: http(rpcUrl)})
  const fundingHash = await funding.sendTransaction({to: creator.address, value: parseEther('1')})
  save('creator-funding.json', {hash: fundingHash})
  if ((await client.waitForTransactionReceipt({hash: fundingHash})).status !== 'success') throw new Error('Creator funding reverted')
  console.log('1. Fresh creator funded; Alice, Bob and Mallory have separate credentials.')

  // 3. Create the slot, wait for its public key, and provision using the creator's key.
  const writer = createTasraWriteClient({rpcUrl, chainId: network.id, addresses, privateKey: creatorKey})
  const args = {slotId, salt, ruleSalt, dcqlRule: rule, k: 2, n: 3, mode: 'tecdsa' as const, authType: 'oid4vp' as const}
  const creation = await createPreparedSlot(prepareSlot(deployment, creator.address, args), {wallet: writer.wallet,
    persist: async journal => {save('creation-journal.json', journal)}, options: {maxWaitMs: 300_000}})
  save('creation.json', creation)
  const deadline = Date.now() + 180_000
  let slot = await chain.readers.keyRegistry.getKeySlot(slotId)
  while (slot.publicKey === '0x' && Date.now() < deadline) {
    await pause()
    slot = await chain.readers.keyRegistry.getKeySlot(slotId)
  }
  if (!slot.exists || slot.cancelled || slot.mode !== 2 || slot.publicKey === '0x') throw new Error('Slot not ready; preserve recovery.json')
  const accountSlot = await tasra.slots.ecdsa(slotId)
  const address = await accountSlot.getAddress()
  const keepers = (await resolveSlotKeeperUrls(chain, slotId)).map(reachable)
  if (keepers.length !== 3) throw new Error('Expected three assigned keepers')
  const fleet = await Promise.all(keepers.map(async url => {
    const info = await nodeApi.info(url)
    return {url, version: info.version, buildProfile: info.build_profile}
  }))
  await provisionRule(chain, {slotId, ruleSalt, dcqlRule: rule, signer: creator, keeperUrls: keepers, signal: AbortSignal.timeout(30_000)})
  await writer.setVerifierPolicy(slotId, 3, 2)
  const wallet = createWalletClient({account: creator, chain: network, transport: http(rpcUrl)})
  const hash = await wallet.sendTransaction({to: address, value: parseEther('0.1')})
  if ((await client.waitForTransactionReceipt({hash})).status !== 'success') throw new Error('Account funding reverted')
  save('account.json', {slotId, address, keepers, fundingHash: hash})
  console.log(`2. Created and provisioned slot ${slotId}\n   Ethereum account: ${address}`)

  // 4. Each user's wallet presents its own credential for one exact transaction.
  const receipts: Array<{user: string; hash: Hex; nonce: number; from: string; blockNumber: string}> = []
  for (const name of ['alice', 'bob']) {
    const user = users[name]!
    const transaction = {type: 'eip1559' as const, chainId: network.id, to: address, value: 0n, gas: 21_000n,
      nonce: await client.getTransactionCount({address, blockTag: 'pending'}),
      maxPriorityFeePerGas: 1_000_000_000n, maxFeePerGas: (await client.getGasPrice()) * 2n + 1_000_000_000n}
    const account = await toViemAccount(accountSlot, {description: `${name}: zero-value self-transfer`,
      signal: AbortSignal.timeout(120_000), authorize: async operation => {
        const session = await openVerifierAgentSession({...operation, verifierAgentUrl, signer: creator})
        await presentToRequestUri(session.qrPayload, [{sdJwt: user.credential}], user.holder)
        const grant = await awaitVerifierAgentResult(session, {timeoutMs: 60_000, signal: operation.signal})
        if (!grant.verifierProofs?.length) throw new Error('Missing verifier membership proofs')
        return {token: grant.token, verifierProofs: grant.verifierProofs}
      }})
    const serializedTransaction = await account.signTransaction(transaction)
    const from = account.address
    const txHash = keccak256(serializedTransaction)
    save(`${name}-submission.json`, {hash: txHash, serializedTransaction, nonce: transaction.nonce})
    await client.sendRawTransaction({serializedTransaction})
    const receipt = await client.waitForTransactionReceipt({hash: txHash})
    if (receipt.status !== 'success' || receipt.from.toLowerCase() !== address.toLowerCase()) throw new Error('Transaction failed')
    save(`${name}-receipt.json`, receipt)
    receipts.push({user: name, hash: txHash, nonce: transaction.nonce, from, blockNumber: receipt.blockNumber.toString()})
    console.log(`3. ${name}: confirmed ${txHash} (nonce ${transaction.nonce})`)
  }

  // 5. Negative test: deliberately send Mallory's nonmatching credential to the server.
  // Normal wallets filter it out locally. This checks the verifier's actual refusal.
  const nonceBefore = await client.getTransactionCount({address, blockTag: 'pending'})
  const session = await openVerifierAgentSession({verifierAgentUrl, chainId: network.id,
    keyRegistry: addresses.KeyRegistry, slotId, signer: creator, action: 'sign', message: randomBytes(32), description: 'Negative test: Mallory'})
  const ro = await fetchRequestObject(parseOpenid4vpUri(session.qrPayload).requestUri)
  const mallory = users.mallory!
  const parsed = parseSdJwt(mallory.credential)
  const response = buildResponse({ro, holder: mallory.holder,
    candidate: {held: {sdJwt: mallory.credential}, parsed, view: sdJwtCredentialView(parsed), queryId: 'treasury'}})
  await submitResponse(ro, response)
  let denied = false
  let denialReason = ''
  try { await awaitVerifierAgentResult(session, {timeoutMs: 60_000}) }
  catch (error) {
    if (!(error instanceof VerifierAgentSessionError) || error.kind !== 'refused' || !/no presented credential satisfies query/i.test(error.message)) throw error
    denied = true
    denialReason = error.message
  }
  if (!denied) throw new Error('Mallory unexpectedly obtained authorization')
  const nonceAfter = await client.getTransactionCount({address, blockTag: 'pending'})
  if (nonceAfter !== nonceBefore) throw new Error('Account nonce changed during denial check')
  const evidence = {chainId: network.id, addresses, fleet, slotId, address, createdAt: new Date().toISOString(), receipts,
    mallory: {result: 'verifier-refused', reason: denialReason, sessionId: session.sessionId, nonceBefore, nonceAfter}}
  save('evidence.json', evidence)
  console.log(`4. Mallory: refused by verifier; nonce unchanged (${nonceAfter}).\nEvidence: ${directory}/evidence.json`)
}

main().catch((error: unknown) => {
  // Avoid printing error objects that can contain credential-bearing HTTP requests.
  const message = (error instanceof Error ? error.message : String(error)).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+(?:~[\w.-]*)*/g, '[credential omitted]')
  console.error(`Stopped: ${message}`)
  process.exitCode = 1
})
