import {requireRule, type RuleInput} from './ruleInput.js'
// Deliver a slot's clear authorization rule to the keepers that hold its shares, authorised by the
// slot's ON-CHAIN CREATOR.
//
// The chain carries only the salted commitment, so every keeper fails closed until it holds
// the rule itself. Until now this SDK could create a slot and never make it usable: delivering
// the rule meant the keeper's admin-JWT route, which needs the deployment's `[issuer]` signing
// key - an OPERATOR secret a third-party creator does not have.
//
// `POST /v1/keys/:id/rule/by-creator` authenticates the creator instead, so whoever created a
// slot can provision it with their own key.
//
// SAFE WITHOUT AN OPERATOR SECRET only BECAUSE THE WRITE IS COMMITMENT-BOUND. The keeper
// refuses any rule whose salted commitment differs from the one `KeySlotCreated` recorded (and,
// during an amendment, from the one `RuleUpdateProposed` recorded). So no caller - authorised
// or not - can make a keeper enforce a rule the chain did not already commit to. The
// authorisation buys attribution and a rate-limit identity, not rule integrity.

import type {Address, Hex} from 'viem'
import type {TasraChainClient} from './client.js'
import {resolveSlotKeeperUrls} from './discovery.js'
import {ruleCommitment} from './write.js'
import {RuleAmendmentError, abortableDelay} from './ruleAmendmentCore.js'
import {TasraError} from '../errors.js'
import type {PresentationDelegation} from '../verifier-agent/index.js'
import {
  PRESENTATION_EIP712_NAME,
  PRESENTATION_EIP712_VERSION,
  PRESENTATION_OPERATION_TYPES,
  type TypedDataSigner,
} from '../oid4vp/verifier-agent.js'

/**
 * Action identifier accepted by the creator-authorized rule provisioning endpoint.
 */
export const PROVISION_RULE_ACTION = 'provision-rule'

/**
 * Creator-signed rule delivery request with the private salt used at slot creation.
 */
export interface ProvisionRuleArgs extends RuleInput {
  /**
   * 32-byte identifier of the slot to provision.
   */
  slotId: Hex
  /** The 32-byte rule salt `createSlot` returned. It exists NOWHERE else. */
  ruleSalt: Hex
  /** The slot's creator key (or a key it delegated to). */
  signer: TypedDataSigner
  /** Seconds the authorisation stays valid (default 600; the keeper caps at 3600). */
  ttlSecs?: number
  /**
   * Authorization issue time in Unix seconds; defaults to the current clock.
   */
  nowSecs?: number
  /**
   * Consent description included in the creator signature.
   */
  description?: string
  /**
   * Cancel pending keeper HTTP requests.
   */
  signal?: AbortSignal
  /** Overrides the on-chain committee; for tests and for a topology chain cannot see. */
  keeperUrls?: string[]
  /**
   * HTTP implementation used for rule delivery.
   */
  fetchImpl?: typeof fetch
  /**
   * Which rule the keepers must store. `'active'` (default) is the slot's current rule, delivered
   * once per keeper exactly as before. `'pending'` is a proposed amendment: a keeper that has not
   * yet ingested the proposal is retried, and a keeper that stores it as the ACTIVE rule is an error.
   */
  expect?: 'active' | 'pending'
  /**
   * Milliseconds to keep retrying a keeper that has not yet ingested the proposal, every 3 s
   * (default 120000). Used only with `expect: 'pending'`, and must not exceed `ttlSecs`, because
   * one signature serves every retry.
   */
  retryConflictMs?: number
  /**
   * A creator delegation authorizing `signer` to deliver for the creator. A rule admin delivering
   * a pending amendment signs without one; keepers do not accept an admin delegation.
   */
  delegation?: PresentationDelegation
}

