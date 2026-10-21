import {afterEach,describe,expect,it,vi} from 'vitest'
import {sha256} from '@noble/hashes/sha256'
import {createPublicClient,custom,decodeFunctionData,encodeFunctionResult,toHex,type Abi,type Hex} from 'viem'
import {createKeeperExecutionApprover} from '../../src/chain/keeperExecution.js'
import {verifyExecutionAuthorization} from '../../src/committee/execution.js'
import {paymentIntentHash,prepaidRequestId} from '../../src/committee/payment.js'
import type {KeeperExecutionApprovalRequest} from '../../src/committee/keeperExecution.js'
import {settlementAbi} from '../../src/chain/abis/settlement.js'
import {keyRegistryAbi} from '../../src/chain/abis/keyRegistry.js'
import {nodeRegistryAbi} from '../../src/chain/abis/nodeRegistry.js'
import {keeperExecutionFixture} from '../support/keeperExecution.js'
import {hex} from '../support/executionRecovery.js'

interface Changes {cost?:bigint;settled?:boolean;creator?:Hex;mode?:number;inactive?:boolean;version?:bigint;
  unsupported?:boolean;orphan?:boolean;age?:number;duringRead?:()=>void;eoa?:boolean}
const EOA_DIGEST=new Uint8Array(32).fill(0x5e)
async function fixture(changes:Changes={}){
  vi.spyOn(Date,'now').mockReturnValue(1_000_000)
  const f=changes.eoa?await keeperExecutionFixture('eoa-sign',toHex(sha256(EOA_DIGEST)))
    :await keeperExecutionFixture('sign',toHex(sha256(Uint8Array.of(1,2,3))))
  const payment=structuredClone(f.payment),operators=[hex(31,20),hex(32,20)],nodes=hex(7,20),hits:string[]=[]
  const client=createPublicClient({transport:custom({request:async({method,params}:{method:string;params?:unknown})=>{
    hits.push(method)
    if(method==='eth_chainId'){changes.duringRead?.();return toHex(43112)}
    if(method==='eth_getBlockByNumber'){
      const tag=(params as [string,boolean])[0]
      expect(['latest','0x14']).toContain(tag)
      return {number:'0x14',hash:tag==='0x14'&&changes.orphan?hex(99):hex(20),timestamp:toHex(1000-(changes.age??0)),transactions:[]}
    }
    if(method!=='eth_call')throw new Error('Unexpected keeper approval RPC')
    const [call,at]=params as [{to:Hex;data:Hex},unknown]
    expect(at).toEqual({blockHash:hex(20),requireCanonical:true})
    if(changes.unsupported)throw new Error('EIP-1898 unsupported')
    const abi:Abi=call.to===nodes?nodeRegistryAbi:call.to===payment.key_registry?keyRegistryAbi:settlementAbi
    const {functionName:name,args}=decodeFunctionData({abi,data:call.data})
    const index=operators.findIndex(operator=>operator.toLowerCase()===String(args?.[0]).toLowerCase())
    if(call.to===payment.settlement){expect(args?.[0]).toBe(payment.slot);if(args?.length===2)expect(args[1]).toBe(prepaidRequestId(payment))}
    const values:Record<string,unknown>={prepaidEnabled:true,prepaidCost:changes.cost??9n,prepaidSettled:changes.settled??false,
      prepaidRefunded:0n,prepaidAssignmentBlock:hex(19),getKeySlot:{creator:changes.creator??f.creator.address,
        ruleCommitment:hex(33),threshold:{k:1,n:2},mode:changes.mode??0,publicKey:hex(44),epoch:1n,
        committeeVersion:changes.version??2n,exists:true,cancelled:false,expiry:2000n,ruleVersion:1n,auth:0},
      assignedNodes:operators,nodeRegistry:nodes,operatorIdOf:BigInt(index+1),hasTag:true,
      nodeOf:{operator:operators[index],dns:'keeper',url:`https://keeper${index}.example`,p2pAddr:'',pubkey:f.keys[index],
        stake:100n,rewardBalance:0n,unbondingAt:0n,active:!changes.inactive}}
    return encodeFunctionResult({abi,functionName:name,result:values[name]})
  }},{retryCount:0})})
  const deployment={chainId:43112,settlement:payment.settlement,keyRegistry:payment.key_registry}
  const expected={slot:payment.slot,action:payment.action,payloadDigest:payment.payload_digest}
  const token={slot_id:payment.slot,payment,payment_hash:paymentIntentHash(payment)}
  const request:KeeperExecutionApprovalRequest=changes.eoa
    ?{kind:'committee-eoa-digest',nodeUrl:'https://keeper0.example',payment,body:{committee_token:token,digest:toHex(EOA_DIGEST).slice(2)}}
    :{kind:'committee-sign',nodeUrl:'https://keeper0.example',payment,body:{committee_token:token,message_hex:'010203',signing_set:[1,2]}}
  return {...f,client,deployment,expected,request,hits}
}
afterEach(()=>vi.restoreAllMocks())

