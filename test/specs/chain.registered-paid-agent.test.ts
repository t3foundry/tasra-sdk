import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import {p256} from '@noble/curves/p256'
import {sha256} from '@noble/hashes/sha256'
import {concatBytes} from '@noble/hashes/utils'
import {concatHex, hexToBytes, keccak256, toHex, type Hex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {prepareRegisteredPaidSession, PaidAgentControlError, type ClientApprovedPresentation, type PaidAgentProposal} from '../../src/chain/registeredPaidAgent.js'
import {authenticateApprovedService} from '../../src/chain/serviceIdentity.js'
import {readClientExecutionPolicy, type PaidVerifierWitness} from '../../src/chain/prepaid.js'
import {createExecutionCertificate, createLocalExecutionSigner, executionBodyHash, verifyExecutionAuthorization} from '../../src/committee/execution.js'
import {paymentIntentHash, paymentIntentTypedData, paymentSessionCommitment, type PaymentIntentWire} from '../../src/committee/payment.js'
import {assembleCompoundToken, compoundTokenHash, selectVerifierCommittee, verifierLeaf, type CompoundTokenPayload} from '../../src/committee/token.js'
import {presentationOperationTypedData} from '../../src/oid4vp/verifier-agent.js'
import {derivedNonce, requestHash} from '../../src/oid4vp/binding.js'
import {b64url, decodeJson, signCompactJws} from '../../src/oid4vp/jose.js'
import {createDpopKey} from '../../src/auth/dpop.js'
import type {TasraChainClient} from '../../src/chain/client.js'
import type {ApprovedAgentProfile} from '../../src/chain/registeredAgent.js'
import type {PaidAgentTransport} from '../../src/chain/paidAgentTransport.js'
import type {ServiceRecord} from '../../src/chain/services.js'

// Policy reads have their own real ABI/RPC regressions in chain.paid-context.test.ts.
// These tests isolate orchestration while retaining genuine creator/client signatures.
vi.mock('../../src/chain/serviceIdentity.js',async original=>({...await original<typeof import('../../src/chain/serviceIdentity.js')>(),authenticateApprovedService:vi.fn()}))
vi.mock('../../src/chain/prepaid.js',async original=>({...await original<typeof import('../../src/chain/prepaid.js')>(),readClientExecutionPolicy:vi.fn()}))
const h=(n:number,len=32):Hex=>`0x${n.toString(16).padStart(2,'0').repeat(len)}`
const bytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value))
const owner='ab'.repeat(32), proposalId='cd'.repeat(32)
const cleanups:Array<()=>void>=[]
beforeEach(()=>{vi.spyOn(Date,'now').mockReturnValue(1_000_000);vi.mocked(authenticateApprovedService).mockReset();vi.mocked(readClientExecutionPolicy).mockReset()})
afterEach(()=>{cleanups.splice(0).forEach(cleanup=>cleanup());vi.restoreAllMocks();vi.useRealTimers()})

