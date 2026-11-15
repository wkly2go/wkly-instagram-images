import {readdirSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {execFileSync} from 'node:child_process'

export function duplicateMigrationNumbers(paths) {
 const groups=new Map()
 for(const path of new Set(paths)) {
  const match=path.match(/(?:^|\/)(\d+)_[^/]+\.sql$/)
  if(!match)continue
  const number=String(Number(match[1]))
  groups.set(number,[...(groups.get(number)??[]),path])
 }
 return [...groups].filter(([,files])=>files.length>1)
}

export function compareMigrationNumbers(base,working) {
 const known=new Map(duplicateMigrationNumbers(base))
 const existing=[],introduced=[]
 for(const entry of duplicateMigrationNumbers([...base,...working])) {
  const previous=known.get(entry[0])
  ;(previous && entry[1].every(file=>previous.includes(file)) ? existing : introduced).push(entry)
 }
 return {existing,introduced}
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
 try {
  const root=fileURLToPath(new URL('../../',import.meta.url))
  const prefix='erp/supabase/migrations/'
  const paths=readdirSync(new URL('../supabase/migrations/',import.meta.url)).map(x=>prefix+x)
  const args=process.argv.slice(2)
  if(args.length && (args.length!==2||args[0]!=='--base-ref'||args[1].startsWith('-')))throw new Error('Usage: node check-migration-numbers.mjs [--base-ref REF]')
  const base=args.length?execFileSync('git',['ls-tree','-r','--name-only',args[1],'--',prefix],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean):[]
  const {existing,introduced:conflicts}=compareMigrationNumbers(base,paths)
  for(const [number,files] of existing)console.warn(`Existing base collision ${number} (do not renumber applied files):\n${files.join('\n')}`)
  if(conflicts.length){for(const [number,files] of conflicts)console.error(`Migration ${number}:\n${files.join('\n')}`);process.exitCode=1}
  else console.log('Migration numbers: no NEW collisions across the checked trees. SQL objects and unpublished work require separate review.')
 }catch(error){console.error(error.message);process.exitCode=1}
}
