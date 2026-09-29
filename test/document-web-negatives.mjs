import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
const requireApp=createRequire(new URL('../examples/document-signing/package.json',import.meta.url))
const {fetchRequestObject,defaultKeyResolver,buildResponse,submitResponse,ed25519HolderKey,planPresentation,signCompactJws,holderSigner}=await import(pathToFileURL(requireApp.resolve('tasra-sdk/oid4vp')).href)
const root=new URL('../examples/document-signing/',import.meta.url).pathname,out=new URL('../.verification/document-signing-web/',import.meta.url).pathname
const origin='http://127.0.0.1:4177',service=JSON.parse(readFileSync(root+'.tasra/service.json')),saved=JSON.parse(readFileSync(out+'checkpoint.json'))
const checks=[]
async function call(path,data,owner=false){const r=await fetch(origin+'/api'+path,{method:data===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',...(owner?{authorization:'Bearer '+service.senderToken}:{})},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,body:await r.json()}}
const after=await call('/requests/'+saved.id);assert.equal(after.body.status,'completed');assert.deepEqual(after.body.signers.alice.signature,saved.proof)
const repeated=await call(`/requests/${saved.id}/alice/complete`,{attemptId:saved.attemptId});assert.equal(repeated.status,200);assert.deepEqual(repeated.body.signers.alice.signature,saved.proof);checks.push('process restart preserves proof; repeated completion returns same proof')
assert.equal((await call('/requests')).status,409);checks.push('sender list requires private sender capability')
const pdf=readFileSync(out+'document.pdf'),expected=JSON.parse(readFileSync(out+'request.json')),bundle=JSON.parse(readFileSync(out+'signatures.json'))
for(const kind of ['changed PDF','changed request','changed version','duplicate signer','swapped slot']){
 const e=structuredClone(expected),b=structuredClone(bundle),p=Buffer.from(pdf)
 if(kind==='changed PDF')p[p.length-1]^=1
 if(kind==='changed request')b.manifest.requestId=randomUUID()
 if(kind==='changed version')b.manifest.version++
 if(kind==='duplicate signer')b.signatures[1]=b.signatures[0]
 if(kind==='swapped slot')b.signatures[0].slotId=b.signatures[1].slotId
 const result=await call('/verify',{pdfBase64:p.toString('base64'),expected:e,bundle:b});assert.equal(result.status,400,kind);checks.push(kind+' rejected')
}
const input={id:randomUUID(),title:'Verifier refusal check',version:1,pdfBase64:pdf.toString('base64')}
let result=await call('/requests',input,true);assert.equal(result.status,201);const id=result.body.manifest.requestId,manifest=result.body.manifest
assert.equal((await call(`/requests/${id}/bundle`)).status,409)
assert.equal((await call(`/requests/${id}/alice/complete`,{attemptId:saved.attemptId})).status,409);checks.push('incomplete bundle and cross-request completion refused')
result=await call(`/requests/${id}/alice/prepare`,{documentSha256:manifest.documentSha256});const attemptId=result.body.signers.alice.attemptId
const session=(await call(`/requests/${id}/alice/session`,{attemptId})).body
const transport=async(input,init)=>{const r=await call(`/requests/${id}/alice/transport`,{attemptId,url:String(input),method:init?.method??'GET',body:init?.body?.toString()});assert.equal(r.status,200);return new Response(r.body.status===204?null:r.body.body,{status:r.body.status,headers:{'content-type':r.body.contentType??'text/plain'}})}
const ro=await fetchRequestObject(session.requestUri,{fetchImpl:transport,resolveKey:defaultKeyResolver({fetchImpl:transport})})
const alice=JSON.parse(readFileSync(root+'.tasra/wallets/alice.json')),mallory=JSON.parse(readFileSync(root+'.tasra/wallets/mallory.json'))
// Deliberately bypass only the wallet's local DCQL filtering, to exercise the real verifier.
const plan=planPresentation(ro,[{sdJwt:alice.credential}]);assert.ok(plan.chosen)
const candidate={...plan.chosen,sdJwt:mallory.credential}
await submitResponse(ro,buildResponse({ro,candidate,holder:ed25519HolderKey(Buffer.from(mallory.seed.slice(2),'hex'))}),transport)
result=await call(`/requests/${id}/alice/complete`,{attemptId});assert.equal(result.status,403)
const refused=(await call('/requests/'+id)).body;assert.equal(refused.signers.alice.phase,'refused');assert.equal(refused.signers.alice.signature,undefined)
checks.push('real Mallory presentation refused by verifier; no signature saved')
const retry=(await call(`/requests/${id}/alice/prepare`,{documentSha256:manifest.documentSha256})).body
assert.notEqual(retry.signers.alice.attemptId,attemptId)
assert.equal((await call(`/requests/${id}/alice/complete`,{attemptId})).status,409);checks.push('stale completion rejected after fresh attempt')
const decline=(person,wallet)=>signCompactJws({alg:'EdDSA',typ:'tasra-decline+jwt'},{aud:'tasra-sign-decline/v1',requestId:id,documentSha256:manifest.documentSha256,person,exp:Math.floor(Date.now()/1000)+120},holderSigner(ed25519HolderKey(Buffer.from(wallet.seed.slice(2),'hex'))))
assert.equal((await call(`/requests/${id}/alice/decline`,{proof:decline('alice',mallory)})).status,400)
assert.equal((await call(`/requests/${id}/alice/decline`,{proof:decline('alice',alice)})).body.status,'declined')
checks.push('only the assigned holder can decline; Mallory decline refused')
const cancelInput={...input,id:randomUUID(),title:'Cancellation check'}
await call('/requests',cancelInput,true)
assert.equal((await call(`/requests/${cancelInput.id}/cancel`,{})).status,409)
assert.equal((await call(`/requests/${cancelInput.id}/cancel`,{},true)).body.status,'cancelled')
checks.push('only the private sender capability can cancel')
writeFileSync(out+'negative-checks.json',JSON.stringify({at:new Date().toISOString(),checks,persistenceRequestId:saved.id,refusedRequestId:id},null,2)+'\n')
console.log('PASS '+checks.length+' persistence, authorization and tamper checks')