async function fixture(kind:'wallet'|'oauth'='wallet') {
  const creator=privateKeyToAccount(h(11)), signer=createLocalExecutionSigner(new Uint8Array(32).fill(21))
  cleanups.push(()=>signer.dispose())
  const sign=vi.fn(signer.sign), endpoint='https://agent.example'
  const profile:ApprovedAgentProfile={endpoint,clientId:'decentralized_identifier:did:web:agent.example',
    approval:{chainId:43112,registry:h(4,20),serviceId:h(5),serviceType:1,owner:creator.address,revision:1n,manifestHash:h(6)}}
  const record:ServiceRecord={owner:creator.address,pendingOwner:h(0,20),authKey:h(7,20),serviceType:1,status:0,revision:1n,
    manifestHash:h(6),endpoint}
  const chain={addresses:{ServiceRegistry:h(4,20)},client:{getChainId:vi.fn(async()=>43112),getBlockNumber:vi.fn(async()=>20n)},
    readers:{serviceRegistry:{getService:vi.fn(async()=>({...record}))}}} as unknown as TasraChainClient
  vi.mocked(authenticateApprovedService).mockResolvedValue({record:{...record},manifest:{capabilities:['oid4vp']}} as Awaited<ReturnType<typeof authenticateApprovedService>>)
  const keys=[1,2].map(n=>toHex(ed25519.getPublicKey(new Uint8Array(32).fill(n))))
  const operators=[h(31,20),h(32,20)]
  const leaves=keys.map((key,i)=>toHex(verifierLeaf(i,hexToBytes(operators[i]!),hexToBytes(key))))
  const root=keccak256(concatHex([...leaves].sort())), members:PaidVerifierWitness[]=keys.map((publicKey,index)=>({index,publicKey,operator:operators[index]!,proof:[leaves[1-index]!]}))
  const input=presentationOperationTypedData({chainId:43112,keyRegistry:h(2,20),slotId:h(3),action:'sign',message:new Uint8Array([1,2,3]),
    description:'Approve these exact bytes',nowSecs:1000,ttlSecs:60})
  const operationSig=await creator.signTypedData(input.typedData), random=h(12)
  const payment:PaymentIntentWire={chain_id:43112,settlement:h(1,20),key_registry:h(2,20),slot:h(3),action:'sign',payload_digest:toHex(input.payloadDigest),
    session_commitment:paymentSessionCommitment(random,profile.clientId,1060),nonce:h(10),max_cost:'10',expires:1060,
    verification_epoch:7,verification_seed:h(9),verification_root:root,verification_registry_size:2,verification_committee:2,verification_quorum:2,
    keeper_assignment:{key_epoch:1,committee_version:2,threshold:2,coordinator:Array<number>(32).fill(9),contributors:[9,10,11].map(n=>Array<number>(32).fill(n))},signature:h(1,65)}
  payment.signature=await creator.signTypedData(paymentIntentTypedData(payment))
  const policy={chainId:43112,settlement:h(1,20),keyRegistry:h(2,20),creator:creator.address,paymentHash:paymentIntentHash(payment),cost:9n,nowSecs:1000}
  vi.mocked(readClientExecutionPolicy).mockResolvedValue({blockNumber:20n,blockHash:h(20),blockTimestamp:1000n,policy})
  const certificate=await createExecutionCertificate({payment,policy,publicKey:signer.publicKey,expires:1050,creator})
  const params={operation:input.operation,operationSig,messageHex:input.messageHex,payment,random,...(kind==='oauth'?{kind}:{})}
  const deployment={chainId:43112,settlement:h(1,20),keyRegistry:h(2,20),verifierSet:h(8,20),beacon:h(13,20)}
  const pin={chainId:43112,registry:h(4,20),serviceId:h(5),serviceType:1,owner:creator.address.toLowerCase(),revision:'1',manifestHash:h(6),authKey:h(7,20),endpoint,clientId:profile.clientId}
  const reqHash=requestHash(43112,hexToBytes(h(3)),'sign',input.payloadDigest)
  const drawn=selectVerifierCommittee(hexToBytes(h(3)),7,hexToBytes(h(9)),2,2), jarIndex=drawn[9%drawn.length]!
  const nonce=derivedNonce(reqHash,hexToBytes(random),{epoch:7,snapshotRoot:hexToBytes(root),registrySize:2,committee:2,quorum:2,operationExp:1060})
  const state='ef'.repeat(32), keyPoint=p256.getPublicKey(new Uint8Array(32).fill(1),false)
  const key=kind==='wallet'?{kty:'EC',crv:'P-256',x:Buffer.from(keyPoint.slice(1,33)).toString('base64url'),y:Buffer.from(keyPoint.slice(33)).toString('base64url'),
    alg:'ECDH-ES',use:'enc',kid:'12'.repeat(16)}:null
  let sessionId='', context:Record<string,unknown>|undefined
  const transport:PaidAgentTransport={request:vi.fn(),paidAgentRequest:vi.fn(async(url,opts)=>{
    if(url===endpoint+'/v1/sessions') {
      const body=JSON.parse(new TextDecoder().decode(opts.body)) as Record<string,unknown>
      const initialization=body.execution_initialization
      const binding={chain_id:43112,slot_id:h(3),action:'sign',message_sha256:toHex(sha256(new Uint8Array([1,2,3]))),identity:null,
        payload_digest:payment.payload_digest,description:input.operation.description,operation:input.operation,operation_sig:operationSig,payment,delegation:null,random,
        request_hash:toHex(reqHash),nonce,epoch:7,seed:h(9),snapshot_root:root,committee_count:2,quorum:2,registry_size:2,drawn,jar_signer_index:jarIndex,
        client_id:profile.clientId,service_profile:pin,execution_initialization:initialization,execution_certificate:certificate,
        execution_policy:{chain_id:43112,settlement:h(1,20),key_registry:h(2,20),creator:creator.address.toLowerCase(),cost:toHex(9n,{size:32})}}
      context={binding_preimage:binding,state,enc_public_jwk:key,expires_at:1030}
      return {status:201,body:bytes({session_id:sessionId,poll_secret:owner,service_profile:pin,execution_context:context,
        request_uri:kind==='wallet'?endpoint+'/v1/request/'+sessionId:null,qr_payload:null,nonce:kind==='oauth'?nonce:null,
        dpop_htu:kind==='oauth'?endpoint+'/v1/sessions/'+sessionId+'/oauth-response':null,platform_audience:kind==='oauth'?endpoint+'/authz/43112':null})}
    }
    if(url===endpoint+'/v1/sessions/'+sessionId)return {status:200,body:bytes({status:'pending',phase:'awaiting_wallet',execution_context:context,binding_preimage:context?.binding_preimage})}
    return {status:204,body:new Uint8Array()}
  })}
  const prepare=(signal?:AbortSignal)=>prepareRegisteredPaidSession(chain,{profile,deployment,transport,members,ruleHash:h(33),dcqlQuery:{credentials:[{id:'all',format:'dc+sd-jwt'}]}},params,
    {certificate,signer:{publicKey:signer.publicKey,sign},pollSecret:owner,expires:1030,signal})
  const session=await prepare();sessionId=session.sessionId
  const requestBody={operation:input.operation,operation_sig:operationSig,delegation:null,
    session:{response_uri:endpoint+'/v1/response?session='+sessionId,enc_jwk:key,state,random},epoch:7,seed:h(9),committee_count:2,registry_size:2,quorum:2,payment}
  const proposal=(stage:'presentation_sign'|'presentation_attest'='presentation_sign'):PaidAgentProposal=>({id:proposalId,stage,
    operator_key:members[stage==='presentation_sign'?jarIndex:1-jarIndex]!.publicKey,unsigned_body:structuredClone(requestBody),expires:1030})
  const approved:ClientApprovedPresentation={holder:'did:example:holder',credentials:['one.compact.credential','two.compact.credential'],holder_proof:'holder.compact.proof',oauth:null,iat:1000}
  return {session,prepare,params,profile,record,chain,transport,policy,payment,certificate,signer,sign,members,jarIndex,proposal,approved,context:()=>context,nonce}
}

