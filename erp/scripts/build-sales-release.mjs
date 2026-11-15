import {salesReleaseSQL} from './sales-release-sql.mjs'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {resolve} from 'node:path'
import {createHash} from 'node:crypto'
const root=fileURLToPath(new URL('../../',import.meta.url)),erp=resolve(root,'erp')
const output=process.argv[2];if(!output)throw new Error('Pass an output directory; production execution is never automatic')
const migrations=['sales_evidence_history','sales_desk','sales_g2b_collection','sales_preapproval','sales_execution_packages','sales_dispatch_queue','sales_readiness','sales_contact_evidence','sales_mail_evidence','sales_contact_discovery','sales_reply_crm','sales_crm_pipeline','sales_followup_preparation','sales_followup_research','sales_event_brands','sales_event_sources','sales_news'].map((name,i)=>`202611150901${String(i+1).padStart(2,'0')}_${name}.sql`)
const workers=['sales-desk','sales-g2b','sales-planner','sales-readiness','sales-mail-evidence','sales-contact-discovery','sales-replies','sales-followup','sales-followup-research','sales-event-brands','sales-news']
if(execFileSync('git',['status','--porcelain','--untracked-files=normal'],{cwd:root,encoding:'utf8'}).trim())throw new Error('Freeze and commit the reviewed release before packaging')
const manifest={localCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:root,encoding:'utf8'}).trim(),productionHold:true,sendingEnabled:false,migrations:[],workers:[]}
const hash=text=>createHash('sha256').update(text).digest('hex')
const sections=[]
for(const name of migrations){const content=await readFile(resolve(erp,'supabase/migrations',name),'utf8');if(!/^begin;$/mi.test(content)||!/^commit;$/mi.test(content))throw new Error('Migration transaction boundary missing: '+name)
 sections.push(`-- ${name}\n`+content.replace(/^begin;\s*$/gmi,'').replace(/^commit;\s*$/gmi,''));manifest.migrations.push({name,sha256:hash(content)})}
for(const name of workers){execFileSync(process.execPath,[`scripts/build-${name}-dashboard.mjs`,'--check'],{cwd:erp,stdio:'pipe'});const file=`supabase/deploy/${name}-dashboard.ts`,content=await readFile(resolve(erp,file),'utf8');manifest.workers.push({name,file,sha256:hash(content)})}
const bundle=salesReleaseSQL(sections)
await mkdir(output,{recursive:true});await writeFile(resolve(output,'sales-release-review.sql'),bundle);await writeFile(resolve(output,'sales-release-manifest.json'),JSON.stringify({...manifest,bundleSha256:hash(bundle)},null,2)+'\n');console.log(JSON.stringify({migrations:migrations.length,workers:workers.length,productionHold:true,sendingEnabled:false,output}))
