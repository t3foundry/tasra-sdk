import {chromium} from 'playwright'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import assert from 'node:assert/strict'
const root=new URL('../examples/document-signing/',import.meta.url).pathname
const out=new URL('../.verification/document-signing-web/',import.meta.url).pathname
mkdirSync(out,{recursive:true})
const origin='http://127.0.0.1:4177'
const service=JSON.parse(readFileSync(root+'.tasra/service.json','utf8'))
const browser=await chromium.launch({headless:true})
const errors=[]
try{
 const owner=await browser.newContext({viewport:{width:1440,height:1050}}),a=await browser.newContext({viewport:{width:1440,height:1050}}),b=await browser.newContext({viewport:{width:1440,height:1050}})
 const sender=await owner.newPage(),alice=await a.newPage(),bob=await b.newPage()
 for(const page of [sender,alice,bob])page.on('pageerror',e=>errors.push(e.message))
 await sender.goto(origin+'/#sender='+service.senderToken)
 await sender.locator('#pdf').setInputFiles(root+'public/sample.pdf')
 await sender.getByRole('button',{name:'Create signing request'}).click()
 await sender.locator('a[href$="/alice"]').waitFor()
 const invitation=await sender.locator('a[href$="/alice"]').getAttribute('href'),id=invitation.split('/')[2]
 const request=await(await fetch(origin+'/api/requests/'+id)).json()
 writeFileSync(out+'request.json',JSON.stringify(request.manifest,null,2)+'\n')
 writeFileSync(out+'document.pdf',readFileSync(root+'public/sample.pdf'))
 await sender.screenshot({path:out+'sender.png',fullPage:true})
 await bob.goto(origin+invitation.replace('/alice','/bob'));await bob.getByText('Waiting for Alice to sign.',{exact:false}).waitFor()
 await alice.goto(origin+invitation)
 await alice.locator('#wallet').setInputFiles(root+'.tasra/wallets/alice.json')
 await alice.locator('#consent').check()
 await alice.locator('#preview[data-ready="true"]').waitFor()
 await alice.screenshot({path:out+'alice-review.png',fullPage:true})
 let presentations=0
 alice.on('request',request=>{if(request.url().endsWith('/alice/transport')&&request.postDataJSON()?.method==='POST')presentations++})
 // Lose the first completion delivery after the wallet has submitted its presentation.
 await alice.route('**/alice/complete',route=>route.abort(),{times:1})
 await alice.getByRole('button',{name:'Approve and sign'}).click()
 await alice.locator('#notice').filter({hasText:'Failed to fetch'}).waitFor({timeout:60000})
 const pending=await(await fetch(origin+'/api/requests/'+id)).json()
 assert.equal(pending.signers.alice.phase,'awaiting_wallet')
 for(let retry=0;retry<30;retry++){
  const state=await(await fetch(origin+`/api/requests/${id}/alice/session`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({attemptId:pending.signers.alice.attemptId})})).json()
  if(state.status==='done')break
  if(retry===29)throw new Error('Wallet presentation did not finish')
  await new Promise(resolve=>setTimeout(resolve,500))
 }
 await alice.reload();await alice.locator('#wallet').setInputFiles(root+'.tasra/wallets/alice.json');await alice.locator('#consent').check()
 await alice.getByRole('button',{name:'Approve and sign'}).click()
 await alice.getByRole('heading',{name:'Your signature is saved'}).waitFor({timeout:180000})
 assert.equal(presentations,1,'accepted wallet presentation is not resubmitted after reload')
 await alice.reload();await alice.getByRole('heading',{name:'Your signature is saved'}).waitFor()
 const afterAlice=await(await fetch(origin+'/api/requests/'+id)).json()
 writeFileSync(out+'checkpoint.json',JSON.stringify({id,attemptId:afterAlice.signers.alice.attemptId,proof:afterAlice.signers.alice.signature}),{mode:0o600})
 console.log('Alice signed; reload persisted. Request '+id)
 await bob.locator('#wallet').waitFor({timeout:15000});await bob.locator('#wallet').setInputFiles(root+'.tasra/wallets/bob.json')
 await bob.locator('#consent').check();await bob.getByRole('button',{name:'Approve and sign'}).click()
 await bob.getByRole('heading',{name:'Your signature is saved'}).waitFor({timeout:180000})
 const saved=await(await fetch(origin+'/api/requests/'+id)).json()
 assert.equal(saved.status,'completed')
 const bundleResponse=await fetch(origin+'/api/requests/'+id+'/bundle');assert.equal(bundleResponse.status,200)
 const bundle=await bundleResponse.json();writeFileSync(out+'signatures.json',JSON.stringify(bundle,null,2)+'\n')
 const duplicate=await fetch(origin+`/api/requests/${id}/alice/complete`,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({attemptId:afterAlice.signers.alice.attemptId})})
 assert.equal(duplicate.status,200);const repeated=await duplicate.json();assert.deepEqual(repeated.signers.alice.signature,afterAlice.signers.alice.signature);assert.equal(repeated.history.filter(h=>h.event==='Signature verified').length,2)
 await bob.screenshot({path:out+'completed.png',fullPage:true})
 await bob.setViewportSize({width:390,height:844});await bob.screenshot({path:out+'mobile.png',fullPage:true})
 assert.equal(await bob.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 await bob.goto(origin+'/verify')
 await bob.locator('#original').setInputFiles(out+'document.pdf');await bob.locator('#expected').setInputFiles(out+'request.json');await bob.locator('#bundle').setInputFiles(out+'signatures.json');await bob.locator('#verify').click()
 await bob.locator('#result.success').waitFor();await bob.screenshot({path:out+'verified.png',fullPage:true})
 assert.deepEqual(errors,[])
 writeFileSync(out+'browser.json',JSON.stringify({at:new Date().toISOString(),requestId:id,slots:service.slots,checks:['sender uploads PDF and creates frozen request','accepted wallet presentation resumes after lost completion without resubmission','separate Alice and Bob browser contexts','Bob blocked before Alice','Alice reload persists signature','Bob signs independently','duplicate completion returns saved proof','two signature history entries','bundle verified against live keys','mobile has no horizontal overflow','no browser page errors'],status:saved.status},null,2)+'\n')
 console.log('PASS browser flow, duplicate completion, independent verification, mobile layout')
}catch(e){console.error(e.message);throw e}finally{await browser.close()}
