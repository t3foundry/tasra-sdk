// ADR-0090 D7 session mode on the registered paid verifier-agent client: the create fragment, the
// session-key-bound presentation nonce (review 2026-11-09) and the grant on the completed poll,
// against the agent's real request/response shapes (keykeeper-verifier-agent server/sessions.rs).
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import {p256} from '@noble/curves/p256'
import {sha256} from '@noble/hashes/sha256'
import {concatHex, hexToBytes, keccak256, toHex, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {prepareRegisteredPaidSession} from '../../src/chain/registeredPaidAgent.js'
import {authenticateApprovedService} from '../../src/chain/serviceIdentity.js'
import {readClientExecutionPolicy, type PaidVerifierWitness} from '../../src/chain/prepaid.js'
import {createExecutionCertificate, createLocalExecutionSigner, executionBodyHash, verifyExecutionAuthorization} from '../../src/committee/execution.js'
import {paymentIntentHash, paymentIntentTypedData, paymentSessionCommitment, type PaymentIntentWire} from '../../src/committee/payment.js'
import {assembleCompoundToken, compoundTokenHash, selectVerifierCommittee, statusAttestationHash, verifierLeaf, BINDING_HOLDER_KEY,
  type CompoundTokenPayload} from '../../src/committee/token.js'
import {encodeSessionGrant, sessionGrantHash, sessionGrantPayload, sessionKeyThumbprint, type SessionKeyJwk} from '../../src/committee/session-grant.js'
import {presentationOperationTypedData} from '../../src/oid4vp/verifier-agent.js'
import {derivedNonce, requestHash, vpSessionNonce} from '../../src/oid4vp/binding.js'
import {signCompactJws} from '../../src/oid4vp/jose.js'
import {createDecryptionRecipient, decryptionBinding} from '../../src/crypto/recipient.js'
import {createSessionKey, sessionGrantCreateFragment} from '../../src/app/session-grants.js'
import type {TasraChainClient} from '../../src/chain/client.js'
import type {ApprovedAgentProfile} from '../../src/chain/registeredAgent.js'
import type {PaidAgentTransport} from '../../src/chain/paidAgentTransport.js'
import type {ServiceRecord} from '../../src/chain/services.js'

vi.mock('../../src/chain/serviceIdentity.js',async original=>({...await original<typeof import('../../src/chain/serviceIdentity.js')>(),authenticateApprovedService:vi.fn()}))
vi.mock('../../src/chain/prepaid.js',async original=>({...await original<typeof import('../../src/chain/prepaid.js')>(),readClientExecutionPolicy:vi.fn()}))
const h=(n:number,len=32):Hex=>`0x${n.toString(16).padStart(2,'0').repeat(len)}`
const bytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value))
const owner='ab'.repeat(32), proposalId='cd'.repeat(32)
const cleanups:Array<()=>void>=[]
beforeEach(()=>{vi.spyOn(Date,'now').mockReturnValue(1_000_000);vi.mocked(authenticateApprovedService).mockReset();vi.mocked(readClientExecutionPolicy).mockReset()})
afterEach(()=>{cleanups.splice(0).forEach(cleanup=>cleanup());vi.restoreAllMocks()})

