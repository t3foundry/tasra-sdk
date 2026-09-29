// TasraClient - configure connection params once (nodes + verifier +
// identity), then open managed Sessions per slot. The few-lines integration
// surface; product-agnostic (no transport/roster/messaging).

import {
  redeemRenewalToken,
  redeemCredential,
  verifyVpJwt,
  decodeJwtClaims,
} from '../auth/verifier.js'
import {createHolderProof, type HolderSigner} from '../auth/holderProof.js'
import {fetchMpk} from '../keys/node-client.js'
import {hexToBytes} from '../crypto/hex.js'
import {newSession, type Session} from './session.js'

/**
 * Connection parameters for {@link createTasraClient}. Set once and reused by
 * every session the client opens.
 *
 * `verifier` and `identity` are optional in the type because `{jwt}` auth needs
 * neither, but each is enforced at `openSession` time for the modes that do.
 */
export interface TasraClientConfig {
  /** k-of-n keykeeper-node base URLs. */
  nodes: readonly string[]
  /** Verifier base URL - required for renewalToken / redemptionToken / vpJwt auth. */
  verifier?: string
  /** This holder's DID - recipient_did / holder for credential & vp-jwt auth. */
  identity?: string
}

/**
 * Holder proof-of-possession options (F1/F4). The SDK fetches a `/v1/nonce` and
 * signs a holder proof with `signer` (the holder DID's authentication key), bound
 * to `audience` (the verifier's token `iss`) and the presented credentials.
 */
export interface HolderProofAuth {
  /** Holder DID authentication key or signing callback. */
  signer: HolderSigner
  /** The verifier's expected audience (its token `iss`). */
  audience: string
  /** Optionally scope the proof to a slot / action (must match the slot being opened). */
  slotId?: string
  /** Optional action bound into the nonce and holder proof. */
  action?: string
  /** Holder-proof lifetime in seconds. */
  ttlSecs?: number
}

/** The `vpJwt` auth mode's payload: signed VCs + a holder-key proof to JWT. */
export interface VpJwtAuth {
  /** DCQL policy JSON to evaluate. */
  dcqlRule: string
  /** Compact signed credentials presented to the verifier. */
  credentials: string[]
  /** Holder-key possession proof settings. */
  holderProof: HolderProofAuth
}

/** Choose exactly one JWT authorization mode. Renewal tokens support automatic refresh; other modes require a new session after expiry. */
export type SessionAuth =
  | {
      /** Caller-supplied bearer JWT; omit when another authorization mode is selected. */
      jwt: string
      /** Renewal token for obtaining and refreshing bearer JWTs; omit when another mode is selected. */
      renewalToken?: undefined
      /** Single-use token exchanged for a bearer JWT; omit when another mode is selected. */
      redemptionToken?: undefined
      /** Credential presentation and holder proof for obtaining a bearer JWT; omit when another mode is selected. */
      vpJwt?: undefined
    }
  | {
      /** Renewal token for obtaining and refreshing bearer JWTs; omit when another mode is selected. */
      renewalToken: string
      /** Caller-supplied bearer JWT; omit when another authorization mode is selected. */
      jwt?: undefined
      /** Single-use token exchanged for a bearer JWT; omit when another mode is selected. */
      redemptionToken?: undefined
      /** Credential presentation and holder proof for obtaining a bearer JWT; omit when another mode is selected. */
      vpJwt?: undefined
    }
  | {
      /** Single-use token exchanged for a bearer JWT; omit when another mode is selected. */
      redemptionToken: string
      /** Caller-supplied bearer JWT; omit when another authorization mode is selected. */
      jwt?: undefined
      /** Renewal token for obtaining and refreshing bearer JWTs; omit when another mode is selected. */
      renewalToken?: undefined
      /** Credential presentation and holder proof for obtaining a bearer JWT; omit when another mode is selected. */
      vpJwt?: undefined
    }
  | {
      /** Credential presentation and holder proof for obtaining a bearer JWT; omit when another mode is selected. */
      vpJwt: VpJwtAuth
      /** Caller-supplied bearer JWT; omit when another authorization mode is selected. */
      jwt?: undefined
      /** Renewal token for obtaining and refreshing bearer JWTs; omit when another mode is selected. */
      renewalToken?: undefined
      /** Single-use token exchanged for a bearer JWT; omit when another mode is selected. */
      redemptionToken?: undefined
    }

/** Associated data and token refresh skew for a managed slot session. */
export interface OpenSessionOpts {
  /** AAD for envelopes this session encrypts. Default = the 32-byte slot id. */
  identity?: Uint8Array
  /** JWT refresh skew (ms) for isJwtExpiringSoon. Default 30_000. */
  skewMs?: number
}

/**
 * A configured client. Holds no key material itself - each {@link Session} it
 * opens owns its own JWT and (lazily) assembled master key.
 */
