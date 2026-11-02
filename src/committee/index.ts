// compound committee authorization - token crypto + HTTP orchestration.
export {auditOperationId, decodeOperationReceipt, verifyOperationReceipt} from './receipts.js'
export {discoverBlsSharing} from './blsSharing.js'
export type {BlsSharing, BlsSharingOptions, BlsSharingKeeper} from './blsSharing.js'
export type {OperationReceipt, ReceiptExpectation} from './receipts.js'
export {extractIdentityStrict, decryptIdentityStrict} from './extraction.js'
export type {StrictExtractionOptions, StrictExtractionResult, ExtractionKeeper, ExtractionEvidence} from './extraction.js'
export {createDualSignClient, dualSignApprovalPayload, paidDualSignApprovalPayload, OperationOutcomeUnknownError} from './dual-sign.js'
export type {DualSignConfig, DualSignApprover, DualSignRequest, DualSignStatus} from './dual-sign.js'
export {committeeSignEoaDigest} from './ecdsa.js'
export type {CommitteeEoaSignOpts} from './ecdsa.js'
export {
  selectVerifierCommittee,
  compoundTokenCanonicalBytes,
  compoundTokenHash,
  opAttestationHash,
  clientBindingHash,
  verifierLeaf,
  verifyMerkleProof,
  merkleRoot,
  merkleProof,
  verifyCompoundToken,
  assembleCompoundToken,
  decodeCompoundToken,
  statusAttestationHash,
  verifyStatusAttestation,
  verifyStatusAttestations,
  requireStatusAttestations,
  signersThatVerify,
  assertStatusAttestationsWire,
  STATUS_ATTESTATION_DOMAIN,
  REVOCATION_BOUND_SECS,
  STATUS_SKEW_SECS,
  STATUS_CACHE_BOUND_SECS,
  MAX_STATUS_WINDOW_SECS,
  DEFAULT_STATUS_WINDOW_SECS,
  MAX_STATUS_ATTESTATIONS,
  STATUS_STALE_CODE,
  STATUS_MISSING_CODE,
  STATUS_INVALID_CODE,
  evidenceBindingMessage,
  verifyEvidenceBinding,
} from './token.js'
export type {
  TokenType,
  CompoundTokenPayload,
  CommitteeSignature,
  VerifierSet,
  VerifiedToken,
  VerifyCompoundTokenOptions,
  CompoundTokenWire,
  CommitteeSignatureWire,
  StatusAttestation,
  StatusAttestationWire,
  VerifyStatusAttestationsOptions,
  RequireStatusAttestationsOptions,
  StatusFreshness,
  VerifyEvidenceBindingOptions,
} from './token.js'
export {
  statusRefreshHash,
  statusRefreshHolderSigner,
  createStatusRefreshProof,
  statusRefreshRequestBody,
  statusRefreshRelayBody,
  parseStatusRefreshReply,
  classifyStatusRefreshResponse,
  refreshStatusDirect,
  refreshStatusViaAgent,
  acceptStatusRefreshRelay,
  withdrawsOriginal,
  STATUS_REFRESH_DOMAIN,
  STATUS_REFRESH_JWT_TYP,
  STATUS_REFRESH_PATH,
  MAX_STATUS_REFRESH_BODY_BYTES,
  STATUS_REFRESH_FRESHNESS_SECS,
} from './status-refresh.js'
export type {
  StatusRefreshPrincipal,
  StatusRefreshHashInput,
  StatusRefreshHolderSigner,
  StatusRefreshProver,
  StatusRefreshProofWire,
  CreateStatusRefreshProofOptions,
  StatusRefreshReplyWire,
  StatusRefreshGrant,
  StatusRefreshResult,
  StatusRefreshHttpResponse,
  RefreshStatusDirectOptions,
  RefreshStatusViaAgentOptions,
} from './status-refresh.js'
export {
  committeeAuthorize,
  gatherCommitteeToken,
  committeeSign,
  committeeDecrypt,
  CommitteeAuthorizeError,
} from './client.js'
export type {
  CommitteeAuthorizeBody,
  CommitteeAuthorizeReply,
  GatherCommitteeTokenOpts,
  CommitteeSignOpts,
  CommitteeDecryptOpts,
  VerifierProof,
} from './client.js'
export {
  requestCommitteeToken,
  committeeSignRequest,
  committeeDecryptRequest,
  buildVerifierProofs,
  committeeChainReadsFromClient,
  holderProofPerVerifier,
} from './request.js'
export type {
  CommitteeVerifier,
  CommitteeChainReads,
  HolderProofPerVerifier,
  RequestCommitteeTokenOpts,
  CommitteeTokenResult,
  CommitteeSignRequestOpts,
  CommitteeDecryptRequestOpts,
} from './request.js'


