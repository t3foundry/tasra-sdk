// A local fleet wallet uses the SDK's paid protocol directly, including original
// client consent. No CLI, shell helper or service-selected signing body is used.
import assert from 'node:assert/strict'
import {constants, readSync, openSync, fstatSync, closeSync} from 'node:fs'
import {createWalletClient, http, type Address, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {createFileStore} from '../../src/app/node.ts'
import {paidOperation} from '../../src/app/paid-operation.ts'
import {createTasraChainClient} from '../../src/chain/client.ts'
import {createTasraWriteClient} from '../../src/chain/write.ts'
import {parseApplicationServiceProfiles} from '../../src/chain/serviceProfiles.ts'
import {createNodeAgentWalletFetch, createNodePaidAgentTransport} from '../../src/chain/node.ts'
import {discoverPaidOperationContext, type PaidContextDeployment} from '../../src/chain/prepaid.ts'
import {buildResponse, parseSdJwt, planPresentation, sdJwtCredentialView, submitResponse, type HolderKey, type OperationInput} from '../../src/oid4vp/index.ts'
import type {FleetConfig} from './_fleet.ts'
import {localPrepaidSettings} from './_prepaid-funding.ts'
import {fixturePaymentTtlSeconds} from './_certification-timing.ts'
import type {VerifiedRequestObject} from '../../src/oid4vp/request-object.ts'

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
    keeperUrls: [...map.values()],
    keeperUrl: (registered: string) => map.get(registered.replace(/\/$/, '')) ?? registered}
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
  wallet: {holder: HolderKey; sdJwt: string}, forcePresentation: boolean, coordinator?: Address,
  observeRequest?: (request: VerifiedRequestObject, fetcher: typeof fetch) => void | Promise<void>) {
  input = structuredClone(input)
  wallet = structuredClone(wallet)
  const settings = paidWalletSettings(cfg), creator = privateKeyToAccount(creatorKey)
  assert(cfg.book.Settlement && cfg.book.KeyRegistry && cfg.book.VerifierSetRegistry && cfg.book.AccountantSetRegistry && cfg.book.ThresholdRandomBeacon,
    'Paid wallet requires independently configured settlement and anchored role registries')
  const deployment: PaidContextDeployment = {chainId: 43112, settlement: cfg.book.Settlement, keyRegistry: cfg.book.KeyRegistry,
    verifierSet: cfg.book.VerifierSetRegistry, accountantSet: cfg.book.AccountantSetRegistry, beacon: cfg.book.ThresholdRandomBeacon}
  const store = createFileStore(settings.directory)
  const funding = await store.load<{phase: string; creator: Address; rule: string; ruleSalt: Hex}>(`funding-43112-${slot.slice(2)}`)
  assert(funding?.phase === 'confirmed' && funding.creator.toLowerCase() === creator.address.toLowerCase(),
    'Paid wallet requires the original confirmed funding, rule, salt and sovereign creator')
  const writer = createTasraWriteClient({rpcUrl: cfg.rpcUrl, addresses: cfg.book, privateKey: creatorKey, chainId: 43112})
  const chain = createTasraChainClient({rpcUrl: cfg.rpcUrl, addresses: cfg.book, chainId: 43112, multicall3: false})
  const snapshotWaitSecs = Number(cfg.raw.KK_SNAPSHOT_WAIT_SECS ?? '180')
  assert(Number.isSafeInteger(snapshotWaitSecs) && snapshotWaitSecs > 0 && snapshotWaitSecs <= 300, 'Snapshot readiness wait must be bounded')
  const ttlSecs = fixturePaymentTtlSeconds(cfg, input.ttlSecs)
  assert(Number.isSafeInteger(ttlSecs) && ttlSecs > 0 && ttlSecs <= 3600, 'Original payment expiry must be bounded')
  // Each slot's creator is its dedicated reservation gas payer. The store refuses
  // an unresolved nonce instead of silently retrying/replacing the transaction.
  const gasWallet = createWalletClient({account: creator, chain: writer.wallet.chain,
    transport: http(cfg.rpcUrl, {retryCount: 0, timeout: 15_000, fetchOptions: {redirect: 'error'}})})
  // The SDK verified the request object's response URI against the session it derived.
  const fetcherFor = (request: VerifiedRequestObject) => {
    const sessionId = new URL(String(request.claims.response_uri)).searchParams.get('session') ?? ''
    return createNodeAgentWalletFetch({profile: settings.profile, requestUri: settings.profile.endpoint + '/v1/request/' + sessionId, sessionId}, settings.transportPolicy)
  }
  const operation = await paidOperation({chain, deployment: {...deployment, defaultVerificationPolicy: settings.defaultVerificationPolicy},
    creator, gasPayer: gasWallet, store, agent: {profile: settings.profile, transport: createNodePaidAgentTransport(settings.transportPolicy)},
    accountantUrls: settings.accountantUrls, limits: {maxCost: settings.maxCost, maxGas: settings.maxGas, maxGasPrice: settings.maxGasPrice},
    allowLocalHttp: true, keeperUrl: settings.keeperUrl, snapshotWaitMs: snapshotWaitSecs * 1000}, {
    slot, operation: {...input, ttlSecs, description: 'Local test operation'}, rule: {rule: funding.rule, salt: funding.ruleSalt}, coordinator,
    signal: AbortSignal.timeout(Math.min(150_000, ttlSecs * 1000) + snapshotWaitSecs * 1000),
    observeRequest: request => observeRequest?.(request, fetcherFor(request)),
    holder: {kind: 'local', makePresentation: request => {
      const plan = planPresentation(request, [{sdJwt: wallet.sdJwt}]), parsed = parseSdJwt(wallet.sdJwt)
      const candidate = forcePresentation ? {held: {sdJwt: wallet.sdJwt}, parsed, view: sdJwtCredentialView(parsed), queryId: request.claims.dcql_query.credentials[0]!.id} : plan.chosen
      assert(candidate, 'Held credential does not answer the original client-approved request')
      const iat = Math.floor(Date.now() / 1000), built = buildResponse({ro: request, candidate, holder: wallet.holder, disclose: 'all', nowSecs: iat})
      assert(built.encrypted && built.form.response, 'Original SDK presentation must be encrypted')
      const holder = typeof parsed.payload.sub === 'string' ? parsed.payload.sub : wallet.holder.did
      return {approved: {holder, credentials: [built.presentation], holder_proof: null, oauth: null, iat}, form: built.form}
    }, submit: (request, presentation) => submitResponse(request, presentation, fetcherFor(request)).then(() => {})},
  })
  // ADR-0076: a sealed committee returns the evidence ciphertext BESIDE the token; a keeper
  // refuses an evidenced token without it, and refuses it beside an un-evidenced one.
  const evidence = operation.evidenceCt !== undefined ? {evidenceCt: operation.evidenceCt, evidence_ct: operation.evidenceCt} : {}
  return {compound_token: operation.compound_token, verifierProofs: operation.verifierProofs, verifier_proofs: operation.verifier_proofs,
    ...evidence, approveExecution: operation.approveExecution, coordinatorUrl: operation.coordinatorUrl, payment: operation.payment,
    originalRequestId: operation.requestId, operation, dispose: () => operation.dispose()}
}