/** One keeper's answer. `pending` marks a rule stored against a PENDING amendment. */
export interface KeeperProvisionResult {
  /**
   * Keeper endpoint contacted by this attempt.
   */
  url: string
  /**
   * Whether the keeper accepted the HTTP request.
   */
  ok: boolean
  /** The active rule was filled in by THIS call (false when it was already present). */
  provisioned?: boolean
  /**
   * Whether the keeper stored the rule for a pending amendment.
   */
  pending?: boolean
  /**
   * Pending amendment version reported by the keeper.
   */
  pendingVersion?: number
  /**
   * HTTP status when a response was received.
   */
  status?: number
  /**
   * Bounded response text or transport error for a failed delivery.
   */
  error?: string
  /** Which authority the keeper accepted the signature as, when it says. */
  authorizedBy?: 'creator' | 'delegate' | 'rule_admin'
}

/**
 * Committed rule hash and per-keeper delivery outcomes.
 */
export interface ProvisionRuleResult {
  /**
   * Slot whose authorization rule was delivered.
   */
  slotId: Hex
  /**
   * Salted commitment computed from the submitted rule and saved salt.
   */
  ruleCommitment: Hex
  /**
   * Delivery result for each selected keeper.
   */
  results: KeeperProvisionResult[]
}

/**
 * Build the EIP-712 authorization a keeper verifies against the slot creator. The payload digest is the salted rule commitment.
 * @param input Chain, registry, slot, commitment, consent description and expiry in Unix seconds.
 * @returns Typed data ready for the creator wallet to sign.
 */
export function provisionRuleTypedData(input: {
  chainId: number
  keyRegistry: Address
  slotId: Hex
  commitment: Hex
  description: string
  exp: number
}) {
  return {
    domain: {
      name: PRESENTATION_EIP712_NAME,
      version: PRESENTATION_EIP712_VERSION,
      chainId: input.chainId,
      verifyingContract: input.keyRegistry,
    },
    types: PRESENTATION_OPERATION_TYPES,
    primaryType: 'PresentationOperation' as const,
    message: {
      chainId: BigInt(input.chainId),
      slotId: input.slotId,
      action: PROVISION_RULE_ACTION,
      payloadDigest: input.commitment,
      description: input.description,
      exp: BigInt(input.exp),
    },
  }
}

/**
 * Report individual keeper delivery failures. Peer recovery requires at least one keeper to hold the committed rule; callers still receive partial failures explicitly.
 */
function fanoutError(slotId: Hex, ok: number, total: number, results: KeeperProvisionResult[], pending = false): Error {
  const failures = results.filter(r => !r.ok).map(r => `${r.url}: ${r.error ?? `HTTP ${r.status}`}`)
  const tail = `\n  ${failures.join('\n  ')}`
  if (pending) {
    // A PENDING rule is not peer-healed: a keeper that missed it stays without it. Activation needs
    // n - k + 1 keepers holding it, so the failures must be re-delivered, not waited out.
    return new Error(
      `provisionRule: ${ok} of ${total} keepers stored the pending amendment for ${slotId}. Pending rules ` +
        'are not peer-healed, and activation needs n - k + 1 keepers holding the rule: re-deliver to ' +
        `the keepers below.${tail}`,
    )
  }
  if (ok === 0) {
    return new Error(
      `provisionRule: no keeper accepted the rule for ${slotId} (0 of ${total}). The slot stays ` +
        'unusable and nothing can self-heal: peer rule-heal needs at least one keeper that ' +
        `already holds it.${tail}`,
    )
  }
  return new Error(
    `provisionRule: ${ok} of ${total} keepers accepted the rule for ${slotId}. The rest should ` +
      'self-heal from a peer (each keeper re-fetches a missing rule and checks it against the ' +
      `on-chain commitment), but the failures are reported rather than hidden.${tail}`,
  )
}

/**
 * Deliver the clear rule and its salt to every assigned keeper using creator authorization. Throws if any delivery fails; inspect cause.results for individual outcomes.
 * @param chain Reader for the deployment that owns the slot.
 * @param args Rule, saved salt, creator signer and optional transport controls.
 * @returns Commitment and successful delivery results for every selected keeper.
 */