it('sends initialized creation once and recovers its original public context after a lost reply',async()=>{
  const f=await fixture(), send=vi.mocked(f.transport.paidAgentRequest), original=send.getMockImplementation()!
  send.mockImplementationOnce(async(url,options)=>{await original(url,options);throw new Error('lost original reply')})
  await expect(f.session.create()).rejects.toThrow('lost original reply')
  await expect(f.session.create()).rejects.toThrow(/already sent/)
  expect((await f.session.reconcile()).status).toBe('pending')
  const member=f.members[f.jarIndex]!
  await f.session.approveRequest(f.proposal(),'presentation_sign',member)
  const calls=send.mock.calls
  expect(calls.filter(([url])=>url===f.profile.endpoint+'/v1/sessions')).toHaveLength(1)
  expect(calls[0]![1].bearer).toBeUndefined()
  expect(calls[1]![1].bearer).toBe(owner)
  const approval=JSON.parse(new TextDecoder().decode(calls.at(-1)![1].body)) as {authorization:Parameters<typeof verifyExecutionAuthorization>[0]['authorization']}
  await verifyExecutionAuthorization({payment:f.payment,policy:f.policy,expected:{stage:'presentation_sign',operatorKey:member.publicKey,body:f.proposal().unsigned_body},authorization:approval.authorization})
  expect(vi.mocked(readClientExecutionPolicy).mock.calls.at(-1)?.[4]).toEqual(member)
  expect(JSON.stringify(approval)).not.toContain(owner)
  expect(JSON.stringify(approval)).not.toContain('private')
})

it('refuses changed public recovery state or substituted operation before client signing or operator delivery',async()=>{
  const f=await fixture();await f.session.create();f.sign.mockClear();vi.mocked(f.transport.paidAgentRequest).mockClear()
  for(const change of [{operation:{...f.params.operation,description:'attacker operation'}},{payment:{...f.payment,max_cost:'99'}},{extra:null}]){
    const proposed=f.proposal();proposed.unsigned_body={...proposed.unsigned_body,...change}
    await expect(f.session.approveRequest(proposed,'presentation_sign',f.members[f.jarIndex]!)).rejects.toThrow(/client-built intent/)
  }
  expect(f.sign).not.toHaveBeenCalled();expect(f.transport.paidAgentRequest).not.toHaveBeenCalled()
  await expect(f.session.approveRequest({...f.proposal(),expires:1031},'presentation_sign',f.members[f.jarIndex]!)).rejects.toThrow(/session expiry/)
  expect(f.sign).not.toHaveBeenCalled()
  const context=f.context()!;context.state='01'.repeat(32)
  await expect(f.session.reconcile()).rejects.toThrow(/context changed/)
})

it('requires the right JAR role and original member and does not resend an uncertain approval',async()=>{
  const f=await fixture();await f.session.create();f.sign.mockClear();vi.mocked(f.transport.paidAgentRequest).mockClear()
  await expect(f.session.approveRequest(f.proposal(),'presentation_sign',f.members[1-f.jarIndex]!)).rejects.toThrow(/signer/)
  await expect(f.session.approveRequest(f.proposal(),'presentation_sign',{...f.members[f.jarIndex]!,proof:[]})).rejects.toThrow(/witnesses/)
  expect(f.sign).not.toHaveBeenCalled()
  vi.mocked(f.transport.paidAgentRequest).mockResolvedValueOnce({status:503,body:bytes({error:'do not disclose credentials'})})
  await expect(f.session.approveRequest(f.proposal(),'presentation_sign',f.members[f.jarIndex]!)).rejects.toMatchObject({name:'PaidAgentControlError',httpStatus:503})
  expect(f.transport.paidAgentRequest).toHaveBeenCalledTimes(1)
})

