// Install exactly the example shipped in the candidate. No fleet or private state needed.
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,cpSync,readFileSync,writeFileSync,readdirSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
const scratch=mkdtempSync(join(tmpdir(),'tasra-document-app-'))
const sdk=new URL('..',import.meta.url).pathname
function run(cmd,args,cwd){return execFileSync(cmd,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:180000})}
try{
 run('npm',['pack','--pack-destination',scratch,'--loglevel','error'],sdk)
 const archive=join(scratch,readdirSync(scratch).find(p=>p.endsWith('.tgz')))
 const unpacked=join(scratch,'unpacked');mkdirSync(unpacked)
 run('tar',['-xzf',archive,'-C',unpacked],scratch)
 const app=join(scratch,'app');cpSync(join(unpacked,'package/examples/document-signing'),app,{recursive:true})
 cpSync(join(app,'gitignore.template'),join(app,'.gitignore'))
 const packageFile=join(app,'package.json'),pkg=JSON.parse(readFileSync(packageFile))
 pkg.dependencies['tasra-sdk']='file:'+archive;writeFileSync(packageFile,JSON.stringify(pkg,null,2))
 console.log(run('npm',['install','--no-audit','--no-fund'],app))
 console.log(run('npm',['audit','--include=dev','--include=optional','--audit-level=high'],app))
 console.log(run('npm',['run','build'],app));console.log(run('npm',['test'],app))
 console.log('PASS: packed app installs, typechecks, bundles PDF renderer and passes workflow tests in an empty directory')
}catch(e){console.error(e.stdout?.toString()??'',e.stderr?.toString()??'');throw e}
finally{rmSync(scratch,{recursive:true,force:true})}