/** A paid KEM decrypt session; `agentKey` lets the stand-in agent bind ANOTHER session key than the client's. */
async function fixture(options:{grant?:boolean;agentKey?:SessionKeyJwk;slots?:Hex[];action?:'sign'}={}) {
  const creator=privateKeyToAccount(h(11)), signer=createLocalExecutionSigner(new Uint8Array(32).fill(21))
  cleanups.push(()=>signer.dispose())
  const endpoint='https://agent.example'
  const profile:ApprovedAgentProfile={endpoint,clientId:'decentralized_identifier:did:web:agent.example',
    approval:{chainId:43112,registry:h(4,20),serviceId:h(5),serviceType:1,owner:creator.address,revision:1n,manifestHash:h(6)}}
  const record:ServiceRecord={owner:creator.address,pendingOwner:h(0,20),authKey:h(7,20),serviceType:1,status:0,revision:1n,manifestHash:h(6),endpoint}
  const chain={addresses:{ServiceRegistry:h(4,20)},client:{getChainId:vi.fn(async()=>43112),getBlockNumber:vi.fn(async()=>20n)},
    readers:{serviceRegistry:{getService:vi.fn(async()=>({...record}))}}} as unknown as TasraChainClient
  vi.mocked(authenticateApprovedService).mockResolvedValue({record:{...record},manifest:{capabilities:['oid4vp']}} as Awaited<ReturnType<typeof authenticateApprovedService>>)
  const keys=[1,2].map(n=>toHex(ed25519.getPublicKey(new Uint8Array(32).fill(n))))
  const operators=[h(31,20),h(32,20)]
  const leaves=keys.map((key,i)=>toHex(verifierLeaf(i,hexToBytes(operators[i]!),hexToBytes(key))))
  const root=keccak256(concatHex([...leaves].sort())), members:PaidVerifierWitness[]=keys.map((publicKey,index)=>({index,publicKey,operator:operators[index]!,proof:[leaves[1-index]!]}))
  const settlement=h(1,20), keyRegistry=h(2,20), slot=h(3)
  const recipient=await createDecryptionRecipient()
  const binding=decryptionBinding(sha256(new TextEncoder().encode('one chat message')),0,recipient)
  const input=options.action==='sign'
    ?presentationOperationTypedData({chainId:43112,keyRegistry,slotId:slot,action:'sign',message:new Uint8Array([1,2,3]),description:'Open a chat session',nowSecs:1000,ttlSecs:60})
    :presentationOperationTypedData({chainId:43112,keyRegistry,slotId:slot,action:'decrypt',decryption:binding.decryption,description:'Open a chat session',nowSecs:1000,ttlSecs:60})
  const action=options.action??'decrypt'
  const operationSig=await creator.signTypedData(input.typedData), random=h(12)
  const payment:PaymentIntentWire={chain_id:43112,settlement,key_registry:keyRegistry,slot,action,payload_digest:toHex(input.payloadDigest),
    session_commitment:paymentSessionCommitment(random,profile.clientId,1060),nonce:h(10),max_cost:'10',expires:1060,
    verification_epoch:7,verification_seed:h(9),verification_root:root,verification_registry_size:2,verification_committee:2,verification_quorum:2,
    keeper_assignment:{key_epoch:1,committee_version:2,threshold:2,coordinator:Array<number>(32).fill(9),contributors:[9,10,11].map(n=>Array<number>(32).fill(n))},signature:h(1,65)}
  payment.signature=await creator.signTypedData(paymentIntentTypedData(payment))
  const policy={chainId:43112,settlement,keyRegistry,creator:creator.address,paymentHash:paymentIntentHash(payment),cost:9n,nowSecs:1000}
  vi.mocked(readClientExecutionPolicy).mockResolvedValue({blockNumber:20n,blockHash:h(20),blockTimestamp:1000n,policy})
  const certificate=await createExecutionCertificate({payment,policy,publicKey:signer.publicKey,expires:1050,creator})
  const sessionKey=await createSessionKey({alg:'Ed25519'}), otherKey=await createSessionKey({alg:'Ed25519'})
  const fragment=sessionGrantCreateFragment(sessionKey,{slots:options.slots??[h(0x0f),slot],accessTtlSecs:30,idleTimeoutSecs:600,absoluteTtlSecs:3600})
  const params={operation:input.operation,operationSig,messageHex:input.messageHex,payment,random,...(action==='decrypt'?{decryption:binding.decryption}:{}),
    ...(options.grant===false?{}:{sessionGrant:fragment.session_grant})}
  const deployment={chainId:43112,settlement,keyRegistry,verifierSet:h(8,20),beacon:h(13,20)}
  const pin={chainId:43112,registry:h(4,20),serviceId:h(5),serviceType:1,owner:creator.address.toLowerCase(),revision:'1',manifestHash:h(6),authKey:h(7,20),endpoint,clientId:profile.clientId}
  const reqHash=requestHash(43112,hexToBytes(slot),action,input.payloadDigest)
  const drawn=selectVerifierCommittee(hexToBytes(slot),7,hexToBytes(h(9)),2,2), jarIndex=drawn[9%drawn.length]!
  const ctx={epoch:7,snapshotRoot:hexToBytes(root),registrySize:2,committee:2,quorum:2,operationExp:1060}
  const ownThumb=sessionKeyThumbprint(sessionKey.jwk), agentThumb=sessionKeyThumbprint(options.agentKey??sessionKey.jwk)
  const grantMode=options.grant!==false
  const nonce=grantMode?vpSessionNonce(reqHash,hexToBytes(random),ctx,agentThumb):derivedNonce(reqHash,hexToBytes(random),ctx)
  const state='ef'.repeat(32), keyPoint=p256.getPublicKey(new Uint8Array(32).fill(1),false)
  const keyJwk={kty:'EC',crv:'P-256',x:Buffer.from(keyPoint.slice(1,33)).toString('base64url'),y:Buffer.from(keyPoint.slice(33)).toString('base64url'),alg:'ECDH-ES',use:'enc',kid:'12'.repeat(16)}
  let sessionId='', context:Record<string,unknown>|undefined, created:Record<string,unknown>|undefined
  const transport:PaidAgentTransport={request:vi.fn(),paidAgentRequest:vi.fn(async(url,opts)=>{
    if(url===endpoint+'/v1/sessions') {
      created=JSON.parse(new TextDecoder().decode(opts.body)) as Record<string,unknown>
      const preimage={chain_id:43112,slot_id:slot,action,message_sha256:toHex(sha256(hexToBytes(('0x'+input.messageHex.replace(/^0x/,'')) as Hex))),identity:null,
        payload_digest:payment.payload_digest,description:input.operation.description,operation:input.operation,operation_sig:operationSig,payment,delegation:null,random,
        request_hash:toHex(reqHash),nonce,epoch:7,seed:h(9),snapshot_root:root,committee_count:2,quorum:2,registry_size:2,drawn,jar_signer_index:jarIndex,
        client_id:profile.clientId,service_profile:pin,...(grantMode?{session_key_thumbprint:toHex(agentThumb)}:{}),
        execution_initialization:created.execution_initialization,execution_certificate:certificate,
        execution_policy:{chain_id:43112,settlement,key_registry:keyRegistry,creator:creator.address.toLowerCase(),cost:toHex(9n,{size:32})}}
      context={binding_preimage:preimage,state,enc_public_jwk:keyJwk,expires_at:1030}
      const g=created.session_grant as {slots:string[];access_ttl_secs:number;idle_timeout_secs:number;absolute_ttl_secs:number}|undefined
      const lifetimes=g&&{access_ttl_secs:g.access_ttl_secs,idle_timeout_secs:g.idle_timeout_secs,absolute_ttl_secs:g.absolute_ttl_secs}
      return {status:201,body:bytes({session_id:sessionId,poll_secret:owner,service_profile:pin,execution_context:context,request_uri:endpoint+'/v1/request/'+sessionId,
        ...(g?{session_grant_params:{session_id:h(0x51),slots:g.slots,requested:lifetimes,granted:lifetimes}}:{})})}
    }
    return {status:204,body:new Uint8Array()}
  })}
  const session=await prepareRegisteredPaidSession(chain,{profile,deployment,transport,members,ruleHash:h(33),dcqlQuery:{credentials:[{id:'all',format:'dc+sd-jwt'}]}},params,
    {certificate,signer,pollSecret:owner,expires:1030})
  sessionId=session.sessionId
  const ro=(nonceValue:string)=>signCompactJws({typ:'oauth-authz-req+jwt',kid:'did:web:agent.example#drawn'},{iss:'did:web:agent.example',client_id:profile.clientId,
    response_type:'vp_token',response_mode:'direct_post.jwt',response_uri:endpoint+'/v1/response?session='+sessionId,nonce:nonceValue,state,iat:1000,exp:1030,
    dcql_query:{credentials:[{id:'all',format:'dc+sd-jwt'}]},client_metadata:{jwks:{keys:[keyJwk]}}},{alg:'EdDSA',privateKey:new Uint8Array(32).fill(jarIndex+1)})
  /** A completed poll: a quorum-signed token over this operation, and optionally the grant fields. */
  const done=(extra:Record<string,unknown>={})=>{
    const payload:CompoundTokenPayload={tokenType:'JWT',seed:hexToBytes(h(9)),epoch:7,slotId:hexToBytes(slot),vpHash:hexToBytes(h(34)),holderHash:hexToBytes(h(35)),
      ruleHash:hexToBytes(h(33)),requestHash:reqHash,paymentHash:hexToBytes(paymentIntentHash(payment)),payment,binding:BINDING_HOLDER_KEY,verifierIndexes:drawn,iat:1000,exp:1030}
    const hash=compoundTokenHash(payload), key=(i:number)=>new Uint8Array(32).fill(i+1)
    const status_attestations=[0,1].map(i=>({verifier_index:i,status_until:1030,signature:toHex(ed25519.sign(statusAttestationHash(hash,i,1030),key(i)))}))
    const compound_token={...assembleCompoundToken(payload,[0,1].map(verifierIndex=>({verifierIndex,signature:ed25519.sign(hash,key(verifierIndex))}))),status_attestations}
    return {status:200,body:bytes({status:'done',phase:'done',compound_token,...extra})}
  }
  /** A grant signed by the drawn verifiers; `change` overrides payload fields. */
  const grant=(change:Partial<Parameters<typeof sessionGrantPayload>[0]>={})=>{
    const p=sessionGrantPayload({chainId:43112n,sessionId:hexToBytes(h(0x51)),holderHash:hexToBytes(h(35)),sessionKeyThumbprint:ownThumb,binding:BINDING_HOLDER_KEY,
      action:'decrypt',seed:hexToBytes(h(9)),epoch:7n,slots:[{slotId:hexToBytes(slot),ruleHash:hexToBytes(h(33))}],iat:1000,exp:1030,idleTimeoutSecs:600,absoluteExp:4600,...change})
    const hash=sessionGrantHash(p)
    return encodeSessionGrant({payload:p,signatures:[0,1].map(i=>({verifierIndex:i,signature:ed25519.sign(hash,new Uint8Array(32).fill(i+1))}))})
  }
  return {session,transport,params,fragment,sessionKey,otherKey,ownThumb,payment,policy,members,jarIndex,reqHash,ctx,random,ro,done,grant,created:()=>created,slot,
    requestBody:()=>({operation:input.operation,operation_sig:operationSig,delegation:null,session:{response_uri:endpoint+'/v1/response?session='+sessionId,enc_jwk:keyJwk,state,random},
      epoch:7,seed:h(9),committee_count:2,registry_size:2,quorum:2,payment,...(grantMode?{session_key_thumbprint:toHex(ownThumb)}:{})})}
}