it('rebuilds every client-accepted credential without copying the agent proposal into consent',async()=>{
  const f=await fixture();await f.session.create();f.sign.mockClear();vi.mocked(f.transport.paidAgentRequest).mockClear()
  const body={payment:f.payment,holder:f.approved.holder,credentials:f.approved.credentials,holder_proof:f.approved.holder_proof,token_type:'JWT',
    seed:f.payment.verification_seed,epoch:7,slot_id:f.payment.slot,registry_size:2,committee:2,quorum:2,iat:1000,exp:1030,
    chain_id:43112,action:'sign',payload_digest:f.payment.payload_digest,random:f.params.random,client_id:f.profile.clientId,
    description:f.params.operation.description,operation_exp:1060,operation_sig:f.params.operationSig}
  const proposed:PaidAgentProposal={id:proposalId,stage:'credential',operator_key:f.members[0]!.publicKey,unsigned_body:body,expires:1030}
  for(const credentials of [[f.approved.credentials[0]!],['attacker.compact.token',f.approved.credentials[1]!]]){
    await expect(f.session.approveCredentials({...proposed,unsigned_body:{...body,credentials}},f.members[0]!,f.approved)).rejects.toThrow(/client-built intent/)
  }
  expect(f.sign).not.toHaveBeenCalled();expect(f.transport.paidAgentRequest).not.toHaveBeenCalled()
  await f.session.approveCredentials(proposed,f.members[0]!,f.approved)
  const sent=vi.mocked(f.transport.paidAgentRequest).mock.calls[0]!
  const authorization=(JSON.parse(new TextDecoder().decode(sent[1].body)) as {authorization:Parameters<typeof verifyExecutionAuthorization>[0]['authorization']}).authorization
  expect(authorization.body_hash).toBe(executionBodyHash(body))
  await verifyExecutionAuthorization({payment:f.payment,policy:f.policy,expected:{stage:'credential',operatorKey:f.members[0]!.publicKey,body},authorization})
})

it('binds OAuth credential consent to the original session ID and refuses an omitted or substituted ID',async()=>{
  const f=await fixture('oauth');await f.session.create();const http=vi.spyOn(f.transport,'paidAgentRequest')
  const key=await createDpopKey(),token=signCompactJws({typ:'at+jwt'},{iss:'https://idp.example',sub:'holder',iat:1000,exp:1060,
    aud:f.session.oauthContext.platformAudience,cnf:{jkt:await key.thumbprint()}},{alg:'ES256',privateKey:new Uint8Array(32).fill(5)})
  const approved=await f.session.prepareOAuthPresentation(token,key.signer)
  const body={payment:f.payment,holder:'',credentials:[],oauth:approved.oauth,session_id:f.session.sessionId,token_type:'JWT',
    seed:f.payment.verification_seed,epoch:7,slot_id:f.payment.slot,registry_size:2,committee:2,quorum:2,iat:1000,exp:1030,
    chain_id:43112,action:'sign',payload_digest:f.payment.payload_digest,random:f.params.random,client_id:f.profile.clientId,
    description:f.params.operation.description,operation_exp:1060,operation_sig:f.params.operationSig}
  const proposal:PaidAgentProposal={id:proposalId,stage:'credential',operator_key:f.members[0]!.publicKey,unsigned_body:body,expires:1030}
  f.sign.mockClear();http.mockClear()
  const missing:Record<string,unknown>={...body};delete missing.session_id
  for(const unsigned_body of [missing,{...body,session_id:'another-session'}]){
    await expect(f.session.approveCredentials({...proposal,unsigned_body},f.members[0]!,approved)).rejects.toThrow(/client-built intent/)
  }
  expect(f.sign).not.toHaveBeenCalled();expect(http).not.toHaveBeenCalled()
  await f.session.approveCredentials(proposal,f.members[0]!,approved)
  const sent=http.mock.calls[0]!
  const {authorization}=JSON.parse(new TextDecoder().decode(sent[1].body)) as {authorization:Parameters<typeof verifyExecutionAuthorization>[0]['authorization']}
  await verifyExecutionAuthorization({payment:f.payment,policy:f.policy,expected:{stage:'credential',operatorKey:f.members[0]!.publicKey,body},authorization})
})

