import {addressFromEoaPubkey, hexToBytes} from 'tasra-sdk'
import {addressBookFromObject, createTasraChainClient} from 'tasra-sdk/chain'

// The same public local-fleet configuration used in the quickstart.
const chain = createTasraChainClient({
  rpcUrl: 'http://127.0.0.1:9650/ext/bc/C/rpc',
  chainId: 43112,
  addresses: addressBookFromObject({
    KeyRegistry: '0x352F406036a061E0432394a88006158a8B588311',
  }),
})
const slotId = process.argv[2]
if (!slotId || !/^0x[0-9a-fA-F]{64}$/.test(slotId)) {
  throw new Error('Usage: npx tsx address.ts <0x-prefixed slot ID>')
}
if (await chain.client.getChainId() !== 43112) throw new Error('Expected local chain 43112')
const slot = await chain.readers.keyRegistry.getKeySlot(slotId as `0x${string}`)
if (!slot.exists || slot.cancelled) throw new Error('Slot is missing or cancelled')
if (slot.mode !== 2) throw new Error('Ethereum addresses require a secp256k1 tECDSA slot (mode 2)')
if (slot.publicKey === '0x') throw new Error('Slot key generation is not complete')
console.log(addressFromEoaPubkey(hexToBytes(slot.publicKey)))
