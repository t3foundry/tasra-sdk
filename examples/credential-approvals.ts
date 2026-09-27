/** Complete local-fleet document signing tutorial: two independent signatures. */
import {mkdirSync, mkdtempSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync} from 'node:fs'
import {randomBytes, createHash, createPrivateKey, sign} from 'node:crypto'
import {resolve} from 'node:path'
import {createWalletClient, defineChain, http, parseEther, toHex, keccak256, type Hex} from 'viem'
import {generatePrivateKey, privateKeyToAccount} from 'viem/accounts'
import {createDualSignClient, dualSignApprovalPayload} from 'tasra-sdk/committee'
import {hexToBytes} from 'tasra-sdk'
import {createTasra, defineDeployment, prepareSlot, createPreparedSlot, type OperationAuthorizer} from 'tasra-sdk/app'
import {createTasraChainClient, createTasraWriteClient, provisionRule, resolveSlotKeeperUrls, nodeApi, keyRegistryAbi} from 'tasra-sdk/chain'
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
  const requiresCommitReveal = await chain.readers.keyRegistry.requiresCommitReveal().catch(() => {
    throw new Error('Cannot read KeyRegistry. Check the public fleet addresses; redeployment changes them.')
  })
  await chain.readers.nodeRegistry.activeCount()
  const health = await fetch(`${verifierAgentUrl}/health`, {signal: AbortSignal.timeout(10_000)})
  if (!health.ok) throw new Error(`Verifier-agent health: HTTP ${health.status}`)
  mkdirSync('.tasra', {recursive: true, mode: 0o700})
  const directory = mkdtempSync(resolve('.tasra/credential-approvals-'))
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
      vct: 'DocumentSigner', sub: `did:demo:${name}`, claims: {role: 'document-signer'},
      cnf: holderCnf(holder), ttlSecs: 3600,
    })
    return [name, {holder, credential}]
  }))
  const rule = JSON.stringify({credentials: [{id: 'document', format: 'dc+sd-jwt',
    meta: {vct_values: ['DocumentSigner']}, claims: [
      {path: ['iss'], values: [issuer.did]},
      {path: ['sub'], values: ['did:demo:alice', 'did:demo:bob']},
      {path: ['role'], values: ['document-signer']},
    ]}]})
  save('recovery.json', {creatorKey, issuerKey: toHex(issuer.privateKey), rule,
    users: Object.fromEntries(Object.entries(users).map(([name, u]) => [name, {key: toHex(u.holder.privateKey), credential: u.credential}]))})
  // Avalanche's PUBLIC local-development funder; never use it on a shared/public chain.
  const funder = privateKeyToAccount('0x56289e99c94b6912bfc12adc093c9b51124f0dc54ac7a766b2bc5ccf558d8027')
  const funding = createWalletClient({account: funder, chain: network, transport: http(rpcUrl)})
  const fundingHash = await funding.sendTransaction({to: creator.address, value: parseEther('1')})
  save('creator-funding.json', {hash: fundingHash})
  if ((await client.waitForTransactionReceipt({hash: fundingHash})).status !== 'success') throw new Error('Creator funding reverted')
  console.log('1. Fresh creator funded; Alice, Bob and Mallory have separate credentials.')

  const writer = createTasraWriteClient({rpcUrl, chainId: network.id, addresses, privateKey: creatorKey})
  async function createSlot(mode: 'frost' | 'bls', subjects: string[]) {
    const ruleForSlot = JSON.parse(rule) as {credentials: {claims: {path: string[]; values: string[]}[]}[]}
    ruleForSlot.credentials[0]!.claims.find(c => c.path[0] === 'sub')!.values = subjects.map(name => `did:demo:${name}`)
    const journal = prepareSlot(deployment, creator.address, {dcqlRule: JSON.stringify(ruleForSlot), mode, authType: 'oid4vp', k: 2, n: 3})
    const completed = await createPreparedSlot(journal, {wallet: writer.wallet,
      persist: async value => {save(`creation-${journal.intent.slotId}.json`, value)}, options: {maxWaitMs: 300_000}})
    const id = completed.intent.slotId, deadline = Date.now() + 180_000
    let metadata = await chain.readers.keyRegistry.getKeySlot(id)
    while (metadata.publicKey === '0x' && Date.now() < deadline) {
      await pause()
      metadata = await chain.readers.keyRegistry.getKeySlot(id)
    }
    if (!metadata.exists || metadata.cancelled || metadata.publicKey === '0x') throw new Error('Slot key generation not ready')
    const keepers = (await resolveSlotKeeperUrls(chain, id)).map(reachable)
    await provisionRule(chain, {slotId: id, ruleSalt: completed.intent.ruleSalt, dcqlRule: completed.intent.dcqlRule,
      signer: creator, keeperUrls: keepers, signal: AbortSignal.timeout(30_000)})
    await writer.setVerifierPolicy(id, 3, 2)
    console.log(`Created ${mode} slot for ${subjects.join(', ')}: ${id}`)
    if (!completed.result) throw new Error('Creation completed without transaction references')
    // Public evidence is a whitelist; salts and the private intent stay in the journal.
    const {commitTx, revealTx, targetEpoch, seeded} = completed.result
    return {id, metadata, creation: {slotId: id, commitTx, revealTx, targetEpoch, seeded}}
  }
  function authorize(name: string): OperationAuthorizer {
    return async operation => {
      const session = await openVerifierAgentSession({...operation, verifierAgentUrl, signer: creator})
      await presentToRequestUri(session.qrPayload, [{sdJwt: users[name]!.credential}], users[name]!.holder)
      const grant = await awaitVerifierAgentResult(session, {timeoutMs: 60_000, signal: operation.signal})
      if (!grant.verifierProofs?.length) throw new Error('Missing verifier membership proofs')
      return {token: grant.token, verifierProofs: grant.verifierProofs}
    }
  }
  async function proveServerRefusal(id: Hex, name: string, action: 'sign' | 'ibe-extract', payload: {message?: Uint8Array; identity?: string}) {
    const session = await openVerifierAgentSession({verifierAgentUrl, chainId: network.id,
      keyRegistry: addresses.KeyRegistry, slotId: id, signer: creator, action, ...payload, description: 'Negative authorization test'})
    const ro = await fetchRequestObject(parseOpenid4vpUri(session.qrPayload).requestUri), user = users[name]!
    const parsed = parseSdJwt(user.credential)
    await submitResponse(ro, buildResponse({ro, holder: user.holder,
      candidate: {held: {sdJwt: user.credential}, parsed, view: sdJwtCredentialView(parsed), queryId: 'document'}}))
    try { await awaitVerifierAgentResult(session, {timeoutMs: 60_000}) }
    catch (error) {
      if (error instanceof VerifierAgentSessionError && error.kind === 'refused' && /no presented credential satisfies query/i.test(error.message)) return 'verifier-refused' as const
      throw error
    }
    throw new Error('Unauthorized user obtained a grant')
  }
  const created = await createSlot('frost', ['alice', 'bob'])
  const policyHash = await writer.wallet.writeContract({address: addresses.KeyRegistry, abi: keyRegistryAbi,
    functionName: 'setDualControlPolicy', args: [created.id, 2, keccak256(toHex(rule)), []]})
  if ((await client.waitForTransactionReceipt({hash: policyHash})).status !== 'success') throw new Error('Policy transaction reverted')
  await pause(); await pause()
  const approvals = await (await tasra.slots.frost(created.id)).approvals({quorum: 2, credentialGated: true})
  const message = new TextEncoder().encode('Approve exact synthetic document version 1'), request = await approvals.create(message)
  save('request.json', {requestId: request.requestId, coordinator: request.nodeUrl, slotId: created.id, message: toHex(message)})
  const approve = async (name: string) => {
    const holder = users[name]!.holder
    const key = createPrivateKey({format: 'jwk', key: {...holder.publicJwk, d: Buffer.from(holder.privateKey).toString('base64url')}})
    const canonical = dualSignApprovalPayload(created.id, message, request.requestId)
    const grant = await authorize(name)({chainId: network.id, keyRegistry: addresses.KeyRegistry, slotId: created.id,
      action: 'dual-approve', payloadDigest: new Uint8Array(createHash('sha256').update(canonical).digest()), description: `${name}: approve exact document`})
    return request.approve({signer: {publicKey: new Uint8Array(Buffer.from(holder.publicJwk.x!, 'base64url')),
      sign: async bytes => new Uint8Array(sign(null, bytes, key))}, authorization: grant})
  }
  const first = await approve('alice')
  if (first.status !== 'pending' || first.have !== 1) throw new Error('One holder reached quorum unexpectedly')
  try { await approve('alice') } catch (error) {
    if (!(error instanceof Error) || !('status' in error) || ![400, 403, 409].includes(Number(error.status))) throw error
  }
  const duplicate = await request.status()
  if (duplicate.status !== 'pending' || duplicate.have !== 1) throw new Error('Same holder counted twice')
  await approve('bob')
  const result = await request.wait({timeoutMs: 120_000})
  save('evidence.json', {chainId: network.id, addresses, createdAt: new Date().toISOString(), slotId: created.id, creation: created.creation,
    policyHash, requestId: request.requestId, mode: 'credential-gated', quorum: 2, duplicateHolderHave: duplicate.have,
    verifiedSignature: {r: toHex(result.signature.r), z: toHex(result.signature.z), groupPublicKey: toHex(result.groupPublicKey)}})
  console.log(`PASS: Alice and Bob supplied distinct holder-bound approvals; duplicate holder added no vote. Evidence: ${directory}/evidence.json`)
}

main().catch((error: unknown) => {
  // Avoid printing error objects that can contain credential-bearing HTTP requests.
  const message = (error instanceof Error ? error.message : String(error)).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+(?:~[\w.-]*)*/g, '[credential omitted]')
  console.error(`Stopped: ${message}`)
  process.exitCode = 1
})
