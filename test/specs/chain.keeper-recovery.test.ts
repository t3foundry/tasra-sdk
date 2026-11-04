import {afterEach,describe,expect,it,vi} from 'vitest'
import {createPublicClient,custom,decodeFunctionData,encodeFunctionResult,getAddress,toHex,type Abi,type Hex} from 'viem'
import {recoverKeeperExecution,KeeperRecoveryError,type KeeperRecoveryTransport} from '../../src/chain/keeperRecovery.js'
import {readKeeperExecutionRecoveryPolicy} from '../../src/chain/prepaid.js'
import {prepaidRequestId} from '../../src/committee/payment.js'
import {executionRecoverySigningHash} from '../../src/committee/recovery.js'
import {ed25519} from '@noble/curves/ed25519'
import {keyRegistryAbi} from '../../src/chain/abis/keyRegistry.js'
import {nodeRegistryAbi} from '../../src/chain/abis/nodeRegistry.js'
import {settlementAbi} from '../../src/chain/abis/settlement.js'
import {executionRecoveryFixture,hex} from '../support/executionRecovery.js'

interface HistoryChanges {
  chain?:number;missing?:boolean;wrongHash?:boolean;orphan?:boolean;unsupported?:boolean;timestamp?:number
  cost?:bigint;settled?:boolean;refunded?:bigint;enabled?:boolean;assignmentBlock?:Hex
  creator?:Hex;cancelled?:boolean;expiry?:bigint;keyEpoch?:bigint;version?:bigint;threshold?:number
  inactive?:number;untagged?:number;duplicateIds?:boolean;onChainId?:()=>void
}
function history(f:Awaited<ReturnType<typeof executionRecoveryFixture>>,changes:HistoryChanges={}) {
  const calls:{method:string;params?:unknown;name?:string}[]=[],nodes=hex(7,20)
  const payment=structuredClone(f.payment),deployment={...f.deployment}
  const operators=[f.keeper.operator,hex(32,20)],keys=[f.operatorKey,f.contributorKey]
  const client=createPublicClient({transport:custom({request:async({method,params}:{method:string;params?:unknown})=>{
    calls.push({method,params})
    if(method==='eth_chainId'){changes.onChainId?.();return toHex(changes.chain??43112)}
    if(method==='eth_getBlockByHash'){
      expect(params).toEqual([hex(62),false])
      if(changes.missing)throw new Error('historical block unavailable')
      return {number:'0x14',hash:changes.wrongHash?hex(99):hex(62),timestamp:toHex(changes.timestamp??1000),transactions:[]}
    }
    if(method==='eth_getBlockByNumber'){
      // A historical reader never requests latest, even after expiry, payout or ownership changes.
      expect(params).toEqual(['0x14',false])
      return {number:'0x14',hash:changes.orphan?hex(99):hex(62),timestamp:toHex(changes.timestamp??1000),transactions:[]}
    }
    if(method!=='eth_call')throw new Error('Unexpected history RPC')
    const [call,block]=params as [{to:Hex;data:Hex},unknown]
    expect(block).toEqual({blockHash:hex(62),requireCanonical:true})
    if(changes.unsupported)throw new Error('EIP-1898 unavailable')
    const abi:Abi=call.to===nodes?nodeRegistryAbi:call.to===deployment.keyRegistry?keyRegistryAbi:settlementAbi
    const {functionName:name,args}=decodeFunctionData({abi,data:call.data})
    calls[calls.length-1]!.name=name
    const index=operators.findIndex(op=>op.toLowerCase()===String(args?.[0]).toLowerCase())
    if(call.to===deployment.settlement){expect(args?.[0]).toBe(payment.slot)
      if(args?.length===2)expect(args[1]).toBe(prepaidRequestId(payment))}
    const values:Record<string,unknown>={prepaidEnabled:changes.enabled??true,prepaidCost:changes.cost??9n,
      prepaidSettled:changes.settled??false,prepaidRefunded:changes.refunded??0n,prepaidAssignmentBlock:changes.assignmentBlock??hex(19),
      getKeySlot:{creator:changes.creator??f.creator.address,ruleCommitment:hex(33),threshold:{k:changes.threshold??1,n:2},mode:0,
        publicKey:f.operatorKey,epoch:changes.keyEpoch??1n,committeeVersion:changes.version??2n,exists:true,
        cancelled:changes.cancelled??false,expiry:changes.expiry??1060n,ruleVersion:1n,auth:0},
      assignedNodes:operators,nodeRegistry:nodes,operatorIdOf:changes.duplicateIds?1n:BigInt(index+1),hasTag:changes.untagged!==index,
      nodeOf:{operator:operators[index],dns:'keeper',url:`https://keeper${index===0?'':index}.example`,p2pAddr:'',pubkey:keys[index],
        stake:100n,rewardBalance:0n,unbondingAt:0n,active:changes.inactive!==index}}
    return encodeFunctionResult({abi,functionName:name,result:values[name]})
  }},{retryCount:0})})
  const read=()=>readKeeperExecutionRecoveryPolicy(client,f.deployment,f.payment,f.expected,f.target,f.execution)
  return {client,calls,read}
}
afterEach(()=>vi.restoreAllMocks())
const clock=()=>vi.spyOn(Date,'now').mockReturnValue(2_000_000)
const encoded=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value))

