import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
const root=new URL('../',import.meta.url)
const files=['handler.ts','index.ts']
const source=(await Promise.all(files.map(name=>readFile(new URL('supabase/functions/sales-seoul/'+name,root),'utf8')))).join('\n').replace("import {createSeoulWorker,normalizeSeoulApiKey} from './handler.ts'",'')
const output='// Generated from sales-seoul handler/index. SHA256 '+createHash('sha256').update(source).digest('hex')+'\n'+source
const path=new URL('supabase/deploy/sales-seoul-dashboard.ts',root)
if(process.argv.includes('--check')){if(await readFile(path,'utf8')!==output)throw new Error('Rebuild sales-seoul dashboard source')}else await writeFile(path,output)
