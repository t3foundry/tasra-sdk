// A local fleet wallet uses the SDK's paid protocol directly, including original
// client consent. No CLI, shell helper or service-selected signing body is used.
import assert from 'node:assert/strict'
import {constants, readSync, openSync, fstatSync, closeSync} from 'node:fs'
import {randomBytes} from 'node:crypto'
import {createWalletClient, hexToBytes, http, keccak256, toHex, type Address, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {createFileStore} from '../../src/app/node.ts'
import {reserveApplicationPayment} from '../../src/app/paid-reservation.ts'
import {createTasraChainClient} from '../../src/chain/client.ts'
import {keyRegistryAbi} from '../../src/chain/abis/keyRegistry.ts'
import {createTasraWriteClient, ruleCommitment} from '../../src/chain/write.ts'
import {parseApplicationServiceProfiles} from '../../src/chain/serviceProfiles.ts'
import {createNodeAgentWalletFetch, createNodePaidAgentTransport} from '../../src/chain/node.ts'
import {discoverPaidOperationContext, readClientExecutionPolicy, type PaidContextDeployment} from '../../src/chain/prepaid.ts'
import {createKeeperExecutionApprover} from '../../src/chain/keeperExecution.ts'
import {prepareRegisteredPaidSession} from '../../src/chain/registeredPaidAgent.ts'
import {createExecutionCertificate, createLocalExecutionSigner} from '../../src/committee/execution.ts'
import {paymentIntentHash, paymentIntentTypedData, paymentSessionCommitment, prepaidRequestId, type PaymentIntentWire} from '../../src/committee/payment.ts'
import {buildResponse, parseSdJwt, planPresentation, sdJwtCredentialView, submitResponse, type HolderKey, type OperationInput} from '../../src/oid4vp/index.ts'
import {presentationOperationTypedData, verifierAgentResult} from '../../src/oid4vp/verifier-agent.ts'
import {requestHash} from '../../src/oid4vp/binding.ts'
import {canonicalize} from '../../src/auth/oid4vp.ts'
import type {FleetConfig} from './_fleet.ts'
import {localPrepaidSettings} from './_prepaid-funding.ts'
import {drawnVerifierWitnesses} from './_paid-policy.ts'
import {drivePaidWalletSession} from './_paid-wallet-session.ts'
import {withDedicatedPayer} from './_payer-queue.ts'

export function readPaidConfigFile(file: string, cap: number): string {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = fstatSync(fd)
    assert(stat.isFile() && stat.size > 0 && stat.size <= cap, 'Explicit paid configuration must be a bounded regular file')
    const bytes = Buffer.alloc(cap + 1)
    let length = 0
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null)
      if (!count) break
      length += count
    }
    assert(length <= cap, 'Paid configuration exceeded its byte limit')
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(0, length))
  } finally { closeSync(fd) }
}
function positive(value: string | undefined, name: string, cap: bigint): bigint {
  assert(value && /^[1-9][0-9]{0,77}$/.test(value) && BigInt(value) <= cap, `${name} must set a finite positive spending limit`)
  return BigInt(value)
}
export function paidWalletSettings(cfg: FleetConfig) {
  const local = localPrepaidSettings(cfg), raw = cfg.raw
  assert(raw.KK_PREPAID_AGENT_PROFILE, 'KK_PREPAID_AGENT_PROFILE must retain the independently approved registered provider')
  const profiles = parseApplicationServiceProfiles(readPaidConfigFile(raw.KK_PREPAID_AGENT_PROFILE, 65_536))
  assert(profiles.chainId === 43112 && profiles.registry.toLowerCase() === cfg.book.ServiceRegistry?.toLowerCase()
    && profiles.verifierAgents.length === 1 && !profiles.relayers.length && !profiles.vaultServices.length, 'Paid wallet requires exactly one provider on the approved local registry')
  const profile = profiles.verifierAgents[0]!
  const specifiedAgent = raw.KK_VERIFIER_AGENT_URL ?? raw.KK_VERIFIER_AGENT_EXTERNAL_URL
  assert(!specifiedAgent || specifiedAgent === profile.endpoint, 'Wallet endpoint differs from the independently approved provider')
  const endpoint = new URL(profile.endpoint), privateHosts = (raw.KK_PREPAID_AGENT_PRIVATE_HOSTS ?? '').split(',').filter(Boolean)
  assert(privateHosts.every(host => host === endpoint.hostname), 'Private agent exception must name only the independently approved host')
  const ca = raw.KK_WALLET_CA_FILE ? readPaidConfigFile(raw.KK_WALLET_CA_FILE, 262_144) : undefined
  const accountantUrls = (raw.KK_PREPAID_ACCOUNTANT_URLS ?? '').split(',').filter(Boolean)
  assert(accountantUrls.length && accountantUrls.length <= 16 && new Set(accountantUrls).size === accountantUrls.length,
    'KK_PREPAID_ACCOUNTANT_URLS must explicitly approve distinct reservation and artifact hosts')
  for (const endpoint of accountantUrls) {
    const url = new URL(endpoint)
    assert(['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'Local accountant endpoints must be explicit loopback origins')
  }
  const committee = Number(positive(raw.KK_PREPAID_VERIFIER_COUNT, 'KK_PREPAID_VERIFIER_COUNT', 4096n))
  const quorum = Number(positive(raw.KK_PREPAID_VERIFIER_QUORUM, 'KK_PREPAID_VERIFIER_QUORUM', BigInt(committee)))
  const maxCost = positive(raw.KK_PREPAID_MAX_TASRA_UNITS, 'KK_PREPAID_MAX_TASRA_UNITS', 1000000000000000000n)
  const maxGas = positive(raw.KK_PREPAID_MAX_GAS, 'KK_PREPAID_MAX_GAS', 10000000n)
  const maxGasPrice = positive(raw.KK_PREPAID_MAX_FEE_PER_GAS, 'KK_PREPAID_MAX_FEE_PER_GAS', 1000000000000n)
  const routes = raw.KK_PREPAID_KEEPER_ROUTE_MAP
    ? JSON.parse(readPaidConfigFile(raw.KK_PREPAID_KEEPER_ROUTE_MAP, 65_536)) as unknown : {}
  assert(routes && typeof routes === 'object' && !Array.isArray(routes), 'Keeper routes must be an independently approved URL map')
  const map = new Map(Object.entries(routes).map(([registered, mapped]) => {
    assert(typeof mapped === 'string', 'Mapped keeper route must be a URL')
    for (const value of [registered, mapped]) {
      const url = new URL(value)
      assert(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash,
        'Keeper route violates the paid transport policy')
    }
    return [registered.replace(/\/$/, ''), mapped.replace(/\/$/, '')] as const
  }))
  assert(new Set(map.values()).size === map.size, 'Keeper route map aliases independent operator identities')
  return {...local, profile, transportPolicy: {ca, allowedPrivateHosts: privateHosts}, accountantUrls,
    defaultVerificationPolicy: {committee, quorum}, maxCost, maxGas, maxGasPrice,
    keeperUrl: (registered: string) => map.get(registered.replace(/\/$/, '')) ?? registered}
}

async function snapshotArtifact(hosts: string[], epoch: number, signal: AbortSignal): Promise<unknown> {
  for (const host of hosts) {
    signal.throwIfAborted()
    try {
      const response = await fetch(host.replace(/\/$/, '') + '/v1/verifier-set/' + epoch,
        {redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), headers: {'accept': 'application/json', 'accept-encoding': 'identity'}})
      assert(response.status === 200 && response.headers.get('content-type')?.split(';')[0] === 'application/json'
        && (!response.headers.get('content-encoding') || response.headers.get('content-encoding') === 'identity'), 'Snapshot HTTP response refused')
      assert(response.body, 'Snapshot body is missing')
      const reader = response.body.getReader(), chunks: Uint8Array[] = []
      let length = 0
      try {
        for (;;) {
          const {done, value} = await reader.read()
          if (done) break
          length += value.length
          assert(length <= 8 * 1024 * 1024, 'Snapshot exceeds the read-only artifact bound')
          chunks.push(value)
        }
      } finally { await reader.cancel() }
      const bytes = new Uint8Array(length); let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
      return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)) as unknown
    } catch { signal.throwIfAborted() }
  }
  throw new Error('No explicitly approved accountant served the original verifier snapshot')
}