describe('client keeper recovery workflow',()=>{
  it('authenticates old earned work with exact canonical history, without consulting latest or spending gas',async()=>{
    clock();const f=await executionRecoveryFixture(),h=history(f),at=await h.read()
    expect(at).toMatchObject({blockNumber:20n,blockHash:hex(62),blockTimestamp:1000n,
      policy:{creator:f.creator.address,cost:9n,nowSecs:1000},keeper:{...f.keeper,operator:getAddress(f.keeper.operator)},groupPublicKey:f.operatorKey})
    expect(f.payment.expires).toBeLessThan(Date.now()/1000)
    expect(h.calls.filter(c=>c.method==='eth_getBlockByHash')).toHaveLength(1)
    expect(h.calls.filter(c=>c.method==='eth_getBlockByNumber')).toHaveLength(1)
    expect(h.calls.every(c=>['eth_chainId','eth_getBlockByHash','eth_getBlockByNumber','eth_call'].includes(c.method))).toBe(true)
    expect(h.calls.some(c=>/balanceOf|send|estimate|gas/.test(c.name??c.method))).toBe(false)
    f.signer.dispose()
  })
  it('refuses missing/orphaned history, incorrect original financial backing and changed original roster',async()=>{
    clock();const f=await executionRecoveryFixture()
    const changes:HistoryChanges[]=[{chain:43113},{missing:true},{wrongHash:true},{orphan:true},{unsupported:true},
      {timestamp:969},{timestamp:1003},{cost:0n},{cost:8n},{cost:11n},{settled:true},{refunded:1n},{enabled:false},
      {assignmentBlock:hex(0)},{creator:hex(99,20)},{cancelled:true},{expiry:1000n},{keyEpoch:2n},{version:3n},
      {threshold:2},{inactive:0},{inactive:1},{untagged:0},{untagged:1},{duplicateIds:true}]
    for(const change of changes){const h=history(f,change);await expect(h.read()).rejects.toThrow()
      expect(h.calls.every(c=>['eth_chainId','eth_getBlockByHash','eth_getBlockByNumber','eth_call'].includes(c.method))).toBe(true)}
    f.signer.dispose()
  })
  it('rejects another payment, deployment or worker before performing historical RPC reads',async()=>{
    clock();const f=await executionRecoveryFixture(),h=history(f)
    for(const deployment of [{...f.deployment,chainId:43113},{...f.deployment,settlement:hex(99,20)}])
      await expect(readKeeperExecutionRecoveryPolicy(h.client,deployment,f.payment,f.expected,f.target,f.execution)).rejects.toThrow()
    await expect(readKeeperExecutionRecoveryPolicy(h.client,f.deployment,f.payment,{...f.expected,payloadDigest:hex(99)},f.target,f.execution)).rejects.toThrow()
    await expect(readKeeperExecutionRecoveryPolicy(h.client,f.deployment,f.payment,f.expected,{...f.target,operatorKey:f.contributorKey},f.execution)).rejects.toThrow()
    await expect(readKeeperExecutionRecoveryPolicy(h.client,f.deployment,f.payment,f.expected,f.target,{...f.execution,signature:hex(0,64)})).rejects.toThrow()
    expect(h.calls).toHaveLength(0);f.signer.dispose()
  })
  it('performs exactly one public evidence POST then one authenticated read with a locally verified client signature',async()=>{
    clock();const f=await executionRecoveryFixture(),h=history(f),hits:string[]=[],sign=vi.fn(f.signer.sign)
    const transport:KeeperRecoveryTransport={keeperRecoveryRequest:async(url,options)=>{
      hits.push(url);options.signal.throwIfAborted()
      if(url.endsWith('/recover')){
        const body=JSON.parse(new TextDecoder().decode(options.body)) as {payment:typeof f.payment;authorization:Parameters<typeof executionRecoverySigningHash>[1]&{signature:Hex}}
        expect(body.payment).toEqual(f.payment)
        expect(ed25519.verify(Buffer.from(body.authorization.signature.slice(2),'hex'),
          Buffer.from(executionRecoverySigningHash(f.payment,body.authorization).slice(2),'hex'),f.signer.publicKey,{zip215:false})).toBe(true)
        expect(body.authorization.issued_at).toBe(2000)
        expect(new TextDecoder().decode(options.body)).not.toContain('private holder authorization')
        return {status:200,body:encoded(f.reply())}
      }
      expect(JSON.parse(new TextDecoder().decode(options.body))).toMatchObject({stage:'coordinator',request:{chain_id:43112}})
      return {status:200,body:encoded(f.execution)}
    }}
    const result=await recoverKeeperExecution({...f,client:h.client,transport,signer:{publicKey:f.signer.publicKey,sign},nonce:hex(64)})
    expect(result.resultJson).toBe(f.resultJson)
    expect(result.observation.policy.nowSecs).toBe(1000)
    expect(hits).toEqual([f.keeper.url+'/v1/prepaid/execution',f.keeper.url+'/v1/prepaid/execution/recover'])
    expect(sign).toHaveBeenCalledTimes(1);f.signer.dispose()
  })
  it('never asks the client to sign after a history refusal and never retries refused keeper reads',async()=>{
    clock();const f=await executionRecoveryFixture(),sign=vi.fn(f.signer.sign)
    const send=vi.fn(async()=>({status:200,body:encoded(f.execution)}))
    for(const change of [{missing:true},{orphan:true},{settled:true}])
      await expect(recoverKeeperExecution({...f,client:history(f,change).client,transport:{keeperRecoveryRequest:send},
        signer:{publicKey:f.signer.publicKey,sign}})).rejects.toThrow()
    expect(send).toHaveBeenCalledTimes(3);expect(sign).not.toHaveBeenCalled()
    for(const status of [404,409,503]){
      const post=vi.fn(async()=>({status,body:encoded({private_result:'never include in errors'})}))
      const error:unknown=await recoverKeeperExecution({...f,client:history(f).client,transport:{keeperRecoveryRequest:post}}).catch((e:unknown)=>e)
      expect(error).toBeInstanceOf(KeeperRecoveryError);expect(String(error)).not.toContain('private_result');expect(post).toHaveBeenCalledTimes(1)
    }
    f.signer.dispose()
  })
  it('does not expose tampered, oversized or duplicate-bearing replies',async()=>{
    clock();const f=await executionRecoveryFixture()
    for(const response of [encoded({...f.reply(),result_json:'{}'}),encoded({...f.reply(),encoding:'unknown'}),
      new TextEncoder().encode(JSON.stringify(f.reply()).replace('"encoding":"json"','"encoding":"json","encoding":"json"')),
      new Uint8Array(6*2*1024*1024+65537)]){
      const post=vi.fn(async(url:string)=>({status:200,body:url.endsWith('/recover')?response:encoded(f.execution)}))
      await expect(recoverKeeperExecution({...f,client:history(f).client,transport:{keeperRecoveryRequest:post}})).rejects.toThrow()
      expect(post).toHaveBeenCalledTimes(2)
    }
    f.signer.dispose()
  })
  it('retains original intent and endpoint when caller objects change during asynchronous reads',async()=>{
    clock();const f=await executionRecoveryFixture(), originalPayment=structuredClone(f.payment)
    const h=history(f,{onChainId:()=>{f.deployment.settlement=hex(99,20);f.payment.slot=hex(99);f.expected.slot=hex(99);f.keeper.url='https://other.example'}})
    const urls:string[]=[],transport:KeeperRecoveryTransport={keeperRecoveryRequest:async(url)=>{urls.push(url)
      return {status:200,body:encoded(url.endsWith('/recover')?f.reply():f.execution)}}}
    const result=await recoverKeeperExecution({...f,client:h.client,transport})
    expect(result.execution.report.request.slot).toEqual(Array.from(Buffer.from(originalPayment.slot.slice(2),'hex')))
    expect(urls.every(url=>url.startsWith('https://keeper.example/'))).toBe(true);f.signer.dispose()
  })
  it('bounds cancellation and refuses invalid destination policy before transport',async()=>{
    clock();const f=await executionRecoveryFixture(),post=vi.fn(async()=>({status:200,body:encoded(f.execution)}))
    for(const url of ['http://keeper.example','https://user:secret@keeper.example','https://keeper.example?redirect=1'])
      await expect(recoverKeeperExecution({...f,keeper:{...f.keeper,url},client:history(f).client,transport:{keeperRecoveryRequest:post}})).rejects.toThrow()
    const controller=new AbortController();controller.abort(new Error('Client cancelled'))
    await expect(recoverKeeperExecution({...f,client:history(f).client,transport:{keeperRecoveryRequest:post},signal:controller.signal})).rejects.toThrow('Client cancelled')
    expect(post).not.toHaveBeenCalled()
    const pending=vi.fn((_url:string,options:{signal:AbortSignal})=>new Promise<never>((_,reject)=>{
      options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true})}))
    const runningController=new AbortController()
    const read=recoverKeeperExecution({...f,client:history(f).client,transport:{keeperRecoveryRequest:pending},signal:runningController.signal})
    runningController.abort(new Error('Stop private read'))
    await expect(read).rejects.toThrow('Stop private read');expect(pending).toHaveBeenCalledTimes(1);f.signer.dispose()
  })
})
