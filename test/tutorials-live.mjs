// Opt-in acceptance: fresh installed artifact; only public evidence is copied.
import {execFileSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, readdirSync, cpSync, writeFileSync, readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
import {tmpdir} from 'node:os'
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
cpSync(root+'/examples/local-fleet-ca.pem',dir+'/ca.pem')
const run=(cmd,args,cwd=dir)=>execFileSync(cmd,args,{cwd,stdio:'inherit',timeout:900000,env:{...process.env,NODE_EXTRA_CA_CERTS:dir+'/ca.pem'}})
run('npm',['pack','--ignore-scripts','--pack-destination',dir,'--loglevel','error'],root)
const tarball=readdirSync(dir).find(p=>p.endsWith('.tgz'))
writeFileSync(dir+'/package.json',JSON.stringify({name:'tutorial-acceptance',private:true,type:'module'}))
run('npm',['install','--ignore-scripts','--no-audit','--no-fund',dir+'/'+tarball,'viem@2.56.8','tsx@4.23.13'])
cpSync(root+'/examples/local-fleet-ca.pem',dir+'/ca.pem')
for(const name of selected){
 cpSync(dir+'/node_modules/tasra-sdk/examples/'+name+'.ts',dir+'/'+name+'.ts')
 run(process.execPath,['--import','tsx',name+'.ts'])
 const output=root+'/.tasra/tutorial-evidence/'+name
 mkdirSync(output,{recursive:true})
 const local=readdirSync(dir+'/.tasra').find(p=>p.startsWith(name+'-'))
 assertPublicEvidence(JSON.parse(readFileSync(dir+'/.tasra/'+local+'/evidence.json','utf8')))
 cpSync(dir+'/.tasra/'+local+'/evidence.json',output+'/evidence.json')
 if(name==='document-signing')for(const file of ['document.pdf','signature-bundle.json','request.json'])cpSync(dir+'/.tasra/'+local+'/'+file,output+'/'+file)
 writeFileSync(output+'/provenance.json',JSON.stringify({candidate:'0.3.0-next.0',sourceDirty:true,node:process.version,checkedAt:new Date().toISOString(),networkRevision:process.env.TASRA_NETWORK_REVISION ?? 'unrecorded',packageSha256:createHash('sha256').update(readFileSync(dir+'/'+tarball)).digest('hex'),exampleSha256:createHash('sha256').update(readFileSync(dir+'/'+name+'.ts')).digest('hex')},null,2)+'\n')
}
console.log('Tutorial acceptance directory: '+dir)
