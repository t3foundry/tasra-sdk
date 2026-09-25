import {
  NETWORKS, parsePinnedNetworkManifest, addressBookFromManifest,
  createTasraChainClient,
} from 'tasra-sdk/chain'

// Keep the pointer and manifest at the same reviewed tasra-releases commit.
const revision = '3b34d86432c4577eef5d8a10e14eda272f87769b'
const base = `https://raw.githubusercontent.com/t3-foundry/tasra-releases/${revision}/networks/testnet/`
async function download(path: string): Promise<string> {
  const response = await fetch(`${base}${path}`, {signal: AbortSignal.timeout(15_000)})
  if (!response.ok) throw new Error(`Download ${path}: HTTP ${response.status}`)
  return response.text()
}

const pointer = JSON.parse(await download('current.json')) as {
  schemaVersion: number; network: string; chainId: number; status: string
  manifest: string; sha256: string
}
if (pointer.schemaVersion !== 1 || pointer.network !== 'testnet' ||
    pointer.chainId !== 43113 || pointer.status !== 'active' ||
    typeof pointer.manifest !== 'string' || !/^deployments\/[a-z0-9.-]+\.json$/.test(pointer.manifest)) {
  throw new Error('Expected an active Fuji deployment pointer')
}
const manifest = parsePinnedNetworkManifest(await download(pointer.manifest), pointer.sha256)
if (manifest.network !== 'testnet' || manifest.chainId !== 43113) {
  throw new Error('Expected a Fuji manifest')
}
const addresses = addressBookFromManifest(manifest)
const chain = createTasraChainClient({
  rpcUrl: NETWORKS.testnet.rpcUrl, chainId: manifest.chainId, addresses,
})
if (await chain.client.getChainId() !== manifest.chainId) {
  throw new Error('RPC chain does not match the manifest')
}
const block = await chain.client.getBlockNumber()
const commitReveal = await chain.readers.keyRegistry.requiresCommitReveal()
console.log(`Connected to Fuji (${manifest.chainId})`)
console.log(`Deployment: ${manifest.deploymentId}`)
console.log(`Block: ${block}`)
console.log(`KeyRegistry: ${addresses.KeyRegistry}`)
console.log(`Slot creation: ${commitReveal ? 'commit/reveal' : 'direct'}`)
