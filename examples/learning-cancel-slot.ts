import {createTasraWriteClient} from 'tasra-sdk/chain'
import {savedCreator, savedSlotId, tasra} from './learning-context.js'

if (!process.argv.includes('--confirm-cancel')) throw new Error('Cancellation is final. Add --confirm-cancel only when finished with this slot.')
const slotId = await savedSlotId()
const creator = await savedCreator()
const lifecycle = createTasraWriteClient({...tasra.deployment, wallet: creator.wallet})
console.log('Confirmed transaction:', await lifecycle.cancelSlot(slotId))
// Cancelled slots remain visible in the registry's historical record.
const record = await tasra.chain.readers.keyRegistry.getKeySlot(slotId)
console.log('Cancelled:', record.cancelled)