it('refuses legacy and different-session OAuth targets in the original creation reply',async()=>{
  for(const target of ['/v1/sessions/oauth-response','/v1/sessions/another-session/oauth-response']){
    const f=await fixture('oauth'),http=vi.spyOn(f.transport,'paidAgentRequest'),original=http.getMockImplementation()!
    http.mockImplementationOnce(async(...args)=>{
      const result=await original(...args),reply=JSON.parse(new TextDecoder().decode(result.body)) as Record<string,unknown>
      return {...result,body:bytes({...reply,dpop_htu:f.profile.endpoint+target})}
    })
    await expect(f.session.create()).rejects.toThrow(/nonce or audience/)
    expect(http).toHaveBeenCalledTimes(1)
  }
})

it('pins the provider before disclosing owner control and bounds ignored RPC cancellation',async()=>{
  const f=await fixture();await f.session.create();vi.mocked(f.transport.paidAgentRequest).mockClear()
  f.record.endpoint='https://attacker.example'
  await expect(f.session.poll()).rejects.toThrow(/provider changed/)
  expect(f.transport.paidAgentRequest).not.toHaveBeenCalled();f.record.endpoint=f.profile.endpoint
  let release:(id:number)=>void=()=>{}
  vi.mocked(f.chain.client.getChainId).mockImplementation(()=>new Promise<number>(resolve=>{release=resolve}))
  const controller=new AbortController(), pending=f.session.poll(controller.signal), refused=expect(pending).rejects.toThrow()
  controller.abort();await refused;release(43112);await Promise.resolve();await Promise.resolve()
  expect(f.transport.paidAgentRequest).not.toHaveBeenCalled()
})

it('does not sign or deliver an approval after cancellation while canonical policy was in flight',async()=>{
  const f=await fixture();await f.session.create();f.sign.mockClear();vi.mocked(f.transport.paidAgentRequest).mockClear()
  let release:(value:Awaited<ReturnType<typeof readClientExecutionPolicy>>)=>void=()=>{}
  vi.mocked(readClientExecutionPolicy).mockImplementation(()=>new Promise(resolve=>{release=resolve}))
  const controller=new AbortController(), pending=f.session.approveRequest(f.proposal(),'presentation_sign',f.members[f.jarIndex]!,controller.signal)
  const refused=expect(pending).rejects.toThrow();controller.abort();await refused
  release({blockNumber:20n,blockHash:h(20),blockTimestamp:1000n,policy:f.policy});await Promise.resolve();await Promise.resolve()
  expect(f.sign).not.toHaveBeenCalled();expect(f.transport.paidAgentRequest).not.toHaveBeenCalled()
})

it('preserves consent wait statuses without exposing error bodies or fetching a QR early',async()=>{
  const f=await fixture();await f.session.create()
  vi.mocked(f.transport.paidAgentRequest).mockResolvedValueOnce({status:425,body:bytes({error:'sensitive credential'})})
  const error:unknown=await f.session.requestObject().catch((error:unknown)=>error)
  expect(error).toBeInstanceOf(PaidAgentControlError);expect(error).toMatchObject({httpStatus:425,sessionId:f.session.sessionId})
  expect(String(error)).not.toContain('sensitive credential')
  expect(vi.mocked(f.transport.paidAgentRequest).mock.calls.at(-1)?.[1].bearer).toBeUndefined()
})

it('exposes a QR only after checking the anchored signer and all original signed request claims',async()=>{
  const f=await fixture();await f.session.create()
  const context=f.context()!, claims={iss:'did:web:agent.example',client_id:f.profile.clientId,response_type:'vp_token',response_mode:'direct_post.jwt',
    response_uri:f.profile.endpoint+'/v1/response?session='+f.session.sessionId,nonce:f.nonce,state:context.state,iat:1000,exp:1030,
    dcql_query:{credentials:[{id:'all',format:'dc+sd-jwt'}]},client_metadata:{jwks:{keys:[context.enc_public_jwk]}},
    transaction_data:[b64url(JSON.stringify({type:'keykeeper-op/v1',...f.params.operation}))]}
  const signed=(change:Record<string,unknown>={},key=f.jarIndex+1)=>signCompactJws({typ:'oauth-authz-req+jwt',kid:'did:web:agent.example#drawn'},
    {...claims,...change},{alg:'EdDSA',privateKey:new Uint8Array(32).fill(key)})
  const reply=(jwt:string)=>({status:200,body:new TextEncoder().encode(jwt)})
  vi.mocked(f.transport.paidAgentRequest).mockResolvedValueOnce(reply(signed()))
  const request=await f.session.requestObject()
  expect(request.qrPayload).toContain(encodeURIComponent(f.profile.clientId))
  expect(request.requestUri).toBe(f.profile.endpoint+'/v1/request/'+f.session.sessionId)
  for(const change of [{state:'00'.repeat(32)},{nonce:'wrong'},{response_uri:'https://attacker.example'},
    {dcql_query:{credentials:[]}},{client_metadata:{jwks:{keys:[]}}},{exp:1061},{iat:1001,exp:1000},
    {transaction_data:[b64url(JSON.stringify({type:'keykeeper-op/v1',...f.params.operation,description:'attacker'}))]}]){
    vi.mocked(f.transport.paidAgentRequest).mockResolvedValueOnce(reply(signed(change)))
    await expect(f.session.requestObject()).rejects.toThrow()
  }
  vi.mocked(f.transport.paidAgentRequest).mockResolvedValueOnce(reply(signed({},30)))
  await expect(f.session.requestObject()).rejects.toThrow(/signature|verify/)
})