it('sends the session grant fragment inside the signed creation body, in the agent request shape',async()=>{
  const f=await fixture();await f.session.create()
  const body=f.created()!
  // Exactly the agent's SessionGrantRequestBody (deny_unknown_fields): slots canonical, the public key only.
  expect(body.session_grant).toEqual({session_key:f.sessionKey.jwk,slots:[...f.fragment.session_grant.slots].sort(),access_ttl_secs:30,idle_timeout_secs:600,absolute_ttl_secs:3600})
  expect(JSON.stringify(body.session_grant)).not.toMatch(/"d"/)
  // The client's initialization signature covers it: the agent verifies body_hash over the unsigned body.
  const {execution_initialization:proof,...unsigned}=body as {execution_initialization:{body_hash:string}}&Record<string,unknown>
  expect(proof.body_hash).toBe(executionBodyHash(unsigned))
  // The JAR signer is approved for a body that carries the thumbprint (the agent adds it for a session-mode JAR).
  const member=f.members[f.jarIndex]!
  await f.session.approveRequest({id:proposalId,stage:'presentation_sign',operator_key:member.publicKey,unsigned_body:f.requestBody(),expires:1030},'presentation_sign',member)
  const sent=vi.mocked(f.transport.paidAgentRequest).mock.calls.at(-1)!
  const authorization=JSON.parse(new TextDecoder().decode(sent[1].body)).authorization
  await verifyExecutionAuthorization({payment:f.payment,policy:f.policy,authorization,expected:{stage:'presentation_sign',operatorKey:member.publicKey,body:f.requestBody()}})
  // A proposal that drops the thumbprint is not the client-built intent.
  const {session_key_thumbprint:_dropped,...withoutThumbprint}=f.requestBody()
  await expect(f.session.approveRequest({id:proposalId,stage:'presentation_sign',operator_key:member.publicKey,unsigned_body:withoutThumbprint,expires:1030},'presentation_sign',member))
    .rejects.toThrow(/client-built intent/)
})