export async function paidWalletCoordinator(cfg: FleetConfig, slot: Hex, entry: number): Promise<Address> {
  const settings = paidWalletSettings(cfg)
  assert(Number.isSafeInteger(entry) && entry >= 0, 'Invalid original coordinator selection')
  assert(cfg.book.Settlement && cfg.book.KeyRegistry && cfg.book.VerifierSetRegistry && cfg.book.AccountantSetRegistry && cfg.book.ThresholdRandomBeacon)
  const writer = createTasraWriteClient({rpcUrl: cfg.rpcUrl, addresses: cfg.book, privateKey: cfg.deployPk as Hex, chainId: 43112})
  const context = await discoverPaidOperationContext(writer.pub, {chainId: 43112, settlement: cfg.book.Settlement, keyRegistry: cfg.book.KeyRegistry,
    verifierSet: cfg.book.VerifierSetRegistry, accountantSet: cfg.book.AccountantSetRegistry, beacon: cfg.book.ThresholdRandomBeacon}, slot,
    {allowLocalHttp: true, defaultVerificationPolicy: settings.defaultVerificationPolicy})
  return context.contributors[entry % context.contributors.length]!.operator
}

export async function authorizePaidWallet(cfg: FleetConfig, slot: Hex, creatorKey: Hex,
  input: Pick<OperationInput, 'action' | 'message' | 'payloadDigest' | 'identity' | 'ttlSecs'>,
  wallet: {holder: HolderKey; sdJwt: string}, forcePresentation: boolean, coordinator?: Address) {
  input = structuredClone(input)
  wallet = structuredClone(wallet)
  const settings = paidWalletSettings(cfg), creator = privateKeyToAccount(creatorKey)
  assert(cfg.book.Settlement && cfg.book.KeyRegistry && cfg.book.VerifierSetRegistry && cfg.book.AccountantSetRegistry && cfg.book.ThresholdRandomBeacon,
    'Paid wallet requires independently configured settlement and anchored role registries')
  const deployment: PaidContextDeployment = {chainId: 43112, settlement: cfg.book.Settlement, keyRegistry: cfg.book.KeyRegistry,
    verifierSet: cfg.book.VerifierSetRegistry, accountantSet: cfg.book.AccountantSetRegistry, beacon: cfg.book.ThresholdRandomBeacon}
  const executionDeployment = {...deployment, defaultVerificationPolicy: settings.defaultVerificationPolicy}
  const store = createFileStore(settings.directory)
  const funding = await store.load<{phase: string; creator: Address; rule: string; ruleSalt: Hex}>(`funding-43112-${slot.slice(2)}`)
  assert(funding?.phase === 'confirmed' && funding.creator.toLowerCase() === creator.address.toLowerCase(),
    'Paid wallet requires the original confirmed funding, rule, salt and sovereign creator')
  const writer = createTasraWriteClient({rpcUrl: cfg.rpcUrl, addresses: cfg.book, privateKey: creatorKey, chainId: 43112})
  const chain = createTasraChainClient({rpcUrl: cfg.rpcUrl, addresses: cfg.book, chainId: 43112, multicall3: false})
  const context = await discoverPaidOperationContext(writer.pub, deployment, slot,
    {allowLocalHttp: true, defaultVerificationPolicy: settings.defaultVerificationPolicy, coordinator})
  assert.equal(context.creator.toLowerCase(), creator.address.toLowerCase(), 'Paid creator changed')
  const originalSlot = await writer.pub.readContract({address: deployment.keyRegistry, abi: keyRegistryAbi,
    functionName: 'getKeySlot', args: [slot], blockNumber: context.blockNumber})
  assert.equal(originalSlot.ruleCommitment.toLowerCase(), ruleCommitment(funding.ruleSalt, funding.rule).toLowerCase(), 'Original salted rule changed')
  assert.equal((await writer.pub.getBlock({blockNumber: context.blockNumber})).hash, context.blockHash, 'Original rule observation reorganized')
  const canonicalRule = canonicalize(funding.rule), query = JSON.parse(canonicalRule) as Record<string, unknown>
  const nowSecs = Math.floor(Date.now() / 1000), ttlSecs = input.ttlSecs ?? 600
  assert(Number.isSafeInteger(ttlSecs) && ttlSecs > 0 && ttlSecs <= 3600, 'Original payment expiry must be bounded')
  const operation = presentationOperationTypedData({...input, chainId: 43112, keyRegistry: deployment.keyRegistry, slotId: slot,
    description: 'Local test operation', nowSecs, ttlSecs})
  const random = toHex(randomBytes(32)), operationSig = await creator.signTypedData(operation.typedData)
  const unsigned = {...context.intentFields, action: input.action === 'sign' && context.mode === 2 ? 'eoa-sign' as const : input.action,
    payload_digest: toHex(operation.payloadDigest), session_commitment: paymentSessionCommitment(random, settings.profile.clientId, operation.operation.exp),
    nonce: toHex(randomBytes(32)), max_cost: settings.maxCost.toString(), expires: operation.operation.exp}
  const payment: PaymentIntentWire = {...unsigned, signature: await creator.signTypedData(paymentIntentTypedData(unsigned))}
  const expected = {slot, action: payment.action, payloadDigest: payment.payload_digest}
  const signal = AbortSignal.timeout(Math.min(150_000, ttlSecs * 1000))
  const artifact = await snapshotArtifact(settings.accountantUrls, payment.verification_epoch, signal)
  const members = drawnVerifierWitnesses(artifact, payment, deployment.verifierSet)
  const gasWallet = createWalletClient({account: creator, chain: writer.wallet.chain,
    transport: http(cfg.rpcUrl, {retryCount: 0, timeout: 15_000, fetchOptions: {redirect: 'error'}})})
  // Each slot's creator is its dedicated reservation gas payer. The store refuses
  // an unresolved nonce instead of silently retrying/replacing the transaction.
  await withDedicatedPayer('43112-' + creator.address.toLowerCase(), () => reserveApplicationPayment(writer.pub, gasWallet, deployment, payment, expected,
    {store, session: {random, audience: settings.profile.clientId}, accountantUrls: settings.accountantUrls,
      allowLocalHttp: true, maxGas: settings.maxGas, maxGasPrice: settings.maxGasPrice}))
  const {policy} = await readClientExecutionPolicy(writer.pub, executionDeployment, payment, expected)
  const seed = randomBytes(32), signer = createLocalExecutionSigner(seed), pollSecret = toHex(randomBytes(32)).slice(2)
  try {
  const certificate = await createExecutionCertificate({payment, policy, publicKey: signer.publicKey, expires: payment.expires, creator})
  const params = {operation: operation.operation, operationSig, messageHex: operation.messageHex, payment, random}
  const privateName = 'wallet-original-' + prepaidRequestId(payment).slice(2)
  await store.withLock(privateName, async () => {
    assert.equal(await store.load(privateName), undefined, 'Original paid client already retained; reconcile it')
    await store.save(privateName, {schema: 1, deployment: executionDeployment, payment, expected, seed: new Uint8Array(seed), certificate,
      profile: settings.profile, params, pollSecret, members, rule: canonicalRule, ruleSalt: funding.ruleSalt, artifact})
  })
  seed.fill(0)
  const session = await prepareRegisteredPaidSession(chain, {profile: settings.profile, deployment: executionDeployment,
    transport: createNodePaidAgentTransport(settings.transportPolicy), members, ruleHash: keccak256(toHex(canonicalRule)), dcqlQuery: query}, params,
    {certificate, signer, pollSecret, signal})
  const fetcher = createNodeAgentWalletFetch({profile: settings.profile, requestUri: settings.profile.endpoint + '/v1/request/' + session.sessionId,
    sessionId: session.sessionId}, settings.transportPolicy)
  const result = await drivePaidWalletSession({session, members, store, signal, wait: async () => {
    await new Promise<void>((resolve, reject) => {
      signal.throwIfAborted()
      const abort = () => {clearTimeout(timer); reject(signal.reason)}
      const timer = setTimeout(() => {signal.removeEventListener('abort', abort); resolve()}, 1000)
      signal.addEventListener('abort', abort, {once: true})
    })
  }, makePresentation: request => {
    const plan = planPresentation(request, [{sdJwt: wallet.sdJwt}]), parsed = parseSdJwt(wallet.sdJwt)
    const candidate = forcePresentation ? {held: {sdJwt: wallet.sdJwt}, parsed, view: sdJwtCredentialView(parsed), queryId: request.claims.dcql_query.credentials[0]!.id} : plan.chosen
    assert(candidate, 'Held credential does not answer the original client-approved request')
    const iat = Math.floor(Date.now() / 1000), built = buildResponse({ro: request, candidate, holder: wallet.holder, disclose: 'all', nowSecs: iat})
    assert(built.encrypted && built.form.response, 'Original SDK presentation must be encrypted')
    const holder = typeof parsed.payload.sub === 'string' ? parsed.payload.sub : wallet.holder.did
    return {approved: {holder, credentials: [built.presentation], holder_proof: null, oauth: null, iat}, form: built.form}
  }, submit: (request, presentation) => submitResponse(request, presentation, fetcher).then(() => {})})
  const grant = verifierAgentResult({sessionId: session.sessionId, paymentHash: paymentIntentHash(payment),
    requestHash: requestHash(43112, hexToBytes(slot), input.action, operation.payloadDigest)}, result)
  assert(grant.verifierProofs?.length, 'Paid token must carry original anchored verifier proofs')
  const approveExecution = createKeeperExecutionApprover({client: writer.pub, deployment, payment, expected, certificate, signer,
    keeperUrl: settings.keeperUrl, transportPolicy: {allowLocalHttp: true}})
  return {compound_token: grant.token, verifierProofs: grant.verifierProofs,
    verifier_proofs: grant.verifierProofs.map(p => ({verifier_index: p.verifierIndex, operator: p.operator, pubkey: p.pubkey, proof: p.proof})),
    approveExecution, coordinatorUrl: settings.keeperUrl(context.coordinator.url), payment, originalRequestId: prepaidRequestId(payment),
    dispose: () => signer.dispose()}
  } catch (error) { signer.dispose(); throw error }
  finally { seed.fill(0) }
}