it('matches retained callback identities to every original credential and never automatically resumes',async()=>{
  const f=await fixture();await f.session.create()
  const u64=(value:number)=>{const bytes=new Uint8Array(8);new DataView(bytes.buffer).setBigUint64(0,BigInt(value));return bytes}
  const callback=keccak256(concatBytes(new TextEncoder().encode('keykeeper/retained-presentation/v1'),u64(64),new TextEncoder().encode(f.session.sessionId),
    hexToBytes(executionBodyHash(f.approved as unknown as Record<string,unknown>)),u64(1030))).slice(2)
  const list={presentations:[{id:callback,presentation:f.approved,expires:1030,selected:false}]}
  vi.mocked(f.transport.paidAgentRequest).mockResolvedValueOnce({status:200,body:bytes(list)})
  expect(await f.session.presentations()).toEqual(list.presentations)
  const before=vi.mocked(f.transport.paidAgentRequest).mock.calls.length
  await expect(f.session.resumePresentation(callback,{...f.approved,credentials:[f.approved.credentials[0]!]})).rejects.toThrow(/client-accepted/)
  expect(vi.mocked(f.transport.paidAgentRequest).mock.calls.length).toBe(before)
  vi.mocked(f.transport.paidAgentRequest).mockResolvedValueOnce({status:425,body:bytes({error:'approval required'})})
  await expect(f.session.resumePresentation(callback,f.approved)).rejects.toMatchObject({httpStatus:425})
  expect(vi.mocked(f.transport.paidAgentRequest).mock.calls.length).toBe(before+1)
  const sent=vi.mocked(f.transport.paidAgentRequest).mock.calls.at(-1)!
  expect(sent[1].method).toBe('POST');expect(sent[1].body).toBeUndefined()
})

it('derives OAuth challenge and audience locally and retains a genuine DPoP presentation before its only submission',async()=>{
  const f=await fixture('oauth');await f.session.create()
  expect(f.session.oauthContext).toEqual({nonce:f.nonce,dpopHtu:f.profile.endpoint+'/v1/sessions/'+f.session.sessionId+'/oauth-response',platformAudience:f.profile.endpoint+'/authz/43112'})
  const key=await createDpopKey(), token=signCompactJws({typ:'at+jwt'},{iss:'https://idp.example',sub:'holder',iat:1000,exp:1060,
    aud:f.session.oauthContext.platformAudience,cnf:{jkt:await key.thumbprint()}},{alg:'ES256',privateKey:new Uint8Array(32).fill(5)})
  const approved=await f.session.prepareOAuthPresentation(token,key.signer)
  expect(approved).toMatchObject({holder:'',credentials:[],holder_proof:null,iat:1000,oauth:{access_token:token}})
  expect(decodeJson<Record<string,unknown>>(approved.oauth!.dpop_proof.split('.')[1]!)).toMatchObject({nonce:f.nonce,htm:'POST',htu:f.session.oauthContext.dpopHtu})
  vi.mocked(f.transport.paidAgentRequest).mockClear()
  vi.mocked(f.transport.paidAgentRequest).mockResolvedValueOnce({status:202,body:bytes({status:'awaiting_client_approval'})})
  await f.session.submitOAuthPresentation(approved)
  await expect(f.session.submitOAuthPresentation(approved)).rejects.toThrow(/already sent/)
  expect(f.transport.paidAgentRequest).toHaveBeenCalledTimes(1)
  const sent=vi.mocked(f.transport.paidAgentRequest).mock.calls[0]!
  expect(sent[0]).toBe(f.profile.endpoint+'/v1/sessions/'+f.session.sessionId+'/oauth-response')
  expect(sent[1]).toMatchObject({method:'POST',bearer:owner,oauth:{accessToken:token,proof:approved.oauth!.dpop_proof}})
  expect(sent[1].body).toBeUndefined()
})

