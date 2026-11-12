import {createDecryptionRecipient,kemContentDigest,recipientPayloadDigest} from '../../src/crypto/recipient.js'
import {collectSealedPartials} from '../../src/decryption/sealed.js'
import {requestHash} from '../../src/oid4vp/binding.js'
import {hexToBytes} from '../../src/crypto/hex.js'
import {afterEach,describe,expect,it,vi} from 'vitest'
import {sha256} from '@noble/hashes/sha256'
import {toHex} from 'viem'
import {committeeSign,committeeDecrypt,requestIbeExtractionPartials} from '../../src/committee/client.js'
import {committeeSignEoaDigest} from '../../src/committee/ecdsa.js'
import {createDualSignClient,OperationOutcomeUnknownError} from '../../src/committee/dual-sign.js'
import {executionBodyHash,verifyExecutionAuthorization,type ExecutionAuthorization} from '../../src/committee/execution.js'
import {requireKeeperExecutionPayload,withKeeperExecutionApprovals,type KeeperExecutionKind,type KeeperExecutionApprover} from '../../src/committee/keeperExecution.js'
import {paymentIntentHash} from '../../src/committee/payment.js'
import type {CompoundTokenWire} from '../../src/committee/token.js'
import {decryptPayloadDigest} from '../../src/oid4vp/binding.js'
import {keeperExecutionFixture} from '../support/keeperExecution.js'

const message=Uint8Array.of(1,2,3),digest=new Uint8Array(32).fill(7),identity='client-selected identity'
const ciphertext={u:Uint8Array.of(8,9),nonce:new Uint8Array(12).fill(10),aeadCt:Uint8Array.of(11,12)}
const routes:KeeperExecutionKind[]=['committee-sign','committee-eoa-digest','sealed-decrypt','ibe-extract','dual-sign']
afterEach(()=>vi.restoreAllMocks())
async function operation(kind:KeeperExecutionKind){
  const recipient=await createDecryptionRecipient(),sealedOptions={recipient,chainId:43112,ciphertextEpoch:1,verifyingShares:new Map([[1,new Uint8Array(144)]])}
  const action=kind==='committee-decrypt'||kind==='sealed-decrypt'?'decrypt':kind==='committee-eoa-digest'?'eoa-sign':kind==='ibe-extract'?'ibe-extract':'sign'
  const payload=kind==='sealed-decrypt'?recipientPayloadDigest(kemContentDigest(ciphertext,new TextEncoder().encode(identity)),1,recipient.recipient)
    :kind==='ibe-extract'?recipientPayloadDigest(sha256(new TextEncoder().encode(identity)),1,recipient.recipient)
    :kind==='committee-decrypt'?decryptPayloadDigest(ciphertext.u,ciphertext.aeadCt):sha256(kind==='committee-eoa-digest'?digest:message)
  const f=await keeperExecutionFixture(action,toHex(payload))
  // This fixture isolates the client approval boundary; verifier grant validation has separate tests.
  const token={slot_id:f.payment.slot,payment:f.payment,payment_hash:paymentIntentHash(f.payment)} as CompoundTokenWire
  if(kind==='sealed-decrypt'||kind==='ibe-extract')token.request_hash=toHex(requestHash(43112,hexToBytes(f.payment.slot),kind==='sealed-decrypt'?'decrypt':'ibe-extract',payload))
  const fetchImpl=vi.fn<typeof fetch>(async()=>new Response('work not performed by this transport fixture',{status:503}))
  const send=(approveExecution:KeeperExecutionApprover|undefined,signal?:AbortSignal)=>{
    const opts={nodeUrl:'https://keeper.example',committeeToken:token,fetchImpl,approveExecution,signal}
    switch(kind){
      case 'committee-sign':return committeeSign({...opts,message,signingSet:[1,2],targetKeykeeper:'0x'+'31'.repeat(20)})
      case 'committee-eoa-digest':return committeeSignEoaDigest({...opts,digest})
      case 'committee-decrypt':return committeeDecrypt({...opts,ciphertext,identity:new TextEncoder().encode(identity),
        decryptingSet:[1,2],blsPeers:[{id:1,peerId:'first'},{id:2,peerId:'second'}],ciphertextEpoch:1})
      case 'sealed-decrypt':return collectSealedPartials({...opts,...sealedOptions,nodeUrls:[opts.nodeUrl],threshold:1},'decrypt',new TextEncoder().encode(identity),ciphertext)
      case 'ibe-extract':return requestIbeExtractionPartials({...opts,...sealedOptions,nodeUrls:[opts.nodeUrl],identity,ciphertextEpoch:1})
      case 'dual-sign':return createDualSignClient({chainId:43112,nodeUrl:opts.nodeUrl,slotId:f.payment.slot,
        groupPublicKey:new Uint8Array(32).fill(13),quorum:2,credentialGated:false,payment:f.payment,fetchImpl,approveExecution}).create(message,{signal})
      default:throw new Error('Unknown test route')
    }
  }
  return {...f,token,fetchImpl,send,sealedOptions}
}

