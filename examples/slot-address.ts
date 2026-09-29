import {loadNetwork} from './network.js'
import {TasraClient} from 'tasra-sdk/app'

// Read the checksum-verified manifest downloaded from tasra-releases.
const network = loadNetwork()
const tasra = new TasraClient({manifest: network.deployment, verifierAgentUrl: network.verifierAgentUrl})
const slotId = process.argv[2]
if (!slotId || !/^0x[0-9a-fA-F]{64}$/.test(slotId)) {
  throw new Error('Usage: npx tsx address.ts <0x-prefixed slot ID>')
}
if (!(await tasra.check()).ready) throw new Error('Configured registries are unavailable')
const slot = await tasra.slots.ecdsa(slotId as `0x${string}`)
console.log(await slot.getAddress())
