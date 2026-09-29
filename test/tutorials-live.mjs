// Opt-in acceptance: fresh installed artifact; only public evidence is copied.
import {execFileSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, readdirSync, cpSync, writeFileSync, readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
import {tmpdir} from 'node:os'
if(process.env.TASRA_ALLOW_NETWORK_TRANSACTIONS!=='1')throw new Error('Authorize selected-network transactions and creator funding before setting TASRA_ALLOW_NETWORK_TRANSACTIONS=1')
const root=resolve(import.meta.dirname,'..'), dir=mkdtempSync(resolve(tmpdir(),'tasra-tutorials-'))
const supported=['encrypted-notes','document-signing','native-approvals','credential-approvals']
const selected=(process.env.TASRA_TUTORIALS ?? supported.join(',')).split(',')
for(const name of selected) if (!supported.includes(name)) throw new Error('Unknown tutorial: '+name)
// Public artifacts must never copy a private creation journal or wallet grant.
function assertPublicEvidence(value) {
 if (!value || typeof value !== 'object') return
 for (const [key, child] of Object.entries(value)) {
  if (['ruleSalt','salt','creatorKey','issuerKey','privateKey','credential','committeeToken','token'].includes(key)) throw new Error('Private field in public evidence: '+key)
  assertPublicEvidence(child)
 }
}
const run=(cmd,args,cwd=dir,timeout=900000)=>execFileSync(cmd,args,{cwd,stdio:'inherit',timeout,env:process.env})
run('npm',['pack','--ignore-scripts','--pack-destination',dir,'--loglevel','error'],root)
const tarball=readdirSync(dir).find(p=>p.endsWith('.tgz'))
writeFileSync(dir+'/package.json',JSON.stringify({name:'tutorial-acceptance',private:true,type:'module'}))
run('npm',['install','--ignore-scripts','--no-audit','--no-fund',dir+'/'+tarball])
run('npm',['install','--save-dev','--ignore-scripts','--no-audit','--no-fund','tsx@4.23.13'])
for (const file of ['tutorial-support.ts','tutorial-negative.ts','network.ts','fund-slot.ts']) cpSync(dir+'/node_modules/tasra-sdk/examples/'+file,dir+'/'+file)
run(process.execPath,['--import','tsx','network.ts'])
const packedPackage=JSON.parse(readFileSync(dir+'/node_modules/tasra-sdk/package.json','utf8'))
if(packedPackage.name!=='tasra-sdk'||typeof packedPackage.version!=='string')throw new Error('Installed package identity is invalid')
const network=JSON.parse(readFileSync(dir+'/network.json','utf8'))
const pin=JSON.parse(readFileSync(dir+'/network-pin.json','utf8'))
if(typeof network.deploymentId!=='string'||!Number.isSafeInteger(network.revision)||typeof pin.sha256!=='string')throw new Error('Downloaded network provenance is invalid')
const packageSha256=createHash('sha256').update(readFileSync(dir+'/'+tarball)).digest('hex')
console.log('Tutorial workspace: '+dir)
console.log('Use this directory in a second terminal to run fund-slot.ts when a tutorial waits for slot credit.')
for(const name of selected){
 cpSync(dir+'/node_modules/tasra-sdk/examples/'+name+'.ts',dir+'/'+name+'.ts')
 // Creator AVAX and slot TSRA funding each have their own 15-minute wait.
 run(process.execPath,['--import','tsx',name+'.ts'],dir,45*60_000)
 const output=root+'/.tasra/tutorial-evidence/'+name
 mkdirSync(output,{recursive:true})
 const local=readdirSync(dir+'/.tasra').find(p=>p.startsWith(name+'-'))
 assertPublicEvidence(JSON.parse(readFileSync(dir+'/.tasra/'+local+'/evidence.json','utf8')))
 cpSync(dir+'/.tasra/'+local+'/evidence.json',output+'/evidence.json')
 if(name==='document-signing')for(const file of ['document.pdf','signature-bundle.json','request.json'])cpSync(dir+'/.tasra/'+local+'/'+file,output+'/'+file)
 writeFileSync(output+'/provenance.json',JSON.stringify({packageVersion:packedPackage.version,node:process.version,checkedAt:new Date().toISOString(),networkRevision:`${network.deploymentId}@${network.revision}`,manifestSha256:pin.sha256,packageSha256,exampleSha256:createHash('sha256').update(readFileSync(dir+'/'+name+'.ts')).digest('hex')},null,2)+'\n')
}
console.log('Tutorial acceptance directory: '+dir)