describe('client approvals on outgoing keeper requests',()=>{
  it.each(routes)('sends independently verifiable complete-body approvals on %s',async kind=>{
    const f=await operation(kind)
    try{
      await expect(f.send(f.approveExecution)).rejects.toThrow()
      expect(f.fetchImpl).toHaveBeenCalledTimes(1)
      const [url,init]=f.fetchImpl.mock.calls[0]!
      const sent=JSON.parse(String(init?.body)) as Record<string,unknown>&{execution_authorizations:ExecutionAuthorization[]}
      const {execution_authorizations:proofs,...body}=sent
      expect(String(url)).toContain(kind==='dual-sign'?'/v1/dual-sign':kind==='ibe-extract'?'/v1/shards/ibe/extract':
        kind==='committee-eoa-digest'?'/v1/committee/sign/eoa-digest':kind==='sealed-decrypt'?'/v1/committee/decrypt/partial':kind==='committee-decrypt'?'/v1/committee/decrypt':'/v1/committee/sign')
      expect(init?.redirect).toBe('error');expect(init?.credentials).toBe('omit')
      expect(proofs).toHaveLength(kind==='ibe-extract'||kind==='sealed-decrypt'?1:3)
      for(const authorization of proofs){
        expect(authorization.body_hash).toBe(executionBodyHash(body))
        await expect(verifyExecutionAuthorization({payment:f.payment,policy:f.policy,authorization,
          expected:{stage:authorization.stage,operatorKey:authorization.operator_key,body}})).resolves.toBeUndefined()
      }
      expect(body).not.toHaveProperty('execution_authorizations')
      if(kind==='committee-decrypt')expect(body).toMatchObject({ciphertext_epoch:1,decrypting_set:[1,2],
        bls_peers:[{id:1,peer_id:'first'},{id:2,peer_id:'second'}],identity})
    }finally{f.signer.dispose()}
  })
  it.each(routes)('refuses missing client approval before sending %s',async kind=>{
    const f=await operation(kind)
    try{
      await expect(f.send(undefined)).rejects.toThrow('client execution approval')
      expect(f.fetchImpl).not.toHaveBeenCalled()
      const body={committee_token:f.token,message_hex:'010203'}
      await expect(withKeeperExecutionApprovals({body,kind:'committee-sign',nodeUrl:'https://keeper.example',payment:f.payment})).rejects.toThrow('client execution approval')
    }finally{f.signer.dispose()}
  })
  it.each(['missing','duplicate','wrong-role','wrong-body','wrong-worker','wrong-signature','wrong-certificate','wrong-policy'] as const)(
    'refuses %s approvals before a paid HTTP attempt',async change=>{
      const f=await operation('committee-sign')
      try{
        await expect(f.send(async request=>{
          const result=await f.approveExecution(request),proof=result.authorizations[0]!
          if(change==='missing')result.authorizations.pop()
          if(change==='duplicate')result.authorizations.push(structuredClone(proof))
          if(change==='wrong-role')proof.stage='credential'
          if(change==='wrong-body')proof.body_hash=toHex(new Uint8Array(32).fill(99))
          if(change==='wrong-worker')proof.operator_key=f.keys[1]!
          if(change==='wrong-signature')proof.signature=toHex(new Uint8Array(64))
          if(change==='wrong-certificate')proof.certificate.expires++
          if(change==='wrong-policy')result.policy={...result.policy,creator:'0x'+'99'.repeat(20) as `0x${string}`}
          return result
        })).rejects.toThrow()
        expect(f.fetchImpl).not.toHaveBeenCalled()
      }finally{f.signer.dispose()}
    })
  it('retains the original body and payment while the approval callback mutates caller inputs',async()=>{
    const f=await operation('committee-sign'),original=structuredClone(f.payment)
    try{
      await expect(f.send(async request=>{
        const result=await f.approveExecution(request)
        f.payment.max_cost='99';f.token.slot_id=toHex(new Uint8Array(32).fill(99))
        request.body.message_hex='different unapproved message';request.payment.max_cost='88'
        return result
      })).rejects.toThrow()
      expect(f.fetchImpl).toHaveBeenCalledTimes(1)
      const body=JSON.parse(String(f.fetchImpl.mock.calls[0]![1]?.body)) as {committee_token:CompoundTokenWire;message_hex:string}
      expect(body.committee_token.payment).toEqual(original);expect(body.message_hex).toBe('010203')
    }finally{f.signer.dispose()}
  })
  it('refuses changed payloads before signing and cancellation after signing before dispatch',async()=>{
    const f=await operation('committee-sign'),approve=vi.fn(f.approveExecution),abort=new AbortController()
    try{
      const body={committee_token:f.token,message_hex:'ff'}
      await expect(withKeeperExecutionApprovals({body,kind:'committee-sign',nodeUrl:'https://keeper.example',payment:f.payment,approveExecution:approve})).rejects.toThrow('payload differs')
      expect(approve).not.toHaveBeenCalled()
      await expect(f.send(async request=>{const result=await f.approveExecution(request);abort.abort(new Error('cancelled'));return result},abort.signal)).rejects.toThrow('cancelled')
      expect(f.fetchImpl).not.toHaveBeenCalled()
    }finally{f.signer.dispose()}
  })
  it('keeps a local dual approval failure distinct from unknown network delivery',async()=>{
    const f=await operation('dual-sign')
    try{
      const failure=await f.send(async()=>{throw new Error('local signing refused')}).catch((error:unknown)=>error)
      expect(failure).not.toBeInstanceOf(OperationOutcomeUnknownError)
      expect(f.fetchImpl).not.toHaveBeenCalled()
      await expect(f.send(f.approveExecution)).rejects.toBeInstanceOf(OperationOutcomeUnknownError)
      expect(f.fetchImpl).toHaveBeenCalledTimes(1)
    }finally{f.signer.dispose()}
  })

  it('an extraction deadline never dispatches an approval that finishes late',async()=>{
    const f=await operation('ibe-extract')
    let release!:()=>void,asked!:()=>void,finished!:()=>void
    const delayed=new Promise<void>(resolve=>{release=resolve})
    const ready=new Promise<void>(resolve=>{asked=resolve})
    const complete=new Promise<void>(resolve=>{finished=resolve})
    try{
      const running=requestIbeExtractionPartials({...f.sealedOptions,nodeUrls:['https://keeper.example'],committeeToken:f.token,
        identity,ciphertextEpoch:1,timeoutMs:20,fetchImpl:f.fetchImpl,approveExecution:async request=>{
          asked();await delayed
          try{return await f.approveExecution(request)}finally{finished()}
        }})
      const rejected=expect(running).rejects.toThrow('deadline exceeded')
      await ready;await rejected
      expect(f.fetchImpl).not.toHaveBeenCalled()
      release();await complete
      await new Promise<void>(resolve=>{setTimeout(resolve,0)})
      expect(f.fetchImpl).not.toHaveBeenCalled()
    }finally{release();f.signer.dispose()}
  })
})

