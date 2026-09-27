/** Application API. Requires the optional viem peer; safe to import in browsers. */
export {createTasra, TasraApplicationError} from './client.js'
export type {TasraApplication, TasraApplicationConfig, ApplicationErrorCode, SlotMetadata, OperationGrant,
  AuthorizationRequest, OperationAuthorizer, AuthorizedOperationOptions, EcdsaSlot, FrostSlot, BlsSlot} from './client.js'
export {defineDeployment} from './deployment.js'
export type {TasraDeployment} from './deployment.js'
export {toViemAccount} from './viem.js'
export {registeredWalletAuthorization} from './authorization.js'
export {prepareSlot, createPreparedSlot, CreationReconciliationRequiredError} from './creation.js'
export type {SlotCreationJournal} from './creation.js'
