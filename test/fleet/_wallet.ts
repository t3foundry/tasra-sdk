// Real production wallet authorization shared by the live suites.
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {privateKeyToAccount} from 'viem/accounts'
import {parseEther, type Address, type Hex} from 'viem'
import {createTasraWriteClient, generateClientKey} from '../../src/chain/write.ts'
import {
  ed25519HolderKey, issueSdJwtVc, type OperationInput,
} from '../../src/oid4vp/index.ts'
import {discoverCommittee, mintAdminJwt, provisionRule, type FleetConfig} from './_fleet.ts'
import {assertLocalPrepaidFleet, fundFreshWalletSlot, localPrepaidSettings} from './_prepaid-funding.ts'
import {authorizePaidWallet} from './_paid-wallet.ts'
import {issuerStatus} from './_issuer-status.ts'

export const WALLET_RULE = JSON.stringify({credentials:[{claims:[{path:['iss'],values:['did:web:hr.acmecorp.example']},{path:['dept'],values:['Engineering']}],format:'dc+sd-jwt',id:'employee',meta:{vct_values:['EmployeeOf']}}]})

export function issueWallet(cfg: FleetConfig, opts: {dept?: string; issuer?: string; ttlSecs?: number; issuerKey?: string; vct?: string; claims?: Record<string, unknown>} = {}) {
  const holder = ed25519HolderKey(randomBytes(32))
  const claims = opts.claims ?? {dept:opts.dept ?? 'Engineering'}
  assert(!Object.hasOwn(claims, 'credentialStatus') && !Object.hasOwn(claims, 'status'), 'Issuer status must come from its original allocation ledger')
  const status = issuerStatus(cfg, holder.did)
  const sdJwt = issueSdJwtVc({
    issuer:{did:opts.issuer ?? cfg.issuerDid, signer:{alg:'EdDSA',privateKey:Buffer.from(opts.issuerKey ?? cfg.issuerKey,'base64url')}},
    vct:opts.vct ?? 'EmployeeOf', claims:{...claims, credentialStatus:status}, plain:['credentialStatus'], cnf:{jwk:holder.publicJwk},
    sub:holder.did, ttlSecs:opts.ttlSecs ?? 3600,
  })
  return {holder, sdJwt}
}

export async function authorizeWallet(cfg: FleetConfig, slot: Hex, creatorKey: Hex,
  input: Pick<OperationInput,'action'|'message'|'payloadDigest'|'identity'|'ttlSecs'>,
  wallet = issueWallet(cfg), forcePresentation = false, coordinator?: Address) {
  return authorizePaidWallet(cfg, slot, creatorKey, input, wallet, forcePresentation, coordinator)
}

export async function createWalletSlot(cfg: FleetConfig, mode: 'frost'|'bls' = 'frost', k = 2, n = 3, rule = WALLET_RULE) {
  localPrepaidSettings(cfg)
  const creatorKey = generateClientKey()
  const writer = createTasraWriteClient({rpcUrl:cfg.rpcUrl,addresses:cfg.book,privateKey:creatorKey,chainId:cfg.chainId})
  await assertLocalPrepaidFleet(cfg, writer)
  const funder = createTasraWriteClient({rpcUrl:cfg.rpcUrl,addresses:cfg.book,privateKey:cfg.deployPk as Hex,chainId:cfg.chainId})
  await funder.sendEth(writer.address,parseEther('1'))
  const created = await writer.createSlotCommitReveal({rule:rule,k,n,mode,authType:'oid4vp',tags:['keykeeper'],maxWaitMs:180000})
  const {slotId,ruleSalt} = created
  await fundFreshWalletSlot(cfg, writer, creatorKey, created, rule)
  const deadline = Date.now()+240000
  for (;;) {
    const committee = await discoverCommittee(cfg,slotId)
    if (committee.length === n) {
      const response = await fetch(`${committee[0]}/v1/keys/${slotId}/public`)
      assert.equal(response.status,200)
      const pub = await response.json() as {group_public_key?:string}
      if (pub.group_public_key) {
        const provisioned = await provisionRule(committee,slotId,rule,ruleSalt,mintAdminJwt(cfg))
        assert(provisioned.ok,provisioned.errors.join('; '))
        return {slotId,ruleSalt,committee,publicKey:pub.group_public_key,creatorKey,writer}
      }
    }
    assert(Date.now()<deadline,'slot DKG did not complete')
    await new Promise(resolve=>setTimeout(resolve,2000))
  }
}
