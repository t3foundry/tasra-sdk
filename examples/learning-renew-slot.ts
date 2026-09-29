import {createTasraWriteClient} from 'tasra-sdk/chain'
import {savedCreator, savedSlotId, tasra} from './learning-context.js'

const slotId = await savedSlotId()
const creator = await savedCreator()
const lifecycle = createTasraWriteClient({...tasra.deployment, wallet: creator.wallet})
const before = await tasra.chain.readers.keyRegistry.getKeySlot(slotId)
const transaction = await lifecycle.renewSlot(slotId)
const after = await tasra.chain.readers.keyRegistry.getKeySlot(slotId)
console.log('Confirmed transaction:', transaction)
console.log('Previous lease expiry:', before.expiry)
console.log('Current lease expiry:', after.expiry)
