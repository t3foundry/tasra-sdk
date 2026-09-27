import { createTasra, defineDeployment } from 'tasra-sdk/app'
import { createTasraChainClient } from 'tasra-sdk/chain'
import { defineChain } from 'viem'

// Public configuration only. Replace from a reviewed deployment after fleet redeployment.
export const deployment = defineDeployment({
  schemaVersion: 1,
  name: 'Local Tasra',
  chainId: 43112,
  rpcUrl: 'http://127.0.0.1:9650/ext/bc/C/rpc',
  coordinator: 'lowest-operator-id',
  addresses: {
    KeyRegistry: '0x94c75679D75bfdc310669c0De4dE4398E922232b',
    NodeRegistry: '0xEA7A0602b6DB6Aa767C5649b4d5083c426Cb8083',
  },
})
export const verifierAgentUrl = 'https://localhost:19444'
export const evm = defineChain({
  id: deployment.chainId,
  name: deployment.name,
  nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
  rpcUrls: { default: { http: [deployment.rpcUrl] } },
})
export const chain = createTasraChainClient(deployment)
export function reachable(url: string) {
  const u = new URL(url),
    match = /^keykeeper-node-([1-5])$/.exec(u.hostname)
  if (match && u.port === '8080') {
    u.hostname = '127.0.0.1'
    u.port = String(8090 + Number(match[1]))
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname))
    throw new Error('This tutorial requires local keepers')
  return u.toString().replace(/\/$/, '')
}
export const tasra = createTasra({ deployment, chain, keeperUrl: reachable })
