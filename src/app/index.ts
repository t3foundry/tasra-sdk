/** Application API. safe to import in browsers. */
export {createTasra, TasraApplicationError} from './client.js'
export type {TasraApplication, TasraApplicationConfig, ApplicationErrorCode, SlotMetadata, OperationGrant,
  AuthorizationRequest, OperationAuthorizer, AuthorizedOperationOptions, EcdsaSignOptions, IdentityExtractionOptions, EcdsaSlot, FrostSlot, BlsSlot} from './client.js'
export {defineDeployment} from './deployment.js'
export type {TasraDeployment} from './deployment.js'
export {toViemAccount} from './viem.js'
export {registeredWalletAuthorization} from './authorization.js'
export {prepareSlot, createPreparedSlot, CreationReconciliationRequiredError} from './creation.js'
export type {SlotCreationJournal} from './creation.js'

export {TasraClient} from './tasra-client.js'
export type {TasraClientOptions, CreateSlotOptions} from './tasra-client.js'
export {resolveApplicationManifest, loadApplicationManifest} from './manifest.js'
export type {ApplicationManifest, ResolveApplicationManifestOptions, LoadApplicationManifestOptions} from './manifest.js'
export {createApplicationSlot, ApplicationSlotRecoveryError} from './ready-slot.js'
export type {ApplicationStore, CreateApplicationSlot, CreateApplicationSlotOptions, ReadySlotJournal, ApplicationSlotRecoveryCode, SlotCreationProgress} from './ready-slot.js'
export {createLocalWallet, connectWallet, createSlotWallet} from './wallet.js'
export {createIdentity, issueCredential, verifyCredential, credentialPolicy, credentialAuthorization, presentCredentials} from './identity.js'
export type {TasraWallet, WalletTransactionInput, WalletTransactionJournal} from './wallet.js'
export type {TasraIdentity, IssueCredentialOptions, VerifyCredentialOptions, CredentialPolicyOptions, PresentCredentialsOptions, CredentialAuthorizationOptions} from './identity.js'
export type {ApplicationDeployment, ResolvedApplicationManifest} from './manifest.js'
export {setApprovalPolicy, readApprovalPolicy, prepareOperationApproval, assembleOperationApproval, identityApprover, approveWithCredential} from './approvals.js'
export type {ApprovalPolicy, InstalledApprovalPolicy, ApprovalPolicyAlreadyInstalled} from './approvals.js'
export {lockKeyRotation} from './rotation-lock.js'
export type {RotationAlreadyLocked} from './rotation-lock.js'
// Operation approval builders (the statement each approver signs and the bundle), re-exported beside the app helpers.
export {approveDualOperation, requireDualOperationProof} from '../committee/dual-operation.js'
export type {DualOperationApprovalRecord, DualOperationApprover, DualOperationProof, PreparedDualOperation, DualOperationKind} from '../committee/dual-operation.js'
export {createPaidReservationJournal, loadPaidReservationJournal} from './paid-journal.js'
export type {PaidReservationJournal, PaidReservationSession, ApplicationReservationJournal} from './paid-journal.js'
export {reserveApplicationPayment, reconcileApplicationPayment, reconcileApplicationReservation, selectApplicationGasPayer, ApplicationPayerRecoveryError} from './paid-reservation.js'
export type {ApplicationReservationOptions, ApplicationReservationState, ApplicationReservationStatus, ReconcileApplicationReservationOptions,
  SelectApplicationGasPayerOptions} from './paid-reservation.js'
// ADR-0090 allowance lanes (PaidOperationConfig.allowances, default off).
export {AllowanceRefusedError, AllowanceUnavailableError, AllowanceCapacityError, inspectAllowanceLanes, journaledAllowanceVoucher, allowanceLaneCount} from './paid-allowance.js'
export type {PaidAllowanceOptions} from './paid-allowance.js'
export {paidOperation, prepareAllowances, paidFinalSign, resumePaidFinalSign, paidSessionDecrypt, resumePaidSessionDecrypt, resumePaidOperation, reconcilePaidOperation, recoverPaidOperation, abandonPaidOperation, paidOperationPhase, listPaidOperations,
  PaidOperationRecoveryError, PaidOperationAbandonRefusedError, NewerVerifierEpoch} from './paid-operation.js'
export type {PaidOperation, PaidOperationConfig, PaidOperationRequest, PrepareAllowancesRequest, PreparedAllowances, PreparedAllowanceLane, PreparedAllowanceOutcome, PaidFinalSign, PaidFinalSignRequest, PaidSessionDecrypt, PaidSessionDecryptRequest, PaidOperationPhase, PaidOperationJournalPhase, PaidOperationStatus,
  PaidOperationNextStep, ResumePaidOperationOptions, PaidOperationErrorCode, PaidOperationSummary, ListPaidOperationsOptions,
  RecoverIbePartialsOptions, RecoveredIbePartial, RecoveredIbePartials, PaidOperationRecovery, AbandonPaidOperationOptions, AbandonedPaidOperation,
  RefreshPaidStatusOptions, PaidStatusRefresh} from './paid-operation.js'
export {drivePaidSession, waitForPaidSnapshot, PaidSessionRecoveryError} from './paid-session.js'
export type {PaidSessionDriverOptions, PaidSessionHolder, PaidWalletPresentation, PaidSessionRequestLink, PaidOAuthContext, PaidOAuthCredential} from './paid-session.js'
export {createMemoryStore} from './memory-store.js'
export {createSessionKey, sessionGrantCreateFragment, acceptSessionGrant, loadGrantedSession, GrantedSession, SessionEndedError, SessionRefreshError, SESSION_REFUSAL_CODES, SESSION_RETRYABLE_CODES, SESSION_VERIFIER_BEHIND_RETRY_MS, SessionRevokeIncompleteError, SessionRevokeUnconfirmedError} from './session-grants.js'
export {decryptInSession, SessionMessageError, MAX_MESSAGE_DEBITS} from './session-decrypt.js'
export type {SessionMessageRequest, SessionMessageResult, SessionReopened} from './session-decrypt.js'
export type {SessionKeyHandle, SessionGrantParams, SessionGrantCreateFragment, SlotTrust, SessionTransport, GrantedSessionOptions} from './session-grants.js'
