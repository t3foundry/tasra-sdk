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
function fanoutError(slotId: Hex, ok: number, total: number, results: KeeperProvisionResult[]): Error {
  const failures = results.filter(r => !r.ok).map(r => `${r.url}: ${r.error ?? `HTTP ${r.status}`}`)
  const tail = `\n  ${failures.join('\n  ')}`
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

  const commitment = ruleCommitment(args.ruleSalt, rule)
  // The configured id when present, else asked of the node: the EIP-712 domain must name the
  // chain the KEEPER resolved, or the signature verifies against a domain nobody signed.
  const chainId = chain.client.chain?.id ?? (await chain.client.getChainId())
  const keyRegistry = chain.addresses.KeyRegistry
  if (!keyRegistry) throw new Error('provisionRule: the address book has no KeyRegistry')
  const exp = (args.nowSecs ?? Math.floor(Date.now() / 1000)) + (args.ttlSecs ?? 600)
  const description = args.description ?? `Provision the authorization rule for slot ${args.slotId}`

  const typedData = provisionRuleTypedData({chainId, keyRegistry, slotId: args.slotId, commitment, description, exp})
  const operationSig = await args.signer.signTypedData(typedData)
  args.signal?.throwIfAborted()

  const urls = args.keeperUrls ?? (await resolveSlotKeeperUrls(chain, args.slotId))
  if (urls.length === 0) throw new Error(`provisionRule: slot ${args.slotId} has no assigned keepers on chain`)

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
    },
  })
  const id = args.slotId.slice(2)
  const doFetch = args.fetchImpl ?? fetch

  // One signature serves the whole committee ON PURPOSE: the same rule goes to every drawn
  // keeper, so replay to a sibling is the intended behaviour, not an attack.
  const results = await Promise.all(
    urls.map(async (url): Promise<KeeperProvisionResult> => {
      try {
        const res = await doFetch(`${url.replace(/\/$/, '')}/v1/keys/${id}/rule/by-creator`, {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body,
          signal: args.signal,
        })
        if (!res.ok) {
          const text = await res.text().catch(() => '')
          return {url, ok: false, status: res.status, error: text.slice(0, 300) || `HTTP ${res.status}`}
        }
        const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
        return {
          url,
          ok: true,
          status: res.status,
          provisioned: json.provisioned === true,
          pending: json.pending === true,
          pendingVersion: typeof json.pending_version === 'number' ? json.pending_version : undefined,
        }
      } catch (e) {
        return {url, ok: false, error: e instanceof Error ? e.message : String(e)}
      }
    }),
  )

  const ok = results.filter(r => r.ok).length
  if (ok < results.length) {
    const err = fanoutError(args.slotId, ok, results.length, results)
    err.cause = {results}
    ;(err as Error & {results?: KeeperProvisionResult[]}).results = results
    throw err
  }
  return {slotId: args.slotId, ruleCommitment: commitment, results}
}