it('refuses substituted OAuth nonce, audience, access-token hash or proof key before delivery',async()=>{
  const f=await fixture('oauth');await f.session.create()
  const key=await createDpopKey(), other=await createDpopKey(), mint=async(aud:string)=>signCompactJws({typ:'at+jwt'},
    {iat:1000,exp:1060,aud,cnf:{jkt:await key.thumbprint()}},{alg:'ES256',privateKey:new Uint8Array(32).fill(5)})
  const token=await mint(f.session.oauthContext.platformAudience), proof=vi.fn(key.signer.proof)
  await expect(f.session.prepareOAuthPresentation(await mint('https://attacker.example'),{proof})).rejects.toThrow(/audience/)
  expect(proof).not.toHaveBeenCalled()
  const approved=await f.session.prepareOAuthPresentation(token,key.signer)
  vi.mocked(f.transport.paidAgentRequest).mockClear()
  for(const change of [{nonce:'wrong'},{accessToken:token+'changed'},{htu:'https://attacker.example'}]){
    const forged=await key.signer.proof({htm:'POST',htu:f.session.oauthContext.dpopHtu,nonce:f.nonce,accessToken:token,...change})
    await expect(f.session.submitOAuthPresentation({...approved,oauth:{access_token:token,dpop_proof:forged}})).rejects.toThrow(/DPoP/)
  }
  const foreign=await other.signer.proof({htm:'POST',htu:f.session.oauthContext.dpopHtu,nonce:f.nonce,accessToken:token})
  await expect(f.session.submitOAuthPresentation({...approved,oauth:{access_token:token,dpop_proof:foreign}})).rejects.toThrow(/DPoP/)
  expect(f.transport.paidAgentRequest).not.toHaveBeenCalled()
})

it('requires genuine drawn quorum signatures and the original payment, rule and holder binding on a completed result',async()=>{
  const f=await fixture();await f.session.create()
  const payload:CompoundTokenPayload={tokenType:'JWT',seed:hexToBytes(f.payment.verification_seed),epoch:7,slotId:hexToBytes(f.payment.slot),
    vpHash:hexToBytes(h(34)),holderHash:hexToBytes(h(35)),ruleHash:hexToBytes(h(33)),
    requestHash:requestHash(43112,hexToBytes(f.payment.slot),'sign',hexToBytes(f.payment.payload_digest)),
    paymentHash:hexToBytes(paymentIntentHash(f.payment)),payment:f.payment,binding:1,
    verifierIndexes:selectVerifierCommittee(hexToBytes(f.payment.slot),7,hexToBytes(f.payment.verification_seed),2,2),iat:1000,exp:1030}
  const signed=(change:Partial<CompoundTokenPayload>={},signers=[0,1])=>{
    const token={...payload,...change},hash=compoundTokenHash(token)
    return assembleCompoundToken(token,signers.map(verifierIndex=>({verifierIndex,signature:ed25519.sign(hash,new Uint8Array(32).fill(verifierIndex+1))})))
  }
  const reply=(compound_token:unknown)=>({status:200,body:bytes({status:'done',phase:'done',compound_token,
    verifier_proofs:[{verifier_index:999,pubkey:'untrusted agent key'}]})})
  vi.mocked(f.transport.paidAgentRequest).mockResolvedValueOnce(reply(signed({payment:undefined})))
  const completed=await f.session.poll()
  expect(completed.status).toBe('done')
  expect(completed.compoundToken?.payment).toEqual(f.payment)
  expect(completed.verifierProofs).toEqual(payload.verifierIndexes.map(index=>{
    const member=f.members[index]!
    return {verifier_index:index,operator:member.operator.slice(2),pubkey:member.publicKey.slice(2),proof:member.proof.map(p=>p.slice(2))}
  }))
  for(const change of [{ruleHash:hexToBytes(h(99))},{seed:hexToBytes(h(99))},{binding:0},{identityHash:hexToBytes(h(99))},
    {requestHash:hexToBytes(h(99))},{payment:undefined,paymentHash:undefined},{exp:1031},{iat:999,exp:1000}]){
    vi.mocked(f.transport.paidAgentRequest).mockResolvedValueOnce(reply(signed(change)))
    await expect(f.session.poll()).rejects.toThrow()
  }
  vi.mocked(f.transport.paidAgentRequest).mockResolvedValueOnce(reply(signed({},[0])))
  await expect(f.session.poll()).rejects.toThrow(/quorum/)
  const forged=signed();forged.signatures[0]!.signature=h(99,64)
  vi.mocked(f.transport.paidAgentRequest).mockResolvedValueOnce(reply(forged))
  await expect(f.session.poll()).rejects.toThrow(/signature/)
})