describe('the client-built keeper body is checked against the retained payment before any approval is signed',()=>{
  const signDigest=toHex(sha256(message))
  async function signCase(){
    const f=await keeperExecutionFixture('sign',signDigest)
    const token={slot_id:f.payment.slot,payment:f.payment,payment_hash:paymentIntentHash(f.payment)} as unknown as Record<string,unknown>
    return {f,check:(kind:KeeperExecutionKind,body:Record<string,unknown>,payment=f.payment)=>()=>requireKeeperExecutionPayload({kind,body,payment,nodeUrl:'https://keeper.example'}),token}
  }
  it('accepts the exact signed body, and refuses an envelope, a malformed message and a body without its grant',async()=>{
    const {f,check,token}=await signCase()
    try{
      expect(check('committee-sign',{committee_token:token,message_hex:'010203'})).not.toThrow()
      expect(check('committee-sign',{committee_token:token,message_hex:'010203',execution_authorizations:[]})).toThrow('Keeper approval body must exclude its envelope')
      expect(check('committee-sign',{committee_token:token,message_hex:'zz'})).toThrow('Invalid client-built message')
      expect(check('committee-sign',{committee_token:token,message_hex:7})).toThrow('Invalid client-built message')
      expect(check('committee-sign',{message_hex:'010203'})).toThrow('Missing client-built keeper grant')
      expect(check('committee-sign',{committee_token:[token],message_hex:'010203'})).toThrow('Missing client-built keeper grant')
      expect(check('committee-sign',{committee_token:{...token,slot_id:'0x'+'44'.repeat(32)},message_hex:'010203'})).toThrow('Client-built keeper grant differs from retained payment')
      expect(check('committee-sign',{committee_token:token,message_hex:'010204'})).toThrow('Client-built keeper payload differs from retained payment')
      expect(check('no-such-route' as KeeperExecutionKind,{committee_token:token})).toThrow('Unknown keeper execution route')
    }finally{f.signer.dispose()}
  })
  it('a dual Sign carries the payment for exactly this slot',async()=>{
    const {f,check}=await signCase()
    try{
      expect(check('dual-sign',{payment:f.payment,key_slot_id:f.payment.slot,message_hex:'010203'})).not.toThrow()
      expect(check('dual-sign',{payment:f.payment,key_slot_id:'0x'+'44'.repeat(32),message_hex:'010203'})).toThrow('Client-built dual request differs from retained payment')
      expect(check('dual-sign',{payment:f.payment,message_hex:'010203'})).toThrow('Client-built dual request differs from retained payment')
    }finally{f.signer.dispose()}
  })
  it('an ECDSA digest is exactly 32 bytes',async()=>{
    const f=await keeperExecutionFixture('eoa-sign',toHex(sha256(new Uint8Array(31).fill(7))))
    try{
      expect(()=>requireKeeperExecutionPayload({kind:'committee-eoa-digest',body:{digest:'07'.repeat(31)},payment:f.payment,nodeUrl:'https://keeper.example'}))
        .toThrow('Client-built ECDSA digest must contain 32 bytes')
    }finally{f.signer.dispose()}
  })
  it('decrypt and sealed bodies refuse a missing or mistyped ciphertext, identity or recipient',async()=>{
    const f=await keeperExecutionFixture('decrypt',toHex(new Uint8Array(32).fill(1)))
    const check=(kind:KeeperExecutionKind,body:Record<string,unknown>)=>()=>requireKeeperExecutionPayload({kind,body,payment:f.payment,nodeUrl:'https://keeper.example'})
    const ct={u:'CAk',nonce:'CgoKCgoKCgoKCgoK',aead_ct:'Cww'}
    try{
      expect(check('committee-decrypt',{})).toThrow('Invalid client-built ciphertext')
      expect(check('committee-decrypt',{ciphertext:[ct]})).toThrow('Invalid client-built ciphertext')
      expect(check('committee-decrypt',{ciphertext:{...ct,nonce:1}})).toThrow('Invalid client-built ciphertext bytes')
      expect(check('sealed-decrypt',{ciphertext:ct})).toThrow('Invalid client-built sealed ciphertext')
      expect(check('session-decrypt',{ciphertext:{...ct,u:null},identity:'x'})).toThrow('Invalid sealed ciphertext bytes')
      expect(check('sealed-decrypt',{ciphertext:ct,identity:'x',ciphertext_epoch:1})).toThrow('Recipient and epoch required for sealed keeper approval')
      expect(check('sealed-decrypt',{ciphertext:ct,identity:'x',recipient:{suite:'x',public_key:'y'}})).toThrow('Recipient and epoch required for sealed keeper approval')
      expect(check('sealed-decrypt',{ciphertext:ct,identity:'x',ciphertext_epoch:1,recipient:{suite:1,public_key:'y'}})).toThrow('Invalid sealed recipient')
    }finally{f.signer.dispose()}
  })
  it('an IBE extraction needs a string identity',async()=>{
    const f=await keeperExecutionFixture('ibe-extract',toHex(new Uint8Array(32).fill(1)))
    try{
      expect(()=>requireKeeperExecutionPayload({kind:'ibe-extract',body:{identity:7},payment:f.payment,nodeUrl:'https://keeper.example'})).toThrow('Invalid client-built IBE identity')
    }finally{f.signer.dispose()}
  })
  it('unpaid work is never approved, and a paid request with no proofs is refused before sending',async()=>{
    const {f,token}=await signCase()
    try{
      const approver=vi.fn(f.approveExecution)
      const body={committee_token:token,message_hex:'010203'}
      await expect(withKeeperExecutionApprovals({body,kind:'committee-sign',nodeUrl:'https://keeper.example',approveExecution:approver}))
        .rejects.toThrow('Keeper execution approvals require the retained paid intent')
      expect(approver).not.toHaveBeenCalled()
      const unpaid=await withKeeperExecutionApprovals({body,kind:'committee-sign',nodeUrl:'https://keeper.example'})
      expect(unpaid).toEqual(body); expect(unpaid).not.toBe(body)
      await expect(withKeeperExecutionApprovals({body,kind:'committee-sign',nodeUrl:'https://keeper.example',payment:f.payment,
        approveExecution:async()=>({policy:f.policy,authorizations:[]})})).rejects.toThrow('Invalid keeper client approval count')
    }finally{f.signer.dispose()}
  })
})
