// A provisioned, non-exportable BLS slot and an issuer credential are prerequisites.
// No operator/admin credentials are used in this application example.
import {fromBytes} from 'tasra-sdk'
import {committeeClient, sealedDecryptOptions, loadHolder, loadNetwork, slotId} from './live-config.ts'

const network = await loadNetwork()
const slot = slotId()
const identity = loadHolder()
try {
  const client = committeeClient(network.chain, slot, identity, 'decrypt')
  // UTF-8 AAD is required by the threshold HTTP protocol.
  const envelope = fromBytes(await client.encrypt(slot, new TextEncoder().encode('Hello Tasra'), {
    identity: new TextEncoder().encode(slot),
  }))
  const plaintext = await client.decrypt(slot, await sealedDecryptOptions(network.chain, slot, envelope))
  if (new TextDecoder().decode(plaintext) !== 'Hello Tasra') throw new Error('Threshold round trip failed')
  console.log('Threshold decrypt succeeded; the master key was not exported.')
} finally {
  identity.secretKey.fill(0)
}