export interface TasraClient {
  /** Read-only snapshot of connection settings supplied when the client was created. */
  readonly config: Readonly<TasraClientConfig>
  /** Obtain a JWT (per `auth`), assemble the slot key, and return a managed Session. */
  openSession(
    slotId: string,
    auth: SessionAuth,
    opts?: OpenSessionOpts,
  ): Promise<Session>
  /** Currently-open sessions (live references). */
  sessions(): readonly Session[]
  /** Zeroize + close every open session. */
  closeAll(): Promise<void>
}

interface ResolvedAuth {
  jwt: string
  holder: string
  renewalToken?: string
}

async function resolveAuth(
  auth: SessionAuth,
  verifier: string | undefined,
  identity: string | undefined,
): Promise<ResolvedAuth> {
  if (auth.jwt !== undefined) {
    return {jwt: auth.jwt, holder: decodeJwtClaims(auth.jwt)?.sub ?? identity ?? ''}
  }
  if (auth.renewalToken !== undefined) {
    if (!verifier) throw new Error('openSession({renewalToken}): config.verifier is required')
    const t = await redeemRenewalToken(verifier, auth.renewalToken)
    return {jwt: t.token, holder: t.holder, renewalToken: auth.renewalToken}
  }
  if (auth.redemptionToken !== undefined) {
    if (!verifier) throw new Error('openSession({redemptionToken}): config.verifier is required')
    if (!identity) throw new Error('openSession({redemptionToken}): config.identity (recipient DID) is required')
    const t = await redeemCredential(verifier, auth.redemptionToken, identity)
    return {jwt: t.token, holder: t.holder}
  }
  if (auth.vpJwt !== undefined) {
    if (!verifier) throw new Error('openSession({vpJwt}): config.verifier is required')
    if (!identity) throw new Error('openSession({vpJwt}): config.identity (holder DID) is required')
    if (!auth.vpJwt.holderProof) {
      throw new Error('openSession({vpJwt}): holderProof is required to prove control of the holder DID')
    }
    // F1/F4: fetch a nonce + sign a proof bound to these exact credentials.
    const holderProof = await createHolderProof(verifier, {
      signer: auth.vpJwt.holderProof.signer,
      audience: auth.vpJwt.holderProof.audience,
      credentials: auth.vpJwt.credentials,
      slotId: auth.vpJwt.holderProof.slotId,
      action: auth.vpJwt.holderProof.action,
      ttlSecs: auth.vpJwt.holderProof.ttlSecs,
    })
    const t = await verifyVpJwt(verifier, {
      dcql_rule: auth.vpJwt.dcqlRule,
      holder: identity,
      credentials: auth.vpJwt.credentials,
      holder_proof: holderProof,
    })
    return {jwt: t.token, holder: t.holder}
  }
  throw new Error('openSession: unrecognized auth (expected jwt | renewalToken | redemptionToken | vpJwt)')
}

/**
 * Create a client for JWT-authorized slot sessions. Configure endpoints from a network manifest downloaded from the tasra-releases repository.
 *
 * Sessions assemble the master key lazily on first decryption and clear it on close. Only renewal-token authorization renews automatically; other modes require a new session after expiry.
 *
 * @param config - Keeper URLs and the verifier or holder identity required by the selected authorization mode.
 * @returns A client that opens and tracks managed slot sessions.
 * @throws If no keeper URL is supplied.
 */
export function createTasraClient(
  config: TasraClientConfig,
): TasraClient {
  if (!config.nodes || config.nodes.length === 0) {
    throw new Error('createTasraClient: at least one node URL is required')
  }
  const open = new Set<Session>()
  // A shallow freeze leaves the caller's array mutable and can redirect JWT requests.
  const nodes = [...config.nodes]
  for (const node of nodes) {
    if (typeof node !== 'string') throw new Error('createTasraClient: invalid node URL')
    const url = new URL(node)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('createTasraClient: invalid node URL')
  }
  Object.freeze(nodes)
  const frozen = Object.freeze({...config, nodes})

  return {
    config: frozen,
    async openSession(slotId, auth, opts) {
      const resolved = await resolveAuth(auth, frozen.verifier, frozen.identity)
      const {mpkBytes, epoch} = await fetchMpk(frozen.nodes[0]!, slotId)
      const slotIdBytes = hexToBytes(slotId)
      const session = newSession({
        slotId,
        slotIdBytes,
        nodes: frozen.nodes,
        verifier: frozen.verifier,
        jwt: resolved.jwt,
        holder: resolved.holder,
        renewalToken: resolved.renewalToken,
        mpkBytes,
        // Assembled lazily on the first decrypt - sign/encrypt need no shard fetch.
        msk: null,
        epoch,
        identity: opts?.identity ?? slotIdBytes,
        skewMs: opts?.skewMs ?? 30_000,
        onClose: s => open.delete(s),
      })
      open.add(session)
      return session
    },
    sessions() {
      return [...open]
    },
    async closeAll() {
      await Promise.all([...open].map(s => s.close()))
    },
  }
}