it('presents only for a nonce that binds THIS fresh session key (fails without the session-mode nonce)',async()=>{
  const f=await fixture();await f.session.create()
  const reply=(jwt:string)=>({status:200,body:new TextEncoder().encode(jwt)})
  const bound=vpSessionNonce(f.reqHash,hexToBytes(f.random),f.ctx,f.ownThumb)
  vi.mocked(f.transport.paidAgentRequest).mockResolvedValueOnce(reply(f.ro(bound)))
  expect((await f.session.requestObject()).request.claims.nonce).toBe(bound)
  // The plain nonce authorizes no session key: a wallet presenting for it would let the agent open
  // a session for a key the holder never signed for. Refused before anything is shown or disclosed.
  vi.mocked(f.transport.paidAgentRequest).mockResolvedValueOnce(reply(f.ro(derivedNonce(f.reqHash,hexToBytes(f.random),f.ctx))))
  await expect(f.session.requestObject()).rejects.toThrow(/Request Object changed/)
  // A nonce bound to ANOTHER session key is refused the same way.
  vi.mocked(f.transport.paidAgentRequest).mockResolvedValueOnce(reply(f.ro(vpSessionNonce(f.reqHash,hexToBytes(f.random),f.ctx,sessionKeyThumbprint(f.otherKey.jwk)))))
  await expect(f.session.requestObject()).rejects.toThrow(/Request Object changed/)
})

