import {addressBookFromObject, createTasraChainClient} from 'tasra-sdk/chain'

// Public configuration of the local development fleet; update after a redeploy.
const chain = createTasraChainClient({
  rpcUrl: 'http://127.0.0.1:9650/ext/bc/C/rpc',
  chainId: 43112,
  addresses: addressBookFromObject({
    NodeRegistry: '0xEA7A0602b6DB6Aa767C5649b4d5083c426Cb8083',
    KeyRegistry: '0x94c75679D75bfdc310669c0De4dE4398E922232b',
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