// identity-key extraction
export {requestIbeExtractionPartials} from './client.js'
export type {IbeExtractOpts, IbeExtractionPartial} from './client.js'
export {ibeExtractRequest, ibeDecryptRequest} from './request.js'
export type {IbeExtractRequestOpts} from './request.js'

// derived OAuth audience + DPoP htu
export {
  platformAudience,
  dpopHtu,
  legacyDpopHtu,
  normalizeOrigin,
  isValidSessionId,
  OAUTH_RESPONSE_PATH,
  OAUTH_RESPONSE_PATH_PREFIX,
  OAUTH_RESPONSE_PATH_SUFFIX,
  MAX_SESSION_ID_LEN,
} from './oauth.js'

export {keeperAssignmentCommitment, paymentIntentTypedData, paymentIntentHash, prepaidRequestId, paymentSessionCommitment, assertPaymentIntentWire} from './payment.js'
export type {PaidKeeperAssignment, PaymentIntentWire} from './payment.js'
export {EXECUTION_CERTIFICATE_DOMAIN, EXECUTION_APPROVAL_DOMAIN, EXECUTION_INITIALIZATION_DOMAIN, MAX_EXECUTION_BODY_BYTES,
  executionCertificateTypedData, executionApprovalTypedData, executionInitializationTypedData, initializeExecutionSession, verifySessionInitialization, executionBodyHash,
  createExecutionCertificate, approveExecutionRequest, verifyExecutionAuthorization, executionConsentBinding, verifyExecutionConsent, createLocalExecutionSigner} from './execution.js'
export type {ExecutionStage, ExecutionCertificate, ExecutionAuthorization, ExecutionConsent, ExecutionConsentPolicy,
  ExpectedExecution, ExecutionProposal, SessionInitialization, ExpectedInitialization, ClientExecutionSigner, LocalExecutionSigner, ExecutionCreatorSigner} from './execution.js'
export {paidExecutionRequest, paidExecutionReportSigningHash, verifyPaidExecutionEvidence, executionRecoverySigningHash,
  createExecutionRecoveryAuthorization, verifyRecoveredExecutionResult} from './recovery.js'
export type {PaidExecutionRequest, CompletedPaidExecutionReport, SignedPaidExecutionReport, ExecutionRecoveryAuthorization,
  ExecutionRecoveryTarget, RecoveredExecutionReply} from './recovery.js'
export type {KeeperExecutionKind,KeeperExecutionApprovalRequest,KeeperExecutionApprovals,KeeperExecutionApprover} from './keeperExecution.js'
export type {EvidenceBindingWire} from './evidence.js'

export {createDecryptionRecipient, decryptionBinding, kemContentDigest, recipientPayloadDigest} from '../crypto/recipient.js'
export type {ClientRecipient, RecipientWire, DecryptionBindingWire, SealedShareWire} from '../crypto/recipient.js'
export {collectSealedPartials, decryptWithCommitteePartials} from '../decryption/sealed.js'
export type {SealedRequestOpts, SealedPartial} from '../decryption/sealed.js'