export async function provisionRule(
  chain: TasraChainClient,
  args: ProvisionRuleArgs,
): Promise<ProvisionRuleResult> {
  args.signal?.throwIfAborted()
  if (!/^0x[0-9a-fA-F]{64}$/.test(args.slotId)) throw new Error('provisionRule: slotId must be 32 bytes')
  if (!/^0x[0-9a-fA-F]{64}$/.test(args.ruleSalt)) throw new Error('provisionRule: ruleSalt must be 32 bytes')
  const rule = requireRule(args)
  const expectPending = args.expect === 'pending'
  if (args.expect !== undefined && args.expect !== 'active' && !expectPending) {
    throw new TasraError(`provisionRule: expect must be 'active' or 'pending', got ${JSON.stringify(args.expect)}`)
  }
  const ttlSecs = args.ttlSecs ?? 600
  const retryConflictMs = args.retryConflictMs ?? 120_000
  if (!Number.isSafeInteger(retryConflictMs) || retryConflictMs < 0) {
    throw new TasraError(`provisionRule: retryConflictMs must be a non-negative integer, got ${String(args.retryConflictMs)}`)
  }
  // One signature serves every retry, so retrying past its expiry would only collect refusals.
  if (expectPending && retryConflictMs > ttlSecs * 1000) {
    throw new TasraError(
      `provisionRule: retryConflictMs (${retryConflictMs} ms) outlives the authorization (ttlSecs ${ttlSecs}); ` +
        'raise ttlSecs (the keeper caps it at 3600) or lower retryConflictMs',
    )
  }

  const commitment = ruleCommitment(args.ruleSalt, rule)
  // The configured id when present, else asked of the node: the EIP-712 domain must name the
  // chain the KEEPER resolved, or the signature verifies against a domain nobody signed.
  const chainId = chain.client.chain?.id ?? (await chain.client.getChainId())
  const keyRegistry = chain.addresses.KeyRegistry
  if (!keyRegistry) throw new Error('provisionRule: the address book has no KeyRegistry')
  const exp = (args.nowSecs ?? Math.floor(Date.now() / 1000)) + ttlSecs
  const description = args.description ?? `Provision the authorization rule for slot ${args.slotId}`

  const typedData = provisionRuleTypedData({chainId, keyRegistry, slotId: args.slotId, commitment, description, exp})
  const operationSig = await args.signer.signTypedData(typedData)
  args.signal?.throwIfAborted()

  const urls = args.keeperUrls ?? (await resolveSlotKeeperUrls(chain, args.slotId))
  if (urls.length === 0) throw new Error(`provisionRule: slot ${args.slotId} has no assigned keepers on chain`)

  const d = args.delegation
  const body = JSON.stringify({
    // Current keeper wire names; these carry the clear policy and salt, not a hash.
    dcql_rule: rule,
    dcql_salt: args.ruleSalt,
    authorization: {
      chain_id: chainId,
      slot_id: args.slotId,
      action: PROVISION_RULE_ACTION,
      payload_digest: commitment,
      description,
      exp,
      operation_sig: operationSig,
      // Absent, not null, without a delegation: the active-path body stays byte-identical.
      ...(d
        ? {
            delegation: {
              chain_id: d.chain_id,
              slot_ids: d.slot_ids,
              delegate: d.delegate,
              actions: d.actions,
              exp: d.exp,
              nonce: d.nonce,
              delegation_sig: d.signature,
            },
          }
        : {}),
    },
  })
  const id = args.slotId.slice(2)
  const doFetch = args.fetchImpl ?? fetch

  /** POST once and classify the answer on its FULL text, before it is truncated for `error`. */
  async function deliverOnce(url: string): Promise<{result: KeeperProvisionResult; kind: DeliveryKind}> {
    try {
      const res = await doFetch(`${url.replace(/\/$/, '')}/v1/keys/${id}/rule/by-creator`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body,
        signal: args.signal,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        const result = {url, ok: false, status: res.status, error: text.slice(0, 300) || `HTTP ${res.status}`}
        return {result, kind: classifyRefusal(res.status, text)}
      }
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
      const by = json.authorized_by
      return {
        kind: 'ok',
        result: {
          url,
          ok: true,
          status: res.status,
          provisioned: json.provisioned === true,
          pending: json.pending === true,
          pendingVersion: typeof json.pending_version === 'number' ? json.pending_version : undefined,
          ...(by === 'creator' || by === 'delegate' || by === 'rule_admin' ? {authorizedBy: by} : {}),
        },
      }
    } catch (e) {
      return {result: {url, ok: false, error: e instanceof Error ? e.message : String(e)}, kind: 'fail'}
    }
  }

  /** Under `expect: 'pending'`, retry a keeper that has not yet ingested the proposal; else one attempt. */
  async function deliver(url: string): Promise<{result: KeeperProvisionResult; kind: DeliveryKind}> {
    const deadline = Date.now() + retryConflictMs
    let attempt = await deliverOnce(url)
    while (expectPending && attempt.kind === 'not-ingested' && Date.now() < deadline) {
      await abortableDelay(PENDING_RETRY_INTERVAL_MS, args.signal)
      attempt = await deliverOnce(url)
    }
    return attempt
  }

  // One signature serves the whole committee ON PURPOSE: the same rule goes to every drawn
  // keeper, so replay to a sibling is the intended behaviour, not an attack.
  const attempts = await Promise.all(urls.map(deliver))
  const results = attempts.map(a => a.result)

  if (expectPending) {
    if (attempts.some(a => a.kind === 'pending-changed')) {
      const changed = attempts.filter(a => a.kind === 'pending-changed').map(a => a.result.url)
      throw new RuleAmendmentError(
        'pending-changed',
        args.slotId,
        `provisionRule: the pending amendment of slot ${args.slotId} changed while the rule was being stored ` +
          `(${changed.join(', ')}); nothing was written there. Re-read readRuleAmendment and re-deliver if this rule is still pending`,
        {results},
      )
    }
    const active = results.filter(r => r.ok && r.pending !== true).map(r => r.url)
    if (active.length > 0) {
      throw new RuleAmendmentError(
        'not-pending',
        args.slotId,
        `provisionRule: expected the keepers to store a PENDING amendment for slot ${args.slotId}, but ` +
          `${active.join(', ')} took the rule as ACTIVE; this rule is not the slot's pending proposal`,
        {results},
      )
    }
  }

  const ok = results.filter(r => r.ok).length
  if (ok < results.length) {
    const err = fanoutError(args.slotId, ok, results.length, results, expectPending)
    err.cause = {results}
    ;(err as Error & {results?: KeeperProvisionResult[]}).results = results
    throw err
  }
  return {slotId: args.slotId, ruleCommitment: commitment, results}
}

/** How one keeper answered, for the pending-delivery retry decision. */
type DeliveryKind = 'ok' | 'fail' | 'not-ingested' | 'pending-changed'

/** Spacing between retries of a keeper that has not yet ingested the proposal. */
const PENDING_RETRY_INTERVAL_MS = 3_000

/**
 * Classify a refusal on the keeper's full answer. A 409 other than "pending rule amendment changed"
 * and the rule admin's 403 "may provision only the slot's pending amendment" both mean the keeper
 * has not yet ingested `RuleUpdateProposed`; "changed" is terminal. Only `expect: 'pending'` retries.
 */
function classifyRefusal(status: number, text: string): DeliveryKind {
  if (status === 409) return text.includes('pending rule amendment changed') ? 'pending-changed' : 'not-ingested'
  if (status === 403 && text.includes("may provision only the slot's pending amendment")) return 'not-ingested'
  return 'fail'
}