it('reads bounded owner proposals without signing and explicitly refuses an unwanted proposal once',async()=>{
  const f=await fixture();await f.session.create();f.sign.mockClear()
  const send=vi.mocked(f.transport.paidAgentRequest);send.mockClear()
  const proposed=f.proposal('presentation_attest')
  send.mockResolvedValueOnce({status:200,body:bytes({proposals:[proposed]})})
  expect(await f.session.proposals()).toEqual([proposed])
  expect(send.mock.calls[0]).toEqual([f.profile.endpoint+'/v1/sessions/'+f.session.sessionId+'/execution',expect.objectContaining({method:'GET',bearer:owner})])
  expect(f.sign).not.toHaveBeenCalled()
  for(const proposals of [null,Array(257).fill(proposed),[{...proposed,extra:'untrusted'}],
    [{...proposed,id:'invalid'}],[{...proposed,unsigned_body:[]}]] ){
    send.mockResolvedValueOnce({status:200,body:bytes({proposals})})
    await expect(f.session.proposals()).rejects.toThrow()
  }
  const before=send.mock.calls.length
  await expect(f.session.rejectProposal('invalid')).rejects.toThrow(/correlation/)
  expect(send.mock.calls.length).toBe(before)
  await f.session.rejectProposal(proposed.id)
  expect(send.mock.calls.at(-1)).toEqual([f.profile.endpoint+'/v1/sessions/'+f.session.sessionId+'/execution/'+proposed.id+'/reject',expect.objectContaining({method:'POST',bearer:owner,body:undefined})])
  expect(f.sign).not.toHaveBeenCalled()
})

it('signs an attester approval for its own role and refuses a response body after a single dispatch',async()=>{
  const f=await fixture();await f.session.create();f.sign.mockClear()
  const send=vi.mocked(f.transport.paidAgentRequest);send.mockClear()
  const proposed=f.proposal('presentation_attest'), member=f.members[1-f.jarIndex]!
  send.mockResolvedValueOnce({status:204,body:bytes({untrusted:'response'})})
  await expect(f.session.approveRequest(proposed,'presentation_attest',member)).rejects.toThrow(/unexpectedly contains a body/)
  expect(send).toHaveBeenCalledTimes(1)
  const {authorization}=JSON.parse(new TextDecoder().decode(send.mock.calls[0]![1].body)) as {authorization:Parameters<typeof verifyExecutionAuthorization>[0]['authorization']}
  await verifyExecutionAuthorization({payment:f.payment,policy:f.policy,authorization,expected:{stage:'presentation_attest',operatorKey:member.publicKey,body:proposed.unsigned_body}})
})

it('bounds and validates public recovery replies and aborts an unresponsive provider at its deadline',async()=>{
  const f=await fixture();await f.session.create()
  const send=vi.mocked(f.transport.paidAgentRequest)
  for(const body of [new Uint8Array([255]),bytes([]),new Uint8Array(10*1024*1024+1)]){
    send.mockResolvedValueOnce({status:200,body})
    await expect(f.session.poll()).rejects.toThrow(/reply JSON|exceeds bound/)
  }
  send.mockImplementationOnce(async()=>new Promise(()=>{}))
  vi.useFakeTimers()
  const pending=f.session.poll(), refused=expect(pending).rejects.toThrow(/timed out/)
  await vi.advanceTimersByTimeAsync(60_000)
  await refused
  expect(send.mock.calls.at(-1)?.[1].signal.aborted).toBe(true)
})

it('refuses malformed encryption coordinates in recovered wallet context before exposing a request',async()=>{
  const f=await fixture();await f.session.create()
  const context=f.context()!, key=structuredClone(context.enc_public_jwk) as Record<string,unknown>
  for(const change of [{kid:'invalid'},{x:7},{x:'A'.repeat(42)+'B'}]){
    context.enc_public_jwk={...key,...change}
    await expect(f.session.poll()).rejects.toThrow(/encryption|coordinate/)
  }
  context.enc_public_jwk=key
  expect((await f.session.poll()).status).toBe('pending')
})

it('refuses empty, malformed or wrong-kind presentations before local signing or owner delivery',async()=>{
  const f=await fixture();await f.session.create();f.sign.mockClear()
  const send=vi.mocked(f.transport.paidAgentRequest);send.mockClear()
  for(const approved of [{...f.approved,credentials:[]},{...f.approved,holder:3},
    {...f.approved,credentials:['invalid credential']},{...f.approved,iat:-1},
    {...f.approved,oauth:{access_token:'',dpop_proof:'empty'},credentials:[]}]){
    await expect(f.session.approveCredentials(f.proposal(),f.members[0]!,approved as ClientApprovedPresentation)).rejects.toThrow(/presentation/)
  }
  expect(f.sign).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled()
  expect(()=>f.session.oauthContext).toThrow(/no OAuth/)
  expect(()=>f.session.prepareOAuthPresentation('unused',{proof:vi.fn()})).toThrow(/cannot submit OAuth/)
  const oauth=await fixture('oauth');await oauth.session.create()
  await expect(oauth.session.requestObject()).rejects.toThrow(/no wallet request/)
  await expect(oauth.session.approveCredentials(oauth.proposal(),oauth.members[0]!,oauth.approved)).rejects.toThrow(/kind differs/)
})
