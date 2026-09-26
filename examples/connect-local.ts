import {addressBookFromObject, createTasraChainClient} from 'tasra-sdk/chain'

// Public configuration of the local development fleet; update after a redeploy.
const chain = createTasraChainClient({
  rpcUrl: 'http://127.0.0.1:9650/ext/bc/C/rpc',
  chainId: 43112,
  addresses: addressBookFromObject({
    NodeRegistry: '0xeaFe7F6105332aFE53Ac2F7dE0742f47f061a693',
    KeyRegistry: '0x352F406036a061E0432394a88006158a8B588311',
  }),
})

if (await chain.client.getChainId() !== 43112) throw new Error('Expected local chain 43112')
const block = await chain.client.getBlockNumber()
const operators = await chain.readers.nodeRegistry.activeCount()
const commitReveal = await chain.readers.keyRegistry.requiresCommitReveal()
console.log('Connected to local Tasra (43112)')
console.log(`Block: ${block}`)
console.log(`Active operators: ${operators}`)
console.log(`Slot creation: ${commitReveal ? 'commit/reveal' : 'direct'}`)