describe('independent keeper approval chain boundary',()=>{
  it('signs each assigned stage only after exact canonical financial and eligible worker reads',async()=>{
    const f=await fixture(),sign=vi.fn(f.signer.sign)
    try{
      const approve=createKeeperExecutionApprover({...f,signer:{publicKey:f.signer.publicKey,sign}})
      const result=await approve(f.request)
      expect(result.policy).toEqual(f.policy)
      expect(result.authorizations).toHaveLength(3);expect(sign).toHaveBeenCalledTimes(3)
      for(const authorization of result.authorizations)await expect(verifyExecutionAuthorization({payment:f.payment,policy:result.policy,
        authorization,expected:{stage:authorization.stage,operatorKey:authorization.operator_key,body:f.request.body}})).resolves.toBeUndefined()
      expect(f.hits.every(method=>['eth_chainId','eth_getBlockByNumber','eth_call'].includes(method))).toBe(true)
    }finally{f.signer.dispose()}
  })
  it.each([
    ['zero cost',{cost:0n}],['over budget',{cost:11n}],['settled reservation',{settled:true}],
    ['foreign creator',{creator:hex(99,20)}],['wrong mode',{mode:2}],['inactive worker',{inactive:true}],
    ['changed sharing',{version:3n}],['unsupported history',{unsupported:true}],
    ['orphaned block',{orphan:true}],['stale block',{age:31}],
  ] satisfies [string,Changes][])('refuses %s before any client signature',async (_reason,changes)=>{
    const f=await fixture(changes),sign=vi.fn(f.signer.sign)
    try{
      await expect(createKeeperExecutionApprover({...f,signer:{publicKey:f.signer.publicKey,sign}})(f.request)).rejects.toThrow()
      expect(sign).not.toHaveBeenCalled()
      expect(f.hits.every(method=>['eth_chainId','eth_getBlockByNumber','eth_call'].includes(method))).toBe(true)
    }finally{f.signer.dispose()}
  })
  it('rejects a different payload, payment, endpoint or aliased routing map before client signing',async()=>{
    const f=await fixture(),sign=vi.fn(f.signer.sign)
    try{
      const approve=createKeeperExecutionApprover({...f,signer:{publicKey:f.signer.publicKey,sign}})
      await expect(approve({...f.request,body:{...f.request.body,message_hex:'ff'}})).rejects.toThrow('payload differs')
      expect(f.hits).toHaveLength(0)
      await expect(approve({...f.request,nodeUrl:'https://unassigned.example'})).rejects.toThrow('endpoint')
      const aliasApprover=createKeeperExecutionApprover({...f,signer:{publicKey:f.signer.publicKey,sign},keeperUrl:()=> 'https://alias.example'})
      await expect(aliasApprover({...f.request,nodeUrl:'https://alias.example'})).rejects.toThrow('aliases')
      expect(sign).not.toHaveBeenCalled()
    }finally{f.signer.dispose()}
  })
  it('snapshots original route semantics and body before asynchronous RPC callbacks can mutate them',async()=>{
    let mutate=()=>{}
    const f=await fixture({duringRead:()=>mutate()}),original=structuredClone(f.request)
    try{
      const options={...f},approve=createKeeperExecutionApprover(options)
      mutate=()=>{f.request.kind='ibe-extract';f.request.nodeUrl='https://unassigned.example';f.request.body.message_hex='ff';
        options.payment.max_cost='99';options.certificate.expires=0;options.expected.payloadDigest=hex(99)}
      const result=await approve(f.request)
      expect(result.authorizations).toHaveLength(3)
      for(const authorization of result.authorizations)await expect(verifyExecutionAuthorization({payment:original.payment,policy:result.policy,
        authorization,expected:{stage:authorization.stage,operatorKey:authorization.operator_key,body:original.body}})).resolves.toBeUndefined()
    }finally{f.signer.dispose()}
  })
  it('honors abort after canonical reads before invoking the original client signer',async()=>{
    const abort=new AbortController(),f=await fixture({duringRead:()=>abort.abort(new Error('cancelled'))}),sign=vi.fn(f.signer.sign)
    try{
      await expect(createKeeperExecutionApprover({...f,signer:{publicKey:f.signer.publicKey,sign}})({...f.request,signal:abort.signal})).rejects.toThrow('cancelled')
      expect(sign).not.toHaveBeenCalled()
    }finally{f.signer.dispose()}
  })
  it('refuses a policy that ages during the local signing callback before another stage or dispatch',async()=>{
    const f=await fixture(),sign=vi.fn(async(bytes:Uint8Array)=>{
      const signature=await f.signer.sign(bytes);vi.spyOn(Date,'now').mockReturnValue(1_031_000);return signature
    })
    try{
      await expect(createKeeperExecutionApprover({...f,signer:{publicKey:f.signer.publicKey,sign}})(f.request)).rejects.toThrow('aged')
      expect(sign).toHaveBeenCalledTimes(1)
    }finally{f.signer.dispose()}
  })
})

// Chain 18: a paid tecdsa-p256 signature (slot mode 4) was refused on the client before signing,
// because the EOA-digest route admitted only secp256k1 (mode 2). It serves both curves.
describe('threshold-ECDSA digest route',()=>{
  it.each([['secp256k1',2],['p256',4]])('approves a %s slot (mode %i)',async (_curve,mode)=>{
    const f=await fixture({eoa:true,mode}),sign=vi.fn(f.signer.sign)
    try{
      const result=await createKeeperExecutionApprover({...f,signer:{publicKey:f.signer.publicKey,sign}})(f.request)
      expect(result.authorizations).toHaveLength(3);expect(sign).toHaveBeenCalledTimes(3)
    }finally{f.signer.dispose()}
  })
  it.each([['frost',0],['bls',1],['bls-bn254',3]])('refuses a %s slot (mode %i) before any client signature',async (_mode,mode)=>{
    const f=await fixture({eoa:true,mode}),sign=vi.fn(f.signer.sign)
    try{
      await expect(createKeeperExecutionApprover({...f,signer:{publicKey:f.signer.publicKey,sign}})(f.request))
        .rejects.toThrow(/canonical slot mode/)
      expect(sign).not.toHaveBeenCalled()
    }finally{f.signer.dispose()}
  })
})