it('refuses an agent whose session binds another session key before any approval',async()=>{
  const other=await createSessionKey({alg:'Ed25519'})
  const f=await fixture({agentKey:other.jwk})
  await expect(f.session.create()).rejects.toThrow(/context differs/)
})

it('an ordinary paid session keeps the plain nonce and wire shape',async()=>{
  const f=await fixture({grant:false});await f.session.create()
  expect(f.created()).not.toHaveProperty('session_grant')
  vi.mocked(f.transport.paidAgentRequest).mockResolvedValueOnce({status:200,body:new TextEncoder().encode(f.ro(derivedNonce(f.reqHash,hexToBytes(f.random),f.ctx)))})
  await expect(f.session.requestObject()).resolves.toBeDefined()
  // A grant on a session that never asked for one is a protocol violation.
  vi.mocked(f.transport.paidAgentRequest).mockResolvedValueOnce(f.done({session_grant:f.grant(),refresh_seq:0}))
  await expect(f.session.poll()).rejects.toThrow(/cannot have/)
})

it('returns the completed grant only after it verifies for this chain, key, holder, draw and slot',async()=>{
  const f=await fixture();await f.session.create()
  vi.mocked(f.transport.paidAgentRequest).mockResolvedValueOnce(f.done({session_grant:f.grant(),refresh_seq:0}))
  const completed=await f.session.poll()
  expect(completed.sessionGrant).toEqual({grant:{session_grant:f.grant(),refresh_seq:0}})
  const bad=[{chainId:1n},{sessionKeyThumbprint:sessionKeyThumbprint(f.otherKey.jwk)},{holderHash:hexToBytes(h(36))},{epoch:8n},{seed:hexToBytes(h(0x99))},
    {slots:[{slotId:hexToBytes(f.slot),ruleHash:hexToBytes(h(0x44))}]},{slots:[{slotId:hexToBytes(h(0x0e)),ruleHash:hexToBytes(h(33))}]}]
  for(const change of bad){
    vi.mocked(f.transport.paidAgentRequest).mockResolvedValueOnce(f.done({session_grant:f.grant(change),refresh_seq:0}))
    expect((await f.session.poll()).sessionGrant).toEqual({error:'sdk_grant_invalid'})
  }
  vi.mocked(f.transport.paidAgentRequest).mockResolvedValueOnce(f.done({session_grant:f.grant(),refresh_seq:1}))
  expect((await f.session.poll()).sessionGrant).toEqual({error:'sdk_grant_invalid'})
  // The agent's typed reason travels; the token still authorizes its one operation.
  vi.mocked(f.transport.paidAgentRequest).mockResolvedValueOnce(f.done({session_grant_error:'session_token_scoped'}))
  const scoped=await f.session.poll()
  expect(scoped.sessionGrant).toEqual({error:'session_token_scoped'})
  expect(scoped.compoundToken).toBeDefined()
})

it('refuses a session grant on a non-decrypt operation or without the presentation slot, before any request',async()=>{
  await expect(fixture({action:'sign'})).rejects.toThrow(/KEM decrypt/)
  await expect(fixture({slots:[h(0x0f)]})).rejects.toThrow(/presentation slot/)
})
