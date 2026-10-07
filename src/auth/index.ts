// Verifier auth (the DCQL-gated JWT lifecycle) + the DCQL policy grammar that gates it.
export {
  redeemRenewalToken,
  createRenewal,
  revokeRenewal,
  redeemCredential,
  issueAdminCredential,
  revokeSlotUser,
  verifyPresentation,
  verifyVpJwt,
  decodeJwtClaims,
  jwtExpMs,
  isJwtExpiringSoon,
} from './verifier.js'
export type {RenewalGrant, IssuedToken, JwtClaims, RedemptionGrant} from './verifier.js'
// F1/F4 holder proof-of-possession.
export {
  credentialsCommitment,
  fetchHolderNonce,
  buildHolderProof,
  createHolderProof,
  ed25519DidKey,
} from './holderProof.js'
export type {HolderSigner, HolderNonce, BuildHolderProofOpts} from './holderProof.js'

// OID4VP-DCQL - the ONLY rule language
export {
  validate,
  evaluate,
  evaluateIdentityScoped,
  select,
  canonicalize,
  isOid4vpRule,
  jsonCredential,
  FORMAT_JWT_VC_JSON,
  FORMAT_DC_SD_JWT,
  FORMAT_OAUTH_AT_DPOP,
  ACCEPTED_FORMATS,
  isOauthFormat,
  resolvePath,
  DcqlMalformedError,
  MAX_RULE_LEN,
  MAX_AGE_SECS_MIN,
  MAX_AGE_SECS_MAX,
} from './oid4vp.js'
export type {
  Query,
  CredentialQuery,
  CredentialSetQuery,
  ClaimQuery,
  ClaimPathSegment,
  Meta,
  ScopeNamespace,
  CredentialView,
  ClaimResult,
  Selection,
} from './oid4vp.js'

// DPoP (RFC 9449)
export {
  createDpopKey,
  auth0DpopSigner,
  jwkThumbprint,
  accessTokenHash,
  isHeaderSafeNonce,
} from './dpop.js'
export type {DpopSigner, DpopKey} from './dpop.js'

// identity-scope matcher
export {scopeCovers, MAX_IDENTITY_LEN} from './identityScope.js'

// OAuth policy envelopes (`kk_oauth`, ADR-0078): Rego over an organization's own access token.
// The grammar test is pure; pack/unpack/lint/evaluate run the network's engine (WebAssembly).
export {
  isOauthEnvelope,
  loadRego,
  packEnvelope,
  unpackEnvelope,
  lintEnvelope,
  evaluateEnvelope,
  RegoEnvelopeError,
  OAUTH_ENVELOPE_KEY,
  DEFAULT_REGO_ENTRYPOINT,
  REGO_POLICY_REFUSED,
  REGO_WASM_SHA256,
} from './rego.js'
export type {
  OauthTokenSpec,
  OauthTokens,
  OauthPolicyInput,
  UnpackedEnvelope,
  EnvelopeGateReport,
  EnvelopeLint,
  OauthPresentation,
  EnvelopeVerdict,
  RegoEngine,
  LoadRegoOptions,
} from './rego.js'
