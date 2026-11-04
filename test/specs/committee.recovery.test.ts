import {describe,expect,it,vi} from 'vitest'
import {ed25519} from '@noble/curves/ed25519'
import {toHex} from 'viem'
import {privateKeyToAccount} from 'viem/accounts'
import {executionConsentBinding,executionApprovalTypedData,verifyExecutionConsent,verifyExecutionAuthorization} from '../../src/committee/execution.js'
import {paymentIntentTypedData} from '../../src/committee/payment.js'
import {createExecutionRecoveryAuthorization,executionRecoverySigningHash,paidExecutionReportSigningHash,
  verifyPaidExecutionEvidence,verifyRecoveredExecutionResult} from '../../src/committee/recovery.js'
import {parseExecutionJson} from '../../src/committee/recoveryJson.js'
import {executionRecoveryFixture,hex,wireBytes} from '../support/executionRecovery.js'

describe('authenticated completed-result recovery',()=>{
  it('matches separately packed Rust wire domains hashed with cast keccak',async()=>{
    const f=await executionRecoveryFixture('credential')
    expect(executionConsentBinding(f.payment,f.execution.consent,hex(62))).toBe('0x9e9d9c812f41b92b0a76bd896c37fb587ed4a006bc262164a6ec29d363a3ed8e')
    const report=structuredClone(f.execution.report);report.outcome.succeeded.result_commitment=Array<number>(32).fill(63)
    expect(paidExecutionReportSigningHash(f.payment,report)).toBe('0x6d9f18e1ac27229ba1c089bc6a4b315e12634e3af0a767df73e39fdf29d6ad11')
    expect(executionRecoverySigningHash(f.payment,{stage:f.target.stage,operator_key:f.operatorKey,
      execution_binding:toHex(Uint8Array.from(report.binding)),issued_at:2000,nonce:hex(64)})).toBe('0xfc904c6a1d2f710962e9b0cb15fc8f2e9cfed829d3fde14bf1f707c62614b46a')
    f.signer.dispose()
  })
  it('reads earned results after work expiry while the same expired proof cannot admit fresh work',async()=>{
    const f=await executionRecoveryFixture(), options={...f,execution:f.execution,target:f.target}
    await expect(verifyPaidExecutionEvidence(options)).resolves.toBeUndefined()
    const authorization=await createExecutionRecoveryAuthorization({...options,nowSecs:2000,nonce:hex(64)})
    expect(authorization).toMatchObject({stage:'coordinator',operator_key:f.operatorKey,issued_at:2000,nonce:hex(64)})
    expect(ed25519.verify(Buffer.from(authorization.signature.slice(2),'hex'),
      Buffer.from(executionRecoverySigningHash(f.payment,authorization).slice(2),'hex'),f.signer.publicKey,{zip215:false})).toBe(true)
    await expect(verifyRecoveredExecutionResult({...options,expectedExecution:f.execution,reply:f.reply()})).resolves.toBe(f.resultJson)
    await expect(verifyExecutionAuthorization({payment:f.payment,policy:{...f.policy,nowSecs:2000},
      expected:{stage:'coordinator',operatorKey:f.operatorKey,body:{message:'locally approved message',payment:f.payment,compound_token:'private holder authorization'}},
      authorization:f.execution.consent.authorization})).rejects.toThrow()
    expect(JSON.stringify(authorization)).not.toContain('private holder')
    f.signer.dispose()
  })
  it('refuses altered report fields and client consent before asking the local signer',async()=>{
    const f=await executionRecoveryFixture(), sign=vi.fn(f.signer.sign)
    const changes=[(e:typeof f.execution)=>{e.report.stage='contributor'},
      (e:typeof f.execution)=>{e.report.cost[31]=8},(e:typeof f.execution)=>{e.report.binding[0]=e.report.binding[0]!^1},
      (e:typeof f.execution)=>{e.report.reservation_block[0]=e.report.reservation_block[0]!^1},(e:typeof f.execution)=>{e.report.request.chain_id=43113},
      (e:typeof f.execution)=>{e.report.request.action=1},(e:typeof f.execution)=>{e.report.request.slot[0]=e.report.request.slot[0]!^1},
      (e:typeof f.execution)=>{e.report.request.payload_digest[0]=e.report.request.payload_digest[0]!^1},(e:typeof f.execution)=>{e.report.request.authorization_commitment[0]=e.report.request.authorization_commitment[0]!^1},
      (e:typeof f.execution)=>{e.report.request.settlement[0]=e.report.request.settlement[0]!^1},(e:typeof f.execution)=>{e.report.operator_key[0]=e.report.operator_key[0]!^1},
      (e:typeof f.execution)=>{e.report.outcome.succeeded.result_commitment[0]=e.report.outcome.succeeded.result_commitment[0]!^1},
      (e:typeof f.execution)=>{e.signature=hex(0,64)},(e:typeof f.execution)=>{e.consent.inputs_commitment[0]=e.consent.inputs_commitment[0]!^1},
      (e:typeof f.execution)=>{e.consent.verified_at++},(e:typeof f.execution)=>{e.consent.authorization.signature=hex(0,64)},
      (e:typeof f.execution)=>{e.consent.authorization.certificate.creator_signature=hex(0,65)}]
    for(const mutate of changes){const execution=structuredClone(f.execution);mutate(execution)
      await expect(createExecutionRecoveryAuthorization({...f,execution,signer:{publicKey:f.signer.publicKey,sign},nowSecs:2000,nonce:hex(64)})).rejects.toThrow()}
    expect(sign).not.toHaveBeenCalled();f.signer.dispose()
  })
  it('requires the separately retained creator-certified client and original financial policy',async()=>{
    const f=await executionRecoveryFixture(),sign=vi.fn(f.signer.sign),outsider=privateKeyToAccount(hex(12))
    for(const target of [{...f.target,executionKey:toHex(ed25519.getPublicKey(new Uint8Array(32).fill(99)))},
      {...f.target,operatorKey:f.contributorKey},{...f.target,stage:'contributor' as const}])
      await expect(createExecutionRecoveryAuthorization({...f,target,signer:{publicKey:f.signer.publicKey,sign},nowSecs:2000})).rejects.toThrow()
    for(const policy of [{...f.policy,cost:8n},{...f.policy,nowSecs:1001},{...f.policy,creator:outsider.address},
      {...f.policy,paymentHash:hex(99)},{...f.policy,chainId:43113}])
      await expect(createExecutionRecoveryAuthorization({...f,policy,signer:{publicKey:f.signer.publicKey,sign},nowSecs:2000})).rejects.toThrow()
    const payment={...f.payment,signature:await outsider.signTypedData(paymentIntentTypedData(f.payment))}
    await expect(createExecutionRecoveryAuthorization({...f,payment,signer:{publicKey:f.signer.publicKey,sign},nowSecs:2000})).rejects.toThrow()
    const consent=structuredClone(f.execution.consent)
    consent.authorization.body_hash=hex(99)
    await expect(verifyExecutionConsent({...f,consent,expected:{stage:f.target.stage,operatorKey:f.operatorKey,
      reservationBlock:hex(62),executionBinding:executionConsentBinding(f.payment,consent,hex(62))}})).rejects.toThrow(/signature/)
    expect(executionApprovalTypedData(f.payment,consent.authorization).message.bodyHash).toBe(hex(99))
    expect(sign).not.toHaveBeenCalled();f.signer.dispose()
  })
  it('rejects invalid clock, nonce, key and hostile local signer responses',async()=>{
    const f=await executionRecoveryFixture(),sign=vi.fn(f.signer.sign)
    for(const nowSecs of [0,-1,NaN,Infinity,1999.5,997])
      await expect(createExecutionRecoveryAuthorization({...f,nowSecs,signer:{publicKey:f.signer.publicKey,sign}})).rejects.toThrow()
    await expect(createExecutionRecoveryAuthorization({...f,nonce:hex(0),nowSecs:2000,signer:{publicKey:f.signer.publicKey,sign}})).rejects.toThrow()
    expect(sign).not.toHaveBeenCalled()
    await expect(createExecutionRecoveryAuthorization({...f,nowSecs:2000,signer:{publicKey:f.signer.publicKey,sign:async()=>new Uint8Array(64)}})).rejects.toThrow(/local.*signature/)
    f.signer.dispose()
  })
  it('checks exact retained bytes and refuses report/result/encoding substitutions',async()=>{
    const f=await executionRecoveryFixture()
    for(const reply of [{...f.reply(),result_json:f.resultJson+' '},{...f.reply(),result_json:'{}'},
      {...f.reply(),encoding:'ibe-extract' as const}])
      await expect(verifyRecoveredExecutionResult({...f,expectedExecution:f.execution,reply})).rejects.toThrow(/commitment/)
    f.execution.report.outcome.succeeded.result_commitment=wireBytes(hex(77));f.resign()
    await expect(verifyRecoveredExecutionResult({...f,expectedExecution:f.execution,reply:f.reply()})).rejects.toThrow(/commitment/)
    f.signer.dispose()
  })
  it('matches the existing IBE commitment and refuses altered committed fields or ambiguous JSON',async()=>{
    const f=await executionRecoveryFixture('contributor','ibe-extract')
    await expect(verifyRecoveredExecutionResult({...f,expectedExecution:f.execution,reply:f.reply()})).resolves.toBe(f.resultJson)
    const result=JSON.parse(f.resultJson) as Record<string,unknown>
    for(const changes of [{epoch:2},{identifier:8},{key_slot_id:hex(99)},{extraction_share:'other'},{verifying_share:'other'}])
      await expect(verifyRecoveredExecutionResult({...f,expectedExecution:f.execution,reply:{...f.reply(),result_json:JSON.stringify({...result,...changes})}})).rejects.toThrow()
    const duplicate=f.resultJson.replace('"identifier":7','"identifier":99,"identifier":7')
    await expect(verifyRecoveredExecutionResult({...f,expectedExecution:f.execution,reply:{...f.reply(),result_json:duplicate}})).rejects.toThrow(/ambiguous/)
    f.signer.dispose()
  })
  it('refuses unknown fields, sparse/coerced bytes and incomplete outcomes',async()=>{
    const f=await executionRecoveryFixture()
    const sparse=Array<number>(32).fill(1);Reflect.deleteProperty(sparse,0);Object.assign(sparse,{extra:1})
    for(const report of [{...f.execution.report,extra:true},{...f.execution.report,operator_key:sparse},
      {...f.execution.report,binding:Array<number>(32).fill(256)},{...f.execution.report,cost:Array<number>(32).fill(0)},
      {...f.execution.report,outcome:'started'},{...f.execution.report,outcome:{failed:true}},
      {...f.execution.report,outcome:{succeeded:{result_commitment:Array<number>(32).fill(0)}}}])
      expect(()=>paidExecutionReportSigningHash(f.payment,report as typeof f.execution.report)).toThrow()
    for(const text of ['{"a":1,"a":2}','{"a":1,"\\u0061":2}','{"x":{"a":1,"a":2}}',
      '{"a":true,}','[1,]','{} {}','{"a":NaN}','['.repeat(33)+'0'+']'.repeat(33)])
      expect(()=>parseExecutionJson(new TextEncoder().encode(text),65536)).toThrow()
    expect(parseExecutionJson(new TextEncoder().encode('{"a":[true,null,"quoted\\"name",-1.5]}'),65536)).toEqual({a:[true,null,'quoted"name',-1.5]})
    expect(()=>parseExecutionJson(Uint8Array.of(0xff),65536)).toThrow()
    expect(()=>parseExecutionJson(new Uint8Array(10),9)).toThrow()
    f.signer.dispose()
  })
  it('rejects Unicode and numeric values that the Rust recovery boundary cannot represent',()=>{
    const parse=(text:string)=>parseExecutionJson(new TextEncoder().encode(text),2*1024*1024)
    for(const text of ['{"n":1e999}','{"n":-1e999}','{"n":9007199254740992}',
      '{"n":-9007199254740992}','{"x":"\\ud800"}','{"x":"\\udfff"}',
      '{"\\ud800":1}','{"x":"\\ud800a"}'])expect(()=>parse(text)).toThrow('ambiguous')
    expect(parse('{"emoji":"\\ud83d\\ude00","n":9007199254740991,"f":-1.5}')).toEqual({emoji:'😀',n:Number.MAX_SAFE_INTEGER,f:-1.5})
  })
  it('bounds incomplete strings and containers and total structural work before disclosing a result',()=>{
    const parse=(text:string)=>parseExecutionJson(new TextEncoder().encode(text),2*1024*1024)
    for(const text of ['{"x":"unfinished','{"x":1,','[1,','{"x" 1}','{false:1}',
      '['+Array<string>(65_536).fill('0').join(',')+']'])expect(()=>parse(text)).toThrow('ambiguous')
    expect(parse(' \n\t{"empty":{},"array":[],"literal":[true,false,null]}\r ')).toEqual({empty:{},array:[],literal:[true,false,null]})
  })
})
